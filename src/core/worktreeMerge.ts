import type { WorktreeGitRunner } from './worktreeManager.js';

/**
 * Getting an isolated subtask's work back into the tree the operator is looking at.
 *
 * The half of worktree isolation that decides whether the feature is worth
 * having. Isolation is only useful if the work comes back; it is only *safe* if
 * work that cannot come back cleanly is neither lost nor forced.
 *
 * **A patch, not a file copy.** `git diff` in the worktree and `git apply` in
 * the main tree, so git's own three-way machinery decides whether the change
 * still fits. Copying changed files over would silently overwrite whatever the
 * main tree had — which is the write race this whole feature exists to remove,
 * moved to the end of the run and made harder to notice.
 *
 * **Applied one at a time.** The subtasks ran in parallel; their patches do
 * not. Applying concurrently would reintroduce the race at merge time, and it
 * would be worse there, because by then the run reports itself finished.
 *
 * **A conflict is reported and the worktree is kept.** Never `--3way`, which
 * can leave conflict markers in a file and call that success: a subtask's work
 * half-applied into a file nobody has read is worse than a subtask's work
 * sitting in a directory somebody can be told about. `git apply --check` runs
 * first so a refusal happens before anything is written rather than partway
 * through.
 *
 * **New files are included, which takes an extra step.** `git diff` shows
 * tracked changes only, so a subtask that created a file would have had it
 * silently dropped. `git add --intent-to-add` registers new paths first so they
 * appear in the diff — the kind of omission that would have looked like the
 * model failing to create the file.
 *
 * Runner injected, so all of this tests without a repository.
 */

export type WorktreeMergeStatus = 'applied' | 'nothing-to-merge' | 'conflicted' | 'failed';

export interface WorktreeMergeOutcome {
  subTaskId: string;
  worktreePath: string;
  status: WorktreeMergeStatus;
  /** Present when the status is not a clean success. Never a patch body. */
  detail?: string;
}

export interface WorktreeMergeSource {
  subTaskId: string;
  worktreePath: string;
}

/**
 * Collect a worktree's uncommitted work as a patch.
 *
 * Returns an empty string when the subtask changed nothing, which is an
 * ordinary outcome — a research subtask that happened to hold a write skill
 * and never used it.
 */
export async function collectWorktreePatch(
  run: WorktreeGitRunner,
  worktreePath: string,
): Promise<string> {
  // Registers new files so they appear in the diff. Intent-to-add stages a
  // path without its content, so this cannot itself commit anything.
  await run(['add', '--intent-to-add', '--all'], worktreePath);
  return run(['diff', 'HEAD', '--binary'], worktreePath);
}

/**
 * Apply one worktree's work to the main tree.
 *
 * Checked before applied, so a patch that will not fit is refused before
 * anything is written rather than partway through.
 */
export async function applyWorktreePatch(
  run: WorktreeGitRunner,
  workspaceRoot: string,
  patch: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (patch.trim().length === 0) {
    return { ok: true };
  }
  try {
    await run(['apply', '--check', '-'], workspaceRoot, patch);
  } catch (error) {
    return { ok: false, reason: describe(error) };
  }
  try {
    await run(['apply', '-'], workspaceRoot, patch);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: describe(error) };
  }
}

/**
 * Merge every isolated worktree back, in order, reporting each.
 *
 * Never throws: a run whose work succeeded must not fail because one subtask's
 * changes would not apply. The outcome list is the report, and a caller that
 * ignores it is the only way this becomes silent.
 */
export async function mergeWorktrees(
  run: WorktreeGitRunner,
  workspaceRoot: string,
  sources: readonly WorktreeMergeSource[],
): Promise<WorktreeMergeOutcome[]> {
  const outcomes: WorktreeMergeOutcome[] = [];

  // Sequential on purpose. `for ... of` with `await` rather than `Promise.all`:
  // the subtasks ran in parallel, their patches must not.
  for (const source of sources) {
    let patch: string;
    try {
      patch = await collectWorktreePatch(run, source.worktreePath);
    } catch (error) {
      outcomes.push({ ...source, status: 'failed', detail: describe(error) });
      continue;
    }

    if (patch.trim().length === 0) {
      outcomes.push({ ...source, status: 'nothing-to-merge' });
      continue;
    }

    const applied = await applyWorktreePatch(run, workspaceRoot, patch);
    outcomes.push(applied.ok
      ? { ...source, status: 'applied' }
      : { ...source, status: 'conflicted', detail: applied.reason });
  }

  return outcomes;
}

/**
 * Which worktrees must survive cleanup.
 *
 * Anything that did not merge cleanly. Removing it would destroy the only copy
 * of that subtask's work, and the operator has not seen it yet — the whole
 * reason a conflict is reported rather than resolved.
 */
export function worktreesToKeep(outcomes: readonly WorktreeMergeOutcome[]): string[] {
  return outcomes
    .filter(outcome => outcome.status === 'conflicted' || outcome.status === 'failed')
    .map(outcome => outcome.subTaskId);
}

/**
 * What to tell the operator, or nothing.
 *
 * Silent when every subtask merged or had nothing to merge, because a line on
 * every run saying "all fine" is the line people stop reading before the run
 * where it says something else.
 */
export function describeWorktreeMerge(outcomes: readonly WorktreeMergeOutcome[]): string {
  const kept = outcomes.filter(o => o.status === 'conflicted' || o.status === 'failed');
  if (kept.length === 0) {
    return '';
  }

  const applied = outcomes.filter(o => o.status === 'applied').length;
  const lead = kept.length === 1
    ? "One subtask's changes could not be applied to your working tree."
    : `${kept.length} subtasks' changes could not be applied to your working tree.`;

  return [
    lead,
    applied > 0 ? `${applied} merged cleanly.` : '',
    // The path, because the work is real and recoverable and somebody has to be
    // able to find it.
    'Their worktrees have been left in place so nothing is lost:',
    ...kept.map(outcome => `  ${outcome.worktreePath}${outcome.detail ? ` — ${outcome.detail}` : ''}`),
  ].filter(Boolean).join('\n');
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
