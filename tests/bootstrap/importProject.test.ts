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

import { getProjectMemoryFreshness, importProject, type ImportResult } from '../../src/bootstrap/bootstrapper.ts';
import type { MemoryEntry } from '../../src/types.ts';

/** Minimal AtlasMindContext mock with memory manager. */
function makeAtlas() {
  const upsertedEntries: Array<{ entry: MemoryEntry; content?: string }> = [];
  return {
    atlas: {
      memoryManager: {
        upsert: vi.fn((entry: MemoryEntry, content?: string) => {
          upsertedEntries.push({ entry, content });
          if (typeof content === 'string') {
            fileResponses.set(`/workspace/project_memory/${entry.path}`, Buffer.from(content, 'utf-8'));
          }
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
let fileResponses = new Map<string, Uint8Array>();

function setupDirectoryReadsFromFiles() {
  mockReadDirectory.mockImplementation(async (uri: { path: string }) => {
    const normalized = uri.path.endsWith('/') ? uri.path : `${uri.path}/`;
    const children = new Map<string, number>();

    for (const filePath of fileResponses.keys()) {
      if (!filePath.startsWith(normalized)) {
        continue;
      }

      const remainder = filePath.slice(normalized.length);
      if (!remainder) {
        continue;
      }

      const segments = remainder.split('/').filter(Boolean);
      if (segments.length === 0) {
        continue;
      }

      children.set(segments[0], segments.length > 1 ? 2 : 1);
    }

    return [...children.entries()] as [string, number][];
  });
}

/**
 * Helper: make mockReadFile respond for specific file paths.
 *
 * Paths NOT in the map reject with ENOENT.
 */
function setupFileSystem(files: Record<string, string>) {
  fileResponses = new Map<string, Uint8Array>();
  for (const [p, content] of Object.entries(files)) {
    // importProject uses Uri.joinPath(root, path) → '/workspace/path'
    fileResponses.set(`/workspace/${p}`, Buffer.from(content, 'utf-8'));
  }

  mockReadFile.mockImplementation(async (uri: { path: string }) => {
    const buf = fileResponses.get(uri.path);
    if (buf) { return buf; }
    throw new Error('ENOENT');
  });

  mockWriteFile.mockImplementation(async (uri: { path: string }, data: Uint8Array) => {
    fileResponses.set(uri.path, data);
  });
  mockCreateDirectory.mockResolvedValue(undefined);
  setupDirectoryReadsFromFiles();
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
      'docs/architecture.md': '# Architecture Overview\n\n## Activation Flow\n\nActivation details.\n\n## Core Services\n\nOrchestrator and memory manager.\n',
      'docs/model-routing.md': '# Model Routing\n\n## Overview\n\nRouting details.\n\n## Supported Providers\n\nAnthropic, OpenAI.\n',
      'docs/agents-and-skills.md': '# Agents & Skills\n\n## Agents\n\nAgent docs.\n\n## Skills\n\nSkill docs.\n',
      'docs/development.md': '# Development Guide\n\n## Build\n\nRun compile.\n\n## Test\n\nRun tests.\n',
      'docs/configuration.md': '# Configuration Reference\n\n## Model Routing\n\nSettings here.\n',
      'docs/github-workflow.md': '# GitHub Workflow Standards\n\n## Branch Strategy\n\nUse develop.\n',
      'SECURITY.md': '# Security\n\nReport vulnerabilities responsibly.\n',
      '.github/copilot-instructions.md': '# AtlasMind Instructions\n\n## Safety-First Principle\n- Default to the safest reasonable behavior.\n- Validate before executing.\n',
      'CHANGELOG.md': '# Changelog\n\n## [1.0.0]\n- Initial release.\n',
    });

    mockReadDirectory.mockImplementation(async (uri: { path: string }) => {
      switch (uri.path) {
        case '/workspace':
          return [
            ['src', 2],
            ['tests', 2],
            ['docs', 2],
            ['project_memory', 2],
            ['package.json', 1],
            ['README.md', 1],
            ['tsconfig.json', 1],
          ];
        case '/workspace/src':
          return [['core', 2], ['views', 2], ['extension.ts', 1]];
        case '/workspace/src/core':
          return [['orchestrator.ts', 1], ['modelRouter.ts', 1]];
        case '/workspace/src/views':
          return [['settingsPanel.ts', 1]];
        case '/workspace/tests':
          return [['bootstrap', 2], ['bootstrapper.test.ts', 1]];
        case '/workspace/tests/bootstrap':
          return [['importProject.test.ts', 1]];
        case '/workspace/docs':
          return [['architecture.md', 1], ['development.md', 1]];
        case '/workspace/project_memory':
          return [['architecture', 2], ['project_soul.md', 1]];
        case '/workspace/project_memory/architecture':
          return [['project-overview.md', 1]];
        default:
          return [];
      }
    });

    const { atlas, upsertedEntries } = makeAtlas();
    const result: ImportResult = await importProject(ROOT as any, atlas);

    // Should detect as API Server (has express dep)
    expect(result.projectType).toBe('API Server');

    expect(result.entriesCreated).toBeGreaterThanOrEqual(12);

    // Check that upsert was called correctly
    const paths = upsertedEntries.map(e => e.entry.path);
    expect(paths).toContain('architecture/project-overview.md');
    expect(paths).toContain('architecture/dependencies.md');
    expect(paths).toContain('architecture/project-structure.md');
    expect(paths).toContain('architecture/codebase-map.md');
    expect(paths).toContain('architecture/runtime-and-surfaces.md');
    expect(paths).toContain('architecture/model-routing.md');
    expect(paths).toContain('architecture/agents-and-skills.md');
    expect(paths).toContain('domain/conventions.md');
    expect(paths).toContain('domain/product-capabilities.md');
    expect(paths).toContain('domain/license.md');
    expect(paths).toContain('operations/development-workflow.md');
    expect(paths).toContain('operations/configuration-reference.md');
    expect(paths).toContain('operations/security-and-safety.md');
    expect(paths).toContain('decisions/development-guardrails.md');
    expect(paths).toContain('roadmap/release-history.md');
    expect(paths).toContain('index/import-catalog.md');

    // Dependencies entry should mention express
    const depEntry = upsertedEntries.find(e => e.entry.path === 'architecture/dependencies.md');
    expect(depEntry?.entry.snippet).toContain('express');

    // License entry should detect MIT
    const licEntry = upsertedEntries.find(e => e.entry.path === 'domain/license.md');
    expect(licEntry?.entry.snippet).toContain('MIT');

    // Conventions should mention TypeScript
    const convEntry = upsertedEntries.find(e => e.entry.path === 'domain/conventions.md');
    expect(convEntry?.content).toContain('TypeScript');

    const codebaseEntry = upsertedEntries.find(e => e.entry.path === 'architecture/codebase-map.md');
    expect(codebaseEntry?.content).toContain('orchestrator.ts');

    const productEntry = upsertedEntries.find(e => e.entry.path === 'domain/product-capabilities.md');
    expect(productEntry?.content).toContain('Project type: **API Server**');

    const operationsEntry = upsertedEntries.find(e => e.entry.path === 'operations/development-workflow.md');
    expect(operationsEntry?.content).toContain('develop');

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

  it('replaces the starter project soul template with generated content', async () => {
    setupFileSystem({
      'package.json': JSON.stringify({
        name: 'atlasmind',
        version: '0.36.1',
        engines: { vscode: '^1.95.0' },
        contributes: { commands: [] },
      }),
      'README.md': '# AtlasMind\n\n## What is AtlasMind?\n\nAtlasMind is a multi-agent orchestrator for VS Code.\n',
      '.github/copilot-instructions.md': '# Rules\n\n## Safety-First Principle\n- Default to the safest reasonable behavior.\n',
      'project_memory/project_soul.md': '# Project Soul\n\n> This file is the living identity of the project.\n\n## Project Type\n{{PROJECT_TYPE}}\n\n## Vision\n<!-- Describe the high-level goal of this project -->\n\n## Principles\n- \n\n## Key Decisions\n<!-- Link to decisions/ folder entries -->\n',
    });

    const { atlas } = makeAtlas();
    await importProject(ROOT as any, atlas);

    const writeCalls = mockWriteFile.mock.calls.filter(call => call[0].path.endsWith('project_soul.md'));
    expect(writeCalls.length).toBeGreaterThan(0);
    const latestWrite = writeCalls.at(-1);
    const written = Buffer.from(latestWrite?.[1] as Uint8Array).toString('utf-8');
    expect(written).toContain('VS Code Extension');
    expect(written).toContain('Default to the safest reasonable behavior.');
  });

  it('skips unchanged generated files on a repeated import and keeps import metadata', async () => {
    setupFileSystem({
      'package.json': JSON.stringify({
        name: 'atlasmind',
        version: '0.36.4',
        dependencies: { express: '^4.18.0' },
      }),
      'README.md': '# AtlasMind\n\nA sample project.\n',
      '.github/copilot-instructions.md': '# Rules\n\n## Safety-First Principle\n- Default to the safest reasonable behavior.\n',
    });

    const { atlas, upsertedEntries } = makeAtlas();
    const firstResult = await importProject(ROOT as any, atlas);
    expect(firstResult.entriesCreated).toBeGreaterThan(0);

    const firstOverview = upsertedEntries.find(entry => entry.entry.path === 'architecture/project-overview.md');
    expect(firstOverview?.content).toContain('<!-- atlasmind-import');

    const secondResult = await importProject(ROOT as any, atlas);
    expect(secondResult.entriesSkipped).toBeGreaterThan(0);
    expect(secondResult.entriesCreated).toBeLessThan(firstResult.entriesCreated);

    const totalOverviewWrites = upsertedEntries.filter(entry => entry.entry.path === 'architecture/project-overview.md');
    expect(totalOverviewWrites).toHaveLength(1);
  });

  it('marks imported memory stale when tracked sources change', async () => {
    setupFileSystem({
      'package.json': JSON.stringify({
        name: 'atlasmind',
        version: '0.36.4',
        dependencies: { express: '^4.18.0' },
      }),
      'README.md': '# AtlasMind\n\nOriginal overview.\n',
      '.github/copilot-instructions.md': '# Rules\n\n## Safety-First Principle\n- Default to the safest reasonable behavior.\n',
    });

    const { atlas } = makeAtlas();
    await importProject(ROOT as any, atlas);

    fileResponses.set('/workspace/README.md', Buffer.from('# AtlasMind\n\nUpdated overview.\n', 'utf-8'));

    const freshness = await getProjectMemoryFreshness(ROOT as any);
    expect(freshness.hasImportedEntries).toBe(true);
    expect(freshness.isStale).toBe(true);
    expect(freshness.staleEntries).toContain('architecture/project-overview.md');
  });

  it('returns to current after re-importing changed sources', async () => {
    setupFileSystem({
      'package.json': JSON.stringify({
        name: 'atlasmind',
        version: '0.36.4',
        dependencies: { express: '^4.18.0' },
      }),
      'README.md': '# AtlasMind\n\nOriginal overview.\n',
      '.github/copilot-instructions.md': '# Rules\n\n## Safety-First Principle\n- Default to the safest reasonable behavior.\n',
    });

    const { atlas } = makeAtlas();
    await importProject(ROOT as any, atlas);
    fileResponses.set('/workspace/README.md', Buffer.from('# AtlasMind\n\nUpdated overview.\n', 'utf-8'));

    const staleBeforeRefresh = await getProjectMemoryFreshness(ROOT as any);
    expect(staleBeforeRefresh.isStale).toBe(true);

    await importProject(ROOT as any, atlas);

    const freshness = await getProjectMemoryFreshness(ROOT as any);
    expect(freshness.hasImportedEntries).toBe(true);
    expect(freshness.isStale).toBe(false);
    expect(freshness.staleEntryCount).toBe(0);
    expect(freshness.staleEntries).toEqual([]);
  });
});
