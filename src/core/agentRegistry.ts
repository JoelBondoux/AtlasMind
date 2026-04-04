import type { AgentDefinition } from '../types.js';

interface AgentPerformance {
  successes: number;
  failures: number;
  totalTasks: number;
}

/**
 * Registry for agent definitions with performance tracking.
 */
export class AgentRegistry {
  private agents = new Map<string, AgentDefinition>();
  /** Agent IDs explicitly disabled by the user. */
  private disabledAgents = new Set<string>();
  /** Tracks per-agent success/failure metrics. */
  private performance = new Map<string, AgentPerformance>();

  register(agent: AgentDefinition): void {
    this.agents.set(agent.id, agent);
  }

  unregister(id: string): boolean {
    this.disabledAgents.delete(id);
    this.performance.delete(id);
    return this.agents.delete(id);
  }

  get(id: string): AgentDefinition | undefined {
    return this.agents.get(id);
  }

  listAgents(): AgentDefinition[] {
    return [...this.agents.values()];
  }

  listEnabledAgents(): AgentDefinition[] {
    return this.listAgents().filter(agent => !this.disabledAgents.has(agent.id));
  }

  isEnabled(id: string): boolean {
    return !this.disabledAgents.has(id);
  }

  enable(id: string): void {
    this.disabledAgents.delete(id);
  }

  disable(id: string): void {
    this.disabledAgents.add(id);
  }

  setDisabledIds(ids: string[]): void {
    this.disabledAgents = new Set(ids);
  }

  getDisabledIds(): string[] {
    return [...this.disabledAgents];
  }

  // ── Performance tracking ─────────────────────────────

  /** Record the outcome of an agent's task execution. */
  recordOutcome(agentId: string, success: boolean): void {
    const perf = this.performance.get(agentId) ?? { successes: 0, failures: 0, totalTasks: 0 };
    perf.totalTasks += 1;
    if (success) { perf.successes += 1; }
    else { perf.failures += 1; }
    this.performance.set(agentId, perf);
  }

  /** Get the success rate for an agent (0–1, or undefined if no data). */
  getSuccessRate(agentId: string): number | undefined {
    const perf = this.performance.get(agentId);
    if (!perf || perf.totalTasks === 0) { return undefined; }
    return perf.successes / perf.totalTasks;
  }

  getPerformance(agentId: string): AgentPerformance | undefined {
    return this.performance.get(agentId);
  }

  /** Restore previously persisted performance data. */
  loadPerformance(data: Record<string, AgentPerformance>): void {
    for (const [id, perf] of Object.entries(data)) {
      this.performance.set(id, perf);
    }
  }

  /** Snapshot all performance data for persistence. */
  dumpPerformance(): Record<string, AgentPerformance> {
    const result: Record<string, AgentPerformance> = {};
    for (const [id, perf] of this.performance) {
      result[id] = perf;
    }
    return result;
  }
}
