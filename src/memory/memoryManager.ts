import type { MemoryEntry, MemoryScanResult } from '../types.js';
import * as vscode from 'vscode';
import { scanMemoryEntry } from './memoryScanner.js';

/**
 * Memory manager – interface to the SSOT folder structure.
 * Handles reading, writing, indexing, and semantic retrieval.
 *
 * Stub implementation; real file-system + embeddings logic to follow.
 */
export class MemoryManager {
  private entries: MemoryEntry[] = [];
  private scanResults = new Map<string, MemoryScanResult>();

  /**
   * Query the SSOT for entries semantically relevant to the input.
   * Returns a ranked list of memory slices.
   */
  async queryRelevant(query: string, maxResults = 5): Promise<MemoryEntry[]> {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .map(term => term.trim())
      .filter(term => term.length >= 2);

    // Exclude entries that failed the memory scan (blocked status)
    const safeEntries = this.entries.filter(
      entry => this.scanResults.get(entry.path)?.status !== 'blocked',
    );

    if (terms.length === 0) {
      return safeEntries.slice(0, maxResults);
    }

    return safeEntries
      .map(entry => ({ entry, score: scoreEntry(entry, terms) }))
      .filter(candidate => candidate.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(candidate => candidate.entry)
      .slice(0, maxResults);
  }

  /**
   * Add or update a memory entry in the index.
   */
  upsert(entry: MemoryEntry, content?: string): void {
    const idx = this.entries.findIndex(e => e.path === entry.path);
    if (idx >= 0) {
      this.entries[idx] = entry;
    } else {
      this.entries.push(entry);
    }
    // Scan the entry content if provided (used when upserting from disk-loaded content)
    if (content !== undefined) {
      this.scanResults.set(entry.path, scanMemoryEntry(entry.path, content));
    }
  }

  /**
   * Returns all scan results, keyed by entry path.
   * Useful for surfacing warnings in the UI or system prompt.
   */
  getScanResults(): ReadonlyMap<string, MemoryScanResult> {
    return this.scanResults;
  }

  /**
   * Returns only entries whose scan raised warnings (status === 'warned').
   */
  getWarnedEntries(): MemoryScanResult[] {
    return [...this.scanResults.values()].filter(r => r.status === 'warned');
  }

  /**
   * Returns only entries blocked from model context due to scan errors.
   */
  getBlockedEntries(): MemoryScanResult[] {
    return [...this.scanResults.values()].filter(r => r.status === 'blocked');
  }

  /**
   * Load the in-memory index from the SSOT folder on disk.
   */
  async loadFromDisk(rootUri: vscode.Uri): Promise<void> {
    const loaded: MemoryEntry[] = [];
    const scanned = new Map<string, MemoryScanResult>();
    await this.walk(rootUri, loaded, scanned, rootUri.path);
    this.entries = loaded;
    this.scanResults = scanned;
  }

  listEntries(): readonly MemoryEntry[] {
    return this.entries;
  }

  private async walk(
    root: vscode.Uri,
    loaded: MemoryEntry[],
    scanned: Map<string, MemoryScanResult>,
    rootPath: string,
  ): Promise<void> {
    let children: [string, vscode.FileType][];
    try {
      children = await vscode.workspace.fs.readDirectory(root);
    } catch {
      return;
    }

    for (const [name, type] of children) {
      if (name === '.gitkeep') {
        continue;
      }

      const childUri = vscode.Uri.joinPath(root, name);
      if (type === vscode.FileType.Directory) {
        await this.walk(childUri, loaded, scanned, rootPath);
        continue;
      }

      if (type !== vscode.FileType.File || !isTextLikeFile(name)) {
        continue;
      }

      const raw = await vscode.workspace.fs.readFile(childUri);
      const content = Buffer.from(raw).toString('utf-8');
      const stat = await vscode.workspace.fs.stat(childUri);
      const relativePath = normalizePath(childUri.path, rootPath);

      // Scan before indexing so blocked entries are excluded from queryRelevant
      scanned.set(relativePath, scanMemoryEntry(relativePath, content));

      loaded.push({
        path: relativePath,
        title: extractTitle(name, content),
        tags: extractTags(relativePath, content),
        lastModified: new Date(stat.mtime).toISOString(),
        snippet: content.slice(0, 500).trim(),
      });
    }
  }
}

function scoreEntry(entry: MemoryEntry, terms: string[]): number {
  const title = entry.title.toLowerCase();
  const snippet = entry.snippet.toLowerCase();
  let score = 0;

  for (const term of terms) {
    if (title.includes(term)) {
      score += 3;
    }
    if (snippet.includes(term)) {
      score += 1;
    }
  }

  return score;
}

function extractTitle(fileName: string, content: string): string {
  const heading = content
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line.startsWith('# '));

  if (heading) {
    return heading.slice(2).trim();
  }

  return fileName;
}

function extractTags(relativePath: string, content: string): string[] {
  const tags = new Set<string>();

  for (const segment of relativePath.split('/')) {
    if (segment.length > 0 && !segment.includes('.')) {
      tags.add(segment.toLowerCase());
    }
  }

  for (const tagMatch of content.matchAll(/#([a-zA-Z0-9_-]+)/g)) {
    tags.add(tagMatch[1].toLowerCase());
  }

  return [...tags].slice(0, 12);
}

function normalizePath(fullPath: string, rootPath: string): string {
  const normalizedFull = fullPath.replace(/\\/g, '/');
  const normalizedRoot = rootPath.replace(/\\/g, '/');
  if (!normalizedFull.startsWith(normalizedRoot)) {
    return normalizedFull;
  }

  return normalizedFull.slice(normalizedRoot.length).replace(/^\/+/, '');
}

function isTextLikeFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.md')
    || lower.endsWith('.txt')
    || lower.endsWith('.json')
    || lower.endsWith('.yml')
    || lower.endsWith('.yaml');
}
