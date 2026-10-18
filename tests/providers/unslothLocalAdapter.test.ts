import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LocalEchoAdapter,
  encodeLocalEndpointModelId,
  getConfiguredLocalEndpoints,
  inferLocalEndpointLabel,
  localEndpointApiKeySecret,
} from '../../src/providers/index.ts';
import type { CompletionRequest } from '../../src/providers/adapter.ts';
import type { SecretStore } from '../../src/runtime/secrets.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

const STUDIO_KEY = `sk-unsloth-${'ab'.repeat(16)}`;

function secrets(values: Record<string, string>): SecretStore {
  return {
    get: async (key: string) => values[key],
    store: async () => undefined,
    delete: async () => undefined,
  } as unknown as SecretStore;
}

function request(model: string): CompletionRequest {
  return { model, messages: [{ role: 'user', content: 'hi' }] };
}

interface Seen { url: string; body?: Record<string, unknown>; authorization?: string }

/** One OpenAI-shaped local server per base URL; records what each was sent. */
function stubServers(models: Record<string, unknown[]>): Seen[] {
  const seen: Seen[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
    seen.push({
      url,
      ...(init?.body ? { body: JSON.parse(init.body) as Record<string, unknown> } : {}),
      ...(init?.headers?.['Authorization'] ? { authorization: init.headers['Authorization'] } : {}),
    });
    const base = Object.keys(models).find(prefix => url.startsWith(prefix));
    if (base && url === `${base}/models`) {
      return { ok: true, status: 200, json: async () => ({ data: models[base] }), text: async (): Promise<string> => '' };
    }
    if (url.endsWith('/chat/completions')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'x', model: 'm', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
        text: async (): Promise<string> => '',
      };
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
  return seen;
}

describe('an Unsloth endpoint is asked to keep its own tools off', () => {
  it('adds enable_tools:false and mcp_enabled:false to a declared Unsloth endpoint, and to nothing else', async () => {
    const seen = stubServers({});
    const adapter = new LocalEchoAdapter({
      getEndpoints: () => [
        { id: 'studio', label: 'GPU box', baseUrl: 'http://127.0.0.1:9000/v1', runtime: 'unsloth' },
        { id: 'ollama', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1' },
      ],
    });
    await adapter.complete(request(encodeLocalEndpointModelId('studio', 'unsloth/A-GGUF')));
    await adapter.complete(request(encodeLocalEndpointModelId('ollama', 'qwen3:14b')));
    const [studio, ollama] = seen.filter(entry => entry.url.endsWith('/chat/completions'));
    expect(studio.body).toMatchObject({ enable_tools: false, mcp_enabled: false });
    expect(ollama.body).not.toHaveProperty('enable_tools');
    expect(ollama.body).not.toHaveProperty('mcp_enabled');
  });

  it('recognises an undeclared Studio on an unusual port from its own model listing', async () => {
    const seen = stubServers({
      'http://127.0.0.1:9000/v1': [
        { id: 'unsloth/A-GGUF', owned_by: 'unsloth-studio', loaded: true },
        { id: 'unsloth/B-GGUF', owned_by: 'unsloth-studio', loaded: false },
      ],
    });
    const adapter = new LocalEchoAdapter({
      getEndpoints: () => [{ id: 'box', label: 'GPU box', baseUrl: 'http://127.0.0.1:9000/v1' }],
    });
    const models = await adapter.listModels();
    // On disk but not in memory is not routable: routing to it would make Studio load it.
    expect(models).toEqual([encodeLocalEndpointModelId('box', 'unsloth/A-GGUF')]);
    await adapter.complete(request(models[0]));
    expect(seen.find(entry => entry.url.endsWith('/chat/completions'))?.body).toMatchObject({ enable_tools: false });
  });

  it('leaves a non-Unsloth listing exactly as it was, loaded:false included', async () => {
    stubServers({ 'http://127.0.0.1:11434/v1': [{ id: 'qwen3:14b', loaded: false }] });
    const adapter = new LocalEchoAdapter({ getEndpoints: () => [{ id: 'ollama', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1' }] });
    expect(await adapter.listModels()).toEqual([encodeLocalEndpointModelId('ollama', 'qwen3:14b')]);
  });
});

describe('an endpoint key stays with its endpoint', () => {
  it("sends Studio's own key to Studio and never to another endpoint", async () => {
    const seen = stubServers({});
    const adapter = new LocalEchoAdapter({
      secrets: secrets({ [localEndpointApiKeySecret('studio')!]: STUDIO_KEY }),
      getEndpoints: () => [
        { id: 'studio', label: 'Unsloth Studio', baseUrl: 'http://127.0.0.1:8888/v1', runtime: 'unsloth' },
        { id: 'ollama', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1' },
      ],
    });
    await adapter.complete(request(encodeLocalEndpointModelId('studio', 'unsloth/A-GGUF')));
    await adapter.complete(request(encodeLocalEndpointModelId('ollama', 'qwen3:14b')));
    const completions = seen.filter(entry => entry.url.endsWith('/chat/completions'));
    expect(completions[0].authorization).toBe(`Bearer ${STUDIO_KEY}`);
    expect(completions[1].authorization).toBeUndefined();
  });

  it('still falls back to the shared local key, as before', async () => {
    const seen = stubServers({});
    const adapter = new LocalEchoAdapter({
      secrets: secrets({ 'atlasmind.provider.local.apiKey': 'shared-key' }),
      getEndpoints: () => [{ id: 'ollama', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1' }],
    });
    await adapter.complete(request(encodeLocalEndpointModelId('ollama', 'qwen3:14b')));
    expect(seen.find(entry => entry.url.endsWith('/chat/completions'))?.authorization).toBe('Bearer shared-key');
  });

  it('names no secret for an id the normaliser could not have produced', () => {
    expect(localEndpointApiKeySecret('unsloth-studio')).toBe('atlasmind.provider.local.endpoint.unsloth-studio.apiKey');
    expect(localEndpointApiKeySecret('../anthropic')).toBeUndefined();
    expect(localEndpointApiKeySecret('Studio')).toBeUndefined();
  });
});

describe('endpoint configuration', () => {
  it('keeps a declared runtime and drops one it does not know', () => {
    const endpoints = getConfiguredLocalEndpoints({
      getEndpoints: () => [
        { id: 'studio', label: 'Studio', baseUrl: 'http://127.0.0.1:8888/v1', runtime: 'unsloth' },
        { id: 'other', label: 'Other', baseUrl: 'http://127.0.0.1:9000/v1', runtime: 'jupyter' },
      ],
    });
    expect(endpoints[0].runtime).toBe('unsloth');
    expect(endpoints[1]).not.toHaveProperty('runtime');
  });

  it("labels Studio's default address", () => {
    expect(inferLocalEndpointLabel('http://127.0.0.1:8888/v1')).toBe('Unsloth Studio');
  });
});
