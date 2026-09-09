import { describe, expect, it } from 'vitest';
import { sanitizeCodebaseIndex } from '../../src/core/codebaseIndexStore';
import type { CodebaseIndex } from '../../src/core/codebaseIndex';

const VALID: CodebaseIndex = {
  version: 1,
  builtAt: '2026-09-09T12:00:00.000Z',
  embedder: {
    id: 'token-hash',
    kind: 'token-hash',
    label: 'the built-in token-hash embedder',
    dimensions: 3,
    leavesTheMachine: 'Nothing.',
    semantic: false,
  },
  files: [{ path: 'src/a.ts', hash: 'abcd1234', chunkCount: 1 }],
  chunks: [{
    id: 'src/a.ts#1-10',
    path: 'src/a.ts',
    startLine: 1,
    endLine: 10,
    fileHash: 'abcd1234',
    vector: [1, 0, 0],
  }],
  excluded: [],
  candidateCount: 1,
};

const withChunk = (vector: unknown): unknown => ({
  ...VALID,
  chunks: [{ ...VALID.chunks[0], vector }],
});

describe('a stored index is validated, not trusted', () => {
  it('accepts a well-formed one unchanged', () => {
    expect(sanitizeCodebaseIndex(JSON.parse(JSON.stringify(VALID)))).toEqual(VALID);
  });

  it('refuses anything that is not an object', () => {
    for (const input of [undefined, null, 7, 'text', []]) {
      expect(sanitizeCodebaseIndex(input)).toBeUndefined();
    }
  });

  it('refuses a version it does not recognise', () => {
    expect(sanitizeCodebaseIndex({ ...VALID, version: 2 })).toBeUndefined();
  });

  it('refuses an index whose vectors are the wrong width for its own embedder', () => {
    // The check that matters. A vector of the wrong size cannot be compared
    // with a query's, so cosine answers 0 for every chunk — an index that
    // returns nothing and looks perfectly healthy.
    expect(sanitizeCodebaseIndex(withChunk([1, 0]))).toBeUndefined();
    expect(sanitizeCodebaseIndex(withChunk([1, 0, 0, 0]))).toBeUndefined();
  });

  it('refuses rather than accepting the chunks that happen to be valid', () => {
    // Partial acceptance would leave an index reporting coverage it does not
    // have, and coverage is the number every search is presented with.
    const mixed = {
      ...VALID,
      chunks: [VALID.chunks[0], { ...VALID.chunks[0], id: 'src/a.ts#11-20', vector: [1, 0] }],
    };
    expect(sanitizeCodebaseIndex(mixed)).toBeUndefined();
  });

  it('refuses an embedder descriptor missing the fields a surface shows', () => {
    const { leavesTheMachine, ...rest } = VALID.embedder;
    expect(leavesTheMachine).toBeDefined();
    expect(sanitizeCodebaseIndex({ ...VALID, embedder: rest })).toBeUndefined();
  });

  it('refuses an unrecognised embedder kind', () => {
    expect(sanitizeCodebaseIndex({
      ...VALID,
      embedder: { ...VALID.embedder, kind: 'magic' },
    })).toBeUndefined();
  });

  it('refuses a chunk with no line range, which could not be opened', () => {
    expect(sanitizeCodebaseIndex({
      ...VALID,
      chunks: [{ ...VALID.chunks[0], startLine: 'first' }],
    })).toBeUndefined();
  });

  it('refuses a file entry with no hash, since freshness could not be judged', () => {
    expect(sanitizeCodebaseIndex({
      ...VALID,
      files: [{ path: 'src/a.ts', chunkCount: 1 }],
    })).toBeUndefined();
  });

  it('tolerates a missing exclusion list rather than refusing the index', () => {
    // Exclusions are a record of what was skipped, not something a search
    // depends on: losing them costs an explanation, not correctness.
    const { excluded, ...rest } = VALID;
    expect(excluded).toEqual([]);
    expect(sanitizeCodebaseIndex(rest)?.excluded).toEqual([]);
  });
});
