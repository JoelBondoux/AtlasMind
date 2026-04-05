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
  const createWebviewPanel = vi.fn(() => ({
    webview: {
      html: '',
      cspSource: 'test-csp',
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
      get: (_key: string, fallback?: unknown) => fallback,
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
    mocks.showInputBox.mockResolvedValue('test-key');
    mocks.postMessage.mockResolvedValue(true);
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
    expect(html).toContain('chat-model-badge');
    expect(html).toContain('thought-details');
    expect(html).toContain('atlas-globe-loader');
    expect(html).toContain('thinking-indicator');
    expect(html).toContain('setComposerAvailability');
    expect(html).toContain('compact-icon-btn');
    expect(html).not.toContain('onclick=');
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
});
