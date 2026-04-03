import type { AgentDefinition, SkillDefinition } from '../types.js';

/**
 * Registry for skill definitions.
 */
export class SkillsRegistry {
  private skills = new Map<string, SkillDefinition>();

  register(skill: SkillDefinition): void {
    this.skills.set(skill.id, skill);
  }

  unregister(id: string): boolean {
    return this.skills.delete(id);
  }

  get(id: string): SkillDefinition | undefined {
    return this.skills.get(id);
  }

  listSkills(): SkillDefinition[] {
    return [...this.skills.values()];
  }

  /**
   * Return the skills available to a given agent.
   */
  getSkillsForAgent(agent: AgentDefinition): SkillDefinition[] {
    if (agent.skills.length === 0) {
      return this.listSkills();
    }
    return agent.skills
      .map(id => this.skills.get(id))
      .filter((s): s is SkillDefinition => s !== undefined);
  }
}
