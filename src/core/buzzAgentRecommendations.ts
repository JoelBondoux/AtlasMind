/**
 * Which Buzz personas the Director should suggest (Buzz Tier 5, Phase 2).
 *
 * A persona is a small, comprehensible team — AM Engineer, AM Oversight — so a
 * Buzz channel does not see every internal agent as a separate author. Which
 * agents belong in each team is decided here, from a declared rule table, and
 * never by a model: the same registry must produce the same suggestion, and
 * every included agent names the rule that put it there.
 *
 * Six rules.
 *
 * 1. **Enabled agents only.** A disabled agent is one somebody switched off;
 *    suggesting a team around it would route around that decision.
 * 2. **Routing needs are the strongest signal**, then testing responsibilities.
 *    Role and description words count only for an agent that declares no
 *    routing needs — the orchestrator's own rule, since declared needs are an
 *    agent's routing metadata and its prose is not. An agent with none of these
 *    is not suggested anywhere, which is how a background agent stays out.
 * 3. **One agent may serve several teams.** Overlap is intended, not a conflict.
 * 4. **Oversight stays independent.** An advisor whose skills only read is never
 *    folded into another team; each card names the advisors it kept out.
 * 5. **A suggestion carries its ruleset version and a fingerprint of the
 *    registry**, so the Director can say why a suggestion changed, and a
 *    dismissal lasts until the registry it was made against changes.
 * 6. **Nothing here writes.** A suggestion becomes a profile only when a person
 *    accepts it, and an accepted profile is never rewritten from here.
 */

import type { AgentDefinition, PersonaSkillCeiling } from '../types.js';
import { classifyToolInvocation } from './toolPolicy.js';
import { fingerprint } from './workflowAuditRecord.js';
import type { BuzzPersonaDocument, BuzzPersonaProfile, PersonaIndependenceClass } from './buzzPersonaProfiles.js';

export const BUZZ_RECOMMENDATION_RULESET_VERSION = 1;

export type RecommendationRuleId = 'routing-need' | 'testing-responsibility' | 'role-words' | 'review-only-advisor';

export interface PersonaFamilyRule {
  id: string;
  displayName: string;
  purpose: string;
  independenceClass: PersonaIndependenceClass;
  skillCeiling: PersonaSkillCeiling;
  /** Routing needs this team exists to cover. */
  needs: readonly string[];
  /** Whole words in an agent's role or description that place it here. */
  words: readonly string[];
  /** Needs, in order, whose first holder leads the team. */
  leadNeeds: readonly string[];
  /** Whether a member counted by the testing-responsibility rule belongs here. */
  takesTesting?: boolean;
  /** The fewest members for the team to be worth a separate identity. */
  minimumMembers: number;
}

/**
 * The declared families. Order is the order the Director shows them in.
 * AM Coordinator is not here: it is derived from the others (see below).
 */
export const PERSONA_FAMILY_RULES: readonly PersonaFamilyRule[] = [
  {
    id: 'am-engineer',
    displayName: 'AM Engineer',
    purpose: 'Engineering delivery: architecture, code, debugging, tests, review, release and documentation.',
    independenceClass: 'execution',
    skillCeiling: { mode: 'member' },
    needs: ['architecture', 'backend', 'build', 'debugging', 'devops', 'docs', 'frontend', 'git', 'package', 'performance', 'release', 'review', 'security', 'testing'],
    words: ['engineer', 'developer', 'debugger', 'devops', 'programmer', 'qa', 'pipeline', 'changelog', 'deferred'],
    leadNeeds: ['architecture', 'backend', 'frontend', 'debugging'],
    takesTesting: true,
    minimumMembers: 1,
  },
  {
    id: 'am-business',
    displayName: 'AM Business',
    purpose: 'Product and business questions: requirements, planning, pricing, funding and commercial fit.',
    independenceClass: 'advisory',
    skillCeiling: { mode: 'member' },
    needs: ['commercial'],
    words: ['product', 'requirements', 'planning', 'business', 'finance', 'funding', 'pricing', 'strategy'],
    leadNeeds: ['commercial'],
    minimumMembers: 1,
  },
  {
    id: 'am-marketing',
    displayName: 'AM Marketing',
    purpose: 'Positioning, content, search visibility, and what customers and the market say.',
    independenceClass: 'advisory',
    skillCeiling: { mode: 'member' },
    needs: ['seo', 'ux'],
    words: ['marketing', 'positioning', 'content', 'copywriter', 'brand', 'growth', 'seo', 'campaign', 'customer', 'audience'],
    leadNeeds: ['seo', 'ux'],
    minimumMembers: 1,
  },
  {
    id: 'am-research',
    displayName: 'AM Research',
    purpose: 'Outside research: competitors, technology, markets, funding and regulation, with sources.',
    independenceClass: 'advisory',
    skillCeiling: { mode: 'member' },
    needs: ['research'],
    words: ['research', 'researcher', 'analyst'],
    leadNeeds: ['research'],
    // A research identity separate from the others is worth having only when
    // there is more than one researcher to route between.
    minimumMembers: 2,
  },
  {
    id: 'am-oversight',
    displayName: 'AM Oversight',
    purpose: 'Independent review of ethics, legal, commercial, security and quality risk. Reads; never changes anything.',
    independenceClass: 'oversight',
    skillCeiling: { mode: 'read-only' },
    needs: ['ethics', 'legal', 'security', 'review'],
    words: ['oversight', 'compliance', 'audit', 'auditor', 'ethics', 'legal', 'risk'],
    leadNeeds: ['ethics', 'legal', 'security', 'review'],
    minimumMembers: 1,
  },
];

/** The coordinator is offered only when this many other teams are suggested. */
export const COORDINATOR_MINIMUM_FAMILIES = 3;

/**
 * Skills the unknown-tool fallback grades as `network` that only read. Declared
 * here so the review-only test is a table, not a guess about names.
 */
const READ_ONLY_SKILLS_GRADED_AS_NETWORK = new Set(['web-fetch', 'exa-search', 'diagnostics', 'code-symbols', 'framework-detect']);
const WRITE_OR_EXECUTE_CATEGORIES = new Set(['workspace-write', 'git-write', 'terminal-write', 'terminal-read']);

/**
 * An advisor whose pinned skills only read: the shape of the oversight agents.
 * An agent whose skills are chosen per task can be handed a write, so it is
 * never review-only, however its role reads.
 */
export function isReviewOnlyAgent(agent: Pick<AgentDefinition, 'skills' | 'skillPolicy'>): boolean {
  if (agent.skillPolicy !== 'allowlist' || agent.skills.length === 0) {
    return false;
  }
  return agent.skills.every(skillId => {
    const category = classifyToolInvocation(skillId, {}).category;
    if (WRITE_OR_EXECUTE_CATEGORIES.has(category)) {
      return false;
    }
    return category === 'read' || category === 'git-read' || READ_ONLY_SKILLS_GRADED_AS_NETWORK.has(skillId);
  });
}

export interface RecommendationReason {
  rule: RecommendationRuleId;
  detail: string;
}

export interface RecommendedMember {
  agentId: string;
  name: string;
  reasons: RecommendationReason[];
}

export interface BuzzPersonaRecommendation {
  id: string;
  displayName: string;
  purpose: string;
  independenceClass: PersonaIndependenceClass;
  skillCeiling: PersonaSkillCeiling;
  members: RecommendedMember[];
  preferredAgentId: string;
  /** Team needs at least one member covers. */
  covered: string[];
  /** Team needs no member covers. */
  gaps: string[];
  /** What the person accepting this should know: advisors kept out, authority narrowed. */
  notes: string[];
  optional: boolean;
  rulesetVersion: number;
  registryFingerprint: string;
}

/** The registry facts a suggestion depends on, and nothing else. */
export function agentRegistryFingerprint(agents: readonly AgentDefinition[]): string {
  return fingerprint([...agents]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(agent => ({
      id: agent.id,
      role: agent.role,
      description: agent.description,
      needs: [...(agent.primaryRoutingNeeds ?? [])].sort(),
      skills: [...agent.skills].sort(),
      skillPolicy: agent.skillPolicy ?? null,
      testing: [...(agent.testingMethodologies ?? [])].sort(),
    })));
}

function wordsOf(agent: AgentDefinition): Set<string> {
  return new Set(`${agent.role} ${agent.description}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

function reasonsFor(agent: AgentDefinition, family: PersonaFamilyRule): RecommendationReason[] {
  const reasons: RecommendationReason[] = [];
  const needs = (agent.primaryRoutingNeeds ?? []).filter(need => family.needs.includes(need));
  if (needs.length > 0) {
    reasons.push({ rule: 'routing-need', detail: `is the primary handler for ${needs.join(', ')}` });
  }
  if (family.takesTesting && (agent.testingMethodologies?.length ?? 0) > 0) {
    reasons.push({ rule: 'testing-responsibility', detail: `owns ${agent.testingMethodologies!.length} testing ${agent.testingMethodologies!.length === 1 ? 'methodology' : 'methodologies'}` });
  }
  const words = (agent.primaryRoutingNeeds?.length ?? 0) > 0 ? new Set<string>() : wordsOf(agent);
  const matched = family.words.filter(word => words.has(word));
  if (matched.length > 0) {
    reasons.push({ rule: 'role-words', detail: `describes itself as ${matched.map(word => `"${word}"`).join(', ')}` });
  }
  if (family.independenceClass === 'oversight' && isReviewOnlyAgent(agent) && (agent.primaryRoutingNeeds?.length ?? 0) > 0 && reasons.length === 0) {
    reasons.push({ rule: 'review-only-advisor', detail: 'is an advisor whose skills only read' });
  }
  return reasons;
}

function chooseLead(members: RecommendedMember[], agents: Map<string, AgentDefinition>, family: PersonaFamilyRule): string {
  for (const need of family.leadNeeds) {
    const holder = members.find(member => agents.get(member.agentId)?.primaryRoutingNeeds?.includes(need));
    if (holder) {
      return holder.agentId;
    }
  }
  return members[0]!.agentId;
}

/**
 * Suggest personas for these enabled agents. Deterministic: members are in id
 * order, the lead is chosen by the family's declared lead needs, and the
 * result depends on nothing but the registry and the rule table.
 */
export function recommendBuzzPersonas(enabledAgents: readonly AgentDefinition[]): BuzzPersonaRecommendation[] {
  const agents = [...enabledAgents].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const byId = new Map(agents.map(agent => [agent.id, agent]));
  const registryFingerprint = agentRegistryFingerprint(agents);
  const recommendations: BuzzPersonaRecommendation[] = [];

  for (const family of PERSONA_FAMILY_RULES) {
    const members: RecommendedMember[] = [];
    const keptOut: string[] = [];
    for (const agent of agents) {
      const reasons = reasonsFor(agent, family);
      if (reasons.length === 0) {
        continue;
      }
      // Rule 4: an advisor that only reads keeps its independence.
      if (family.independenceClass !== 'oversight' && isReviewOnlyAgent(agent)) {
        keptOut.push(agent.id);
        continue;
      }
      members.push({ agentId: agent.id, name: agent.name, reasons });
    }
    if (members.length < family.minimumMembers) {
      continue;
    }
    const covered = family.needs.filter(need => members.some(member => byId.get(member.agentId)?.primaryRoutingNeeds?.includes(need)));
    const notes: string[] = [];
    if (keptOut.length > 0) {
      notes.push(`Kept out to stay independent: ${keptOut.join(', ')} — they review from AM Oversight instead.`);
    }
    if (family.skillCeiling.mode === 'read-only') {
      const narrowed = members.filter(member => !isReviewOnlyAgent(byId.get(member.agentId)!)).map(member => member.agentId);
      if (narrowed.length > 0) {
        notes.push(`Narrowed to reading inside this persona: ${narrowed.join(', ')} can change things elsewhere, but not here.`);
      }
    }
    recommendations.push({
      id: family.id,
      displayName: family.displayName,
      purpose: family.purpose,
      independenceClass: family.independenceClass,
      skillCeiling: family.skillCeiling,
      members: members.slice(0, 24),
      preferredAgentId: chooseLead(members, byId, family),
      covered,
      gaps: family.needs.filter(need => !covered.includes(need)),
      notes,
      optional: false,
      rulesetVersion: BUZZ_RECOMMENDATION_RULESET_VERSION,
      registryFingerprint,
    });
  }

  // AM Coordinator: one front door, worth offering only when there are several
  // distinct teams. Its members are each non-oversight team's lead, plus the
  // general assistant when there is one; oversight stays out of it.
  const fronted = recommendations.filter(recommendation => recommendation.independenceClass !== 'oversight');
  if (recommendations.length >= COORDINATOR_MINIMUM_FAMILIES) {
    const memberIds = [...new Set([
      ...(byId.has('default') && !isReviewOnlyAgent(byId.get('default')!) ? ['default'] : []),
      ...fronted.map(recommendation => recommendation.preferredAgentId),
    ])];
    recommendations.push({
      id: 'am-coordinator',
      displayName: 'AM Coordinator',
      purpose: 'One front door that hands each question to the right team lead. Optional.',
      independenceClass: 'execution',
      skillCeiling: { mode: 'member' },
      members: memberIds.map(agentId => ({
        agentId,
        name: byId.get(agentId)!.name,
        reasons: [{
          rule: 'routing-need',
          detail: agentId === 'default'
            ? 'is the general assistant'
            : `leads ${fronted.filter(recommendation => recommendation.preferredAgentId === agentId).map(recommendation => recommendation.displayName).join(', ')}`,
        }],
      })),
      preferredAgentId: memberIds[0]!,
      covered: [],
      gaps: [],
      notes: ['Offered because several teams are suggested. Accept it only if you want one identity that answers first.'],
      optional: true,
      rulesetVersion: BUZZ_RECOMMENDATION_RULESET_VERSION,
      registryFingerprint,
    });
  }
  return recommendations;
}

/** The profile a person accepts. Editing it afterwards is theirs; nothing here rewrites it. */
export function recommendationToProfile(recommendation: BuzzPersonaRecommendation): BuzzPersonaProfile {
  return {
    id: recommendation.id,
    displayName: recommendation.displayName,
    purpose: recommendation.purpose,
    agentIds: recommendation.members.map(member => member.agentId),
    preferredAgentId: recommendation.preferredAgentId,
    routingMode: 'scoped-orchestration',
    independenceClass: recommendation.independenceClass,
    skillCeiling: recommendation.skillCeiling,
  };
}

/** "Not now", remembered per developer against the registry it was said about. */
export type RecommendationDismissals = Record<string, string>;

/**
 * The suggestions still worth showing: not already accepted as a profile with
 * the same id, and not dismissed against this same registry.
 */
export function pendingRecommendations(
  recommendations: readonly BuzzPersonaRecommendation[],
  document: BuzzPersonaDocument | undefined,
  dismissals: RecommendationDismissals,
): BuzzPersonaRecommendation[] {
  const accepted = new Set((document?.profiles ?? []).map(profile => profile.id));
  return recommendations.filter(recommendation =>
    !accepted.has(recommendation.id)
    && dismissals[recommendation.id] !== recommendation.registryFingerprint);
}

/** One plain-text explanation, the same wherever a suggestion is shown. */
export function describeRecommendation(recommendation: BuzzPersonaRecommendation): string {
  const lines = [
    `${recommendation.displayName} — ${recommendation.purpose}`,
    `Leads: ${recommendation.preferredAgentId}. Authority: ${recommendation.skillCeiling.mode === 'read-only' ? 'read only' : 'each member keeps its own skills'}.`,
    ...recommendation.members.map(member => `• ${member.agentId} ${member.reasons.map(reason => reason.detail).join('; ')} [${member.reasons.map(reason => reason.rule).join(', ')}]`),
  ];
  if (recommendation.gaps.length > 0) {
    lines.push(`Not covered: ${recommendation.gaps.join(', ')}.`);
  }
  lines.push(...recommendation.notes);
  lines.push(`Ruleset v${recommendation.rulesetVersion}, registry ${recommendation.registryFingerprint}.`);
  return lines.join('\n');
}
