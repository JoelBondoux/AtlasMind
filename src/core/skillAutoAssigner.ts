import type { AgentDefinition, SkillDefinition, RoutingConstraints } from '../types.js';
import type { AgentRegistry } from './agentRegistry.js';
import type { ModelRouter } from './modelRouter.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { TaskProfiler } from './taskProfiler.js';
import { resolveProviderIdForModel } from './orchestrator.js';

const CONSTRAINTS: RoutingConstraints = { budget: 'cheap', speed: 'fast' };
const MAX_TOKENS = 512;

const SYSTEM_PROMPT = [
  'You are an AI agent skill matcher.',
  'Given an agent definition and a list of available skills, identify which skills are appropriate for this agent.',
  'Respond ONLY with a valid JSON array of skill ID strings — no preamble, no markdown fences.',
  'Example: ["skill-id-1", "skill-id-2"]',
  'Return [] if no skills are relevant.',
].join('\n');

/**
 * Automatically assigns skills to agents that have skillsAutoManaged enabled.
 * Uses an AI model to assess which available skills match the agent's role and context.
 * Built-in agents and agents without skillsAutoManaged are never touched.
 */
export class SkillAutoAssigner {
  private readonly inProgress = new Set<string>();

  constructor(
    private readonly agents: AgentRegistry,
    private readonly router: ModelRouter,
    private readonly providers: ProviderRegistry,
    private readonly profiler: TaskProfiler,
    private readonly saveAgent: (agent: AgentDefinition) => Promise<void>,
  ) {}

  /**
   * Assign skills to a single agent if it has skillsAutoManaged enabled.
   * Returns the (possibly updated) agent. Never throws — returns original on any failure.
   */
  async assignSkillsForAgent(
    agent: AgentDefinition,
    availableSkills: SkillDefinition[],
  ): Promise<AgentDefinition> {
    if (!agent.skillsAutoManaged) { return agent; }
    if (agent.builtIn) { return agent; }
    if (this.inProgress.has(agent.id)) { return agent; }
    if (availableSkills.length === 0) { return { ...agent, skills: [] }; }

    this.inProgress.add(agent.id);
    try {
      const updated = await this.performAssignment(agent, availableSkills);
      this.agents.register(updated);
      await this.saveAgent(updated);
      return updated;
    } catch {
      return agent;
    } finally {
      this.inProgress.delete(agent.id);
    }
  }

  /**
   * Reassess skill assignments for all auto-managed agents.
   * Called when new skills or MCP connections are added to the registry.
   */
  async reassessAllAutoAgents(availableSkills: SkillDefinition[]): Promise<void> {
    const autoAgents = this.agents.listAgents().filter(
      a => a.skillsAutoManaged && !a.builtIn,
    );
    await Promise.allSettled(
      autoAgents.map(a => this.assignSkillsForAgent(a, availableSkills)),
    );
  }

  private async performAssignment(
    agent: AgentDefinition,
    availableSkills: SkillDefinition[],
  ): Promise<AgentDefinition> {
    const taskProfile = this.profiler.profileTask({
      userMessage: `Assign skills for agent: ${agent.role}`,
      phase: 'planning',
      requiresTools: false,
    });

    const model = this.router.selectModel(CONSTRAINTS, agent.allowedModels, taskProfile);
    const providerId = resolveProviderIdForModel(model, this.router, 'copilot');
    const provider = this.providers.get(providerId);
    if (!provider) { return agent; }

    const skillList = availableSkills
      .map(s => {
        const desc = (s as { description?: string }).description;
        return `- id: "${s.id}", name: "${s.name}"${desc ? `, description: "${desc}"` : ''}`;
      })
      .join('\n');

    const userPrompt = [
      'Agent:',
      `  Name: ${agent.name}`,
      `  Role: ${agent.role}`,
      `  Description: ${agent.description}`,
      `  System Prompt: ${agent.systemPrompt.slice(0, 600)}`,
      '',
      'Available skills:',
      skillList,
      '',
      'Return a JSON array of skill IDs this agent should use. Return [] if none apply.',
    ].join('\n');

    let responseContent: string;
    try {
      const response = await provider.complete({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        maxTokens: MAX_TOKENS,
        temperature: 0.1,
      });
      responseContent = response.content;
    } catch {
      return agent;
    }

    const arrMatch = responseContent.match(/\[[\s\S]*\]/);
    if (!arrMatch) { return agent; }

    let parsed: unknown;
    try {
      parsed = JSON.parse(arrMatch[0]);
    } catch {
      return agent;
    }

    if (!Array.isArray(parsed)) { return agent; }
    const validIds = new Set(availableSkills.map(s => s.id));
    const skills = parsed.filter(
      (id): id is string => typeof id === 'string' && validIds.has(id),
    );

    return { ...agent, skills };
  }
}
