import { describe, expect, it, vi } from 'vitest';
import { fileDeleteSkill, fileMoveSkill } from '../../src/skills/fileManage.ts';
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
    getCodeActions: vi.fn().mockResolvedValue([]),
    applyCodeAction: vi.fn().mockResolvedValue({ applied: true }),
    ...overrides,
  };
}

describe('file-delete skill', () => {
  it('deletes a file by path', async () => {
    const context = makeContext();
    const result = await fileDeleteSkill.execute({ path: '/workspace/old.ts' }, context);
    expect(context.deleteFile).toHaveBeenCalledWith('/workspace/old.ts');
    expect(result).toContain('Deleted');
  });

  it('returns error for missing path', async () => {
    const context = makeContext();
    const result = await fileDeleteSkill.execute({}, context);
    expect(result).toContain('Error');
    expect(context.deleteFile).not.toHaveBeenCalled();
  });
});

describe('file-move skill', () => {
  it('moves a file from source to destination', async () => {
    const context = makeContext();
    const result = await fileMoveSkill.execute({ source: '/workspace/a.ts', destination: '/workspace/b.ts' }, context);
    expect(context.moveFile).toHaveBeenCalledWith('/workspace/a.ts', '/workspace/b.ts');
    expect(result).toContain('Moved');
  });

  it('returns error for missing source', async () => {
    const context = makeContext();
    const result = await fileMoveSkill.execute({ destination: '/workspace/b.ts' }, context);
    expect(result).toContain('Error');
  });

  it('returns error for missing destination', async () => {
    const context = makeContext();
    const result = await fileMoveSkill.execute({ source: '/workspace/a.ts' }, context);
    expect(result).toContain('Error');
  });
});
