import { describe, expect, it, vi } from 'vitest';
import { terminalReadSkill } from '../../src/skills/terminalRead.ts';
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
    getSpecialistApiKey: vi.fn().mockResolvedValue(undefined),
    getOutputChannelNames: vi.fn().mockResolvedValue([]),
    getAtlasMindOutputLog: vi.fn().mockResolvedValue(''),
    getDebugSessions: vi.fn().mockResolvedValue([]),
    evaluateDebugExpression: vi.fn().mockResolvedValue(''),
    getTerminalOutput: vi.fn().mockResolvedValue('Terminal: bash\nActive: yes\nAll open terminals: bash'),
    getDocumentSymbols: vi.fn().mockResolvedValue([]),
    findReferences: vi.fn().mockResolvedValue([]),
    goToDefinition: vi.fn().mockResolvedValue([]),
    renameSymbol: vi.fn().mockResolvedValue({ filesChanged: 0, editsApplied: 0 }),
    fetchUrl: vi.fn().mockResolvedValue({ ok: true, status: 200, body: '' }),
    getCodeActions: vi.fn().mockResolvedValue([]),
    applyCodeAction: vi.fn().mockResolvedValue({ applied: true }),
    getInstalledExtensions: vi.fn().mockResolvedValue([]),
    getPortForwards: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('terminal-read skill', () => {
  it('has id terminal-read', () => {
    expect(terminalReadSkill.id).toBe('terminal-read');
  });

  it('calls getTerminalOutput with no name when params are empty', async () => {
    const context = makeContext();
    await terminalReadSkill.execute({}, context);
    expect(context.getTerminalOutput).toHaveBeenCalledWith(undefined);
  });

  it('calls getTerminalOutput with the provided terminal name', async () => {
    const context = makeContext();
    await terminalReadSkill.execute({ terminalName: 'bash' }, context);
    expect(context.getTerminalOutput).toHaveBeenCalledWith('bash');
  });

  it('returns the output from getTerminalOutput', async () => {
    const context = makeContext({
      getTerminalOutput: vi.fn().mockResolvedValue('Terminal: bash\nActive: yes'),
    });
    const result = await terminalReadSkill.execute({}, context);
    expect(result).toContain('Terminal: bash');
    expect(result).toContain('Active: yes');
  });

  it('returns an error for invalid terminalName parameter', async () => {
    const context = makeContext();
    const result = await terminalReadSkill.execute({ terminalName: 123 }, context);
    expect(result).toMatch(/terminalName.*string/i);
    expect(context.getTerminalOutput).not.toHaveBeenCalled();
  });

  it('treats empty string terminalName as undefined', async () => {
    const context = makeContext();
    await terminalReadSkill.execute({ terminalName: '   ' }, context);
    expect(context.getTerminalOutput).toHaveBeenCalledWith(undefined);
  });
});
