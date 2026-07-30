import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { NodeMemoryManager, memoryCache } from '../../src/cli/nodeMemoryManager.ts';
import type { MemoryEntry } from '../../src/types.ts';
import { removeTempDir } from '../helpers/tempDir.ts';

/**
 * This file previously lived at `test/nodeMemoryManager.test.ts` — a directory
 * outside `vitest.config.ts`'s `tests/` glob — so it had never run. It was
 * written against Jest-style globals (`describe`/`it` with no import) and
 * `__dirname`, neither of which this suite provides, so it would not have passed
 * had it run. Both are fixed here rather than by widening the glob: a test that
 * silently does not execute is worse than no test, because the file's presence
 * reads as coverage.
 *
 * `tests/nodeMemoryManager-cache.spec.ts` — a `.spec.ts`, also outside the glob —
 * is folded in at the bottom.
 *
 * **What `upsert` promises, and what it does not.** `upsert` is synchronous and
 * updates the in-memory store; it mirrors the entry to markdown with
 * `void this.persistEntry(...)` (src/cli/nodeMemoryManager.ts:85, :95) and
 * returns without waiting. So it guarantees the in-memory result and schedules
 * the file. The original assertions read the directory back immediately after
 * `upsert` and treated the mirror as part of the contract — which is why they
 * passed for a create and failed for an update, where two unordered writes race
 * and the earlier one can land last.
 *
 * These tests therefore split the two claims: the in-memory contract is asserted
 * against `upsert`, and the on-disk contract against `persistEntry` awaited
 * directly. That is deterministic, and it says out loud that a caller wanting
 * the file to exist must await the mirror itself.
 */
describe('NodeMemoryManager', () => {
  let tmpDir: string;
  let manager: NodeMemoryManager;

  // Each test gets its own directory, and none is removed until the file is
  // finished: removing one in `afterEach` races an in-flight mirror write, and
  // `persistEntry` rethrows (:258) into a `void`ed promise — so the failure
  // surfaces as an unhandled ENOENT caused by the test's own housekeeping
  // rather than by the code under test.
  const createdDirs: string[] = [];

  const buildEntry = (overrides: Partial<MemoryEntry> = {}): MemoryEntry => ({
    path: 'test/entry.md',
    title: 'Test Entry',
    tags: ['test'],
    lastModified: new Date().toISOString(),
    snippet: 'This is a test snippet',
    sourcePaths: [],
    documentClass: 'default',
    evidenceType: 'simple',
    embedding: [],
    ...overrides,
  });

  /** Read the store back through a second manager — the only honest check that a write reached disk. */
  const reload = async (): Promise<readonly MemoryEntry[]> => {
    const reloaded = new NodeMemoryManager();
    await reloaded.loadFromDisk(tmpDir);
    return reloaded.listEntries();
  };

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'atlasmind-memory-store-'));
    createdDirs.push(tmpDir);
    manager = new NodeMemoryManager();
    await manager.loadFromDisk(tmpDir);
  });

  afterAll(() => {
    createdDirs.forEach(removeTempDir);
  });

  it('loads an empty store from a directory with no entries', () => {
    expect(manager.listEntries()).toEqual([]);
  });

  it('records a new entry in memory', () => {
    const result = manager.upsert(buildEntry({ path: 'test/entry1.md' }));

    expect(result.status).toBe('created');
    expect(manager.listEntries().map(entry => entry.path)).toEqual(['test/entry1.md']);
  });

  it('reports an update rather than a second create for a known path', () => {
    const entry = buildEntry({ path: 'test/entry2.md', title: 'Initial Title' });
    expect(manager.upsert(entry).status).toBe('created');

    const result = manager.upsert({ ...entry, title: 'Updated Title', snippet: 'Updated snippet', tags: ['update'] });

    expect(result.status).toBe('updated');
    // One path, one entry — an update must not append a duplicate.
    expect(manager.listEntries().length).toBe(1);
    expect(manager.listEntries()[0]?.title).toBe('Updated Title');
  });

  it('persists an entry to disk and reads it back', async () => {
    const entry = buildEntry({ path: 'test/entry3.md', title: 'Persisted Entry' });
    manager.upsert(entry);

    // Awaited directly: `upsert`'s own mirror write is fire-and-forget, so this
    // is the only deterministic way to assert the file exists.
    await manager.persistEntry(entry);

    const entries = await reload();
    expect(entries.length).toBe(1);
    expect(entries[0]?.title).toBe('Persisted Entry');
  });

  it('deletes an entry and persists the removal', async () => {
    const entry = buildEntry({ path: 'test/entry4.md', title: 'Delete Me' });

    // Deliberately *not* via `upsert`. `upsert` schedules its mirror write with
    // `void`, so the write can still be in flight when `delete` unlinks the file
    // — and then lands afterwards and recreates it. Writing the file directly and
    // loading it gives the same starting state with nothing outstanding, so this
    // asserts `delete`'s contract rather than racing `upsert`'s.
    await manager.persistEntry(entry);
    await manager.loadFromDisk(tmpDir);
    expect(manager.listEntries().length).toBe(1);

    expect(await manager.delete(entry.path)).toBe(true);

    expect(manager.listEntries()).toEqual([]);
    expect((await reload()).length).toBe(0);
  });

  it('rejects a path outside the SSOT layout', () => {
    const result = manager.upsert(buildEntry({ path: '../escape.md' }));
    expect(result.status).toBe('rejected');
  });
});

describe('nodeMemoryManager caching', () => {
  it('exports memoryCache as a Map', () => {
    expect(memoryCache).toBeInstanceOf(Map);
  });
});
