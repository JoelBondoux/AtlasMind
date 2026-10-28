/**
 * Which Buzz identities AtlasMind no longer trusts — the revocation half of
 * Buzz Tier 4.
 *
 * Buzz itself has two levers, and neither is a revocation AtlasMind can rely
 * on. A relay can *archive* an identity (NIP-IA), which hides it — and the
 * identity can un-archive itself, deliberately, as the spec's anti-shadowban
 * property, so a leaked agent key undoes its own archive. And an owner can stop
 * issuing NIP-OA grants, but a grant's `created_at<` limit is checked against
 * a timestamp the agent writes, so an old grant is not reliably dead. Only the
 * relay's membership (NIP-43, and NIP-AA for agents) actually refuses a key,
 * and that is the relay owner's to change, signed with their key.
 *
 * So AtlasMind keeps its own list, decided by its own user, and acts on it:
 * messages from a revoked identity are not turned into work, and neither are
 * messages from an agent whose verified owner is revoked — revoking a person
 * revokes what they authorised, without touching anybody else. The Buzz-side
 * steps are offered as a command for the owner to run with their own key;
 * AtlasMind holds no owner key and signs nothing.
 *
 * Four rules.
 *
 * 1. **A revocation anywhere wins.** The list is read from every settings scope
 *    as a union, so a repository can revoke an identity and cannot un-revoke one
 *    a user revoked.
 * 2. **Keys are validated, never cleaned.** An `npub` is decoded through the
 *    same checksummed decoder as agent bindings; anything that does not decode
 *    to a 32-byte key is reported, and an `nsec` — a secret pasted in the wrong
 *    place — is refused by name and never echoed.
 * 3. **Reported, never dropped.** An unusable entry is a named problem, because
 *    a revocation silently ignored reads as a revocation in force.
 * 4. **The Buzz-side command is constant-shaped.** A validated hex key and a
 *    reason from a declared list; nothing typed by anybody reaches it raw.
 */

import { normalizeBuzzPubkey } from './buzzSigner.js';

/** NIP-IA's suggested reason codes, plus `compromised`, which is why most revocations happen. */
export const BUZZ_REVOCATION_REASONS = ['compromised', 'rotated', 'retired', 'bot-rebuilt', 'left-organization', 'spam'] as const;
export type BuzzRevocationReason = (typeof BUZZ_REVOCATION_REASONS)[number];

export interface BuzzRevocation {
  /** Lowercase 64-character hex public key. */
  pubkey: string;
  reason: BuzzRevocationReason;
  /** ISO date the revocation was recorded, when known. */
  revokedAt?: string;
}

export interface BuzzRevocationList {
  revoked: Map<string, BuzzRevocation>;
  problems: Array<{ input: string; reason: string }>;
}

const MAX_REVOCATIONS = 500;

function describeInput(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  // A secret is never repeated back, even in a problem report.
  return /nsec1/i.test(text) ? '(a secret key)' : text.slice(0, 80);
}

function readReason(value: unknown): BuzzRevocationReason {
  return (BUZZ_REVOCATION_REASONS as readonly unknown[]).includes(value) ? value as BuzzRevocationReason : 'compromised';
}

/** Read `atlasmind.buzz.revokedIdentities` from every scope at once. Never throws. */
export function readBuzzRevocations(scopeValues: readonly unknown[]): BuzzRevocationList {
  const revoked = new Map<string, BuzzRevocation>();
  const problems: BuzzRevocationList['problems'] = [];
  for (const scopeValue of scopeValues) {
    if (scopeValue === undefined || scopeValue === null) {
      continue;
    }
    if (!Array.isArray(scopeValue)) {
      problems.push({ input: describeInput(scopeValue), reason: 'atlasmind.buzz.revokedIdentities must be a list' });
      continue;
    }
    for (const entry of scopeValue.slice(0, MAX_REVOCATIONS)) {
      const record = typeof entry === 'string' ? { pubkey: entry } : entry && typeof entry === 'object' ? entry as Record<string, unknown> : undefined;
      const raw = typeof record?.['pubkey'] === 'string' ? record['pubkey'].trim() : '';
      if (/^nsec1/i.test(raw)) {
        problems.push({ input: '(a secret key)', reason: 'an nsec is a secret key, not an identity — it was not stored here and should be treated as exposed' });
        continue;
      }
      const pubkey = raw ? normalizeBuzzPubkey(raw) : undefined;
      if (!pubkey) {
        problems.push({ input: describeInput(entry), reason: 'not an npub or 64-character hex public key' });
        continue;
      }
      if (!revoked.has(pubkey)) {
        const revokedAt = typeof record?.['revokedAt'] === 'string' && /^\d{4}-\d{2}-\d{2}/.test(record['revokedAt'])
          ? record['revokedAt'].slice(0, 30)
          : undefined;
        revoked.set(pubkey, { pubkey, reason: readReason(record?.['reason']), ...(revokedAt ? { revokedAt } : {}) });
      }
    }
  }
  return { revoked, problems };
}

export type RevocationCheck =
  | { revoked: false }
  | { revoked: true; pubkey: string; via: 'author' | 'owner'; reason: BuzzRevocationReason };

/**
 * Whether an event's author is revoked, directly or through the verified owner
 * who authorised it. `ownerPubkey` must come from a *verified* attestation —
 * an unverified one could be used to shield an agent behind a trusted name.
 */
export function checkBuzzRevocation(
  authorPubkey: string,
  ownerPubkey: string | undefined,
  revoked: ReadonlyMap<string, BuzzRevocation>,
): RevocationCheck {
  const author = revoked.get(authorPubkey.toLowerCase());
  if (author) {
    return { revoked: true, pubkey: author.pubkey, via: 'author', reason: author.reason };
  }
  const owner = ownerPubkey ? revoked.get(ownerPubkey.toLowerCase()) : undefined;
  if (owner) {
    return { revoked: true, pubkey: owner.pubkey, via: 'owner', reason: owner.reason };
  }
  return { revoked: false };
}

/** The user-scope list with one identity added (replacing any earlier entry for it). */
export function withRevocation(current: unknown, revocation: BuzzRevocation): unknown[] {
  return [
    ...withoutRevocation(current, revocation.pubkey),
    { pubkey: revocation.pubkey, reason: revocation.reason, ...(revocation.revokedAt ? { revokedAt: revocation.revokedAt } : {}) },
  ];
}

/** The user-scope list with one identity removed. */
export function withoutRevocation(current: unknown, pubkey: string): unknown[] {
  const existing = Array.isArray(current) ? current : [];
  return existing.filter(entry => {
    const raw = typeof entry === 'string' ? entry : (entry as Record<string, unknown> | null)?.['pubkey'];
    return typeof raw !== 'string' || normalizeBuzzPubkey(raw) !== pubkey;
  });
}

/**
 * The Buzz-side step for the identity's owner to run with their own key:
 * archive it on the relay (NIP-IA, kind 9035). Shown, never run — AtlasMind
 * holds no owner key — and noted honestly: an archived identity can
 * un-archive itself, so this hides the identity rather than locking it out.
 */
export function buzzArchiveCommand(pubkey: string, reason: BuzzRevocationReason): { argv: string[]; display: string } | undefined {
  if (!/^[0-9a-f]{64}$/.test(pubkey) || !(BUZZ_REVOCATION_REASONS as readonly string[]).includes(reason)) {
    return undefined;
  }
  const argv = ['buzz', 'agents', 'archive', pubkey, '--reason', reason];
  return { argv, display: argv.join(' ') };
}
