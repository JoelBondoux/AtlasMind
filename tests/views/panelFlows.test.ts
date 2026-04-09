import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const mocks = vi.hoisted(() => {
  const state: {
    webviewMessageHandler: ((message: unknown) => void | Promise<void>) | undefined;
    projectRunsRefreshHandler: (() => void) | undefined;
    workspaceFolders: unknown;
    configurationState: Map<string, unknown>;
    configurationUpdates: Array<{ key: string; value: unknown; target: unknown }>;
  } = {
    webviewMessageHandler: undefined,
    projectRunsRefreshHandler: undefined,
    workspaceFolders: undefined,
    configurationState: new Map(),
    configurationUpdates: [],
  };

  const postMessage = vi.fn();
  const showInputBox = vi.fn();
  const showInformationMessage = vi.fn();
  const showWarningMessage = vi.fn();
  const executeCommand = vi.fn();
  const configurationGet = vi.fn((_key: string, fallback?: unknown) => fallback);
  const configurationInspect = vi.fn((_key: string) => undefined);
  const configurationUpdate = vi.fn(async (key: string, value: unknown, target?: unknown) => {
    state.configurationUpdates.push({ key, value, target });
    state.configurationState.set(key, value);
  });
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
    configurationInspect,
    configurationUpdate,
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
      inspect: mocks.configurationInspect,
      update: mocks.configurationUpdate,
    }),
    asRelativePath: (value: unknown) => String(value),
    findFiles: vi.fn().mockResolvedValue([]),
    fs: {
      stat: vi.fn(),
      readFile: vi.fn(),
      createDirectory: vi.fn(),
      writeFile: vi.fn(),
    },
    get workspaceFolders() {
      return mocks.state.workspaceFolders;
    },
    set workspaceFolders(value: unknown) {
      mocks.state.workspaceFolders = value;
    },
  },
  ViewColumn: { One: 1 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
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
  CancellationTokenSource: class {
    token = { isCancellationRequested: false };
    cancel(): void {
      this.token.isCancellationRequested = true;
    }
    dispose(): void {}
  },
}));

import { ModelProviderPanel, isProviderConfigured } from '../../src/views/modelProviderPanel.ts';
import { ProjectRunCenterPanel } from '../../src/views/projectRunCenterPanel.ts';
import { AgentManagerPanel } from '../../src/views/agentManagerPanel.ts';
import { ChatPanel } from '../../src/views/chatPanel.ts';
import { CostDashboardPanel } from '../../src/views/costDashboardPanel.ts';
import { ProjectDashboardPanel } from '../../src/views/projectDashboardPanel.ts';
import { ProjectIdeationPanel } from '../../src/views/projectIdeationPanel.ts';
import { SettingsPanel } from '../../src/views/settingsPanel.ts';

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
    mocks.state.workspaceFolders = undefined;
    mocks.state.configurationState.clear();
    mocks.state.configurationUpdates.length = 0;
    ModelProviderPanel.currentPanel = undefined;
    ProjectRunCenterPanel.currentPanel = undefined;
    AgentManagerPanel.currentPanel = undefined;
    ChatPanel.currentPanel = undefined;
    CostDashboardPanel.currentPanel = undefined;
    ProjectDashboardPanel.currentPanel = undefined;
    ProjectIdeationPanel.currentPanel = undefined;
    SettingsPanel.currentPanel = undefined;
    mocks.showInputBox.mockResolvedValue('test-key');
    mocks.postMessage.mockResolvedValue(true);
    mocks.configurationGet.mockImplementation((_key: string, fallback?: unknown) => fallback);
    mocks.configurationInspect.mockImplementation((_key: string) => undefined);
  });

  it('treats the local provider as configured when the workspace endpoint setting exists', async () => {
    mocks.configurationGet.mockImplementation((key: string, fallback?: unknown) => (
      key === 'localOpenAiBaseUrl' ? 'http://127.0.0.1:11434/v1' : fallback
    ));

    const configured = await isProviderConfigured({ secrets: { get: vi.fn() } } as never, 'local');

    expect(configured).toBe(true);
  });

  it('treats the local provider as configured when structured local endpoints exist', async () => {
    mocks.configurationGet.mockImplementation((key: string, fallback?: unknown) => (
      key === 'localOpenAiEndpoints'
        ? [{ id: 'ollama', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1' }]
        : fallback
    ));

    const configured = await isProviderConfigured({ secrets: { get: vi.fn() } } as never, 'local');

    expect(configured).toBe(true);
  });

  it('migrates a legacy local base URL into the structured endpoint list when settings opens', async () => {
    mocks.configurationInspect.mockImplementation((key: string) => {
      if (key === 'localOpenAiBaseUrl') {
        return { workspaceValue: 'http://127.0.0.1:11434/v1' };
      }
      return undefined;
    });

    SettingsPanel.createOrShow({
      extensionUri: { fsPath: '/ext', path: '/ext' },
      extension: { packageJSON: { version: '0.45.1' } },
    } as never);
    await flushMicrotasks();

    expect(mocks.configurationUpdate).toHaveBeenCalledWith(
      'localOpenAiEndpoints',
      [{ id: 'ollama', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1' }],
      2,
    );
  });

  it('does not remigrate the legacy local base URL when structured endpoints already exist', async () => {
    mocks.configurationInspect.mockImplementation((key: string) => {
      if (key === 'localOpenAiEndpoints') {
        return {
          workspaceValue: [{ id: 'ollama', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1' }],
        };
      }
      if (key === 'localOpenAiBaseUrl') {
        return { workspaceValue: 'http://127.0.0.1:11434/v1' };
      }
      return undefined;
    });

    SettingsPanel.createOrShow({
      extensionUri: { fsPath: '/ext', path: '/ext' },
      extension: { packageJSON: { version: '0.45.1' } },
    } as never);
    await flushMicrotasks();

    expect(mocks.configurationUpdate).not.toHaveBeenCalledWith(
      'localOpenAiEndpoints',
      expect.anything(),
      expect.anything(),
    );
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
        getWorkspacePolicySnapshots: vi.fn().mockReturnValue([]),
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
    expect(html).toContain('id="pendingApprovals"');
    expect(html).toContain('id="recoveryNotice"');
    expect(html).toContain('id="recoveryNoticeTitle"');
    expect(html).toContain('id="recoveryNoticeSummary"');
    expect(html).toContain('id="decreaseFontSize"');
    expect(html).toContain('id="increaseFontSize"');
    expect(html).toContain('compact-icon-btn');
    expect(html).toContain('composer-hint-title');
    expect(html).toContain('composer-hint-list');
    expect(html).toContain('chat-code-block');
    expect(html).toContain('chat-code-block-header');
    expect(html).toContain('assistant-meta-stack');
    expect(html).toContain('transcript-disclosure');
    expect(html).toMatch(/\.icon-btn\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*align-items:\s*center;[\s\S]*justify-content:\s*center;[\s\S]*line-height:\s*1;/);
    expect(html).toMatch(/\.icon-btn svg\s*\{[\s\S]*display:\s*block;[\s\S]*flex:\s*0 0 auto;/);
    expect(html).toMatch(/body\s*\{[\s\S]*padding:\s*0\s*!important;[\s\S]*overflow:\s*hidden;/);
    expect(html).toMatch(/\.chat-shell\s*\{[\s\S]*height:\s*100%;[\s\S]*min-height:\s*0;/);
    expect(html).toMatch(/\.chat-shell\s*\{[\s\S]*--atlas-chat-font-scale:\s*1;/);
    expect(html).toMatch(/\.chat-message\s*\{[\s\S]*font-size:\s*calc\(0\.95rem \* var\(--atlas-chat-font-scale\)\);/);
    expect(html).toMatch(/\.chat-role\s*\{[\s\S]*min-height:\s*22px;[\s\S]*font-size:\s*0\.68rem;[\s\S]*opacity:\s*0\.9;/);
    expect(html).toMatch(/\.chat-model-badge\s*\{[\s\S]*min-height:\s*22px;[\s\S]*font-size:\s*0\.68rem;[\s\S]*opacity:\s*0\.92;/);
    expect(html).toMatch(/\.chat-content\s*\{[\s\S]*line-height:\s*1\.62;/);
    expect(html).toMatch(/\.chat-content h1,\s*[\s\S]*font-weight:\s*600;/);
    expect(html).toMatch(/\.chat-content blockquote\s*\{[\s\S]*border-left:\s*2px solid[\s\S]*border-radius:\s*0 8px 8px 0;/);
    expect(html).toMatch(/\.thinking-logo \.atlas-axis\s*\{[\s\S]*transform-origin:\s*center;[\s\S]*transform-box:\s*view-box;/);
    expect(html).toMatch(/\.chat-content \.thinking-note\s*\{[\s\S]*font-size:\s*0\.9em;[\s\S]*font-style:\s*italic;/);
    expect(html).toMatch(/\.thought-summary\s*\{[\s\S]*font-size:\s*0\.84em;/);
    // Script is loaded from external file via <script src>
    expect(html).toContain('chatPanel.js');
    expect(html).toMatch(/<script\s+nonce="[^"]+"\s+src="[^"]*chatPanel\.js"><\/script>/);
    expect(html).not.toContain('onclick=');
  });

  it('passes a drafted dashboard prompt into the chat panel state', async () => {
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
      { draftPrompt: 'Start by tightening the project vision into a concrete done state.', sendMode: 'send' },
    );

    await (ChatPanel.currentPanel as unknown as { syncState(): Promise<void> }).syncState();

    expect(mocks.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'state',
      payload: expect.objectContaining({
        composerDraft: 'Start by tightening the project vision into a concrete done state.',
        composerMode: 'send',
      }),
    }));
  });

  it('includes pending tool approvals in chat panel state and resolves approval actions', async () => {
    const resolvePendingRequest = vi.fn().mockReturnValue(true);

    ChatPanel.createOrShow(
      {
        extensionUri: { fsPath: '/ext', path: '/ext' },
      } as never,
      {
        orchestrator: { processTask: vi.fn() },
        toolApprovalManager: {
          listPendingRequests: vi.fn().mockReturnValue([
            {
              id: 'approval-1',
              taskId: 'task-1',
              toolName: 'terminal-run',
              category: 'terminal-write',
              risk: 'high',
              summary: 'run npm install in the workspace',
              createdAt: '2026-04-07T00:00:00.000Z',
            },
          ]),
          resolvePendingRequest,
          onPendingApprovalsChange: vi.fn(() => () => undefined),
        },
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
        getWorkspacePolicySnapshots: vi.fn().mockReturnValue([]),
        voiceManager: { speak: vi.fn() },
      } as never,
    );

    await (ChatPanel.currentPanel as unknown as { syncState(): Promise<void> }).syncState();

    expect(mocks.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'state',
      payload: expect.objectContaining({
        pendingToolApprovals: expect.arrayContaining([
          expect.objectContaining({ id: 'approval-1', toolName: 'terminal-run', risk: 'high' }),
        ]),
      }),
    }));

    await (ChatPanel.currentPanel as unknown as { handleMessage(message: unknown): Promise<void> }).handleMessage({
      type: 'resolveToolApproval',
      payload: { requestId: 'approval-1', decision: 'autopilot' },
    });

    expect(resolvePendingRequest).toHaveBeenCalledWith('approval-1', 'autopilot');
    expect(mocks.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'status',
      payload: 'AtlasMind Autopilot enabled for this session.',
    }));
  });

  it('ships chat panel prompt history shortcuts in the webview script', () => {
    const scriptPath = path.resolve(process.cwd(), 'media', 'chatPanel.js');
    const script = readFileSync(scriptPath, 'utf8');

    expect(script).toContain("const PROMPT_HISTORY_LIMIT = 50;");
    expect(script).toContain("event.key === 'ArrowUp'");
    expect(script).toContain("event.key === 'ArrowDown'");
    expect(script).toContain("event.key === 'Enter' && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey");
    expect(script).toContain("submitPrompt('new-chat')");
    expect(script).toContain("event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.altKey");
    expect(script).toContain("submitPrompt('steer')");
    expect(script).toContain('function renderComposerHintContent(title, items)');
    expect(script).toContain('function buildContextAwareHintItems(state, kind)');
    expect(script).toContain('function setComposerHintContent(kind)');
    expect(script).toContain('function renderRecoveryNotice(notice)');
    expect(script).toContain('function renderTimelineNotes(notes)');
    expect(script).toContain('function parseMarkdownBlocks(markdown)');
    expect(script).toContain('function renderStructuredTextBlock(container, text)');
    expect(script).toContain('function createDisclosureSummary(title, preview, accessory)');
    expect(script).toContain('function truncateText(value, maxLength)');
    expect(script).toContain("blocks.push({ type: 'code'");
    expect(script).toContain("container.appendChild(renderHeading(trimmed))");
    expect(script).toContain("container.appendChild(renderList(listLines.join('\\n')))");
    expect(script).toContain("wrapper.className = 'chat-code-block'");
    expect(script).toContain("metaStack.className = 'assistant-meta-stack'");
    expect(script).toContain("utilityRow.className = 'assistant-utility-row'");
    expect(script).toContain('assistant-timeline-inline-label');
    expect(script).toContain('function navigatePromptHistory(direction)');
    expect(script).toContain('Composer shortcuts');
    expect(script).toContain('While AtlasMind is responding');
    expect(script).toContain('Run inspector');
    expect(script).toContain('AtlasMind already suggested next-step chips under the latest assistant reply.');
    expect(script).toContain('If the request is visual, attach a screenshot or the affected file so AtlasMind can respond with tighter UI-specific changes.');
    expect(script).toContain('If you want AtlasMind to run a shell command, the @t terminal aliases in the composer can launch it as a managed terminal action.');
    expect(script).toContain('Direct recovery mode is active for this turn, so AtlasMind should skip redundant clarification and move to the next concrete safe corrective action.');
    expect(script).toContain('Shift+Enter starts a new chat thread.');
    expect(script).toContain('Ctrl/Cmd+Enter sends as Steer.');
    expect(script).toContain('Alt+Enter inserts a newline.');
    expect(script).toContain('Up and Down recall recent prompts when the caret is already at the start or end of the composer.');
  });

  it('ingests pasted inline media into chat composer attachments', async () => {
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

    await flushMicrotasks();

    await (ChatPanel.currentPanel as unknown as { handleMessage(message: unknown): Promise<void> }).handleMessage({
      type: 'ingestPromptMedia',
      payload: {
        items: [
          { transport: 'inline-file', name: 'screenshot.png', mimeType: 'image/png', dataBase64: 'ZmFrZQ==' },
        ],
      },
    });

    expect(mocks.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'state',
      payload: expect.objectContaining({
        attachments: expect.arrayContaining([
          expect.objectContaining({ label: 'clipboard/screenshot.png', kind: 'image' }),
        ]),
      }),
    }));
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

  it('surfaces a direct recovery notice in chat panel state for frustrated actionable prompts', async () => {
    const appendMessage = vi.fn()
      .mockReturnValueOnce('user-1')
      .mockReturnValueOnce('assistant-1');
    const updateMessage = vi.fn();
    const workspaceStateStore = new Map<string, unknown>();
    mocks.state.workspaceFolders = [{ uri: { fsPath: '/workspace', path: '/workspace' } }];

    ChatPanel.createOrShow(
      {
        extensionUri: { fsPath: '/ext', path: '/ext' },
      } as never,
      {
        orchestrator: {
          processTask: vi.fn(async () => ({
            agentId: 'default',
            modelUsed: 'copilot/gpt-4.1',
            response: 'I am correcting course now.',
            costUsd: 0.01,
            inputTokens: 100,
            outputTokens: 25,
            durationMs: 10,
          })),
        },
        sessionConversation: {
          buildContext: vi.fn().mockReturnValue('We already identified the broken chat panel and the next safe step is to patch it.'),
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
        extensionContext: {
          workspaceState: {
            get: (key: string, fallback?: unknown) => workspaceStateStore.has(key) ? workspaceStateStore.get(key) : fallback,
            update: vi.fn(async (key: string, value: unknown) => {
              if (value === undefined) {
                workspaceStateStore.delete(key);
                return;
              }
              workspaceStateStore.set(key, value);
            }),
          },
        },
        memoryManager: { loadFromDisk: vi.fn(async () => undefined) },
        memoryRefresh: { fire: vi.fn() },
        getWorkspacePolicySnapshots: vi.fn().mockReturnValue([]),
      } as never,
    );

    await flushMicrotasks();

    await (ChatPanel.currentPanel as unknown as { handleMessage(message: unknown): Promise<void> }).handleMessage({
      type: 'submitPrompt',
      payload: { prompt: 'You are not doing what I ask. Can you do that for me?', mode: 'send' },
    });

    expect(mocks.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'state',
      payload: expect.objectContaining({
        recoveryNotice: expect.objectContaining({
          title: 'Direct recovery mode',
          summary: expect.stringContaining('Atlas detected operator frustration'),
          tone: 'active',
        }),
      }),
    }));
  });

  it('returns a live roadmap status summary instead of routing roadmap queries through the model', async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atlasmind-panel-roadmap-'));
    const roadmapRoot = path.join(tempRoot, 'project_memory', 'roadmap');
    mkdirSync(roadmapRoot, { recursive: true });
    writeFileSync(path.join(roadmapRoot, 'improvement-plan.md'), '- ✅ done milestone\n- pending milestone');
    writeFileSync(path.join(roadmapRoot, 'provider-followups.md'), '1. pending provider task');

    const appendMessage = vi.fn()
      .mockReturnValueOnce('user-1')
      .mockReturnValueOnce('assistant-1');
    const updateMessage = vi.fn();
    mocks.configurationGet.mockImplementation((_key: string, fallback?: unknown) => fallback);
    mocks.state.workspaceFolders = [{ uri: { fsPath: tempRoot, path: tempRoot } }];

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
      payload: { prompt: 'what are the outstanding roadmap items we need to address?', mode: 'send' },
    });

    expect(updateMessage).toHaveBeenCalledWith(
      'assistant-1',
      expect.stringContaining('Dashboard-aligned progress: **1/3** roadmap item(s) marked complete.'),
      'chat-1',
      expect.objectContaining({ modelUsed: 'atlasmind/roadmap-status' }),
    );

    mocks.state.workspaceFolders = undefined;
    rmSync(tempRoot, { recursive: true, force: true });
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
        getWorkspacePolicySnapshots: vi.fn().mockReturnValue([]),
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
      expect.stringContaining('The layout issue is in the transcript container.'),
      'chat-1',
    );
    expect(updateMessage).toHaveBeenCalledWith(
      'assistant-1',
      'The layout issue is in the transcript container.',
      'chat-1',
      expect.objectContaining({
        followupQuestion: 'Do you want me to fix this?',
        thoughtSummary: expect.objectContaining({
          label: 'Thinking summary',
          summary: 'Medium-reasoning code task routed to copilot/claude-sonnet-4.',
          bullets: expect.arrayContaining([
            'Selected agent: frontend-engineer.',
            'Tool loop used 2 call(s).',
          ]),
        }),
        suggestedFollowups: expect.arrayContaining([
          expect.objectContaining({ label: 'Fix This' }),
          expect.objectContaining({ label: 'Explain Only' }),
          expect.objectContaining({ label: 'Fix Autonomously' }),
        ]),
      }),
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
    expect(html).toContain('chart-style-controls');
    expect(html).toContain('Included usage visible');
    expect(html).toContain('MTD');
    expect(html).toContain('QTD');
    expect(html).toContain('YTD');
    expect(html).toContain('All Time');
    expect(html).toContain('Budgeted Spend');
    expect(html).toContain('Included Subscriptions');
    expect(html).toContain('Response Feedback by Model');
    expect(html).toContain('Feedback');
    expect(html).toContain('Approval Rate');
    expect(html).toContain('Message Cost');
    expect(html).toContain('data-sort-key="model"');
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
        title: 'Ship Feature',
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
    expect(html).toContain('What this panel does');
    expect(html).toContain('Discuss Draft');
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

  it('opens the chat panel with a draft-refinement prompt from the project run center', async () => {
    ProjectRunCenterPanel.createOrShow(
      {
        extensionUri: { fsPath: '/ext', path: '/ext' },
      } as never,
      {
        projectRunHistory: {
          listRunsAsync: vi.fn().mockResolvedValue([]),
          getRunAsync: vi.fn(),
          upsertRun: vi.fn(),
        },
        projectRunsRefresh: {
          event: vi.fn(() => ({ dispose: () => undefined })),
        },
        modelRouter: {},
        providerRegistry: {},
        orchestrator: {},
        rollbackLastCheckpoint: vi.fn(),
      } as never,
    );

    await (ProjectRunCenterPanel.currentPanel as unknown as { handleMessage(message: unknown): Promise<void> }).handleMessage({
      type: 'discussDraft',
      payload: {
        goal: 'Tighten the run scope before execution',
        planDraft: '{"subTasks":[]}',
      },
    });

    expect(mocks.executeCommand).toHaveBeenCalledWith(
      'atlasmind.openChatPanel',
      expect.objectContaining({
        sendMode: 'steer',
        draftPrompt: expect.stringContaining('Help me refine this AtlasMind Project Run draft before I execute it.'),
      }),
    );
  });

  it('queues a follow-up draft when a preview is split into staged planner jobs', async () => {
    const storedRuns: Array<Record<string, unknown>> = [];
    const listRunsAsync = vi.fn(async () => storedRuns.map(run => JSON.parse(JSON.stringify(run))));
    const getRunAsync = vi.fn(async (runId: string) => {
      const run = storedRuns.find(entry => entry.id === runId);
      return run ? JSON.parse(JSON.stringify(run)) : undefined;
    });
    const upsertRun = vi.fn(async (run: Record<string, unknown>) => {
      const clone = JSON.parse(JSON.stringify(run));
      const existingIndex = storedRuns.findIndex(entry => entry.id === run.id);
      if (existingIndex >= 0) {
        storedRuns.splice(existingIndex, 1, clone);
      } else {
        storedRuns.unshift(clone);
      }
    });
    const processProject = vi.fn(async (
      goal: string,
      _constraints: unknown,
      _onProgress: unknown,
      options?: { planOverride?: { id: string; subTasks: Array<{ id: string; title: string; dependsOn: string[] }> } },
    ) => {
      const plan = options?.planOverride;
      return {
        id: plan?.id ?? 'run-1',
        goal,
        synthesis: 'Completed first staged job.',
        totalCostUsd: 0,
        totalDurationMs: 1,
        subTaskResults: (plan?.subTasks ?? []).map(task => ({
          subTaskId: task.id,
          title: task.title,
          status: 'completed',
          output: `output-${task.id}`,
          costUsd: 0,
          durationMs: 1,
          role: 'general-assistant',
          dependsOn: [...task.dependsOn],
          artifacts: {
            output: `output-${task.id}`,
            outputPreview: `output-${task.id}`,
            toolCallCount: 0,
            toolCalls: [],
            checkpointedTools: [],
            changedFiles: [],
          },
        })),
      };
    });
    mocks.configurationGet.mockImplementation((key: string, fallback?: unknown) => {
      switch (key) {
        case 'projectApprovalFileThreshold':
          return 2;
        case 'projectEstimatedFilesPerSubtask':
          return 1;
        default:
          return fallback;
      }
    });

    ProjectRunCenterPanel.createOrShow(
      {
        extensionUri: { fsPath: '/ext', path: '/ext' },
      } as never,
      {
        projectRunHistory: {
          listRunsAsync,
          getRunAsync,
          upsertRun,
        },
        projectRunsRefresh: {
          event: vi.fn(() => ({ dispose: () => undefined })),
          fire: vi.fn(),
        },
        modelRouter: {
          selectModel: vi.fn(() => 'local/test-planner'),
          getModelInfo: vi.fn(() => ({ provider: 'local' })),
        },
        providerRegistry: {
          get: vi.fn(() => ({
            complete: vi.fn(async () => ({
              content: JSON.stringify({
                subTasks: [
                  { id: 'a', title: 'A', description: 'A', role: 'general-assistant', skills: [], dependsOn: [] },
                  { id: 'b', title: 'B', description: 'B', role: 'general-assistant', skills: [], dependsOn: ['a'] },
                  { id: 'c', title: 'C', description: 'C', role: 'general-assistant', skills: [], dependsOn: ['a'] },
                  { id: 'd', title: 'D', description: 'D', role: 'general-assistant', skills: [], dependsOn: ['b', 'c'] },
                  { id: 'e', title: 'E', description: 'E', role: 'general-assistant', skills: [], dependsOn: ['d'] },
                ],
              }),
            })),
          })),
        },
        orchestrator: {
          processProject,
        },
        rollbackLastCheckpoint: vi.fn(),
      } as never,
    );

    await (ProjectRunCenterPanel.currentPanel as unknown as { handleMessage(message: unknown): Promise<void> }).handleMessage({
      type: 'previewGoal',
      payload: 'Ship a large staged project',
    });
    await (ProjectRunCenterPanel.currentPanel as unknown as { handleMessage(message: unknown): Promise<void> }).handleMessage({
      type: 'executePreview',
    });
    await flushMicrotasks(6);

    const executedPlan = processProject.mock.calls[0]?.[3]?.planOverride;
    expect(executedPlan?.subTasks.map((task: { id: string }) => task.id)).toEqual(['a']);

    const followUpRun = storedRuns.find(run => run.status === 'previewed' && run.plannerJobIndex === 2) as {
      id?: string;
      plan?: { subTasks: Array<{ id: string; dependsOn?: string[] }> };
      plannerJobCount?: number;
      plannerSeedResults?: Array<{ subTaskId: string; output: string }>;
    } | undefined;
    expect(followUpRun).toBeDefined();
    expect(followUpRun?.plannerJobCount).toBe(3);
    expect(followUpRun?.plan?.subTasks.map(task => task.id)).toEqual(['b', 'c', 'd', 'e']);
    expect(followUpRun?.plannerSeedResults).toEqual([
      { subTaskId: 'a', title: 'A', output: 'output-a' },
    ]);

    await (ProjectRunCenterPanel.currentPanel as unknown as { handleMessage(message: unknown): Promise<void> }).handleMessage({
      type: 'selectRun',
      payload: followUpRun?.id,
    });
    await (ProjectRunCenterPanel.currentPanel as unknown as { handleMessage(message: unknown): Promise<void> }).handleMessage({
      type: 'executePreview',
    });
    await flushMicrotasks(6);

    const secondExecutedPlan = processProject.mock.calls[1]?.[3]?.planOverride;
    expect(secondExecutedPlan?.subTasks.map((task: { id: string }) => task.id)).toEqual(['b', 'c']);

    const nextFollowUpRun = storedRuns.find(run => run.status === 'previewed' && run.plannerJobIndex === 3) as {
      plan?: { subTasks: Array<{ id: string }> };
      plannerSeedResults?: Array<{ subTaskId: string; output: string }>;
    } | undefined;
    expect(nextFollowUpRun?.plan?.subTasks.map(task => task.id)).toEqual(['d', 'e']);
    expect(nextFollowUpRun?.plannerSeedResults).toEqual([
      { subTaskId: 'a', title: 'A', output: 'output-a' },
      { subTaskId: 'b', title: 'B', output: 'output-b' },
      { subTaskId: 'c', title: 'C', output: 'output-c' },
    ]);
  });

  it('deletes a saved run from the project run center after confirmation', async () => {
    const run = {
      id: 'run-1',
      title: 'Project Runs',
      goal: 'Clean up stale project runs',
      status: 'completed',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:05:00.000Z',
      estimatedFiles: 1,
      requiresApproval: false,
      planSubtaskCount: 1,
      completedSubtaskCount: 1,
      totalSubtaskCount: 1,
      currentBatch: 1,
      totalBatches: 1,
      failedSubtaskTitles: [],
      subTaskArtifacts: [],
      requireBatchApproval: false,
      paused: false,
      awaitingBatchApproval: false,
      logs: [],
      summary: {
        id: 'run-1',
        goal: 'Clean up stale project runs',
        startedAt: '2026-04-04T10:00:00.000Z',
        generatedAt: '2026-04-04T10:05:00.000Z',
        totalCostUsd: 0,
        totalDurationMs: 0,
        subTaskResults: [],
        changedFiles: [],
        fileAttribution: {},
        subTaskArtifacts: [],
      },
    };
    const listRunsAsync = vi.fn()
      .mockResolvedValueOnce([run])
      .mockResolvedValueOnce([]);
    const getRunAsync = vi.fn().mockResolvedValue(run);
    const deleteRunAsync = vi.fn().mockResolvedValue(true);
    const fire = vi.fn();
    mocks.showWarningMessage.mockResolvedValue('Delete Run');

    ProjectRunCenterPanel.createOrShow(
      {
        extensionUri: { fsPath: '/ext', path: '/ext' },
      } as never,
      {
        projectRunHistory: {
          listRunsAsync,
          getRunAsync,
          upsertRun: vi.fn(),
          deleteRunAsync,
        },
        projectRunsRefresh: {
          event: (handler: () => void) => {
            mocks.state.projectRunsRefreshHandler = handler;
            return { dispose: () => undefined };
          },
          fire,
        },
        modelRouter: {},
        providerRegistry: {},
        orchestrator: {},
        rollbackLastCheckpoint: vi.fn(),
      } as never,
      'run-1',
    );

    await (ProjectRunCenterPanel.currentPanel as unknown as { handleMessage(message: unknown): Promise<void> }).handleMessage({
      type: 'deleteRun',
      payload: 'run-1',
    });

    expect(mocks.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Delete project run'),
      { modal: true },
      'Delete Run',
    );
    expect(deleteRunAsync).toHaveBeenCalledWith('run-1');
    expect(fire).toHaveBeenCalled();

    const payload = mocks.postMessage.mock.calls.at(-1)?.[0]?.payload;
    expect(payload?.runs).toEqual([]);
    expect(payload?.selectedRun).toBeNull();
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

  it('renders the dedicated ideation panel with a CSP-safe external script shell', async () => {
    ProjectIdeationPanel.createOrShow(
      {
        extensionUri: { fsPath: '/ext', path: '/ext' },
      } as never,
      {
        memoryRefresh: { event: vi.fn(() => ({ dispose: () => undefined })) },
        projectRunsRefresh: { event: vi.fn(() => ({ dispose: () => undefined })) },
        sessionConversation: {
          buildContext: vi.fn().mockReturnValue(''),
          onDidChange: vi.fn(() => ({ dispose: () => undefined })),
          recordTurn: vi.fn(),
        },
        orchestrator: { processTask: vi.fn() },
        voiceManager: { speak: vi.fn() },
      } as never,
    );

    const html = mocks.createWebviewPanel.mock.results.at(-1)?.value.webview.html as string;
    expect(html).toContain('Project Ideation');
    expect(html).toContain('projectIdeation.js');
    expect(html).toContain('id="ideation-refresh"');
    expect(html).toContain('id="open-project-dashboard"');
    expect(html).toContain('id="open-run-center"');
    expect(html).toMatch(/<script\s+nonce="[^"]+"\s+src="[^"]*projectIdeation\.js"><\/script>/);
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
        score: expect.objectContaining({
          components: expect.any(Array),
          outcome: expect.objectContaining({
            score: expect.any(Number),
            desiredOutcome: expect.any(String),
            signals: expect.arrayContaining([
              expect.objectContaining({
                actionPrompt: expect.any(String),
              }),
            ]),
          }),
          recommendations: expect.arrayContaining([
            expect.objectContaining({
              actionPrompt: expect.any(String),
            }),
          ]),
        }),
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

  it('opens the dedicated ideation panel without routing through a dashboard deep-link', async () => {
    mocks.postMessage.mockClear();

    ProjectIdeationPanel.createOrShow(
      {
        extensionUri: { fsPath: '/ext', path: '/ext' },
      } as never,
      {
        projectRunsRefresh: { event: vi.fn(() => ({ dispose: () => undefined })) },
        memoryRefresh: { event: vi.fn(() => ({ dispose: () => undefined })) },
        sessionConversation: {
          buildContext: vi.fn().mockReturnValue(''),
          onDidChange: vi.fn(() => ({ dispose: () => undefined })),
          recordTurn: vi.fn(),
        },
        orchestrator: { processTask: vi.fn() },
        voiceManager: { speak: vi.fn() },
      } as never,
    );

    await (ProjectIdeationPanel.currentPanel as unknown as { syncState(): Promise<void> }).syncState();
    await flushMicrotasks();

    expect(mocks.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'state' }));
    expect(mocks.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'navigate' }));
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
              title: 'Auth Fix',
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
