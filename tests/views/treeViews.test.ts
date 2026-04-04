import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { registerTreeViews } from '../../src/views/treeViews.ts';

vi.mock('vscode');

describe('ModelsTreeProvider', () => {
  it('expands a configured provider into model items instead of recursively returning providers', async () => {
    const registerTreeDataProvider = vi.spyOn(vscode.window, 'registerTreeDataProvider');

    const atlas = {
      agentsRefresh: { event: vi.fn() },
      skillsRefresh: { event: vi.fn() },
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
});