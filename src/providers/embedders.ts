/**
 * The two ways AtlasMind turns source into vectors, and the difference between
 * them that matters.
 *
 * **The token-hash embedder** needs no model, no network and no configuration.
 * It is a signed random projection of the tokens in a chunk — the same technique
 * the memory manager uses for SSOT entries — and it works the moment the
 * extension loads. It is also, unavoidably, bag-of-words: it finds code that
 * shares vocabulary with your query, not code that shares meaning. That is
 * genuinely useful and it is not semantic search, and `semantic: false` travels
 * on it into every result so a thin answer is never mistaken for a statement
 * about the codebase.
 *
 * It deliberately does **not** share the memory manager's vector width. That one
 * is tuned for short prose entries; a 60-line code chunk is far denser, and
 * changing the shared constant to suit code would silently invalidate every
 * memory vector already stored. Two widths is the cheaper mistake.
 *
 * **The Ollama embedder** is a real embedding model running on the user's own
 * machine, which is what makes local-first semantic retrieval possible at all —
 * no key, no bill, and nothing leaves the machine. The wire format is read from
 * Ollama's published API rather than guessed: `POST /api/embed` taking `input`
 * as a string or an array and answering with `embeddings` as an array of
 * vectors, verified at {@link OLLAMA_EMBED_API_VERIFIED_AT}. The older
 * `/api/embeddings` is superseded and single-input only, so it is not used.
 *
 * **The dimension is discovered, never declared.** Embedding models disagree
 * about width — 384, 768, 1024 — and hardcoding one would build an index whose
 * vectors could not be compared with the query's. `probeOllamaEmbedder` asks the
 * model to embed one short string and reads the width off the answer, which is
 * also the cheapest possible check that the model exists and is an embedding
 * model at all.
 *
 * There is deliberately **no remote embedder here**. The index module supports
 * the kind, and shipping one would mean offering to send an entire repository to
 * a third party from a dropdown. That is a decision worth building deliberately,
 * with its own consent surface, rather than one that arrives as an option.
 *
 * Pure apart from an injected `fetch`; unit-tested against a fake.
 */

import { type Embedder, type EmbedderDescriptor } from '../core/codebaseIndex.js';

/** When the Ollama embedding API shape was last read from its published docs. */
export const OLLAMA_EMBED_API_VERIFIED_AT = '2026-09-09';

/**
 * Vector width for the token-hash embedder.
 *
 * Wider than the memory manager's, because a chunk of code carries several times
 * the distinct tokens of a memory entry and collisions in a narrow vector make
 * everything look faintly similar to everything else.
 */
export const TOKEN_HASH_DIMENSIONS = 256;

/**
 * Split code into the words a person would search for.
 *
 * Identifiers are broken apart rather than kept whole: `parse_url`, `parseUrl`,
 * `ParseURL` and `parse url` all become `parse`, `url`. That matters more here
 * than it does for prose, because a query is typed in English and the code is
 * written in camelCase — treating `parseUrl` as one opaque token means the
 * obvious search for it matches nothing, which was exactly the behaviour the
 * first version of this shipped with and the tests caught.
 *
 * The camel split runs before lowercasing, since afterwards the boundary is
 * gone. `ParseURL` is handled by the second pattern, which splits a run of
 * capitals from the capitalised word that follows it.
 */
function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(term => term.length >= 2);
}

function hashToken(token: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** A normalised signed random projection of the tokens in `text`. */
export function tokenHashVector(text: string, dimensions = TOKEN_HASH_DIMENSIONS): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  for (const token of tokenize(text)) {
    const hash = hashToken(token);
    // Fold the high and low halves before masking: plain modulo clusters at
    // boundaries and leaves some slots almost unused.
    const folded = ((hash >>> 16) ^ (hash & 0xffff)) & 0xffff;
    vector[folded % dimensions] += (hash & 1) === 0 ? 1 : -1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
  return norm === 0 ? vector : vector.map(value => value / norm);
}

export const TOKEN_HASH_DESCRIPTOR: EmbedderDescriptor = {
  id: 'token-hash',
  kind: 'token-hash',
  label: 'the built-in token-hash embedder',
  dimensions: TOKEN_HASH_DIMENSIONS,
  leavesTheMachine: 'Nothing. It runs in the extension host and needs no model.',
  // The load-bearing field. This finds shared vocabulary, not shared meaning.
  semantic: false,
};

/** Works offline, costs nothing, and is honest about what it is. */
export function createTokenHashEmbedder(): Embedder {
  return {
    descriptor: TOKEN_HASH_DESCRIPTOR,
    embed: async texts => texts.map(text => tokenHashVector(text)),
  };
}

// ── Ollama ───────────────────────────────────────────────────────

export type FetchLike = (input: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>;

export interface OllamaEmbedderDeps {
  fetch: FetchLike;
  /** Milliseconds before one batch is abandoned. A cold model load is slow. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

async function postEmbed(
  origin: string,
  model: string,
  input: readonly string[],
  deps: OllamaEmbedderDeps,
): Promise<number[][]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await deps.fetch(`${origin.replace(/\/+$/, '')}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, input: [...input] }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Ollama answered ${response.status} for the embedding request${detail ? `: ${detail.slice(0, 200)}` : '.'}`,
      );
    }
    const payload = await response.json() as { embeddings?: unknown };
    const embeddings = payload.embeddings;
    // Checked rather than trusted: a malformed answer must fail the build
    // loudly. `codebaseIndex` refuses a misaligned index for the same reason,
    // and this is the boundary where a misalignment would originate.
    if (!Array.isArray(embeddings)) {
      throw new Error('Ollama returned no embeddings array. The model may not be an embedding model.');
    }
    const vectors: number[][] = [];
    for (const entry of embeddings) {
      if (!Array.isArray(entry) || entry.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
        throw new Error('Ollama returned an embedding that is not a vector of finite numbers.');
      }
      vectors.push(entry as number[]);
    }
    return vectors;
  } finally {
    clearTimeout(timer);
  }
}

export interface OllamaEmbedderProbe {
  ok: boolean;
  /** Discovered from the model's own answer, never declared. */
  dimensions?: number;
  /** Why it cannot be used, when it cannot. Stated, never a silent fallback. */
  reason?: string;
}

/**
 * Ask the model to embed one short string, and read the width off the answer.
 *
 * This is both the dimension discovery and the cheapest possible check that the
 * model exists and is an embedding model — a chat model answers this endpoint
 * with an error rather than a vector, which is exactly the signal wanted.
 *
 * Never falls back to a guessed width. An index built at the wrong width would
 * compare vectors that cannot be compared, and every search against it would
 * return a plausible ranking of nonsense.
 */
export async function probeOllamaEmbedder(
  origin: string,
  model: string,
  deps: OllamaEmbedderDeps,
): Promise<OllamaEmbedderProbe> {
  try {
    const vectors = await postEmbed(origin, model, ['probe'], deps);
    const width = vectors[0]?.length ?? 0;
    if (width === 0) {
      return { ok: false, reason: `${model} returned an empty vector, so it cannot be used to index anything.` };
    }
    return { ok: true, dimensions: width };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * A local embedding model, at a width discovered by {@link probeOllamaEmbedder}.
 *
 * The dimension is a required argument rather than an optional one so there is
 * no path to constructing this without having probed first.
 */
export function createOllamaEmbedder(
  origin: string,
  model: string,
  dimensions: number,
  deps: OllamaEmbedderDeps,
): Embedder {
  return {
    descriptor: {
      id: `ollama:${model}`,
      kind: 'local-model',
      label: `${model} on your local Ollama`,
      dimensions,
      leavesTheMachine: 'Nothing. The model runs on this machine and no request leaves it.',
      semantic: true,
    },
    embed: texts => (texts.length === 0
      ? Promise.resolve([])
      : postEmbed(origin, model, texts, deps)),
  };
}

/**
 * Embedding models worth suggesting, if one is already pulled.
 *
 * A short list rather than a recommendation engine, and deliberately not
 * something AtlasMind offers to download: pulling a model is hundreds of
 * megabytes onto somebody's disk, and it is their decision to make in their own
 * tool. `modelRole` already classifies an id as an embedding model, so a project
 * that has pulled something else is not told it has nothing.
 */
export const SUGGESTED_OLLAMA_EMBED_MODELS: readonly string[] = [
  'nomic-embed-text',
  'mxbai-embed-large',
  'all-minilm',
  'bge-m3',
];
