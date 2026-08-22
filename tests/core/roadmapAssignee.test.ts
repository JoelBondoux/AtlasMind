import { describe, it, expect } from 'vitest';
import {
  ROADMAP_CANVAS_MARGIN,
  ROADMAP_COLUMN_WIDTH,
  ROADMAP_GRID_SIZE,
  ROADMAP_ROW_HEIGHT,
  layoutRoadmapByAssignee,
  type RoadmapGraphNode,
} from '../../src/core/roadmapGraph';

const node = (
  id: string,
  overrides: Partial<RoadmapGraphNode> = {},
): RoadmapGraphNode => ({
  id,
  itemId: id,
  text: id,
  completed: false,
  focus: 'feature',
  gates: [],
  priorityScore: 0,
  branch: '',
  branchSource: 'unavailable',
  schedule: { state: 'no-deadline', daysLeft: 0, reason: 'no deadline' },
  estimate: { days: 1, alternativeDays: 2, aiAssisted: true, source: 'derived', rule: 'test' },
  position: { x: 0, y: 0 },
  positionSource: 'derived',
  depth: 0,
  prerequisites: [],
  dependents: [],
  blockedBy: [],
  ...overrides,
} as RoadmapGraphNode);

const PEOPLE = [
  { id: 'c-zoe', name: 'Zoe' },
  { id: 'c-adam', name: 'Adam' },
];

describe('layoutRoadmapByAssignee — one band per person', () => {
  it('puts unassigned work last, whatever it is called', () => {
    const { lanes } = layoutRoadmapByAssignee(
      [node('a'), node('b', { assigneeId: 'c-zoe' }), node('c', { assigneeId: 'c-adam' })],
      PEOPLE,
    );
    expect(lanes.map(lane => lane.label)).toEqual(['Adam', 'Zoe', 'Unassigned']);
  });

  it('orders named people alphabetically, so the same roster always draws the same picture', () => {
    // Not by workload: sorting by size would reshuffle the whole canvas every
    // time somebody finished something.
    const { lanes } = layoutRoadmapByAssignee(
      [
        node('a', { assigneeId: 'c-zoe' }),
        node('b', { assigneeId: 'c-zoe' }),
        node('c', { assigneeId: 'c-adam' }),
      ],
      PEOPLE,
    );
    expect(lanes.map(lane => lane.id)).toEqual(['c-adam', 'c-zoe']);
  });

  it('keeps work assigned to somebody no longer in the roster, and says so', () => {
    // Deleting a contact is not a statement that their work became unassigned.
    // Folding the two together would silently rewrite a decision.
    const { lanes } = layoutRoadmapByAssignee(
      [node('a', { assigneeId: 'c-gone' }), node('b')],
      PEOPLE,
    );
    const unresolved = lanes.find(lane => lane.unresolved);
    expect(unresolved).toBeDefined();
    expect(unresolved?.id).toBe('c-gone');
    expect(unresolved?.label).not.toBe('Unassigned');
    expect(lanes.find(lane => lane.id === '')?.unresolved).toBe(false);
  });

  it('sorts an unresolved lane after the named people but before unassigned', () => {
    const { lanes } = layoutRoadmapByAssignee(
      [node('a'), node('b', { assigneeId: 'c-gone' }), node('c', { assigneeId: 'c-adam' })],
      PEOPLE,
    );
    expect(lanes.map(lane => lane.id)).toEqual(['c-adam', 'c-gone', '']);
  });

  it('ignores stored positions, because a coordinate from the tree means nothing here', () => {
    // Honouring one would drop a node into somebody else's lane, which is the
    // single most misleading thing this view could do.
    const placed = layoutRoadmapByAssignee(
      [node('a', { assigneeId: 'c-adam', position: { x: 9999, y: 9999 }, positionSource: 'declared' })],
      PEOPLE,
    );
    expect(placed.nodes[0]?.position).not.toEqual({ x: 9999, y: 9999 });
    expect(placed.nodes[0]?.positionSource).toBe('derived');
  });

  it('keeps depth along the reading axis inside a lane, so a band is still a chain', () => {
    const placed = layoutRoadmapByAssignee(
      [
        node('a', { assigneeId: 'c-adam', depth: 0 }),
        node('b', { assigneeId: 'c-adam', depth: 1 }),
      ],
      PEOPLE,
    );
    const first = placed.nodes.find(entry => entry.id === 'a');
    const second = placed.nodes.find(entry => entry.id === 'b');
    expect(second?.position.x).toBeGreaterThan(first?.position.x ?? 0);
    expect(second?.position.y).toBe(first?.position.y);
  });

  it('swaps the axes for a vertical plan rather than being a second layout', () => {
    const horizontal = layoutRoadmapByAssignee(
      [node('a', { assigneeId: 'c-adam', depth: 1 })],
      PEOPLE,
      'horizontal',
    );
    const vertical = layoutRoadmapByAssignee(
      [node('a', { assigneeId: 'c-adam', depth: 1 })],
      PEOPLE,
      'vertical',
    );
    expect(vertical.nodes[0]?.position.y).toBe(horizontal.nodes[0]?.position.x);
    expect(vertical.nodes[0]?.position.x).toBe(horizontal.nodes[0]?.position.y);
  });

  it('never overlaps two lanes, however full the fullest column is', () => {
    const placed = layoutRoadmapByAssignee(
      [
        node('a', { assigneeId: 'c-adam', depth: 0 }),
        node('b', { assigneeId: 'c-adam', depth: 0 }),
        node('c', { assigneeId: 'c-adam', depth: 0 }),
        node('d', { assigneeId: 'c-zoe', depth: 0 }),
      ],
      PEOPLE,
    );
    const [adam, zoe] = placed.lanes;
    expect(adam).toBeDefined();
    expect(zoe).toBeDefined();
    expect(zoe!.offset).toBeGreaterThanOrEqual(adam!.offset + adam!.extent);
    // And every node sits inside its own band.
    for (const entry of placed.nodes) {
      const lane = placed.lanes.find(candidate => candidate.id === (entry.assigneeId ?? ''));
      expect(entry.position.y).toBeGreaterThanOrEqual(lane!.offset);
      expect(entry.position.y).toBeLessThan(lane!.offset + lane!.extent);
    }
  });

  it('counts outstanding work only, so a delivered lane does not look busy', () => {
    const { lanes } = layoutRoadmapByAssignee(
      [
        node('a', { assigneeId: 'c-adam', completed: true }),
        node('b', { assigneeId: 'c-adam' }),
      ],
      PEOPLE,
    );
    const adam = lanes.find(lane => lane.id === 'c-adam');
    expect(adam?.count).toBe(2);
    expect(adam?.outstandingDays).toBe(1);
  });

  it('lays out on the same grid the tree does', () => {
    // Or switching views would put every node a few pixels off the grid the
    // other view claims to be on.
    const placed = layoutRoadmapByAssignee([node('a', { assigneeId: 'c-adam' })], PEOPLE);
    expect(ROADMAP_CANVAS_MARGIN % ROADMAP_GRID_SIZE).toBe(0);
    expect(ROADMAP_COLUMN_WIDTH % ROADMAP_GRID_SIZE).toBe(0);
    expect(ROADMAP_ROW_HEIGHT % ROADMAP_GRID_SIZE).toBe(0);
    expect((placed.nodes[0]?.position.x ?? 1) % ROADMAP_GRID_SIZE).toBe(0);
    expect((placed.nodes[0]?.position.y ?? 1) % ROADMAP_GRID_SIZE).toBe(0);
  });

  it('returns no lanes for an empty plan rather than one empty band', () => {
    expect(layoutRoadmapByAssignee([], PEOPLE).lanes).toEqual([]);
  });
});
