import type { AgentDefinition, SkillDefinition, TaskRequest, TaskResult } from '../types.js';
import type { AgentRegistry } from './agentRegistry.js';
import type { SkillsRegistry } from './skillsRegistry.js';
import type { ModelRouter } from './modelRouter.js';
import type { MemoryManager } from '../memory/memoryManager.js';
import type { CostTracker } from './costTracker.js';
import type { ProviderRegistry } from '../providers/index.js';
import type { ChatMessage } from '../providers/adapter.js';

/**
 * Core orchestrator – receives a task, selects an agent, retrieves
 * relevant memory, picks a model, and dispatches execution.
 */
export class Orchestrator {
  constructor(
    private agents: AgentRegistry,
    private skills: SkillsRegistry,
    private router: ModelRouter,
    private memory: MemoryManager,
    private costs: CostTracker,
    private providers: ProviderRegistry,
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
    const skills = this.skills.getSkillsForAgent(agent);
    const messages = this.buildMessages(agent, skills, memoryContext, request.userMessage);

    const startMs = Date.now();
    const completion = provider
      ? await provider.complete({ model, messages, temperature: 0.2 })
      : {
          content: `No provider adapter registered for "${selectedProvider}".`,
          model,
          inputTokens: estimateTokens(messages.map(m => m.content).join('\n')),
          outputTokens: 10,
          finishReason: 'error' as const,
        };

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
    skills: SkillDefinition[],
    memoryContext: Awaited<ReturnType<MemoryManager['queryRelevant']>>,
    userMessage: string,
  ): ChatMessage[] {
    const skillsContext = skills.length > 0
      ? skills.map(s => `- ${s.name}: ${s.description}`).join('\n')
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
