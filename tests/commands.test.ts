import * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import { buildModelSummary, collapseAtlasMindSidebarTrees, registerCommands } from '../src/commands.ts';
import { RECOMMENDED_MCP_SERVERS, getRecommendedMcpStarterDetails } from '../src/constants.ts';
import { ModelProviderTreeItem } from '../src/views/treeViews.ts';
import type { ProviderConfig } from '../src/types.ts';

vi.mock('vscode');

describe('buildModelSummary', () => {
  it('includes live engine models for the local provider info summary', async () => {
    const provider: ProviderConfig = {
      id: 'local',
      displayName: 'Local Model',
      apiKeySettingKey: 'atlasmind.provider.local.apiKey',
      enabled: true,
      pricingModel: 'free',
      models: [
        {
          id: 'local/mistral:latest',
          provider: 'local',
          name: 'Mistral',
          contextWindow: 8192,
          inputPricePer1k: 0,
          outputPricePer1k: 0,
          capabilities: ['chat'],
          enabled: true,
        },
      ],
    };

    const atlas = {
      modelRouter: {
        listProviders: () => [provider],
      },
      providerRegistry: {
        get: vi.fn().mockReturnValue({
          listModels: vi.fn().mockResolvedValue(['local/ollama@@mistral:latest', 'local/lm-studio@@qwen2.5-coder:1.5b-base']),
        }),
      },
      getModelInfoUrl: () => undefined,
    } as never;

    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: ((key: string) => {
        if (key === 'localOpenAiEndpoints') {
          return [
            { id: 'ollama', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1' },
            { id: 'lm-studio', label: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1' },
          ];
        }
        return undefined;
      }) as never,
    } as never);

    const item = new ModelProviderTreeItem(
      'local',
      'Local Model',
      undefined,
      true,
      true,
      false,
      false,
      1,
    );

    const summary = await buildModelSummary(atlas, item);

    expect(summary).toContain('**Atlas routed models available:** 1');
    expect(summary).toContain('**Atlas routed models enabled:** 1');
    expect(summary).toContain('**Engine models loaded:** 2');
    expect(summary).toContain('**Live engine model list:**');
    expect(summary).toContain('`Ollama: mistral:latest`');
    expect(summary).toContain('`LM Studio: qwen2.5-coder:1.5b-base`');
  });
});

describe('collapseAtlasMindSidebarTrees', () => {
  it('runs the collapse-all command for each AtlasMind tree view', async () => {
    const executeCommand = vi.fn().mockResolvedValue(undefined);
    (vscode as { commands: { executeCommand: typeof executeCommand } }).commands = { executeCommand };

    await collapseAtlasMindSidebarTrees();

    expect(executeCommand.mock.calls.map(call => call[0])).toEqual([
      'workbench.actions.treeView.atlasmind.projectRunsView.collapseAll',
      'workbench.actions.treeView.atlasmind.sessionsView.collapseAll',
      'workbench.actions.treeView.atlasmind.memoryView.collapseAll',
      'workbench.actions.treeView.atlasmind.agentsView.collapseAll',
      'workbench.actions.treeView.atlasmind.skillsView.collapseAll',
      'workbench.actions.treeView.atlasmind.mcpServersView.collapseAll',
      'workbench.actions.treeView.atlasmind.modelsView.collapseAll',
    ]);
  });
});

describe('registerCommands', () => {
  it('registers the recommended MCP quick-add command used by the sidebar', () => {
    const registerCommand = vi.fn().mockReturnValue({ dispose: () => undefined });
    (vscode as { commands: { registerCommand: typeof registerCommand } }).commands = { registerCommand };

    registerCommands({ subscriptions: [] } as never, () => undefined);

    expect(registerCommand.mock.calls.map(call => call[0])).toContain('atlasmind.mcpServers.addRecommended');
  });

  it('registers the one-click recommended MCP installer command', () => {
    const registerCommand = vi.fn().mockReturnValue({ dispose: () => undefined });
    (vscode as { commands: { registerCommand: typeof registerCommand } }).commands = { registerCommand };

    registerCommands({ subscriptions: [] } as never, () => undefined);

    expect(registerCommand.mock.calls.map(call => call[0])).toContain('atlasmind.mcpServers.installRecommended');
  });
});

describe('RECOMMENDED_MCP_SERVERS', () => {
  it('does not use the deprecated broken GitHub server slug pattern', () => {
    const brokenPattern = /github\.com\/modelcontextprotocol\/server-/i;

    for (const server of RECOMMENDED_MCP_SERVERS) {
      expect(server.installUrl).toMatch(/^https:\/\//);
      expect(server.docsUrl).toMatch(/^https:\/\//);
      expect(server.installUrl).not.toMatch(brokenPattern);
      expect(server.docsUrl).not.toMatch(brokenPattern);
    }
  });

  it('declares provenance metadata for UI badges in the MCP picker', () => {
    const allowedProvenance = new Set(['official', 'community', 'registry', 'archived']);

    for (const server of RECOMMENDED_MCP_SERVERS) {
      expect(typeof server.provenance).toBe('string');
      expect(allowedProvenance.has(server.provenance)).toBe(true);
    }

    expect(RECOMMENDED_MCP_SERVERS.find(server => server.id === 'mcp-server-github')?.provenance).toBe('official');
    expect(RECOMMENDED_MCP_SERVERS.find(server => server.id === 'mcp-server-slack')?.provenance).toBe('community');
    expect(RECOMMENDED_MCP_SERVERS.find(server => server.id === 'mcp-server-postgres')?.provenance).toBe('archived');
  });

  it('provides audited connection guidance for every recommended MCP preset', () => {
    for (const server of RECOMMENDED_MCP_SERVERS) {
      const starter = getRecommendedMcpStarterDetails(server.id);
      expect(['prefill', 'manual']).toContain(starter.setupMode);
      expect(typeof starter.note).toBe('string');
      expect(starter.note.length).toBeGreaterThan(20);
    }

    const newCatalogueIds = [
      'mcp-server-shopify',
      'mcp-server-wordpress',
      'mcp-server-webflow',
      'mcp-server-youtube',
      'mcp-server-twitch',
      'mcp-server-linkedin',
      'mcp-server-meta',
    ];

    for (const id of newCatalogueIds) {
      expect(RECOMMENDED_MCP_SERVERS.some(server => server.id === id)).toBe(true);
      expect(getRecommendedMcpStarterDetails(id).setupMode).toBe('manual');
    }

    expect(getRecommendedMcpStarterDetails('mcp-server-filesystem')).toMatchObject({
      setupMode: 'prefill',
      transport: 'stdio',
      command: 'npx',
    });
    expect(getRecommendedMcpStarterDetails('mcp-server-git')).toMatchObject({
      setupMode: 'prefill',
      transport: 'stdio',
      command: 'uvx',
      args: ['mcp-server-git'],
    });
    expect(getRecommendedMcpStarterDetails('mcp-server-gitkraken')).toMatchObject({
      setupMode: 'prefill',
      transport: 'stdio',
      command: 'gk',
      args: ['mcp'],
    });
    expect(getRecommendedMcpStarterDetails('mcp-server-work-timer')).toMatchObject({
      setupMode: 'prefill',
      transport: 'stdio',
      command: 'node',
      args: ['${userHome}/Work-Timer/dist/mcp/server.js'],
    });
    expect(getRecommendedMcpStarterDetails('mcp-server-git').runtimeInstalls?.win32?.[0]?.packageId).toBe('astral-sh.uv');
    expect(getRecommendedMcpStarterDetails('mcp-server-git').runtimeInstalls?.darwin?.[0]?.packageManager).toBe('brew');
    expect(getRecommendedMcpStarterDetails('mcp-server-git').runtimeInstalls?.linux?.length).toBeGreaterThan(0);
    expect(getRecommendedMcpStarterDetails('mcp-server-gitkraken').runtimeInstalls?.win32?.[0]?.packageId).toBe('GitKraken.cli');
    expect(getRecommendedMcpStarterDetails('mcp-server-gitkraken').runtimeInstalls?.darwin?.[0]?.packageManager).toBe('brew');
    expect(getRecommendedMcpStarterDetails('mcp-server-github').setupMode).toBe('manual');
    expect(getRecommendedMcpStarterDetails('mcp-server-m365').setupMode).toBe('manual');
  });
});