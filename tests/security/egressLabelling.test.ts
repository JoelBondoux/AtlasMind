import { describe, expect, it } from 'vitest';

import type { ChatMessage, CompletionRequest, CompletionResponse } from '../../src/providers/adapter.js';
import type { EgressDestination } from '../../src/core/modelEgress.js';
import {
  ModelEgressRefused,
  dispatchGuardedCompletion,
  originsFromMessages,
} from '../../src/core/modelEgress.js';

/**
 * How context gets labelled on the way to a model.
 *
 * `modelEgress.test.ts` covers what the policy *does* with a label. This covers
 * how a label reaches it: carried on the message, read back positionally, and
 * absent rather than guessed when nobody set one.
 */

const SECRET = 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function recordingDestination(options?: { canStream?: boolean }): {
  destination: EgressDestination;
  sent: CompletionRequest[];
  streamed: CompletionRequest[];
} {
  const sent: CompletionRequest[] = [];
  const streamed: CompletionRequest[] = [];
  const answer: CompletionResponse = {
    content: 'ok',
    model: 'test-model',
    inputTokens: 1,
    outputTokens: 1,
    finishReason: 'stop',
  };

  const destination: EgressDestination = {
    providerId: 'anthropic',
    complete: async request => { sent.push(request); return answer; },
    ...(options?.canStream === false ? {} : {
      streamComplete: async (request: CompletionRequest, onTextChunk: (chunk: string) => void) => {
        streamed.push(request);
        onTextChunk('ok');
        return answer;
      },
    }),
  };

  return { destination, sent, streamed };
}

function request(messages: ChatMessage[]): CompletionRequest {
  return { model: 'test-model', messages };
}

describe('an origin travels with the message it describes', () => {
  it('reads back exactly what was set, positionally', () => {
    const messages: ChatMessage[] = [
      { role: 'system', origin: 'system-prompt', content: 'a' },
      { role: 'user', origin: 'session-context', content: 'b' },
      { role: 'user', origin: 'user-prompt', content: 'c' },
    ];

    expect(originsFromMessages(messages))
      .toEqual(['system-prompt', 'session-context', 'user-prompt']);
  });

  it('leaves an unlabelled message undefined rather than defaulting it', () => {
    // The whole point of failing closed: a message nobody labelled must not
    // acquire a benign-looking origin on the way past.
    const messages: ChatMessage[] = [
      { role: 'system', origin: 'system-prompt', content: 'a' },
      { role: 'user', content: 'b' },
    ];

    expect(originsFromMessages(messages)).toEqual(['system-prompt', undefined]);
  });

  /**
   * The reason the origin is a field on the message rather than a parallel
   * array. The agentic loop evicts from the middle of its history to stay
   * inside a context window; a second array would have to be spliced in step
   * by hand, and getting that wrong *mislabels* content rather than leaving it
   * unlabelled — the failure the boundary cannot detect.
   */
  it('survives an eviction from the middle of a conversation', () => {
    const history: ChatMessage[] = [
      { role: 'system', origin: 'system-prompt', content: 'sys' },
      { role: 'user', origin: 'session-context', content: 'old turn' },
      { role: 'tool', origin: 'tool-result', content: 'old tool output' },
      { role: 'user', origin: 'user-prompt', content: 'what I typed' },
    ];

    history.splice(1, 2);

    expect(originsFromMessages(history)).toEqual(['system-prompt', 'user-prompt']);
    expect(history.map(m => m.content)).toEqual(['sys', 'what I typed']);
  });
});

describe('role is not the label', () => {
  /**
   * Four messages, all `role: 'user'`, all treated differently. If origins were
   * inferred from `role` these would be one class, and the operator's own
   * prompt would be redacted while a tool result would be trusted.
   */
  it('gives four same-role parts four different treatments', async () => {
    const { destination, sent } = recordingDestination({ canStream: false });

    const messages: ChatMessage[] = [
      { role: 'user', origin: 'session-context', content: `earlier turn ${SECRET}` },
      { role: 'user', origin: 'attachment', content: `attached file ${SECRET}` },
      { role: 'user', origin: 'tool-result', content: `tool said ${SECRET}` },
      { role: 'user', origin: 'user-prompt', content: 'nothing sensitive here' },
    ];

    await dispatchGuardedCompletion({
      provider: destination,
      origins: originsFromMessages(messages),
      external: true,
      request: request(messages),
    });

    const delivered = sent[0]!.messages.map(m => m.content);
    // The three repository- and third-party-derived parts are redacted.
    expect(delivered[0]).not.toContain(SECRET);
    expect(delivered[1]).not.toContain(SECRET);
    expect(delivered[2]).not.toContain(SECRET);
    // The operator's own words are passed through byte-identical.
    expect(delivered[3]).toBe('nothing sensitive here');
  });

  /**
   * Two outcomes for one mistake, on purpose. Under the test runner an
   * unlabelled part is a hard error naming the call site, because it is a bug
   * somebody can fix before it ships. In a shipped extension the same part is
   * clamped to the most restrictive class, because failing a user's chat turn
   * over our own missing annotation is a worse outcome than over-redacting it.
   */
  const unlabelled: ChatMessage[] = [
    { role: 'system', origin: 'system-prompt', content: 'a' },
    { role: 'user', content: 'unlabelled' },
  ];

  it('stops the build when a message nobody labelled is dispatched', async () => {
    const { destination, sent } = recordingDestination({ canStream: false });

    await expect(dispatchGuardedCompletion({
      provider: destination,
      origins: originsFromMessages(unlabelled),
      external: true,
      strictOrigins: true,
      request: request(unlabelled),
    })).rejects.toThrow(/unknown context origin/i);

    expect(sent, 'A refused dispatch must not reach the destination at all.').toEqual([]);
  });

  it('degrades to the most restrictive class for a user rather than failing the turn', async () => {
    const { destination, sent } = recordingDestination({ canStream: false });

    const withSecret: ChatMessage[] = [
      unlabelled[0]!,
      { role: 'user', content: `unlabelled ${SECRET}` },
    ];

    await dispatchGuardedCompletion({
      provider: destination,
      origins: originsFromMessages(withSecret),
      external: true,
      strictOrigins: false,
      request: request(withSecret),
      // Unknown is treated as confirm-on-secret, so the turn needs an answer.
      confirmSecret: async () => 'send-redacted',
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.messages[1]!.content).not.toContain(SECRET);
  });

  it('is not strict merely because NODE_ENV is unset', async () => {
    // VS Code leaves NODE_ENV unset in the extension host. A default keyed on
    // `NODE_ENV !== 'production'` armed the developer tripwire for every real
    // user, which is the one place it must never fire. Asserted by driving the
    // default rather than reading it, so the expression cannot regress quietly.
    const previousVitest = process.env['VITEST'];
    const previousNodeEnv = process.env['NODE_ENV'];
    const previousOptIn = process.env['ATLASMIND_STRICT_EGRESS'];
    delete process.env['VITEST'];
    delete process.env['NODE_ENV'];
    delete process.env['ATLASMIND_STRICT_EGRESS'];

    try {
      const { destination, sent } = recordingDestination({ canStream: false });
      await dispatchGuardedCompletion({
        provider: destination,
        origins: originsFromMessages(unlabelled),
        external: true,
        request: request(unlabelled),
      });
      expect(sent).toHaveLength(1);
    } finally {
      if (previousVitest !== undefined) { process.env['VITEST'] = previousVitest; }
      if (previousNodeEnv !== undefined) { process.env['NODE_ENV'] = previousNodeEnv; }
      if (previousOptIn !== undefined) { process.env['ATLASMIND_STRICT_EGRESS'] = previousOptIn; }
    }
  });
});

describe('streaming goes through the boundary, not around it', () => {
  it('streams when the destination can and a chunk handler is given', async () => {
    const { destination, sent, streamed } = recordingDestination();
    const chunks: string[] = [];

    const messages: ChatMessage[] = [
      { role: 'system', origin: 'system-prompt', content: 'sys' },
      { role: 'user', origin: 'user-prompt', content: 'hello' },
    ];

    await dispatchGuardedCompletion({
      provider: destination,
      origins: originsFromMessages(messages),
      external: true,
      request: request(messages),
      onTextChunk: chunk => chunks.push(chunk),
    });

    expect(streamed).toHaveLength(1);
    expect(sent).toEqual([]);
    expect(chunks).toEqual(['ok']);
  });

  /**
   * The regression that matters: before the boundary could stream, a streaming
   * caller had to reach past it to the provider, and that was the commonest
   * unlabelled path in the codebase — the main chat turn.
   */
  it('clears the context before streaming it, not after', async () => {
    const { destination, streamed } = recordingDestination();

    const messages: ChatMessage[] = [
      { role: 'system', origin: 'system-prompt', content: 'sys' },
      { role: 'tool', origin: 'tool-result', content: `tool output ${SECRET}` },
    ];

    await dispatchGuardedCompletion({
      provider: destination,
      origins: originsFromMessages(messages),
      external: true,
      request: request(messages),
      onTextChunk: () => {},
    });

    expect(streamed[0]!.messages[1]!.content).not.toContain(SECRET);
  });

  it('falls back to a whole-response completion rather than refusing', async () => {
    // Streaming is a delivery detail. Failing the turn over it would push
    // callers back to the direct provider call this replaces.
    const { destination, sent, streamed } = recordingDestination({ canStream: false });

    const messages: ChatMessage[] = [
      { role: 'user', origin: 'user-prompt', content: 'hello' },
    ];

    const answer = await dispatchGuardedCompletion({
      provider: destination,
      origins: originsFromMessages(messages),
      external: true,
      request: request(messages),
      onTextChunk: () => {},
    });

    expect(answer.content).toBe('ok');
    expect(sent).toHaveLength(1);
    expect(streamed).toEqual([]);
  });
});

describe('a credential the operator typed is asked about, never rewritten silently', () => {
  const messages: ChatMessage[] = [
    { role: 'user', origin: 'user-prompt', content: `use this key: ${SECRET}` },
  ];

  it('refuses when there is nobody to ask', async () => {
    const { destination, sent } = recordingDestination({ canStream: false });

    await expect(dispatchGuardedCompletion({
      provider: destination,
      origins: originsFromMessages(messages),
      external: true,
      request: request(messages),
    })).rejects.toThrow(ModelEgressRefused);

    expect(sent).toEqual([]);
  });

  it.each([
    ['send-original' as const, true],
    ['send-redacted' as const, false],
  ])('honours %s', async (answer, expectSecretPresent) => {
    const { destination, sent } = recordingDestination({ canStream: false });

    await dispatchGuardedCompletion({
      provider: destination,
      origins: originsFromMessages(messages),
      external: true,
      request: request(messages),
      confirmSecret: async () => answer,
    });

    expect(sent[0]!.messages[0]!.content.includes(SECRET)).toBe(expectSecretPresent);
  });

  it('sends nothing when the answer is cancel', async () => {
    const { destination, sent } = recordingDestination({ canStream: false });

    await expect(dispatchGuardedCompletion({
      provider: destination,
      origins: originsFromMessages(messages),
      external: true,
      request: request(messages),
      confirmSecret: async () => 'cancel',
    })).rejects.toThrow(ModelEgressRefused);

    expect(sent).toEqual([]);
  });

  it('never asks about a destination on this machine', async () => {
    const { destination, sent } = recordingDestination({ canStream: false });
    let asked = false;

    await dispatchGuardedCompletion({
      provider: destination,
      origins: originsFromMessages(messages),
      external: false,
      request: request(messages),
      confirmSecret: async () => { asked = true; return 'send-redacted'; },
    });

    expect(asked, 'Nothing left the machine, so there is nothing to consent to.').toBe(false);
    expect(sent[0]!.messages[0]!.content).toContain(SECRET);
  });
});
