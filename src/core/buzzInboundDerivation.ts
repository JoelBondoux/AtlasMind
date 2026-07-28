/**
 * Buzz inbound derivation — turning relay activity into AtlasMind work items
 * **without mirroring the conversation** (Tier 3).
 *
 * The roadmap's load-bearing rule for inbound sync is *derive, don't mirror*:
 *
 * > Raw conversation history is **never** copied into SSOT — Buzz stays the
 * > message system-of-record.
 *
 * So this module maps an event to a `FollowUp`-shaped work item that carries a
 * **pointer back to the Buzz thread** and a short, sanitised title — never the
 * message body. That is a privacy boundary as much as a storage one: SSOT files
 * are git-tracked, so a mirrored channel would commit colleagues' chat into the
 * repository. The pointer is the deliverable; the content stays in Buzz.
 *
 * Pure, `vscode`-free, clock-injected, and unit-tested. It performs no I/O and
 * writes nothing — the caller decides whether to persist, behind the
 * deny-by-default toggle. Inbound events are **untrusted network input**, so
 * every derivation is total: it returns a reason instead of throwing.
 *
 * See `project_memory/roadmap/buzz-integration.md` (Tier 3).
 */

import { BUZZ_KIND, findTagValue, type NostrEvent } from './buzzProtocol.js';
import type { FollowUp } from '../types.js';

/** Max characters of derived title text retained. Titles summarise; they don't mirror. */
export const MAX_DERIVED_TITLE_LENGTH = 120;

/**
 * Kinds that can become a work item. Anything else is intentionally ignored —
 * including channel *system* messages (40099), which record state changes
 * rather than something a person needs to act on.
 *
 * Both channel-message kinds are listed: a live relay serves kind 9, while the
 * registry also defines 40002.
 */
const DERIVABLE_KINDS = new Set<number>([
  BUZZ_KIND.channelMessage,
  BUZZ_KIND.channelMessageV2,
  BUZZ_KIND.channelMessageEdit,
  BUZZ_KIND.jobRequest,
  BUZZ_KIND.jobError,
]);

/**
 * Secret-shaped material that must never be copied out of a chat message into a
 * git-tracked SSOT file, even inside a truncated title.
 */
const SECRET_PATTERNS: RegExp[] = [
  /nsec1[023456789acdefghjklmnpqrstuvwxyz]{20,}/gi,
  /\b[0-9a-f]{64}\b/gi,
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
];

export interface BuzzThreadPointer {
  /** The Buzz event id this work item came from. */
  eventId: string;
  /** The channel the event belongs to, when the event carries an `h` tag. */
  channelId?: string;
  /** The thread root, when the event is a reply (`e` tag). */
  rootEventId?: string;
  /** The author's pubkey — an identity reference, not a mirrored profile. */
  authorPubkey: string;
}

export interface DerivedWorkItem {
  /** A `FollowUp` ready to persist, minus anything the caller must own. */
  followUp: FollowUp;
  /** Where in Buzz this came from, so the UI can link back to the real thread. */
  pointer: BuzzThreadPointer;
}

export type DerivationResult =
  | { ok: true; item: DerivedWorkItem }
  | { ok: false; reason: string };

export interface DerivationContext {
  /** Current time, injected so derivation is deterministic under test. */
  now: Date;
  /** Contact whose Buzz identity matches the event author, when known. */
  withContactId?: string;
  /** Days until the derived follow-up is due. */
  dueInDays?: number;
}

/**
 * Strip secret-shaped text, collapse whitespace, and clamp to a title length.
 * Applied to any text crossing from Buzz into AtlasMind's storage.
 */
export function sanitizeDerivedText(text: string, maxLength = MAX_DERIVED_TITLE_LENGTH): string {
  const redacted = SECRET_PATTERNS.reduce(
    (acc, pattern) => acc.replace(pattern, '[redacted]'),
    typeof text === 'string' ? text : '',
  );
  // Strip control characters so a crafted message can't corrupt the mirror file.
  const cleaned = redacted.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength).trimEnd()}…` : cleaned;
}

/** A stable, collision-resistant id derived from the Buzz event id. */
function deriveFollowUpId(eventId: string): string {
  return `buzz-${eventId.slice(0, 16)}`;
}

function addDays(from: Date, days: number): string {
  const due = new Date(from.getTime());
  due.setUTCDate(due.getUTCDate() + days);
  return due.toISOString().slice(0, 10);
}

/** A short, human-readable label for what kind of Buzz activity this was. */
function describeKind(kind: number): string {
  switch (kind) {
    case BUZZ_KIND.jobRequest: return 'Buzz job request';
    case BUZZ_KIND.jobError: return 'Buzz job failed';
    case BUZZ_KIND.channelMessageEdit: return 'Buzz message edited';
    default: return 'Buzz message';
  }
}

/**
 * Derive a work item from an inbound Buzz event.
 *
 * Returns a reason rather than throwing for anything not derivable, so a noisy
 * channel quietly produces nothing instead of erroring. **Only a summary title
 * crosses the boundary** — the message body is never stored; the pointer is how
 * a user gets back to the real conversation.
 */
export function deriveWorkItemFromEvent(
  event: NostrEvent,
  context: DerivationContext,
): DerivationResult {
  if (!DERIVABLE_KINDS.has(event.kind)) {
    return { ok: false, reason: `Buzz kind ${event.kind} does not become a work item.` };
  }

  const title = sanitizeDerivedText(event.content);
  if (!title) {
    return { ok: false, reason: 'The event carried no usable text to summarise.' };
  }

  const pointer: BuzzThreadPointer = {
    eventId: event.id,
    authorPubkey: event.pubkey,
    ...(findTagValue(event, 'h') ? { channelId: findTagValue(event, 'h') as string } : {}),
    ...(findTagValue(event, 'e') ? { rootEventId: findTagValue(event, 'e') as string } : {}),
  };

  const nowIso = context.now.toISOString();
  const followUp: FollowUp = {
    id: deriveFollowUpId(event.id),
    title: `${describeKind(event.kind)}: ${title}`,
    dueDate: addDays(context.now, context.dueInDays ?? 1),
    cadence: 'once',
    status: 'open',
    // Not linked to a stakeholder/run record: the source is Buzz, and inventing
    // a link would be a claim the event doesn't support.
    linked: { kind: 'none' },
    channelHint: 'buzz',
    createdAt: nowIso,
    updatedAt: nowIso,
    ...(context.withContactId ? { withContactId: context.withContactId } : {}),
  };

  return { ok: true, item: { followUp, pointer } };
}

/**
 * Derive work items for a batch of events, dropping the underivable ones and
 * de-duplicating by event id — a reconnect deliberately replays a small overlap
 * (see `buildResumePlan`), so the same event legitimately arrives twice.
 */
export function deriveWorkItems(
  events: NostrEvent[],
  context: DerivationContext,
): DerivedWorkItem[] {
  const seen = new Set<string>();
  const items: DerivedWorkItem[] = [];

  for (const event of events) {
    if (seen.has(event.id)) {
      continue;
    }
    seen.add(event.id);
    const result = deriveWorkItemFromEvent(event, context);
    if (result.ok) {
      items.push(result.item);
    }
  }

  return items;
}

/**
 * Build the `https` deep link back to a Buzz thread.
 *
 * Returns undefined unless the workspace base is a valid `https` origin — the
 * same allowlist posture the Director's contact deep links use, so a crafted
 * pointer can never produce a launchable non-https URI.
 */
export function buildBuzzThreadLink(
  workspaceBaseUrl: string,
  pointer: BuzzThreadPointer,
): string | undefined {
  let base: URL;
  try {
    base = new URL(workspaceBaseUrl);
  } catch {
    return undefined;
  }
  if (base.protocol.toLowerCase() !== 'https:') {
    return undefined;
  }
  if (!pointer.channelId) {
    return undefined;
  }

  const link = new URL(base.href.endsWith('/') ? base.href : `${base.href}/`);
  link.pathname = `${link.pathname}channels/${encodeURIComponent(pointer.channelId)}`;
  link.searchParams.set('event', pointer.eventId);
  return link.toString();
}
