/**
 * DocumentsManager — models a project's **document filing system** and the set
 * of documents that should be **kept updated automatically**.
 *
 * This is a *registry*, not an auto-writer. Following AtlasMind's safety-first,
 * deny-by-default posture, nothing in this module ever rewrites a user's
 * documents on a timer. It records where documents live and which ones matter,
 * persists that as the single source of truth (`documents.json`), and renders a
 * human-readable markdown mirror (`documents.md`). The dashboard then surfaces
 * freshness (using file mtimes vs. the recorded review baseline) and offers an
 * assisted "update with Atlas" action the user explicitly triggers.
 *
 * Like {@link ./deliveryManager}, the persistence helpers are free of the
 * `vscode` API (node `fs` only) so seeding/serialisation can be unit tested in
 * isolation, and no secret VALUES are ever stored — only labels and
 * workspace-relative paths.
 */

import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import { writeFile, mkdir, stat } from 'node:fs/promises';
import type {
  DocumentsConfig,
  DocumentFilingEntry,
  DocumentAutoUpdateEntry,
  DocumentCadence,
} from '../types.js';
import { interpretVersionedDocument, type VersionedDocumentRead } from './schemaMigration.js';

export const DOCUMENTS_SSOT_PATH = 'project_memory/operations/documents.json';
export const DOCUMENTS_SUMMARY_SSOT_PATH = 'project_memory/operations/documents.md';

const CADENCES: DocumentCadence[] = ['on-change', 'on-release', 'weekly', 'manual'];
const MAX_FIELD = 240;
const MAX_LONG = 2000;
const MAX_PATH = 400;
const MAX_ENTRIES = 200;

// ── Seeding ──────────────────────────────────────────────────────

export interface DocumentsSeedInput {
  /** Workspace-relative folders that already exist (e.g. docs/, wiki/). */
  presentDocFolders: string[];
  /** Workspace-relative markdown files worth keeping current (e.g. README.md). */
  keyDocs: string[];
}

/**
 * Build a sensible starter filing system from what the repository already has.
 * Purely in-memory; the caller decides whether to persist it. Conservative by
 * design — it only references paths the caller reports as present.
 */
export function seedDocumentsConfig(seed: DocumentsSeedInput): DocumentsConfig {
  const filing: DocumentFilingEntry[] = [];
  for (const folder of dedupe(seed.presentDocFolders).slice(0, 12)) {
    const clean = normalizeRelPath(folder);
    if (!clean) {
      continue;
    }
    filing.push({
      id: `filing-${slugify(clean)}`,
      label: prettyLabel(clean),
      path: clean,
      description: `Documents filed under ${clean}.`,
      pattern: '**/*.md',
    });
  }

  const autoUpdate: DocumentAutoUpdateEntry[] = [];
  for (const doc of dedupe(seed.keyDocs).slice(0, 12)) {
    const clean = normalizeRelPath(doc);
    if (!clean) {
      continue;
    }
    autoUpdate.push({
      id: `doc-${slugify(clean)}`,
      path: clean,
      label: prettyLabel(clean),
      sourceHint: 'Keep in step with feature, config, and version changes.',
      cadence: /changelog/i.test(clean) ? 'on-release' : 'on-change',
    });
  }

  return { version: 1, filing, autoUpdate, updatedAt: new Date().toISOString() };
}

// ── Persistence (node fs; vscode-free) ───────────────────────────

export function readDocumentsConfig(workspaceRoot: string): DocumentsConfig | undefined {
  return readDocumentsFile(workspaceRoot).config;
}

/**
 * Read the registry, distinguishing "no usable file" from "a file this build
 * must not touch".
 *
 * `preserveExisting` is true when the file was written by a *newer* AtlasMind:
 * it is intact and readable by that build, so seeding a default over it would
 * destroy real work. The plain {@link readDocumentsConfig} cannot express that
 * — both cases look like `undefined` — which is why the seeding path uses this.
 */
export function readDocumentsFile(workspaceRoot: string): VersionedDocumentRead<DocumentsConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path.join(workspaceRoot, DOCUMENTS_SSOT_PATH), 'utf8'));
  } catch {
    // Absent or unparseable: there is nothing to preserve.
    return { preserveExisting: false };
  }
  return interpretVersionedDocument('documents', parsed, isDocumentsConfig);
}

/**
 * Persist the config as JSON (source of truth) and regenerate the human-readable
 * markdown mirror alongside it. Both live in `project_memory/operations/`.
 */
export async function writeDocumentsConfig(workspaceRoot: string, config: DocumentsConfig): Promise<void> {
  const configPath = path.join(workspaceRoot, DOCUMENTS_SSOT_PATH);
  const summaryPath = path.join(workspaceRoot, DOCUMENTS_SUMMARY_SSOT_PATH);
  await mkdir(path.dirname(configPath), { recursive: true });
  const updated: DocumentsConfig = { ...config, updatedAt: new Date().toISOString() };
  await Promise.all([
    writeFile(configPath, JSON.stringify(updated, null, 2), 'utf-8'),
    writeFile(summaryPath, renderDocumentsMarkdown(updated), 'utf-8'),
  ]);
}

// ── Shelf folders ────────────────────────────────────────────────

export interface ShelfFolderResult {
  /** Workspace-relative folders that were created by this call. */
  created: string[];
  /** Folders that were left alone, with the reason why. */
  skipped: { path: string; reason: string }[];
}

/**
 * Which shelf folders in `next` are new relative to `previous`.
 *
 * Compared by **path**, not id: re-pointing an existing shelf at a different
 * folder is as much a new folder as adding a shelf is. Pure, so the caller
 * decides whether anything touches disk.
 */
export function newShelfPaths(next: DocumentsConfig, previous: DocumentsConfig | undefined): string[] {
  const before = new Set(
    (previous?.filing ?? []).map(entry => normalizeRelPath(entry.path)).filter(Boolean),
  );
  const out: string[] = [];
  for (const entry of next.filing) {
    const rel = normalizeRelPath(entry.path);
    if (rel && !before.has(rel) && !out.includes(rel)) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * Create the folders a set of shelves declares.
 *
 * Deliberately **create-only**: a shelf says where documents live, so declaring
 * one should make that folder exist — but nothing here writes, moves, or
 * replaces content. A path that is already a directory is a no-op; a path
 * occupied by a *file* is reported as skipped rather than disturbed; a path that
 * is not a safe workspace-relative path is refused. Paths are re-validated here
 * (not trusted from the caller) and the resolved target is re-checked against
 * the workspace root, since this is the point where an unsafe path would become
 * a directory outside the project.
 */
export async function createShelfFolders(workspaceRoot: string, relPaths: string[]): Promise<ShelfFolderResult> {
  const created: string[] = [];
  const skipped: { path: string; reason: string }[] = [];
  const root = path.resolve(workspaceRoot);

  for (const raw of dedupe(relPaths).slice(0, MAX_ENTRIES)) {
    const rel = normalizeRelPath(raw);
    if (!rel) {
      skipped.push({ path: clampStr(raw, MAX_PATH) || '(empty)', reason: 'not a safe workspace-relative path' });
      continue;
    }
    const abs = path.resolve(root, rel);
    // Defence in depth: normalizeRelPath already rejects traversal, but this is
    // the boundary where a miss would create a directory outside the project.
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      skipped.push({ path: rel, reason: 'resolves outside the workspace' });
      continue;
    }
    try {
      const info = await stat(abs);
      if (!info.isDirectory()) {
        skipped.push({ path: rel, reason: 'a file already exists at this path' });
      }
      continue; // Already a directory — nothing to do.
    } catch {
      // Does not exist yet — fall through and create it.
    }
    try {
      await mkdir(abs, { recursive: true });
      created.push(rel);
    } catch (error) {
      skipped.push({ path: rel, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { created, skipped };
}

// ── Validation / sanitisation ────────────────────────────────────

function isDocumentsConfig(value: unknown): value is DocumentsConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate['version'] === 1
    && Array.isArray(candidate['filing'])
    && Array.isArray(candidate['autoUpdate']);
}

function clampStr(value: unknown, max = MAX_FIELD): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function optStr(value: unknown, max = MAX_FIELD): string | undefined {
  const trimmed = clampStr(value, max);
  return trimmed.length > 0 ? trimmed : undefined;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || String(Date.now());
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map(v => v.trim()).filter(Boolean))];
}

function prettyLabel(rel: string): string {
  const base = rel.replace(/\/+$/, '').split('/').pop() || rel;
  return base.replace(/[-_]+/g, ' ').replace(/\.[a-z0-9]+$/i, '').trim() || rel;
}

/**
 * Coerce a user/agent-supplied path to a safe, workspace-relative POSIX path, or
 * `''` if it escapes the workspace. This is the security boundary for the
 * documents registry: absolute paths, drive letters, `..` traversal, and
 * backslashes are all rejected/normalised so a saved entry can never point
 * outside the project.
 */
export function normalizeRelPath(value: unknown): string {
  let raw = clampStr(value, MAX_PATH);
  if (!raw) {
    return '';
  }
  // Reject absolute paths and Windows drive letters outright.
  if (path.isAbsolute(raw) || /^[a-zA-Z]:[\\/]/.test(raw)) {
    return '';
  }
  raw = raw.replace(/\\/g, '/');
  // POSIX-normalise and reject anything that still climbs out of the workspace.
  const normalized = path.posix.normalize(raw).replace(/^\.\/+/, '').replace(/\/+$/, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized === '..' || normalized.includes('/../')) {
    return '';
  }
  return normalized;
}

function sanitizeCadence(value: unknown): DocumentCadence {
  const raw = clampStr(value, 40) as DocumentCadence;
  return CADENCES.includes(raw) ? raw : 'manual';
}

function sanitizeIsoDate(value: unknown): string | undefined {
  const raw = clampStr(value, 40);
  if (!raw) {
    return undefined;
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

/**
 * Coerce an untrusted payload (from the dashboard editor) into a well-formed
 * {@link DocumentsConfig}: strings are trimmed/length-capped, paths are made
 * safe & workspace-relative (traversal rejected), cadences are validated, ids
 * are de-duplicated/generated, entries with no usable path are dropped, and the
 * array sizes are capped. Returns `undefined` when the top-level shape is wrong.
 */
export function sanitizeDocumentsConfig(input: unknown): DocumentsConfig | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const raw = input as Record<string, unknown>;
  if (raw['version'] !== 1 || !Array.isArray(raw['filing']) || !Array.isArray(raw['autoUpdate'])) {
    return undefined;
  }

  const filingIds = new Set<string>();
  const filing: DocumentFilingEntry[] = [];
  for (const item of (raw['filing'] as unknown[]).slice(0, MAX_ENTRIES)) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const f = item as Record<string, unknown>;
    const cleanPath = normalizeRelPath(f['path']);
    if (!cleanPath) {
      continue;
    }
    const label = clampStr(f['label'], 120) || prettyLabel(cleanPath);
    let id = clampStr(f['id'], 80) || `filing-${slugify(cleanPath)}`;
    while (filingIds.has(id)) {
      id = `${id}-${filingIds.size}`;
    }
    filingIds.add(id);
    filing.push({
      id,
      label,
      path: cleanPath,
      ...(optStr(f['description'], MAX_LONG) ? { description: optStr(f['description'], MAX_LONG) } : {}),
      ...(optStr(f['pattern'], 120) ? { pattern: optStr(f['pattern'], 120) } : {}),
    });
  }

  const docIds = new Set<string>();
  const autoUpdate: DocumentAutoUpdateEntry[] = [];
  for (const item of (raw['autoUpdate'] as unknown[]).slice(0, MAX_ENTRIES)) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const d = item as Record<string, unknown>;
    const cleanPath = normalizeRelPath(d['path']);
    if (!cleanPath) {
      continue;
    }
    let id = clampStr(d['id'], 80) || `doc-${slugify(cleanPath)}`;
    while (docIds.has(id)) {
      id = `${id}-${docIds.size}`;
    }
    docIds.add(id);
    autoUpdate.push({
      id,
      path: cleanPath,
      ...(optStr(d['label'], 120) ? { label: optStr(d['label'], 120) } : {}),
      ...(optStr(d['sourceHint'], MAX_LONG) ? { sourceHint: optStr(d['sourceHint'], MAX_LONG) } : {}),
      cadence: sanitizeCadence(d['cadence']),
      ...(sanitizeIsoDate(d['lastReviewed']) ? { lastReviewed: sanitizeIsoDate(d['lastReviewed']) } : {}),
    });
  }

  return { version: 1, filing, autoUpdate, updatedAt: new Date().toISOString() };
}

// ── Markdown mirror ──────────────────────────────────────────────

const CADENCE_LABEL: Record<DocumentCadence, string> = {
  'on-change': 'When related code/config changes',
  'on-release': 'On every release',
  weekly: 'Weekly',
  manual: 'Manually (no reminder)',
};

/**
 * Render the natural-language companion document so a newcomer can read the
 * filing system and the auto-maintained list without opening the JSON.
 */
export function renderDocumentsMarkdown(config: DocumentsConfig): string {
  const lines: string[] = [];
  lines.push('# Document Management');
  lines.push('');
  lines.push('> Maintained by AtlasMind (Project Dashboard → Documents). This is the human-readable');
  lines.push('> mirror of `documents.json`; edit either and the other is kept in sync from the dashboard.');
  lines.push('');
  lines.push('AtlasMind never rewrites your documents automatically. This file records **where**');
  lines.push('documents live and **which** ones should be kept current, so the dashboard can flag');
  lines.push('staleness and offer an assisted update you trigger explicitly.');
  lines.push('');

  lines.push('## Filing system');
  lines.push('');
  if (config.filing.length === 0) {
    lines.push('_No document shelves defined yet._');
    lines.push('');
  } else {
    for (const entry of config.filing) {
      lines.push(`### ${entry.label} — \`${entry.path}${entry.pattern ? `/${entry.pattern}` : ''}\``);
      lines.push('');
      if (entry.description) {
        lines.push(entry.description);
        lines.push('');
      }
    }
  }

  lines.push('## Kept updated automatically');
  lines.push('');
  if (config.autoUpdate.length === 0) {
    lines.push('_No documents are tracked for automatic maintenance yet._');
    lines.push('');
  } else {
    for (const entry of config.autoUpdate) {
      lines.push(`- **\`${entry.path}\`**${entry.label ? ` — ${entry.label}` : ''}`);
      lines.push(`  - Update cadence: ${CADENCE_LABEL[entry.cadence]}`);
      if (entry.sourceHint) {
        lines.push(`  - Should track: ${entry.sourceHint}`);
      }
      lines.push(`  - Last reviewed: ${entry.lastReviewed ? entry.lastReviewed.slice(0, 10) : 'never'}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`_Last updated: ${config.updatedAt ?? 'unknown'}._`);
  lines.push('');
  return lines.join('\n');
}

// ── Service ──────────────────────────────────────────────────────

/**
 * Workspace-scoped holder for the documents config. Reads the persisted registry
 * at construction and serves it to the dashboard; seeds and persists a default
 * filing system on first use.
 */
export class DocumentsManager {
  private config: DocumentsConfig | undefined;
  /**
   * True when a file exists that this build must not overwrite — it was written
   * by a newer AtlasMind. Distinct from "no config", which is safe to seed over.
   */
  private preserveExisting = false;
  private notice: string | undefined;

  constructor(private readonly workspaceRoot: string | undefined) {
    this.applyRead();
  }

  private applyRead(): void {
    if (!this.workspaceRoot) {
      this.config = undefined;
      this.preserveExisting = false;
      this.notice = undefined;
      return;
    }
    const read = readDocumentsFile(this.workspaceRoot);
    this.config = read.config;
    this.preserveExisting = read.preserveExisting;
    this.notice = read.notice;
  }

  getConfig(): DocumentsConfig | undefined {
    return this.config;
  }

  hasConfig(): boolean {
    return this.config !== undefined;
  }

  /**
   * A message worth showing the user about the file itself — that it was
   * migrated forward, or that it is from a newer AtlasMind and was left alone.
   */
  getNotice(): string | undefined {
    return this.notice;
  }

  /** Re-read the config from disk (e.g. after the file was edited externally). */
  reload(): DocumentsConfig | undefined {
    this.applyRead();
    return this.config;
  }

  /**
   * Return the existing config, or seed + persist a starter filing system if
   * none exists yet. Persistence is best-effort: if the workspace is read-only
   * the seeded config is still returned in memory.
   *
   * **Never writes over a file from a newer AtlasMind.** That file is not
   * corrupt — this build simply cannot read it — so replacing it with a default
   * would destroy a working registry. In that case the seed is served in memory
   * only, and the reason is available from {@link getNotice}.
   */
  async ensureSeeded(seed: DocumentsSeedInput): Promise<DocumentsConfig> {
    if (this.config) {
      return this.config;
    }
    const seeded = seedDocumentsConfig(seed);
    this.config = seeded;
    if (this.workspaceRoot && !this.preserveExisting) {
      try {
        await writeDocumentsConfig(this.workspaceRoot, seeded);
      } catch {
        // Best-effort; the in-memory config is still served.
      }
    }
    return seeded;
  }

  /** Persist an updated config (e.g. from the dashboard editor) and cache it. */
  /**
   * Persist an updated config (e.g. from the dashboard editor) and cache it.
   *
   * Unlike seeding, this **does** write over a newer-format file: the user is
   * explicitly editing, and refusing their own edit would be its own kind of
   * data loss. The obligation this creates is that they must have been told
   * first — which is why the notice from {@link getNotice} is surfaced on the
   * Documents page rather than kept internal.
   */
  async save(config: DocumentsConfig): Promise<void> {
    this.config = config;
    if (this.workspaceRoot) {
      await writeDocumentsConfig(this.workspaceRoot, config);
      // The file on disk is now this build's format, so there is nothing left
      // to preserve and nothing left to warn about.
      this.preserveExisting = false;
      this.notice = undefined;
    }
  }
}
