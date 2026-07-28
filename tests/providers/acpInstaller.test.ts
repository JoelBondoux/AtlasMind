import { describe, expect, it, vi } from 'vitest';
import { planAcpAgentInstall, runAcpInstallPlan, type AcpInstallPlan } from '../../src/providers/acpInstaller.ts';

/** A machine with exactly the listed commands on PATH. */
function machine(platform: string, present: string[]) {
  return {
    platform,
    findExecutable: (command: string) => (present.includes(command) ? `/usr/bin/${command}` : undefined),
  };
}

function plannable(plan: AcpInstallPlan): Extract<AcpInstallPlan, { status: 'plannable' }> {
  if (plan.status !== 'plannable') {
    throw new Error(`expected a plannable plan, got ${plan.status}`);
  }
  return plan;
}

describe('planAcpAgentInstall — planning performs nothing', () => {
  it('reports ready when the agent is already on PATH', () => {
    expect(planAcpAgentInstall('claude', machine('win32', ['claude-agent-acp'])).status).toBe('ready');
  });

  it('plans one step when the runtime is present but the agent is not', () => {
    // Someone who already has Node should not be shown a list implying
    // AtlasMind is about to reinstall their toolchain.
    const plan = plannable(planAcpAgentInstall('claude', machine('darwin', ['npm', 'brew'])));
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]!.humanCommand).toBe('npm install -g @zed-industries/claude-code-acp');
  });

  it('plans the runtime first when npm is missing — the novice case', () => {
    // "Install it with npm install -g …" is not advice if you have no npm.
    const plan = plannable(planAcpAgentInstall('claude', machine('win32', ['winget'])));
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]!.humanCommand).toContain('winget install --id OpenJS.NodeJS.LTS');
    expect(plan.steps[1]!.humanCommand).toBe('npm install -g @zed-industries/claude-code-acp');
  });

  it('plans cargo for codex, and the platform package manager when cargo is absent', () => {
    const withCargo = plannable(planAcpAgentInstall('codex', machine('linux', ['cargo'])));
    expect(withCargo.steps.map(step => step.humanCommand)).toEqual(['cargo install codex-acp']);

    const withoutCargo = plannable(planAcpAgentInstall('codex', machine('linux', ['apt-get'])));
    expect(withoutCargo.steps[0]!.humanCommand).toContain('apt-get install -y cargo');
  });

  it('falls back to manual when no supported package manager exists', () => {
    const plan = planAcpAgentInstall('claude', machine('linux', []));
    expect(plan.status).toBe('manual');
    if (plan.status === 'manual') {
      expect(plan.humanCommand).toBe('npm install -g @zed-industries/claude-code-acp');
    }
  });

  it('refuses to plan an agent it has no recipe for', () => {
    // A user-named command is only documented by its own publisher. Guessing an
    // install for it would fail in a way they could not diagnose, having been
    // told AtlasMind was handling it.
    const plan = planAcpAgentInstall('my-own-agent', machine('win32', ['winget', 'npm']));
    expect(plan.status).toBe('manual');
  });

  it('reports manual on an unsupported platform rather than guessing', () => {
    expect(planAcpAgentInstall('claude', machine('aix', [])).status).toBe('manual');
  });

  it('NEVER produces a step that goes through a shell or pipes a download', () => {
    // Rust's own documented installer is `curl … | sh`. Piping a download into a
    // shell on the user's behalf is the thing this module exists to avoid, so no
    // planned step may name a shell, a downloader, or carry shell metacharacters.
    const platforms = ['win32', 'darwin', 'linux'];
    const managers = ['winget', 'brew', 'apt-get', 'dnf', 'pacman', 'npm', 'cargo'];
    for (const platform of platforms) {
      for (const agentId of ['claude', 'codex']) {
        for (const present of [[], ...managers.map(manager => [manager])]) {
          const plan = planAcpAgentInstall(agentId, machine(platform, present));
          if (plan.status !== 'plannable') {
            continue;
          }
          for (const step of plan.steps) {
            expect(['sh', 'bash', 'zsh', 'cmd', 'cmd.exe', 'powershell', 'pwsh', 'curl', 'wget'])
              .not.toContain(step.command.split('/').pop());
            for (const arg of step.args) {
              expect(arg).not.toMatch(/[|;&><`$]/);
            }
          }
        }
      }
    }
  });
});

describe('runAcpInstallPlan', () => {
  const plan = plannable(planAcpAgentInstall('claude', machine('win32', ['winget'])));

  /** A machine whose PATH grows as installs succeed, like a real one. */
  function evolvingMachine(present: string[], gainsAfterFirstStep: string[] = []) {
    const available = new Set(present);
    let steps = 0;
    return {
      platform: 'linux',
      findExecutable: (command: string) => (available.has(command) ? `/usr/bin/${command}` : undefined),
      note: () => { steps += 1; if (steps === 1) { gainsAfterFirstStep.forEach(entry => available.add(entry)); } },
    };
  }

  it('runs every step in order and verifies the agent afterwards', async () => {
    const probe = evolvingMachine(['winget'], ['npm', 'claude-agent-acp']);
    const ran: string[] = [];
    const exec = vi.fn(async (command: string, args: string[]) => { ran.push(`${command} ${args.join(' ')}`); probe.note(); });
    const outcome = await runAcpInstallPlan(plan, probe, undefined, exec);

    expect(ran).toHaveLength(2);
    expect(ran[1]).toContain('install -g @zed-industries/claude-code-acp');
    expect(outcome.ok).toBe(true);
  });

  it('stops at the first failure rather than compounding it', async () => {
    // Running `npm install` after Node failed to install produces a second,
    // more confusing error stacked on the real one.
    const exec = vi.fn(async () => { throw new Error('winget exited 1'); });
    const outcome = await runAcpInstallPlan(plan, machine('win32', ['winget']), undefined, exec);

    expect(exec).toHaveBeenCalledTimes(1);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('winget install');
    expect(outcome.completed).toEqual([]);
  });

  it('does NOT report success when the commands passed but the agent is still absent', async () => {
    // A package manager can exit 0 having put the binary somewhere this
    // process's PATH will not see until a reload. Saying "installed" to someone
    // for whom nothing then works is the failure this module exists to prevent.
    const probe = evolvingMachine(['winget'], ['npm']);
    const exec = vi.fn(async () => { probe.note(); });
    const outcome = await runAcpInstallPlan(plan, probe, undefined, exec);

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/still is not on this window's PATH/);
    expect(outcome.completed).toHaveLength(2);
  });

  it('says what to do when the runtime installed but is not yet on this PATH', async () => {
    // The realistic Windows case: winget succeeds, but npm will not resolve in
    // this process until the window reloads. That is not a crash, and the
    // message has to name the reload rather than report a spawn error.
    const exec = vi.fn(async () => undefined);
    const outcome = await runAcpInstallPlan(plan, machine('win32', ['winget']), undefined, exec);

    expect(exec).toHaveBeenCalledTimes(1);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/Reload the window/);
  });

  it('reports progress for each step so a long install does not look hung', async () => {
    const probe = evolvingMachine(['winget'], ['npm', 'claude-agent-acp']);
    const messages: string[] = [];
    await runAcpInstallPlan(plan, probe, message => messages.push(message), async () => { probe.note(); });
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain('winget install');
  });
});

describe('spawning — the `spawn npm ENOENT` regression', () => {
  it('never spawns a bare command name', () => {
    // `execFile('npm', …)` does not apply PATHEXT on Windows, so it looks for a
    // file literally called `npm` and misses `npm.cmd`. Every step planned
    // against an already-present tool must carry a resolved path.
    const plan = plannable(planAcpAgentInstall('claude', machine('darwin', ['npm'])));
    for (const step of plan.steps) {
      expect(step.resolveAtRunTime ? true : step.command.includes('/') || step.command.includes('\\')).toBe(true);
    }
  });

  it('goes around a Windows .cmd shim via node.exe rather than using a shell', () => {
    // Node refuses to spawn .cmd/.bat without `shell: true` (CVE-2024-27980),
    // and a shell is not on the table — so npm's batch shim is bypassed in
    // favour of the script it wraps.
    const plan = plannable(planAcpAgentInstall('claude', {
      platform: 'win32',
      findExecutable: command => (command === 'npm' ? 'C:\\Program Files\\nodejs\\npm.cmd' : undefined),
      fileExists: () => true,
    }));
    const step = plan.steps[0]!;
    expect(step.command).toBe('C:\\Program Files\\nodejs\\node.exe');
    expect(step.args[0]).toBe('C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js');
    expect(step.args.slice(1)).toEqual(['install', '-g', '@zed-industries/claude-code-acp']);
    // Still shown to the user as the command they recognise.
    expect(step.humanCommand).toBe('npm install -g @zed-industries/claude-code-acp');
  });

  it('degrades to manual rather than guessing when the shim cannot be resolved', () => {
    const plan = planAcpAgentInstall('claude', {
      platform: 'win32',
      findExecutable: command => (command === 'npm' ? 'C:\\weird\\npm.cmd' : undefined),
      fileExists: () => false,
    });
    expect(plan.status).toBe('manual');
  });
});

describe('humanCommand is the consent, so it cannot diverge from the argv', () => {
  it('shows every argument that will actually be passed', () => {
    // The first version displayed `winget install --id X -e` while the argv also
    // carried `--accept-package-agreements --accept-source-agreements`, hiding
    // the one detail a user might have objected to.
    const plan = plannable(planAcpAgentInstall('claude', machine('win32', ['winget'])));
    const runtimeStep = plan.steps[0]!;
    for (const arg of runtimeStep.args) {
      expect(runtimeStep.humanCommand).toContain(arg);
    }
    expect(runtimeStep.humanCommand).toContain('--accept-package-agreements');
  });

  it('shows sudo exactly when sudo is used, and not otherwise', () => {
    const plan = plannable(planAcpAgentInstall('codex', machine('linux', ['apt-get'])));
    const step = plan.steps[0]!;
    const usesSudo = step.command.endsWith('sudo') || step.args[0] === 'sudo';
    expect(step.humanCommand.startsWith('sudo ')).toBe(usesSudo);
  });
});
