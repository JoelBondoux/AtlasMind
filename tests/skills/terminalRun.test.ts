import { describe, expect, it, vi } from 'vitest';
import { terminalRunSkill } from '../../src/skills/terminalRun.ts';
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
    runCommand: vi.fn().mockResolvedValue({ ok: true, exitCode: 0, stdout: 'ok', stderr: '' }),
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

describe('terminal-run skill', () => {
  it('declares args as an array of strings in the tool schema', () => {
    const properties = terminalRunSkill.parameters['properties'] as Record<string, unknown>;
    const args = properties['args'] as Record<string, unknown>;

    expect(args['type']).toBe('array');
    expect(args['items']).toEqual({ type: 'string' });
  });

  it('runs an allow-listed command', async () => {
    const context = makeContext();
    const result = await terminalRunSkill.execute({ command: 'git', args: ['status', '--short'] }, context);
    expect(context.runCommand).toHaveBeenCalledWith('git', ['status', '--short'], {
      cwd: undefined,
      timeoutMs: undefined,
    });
    expect(result).toContain('ok: true');
  });

  it('rejects blocked commands', async () => {
    const context = makeContext();
    const result = await terminalRunSkill.execute({ command: 'powershell' }, context);
    expect(result).toContain('blocked');
    expect(context.runCommand).not.toHaveBeenCalled();
  });

  it('rejects unknown commands not on the allow-list', async () => {
    const context = makeContext();
    const result = await terminalRunSkill.execute({ command: 'unknown-tool' }, context);
    expect(result).toContain('not on the allow-list');
    expect(context.runCommand).not.toHaveBeenCalled();
  });

  it('allows newly added language tools (python, cargo, etc.)', async () => {
    const context = makeContext();
    for (const cmd of ['python', 'cargo', 'dotnet', 'go', 'make', 'deno', 'bun']) {
      const result = await terminalRunSkill.execute({ command: cmd, args: ['--version'] }, context);
      expect(result).toContain('ok: true');
    }
  });

  it('blocks inline node evaluation flags', async () => {
    const context = makeContext();
    const result = await terminalRunSkill.execute({ command: 'node', args: ['-e', 'console.log(1)'] }, context);
    expect(result).toContain('inline interpreter execution is not allowed');
    expect(context.runCommand).not.toHaveBeenCalled();
  });

  it('blocks inline python evaluation flags', async () => {
    const context = makeContext();
    const result = await terminalRunSkill.execute({ command: 'python', args: ['-c', 'print(1)'] }, context);
    expect(result).toContain('inline interpreter execution is not allowed');
    expect(context.runCommand).not.toHaveBeenCalled();
  });
});
describe('gh is reachable, and its dangerous subcommands are not', () => {
  // `gh` was absent from the allow-list — not as a policy, as a gap. The planner
  // instructs agents to run `gh pr list`, the github-operator agent is advertised
  // for pull-request work, and every one of those turns died here in a refusal
  // that went to the model rather than to the operator.

  const run = async (args: string[]) => {
    const context = makeContext();
    const result = await terminalRunSkill.execute!({ command: 'gh', args }, context);
    return { result: String(result), ran: (context.runCommand as ReturnType<typeof vi.fn>).mock.calls.length > 0 };
  };

  it('runs an ordinary read', async () => {
    const { result, ran } = await run(['pr', 'list']);
    expect(ran).toBe(true);
    expect(result).not.toMatch(/not on the allow-list/);
  });

  it('runs a write, leaving the approval gate to decide', async () => {
    // terminal-run is not where a write is authorised; toolPolicy grades it and
    // the approval manager gates it. This only proves the command is reachable.
    const { ran } = await run(['pr', 'comment', '42', '--body', 'looks good']);
    expect(ran).toBe(true);
  });

  it('refuses to print the GitHub token', async () => {
    // The whole point: terminal-run returns stdout as tool output, which becomes
    // model context. No approval prompt makes this safe.
    const { result, ran } = await run(['auth', 'token']);
    expect(ran).toBe(false);
    expect(result).toMatch(/blocked for safety/i);
    expect(result).toMatch(/token into model context/i);
  });

  it('refuses token printing even behind leading flags', async () => {
    const { ran } = await run(['--hostname', 'github.com', 'auth', 'token']);
    expect(ran).toBe(false);
  });

  it('still allows gh auth status, which prints no credential', async () => {
    const { ran } = await run(['auth', 'status']);
    expect(ran).toBe(true);
  });

  it('refuses the credential and key namespaces outright', async () => {
    for (const args of [['secret', 'set', 'X'], ['secret', 'list'], ['variable', 'set', 'Y'], ['ssh-key', 'add'], ['gpg-key', 'add'], ['alias', 'set']]) {
      const { ran, result } = await run(args);
      expect(ran, args.join(' ')).toBe(false);
      expect(result, args.join(' ')).toMatch(/blocked for safety/i);
    }
  });

  it('refuses repo deletion but not other repo subcommands', async () => {
    expect((await run(['repo', 'delete', 'owner/name'])).ran).toBe(false);
    expect((await run(['repo', 'view'])).ran).toBe(true);
    expect((await run(['repo', 'clone', 'owner/name'])).ran).toBe(true);
  });

  it('does not refuse a comment that merely mentions a blocked word', async () => {
    // Substring matching here would block ordinary prose and teach whoever hit
    // it that the refusal is noise.
    const { ran } = await run(['pr', 'comment', '7', '--body', 'see the auth token docs for secret rotation']);
    expect(ran).toBe(true);
  });

  it('leaves other commands unaffected', async () => {
    const context = makeContext();
    await terminalRunSkill.execute!({ command: 'git', args: ['status'] }, context);
    expect((context.runCommand as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });
});
