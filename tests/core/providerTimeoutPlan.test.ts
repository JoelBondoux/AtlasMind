/**
 * A hosted attempt's budget scales with the output it is planned to write.
 *
 * The defect this pins: hosted providers had a flat 30s budget while a deep
 * reasoning turn asks for ~27k output tokens, most of them thinking generated
 * before anything visible arrives — so a working model was recorded as a
 * timeout and a failover was spent on the next one at the same depth.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import {
  HOSTED_STREAM_CEILING_RULE,
  Orchestrator,
  PROVIDER_TIMEOUT_RULES,
  ProviderTimeoutError,
  getProviderTimeoutMs,
  planProviderTimeout,
  summarizeAttemptFailures,
  usesStreamInactivityBudget,
  withInactivityTimeout,
} from '../../src/core/orchestrator.ts';
import {
  ACP_PROVIDER_TIMEOUT_MS,
  HOSTED_PROVIDER_MAX_TIMEOUT_MS,
  HOSTED_STREAM_CEILING_MS,
  HOSTED_TIMEOUT_COVERED_OUTPUT_TOKENS,
  HOSTED_TIMEOUT_MS_PER_1K_OUTPUT_TOKENS,
} from '../../src/constants.ts';
import { REASONING_LEVEL_COSTS, REASONING_REPLY_ROOM_TOKENS } from '../../src/core/reasoningBudget.ts';
import { AgentRegistry } from '../../src/core/agentRegistry.ts';
import { SkillsRegistry } from '../../src/core/skillsRegistry.ts';
import { ModelRouter } from '../../src/core/modelRouter.ts';
import { MemoryManager } from '../../src/memory/memoryManager.ts';
import { CostTracker } from '../../src/core/costTracker.ts';
import { ProviderRegistry } from '../../src/providers/index.ts';
import { TaskProfiler } from '../../src/core/taskProfiler.ts';
import type { CompletionRequest, CompletionResponse, ProviderAdapter } from '../../src/providers/adapter.ts';
import type { ModelInfo, SkillExecutionContext, TaskModelAttempt } from '../../src/types.ts';

const DEEP_MAX_TOKENS = REASONING_LEVEL_COSTS.deep.projectedThinkingTokens + REASONING_REPLY_ROOM_TOKENS;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the planning table', () => {
  it('keeps the flat base for a hosted call inside the covered output', () => {
    const plan = planProviderTimeout('anthropic', 30_000, 'anthropic/claude-opus-5-5', { outputTokens: 1_024 });
    expect(plan).toMatchObject({ timeoutMs: 30_000, rule: 'hosted-flat' });
    expect(planProviderTimeout('openai', 30_000, 'openai/gpt-5.5', { outputTokens: HOSTED_TIMEOUT_COVERED_OUTPUT_TOKENS }).timeoutMs).toBe(30_000);
  });

  it('keeps the flat base when the planned output is not known', () => {
    expect(planProviderTimeout('anthropic', 30_000, 'anthropic/claude-opus-5-5')).toMatchObject({ timeoutMs: 30_000, rule: 'hosted-flat' });
    expect(planProviderTimeout('anthropic', 30_000, undefined, { outputTokens: Number.NaN }).timeoutMs).toBe(30_000);
  });

  it.each([
    ['minimal', REASONING_LEVEL_COSTS.minimal.projectedThinkingTokens + REASONING_REPLY_ROOM_TOKENS],
    ['standard', REASONING_LEVEL_COSTS.standard.projectedThinkingTokens + REASONING_REPLY_ROOM_TOKENS],
    ['deep', DEEP_MAX_TOKENS],
  ])('sizes a %s reasoning turn from its max_tokens', (_level, maxTokens) => {
    const plan = planProviderTimeout('anthropic', 30_000, 'anthropic/claude-opus-5-5', { outputTokens: maxTokens });
    const excess = Math.max(0, maxTokens - HOSTED_TIMEOUT_COVERED_OUTPUT_TOKENS);
    expect(plan.timeoutMs).toBe(30_000 + Math.round((excess / 1000) * HOSTED_TIMEOUT_MS_PER_1K_OUTPUT_TOKENS));
  });

  it('gives a deep turn several minutes, named by its rule', () => {
    // 26,976 planned tokens: 22,880 above the covered 4,096 at 20s per 1k.
    const plan = planProviderTimeout('anthropic', 30_000, 'anthropic/claude-opus-5-5', { outputTokens: DEEP_MAX_TOKENS });
    expect(plan.timeoutMs).toBe(30_000 + 457_600);
    expect(plan.rule).toBe('hosted-output-allowance');
    expect(plan.describes).toContain('rule hosted-output-allowance');
    expect(plan.describes).toContain('26,976 planned output tokens');
    expect(plan.describes).toContain('= 487600ms');
  });

  it('caps the allowance and says so', () => {
    const plan = planProviderTimeout('anthropic', 30_000, 'anthropic/claude-fable-5-1', { outputTokens: 128_000 });
    expect(plan).toMatchObject({ timeoutMs: HOSTED_PROVIDER_MAX_TIMEOUT_MS, rule: 'hosted-output-capped' });
    expect(plan.describes).toContain(PROVIDER_TIMEOUT_RULES['hosted-output-capped']);
  });

  it('never goes below a configured base above the ceiling', () => {
    expect(planProviderTimeout('openai', 900_000, 'openai/gpt-5.5', { outputTokens: 128_000 }).timeoutMs).toBe(900_000);
  });

  it('leaves the ACP and local rules as they were', () => {
    expect(planProviderTimeout('acp', 30_000, 'acp/claude', { outputTokens: DEEP_MAX_TOKENS })).toMatchObject({ timeoutMs: ACP_PROVIDER_TIMEOUT_MS, rule: 'acp-enclosing' });
    expect(planProviderTimeout('local', 30_000, 'local/ollama@@mystery', { outputTokens: DEEP_MAX_TOKENS, warmedUp: true })).toMatchObject({ timeoutMs: 30_000, rule: 'local-scaled' });
  });

  it('getProviderTimeoutMs is the plan\'s number', () => {
    expect(getProviderTimeoutMs('anthropic', 30_000, 'anthropic/x', { outputTokens: DEEP_MAX_TOKENS }))
      .toBe(planProviderTimeout('anthropic', 30_000, 'anthropic/x', { outputTokens: DEEP_MAX_TOKENS }).timeoutMs);
  });

  it('every rule has a sentence', () => {
    for (const sentence of Object.values(PROVIDER_TIMEOUT_RULES)) {
      expect(sentence.length).toBeGreaterThan(10);
    }
  });
});

describe('properties of the hosted rule', () => {
  const base = fc.integer({ min: 5_000, max: 900_000 });
  const output = fc.integer({ min: 0, max: 200_000 });

  it('never narrows below the configured base', () => {
    fc.assert(fc.property(base, output, (b, o) => {
      expect(planProviderTimeout('anthropic', b, 'anthropic/m', { outputTokens: o }).timeoutMs).toBeGreaterThanOrEqual(b);
    }));
  });

  it('is monotonic in planned output', () => {
    fc.assert(fc.property(base, output, output, (b, o1, o2) => {
      const [lo, hi] = o1 <= o2 ? [o1, o2] : [o2, o1];
      expect(planProviderTimeout('openai', b, 'openai/m', { outputTokens: lo }).timeoutMs)
        .toBeLessThanOrEqual(planProviderTimeout('openai', b, 'openai/m', { outputTokens: hi }).timeoutMs);
    }));
  });

  it('never exceeds the ceiling unless the base already does', () => {
    fc.assert(fc.property(base, output, (b, o) => {
      expect(planProviderTimeout('google', b, 'google/m', { outputTokens: o }).timeoutMs).toBeLessThanOrEqual(Math.max(b, HOSTED_PROVIDER_MAX_TIMEOUT_MS));
    }));
  });
});

describe('streamed attempts use an inactivity budget', () => {
  it('only for hosted providers', () => {
    expect(usesStreamInactivityBudget('anthropic')).toBe(true);
    expect(usesStreamInactivityBudget('openai')).toBe(true);
    expect(usesStreamInactivityBudget('acp')).toBe(false);
    expect(usesStreamInactivityBudget('local')).toBe(false);
  });

  it('restarts on every touch and fails only after a silence', async () => {
    vi.useFakeTimers();
    let touch: () => void = () => {};
    let resolveWork: (value: string) => void = () => {};
    const outcome = withInactivityTimeout(
      t => { touch = t; return new Promise<string>(resolve => { resolveWork = resolve; }); },
      1_000,
      60_000,
      () => new Error('idle timed out'),
      () => new Error('ceiling timed out'),
    );
    for (let i = 0; i < 10; i += 1) {
      await vi.advanceTimersByTimeAsync(900);
      touch();
    }
    resolveWork('done');
    await expect(outcome).resolves.toBe('done');
  });

  it('times out after a silence longer than the budget', async () => {
    vi.useFakeTimers();
    const outcome = withInactivityTimeout(
      () => new Promise<string>(() => {}),
      1_000,
      60_000,
      () => new Error('idle timed out'),
      () => new Error('ceiling timed out'),
    );
    const settled = expect(outcome).rejects.toThrow('idle timed out');
    await vi.advanceTimersByTimeAsync(1_001);
    await settled;
  });

  it('hits the ceiling when the stream never ends, however busy', async () => {
    vi.useFakeTimers();
    let touch: () => void = () => {};
    const outcome = withInactivityTimeout(
      t => { touch = t; return new Promise<string>(() => {}); },
      1_000,
      5_000,
      () => new Error('idle timed out'),
      () => new Error('ceiling timed out'),
    );
    const settled = expect(outcome).rejects.toThrow('ceiling timed out');
    for (let i = 0; i < 6; i += 1) {
      await vi.advanceTimersByTimeAsync(900);
      touch();
    }
    await settled;
  });
});

describe('the timeout error names its budget and still reads as a timeout', () => {
  it('composes a message every existing classifier recognises', () => {
    for (const kind of ['total', 'inactivity', 'stream-ceiling'] as const) {
      const error = new ProviderTimeoutError(30_000, 'rule hosted-flat: x', kind);
      expect(error.message).toMatch(/\btimed out\b/);
      expect(error.message).toContain('rule hosted-flat');
    }
    expect(HOSTED_STREAM_CEILING_RULE).toContain('hosted-stream-ceiling');
  });

  it('puts the budget on the failure line', () => {
    const attempts: TaskModelAttempt[] = [{
      model: 'anthropic/claude-opus-5-5',
      providerId: 'anthropic',
      endpointScope: 'provider:anthropic',
      status: 'timeout',
      durationMs: 487_600,
      inputTokens: 0,
      outputTokens: 0,
      timeoutBudget: 'rule hosted-output-allowance: 30000ms base + 457600ms for 26,976 planned output tokens = 487600ms',
    }];
    expect(summarizeAttemptFailures(attempts).lines[0]).toContain('(budget rule hosted-output-allowance');
  });
});

// ── End to end through the orchestrator ──────────────────────────────

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

function opus(): ModelInfo {
  return {
    id: 'anthropic/claude-opus-5-5',
    provider: 'anthropic',
    name: 'claude-opus-5-5',
    contextWindow: 1_000_000,
    inputPricePer1k: 0.004,
    outputPricePer1k: 0.02,
    capabilities: ['chat', 'code', 'reasoning'],
    reasoningDepth: 3,
    reasoningControl: 'anthropic-effort',
    enabled: true,
  };
}

function orchestratorWith(adapter: ProviderAdapter, reasoningMode: string): Orchestrator {
  const agents = new AgentRegistry();
  agents.register({ id: 'default', name: 'Default', role: 'general assistant', description: 'Fallback.', systemPrompt: 'You are helpful.', skills: [] });
  const router = new ModelRouter();
  router.registerProvider({ id: 'anthropic', displayName: 'anthropic', apiKeySettingKey: '', enabled: true, pricingModel: 'pay-per-token', models: [opus()] });
  const registry = new ProviderRegistry();
  registry.register(adapter);
  return new Orchestrator(
    agents,
    new SkillsRegistry(),
    router,
    new MemoryManager(),
    new CostTracker(),
    registry,
    skillContext(),
    new TaskProfiler(),
    undefined,
    { emit: vi.fn() } as any,
    {
      toolApprovalGate: async () => ({ approved: true }),
      readSetting: <T,>(key: string, fallback: T): T => (key === 'reasoningMode' ? reasoningMode as unknown as T : fallback),
    },
    { maxToolIterations: 3, maxToolCallsPerTurn: 3, toolExecutionTimeoutMs: 10_000, providerTimeoutMs: 30_000 },
  );
}

function run(orchestrator: Orchestrator, onTextChunk?: (chunk: string) => void) {
  return orchestrator.processTask({
    id: 'task-timeout-plan',
    userMessage: 'Explain what a closure is in one sentence.',
    context: {},
    constraints: { budget: 'expensive', speed: 'considered' },
    timestamp: new Date().toISOString(),
  }, onTextChunk);
}

describe('the orchestrator arms the planned budget', () => {
  it('lets a deep turn think past the old 30s, then fails it over with the rule named', async () => {
    vi.useFakeTimers();
    const requests: CompletionRequest[] = [];
    const adapter: ProviderAdapter = {
      providerId: 'anthropic',
      complete: vi.fn((request: CompletionRequest) => { requests.push(request); return new Promise<CompletionResponse>(() => {}); }),
      listModels: vi.fn().mockResolvedValue([]),
      healthCheck: vi.fn().mockResolvedValue(true),
    };
    let settled = false;
    const pending = run(orchestratorWith(adapter, 'deep')).finally(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(31_000);
    expect(requests).toHaveLength(1);
    expect(requests[0].maxTokens).toBe(DEEP_MAX_TOKENS);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(487_600);
    const result = await pending;
    const attempt = result.modelAttempts?.find(entry => entry.status === 'timeout');
    expect(attempt?.timeoutBudget).toContain('rule hosted-output-allowance');
    expect(result.response).toContain('budget rule hosted-output-allowance');
  });

  it('keeps a streaming answer alive while chunks arrive, past the total it would have had', async () => {
    vi.useFakeTimers();
    const adapter: ProviderAdapter = {
      providerId: 'anthropic',
      complete: vi.fn(),
      streamComplete: vi.fn(async (request: CompletionRequest, onChunk: (chunk: string) => void): Promise<CompletionResponse> => {
        // Twenty chunks, 20s apart: 400s in total, never silent for 30s.
        for (let i = 0; i < 20; i += 1) {
          await new Promise(resolve => setTimeout(resolve, 20_000));
          onChunk('word ');
        }
        return { content: 'word '.repeat(20).trim(), model: request.model, inputTokens: 10, outputTokens: 20, finishReason: 'stop' };
      }),
      listModels: vi.fn().mockResolvedValue([]),
      healthCheck: vi.fn().mockResolvedValue(true),
    };
    const chunks: string[] = [];
    const pending = run(orchestratorWith(adapter, 'minimal'), chunk => chunks.push(chunk));
    await vi.advanceTimersByTimeAsync(20 * 20_000 + 1_000);
    const result = await pending;
    expect(result.modelAttempts?.some(entry => entry.status === 'timeout')).toBe(false);
    expect(adapter.streamComplete).toHaveBeenCalledTimes(1);
    expect(result.response).toContain('word');
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('fails a silent stream after the planned budget, as an inactivity timeout', async () => {
    vi.useFakeTimers();
    const adapter: ProviderAdapter = {
      providerId: 'anthropic',
      complete: vi.fn(),
      streamComplete: vi.fn(() => new Promise<CompletionResponse>(() => {})),
      listModels: vi.fn().mockResolvedValue([]),
      healthCheck: vi.fn().mockResolvedValue(true),
    };
    const pending = run(orchestratorWith(adapter, 'minimal'), () => {});
    await vi.advanceTimersByTimeAsync(HOSTED_STREAM_CEILING_MS);
    const result = await pending;
    const attempt = result.modelAttempts?.find(entry => entry.status === 'timeout');
    expect(attempt?.reason).toContain('with nothing streamed');
    expect(attempt?.timeoutBudget).toMatch(/rule hosted-/);
  });
});
