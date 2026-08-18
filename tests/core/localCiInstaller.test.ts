import { describe, expect, it } from 'vitest';
import {
  GITHUB_CLI_COMMAND,
  formatInstallCommand,
  planGitHubCliInstall,
  runGitHubCliInstallPlan,
  type LocalCiInstallPlan,
  type LocalCiInstallProbe,
} from '../../src/core/localCiInstaller.ts';

function probe(platform: string, present: string[]): LocalCiInstallProbe {
  return {
    platform,
    findExecutable: (command: string) => present.includes(command) ? `/usr/bin/${command}` : undefined,
  };
}

function plannable(plan: LocalCiInstallPlan): Extract<LocalCiInstallPlan, { status: 'plannable' }> {
  if (plan.status !== 'plannable') {
    throw new Error(`expected a plannable plan, got ${plan.status}`);
  }
  return plan;
}

describe('GitHub CLI install planning', () => {
  it('does nothing when gh is already on PATH', () => {
    expect(planGitHubCliInstall(probe('win32', ['gh', 'winget']))).toEqual({ status: 'ready' });
  });

  it('plans winget on Windows and brew on macOS', () => {
    const windows = plannable(planGitHubCliInstall(probe('win32', ['winget'])));
    expect(windows.steps[0]?.humanCommand).toContain('winget install --id GitHub.cli');

    const mac = plannable(planGitHubCliInstall(probe('darwin', ['brew'])));
    expect(mac.steps[0]?.humanCommand).toBe('brew install gh');
  });

  it('prefers an unelevated manager on Linux and marks the elevated ones', () => {
    const withBrew = plannable(planGitHubCliInstall(probe('linux', ['brew', 'dnf'])));
    expect(withBrew.steps[0]?.humanCommand).toBe('brew install gh');
    expect(withBrew.steps[0]?.requiresElevation).toBeUndefined();

    const dnfOnly = plannable(planGitHubCliInstall(probe('linux', ['dnf'])));
    expect(dnfOnly.steps[0]?.requiresElevation).toBe(true);

    const pacmanOnly = plannable(planGitHubCliInstall(probe('linux', ['pacman'])));
    expect(pacmanOnly.steps[0]?.humanCommand).toContain('github-cli');
    expect(pacmanOnly.steps[0]?.requiresElevation).toBe(true);
  });

  /**
   * `gh` is absent from the repositories of Debian and Ubuntu releases still in
   * wide use, and GitHub's own route for those adds a keyring and an apt source
   * — a network-fetched key piped into a install step, which is the shape this
   * module refuses to script. Reporting `manual` is the honest answer.
   */
  it('refuses to script the Debian and Ubuntu route, and says why', () => {
    const plan = planGitHubCliInstall(probe('linux', ['apt-get']));
    expect(plan.status).toBe('manual');
    if (plan.status === 'manual') {
      expect(plan.reason).toContain('apt repository');
      expect(plan.url).toContain('cli/cli');
    }
  });

  it('reports manual on an unsupported platform rather than guessing', () => {
    const plan = planGitHubCliInstall(probe('aix', ['brew']));
    expect(plan.status).toBe('manual');
    if (plan.status === 'manual') {
      expect(plan.reason).toContain('aix');
    }
  });

  /**
   * The displayed command is the consent. A summary maintained beside the real
   * argv drifts, and it drifts toward dropping the argument somebody would have
   * wanted to know about.
   */
  it('shows every argument that will actually be passed', () => {
    const plan = plannable(planGitHubCliInstall(probe('win32', ['winget'])));
    const step = plan.steps[0]!;
    for (const arg of step.args) {
      expect(step.humanCommand).toContain(arg);
    }
    expect(step.humanCommand).toBe(formatInstallCommand(step.command, step.args));
  });

  it('never assembles a shell invocation', () => {
    for (const sample of [probe('win32', ['winget']), probe('darwin', ['brew']), probe('linux', ['pacman'])]) {
      const plan = plannable(planGitHubCliInstall(sample));
      for (const step of plan.steps) {
        expect(step.command).not.toMatch(/\b(?:sh|bash|zsh|cmd|powershell|pwsh)(?:\.exe)?$/i);
        for (const arg of step.args) {
          expect(arg).not.toMatch(/[;&|><`$]/);
        }
      }
    }
  });
});

describe('GitHub CLI install execution', () => {
  it('verifies gh resolves afterwards rather than trusting the exit code', async () => {
    const plan = plannable(planGitHubCliInstall(probe('darwin', ['brew'])));
    const stillMissing = await runGitHubCliInstallPlan(
      plan,
      probe('darwin', ['brew']),
      undefined,
      async () => undefined,
    );
    expect(stillMissing.ok).toBe(false);
    expect(stillMissing.message).toContain('reload');
    expect(stillMissing.completed).toHaveLength(1);

    const nowPresent = await runGitHubCliInstallPlan(
      plan,
      probe('darwin', ['brew', GITHUB_CLI_COMMAND]),
      undefined,
      async () => undefined,
    );
    expect(nowPresent.ok).toBe(true);
    expect(nowPresent.message).toContain('gh auth login');
  });

  it('stops at the first failure and names the step that broke', async () => {
    const plan = plannable(planGitHubCliInstall(probe('win32', ['winget'])));
    const outcome = await runGitHubCliInstallPlan(
      plan,
      probe('win32', ['winget']),
      undefined,
      async () => { throw new Error('winget exited with 1'); },
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.completed).toEqual([]);
    expect(outcome.message).toContain('winget install --id GitHub.cli');
    expect(outcome.message).toContain('winget exited with 1');
  });
});
