import { describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '../../src/types.ts';
import {
  hideModelSidebarEntry,
  isModelSidebarBridgeHidden,
  isModelSidebarModelHidden,
  isModelSidebarProviderHidden,
  MODEL_SIDEBAR_HIDDEN_ENTRIES_KEY,
  modelSidebarHiddenEntryKey,
  readHiddenModelSidebarEntries,
  restoreModelSidebarEntry,
} from '../../src/views/modelSidebarVisibility.ts';
import {
  ModelProviderTreeItem,
  ModelsTreeProvider,
  ModelTreeItem,
} from '../../src/views/treeViews.ts';

class MemoryState {
  readonly update = vi.fn(async (key: string, value: unknown): Promise<void> => {
    this.values.set(key, value);
  });

  constructor(private readonly values = new Map<string, unknown>()) {}

  get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.values.has(key) ? this.values.get(key) : defaultValue) as T | undefined;
  }
}

function localProvider(): ProviderConfig {
  return {
    id: 'local',
    displayName: 'Local Models',
    apiKeySettingKey: 'atlasmind.provider.local.apiKey',
    enabled: true,
    pricingModel: 'free',
    models: [
      {
        id: 'local/first',
        provider: 'local',
        name: 'First',
        contextWindow: 8192,
        inputPricePer1k: 0,
        outputPricePer1k: 0,
        capabilities: ['chat'],
        enabled: true,
      },
      {
        id: 'local/second',
        provider: 'local',
        name: 'Second',
        contextWindow: 8192,
        inputPricePer1k: 0,
        outputPricePer1k: 0,
        capabilities: ['chat'],
        enabled: true,
      },
    ],
  };
}

function atlasWith(provider: ProviderConfig): never {
  return {
    modelRouter: {
      listProviders: () => [provider],
    },
    isProviderConfigured: vi.fn().mockResolvedValue(true),
  } as never;
}

describe('model sidebar visibility preferences', () => {
  it('sanitizes, bounds, and deduplicates stored entries', () => {
    const validProvider = { kind: 'provider', providerId: ' openai ' };
    const state = new MemoryState(new Map([
      [MODEL_SIDEBAR_HIDDEN_ENTRIES_KEY, [
        validProvider,
        { kind: 'provider', providerId: 'openai' },
        { kind: 'model', providerId: 'openai', modelId: 'gpt-5' },
        { kind: 'bridge', vendorId: 'anthropic', agentId: 'claude' },
        { kind: 'model', providerId: 'openai', modelId: 'un\nsafe' },
        { kind: 'unknown', providerId: 'ignored' },
        null,
      ]],
    ]));

    const entries = readHiddenModelSidebarEntries(state);

    expect(entries).toEqual([
      { kind: 'provider', providerId: 'openai' },
      { kind: 'model', providerId: 'openai', modelId: 'gpt-5' },
      { kind: 'bridge', vendorId: 'anthropic', agentId: 'claude' },
    ]);
    expect(isModelSidebarProviderHidden(entries, 'openai')).toBe(true);
    expect(isModelSidebarModelHidden(entries, 'openai', 'gpt-5')).toBe(true);
    expect(isModelSidebarBridgeHidden(entries, 'anthropic', 'claude')).toBe(true);
  });

  it('adds one preference and restores only an exact host-stored key', async () => {
    const state = new MemoryState();
    const entry = { kind: 'model', providerId: 'local', modelId: 'local/qwen:7b' } as const;

    await hideModelSidebarEntry(state, entry);
    await hideModelSidebarEntry(state, entry);
    expect(readHiddenModelSidebarEntries(state)).toEqual([entry]);
    expect(state.update).toHaveBeenCalledTimes(1);

    expect(await restoreModelSidebarEntry(state, 'model:invented')).toBe(false);
    expect(state.update).toHaveBeenCalledTimes(1);

    expect(await restoreModelSidebarEntry(state, modelSidebarHiddenEntryKey(entry))).toBe(true);
    expect(readHiddenModelSidebarEntries(state)).toEqual([]);
    expect(state.update).toHaveBeenCalledTimes(2);
  });

  it('filters hidden providers without changing provider enablement', async () => {
    const provider = localProvider();
    const state = new MemoryState(new Map([
      [MODEL_SIDEBAR_HIDDEN_ENTRIES_KEY, [{ kind: 'provider', providerId: provider.id }]],
    ]));
    const tree = new ModelsTreeProvider(atlasWith(provider), state);

    const rows = await tree.getChildren();

    expect(provider.enabled).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toBeInstanceOf(ModelProviderTreeItem);
    expect(String(rows[0]?.label)).toContain('All providers are hidden');
    expect((rows[0] as { command?: unknown }).command).toEqual({
      command: 'atlasmind.openSettings',
      title: 'Open Models & Integrations Settings',
      arguments: [{ page: 'models', section: 'modelSidebarVisibilityCard' }],
    });
  });

  it('filters only the selected model under a visible provider', async () => {
    const provider = localProvider();
    const state = new MemoryState(new Map([
      [MODEL_SIDEBAR_HIDDEN_ENTRIES_KEY, [
        { kind: 'model', providerId: provider.id, modelId: 'local/first' },
      ]],
    ]));
    const tree = new ModelsTreeProvider(atlasWith(provider), state);
    const rootRows = await tree.getChildren();
    const providerRow = rootRows[0];

    expect(providerRow).toBeInstanceOf(ModelProviderTreeItem);
    const modelRows = await tree.getChildren(providerRow);
    expect(modelRows).toHaveLength(1);
    expect(modelRows[0]).toBeInstanceOf(ModelTreeItem);
    expect((modelRows[0] as ModelTreeItem).modelId).toBe('local/second');
  });
});
