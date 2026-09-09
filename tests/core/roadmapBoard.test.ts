import { describe, expect, it } from 'vitest';

import {
  ROADMAP_BOARD_RULES,
  buildRoadmapBoard,
  describeRoadmapBoard,
  type RoadmapBoardColumnId,
  type RoadmapBoardEvidence,
} from '../../src/core/roadmapBoard.ts';
import { resolveRoadmapGraph } from '../../src/core/roadmapGraph.ts';
import type { RoadmapNodeRecord } from '../../src/core/roadmapGraph.ts';

/**
 * The plan as a board, where the only thing that moves a card is evidence.
 *
 * Built through `resolveRoadmapGraph` so the branch names the board matches on
 * are the ones that module really derives — a fixture inventing its own would
 * pass while the two disagreed in the product.
 */

const NOW = new Date('2026-09-08T00:00:00.000Z');

interface Item {
  id: string;
  after?: string[];
  completed?: boolean;
  /** A branch the item declares, as a record on disk would. */
  branch?: string;
  /** A branch name AtlasMind worked out from the text, as the panel supplies. */
  derivedBranch?: string;
}

function plan(items: Item[]) {
  const records: RoadmapNodeRecord[] = items.map(item => ({
    id: item.id,
    estimateDays: 1,
    aiAssisted: false,
    ...(item.branch === undefined ? {} : { branch: item.branch }),
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
      ...(item.derivedBranch === undefined ? {} : { derivedBranch: item.derivedBranch }),
    })),
    records,
    declaredEdges: items.flatMap(item => (item.after ?? []).map(from => ({
      from, to: item.id, origin: 'declared' as const,
    }))),
    deriveSuggestions: false,
    now: NOW,
  });
}

/** The graph's nodes, which is all a board needs — edges say nothing about state. */
const nodesOf = (items: Item[]) => plan(items).nodes;

const boardOf = (items: Item[], evidence: RoadmapBoardEvidence = { branchNames: [], openPullRequests: [] }) =>
  buildRoadmapBoard(nodesOf(items), evidence);

const columnOf = (items: Item[], id: string, evidence?: RoadmapBoardEvidence): RoadmapBoardColumnId | undefined =>
  boardOf(items, evidence).columns.flatMap(column => column.cards).find(card => card.nodeId === id)?.column;

describe('a card only moves on evidence', () => {
  it('leaves an item nobody has started in Ready', () => {
    // The failure this exists to prevent: a board that reads "in progress"
    // because an item is near the top, or assigned, or important.
    expect(columnOf([{ id: 'a' }], 'a')).toBe('ready');
  });

  it('moves an item to In progress when a branch for it exists', () => {
    const graph = plan([{ id: 'a', branch: 'feat/a' }]);
    const board = buildRoadmapBoard(graph.nodes, { branchNames: ['feat/a'], openPullRequests: [] });
    const card = board.columns.flatMap(column => column.cards)[0];

    expect(card?.column).toBe('in-progress');
    expect(card?.branchMatch).toBe('declared');
  });

  it('moves an item to In review when an open pull request comes off its branch', () => {
    const graph = plan([{ id: 'a', branch: 'feat/a' }]);
    const board = buildRoadmapBoard(graph.nodes, {
      branchNames: ['feat/a'],
      openPullRequests: [{ number: 42, headRefName: 'feat/a', isDraft: false, url: 'https://example.invalid/42' }],
    });
    const card = board.columns.flatMap(column => column.cards)[0];

    expect(card?.column).toBe('in-review');
    expect(card?.pullRequestNumber).toBe(42);
    expect(card?.pullRequestUrl).toBe('https://example.invalid/42');
  });

  it('matches a branch regardless of case, because git preserves it and people do not', () => {
    const graph = plan([{ id: 'a', branch: 'Feat/A' }]);
    const board = buildRoadmapBoard(graph.nodes, { branchNames: ['feat/a'], openPullRequests: [] });
    expect(board.columns.flatMap(column => column.cards)[0]?.column).toBe('in-progress');
  });

  it('says how the branch matched, because a derived name is a weaker claim', () => {
    // A branch the item declares is a fact. A name derived from its text
    // matching a real branch is a naming convention holding.
    const graph = plan([{ id: 'a', derivedBranch: 'feat/a-some-ordinary-feature-work' }]);
    const derivedBranch = graph.nodes[0]!.branch;
    expect(graph.nodes[0]!.branchSource).toBe('derived');

    const board = buildRoadmapBoard(graph.nodes, { branchNames: [derivedBranch], openPullRequests: [] });
    const card = board.columns.flatMap(column => column.cards)[0];
    expect(card?.column).toBe('in-progress');
    expect(card?.branchMatch).toBe('derived');
  });

  it('claims no match when nothing matched', () => {
    const graph = plan([{ id: 'a', branch: 'feat/a' }]);
    const board = buildRoadmapBoard(graph.nodes, { branchNames: ['something/else'], openPullRequests: [] });
    expect(board.columns.flatMap(column => column.cards)[0]?.branchMatch).toBeUndefined();
  });
});

describe('delivered comes from the roadmap', () => {
  it('puts a ticked item in Delivered', () => {
    expect(columnOf([{ id: 'a', completed: true }], 'a')).toBe('delivered');
  });

  it('does not deliver an item because a pull request merged', () => {
    // Work merges without finishing an item, and items finish with no pull
    // request at all. Only the backlog line ticks the box.
    const graph = plan([{ id: 'a', branch: 'feat/a' }]);
    const board = buildRoadmapBoard(graph.nodes, {
      branchNames: [],
      // A merged pull request is not an *open* one, so it is not even offered
      // here — the point being that no pull request state reaches Delivered.
      openPullRequests: [],
    });
    expect(board.columns.flatMap(column => column.cards)[0]?.column).toBe('ready');
    expect(board.columns.find(column => column.id === 'delivered')?.cards).toEqual([]);
  });
});

describe('blocked', () => {
  it('columns an item that is waiting and unstarted as Blocked', () => {
    expect(columnOf([{ id: 'a' }, { id: 'b', after: ['a'] }], 'b')).toBe('blocked');
  });

  it('shows a started item as started, with what it is still waiting on', () => {
    // Both facts are true and the work is the more advanced one. Hiding it
    // would be the bigger lie.
    const graph = plan([{ id: 'a' }, { id: 'b', after: ['a'], branch: 'feat/b' }]);
    const board = buildRoadmapBoard(graph.nodes, { branchNames: ['feat/b'], openPullRequests: [] });
    const card = board.columns.flatMap(column => column.cards).find(entry => entry.nodeId === 'b');

    expect(card?.column).toBe('in-progress');
    expect(card?.waitingOnCount).toBe(1);
  });

  it('does not count a delivered prerequisite as something to wait for', () => {
    expect(columnOf([{ id: 'a', completed: true }, { id: 'b', after: ['a'] }], 'b')).toBe('ready');
  });
});

describe('unassessed is not empty', () => {
  it('says the evidence was not gathered rather than reporting nothing started', () => {
    // Silence earned by not looking is what would make this board worse than
    // no board at all.
    const board = buildRoadmapBoard(nodesOf([{ id: 'a', branch: 'feat/a' }]), {});

    expect(board.branchEvidence).toBe('not-assessed');
    expect(board.pullRequestEvidence).toBe('not-assessed');
    expect(board.note).toContain('not where the work is');
  });

  it('separates looked-and-found-none from did-not-look', () => {
    const looked = buildRoadmapBoard(nodesOf([{ id: 'a' }]), { branchNames: [], openPullRequests: [] });
    expect(looked.branchEvidence).toBe('gathered');
    expect(looked.note).toBeUndefined();
  });

  it('names which half is missing when only one is', () => {
    const noPulls = buildRoadmapBoard(nodesOf([{ id: 'a' }]), { branchNames: [] });
    expect(noPulls.note).toContain('pull requests');
    const noBranches = buildRoadmapBoard(nodesOf([{ id: 'a' }]), { openPullRequests: [] });
    expect(noBranches.note).toContain('branches');
  });
});

describe('the board itself', () => {
  it('keeps the columns in a fixed order with their meaning stated', () => {
    const board = boardOf([{ id: 'a' }]);
    expect(board.columns.map(column => column.id))
      .toEqual(['blocked', 'ready', 'in-progress', 'in-review', 'delivered']);
    expect(board.columns.every(column => column.description.length > 0)).toBe(true);
  });

  it('orders a column by backlog priority, then by id', () => {
    const board = boardOf([{ id: 'first' }, { id: 'second' }, { id: 'third' }]);
    expect(board.columns.find(column => column.id === 'ready')?.cards.map(card => card.nodeId))
      .toEqual(['first', 'second', 'third']);
  });

  it('publishes the rules that placed the cards', () => {
    expect(boardOf([{ id: 'a' }]).rules).toBe(ROADMAP_BOARD_RULES);
  });
});

describe('the sentence above the board', () => {
  it('says how much is started and how much is waiting', () => {
    const board = buildRoadmapBoard(
      nodesOf([{ id: 'a', branch: 'feat/a' }, { id: 'b', after: ['a'] }, { id: 'c' }]),
      { branchNames: ['feat/a'], openPullRequests: [] },
    );
    expect(describeRoadmapBoard(board)).toBe('1 of 3 outstanding items have work started, 1 waiting on something else.');
  });

  it('does not congratulate an empty roadmap', () => {
    expect(describeRoadmapBoard(boardOf([]))).toBe('Nothing on the roadmap yet.');
    expect(describeRoadmapBoard(boardOf([{ id: 'a', completed: true }])))
      .toBe('Everything on the roadmap is delivered.');
  });
});
