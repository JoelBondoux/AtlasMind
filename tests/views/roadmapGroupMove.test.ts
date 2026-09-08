import { describe, expect, it } from 'vitest';

import { isProjectDashboardMessage } from '../../src/views/projectDashboardPanel.ts';

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
