import { describe, expect, it, vi } from 'vitest';
import { gitLogSkill, gitBranchSkill } from '../../src/skills/gitBranch.ts';
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
    getGitLog: vi.fn().mockResolvedValue('abc1234 feat: add feature\ndef5678 fix: bug fix'),
    gitBranch: vi.fn().mockResolvedValue('* main\n  feature/x'),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    moveFile: vi.fn().mockResolvedValue(undefined),
    getDiagnostics: vi.fn().mockResolvedValue([]),
    getDocumentSymbols: vi.fn().mockResolvedValue([]),
    findReferences: vi.fn().mockResolvedValue([]),
    goToDefinition: vi.fn().mockResolvedValue([]),
    renameSymbol: vi.fn().mockResolvedValue({ filesChanged: 0, editsApplied: 0 }),
    fetchUrl: vi.fn().mockResolvedValue({ ok: true, status: 200, body: '' }),
    httpRequest: vi.fn().mockResolvedValue({ ok: true, status: 200, body: '{}' }),
    getCodeActions: vi.fn().mockResolvedValue([]),
    applyCodeAction: vi.fn().mockResolvedValue({ applied: true }),
    getTerminalOutput: vi.fn().mockResolvedValue(''),
    getInstalledExtensions: vi.fn().mockResolvedValue([]),
    getPortForwards: vi.fn().mockResolvedValue([]),
    getTestResults: vi.fn().mockResolvedValue([]),
    getActiveDebugSession: vi.fn().mockResolvedValue(null),
    listTerminals: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('git-log skill', () => {
  it('returns commit log with default options', async () => {
    const context = makeContext();
    const result = await gitLogSkill.execute({}, context);
    expect(context.getGitLog).toHaveBeenCalledWith({ maxCount: 20, ref: undefined, filePath: undefined });
    expect(result).toContain('feat: add feature');
  });

  it('clamps maxCount to 100', async () => {
    const context = makeContext();
    await gitLogSkill.execute({ maxCount: 500 }, context);
    expect(context.getGitLog).toHaveBeenCalledWith(expect.objectContaining({ maxCount: 100 }));
  });

  it('passes ref and filePath', async () => {
    const context = makeContext();
    await gitLogSkill.execute({ ref: 'HEAD~5..HEAD', filePath: 'src/foo.ts' }, context);
    expect(context.getGitLog).toHaveBeenCalledWith({ maxCount: 20, ref: 'HEAD~5..HEAD', filePath: 'src/foo.ts' });
  });
});

describe('git-branch skill', () => {
  it('lists branches', async () => {
    const context = makeContext();
    const result = await gitBranchSkill.execute({ action: 'list' }, context);
    expect(context.gitBranch).toHaveBeenCalledWith('list', undefined);
    expect(result).toContain('main');
  });

  it('requires name for create action', async () => {
    const context = makeContext();
    const result = await gitBranchSkill.execute({ action: 'create' }, context);
    expect(result).toContain('Error');
  });

  it('rejects invalid branch names', async () => {
    const context = makeContext();
    const result = await gitBranchSkill.execute({ action: 'create', name: 'bad..name' }, context);
    expect(result).toContain('invalid');
  });

  it('creates a branch with valid name', async () => {
    const context = makeContext();
    await gitBranchSkill.execute({ action: 'create', name: 'feature/new' }, context);
    expect(context.gitBranch).toHaveBeenCalledWith('create', 'feature/new');
  });

  it('returns error for invalid action', async () => {
    const context = makeContext();
    const result = await gitBranchSkill.execute({ action: 'rebase' }, context);
    expect(result).toContain('Error');
  });

  it('rejects flag-shaped branch names so a name can never become an instruction', async () => {
    const context = makeContext();
    const result = await gitBranchSkill.execute({ action: 'delete', name: '--force' }, context);
    expect(result).toContain('invalid');
    expect(context.gitBranch).not.toHaveBeenCalled();
    expect(context.runCommand).not.toHaveBeenCalled();
  });

  it('lists only branches merged into a ref for cleanup candidacy', async () => {
    const context = makeContext({
      runCommand: vi.fn().mockResolvedValue({ ok: true, exitCode: 0, stdout: '  old/one\n  old/two', stderr: '' }),
    });
    const result = await gitBranchSkill.execute({ action: 'list', mergedInto: 'develop' }, context);
    expect(context.runCommand).toHaveBeenCalledWith('git', ['branch', '--merged', 'develop']);
    expect(context.gitBranch).not.toHaveBeenCalled();
    expect(result).toContain('old/one');
  });

  it('rejects a flag-shaped mergedInto ref', async () => {
    const context = makeContext();
    const result = await gitBranchSkill.execute({ action: 'list', mergedInto: '--contains' }, context);
    expect(result).toContain('invalid');
    expect(context.runCommand).not.toHaveBeenCalled();
  });

  it('includes remote-tracking branches with all', async () => {
    const context = makeContext({
      runCommand: vi.fn().mockResolvedValue({ ok: true, exitCode: 0, stdout: '  remotes/origin/x', stderr: '' }),
    });
    await gitBranchSkill.execute({ action: 'list', all: true }, context);
    expect(context.runCommand).toHaveBeenCalledWith('git', ['branch', '--all']);
  });

  it('refuses to delete a protected branch, locally or remotely', async () => {
    const context = makeContext();
    const local = await gitBranchSkill.execute({ action: 'delete', name: 'main' }, context);
    const remote = await gitBranchSkill.execute({ action: 'delete', name: 'release/1.0', remote: true }, context);
    expect(local).toContain('protected');
    expect(remote).toContain('protected');
    expect(context.gitBranch).not.toHaveBeenCalled();
    expect(context.runCommand).not.toHaveBeenCalled();
  });

  it('force-deletes with -D via runCommand', async () => {
    const context = makeContext();
    const result = await gitBranchSkill.execute({ action: 'delete', name: 'old/spike', force: true }, context);
    expect(context.runCommand).toHaveBeenCalledWith('git', ['branch', '-D', 'old/spike']);
    expect(result).toContain('Force-deleted');
  });

  it('points at git-worktree when a force-delete is pinned by a worktree', async () => {
    const context = makeContext({
      runCommand: vi.fn().mockResolvedValue({
        ok: false,
        exitCode: 1,
        stdout: '',
        stderr: "error: cannot delete branch 'old/spike' used by worktree at '/repo/.claude/worktrees/spike'",
      }),
    });
    const result = await gitBranchSkill.execute({ action: 'delete', name: 'old/spike', force: true }, context);
    expect(result).toContain('git-worktree');
  });

  it('deletes a remote branch with git push --delete', async () => {
    const context = makeContext();
    const result = await gitBranchSkill.execute({ action: 'delete', name: 'feature/done', remote: true }, context);
    expect(context.runCommand).toHaveBeenCalledWith('git', ['push', 'origin', '--delete', 'feature/done']);
    expect(result).toContain('origin');
  });

  it('keeps the plain local delete on the context bridge', async () => {
    const context = makeContext();
    await gitBranchSkill.execute({ action: 'delete', name: 'feature/done' }, context);
    expect(context.gitBranch).toHaveBeenCalledWith('delete', 'feature/done');
    expect(context.runCommand).not.toHaveBeenCalled();
  });
});
