import { describe, expect, it, vi } from 'vitest';
import { diagnosticsSkill } from '../../src/skills/diagnostics.ts';
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
    getCodeActions: vi.fn().mockResolvedValue([]),
    applyCodeAction: vi.fn().mockResolvedValue({ applied: true }),
    getTestResults: vi.fn().mockResolvedValue([]),
    getActiveDebugSession: vi.fn().mockResolvedValue(null),
    listTerminals: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('diagnostics skill', () => {
  it('returns no-diagnostics message for clean workspace', async () => {
    const context = makeContext();
    const result = await diagnosticsSkill.execute({}, context);
    expect(result).toContain('No diagnostics');
  });

  it('formats diagnostic entries as path:line:column', async () => {
    const context = makeContext({
      getDiagnostics: vi.fn().mockResolvedValue([
        { path: '/workspace/src/foo.ts', line: 10, column: 5, severity: 'error', message: 'Type error', source: 'ts' },
        { path: '/workspace/src/bar.ts', line: 3, column: 1, severity: 'warning', message: 'Unused var' },
      ]),
    });
    const result = await diagnosticsSkill.execute({}, context);
    expect(result).toContain('/workspace/src/foo.ts:10:5 [error] Type error (ts)');
    expect(result).toContain('/workspace/src/bar.ts:3:1 [warning] Unused var');
  });

  it('passes file paths filter to getDiagnostics', async () => {
    const context = makeContext();
    await diagnosticsSkill.execute({ paths: ['/workspace/src/foo.ts'] }, context);
    expect(context.getDiagnostics).toHaveBeenCalledWith(['/workspace/src/foo.ts']);
  });

  it('returns file-specific message when paths are provided but no diagnostics found', async () => {
    const context = makeContext();
    const result = await diagnosticsSkill.execute({ paths: ['/workspace/src/foo.ts'] }, context);
    expect(result).toContain('specified file');
  });
});
