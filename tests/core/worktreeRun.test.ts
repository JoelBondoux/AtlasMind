import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { startWorktreeRun } from '../../src/core/worktreeRun.ts';
import { worktreePathFor } from '../../src/core/worktreeManager.ts';
import type { SubTask } from '../../src/types.ts';

/**
 * The wiring, which is where a correct policy gets routed around.
 *
 * Placement, worktree creation and merge-back are each tested on their own and
 * none of them can be wrong in the way that matters here. What can: a writer
 * left in a parallel wave with no tree of its own, a merge deferred until after
 * the work that depended on it, a cleanup that removes the only copy of
 * somebody's changes.
 */

const ROOT = path.resolve('/repo');

function writer(id: string): SubTask {
  return { id, title: id, description: '', role: 'dev', skills: ['file-edit'], dependsOn: [] };
}

function reader(id: string): SubTask {
  return { id, title: id, description: '', role: 'dev', skills: ['file-read'], dependsOn: [] };
}

function tester(id: string): SubTask {
  return { id, title: id, description: '', role: 'dev', skills: ['file-edit', 'test-run'], dependsOn: [] };
}

/**
 * A git that answers the four commands this uses, and records them.
 *
 * `addFails` names subtasks whose `worktree add` refuses, `patched` names
 * worktrees that report changes, and `applyFails` names ones whose patch will
 * not apply.
 */
function fakeGit(config: {
  addFails?: string[];
  patched?: string[];
  applyFails?: string[];
} = {}) {
  const added: string[] = [];
  const removed: string[] = [];
  const run = vi.fn(async (args: readonly string[], cwd: string) => {
    if (args[0] === 'worktree' && args[1] === 'add') {
      const target = String(args[3]);
      if ((config.addFails ?? []).some(id => target.endsWith(`-${id}`))) {
        throw new Error('could not create work tree');
      }
      added.push(target);
      return '';
    }
    if (args[0] === 'worktree' && args[1] === 'list') {
      return [`worktree ${ROOT}`, 'bare', ...added.map(entry => `\nworktree ${entry}`)].join('\n');
    }
    if (args[0] === 'worktree' && args[1] === 'remove') {
      removed.push(String(args[3]));
      return '';
    }
    if (args[0] === 'diff') {
      return (config.patched ?? []).some(id => cwd.endsWith(`-${id}`))
        ? 'diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n'
        : '';
    }
    if (args[0] === 'apply' && (config.applyFails ?? []).length > 0) {
      throw new Error('patch does not apply');
    }
    return '';
  });
  return { run, added, removed };
}

function start(overrides: Parameters<typeof startWorktreeRun>[0] extends infer T
  ? Partial<T> : never = {}) {
  const notices: string[] = [];
  const run = startWorktreeRun({
    runId: 'run',
    workspaceRoot: ROOT,
    runGit: fakeGit().run,
    canRerootSkillContext: true,
    isolationEnabled: true,
    onNotice: message => notices.push(message),
    ...overrides,
  });
  return { run, notices };
}

describe('the race is closed whether or not the feature is on', () => {
  it('gives every writer a wave to itself when isolation is off', async () => {
    // The rule the whole design turns on. A setting that is off must not
    // reintroduce a defect; turning it on buys parallelism back, it is not what
    // makes the run safe.
    const { run } = start({ isolationEnabled: false });

    const waves = await run.partitionBatch([writer('a'), writer('b')]);

    expect(waves.map(wave => wave.map(task => task.id))).toEqual([['a'], ['b']]);
  });

  it('gives every writer a wave to itself when there is no git', async () => {
    const { run } = start({ runGit: undefined });
    const waves = await run.partitionBatch([writer('a'), writer('b')]);
    expect(waves).toHaveLength(2);
  });

  it('gives every writer a wave to itself when the host cannot re-root', async () => {
    // A worktree nothing resolves into is a directory, not isolation.
    const { run } = start({ canRerootSkillContext: false });
    const waves = await run.partitionBatch([writer('a'), writer('b')]);
    expect(waves).toHaveLength(2);
  });

  it('keeps readers together with the writers regardless', async () => {
    // A subtask that writes nothing races with nobody, so serialising it would
    // cost time and buy nothing.
    const { run } = start({ isolationEnabled: false });
    const waves = await run.partitionBatch([reader('r1'), reader('r2'), writer('w')]);
    expect(waves[0]?.map(task => task.id)).toEqual(['r1', 'r2']);
    expect(waves[1]?.map(task => task.id)).toEqual(['w']);
  });
});

describe('telling somebody the setting would have helped', () => {
  function withAdvice(overrides: Partial<Parameters<typeof startWorktreeRun>[0]> = {}) {
    const advised: number[] = [];
    const run = startWorktreeRun({
      runId: 'run',
      workspaceRoot: ROOT,
      runGit: fakeGit().run,
      canRerootSkillContext: true,
      isolationEnabled: false,
      onSerialisedWriters: count => advised.push(count),
      ...overrides,
    });
    return { run, advised };
  }

  it('reports how many writers are queueing behind each other', async () => {
    const { run, advised } = withAdvice();
    await run.partitionBatch([writer('a'), writer('b'), writer('c')]);
    expect(advised).toEqual([3]);
  });

  it('stays quiet for a single writer, which is not a queue', async () => {
    const { run, advised } = withAdvice();
    await run.partitionBatch([writer('a'), reader('r')]);
    expect(advised).toEqual([]);
  });

  it('stays quiet when the setting would not have changed anything', async () => {
    // Offering a switch that would not have altered what somebody just watched
    // is worse than saying nothing: they try it once and stop believing it.
    const noGit = withAdvice({ runGit: undefined });
    await noGit.run.partitionBatch([writer('a'), writer('b')]);
    expect(noGit.advised).toEqual([]);

    const testers = withAdvice();
    await testers.run.partitionBatch([tester('t1'), tester('t2')]);
    expect(testers.advised).toEqual([]);

    const alreadyOn = withAdvice({ isolationEnabled: true });
    await alreadyOn.run.partitionBatch([writer('a'), writer('b')]);
    expect(alreadyOn.advised).toEqual([]);
  });

  it('speaks once per run, however many batches queue writers', async () => {
    // A run is what somebody waited through; a batch is an implementation
    // detail, and the same offer four times during one run is noise.
    const { run, advised } = withAdvice();
    await run.partitionBatch([writer('a'), writer('b')]);
    await run.partitionBatch([writer('c'), writer('d')]);
    await run.partitionBatch([writer('e'), writer('f')]);
    expect(advised).toEqual([2]);
  });

  it('does not fail the run when the advice throws', async () => {
    const { run } = withAdvice({ onSerialisedWriters: () => { throw new Error('no window'); } });
    await expect(run.partitionBatch([writer('a'), writer('b')])).resolves.toHaveLength(2);
  });
});

describe('isolation buys the parallelism back', () => {
  it('runs two writers together, each in its own tree', async () => {
    const git = fakeGit();
    const { run } = start({ runGit: git.run });

    const waves = await run.partitionBatch([writer('a'), writer('b')]);

    expect(waves.map(wave => wave.map(task => task.id))).toEqual([['a', 'b']]);
    expect(run.worktreeFor('a')).toBe(worktreePathFor(ROOT, 'run', 'a'));
    expect(run.worktreeFor('b')).toBe(worktreePathFor(ROOT, 'run', 'b'));
    expect(run.worktreeFor('a')).not.toBe(run.worktreeFor('b'));
  });

  it('will not isolate a subtask that needs the real working tree', async () => {
    // A fresh worktree is a checkout of tracked files: no `node_modules`, no
    // build output. "The tests failed" would be a fact about the isolation.
    const { run } = start();

    const waves = await run.partitionBatch([tester('t'), writer('w')]);

    expect(run.worktreeFor('t')).toBeUndefined();
    expect(waves.map(wave => wave.map(task => task.id))).toEqual([['w'], ['t']]);
  });

  it('places a subtask whose worktree could not be made on its own', async () => {
    // The failure that would otherwise be silent and expensive: a downgrade
    // that left it in the parallel wave would be the race arriving under the
    // feature's own name.
    const git = fakeGit({ addFails: ['b'] });
    const { run } = start({ runGit: git.run });

    const waves = await run.partitionBatch([writer('a'), writer('b')]);

    expect(run.worktreeFor('b')).toBeUndefined();
    expect(waves.map(wave => wave.map(task => task.id))).toEqual([['a'], ['b']]);
  });

  it('says how the batch was placed, once', async () => {
    const { run, notices } = start();

    await run.partitionBatch([writer('a'), writer('b')]);
    await run.partitionBatch([writer('c'), writer('d')]);

    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/2 in their own worktrees/);
  });

  it('says nothing at all when the batch runs as it always did', async () => {
    const { run, notices } = start();
    await run.partitionBatch([reader('r1'), reader('r2')]);
    expect(notices).toEqual([]);
  });
});

describe('the work comes back', () => {
  it('merges and removes the trees of the wave that just finished', async () => {
    const git = fakeGit({ patched: ['a'] });
    const { run } = start({ runGit: git.run });
    await run.partitionBatch([writer('a')]);

    await run.afterBatch(['a']);

    expect(git.run.mock.calls.some(([args]) => args[0] === 'apply' && args[1] === '--check')).toBe(true);
    expect(git.removed).toEqual([worktreePathFor(ROOT, 'run', 'a')]);
    expect(run.worktreeFor('a')).toBeUndefined();
  });

  it('keeps and names a tree whose changes would not apply', async () => {
    // Removing it would destroy the only copy of work the operator has not
    // seen — the whole reason a conflict is reported rather than resolved.
    const git = fakeGit({ patched: ['a'], applyFails: ['a'] });
    const { run, notices } = start({ runGit: git.run });
    await run.partitionBatch([writer('a')]);

    await run.afterBatch(['a']);

    expect(git.removed).toEqual([]);
    expect(notices.join(' ')).toContain(worktreePathFor(ROOT, 'run', 'a'));
    expect(notices.join(' ')).toContain('nothing is lost');
  });

  it('does not touch a tree belonging to a wave that has not run', async () => {
    // A batch is split further by the fan-out cap, so the next wave's trees
    // already exist. An unscoped sweep would take one a subtask is about to be
    // run in.
    const git = fakeGit({ patched: ['a', 'b'] });
    const { run } = start({ runGit: git.run });
    await run.partitionBatch([writer('a'), writer('b')]);

    await run.afterBatch(['a']);

    expect(git.removed).toEqual([worktreePathFor(ROOT, 'run', 'a')]);
    expect(run.worktreeFor('b')).toBe(worktreePathFor(ROOT, 'run', 'b'));
  });

  it('does nothing for a wave that had no worktrees', async () => {
    const git = fakeGit();
    const { run } = start({ runGit: git.run });
    await run.partitionBatch([reader('r')]);
    git.run.mockClear();

    await run.afterBatch(['r']);

    expect(git.run).not.toHaveBeenCalled();
  });
});

describe('a run that ended early', () => {
  it('keeps a stranded tree that holds changes, and says where', async () => {
    const git = fakeGit({ patched: ['a'] });
    const { run, notices } = start({ runGit: git.run });
    await run.partitionBatch([writer('a')]);

    await run.finish();

    expect(git.removed).toEqual([]);
    expect(notices.join(' ')).toContain(worktreePathFor(ROOT, 'run', 'a'));
    expect(notices.join(' ')).toContain('nothing is lost');
  });

  it('removes a stranded tree that holds nothing, without a word', async () => {
    // An aborted run should not litter `.git` with empty checkouts, and there
    // is nothing to tell anybody about.
    const git = fakeGit();
    const { run, notices } = start({ runGit: git.run });
    await run.partitionBatch([writer('a')]);

    await run.finish();

    expect(git.removed).toEqual([worktreePathFor(ROOT, 'run', 'a')]);
    expect(notices.filter(notice => notice.includes('nothing is lost'))).toEqual([]);
  });

  it('keeps a tree it could not read, because keeping cannot destroy anything', async () => {
    const git = fakeGit();
    const { run } = start({ runGit: git.run });
    await run.partitionBatch([writer('a')]);
    git.run.mockImplementation(async (args: readonly string[]) => {
      if (args[0] === 'diff' || args[0] === 'add') { throw new Error('git exploded'); }
      return '';
    });

    await run.finish();

    expect(git.removed).toEqual([]);
  });

  it('is a no-op after every wave merged cleanly', async () => {
    const git = fakeGit({ patched: ['a'] });
    const { run } = start({ runGit: git.run });
    await run.partitionBatch([writer('a')]);
    await run.afterBatch(['a']);
    git.run.mockClear();

    await run.finish();

    expect(git.run).not.toHaveBeenCalled();
  });

  it('survives a reporter that throws, in every hook', async () => {
    // `onNotice` reaches host code — a chat stream that has since been
    // cancelled, an output channel being disposed. A progress line is not worth
    // failing a run over, and inside the catch blocks a throwing notice would
    // escape the very guard that stops a throw replacing the real error.
    const git = fakeGit({ patched: ['a'] });
    const run = startWorktreeRun({
      runId: 'run',
      workspaceRoot: ROOT,
      runGit: git.run,
      canRerootSkillContext: true,
      isolationEnabled: true,
      onNotice: () => { throw new Error('the stream is closed'); },
    });

    await expect(run.partitionBatch([writer('a')])).resolves.toHaveLength(1);
    await expect(run.afterBatch(['a'])).resolves.toBeUndefined();
    await expect(run.finish()).resolves.toBeUndefined();
  });

  it('never throws out of either hook, whatever git does', async () => {
    // Both run from a `finally` in the scheduler and the Orchestrator. A throw
    // here would *replace* whatever ended the run — a billing abort would
    // surface as a git error and the real reason would be gone.
    const git = fakeGit();
    const { run, notices } = start({ runGit: git.run });
    await run.partitionBatch([writer('a')]);
    git.run.mockImplementation(async () => { throw new Error('git exploded'); });

    await expect(run.afterBatch(['a'])).resolves.toBeUndefined();
    await expect(run.finish()).resolves.toBeUndefined();
    expect(notices.join(' ')).toContain('nothing is lost');
  });

  it('is a no-op when isolation never started', async () => {
    const { run, notices } = start({ isolationEnabled: false });
    await run.partitionBatch([writer('a')]);
    await expect(run.finish()).resolves.toBeUndefined();
    expect(notices).toHaveLength(1);
  });
});
