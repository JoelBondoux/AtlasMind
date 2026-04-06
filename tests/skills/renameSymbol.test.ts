import { describe, expect, it, vi } from 'vitest';
import { renameSymbolSkill } from '../../src/skills/renameSymbol.ts';
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
    renameSymbol: vi.fn().mockResolvedValue({ filesChanged: 3, editsApplied: 7 }),
    fetchUrl: vi.fn().mockResolvedValue({ ok: true, status: 200, body: '' }),
    getCodeActions: vi.fn().mockResolvedValue([]),
    applyCodeAction: vi.fn().mockResolvedValue({ applied: true }),
    getTerminalOutput: vi.fn().mockResolvedValue(''),
    getInstalledExtensions: vi.fn().mockResolvedValue([]),
    getPortForwards: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('rename-symbol skill', () => {
  it('renames a symbol and reports results', async () => {
    const context = makeContext();
    const result = await renameSymbolSkill.execute(
      { path: '/workspace/src/foo.ts', line: 5, column: 10, newName: 'newFoo' },
      context,
    );
    expect(context.renameSymbol).toHaveBeenCalledWith('/workspace/src/foo.ts', 5, 10, 'newFoo');
    expect(result).toContain('3 file(s)');
    expect(result).toContain('7 edit(s)');
  });

  it('returns error for missing path', async () => {
    const result = await renameSymbolSkill.execute(
      { line: 5, column: 10, newName: 'bar' },
      makeContext(),
    );
    expect(result).toContain('Error');
  });

  it('returns error for invalid line', async () => {
    const result = await renameSymbolSkill.execute(
      { path: '/f.ts', line: 0, column: 10, newName: 'bar' },
      makeContext(),
    );
    expect(result).toContain('Error');
  });

  it('returns error for empty newName', async () => {
    const result = await renameSymbolSkill.execute(
      { path: '/f.ts', line: 5, column: 10, newName: '' },
      makeContext(),
    );
    expect(result).toContain('Error');
  });

  it('rejects invalid identifier characters in newName', async () => {
    const result = await renameSymbolSkill.execute(
      { path: '/f.ts', line: 5, column: 10, newName: 'bad name!' },
      makeContext(),
    );
    expect(result).toContain('Error');
    expect(result).toContain('valid identifier');
  });
});
