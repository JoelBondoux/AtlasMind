/**
 * Where the codebase index lives, and — more importantly — where it does not.
 *
 * Every other register AtlasMind keeps is written into `project_memory/` and
 * committed, because a decision, a defect or an approval is something a team
 * shares and a diff should show. This one is the opposite on all three counts.
 *
 * **It is derived, not decided.** Nothing here is a judgement somebody made; it
 * is a cache of the working tree, reproducible from the working tree, and worth
 * nothing to a reviewer.
 *
 * **It is per developer.** Freshness is measured against *your* checkout. A
 * shared index would go stale on every colleague's branch and report coverage
 * about somebody else's files.
 *
 * **It would be a terrible thing to commit.** Thousands of float vectors that
 * change on every edit is the worst diff imaginable, and on a remote embedder it
 * would additionally be a committed derivative of the source sitting in the same
 * repository as the source.
 *
 * So it goes in extension storage, keyed by workspace, and the caller supplies
 * the directory. Reads never throw: a corrupt or absent index is *no index*, and
 * the surface says the index has not been built rather than failing to open.
 *
 * `fs`-only and `vscode`-free.
 */

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CodebaseIndex, EmbedderDescriptor } from './codebaseIndex.js';

export const CODEBASE_INDEX_FILE = 'codebase-index.json';

/**
 * A stored index, or `undefined`.
 *
 * Validated rather than trusted, because it is a file on disk that a previous
 * build wrote and a later build has to be able to refuse: a version it does not
 * recognise, or an index whose vectors are the wrong width for its own declared
 * embedder, is treated as absent rather than half-read. Half-read is the state
 * that produces confident nonsense.
 */
export function readCodebaseIndex(directory: string): CodebaseIndex | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path.join(directory, CODEBASE_INDEX_FILE), 'utf8'));
  } catch {
    return undefined;
  }
  return sanitizeCodebaseIndex(parsed);
}

function isDescriptor(value: unknown): value is EmbedderDescriptor {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const raw = value as Record<string, unknown>;
  return typeof raw['id'] === 'string'
    && typeof raw['label'] === 'string'
    && typeof raw['leavesTheMachine'] === 'string'
    && typeof raw['semantic'] === 'boolean'
    && typeof raw['dimensions'] === 'number'
    && Number.isFinite(raw['dimensions'])
    && raw['dimensions'] > 0
    && (raw['kind'] === 'token-hash' || raw['kind'] === 'local-model' || raw['kind'] === 'remote-model');
}

/**
 * Coerce a stored payload into an index, or refuse it entirely.
 *
 * There is deliberately no partial acceptance. Dropping the chunks that fail
 * validation and keeping the rest would leave an index that reports coverage it
 * does not have — and coverage is the one number every search is presented
 * with, so a quietly wrong one is worse than no index at all.
 */
export function sanitizeCodebaseIndex(input: unknown): CodebaseIndex | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const raw = input as Record<string, unknown>;
  if (raw['version'] !== 1 || !isDescriptor(raw['embedder'])) {
    return undefined;
  }
  const embedder = raw['embedder'];
  if (!Array.isArray(raw['chunks']) || !Array.isArray(raw['files'])) {
    return undefined;
  }

  const files = raw['files'].filter((file): file is { path: string; hash: string; chunkCount: number } =>
    typeof file === 'object' && file !== null
    && typeof (file as Record<string, unknown>)['path'] === 'string'
    && typeof (file as Record<string, unknown>)['hash'] === 'string');
  if (files.length !== raw['files'].length) {
    return undefined;
  }

  const chunks: CodebaseIndex['chunks'] = [];
  for (const chunk of raw['chunks']) {
    if (typeof chunk !== 'object' || chunk === null) {
      return undefined;
    }
    const entry = chunk as Record<string, unknown>;
    const vector = entry['vector'];
    // The width check is the one that matters: a vector of the wrong size
    // cannot be compared with a query's, and `cosineSimilarity` would answer 0
    // for every chunk — an index that returns nothing and looks fine.
    if (!Array.isArray(vector) || vector.length !== embedder.dimensions) {
      return undefined;
    }
    if (typeof entry['id'] !== 'string' || typeof entry['path'] !== 'string'
      || typeof entry['fileHash'] !== 'string'
      || typeof entry['startLine'] !== 'number' || typeof entry['endLine'] !== 'number') {
      return undefined;
    }
    chunks.push({
      id: entry['id'],
      path: entry['path'],
      startLine: entry['startLine'],
      endLine: entry['endLine'],
      fileHash: entry['fileHash'],
      vector: vector as number[],
    });
  }

  const excluded = Array.isArray(raw['excluded'])
    ? raw['excluded'].filter((entry): entry is { path: string; reason: CodebaseIndex['excluded'][number]['reason'] } =>
      typeof entry === 'object' && entry !== null
      && typeof (entry as Record<string, unknown>)['path'] === 'string'
      && typeof (entry as Record<string, unknown>)['reason'] === 'string')
    : [];

  return {
    version: 1,
    builtAt: typeof raw['builtAt'] === 'string' ? raw['builtAt'] : new Date(0).toISOString(),
    embedder,
    files,
    chunks,
    excluded,
    candidateCount: typeof raw['candidateCount'] === 'number' ? raw['candidateCount'] : files.length,
  };
}

export async function writeCodebaseIndex(directory: string, index: CodebaseIndex): Promise<void> {
  await mkdir(directory, { recursive: true });
  // No pretty-printing: this file is never read by a person and never diffed,
  // and indenting thousands of vectors triples it for nothing.
  await writeFile(path.join(directory, CODEBASE_INDEX_FILE), JSON.stringify(index), 'utf-8');
}
