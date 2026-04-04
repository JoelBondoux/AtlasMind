import { describe, expect, it, vi } from 'vitest';
import { fileReadSkill } from '../../src/skills/fileRead.ts';
import type { SkillExecutionContext } from '../../src/types.ts';

function makeContext(overrides: Partial<SkillExecutionContext> = {}): SkillExecutionContext {
  return {
    workspaceRootPath: '/workspace',
    queryMemory: vi.fn().mockResolvedValue([]),
    upsertMemory: vi.fn(),
    readFile: vi.fn().mockResolvedValue('file contents here'),
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

describe('file-read skill', () => {
  it('calls readFile and returns the content', async () => {
    const context = makeContext();
    const result = await fileReadSkill.execute({ path: '/workspace/foo.ts' }, context);
    expect(context.readFile).toHaveBeenCalledWith('/workspace/foo.ts');
    expect(result).toBe('file contents here');
  });

  it('returns an error message when path is missing', async () => {
    const context = makeContext();
    const result = await fileReadSkill.execute({}, context);
    expect(result).toContain('Error');
    expect(context.readFile).not.toHaveBeenCalled();
  });

  it('returns an error message when path is an empty string', async () => {
    const context = makeContext();
    const result = await fileReadSkill.execute({ path: '  ' }, context);
    expect(result).toContain('Error');
  });
});
