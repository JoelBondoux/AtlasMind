import type { AgentDefinition, SkillDefinition, TaskRequest, TaskResult } from '../types.js';
import type { AgentRegistry } from './agentRegistry.js';
import type { SkillsRegistry } from './skillsRegistry.js';
import type { ModelRouter } from './modelRouter.js';
import type { MemoryManager } from '../memory/memoryManager.js';
import type { CostTracker } from './costTracker.js';

/**
 * Core orchestrator – receives a task, selects an agent, retrieves
 * relevant memory, picks a model, and dispatches execution.
 *
 * This is the stub; real routing logic will be added incrementally.
 */
export class Orchestrator {
  constructor(
    private agents: AgentRegistry,
    private skills: SkillsRegistry,
    private router: ModelRouter,
    private memory: MemoryManager,
    private costs: CostTracker,
  ) {}

  /**
   * Process a user task end-to-end.
   */
  async processTask(request: TaskRequest): Promise<TaskResult> {
    // 1. Determine which agent should handle this
    const agent = this.selectAgent(request);

    // 2. Gather relevant memory slices
    const _memoryContext = await this.memory.queryRelevant(request.userMessage);

    // 3. Pick the best model given constraints + agent preferences
    const model = this.router.selectModel(request.constraints, agent.allowedModels);

    // 4. Build prompt context (agent system prompt + memory + skills)
    const _skills = this.skills.getSkillsForAgent(agent);

    // 5. Execute (placeholder)
    const startMs = Date.now();
    const response = `[Orchestrator stub] Agent "${agent.name}" would use model "${model}" to handle: "${request.userMessage}"`;
    const durationMs = Date.now() - startMs;

    // 6. Record cost
    const result: TaskResult = {
      id: request.id,
      agentId: agent.id,
      modelUsed: model,
      response,
      costUsd: 0,
      durationMs,
    };

    this.costs.record({
      taskId: request.id,
      agentId: agent.id,
      model,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      timestamp: new Date().toISOString(),
    });

    return result;
  }

  private selectAgent(request: TaskRequest): AgentDefinition {
    // Default: return first agent or a fallback
    const agents = this.agents.listAgents();
    if (agents.length > 0) {
      return agents[0];
    }
    // Built-in fallback agent
    return {
      id: 'default',
      name: 'Default',
      role: 'general assistant',
      description: 'Fallback agent when no specialised agent matches.',
      systemPrompt: 'You are a helpful coding assistant.',
      skills: [],
    };
  }
}
