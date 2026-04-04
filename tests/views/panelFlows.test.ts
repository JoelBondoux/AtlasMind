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
    createWebviewPanel: mocks.createWebviewPanel,
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

import * as vscode from 'vscode';
import { ModelProviderPanel } from '../../src/views/modelProviderPanel.ts';
import { ProjectRunCenterPanel } from '../../src/views/projectRunCenterPanel.ts';

describe('panel refresh flows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.webviewMessageHandler = undefined;
    mocks.state.projectRunsRefreshHandler = undefined;
    ModelProviderPanel.currentPanel = undefined;
    ProjectRunCenterPanel.currentPanel = undefined;
    mocks.showInputBox.mockResolvedValue('test-key');
    mocks.postMessage.mockResolvedValue(true);
  });

  it('refreshes provider health after saving an API key', async () => {
    const listModels = vi.fn().mockResolvedValue(['model-a']);
    const refreshProviderHealth = vi.fn().mockResolvedValue(undefined);

    ModelProviderPanel.createOrShow(
      {
        extensionUri: { fsPath: '/ext', path: '/ext' },
        secrets: { store: vi.fn().mockResolvedValue(undefined) },
      } as never,
      {
        providerRegistry: { get: vi.fn().mockReturnValue({ listModels }) },
        refreshProviderHealth,
        refreshProviderModels: vi.fn(),
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
  });

  it('refreshes provider health after refreshing model metadata', async () => {
    const refreshProviderHealth = vi.fn().mockResolvedValue(undefined);
    const refreshProviderModels = vi.fn().mockResolvedValue({ providersUpdated: 2, modelsAvailable: 10 });

    ModelProviderPanel.createOrShow(
      {
        extensionUri: { fsPath: '/ext', path: '/ext' },
        secrets: { store: vi.fn().mockResolvedValue(undefined) },
      } as never,
      {
        providerRegistry: { get: vi.fn() },
        refreshProviderHealth,
        refreshProviderModels,
      } as never,
    );

    await (ModelProviderPanel.currentPanel as unknown as { handleMessage(message: unknown): Promise<void> }).handleMessage({
      type: 'refreshModels',
    });

    expect(refreshProviderModels).toHaveBeenCalledTimes(1);
    expect(refreshProviderHealth).toHaveBeenCalledTimes(1);
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
