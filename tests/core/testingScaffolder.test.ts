import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

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
import type { ProjectTestingConfig } from '../../src/types.ts';

function makeConfig(methodologies: ProjectTestingConfig['methodologies']): ProjectTestingConfig {
  return { version: 1, updatedAt: '2026-01-01T00:00:00.000Z', methodologies };
}

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(path.join(os.tmpdir(), 'atlas-scaffold-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function writePackageJson(deps: Record<string, string>): void {
  writeFileSync(
    path.join(workspace, 'package.json'),
    JSON.stringify({ name: 'demo', devDependencies: deps }, null, 2),
  );
}

describe('scaffoldTestingFramework', () => {
  it('fails cleanly when no methodologies are enabled', async () => {
    const result = await scaffoldTestingFramework(workspace, makeConfig([{ id: 'unit', enabled: false }]));
    expect(result.success).toBe(false);
    expect(result.files).toHaveLength(0);
    expect(existsSync(path.join(workspace, 'project_memory/operations/testing-strategy.md'))).toBe(false);
  });

  it('always writes the managed strategy playbook', async () => {
    writePackageJson({ vitest: '^1.0.0', typescript: '^5.0.0' });
    const result = await scaffoldTestingFramework(workspace, makeConfig([{ id: 'unit', enabled: true }]));

    expect(result.success).toBe(true);
    const playbook = path.join(workspace, 'project_memory/operations/testing-strategy.md');
    expect(existsSync(playbook)).toBe(true);
    const content = readFileSync(playbook, 'utf8');
    expect(content).toContain('# Testing Strategy Playbook');
    expect(content).toContain('## Unit Testing');
  });

  it('detects the test runner and TS extension from package.json', async () => {
    writePackageJson({ vitest: '^1.0.0', typescript: '^5.0.0' });
    const result = await scaffoldTestingFramework(workspace, makeConfig([{ id: 'unit', enabled: true }]));

    expect(result.stackLabel).toContain('TypeScript');
    expect(result.stackLabel).toContain('vitest');
    // Vitest + TS → a .test.ts example file is created.
    const created = result.files.find(f => f.created && f.path.endsWith('.test.ts'));
    expect(created).toBeDefined();
    expect(existsSync(path.join(workspace, created!.path))).toBe(true);
  });

  it('generates a Playwright spec for e2e when Cypress is absent', async () => {
    writePackageJson({ '@playwright/test': '^1.40.0' });
    const result = await scaffoldTestingFramework(workspace, makeConfig([{ id: 'e2e', enabled: true }]));

    const e2eFile = result.files.find(f => f.path.startsWith('e2e/') && f.created);
    expect(e2eFile).toBeDefined();
    const content = readFileSync(path.join(workspace, e2eFile!.path), 'utf8');
    expect(content).toContain("@playwright/test");
  });

  it('is non-destructive — never overwrites an existing starter file', async () => {
    writePackageJson({ vitest: '^1.0.0', typescript: '^5.0.0' });

    // Pre-create the example file with sentinel content.
    const examplePath = path.join(workspace, 'tests', 'example.test.ts');
    mkdirSync(path.dirname(examplePath), { recursive: true });
    writeFileSync(examplePath, 'SENTINEL — do not overwrite');

    const result = await scaffoldTestingFramework(workspace, makeConfig([{ id: 'unit', enabled: true }]));

    expect(readFileSync(examplePath, 'utf8')).toBe('SENTINEL — do not overwrite');
    const record = result.files.find(f => f.path === 'tests/example.test.ts');
    expect(record?.created).toBe(false);
    expect(record?.reason).toMatch(/already exists/i);
  });

  it('never mutates package.json', async () => {
    writePackageJson({ vitest: '^1.0.0' });
    const before = readFileSync(path.join(workspace, 'package.json'), 'utf8');

    await scaffoldTestingFramework(
      workspace,
      makeConfig([{ id: 'unit', enabled: true }, { id: 'e2e', enabled: true }, { id: 'property', enabled: true }]),
    );

    expect(readFileSync(path.join(workspace, 'package.json'), 'utf8')).toBe(before);
  });

  it('chooses an API e2e smoke test when a server dependency is present', async () => {
    writePackageJson({ vitest: '^1.0.0', express: '^4.18.0' });
    const result = await scaffoldTestingFramework(workspace, makeConfig([{ id: 'e2e', enabled: true }]));

    expect(result.stackLabel).toContain('archetype: api');
    const e2e = result.files.find(f => f.created && f.path.startsWith('e2e/'));
    expect(e2e?.path).toMatch(/api\.spec/);
    expect(readFileSync(path.join(workspace, e2e!.path), 'utf8')).toContain('/health');
  });
});

// ── Language adaptivity ───────────────────────────────────────────

describe('scaffoldTestingFramework — language detection', () => {
  it('generates pytest files for a Python project', async () => {
    writeFileSync(path.join(workspace, 'pyproject.toml'), '[project]\nname = "demo"\n');
    const result = await scaffoldTestingFramework(
      workspace,
      makeConfig([{ id: 'unit', enabled: true }, { id: 'property', enabled: true }]),
    );

    expect(result.stackLabel).toContain('Python');
    expect(result.files.find(f => f.created && f.path === 'tests/test_example.py')).toBeDefined();
    expect(result.files.find(f => f.created && f.path === 'tests/test_property.py')).toBeDefined();
    // No JS stubs leaked into a Python project.
    expect(result.files.some(f => f.path.endsWith('.test.ts') || f.path.endsWith('.test.js'))).toBe(false);
    expect(readFileSync(path.join(workspace, 'tests/test_property.py'), 'utf8')).toContain('hypothesis');
  });

  it('generates cargo test files for a Rust project', async () => {
    writeFileSync(path.join(workspace, 'Cargo.toml'), '[package]\nname = "demo"\n');
    const result = await scaffoldTestingFramework(workspace, makeConfig([{ id: 'unit', enabled: true }]));

    expect(result.stackLabel).toContain('Rust');
    const unit = result.files.find(f => f.created && f.path.endsWith('.rs'));
    expect(unit).toBeDefined();
    expect(readFileSync(path.join(workspace, unit!.path), 'utf8')).toContain('#[test]');
  });

  it('generates go test files for a Go project', async () => {
    writeFileSync(path.join(workspace, 'go.mod'), 'module demo\n\ngo 1.22\n');
    const result = await scaffoldTestingFramework(workspace, makeConfig([{ id: 'unit', enabled: true }]));

    expect(result.stackLabel).toContain('Go');
    const unit = result.files.find(f => f.created && f.path.endsWith('_test.go'));
    expect(unit).toBeDefined();
    expect(readFileSync(path.join(workspace, unit!.path), 'utf8')).toContain('testing.T');
  });

  it('falls back to playbook-only guidance for an unknown stack', async () => {
    const result = await scaffoldTestingFramework(workspace, makeConfig([{ id: 'unit', enabled: true }]));

    expect(result.success).toBe(true);
    expect(result.stackLabel).toContain('Unknown stack');
    // Only the playbook is written; no language-specific stubs.
    expect(result.files.filter(f => f.created)).toHaveLength(1);
    expect(result.files[0].path).toBe('project_memory/operations/testing-strategy.md');
  });
});
