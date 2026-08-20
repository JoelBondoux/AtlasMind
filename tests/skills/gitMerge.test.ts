import { describe, expect, it, vi } from 'vitest';
import { gitMergeSkill } from '../../src/skills/gitMerge.ts';
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

describe('git-merge skill', () => {
  it('requires a branch for merge', async () => {
    const result = await gitMergeSkill.execute({ action: 'merge' }, makeContext());
    expect(result).toContain('"branch" is required');
  });

  it('rejects flag-shaped branch names', async () => {
    const context = makeContext();
    const result = await gitMergeSkill.execute({ action: 'merge', branch: '--squash' }, context);
    expect(result).toContain('invalid characters');
    expect(context.runCommand).not.toHaveBeenCalled();
  });

  it('merges a branch into the current branch', async () => {
    const context = makeContext({
      runCommand: vi.fn().mockResolvedValue({ ok: true, exitCode: 0, stdout: 'Fast-forward', stderr: '' }),
    });
    const result = await gitMergeSkill.execute({ action: 'merge', branch: 'feature/x' }, context);
    expect(context.runCommand).toHaveBeenCalledWith('git', ['merge', 'feature/x']);
    expect(result).toContain('Fast-forward');
  });

  it('supports --no-ff with a message', async () => {
    const context = makeContext();
    await gitMergeSkill.execute({ action: 'merge', branch: 'develop', noFf: true, message: 'promote develop' }, context);
    expect(context.runCommand).toHaveBeenCalledWith('git', ['merge', '--no-ff', '-m', 'promote develop', 'develop']);
  });

  it('lists conflicted files and both ways out when the merge stops', async () => {
    const runCommand = vi.fn()
      .mockResolvedValueOnce({ ok: false, exitCode: 1, stdout: 'CONFLICT', stderr: '' })
      .mockResolvedValueOnce({ ok: true, exitCode: 0, stdout: 'src/a.ts\nsrc/b.ts', stderr: '' });
    const context = makeContext({ runCommand });
    const result = await gitMergeSkill.execute({ action: 'merge', branch: 'develop' }, context);
    expect(runCommand).toHaveBeenCalledWith('git', ['diff', '--name-only', '--diff-filter=U']);
    expect(result).toContain('src/a.ts');
    expect(result).toContain('abort');
  });

  it('aborts an in-progress merge', async () => {
    const context = makeContext();
    const result = await gitMergeSkill.execute({ action: 'abort' }, context);
    expect(context.runCommand).toHaveBeenCalledWith('git', ['merge', '--abort']);
    expect(result).toContain('aborted');
  });

  it('rejects unknown actions', async () => {
    const result = await gitMergeSkill.execute({ action: 'rebase' }, makeContext());
    expect(result).toContain('Error');
  });
});
