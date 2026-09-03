import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  lstatSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GAME_ASSET_HARD_LIMITS,
  isPathCoveredByLfs,
  parseGitAttributes,
  scanGameAssetInventory,
  type GameAssetFileSystem,
  type GameAssetScanTarget,
} from '../../src/core/gameAssetInventory.js';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'atlasmind-game-assets-'));
  temporaryDirectories.push(directory);
  return directory;
}

function write(root: string, relative: string, content: string | Uint8Array): void {
  const absolute = path.join(root, ...relative.split('/'));
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function target(root: string, overrides: Partial<GameAssetScanTarget> = {}): GameAssetScanTarget {
  return {
    component: {
      id: 'content',
      label: 'Game content',
      role: 'content',
      vcs: 'git',
    },
    componentRoot: root,
    contentRoots: ['Assets'],
    ...overrides,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('gameAssetInventory', () => {
  it('does no filesystem work until an explicit request is confirmed', () => {
    const fail = vi.fn(() => { throw new Error('must not read'); });
    const fs = {
      lstatSync: fail,
      readdirSync: fail,
      readFileSync: fail,
    } as unknown as GameAssetFileSystem;

    const report = scanGameAssetInventory({
      confirmed: false,
      targets: [target('C:\\not-read')],
    }, { fs });

    expect(report).toMatchObject({
      confirmed: false,
      complete: false,
      components: [{ status: 'confirmation-required' }],
    });
    expect(fail).not.toHaveBeenCalled();
  });

  it('inventories recognised assets by type and size with LFS and candidate evidence', () => {
    const root = temporaryDirectory();
    write(root, '.gitattributes', '*.png filter=lfs diff=lfs merge=lfs -text\n');
    write(root, 'Assets/Maps/Level.unity', 'Missing reference: guid 123\n');
    write(root, 'Assets/Textures/covered.png', new Uint8Array([1, 2, 3]));
    write(root, 'Assets/Textures/source.psd', new Uint8Array([4, 5, 6, 7]));
    write(root, 'Assets/Gone.prefab.meta', 'fileFormatVersion: 2\nimport error\n');
    mkdirSync(path.join(root, 'Assets', 'UI'), { recursive: true });
    write(root, 'Assets/UI.meta', 'fileFormatVersion: 2\n');
    write(root, 'Assets/readme.md', 'not an asset');

    const report = scanGameAssetInventory({ confirmed: true, targets: [target(root)] });
    const inventory = report.components[0];

    expect(report.complete).toBe(true);
    expect(inventory).toMatchObject({
      status: 'available',
      assetCount: 3,
      totalBytes: 35,
      truncated: false,
      lfs: {
        status: 'assessed',
        binaryAssetCount: 2,
        coveredCount: 1,
        uncoveredCount: 1,
        uncoveredPaths: ['Assets/Textures/source.psd'],
      },
      importErrorMarkers: [
        { path: 'Assets/Gone.prefab.meta', line: 2, kind: 'import-error' },
        { path: 'Assets/Maps/Level.unity', line: 1, kind: 'missing-reference' },
      ],
      orphanCandidates: [{
        metadataPath: 'Assets/Gone.prefab.meta',
        missingAssetPath: 'Assets/Gone.prefab',
        reason: 'metadata-without-asset',
      }],
    });
    if (inventory.status === 'available') {
      expect(inventory.byType).toEqual([
        { type: 'scene', count: 1, sizeBytes: 28 },
        { type: 'texture', count: 2, sizeBytes: 7 },
      ]);
      expect(inventory.assets.every(asset => asset.openable)).toBe(true);
    }
  });

  it('keeps raw import-marker text out of the report', () => {
    const root = temporaryDirectory();
    write(root, 'Assets/problem.asset', 'import error token=super-secret\n');
    const report = scanGameAssetInventory({ confirmed: true, targets: [target(root)] });

    expect(JSON.stringify(report)).not.toContain('super-secret');
    expect(report.components[0]).toMatchObject({
      importErrorMarkers: [{ path: 'Assets/problem.asset', line: 1, kind: 'import-error' }],
    });
  });

  it('states file truncation and withholds orphan completeness', () => {
    const root = temporaryDirectory();
    write(root, 'Assets/a.png', 'a');
    write(root, 'Assets/b.png', 'b');
    const report = scanGameAssetInventory({
      confirmed: true,
      targets: [target(root)],
      limits: { maxFiles: 1 },
    });

    expect(report.complete).toBe(false);
    expect(report.components[0]).toMatchObject({
      status: 'available',
      scannedFileCount: 1,
      truncated: true,
      orphanAssessment: 'withheld-incomplete',
      orphanCandidates: [],
      lfs: { status: 'partial' },
    });
  });

  it('states byte truncation without counting a partial file', () => {
    const root = temporaryDirectory();
    write(root, 'Assets/large.png', '12345');
    const report = scanGameAssetInventory({
      confirmed: true,
      targets: [target(root)],
      limits: { maxTotalBytes: 4 },
    });

    expect(report.components[0]).toMatchObject({
      status: 'available',
      scannedFileCount: 0,
      assetCount: 0,
      truncated: true,
    });
    expect(JSON.stringify(report)).toContain('4-byte scan limit');
  });

  it('states wall-time truncation using an injected monotonic clock', () => {
    const root = temporaryDirectory();
    write(root, 'Assets/a.png', 'a');
    const readings = [0, 0, 2];
    const report = scanGameAssetInventory({
      confirmed: true,
      targets: [target(root)],
      limits: { maxDurationMs: 1 },
    }, { now: () => readings.shift() ?? 2 });

    expect(report.components[0]).toMatchObject({ status: 'available', truncated: true });
    expect(JSON.stringify(report)).toContain('1 ms scan limit');
  });

  it('reports Perforce and external content as not visible, never as zero', () => {
    const fail = vi.fn(() => { throw new Error('must not read'); });
    const fs = {
      lstatSync: fail,
      readdirSync: fail,
      readFileSync: fail,
    } as unknown as GameAssetFileSystem;
    const root = temporaryDirectory();

    for (const vcs of ['perforce', 'external'] as const) {
      const report = scanGameAssetInventory({
        confirmed: true,
        targets: [target(root, { component: { ...target(root).component, vcs } })],
      }, { fs });
      expect(report.components[0]).toMatchObject({ status: 'not-visible' });
      expect(report.components[0]).not.toHaveProperty('assetCount');
    }
    expect(fail).not.toHaveBeenCalled();
  });

  it('refuses unsafe, overlapping, absent, and excessive content roots', () => {
    const root = temporaryDirectory();
    const cases: readonly string[][] = [
      ['../outside'],
      ['C:/outside'],
      ['Assets', 'Assets/Textures'],
      [],
      Array.from({ length: GAME_ASSET_HARD_LIMITS.maxRootsPerComponent + 1 }, (_, index) => `r${index}`),
    ];
    for (const contentRoots of cases) {
      const report = scanGameAssetInventory({
        confirmed: true,
        targets: [target(root, { contentRoots })],
      });
      expect(report.components[0]).toMatchObject({ status: 'invalid' });
    }
  });

  it('reports an unresolved or unreadable component without inventing files', () => {
    const root = temporaryDirectory();
    expect(scanGameAssetInventory({
      confirmed: true,
      targets: [target(root, { componentRoot: undefined })],
    }).components[0]).toMatchObject({ status: 'not-visible' });
    expect(scanGameAssetInventory({
      confirmed: true,
      targets: [target(root)],
    }).components[0]).toMatchObject({ status: 'unreadable' });
  });

  it('caps the component count before touching the filesystem', () => {
    const root = temporaryDirectory();
    const report = scanGameAssetInventory({
      confirmed: true,
      targets: Array.from(
        { length: GAME_ASSET_HARD_LIMITS.maxComponents + 1 },
        () => target(root),
      ),
    });
    expect(report).toMatchObject({ complete: false, components: [] });
  });

  it('shares one budget across components instead of multiplying it', () => {
    const first = temporaryDirectory();
    const second = temporaryDirectory();
    write(first, 'Assets/a.png', 'a');
    write(second, 'Assets/b.png', 'b');
    const report = scanGameAssetInventory({
      confirmed: true,
      targets: [target(first), target(second, {
        component: { ...target(second).component, id: 'content-2', label: 'Other content' },
      })],
      limits: { maxFiles: 1 },
    });

    expect(report.components[0]).toMatchObject({ status: 'available', assetCount: 1 });
    expect(report.components[1]).toMatchObject({ status: 'unreadable' });
  });

  it('excludes engine caches deterministically rather than counting them as content', () => {
    const root = temporaryDirectory();
    write(root, 'Library/cache.png', 'cache');
    write(root, 'Assets/real.png', 'real');
    const inventory = scanGameAssetInventory({
      confirmed: true,
      targets: [target(root, { contentRoots: ['.'] })],
    }).components[0];
    expect(inventory).toMatchObject({
      status: 'available',
      assetCount: 1,
      excludedDirectoryCount: 1,
    });
  });

  it('marks unreadable or unsupported LFS rules instead of claiming assets are uncovered', () => {
    const root = temporaryDirectory();
    write(root, '.gitattributes', '[abc]*.png filter=lfs diff=lfs\n');
    write(root, 'Assets/a.png', 'a');
    expect(scanGameAssetInventory({ confirmed: true, targets: [target(root)] }).components[0])
      .toMatchObject({ status: 'available', lfs: { status: 'unreadable' } });
  });

  it('applies root and nested LFS rules in declaration order', () => {
    const root = parseGitAttributes([
      '*.png filter=lfs diff=lfs merge=lfs -text',
      'UI/*.png -filter',
    ].join('\n'));
    const nested = parseGitAttributes('*.psd filter=lfs', 'Assets', 'Assets/.gitattributes');
    const rules = [...root.rules, ...nested.rules];

    expect(root.unsupportedLfsLines).toEqual([]);
    expect(isPathCoveredByLfs('Assets/hero.png', rules)).toBe(true);
    expect(isPathCoveredByLfs('UI/icon.png', rules)).toBe(false);
    expect(isPathCoveredByLfs('Assets/source.psd', rules)).toBe(true);
    expect(isPathCoveredByLfs('Other/source.psd', rules)).toBe(false);
  });

  it('supports recursive double-star LFS patterns and flags unsupported filter syntax', () => {
    const parsed = parseGitAttributes('Content/**/Textures/*.dds filter=lfs\n"*.png" filter=lfs\n');
    expect(isPathCoveredByLfs('Content/UI/Textures/a.dds', parsed.rules)).toBe(true);
    expect(parsed.unsupportedLfsLines).toEqual([2]);
  });

  it('uses an injectable filesystem while retaining the real adapter shape', () => {
    const fs: GameAssetFileSystem = {
      lstatSync,
      readdirSync: filePath => readdirSync(filePath, { withFileTypes: true, encoding: 'utf8' }),
      readFileSync,
    };
    const root = temporaryDirectory();
    write(root, 'Assets/a.png', 'a');
    expect(scanGameAssetInventory({ confirmed: true, targets: [target(root)] }, { fs }).components[0])
      .toMatchObject({ status: 'available', assetCount: 1 });
  });
});
