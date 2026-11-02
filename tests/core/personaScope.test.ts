import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  PERSONA_HOST_DELIVERY_NOTE,
  isWithheldForHostDelivery,
  personaCapabilityEnvelope,
  personaHandoffRefusal,
  readPersonaScope,
  resolveScopedCandidates,
  skillAllowedByPersonaCeiling,
  withPersonaInstructions,
} from '../../src/core/personaScope.ts';
import type { AgentDefinition, PersonaScope } from '../../src/types.ts';

const agent = (id: string): AgentDefinition => ({ id, name: id, role: id, description: id, systemPrompt: `You are ${id}.`, skills: [] });

const SCOPE: PersonaScope = {
  personaId: 'am-engineer',
  allowedAgentIds: ['backend-engineer', 'frontend-engineer'],
  preferredAgentId: 'backend-engineer',
  skillCeiling: { mode: 'member' },
};

describe('readPersonaScope', () => {
  it('reads a well-formed scope and nothing else', () => {
    expect(readPersonaScope(SCOPE)).toEqual(SCOPE);
    for (const bad of [
      undefined,
      [],
      { ...SCOPE, personaId: 'AM Engineer' },
      { ...SCOPE, allowedAgentIds: [] },
      { ...SCOPE, preferredAgentId: 'default' },
      { ...SCOPE, skillCeiling: { mode: 'everything' } },
      { ...SCOPE, skillCeiling: { mode: 'allowlist', skillIds: [] } },
      { ...SCOPE, hostDelivery: 'model' },
    ]) {
      expect(readPersonaScope(bad)).toBeUndefined();
    }
  });
});

describe('resolveScopedCandidates', () => {
  it('keeps the persona\'s order and never adds an agent from outside it', () => {
    const resolved = resolveScopedCandidates(SCOPE, [agent('default'), agent('frontend-engineer'), agent('backend-engineer')]);
    expect(resolved).toMatchObject({ kind: 'ok', notices: [] });
    if (resolved.kind === 'ok') {
      expect(resolved.candidates.map(candidate => candidate.id)).toEqual(['backend-engineer', 'frontend-engineer']);
      expect(resolved.preferred.id).toBe('backend-engineer');
    }
  });

  it('degrades with a notice when a member or the lead is missing', () => {
    const resolved = resolveScopedCandidates(SCOPE, [agent('frontend-engineer')]);
    expect(resolved.kind).toBe('ok');
    if (resolved.kind === 'ok') {
      expect(resolved.preferred.id).toBe('frontend-engineer');
      expect(resolved.notices.join(' ')).toMatch(/degraded.*backend-engineer/);
      expect(resolved.notices.join(' ')).toMatch(/preferred member backend-engineer is unavailable/);
    }
  });

  it('refuses when no member can run', () => {
    expect(resolveScopedCandidates(SCOPE, [agent('default')])).toMatchObject({ kind: 'refused' });
  });
});

describe('the skill ceiling', () => {
  it('member keeps everything, allowlist intersects, read-only goes through the envelope', () => {
    expect(skillAllowedByPersonaCeiling('file-write', { mode: 'member' })).toBe(true);
    expect(skillAllowedByPersonaCeiling('file-write', { mode: 'allowlist', skillIds: ['file-read'] })).toBe(false);
    expect(skillAllowedByPersonaCeiling('file-read', { mode: 'allowlist', skillIds: ['file-read'] })).toBe(true);
    expect(personaCapabilityEnvelope({ ...SCOPE, skillCeiling: { mode: 'read-only' } }))
      .toEqual({ writesAllowed: false, commandsAllowed: false, reason: 'persona am-engineer is read-only' });
    expect(personaCapabilityEnvelope(SCOPE)).toBeUndefined();
  });

  it('never gives a member a skill it did not already have (property)', () => {
    const skillId = fc.stringMatching(/^[a-z]{1,8}$/);
    fc.assert(fc.property(fc.array(skillId), fc.array(skillId, { minLength: 1 }), (memberSkills, allowlist) => {
      const kept = memberSkills.filter(skill => skillAllowedByPersonaCeiling(skill, { mode: 'allowlist', skillIds: allowlist }));
      return kept.every(skill => memberSkills.includes(skill) && allowlist.includes(skill));
    }));
  });
});

describe('host delivery', () => {
  const delivered: PersonaScope = { ...SCOPE, hostDelivery: 'buzz-acp' };

  it('withholds Buzz sends only when the host delivers the reply', () => {
    for (const id of ['mcp:atlasmind-buzz-comms:buzz_post_message', 'mcp:buzz:buzz_send_dm', 'mcp:team-buzz:reply_to_thread']) {
      expect(isWithheldForHostDelivery(id, delivered)).toBe(true);
      expect(isWithheldForHostDelivery(id, SCOPE)).toBe(false);
    }
    for (const id of ['mcp:atlasmind-buzz-comms:buzz_read_thread', 'mcp:atlasmind-buzz-comms:buzz_list_channels', 'file-read', 'mcp:github:create_issue']) {
      expect(isWithheldForHostDelivery(id, delivered)).toBe(false);
    }
  });

  it('adds the instruction to a copy of the worker, once', () => {
    const worker = agent('backend-engineer');
    const instructed = withPersonaInstructions(worker, delivered);
    expect(instructed.systemPrompt).toContain(PERSONA_HOST_DELIVERY_NOTE);
    expect(worker.systemPrompt).not.toContain(PERSONA_HOST_DELIVERY_NOTE);
    expect(withPersonaInstructions(instructed, delivered).systemPrompt).toBe(instructed.systemPrompt);
    expect(withPersonaInstructions(worker, SCOPE)).toBe(worker);
  });
});

describe('personaHandoffRefusal', () => {
  it('allows members and names the boundary for anyone else', () => {
    expect(personaHandoffRefusal('frontend-engineer', SCOPE)).toBeUndefined();
    expect(personaHandoffRefusal('security-reviewer', SCOPE)).toMatch(/not a member of persona am-engineer/);
  });
});
