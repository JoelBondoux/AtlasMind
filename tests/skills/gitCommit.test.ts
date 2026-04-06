import { describe, expect, it, vi } from 'vitest';
import { gitCommitSkill } from '../../src/skills/gitCommit.ts';
import type { SkillExecutionContext } from '../../src/types.ts';

function makeContext(overrides: Partial<SkillExecutionContext> = {}): SkillExecutionContext {
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
    getCodeActions: vi.fn().mockResolvedValue([]),
    applyCodeAction: vi.fn().mockResolvedValue({ applied: true }),
    getTestResults: vi.fn().mockResolvedValue([]),
    getActiveDebugSession: vi.fn().mockResolvedValue(null),
    listTerminals: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('git-commit skill', () => {
  it('creates a commit with the given message', async () => {
    const context = makeContext({
      runCommand: vi.fn().mockResolvedValue({
        ok: true,
        exitCode: 0,
        stdout: '[master abc1234] fix: typo\n 1 file changed',
        stderr: '',
      }),
    });
    const result = await gitCommitSkill.execute({ message: 'fix: typo' }, context);
    expect(context.runCommand).toHaveBeenCalledWith('git', ['commit', '-m', 'fix: typo']);
    expect(result).toContain('ok: true');
    expect(result).toContain('exitCode: 0');
    expect(result).toContain('fix: typo');
  });

  it('returns an error when message is missing', async () => {
    const context = makeContext();
    const result = await gitCommitSkill.execute({}, context);
    expect(result).toContain('Error');
    expect(context.runCommand).not.toHaveBeenCalled();
  });

  it('returns an error when message is an empty string', async () => {
    const context = makeContext();
    const result = await gitCommitSkill.execute({ message: '  ' }, context);
    expect(result).toContain('Error');
    expect(context.runCommand).not.toHaveBeenCalled();
  });

  it('returns an error when message is not a string', async () => {
    const context = makeContext();
    const result = await gitCommitSkill.execute({ message: 123 }, context);
    expect(result).toContain('Error');
    expect(context.runCommand).not.toHaveBeenCalled();
  });

  it('trims the commit message', async () => {
    const context = makeContext({
      runCommand: vi.fn().mockResolvedValue({ ok: true, exitCode: 0, stdout: '', stderr: '' }),
    });
    await gitCommitSkill.execute({ message: '  chore: clean up  ' }, context);
    expect(context.runCommand).toHaveBeenCalledWith('git', ['commit', '-m', 'chore: clean up']);
  });

  it('reports a failed commit', async () => {
    const context = makeContext({
      runCommand: vi.fn().mockResolvedValue({
        ok: false,
        exitCode: 1,
        stdout: '',
        stderr: 'nothing to commit',
      }),
    });
    const result = await gitCommitSkill.execute({ message: 'feat: empty' }, context);
    expect(result).toContain('ok: false');
    expect(result).toContain('nothing to commit');
  });
});
