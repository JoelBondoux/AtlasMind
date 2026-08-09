import { describe, expect, it } from 'vitest';
import {
  DELIVERY_RUN_TERMINAL_NAME,
  buildDeliveryRunConfirmation,
  buildDeliveryRunPlan,
  chainDeliveryCommands,
  classifyDeliveryCommandReach,
  classifyDeliveryShell,
  shellStopsOnFailure,
} from '../../src/core/deliveryRunPlan.ts';
import type { DeliveryGuidePhase, DeliveryGuideStep } from '../../src/core/deliveryManager.ts';

function step(overrides: Partial<DeliveryGuideStep> & { id: string; label: string }): DeliveryGuideStep {
  return {
    detail: 'detail',
    status: 'configured',
    blocking: false,
    ...overrides,
  };
}

function phase(steps: DeliveryGuideStep[]): DeliveryGuidePhase {
  return { id: 'validate', label: 'Validate', description: 'checks', steps };
}

describe('classifyDeliveryShell', () => {
  it('separates PowerShell 7 from Windows PowerShell 5.1, which has no &&', () => {
    expect(classifyDeliveryShell('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe('pwsh');
    expect(classifyDeliveryShell('C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')).toBe('powershell');
    expect(shellStopsOnFailure('pwsh')).toBe(true);
    expect(shellStopsOnFailure('powershell')).toBe(false);
  });

  it('recognises the common POSIX shells and cmd', () => {
    expect(classifyDeliveryShell('/bin/bash')).toBe('posix');
    expect(classifyDeliveryShell('/usr/bin/zsh')).toBe('posix');
    expect(classifyDeliveryShell('/usr/local/bin/fish')).toBe('posix');
    expect(classifyDeliveryShell('C:\\WINDOWS\\System32\\cmd.exe')).toBe('cmd');
  });

  it('leaves an unfamiliar or absent shell unknown rather than assuming it chains', () => {
    // Guessing that an unrecognised shell understands `&&` risks a parse error
    // in place of a release.
    expect(classifyDeliveryShell('/usr/bin/nu')).toBe('unknown');
    expect(classifyDeliveryShell(undefined)).toBe('unknown');
    expect(classifyDeliveryShell('')).toBe('unknown');
    expect(shellStopsOnFailure('unknown')).toBe(false);
  });
});

describe('chainDeliveryCommands', () => {
  it('chains with && where the shell can stop on failure', () => {
    const chained = chainDeliveryCommands(['npm run lint', 'npm test'], 'posix');
    expect(chained.lines).toEqual(['npm run lint && npm test']);
    expect(chained.failFast).toBe(true);
  });

  it('sends separate lines and reports the loss where it cannot', () => {
    const chained = chainDeliveryCommands(['npm run lint', 'npm test'], 'powershell');
    expect(chained.lines).toEqual(['npm run lint', 'npm test']);
    expect(chained.failFast).toBe(false);
  });

  it('treats a single command as fail-fast on any shell — nothing follows it', () => {
    expect(chainDeliveryCommands(['npm test'], 'powershell')).toEqual({ lines: ['npm test'], failFast: true });
    expect(chainDeliveryCommands([], 'unknown')).toEqual({ lines: [], failFast: true });
  });
});

describe('classifyDeliveryCommandReach', () => {
  it('flags commands whose effect leaves this machine', () => {
    for (const command of [
      'git push origin develop',
      'npm publish',
      'vsce publish',
      'cargo publish',
      'twine upload dist/*',
      'docker push registry.example.com/app:1.2.3',
      'gh workflow run .github/workflows/publish.yml',
      'gh release create v1.0.0',
      'kubectl apply -f deploy.yaml',
      'terraform apply',
      'wrangler deploy',
      'npm run publish:release',
      'npm run tag:release',
      './mvnw deploy',
    ]) {
      expect(classifyDeliveryCommandReach(command), command).toBe('outward');
    }
  });

  it('leaves local build and check commands alone', () => {
    for (const command of [
      'npm ci',
      'npm run compile',
      'npm test',
      'npm run package',
      'go test ./...',
      'cargo build --release',
      'git status --short',
      'docker build .',
      'dotnet test --no-restore',
    ]) {
      expect(classifyDeliveryCommandReach(command), command).toBe('local');
    }
  });

  it('matches on word boundaries, so a lookalike is not misread', () => {
    // `git push` is outward; a script that merely mentions pushing is not the
    // same claim, and neither is a package whose name contains one.
    expect(classifyDeliveryCommandReach('npm run build:pushup')).toBe('local');
    expect(classifyDeliveryCommandReach('npm run prepublishOnly')).toBe('local');
  });
});

describe('buildDeliveryRunPlan', () => {
  it('collects only the steps that carry a command, in guide order', () => {
    const plan = buildDeliveryRunPlan(
      phase([
        step({ id: 'validate-lint-1', label: 'lint', command: 'npm run lint' }),
        step({ id: 'validate-review-2', label: 'Self-review the diff', status: 'manual' }),
        step({ id: 'validate-test-3', label: 'test', command: 'npm test' }),
      ]),
      '/bin/bash',
    );

    expect(plan.commands.map(entry => entry.command)).toEqual(['npm run lint', 'npm test']);
    expect(plan.lines).toEqual(['npm run lint && npm test']);
    expect(plan.failFast).toBe(true);
  });

  it('names the steps it will not run rather than dropping them', () => {
    // A plan that silently omits the manual gates reads as the whole column.
    const plan = buildDeliveryRunPlan(
      phase([
        step({ id: 'validate-lint-1', label: 'lint', command: 'npm run lint' }),
        step({ id: 'validate-review-2', label: 'Self-review the diff', status: 'manual' }),
      ]),
      '/bin/bash',
    );

    expect(plan.skipped).toEqual([{ stepId: 'validate-review-2', label: 'Self-review the diff' }]);
  });

  it('separates the outward commands from the rest of the column', () => {
    const plan = buildDeliveryRunPlan(
      phase([
        step({ id: 'publish-package-1', label: 'package', command: 'npm run package' }),
        step({ id: 'publish-release-2', label: 'publish:release', command: 'npm run publish:release' }),
      ]),
      '/bin/bash',
    );

    expect(plan.outward.map(entry => entry.command)).toEqual(['npm run publish:release']);
  });

  it('produces an empty, harmless plan for a column with nothing to run', () => {
    const plan = buildDeliveryRunPlan(phase([step({ id: 'deploy-pr-1', label: 'Promote via PR', status: 'manual' })]), '/bin/bash');
    expect(plan.commands).toEqual([]);
    expect(plan.lines).toEqual([]);
  });
});

describe('buildDeliveryRunConfirmation', () => {
  it('lists every command in order — the dialog is the only place they are all shown', () => {
    const plan = buildDeliveryRunPlan(
      phase([
        step({ id: 'a', label: 'lint', command: 'npm run lint' }),
        step({ id: 'b', label: 'test', command: 'npm test' }),
        step({ id: 'c', label: 'package', command: 'npm run package' }),
      ]),
      '/bin/bash',
    );
    const confirmation = buildDeliveryRunConfirmation(plan);

    for (const command of ['npm run lint', 'npm test', 'npm run package']) {
      expect(confirmation.detail).toContain(command);
    }
    expect(confirmation.detail).toContain(DELIVERY_RUN_TERMINAL_NAME);
    expect(confirmation.detail).toContain('A failing command stops the ones after it.');
  });

  it('states the lost fail-fast where the shell cannot express it', () => {
    const plan = buildDeliveryRunPlan(
      phase([
        step({ id: 'a', label: 'test', command: 'npm test' }),
        step({ id: 'b', label: 'publish', command: 'npm run publish:release' }),
      ]),
      'C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    );
    const confirmation = buildDeliveryRunConfirmation(plan);

    expect(plan.failFast).toBe(false);
    expect(confirmation.detail).toContain('will NOT stop the rest');
  });

  it('says an outward command cannot be undone, and puts the count on the button', () => {
    const plan = buildDeliveryRunPlan(
      phase([
        step({ id: 'a', label: 'package', command: 'npm run package' }),
        step({ id: 'b', label: 'publish', command: 'npm run publish:release' }),
      ]),
      '/bin/bash',
    );
    const confirmation = buildDeliveryRunConfirmation(plan);

    expect(confirmation.detail).toContain('cannot be undone');
    expect(confirmation.confirmLabel).toBe('Run 2, including 1 outward');
  });

  it('names the steps that carry no command so the run is not read as the column', () => {
    const plan = buildDeliveryRunPlan(
      phase([
        step({ id: 'a', label: 'test', command: 'npm test' }),
        step({ id: 'b', label: 'Self-review the diff', status: 'manual' }),
      ]),
      '/bin/bash',
    );

    expect(buildDeliveryRunConfirmation(plan).detail).toContain('Self-review the diff');
  });
});
