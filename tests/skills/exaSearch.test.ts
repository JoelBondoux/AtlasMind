import { describe, expect, it, vi } from 'vitest';
import { exaSearchSkill } from '../../src/skills/exaSearch.ts';
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
    getSpecialistApiKey: vi.fn().mockResolvedValue(undefined),
    getOutputChannelNames: vi.fn().mockResolvedValue([]),
    getAtlasMindOutputLog: vi.fn().mockResolvedValue(''),
    getDebugSessions: vi.fn().mockResolvedValue([]),
    evaluateDebugExpression: vi.fn().mockResolvedValue(''),
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
    ...overrides,
  };
}

describe('exa-search skill', () => {
  it('returns error when query is missing', async () => {
    const context = makeContext();
    const result = await exaSearchSkill.execute({}, context);
    expect(result).toContain('Error');
    expect(result).toContain('query');
  });

  it('returns error when no API key is configured', async () => {
    const context = makeContext({
      getSpecialistApiKey: vi.fn().mockResolvedValue(undefined),
    });
    const result = await exaSearchSkill.execute({ query: 'TypeScript tips' }, context);
    expect(result).toContain('Error');
    expect(result).toContain('EXA API key');
  });

  it('returns error when API returns non-ok status', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue('Unauthorized'),
    });
    vi.stubGlobal('fetch', mockFetch);

    const context = makeContext({
      getSpecialistApiKey: vi.fn().mockResolvedValue('test-api-key'),
    });
    const result = await exaSearchSkill.execute({ query: 'TypeScript tips' }, context);
    expect(result).toContain('Error');
    expect(result).toContain('401');

    vi.unstubAllGlobals();
  });

  it('returns formatted results on success', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        results: [
          {
            title: 'TypeScript Best Practices',
            url: 'https://example.com/ts-tips',
            publishedDate: '2024-01-01',
            text: 'Use strict mode and proper typing.',
          },
          {
            title: 'Advanced TypeScript',
            url: 'https://example.com/advanced-ts',
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const context = makeContext({
      getSpecialistApiKey: vi.fn().mockResolvedValue('test-api-key'),
    });
    const result = await exaSearchSkill.execute({ query: 'TypeScript tips' }, context);
    expect(result).toContain('EXA search results for: TypeScript tips');
    expect(result).toContain('TypeScript Best Practices');
    expect(result).toContain('https://example.com/ts-tips');
    expect(result).toContain('2024-01-01');
    expect(result).toContain('Use strict mode');
    expect(result).toContain('Advanced TypeScript');

    vi.unstubAllGlobals();
  });

  it('handles empty result set', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ results: [] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const context = makeContext({
      getSpecialistApiKey: vi.fn().mockResolvedValue('test-api-key'),
    });
    const result = await exaSearchSkill.execute({ query: 'obscure query xyz' }, context);
    expect(result).toContain('No results found');

    vi.unstubAllGlobals();
  });

  it('handles network error gracefully', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network failure'));
    vi.stubGlobal('fetch', mockFetch);

    const context = makeContext({
      getSpecialistApiKey: vi.fn().mockResolvedValue('test-api-key'),
    });
    const result = await exaSearchSkill.execute({ query: 'TypeScript tips' }, context);
    expect(result).toContain('Error');
    expect(result).toContain('Network failure');

    vi.unstubAllGlobals();
  });

  it('clamps numResults between 1 and 10', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        results: [{ title: 'Result', url: 'https://example.com' }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const context = makeContext({
      getSpecialistApiKey: vi.fn().mockResolvedValue('test-api-key'),
    });
    await exaSearchSkill.execute({ query: 'test', numResults: 50 }, context);

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body as string) as { numResults: number };
    expect(callBody.numResults).toBe(10);

    vi.unstubAllGlobals();
  });

  it('includes autoprompt string when different from original query', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        results: [{ title: 'Result', url: 'https://example.com' }],
        autopromptString: 'TypeScript best practices 2024',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const context = makeContext({
      getSpecialistApiKey: vi.fn().mockResolvedValue('test-api-key'),
    });
    const result = await exaSearchSkill.execute({ query: 'ts tips' }, context);
    expect(result).toContain('Autoprompt');
    expect(result).toContain('TypeScript best practices 2024');

    vi.unstubAllGlobals();
  });
});
