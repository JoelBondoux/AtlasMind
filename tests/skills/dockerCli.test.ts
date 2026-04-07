import { describe, expect, it, vi } from 'vitest';
import { dockerCliSkill } from '../../src/skills/dockerCli.ts';
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
    runCommand: vi.fn().mockResolvedValue({ ok: true, exitCode: 0, stdout: 'ok', stderr: '' }),
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
    getTerminalOutput: vi.fn().mockResolvedValue(''),
    getInstalledExtensions: vi.fn().mockResolvedValue([]),
    getPortForwards: vi.fn().mockResolvedValue([]),
    getTestResults: vi.fn().mockResolvedValue([]),
    getActiveDebugSession: vi.fn().mockResolvedValue(null),
    listTerminals: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('docker-cli skill', () => {
  it('declares args as an array of strings in the tool schema', () => {
    const properties = dockerCliSkill.parameters['properties'] as Record<string, unknown>;
    const args = properties['args'] as Record<string, unknown>;

    expect(args['type']).toBe('array');
    expect(args['items']).toEqual({ type: 'string' });
  });

  it('runs an allow-listed read-only docker command', async () => {
    const context = makeContext();
    const result = await dockerCliSkill.execute({ args: ['ps', '--all'] }, context);

    expect(context.runCommand).toHaveBeenCalledWith('docker', ['ps', '--all'], {
      cwd: undefined,
      timeoutMs: undefined,
    });
    expect(result).toContain('ok: true');
  });

  it('allows controlled docker compose lifecycle commands', async () => {
    const context = makeContext();
    const result = await dockerCliSkill.execute({ args: ['compose', 'up', '-d', 'api'] }, context);

    expect(context.runCommand).toHaveBeenCalledWith('docker', ['compose', 'up', '-d', 'api'], {
      cwd: undefined,
      timeoutMs: undefined,
    });
    expect(result).toContain('ok: true');
  });

  it('rejects unsupported docker commands', async () => {
    const context = makeContext();
    const result = await dockerCliSkill.execute({ args: ['run', '--rm', 'alpine'] }, context);

    expect(result).toContain('is not allowed');
    expect(context.runCommand).not.toHaveBeenCalled();
  });

  it('rejects disallowed flags on supported commands', async () => {
    const context = makeContext();
    const result = await dockerCliSkill.execute({ args: ['logs', 'api', '--follow'] }, context);

    expect(result).toContain('does not allow the flag');
    expect(context.runCommand).not.toHaveBeenCalled();
  });
});