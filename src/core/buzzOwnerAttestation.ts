/**
 * Which human an agent's Buzz event is answerable to — Buzz Tier 4, verified
 * rather than custodied.
 *
 * The Tier 4 plan once had AtlasMind mint a keypair per agent and record the
 * human's grant itself. Buzz 0.5 ships both halves instead: Buzz Desktop mints
 * a managed agent's key after the owner reviews it, and the owner's grant is a
 * NIP-OA `auth` tag the agent attaches to its events — an owner signature over
 * `nostr:agent-auth:<agent pubkey>:<conditions>`. So AtlasMind holds no agent
 * secret and issues nothing; it does the part a client is for, which is
 * checking the claim. Spec: `docs/nips/NIP-OA.md` at Buzz `desktop-v0.5.28`,
 * read 2026-10-28, and its published test vectors are this module's tests.
 *
 * Five rules, all from the spec and all fail-closed.
 *
 * 1. **The event first, then the grant.** A valid `auth` tag on an event whose
 *    own id or signature is wrong establishes nothing (NIP-OA, Client
 *    Behavior), and AtlasMind's inbound pipeline deliberately does not verify
 *    event signatures — the relay authenticated the connection, not each event —
 *    so both are checked here before any provenance is claimed.
 * 2. **Exactly one tag of exactly four elements.** Two `auth` tags means no
 *    valid one; a malformed tag is invalid, not partly read.
 * 3. **The conditions string is checked as written.** Its grammar is exact
 *    (`kind=`, `created_at<`, `created_at>`, canonical decimals, `&` between
 *    clauses, nothing else) and it is signed byte-for-byte, so it is never
 *    normalised before hashing; an unknown clause rejects the whole tag.
 * 4. **An owner cannot attest itself.** Owner key equal to the event's author
 *    is invalid.
 * 5. **Authorship is not transferred.** A verified tag says *who authorised*
 *    the agent; the agent is still the author. Callers display "authorised by",
 *    never the owner as the sender.
 *
 * The spec's own caution travels with every verdict: `created_at` clauses
 * constrain a timestamp the agent controls, so they bound nothing on the wall
 * clock. Revocation is therefore AtlasMind's own list (`buzzRevocation.ts`),
 * not something an attestation can express.
 */

import { createHash } from 'node:crypto';
import type { NostrEvent } from './buzzProtocol.js';
import { serializeEventForId, verifyBuzzSchnorr } from './buzzSigner.js';

export const OWNER_ATTESTATION_DOMAIN = 'nostr:agent-auth:';
/** When the NIP-OA rules here were read from Buzz's published spec. */
export const OWNER_ATTESTATION_SPEC_VERIFIED_AT = '2026-10-28';

const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_128 = /^[0-9a-f]{128}$/;
const CANONICAL_DECIMAL = /^(0|[1-9][0-9]*)$/;

export type AttestationClause =
  | { kind: 'kind'; value: number }
  | { kind: 'before'; value: number }
  | { kind: 'after'; value: number };

export type OwnerAttestationVerdict =
  | { status: 'absent' }
  | { status: 'invalid'; reason: string }
  | { status: 'verified'; ownerPubkey: string; conditions: string };

type ParsedTag =
  | { status: 'absent' }
  | { status: 'invalid'; reason: string }
  | { status: 'parsed'; ownerPubkey: string; conditions: string; signature: string; clauses: AttestationClause[] };

/** Read the conditions grammar exactly as NIP-OA states it. */
export function parseAttestationConditions(conditions: string): AttestationClause[] | undefined {
  if (conditions === '') {
    return [];
  }
  if (!/^[\x21-\x7e]+$/.test(conditions)) {
    return undefined;
  }
  const clauses: AttestationClause[] = [];
  for (const clause of conditions.split('&')) {
    const match = /^(kind=|created_at<|created_at>)(.+)$/.exec(clause);
    if (!match || !CANONICAL_DECIMAL.test(match[2]!)) {
      return undefined;
    }
    const value = Number(match[2]);
    if (match[1] === 'kind=') {
      if (value > 65_535) {
        return undefined;
      }
      clauses.push({ kind: 'kind', value });
    } else {
      if (value > 4_294_967_295) {
        return undefined;
      }
      clauses.push({ kind: match[1] === 'created_at<' ? 'before' : 'after', value });
    }
  }
  return clauses;
}

function parseAuthTag(tags: unknown): ParsedTag {
  if (!Array.isArray(tags)) {
    return { status: 'absent' };
  }
  const authTags = tags.filter(tag => Array.isArray(tag) && tag[0] === 'auth');
  if (authTags.length === 0) {
    return { status: 'absent' };
  }
  if (authTags.length > 1) {
    return { status: 'invalid', reason: 'the event carries more than one auth tag' };
  }
  const tag = authTags[0] as unknown[];
  if (tag.length !== 4 || !tag.every(element => typeof element === 'string')) {
    return { status: 'invalid', reason: 'the auth tag does not have exactly four elements' };
  }
  const [, ownerPubkey, conditions, signature] = tag as [string, string, string, string];
  if (!HEX_64.test(ownerPubkey)) {
    return { status: 'invalid', reason: 'the owner key is not a 64-character lowercase hex public key' };
  }
  if (!HEX_128.test(signature)) {
    return { status: 'invalid', reason: 'the owner signature is not 128 lowercase hex characters' };
  }
  const clauses = parseAttestationConditions(conditions);
  if (!clauses) {
    return { status: 'invalid', reason: 'the conditions string is not one NIP-OA defines' };
  }
  return { status: 'parsed', ownerPubkey, conditions, signature, clauses };
}

/** Whether an event satisfies every clause. */
export function eventSatisfiesConditions(clauses: readonly AttestationClause[], event: Pick<NostrEvent, 'kind' | 'created_at'>): boolean {
  return clauses.every(clause => (clause.kind === 'kind'
    ? event.kind === clause.value
    : clause.kind === 'before' ? event.created_at < clause.value : event.created_at > clause.value));
}

/** The bytes the owner signed: SHA-256 of the domain-separated preimage. */
export function ownerAttestationMessage(agentPubkey: string, conditions: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(`${OWNER_ATTESTATION_DOMAIN}${agentPubkey}:${conditions}`, 'utf8').digest());
}

export interface AttestationVerifier {
  verifySchnorr: (signatureHex: string, message: Uint8Array, pubkeyHex: string) => Promise<boolean>;
}

/** Check an event's owner attestation. Never throws. */
export async function verifyOwnerAttestation(
  event: NostrEvent,
  verifier: AttestationVerifier = { verifySchnorr: verifyBuzzSchnorr },
): Promise<OwnerAttestationVerdict> {
  const parsed = parseAuthTag(event.tags);
  if (parsed.status !== 'parsed') {
    return parsed;
  }
  if (parsed.ownerPubkey === event.pubkey) {
    return { status: 'invalid', reason: 'an owner cannot attest its own key' };
  }
  const idBytes = new Uint8Array(createHash('sha256').update(serializeEventForId(event, event.pubkey), 'utf8').digest());
  if (Buffer.from(idBytes).toString('hex') !== event.id) {
    return { status: 'invalid', reason: 'the event id does not match its content, so the event proves nothing' };
  }
  if (!await verifier.verifySchnorr(event.sig, idBytes, event.pubkey)) {
    return { status: 'invalid', reason: 'the event signature does not verify, so the event proves nothing' };
  }
  if (!eventSatisfiesConditions(parsed.clauses, event)) {
    return { status: 'invalid', reason: 'the event does not meet the conditions the owner signed' };
  }
  if (!await verifier.verifySchnorr(parsed.signature, ownerAttestationMessage(event.pubkey, parsed.conditions), parsed.ownerPubkey)) {
    return { status: 'invalid', reason: 'the owner signature does not verify' };
  }
  return { status: 'verified', ownerPubkey: parsed.ownerPubkey, conditions: parsed.conditions };
}
