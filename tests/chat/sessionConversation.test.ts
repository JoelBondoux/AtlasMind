import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => ({
  EventEmitter: class<T> {
    readonly event = vi.fn();
    fire = vi.fn((_value?: T) => undefined);
  },
}));

import { SessionConversation } from '../../src/chat/sessionConversation.ts';

describe('SessionConversation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to the active session when an unknown session id is used', () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const conversation = new SessionConversation({
      get: vi.fn().mockReturnValue(undefined),
      update,
    });

    const activeSessionId = conversation.getActiveSessionId();
    conversation.appendMessage('assistant', 'Recovered response', 'missing-session-id');

    expect(conversation.getTranscript(activeSessionId)).toEqual([
      expect.objectContaining({ role: 'assistant', content: 'Recovered response' }),
    ]);
    expect(warn).toHaveBeenCalledWith('[AtlasMind] Chat session "missing-session-id" was not found. Falling back to the active session.');
  });

  it('warns and skips transcript writes when the assistant response is empty', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const conversation = new SessionConversation({
      get: vi.fn().mockReturnValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    });

    conversation.recordTurn('Investigate the failure', '   ');

    expect(conversation.getTranscript()).toEqual([]);
    expect(warn).toHaveBeenCalledWith('[AtlasMind] Skipping transcript write because the assistant response was empty.');
  });

  it('logs persistence failures instead of dropping them silently', async () => {
    const error = new Error('memento write failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const conversation = new SessionConversation({
      get: vi.fn().mockReturnValue(undefined),
      update: vi.fn().mockRejectedValue(error),
    });

    conversation.appendMessage('assistant', 'Persist me');
    await Promise.resolve();
    await Promise.resolve();

    expect(consoleError).toHaveBeenCalledWith('[AtlasMind] Failed to persist chat sessions.', error);
  });

  it('tracks assistant votes and summarizes them per model', () => {
    const conversation = new SessionConversation({
      get: vi.fn().mockReturnValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    });

    const assistantId = conversation.appendMessage('assistant', 'Primary answer', undefined, { modelUsed: 'openai/gpt-4o-mini' });
    conversation.appendMessage('assistant', 'Secondary answer', undefined, { modelUsed: 'openai/gpt-4o-mini' });
    const otherAssistantId = conversation.appendMessage('assistant', 'Different model', undefined, { modelUsed: 'copilot/gpt-4o' });

    expect(conversation.setAssistantVote(assistantId, 'up')).toBe(true);
    expect(conversation.setAssistantVote(otherAssistantId, 'down')).toBe(true);

    expect(conversation.getTranscript()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: assistantId,
        meta: expect.objectContaining({ userVote: 'up' }),
      }),
      expect.objectContaining({
        id: otherAssistantId,
        meta: expect.objectContaining({ userVote: 'down' }),
      }),
    ]));

    expect(conversation.getModelFeedbackSummary()).toEqual({
      'openai/gpt-4o-mini': { upVotes: 1, downVotes: 0 },
      'copilot/gpt-4o': { upVotes: 0, downVotes: 1 },
    });

    expect(conversation.setAssistantVote(assistantId, undefined)).toBe(true);
    expect(conversation.getModelFeedbackSummary()).toEqual({
      'copilot/gpt-4o': { upVotes: 0, downVotes: 1 },
    });
  });
});