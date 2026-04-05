import { describe, expect, it } from 'vitest';
import { createAtlasRuntime } from '../../src/runtime/core.ts';

describe('createAtlasRuntime', () => {
  it('registers the default agent, built-in skills, and supplied provider adapters', () => {
    const runtime = createAtlasRuntime({
      memoryStore: {
        queryRelevant: async () => [],
        getWarnedEntries: () => [],
        getBlockedEntries: () => [],
        redactSnippet: entry => entry.snippet,
      },
      costTracker: {
        record: () => undefined,
        getDailyBudgetStatus: () => undefined,
      },
      skillContext: {
        workspaceRootPath: undefined,
        queryMemory: async () => [],
        upsertMemory: () => ({ status: 'created' as const }),
        deleteMemory: async () => false,
        readFile: async () => '',
        writeFile: async () => undefined,
        findFiles: async () => [],
        searchInFiles: async () => [],
        listDirectory: async () => [],
        runCommand: async () => ({ ok: true, exitCode: 0, stdout: '', stderr: '' }),
        getGitStatus: async () => '',
        getGitDiff: async () => '',
        rollbackLastCheckpoint: async () => ({ ok: false, summary: '', restoredPaths: [] }),
        applyGitPatch: async () => ({ ok: true, stdout: '', stderr: '' }),
        getGitLog: async () => '',
        gitBranch: async () => '',
        deleteFile: async () => undefined,
        moveFile: async () => undefined,
        getDiagnostics: async () => [],
        getDocumentSymbols: async () => [],
        findReferences: async () => [],
        goToDefinition: async () => [],
        renameSymbol: async () => ({ filesChanged: 0, editsApplied: 0 }),
        fetchUrl: async () => ({ ok: true, status: 200, body: '' }),
        getCodeActions: async () => [],
        applyCodeAction: async () => ({ applied: false }),
      },
      providerAdapters: [{ providerId: 'local' } as never],
    });

    expect(runtime.agentRegistry.get('default')?.name).toBe('Default');
    expect(runtime.skillsRegistry.listSkills().length).toBeGreaterThan(5);
    expect(runtime.providerRegistry.get('local')).toBeDefined();
    expect(runtime.modelRouter.listProviders().some(provider => provider.id === 'local')).toBe(true);
  });
});