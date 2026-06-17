import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ProjectTestingConfig, TestingMethodologyId } from '../types.js';
import { TESTING_METHODOLOGY_DEFINITIONS } from '../types.js';

/**
 * Stack-aware testing-framework scaffolder.
 *
 * Reads the enabled methodologies from `testing-config.json`, infers the
 * project's stack, and constructs a starter framework that fits: a managed
 * testing-strategy playbook plus per-methodology config/example files.
 *
 * Safety: strictly non-destructive. Config and example files are only created
 * when absent; never overwritten. `package.json` is never mutated — install
 * commands are surfaced in the playbook for the developer to run. The only
 * file always (re)written is AtlasMind's own managed playbook.
 */

const PLAYBOOK_REL_PATH = 'project_memory/operations/testing-strategy.md';

interface DetectedStack {
  hasPackageJson: boolean;
  isTypeScript: boolean;
  testRunner: 'vitest' | 'jest' | undefined;
  recommendedRunner: 'vitest' | 'jest';
  uiFramework: 'react' | 'vue' | 'svelte' | 'angular' | undefined;
  hasPlaywright: boolean;
  hasCypress: boolean;
  testExt: 'ts' | 'js';
}

export interface ScaffoldFileResult {
  path: string;
  created: boolean;
  reason?: string;
}

export interface TestingScaffoldResult {
  success: boolean;
  summary: string;
  files: ScaffoldFileResult[];
  stackLabel: string;
}

function probe(workspaceRoot: string, rel: string): boolean {
  return existsSync(path.join(workspaceRoot, rel));
}

function detectStack(workspaceRoot: string): DetectedStack {
  let deps: Record<string, string> = {};
  let hasPackageJson = false;
  try {
    const raw = readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8');
    hasPackageJson = true;
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    deps = Object.assign(
      {},
      pkg['dependencies'] as Record<string, string> | undefined,
      pkg['devDependencies'] as Record<string, string> | undefined,
    );
  } catch {
    /* no package.json or unparseable */
  }

  const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(deps, key);

  const isTypeScript = has('typescript') || probe(workspaceRoot, 'tsconfig.json');
  const testRunner: DetectedStack['testRunner'] =
    has('vitest') || probe(workspaceRoot, 'vitest.config.ts') || probe(workspaceRoot, 'vitest.config.js')
      ? 'vitest'
      : has('jest') || probe(workspaceRoot, 'jest.config.js') || probe(workspaceRoot, 'jest.config.ts')
        ? 'jest'
        : undefined;

  const uiFramework: DetectedStack['uiFramework'] = has('react')
    ? 'react'
    : has('vue')
      ? 'vue'
      : has('svelte')
        ? 'svelte'
        : has('@angular/core')
          ? 'angular'
          : undefined;

  return {
    hasPackageJson,
    isTypeScript,
    testRunner,
    recommendedRunner: testRunner ?? 'vitest',
    uiFramework,
    hasPlaywright: has('@playwright/test') || probe(workspaceRoot, 'playwright.config.ts'),
    hasCypress: has('cypress') || probe(workspaceRoot, 'cypress.config.ts'),
    testExt: isTypeScript ? 'ts' : 'js',
  };
}

function stackLabel(stack: DetectedStack): string {
  const parts: string[] = [];
  parts.push(stack.isTypeScript ? 'TypeScript' : stack.hasPackageJson ? 'JavaScript' : 'Unknown stack');
  if (stack.uiFramework) {
    parts.push(stack.uiFramework);
  }
  parts.push(`runner: ${stack.recommendedRunner}${stack.testRunner ? '' : ' (recommended)'}`);
  return parts.join(' · ');
}

interface ScaffoldFile {
  path: string;
  content: string;
}

/** Generates the candidate config/example files for an enabled methodology. */
function recipeFiles(id: TestingMethodologyId, stack: DetectedStack): ScaffoldFile[] {
  const ext = stack.testExt;
  switch (id) {
    case 'unit':
    case 'tdd':
    case 'test-design':
    case 'white-box': {
      const runner = stack.recommendedRunner;
      const example = `tests/example.${runner === 'vitest' ? 'test.' + ext : 'test.' + ext}`;
      const importLine = runner === 'vitest'
        ? "import { describe, it, expect } from 'vitest';"
        : '';
      return [
        {
          path: example,
          content: `${importLine}${importLine ? '\n\n' : ''}describe('example', () => {\n  it('adds numbers', () => {\n    expect(1 + 1).toBe(2);\n  });\n});\n`,
        },
      ];
    }
    case 'e2e': {
      if (stack.hasCypress) {
        return [{
          path: `cypress/e2e/example.cy.${ext}`,
          content: `describe('home page', () => {\n  it('loads', () => {\n    cy.visit('/');\n  });\n});\n`,
        }];
      }
      return [{
        path: `e2e/example.spec.${ext}`,
        content: `import { test, expect } from '@playwright/test';\n\ntest('home page loads', async ({ page }) => {\n  await page.goto('/');\n  await expect(page).toHaveTitle(/.+/);\n});\n`,
      }];
    }
    case 'property':
      return [{
        path: `tests/example.property.test.${ext}`,
        content: `import fc from 'fast-check';\nimport { describe, it } from 'vitest';\n\ndescribe('property: reverse is its own inverse', () => {\n  it('holds for any string', () => {\n    fc.assert(fc.property(fc.string(), (s) => [...s].reverse().reverse().join('') === s));\n  });\n});\n`,
      }];
    case 'performance':
      return [{
        path: `performance/load.k6.js`,
        content: `import http from 'k6/http';\nimport { check, sleep } from 'k6';\n\nexport const options = { vus: 10, duration: '30s' };\n\nexport default function () {\n  const res = http.get('http://localhost:3000/');\n  check(res, { 'status is 200': (r) => r.status === 200 });\n  sleep(1);\n}\n`,
      }];
    case 'snapshot':
      return [{
        path: `tests/example.snapshot.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\n\ndescribe('snapshot', () => {\n  it('matches serialized output', () => {\n    expect({ hello: 'world' }).toMatchSnapshot();\n  });\n});\n`,
      }];
    default:
      return [];
  }
}

/** Per-methodology install hint shown in the playbook. */
function installHint(id: TestingMethodologyId, stack: DetectedStack): string | undefined {
  switch (id) {
    case 'unit':
    case 'tdd':
    case 'test-design':
    case 'white-box':
      return stack.recommendedRunner === 'vitest'
        ? 'npm install -D vitest'
        : 'npm install -D jest';
    case 'e2e':
      return stack.hasCypress ? 'npm install -D cypress' : 'npm install -D @playwright/test && npx playwright install';
    case 'property':
      return 'npm install -D fast-check';
    case 'performance':
      return 'Install k6 (https://k6.io/docs/get-started/installation/) — run: k6 run performance/load.k6.js';
    case 'snapshot':
      return stack.recommendedRunner === 'vitest' ? 'npm install -D vitest' : 'npm install -D jest';
    case 'security-testing':
      return 'npm install -D @types/node && npx audit-ci  •  consider Snyk / Semgrep / Trivy in CI';
    case 'contract':
      return 'npm install -D @pact-foundation/pact';
    case 'mutation':
      return 'npm install -D @stryker-mutator/core @stryker-mutator/vitest-runner';
    case 'visual':
      return 'npm install -D @percy/cli  •  or Chromatic for Storybook';
    default:
      return undefined;
  }
}

function buildPlaybook(config: ProjectTestingConfig, stack: DetectedStack): string {
  const enabled = config.methodologies.filter(m => m.enabled);
  const lines: string[] = [
    '# Testing Strategy Playbook',
    '',
    '> Managed by AtlasMind. Regenerated from `project_memory/index/testing-config.json` on each',
    '> scaffold run. Hand edits to this file are overwritten — change the Settings → Testing matrix instead.',
    '',
    `**Detected stack:** ${stackLabel(stack)}`,
    `**Active methodologies:** ${enabled.length} / ${TESTING_METHODOLOGY_DEFINITIONS.length}`,
    '',
  ];

  if (enabled.length === 0) {
    lines.push('_No methodologies enabled. Enable methodologies in the Settings → Testing matrix, then re-run the scaffolder._');
    return lines.join('\n');
  }

  for (const methodConfig of enabled) {
    const def = TESTING_METHODOLOGY_DEFINITIONS.find(d => d.id === methodConfig.id);
    if (!def) {
      continue;
    }
    lines.push(`## ${def.label}`, '');
    lines.push(`${def.description}`, '');
    lines.push(`- **When to apply:** ${def.whenToUse}`);
    lines.push(`- **Key tools:** ${def.keyTools}`);
    lines.push(`- **Trade-offs:** ${def.tradeoffs}`);
    const install = installHint(methodConfig.id, stack);
    if (install) {
      lines.push(`- **Set up:** \`${install}\``);
    }
    const files = recipeFiles(methodConfig.id, stack);
    if (files.length > 0) {
      lines.push(`- **Starter file:** \`${files[0].path}\``);
    }
    if (methodConfig.notes && methodConfig.notes.trim()) {
      lines.push(`- **Project notes:** ${methodConfig.notes.trim()}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}

/**
 * Constructs the testing framework for the enabled methodologies. Writes a
 * managed playbook (always) and per-methodology starter files (only when
 * absent). Never overwrites existing source/config files.
 */
export async function scaffoldTestingFramework(
  workspaceRoot: string,
  config: ProjectTestingConfig,
): Promise<TestingScaffoldResult> {
  const stack = detectStack(workspaceRoot);
  const label = stackLabel(stack);
  const enabled = config.methodologies.filter(m => m.enabled);

  if (enabled.length === 0) {
    return {
      success: false,
      summary: 'No methodologies are enabled — enable some in the Testing matrix first.',
      files: [],
      stackLabel: label,
    };
  }

  const results: ScaffoldFileResult[] = [];

  // Managed playbook — always (re)written.
  const playbookAbs = path.join(workspaceRoot, PLAYBOOK_REL_PATH);
  try {
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(playbookAbs),
      Buffer.from(buildPlaybook(config, stack), 'utf8'),
    );
    results.push({ path: PLAYBOOK_REL_PATH, created: true });
  } catch (err) {
    results.push({ path: PLAYBOOK_REL_PATH, created: false, reason: err instanceof Error ? err.message : String(err) });
  }

  // Per-methodology starter files — only when absent.
  const seen = new Set<string>();
  for (const methodConfig of enabled) {
    for (const file of recipeFiles(methodConfig.id, stack)) {
      if (seen.has(file.path)) {
        continue;
      }
      seen.add(file.path);
      const abs = path.join(workspaceRoot, file.path);
      if (existsSync(abs)) {
        results.push({ path: file.path, created: false, reason: 'already exists — left untouched' });
        continue;
      }
      try {
        await vscode.workspace.fs.writeFile(vscode.Uri.file(abs), Buffer.from(file.content, 'utf8'));
        results.push({ path: file.path, created: true });
      } catch (err) {
        results.push({ path: file.path, created: false, reason: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  const createdCount = results.filter(r => r.created).length;
  return {
    success: true,
    summary: `Scaffolded testing framework for ${label}: created ${createdCount} file${createdCount === 1 ? '' : 's'}, ` +
      `${results.length - createdCount} skipped/existing.`,
    files: results,
    stackLabel: label,
  };
}
