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

  it('runs every step in order and verifies the agent afterwards', async () => {
    const ran: string[] = [];
    const exec = vi.fn(async (command: string, args: string[]) => { ran.push(`${command} ${args.join(' ')}`); });
    const outcome = await runAcpInstallPlan(plan, machine('win32', ['winget', 'claude-agent-acp']), undefined, exec);

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
    const exec = vi.fn(async () => undefined);
    const outcome = await runAcpInstallPlan(plan, machine('win32', ['winget']), undefined, exec);

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/still is not on this window's PATH/);
    expect(outcome.completed).toHaveLength(2);
  });

  it('reports progress for each step so a long install does not look hung', async () => {
    const messages: string[] = [];
    await runAcpInstallPlan(
      plan,
      machine('win32', ['winget', 'claude-agent-acp']),
      message => messages.push(message),
      async () => undefined,
    );
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain('winget install');
  });
});
