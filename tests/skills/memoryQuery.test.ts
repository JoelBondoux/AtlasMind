import { describe, expect, it, vi } from 'vitest';
import { memoryQuerySkill } from '../../src/skills/memoryQuery.ts';
import type { MemoryEntry, SkillExecutionContext } from '../../src/types.ts';

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    path: 'decisions/example.md',
    title: 'Example Decision',
    tags: ['architecture'],
    lastModified: '2026-04-03T00:00:00.000Z',
    snippet: 'We chose X because Y.',
    ...overrides,
  };
}

function makeContext(entries: MemoryEntry[] = []): SkillExecutionContext {
  return {
    workspaceRootPath: '/workspace',
    queryMemory: vi.fn().mockResolvedValue(entries),
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
  };
}

describe('memory-query skill', () => {
  it('returns formatted entries when results are found', async () => {
    const entry = makeEntry();
    const context = makeContext([entry]);
    const result = await memoryQuerySkill.execute({ query: 'architecture' }, context);
    expect(context.queryMemory).toHaveBeenCalledWith('architecture', 5);
    expect(result).toContain('Example Decision');
    expect(result).toContain('decisions/example.md');
  });

  it('returns a not-found message when there are no results', async () => {
    const context = makeContext([]);
    const result = await memoryQuerySkill.execute({ query: 'nonexistent' }, context);
    expect(result).toContain('No memory entries found');
  });

  it('respects a custom maxResults parameter', async () => {
    const context = makeContext([]);
    await memoryQuerySkill.execute({ query: 'test', maxResults: 10 }, context);
    expect(context.queryMemory).toHaveBeenCalledWith('test', 10);
  });

  it('returns an error when query is missing', async () => {
    const context = makeContext();
    const result = await memoryQuerySkill.execute({}, context);
    expect(result).toContain('Error');
    expect(context.queryMemory).not.toHaveBeenCalled();
  });
});
