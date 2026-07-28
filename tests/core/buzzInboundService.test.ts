import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  workspace: { getConfiguration: () => ({ get: (_k: string, d: unknown) => d }), workspaceFolders: [] },
}));

const {
  MAX_INBOUND_FOLLOWUPS_PER_BATCH,
  buildInboundFilters,
  mergeDerivedFollowUps,
} = await import('../../src/core/buzzInboundService.ts');
const { BUZZ_INBOUND_KINDS, BUZZ_KIND } = await import('../../src/core/buzzProtocol.ts');
const { buildSubscriptionFrame } = await import('../../src/core/buzzProtocol.ts');
import type { DerivedWorkItem } from '../../src/core/buzzInboundDerivation.ts';
import type { FollowUp } from '../../src/types.ts';

function followUp(id: string): FollowUp {
  return {
    id,
    title: `Buzz message: ${id}`,
    dueDate: '2026-07-29',
    cadence: 'once',
    status: 'open',
    linked: { kind: 'none' },
    channelHint: 'buzz',
    createdAt: '2026-07-28T12:00:00.000Z',
    updatedAt: '2026-07-28T12:00:00.000Z',
  };
}

function derived(id: string): DerivedWorkItem {
  return {
    followUp: followUp(id),
    pointer: { eventId: `${id}-event`, authorPubkey: 'b'.repeat(64) },
  };
}

describe('buildInboundFilters', () => {
  it('always sets kinds, so the filter can never trip the relay 403 gate', () => {
    const filters = buildInboundFilters([]);
    expect(filters[0]?.kinds).toEqual(BUZZ_INBOUND_KINDS);
    // The protocol guard must accept what we build.
    expect(buildSubscriptionFrame('sub', filters).ok).toBe(true);
  });

  it('includes both channel-message kinds, so neither deployment goes silent', () => {
    const kinds = buildInboundFilters([])[0]?.kinds ?? [];
    expect(kinds).toContain(BUZZ_KIND.channelMessage);
    expect(kinds).toContain(BUZZ_KIND.channelMessageV2);
  });

  it('scopes to the configured channels via the h tag', () => {
    const filters = buildInboundFilters(['chan-1', 'chan-2']);
    expect(filters[0]?.['#h']).toEqual(['chan-1', 'chan-2']);
  });

  it('omits the tag filter entirely when no channels are configured', () => {
    expect(buildInboundFilters([])[0]?.['#h']).toBeUndefined();
  });

  it('does not alias the caller\'s array', () => {
    const channels = ['chan-1'];
    const filters = buildInboundFilters(channels);
    channels.push('chan-2');
    expect(filters[0]?.['#h']).toEqual(['chan-1']);
  });
});

describe('mergeDerivedFollowUps', () => {
  it('appends genuinely new follow-ups', () => {
    const merged = mergeDerivedFollowUps([followUp('existing')], [derived('buzz-a')]);
    expect(merged.map(entry => entry.id)).toEqual(['existing', 'buzz-a']);
  });

  it('skips ids already present — the reconnect replay must not duplicate', () => {
    const existing = [followUp('buzz-a')];
    const merged = mergeDerivedFollowUps(existing, [derived('buzz-a')]);
    // Returns the very same array so the caller can skip a pointless write.
    expect(merged).toBe(existing);
  });

  it('de-duplicates within a single batch', () => {
    const merged = mergeDerivedFollowUps([], [derived('buzz-a'), derived('buzz-a')]);
    expect(merged).toHaveLength(1);
  });

  it('caps how many a single batch may add', () => {
    const batch = Array.from({ length: MAX_INBOUND_FOLLOWUPS_PER_BATCH + 25 }, (_, i) => derived(`buzz-${i}`));
    expect(mergeDerivedFollowUps([], batch)).toHaveLength(MAX_INBOUND_FOLLOWUPS_PER_BATCH);
  });

  it('never mutates the existing list', () => {
    const existing = [followUp('existing')];
    mergeDerivedFollowUps(existing, [derived('buzz-a')]);
    expect(existing).toHaveLength(1);
  });

  it('returns the original list for an empty batch', () => {
    const existing = [followUp('existing')];
    expect(mergeDerivedFollowUps(existing, [])).toBe(existing);
  });
});
