import type { AgentDefinition, SkillDefinition, SkillExecutionContext, TaskRequest, TaskResult } from '../types.js';
import type { AgentRegistry } from './agentRegistry.js';
import type { SkillsRegistry } from './skillsRegistry.js';
import type { ModelRouter } from './modelRouter.js';
import type { MemoryManager } from '../memory/memoryManager.js';
import type { CostTracker } from './costTracker.js';
import type { ProviderRegistry } from '../providers/index.js';
import type { ChatMessage, CompletionResponse, ProviderAdapter, ToolDefinition } from '../providers/adapter.js';

/** Maximum agentic loop iterations before forcing a stop. */
const MAX_TOOL_ITERATIONS = 10;

/**
 * Core orchestrator – receives a task, selects an agent, retrieves
 * relevant memory, picks a model, and dispatches execution.
 * Supports a multi-turn agentic loop for tool/skill execution.
 */
export class Orchestrator {
  constructor(
    private agents: AgentRegistry,
    private skills: SkillsRegistry,
    private router: ModelRouter,
    private memory: MemoryManager,
    private costs: CostTracker,
    private providers: ProviderRegistry,
    private skillContext: SkillExecutionContext,
  ) {}

  /**
   * Process a user task end-to-end.
   */
  async processTask(request: TaskRequest): Promise<TaskResult> {
    const agent = this.selectAgent(request);
    const memoryContext = await this.memory.queryRelevant(request.userMessage);
    const model = this.router.selectModel(request.constraints, agent.allowedModels);
    const selectedProvider = model.split('/')[0] ?? 'local';
    const provider = this.providers.get(selectedProvider);
    const agentSkills = this.skills.getSkillsForAgent(agent);
    const tools: ToolDefinition[] = agentSkills.map(s => ({
      name: s.id,
      description: s.description,
      parameters: s.parameters,
    }));

    const messages = this.buildMessages(agent, agentSkills, memoryContext, request.userMessage);

    const startMs = Date.now();
    let completion: CompletionResponse;

    if (!provider) {
      completion = {
        content: `No provider adapter registered for "${selectedProvider}".`,
        model,
        inputTokens: estimateTokens(messages.map(m => m.content).join('\n')),
        outputTokens: 10,
        finishReason: 'error',
      };
    } else {
      completion = await this.runAgenticLoop(provider, model, messages, tools);
    }

    const durationMs = Date.now() - startMs;
    const costUsd = this.estimateCostUsd(model, completion.inputTokens, completion.outputTokens);

    const result: TaskResult = {
      id: request.id,
      agentId: agent.id,
      modelUsed: model,
      response: completion.content,
      costUsd,
      durationMs,
    };

    this.costs.record({
      taskId: request.id,
      agentId: agent.id,
      model,
      inputTokens: completion.inputTokens,
      outputTokens: completion.outputTokens,
      costUsd,
      timestamp: new Date().toISOString(),
    });

    return result;
  }

  /**
   * Run the provider in a multi-turn loop, executing tool calls until the
   * model produces a final text response or the iteration limit is reached.
   */
  private async runAgenticLoop(
    provider: ProviderAdapter,
    model: string,
    messages: ChatMessage[],
    tools: ToolDefinition[],
  ): Promise<CompletionResponse> {
    let completion: CompletionResponse = {
      content: '',
      model,
      inputTokens: 0,
      outputTokens: 0,
      finishReason: 'stop',
    };

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      completion = await provider.complete({ model, messages, tools, temperature: 0.2 });

      if (completion.finishReason !== 'tool_calls' || !completion.toolCalls?.length) {
        break;
      }

      // Add the assistant's tool-call message to history
      messages.push({
        role: 'assistant',
        content: completion.content,
        toolCalls: completion.toolCalls,
      });

      // Execute each requested tool and append results
      for (const toolCall of completion.toolCalls) {
        const skill = this.skills.get(toolCall.name);
        const result = skill
          ? await this.executeSkillSafely(skill, toolCall.arguments)
          : `Unknown tool: ${toolCall.name}`;

        messages.push({
          role: 'tool',
          content: result,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
        });
      }
    }

    return completion;
  }

  private async executeSkillSafely(
    skill: SkillDefinition,
    params: Record<string, unknown>,
  ): Promise<string> {
    try {
      return await skill.execute(params, this.skillContext);
    } catch (err) {
      return `Skill "${skill.id}" failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private selectAgent(_request: TaskRequest): AgentDefinition {
    const agents = this.agents.listAgents();
    if (agents.length > 0) {
      return agents[0];
    }

    return {
      id: 'default',
      name: 'Default',
      role: 'general assistant',
      description: 'Fallback agent when no specialised agent matches.',
      systemPrompt: 'You are a helpful coding assistant.',
      skills: [],
    };
  }

  private buildMessages(
    agent: AgentDefinition,
    agentSkills: SkillDefinition[],
    memoryContext: Awaited<ReturnType<MemoryManager['queryRelevant']>>,
    userMessage: string,
  ): ChatMessage[] {
    const skillsContext = agentSkills.length > 0
      ? agentSkills.map(s => `- ${s.name}: ${s.description}`).join('\n')
      : '- none';

    const memoryLines = memoryContext.length > 0
      ? memoryContext
        .map(entry => `- ${entry.title} (${entry.path}): ${entry.snippet.slice(0, 180)}`)
        .join('\n')
      : '- none';

    return [
      {
        role: 'system',
        content:
          `${agent.systemPrompt}\n\n` +
          `Agent role: ${agent.role}\n` +
          `Skills:\n${skillsContext}\n\n` +
          `Relevant project memory:\n${memoryLines}`,
      },
      {
        role: 'user',
        content: userMessage,
      },
    ];
  }

  private estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
    const modelInfo = this.router.getModelInfo(model);
    if (!modelInfo) {
      return 0;
    }

    const inputRate = modelInfo.inputPricePer1k;
    const outputRate = modelInfo.outputPricePer1k;
    return ((inputTokens / 1000) * inputRate) + ((outputTokens / 1000) * outputRate);
  }
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

