import { describe, expect, it } from 'vitest';
import {
  MAX_DERIVED_TITLE_LENGTH,
  buildBuzzThreadLink,
  deriveWorkItemFromEvent,
  deriveWorkItems,
  sanitizeDerivedText,
} from '../../src/core/buzzInboundDerivation.ts';
import { BUZZ_KIND, type NostrEvent } from '../../src/core/buzzProtocol.ts';

const NOW = new Date('2026-07-27T12:00:00.000Z');

function event(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'e'.repeat(64),
    pubkey: 'p'.repeat(64),
    created_at: 1_700_000_000,
    kind: BUZZ_KIND.channelMessage,
    tags: [['h', 'chan-1']],
    content: 'Can you review the deploy plan?',
    sig: 's'.repeat(128),
    ...overrides,
  };
}

describe('sanitizeDerivedText', () => {
  it('collapses whitespace and trims', () => {
    expect(sanitizeDerivedText('  hello   there \n world ')).toBe('hello there world');
  });

  it('redacts secret-shaped material before it can reach a git-tracked file', () => {
    expect(sanitizeDerivedText('key nsec1qpzry9x8gf2tvdw0s3jn54khce6mua7l')).toContain('[redacted]');
    expect(sanitizeDerivedText(`hash ${'a'.repeat(64)}`)).toBe('hash [redacted]');
    expect(sanitizeDerivedText('token sk-abcdefghijklmnopqrstuvwx')).toContain('[redacted]');
    expect(sanitizeDerivedText('token ghp_abcdefghijklmnopqrstuvwxyz')).toContain('[redacted]');
    expect(sanitizeDerivedText('token xoxb-1234567890-abcdef')).toContain('[redacted]');
  });

  it('strips control characters so a crafted message cannot corrupt a mirror file', () => {
    expect(sanitizeDerivedText('a\x00b\x1fc\x7fd')).toBe('a b c d');
  });

  it('clamps to the title length', () => {
    const long = sanitizeDerivedText('x'.repeat(500));
    expect(long.length).toBeLessThanOrEqual(MAX_DERIVED_TITLE_LENGTH + 1);
    expect(long.endsWith('…')).toBe(true);
  });

  it('handles non-string input without throwing', () => {
    expect(sanitizeDerivedText(undefined as unknown as string)).toBe('');
  });
});

describe('deriveWorkItemFromEvent', () => {
  it('derives a follow-up with a pointer back to the Buzz thread', () => {
    const result = deriveWorkItemFromEvent(event(), { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) { return; }

    expect(result.item.followUp.title).toBe('Buzz message: Can you review the deploy plan?');
    expect(result.item.followUp.status).toBe('open');
    expect(result.item.followUp.cadence).toBe('once');
    expect(result.item.followUp.channelHint).toBe('buzz');
    expect(result.item.followUp.dueDate).toBe('2026-07-28');
    expect(result.item.pointer).toEqual({
      eventId: 'e'.repeat(64),
      authorPubkey: 'p'.repeat(64),
      channelId: 'chan-1',
    });
  });

  it('NEVER stores the raw message body — only a summarised title', () => {
    const secret = 'Internal: the merger closes Friday, do not share externally.';
    const result = deriveWorkItemFromEvent(event({ content: secret }), { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) { return; }

    // The derived record carries no `content`/`body` field at all.
    const serialised = JSON.stringify(result.item);
    expect(serialised).not.toContain('"content"');
    expect(serialised).not.toContain('"body"');
    // The title is the only text, and it is bounded.
    expect(result.item.followUp.title.length).toBeLessThanOrEqual(MAX_DERIVED_TITLE_LENGTH + 40);
  });

  it('redacts secrets that appear in a message before deriving a title', () => {
    const result = deriveWorkItemFromEvent(event({ content: `deploy key ${'f'.repeat(64)}` }), { now: NOW });
    expect(result.ok && result.item.followUp.title).toContain('[redacted]');
    expect(result.ok && result.item.followUp.title).not.toContain('f'.repeat(64));
  });

  it('records the thread root for a reply', () => {
    const reply = event({ tags: [['h', 'chan-1'], ['e', 'root-event']] });
    const result = deriveWorkItemFromEvent(reply, { now: NOW });
    expect(result.ok && result.item.pointer.rootEventId).toBe('root-event');
  });

  it('labels job events distinctly', () => {
    const jobError = deriveWorkItemFromEvent(event({ kind: BUZZ_KIND.jobError }), { now: NOW });
    expect(jobError.ok && jobError.item.followUp.title).toMatch(/^Buzz job failed:/);

    const jobRequest = deriveWorkItemFromEvent(event({ kind: BUZZ_KIND.jobRequest }), { now: NOW });
    expect(jobRequest.ok && jobRequest.item.followUp.title).toMatch(/^Buzz job request:/);
  });

  it('ignores kinds that are not work items', () => {
    for (const kind of [BUZZ_KIND.reaction, BUZZ_KIND.typingIndicator, BUZZ_KIND.presenceUpdate]) {
      const result = deriveWorkItemFromEvent(event({ kind }), { now: NOW });
      expect(result.ok).toBe(false);
    }
  });

  it('does not invent a linked entity it cannot support', () => {
    const result = deriveWorkItemFromEvent(event(), { now: NOW });
    expect(result.ok && result.item.followUp.linked).toEqual({ kind: 'none' });
    expect(result.ok && result.item.followUp.withContactId).toBeUndefined();
  });

  it('links a known contact when the caller resolved one', () => {
    const result = deriveWorkItemFromEvent(event(), { now: NOW, withContactId: 'contact-7' });
    expect(result.ok && result.item.followUp.withContactId).toBe('contact-7');
  });

  it('drops an event with no usable text instead of creating an empty item', () => {
    expect(deriveWorkItemFromEvent(event({ content: '   ' }), { now: NOW }).ok).toBe(false);
  });

  it('is deterministic — the same event derives the same id', () => {
    const a = deriveWorkItemFromEvent(event(), { now: NOW });
    const b = deriveWorkItemFromEvent(event(), { now: NOW });
    expect(a.ok && b.ok && a.item.followUp.id).toBe(b.ok ? b.item.followUp.id : '');
  });
});

describe('deriveWorkItems', () => {
  it('de-duplicates the replay overlap a reconnect deliberately creates', () => {
    const duplicate = event();
    const items = deriveWorkItems([duplicate, duplicate, event({ id: 'f'.repeat(64) })], { now: NOW });
    expect(items).toHaveLength(2);
  });

  it('drops underivable events without failing the batch', () => {
    const items = deriveWorkItems(
      [event(), event({ id: 'f'.repeat(64), kind: BUZZ_KIND.reaction }), event({ id: '0'.repeat(64), content: '' })],
      { now: NOW },
    );
    expect(items).toHaveLength(1);
  });

  it('returns an empty list for no events', () => {
    expect(deriveWorkItems([], { now: NOW })).toEqual([]);
  });
});

describe('buildBuzzThreadLink', () => {
  const pointer = { eventId: 'e'.repeat(64), authorPubkey: 'p'.repeat(64), channelId: 'chan-1' };

  it('builds an https link to the channel and event', () => {
    const link = buildBuzzThreadLink('https://buzz.example.com', pointer);
    expect(link).toContain('https://buzz.example.com/channels/chan-1');
    expect(link).toContain(`event=${'e'.repeat(64)}`);
  });

  it('refuses any non-https base — the deep-link scheme allowlist', () => {
    expect(buildBuzzThreadLink('http://buzz.example.com', pointer)).toBeUndefined();
    expect(buildBuzzThreadLink('ws://localhost:3000', pointer)).toBeUndefined();
    expect(buildBuzzThreadLink('javascript:alert(1)', pointer)).toBeUndefined();
    expect(buildBuzzThreadLink('file:///etc/passwd', pointer)).toBeUndefined();
    expect(buildBuzzThreadLink('not a url', pointer)).toBeUndefined();
  });

  it('encodes a hostile channel id rather than letting it alter the path', () => {
    const link = buildBuzzThreadLink('https://buzz.example.com', { ...pointer, channelId: '../../admin' });
    expect(link).toBeDefined();
    expect(link).not.toContain('../../admin');
    expect(link).toContain('%2F');
  });

  it('returns undefined without a channel id', () => {
    expect(buildBuzzThreadLink('https://buzz.example.com', { eventId: 'e', authorPubkey: 'p' })).toBeUndefined();
  });
});
