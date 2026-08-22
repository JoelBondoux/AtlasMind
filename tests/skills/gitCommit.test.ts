import { describe, expect, it, vi } from 'vitest';
import { gitCommitSkill } from '../../src/skills/gitCommit.ts';
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

describe('git-commit skill', () => {
  it('allows repository pre-commit hooks to finish within a bounded window', () => {
    expect(gitCommitSkill.timeoutMs).toBe(125_000);
  });

  it('creates a commit with the given message', async () => {
    const context = makeContext({
      runCommand: vi.fn().mockResolvedValue({
        ok: true,
        exitCode: 0,
        stdout: '[master abc1234] fix: typo\n 1 file changed',
        stderr: '',
      }),
    });
    const result = await gitCommitSkill.execute({ message: 'fix: typo' }, context);
    expect(context.runCommand).toHaveBeenCalledWith(
      'git',
      ['commit', '-m', 'fix: typo'],
      { timeoutMs: 120_000 },
    );
    expect(result).toContain('exit 0');
    expect(result).toContain('fix: typo');
  });

  it('returns an error when message is missing', async () => {
    const context = makeContext();
    const result = await gitCommitSkill.execute({}, context);
    expect(result).toContain('Error');
    expect(context.runCommand).not.toHaveBeenCalled();
  });

  it('returns an error when message is an empty string', async () => {
    const context = makeContext();
    const result = await gitCommitSkill.execute({ message: '  ' }, context);
    expect(result).toContain('Error');
    expect(context.runCommand).not.toHaveBeenCalled();
  });

  it('returns an error when message is not a string', async () => {
    const context = makeContext();
    const result = await gitCommitSkill.execute({ message: 123 }, context);
    expect(result).toContain('Error');
    expect(context.runCommand).not.toHaveBeenCalled();
  });

  it('trims the commit message', async () => {
    const context = makeContext({
      runCommand: vi.fn().mockResolvedValue({ ok: true, exitCode: 0, stdout: '', stderr: '' }),
    });
    await gitCommitSkill.execute({ message: '  chore: clean up  ' }, context);
    expect(context.runCommand).toHaveBeenCalledWith(
      'git',
      ['commit', '-m', 'chore: clean up'],
      { timeoutMs: 120_000 },
    );
  });

  it('stages only explicitly named tracked or untracked paths before committing', async () => {
    const context = makeContext();

    await gitCommitSkill.execute({
      message: 'chore: add version helpers',
      paths: ['scripts/bump-version.js', 'scripts/bump version.mjs'],
    }, context);

    expect(context.runCommand).toHaveBeenNthCalledWith(
      1,
      'git',
      ['add', '--', 'scripts/bump-version.js', 'scripts/bump version.mjs'],
      { timeoutMs: 120_000 },
    );
    expect(context.runCommand).toHaveBeenNthCalledWith(
      2,
      'git',
      [
        'commit',
        '--only',
        '-m',
        'chore: add version helpers',
        '--',
        'scripts/bump-version.js',
        'scripts/bump version.mjs',
      ],
      { timeoutMs: 120_000 },
    );
  });

  it.each(['.', './', '..', '../outside.ts', '/absolute.ts', 'src/*.ts', 'src\\*.ts'])('refuses broad or unsafe commit path %j', async path => {
    const context = makeContext();
    const result = await gitCommitSkill.execute({ message: 'chore: unsafe sweep', paths: [path] }, context);

    expect(result).toContain('Error');
    expect(context.runCommand).not.toHaveBeenCalled();
  });

  it('refuses to combine exact paths with the all-tracked staging mode', async () => {
    const context = makeContext();
    const result = await gitCommitSkill.execute({
      message: 'chore: ambiguous stage',
      paths: ['src/index.ts'],
      stage_tracked: true,
    }, context);

    expect(result).toContain('Error');
    expect(context.runCommand).not.toHaveBeenCalled();
  });

  it('does not commit when exact-path staging fails', async () => {
    const context = makeContext({
      runCommand: vi.fn().mockResolvedValue({ ok: false, exitCode: 128, stdout: '', stderr: 'pathspec did not match' }),
    });

    const result = await gitCommitSkill.execute({ message: 'chore: missing file', paths: ['missing.ts'] }, context);

    expect(result).toContain('pathspec did not match');
    expect(context.runCommand).toHaveBeenCalledTimes(1);
  });

  it('reports a failed commit', async () => {
    const context = makeContext({
      runCommand: vi.fn().mockResolvedValue({
        ok: false,
        exitCode: 1,
        stdout: '',
        stderr: 'nothing to commit',
      }),
    });
    const result = await gitCommitSkill.execute({ message: 'feat: empty' }, context);
    expect(result).toContain('exit 1');
    expect(result).toContain('nothing to commit');
  });
});
