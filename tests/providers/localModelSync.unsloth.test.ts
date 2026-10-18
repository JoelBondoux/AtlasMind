import { describe, expect, it } from 'vitest';

import { refreshUnslothRows, syncLocalModels, syncUnsloth, type LocalModelSyncResult } from '../../src/providers/localModelSync.js';
import { LocalEchoAdapter } from '../../src/providers/registry.js';
import { UNSLOTH_ROUTING_RULES } from '../../src/providers/unslothStudio.js';
import type { SecretStore } from '../../src/runtime/secrets.js';
import type { FetchLike } from '../../src/providers/localRuntimeClient.js';

const ORIGIN = 'http://127.0.0.1:8888';
const KEY = `sk-unsloth-${'cd'.repeat(16)}`;

function studio(routes: Record<string, unknown>): FetchLike {
  return async (url: string) => {
    const path = url.slice(ORIGIN.length);
    if (!(path in routes)) {
      return { ok: false, status: 404, json: async () => ({}), text: async () => '{}' };
    }
    const text = JSON.stringify(routes[path]);
    return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
  };
}

const LIVE = { service: 'Unsloth UI Backend' };

describe('what Unsloth Studio has installed', () => {
  it('lists downloads by repository id and marks the loaded ones, with or without a quant suffix', async () => {
    const models = await syncUnsloth({
      origin: ORIGIN,
      getApiKey: () => KEY,
      fetch: studio({
        '/api/liveness': LIVE,
        '/api/models/cached-gguf': {
          cached: [
            { repo_id: 'unsloth/Qwen3-14B-GGUF', size_bytes: 9_000_000_000, has_vision: false },
            { repo_id: 'unsloth/gemma-4-12b-it-GGUF', size_bytes: 8_000_000_000, has_vision: true, partial: true },
          ],
        },
        '/api/inference/status': { loaded: ['unsloth/Qwen3-14B-GGUF:Q4_K_M'], serving: [] },
      }),
    });
    expect(models!.map(model => [model.id, model.runtime, model.loaded, model.partial ?? false])).toEqual([
      ['unsloth/Qwen3-14B-GGUF', 'unsloth', true, false],
      ['unsloth/gemma-4-12b-it-GGUF', 'unsloth', false, true],
    ]);
    expect(models![1].capabilities).toContain('vision');
  });

  it('does not claim nothing is loaded when the status could not be read', async () => {
    const models = await syncUnsloth({
      origin: ORIGIN,
      getApiKey: () => KEY,
      fetch: studio({ '/api/liveness': LIVE, '/api/models/cached-gguf': { cached: [{ repo_id: 'unsloth/A-GGUF' }] } }),
    });
    expect(models).toHaveLength(1);
    expect(models![0]).not.toHaveProperty('loaded');
    // No load state, so no claim about whether it is routable either.
    expect(models![0]).not.toHaveProperty('routingRule');
  });

  it('says it could not read Studio, rather than that nothing is downloaded', async () => {
    const models = await syncUnsloth({ origin: ORIGIN, getApiKey: () => KEY, fetch: studio({ '/api/liveness': LIVE }) });
    expect(models).toBeUndefined();
  });

  it('marks each download with the routing rule the adapter applies', async () => {
    const models = await syncUnsloth({
      origin: ORIGIN,
      getApiKey: () => KEY,
      fetch: studio({
        '/api/liveness': LIVE,
        '/api/models/cached-gguf': { cached: [{ repo_id: 'unsloth/A-GGUF' }, { repo_id: 'unsloth/B-GGUF' }] },
        '/api/inference/status': { loaded: ['unsloth/A-GGUF'], serving: [] },
        '/api/settings/openai-auto-switch': { enabled: false },
      }),
    });
    expect(models!.map(model => [model.id, model.routingRule])).toEqual([
      ['unsloth/A-GGUF', 'loaded'],
      ['unsloth/B-GGUF', 'not-loaded-switch-off'],
    ]);
  });

  it('replaces cached Studio rows with a live reading, and drops their load claims when it fails', async () => {
    const cached: LocalModelSyncResult = {
      syncedAt: new Date().toISOString(),
      reachableEndpoints: [],
      models: [
        { id: 'qwen3:14b', name: 'qwen3', runtime: 'ollama', contextWindow: 1, capabilities: ['chat'] },
        { id: 'unsloth/A-GGUF', name: 'A-GGUF', runtime: 'unsloth', contextWindow: 1, capabilities: ['chat'], loaded: true, routingRule: 'loaded' },
      ],
    };
    const live = await refreshUnslothRows(cached, {
      origin: ORIGIN,
      getApiKey: () => KEY,
      fetch: studio({
        '/api/liveness': LIVE,
        '/api/models/cached-gguf': { cached: [{ repo_id: 'unsloth/A-GGUF' }] },
        '/api/inference/status': { loaded: [], serving: [] },
        '/api/settings/openai-auto-switch': { enabled: false },
      }),
    });
    expect(live.models.map(model => [model.id, model.routingRule])).toEqual([
      ['qwen3:14b', undefined],
      ['unsloth/A-GGUF', 'not-loaded-switch-off'],
    ]);

    const failed = await refreshUnslothRows(cached, { origin: ORIGIN, getApiKey: () => KEY, fetch: studio({}) });
    const row = failed.models.find(model => model.runtime === 'unsloth');
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty('loaded');
    expect(row).not.toHaveProperty('routingRule');
  });

  it('counts Studio as reachable only when it answered, and never probes it unconfigured', async () => {
    const result = await syncLocalModels('http://127.0.0.1:1', 'http://127.0.0.1:2', {
      origin: ORIGIN,
      getApiKey: () => KEY,
      fetch: studio({ '/api/liveness': LIVE, '/api/models/cached-gguf': { cached: [{ repo_id: 'unsloth/A-GGUF' }] } }),
    });
    expect(result.reachableEndpoints).toContain(ORIGIN);
    expect(result.models.some(model => model.runtime === 'unsloth')).toBe(true);

    const withoutStudio = await syncLocalModels('http://127.0.0.1:1', 'http://127.0.0.1:2');
    expect(withoutStudio.reachableEndpoints).not.toContain(ORIGIN);
  });
});

describe('the advisor and the routed model list agree about every Studio model', () => {
  it('routes exactly the models the advisor marks routable, for each Studio setting', async () => {
    const repos = ['unsloth/A-GGUF', 'unsloth/B-GGUF', 'unsloth/C-GGUF'];
    for (const [switchByRequest, loadedIds] of [
      [false, []], [false, ['unsloth/B-GGUF']], [true, []], [true, ['unsloth/A-GGUF']], [undefined, ['unsloth/C-GGUF']],
    ] as Array<[boolean | undefined, string[]]>) {
      const routes: Record<string, unknown> = {
        '/api/liveness': LIVE,
        '/api/models/cached-gguf': { cached: repos.map(repo_id => ({ repo_id })) },
        '/api/inference/status': { loaded: loadedIds, serving: [] },
        '/v1/models': { data: repos.map(id => ({ id, owned_by: 'unsloth-studio', loaded: loadedIds.includes(id) })) },
        ...(switchByRequest === undefined ? {} : { '/api/settings/openai-auto-switch': { enabled: switchByRequest } }),
      };
      const fetchLike = studio(routes);

      const advisor = await syncUnsloth({ origin: ORIGIN, getApiKey: () => KEY, fetch: fetchLike });
      const advisorRoutable = advisor!
        .filter(model => UNSLOTH_ROUTING_RULES.find(rule => rule.id === model.routingRule)?.routable)
        .map(model => model.id)
        .sort();

      const original = globalThis.fetch;
      globalThis.fetch = fetchLike as unknown as typeof fetch;
      try {
        const adapter = new LocalEchoAdapter({
          secrets: { get: async () => KEY } as unknown as SecretStore,
          getEndpoints: () => [{ id: 'unsloth-studio', label: 'Unsloth Studio', baseUrl: `${ORIGIN}/v1`, runtime: 'unsloth' }],
        });
        const routed = (await adapter.listModels())
          .filter(id => id !== 'local/echo-1')
          .map(id => id.replace('local/unsloth-studio@@', ''))
          .sort();
        expect(routed, `switchByRequest=${String(switchByRequest)} loaded=${loadedIds.join(',')}`).toEqual(advisorRoutable);
      } finally {
        globalThis.fetch = original;
      }
    }
  });
});
