import { describe, expect, it } from 'vitest';

import {
  MAX_BUZZ_IDENTITIES,
  MAX_CHANNELS_PER_IDENTITY,
  applyProfile,
  createBuzzDirectory,
  describeIdentity,
  identitiesMissingProfiles,
  listIdentities,
  observeEvent,
  recordSighting,
} from '../../src/core/buzzDirectory.ts';
import { BUZZ_KIND, type NostrEvent } from '../../src/core/buzzProtocol.ts';

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

function message(pubkey: string, overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'e'.repeat(64),
    pubkey,
    created_at: 1_700_000_000,
    kind: BUZZ_KIND.channelMessage,
    tags: [['h', 'chan-1']],
    content: 'Deploy failed on staging',
    sig: 'c'.repeat(128),
    ...overrides,
  };
}

function profile(pubkey: string, content: string, createdAt = 1_700_000_000): NostrEvent {
  return {
    id: 'f'.repeat(64),
    pubkey,
    created_at: createdAt,
    kind: BUZZ_KIND.profileMetadata,
    tags: [],
    content,
    sig: 'c'.repeat(128),
  };
}

describe('recordSighting', () => {
  it('records an identity that posted, with the channel it posted in', () => {
    const directory = createBuzzDirectory();
    recordSighting(directory, message(ALICE));
    expect(directory.get(ALICE)).toMatchObject({ pubkey: ALICE, channelIds: ['chan-1'] });
  });

  it('never invents a name — an unseen profile leaves the identity unnamed', () => {
    const directory = createBuzzDirectory();
    recordSighting(directory, message(ALICE));
    expect(directory.get(ALICE)?.displayName).toBeUndefined();
  });

  it('keeps the most recent activity time', () => {
    const directory = createBuzzDirectory();
    recordSighting(directory, message(ALICE, { created_at: 1_700_000_000 }));
    recordSighting(directory, message(ALICE, { created_at: 1_700_000_500 }));
    recordSighting(directory, message(ALICE, { created_at: 1_600_000_000 }));
    expect(directory.get(ALICE)?.lastSeenAt).toBe(1_700_000_500);
  });

  it('collects distinct channels without duplicating', () => {
    const directory = createBuzzDirectory();
    recordSighting(directory, message(ALICE, { tags: [['h', 'chan-1']] }));
    recordSighting(directory, message(ALICE, { tags: [['h', 'chan-2']] }));
    recordSighting(directory, message(ALICE, { tags: [['h', 'chan-1']] }));
    expect(directory.get(ALICE)?.channelIds).toEqual(['chan-1', 'chan-2']);
  });

  it('caps the channels remembered per identity', () => {
    const directory = createBuzzDirectory();
    for (let index = 0; index < MAX_CHANNELS_PER_IDENTITY + 5; index += 1) {
      recordSighting(directory, message(ALICE, { tags: [['h', `chan-${index}`]] }));
    }
    expect(directory.get(ALICE)?.channelIds).toHaveLength(MAX_CHANNELS_PER_IDENTITY);
  });

  it('ignores an author that is not a usable key rather than guessing', () => {
    const directory = createBuzzDirectory();
    for (const bad of ['', 'not-hex', 'a'.repeat(63), 'z'.repeat(64)]) {
      recordSighting(directory, message(bad));
    }
    expect(directory.size).toBe(0);
  });

  it('normalises an uppercase key to one identity, not two', () => {
    const directory = createBuzzDirectory();
    recordSighting(directory, message(ALICE));
    recordSighting(directory, message(ALICE.toUpperCase()));
    expect(directory.size).toBe(1);
  });

  it('stops growing at the cap', () => {
    const directory = createBuzzDirectory();
    for (let index = 0; index < MAX_BUZZ_IDENTITIES + 20; index += 1) {
      recordSighting(directory, message(index.toString(16).padStart(64, '0')));
    }
    expect(directory.size).toBe(MAX_BUZZ_IDENTITIES);
  });
});

describe('applyProfile', () => {
  it('attaches the display_name a live relay actually serves', () => {
    const directory = createBuzzDirectory();
    recordSighting(directory, message(ALICE));
    applyProfile(directory, profile(ALICE, JSON.stringify({ display_name: 'Joel', about: 'Builds AtlasMind' })));
    expect(directory.get(ALICE)).toMatchObject({ displayName: 'Joel', about: 'Builds AtlasMind' });
  });

  it('falls back to the short `name` form when display_name is absent', () => {
    const directory = createBuzzDirectory();
    applyProfile(directory, profile(ALICE, JSON.stringify({ name: 'atlas-bot' })));
    expect(directory.get(ALICE)?.displayName).toBe('atlas-bot');
  });

  it('ignores an event that is not a profile', () => {
    const directory = createBuzzDirectory();
    applyProfile(directory, message(ALICE));
    expect(directory.size).toBe(0);
  });

  it('never throws on malformed profile content', () => {
    const directory = createBuzzDirectory();
    for (const bad of ['', 'not json', '[]', 'null', '42', '{"display_name":']) {
      expect(() => applyProfile(directory, profile(ALICE, bad))).not.toThrow();
    }
    expect(directory.get(ALICE)?.displayName).toBeUndefined();
  });

  it('strips control characters from a name — it is remote-controlled text', () => {
    const directory = createBuzzDirectory();
    const hostile = `Jo\u001b[31m\u0000 el`;
    applyProfile(directory, profile(ALICE, JSON.stringify({ display_name: hostile })));
    const name = directory.get(ALICE)?.displayName ?? '';
    expect(name).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(name).toContain('Jo');
  });

  it('redacts a secret pasted into a display name', () => {
    const directory = createBuzzDirectory();
    applyProfile(directory, profile(ALICE, JSON.stringify({ display_name: 'key sk-abcdefghijklmnopqrstuvwxyz012345' })));
    expect(directory.get(ALICE)?.displayName).not.toContain('sk-abcdefghijklmnopqrstuvwxyz012345');
  });

  it('clamps an overlong name', () => {
    const directory = createBuzzDirectory();
    applyProfile(directory, profile(ALICE, JSON.stringify({ display_name: 'n'.repeat(500) })));
    expect((directory.get(ALICE)?.displayName ?? '').length).toBeLessThanOrEqual(61);
  });

  it('leaves an existing name in place when a later profile carries none', () => {
    const directory = createBuzzDirectory();
    applyProfile(directory, profile(ALICE, JSON.stringify({ display_name: 'Joel' })));
    applyProfile(directory, profile(ALICE, JSON.stringify({ about: 'no name here' })));
    expect(directory.get(ALICE)?.displayName).toBe('Joel');
  });
});

describe('observeEvent', () => {
  it('routes each kind to the right recorder', () => {
    const directory = createBuzzDirectory();
    observeEvent(directory, message(ALICE));
    observeEvent(directory, profile(ALICE, JSON.stringify({ display_name: 'Joel' })));
    expect(directory.get(ALICE)).toMatchObject({ displayName: 'Joel', channelIds: ['chan-1'] });
  });

  it('never throws on any event shape', () => {
    const directory = createBuzzDirectory();
    expect(() => observeEvent(directory, message(ALICE, { tags: [] }))).not.toThrow();
    expect(() => observeEvent(directory, message(ALICE, { created_at: Number.NaN }))).not.toThrow();
  });
});

describe('listIdentities', () => {
  it('orders by most recent activity — the person you are adding just posted', () => {
    const directory = createBuzzDirectory();
    recordSighting(directory, message(ALICE, { created_at: 1_700_000_000 }));
    recordSighting(directory, message(BOB, { created_at: 1_700_000_900 }));
    expect(listIdentities(directory).map(identity => identity.pubkey)).toEqual([BOB, ALICE]);
  });

  it('returns copies, so a caller cannot mutate the directory through them', () => {
    const directory = createBuzzDirectory();
    recordSighting(directory, message(ALICE));
    listIdentities(directory)[0]?.channelIds.push('injected');
    expect(directory.get(ALICE)?.channelIds).toEqual(['chan-1']);
  });
});

describe('identitiesMissingProfiles', () => {
  it('lists only the identities with no name yet', () => {
    const directory = createBuzzDirectory();
    recordSighting(directory, message(ALICE));
    recordSighting(directory, message(BOB));
    applyProfile(directory, profile(ALICE, JSON.stringify({ display_name: 'Joel' })));
    expect(identitiesMissingProfiles(directory)).toEqual([BOB]);
  });

  it('is bounded — a profile filter is a request, not a scan', () => {
    const directory = createBuzzDirectory();
    for (let index = 0; index < 80; index += 1) {
      recordSighting(directory, message(index.toString(16).padStart(64, '0')));
    }
    expect(identitiesMissingProfiles(directory, 50)).toHaveLength(50);
    expect(identitiesMissingProfiles(directory, 0)).toHaveLength(0);
  });
});

describe('describeIdentity', () => {
  it('uses the published name when there is one', () => {
    expect(describeIdentity({ pubkey: ALICE, displayName: 'Joel', lastSeenAt: 0, channelIds: [] })).toBe('Joel');
  });

  it('falls back to a truncated key rather than inventing a person', () => {
    expect(describeIdentity({ pubkey: ALICE, lastSeenAt: 0, channelIds: [] })).toBe(`${'a'.repeat(12)}…`);
  });
});
