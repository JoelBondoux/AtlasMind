import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  createUnslothStudioClient,
  describeUnslothFailure,
  isPlausibleUnslothApiKey,
  isValidGgufVariant,
  isValidHfRepoId,
  isValidLoadRequestId,
  isValidUnslothModelId,
  parseUnslothCachedGguf,
  parseUnslothLiveness,
  parseUnslothDeferredBody,
  parseUnslothDownloadProgress,
  parseUnslothGgufVariants,
  parseUnslothHubListing,
  parseUnslothStatus,
  repoIdFromCatalogTag,
  sanitizeUnslothDetail,
  suggestUnslothVariant,
  UNSLOTH_IDENTITY_TTL_MS,
  UNSLOTH_SERVER_TOOLS_OFF,
  UNSLOTH_STUDIO_SERVICE,
  UNSLOTH_VARIANT_RULES,
  variantFitsVram,
  type UnslothGgufVariant,
} from '../../src/providers/unslothStudio.js';
import type { FetchLike } from '../../src/providers/localRuntimeClient.js';

const ORIGIN = 'http://127.0.0.1:8888';
const KEY = `sk-unsloth-${'a1'.repeat(16)}`;
const GIB = 1024 ** 3;

interface Call { url: string; method?: string; headers?: Record<string, string>; body?: string }

/** Answers by path; records every request, headers included, so a leaked key is visible. */
function fakeStudio(routes: Record<string, { status?: number; body: unknown } | ((call: Call) => { status?: number; body: unknown })>): FetchLike & { calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const call: Call = { url, ...(init?.method ? { method: init.method } : {}), ...(init?.headers ? { headers: init.headers } : {}), ...(init?.body ? { body: init.body } : {}) };
    calls.push(call);
    const path = url.slice(ORIGIN.length).split('?')[0];
    const route = routes[path];
    if (!route) {
      return { ok: false, status: 404, json: async () => ({ detail: 'Not Found' }), text: async () => '{"detail":"Not Found"}' };
    }
    const answer = typeof route === 'function' ? route(call) : route;
    const status = answer.status ?? 200;
    const text = typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body);
    return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(text), text: async () => text };
  }) as FetchLike & { calls: Call[] };
  fn.calls = calls;
  return fn;
}

const LIVE = { body: { status: 'alive', service: UNSLOTH_STUDIO_SERVICE } };

function keyed(calls: Call[]): Call[] {
  return calls.filter(call => call.headers?.['Authorization'] !== undefined);
}

describe('input validation refuses rather than cleans', () => {
  it('accepts a Hugging Face owner/name and nothing else', () => {
    expect(isValidHfRepoId('unsloth/Qwen3-14B-GGUF')).toBe(true);
    expect(isValidHfRepoId('unsloth/Qwen3.8-27B-GGUF')).toBe(true);
    for (const bad of ['hf:unsloth/x', 'unsloth', 'a/b/c', '../etc/passwd', 'a/..', 'a b/c', 'https://huggingface.co/a/b', '-a/b', 'a/b-', '', 'a/b\n']) {
      expect(isValidHfRepoId(bad), bad).toBe(false);
    }
  });

  it('never accepts a string with more or fewer than one slash', () => {
    fc.assert(fc.property(fc.string(), value => {
      const slashes = value.split('/').length - 1;
      if (slashes !== 1) { expect(isValidHfRepoId(value)).toBe(false); }
    }));
  });

  it('accepts quant labels Studio loads by', () => {
    for (const quant of ['Q4_K_M', 'UD-Q4_K_XL', 'IQ2_XXS', 'BF16', 'Q8_0']) { expect(isValidGgufVariant(quant), quant).toBe(true); }
    for (const bad of ['', 'Q4 K M', '../Q4', 'Q4/K', '-Q4']) { expect(isValidGgufVariant(bad), bad).toBe(false); }
  });

  it('recognises the key shape Studio mints and nothing that merely looks like a key', () => {
    expect(isPlausibleUnslothApiKey(KEY)).toBe(true);
    expect(isPlausibleUnslothApiKey('sk-ant-api03-abcdefghijklmnopqrstuvwxyz')).toBe(false);
    expect(isPlausibleUnslothApiKey('sk-unsloth-short')).toBe(false);
    expect(isPlausibleUnslothApiKey(`${KEY} `)).toBe(false);
  });

  it('takes only an exact service name as an identity', () => {
    expect(parseUnslothLiveness({ status: 'alive', service: UNSLOTH_STUDIO_SERVICE })).toEqual({ isUnsloth: true });
    for (const other of [{ service: 'unsloth ui backend' }, { service: `${UNSLOTH_STUDIO_SERVICE} ` }, { name: UNSLOTH_STUDIO_SERVICE }, 'Unsloth UI Backend', null, []]) {
      expect(parseUnslothLiveness(other).isUnsloth).toBe(false);
    }
  });

  it('accepts attempt ids and model ids only within bounds', () => {
    expect(isValidLoadRequestId('0b6f2a64-1c1e-4a39-8e8d-6f7e4b1d2c3a')).toBe(true);
    expect(isValidLoadRequestId('short')).toBe(false);
    expect(isValidLoadRequestId('has space here')).toBe(false);
    expect(isValidUnslothModelId('unsloth/A-GGUF:Q4_K_M')).toBe(true);
    expect(isValidUnslothModelId('   ')).toBe(false);
    expect(isValidUnslothModelId('line\nbreak')).toBe(false);
    expect(isValidUnslothModelId('x'.repeat(513))).toBe(false);
  });

  it('strips the catalogue prefixes and nothing more', () => {
    expect(repoIdFromCatalogTag('hf:unsloth/A-GGUF')).toBe('unsloth/A-GGUF');
    expect(repoIdFromCatalogTag('hf.co/unsloth/A-GGUF')).toBe('unsloth/A-GGUF');
    expect(repoIdFromCatalogTag('qwen3:14b')).toBe('qwen3:14b');
  });
});

describe('the key goes to Unsloth Studio and nowhere else', () => {
  it('sends nothing keyed when the port answers as something else (Jupyter shares 8888)', async () => {
    const fetchLike = fakeStudio({ '/api/liveness': { status: 404, body: '<html>Jupyter</html>' } });
    const client = createUnslothStudioClient(ORIGIN, { fetch: fetchLike, getApiKey: () => KEY });
    const status = await client.status();
    expect(status).toMatchObject({ ok: false, reason: 'not-unsloth' });
    expect(keyed(fetchLike.calls)).toEqual([]);
  });

  it('never sends the key unless liveness named Studio exactly', async () => {
    await fc.assert(fc.asyncProperty(fc.anything(), async liveness => {
      fc.pre(!(typeof liveness === 'object' && liveness !== null && (liveness as Record<string, unknown>)['service'] === UNSLOTH_STUDIO_SERVICE));
      const fetchLike = fakeStudio({
        '/api/liveness': { body: liveness === undefined ? 'null' : liveness },
        '/api/inference/status': { body: { loaded: [] } },
      });
      const client = createUnslothStudioClient(ORIGIN, { fetch: fetchLike, getApiKey: () => KEY });
      await client.status();
      await client.listDownloaded();
      await client.unloadModel('m');
      expect(keyed(fetchLike.calls)).toEqual([]);
    }), { numRuns: 60 });
  });

  it('asks for nothing that needs a key when none is stored', async () => {
    const fetchLike = fakeStudio({ '/api/liveness': LIVE });
    const client = createUnslothStudioClient(ORIGIN, { fetch: fetchLike, getApiKey: () => undefined });
    expect(await client.status()).toMatchObject({ ok: false, reason: 'no-key' });
    expect(fetchLike.calls.map(call => call.url)).toEqual([`${ORIGIN}/api/liveness`]);
  });

  it('reuses a confirmed identity for a while, then asks again', async () => {
    let now = 1_000;
    const fetchLike = fakeStudio({ '/api/liveness': LIVE, '/api/inference/status': { body: { loaded: [] } } });
    const client = createUnslothStudioClient(ORIGIN, { fetch: fetchLike, getApiKey: () => KEY, now: () => now });
    await client.status();
    await client.status();
    expect(fetchLike.calls.filter(call => call.url.endsWith('/api/liveness'))).toHaveLength(1);
    now += UNSLOTH_IDENTITY_TTL_MS + 1;
    await client.status();
    expect(fetchLike.calls.filter(call => call.url.endsWith('/api/liveness'))).toHaveLength(2);
  });

  it('reports a rejected key as unauthorised and re-checks identity next time', async () => {
    const fetchLike = fakeStudio({ '/api/liveness': LIVE, '/api/inference/status': { status: 401, body: { detail: 'Invalid API key' } } });
    const client = createUnslothStudioClient(ORIGIN, { fetch: fetchLike, getApiKey: () => KEY });
    expect(await client.status()).toMatchObject({ ok: false, reason: 'unauthorized', status: 401, detail: 'Invalid API key' });
    await client.status();
    expect(fetchLike.calls.filter(call => call.url.endsWith('/api/liveness'))).toHaveLength(2);
  });

  it('sends nothing at all for input that fails validation', async () => {
    const fetchLike = fakeStudio({ '/api/liveness': LIVE });
    const client = createUnslothStudioClient(ORIGIN, { fetch: fetchLike, getApiKey: () => KEY });
    expect(await client.downloadAndLoad({ repoId: '../x', variant: 'Q4_K_M', loadRequestId: 'attempt-0001' })).toMatchObject({ reason: 'invalid-input' });
    expect(await client.listVariants('a/b/c')).toMatchObject({ reason: 'invalid-input' });
    expect(await client.deleteDownload({ repoId: 'unsloth/A-GGUF', variant: 'Q4 K' })).toMatchObject({ reason: 'invalid-input' });
    expect(fetchLike.calls).toEqual([]);
  });
});

describe('a 200 is not a success', () => {
  it('reads a padded late failure as a refusal', () => {
    const padded = `${' '.repeat(40)}{"_deferred_error":{"status_code":409,"detail":"Download manager busy"}}`;
    expect(parseUnslothDeferredBody(padded)).toEqual({ ok: false, reason: 'refused', status: 409, detail: 'Download manager busy' });
  });

  it('reads a padded success as a success', () => {
    const padded = `   {"status":"loaded","model":"unsloth/A-GGUF"}`;
    expect(parseUnslothDeferredBody(padded)).toMatchObject({ ok: true, payload: { model: 'unsloth/A-GGUF' } });
  });

  it('treats an empty or non-JSON body as unreadable, never as done', () => {
    expect(parseUnslothDeferredBody('   ')).toMatchObject({ ok: false, reason: 'malformed' });
    expect(parseUnslothDeferredBody('<html>')).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('loads through the padded path end to end, sending the attempt id', async () => {
    const fetchLike = fakeStudio({
      '/api/liveness': LIVE,
      '/api/inference/load': { body: `    {"status":"loaded","model":"unsloth/A-GGUF","display_name":"A","evicted":["old-model"],"memory_warning":"tight"}` },
    });
    const client = createUnslothStudioClient(ORIGIN, { fetch: fetchLike, getApiKey: () => KEY });
    const result = await client.downloadAndLoad({ repoId: 'unsloth/A-GGUF', variant: 'Q4_K_M', loadRequestId: 'attempt-0001' });
    expect(result).toEqual({ ok: true, value: { model: 'unsloth/A-GGUF', displayName: 'A', evicted: ['old-model'], memoryWarning: 'tight' } });
    const load = fetchLike.calls.find(call => call.url.endsWith('/api/inference/load'));
    expect(JSON.parse(load?.body ?? '{}')).toEqual({ model_path: 'unsloth/A-GGUF', gguf_variant: 'Q4_K_M', load_request_id: 'attempt-0001' });
  });

  it('cancels only the named attempt', async () => {
    const fetchLike = fakeStudio({ '/api/liveness': LIVE, '/api/inference/unload': { body: { status: 'unloaded', model: 'unsloth/A-GGUF' } } });
    const client = createUnslothStudioClient(ORIGIN, { fetch: fetchLike, getApiKey: () => KEY });
    expect(await client.cancelLoad({ repoId: 'unsloth/A-GGUF', loadRequestId: 'attempt-0001' })).toEqual({ ok: true, value: undefined });
    const unload = fetchLike.calls.find(call => call.url.endsWith('/api/inference/unload'));
    expect(JSON.parse(unload?.body ?? '{}')).toEqual({ model_path: 'unsloth/A-GGUF', cancel_load_request_id: 'attempt-0001' });
  });

  it('does not count an unload Studio did not confirm', async () => {
    const fetchLike = fakeStudio({ '/api/liveness': LIVE, '/api/inference/unload': { body: {} } });
    const client = createUnslothStudioClient(ORIGIN, { fetch: fetchLike, getApiKey: () => KEY });
    expect(await client.unloadModel('unsloth/A-GGUF')).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('passes Studio\'s own refusal through when a loaded model is deleted', async () => {
    const fetchLike = fakeStudio({ '/api/liveness': LIVE, '/api/models/delete-cached': { status: 400, body: { detail: 'Unload the model before deleting' } } });
    const client = createUnslothStudioClient(ORIGIN, { fetch: fetchLike, getApiKey: () => KEY });
    expect(await client.deleteDownload({ repoId: 'unsloth/A-GGUF' })).toEqual({
      ok: false, reason: 'refused', status: 400, detail: 'Unload the model before deleting',
    });
    const call = fetchLike.calls.find(entry => entry.url.endsWith('/api/models/delete-cached'));
    expect(call?.method).toBe('DELETE');
    expect(JSON.parse(call?.body ?? '{}')).toEqual({ repo_id: 'unsloth/A-GGUF' });
  });
});

describe('parsing untrusted responses', () => {
  it('reads status without inventing fields', () => {
    expect(parseUnslothStatus({ active_model: 'A', loaded: ['A', 'A', 3, ''], serving: ['A'], loading: [] }))
      .toEqual({ activeModel: 'A', loaded: ['A'], serving: ['A'], loading: [] });
    expect(parseUnslothStatus('nope')).toBeUndefined();
  });

  it('keeps no host path and drops rows that could not be acted on by id', () => {
    const rows = parseUnslothCachedGguf({
      cached: [
        { repo_id: 'unsloth/A-GGUF', size_bytes: 5 * GIB, cache_path: 'C:\\Users\\me\\.cache\\hf', has_vision: true, last_modified: 1_700_000_000 },
        { repo_id: '../escape', size_bytes: 1 },
        { repo_id: 'unsloth/B-GGUF', partial: true },
        { repo_id: 'UNSLOTH/a-gguf' },
      ],
    });
    expect(rows).toEqual([
      { repoId: 'unsloth/A-GGUF', sizeBytes: 5 * GIB, hasVision: true, partial: false, lastModifiedMs: 1_700_000_000_000 },
      { repoId: 'unsloth/B-GGUF', hasVision: false, partial: true },
    ]);
    expect(JSON.stringify(rows)).not.toContain('Users');
  });

  it('reads quants and drops ones that could not be loaded by name', () => {
    const listing = parseUnslothGgufVariants({
      repo_id: 'unsloth/A-GGUF',
      default_variant: 'UD-Q4_K_XL',
      has_vision: false,
      variants: [
        { quant: 'UD-Q4_K_XL', size_bytes: 9 * GIB, download_size_bytes: 9 * GIB, downloaded: false, context_length: 32768 },
        { quant: 'bad quant', size_bytes: 1 },
        { quant: 'Q8_0', size_bytes: 16 * GIB, downloaded: true },
      ],
    });
    expect(listing?.variants.map(variant => variant.quant)).toEqual(['UD-Q4_K_XL', 'Q8_0']);
    expect(listing?.defaultVariant).toBe('UD-Q4_K_XL');
    expect(listing?.variants[0]).toMatchObject({ contextLength: 32768, downloadSizeBytes: 9 * GIB });
  });

  it('recomputes download progress rather than trusting Studio\'s own fraction', () => {
    expect(parseUnslothDownloadProgress({ downloaded_bytes: 50, expected_bytes: 200, progress: 0.99, complete_on_disk: false }))
      .toEqual({ downloadedBytes: 50, expectedBytes: 200, fraction: 0.25, completeOnDisk: false });
    expect(parseUnslothDownloadProgress({ downloaded_bytes: 50 })?.fraction).toBeUndefined();
  });

  it('cleans error text and redacts a key a server echoed back', () => {
    const detail = sanitizeUnslothDetail(`bad\u0000key ${KEY}\n\n${'x'.repeat(500)}`);
    expect(detail).not.toContain(KEY);
    expect(detail).not.toContain('\u0000');
    expect((detail ?? '').length).toBeLessThanOrEqual(300);
    expect(sanitizeUnslothDetail([{ msg: 'field required' }, { msg: 'too long' }])).toBe('field required; too long');
  });

  it('never puts the key in a failure description', () => {
    for (const reason of ['unreachable', 'not-unsloth', 'no-key', 'unauthorized', 'invalid-input', 'refused', 'malformed'] as const) {
      expect(describeUnslothFailure({ reason }, ORIGIN)).not.toContain('sk-unsloth-a1');
    }
  });
});

describe('server-side tools', () => {
  it('asks for both of Studio\'s own tool loops off', () => {
    expect(UNSLOTH_SERVER_TOOLS_OFF).toEqual({ enable_tools: false, mcp_enabled: false });
    expect(Object.isFrozen(UNSLOTH_SERVER_TOOLS_OFF)).toBe(true);
  });
});

describe('which quant to suggest', () => {
  const variant = (quant: string, gib: number, extra: Partial<UnslothGgufVariant> = {}): UnslothGgufVariant => ({
    quant, sizeBytes: gib * GIB, downloadSizeBytes: gib * GIB, downloaded: false, partial: false, ...extra,
  });

  it('prefers a downloaded quant that fits, so nothing downloads', () => {
    const suggestion = suggestUnslothVariant({ variants: [variant('Q8_0', 15, { downloaded: true }), variant('Q4_K_M', 9)], defaultVariant: 'Q4_K_M' }, 24 * GIB);
    expect(suggestion).toEqual({ quant: 'Q8_0', rule: 'downloaded-fits', fits: true });
  });

  it("takes Studio's default when it fits", () => {
    const suggestion = suggestUnslothVariant({ variants: [variant('Q8_0', 15), variant('Q4_K_M', 9)], defaultVariant: 'Q4_K_M' }, 24 * GIB);
    expect(suggestion).toEqual({ quant: 'Q4_K_M', rule: 'default-fits', fits: true });
  });

  it('falls to the largest that fits, then the smallest that offloads', () => {
    expect(suggestUnslothVariant({ variants: [variant('Q8_0', 30), variant('Q4_K_M', 18), variant('Q2_K', 8)], defaultVariant: 'Q8_0' }, 24 * GIB))
      .toEqual({ quant: 'Q4_K_M', rule: 'largest-fits', fits: true });
    expect(suggestUnslothVariant({ variants: [variant('Q8_0', 70), variant('Q4_K_M', 40)] }, 24 * GIB))
      .toEqual({ quant: 'Q4_K_M', rule: 'smallest-offloads', fits: false });
  });

  it('claims nothing about fit when VRAM was not measured', () => {
    const suggestion = suggestUnslothVariant({ variants: [variant('Q8_0', 15), variant('Q4_K_M', 9)], defaultVariant: 'Q4_K_M' }, undefined);
    expect(suggestion).toEqual({ quant: 'Q4_K_M', rule: 'default-unmeasured' });
    expect(variantFitsVram(variant('Q4_K_M', 9), undefined)).toBeUndefined();
  });

  it('names a published rule every time', () => {
    const ids = new Set(UNSLOTH_VARIANT_RULES.map(rule => rule.id));
    // fc.integer is 32-bit, so sizes are drawn in megabytes and scaled.
    const bytes = fc.integer({ min: 1, max: 200_000 }).map(mb => mb * 1024 * 1024);
    const arbitraryVariant = fc.record({
      quant: fc.stringMatching(/^[A-Z][A-Z0-9_]{1,10}$/),
      sizeBytes: fc.oneof(fc.constant(0), bytes),
      downloadSizeBytes: fc.oneof(fc.constant(0), bytes),
      downloaded: fc.boolean(),
      partial: fc.boolean(),
    });
    fc.assert(fc.property(
      fc.uniqueArray(arbitraryVariant, { selector: entry => entry.quant.toLowerCase(), maxLength: 12 }),
      fc.option(bytes, { nil: undefined }),
      (variants, vram) => {
        const usable = variants.filter(entry => !entry.partial);
        const suggestion = suggestUnslothVariant({ variants }, vram);
        if (usable.length === 0) {
          expect(suggestion).toBeUndefined();
          return;
        }
        expect(suggestion).toBeDefined();
        expect(ids.has(suggestion!.rule)).toBe(true);
        // Always one of the variants offered, and never an interrupted download.
        expect(usable.map(entry => entry.quant)).toContain(suggestion!.quant);
        // When anything fits, the suggestion fits.
        if (vram !== undefined && usable.some(entry => variantFitsVram(entry, vram) === true)) {
          expect(suggestion!.fits).toBe(true);
        }
      },
    ));
  });
});

describe("discovery lists Unsloth's chat models only", () => {
  it('keeps conversational repos, including one with no pipeline tag, and drops video, image and other authors', () => {
    const listing = parseUnslothHubListing([
      { id: 'unsloth/Qwen3.8-27B-GGUF', downloads: 6_000_000, tags: ['gguf', 'unsloth', 'conversational'] },
      { id: 'unsloth/MiniMax-H3-GGUF', downloads: 1_800_000, pipeline_tag: 'image-text-to-video', tags: ['gguf', 'text-to-video', 'conversational'] },
      { id: 'unsloth/Qwen-Image-2.1-GGUF', downloads: 900_000, pipeline_tag: 'text-to-image', tags: ['gguf', 'diffusers'] },
      { id: 'unsloth/gemma-4-12b-it-GGUF', downloads: 800_000, pipeline_tag: 'image-text-to-text', tags: ['gguf'] },
      { id: 'bartowski/Qwen3-14B-GGUF', downloads: 700_000, pipeline_tag: 'text-generation', tags: ['gguf', 'conversational'] },
      { id: 'unsloth/Gated-GGUF', downloads: 600_000, gated: 'manual', tags: ['conversational'] },
      { id: 'unsloth/embed-GGUF', downloads: 500_000, pipeline_tag: 'feature-extraction', tags: ['gguf'] },
      { id: 'unsloth/no-signal-GGUF', downloads: 400_000, tags: ['gguf'] },
    ]);
    expect(listing.map(model => model.repoId)).toEqual(['unsloth/Qwen3.8-27B-GGUF', 'unsloth/gemma-4-12b-it-GGUF']);
    expect(listing[1].hasVision).toBe(true);
  });

  it('reads anything without throwing', () => {
    fc.assert(fc.property(fc.anything(), payload => {
      expect(Array.isArray(parseUnslothHubListing(payload))).toBe(true);
      parseUnslothStatus(payload);
      parseUnslothCachedGguf(payload);
      parseUnslothGgufVariants(payload);
      parseUnslothDownloadProgress(payload);
    }));
  });
});
