import { describe, expect, it, vi } from 'vitest';
import { textSearchSkill } from '../../src/skills/textSearch.ts';
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
    searchInFiles: vi.fn().mockResolvedValue([
      { path: '/workspace/src/app.ts', line: 4, text: 'const route = "atlas";' },
    ]),
    listDirectory: vi.fn().mockResolvedValue([]),
    runCommand: vi.fn().mockResolvedValue({ ok: true, exitCode: 0, stdout: '', stderr: '' }),
    getGitStatus: vi.fn().mockResolvedValue(''),
    getGitDiff: vi.fn().mockResolvedValue(''),
    rollbackLastCheckpoint: vi.fn().mockResolvedValue({ ok: true, summary: 'Rolled back.', restoredPaths: [] }),
    applyGitPatch: vi.fn().mockResolvedValue({ ok: true, stdout: '', stderr: '' }),
    ...overrides,
  };
}

describe('text-search skill', () => {
  it('formats matching lines', async () => {
    const context = makeContext();
    const result = await textSearchSkill.execute({ query: 'atlas' }, context);
    expect(context.searchInFiles).toHaveBeenCalledWith('atlas', {
      isRegexp: false,
      includePattern: undefined,
      maxResults: undefined,
    });
    expect(result).toContain('/workspace/src/app.ts:4');
  });

  it('rejects missing queries', async () => {
    const context = makeContext();
    const result = await textSearchSkill.execute({}, context);
    expect(result).toContain('Error');
  });
});