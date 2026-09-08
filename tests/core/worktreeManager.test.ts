import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  WORKTREE_CONTAINER,
  WorktreeManager,
  worktreePathFor,
} from '../../src/core/worktreeManager.ts';

/**
 * The git side of worktree isolation.
 *
 * Every property here is about not damaging a repository AtlasMind borrowed:
 * removing only what this run created, leaving no branches behind, deriving
 * paths rather than accepting them, and failing softly enough that an
 * optimisation cannot kill a run.
 *
 * The runner is injected, so none of this spawns git.
 */

const ROOT = path.join('/repo');

function fakeGit(responses: Record<string, string | Error> = {}) {
  const calls: string[][] = [];
  const run = vi.fn(async (args: readonly string[]) => {
    calls.push([...args]);
    const key = args.join(' ');
    const match = Object.entries(responses).find(([prefix]) => key.startsWith(prefix));
    if (match) {
      if (match[1] instanceof Error) { throw match[1]; }
      return match[1];
    }
    return '';
  });
  return { run, calls };
}

/** A porcelain listing whose non-main entries are the given paths. */
function porcelain(...worktrees: string[]): string {
  return [`worktree ${ROOT}`, 'bare', '', ...worktrees.flatMap(p => [`worktree ${p}`, 'detached', ''])].join('\n');
}

describe('paths are derived, never accepted', () => {
  it('composes a directory from the ids after reducing them to a safe charset', () => {
    const derived = worktreePathFor(ROOT, 'Run 42', 'Add Stripe/checkout');

    expect(derived).toBe(path.join(ROOT, WORKTREE_CONTAINER, 'run-42-add-stripe-checkout'));
  });

  it('cannot be made to escape the container', () => {
    // Both ids come from AtlasMind's own planner today. That is a reason to
    // keep it true, not a reason to skip the test.
    const derived = worktreePathFor(ROOT, '../../etc', '../../../passwd');

    expect(derived.startsWith(path.join(ROOT, WORKTREE_CONTAINER))).toBe(true);
    expect(derived).not.toContain('..');
  });

  it('falls back to a name rather than an empty segment', () => {
    expect(worktreePathFor(ROOT, '', '!!!')).toBe(path.join(ROOT, WORKTREE_CONTAINER, 'subtask-subtask'));
  });

  it('lives inside .git, out of the way of editors and search', () => {
    // A sibling directory would show a half-finished subtask's files in Quick
    // Open, which is its own kind of damage.
    expect(WORKTREE_CONTAINER.startsWith('.git')).toBe(true);
  });
});

describe('creating a worktree', () => {
  it('detaches rather than making a branch', () => {
    // A linked worktree pins its branch, so `git branch -d` then refuses —
    // exactly the mess the worktree skill exists to clean up.
    const git = fakeGit();
    const manager = new WorktreeManager(ROOT, 'run-1', git.run);

    return manager.create('edit').then(() => {
      expect(git.calls[0]).toContain('--detach');
      expect(git.calls[0]?.join(' ')).not.toContain('-b ');
    });
  });

  it('reuses the worktree it already made for a subtask', async () => {
    const git = fakeGit();
    const manager = new WorktreeManager(ROOT, 'run-1', git.run);

    const first = await manager.create('edit');
    const second = await manager.create('edit');

    expect(second).toEqual(first);
    expect(git.run).toHaveBeenCalledTimes(1);
  });

  it('degrades to undefined rather than throwing when git refuses', async () => {
    // Failing the subtask because a worktree could not be made would turn an
    // optimisation into a new way for a run to die. The caller runs it
    // exclusively in the main tree instead: slower, and correct.
    const git = fakeGit({ 'worktree add': new Error('fatal: not a git repository') });
    const manager = new WorktreeManager(ROOT, 'run-1', git.run);

    await expect(manager.create('edit')).resolves.toBeUndefined();
    expect(manager.list()).toEqual([]);
  });
});

describe('cleanup removes only what this run created', () => {
  it('removes its own worktrees', async () => {
    const expected = worktreePathFor(ROOT, 'run-1', 'edit');
    const git = fakeGit({ 'worktree list': porcelain(expected) });
    const manager = new WorktreeManager(ROOT, 'run-1', git.run);
    await manager.create('edit');

    const report = await manager.cleanup();

    expect(report.removed).toEqual([expected]);
    expect(report.failed).toEqual([]);
    expect(manager.list()).toEqual([]);
  });

  it('never removes a worktree it did not create', async () => {
    // Somebody else's worktree is registered and must survive. The same rule
    // the local-model arbiter applies to models it did not load.
    const mine = worktreePathFor(ROOT, 'run-1', 'edit');
    const theirs = path.join(ROOT, '..', 'hand-made-worktree');
    const git = fakeGit({ 'worktree list': porcelain(mine, theirs) });
    const manager = new WorktreeManager(ROOT, 'run-1', git.run);
    await manager.create('edit');

    await manager.cleanup();

    const removals = git.calls.filter(args => args[0] === 'worktree' && args[1] === 'remove');
    expect(removals).toHaveLength(1);
    expect(removals[0]?.join(' ')).toContain(mine);
    expect(removals[0]?.join(' ')).not.toContain('hand-made-worktree');
  });

  it('skips a path git no longer knows about rather than deleting it from disk', async () => {
    // This class does not recursively remove directories. A stale registration
    // is `git worktree prune`'s job.
    const git = fakeGit({ 'worktree list': porcelain() });
    const manager = new WorktreeManager(ROOT, 'run-1', git.run);
    await manager.create('edit');

    const report = await manager.cleanup();

    expect(report.removed).toEqual([]);
    expect(git.calls.some(args => args[1] === 'remove')).toBe(false);
  });

  it('reports a worktree that will not remove instead of failing the run', async () => {
    // Windows read-only bits after OneDrive, a file still open. The run's
    // actual work succeeded; this is litter, not a failure.
    const mine = worktreePathFor(ROOT, 'run-1', 'edit');
    const git = fakeGit({
      'worktree list': porcelain(mine),
      'worktree remove': new Error('EPERM: operation not permitted'),
    });
    const manager = new WorktreeManager(ROOT, 'run-1', git.run);
    await manager.create('edit');

    const report = await manager.cleanup();

    expect(report.removed).toEqual([]);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]?.path).toBe(mine);
    expect(report.failed[0]?.reason).toContain('EPERM');
  });

  it('removes nothing when it cannot read the registry', async () => {
    // Without the registry there is no way to tell one of ours from one of
    // theirs, and guessing is how a cleanup removes somebody's work.
    const git = fakeGit({ 'worktree list': new Error('git exploded') });
    const manager = new WorktreeManager(ROOT, 'run-1', git.run);
    await manager.create('edit');

    const report = await manager.cleanup();

    expect(git.calls.some(args => args[1] === 'remove')).toBe(false);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]?.reason).toContain('git exploded');
  });

  it('does nothing at all when the run created none', async () => {
    const git = fakeGit();
    const manager = new WorktreeManager(ROOT, 'run-1', git.run);

    expect(await manager.cleanup()).toEqual({ removed: [], failed: [] });
    expect(git.run).not.toHaveBeenCalled();
  });
});
