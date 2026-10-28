/**
 * Where each Buzz persona stands on this machine (Buzz Tier 5, Phase 5).
 *
 * The project file says which teams exist; whether one has been prepared, and
 * which Buzz identity answered its check, is a fact about one developer's
 * setup, so it lives in workspace state and never in the repository. This
 * module reads that record defensively and turns it, with the project file and
 * the live registry, into what the Director's *Buzz agents* card says.
 *
 * Five rules.
 *
 * 1. **Verified means answered.** Only an identity that answered a signed
 *    check (`buzzPersonaVerification`) is shown as running a persona; prepared
 *    is prepared, and the card says nothing was proven.
 * 2. **A change is stale until resynchronised.** When the definitions or ACP
 *    settings would export a different manifest, the persona is stale whatever
 *    it was before, because the identity runs what was prepared, not what the
 *    editor holds now.
 * 3. **Prepared again means verify again.** A verification belongs to the
 *    manifest it answered with.
 * 4. **Default routing is unavailable, and the card says why.** Buzz's harness
 *    can give one agent every message in a channel, but nothing verified yet
 *    keeps that agent quiet when another persona is mentioned, so offering
 *    *Default* would produce two answers. Every persona is mention-only until
 *    that is proven for the Buzz build in use.
 * 5. **Nothing secret, nothing private.** The view carries ids, names, short
 *    key prefixes and dates — never a prompt, a path, a key or a message.
 */

import type { BuzzPersonaDocument, BuzzPersonaFinding, BuzzPersonaProfile } from './buzzPersonaProfiles.js';
import type { BuzzPersonaRecommendation } from './buzzAgentRecommendations.js';

export const PERSONA_DEPLOYMENTS_KEY = 'atlasmind.buzz.personaDeployments';
/** "Not now" on a suggestion, by suggestion id → the registry fingerprint it was set aside at. */
export const PERSONA_RECOMMENDATION_DISMISSALS_KEY = 'atlasmind.buzz.personaRecommendationDismissals';

/** The Buzz identity that answered a persona's check. Public keys only. */
export interface PersonaVerifiedIdentity {
  pubkey: string;
  ownerPubkey: string;
  verifiedAt: string;
  /** The manifest the identity answered with. */
  manifestFingerprint: string;
}

/** What this machine knows about a prepared persona. Never a key, never a message. */
export interface PersonaDeploymentRecord {
  manifestFingerprint: string;
  preparedAt: string;
  status: 'prepared' | 'verified';
  identity?: PersonaVerifiedIdentity;
}

const HEX64 = /^[0-9a-f]{64}$/;
const PERSONA_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

/** Read the stored record; an entry that does not read cleanly is dropped. */
export function readPersonaDeployments(raw: unknown): Record<string, PersonaDeploymentRecord> {
  const result: Record<string, PersonaDeploymentRecord> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return result;
  }
  for (const [id, value] of Object.entries(raw as Record<string, unknown>).slice(0, 50)) {
    const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
    if (!PERSONA_ID.test(id) || !record || typeof record['manifestFingerprint'] !== 'string' || !HEX64.test(record['manifestFingerprint'])
      || !isIsoDate(record['preparedAt'])) {
      continue;
    }
    const identityRaw = record['identity'] && typeof record['identity'] === 'object' ? record['identity'] as Record<string, unknown> : undefined;
    const identity = identityRaw
      && typeof identityRaw['pubkey'] === 'string' && HEX64.test(identityRaw['pubkey'])
      && typeof identityRaw['ownerPubkey'] === 'string' && HEX64.test(identityRaw['ownerPubkey'])
      && isIsoDate(identityRaw['verifiedAt'])
      && typeof identityRaw['manifestFingerprint'] === 'string' && HEX64.test(identityRaw['manifestFingerprint'])
      ? {
        pubkey: identityRaw['pubkey'],
        ownerPubkey: identityRaw['ownerPubkey'],
        verifiedAt: identityRaw['verifiedAt'],
        manifestFingerprint: identityRaw['manifestFingerprint'],
      }
      : undefined;
    result[id] = {
      manifestFingerprint: record['manifestFingerprint'],
      preparedAt: record['preparedAt'],
      status: identity ? 'verified' : 'prepared',
      ...(identity ? { identity } : {}),
    };
  }
  return result;
}

/**
 * Record a verified identity against a persona. One Buzz identity runs one
 * persona, so the key is removed from any other persona it was recorded for;
 * the names of those personas are returned so the caller can say so.
 */
export function recordVerifiedIdentity(
  deployments: Record<string, PersonaDeploymentRecord>,
  personaId: string,
  identity: PersonaVerifiedIdentity,
): { next: Record<string, PersonaDeploymentRecord>; displaced: string[] } {
  const current = deployments[personaId];
  if (!current) {
    return { next: deployments, displaced: [] };
  }
  const next: Record<string, PersonaDeploymentRecord> = {};
  const displaced: string[] = [];
  for (const [id, record] of Object.entries(deployments)) {
    if (id !== personaId && record.identity?.pubkey === identity.pubkey) {
      displaced.push(id);
      const { identity: _dropped, ...rest } = record;
      void _dropped;
      next[id] = { ...rest, status: 'prepared' };
    } else {
      next[id] = record;
    }
  }
  next[personaId] = { ...current, status: 'verified', identity };
  return { next, displaced };
}

export type PersonaDeploymentState = 'not-prepared' | 'prepared' | 'verified' | 'stale-manifest' | 'reverify';

export interface BuzzPersonaCardPersona {
  id: string;
  displayName: string;
  purpose: string;
  members: string[];
  lead: string;
  ceiling: BuzzPersonaProfile['skillCeiling']['mode'];
  independence: BuzzPersonaProfile['independenceClass'];
  problems: string[];
  state: PersonaDeploymentState;
  stateDetail: string;
  identity?: { pubkey: string; ownerPubkey: string; verifiedAt: string };
}

export interface BuzzPersonaCardView {
  file: string;
  fileState: 'absent' | 'ok' | 'unreadable';
  fileNotice?: string;
  personas: BuzzPersonaCardPersona[];
  suggestions: Array<{ id: string; displayName: string; memberCount: number; lead: string; optional: boolean }>;
  responseMode: { mode: 'mention-only'; defaultAvailable: false; reason: string };
}

/** Rule 4, stated once so the card and the docs cannot drift. */
export const PERSONA_DEFAULT_ROUTING_UNAVAILABLE = 'Every persona answers only when mentioned. A channel default needs Buzz to give one persona '
  + 'every message nobody is addressed in and none addressed to another persona; that has not been verified for this Buzz build, '
  + 'so offering it could produce two answers to one message.';

const short = (key: string): string => `${key.slice(0, 12)}…`;
const day = (iso: string): string => iso.slice(0, 10);

function deploymentState(
  record: PersonaDeploymentRecord | undefined,
  currentFingerprint: string | undefined,
): { state: PersonaDeploymentState; detail: string } {
  if (!record) {
    return { state: 'not-prepared', detail: 'Not prepared yet. Preparing writes its manifest and copies the Buzz launch recipe.' };
  }
  if (currentFingerprint !== undefined && currentFingerprint !== record.manifestFingerprint) {
    return {
      state: 'stale-manifest',
      detail: `Its agents or ACP settings changed since it was prepared on ${day(record.preparedAt)}. Resynchronise, restart it in Buzz, then verify again.`,
    };
  }
  if (record.identity && record.identity.manifestFingerprint === record.manifestFingerprint) {
    return {
      state: 'verified',
      detail: `Answered a signed check from ${short(record.identity.pubkey)}, authorised by ${short(record.identity.ownerPubkey)}, on ${day(record.identity.verifiedAt)}.`,
    };
  }
  if (record.identity) {
    return { state: 'reverify', detail: `Prepared again on ${day(record.preparedAt)} since its identity was verified. Restart it in Buzz and verify again.` };
  }
  return {
    state: 'prepared',
    detail: `Prepared on ${day(record.preparedAt)}. Nothing has answered a check yet — copying a recipe does not show that an identity runs it.`,
  };
}

export interface BuzzPersonaCardInput {
  file: string;
  read: { document?: BuzzPersonaDocument; exists: boolean; preserveExisting: boolean; findings: readonly BuzzPersonaFinding[]; notice?: string };
  validation: readonly BuzzPersonaFinding[];
  deployments: Record<string, PersonaDeploymentRecord>;
  /** What the editor would export now, per persona; `undefined` when it cannot. */
  currentFingerprints: Record<string, string | undefined>;
  suggestions: readonly BuzzPersonaRecommendation[];
}

export function describeBuzzPersonaCard(input: BuzzPersonaCardInput): BuzzPersonaCardView {
  const fileState: BuzzPersonaCardView['fileState'] = !input.read.exists
    ? 'absent'
    : input.read.document ? 'ok' : 'unreadable';
  const fileNotice = fileState === 'unreadable'
    ? (input.read.findings[0]?.message ?? input.read.notice ?? 'This build cannot read it.')
    : undefined;
  const personas = (input.read.document?.profiles ?? []).map(profile => {
    const { state, detail } = deploymentState(input.deployments[profile.id], input.currentFingerprints[profile.id]);
    const record = input.deployments[profile.id];
    const problems = [...input.read.findings, ...input.validation]
      .filter(finding => finding.profileId === profile.id)
      .map(finding => finding.message);
    return {
      id: profile.id,
      displayName: profile.displayName,
      purpose: profile.purpose,
      members: [...profile.agentIds],
      lead: profile.preferredAgentId,
      ceiling: profile.skillCeiling.mode,
      independence: profile.independenceClass,
      problems,
      state,
      stateDetail: detail,
      ...(state === 'verified' && record?.identity
        ? { identity: { pubkey: record.identity.pubkey, ownerPubkey: record.identity.ownerPubkey, verifiedAt: record.identity.verifiedAt } }
        : {}),
    };
  });
  return {
    file: input.file,
    fileState,
    ...(fileNotice ? { fileNotice } : {}),
    personas,
    suggestions: input.suggestions.map(suggestion => ({
      id: suggestion.id,
      displayName: suggestion.displayName,
      memberCount: suggestion.members.length,
      lead: suggestion.preferredAgentId,
      optional: suggestion.optional,
    })),
    responseMode: { mode: 'mention-only', defaultAvailable: false, reason: PERSONA_DEFAULT_ROUTING_UNAVAILABLE },
  };
}
