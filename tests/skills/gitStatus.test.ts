import { describe, expect, it, vi } from 'vitest';
import { gitStatusSkill } from '../../src/skills/gitStatus.ts';
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
    getTerminalOutput: vi.fn().mockResolvedValue(''),
    getInstalledExtensions: vi.fn().mockResolvedValue([]),
    getPortForwards: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('git-status skill', () => {
  it('returns git status output', async () => {
    const context = makeContext({
      getGitStatus: vi.fn().mockResolvedValue('M src/index.ts\n?? new-file.ts'),
    });
    const result = await gitStatusSkill.execute({}, context);
    expect(context.getGitStatus).toHaveBeenCalled();
    expect(result).toBe('M src/index.ts\n?? new-file.ts');
  });

  it('returns a message when status is empty', async () => {
    const context = makeContext({ getGitStatus: vi.fn().mockResolvedValue('  ') });
    const result = await gitStatusSkill.execute({}, context);
    expect(result).toBe('Git status returned no output.');
  });

  it('returns a message when status is blank whitespace', async () => {
    const context = makeContext({ getGitStatus: vi.fn().mockResolvedValue('\n\t ') });
    const result = await gitStatusSkill.execute({}, context);
    expect(result).toBe('Git status returned no output.');
  });
});
