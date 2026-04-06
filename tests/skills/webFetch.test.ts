import { describe, expect, it, vi } from 'vitest';
import { webFetchSkill } from '../../src/skills/webFetch.ts';
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
    getCodeActions: vi.fn().mockResolvedValue([]),
    applyCodeAction: vi.fn().mockResolvedValue({ applied: true }),
    ...overrides,
  };
}

describe('web-fetch skill', () => {
  it('rejects missing URL', async () => {
    const context = makeContext();
    const result = await webFetchSkill.execute({}, context);
    expect(result).toContain('Error');
  });

  it('rejects non-HTTP URLs', async () => {
    const context = makeContext();
    const result = await webFetchSkill.execute({ url: 'ftp://example.com' }, context);
    expect(result).toContain('Error');
  });

  it('rejects localhost URLs (SSRF protection)', async () => {
    const context = makeContext();
    const result = await webFetchSkill.execute({ url: 'http://localhost:3000/api' }, context);
    expect(result).toContain('private');
  });

  it('rejects 127.0.0.1 URLs (SSRF protection)', async () => {
    const context = makeContext();
    const result = await webFetchSkill.execute({ url: 'http://127.0.0.1/admin' }, context);
    expect(result).toContain('private');
  });

  it('rejects 192.168.x.x URLs (SSRF protection)', async () => {
    const context = makeContext();
    const result = await webFetchSkill.execute({ url: 'http://192.168.1.1/' }, context);
    expect(result).toContain('private');
  });

  it('rejects metadata.google.internal (SSRF protection)', async () => {
    const context = makeContext();
    const result = await webFetchSkill.execute({ url: 'http://metadata.google.internal/computeMetadata/v1/' }, context);
    expect(result).toContain('private');
  });

  it('fetches a URL and returns body', async () => {
    const context = makeContext({
      fetchUrl: vi.fn().mockResolvedValue({ ok: true, status: 200, body: 'Hello World' }),
    });
    const result = await webFetchSkill.execute({ url: 'https://example.com' }, context);
    expect(result).toContain('200');
    expect(result).toContain('Hello World');
  });

  it('reports HTTP errors', async () => {
    const context = makeContext({
      fetchUrl: vi.fn().mockResolvedValue({ ok: false, status: 404, body: 'Not Found' }),
    });
    const result = await webFetchSkill.execute({ url: 'https://example.com/missing' }, context);
    expect(result).toContain('Error');
    expect(result).toContain('404');
  });

  it('has a 30s skill-level timeout', () => {
    expect(webFetchSkill.timeoutMs).toBe(30_000);
  });
});
