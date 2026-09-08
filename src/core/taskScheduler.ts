/**
 * TaskScheduler – executes a ProjectPlan respecting dependency ordering while
 * running independent subtasks in parallel.
 *
 * Algorithm:
 *  1. Kahn's BFS topological sort → ordered batches where each batch contains
 *     tasks whose dependencies have all been satisfied by prior batches.
 *  2. Each batch runs with Promise.all.
 *  3. Outputs from completed tasks are forwarded as context to their dependents.
 *  4. MAX_SCHEDULER_CONCURRENCY caps the fan-out within a batch to avoid overwhelming
 *     downstream providers.
 */

import type { ProjectPlan, SubTask, SubTaskResult } from '../types.js';

/** Function signature for the per-subtask execution callback. */
export type SubTaskExecutor = (
  task: SubTask,
  dependencyOutputs: Record<string, string>,
) => Promise<SubTaskResult>;

export interface SchedulerProgress {
  completedId: string;
  total: number;
  completed: number;
  result: SubTaskResult;
}

export interface SchedulerBatchStart {
  batchIndex: number;
  totalBatches: number;
  batchSize: number;
  subTaskIds: string[];
}

export interface SchedulerExecutionOptions {
  onProgress?: (progress: SchedulerProgress) => void;
  onBatchStart?: (batch: SchedulerBatchStart) => void;
  beforeBatch?: (batch: SchedulerBatchStart) => Promise<void>;
  /**
   * Runs after every chunk, whether or not the work in it succeeded.
   *
   * Its own hook rather than something the caller does around `execute`,
   * because what happens between two chunks is sometimes load-bearing: an
   * isolated subtask's changes have to reach the working tree before the chunk
   * that depends on them starts, and by the end of the run that is far too
   * late.
   */
  afterBatch?: (batch: SchedulerBatchStart) => Promise<void>;
  /**
   * Split one dependency batch into the groups it should run as, in order.
   *
   * Everything in a batch is *free* to run at once — that is what a batch means
   * — but free is not the same as safe, and the scheduler has never had a way to
   * say so. Two subtasks writing the same file is a read-modify-write race
   * whose loser vanishes silently. The caller decides how to split; the default
   * is the fan-out cap and nothing else, exactly as before.
   *
   * Async because deciding may require doing: the placement AtlasMind uses
   * creates a worktree per isolated subtask, and one that cannot be created has
   * to be placed differently rather than optimistically.
   */
  partitionBatch?: (tasks: SubTask[]) => Promise<SubTask[][]> | SubTask[][];
  initialResults?: SubTaskResult[];
}

import { MAX_SCHEDULER_CONCURRENCY } from '../constants.js';

export class TaskScheduler {
  async execute(
    plan: ProjectPlan,
    executor: SubTaskExecutor,
    options?: SchedulerExecutionOptions,
  ): Promise<SubTaskResult[]> {
    const results = new Map<string, SubTaskResult>();
    const outputs = new Map<string, string>(); // subtaskId → text output
    const failedIds = new Set<string>(); // subtasks that failed or were skipped
    const precompletedIds = new Set<string>();
    for (const seeded of options?.initialResults ?? []) {
      if (seeded.status === 'completed') {
        results.set(seeded.subTaskId, seeded);
        outputs.set(seeded.subTaskId, seeded.output);
        precompletedIds.add(seeded.subTaskId);
      }
    }

    const batches = buildExecutionBatches(plan.subTasks, precompletedIds);
    const total = plan.subTasks.length;

    // Without a partitioner every chunk is known before the run starts, so the
    // total is exact — as it always was. With one, a batch is split only when it
    // is about to run, because deciding how may require creating something
    // first; the total is then a lower bound that grows rather than a number
    // taken on trust.
    const partitionBatch = options?.partitionBatch;
    const eagerChunks = partitionBatch
      ? undefined
      : batches.map(batch => chunkArray(batch, MAX_SCHEDULER_CONCURRENCY));
    const exactTotal = eagerChunks?.reduce((sum, chunks) => sum + chunks.length, 0);

    let chunkNumber = 0;
    let emittedChunks = 0;

    for (const [batchIndex, batch] of batches.entries()) {
      const chunks = eagerChunks
        ? eagerChunks[batchIndex] ?? []
        : await partitionBatch!(batch);
      emittedChunks += chunks.length;
      const remainingBatches = batches.length - batchIndex - 1;

      for (const chunk of chunks) {
        if (chunk.length === 0) {
          continue;
        }
        chunkNumber += 1;
        const batchInfo = {
          batchIndex: chunkNumber,
          totalBatches: exactTotal ?? (emittedChunks + remainingBatches),
          batchSize: chunk.length,
          subTaskIds: chunk.map(task => task.id),
        };
        options?.onBatchStart?.(batchInfo);
        if (options?.beforeBatch) {
          await options.beforeBatch(batchInfo);
        }

        try {
          const chunkResults = await Promise.all(
            chunk.map(async (task) => {
              // If any direct dependency failed, skip this task immediately rather
              // than running it with missing context and wasting model quota.
              const blockedBy = task.dependsOn.find(depId => failedIds.has(depId));
              if (blockedBy) {
                const skipped: SubTaskResult = {
                  subTaskId: task.id,
                  title: task.title,
                  status: 'failed',
                  output: '',
                  costUsd: 0,
                  durationMs: 0,
                  error: `Skipped — dependency "${blockedBy}" did not complete successfully.`,
                };
                return { task, result: skipped };
              }

              // Collect dependency outputs to pass as context
              const depOutputs: Record<string, string> = {};
              for (const depId of task.dependsOn) {
                const depOutput = outputs.get(depId);
                if (depOutput !== undefined) {
                  depOutputs[depId] = depOutput;
                }
              }
              const result = await executor(task, depOutputs);
              return { task, result };
            }),
          );

          for (const { task, result } of chunkResults) {
            results.set(task.id, result);
            if (result.status === 'completed') {
              outputs.set(task.id, result.output);
            } else {
              // Propagate failure so all downstream dependents are also skipped.
              failedIds.add(task.id);
            }
            options?.onProgress?.({
              completedId: task.id,
              total,
              completed: results.size,
              result,
            });
          }
        } finally {
          // In `finally` because the chunk that throws is the one whose
          // aftermath matters most: an abort leaves an isolated subtask's work
          // somewhere only this hook knows about, and skipping it on the way
          // out would strand exactly the run somebody needs to recover.
          if (options?.afterBatch) {
            await options.afterBatch(batchInfo);
          }
        }
      }
    }

    // Return results in original plan order; any task not reached gets a
    // synthetic skipped result (should only happen on cycles that slipped through).
    return plan.subTasks.map(
      t =>
        results.get(t.id) ?? {
          subTaskId: t.id,
          title: t.title,
          status: 'failed',
          output: '',
          costUsd: 0,
          durationMs: 0,
          error: 'Skipped — dependency produced no output.',
        },
    );
  }
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Produces an ordered list of execution batches via Kahn's BFS.
 * Each batch contains tasks whose dependencies have all been resolved
 * by previous batches.
 */
export function buildExecutionBatches(tasks: SubTask[], precompletedIds: Set<string> = new Set()): SubTask[][] {
  const taskMap = new Map<string, SubTask>(tasks.map(t => [t.id, t]));
  const remaining = new Set(tasks.map(t => t.id).filter(id => !precompletedIds.has(id)));
  const completed = new Set<string>(precompletedIds);
  const batches: SubTask[][] = [];

  while (remaining.size > 0) {
    const batch = [...remaining]
      .filter(id => {
        const task = taskMap.get(id)!;
        return task.dependsOn.every(dep => completed.has(dep));
      })
      .map(id => taskMap.get(id)!);

    if (batch.length === 0) {
      // Cycle among remaining tasks (should have been removed by removeCycles,
      // but guard defensively by running remaining tasks sequentially).
      batches.push([...remaining].map(id => taskMap.get(id)!));
      break;
    }

    for (const task of batch) {
      remaining.delete(task.id);
      completed.add(task.id);
    }
    batches.push(batch);
  }

  return batches;
}

/**
 * Split a list into runs of at most `size`.
 *
 * Exported because a caller supplying `partitionBatch` still has to respect the
 * fan-out cap, and a second implementation of "at most five" would eventually
 * be a different number.
 */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
