import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { registerTreeViews } from '../../src/views/treeViews.ts';

vi.mock('vscode');

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
});

describe('ModelsTreeProvider', () => {
  it('expands a configured provider into model items instead of recursively returning providers', async () => {
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
      isProviderConfigured: vi.fn().mockResolvedValue(true),
      agentRegistry: { listAgents: () => [] },
      skillsRegistry: { listSkills: () => [] },
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

    const modelsRegistration = [...registerTreeDataProvider.mock.calls].reverse().find(call => call[0] === 'atlasmind.modelsView');
    expect(modelsRegistration).toBeTruthy();

    const provider = modelsRegistration?.[1] as { getChildren(element?: unknown): Promise<unknown[]> };
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

  it('hides child models for an unconfigured provider and keeps it below configured providers', async () => {
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
      skillsRegistry: { listSkills: () => [] },
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

    const modelsRegistration = [...registerTreeDataProvider.mock.calls].reverse().find(call => call[0] === 'atlasmind.modelsView');
    const provider = modelsRegistration?.[1] as { getChildren(element?: unknown): Promise<unknown[]> };
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

  it('exposes memory entries as openable items with inline action context and a natural-language tooltip', async () => {
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

    const firstItem = items[0] as {
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