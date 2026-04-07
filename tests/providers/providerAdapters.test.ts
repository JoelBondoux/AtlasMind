import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicAdapter, ClaudeCliAdapter, LocalEchoAdapter, OpenAiCompatibleAdapter, ProviderRegistry } from '../../src/providers/index.ts';
import type { CompletionRequest } from '../../src/providers/adapter.ts';

function makeRequest(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
  return {
    model: 'local/echo-1',
    messages: [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello world' },
    ],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LocalEchoAdapter', () => {
  it('echoes the last user message', async () => {
    const adapter = new LocalEchoAdapter();
    const result = await adapter.complete(makeRequest());
    expect(result.content).toContain('Hello world');
    expect(result.model).toBe('local/echo-1');
    expect(result.finishReason).toBe('stop');
  });

  it('returns the request model in the response', async () => {
    const adapter = new LocalEchoAdapter();
    const result = await adapter.complete(makeRequest({ model: 'local/custom' }));
    expect(result.model).toBe('local/custom');
  });

  it('estimates non-zero tokens', async () => {
    const adapter = new LocalEchoAdapter();
    const result = await adapter.complete(makeRequest());
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
  });

  it('handles messages with no user message gracefully', async () => {
    const adapter = new LocalEchoAdapter();
    const result = await adapter.complete(makeRequest({
      messages: [{ role: 'system', content: 'system only' }],
    }));
    expect(result.content).toContain('Local adapter response');
    expect(result.finishReason).toBe('stop');
  });

  it('lists a single echo model', async () => {
    const adapter = new LocalEchoAdapter();
    const models = await adapter.listModels();
    expect(models).toEqual(['local/echo-1']);
  });

  it('always passes health check', async () => {
    const adapter = new LocalEchoAdapter();
    expect(await adapter.healthCheck()).toBe(true);
  });

  it('keeps the built-in echo fallback even when a local endpoint is configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new LocalEchoAdapter({
      getBaseUrl: () => 'http://127.0.0.1:11434/v1',
    });

    const result = await adapter.complete(makeRequest({ model: 'local/echo-1' }));

    expect(result.content).toContain('Hello world');
    expect(result.model).toBe('local/echo-1');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ProviderRegistry', () => {
  it('registers and retrieves a provider', () => {
    const registry = new ProviderRegistry();
    const adapter = new LocalEchoAdapter();
    registry.register(adapter);
    expect(registry.get('local')).toBe(adapter);
  });

  it('returns undefined for unregistered provider', () => {
    const registry = new ProviderRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('lists all registered providers', () => {
    const registry = new ProviderRegistry();
    registry.register(new LocalEchoAdapter());
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]?.providerId).toBe('local');
  });

  it('overwrites a provider with the same id', () => {
    const registry = new ProviderRegistry();
    const first = new LocalEchoAdapter();
    const second = new LocalEchoAdapter();
    registry.register(first);
    registry.register(second);
    expect(registry.get('local')).toBe(second);
    expect(registry.list()).toHaveLength(1);
  });
});

describe('ClaudeCliAdapter', () => {
  it('runs Claude CLI print mode and normalizes the response model', async () => {
    const runCommand = vi.fn()
      .mockResolvedValueOnce({ command: 'claude.cmd', exitCode: 0, stdout: '1.0.0', stderr: '' })
      .mockResolvedValueOnce({ command: 'claude.cmd', exitCode: 0, stdout: JSON.stringify({ account: { plan: 'pro' } }), stderr: '' })
      .mockResolvedValueOnce({
        command: 'claude.cmd',
        exitCode: 0,
        stdout: JSON.stringify({
          model: 'sonnet',
          content: [{ type: 'text', text: 'Claude CLI reply' }],
          usage: { input_tokens: 12, output_tokens: 5 },
        }),
        stderr: '',
      });

    const adapter = new ClaudeCliAdapter({ runCommand });
    const result = await adapter.complete(makeRequest({ model: 'claude-cli/sonnet' }));

    expect(result.content).toBe('Claude CLI reply');
    expect(result.model).toBe('claude-cli/sonnet');
    expect(result.inputTokens).toBe(12);
    expect(result.outputTokens).toBe(5);
    expect(runCommand).toHaveBeenLastCalledWith(
      expect.arrayContaining(['--print', '--output-format', 'json', '--model', 'sonnet']),
      expect.any(Object),
    );
  });

  it('returns no models when the CLI is not authenticated', async () => {
    const runCommand = vi.fn()
      .mockResolvedValueOnce({ command: 'claude.cmd', exitCode: 0, stdout: '1.0.0', stderr: '' })
      .mockResolvedValueOnce({ command: 'claude.cmd', exitCode: 1, stdout: '', stderr: 'not logged in' });

    const adapter = new ClaudeCliAdapter({ runCommand });
    expect(await adapter.listModels()).toEqual([]);
    expect(await adapter.healthCheck()).toBe(false);
  });
});

describe('multimodal provider payloads', () => {
  it('serializes user images for OpenAI-compatible providers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'gpt-4.1-mini',
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      }),
      text: async () => '',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenAiCompatibleAdapter(
      {
        providerId: 'openai',
        compatibilityMode: 'openai-modern-chat',
        baseUrl: 'https://example.test/v1',
        secretKey: 'test',
        displayName: 'OpenAI',
      },
      { get: vi.fn().mockResolvedValue('secret') } as never,
    );

    await adapter.complete(makeRequest({
      model: 'openai/gpt-4.1-mini',
      messages: [
        { role: 'user', content: 'Look at this', images: [{ source: 'media/mockup.png', mimeType: 'image/png', dataBase64: 'abc123' }] },
      ],
    }));

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const payload = JSON.parse(init.body);
    expect(payload.messages[0].content[1].image_url.url).toBe('data:image/png;base64,abc123');
    expect(payload.max_completion_tokens).toBe(1024);
    expect(payload).not.toHaveProperty('max_tokens');
  });

  it('uses developer role and modern token field for OpenAI chat requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'gpt-5.4',
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      }),
      text: async () => '',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenAiCompatibleAdapter(
      {
        providerId: 'openai',
        compatibilityMode: 'openai-modern-chat',
        baseUrl: 'https://example.test/v1',
        secretKey: 'test',
        displayName: 'OpenAI',
      },
      { get: vi.fn().mockResolvedValue('secret') } as never,
    );

    await adapter.complete(makeRequest({ model: 'openai/gpt-5.4' }));

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const payload = JSON.parse(init.body);
    expect(payload.messages[0].role).toBe('developer');
    expect(payload.max_completion_tokens).toBe(1024);
    expect(payload).not.toHaveProperty('max_tokens');
    expect(payload).not.toHaveProperty('temperature');
  });

  it('keeps temperature for OpenAI modern models that still support it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'gpt-4.1-mini',
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      }),
      text: async () => '',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenAiCompatibleAdapter(
      {
        providerId: 'openai',
        compatibilityMode: 'openai-modern-chat',
        baseUrl: 'https://example.test/v1',
        secretKey: 'test',
        displayName: 'OpenAI',
      },
      { get: vi.fn().mockResolvedValue('secret') } as never,
    );

    await adapter.complete(makeRequest({ model: 'openai/gpt-4.1-mini' }));

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const payload = JSON.parse(init.body);
    expect(payload.temperature).toBe(0.2);
  });

  it('serializes user images for Anthropic providers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'claude-sonnet-4',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 12, output_tokens: 4 },
      }),
      text: async () => '',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new AnthropicAdapter({ get: vi.fn().mockResolvedValue('secret') } as never);

    await adapter.complete(makeRequest({
      model: 'anthropic/claude-sonnet-4',
      messages: [
        { role: 'user', content: 'Inspect this image', images: [{ source: 'media/mockup.png', mimeType: 'image/png', dataBase64: 'abc123' }] },
      ],
    }));

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const payload = JSON.parse(init.body);
    expect(payload.messages[0].content[1]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'abc123',
      },
    });
  });

  it('supports static model catalogs for non-standard OpenAI-compatible providers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'sonar',
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      }),
      text: async () => '',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenAiCompatibleAdapter(
      {
        providerId: 'perplexity',
        baseUrl: 'https://api.perplexity.ai/v1',
        secretKey: 'test',
        displayName: 'Perplexity',
        chatCompletionsPath: '/sonar',
        modelsPath: null,
        staticModels: ['sonar', 'sonar-pro'],
      },
      { get: vi.fn().mockResolvedValue('secret') } as never,
    );

    const models = await adapter.listModels();
    expect(models).toEqual(['perplexity/sonar', 'perplexity/sonar-pro']);

    await adapter.complete(makeRequest({ model: 'perplexity/sonar' }));

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.perplexity.ai/v1/sonar');
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as Record<string, unknown>;
    const messages = body['messages'] as Array<Record<string, unknown>>;
    expect(messages[0]?.['role']).toBe('system');
    expect(body['max_tokens']).toBe(1024);
    expect(body).not.toHaveProperty('max_completion_tokens');
  });

  it('supports dynamic Azure-style base URLs, auth headers, and deployment-backed model lists', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'gpt-4o',
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      }),
      text: async () => '',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenAiCompatibleAdapter(
      {
        providerId: 'azure',
        compatibilityMode: 'openai-modern-chat',
        baseUrl: 'https://placeholder.openai.azure.com',
        resolveBaseUrl: () => 'https://workspace-resource.openai.azure.com',
        resolveChatCompletionsPath: requestModel => `/openai/deployments/${requestModel.split('/').slice(1).join('/')}/chat/completions?api-version=2024-10-21`,
        secretKey: 'test',
        displayName: 'Azure OpenAI',
        authHeaderName: 'api-key',
        authScheme: 'raw',
        modelsPath: null,
        modelListProvider: () => ['gpt-4o', 'gpt-4.1-mini'],
      },
      { get: vi.fn().mockResolvedValue('azure-secret') } as never,
    );

    const models = await adapter.listModels();
    expect(models).toEqual(['azure/gpt-4o', 'azure/gpt-4.1-mini']);

    await adapter.complete(makeRequest({ model: 'azure/gpt-4o' }));

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://workspace-resource.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ 'api-key': 'azure-secret' }),
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as Record<string, unknown>;
    const messages = body['messages'] as Array<Record<string, unknown>>;
    expect(messages[0]?.['role']).toBe('developer');
    expect(body['max_completion_tokens']).toBe(1024);
    expect(body).not.toHaveProperty('max_tokens');
    expect(body.temperature).toBe(0.2);
  });

  it('normalizes raw Google model ids returned by discovery and completions', async () => {
    const fetchMock = vi.fn((input: string) => {
      if (input.endsWith('/models')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [{ id: 'models/gemini-2.5-pro' }],
          }),
          text: async () => '',
          headers: { get: () => null },
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({
          model: 'models/gemini-2.5-pro',
          choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
        }),
        text: async () => '',
        headers: { get: () => null },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenAiCompatibleAdapter(
      {
        providerId: 'google',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        secretKey: 'test',
        displayName: 'Google Gemini',
      },
      { get: vi.fn().mockResolvedValue('secret') } as never,
    );

    const models = await adapter.listModels();
    expect(models).toEqual(['google/gemini-2.5-pro']);

    const result = await adapter.complete(makeRequest({ model: 'google/gemini-2.5-pro' }));
    expect(result.model).toBe('google/gemini-2.5-pro');
  });
});
