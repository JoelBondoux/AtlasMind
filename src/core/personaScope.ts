/**
 * The limit a Buzz persona puts on one turn (Buzz Tier 5, Phase 3).
 *
 * A persona answers in Buzz as one signed author, but the work inside it is
 * still AtlasMind's: the classifier, the router, memory, skills, approvals and
 * handoffs all run as normal. What changes is *who* may be chosen. A turn in
 * scope selects only among the persona's members, hands off only to them,
 * synthesises nobody, and gives the selected worker no more authority than
 * its own — narrowed further by the persona's ceiling, never widened by it.
 *
 * Four rules.
 *
 * 1. **The scope is host data.** It arrives as a typed argument from the host
 *    that launched the persona, never from prompt text, so a message cannot
 *    name a wider team.
 * 2. **Members only, and no fallback to the registry.** A missing preferred
 *    member degrades to another member with a notice; no usable member refuses
 *    the turn. Reaching for the global registry would make the persona a label
 *    rather than a boundary.
 * 3. **Intersection, never union.** `member` keeps the selected agent's own
 *    skills; `allowlist` intersects them; `read-only` narrows every member to
 *    reads through the same capability envelope a read-only chat turn uses.
 *    Adding a member never widens another member's authority.
 * 4. **The host delivers the reply.** When the ACP host publishes the answer to
 *    Buzz, every selected and delegated worker is told so, and Buzz messaging
 *    tools are withheld, so one turn produces exactly one message.
 *
 * Pure: no `vscode`, no registry, no I/O.
 */

import type { AgentDefinition, PersonaScope, PersonaSkillCeiling } from '../types.js';
import type { TurnCapabilityEnvelope } from './orchestrator.js';

/** The trusted instruction every worker in a host-delivered persona receives. */
export const PERSONA_HOST_DELIVERY_NOTE = [
  'You are answering as part of a Buzz persona. When a prompt contains Buzz channel instructions, answer the user normally.',
  'Do not invoke Buzz messaging, shell, or MCP tools to deliver the answer; the AtlasMind ACP host publishes the final response through its communication-only bridge.',
].join('\n');

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const SKILL_ID = /^[A-Za-z0-9:._-]{1,80}$/;

/** Buzz tool names that post a message: the host owns that send. */
const BUZZ_DELIVERY_TOOL = /^buzz_(?:post_message|send_dm|reply|publish)/;

function isCeiling(value: unknown): value is PersonaSkillCeiling {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record['mode'] === 'member' || record['mode'] === 'read-only') {
    return true;
  }
  return record['mode'] === 'allowlist'
    && Array.isArray(record['skillIds'])
    && record['skillIds'].length > 0
    && record['skillIds'].every(id => typeof id === 'string' && SKILL_ID.test(id));
}

/**
 * A scope read back from an untyped carrier (the request's internal context),
 * or `undefined` if it is not one. A malformed scope is never partly honoured:
 * the caller that put it there refuses rather than running unscoped.
 */
export function readPersonaScope(value: unknown): PersonaScope | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const members = record['allowedAgentIds'];
  if (typeof record['personaId'] !== 'string' || !SLUG.test(record['personaId'])
    || !Array.isArray(members) || members.length === 0
    || !members.every(member => typeof member === 'string' && member.length > 0 && member.length <= 120)
    || typeof record['preferredAgentId'] !== 'string' || !members.includes(record['preferredAgentId'])
    || !isCeiling(record['skillCeiling'])
    || (record['hostDelivery'] !== undefined && record['hostDelivery'] !== 'buzz-acp')) {
    return undefined;
  }
  return {
    personaId: record['personaId'],
    allowedAgentIds: [...new Set(members as string[])],
    preferredAgentId: record['preferredAgentId'],
    skillCeiling: record['skillCeiling'],
    ...(record['hostDelivery'] === 'buzz-acp' ? { hostDelivery: 'buzz-acp' as const } : {}),
  };
}

export type ScopedCandidates =
  | { kind: 'ok'; candidates: AgentDefinition[]; preferred: AgentDefinition; notices: string[] }
  | { kind: 'refused'; reason: string };

/**
 * The members this turn may choose from, in the order the persona names them.
 * `enabled` is the registry's enabled agents; a member it does not contain is
 * reported and skipped, never replaced.
 */
export function resolveScopedCandidates(scope: PersonaScope, enabled: readonly AgentDefinition[]): ScopedCandidates {
  const byId = new Map(enabled.map(agent => [agent.id, agent]));
  const candidates: AgentDefinition[] = [];
  const missing: string[] = [];
  for (const id of scope.allowedAgentIds) {
    const agent = byId.get(id);
    if (agent) {
      candidates.push(agent);
    } else {
      missing.push(id);
    }
  }
  if (candidates.length === 0) {
    return {
      kind: 'refused',
      reason: `Persona ${scope.personaId} has no enabled member (${scope.allowedAgentIds.join(', ')}), so it cannot answer. `
        + 'Enable one of its agents or edit the persona; AtlasMind does not borrow an agent from outside it.',
    };
  }
  const notices: string[] = [];
  if (missing.length > 0) {
    notices.push(`Persona ${scope.personaId} is degraded: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not available.`);
  }
  let preferred = byId.get(scope.preferredAgentId);
  if (!preferred || !candidates.includes(preferred)) {
    preferred = candidates[0]!;
    notices.push(`The preferred member ${scope.preferredAgentId} is unavailable, so ${preferred.id} leads this turn.`);
  }
  return { kind: 'ok', candidates, preferred, notices };
}

/** Whether a skill survives the persona's ceiling (the read-only half is the envelope's). */
export function skillAllowedByPersonaCeiling(skillId: string, ceiling: PersonaSkillCeiling): boolean {
  return ceiling.mode !== 'allowlist' || ceiling.skillIds.includes(skillId);
}

/** Whether a skill is a Buzz send the host owns for this scope. */
export function isWithheldForHostDelivery(skillId: string, scope: PersonaScope): boolean {
  if (scope.hostDelivery !== 'buzz-acp') {
    return false;
  }
  const match = /^mcp:([^:]+):(.+)$/.exec(skillId);
  if (!match) {
    return false;
  }
  const [, serverId, toolName] = match;
  return BUZZ_DELIVERY_TOOL.test(toolName!)
    || (/buzz/i.test(serverId!) && /(?:post|send|reply|publish|message|dm)/i.test(toolName!));
}

/** The capability envelope a `read-only` persona imposes on every member. */
export function personaCapabilityEnvelope(scope: PersonaScope): TurnCapabilityEnvelope | undefined {
  return scope.skillCeiling.mode === 'read-only'
    ? { writesAllowed: false, commandsAllowed: false, reason: `persona ${scope.personaId} is read-only` }
    : undefined;
}

/** A copy of the worker carrying the persona's trusted instructions. Never mutates the registered agent. */
export function withPersonaInstructions(agent: AgentDefinition, scope: PersonaScope): AgentDefinition {
  if (scope.hostDelivery !== 'buzz-acp' || agent.systemPrompt.includes(PERSONA_HOST_DELIVERY_NOTE)) {
    return agent;
  }
  return { ...agent, systemPrompt: [agent.systemPrompt, PERSONA_HOST_DELIVERY_NOTE].filter(Boolean).join('\n\n') };
}

/** Why a handoff target is outside the persona, or `undefined` when it is a member. */
export function personaHandoffRefusal(targetAgentId: string, scope: PersonaScope): string | undefined {
  if (scope.allowedAgentIds.includes(targetAgentId)) {
    return undefined;
  }
  return `Handoff refused (outside persona): \`${targetAgentId}\` is not a member of persona ${scope.personaId}. `
    + `You may hand off only to ${scope.allowedAgentIds.join(', ')}. Answer with what you have, or report what is missing.`;
}
