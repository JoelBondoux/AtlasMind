import type { RoadmapGraph, RoadmapGraphNode } from './roadmapGraph.js';

/**
 * Which chain of work decides when the plan lands, and what has room to slip.
 *
 * The roadmap already answers two questions and not this one. An ordered list
 * says *this matters more than that*; the dependency graph says *this cannot
 * start until that lands*. Neither says **which chain the finish date actually
 * depends on** — and without it a backlog can be correctly prioritised,
 * correctly sequenced, and still have everybody working on the items that were
 * never going to be the constraint.
 *
 * Five rules.
 *
 * **Only outstanding work is on the path.** Completed prerequisites are drawn on
 * the canvas because they explain how you got here; they take no time, so
 * including them would make a forecast out of a history lesson.
 *
 * **The finish is the longest chain, never the sum.** Work that can run in
 * parallel does. Adding estimates up is the mistake this module exists to stop
 * somebody making by hand, and it always errs pessimistic, which is the
 * direction people stop believing.
 *
 * **Slack is measured against the plan's own finish, never a deadline.**
 * `describeRoadmapSchedule` already grades a node against its deadline and says
 * so. A slack figure that quietly folded a deadline in would be a number meaning
 * two things, and neither surface could then say which.
 *
 * **A plan with a cycle has no finish date.** It is reported as circular rather
 * than given a number, because the items in the loop are the finding — the same
 * call `resolveRoadmapGraph` already makes when it names a cycle instead of
 * breaking it.
 *
 * **Nothing outstanding is not a zero-day plan.** An empty backlog and a backlog
 * whose work takes no time are different statements, and a surface rendering
 * "0 days" for the first would be congratulating you on the wrong thing.
 *
 * The forward pass is **not recomputed**: every node already carries
 * `schedule.routeDays`, the longest run of outstanding work into it, and a
 * second implementation of the same walk would eventually disagree with the
 * number printed on the card beside it. Pure — no clock, no `fs`, no model.
 */

export type RoadmapCriticalPathRuleId =
  | 'outstanding-only'
  | 'longest-chain'
  | 'slack-against-the-plan'
  | 'circular-has-no-finish'
  | 'nothing-outstanding';

export interface RoadmapCriticalPathRule {
  id: RoadmapCriticalPathRuleId;
  description: string;
}

/** Published with every result, so a surface shows the rules that graded it. */
export const ROADMAP_CRITICAL_PATH_RULES: readonly RoadmapCriticalPathRule[] = [
  {
    id: 'outstanding-only',
    description: 'Delivered work takes no time, so it is never on the path. It stays on the canvas because it explains how you got here.',
  },
  {
    id: 'longest-chain',
    description: 'The finish is the longest chain of work that has to happen in order — not the total of every estimate, because independent work runs at the same time.',
  },
  {
    id: 'slack-against-the-plan',
    description: 'Slack is how long an item can slip before the plan\'s own finish moves. It says nothing about that item\'s deadline, which its card grades separately.',
  },
  {
    id: 'circular-has-no-finish',
    description: 'A plan with a circular dependency cannot run, so it has no finish date. The items in the loop are the finding.',
  },
  {
    id: 'nothing-outstanding',
    description: 'Nothing left to do is reported as nothing left to do, never as a plan that takes no time.',
  },
];

export type RoadmapCriticalPathState = 'ok' | 'nothing-outstanding' | 'circular';

export interface RoadmapSlackEntry {
  nodeId: string;
  /** Days this can slip before the plan's finish moves. `0` means it is on the path. */
  slackDays: number;
  /** Soonest this can be finished, counting every outstanding prerequisite. */
  earliestFinishDays: number;
  /** Latest it can finish without moving the plan's finish. */
  latestFinishDays: number;
  /** True when slack is zero — carried so a renderer need not compare floats. */
  critical: boolean;
}

export interface RoadmapCriticalPath {
  state: RoadmapCriticalPathState;
  /** Days to the plan's finish along the longest chain. Absent unless `ok`. */
  days?: number;
  /** The chain, in the order it can be worked. Empty unless `ok`. */
  nodeIds: string[];
  /** Every outstanding node, most constrained first. */
  slack: RoadmapSlackEntry[];
  /** How many outstanding items are not on the path — what the plan has room in. */
  offPathCount: number;
  rules: readonly RoadmapCriticalPathRule[];
  /** Why there is no path, when there is not. Absent when `ok`. */
  note?: string;
}

/**
 * Estimates and route days are all multiples of half a day, so the arithmetic
 * is done in half-days as integers.
 *
 * Not fussiness: the whole result turns on `slack === 0`, and a comparison of
 * accumulated floating-point sums is exactly the kind of thing that puts an
 * item on the path on one machine and not on another.
 */
function toHalfDays(days: number): number {
  return Math.round(days * 2);
}

function fromHalfDays(halfDays: number): number {
  return halfDays / 2;
}

/**
 * The chain the finish date rests on, and the slack everywhere else.
 *
 * Forward pass reused from `schedule.routeDays`; backward pass walks dependents
 * in reverse depth order, which a layered DAG guarantees is a valid order.
 */
export function roadmapCriticalPath(graph: RoadmapGraph): RoadmapCriticalPath {
  const base = {
    nodeIds: [] as string[],
    slack: [] as RoadmapSlackEntry[],
    offPathCount: 0,
    rules: ROADMAP_CRITICAL_PATH_RULES,
  };

  if (graph.cycles.length > 0) {
    const count = graph.cycles.length;
    return {
      ...base,
      state: 'circular',
      note: `This plan has ${count} circular dependenc${count === 1 ? 'y' : 'ies'}, so it has no finish date. `
        + 'Break the loop and the path can be worked out.',
    };
  }

  const outstanding = graph.nodes.filter(node => !node.completed);
  if (outstanding.length === 0) {
    return {
      ...base,
      state: 'nothing-outstanding',
      note: graph.nodes.length === 0
        ? 'There is nothing on the roadmap yet.'
        : 'Every item on the roadmap is delivered.',
    };
  }

  const outstandingIds = new Set(outstanding.map(node => node.id));
  const byId = new Map(outstanding.map(node => [node.id, node]));
  const own = new Map(outstanding.map(node => [node.id, toHalfDays(node.estimate.days)]));
  // Reused, never recomputed: this is the number already printed on the card.
  const earliest = new Map(outstanding.map(node => [node.id, toHalfDays(node.schedule.routeDays)]));

  const finish = Math.max(...outstanding.map(node => earliest.get(node.id) ?? 0));

  // Deepest first. Every edge runs from a lower depth to a higher one in a
  // layered DAG, so a node is always reached after every dependent that
  // constrains it.
  const reverseDepthOrder = [...outstanding].sort((left, right) => right.depth - left.depth
    || left.id.localeCompare(right.id));

  const latest = new Map<string, number>();
  for (const node of reverseDepthOrder) {
    let bound = finish;
    for (const dependentId of node.dependents) {
      // A delivered dependent imposes nothing: it is not waiting on this.
      if (!outstandingIds.has(dependentId)) {
        continue;
      }
      const dependentLatest = latest.get(dependentId);
      if (dependentLatest === undefined) {
        continue;
      }
      bound = Math.min(bound, dependentLatest - (own.get(dependentId) ?? 0));
    }
    latest.set(node.id, bound);
  }

  const slack: RoadmapSlackEntry[] = outstanding.map(node => {
    const earliestFinish = earliest.get(node.id) ?? 0;
    const latestFinish = latest.get(node.id) ?? finish;
    // Clamped at zero. A negative figure can only come from a graph that
    // disagrees with itself, and reporting "-1 days of slack" would send
    // somebody looking for a scheduling subtlety that is really a data fault.
    const slackHalf = Math.max(0, latestFinish - earliestFinish);
    return {
      nodeId: node.id,
      slackDays: fromHalfDays(slackHalf),
      earliestFinishDays: fromHalfDays(earliestFinish),
      latestFinishDays: fromHalfDays(latestFinish),
      critical: slackHalf === 0,
    };
  });

  const nodeOrder = orderForReading(byId);
  slack.sort((left, right) => left.slackDays - right.slackDays
    || left.earliestFinishDays - right.earliestFinishDays
    || (nodeOrder.get(left.nodeId) ?? 0) - (nodeOrder.get(right.nodeId) ?? 0));

  const nodeIds = slack
    .filter(entry => entry.critical)
    .sort((left, right) => left.earliestFinishDays - right.earliestFinishDays
      || (nodeOrder.get(left.nodeId) ?? 0) - (nodeOrder.get(right.nodeId) ?? 0))
    .map(entry => entry.nodeId);

  return {
    state: 'ok',
    days: fromHalfDays(finish),
    nodeIds,
    slack,
    offPathCount: slack.length - nodeIds.length,
    rules: ROADMAP_CRITICAL_PATH_RULES,
  };
}

/**
 * A stable order for ties, matching what `roadmapRouteTo` reads by: shallower
 * first, then the backlog's own priority, then id. Two identical renders must
 * not disagree about which of two equal items comes first.
 */
function orderForReading(byId: ReadonlyMap<string, RoadmapGraphNode>): Map<string, number> {
  const ordered = [...byId.values()].sort((left, right) => left.depth - right.depth
    || right.priorityScore - left.priorityScore
    || left.id.localeCompare(right.id));
  return new Map(ordered.map((node, index) => [node.id, index]));
}

/**
 * What to tell somebody about the path, or why there is not one.
 *
 * Never empty — unlike a delta or an attention feed, this answers a question
 * that was asked, and a card that renders nothing when you have opened it looks
 * broken rather than quiet.
 */
export function describeRoadmapCriticalPath(path: RoadmapCriticalPath): string {
  if (path.state !== 'ok' || path.days === undefined) {
    return path.note ?? 'No critical path could be worked out.';
  }
  const items = path.nodeIds.length;
  const chain = `${path.days} day${path.days === 1 ? '' : 's'} of work along a chain of `
    + `${items} item${items === 1 ? '' : 's'}`;
  if (path.offPathCount === 0) {
    // Everything is on the path, which is worth saying plainly: it means the
    // plan is one queue and nothing can be reordered to bring the date in.
    return `${chain}. Every outstanding item is on it, so nothing here has room to slip.`;
  }
  return `${chain}. The other ${path.offPathCount} outstanding item${path.offPathCount === 1 ? ' has' : 's have'} `
    + 'room to slip without moving the finish.';
}
