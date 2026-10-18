import { describe, expect, it } from 'vitest';

import { syncLocalModels, syncUnsloth } from '../../src/providers/localModelSync.js';
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
    expect(models.map(model => [model.id, model.runtime, model.loaded, model.partial ?? false])).toEqual([
      ['unsloth/Qwen3-14B-GGUF', 'unsloth', true, false],
      ['unsloth/gemma-4-12b-it-GGUF', 'unsloth', false, true],
    ]);
    expect(models[1].capabilities).toContain('vision');
  });

  it('does not claim nothing is loaded when the status could not be read', async () => {
    const models = await syncUnsloth({
      origin: ORIGIN,
      getApiKey: () => KEY,
      fetch: studio({ '/api/liveness': LIVE, '/api/models/cached-gguf': { cached: [{ repo_id: 'unsloth/A-GGUF' }] } }),
    });
    expect(models).toHaveLength(1);
    expect(models[0]).not.toHaveProperty('loaded');
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
