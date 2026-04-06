import * as vscode from 'vscode';
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
import type { AgentDefinition, MemoryEntry, ModelCapability, SkillDefinition, SkillExecutionContext } from '../../src/types.ts';

function makeSkillContext(overrides: Partial<SkillExecutionContext> = {}): SkillExecutionContext {
  return {
    workspaceRootPath: '/workspace',
    queryMemory: vi.fn().mockResolvedValue([]),
    upsertMemory: vi.fn().mockReturnValue({ status: 'created' }),
    deleteMemory: vi.fn().mockResolvedValue(true),
    readFile: vi.fn().mockResolvedValue('contents'),
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
    getCodeActions: vi.fn().mockResolvedValue([]),
    applyCodeAction: vi.fn().mockResolvedValue({ applied: true }),
    getTerminalOutput: vi.fn().mockResolvedValue(''),
    getInstalledExtensions: vi.fn().mockResolvedValue([]),
    getPortForwards: vi.fn().mockResolvedValue([]),
    getTestResults: vi.fn().mockResolvedValue([]),
    getActiveDebugSession: vi.fn().mockResolvedValue(null),
    listTerminals: vi.fn().mockResolvedValue([]),
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
  toolApprovalGate?: (taskId: string, toolName: string, args: Record<string, unknown>) => Promise<{ approved: boolean; reason?: string }>,
  writeCheckpointHook?: (taskId: string, toolName: string, args: Record<string, unknown>) => Promise<void>,
  postToolVerifier?: (
    invocations: Array<{ toolName: string; args: Record<string, unknown>; result: string }>,
  ) => Promise<string | undefined>,
  options?: {
    modelCapabilities?: ModelCapability[];
    contextWindow?: number;
    memoryEntries?: MemoryEntry[];
    extraProviders?: Array<{
      providerId: string;
      adapter: ProviderAdapter;
      models: Array<{
        id: string;
        name: string;
        contextWindow: number;
        inputPricePer1k: number;
        outputPricePer1k: number;
        capabilities: ModelCapability[];
      }>;
    }>;
  },
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
        contextWindow: options?.contextWindow ?? 4096,
        inputPricePer1k: 0.01,
        outputPricePer1k: 0.01,
        capabilities: options?.modelCapabilities ?? ['chat', 'code'],
        enabled: true,
      },
    ],
  });

  providers.register(provider);
  for (const extraProvider of options?.extraProviders ?? []) {
    router.registerProvider({
      id: extraProvider.providerId,
      displayName: extraProvider.providerId,
      apiKeySettingKey: '',
      enabled: true,
      models: extraProvider.models.map(model => ({
        ...model,
        provider: extraProvider.providerId,
        enabled: true,
      })),
    });
    providers.register(extraProvider.adapter);
  }
  for (const entry of options?.memoryEntries ?? []) {
    memory.upsert(entry, entry.snippet);
  }
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
    { toolApprovalGate, writeCheckpointHook, postToolVerifier },
  );
}

describe('Orchestrator agentic loop', () => {
  it('answers workspace version questions from package.json without calling a model', async () => {
    const provider = makeMockProvider([{
      content: 'should not be used',
      model: 'local/echo-1',
      inputTokens: 1,
      outputTokens: 1,
      finishReason: 'stop',
    }]);
    const skillContext = makeSkillContext({
      readFile: vi.fn().mockImplementation(async (targetPath: string) => {
        if (targetPath === '/workspace/package.json') {
          return JSON.stringify({ displayName: 'AtlasMind', version: '0.36.16' });
        }
        return 'contents';
      }),
    });
    const orchestrator = makeOrchestrator(provider, [], skillContext);

    const result = await orchestrator.processTask({
      id: 'task-version',
      userMessage: 'what is the current version',
      context: {},
      constraints: { budget: 'balanced', speed: 'balanced' },
      timestamp: new Date().toISOString(),
    });

    expect(result.response).toBe('AtlasMind version is 0.36.16.');
    expect(result.modelUsed).toBe('workspace/package.json');
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('falls back to SSOT memory when the manifest is unavailable', async () => {
    const provider = makeMockProvider([{
      content: 'should not be used',
      model: 'local/echo-1',
      inputTokens: 1,
      outputTokens: 1,
      finishReason: 'stop',
    }]);
    const skillContext = makeSkillContext({
      readFile: vi.fn().mockRejectedValue(new Error('missing package.json')),
    });
    const orchestrator = makeOrchestrator(provider, [], skillContext, undefined, undefined, undefined, undefined, undefined, undefined, {
      memoryEntries: [{
        path: 'operations/release.md',
        title: 'AtlasMind release 0.36.16',
        tags: ['release'],
        lastModified: '2026-04-05T00:00:00.000Z',
        snippet: 'Current AtlasMind extension version: 0.36.16',
      }],
    });

    const result = await orchestrator.processTask({
      id: 'task-version-memory',
      userMessage: 'what is the current version',
      context: {},
      constraints: { budget: 'balanced', speed: 'balanced' },
      timestamp: new Date().toISOString(),
    });

    expect(result.response).toBe('Based on project memory, the current version is 0.36.16.');
    expect(result.modelUsed).toBe('memory/ssot');
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('fails over to another provider when the first provider errors', async () => {
    const failingProvider: ProviderAdapter = {
      providerId: 'local',
      complete: vi.fn().mockRejectedValue(new Error('socket hang up')),
      listModels: vi.fn().mockResolvedValue(['local/echo-1']),
      healthCheck: vi.fn().mockResolvedValue(true),
    };

    const backupProvider: ProviderAdapter = {
      providerId: 'anthropic',
      complete: vi.fn().mockResolvedValue({
        content: 'Recovered through backup provider.',
        model: 'anthropic/claude-sonnet-4',
        inputTokens: 14,
        outputTokens: 9,
        finishReason: 'stop',
      }),
      listModels: vi.fn().mockResolvedValue(['anthropic/claude-sonnet-4']),
      healthCheck: vi.fn().mockResolvedValue(true),
    };

    const orchestrator = makeOrchestrator(
      failingProvider,
      [],
      makeSkillContext(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        modelCapabilities: ['chat', 'code'],
        extraProviders: [
          {
            providerId: 'anthropic',
            adapter: backupProvider,
            models: [{
              id: 'anthropic/claude-sonnet-4',
              name: 'Claude Sonnet 4',
              contextWindow: 200000,
              inputPricePer1k: 0.003,
              outputPricePer1k: 0.003,
              capabilities: ['chat', 'code', 'reasoning'],
            }],
          },
        ],
      },
    );

    const result = await orchestrator.processTask({
      id: 'task-provider-failover',
      userMessage: 'Give me a gap analysis',
      context: {},
      constraints: { budget: 'balanced', speed: 'balanced' },
      timestamp: new Date().toISOString(),
    });

    expect(failingProvider.complete).toHaveBeenCalledTimes(1);
    expect(backupProvider.complete).toHaveBeenCalledTimes(1);
    expect(result.response).toBe('Recovered through backup provider.');
    expect(result.modelUsed).toContain('local/echo-1 -> anthropic/claude-sonnet-4');
  });

  it('escalates to a stronger model after repeated tool-loop failures', async () => {
    const failingSkill: SkillDefinition = {
      id: 'file-read',
      name: 'Read File',
      description: 'Read a file',
      parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
      execute: vi.fn().mockResolvedValue('Error: file not found'),
    };

    const localProvider: ProviderAdapter = {
      providerId: 'local',
      complete: vi.fn()
        .mockResolvedValueOnce({
          content: '',
          model: 'local/echo-1',
          inputTokens: 10,
          outputTokens: 5,
          finishReason: 'tool_calls',
          toolCalls: [{ id: 'call-1', name: 'file-read', arguments: { path: '/workspace/foo.ts' } }],
        })
        .mockResolvedValueOnce({
          content: '',
          model: 'local/echo-1',
          inputTokens: 10,
          outputTokens: 5,
          finishReason: 'tool_calls',
          toolCalls: [{ id: 'call-2', name: 'file-read', arguments: { path: '/workspace/foo.ts' } }],
        }),
      listModels: vi.fn().mockResolvedValue(['local/echo-1']),
      healthCheck: vi.fn().mockResolvedValue(true),
    };

    const premiumProvider: ProviderAdapter = {
      providerId: 'premium',
      complete: vi.fn().mockResolvedValue({
        content: 'Escalated answer from a stronger model.',
        model: 'premium/reasoner-1',
        inputTokens: 20,
        outputTokens: 10,
        finishReason: 'stop',
      }),
      listModels: vi.fn().mockResolvedValue(['premium/reasoner-1']),
      healthCheck: vi.fn().mockResolvedValue(true),
    };

    const orchestrator = makeOrchestrator(
      localProvider,
      [failingSkill],
      makeSkillContext(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        modelCapabilities: ['chat', 'code', 'function_calling'],
        extraProviders: [
          {
            providerId: 'premium',
            adapter: premiumProvider,
            models: [{
              id: 'premium/reasoner-1',
              name: 'Premium Reasoner',
              contextWindow: 200000,
              inputPricePer1k: 0.01,
              outputPricePer1k: 0.04,
              capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
            }],
          },
        ],
      },
    );

    const result = await orchestrator.processTask({
      id: 'task-escalate',
      userMessage: 'Inspect foo.ts and explain the issue',
      context: {},
      constraints: { budget: 'balanced', speed: 'balanced' },
      timestamp: new Date().toISOString(),
    });

    expect(localProvider.complete).toHaveBeenCalledTimes(2);
    expect(premiumProvider.complete).toHaveBeenCalledTimes(1);
    expect(result.response).toBe('Escalated answer from a stronger model.');
    expect(result.modelUsed).toContain('local/echo-1 -> premium/reasoner-1');
  });

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

  it('continues a truncated non-tool response until the model stops', async () => {
    const provider: ProviderAdapter = {
      providerId: 'local',
      complete: vi.fn()
        .mockResolvedValueOnce({
          content: 'Below is a structured feature gap analysis covering architecture, testing, and developer workflow.',
          model: 'local/echo-1',
          inputTokens: 30,
          outputTokens: 20,
          finishReason: 'length',
        })
        .mockResolvedValueOnce({
          content: 'The highest-priority gap is stronger operational diagnostics and clearer execution-state reporting.',
          model: 'local/echo-1',
          inputTokens: 10,
          outputTokens: 12,
          finishReason: 'stop',
        }),
      listModels: vi.fn().mockResolvedValue(['local/echo-1']),
      healthCheck: vi.fn().mockResolvedValue(true),
    };

    const orchestrator = makeOrchestrator(provider, [], makeSkillContext());
    const result = await orchestrator.processTask({
      id: 'task-truncated-direct-response',
      userMessage: 'Run a feature gap analysis for AtlasMind.',
      context: {},
      constraints: { budget: 'balanced', speed: 'balanced' },
      timestamp: new Date().toISOString(),
    });

    expect(provider.complete).toHaveBeenCalledTimes(2);
    expect(provider.complete).toHaveBeenNthCalledWith(1, expect.objectContaining({ maxTokens: 2400 }));
    expect(provider.complete).toHaveBeenNthCalledWith(2, expect.objectContaining({
      maxTokens: 2400,
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', content: 'Below is a structured feature gap analysis covering architecture, testing, and developer workflow.' }),
        expect.objectContaining({ role: 'user', content: expect.stringContaining('Continue exactly where you left off') }),
      ]),
    }));
    expect(result.response).toBe(
      'Below is a structured feature gap analysis covering architecture, testing, and developer workflow.\n\n' +
      'The highest-priority gap is stronger operational diagnostics and clearer execution-state reporting.',
    );
  });

  it('streams continuation chunks after a truncated response', async () => {
    const provider: ProviderAdapter = {
      providerId: 'local',
      complete: vi.fn().mockImplementation(async () => {
        throw new Error('complete() should not be used when streamComplete is available.');
      }),
      streamComplete: vi.fn()
        .mockImplementationOnce(async (_request: CompletionRequest, onTextChunk: (chunk: string) => void) => {
          onTextChunk('Overall, AtlasMind has a promising orchestration architecture');
          return {
            content: 'Overall, AtlasMind has a promising orchestration architecture',
            model: 'local/echo-1',
            inputTokens: 30,
            outputTokens: 18,
            finishReason: 'length',
          } satisfies CompletionResponse;
        })
        .mockImplementationOnce(async (_request: CompletionRequest, onTextChunk: (chunk: string) => void) => {
          onTextChunk(' but still needs deeper diagnostics and lifecycle observability.');
          return {
            content: 'but still needs deeper diagnostics and lifecycle observability.',
            model: 'local/echo-1',
            inputTokens: 12,
            outputTokens: 10,
            finishReason: 'stop',
          } satisfies CompletionResponse;
        }),
      listModels: vi.fn().mockResolvedValue(['local/echo-1']),
      healthCheck: vi.fn().mockResolvedValue(true),
    };

    const streamedChunks: string[] = [];
    const orchestrator = makeOrchestrator(provider, [], makeSkillContext());
    const result = await orchestrator.processTask({
      id: 'task-streamed-truncated-response',
      userMessage: 'Run a feature gap analysis for AtlasMind.',
      context: {},
      constraints: { budget: 'balanced', speed: 'balanced' },
      timestamp: new Date().toISOString(),
    }, chunk => {
      streamedChunks.push(chunk);
    });

    expect(provider.streamComplete).toHaveBeenCalledTimes(2);
    expect(streamedChunks).toEqual([
      'Overall, AtlasMind has a promising orchestration architecture',
      ' but still needs deeper diagnostics and lifecycle observability.',
    ]);
    expect(result.response).toBe(
      'Overall, AtlasMind has a promising orchestration architecture\n\n' +
      'but still needs deeper diagnostics and lifecycle observability.',
    );
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

  it('returns the final completion after a streamed tool-call preamble', async () => {
    const skillHandler = vi.fn().mockResolvedValue('the file contents');
    const mockSkill: SkillDefinition = {
      id: 'file-read',
      name: 'Read File',
      description: 'Read a file',
      parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
      execute: skillHandler,
    };

    let call = 0;
    const provider: ProviderAdapter = {
      providerId: 'local',
      complete: vi.fn().mockImplementation(async () => {
        throw new Error('complete() should not be used when streamComplete is available.');
      }),
      streamComplete: vi.fn().mockImplementation(async (_request: CompletionRequest, onTextChunk: (chunk: string) => void) => {
        call += 1;
        if (call === 1) {
          onTextChunk('Investigating the workspace.');
          return {
            content: 'Investigating the workspace.',
            model: 'local/echo-1',
            inputTokens: 10,
            outputTokens: 5,
            finishReason: 'tool_calls',
            toolCalls: [{ id: 'call-1', name: 'file-read', arguments: { path: '/workspace/foo.ts' } }],
          } satisfies CompletionResponse;
        }

        return {
          content: 'The final answer is ready.',
          model: 'local/echo-1',
          inputTokens: 20,
          outputTokens: 12,
          finishReason: 'stop',
        } satisfies CompletionResponse;
      }),
      listModels: vi.fn().mockResolvedValue(['local/echo-1']),
      healthCheck: vi.fn().mockResolvedValue(true),
    };

    const streamedChunks: string[] = [];
    const orchestrator = makeOrchestrator(provider, [mockSkill], makeSkillContext());

    const result = await orchestrator.processTask({
      id: 'task-streamed-tool-preamble',
      userMessage: 'Summarise foo.ts',
      context: {},
      constraints: { budget: 'balanced', speed: 'balanced' },
      timestamp: new Date().toISOString(),
    }, chunk => {
      streamedChunks.push(chunk);
    });

    expect(streamedChunks).toEqual(['Investigating the workspace.']);
    expect(provider.streamComplete).toHaveBeenCalledTimes(2);
    expect(result.response).toBe('The final answer is ready.');
  });

  it('passes the task id into the tool approval gate', async () => {
    const skillHandler = vi.fn().mockResolvedValue('the file contents');
    const toolApprovalGate = vi.fn().mockResolvedValue({ approved: true });
    const mockSkill: SkillDefinition = {
      id: 'file-read',
      name: 'Read File',
      description: 'Read a file',
      parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
      execute: skillHandler,
    };

    const provider = makeMockProvider([
      {
        content: '',
        model: 'local/echo-1',
        inputTokens: 10,
        outputTokens: 5,
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'call-1', name: 'file-read', arguments: { path: '/workspace/foo.ts' } }],
      },
      {
        content: 'done',
        model: 'local/echo-1',
        inputTokens: 10,
        outputTokens: 5,
        finishReason: 'stop',
      },
    ]);
    const orchestrator = makeOrchestrator(provider, [mockSkill], makeSkillContext(), undefined, [], [], toolApprovalGate);

    await orchestrator.processTask({
      id: 'task-approval-context',
      userMessage: 'Summarise foo.ts',
      context: {},
      constraints: { budget: 'balanced', speed: 'balanced' },
      timestamp: new Date().toISOString(),
    });

    expect(toolApprovalGate).toHaveBeenCalledWith(
      'task-approval-context',
      'file-read',
      { path: '/workspace/foo.ts' },
    );
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

  it('blocks a task before provider execution when the daily budget has been reached', async () => {
    const provider = makeMockProvider([
      {
        content: 'should not run',
        model: 'local/echo-1',
        inputTokens: 20,
        outputTokens: 20,
        finishReason: 'stop',
      },
    ]);

    const orchestrator = makeOrchestrator(provider, [], makeSkillContext());
    const costs = (orchestrator as unknown as { costs: CostTracker }).costs;
    costs.record({
      taskId: 'spent',
      agentId: 'general',
      model: 'local/echo-1',
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 1,
      timestamp: new Date().toISOString(),
    });

    const getConfigurationSpy = vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
      get: (key: string, fallback?: unknown) => key === 'dailyCostLimitUsd' ? 1 : fallback,
    } as never);

    const result = await orchestrator.processTask({
      id: 'task-daily-budget-cap',
      userMessage: 'Write code',
      context: {},
      constraints: { budget: 'balanced', speed: 'balanced' },
      timestamp: new Date().toISOString(),
    });

    expect(result.response).toContain('New requests are blocked');
    expect(provider.complete).not.toHaveBeenCalled();
    getConfigurationSpy.mockRestore();
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

  it('runs post-write verification once per write batch and appends the summary', async () => {
    const skillHandler = vi.fn().mockResolvedValue('Updated /workspace/file.txt (1 replacement).');
    const verificationHook = vi.fn().mockResolvedValue('PASS: npm run test (exit 0)');
    const providerResponses: CompletionResponse[] = [];
    const provider: ProviderAdapter = {
      providerId: 'local',
      complete: vi.fn((request: CompletionRequest) => {
        providerResponses.push({
          content: '',
          model: request.model,
          inputTokens: 0,
          outputTokens: 0,
          finishReason: 'stop',
        });

        if (providerResponses.length === 1) {
          return Promise.resolve({
            content: '',
            model: 'local/echo-1',
            inputTokens: 8,
            outputTokens: 3,
            finishReason: 'tool_calls',
            toolCalls: [{ id: 'call-edit', name: 'file-edit', arguments: { path: '/workspace/file.txt', search: 'a', replace: 'b' } }],
          });
        }

        return Promise.resolve({
          content: 'Verification reviewed.',
          model: 'local/echo-1',
          inputTokens: 12,
          outputTokens: 6,
          finishReason: 'stop',
        });
      }),
      listModels: vi.fn().mockResolvedValue(['local/echo-1']),
      healthCheck: vi.fn().mockResolvedValue(true),
    };

    const mockSkill: SkillDefinition = {
      id: 'file-edit',
      name: 'Edit File',
      description: 'Edit a file',
      parameters: {
        type: 'object',
        required: ['path', 'search', 'replace'],
        properties: {
          path: { type: 'string' },
          search: { type: 'string' },
          replace: { type: 'string' },
        },
      },
      execute: skillHandler,
    };

    const orchestrator = makeOrchestrator(
      provider,
      [mockSkill],
      makeSkillContext(),
      undefined,
      [],
      [],
      undefined,
      undefined,
      verificationHook,
    );

    const result = await orchestrator.processTask({
      id: 'task-post-verify',
      userMessage: 'Edit the file',
      context: {},
      constraints: { budget: 'balanced', speed: 'balanced' },
      timestamp: new Date().toISOString(),
    });

    expect(result.response).toBe('Verification reviewed.');
    expect(verificationHook).toHaveBeenCalledTimes(1);
    expect(verificationHook).toHaveBeenCalledWith([
      {
        toolName: 'file-edit',
        args: { path: '/workspace/file.txt', search: 'a', replace: 'b' },
        result: 'Updated /workspace/file.txt (1 replacement).',
      },
    ]);

    const secondCall = vi.mocked(provider.complete).mock.calls[1]?.[0];
    expect(secondCall?.messages.at(-1)?.content).toContain('Post-edit verification');
    expect(secondCall?.messages.at(-1)?.content).toContain('PASS: npm run test');
  });

  it('captures a checkpoint before executing a write-capable tool', async () => {
    const checkpointHook = vi.fn().mockResolvedValue(undefined);
    const skillHandler = vi.fn().mockResolvedValue('File written: /workspace/file.txt');
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
        toolCalls: [{ id: 'call-write', name: 'file-write', arguments: { path: '/workspace/file.txt', content: 'x' } }],
      },
      {
        content: 'done',
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
      undefined,
      checkpointHook,
      undefined,
    );

    await orchestrator.processTask({
      id: 'task-checkpoint',
      userMessage: 'Write a file',
      context: {},
      constraints: { budget: 'balanced', speed: 'balanced' },
      timestamp: new Date().toISOString(),
    });

    expect(checkpointHook).toHaveBeenCalledWith(
      'task-checkpoint',
      'file-write',
      { path: '/workspace/file.txt', content: 'x' },
    );
  });

  it('streams agentic loop completions when the provider supports streaming', async () => {
    const chunks: string[] = [];
    const provider: ProviderAdapter = {
      providerId: 'local',
      complete: vi.fn().mockResolvedValue({
        content: 'fallback',
        model: 'local/echo-1',
        inputTokens: 1,
        outputTokens: 1,
        finishReason: 'stop',
      }),
      streamComplete: vi.fn(async (_request, onTextChunk) => {
        onTextChunk('Working ');
        onTextChunk('through it');
        return {
          content: 'Working through it',
          model: 'local/echo-1',
          inputTokens: 9,
          outputTokens: 4,
          finishReason: 'stop',
        };
      }),
      listModels: vi.fn().mockResolvedValue(['local/echo-1']),
      healthCheck: vi.fn().mockResolvedValue(true),
    };

    const orchestrator = makeOrchestrator(provider, [], makeSkillContext());
    const result = await orchestrator.processTask({
      id: 'task-streaming',
      userMessage: 'Stream this response',
      context: {},
      constraints: { budget: 'balanced', speed: 'balanced' },
      timestamp: new Date().toISOString(),
    }, chunk => {
      chunks.push(chunk);
    });

    expect(chunks.join('')).toBe('Working through it');
    expect(result.response).toBe('Working through it');
    expect(provider.streamComplete).toHaveBeenCalled();
  });

  it('passes image attachments and compacted context into the provider request', async () => {
    const requests: CompletionRequest[] = [];
    const provider: ProviderAdapter = {
      providerId: 'local',
      complete: vi.fn(async (request: CompletionRequest) => {
        requests.push(request);
        return {
          content: 'Vision response',
          model: 'local/echo-1',
          inputTokens: 25,
          outputTokens: 10,
          finishReason: 'stop',
        } satisfies CompletionResponse;
      }),
      listModels: vi.fn().mockResolvedValue(['local/echo-1']),
      healthCheck: vi.fn().mockResolvedValue(true),
    };

    const longSessionContext = 'session '.repeat(300);
    const memoryEntries: MemoryEntry[] = Array.from({ length: 5 }, (_, index) => ({
      title: `Vision memory ${index + 1}`,
      path: `project_memory/vision-${index + 1}.md`,
      snippet: `analyze screenshots vision context ${index + 1} ` + 'detail '.repeat(80),
      tags: ['vision', 'screenshots'],
    }));

    const orchestrator = makeOrchestrator(
      provider,
      [],
      makeSkillContext(),
      undefined,
      [],
      [],
      undefined,
      undefined,
      undefined,
      {
        modelCapabilities: ['chat', 'code', 'vision'],
        contextWindow: 1200,
        memoryEntries,
      },
    );

    await orchestrator.processTask({
      id: 'task-images',
      userMessage: 'Analyze these screenshots',
      context: {
        sessionContext: longSessionContext,
        workstationContext: 'Workstation context:\n- Host OS: Windows.\n- Preferred terminal in VS Code: PowerShell.\n- When suggesting commands, default to PowerShell syntax, Windows paths, and VS Code terminal usage unless the user asks for another shell or platform.',
        imageAttachments: [{ source: 'media/mockup.png', mimeType: 'image/png', dataBase64: 'abc123' }],
      },
      constraints: { budget: 'balanced', speed: 'balanced', requiredCapabilities: ['vision'] },
      timestamp: new Date().toISOString(),
    });

    const request = requests[0];
    expect(request).toBeDefined();
    expect(request?.messages[0]?.content).toContain('User-attached images:');
    expect(request?.messages[0]?.content).toContain('media/mockup.png (image/png)');
    expect(request?.messages[0]?.content).toContain('Relevant project memory:');
    expect(request?.messages[0]?.content).toContain('Vision memory 1');
    expect(request?.messages[0]?.content).toContain('Recent session context:');
    expect(request?.messages[0]?.content).toContain('Workstation context:');
    expect(request?.messages[0]?.content).toContain('Preferred terminal in VS Code: PowerShell.');
    expect(request?.messages[0]?.content).toContain('…');
    expect(request?.messages[1]).toMatchObject({
      role: 'user',
      content: 'Analyze these screenshots',
      images: [{ source: 'media/mockup.png', mimeType: 'image/png', dataBase64: 'abc123' }],
    });
  });
});
