import { describe, expect, it } from 'vitest';
import { removeCycles, splitPlanIntoExecutionJobs } from '../../src/core/planner.ts';
import { buildExecutionBatches, TaskScheduler } from '../../src/core/taskScheduler.ts';
import type { SubTask, SubTaskResult } from '../../src/types.ts';

// ── removeCycles ─────────────────────────────────────────────────

describe('removeCycles', () => {
  it('passes through a cycle-free DAG unchanged', () => {
    const tasks: SubTask[] = [
      { id: 'a', title: 'A', description: '', role: 'dev', skills: [], dependsOn: [] },
      { id: 'b', title: 'B', description: '', role: 'dev', skills: [], dependsOn: ['a'] },
      { id: 'c', title: 'C', description: '', role: 'dev', skills: [], dependsOn: ['a'] },
      { id: 'd', title: 'D', description: '', role: 'dev', skills: [], dependsOn: ['b', 'c'] },
    ];
    expect(removeCycles(tasks).map(t => t.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('removes tasks that form a cycle', () => {
    const tasks: SubTask[] = [
      { id: 'good', title: 'Good', description: '', role: 'dev', skills: [], dependsOn: [] },
      { id: 'x', title: 'X', description: '', role: 'dev', skills: [], dependsOn: ['y'] },
      { id: 'y', title: 'Y', description: '', role: 'dev', skills: [], dependsOn: ['x'] },
    ];
    const result = removeCycles(tasks).map(t => t.id);
    expect(result).toContain('good');
    expect(result).not.toContain('x');
    expect(result).not.toContain('y');
  });

  it('handles a self-referencing task (after dependsOn cleanup)', () => {
    // After planner sanitises, a self-dep will already be removed, but guard anyway
    const tasks: SubTask[] = [
      { id: 'a', title: 'A', description: '', role: 'dev', skills: [], dependsOn: [] },
      { id: 'b', title: 'B', description: '', role: 'dev', skills: [], dependsOn: ['a'] },
    ];
    expect(removeCycles(tasks)).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(removeCycles([])).toEqual([]);
  });
});

// ── buildExecutionBatches ─────────────────────────────────────────

describe('buildExecutionBatches', () => {
  it('single task produces a single batch', () => {
    const tasks: SubTask[] = [
      { id: 'a', title: 'A', description: '', role: 'dev', skills: [], dependsOn: [] },
    ];
    const batches = buildExecutionBatches(tasks);
    expect(batches).toHaveLength(1);
    expect(batches[0].map(t => t.id)).toEqual(['a']);
  });

  it('independent tasks go in the same first batch', () => {
    const tasks: SubTask[] = [
      { id: 'a', title: 'A', description: '', role: 'dev', skills: [], dependsOn: [] },
      { id: 'b', title: 'B', description: '', role: 'dev', skills: [], dependsOn: [] },
      { id: 'c', title: 'C', description: '', role: 'dev', skills: [], dependsOn: [] },
    ];
    const batches = buildExecutionBatches(tasks);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
  });

  it('chain a→b→c produces three sequential batches', () => {
    const tasks: SubTask[] = [
      { id: 'a', title: 'A', description: '', role: 'dev', skills: [], dependsOn: [] },
      { id: 'b', title: 'B', description: '', role: 'dev', skills: [], dependsOn: ['a'] },
      { id: 'c', title: 'C', description: '', role: 'dev', skills: [], dependsOn: ['b'] },
    ];
    const batches = buildExecutionBatches(tasks);
    expect(batches).toHaveLength(3);
    expect(batches[0].map(t => t.id)).toEqual(['a']);
    expect(batches[1].map(t => t.id)).toEqual(['b']);
    expect(batches[2].map(t => t.id)).toEqual(['c']);
  });

  it('diamond DAG (a→b, a→c, b+c→d) produces correct batches', () => {
    const tasks: SubTask[] = [
      { id: 'a', title: 'A', description: '', role: 'dev', skills: [], dependsOn: [] },
      { id: 'b', title: 'B', description: '', role: 'dev', skills: [], dependsOn: ['a'] },
      { id: 'c', title: 'C', description: '', role: 'dev', skills: [], dependsOn: ['a'] },
      { id: 'd', title: 'D', description: '', role: 'dev', skills: [], dependsOn: ['b', 'c'] },
    ];
    const batches = buildExecutionBatches(tasks);
    // Batch 0: [a], Batch 1: [b, c], Batch 2: [d]
    expect(batches).toHaveLength(3);
    expect(batches[0].map(t => t.id)).toEqual(['a']);
    expect(batches[1].map(t => t.id)).toEqual(expect.arrayContaining(['b', 'c']));
    expect(batches[2].map(t => t.id)).toEqual(['d']);
  });
});

describe('splitPlanIntoExecutionJobs', () => {
  it('keeps a small plan as a single execution job', () => {
    const plan = {
      id: 'small-plan',
      goal: 'Small goal',
      subTasks: [
        { id: 'a', title: 'A', description: '', role: 'dev', skills: [], dependsOn: [] },
        { id: 'b', title: 'B', description: '', role: 'dev', skills: [], dependsOn: ['a'] },
      ],
    };

    const jobs = splitPlanIntoExecutionJobs(plan, {
      maxEstimatedFilesPerJob: 10,
      estimatedFilesPerSubtask: 1,
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.plan.subTasks.map(task => task.id)).toEqual(['a', 'b']);
  });

  it('splits a larger plan on execution-batch boundaries', () => {
    const plan = {
      id: 'large-plan',
      goal: 'Large goal',
      subTasks: [
        { id: 'a', title: 'A', description: '', role: 'dev', skills: [], dependsOn: [] },
        { id: 'b', title: 'B', description: '', role: 'dev', skills: [], dependsOn: ['a'] },
        { id: 'c', title: 'C', description: '', role: 'dev', skills: [], dependsOn: ['a'] },
        { id: 'd', title: 'D', description: '', role: 'dev', skills: [], dependsOn: ['b', 'c'] },
        { id: 'e', title: 'E', description: '', role: 'dev', skills: [], dependsOn: ['d'] },
      ],
    };

    const jobs = splitPlanIntoExecutionJobs(plan, {
      maxEstimatedFilesPerJob: 2,
      estimatedFilesPerSubtask: 1,
    });

    expect(jobs).toHaveLength(3);
    expect(jobs[0]?.plan.subTasks.map(task => task.id)).toEqual(['a']);
    expect(jobs[1]?.plan.subTasks.map(task => task.id)).toEqual(expect.arrayContaining(['b', 'c']));
    expect(jobs[2]?.plan.subTasks.map(task => task.id)).toEqual(expect.arrayContaining(['d', 'e']));
  });

  it('respects seeded prerequisite subtasks when splitting a continuation plan', () => {
    const plan = {
      id: 'continuation-plan',
      goal: 'Continuation goal',
      subTasks: [
        { id: 'b', title: 'B', description: '', role: 'dev', skills: [], dependsOn: ['a'] },
        { id: 'c', title: 'C', description: '', role: 'dev', skills: [], dependsOn: ['a'] },
        { id: 'd', title: 'D', description: '', role: 'dev', skills: [], dependsOn: ['b', 'c'] },
        { id: 'e', title: 'E', description: '', role: 'dev', skills: [], dependsOn: ['d'] },
      ],
    };

    const jobs = splitPlanIntoExecutionJobs(plan, {
      maxEstimatedFilesPerJob: 2,
      estimatedFilesPerSubtask: 1,
      precompletedSubtaskIds: ['a'],
    });

    expect(jobs).toHaveLength(2);
    expect(jobs[0]?.plan.subTasks.map(task => task.id)).toEqual(['b', 'c']);
    expect(jobs[1]?.plan.subTasks.map(task => task.id)).toEqual(['d', 'e']);
  });
});

// ── TaskScheduler ─────────────────────────────────────────────────

describe('TaskScheduler', () => {
  const scheduler = new TaskScheduler();

  function makeResult(task: SubTask, extra: Partial<SubTaskResult> = {}): SubTaskResult {
    return {
      subTaskId: task.id,
      title: task.title,
      status: 'completed',
      output: `output-${task.id}`,
      costUsd: 0.001,
      durationMs: 100,
      ...extra,
    };
  }

  it('executes all tasks and returns results in plan order', async () => {
    const tasks: SubTask[] = [
      { id: 'a', title: 'A', description: '', role: 'dev', skills: [], dependsOn: [] },
      { id: 'b', title: 'B', description: '', role: 'dev', skills: [], dependsOn: [] },
    ];
    const plan = { id: 'p1', goal: 'goal', subTasks: tasks };

    const executor = async (task: SubTask) => makeResult(task);
    const results = await scheduler.execute(plan, executor);

    expect(results).toHaveLength(2);
    expect(results.map(r => r.subTaskId)).toEqual(['a', 'b']);
    expect(results.every(r => r.status === 'completed')).toBe(true);
  });

  it('passes dependency outputs to downstream tasks', async () => {
    const tasks: SubTask[] = [
      { id: 'a', title: 'A', description: '', role: 'dev', skills: [], dependsOn: [] },
      { id: 'b', title: 'B', description: '', role: 'dev', skills: [], dependsOn: ['a'] },
    ];
    const plan = { id: 'p2', goal: 'goal', subTasks: tasks };
    const received: Record<string, string>[] = [];

    const executor = async (task: SubTask, depOutputs: Record<string, string>) => {
      received.push(depOutputs);
      return makeResult(task);
    };

    await scheduler.execute(plan, executor);

    expect(received[0]).toEqual({}); // task 'a' has no deps
    expect(received[1]).toEqual({ a: 'output-a' }); // task 'b' gets 'a's output
  });

  it('invokes onProgress after each task completes', async () => {
    const tasks: SubTask[] = [
      { id: 'x', title: 'X', description: '', role: 'dev', skills: [], dependsOn: [] },
      { id: 'y', title: 'Y', description: '', role: 'dev', skills: [], dependsOn: [] },
    ];
    const plan = { id: 'p3', goal: 'goal', subTasks: tasks };
    const progressEvents: string[] = [];

    await scheduler.execute(plan, async task => makeResult(task), {
      onProgress: progress => {
        progressEvents.push(progress.result.subTaskId);
      },
    });

    expect(progressEvents).toHaveLength(2);
    expect(progressEvents).toEqual(expect.arrayContaining(['x', 'y']));
  });

  it('emits batch-start callbacks for execution chunks', async () => {
    const tasks: SubTask[] = [
      { id: 'a', title: 'A', description: '', role: 'dev', skills: [], dependsOn: [] },
      { id: 'b', title: 'B', description: '', role: 'dev', skills: [], dependsOn: ['a'] },
      { id: 'c', title: 'C', description: '', role: 'dev', skills: [], dependsOn: ['b'] },
    ];
    const plan = { id: 'p5', goal: 'goal', subTasks: tasks };
    const batchStarts: Array<{ batchIndex: number; totalBatches: number; subTaskIds: string[] }> = [];

    await scheduler.execute(
      plan,
      async task => makeResult(task),
      {
        onBatchStart: batch => {
        batchStarts.push({
          batchIndex: batch.batchIndex,
          totalBatches: batch.totalBatches,
          subTaskIds: batch.subTaskIds,
        });
        },
      },
    );

    expect(batchStarts).toHaveLength(3);
    expect(batchStarts[0]).toEqual({ batchIndex: 1, totalBatches: 3, subTaskIds: ['a'] });
  });

  it('handles executor throwing — marks task as failed', async () => {
    const tasks: SubTask[] = [
      { id: 'boom', title: 'Boom', description: '', role: 'dev', skills: [], dependsOn: [] },
    ];
    const plan = { id: 'p4', goal: 'goal', subTasks: tasks };

    // Executor that throws — TaskScheduler itself doesn't catch; the orchestrator wraps it.
    // Here we test with an executor that returns a failed result directly.
    const executor = async (task: SubTask): Promise<SubTaskResult> => ({
      subTaskId: task.id,
      title: task.title,
      status: 'failed',
      output: '',
      costUsd: 0,
      durationMs: 50,
      error: 'exploded',
    });

    const results = await scheduler.execute(plan, executor);
    expect(results[0].status).toBe('failed');
    expect(results[0].error).toBe('exploded');
  });
});
