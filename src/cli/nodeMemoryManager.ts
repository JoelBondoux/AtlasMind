import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { MemoryEntry, MemoryScanResult, MemoryUpsertResult } from '../types.js';
import { scanMemoryEntry } from '../memory/memoryScanner.js';
import {
  EMBEDDING_DIMENSIONS,
  MAX_MEMORY_ENTRIES,
  MAX_ENTRY_CONTENT_BYTES,
  MAX_SNIPPET_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  MAX_QUERY_RESULTS,
} from '../constants.js';

export class NodeMemoryManager {
  private entries: MemoryEntry[] = [];
  private scanResults = new Map<string, MemoryScanResult>();
  private rootPath: string | undefined;

  async queryRelevant(query: string, maxResults = 5): Promise<MemoryEntry[]> {
    const clamped = Math.min(Math.max(1, maxResults), MAX_QUERY_RESULTS);
    const terms = tokenize(query);
    const queryEmbedding = embedText(query);
    const safeEntries = this.entries.filter(entry => this.scanResults.get(entry.path)?.status !== 'blocked');

    if (terms.length === 0) {
      return safeEntries.slice(0, clamped);
    }

    return safeEntries
      .map(entry => ({ entry, score: scoreEntry(entry, terms, queryEmbedding) }))
      .filter(candidate => candidate.score > 0)
      .sort((left, right) => right.score - left.score)
      .map(candidate => candidate.entry)
      .slice(0, clamped);
  }

  upsert(entry: MemoryEntry, content?: string): MemoryUpsertResult {
    if (!isValidSsotPath(entry.path)) {
      return { status: 'rejected', reason: 'Invalid SSOT path. Use a relative path inside a known SSOT folder (e.g. "decisions/use-vitest.md").' };
    }
    if (entry.title.length > MAX_TITLE_LENGTH) {
      return { status: 'rejected', reason: `Title exceeds ${MAX_TITLE_LENGTH} characters.` };
    }
    if (entry.snippet.length > MAX_SNIPPET_LENGTH) {
      return { status: 'rejected', reason: `Snippet exceeds ${MAX_SNIPPET_LENGTH} characters.` };
    }

    const textToScan = content ?? entry.snippet;
    const scanResult = scanMemoryEntry(entry.path, textToScan);
    if (scanResult.status === 'blocked') {
      this.scanResults.set(entry.path, scanResult);
      return { status: 'rejected', reason: 'Content failed security scan: ' + scanResult.issues.map(issue => issue.message).join('; ') };
    }
    this.scanResults.set(entry.path, scanResult);

    const safeTags = entry.tags
      .filter(tag => tag.length > 0 && tag.length <= MAX_TAG_LENGTH)
      .slice(0, MAX_TAGS);

    const enriched: MemoryEntry = {
      ...entry,
      tags: safeTags,
      embedding: embedEntry(entry, content),
    };
    const idx = this.entries.findIndex(candidate => candidate.path === entry.path);
    if (idx >= 0) {
      this.entries[idx] = enriched;
      this.persistEntry(enriched, content);
      return { status: 'updated' };
    }

    if (this.entries.length >= MAX_MEMORY_ENTRIES) {
      return { status: 'rejected', reason: `Memory capacity reached (${MAX_MEMORY_ENTRIES} entries). Remove unused entries before adding new ones.` };
    }

    this.entries.push(enriched);
    this.persistEntry(enriched, content);
    return { status: 'created' };
  }

  async delete(entryPath: string): Promise<boolean> {
    const idx = this.entries.findIndex(entry => entry.path === entryPath);
    if (idx < 0) {
      return false;
    }
    this.entries.splice(idx, 1);
    this.scanResults.delete(entryPath);

    if (this.rootPath) {
      try {
        await fs.unlink(path.join(this.rootPath, entryPath));
      } catch {
        // Ignore missing file state.
      }
    }
    return true;
  }

  async loadFromDisk(rootPath: string): Promise<void> {
    this.rootPath = path.resolve(rootPath);
    const loaded: MemoryEntry[] = [];
    const scanned = new Map<string, MemoryScanResult>();
    await this.walk(this.rootPath, loaded, scanned, this.rootPath);
    this.entries = loaded;
    this.scanResults = scanned;
  }

  listEntries(): readonly MemoryEntry[] {
    return this.entries;
  }

  getScanResults(): ReadonlyMap<string, MemoryScanResult> {
    return this.scanResults;
  }

  getWarnedEntries(): MemoryScanResult[] {
    return [...this.scanResults.values()].filter(result => result.status === 'warned');
  }

  getBlockedEntries(): MemoryScanResult[] {
    return [...this.scanResults.values()].filter(result => result.status === 'blocked');
  }

  redactSnippet(entry: MemoryEntry): string {
    const scanResult = this.scanResults.get(entry.path);
    if (!scanResult || scanResult.status === 'clean') {
      return entry.snippet;
    }
    return redactSensitiveValues(entry.snippet);
  }

  private async walk(
    rootDir: string,
    loaded: MemoryEntry[],
    scanned: Map<string, MemoryScanResult>,
    absoluteRootPath: string,
  ): Promise<void> {
    let children: Array<import('node:fs').Dirent>;
    try {
      children = await fs.readdir(rootDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const child of children) {
      if (child.name === '.gitkeep') {
        continue;
      }
      if (loaded.length >= MAX_MEMORY_ENTRIES) {
        return;
      }

      const childPath = path.join(rootDir, child.name);
      if (child.isDirectory()) {
        await this.walk(childPath, loaded, scanned, absoluteRootPath);
        continue;
      }

      if (!child.isFile() || !isTextLikeFile(child.name)) {
        continue;
      }

      let raw: Buffer;
      try {
        raw = await fs.readFile(childPath);
      } catch {
        continue;
      }
      if (raw.byteLength > MAX_ENTRY_CONTENT_BYTES) {
        continue;
      }

      const content = raw.toString('utf-8');
      const normalizedContent = stripImportMetadata(content);
      const stat = await fs.stat(childPath);
      const relativePath = normalizePath(childPath, absoluteRootPath);
      scanned.set(relativePath, scanMemoryEntry(relativePath, normalizedContent));
      loaded.push({
        path: relativePath,
        title: extractTitle(child.name, normalizedContent),
        tags: extractTags(relativePath, normalizedContent),
        lastModified: new Date(stat.mtimeMs).toISOString(),
        snippet: normalizedContent.slice(0, 500).trim(),
        embedding: embedText(`${relativePath}\n${normalizedContent}`),
      });
    }
  }

  private persistEntry(entry: MemoryEntry, content?: string): void {
    if (!this.rootPath) {
      return;
    }
    const filePath = path.join(this.rootPath, entry.path);
    const header = `# ${entry.title}\n\n`;
    const tagLine = entry.tags.length > 0 ? `Tags: ${entry.tags.map(tag => `#${tag}`).join(' ')}\n\n` : '';
    const body = typeof content === 'string' && content.trim().length > 0
      ? `${content.trimEnd()}\n`
      : `${header}${tagLine}${entry.snippet}\n`;
    void (async () => {
      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, body, 'utf-8');
      } catch {
        // Best-effort persistence for CLI writes.
      }
    })();
  }
}

function isValidSsotPath(targetPath: string): boolean {
  if (!targetPath || targetPath.trim().length === 0) {
    return false;
  }
  if (/^[a-zA-Z]:/.test(targetPath) || targetPath.startsWith('/') || targetPath.startsWith('\\')) {
    return false;
  }
  const segments = targetPath.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0 || segments.some(segment => segment === '.' || segment === '..')) {
    return false;
  }
  return isTextLikeFile(segments[segments.length - 1] ?? '');
}

function scoreEntry(entry: MemoryEntry, terms: string[], queryEmbedding: number[]): number {
  const title = entry.title.toLowerCase();
  const snippet = entry.snippet.toLowerCase();
  const entryPath = entry.path.toLowerCase();
  const tags = new Set(entry.tags.map(tag => tag.toLowerCase()));
  let score = 0;

  for (const term of terms) {
    if (title.includes(term)) {
      score += 3;
    }
    if (snippet.includes(term)) {
      score += 1;
    }
    if (entryPath.includes(term)) {
      score += 2;
    }
    if (tags.has(term)) {
      score += 2;
    }
  }

  return score + (cosineSimilarity(queryEmbedding, entry.embedding ?? []) * 4);
}

function embedEntry(entry: MemoryEntry, content?: string): number[] {
  const source = [entry.path, entry.title, entry.tags.join(' '), content ?? entry.snippet]
    .filter(Boolean)
    .join('\n');
  return embedText(source);
}

function embedText(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const token of tokenize(text)) {
    const hash = hashToken(token);
    const index = Math.abs(hash) % EMBEDDING_DIMENSIONS;
    const sign = (hash & 1) === 0 ? 1 : -1;
    vector[index] += sign;
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
  if (norm === 0) {
    return vector;
  }
  return vector.map(value => value / norm);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_#-]+/)
    .map(term => term.trim())
    .filter(term => term.length >= 2);
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash | 0;
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  const length = Math.min(left.length, right.length);
  let sum = 0;
  for (let index = 0; index < length; index += 1) {
    sum += left[index]! * right[index]!;
  }
  return Math.max(0, sum);
}

function extractTitle(fileName: string, content: string): string {
  const heading = content
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line.startsWith('# '));

  return heading ? heading.slice(2).trim() : fileName;
}

function extractTags(relativePath: string, content: string): string[] {
  const tags = new Set<string>();

  for (const segment of relativePath.split('/')) {
    if (segment.length > 0 && !segment.includes('.')) {
      tags.add(segment.toLowerCase());
    }
  }

  for (const match of content.matchAll(/#([a-zA-Z0-9_-]+)/g)) {
    tags.add(match[1].toLowerCase());
  }

  return [...tags].slice(0, 12);
}

const REDACTION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /((?:api[_-]?key|apikey)\s*[:=]\s*['"`]?)[A-Za-z0-9_-]{20,}/gi,
    replacement: '$1***REDACTED***',
  },
  {
    pattern: /((?:token|bearer|auth[_-]?token)\s*[:=]\s*['"`]?)[A-Za-z0-9._-]{20,}/gi,
    replacement: '$1***REDACTED***',
  },
  {
    pattern: /(\bpassword\s*[:=]\s*['"`]?)\S{8,}/gi,
    replacement: '$1***REDACTED***',
  },
];

function redactSensitiveValues(text: string): string {
  let result = text;
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function stripImportMetadata(content: string): string {
  return content.replace(/\n?<!-- atlasmind-import\n[\s\S]*?\n-->\s*$/u, '').trimEnd();
}

function normalizePath(fullPath: string, rootPath: string): string {
  return path.relative(rootPath, fullPath).split(path.sep).join('/');
}

function isTextLikeFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.md')
    || lower.endsWith('.txt')
    || lower.endsWith('.json')
    || lower.endsWith('.yml')
    || lower.endsWith('.yaml');
}