import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  GIT_HASH_ARGS,
  GIT_PREFIX_ARGS,
  GIT_STATUS_ARGS,
  MAX_RECONCILED_ENTRIES,
  buildDelegatedExecutionRecord,
  captureGitWorkingState,
  delegatedToolArtifacts,
  describeDelegatedExecution,
  formatDelegatedToolRound,
  mergeDelegatedExecutionRecords,
  parsePorcelainZ,
  planDelegatedCheckpoint,
  reconcileWorkingStates,
  sanitizeDelegatedExecutionRecord,
  type GitWorkingState,
} from '../../src/core/acpDelegation.ts';
import type { DelegatedToolCall } from '../../src/providers/adapter.ts';

type GitState = Extract<GitWorkingState, { kind: 'git' }>;
const state = (entries: Record<string, [string, string?]>): GitState => ({
  kind: 'git',
  entries: new Map(Object.entries(entries).map(([path, [code, hash]]) => [path, hash ? { code, hash } : { code }])),
});
const call = (over: Partial<DelegatedToolCall> = {}): DelegatedToolCall => ({
  toolCallId: 'c1', title: 'Write a.txt', kind: 'edit', status: 'completed', locations: ['/work/a.txt'], isUpdate: false, ...over,
});
const POSIX = { platform: 'linux' };

describe('acpDelegation — reading the working tree', () => {
  it('parses porcelain -z entries, keeping a rename\'s new path and skipping its origin', () => {
    const parsed = parsePorcelainZ(' M src/a.ts\0?? notes.md\0R  src/new.ts\0src/old.ts\0 D gone.ts\0');
    expect([...parsed]).toEqual([
      ['src/a.ts', ' M'],
      ['notes.md', '??'],
      ['src/new.ts', 'R '],
      ['gone.ts', ' D'],
    ]);
  });

  it('runs only its constant git commands, sends paths on stdin, and strips a subfolder prefix', async () => {
    const calls: Array<{ args: readonly string[]; stdin?: string }> = [];
    const runGit = async (args: readonly string[], _cwd: string, stdin?: string) => {
      calls.push({ args, ...(stdin !== undefined ? { stdin } : {}) });
      if (args === GIT_PREFIX_ARGS) return 'pkg/\n';
      if (args === GIT_STATUS_ARGS) return ' M pkg/a.ts\0 D pkg/b.ts\0?? other/c.ts\0';
      if (args === GIT_HASH_ARGS) return 'aaa\n';
      throw new Error(`unexpected ${args.join(' ')}`);
    };

    const reading = await captureGitWorkingState('/repo/pkg', runGit);

    expect(reading).toEqual(state({ 'a.ts': [' M', 'aaa'], 'b.ts': [' D'] }));
    expect(calls.map(entry => entry.args)).toEqual([GIT_PREFIX_ARGS, GIT_STATUS_ARGS, GIT_HASH_ARGS]);
    // Only a file that exists is hashed, and only through stdin.
    expect(calls[2]!.stdin).toBe('a.ts\n');
  });

  it('is unavailable — never empty — when git cannot answer or answers incompletely', async () => {
    expect(await captureGitWorkingState('/w', undefined)).toMatchObject({ kind: 'unavailable' });
    expect(await captureGitWorkingState('/w', async () => { throw new Error('not a git repository'); }))
      .toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('not a git repository') });
    const shortHash = async (args: readonly string[]) => (args === GIT_STATUS_ARGS ? ' M a\0 M b\0' : args === GIT_HASH_ARGS ? 'only-one\n' : '');
    expect(await captureGitWorkingState('/w', shortHash)).toMatchObject({ kind: 'unavailable' });
    const huge = async (args: readonly string[]) => (args === GIT_STATUS_ARGS ? Array.from({ length: MAX_RECONCILED_ENTRIES + 1 }, (_, i) => `?? f${i}`).join('\0') : '');
    expect(await captureGitWorkingState('/w', huge)).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('too many') });
  });
});

describe('acpDelegation — what changed', () => {
  it('counts new dirt, re-edits of dirty files, deletions and restorations — and nothing else', () => {
    const before = state({ 'dirty.ts': [' M', 'h1'], 'stable.ts': [' M', 'h2'], 'restored.ts': [' M', 'h3'], 'scratch.txt': ['??', 'h4'] });
    const after = state({
      'dirty.ts': [' M', 'h1-changed'],
      'stable.ts': [' M', 'h2'],
      'new.ts': ['??', 'h5'],
      'tracked.ts': [' M', 'h6'],
      'removed.ts': [' D'],
    });

    expect(reconcileWorkingStates(before, after)).toEqual([
      { relativePath: 'dirty.ts', status: 'modified' },
      { relativePath: 'new.ts', status: 'created' },
      { relativePath: 'removed.ts', status: 'deleted' },
      { relativePath: 'restored.ts', status: 'modified' },
      { relativePath: 'scratch.txt', status: 'deleted' },
      { relativePath: 'tracked.ts', status: 'modified' },
    ]);
  });

  it('property: a tree compared with itself changed nothing, and every change comes from one of the two readings', () => {
    const entry = fc.tuple(fc.constantFrom(' M', '??', ' D', 'A '), fc.stringMatching(/^[0-9a-f]{1,4}$/));
    const tree = fc.dictionary(fc.stringMatching(/^[a-z]{1,6}$/), entry, { maxKeys: 12 });
    fc.assert(fc.property(tree, tree, (left, right) => {
      const toState = (raw: Record<string, [string, string]>) => state(Object.fromEntries(
        Object.entries(raw).map(([path, [code, hash]]) => [path, code === ' D' ? [code] : [code, hash]]),
      ));
      expect(reconcileWorkingStates(toState(left), toState(left))).toEqual([]);
      for (const change of reconcileWorkingStates(toState(left), toState(right))) {
        expect(change.relativePath in left || change.relativePath in right).toBe(true);
      }
    }));
  });
});

describe('acpDelegation — the rollback point is taken at approval', () => {
  it('needs nothing for an operation that does not change files', () => {
    expect(planDelegatedCheckpoint(call({ kind: 'execute', locations: [] }), '/work', POSIX)).toEqual({ action: 'none' });
    expect(planDelegatedCheckpoint(call({ kind: 'read' }), '/work', POSIX)).toEqual({ action: 'none' });
  });

  it('checkpoints every file an edit names, inside the turn\'s folder', () => {
    expect(planDelegatedCheckpoint(call({ locations: ['/work/a.txt', 'sub/b.txt'] }), '/work', POSIX)).toEqual({
      action: 'checkpoint',
      absolutePaths: ['/work/a.txt', '/work/sub/b.txt'],
      relativePaths: ['a.txt', 'sub/b.txt'],
    });
    expect(planDelegatedCheckpoint(call({ locations: ['C:\\Work\\src\\a.ts'] }), 'C:\\Work', { platform: 'win32' })).toEqual({
      action: 'checkpoint',
      absolutePaths: ['C:\\Work\\src\\a.ts'],
      relativePaths: ['src/a.ts'],
    });
  });

  it('refuses an edit that names no file, or a file outside the folder it was given', () => {
    expect(planDelegatedCheckpoint(call({ locations: [] }), '/work', POSIX)).toMatchObject({ action: 'refuse', reason: expect.stringContaining('without naming the file') });
    expect(planDelegatedCheckpoint(call({ locations: ['/etc/hosts'] }), '/work', POSIX)).toMatchObject({ action: 'refuse', reason: expect.stringContaining('outside') });
    expect(planDelegatedCheckpoint(call({ locations: ['../escape.txt'] }), '/work', POSIX)).toMatchObject({ action: 'refuse' });
    expect(planDelegatedCheckpoint(call({ kind: 'delete', locations: ['/work'] }), '/work', POSIX)).toMatchObject({ action: 'refuse' });
  });
});

describe('acpDelegation — the record', () => {
  const before = state({});
  const after = state({ 'a.txt': ['??', 'h1'], 'built.js': ['??', 'h2'] });

  it('names a change the agent did not report, and one with no rollback point', () => {
    const record = buildDelegatedExecutionRecord({
      model: 'acp/codex', root: '/work', rules: POSIX, before, after,
      toolCalls: [call()], checkpointedPaths: ['a.txt'], checkpointTaskId: 't1',
    });
    expect(record).toEqual({
      model: 'acp/codex',
      verification: 'git',
      changedFiles: [{ relativePath: 'a.txt', status: 'created' }, { relativePath: 'built.js', status: 'created' }],
      unreportedChanges: ['built.js'],
      notCheckpointed: ['built.js'],
      checkpointTaskId: 't1',
      toolCallCount: 1,
    });
    expect(describeDelegatedExecution(record)).toBe(
      'Delegated agent changed 2 files, checked against git — 1 it did not report; 1 with no rollback point (built.js).',
    );
  });

  it('says it was not checked, and lists only what the agent reported, when git could not answer', () => {
    const record = buildDelegatedExecutionRecord({
      model: 'acp/claude', root: '/work', rules: POSIX,
      before: { kind: 'unavailable', reason: 'not a git repository' }, after,
      toolCalls: [call(), call({ toolCallId: 'c2', kind: 'execute', locations: [] })], checkpointedPaths: [],
    });
    expect(record.verification).toBe('unverified');
    expect(record.verificationNote).toContain('not a git repository');
    expect(record.changedFiles).toEqual([{ relativePath: 'a.txt', status: 'modified' }]);
    expect(describeDelegatedExecution(record)).toMatch(/not checked against the workspace/);
  });

  it('merges two rounds without losing that a file was created first', () => {
    const first = buildDelegatedExecutionRecord({ model: 'acp/codex', root: '/work', rules: POSIX, before, after: state({ 'a.txt': ['??', 'h1'] }), toolCalls: [call()], checkpointedPaths: ['a.txt'] });
    const second = buildDelegatedExecutionRecord({ model: 'acp/codex', root: '/work', rules: POSIX, before: state({ 'a.txt': ['??', 'h1'] }), after: state({ 'a.txt': ['??', 'h9'] }), toolCalls: [call({ toolCallId: 'c2' })], checkpointedPaths: [] });
    const merged = mergeDelegatedExecutionRecords(first, second);
    expect(merged.changedFiles).toEqual([{ relativePath: 'a.txt', status: 'created' }]);
    expect(merged.toolCallCount).toBe(2);
    expect(merged.notCheckpointed).toEqual(['a.txt']);
  });

  it('reads a persisted record back as untrusted', () => {
    expect(sanitizeDelegatedExecutionRecord(null)).toBeUndefined();
    expect(sanitizeDelegatedExecutionRecord({ verification: 'git' })).toBeUndefined();
    const read = sanitizeDelegatedExecutionRecord({
      model: 'acp/codex',
      verification: 'trust-me',
      changedFiles: [{ relativePath: 'a.txt', status: 'created' }, { relativePath: 'b', status: 'exploded' }],
      plan: [{ content: 'step', status: 'done' }],
      toolCallCount: -4,
      extra: 'dropped',
    });
    expect(read).toEqual({
      model: 'acp/codex',
      verification: 'unverified',
      verificationNote: 'Recorded without saying how it was checked.',
      changedFiles: [{ relativePath: 'a.txt', status: 'created' }],
      unreportedChanges: [],
      notCheckpointed: [],
      toolCallCount: 0,
      plan: [{ content: 'step', status: 'pending' }],
    });
  });
});

describe('acpDelegation — what the run record and the chat show', () => {
  it('turns the agent\'s calls into tool artifacts, marking which were checkpointed', () => {
    expect(delegatedToolArtifacts([call()], new Map([['c1', 1234.4]]), new Set(['c1']))).toEqual([
      { toolName: 'acp:edit', durationMs: 1234, checkpointed: true, resultPreview: 'completed: Write a.txt (a.txt)' },
    ]);
  });

  it('emits the tool-round line the chat view already parses', () => {
    const line = formatDelegatedToolRound([call(), call({ toolCallId: 'c2', kind: 'execute', title: 'npm test', status: 'in_progress', locations: [] })], 1);
    expect(line.startsWith('[TOOL_EXEC]')).toBe(true);
    const json = JSON.parse(line.slice('[TOOL_EXEC]'.length, line.indexOf('}Delegated') + 1));
    expect(json).toEqual({
      type: 'tool-round',
      round: 1,
      toolCount: 2,
      tools: [{ name: 'acp:edit Write a.txt', status: 'done' }, { name: 'acp:execute npm test', status: 'pending' }],
      isActive: true,
    });
  });
});
