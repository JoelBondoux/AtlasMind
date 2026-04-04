import { describe, expect, it, vi } from 'vitest';
import { terminalRunSkill } from '../../src/skills/terminalRun.ts';
import type { SkillExecutionContext } from '../../src/types.ts';

function makeContext(overrides: Partial<SkillExecutionContext> = {}): SkillExecutionContext {
  return {
    workspaceRootPath: '/workspace',
    queryMemory: vi.fn().mockResolvedValue([]),
    upsertMemory: vi.fn(),
    readFile: vi.fn().mockResolvedValue(''),
    writeFile: vi.fn().mockResolvedValue(undefined),
    findFiles: vi.fn().mockResolvedValue([]),
    searchInFiles: vi.fn().mockResolvedValue([]),
    listDirectory: vi.fn().mockResolvedValue([]),
    runCommand: vi.fn().mockResolvedValue({ ok: true, exitCode: 0, stdout: 'ok', stderr: '' }),
    getGitStatus: vi.fn().mockResolvedValue(''),
    getGitDiff: vi.fn().mockResolvedValue(''),
    applyGitPatch: vi.fn().mockResolvedValue({ ok: true, stdout: '', stderr: '' }),
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

  it('rejects commands outside the allow-list', async () => {
    const context = makeContext();
    const result = await terminalRunSkill.execute({ command: 'powershell' }, context);
    expect(result).toContain('not on the allow-list');
    expect(context.runCommand).not.toHaveBeenCalled();
  });
});