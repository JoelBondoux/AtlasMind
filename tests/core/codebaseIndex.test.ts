import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SEARCH_OPTIONS,
  EXCLUSION_LABEL,
  buildCodebaseIndex,
  buildRetrievalPreamble,
  chunkSource,
  contentHash,
  cosineSimilarity,
  indexFreshness,
  isIndexablePath,
  looksLikeSecret,
  planCodebaseIndex,
  searchCodebaseIndex,
  type CodebaseIndex,
  type Embedder,
  type EmbedderDescriptor,
  type IndexCandidate,
} from '../../src/core/codebaseIndex';

const NOW = '2026-09-09T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);

const LOCAL: EmbedderDescriptor = {
  id: 'test-local',
  kind: 'local-model',
  label: 'a local model',
  dimensions: 3,
  leavesTheMachine: 'Nothing.',
  semantic: true,
};

const HASH: EmbedderDescriptor = {
  id: 'token-hash',
  kind: 'token-hash',
  label: 'the built-in token-hash embedder',
  dimensions: 3,
  leavesTheMachine: 'Nothing.',
  semantic: false,
};

const REMOTE: EmbedderDescriptor = {
  id: 'test-remote',
  kind: 'remote-model',
  label: 'SomeVendor embeddings',
  dimensions: 3,
  leavesTheMachine: 'Every indexed line of source, to SomeVendor.',
  semantic: true,
};

/** An embedder that returns a fixed vector per text, so results are checkable. */
const embedderFrom = (
  descriptor: EmbedderDescriptor,
  vectorFor: (text: string) => number[] = () => [1, 0, 0],
): Embedder => ({
  descriptor,
  embed: async texts => texts.map(text => vectorFor(text)),
});

const file = (path: string, content: string): IndexCandidate => ({ path, content });

const body = (marker: string, lines = 5): string =>
  Array.from({ length: lines }, (_, index) => `${marker} line ${index}`).join('\n');

async function indexOf(
  candidates: IndexCandidate[],
  descriptor: EmbedderDescriptor = LOCAL,
  vectorFor?: (text: string) => number[],
): Promise<CodebaseIndex> {
  const plan = planCodebaseIndex(candidates, descriptor);
  return buildCodebaseIndex(plan, embedderFrom(descriptor, vectorFor), NOW);
}

const currentOf = (candidates: IndexCandidate[]): Map<string, string> =>
  new Map(candidates.filter(entry => isIndexablePath(entry.path))
    .map(entry => [entry.path, contentHash(entry.content)]));

describe('a plan says what would leave the machine, before anything runs', () => {
  it('names the embedder and the scale on every plan', () => {
    const plan = planCodebaseIndex([file('src/a.ts', body('a'))], LOCAL);
    expect(plan.disclosure).toContain('a local model');
    expect(plan.disclosure).toContain('Nothing.');
    expect(plan.chunkCount).toBe(1);
  });

  it('says outright that a remote embedder sends the repository', () => {
    const plan = planCodebaseIndex([file('src/a.ts', body('a'))], REMOTE);
    expect(plan.disclosure).toContain('would be sent to SomeVendor embeddings');
    expect(plan.disclosure).toContain('Embedding a repository means sending the repository');
  });

  it('plans without embedding anything', async () => {
    const embed = vi.fn();
    planCodebaseIndex([file('src/a.ts', body('a'))], LOCAL);
    expect(embed).not.toHaveBeenCalled();
  });

  it('states a budget truncation rather than applying it silently', () => {
    const plan = planCodebaseIndex(
      [file('src/a.ts', body('a', 200)), file('src/b.ts', body('b', 200))],
      LOCAL,
      { linesPerChunk: 10, overlapLines: 0 },
      { maxChunks: 20 },
    );
    expect(plan.overBudget).toBe(true);
    expect(plan.excluded.some(entry => entry.reason === 'over-budget')).toBe(true);
    expect(plan.disclosure).toContain('chunk budget');
  });
});

describe('a file that looks like it holds a credential is never indexed', () => {
  it('refuses it before chunking, so no secret reaches a vector', () => {
    const plan = planCodebaseIndex(
      [file('src/config.ts', 'const key = "sk-abcdefghijklmnopqrstuvwxyz0123";')],
      LOCAL,
    );
    expect(plan.included).toHaveLength(0);
    expect(plan.excluded[0]!.reason).toBe('looks-like-secret');
  });

  it('recognises the shapes that matter', () => {
    // An indexed secret is a retrievable secret, and retrieval feeds prompts.
    expect(looksLikeSecret('ghp_abcdefghijklmnopqrstuv0123456789')).toBe(true);
    expect(looksLikeSecret('AKIAIOSFODNN7EXAMPLE')).toBe(true);
    expect(looksLikeSecret('-----BEGIN RSA PRIVATE KEY-----')).toBe(true);
    expect(looksLikeSecret('password: "hunter2swordfish"')).toBe(true);
    expect(looksLikeSecret('const password = getSecret("db");')).toBe(false);
  });

  it('records the refusal on the index rather than dropping it', async () => {
    const index = await indexOf([file('src/config.ts', 'apiKey = "sk-abcdefghijklmnopqrstuvwxyz01"')]);
    expect(index.excluded[0]!.reason).toBe('looks-like-secret');
    expect(EXCLUSION_LABEL['looks-like-secret']).toContain('credential');
  });
});

describe('what may be indexed', () => {
  it('covers source and refuses generated output', () => {
    expect(isIndexablePath('src/core/a.ts')).toBe(true);
    expect(isIndexablePath('docs/guide.md')).toBe(true);
    expect(isIndexablePath('node_modules/pkg/index.js')).toBe(false);
    expect(isIndexablePath('out/core/a.js')).toBe(false);
    expect(isIndexablePath('coverage/lcov-report/index.html')).toBe(false);
    expect(isIndexablePath('package-lock.json')).toBe(false);
  });

  it('matches an excluded segment as a segment, not a substring', () => {
    // `src/distance.ts` must survive despite containing `dist`.
    expect(isIndexablePath('src/distance.ts')).toBe(true);
    expect(isIndexablePath('src/building/a.ts')).toBe(true);
    expect(isIndexablePath('dist/a.ts')).toBe(false);
  });

  it('refuses a file that is not text whatever its extension says', () => {
    const plan = planCodebaseIndex([file('src/a.ts', 'ok\u0000binary')], LOCAL);
    expect(plan.excluded[0]!.reason).toBe('binary');
  });

  it('refuses an empty or whitespace-only file', () => {
    const plan = planCodebaseIndex([file('src/a.ts', '   \n\n  ')], LOCAL);
    expect(plan.excluded[0]!.reason).toBe('empty');
  });
});

describe('chunking is deterministic', () => {
  it('produces the same ranges for the same bytes', () => {
    const content = body('x', 200);
    expect(chunkSource('src/a.ts', content)).toEqual(chunkSource('src/a.ts', content));
  });

  it('overlaps, so a match at a seam survives', () => {
    const chunks = chunkSource('src/a.ts', body('x', 100), { linesPerChunk: 40, overlapLines: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1]!.startLine).toBeLessThan(chunks[0]!.endLine);
  });

  it('uses 1-based inclusive lines, the way an editor shows them', () => {
    const chunks = chunkSource('src/a.ts', body('x', 10), { linesPerChunk: 10, overlapLines: 0 });
    expect(chunks[0]!.startLine).toBe(1);
    expect(chunks[0]!.endLine).toBe(10);
  });

  it('drops a range that is only blank lines', () => {
    const content = `${body('x', 5)}\n${'\n'.repeat(80)}`;
    const chunks = chunkSource('src/a.ts', content, { linesPerChunk: 20, overlapLines: 0 });
    expect(chunks.every(chunk => chunk.text.trim().length > 0)).toBe(true);
  });

  it('gives each chunk an id that survives a rebuild', () => {
    const chunks = chunkSource('src/a.ts', body('x', 10), { linesPerChunk: 10, overlapLines: 0 });
    expect(chunks[0]!.id).toBe('src/a.ts#1-10');
  });
});

describe('a misaligned index is refused rather than built', () => {
  it('refuses when the embedder returns the wrong number of vectors', async () => {
    // The worst outcome available here: every search would look correct and be
    // wrong, and nothing would appear broken.
    const plan = planCodebaseIndex([file('src/a.ts', body('a')), file('src/b.ts', body('b'))], LOCAL);
    const broken: Embedder = { descriptor: LOCAL, embed: async () => [[1, 0, 0]] };
    await expect(buildCodebaseIndex(plan, broken, NOW)).rejects.toThrow(/misaligned/);
  });

  it('refuses when a vector is the wrong width', async () => {
    const plan = planCodebaseIndex([file('src/a.ts', body('a'))], LOCAL);
    const broken: Embedder = { descriptor: LOCAL, embed: async () => [[1, 0]] };
    await expect(buildCodebaseIndex(plan, broken, NOW)).rejects.toThrow(/cannot be compared/);
  });
});

describe('a stale chunk is excluded, not caveated', () => {
  it('drops results from a file that has changed since it was indexed', async () => {
    const files = [file('src/a.ts', body('alpha'))];
    const index = await indexOf(files);
    const edited = new Map([['src/a.ts', contentHash(body('alpha edited'))]]);
    const outcome = searchCodebaseIndex(index, [1, 0, 0], edited, NOW_MS);
    // Returning code that no longer exists is worse than returning nothing.
    expect(outcome.hits).toHaveLength(0);
    expect(outcome.coverage.staleFiles).toBe(1);
  });

  it('drops results from a file that has been deleted', async () => {
    const index = await indexOf([file('src/a.ts', body('alpha'))]);
    const outcome = searchCodebaseIndex(index, [1, 0, 0], new Map(), NOW_MS);
    expect(outcome.hits).toHaveLength(0);
  });

  it('returns results from a file that has not changed', async () => {
    const files = [file('src/a.ts', body('alpha'))];
    const index = await indexOf(files);
    const outcome = searchCodebaseIndex(index, [1, 0, 0], currentOf(files), NOW_MS);
    expect(outcome.hits).toHaveLength(1);
    expect(outcome.hits[0]!.path).toBe('src/a.ts');
  });

  it('keeps changed, deleted and never-indexed apart', async () => {
    const indexed = [file('src/a.ts', body('a')), file('src/b.ts', body('b'))];
    const index = await indexOf(indexed);
    const current = new Map([
      ['src/a.ts', contentHash(body('a'))],
      ['src/b.ts', contentHash(body('b changed'))],
      ['src/c.ts', contentHash(body('c'))],
    ]);
    const freshness = indexFreshness(index, current);
    expect(freshness.fresh).toBe(1);
    expect(freshness.stale).toEqual(['src/b.ts']);
    expect(freshness.unindexed).toEqual(['src/c.ts']);
    expect(freshness.missing).toEqual([]);
  });
});

describe('the index stores where, never what', () => {
  it('keeps no source text on a chunk', async () => {
    const secretish = 'the distinctive phrase nobody else would write';
    const index = await indexOf([file('src/a.ts', `${secretish}\n${body('a')}`)]);
    expect(JSON.stringify(index)).not.toContain(secretish);
    expect(index.chunks[0]).not.toHaveProperty('text');
  });
});

describe('coverage travels with every search', () => {
  it('says how much of the tree is currently covered', async () => {
    const indexed = [file('src/a.ts', body('a'))];
    const index = await indexOf(indexed);
    const current = new Map([
      ['src/a.ts', contentHash(body('a'))],
      ['src/b.ts', contentHash(body('b'))],
    ]);
    const outcome = searchCodebaseIndex(index, [1, 0, 0], current, NOW_MS);
    expect(outcome.coverage.summary).toContain('covering 1 of 2 files');
  });

  it('says how old the index is', async () => {
    const files = [file('src/a.ts', body('a'))];
    const index = await indexOf(files);
    const later = NOW_MS + (6 * 24 * 60 * 60 * 1000);
    const outcome = searchCodebaseIndex(index, [1, 0, 0], currentOf(files), later);
    expect(outcome.coverage.ageDays).toBe(6);
    expect(outcome.coverage.summary).toContain('built 6 days ago');
  });

  it('warns that a token-hash result is about vocabulary, not meaning', async () => {
    const files = [file('src/a.ts', body('a'))];
    const index = await indexOf(files, HASH);
    const outcome = searchCodebaseIndex(index, [1, 0, 0], currentOf(files), NOW_MS);
    expect(outcome.coverage.summary).toContain('shared vocabulary rather than shared meaning');
    expect(outcome.coverage.summary).toContain('not evidence the code is absent');
  });

  it('adds no such caveat for a genuinely semantic embedder', async () => {
    const files = [file('src/a.ts', body('a'))];
    const index = await indexOf(files, LOCAL);
    const outcome = searchCodebaseIndex(index, [1, 0, 0], currentOf(files), NOW_MS);
    expect(outcome.coverage.summary).not.toContain('shared vocabulary');
  });
});

describe('ranking', () => {
  it('orders by similarity', async () => {
    const files = [file('src/near.ts', body('near')), file('src/far.ts', body('far'))];
    const index = await indexOf(files, LOCAL, text =>
      (text.includes('near') ? [1, 0, 0] : [0, 1, 0]));
    const outcome = searchCodebaseIndex(index, [1, 0, 0], currentOf(files), NOW_MS);
    expect(outcome.hits[0]!.path).toBe('src/near.ts');
  });

  it('drops hits below the noise threshold', async () => {
    const files = [file('src/a.ts', body('a'))];
    const index = await indexOf(files, LOCAL, () => [0, 1, 0]);
    const outcome = searchCodebaseIndex(index, [1, 0, 0], currentOf(files), NOW_MS);
    expect(outcome.hits).toHaveLength(0);
  });

  it('never lets one file fill the whole result set', async () => {
    // The failure that makes a search feel broken while working exactly as
    // written: one large well-matched file crowding everything else out.
    const files = [
      file('src/big.ts', body('same', 600)),
      file('src/other.ts', body('same', 60)),
    ];
    const index = await indexOf(files, LOCAL, () => [1, 0, 0]);
    const outcome = searchCodebaseIndex(index, [1, 0, 0], currentOf(files), NOW_MS);
    const fromBig = outcome.hits.filter(hit => hit.path === 'src/big.ts');
    expect(fromBig.length).toBeLessThanOrEqual(2);
    expect(outcome.hits.some(hit => hit.path === 'src/other.ts')).toBe(true);
  });

  it('ranks deterministically when scores tie', async () => {
    const files = [file('src/a.ts', body('a', 200)), file('src/b.ts', body('b', 200))];
    const index = await indexOf(files, LOCAL, () => [1, 0, 0]);
    const first = searchCodebaseIndex(index, [1, 0, 0], currentOf(files), NOW_MS);
    const second = searchCodebaseIndex(index, [1, 0, 0], currentOf(files), NOW_MS);
    expect(first.hits.map(hit => hit.chunkId)).toEqual(second.hits.map(hit => hit.chunkId));
  });

  it('honours the limit', async () => {
    const files = Array.from({ length: 20 }, (_, index) => file(`src/f${index}.ts`, body('same')));
    const index = await indexOf(files, LOCAL, () => [1, 0, 0]);
    const outcome = searchCodebaseIndex(index, [1, 0, 0], currentOf(files), NOW_MS, {
      ...DEFAULT_SEARCH_OPTIONS,
      limit: 5,
    });
    expect(outcome.hits).toHaveLength(5);
  });
});

describe('cosine similarity', () => {
  it('is 1 for identical directions and 0 for orthogonal ones', () => {
    expect(cosineSimilarity([1, 0, 0], [2, 0, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBe(0);
  });

  it('refuses to compare vectors of different widths', () => {
    // Silently comparing the common prefix would produce a plausible number
    // from two things that cannot be compared at all.
    expect(cosineSimilarity([1, 0, 0], [1, 0])).toBe(0);
  });

  it('clamps a negative similarity at zero rather than ranking it', () => {
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBe(0);
  });
});

describe('the retrieval preamble', () => {
  it('says an excerpt is evidence rather than an answer', async () => {
    const files = [file('src/a.ts', body('a'))];
    const index = await indexOf(files);
    const outcome = searchCodebaseIndex(index, [1, 0, 0], currentOf(files), NOW_MS);
    const preamble = buildRetrievalPreamble(outcome.coverage);
    expect(preamble).toContain('Read the files before concluding anything');
  });

  it('says a thin result is a fact about the index, not about the codebase', async () => {
    const files = [file('src/a.ts', body('a'))];
    const index = await indexOf(files);
    const outcome = searchCodebaseIndex(index, [1, 0, 0], currentOf(files), NOW_MS);
    const preamble = buildRetrievalPreamble(outcome.coverage);
    expect(preamble).toContain('not evidence that something does not exist here');
    expect(preamble).toContain('Say so rather than concluding the code is absent');
  });

  it('carries the coverage into it', async () => {
    const files = [file('src/a.ts', body('a'))];
    const index = await indexOf(files);
    const outcome = searchCodebaseIndex(index, [1, 0, 0], currentOf(files), NOW_MS);
    expect(buildRetrievalPreamble(outcome.coverage)).toContain(outcome.coverage.summary);
  });
});

describe('content hashing', () => {
  it('is stable and distinguishes a one-character change', () => {
    expect(contentHash('abc')).toBe(contentHash('abc'));
    expect(contentHash('abc')).not.toBe(contentHash('abd'));
  });
});
