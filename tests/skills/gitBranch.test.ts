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
});
