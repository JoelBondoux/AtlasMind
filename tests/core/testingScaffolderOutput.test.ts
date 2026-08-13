import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as esbuild from 'esbuild';

vi.mock('vscode', () => ({
  workspace: {
    fs: {
      writeFile: async (uri: { fsPath: string }, data: Uint8Array) => {
        mkdirSync(path.dirname(uri.fsPath), { recursive: true });
        writeFileSync(uri.fsPath, Buffer.from(data));
      },
    },
  },
  Uri: { file: (p: string) => ({ path: p, fsPath: p }) },
  default: {},
}));

import { scaffoldTestingFramework } from '../../src/core/testingScaffolder.ts';
import { TESTING_METHODOLOGY_DEFINITIONS, type ProjectTestingConfig } from '../../src/types.ts';
import { removeTempDir } from '../helpers/tempDir';

/**
 * The Scaffold framework button writes files into somebody's repository.
 *
 * Every starter file is authored as a string inside a template literal in
 * `testingScaffolder.ts`, which means the compiler checks that the *scaffolder*
 * is valid TypeScript and checks nothing whatsoever about the code it emits. A
 * stray backtick or a mis-escaped `${` produces a scaffolder that builds, ships,
 * and writes a syntactically broken test file into a user's project — where the
 * first thing it does is fail their test run for a reason that is not their
 * fault. (One such escaping bug existed while these recipes were being written.)
 *
 * So the output is parsed here with the same engine that bundles this extension.
 * These tests are about the button being *functional*, not about the catalogue
 * being complete — `testingComplianceCatalog.test.ts` covers that.
 */
const ALL_IDS = TESTING_METHODOLOGY_DEFINITIONS.map(d => d.id);

function makeConfig(): ProjectTestingConfig {
  return {
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    methodologies: ALL_IDS.map(id => ({ id, enabled: true })),
  };
}

function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { out.push(...walk(full, base)); }
    else { out.push(path.relative(base, full).split(path.sep).join('/')); }
  }
  return out;
}

/** Every emitted source file, parsed. Returns the failures, so a name is reported. */
async function syntaxErrors(workspace: string): Promise<string[]> {
  const failures: string[] = [];
  for (const rel of walk(workspace)) {
    const abs = path.join(workspace, rel);
    if (/\.(ts|tsx|mts|cts)$/.test(rel)) {
      try { await esbuild.transform(readFileSync(abs, 'utf8'), { loader: 'ts', sourcefile: rel }); }
      catch (err) { failures.push(`${rel}: ${describeEsbuild(err)}`); }
    } else if (/\.(js|jsx|mjs|cjs)$/.test(rel) && rel !== 'package.json') {
      try { await esbuild.transform(readFileSync(abs, 'utf8'), { loader: 'jsx', sourcefile: rel }); }
      catch (err) { failures.push(`${rel}: ${describeEsbuild(err)}`); }
    } else if (rel.endsWith('.json') && !['package.json', 'tsconfig.json'].includes(rel)) {
      try { JSON.parse(readFileSync(abs, 'utf8')); }
      catch (err) { failures.push(`${rel} (JSON): ${err instanceof Error ? err.message : String(err)}`); }
    }
  }
  return failures;
}

function describeEsbuild(err: unknown): string {
  const errors = (err as { errors?: Array<{ text?: string; location?: { line?: number } }> }).errors;
  const first = errors?.[0];
  return first ? `${first.text} (line ${first.location?.line ?? '?'})` : String(err);
}

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(path.join(os.tmpdir(), 'atlas-scaffold-out-'));
});

afterEach(() => {
  removeTempDir(workspace);
});

function seedNode(ts: boolean, extra: Record<string, unknown> = {}): void {
  writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({
    name: 'probe',
    devDependencies: { vitest: '^1', ...(ts ? { typescript: '^5' } : {}) },
    ...extra,
  }));
  if (ts) { writeFileSync(path.join(workspace, 'tsconfig.json'), '{}'); }
}

describe('everything the button writes is parseable', () => {
  it('emits valid TypeScript for a TS project with every methodology enabled', async () => {
    seedNode(true);
    const result = await scaffoldTestingFramework(workspace, makeConfig());
    expect(result.success).toBe(true);
    expect(await syntaxErrors(workspace)).toEqual([]);
  });

  it('emits valid JavaScript for a plain-JS project', async () => {
    seedNode(false);
    await scaffoldTestingFramework(workspace, makeConfig());
    expect(await syntaxErrors(workspace)).toEqual([]);
  });

  it('emits valid files for a Cypress project, which takes a different e2e branch', async () => {
    seedNode(true, { dependencies: { cypress: '^13' } });
    await scaffoldTestingFramework(workspace, makeConfig());
    expect(await syntaxErrors(workspace)).toEqual([]);
  });

  it('emits valid files for every non-Node stack', async () => {
    // Each language recipe is a separate switch, so a broken template in one is
    // invisible from the others.
    const stacks: Array<[string, string, string]> = [
      ['python', 'pyproject.toml', '[project]\nname = "p"\n'],
      ['rust', 'Cargo.toml', '[package]\nname = "p"\n'],
      ['go', 'go.mod', 'module example.com/p\n'],
      ['java', 'pom.xml', '<project/>\n'],
      ['dotnet', 'app.csproj', '<Project/>\n'],
    ];
    for (const [label, file, body] of stacks) {
      const ws = mkdtempSync(path.join(os.tmpdir(), `atlas-scaffold-${label}-`));
      try {
        writeFileSync(path.join(ws, file), body);
        const result = await scaffoldTestingFramework(ws, makeConfig());
        expect(result.success, label).toBe(true);
        expect(await syntaxErrors(ws), label).toEqual([]);
      } finally {
        removeTempDir(ws);
      }
    }
  });
});

describe('the button reports what it actually did', () => {
  it('every file it claims to have created exists on disk', async () => {
    seedNode(true);
    const result = await scaffoldTestingFramework(workspace, makeConfig());
    const onDisk = new Set(walk(workspace));
    const claimed = result.files.filter(f => f.created).map(f => f.path);
    expect(claimed.length).toBeGreaterThan(10);
    expect(claimed.filter(p => !onDisk.has(p))).toEqual([]);
  });

  it('every file on disk was reported, so nothing is written silently', async () => {
    seedNode(true);
    const result = await scaffoldTestingFramework(workspace, makeConfig());
    const reported = new Set(result.files.map(f => f.path));
    const unreported = walk(workspace)
      .filter(p => !['package.json', 'tsconfig.json'].includes(p))
      .filter(p => !reported.has(p));
    expect(unreported).toEqual([]);
  });

  it('a skipped file says why', async () => {
    seedNode(true);
    await scaffoldTestingFramework(workspace, makeConfig());
    const second = await scaffoldTestingFramework(workspace, makeConfig());
    const skipped = second.files.filter(f => !f.created);
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped.every(f => Boolean(f.reason?.trim()))).toBe(true);
  });

  it('refuses rather than writing anything when nothing is enabled', async () => {
    seedNode(true);
    const result = await scaffoldTestingFramework(workspace, {
      version: 1, updatedAt: '2026-01-01T00:00:00.000Z',
      methodologies: ALL_IDS.map(id => ({ id, enabled: false })),
    });
    expect(result.success).toBe(false);
    expect(result.files).toEqual([]);
    expect(walk(workspace).sort()).toEqual(['package.json', 'tsconfig.json']);
  });
});

describe('non-destructive, as the confirmation dialog promises', () => {
  it('never overwrites a file a person already wrote', async () => {
    seedNode(true);
    await scaffoldTestingFramework(workspace, makeConfig());
    const written = walk(workspace).filter(p => p.startsWith('tests/'));
    expect(written.length).toBeGreaterThan(0);

    const sentinel = '// mine, do not touch\n';
    for (const rel of written) { writeFileSync(path.join(workspace, rel), sentinel); }

    await scaffoldTestingFramework(workspace, makeConfig());
    for (const rel of written) {
      expect(readFileSync(path.join(workspace, rel), 'utf8'), rel).toBe(sentinel);
    }
  });

  it('never mutates the manifest — install commands are surfaced, not run', async () => {
    seedNode(true);
    const before = readFileSync(path.join(workspace, 'package.json'), 'utf8');
    await scaffoldTestingFramework(workspace, makeConfig());
    expect(readFileSync(path.join(workspace, 'package.json'), 'utf8')).toBe(before);
  });

  it('rewrites only the managed playbook on a second run', async () => {
    seedNode(true);
    await scaffoldTestingFramework(workspace, makeConfig());
    const second = await scaffoldTestingFramework(workspace, makeConfig());
    expect(second.files.filter(f => f.created).map(f => f.path))
      .toEqual(['project_memory/operations/testing-strategy.md']);
  });
});

describe('a starter file that needs a package says how to get it', () => {
  /** Third-party imports in a generated file — the ones a fresh project lacks. */
  function externalImports(source: string): string[] {
    const found = new Set<string>();
    for (const match of source.matchAll(/(?:from|require\()\s*['"]([^'"]+)['"]/g)) {
      const spec = match[1];
      if (spec.startsWith('node:') || spec.startsWith('.') || spec.startsWith('/')) { continue; }
      // The runner itself is the one dependency the scaffold already assumes,
      // and its own install hint is attached to the structural methodologies.
      if (spec === 'vitest' || spec === 'jest') { continue; }
      found.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
    }
    return [...found];
  }

  it('names a set-up command for every methodology whose starter file imports one', async () => {
    // Scaffolding a methodology whose test cannot even import is a button that
    // reports success and leaves a red suite behind. Each is scaffolded alone so
    // a missing hint is attributed to the right methodology rather than being
    // covered by a neighbour's.
    const offenders: string[] = [];
    for (const def of TESTING_METHODOLOGY_DEFINITIONS) {
      const ws = mkdtempSync(path.join(os.tmpdir(), 'atlas-scaffold-hint-'));
      try {
        writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'p', devDependencies: { vitest: '^1', typescript: '^5' } }));
        writeFileSync(path.join(ws, 'tsconfig.json'), '{}');
        await scaffoldTestingFramework(ws, {
          version: 1, updatedAt: '2026-01-01T00:00:00.000Z',
          methodologies: [{ id: def.id, enabled: true }],
        });
        const playbook = readFileSync(path.join(ws, 'project_memory/operations/testing-strategy.md'), 'utf8');
        const needed = new Set<string>();
        for (const rel of walk(ws)) {
          if (!/\.(ts|js)$/.test(rel) || ['package.json', 'tsconfig.json'].includes(rel)) { continue; }
          externalImports(readFileSync(path.join(ws, rel), 'utf8')).forEach(p => needed.add(p));
        }
        if (needed.size > 0 && !/\*\*Set up \(/.test(playbook)) {
          offenders.push(`${def.id}: imports ${[...needed].join(', ')} with no set-up line`);
        }
      } finally {
        removeTempDir(ws);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the playbook is the reference the button leaves behind', () => {
  it('covers every enabled methodology', async () => {
    seedNode(true);
    await scaffoldTestingFramework(workspace, makeConfig());
    const playbook = readFileSync(path.join(workspace, 'project_memory/operations/testing-strategy.md'), 'utf8');
    const missing = TESTING_METHODOLOGY_DEFINITIONS.filter(def => !playbook.includes(`## ${def.label}`));
    expect(missing.map(d => d.id)).toEqual([]);
  });

  it('never states a starter file it did not write', async () => {
    // The playbook names a starter file per methodology. Naming one that does
    // not exist sends the reader to a path that is not there.
    seedNode(true);
    await scaffoldTestingFramework(workspace, makeConfig());
    const playbook = readFileSync(path.join(workspace, 'project_memory/operations/testing-strategy.md'), 'utf8');
    const onDisk = new Set(walk(workspace));
    const claimed = [...playbook.matchAll(/\*\*Starter file:\*\* `([^`]+)`/g)].map(m => m[1]);
    expect(claimed.length).toBeGreaterThan(0);
    expect(claimed.filter(p => !onDisk.has(p))).toEqual([]);
  });

  it('names every file a methodology created, not just the first', async () => {
    // GDPR writes a control mapping *and* a test. Naming only the first
    // reported the mapping and silently omitted the test.
    const ws = mkdtempSync(path.join(os.tmpdir(), 'atlas-scaffold-multi-'));
    try {
      writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'p', devDependencies: { vitest: '^1' } }));
      const result = await scaffoldTestingFramework(ws, {
        version: 1, updatedAt: '2026-01-01T00:00:00.000Z',
        methodologies: [{ id: 'gdpr', enabled: true }],
      });
      const created = result.files
        .filter(f => f.created && !f.path.endsWith('testing-strategy.md'))
        .map(f => f.path);
      expect(created.length).toBeGreaterThan(1);
      const playbook = readFileSync(path.join(ws, 'project_memory/operations/testing-strategy.md'), 'utf8');
      for (const rel of created) { expect(playbook, rel).toContain(rel); }
    } finally {
      removeTempDir(ws);
    }
  });

  it('says what happened for a methodology with no starter file', async () => {
    // Silence meant two different things on Node — "a practice has no artifact"
    // and "no recipe exists yet" — and the reader could not tell which.
    const ws = mkdtempSync(path.join(os.tmpdir(), 'atlas-scaffold-none-'));
    try {
      writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'p', devDependencies: { vitest: '^1' } }));
      await scaffoldTestingFramework(ws, {
        version: 1, updatedAt: '2026-01-01T00:00:00.000Z',
        methodologies: [{ id: 'exploratory', enabled: true }],
      });
      const playbook = readFileSync(path.join(ws, 'project_memory/operations/testing-strategy.md'), 'utf8');
      expect(playbook).toMatch(/practice, not an artifact/i);
    } finally {
      removeTempDir(ws);
    }
  });

  it('gives every enabled methodology a starter-file verdict of some kind', async () => {
    seedNode(true);
    await scaffoldTestingFramework(workspace, makeConfig());
    const playbook = readFileSync(path.join(workspace, 'project_memory/operations/testing-strategy.md'), 'utf8');
    const sections = playbook.split(/^## /m).filter(s => TESTING_METHODOLOGY_DEFINITIONS.some(d => s.startsWith(d.label)));
    expect(sections.length).toBe(TESTING_METHODOLOGY_DEFINITIONS.length);
    const silent = sections.filter(s => !/\*\*Starter files?:\*\*/.test(s));
    expect(silent.map(s => s.split('\n')[0])).toEqual([]);
  });

  it('is regenerated rather than appended to', async () => {
    seedNode(true);
    await scaffoldTestingFramework(workspace, makeConfig());
    const rel = 'project_memory/operations/testing-strategy.md';
    const first = readFileSync(path.join(workspace, rel), 'utf8');
    await scaffoldTestingFramework(workspace, makeConfig());
    expect(readFileSync(path.join(workspace, rel), 'utf8')).toBe(first);
  });

  it('tells an unknown stack what it can and cannot do', async () => {
    const ws = mkdtempSync(path.join(os.tmpdir(), 'atlas-scaffold-unknown-'));
    try {
      const result = await scaffoldTestingFramework(ws, makeConfig());
      expect(result.success).toBe(true);
      // No language recipes apply, but the compliance mappings are
      // language-independent and the playbook always lands.
      expect(walk(ws)).toContain('project_memory/operations/testing-strategy.md');
      expect(await syntaxErrors(ws)).toEqual([]);
    } finally {
      removeTempDir(ws);
    }
  });
});
