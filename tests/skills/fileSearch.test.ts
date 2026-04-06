import { describe, expect, it, vi } from 'vitest';
import { fileSearchSkill } from '../../src/skills/fileSearch.ts';
import type { SkillExecutionContext } from '../../src/types.ts';

function makeContext(files: string[] = []): SkillExecutionContext {
  return {
    workspaceRootPath: '/workspace',
    queryMemory: vi.fn().mockResolvedValue([]),
    upsertMemory: vi.fn().mockReturnValue({ status: 'created' }),
    deleteMemory: vi.fn().mockResolvedValue(true),
    readFile: vi.fn().mockResolvedValue(''),
    writeFile: vi.fn().mockResolvedValue(undefined),
    findFiles: vi.fn().mockResolvedValue(files),
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
    getTerminalOutput: vi.fn().mockResolvedValue(''),
    getInstalledExtensions: vi.fn().mockResolvedValue([]),
    getPortForwards: vi.fn().mockResolvedValue([]),
    getTestResults: vi.fn().mockResolvedValue([]),
    getActiveDebugSession: vi.fn().mockResolvedValue(null),
    listTerminals: vi.fn().mockResolvedValue([]),
  };
}

describe('file-search skill', () => {
  it('returns newline-separated paths when files are found', async () => {
    const context = makeContext(['/workspace/src/a.ts', '/workspace/src/b.ts']);
    const result = await fileSearchSkill.execute({ pattern: '**/*.ts' }, context);
    expect(context.findFiles).toHaveBeenCalledWith('**/*.ts');
    expect(result).toBe('/workspace/src/a.ts\n/workspace/src/b.ts');
  });

  it('returns a descriptive message when no files match', async () => {
    const context = makeContext([]);
    const result = await fileSearchSkill.execute({ pattern: '**/*.xyz' }, context);
    expect(result).toContain('No files found');
  });

  it('returns an error when pattern is missing', async () => {
    const context = makeContext();
    const result = await fileSearchSkill.execute({}, context);
    expect(result).toContain('Error');
    expect(context.findFiles).not.toHaveBeenCalled();
  });
});
