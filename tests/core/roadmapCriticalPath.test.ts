import { describe, expect, it } from 'vitest';

import {
  ROADMAP_CRITICAL_PATH_RULES,
  describeRoadmapCriticalPath,
  roadmapCriticalPath,
} from '../../src/core/roadmapCriticalPath.ts';
import { resolveRoadmapGraph } from '../../src/core/roadmapGraph.ts';
import type { RoadmapNodeRecord } from '../../src/core/roadmapGraph.ts';

/**
 * Which chain of work decides when the plan lands.
 *
 * The backlog could say what mattered most and the graph could say what waited
 * on what. Neither could say which chain the finish date actually rested on, so
 * a plan could be correctly prioritised, correctly sequenced, and still have
 * everybody working on the items that were never the constraint.
 *
 * Built through `resolveRoadmapGraph` rather than on a hand-made graph: the
 * forward pass is that module's `routeDays`, and a fixture that invented its own
 * would be testing a second implementation nobody ships.
 */

const NOW = new Date('2026-09-08T00:00:00.000Z');

/**
 * A plan from `text → prerequisites`, with estimates pinned so the arithmetic is
 * readable. Everything is a `feature` so the estimate table cannot vary a case
 * by accident.
 */
function plan(items: Array<{ id: string; days: number; after?: string[]; completed?: boolean }>) {
  const records: RoadmapNodeRecord[] = items.map(item => ({
    id: item.id,
    estimateDays: item.days,
    aiAssisted: false,
  } as RoadmapNodeRecord));

  return resolveRoadmapGraph({
    items: items.map((item, index) => ({
      id: item.id,
      itemId: `roadmap-${index + 1}`,
      text: `${item.id} some ordinary feature work`,
      completed: item.completed === true,
      focus: 'feature',
      gates: [],
      priorityScore: items.length - index,
      order: index,
    })),
    records,
    declaredEdges: items.flatMap(item => (item.after ?? []).map(from => ({
      from,
      to: item.id,
      origin: 'declared' as const,
    }))),
    // Off, so a keyword coincidence between two fixture titles cannot add an
    // edge the case did not ask for.
    deriveSuggestions: false,
    now: NOW,
  });
}

describe('the chain the finish date rests on', () => {
  it('takes the longest chain, not the total of every estimate', () => {
    //   a(2) ─┐
    //          ├─> c(1)      b runs beside a, so the finish is 4, not 8.
    //   b(5) ─┘
    const path = roadmapCriticalPath(plan([
      { id: 'a', days: 2 },
      { id: 'b', days: 5 },
      { id: 'c', days: 1, after: ['a', 'b'] },
    ]));

    expect(path.state).toBe('ok');
    expect(path.days).toBe(6);
    expect(path.nodeIds).toEqual(['b', 'c']);
  });

  it('gives the shorter parallel branch exactly its slack', () => {
    // `a` can slip three days before it starts holding `c` up.
    const path = roadmapCriticalPath(plan([
      { id: 'a', days: 2 },
      { id: 'b', days: 5 },
      { id: 'c', days: 1, after: ['a', 'b'] },
    ]));

    const slackOf = (id: string) => path.slack.find(entry => entry.nodeId === id);
    expect(slackOf('a')?.slackDays).toBe(3);
    expect(slackOf('a')?.critical).toBe(false);
    expect(slackOf('b')?.slackDays).toBe(0);
    expect(slackOf('c')?.slackDays).toBe(0);
    expect(path.offPathCount).toBe(1);
  });

  it('reports the chain in the order it can be worked', () => {
    const path = roadmapCriticalPath(plan([
      { id: 'third', days: 1, after: ['second'] },
      { id: 'first', days: 1 },
      { id: 'second', days: 1, after: ['first'] },
    ]));

    expect(path.nodeIds).toEqual(['first', 'second', 'third']);
  });

  it('puts the most constrained work first in the slack list', () => {
    const path = roadmapCriticalPath(plan([
      { id: 'roomy', days: 1 },
      { id: 'long', days: 4 },
      { id: 'join', days: 1, after: ['roomy', 'long'] },
    ]));

    expect(path.slack.map(entry => entry.nodeId).slice(0, 2)).toEqual(['long', 'join']);
    expect(path.slack.at(-1)?.nodeId).toBe('roomy');
  });
});

describe('what does not count as work still to do', () => {
  it('leaves delivered work off the path', () => {
    // Delivered prerequisites stay on the canvas because they explain how you
    // got here. Counting their days would make a forecast out of a history.
    const path = roadmapCriticalPath(plan([
      { id: 'done', days: 10, completed: true },
      { id: 'next', days: 2, after: ['done'] },
    ]));

    expect(path.days).toBe(2);
    expect(path.nodeIds).toEqual(['next']);
    expect(path.slack.map(entry => entry.nodeId)).toEqual(['next']);
  });

  it('does not let a delivered dependent constrain what it waited on', () => {
    // `later` is done, so it is not waiting on `earlier` any more and imposes
    // no latest finish on it.
    const path = roadmapCriticalPath(plan([
      { id: 'earlier', days: 1 },
      { id: 'later', days: 1, after: ['earlier'], completed: true },
      { id: 'long', days: 6 },
    ]));

    expect(path.days).toBe(6);
    expect(path.slack.find(entry => entry.nodeId === 'earlier')?.slackDays).toBe(5);
  });

  it('says nothing is outstanding rather than reporting a zero-day plan', () => {
    // An empty backlog and a backlog whose work takes no time are different
    // statements, and "0 days" congratulates you on the wrong one.
    const path = roadmapCriticalPath(plan([{ id: 'a', days: 3, completed: true }]));

    expect(path.state).toBe('nothing-outstanding');
    expect(path.days).toBeUndefined();
    expect(path.nodeIds).toEqual([]);
    expect(path.note).toMatch(/delivered/i);
  });

  it('distinguishes an empty roadmap from a finished one', () => {
    const path = roadmapCriticalPath(plan([]));
    expect(path.state).toBe('nothing-outstanding');
    expect(path.note).toMatch(/nothing on the roadmap/i);
  });
});

describe('a plan that cannot run has no finish date', () => {
  it('refuses to put a number on a circular plan', () => {
    const graph = plan([
      { id: 'a', days: 1, after: ['b'] },
      { id: 'b', days: 1, after: ['a'] },
    ]);
    expect(graph.cycles.length).toBeGreaterThan(0);

    const path = roadmapCriticalPath(graph);

    expect(path.state).toBe('circular');
    expect(path.days).toBeUndefined();
    expect(path.nodeIds).toEqual([]);
    expect(path.note).toMatch(/circular/i);
  });
});

describe('the numbers agree with the card beside them', () => {
  it('reuses each node\'s own route days as the earliest finish', () => {
    // The forward pass is not recomputed. A second implementation of the same
    // walk would eventually disagree with the figure printed on the node.
    const graph = plan([
      { id: 'a', days: 2 },
      { id: 'b', days: 3, after: ['a'] },
    ]);
    const path = roadmapCriticalPath(graph);

    for (const entry of path.slack) {
      const node = graph.nodes.find(candidate => candidate.id === entry.nodeId);
      expect(entry.earliestFinishDays).toBe(node?.schedule.routeDays);
    }
  });

  it('never reports negative slack', () => {
    const path = roadmapCriticalPath(plan([
      { id: 'a', days: 1 },
      { id: 'b', days: 2, after: ['a'] },
      { id: 'c', days: 1, after: ['a'] },
    ]));
    expect(path.slack.every(entry => entry.slackDays >= 0)).toBe(true);
  });

  it('keeps every figure on the half-day grid the estimates use', () => {
    const path = roadmapCriticalPath(plan([
      { id: 'a', days: 0.5 },
      { id: 'b', days: 1.5, after: ['a'] },
    ]));

    expect(path.days).toBe(2);
    for (const entry of path.slack) {
      expect(entry.slackDays * 2).toBe(Math.round(entry.slackDays * 2));
      expect(entry.earliestFinishDays * 2).toBe(Math.round(entry.earliestFinishDays * 2));
    }
  });

  it('is stable across two runs of the same plan', () => {
    const build = () => roadmapCriticalPath(plan([
      { id: 'a', days: 2 },
      { id: 'b', days: 2 },
      { id: 'c', days: 1, after: ['a', 'b'] },
    ]));
    expect(build().nodeIds).toEqual(build().nodeIds);
    expect(build().slack).toEqual(build().slack);
  });
});

describe('what it says out loud', () => {
  it('names the length and the chain', () => {
    const summary = describeRoadmapCriticalPath(roadmapCriticalPath(plan([
      { id: 'a', days: 2 },
      { id: 'b', days: 5 },
      { id: 'c', days: 1, after: ['a', 'b'] },
    ])));

    expect(summary).toContain('6 days');
    expect(summary).toContain('chain of 2 items');
    expect(summary).toMatch(/1 outstanding item has room/);
  });

  it('says plainly when the whole plan is one queue', () => {
    // Worth stating: it means nothing can be reordered to bring the date in.
    const summary = describeRoadmapCriticalPath(roadmapCriticalPath(plan([
      { id: 'a', days: 1 },
      { id: 'b', days: 1, after: ['a'] },
    ])));

    expect(summary).toMatch(/nothing here has room to slip/);
  });

  it('explains itself rather than going blank when there is no path', () => {
    // This answers a question somebody asked. A card rendering nothing when you
    // opened it looks broken rather than quiet.
    for (const graph of [plan([]), plan([{ id: 'a', days: 1, after: ['b'] }, { id: 'b', days: 1, after: ['a'] }])]) {
      expect(describeRoadmapCriticalPath(roadmapCriticalPath(graph)).length).toBeGreaterThan(0);
    }
  });

  it('publishes the rules that graded it', () => {
    const path = roadmapCriticalPath(plan([{ id: 'a', days: 1 }]));
    expect(path.rules).toBe(ROADMAP_CRITICAL_PATH_RULES);
    expect(new Set(ROADMAP_CRITICAL_PATH_RULES.map(rule => rule.id)).size)
      .toBe(ROADMAP_CRITICAL_PATH_RULES.length);
  });
});
