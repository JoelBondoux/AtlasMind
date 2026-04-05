import { describe, expect, it, vi } from 'vitest';
import { debugSessionSkill } from '../../src/skills/debugSession.ts';
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
    getSpecialistApiKey: vi.fn().mockResolvedValue(undefined),
    getOutputChannelNames: vi.fn().mockResolvedValue([]),
    getAtlasMindOutputLog: vi.fn().mockResolvedValue(''),
    getDebugSessions: vi.fn().mockResolvedValue([]),
    evaluateDebugExpression: vi.fn().mockResolvedValue(''),
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

describe('debug-session skill', () => {
  it('returns no-sessions message when no debug sessions are active', async () => {
    const context = makeContext({
      getDebugSessions: vi.fn().mockResolvedValue([]),
    });
    const result = await debugSessionSkill.execute({}, context);
    expect(result).toContain('No active debug sessions');
  });

  it('lists active debug sessions', async () => {
    const context = makeContext({
      getDebugSessions: vi.fn().mockResolvedValue([
        { id: 'session-1', name: 'Node.js: Launch', type: 'node' },
      ]),
    });
    const result = await debugSessionSkill.execute({ action: 'list' }, context);
    expect(result).toContain('Node.js: Launch');
    expect(result).toContain('node');
    expect(result).toContain('session-1');
  });

  it('returns error when evaluate action is used without expression', async () => {
    const context = makeContext();
    const result = await debugSessionSkill.execute({ action: 'evaluate' }, context);
    expect(result).toContain('Error');
    expect(result).toContain('expression');
  });

  it('evaluates an expression in the active debug session', async () => {
    const context = makeContext({
      evaluateDebugExpression: vi.fn().mockResolvedValue('42'),
    });
    const result = await debugSessionSkill.execute({ action: 'evaluate', expression: 'myVar' }, context);
    expect(result).toBe('42');
    expect(context.evaluateDebugExpression).toHaveBeenCalledWith('myVar', undefined);
  });

  it('passes frameId to evaluateDebugExpression when provided', async () => {
    const context = makeContext({
      evaluateDebugExpression: vi.fn().mockResolvedValue('hello'),
    });
    await debugSessionSkill.execute({ action: 'evaluate', expression: 'x', frameId: 3 }, context);
    expect(context.evaluateDebugExpression).toHaveBeenCalledWith('x', 3);
  });

  it('defaults to list action when no action is specified', async () => {
    const context = makeContext({
      getDebugSessions: vi.fn().mockResolvedValue([]),
    });
    const result = await debugSessionSkill.execute({}, context);
    expect(context.getDebugSessions).toHaveBeenCalled();
    expect(result).toContain('No active debug sessions');
  });
});
