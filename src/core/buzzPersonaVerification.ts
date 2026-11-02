/**
 * Proving which Buzz identity runs a persona (Buzz Tier 5, Phase 5).
 *
 * Copying a launch recipe proves nothing about what Buzz did with it: the
 * agent may never have been created, may run Buzz's own runtime instead of
 * AtlasMind, or may be running an older manifest. So AtlasMind never records
 * an identity because a recipe was copied. It records one that **answered a
 * challenge**: a nonce the editor issued, carried in a mention, answered by the
 * persona process without a model, and signed by the identity's own key.
 *
 * Seven rules.
 *
 * 1. **The challenge is read from the triggering message only.** buzz-acp puts
 *    recent channel history in the prompt; reading a nonce from history would
 *    re-answer an old challenge on every later message. Only `[Event]` content
 *    counts, and the newest event wins.
 * 2. **A persona answers only its own challenge.** A challenge naming another
 *    persona gets a plain refusal, never a verified line, so one identity
 *    cannot vouch for another.
 * 3. **No model is in the answer.** The reply is a fixed line built from the
 *    nonce and the manifest fingerprint, so it is the same every time and a
 *    model cannot paraphrase it into something that no longer matches.
 * 4. **The event signature is checked here, not trusted to the relay.** The
 *    id is recomputed and the Schnorr signature verified; a remote relay that
 *    forwarded a forged event would otherwise bind a stranger's key.
 * 5. **Only an authorised agent key can answer.** The reply must carry a valid
 *    NIP-OA owner attestation. Anybody in the channel can read the nonce and
 *    type the answer line; only a key some owner authorised can sign it with
 *    an attestation, and the person confirming sees which owner that was.
 * 6. **An answer from an older manifest is reported, not accepted.** The
 *    fingerprint prefix in the line must match what was prepared; otherwise
 *    the identity is running definitions nobody reviewed.
 * 7. **A challenge expires.** Fifteen minutes from issue, measured on the
 *    signed `created_at`, so a reply cannot be replayed into a later check.
 */

import { verifyBuzzSchnorr } from './buzzSigner.js';
import { verifyOwnerAttestation, type AttestationVerifier } from './buzzOwnerAttestation.js';
import { isConversationMessage } from './buzzConversation.js';
import type { NostrEvent } from './buzzProtocol.js';

export const PERSONA_VERIFY_WORD = 'atlasmind-verify';
export const PERSONA_VERIFIED_WORD = 'atlasmind-verified';
export const PERSONA_CHALLENGE_TTL_MS = 15 * 60_000;
/** A signed `created_at` this far before issue is clock skew, not a replay. */
const CLOCK_SKEW_MS = 2 * 60_000;
const MANIFEST_PREFIX_LENGTH = 16;
const PERSONA_ID = '[a-z0-9][a-z0-9-]{0,39}';
const NONCE = '[0-9a-f]{32}';
const CHALLENGE_PATTERN = new RegExp(`(?:^|\\s)${PERSONA_VERIFY_WORD} (${PERSONA_ID}) (${NONCE})(?=\\s|$)`);
const ANSWER_PATTERN = new RegExp(`(?:^|\\s)${PERSONA_VERIFIED_WORD} (${PERSONA_ID}) (${NONCE}) manifest=([0-9a-f]{${MANIFEST_PREFIX_LENGTH}})(?=\\s|$)`);

export interface PersonaChallenge {
  personaId: string;
  nonce: string;
  /** The manifest the deployment was prepared with; its prefix must come back. */
  manifestFingerprint: string;
  issuedAt: number;
  expiresAt: number;
}

export function createPersonaChallenge(personaId: string, manifestFingerprint: string, now: number, nonce: string): PersonaChallenge {
  if (!new RegExp(`^${PERSONA_ID}$`).test(personaId) || !new RegExp(`^${NONCE}$`).test(nonce) || !/^[0-9a-f]{64}$/.test(manifestFingerprint)) {
    throw new Error('A persona challenge needs a persona id, a 32-hex nonce and a full manifest fingerprint.');
  }
  return { personaId, nonce, manifestFingerprint, issuedAt: now, expiresAt: now + PERSONA_CHALLENGE_TTL_MS };
}

/** What the person pastes into Buzz. The mention is what wakes the persona. */
export function personaChallengeMessage(challenge: PersonaChallenge, displayName: string): string {
  return `@${displayName} ${PERSONA_VERIFY_WORD} ${challenge.personaId} ${challenge.nonce}`;
}

/**
 * The triggering message's text from a buzz-acp prompt: every `[Event]`
 * section's `Content:` and the lines after it, newest last. Empty when the
 * prompt is not Buzz-shaped.
 */
function eventContents(prompt: string): string[] {
  const contents: string[] = [];
  const sections = prompt.split(/\r?\n(?=\[[^\]\r\n]{1,80}\]\r?\n)/);
  for (const section of sections) {
    if (!/^\[Event\]\r?\n/.test(section)) {
      continue;
    }
    const contentStart = section.search(/^Content:/m);
    if (contentStart >= 0) {
      contents.push(section.slice(contentStart + 'Content:'.length));
    }
  }
  return contents;
}

/** The challenge in the triggering message, if any. History is never read. */
export function readPersonaChallengeFromBuzzPrompt(prompt: string): { personaId: string; nonce: string } | undefined {
  const contents = eventContents(prompt);
  const newest = contents[contents.length - 1];
  const match = newest?.match(CHALLENGE_PATTERN);
  return match ? { personaId: match[1]!, nonce: match[2]! } : undefined;
}

/** The persona process's fixed answer: verified for its own challenge, a refusal otherwise. */
export function personaChallengeAnswer(
  ownPersonaId: string,
  challenge: { personaId: string; nonce: string },
  manifestFingerprint: string,
): string {
  if (challenge.personaId !== ownPersonaId) {
    return `This identity runs the persona ${ownPersonaId}, not ${challenge.personaId}, so it does not answer that check.`;
  }
  return `${PERSONA_VERIFIED_WORD} ${ownPersonaId} ${challenge.nonce} manifest=${manifestFingerprint.slice(0, MANIFEST_PREFIX_LENGTH)}`;
}

export type PersonaVerificationVerdict =
  | { status: 'ignored' }
  | { status: 'unknown-challenge'; personaId: string }
  | { status: 'expired'; personaId: string }
  | { status: 'invalid'; personaId: string; reason: string }
  | { status: 'stale-manifest'; personaId: string; pubkey: string; answeredWith: string; expected: string }
  | { status: 'verified'; personaId: string; nonce: string; pubkey: string; ownerPubkey: string; eventId: string; verifiedAt: number };

export interface PersonaVerificationOptions {
  now: number;
  verifier?: AttestationVerifier;
  /** AtlasMind's revocation list: a revoked key or owner proves nothing. */
  isRevoked?: (pubkey: string) => boolean;
}

/**
 * Judge one observed event against the open challenges. Never throws; an
 * event that is not an answer is `ignored`.
 */
export async function verifyPersonaAnswer(
  event: NostrEvent,
  challenges: readonly PersonaChallenge[],
  options: PersonaVerificationOptions,
): Promise<PersonaVerificationVerdict> {
  if (!isConversationMessage(event) || typeof event.content !== 'string') {
    return { status: 'ignored' };
  }
  const match = event.content.match(ANSWER_PATTERN);
  if (!match) {
    return { status: 'ignored' };
  }
  const [, personaId, nonce, manifestPrefix] = match as unknown as [string, string, string, string];
  const challenge = challenges.find(candidate => candidate.personaId === personaId && candidate.nonce === nonce);
  if (!challenge) {
    return { status: 'unknown-challenge', personaId };
  }
  const signedAt = event.created_at * 1000;
  if (!Number.isFinite(signedAt) || signedAt > challenge.expiresAt || signedAt < challenge.issuedAt - CLOCK_SKEW_MS || options.now > challenge.expiresAt + CLOCK_SKEW_MS) {
    return { status: 'expired', personaId };
  }
  let attestation;
  try {
    attestation = await verifyOwnerAttestation(event, options.verifier ?? { verifySchnorr: verifyBuzzSchnorr });
  } catch (error) {
    return { status: 'invalid', personaId, reason: `the reply could not be checked (${error instanceof Error ? error.message : String(error)})` };
  }
  if (attestation.status === 'absent') {
    return { status: 'invalid', personaId, reason: 'the reply carries no owner attestation, so it does not show that anybody authorised the key that sent it' };
  }
  if (attestation.status === 'invalid') {
    return { status: 'invalid', personaId, reason: attestation.reason };
  }
  if (options.isRevoked?.(event.pubkey) || options.isRevoked?.(attestation.ownerPubkey)) {
    return { status: 'invalid', personaId, reason: 'that identity, or the owner who authorised it, is revoked in AtlasMind' };
  }
  const expected = challenge.manifestFingerprint.slice(0, MANIFEST_PREFIX_LENGTH);
  if (manifestPrefix !== expected) {
    return { status: 'stale-manifest', personaId, pubkey: event.pubkey, answeredWith: manifestPrefix, expected };
  }
  return {
    status: 'verified',
    personaId,
    nonce,
    pubkey: event.pubkey,
    ownerPubkey: attestation.ownerPubkey,
    eventId: event.id,
    verifiedAt: options.now,
  };
}
