import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createOllamaRuntimeClient,
  createLmStudioRuntimeClient,
  createRuntimeClientForEndpoint,
  detectRuntimeKind,
  runtimeOrigin,
  type FetchLike,
} from '../../src/providers/localRuntimeClient.js';

const timers = { setTimeout, clearTimeout };

/** Records every URL and body it is asked for, and replies with a script. */
function fakeFetch(script: Record<string, unknown>): FetchLike & { calls: Array<{ url: string; body?: string; method?: string }> } {
  const calls: Array<{ url: string; body?: string; method?: string }> = [];
  const fn = (async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, ...(init?.body ? { body: init.body } : {}), ...(init?.method ? { method: init.method } : {}) });
    if (!(url in script)) {
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => script[url], text: async () => JSON.stringify(script[url]) };
  }) as FetchLike & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}

describe('endpoint resolution', () => {
  it('derives the native API from the origin, not by appending to /v1', () => {
    // The failure this prevents: appending yields `/v1/api/ps`, a 404 that looks
    // exactly like "the runtime is not running" — which the degradation path
    // swallows, leaving the arbiter permanently blind and permanently calm.
    expect(runtimeOrigin('http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434');
    expect(runtimeOrigin('http://localhost:1234/v1')).toBe('http://localhost:1234');
    expect(runtimeOrigin('not a url')).toBeUndefined();
  });

  it('identifies both runtimes the user actually runs', () => {
    expect(detectRuntimeKind('http://127.0.0.1:11434/v1')).toBe('ollama');
    expect(detectRuntimeKind('http://localhost:1234/v1')).toBe('lmstudio');
  });

  it('treats an unrecognised port as unknown rather than guessing', () => {
    // Probing a stranger's HTTP server with an Ollama-shaped request is not
    // something to do speculatively.
    expect(detectRuntimeKind('http://localhost:9999/v1')).toBe('unknown');
    expect(createRuntimeClientForEndpoint('http://localhost:9999/v1')).toBeUndefined();
  });
});

describe('Ollama residency', () => {
  // Shaped exactly as the published /api/ps response.
  const psPayload = {
    models: [{
      name: 'qwen3:14b',
      model: 'qwen3:14b',
      size: 9_276_198_565,
      digest: 'abc',
      expires_at: '2026-08-12T14:38:31.837Z',
      size_vram: 10_100_000_000,
    }],
  };

  it('asks the sibling path and reads exact resident VRAM', async () => {
    const fetchLike = fakeFetch({ 'http://127.0.0.1:11434/api/ps': psPayload });
    const client = createOllamaRuntimeClient('http://127.0.0.1:11434', { fetch: fetchLike, timers });
    const reading = await client.listResident();

    expect(fetchLike.calls[0]!.url).toBe('http://127.0.0.1:11434/api/ps');
    expect(reading.reachable).toBe(true);
    expect(reading.models).toHaveLength(1);
    expect(reading.models[0]!.modelKey).toBe('qwen3:14b');
    expect(reading.models[0]!.vramBytes).toBe(10_100_000_000);
    expect(reading.models[0]!.totalBytes).toBe(9_276_198_565);
    expect(reading.models[0]!.expiresAtMs).toBe(Date.parse('2026-08-12T14:38:31.837Z'));
  });

  it('reports a CPU-only model as costing zero VRAM, not as unknown', () => {
    // `size_vram: 0` means loaded and running on the CPU. Charging it an
    // estimated footprint would reserve gigabytes that are not in use.
    const fetchLike = fakeFetch({
      'http://x/api/ps': { models: [{ model: 'm', size: 5e9, size_vram: 0 }] },
    });
    const client = createOllamaRuntimeClient('http://x', { fetch: fetchLike, timers });
    return client.listResident().then(reading => {
      expect(reading.models[0]!.vramBytes).toBe(0);
    });
  });

  it('distinguishes an empty runtime from an unreachable one', async () => {
    // Concluding the GPU is free because a runtime is down is the mistake this
    // flag exists to make impossible.
    const empty = createOllamaRuntimeClient('http://x', { fetch: fakeFetch({ 'http://x/api/ps': { models: [] } }), timers });
    expect((await empty.listResident()).reachable).toBe(true);

    const down = createOllamaRuntimeClient('http://x', { fetch: fakeFetch({}), timers });
    const reading = await down.listResident();
    expect(reading.reachable).toBe(false);
    expect(reading.models).toEqual([]);
  });

  it('unloads with keep_alive 0 on /api/chat and requires the runtime to confirm', async () => {
    const fetchLike = fakeFetch({ 'http://x/api/chat': { done_reason: 'unload' } });
    const client = createOllamaRuntimeClient('http://x', { fetch: fetchLike, timers });
    expect(await client.unload({ modelKey: 'qwen3:14b' })).toBe(true);

    const call = fetchLike.calls[0]!;
    expect(call.url).toBe('http://x/api/chat');
    expect(call.method).toBe('POST');
    expect(JSON.parse(call.body!)).toEqual({ model: 'qwen3:14b', messages: [], keep_alive: 0 });
  });

  it('treats an unconfirmed unload as failed', async () => {
    const client = createOllamaRuntimeClient('http://x', {
      fetch: fakeFetch({ 'http://x/api/chat': { done_reason: 'stop' } }), timers,
    });
    expect(await client.unload({ modelKey: 'm' })).toBe(false);
  });
});

describe('LM Studio residency', () => {
  // Shaped exactly as the live /api/v1/models response captured from the app.
  const modelsPayload = {
    models: [
      {
        key: 'qwen3-14b', display_name: 'Qwen3 14B', size_bytes: 9_000_000_000,
        quantization: { name: 'Q4_K_M', bits_per_weight: 4 },
        loaded_instances: [{ id: 'qwen3-14b:1', config: { context_length: 4096 } }],
        max_context_length: 131072,
      },
      {
        key: 'llama-guard-3-1b', display_name: 'Llama Guard 3 1B', size_bytes: 1_000_000_000,
        loaded_instances: [], max_context_length: 131072,
      },
    ],
  };

  it('reads only models with a loaded instance, from the /api/v1 path', async () => {
    const fetchLike = fakeFetch({ 'http://localhost:1234/api/v1/models': modelsPayload });
    const client = createLmStudioRuntimeClient('http://localhost:1234', { fetch: fetchLike, timers });
    const reading = await client.listResident();

    expect(fetchLike.calls[0]!.url).toBe('http://localhost:1234/api/v1/models');
    expect(reading.models).toHaveLength(1);
    expect(reading.models[0]!.modelKey).toBe('qwen3-14b');
    expect(reading.models[0]!.instanceId).toBe('qwen3-14b:1');
  });

  it('never reports the on-disk size as resident VRAM', async () => {
    // size_bytes is the blob on disk. Reporting it as vramBytes would make an
    // estimate indistinguishable from a measurement, which the budget relies on
    // being able to tell apart.
    const client = createLmStudioRuntimeClient('http://x', {
      fetch: fakeFetch({ 'http://x/api/v1/models': modelsPayload }), timers,
    });
    const reading = await client.listResident();
    expect(reading.models[0]!.vramBytes).toBeUndefined();
    expect(reading.models[0]!.totalBytes).toBe(9_000_000_000);
  });

  it('unloads by instance id and requires the runtime to echo it', async () => {
    const fetchLike = fakeFetch({ 'http://x/api/v1/models/unload': { instance_id: 'qwen3-14b:1' } });
    const client = createLmStudioRuntimeClient('http://x', { fetch: fetchLike, timers });
    expect(await client.unload({ modelKey: 'qwen3-14b', instanceId: 'qwen3-14b:1' })).toBe(true);
    expect(fetchLike.calls[0]!.url).toBe('http://x/api/v1/models/unload');
    expect(JSON.parse(fetchLike.calls[0]!.body!)).toEqual({ instance_id: 'qwen3-14b:1' });
  });

  it('does not accept a silent 200 as an unload confirmation', async () => {
    const client = createLmStudioRuntimeClient('http://x', {
      fetch: fakeFetch({ 'http://x/api/v1/models/unload': {} }), timers,
    });
    expect(await client.unload({ modelKey: 'm', instanceId: 'i' })).toBe(false);
  });
});

describe('robustness', () => {
  it('never throws on arbitrary runtime responses', async () => {
    // A residency probe that throws takes out the arbiter's only source of
    // truth, and the arbiter would then be blind rather than degraded.
    await fc.assert(fc.asyncProperty(fc.jsonValue(), async payload => {
      for (const [factory, path] of [
        [createOllamaRuntimeClient, '/api/ps'] as const,
        [createLmStudioRuntimeClient, '/api/v1/models'] as const,
      ]) {
        const client = factory('http://x', { fetch: fakeFetch({ [`http://x${path}`]: payload }), timers });
        const reading = await client.listResident();
        expect(Array.isArray(reading.models)).toBe(true);
        for (const model of reading.models) {
          expect(typeof model.modelKey).toBe('string');
          expect(model.modelKey.length).toBeGreaterThan(0);
          expect(model.vramBytes === undefined || model.vramBytes >= 0).toBe(true);
        }
      }
    }), { numRuns: 200 });
  });

  it('never throws when the transport itself fails', async () => {
    const exploding: FetchLike = async () => { throw new Error('ECONNREFUSED'); };
    const client = createOllamaRuntimeClient('http://x', { fetch: exploding, timers });
    await expect(client.listResident()).resolves.toEqual({ kind: 'ollama', models: [], reachable: false });
    await expect(client.unload({ modelKey: 'm' })).resolves.toBe(false);
  });
});
