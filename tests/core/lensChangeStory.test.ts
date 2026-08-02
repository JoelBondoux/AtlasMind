import { describe, expect, it } from 'vitest';

import { buildLensChangeStory } from '../../src/core/lensChangeStory';

const HASH = 'a'.repeat(40);

describe('Lens change story', () => {
  it('classifies bounded changed paths while retaining commit intent and safe targets', () => {
    const map = buildLensChangeStory({
      branch: 'feature/lens', baseRef: 'origin/main', mergeBase: HASH,
      workspace: { name: 'web', index: 0 }, worktreeDirty: true,
      commits: [{ hash: 'b'.repeat(40), subject: 'feat: add checkout', author: 'Developer', authoredAt: '2026-08-01T10:00:00Z' }],
      changes: [
        { status: 'modified', workspacePath: 'src/checkout.ts' },
        { status: 'added', workspacePath: 'tests/checkout.test.ts' },
        { status: 'modified', workspacePath: 'schemas/checkout.graphql' },
        { status: 'deleted', workspacePath: 'docs/old.md' },
        { status: 'renamed', previousPath: 'src/old.ts', workspacePath: 'src/new.ts' },
      ],
    });

    expect(map.categoryCounts).toEqual(expect.objectContaining({ source: 2, test: 1, 'contract-schema': 1, documentation: 1 }));
    expect(map.changes.find(change => change.workspacePath === 'src/checkout.ts')?.target).toEqual(expect.objectContaining({ kind: 'relation' }));
    expect(map.changes.find(change => change.status === 'deleted')?.target).toBeUndefined();
    expect(map.notices.join(' ')).toContain('uncommitted changes');
    expect(map.notices.join(' ')).toContain('not a replacement for the Git diff');
  });

  it('fails closed for unsafe paths, duplicate evidence, and malformed commits', () => {
    const base = {
      branch: 'feature', baseRef: 'main', mergeBase: HASH,
      workspace: { name: 'web', index: 0 }, worktreeDirty: false,
      commits: [{ hash: 'b'.repeat(40), subject: 'change', author: 'Dev', authoredAt: '2026-08-01T10:00:00Z' }],
    };
    expect(() => buildLensChangeStory({ ...base, changes: [{ status: 'modified', workspacePath: '../secret' }] })).toThrow();
    expect(() => buildLensChangeStory({
      ...base,
      changes: [{ status: 'modified', workspacePath: 'src/a.ts' }, { status: 'modified', workspacePath: 'src/a.ts' }],
    })).toThrow();
    expect(() => buildLensChangeStory({
      ...base,
      commits: [{ hash: 'not-a-hash', subject: 'change', author: 'Dev', authoredAt: 'today' }],
      changes: [],
    })).toThrow();
  });
});
