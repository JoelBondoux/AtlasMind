/**
 * A retrievable index over the project's actual source — what the codebase
 * *does*, as opposed to what was decided about it.
 *
 * AtlasMind's memory answers the second question well: SSOT holds decisions,
 * architecture notes and misadventures, and retrieves them by a hashed vector
 * plus lexical scoring. It has never been able to answer the first. An agent
 * asked to change how promotions are gated has to be told which files to read,
 * because nothing indexes the source itself — which is the single largest
 * capability gap in the product and the one every persona hits.
 *
 * Seven rules. Most of them are about what this must *not* claim.
 *
 * **Embedding a repository sends the repository.** That is the whole privacy
 * story in one sentence, and it is why a remote embedder is a deliberate,
 * deny-by-default decision rather than a configuration detail. Every plan names
 * the embedder, what leaves the machine, and how much of it, **before** anything
 * runs — the shape `producerReportPublication` and `lensProbePolicy` both take,
 * for the same reason: the decision has to be inspectable separately from the act.
 *
 * **A hashed vector is not a semantic one, and it says so.** The zero-cost
 * fallback reuses the token-hash embedding the memory manager already ships: it
 * works offline, costs nothing and needs no model. It is also bag-of-words, so
 * it finds files that share vocabulary and not files that share meaning.
 * `semantic: false` travels on the embedder and into every result, because
 * "semantic search found nothing relevant" and "token-overlap search found
 * nothing relevant" are different findings and only one of them is about the
 * codebase.
 *
 * **The index stores where, never what.** A chunk records a path and a line
 * range; the text is re-read from disk at retrieval. That is not only smaller —
 * it makes the next rule structural rather than remembered, because there is no
 * stored copy that *could* be returned after the file changed.
 *
 * **A stale chunk is excluded, not caveated.** Every chunk carries the source
 * file's content hash. When the file has changed the chunk is dropped from
 * results rather than returned with a warning: returning code that no longer
 * exists is worse than returning nothing, and a caveat attached to an otherwise
 * plausible result is read past.
 *
 * **Coverage travels with every search.** Three results out of an index covering
 * a tenth of the repository, built a fortnight ago, is a different answer from
 * three results out of a current one — and a bare list of three cannot tell them
 * apart. Unassessed is not clear, applied to retrieval.
 *
 * **A file that looks like it holds a credential is never indexed**, and the
 * refusal is recorded. An indexed secret is a *retrievable* secret, and
 * retrieval feeds prompts: it would travel to whichever model answered next,
 * which is the one outcome worth refusing outright.
 *
 * **This never replaces project memory.** Retrieved source says what the code
 * does; SSOT says what was decided and why, which no amount of reading the code
 * recovers. A retrieval surface that quietly displaced the second would lose the
 * thing that cannot be rebuilt.
 *
 * Pure and `vscode`-free; the embedder, the clock and the file reader are all
 * injected.
 */

/** How a vector was produced, and therefore what it can be trusted to mean. */
export type EmbedderKind = 'token-hash' | 'local-model' | 'remote-model';

export interface EmbedderDescriptor {
  id: string;
  kind: EmbedderKind;
  label: string;
  /** Vector width. Mixing widths in one index is refused rather than truncated. */
  dimensions: number;
  /**
   * What leaves this machine when it runs. Never omitted, including where the
   * answer is "nothing" — an absent statement reads as an absent risk.
   */
  leavesTheMachine: string;
  /**
   * True only where the vectors carry meaning rather than token overlap.
   *
   * The token-hash embedder is genuinely useful and genuinely not semantic, and
   * conflating the two would make every disappointing result look like a
   * statement about the codebase.
   */
  semantic: boolean;
}

/** Embeds text. Injected, so every rule above is testable without a model. */
export interface Embedder {
  descriptor: EmbedderDescriptor;
  embed: (texts: readonly string[]) => Promise<number[][]>;
}

export interface IndexedChunk {
  /** `path#startLine-endLine`. Deterministic, so a rebuild is a diff. */
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  /** The containing file's content hash when this chunk was embedded. */
  fileHash: string;
  vector: number[];
}

export interface IndexedFile {
  path: string;
  hash: string;
  chunkCount: number;
}

export interface CodebaseIndex {
  version: 1;
  builtAt: string;
  embedder: EmbedderDescriptor;
  files: IndexedFile[];
  chunks: IndexedChunk[];
  /**
   * Files deliberately left out, with the reason.
   *
   * Kept in the index rather than discarded, because "not found" and "refused"
   * are different answers to "why is this file not in my search results" and
   * only one of them is a bug.
   */
  excluded: Array<{ path: string; reason: ExclusionReason }>;
  /** How many files the caller offered. Coverage is meaningless without it. */
  candidateCount: number;
}

export type ExclusionReason =
  | 'not-source'
  | 'too-large'
  | 'binary'
  | 'looks-like-secret'
  | 'empty'
  | 'over-budget';

export const EXCLUSION_LABEL: Record<ExclusionReason, string> = {
  'not-source': 'not a source file this index covers',
  'too-large': 'larger than the per-file limit',
  binary: 'binary, or not decodable as text',
  'looks-like-secret': 'contains something shaped like a credential',
  empty: 'empty',
  'over-budget': 'past the chunk budget for this build',
};

// ── What may be indexed ──────────────────────────────────────────

/**
 * Extensions worth indexing.
 *
 * A declared list rather than "everything that is not binary": an index full of
 * lock files and generated output returns lock files and generated output, and
 * the first thing anybody does with a search that does that is stop using it.
 */
export const INDEXABLE_EXTENSIONS: readonly string[] = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift',
  '.cs', '.c', '.h', '.cpp', '.hpp', '.php', '.scala',
  '.vue', '.svelte', '.astro',
  '.css', '.scss', '.sql', '.graphql', '.proto',
  '.md', '.mdx',
];

/**
 * Path fragments that are never indexed.
 *
 * Generated output, dependencies and version-control internals. Matched on path
 * segments rather than as substrings, so a legitimate `src/distance.ts` is not
 * excluded for containing `dist`.
 */
export const EXCLUDED_SEGMENTS: readonly string[] = [
  'node_modules', '.git', 'dist', 'out', 'build', 'coverage',
  '.next', '.nuxt', '.svelte-kit', 'vendor', '__pycache__',
  '.venv', 'venv', 'target', 'bin', 'obj', '.gradle',
];

/** Per-file ceiling. A minified bundle is not a thing anybody searches for. */
export const MAX_INDEXED_FILE_BYTES = 256 * 1024;

/**
 * Values shaped like a credential rather than a reference to one.
 *
 * The same shape-not-name reasoning `testCaseRegister` uses: the variable
 * somebody pastes a token into is never the one called `token`. Deliberately
 * conservative — a false positive costs one file's searchability, and a false
 * negative puts a live secret into whatever prompt retrieves it next.
 */
const SECRET_SHAPES: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bghp_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bASIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\./,
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["'][^"']{8,}["']/i,
];

/** True when this content should never enter a retrievable index. */
export function looksLikeSecret(content: string): boolean {
  return SECRET_SHAPES.some(pattern => pattern.test(content));
}

function pathSegments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

function extensionOf(path: string): string {
  const name = pathSegments(path).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

/** Whether a path is one this index covers, before its content is read. */
export function isIndexablePath(path: string): boolean {
  const segments = pathSegments(path);
  if (segments.some(segment => EXCLUDED_SEGMENTS.includes(segment.toLowerCase()))) {
    return false;
  }
  return INDEXABLE_EXTENSIONS.includes(extensionOf(path));
}

// ── Chunking ─────────────────────────────────────────────────────

export interface ChunkOptions {
  /** Lines per chunk. */
  linesPerChunk: number;
  /** Lines repeated from the previous chunk, so a match at a seam survives. */
  overlapLines: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  linesPerChunk: 60,
  overlapLines: 10,
};

export interface SourceChunk {
  id: string;
  path: string;
  /** 1-based, inclusive. Matches what an editor shows. */
  startLine: number;
  endLine: number;
  text: string;
}

/**
 * Split a file into overlapping line ranges.
 *
 * Deterministic by construction — the same bytes always produce the same ranges
 * — which is what lets a rebuild skip an unchanged file and lets a stored chunk
 * id keep meaning across builds. Overlap exists because the interesting part of
 * a function is as likely to straddle a boundary as to sit inside one.
 *
 * Line-based rather than syntax-aware on purpose: a parser per language is a
 * maintenance surface out of proportion to the benefit here, and it would fail
 * on exactly the malformed files somebody is most likely to be searching for.
 */
export function chunkSource(
  path: string,
  content: string,
  options: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): SourceChunk[] {
  const lines = content.split('\n');
  const size = Math.max(1, Math.floor(options.linesPerChunk));
  const overlap = Math.max(0, Math.min(size - 1, Math.floor(options.overlapLines)));
  const step = size - overlap;
  const chunks: SourceChunk[] = [];

  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(lines.length, start + size);
    const text = lines.slice(start, end).join('\n');
    // A range of blank lines carries no signal and would dilute every vector it
    // is averaged into.
    if (text.trim().length > 0) {
      chunks.push({
        id: `${path}#${start + 1}-${end}`,
        path,
        startLine: start + 1,
        endLine: end,
        text,
      });
    }
    if (end >= lines.length) {
      break;
    }
  }
  return chunks;
}

/**
 * A stable content hash.
 *
 * FNV-1a: not cryptographic, and it does not need to be — the only question it
 * answers is "did this file change since it was indexed", where an accidental
 * collision costs one stale result and an attacker forging one has already got
 * write access to the source.
 */
export function contentHash(content: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// ── Planning a build ─────────────────────────────────────────────

export interface IndexCandidate {
  path: string;
  content: string;
}

export interface IndexBudget {
  /** The most chunks one build may embed. Stated, never silently applied. */
  maxChunks: number;
}

export const DEFAULT_INDEX_BUDGET: IndexBudget = { maxChunks: 20_000 };

export interface IndexPlan {
  embedder: EmbedderDescriptor;
  /** Files that will be embedded, with the chunks each produces. */
  included: Array<{ path: string; hash: string; chunks: SourceChunk[] }>;
  excluded: Array<{ path: string; reason: ExclusionReason }>;
  chunkCount: number;
  candidateCount: number;
  /** Truncated by the budget. Stated so a partial index is never silent. */
  overBudget: boolean;
  /**
   * The sentence a confirmation shows before anything runs.
   *
   * Composed here rather than at the call site so no surface can offer this
   * without saying what leaves the machine.
   */
  disclosure: string;
}

/**
 * Decide what a build would do, and return it rather than doing it.
 *
 * Everything the confirmation needs is in the result: which embedder, what
 * leaves the machine, how many files and chunks, and what was refused and why.
 * A plan that could not be inspected separately from the act would make the
 * privacy rule a comment.
 */
export function planCodebaseIndex(
  candidates: readonly IndexCandidate[],
  embedder: EmbedderDescriptor,
  options: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
  budget: IndexBudget = DEFAULT_INDEX_BUDGET,
): IndexPlan {
  const included: IndexPlan['included'] = [];
  const excluded: IndexPlan['excluded'] = [];
  let chunkCount = 0;
  let overBudget = false;

  for (const candidate of candidates) {
    if (!isIndexablePath(candidate.path)) {
      excluded.push({ path: candidate.path, reason: 'not-source' });
      continue;
    }
    if (candidate.content.length === 0 || candidate.content.trim().length === 0) {
      excluded.push({ path: candidate.path, reason: 'empty' });
      continue;
    }
    if (candidate.content.length > MAX_INDEXED_FILE_BYTES) {
      excluded.push({ path: candidate.path, reason: 'too-large' });
      continue;
    }
    // A NUL byte means this is not text, whatever the extension said.
    if (candidate.content.includes('\u0000')) {
      excluded.push({ path: candidate.path, reason: 'binary' });
      continue;
    }
    // Checked before chunking, so a secret never reaches a vector at all.
    if (looksLikeSecret(candidate.content)) {
      excluded.push({ path: candidate.path, reason: 'looks-like-secret' });
      continue;
    }
    const chunks = chunkSource(candidate.path, candidate.content, options);
    if (chunks.length === 0) {
      excluded.push({ path: candidate.path, reason: 'empty' });
      continue;
    }
    if (chunkCount + chunks.length > budget.maxChunks) {
      overBudget = true;
      excluded.push({ path: candidate.path, reason: 'over-budget' });
      continue;
    }
    chunkCount += chunks.length;
    included.push({ path: candidate.path, hash: contentHash(candidate.content), chunks });
  }

  return {
    embedder,
    included,
    excluded,
    chunkCount,
    candidateCount: candidates.length,
    overBudget,
    disclosure: describeIndexPlan(embedder, included.length, chunkCount, overBudget),
  };
}

function describeIndexPlan(
  embedder: EmbedderDescriptor,
  fileCount: number,
  chunkCount: number,
  overBudget: boolean,
): string {
  const scale = `${fileCount} file${fileCount === 1 ? '' : 's'} in ${chunkCount} chunk${chunkCount === 1 ? '' : 's'}`;
  const remainder = overBudget ? ' Some files were left out by the chunk budget, and the index will say so.' : '';
  return embedder.kind === 'remote-model'
    ? `${scale} would be sent to ${embedder.label}. ${embedder.leavesTheMachine} Embedding a repository means sending the repository.${remainder}`
    : `${scale} would be embedded by ${embedder.label}. ${embedder.leavesTheMachine}${remainder}`;
}

// ── Building ─────────────────────────────────────────────────────

/**
 * Run a plan.
 *
 * The embedder is called in batches and its output is checked rather than
 * trusted: a model that returns the wrong number of vectors, or vectors of the
 * wrong width, produces a **failed build** rather than an index that is quietly
 * misaligned — the worst possible outcome here, since every subsequent search
 * would return confident nonsense and nothing would look wrong.
 */
export async function buildCodebaseIndex(
  plan: IndexPlan,
  embedder: Embedder,
  now: string,
  batchSize = 64,
): Promise<CodebaseIndex> {
  const chunks: IndexedChunk[] = [];
  const files: IndexedFile[] = [];
  const flat = plan.included.flatMap(file =>
    file.chunks.map(chunk => ({ chunk, hash: file.hash })));

  for (let offset = 0; offset < flat.length; offset += batchSize) {
    const batch = flat.slice(offset, offset + batchSize);
    const vectors = await embedder.embed(batch.map(entry => entry.chunk.text));
    if (vectors.length !== batch.length) {
      throw new Error(
        `The embedder returned ${vectors.length} vectors for ${batch.length} chunks. `
        + 'Refusing to build a misaligned index — every search against one would look correct and be wrong.',
      );
    }
    for (const [position, entry] of batch.entries()) {
      const vector = vectors[position]!;
      if (vector.length !== embedder.descriptor.dimensions) {
        throw new Error(
          `The embedder returned a ${vector.length}-dimension vector where ${embedder.descriptor.dimensions} was declared. `
          + 'Refusing to build an index whose vectors cannot be compared.',
        );
      }
      chunks.push({
        id: entry.chunk.id,
        path: entry.chunk.path,
        startLine: entry.chunk.startLine,
        endLine: entry.chunk.endLine,
        fileHash: entry.hash,
        vector,
      });
    }
  }

  for (const file of plan.included) {
    files.push({ path: file.path, hash: file.hash, chunkCount: file.chunks.length });
  }

  return {
    version: 1,
    builtAt: now,
    embedder: embedder.descriptor,
    files,
    chunks,
    excluded: plan.excluded,
    candidateCount: plan.candidateCount,
  };
}

// ── Freshness ────────────────────────────────────────────────────

export interface IndexFreshness {
  /** Indexed files whose content still matches. */
  fresh: number;
  /** Indexed files whose content has changed since. Their chunks are excluded. */
  stale: string[];
  /** Indexed files that are no longer present at all. */
  missing: string[];
  /** Present, indexable files the index has never seen. */
  unindexed: string[];
  /** Whether anything at all is still current. */
  usable: boolean;
}

/**
 * Compare an index with the working tree.
 *
 * `current` is the caller's map of path to content hash for everything
 * indexable *now*. Three failure modes are kept apart because they need
 * different reactions: `stale` is a rebuild, `missing` is a deletion, and
 * `unindexed` is work the index has simply never covered.
 */
export function indexFreshness(
  index: CodebaseIndex,
  current: ReadonlyMap<string, string>,
): IndexFreshness {
  const stale: string[] = [];
  const missing: string[] = [];
  let fresh = 0;

  for (const file of index.files) {
    const hash = current.get(file.path);
    if (hash === undefined) {
      missing.push(file.path);
    } else if (hash !== file.hash) {
      stale.push(file.path);
    } else {
      fresh += 1;
    }
  }

  const indexed = new Set(index.files.map(file => file.path));
  const unindexed = [...current.keys()].filter(path => !indexed.has(path));

  return { fresh, stale, missing, unindexed, usable: fresh > 0 };
}

// ── Searching ────────────────────────────────────────────────────

export interface SearchCoverage {
  /** Files whose chunks were eligible for this search. */
  freshFiles: number;
  /** Everything indexable in the tree right now. */
  totalFiles: number;
  staleFiles: number;
  unindexedFiles: number;
  builtAt: string;
  /** Days since the build, so "six days ago" needs no second computation. */
  ageDays: number;
  embedder: EmbedderDescriptor;
  /**
   * The sentence a surface shows beside the results.
   *
   * Composed here so no caller can present results without their coverage —
   * three hits from a tenth of the repository is a different answer from three
   * hits from all of it, and a bare list cannot tell them apart.
   */
  summary: string;
}

export interface SearchHit {
  chunkId: string;
  path: string;
  startLine: number;
  endLine: number;
  /** Cosine similarity, clamped at zero. */
  score: number;
}

export interface SearchOutcome {
  hits: SearchHit[];
  coverage: SearchCoverage;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Cosine similarity over equal-width vectors, clamped at zero. */
export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return Math.max(0, dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)));
}

export interface SearchOptions {
  limit: number;
  /** Below this, a hit is noise. Cosine over unrelated text is rarely zero. */
  minimumScore: number;
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = { limit: 10, minimumScore: 0.15 };

/**
 * Search the index.
 *
 * A chunk whose file has changed is **excluded**, not ranked lower and not
 * flagged: the text at those line numbers is no longer the text that was
 * embedded, so the result would be a confident pointer at something else. The
 * same applies to a file that has been deleted.
 *
 * At most two hits per file, so one large well-matched file cannot fill the
 * whole result set — the failure that makes a search feel broken while working
 * exactly as written.
 */
export function searchCodebaseIndex(
  index: CodebaseIndex,
  queryVector: readonly number[],
  current: ReadonlyMap<string, string>,
  now: number,
  options: SearchOptions = DEFAULT_SEARCH_OPTIONS,
): SearchOutcome {
  const freshness = indexFreshness(index, current);
  const excludedPaths = new Set([...freshness.stale, ...freshness.missing]);

  const scored = index.chunks
    .filter(chunk => !excludedPaths.has(chunk.path))
    .map(chunk => ({
      chunkId: chunk.id,
      path: chunk.path,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      score: cosineSimilarity(queryVector, chunk.vector),
    }))
    .filter(hit => hit.score >= options.minimumScore)
    .sort((a, b) => (b.score - a.score) || (a.chunkId < b.chunkId ? -1 : 1));

  const perFile = new Map<string, number>();
  const hits: SearchHit[] = [];
  for (const hit of scored) {
    const seen = perFile.get(hit.path) ?? 0;
    if (seen >= 2) {
      continue;
    }
    perFile.set(hit.path, seen + 1);
    hits.push(hit);
    if (hits.length >= options.limit) {
      break;
    }
  }

  const built = Date.parse(index.builtAt);
  const ageDays = Number.isFinite(built) ? Math.max(0, Math.floor((now - built) / MS_PER_DAY)) : 0;
  const coverage: SearchCoverage = {
    freshFiles: freshness.fresh,
    totalFiles: current.size,
    staleFiles: freshness.stale.length,
    unindexedFiles: freshness.unindexed.length,
    builtAt: index.builtAt,
    ageDays,
    embedder: index.embedder,
    summary: describeCoverage(
      hits.length,
      freshness.fresh,
      current.size,
      ageDays,
      index.embedder,
    ),
  };
  return { hits, coverage };
}

function describeCoverage(
  hitCount: number,
  freshFiles: number,
  totalFiles: number,
  ageDays: number,
  embedder: EmbedderDescriptor,
): string {
  const scope = totalFiles === 0
    ? 'an index with nothing current to compare against'
    : `an index currently covering ${freshFiles} of ${totalFiles} file${totalFiles === 1 ? '' : 's'}`;
  const age = ageDays === 0 ? 'built today' : `built ${ageDays} day${ageDays === 1 ? '' : 's'} ago`;
  const caveat = embedder.semantic
    ? ''
    : ` These vectors come from ${embedder.label}, which matches shared vocabulary rather than shared meaning — a thin result here is not evidence the code is absent.`;
  return `${hitCount} result${hitCount === 1 ? '' : 's'} from ${scope}, ${age}.${caveat}`;
}

/**
 * What retrieval may and may not be used for, stated to the agent that gets it.
 *
 * Two things. Retrieved source is **evidence, not an answer**: it says what the
 * code does at a line range, and the surrounding decisions live in project
 * memory, which reading the code does not recover. And a thin result is **not a
 * finding about the codebase** — especially on the token-hash embedder, where it
 * usually means the query and the code chose different words for the same idea.
 */
export function buildRetrievalPreamble(coverage: SearchCoverage): string {
  return [
    'These excerpts were retrieved from an index of this repository, not read in full.',
    coverage.summary,
    '',
    'Two things follow. Read the files before concluding anything: an excerpt is a line',
    'range, and the reason it is written that way is usually just outside it.',
    '',
    'And a thin result is not evidence that something does not exist here. It means the',
    'index did not match, which is a fact about the query and the index rather than about',
    'the codebase. Say so rather than concluding the code is absent.',
  ].join('\n');
}
