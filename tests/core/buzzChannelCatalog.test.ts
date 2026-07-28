import { describe, expect, it } from 'vitest';

import {
  MAX_BUZZ_CHANNELS,
  describeBuzzChannel,
  parseBuzzChannelList,
  resolveWatchedChannels,
} from '../../src/core/buzzChannelCatalog.ts';

/** The shape `buzz channels list --format compact` actually emits. */
const COMPACT = [
  { channel_id: '9f1c2b7e-3a4d-4c5e-8f90-1a2b3c4d5e6f', name: 'engineering' },
  { channel_id: '0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d', name: 'design' },
];

describe('parseBuzzChannelList', () => {
  it('reads the field names the pinned CLI release actually emits', () => {
    // channel_id / name, per the compact projection in the CLI's channels.rs.
    expect(parseBuzzChannelList(COMPACT).channels).toEqual([
      { id: '9f1c2b7e-3a4d-4c5e-8f90-1a2b3c4d5e6f', name: 'engineering' },
      { id: '0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d', name: 'design' },
    ]);
  });

  it('tolerates the other obvious spellings of the id field', () => {
    // Being wrong about a rename costs a user their channel list; being
    // tolerant of one costs nothing.
    for (const key of ['channelId', 'id', 'uuid']) {
      expect(parseBuzzChannelList([{ [key]: 'abc-123', name: 'x' }]).channels[0]?.id).toBe('abc-123');
    }
  });

  it('never throws on a response of the wrong shape', () => {
    for (const value of [undefined, null, 42, 'nope', {}, [null], [[]], [{ name: 'no id' }]]) {
      expect(() => parseBuzzChannelList(value)).not.toThrow();
    }
    expect(parseBuzzChannelList('nope').channels).toEqual([]);
  });

  it('counts what it could not use rather than hiding it', () => {
    // "6 of 8" matters: the two that vanished may be the ones being looked for.
    const parsed = parseBuzzChannelList([...COMPACT, { name: 'no id here' }, 'garbage']);
    expect(parsed.channels).toHaveLength(2);
    expect(parsed.skipped).toBe(2);
  });

  it('refuses an id that is not shaped like an identifier', () => {
    // The id is written into a settings array AtlasMind later subscribes with,
    // so arbitrary text — whitespace, control characters, shell punctuation —
    // has no business reaching it.
    for (const id of ['has space', 'semi;colon', 'quote"mark', '$(whoami)', 'new\nline', 'nul\u0000byte', 'a'.repeat(129)]) {
      expect(parseBuzzChannelList([{ channel_id: id, name: 'x' }]).channels, id).toEqual([]);
    }
  });

  it('accepts a plain UUID, which is what these actually are', () => {
    expect(parseBuzzChannelList([{ channel_id: COMPACT[0]!.channel_id }]).channels[0]?.id)
      .toBe(COMPACT[0]!.channel_id);
  });

  it('sanitizes a channel name, because whoever named it is not you', () => {
    const parsed = parseBuzzChannelList([{ channel_id: 'ok-1', name: 'bad\u0000name\u001bhere' }]);
    expect(parsed.channels[0]?.name).not.toMatch(/[\u0000-\u001f]/);
  });

  it('clamps a very long name without losing the id', () => {
    const parsed = parseBuzzChannelList([{ channel_id: 'ok-1', name: 'n'.repeat(500) }]);
    expect(parsed.channels[0]?.id).toBe('ok-1');
    expect(parsed.channels[0]?.name?.length).toBeLessThanOrEqual(61);
  });

  it('omits a name rather than inventing one', () => {
    expect(parseBuzzChannelList([{ channel_id: 'ok-1' }]).channels[0]).toEqual({ id: 'ok-1' });
    expect(parseBuzzChannelList([{ channel_id: 'ok-1', name: '   ' }]).channels[0]).toEqual({ id: 'ok-1' });
  });

  it('de-duplicates by id', () => {
    const parsed = parseBuzzChannelList([{ channel_id: 'ok-1', name: 'a' }, { channel_id: 'ok-1', name: 'b' }]);
    expect(parsed.channels).toHaveLength(1);
    expect(parsed.skipped).toBe(0);
  });

  it('caps a hostile listing', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ channel_id: `c-${i}`, name: 'x' }));
    expect(parseBuzzChannelList(many).channels).toHaveLength(MAX_BUZZ_CHANNELS);
  });
});

describe('describeBuzzChannel', () => {
  it('always shows the id, since that is what gets stored', () => {
    // Two channels can publish the same name; only one id is being written.
    expect(describeBuzzChannel({ id: 'ok-1', name: 'engineering' })).toContain('ok-1');
    expect(describeBuzzChannel({ id: 'ok-1' })).toBe('ok-1');
  });
});

describe('resolveWatchedChannels', () => {
  const listed = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('stores exactly what was ticked, so unticking removes', () => {
    expect(resolveWatchedChannels(['a', 'b'], listed, ['b', 'c'])).toEqual(['b', 'c']);
  });

  it('keeps a watched id the listing did not include', () => {
    // A channel the CLI could not see is far more likely a permissions or
    // paging gap than a deliberate removal, and dropping it would unsubscribe
    // someone from a channel they never touched.
    expect(resolveWatchedChannels(['hidden', 'a'], listed, ['a'])).toEqual(['hidden', 'a']);
  });

  it('ignores a selection that was not in the listing', () => {
    expect(resolveWatchedChannels([], listed, ['a', 'not-listed'])).toEqual(['a']);
  });

  it('does not duplicate an id present in both halves', () => {
    expect(resolveWatchedChannels(['a'], listed, ['a'])).toEqual(['a']);
  });

  it('drops blank entries left in the existing setting', () => {
    expect(resolveWatchedChannels(['', '  ', 'hidden'], listed, [])).toEqual(['hidden']);
  });
});
