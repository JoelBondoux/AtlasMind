import type { MemoryEntry } from '../types.js';

/**
 * Memory manager – interface to the SSOT folder structure.
 * Handles reading, writing, indexing, and semantic retrieval.
 *
 * Stub implementation; real file-system + embeddings logic to follow.
 */
export class MemoryManager {
  private entries: MemoryEntry[] = [];

  /**
   * Query the SSOT for entries semantically relevant to the input.
   * Returns a ranked list of memory slices.
   */
  async queryRelevant(query: string, maxResults = 5): Promise<MemoryEntry[]> {
    // TODO: implement embeddings-based semantic search
    // For now, return any entries whose title or snippet includes query words
    const lowerQuery = query.toLowerCase();
    return this.entries
      .filter(
        e =>
          e.title.toLowerCase().includes(lowerQuery) ||
          e.snippet.toLowerCase().includes(lowerQuery),
      )
      .slice(0, maxResults);
  }

  /**
   * Add or update a memory entry in the index.
   */
  upsert(entry: MemoryEntry): void {
    const idx = this.entries.findIndex(e => e.path === entry.path);
    if (idx >= 0) {
      this.entries[idx] = entry;
    } else {
      this.entries.push(entry);
    }
  }

  /**
   * Load the in-memory index from the SSOT folder on disk.
   */
  async loadFromDisk(_rootUri: import('vscode').Uri): Promise<void> {
    // TODO: walk the SSOT folder structure and populate this.entries
  }

  listEntries(): readonly MemoryEntry[] {
    return this.entries;
  }
}
