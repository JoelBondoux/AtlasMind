import { describe, expect, it, vi } from 'vitest';

import { ProjectDashboardPanel, isProjectDashboardMessage } from '../../src/views/projectDashboardPanel.ts';

/**
 * The gate in front of a box-selected group move.
 *
 * A group drag posts one message carrying many `{ nodeId, x, y }` entries
 * rather than N single moves, because each single move re-reads the roadmap,
 * rewrites the file and triggers a refresh — twenty selected nodes would be
 * twenty writes with the canvas re-rendering under the pointer partway through.
 *
 * Taking an array from a webview means the validator has to say what it will
 * accept, which is what these cover. What the *host* then does with a valid
 * batch — resolve each id against the roadmap it re-reads, skip the ones it
 * cannot, and say so — is the same resolution the single-node path uses.
 */

const MOVE = { nodeId: 'roadmap-node-1', x: 120, y: 240 };

function batch(moves: unknown): unknown {
  return { type: 'roadmapNodesMove', payload: { moves } };
}

describe('a group move is validated entry by entry', () => {
  it('accepts a well-formed batch', () => {
    expect(isProjectDashboardMessage(batch([MOVE, { nodeId: 'roadmap-node-2', x: 0, y: 0 }]))).toBe(true);
  });

  it('checks every entry rather than sampling the first', () => {
    // A batch validator that checks entry zero and trusts the rest is a
    // validator with an offset.
    expect(isProjectDashboardMessage(batch([MOVE, { nodeId: '', x: 1, y: 1 }]))).toBe(false);
    expect(isProjectDashboardMessage(batch([MOVE, MOVE, { nodeId: 'ok', x: 'nope', y: 1 }]))).toBe(false);
  });

  it.each([
    ['a non-finite coordinate', [{ nodeId: 'a', x: Number.NaN, y: 0 }]],
    ['an infinite coordinate', [{ nodeId: 'a', x: Number.POSITIVE_INFINITY, y: 0 }]],
    ['a missing id', [{ x: 1, y: 2 }]],
    ['a non-string id', [{ nodeId: 42, x: 1, y: 2 }]],
    ['a whitespace-only id', [{ nodeId: '   ', x: 1, y: 2 }]],
    ['a null entry', [null]],
  ])('rejects %s', (_label, moves) => {
    expect(isProjectDashboardMessage(batch(moves))).toBe(false);
  });

  it.each([
    ['an empty array', []],
    ['a string', 'roadmap-node-1'],
    ['an object', { nodeId: 'a', x: 1, y: 2 }],
    ['undefined', undefined],
  ])('rejects %s in place of a move list', (_label, moves) => {
    expect(isProjectDashboardMessage(batch(moves))).toBe(false);
  });

  it('rejects a payload that is not an object at all', () => {
    expect(isProjectDashboardMessage({ type: 'roadmapNodesMove', payload: 'everything' })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'roadmapNodesMove' })).toBe(false);
  });

  it('still accepts the single-node message it did not replace', () => {
    // The group path is additive. A single drag keeps posting the singular
    // message, so the common case does not pay for the batch machinery.
    expect(isProjectDashboardMessage({ type: 'roadmapNodeMove', payload: MOVE })).toBe(true);
  });

  it('holds a single move and a batch entry to the same standard', () => {
    // Both go through one predicate. Two would eventually disagree, and the
    // symptom would be a position refused on its own and accepted inside a
    // group.
    const bad = { nodeId: 'a', x: Number.NaN, y: 0 };

    expect(isProjectDashboardMessage({ type: 'roadmapNodeMove', payload: bad })).toBe(false);
    expect(isProjectDashboardMessage(batch([bad]))).toBe(false);
  });
});


describe('delivered view message boundary', () => {
  it('accepts scoped moves and layouts, while retaining legacy plan messages', () => {
    expect(isProjectDashboardMessage({ type: 'roadmapNodeMove', payload: { ...MOVE, view: 'completed' } })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'roadmapNodesMove', payload: { moves: [MOVE], view: 'completed' } })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'roadmapAutoLayout', payload: 'vertical', view: 'completed' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'roadmapAutoLayout', payload: 'chronological', view: 'completed' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'roadmapAutoLayout', payload: 'chronological' })).toBe(false);
  });
  it('rejects invented layout scopes instead of applying them to the plan', () => {
    expect(isProjectDashboardMessage({ type: 'roadmapNodeMove', payload: { ...MOVE, view: 'all' } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'roadmapNodesMove', payload: { moves: [MOVE], view: 'all' } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'roadmapAutoLayout', payload: 'vertical', view: 'all' })).toBe(false);
  });
});


describe('delivered writes keep plan layout intact', () => {
  function harness() {
    const document = { version: 1, layoutOrientation: 'horizontal', nodes: [{
      id: 'kept', normalizedText: 'kept', position: { x: 100, y: 200 }, completionPosition: { x: 300, y: 400 },
    }], edges: [], dismissed: [], suggestLinks: false, updatedAt: '2026-10-19T00:00:00Z' };
    const commit = vi.fn();
    const panel = Object.assign(Object.create(ProjectDashboardPanel.prototype) as {
      handleRoadmapNodeMove(payload: unknown): Promise<void>;
      handleRoadmapNodesMove(payload: unknown): Promise<void>;
      handleRoadmapAutoLayout(layout: string, view?: string): Promise<void>;
    }, {
      openRoadmapGraphForWrite: async () => ({ document, workspaceRoot: 'test', ssotPath: 'memory', nodeText: new Map([['kept', 'kept']]) }),
      commitRoadmapGraph: commit,
    });
    return { panel, commit, document };
  }
  it.each(['single', 'group'])('saves a %s delivered move to its own pin', async kind => {
    const h = harness();
    const move = { nodeId: 'kept', x: 700, y: 800 };
    if (kind === 'single') { await h.panel.handleRoadmapNodeMove({ ...move, view: 'completed' }); }
    else { await h.panel.handleRoadmapNodesMove({ moves: [move], view: 'completed' }); }
    const saved = h.commit.mock.calls[0]![2];
    expect(saved.nodes[0].position).toEqual({ x: 100, y: 200 });
    expect(saved.nodes[0].completionPosition).toEqual({ x: 700, y: 800 });
    expect(h.document.nodes[0]!.completionPosition).toEqual({ x: 300, y: 400 });
  });
  it('releases plan pins while keeping delivered pins', async () => {
    const h = harness();
    await h.panel.handleRoadmapAutoLayout('vertical');
    const saved = h.commit.mock.calls[0]![2];
    expect(saved.nodes[0].position).toBeUndefined();
    expect(saved.nodes[0].completionPosition).toEqual({ x: 300, y: 400 });
  });
  it('releases only delivered pins when arranging delivered work', async () => {
    const h = harness();
    await h.panel.handleRoadmapAutoLayout('vertical', 'completed');
    const saved = h.commit.mock.calls[0]![2];
    expect(saved.layoutOrientation).toBe('horizontal');
    expect(saved.completionLayout).toBe('vertical');
    expect(saved.nodes[0].position).toEqual({ x: 100, y: 200 });
    expect(saved.nodes[0].completionPosition).toBeUndefined();
  });
});
