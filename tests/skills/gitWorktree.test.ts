import { describe, expect, it, vi } from 'vitest';
import { gitWorktreeSkill, parseWorktreeList, normalizeWorktreePath } from '../../src/skills/gitWorktree.ts';
import type { SkillExecutionContext } from '../../src/types.ts';

const MAIN = 'C:/repo';
const LINKED = 'C:/repo/.claude/worktrees/char-gate-fix';

const PORCELAIN = [
  `worktree ${MAIN}`,
  'HEAD 1111111111111111111111111111111111111111',
  'branch refs/heads/develop',
  '',
  `worktree ${LINKED}`,
  'HEAD 2222222222222222222222222222222222222222',
  'branch refs/heads/fix/char-gate',
  '',
].join('\n');

function makeContext(
  overrides: Partial<SkillExecutionContext> = {},
): SkillExecutionContext {
  return {
    workspaceRootPath: MAIN,
    queryMemory: vi.fn().mockResolvedValue([]),
    upsertMemory: vi.fn().mockReturnValue({ status: 'created' }),
    deleteMemory: vi.fn().mockResolvedValue(true),
    readFile: vi.fn().mockResolvedValue(''),
    writeFile: vi.fn().mockResolvedValue(undefined),
    findFiles: vi.fn().mockResolvedValue([]),
    searchInFiles: vi.fn().mockResolvedValue([]),
    listDirectory: vi.fn().mockResolvedValue([]),
    runCommand: vi.fn().mockResolvedValue({ ok: true, exitCode: 0, stdout: PORCELAIN, stderr: '' }),
    getGitStatus: vi.fn().mockResolvedValue(''),
    getGitDiff: vi.fn().mockResolvedValue(''),
    rollbackLastCheckpoint: vi.fn().mockResolvedValue({ ok: true, summary: 'Rolled back.', restoredPaths: [] }),
    applyGitPatch: vi.fn().mockResolvedValue({ ok: true, stdout: '', stderr: '' }),
    getGitLog: vi.fn().mockResolvedValue(''),
    gitBranch: vi.fn().mockResolvedValue(''),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    moveFile: vi.fn().mockResolvedValue(undefined),
    getDiagnostics: vi.fn().mockResolvedValue([]),
    getDocumentSymbols: vi.fn().mockResolvedValue([]),
    findReferences: vi.fn().mockResolvedValue([]),
    goToDefinition: vi.fn().mockResolvedValue([]),
    renameSymbol: vi.fn().mockResolvedValue({ filesChanged: 0, editsApplied: 0 }),
    fetchUrl: vi.fn().mockResolvedValue({ ok: true, status: 200, body: '' }),
    httpRequest: vi.fn().mockResolvedValue({ ok: true, status: 200, body: '{}' }),
    getTerminalOutput: vi.fn().mockResolvedValue(''),
    ...overrides,
  } as unknown as SkillExecutionContext;
}

describe('parseWorktreeList', () => {
  it('parses porcelain output, marking only the first entry as main', () => {
    const entries = parseWorktreeList(PORCELAIN);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ path: MAIN, isMain: true, branch: 'develop' });
    expect(entries[1]).toMatchObject({ path: LINKED, isMain: false, branch: 'fix/char-gate' });
  });

  it('returns an empty list for empty output', () => {
    expect(parseWorktreeList('')).toEqual([]);
  });
});

describe('normalizeWorktreePath', () => {
  it('unifies slash style and trailing separators', () => {
    expect(normalizeWorktreePath('C:\\repo\\wt\\')).toBe(normalizeWorktreePath('C:/repo/wt'));
  });
});

describe('git-worktree skill', () => {
  it('lists worktrees with branch annotations', async () => {
    const context = makeContext();
    const result = await gitWorktreeSkill.execute({ action: 'list' }, context);
    expect(context.runCommand).toHaveBeenCalledWith('git', ['worktree', 'list', '--porcelain']);
    expect(result).toContain('(main worktree)');
    expect(result).toContain('[fix/char-gate]');
  });

  it('rejects unknown actions', async () => {
    const result = await gitWorktreeSkill.execute({ action: 'destroy' }, makeContext());
    expect(result).toContain('Error');
  });

  it('requires a path for remove', async () => {
    const result = await gitWorktreeSkill.execute({ action: 'remove' }, makeContext());
    expect(result).toContain('"path" is required');
  });

  it('refuses to remove a path git does not list as a worktree', async () => {
    const context = makeContext();
    const result = await gitWorktreeSkill.execute({ action: 'remove', path: 'C:/somewhere/else' }, context);
    expect(result).toContain('not a registered worktree');
    expect(context.runCommand).toHaveBeenCalledTimes(1);
  });

  it('refuses to remove the main worktree', async () => {
    const result = await gitWorktreeSkill.execute({ action: 'remove', path: MAIN }, makeContext());
    expect(result).toContain('main worktree');
  });

  it('removes a registered linked worktree', async () => {
    const runCommand = vi.fn()
      .mockResolvedValueOnce({ ok: true, exitCode: 0, stdout: PORCELAIN, stderr: '' })
      .mockResolvedValueOnce({ ok: true, exitCode: 0, stdout: '', stderr: '' });
    const context = makeContext({ runCommand });
    const result = await gitWorktreeSkill.execute({ action: 'remove', path: LINKED }, context);
    expect(runCommand).toHaveBeenCalledWith('git', ['worktree', 'remove', LINKED]);
    expect(result).toContain('Removed worktree');
    expect(result).toContain('fix/char-gate');
  });

  it('resolves a workspace-relative path against the workspace root', async () => {
    const runCommand = vi.fn()
      .mockResolvedValueOnce({ ok: true, exitCode: 0, stdout: PORCELAIN, stderr: '' })
      .mockResolvedValueOnce({ ok: true, exitCode: 0, stdout: '', stderr: '' });
    const context = makeContext({ runCommand });
    const result = await gitWorktreeSkill.execute(
      { action: 'remove', path: '.claude/worktrees/char-gate-fix' },
      context,
    );
    expect(result).toContain('Removed worktree');
  });

  it('suggests force when a non-force removal is refused', async () => {
    const runCommand = vi.fn()
      .mockResolvedValueOnce({ ok: true, exitCode: 0, stdout: PORCELAIN, stderr: '' })
      .mockResolvedValueOnce({ ok: false, exitCode: 128, stdout: '', stderr: 'contains modified or untracked files' });
    const context = makeContext({ runCommand });
    const result = await gitWorktreeSkill.execute({ action: 'remove', path: LINKED }, context);
    expect(result).toContain('force: true');
  });

  it('prunes stale registrations', async () => {
    const runCommand = vi.fn().mockResolvedValue({ ok: true, exitCode: 0, stdout: '', stderr: '' });
    const context = makeContext({ runCommand });
    const result = await gitWorktreeSkill.execute({ action: 'prune' }, context);
    expect(runCommand).toHaveBeenCalledWith('git', ['worktree', 'prune', '--verbose']);
    expect(result).toContain('Nothing needed pruning');
  });

  it('passes --dry-run through for prune previews', async () => {
    const runCommand = vi.fn().mockResolvedValue({ ok: true, exitCode: 0, stdout: '', stderr: '' });
    const context = makeContext({ runCommand });
    await gitWorktreeSkill.execute({ action: 'prune', dryRun: true }, context);
    expect(runCommand).toHaveBeenCalledWith('git', ['worktree', 'prune', '--dry-run', '--verbose']);
  });

  it.runIf(process.platform === 'win32')(
    'escalates a blocked force-removal inside the workspace on Windows and reports each step',
    async () => {
      const calls: string[][] = [];
      const runCommand = vi.fn(async (executable: string, args: string[] = []) => {
        calls.push([executable, ...args]);
        if (args[0] === 'worktree' && args[1] === 'list') {
          // After the rd fallback the worktree is no longer registered.
          const registeredTwice = calls.filter(call => call[1] === 'worktree' && call[2] === 'list').length;
          return {
            ok: true,
            exitCode: 0,
            stdout: registeredTwice > 1 ? PORCELAIN.split('\n').slice(0, 4).join('\n') : PORCELAIN,
            stderr: '',
          };
        }
        if (args[0] === 'worktree' && args[1] === 'remove') {
          return { ok: false, exitCode: 1, stdout: '', stderr: 'Permission denied' };
        }
        return { ok: true, exitCode: 0, stdout: '', stderr: '' };
      });
      const context = makeContext({ runCommand: runCommand as unknown as SkillExecutionContext['runCommand'] });

      const result = await gitWorktreeSkill.execute({ action: 'remove', path: LINKED, force: true }, context);

      expect(calls.some(call => call[0] === 'attrib')).toBe(true);
      expect(calls.some(call => call[0] === 'cmd' && call.includes('rd'))).toBe(true);
      expect(calls.some(call => call[0] === 'git' && call[1] === 'worktree' && call[2] === 'prune')).toBe(true);
      expect(result).toContain('Windows fallback');
    },
  );

  it.runIf(process.platform === 'win32')(
    'never escalates for a registered worktree outside the workspace root',
    async () => {
      const outside = 'C:/elsewhere/wt';
      const porcelainWithOutside = `${PORCELAIN}worktree ${outside}\nHEAD 3333333333333333333333333333333333333333\nbranch refs/heads/other\n`;
      const calls: string[][] = [];
      const runCommand = vi.fn(async (executable: string, args: string[] = []) => {
        calls.push([executable, ...args]);
        if (args[0] === 'worktree' && args[1] === 'list') {
          return { ok: true, exitCode: 0, stdout: porcelainWithOutside, stderr: '' };
        }
        return { ok: false, exitCode: 1, stdout: '', stderr: 'Permission denied' };
      });
      const context = makeContext({ runCommand: runCommand as unknown as SkillExecutionContext['runCommand'] });

      const result = await gitWorktreeSkill.execute({ action: 'remove', path: outside, force: true }, context);

      expect(calls.some(call => call[0] === 'cmd')).toBe(false);
      expect(calls.some(call => call[0] === 'attrib')).toBe(false);
      expect(result).toContain('outside the workspace root');
    },
  );
});
