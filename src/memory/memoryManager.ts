import type { MemoryDocumentClass, MemoryEntry, MemoryEvidenceType, MemoryScanResult, MemoryUpsertResult } from '../types.js';
import * as vscode from 'vscode';
import { scanMemoryEntry } from './memoryScanner.js';
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

export { MAX_QUERY_RESULTS } from '../constants.js';

/**
 * Memory manager – interface to the SSOT folder structure.
 * Handles reading, writing, indexing, and semantic retrieval.
 *
 * Uses a local hashed embedding/vector index plus lexical scoring.
 */
export class MemoryManager {
  private entries: MemoryEntry[] = [];
  private scanResults = new Map<string, MemoryScanResult>();
  /** Root URI of the SSOT folder. Set after loadFromDisk(). */
  private rootUri: vscode.Uri | undefined;

  /**
   * Query the SSOT for entries relevant to the input.
   * Uses hybrid keyword + hash-vector scoring (not neural semantic search).
   * Returns a ranked list of memory slices.
   */
  async queryRelevant(query: string, maxResults = 5): Promise<MemoryEntry[]> {
    const clamped = Math.min(Math.max(1, maxResults), MAX_QUERY_RESULTS);
    const terms = tokenize(query);
    const queryEmbedding = embedText(query);
    const queryMode = inferMemoryQueryMode(query);

    // Exclude entries that failed the memory scan (blocked status)
    const safeEntries = this.entries.filter(
      entry => this.scanResults.get(entry.path)?.status !== 'blocked',
    );

    if (terms.length === 0) {
      return safeEntries.slice(0, clamped);
    }

    return safeEntries
      .map(entry => ({
        entry,
        score: scoreEntry(entry, terms, queryEmbedding, queryMode),
      }))
      .filter(candidate => candidate.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(candidate => candidate.entry)
      .slice(0, clamped);
  }

  /**
   * Add or update a memory entry in the index.
   * Returns structured feedback so callers know if the write succeeded.
   */
  upsert(entry: MemoryEntry, content?: string): MemoryUpsertResult {
    // ── Validate fields ──────────────────────────────
    if (!isValidSsotPath(entry.path)) {
      return { status: 'rejected', reason: 'Invalid SSOT path. Use a relative path inside a known SSOT folder (e.g. "decisions/use-vitest.md").' };
    }
    if (entry.title.length > MAX_TITLE_LENGTH) {
      return { status: 'rejected', reason: `Title exceeds ${MAX_TITLE_LENGTH} characters.` };
    }
    if (entry.snippet.length > MAX_SNIPPET_LENGTH) {
      return { status: 'rejected', reason: `Snippet exceeds ${MAX_SNIPPET_LENGTH} characters.` };
    }

    // ── Scan content for prompt-injection / credentials ──
    const textToScan = content ?? entry.snippet;
    const scanResult = scanMemoryEntry(entry.path, textToScan);
    if (scanResult.status === 'blocked') {
      this.scanResults.set(entry.path, scanResult);
      return { status: 'rejected', reason: 'Content failed security scan: ' + scanResult.issues.map(i => i.message).join('; ') };
    }
    this.scanResults.set(entry.path, scanResult);

    // ── Sanitise tags ────────────────────────────────
    const safeTags = entry.tags
      .filter(t => t.length > 0 && t.length <= MAX_TAG_LENGTH)
      .slice(0, MAX_TAGS);

    const enriched: MemoryEntry = {
      ...entry,
      tags: safeTags,
      embedding: embedEntry(entry, content),
    };
    const idx = this.entries.findIndex(e => e.path === entry.path);
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

  /**
   * Remove an entry from the in-memory index and optionally delete the file on disk.
   * Returns true if the entry existed and was removed.
   */
  async delete(entryPath: string): Promise<boolean> {
    const idx = this.entries.findIndex(e => e.path === entryPath);
    if (idx < 0) {
      return false;
    }
    this.entries.splice(idx, 1);
    this.scanResults.delete(entryPath);

    // Delete the file on disk if we know the SSOT root
    if (this.rootUri) {
      const fileUri = vscode.Uri.joinPath(this.rootUri, entryPath);
      try {
        await vscode.workspace.fs.delete(fileUri);
      } catch {
        // File may not exist on disk (created in-memory only); ignore
      }
    }
    return true;
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
   * Redact sensitive values from a snippet before sending it to a model.
   * Applies to entries whose scan raised warnings (e.g. possible passwords).
   * Blocked entries should never reach this point — they are excluded by queryRelevant.
   */
  redactSnippet(entry: MemoryEntry): string {
    const scanResult = this.scanResults.get(entry.path);
    if (!scanResult || scanResult.status === 'clean') {
      return entry.snippet;
    }
    return redactSensitiveValues(entry.snippet);
  }

  /**
   * Load the in-memory index from the SSOT folder on disk.
   */
  async loadFromDisk(rootUri: vscode.Uri): Promise<void> {
    this.rootUri = rootUri;
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

      // Stop loading once the in-memory cap is reached
      if (loaded.length >= MAX_MEMORY_ENTRIES) {
        return;
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
      if (raw.byteLength > MAX_ENTRY_CONTENT_BYTES) {
        continue; // skip oversized documents
      }
      const content = Buffer.from(raw).toString('utf-8');
      const importMetadata = parseImportMetadata(content);
      const normalizedContent = stripImportMetadata(content);
      const stat = await vscode.workspace.fs.stat(childUri);
      const relativePath = normalizePath(childUri.path, rootPath);

      // Scan before indexing so blocked entries are excluded from queryRelevant
      scanned.set(relativePath, scanMemoryEntry(relativePath, normalizedContent));

      loaded.push({
        path: relativePath,
        title: extractTitle(name, normalizedContent),
        tags: extractTags(relativePath, normalizedContent),
        lastModified: new Date(stat.mtime).toISOString(),
        snippet: normalizedContent.slice(0, 500).trim(),
        sourcePaths: importMetadata?.sourcePaths,
        sourceFingerprint: importMetadata?.sourceFingerprint,
        bodyFingerprint: importMetadata?.bodyFingerprint,
        documentClass: inferMemoryDocumentClass(relativePath),
        evidenceType: inferMemoryEvidenceType(relativePath, importMetadata),
        embedding: embedText(buildMemoryEmbeddingSource({
          path: relativePath,
          title: extractTitle(name, normalizedContent),
          tags: extractTags(relativePath, normalizedContent),
          lastModified: new Date(stat.mtime).toISOString(),
          snippet: normalizedContent.slice(0, 500).trim(),
          sourcePaths: importMetadata?.sourcePaths,
          sourceFingerprint: importMetadata?.sourceFingerprint,
          bodyFingerprint: importMetadata?.bodyFingerprint,
          documentClass: inferMemoryDocumentClass(relativePath),
          evidenceType: inferMemoryEvidenceType(relativePath, importMetadata),
        }, normalizedContent)),
      });
    }
  }

  /**
   * Persist a single entry to disk as a markdown file inside the SSOT folder.
   * Fire-and-forget; errors are logged but do not block the caller.
   */
  private persistEntry(entry: MemoryEntry, content?: string): void {
    if (!this.rootUri) {
      return;
    }
    const fileUri = vscode.Uri.joinPath(this.rootUri, entry.path);
    const header = `# ${entry.title}\n\n`;
    const tagLine = entry.tags.length > 0 ? `Tags: ${entry.tags.map(t => `#${t}`).join(' ')}\n\n` : '';
    const body = typeof content === 'string' && content.trim().length > 0
      ? `${content.trimEnd()}\n`
      : `${header}${tagLine}${entry.snippet}\n`;
    void (async () => {
      try {
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(body, 'utf-8'));
      } catch {
        // Best-effort; directory may not exist yet for new SSOT sub-paths.
      }
    })();
  }
}

/**
 * Validate that a path is a safe, relative SSOT path.
 * Rejects absolute paths, parent traversal, and empty/blank paths.
 */
function isValidSsotPath(p: string): boolean {
  if (!p || p.trim().length === 0) {
    return false;
  }
  // Reject absolute paths (drive letters, leading / or \)
  if (/^[a-zA-Z]:/.test(p) || p.startsWith('/') || p.startsWith('\\')) {
    return false;
  }
  const segments = p.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0 || segments.some(s => s === '.' || s === '..')) {
    return false;
  }
  // Must end with a text-like extension
  if (!isTextLikeFile(segments[segments.length - 1])) {
    return false;
  }
  return true;
}

type MemoryQueryMode = 'summary-safe' | 'hybrid' | 'live-verify';

interface ParsedImportMetadata {
  sourcePaths: string[];
  sourceFingerprint?: string;
  bodyFingerprint?: string;
}

function scoreEntry(entry: MemoryEntry, terms: string[], queryEmbedding: number[], queryMode: MemoryQueryMode): number {
  const title = entry.title.toLowerCase();
  const snippet = entry.snippet.toLowerCase();
  const path = entry.path.toLowerCase();
  const tags = new Set(entry.tags.map(tag => tag.toLowerCase()));
  const sourcePaths = entry.sourcePaths ?? [];
  let score = 0;

  for (const term of terms) {
    if (title.includes(term)) {
      score += 3;
    }
    if (snippet.includes(term)) {
      score += 1;
    }
    if (path.includes(term)) {
      score += 2;
    }
    if (tags.has(term)) {
      score += 2;
    }
    for (const sourcePath of sourcePaths) {
      if (sourcePath.toLowerCase().includes(term)) {
        score += 2;
      }
    }
  }

  const vectorScore = cosineSimilarity(queryEmbedding, entry.embedding ?? []);
  score += vectorScore * 4;

  score += getDocumentClassBoost(entry, queryMode);
  score += getEvidenceBoost(entry, queryMode);
  score += getFreshnessBoost(entry.lastModified, queryMode);

  return score;
}

function embedEntry(entry: MemoryEntry, content?: string): number[] {
  return embedText(buildMemoryEmbeddingSource(entry, content));
}

function buildMemoryEmbeddingSource(entry: MemoryEntry, content?: string): string {
  return [
    entry.path,
    entry.title,
    entry.documentClass,
    entry.evidenceType,
    entry.tags.join(' '),
    (entry.sourcePaths ?? []).join(' '),
    content ?? entry.snippet,
  ]
    .filter(Boolean)
    .join('\n');
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

function parseImportMetadata(content: string): ParsedImportMetadata | undefined {
  const match = /<!-- atlasmind-import\n([\s\S]*?)\n-->\s*$/u.exec(content);
  if (!match) {
    return undefined;
  }

  const metadata = new Map<string, string>();
  for (const line of match[1].split(/\r?\n/)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) {
      continue;
    }
    metadata.set(line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim());
  }

  const sourcePaths = (metadata.get('source-paths') ?? '')
    .split('|')
    .map(value => value.trim())
    .filter(value => value.length > 0);

  return {
    sourcePaths,
    sourceFingerprint: metadata.get('source-fingerprint') ?? undefined,
    bodyFingerprint: metadata.get('body-fingerprint') ?? undefined,
  };
}

function inferMemoryQueryMode(query: string): MemoryQueryMode {
  if (/\b(current|latest|now|status|count|how many|list|which|where|exact|version|remaining|outstanding|completed|incomplete|open|enabled|disabled|value|setting|configured?)\b/i.test(query)) {
    return 'live-verify';
  }
  if (/\b(explain|overview|summary|summari[sz]e|architecture|design|decision|why|principle|background|context)\b/i.test(query)) {
    return 'summary-safe';
  }
  return 'hybrid';
}

function inferMemoryDocumentClass(entryPath: string): MemoryDocumentClass {
  const normalized = entryPath.replace(/\\/g, '/').toLowerCase();
  if (normalized === 'project_soul.md') {
    return 'project-soul';
  }

  const segment = normalized.split('/')[0] ?? '';
  switch (segment) {
    case 'architecture':
      return 'architecture';
    case 'roadmap':
      return 'roadmap';
    case 'decisions':
      return 'decision';
    case 'misadventures':
      return 'misadventure';
    case 'ideas':
      return 'idea';
    case 'domain':
      return 'domain';
    case 'operations':
      return 'operations';
    case 'agents':
      return 'agent';
    case 'skills':
      return 'skill';
    case 'index':
      return 'index';
    default:
      return 'other';
  }
}

function inferMemoryEvidenceType(entryPath: string, metadata: ParsedImportMetadata | undefined): MemoryEvidenceType {
  const normalized = entryPath.replace(/\\/g, '/').toLowerCase();
  if (normalized.startsWith('index/')) {
    return 'generated-index';
  }
  if ((metadata?.sourcePaths.length ?? 0) > 0 || metadata?.sourceFingerprint) {
    return 'imported';
  }
  return 'manual';
}

function getDocumentClassBoost(entry: MemoryEntry, queryMode: MemoryQueryMode): number {
  const documentClass = entry.documentClass ?? inferMemoryDocumentClass(entry.path);
  if (queryMode === 'live-verify') {
    switch (documentClass) {
      case 'roadmap':
      case 'operations':
      case 'decision':
      case 'domain':
        return 1.2;
      case 'index':
        return -1.2;
      case 'idea':
      case 'misadventure':
        return -0.4;
      default:
        return 0.2;
    }
  }

  if (queryMode === 'summary-safe') {
    switch (documentClass) {
      case 'project-soul':
      case 'architecture':
      case 'decision':
      case 'domain':
        return 1.1;
      case 'index':
        return -0.3;
      default:
        return 0.3;
    }
  }

  return documentClass === 'index' ? -0.5 : 0.5;
}

function getEvidenceBoost(entry: MemoryEntry, queryMode: MemoryQueryMode): number {
  const evidenceType = entry.evidenceType ?? 'manual';
  const hasSourcePaths = (entry.sourcePaths?.length ?? 0) > 0;
  if (queryMode === 'live-verify') {
    if (evidenceType === 'generated-index') {
      return -1.5;
    }
    if (hasSourcePaths) {
      return 2.5;
    }
    return 0;
  }

  if (queryMode === 'summary-safe') {
    return evidenceType === 'manual' ? 0.8 : evidenceType === 'generated-index' ? -0.2 : 0.4;
  }

  return hasSourcePaths ? 1 : evidenceType === 'generated-index' ? -0.5 : 0.3;
}

function getFreshnessBoost(lastModified: string, queryMode: MemoryQueryMode): number {
  const timestamp = Date.parse(lastModified);
  if (!Number.isFinite(timestamp)) {
    return 0;
  }

  const ageDays = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  const freshness = Math.max(0, 1 - Math.min(ageDays, 365) / 365);
  return queryMode === 'live-verify'
    ? freshness * 1.5
    : queryMode === 'hybrid'
      ? freshness * 0.8
      : freshness * 0.4;
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
