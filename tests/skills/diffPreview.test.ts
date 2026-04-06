import { describe, expect, it, vi } from 'vitest';
import { diffPreviewSkill } from '../../src/skills/diffPreview.ts';
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

describe('diff-preview skill', () => {
  it('shows empty summary when no changes', async () => {
    const context = makeContext();
    const result = await diffPreviewSkill.execute({}, context);
    expect(result).toContain('Change Summary');
    expect(result).toContain('Modified: 0');
  });

  it('counts modified, added, and deleted files', async () => {
    const context = makeContext({
      getGitStatus: vi.fn().mockResolvedValue('## main\n M src/foo.ts\n?? src/new.ts\n D src/old.ts'),
      getGitDiff: vi.fn().mockResolvedValue('+added line\n-removed line'),
    });
    const result = await diffPreviewSkill.execute({}, context);
    expect(result).toContain('Modified: 1');
    expect(result).toContain('Added: 1');
    expect(result).toContain('Deleted: 1');
    expect(result).toContain('+1');
    expect(result).toContain('-1');
  });

  it('passes staged flag to getGitDiff', async () => {
    const context = makeContext();
    await diffPreviewSkill.execute({ staged: true }, context);
    expect(context.getGitDiff).toHaveBeenCalledWith({ staged: true });
  });
});
