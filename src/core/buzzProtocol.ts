/**
 * Buzz relay protocol — verified Nostr wire framing for Tier-3 inbound sync.
 *
 * Buzz is Nostr-based, so the transport is **not** a Buzz invention: NIP-01
 * (events, REQ/EVENT/EOSE/CLOSED framing, filters) and NIP-42 (relay auth) are
 * published open specifications. Everything here was read from those specs and
 * from Buzz's own kind registry at the pinned tag — nothing is inferred:
 *
 *  - NIP-01 — `nostr-protocol/nips/01.md`: event object shape; client frames
 *    `["EVENT", <event>]` / `["REQ", <subId>, <filter>…]` / `["CLOSE", <subId>]`;
 *    relay frames `["EVENT", <subId>, <event>]` / `["OK", <id>, <bool>, <msg>]` /
 *    `["EOSE", <subId>]` / `["CLOSED", <subId>, <msg>]` / `["NOTICE", <msg>]`.
 *  - NIP-42 — `nips/42.md`: relay sends `["AUTH", <challenge>]`; the client
 *    replies with a signed **kind 22242** event carrying `relay` and `challenge`
 *    tags. Refusals are prefixed `auth-required: ` or `restricted: `.
 *  - Kind numbers — `crates/buzz-core/src/kind.rs` at `BUZZ_PROTOCOL_VERIFIED_VERSION`.
 *
 * This module is pure and `vscode`-free: it frames and parses, and owns no
 * socket. It never throws — a relay frame is **untrusted input** arriving over
 * the network, so malformed, hostile, or oversized data degrades to a typed
 * `unknown` frame rather than an exception.
 *
 * See `project_memory/roadmap/buzz-integration.md` (Tier 3).
 */

/** The pinned Buzz tag this module's kind numbers were read from. */
export const BUZZ_PROTOCOL_VERIFIED_VERSION = 'v0.4.26';

/**
 * Buzz event kinds AtlasMind reads or writes, from `buzz-core/src/kind.rs`.
 *
 * Two documented traps are encoded here deliberately:
 *  - Channel metadata is **39000** (`KIND_NIP29_GROUP_METADATA`). Kind 41 also
 *    exists in the registry as legacy NIP-01 channel metadata and is *not* what
 *    Buzz uses — the contributor guide calls this out explicitly.
 *  - A channel message is **40002** (`KIND_STREAM_MESSAGE_V2`). Kind 9 is the
 *    plain NIP-29 message kind and V1 used 10002; neither is current.
 */
export const BUZZ_KIND = {
  /** NIP-25 reaction. */
  reaction: 7,
  /** NIP-42 auth event — ephemeral, never stored (carries a bearer challenge). */
  auth: 22242,
  /** Ephemeral user presence update. */
  presenceUpdate: 20001,
  /** Ephemeral typing indicator. */
  typingIndicator: 20002,
  /** Addressable channel ("group") metadata — 39000, NOT 41. */
  channelMetadata: 39000,
  /** Thread summary overlay; `e`/`d` tag is the root event id. */
  threadSummary: 39005,
  /** Channel chat message — current version (V1 used 10002; kind 9 is plain NIP-29). */
  channelMessage: 40002,
  /** Edit of a channel message. */
  channelMessageEdit: 40003,
  /** System message for channel state changes. */
  systemMessage: 40099,
  /** A new direct-message conversation was created. */
  dmCreated: 41001,
  /** Open/create a DM; `p` tags are the participants. */
  dmOpen: 41010,
  /** Agent job lifecycle. */
  jobRequest: 43001,
  jobAccepted: 43002,
  jobProgress: 43003,
  jobResult: 43004,
  jobCancel: 43005,
  jobError: 43006,
} as const;

/** Kinds a read-only inbound subscription cares about, by default. */
export const BUZZ_INBOUND_KINDS: number[] = [
  BUZZ_KIND.channelMessage,
  BUZZ_KIND.channelMessageEdit,
  BUZZ_KIND.systemMessage,
  BUZZ_KIND.jobRequest,
  BUZZ_KIND.jobResult,
  BUZZ_KIND.jobError,
];

/** Hard cap on a single relay frame. A relay is untrusted; unbounded input is a DoS. */
export const MAX_RELAY_FRAME_BYTES = 512 * 1024;

const HEX_32_BYTES = /^[0-9a-f]{64}$/i;
const HEX_64_BYTES = /^[0-9a-f]{128}$/i;

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/** An event template before signing — no `id`/`pubkey`/`sig` until a signer runs. */
export interface UnsignedNostrEvent {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

/**
 * A NIP-01 filter. `kinds` is **required and non-empty** by construction:
 * Buzz's relay rejects a filter without `kinds` with a 403 "p-gate", a documented
 * gotcha that is easy to hit and confusing to debug, so the type forbids it.
 */
export interface NostrFilter {
  kinds: number[];
  ids?: string[];
  authors?: string[];
  since?: number;
  until?: number;
  limit?: number;
  '#e'?: string[];
  '#p'?: string[];
  '#h'?: string[];
}

export type RelayFrame =
  | { type: 'EVENT'; subscriptionId: string; event: NostrEvent }
  | { type: 'OK'; eventId: string; accepted: boolean; message: string }
  | { type: 'EOSE'; subscriptionId: string }
  | { type: 'CLOSED'; subscriptionId: string; message: string }
  | { type: 'NOTICE'; message: string }
  | { type: 'AUTH'; challenge: string }
  | { type: 'unknown'; reason: string };

export type RelayRefusal = 'auth-required' | 'restricted';

export type FrameResult =
  | { ok: true; frame: string }
  | { ok: false; reason: string };

/**
 * Validate an untrusted value as a NIP-01 event. Returns undefined rather than
 * throwing or coercing, so a malformed event is dropped, never half-trusted.
 *
 * This checks *structural* validity only. It does **not** verify the Schnorr
 * signature — that needs a crypto backend and is the relay's job under NIP-42;
 * callers must not treat a validated event as an authenticated one.
 */
export function validateNostrEvent(value: unknown): NostrEvent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;

  const { id, pubkey, sig, content } = record;
  if (typeof id !== 'string' || !HEX_32_BYTES.test(id)) { return undefined; }
  if (typeof pubkey !== 'string' || !HEX_32_BYTES.test(pubkey)) { return undefined; }
  if (typeof sig !== 'string' || !HEX_64_BYTES.test(sig)) { return undefined; }
  if (typeof content !== 'string') { return undefined; }

  const createdAt = record['created_at'];
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) { return undefined; }

  const kind = record['kind'];
  if (typeof kind !== 'number' || !Number.isInteger(kind) || kind < 0 || kind > 65535) {
    return undefined;
  }

  const rawTags = record['tags'];
  if (!Array.isArray(rawTags)) { return undefined; }
  const tags: string[][] = [];
  for (const tag of rawTags) {
    if (!Array.isArray(tag) || !tag.every(entry => typeof entry === 'string')) {
      return undefined;
    }
    tags.push(tag as string[]);
  }

  return { id, pubkey, created_at: createdAt, kind, tags, content, sig };
}

/**
 * Parse one relay→client frame. Never throws: oversized, non-JSON, non-array,
 * and structurally wrong frames all degrade to `{ type: 'unknown' }`.
 */
export function parseRelayFrame(raw: string): RelayFrame {
  const text = typeof raw === 'string' ? raw : '';
  if (text.length > MAX_RELAY_FRAME_BYTES) {
    return { type: 'unknown', reason: 'Relay frame exceeded the size cap.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { type: 'unknown', reason: 'Relay frame was not valid JSON.' };
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || typeof parsed[0] !== 'string') {
    return { type: 'unknown', reason: 'Relay frame was not a tagged array.' };
  }

  const [label] = parsed as [string, ...unknown[]];
  switch (label) {
    case 'EVENT': {
      const subscriptionId = parsed[1];
      const event = validateNostrEvent(parsed[2]);
      if (typeof subscriptionId !== 'string' || !event) {
        return { type: 'unknown', reason: 'EVENT frame was malformed.' };
      }
      return { type: 'EVENT', subscriptionId, event };
    }
    case 'OK': {
      const eventId = parsed[1];
      const accepted = parsed[2];
      if (typeof eventId !== 'string' || typeof accepted !== 'boolean') {
        return { type: 'unknown', reason: 'OK frame was malformed.' };
      }
      return {
        type: 'OK',
        eventId,
        accepted,
        message: typeof parsed[3] === 'string' ? parsed[3] : '',
      };
    }
    case 'EOSE': {
      const subscriptionId = parsed[1];
      if (typeof subscriptionId !== 'string') {
        return { type: 'unknown', reason: 'EOSE frame was malformed.' };
      }
      return { type: 'EOSE', subscriptionId };
    }
    case 'CLOSED': {
      const subscriptionId = parsed[1];
      if (typeof subscriptionId !== 'string') {
        return { type: 'unknown', reason: 'CLOSED frame was malformed.' };
      }
      return {
        type: 'CLOSED',
        subscriptionId,
        message: typeof parsed[2] === 'string' ? parsed[2] : '',
      };
    }
    case 'NOTICE': {
      return {
        type: 'NOTICE',
        message: typeof parsed[1] === 'string' ? parsed[1] : '',
      };
    }
    case 'AUTH': {
      const challenge = parsed[1];
      if (typeof challenge !== 'string' || !challenge) {
        return { type: 'unknown', reason: 'AUTH frame carried no challenge.' };
      }
      return { type: 'AUTH', challenge };
    }
    default:
      return { type: 'unknown', reason: `Unsupported relay frame "${label}".` };
  }
}

/**
 * Classify a NIP-42 refusal prefix on an `OK`/`CLOSED` message.
 *
 * `auth-required:` means the client has not authenticated yet — re-running AUTH
 * can fix it. `restricted:` means it *has* authenticated and the key is still not
 * allowed — retrying is pointless and must not become a reconnect loop.
 */
export function classifyRelayRefusal(message: string): RelayRefusal | undefined {
  const text = (message ?? '').trim().toLowerCase();
  if (text.startsWith('auth-required:')) { return 'auth-required'; }
  if (text.startsWith('restricted:')) { return 'restricted'; }
  return undefined;
}

/**
 * Build a `REQ` subscription frame. Refuses a filter without `kinds` — Buzz's
 * relay answers a kind-less query with a 403 p-gate, so this fails loudly at
 * construction instead of silently at the relay.
 */
export function buildSubscriptionFrame(subscriptionId: string, filters: NostrFilter[]): FrameResult {
  const subId = (subscriptionId ?? '').trim();
  if (!subId) {
    return { ok: false, reason: 'A subscription id is required.' };
  }
  if (!Array.isArray(filters) || filters.length === 0) {
    return { ok: false, reason: 'At least one filter is required.' };
  }
  for (const filter of filters) {
    if (!filter || !Array.isArray(filter.kinds) || filter.kinds.length === 0) {
      return {
        ok: false,
        reason: 'Every Buzz filter must list `kinds` — a kind-less relay query is rejected with a 403.',
      };
    }
    if (!filter.kinds.every(kind => Number.isInteger(kind) && kind >= 0 && kind <= 65535)) {
      return { ok: false, reason: 'Filter `kinds` must be integers in the 0–65535 range.' };
    }
  }
  return { ok: true, frame: JSON.stringify(['REQ', subId, ...filters]) };
}

/** Build a `CLOSE` frame ending a subscription. */
export function buildCloseFrame(subscriptionId: string): FrameResult {
  const subId = (subscriptionId ?? '').trim();
  if (!subId) {
    return { ok: false, reason: 'A subscription id is required.' };
  }
  return { ok: true, frame: JSON.stringify(['CLOSE', subId]) };
}

/**
 * Build the unsigned NIP-42 auth event for a challenge. Kind 22242 with `relay`
 * and `challenge` tags, per spec. Returned unsigned: signing needs the agent's
 * secret key, which never enters this module.
 */
export function buildAuthEventTemplate(
  relayUrl: string,
  challenge: string,
  createdAtSeconds: number,
): { ok: true; event: UnsignedNostrEvent } | { ok: false; reason: string } {
  const relay = (relayUrl ?? '').trim();
  const nonce = (challenge ?? '').trim();
  if (!relay) {
    return { ok: false, reason: 'A relay URL is required to answer an AUTH challenge.' };
  }
  if (!nonce) {
    return { ok: false, reason: 'The relay sent no challenge to sign.' };
  }
  if (!Number.isFinite(createdAtSeconds)) {
    return { ok: false, reason: 'A valid timestamp is required.' };
  }
  return {
    ok: true,
    event: {
      kind: BUZZ_KIND.auth,
      created_at: Math.floor(createdAtSeconds),
      tags: [['relay', relay], ['challenge', nonce]],
      content: '',
    },
  };
}

/** Wrap a signed auth event in its client frame: `["AUTH", <signed event>]`. */
export function buildAuthFrame(signedEvent: NostrEvent): FrameResult {
  if (signedEvent.kind !== BUZZ_KIND.auth) {
    return { ok: false, reason: `A NIP-42 auth event must be kind ${BUZZ_KIND.auth}.` };
  }
  return { ok: true, frame: JSON.stringify(['AUTH', signedEvent]) };
}

/** First value of the first tag with `name`, e.g. `h` for a channel id. */
export function findTagValue(event: NostrEvent, name: string): string | undefined {
  for (const tag of event.tags) {
    if (tag[0] === name && typeof tag[1] === 'string' && tag[1]) {
      return tag[1];
    }
  }
  return undefined;
}
