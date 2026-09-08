import { describe, expect, it } from 'vitest';
import {
  attributionCoverage,
  buildRoadmapCostReport,
  roadmapItemSpendView,
} from '../../src/core/roadmapCostAttribution.js';
import type { CostRecord } from '../../src/types.js';

function record(overrides: Partial<CostRecord> = {}): CostRecord {
  return {
    taskId: 'task-1',
    agentId: 'agent-1',
    model: 'anthropic/claude-sonnet-5',
    inputTokens: 1000,
    outputTokens: 200,
    costUsd: 1,
    timestamp: '2026-09-07T10:00:00.000Z',
    ...overrides,
  };
}

describe('spend groups by roadmap item', () => {
  it('totals cost, requests and tokens per item', () => {
    const report = buildRoadmapCostReport([
      record({ roadmapItemId: 'a', costUsd: 2 }),
      record({ roadmapItemId: 'a', costUsd: 3 }),
      record({ roadmapItemId: 'b', costUsd: 1 }),
    ]);
    expect(report.items.map(item => item.roadmapItemId)).toEqual(['a', 'b']);
    expect(report.items[0]?.costUsd).toBe(5);
    expect(report.items[0]?.requestCount).toBe(2);
    expect(report.items[0]?.inputTokens).toBe(2000);
  });

  it('orders by cost and breaks ties on id so the list cannot shuffle', () => {
    const report = buildRoadmapCostReport([
      record({ roadmapItemId: 'zebra', costUsd: 5 }),
      record({ roadmapItemId: 'alpha', costUsd: 5 }),
    ]);
    expect(report.items.map(item => item.roadmapItemId)).toEqual(['alpha', 'zebra']);
  });

  /**
   * The rule that keeps every item's number honest. Spreading unattributed
   * spend across items would make each one wrong in a way no reader could
   * detect, because a distributed figure looks exactly like a measured one.
   */
  it('reports unattributed spend separately and never distributes it', () => {
    const report = buildRoadmapCostReport([
      record({ roadmapItemId: 'a', costUsd: 2 }),
      record({ costUsd: 8 }),
    ]);
    expect(report.items).toHaveLength(1);
    expect(report.items[0]?.costUsd).toBe(2);
    expect(report.unattributedCostUsd).toBe(8);
    expect(report.unattributedRequestCount).toBe(1);
    expect(report.totalCostUsd).toBe(10);
  });

  it('counts inferred and explicit attribution separately', () => {
    const report = buildRoadmapCostReport([
      record({ roadmapItemId: 'a', roadmapAttribution: 'session' }),
      record({ roadmapItemId: 'a', roadmapAttribution: 'explicit' }),
    ]);
    expect(report.items[0]?.inferredRequestCount).toBe(1);
    expect(report.items[0]?.explicitRequestCount).toBe(1);
  });

  it('counts an unstated provenance as inferred, taking the weaker claim', () => {
    const report = buildRoadmapCostReport([record({ roadmapItemId: 'a' })]);
    expect(report.items[0]?.inferredRequestCount).toBe(1);
    expect(report.items[0]?.explicitRequestCount).toBe(0);
  });
});

describe('an item with no attributed spend is not an item that was free', () => {
  it('separates nothing-recorded from zero', () => {
    const report = buildRoadmapCostReport([record({ roadmapItemId: 'a', costUsd: 4 })]);

    const worked = roadmapItemSpendView(report, 'a');
    expect(worked.hasAttributedSpend).toBe(true);
    expect(worked.costUsd).toBe(4);

    const untouched = roadmapItemSpendView(report, 'b');
    expect(untouched.hasAttributedSpend).toBe(false);
    expect(untouched.costUsd).toBe(0);
  });

  it('marks a total that was entirely inferred', () => {
    const report = buildRoadmapCostReport([
      record({ roadmapItemId: 'a', roadmapAttribution: 'session' }),
    ]);
    expect(roadmapItemSpendView(report, 'a').whollyInferred).toBe(true);
  });
});

describe('estimates are compared only when they exist', () => {
  it('omits variance entirely when there is no estimate', () => {
    const report = buildRoadmapCostReport([record({ roadmapItemId: 'a', costUsd: 9 })]);
    const view = roadmapItemSpendView(report, 'a');
    expect(view.estimateUsd).toBeUndefined();
    expect(view.varianceUsd).toBeUndefined();
    expect(view.overEstimate).toBeUndefined();
  });

  it('reports variance and over-estimate when both sides exist', () => {
    const report = buildRoadmapCostReport([record({ roadmapItemId: 'a', costUsd: 9 })]);
    const view = roadmapItemSpendView(report, 'a', 5);
    expect(view.varianceUsd).toBe(4);
    expect(view.overEstimate).toBe(true);
  });

  /**
   * An unestimated item must never read as over budget the moment it costs
   * anything, which is what defaulting a missing estimate to zero would do.
   */
  it('never treats a missing estimate as zero', () => {
    const report = buildRoadmapCostReport([record({ roadmapItemId: 'a', costUsd: 9 })]);
    expect(roadmapItemSpendView(report, 'a', 0).overEstimate).toBeUndefined();
    expect(roadmapItemSpendView(report, 'a', undefined).overEstimate).toBeUndefined();
  });

  it('does not claim an item is under estimate before any spend is attributed', () => {
    const report = buildRoadmapCostReport([]);
    const view = roadmapItemSpendView(report, 'a', 50);
    expect(view.hasAttributedSpend).toBe(false);
    expect(view.varianceUsd).toBeUndefined();
  });
});

/**
 * A model the catalog does not price records `costUsd: 0`. That is
 * indistinguishable from a genuinely free local model, so the zero has to travel
 * with the fact that it was never priced — otherwise real spend reports as free.
 */
describe('unpriced requests are counted, not hidden in a zero', () => {
  it('counts them per item', () => {
    const report = buildRoadmapCostReport([
      record({ roadmapItemId: 'a', costUsd: 5 }),
      record({ roadmapItemId: 'a', costUsd: 0, unpriced: true }),
    ]);
    expect(report.items[0]?.requestCount).toBe(2);
    expect(report.items[0]?.unpricedRequestCount).toBe(1);
    expect(report.items[0]?.costUsd).toBe(5);
  });

  it('surfaces the count on the item view, so a total can be marked as a floor', () => {
    const report = buildRoadmapCostReport([record({ roadmapItemId: 'a', costUsd: 0, unpriced: true })]);
    const view = roadmapItemSpendView(report, 'a');
    expect(view.hasAttributedSpend).toBe(true);
    expect(view.unpricedRequestCount).toBe(1);
  });

  it('is zero for an item whose requests were all priced', () => {
    const report = buildRoadmapCostReport([record({ roadmapItemId: 'a', costUsd: 3 })]);
    expect(roadmapItemSpendView(report, 'a').unpricedRequestCount).toBe(0);
  });
});

describe('attribution coverage', () => {
  it('is undefined when nothing has been spent, rather than 0%', () => {
    expect(attributionCoverage(buildRoadmapCostReport([]))).toBeUndefined();
  });

  it('reports the attributed share of real spend', () => {
    const report = buildRoadmapCostReport([
      record({ roadmapItemId: 'a', costUsd: 3 }),
      record({ costUsd: 1 }),
    ]);
    expect(attributionCoverage(report)).toBeCloseTo(0.75);
  });
});
