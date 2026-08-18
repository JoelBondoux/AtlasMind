import { describe, expect, it } from 'vitest';
import {
  ACT_COMMAND,
  assessActFidelity,
  buildActRunConfirmation,
  planActRun,
  type ActRunPlan,
} from '../../src/core/ciActRoute.ts';

const CLEAN_WORKFLOW = `name: CI
on:
  push:
    branches: [main]
jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test
`;

function planFor(text: string, overrides: Partial<Parameters<typeof planActRun>[0]> = {}) {
  return planActRun({ workflowFile: 'ci.yml', fidelity: assessActFidelity(text), ...overrides });
}

function okPlan(text: string): ActRunPlan {
  const outcome = planFor(text);
  if (!outcome.ok) {
    throw new Error(`expected a plan, got: ${outcome.reason}`);
  }
  return outcome.plan;
}

describe('act fidelity assessment', () => {
  /**
   * The point of the feature. `act` runs the real workflow, which is its
   * appeal, but its images are incomplete and several GitHub services are only
   * partially emulated — and none of that is visible from an exit code.
   */
  it('finds nothing to warn about in a plain Linux workflow, and says so carefully', () => {
    const assessment = assessActFidelity(CLEAN_WORKFLOW);
    expect(assessment.gaps).toEqual([]);
    expect(assessment.blocked).toBe(false);
    // Deliberately not "this will match GitHub" — absence of a known problem is
    // not a guarantee, and the summary must not imply one.
    expect(assessment.summary).toContain('not the same as a guarantee');
  });

  it('refuses a Windows or macOS job rather than running something else', () => {
    for (const runner of ['windows-latest', 'macos-14', 'windows-2022']) {
      const assessment = assessActFidelity(`jobs:\n  a:\n    runs-on: ${runner}\n`);
      expect(assessment.blocked).toBe(true);
      expect(assessment.gaps[0]?.severity).toBe('cannot-run');
    }
  });

  it('refuses OIDC, which cannot be made to work locally at all', () => {
    const assessment = assessActFidelity('permissions:\n  id-token: write\n');
    expect(assessment.blocked).toBe(true);
    expect(assessment.gaps.some(gap => /OIDC/.test(gap.finding))).toBe(true);
  });

  it.each([
    ['artifacts', 'steps:\n  - uses: actions/upload-artifact@v4\n'],
    ['the cache', 'steps:\n  - uses: actions/cache@v4\n'],
    ['service containers', 'jobs:\n  a:\n    services:\n      db:\n        image: postgres\n'],
    ['a secret', 'env:\n  TOKEN: ${{ secrets.TOKEN }}\n'],
    ['the event payload', 'run: echo ${{ github.event.number }}\n'],
  ])('flags %s as partial rather than blocking', (_label, text) => {
    const assessment = assessActFidelity(text);
    expect(assessment.blocked).toBe(false);
    expect(assessment.gaps).toHaveLength(1);
    expect(assessment.gaps[0]?.severity).toBe('partial');
  });

  it('always says what a gap means, never only that one exists', () => {
    const assessment = assessActFidelity('steps:\n  - uses: actions/cache@v4\n  - run: echo ${{ secrets.A }}\n');
    expect(assessment.gaps.length).toBeGreaterThan(1);
    for (const gap of assessment.gaps) {
      expect(gap.finding.length).toBeGreaterThan(10);
      expect(gap.consequence.length).toBeGreaterThan(30);
    }
  });

  it('never throws on unreadable input', () => {
    for (const text of ['', 'not yaml at all', '\u0000\u0001', 'a'.repeat(2_000_000)]) {
      expect(() => assessActFidelity(text)).not.toThrow();
    }
  });
});

describe('act run planning', () => {
  it('builds argv rather than a shell string', () => {
    const plan = okPlan(CLEAN_WORKFLOW);
    expect(plan.command).toBe(ACT_COMMAND);
    expect(plan.args).toContain('--workflows');
    expect(plan.args).toContain('.github/workflows/ci.yml');
    for (const arg of plan.args) {
      expect(arg).not.toMatch(/[;&|`$><]/);
    }
    expect(plan.line).toBe([ACT_COMMAND, ...plan.args].join(' '));
  });

  /**
   * act's default images are large. A route whose appeal is being local and
   * cheap must not start a multi-gigabyte download on somebody's behalf.
   */
  it('never pulls an image on the user\u2019s behalf', () => {
    expect(okPlan(CLEAN_WORKFLOW).args).toContain('--pull=false');
  });

  it('refuses a workflow whose jobs act cannot honestly run', () => {
    const outcome = planFor('jobs:\n  a:\n    runs-on: windows-latest\n');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toContain('looks like the workflow');
    }
  });

  it('refuses a filename or job id it would not put on a command line', () => {
    for (const workflowFile of ['../escape.yml', 'nested/ci.yml', 'ci.txt', 'ci.yml; rm -rf /']) {
      expect(planFor(CLEAN_WORKFLOW, { workflowFile }).ok).toBe(false);
    }
    expect(planFor(CLEAN_WORKFLOW, { jobId: 'a b' }).ok).toBe(false);
    expect(planFor(CLEAN_WORKFLOW, { jobId: '$(whoami)' }).ok).toBe(false);
    expect(planFor(CLEAN_WORKFLOW, { jobId: 'quality' }).ok).toBe(true);
  });

  it('refuses an event outside the closed list', () => {
    expect(planFor(CLEAN_WORKFLOW, { event: 'pull_request' }).ok).toBe(false);
    expect(planFor(CLEAN_WORKFLOW, { event: 'push' }).ok).toBe(true);
  });
});

describe('act confirmation', () => {
  /**
   * The gaps come before the command, because the command is the part somebody
   * already understands and the gaps decide whether the result means anything.
   */
  it('leads with what will not be reproduced, and never claims parity', () => {
    const plan = okPlan('steps:\n  - uses: actions/upload-artifact@v4\n');
    const confirmation = buildActRunConfirmation(plan);
    expect(confirmation.detail).toContain('Before you trust the result');
    expect(confirmation.detail).toContain('artifact');
    expect(confirmation.detail).toContain('not about GitHub');
  });

  it('says AtlasMind will not run it and cannot report the outcome', () => {
    const confirmation = buildActRunConfirmation(okPlan(CLEAN_WORKFLOW));
    expect(confirmation.detail).toContain('does not run act for you');
    expect(confirmation.detail).toContain('cannot report how this ends');
    expect(confirmation.confirmLabel).toBe('Send to terminal');
  });
});
