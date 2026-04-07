import * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import { buildModelSummary, collapseAtlasMindSidebarTrees } from '../src/commands.ts';
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
          listModels: vi.fn().mockResolvedValue(['local/mistral:latest', 'local/qwen2.5-coder:1.5b-base']),
        }),
      },
      getModelInfoUrl: () => undefined,
    } as never;

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
    expect(summary).toContain('`mistral:latest`');
    expect(summary).toContain('`qwen2.5-coder:1.5b-base`');
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