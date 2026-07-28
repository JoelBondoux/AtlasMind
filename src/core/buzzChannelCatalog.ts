/**
 * Buzz channel catalog — turning `buzz channels list` into something a person
 * can tick.
 *
 * A channel id that does not match the channel you posted in is the single most
 * common reason a correctly configured Buzz subscription receives nothing, and
 * it is undiagnosable from inside AtlasMind: the wrong id, the wrong relay, and
 * a quiet day all look identical. Until now the only remedy was "go and copy
 * the id out of the Buzz app". The CLI already knows the real ids, so this
 * module reads them.
 *
 * **The field names are verified, not guessed.** `buzz channels list
 * --format compact` emits an array of `{ channel_id, name }` — read from
 * `crates/buzz-cli/src/commands/channels.rs` at the pinned release, where the
 * compact projection is written out literally. The parser still accepts the
 * other obvious spellings, because being tolerant of a rename costs nothing and
 * failing closed on one costs a user their channel list.
 *
 * **The output is untrusted.** Channel names are written by whoever created the
 * channel, and they end up in a QuickPick and, for the id, in a settings array
 * that AtlasMind later subscribes with. So: never throws, ids are constrained
 * to a printable-safe charset rather than accepted as arbitrary text, names are
 * redacted, control-stripped, and clamped, and anything unusable is counted
 * rather than silently dropped.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

import { sanitizeDerivedText } from './buzzInboundDerivation.js';

/** Cap on channels taken from one listing, matching the CLI's own `--limit`. */
export const MAX_BUZZ_CHANNELS = 100;

/** Channel names are for recognition, not for reading. */
export const MAX_CHANNEL_NAME_LENGTH = 60;

/**
 * What an id is allowed to look like.
 *
 * Buzz channel ids are UUIDs in practice — the pinned `messages send --channel`
 * contract requires one — but they originate as a Nostr `d` tag, which is an
 * arbitrary string. Requiring a UUID would drop a valid channel; accepting
 * arbitrary text would let a crafted listing put whitespace, control characters,
 * or something shell-shaped into a settings array. This is the middle: the
 * characters an identifier can plausibly need, and nothing else.
 */
const CHANNEL_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** Field names that have held the channel id, most-authoritative first. */
const ID_KEYS = ['channel_id', 'channelId', 'id', 'uuid'] as const;

/** Field names that have held the display name. */
const NAME_KEYS = ['name', 'title', 'display_name'] as const;

export interface BuzzChannelSummary {
  /** The id that goes into `atlasmind.buzz.inboundChannels`. */
  id: string;
  /** The channel's own name, when it published one. Never trusted as an id. */
  name?: string;
}

export interface BuzzChannelCatalog {
  channels: BuzzChannelSummary[];
  /**
   * Entries that carried no usable id. Reported rather than hidden: "6 of 8
   * channels" is a fact worth showing, since the two that vanished may be the
   * ones being looked for.
   */
  skipped: number;
}

function readString(entry: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = entry[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * Parse whatever `channels list` returned into a list of tickable channels.
 *
 * Never throws. A response of the wrong shape entirely yields an empty catalog,
 * because a setup helper that crashes on an unexpected CLI release is worse than
 * one that says it found nothing.
 */
export function parseBuzzChannelList(value: unknown): BuzzChannelCatalog {
  if (!Array.isArray(value)) {
    return { channels: [], skipped: 0 };
  }

  const channels: BuzzChannelSummary[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const raw of value) {
    if (channels.length >= MAX_BUZZ_CHANNELS) {
      break;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      skipped += 1;
      continue;
    }

    const entry = raw as Record<string, unknown>;
    const id = readString(entry, ID_KEYS);
    if (!id || !CHANNEL_ID_PATTERN.test(id)) {
      skipped += 1;
      continue;
    }
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);

    const name = sanitizeDerivedText(readString(entry, NAME_KEYS) ?? '', MAX_CHANNEL_NAME_LENGTH);
    channels.push({ id, ...(name ? { name } : {}) });
  }

  return { channels, skipped };
}

/**
 * A label for one channel in a picker.
 *
 * The id is always shown, never only the name: the id is the thing being
 * written into settings, and two channels can publish the same name.
 */
export function describeBuzzChannel(channel: BuzzChannelSummary): string {
  return channel.name ? `${channel.name} — ${channel.id}` : channel.id;
}

/**
 * The channel list to store, given what is watched now and what was ticked.
 *
 * The picker starts with the current selection ticked, so unticking is how a
 * channel is removed — the result is exactly the selection. Ids already in
 * settings but absent from the relay's listing are **kept**: a channel the CLI
 * could not see is far more likely to be a permissions or paging gap than a
 * deliberate removal, and silently dropping it would unsubscribe someone from a
 * channel they never touched.
 */
export function resolveWatchedChannels(
  current: readonly string[],
  listed: readonly BuzzChannelSummary[],
  selected: readonly string[],
): string[] {
  const listedIds = new Set(listed.map(channel => channel.id));
  const unlisted = current.filter(id => typeof id === 'string' && id.trim() && !listedIds.has(id.trim()));
  const chosen = selected.filter(id => listedIds.has(id));
  return [...new Set([...unlisted.map(id => id.trim()), ...chosen])];
}
