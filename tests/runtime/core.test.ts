import { describe, expect, it } from 'vitest';
import { createAtlasRuntime } from '../../src/runtime/core.ts';

function makeSkillContext() {
  return {
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
    httpRequest: async () => ({ ok: true, status: 200, body: '{}' }),
    getTestResults: async () => [],
    getActiveDebugSession: async () => null,
    listTerminals: async () => [],
  };
}

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
      skillContext: makeSkillContext(),
      providerAdapters: [{ providerId: 'local' } as never],
    });

    expect(runtime.agentRegistry.get('default')?.name).toBe('Default');
    expect(runtime.skillsRegistry.listSkills().length).toBeGreaterThan(5);
    expect(runtime.providerRegistry.get('local')).toBeDefined();
    expect(runtime.modelRouter.listProviders().some(provider => provider.id === 'local')).toBe(true);
  });

  it('supports runtime plugins with lifecycle events and contribution manifests', () => {
    const lifecycleStages: string[] = [];
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
      skillContext: makeSkillContext(),
      plugins: [
        {
          id: 'test-plugin',
          description: 'Adds plugin-provided capabilities',
          register(api) {
            api.registerProvider({
              providerId: 'local-plugin',
              complete: async () => ({
                content: 'ok',
                model: 'local/echo-1',
                inputTokens: 1,
                outputTokens: 1,
                finishReason: 'stop' as const,
              }),
              listModels: async () => ['local/echo-1'],
              healthCheck: async () => true,
            });
            api.registerAgent({
              id: 'plugin-agent',
              name: 'Plugin Agent',
              role: 'plugin tester',
              description: 'Agent contributed by a runtime plugin.',
              systemPrompt: 'Test plugin agent.',
              skills: ['plugin-skill'],
            });
            api.registerSkill({
              id: 'plugin-skill',
              name: 'Plugin Skill',
              description: 'Skill contributed by a runtime plugin.',
              parameters: { type: 'object', properties: {} },
              execute: async () => 'plugin-ok',
            });
          },
          onRuntimeEvent(event) {
            lifecycleStages.push(event.stage);
          },
        },
      ],
      onRuntimeEvent(event) {
        lifecycleStages.push(`host:${event.stage}`);
      },
    });

    expect(runtime.providerRegistry.get('local-plugin')).toBeDefined();
    expect(runtime.agentRegistry.get('plugin-agent')?.name).toBe('Plugin Agent');
    expect(runtime.skillsRegistry.get('plugin-skill')?.name).toBe('Plugin Skill');
    expect(runtime.plugins).toEqual([
      {
        id: 'test-plugin',
        description: 'Adds plugin-provided capabilities',
        contributionCounts: { providers: 1, agents: 1, skills: 1 },
      },
    ]);
    expect(lifecycleStages).toContain('runtime:plugin-registering');
    expect(lifecycleStages).toContain('runtime:plugin-registered');
    expect(lifecycleStages).toContain('runtime:ready');
    expect(lifecycleStages).toContain('host:runtime:ready');
  });
});