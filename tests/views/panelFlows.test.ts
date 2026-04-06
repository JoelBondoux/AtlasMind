import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state: {
    webviewMessageHandler: ((message: unknown) => void | Promise<void>) | undefined;
    projectRunsRefreshHandler: (() => void) | undefined;
  } = {
    webviewMessageHandler: undefined,
    projectRunsRefreshHandler: undefined,
  };

  const postMessage = vi.fn();
  const showInputBox = vi.fn();
  const showInformationMessage = vi.fn();
  const showWarningMessage = vi.fn();
  const executeCommand = vi.fn();
  const configurationGet = vi.fn((_key: string, fallback?: unknown) => fallback);
  const createWebviewPanel = vi.fn(() => ({
    webview: {
      html: '',
      cspSource: 'test-csp',
      asWebviewUri: (uri: { fsPath?: string; path?: string }) => ({
        toString: () => uri.path ?? uri.fsPath ?? '',
        fsPath: uri.fsPath ?? uri.path ?? '',
        path: uri.path ?? uri.fsPath ?? '',
      }),
      onDidReceiveMessage: (handler: (message: unknown) => void | Promise<void>) => {
        state.webviewMessageHandler = handler;
        return { dispose: () => undefined };
      },
      postMessage,
    },
    onDidDispose: () => ({ dispose: () => undefined }),
    reveal: vi.fn(),
    dispose: vi.fn(),
  }));

  return {
    state,
    postMessage,
    showInputBox,
    showInformationMessage,
    showWarningMessage,
    executeCommand,
    configurationGet,
    createWebviewPanel,
  };
});

vi.mock('vscode', () => ({
  window: {
    activeTextEditor: undefined,
    visibleTextEditors: [],
    createWebviewPanel: mocks.createWebviewPanel,
    onDidChangeVisibleTextEditors: vi.fn(() => ({ dispose: () => undefined })),
    onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: () => undefined })),
    showInputBox: mocks.showInputBox,
    showInformationMessage: mocks.showInformationMessage,
    showWarningMessage: mocks.showWarningMessage,
  },
  commands: {
    executeCommand: mocks.executeCommand,
  },
  workspace: {
    getConfiguration: () => ({
      get: mocks.configurationGet,
    }),
    asRelativePath: (value: unknown) => String(value),
    findFiles: vi.fn().mockResolvedValue([]),
    fs: {
      stat: vi.fn(),
      readFile: vi.fn(),
      createDirectory: vi.fn(),
      writeFile: vi.fn(),
    },
    workspaceFolders: undefined,
  },
  ViewColumn: { One: 1 },
  Uri: {
    joinPath: (...segments: Array<{ fsPath?: string; path?: string } | string>) => ({
      fsPath: segments.map(segment => typeof segment === 'string' ? segment : (segment.fsPath ?? segment.path ?? '')).join('/'),
      path: segments.map(segment => typeof segment === 'string' ? segment : (segment.path ?? segment.fsPath ?? '')).join('/'),
    }),
    file: (filePath: string) => ({ fsPath: filePath, path: filePath }),
  },
  TreeItemCollapsibleState: { None: 0 },
  ThemeIcon: class {},
  MarkdownString: class {
    value: string;
    constructor(value: string) {
      this.value = value;
    }
  },
  EventEmitter: class<T> {
    event = (handler: (event: T) => void) => {
      mocks.state.projectRunsRefreshHandler = () => handler(undefined as T);
      return { dispose: () => undefined };
    };
    fire(): void {}
  },
}));

import { ModelProviderPanel } from '../../src/views/modelProviderPanel.ts';
import { ProjectRunCenterPanel } from '../../src/views/projectRunCenterPanel.ts';
import { AgentManagerPanel } from '../../src/views/agentManagerPanel.ts';
import { ChatPanel } from '../../src/views/chatPanel.ts';
import { CostDashboardPanel } from '../../src/views/costDashboardPanel.ts';
import { ProjectDashboardPanel } from '../../src/views/projectDashboardPanel.ts';

function createSessionConversationStub(transcript: Array<{ id?: string }> = []) {
  return {
    getTranscript: vi.fn().mockReturnValue(transcript),
    getModelFeedbackSummary: vi.fn().mockReturnValue({
      'copilot/default': { upVotes: 3, downVotes: 1 },
    }),
  };
}

async function flushMicrotasks(count = 3): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

describe('panel refresh flows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.webviewMessageHandler = undefined;
    mocks.state.projectRunsRefreshHandler = undefined;
    ModelProviderPanel.currentPanel = undefined;
    ProjectRunCenterPanel.currentPanel = undefined;
    AgentManagerPanel.currentPanel = undefined;
    ChatPanel.currentPanel = undefined;
    CostDashboardPanel.currentPanel = undefined;
    ProjectDashboardPanel.currentPanel = undefined;
    mocks.showInputBox.mockResolvedValue('test-key');
    mocks.postMessage.mockResolvedValue(true);
    mocks.configurationGet.mockImplementation((_key: string, fallback?: unknown) => fallback);
  });

  it('renders the dedicated chat panel with CSP-safe transcript controls', () => {
    ChatPanel.createOrShow(
      {
        extensionUri: { fsPath: '/ext', path: '/ext' },
      } as never,
      {
        orchestrator: { processTask: vi.fn() },
        sessionConversation: {
          buildContext: vi.fn().mockReturnValue(''),
          listSessions: vi.fn().mockReturnValue([{ id: 'chat-1', title: 'New Chat', createdAt: '2026-04-05T00:00:00.000Z', updatedAt: '2026-04-05T00:00:00.000Z', turnCount: 0, preview: 'No messages yet', isActive: true }]),
          getActiveSessionId: vi.fn().mockReturnValue('chat-1'),
          getSession: vi.fn().mockReturnValue({ id: 'chat-1', title: 'New Chat' }),
          selectSession: vi.fn().mockReturnValue(true),
          getTranscript: vi.fn().mockReturnValue([]),
          onDidChange: vi.fn(() => ({ dispose: () => undefined })),
        },
        projectRunsRefresh: { event: vi.fn(() => ({ dispose: () => undefined })) },
        projectRunHistory: { listRunsAsync: vi.fn().mockResolvedValue([]) },
        voiceManager: { speak: vi.fn() },
      } as never,
    );

    const html = mocks.createWebviewPanel.mock.results.at(-1)?.value.webview.html as string;
    expect(html).toContain('composer-shell');
    expect(html).toContain('id="sendPrompt"');
    expect(html).toContain('id="sendMode"');
    expect(html).toContain('id="attachFiles"');
    expect(html).toContain('id="attachOpenFiles"');
    expect(html).toContain('id="attachmentsSection"');
    expect(html).toContain('id="openFilesSection"');
    expect(html).toContain('id="attachmentList"');
    expect(html).toContain('id="openFileLinks"');
    expect(html).toContain('id="createSession"');
    expect(html).toContain('id="sessionList"');
    expect(html).toContain('id="runList"');
    expect(html).toContain('compact-icon-btn');
    // Script is loaded from external file via <script src>
    expect(html).toContain('chatPanel.js');
    expect(html).toMatch(/<script\s+nonce="[^"]+"\s+src="[^"]*chatPanel\.js"><\/script>/);
    expect(html).not.toContain('onclick=');
  });

  it('routes natural-language AtlasMind panel requests from the shared chat panel', async () => {
    const appendMessage = vi.fn()
      .mockReturnValueOnce('user-1')
      .mockReturnValueOnce('assistant-1');
    const updateMessage = vi.fn();

    ChatPanel.createOrShow(
      {
        extensionUri: { fsPath: '/ext', path: '/ext' },
      } as never,
      {
        orchestrator: { processTask: vi.fn() },
        sessionConversation: {
          buildContext: vi.fn().mockReturnValue(''),
          listSessions: vi.fn().mockReturnValue([{ id: 'chat-1', title: 'New Chat', createdAt: '2026-04-05T00:00:00.000Z', updatedAt: '2026-04-05T00:00:00.000Z', turnCount: 0, preview: 'No messages yet', isActive: true }]),
          getActiveSessionId: vi.fn().mockReturnValue('chat-1'),
          getSession: vi.fn().mockReturnValue({ id: 'chat-1', title: 'New Chat' }),
          selectSession: vi.fn().mockReturnValue(true),
          getTranscript: vi.fn().mockReturnValue([]),
          appendMessage,
          updateMessage,
          onDidChange: vi.fn(() => ({ dispose: () => undefined })),
        },
        projectRunsRefresh: { event: vi.fn(() => ({ dispose: () => undefined })) },
        projectRunHistory: { listRunsAsync: vi.fn().mockResolvedValue([]) },
        voiceManager: { speak: vi.fn() },
      } as never,
    );

    await flushMicrotasks();

    await (ChatPanel.currentPanel as unknown as { handleMessage(message: unknown): Promise<void> }).handleMessage({
      type: 'submitPrompt',
      payload: { prompt: 'Open AtlasMind Settings', mode: 'send' },
    });

    expect(mocks.executeCommand).toHaveBeenCalledWith('atlasmind.openSettings');
    expect(updateMessage).toHaveBeenCalledWith(
      'assistant-1',
      'Opened AtlasMind Settings.',
      'chat-1',
      expect.objectContaining({ modelUsed: 'command/atlasmind.openSettings' }),
    );
  });

  it('shows interim thinking updates while a chat-panel request is still running', async () => {
    const appendMessage = vi.fn()
      .mockReturnValueOnce('user-1')
      .mockReturnValueOnce('assistant-1');
    const updateMessage = vi.fn();

    ChatPanel.createOrShow(
      {
        extensionUri: { fsPath: '/ext', path: '/ext' },
      } as never,
      {
        orchestrator: {
          processTask: vi.fn(async (_request, onTextChunk?: (chunk: string) => void, onProgress?: (message: string) => void) => {
            await onProgress?.('Selected agent Frontend Engineer and prepared 12 available tool(s).');
            await onProgress?.('Tool round 1: requested 2 tool(s): file-search, file-read.');
            await onTextChunk?.('The layout issue is in the transcript container.');
            return {
              agentId: 'frontend-engineer',
              modelUsed: 'copilot/claude-sonnet-4',
              response: 'The layout issue is in the transcript container.',
              costUsd: 0.01,
              inputTokens: 100,
              outputTokens: 40,
              durationMs: 10,
              artifacts: {
                output: 'The layout issue is in the transcript container.',
                outputPreview: 'The layout issue is in the transcript container.',
                toolCallCount: 2,
                toolCalls: [],
                checkpointedTools: [],
              },
            };
          }),
        },
        sessionConversation: {
          buildContext: vi.fn().mockReturnValue(''),
          listSessions: vi.fn().mockReturnValue([{ id: 'chat-1', title: 'New Chat', createdAt: '2026-04-05T00:00:00.000Z', updatedAt: '2026-04-05T00:00:00.000Z', turnCount: 0, preview: 'No messages yet', isActive: true }]),
          getActiveSessionId: vi.fn().mockReturnValue('chat-1'),
          getSession: vi.fn().mockReturnValue({ id: 'chat-1', title: 'New Chat' }),
          selectSession: vi.fn().mockReturnValue(true),
          getTranscript: vi.fn().mockReturnValue([]),
          appendMessage,
          updateMessage,
          onDidChange: vi.fn(() => ({ dispose: () => undefined })),
        },
        projectRunsRefresh: { event: vi.fn(() => ({ dispose: () => undefined })) },
        projectRunHistory: { listRunsAsync: vi.fn().mockResolvedValue([]) },
        voiceManager: { speak: vi.fn() },
      } as never,
    );

    await flushMicrotasks();

    await (ChatPanel.currentPanel as unknown as { handleMessage(message: unknown): Promise<void> }).handleMessage({
      type: 'submitPrompt',
      payload: { prompt: 'The chat sidebar is currently too tall and hides the Sessions dropdown when scrolled down.', mode: 'send' },
    });

    expect(updateMessage).toHaveBeenCalledWith(
      'assistant-1',
      expect.stringContaining('_Thinking: Selected agent Frontend Engineer and prepared 12 available tool(s)._'),
      'chat-1',
    );
    expect(updateMessage).toHaveBeenCalledWith(
      'assistant-1',
      expect.stringContaining('The layout issue is in the transcript container.'),
      'chat-1',
    );
  });

  it('renders the agent manager with CSP-safe button bindings for agent actions', () => {
    AgentManagerPanel.createOrShow(
      {
        extensionUri: { fsPath: '/ext', path: '/ext' },
        globalState: { get: vi.fn().mockReturnValue([]), update: vi.fn() },
      } as never,
      {
        agentRegistry: {
          listAgents: vi.fn().mockReturnValue([
            {
              id: 'reviewer',
              name: 'Reviewer',
              role: 'code reviewer',
              description: 'Reviews code changes.',
              systemPrompt: 'Review code carefully.',
              skills: ['fileRead'],
              builtIn: false,
            },
          ]),
          isEnabled: vi.fn().mockReturnValue(true),
          getDisabledIds: vi.fn().mockReturnValue([]),
        },
        skillsRegistry: {
          listSkills: vi.fn().mockReturnValue([]),
        },
      } as never,
    );

    const html = mocks.createWebviewPanel.mock.results.at(-1)?.value.webview.html as string;
    expect(html).toContain('id="new-agent"');
    expect(html).toContain('data-action="select-agent"');
    expect(html).toContain('data-action="toggle-agent"');
    expect(html).toContain('data-action="delete-agent"');
    expect(html).not.toContain('onclick=');
  });

  it('renders the cost dashboard with timescale and subscription controls', () => {
    CostDashboardPanel.createOrShow(
      {
        extensionUri: { fsPath: '/ext', path: '/ext' },
      } as never,
      {
        getSummary: vi.fn().mockReturnValue({
          totalCostUsd: 1.2,
          totalBudgetCostUsd: 0.5,
          totalSubscriptionIncludedUsd: 0.7,
          totalRequests: 4,
          totalInputTokens: 1200,
          totalOutputTokens: 300,
        }),
        getRecords: vi.fn().mockReturnValue([
          {
            taskId: 't1',
            agentId: 'a1',
            model: 'copilot/default',
            providerId: 'copilot',
            billingCategory: 'subscription-included',
            inputTokens: 100,
            outputTokens: 20,
            costUsd: 0.7,
            budgetCostUsd: 0,
            timestamp: '2026-04-06T10:00:00.000Z',
          },
        ]),
        getDailyBudgetStatus: vi.fn().mockReturnValue({
          limitUsd: 5,
          todayCostUsd: 0.5,
          remainingUsd: 4.5,
          projectedTotalUsd: 0.5,
          blocked: false,
        }),
        reset: vi.fn(),
      } as never,
      createSessionConversationStub([{ id: 'msg-1' }]) as never,
    );

    const html = mocks.createWebviewPanel.mock.results.at(-1)?.value.webview.html as string;
    expect(html).toContain('cost-dashboard-timescale');
    expect(html).toContain('cost-dashboard-exclude-subscriptions');
    expect(html).toContain('chart-overlay-controls');
    expect(html).toContain('Included usage visible');
    expect(html).toContain('Budgeted Spend');
    expect(html).toContain('Included Subscriptions');
    expect(html).toContain('Response Feedback by Model');
    expect(html).toContain('Feedback');
    expect(html).toContain('Approval Rate');
    expect(html).toContain('Message Cost');
    expect(html).not.toContain('onclick=');
  });

  it('renders recent request costs as chat links only when the message still exists', () => {
    CostDashboardPanel.createOrShow(
      {
        extensionUri: { fsPath: '/ext', path: '/ext' },
      } as never,
      {
        getSummary: vi.fn().mockReturnValue({
          totalCostUsd: 1.2,
          totalBudgetCostUsd: 0.5,
          totalSubscriptionIncludedUsd: 0.7,
          totalRequests: 4,
          totalInputTokens: 1200,
          totalOutputTokens: 300,
        }),
        getRecords: vi.fn().mockReturnValue([
          {
            taskId: 't1',
            agentId: 'a1',
            model: 'copilot/default',
            providerId: 'copilot',
            billingCategory: 'subscription-included',
            sessionId: 'chat-1',
            messageId: 'msg-1',
            inputTokens: 100,
            outputTokens: 20,
            costUsd: 0.7,
            budgetCostUsd: 0,
            timestamp: '2026-04-06T10:00:00.000Z',
          },
          {
            taskId: 't2',
            agentId: 'a1',
            model: 'copilot/default',
            providerId: 'copilot',
            billingCategory: 'subscription-included',
            sessionId: 'chat-1',
            messageId: 'missing-msg',
            inputTokens: 100,
            outputTokens: 20,
            costUsd: 0.3,
            budgetCostUsd: 0,
            timestamp: '2026-04-06T10:05:00.000Z',
          },
        ]),
        getDailyBudgetStatus: vi.fn().mockReturnValue(undefined),
        reset: vi.fn(),
      } as never,
      createSessionConversationStub([{ id: 'msg-1' }]) as never,
    );

    const html = mocks.createWebviewPanel.mock.results.at(-1)?.value.webview.html as string;
    expect(html).toContain('data-cost-session-id="chat-1"');
    expect(html).toContain('data-cost-message-id="msg-1"');
    expect(html).not.toContain('data-cost-message-id="missing-msg"');
  });

  it('routes the cost dashboard settings action to the overview budget section', async () => {
    CostDashboardPanel.createOrShow(
      {
        extensionUri: { fsPath: '/ext', path: '/ext' },
      } as never,
      {
        getSummary: vi.fn().mockReturnValue({
          totalCostUsd: 1.2,
          totalBudgetCostUsd: 0.5,
          totalSubscriptionIncludedUsd: 0.7,
          totalRequests: 4,
          totalInputTokens: 1200,
          totalOutputTokens: 300,
        }),
        getRecords: vi.fn().mockReturnValue([]),
        getDailyBudgetStatus: vi.fn().mockReturnValue(undefined),
        reset: vi.fn(),
      } as never,
      createSessionConversationStub() as never,
    );

    await mocks.state.webviewMessageHandler?.({ type: 'openSettings' });

    expect(mocks.executeCommand).toHaveBeenCalledWith('atlasmind.openSettings', {
      page: 'overview',
      query: 'budget daily cost',
    });
  });

  it('routes recent request chat links to the targeted transcript message', async () => {
    CostDashboardPanel.createOrShow(
      {
        extensionUri: { fsPath: '/ext', path: '/ext' },
      } as never,
      {
        getSummary: vi.fn().mockReturnValue({
          totalCostUsd: 1.2,
          totalBudgetCostUsd: 0.5,
          totalSubscriptionIncludedUsd: 0.7,
          totalRequests: 4,
          totalInputTokens: 1200,
          totalOutputTokens: 300,
        }),
        getRecords: vi.fn().mockReturnValue([]),
        getDailyBudgetStatus: vi.fn().mockReturnValue(undefined),
        reset: vi.fn(),
      } as never,
      createSessionConversationStub([{ id: 'msg-1' }]) as never,
    );

    await mocks.state.webviewMessageHandler?.({ type: 'openChatMessage', sessionId: 'chat-1', messageId: 'msg-1' });

    expect(mocks.executeCommand).toHaveBeenCalledWith('atlasmind.openChatPanel', {
      sessionId: 'chat-1',
      messageId: 'msg-1',
    });
  });

  it('refreshes provider health after saving an API key', async () => {
    const listModels = vi.fn().mockResolvedValue(['model-a']);
    const refreshProviderHealth = vi.fn().mockResolvedValue(undefined);
    const secrets = {
      store: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValue('test-key'),
    };

    ModelProviderPanel.createOrShow(
      {
        extensionUri: { fsPath: '/ext', path: '/ext' },
        secrets,
      } as never,
      {
        providerRegistry: { get: vi.fn().mockReturnValue({ listModels }) },
        refreshProviderHealth,
        refreshProviderModels: vi.fn(),
        modelsRefresh: { fire: vi.fn() },
      } as never,
    );

    expect(ModelProviderPanel.currentPanel).toBeDefined();
    await (ModelProviderPanel.currentPanel as unknown as { handleMessage(message: unknown): Promise<void> }).handleMessage({
      type: 'saveApiKey',
      payload: 'openai',
    });

    expect(listModels).toHaveBeenCalledTimes(1);
    expect(refreshProviderHealth).toHaveBeenCalledTimes(1);
    expect(mocks.showInformationMessage).toHaveBeenCalled();
    const html = mocks.createWebviewPanel.mock.results.at(-1)?.value.webview.html as string;
    expect(html).toContain('OpenAI');
    expect(html).toContain('configured');
  });

  it('activates Copilot access only when the provider is explicitly configured', async () => {
    const refreshProviderModels = vi.fn().mockResolvedValue({ providersUpdated: 1, modelsAvailable: 3 });
    const refreshProviderHealth = vi.fn().mockResolvedValue(undefined);

    ModelProviderPanel.createOrShow(
      {
        extensionUri: { fsPath: '/ext', path: '/ext' },
        secrets: {
          store: vi.fn().mockResolvedValue(undefined),
          get: vi.fn().mockResolvedValue(undefined),
        },
      } as never,
      {
        providerRegistry: { get: vi.fn() },
        refreshProviderModels,
        refreshProviderHealth,
        modelsRefresh: { fire: vi.fn() },
      } as never,
    );

    await (ModelProviderPanel.currentPanel as unknown as { handleMessage(message: unknown): Promise<void> }).handleMessage({
      type: 'saveApiKey',
      payload: 'copilot',
    });

    expect(refreshProviderModels).toHaveBeenCalledWith(true);
    expect(refreshProviderHealth).toHaveBeenCalledTimes(1);
    expect(mocks.showInformationMessage).toHaveBeenCalled();
  });

  it('shows configured status for saved provider keys on initial render', async () => {
    ModelProviderPanel.createOrShow(
      {
        extensionUri: { fsPath: '/ext', path: '/ext' },
        secrets: {
          store: vi.fn().mockResolvedValue(undefined),
          get: vi.fn().mockImplementation(async (key: string) => key === 'atlasmind.provider.google.apiKey' ? 'saved-key' : undefined),
        },
      } as never,
      {
        providerRegistry: { get: vi.fn() },
        refreshProviderHealth: vi.fn().mockResolvedValue(undefined),
        refreshProviderModels: vi.fn(),
        modelsRefresh: { fire: vi.fn() },
      } as never,
    );

    await Promise.resolve();
    const currentPanel = ModelProviderPanel.currentPanel as unknown as { getHtml(): Promise<string> };
    const html = await currentPanel.getHtml();
    expect(html).toContain('Google (Gemini)');
    expect(html).toContain('configured');
  });

  it('shows failed-model badges for providers with routed model failures', async () => {
    ModelProviderPanel.createOrShow(
      {
        extensionUri: { fsPath: '/ext', path: '/ext' },
        secrets: {
          store: vi.fn().mockResolvedValue(undefined),
          get: vi.fn().mockImplementation(async (key: string) => key === 'atlasmind.provider.google.apiKey' ? 'saved-key' : undefined),
        },
      } as never,
      {
        providerRegistry: { get: vi.fn() },
        refreshProviderHealth: vi.fn().mockResolvedValue(undefined),
        refreshProviderModels: vi.fn(),
        modelsRefresh: { fire: vi.fn() },
        modelRouter: {
          getProviderFailureCount: (providerId: string) => providerId === 'google' ? 2 : 0,
        },
      } as never,
    );

    await flushMicrotasks();
    const currentPanel = ModelProviderPanel.currentPanel as unknown as { getHtml(): Promise<string> };
    const html = await currentPanel.getHtml();
    expect(html).toContain('1 with model failures');
    expect(html).toContain('2 failed models');
    expect(html).toContain('Google (Gemini)');
  });

  it('refreshes provider health after refreshing model metadata', async () => {
    const refreshProviderHealth = vi.fn().mockResolvedValue(undefined);
    const refreshProviderModels = vi.fn().mockResolvedValue({ providersUpdated: 2, modelsAvailable: 10 });

    ModelProviderPanel.createOrShow(
      {
        extensionUri: { fsPath: '/ext', path: '/ext' },
        secrets: { store: vi.fn().mockResolvedValue(undefined), get: vi.fn().mockResolvedValue(undefined) },
      } as never,
      {
        providerRegistry: { get: vi.fn() },
        refreshProviderHealth,
        refreshProviderModels,
        modelsRefresh: { fire: vi.fn() },
      } as never,
    );

    await flushMicrotasks();

    await (ModelProviderPanel.currentPanel as unknown as { handleMessage(message: unknown): Promise<void> }).handleMessage({
      type: 'refreshModels',
    });

    expect(refreshProviderModels).toHaveBeenCalledTimes(1);
    await flushMicrotasks();
    expect(mocks.showInformationMessage).toHaveBeenCalled();
  });

  it('hydrates the project run center from async run history reads', async () => {
    const listRunsAsync = vi.fn().mockResolvedValue([
      {
        id: 'run-1',
        goal: 'Ship feature',
        status: 'completed',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:05:00.000Z',
        estimatedFiles: 3,
        requiresApproval: false,
        planSubtaskCount: 2,
        completedSubtaskCount: 2,
        totalSubtaskCount: 2,
        currentBatch: 1,
        totalBatches: 1,
        failedSubtaskTitles: [],
        subTaskArtifacts: [],
        requireBatchApproval: false,
        paused: false,
        awaitingBatchApproval: false,
        logs: [],
      },
    ]);

    ProjectRunCenterPanel.createOrShow(
      {
        extensionUri: { fsPath: '/ext', path: '/ext' },
      } as never,
      {
        projectRunHistory: {
          listRunsAsync,
          getRunAsync: vi.fn(),
          upsertRun: vi.fn(),
        },
        projectRunsRefresh: {
          event: (handler: () => void) => {
            mocks.state.projectRunsRefreshHandler = handler;
            return { dispose: () => undefined };
          },
        },
        modelRouter: {},
        providerRegistry: {},
        orchestrator: {},
        rollbackLastCheckpoint: vi.fn(),
      } as never,
    );

    const html = mocks.createWebviewPanel.mock.results.at(-1)?.value.webview.html as string;
    expect(html).toContain('Review-first orchestration');
    expect(html).toContain('metricSelectedStatus');
    expect(html).toContain('status-banner');
    expect(html).toContain('goalInput');
    expect(html).toContain('artifactList');
    expect(html).not.toContain('onclick=');

    await (ProjectRunCenterPanel.currentPanel as unknown as { syncState(): Promise<void> }).syncState();

    expect(listRunsAsync).toHaveBeenCalledTimes(2);
    expect(mocks.postMessage).toHaveBeenCalled();

    await (ProjectRunCenterPanel.currentPanel as unknown as { handleMessage(message: unknown): Promise<void> }).handleMessage({
      type: 'refreshRuns',
    });
    expect(listRunsAsync).toHaveBeenCalledTimes(3);

    await mocks.state.projectRunsRefreshHandler?.();
    expect(listRunsAsync).toHaveBeenCalledTimes(4);

    const payload = mocks.postMessage.mock.calls.at(-1)?.[0]?.payload;
    expect(payload?.runs).toHaveLength(1);
    expect(payload?.runs[0]?.id).toBe('run-1');
  });

  it('renders the project dashboard with a CSP-safe external script shell', async () => {
    ProjectDashboardPanel.createOrShow(
      {
        extensionUri: { fsPath: '/ext', path: '/ext' },
      } as never,
      {
        agentsRefresh: { event: vi.fn(() => ({ dispose: () => undefined })) },
        skillsRefresh: { event: vi.fn(() => ({ dispose: () => undefined })) },
        modelsRefresh: { event: vi.fn(() => ({ dispose: () => undefined })) },
        projectRunsRefresh: { event: vi.fn(() => ({ dispose: () => undefined })) },
        memoryRefresh: { event: vi.fn(() => ({ dispose: () => undefined })) },
        toolApprovalManager: { isAutopilot: vi.fn().mockReturnValue(false), onAutopilotChange: vi.fn(() => () => undefined) },
        modelRouter: {
          listProviders: vi.fn().mockReturnValue([]),
          isProviderHealthy: vi.fn().mockReturnValue(true),
        },
        agentRegistry: {
          listAgents: vi.fn().mockReturnValue([]),
          isEnabled: vi.fn().mockReturnValue(true),
        },
        skillsRegistry: {
          listSkills: vi.fn().mockReturnValue([]),
          isEnabled: vi.fn().mockReturnValue(true),
        },
        sessionConversation: {
          listSessions: vi.fn().mockReturnValue([]),
          getActiveSessionId: vi.fn().mockReturnValue('chat-1'),
          onDidChange: vi.fn(() => ({ dispose: () => undefined })),
        },
        projectRunHistory: {
          listRunsAsync: vi.fn().mockResolvedValue([]),
        },
        costTracker: {
          getSummary: vi.fn().mockReturnValue({ totalCostUsd: 0, totalRequests: 0, totalInputTokens: 0, totalOutputTokens: 0 }),
          getRecords: vi.fn().mockReturnValue([]),
        },
        memoryManager: {
          listEntries: vi.fn().mockReturnValue([]),
          getScanResults: vi.fn().mockReturnValue(new Map()),
        },
      } as never,
    );

    await flushMicrotasks();

    const html = mocks.createWebviewPanel.mock.results.at(-1)?.value.webview.html as string;
    expect(html).toContain('id="dashboard-root"');
    expect(html).toContain('id="dashboard-refresh"');
    expect(html).toContain('Project Dashboard');
    expect(html).toContain('projectDashboard.js');
    expect(html).toMatch(/<script\s+nonce="[^"]+"\s+src="[^"]*projectDashboard\.js"><\/script>/);
    expect(html).not.toContain('onclick=');
  });

  it('posts dashboard state when autoVerifyScripts is stored as an array', async () => {
    mocks.configurationGet.mockImplementation((key: string, fallback?: unknown) => {
      if (key === 'autoVerifyScripts') {
        return ['test', 'lint'];
      }
      if (key === 'autoVerifyAfterWrite') {
        return true;
      }
      return fallback;
    });

    ProjectDashboardPanel.createOrShow(
      {
        extensionUri: { fsPath: '/ext', path: '/ext' },
      } as never,
      {
        agentsRefresh: { event: vi.fn(() => ({ dispose: () => undefined })) },
        skillsRefresh: { event: vi.fn(() => ({ dispose: () => undefined })) },
        modelsRefresh: { event: vi.fn(() => ({ dispose: () => undefined })) },
        projectRunsRefresh: { event: vi.fn(() => ({ dispose: () => undefined })) },
        memoryRefresh: { event: vi.fn(() => ({ dispose: () => undefined })) },
        toolApprovalManager: { isAutopilot: vi.fn().mockReturnValue(false), onAutopilotChange: vi.fn(() => () => undefined) },
        modelRouter: {
          listProviders: vi.fn().mockReturnValue([]),
          isProviderHealthy: vi.fn().mockReturnValue(true),
        },
        agentRegistry: {
          listAgents: vi.fn().mockReturnValue([]),
          isEnabled: vi.fn().mockReturnValue(true),
        },
        skillsRegistry: {
          listSkills: vi.fn().mockReturnValue([]),
          isEnabled: vi.fn().mockReturnValue(true),
        },
        sessionConversation: {
          listSessions: vi.fn().mockReturnValue([]),
          getActiveSessionId: vi.fn().mockReturnValue('chat-1'),
          onDidChange: vi.fn(() => ({ dispose: () => undefined })),
        },
        projectRunHistory: {
          listRunsAsync: vi.fn().mockResolvedValue([]),
        },
        costTracker: {
          getSummary: vi.fn().mockReturnValue({ totalCostUsd: 0, totalRequests: 0, totalInputTokens: 0, totalOutputTokens: 0 }),
          getRecords: vi.fn().mockReturnValue([]),
        },
        memoryManager: {
          listEntries: vi.fn().mockReturnValue([]),
          getScanResults: vi.fn().mockReturnValue(new Map()),
        },
      } as never,
    );

    await (ProjectDashboardPanel.currentPanel as unknown as { syncState(): Promise<void> }).syncState();

    expect(mocks.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'state',
      payload: expect.objectContaining({
        security: expect.objectContaining({
          autoVerifyScripts: 'test, lint',
        }),
        ideation: expect.objectContaining({
          boardPath: 'project_memory/ideas/atlas-ideation-board.json',
          summaryPath: 'project_memory/ideas/atlas-ideation-board.md',
          cards: expect.any(Array),
        }),
      }),
    }));
    expect(mocks.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('deep-links the dashboard to the ideation page when opened from the dedicated command path', async () => {
    mocks.postMessage.mockClear();

    ProjectDashboardPanel.createOrShow(
      {
        extensionUri: { fsPath: '/ext', path: '/ext' },
      } as never,
      {
        agentsRefresh: { event: vi.fn(() => ({ dispose: () => undefined })) },
        skillsRefresh: { event: vi.fn(() => ({ dispose: () => undefined })) },
        modelsRefresh: { event: vi.fn(() => ({ dispose: () => undefined })) },
        projectRunsRefresh: { event: vi.fn(() => ({ dispose: () => undefined })) },
        memoryRefresh: { event: vi.fn(() => ({ dispose: () => undefined })) },
        toolApprovalManager: { isAutopilot: vi.fn().mockReturnValue(false), onAutopilotChange: vi.fn(() => () => undefined) },
        modelRouter: {
          listProviders: vi.fn().mockReturnValue([]),
          isProviderHealthy: vi.fn().mockReturnValue(true),
        },
        agentRegistry: {
          listAgents: vi.fn().mockReturnValue([]),
          isEnabled: vi.fn().mockReturnValue(true),
        },
        skillsRegistry: {
          listSkills: vi.fn().mockReturnValue([]),
          isEnabled: vi.fn().mockReturnValue(true),
        },
        sessionConversation: {
          listSessions: vi.fn().mockReturnValue([]),
          getActiveSessionId: vi.fn().mockReturnValue('chat-1'),
          onDidChange: vi.fn(() => ({ dispose: () => undefined })),
        },
        projectRunHistory: {
          listRunsAsync: vi.fn().mockResolvedValue([]),
        },
        costTracker: {
          getSummary: vi.fn().mockReturnValue({ totalCostUsd: 0, totalRequests: 0, totalInputTokens: 0, totalOutputTokens: 0 }),
          getRecords: vi.fn().mockReturnValue([]),
        },
        memoryManager: {
          listEntries: vi.fn().mockReturnValue([]),
          getScanResults: vi.fn().mockReturnValue(new Map()),
        },
      } as never,
      'ideation',
    );

    await (ProjectDashboardPanel.currentPanel as unknown as { syncState(): Promise<void> }).syncState();
    await flushMicrotasks();

    expect(mocks.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'navigate',
      payload: 'ideation',
    }));
  });

  it('summarizes persisted TDD telemetry in the project dashboard runtime payload', async () => {
    ProjectDashboardPanel.createOrShow(
      {
        extensionUri: { fsPath: '/ext', path: '/ext' },
      } as never,
      {
        agentsRefresh: { event: vi.fn(() => ({ dispose: () => undefined })) },
        skillsRefresh: { event: vi.fn(() => ({ dispose: () => undefined })) },
        modelsRefresh: { event: vi.fn(() => ({ dispose: () => undefined })) },
        projectRunsRefresh: { event: vi.fn(() => ({ dispose: () => undefined })) },
        memoryRefresh: { event: vi.fn(() => ({ dispose: () => undefined })) },
        toolApprovalManager: { isAutopilot: vi.fn().mockReturnValue(false), onAutopilotChange: vi.fn(() => () => undefined) },
        modelRouter: {
          listProviders: vi.fn().mockReturnValue([]),
          isProviderHealthy: vi.fn().mockReturnValue(true),
        },
        agentRegistry: {
          listAgents: vi.fn().mockReturnValue([]),
          isEnabled: vi.fn().mockReturnValue(true),
        },
        skillsRegistry: {
          listSkills: vi.fn().mockReturnValue([]),
          isEnabled: vi.fn().mockReturnValue(true),
        },
        sessionConversation: {
          listSessions: vi.fn().mockReturnValue([]),
          getActiveSessionId: vi.fn().mockReturnValue('chat-1'),
          onDidChange: vi.fn(() => ({ dispose: () => undefined })),
        },
        projectRunHistory: {
          listRunsAsync: vi.fn().mockResolvedValue([
            {
              id: 'run-1',
              goal: 'Ship auth fix',
              status: 'completed',
              createdAt: '2026-04-06T09:00:00.000Z',
              updatedAt: '2026-04-06T09:05:00.000Z',
              estimatedFiles: 2,
              requiresApproval: false,
              planSubtaskCount: 2,
              completedSubtaskCount: 2,
              totalSubtaskCount: 2,
              currentBatch: 1,
              totalBatches: 1,
              failedSubtaskTitles: [],
              subTaskArtifacts: [
                { subTaskId: 'test', title: 'Add auth regression test', role: 'tester', dependsOn: [], status: 'completed', output: '', outputPreview: '', costUsd: 0, durationMs: 0, toolCallCount: 1, toolCalls: [], tddStatus: 'verified', checkpointedTools: [], changedFiles: [] },
                { subTaskId: 'fix', title: 'Fix auth redirect', role: 'backend-engineer', dependsOn: ['test'], status: 'completed', output: '', outputPreview: '', costUsd: 0, durationMs: 0, toolCallCount: 1, toolCalls: [], tddStatus: 'blocked', checkpointedTools: [], changedFiles: [] },
              ],
              requireBatchApproval: false,
              paused: false,
              awaitingBatchApproval: false,
              logs: [],
            },
          ]),
        },
        costTracker: {
          getSummary: vi.fn().mockReturnValue({ totalCostUsd: 0, totalRequests: 0, totalInputTokens: 0, totalOutputTokens: 0 }),
          getRecords: vi.fn().mockReturnValue([]),
        },
        memoryManager: {
          listEntries: vi.fn().mockReturnValue([]),
          getScanResults: vi.fn().mockReturnValue(new Map()),
        },
      } as never,
    );

    await (ProjectDashboardPanel.currentPanel as unknown as { syncState(): Promise<void> }).syncState();

    expect(mocks.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'state',
      payload: expect.objectContaining({
        runtime: expect.objectContaining({
          tdd: expect.objectContaining({
            summary: '1 blocked by TDD gate',
            verified: 1,
            blocked: 1,
            missing: 0,
          }),
          runs: expect.arrayContaining([
            expect.objectContaining({
              id: 'run-1',
              tddLabel: '1 blocked by TDD gate',
              tddTone: 'critical',
            }),
          ]),
        }),
      }),
    }));
  });
});
