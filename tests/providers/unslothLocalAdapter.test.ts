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
    // On disk but not in memory, and Studio's "Switch model by request" could
    // not be read, so Studio might refuse it: not routable, and reported.
    expect(models).toEqual([encodeLocalEndpointModelId('box', 'unsloth/A-GGUF')]);
    expect(adapter.describeHeldBackModels().map(entry => [entry.modelId, entry.rule]))
      .toEqual([['unsloth/B-GGUF', 'not-loaded-policy-unknown']]);
    await adapter.complete(request(models[0]));
    expect(seen.find(entry => entry.url.endsWith('/chat/completions'))?.body).toMatchObject({ enable_tools: false });
  });

  it('leaves a non-Unsloth listing exactly as it was, loaded:false included', async () => {
    stubServers({ 'http://127.0.0.1:11434/v1': [{ id: 'qwen3:14b', loaded: false }] });
    const adapter = new LocalEchoAdapter({ getEndpoints: () => [{ id: 'ollama', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1' }] });
    expect(await adapter.listModels()).toEqual([encodeLocalEndpointModelId('ollama', 'qwen3:14b')]);
  });
});

/**
 * A Studio as the user's was found: every model downloaded, none loaded, with
 * "Switch model by request" answering as given (or the settings route refusing).
 */
function stubStudio(options: { switchByRequest?: boolean; loadedIds?: string[] }): Seen[] {
  const seen: Seen[] = [];
  const base = 'http://127.0.0.1:8888';
  const listing = [
    { id: 'unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF', owned_by: 'unsloth-studio', quant: 'Q4_K_S' },
    { id: 'lmstudio-community/Qwen3.5-9B-GGUF', owned_by: 'unsloth-studio', quant: 'Q4_K_M' },
    { id: 'legraphista/Llama-Guard-3-8B-IMat-GGUF', owned_by: 'unsloth-studio', quant: 'Q4_K_S' },
  ].map(entry => ({ ...entry, loaded: options.loadedIds?.includes(entry.id) ?? false }));
  const reply = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async (): Promise<string> => JSON.stringify(body),
  });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
    seen.push({ url, ...(init?.headers?.['Authorization'] ? { authorization: init.headers['Authorization'] } : {}) });
    if (url === `${base}/v1/models`) { return reply(200, { object: 'list', data: listing }); }
    if (url === `${base}/api/liveness`) { return reply(200, { status: 'alive', service: 'Unsloth UI Backend' }); }
    if (url === `${base}/api/settings/openai-auto-switch`) {
      return options.switchByRequest === undefined
        ? reply(401, { detail: 'Not authenticated' })
        : reply(200, { enabled: options.switchByRequest, idle_unload_active: false });
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
  return seen;
}

function studioAdapter(withKey = true): LocalEchoAdapter {
  return new LocalEchoAdapter({
    ...(withKey ? { secrets: secrets({ [localEndpointApiKeySecret('unsloth-studio')!]: STUDIO_KEY }) } : {}),
    getEndpoints: () => [{ id: 'unsloth-studio', label: 'Unsloth Studio', baseUrl: 'http://127.0.0.1:8888/v1', runtime: 'unsloth' }],
  });
}

describe('a Studio model that is downloaded but not loaded', () => {
  it('is held back and reported, not silently dropped, while "Switch model by request" is off', async () => {
    stubStudio({ switchByRequest: false });
    const adapter = studioAdapter();
    // listModels falls back to the echo model when nothing local is routable.
    expect(await adapter.listModels()).toEqual(['local/echo-1']);
    const held = adapter.describeHeldBackModels();
    expect(held.map(entry => entry.modelId)).toEqual([
      'unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF',
      'lmstudio-community/Qwen3.5-9B-GGUF',
    ]);
    expect(held.every(entry => entry.rule === 'not-loaded-switch-off' && entry.endpointLabel === 'Unsloth Studio')).toBe(true);
  });

  it('does not report a non-chat model as held back — it is excluded for another reason', async () => {
    stubStudio({ switchByRequest: false });
    const adapter = studioAdapter();
    await adapter.listModels();
    expect(adapter.describeHeldBackModels().some(entry => entry.modelId.includes('Llama-Guard'))).toBe(false);
  });

  it('is routable when Studio will load it on request', async () => {
    stubStudio({ switchByRequest: true });
    const adapter = studioAdapter();
    expect(await adapter.listModels()).toEqual([
      encodeLocalEndpointModelId('unsloth-studio', 'unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF'),
      encodeLocalEndpointModelId('unsloth-studio', 'lmstudio-community/Qwen3.5-9B-GGUF'),
    ]);
    expect(adapter.describeHeldBackModels()).toEqual([]);
  });

  it('is held back, as policy unknown, when the setting cannot be read', async () => {
    stubStudio({});
    const adapter = studioAdapter();
    await adapter.listModels();
    expect(adapter.describeHeldBackModels().every(entry => entry.rule === 'not-loaded-policy-unknown')).toBe(true);
  });

  it('asks for the setting only after the identity check, and with the endpoint\'s own key', async () => {
    const seen = stubStudio({ switchByRequest: false });
    await studioAdapter().listModels();
    const order = seen.map(entry => entry.url.replace('http://127.0.0.1:8888', ''));
    expect(order.indexOf('/api/liveness')).toBeLessThan(order.indexOf('/api/settings/openai-auto-switch'));
    expect(seen.find(entry => entry.url.endsWith('/api/settings/openai-auto-switch'))?.authorization).toBe(`Bearer ${STUDIO_KEY}`);
  });

  it('does not ask for the setting when everything listed is already loaded', async () => {
    const seen = stubStudio({
      switchByRequest: false,
      loadedIds: ['unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF', 'lmstudio-community/Qwen3.5-9B-GGUF', 'legraphista/Llama-Guard-3-8B-IMat-GGUF'],
    });
    await studioAdapter().listModels();
    expect(seen.some(entry => entry.url.endsWith('/api/settings/openai-auto-switch'))).toBe(false);
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
