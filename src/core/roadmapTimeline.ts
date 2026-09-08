import type { RoadmapCriticalPath } from './roadmapCriticalPath.js';
import type { RoadmapEstimateScale, RoadmapFocus, RoadmapGraph, RoadmapScheduleState } from './roadmapGraph.js';

/**
 * The plan on a time axis — when each piece of work can start, when it can
 * finish, and how much room it has before it moves the finish.
 *
 * The roadmap could already say what has to happen before what (the dependency
 * canvas), which chain the finish rests on (`roadmapCriticalPath`), and how
 * every item is ordered (the backlog). What no surface could show is the shape
 * of all three at once: that four items sit idle for a week waiting on one, that
 * a gate lands three days after the deadline it is tagged for, that half the plan
 * has float and the other half none. A list cannot show simultaneity, and a
 * graph cannot show duration.
 *
 * Seven rules, and the first two are the ones that decide what this is allowed
 * to claim.
 *
 * **One schedule, not two.** Every bar is positioned from the earliest and
 * latest finishes `roadmapCriticalPath` already computed. A second forward pass
 * here would eventually disagree with the number printed on the node's own card,
 * and a Gantt chart that contradicts the card beside it is worse than no Gantt.
 *
 * **A bar is a duration, never a date.** The axis is days from today, and the
 * only real dates on it are deadlines somebody declared. This is not
 * squeamishness: `roadmapGraph` grades a human item in *effort spread across
 * working days* and an agent item in *wall clock*, so turning a mixed chain into
 * calendar dates would mean inventing a working calendar — a five-day week, a
 * holiday list, a working day's length — that nobody declared. Offering "12
 * March" from that would be a commitment made up by a renderer.
 *
 * **A deadline grades, it never schedules.** Bars are placed by dependencies and
 * estimates alone. A deadline that pulled its bar earlier would draw a plan that
 * meets it, which is the one thing this surface must never do.
 *
 * **Float is measured against the plan's finish, not the deadline** — inherited
 * from `slack-against-the-plan`, and restated because on a chart the lighter
 * tail *looks* like spare time before something external.
 *
 * **A milestone is dated only when every member is.** A gate with an item that
 * cannot be scheduled gets no date rather than the maximum of what is known: a
 * partial maximum is indistinguishable from a complete one once it is drawn as a
 * marker, and it always reads early.
 *
 * **Delivered work is counted, never drawn.** It takes no time, so a bar for it
 * would be a history lesson occupying the part of the chart that forecasts.
 *
 * **A plan with a cycle has no timeline**, for the same reason it has no finish:
 * the items in the loop are the finding.
 *
 * Pure — no clock, no `fs`, no model. Day zero is "now" by construction, because
 * that is what the critical path's own numbers are relative to.
 */

export type RoadmapTimelineRuleId =
  | 'one-schedule'
  | 'duration-not-date'
  | 'deadline-grades-never-schedules'
  | 'float-against-the-plan'
  | 'milestone-needs-every-member'
  | 'delivered-is-counted-not-drawn'
  | 'circular-has-no-timeline';

export interface RoadmapTimelineRule {
  id: RoadmapTimelineRuleId;
  description: string;
}

/** Published with every timeline, so a surface shows the rules that drew it. */
export const ROADMAP_TIMELINE_RULES: readonly RoadmapTimelineRule[] = [
  {
    id: 'one-schedule',
    description: 'Bars are positioned from the critical path\'s own earliest and latest finishes. Nothing here schedules the work a second time.',
  },
  {
    id: 'duration-not-date',
    description: 'The axis is days from today. Human estimates are effort in working days and agent estimates are wall clock, so calendar dates would mean inventing a working calendar nobody declared.',
  },
  {
    id: 'deadline-grades-never-schedules',
    description: 'A deadline is drawn as a marker and never moves a bar. A plan pulled earlier to meet its deadline would be a plan that always meets it.',
  },
  {
    id: 'float-against-the-plan',
    description: 'The lighter tail is how long an item can slip before the plan\'s own finish moves. It is not spare time before that item\'s deadline.',
  },
  {
    id: 'milestone-needs-every-member',
    description: 'A gate is dated only when every item tagged for it can be scheduled. A partial maximum reads early and looks identical to a complete one.',
  },
  {
    id: 'delivered-is-counted-not-drawn',
    description: 'Delivered work takes no time, so it is counted rather than drawn. The chart forecasts; the Delivered view records.',
  },
  {
    id: 'circular-has-no-timeline',
    description: 'A plan with a circular dependency cannot run, so it has no timeline. The items in the loop are the finding.',
  },
];

export type RoadmapTimelineState = 'ok' | 'nothing-outstanding' | 'circular';

export interface RoadmapTimelineBar {
  nodeId: string;
  text: string;
  focus: RoadmapFocus;
  gates: string[];
  assigneeId?: string;
  /** Days from today this can start, once every outstanding prerequisite is done. */
  startDay: number;
  /** Days from today this can finish, working as early as the plan allows. */
  endDay: number;
  /** Latest it can finish without moving the plan's finish. Equals `endDay` on the path. */
  latestEndDay: number;
  slackDays: number;
  critical: boolean;
  estimateDays: number;
  estimateSource: 'declared' | 'derived';
  estimateScale: RoadmapEstimateScale;
  /** True while something outstanding has to land first — the bar cannot start at day zero. */
  waiting: boolean;
  deadline?: string;
  /** Days from today to the declared deadline; negative once it has passed. */
  deadlineDay?: number;
  /** How the node's own card grades that deadline. Carried, never recomputed here. */
  scheduleState: RoadmapScheduleState;
}

export interface RoadmapTimelineMilestone {
  gateId: string;
  label: string;
  totalCount: number;
  completedCount: number;
  /** The day the last outstanding member finishes. Absent unless every member could be scheduled. */
  finishDay?: number;
  /** True when every item tagged for this gate is delivered. */
  delivered: boolean;
  /** Members with no bar, which is why there is no date. */
  unscheduledCount: number;
}

export interface RoadmapTimeline {
  state: RoadmapTimelineState;
  /** Days to the plan's finish — the longest bar's end. Absent unless `ok`. */
  finishDay?: number;
  /** The axis length: the finish, or the furthest deadline, whichever is later. */
  horizonDays: number;
  bars: RoadmapTimelineBar[];
  milestones: RoadmapTimelineMilestone[];
  outstandingCount: number;
  deliveredCount: number;
  criticalCount: number;
  rules: readonly RoadmapTimelineRule[];
  /** Why there is no timeline, when there is not. Absent when `ok`. */
  note?: string;
}

const EMPTY = {
  bars: [] as RoadmapTimelineBar[],
  milestones: [] as RoadmapTimelineMilestone[],
  criticalCount: 0,
  horizonDays: 0,
  rules: ROADMAP_TIMELINE_RULES,
};

/** Rounded to the same grid the estimate table uses, so a bar cannot be a hair wider than its card claims. */
function toGrid(days: number): number {
  return Math.round(days * 1440) / 1440;
}

/**
 * The plan as bars, milestones and a horizon.
 *
 * `path` is passed in rather than computed, because the caller already has it —
 * and because two callers computing it separately is exactly how a chart and the
 * summary above it come to disagree about the finish date.
 */
export function buildRoadmapTimeline(
  graph: RoadmapGraph,
  path: RoadmapCriticalPath,
  gateLabels: ReadonlyMap<string, string> = new Map(),
): RoadmapTimeline {
  const delivered = graph.nodes.filter(node => node.completed);
  const outstanding = graph.nodes.filter(node => !node.completed);

  if (path.state === 'circular') {
    return {
      ...EMPTY,
      state: 'circular',
      outstandingCount: outstanding.length,
      deliveredCount: delivered.length,
      note: path.note ?? 'This plan has a circular dependency, so it cannot be laid out on a time axis.',
    };
  }

  if (path.state === 'nothing-outstanding' || outstanding.length === 0) {
    return {
      ...EMPTY,
      state: 'nothing-outstanding',
      outstandingCount: outstanding.length,
      deliveredCount: delivered.length,
      // Deliberately not "0 days": an empty plan and a plan whose work takes no
      // time are different statements, and only one is worth congratulating.
      note: 'Nothing outstanding to lay out. The Delivered view records what has shipped.',
    };
  }

  const slackByNode = new Map(path.slack.map(entry => [entry.nodeId, entry]));
  const bars: RoadmapTimelineBar[] = [];

  for (const node of outstanding) {
    const slack = slackByNode.get(node.id);
    if (!slack) {
      // Every outstanding node carries slack, so this is unreachable in practice
      // — and skipping is still the right answer if it ever is not: a bar with a
      // made-up position is worse than an item that visibly did not make it on.
      continue;
    }
    const endDay = toGrid(slack.earliestFinishDays);
    const startDay = toGrid(Math.max(0, slack.earliestFinishDays - node.estimate.days));
    bars.push({
      nodeId: node.id,
      text: node.text,
      focus: node.focus,
      gates: node.gates,
      ...(node.assigneeId === undefined ? {} : { assigneeId: node.assigneeId }),
      startDay,
      endDay,
      latestEndDay: toGrid(slack.latestFinishDays),
      slackDays: toGrid(slack.slackDays),
      critical: slack.critical,
      estimateDays: node.estimate.days,
      estimateSource: node.estimate.source,
      estimateScale: node.estimate.scale,
      waiting: node.blockedBy.length > 0,
      ...(node.deadline === undefined ? {} : { deadline: node.deadline }),
      ...(node.schedule.daysLeft === undefined ? {} : { deadlineDay: node.schedule.daysLeft }),
      scheduleState: node.schedule.state,
    });
  }

  // Earliest first, then the constrained ahead of the roomy, then by id so two
  // items that start together cannot swap places between renders.
  bars.sort((left, right) => left.startDay - right.startDay
    || left.slackDays - right.slackDays
    || left.endDay - right.endDay
    || left.nodeId.localeCompare(right.nodeId));

  const finishDay = bars.reduce((latest, bar) => Math.max(latest, bar.endDay), 0);
  const furthestDeadline = bars.reduce(
    (latest, bar) => (bar.deadlineDay === undefined ? latest : Math.max(latest, bar.deadlineDay)),
    0,
  );

  return {
    state: 'ok',
    finishDay,
    // A deadline past the finish still has to be drawable, or the one marker
    // that says "we have room" falls off the end of the chart.
    horizonDays: Math.max(finishDay, furthestDeadline),
    bars,
    milestones: buildMilestones(graph, bars, gateLabels),
    outstandingCount: outstanding.length,
    deliveredCount: delivered.length,
    criticalCount: bars.filter(bar => bar.critical).length,
    rules: ROADMAP_TIMELINE_RULES,
  };
}

function buildMilestones(
  graph: RoadmapGraph,
  bars: readonly RoadmapTimelineBar[],
  gateLabels: ReadonlyMap<string, string>,
): RoadmapTimelineMilestone[] {
  const barsByNode = new Map(bars.map(bar => [bar.nodeId, bar]));
  const gateIds: string[] = [];
  for (const node of graph.nodes) {
    for (const gate of node.gates) {
      if (!gateIds.includes(gate)) { gateIds.push(gate); }
    }
  }

  return gateIds.map(gateId => {
    const members = graph.nodes.filter(node => node.gates.includes(gateId));
    const completedCount = members.filter(node => node.completed).length;
    const outstandingMembers = members.filter(node => !node.completed);
    const scheduled = outstandingMembers.map(node => barsByNode.get(node.id)).filter((bar): bar is RoadmapTimelineBar => bar !== undefined);
    const unscheduledCount = outstandingMembers.length - scheduled.length;
    const delivered = outstandingMembers.length === 0 && members.length > 0;

    return {
      gateId,
      label: gateLabels.get(gateId) ?? gateId,
      totalCount: members.length,
      completedCount,
      // Dated only when nothing is missing: a maximum over some of the members
      // reads exactly like a maximum over all of them, and always earlier.
      ...(unscheduledCount === 0 && scheduled.length > 0
        ? { finishDay: scheduled.reduce((latest, bar) => Math.max(latest, bar.endDay), 0) }
        : {}),
      delivered,
      unscheduledCount,
    };
  }).sort((left, right) => {
    // Dated gates first, in the order they land; then undated, by declaration.
    if (left.finishDay !== undefined && right.finishDay !== undefined) {
      return left.finishDay - right.finishDay || left.gateId.localeCompare(right.gateId);
    }
    if (left.finishDay !== undefined) { return -1; }
    if (right.finishDay !== undefined) { return 1; }
    return left.gateId.localeCompare(right.gateId);
  });
}

/**
 * One sentence a surface can print above the chart.
 *
 * Says the finish, what is on the path and what has room. Never a date, for the
 * reason `duration-not-date` gives.
 */
export function describeRoadmapTimeline(timeline: RoadmapTimeline): string {
  if (timeline.state === 'circular') {
    return timeline.note ?? 'This plan has a circular dependency, so it has no timeline.';
  }
  if (timeline.state === 'nothing-outstanding') {
    return timeline.note ?? 'Nothing outstanding to lay out.';
  }
  const finish = timeline.finishDay ?? 0;
  const roomy = timeline.bars.length - timeline.criticalCount;
  return `${timeline.bars.length} item${timeline.bars.length === 1 ? '' : 's'} across ${formatDays(finish)}`
    + `, ${timeline.criticalCount} on the critical path and ${roomy} with room to slip.`;
}

/** Days as a person would say them, matching the node cards' own phrasing. */
function formatDays(days: number): string {
  if (days < 1) {
    const minutes = Math.max(1, Math.round(days * 1440));
    return minutes < 60
      ? `${minutes}m`
      : `${Math.round(minutes / 6) / 10}h`;
  }
  const rounded = Math.round(days * 10) / 10;
  return `${rounded}d`;
}
