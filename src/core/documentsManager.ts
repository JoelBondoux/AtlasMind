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
import { writeFile, mkdir } from 'node:fs/promises';
import type {
  DocumentsConfig,
  DocumentFilingEntry,
  DocumentAutoUpdateEntry,
  DocumentCadence,
} from '../types.js';

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
  try {
    const raw = readFileSync(path.join(workspaceRoot, DOCUMENTS_SSOT_PATH), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return isDocumentsConfig(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
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

  constructor(private readonly workspaceRoot: string | undefined) {
    this.config = workspaceRoot ? readDocumentsConfig(workspaceRoot) : undefined;
  }

  getConfig(): DocumentsConfig | undefined {
    return this.config;
  }

  hasConfig(): boolean {
    return this.config !== undefined;
  }

  /** Re-read the config from disk (e.g. after the file was edited externally). */
  reload(): DocumentsConfig | undefined {
    this.config = this.workspaceRoot ? readDocumentsConfig(this.workspaceRoot) : undefined;
    return this.config;
  }

  /**
   * Return the existing config, or seed + persist a starter filing system if
   * none exists yet. Persistence is best-effort: if the workspace is read-only
   * the seeded config is still returned in memory.
   */
  async ensureSeeded(seed: DocumentsSeedInput): Promise<DocumentsConfig> {
    if (this.config) {
      return this.config;
    }
    const seeded = seedDocumentsConfig(seed);
    this.config = seeded;
    if (this.workspaceRoot) {
      try {
        await writeDocumentsConfig(this.workspaceRoot, seeded);
      } catch {
        // Best-effort; the in-memory config is still served.
      }
    }
    return seeded;
  }

  /** Persist an updated config (e.g. from the dashboard editor) and cache it. */
  async save(config: DocumentsConfig): Promise<void> {
    this.config = config;
    if (this.workspaceRoot) {
      await writeDocumentsConfig(this.workspaceRoot, config);
    }
  }
}
