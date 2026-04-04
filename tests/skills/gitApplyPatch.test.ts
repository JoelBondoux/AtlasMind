import { describe, expect, it, vi } from 'vitest';
import { gitApplyPatchSkill } from '../../src/skills/gitApplyPatch.ts';
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
    runCommand: vi.fn().mockResolvedValue({ ok: true, exitCode: 0, stdout: '', stderr: '' }),
    getGitStatus: vi.fn().mockResolvedValue(''),
    getGitDiff: vi.fn().mockResolvedValue(''),
    rollbackLastCheckpoint: vi.fn().mockResolvedValue({ ok: true, summary: 'Rolled back.', restoredPaths: [] }),
    applyGitPatch: vi.fn().mockResolvedValue({ ok: true, stdout: '', stderr: '' }),
    ...overrides,
  };
}

describe('git-apply-patch skill', () => {
  it('validates a patch when checkOnly is true', async () => {
    const context = makeContext();
    const result = await gitApplyPatchSkill.execute({
      patch: 'diff --git a/foo.txt b/foo.txt\n--- a/foo.txt\n+++ b/foo.txt\n@@ -1 +1 @@\n-old\n+new\n',
      checkOnly: true,
    }, context);

    expect(context.applyGitPatch).toHaveBeenCalledWith(expect.any(String), {
      checkOnly: true,
      stage: false,
    });
    expect(result).toContain('validated successfully');
  });

  it('returns a failure message when git apply rejects the patch', async () => {
    const context = makeContext({
      applyGitPatch: vi.fn().mockResolvedValue({ ok: false, stdout: '', stderr: 'patch does not apply' }),
    });

    const result = await gitApplyPatchSkill.execute({ patch: 'bad patch' }, context);
    expect(result).toContain('Patch failed');
    expect(result).toContain('patch does not apply');
  });

  it('returns an error when patch is missing', async () => {
    const context = makeContext();
    const result = await gitApplyPatchSkill.execute({}, context);
    expect(result).toContain('Error');
    expect(context.applyGitPatch).not.toHaveBeenCalled();
  });
});
