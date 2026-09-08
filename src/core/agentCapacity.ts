/**
 * Whether the team you configured can actually work, and whether it is used.
 *
 * The dashboard counted agents, skills and healthy providers, and did nothing
 * with the answer: `4/9 providers healthy` sat in a stat card's subtitle, in the
 * same grey as everything else, on a page whose job is to say what needs a
 * person. A project can be perfectly configured and unable to route a single
 * request, and nothing said so.
 *
 * Five rules.
 *
 * **A provider that is down is news, not a grade.** It goes to the attention
 * feed and never into the score. An outage this morning is not a fact about how
 * well the project is run, and a score that moved with one would be a weather
 * report — people would learn to explain it away, which is how a score stops
 * being read at all.
 *
 * **Disabled is a decision, not a gap.** An agent switched off is one somebody
 * chose not to use. Only *enabled* agents can be idle, and counting the rest
 * would report a tidy configuration as a problem.
 *
 * **Unassessed is not idle.** A project with no run history has not shown its
 * agents going unused — it has shown nothing. Utilisation is `undefined` rather
 * than `0`, so the score component is absent rather than zero and a new project
 * is not marked down for being new.
 *
 * **The join is by role, not by agent id.** A planner subtask runs as an
 * ephemeral agent that carries a role and no registry id, and several agents can
 * share a role. Matching on id would report every agent as idle on a project
 * that runs constantly.
 *
 * **Nothing routable is a harder stop than an unhealthy provider.** A provider
 * with no models enabled cannot be reached at all, and reporting it at the same
 * weight as one that failed a health check would bury the difference between
 * "degraded" and "cannot work".
 *
 * Pure — no clock, no `fs`, no model.
 */

export type AgentCapacityRuleId =
  | 'nothing-routable'
  | 'all-providers-unhealthy'
  | 'some-providers-unhealthy'
  | 'no-agents-enabled'
  | 'agents-never-used';

export interface AgentCapacityRule {
  id: AgentCapacityRuleId;
  description: string;
}

/** Published with every reading, so a surface shows the rules that graded it. */
export const AGENT_CAPACITY_RULES: readonly AgentCapacityRule[] = [
  {
    id: 'nothing-routable',
    description: 'No provider has an enabled model, so no request can be routed anywhere. This is a stop, not a degradation.',
  },
  {
    id: 'all-providers-unhealthy',
    description: 'Every configured provider failed its health check. Work will fail rather than run slowly.',
  },
  {
    id: 'some-providers-unhealthy',
    description: 'At least one provider failed its health check. Routing still works, with less to choose from.',
  },
  {
    id: 'no-agents-enabled',
    description: 'Every agent is switched off, so there is no specialist to route work to.',
  },
  {
    id: 'agents-never-used',
    description: 'Agents are enabled but their role has not appeared in any recorded run. Either the work has not needed them or the team is larger than the project.',
  },
];

export type AgentCapacitySeverity = 'blocked' | 'degraded' | 'notice';

export interface AgentCapacityFinding {
  rule: AgentCapacityRuleId;
  severity: AgentCapacitySeverity;
  summary: string;
  /** What the reader would click. Absent where there is nowhere useful to go. */
  detail: string;
}

export interface AgentCapacityProvider {
  id: string;
  label: string;
  healthy: boolean;
  enabledModels: number;
}

export interface AgentCapacityAgent {
  id: string;
  name: string;
  role: string;
  enabled: boolean;
}

export interface AgentCapacityInput {
  agents: readonly AgentCapacityAgent[];
  providers: readonly AgentCapacityProvider[];
  /**
   * Roles seen in recorded runs. **Absent means nothing was read**, which is a
   * different statement from an empty array — that one means runs were read and
   * none of them named a role.
   */
  observedRoles?: readonly string[];
  /** How many runs that observation covers. Absent alongside `observedRoles`. */
  runsObserved?: number;
}

export interface AgentCapacityReading {
  /** Ranked by consequence, worst first. Empty when nothing needs anybody. */
  findings: AgentCapacityFinding[];
  /** Enabled agents whose role never appeared. Absent when nothing was observed. */
  idleAgents?: AgentCapacityAgent[];
  /**
   * Share of enabled agents whose role has been seen, `0`–`1`.
   *
   * Absent rather than `0` when there is no run history to judge by: a project
   * that has never run has not shown its agents idle.
   */
  utilisation?: number;
  enabledAgentCount: number;
  healthyProviderCount: number;
  providerCount: number;
  rules: readonly AgentCapacityRule[];
}

export function readAgentCapacity(input: AgentCapacityInput): AgentCapacityReading {
  const enabledAgents = input.agents.filter(agent => agent.enabled);
  const providers = input.providers;
  const healthy = providers.filter(provider => provider.healthy);
  const routable = providers.filter(provider => provider.enabledModels > 0);

  const findings: AgentCapacityFinding[] = [];

  // Ranked by consequence rather than count, and the order *is* the ranking:
  // "nothing can run" outranks "nine agents are idle" however many there are.
  if (providers.length > 0 && routable.length === 0) {
    findings.push({
      rule: 'nothing-routable',
      severity: 'blocked',
      summary: 'No model is enabled on any provider',
      detail: `${providers.length} provider${providers.length === 1 ? ' is' : 's are'} configured and none has an enabled model, so nothing can be routed anywhere.`,
    });
  } else if (providers.length > 0 && healthy.length === 0) {
    findings.push({
      rule: 'all-providers-unhealthy',
      severity: 'blocked',
      summary: 'Every provider is failing its health check',
      detail: `All ${providers.length} configured provider${providers.length === 1 ? '' : 's'} ${providers.length === 1 ? 'is' : 'are'} unhealthy. Work will fail rather than run slowly.`,
    });
  } else if (providers.length > 0 && healthy.length < providers.length) {
    const unhealthy = providers.filter(provider => !provider.healthy);
    findings.push({
      rule: 'some-providers-unhealthy',
      severity: 'degraded',
      summary: `${unhealthy.length} of ${providers.length} providers unhealthy`,
      detail: `${unhealthy.map(provider => provider.label).join(', ')} failed a health check. Routing still works, with less to choose from.`,
    });
  }

  if (input.agents.length > 0 && enabledAgents.length === 0) {
    findings.push({
      rule: 'no-agents-enabled',
      severity: 'blocked',
      summary: 'No agent is enabled',
      detail: `All ${input.agents.length} agents are switched off, so there is no specialist to route work to.`,
    });
  }

  // Only computed where something was actually observed. `observedRoles`
  // absent means nothing was read, which must not read as "nothing ran".
  let idleAgents: AgentCapacityAgent[] | undefined;
  let utilisation: number | undefined;
  if (input.observedRoles !== undefined && enabledAgents.length > 0) {
    const seen = new Set(input.observedRoles.map(role => role.trim().toLowerCase()).filter(Boolean));
    idleAgents = enabledAgents.filter(agent => !seen.has(agent.role.trim().toLowerCase()));
    utilisation = (enabledAgents.length - idleAgents.length) / enabledAgents.length;
    // Reported only where there is enough history to mean anything. One run
    // naming one role does not make the other eight agents idle, and saying so
    // would train somebody to disable a team they are about to need.
    if (idleAgents.length > 0 && (input.runsObserved ?? 0) >= MIN_RUNS_TO_JUDGE_UTILISATION) {
      findings.push({
        rule: 'agents-never-used',
        severity: 'notice',
        summary: `${idleAgents.length} enabled agent${idleAgents.length === 1 ? '' : 's'} never used`,
        detail: `${idleAgents.map(agent => agent.name).join(', ')} ${idleAgents.length === 1 ? 'is' : 'are'} enabled but ${idleAgents.length === 1 ? 'its role has' : 'their roles have'} not appeared in the last ${input.runsObserved} runs.`,
      });
    }
  }

  return {
    findings,
    ...(idleAgents === undefined ? {} : { idleAgents }),
    ...(utilisation === undefined ? {} : { utilisation }),
    enabledAgentCount: enabledAgents.length,
    healthyProviderCount: healthy.length,
    providerCount: providers.length,
    rules: AGENT_CAPACITY_RULES,
  };
}

/**
 * Fewer runs than this and utilisation is not reported as a finding.
 *
 * The figure is still computed — it is a true statement about what has been
 * seen — but a project three runs old has not demonstrated that six of its
 * agents are surplus, and telling somebody so would have them switch off a team
 * they are about to need.
 */
export const MIN_RUNS_TO_JUDGE_UTILISATION = 10;

/**
 * The score contribution, or nothing.
 *
 * **Provider health is deliberately not in here.** It is the loudest thing this
 * module knows and it belongs in the attention feed instead: a score that fell
 * because a provider had an outage this morning would recover by lunchtime
 * without anybody doing anything, and a number that moves on its own is one
 * people learn to explain away.
 *
 * Absent — not zero — when there is no history to judge by, so a project that
 * has never run is not marked down for being new. The caller drops the
 * component entirely, and the score's denominator is derived, so the headline
 * stays honest without anybody adjusting a total.
 */
export function agentUtilisationScore(reading: AgentCapacityReading, maxScore: number): {
  score: number;
  detail: string;
} | undefined {
  if (reading.utilisation === undefined) {
    return undefined;
  }
  const used = reading.enabledAgentCount - (reading.idleAgents?.length ?? 0);
  return {
    score: Math.round(reading.utilisation * maxScore),
    detail: `${used} of ${reading.enabledAgentCount} enabled agent${reading.enabledAgentCount === 1 ? '' : 's'} `
      + `${used === 1 ? 'has' : 'have'} been used in recorded runs.`,
  };
}
