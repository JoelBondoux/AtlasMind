import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const createChatParticipant = vi.fn((_id: string, _handler: unknown) => ({
    iconPath: undefined,
    followupProvider: undefined,
    dispose: vi.fn(),
  }));

  return {
    createChatParticipant,
  };
});

vi.mock('vscode', () => ({
  chat: {
    createChatParticipant: mocks.createChatParticipant,
  },
  Uri: {
    joinPath: (...segments: Array<{ path?: string; fsPath?: string } | string>) => ({
      path: segments.map(segment => typeof segment === 'string' ? segment : (segment.path ?? segment.fsPath ?? '')).join('/'),
      fsPath: segments.map(segment => typeof segment === 'string' ? segment : (segment.fsPath ?? segment.path ?? '')).join('/'),
    }),
  },
  workspace: {
    getConfiguration: () => ({
      get: (_key: string, fallback?: unknown) => fallback,
    }),
    findFiles: vi.fn().mockResolvedValue([]),
    fs: {
      readFile: vi.fn(),
      stat: vi.fn(),
    },
  },
}));

import {
  ATLASMIND_CHAT_PARTICIPANT_ID,
  buildNativeChatContextSummary,
  buildWorkstationContext,
  createAtlasMindChatRequestHandler,
  createAtlasMindFollowupProvider,
  registerChatParticipant,
} from '../../src/chat/participant.ts';

describe('native chat participant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers the canonical atlasmind participant with followups', () => {
    const subscriptions: Array<{ dispose: () => void }> = [];
    registerChatParticipant(
      {
        extensionUri: { path: '/ext', fsPath: '/ext' },
        subscriptions,
      } as never,
      {} as never,
    );

    expect(mocks.createChatParticipant).toHaveBeenCalledWith(
      ATLASMIND_CHAT_PARTICIPANT_ID,
      expect.any(Function),
    );

    const participant = mocks.createChatParticipant.mock.results[0]?.value;
    expect(participant.followupProvider).toBeDefined();
    expect(subscriptions).toContain(participant);
  });

  it('builds native chat context from references, model info, and history', () => {
    const summary = buildNativeChatContextSummary(
      {
        references: [
          {
            id: 'workspace-file',
            modelDescription: 'docs/architecture.md#overview',
            value: 'docs/architecture.md',
          },
        ],
        toolReferences: [],
        model: { id: 'copilot/gpt-4.1' },
      } as never,
      {
        history: [
          { prompt: 'Earlier question', command: undefined },
          { response: [{ value: 'Earlier answer' }] },
        ],
      } as never,
    );

    expect(summary).toContain('Attached chat references');
    expect(summary).toContain('docs/architecture.md#overview');
    expect(summary).toContain('VS Code chat model: copilot/gpt-4.1.');
    expect(summary).toContain('Native chat history');
    expect(summary).toContain('Earlier question');
  });

  it('builds workstation context with Windows PowerShell defaults', () => {
    const summary = buildWorkstationContext({ platform: 'win32' });

    expect(summary).toContain('Host OS: Windows.');
    expect(summary).toContain('Preferred terminal in VS Code: PowerShell.');
    expect(summary).toContain('default to PowerShell syntax');
  });

  it('streams orchestrator output through the native chat handler and forwards context', async () => {
    const processTask = vi.fn().mockImplementation(async (request, onTextChunk?: (chunk: string) => void) => {
      onTextChunk?.('Streaming reply');
      return {
        id: request.id,
        agentId: 'default-agent',
        modelUsed: 'copilot/gpt-4.1',
        response: 'Streaming reply',
        costUsd: 0,
        durationMs: 12,
      };
    });

    const atlas = {
      orchestrator: { processTask },
      sessionConversation: {
        buildContext: vi.fn().mockReturnValue('Stored AtlasMind session context'),
        recordTurn: vi.fn(),
        getTranscript: vi.fn().mockReturnValue([]),
      },
      voiceManager: { speak: vi.fn() },
    } as never;

    const handler = createAtlasMindChatRequestHandler(atlas);
    const stream = {
      markdown: vi.fn(),
      button: vi.fn(),
      progress: vi.fn(),
      reference: vi.fn(),
    };

    const result = await handler(
      {
        prompt: 'Summarize the attached design note',
        command: undefined,
        references: [{ id: 'design-note', modelDescription: 'project_memory/architecture/project-overview.md', value: 'project_memory/architecture/project-overview.md' }],
        toolReferences: [],
        model: { id: 'copilot/gpt-4.1' },
      } as never,
      {
        history: [
          { prompt: 'What changed recently?', command: undefined },
          { response: [{ value: 'A summary of the recent changes.' }] },
        ],
      } as never,
      stream as never,
      { isCancellationRequested: false } as never,
    );

    expect(processTask).toHaveBeenCalledTimes(1);
    expect(processTask).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: 'Summarize the attached design note',
        context: expect.objectContaining({
          sessionContext: expect.stringContaining('What changed recently?'),
          nativeChatContext: expect.stringContaining('project_memory/architecture/project-overview.md'),
          workstationContext: expect.stringContaining('Workstation context:'),
        }),
      }),
      expect.any(Function),
    );
    expect(stream.markdown).toHaveBeenCalledWith('Streaming reply');
    expect(result).toEqual(expect.objectContaining({ metadata: expect.objectContaining({ command: 'freeform' }) }));
  });

  it('exposes project followups through the official followup provider', () => {
    const provider = createAtlasMindFollowupProvider();
    const followups = provider.provideFollowups(
      { metadata: { command: 'project' } } as never,
      { history: [] } as never,
      {} as never,
    );

    expect(followups.map(item => item.label)).toEqual([
      'Review session cost',
      'Save plan to memory',
      'Run another project',
    ]);
  });
});