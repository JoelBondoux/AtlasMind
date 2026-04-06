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
});