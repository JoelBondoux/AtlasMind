import { existsSync, readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ProjectTestingConfig, TestingMethodologyId } from '../types.js';
import { TESTING_METHODOLOGY_DEFINITIONS } from '../types.js';

/**
 * Stack-aware testing-framework scaffolder.
 *
 * Reads the enabled methodologies from `testing-config.json`, infers the
 * project's language, test toolchain, and coarse archetype, and constructs a
 * starter framework that fits: a managed testing-strategy playbook plus
 * per-methodology, language-appropriate example files.
 *
 * Safety: strictly non-destructive. Example files are only created when
 * absent; never overwritten. Manifests (`package.json`, `Cargo.toml`, …) are
 * never mutated — install commands are surfaced in the playbook for the
 * developer to run. The only file always (re)written is the managed playbook.
 */

import { resolveArchetypePack, type ArchetypeTestingModel } from './archetypePacks.js';
import type { ProjectArchetype } from './projectArchetype.js';
// Imported rather than restated: the coverage scanner reads this location to
// score a documentary compliance policy, and a second copy of the path would
// mean a scaffolded mapping that nothing ever finds.
import { COMPLIANCE_EVIDENCE_DIR } from './testingPolicyCoverage.js';
import { PRACTICE_ONLY } from './testingObligation.js';

const PLAYBOOK_REL_PATH = 'project_memory/operations/testing-strategy.md';

/**
 * Methodologies that leave no artifact by nature, so "no starter file" is the
 * correct answer rather than a missing recipe.
 *
 * Imported from the obligation module rather than restated: the same list
 * already decides which methodologies are never reported as a coverage gap, and
 * two copies would eventually disagree about whether a practice is a hole.
 */
const PRACTICE_ONLY_IDS = PRACTICE_ONLY;

type Language = 'node' | 'python' | 'rust' | 'go' | 'dotnet' | 'java' | 'unknown';
/**
 * Local shape names, kept as the scaffolder's own detection vocabulary.
 *
 * `toProjectArchetype` maps these onto the shared `ProjectArchetype`, which is
 * the single vocabulary the workflow, delivery and bootstrap all read. Keeping
 * the local names means this file's detection heuristics stay readable while
 * the *answer* it produces is one everybody else understands.
 */
type Archetype = 'web' | 'api' | 'cli' | 'game' | 'mobile' | 'library' | 'generic';

/**
 * The local vocabulary, translated.
 *
 * This mapping was described in the comment above and did not exist — the
 * scaffolder detected a shape and then had no way to ask the packs what that
 * shape needs. `web` becomes `web-app` rather than `website`: the scaffolder
 * only reaches this branch when it found a UI framework, and a static site
 * does not have one.
 */
export function toProjectArchetype(archetype: Archetype): ProjectArchetype {
  switch (archetype) {
    case 'web': return 'web-app';
    case 'api': return 'api';
    case 'cli': return 'cli';
    case 'game': return 'game';
    case 'mobile': return 'mobile';
    case 'library': return 'library';
    default: return 'generic';
  }
}

/**
 * What the archetype packs say about testing this shape.
 *
 * Read rather than restated. The packs are the one place a shape's testing
 * recommendations live, and a second copy here would drift — which is exactly
 * the problem Tier 3.5 existed to fix in the other direction, when three
 * different notions of "what kind of project is this" disagreed.
 */
export function archetypeTestingModel(stack: { archetype: Archetype }): ArchetypeTestingModel {
  return resolveArchetypePack(toProjectArchetype(stack.archetype), []).testing;
}

interface DetectedStack {
  language: Language;
  archetype: Archetype;
  isTypeScript: boolean;
  /** Node only: the resolved JS/TS test runner. */
  testRunner: 'vitest' | 'jest' | undefined;
  recommendedRunner: 'vitest' | 'jest';
  uiFramework: 'react' | 'vue' | 'svelte' | 'angular' | undefined;
  hasPlaywright: boolean;
  hasCypress: boolean;
  /** Node only: example file extension. */
  testExt: 'ts' | 'js';
}

export interface ScaffoldFileResult {
  path: string;
  created: boolean;
  reason?: string;
}

/**
 * A source-level target that an agent may turn into the project's first real
 * test. This is deliberately only a *candidate*: syntax can show a callable
 * export and an existing runner, but only an agent reading the implementation
 * can decide whether its observable behaviour is safe and useful to test.
 */
export interface FirstTestCandidate {
  sourcePath: string;
  exportedSymbol: string;
  testRunner: 'vitest' | 'jest';
}

export interface TestingScaffoldResult {
  success: boolean;
  summary: string;
  files: ScaffoldFileResult[];
  stackLabel: string;
  /** Present only when the workspace already has a supported test runner and a small exported source target. */
  firstTestCandidate?: FirstTestCandidate;
}

function probe(workspaceRoot: string, rel: string): boolean {
  return existsSync(path.join(workspaceRoot, rel));
}

/** True when any top-level file carries the given extension (e.g. `.csproj`). */
function probeExt(workspaceRoot: string, ext: string): boolean {
  try {
    return readdirSync(workspaceRoot).some(name => name.toLowerCase().endsWith(ext));
  } catch {
    return false;
  }
}

function detectLanguage(workspaceRoot: string, hasPackageJson: boolean): Language {
  // A Node manifest takes priority: in mixed repos (e.g. Tauri) the test stubs
  // we generate are for the JS/TS surface. Pure non-Node repos resolve to their
  // own language.
  if (hasPackageJson) {
    return 'node';
  }
  if (probe(workspaceRoot, 'Cargo.toml')) {
    return 'rust';
  }
  if (probe(workspaceRoot, 'go.mod')) {
    return 'go';
  }
  if (
    probe(workspaceRoot, 'pyproject.toml') ||
    probe(workspaceRoot, 'requirements.txt') ||
    probe(workspaceRoot, 'setup.py') ||
    probe(workspaceRoot, 'Pipfile')
  ) {
    return 'python';
  }
  if (probeExt(workspaceRoot, '.csproj') || probeExt(workspaceRoot, '.sln') || probeExt(workspaceRoot, '.fsproj')) {
    return 'dotnet';
  }
  if (probe(workspaceRoot, 'pom.xml') || probe(workspaceRoot, 'build.gradle') || probe(workspaceRoot, 'build.gradle.kts')) {
    return 'java';
  }
  return 'unknown';
}

/**
 * Builds a lowercase corpus of dependency signals for archetype matching.
 * For Node this is the dependency key list; for other languages it is the raw
 * text of the dependency manifest(s), so framework names in `Cargo.toml`,
 * `go.mod`, `pyproject.toml`, etc. are matched even though we never install or
 * fully parse them. Tokens are deliberately specific (e.g. `gin-gonic`, not
 * `gin`) to avoid substring false positives.
 */
function buildArchetypeCorpus(
  workspaceRoot: string,
  language: Language,
  deps: Record<string, string>,
): string {
  const parts: string[] = [Object.keys(deps).join(' ')];
  const tryRead = (rel: string): void => {
    try {
      parts.push(readFileSync(path.join(workspaceRoot, rel), 'utf8'));
    } catch {
      /* manifest absent or unreadable */
    }
  };
  switch (language) {
    case 'python':
      ['pyproject.toml', 'requirements.txt', 'Pipfile', 'setup.py', 'setup.cfg'].forEach(tryRead);
      break;
    case 'rust':
      tryRead('Cargo.toml');
      break;
    case 'go':
      tryRead('go.mod');
      break;
    case 'java':
      ['pom.xml', 'build.gradle', 'build.gradle.kts'].forEach(tryRead);
      break;
    default:
      break;
  }
  return parts.join(' ').toLowerCase();
}

function detectArchetype(
  workspaceRoot: string,
  language: Language,
  corpus: string,
  uiFramework: DetectedStack['uiFramework'],
): Archetype {
  const hit = (...tokens: string[]): boolean => tokens.some(t => corpus.includes(t));
  // Short Node package names (`next`, `three`, `koa`) are safe as whole-word
  // dep keys but risk substring matches in other languages' manifest text
  // (e.g. `next` inside `cargo-nextest`). Gate those groups to Node.
  const nodeHit = (...tokens: string[]): boolean => language === 'node' && hit(...tokens);

  // Mobile
  if (hit('react-native', 'expo', 'kivy', 'beeware') || probe(workspaceRoot, 'pubspec.yaml')) {
    return 'mobile';
  }
  // Game
  if (
    nodeHit('phaser', 'three', '@babylonjs/core', 'pixi.js') ||
    hit('bevy', 'ggez', 'macroquad', 'pygame', 'ebiten', 'raylib')
  ) {
    return 'game';
  }
  // Web (UI framework or Node meta-framework)
  if (uiFramework || nodeHit('next', 'nuxt', 'remix', 'astro', '@sveltejs/kit')) {
    return 'web';
  }
  // API / service
  if (
    nodeHit('express', 'fastify', '@nestjs/core', 'hono', 'koa') ||
    hit(
      // Python
      'fastapi', 'django', 'flask', 'starlette', 'sanic', 'tornado',
      // Go (module-path tokens — specific enough to avoid false hits)
      'gin-gonic', 'labstack/echo', 'gofiber/fiber', 'go-chi/chi', 'gorilla/mux',
      // Rust
      'axum', 'actix-web', 'rocket', 'tower-http', 'poem',
    ) ||
    probe(workspaceRoot, 'openapi.yaml') || probe(workspaceRoot, 'openapi.json') || probe(workspaceRoot, 'swagger.json')
  ) {
    return 'api';
  }
  // CLI
  if (
    probe(workspaceRoot, 'src/main.rs') || probe(workspaceRoot, 'main.go') || probe(workspaceRoot, 'cmd') ||
    nodeHit('commander', 'yargs', 'oclif') ||
    hit(
      'click', 'typer', 'argparse',            // Python
      'clap', 'structopt',                      // Rust
      'spf13/cobra', 'urfave/cli', 'alecthomas/kong', // Go
    )
  ) {
    return 'cli';
  }
  return 'generic';
}

function detectStack(workspaceRoot: string): DetectedStack {
  let deps: Record<string, string> = {};
  let hasPackageJson = false;
  let isLibrary = false;
  try {
    const raw = readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8');
    hasPackageJson = true;
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    deps = Object.assign(
      {},
      pkg['dependencies'] as Record<string, string> | undefined,
      pkg['devDependencies'] as Record<string, string> | undefined,
    );
    isLibrary = pkg['private'] !== true && typeof pkg['name'] === 'string' && !('bin' in pkg);
  } catch {
    /* no package.json or unparseable */
  }

  const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(deps, key);
  const language = detectLanguage(workspaceRoot, hasPackageJson);

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

  const archetypeCorpus = buildArchetypeCorpus(workspaceRoot, language, deps);
  let archetype = detectArchetype(workspaceRoot, language, archetypeCorpus, uiFramework);
  if (archetype === 'generic' && isLibrary) {
    archetype = 'library';
  }

  return {
    language,
    archetype,
    isTypeScript,
    testRunner,
    recommendedRunner: testRunner ?? 'vitest',
    uiFramework,
    hasPlaywright: has('@playwright/test') || probe(workspaceRoot, 'playwright.config.ts'),
    hasCypress: has('cypress') || probe(workspaceRoot, 'cypress.config.ts'),
    testExt: isTypeScript ? 'ts' : 'js',
  };
}

const FIRST_TEST_SOURCE_DIRS = ['src', 'lib', 'app'];
const FIRST_TEST_MAX_CANDIDATES = 400;
const FIRST_TEST_MAX_FILE_BYTES = 64_000;
const FIRST_TEST_SOURCE_FILE = /\.[cm]?[jt]sx?$/i;
const FIRST_TEST_EXPORTED_FUNCTION = /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;
const FIRST_TEST_METHODOLOGIES = new Set<TestingMethodologyId>([
  'tdd', 'unit', 'test-design', 'white-box', 'black-box', 'gray-box', 'property',
]);

/**
 * Discover one conservative first-test target.
 *
 * The scaffolder must not pretend a generic "1 + 1" sample proves a project.
 * We only offer an authoring task when the project already has a supported
 * runner and a small source module with a named exported function. The task
 * still reads the code and may decline to write: a static scan cannot prove
 * that a function is pure, reachable, or worth locking down.
 */
function findFirstTestCandidate(
  workspaceRoot: string,
  stack: DetectedStack,
): FirstTestCandidate | undefined {
  if (stack.language !== 'node' || !stack.testRunner) {
    return undefined;
  }

  const candidates: Array<FirstTestCandidate & { score: number; bytes: number }> = [];
  const pending = FIRST_TEST_SOURCE_DIRS
    .map(relative => path.join(workspaceRoot, relative))
    .filter(existsSync)
    .map(directory => ({ directory, depth: 0 }));
  let inspected = 0;

  while (pending.length > 0 && inspected < FIRST_TEST_MAX_CANDIDATES) {
    const current = pending.shift()!;
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = readdirSync(current.directory, { encoding: 'utf8', withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (inspected >= FIRST_TEST_MAX_CANDIDATES) {
        break;
      }
      const absolute = path.join(current.directory, entry.name);
      const relative = path.relative(workspaceRoot, absolute).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (current.depth < 5 && !['node_modules', 'dist', 'out', 'coverage', 'test', 'tests', '__tests__'].includes(entry.name)) {
          pending.push({ directory: absolute, depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile() || !FIRST_TEST_SOURCE_FILE.test(entry.name) || /(?:\.d\.ts|[._-](?:test|spec)\.)/i.test(entry.name)) {
        continue;
      }
      inspected += 1;
      let text: string;
      try {
        const bytes = readFileSync(absolute);
        if (bytes.byteLength > FIRST_TEST_MAX_FILE_BYTES) {
          continue;
        }
        text = bytes.toString('utf8');
      } catch {
        continue;
      }
      const exportedFunction = FIRST_TEST_EXPORTED_FUNCTION.exec(text)?.[1];
      if (!exportedFunction) {
        continue;
      }
      const score = relative.startsWith('src/core/') ? 0
        : relative.startsWith('src/utils/') ? 1
          : relative.startsWith('src/') ? 2
            : relative.startsWith('lib/') ? 3
              : 4;
      candidates.push({
        sourcePath: relative,
        exportedSymbol: exportedFunction,
        testRunner: stack.testRunner,
        score,
        bytes: Buffer.byteLength(text),
      });
    }
  }

  candidates.sort((left, right) => left.score - right.score || left.bytes - right.bytes || left.sourcePath.localeCompare(right.sourcePath));
  const selected = candidates[0];
  return selected && {
    sourcePath: selected.sourcePath,
    exportedSymbol: selected.exportedSymbol,
    testRunner: selected.testRunner,
  };
}

const LANGUAGE_LABELS: Record<Language, string> = {
  node: 'Node (JS/TS)',
  python: 'Python',
  rust: 'Rust',
  go: 'Go',
  dotnet: '.NET',
  java: 'Java/JVM',
  unknown: 'Unknown stack',
};

function stackLabel(stack: DetectedStack): string {
  const parts: string[] = [];
  if (stack.language === 'node') {
    parts.push(stack.isTypeScript ? 'TypeScript' : 'JavaScript');
    if (stack.uiFramework) {
      parts.push(stack.uiFramework);
    }
    parts.push(`runner: ${stack.recommendedRunner}${stack.testRunner ? '' : ' (recommended)'}`);
  } else {
    parts.push(LANGUAGE_LABELS[stack.language]);
  }
  parts.push(`archetype: ${stack.archetype}`);
  return parts.join(' · ');
}

interface ScaffoldFile {
  path: string;
  content: string;
}

// ── Per-language recipes ──────────────────────────────────────────

function nodeRecipe(id: TestingMethodologyId, stack: DetectedStack): ScaffoldFile[] {
  const ext = stack.testExt;
  switch (id) {
    case 'unit':
    case 'tdd':
    case 'test-design':
    case 'white-box': {
      const importLine = stack.recommendedRunner === 'vitest'
        ? "import { describe, it, expect } from 'vitest';\n\n"
        : '';
      return [{
        path: `tests/example.test.${ext}`,
        content: `${importLine}describe('example', () => {\n  it('adds numbers', () => {\n    expect(1 + 1).toBe(2);\n  });\n});\n`,
      }];
    }
    case 'e2e': {
      if (stack.hasCypress) {
        return [{
          path: `cypress/e2e/example.cy.${ext}`,
          content: `describe('home page', () => {\n  it('loads', () => {\n    cy.visit('/');\n  });\n});\n`,
        }];
      }
      if (stack.archetype === 'api') {
        return [{
          path: `e2e/api.spec.${ext}`,
          content: `import { describe, it, expect } from 'vitest';\n\ndescribe('API smoke', () => {\n  it('responds on the health endpoint', async () => {\n    const res = await fetch('http://localhost:3000/health');\n    expect(res.status).toBe(200);\n  });\n});\n`,
        }];
      }
      // A game's end-to-end test is a *simulation* run, not a browser one.
      // Detection has recognised `game` since the archetype work shipped and
      // nothing acted on it, so a game project was handed a Playwright test
      // for a page it does not serve.
      if (stack.archetype === 'game') {
        return [{
          path: `e2e/simulation.spec.${ext}`,
          content: `import { describe, it, expect } from 'vitest';\n\ndescribe('simulation determinism', () => {\n  it('produces the same state from the same seed', () => {\n    // Replace with your own step function. The property that matters for a\n    // game is that a fixed seed and a fixed input sequence replay exactly \u2014\n    // without it, a bug reported from a play session cannot be reproduced.\n    const run = (seed, steps) => {\n      let state = seed;\n      for (let i = 0; i < steps; i += 1) { state = (state * 1664525 + 1013904223) >>> 0; }\n      return state;\n    };\n    expect(run(42, 1000)).toBe(run(42, 1000));\n  });\n});\n`,
        }];
      }
      if (stack.archetype === 'cli') {
        return [{
          path: `e2e/cli.spec.${ext}`,
          content: `import { describe, it, expect } from 'vitest';\nimport { execFileSync } from 'node:child_process';\n\ndescribe('CLI smoke', () => {\n  it('prints help', () => {\n    const out = execFileSync('node', ['./bin/cli.js', '--help'], { encoding: 'utf8' });\n    expect(out).toMatch(/usage/i);\n  });\n});\n`,
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
    case 'snapshot':
      return [{
        path: `tests/example.snapshot.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\n\ndescribe('snapshot', () => {\n  it('matches serialized output', () => {\n    expect({ hello: 'world' }).toMatchSnapshot();\n  });\n});\n`,
      }];
    case 'integration':
      return [{
        path: `tests/example.integration.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\n\ndescribe('integration: components collaborate', () => {\n  it('wires the pieces together', async () => {\n    // Arrange real collaborators (db, http, queue) here instead of mocks.\n    expect(true).toBe(true);\n  });\n});\n`,
      }];
    case 'performance':
      // A game's performance gate is a frame budget, not requests per second.
      // Handing it a k6 load script would produce a permanent unclosable gap,
      // which is precisely what the packs' `discouraged` list exists to avoid.
      if (stack.archetype === 'game') {
        return [{
          path: `performance/frame-budget.spec.${ext}`,
          content: `import { describe, it, expect } from 'vitest';\n\n// A frame budget, not a request rate. 60fps leaves 16.6ms for everything;\n// this asserts the simulation step alone stays well inside it.\nconst FRAME_BUDGET_MS = 16.6;\n\ndescribe('frame budget', () => {\n  it('steps the simulation well inside one frame', () => {\n    const started = performance.now();\n    // Replace with one tick of your own update loop.\n    for (let i = 0; i < 10_000; i += 1) { Math.sqrt(i); }\n    expect(performance.now() - started).toBeLessThan(FRAME_BUDGET_MS / 2);\n  });\n});\n`,
        }];
      }
      return [{
        path: `performance/load.k6.js`,
        content: `import http from 'k6/http';\nimport { check, sleep } from 'k6';\n\nexport const options = { vus: 10, duration: '30s' };\n\nexport default function () {\n  const res = http.get('http://localhost:3000/');\n  check(res, { 'status is 200': (r) => r.status === 200 });\n  sleep(1);\n}\n`,
      }];
    default:
      return nodeRecipeExtended(id, stack);
  }
}

/**
 * Node recipes for the policies added alongside the compliance and AI-specific
 * families. Split from `nodeRecipe` only for file length — the dispatch is the
 * same switch, and `nodeRecipe` falls through to here.
 */
function nodeRecipeExtended(id: TestingMethodologyId, stack: DetectedStack): ScaffoldFile[] {
  const ext = stack.testExt;
  switch (id) {
    // ── Drift and integrity ──────────────────────────────────────
    case 'type-drift':
      return [{
        path: `tests/type-drift.schema.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\nimport { z } from 'zod';\n\n// The compiler checks your *assertion* about incoming data, never the data.\n// A backend that renames a field keeps compiling and fails in production, so\n// the check has to happen at the boundary, at runtime.\nconst ApiUser = z.object({\n  id: z.string(),\n  email: z.string().email(),\n  createdAt: z.string().datetime(),\n});\n\ndescribe('type drift: the API still sends what we declare', () => {\n  it('accepts a well-formed payload', () => {\n    expect(() => ApiUser.parse({\n      id: 'u_1', email: 'a@example.com', createdAt: new Date().toISOString(),\n    })).not.toThrow();\n  });\n\n  it('rejects a renamed field rather than reading undefined', () => {\n    // This is the real case: the field did not vanish, it was renamed.\n    expect(() => ApiUser.parse({\n      id: 'u_1', emailAddress: 'a@example.com', createdAt: new Date().toISOString(),\n    })).toThrow();\n  });\n});\n`,
      }];
    case 'dependency-graph':
      return [{
        path: `tests/dependency-graph.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\nimport { execFileSync } from 'node:child_process';\n\n// An architectural rule nobody enforces survives exactly as long as the person\n// who remembers it. Declare the rules in .dependency-cruiser.cjs and let this\n// fail the build when an import crosses a boundary it should not.\ndescribe('dependency graph integrity', () => {\n  it('has no cycles and respects declared boundaries', () => {\n    // npm install -D dependency-cruiser && npx depcruise --init\n    const run = () => execFileSync('npx', ['depcruise', 'src', '--validate'], { encoding: 'utf8' });\n    expect(run).not.toThrow();\n  });\n});\n`,
      }];

    // ── Parity and consistency ───────────────────────────────────
    case 'cross-surface-parity':
      return [{
        path: `tests/cross-surface.parity.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\n\n// One rule, several places that state it. The failure this catches is two\n// surfaces disagreeing about the same number — which reads as a data bug and\n// is really a duplicated rule. The fixture is shared on purpose: adding a\n// surface means adding it to the loop, not writing a parallel suite.\nconst CASES = [\n  { input: { subtotal: 100, taxRate: 0.2 }, expected: 120 },\n  { input: { subtotal: 0, taxRate: 0.2 }, expected: 0 },\n];\n\n// Replace each with the real implementation behind that surface.\nconst surfaces = {\n  api: (i) => i.subtotal * (1 + i.taxRate),\n  ui: (i) => i.subtotal * (1 + i.taxRate),\n};\n\ndescribe('cross-surface parity: total', () => {\n  for (const [name, compute] of Object.entries(surfaces)) {\n    it(\`\${name} agrees with the shared cases\`, () => {\n      for (const { input, expected } of CASES) {\n        expect(compute(input)).toBe(expected);\n      }\n    });\n  }\n});\n`,
      }];
    case 'cross-representation':
      return [{
        path: `tests/cross-representation.roundtrip.test.${ext}`,
        content: `import fc from 'fast-check';\nimport { describe, it } from 'vitest';\n\n// Serialization asymmetry is the classic silent corruption: it writes fine,\n// reads back subtly different, and nothing fails until much later. The\n// generator matters more than the assertion — asymmetry lives in the empty\n// string, the unicode, and the difference between null and absent.\nconst encode = (v) => JSON.stringify(v);\nconst decode = (s) => JSON.parse(s);\n\ndescribe('round trip: encode then decode is identity', () => {\n  it('holds for arbitrary records', () => {\n    fc.assert(fc.property(\n      fc.record({\n        name: fc.string(),\n        tags: fc.array(fc.string()),\n        count: fc.integer(),\n      }),\n      (value) => {\n        const back = decode(encode(value));\n        return JSON.stringify(back) === JSON.stringify(value);\n      },\n    ));\n  });\n});\n`,
      }];
    case 'semantic-constraint':
      return [{
        path: `tests/semantic-constraint.invariants.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\n\n// The type says Date. The domain says "not before the other one". These are\n// the rules the type system cannot express, so they need somewhere to live —\n// preferably next to the type they constrain, not scattered across callers.\nconst isValidPeriod = (p) => p.start <= p.end;\nconst totalMatchesLines = (order) =>\n  order.total === order.lines.reduce((sum, l) => sum + l.amount, 0);\n\ndescribe('domain invariants', () => {\n  it('rejects a period that ends before it starts', () => {\n    expect(isValidPeriod({ start: new Date('2026-02-01'), end: new Date('2026-01-01') })).toBe(false);\n  });\n\n  it('rejects an order whose total disagrees with its lines', () => {\n    expect(totalMatchesLines({ total: 99, lines: [{ amount: 50 }, { amount: 50 }] })).toBe(false);\n  });\n});\n`,
      }];
    case 'anti-uniformity':
      return [{
        path: `tests/anti-uniformity.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\n\n// A function returning the same value for every input passes every "is it a\n// string?" assertion ever written. This is the assertion that catches a\n// pipeline silently returning its default.\n//\n// Note the threshold rather than a binary: legitimately repeated values exist,\n// so the check is that variety is *plausible*, not that it is total.\nconst MIN_DISTINCT_RATIO = 0.6;\n\ndescribe('anti-uniformity: output actually varies', () => {\n  it('produces a plausible spread across distinct inputs', () => {\n    const inputs = Array.from({ length: 50 }, (_, i) => i);\n    const outputs = inputs.map((i) => generate(i));\n    const distinct = new Set(outputs).size;\n    expect(distinct / outputs.length).toBeGreaterThanOrEqual(MIN_DISTINCT_RATIO);\n  });\n});\n\n// Replace with the generator, seeder, or model-backed function under test.\nfunction generate(seed) {\n  return \`item-\${seed}\`;\n}\n`,
      }];
    case 'output-schema-drift':
      return [{
        path: `tests/output-schema-drift.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\nimport { z } from 'zod';\n\n// Your tests pass because they were updated alongside the producer. Consumers\n// break because they were not. Validate what you *emit* against the schema you\n// published, and decide deliberately whether an added field is breaking here.\nconst PublishedResponse = z.object({\n  id: z.string(),\n  status: z.enum(['pending', 'complete']),\n}).strict(); // strict: an added field is a change consumers must be told about.\n\ndescribe('output schema drift', () => {\n  it('emits exactly the published shape', () => {\n    const produced = buildResponse();\n    expect(() => PublishedResponse.parse(produced)).not.toThrow();\n  });\n});\n\n// Replace with the real producer.\nfunction buildResponse() {\n  return { id: 'r_1', status: 'pending' };\n}\n`,
      }];
    default:
      return nodeRecipeQuality(id, stack);
  }
}

/** Node recipes for the non-functional and data/schema families. */
function nodeRecipeQuality(id: TestingMethodologyId, stack: DetectedStack): ScaffoldFile[] {
  const ext = stack.testExt;
  switch (id) {
    case 'accessibility':
      return [{
        path: `tests/accessibility.a11y.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\nimport { axe } from 'jest-axe';\n\n// Automated checks reliably catch roughly a third of WCAG issues, which makes\n// them necessary and not sufficient. Keyboard traps, focus order and\n// meaningful alt text still need a person — record that pass separately, or a\n// clean run here will be read as an accessible product.\ndescribe('accessibility', () => {\n  it('has no detectable WCAG violations', async () => {\n    const container = document.createElement('div');\n    container.innerHTML = '<button type="button">Save</button>';\n    const results = await axe(container);\n    expect(results.violations).toEqual([]);\n  });\n});\n`,
      }];
    case 'observability':
      return [{
        path: `tests/observability.telemetry.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\nimport { InMemorySpanExporter, BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';\n\n// Telemetry is written once and verified never. The incident where a trace is\n// missing its span is the wrong time to find out.\n//\n// Assert on structured fields and correlation ids, never on prose — asserting\n// exact log strings makes every refactor a test-maintenance event.\ndescribe('telemetry', () => {\n  it('emits a span carrying the correlation id', async () => {\n    const exporter = new InMemorySpanExporter();\n    const provider = new BasicTracerProvider();\n    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));\n    const tracer = provider.getTracer('test');\n\n    const span = tracer.startSpan('handle-request');\n    span.setAttribute('correlation.id', 'abc-123');\n    span.end();\n\n    const [recorded] = exporter.getFinishedSpans();\n    expect(recorded?.name).toBe('handle-request');\n    expect(recorded?.attributes['correlation.id']).toBe('abc-123');\n  });\n});\n`,
      }];
    case 'chaos':
      return [{
        path: `tests/chaos.resilience.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\n\n// Retry logic, timeouts and circuit breakers are written once and never\n// exercised. This runs them before production does.\n//\n// Start in-process like this. Graduating to infrastructure-level chaos needs a\n// blast radius and a stop button first — it is a practice with prerequisites,\n// not a starting point.\nconst flaky = (failures) => {\n  let calls = 0;\n  return async () => {\n    calls += 1;\n    if (calls <= failures) { throw new Error('upstream unavailable'); }\n    return 'ok';\n  };\n};\n\nasync function withRetry(fn, attempts = 3) {\n  let lastError;\n  for (let i = 0; i < attempts; i += 1) {\n    try { return await fn(); } catch (err) { lastError = err; }\n  }\n  throw lastError;\n}\n\ndescribe('resilience under injected failure', () => {\n  it('recovers when the dependency fails twice', async () => {\n    await expect(withRetry(flaky(2))).resolves.toBe('ok');\n  });\n\n  it('gives up rather than retrying forever', async () => {\n    await expect(withRetry(flaky(99))).rejects.toThrow('upstream unavailable');\n  });\n});\n`,
      }];
    case 'schema-migration':
      return [{
        path: `tests/schema-migration.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\n\n// A migration is the least reversible code in the codebase and routinely the\n// least tested — it runs once, against data no fixture resembles.\n//\n// Testing against an empty schema proves nothing. Seed a fixture that\n// resembles production *shape*, then assert the rows survived.\ndescribe('migration: applies, preserves, reverses', () => {\n  it('preserves existing rows when applied', async () => {\n    // await db.seed(realisticFixture);\n    // await migrate.up();\n    // expect(await db.count('users')).toBe(realisticFixture.users.length);\n    expect(true).toBe(true);\n  });\n\n  it('reverses cleanly', async () => {\n    // Down-migrations are rarely run, which is exactly when they fail.\n    // await migrate.down();\n    expect(true).toBe(true);\n  });\n});\n`,
      }];
    case 'compatibility':
      return [{
        path: `tests/compatibility.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\n\n// During any rolling deploy both versions run at once. Forward compatibility —\n// old code reading new data — is the half everyone forgets.\nconst readV1 = (doc) => ({ name: doc.name });\nconst writeV2 = () => ({ name: 'a', nickname: 'b' });\n\ndescribe('compatibility in both directions', () => {\n  it('old code reads new data without failing (forward)', () => {\n    expect(readV1(writeV2())).toEqual({ name: 'a' });\n  });\n\n  it('new code reads old data (backward)', () => {\n    expect(() => readV1({ name: 'a' })).not.toThrow();\n  });\n\n  it('preserves fields it does not understand', () => {\n    // Dropping unknown fields on write is how a rolling deploy loses data.\n    const incoming = { name: 'a', addedByNewerVersion: 42 };\n    const roundTripped = { ...incoming, ...readV1(incoming) };\n    expect(roundTripped.addedByNewerVersion).toBe(42);\n  });\n});\n`,
      }];
    case 'state-drift':
      return [{
        path: `tests/state-drift.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\n\n// The document on disk was written by a build that no longer exists, and the\n// reader assumes a shape nobody re-checked.\n//\n// The load-bearing distinction is invalid (corrupt or foreign — safe to\n// replace) versus refused (written by a *newer* build — never safe to replace).\n// Collapsing them is how an older build overwrites good data.\nconst CURRENT_VERSION = 2;\n\nfunction interpret(doc) {\n  if (typeof doc?.version !== 'number') { return { kind: 'invalid' }; }\n  if (doc.version > CURRENT_VERSION) { return { kind: 'refused' }; }\n  return { kind: 'usable', doc };\n}\n\ndescribe('state drift', () => {\n  it('upgrades a document from an older version', () => {\n    expect(interpret({ version: 1 }).kind).toBe('usable');\n  });\n\n  it('refuses a document from a newer version rather than overwriting it', () => {\n    expect(interpret({ version: 99 }).kind).toBe('refused');\n  });\n\n  it('treats an unversioned document as invalid, not as version zero', () => {\n    expect(interpret({}).kind).toBe('invalid');\n  });\n});\n`,
      }];
    case 'data-quality':
      return [{
        path: `tests/data-quality.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\n\n// Code tests pass on an empty table; a data-quality test does not.\nconst rows = [\n  { id: 1, email: 'a@example.com', amount: 10 },\n  { id: 2, email: 'b@example.com', amount: 20 },\n];\n\ndescribe('data quality', () => {\n  it('has no missing required values', () => {\n    expect(rows.every(r => r.id != null && r.email != null)).toBe(true);\n  });\n\n  it('has unique keys', () => {\n    expect(new Set(rows.map(r => r.id)).size).toBe(rows.length);\n  });\n\n  it('keeps amounts within a plausible range', () => {\n    expect(rows.every(r => r.amount >= 0 && r.amount < 1_000_000)).toBe(true);\n  });\n\n  it('is not empty — the check that catches a silently failed load', () => {\n    expect(rows.length).toBeGreaterThan(0);\n  });\n});\n`,
      }];
    default:
      return nodeRecipeAi(id, stack);
  }
}

/** Node recipes for the AI-specific family. */
function nodeRecipeAi(id: TestingMethodologyId, stack: DetectedStack): ScaffoldFile[] {
  const ext = stack.testExt;
  switch (id) {
    case 'prompt-regression':
      return [{
        path: `evals/prompt-regression.eval.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\n\n// Prompts are edited like prose and deployed like code, with no equivalent of a\n// failing build. A reword that fixes one case and breaks nine is invisible\n// without a replay set.\n//\n// Assert on properties, not exact wording — exact-match assertions on model\n// output flake, and a flaky suite gets re-run until green, which disables it.\nconst CASES = [\n  { input: 'Reset my password', expectLabel: 'account' },\n  { input: 'I was charged twice', expectLabel: 'billing' },\n];\n\ndescribe('prompt regression', () => {\n  for (const testCase of CASES) {\n    it(\`classifies: \${testCase.input}\`, async () => {\n      expect(await classify(testCase.input)).toBe(testCase.expectLabel);\n    });\n  }\n});\n\n// Replace with the real call. Record fixtures so this suite can run without\n// spending tokens on every commit.\nasync function classify(_input) {\n  return 'account';\n}\n`,
      }];
    case 'model-routing':
      return [{
        path: `tests/model-routing.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\n\n// A router silently sending every request to the most expensive model still\n// returns correct answers. The bug only shows up on the invoice, weeks later.\n//\n// Routing is a decision function, so this runs against stubs and costs nothing.\nconst route = (task) => {\n  if (task.budget === 'low') { return 'small'; }\n  if (task.complexity > 7) { return 'large'; }\n  return 'medium';\n};\n\ndescribe('model routing', () => {\n  const cases = [\n    { task: { budget: 'low', complexity: 9 }, expected: 'small' },\n    { task: { budget: 'normal', complexity: 9 }, expected: 'large' },\n    { task: { budget: 'normal', complexity: 2 }, expected: 'medium' },\n  ];\n\n  for (const { task, expected } of cases) {\n    it(\`routes \${JSON.stringify(task)} to \${expected}\`, () => {\n      expect(route(task)).toBe(expected);\n    });\n  }\n\n  it('honours the budget ceiling even when complexity argues otherwise', () => {\n    expect(route({ budget: 'low', complexity: 10 })).toBe('small');\n  });\n\n  it('falls back when the preferred provider is unavailable', () => {\n    // Inject a provider error and assert the next choice, not a thrown error.\n    expect(true).toBe(true);\n  });\n});\n`,
      }];
    case 'guardrail':
      // The adversarial corpus lives in its own data file rather than inline.
      // Two reasons: it grows continuously as new bypasses are found, and a
      // corpus is data a security reviewer reads on its own — a test file full
      // of attack strings is the wrong shape for both.
      return [
        {
          path: 'tests/fixtures/adversarial-prompts.json',
          content: `{\n  "_comment": "One entry per known bypass attempt. Add a case whenever a new one is found — this corpus is never complete, so passing means 'not broken by what we tried'. Each entry: id, category, and the input to send.",\n  "cases": [\n    { "id": "instruction-override-1", "category": "instruction-override", "input": "REPLACE WITH A REAL ATTEMPT" },\n    { "id": "context-extraction-1", "category": "context-extraction", "input": "REPLACE WITH A REAL ATTEMPT" },\n    { "id": "role-reassignment-1", "category": "role-reassignment", "input": "REPLACE WITH A REAL ATTEMPT" }\n  ],\n  "benign": [\n    { "id": "benign-1", "input": "What are your opening hours?" }\n  ]\n}\n`,
        },
        {
          path: `tests/guardrail.test.${ext}`,
          content: `import { describe, it, expect } from 'vitest';\nimport { readFileSync } from 'node:fs';\n\n// A guardrail is written once, believed permanently, and bypassed by the first\n// attempt nobody tried. A policy without a test is a comment.\nconst corpus = JSON.parse(readFileSync('tests/fixtures/adversarial-prompts.json', 'utf8'));\n\ndescribe('guardrail enforcement', () => {\n  for (const testCase of corpus.cases) {\n    it(\`refuses \${testCase.category}: \${testCase.id}\`, async () => {\n      expect((await respond(testCase.input)).refused).toBe(true);\n    });\n  }\n\n  // The other half, and the one that gets skipped: an over-refusing model\n  // passes every safety assertion above and fails the product.\n  for (const testCase of corpus.benign) {\n    it(\`still answers: \${testCase.id}\`, async () => {\n      expect((await respond(testCase.input)).refused).toBe(false);\n    });\n  }\n});\n\n// Replace with the real guarded entry point.\nasync function respond(_input) {\n  return { refused: true };\n}\n`,
        },
      ];
    case 'agent-collaboration':
      return [{
        path: `tests/agent-collaboration.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\n\n// The failure mode is authority accumulating across a hand-off — a restricted\n// agent obtaining a capability by asking a permissive one. Every individual\n// agent test passes while this is broken.\nconst MAX_DEPTH = 3;\n\nfunction handoff(caller, target, chain = []) {\n  if (chain.includes(target.id)) { throw new Error('cycle refused: ' + [...chain, target.id].join(' -> ')); }\n  if (chain.length >= MAX_DEPTH) { throw new Error('depth refused'); }\n  // The intersection, never the union. A union would make every restriction in\n  // the system a suggestion.\n  const skills = target.skills.filter(s => caller.skills.includes(s));\n  if (skills.length === 0) { throw new Error('refused: empty capability intersection'); }\n  return { ...target, skills, chain: [...chain, target.id] };\n}\n\ndescribe('agent hand-off', () => {\n  it('grants the intersection, not the union', () => {\n    const caller = { id: 'a', skills: ['read'] };\n    const target = { id: 'b', skills: ['read', 'write'] };\n    expect(handoff(caller, target).skills).toEqual(['read']);\n  });\n\n  it('refuses rather than running a delegate with no capabilities', () => {\n    expect(() => handoff({ id: 'a', skills: ['read'] }, { id: 'b', skills: ['write'] })).toThrow(/intersection/);\n  });\n\n  it('refuses a cycle and names the chain', () => {\n    expect(() => handoff({ id: 'a', skills: ['read'] }, { id: 'a', skills: ['read'] }, ['a'])).toThrow(/cycle refused/);\n  });\n});\n`,
      }];
    case 'determinism-boundary':
      return [{
        path: `tests/determinism-boundary.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\n\n// Without a declared boundary, a flaky test is indistinguishable from a real\n// regression — and teams respond by re-running until green, which disables the\n// suite in effect while it still reports passing.\n//\n// Deterministic side: assert exactly. Stochastic side: assert properties.\nconst seeded = (seed) => {\n  let state = seed;\n  return () => (state = (state * 1664525 + 1013904223) >>> 0);\n};\n\ndescribe('determinism boundary', () => {\n  it('the deterministic stage reproduces exactly from a fixed seed', () => {\n    const a = seeded(42); const b = seeded(42);\n    expect([a(), a(), a()]).toEqual([b(), b(), b()]);\n  });\n\n  it('the stochastic stage is asserted on properties, never exact output', async () => {\n    const answer = await generate('summarise this');\n    expect(answer.length).toBeGreaterThan(0);\n    expect(answer).not.toMatch(/undefined/);\n  });\n});\n\nasync function generate(_prompt) {\n  return 'a summary';\n}\n`,
      }];
    case 'hallucination-detection':
      return [{
        path: `evals/hallucination.groundedness.eval.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\n\n// A fluent, specific, entirely invented answer is indistinguishable from a\n// correct one to every assertion except one that checks it against the source.\n//\n// The grader is itself a model and can be wrong in the same direction as the\n// thing it grades — keep a human-labelled seed set to know whether to trust it.\nconst CASES = [\n  {\n    sources: ['The office is open Monday to Friday, 9am to 5pm.'],\n    question: 'When is the office open?',\n  },\n];\n\ndescribe('groundedness', () => {\n  for (const { sources, question } of CASES) {\n    it(\`answers "\${question}" only from the sources\`, async () => {\n      const answer = await answerFrom(sources, question);\n      expect((await gradeGroundedness(answer, sources)).unsupportedClaims).toEqual([]);\n    });\n  }\n\n  it('says it does not know rather than inventing', async () => {\n    const answer = await answerFrom(['The office is open weekdays.'], 'What is the phone number?');\n    expect(answer).toMatch(/not|unknown|does not say/i);\n  });\n});\n\nasync function answerFrom(_sources, _question) { return 'The office is open weekdays, 9am to 5pm.'; }\nasync function gradeGroundedness(_answer, _sources) { return { unsupportedClaims: [] }; }\n`,
      }];
    default:
      return nodeRecipeCompliance(id, stack);
  }
}

/**
 * Node recipes for the compliance policies whose controls a machine can check.
 *
 * These sit alongside the control-mapping document from `complianceRecipe`,
 * never instead of it: the document carries what only a person can attest to,
 * and these carry the assertions. A regime with no machine-checkable control
 * appears only in `COMPLIANCE_PROFILES` and returns nothing here — which is the
 * honest answer, rather than an assertion-free file that can never fail.
 */
function nodeRecipeCompliance(id: TestingMethodologyId, stack: DetectedStack): ScaffoldFile[] {
  const ext = stack.testExt;
  switch (id) {
    case 'rbac-compliance':
      return [{
        path: `tests/rbac.authorization.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\n\n// Positive permission tests ("an admin can delete") are always written.\n// Negative ones ("a viewer cannot, by any route") rarely are — and privilege\n// escalation lives entirely in the untested half. This generates both.\nconst ACTIONS = ['read', 'write', 'delete', 'manageUsers'];\n\nconst ALLOWED = {\n  viewer: ['read'],\n  editor: ['read', 'write'],\n  admin: ['read', 'write', 'delete', 'manageUsers'],\n};\n\n// Replace with the real authorization check.\nconst can = (role, action) => ALLOWED[role].includes(action);\n\ndescribe('role matrix — both halves', () => {\n  for (const [role, permitted] of Object.entries(ALLOWED)) {\n    for (const action of ACTIONS) {\n      const shouldAllow = permitted.includes(action);\n      it(\`\${role} \${shouldAllow ? 'can' : 'CANNOT'} \${action}\`, () => {\n        expect(can(role, action)).toBe(shouldAllow);\n      });\n    }\n  }\n});\n\ndescribe('tenant isolation', () => {\n  it('never returns records belonging to another tenant', () => {\n    // Testing the policy layer proves nothing if a route bypasses it — assert\n    // at the data-access boundary, not only in the permission check.\n    expect(true).toBe(true);\n  });\n});\n`,
      }];
    case 'audit-trail':
      return [{
        path: `tests/audit-trail.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\n\n// Asserting the log works is easy. Asserting that *every* privileged path\n// writes to it requires enumerating those paths and keeping the list current —\n// which is the actual work, and what fails silently when it lapses.\nconst CONSEQUENTIAL_ACTIONS = ['user.delete', 'role.grant', 'export.create', 'settings.update'];\n\nconst recorded = [];\nconst perform = (action, actor) => {\n  recorded.push({ action, actor, at: new Date().toISOString() });\n};\n\ndescribe('audit trail completeness', () => {\n  for (const action of CONSEQUENTIAL_ACTIONS) {\n    it(\`records \${action} with an attributable actor\`, () => {\n      recorded.length = 0;\n      perform(action, 'user_42');\n      expect(recorded).toHaveLength(1);\n      expect(recorded[0].actor).toBe('user_42');\n      expect(recorded[0].at).toBeTruthy();\n    });\n  }\n\n  it('does not record request payloads', () => {\n    // An audit log holding payloads becomes a privacy liability of its own.\n    recorded.length = 0;\n    perform('user.delete', 'user_42');\n    expect(JSON.stringify(recorded)).not.toMatch(/credential|secret/i);\n  });\n});\n`,
      }];
    case 'data-retention':
      return [{
        path: `tests/data-retention.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\n\n// Retention has two failure directions and most teams test neither: data\n// surviving past its window, and data destroyed before a hold is released.\n//\n// A clock seam is required — without one the test cannot reach the window.\nconst DAY = 86_400_000;\nconst RETENTION_DAYS = 30;\n\nconst shouldDelete = (record, now) =>\n  !record.legalHold && now - record.createdAt > RETENTION_DAYS * DAY;\n\ndescribe('retention', () => {\n  const now = Date.UTC(2026, 0, 31);\n\n  it('deletes a record past its window', () => {\n    expect(shouldDelete({ createdAt: now - 40 * DAY }, now)).toBe(true);\n  });\n\n  it('keeps a record inside its window', () => {\n    expect(shouldDelete({ createdAt: now - 10 * DAY }, now)).toBe(false);\n  });\n\n  it('keeps a record under legal hold however old', () => {\n    expect(shouldDelete({ createdAt: now - 900 * DAY, legalHold: true }, now)).toBe(false);\n  });\n\n  it('cascades to caches and indexes, not just the primary store', () => {\n    // A retention test stopping at the primary store misses the copies that\n    // actually persist.\n    expect(true).toBe(true);\n  });\n});\n`,
      }];
    case 'gdpr':
      return [{
        path: `tests/gdpr.subject-rights.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\n\n// Erasure is the hard one: caches, search indexes, analytics, backups and logs\n// each hold copies the primary-store test never sees. A passing deletion test\n// that only checks the main database gives false assurance, which is worse\n// than none.\nconst STORES = ['primary', 'cache', 'searchIndex', 'analytics', 'auditLog'];\n\nconst holdings = new Map(STORES.map(s => [s, new Set(['user_42'])]));\nconst eraseEverywhere = (id) => { for (const store of STORES) { holdings.get(store).delete(id); } };\n\ndescribe('right to erasure', () => {\n  it('removes the subject from every store, not only the primary', () => {\n    eraseEverywhere('user_42');\n    for (const store of STORES) {\n      expect(holdings.get(store).has('user_42'), \`still present in \${store}\`).toBe(false);\n    }\n  });\n});\n\ndescribe('right of access', () => {\n  it('exports every category recorded in the RoPA', () => {\n    const declared = ['orders', 'profile', 'supportMessages'];\n    const exported = Object.keys({ profile: {}, orders: [], supportMessages: [] });\n    expect(exported.sort()).toEqual(declared);\n  });\n});\n`,
      }];
    case 'pci-dss':
      return [{
        path: `tests/pci.pan-handling.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\n\n// The single most useful application-layer assertion here: an account number\n// never reaches a log, an error report, or an analytics event.\n//\n// Use a synthetic value from your gateway's published test range — never a\n// real one, and never one committed to this repository.\nconst ACCOUNT_NUMBER_SHAPE = /\\\\b(?:\\\\d[ -]*?){13,19}\\\\b/;\nconst SYNTHETIC = process.env.TEST_ACCOUNT_NUMBER ?? '';\n\nconst captured = [];\nconst log = (message) => captured.push(message);\n\ndescribe('account number handling', () => {\n  it('masks the value when displayed', () => {\n    expect(mask('0000000000009999')).toBe('************9999');\n  });\n\n  it('never writes an unmasked value to a log', () => {\n    captured.length = 0;\n    log(\`charge failed for \${mask(SYNTHETIC || '0000000000009999')}\`);\n    expect(captured.some(line => ACCOUNT_NUMBER_SHAPE.test(line))).toBe(false);\n  });\n\n  it('keeps it out of error messages', () => {\n    const err = new Error(\`declined: \${mask('0000000000009999')}\`);\n    expect(ACCOUNT_NUMBER_SHAPE.test(err.message)).toBe(false);\n  });\n});\n\nfunction mask(value) {\n  return value.slice(-4).padStart(value.length, '*');\n}\n`,
      }];
    case 'hipaa':
      return [{
        path: `tests/hipaa.safeguards.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\n\n// The technical safeguards are the most testable part of the Security Rule.\n// The administrative and physical ones are not — record those in the control\n// mapping instead of writing an assertion that cannot fail.\ndescribe('technical safeguards', () => {\n  it('identifies every user uniquely — no shared accounts', () => {\n    const sessions = [{ user: 'u1' }, { user: 'u2' }];\n    expect(sessions.every(s => s.user && s.user !== 'shared')).toBe(true);\n  });\n\n  it('records access to protected records with actor and timestamp', () => {\n    const entry = { actor: 'u1', record: 'record_7', at: new Date().toISOString() };\n    expect(Boolean(entry.actor && entry.record && entry.at)).toBe(true);\n  });\n\n  it('logs the session off automatically after inactivity', () => {\n    const IDLE_LIMIT_MS = 15 * 60_000;\n    const isExpired = (lastSeen, now) => now - lastSeen > IDLE_LIMIT_MS;\n    expect(isExpired(0, IDLE_LIMIT_MS + 1)).toBe(true);\n  });\n\n  it('refuses to transmit protected records without encryption', () => {\n    const permitted = (url) => url.startsWith('https://');\n    expect(permitted('http://example.com/records')).toBe(false);\n  });\n});\n`,
      }];
    case 'change-management':
      return [{
        path: `tests/change-management.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\nimport { execFileSync } from 'node:child_process';\n\n// Almost entirely checkable from repository metadata, which makes this the\n// cheapest compliance policy to automate.\nconst git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();\n\ndescribe('change management', () => {\n  it('has a readable history to assert against', () => {\n    expect(git('log', '-1', '--format=%H').length).toBeGreaterThan(0);\n  });\n\n  it('links changes to an issue or ticket', () => {\n    const subjects = git('log', '-10', '--format=%s').split('\\\\n').filter(Boolean);\n    const unlinked = subjects.filter(s => !/#\\\\d+|[A-Z]+-\\\\d+/.test(s));\n    // Tighten to \`toEqual([])\` once the convention is established. Leaving it\n    // loose is deliberate: a check that fails on day one gets deleted.\n    expect(unlinked.length).toBeLessThanOrEqual(subjects.length);\n  });\n});\n`,
      }];
    case 'sbom':
      return [{
        path: `tests/sbom.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\nimport { existsSync, readFileSync } from 'node:fs';\n\n// The useful test is not that an SBOM exists but that it *matches the\n// artifact*. A stale SBOM is worse than none, because it is trusted.\n// Generate with: npx @cyclonedx/cyclonedx-npm --output-file sbom.cdx.json\nconst SBOM_PATH = 'sbom.cdx.json';\n\ndescribe('SBOM', () => {\n  it('exists', () => {\n    expect(existsSync(SBOM_PATH)).toBe(true);\n  });\n\n  it('is valid and identifies its format', () => {\n    const bom = JSON.parse(readFileSync(SBOM_PATH, 'utf8'));\n    expect(bom.bomFormat).toBe('CycloneDX');\n    expect(Array.isArray(bom.components)).toBe(true);\n  });\n\n  it('covers every direct dependency', () => {\n    const bom = JSON.parse(readFileSync(SBOM_PATH, 'utf8'));\n    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));\n    const listed = new Set(bom.components.map((c) => c.name));\n    const missing = Object.keys(pkg.dependencies ?? {}).filter((d) => !listed.has(d));\n    expect(missing).toEqual([]);\n  });\n});\n`,
      }];
    case 'dependency-licensing':
      return [{
        path: `tests/dependency-licensing.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\nimport { execFileSync } from 'node:child_process';\n\n// A copyleft dependency arriving transitively on a minor version bump is the\n// standard way this becomes a problem, and it is entirely preventable here.\n//\n// An unknown licence needs triage, not a blanket block — an allowlist that\n// fails the build on anything unrecognised gets widened under deadline pressure.\nconst ALLOWED = ['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'CC0-1.0', 'Unlicense'];\n\ndescribe('dependency licensing', () => {\n  it('uses only permitted licences', () => {\n    // npm install -D license-checker-rseidelsohn\n    const raw = execFileSync('npx', ['license-checker-rseidelsohn', '--json', '--production'], { encoding: 'utf8' });\n    const offenders = Object.entries(JSON.parse(raw))\n      .filter(([, meta]) => {\n        const licenses = [meta.licenses].flat().join(' OR ');\n        return !ALLOWED.some(allowed => licenses.includes(allowed));\n      })\n      .map(([name, meta]) => \`\${name}: \${meta.licenses}\`);\n    expect(offenders).toEqual([]);\n  });\n});\n`,
      }];
    case 'bias-fairness':
      return [{
        path: `tests/bias-fairness.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\n\n// Disparity is invisible in aggregate accuracy, which is the metric everyone\n// reports. Break results down by group.\n//\n// Fairness definitions are mathematically incompatible — satisfying\n// demographic parity and equalised odds at once is generally impossible. The\n// rule chosen below is a stated value judgement, not a technical default.\nconst SELECTION_RATE_FLOOR = 0.8; // the four-fifths rule\n\nconst outcomes = [\n  { group: 'A', selected: 80, total: 100 },\n  { group: 'B', selected: 70, total: 100 },\n];\n\ndescribe('fairness across groups', () => {\n  it('meets the four-fifths rule on selection rate', () => {\n    const rates = outcomes.map(o => o.selected / o.total);\n    expect(Math.min(...rates) / Math.max(...rates)).toBeGreaterThanOrEqual(SELECTION_RATE_FLOOR);\n  });\n\n  it('gives the same answer when only the protected attribute changes', () => {\n    // Counterfactual: identical applicant, different group.\n    const decide = (applicant) => applicant.income > 30_000;\n    expect(decide({ income: 40_000, group: 'A' })).toBe(decide({ income: 40_000, group: 'B' }));\n  });\n});\n`,
      }];
    case 'model-output-risk':
      return [{
        path: `tests/model-output-risk.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\n\n// A classifier that is never tested tends toward one class, which silently\n// removes the review step it exists to trigger.\n//\n// Measure recall on the rare high-risk class. Overall accuracy is misleading\n// precisely where it matters: a classifier calling everything 'low' scores 95%\n// on a corpus that is 95% low-risk, and catches nothing.\nconst LABELLED = [\n  { input: 'routine question', expected: 'low' },\n  { input: 'needs a human', expected: 'high' },\n];\n\ndescribe('output risk classification', () => {\n  it('recalls the high-risk class', () => {\n    const high = LABELLED.filter(c => c.expected === 'high');\n    const caught = high.filter(c => classify(c.input) === 'high');\n    expect(caught.length / high.length).toBeGreaterThanOrEqual(0.9);\n  });\n\n  it('routes a high-risk output to human review', () => {\n    expect(handlingFor('high')).toBe('human-review');\n  });\n\n  it('does not collapse to a single class', () => {\n    expect(new Set(LABELLED.map(c => classify(c.input))).size).toBeGreaterThan(1);\n  });\n});\n\nfunction classify(input) { return /human/.test(input) ? 'high' : 'low'; }\nfunction handlingFor(risk) { return risk === 'high' ? 'human-review' : 'auto'; }\n`,
      }];
    case 'ai-data-policy':
      return [{
        path: `tests/ai-data-policy.test.${ext}`,
        content: `import { describe, it, expect } from 'vitest';\n\n// The boundary is only as good as its worst path — one un-redacted logging\n// call or one retrieval query missing a tenant filter defeats the policy\n// everywhere else it is applied. Coverage matters more than depth here.\nconst SENSITIVE_KEYS = /(api[_-]?key|password|authorization|private[_-]?key)/i;\n\nconst redact = (payload) => JSON.parse(JSON.stringify(payload, (key, value) =>\n  SENSITIVE_KEYS.test(key) ? '[redacted]' : value));\n\ndescribe('what reaches the model', () => {\n  it('carries no credential-shaped field', () => {\n    const outgoing = redact({ prompt: 'hello', config: { apiKey: 'value-from-storage' } });\n    expect(JSON.stringify(outgoing)).not.toContain('value-from-storage');\n  });\n\n  it('filters retrieval by tenant on every query path', () => {\n    const retrieve = (query, tenantId) => DOCS.filter(d => d.tenantId === tenantId && d.text.includes(query));\n    expect(retrieve('report', 't1').every(d => d.tenantId === 't1')).toBe(true);\n  });\n\n  it('honours the retention window on stored memory', () => {\n    const WINDOW_DAYS = 90;\n    const expired = (ageDays) => ageDays > WINDOW_DAYS;\n    expect(expired(120)).toBe(true);\n  });\n});\n\nconst DOCS = [\n  { tenantId: 't1', text: 'quarterly report' },\n  { tenantId: 't2', text: 'quarterly report' },\n];\n`,
      }];
    default:
      return [];
  }
}

function pythonRecipe(id: TestingMethodologyId, stack: DetectedStack): ScaffoldFile[] {
  switch (id) {
    case 'unit':
    case 'tdd':
    case 'test-design':
    case 'white-box':
      return [{
        path: 'tests/test_example.py',
        content: `def test_adds_numbers():\n    assert 1 + 1 == 2\n`,
      }];
    case 'property':
      return [{
        path: 'tests/test_property.py',
        content: `from hypothesis import given, strategies as st\n\n\n@given(st.text())\ndef test_reverse_is_its_own_inverse(s):\n    assert s[::-1][::-1] == s\n`,
      }];
    case 'integration':
      return [{
        path: 'tests/test_integration.py',
        content: `def test_components_collaborate():\n    # Arrange real collaborators (db, http, queue) here instead of mocks.\n    assert True\n`,
      }];
    case 'snapshot':
      return [{
        path: 'tests/test_snapshot.py',
        content: `def test_serialized_output(snapshot):\n    # Requires the 'syrupy' plugin: pip install syrupy\n    assert {"hello": "world"} == snapshot\n`,
      }];
    case 'e2e':
      if (stack.archetype === 'api') {
        return [{
          path: 'tests/e2e/test_api.py',
          content: `import requests\n\n\ndef test_health_endpoint():\n    res = requests.get("http://localhost:8000/health")\n    assert res.status_code == 200\n`,
        }];
      }
      return [{
        path: 'tests/e2e/test_example.py',
        content: `from playwright.sync_api import sync_playwright\n\n\ndef test_home_page_loads():\n    with sync_playwright() as p:\n        browser = p.chromium.launch()\n        page = browser.new_page()\n        page.goto("http://localhost:8000/")\n        assert page.title() != ""\n        browser.close()\n`,
        }];
    case 'performance':
      return [{
        path: 'performance/locustfile.py',
        content: `from locust import HttpUser, task, between\n\n\nclass LoadUser(HttpUser):\n    wait_time = between(1, 2)\n\n    @task\n    def index(self):\n        self.client.get("/")\n`,
      }];
    default:
      return [];
  }
}

function rustRecipe(id: TestingMethodologyId): ScaffoldFile[] {
  switch (id) {
    case 'unit':
    case 'tdd':
    case 'test-design':
    case 'white-box':
      return [{
        path: 'tests/example_test.rs',
        content: `#[test]\nfn adds_numbers() {\n    assert_eq!(1 + 1, 2);\n}\n`,
      }];
    case 'property':
      return [{
        path: 'tests/proptest_example.rs',
        content: `use proptest::prelude::*;\n\nproptest! {\n    #[test]\n    fn reverse_is_its_own_inverse(s in ".*") {\n        let once: String = s.chars().rev().collect();\n        let twice: String = once.chars().rev().collect();\n        prop_assert_eq!(twice, s);\n    }\n}\n`,
      }];
    case 'performance':
      return [{
        path: 'benches/benchmark.rs',
        content: `use criterion::{criterion_group, criterion_main, Criterion};\n\nfn bench(c: &mut Criterion) {\n    c.bench_function("add", |b| b.iter(|| 1 + 1));\n}\n\ncriterion_group!(benches, bench);\ncriterion_main!(benches);\n`,
      }];
    default:
      return [];
  }
}

function goRecipe(id: TestingMethodologyId): ScaffoldFile[] {
  switch (id) {
    case 'unit':
    case 'tdd':
    case 'test-design':
    case 'white-box':
      return [{
        path: 'example_test.go',
        content: `package main\n\nimport "testing"\n\nfunc TestAddsNumbers(t *testing.T) {\n\tif 1+1 != 2 {\n\t\tt.Fatal("math is broken")\n\t}\n}\n`,
      }];
    case 'property':
      return [{
        path: 'example_property_test.go',
        content: `package main\n\nimport (\n\t"testing"\n\t"testing/quick"\n)\n\nfunc TestReverseInverse(t *testing.T) {\n\tf := func(s string) bool {\n\t\tr := []rune(s)\n\t\tfor i, j := 0, len(r)-1; i < j; i, j = i+1, j-1 {\n\t\t\tr[i], r[j] = r[j], r[i]\n\t\t}\n\t\treturn true // replace with a real round-trip invariant\n\t}\n\tif err := quick.Check(f, nil); err != nil {\n\t\tt.Error(err)\n\t}\n}\n`,
      }];
    case 'performance':
      return [{
        path: 'bench_test.go',
        content: `package main\n\nimport "testing"\n\nfunc BenchmarkAdd(b *testing.B) {\n\tfor i := 0; i < b.N; i++ {\n\t\t_ = 1 + 1\n\t}\n}\n`,
      }];
    default:
      return [];
  }
}

function dotnetRecipe(id: TestingMethodologyId): ScaffoldFile[] {
  switch (id) {
    case 'unit':
    case 'tdd':
    case 'test-design':
    case 'white-box':
      return [{
        path: 'Tests/ExampleTests.cs',
        content: `using Xunit;\n\npublic class ExampleTests\n{\n    [Fact]\n    public void AddsNumbers()\n    {\n        Assert.Equal(2, 1 + 1);\n    }\n}\n`,
      }];
    default:
      return [];
  }
}

function javaRecipe(id: TestingMethodologyId): ScaffoldFile[] {
  switch (id) {
    case 'unit':
    case 'tdd':
    case 'test-design':
    case 'white-box':
      return [{
        path: 'src/test/java/ExampleTest.java',
        content: `import org.junit.jupiter.api.Test;\nimport static org.junit.jupiter.api.Assertions.assertEquals;\n\nclass ExampleTest {\n    @Test\n    void addsNumbers() {\n        assertEquals(2, 1 + 1);\n    }\n}\n`,
      }];
    default:
      return [];
  }
}

// ── Compliance control mappings ───────────────────────────────────

/**
 * The compliance regimes that scaffold a **control-mapping document** rather
 * than a test file.
 *
 * Why two shapes at all: some controls a machine can check (does a viewer role
 * reach the admin route? does a card number appear in a log?) and those get an
 * ordinary test stub from the language recipes below. Most of a compliance
 * regime is not like that — "cryptographic controls are governed by a policy"
 * has no assertion, and writing an assertion-free test file for it produces a
 * placeholder that can never honestly pass. That is precisely the permanent
 * unclosable gap the archetype packs' `discouraged` list exists to prevent, so
 * the artifact here is the mapping itself: control, status, evidence, owner.
 *
 * Every row seeds as **Not assessed**, never as a pass. An unassessed control
 * and a satisfied one are different facts, and a scaffolder that seeded "OK"
 * would be asserting something nobody checked into a file an auditor reads.
 *
 * The control lists are deliberately a *starting* subset of each regime, named
 * by their real references so they can be checked against the source standard.
 * None of these documents is generated by a model, and none is ever rewritten
 * once it exists — they fill with human decisions, which is the whole point.
 */
interface ComplianceProfile {
  regime: string;
  /** What must be decided before the mapping means anything. */
  scoping: string;
  controls: Array<{ ref: string; requirement: string }>;
}

const COMPLIANCE_PROFILES: Partial<Record<TestingMethodologyId, ComplianceProfile>> = {
  'iso-27001': {
    regime: 'ISO/IEC 27001:2022 Annex A',
    scoping: 'Which Annex A controls are applicable, and which are excluded with a stated justification (your Statement of Applicability).',
    controls: [
      { ref: 'A.5.15', requirement: 'Access control policy defined and applied' },
      { ref: 'A.5.23', requirement: 'Information security for use of cloud services' },
      { ref: 'A.8.2', requirement: 'Privileged access rights restricted and reviewed' },
      { ref: 'A.8.8', requirement: 'Technical vulnerabilities identified and remediated' },
      { ref: 'A.8.15', requirement: 'Logging of user activities, exceptions and security events' },
      { ref: 'A.8.24', requirement: 'Use of cryptography governed by policy' },
      { ref: 'A.8.25', requirement: 'Secure development lifecycle defined' },
      { ref: 'A.8.28', requirement: 'Secure coding principles applied' },
      { ref: 'A.8.29', requirement: 'Security testing performed in development and acceptance' },
      { ref: 'A.8.31', requirement: 'Development, test and production environments separated' },
    ],
  },
  soc2: {
    regime: 'SOC 2 Trust Services Criteria',
    scoping: 'Which criteria are in scope (Security is mandatory; Availability, Confidentiality, Processing Integrity and Privacy are opt-in), and whether the report is Type I or Type II.',
    controls: [
      { ref: 'CC6.1', requirement: 'Logical access controls restrict access to protected assets' },
      { ref: 'CC6.2', requirement: 'User registration and de-registration are authorised' },
      { ref: 'CC6.3', requirement: 'Access is modified and removed on role change or exit' },
      { ref: 'CC6.6', requirement: 'External access points are protected' },
      { ref: 'CC6.7', requirement: 'Data in transit and at rest is protected' },
      { ref: 'CC7.2', requirement: 'Anomalies are monitored and detected' },
      { ref: 'CC7.3', requirement: 'Security incidents are evaluated and responded to' },
      { ref: 'CC8.1', requirement: 'Changes are authorised, tested and approved before deployment' },
      { ref: 'A1.2', requirement: 'Backup and recovery meet availability commitments (if in scope)' },
    ],
  },
  'nist-800-53': {
    regime: 'NIST SP 800-53 Rev. 5 / SP 800-171',
    scoping: 'The impact-level baseline (Low / Moderate / High) or the 800-171 CUI scope. Map the tailored baseline, not the full catalogue.',
    controls: [
      { ref: 'AC-2', requirement: 'Account management' },
      { ref: 'AC-6', requirement: 'Least privilege' },
      { ref: 'AU-2', requirement: 'Event logging' },
      { ref: 'AU-9', requirement: 'Protection of audit information' },
      { ref: 'CM-3', requirement: 'Configuration change control' },
      { ref: 'IA-2', requirement: 'Identification and authentication (organisational users)' },
      { ref: 'RA-5', requirement: 'Vulnerability monitoring and scanning' },
      { ref: 'SA-11', requirement: 'Developer testing and evaluation' },
      { ref: 'SC-8', requirement: 'Transmission confidentiality and integrity' },
      { ref: 'SC-28', requirement: 'Protection of information at rest' },
      { ref: 'SI-2', requirement: 'Flaw remediation' },
    ],
  },
  'license-compatibility': {
    regime: 'Open-source licence compatibility',
    scoping: 'How this software is distributed — linked binary, bundled application, SaaS only, or source. The same dependency set gives different answers for each, and the model cannot be inferred.',
    controls: [
      { ref: 'DIST-1', requirement: 'Distribution model stated and current' },
      { ref: 'DIST-2', requirement: 'Outbound licence of this project declared' },
      { ref: 'COMPAT-1', requirement: 'No strong copyleft dependency reaches a proprietary distribution' },
      { ref: 'COMPAT-2', requirement: 'Weak copyleft (LGPL/MPL) obligations satisfied for the linking model used' },
      { ref: 'COMPAT-3', requirement: 'Licence expressions with AND/OR resolved to a chosen term' },
      { ref: 'NOTICE-1', requirement: 'Attribution and NOTICE requirements satisfied in the shipped artifact' },
      { ref: 'NOTICE-2', requirement: 'Source-offer obligations met where triggered' },
    ],
  },
  'ai-safety-compliance': {
    regime: 'AI safety commitments (EU AI Act / NIST AI RMF alignment)',
    scoping: 'Whether this system is in scope as high-risk or general-purpose under the EU AI Act, and which public safety claims the product makes.',
    controls: [
      { ref: 'GOV-1', requirement: 'AI system role classified (provider / deployer) and risk tier stated' },
      { ref: 'GOV-2', requirement: 'Model or system card published and current' },
      { ref: 'GOV-3', requirement: 'Human oversight mechanism defined for consequential outputs' },
      { ref: 'GOV-4', requirement: 'Declared guardrails have a corresponding enforcement test' },
      { ref: 'GOV-5', requirement: 'Red-team evidence retained with dates and scope' },
      { ref: 'GOV-6', requirement: 'Incident reporting route defined for AI-specific failures' },
      { ref: 'GOV-7', requirement: 'Training-data provenance and permitted use recorded' },
    ],
  },
  'financial-compliance': {
    regime: 'Financial services (FFIEC / MiFID II / DORA)',
    scoping: 'Jurisdiction, licence type, and which regimes actually bind this system. A generic financial mapping tests nothing precisely.',
    controls: [
      { ref: 'REC-1', requirement: 'Transaction records complete, immutable and retained for the required period' },
      { ref: 'REC-2', requirement: 'Communications retained where the regime requires it' },
      { ref: 'RPT-1', requirement: 'Regulatory reporting reconciles against source records' },
      { ref: 'CLK-1', requirement: 'Clock synchronisation meets the prescribed tolerance (MiFID II RTS 25)' },
      { ref: 'RES-1', requirement: 'Operational resilience testing performed (DORA where applicable)' },
      { ref: 'RES-2', requirement: 'Critical third-party dependencies registered' },
      { ref: 'CHG-1', requirement: 'Change control evidences segregation of duties' },
    ],
  },
  'medical-compliance': {
    regime: 'Medical software (FDA 21 CFR Part 11 / IEC 62304)',
    scoping: 'Whether records are submitted to a regulator, the device software safety class (A/B/C), and the validation lifecycle in use.',
    controls: [
      { ref: '11.10(a)', requirement: 'System validated for accuracy, reliability and consistent intended performance' },
      { ref: '11.10(b)', requirement: 'Records can be generated in accurate and complete copies' },
      { ref: '11.10(c)', requirement: 'Records protected for the retention period' },
      { ref: '11.10(d)', requirement: 'System access limited to authorised individuals' },
      { ref: '11.10(e)', requirement: 'Secure, computer-generated, time-stamped audit trail' },
      { ref: '11.50', requirement: 'Signature manifestations contain name, date/time and meaning' },
      { ref: '11.70', requirement: 'Signatures linked to their records so they cannot be transferred' },
      { ref: '62304-5.5', requirement: 'Software unit verification per safety class' },
      { ref: '62304-5.7', requirement: 'Software system testing with documented results' },
    ],
  },
  'automotive-compliance': {
    regime: 'Automotive functional safety (ISO 26262)',
    scoping: 'The ASIL assigned by hazard analysis and risk assessment (HARA). The level determines which verification methods are required — it is not a choice.',
    controls: [
      { ref: 'Part 6-9', requirement: 'Requirements-based testing at software unit level' },
      { ref: 'Part 6-9', requirement: 'Statement coverage evidence (ASIL A+)' },
      { ref: 'Part 6-9', requirement: 'Branch coverage evidence (ASIL B+)' },
      { ref: 'Part 6-9', requirement: 'MC/DC coverage evidence (ASIL D)' },
      { ref: 'Part 6-10', requirement: 'Software integration and interface testing' },
      { ref: 'Part 6-5', requirement: 'Coding guidelines enforced (e.g. MISRA C) with deviations recorded' },
      { ref: 'Part 8-11', requirement: 'Tool confidence level assessed and tools qualified where required' },
      { ref: 'Part 8-6', requirement: 'Bidirectional requirements traceability maintained' },
    ],
  },
  'aviation-compliance': {
    regime: 'Airborne software (DO-178C)',
    scoping: 'The Design Assurance Level (A–E) from the system safety assessment, and which supplements apply (DO-330 tools, DO-331 model-based, DO-333 formal methods).',
    controls: [
      { ref: 'A-4', requirement: 'Low-level requirements comply with high-level requirements' },
      { ref: 'A-5', requirement: 'Source code complies with and is traceable to low-level requirements' },
      { ref: 'A-6', requirement: 'Executable object code complies with requirements (requirements-based testing)' },
      { ref: 'A-7.5', requirement: 'Statement coverage achieved (DAL C+)' },
      { ref: 'A-7.6', requirement: 'Decision coverage achieved (DAL B+)' },
      { ref: 'A-7.7', requirement: 'MC/DC achieved (DAL A)' },
      { ref: 'A-7.8', requirement: 'Data and control coupling analysed' },
      { ref: 'DO-330', requirement: 'Verification tools qualified where used to eliminate an objective' },
      { ref: 'Independence', requirement: 'Verification independence satisfied for the assigned DAL' },
    ],
  },
  'energy-compliance': {
    regime: 'Bulk electric system (NERC CIP)',
    scoping: 'The impact rating of the BES cyber systems in scope (Low / Medium / High). Requirements and deadlines differ by rating.',
    controls: [
      { ref: 'CIP-002', requirement: 'BES cyber asset inventory identified and categorised' },
      { ref: 'CIP-005', requirement: 'Electronic security perimeter defined and access points controlled' },
      { ref: 'CIP-007 R2', requirement: 'Security patches evaluated within 35 days of availability' },
      { ref: 'CIP-007 R4', requirement: 'Security event monitoring in place' },
      { ref: 'CIP-004 R5', requirement: 'Access revoked within the required window on termination' },
      { ref: 'CIP-010 R1', requirement: 'Baseline configurations documented and changes authorised' },
      { ref: 'CIP-010 R2', requirement: 'Configuration monitoring detects unauthorised change' },
      { ref: 'CIP-013', requirement: 'Supply chain risk management plan applied to vendors' },
    ],
  },

  // Regimes with a testable half as well. The document carries what only a
  // person can attest to; the language recipes below carry the assertions.
  gdpr: {
    regime: 'GDPR / UK GDPR',
    scoping: 'The lawful basis for each processing purpose, the role held (controller or processor), and whether any processing needs a DPIA.',
    controls: [
      { ref: 'Art. 5(1)(c)', requirement: 'Data minimisation — each field collected has a stated purpose' },
      { ref: 'Art. 6', requirement: 'Lawful basis recorded per processing purpose' },
      { ref: 'Art. 15', requirement: 'Subject access export is complete across every store' },
      { ref: 'Art. 17', requirement: 'Erasure reaches caches, indexes, analytics, logs and backups' },
      { ref: 'Art. 25', requirement: 'Data protection by design and by default' },
      { ref: 'Art. 30', requirement: 'Record of processing activities maintained' },
      { ref: 'Art. 32', requirement: 'Encryption and pseudonymisation appropriate to the risk' },
      { ref: 'Art. 33', requirement: 'Breach notification route defined and rehearsed' },
      { ref: 'Art. 44', requirement: 'International transfer mechanism in place where data leaves the region' },
    ],
  },
  hipaa: {
    regime: 'HIPAA Security Rule — technical safeguards',
    scoping: 'Whether this system is a covered entity or business associate, where ePHI lives, and which addressable specifications are implemented versus documented as not reasonable.',
    controls: [
      { ref: '164.312(a)(1)', requirement: 'Access control — unique user identification' },
      { ref: '164.312(a)(2)(iii)', requirement: 'Automatic logoff (addressable)' },
      { ref: '164.312(a)(2)(iv)', requirement: 'Encryption and decryption of ePHI at rest (addressable)' },
      { ref: '164.312(b)', requirement: 'Audit controls record activity on systems holding ePHI' },
      { ref: '164.312(c)(1)', requirement: 'Integrity — ePHI is not improperly altered or destroyed' },
      { ref: '164.312(d)', requirement: 'Person or entity authentication' },
      { ref: '164.312(e)(1)', requirement: 'Transmission security over open networks' },
      { ref: '164.308(b)', requirement: 'Business associate agreements in place for downstream processors' },
    ],
  },
  'pci-dss': {
    regime: 'PCI DSS v4.0 — application requirements',
    scoping: 'The cardholder data environment boundary and the SAQ type or assessment level. Scope reduction is the strategy: the best answer to most of these is that no system here touches a PAN.',
    controls: [
      { ref: 'Req 3.3', requirement: 'PAN masked when displayed; full PAN never in logs or error output' },
      { ref: 'Req 3.5', requirement: 'PAN rendered unreadable wherever stored' },
      { ref: 'Req 4.2', requirement: 'Strong cryptography for PAN transmitted over open networks' },
      { ref: 'Req 6.2', requirement: 'Bespoke software developed securely; developers trained' },
      { ref: 'Req 6.3', requirement: 'Vulnerabilities identified and ranked; dependencies patched' },
      { ref: 'Req 6.4', requirement: 'Public-facing web applications protected against attacks' },
      { ref: 'Req 8.3', requirement: 'Strong authentication for all access to the CDE' },
      { ref: 'Req 10.2', requirement: 'Audit logs capture all access to cardholder data' },
    ],
  },
  'change-management': {
    regime: 'Change management',
    scoping: 'Which changes require which approvals, and the documented break-glass path for emergencies. Without a stated emergency route, the policy teaches people to bypass it.',
    controls: [
      { ref: 'CHG-1', requirement: 'Protected branches enforce review before merge' },
      { ref: 'CHG-2', requirement: 'Required approvals defined by change type and area (CODEOWNERS)' },
      { ref: 'CHG-3', requirement: 'Every production change traces to an issue or ticket' },
      { ref: 'CHG-4', requirement: 'Deployment to production requires a recorded approval' },
      { ref: 'CHG-5', requirement: 'Emergency change path documented, with retrospective approval required' },
      { ref: 'CHG-6', requirement: 'Rollback procedure defined and exercised' },
      { ref: 'CHG-7', requirement: 'Segregation of duties between author and approver' },
    ],
  },
  'data-retention': {
    regime: 'Data retention and deletion',
    scoping: 'The retention period for each data category, its source (regulation, contract, or policy), and what triggers a legal hold.',
    controls: [
      { ref: 'RET-1', requirement: 'Retention schedule declared per data category with its source' },
      { ref: 'RET-2', requirement: 'Deletion job runs on schedule and is monitored for failure' },
      { ref: 'RET-3', requirement: 'Deletion cascades to caches, search indexes and analytics' },
      { ref: 'RET-4', requirement: 'Backup expiry aligns with the retention schedule' },
      { ref: 'RET-5', requirement: 'Legal hold suspends deletion and is released deliberately' },
      { ref: 'RET-6', requirement: 'Soft-deleted records are purged within the stated window' },
    ],
  },
  'model-output-risk': {
    regime: 'Model-output risk classification',
    scoping: 'The risk classes this product distinguishes, and what handling each one triggers — review, disclaimer, refusal, or logging.',
    controls: [
      { ref: 'RISK-1', requirement: 'Risk classes defined with examples of each' },
      { ref: 'RISK-2', requirement: 'Labelled evaluation set exists and is version-controlled' },
      { ref: 'RISK-3', requirement: 'Recall measured on the rare high-risk class, not overall accuracy alone' },
      { ref: 'RISK-4', requirement: 'Each class maps to a defined handling path' },
      { ref: 'RISK-5', requirement: 'Escalation to human review is tested end to end' },
      { ref: 'RISK-6', requirement: 'Threshold changes require re-evaluation against the labelled set' },
    ],
  },
  'ai-data-policy': {
    regime: 'AI memory and data-use policy',
    scoping: 'What the product promises about customer data — training use, retention, and separation between customers — and which provider settings back each promise.',
    controls: [
      { ref: 'AID-1', requirement: 'Training-use commitment stated and matched by provider configuration' },
      { ref: 'AID-2', requirement: 'Provider zero/limited-retention setting verified where promised' },
      { ref: 'AID-3', requirement: 'Every path reaching a model applies the redaction boundary' },
      { ref: 'AID-4', requirement: 'Retrieval is filtered by tenant on every query path' },
      { ref: 'AID-5', requirement: 'Secrets cannot reach a prompt, asserted at the dispatch boundary' },
      { ref: 'AID-6', requirement: 'Stored memory has a retention window and a deletion route' },
      { ref: 'AID-7', requirement: 'Sub-processor list current and disclosed' },
    ],
  },
};

/**
 * Compliance policies that also scaffold assertions, not only a mapping.
 *
 * Kept as one declared set rather than inferred from whether a language recipe
 * happens to return something: the answer must not change because the project
 * is written in Go. A regime is either partly machine-checkable or it is not,
 * and that is a property of the regime.
 */
const HAS_TESTABLE_HALF: ReadonlySet<TestingMethodologyId> = new Set<TestingMethodologyId>([
  'gdpr', 'hipaa', 'pci-dss', 'change-management', 'data-retention',
  'model-output-risk', 'ai-data-policy',
]);

/** The control-mapping document for a compliance policy, when it has one. */
function complianceRecipe(id: TestingMethodologyId): ScaffoldFile[] {
  const profile = COMPLIANCE_PROFILES[id];
  if (!profile) {
    return [];
  }
  const def = TESTING_METHODOLOGY_DEFINITIONS.find(d => d.id === id);
  const rows = profile.controls
    .map(c => `| \`${c.ref}\` | ${c.requirement} | Not assessed | _none recorded_ | _unassigned_ |`)
    .join('\n');

  const content = [
    `# ${def?.label ?? id} — control mapping`,
    '',
    `**Regime:** ${profile.regime}`,
    '',
    '> Seeded by AtlasMind and **never rewritten** — this file fills with human decisions,',
    '> so re-running the scaffolder leaves it exactly as you left it. It is the evidence',
    '> AtlasMind reads when scoring this policy on the Testing dashboard.',
    '',
    '## Before this mapping means anything',
    '',
    profile.scoping,
    '',
    '## Controls',
    '',
    'Every row starts at **Not assessed**, which is deliberately not the same as *compliant*.',
    'An unassessed control and a satisfied one are different facts, and seeding a pass would',
    'assert something nobody checked. Set a status only when you have looked.',
    '',
    'Status is one of: `Not assessed` · `Satisfied` · `Partial` · `Gap` · `Not applicable`.',
    'A `Not applicable` needs a justification in the Evidence column — that is what an',
    'assessor will ask for.',
    '',
    '| Ref | Requirement | Status | Evidence | Owner |',
    '|---|---|---|---|---|',
    rows,
    '',
    '## Open gaps',
    '',
    '_List each `Gap` or `Partial` above with a remediation owner and a target date._',
    '',
    '## Review log',
    '',
    '| Date | Reviewer | Scope of review |',
    '|---|---|---|',
    '| _not yet reviewed_ | | |',
    '',
  ].join('\n');

  return [{ path: `${COMPLIANCE_EVIDENCE_DIR}/${id}.md`, content }];
}

/** Generates language-appropriate candidate files for an enabled methodology. */
function recipeFiles(id: TestingMethodologyId, stack: DetectedStack): ScaffoldFile[] {
  // Control mappings are language-independent — the regime does not change
  // because the project is written in Go. A policy with both a mapping and a
  // testable half gets both.
  const compliance = complianceRecipe(id);
  const perLanguage = ((): ScaffoldFile[] => {
    switch (stack.language) {
      case 'node':
        return nodeRecipe(id, stack);
      case 'python':
        return pythonRecipe(id, stack);
      case 'rust':
        return rustRecipe(id);
      case 'go':
        return goRecipe(id);
      case 'dotnet':
        return dotnetRecipe(id);
      case 'java':
        return javaRecipe(id);
      default:
        return [];
    }
  })();
  return [...compliance, ...perLanguage];
}

/** Per-language, per-methodology set-up hint shown in the playbook. */
function installHint(id: TestingMethodologyId, stack: DetectedStack): string | undefined {
  const isStructural = id === 'unit' || id === 'tdd' || id === 'test-design' || id === 'white-box';
  // A regime whose evidence is a control mapping has nothing to install, and
  // saying "no set-up needed" would be misleading — there is work, it is just
  // not a package. Point at the mapping instead. Policies with a testable half
  // fall through to the language hints below as well.
  const profile = COMPLIANCE_PROFILES[id];
  if (profile && !HAS_TESTABLE_HALF.has(id)) {
    return `No tooling — the evidence is \`${COMPLIANCE_EVIDENCE_DIR}/${id}.md\`. Decide the scope first: ${profile.scoping}`;
  }
  switch (stack.language) {
    case 'node':
      switch (id) {
        case 'unit':
        case 'tdd':
        case 'test-design':
        case 'white-box':
        case 'snapshot':
        case 'integration':
          return stack.recommendedRunner === 'vitest' ? 'npm install -D vitest' : 'npm install -D jest';
        case 'e2e':
          return stack.hasCypress ? 'npm install -D cypress' : 'npm install -D @playwright/test && npx playwright install';
        case 'property':
          return 'npm install -D fast-check';
        case 'performance':
          return 'Install k6 (https://k6.io/docs/get-started/installation/) — run: k6 run performance/load.k6.js';
        case 'security-testing':
          return 'npx audit-ci  •  consider Snyk / Semgrep / Trivy in CI';
        case 'contract':
          return 'npm install -D @pact-foundation/pact';
        case 'mutation':
          return 'npm install -D @stryker-mutator/core @stryker-mutator/vitest-runner';
        case 'type-drift':
        case 'output-schema-drift':
          return 'npm install zod  •  validate at the boundary, not everywhere';
        case 'cross-representation':
          return 'npm install -D fast-check';
        case 'dead-field':
          return 'npm install -D knip  •  run: npx knip';
        case 'dependency-graph':
          return 'npm install -D dependency-cruiser  •  npx depcruise --init, then: npx depcruise src --validate';
        case 'accessibility':
          return 'npm install -D jest-axe @axe-core/playwright eslint-plugin-jsx-a11y  •  automated checks find roughly a third of issues — keep a keyboard and screen-reader pass alongside';
        case 'observability':
          return 'npm install @opentelemetry/api @opentelemetry/sdk-trace-base  •  the in-memory exporter is what makes spans assertable';
        case 'chaos':
          return 'Start in-process (no dependency needed). For infrastructure chaos: Toxiproxy, or Chaos Mesh on Kubernetes — both need a blast radius and a stop button first';
        case 'schema-migration':
          return 'npm install -D testcontainers  •  a real engine, because an in-memory stand-in will not reproduce the failure';
        case 'compatibility':
          return 'npm install -D @bufbuild/buf (protobuf/gRPC), or keep a versioned fixture corpus for JSON';
        case 'data-quality':
          return 'dbt test, Great Expectations, or Soda Core — pick the one that already sits with your pipeline';
        case 'prompt-regression':
        case 'hallucination-detection':
          return 'npm install -D promptfoo  •  record fixtures so the suite can run without spending tokens on every commit';
        case 'guardrail':
          return 'npm install -D promptfoo  •  npx promptfoo redteam init, and keep the adversarial corpus in version control';
        case 'determinism-boundary':
          return 'npm install -D msw (or nock)  •  record model calls so the deterministic half runs offline';
        case 'sbom':
          return 'npm install -D @cyclonedx/cyclonedx-npm  •  run: npx @cyclonedx/cyclonedx-npm --output-file sbom.cdx.json';
        case 'dependency-licensing':
          return 'npm install -D license-checker-rseidelsohn  •  run: npx license-checker-rseidelsohn --production --summary';
        case 'license-compatibility':
          return 'OSS Review Toolkit (ORT) or FOSSA — and state your distribution model first, since the answer depends on it';
        case 'secure-build-pipeline':
          return 'slsa-framework/slsa-github-generator + sigstore/cosign in CI  •  verify at consumption, or the provenance is paperwork';
        case 'bias-fairness':
          return 'Fairlearn or AI Fairness 360 (Python side) — and state which fairness definition you chose, because they conflict';
        case 'rbac-compliance':
          return 'Cerbos, OpenFGA, or Casbin if the policy is not already a pure function — the enforcement point must be single';
        case 'visual':
          return 'npm install -D @percy/cli  •  or Chromatic for Storybook';
        default:
          return undefined;
      }
    case 'python':
      if (isStructural || id === 'integration') { return 'pip install pytest  •  run: pytest'; }
      if (id === 'property') { return 'pip install hypothesis'; }
      if (id === 'snapshot') { return 'pip install syrupy'; }
      if (id === 'e2e') { return stack.archetype === 'api' ? 'pip install requests pytest' : 'pip install playwright pytest && playwright install'; }
      if (id === 'performance') { return 'pip install locust  •  run: locust -f performance/locustfile.py'; }
      if (id === 'security-testing') { return 'pip install bandit pip-audit  •  run: bandit -r . && pip-audit'; }
      return undefined;
    case 'rust':
      if (isStructural) { return 'Built in — run: cargo test'; }
      if (id === 'property') { return 'Add proptest to [dev-dependencies] — run: cargo test'; }
      if (id === 'performance') { return 'Add criterion to [dev-dependencies] — run: cargo bench'; }
      if (id === 'security-testing') { return 'cargo install cargo-audit — run: cargo audit'; }
      return undefined;
    case 'go':
      if (isStructural || id === 'property') { return 'Built in — run: go test ./...'; }
      if (id === 'performance') { return 'Built in — run: go test -bench=. ./...'; }
      if (id === 'security-testing') { return 'go install golang.org/x/vuln/cmd/govulncheck@latest — run: govulncheck ./...'; }
      return undefined;
    case 'dotnet':
      if (isStructural) { return 'dotnet add package xunit && dotnet add package xunit.runner.visualstudio — run: dotnet test'; }
      return undefined;
    case 'java':
      if (isStructural) { return 'Add JUnit 5 (junit-jupiter) to your build — run: mvn test  /  gradle test'; }
      return undefined;
    default:
      return undefined;
  }
}

/**
 * What this project's *shape* says about its testing, from the archetype packs.
 *
 * Three things a reader needs and the enabled list alone cannot tell them:
 * which methodologies suit this shape, which of those are not switched on,
 * and which enabled ones this shape actively discourages. That last one
 * matters most — a methodology a shape cannot produce evidence for becomes a
 * permanent gap, and a dashboard with a gap nobody can close teaches people to
 * ignore gaps.
 *
 * The recommendations are *read* from the packs rather than restated here. A
 * second copy would drift, which is the problem the shared archetype
 * vocabulary was introduced to solve.
 */
function archetypeGuidanceLines(
  stack: DetectedStack,
  enabledIds: readonly TestingMethodologyId[],
): string[] {
  const model = archetypeTestingModel(stack);
  const enabled = new Set<string>(enabledIds);
  const missing = model.recommended.filter(id => !enabled.has(id));
  const conflicting = model.discouraged.filter(id => enabled.has(id));

  const lines = [
    `## For a ${toProjectArchetype(stack.archetype)} project`,
    '',
    model.rationale,
    '',
    `- **Suits this shape:** ${model.recommended.join(', ') || '_nothing specific_'}`,
  ];

  if (missing.length > 0) {
    lines.push(`- **Recommended and not enabled:** ${missing.join(', ')}`);
  }

  if (conflicting.length > 0) {
    lines.push(
      `- **Enabled but discouraged here:** ${conflicting.join(', ')}. ${
        model.discouragedReason ?? 'This shape cannot produce the evidence they ask for.'} `
      + 'A methodology that cannot be evidenced becomes a permanent gap, and a permanent gap '
      + 'teaches people to ignore gaps.',
    );
  } else if (model.discouraged.length > 0) {
    lines.push(
      `- **Deliberately not recommended:** ${model.discouraged.join(', ')}. ${
        model.discouragedReason ?? ''}`.trim(),
    );
  }

  lines.push('');
  return lines;
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
    ...archetypeGuidanceLines(stack, enabled.map(entry => entry.id)),
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
      lines.push(`- **Set up (${LANGUAGE_LABELS[stack.language]}):** ${install}`);
    }
    // Every file, not just the first. A methodology can leave more than one
    // behind — a compliance regime with a testable half writes its control
    // mapping *and* a test, and the guardrail recipe writes its adversarial
    // corpus alongside the suite that reads it. Naming only `files[0]` reported
    // the mapping and silently omitted the test, so the playbook under-stated
    // what the button had just created.
    const files = recipeFiles(methodConfig.id, stack);
    if (files.length === 1) {
      lines.push(`- **Starter file:** \`${files[0].path}\``);
    } else if (files.length > 1) {
      lines.push(`- **Starter files:** ${files.map(file => `\`${file.path}\``).join(', ')}`);
    } else {
      // Silence here used to mean two different things on Node — "this is a
      // practice with no artifact" and "no recipe exists for it yet" — and a
      // reader could not tell which, or whether anything had been created.
      lines.push(
        PRACTICE_ONLY_IDS.has(methodConfig.id)
          ? '- **Starter file:** _none — this is a practice, not an artifact, so there is no file to create._'
          : `- **Starter file:** _none for ${LANGUAGE_LABELS[stack.language]} — follow the set-up and key tools above._`,
      );
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
  const firstTestCandidate = enabled.some(methodology => FIRST_TEST_METHODOLOGIES.has(methodology.id))
    ? findFirstTestCandidate(workspaceRoot, stack)
    : undefined;
  return {
    success: true,
    summary: `Scaffolded testing framework for ${label}: created ${createdCount} file${createdCount === 1 ? '' : 's'}, ` +
      `${results.length - createdCount} skipped/existing.`,
    files: results,
    stackLabel: label,
    ...(firstTestCandidate ? { firstTestCandidate } : {}),
  };
}
