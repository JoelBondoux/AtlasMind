import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => {
  const copilotModels = [
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

  const githubModels = [
    {
      id: 'goldeneye',
      name: 'Goldeneye (Preview)',
      vendor: 'github',
      family: 'goldeneye',
      version: 'preview',
      maxInputTokens: 256_000,
      sendRequest: vi.fn(),
      countTokens: vi.fn().mockResolvedValue(10),
    },
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      vendor: 'github',
      family: 'gpt-4o',
      version: '2024-08-06',
      maxInputTokens: 128_000,
      sendRequest: vi.fn(),
      countTokens: vi.fn().mockResolvedValue(10),
    },
  ];

  const selectChatModels = vi.fn().mockImplementation(async (selector?: { vendor?: string }) => {
    if (!selector?.vendor) {
      return [...copilotModels, ...githubModels];
    }
    if (selector.vendor === 'github') {
      return githubModels;
    }
    if (selector.vendor === 'copilot') {
      return copilotModels;
    }
    return [];
  });

  return {
    lm: {
      selectChatModels,
    },
    CancellationTokenSource: class {
      token = { isCancellationRequested: false };
      cancel() {
        this.token.isCancellationRequested = true;
      }
      dispose() {
        return undefined;
      }
    },
    LanguageModelTextPart: class { constructor(public value: string) {} },
    LanguageModelToolCallPart: class { constructor(public callId: string, public name: string, public input: object) {} },
    LanguageModelToolResultPart: class { constructor(public callId: string, public content: unknown[]) {} },
    LanguageModelDataPart: class {
      static image(data: Uint8Array, mimeType: string) {
        return { kind: 'image', data, mimeType };
      }
    },
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
    expect(discovered).toHaveLength(4);
  });

  it('includes GitHub-backed preview models in the discovered catalog', async () => {
    const discovered = await adapter.discoverModels();
    expect(discovered.some(model => model.id === 'copilot/goldeneye')).toBe(true);
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
      'copilot/goldeneye',
    ]);
  });

  it('converts attached images into LanguageModelDataPart inputs', async () => {
    const adapter = new CopilotAdapter();
    const models = await import('vscode').then(module => module.lm.selectChatModels({ vendor: 'copilot' }));
    const model = models[0];
    model?.sendRequest.mockResolvedValue({
      stream: (async function* () {
        yield { value: 'ok' };
      })(),
    });

    await adapter.complete({
      model: 'copilot/gpt-4o',
      messages: [
        { role: 'user', content: 'Inspect this image', images: [{ source: 'media/mockup.png', mimeType: 'image/png', dataBase64: 'abc123' }] },
      ],
    });

    const [messages] = model?.sendRequest.mock.calls[0] ?? [];
    expect(Array.isArray(messages[0].content)).toBe(true);
    expect(messages[0].content[1]).toMatchObject({ kind: 'image', mimeType: 'image/png' });
  });
});
