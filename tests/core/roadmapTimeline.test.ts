import { describe, expect, it } from 'vitest';

import { roadmapCriticalPath } from '../../src/core/roadmapCriticalPath.ts';
import { resolveRoadmapGraph } from '../../src/core/roadmapGraph.ts';
import type { RoadmapNodeRecord } from '../../src/core/roadmapGraph.ts';
import {
  ROADMAP_TIMELINE_RULES,
  buildRoadmapTimeline,
  describeRoadmapTimeline,
} from '../../src/core/roadmapTimeline.ts';

/**
 * The plan on a time axis.
 *
 * Built through `resolveRoadmapGraph` and `roadmapCriticalPath` rather than on a
 * hand-made model, for the reason the critical-path suite gives: the schedule is
 * that module's, and a fixture inventing its own would test a second
 * implementation nobody ships.
 */

const NOW = new Date('2026-09-08T00:00:00.000Z');

interface PlanItem {
  id: string;
  days: number;
  after?: string[];
  completed?: boolean;
  gates?: string[];
  deadline?: string;
}

function plan(items: PlanItem[]) {
  const records: RoadmapNodeRecord[] = items.map(item => ({
    id: item.id,
    estimateDays: item.days,
    aiAssisted: false,
    ...(item.deadline === undefined ? {} : { deadline: item.deadline }),
  } as RoadmapNodeRecord));

  return resolveRoadmapGraph({
    items: items.map((item, index) => ({
      id: item.id,
      itemId: `roadmap-${index + 1}`,
      text: `${item.id} some ordinary feature work`,
      completed: item.completed === true,
      focus: 'feature',
      gates: item.gates ?? [],
      priorityScore: items.length - index,
      order: index,
    })),
    records,
    declaredEdges: items.flatMap(item => (item.after ?? []).map(from => ({
      from,
      to: item.id,
      origin: 'declared' as const,
    }))),
    deriveSuggestions: false,
    now: NOW,
  });
}

const timelineOf = (items: PlanItem[], gates?: ReadonlyMap<string, string>) => {
  const graph = plan(items);
  return buildRoadmapTimeline(graph, roadmapCriticalPath(graph), gates);
};

const barOf = (items: PlanItem[], id: string) =>
  timelineOf(items).bars.find(bar => bar.nodeId === id);

describe('a bar is placed by the plan, not by hope', () => {
  it('starts an item when its prerequisites can be finished, not at day zero', () => {
    //   a(2) ─> b(3):  b cannot start until day 2, and finishes on day 5.
    const bar = barOf([
      { id: 'a', days: 2 },
      { id: 'b', days: 3, after: ['a'] },
    ], 'b');

    expect(bar?.startDay).toBe(2);
    expect(bar?.endDay).toBe(5);
    expect(bar?.waiting).toBe(true);
  });

  it('runs independent work at the same time rather than end to end', () => {
    // The failure this exists to prevent is a chart that adds estimates up,
    // which always reads pessimistic and is what people stop believing.
    const timeline = timelineOf([
      { id: 'a', days: 2 },
      { id: 'b', days: 5 },
    ]);

    // Both start on day zero; the longer one sorts first because it is the one
    // with no room, which is the ordering rule this surface declares.
    expect(timeline.bars.map(bar => [bar.nodeId, bar.startDay, bar.endDay]))
      .toEqual([['b', 0, 5], ['a', 0, 2]]);
    expect(timeline.finishDay).toBe(5);
  });

  it('takes its schedule from the critical path rather than computing a second one', () => {
    // Same fixture as the critical-path suite's own longest-chain case, so the
    // two cannot drift: b→c is the path, a has three days of float.
    const items: PlanItem[] = [
      { id: 'a', days: 2 },
      { id: 'b', days: 5 },
      { id: 'c', days: 1, after: ['a', 'b'] },
    ];
    const graph = plan(items);
    const path = roadmapCriticalPath(graph);
    const timeline = buildRoadmapTimeline(graph, path);

    expect(timeline.finishDay).toBe(path.days);
    const a = timeline.bars.find(bar => bar.nodeId === 'a');
    expect(a?.slackDays).toBe(3);
    expect(a?.critical).toBe(false);
    expect(a?.latestEndDay).toBe(5);
    expect(timeline.criticalCount).toBe(2);
  });
});

describe('a deadline grades a bar and never moves it', () => {
  it('leaves the bar where the dependencies put it', () => {
    // A deadline that pulled its bar earlier would draw a plan that meets it,
    // which is the one thing this surface must never do.
    const withoutDeadline = barOf([
      { id: 'a', days: 4 },
      { id: 'b', days: 3, after: ['a'] },
    ], 'b');
    const withDeadline = barOf([
      { id: 'a', days: 4 },
      { id: 'b', days: 3, after: ['a'], deadline: '2026-09-10' },
    ], 'b');

    expect(withDeadline?.startDay).toBe(withoutDeadline?.startDay);
    expect(withDeadline?.endDay).toBe(withoutDeadline?.endDay);
  });

  it('carries the deadline as its own marker, in days from today', () => {
    const bar = barOf([{ id: 'a', days: 1, deadline: '2026-09-18' }], 'a');
    expect(bar?.deadline).toBe('2026-09-18');
    expect(bar?.deadlineDay).toBe(10);
  });

  it('keeps a deadline past the finish on the axis', () => {
    // Otherwise the one marker that says "we have room" falls off the end.
    const timeline = timelineOf([{ id: 'a', days: 1, deadline: '2026-10-08' }]);
    expect(timeline.finishDay).toBe(1);
    expect(timeline.horizonDays).toBe(30);
  });

  it('says nothing about a deadline nobody set', () => {
    const bar = barOf([{ id: 'a', days: 1 }], 'a');
    expect(bar?.deadline).toBeUndefined();
    expect(bar?.deadlineDay).toBeUndefined();
    expect(bar?.scheduleState).toBe('no-deadline');
  });
});

describe('milestones', () => {
  it('lands a gate on the day its last member finishes', () => {
    const timeline = timelineOf([
      { id: 'a', days: 2, gates: ['mvp'] },
      { id: 'b', days: 5, gates: ['mvp'] },
      { id: 'c', days: 1 },
    ], new Map([['mvp', 'MVP']]));

    const mvp = timeline.milestones.find(entry => entry.gateId === 'mvp');
    expect(mvp?.label).toBe('MVP');
    expect(mvp?.finishDay).toBe(5);
    expect(mvp?.totalCount).toBe(2);
    expect(mvp?.completedCount).toBe(0);
  });

  it('counts delivered members without drawing them', () => {
    const timeline = timelineOf([
      { id: 'done', days: 3, gates: ['mvp'], completed: true },
      { id: 'left', days: 2, gates: ['mvp'] },
    ]);

    const mvp = timeline.milestones.find(entry => entry.gateId === 'mvp');
    expect(mvp?.completedCount).toBe(1);
    expect(mvp?.totalCount).toBe(2);
    // Delivered work takes no time, so the gate lands when the rest does.
    expect(mvp?.finishDay).toBe(2);
    expect(timeline.bars.map(bar => bar.nodeId)).toEqual(['left']);
    expect(timeline.deliveredCount).toBe(1);
  });

  it('marks a gate delivered when every member has shipped', () => {
    const timeline = timelineOf([
      { id: 'done', days: 3, gates: ['mvp'], completed: true },
      { id: 'other', days: 2 },
    ]);

    const mvp = timeline.milestones.find(entry => entry.gateId === 'mvp');
    expect(mvp?.delivered).toBe(true);
    expect(mvp?.finishDay).toBeUndefined();
  });

  it('falls back to the gate id when nothing named it', () => {
    const timeline = timelineOf([{ id: 'a', days: 1, gates: ['beta'] }]);
    expect(timeline.milestones[0]?.label).toBe('beta');
  });
});

describe('what the timeline refuses to draw', () => {
  it('has no timeline for a plan with a cycle, and says why', () => {
    const timeline = timelineOf([
      { id: 'a', days: 1, after: ['b'] },
      { id: 'b', days: 1, after: ['a'] },
    ]);

    expect(timeline.state).toBe('circular');
    expect(timeline.bars).toEqual([]);
    expect(timeline.finishDay).toBeUndefined();
    expect(timeline.note).toMatch(/circular/i);
  });

  it('reports an empty plan as empty rather than as a plan that takes no time', () => {
    const timeline = timelineOf([{ id: 'a', days: 2, completed: true }]);

    expect(timeline.state).toBe('nothing-outstanding');
    expect(timeline.finishDay).toBeUndefined();
    expect(timeline.horizonDays).toBe(0);
    expect(timeline.deliveredCount).toBe(1);
    expect(timeline.note).not.toMatch(/0 days/);
  });

  it('publishes the rules that drew it', () => {
    const timeline = timelineOf([{ id: 'a', days: 1 }]);
    expect(timeline.rules).toBe(ROADMAP_TIMELINE_RULES);
    expect(timeline.rules.map(rule => rule.id)).toContain('duration-not-date');
  });
});

describe('ordering is stable', () => {
  it('sorts by start, then by how little room there is, then by id', () => {
    // Two items that start together must not swap places between renders.
    const timeline = timelineOf([
      { id: 'zeta', days: 1 },
      { id: 'alpha', days: 1 },
      { id: 'long', days: 4 },
      { id: 'join', days: 1, after: ['zeta', 'alpha', 'long'] },
    ]);

    expect(timeline.bars.map(bar => bar.nodeId)).toEqual(['long', 'alpha', 'zeta', 'join']);
  });
});

describe('the sentence above the chart', () => {
  it('says the span, what is on the path, and what has room', () => {
    const summary = describeRoadmapTimeline(timelineOf([
      { id: 'a', days: 2 },
      { id: 'b', days: 5 },
      { id: 'c', days: 1, after: ['a', 'b'] },
    ]));

    expect(summary).toContain('3 items');
    expect(summary).toContain('6d');
    expect(summary).toContain('2 on the critical path');
    expect(summary).toContain('1 with room to slip');
  });

  it('never states a calendar date', () => {
    // Human estimates are effort in working days and agent estimates are wall
    // clock, so a date would mean inventing a working calendar nobody declared.
    const summary = describeRoadmapTimeline(timelineOf([
      { id: 'a', days: 1, deadline: '2026-09-18' },
    ]));

    expect(summary).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
