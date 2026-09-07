import { describe, expect, it } from 'vitest';
import {
  REPRICING_CAVEAT,
  REPRICING_RULES,
  assessRepricing,
  recordsForWorkspace,
  summarizeRepricingCoverage,
} from '../../src/core/costRepricing.js';
import { normalizeWorkspaceKey } from '../../src/core/projectRunHistory.js';
import type { CostRecord } from '../../src/types.js';

function record(overrides: Partial<CostRecord> = {}): CostRecord {
  return {
    taskId: 'task-1',
    agentId: 'agent-1',
    model: 'anthropic/claude-sonnet-5',
    inputTokens: 1000,
    outputTokens: 200,
    costUsd: 0.01,
    timestamp: '2026-09-07T10:00:00.000Z',
    ...overrides,
  };
}

describe('a record is only repriceable when the cache split is known', () => {
  it('accepts a record reporting both halves of the split', () => {
    const assessment = assessRepricing(record({ cachedInputTokens: 800, cacheWriteTokens: 100 }));
    expect(assessment.eligibility).toBe('repriceable');
    expect(assessment.rule).toBe('complete');
  });

  it('accepts a genuine zero on either half, because the provider still spoke', () => {
    expect(assessRepricing(record({ cachedInputTokens: 0, cacheWriteTokens: 0 })).eligibility).toBe('repriceable');
    expect(assessRepricing(record({ cachedInputTokens: 900, cacheWriteTokens: 0 })).eligibility).toBe('repriceable');
  });

  /**
   * The rule that matters most. Defaulting an absent write count to zero would
   * price a cache-heavy request as though it wrote nothing, understating the
   * counterfactual in the direction that flatters us.
   */
  it('refuses a record whose provider reported no cache usage at all', () => {
    const assessment = assessRepricing(record());
    expect(assessment.eligibility).toBe('partial');
    expect(assessment.rule).toBe('cache-split-unreported');
  });

  it('refuses a record that predates cache-write capture, and names why', () => {
    const assessment = assessRepricing(record({ cachedInputTokens: 800 }));
    expect(assessment.eligibility).toBe('partial');
    expect(assessment.rule).toBe('predates-cache-write-field');
  });

  it('treats a record with no tokens at all as unusable rather than partial', () => {
    const assessment = assessRepricing(record({ inputTokens: 0, outputTokens: 0 }));
    expect(assessment.eligibility).toBe('unusable');
    expect(assessment.rule).toBe('no-token-counts');
  });

  it('never silently promotes an absent write count to zero', () => {
    const withoutWrite = record({ cachedInputTokens: 500 });
    const withExplicitZero = record({ cachedInputTokens: 500, cacheWriteTokens: 0 });
    expect(assessRepricing(withoutWrite).eligibility).not.toBe(
      assessRepricing(withExplicitZero).eligibility,
    );
  });

  it('every verdict names a rule that exists in the published table', () => {
    const ids = new Set(REPRICING_RULES.map(rule => rule.id));
    const samples = [
      record(),
      record({ cachedInputTokens: 1 }),
      record({ cachedInputTokens: 1, cacheWriteTokens: 1 }),
      record({ inputTokens: 0, outputTokens: 0 }),
    ];
    for (const sample of samples) {
      expect(ids.has(assessRepricing(sample).rule as never)).toBe(true);
    }
  });

  it('states the floor caveat rather than leaving it to the caller', () => {
    expect(REPRICING_CAVEAT).toMatch(/floor/i);
    expect(REPRICING_CAVEAT).toMatch(/more output/i);
  });
});

describe('coverage tells a surface how much it can stand behind', () => {
  it('separates none-yet from none-usable', () => {
    expect(summarizeRepricingCoverage([]).none).toBe(true);
    expect(summarizeRepricingCoverage([]).total).toBe(0);

    const legacy = summarizeRepricingCoverage([record(), record()]);
    expect(legacy.none).toBe(true);
    expect(legacy.total).toBe(2);
    expect(legacy.partial).toBe(2);
  });

  it('counts records that belong to no project', () => {
    const coverage = summarizeRepricingCoverage([
      record({ workspaceKey: '/repo/a' }),
      record(),
    ]);
    expect(coverage.unattributed).toBe(1);
  });
});

describe('workspace attribution never guesses', () => {
  it('returns only records carrying the requested key', () => {
    const mine = record({ workspaceKey: '/repo/a' });
    const theirs = record({ workspaceKey: '/repo/b' });
    expect(recordsForWorkspace([mine, theirs], '/repo/a')).toEqual([mine]);
  });

  /**
   * A record with no key came from some project on this machine and there is no
   * way to learn which. Adopting it into whichever workspace is open would put
   * another project's spend on this project's roadmap item.
   */
  it('excludes unattributed records rather than adopting them', () => {
    const orphan = record();
    expect(recordsForWorkspace([orphan], '/repo/a')).toEqual([]);
  });

  it('returns nothing for an empty key rather than everything', () => {
    expect(recordsForWorkspace([record({ workspaceKey: '/repo/a' })], '')).toEqual([]);
  });
});

/**
 * Cost records and run records are joined on this string. Two normalizers would
 * disagree about a trailing slash or a drive-letter case, the join would match
 * nothing, and every project would report as having cost zero — a failure that
 * looks like missing data rather than a broken key.
 */
describe('one workspace-key normalizer, shared', () => {
  it('folds separators and case so the same directory keys identically', () => {
    const a = normalizeWorkspaceKey('C:\\Repos\\AtlasMind');
    const b = normalizeWorkspaceKey('c:/repos/atlasmind');
    expect(a).toBe(b);
    expect(a).toBeTruthy();
  });

  it('treats blank and absent alike, and never returns an empty string', () => {
    expect(normalizeWorkspaceKey(undefined)).toBeUndefined();
    expect(normalizeWorkspaceKey('   ')).toBeUndefined();
  });
});
