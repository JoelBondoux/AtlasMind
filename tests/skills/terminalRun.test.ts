import { describe, expect, it, vi } from 'vitest';
import { terminalRunSkill } from '../../src/skills/terminalRun.ts';
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
    getCodeActions: vi.fn().mockResolvedValue([]),
    applyCodeAction: vi.fn().mockResolvedValue({ applied: true }),
    ...overrides,
  };
}

describe('terminal-run skill', () => {
  it('runs an allow-listed command', async () => {
    const context = makeContext();
    const result = await terminalRunSkill.execute({ command: 'git', args: ['status', '--short'] }, context);
    expect(context.runCommand).toHaveBeenCalledWith('git', ['status', '--short'], {
      cwd: undefined,
      timeoutMs: undefined,
    });
    expect(result).toContain('ok: true');
  });

  it('rejects blocked commands', async () => {
    const context = makeContext();
    const result = await terminalRunSkill.execute({ command: 'powershell' }, context);
    expect(result).toContain('blocked');
    expect(context.runCommand).not.toHaveBeenCalled();
  });

  it('rejects unknown commands not on the allow-list', async () => {
    const context = makeContext();
    const result = await terminalRunSkill.execute({ command: 'unknown-tool' }, context);
    expect(result).toContain('not on the allow-list');
    expect(context.runCommand).not.toHaveBeenCalled();
  });

  it('allows newly added language tools (python, cargo, etc.)', async () => {
    const context = makeContext();
    for (const cmd of ['python', 'cargo', 'dotnet', 'go', 'make', 'deno', 'bun']) {
      const result = await terminalRunSkill.execute({ command: cmd, args: ['--version'] }, context);
      expect(result).toContain('ok: true');
    }
  });

  it('blocks inline node evaluation flags', async () => {
    const context = makeContext();
    const result = await terminalRunSkill.execute({ command: 'node', args: ['-e', 'console.log(1)'] }, context);
    expect(result).toContain('inline interpreter execution is not allowed');
    expect(context.runCommand).not.toHaveBeenCalled();
  });

  it('blocks inline python evaluation flags', async () => {
    const context = makeContext();
    const result = await terminalRunSkill.execute({ command: 'python', args: ['-c', 'print(1)'] }, context);
    expect(result).toContain('inline interpreter execution is not allowed');
    expect(context.runCommand).not.toHaveBeenCalled();
  });
});