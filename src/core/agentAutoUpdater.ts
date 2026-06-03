import type { AgentAutoUpdateCadence, AgentDefinition, RoutingConstraints } from '../types.js';
import type { AgentRegistry } from './agentRegistry.js';
import type { ModelRouter } from './modelRouter.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { TaskProfiler } from './taskProfiler.js';
import { resolveProviderIdForModel } from './orchestrator.js';

const UPDATE_CONSTRAINTS: RoutingConstraints = { budget: 'balanced', speed: 'balanced' };
const UPDATE_MAX_TOKENS = 2048;
const UPDATE_TEMPERATURE = 0.3;

const CADENCE_INTERVALS_MS: Record<'daily' | 'weekly' | 'monthly', number> = {
  daily:   24 * 60 * 60 * 1000,
  weekly:  7  * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

const UPDATE_SYSTEM_PROMPT = [
  'You are an expert AI agent definition reviewer.',
  'Your task is to modernize and improve an AI agent\'s system prompt and description to ensure it:',
  '1. Uses current best practices for AI assistant instructions',
  '2. Is accurate and reflects modern software development standards',
  '3. Is legally compliant and appropriate across major territories (US, EU, UK, Canada, Australia)',
  '4. Is free of outdated, obsolete, or irrelevant instructions',
  '5. Maintains the agent\'s core purpose, role, and capabilities unchanged',
  '6. Is clear, concise, and actionable',
  '',
  'Respond ONLY with a valid JSON object — no preamble, no markdown fences, no trailing text.',
].join('\n');

/**
 * Automatically refreshes agent system prompts and descriptions on a configurable
 * cadence. Agents with autoUpdateExcluded=true are skipped; built-in agents are
 * treated the same as user-defined agents and their updates are persisted as overrides.
 * All updates are fire-and-forget safe — the original agent is returned on any error.
 */
export class AgentAutoUpdater {
  private readonly updating = new Set<string>();

  constructor(
    private readonly agents: AgentRegistry,
    private readonly router: ModelRouter,
    private readonly providers: ProviderRegistry,
    private readonly profiler: TaskProfiler,
    private readonly saveAgent: (agent: AgentDefinition) => Promise<void>,
    private readonly getCadence: () => AgentAutoUpdateCadence,
  ) {}

  isDue(agent: AgentDefinition): boolean {
    const cadence = this.getCadence();
    if (cadence === 'never') { return false; }
    if (agent.autoUpdateExcluded) { return false; }
    if (cadence === 'every-use') { return true; }
    if (!agent.lastAutoUpdated) { return true; }
    const elapsed = Date.now() - new Date(agent.lastAutoUpdated).getTime();
    return elapsed >= CADENCE_INTERVALS_MS[cadence];
  }

  /**
   * Update the agent definition if the cadence is due.
   * Returns the (possibly updated) agent definition.
   * Never throws — returns the original agent on any failure.
   */
  async maybeUpdate(agent: AgentDefinition): Promise<AgentDefinition> {
    if (!this.isDue(agent)) { return agent; }
    if (this.updating.has(agent.id)) { return agent; }

    this.updating.add(agent.id);
    try {
      const updated = await this.performUpdate(agent);
      this.agents.register(updated);
      await this.saveAgent(updated);
      return updated;
    } catch {
      return agent;
    } finally {
      this.updating.delete(agent.id);
    }
  }

  private async performUpdate(agent: AgentDefinition): Promise<AgentDefinition> {
    const taskProfile = this.profiler.profileTask({
      userMessage: `Review and modernize the ${agent.role} agent definition.`,
      phase: 'planning',
      requiresTools: false,
    });

    const model = this.router.selectModel(UPDATE_CONSTRAINTS, agent.allowedModels, taskProfile);
    const providerId = resolveProviderIdForModel(model, this.router, 'copilot');
    const provider = this.providers.get(providerId);
    if (!provider) { return agent; }

    const userPrompt = [
      `Review and update the following AI agent definition.`,
      `Preserve its core purpose and role. Update language, best practices, and remove outdated content.`,
      ``,
      `Name: ${agent.name}`,
      `Role: ${agent.role}`,
      `Current Description: ${agent.description}`,
      `Current System Prompt:`,
      agent.systemPrompt,
      ``,
      `Return ONLY a JSON object with exactly these two string fields:`,
      `{"systemPrompt": "...", "description": "..."}`,
    ].join('\n');

    let responseContent: string;
    try {
      const response = await provider.complete({
        model,
        messages: [
          { role: 'system', content: UPDATE_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        maxTokens: UPDATE_MAX_TOKENS,
        temperature: UPDATE_TEMPERATURE,
      });
      responseContent = response.content;
    } catch {
      return agent;
    }

    const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) { return agent; }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return agent;
    }

    if (typeof parsed !== 'object' || parsed === null) { return agent; }
    const candidate = parsed as Record<string, unknown>;
    const systemPrompt = candidate['systemPrompt'];
    const description = candidate['description'];

    if (typeof systemPrompt !== 'string' || typeof description !== 'string') { return agent; }
    if (!systemPrompt.trim() || !description.trim()) { return agent; }

    return {
      ...agent,
      systemPrompt,
      description,
      lastAutoUpdated: new Date().toISOString(),
    };
  }
}
