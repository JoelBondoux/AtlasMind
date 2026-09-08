import { describe, expect, it, vi } from 'vitest';

import { TaskScheduler } from '../../src/core/taskScheduler.ts';
import { WorktreeManager, worktreePathFor } from '../../src/core/worktreeManager.ts';
import type { SubTask, SubTaskResult } from '../../src/types.ts';

/**
 * The seams that turn three pure modules into a feature.
 *
 * `worktreeIsolation` decides placement, `worktreeManager` makes the trees and
 * `worktreeMerge` gets the work back, and all three are tested on their own.
 * None of them can be wrong in the way that matters here: a scheduler that runs
 * a wave before the one it was told to wait for, or a cleanup that removes a
 * tree a subtask is about to be run in. Those are properties of the wiring, and
 * the wiring is where a correct policy is quietly routed around.
 */

function task(id: string, dependsOn: string[] = []): SubTask {
  return { id, title: id.toUpperCase(), description: '', role: 'dev', skills: [], dependsOn };
}

function completed(subTask: SubTask): SubTaskResult {
  return {
    subTaskId: subTask.id,
    title: subTask.title,
    status: 'completed',
    output: `output-${subTask.id}`,
    costUsd: 0,
    durationMs: 1,
  };
}

describe('waves run in the order the partitioner gave them', () => {
  const scheduler = new TaskScheduler();

  it('does not start the second wave until the first has finished', async () => {
    // The property the whole feature rests on. Two writers placed in separate
    // waves must not overlap, or they are exactly as able to lose each other's
    // edits as they were before any of this existed.
    const plan = { id: 'p', goal: 'g', subTasks: [task('a'), task('b'), task('c')] };
    const events: string[] = [];

    await scheduler.execute(
      plan,
      async subTask => {
        events.push(`start:${subTask.id}`);
        await new Promise(resolve => setTimeout(resolve, 1));
        events.push(`end:${subTask.id}`);
        return completed(subTask);
      },
      {
        // 'a' alone, then 'b' and 'c' together.
        partitionBatch: tasks => [
          tasks.filter(entry => entry.id === 'a'),
          tasks.filter(entry => entry.id !== 'a'),
        ],
      },
    );

    expect(events.indexOf('end:a')).toBeLessThan(events.indexOf('start:b'));
    expect(events.indexOf('start:b')).toBeLessThan(events.indexOf('end:c'));
  });

  it('may create something before it decides, so it is awaited', async () => {
    // Placement can require making a worktree, and one that cannot be made has
    // to be placed differently rather than optimistically.
    const plan = { id: 'p', goal: 'g', subTasks: [task('a')] };
    const prepared: string[] = [];

    await scheduler.execute(plan, async subTask => completed(subTask), {
      partitionBatch: async tasks => {
        await Promise.resolve();
        prepared.push(...tasks.map(entry => entry.id));
        return [tasks];
      },
    });

    expect(prepared).toEqual(['a']);
  });

  it('skips an empty wave rather than announcing one', async () => {
    const plan = { id: 'p', goal: 'g', subTasks: [task('a')] };
    const batches: number[] = [];

    await scheduler.execute(plan, async subTask => completed(subTask), {
      partitionBatch: tasks => [[], tasks, []],
      onBatchStart: batch => { batches.push(batch.batchSize); },
    });

    expect(batches).toEqual([1]);
  });

  it('leaves the chunk total exact when nobody partitions', async () => {
    // The default path is the one every existing run takes. A total that became
    // an estimate for everybody, to serve a feature that is off by default,
    // would be a worse trade than the feature is worth.
    const plan = { id: 'p', goal: 'g', subTasks: [task('a'), task('b', ['a']), task('c', ['b'])] };
    const totals: number[] = [];

    await scheduler.execute(plan, async subTask => completed(subTask), {
      onBatchStart: batch => { totals.push(batch.totalBatches); },
    });

    expect(totals).toEqual([3, 3, 3]);
  });
});

describe('what happens between two waves', () => {
  const scheduler = new TaskScheduler();

  it('merges before the wave that depends on the work starts', async () => {
    // A merge deferred to the end of the run would let a dependent read a file
    // its dependency had already changed somewhere else — the dependency
    // ordering would still be honoured and would no longer mean anything.
    const plan = { id: 'p', goal: 'g', subTasks: [task('a'), task('b', ['a'])] };
    const events: string[] = [];

    await scheduler.execute(
      plan,
      async subTask => {
        events.push(`run:${subTask.id}`);
        return completed(subTask);
      },
      {
        afterBatch: async batch => {
          events.push(`merge:${batch.subTaskIds.join(',')}`);
        },
      },
    );

    expect(events).toEqual(['run:a', 'merge:a', 'run:b', 'merge:b']);
  });

  it('runs after a wave that threw, because that is the run with work to recover', async () => {
    const plan = { id: 'p', goal: 'g', subTasks: [task('a')] };
    const afterBatch = vi.fn(async () => {});

    await expect(scheduler.execute(
      plan,
      async () => { throw new Error('billing stop'); },
      { afterBatch },
    )).rejects.toThrow('billing stop');

    expect(afterBatch).toHaveBeenCalledTimes(1);
  });
});

describe('cleaning up only what this wave finished with', () => {
  const ROOT = '/repo';

  function fakeGit(registered: string[]) {
    const removed: string[] = [];
    const run = vi.fn(async (args: readonly string[]) => {
      if (args[0] === 'worktree' && args[1] === 'list') {
        return [
          `worktree ${ROOT}`,
          'bare',
          ...registered.map(entry => `\nworktree ${entry}`),
        ].join('\n');
      }
      if (args[0] === 'worktree' && args[1] === 'remove') {
        removed.push(String(args[3]));
      }
      return '';
    });
    return { run, removed };
  }

  const pathA = worktreePathFor(ROOT, 'run', 'a');
  const pathB = worktreePathFor(ROOT, 'run', 'b');

  it('leaves a later wave\'s worktree alone', async () => {
    // A dependency batch is split further by the fan-out cap, so the next chunk
    // may already have trees of its own. An unscoped sweep would take one a
    // subtask is about to be run in, and the failure would look like the model
    // losing its own edits.
    const git = fakeGit([pathA, pathB]);
    const manager = new WorktreeManager(ROOT, 'run', git.run);
    await manager.create('a');
    await manager.create('b');

    await manager.cleanup({ only: new Set(['a']) });

    expect(git.removed).toEqual([pathA]);
    expect(manager.list().map(handle => handle.subTaskId)).toEqual(['b']);
  });

  it('forgets a kept worktree without touching it', async () => {
    // The directory is the only copy of work nobody has seen. It stops being
    // this run's to remove and becomes the operator's to look at — and being
    // forgotten is what stops a later sweep taking it anyway.
    const git = fakeGit([pathA]);
    const manager = new WorktreeManager(ROOT, 'run', git.run);
    await manager.create('a');
    git.run.mockClear();

    await manager.cleanup({ keep: new Set(['a']) });

    expect(git.removed).toEqual([]);
    expect(manager.list()).toEqual([]);
    // Not even asked about: with nothing left in scope the registry lookup is
    // skipped, so keeping costs no git call at all.
    expect(git.run).not.toHaveBeenCalled();
  });

  it('still removes everything when nothing is named', async () => {
    const git = fakeGit([pathA, pathB]);
    const manager = new WorktreeManager(ROOT, 'run', git.run);
    await manager.create('a');
    await manager.create('b');

    await manager.cleanup();

    expect(git.removed).toEqual([pathA, pathB]);
    expect(manager.list()).toEqual([]);
  });
});
