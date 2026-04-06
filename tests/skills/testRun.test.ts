import { describe, expect, it, vi } from 'vitest';
import { testRunSkill } from '../../src/skills/testRun.ts';
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
    runCommand: vi.fn().mockResolvedValue({ ok: true, exitCode: 0, stdout: '3 tests passed', stderr: '' }),
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

describe('test-run skill', () => {
  it('auto-detects vitest and runs tests', async () => {
    const context = makeContext({
      readFile: vi.fn().mockResolvedValue(JSON.stringify({ devDependencies: { vitest: '^1.0.0' } })),
    });
    const result = await testRunSkill.execute({}, context);
    expect(context.runCommand).toHaveBeenCalledWith('npx', ['vitest', 'run'], expect.any(Object));
    expect(result).toContain('passed');
  });

  it('uses explicit framework parameter', async () => {
    const context = makeContext();
    await testRunSkill.execute({ framework: 'jest' }, context);
    expect(context.runCommand).toHaveBeenCalledWith('npx', ['jest', '--no-coverage'], expect.any(Object));
  });

  it('passes file and testName filters for vitest', async () => {
    const context = makeContext({
      readFile: vi.fn().mockResolvedValue(JSON.stringify({ devDependencies: { vitest: '^1.0.0' } })),
    });
    await testRunSkill.execute({ file: 'tests/foo.test.ts', testName: 'should work' }, context);
    expect(context.runCommand).toHaveBeenCalledWith(
      'npx',
      ['vitest', 'run', 'tests/foo.test.ts', '-t', 'should work'],
      expect.any(Object),
    );
  });

  it('reports failure when tests fail', async () => {
    const context = makeContext({
      readFile: vi.fn().mockResolvedValue(JSON.stringify({ devDependencies: { vitest: '^1.0.0' } })),
      runCommand: vi.fn().mockResolvedValue({ ok: false, exitCode: 1, stdout: '', stderr: '1 test failed' }),
    });
    const result = await testRunSkill.execute({}, context);
    expect(result).toContain('failed');
  });

  it('returns error when framework cannot be detected', async () => {
    const context = makeContext({
      readFile: vi.fn().mockRejectedValue(new Error('not found')),
      findFiles: vi.fn().mockResolvedValue([]),
    });
    const result = await testRunSkill.execute({}, context);
    expect(result).toContain('Error');
    expect(result).toContain('auto-detect');
  });

  it('has a 120s skill-level timeout', () => {
    expect(testRunSkill.timeoutMs).toBe(120_000);
  });
});
