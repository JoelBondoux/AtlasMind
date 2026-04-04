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
    const precompletedIds = new Set<string>();
    for (const seeded of options?.initialResults ?? []) {
      if (seeded.status === 'completed') {
        results.set(seeded.subTaskId, seeded);
        outputs.set(seeded.subTaskId, seeded.output);
        precompletedIds.add(seeded.subTaskId);
      }
    }

    const batches = buildExecutionBatches(plan.subTasks, precompletedIds);
    const executionChunks = batches.flatMap(batch => chunkArray(batch, MAX_SCHEDULER_CONCURRENCY));
    const total = plan.subTasks.length;

    for (const [index, chunk] of executionChunks.entries()) {
      const batchInfo = {
        batchIndex: index + 1,
        totalBatches: executionChunks.length,
        batchSize: chunk.length,
        subTaskIds: chunk.map(task => task.id),
      };
      options?.onBatchStart?.(batchInfo);
      if (options?.beforeBatch) {
        await options.beforeBatch(batchInfo);
      }

      const chunkResults = await Promise.all(
        chunk.map(async (task) => {
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
        outputs.set(task.id, result.output);
        options?.onProgress?.({
          completedId: task.id,
          total,
          completed: results.size,
          result,
        });
      }
    }

    // Return results in original plan order; skipped tasks (dependency chain
    // failure) get a synthetic failed result.
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

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
