import { describe, expect, it, vi } from 'vitest';
import { Orchestrator } from '../../src/core/orchestrator.ts';
import { AgentRegistry } from '../../src/core/agentRegistry.ts';
import { SkillsRegistry } from '../../src/core/skillsRegistry.ts';
import { ModelRouter } from '../../src/core/modelRouter.ts';
import { MemoryManager } from '../../src/memory/memoryManager.ts';
import { CostTracker } from '../../src/core/costTracker.ts';
import { ProviderRegistry } from '../../src/providers/index.ts';
import type { CompletionRequest, CompletionResponse, ProviderAdapter } from '../../src/providers/adapter.ts';
import type { SkillDefinition, SkillExecutionContext } from '../../src/types.ts';

function makeSkillContext(overrides: Partial<SkillExecutionContext> = {}): SkillExecutionContext {
  return {
    workspaceRootPath: '/workspace',
    queryMemory: vi.fn().mockResolvedValue([]),
    upsertMemory: vi.fn(),
    readFile: vi.fn().mockResolvedValue('contents'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    findFiles: vi.fn().mockResolvedValue([]),
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
): Orchestrator {
  const agents = new AgentRegistry();
  const skillsRegistry = new SkillsRegistry();
  const router = new ModelRouter();
  const memory = new MemoryManager();
  const costs = new CostTracker();
  const providers = new ProviderRegistry();

  providers.register(provider);
  for (const skill of skills) {
    skillsRegistry.register(skill);
  }

  return new Orchestrator(agents, skillsRegistry, router, memory, costs, providers, skillContext);
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

    await orchestrator.processTask({
      id: 'task-3',
      userMessage: 'Loop forever',
      context: {},
      constraints: { budget: 'balanced', speed: 'balanced' },
      timestamp: new Date().toISOString(),
    });

    // Should stop at MAX_TOOL_ITERATIONS (10), not run indefinitely
    expect((provider.complete as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(10);
  });
});
