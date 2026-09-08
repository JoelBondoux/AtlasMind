import { describe, expect, it } from 'vitest';

import type { RoutineDefinition } from '../../src/types.ts';
import {
  ROUTINE_EXECUTION_RULES,
  describeRoutinePlan,
  planRoutineExecution,
  routinePlaceholders,
  unresolvedRoutinePlaceholders,
} from '../../src/core/routineExecutionPolicy.ts';

/**
 * What a routine will run, decided before a shell sees any of it.
 *
 * A routine step is a shell command by design and that is not the finding. The
 * findings are what surrounded it: nothing showed the commands before running
 * them, a placeholder with no value silently became an empty string, and the
 * template — which the value checker deliberately does not validate — lives in
 * an ordinary workspace file that the `file-write` tool can author.
 */

function routine(steps: Array<{ id: string; label: string; run: string }>): RoutineDefinition {
  return {
    id: 'ship',
    name: 'Ship',
    description: 'Release the thing',
    steps: steps.map(step => ({ ...step, on_fail: 'abort' as const })),
  };
}

describe('a placeholder with no value refuses, and never blanks', () => {
  it('names every unresolved placeholder rather than the first', () => {
    // Three dialogs to fix three typos is how somebody learns to stop reading
    // the dialog.
    const plan = planRoutineExecution(
      routine([
        { id: 'tag', label: 'Tag', run: 'git tag ${version}' },
        { id: 'publish', label: 'Publish', run: 'npm publish --tag ${channel}' },
      ]),
      {},
    );

    expect(plan.status).toBe('refused');
    if (plan.status !== 'refused') { return; }
    expect(plan.refusals).toHaveLength(2);
    expect(plan.refusals.every(refusal => refusal.rule === 'unresolved-placeholder')).toBe(true);
    expect(plan.refusals[0]!.detail).toContain('version');
    expect(plan.refusals[1]!.detail).toContain('channel');
  });

  it('treats an empty value as absent, not as an answer', () => {
    // A blank field and an unsupplied one want the same thing from a command
    // line, and only one of them would have been caught by a presence check.
    const plan = planRoutineExecution(
      routine([{ id: 'commit', label: 'Commit', run: 'git commit -m "${message}"' }]),
      { message: '' },
    );

    expect(plan.status).toBe('refused');
  });

  it('is the exact case the Run Center used to hit on every press', () => {
    // The panel posted `vars: {}` unconditionally, so every placeholder in a
    // panel-run routine resolved to nothing and the command that ran was not
    // the command the routine describes.
    const plan = planRoutineExecution(
      routine([{ id: 'publish', label: 'Publish', run: 'npm publish --tag ${channel}' }]),
      {},
    );

    expect(plan.status).toBe('refused');
    if (plan.status !== 'refused') { return; }
    expect(plan.refusals[0]!.rule).toBe('unresolved-placeholder');
  });

  it('runs when every placeholder is answered', () => {
    const plan = planRoutineExecution(
      routine([{ id: 'commit', label: 'Commit', run: 'git commit -m "${message}"' }]),
      { message: 'fix the thing' },
    );

    expect(plan.status).toBe('ready');
    if (plan.status !== 'ready') { return; }
    expect(plan.steps[0]!.command).toBe('git commit -m "fix the thing"');
  });
});

describe('the commands are decided once, so they can be shown', () => {
  it('carries the fully substituted command, not the template', () => {
    // The runner executes `step.command`. If the plan carried the template the
    // runner would have to substitute again, and a caller could show one
    // command and run another.
    const plan = planRoutineExecution(
      routine([{ id: 'tag', label: 'Tag', run: 'git tag v${version}' }]),
      { version: '1.2.3' },
    );

    if (plan.status !== 'ready') { throw new Error('expected a ready plan'); }
    expect(plan.steps[0]!.command).toBe('git tag v1.2.3');
    expect(plan.steps[0]!.command).not.toContain('${');
  });

  it('describes every command in order', () => {
    const plan = planRoutineExecution(
      routine([
        { id: 'test', label: 'Test', run: 'npm test' },
        { id: 'build', label: 'Build', run: 'npm run build' },
      ]),
      {},
    );

    expect(describeRoutinePlan(plan)).toBe('1. npm test\n2. npm run build');
  });

  it('says which commands leave the machine', () => {
    const plan = planRoutineExecution(
      routine([
        { id: 'test', label: 'Test', run: 'npm test' },
        { id: 'push', label: 'Push', run: 'git push origin main' },
      ]),
      {},
    );

    if (plan.status !== 'ready') { throw new Error('expected a ready plan'); }
    expect(plan.outward.map(step => step.stepId)).toEqual(['push']);
    expect(describeRoutinePlan(plan)).toContain('reach outside this machine');
  });

  it('does not claim anything leaves the machine when nothing does', () => {
    const plan = planRoutineExecution(routine([{ id: 'test', label: 'Test', run: 'npm test' }]), {});

    if (plan.status !== 'ready') { throw new Error('expected a ready plan'); }
    expect(plan.outward).toEqual([]);
    expect(describeRoutinePlan(plan)).not.toContain('outside this machine');
  });
});

describe('the structural value check still governs', () => {
  it.each([
    ['a separator', 'fix; rm -rf /'],
    ['a substitution', 'fix $(whoami)'],
    ['a line break', 'fix\nrm -rf /'],
    ['a pipe', 'fix | tee /etc/passwd'],
  ])('refuses %s in a substituted value', (_label, message) => {
    const plan = planRoutineExecution(
      routine([{ id: 'commit', label: 'Commit', run: 'git commit -m "${message}"' }]),
      { message },
    );

    expect(plan.status).toBe('refused');
    if (plan.status !== 'refused') { return; }
    expect(plan.refusals[0]!.rule).toBe('unsafe-value');
  });

  it('refuses before substituting, so the refused command is never built', () => {
    // `checkRoutineVariables` has already decided the run is refused. Carrying
    // on to look for further problems would mean assembling the command string
    // it just declined to assemble.
    const plan = planRoutineExecution(
      routine([
        { id: 'commit', label: 'Commit', run: 'git commit -m "${message}"' },
        { id: 'tag', label: 'Tag', run: 'git tag ${version}' },
      ]),
      { message: 'oops; rm -rf /' },
    );

    if (plan.status !== 'refused') { throw new Error('expected a refusal'); }
    expect(plan.refusals.every(refusal => refusal.rule === 'unsafe-value')).toBe(true);
    expect(JSON.stringify(plan)).not.toContain('rm -rf /');
  });
});

describe('a routine with nothing to run says so', () => {
  it('refuses an empty routine', () => {
    const plan = planRoutineExecution(routine([]), {});

    expect(plan.status).toBe('refused');
    if (plan.status !== 'refused') { return; }
    expect(plan.refusals[0]!.rule).toBe('no-steps');
  });

  it('refuses a blank command rather than reporting it as a success', () => {
    const plan = planRoutineExecution(routine([{ id: 'noop', label: 'Nothing', run: '   ' }]), {});

    expect(plan.status).toBe('refused');
    if (plan.status !== 'refused') { return; }
    expect(plan.refusals[0]!.rule).toBe('empty-command');
  });
});

describe('the rule table is published with the plan', () => {
  it('declares every rule a refusal can name', () => {
    // A surface must be able to explain the rule that refused, from the same
    // table that refused, rather than a copy that has drifted.
    const declared = new Set(ROUTINE_EXECUTION_RULES.map(rule => rule.id));
    const plans = [
      planRoutineExecution(routine([]), {}),
      planRoutineExecution(routine([{ id: 'a', label: 'A', run: '  ' }]), {}),
      planRoutineExecution(routine([{ id: 'b', label: 'B', run: 'git tag ${v}' }]), {}),
      planRoutineExecution(routine([{ id: 'c', label: 'C', run: 'echo "${m}"' }]), { m: 'a;b' }),
    ];

    const used = plans.flatMap(plan => plan.status === 'refused' ? plan.refusals.map(r => r.rule) : []);
    expect(used.length).toBeGreaterThan(0);
    expect([...new Set(used)].every(rule => declared.has(rule))).toBe(true);
  });
});

describe('placeholder extraction', () => {
  it('finds each name once, in first-seen order', () => {
    expect(routinePlaceholders('a ${x} b ${y} c ${x}')).toEqual(['x', 'y']);
  });

  it('reports nothing for a template with no placeholders', () => {
    expect(routinePlaceholders('npm test')).toEqual([]);
    expect(unresolvedRoutinePlaceholders('npm test', {})).toEqual([]);
  });
});
