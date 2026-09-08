import type { SubTask } from '../types.js';
import { chunkArray } from './taskScheduler.js';
import { MAX_SCHEDULER_CONCURRENCY } from '../constants.js';
import {
  describeWorktreeBatch,
  placeSubTask,
  worktreeBatchFromAssignments,
  type WorktreeAssignment,
  type WorktreeIsolationOptions,
} from './worktreeIsolation.js';
import { WORKTREE_CONTAINER, WorktreeManager, type WorktreeGitRunner } from './worktreeManager.js';
import {
  collectWorktreePatch,
  describeWorktreeMerge,
  mergeWorktrees,
  worktreesToKeep,
} from './worktreeMerge.js';

/**
 * Worktree placement, isolation and merge-back for one run.
 *
 * `worktreeIsolation` decides where a subtask goes, `worktreeManager` makes the
 * trees and `worktreeMerge` brings the work back; each is tested on its own and
 * none of them can be wrong in the way that matters. This is the part that can:
 * a wave that starts before the one it was told to wait for, a downgrade that
 * leaves a subtask in a parallel wave with no tree of its own, a cleanup that
 * removes the only copy of work nobody has seen. A correct policy is routed
 * around in the wiring, so the wiring is a module with tests rather than a
 * closure inside a four-thousand-line class.
 *
 * Everything is held in this closure and nothing on the caller, because two
 * runs can overlap and a field would let one run's cleanup remove the other's
 * trees.
 *
 * Four rules:
 *
 * **Writers are serialised whether or not isolation is on.** With the setting
 * off every writer is placed `exclusive` and gets a wave to itself — slower
 * than running them together, and it stops losing edits. The race was never the
 * price of not having this feature; it was a defect, and a switch that is off
 * must not reintroduce it.
 *
 * **A tree that could not be made costs parallelism, never separation.** A
 * failed `worktree add` downgrades that subtask to `exclusive`. Running it in
 * the shared tree beside the other writers instead would be the race arriving
 * under the feature's own name.
 *
 * **Work comes back between waves, not at the end of the run.** A later batch
 * may depend on an earlier subtask's edits, so a merge deferred to the end
 * would leave the dependency ordering honoured and meaningless.
 *
 * **Nothing holding work is removed.** A worktree whose patch would not apply
 * is kept and named. One stranded by a run that ended early is kept if it has
 * changes and removed if it has none, so an aborted run neither loses edits nor
 * litters `.git` with empty checkouts.
 */

export interface WorktreeRunOptions {
  /** Names the worktree directories. One run, one prefix. */
  runId: string;
  workspaceRoot: string | undefined;
  /** Absent means no isolation — the scheduler serialises writers instead. */
  runGit: WorktreeGitRunner | undefined;
  /**
   * Whether the host can point a subtask's file operations at another
   * directory. A host that cannot is as unable to isolate as one without git,
   * and for placement it means the same thing.
   */
  canRerootSkillContext: boolean;
  /** `atlasmind.execution.worktreeIsolation`. */
  isolationEnabled: boolean;
  /** Told how the batch was placed, and where any unmerged work was left. */
  onNotice?: (message: string) => void;
}

export interface WorktreeRun {
  partitionBatch: (tasks: SubTask[]) => Promise<SubTask[][]>;
  afterBatch: (subTaskIds: string[]) => Promise<void>;
  worktreeFor: (subTaskId: string) => string | undefined;
  finish: () => Promise<void>;
}

export function startWorktreeRun(options: WorktreeRunOptions): WorktreeRun {
  const { runId, workspaceRoot, runGit, onNotice } = options;

  /**
   * Reporting must never be able to end a run.
   *
   * `onNotice` reaches host code — a chat stream that has since been cancelled,
   * an output channel being disposed — and a progress line is not worth failing
   * a run over. It matters most inside the two `catch` blocks below: a notice
   * that threw *there* would escape the guard that exists to stop a throw
   * replacing whatever really ended the run.
   */
  const notify = (message: string): void => {
    try {
      onNotice?.(message);
    } catch {
      // There is nowhere left to report to, which is not a reason to stop.
    }
  };

  const placement: WorktreeIsolationOptions = {
    enabled: options.isolationEnabled,
    // Three ways to have no isolation available — no workspace, no git runner,
    // a host that cannot re-root — reported as one. All three mean the same to
    // the placement, and separating them on a progress line would be detail
    // nobody can act on.
    gitAvailable: Boolean(workspaceRoot) && Boolean(runGit) && options.canRerootSkillContext,
  };

  const manager = placement.enabled && placement.gitAvailable && workspaceRoot && runGit
    ? new WorktreeManager(workspaceRoot, runId, runGit)
    : undefined;

  /** Live worktrees only. An entry leaves as soon as its wave is merged. */
  const live = new Map<string, string>();
  let lastDescription = '';

  const partitionBatch = async (tasks: SubTask[]): Promise<SubTask[][]> => {
    const assignments: WorktreeAssignment[] = [];
    for (const task of tasks) {
      const assignment = placeSubTask(task, placement);
      if (assignment.placement === 'isolated' && manager) {
        const handle = await manager.create(task.id);
        if (!handle) {
          assignments.push({ subTaskId: task.id, placement: 'exclusive', rule: 'isolation-unavailable' });
          continue;
        }
        live.set(task.id, handle.path);
      }
      assignments.push(assignment);
    }

    const batchPlan = worktreeBatchFromAssignments(assignments);
    const description = describeWorktreeBatch(batchPlan);
    // Said once. Every batch of a long run is usually placed the same way, and
    // a line repeated on each of them is one people stop reading.
    if (description && description !== lastDescription) {
      lastDescription = description;
      notify(`Running ${description}.`);
    }

    const byId = new Map(tasks.map(task => [task.id, task]));
    return batchPlan.waves.flatMap(wave => chunkArray(
      wave.map(id => byId.get(id)).filter((task): task is SubTask => task !== undefined),
      MAX_SCHEDULER_CONCURRENCY,
    ));
  };

  /**
   * Never throws.
   *
   * The scheduler calls this from a `finally`, so a throw here would *replace*
   * whatever ended the run — a billing abort or a cancellation would surface as
   * a git error, and the actual reason would be gone. A merge that fails is
   * reported and the worktrees stay, which is the same outcome as a patch that
   * would not apply.
   */
  const afterBatch = async (subTaskIds: string[]): Promise<void> => {
    try {
      await mergeFinishedWave(subTaskIds);
    } catch (error) {
      notify(
        'Could not bring an isolated subtask\'s changes back: '
        + `${error instanceof Error ? error.message : String(error)}. `
        + 'Its worktree has been left in place, so nothing is lost.',
      );
    }
  };

  const mergeFinishedWave = async (subTaskIds: string[]): Promise<void> => {
    if (!manager || !runGit || !workspaceRoot) {
      return;
    }
    const sources = subTaskIds
      .map(subTaskId => ({ subTaskId, worktreePath: live.get(subTaskId) }))
      .filter((source): source is { subTaskId: string; worktreePath: string } =>
        typeof source.worktreePath === 'string');
    if (sources.length === 0) {
      return;
    }

    const outcomes = await mergeWorktrees(runGit, workspaceRoot, sources);
    const message = describeWorktreeMerge(outcomes);
    if (message) {
      notify(message);
    }

    // Scoped to this wave: the next wave of the same batch may already have
    // trees of its own, and an unscoped sweep would take one a subtask is about
    // to be run in.
    const keep = new Set(worktreesToKeep(outcomes));
    await manager.cleanup({ only: new Set(sources.map(source => source.subTaskId)), keep });
    for (const source of sources) {
      live.delete(source.subTaskId);
    }
  };

  /** Never throws, for the same reason `afterBatch` does not. */
  const finish = async (): Promise<void> => {
    try {
      await releaseStrandedWorktrees();
    } catch (error) {
      notify(
        `Could not tidy up this run's worktrees: ${error instanceof Error ? error.message : String(error)}. `
        + `They are under ${WORKTREE_CONTAINER} if anything is left behind.`,
      );
    }
  };

  const releaseStrandedWorktrees = async (): Promise<void> => {
    if (!manager || !runGit) {
      return;
    }
    // Anything still live belongs to a run that never reached its merge — an
    // abort, a billing stop, a throw. Emptiness is the question: a worktree
    // with changes is the only copy of work nobody has seen, one without is
    // litter inside `.git`.
    const keep = new Set<string>();
    const stranded: string[] = [];
    for (const [subTaskId, worktreePath] of live) {
      let holdsWork = true;
      try {
        holdsWork = (await collectWorktreePatch(runGit, worktreePath)).trim().length > 0;
      } catch {
        // Unable to tell. Keeping is the direction that cannot destroy anything.
        holdsWork = true;
      }
      if (holdsWork) {
        keep.add(subTaskId);
        stranded.push(worktreePath);
      }
    }
    live.clear();
    await manager.cleanup({ keep });
    if (stranded.length > 0) {
      notify(
        `The run ended before ${stranded.length === 1 ? 'one subtask\'s' : `${stranded.length} subtasks'`} `
        + `changes were merged. They are kept at ${stranded.join(', ')} — nothing is lost.`,
      );
    }
  };

  return { partitionBatch, afterBatch, worktreeFor: subTaskId => live.get(subTaskId), finish };
}
