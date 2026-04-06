import { describe, expect, it, vi } from 'vitest';
import { workspaceObservabilitySkill } from '../../src/skills/workspaceObservability.ts';
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
    getTerminalOutput: vi.fn().mockResolvedValue(''),
    getInstalledExtensions: vi.fn().mockResolvedValue([]),
    getPortForwards: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('workspace-state skill', () => {
  it('returns workspace state header', async () => {
    const context = makeContext();
    const result = await workspaceObservabilitySkill.execute({}, context);
    expect(result).toContain('=== Workspace State ===');
  });

  it('shows output channel names', async () => {
    const context = makeContext({
      getOutputChannelNames: vi.fn().mockResolvedValue(['AtlasMind', 'TypeScript']),
    });
    const result = await workspaceObservabilitySkill.execute({}, context);
    expect(result).toContain('AtlasMind');
    expect(result).toContain('TypeScript');
    expect(result).toContain('Output Channels (2)');
  });

  it('shows none detected when no output channels', async () => {
    const context = makeContext({
      getOutputChannelNames: vi.fn().mockResolvedValue([]),
    });
    const result = await workspaceObservabilitySkill.execute({}, context);
    expect(result).toContain('(none detected)');
  });

  it('shows no active debug sessions when empty', async () => {
    const context = makeContext({
      getDebugSessions: vi.fn().mockResolvedValue([]),
    });
    const result = await workspaceObservabilitySkill.execute({}, context);
    expect(result).toContain('No active debug sessions');
  });

  it('lists active debug sessions', async () => {
    const context = makeContext({
      getDebugSessions: vi.fn().mockResolvedValue([
        { id: 's1', name: 'My App', type: 'node' },
      ]),
    });
    const result = await workspaceObservabilitySkill.execute({}, context);
    expect(result).toContain('My App');
    expect(result).toContain('node');
  });

  it('summarises workspace errors and warnings', async () => {
    const context = makeContext({
      getDiagnostics: vi.fn().mockResolvedValue([
        { path: '/workspace/src/index.ts', line: 1, column: 1, severity: 'error', message: 'Type mismatch' },
        { path: '/workspace/src/index.ts', line: 5, column: 2, severity: 'warning', message: 'Unused variable' },
      ]),
    });
    const result = await workspaceObservabilitySkill.execute({}, context);
    expect(result).toContain('1 error(s)');
    expect(result).toContain('1 warning(s)');
    expect(result).toContain('Type mismatch');
  });

  it('shows "and N more" when there are more than 5 errors', async () => {
    const manyErrors = Array.from({ length: 8 }, (_, i) => ({
      path: '/workspace/src/file.ts',
      line: i + 1,
      column: 1,
      severity: 'error',
      message: `Error ${i + 1}`,
    }));
    const context = makeContext({
      getDiagnostics: vi.fn().mockResolvedValue(manyErrors),
    });
    const result = await workspaceObservabilitySkill.execute({}, context);
    expect(result).toContain('8 error(s)');
    expect(result).toContain('3 more error(s)');
  });

  it('calls all three context methods', async () => {
    const context = makeContext();
    await workspaceObservabilitySkill.execute({}, context);
    expect(context.getOutputChannelNames).toHaveBeenCalled();
    expect(context.getDebugSessions).toHaveBeenCalled();
    expect(context.getDiagnostics).toHaveBeenCalled();
  });

  it('reports no result files when findFiles returns empty', async () => {
    const context = makeContext({
      findFiles: vi.fn().mockResolvedValue([]),
    });
    const result = await workspaceObservabilitySkill.execute({}, context);
    expect(result).toContain('no result files found');
  });

  it('parses JUnit XML test result files', async () => {
    const junitXml = `<testsuite name="MySuite" tests="5" failures="1" errors="0"><testcase/></testsuite>`;
    const context = makeContext({
      findFiles: vi.fn()
        .mockResolvedValueOnce(['/workspace/test-results/results.xml'])
        .mockResolvedValue([]),
      readFile: vi.fn().mockResolvedValue(junitXml),
    });
    const result = await workspaceObservabilitySkill.execute({}, context);
    expect(result).toContain('Test Results');
    expect(result).toContain('MySuite');
    expect(result).toContain('5 test(s)');
    expect(result).toContain('1 failure(s)');
  });

  it('parses Vitest JSON test result files', async () => {
    const vitestJson = JSON.stringify({
      numPassedTests: 42,
      numFailedTests: 0,
      numTotalTests: 42,
    });
    const context = makeContext({
      findFiles: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(['/workspace/vitest-results.json'])
        .mockResolvedValue([]),
      readFile: vi.fn().mockResolvedValue(vitestJson),
    });
    const result = await workspaceObservabilitySkill.execute({}, context);
    expect(result).toContain('42/42 tests passed');
    expect(result).toContain('0 failed');
  });

  it('parses coverage-summary JSON files', async () => {
    const coverageJson = JSON.stringify({
      total: {
        lines: { pct: 87.5 },
        statements: { pct: 85.0 },
        functions: { pct: 90.0 },
        branches: { pct: 78.0 },
      },
    });
    const context = makeContext({
      findFiles: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(['/workspace/coverage/coverage-summary.json'])
        .mockResolvedValue([]),
      readFile: vi.fn().mockResolvedValue(coverageJson),
    });
    const result = await workspaceObservabilitySkill.execute({}, context);
    expect(result).toContain('Coverage');
    expect(result).toContain('87.5%');
  });

  it('handles unreadable result files gracefully', async () => {
    const context = makeContext({
      findFiles: vi.fn()
        .mockResolvedValueOnce(['/workspace/test-results/results.xml'])
        .mockResolvedValue([]),
      readFile: vi.fn().mockRejectedValue(new Error('Permission denied')),
    });
    const result = await workspaceObservabilitySkill.execute({}, context);
    expect(result).toContain('could not read file');
  });
});
