import { describe, expect, it, vi } from 'vitest';
import { gitFetchSkill, gitPullSkill, isSafeGitRefArgument } from '../../src/skills/gitSync.ts';
import type { SkillExecutionContext } from '../../src/types.ts';

function makeContext(
  overrides: Partial<SkillExecutionContext> = {},
): SkillExecutionContext {
  return {
    workspaceRootPath: '/workspace',
    queryMemory: vi.fn().mockResolvedValue([]),
    upsertMemory: vi.fn().mockReturnValue({ status: 'created' }),
    deleteMemory: vi.fn().mockResolvedValue(true),
    readFile: vi.fn().mockResolvedValue(''),
    writeFile: vi.fn().mockResolvedValue(undefined),
    findFiles: vi.fn().mockResolvedValue([]),
    searchInFiles: vi.fn().mockResolvedValue([]),
    listDirectory: vi.fn().mockResolvedValue([]),
    runCommand: vi.fn().mockResolvedValue({ ok: true, exitCode: 0, stdout: '', stderr: '' }),
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

describe('isSafeGitRefArgument', () => {
  it('accepts ordinary remote and branch names', () => {
    expect(isSafeGitRefArgument('origin')).toBe(true);
    expect(isSafeGitRefArgument('feature/cleanup-123')).toBe(true);
  });

  it('rejects flag-shaped values so a name can never become an instruction', () => {
    expect(isSafeGitRefArgument('--mirror')).toBe(false);
    expect(isSafeGitRefArgument('-f')).toBe(false);
  });

  it('rejects traversal, whitespace, and ref-syntax characters', () => {
    expect(isSafeGitRefArgument('a..b')).toBe(false);
    expect(isSafeGitRefArgument('a b')).toBe(false);
    expect(isSafeGitRefArgument('a~1')).toBe(false);
    expect(isSafeGitRefArgument('')).toBe(false);
  });
});

describe('git-fetch skill', () => {
  it('fetches origin by default', async () => {
    const context = makeContext();
    const result = await gitFetchSkill.execute({}, context);
    expect(context.runCommand).toHaveBeenCalledWith('git', ['fetch', 'origin']);
    expect(result).toContain('up to date');
  });

  it('adds --prune for branch cleanup', async () => {
    const context = makeContext();
    await gitFetchSkill.execute({ prune: true }, context);
    expect(context.runCommand).toHaveBeenCalledWith('git', ['fetch', '--prune', 'origin']);
  });

  it('fetches all remotes with --all instead of a remote name', async () => {
    const context = makeContext();
    await gitFetchSkill.execute({ all: true, tags: true }, context);
    expect(context.runCommand).toHaveBeenCalledWith('git', ['fetch', '--tags', '--all']);
  });

  it('rejects a flag-shaped remote name', async () => {
    const context = makeContext();
    const result = await gitFetchSkill.execute({ remote: '--upload-pack=evil' }, context);
    expect(result).toContain('invalid characters');
    expect(context.runCommand).not.toHaveBeenCalled();
  });

  it('reports a failed fetch as an error', async () => {
    const context = makeContext({
      runCommand: vi.fn().mockResolvedValue({ ok: false, exitCode: 128, stdout: '', stderr: 'could not resolve host' }),
    });
    const result = await gitFetchSkill.execute({}, context);
    expect(result).toContain('Error');
    expect(result).toContain('could not resolve host');
  });
});

describe('git-pull skill', () => {
  it('defaults to fast-forward-only', async () => {
    const context = makeContext();
    await gitPullSkill.execute({}, context);
    expect(context.runCommand).toHaveBeenCalledWith('git', ['pull', '--ff-only', 'origin']);
  });

  it('supports rebase mode', async () => {
    const context = makeContext();
    await gitPullSkill.execute({ mode: 'rebase', branch: 'develop' }, context);
    expect(context.runCommand).toHaveBeenCalledWith('git', ['pull', '--rebase', 'origin', 'develop']);
  });

  it('omits the integration flag entirely in merge mode', async () => {
    const context = makeContext();
    await gitPullSkill.execute({ mode: 'merge' }, context);
    expect(context.runCommand).toHaveBeenCalledWith('git', ['pull', 'origin']);
  });

  it('rejects an unknown mode', async () => {
    const result = await gitPullSkill.execute({ mode: 'force' }, makeContext());
    expect(result).toContain('Error');
  });

  it('rejects a flag-shaped branch', async () => {
    const context = makeContext();
    const result = await gitPullSkill.execute({ branch: '--force' }, context);
    expect(result).toContain('invalid characters');
    expect(context.runCommand).not.toHaveBeenCalled();
  });

  it('explains the two deliberate integration modes when history has diverged', async () => {
    const context = makeContext({
      runCommand: vi.fn().mockResolvedValue({
        ok: false,
        exitCode: 128,
        stdout: '',
        stderr: 'fatal: Not possible to fast-forward, aborting.',
      }),
    });
    const result = await gitPullSkill.execute({}, context);
    expect(result).toContain('diverged');
    expect(result).toContain('rebase');
  });
});
