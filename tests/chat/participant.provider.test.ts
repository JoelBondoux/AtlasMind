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

  it('can omit native history from the native chat context summary', () => {
    const summary = buildNativeChatContextSummary(
      {
        references: [],
        toolReferences: [],
        model: { id: 'copilot/gpt-4.1' },
      } as never,
      {
        history: [
          { prompt: 'Earlier question', command: undefined },
          { response: [{ value: 'Earlier answer' }] },
        ],
      } as never,
      { includeHistory: false },
    );

    expect(summary).toContain('VS Code chat model: copilot/gpt-4.1.');
    expect(summary).not.toContain('Native chat history');
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
        inputTokens: 42,
        outputTokens: 21,
        costUsd: 0,
        durationMs: 12,
      };
    });

    const atlas = {
      orchestrator: { processTask },
      sessionConversation: {
        buildContext: vi.fn().mockReturnValue('Stored AtlasMind session context'),
        recordTurn: vi.fn(),
        getTranscript: vi.fn().mockReturnValue([
          {
            id: '1',
            role: 'user',
            content: 'What changed recently?',
            timestamp: '2026-04-08T04:00:00.000Z',
          },
        ]),
      },
      voiceManager: { speak: vi.fn() },
      getWorkspacePolicySnapshots: vi.fn().mockReturnValue([]),
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
        prompt: 'Based on the above, summarize the attached design note',
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
        userMessage: 'Based on the above, summarize the attached design note',
        context: expect.objectContaining({
          sessionContext: expect.stringContaining('What changed recently?'),
          nativeChatContext: expect.stringContaining('project_memory/architecture/project-overview.md'),
          workstationContext: expect.stringContaining('Workstation context:'),
        }),
      }),
      expect.any(Function),
      expect.any(Function),
    );
    expect(stream.markdown).toHaveBeenCalledWith('Streaming reply');
    expect(result).toEqual(expect.objectContaining({ metadata: expect.objectContaining({ command: 'freeform' }) }));
  });

  it('answers connected provider inventory prompts from live runtime state instead of routing to the orchestrator', async () => {
    const processTask = vi.fn();
    const recordTurn = vi.fn();
    const atlas = {
      orchestrator: { processTask },
      modelRouter: {
        listProviders: vi.fn().mockReturnValue([
          {
            id: 'openai',
            displayName: 'OpenAI',
            pricingModel: 'pay-per-token',
            enabled: true,
            models: [
              {
                id: 'openai/gpt-4o-mini',
                enabled: true,
                capabilities: ['chat', 'code', 'function_calling'],
              },
              {
                id: 'openai/gpt-4o',
                enabled: true,
                capabilities: ['chat', 'code', 'vision', 'function_calling', 'reasoning'],
              },
            ],
          },
          {
            id: 'anthropic',
            displayName: 'Anthropic',
            pricingModel: 'pay-per-token',
            enabled: true,
            models: [
              {
                id: 'anthropic/claude-sonnet-4',
                enabled: false,
                capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
              },
            ],
          },
        ]),
        isProviderHealthy: vi.fn((providerId: string) => providerId === 'openai'),
      },
      providerRegistry: {
        list: vi.fn().mockReturnValue([{ providerId: 'openai' }, { providerId: 'anthropic' }]),
      },
      isProviderConfigured: vi.fn(async (providerId: string) => providerId === 'openai' || providerId === 'anthropic'),
      sessionConversation: {
        recordTurn,
        getTranscript: vi.fn().mockReturnValue([]),
      },
    } as never;

    const handler = createAtlasMindChatRequestHandler(atlas);
    const stream = {
      markdown: vi.fn(),
      button: vi.fn(),
      progress: vi.fn(),
      reference: vi.fn(),
    };

    await handler(
      {
        prompt: 'Can you give me a review of all the currently connected providers and models Atlas is talking to?',
        command: undefined,
        references: [],
        toolReferences: [],
        model: { id: 'copilot/gpt-4.1' },
      } as never,
      { history: [] } as never,
      stream as never,
      { isCancellationRequested: false } as never,
    );

    expect(processTask).not.toHaveBeenCalled();
    expect(stream.markdown).toHaveBeenCalledWith(expect.stringContaining('### Connected Providers And Models'));
    expect(stream.markdown).toHaveBeenCalledWith(expect.stringContaining('**OpenAI**'));
    expect(stream.markdown).toHaveBeenCalledWith(expect.stringContaining('`openai/gpt-4o-mini`'));
    expect(stream.markdown).toHaveBeenCalledWith(expect.stringContaining('Configured But Not Currently Usable'));
    expect(stream.markdown).toHaveBeenCalledWith(expect.stringContaining('**Anthropic**'));
    expect(recordTurn).toHaveBeenCalledWith(
      'Can you give me a review of all the currently connected providers and models Atlas is talking to?',
      expect.stringContaining('### Connected Providers And Models'),
    );
  });
  it('drops stale session and history context when the prompt clearly changes subject', async () => {
    const processTask = vi.fn().mockResolvedValue({
      id: 'task-3',
      agentId: 'default-agent',
      modelUsed: 'copilot/gpt-4.1',
      response: 'Use the vision workflow for image generation.',
      inputTokens: 42,
      outputTokens: 21,
      costUsd: 0,
      durationMs: 12,
    });

    const atlas = {
      orchestrator: { processTask },
      sessionConversation: {
        buildContext: vi.fn().mockReturnValue('Stored AtlasMind session context'),
        recordTurn: vi.fn(),
        getTranscript: vi.fn().mockReturnValue([
          {
            id: '1',
            role: 'user',
            content: 'Investigate why the Dependabot dependency updates are not merging cleanly.',
            timestamp: '2026-04-08T04:00:00.000Z',
          },
        ]),
      },
      voiceManager: { speak: vi.fn() },
      getWorkspacePolicySnapshots: vi.fn().mockReturnValue([]),
    } as never;

    const handler = createAtlasMindChatRequestHandler(atlas);
    const stream = {
      markdown: vi.fn(),
      button: vi.fn(),
      progress: vi.fn(),
      reference: vi.fn(),
    };

    await handler(
      {
        prompt: 'Create an image for an alternative logo suggestion',
        command: undefined,
        references: [],
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

    expect(atlas.sessionConversation.buildContext).not.toHaveBeenCalled();
    expect(processTask).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          nativeChatContext: expect.not.stringContaining('Native chat history'),
          workstationContext: expect.stringContaining('Workstation context:'),
        }),
      }),
      expect.any(Function),
      expect.any(Function),
    );
    expect(processTask.mock.calls[0]?.[0]?.context?.sessionContext).toBeUndefined();
  });

  it('appends the final response when only an intermediate chunk streamed', async () => {
    const processTask = vi.fn().mockImplementation(async (_request, onTextChunk?: (chunk: string) => void) => {
      onTextChunk?.('I will inspect the code path.');
      return {
        id: 'task-1',
        agentId: 'default-agent',
        modelUsed: 'copilot/gpt-4.1',
        response: 'The response was getting dropped after the first streamed chunk.',
        inputTokens: 42,
        outputTokens: 21,
        costUsd: 0,
        durationMs: 12,
      };
    });

    const recordTurn = vi.fn();
    const atlas = {
      orchestrator: { processTask },
      sessionConversation: {
        buildContext: vi.fn().mockReturnValue('Stored AtlasMind session context'),
        recordTurn,
        getTranscript: vi.fn().mockReturnValue([]),
      },
      voiceManager: { speak: vi.fn() },
      getWorkspacePolicySnapshots: vi.fn().mockReturnValue([]),
    } as never;

    const handler = createAtlasMindChatRequestHandler(atlas);
    const stream = {
      markdown: vi.fn(),
      button: vi.fn(),
      progress: vi.fn(),
      reference: vi.fn(),
    };

    await handler(
      {
        prompt: 'Why did the previous run stop early?',
        command: undefined,
        references: [],
        toolReferences: [],
        model: { id: 'copilot/gpt-4.1' },
      } as never,
      { history: [] } as never,
      stream as never,
      { isCancellationRequested: false } as never,
    );

    expect(stream.markdown).toHaveBeenNthCalledWith(1, 'I will inspect the code path.');
    expect(stream.markdown).toHaveBeenNthCalledWith(2, '\n\nThe response was getting dropped after the first streamed chunk.');
    expect(recordTurn).toHaveBeenCalledWith(
      'Why did the previous run stop early?',
      'I will inspect the code path.\n\nThe response was getting dropped after the first streamed chunk.',
      undefined,
      expect.any(Object),
    );
  });

  it('does not duplicate a response that was already fully streamed', async () => {
    const processTask = vi.fn().mockImplementation(async (_request, onTextChunk?: (chunk: string) => void) => {
      onTextChunk?.('Streaming reply');
      return {
        id: 'task-2',
        agentId: 'default-agent',
        modelUsed: 'copilot/gpt-4.1',
        response: 'Streaming reply',
        inputTokens: 42,
        outputTokens: 21,
        costUsd: 0,
        durationMs: 12,
      };
    });

    const recordTurn = vi.fn();
    const atlas = {
      orchestrator: { processTask },
      sessionConversation: {
        buildContext: vi.fn().mockReturnValue('Stored AtlasMind session context'),
        recordTurn,
        getTranscript: vi.fn().mockReturnValue([]),
      },
      voiceManager: { speak: vi.fn() },
      getWorkspacePolicySnapshots: vi.fn().mockReturnValue([]),
    } as never;

    const handler = createAtlasMindChatRequestHandler(atlas);
    const stream = {
      markdown: vi.fn(),
      button: vi.fn(),
      progress: vi.fn(),
      reference: vi.fn(),
    };

    await handler(
      {
        prompt: 'Repeat the short answer',
        command: undefined,
        references: [],
        toolReferences: [],
        model: { id: 'copilot/gpt-4.1' },
      } as never,
      { history: [] } as never,
      stream as never,
      { isCancellationRequested: false } as never,
    );

    expect(stream.markdown).toHaveBeenCalledTimes(1);
    expect(recordTurn).toHaveBeenCalledWith(
      'Repeat the short answer',
      'Streaming reply',
      undefined,
      expect.any(Object),
    );
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

  it('prefers assistant-suggested followups for ambiguous freeform replies', () => {
    const provider = createAtlasMindFollowupProvider();
    const followups = provider.provideFollowups(
      {
        metadata: {
          command: 'freeform',
          suggestedFollowups: [
            { label: 'Fix This', prompt: 'Fix this issue in the workspace.' },
            { label: 'Fix Autonomously', prompt: 'Fix this issue autonomously.' },
          ],
        },
      } as never,
      { history: [] } as never,
      {} as never,
    );

    expect(followups.map(item => item.label)).toEqual(['Fix This', 'Fix Autonomously']);
  });
});