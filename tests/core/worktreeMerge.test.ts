import { describe, expect, it, vi } from 'vitest';

import {
  applyWorktreePatch,
  collectWorktreePatch,
  describeWorktreeMerge,
  mergeWorktrees,
  worktreesToKeep,
} from '../../src/core/worktreeMerge.ts';

/**
 * Getting an isolated subtask's work back, and what happens when it will not go.
 *
 * The half that decides whether worktree isolation is worth having. Isolation
 * is only useful if the work comes back; it is only safe if work that cannot
 * come back cleanly is neither lost nor forced.
 */

const ROOT = '/repo';
const PATCH = 'diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n';

function fakeGit(responses: Record<string, string | Error> = {}) {
  const calls: Array<{ args: string[]; cwd: string; stdin?: string }> = [];
  const run = vi.fn(async (args: readonly string[], cwd: string, stdin?: string) => {
    calls.push({ args: [...args], cwd, ...(stdin === undefined ? {} : { stdin }) });
    const key = args.join(' ');
    const match = Object.entries(responses).find(([prefix]) => key.startsWith(prefix));
    if (match) {
      if (match[1] instanceof Error) { throw match[1]; }
      return match[1];
    }
    return '';
  });
  return { run, calls };
}

describe('collecting a worktree\'s work', () => {
  it('registers new files first, or they would be silently dropped', async () => {
    // `git diff` shows tracked changes only. Without intent-to-add, a subtask
    // that created a file loses it — and it looks like the model never made it.
    const git = fakeGit({ diff: PATCH });

    await collectWorktreePatch(git.run, '/wt');

    expect(git.calls[0]?.args).toEqual(['add', '--intent-to-add', '--all']);
    expect(git.calls[1]?.args).toContain('diff');
  });

  it('asks for binary-safe output', async () => {
    // A subtask that touches an image or a lockfile with odd bytes must not
    // produce a patch that silently drops it.
    const git = fakeGit({ diff: PATCH });
    await collectWorktreePatch(git.run, '/wt');
    expect(git.calls[1]?.args).toContain('--binary');
  });

  it('returns empty when the subtask changed nothing', async () => {
    const git = fakeGit();
    await expect(collectWorktreePatch(git.run, '/wt')).resolves.toBe('');
  });
});

describe('applying a patch', () => {
  it('checks before it writes', async () => {
    // A refusal must happen before anything is written rather than partway
    // through.
    const git = fakeGit();

    await applyWorktreePatch(git.run, ROOT, PATCH);

    expect(git.calls[0]?.args).toEqual(['apply', '--check', '-']);
    expect(git.calls[1]?.args).toEqual(['apply', '-']);
  });

  it('pipes the patch rather than writing it to a temp file', async () => {
    // A patch is workspace content. A temp file would put it on disk outside
    // the workspace, where none of this project's boundaries reach it.
    const git = fakeGit();
    await applyWorktreePatch(git.run, ROOT, PATCH);
    expect(git.calls[0]?.stdin).toBe(PATCH);
  });

  it('never uses --3way', async () => {
    // `--3way` can leave conflict markers in a file and report success. A
    // subtask's work half-applied into a file nobody has read is worse than the
    // same work sitting in a directory somebody can be told about.
    const git = fakeGit();
    await applyWorktreePatch(git.run, ROOT, PATCH);
    expect(git.calls.every(call => !call.args.includes('--3way'))).toBe(true);
  });

  it('does not write when the check fails', async () => {
    const git = fakeGit({ 'apply --check': new Error('patch does not apply') });

    const result = await applyWorktreePatch(git.run, ROOT, PATCH);

    expect(result).toEqual({ ok: false, reason: 'patch does not apply' });
    expect(git.calls).toHaveLength(1);
  });

  it('does nothing at all for an empty patch', async () => {
    const git = fakeGit();
    await expect(applyWorktreePatch(git.run, ROOT, '   ')).resolves.toEqual({ ok: true });
    expect(git.run).not.toHaveBeenCalled();
  });
});

describe('merging several worktrees', () => {
  const sources = [
    { subTaskId: 'a', worktreePath: '/wt/a' },
    { subTaskId: 'b', worktreePath: '/wt/b' },
  ];

  it('applies them one at a time', async () => {
    // The subtasks ran in parallel; their patches must not. Applying
    // concurrently reintroduces the race at merge time, when the run already
    // reports itself finished.
    const order: string[] = [];
    const run = vi.fn(async (args: readonly string[], cwd: string) => {
      order.push(`${args[0]}:${cwd}`);
      return args[0] === 'diff' ? PATCH : '';
    });

    await mergeWorktrees(run, ROOT, sources);

    // Everything for /wt/a happens before anything for /wt/b.
    const firstB = order.findIndex(entry => entry.endsWith('/wt/b'));
    const lastA = order.map(e => e.endsWith('/wt/a')).lastIndexOf(true);
    expect(lastA).toBeLessThan(firstB);
  });

  it('reports each outcome separately', async () => {
    const run = vi.fn(async (args: readonly string[], cwd: string) => {
      if (args[0] === 'diff') { return cwd === '/wt/a' ? PATCH : ''; }
      return '';
    });

    const outcomes = await mergeWorktrees(run, ROOT, sources);

    expect(outcomes.map(o => o.status)).toEqual(['applied', 'nothing-to-merge']);
  });

  it('keeps going after one conflicts', async () => {
    // A run whose work succeeded must not stop reporting because one subtask's
    // changes would not apply.
    const run = vi.fn(async (args: readonly string[], cwd: string) => {
      if (args[0] === 'diff') { return PATCH; }
      if (args[0] === 'apply' && cwd === ROOT && args.includes('--check')) {
        throw new Error('patch does not apply');
      }
      return '';
    });

    const outcomes = await mergeWorktrees(run, ROOT, sources);

    expect(outcomes.map(o => o.status)).toEqual(['conflicted', 'conflicted']);
    expect(outcomes[0]?.detail).toContain('does not apply');
  });

  it('never throws, whatever git does', async () => {
    const run = vi.fn(async () => { throw new Error('git exploded'); });

    const outcomes = await mergeWorktrees(run, ROOT, sources);

    expect(outcomes.every(o => o.status === 'failed')).toBe(true);
  });
});

describe('what survives cleanup, and what is said about it', () => {
  it('keeps every worktree that did not merge cleanly', async () => {
    // Removing one would destroy the only copy of that subtask's work, which
    // the operator has not seen — the whole reason a conflict is reported
    // rather than resolved.
    const kept = worktreesToKeep([
      { subTaskId: 'a', worktreePath: '/wt/a', status: 'applied' },
      { subTaskId: 'b', worktreePath: '/wt/b', status: 'conflicted' },
      { subTaskId: 'c', worktreePath: '/wt/c', status: 'failed' },
      { subTaskId: 'd', worktreePath: '/wt/d', status: 'nothing-to-merge' },
    ]);

    expect(kept).toEqual(['b', 'c']);
  });

  it('says nothing when everything merged', () => {
    // A line on every run saying "all fine" is the line people stop reading
    // before the run where it says something else.
    expect(describeWorktreeMerge([
      { subTaskId: 'a', worktreePath: '/wt/a', status: 'applied' },
      { subTaskId: 'b', worktreePath: '/wt/b', status: 'nothing-to-merge' },
    ])).toBe('');
  });

  it('names the path, because the work is real and recoverable', () => {
    const message = describeWorktreeMerge([
      { subTaskId: 'a', worktreePath: '/wt/a', status: 'applied' },
      { subTaskId: 'b', worktreePath: '/wt/b', status: 'conflicted', detail: 'patch does not apply' },
    ]);

    expect(message).toContain('/wt/b');
    expect(message).toContain('patch does not apply');
    expect(message).toContain('1 merged cleanly');
    expect(message).toContain('nothing is lost');
  });

  it('carries no patch body into the report', () => {
    // The report goes to an output channel. A patch is workspace content.
    const message = describeWorktreeMerge([
      { subTaskId: 'b', worktreePath: '/wt/b', status: 'conflicted', detail: 'patch does not apply' },
    ]);

    expect(message).not.toContain('diff --git');
    expect(message).not.toContain('+new');
  });
});
