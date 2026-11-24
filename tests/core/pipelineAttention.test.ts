import { describe, expect, it } from 'vitest';
import { PIPELINE_ATTENTION_RULES, derivePipelineAttention } from '../../src/core/pipelineAttention.ts';
import type { RequiredCheckGap } from '../../src/core/requiredCheckGap.ts';

function gap(number: number, overrides: Partial<RequiredCheckGap> = {}): RequiredCheckGap {
  return {
    number,
    baseBranch: 'dev',
    state: 'blocked-missing',
    missing: ['AtlasMind/local-ci'],
    failing: [],
    pending: [],
    localCiMissing: true,
    summary: `#${number} cannot merge`,
    ...overrides,
  };
}

const ready = { contract: 'enabled' as const, runnable: true, nextAction: 'review' as const, blockers: [], trustedBaseBranch: 'dev', folderName: 'JoelBondouxNet' };
const wrongBranch = { ...ready, runnable: false, nextAction: 'checkout-trusted-branch' as const, blockers: ['Check out the trusted base branch dev before lending this machine. The current branch is main.'] };
const tls = { kind: 'tls-inspection' as const, ruleId: 'tls-inspection', title: 'Something on this computer intercepts secure connections', body: 'Build a derived image.' };

describe('pipeline attention', () => {
  it('leads with a pull request blocked on the AtlasMind check and offers the run when the folder is ready', () => {
    const attention = derivePipelineAttention({ requiredCheckGaps: [gap(73), gap(74)], reviewedPr: ready });
    expect(attention.lead).toMatchObject({ rule: 'required-check-ready', action: 'review', pullRequests: [73, 74] });
    expect(attention.lead!.title).toContain('#73, #74 cannot merge');
    expect(attention.lead!.detail).toContain('on dev');
    expect(attention.items).toHaveLength(1);
  });

  it('offers the folder\'s own next step when it cannot run the check yet', () => {
    const attention = derivePipelineAttention({ requiredCheckGaps: [gap(73)], reviewedPr: wrongBranch });
    expect(attention.lead).toMatchObject({ rule: 'required-check-not-ready', action: 'checkout-trusted-branch', actionLabel: 'Check out the trusted branch…' });
    expect(attention.lead!.title).toContain('JoelBondouxNet cannot run it yet');
    expect(attention.lead!.detail).toContain('The current branch is main');
  });

  /** A blocked PR outranks a broken machine, which outranks an old failure. */
  it('ranks by consequence from the declared table, one lead', () => {
    const attention = derivePipelineAttention({
      requiredCheckGaps: [gap(80, { localCiMissing: false, missing: ['Lint'] }), gap(73)],
      reviewedPr: ready,
      runner: { lifecycle: 'failed', failureHint: tls },
      ciFailure: { classification: 'test-failure', jobName: 'unit', stepName: 'npm test' },
    });
    expect(attention.items.map(item => item.rule)).toEqual(['required-check-ready', 'required-check-other', 'runner-failed', 'ci-failure']);
    expect(attention.lead!.rule).toBe('required-check-ready');
    const ruleOrder = PIPELINE_ATTENTION_RULES.map(rule => rule.rule);
    const seen = attention.items.map(item => ruleOrder.indexOf(item.rule));
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  /** Empty when nothing needs you — no manufactured "all clear". */
  it('is empty when nothing is blocked, the runner is fine and no failure is classified', () => {
    expect(derivePipelineAttention({ requiredCheckGaps: [gap(1, { state: 'satisfied', missing: [], localCiMissing: false })], reviewedPr: ready })).toEqual({ items: [] });
    // An unknown runner cause is not a card: the runner card already shows it with the output.
    expect(derivePipelineAttention({ reviewedPr: ready, runner: { lifecycle: 'failed', failureHint: { ...tls, kind: 'unknown', ruleId: 'unknown' } } }).items).toEqual([]);
    expect(derivePipelineAttention({ reviewedPr: ready, runner: { lifecycle: 'ready', failureHint: tls } }).items).toEqual([]);
  });

  it('publishes the ranking it uses', () => {
    expect(PIPELINE_ATTENTION_RULES.map(rule => rule.rule)).toEqual(['required-check-ready', 'required-check-not-ready', 'required-check-other', 'runner-failed', 'ci-failure']);
  });
});
