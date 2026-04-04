import { describe, expect, it, vi } from 'vitest';
import { rollbackCheckpointSkill } from '../../src/skills/rollbackCheckpoint.ts';
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
    rollbackLastCheckpoint: vi.fn().mockResolvedValue({
      ok: true,
      summary: 'Rolled back checkpoint checkpoint-1.',
      restoredPaths: ['/workspace/src/app.ts'],
    }),
    applyGitPatch: vi.fn().mockResolvedValue({ ok: true, stdout: '', stderr: '' }),
    ...overrides,
  };
}

describe('rollback-checkpoint skill', () => {
  it('restores the latest checkpoint and returns the restored paths', async () => {
    const context = makeContext();
    const result = await rollbackCheckpointSkill.execute({}, context);

    expect(context.rollbackLastCheckpoint).toHaveBeenCalledOnce();
    expect(result).toContain('Rolled back checkpoint');
    expect(result).toContain('/workspace/src/app.ts');
  });
});
