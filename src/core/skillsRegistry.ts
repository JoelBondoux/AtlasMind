import type { AgentDefinition, SkillDefinition, SkillScanResult } from '../types.js';

/**
 * Registry for skill definitions.
 * Tracks enabled/disabled state and security scan results independently of definitions.
 */
export class SkillsRegistry {
  private skills = new Map<string, SkillDefinition>();
  /** Skill IDs that have been explicitly disabled. */
  private disabledSkills = new Set<string>();
  private scanResults = new Map<string, SkillScanResult>();

  register(skill: SkillDefinition): void {
    this.skills.set(skill.id, skill);
  }

  unregister(id: string): boolean {
    this.disabledSkills.delete(id);
    this.scanResults.delete(id);
    return this.skills.delete(id);
  }

  get(id: string): SkillDefinition | undefined {
    return this.skills.get(id);
  }

  listSkills(): SkillDefinition[] {
    return [...this.skills.values()];
  }

  // ── Enabled / disabled ────────────────────────────────────────

  isEnabled(id: string): boolean {
    return !this.disabledSkills.has(id);
  }

  /**
   * Enable a skill. Throws if the skill has a failed security scan,
   * preventing unsafe skills from being used by agents.
   */
  enable(id: string): void {
    const result = this.scanResults.get(id);
    if (result?.status === 'failed') {
      throw new Error(
        `Skill "${id}" cannot be enabled: the security scan found error-level issues. ` +
        `Run a new scan after resolving the reported problems.`,
      );
    }
    this.disabledSkills.delete(id);
  }

  disable(id: string): void {
    this.disabledSkills.add(id);
  }

  /** Overwrite the enabled/disabled set (used during state restore from globalState). */
  setDisabledIds(ids: string[]): void {
    this.disabledSkills = new Set(ids);
  }

  getDisabledIds(): string[] {
    return [...this.disabledSkills];
  }

  // ── Scan results ──────────────────────────────────────────────

  setScanResult(result: SkillScanResult): void {
    this.scanResults.set(result.skillId, result);
  }

  getScanResult(id: string): SkillScanResult | undefined {
    return this.scanResults.get(id);
  }

  // ── Agent context ─────────────────────────────────────────────

  /**
   * Return the skills available and enabled for a given agent.
   */
  getSkillsForAgent(agent: AgentDefinition): SkillDefinition[] {
    const candidates = agent.skills.length === 0
      ? this.listSkills()
      : agent.skills
        .map(id => this.skills.get(id))
        .filter((s): s is SkillDefinition => s !== undefined);

    return candidates.filter(s => this.isEnabled(s.id));
  }
}

