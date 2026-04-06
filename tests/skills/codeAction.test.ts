import { describe, expect, it, vi } from 'vitest';
import { codeActionSkill } from '../../src/skills/codeAction.ts';
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
    getTerminalOutput: vi.fn().mockResolvedValue(''),
    getInstalledExtensions: vi.fn().mockResolvedValue([]),
    getPortForwards: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('code-action skill', () => {
  it('lists available code actions', async () => {
    const context = makeContext({
      getCodeActions: vi.fn().mockResolvedValue([
        { title: 'Add missing import', kind: 'quickfix', isPreferred: true },
        { title: 'Extract to function', kind: 'refactor' },
      ]),
    });
    const result = await codeActionSkill.execute(
      { action: 'list', path: '/f.ts', startLine: 5, startColumn: 1 },
      context,
    );
    expect(result).toContain('Add missing import');
    expect(result).toContain('★');
    expect(result).toContain('Extract to function');
  });

  it('returns no-actions message when none available', async () => {
    const context = makeContext();
    const result = await codeActionSkill.execute(
      { action: 'list', path: '/f.ts', startLine: 5, startColumn: 1 },
      context,
    );
    expect(result).toContain('No code actions');
  });

  it('applies a code action by title', async () => {
    const context = makeContext();
    const result = await codeActionSkill.execute(
      { action: 'apply', path: '/f.ts', startLine: 5, startColumn: 1, title: 'Add missing import' },
      context,
    );
    expect(context.applyCodeAction).toHaveBeenCalledWith('/f.ts', 5, 1, 5, 1, 'Add missing import');
    expect(result).toContain('Applied');
  });

  it('returns error when action is apply but title is missing', async () => {
    const context = makeContext();
    const result = await codeActionSkill.execute(
      { action: 'apply', path: '/f.ts', startLine: 5, startColumn: 1 },
      context,
    );
    expect(result).toContain('Error');
    expect(result).toContain('title');
  });

  it('returns error when code action is not applied', async () => {
    const context = makeContext({
      applyCodeAction: vi.fn().mockResolvedValue({ applied: false, reason: 'not found' }),
    });
    const result = await codeActionSkill.execute(
      { action: 'apply', path: '/f.ts', startLine: 5, startColumn: 1, title: 'Nope' },
      context,
    );
    expect(result).toContain('Error');
    expect(result).toContain('not found');
  });

  it('returns error for missing required params', async () => {
    const context = makeContext();
    const result = await codeActionSkill.execute({ action: 'list' }, context);
    expect(result).toContain('Error');
  });
});
