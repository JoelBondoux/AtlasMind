import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => ({
  EventEmitter: class<T> {
    readonly event = vi.fn();
    fire = vi.fn((_value?: T) => undefined);
  },
}));

import { deriveProjectRunTitle, SessionConversation } from '../../src/chat/sessionConversation.ts';

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

  it('derives a short subject title from the first user prompt', () => {
    const conversation = new SessionConversation({
      get: vi.fn().mockReturnValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    });

    const sessionId = conversation.getActiveSessionId();
    conversation.appendMessage('user', 'Please run a deep dive into the Claude Code CLI provider parsing flow.', sessionId);

    expect(conversation.listSessions()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: sessionId, title: 'Claude Code CLI' }),
    ]));
    expect(deriveProjectRunTitle('Clean up stale project runs across the dashboard views')).toBe('Project Runs');
  });

  it('renames sessions and files them into persistent folders', () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const conversation = new SessionConversation({
      get: vi.fn().mockReturnValue(undefined),
      update,
    });

    const sessionId = conversation.getActiveSessionId();
    const folderId = conversation.createFolder('Release Planning');

    expect(folderId).toBeTruthy();
    expect(conversation.renameSession(sessionId, 'Sprint Review')).toBe(true);
    expect(conversation.assignSessionToFolder(sessionId, folderId)).toBe(true);

    expect(conversation.listSessions()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: sessionId,
        title: 'Sprint Review',
        folderId,
      }),
    ]));
    expect(conversation.listFolders()).toEqual([
      expect.objectContaining({
        id: folderId,
        name: 'Release Planning',
        sessionCount: 1,
      }),
    ]);
    expect(update).toHaveBeenLastCalledWith('atlasmind.chatSessions', expect.objectContaining({
      folders: [expect.objectContaining({ name: 'Release Planning' })],
      sessions: [expect.objectContaining({ id: sessionId, folderId, title: 'Sprint Review' })],
    }));
  });

  it('restores folders from persisted state and drops stale folder references', () => {
    const conversation = new SessionConversation({
      get: vi.fn().mockReturnValue({
        activeSessionId: 'chat-1',
        folders: [{ id: 'folder-1', name: 'Research', createdAt: '2026-04-05T00:00:00.000Z', updatedAt: '2026-04-05T00:00:00.000Z' }],
        sessions: [{
          id: 'chat-1',
          title: 'Persisted Session',
          createdAt: '2026-04-05T00:00:00.000Z',
          updatedAt: '2026-04-05T00:00:00.000Z',
          folderId: 'missing-folder',
          entries: [],
        }],
      }),
      update: vi.fn().mockResolvedValue(undefined),
    });

    expect(conversation.listFolders()).toEqual([
      expect.objectContaining({ id: 'folder-1', name: 'Research', sessionCount: 0 }),
    ]);
    expect(conversation.listSessions()).toEqual([
      expect.objectContaining({ id: 'chat-1', title: 'Persisted Session' }),
    ]);
    expect(conversation.listSessions()[0]?.folderId).toBeUndefined();
  });

  it('archives sessions, excludes them from the active list, and restores them separately', () => {
    const conversation = new SessionConversation({
      get: vi.fn().mockReturnValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    });

    const originalSessionId = conversation.getActiveSessionId();
    conversation.appendMessage('user', 'Keep this thread', originalSessionId);

    expect(conversation.archiveSession(originalSessionId)).toBe(true);
    expect(conversation.listSessions().some(session => session.id === originalSessionId)).toBe(false);
    expect(conversation.listArchivedSessions()).toEqual([
      expect.objectContaining({ id: originalSessionId, isArchived: true }),
    ]);
    expect(conversation.getActiveSessionId()).not.toBe(originalSessionId);

    expect(conversation.unarchiveSession(originalSessionId)).toBe(true);
    expect(conversation.listArchivedSessions()).toEqual([]);
    expect(conversation.listSessions()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: originalSessionId, isArchived: false }),
    ]));
  });

  it('surfaces persisted follow-up policy in session context', () => {
    const conversation = new SessionConversation({
      get: vi.fn().mockReturnValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    });

    conversation.recordTurn(
      'Fix the auth redirect regression.',
      'I blocked the implementation until a failing test exists.',
      undefined,
      {
        policies: [
          {
            source: 'project-soul',
            label: 'Project soul',
            summary: 'Build a safe and reviewable coding agent.',
          },
          {
            source: 'safety',
            label: 'Tool approval policy',
            summary: 'Approval mode ask-on-write; terminal writes blocked; autopilot disabled.',
          },
        ],
      },
    );

    const context = conversation.buildContext();

    expect(context).toContain('Follow-up policy in force:');
    expect(context).toContain('[project-soul] Project soul: Build a safe and reviewable coding agent.');
    expect(context).toContain('[safety] Tool approval policy: Approval mode ask-on-write; terminal writes blocked; autopilot disabled.');
  });

  it('includes prompt attachment summaries in later follow-up context', () => {
    const conversation = new SessionConversation({
      get: vi.fn().mockReturnValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    });

    conversation.appendMessage('user', 'Please review the screenshot and tell me what is wrong.');
    conversation.appendMessage('assistant', 'I need the screenshot details to confirm the testing issue.');
    conversation.appendMessage('user', 'The screenshot is attached here for reference.', undefined, {
      promptAttachments: [
        {
          label: 'clipboard/screenshot.png',
          kind: 'image',
          source: 'clipboard/screenshot.png',
        },
      ],
    });

    const context = conversation.buildContext();

    expect(context).toContain('Attachments:');
    expect(context).toContain('- image: clipboard/screenshot.png');
  });

  it('persists learned-from-friction timeline notes on assistant transcript entries', () => {
    const conversation = new SessionConversation({
      get: vi.fn().mockReturnValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    });

    conversation.recordTurn(
      'You are not doing what I ask. Can you do that for me?',
      'I am correcting course now.',
      undefined,
      {
        timelineNotes: [
          {
            label: 'Learned from friction',
            summary: 'Atlas updated this workspace session with stronger direct-recovery guidance after the operator signaled frustration on this turn.',
            tone: 'warning',
          },
        ],
      },
    );

    expect(conversation.getTranscript()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        meta: expect.objectContaining({
          timelineNotes: [
            expect.objectContaining({
              label: 'Learned from friction',
              tone: 'warning',
            }),
          ],
        }),
      }),
    ]));
  });
});