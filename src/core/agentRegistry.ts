import type { AgentDefinition } from '../types.js';

/**
 * Registry for agent definitions.
 */
export class AgentRegistry {
  private agents = new Map<string, AgentDefinition>();

  register(agent: AgentDefinition): void {
    this.agents.set(agent.id, agent);
  }

  unregister(id: string): boolean {
    return this.agents.delete(id);
  }

  get(id: string): AgentDefinition | undefined {
    return this.agents.get(id);
  }

  listAgents(): AgentDefinition[] {
    return [...this.agents.values()];
  }
}
