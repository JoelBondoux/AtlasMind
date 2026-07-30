import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  sanitizeDocumentsConfig,
  seedDocumentsConfig,
  renderDocumentsMarkdown,
  normalizeRelPath,
  newShelfPaths,
  createShelfFolders,
} from '../../src/core/documentsManager.ts';
import type { DocumentsConfig } from '../../src/types.ts';
import { removeTempDir } from '../helpers/tempDir';

describe('normalizeRelPath — path safety boundary', () => {
  it('accepts a simple workspace-relative path', () => {
    expect(normalizeRelPath('docs/architecture.md')).toBe('docs/architecture.md');
  });

  it('normalises backslashes and leading ./', () => {
    expect(normalizeRelPath('.\\docs\\guide.md')).toBe('docs/guide.md');
  });

  it('strips a trailing slash from a folder', () => {
    expect(normalizeRelPath('docs/')).toBe('docs');
  });

  it('rejects parent-directory traversal', () => {
    expect(normalizeRelPath('../secrets.md')).toBe('');
    expect(normalizeRelPath('docs/../../etc/passwd')).toBe('');
  });

  it('rejects absolute paths and Windows drive letters', () => {
    expect(normalizeRelPath('/etc/passwd')).toBe('');
    expect(normalizeRelPath('C:\\Windows\\system32')).toBe('');
  });

  it('rejects non-strings and empty input', () => {
    expect(normalizeRelPath(undefined)).toBe('');
    expect(normalizeRelPath(42)).toBe('');
    expect(normalizeRelPath('   ')).toBe('');
  });
});

describe('sanitizeDocumentsConfig — untrusted payload boundary', () => {
  it('returns undefined for a non-config shape', () => {
    expect(sanitizeDocumentsConfig(null)).toBeUndefined();
    expect(sanitizeDocumentsConfig({ version: 2, filing: [], autoUpdate: [] })).toBeUndefined();
    expect(sanitizeDocumentsConfig({ version: 1, filing: 'nope', autoUpdate: [] })).toBeUndefined();
  });

  it('keeps valid entries, drops path-unsafe ones, and generates ids', () => {
    const clean = sanitizeDocumentsConfig({
      version: 1,
      filing: [
        { label: 'Docs', path: 'docs', pattern: '**/*.md' },
        { label: 'Escape', path: '../../etc' }, // traversal → dropped
      ],
      autoUpdate: [
        { path: 'README.md', cadence: 'on-change' },
        { path: '/abs/CHANGELOG.md', cadence: 'weekly' }, // absolute → dropped
      ],
    });
    expect(clean).toBeDefined();
    expect(clean!.filing).toHaveLength(1);
    expect(clean!.filing[0].path).toBe('docs');
    expect(clean!.filing[0].id).toBeTruthy();
    expect(clean!.autoUpdate).toHaveLength(1);
    expect(clean!.autoUpdate[0].path).toBe('README.md');
  });

  it('falls back to "manual" for an unknown cadence', () => {
    const clean = sanitizeDocumentsConfig({
      version: 1,
      filing: [],
      autoUpdate: [{ path: 'README.md', cadence: 'hourly' }],
    });
    expect(clean!.autoUpdate[0].cadence).toBe('manual');
  });

  it('de-duplicates colliding ids', () => {
    const clean = sanitizeDocumentsConfig({
      version: 1,
      filing: [
        { id: 'dup', label: 'A', path: 'a' },
        { id: 'dup', label: 'B', path: 'b' },
      ],
      autoUpdate: [],
    });
    const ids = clean!.filing.map(entry => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('drops an invalid lastReviewed but keeps a valid one', () => {
    const clean = sanitizeDocumentsConfig({
      version: 1,
      filing: [],
      autoUpdate: [
        { path: 'a.md', cadence: 'weekly', lastReviewed: 'not-a-date' },
        { path: 'b.md', cadence: 'weekly', lastReviewed: '2026-01-01T00:00:00.000Z' },
      ],
    });
    expect(clean!.autoUpdate[0].lastReviewed).toBeUndefined();
    expect(clean!.autoUpdate[1].lastReviewed).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('seedDocumentsConfig', () => {
  it('only references the folders and docs it is told exist', () => {
    const config = seedDocumentsConfig({
      presentDocFolders: ['docs', 'wiki'],
      keyDocs: ['README.md', 'CHANGELOG.md'],
    });
    expect(config.filing.map(f => f.path).sort()).toEqual(['docs', 'wiki']);
    expect(config.autoUpdate.map(a => a.path).sort()).toEqual(['CHANGELOG.md', 'README.md']);
    // CHANGELOG is release-cadence by heuristic; README tracks change.
    const changelog = config.autoUpdate.find(a => a.path === 'CHANGELOG.md');
    expect(changelog?.cadence).toBe('on-release');
  });

  it('produces an empty-but-valid config when nothing is present', () => {
    const config = seedDocumentsConfig({ presentDocFolders: [], keyDocs: [] });
    expect(config.version).toBe(1);
    expect(config.filing).toEqual([]);
    expect(config.autoUpdate).toEqual([]);
  });
});

describe('newShelfPaths', () => {
  const config = (paths: string[]): DocumentsConfig => ({
    version: 1,
    filing: paths.map((p, i) => ({ id: `f${i}`, label: p, path: p })),
    autoUpdate: [],
  });

  it('reports every shelf as new when there is no previous config', () => {
    expect(newShelfPaths(config(['docs', 'wiki']), undefined)).toEqual(['docs', 'wiki']);
  });

  it('reports only the added shelf', () => {
    expect(newShelfPaths(config(['docs', 'wiki']), config(['docs']))).toEqual(['wiki']);
  });

  it('treats a re-pointed shelf as a new folder', () => {
    const before: DocumentsConfig = { version: 1, filing: [{ id: 'f0', label: 'Docs', path: 'docs' }], autoUpdate: [] };
    const after: DocumentsConfig = { version: 1, filing: [{ id: 'f0', label: 'Docs', path: 'documentation' }], autoUpdate: [] };
    expect(newShelfPaths(after, before)).toEqual(['documentation']);
  });

  it('ignores unsafe and duplicate paths', () => {
    const next: DocumentsConfig = {
      version: 1,
      filing: [
        { id: 'a', label: 'A', path: '../escape' },
        { id: 'b', label: 'B', path: 'docs' },
        { id: 'c', label: 'C', path: 'docs' },
      ],
      autoUpdate: [],
    };
    expect(newShelfPaths(next, undefined)).toEqual(['docs']);
  });
});

describe('createShelfFolders', () => {
  const roots: string[] = [];
  const makeRoot = (): string => {
    const root = mkdtempSync(path.join(tmpdir(), 'atlasmind-shelves-'));
    roots.push(root);
    return root;
  };

  afterEach(() => {
    while (roots.length > 0) {
      removeTempDir(roots.pop()!);
    }
  });

  it('creates a nested folder and reports it', async () => {
    const root = makeRoot();
    const result = await createShelfFolders(root, ['docs/guides']);
    expect(result.created).toEqual(['docs/guides']);
    expect(result.skipped).toEqual([]);
    expect(existsSync(path.join(root, 'docs', 'guides'))).toBe(true);
  });

  it('is a no-op for a folder that already exists', async () => {
    const root = makeRoot();
    await createShelfFolders(root, ['docs']);
    const again = await createShelfFolders(root, ['docs']);
    expect(again.created).toEqual([]);
    expect(again.skipped).toEqual([]);
  });

  it('never disturbs a file sitting at the shelf path', async () => {
    const root = makeRoot();
    writeFileSync(path.join(root, 'notes.md'), 'keep me', 'utf8');
    const result = await createShelfFolders(root, ['notes.md']);
    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual([{ path: 'notes.md', reason: 'a file already exists at this path' }]);
    // The file is still a file, with its content intact.
    expect(existsSync(path.join(root, 'notes.md'))).toBe(true);
  });

  it('refuses traversal and absolute paths without creating anything', async () => {
    const root = makeRoot();
    const result = await createShelfFolders(root, ['../outside', '/etc/atlasmind', 'C:\\Windows\\Temp\\atlas']);
    expect(result.created).toEqual([]);
    expect(result.skipped).toHaveLength(3);
    expect(result.skipped.every(s => s.reason === 'not a safe workspace-relative path')).toBe(true);
    expect(existsSync(path.resolve(root, '..', 'outside'))).toBe(false);
  });

  it('de-duplicates requested paths', async () => {
    const root = makeRoot();
    const result = await createShelfFolders(root, ['docs', 'docs', ' docs ']);
    expect(result.created).toEqual(['docs']);
  });
});

describe('renderDocumentsMarkdown', () => {
  it('renders both sections and never claims to auto-write files', () => {
    const md = renderDocumentsMarkdown({
      version: 1,
      filing: [{ id: 'f1', label: 'Docs', path: 'docs', pattern: '**/*.md' }],
      autoUpdate: [{ id: 'd1', path: 'README.md', cadence: 'on-change', sourceHint: 'feature list' }],
      updatedAt: '2026-07-24T00:00:00.000Z',
    });
    expect(md).toContain('# Document Management');
    expect(md).toContain('## Filing system');
    expect(md).toContain('## Kept updated automatically');
    expect(md).toContain('README.md');
    expect(md).toContain('never rewrites your documents automatically');
  });
});
