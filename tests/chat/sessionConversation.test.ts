import { describe, it, expect } from 'vitest';
import { SessionConversation } from '../../src/chat/sessionConversation';

describe('SessionConversation', () => {
  it('should be able to add a turn', () => {
    const conversation = new SessionConversation();
    conversation.recordTurn('hello', 'world');
    expect(conversation.getTranscript()).toHaveLength(2);
  });

  // An empty answer used to drop the user's message along with it. That is the
  // wrong half to lose: the operator can see they typed it, so a transcript
  // that disagrees is the transcript being wrong.
  it('keeps the user message when the assistant returned nothing', () => {
    const conversation = new SessionConversation();
    conversation.recordTurn('what happened to my question?', '   ');

    const transcript = conversation.getTranscript();
    expect(transcript).toHaveLength(2);
    expect(transcript[0]?.content).toBe('what happened to my question?');
    expect(transcript[1]?.content).toContain('no reply for this turn');
    // A record for the reader, not context for the next prompt: `buildContext`
    // filters on weight > 0, so the placeholder is visible in the transcript and
    // absent from the next model call. The user's own message still travels.
    expect(transcript[1]?.relevanceWeight).toBe(0);
    const context = conversation.buildContext({ maxTurns: 6, maxChars: 2000 });
    expect(context).not.toContain('no reply for this turn');
    expect(context).toContain('what happened to my question?');
  });

  it('classifies an error turn from the caller rather than from the wording', () => {
    const conversation = new SessionConversation();
    // No error vocabulary in the text at all — the auto-detector would call this
    // an ordinary answer, which is exactly why the caller gets to say.
    conversation.recordTurn('run it', 'The provider stopped responding.', undefined, {
      modelUsed: 'atlasmind/error',
      turnError: { kind: 'failed', message: 'socket hang up' },
    }, { assistantClassification: 'error' });

    const assistant = conversation.getTranscript()[1];
    expect(assistant?.classification).toBe('error');
    expect(assistant?.meta?.turnError).toEqual({ kind: 'failed', message: 'socket hang up' });
  });

  it('increments a persisted revision for every context-bearing transcript mutation', () => {
    const conversation = new SessionConversation();
    expect(conversation.getRevision()).toBe(0);

    conversation.recordTurn('first question', 'first answer');
    expect(conversation.getRevision()).toBe(2);

    const [user, assistant] = conversation.getTranscript();
    conversation.updateMessage(user!.id, 'edited question');
    expect(conversation.getRevision()).toBe(3);

    conversation.deleteMessage(assistant!.id);
    expect(conversation.getRevision()).toBe(4);

    conversation.clearSession();
    expect(conversation.getRevision()).toBe(5);
  });

  it('does not advance the revision when a requested transcript mutation changes nothing', () => {
    const conversation = new SessionConversation();
    conversation.recordTurn('question', 'answer');
    const revision = conversation.getRevision();

    expect(conversation.deleteMessage('missing')).toBe(false);
    expect(conversation.truncateAfter('missing')).toBe(0);
    expect(conversation.getRevision()).toBe(revision);
  });

  it('restores legacy sessions without a revision at revision zero', () => {
    const stored = {
      activeSessionId: 'legacy-chat',
      sessions: [{
        id: 'legacy-chat',
        title: 'Legacy',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
        entries: [],
      }],
      folders: [],
    };
    const conversation = new SessionConversation({
      get: () => stored,
      update: () => Promise.resolve(),
    });

    expect(conversation.getRevision('legacy-chat')).toBe(0);
  });
});

/**
 * Everything below covers `buildContext`, which had no test at all — which is how
 * it came to return the *oldest* turns forever and emit them out of sequence.
 * These pin the properties, not the implementation.
 */
describe('buildContext', () => {
  const conversationOf = (turns: number): SessionConversation => {
    const conversation = new SessionConversation();
    for (let n = 1; n <= turns; n++) {
      conversation.recordTurn(`question ${n}`, `answer ${n}`);
    }
    return conversation;
  };

  it('carries the most recent turns, not the oldest', () => {
    // The defect: with every turn at weight 1, a weight-then-oldest sort put the
    // opening of the conversation at the front and the slice took from there, so
    // the turn the user had just had was never present.
    const context = conversationOf(20).buildContext({ maxTurns: 3, maxChars: 12_000 });
    expect(context).toContain('question 20');
    expect(context).toContain('answer 20');
    // Word-boundary matched: "question 1" is a substring of "question 18".
    expect(context).not.toMatch(/\bquestion 1\b/);
    expect(context).not.toMatch(/\bquestion 5\b/);
  });

  it('keeps moving as the conversation grows', () => {
    // Reproduced identically at turns 3, 4, 8 and 20 before the fix.
    const conversation = new SessionConversation();
    const seen: string[] = [];
    for (let n = 1; n <= 12; n++) {
      conversation.recordTurn(`question ${n}`, `answer ${n}`);
      seen.push(conversation.buildContext({ maxTurns: 2, maxChars: 12_000 }));
    }
    expect(seen[2]).not.toBe(seen[11]);
    expect(seen[11]).toContain('question 12');
  });

  it('renders oldest-first so the exchange reads in order', () => {
    const context = conversationOf(4).buildContext({ maxTurns: 4, maxChars: 12_000 });
    expect(context.indexOf('question 1')).toBeLessThan(context.indexOf('question 4'));
    expect(context.indexOf('question 1')).toBeLessThan(context.indexOf('answer 1'));
  });

  it('does not let a demoted reply jump out of sequence', () => {
    // An assistant reply mentioning "failed" is classified `error` (weight 0.2).
    // While weight decided order, that reply was emitted after later turns.
    const conversation = new SessionConversation();
    conversation.recordTurn('first question', 'the build failed with an exception');
    conversation.recordTurn('second question', 'all good now');
    const context = conversation.buildContext({ maxTurns: 6, maxChars: 12_000 });
    expect(context.indexOf('the build failed')).toBeLessThan(context.indexOf('second question'));
  });

  it('spends the character budget on the newest turns', () => {
    const conversation = new SessionConversation();
    for (let n = 1; n <= 10; n++) {
      conversation.recordTurn(`q${n} ${'x'.repeat(300)}`, `a${n} ${'y'.repeat(300)}`);
    }
    const context = conversation.buildContext({ maxTurns: 20, maxChars: 900 });
    expect(context).toContain('a10');
    expect(context).not.toContain('q1 ');
  });

  it('respects the character budget', () => {
    const conversation = conversationOf(30);
    expect(conversation.buildContext({ maxTurns: 20, maxChars: 400 }).length).toBeLessThanOrEqual(400);
  });

  it('returns something rather than nothing when one turn exceeds the whole budget', () => {
    const conversation = new SessionConversation();
    conversation.recordTurn('short', 'z'.repeat(5_000));
    const context = conversation.buildContext({ maxTurns: 6, maxChars: 400 });
    expect(context.length).toBeGreaterThan(0);
    expect(context.length).toBeLessThanOrEqual(400);
  });

  it('is empty for an empty session', () => {
    expect(new SessionConversation().buildContext()).toBe('');
  });
});

describe('turn classification', () => {
  const weightOf = (conversation: SessionConversation, content: string): number | undefined =>
    conversation.getTranscript().find(entry => entry.content === content)?.relevanceWeight;

  it('never erases a user turn on a substring match', () => {
    // `/irrelevant|nonsense|ignore this/` was not role-gated and set weight 0,
    // which removes an entry from every future context build permanently.
    // "Ignore this bit" is an ordinary thing to type.
    const conversation = new SessionConversation();
    conversation.recordTurn('ignore this bit of the diff, focus on the parser', 'understood');
    const weight = weightOf(conversation, 'ignore this bit of the diff, focus on the parser');
    expect(weight).toBeGreaterThan(0);
    expect(conversation.buildContext({ maxTurns: 6, maxChars: 12_000 })).toContain('focus on the parser');
  });

  it('keeps a debugging exchange visible', () => {
    const conversation = new SessionConversation();
    conversation.recordTurn('why is it broken?', 'a TypeError: not found, invalid state');
    expect(conversation.buildContext({ maxTurns: 6, maxChars: 12_000 })).toContain('TypeError');
  });

  it('still lets an explicit caller mark an entry irrelevant', () => {
    // The Memory tree does this deliberately; auto-detection must not.
    const conversation = new SessionConversation();
    conversation.appendMessage('user', 'scratch', undefined, undefined, {
      classification: 'irrelevant',
      relevanceWeight: 0,
    });
    expect(conversation.buildContext({ maxTurns: 6, maxChars: 12_000 })).not.toContain('scratch');
  });
});

describe('truncateAfter', () => {
  function seeded() {
    const conversation = new SessionConversation();
    conversation.recordTurn('first question', 'first answer');
    conversation.recordTurn('second question', 'second answer');
    conversation.recordTurn('third question', 'third answer');
    return conversation;
  }

  it('keeps the named entry and drops what follows', () => {
    const conversation = seeded();
    const target = conversation.getTranscript()[2]!; // "second question"

    expect(conversation.truncateAfter(target.id)).toBe(3);
    expect(conversation.getTranscript().map(entry => entry.content)).toEqual([
      'first question', 'first answer', 'second question',
    ]);
  });

  it('reports how many it removed, so a confirmation can name the cost', () => {
    const conversation = seeded();
    const last = conversation.getTranscript().at(-1)!;
    // Nothing after the final entry: no removal, and nothing to warn about.
    expect(conversation.truncateAfter(last.id)).toBe(0);
  });

  it('does nothing for an entry that is not there', () => {
    const conversation = seeded();
    expect(conversation.truncateAfter('missing')).toBe(0);
    expect(conversation.getTranscript()).toHaveLength(6);
  });
});
