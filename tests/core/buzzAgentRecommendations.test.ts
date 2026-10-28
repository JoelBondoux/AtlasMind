import { describe, expect, it } from 'vitest';
import { BUILTIN_AGENT_DEFAULTS } from '../../src/runtime/core.ts';
import {
  BUZZ_RECOMMENDATION_RULESET_VERSION,
  agentRegistryFingerprint,
  describeRecommendation,
  isReviewOnlyAgent,
  pendingRecommendations,
  recommendBuzzPersonas,
  recommendationToProfile,
} from '../../src/core/buzzAgentRecommendations.ts';
import { sanitizeBuzzPersonaDocument } from '../../src/core/buzzPersonaProfiles.ts';
import type { AgentDefinition } from '../../src/types.ts';

const builtIns = (): AgentDefinition[] => BUILTIN_AGENT_DEFAULTS.map(agent => ({ ...agent }));
const byId = (recommendations: ReturnType<typeof recommendBuzzPersonas>) => new Map(recommendations.map(entry => [entry.id, entry]));

describe('recommendBuzzPersonas over the built-in agents', () => {
  const recommendations = recommendBuzzPersonas(builtIns());
  const teams = byId(recommendations);

  it('suggests the declared families, in order, with the coordinator last and optional', () => {
    expect(recommendations.map(entry => entry.id)).toEqual(['am-engineer', 'am-business', 'am-marketing', 'am-research', 'am-oversight', 'am-coordinator']);
    expect(teams.get('am-coordinator')!.optional).toBe(true);
    expect(recommendations.every(entry => entry.rulesetVersion === BUZZ_RECOMMENDATION_RULESET_VERSION)).toBe(true);
  });

  it('puts the delivery agents in AM Engineer, led by the architecture holder', () => {
    const engineer = teams.get('am-engineer')!;
    const members = engineer.members.map(member => member.agentId);
    expect(members).toEqual(expect.arrayContaining([
      'backend-engineer', 'frontend-engineer', 'workspace-debugger', 'code-reviewer', 'test-developer',
      'docs-writer', 'ci-analyst', 'release-manager', 'refactorer',
    ]));
    // Declared routing needs outrank prose: a researcher is not an engineer
    // because its description mentions code.
    expect(members).not.toContain('competitive-analyst');
    expect(engineer.preferredAgentId).toBe('backend-engineer');
    expect(engineer.skillCeiling).toEqual({ mode: 'member' });
  });

  it('keeps the read-only advisors out of every team but Oversight, and says so', () => {
    const advisors = ['ethics-oversight', 'legal-oversight', 'commercial-oversight'];
    for (const advisor of advisors) {
      expect(isReviewOnlyAgent(BUILTIN_AGENT_DEFAULTS.find(agent => agent.id === advisor)!)).toBe(true);
    }
    for (const entry of recommendations.filter(recommendation => recommendation.id !== 'am-oversight')) {
      expect(entry.members.some(member => advisors.includes(member.agentId))).toBe(false);
    }
    expect(teams.get('am-business')!.notes.join(' ')).toMatch(/Kept out to stay independent: commercial-oversight/);
    const oversight = teams.get('am-oversight')!;
    expect(oversight.members.map(member => member.agentId)).toEqual(expect.arrayContaining(advisors));
    expect(oversight.skillCeiling).toEqual({ mode: 'read-only' });
    expect(oversight.independenceClass).toBe('oversight');
    expect(oversight.members.find(member => member.agentId === 'commercial-oversight')!.reasons.map(reason => reason.rule)).toEqual(['review-only-advisor']);
  });

  it('fronts each non-oversight team lead in the coordinator, and no advisor', () => {
    const coordinator = teams.get('am-coordinator')!;
    expect(coordinator.members.map(member => member.agentId)).toEqual(['default', 'backend-engineer', 'competitive-analyst', 'seo-specialist']);
  });

  it('lets one agent serve several teams, and narrows it in Oversight', () => {
    const inEngineer = teams.get('am-engineer')!.members.some(member => member.agentId === 'security-reviewer');
    const inOversight = teams.get('am-oversight')!.members.some(member => member.agentId === 'security-reviewer');
    expect(inEngineer && inOversight).toBe(true);
    expect(teams.get('am-oversight')!.notes.join(' ')).toMatch(/Narrowed to reading inside this persona: .*security-reviewer/);
  });

  it('leaves out an agent with no routing need, testing duty or matching role words', () => {
    expect(recommendations.some(entry => entry.members.some(member => member.agentId === 'memory-agent'))).toBe(false);
  });

  it('names the rule behind every member', () => {
    for (const entry of recommendations) {
      for (const member of entry.members) {
        expect(member.reasons.length).toBeGreaterThan(0);
      }
    }
    expect(describeRecommendation(teams.get('am-engineer')!)).toMatch(/backend-engineer is the primary handler for backend, architecture \[routing-need/);
  });

  it('accepts as a profile the sanitizer keeps unchanged', () => {
    for (const entry of recommendations) {
      const profile = recommendationToProfile(entry);
      const { document, findings } = sanitizeBuzzPersonaDocument({ version: 1, profiles: [profile] });
      expect(findings).toEqual([]);
      expect(document!.profiles[0]).toEqual(profile);
    }
  });
});

describe('determinism and change', () => {
  it('gives the same suggestion whatever order the registry lists agents in', () => {
    const agents = builtIns();
    expect(recommendBuzzPersonas([...agents].reverse())).toEqual(recommendBuzzPersonas(agents));
  });

  it('ignores a disabled agent and changes the fingerprint when the registry changes', () => {
    const agents = builtIns();
    const without = agents.filter(agent => agent.id !== 'frontend-engineer');
    const recommendation = byId(recommendBuzzPersonas(without)).get('am-engineer')!;
    expect(recommendation.members.some(member => member.agentId === 'frontend-engineer')).toBe(false);
    expect(agentRegistryFingerprint(without)).not.toBe(agentRegistryFingerprint(agents));
    expect(agentRegistryFingerprint([...agents].reverse())).toBe(agentRegistryFingerprint(agents));
  });

  it('suggests no research team when there is only one researcher, and no coordinator below three teams', () => {
    const agents: AgentDefinition[] = [
      { id: 'solo-researcher', name: 'R', role: 'researcher', description: 'Research.', systemPrompt: '', skills: [], primaryRoutingNeeds: ['research'] },
      { id: 'builder', name: 'B', role: 'engineer', description: 'Builds.', systemPrompt: '', skills: [], primaryRoutingNeeds: ['backend'] },
    ];
    expect(recommendBuzzPersonas(agents).map(entry => entry.id)).toEqual(['am-engineer']);
  });
});

describe('pendingRecommendations', () => {
  const recommendations = recommendBuzzPersonas(builtIns());

  it('hides an accepted team and one dismissed against this registry, until the registry changes', () => {
    const accepted = sanitizeBuzzPersonaDocument({ version: 1, profiles: [recommendationToProfile(recommendations[0]!)] }).document;
    const fingerprint = recommendations[1]!.registryFingerprint;
    const pending = pendingRecommendations(recommendations, accepted, { 'am-business': fingerprint });
    expect(pending.map(entry => entry.id)).not.toContain('am-engineer');
    expect(pending.map(entry => entry.id)).not.toContain('am-business');
    expect(pendingRecommendations(recommendations, accepted, { 'am-business': 'an-older-registry' }).map(entry => entry.id)).toContain('am-business');
  });
});
