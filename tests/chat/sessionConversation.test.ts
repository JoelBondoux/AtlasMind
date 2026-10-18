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

/**
 * Deleting a conversation leaves a *visible* one active.
 *
 * The reported symptom was "deleting all sessions leaves an old session's
 * history on screen and never goes blank". The cause was that the successor
 * was picked from `this.sessions`, which includes archived sessions, while the
 * picker lists only unarchived ones — so an archived session became active,
 * the list went empty, and the panel rendered the archived transcript.
 */
describe('deleteSession', () => {
  it('never promotes an archived session to active', () => {
    // The reported case: one visible conversation, one archived, delete the
    // visible one.
    const conversation = new SessionConversation();
    const visible = conversation.getActiveSessionId();
    conversation.recordTurn('current work', 'ok');

    const old = conversation.createSession('Old thread');
    conversation.recordTurn('something from last week', 'ok');
    conversation.archiveSession(old);
    conversation.selectSession(visible);

    conversation.deleteSession(visible);

    const active = conversation.getActiveSessionId();
    expect(active, 'the archived session was promoted to active').not.toBe(old);
    expect(conversation.getSession(active)?.archivedAt).toBeUndefined();
  });

  it('leaves the picker showing the session that is active', () => {
    // The staleness the user actually saw: an active session the list does not
    // contain, so the panel had a transcript and no way to reach it.
    const conversation = new SessionConversation();
    const visible = conversation.getActiveSessionId();
    const old = conversation.createSession('Old thread');
    conversation.archiveSession(old);
    conversation.selectSession(visible);

    conversation.deleteSession(visible);

    const listed = conversation.listSessions().map(session => session.id);
    expect(listed).toContain(conversation.getActiveSessionId());
  });

  it('starts a blank conversation when every survivor is archived', () => {
    const conversation = new SessionConversation();
    const visible = conversation.getActiveSessionId();
    const old = conversation.createSession('Old thread');
    conversation.recordTurn('last week', 'ok');
    conversation.archiveSession(old);
    conversation.selectSession(visible);
    conversation.recordTurn('this week', 'ok');

    conversation.deleteSession(visible);

    expect(conversation.getTranscript(), 'the new conversation is not blank').toHaveLength(0);
    expect(conversation.listSessions()).toHaveLength(1);
  });

  it('points at a session that exists', () => {
    // The old fallback built a record, took its id and threw the record away,
    // leaving `activeSessionId` naming nothing.
    const conversation = new SessionConversation();
    const first = conversation.getActiveSessionId();
    conversation.createSession('Second');
    conversation.selectSession(first);

    conversation.deleteSession(first);

    expect(conversation.getSession(conversation.getActiveSessionId())).toBeDefined();
  });

  it('prefers the most recently updated survivor', () => {
    // `archiveSession` has always sorted by `updatedAt`; delete took index 0 of
    // an insertion-ordered array. The two are the same question.
    const conversation = new SessionConversation();
    const doomed = conversation.getActiveSessionId();
    const older = conversation.createSession('Older');
    conversation.recordTurn('older work', 'ok');
    const newer = conversation.createSession('Newer');
    conversation.recordTurn('newer work', 'ok');
    conversation.selectSession(doomed);

    conversation.deleteSession(doomed);

    expect(conversation.getActiveSessionId()).toBe(newer);
    expect(conversation.getSession(older)).toBeDefined();
  });

  it('clears in place when it is the only session there is', () => {
    // Unchanged behaviour, and deliberately so: keeping the id and folder is
    // the right outcome for "empty my only conversation".
    const conversation = new SessionConversation();
    const only = conversation.getActiveSessionId();
    conversation.recordTurn('hello', 'world');

    conversation.deleteSession(only);

    expect(conversation.getActiveSessionId()).toBe(only);
    expect(conversation.getTranscript()).toHaveLength(0);
  });

  it('ignores a session that is not there', () => {
    const conversation = new SessionConversation();
    const active = conversation.getActiveSessionId();
    conversation.recordTurn('hello', 'world');

    conversation.deleteSession('does-not-exist');

    expect(conversation.getActiveSessionId()).toBe(active);
    expect(conversation.getTranscript()).toHaveLength(2);
  });
});

/**
 * What a conversation has read is kept beside its transcript, because the
 * transcript is what comes back after a reload — restoring the fetched page's
 * text while forgetting it was fetched would launder the taint.
 */
describe('SessionConversation provenance', () => {
  const FETCHED = {
    level: 'third-party' as const,
    injectionSuspected: false,
    sources: [{ origin: 'tool-result' as const, toolName: 'web-fetch', provenance: 'third-party' as const, rule: 'provenance.network-skill', injectionSuspected: false }],
    omittedSources: 0,
  };

  function memento() {
    let stored: unknown;
    return {
      get: () => stored,
      update: (_key: string, value: unknown) => { stored = JSON.parse(JSON.stringify(value)); return Promise.resolve(); },
      raw: () => stored as { activeSessionId: string; sessions: Array<Record<string, unknown>> },
      set: (value: unknown) => { stored = value; },
    };
  }

  it('starts a new conversation clean and only ever raises it', () => {
    const conversation = new SessionConversation();
    const sessionId = conversation.createSession();
    expect(conversation.getProvenance(sessionId).level).toBe('operator');

    conversation.recordProvenance(sessionId, FETCHED);
    conversation.recordProvenance(sessionId, { level: 'operator', injectionSuspected: false, sources: [], omittedSources: 0 });
    expect(conversation.getProvenance(sessionId).level).toBe('third-party');
    expect(conversation.getProvenance(sessionId).sources[0]?.toolName).toBe('web-fetch');
  });

  it('keeps conversations apart', () => {
    const conversation = new SessionConversation();
    const first = conversation.createSession();
    const second = conversation.createSession();
    conversation.recordProvenance(first, FETCHED);
    expect(conversation.getProvenance(second).level).toBe('operator');
  });

  it('survives a reload', () => {
    const state = memento();
    const before = new SessionConversation(state);
    const sessionId = before.createSession();
    before.recordTurn('read the page', 'it says hello', sessionId);
    before.recordProvenance(sessionId, FETCHED);

    const after = new SessionConversation(state);
    expect(after.getProvenance(sessionId).level).toBe('third-party');
  });

  it('reads a conversation saved before provenance was kept as third-party when it has history', () => {
    const state = memento();
    const seed = new SessionConversation(state);
    const withHistory = seed.createSession();
    seed.recordTurn('hello', 'hi', withHistory);
    const empty = seed.createSession();
    const raw = state.raw();
    for (const session of raw.sessions) { delete session['provenance']; }
    state.set(raw);

    const restored = new SessionConversation(state);
    expect(restored.getProvenance(withHistory)).toMatchObject({ level: 'third-party', sources: [{ rule: 'provenance.session-unrecorded' }] });
    expect(restored.getProvenance(empty).level).toBe('operator');
  });

  it('costs one conversation its clean state on a malformed record, never everyone their history', () => {
    const state = memento();
    const seed = new SessionConversation(state);
    const bad = seed.createSession();
    seed.recordTurn('hello', 'hi', bad);
    const good = seed.createSession();
    seed.recordTurn('another', 'reply', good);
    const raw = state.raw();
    const target = raw.sessions.find(session => session['id'] === bad)!;
    target['provenance'] = { level: 'trust me' };
    state.set(raw);

    const restored = new SessionConversation(state);
    expect(restored.getTranscript(good)).toHaveLength(2);
    expect(restored.getProvenance(bad)).toMatchObject({ level: 'third-party', sources: [{ rule: 'provenance.session-unreadable' }] });
    expect(restored.getProvenance(good).level).toBe('operator');
  });

  it('resets only when the conversation is cleared', () => {
    const conversation = new SessionConversation();
    const sessionId = conversation.createSession();
    conversation.recordTurn('one', 'two', sessionId);
    conversation.recordProvenance(sessionId, FETCHED);
    conversation.truncateAfter(conversation.getTranscript(sessionId)[0]!.id, sessionId);
    expect(conversation.getProvenance(sessionId).level).toBe('third-party');
    conversation.clearSession(sessionId);
    expect(conversation.getProvenance(sessionId).level).toBe('operator');
  });

  it('keeps the untrusted-content note on a turn through a reload', () => {
    const state = memento();
    const before = new SessionConversation(state);
    const sessionId = before.createSession();
    before.recordTurn('write it', 'done', sessionId, { modelUsed: 'local/echo-1', untrustedContentNote: 'This conversation includes third-party content.' });
    const after = new SessionConversation(state);
    expect(after.getTranscript(sessionId)[1]?.meta?.untrustedContentNote).toBe('This conversation includes third-party content.');
  });
});
