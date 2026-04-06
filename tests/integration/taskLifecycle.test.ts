/**
 * Integration test: exercises the full task lifecycle
 * from orchestrator → agent selection → skill execution → cost tracking.
 */
import { describe, expect, it, vi } from 'vitest';
import { Orchestrator } from '../../src/core/orchestrator.ts';
import { AgentRegistry } from '../../src/core/agentRegistry.ts';
import { SkillsRegistry } from '../../src/core/skillsRegistry.ts';
import { ModelRouter } from '../../src/core/modelRouter.ts';
import { MemoryManager } from '../../src/memory/memoryManager.ts';
import { CostTracker } from '../../src/core/costTracker.ts';
import { ProviderRegistry } from '../../src/providers/index.ts';
import { TaskProfiler } from '../../src/core/taskProfiler.ts';
import type { CompletionRequest, CompletionResponse, ProviderAdapter } from '../../src/providers/adapter.ts';
import type { AgentDefinition, SkillDefinition, SkillExecutionContext } from '../../src/types.ts';

function makeSkillContext(overrides: Partial<SkillExecutionContext> = {}): SkillExecutionContext {
  return {
    workspaceRootPath: '/workspace',
    queryMemory: vi.fn().mockResolvedValue([]),
    upsertMemory: vi.fn().mockReturnValue({ status: 'created' }),
    deleteMemory: vi.fn().mockResolvedValue(true),
    readFile: vi.fn().mockResolvedValue('file contents'),
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
    ...overrides,
  };
}

function makeMockProvider(responses: CompletionResponse[]): ProviderAdapter {
  let call = 0;
  return {
    providerId: 'local',
    complete: vi.fn((_req: CompletionRequest) => Promise.resolve(responses[call++] ?? responses.at(-1)!)),
    listModels: vi.fn().mockResolvedValue(['local/echo-1']),
    healthCheck: vi.fn().mockResolvedValue(true),
  };
}

describe('Integration: task lifecycle', () => {
  it('routes task through agent selection → model → cost recording → performance tracking', async () => {
    // Provider that returns a final response
    const provider = makeMockProvider([{
      content: 'Here is the answer.',
      model: 'local/echo-1',
      inputTokens: 100,
      outputTokens: 50,
      finishReason: 'stop',
    }]);

    // Registry setup
    const agentRegistry = new AgentRegistry();
    const codeAgent: AgentDefinition = {
      id: 'code-agent',
      name: 'Code Agent',
      role: 'code generation',
      description: 'Specialised in writing and reviewing code.',
      systemPrompt: 'You are a code assistant.',
      skills: ['file-read'],
    };
    agentRegistry.register(codeAgent);

    const defaultAgent: AgentDefinition = {
      id: 'default',
      name: 'Default',
      role: 'general assistant',
      description: 'Fallback.',
      systemPrompt: 'You are helpful.',
      skills: [],
    };
    agentRegistry.register(defaultAgent);

    const skillsRegistry = new SkillsRegistry();
    const readSkill: SkillDefinition = {
      id: 'file-read',
      name: 'Read File',
      description: 'Reads a file from the workspace',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' } }, required: ['path'] },
      riskLevel: 'safe',
      builtIn: true,
      execute: async (args, ctx) => ctx.readFile(args.path as string),
    };
    skillsRegistry.register(readSkill);
    skillsRegistry.setScanResult({ skillId: 'file-read', status: 'passed', scannedAt: new Date().toISOString(), issues: [] });

    const modelRouter = new ModelRouter();
    modelRouter.registerProvider({
      id: 'local',
      displayName: 'Local',
      apiKeySettingKey: '',
      enabled: true,
      pricingModel: 'free',
      models: [{
        id: 'local/echo-1',
        provider: 'local',
        name: 'Echo 1',
        contextWindow: 4096,
        inputPricePer1k: 0.001,
        outputPricePer1k: 0.002,
        capabilities: ['chat', 'code', 'function_calling'],
        enabled: true,
      }],
    });

    const costTracker = new CostTracker();
    const providerRegistry = new ProviderRegistry();
    providerRegistry.register(provider);
    const memoryManager = new MemoryManager();
    const taskProfiler = new TaskProfiler();
    const skillContext = makeSkillContext();

    const orchestrator = new Orchestrator(
      agentRegistry,
      skillsRegistry,
      modelRouter,
      memoryManager,
      costTracker,
      providerRegistry,
      skillContext,
      taskProfiler,
      { emit: vi.fn() } as any,
      { toolApprovalGate: async () => ({ approved: true }) },
      { maxToolIterations: 5, maxToolCallsPerTurn: 3, toolExecutionTimeoutMs: 10000, providerTimeoutMs: 30000 },
    );

    // Execute a code-related task — should pick the code-agent
    const result = await orchestrator.processTask({
      id: 'task-1',
      userMessage: 'Write a function that sorts an array',
      context: {},
      constraints: { budgetMode: 'balanced', speedMode: 'balanced' },
    });

    // Verify task result
    expect(result.agentId).toBe('code-agent');
    expect(result.response).toBe('Here is the answer.');
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Verify cost was recorded
    const summary = costTracker.getSummary();
    expect(summary.totalRequests).toBe(1);
    expect(summary.totalCostUsd).toBeGreaterThan(0);

    // Verify agent performance was tracked
    const successRate = agentRegistry.getSuccessRate('code-agent');
    expect(successRate).toBe(1); // 1 success, 0 failures

    const perf = agentRegistry.getPerformance('code-agent');
    expect(perf).toEqual({ successes: 1, failures: 0, totalTasks: 1 });
  });

  it('records failure when provider returns error', async () => {
    const provider = makeMockProvider([{
      content: 'Error occurred.',
      model: 'local/echo-1',
      inputTokens: 50,
      outputTokens: 10,
      finishReason: 'error',
    }]);

    const agentRegistry = new AgentRegistry();
    agentRegistry.register({
      id: 'default',
      name: 'Default',
      role: 'general assistant',
      description: 'Default agent.',
      systemPrompt: 'You are helpful.',
      skills: [],
    });

    const skillsRegistry = new SkillsRegistry();
    const modelRouter = new ModelRouter();
    modelRouter.registerProvider({
      id: 'local',
      displayName: 'Local',
      apiKeySettingKey: '',
      enabled: true,
      pricingModel: 'free',
      models: [{
        id: 'local/echo-1',
        provider: 'local',
        name: 'Echo 1',
        contextWindow: 4096,
        inputPricePer1k: 0,
        outputPricePer1k: 0,
        capabilities: ['chat'],
        enabled: true,
      }],
    });

    const costTracker = new CostTracker();
    const providerRegistry = new ProviderRegistry();
    providerRegistry.register(provider);

    const orchestrator = new Orchestrator(
      agentRegistry,
      skillsRegistry,
      modelRouter,
      new MemoryManager(),
      costTracker,
      providerRegistry,
      makeSkillContext(),
      new TaskProfiler(),
      { emit: vi.fn() } as any,
      { toolApprovalGate: async () => ({ approved: true }) },
      { maxToolIterations: 5, maxToolCallsPerTurn: 3, toolExecutionTimeoutMs: 10000, providerTimeoutMs: 30000 },
    );

    await orchestrator.processTask({
      id: 'task-err',
      userMessage: 'Hello',
      context: {},
      constraints: { budgetMode: 'cheap', speedMode: 'fast' },
    });

    // Failure should be tracked
    const successRate = agentRegistry.getSuccessRate('default');
    expect(successRate).toBe(0);
  });

  it('persists and restores agent performance data', () => {
    const registry = new AgentRegistry();
    registry.register({ id: 'a', name: 'A', role: 'r', description: 'd', systemPrompt: 's', skills: [] });
    registry.recordOutcome('a', true);
    registry.recordOutcome('a', true);
    registry.recordOutcome('a', false);

    const dumped = registry.dumpPerformance();
    expect(dumped['a']).toEqual({ successes: 2, failures: 1, totalTasks: 3 });

    // Restore into a fresh registry
    const registry2 = new AgentRegistry();
    registry2.loadPerformance(dumped);
    expect(registry2.getSuccessRate('a')).toBeCloseTo(2 / 3);
  });
});
