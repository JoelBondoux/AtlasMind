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
  it('registers the built-in agents, built-in skills, and supplied provider adapters', () => {
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

    expect(runtime.agentRegistry.get('default')).toMatchObject({ name: 'Default', skills: [] });
    expect(runtime.agentRegistry.get('workspace-debugger')).toMatchObject({ name: 'Workspace Debugger', builtIn: true });
    expect(runtime.agentRegistry.get('frontend-engineer')).toMatchObject({ name: 'Frontend Engineer', builtIn: true });
    expect(runtime.agentRegistry.get('backend-engineer')).toMatchObject({ name: 'Backend Engineer', builtIn: true });
    expect(runtime.agentRegistry.get('code-reviewer')).toMatchObject({ name: 'Code Reviewer', builtIn: true });
    expect(runtime.agentRegistry.get('default')?.systemPrompt).toContain('working directly in the user\'s current workspace');
    expect(runtime.agentRegistry.get('default')?.systemPrompt).toContain('Prefer acting on the repository');
    expect(runtime.agentRegistry.get('default')?.systemPrompt).toContain('prefer capturing the change with the smallest relevant automated test before implementation');
    expect(runtime.agentRegistry.get('workspace-debugger')?.systemPrompt).toContain('failing automated test');
    expect(runtime.agentRegistry.get('frontend-engineer')?.systemPrompt).toContain('smallest relevant automated regression test before implementation');
    expect(runtime.agentRegistry.get('backend-engineer')?.systemPrompt).toContain('Prefer a red-green-refactor flow');
    expect(runtime.agentRegistry.get('code-reviewer')?.systemPrompt).toContain('missing failing-to-passing evidence');
    expect(runtime.agentRegistry.listAgents().length).toBeGreaterThanOrEqual(5);
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

  it('routes a review-style freeform request to the built-in code reviewer agent', async () => {
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
      providerAdapters: [{
        providerId: 'local',
        complete: async () => ({
          content: 'Review findings',
          model: 'local/echo-1',
          inputTokens: 10,
          outputTokens: 5,
          finishReason: 'stop' as const,
        }),
        listModels: async () => ['local/echo-1'],
        healthCheck: async () => true,
      } as never],
    });

    const result = await runtime.orchestrator.processTask({
      id: 'task-built-in-review-agent',
      userMessage: 'Review this change for bugs, regressions, and missing tests before we merge it.',
      context: {},
      constraints: { budget: 'balanced', speed: 'balanced' },
      timestamp: new Date().toISOString(),
    });

    expect(result.agentId).toBe('code-reviewer');
  });
});