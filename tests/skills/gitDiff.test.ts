import { describe, expect, it, vi } from 'vitest';
import { gitDiffSkill } from '../../src/skills/gitDiff.ts';
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
    getCodeActions: vi.fn().mockResolvedValue([]),
    applyCodeAction: vi.fn().mockResolvedValue({ applied: true }),
    ...overrides,
  };
}

describe('git-diff skill', () => {
  it('returns diff output', async () => {
    const context = makeContext({
      getGitDiff: vi.fn().mockResolvedValue('diff --git a/foo.ts b/foo.ts\n+added line'),
    });
    const result = await gitDiffSkill.execute({}, context);
    expect(context.getGitDiff).toHaveBeenCalledWith({ ref: undefined, staged: false });
    expect(result).toContain('+added line');
  });

  it('returns empty message for blank diff', async () => {
    const context = makeContext({ getGitDiff: vi.fn().mockResolvedValue('  ') });
    const result = await gitDiffSkill.execute({}, context);
    expect(result).toBe('Git diff is empty.');
  });

  it('passes ref parameter', async () => {
    const context = makeContext({
      getGitDiff: vi.fn().mockResolvedValue('diff output'),
    });
    await gitDiffSkill.execute({ ref: 'HEAD~1' }, context);
    expect(context.getGitDiff).toHaveBeenCalledWith({ ref: 'HEAD~1', staged: false });
  });

  it('passes staged parameter', async () => {
    const context = makeContext({
      getGitDiff: vi.fn().mockResolvedValue('staged diff'),
    });
    await gitDiffSkill.execute({ staged: true }, context);
    expect(context.getGitDiff).toHaveBeenCalledWith({ ref: undefined, staged: true });
  });

  it('returns error when ref is not a string', async () => {
    const context = makeContext();
    const result = await gitDiffSkill.execute({ ref: 42 }, context);
    expect(result).toContain('Error');
    expect(context.getGitDiff).not.toHaveBeenCalled();
  });

  it('returns error when staged is not a boolean', async () => {
    const context = makeContext();
    const result = await gitDiffSkill.execute({ staged: 'yes' }, context);
    expect(result).toContain('Error');
    expect(context.getGitDiff).not.toHaveBeenCalled();
  });
});
