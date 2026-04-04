import { describe, expect, it, vi } from 'vitest';
import { fileWriteSkill } from '../../src/skills/fileWrite.ts';
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

describe('file-write skill', () => {
  it('writes content to a file and returns confirmation', async () => {
    const context = makeContext();
    const result = await fileWriteSkill.execute({ path: '/workspace/out.txt', content: 'hello world' }, context);
    expect(context.writeFile).toHaveBeenCalledWith('/workspace/out.txt', 'hello world');
    expect(result).toContain('File written');
  });

  it('returns an error when path is missing', async () => {
    const context = makeContext();
    const result = await fileWriteSkill.execute({ content: 'data' }, context);
    expect(result).toContain('Error');
    expect(context.writeFile).not.toHaveBeenCalled();
  });

  it('returns an error when path is empty', async () => {
    const context = makeContext();
    const result = await fileWriteSkill.execute({ path: '  ', content: 'data' }, context);
    expect(result).toContain('Error');
    expect(context.writeFile).not.toHaveBeenCalled();
  });

  it('returns an error when content is missing', async () => {
    const context = makeContext();
    const result = await fileWriteSkill.execute({ path: '/workspace/out.txt' }, context);
    expect(result).toContain('Error');
    expect(context.writeFile).not.toHaveBeenCalled();
  });

  it('returns an error when content is not a string', async () => {
    const context = makeContext();
    const result = await fileWriteSkill.execute({ path: '/workspace/out.txt', content: 42 }, context);
    expect(result).toContain('Error');
    expect(context.writeFile).not.toHaveBeenCalled();
  });

  it('allows writing empty string content', async () => {
    const context = makeContext();
    const result = await fileWriteSkill.execute({ path: '/workspace/empty.txt', content: '' }, context);
    expect(context.writeFile).toHaveBeenCalledWith('/workspace/empty.txt', '');
    expect(result).toContain('File written');
  });

  it('trims the path', async () => {
    const context = makeContext();
    await fileWriteSkill.execute({ path: '  /workspace/trimmed.txt  ', content: 'data' }, context);
    expect(context.writeFile).toHaveBeenCalledWith('/workspace/trimmed.txt', 'data');
  });
});
