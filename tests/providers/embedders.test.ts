import { describe, expect, it, vi } from 'vitest';
import {
  OLLAMA_EMBED_API_VERIFIED_AT,
  SUGGESTED_OLLAMA_EMBED_MODELS,
  TOKEN_HASH_DESCRIPTOR,
  TOKEN_HASH_DIMENSIONS,
  createOllamaEmbedder,
  createTokenHashEmbedder,
  probeOllamaEmbedder,
  tokenHashVector,
  type FetchLike,
} from '../../src/providers/embedders';
import { cosineSimilarity } from '../../src/core/codebaseIndex';
import * as embedders from '../../src/providers/embedders';

const ok = (payload: unknown): Awaited<ReturnType<FetchLike>> => ({
  ok: true,
  status: 200,
  json: async () => payload,
  text: async () => JSON.stringify(payload),
});

const fail = (status: number, body = 'nope'): Awaited<ReturnType<FetchLike>> => ({
  ok: false,
  status,
  json: async () => ({}),
  text: async () => body,
});

describe('the token-hash embedder is honest about what it is', () => {
  it('declares itself not semantic', () => {
    // The load-bearing field: it finds shared vocabulary, not shared meaning,
    // and a thin result must never read as a statement about the codebase.
    expect(TOKEN_HASH_DESCRIPTOR.semantic).toBe(false);
    expect(TOKEN_HASH_DESCRIPTOR.kind).toBe('token-hash');
  });

  it('says nothing leaves the machine', () => {
    expect(TOKEN_HASH_DESCRIPTOR.leavesTheMachine).toContain('Nothing');
  });

  it('needs no network at all', async () => {
    const embedder = createTokenHashEmbedder();
    const vectors = await embedder.embed(['function parseUrl(input) { return new URL(input); }']);
    expect(vectors).toHaveLength(1);
    expect(vectors[0]).toHaveLength(TOKEN_HASH_DIMENSIONS);
  });

  it('produces a unit vector, so cosine is a similarity rather than a magnitude', () => {
    const vector = tokenHashVector('const promotionGate = requireApproval(stage);');
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it('is deterministic', () => {
    expect(tokenHashVector('same text')).toEqual(tokenHashVector('same text'));
  });

  it('scores shared vocabulary above unrelated text', () => {
    // The most it claims to do, demonstrated rather than asserted.
    const query = tokenHashVector('promotion gate requires approval');
    const near = tokenHashVector('function promotionGate() { return requires_approval; }');
    const far = tokenHashVector('const colours = ["red", "green", "blue"];');
    expect(cosineSimilarity(query, near)).toBeGreaterThan(cosineSimilarity(query, far));
  });

  it('splits identifiers, so a query typed in English matches camelCase code', () => {
    // The first version kept `_` inside a token, so `parse_url` and `parseUrl`
    // shared nothing with each other or with the obvious search for them.
    const bare = tokenHashVector('parse url');
    expect(cosineSimilarity(tokenHashVector('parse_url'), bare)).toBeCloseTo(1, 6);
    expect(cosineSimilarity(tokenHashVector('parseUrl'), bare)).toBeCloseTo(1, 6);
    expect(cosineSimilarity(tokenHashVector('ParseURL'), bare)).toBeCloseTo(1, 6);
  });

  it('handles text with no usable tokens without producing NaN', () => {
    const vector = tokenHashVector('!!! ???');
    expect(vector.every(value => Number.isFinite(value))).toBe(true);
  });

  it('does not share the memory manager\'s vector width', () => {
    // Widening the shared constant to suit code would silently invalidate every
    // memory vector already stored.
    expect(TOKEN_HASH_DIMENSIONS).toBe(256);
  });
});

describe('the Ollama embedder uses the published API', () => {
  it('posts to /api/embed with an input array', async () => {
    const fetchLike = vi.fn(async () => ok({ embeddings: [[1, 0], [0, 1]] })) as unknown as FetchLike;
    const embedder = createOllamaEmbedder('http://127.0.0.1:11434', 'nomic-embed-text', 2, { fetch: fetchLike });
    await embedder.embed(['a', 'b']);
    const [url, init] = (fetchLike as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:11434/api/embed');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('nomic-embed-text');
    // The superseded /api/embeddings endpoint takes `prompt` and one string.
    expect(body.input).toEqual(['a', 'b']);
    expect(body).not.toHaveProperty('prompt');
  });

  it('pins when that wire format was read', () => {
    expect(OLLAMA_EMBED_API_VERIFIED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('does not call out at all for an empty batch', async () => {
    const fetchLike = vi.fn() as unknown as FetchLike;
    const embedder = createOllamaEmbedder('http://127.0.0.1:11434', 'm', 2, { fetch: fetchLike });
    expect(await embedder.embed([])).toEqual([]);
    expect(fetchLike).not.toHaveBeenCalled();
  });

  it('says nothing leaves the machine', () => {
    const embedder = createOllamaEmbedder('http://127.0.0.1:11434', 'm', 2, { fetch: (async () => ok({})) as FetchLike });
    expect(embedder.descriptor.leavesTheMachine).toContain('Nothing');
    expect(embedder.descriptor.kind).toBe('local-model');
    expect(embedder.descriptor.semantic).toBe(true);
  });
});

describe('a malformed answer fails loudly rather than misaligning an index', () => {
  it('throws on a non-2xx', async () => {
    const embedder = createOllamaEmbedder('http://x', 'm', 2, { fetch: (async () => fail(404, 'model not found')) as FetchLike });
    await expect(embedder.embed(['a'])).rejects.toThrow(/404/);
  });

  it('throws when there is no embeddings array', async () => {
    // A chat model answers this endpoint with something else, which is exactly
    // the signal wanted.
    const embedder = createOllamaEmbedder('http://x', 'm', 2, { fetch: (async () => ok({ response: 'hello' })) as FetchLike });
    await expect(embedder.embed(['a'])).rejects.toThrow(/not be an embedding model/);
  });

  it('throws when a vector is not finite numbers', async () => {
    const embedder = createOllamaEmbedder('http://x', 'm', 2, { fetch: (async () => ok({ embeddings: [[1, null]] })) as FetchLike });
    await expect(embedder.embed(['a'])).rejects.toThrow(/finite numbers/);
  });
});

describe('the dimension is discovered, never declared', () => {
  it('reads the width off the model\'s own answer', async () => {
    const probe = await probeOllamaEmbedder('http://x', 'm', {
      fetch: (async () => ok({ embeddings: [[0, 1, 2, 3, 4, 5, 6, 7]] })) as FetchLike,
    });
    expect(probe.ok).toBe(true);
    expect(probe.dimensions).toBe(8);
  });

  it('refuses with a reason rather than guessing a width', async () => {
    // An index built at the wrong width compares vectors that cannot be
    // compared, and every search against it ranks nonsense plausibly.
    const probe = await probeOllamaEmbedder('http://x', 'chat-model', {
      fetch: (async () => ok({ response: 'hi' })) as FetchLike,
    });
    expect(probe.ok).toBe(false);
    expect(probe.dimensions).toBeUndefined();
    expect(probe.reason).toContain('embedding model');
  });

  it('refuses an empty vector', async () => {
    const probe = await probeOllamaEmbedder('http://x', 'm', {
      fetch: (async () => ok({ embeddings: [[]] })) as FetchLike,
    });
    expect(probe.ok).toBe(false);
    expect(probe.reason).toContain('empty vector');
  });

  it('reports an unreachable runtime as a reason rather than throwing', async () => {
    const probe = await probeOllamaEmbedder('http://x', 'm', {
      fetch: (async () => { throw new Error('connect ECONNREFUSED'); }) as FetchLike,
    });
    expect(probe.ok).toBe(false);
    expect(probe.reason).toContain('ECONNREFUSED');
  });
});

describe('what is deliberately not here', () => {
  it('ships no remote embedder', () => {
    // Supported by the index module, and deliberately not offered from a
    // dropdown: it would mean sending an entire repository to a third party.
    const exported = Object.keys(embedders);
    expect(exported.filter(name => /remote|openai|cohere|voyage/i.test(name))).toEqual([]);
  });

  it('suggests models without offering to download one', () => {
    // Pulling a model is hundreds of megabytes onto somebody's disk, and it is
    // their decision to make in their own tool.
    expect(SUGGESTED_OLLAMA_EMBED_MODELS.length).toBeGreaterThan(0);
    const exported = Object.keys(embedders);
    expect(exported.some(name => /pull|download|install/i.test(name))).toBe(false);
  });
});
