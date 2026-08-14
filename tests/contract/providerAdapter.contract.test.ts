import { describe, it, expect } from 'vitest';
import type { SecretStore } from '../../src/runtime/secrets.js';
import type { ProviderAdapter } from '../../src/providers/adapter.js';
import {
  AnthropicAdapter,
  BedrockAdapter,
  CopilotAdapter,
  LocalEchoAdapter,
  OpenAiCompatibleAdapter,
  OpenRouterAdapter,
  ProviderRegistry,
} from '../../src/providers/index.js';

/**
 * The provider contract, checked against every adapter rather than trusted.
 *
 * `implements ProviderAdapter` is checked at the class declaration and nowhere
 * else. Two things it cannot see: an adapter that is written but never reaches
 * the barrel export, and an *optional* member (`streamComplete`,
 * `discoverModels`) declared with the wrong arity — TypeScript is happy with a
 * zero-argument `streamComplete`, and the Orchestrator calling it with a chunk
 * callback would then silently stream nothing. Both fail here instead.
 *
 * Nothing in this file reaches the network. Every adapter is constructed with a
 * secret store that returns nothing, and only the shape is read — a contract
 * test asks whether the seam is the declared shape, not whether the far side
 * answers. `lensReachability` is where "did it answer" is modelled, and merging
 * the two questions is how an offline laptop reports every provider as broken.
 */

const NO_SECRETS: SecretStore = {
  get: async () => undefined,
  store: async () => undefined,
  delete: async () => undefined,
};

/** Every adapter the barrel publishes, constructed without touching a network. */
const ADAPTERS: ReadonlyArray<{ label: string; adapter: ProviderAdapter }> = [
  { label: 'anthropic', adapter: new AnthropicAdapter(NO_SECRETS) },
  { label: 'openrouter', adapter: new OpenRouterAdapter(NO_SECRETS) },
  { label: 'copilot', adapter: new CopilotAdapter() },
  { label: 'local-echo', adapter: new LocalEchoAdapter() },
  {
    label: 'openai-compatible',
    adapter: new OpenAiCompatibleAdapter(
      { providerId: 'openai', apiKeySecret: 'atlasmind.openai.apiKey', baseUrl: 'https://example.invalid/v1' } as never,
      NO_SECRETS,
    ),
  },
  { label: 'bedrock', adapter: new BedrockAdapter({ get: async () => undefined } as never) },
];

/** Members every adapter must have, with the arity the Orchestrator calls them at. */
const REQUIRED_METHODS: ReadonlyArray<{ name: 'complete' | 'listModels' | 'healthCheck'; arity: number }> = [
  { name: 'complete', arity: 1 },
  { name: 'listModels', arity: 0 },
  { name: 'healthCheck', arity: 0 },
];

/**
 * Optional members, and the arity they must have *when present*.
 *
 * The arity is the point. An adapter may decline to implement `streamComplete`;
 * what it may not do is implement it with a signature the caller does not use.
 */
const OPTIONAL_METHODS: ReadonlyArray<{ name: 'streamComplete' | 'discoverModels'; arity: number }> = [
  { name: 'streamComplete', arity: 2 },
  { name: 'discoverModels', arity: 0 },
];

describe('provider adapter contract', () => {
  for (const { label, adapter } of ADAPTERS) {
    describe(label, () => {
      it('declares a non-empty providerId', () => {
        expect(typeof adapter.providerId).toBe('string');
        expect(adapter.providerId.trim().length).toBeGreaterThan(0);
      });

      for (const { name, arity } of REQUIRED_METHODS) {
        it(`implements ${name}() with ${arity} declared parameter(s)`, () => {
          const member = adapter[name];
          expect(typeof member).toBe('function');
          expect((member as (...args: unknown[]) => unknown).length).toBe(arity);
        });
      }

      for (const { name, arity } of OPTIONAL_METHODS) {
        it(`declares ${name}() with the caller's arity, or not at all`, () => {
          const member = adapter[name];
          if (member === undefined) {
            return;
          }
          expect(typeof member).toBe('function');
          expect((member as (...args: unknown[]) => unknown).length).toBe(arity);
        });
      }
    });
  }

  it('gives every adapter a distinct providerId', () => {
    const ids = ADAPTERS.map(entry => entry.adapter.providerId);
    // A duplicate is silent and total: `register()` is a Map set, so the second
    // adapter replaces the first and every request for the first provider is
    // answered by the wrong one.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns from the registry the same adapter that was registered', () => {
    const registry = new ProviderRegistry();
    for (const { adapter } of ADAPTERS) {
      registry.register(adapter);
    }
    for (const { adapter } of ADAPTERS) {
      expect(registry.get(adapter.providerId)).toBe(adapter);
    }
  });

  it('has no adapter for a provider that was never registered', () => {
    // The failover path depends on this being undefined rather than a stub: an
    // unregistered provider must be unreachable, not silently answered.
    expect(new ProviderRegistry().get('not-a-provider')).toBeUndefined();
  });
});
