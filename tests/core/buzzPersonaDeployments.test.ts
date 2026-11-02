import { describe, expect, it } from 'vitest';
import {
  PERSONA_DEFAULT_ROUTING_UNAVAILABLE,
  describeBuzzPersonaCard,
  readPersonaDeployments,
  recordVerifiedIdentity,
  type PersonaDeploymentRecord,
} from '../../src/core/buzzPersonaDeployments.ts';
import type { BuzzPersonaDocument, BuzzPersonaProfile } from '../../src/core/buzzPersonaProfiles.ts';

const FP_A = 'a'.repeat(64);
const FP_B = 'b'.repeat(64);
const KEY_1 = '1'.repeat(64);
const KEY_2 = '2'.repeat(64);
const OWNER = 'f'.repeat(64);

const profile = (id: string, extra: Partial<BuzzPersonaProfile> = {}): BuzzPersonaProfile => ({
  id,
  displayName: id.toUpperCase(),
  purpose: 'Delivery',
  agentIds: ['backend-engineer', 'frontend-engineer'],
  preferredAgentId: 'backend-engineer',
  routingMode: 'scoped-orchestration',
  independenceClass: 'execution',
  skillCeiling: { mode: 'member' },
  ...extra,
});

const identity = (pubkey: string, fingerprint = FP_A) => ({ pubkey, ownerPubkey: OWNER, verifiedAt: '2026-10-28T12:00:00.000Z', manifestFingerprint: fingerprint });
const prepared = (fingerprint = FP_A, extra: Partial<PersonaDeploymentRecord> = {}): PersonaDeploymentRecord => ({
  manifestFingerprint: fingerprint, preparedAt: '2026-10-28T10:00:00.000Z', status: 'prepared', ...extra,
});

describe('readPersonaDeployments', () => {
  it('keeps clean records and drops what does not read cleanly', () => {
    const read = readPersonaDeployments({
      'am-engineer': { manifestFingerprint: FP_A, preparedAt: '2026-10-28T10:00:00.000Z', status: 'prepared', identity: identity(KEY_1) },
      'am-oversight': { manifestFingerprint: FP_A, preparedAt: '2026-10-28T10:00:00.000Z', identity: { pubkey: 'not-a-key' } },
      'AM Bad': { manifestFingerprint: FP_A, preparedAt: '2026-10-28T10:00:00.000Z' },
      'am-short': { manifestFingerprint: 'abc', preparedAt: '2026-10-28T10:00:00.000Z' },
    });
    expect(Object.keys(read)).toEqual(['am-engineer', 'am-oversight']);
    expect(read['am-engineer']).toMatchObject({ status: 'verified', identity: identity(KEY_1) });
    expect(read['am-oversight']).toEqual(prepared());
    expect(readPersonaDeployments('nonsense')).toEqual({});
  });
});

describe('recordVerifiedIdentity', () => {
  it('records the identity, and clears it from a persona that held the same key', () => {
    const { next, displaced } = recordVerifiedIdentity(
      { 'am-engineer': prepared(), 'am-marketing': prepared(FP_A, { status: 'verified', identity: identity(KEY_1) }) },
      'am-engineer',
      identity(KEY_1),
    );
    expect(displaced).toEqual(['am-marketing']);
    expect(next['am-engineer']).toMatchObject({ status: 'verified', identity: identity(KEY_1) });
    expect(next['am-marketing']).toEqual(prepared());
  });

  it('records nothing for a persona that was never prepared', () => {
    const deployments = { 'am-engineer': prepared() };
    expect(recordVerifiedIdentity(deployments, 'am-ghost', identity(KEY_2))).toEqual({ next: deployments, displaced: [] });
  });
});

describe('describeBuzzPersonaCard', () => {
  const names = ['am-new', 'am-prepared', 'am-verified', 'am-stale', 'am-reverify'];
  const document: BuzzPersonaDocument = { version: 1, profiles: names.map(name => profile(name)) };
  const view = describeBuzzPersonaCard({
    file: '.atlasmind/buzz-agents.json',
    read: { document, exists: true, preserveExisting: false, findings: [] },
    validation: [{ profileId: 'am-prepared', severity: 'warning', message: 'member frontend-engineer is disabled' }],
    deployments: {
      'am-prepared': prepared(),
      'am-verified': prepared(FP_A, { status: 'verified', identity: identity(KEY_1) }),
      'am-stale': prepared(FP_A, { status: 'verified', identity: identity(KEY_2) }),
      'am-reverify': prepared(FP_B, { identity: identity('3'.repeat(64), FP_A) }),
    },
    currentFingerprints: { 'am-new': FP_A, 'am-prepared': FP_A, 'am-verified': FP_A, 'am-stale': FP_B, 'am-reverify': FP_B },
    suggestions: [],
  });

  it('gives each persona the state its record and the registry support', () => {
    expect(view.personas.map(persona => [persona.id, persona.state])).toEqual([
      ['am-new', 'not-prepared'],
      ['am-prepared', 'prepared'],
      ['am-verified', 'verified'],
      ['am-stale', 'stale-manifest'],
      ['am-reverify', 'reverify'],
    ]);
    expect(view.personas[1]!.stateDetail).toMatch(/does not show that an identity runs it/);
    expect(view.personas[1]!.problems).toEqual(['member frontend-engineer is disabled']);
  });

  it('shows an identity only while it is verified for the current manifest', () => {
    expect(view.personas.filter(persona => persona.identity).map(persona => persona.id)).toEqual(['am-verified']);
    expect(view.personas[2]!.stateDetail).toMatch(/111111111111…, authorised by ffffffffffff…/);
  });

  it('offers mention-only and says why default routing is unavailable', () => {
    expect(view.responseMode).toEqual({ mode: 'mention-only', defaultAvailable: false, reason: PERSONA_DEFAULT_ROUTING_UNAVAILABLE });
  });

  it('says an unreadable file is unreadable rather than empty', () => {
    const unreadable = describeBuzzPersonaCard({
      file: '.atlasmind/buzz-agents.json',
      read: { exists: true, preserveExisting: true, findings: [{ profileId: '(document)', severity: 'invalid', message: 'written by a newer AtlasMind' }] },
      validation: [],
      deployments: {},
      currentFingerprints: {},
      suggestions: [],
    });
    expect(unreadable).toMatchObject({ fileState: 'unreadable', fileNotice: 'written by a newer AtlasMind', personas: [] });
  });
});
