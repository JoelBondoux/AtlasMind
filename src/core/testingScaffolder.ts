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

const PLAYBOOK_REL_PATH = 'project_memory/operations/testing-strategy.md';

type Language = 'node' | 'python' | 'rust' | 'go' | 'dotnet' | 'java' | 'unknown';
type Archetype = 'web' | 'api' | 'cli' | 'game' | 'mobile' | 'library' | 'generic';

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

export interface TestingScaffoldResult {
  success: boolean;
  summary: string;
  files: ScaffoldFileResult[];
  stackLabel: string;
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
      return [{
        path: `performance/load.k6.js`,
        content: `import http from 'k6/http';\nimport { check, sleep } from 'k6';\n\nexport const options = { vus: 10, duration: '30s' };\n\nexport default function () {\n  const res = http.get('http://localhost:3000/');\n  check(res, { 'status is 200': (r) => r.status === 200 });\n  sleep(1);\n}\n`,
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

/** Generates language-appropriate candidate files for an enabled methodology. */
function recipeFiles(id: TestingMethodologyId, stack: DetectedStack): ScaffoldFile[] {
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
}

/** Per-language, per-methodology set-up hint shown in the playbook. */
function installHint(id: TestingMethodologyId, stack: DetectedStack): string | undefined {
  const isStructural = id === 'unit' || id === 'tdd' || id === 'test-design' || id === 'white-box';
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
      lines.push(`- **Set up (${LANGUAGE_LABELS[stack.language]}):** ${install}`);
    }
    const files = recipeFiles(methodConfig.id, stack);
    if (files.length > 0) {
      lines.push(`- **Starter file:** \`${files[0].path}\``);
    } else if (stack.language !== 'node') {
      lines.push('- **Starter file:** _guidance only for this methodology on the detected language — see Key tools above._');
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
