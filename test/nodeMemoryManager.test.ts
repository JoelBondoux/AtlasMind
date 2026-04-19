import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { NodeMemoryManager } from '../src/cli/nodeMemoryManager';
import type { MemoryEntry } from '../src/types';

describe('NodeMemoryManager JSON store conversion', () => {
  const tmpDir = path.join(__dirname, 'tmpMemoryStore');
  let manager: NodeMemoryManager;

  beforeEach(async () => {
    // Ensure a clean temporary directory.
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.mkdir(tmpDir, { recursive: true });
    manager = new NodeMemoryManager();
    await manager.loadFromDisk(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should load an empty store when no memoryStore.json exists', async () => {
    const entries = manager.listEntries();
    expect(entries).toEqual([]);
  });

  it('should upsert a new entry and persist it', async () => {
    const entry: MemoryEntry = {
      path: 'test/entry1.md',
      title: 'Test Entry',
      tags: ['test'],
      lastModified: new Date().toISOString(),
      snippet: 'This is a test snippet',
      sourcePaths: [],
      documentClass: 'default',
      evidenceType: 'simple',
      embedding: []
    };

    const result = await manager.upsert(entry);
    expect(result.status).toBe('created');

    // Reload the store in a new manager instance
    const manager2 = new NodeMemoryManager();
    await manager2.loadFromDisk(tmpDir);
    const loadedEntries = manager2.listEntries();
    expect(loadedEntries.length).toBe(1);
    expect(loadedEntries[0].title).toBe('Test Entry');
  });

  it('should update an existing entry', async () => {
    const entry: MemoryEntry = {
      path: 'test/entry2.md',
      title: 'Initial Title',
      tags: ['init'],
      lastModified: new Date().toISOString(),
      snippet: 'Initial snippet',
      sourcePaths: [],
      documentClass: 'default',
      evidenceType: 'simple',
      embedding: []
    };

    await manager.upsert(entry);

    // Update the entry
    const updatedEntry = { ...entry, title: 'Updated Title', snippet: 'Updated snippet', tags: ['update'] };
    const result = await manager.upsert(updatedEntry);
    expect(result.status).toBe('updated');

    const manager2 = new NodeMemoryManager();
    await manager2.loadFromDisk(tmpDir);
    const loaded = manager2.listEntries().find(e => e.path === 'test/entry2.md');
    expect(loaded?.title).toBe('Updated Title');
    expect(loaded?.snippet).toBe('Updated snippet');
  });

  it('should delete an entry and persist the removal', async () => {
    const entry: MemoryEntry = {
      path: 'test/entry3.md',
      title: 'Delete Me',
      tags: ['delete'],
      lastModified: new Date().toISOString(),
      snippet: 'To be deleted',
      sourcePaths: [],
      documentClass: 'default',
      evidenceType: 'simple',
      embedding: []
    };

    await manager.upsert(entry);
    let loadedEntries = manager.listEntries();
    expect(loadedEntries.length).toBe(1);

    const success = await manager.delete(entry.path);
    expect(success).toBe(true);

    const manager2 = new NodeMemoryManager();
    await manager2.loadFromDisk(tmpDir);
    loadedEntries = manager2.listEntries();
    expect(loadedEntries.length).toBe(0);
  });
});
