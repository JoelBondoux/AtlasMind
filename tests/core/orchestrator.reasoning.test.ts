/**
 * The reasoning axis, end to end through the orchestrator: what reaches the
 * adapter, what the pre-flight budget is told, and what the routing summary
 * says — for a declared model, an undeclared one, a budget that cannot afford
 * the requested depth, and a failover that lands on a model with no control.
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
import { REASONING_LEVEL_COSTS, REASONING_REPLY_ROOM_TOKENS } from '../../src/core/reasoningBudget.ts';
import type { CompletionRequest, CompletionResponse, ProviderAdapter } from '../../src/providers/adapter.ts';
import type { ModelInfo, ProviderConfig, RoutingConstraints, SkillExecutionContext } from '../../src/types.ts';

function skillContext(): SkillExecutionContext {
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
    rollbackLastCheckpoint: vi.fn().mockResolvedValue({ ok: true, summary: '', restoredPaths: [] }),
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
    getSpecialistApiKey: vi.fn().mockResolvedValue(undefined),
    getOutputChannelNames: vi.fn().mockResolvedValue([]),
    getAtlasMindOutputLog: vi.fn().mockResolvedValue(''),
    getDebugSessions: vi.fn().mockResolvedValue([]),
    evaluateDebugExpression: vi.fn().mockResolvedValue(''),
  };
}

function modelInfo(provider: string, id: string, overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: `${provider}/${id}`,
    provider,
    name: id,
    contextWindow: 1_000_000,
    inputPricePer1k: 0.004,
    outputPricePer1k: 0.02,
    capabilities: ['chat', 'code', 'reasoning'],
    reasoningDepth: 3,
    enabled: true,
    ...overrides,
  };
}

function providerConfig(id: string, models: ModelInfo[]): ProviderConfig {
  return { id, displayName: id, apiKeySettingKey: '', enabled: true, pricingModel: 'pay-per-token', models };
}

function adapter(providerId: string, requests: CompletionRequest[], behaviour: 'answer' | 'fail' = 'answer'): ProviderAdapter {
  return {
    providerId,
    complete: vi.fn(async (request: CompletionRequest): Promise<CompletionResponse> => {
      requests.push(request);
      if (behaviour === 'fail') {
        throw Object.assign(new Error(`${providerId} request failed (400): bad request`), { status: 400 });
      }
      return { content: 'Answer.', model: request.model, inputTokens: 100, outputTokens: 50, finishReason: 'stop' };
    }),
    listModels: vi.fn().mockResolvedValue([]),
    healthCheck: vi.fn().mockResolvedValue(true),
  };
}

interface Harness {
  orchestrator: Orchestrator;
  costs: CostTracker;
  progress: string[];
  run(constraints?: Partial<RoutingConstraints>): ReturnType<Orchestrator['processTask']>;
}

function harness(options: {
  providers: Array<{ config: ProviderConfig; adapter: ProviderAdapter }>;
  reasoningMode?: string;
}): Harness {
  const agents = new AgentRegistry();
  agents.register({ id: 'default', name: 'Default', role: 'general assistant', description: 'Fallback.', systemPrompt: 'You are helpful.', skills: [] });
  const router = new ModelRouter();
  const registry = new ProviderRegistry();
  for (const entry of options.providers) {
    router.registerProvider(entry.config);
    registry.register(entry.adapter);
  }
  const costs = new CostTracker();
  const progress: string[] = [];
  const orchestrator = new Orchestrator(
    agents,
    new SkillsRegistry(),
    router,
    new MemoryManager(),
    costs,
    registry,
    skillContext(),
    new TaskProfiler(),
    undefined,
    { emit: vi.fn() } as any,
    {
      toolApprovalGate: async () => ({ approved: true }),
      readSetting: <T,>(key: string, fallback: T): T => (key === 'reasoningMode' && options.reasoningMode !== undefined
        ? options.reasoningMode as unknown as T
        : fallback),
    },
    { maxToolIterations: 3, maxToolCallsPerTurn: 3, toolExecutionTimeoutMs: 10_000, providerTimeoutMs: 30_000 },
  );
  return {
    orchestrator,
    costs,
    progress,
    run: (constraints = {}) => orchestrator.processTask({
      id: `task-${Math.random().toString(36).slice(2)}`,
      userMessage: 'Explain what a closure is in one sentence.',
      context: {},
      constraints: { budget: 'expensive', speed: 'considered', ...constraints },
      timestamp: new Date().toISOString(),
    }, undefined, message => progress.push(message)),
  };
}

describe('a declared model receives the level as its vendor parameter', () => {
  it('sends output_config effort, makes room for the thinking, and says so', async () => {
    const requests: CompletionRequest[] = [];
    const h = harness({
      providers: [{ config: providerConfig('anthropic', [modelInfo('anthropic', 'claude-opus-5-5', { reasoningControl: 'anthropic-effort' })]), adapter: adapter('anthropic', requests) }],
      reasoningMode: 'deep',
    });

    const result = await h.run();

    expect(requests).toHaveLength(1);
    expect(requests[0].reasoning).toEqual({ control: 'anthropic-effort', level: 'deep', value: 'high', rule: 'anthropic-effort:deep' });
    expect(requests[0].maxTokens).toBe(REASONING_LEVEL_COSTS.deep.projectedThinkingTokens + REASONING_REPLY_ROOM_TOKENS);
    expect(result.reasoning).toMatchObject({ preference: 'deep', level: 'deep', levelRule: 'explicit-preference', outcome: 'applied', parameter: 'output_config.effort=high' });
    expect(h.progress.some(line => line.startsWith('Reasoning: deep (rule: explicit-preference); sent output_config.effort=high'))).toBe(true);
  });

  it('prices the pre-flight with the projected thinking, so the daily limit sees it', async () => {
    const requests: CompletionRequest[] = [];
    const h = harness({
      providers: [{ config: providerConfig('anthropic', [modelInfo('anthropic', 'claude-opus-5-5', { reasoningControl: 'anthropic-effort' })]), adapter: adapter('anthropic', requests) }],
      reasoningMode: 'deep',
    });
    const spy = vi.spyOn(h.costs, 'getDailyBudgetStatus');

    await h.run();

    const projected = spy.mock.calls[0]?.[0] ?? 0;
    // At least the thinking alone at the output rate: 24,576 tokens × $0.02/1K.
    expect(projected).toBeGreaterThanOrEqual((REASONING_LEVEL_COSTS.deep.projectedThinkingTokens / 1000) * 0.02);
  });
});

describe('an undeclared model is routable and sent nothing', () => {
  it('omits the parameter and keeps the requested ceiling', async () => {
    const requests: CompletionRequest[] = [];
    const h = harness({
      providers: [{ config: providerConfig('anthropic', [modelInfo('anthropic', 'claude-haiku-4-5')]), adapter: adapter('anthropic', requests) }],
      reasoningMode: 'deep',
    });

    const result = await h.run();

    expect(requests).toHaveLength(1);
    expect(requests[0].reasoning).toBeUndefined();
    expect(requests[0].maxTokens).toBeLessThan(REASONING_LEVEL_COSTS.minimal.projectedThinkingTokens + REASONING_REPLY_ROOM_TOKENS);
    expect(result.reasoning).toMatchObject({ outcome: 'not-sent', notSentRule: 'no-declared-control' });
  });
});

describe('a task budget cap steps the level down rather than letting deep slip past it', () => {
  it('sends the highest level whose projection fits, naming the step-down rule', async () => {
    const requests: CompletionRequest[] = [];
    const h = harness({
      providers: [{ config: providerConfig('anthropic', [modelInfo('anthropic', 'claude-opus-5-5', { reasoningControl: 'anthropic-effort' })]), adapter: adapter('anthropic', requests) }],
      reasoningMode: 'deep',
    });

    // Deep projects ~$0.50 of thinking, standard ~$0.17, minimal ~$0.03 on top of the prompt.
    const result = await h.run({ maxCostUsd: 0.1 });

    expect(requests[0].reasoning?.level).toBe('minimal');
    expect(result.reasoning).toMatchObject({ level: 'minimal', levelRule: 'budget-cap-step-down' });
  });
});

describe('failover re-plans for the model it lands on', () => {
  it('does not carry the first model’s parameter to a model with no declared control', async () => {
    const capableRequests: CompletionRequest[] = [];
    const fallbackRequests: CompletionRequest[] = [];
    const h = harness({
      providers: [
        { config: providerConfig('anthropic', [modelInfo('anthropic', 'claude-opus-5-5', { reasoningControl: 'anthropic-effort' })]), adapter: adapter('anthropic', capableRequests, 'fail') },
        { config: providerConfig('deepseek', [modelInfo('deepseek', 'deepseek-reasoner', { inputPricePer1k: 0.0005, outputPricePer1k: 0.002 })]), adapter: adapter('deepseek', fallbackRequests) },
      ],
      reasoningMode: 'deep',
    });

    const result = await h.run();

    expect(capableRequests.length).toBeGreaterThan(0);
    expect(capableRequests[0].reasoning?.control).toBe('anthropic-effort');
    expect(fallbackRequests.length).toBeGreaterThan(0);
    for (const request of fallbackRequests) {
      expect(request.reasoning).toBeUndefined();
    }
    expect(result.modelUsed).toBe('deepseek/deepseek-reasoner');
    expect(result.reasoning).toMatchObject({ model: 'deepseek/deepseek-reasoner', outcome: 'not-sent' });
  });
});

describe('a setting value nobody declared is treated as auto', () => {
  it('resolves through the auto table rather than trusting the string', async () => {
    const requests: CompletionRequest[] = [];
    const h = harness({
      providers: [{ config: providerConfig('anthropic', [modelInfo('anthropic', 'claude-opus-5-5', { reasoningControl: 'anthropic-effort' })]), adapter: adapter('anthropic', requests) }],
      reasoningMode: 'maximum-overdrive',
    });

    const result = await h.run();

    expect(result.reasoning?.preference).toBe('auto');
    expect(result.reasoning?.levelRule).toMatch(/^auto-/);
  });
});
