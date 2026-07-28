import { describe, expect, it } from 'vitest';
import {
  BUZZ_INBOUND_KINDS,
  BUZZ_KIND,
  MAX_RELAY_FRAME_BYTES,
  buildAuthEventTemplate,
  buildAuthFrame,
  buildCloseFrame,
  buildSubscriptionFrame,
  classifyRelayRefusal,
  findTagValue,
  parseRelayFrame,
  validateNostrEvent,
  type NostrEvent,
} from '../../src/core/buzzProtocol.ts';

const HEX32 = 'a'.repeat(64);
const HEX64 = 'b'.repeat(128);

function event(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: HEX32,
    pubkey: HEX32,
    created_at: 1_700_000_000,
    kind: BUZZ_KIND.channelMessage,
    tags: [['h', 'channel-1']],
    content: 'hello',
    sig: HEX64,
    ...overrides,
  };
}

describe('verified kind registry', () => {
  it('uses the kind numbers read from buzz-core/src/kind.rs', () => {
    expect(BUZZ_KIND.channelMessageV2).toBe(40002);
    expect(BUZZ_KIND.channelMessageEdit).toBe(40003);
    expect(BUZZ_KIND.systemMessage).toBe(40099);
    expect(BUZZ_KIND.channelMetadata).toBe(39000);
    expect(BUZZ_KIND.threadSummary).toBe(39005);
    expect(BUZZ_KIND.auth).toBe(22242);
  });

  it('treats kind 9 as the channel message, as a live relay actually serves', () => {
    // Verified empirically: a real Buzz relay's stored history contained kind 9
    // messages and NO 40002 events. Reading the registry alone suggested the
    // opposite — an earlier version of this test asserted `not.toBe(9)` and was
    // wrong. Subscribing to 40002 alone reaches EOSE and receives nothing.
    expect(BUZZ_KIND.channelMessage).toBe(9);
  });

  it('keeps channel metadata off the legacy NIP-01 kind', () => {
    // 39000 confirmed against the same relay; kind 41 exists but is not used.
    expect(BUZZ_KIND.channelMetadata).toBe(39000);
    expect(BUZZ_KIND.channelMetadata).not.toBe(41);
  });

  it('subscribes to BOTH channel-message kinds, so neither deployment goes silent', () => {
    expect(BUZZ_INBOUND_KINDS).toContain(BUZZ_KIND.channelMessage);
    expect(BUZZ_INBOUND_KINDS).toContain(BUZZ_KIND.channelMessageV2);
    expect(BUZZ_INBOUND_KINDS.length).toBeGreaterThan(0);
  });
});

describe('validateNostrEvent', () => {
  it('accepts a well-formed event', () => {
    expect(validateNostrEvent(event())).toEqual(event());
  });

  it('rejects wrong-length hex fields', () => {
    expect(validateNostrEvent(event({ id: 'abc' }))).toBeUndefined();
    expect(validateNostrEvent(event({ pubkey: 'abc' }))).toBeUndefined();
    // A 32-byte value in the signature slot is not a signature.
    expect(validateNostrEvent(event({ sig: HEX32 }))).toBeUndefined();
  });

  it('rejects out-of-range or non-integer kinds', () => {
    expect(validateNostrEvent(event({ kind: -1 }))).toBeUndefined();
    expect(validateNostrEvent(event({ kind: 65_536 }))).toBeUndefined();
    expect(validateNostrEvent(event({ kind: 1.5 }))).toBeUndefined();
  });

  it('rejects malformed tags rather than coercing them', () => {
    expect(validateNostrEvent(event({ tags: 'nope' as unknown as string[][] }))).toBeUndefined();
    expect(validateNostrEvent(event({ tags: [[1] as unknown as string[]] }))).toBeUndefined();
    expect(validateNostrEvent(event({ tags: ['h' as unknown as string[]] }))).toBeUndefined();
  });

  it('rejects non-objects and non-finite timestamps', () => {
    expect(validateNostrEvent(null)).toBeUndefined();
    expect(validateNostrEvent([])).toBeUndefined();
    expect(validateNostrEvent('event')).toBeUndefined();
    expect(validateNostrEvent(event({ created_at: Number.NaN }))).toBeUndefined();
  });

  it('does not confuse structural validity with authenticity', () => {
    // A structurally valid event with a bogus signature still validates —
    // signature verification is the relay's job under NIP-42.
    expect(validateNostrEvent(event({ sig: 'c'.repeat(128) }))).toBeDefined();
  });
});

describe('parseRelayFrame', () => {
  it('parses each NIP-01 relay frame', () => {
    expect(parseRelayFrame(JSON.stringify(['EVENT', 'sub1', event()]))).toEqual({
      type: 'EVENT', subscriptionId: 'sub1', event: event(),
    });
    expect(parseRelayFrame(JSON.stringify(['OK', HEX32, true, 'stored']))).toEqual({
      type: 'OK', eventId: HEX32, accepted: true, message: 'stored',
    });
    expect(parseRelayFrame(JSON.stringify(['EOSE', 'sub1']))).toEqual({ type: 'EOSE', subscriptionId: 'sub1' });
    expect(parseRelayFrame(JSON.stringify(['CLOSED', 'sub1', 'restricted: no']))).toEqual({
      type: 'CLOSED', subscriptionId: 'sub1', message: 'restricted: no',
    });
    expect(parseRelayFrame(JSON.stringify(['NOTICE', 'hi']))).toEqual({ type: 'NOTICE', message: 'hi' });
    expect(parseRelayFrame(JSON.stringify(['AUTH', 'nonce']))).toEqual({ type: 'AUTH', challenge: 'nonce' });
  });

  it('treats a malformed event inside an EVENT frame as unknown', () => {
    const frame = parseRelayFrame(JSON.stringify(['EVENT', 'sub1', { id: 'bad' }]));
    expect(frame.type).toBe('unknown');
  });

  it('never throws on hostile or malformed input', () => {
    const hostile = ['', '{', 'null', '[]', '"EVENT"', '[1,2,3]', '[]]', JSON.stringify(['EVENT'])];
    for (const raw of hostile) {
      expect(() => parseRelayFrame(raw)).not.toThrow();
      expect(parseRelayFrame(raw).type).toBe('unknown');
    }
  });

  it('rejects an oversized frame instead of parsing it', () => {
    const huge = `["NOTICE","${'x'.repeat(MAX_RELAY_FRAME_BYTES)}"]`;
    const frame = parseRelayFrame(huge);
    expect(frame).toEqual({ type: 'unknown', reason: 'Relay frame exceeded the size cap.' });
  });

  it('rejects an OK frame whose accepted flag is not a boolean', () => {
    expect(parseRelayFrame(JSON.stringify(['OK', HEX32, 'true', ''])).type).toBe('unknown');
  });

  it('rejects an AUTH frame with an empty challenge', () => {
    expect(parseRelayFrame(JSON.stringify(['AUTH', ''])).type).toBe('unknown');
  });

  it('reports an unsupported frame label without failing', () => {
    const frame = parseRelayFrame(JSON.stringify(['COUNT', 'sub1']));
    expect(frame.type).toBe('unknown');
    expect(frame.type === 'unknown' && frame.reason).toContain('COUNT');
  });
});

describe('classifyRelayRefusal', () => {
  it('distinguishes recoverable auth-required from terminal restricted', () => {
    expect(classifyRelayRefusal('auth-required: please authenticate')).toBe('auth-required');
    expect(classifyRelayRefusal('restricted: key not allowed')).toBe('restricted');
    expect(classifyRelayRefusal('AUTH-REQUIRED: caps')).toBe('auth-required');
    expect(classifyRelayRefusal('duplicate: already have it')).toBeUndefined();
    expect(classifyRelayRefusal('')).toBeUndefined();
  });
});

describe('buildSubscriptionFrame', () => {
  it('builds a REQ frame with its filters', () => {
    const built = buildSubscriptionFrame('sub1', [{ kinds: [BUZZ_KIND.channelMessage], '#h': ['chan'] }]);
    expect(built.ok).toBe(true);
    expect(built.ok === true && JSON.parse(built.frame)).toEqual([
      'REQ', 'sub1', { kinds: [BUZZ_KIND.channelMessage], '#h': ['chan'] },
    ]);
  });

  it('refuses a kind-less filter — the documented 403 p-gate trap', () => {
    const built = buildSubscriptionFrame('sub1', [{ kinds: [] }]);
    expect(built.ok).toBe(false);
    expect(built.ok === false && built.reason).toMatch(/403/);
  });

  it('refuses out-of-range kinds and empty inputs', () => {
    expect(buildSubscriptionFrame('sub1', [{ kinds: [70_000] }]).ok).toBe(false);
    expect(buildSubscriptionFrame('', [{ kinds: [1] }]).ok).toBe(false);
    expect(buildSubscriptionFrame('sub1', []).ok).toBe(false);
  });
});

describe('buildCloseFrame', () => {
  it('builds a CLOSE frame and requires a subscription id', () => {
    expect(buildCloseFrame('sub1')).toEqual({ ok: true, frame: '["CLOSE","sub1"]' });
    expect(buildCloseFrame('  ').ok).toBe(false);
  });
});

describe('NIP-42 auth', () => {
  it('builds the kind-22242 template with relay and challenge tags', () => {
    const built = buildAuthEventTemplate('ws://localhost:3000', 'nonce-1', 1_700_000_000.7);
    expect(built.ok).toBe(true);
    expect(built.ok === true && built.event).toEqual({
      kind: 22242,
      created_at: 1_700_000_000,
      tags: [['relay', 'ws://localhost:3000'], ['challenge', 'nonce-1']],
      content: '',
    });
  });

  it('refuses to build without a relay, challenge, or valid clock', () => {
    expect(buildAuthEventTemplate('', 'nonce', 1).ok).toBe(false);
    expect(buildAuthEventTemplate('ws://localhost:3000', '', 1).ok).toBe(false);
    expect(buildAuthEventTemplate('ws://localhost:3000', 'nonce', Number.NaN).ok).toBe(false);
  });

  it('wraps a signed auth event and rejects a wrong-kind one', () => {
    const signed = event({ kind: 22242 });
    const frame = buildAuthFrame(signed);
    expect(frame.ok).toBe(true);
    expect(frame.ok === true && JSON.parse(frame.frame)[0]).toBe('AUTH');

    expect(buildAuthFrame(event({ kind: 1 })).ok).toBe(false);
  });
});

describe('findTagValue', () => {
  it('reads the first matching tag value', () => {
    const tagged = event({ tags: [['e', 'root'], ['h', 'chan-1'], ['h', 'chan-2']] });
    expect(findTagValue(tagged, 'h')).toBe('chan-1');
    expect(findTagValue(tagged, 'e')).toBe('root');
    expect(findTagValue(tagged, 'p')).toBeUndefined();
  });

  it('ignores a tag with no value', () => {
    expect(findTagValue(event({ tags: [['h']] }), 'h')).toBeUndefined();
  });
});
