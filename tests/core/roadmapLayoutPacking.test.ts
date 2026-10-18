import { readFileSync } from 'node:fs';
import path from 'node:path';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  ROADMAP_BLOCK_GAP,
  ROADMAP_CANVAS_MARGIN,
  ROADMAP_COLUMN_WIDTH,
  ROADMAP_FOLD_THRESHOLD,
  ROADMAP_GRID_SIZE,
  ROADMAP_REFERENCE_FRAME,
  ROADMAP_ROW_HEIGHT,
  partitionRoadmapCompletion,
  resolveRoadmapGraph,
  type RoadmapEdge,
  type RoadmapGraph,
  type RoadmapGraphInputItem,
  type RoadmapGraphNode,
  type RoadmapLayoutOrientation,
} from '../../src/core/roadmapGraph.ts';

/**
 * The Auto tree's spread, measured rather than described.
 *
 * The roadmap item read "AutoTree doesn't bring nodes together enough and keeps
 * many spread out off screen". Every assertion here is a number about where the
 * cards land — how much frame the plan needs, whether Fit all can show it, how
 * far a block sits from its neighbours — because a layout can satisfy every
 * structural rule (layers, blocks that never interleave, children under
 * parents) and still be a canvas nobody can see.
 */

const NOW = new Date('2026-10-07T12:00:00Z');

/** The webview's own constants (`media/projectDashboard.js`), mirrored for the fit arithmetic. */
const CARD_WIDTH = 250;
const CARD_HEIGHT = 132;
const FIT_PADDING = 48;

const item = (id: string, index: number, completed = false): RoadmapGraphInputItem => ({
  id,
  itemId: `roadmap-${index + 1}`,
  text: id,
  completed,
  focus: 'feature',
  gates: [],
  priorityScore: 1000 - index,
  order: index,
});
const declared = (from: string, to: string): RoadmapEdge => ({ from, to, origin: 'declared' });

const build = (
  items: RoadmapGraphInputItem[],
  edges: RoadmapEdge[],
  orientation: RoadmapLayoutOrientation,
): RoadmapGraph => resolveRoadmapGraph({
  items,
  records: [],
  declaredEdges: edges,
  deriveSuggestions: false,
  orientation,
  now: NOW,
});

/** The zoom Fit all would choose for these cards in the reference frame, before any floor. */
function fitZoom(nodes: readonly RoadmapGraphNode[]): number {
  const xs = nodes.map(node => node.position.x);
  const ys = nodes.map(node => node.position.y);
  const width = Math.max(...xs) + CARD_WIDTH - Math.min(...xs);
  const height = Math.max(...ys) + CARD_HEIGHT - Math.min(...ys);
  return Math.min(
    1,
    (ROADMAP_REFERENCE_FRAME.width - FIT_PADDING * 2) / width,
    (ROADMAP_REFERENCE_FRAME.height - FIT_PADDING * 2) / height,
  );
}

/** How many reference frames the cards' slots span — the layout's own measure. */
function frameScore(nodes: readonly RoadmapGraphNode[]): number {
  const xs = nodes.map(node => node.position.x);
  const ys = nodes.map(node => node.position.y);
  const width = Math.max(...xs) + ROADMAP_COLUMN_WIDTH - Math.min(...xs);
  const height = Math.max(...ys) + ROADMAP_ROW_HEIGHT - Math.min(...ys);
  return Math.max(width / ROADMAP_REFERENCE_FRAME.width, height / ROADMAP_REFERENCE_FRAME.height);
}

/** Connected components of the linked nodes among `nodes`, plus the unlinked ones as one group. */
function blocksOf(nodes: readonly RoadmapGraphNode[]): RoadmapGraphNode[][] {
  const inSet = new Set(nodes.map(node => node.id));
  const byId = new Map(nodes.map(node => [node.id, node]));
  const seen = new Set<string>();
  const blocks: RoadmapGraphNode[][] = [];
  const parked: RoadmapGraphNode[] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) {
      continue;
    }
    seen.add(node.id);
    if (node.prerequisites.length === 0 && node.dependents.length === 0) {
      parked.push(node);
      continue;
    }
    const members: RoadmapGraphNode[] = [];
    const stack = [node];
    while (stack.length > 0) {
      const current = stack.pop() as RoadmapGraphNode;
      members.push(current);
      for (const id of [...current.prerequisites, ...current.dependents]) {
        if (inSet.has(id) && !seen.has(id)) {
          seen.add(id);
          stack.push(byId.get(id) as RoadmapGraphNode);
        }
      }
    }
    blocks.push(members);
  }
  return parked.length > 0 ? [...blocks, parked] : blocks;
}

interface Box { x0: number; y0: number; x1: number; y1: number }
const slotBox = (members: readonly RoadmapGraphNode[]): Box => ({
  x0: Math.min(...members.map(node => node.position.x)),
  y0: Math.min(...members.map(node => node.position.y)),
  // A card's slot, so two boxes that merely touch are adjacent rather than overlapping.
  x1: Math.max(...members.map(node => node.position.x)) + ROADMAP_COLUMN_WIDTH,
  y1: Math.max(...members.map(node => node.position.y)) + ROADMAP_ROW_HEIGHT,
});
const overlaps = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const gapBetween = (a: Box, b: Box): number => Math.hypot(
  Math.max(0, b.x0 - a.x1, a.x0 - b.x1),
  Math.max(0, b.y0 - a.y1, a.y0 - b.y1),
);

// ── This repository's roadmap, as it stood at 0.487.0 ─────────────────────────
//
// Taken from `project_memory/roadmap/improvement-plan.md` (96 items, 56 ticked)
// and `roadmap-graph.json` (69 declared links, no stored positions), reduced to
// shape: item order, which are delivered, and the links by item index. Text is
// left out because nothing in the layout reads it.
const REPO_DONE = 'xxxxx........................................xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const REPO_EDGES: ReadonlyArray<readonly [number, number]> = [
  [21, 12], [43, 12], [49, 13], [39, 13], [49, 50], [49, 21], [49, 30], [20, 18], [25, 18], [52, 20], [20, 27],
  [20, 35], [45, 20], [21, 30], [21, 36], [21, 37], [52, 45], [25, 27], [45, 27], [26, 30], [26, 31], [22, 43],
  [22, 44], [40, 34], [24, 35], [24, 36], [25, 36], [84, 83], [84, 85], [84, 86], [84, 87], [49, 31], [49, 26],
  [49, 37], [25, 50], [21, 54], [21, 43], [21, 44], [37, 30], [40, 30], [26, 36], [39, 36], [84, 88], [84, 89],
  [84, 90], [73, 78], [73, 9], [43, 9], [45, 65], [73, 70], [49, 65], [73, 63], [73, 71], [43, 71], [51, 65],
  [73, 65], [23, 65], [24, 65], [39, 65], [43, 65], [84, 65], [43, 46], [73, 46], [56, 7], [56, 65], [43, 60],
  [73, 60], [80, 5], [49, 6],
];
const repoRoadmap = (orientation: RoadmapLayoutOrientation): RoadmapGraph => build(
  [...REPO_DONE].map((flag, index) => item(`n${index}`, index, flag === 'x')),
  REPO_EDGES.map(([from, to]) => declared(`n${from}`, `n${to}`)),
  orientation,
);

describe('the Auto tree on this repository’s roadmap', () => {
  it('needs a quarter of the canvas it used to, in both orientations', () => {
    // Before (0.487.0), the outstanding plan, measured the same way:
    //   top to bottom   9,210 × 2,360 px — Fit all wanted 12%, and stopped at its 35% floor
    //                   with 7 of 46 cards in view; the plan had a hole for every
    //                   delivered card, and one layer was 21 cards wide.
    //   left to right   2,170 × 10,280 px — Fit all wanted 5%; 9 of 46 in view.
    // After: about 4,330 × 1,640 and 3,570 × 1,760 — Fit all 25% and 30%.
    for (const orientation of ['vertical', 'horizontal'] as const) {
      const plan = partitionRoadmapCompletion(repoRoadmap(orientation)).active;
      expect(plan).toHaveLength(46);
      expect(fitZoom(plan), orientation).toBeGreaterThanOrEqual(0.24);
      expect(frameScore(plan), orientation).toBeLessThanOrEqual(3.8);
    }
  });

  it('fits inside the floor Fit all now stops at', () => {
    // The webview's floor is the zoom below which Fit all stops fitting. It is
    // pinned against the real script, so lowering the layout's density or
    // raising the floor cannot quietly put this plan back off screen.
    const script = readFileSync(path.join(process.cwd(), 'media', 'projectDashboard.js'), 'utf8');
    const floor = Number(/const RM_MIN_ZOOM = ([\d.]+);/.exec(script)?.[1]);
    expect(floor).toBeGreaterThan(0);
    for (const orientation of ['vertical', 'horizontal'] as const) {
      expect(fitZoom(partitionRoadmapCompletion(repoRoadmap(orientation)).active)).toBeGreaterThanOrEqual(floor);
    }
  });

  it('lays delivered work beside the plan, never inside it', () => {
    for (const orientation of ['vertical', 'horizontal'] as const) {
      const graph = repoRoadmap(orientation);
      const partition = partitionRoadmapCompletion(graph);
      const onPlan = new Set(partition.active.map(node => node.id));
      const offPlan = graph.nodes.filter(node => !onPlan.has(node.id));
      expect(offPlan.length).toBeGreaterThan(0);
      expect(overlaps(slotBox(partition.active), slotBox(offPlan)), orientation).toBe(false);
    }
  });

  it('keeps the whole roadmap, delivered work included, far tighter than before', () => {
    // Before: 10,490 × 2,360 (Fit all 11%) and 2,170 × 11,720 (4%).
    for (const orientation of ['vertical', 'horizontal'] as const) {
      expect(fitZoom(repoRoadmap(orientation).nodes), orientation).toBeGreaterThanOrEqual(0.15);
    }
  });
});

describe('shapes that used to run off screen', () => {
  it('wraps thirty small sub-plans into strips instead of one long row', () => {
    // Before: 18,810 × 560 top to bottom and 570 × 21,080 left to right —
    // Fit all wanted 6% and 2%.
    const items: RoadmapGraphInputItem[] = [];
    const edges: RoadmapEdge[] = [];
    for (let i = 0; i < 30; i += 1) {
      items.push(item(`a${i}`, items.length), item(`b${i}`, items.length));
      edges.push(declared(`a${i}`, `b${i}`));
    }
    for (const orientation of ['vertical', 'horizontal'] as const) {
      const graph = build(items, edges, orientation);
      expect(fitZoom(graph.nodes), orientation).toBeGreaterThanOrEqual(0.2);
      // Two cards of each pair still read along the tree's direction.
      for (let i = 0; i < 30; i += 1) {
        const [a, b] = [`a${i}`, `b${i}`].map(id => graph.nodes.find(node => node.id === id) as RoadmapGraphNode);
        if (orientation === 'vertical') {
          expect(b.position.x).toBe(a.position.x);
          expect(b.position.y).toBeGreaterThan(a.position.y);
        } else {
          expect(b.position.y).toBe(a.position.y);
          expect(b.position.x).toBeGreaterThan(a.position.x);
        }
      }
    }
  });

  it('folds a layer forty cards wide, keeping every child after its parent', () => {
    // Before: 12,730 × 560 and 570 × 14,240 — 9% and 4%.
    const items = [item('root', 0)];
    const edges: RoadmapEdge[] = [];
    for (let i = 0; i < 40; i += 1) {
      items.push(item(`f${i}`, items.length));
      edges.push(declared('root', `f${i}`));
    }
    for (const orientation of ['vertical', 'horizontal'] as const) {
      const graph = build(items, edges, orientation);
      expect(fitZoom(graph.nodes), orientation).toBeGreaterThanOrEqual(0.3);
      const root = graph.nodes.find(node => node.id === 'root') as RoadmapGraphNode;
      const reading = (node: RoadmapGraphNode): number => (orientation === 'vertical' ? node.position.y : node.position.x);
      const children = graph.nodes.filter(node => node.id !== 'root');
      // Folded: the children sit on more than one reading line…
      expect(new Set(children.map(reading)).size, orientation).toBeGreaterThan(1);
      // …and every one of them is still after the item it waits on.
      for (const child of children) {
        expect(reading(child)).toBeGreaterThan(reading(root));
      }
    }
  });

  it('leaves a plan that already fits exactly as the tree draws it', () => {
    // Folding and wrapping cost a reader the simplest order, so nothing is
    // reshaped while one strip fits the frame at half size.
    const items = ['a', 'b', 'd', 'e'].map((id, index) => item(id, index));
    const graph = build(items, [declared('a', 'b'), declared('d', 'e')], 'horizontal');
    const x = (id: string): number => graph.nodes.find(node => node.id === id)?.position.x ?? -1;
    const y = (id: string): number => graph.nodes.find(node => node.id === id)?.position.y ?? -1;
    // One strip, blocks one after another down the cross axis.
    expect(x('a')).toBe(ROADMAP_CANVAS_MARGIN);
    expect(x('d')).toBe(ROADMAP_CANVAS_MARGIN);
    expect(y('d')).toBeGreaterThan(y('b'));
    // The second block starts one pitch and one gap after the first ends.
    expect(y('d') - y('b')).toBe(ROADMAP_ROW_HEIGHT + ROADMAP_BLOCK_GAP);
    expect(frameScore(graph.nodes)).toBeLessThanOrEqual(ROADMAP_FOLD_THRESHOLD);
  });
});

describe('the reference frame', () => {
  it('is as tall as the canvas the dashboard actually draws', () => {
    const panel = readFileSync(path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'), 'utf8');
    const height = Number(/\.rm-frame \{[^}]*?height:\s*(\d+)px/.exec(panel)?.[1]);
    expect(height).toBe(ROADMAP_REFERENCE_FRAME.height);
  });

  it('keeps every spacing on the snapping grid', () => {
    expect(ROADMAP_BLOCK_GAP % ROADMAP_GRID_SIZE).toBe(0);
  });
});

/**
 * An arbitrary roadmap shaped like real ones: many small sub-plans, a few
 * larger ones, unlinked items, some delivered. Edges run forward only, so the
 * plan is never circular.
 */
const arbitraryRoadmap = fc.integer({ min: 1, max: 70 }).chain(count => fc.record({
  completed: fc.array(fc.boolean(), { minLength: count, maxLength: count }),
  edges: fc.array(
    fc.tuple(fc.integer({ min: 0, max: count - 1 }), fc.integer({ min: 0, max: count - 1 })),
    { maxLength: Math.max(1, Math.floor(count * 1.2)) },
  ).map(pairs => [...new Map(pairs
    .filter(([a, b]) => a !== b)
    .map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as const)
    .map(pair => [`${pair[0]}->${pair[1]}`, pair] as const)).values()]),
  orientation: fc.constantFrom('horizontal' as const, 'vertical' as const),
}));

const buildArbitrary = (roadmap: { completed: boolean[]; edges: Array<readonly [number, number]>; orientation: RoadmapLayoutOrientation }): RoadmapGraph =>
  build(
    roadmap.completed.map((done, index) => item(`n${index}`, index, done)),
    roadmap.edges.map(([from, to]) => declared(`n${from}`, `n${to}`)),
    roadmap.orientation,
  );

describe('the Auto tree — properties', () => {
  it('never puts two cards in one slot, and keeps every card on the grid', () => {
    fc.assert(fc.property(arbitraryRoadmap, roadmap => {
      const nodes = buildArbitrary(roadmap).nodes;
      for (const node of nodes) {
        expect(node.position.x % ROADMAP_GRID_SIZE).toBe(0);
        expect(node.position.y % ROADMAP_GRID_SIZE).toBe(0);
      }
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const [a, b] = [nodes[i] as RoadmapGraphNode, nodes[j] as RoadmapGraphNode];
          const apart = Math.abs(a.position.x - b.position.x) >= ROADMAP_COLUMN_WIDTH
            || Math.abs(a.position.y - b.position.y) >= ROADMAP_ROW_HEIGHT;
          expect(apart, `${a.id} and ${b.id} share a slot`).toBe(true);
        }
      }
    }), { numRuns: 150 });
  });

  it('lays out the same roadmap the same way every time', () => {
    fc.assert(fc.property(arbitraryRoadmap, roadmap => {
      const first = buildArbitrary(roadmap).nodes.map(node => [node.id, node.position]);
      const second = buildArbitrary(roadmap).nodes.map(node => [node.id, node.position]);
      expect(second).toEqual(first);
    }), { numRuns: 100 });
  });

  it('keeps every block of the plan whole: blocks never overlap or interleave', () => {
    fc.assert(fc.property(arbitraryRoadmap, roadmap => {
      const plan = partitionRoadmapCompletion(buildArbitrary(roadmap)).active;
      const boxes = blocksOf(plan).map(slotBox);
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          expect(overlaps(boxes[i] as Box, boxes[j] as Box)).toBe(false);
        }
      }
    }), { numRuns: 150 });
  });

  it('strands no block: each sits within one gap of a neighbour, or of the largest block’s reach', () => {
    // The old single strip satisfied this too; what it rules out is a block
    // flung to the far side of the canvas — the parked block placed after the
    // plan's widest extent, or a strip opened past an empty one.
    fc.assert(fc.property(arbitraryRoadmap, roadmap => {
      const plan = partitionRoadmapCompletion(buildArbitrary(roadmap)).active;
      const boxes = blocksOf(plan).map(slotBox);
      if (boxes.length < 2) {
        return;
      }
      const thickest = Math.max(...boxes.map(box => Math.max(box.x1 - box.x0, box.y1 - box.y0)));
      for (const box of boxes) {
        const nearest = Math.min(...boxes.filter(other => other !== box).map(other => gapBetween(box, other)));
        expect(nearest).toBeLessThanOrEqual(thickest + ROADMAP_BLOCK_GAP);
      }
    }), { numRuns: 150 });
  });

  it('shapes the plan for the frame: never more than a few times the space its cards need', () => {
    // A floor no arrangement can beat: the cards' own slots, packed perfectly,
    // and the longest chain, which nothing folds. The old single strip ran to
    // fifteen times this on thirty pairs.
    fc.assert(fc.property(arbitraryRoadmap, roadmap => {
      const graph = buildArbitrary(roadmap);
      const plan = partitionRoadmapCompletion(graph).active;
      if (plan.length === 0) {
        return;
      }
      const slotArea = ROADMAP_COLUMN_WIDTH * ROADMAP_ROW_HEIGHT;
      const frameArea = ROADMAP_REFERENCE_FRAME.width * ROADMAP_REFERENCE_FRAME.height;
      const areaFloor = Math.sqrt(plan.length * slotArea / frameArea);
      const depth = Math.max(...blocksOf(plan).map(members =>
        new Set(members.map(node => node.depth)).size));
      const chainFloor = roadmap.orientation === 'vertical'
        ? depth * ROADMAP_ROW_HEIGHT / ROADMAP_REFERENCE_FRAME.height
        : depth * ROADMAP_COLUMN_WIDTH / ROADMAP_REFERENCE_FRAME.width;
      const floor = Math.max(areaFloor, chainFloor);
      expect(frameScore(plan)).toBeLessThanOrEqual(Math.max(ROADMAP_FOLD_THRESHOLD, 2.5 * floor));
    }), { numRuns: 200 });
  });
});
