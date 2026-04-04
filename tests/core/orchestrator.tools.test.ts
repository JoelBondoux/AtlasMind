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
    upsertMemory: vi.fn(),
    readFile: vi.fn().mockResolvedValue('contents'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    findFiles: vi.fn().mockResolvedValue([]),
    searchInFiles: vi.fn().mockResolvedValue([]),
    listDirectory: vi.fn().mockResolvedValue([]),
    runCommand: vi.fn().mockResolvedValue({ ok: true, exitCode: 0, stdout: '', stderr: '' }),
    getGitStatus: vi.fn().mockResolvedValue(''),
    getGitDiff: vi.fn().mockResolvedValue(''),
    applyGitPatch: vi.fn().mockResolvedValue({ ok: true, stdout: '', stderr: '' }),
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

function makeOrchestrator(
  provider: ProviderAdapter,
  skills: SkillDefinition[],
  skillContext: SkillExecutionContext,
  toolWebhookDispatcher?: { emit: (payload: unknown) => Promise<void> },
  agentsList: AgentDefinition[] = [],
  disabledAgentIds: string[] = [],
  toolApprovalGate?: (toolName: string, args: Record<string, unknown>) => Promise<{ approved: boolean; reason?: string }>,
): Orchestrator {
  const agents = new AgentRegistry();
  const skillsRegistry = new SkillsRegistry();
  const router = new ModelRouter();
  const memory = new MemoryManager();
  const costs = new CostTracker();
  const providers = new ProviderRegistry();
  const taskProfiler = new TaskProfiler();

  router.registerProvider({
    id: 'local',
    displayName: 'Local',
    apiKeySettingKey: '',
    enabled: true,
    models: [
      {
        id: 'local/echo-1',
        provider: 'local',
        name: 'Local Echo',
        contextWindow: 4096,
        inputPricePer1k: 0.01,
        outputPricePer1k: 0.01,
        capabilities: ['chat', 'code'],
        enabled: true,
      },
    ],
  });

  providers.register(provider);
  for (const agent of agentsList) {
    agents.register(agent);
  }
  agents.setDisabledIds(disabledAgentIds);
  for (const skill of skills) {
    skillsRegistry.register(skill);
  }

  return new Orchestrator(
    agents,
    skillsRegistry,
    router,
    memory,
    costs,
    providers,
    skillContext,
    taskProfiler,
    toolWebhookDispatcher as never,
    toolApprovalGate,
  );
}

describe('Orchestrator agentic loop', () => {
  it('returns a direct response when no tool calls are made', async () => {
    const directResponse: CompletionResponse = {
      content: 'Hello from the model.',
      model: 'local/echo-1',
      inputTokens: 10,
      outputTokens: 8,
      finishReason: 'stop',
    };
    const provider = makeMockProvider([directResponse]);
    const orchestrator = makeOrchestrator(provider, [], makeSkillContext());

    const result = await orchestrator.processTask({
      id: 'task-1',
      userMessage: 'Hello',
      context: {},
      constraints: { budget: 'balanced', speed: 'balanced' },
      timestamp: new Date().toISOString(),
    });

    expect(result.response).toBe('Hello from the model.');
  });

  it('executes a tool call and feeds the result back to the model', async () => {
    const skillHandler = vi.fn().mockResolvedValue('the file contents');
    const mockSkill: SkillDefinition = {
      id: 'file-read',
      name: 'Read File',
      description: 'Read a file',
      parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
      execute: skillHandler,
    };

    const responses: CompletionResponse[] = [
      {
        content: '',
        model: 'local/echo-1',
        inputTokens: 10,
        outputTokens: 5,
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'call-1', name: 'file-read', arguments: { path: '/workspace/foo.ts' } }],
      },
      {
        content: 'Here is a summary of the file.',
        model: 'local/echo-1',
        inputTokens: 20,
        outputTokens: 12,
        finishReason: 'stop',
      },
    ];

    const provider = makeMockProvider(responses);
    const skillContext = makeSkillContext();
    const orchestrator = makeOrchestrator(provider, [mockSkill], skillContext);

    const result = await orchestrator.processTask({
      id: 'task-2',
      userMessage: 'Summarise foo.ts',
      context: {},
      constraints: { budget: 'balanced', speed: 'balanced' },
      timestamp: new Date().toISOString(),
    });

    expect(skillHandler).toHaveBeenCalledOnce();
    expect(skillHandler).toHaveBeenCalledWith(
      { path: '/workspace/foo.ts' },
      skillContext,
    );
    expect(provider.complete).toHaveBeenCalledTimes(2);
    expect(result.response).toBe('Here is a summary of the file.');
  });

  it('caps the agentic loop at MAX_TOOL_ITERATIONS', async () => {
    const infiniteToolCall: CompletionResponse = {
      content: '',
      model: 'local/echo-1',
      inputTokens: 5,
      outputTokens: 2,
      finishReason: 'tool_calls',
      toolCalls: [{ id: 'c', name: 'unknown-tool', arguments: {} }],
    };
    // Provider always returns a tool call — loop must terminate on its own
    const provider = makeMockProvider([infiniteToolCall]);
    const orchestrator = makeOrchestrator(provider, [], makeSkillContext());

    const result = await orchestrator.processTask({
      id: 'task-3',
      userMessage: 'Loop forever',
      context: {},
      constraints: { budget: 'balanced', speed: 'balanced' },
      timestamp: new Date().toISOString(),
    });

    // Should stop at MAX_TOOL_ITERATIONS (10), not run indefinitely
    expect((provider.complete as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(10);
    expect(result.response).toContain('safety limit of 10 tool iterations');
  });

  it('retries transient provider failures and succeeds', async () => {
    let calls = 0;
    const provider: ProviderAdapter = {
      providerId: 'local',
      complete: vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          const err = new Error('temporarily unavailable');
          (err as Error & { status?: number }).status = 503;
          throw err;
        }
        return {
          content: 'Recovered after retry.',
          model: 'local/echo-1',
          inputTokens: 10,
          outputTokens: 5,
          finishReason: 'stop',
        } satisfies CompletionResponse;
      }),
      listModels: vi.fn().mockResolvedValue(['local/echo-1']),
      healthCheck: vi.fn().mockResolvedValue(true),
    };

    const orchestrator = makeOrchestrator(provider, [], makeSkillContext());
    const result = await orchestrator.processTask({
      id: 'task-retry',
      userMessage: 'hello',
      context: {},
      constraints: { budget: 'balanced', speed: 'balanced' },
      timestamp: new Date().toISOString(),
    });

    expect(provider.complete).toHaveBeenCalledTimes(2);
    expect(result.response).toBe('Recovered after retry.');
  });

  it('selects the most relevant enabled agent instead of first registered', async () => {
    const provider = makeMockProvider([
      {
        content: 'Architect response',
        model: 'local/echo-1',
        inputTokens: 12,
        outputTokens: 8,
        finishReason: 'stop',
      },
    ]);

    const orchestrator = makeOrchestrator(
      provider,
      [],
      makeSkillContext(),
      undefined,
      [
        {
          id: 'tester',
          name: 'Tester',
          role: 'qa engineer',
          description: 'focus on test coverage and edge cases',
          systemPrompt: 'You test code.',
          skills: [],
        },
        {
          id: 'architect',
          name: 'Architect',
          role: 'software architect',
          description: 'design system architecture and scalability',
          systemPrompt: 'You design systems.',
          skills: [],
        },
      ],
    );

    const result = await orchestrator.processTask({
      id: 'task-agent-selection',
      userMessage: 'Design scalable architecture for this service.',
      context: {},
      constraints: { budget: 'balanced', speed: 'balanced' },
      timestamp: new Date().toISOString(),
    });

    expect(result.agentId).toBe('architect');
  });

  it('ignores disabled agents during selection', async () => {
    const provider = makeMockProvider([
      {
        content: 'Fallback enabled agent response',
        model: 'local/echo-1',
        inputTokens: 10,
        outputTokens: 6,
        finishReason: 'stop',
      },
    ]);

    const orchestrator = makeOrchestrator(
      provider,
      [],
      makeSkillContext(),
      undefined,
      [
        {
          id: 'architect',
          name: 'Architect',
          role: 'software architect',
          description: 'design architecture',
          systemPrompt: 'You design systems.',
          skills: [],
        },
        {
          id: 'general',
          name: 'General',
          role: 'general assistant',
          description: 'handles broad requests',
          systemPrompt: 'You are helpful.',
          skills: [],
        },
      ],
      ['architect'],
    );

    const result = await orchestrator.processTask({
      id: 'task-disabled-agent',
      userMessage: 'Design architecture for this service.',
      context: {},
      constraints: { budget: 'balanced', speed: 'balanced' },
      timestamp: new Date().toISOString(),
    });

    expect(result.agentId).toBe('general');
  });

  it('stops execution when cumulative estimated cost exceeds budget cap', async () => {
    const provider = makeMockProvider([
      {
        content: '',
        model: 'local/echo-1',
        inputTokens: 100,
        outputTokens: 100,
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'call-1', name: 'missing-tool', arguments: {} }],
      },
    ]);

    const orchestrator = makeOrchestrator(provider, [], makeSkillContext());
    const result = await orchestrator.processTask({
      id: 'task-budget-cap',
      userMessage: 'trigger expensive loop',
      context: {},
      constraints: { budget: 'balanced', speed: 'balanced', maxCostUsd: 0.001 },
      timestamp: new Date().toISOString(),
    });

    expect(result.response).toContain('exceeded the configured budget cap');
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });

  it('emits started and completed webhook events for successful tool calls', async () => {
    const skillHandler = vi.fn().mockResolvedValue('ok');
    const mockSkill: SkillDefinition = {
      id: 'file-read',
      name: 'Read File',
      description: 'Read a file',
      parameters: { type: 'object' },
      execute: skillHandler,
    };

    const provider = makeMockProvider([
      {
        content: '',
        model: 'local/echo-1',
        inputTokens: 8,
        outputTokens: 3,
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'call-1', name: 'file-read', arguments: { path: '/workspace/x.ts' } }],
      },
      {
        content: 'done',
        model: 'local/echo-1',
        inputTokens: 12,
        outputTokens: 6,
        finishReason: 'stop',
      },
    ]);

    const emit = vi.fn().mockResolvedValue(undefined);
    const orchestrator = makeOrchestrator(
      provider,
      [mockSkill],
      makeSkillContext(),
      { emit },
    );

    await orchestrator.processTask({
      id: 'task-webhook-success',
      userMessage: 'Use tool',
      context: {},
      constraints: { budget: 'balanced', speed: 'balanced' },
      timestamp: new Date().toISOString(),
    });

    const events = emit.mock.calls.map(([payload]) => (payload as { event: string }).event);
    expect(events).toContain('tool.started');
    expect(events).toContain('tool.completed');
  });

  it('emits failed webhook events for unknown tools', async () => {
    const provider = makeMockProvider([
      {
        content: '',
        model: 'local/echo-1',
        inputTokens: 8,
        outputTokens: 3,
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'call-unknown', name: 'missing-tool', arguments: {} }],
      },
      {
        content: 'done',
        model: 'local/echo-1',
        inputTokens: 12,
        outputTokens: 6,
        finishReason: 'stop',
      },
    ]);

    const emit = vi.fn().mockResolvedValue(undefined);
    const orchestrator = makeOrchestrator(
      provider,
      [],
      makeSkillContext(),
      { emit },
    );

    await orchestrator.processTask({
      id: 'task-webhook-fail',
      userMessage: 'Use missing tool',
      context: {},
      constraints: { budget: 'balanced', speed: 'balanced' },
      timestamp: new Date().toISOString(),
    });

    const events = emit.mock.calls.map(([payload]) => (payload as { event: string }).event);
    expect(events).toContain('tool.started');
    expect(events).toContain('tool.failed');
  });

  it('does not execute a tool when approval is denied', async () => {
    const skillHandler = vi.fn().mockResolvedValue('should not run');
    const mockSkill: SkillDefinition = {
      id: 'file-write',
      name: 'Write File',
      description: 'Write a file',
      parameters: {
        type: 'object',
        required: ['path', 'content'],
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
      },
      execute: skillHandler,
    };

    const provider = makeMockProvider([
      {
        content: '',
        model: 'local/echo-1',
        inputTokens: 8,
        outputTokens: 3,
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'call-write', name: 'file-write', arguments: { path: '/workspace/a.ts', content: 'x' } }],
      },
      {
        content: 'Write denied.',
        model: 'local/echo-1',
        inputTokens: 12,
        outputTokens: 6,
        finishReason: 'stop',
      },
    ]);

    const orchestrator = makeOrchestrator(
      provider,
      [mockSkill],
      makeSkillContext(),
      undefined,
      [],
      [],
      vi.fn().mockResolvedValue({ approved: false, reason: 'Denied by test policy.' }),
    );

    await orchestrator.processTask({
      id: 'task-denied-tool',
      userMessage: 'Write a file',
      context: {},
      constraints: { budget: 'balanced', speed: 'balanced' },
      timestamp: new Date().toISOString(),
    });

    expect(skillHandler).not.toHaveBeenCalled();
  });
});
