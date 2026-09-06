import { describe, expect, it } from 'vitest';
import {
  RUN_CONFORMANCE_RULES,
  assessRunConformance,
  assessRunGoalConformance,
  describeRunGoalConformance,
  statesIntentWithoutDoing,
  type RunConformanceInput,
} from '../../src/core/runGoalConformance.ts';

const unit = (overrides: Partial<RunConformanceInput> = {}): RunConformanceInput => ({
  id: 'sub-1',
  title: 'Implement Stage 1 hardening',
  output: 'Done. Updated the branch derivation and added two tests.',
  toolCallCount: 0,
  changedFileCount: 0,
  ...overrides,
});

describe('the observed failure', () => {
  // The run that prompted this module ended with exactly this sentence, no diff
  // and no verification, and was reported as a completed phase.
  const observed = 'You\'re right. I have enough information to act. I will now edit README.md to fix the test failure.';

  it('grades a promise with no evidence as stated intent', () => {
    expect(assessRunConformance(unit({ output: observed }))).toMatchObject({
      verdict: 'stated-intent',
      rule: 'promise-without-evidence',
    });
  });

  it('does not grade the same sentence as intent when work is evidenced', () => {
    // "I will now run the tests" after changing six files describes what comes
    // next. It is only a substitute for work when nothing else happened.
    expect(assessRunConformance(unit({ output: observed, changedFileCount: 6 }))).toMatchObject({
      verdict: 'evidenced',
      rule: 'files-changed',
    });
  });
});

describe('unknown is never zero', () => {
  it('reports an unobservable unit as unassessed rather than as having done nothing', () => {
    // An ACP subtask runs its tools inside the agent's own session, so AtlasMind
    // sees no tool calls. Counting that as zero would report every
    // subscription-backed run as having done nothing.
    const acp = { id: 'sub-1', title: 'Draft the plan', output: 'I will now write the plan.' };
    expect(assessRunConformance(acp)).toMatchObject({
      verdict: 'unassessed',
      rule: 'not-observable',
    });
  });

  it('assesses as soon as any one channel is observable', () => {
    expect(assessRunConformance({
      id: 'sub-1',
      title: 'Draft the plan',
      output: 'I will now write the plan.',
      changedFileCount: 0,
    }).verdict).toBe('stated-intent');
  });

  it('treats an empty run as unassessed, never as evidenced', () => {
    expect(assessRunGoalConformance([]).verdict).toBe('unassessed');
  });
});

describe('evidence outranks wording', () => {
  it.each([
    ['a changed file', { changedFileCount: 1 }, 'files-changed'],
    ['a tool call', { toolCallCount: 3 }, 'tools-ran'],
    ['a verification summary', { verificationSummary: '12 tests passed' }, 'verification-recorded'],
  ])('%s evidences the unit', (_label, evidence, rule) => {
    expect(assessRunConformance(unit({ output: 'Let me start on that.', ...evidence }))).toMatchObject({
      verdict: 'evidenced',
      rule,
    });
  });

  it('a blank verification summary is not evidence', () => {
    expect(assessRunConformance(unit({ output: 'Nothing needed changing.', verificationSummary: '   ' })).verdict)
      .toBe('no-evidence');
  });
});

describe('no-evidence is a notice, not an accusation', () => {
  it('keeps an evidence-free report distinct from a promise', () => {
    // A research or review subtask legitimately changes no files. Collapsing the
    // two would make the actionable signal permanently non-zero.
    expect(assessRunConformance(unit({ output: 'The endpoint is already covered by two contract tests.' })))
      .toMatchObject({ verdict: 'no-evidence', rule: 'answered-without-evidence' });
  });

  it('excludes it from the actionable set', () => {
    const report = assessRunGoalConformance([unit({ output: 'No change was needed here.' })]);
    expect(report.statedIntent).toHaveLength(0);
    expect(describeRunGoalConformance(report)).toBeUndefined();
  });
});

describe('promise detection', () => {
  it.each([
    'I will now edit README.md',
    "I'll update the router next",
    'Let me check the failing test',
    'Now I will refactor the adapter',
    "Okay, I'm going to start with the branch naming",
    'Next, I will add the missing gate',
  ])('%s reads as a promise', text => {
    expect(statesIntentWithoutDoing(text)).toBe(true);
  });

  it.each([
    'Updated the router and added a test for the failover path.',
    'The gate already refuses an unknown stage, so nothing changed.',
    'Two tests failed; the assertion expects a trailing slash the server does not send.',
    'What should I write next?',
  ])('%s does not read as a promise', text => {
    expect(statesIntentWithoutDoing(text)).toBe(false);
  });
});

describe('the run-level reading', () => {
  it('takes the worst verdict present and names every promising subtask', () => {
    const report = assessRunGoalConformance([
      unit({ id: 'a', title: 'Baseline', changedFileCount: 2 }),
      unit({ id: 'b', title: 'Stage 1 hardening', output: 'I will now edit README.md.' }),
      unit({ id: 'c', title: 'Stage 2 hardening', output: 'Let me start on that.' }),
    ]);
    expect(report.verdict).toBe('stated-intent');
    expect(report.statedIntent.map(item => item.id)).toEqual(['b', 'c']);
    expect(describeRunGoalConformance(report)).toContain('Stage 1 hardening');
    expect(describeRunGoalConformance(report)).toContain('Stage 2 hardening');
  });

  it('publishes the rules that graded it', () => {
    expect(assessRunGoalConformance([unit()]).rules).toBe(RUN_CONFORMANCE_RULES);
  });

  it('names a rule for every assessment', () => {
    const declared = new Set(RUN_CONFORMANCE_RULES.map(rule => rule.id));
    const report = assessRunGoalConformance([
      unit({ id: 'a', output: 'I will now do it.' }),
      unit({ id: 'b', changedFileCount: 1 }),
      { id: 'c', title: 'Opaque', output: 'anything' },
    ]);
    for (const assessment of report.assessments) {
      expect(declared).toContain(assessment.rule);
      const rule = RUN_CONFORMANCE_RULES.find(item => item.id === assessment.rule);
      expect(rule?.verdict).toBe(assessment.verdict);
    }
  });
});
