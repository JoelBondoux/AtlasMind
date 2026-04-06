import { describe, expect, it, vi } from 'vitest';
import { memoryWriteSkill } from '../../src/skills/memoryWrite.ts';
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
    getTerminalOutput: vi.fn().mockResolvedValue(''),
    getInstalledExtensions: vi.fn().mockResolvedValue([]),
    getPortForwards: vi.fn().mockResolvedValue([]),
    getTestResults: vi.fn().mockResolvedValue([]),
    getActiveDebugSession: vi.fn().mockResolvedValue(null),
    listTerminals: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('memory-write skill', () => {
  it('writes a valid entry and returns success', async () => {
    const context = makeContext();
    const result = await memoryWriteSkill.execute(
      { path: 'decisions/use-vitest.md', title: 'Use Vitest', snippet: 'We use Vitest.' },
      context,
    );
    expect(context.upsertMemory).toHaveBeenCalledOnce();
    expect(result).toContain('created');
    expect(result).toContain('decisions/use-vitest.md');
  });

  it('returns an error when path is missing', async () => {
    const context = makeContext();
    const result = await memoryWriteSkill.execute(
      { title: 'Missing Path', snippet: 'content' },
      context,
    );
    expect(result).toContain('Error');
    expect(context.upsertMemory).not.toHaveBeenCalled();
  });

  it('returns an error when title is missing', async () => {
    const context = makeContext();
    const result = await memoryWriteSkill.execute(
      { path: 'decisions/x.md', snippet: 'content' },
      context,
    );
    expect(result).toContain('Error');
  });

  it('returns an error when snippet is missing', async () => {
    const context = makeContext();
    const result = await memoryWriteSkill.execute(
      { path: 'decisions/x.md', title: 'Title' },
      context,
    );
    expect(result).toContain('Error');
  });

  it('returns an error when snippet exceeds the size limit', async () => {
    const context = makeContext();
    const result = await memoryWriteSkill.execute(
      { path: 'decisions/big.md', title: 'Big', snippet: 'x'.repeat(4001) },
      context,
    );
    expect(result).toContain('Error');
    expect(result).toContain('4000');
    expect(context.upsertMemory).not.toHaveBeenCalled();
  });

  it('passes through rejection feedback from upsertMemory', async () => {
    const context = makeContext({
      upsertMemory: vi.fn().mockReturnValue({ status: 'rejected', reason: 'Capacity reached.' }),
    });
    const result = await memoryWriteSkill.execute(
      { path: 'decisions/cap.md', title: 'Cap', snippet: 'Data' },
      context,
    );
    expect(result).toContain('Error');
    expect(result).toContain('rejected');
    expect(result).toContain('Capacity reached.');
  });

  it('reports "updated" when overwriting an existing entry', async () => {
    const context = makeContext({
      upsertMemory: vi.fn().mockReturnValue({ status: 'updated' }),
    });
    const result = await memoryWriteSkill.execute(
      { path: 'decisions/old.md', title: 'Updated', snippet: 'New data' },
      context,
    );
    expect(result).toContain('updated');
  });

  it('passes tags through to upsertMemory', async () => {
    const context = makeContext();
    await memoryWriteSkill.execute(
      { path: 'ideas/cool.md', title: 'Cool', snippet: 'Idea', tags: ['alpha', 'beta'] },
      context,
    );
    const call = (context.upsertMemory as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.tags).toEqual(['alpha', 'beta']);
  });

  it('filters out non-string tags', async () => {
    const context = makeContext();
    await memoryWriteSkill.execute(
      { path: 'ideas/mixed.md', title: 'Mixed', snippet: 'Data', tags: ['valid', 42, null, 'ok'] },
      context,
    );
    const call = (context.upsertMemory as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.tags).toEqual(['valid', 'ok']);
  });

  it('handles missing tags gracefully', async () => {
    const context = makeContext();
    await memoryWriteSkill.execute(
      { path: 'ideas/notags.md', title: 'No Tags', snippet: 'Data' },
      context,
    );
    const call = (context.upsertMemory as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.tags).toEqual([]);
  });

  it('sets lastModified as an ISO timestamp', async () => {
    const context = makeContext();
    await memoryWriteSkill.execute(
      { path: 'decisions/ts.md', title: 'Timestamp', snippet: 'Test' },
      context,
    );
    const call = (context.upsertMemory as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(() => new Date(call.lastModified)).not.toThrow();
    expect(call.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
