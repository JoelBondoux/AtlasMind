import { describe, expect, it } from 'vitest';
import {
  describeCounterfactual,
  repriceRecord,
  summarizeCounterfactual,
  type ComparisonModelRates,
} from '../../src/core/counterfactualPricing.js';
import type { CostRecord } from '../../src/types.js';

/** A record with the full cache split, so it is repriceable. */
function record(overrides: Partial<CostRecord> = {}): CostRecord {
  return {
    taskId: 't', agentId: 'a', model: 'local/qwen',
    inputTokens: 10_000, outputTokens: 1_000,
    cachedInputTokens: 0, cacheWriteTokens: 0,
    costUsd: 0, timestamp: '2026-09-07T10:00:00.000Z',
    ...overrides,
  };
}

const FLAGSHIP: ComparisonModelRates = {
  modelId: 'anthropic/claude-opus-5',
  displayName: 'Claude Opus 5',
  inputPricePer1k: 0.015,
  outputPricePer1k: 0.075,
  cachedInputPricePer1k: 0.0015,
  cacheWritePricePer1k: 0.01875,
};

describe('the arithmetic', () => {
  it('prices the identical tokens at the comparison model', () => {
    const outcome = repriceRecord(record(), FLAGSHIP);
    expect(outcome.status).toBe('priced');
    if (outcome.status !== 'priced') { return; }
    // 10k input at 0.015/1k = 0.15; 1k output at 0.075/1k = 0.075
    expect(outcome.counterfactualUsd).toBeCloseTo(0.225);
  });

  it('preserves the cache split rather than pricing everything as plain input', () => {
    const outcome = repriceRecord(
      record({ inputTokens: 10_000, cachedInputTokens: 8_000, cacheWriteTokens: 1_000 }),
      FLAGSHIP,
    );
    expect(outcome.status).toBe('priced');
    if (outcome.status !== 'priced') { return; }
    // 1k plain @0.015 + 8k read @0.0015 + 1k write @0.01875 + 1k output @0.075
    expect(outcome.counterfactualUsd).toBeCloseTo(0.015 + 0.012 + 0.01875 + 0.075);
  });

  it('never lets a reported split exceed the input total and go negative', () => {
    const outcome = repriceRecord(
      record({ inputTokens: 1_000, cachedInputTokens: 900, cacheWriteTokens: 900 }),
      FLAGSHIP,
    );
    expect(outcome.status).toBe('priced');
    if (outcome.status !== 'priced') { return; }
    expect(outcome.counterfactualUsd).toBeGreaterThan(0);
  });
});

/**
 * Almost all the value of this module is in the refusals. Every fallback
 * available here errs in our favour, which is why there is none.
 */
describe('refusals', () => {
  it('refuses a record without the full cache split', () => {
    const outcome = repriceRecord(
      { ...record(), cachedInputTokens: undefined, cacheWriteTokens: undefined },
      FLAGSHIP,
    );
    expect(outcome.status).toBe('refused');
    if (outcome.status !== 'refused') { return; }
    expect(outcome.rule).toBe('not-repriceable');
  });

  it('refuses a record whose actual model had no price', () => {
    const outcome = repriceRecord(record({ unpriced: true }), FLAGSHIP);
    expect(outcome.status).toBe('refused');
    if (outcome.status !== 'refused') { return; }
    expect(outcome.rule).toBe('unpriced-actual');
  });

  it('refuses cache reads when the comparison model has no cache-read rate', () => {
    const { cachedInputPricePer1k: _drop, ...withoutRead } = FLAGSHIP;
    const outcome = repriceRecord(record({ cachedInputTokens: 500 }), withoutRead);
    expect(outcome.status).toBe('refused');
    if (outcome.status !== 'refused') { return; }
    expect(outcome.rule).toBe('no-cache-read-rate');
  });

  it('refuses cache writes when the comparison model has no cache-write rate', () => {
    const { cacheWritePricePer1k: _drop, ...withoutWrite } = FLAGSHIP;
    const outcome = repriceRecord(record({ cacheWriteTokens: 500 }), withoutWrite);
    expect(outcome.status).toBe('refused');
    if (outcome.status !== 'refused') { return; }
    expect(outcome.rule).toBe('no-cache-write-rate');
  });

  it('still prices a record with no cache usage against a model lacking cache rates', () => {
    const { cachedInputPricePer1k: _a, cacheWritePricePer1k: _b, ...bare } = FLAGSHIP;
    expect(repriceRecord(record(), bare).status).toBe('priced');
  });
});

describe('the summary compares like with like', () => {
  it('excludes refused records from both totals, not just one', () => {
    const summary = summarizeCounterfactual(
      [
        record({ costUsd: 0.01 }),
        { ...record({ costUsd: 99 }), cachedInputTokens: undefined, cacheWriteTokens: undefined },
      ],
      FLAGSHIP,
    );
    expect(summary.pricedCount).toBe(1);
    // The £99 record is excluded from the actual side too, or the comparison
    // would be one record's counterfactual against two records' spend.
    expect(summary.actualUsd).toBeCloseTo(0.01);
    expect(summary.refusedCounts['not-repriceable']).toBe(1);
  });

  it('reports a saving against a named model', () => {
    const summary = summarizeCounterfactual([record({ costUsd: 0.02 })], FLAGSHIP);
    expect(summary.comparisonModelName).toBe('Claude Opus 5');
    expect(summary.savedUsd).toBeCloseTo(0.225 - 0.02);
    expect(summary.savedFraction).toBeGreaterThan(0.9);
  });

  /**
   * Clamping a negative at zero would turn a loss into a wash — the one
   * arithmetic choice that makes the headline a lie rather than an overstatement.
   */
  it('reports a negative saving as negative rather than clamping it', () => {
    const summary = summarizeCounterfactual([record({ costUsd: 5 })], FLAGSHIP);
    expect(summary.savedUsd).toBeLessThan(0);
    expect(describeCounterfactual(summary)).toMatch(/cost .* more/);
  });

  it('has no figure at all when nothing could be priced', () => {
    const summary = summarizeCounterfactual(
      [{ ...record(), cachedInputTokens: undefined, cacheWriteTokens: undefined }],
      FLAGSHIP,
    );
    expect(summary.hasFigure).toBe(false);
    expect(summary.savedFraction).toBeUndefined();
    expect(describeCounterfactual(summary)).toMatch(/No spend could be compared/);
  });

  it('has no figure for an empty history, rather than a zero saving', () => {
    expect(summarizeCounterfactual([], FLAGSHIP).hasFigure).toBe(false);
  });
});

describe('what is shown beside the number', () => {
  it('always names the comparison model and carries the floor caveat', () => {
    const sentence = describeCounterfactual(summarizeCounterfactual([record({ costUsd: 0.02 })], FLAGSHIP));
    expect(sentence).toContain('Claude Opus 5');
    expect(sentence).toMatch(/floor/i);
    expect(sentence).toMatch(/more output/i);
  });

  it('says how much of the history the figure does not speak for', () => {
    const sentence = describeCounterfactual(summarizeCounterfactual(
      [
        record({ costUsd: 0.02 }),
        { ...record(), cachedInputTokens: undefined, cacheWriteTokens: undefined },
      ],
      FLAGSHIP,
    ));
    expect(sentence).toMatch(/1 could not be compared/);
  });
});
