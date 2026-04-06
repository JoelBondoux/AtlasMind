import { describe, expect, it, vi } from 'vitest';
import { workspaceObservabilitySkill } from '../../src/skills/workspaceObservability.ts';
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

describe('workspaceObservability skill', () => {
  it('reports no active debug session when none is present', async () => {
    const context = makeContext();
    const result = await workspaceObservabilitySkill.execute({}, context);
    expect(result).toContain('Active Debug Session');
    expect(result).toContain('None');
  });

  it('reports active debug session when one is present', async () => {
    const context = makeContext({
      getActiveDebugSession: vi.fn().mockResolvedValue({ id: 'abc', name: 'Attach to UE5', type: 'cppdbg' }),
    });
    const result = await workspaceObservabilitySkill.execute({}, context);
    expect(result).toContain('Attach to UE5');
    expect(result).toContain('cppdbg');
  });

  it('reports open terminals', async () => {
    const context = makeContext({
      listTerminals: vi.fn().mockResolvedValue([{ name: 'bash' }, { name: 'UE Build' }]),
    });
    const result = await workspaceObservabilitySkill.execute({}, context);
    expect(result).toContain('bash');
    expect(result).toContain('UE Build');
  });

  it('reports no terminals when list is empty', async () => {
    const context = makeContext();
    const result = await workspaceObservabilitySkill.execute({}, context);
    expect(result).toContain('Open Terminals');
    expect(result).toContain('None');
  });

  it('reports test run results with counts', async () => {
    const context = makeContext({
      getTestResults: vi.fn().mockResolvedValue([
        { id: 'run-1', completedAt: 1000, durationMs: 500, counts: { passed: 10, failed: 2 } },
      ]),
    });
    const result = await workspaceObservabilitySkill.execute({}, context);
    expect(result).toContain('passed: 10');
    expect(result).toContain('failed: 2');
  });

  it('reports no test runs when results are empty', async () => {
    const context = makeContext();
    const result = await workspaceObservabilitySkill.execute({}, context);
    expect(result).toContain('No test runs');
  });
});
