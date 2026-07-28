/**
 * Buzz conversations — reading a channel and composing a reply.
 *
 * Tier 3 derives *work* from Buzz activity and deliberately never keeps the
 * message body: `project_memory/` is git-tracked, so mirroring a channel would
 * commit colleagues' chat into a repository. This module is the other half —
 * an **in-memory, session-only** view of a conversation, so you can actually
 * read and answer it from AtlasMind.
 *
 * The distinction matters and is load-bearing: nothing here is ever persisted.
 * A conversation lives for as long as the window is open and then is gone,
 * exactly like an unsaved chat. "Derive, don't mirror" governs what goes to
 * disk; it was never a rule against *looking* at a message.
 *
 * **Emoji are a correctness problem, not a decoration.** A naive length clamp
 * cuts a UTF-16 string mid-surrogate and produces a replacement character, and
 * a ZWJ sequence (👩‍💻) or a flag is several code points that mean one glyph.
 * Truncation here is done on grapheme-ish boundaries so a trimmed message never
 * ends in a broken glyph, and reactions are compared by their full sequence.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

import { BUZZ_KIND, type NostrEvent } from './buzzProtocol.js';
import { sanitizeDerivedText } from './buzzInboundDerivation.js';

/** Messages held per channel. Old ones fall off the top. */
export const MAX_CONVERSATION_MESSAGES = 200;

/** Longest message AtlasMind will send. The CLI accepts more; this is a sanity bound. */
export const MAX_OUTBOUND_LENGTH = 4000;

/** Longest message body kept for display. */
export const MAX_DISPLAY_LENGTH = 2000;

/** Distinct reactions tracked per message. */
export const MAX_REACTIONS_PER_MESSAGE = 12;

export interface BuzzReaction {
  /** The emoji itself, as published — a full sequence, not a lone code unit. */
  emoji: string;
  /** How many identities reacted with it. */
  count: number;
  /** Whether the local identity is among them. */
  mine: boolean;
}

export interface BuzzMessage {
  /** The Buzz event id. */
  id: string;
  /** Author's 32-byte hex pubkey. */
  authorPubkey: string;
  /** Channel this belongs to, from the `h` tag. */
  channelId?: string;
  /** Unix seconds. */
  createdAt: number;
  /** Display text, sanitized and clamped without breaking a glyph. */
  text: string;
  /** True when the body was trimmed for display. */
  truncated: boolean;
  /** Root event id when this is a thread reply. */
  replyToId?: string;
  /** Emoji reactions, aggregated. */
  reactions: BuzzReaction[];
}

/** A channel's messages, newest last. In memory only. */
export interface BuzzConversation {
  channelId: string;
  messages: BuzzMessage[];
}

export function createConversation(channelId: string): BuzzConversation {
  return { channelId, messages: [] };
}

/**
 * Clamp text without splitting a glyph.
 *
 * `String.prototype.slice` counts UTF-16 units, so cutting at a fixed index can
 * land between the two halves of a surrogate pair and yield `�`, or sever
 * a ZWJ sequence so 👩‍💻 becomes 👩 followed by a stray joiner. Iterating the
 * string yields whole code points, and trailing joiners/variation selectors are
 * dropped so the result never ends mid-sequence.
 */
export function clampGraphemes(text: string, maxCodePoints: number): { text: string; truncated: boolean } {
  const source = typeof text === 'string' ? text : '';
  const points = [...source];
  if (points.length <= maxCodePoints) {
    return { text: source, truncated: false };
  }
  const kept = points.slice(0, maxCodePoints);
  // A zero-width joiner or variation selector at the edge would leave a
  // dangling half-sequence, so walk back past any of them.
  while (kept.length > 0) {
    const last = kept[kept.length - 1]!;
    const code = last.codePointAt(0) ?? 0;
    const isJoiner = code === 0x200d || code === 0xfe0f || code === 0xfe0e || (code >= 0x1f3fb && code <= 0x1f3ff);
    if (!isJoiner) {
      break;
    }
    kept.pop();
  }
  return { text: kept.join(''), truncated: true };
}

/**
 * Prepare message text for display.
 *
 * Sanitized like any other text crossing the Buzz boundary — secrets redacted,
 * control characters stripped — but **emoji survive**, because stripping them
 * would silently rewrite what somebody said.
 */
export function sanitizeMessageText(text: unknown): { text: string; truncated: boolean } {
  const raw = typeof text === 'string' ? text : '';
  // sanitizeDerivedText collapses whitespace and clamps by UTF-16 length, which
  // is exactly the glyph-splitting hazard, so it is given plenty of headroom
  // and the real clamp is done on code points afterwards.
  const cleaned = sanitizeDerivedText(raw, MAX_DISPLAY_LENGTH * 2);
  return clampGraphemes(cleaned, MAX_DISPLAY_LENGTH);
}

/** The `h` tag — the channel an event belongs to. Verified against a live relay. */
function readTag(event: NostrEvent, name: string): string | undefined {
  for (const tag of event.tags) {
    if (tag[0] === name && typeof tag[1] === 'string' && tag[1].trim()) {
      return tag[1].trim();
    }
  }
  return undefined;
}

/** True when this event is a chat message AtlasMind knows how to display. */
export function isConversationMessage(event: NostrEvent): boolean {
  return event.kind === BUZZ_KIND.channelMessage || event.kind === BUZZ_KIND.channelMessageV2;
}

/**
 * Fold one event into a conversation.
 *
 * Total and idempotent: an unrelated kind is ignored, a duplicate event id
 * updates nothing, and a reaction attaches to its target rather than appearing
 * as a message. The reconnect replay overlap therefore cannot duplicate a
 * conversation, in the same way it cannot duplicate a follow-up.
 */
export function ingestEvent(conversation: BuzzConversation, event: NostrEvent, selfPubkey?: string): void {
  if (event.kind === BUZZ_KIND.reaction) {
    applyReaction(conversation, event, selfPubkey);
    return;
  }
  if (!isConversationMessage(event)) {
    return;
  }

  const channelId = readTag(event, 'h');
  if (conversation.channelId && channelId && channelId !== conversation.channelId) {
    return;
  }
  if (conversation.messages.some(message => message.id === event.id)) {
    return;
  }

  const { text, truncated } = sanitizeMessageText(event.content);
  const replyToId = readTag(event, 'e');
  conversation.messages.push({
    id: event.id,
    authorPubkey: String(event.pubkey ?? '').toLowerCase(),
    ...(channelId ? { channelId } : {}),
    createdAt: Number.isFinite(event.created_at) ? event.created_at : 0,
    text,
    truncated,
    ...(replyToId ? { replyToId } : {}),
    reactions: [],
  });

  conversation.messages.sort((a, b) => a.createdAt - b.createdAt);
  if (conversation.messages.length > MAX_CONVERSATION_MESSAGES) {
    conversation.messages.splice(0, conversation.messages.length - MAX_CONVERSATION_MESSAGES);
  }
}

/**
 * Attach a NIP-25 reaction to the message it targets.
 *
 * The emoji is kept as its full published sequence — comparing by anything less
 * would merge 👍 and 👍🏽, which are different reactions by different people.
 * A reaction to a message this session has not seen is dropped rather than
 * invented as a placeholder.
 */
function applyReaction(conversation: BuzzConversation, event: NostrEvent, selfPubkey?: string): void {
  const targetId = readTag(event, 'e');
  if (!targetId) {
    return;
  }
  const message = conversation.messages.find(entry => entry.id === targetId);
  if (!message) {
    return;
  }

  // NIP-25: content is the reaction. `+` and an empty body both mean a like.
  const raw = typeof event.content === 'string' ? event.content.trim() : '';
  const emoji = raw === '' || raw === '+' ? '👍' : raw === '-' ? '👎' : clampGraphemes(raw, 8).text;
  if (!emoji) {
    return;
  }

  const mine = Boolean(selfPubkey) && String(event.pubkey ?? '').toLowerCase() === selfPubkey?.toLowerCase();
  const existing = message.reactions.find(entry => entry.emoji === emoji);
  if (existing) {
    existing.count += 1;
    existing.mine = existing.mine || mine;
    return;
  }
  if (message.reactions.length >= MAX_REACTIONS_PER_MESSAGE) {
    return;
  }
  message.reactions.push({ emoji, count: 1, mine });
}

export interface OutboundValidation {
  ok: boolean;
  /** The message to send, when valid. Never present alongside a reason. */
  text?: string;
  reason?: string;
}

/**
 * Check a message AtlasMind is about to send.
 *
 * Outbound is the direction that cannot be taken back, so the checks are about
 * refusing to send something wrong rather than cleaning it up quietly:
 *
 *  - **Emoji pass through untouched.** They are the message, not decoration.
 *  - **A secret in the body is a refusal, not a redaction.** Silently sending a
 *    redacted version of what you wrote would be worse than both alternatives:
 *    you would believe you had sent one thing while your colleagues read
 *    another.
 *  - Control characters are stripped — they cannot be intended and can corrupt
 *    a terminal at the far end.
 */
export function validateOutboundMessage(input: unknown): OutboundValidation {
  const raw = typeof input === 'string' ? input : '';
  // Strip control characters but keep everything else, emoji included.
  const stripped = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();

  if (!stripped) {
    return { ok: false, reason: 'The message is empty.' };
  }
  if ([...stripped].length > MAX_OUTBOUND_LENGTH) {
    return { ok: false, reason: `The message is longer than ${MAX_OUTBOUND_LENGTH} characters.` };
  }

  const redacted = sanitizeDerivedText(stripped, MAX_OUTBOUND_LENGTH * 2);
  if (redacted.includes('[redacted]')) {
    return {
      ok: false,
      reason: 'That message looks like it contains a secret (an API key or token). '
        + 'AtlasMind will not send it — remove the secret rather than letting a redacted version go out in your name.',
    };
  }

  return { ok: true, text: stripped };
}

/** Messages newest-first, for a "recent activity" view. */
export function recentMessages(conversation: BuzzConversation, limit = 20): BuzzMessage[] {
  return [...conversation.messages].reverse().slice(0, Math.max(0, limit));
}
