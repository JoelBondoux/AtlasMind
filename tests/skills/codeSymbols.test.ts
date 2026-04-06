import { describe, expect, it, vi } from 'vitest';
import { codeSymbolsSkill } from '../../src/skills/codeSymbols.ts';
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

describe('code-symbols skill', () => {
  it('returns error for invalid action', async () => {
    const context = makeContext();
    const result = await codeSymbolsSkill.execute({ action: 'invalid', path: '/f.ts' }, context);
    expect(result).toContain('Error');
  });

  it('returns error for missing path', async () => {
    const context = makeContext();
    const result = await codeSymbolsSkill.execute({ action: 'symbols' }, context);
    expect(result).toContain('Error');
  });

  it('lists document symbols', async () => {
    const context = makeContext({
      getDocumentSymbols: vi.fn().mockResolvedValue([
        { name: 'MyClass', kind: 'Class', range: '1:0-50:1', children: ['constructor', 'run'] },
        { name: 'helper', kind: 'Function', range: '52:0-60:1' },
      ]),
    });
    const result = await codeSymbolsSkill.execute({ action: 'symbols', path: '/f.ts' }, context);
    expect(result).toContain('Class MyClass');
    expect(result).toContain('[constructor, run]');
    expect(result).toContain('Function helper');
  });

  it('returns no symbols message for empty file', async () => {
    const context = makeContext();
    const result = await codeSymbolsSkill.execute({ action: 'symbols', path: '/f.ts' }, context);
    expect(result).toContain('No symbols');
  });

  it('requires line/column for references', async () => {
    const context = makeContext();
    const result = await codeSymbolsSkill.execute({ action: 'references', path: '/f.ts' }, context);
    expect(result).toContain('Error');
    expect(result).toContain('line');
  });

  it('finds references with position', async () => {
    const context = makeContext({
      findReferences: vi.fn().mockResolvedValue([
        { path: '/a.ts', line: 5, column: 3, text: 'const x = 1;' },
      ]),
    });
    const result = await codeSymbolsSkill.execute({ action: 'references', path: '/f.ts', line: 10, column: 5 }, context);
    expect(result).toContain('/a.ts:5:3');
  });

  it('goes to definition', async () => {
    const context = makeContext({
      goToDefinition: vi.fn().mockResolvedValue([
        { path: '/types.ts', line: 20, column: 1 },
      ]),
    });
    const result = await codeSymbolsSkill.execute({ action: 'definition', path: '/f.ts', line: 10, column: 5 }, context);
    expect(result).toContain('/types.ts:20:1');
  });
});
