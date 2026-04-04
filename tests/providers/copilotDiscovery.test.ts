import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => {
  const mockModels = [
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      vendor: 'copilot',
      family: 'gpt-4o',
      version: '2024-08-06',
      maxInputTokens: 128_000,
      sendRequest: vi.fn(),
      countTokens: vi.fn().mockResolvedValue(10),
    },
    {
      id: 'claude-sonnet-4',
      name: 'Claude Sonnet 4',
      vendor: 'copilot',
      family: 'claude-sonnet-4',
      version: '20250514',
      maxInputTokens: 200_000,
      sendRequest: vi.fn(),
      countTokens: vi.fn().mockResolvedValue(10),
    },
    {
      id: 'o4-mini',
      name: 'o4-mini',
      vendor: 'copilot',
      family: 'o4-mini',
      version: '2025-04-16',
      maxInputTokens: 200_000,
      sendRequest: vi.fn(),
      countTokens: vi.fn().mockResolvedValue(10),
    },
  ];

  return {
    lm: {
      selectChatModels: vi.fn().mockResolvedValue(mockModels),
    },
    LanguageModelTextPart: class { constructor(public value: string) {} },
    LanguageModelToolCallPart: class { constructor(public callId: string, public name: string, public input: object) {} },
    LanguageModelToolResultPart: class { constructor(public callId: string, public content: unknown[]) {} },
    LanguageModelChatMessage: {
      User: (content: unknown) => ({ role: 'user', content }),
      Assistant: (content: unknown) => ({ role: 'assistant', content }),
    },
  };
});

import { CopilotAdapter } from '../../src/providers/copilot.js';

describe('CopilotAdapter.discoverModels', () => {
  let adapter: CopilotAdapter;

  beforeEach(() => {
    adapter = new CopilotAdapter();
  });

  it('returns a DiscoveredModel for each available LM model', async () => {
    const discovered = await adapter.discoverModels();
    expect(discovered).toHaveLength(3);
  });

  it('includes copilot/ prefix in model IDs', async () => {
    const discovered = await adapter.discoverModels();
    for (const model of discovered) {
      expect(model.id).toMatch(/^copilot\//);
    }
  });

  it('extracts real context window from maxInputTokens', async () => {
    const discovered = await adapter.discoverModels();
    const gpt4o = discovered.find(m => m.id === 'copilot/gpt-4o');
    expect(gpt4o?.contextWindow).toBe(128_000);

    const claude = discovered.find(m => m.id === 'copilot/claude-sonnet-4');
    expect(claude?.contextWindow).toBe(200_000);
  });

  it('extracts display name from LM model', async () => {
    const discovered = await adapter.discoverModels();
    const gpt4o = discovered.find(m => m.id === 'copilot/gpt-4o');
    expect(gpt4o?.name).toBe('GPT-4o');
  });

  it('looks up catalog entries for known models', async () => {
    const discovered = await adapter.discoverModels();
    const claude = discovered.find(m => m.id === 'copilot/claude-sonnet-4');
    // Claude Sonnet 4 should be found in catalog
    expect(claude?.capabilities).toBeDefined();
    expect(claude?.capabilities).toContain('reasoning');
    expect(claude?.capabilities).toContain('vision');
  });

  it('includes pricing from catalog for known models', async () => {
    const discovered = await adapter.discoverModels();
    const gpt4o = discovered.find(m => m.id === 'copilot/gpt-4o');
    expect(gpt4o?.inputPricePer1k).toBeDefined();
    expect(gpt4o?.inputPricePer1k).toBeGreaterThan(0);
  });
});

describe('CopilotAdapter.listModels', () => {
  it('returns model IDs with copilot prefix', async () => {
    const adapter = new CopilotAdapter();
    const models = await adapter.listModels();
    expect(models).toEqual([
      'copilot/gpt-4o',
      'copilot/claude-sonnet-4',
      'copilot/o4-mini',
    ]);
  });
});
