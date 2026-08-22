import { describe, expect, it, vi } from 'vitest';
import { gitStashSkill } from '../../src/skills/gitStash.ts';
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
    httpRequest: vi.fn().mockResolvedValue({ ok: true, status: 200, body: '{}' }),
    getTerminalOutput: vi.fn().mockResolvedValue(''),
    ...overrides,
  } as unknown as SkillExecutionContext;
}

describe('git-stash skill', () => {
  it('lists stash entries', async () => {
    const context = makeContext({
      runCommand: vi.fn().mockResolvedValue({ ok: true, exitCode: 0, stdout: 'stash@{0}: WIP on develop', stderr: '' }),
    });
    const result = await gitStashSkill.execute({ action: 'list' }, context);
    expect(context.runCommand).toHaveBeenCalledWith('git', ['stash', 'list']);
    expect(result).toContain('WIP on develop');
  });

  it('says so plainly when there are no entries', async () => {
    const result = await gitStashSkill.execute({ action: 'list' }, makeContext());
    expect(result).toBe('No stash entries.');
  });

  it('pushes with message and untracked files', async () => {
    const context = makeContext();
    await gitStashSkill.execute({ action: 'push', message: 'before cleanup', includeUntracked: true }, context);
    expect(context.runCommand).toHaveBeenCalledWith('git', ['stash', 'push', '--include-untracked', '-m', 'before cleanup']);
  });

  it('addresses entries by validated integer index only', async () => {
    const context = makeContext();
    await gitStashSkill.execute({ action: 'drop', index: 2 }, context);
    expect(context.runCommand).toHaveBeenCalledWith('git', ['stash', 'drop', 'stash@{2}']);
  });

  it('rejects a non-integer index so a crafted ref can never reach git', async () => {
    const context = makeContext();
    const result = await gitStashSkill.execute({ action: 'drop', index: -1 }, context);
    expect(result).toContain('Error');
    expect(context.runCommand).not.toHaveBeenCalled();
  });

  it('defaults show to the newest entry with --stat', async () => {
    const context = makeContext();
    await gitStashSkill.execute({ action: 'show' }, context);
    expect(context.runCommand).toHaveBeenCalledWith('git', ['stash', 'show', '--stat', 'stash@{0}']);
  });

  it('explains conflicts on apply instead of only reporting the exit code', async () => {
    const context = makeContext({
      runCommand: vi.fn().mockResolvedValue({ ok: false, exitCode: 1, stdout: '', stderr: 'CONFLICT (content): merge conflict' }),
    });
    const result = await gitStashSkill.execute({ action: 'apply' }, context);
    expect(result).toContain('conflict');
    expect(result).toContain('Resolve');
  });

  it('rejects unknown actions', async () => {
    const result = await gitStashSkill.execute({ action: 'clear' }, makeContext());
    expect(result).toContain('Error');
  });
});
