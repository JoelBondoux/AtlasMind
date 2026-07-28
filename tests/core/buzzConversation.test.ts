import { describe, expect, it } from 'vitest';

import {
  MAX_CONVERSATION_MESSAGES,
  MAX_OUTBOUND_LENGTH,
  clampGraphemes,
  createConversation,
  ingestEvent,
  isConversationMessage,
  recentMessages,
  sanitizeMessageText,
  validateOutboundMessage,
} from '../../src/core/buzzConversation.ts';
import { BUZZ_KIND, type NostrEvent } from '../../src/core/buzzProtocol.ts';

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const ME = 'd'.repeat(64);
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function message(id: string, content: string, overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id,
    pubkey: ALICE,
    created_at: 1_700_000_000,
    kind: BUZZ_KIND.channelMessage,
    tags: [['h', 'chan-1']],
    content,
    sig: 'c'.repeat(128),
    ...overrides,
  };
}

function reaction(targetId: string, content: string, pubkey = ALICE): NostrEvent {
  return {
    id: `r-${targetId}-${content}-${pubkey.slice(0, 4)}`,
    pubkey,
    created_at: 1_700_000_100,
    kind: BUZZ_KIND.reaction,
    tags: [['e', targetId]],
    content,
    sig: 'c'.repeat(128),
  };
}

// A truncation that splits a surrogate pair renders as a replacement character,
// and one that severs a ZWJ sequence turns a single glyph into two broken ones.
describe('clampGraphemes', () => {
  it('never splits a surrogate pair', () => {
    const { text } = clampGraphemes('\u{1F600}'.repeat(10), 5);
    expect(text).toBe('\u{1F600}'.repeat(5));
    expect(text).not.toContain('�');
  });

  it('does not leave a dangling zero-width joiner', () => {
    // Woman + ZWJ + laptop: cutting at 2 code points would end on the joiner.
    const { text } = clampGraphemes('\u{1F469}‍\u{1F4BB}\u{1F469}‍\u{1F4BB}', 2);
    expect(text.endsWith('‍')).toBe(false);
    expect(text).toBe('\u{1F469}');
  });

  it('does not leave a dangling skin-tone modifier or variation selector', () => {
    expect(clampGraphemes('\u{1F44D}\u{1F3FD}abc', 1).text).toBe('\u{1F44D}');
    expect(clampGraphemes('❤️abc', 1).text.endsWith('️')).toBe(false);
  });

  it('leaves short text untouched and reports truncation honestly', () => {
    expect(clampGraphemes('hello \u{1F44B}', 50)).toEqual({ text: 'hello \u{1F44B}', truncated: false });
    expect(clampGraphemes('abcdef', 3).truncated).toBe(true);
  });

  it('never throws on hostile input', () => {
    for (const bad of ['', undefined as unknown as string, '\uD83D']) {
      expect(() => clampGraphemes(bad, 4)).not.toThrow();
    }
  });
});

describe('sanitizeMessageText', () => {
  it('keeps emoji — stripping them would rewrite what someone said', () => {
    const out = sanitizeMessageText('ship it \u{1F680}\u{1F469}‍\u{1F4BB}');
    expect(out.text).toContain('\u{1F680}');
    expect(out.text).toContain('\u{1F469}‍\u{1F4BB}');
  });

  it('still strips control characters and redacts secrets', () => {
    const out = sanitizeMessageText('key sk-abcdefghijklmnopqrstuvwxyz012345 \u0007 done');
    expect(out.text).not.toContain('sk-abcdefghijklmnopqrstuvwxyz012345');
    expect(out.text).not.toMatch(CONTROL_CHARS);
  });
});

describe('ingestEvent', () => {
  it('adds a channel message', () => {
    const conversation = createConversation('chan-1');
    ingestEvent(conversation, message('e1', 'hello \u{1F44B}'));
    expect(conversation.messages).toHaveLength(1);
    expect(conversation.messages[0]?.text).toBe('hello \u{1F44B}');
  });

  it('is idempotent, so the reconnect replay cannot duplicate a conversation', () => {
    const conversation = createConversation('chan-1');
    ingestEvent(conversation, message('e1', 'hello'));
    ingestEvent(conversation, message('e1', 'hello'));
    expect(conversation.messages).toHaveLength(1);
  });

  it('ignores a message from another channel', () => {
    const conversation = createConversation('chan-1');
    ingestEvent(conversation, message('e1', 'hi', { tags: [['h', 'chan-2']] }));
    expect(conversation.messages).toHaveLength(0);
  });

  it('ignores kinds it does not display', () => {
    const conversation = createConversation('chan-1');
    ingestEvent(conversation, message('e1', 'x', { kind: BUZZ_KIND.presenceUpdate }));
    expect(conversation.messages).toHaveLength(0);
  });

  it('orders by time and caps the backlog', () => {
    const conversation = createConversation('chan-1');
    for (let index = 0; index < MAX_CONVERSATION_MESSAGES + 20; index += 1) {
      ingestEvent(conversation, message(`e${index}`, `m${index}`, { created_at: 1_700_000_000 + index }));
    }
    expect(conversation.messages).toHaveLength(MAX_CONVERSATION_MESSAGES);
    expect(conversation.messages[0]!.createdAt).toBeLessThan(conversation.messages.at(-1)!.createdAt);
  });

  it('records a thread reply pointer', () => {
    const conversation = createConversation('chan-1');
    ingestEvent(conversation, message('e2', 'reply', { tags: [['h', 'chan-1'], ['e', 'e1']] }));
    expect(conversation.messages[0]?.replyToId).toBe('e1');
  });
});

describe('emoji reactions', () => {
  it('attaches a reaction to its target rather than showing it as a message', () => {
    const conversation = createConversation('chan-1');
    ingestEvent(conversation, message('e1', 'ship it'));
    ingestEvent(conversation, reaction('e1', '\u{1F389}'));
    expect(conversation.messages).toHaveLength(1);
    expect(conversation.messages[0]?.reactions).toEqual([{ emoji: '\u{1F389}', count: 1, mine: false }]);
  });

  it('counts repeats of the same emoji from different people', () => {
    const conversation = createConversation('chan-1');
    ingestEvent(conversation, message('e1', 'ship it'));
    ingestEvent(conversation, reaction('e1', '\u{1F389}', ALICE));
    ingestEvent(conversation, reaction('e1', '\u{1F389}', BOB));
    expect(conversation.messages[0]?.reactions[0]).toMatchObject({ emoji: '\u{1F389}', count: 2 });
  });

  it('keeps skin-tone variants distinct — they are different reactions', () => {
    const conversation = createConversation('chan-1');
    ingestEvent(conversation, message('e1', 'ship it'));
    ingestEvent(conversation, reaction('e1', '\u{1F44D}'));
    ingestEvent(conversation, reaction('e1', '\u{1F44D}\u{1F3FD}', BOB));
    expect(conversation.messages[0]?.reactions.map(entry => entry.emoji))
      .toEqual(['\u{1F44D}', '\u{1F44D}\u{1F3FD}']);
  });

  it('maps NIP-25 + and - to thumbs, per the spec', () => {
    const conversation = createConversation('chan-1');
    ingestEvent(conversation, message('e1', 'ship it'));
    ingestEvent(conversation, reaction('e1', '+'));
    ingestEvent(conversation, reaction('e1', '-', BOB));
    expect(conversation.messages[0]?.reactions.map(entry => entry.emoji))
      .toEqual(['\u{1F44D}', '\u{1F44E}']);
  });

  it('marks my own reaction as mine', () => {
    const conversation = createConversation('chan-1');
    ingestEvent(conversation, message('e1', 'ship it'));
    ingestEvent(conversation, reaction('e1', '\u{1F389}', ME), ME);
    expect(conversation.messages[0]?.reactions[0]?.mine).toBe(true);
  });

  it('drops a reaction to a message it has not seen rather than inventing one', () => {
    const conversation = createConversation('chan-1');
    ingestEvent(conversation, reaction('missing', '\u{1F389}'));
    expect(conversation.messages).toHaveLength(0);
  });

  it('ignores a reaction with no target', () => {
    const conversation = createConversation('chan-1');
    ingestEvent(conversation, message('e1', 'x'));
    ingestEvent(conversation, { ...reaction('e1', '\u{1F389}'), tags: [] });
    expect(conversation.messages[0]?.reactions).toEqual([]);
  });
});

describe('validateOutboundMessage', () => {
  it('lets emoji through untouched — they are the message', () => {
    const body = 'shipping now \u{1F680} great work \u{1F469}‍\u{1F4BB}';
    const result = validateOutboundMessage(body);
    expect(result.ok).toBe(true);
    expect(result.text).toBe(body);
  });

  it('refuses an empty message', () => {
    expect(validateOutboundMessage('   ').ok).toBe(false);
    expect(validateOutboundMessage(undefined).ok).toBe(false);
  });

  it('refuses rather than silently redacting a secret', () => {
    // A quietly-redacted send is the worst outcome: you would believe you sent
    // one thing while your colleagues read another.
    const result = validateOutboundMessage('token is sk-abcdefghijklmnopqrstuvwxyz012345');
    expect(result.ok).toBe(false);
    expect(result.text).toBeUndefined();
    expect(result.reason).toMatch(/secret/i);
  });

  it('strips control characters without rejecting the message', () => {
    const result = validateOutboundMessage('hello \u0000\u001b there');
    expect(result.ok).toBe(true);
    expect(result.text).not.toMatch(CONTROL_CHARS);
  });

  it('counts length in code points, not UTF-16 units', () => {
    // Counting UTF-16 units would reject a message half the stated length as
    // soon as it contained emoji.
    expect(validateOutboundMessage('\u{1F600}'.repeat(MAX_OUTBOUND_LENGTH)).ok).toBe(true);
    expect(validateOutboundMessage('\u{1F600}'.repeat(MAX_OUTBOUND_LENGTH + 1)).ok).toBe(false);
  });
});

describe('recentMessages', () => {
  it('returns newest first, bounded', () => {
    const conversation = createConversation('chan-1');
    for (let index = 0; index < 30; index += 1) {
      ingestEvent(conversation, message(`e${index}`, `m${index}`, { created_at: 1_700_000_000 + index }));
    }
    const recent = recentMessages(conversation, 5);
    expect(recent).toHaveLength(5);
    expect(recent[0]!.text).toBe('m29');
  });
});

describe('isConversationMessage', () => {
  it('accepts both channel-message kinds a relay may serve', () => {
    expect(isConversationMessage(message('e1', 'x'))).toBe(true);
    expect(isConversationMessage(message('e1', 'x', { kind: BUZZ_KIND.channelMessageV2 }))).toBe(true);
    expect(isConversationMessage(message('e1', 'x', { kind: BUZZ_KIND.reaction }))).toBe(false);
  });
});
