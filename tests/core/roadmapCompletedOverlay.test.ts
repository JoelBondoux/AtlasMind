import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { roadmapCriticalPath } from '../../src/core/roadmapCriticalPath.ts';
import {
  buildRoadmapCompletedOverlay,
  layoutRoadmapByAssignee,
  partitionRoadmapCompletion,
  resolveRoadmapGraph,
  roadmapRouteTo,
  type RoadmapEdge,
  type RoadmapGraphInputItem,
  type RoadmapNodeRecord,
} from '../../src/core/roadmapGraph.ts';

/**
 * *Show completed* is a way of looking. These tests hold the three things that
 * makes it true host-side: delivered work appears where the plan already put
 * it, nothing already drawn is duplicated, and nothing derived — the critical
 * path, routes, schedules, lane totals — moves because somebody asked to see
 * finished work.
 */

const NOW = new Date('2026-08-20T12:00:00Z');

const item = (overrides: Partial<RoadmapGraphInputItem> & { id: string }): RoadmapGraphInputItem => ({
  itemId: `roadmap-${overrides.id}`,
  text: overrides.id,
  completed: false,
  focus: 'feature',
  gates: [],
  priorityScore: 10,
  order: 0,
  ...overrides,
});

const declared = (from: string, to: string): RoadmapEdge => ({ from, to, origin: 'declared' });

const PEOPLE = [{ id: 'sam', name: 'Sam' }, { id: 'ana', name: 'Ana' }];

describe('buildRoadmapCompletedOverlay', () => {
  const graph = resolveRoadmapGraph({
    items: [
      item({ id: 'shipped', completed: true }),
      item({ id: 'shipped-blocking', completed: true }),
      item({ id: 'waiting' }),
      item({ id: 'later' }),
    ],
    records: [
      { id: 'shipped', normalizedText: 'shipped', assigneeId: 'sam', completedAt: '2026-05-01T09:00:00.000Z' },
      { id: 'waiting', normalizedText: 'waiting', assigneeId: 'sam' },
    ],
    declaredEdges: [declared('shipped-blocking', 'waiting'), declared('waiting', 'later')],
    deriveSuggestions: false,
    now: NOW,
  });
  const partition = partitionRoadmapCompletion(graph);
  const overlay = buildRoadmapCompletedOverlay(graph, partition, PEOPLE);

  it('places delivered work where the plan layout already put it', () => {
    const shipped = graph.nodes.find(node => node.id === 'shipped');
    expect(overlay.planPositions.shipped).toEqual(shipped?.position);
  });

  it('leaves out retained work, which the plan already draws', () => {
    expect(Object.keys(overlay.planPositions)).toEqual(['shipped']);
  });

  it('never offers a position for outstanding work on the plan canvas', () => {
    expect(overlay.planPositions.waiting).toBeUndefined();
    expect(overlay.planPositions.later).toBeUndefined();
  });

  it('lays every node, finished or not, into the by-person lanes', () => {
    expect(Object.keys(overlay.byPersonPositions).sort()).toEqual(['later', 'shipped', 'shipped-blocking', 'waiting']);
    const sam = overlay.byPersonLanes.find(lane => lane.id === 'sam');
    expect(sam?.count).toBe(2);
  });

  it('keeps each lane’s outstanding days what they were without finished work', () => {
    const outstandingOnly = layoutRoadmapByAssignee(partition.active, PEOPLE, graph.orientation).lanes;
    for (const lane of outstandingOnly) {
      expect(overlay.byPersonLanes.find(entry => entry.id === lane.id)?.outstandingDays).toBe(lane.outstandingDays);
    }
  });
});

/** An arbitrary small roadmap: items, some done, and a forward-only edge set (so no cycles). */
const arbitraryRoadmap = fc.integer({ min: 1, max: 9 }).chain(count => fc.record({
  completed: fc.array(fc.boolean(), { minLength: count, maxLength: count }),
  assignees: fc.array(fc.constantFrom(undefined, 'sam', 'ana', 'gone'), { minLength: count, maxLength: count }),
  // Pairs normalised to run forward, so the plan can never be circular; a
  // self-pair is dropped afterwards rather than filtered, because a filter on a
  // one-item roadmap could never be satisfied.
  edges: fc.array(
    fc.tuple(fc.integer({ min: 0, max: count - 1 }), fc.integer({ min: 0, max: count - 1 })),
    { maxLength: 12 },
  ).map(pairs => [...new Map(pairs
    .filter(([a, b]) => a !== b)
    .map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as const)
    .map(pair => [`${pair[0]}->${pair[1]}`, pair] as const)).values()]),
  orientation: fc.constantFrom('horizontal' as const, 'vertical' as const),
}));

describe('buildRoadmapCompletedOverlay — properties', () => {
  it('is displayed, never re-planned, over any roadmap', () => {
    fc.assert(fc.property(arbitraryRoadmap, roadmap => {
      const ids = roadmap.completed.map((_, index) => `n${index}`);
      const records: RoadmapNodeRecord[] = ids.flatMap((id, index) => {
        const assigneeId = roadmap.assignees[index];
        return assigneeId === undefined ? [] : [{ id, normalizedText: id, assigneeId }];
      });
      const graph = resolveRoadmapGraph({
        items: ids.map((id, index) => item({ id, completed: roadmap.completed[index] as boolean, order: index })),
        records,
        declaredEdges: roadmap.edges.map(([from, to]) => declared(`n${from}`, `n${to}`)),
        deriveSuggestions: false,
        orientation: roadmap.orientation,
        now: NOW,
      });
      const before = JSON.stringify(graph);
      const criticalBefore = roadmapCriticalPath(graph);
      const routesBefore = ids.map(id => roadmapRouteTo(graph, id));
      const partition = partitionRoadmapCompletion(graph);

      const overlay = buildRoadmapCompletedOverlay(graph, partition, PEOPLE);

      // Nothing derived moves, and the graph is not edited in place.
      expect(JSON.stringify(graph)).toBe(before);
      expect(roadmapCriticalPath(graph)).toEqual(criticalBefore);
      expect(ids.map(id => roadmapRouteTo(graph, id))).toEqual(routesBefore);

      // Exactly the delivered work the plan leaves off, never anything drawn already.
      const retained = new Set(partition.retained.map(node => node.id));
      const offPlan = graph.nodes.filter(node => node.completed && !retained.has(node.id)).map(node => node.id).sort();
      expect(Object.keys(overlay.planPositions).sort()).toEqual(offPlan);
      for (const id of Object.keys(overlay.planPositions)) {
        expect(partition.active.some(node => node.id === id)).toBe(false);
        expect(overlay.planPositions[id]).toEqual(graph.nodes.find(node => node.id === id)?.position);
      }

      // Every node has a lane position, and lane totals count outstanding days only.
      expect(Object.keys(overlay.byPersonPositions).sort()).toEqual([...ids].sort());
      const outstandingOnly = layoutRoadmapByAssignee(partition.active, PEOPLE, graph.orientation).lanes;
      for (const lane of outstandingOnly) {
        expect(overlay.byPersonLanes.find(entry => entry.id === lane.id)?.outstandingDays).toBe(lane.outstandingDays);
      }
      expect(overlay.byPersonLanes.reduce((total, lane) => total + lane.count, 0)).toBe(ids.length);
    }), { numRuns: 150 });
  });
});
