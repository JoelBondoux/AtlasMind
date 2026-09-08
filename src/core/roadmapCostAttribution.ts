/**
 * What each roadmap item cost, and how much of the spend belongs to nothing.
 *
 * The join nobody in the market has: an issue tracker cannot see tokens, a cost
 * tracker cannot see a plan. AtlasMind holds both, and this is where they meet.
 *
 * Four rules.
 *
 * **Nothing here distributes unattributed spend.** Money that cannot be tied to
 * an item is reported as its own figure, never spread across items pro rata to
 * make the totals look complete. A spread number is indistinguishable from a
 * measured one once it is on screen, and it would make every item's cost wrong
 * in a way no reader could detect.
 *
 * **No spend attributed is not zero spend.** An item nobody has worked on and an
 * item whose work predates attribution both show no money; only one of them was
 * free. `hasAttributedSpend` separates them so a surface can say "nothing
 * recorded yet" rather than printing `$0.00`, which reads as *this was free* —
 * the single most misleading thing this feature could display.
 *
 * **Attribution carries its provenance.** `session` means the work began from an
 * item and the whole chat session inherited it, which is right almost always and
 * wrong if somebody wandered onto something else. The counts travel with the
 * total so a surface can show that a figure is inferred, and a reader who thinks
 * it is wrong can see why.
 *
 * **Estimates and actuals are compared only when both exist.** An item with no
 * estimate has no variance — not a variance of zero, and not "over budget".
 *
 * Pure: no `vscode`, no `fs`, no clock.
 */

import type { CostRecord } from '../types.js';

export interface RoadmapItemCost {
  roadmapItemId: string;
  /** Actual USD attributed to this item. */
  costUsd: number;
  /** Requests attributed to it, so a total of a handful of calls is visible as such. */
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  /**
   * How the attribution was reached, counted rather than collapsed.
   *
   * A total that is entirely `session`-inferred deserves a different presentation
   * from one somebody stated outright, and a caller cannot tell the difference
   * from a single number.
   */
  inferredRequestCount: number;
  explicitRequestCount: number;
  /**
   * Requests whose model had no known price.
   *
   * Their `costUsd` is a placeholder zero, so a total including them understates
   * real spend by an unknown amount. Counted rather than excluded: dropping them
   * would understate the *request* count too, and the honest statement is "this
   * cost £X across N requests, M of which could not be priced".
   */
  unpricedRequestCount: number;
}

export interface RoadmapCostReport {
  items: readonly RoadmapItemCost[];
  /**
   * Spend belonging to no item. Reported, never distributed.
   *
   * On a project that has only just switched attribution on, this is most of the
   * money — which is the honest picture, and hiding it inside item totals would
   * turn a known unknown into several invented certainties.
   */
  unattributedCostUsd: number;
  unattributedRequestCount: number;
  totalCostUsd: number;
}

/** Group attributed spend by item. Ordering is by cost, descending, ties by id so it cannot shuffle. */
export function buildRoadmapCostReport(records: readonly CostRecord[]): RoadmapCostReport {
  const byItem = new Map<string, RoadmapItemCost>();
  let unattributedCostUsd = 0;
  let unattributedRequestCount = 0;
  let totalCostUsd = 0;

  for (const record of records) {
    totalCostUsd += record.costUsd;
    const itemId = record.roadmapItemId;
    if (!itemId) {
      unattributedCostUsd += record.costUsd;
      unattributedRequestCount += 1;
      continue;
    }

    const existing = byItem.get(itemId) ?? {
      roadmapItemId: itemId,
      costUsd: 0,
      requestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      inferredRequestCount: 0,
      explicitRequestCount: 0,
      unpricedRequestCount: 0,
    };
    existing.costUsd += record.costUsd;
    existing.requestCount += 1;
    if (record.unpriced) { existing.unpricedRequestCount += 1; }
    existing.inputTokens += record.inputTokens;
    existing.outputTokens += record.outputTokens;
    // An unknown provenance is counted as inferred rather than explicit: the
    // weaker claim is the safe one when a record does not say.
    if (record.roadmapAttribution === 'explicit') {
      existing.explicitRequestCount += 1;
    } else {
      existing.inferredRequestCount += 1;
    }
    byItem.set(itemId, existing);
  }

  const items = [...byItem.values()].sort((left, right) =>
    right.costUsd - left.costUsd || left.roadmapItemId.localeCompare(right.roadmapItemId));

  return { items, unattributedCostUsd, unattributedRequestCount, totalCostUsd };
}

export interface RoadmapItemSpendView {
  roadmapItemId: string;
  /**
   * False when nothing has been attributed.
   *
   * The distinction the whole surface rests on: an item nobody has worked on and
   * an item whose work predates attribution both show no money, and only one of
   * them was free. A caller must render "nothing recorded yet" rather than
   * `$0.00` when this is false.
   */
  hasAttributedSpend: boolean;
  costUsd: number;
  requestCount: number;
  /** True when every attributed request was inferred from a session rather than stated. */
  whollyInferred: boolean;
  /**
   * Requests counted here whose model had no known price.
   *
   * Non-zero means `costUsd` is a floor: real spend is higher by an unknown
   * amount, and a surface must say so rather than present the figure as
   * complete.
   */
  unpricedRequestCount: number;
  /** Present only when the item carries an estimate. */
  estimateUsd?: number;
  /** Actual minus estimate. Present only when both exist; absent is not zero. */
  varianceUsd?: number;
  /** True only when an estimate exists and has been exceeded. */
  overEstimate?: boolean;
}

/**
 * One item's spend, ready to render.
 *
 * `estimateUsd` is optional because most items have no cost estimate, and an
 * absent estimate must not become a zero one — that would report every
 * unestimated item as being over budget the moment it costs anything.
 */
export function roadmapItemSpendView(
  report: RoadmapCostReport,
  roadmapItemId: string,
  estimateUsd?: number,
): RoadmapItemSpendView {
  const found = report.items.find(item => item.roadmapItemId === roadmapItemId);
  const costUsd = found?.costUsd ?? 0;
  const requestCount = found?.requestCount ?? 0;
  const hasEstimate = typeof estimateUsd === 'number' && Number.isFinite(estimateUsd) && estimateUsd > 0;

  return {
    roadmapItemId,
    hasAttributedSpend: requestCount > 0,
    costUsd,
    requestCount,
    whollyInferred: requestCount > 0 && (found?.explicitRequestCount ?? 0) === 0,
    unpricedRequestCount: found?.unpricedRequestCount ?? 0,
    ...(hasEstimate ? { estimateUsd } : {}),
    ...(hasEstimate && requestCount > 0
      ? { varianceUsd: costUsd - estimateUsd, overEstimate: costUsd > estimateUsd }
      : {}),
  };
}

/**
 * The share of spend that could be attributed at all, 0–1.
 *
 * `undefined` when there is no spend, because 0/0 is not "nothing attributed" —
 * it is a project that has not spent anything, and rendering 0% would report a
 * fresh install as an attribution failure.
 */
export function attributionCoverage(report: RoadmapCostReport): number | undefined {
  if (report.totalCostUsd <= 0) { return undefined; }
  const attributed = report.totalCostUsd - report.unattributedCostUsd;
  return Math.max(0, Math.min(1, attributed / report.totalCostUsd));
}
