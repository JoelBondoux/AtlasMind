/**
 * Buzz directory — the identities AtlasMind has *observed*, so a Buzz handle
 * can be picked rather than typed.
 *
 * The problem this solves is narrow and the boundary matters. There is no
 * function from "Jane Doe" to a public key: constructing one would produce a
 * plausible key belonging to a **different real person**, silently routing a
 * colleague's work to a stranger's identity. So nothing here derives, infers,
 * or guesses a key. It only records keys that arrived on the wire, and pairs
 * them with the name their owner published.
 *
 * Two sources, both evidence:
 *  - a message event proves an identity exists and is active in a channel;
 *  - a kind-0 profile event supplies that identity's own `display_name`.
 *
 * **Kind 0 was verified against a live relay, not assumed.** It is the standard
 * NIP-01 metadata kind and is absent from Buzz's own registry, so whether a
 * Buzz relay serves it was an open question — the same shape of question that
 * produced the kind-9/40002 mistake. Every observed author had one.
 *
 * **Names are untrusted input.** A display name is remote-controlled text
 * chosen by someone else and rendered in AtlasMind's UI, so it is
 * secret-redacted, control-character-stripped, and length-clamped on the way
 * in — never on the way out, where one missed call site would be a hole.
 *
 * **Nothing here is persisted.** A roster of who spoke, and when, is exactly
 * the sort of record `project_memory/` must not accumulate: it is git-tracked,
 * so writing it would commit a log of colleagues' activity. The directory lives
 * in memory for the session and is rebuilt from the subscription each time.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

import { BUZZ_KIND, type NostrEvent } from './buzzProtocol.js';
import { sanitizeDerivedText } from './buzzInboundDerivation.js';

/** Cap on tracked identities, so a busy relay cannot grow this without bound. */
export const MAX_BUZZ_IDENTITIES = 200;

/** Cap on channels remembered per identity — enough to explain "seen where". */
export const MAX_CHANNELS_PER_IDENTITY = 5;

/** Display names are labels, not prose. */
export const MAX_DISPLAY_NAME_LENGTH = 60;

/** One Buzz identity AtlasMind has actually seen. */
export interface BuzzIdentity {
  /** Lowercase 32-byte hex public key, exactly as it arrived. */
  pubkey: string;
  /** The name this identity published for itself, sanitized. Absent until a profile arrives. */
  displayName?: string;
  /** The identity's own short self-description, sanitized. */
  about?: string;
  /** Unix seconds of the most recent activity seen from this identity. */
  lastSeenAt: number;
  /** Channels this identity was seen posting in. */
  channelIds: string[];
}

/** The observed-identity map. Keyed by lowercase hex pubkey. */
export type BuzzDirectory = Map<string, BuzzIdentity>;

export function createBuzzDirectory(): BuzzDirectory {
  return new Map();
}

/** Normalise a raw event pubkey, or undefined when it is not a usable key. */
function readPubkey(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const hex = value.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : undefined;
}

/** The channel an event belongs to, from its `h` tag. Verified against a live relay. */
function readChannelId(event: NostrEvent): string | undefined {
  for (const tag of event.tags) {
    if (tag[0] === 'h' && typeof tag[1] === 'string' && tag[1].trim()) {
      return sanitizeDerivedText(tag[1], 100) || undefined;
    }
  }
  return undefined;
}

/**
 * Record that an identity was active.
 *
 * Called for message events. Creates the entry if new, refreshes `lastSeenAt`,
 * and remembers the channel. Never throws, and silently ignores an event whose
 * author is not a usable key — a malformed author is not worth a failure, and
 * is certainly not worth guessing at.
 */
export function recordSighting(directory: BuzzDirectory, event: NostrEvent): void {
  const pubkey = readPubkey(event.pubkey);
  if (!pubkey) {
    return;
  }

  const existing = directory.get(pubkey);
  if (!existing && directory.size >= MAX_BUZZ_IDENTITIES) {
    // At the cap, keep what is already known rather than evicting an entry the
    // user may be mid-way through picking.
    return;
  }

  const createdAt = Number.isFinite(event.created_at) ? event.created_at : 0;
  const channelId = readChannelId(event);
  const entry: BuzzIdentity = existing ?? { pubkey, lastSeenAt: createdAt, channelIds: [] };

  if (createdAt > entry.lastSeenAt) {
    entry.lastSeenAt = createdAt;
  }
  if (channelId && !entry.channelIds.includes(channelId) && entry.channelIds.length < MAX_CHANNELS_PER_IDENTITY) {
    entry.channelIds.push(channelId);
  }

  directory.set(pubkey, entry);
}

/**
 * Attach the name an identity published for itself, from a kind-0 event.
 *
 * The content is JSON authored by a remote party, so it is parsed defensively
 * (never throws on malformed JSON) and every string that survives is sanitized.
 * A profile for an identity that has not been seen posting is still recorded —
 * the relay was asked for it by key, so it is evidence either way.
 */
export function applyProfile(directory: BuzzDirectory, event: NostrEvent): void {
  if (event.kind !== BUZZ_KIND.profileMetadata) {
    return;
  }
  const pubkey = readPubkey(event.pubkey);
  if (!pubkey) {
    return;
  }

  let parsed: Record<string, unknown> = {};
  try {
    const candidate: unknown = JSON.parse(typeof event.content === 'string' ? event.content : '{}');
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      parsed = candidate as Record<string, unknown>;
    }
  } catch {
    // A malformed profile is a missing name, not an error worth propagating.
    return;
  }

  const existing = directory.get(pubkey);
  if (!existing && directory.size >= MAX_BUZZ_IDENTITIES) {
    return;
  }
  const entry: BuzzIdentity = existing ?? {
    pubkey,
    lastSeenAt: Number.isFinite(event.created_at) ? event.created_at : 0,
    channelIds: [],
  };

  // `display_name` is what the live relay actually carried; `name` is the
  // NIP-01 fallback for a profile that only sets the short form.
  const rawName = [parsed['display_name'], parsed['displayName'], parsed['name']]
    .find(value => typeof value === 'string' && value.trim());
  const name = typeof rawName === 'string' ? sanitizeDerivedText(rawName, MAX_DISPLAY_NAME_LENGTH) : '';
  if (name) {
    entry.displayName = name;
  }

  const rawAbout = parsed['about'];
  const about = typeof rawAbout === 'string' ? sanitizeDerivedText(rawAbout, 120) : '';
  if (about) {
    entry.about = about;
  }

  directory.set(pubkey, entry);
}

/**
 * Feed any event to the directory, routing it by kind. Total — an event that is
 * neither a sighting nor a profile is simply ignored.
 */
export function observeEvent(directory: BuzzDirectory, event: NostrEvent): void {
  if (event.kind === BUZZ_KIND.profileMetadata) {
    applyProfile(directory, event);
    return;
  }
  recordSighting(directory, event);
}

/**
 * The identities to offer, most recently active first.
 *
 * Ordering is by activity rather than by name: the person you are adding is
 * overwhelmingly likely to be someone who just posted.
 */
export function listIdentities(directory: BuzzDirectory): BuzzIdentity[] {
  return [...directory.values()]
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .map(identity => ({ ...identity, channelIds: [...identity.channelIds] }));
}

/**
 * Identities with no published name yet, so a caller knows which profiles are
 * still worth asking the relay for. Bounded, because a profile request carries
 * its authors in the filter and an unbounded list would be refused.
 */
export function identitiesMissingProfiles(directory: BuzzDirectory, limit = 50): string[] {
  return [...directory.values()]
    .filter(identity => identity.displayName === undefined)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .slice(0, Math.max(0, limit))
    .map(identity => identity.pubkey);
}

/**
 * A label for one identity: the published name when there is one, otherwise a
 * truncated key. Never invents a name — an unnamed identity reads as a key,
 * which is honest, rather than as a guess dressed up as a person.
 */
export function describeIdentity(identity: BuzzIdentity): string {
  return identity.displayName ?? `${identity.pubkey.slice(0, 12)}…`;
}
