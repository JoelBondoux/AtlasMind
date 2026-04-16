import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

const mocks = vi.hoisted(() => ({
  getProjectMemoryFreshness: vi.fn(async () => ({
    hasImportedEntries: false,
    isStale: false,
    staleEntryCount: 0,
    staleEntries: [],
  })),
}));

vi.mock('../../src/bootstrap/bootstrapper.js', async () => {
  const actual = await vi.importActual('../../src/bootstrap/bootstrapper.ts');
  return {
    ...actual,
    getProjectMemoryFreshness: mocks.getProjectMemoryFreshness,
  };
});

import { registerTreeViews } from '../../src/views/treeViews.ts';

vi.mock('vscode');

beforeEach(() => {
  mocks.getProjectMemoryFreshness.mockResolvedValue({
    hasImportedEntries: false,
    isStale: false,
    staleEntryCount: 0,
    staleEntries: [],
  });
  (vscode.workspace as { workspaceFolders?: Array<{ uri: unknown }> }).workspaceFolders = undefined;
});

describe('MemoryTreeProvider', () => {
  it('registers a dedicated quick-links webview at the top of the AtlasMind sidebar', () => {
    const registerWebviewViewProvider = vi.spyOn(vscode.window, 'registerWebviewViewProvider');
    const registerTreeDataProvider = vi.spyOn(vscode.window, 'registerTreeDataProvider');
    const registrationOrder: string[] = [];

    registerWebviewViewProvider.mockImplementation(((viewId: string) => {
      registrationOrder.push(viewId);
      return { dispose: () => undefined };
    }) as typeof vscode.window.registerWebviewViewProvider);
    registerTreeDataProvider.mockImplementation(((viewId: string) => {
      registrationOrder.push(viewId);
      return { dispose: () => undefined };
    }) as typeof vscode.window.registerTreeDataProvider);

    const atlas = {
      agentsRefresh: { event: vi.fn() },
      skillsRefresh: { event: vi.fn() },
      sessionConversation: {
        onDidChange: vi.fn(() => ({ dispose: () => undefined })),
        listSessions: () => [],
      },
      modelsRefresh: { event: vi.fn() },
      projectRunsRefresh: { event: vi.fn() },
      memoryRefresh: { event: vi.fn() },
      isProviderConfigured: vi.fn(),
      agentRegistry: { listAgents: () => [] },
      skillsRegistry: { listSkills: () => [] },
      mcpServerRegistry: { listServers: () => [] },
      memoryManager: { listEntries: () => [] },
      projectRunHistory: { listRunsAsync: async () => [] },
      modelRouter: { listProviders: () => [] },
    } as never;

    registerTreeViews({
      subscriptions: [],
      extensionUri: { fsPath: '/extension' },
    } as never, atlas);

    expect(registerWebviewViewProvider).toHaveBeenCalledWith(
      'atlasmind.quickLinksView',
      expect.anything(),
      { webviewOptions: { retainContextWhenHidden: true } },
    );
    expect(registrationOrder.indexOf('atlasmind.quickLinksView')).toBeGreaterThanOrEqual(0);
    expect(registrationOrder.indexOf('atlasmind.projectRunsView')).toBeGreaterThanOrEqual(0);
    expect(registrationOrder.indexOf('atlasmind.quickLinksView')).toBeLessThan(registrationOrder.indexOf('atlasmind.projectRunsView'));
  });

  it('renders the compact quick-links view with icon buttons', () => {
    const registerWebviewViewProvider = vi.spyOn(vscode.window, 'registerWebviewViewProvider');

    const atlas = {
      agentsRefresh: { event: vi.fn() },
      skillsRefresh: { event: vi.fn() },
      sessionConversation: {
        onDidChange: vi.fn(() => ({ dispose: () => undefined })),
        listSessions: () => [],
      },
      modelsRefresh: { event: vi.fn() },
      projectRunsRefresh: { event: vi.fn() },
      memoryRefresh: { event: vi.fn() },
      isProviderConfigured: vi.fn(),
      agentRegistry: { listAgents: () => [] },
      skillsRegistry: { listSkills: () => [] },
      mcpServerRegistry: { listServers: () => [] },
      memoryManager: { listEntries: () => [] },
      projectRunHistory: { listRunsAsync: async () => [] },
      modelRouter: { listProviders: () => [] },
    } as never;

    registerTreeViews({
      subscriptions: [],
      extensionUri: { fsPath: '/extension' },
    } as never, atlas);

    const quickLinksRegistration = registerWebviewViewProvider.mock.calls.find(call => call[0] === 'atlasmind.quickLinksView');
    expect(quickLinksRegistration).toBeTruthy();

    const provider = quickLinksRegistration?.[1] as { resolveWebviewView(view: vscode.WebviewView): void };
    const webviewView = {
      webview: {
        cspSource: 'vscode-resource:',
        options: {},
        html: '',
        onDidReceiveMessage: vi.fn(),
      },
    } as unknown as vscode.WebviewView;

    provider.resolveWebviewView(webviewView);

    expect(webviewView.webview.html).toContain('AtlasMind Quick Links');
    expect(webviewView.webview.html).toContain('atlasmind.openPersonalityProfile');
    expect(webviewView.webview.html).toContain('quick-links-row');
    expect(webviewView.webview.html).not.toContain('AtlasMind Home');
  });

  it('prepends a stale-memory warning row that runs the refresh command', async () => {
    const registerTreeDataProvider = vi.spyOn(vscode.window, 'registerTreeDataProvider');
    mocks.getProjectMemoryFreshness.mockResolvedValue({
      hasImportedEntries: true,
      isStale: true,
      staleEntryCount: 3,
      staleEntries: [
        'architecture/project-overview.md',
        'architecture/project-structure.md',
        'domain/product-capabilities.md',
      ],
    });
    (vscode.workspace as { workspaceFolders?: Array<{ uri: unknown }> }).workspaceFolders = [{ uri: { fsPath: '/workspace' } }];

    const atlas = {
      agentsRefresh: { event: vi.fn() },
      skillsRefresh: { event: vi.fn() },
      sessionConversation: {
        onDidChange: vi.fn(() => ({ dispose: () => undefined })),
        listSessions: () => [],
      },
      modelsRefresh: { event: vi.fn() },
      projectRunsRefresh: { event: vi.fn() },
      memoryRefresh: { event: vi.fn() },
      isProviderConfigured: vi.fn(),
      agentRegistry: { listAgents: () => [] },
      skillsRegistry: { listSkills: () => [] },
      memoryManager: {
        listEntries: () => [{
          path: 'decisions/use-vitest.md',
          title: 'Use Vitest',
          tags: ['testing', 'vitest'],
          lastModified: '2026-04-05T00:00:00.000Z',
          snippet: 'We standardised on Vitest because it keeps unit tests fast and consistent across the extension.',
        }],
      },
      projectRunHistory: { listRunsAsync: async () => [] },
      modelRouter: { listProviders: () => [] },
    } as never;

    registerTreeViews({ subscriptions: [] } as never, atlas);

    const memoryRegistration = [...registerTreeDataProvider.mock.calls].reverse().find(call => call[0] === 'atlasmind.memoryView');
    expect(memoryRegistration).toBeTruthy();

    const provider = memoryRegistration?.[1] as { getChildren(element?: unknown): Promise<unknown[]> | unknown[] };
    const items = await Promise.resolve(provider.getChildren());

    const statusItem = items[0] as {
      description?: string;
      contextValue?: string;
      command?: { command?: string };
    };
    expect(statusItem.description).toBe('3 stale imported entries');
    expect(statusItem.contextValue).toBe('memory-status-stale');
    expect(statusItem.command?.command).toBe('atlasmind.updateProjectMemory');
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ contextValue: 'memory-folder', folderPath: 'architecture', description: 'Empty' }),
      expect.objectContaining({ contextValue: 'memory-folder', folderPath: 'decisions' }),
    ]));

    const decisionsFolder = items.find(item => (item as { folderPath?: string }).folderPath === 'decisions');
    const decisionChildren = await Promise.resolve(provider.getChildren(decisionsFolder));
    expect(decisionChildren[0]).toMatchObject({
      entry: expect.objectContaining({ title: 'Use Vitest' }),
    });
  });

  it('shows SSOT storage folders at the root for easier discovery', async () => {
    const registerTreeDataProvider = vi.spyOn(vscode.window, 'registerTreeDataProvider');
    (vscode.workspace as { workspaceFolders?: Array<{ uri: unknown }> }).workspaceFolders = [{ uri: { fsPath: '/workspace' } }];

    const atlas = {
      agentsRefresh: { event: vi.fn() },
      skillsRefresh: { event: vi.fn() },
      sessionConversation: {
        onDidChange: vi.fn(() => ({ dispose: () => undefined })),
        listSessions: () => [],
      },
      modelsRefresh: { event: vi.fn() },
      projectRunsRefresh: { event: vi.fn() },
      memoryRefresh: { event: vi.fn() },
      isProviderConfigured: vi.fn(),
      agentRegistry: { listAgents: () => [] },
      skillsRegistry: { listSkills: () => [] },
      memoryManager: { listEntries: () => [] },
      projectRunHistory: { listRunsAsync: async () => [] },
      modelRouter: { listProviders: () => [] },
    } as never;

    registerTreeViews({ subscriptions: [] } as never, atlas);

    const memoryRegistration = [...registerTreeDataProvider.mock.calls].reverse().find(call => call[0] === 'atlasmind.memoryView');
    const provider = memoryRegistration?.[1] as { getChildren(element?: unknown): Promise<unknown[]> | unknown[] };
    const items = await Promise.resolve(provider.getChildren());

    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ contextValue: 'memory-folder', folderPath: 'architecture' }),
      expect.objectContaining({ contextValue: 'memory-folder', folderPath: 'roadmap' }),
      expect.objectContaining({ contextValue: 'memory-folder', folderPath: 'operations' }),
    ]));
  });
});

describe('SkillsTreeProvider', () => {
  it('shows the skill name without an inline description and keeps details in the tooltip', async () => {
    const registerTreeDataProvider = vi.spyOn(vscode.window, 'registerTreeDataProvider');

    const atlas = {
      agentsRefresh: { event: vi.fn() },
      skillsRefresh: { event: vi.fn() },
      sessionConversation: {
        onDidChange: vi.fn(() => ({ dispose: () => undefined })),
        listSessions: () => [],
      },
      modelsRefresh: { event: vi.fn() },
      projectRunsRefresh: { event: vi.fn() },
      memoryRefresh: { event: vi.fn() },
      agentRegistry: { listAgents: () => [] },
      skillsRegistry: {
        listSkills: () => [{
          id: 'file-read',
          name: 'File Read',
          description: 'Read a UTF-8 workspace file and return its contents.',
          parameters: { type: 'object', properties: {}, required: [] },
          builtIn: false,
          source: 'skills/fileRead.ts',
        }],
        listCustomFolders: () => [],
        isEnabled: () => true,
        getScanResult: () => undefined,
      },
      memoryManager: { listEntries: () => [] },
      projectRunHistory: { listRunsAsync: async () => [] },
      modelRouter: { listProviders: () => [] },
      isProviderConfigured: vi.fn(),
    } as never;

    registerTreeViews({ subscriptions: [] } as never, atlas);

    const skillsRegistration = [...registerTreeDataProvider.mock.calls].reverse().find(call => call[0] === 'atlasmind.skillsView');
    expect(skillsRegistration).toBeTruthy();

    const provider = skillsRegistration?.[1] as { getChildren(element?: unknown): unknown[] };
    const items = provider.getChildren();
    expect(items).toHaveLength(1);
    expect((items[0] as { skillId?: string }).skillId).toBe('file-read');
    expect((items[0] as { description?: string }).description).toBeUndefined();
    expect((items[0] as { tooltip?: unknown }).tooltip).toBeDefined();
  });

  it('groups built-in skills by category and nests custom skills under explicit folders', async () => {
    const registerTreeDataProvider = vi.spyOn(vscode.window, 'registerTreeDataProvider');

    const atlas = {
      agentsRefresh: { event: vi.fn() },
      skillsRefresh: { event: vi.fn() },
      sessionConversation: {
        onDidChange: vi.fn(() => ({ dispose: () => undefined })),
        listSessions: () => [],
        listFolders: () => [],
      },
      modelsRefresh: { event: vi.fn() },
      projectRunsRefresh: { event: vi.fn() },
      memoryRefresh: { event: vi.fn() },
      agentRegistry: { listAgents: () => [] },
      skillsRegistry: {
        listSkills: () => [
          {
            id: 'file-read',
            name: 'File Read',
            description: 'Read files.',
            parameters: { type: 'object', properties: {}, required: [] },
            builtIn: true,
            panelPath: ['Workspace Files'],
          },
          {
            id: 'web-fetch',
            name: 'Web Fetch',
            description: 'Fetch web pages.',
            parameters: { type: 'object', properties: {}, required: [] },
            builtIn: true,
            panelPath: ['Search & Fetch'],
          },
          {
            id: 'custom-lint',
            name: 'Custom Lint',
            description: 'Run lint.',
            parameters: { type: 'object', properties: {}, required: [] },
            builtIn: false,
            source: 'c:/tmp/custom-lint.js',
            panelPath: ['Team', 'QA'],
          },
        ],
        listCustomFolders: () => ['Team', 'Team/QA'],
        isEnabled: () => true,
        getScanResult: () => undefined,
      },
      memoryManager: { listEntries: () => [] },
      projectRunHistory: { listRunsAsync: async () => [] },
      modelRouter: { listProviders: () => [] },
      isProviderConfigured: vi.fn(),
    } as never;

    registerTreeViews({ subscriptions: [] } as never, atlas);

    const skillsRegistration = [...registerTreeDataProvider.mock.calls].reverse().find(call => call[0] === 'atlasmind.skillsView');
    const provider = skillsRegistration?.[1] as { getChildren(element?: unknown): unknown[] };

    const rootItems = provider.getChildren();
    expect(rootItems).toMatchObject([
      { contextValue: 'skill-folder', folderPath: 'Team' },
      { contextValue: 'skill-section', groupId: 'built-in-skills' },
    ]);

    const teamFolder = rootItems[0];
    const teamChildren = provider.getChildren(teamFolder);
    expect(teamChildren).toMatchObject([
      { contextValue: 'skill-folder', folderPath: 'Team/QA' },
    ]);

    const qaChildren = provider.getChildren(teamChildren[0]);
    expect(qaChildren).toMatchObject([
      { skillId: 'custom-lint' },
    ]);

    const builtInRoot = rootItems[1];
    const builtInCategories = provider.getChildren(builtInRoot);
    expect(builtInCategories).toMatchObject([
      { contextValue: 'skill-category', groupId: 'Search & Fetch' },
      { contextValue: 'skill-category', groupId: 'Workspace Files' },
    ]);
  });
});

describe('ModelsTreeProvider', () => {
  it('expands a configured provider into model items instead of recursively returning providers', async () => {
    const createTreeView = vi.spyOn(vscode.window, 'createTreeView');

    const atlas = {
      agentsRefresh: { event: vi.fn() },
      skillsRefresh: { event: vi.fn() },
      sessionConversation: {
        onDidChange: vi.fn(() => ({ dispose: () => undefined })),
        listSessions: () => [],
      },
      modelsRefresh: { event: vi.fn() },
      projectRunsRefresh: { event: vi.fn() },
      memoryRefresh: { event: vi.fn() },
      isProviderConfigured: vi.fn().mockResolvedValue(true),
      agentRegistry: { listAgents: () => [] },
      skillsRegistry: { listSkills: () => [], listCustomFolders: () => [] },
      memoryManager: { listEntries: () => [] },
      projectRunHistory: { listRunsAsync: async () => [] },
      modelRouter: {
        listProviders: () => [
          {
            id: 'anthropic',
            displayName: 'Anthropic',
            enabled: true,
            pricingModel: 'pay-per-token',
            apiKeySettingKey: 'atlasmind.provider.anthropic.apiKey',
            models: [
              {
                id: 'anthropic/claude-sonnet-4',
                provider: 'anthropic',
                name: 'Claude Sonnet 4',
                contextWindow: 200000,
                inputPricePer1k: 0.003,
                outputPricePer1k: 0.015,
                capabilities: ['chat', 'code'],
                enabled: true,
              },
              {
                id: 'anthropic/claude-haiku-4',
                provider: 'anthropic',
                name: 'Claude Haiku 4',
                contextWindow: 200000,
                inputPricePer1k: 0.001,
                outputPricePer1k: 0.005,
                capabilities: ['chat'],
                enabled: false,
              },
            ],
          },
        ],
      },
    } as never;

    registerTreeViews({ subscriptions: [] } as never, atlas);

    const modelsRegistration = [...createTreeView.mock.calls].reverse().find(call => call[0] === 'atlasmind.modelsView');
    expect(modelsRegistration).toBeTruthy();

    const provider = modelsRegistration?.[1]?.treeDataProvider as { getChildren(element?: unknown): Promise<unknown[]> };
    const rootItems = await provider.getChildren();
    expect(rootItems).toHaveLength(1);
    expect(rootItems[0]).toMatchObject({
      providerId: 'anthropic',
      contextValue: 'model-provider-configured-enabled',
      enabled: true,
      configured: true,
      partiallyEnabled: true,
      description: '(⚠)',
    });

    const childItems = await provider.getChildren(rootItems[0]);
    expect(childItems).toHaveLength(2);
    expect(childItems[0]).toMatchObject({
      providerId: 'anthropic',
      modelId: 'anthropic/claude-sonnet-4',
      contextValue: 'model-item-enabled',
      enabled: true,
    });
    expect(childItems[1]).toMatchObject({
      providerId: 'anthropic',
      modelId: 'anthropic/claude-haiku-4',
      contextValue: 'model-item-disabled',
      enabled: false,
    });
  });

  it('marks failed models with a warning state in the Models sidebar view', async () => {
    const createTreeView = vi.spyOn(vscode.window, 'createTreeView');

    const atlas = {
      agentsRefresh: { event: vi.fn() },
      skillsRefresh: { event: vi.fn() },
      sessionConversation: {
        onDidChange: vi.fn(() => ({ dispose: () => undefined })),
        listSessions: () => [],
      },
      modelsRefresh: { event: vi.fn() },
      projectRunsRefresh: { event: vi.fn() },
      memoryRefresh: { event: vi.fn() },
      isProviderConfigured: vi.fn().mockResolvedValue(true),
      agentRegistry: { listAgents: () => [] },
      skillsRegistry: { listSkills: () => [], listCustomFolders: () => [] },
      memoryManager: { listEntries: () => [] },
      projectRunHistory: { listRunsAsync: async () => [] },
      modelRouter: {
        getProviderFailureCount: () => 1,
        getModelFailure: (modelId: string) => modelId === 'google/gemini-2.5-pro'
          ? { failureCount: 2, failedAt: '2026-04-06T09:00:00.000Z', message: 'quota exceeded' }
          : undefined,
        listProviders: () => [
          {
            id: 'google',
            displayName: 'Google Gemini',
            enabled: true,
            pricingModel: 'pay-per-token',
            apiKeySettingKey: 'atlasmind.provider.google.apiKey',
            models: [
              {
                id: 'google/gemini-2.5-pro',
                provider: 'google',
                name: 'Gemini 2.5 Pro',
                contextWindow: 1000000,
                inputPricePer1k: 0.001,
                outputPricePer1k: 0.003,
                capabilities: ['chat', 'code', 'function_calling'],
                enabled: true,
              },
            ],
          },
        ],
      },
    } as never;

    registerTreeViews({ subscriptions: [] } as never, atlas);

    const modelsRegistration = [...createTreeView.mock.calls].reverse().find(call => call[0] === 'atlasmind.modelsView');
    expect(modelsRegistration).toBeTruthy();

    const provider = modelsRegistration?.[1]?.treeDataProvider as { getChildren(element?: unknown): Promise<unknown[]> };
    const rootItems = await provider.getChildren();
    expect(rootItems[0]).toMatchObject({
      providerId: 'google',
      hasFailedModels: true,
      description: '(⚠ 1 failed)',
    });

    const childItems = await provider.getChildren(rootItems[0]);
    expect(childItems[0]).toMatchObject({
      providerId: 'google',
      modelId: 'google/gemini-2.5-pro',
      contextValue: 'model-item-failed-enabled',
      failed: true,
      description: 'failed',
    });
  });

  it('disambiguates duplicate model names with their exact model ids in the Models sidebar view', async () => {
    const createTreeView = vi.spyOn(vscode.window, 'createTreeView');

    const atlas = {
      agentsRefresh: { event: vi.fn() },
      skillsRefresh: { event: vi.fn() },
      sessionConversation: {
        onDidChange: vi.fn(() => ({ dispose: () => undefined })),
        listSessions: () => [],
      },
      modelsRefresh: { event: vi.fn() },
      projectRunsRefresh: { event: vi.fn() },
      memoryRefresh: { event: vi.fn() },
      isProviderConfigured: vi.fn().mockResolvedValue(true),
      agentRegistry: { listAgents: () => [] },
      skillsRegistry: { listSkills: () => [], listCustomFolders: () => [] },
      memoryManager: { listEntries: () => [] },
      projectRunHistory: { listRunsAsync: async () => [] },
      modelRouter: {
        listProviders: () => [
          {
            id: 'anthropic',
            displayName: 'Anthropic',
            enabled: true,
            pricingModel: 'pay-per-token',
            apiKeySettingKey: 'atlasmind.provider.anthropic.apiKey',
            models: [
              {
                id: 'anthropic/claude-opus-4-20250514',
                provider: 'anthropic',
                name: 'Claude Opus 4',
                contextWindow: 200000,
                inputPricePer1k: 0.015,
                outputPricePer1k: 0.075,
                capabilities: ['chat', 'code', 'reasoning'],
                enabled: true,
              },
              {
                id: 'anthropic/claude-opus-4-20251001',
                provider: 'anthropic',
                name: 'Claude Opus 4',
                contextWindow: 200000,
                inputPricePer1k: 0.015,
                outputPricePer1k: 0.075,
                capabilities: ['chat', 'code', 'reasoning'],
                enabled: true,
              },
            ],
          },
        ],
      },
    } as never;

    registerTreeViews({ subscriptions: [] } as never, atlas);

    const modelsRegistration = [...createTreeView.mock.calls].reverse().find(call => call[0] === 'atlasmind.modelsView');
    expect(modelsRegistration).toBeTruthy();

    const provider = modelsRegistration?.[1]?.treeDataProvider as { getChildren(element?: unknown): Promise<unknown[]> };
    const rootItems = await provider.getChildren();
    const childItems = await provider.getChildren(rootItems[0]);

    expect(childItems).toMatchObject([
      expect.objectContaining({
        modelId: 'anthropic/claude-opus-4-20250514',
        description: 'claude-opus-4-20250514',
      }),
      expect.objectContaining({
        modelId: 'anthropic/claude-opus-4-20251001',
        description: 'claude-opus-4-20251001',
      }),
    ]);
  });

  it('hides child models for an unconfigured provider and keeps it below configured providers', async () => {
    const createTreeView = vi.spyOn(vscode.window, 'createTreeView');

    const atlas = {
      agentsRefresh: { event: vi.fn() },
      skillsRefresh: { event: vi.fn() },
      sessionConversation: {
        onDidChange: vi.fn(() => ({ dispose: () => undefined })),
        listSessions: () => [],
      },
      modelsRefresh: { event: vi.fn() },
      projectRunsRefresh: { event: vi.fn() },
      memoryRefresh: { event: vi.fn() },
      isProviderConfigured: vi.fn().mockResolvedValue(false),
      agentRegistry: { listAgents: () => [] },
      skillsRegistry: { listSkills: () => [], listCustomFolders: () => [] },
      memoryManager: { listEntries: () => [] },
      projectRunHistory: { listRunsAsync: async () => [] },
      modelRouter: {
        listProviders: () => [{
          id: 'google',
          displayName: 'Google Gemini',
          enabled: true,
          pricingModel: 'pay-per-token',
          apiKeySettingKey: 'atlasmind.provider.google.apiKey',
          models: [{
            id: 'google/gemini-2.5-pro',
            provider: 'google',
            name: 'Gemini 2.5 Pro',
            contextWindow: 1000000,
            inputPricePer1k: 0.001,
            outputPricePer1k: 0.003,
            capabilities: ['chat', 'code'],
            enabled: true,
          }],
        }, {
          id: 'openai',
          displayName: 'OpenAI',
          enabled: true,
          pricingModel: 'pay-per-token',
          apiKeySettingKey: 'atlasmind.provider.openai.apiKey',
          models: [{
            id: 'openai/gpt-5',
            provider: 'openai',
            name: 'GPT-5',
            contextWindow: 400000,
            inputPricePer1k: 0.002,
            outputPricePer1k: 0.008,
            capabilities: ['chat', 'code'],
            enabled: true,
          }],
        }],
      },
    } as never;

    atlas.isProviderConfigured = vi.fn().mockImplementation(async (providerId: string) => providerId === 'openai');

    registerTreeViews({ subscriptions: [] } as never, atlas);

    const modelsRegistration = [...createTreeView.mock.calls].reverse().find(call => call[0] === 'atlasmind.modelsView');
    const provider = modelsRegistration?.[1]?.treeDataProvider as { getChildren(element?: unknown): Promise<unknown[]> };
    const rootItems = await provider.getChildren();

    expect(rootItems[0]).toMatchObject({
      providerId: 'openai',
      configured: true,
    });

    expect(rootItems[1]).toMatchObject({
      providerId: 'google',
      contextValue: 'model-provider-unconfigured-enabled',
      configured: false,
    });

    const childItems = await provider.getChildren(rootItems[1]);
    expect(childItems).toEqual([]);
  });

  it('lists MCP servers with runtime status in the MCP sidebar view', async () => {
    const registerTreeDataProvider = vi.spyOn(vscode.window, 'registerTreeDataProvider');

    const atlas = {
      agentsRefresh: { event: vi.fn() },
      skillsRefresh: { event: vi.fn() },
      sessionConversation: {
        onDidChange: vi.fn(() => ({ dispose: () => undefined })),
        listSessions: () => [],
      },
      modelsRefresh: { event: vi.fn() },
      projectRunsRefresh: { event: vi.fn() },
      memoryRefresh: { event: vi.fn() },
      isProviderConfigured: vi.fn().mockResolvedValue(false),
      agentRegistry: { listAgents: () => [] },
      skillsRegistry: { listSkills: () => [], listCustomFolders: () => [] },
      mcpServerRegistry: {
        listServers: () => [{
          config: {
            id: 'filesystem',
            name: 'Filesystem Tools',
            transport: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem'],
            enabled: true,
          },
          status: 'connected',
          tools: [{ serverId: 'filesystem', name: 'read_file', description: 'Read file', inputSchema: {} }],
        }],
      },
      memoryManager: { listEntries: () => [] },
      projectRunHistory: { listRunsAsync: async () => [] },
      modelRouter: { listProviders: () => [] },
    } as never;

    registerTreeViews({ subscriptions: [] } as never, atlas);

    const mcpRegistration = [...registerTreeDataProvider.mock.calls].reverse().find(call => call[0] === 'atlasmind.mcpServersView');
    expect(mcpRegistration).toBeTruthy();

    const provider = mcpRegistration?.[1] as { getChildren(element?: unknown): unknown[] };
    const items = provider.getChildren();
    expect(items).toMatchObject([
      {
        contextValue: 'mcp-server-connected',
        description: 'connected • 1 tool',
        state: expect.objectContaining({
          config: expect.objectContaining({ name: 'Filesystem Tools' }),
          status: 'connected',
        }),
      },
    ]);
  });

  it('groups chat sessions into persisted session folders in the Sessions tree', async () => {
    const createTreeView = vi.spyOn(vscode.window, 'createTreeView');

    const atlas = {
      agentsRefresh: { event: vi.fn() },
      skillsRefresh: { event: vi.fn() },
      sessionConversation: {
        onDidChange: vi.fn(() => ({ dispose: () => undefined })),
        listFolders: () => [{
          id: 'folder-1',
          name: 'Release Planning',
          createdAt: '2026-04-05T00:00:00.000Z',
          updatedAt: '2026-04-05T00:00:00.000Z',
          sessionCount: 1,
        }],
        listSessions: () => [{
          id: 'chat-1',
          title: 'Sprint Review',
          folderId: 'folder-1',
          createdAt: '2026-04-05T00:00:00.000Z',
          updatedAt: '2026-04-05T00:00:00.000Z',
          turnCount: 3,
          preview: 'Discuss launch checklist',
          isActive: true,
        }, {
          id: 'chat-2',
          title: 'Unfiled',
          createdAt: '2026-04-05T00:00:00.000Z',
          updatedAt: '2026-04-05T00:00:00.000Z',
          turnCount: 1,
          preview: 'Top level thread',
          isActive: false,
        }],
        listArchivedSessions: () => [],
      },
      modelsRefresh: { event: vi.fn() },
      projectRunsRefresh: { event: vi.fn() },
      memoryRefresh: { event: vi.fn() },
      agentRegistry: { listAgents: () => [] },
      skillsRegistry: { listSkills: () => [], listCustomFolders: () => [] },
      memoryManager: { listEntries: () => [] },
      projectRunHistory: { listRunsAsync: async () => [] },
      modelRouter: { listProviders: () => [] },
      isProviderConfigured: vi.fn(),
    } as never;

    registerTreeViews({ subscriptions: [] } as never, atlas);

      const sessionsTree = [...createTreeView.mock.calls].reverse().find(call => call[0] === 'atlasmind.sessionsView');
  expect(sessionsTree).toBeTruthy();

  const provider = sessionsTree?.[1]?.treeDataProvider as { getChildren(element?: unknown): Promise<unknown[]> };
    const rootItems = await provider.getChildren();
    expect(rootItems[0]).toMatchObject({ sectionId: 'chat-sessions' });

    const chatItems = await provider.getChildren(rootItems[0]);
    expect(chatItems[0]).toMatchObject({ contextValue: 'chat-session-folder', folder: expect.objectContaining({ name: 'Release Planning' }) });
    expect(chatItems[1]).toMatchObject({ contextValue: 'chat-session', session: expect.objectContaining({ title: 'Unfiled' }) });

    const folderChildren = await provider.getChildren(chatItems[0]);
    expect(folderChildren).toEqual([
      expect.objectContaining({ contextValue: 'chat-session-active', session: expect.objectContaining({ title: 'Sprint Review' }) }),
    ]);
  });

  it('exposes memory entries as openable items with inline action context and a natural-language tooltip', async () => {
    const registerTreeDataProvider = vi.spyOn(vscode.window, 'registerTreeDataProvider');
    (vscode.workspace as { workspaceFolders?: Array<{ uri: unknown }> }).workspaceFolders = undefined;

    const atlas = {
      agentsRefresh: { event: vi.fn() },
      skillsRefresh: { event: vi.fn() },
      sessionConversation: {
        onDidChange: vi.fn(() => ({ dispose: () => undefined })),
        listSessions: () => [],
      },
      modelsRefresh: { event: vi.fn() },
      projectRunsRefresh: { event: vi.fn() },
      memoryRefresh: { event: vi.fn() },
      isProviderConfigured: vi.fn(),
      agentRegistry: { listAgents: () => [] },
      skillsRegistry: { listSkills: () => [] },
      memoryManager: {
        listEntries: () => [{
          path: 'decisions/use-vitest.md',
          title: 'Use Vitest',
          tags: ['testing', 'vitest'],
          lastModified: '2026-04-05T00:00:00.000Z',
          snippet: 'We standardised on Vitest because it keeps unit tests fast and consistent across the extension.',
        }],
      },
      projectRunHistory: { listRunsAsync: async () => [] },
      modelRouter: { listProviders: () => [] },
    } as never;

    registerTreeViews({ subscriptions: [] } as never, atlas);

    const memoryRegistration = [...registerTreeDataProvider.mock.calls].reverse().find(call => call[0] === 'atlasmind.memoryView');
    expect(memoryRegistration).toBeTruthy();

    const provider = memoryRegistration?.[1] as { getChildren(element?: unknown): Promise<unknown[]> | unknown[] };
    const items = await Promise.resolve(provider.getChildren());
    const folderItem = items.find(item => (item as { folderPath?: string }).folderPath === 'decisions');
    const folderChildren = await Promise.resolve(provider.getChildren(folderItem));

    const firstItem = folderChildren[0] as {
      entry?: { title?: string; path?: string };
      description?: string;
      contextValue?: string;
      command?: { command?: string };
      review?: string;
    };

    expect(firstItem.entry?.title).toBe('Use Vitest');
    expect(firstItem.entry?.path).toBe('decisions/use-vitest.md');
    expect(firstItem.description).toBe('decisions/use-vitest.md');
    expect(firstItem.contextValue).toBe('memory-entry');
    expect(firstItem.command?.command).toBe('atlasmind.memory.openEntry');
    expect(firstItem.review).toContain('This decisions memory note appears to document "Use Vitest".');
  });
});

describe('SessionsTreeProvider', () => {
  it('shows an Archive folder and supports drag-and-drop archive and restore flows', async () => {
    const createTreeView = vi.spyOn(vscode.window, 'createTreeView');

    const archiveSession = vi.fn().mockReturnValue(true);
    const unarchiveSession = vi.fn().mockReturnValue(true);
    const assignSessionToFolder = vi.fn().mockReturnValue(true);

    const atlas = {
      agentsRefresh: { event: vi.fn() },
      skillsRefresh: { event: vi.fn() },
      sessionConversation: {
        onDidChange: vi.fn(() => ({ dispose: () => undefined })),
        listSessions: () => [{
          id: 'chat-2',
          title: 'Unfiled',
          createdAt: '2026-04-05T00:00:00.000Z',
          updatedAt: '2026-04-05T00:00:00.000Z',
          turnCount: 1,
          preview: 'Top level thread',
          isActive: false,
          isArchived: false,
        }],
        listArchivedSessions: () => [{
          id: 'chat-1',
          title: 'Archived Thread',
          createdAt: '2026-04-05T00:00:00.000Z',
          updatedAt: '2026-04-05T00:00:00.000Z',
          archivedAt: '2026-04-06T00:00:00.000Z',
          turnCount: 2,
          preview: 'Stored away',
          isActive: false,
          isArchived: true,
        }],
        listFolders: () => [{
          id: 'folder-1',
          name: 'Release Planning',
          createdAt: '2026-04-05T00:00:00.000Z',
          updatedAt: '2026-04-05T00:00:00.000Z',
          sessionCount: 1,
        }],
        archiveSession,
        unarchiveSession,
        assignSessionToFolder,
      },
      modelsRefresh: { event: vi.fn() },
      projectRunsRefresh: { event: vi.fn() },
      memoryRefresh: { event: vi.fn() },
      agentRegistry: { listAgents: () => [] },
      skillsRegistry: { listSkills: () => [], listCustomFolders: () => [] },
      memoryManager: { listEntries: () => [] },
      projectRunHistory: { listRunsAsync: async () => [] },
      modelRouter: { listProviders: () => [] },
      isProviderConfigured: vi.fn(),
    } as never;

    registerTreeViews({ subscriptions: [] } as never, atlas);

    const sessionsTree = [...createTreeView.mock.calls].reverse().find(call => call[0] === 'atlasmind.sessionsView');
    expect(sessionsTree).toBeTruthy();

    const provider = sessionsTree?.[1]?.treeDataProvider as { getChildren(element?: unknown): Promise<unknown[]> };
    const dnd = sessionsTree?.[1]?.dragAndDropController as {
      handleDrag(source: readonly unknown[], dataTransfer: vscode.DataTransfer): Promise<void>;
      handleDrop(target: unknown, dataTransfer: vscode.DataTransfer): Promise<void>;
    };
    const rootItems = await provider.getChildren();
    expect(rootItems[0]).toMatchObject({ sectionId: 'chat-sessions' });

    const chatItems = await provider.getChildren(rootItems[0]);
    expect(chatItems[0]).toMatchObject({ contextValue: 'chat-session-archive-folder' });
    expect(chatItems[1]).toMatchObject({ contextValue: 'chat-session-folder' });
    expect(chatItems[2]).toMatchObject({ contextValue: 'chat-session', session: expect.objectContaining({ title: 'Unfiled' }) });

    const archivedChildren = await provider.getChildren(chatItems[0]);
    expect(archivedChildren).toEqual([
      expect.objectContaining({ contextValue: 'chat-session-archived', session: expect.objectContaining({ title: 'Archived Thread' }) }),
    ]);

    const draggedSessions = {
      get: (mimeType: string) => mimeType === 'application/vnd.atlasmind.sessions'
        ? { asString: async () => JSON.stringify(['chat-2']) }
        : undefined,
    } as unknown as vscode.DataTransfer;
    await dnd.handleDrop(chatItems[0], draggedSessions);
    expect(archiveSession).toHaveBeenCalledWith('chat-2');

    const restoreToRoot = {
      get: (mimeType: string) => mimeType === 'application/vnd.atlasmind.sessions'
        ? { asString: async () => JSON.stringify(['chat-1']) }
        : undefined,
    } as unknown as vscode.DataTransfer;
    await dnd.handleDrop(rootItems[0], restoreToRoot);
    expect(unarchiveSession).toHaveBeenCalledWith('chat-1');
    expect(assignSessionToFolder).toHaveBeenCalledWith('chat-1', undefined);
  });
});