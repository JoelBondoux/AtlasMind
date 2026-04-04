import { describe, expect, it, vi } from 'vitest';
import { memoryDeleteSkill } from '../../src/skills/memoryDelete.ts';
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
    ...overrides,
  };
}

describe('memory-delete skill', () => {
  it('deletes an existing entry and returns confirmation', async () => {
    const context = makeContext();
    const result = await memoryDeleteSkill.execute({ path: 'decisions/old.md' }, context);
    expect(context.deleteMemory).toHaveBeenCalledWith('decisions/old.md');
    expect(result).toContain('deleted');
  });

  it('returns not-found message when entry does not exist', async () => {
    const context = makeContext({
      deleteMemory: vi.fn().mockResolvedValue(false),
    });
    const result = await memoryDeleteSkill.execute({ path: 'decisions/missing.md' }, context);
    expect(result).toContain('No memory entry found');
  });

  it('returns an error when path is missing', async () => {
    const context = makeContext();
    const result = await memoryDeleteSkill.execute({}, context);
    expect(result).toContain('Error');
    expect(context.deleteMemory).not.toHaveBeenCalled();
  });

  it('returns an error when path is empty string', async () => {
    const context = makeContext();
    const result = await memoryDeleteSkill.execute({ path: '  ' }, context);
    expect(result).toContain('Error');
  });

  it('trims whitespace from the path', async () => {
    const context = makeContext();
    await memoryDeleteSkill.execute({ path: '  decisions/trim.md  ' }, context);
    expect(context.deleteMemory).toHaveBeenCalledWith('decisions/trim.md');
  });
});
