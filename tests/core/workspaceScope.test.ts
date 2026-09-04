import { describe, expect, it } from 'vitest';
import { sanitizeProjectComposition, type ProjectComposition } from '../../src/core/projectComposition.ts';
import path from 'node:path';
import { resolveWorkspaceScope, type WorkspaceFolderReference } from '../../src/core/workspaceScope.ts';

/**
 * A workspace path in the host's own separator.
 *
 * These were written as literal Windows paths, which meant `path.basename`
 * split them on Windows and returned the whole string everywhere else — so the
 * suite passed on one developer's machine and failed on both CI runners that
 * were not Windows.
 */
const at = (...segments: string[]): string => path.join('C:', 'studio', ...segments);
/** A second tree, for the case where two folders share a basename. */
const elsewhere = (...segments: string[]): string => path.join('D:', 'other', ...segments);

const composition = (): ProjectComposition => sanitizeProjectComposition({
  components: [
    { id: 'gameplay', label: 'Gameplay', location: 'home', role: 'application', archetype: { archetype: 'game', traits: [] }, vcs: 'git', home: true },
    { id: 'backend', label: 'Backend', location: 'backend', role: 'service', archetype: { archetype: 'api', traits: ['has-server'] }, vcs: 'git' },
    { id: 'content', label: 'Content', location: 'content', role: 'content', archetype: { archetype: 'generic', traits: [] }, vcs: 'perforce' },
  ],
})!;

const folders = (): WorkspaceFolderReference[] => [
  { name: 'Gameplay', fsPath: at('home') },
  { name: 'Backend', fsPath: at('backend') },
  { name: 'Content', fsPath: at('content') },
];

describe('resolveWorkspaceScope', () => {
  it('defaults byte-for-byte to the first workspace folder without consulting composition', () => {
    const scope = resolveWorkspaceScope(folders().slice().reverse(), composition());
    expect(scope).toEqual({
      target: { kind: 'default' },
      label: 'Content',
      roots: [{ name: 'Content', fsPath: at('content') }],
      unknown: [],
      complete: true,
    });
  });

  it('resolves the declared home only when a caller opts in', () => {
    const scope = resolveWorkspaceScope(folders(), composition(), { kind: 'home' });
    expect(scope.roots).toEqual([
      expect.objectContaining({ componentId: 'gameplay', fsPath: at('home'), vcs: 'git' }),
    ]);
    expect(scope.complete).toBe(true);
  });

  it('resolves one explicitly named component', () => {
    const scope = resolveWorkspaceScope(folders(), composition(), { kind: 'component', componentId: 'content' });
    expect(scope.label).toBe('Content');
    expect(scope.roots[0]).toMatchObject({ componentId: 'content', vcs: 'perforce' });
  });

  it('labels partial all-component coverage and keeps the missing component unknown', () => {
    const scope = resolveWorkspaceScope(folders().slice(0, 2), composition(), { kind: 'all' });
    expect(scope.roots).toHaveLength(2);
    expect(scope.unknown).toEqual([
      { componentId: 'content', componentLabel: 'Content', vcs: 'perforce', reason: 'not-open' },
    ]);
    expect(scope.label).toBe('All declared components (2 of 3 visible)');
    expect(scope.complete).toBe(false);
  });

  it('does not convert an unreadable or ambiguous component into a root', () => {
    const unreadable = folders();
    unreadable[2]!.readable = false;
    expect(resolveWorkspaceScope(unreadable, composition(), { kind: 'component', componentId: 'content' }).unknown)
      .toEqual([expect.objectContaining({ reason: 'unreadable' })]);

    const ambiguous = [...folders(), { name: 'Content copy', fsPath: elsewhere('content') }];
    expect(resolveWorkspaceScope(ambiguous, composition(), { kind: 'component', componentId: 'content' }).unknown)
      .toEqual([expect.objectContaining({ reason: 'ambiguous' })]);
  });

  it('returns no scope when no workspace exists or composition was not declared', () => {
    expect(resolveWorkspaceScope([]).complete).toBe(false);
    expect(resolveWorkspaceScope(folders(), undefined, { kind: 'all' })).toMatchObject({
      label: 'Composition not declared', roots: [], complete: false,
    });
  });
});
