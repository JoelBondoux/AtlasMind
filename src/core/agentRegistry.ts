import type { AgentDefinition } from '../types.js';

/**
 * Registry for agent definitions.
 */
export class AgentRegistry {
  private agents = new Map<string, AgentDefinition>();
  /** Agent IDs explicitly disabled by the user. */
  private disabledAgents = new Set<string>();

  register(agent: AgentDefinition): void {
    this.agents.set(agent.id, agent);
  }

  unregister(id: string): boolean {
    this.disabledAgents.delete(id);
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
}
