import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mock workspace.fs at module level ─────────────────────────
const mockReadFile = vi.fn<(uri: { path: string }) => Promise<Uint8Array>>();
const mockWriteFile = vi.fn<(uri: { path: string }, data: Uint8Array) => Promise<void>>();
const mockCreateDirectory = vi.fn<(uri: { path: string }) => Promise<void>>();
const mockReadDirectory = vi.fn<(uri: { path: string }) => Promise<[string, number][]>>();

vi.mock('vscode', () => ({
  workspace: {
    fs: {
      readFile: (...args: unknown[]) => mockReadFile(args[0] as { path: string }),
      writeFile: (...args: unknown[]) => mockWriteFile(args[0] as { path: string }, args[1] as Uint8Array),
      createDirectory: (...args: unknown[]) => mockCreateDirectory(args[0] as { path: string }),
      readDirectory: (...args: unknown[]) => mockReadDirectory(args[0] as { path: string }),
      stat: async () => ({ mtime: 0 }),
    },
    workspaceFolders: undefined,
    getConfiguration: () => ({
      get: (_key: string, def: unknown) => def,
    }),
    findFiles: async () => [],
  },
  Uri: {
    joinPath: (base: { path: string; fsPath: string }, ...segments: string[]) => {
      const joined = [base.path, ...segments].join('/');
      return { path: joined, fsPath: joined };
    },
    file: (p: string) => ({ path: p, fsPath: p }),
  },
  FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
  window: {
    createOutputChannel: () => ({ appendLine: () => undefined, dispose: () => undefined }),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showQuickPick: vi.fn(),
    showInputBox: vi.fn(),
  },
  EventEmitter: class {
    fire = vi.fn();
  },
  lm: { selectChatModels: async () => [] },
  LanguageModelTextPart: class { constructor(public value: string) {} },
  chat: {
    createChatParticipant: () => ({ iconPath: undefined, dispose: () => undefined }),
  },
  default: {},
}));

import { importProject, type ImportResult } from '../../src/bootstrap/bootstrapper.ts';
import type { MemoryEntry } from '../../src/types.ts';

/** Minimal AtlasMindContext mock with memory manager. */
function makeAtlas() {
  const upsertedEntries: Array<{ entry: MemoryEntry; content?: string }> = [];
  return {
    atlas: {
      memoryManager: {
        upsert: vi.fn((entry: MemoryEntry, content?: string) => {
          upsertedEntries.push({ entry, content });
          return { status: 'created' as const };
        }),
        loadFromDisk: vi.fn(async () => undefined),
        queryRelevant: vi.fn(async () => []),
      },
      memoryRefresh: { fire: vi.fn() },
    } as unknown as import('../../src/extension.ts').AtlasMindContext,
    upsertedEntries,
  };
}

const ROOT = { path: '/workspace', fsPath: '/workspace' };

/**
 * Helper: make mockReadFile respond for specific file paths.
 *
 * Paths NOT in the map reject with ENOENT.
 */
function setupFileSystem(files: Record<string, string>) {
  const fileResponses = new Map<string, Uint8Array>();
  for (const [p, content] of Object.entries(files)) {
    // importProject uses Uri.joinPath(root, path) → '/workspace/path'
    fileResponses.set(`/workspace/${p}`, Buffer.from(content, 'utf-8'));
  }

  mockReadFile.mockImplementation(async (uri: { path: string }) => {
    const buf = fileResponses.get(uri.path);
    if (buf) { return buf; }
    throw new Error('ENOENT');
  });

  mockWriteFile.mockResolvedValue(undefined);
  mockCreateDirectory.mockResolvedValue(undefined);
  mockReadDirectory.mockResolvedValue([]);
}

describe('importProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates memory entries from a Node.js project', async () => {
    setupFileSystem({
      'package.json': JSON.stringify({
        name: 'my-app',
        version: '1.0.0',
        description: 'A test app',
        dependencies: { express: '^4.18.0' },
        devDependencies: { typescript: '^5.0.0' },
        scripts: { build: 'tsc', start: 'node dist/index.js' },
      }),
      'README.md': '# My App\n\nA sample project.\n',
      'tsconfig.json': JSON.stringify({
        compilerOptions: { target: 'ES2022', module: 'Node16', strict: true },
      }),
      'LICENSE': 'MIT License\n\nPermission is hereby granted, free of charge...',
      '.gitignore': 'node_modules\ndist\n.env\n',
    });

    // Return some directory entries
    mockReadDirectory.mockResolvedValueOnce([
      ['src', 2],
      ['dist', 2],
      ['package.json', 1],
      ['README.md', 1],
      ['tsconfig.json', 1],
    ]);

    const { atlas, upsertedEntries } = makeAtlas();
    const result: ImportResult = await importProject(ROOT as any, atlas);

    // Should detect as API Server (has express dep)
    expect(result.projectType).toBe('API Server');

    // Should have created entries: overview, dependencies, structure, conventions, license
    expect(result.entriesCreated).toBeGreaterThanOrEqual(4);

    // Check that upsert was called correctly
    const paths = upsertedEntries.map(e => e.entry.path);
    expect(paths).toContain('architecture/project-overview.md');
    expect(paths).toContain('architecture/dependencies.md');
    expect(paths).toContain('architecture/project-structure.md');
    expect(paths).toContain('domain/conventions.md');
    expect(paths).toContain('domain/license.md');

    // Dependencies entry should mention express
    const depEntry = upsertedEntries.find(e => e.entry.path === 'architecture/dependencies.md');
    expect(depEntry?.entry.snippet).toContain('express');

    // License entry should detect MIT
    const licEntry = upsertedEntries.find(e => e.entry.path === 'domain/license.md');
    expect(licEntry?.entry.snippet).toContain('MIT');

    // Conventions should mention TypeScript
    const convEntry = upsertedEntries.find(e => e.entry.path === 'domain/conventions.md');
    expect(convEntry?.content).toContain('TypeScript');

    // Memory refresh should fire
    expect(atlas.memoryRefresh.fire).toHaveBeenCalled();
    expect(atlas.memoryManager.loadFromDisk).toHaveBeenCalled();
  });

  it('handles a minimal project with only a readme', async () => {
    setupFileSystem({
      'README.md': '# Tiny Project\nJust a readme.\n',
    });

    const { atlas, upsertedEntries } = makeAtlas();
    const result = await importProject(ROOT as any, atlas);

    expect(result.projectType).toBeUndefined();
    // Only overview + structure (directory listing still works)
    expect(result.entriesCreated).toBeGreaterThanOrEqual(1);

    const overviewEntry = upsertedEntries.find(e => e.entry.path === 'architecture/project-overview.md');
    expect(overviewEntry?.entry.title).toBe('Project Overview');
    expect(overviewEntry?.entry.snippet).toContain('Tiny Project');
  });

  it('handles an empty project with no recognisable files', async () => {
    setupFileSystem({});

    const { atlas } = makeAtlas();
    const result = await importProject(ROOT as any, atlas);

    expect(result.entriesCreated).toBe(0);
    expect(result.entriesSkipped).toBe(0);
    expect(result.projectType).toBeUndefined();
  });

  it('detects VS Code extension project type', async () => {
    setupFileSystem({
      'package.json': JSON.stringify({
        name: 'my-extension',
        version: '0.1.0',
        engines: { vscode: '^1.95.0' },
        contributes: { commands: [] },
      }),
    });

    const { atlas } = makeAtlas();
    const result = await importProject(ROOT as any, atlas);

    expect(result.projectType).toBe('VS Code Extension');
  });

  it('detects Rust project type', async () => {
    setupFileSystem({
      'Cargo.toml': '[package]\nname = "my-crate"\nversion = "0.1.0"\n',
    });

    const { atlas } = makeAtlas();
    const result = await importProject(ROOT as any, atlas);

    expect(result.projectType).toBe('Rust Project');
  });

  it('detects Python project type', async () => {
    setupFileSystem({
      'pyproject.toml': '[tool.poetry]\nname = "my-lib"\nversion = "0.1.0"\n',
    });

    const { atlas } = makeAtlas();
    const result = await importProject(ROOT as any, atlas);

    expect(result.projectType).toBe('Python Project');
  });

  it('counts skipped entries when upsert rejects', async () => {
    setupFileSystem({
      'README.md': '# Project\nSome content.\n',
    });

    const { atlas } = makeAtlas();
    // Override upsert to reject
    (atlas.memoryManager.upsert as ReturnType<typeof vi.fn>).mockReturnValue({ status: 'rejected', reason: 'duplicate' });

    const result = await importProject(ROOT as any, atlas);

    expect(result.entriesCreated).toBe(0);
    expect(result.entriesSkipped).toBeGreaterThanOrEqual(1);
  });

  it('creates SSOT directory structure', async () => {
    setupFileSystem({});

    const { atlas } = makeAtlas();
    await importProject(ROOT as any, atlas);

    // Should have called createDirectory for the SSOT root and sub-folders
    expect(mockCreateDirectory).toHaveBeenCalled();
    const paths = mockCreateDirectory.mock.calls.map(c => c[0].path);
    expect(paths.some(p => p.includes('project_memory'))).toBe(true);
  });

  it('detects Apache-2.0 license', async () => {
    setupFileSystem({
      'LICENSE': 'Apache License\nVersion 2.0, January 2004\n...',
    });

    const { atlas, upsertedEntries } = makeAtlas();
    await importProject(ROOT as any, atlas);

    const lic = upsertedEntries.find(e => e.entry.path === 'domain/license.md');
    expect(lic?.entry.snippet).toContain('Apache-2.0');
  });

  it('detects Web App project type', async () => {
    setupFileSystem({
      'package.json': JSON.stringify({
        name: 'my-app',
        dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
      }),
    });

    const { atlas } = makeAtlas();
    const result = await importProject(ROOT as any, atlas);

    expect(result.projectType).toBe('Web App');
  });
});
