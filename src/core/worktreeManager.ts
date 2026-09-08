import * as path from 'node:path';

import { normalizeWorktreePath, parseWorktreeList } from '../skills/gitWorktree.js';

/**
 * Creating, finding and removing the worktrees a run borrows.
 *
 * The git side of `worktreeIsolation`, which decides *whether* a subtask gets
 * one. Split because the decision is worth testing without a repository and the
 * plumbing is worth testing without a scheduler; the runner is injected, so
 * both halves are exercised without spawning git.
 *
 * Four rules, each of them about not damaging a repository AtlasMind borrowed:
 *
 * **Only worktrees this run created are ever removed.** Every path is checked
 * against `git worktree list --porcelain` *and* against this run's own
 * registry before removal. A worktree the operator made by hand, or one left by
 * another tool, is never touched — the same rule `localModelArbiter` applies to
 * models it did not load, for the same reason: a cleanup that tidies away
 * somebody else's work is worse than one that leaves litter.
 *
 * **A detached worktree, never a branch.** `git worktree add --detach` at the
 * current commit. Creating a branch per subtask would leave the repository
 * carrying branches nobody asked for, and a linked worktree *pins* its branch —
 * `git branch -d` then refuses, which is precisely the mess `skills/gitWorktree`
 * exists to clean up. Detached heads leave nothing pinned.
 *
 * **Paths are derived here, never accepted.** A caller supplies a run id and a
 * subtask id; the directory name is composed from them after both are reduced
 * to an identifier charset. Nothing a planner or a model produced becomes a
 * path segment, and nothing outside the container directory can be named.
 *
 * **Cleanup is best-effort and reported, never fatal.** A worktree that will
 * not remove — Windows read-only bits after OneDrive has been at it, a file
 * still open — must not fail a run whose actual work succeeded. It is reported
 * with its path so somebody can deal with it, and `git worktree prune` is left
 * to reclaim the registration later.
 */

/**
 * Runs a git command and returns its stdout, or throws. Injected so tests spawn
 * nothing.
 *
 * `stdin` exists for `git apply -`. Piping the patch rather than writing it to
 * a temp file is deliberate: a patch is workspace content, and a temp file
 * would put workspace content on disk *outside* the workspace, where none of
 * this project's boundaries reach it and nothing cleans it up after a crash.
 */
export type WorktreeGitRunner = (args: readonly string[], cwd: string, stdin?: string) => Promise<string>;

export interface WorktreeHandle {
  subTaskId: string;
  /** Absolute path to the linked worktree. */
  path: string;
}

export interface WorktreeCleanupReport {
  removed: string[];
  /** Paths that could not be removed, with why. Reported rather than thrown. */
  failed: Array<{ path: string; reason: string }>;
}

/**
 * Where linked worktrees live.
 *
 * Inside the repository's own `.git` directory rather than beside the
 * repository: a sibling directory would be picked up by editors, file watchers
 * and search, and a half-finished subtask's files appearing in the operator's
 * Quick Open is its own kind of damage. `.git` is already excluded from
 * everything that walks a project.
 */
export const WORKTREE_CONTAINER = path.join('.git', 'atlasmind-worktrees');

/** Reduce an id to something safe to use as one path segment. */
function toPathSegment(value: string): string {
  const cleaned = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned.length > 0 ? cleaned : 'subtask';
}

/**
 * The directory one subtask's worktree occupies.
 *
 * Exported so a caller can report it without asking for one to be created, and
 * so the composition is testable on its own — a path built from untrusted ids
 * is worth a test even when both ids come from AtlasMind's own planner.
 */
export function worktreePathFor(workspaceRoot: string, runId: string, subTaskId: string): string {
  return path.join(workspaceRoot, WORKTREE_CONTAINER, `${toPathSegment(runId)}-${toPathSegment(subTaskId)}`);
}

export class WorktreeManager {
  /** Worktrees this run created, by subtask. Only these are ever removed. */
  private readonly created = new Map<string, string>();

  constructor(
    private readonly workspaceRoot: string,
    private readonly runId: string,
    private readonly run: WorktreeGitRunner,
  ) {}

  /** Paths this run created, in creation order. */
  public list(): WorktreeHandle[] {
    return [...this.created.entries()].map(([subTaskId, worktreePath]) => ({ subTaskId, path: worktreePath }));
  }

  /**
   * Create a detached worktree at the current commit, or report why not.
   *
   * Returns `undefined` rather than throwing: an isolation failure must degrade
   * to running the subtask exclusively in the main tree, which is slower and
   * correct. Failing the subtask because a worktree could not be made would
   * turn an optimisation into a new way for a run to die.
   */
  public async create(subTaskId: string): Promise<WorktreeHandle | undefined> {
    const existing = this.created.get(subTaskId);
    if (existing) {
      return { subTaskId, path: existing };
    }

    const worktreePath = worktreePathFor(this.workspaceRoot, this.runId, subTaskId);
    try {
      await this.run(['worktree', 'add', '--detach', worktreePath, 'HEAD'], this.workspaceRoot);
    } catch {
      return undefined;
    }
    this.created.set(subTaskId, worktreePath);
    return { subTaskId, path: worktreePath };
  }

  /**
   * Remove the worktrees this run created.
   *
   * Checked against git's own registry first, so a path that git no longer
   * knows about is skipped rather than deleted from disk — this class does not
   * recursively remove directories, and a stale registration is `git worktree
   * prune`'s job.
   *
   * `only` narrows the sweep to named subtasks, and it is not a convenience: a
   * batch merges and tidies as it finishes while the next batch's worktrees may
   * already exist, so an unscoped sweep would remove a tree a subtask is about
   * to be run in.
   *
   * `keep` holds subtasks whose work did not come back — a patch that would not
   * apply, a merge that failed. Those are dropped from the registry without
   * being touched: the directory is the only copy of work nobody has seen, so it
   * stops being this run's to remove and becomes the operator's to look at.
   * Forgetting them is what stops a later sweep taking them anyway.
   */
  public async cleanup(options?: { only?: ReadonlySet<string>; keep?: ReadonlySet<string> }): Promise<WorktreeCleanupReport> {
    const report: WorktreeCleanupReport = { removed: [], failed: [] };
    for (const subTaskId of options?.keep ?? []) {
      this.created.delete(subTaskId);
    }
    const scope = [...this.created.keys()].filter(id => options?.only?.has(id) ?? true);
    if (scope.length === 0) {
      return report;
    }

    let registered: ReadonlySet<string>;
    try {
      const porcelain = await this.run(['worktree', 'list', '--porcelain'], this.workspaceRoot);
      registered = new Set(
        parseWorktreeList(porcelain)
          .filter(entry => !entry.isMain)
          .map(entry => normalizeWorktreePath(entry.path)),
      );
    } catch (error) {
      // Without the registry there is no way to tell one of ours from one of
      // theirs, and guessing is how a cleanup removes somebody's work.
      for (const subTaskId of scope) {
        report.failed.push({ path: this.created.get(subTaskId)!, reason: describe(error) });
        this.created.delete(subTaskId);
      }
      return report;
    }

    for (const subTaskId of scope) {
      const worktreePath = this.created.get(subTaskId)!;
      if (!registered.has(normalizeWorktreePath(worktreePath))) {
        // Already gone, or never registered. Not an error and not ours to delete.
        this.created.delete(subTaskId);
        continue;
      }
      try {
        await this.run(['worktree', 'remove', '--force', worktreePath], this.workspaceRoot);
        report.removed.push(worktreePath);
        this.created.delete(subTaskId);
      } catch (error) {
        report.failed.push({ path: worktreePath, reason: describe(error) });
        this.created.delete(subTaskId);
      }
    }

    return report;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
