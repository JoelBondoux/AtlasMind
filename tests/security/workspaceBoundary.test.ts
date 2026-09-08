import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { resolveWithinWorkspace } from '../../src/core/workspaceBoundary.ts';

/**
 * The file boundary every skill read and write passes through.
 *
 * Two roots doing two jobs, which used to be one root doing both: a path
 * resolves from wherever the subtask is running, and may never escape the
 * workspace whatever that is. Worktree isolation moves the first and must not
 * be able to move the second.
 */

const WORKSPACE = path.resolve('/workspace');
const WORKTREE = path.join(WORKSPACE, '.git', 'atlasmind-worktrees', 'run-1-edit');

/** A realpath that resolves nothing, so paths compare as written. */
const identity = vi.fn(async (target: string) => target);

/** A realpath where `link` is a symlink pointing outside the workspace. */
const symlinked = vi.fn(async (target: string) => {
  if (target === path.join(WORKSPACE, 'link')) {
    return path.resolve('/elsewhere/secrets');
  }
  return target;
});

function ask(candidate: string, resolveFrom = WORKSPACE, realpath = identity) {
  return resolveWithinWorkspace({
    candidate,
    resolveFrom,
    containWithin: WORKSPACE,
    operation: 'readFile',
    realpath,
  });
}

describe('a relative path resolves from where the subtask is running', () => {
  it('resolves against the workspace for an ordinary subtask', async () => {
    await expect(ask('src/foo.ts')).resolves.toBe(path.join(WORKSPACE, 'src', 'foo.ts'));
  });

  it('resolves against the worktree for an isolated one', async () => {
    // The whole point of the split: the same relative path means a different
    // file depending on which tree the subtask is in.
    await expect(ask('src/foo.ts', WORKTREE)).resolves.toBe(path.join(WORKTREE, 'src', 'foo.ts'));
  });

  it('leaves an absolute path alone when there is only one tree', async () => {
    const absolute = path.join(WORKSPACE, 'docs', 'readme.md');
    await expect(ask(absolute)).resolves.toBe(absolute);
  });
});

describe('an absolute path into the workspace names the isolated copy', () => {
  /*
   * A relative path follows the resolution root for free. An absolute one does
   * not, and a subtask handed `<workspace>/src/a.ts` in a dependency's output
   * would write straight back into the tree it was isolated from — the race,
   * arriving by the one route the resolution root does not cover.
   *
   * These replace an earlier assertion that an absolute path passed through
   * untouched. That described what the boundary did when nothing had two trees
   * yet; it is a hole now that something does.
   */

  it('re-roots a path that names the main tree', async () => {
    await expect(ask(path.join(WORKSPACE, 'src', 'a.ts'), WORKTREE))
      .resolves.toBe(path.join(WORKTREE, 'src', 'a.ts'));
  });

  it('leaves a path already inside the worktree where it is', async () => {
    const inside = path.join(WORKTREE, 'src', 'a.ts');
    await expect(ask(inside, WORKTREE)).resolves.toBe(inside);
  });

  it('re-roots a relative path that climbs out of the worktree', async () => {
    // `../../../src/a.ts` from the worktree lands in the main tree, which is
    // the same escape spelled differently.
    await expect(ask(path.join('..', '..', '..', 'src', 'a.ts'), WORKTREE))
      .resolves.toBe(path.join(WORKTREE, 'src', 'a.ts'));
  });

  it('sends another subtask\'s worktree nowhere useful rather than through', async () => {
    // Position is preserved, so a path naming a sibling worktree is re-rooted
    // under this one and simply does not exist. Reaching into another
    // subtask's tree fails instead of succeeding.
    const sibling = path.join(WORKSPACE, '.git', 'atlasmind-worktrees', 'run-1-other', 'src', 'a.ts');
    await expect(ask(sibling, WORKTREE)).resolves.toBe(
      path.join(WORKTREE, '.git', 'atlasmind-worktrees', 'run-1-other', 'src', 'a.ts'),
    );
  });

  it('leaves a path outside the workspace exactly as it came', async () => {
    // So the refusal names the path the caller asked for rather than one this
    // rule invented on the way past.
    await expect(ask(path.resolve('/etc/passwd'), WORKTREE))
      .rejects.toThrow(/"[^"]*passwd" resolves outside/);
  });

  it('cannot fire at all when one root is used as both', async () => {
    // The property that makes this safe to have added: with a single root,
    // "inside the boundary but outside the resolution root" is empty, so
    // ordinary resolution is untouched by construction rather than by care.
    const candidates = [
      path.join(WORKSPACE, 'src', 'a.ts'),
      path.join(WORKSPACE, '.git', 'atlasmind-worktrees', 'run-1-edit', 'src', 'a.ts'),
      WORKSPACE,
    ];
    for (const candidate of candidates) {
      await expect(ask(candidate)).resolves.toBe(candidate);
    }
  });
});

describe('containment does not move when resolution does', () => {
  it('still refuses an escape from inside a worktree', async () => {
    // A caller that changed where paths resolve must not have changed what
    // they may reach by the same act.
    await expect(ask('../../../../etc/passwd', WORKTREE)).rejects.toThrow(/restricted to the workspace/);
  });

  it('refuses an absolute path outside the workspace', async () => {
    await expect(ask(path.resolve('/etc/passwd'))).rejects.toThrow(/restricted to the workspace/);
  });

  it('accepts the worktree itself, because it is inside the workspace', async () => {
    // This is why isolation needs no widening: AtlasMind's worktrees live under
    // `.git/`, which the existing boundary already contains.
    await expect(ask(WORKTREE)).resolves.toBe(WORKTREE);
  });

  it('names the operation and the boundary in the refusal', async () => {
    await expect(
      resolveWithinWorkspace({
        candidate: path.resolve('/etc/passwd'),
        resolveFrom: WORKSPACE,
        containWithin: WORKSPACE,
        operation: 'writeFile',
        realpath: identity,
      }),
    ).rejects.toThrow(/^writeFile is restricted/);
  });
});

describe('symlinks are resolved before the comparison, not after', () => {
  it('refuses a link inside the workspace that points outside it', async () => {
    // Comparing the written path would pass this: it starts inside. The escape
    // only shows up once the link is followed.
    await expect(ask('link', WORKSPACE, symlinked)).rejects.toThrow(/restricted to the workspace/);
  });

  it('refuses a path *through* a symlinked directory that leaves the workspace', async () => {
    // The case that makes canonicalising a not-yet-existing path worth the
    // trouble: the file does not exist, but the directory it would be created
    // in is a link out.
    const throughLink = vi.fn(async (target: string) => {
      // The workspace itself always resolves — it is the boundary being
      // compared against, not part of the candidate path.
      if (target === WORKSPACE) { return WORKSPACE; }
      if (target === path.join(WORKSPACE, 'link')) {
        return path.resolve('/elsewhere');
      }
      const error = new Error('missing') as Error & { code?: string };
      error.code = 'ENOENT';
      throw error;
    });

    await expect(ask(path.join('link', 'new-file.txt'), WORKSPACE, throughLink))
      .rejects.toThrow(/restricted to the workspace/);
  });
});

describe('a file that does not exist yet is still checked', () => {
  it('allows a new file inside the workspace', async () => {
    const missing = vi.fn(async (target: string) => {
      if (target === WORKSPACE) { return WORKSPACE; }
      const error = new Error('missing') as Error & { code?: string };
      error.code = 'ENOENT';
      throw error;
    });

    await expect(ask('src/brand-new.ts', WORKSPACE, missing))
      .resolves.toBe(path.join(WORKSPACE, 'src', 'brand-new.ts'));
  });

  it('refuses when nothing on the path exists at all', async () => {
    // Behaviour preserved from the implementation this replaced: it threw
    // rather than returning the requested path. The containment check would
    // have rejected it too, but by a different rule — and a boundary whose
    // reason changes under refactoring is one nobody can reason about.
    const nothingExists = vi.fn(async (target: string) => {
      if (target === WORKSPACE) { return WORKSPACE; }
      const error = new Error('missing') as Error & { code?: string };
      error.code = 'ENOENT';
      throw error;
    });

    await expect(
      resolveWithinWorkspace({
        candidate: path.resolve('/no-such-root/file.txt'),
        resolveFrom: WORKSPACE,
        containWithin: WORKSPACE,
        operation: 'readFile',
        realpath: nothingExists,
      }),
    ).rejects.toThrow(/Unable to resolve workspace path boundary/);
  });

  it('propagates a realpath failure that is not "missing"', async () => {
    // A permissions error is not a missing file, and swallowing it would turn
    // an unreadable path into an allowed one.
    const denied = vi.fn(async () => {
      const error = new Error('EACCES') as Error & { code?: string };
      error.code = 'EACCES';
      throw error;
    });

    await expect(ask('src/foo.ts', WORKSPACE, denied)).rejects.toThrow(/EACCES/);
  });
});
