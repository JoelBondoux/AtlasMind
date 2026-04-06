import { describe, expect, it, vi } from 'vitest';
import { vscodeExtensionsSkill } from '../../src/skills/vscodeExtensions.ts';
import type { SkillExecutionContext } from '../../src/types.ts';

const SAMPLE_EXTENSIONS: Array<{ id: string; displayName: string; version: string; enabled: boolean }> = [
  { id: 'esbenp.prettier-vscode', displayName: 'Prettier', version: '9.0.0', enabled: true },
  { id: 'dbaeumer.vscode-eslint', displayName: 'ESLint', version: '2.4.4', enabled: true },
  { id: 'github.copilot', displayName: 'GitHub Copilot', version: '1.100.0', enabled: true },
  { id: 'some-vendor.custom-tool', displayName: 'Custom Tool', version: '1.0.0', enabled: false },
];

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
    getSpecialistApiKey: vi.fn().mockResolvedValue(undefined),
    getOutputChannelNames: vi.fn().mockResolvedValue([]),
    getAtlasMindOutputLog: vi.fn().mockResolvedValue(''),
    getDebugSessions: vi.fn().mockResolvedValue([]),
    evaluateDebugExpression: vi.fn().mockResolvedValue(''),
    getTerminalOutput: vi.fn().mockResolvedValue(''),
    getInstalledExtensions: vi.fn().mockResolvedValue(SAMPLE_EXTENSIONS),
    getPortForwards: vi.fn().mockResolvedValue([]),
    getDocumentSymbols: vi.fn().mockResolvedValue([]),
    findReferences: vi.fn().mockResolvedValue([]),
    goToDefinition: vi.fn().mockResolvedValue([]),
    renameSymbol: vi.fn().mockResolvedValue({ filesChanged: 0, editsApplied: 0 }),
    fetchUrl: vi.fn().mockResolvedValue({ ok: true, status: 200, body: '' }),
    getCodeActions: vi.fn().mockResolvedValue([]),
    applyCodeAction: vi.fn().mockResolvedValue({ applied: true }),
    ...overrides,
  };
}

describe('vscode-extensions skill', () => {
  it('has id vscode-extensions', () => {
    expect(vscodeExtensionsSkill.id).toBe('vscode-extensions');
  });

  it('lists active extensions', async () => {
    const context = makeContext();
    const result = await vscodeExtensionsSkill.execute({}, context);
    expect(result).toContain('=== VS Code Extensions ===');
    expect(result).toContain('Prettier');
    expect(result).toContain('ESLint');
    expect(result).toContain('GitHub Copilot');
  });

  it('marks top 50 extensions with a star', async () => {
    const context = makeContext();
    const result = await vscodeExtensionsSkill.execute({}, context);
    // github.copilot is in the top list
    expect(result).toMatch(/GitHub Copilot.*★/);
  });

  it('lists inactive extensions separately', async () => {
    const context = makeContext();
    const result = await vscodeExtensionsSkill.execute({}, context);
    expect(result).toContain('Inactive');
    expect(result).toContain('Custom Tool');
  });

  it('filters by name fragment', async () => {
    const context = makeContext();
    const result = await vscodeExtensionsSkill.execute({ filter: 'prettier' }, context);
    expect(result).toContain('Prettier');
    expect(result).not.toContain('ESLint');
  });

  it('filters by topOnly', async () => {
    const context = makeContext();
    const result = await vscodeExtensionsSkill.execute({ topOnly: true }, context);
    expect(result).toContain('Prettier');
    // some-vendor.custom-tool is not in the top 50
    expect(result).not.toContain('Custom Tool');
  });

  it('reports forwarded ports', async () => {
    const context = makeContext({
      getPortForwards: vi.fn().mockResolvedValue([
        { portNumber: 3000, label: 'Dev server', localAddress: 'localhost:3000', privacy: 'private' },
      ]),
    });
    const result = await vscodeExtensionsSkill.execute({}, context);
    expect(result).toContain('=== Forwarded Ports ===');
    expect(result).toContain(':3000');
    expect(result).toContain('Dev server');
    expect(result).toContain('localhost:3000');
  });

  it('reports no ports forwarded when list is empty', async () => {
    const context = makeContext();
    const result = await vscodeExtensionsSkill.execute({}, context);
    expect(result).toContain('No ports are currently forwarded');
  });

  it('skips port check when includePorts is false', async () => {
    const context = makeContext();
    await vscodeExtensionsSkill.execute({ includePorts: false }, context);
    expect(context.getPortForwards).not.toHaveBeenCalled();
  });

  it('returns no-match message when nothing matches filter', async () => {
    const context = makeContext({
      getInstalledExtensions: vi.fn().mockResolvedValue([]),
    });
    const result = await vscodeExtensionsSkill.execute({ filter: 'nonexistent' }, context);
    expect(result).toContain('no extensions match the filter');
  });

  it('rejects invalid filter parameter', async () => {
    const context = makeContext();
    const result = await vscodeExtensionsSkill.execute({ filter: 42 }, context);
    expect(result).toMatch(/filter.*string/i);
    expect(context.getInstalledExtensions).not.toHaveBeenCalled();
  });
});
