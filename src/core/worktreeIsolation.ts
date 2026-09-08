/**
 * How a batch of parallel subtasks is kept from writing over each other.
 *
 * `taskScheduler` runs up to five subtasks at once (`chunkArray(batch, 5)` into
 * `Promise.all`) against **one working tree**, and nothing anywhere serialises
 * writes — no lock, no queue. Two independent subtasks editing the same file is
 * a read-modify-write race whose loser disappears silently: the run reports
 * both as completed and one of the two changes is simply not there.
 *
 * The obvious remedy is a git worktree per subtask, and it works for some
 * subtasks and cannot work for others. **A fresh worktree has no
 * `node_modules`, no build output and no untracked state** — it is a checkout
 * of tracked files. A subtask carrying `test-run` or `terminal-run` would land
 * somewhere its own tools cannot run, and "the tests failed" would be a fact
 * about the isolation rather than about the code. That is not a detail to be
 * solved later with a dependency install: installing per subtask is minutes of
 * wall clock and gigabytes of disk, five times over, for a batch that may take
 * seconds.
 *
 * So isolation is applied **where it is sound** and the same guarantee is
 * reached another way where it is not:
 *
 * - **`isolated`** — writes, needs nothing but tracked files. Gets a worktree
 *   and runs in parallel with other isolated subtasks.
 * - **`exclusive`** — writes *and* needs the real working tree. Cannot be
 *   isolated, so it runs alone. This is the honest cost of the blocker above,
 *   stated rather than hidden.
 * - **`shared`** — writes nothing. Races with nobody, so it keeps full
 *   parallelism in the main tree.
 *
 * **The serialisation of writers is not conditional on the feature.** With
 * worktree isolation switched off every writer becomes `exclusive`, because the
 * race is a correctness bug and a setting that is off must not reintroduce it.
 * Turning isolation *on* buys back parallelism; it is not what makes the run
 * safe.
 *
 * Pure. Nothing here creates a worktree, runs git, or touches a file — it
 * returns a plan, so a caller can be tested against the decision and the
 * decision can be tested without a repository.
 */

import type { SubTask } from '../types.js';

/** How a subtask is placed, and why. */
export type WorktreePlacement = 'isolated' | 'exclusive' | 'shared';

export type WorktreeRuleId =
  | 'read-only'
  | 'needs-working-tree'
  | 'isolation-unavailable'
  | 'isolation-disabled'
  | 'writes-tracked-files';

/** The declared rules, published with every plan so a surface can explain a placement. */
export const WORKTREE_RULES: ReadonlyArray<{ id: WorktreeRuleId; description: string }> = [
  {
    id: 'read-only',
    description: 'Writes nothing, so it cannot lose a race. Runs in the main tree alongside anything else.',
  },
  {
    id: 'needs-working-tree',
    description: 'Runs commands or tests, which need installed dependencies a fresh worktree does not have. Runs alone in the main tree.',
  },
  {
    id: 'isolation-unavailable',
    description: 'No worktree could be made for it — no git repository, a host that cannot re-root a subtask\'s file access, or git refused. Writers run one at a time instead.',
  },
  {
    id: 'isolation-disabled',
    description: 'Worktree isolation is switched off. Writers still run one at a time, because the race is a defect rather than a preference.',
  },
  {
    id: 'writes-tracked-files',
    description: 'Writes, and needs only tracked files. Gets its own worktree and keeps its parallelism.',
  },
];

export interface WorktreeAssignment {
  subTaskId: string;
  placement: WorktreePlacement;
  rule: WorktreeRuleId;
}

export interface WorktreeBatchPlan {
  assignments: WorktreeAssignment[];
  /** Groups to run in order. Every subtask in one group may run concurrently. */
  waves: string[][];
  /** True when at least one subtask will get a worktree. */
  usesWorktrees: boolean;
}

export interface WorktreeIsolationOptions {
  /** `atlasmind.execution.worktreeIsolation`. Off by default. */
  enabled: boolean;
  /** False when the workspace is not a git repository, or git is unavailable. */
  gitAvailable: boolean;
}

/**
 * Skills that write into the workspace.
 *
 * Named explicitly rather than derived from `classifyToolInvocation`, and the
 * difference matters: that function answers *should a human approve this*,
 * which is a question about risk. This one answers *can two of these collide*,
 * which is a question about the filesystem. `git-commit` is high risk and
 * writes nothing two subtasks could race over; `file-write` is the reverse of
 * neither but belongs here for a different reason than it belongs there.
 */
const WORKSPACE_WRITE_SKILLS: ReadonlySet<string> = new Set([
  'file-write',
  'file-edit',
  'file-move',
  'file-delete',
  'git-apply-patch',
  'code-format',
]);

/**
 * Skills that need the working tree as it actually is.
 *
 * Anything that runs a process: it will look for `node_modules`, a build
 * directory, a virtualenv, a lockfile's installed state — none of which a fresh
 * worktree has. `git-*` is included because a linked worktree has its own HEAD
 * and index, so a commit made there is not a commit on the branch the operator
 * is watching.
 */
const NEEDS_REAL_TREE_SKILLS: ReadonlySet<string> = new Set([
  'test-run',
  'terminal-run',
  'npm-scripts',
  'docker-cli',
  'git-commit',
  'git-push',
  'git-merge',
  'git-stash',
  'git-branch',
  'git-worktree',
  'git-sync',
]);

/** Whether a subtask can write into the workspace at all. */
export function writesWorkspace(task: Pick<SubTask, 'skills'>): boolean {
  return (task.skills ?? []).some(skill => WORKSPACE_WRITE_SKILLS.has(skill));
}

/** Whether a subtask needs the real working tree rather than a tracked-files checkout. */
export function needsRealWorkingTree(task: Pick<SubTask, 'skills'>): boolean {
  return (task.skills ?? []).some(skill => NEEDS_REAL_TREE_SKILLS.has(skill));
}

/** Where one subtask goes, and which rule put it there. */
export function placeSubTask(
  task: Pick<SubTask, 'id' | 'skills'>,
  options: WorktreeIsolationOptions,
): WorktreeAssignment {
  if (!writesWorkspace(task)) {
    return { subTaskId: task.id, placement: 'shared', rule: 'read-only' };
  }
  // Checked before the setting: a subtask that cannot run in a worktree is
  // exclusive whether or not isolation is switched on, and reporting it as
  // "disabled" would suggest turning something on would help.
  if (needsRealWorkingTree(task)) {
    return { subTaskId: task.id, placement: 'exclusive', rule: 'needs-working-tree' };
  }
  if (!options.enabled) {
    return { subTaskId: task.id, placement: 'exclusive', rule: 'isolation-disabled' };
  }
  if (!options.gitAvailable) {
    return { subTaskId: task.id, placement: 'exclusive', rule: 'isolation-unavailable' };
  }
  return { subTaskId: task.id, placement: 'isolated', rule: 'writes-tracked-files' };
}

/**
 * Turn one scheduler batch into ordered waves.
 *
 * Shared and isolated subtasks go in the first wave together — nothing in it
 * can collide, because the shared ones write nothing and the isolated ones each
 * have their own tree. Every exclusive subtask then gets a wave to itself.
 *
 * Exclusive work runs **after** the parallel wave rather than before, so a run
 * that is mostly research and one edit does its research while it can. The
 * ordering within the exclusive group is the batch's own, since the scheduler
 * has already resolved dependencies and any order is equally valid.
 */
export function planWorktreeBatch(
  tasks: ReadonlyArray<Pick<SubTask, 'id' | 'skills'>>,
  options: WorktreeIsolationOptions,
): WorktreeBatchPlan {
  return worktreeBatchFromAssignments(tasks.map(task => placeSubTask(task, options)));
}

/**
 * The same plan, from assignments a caller has already adjusted.
 *
 * Placement is decided before a worktree exists and the creation can still
 * fail — a full disk, a path git will not take. A caller that has downgraded
 * such a subtask to `exclusive` re-derives the waves through here rather than
 * moving it by hand, so there is one definition of what the waves are and a
 * downgrade cannot leave a subtask in a parallel wave with no tree of its own,
 * which is the race wearing the feature's name.
 */
export function worktreeBatchFromAssignments(
  assignments: ReadonlyArray<WorktreeAssignment>,
): WorktreeBatchPlan {
  const parallel = assignments
    .filter(entry => entry.placement !== 'exclusive')
    .map(entry => entry.subTaskId);
  const exclusive = assignments
    .filter(entry => entry.placement === 'exclusive')
    .map(entry => entry.subTaskId);

  const waves: string[][] = [];
  if (parallel.length > 0) {
    waves.push(parallel);
  }
  for (const id of exclusive) {
    waves.push([id]);
  }

  return {
    assignments: [...assignments],
    waves,
    usesWorktrees: assignments.some(entry => entry.placement === 'isolated'),
  };
}

/**
 * What to tell the operator about a batch, or nothing.
 *
 * Silent when the batch runs exactly as it always did — a progress line saying
 * "1 subtask, unchanged" on every batch is noise that trains people to skip the
 * line that matters.
 */
export function describeWorktreeBatch(plan: WorktreeBatchPlan): string {
  const isolated = plan.assignments.filter(entry => entry.placement === 'isolated').length;
  const exclusive = plan.assignments.filter(entry => entry.placement === 'exclusive').length;

  if (isolated === 0 && exclusive === 0) {
    return '';
  }

  const parts: string[] = [];
  if (isolated > 0) {
    parts.push(`${isolated} in ${isolated === 1 ? 'its own worktree' : 'their own worktrees'}`);
  }
  if (exclusive > 0) {
    // Named, because a run that suddenly takes longer with no explanation reads
    // as AtlasMind being slow rather than as AtlasMind refusing to race.
    //
    // Singular is a different sentence, not the plural with a number swapped in:
    // one subtask is not being serialised against anything, and "1 one at a time
    // because two subtasks must not write the same tree" describes a batch that
    // does not exist. It is set apart from the parallel work, which is the true
    // and smaller claim.
    const needsRealTree = plan.assignments.some(entry => entry.rule === 'needs-working-tree');
    if (exclusive === 1) {
      parts.push(needsRealTree
        ? '1 on its own because it runs commands or tests, which need the real working tree'
        : '1 on its own, since nothing else may write while it does');
    } else {
      parts.push(`${exclusive} one at a time because ${needsRealTree
        ? 'they run commands or tests, which need the real working tree'
        : 'two subtasks must not write the same tree at once'}`);
    }
  }
  return parts.join('; ');
}
