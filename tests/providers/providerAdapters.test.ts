import { describe, expect, it } from 'vitest';
import { LocalEchoAdapter, ProviderRegistry } from '../../src/providers/index.ts';
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
