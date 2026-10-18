import type { AgentDefinition, AgentSkillPolicy, SkillDefinition, SkillScanResult } from '../types.js';

/**
 * Registry for skill definitions.
 * Tracks enabled/disabled state and security scan results independently of definitions.
 */
export class SkillsRegistry {
  private skills = new Map<string, SkillDefinition>();
  /** Skill IDs the user disabled. Persisted by the caller; the user's choice. */
  private disabledSkills = new Set<string>();
  /**
   * Skill IDs switched off by the system because what backs them is
   * unavailable — an MCP server that disconnected — keyed to the reason.
   *
   * Kept apart from `disabledSkills` so the two can never be confused: a
   * reconnect lifts a suspension and nothing else, so it cannot re-enable a
   * skill the user turned off, and a suspension is never persisted as though
   * the user had chosen it.
   */
  private suspendedSkills = new Map<string, string>();
  private scanResults = new Map<string, SkillScanResult>();
  private customFolders = new Set<string>();

  register(skill: SkillDefinition): void {
    this.skills.set(skill.id, skill);
    const folderPath = getUserCustomSkillFolderPath(skill);
    if (folderPath) {
      this.registerCustomFolder(folderPath);
    }
  }

  unregister(id: string): boolean {
    this.disabledSkills.delete(id);
    this.suspendedSkills.delete(id);
    this.scanResults.delete(id);
    return this.skills.delete(id);
  }

  get(id: string): SkillDefinition | undefined {
    return this.skills.get(id);
  }

  listSkills(): SkillDefinition[] {
    return [...this.skills.values()];
  }

  registerCustomFolder(folderPath: string): void {
    const normalized = normalizeFolderPath(folderPath);
    if (!normalized) {
      return;
    }

    const segments = normalized.split('/');
    let current = '';
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      this.customFolders.add(current);
    }
  }

  setCustomFolders(folderPaths: string[]): void {
    this.customFolders = new Set<string>();
    for (const folderPath of folderPaths) {
      this.registerCustomFolder(folderPath);
    }
  }

  listCustomFolders(): string[] {
    return [...this.customFolders].sort((left, right) => left.localeCompare(right));
  }

  // ── Enabled / disabled ────────────────────────────────────────

  isEnabled(id: string): boolean {
    return !this.disabledSkills.has(id) && !this.suspendedSkills.has(id);
  }

  /**
   * Enable a skill — the user's act. Throws if the skill has a failed security
   * scan, preventing unsafe skills from being used by agents. Lifts a
   * suspension too, since the user asked for the skill on.
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
    this.suspendedSkills.delete(id);
  }

  /** Disable a skill — the user's act. Survives any suspension being lifted. */
  disable(id: string): void {
    this.disabledSkills.add(id);
  }

  /**
   * Switch a skill off because what backs it is unavailable. Not the user's
   * choice: never persisted, and lifted by `resume` without touching anything
   * the user decided.
   */
  suspend(id: string, reason: string): void {
    this.suspendedSkills.set(id, reason);
  }

  /**
   * Lift a suspension. Re-enables the skill only if the user has not disabled
   * it; a skill the user turned off stays off. Returns whether a suspension was
   * lifted.
   */
  resume(id: string): boolean {
    return this.suspendedSkills.delete(id);
  }

  /** Why the system suspended a skill, or `undefined` when it has not. */
  getSuspensionReason(id: string): string | undefined {
    return this.suspendedSkills.get(id);
  }

  /** Overwrite the user's disabled set (used during state restore from globalState). Suspensions are untouched. */
  setDisabledIds(ids: string[]): void {
    this.disabledSkills = new Set(ids);
  }

  /** The skills the user disabled — what is persisted. Suspended skills are not included. */
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
   * Return the enabled skills eligible for a given agent before per-turn
   * relevance and capability narrowing.
   */
  getSkillsForAgent(agent: AgentDefinition): SkillDefinition[] {
    const policy = resolveAgentSkillPolicy(agent);
    const explicitlyNamed = [...new Set(agent.skills)]
      .map(id => this.skills.get(id))
      .filter((s): s is SkillDefinition => s !== undefined);
    const candidates = policy === 'all'
      ? this.listSkills()
      : policy === 'allowlist' || explicitlyNamed.length > 0
        ? explicitlyNamed
        : this.listSkills().filter(skill => skill.builtIn === true && !isMcpSkill(skill));

    return candidates.filter(s => this.isEnabled(s.id));
  }
}

/**
 * Safe compatibility rule for persisted agents created before `skillPolicy`.
 * A populated list remains an allowlist; an empty list becomes task-scoped
 * built-ins rather than silently inheriting every present and future skill.
 */
export function resolveAgentSkillPolicy(agent: Pick<AgentDefinition, 'skills' | 'skillPolicy'>): AgentSkillPolicy {
  if (agent.skillPolicy === 'task-scoped' || agent.skillPolicy === 'allowlist' || agent.skillPolicy === 'all') {
    return agent.skillPolicy;
  }
  return agent.skills.length > 0 ? 'allowlist' : 'task-scoped';
}

function getUserCustomSkillFolderPath(skill: SkillDefinition): string | undefined {
  if (skill.builtIn || isMcpSkill(skill)) {
    return undefined;
  }
  return normalizeFolderPath(skill.panelPath);
}

function isMcpSkill(skill: Pick<SkillDefinition, 'id' | 'source'>): boolean {
  return skill.id.startsWith('mcp:') || skill.source?.startsWith('mcp://') === true;
}

function normalizeFolderPath(folderPath: string | string[] | undefined): string | undefined {
  if (!folderPath) {
    return undefined;
  }

  const segments = Array.isArray(folderPath)
    ? folderPath
    : folderPath.split(/[\\/]+/);
  const normalized = segments
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0);

  return normalized.length > 0 ? normalized.join('/') : undefined;
}

