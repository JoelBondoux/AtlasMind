import type { AgentAutoUpdateCadence, AgentDefinition, RoutingConstraints } from '../types.js';
import type { AgentRegistry } from './agentRegistry.js';
import type { ModelRouter } from './modelRouter.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { TaskProfiler } from './taskProfiler.js';
import { resolveProviderIdForModel } from './orchestrator.js';
import { dispatchGuardedCompletion } from './modelEgress.js';
import { isLocalProviderId } from './backgroundMemoryPolicy.js';
import { shouldHoldAgentUpdate, type UpdateHoldDecision } from './agentEvalHarness.js';

/**
 * Replays an agent's golden cases against a candidate definition.
 *
 * Injected rather than imported, so the updater does not acquire a dependency
 * on a model runner and stays unit-testable — and so a host with no verifier
 * configured is a distinguishable state rather than a silent one.
 *
 * Returning `undefined` means the check could not be made. That is deliberately
 * different from "it passed": `shouldHoldAgentUpdate` holds an unverified
 * rewrite, because the cadence is unattended.
 */
export interface AgentUpdateVerifier {
  /** How many golden cases are declared for this agent. */
  declaredCaseCount: (agentId: string) => number;
  /** Replay them. `undefined` when the check could not be made at all. */
  verify: (
    agent: AgentDefinition,
    candidate: AgentDefinition,
  ) => Promise<import('./agentEvalHarness.js').RegressionVerdict | undefined>;
}


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
 * cadence. Built-in agents and agents with autoUpdateExcluded=true are skipped.
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
    /**
     * Optional. Absent means no rewrite is checked against anything, which is
     * the behaviour before this gate existed and is stated rather than implied.
     */
    private readonly verifier?: AgentUpdateVerifier,
  ) {}

  isDue(agent: AgentDefinition): boolean {
    const cadence = this.getCadence();
    if (cadence === 'never') { return false; }
    if (agent.builtIn) { return false; }
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
      if (updated === agent) {
        return agent;
      }
      // The gate. An automatic rewrite is a prompt edit deployed with no
      // failing build, so it is replayed against the agent's golden cases
      // before it is registered — and an update that could not be checked is
      // held rather than shipped, because nobody is watching this one.
      const decision = await this.decideHold(agent, updated);
      if (decision.hold) {
        this.lastHold.set(agent.id, decision);
        return agent;
      }
      this.lastHold.delete(agent.id);
      this.agents.register(updated);
      await this.saveAgent(updated);
      return updated;
    } catch {
      return agent;
    } finally {
      this.updating.delete(agent.id);
    }
  }

  /**
   * Why the last rewrite of each agent was held, if it was.
   *
   * Kept so a surface can say *why* an agent stopped updating. An update that
   * silently stops happening is indistinguishable from one that never came due,
   * and the difference is the whole point of the gate.
   */
  private readonly lastHold = new Map<string, UpdateHoldDecision>();

  /** What held the last rewrite of this agent, if anything did. */
  heldUpdate(agentId: string): UpdateHoldDecision | undefined {
    return this.lastHold.get(agentId);
  }

  private async decideHold(
    agent: AgentDefinition,
    candidate: AgentDefinition,
  ): Promise<UpdateHoldDecision> {
    const verifier = this.verifier;
    if (!verifier) {
      // No verifier configured at all. Nothing is declared, so nothing is held
      // — the behaviour before this gate existed, stated rather than implied.
      return { hold: false, detail: 'No eval verifier is configured, so this rewrite was not checked against anything.' };
    }
    let declared = 0;
    try {
      declared = verifier.declaredCaseCount(agent.id);
    } catch {
      declared = 0;
    }
    if (declared === 0) {
      return shouldHoldAgentUpdate(undefined, 0);
    }
    try {
      return shouldHoldAgentUpdate(await verifier.verify(agent, candidate), declared);
    } catch {
      // A verifier that threw has not verified anything. Held, for the same
      // reason an absent verdict is.
      return shouldHoldAgentUpdate(undefined, declared);
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
      const response = await dispatchGuardedCompletion({
        provider,
        // Generated: the prompt is assembled from agent definitions rather than
        // typed by anyone, so it is redacted rather than confirmed.
        origins: ['system-prompt', 'generated-instruction'],
        external: !isLocalProviderId(provider.providerId),
        request: {
          model,
          messages: [
            { role: 'system', content: UPDATE_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          maxTokens: UPDATE_MAX_TOKENS,
          temperature: UPDATE_TEMPERATURE,
        },
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
