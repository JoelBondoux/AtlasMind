import * as path from 'node:path';

/**
 * Where a skill's file path resolves from, and what it may never escape.
 *
 * These are two different questions, and the whole of this module is the
 * observation that they had one answer. `assertInsideWorkspace` used the open
 * workspace folder for both: it resolved `src/foo.ts` against it *and* checked
 * containment against it. That is correct while every subtask shares one tree,
 * and it is the thing that has to come apart for worktree isolation — a subtask
 * running in its own worktree must resolve `src/foo.ts` inside that worktree,
 * while still being unable to reach outside the workspace.
 *
 * **Resolution moves; containment does not.** The outer boundary stays the
 * workspace folder for every caller, which is why isolation needs no widening
 * of what a skill may touch: AtlasMind's worktrees live under
 * `.git/atlasmind-worktrees`, which is *inside* the workspace, so an isolated
 * subtask is contained by exactly the same rule as an ordinary one. Making
 * `resolveFrom` configurable and `containWithin` fixed is what keeps that true;
 * a single "root" parameter would have let a caller move the boundary by
 * accident while meaning only to move the resolution.
 *
 * **Symlinks are resolved before the comparison**, not after, so a link inside
 * the workspace cannot tunnel a read or a write to a target outside it. That
 * behaviour is inherited unchanged — it is the reason the check is async and
 * the reason `realpath` is injected rather than imported, so a test can exercise
 * the escape without creating one on disk.
 */

export interface WorkspaceBoundaryRequest {
  /** The path a skill asked for. Absolute, or relative to `resolveFrom`. */
  candidate: string;
  /**
   * Where a relative candidate is resolved from.
   *
   * The workspace folder for an ordinary subtask; that subtask's worktree when
   * it is running isolated.
   */
  resolveFrom: string;
  /**
   * The outer boundary. Always the workspace folder.
   *
   * Separate from `resolveFrom` on purpose: a caller that wanted to change
   * where paths resolve must not be able to change what they may reach by the
   * same act.
   */
  containWithin: string;
  /** Named in the error, so a refusal says which operation was refused. */
  operation: string;
  /** Canonicalises an existing path. Injected so the escape case is testable. */
  realpath: (target: string) => Promise<string>;
}

/**
 * Resolve a skill's path, or throw explaining why it was refused.
 *
 * Returns the canonical absolute path, which the caller uses — resolving twice
 * would give a symlink a second chance to point somewhere else between the
 * check and the use.
 */
export async function resolveWithinWorkspace(request: WorkspaceBoundaryRequest): Promise<string> {
  const { candidate, resolveFrom, containWithin, operation, realpath } = request;

  const resolvedBoundary = await realpath(path.resolve(containWithin));
  const resolved = await canonicalise(path.resolve(resolveFrom, candidate), realpath);

  const relative = path.relative(resolvedBoundary, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(
      `${operation} is restricted to the workspace. `
      + `"${candidate}" resolves outside "${resolvedBoundary}".`,
    );
  }
  return resolved;
}

/**
 * Canonicalise a path that may not exist yet.
 *
 * A write creates its target, so `realpath` on the full path fails; the
 * existing prefix is canonicalised and the missing tail re-joined. Doing it
 * this way rather than skipping the check for new files is what stops a write
 * through a symlinked *directory* landing outside the workspace.
 */
async function canonicalise(target: string, realpath: (value: string) => Promise<string>): Promise<string> {
  const pending: string[] = [];
  let current = target;

  for (;;) {
    try {
      const canonical = await realpath(current);
      return pending.length > 0 ? path.join(canonical, ...pending.reverse()) : canonical;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'ENOENT') {
        throw error;
      }
      const parsed = path.parse(current);
      if (current === parsed.root) {
        // Nothing on the way to the filesystem root exists, so there is no
        // canonical form to compare. Refusing rather than returning the
        // requested path preserves the behaviour this replaced: the containment
        // check would also have rejected it, but by a different rule, and a
        // boundary whose reason changes under refactoring is a boundary nobody
        // can reason about.
        throw new Error(`Unable to resolve workspace path boundary for "${target}".`);
      }

      pending.push(path.basename(current));
      current = path.dirname(current);
    }
  }
}
