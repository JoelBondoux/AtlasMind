import { describe, expect, it, vi } from 'vitest';
import { fileEditSkill } from '../../src/skills/fileEdit.ts';
import type { SkillExecutionContext } from '../../src/types.ts';

function makeContext(overrides: Partial<SkillExecutionContext> = {}): SkillExecutionContext {
  return {
    workspaceRootPath: '/workspace',
    queryMemory: vi.fn().mockResolvedValue([]),
    upsertMemory: vi.fn(),
    readFile: vi.fn().mockResolvedValue('before\nneedle\nafter\n'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    findFiles: vi.fn().mockResolvedValue([]),
    searchInFiles: vi.fn().mockResolvedValue([]),
    listDirectory: vi.fn().mockResolvedValue([]),
    runCommand: vi.fn().mockResolvedValue({ ok: true, exitCode: 0, stdout: '', stderr: '' }),
    getGitStatus: vi.fn().mockResolvedValue(''),
    getGitDiff: vi.fn().mockResolvedValue(''),
    applyGitPatch: vi.fn().mockResolvedValue({ ok: true, stdout: '', stderr: '' }),
    ...overrides,
  };
}

describe('file-edit skill', () => {
  it('applies a targeted replacement', async () => {
    const context = makeContext();
    const result = await fileEditSkill.execute({
      path: '/workspace/file.txt',
      search: 'needle',
      replace: 'replacement',
    }, context);

    expect(context.writeFile).toHaveBeenCalledWith('/workspace/file.txt', 'before\nreplacement\nafter\n');
    expect(result).toContain('Updated /workspace/file.txt');
  });

  it('fails when the expected match count is wrong', async () => {
    const context = makeContext();
    const result = await fileEditSkill.execute({
      path: '/workspace/file.txt',
      search: 'needle',
      replace: 'replacement',
      expectedMatches: 2,
    }, context);

    expect(result).toContain('expected 2 matches but found 1');
    expect(context.writeFile).not.toHaveBeenCalled();
  });
});