import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transformSync } from 'esbuild';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeMocks = vi.hoisted(() => ({
  mockReadFile: vi.fn<(uri: { path: string }) => Promise<Uint8Array>>(),
  mockWriteFile: vi.fn<(uri: { path: string }, data: Uint8Array) => Promise<void>>(),
  mockCreateDirectory: vi.fn<(uri: { path: string }) => Promise<void>>(),
  mockReadDirectory: vi.fn<(uri: { path: string }) => Promise<[string, number][]>>(),
  mockStat: vi.fn<(uri: { path: string }) => Promise<{ mtime: number }>>(),
  showQuickPick: vi.fn(),
  showInputBox: vi.fn(),
  showWarningMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  executeCommand: vi.fn(),
  exec: vi.fn(),
}));

const {
  mockReadFile,
  mockWriteFile,
  mockCreateDirectory,
  mockReadDirectory,
  mockStat,
  showQuickPick,
  showInputBox,
  showWarningMessage,
  showInformationMessage,
  showErrorMessage,
  executeCommand,
  exec,
} = vscodeMocks;
const configurationUpdates: Array<{ key: string; value: unknown; target: unknown }> = [];

const configurationState = new Map<string, unknown>([
  ['ssotPath', 'project_memory'],
  ['projectDependencyMonitoringEnabled', true],
  ['projectDependencyMonitoringProviders', ['dependabot']],
  ['projectDependencyMonitoringSchedule', 'weekly'],
  ['projectDependencyMonitoringIssueTemplate', true],
]);
const workspaceStateStore = new Map<string, unknown>();

const directorySet = new Set<string>();
let fileResponses = new Map<string, Uint8Array>();

vi.mock('vscode', () => ({
  workspace: {
    fs: {
      readFile: (...args: unknown[]) => vscodeMocks.mockReadFile(args[0] as { path: string }),
      writeFile: (...args: unknown[]) => vscodeMocks.mockWriteFile(args[0] as { path: string }, args[1] as Uint8Array),
      createDirectory: (...args: unknown[]) => vscodeMocks.mockCreateDirectory(args[0] as { path: string }),
      readDirectory: (...args: unknown[]) => vscodeMocks.mockReadDirectory(args[0] as { path: string }),
      stat: (...args: unknown[]) => vscodeMocks.mockStat(args[0] as { path: string }),
    },
    getConfiguration: () => ({
      get: (key: string, def: unknown) => configurationState.has(key) ? configurationState.get(key) : def,
      update: async (key: string, value: unknown, target: unknown) => {
        configurationState.set(key, value);
        configurationUpdates.push({ key, value, target });
      },
    }),
  },
  Uri: {
    joinPath: (base: { path: string; fsPath: string }, ...segments: string[]) => {
      const joined = [base.path.replace(/\/+$/, ''), ...segments].join('/').replace(/\/+/g, '/');
      return { path: joined, fsPath: joined };
    },
  },
  ConfigurationTarget: {
    Workspace: 1,
    WorkspaceFolder: 2,
    Global: 3,
  },
  window: {
    showQuickPick: vscodeMocks.showQuickPick,
    showInputBox: vscodeMocks.showInputBox,
    showWarningMessage: vscodeMocks.showWarningMessage,
    showInformationMessage: vscodeMocks.showInformationMessage,
    showErrorMessage: vscodeMocks.showErrorMessage,
    withProgress: vi.fn((_options: unknown, task: (progress: { report: (value: unknown) => void }) => Promise<unknown>) =>
      task({ report: vi.fn() }),
    ),
  },
  commands: {
    executeCommand: vscodeMocks.executeCommand,
  },
  ProgressLocation: { Notification: 15, Window: 10, SourceControl: 1 },
  FileType: { File: 1, Directory: 2 },
  default: {},
}));

vi.mock('node:child_process', () => ({
  exec: vscodeMocks.exec,
}));

import { bootstrapProject, buildBootstrapTemplateFiles } from '../../src/bootstrap/bootstrapper.ts';
import { buildShopifyProjectComposition } from '../../src/core/projectComposition.ts';
import { seedWorkflowConfig } from '../../src/core/workflowConfig.ts';
import type { MemoryEntry } from '../../src/types.ts';

const ROOT = { path: '/workspace', fsPath: '/workspace' };
const COMMERCE_BOOTSTRAP_FEATURE = readFileSync(
  new URL('../features/commerce-bootstrap.feature', import.meta.url),
  'utf-8',
);
const SAAS_WEB_BOOTSTRAP_FEATURE = readFileSync(
  new URL('../features/saas-web-bootstrap.feature', import.meta.url),
  'utf-8',
);
const FRONTEND_BOOTSTRAP_FEATURE = readFileSync(
  new URL('../features/frontend-bootstrap.feature', import.meta.url),
  'utf-8',
);
const MOBILE_BOOTSTRAP_FEATURE = readFileSync(
  new URL('../features/mobile-bootstrap.feature', import.meta.url),
  'utf-8',
);

function expectDeclaredScenario(title: string): void {
  expect(`${COMMERCE_BOOTSTRAP_FEATURE}\n${SAAS_WEB_BOOTSTRAP_FEATURE}\n${FRONTEND_BOOTSTRAP_FEATURE}\n${MOBILE_BOOTSTRAP_FEATURE}`)
    .toContain(`Scenario: ${title}`);
}

function seedFile(path: string, content: string): void {
  fileResponses.set(path, Buffer.from(content, 'utf-8'));
  const parts = path.split('/').filter(Boolean);
  let current = '';
  for (let index = 0; index < parts.length - 1; index += 1) {
    current += `/${parts[index]}`;
    directorySet.add(current);
  }
}

function setupVirtualFs(): void {
  fileResponses = new Map();
  directorySet.clear();
  directorySet.add('/workspace');

  mockReadFile.mockImplementation(async (uri: { path: string }) => {
    const value = fileResponses.get(uri.path);
    if (!value) {
      throw new Error('ENOENT');
    }
    return value;
  });

  mockWriteFile.mockImplementation(async (uri: { path: string }, data: Uint8Array) => {
    seedFile(uri.path, Buffer.from(data).toString('utf-8'));
  });

  mockCreateDirectory.mockImplementation(async (uri: { path: string }) => {
    directorySet.add(uri.path.replace(/\/+$/, ''));
  });

  mockReadDirectory.mockImplementation(async (uri: { path: string }) => {
    const normalized = uri.path.replace(/\/+$/, '');
    const children = new Map<string, number>();

    for (const dir of directorySet) {
      if (!dir.startsWith(`${normalized}/`)) {
        continue;
      }
      const remainder = dir.slice(normalized.length + 1);
      if (!remainder) {
        continue;
      }
      const [head, ...tail] = remainder.split('/').filter(Boolean);
      if (head) {
        children.set(head, tail.length > 0 ? 2 : 2);
      }
    }

    for (const filePath of fileResponses.keys()) {
      if (!filePath.startsWith(`${normalized}/`)) {
        continue;
      }
      const remainder = filePath.slice(normalized.length + 1);
      const [head, ...tail] = remainder.split('/').filter(Boolean);
      if (!head) {
        continue;
      }
      children.set(head, tail.length > 0 ? 2 : 1);
    }

    return [...children.entries()] as [string, number][];
  });

  mockStat.mockImplementation(async (uri: { path: string }) => {
    const normalized = uri.path.replace(/\/+$/, '');
    if (directorySet.has(normalized) || fileResponses.has(normalized)) {
      return { mtime: Date.now() };
    }
    throw new Error('ENOENT');
  });
}

function makeAtlas() {
  const workspaceState = {
    get: (key: string, fallback?: unknown) => workspaceStateStore.has(key) ? workspaceStateStore.get(key) : fallback,
    update: vi.fn(async (key: string, value: unknown) => {
      if (value === undefined) {
        workspaceStateStore.delete(key);
        return;
      }
      workspaceStateStore.set(key, value);
    }),
  };

  return {
    memoryManager: {
      loadFromDisk: vi.fn(async () => undefined),
      upsert: vi.fn((_entry: MemoryEntry, _content?: string) => ({ status: 'created' as const })),
    },
    memoryRefresh: { fire: vi.fn() },
    extensionContext: {
      workspaceState,
    },
    orchestrator: {
      completeBootstrap: vi.fn().mockResolvedValue(''),
    },
  } as unknown as import('../../src/extension.ts').AtlasMindContext;
}

describe('Feature: safe commerce project bootstrap', () => {
  it('Scenario: generate a bounded WooCommerce extension plan', () => {
    expectDeclaredScenario('Generate a bounded WooCommerce extension plan');
    const files = buildBootstrapTemplateFiles('woocommerce-extension', 'Order Notes');
    const byPath = new Map(files.map(file => [file.path, file]));
    const plugin = byPath.get('order-notes.php')?.content ?? '';

    expect(new Set(files.map(file => `${file.root}:${file.path}`)).size).toBe(files.length);
    expect(files.every(file => !file.path.startsWith('/') && !file.path.includes('..'))).toBe(true);
    expect(plugin).toContain('Requires Plugins: woocommerce');
    expect(plugin).toContain("defined( 'ABSPATH' ) || exit;");
    expect(plugin).toContain("class_exists( 'WooCommerce' )");
    expect(plugin).toContain("declare_compatibility( 'custom_order_tables'");
    expect(byPath.get('docs/privacy.md')?.content).toContain('Status: Not assessed');
    expect(byPath.get('docs/compatibility.md')?.content).toContain('Cart and Checkout blocks');
    expect(byPath.get('tests/scaffold-contract.php')?.content).toContain('Missing plugin contract marker');
    expect(byPath.get('.github/workflows/ci.yml')?.content).toContain('permissions:\n  contents: read');
    expect(byPath.get('operations/getting-started.md')?.root).toBe('ssot');
  });

  it('Scenario: treat a project name as data', () => {
    expectDeclaredScenario('Treat a project name as data');
    const files = buildBootstrapTemplateFiles('woocommerce-extension', '../123 Café */\nInjected');
    const paths = files.map(file => file.path);
    const plugin = files.find(file => file.path.endsWith('.php') && !file.path.includes('/'))?.content ?? '';
    const implementation = files.find(file => file.path.startsWith('includes/'))?.content ?? '';

    expect(paths).toContain('123-cafe-injected.php');
    expect(paths.every(path => !path.includes('..') && !path.includes('\\'))).toBe(true);
    expect(plugin).not.toContain('*/\nInjected');
    expect(plugin).not.toContain('\u0000');
    expect(plugin).toContain("define( 'ATLASMIND_123_CAFE_INJECTED_VERSION'");
    expect(implementation).toContain('namespace AtlasMind\\Extension123CafeInjected;');
  });

  it('Scenario: hand off Catalyst generation without cloning upstream', () => {
    expectDeclaredScenario('Hand off Catalyst generation without cloning upstream');
    const files = buildBootstrapTemplateFiles('bigcommerce-catalyst', 'Northwind Store');
    const byPath = new Map(files.map(file => [file.path, file]));
    const handoff = byPath.get('BIGCOMMERCE_CATALYST_HANDOFF.md')?.content ?? '';

    expect(new Set(files.map(file => `${file.root}:${file.path}`)).size).toBe(files.length);
    expect(files.every(file => !file.path.startsWith('/') && !file.path.includes('..'))).toBe(true);
    expect(files.filter(file => file.root === 'workspace').every(file => file.path.endsWith('.md'))).toBe(true);
    expect(handoff).toContain('Node.js 24');
    expect(handoff).toContain('pnpm create @bigcommerce/catalyst@latest');
    expect(handoff).toContain('not executed by AtlasMind');
    expect(handoff).toContain('not a partial Catalyst clone');
    expect(byPath.get('docs/privacy.md')?.content).toContain('Status: Not assessed');
    expect(byPath.get('docs/compatibility.md')?.content).toContain('Catalyst generator');
  });

  it('Scenario: generate an inert Magento module contract', () => {
    expectDeclaredScenario('Generate an inert Magento module contract');
    const files = buildBootstrapTemplateFiles('magento2-module', '../123 Returns */\nInjected');
    const byPath = new Map(files.map(file => [file.path, file]));
    const registration = byPath.get('registration.php')?.content ?? '';
    const moduleXml = byPath.get('etc/module.xml')?.content ?? '';
    const composer = JSON.parse(byPath.get('composer.json')?.content ?? '{}') as Record<string, unknown>;
    const workflow = byPath.get('.github/workflows/ci.yml')?.content ?? '';

    expect(files.every(file => !file.path.startsWith('/') && !file.path.includes('..'))).toBe(true);
    expect(registration).toContain("'AtlasMind_Module123ReturnsInjected'");
    expect(moduleXml).toContain('<module name="AtlasMind_Module123ReturnsInjected"/>');
    expect(moduleXml).not.toContain('setup_version');
    expect(composer).toMatchObject({
      name: 'atlasmind/module-123-returns-injected',
      type: 'magento2-module',
      license: 'proprietary',
      autoload: {
        files: ['registration.php'],
        'psr-4': { 'AtlasMind\\Module123ReturnsInjected\\': '' },
      },
    });
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('composer validate --strict --no-check-publish');
    expect(workflow).toContain('php tests/scaffold-contract.php');
    expect(byPath.get('README.md')?.content).toContain('deliberately inert module shell');
  });

  it('Scenario: keep Wix provisioning under operator control', () => {
    expectDeclaredScenario('Keep Wix provisioning under operator control');
    const files = buildBootstrapTemplateFiles('wix-commerce', 'Store "$(danger)"');
    const byPath = new Map(files.map(file => [file.path, file]));
    const handoff = byPath.get('WIX_COMMERCE_HANDOFF.md')?.content ?? '';

    expect(files.every(file => !file.path.startsWith('/') && !file.path.includes('..'))).toBe(true);
    expect(files.filter(file => file.root === 'workspace').every(file => file.path.endsWith('.md'))).toBe(true);
    expect(handoff).toContain('npm create @wix/new@latest -- headless');
    expect(handoff).toContain('--site-template commerce');
    expect(handoff).toContain('--skip-install --skip-git --no-publish');
    expect(handoff).toContain('provisions a Wix business/site and private');
    expect(handoff).not.toContain('--business-name "Store "$(danger)""');
    expect([...byPath.keys()]).not.toContain('wix.config.json');
    expect([...byPath.keys()]).not.toContain('package.json');
  });
});

describe('Feature: safety-first SaaS and web bootstrap prefabs', () => {
  it('Scenario: hand off maintained application generators without executing them', () => {
    expectDeclaredScenario('Hand off maintained application generators without executing them');
    const cases = [
      ['nextjs-saas', 'NEXTJS_SAAS_HANDOFF.md', 'pnpm create next-app@latest'],
      ['react-router-saas', 'REACT_ROUTER_SAAS_HANDOFF.md', 'npx create-react-router@latest'],
      ['laravel-saas', 'LARAVEL_SAAS_HANDOFF.md', 'laravel new <folder-name>'],
      ['django-saas', 'DJANGO_SAAS_HANDOFF.md', '-m django startproject'],
      ['astro-content-site', 'ASTRO_CONTENT_HANDOFF.md', 'npm create astro@latest'],
    ] as const;

    for (const [template, handoffPath, command] of cases) {
      const files = buildBootstrapTemplateFiles(template, 'Acme $(danger) <img onerror="x"> */\nInjected');
      const handoff = files.find(file => file.path === handoffPath)?.content ?? '';
      const commandBlock = /```text\n([\s\S]*?)\n```/.exec(handoff)?.[1] ?? '';

      expect(files.every(file => !file.path.startsWith('/') && !file.path.includes('..')), template).toBe(true);
      expect(files.filter(file => file.root === 'workspace').every(file => file.path.endsWith('.md')), template).toBe(true);
      expect(handoff, template).toContain(command);
      expect(handoff, template).toContain('were not executed by AtlasMind');
      expect(handoff, template).toContain('Effects when an operator runs them');
      expect(handoff, template).toContain('<folder-name>');
      expect(commandBlock, template).not.toContain('Acme $(danger)');
      expect(handoff, template).not.toContain('<img onerror="x">');
      expect(handoff, template).toContain('&lt;img onerror=&quot;x&quot;&gt;');
      expect(files.find(file => file.path === 'docs/privacy.md')?.content, template).toContain('Status: Not assessed');
      expect(files.find(file => file.path === 'docs/compatibility.md')?.content, template).toContain('Status: Not assessed');
    }
  });

  it('Scenario: use the maintained React Router path for Remix applications', () => {
    expectDeclaredScenario('Use the maintained React Router path for Remix applications');
    const files = buildBootstrapTemplateFiles('react-router-saas', 'Accounts');
    const handoff = files.find(file => file.path === 'REACT_ROUTER_SAAS_HANDOFF.md')?.content ?? '';

    expect(handoff).toContain('create-react-router@latest');
    expect(handoff).toContain('maintained successor path');
    expect(handoff).not.toContain('create-remix');
  });

  it('Scenario: generate a dependency-free static website contract', async () => {
    expectDeclaredScenario('Generate a dependency-free static website contract');
    const files = buildBootstrapTemplateFiles('static-site', '<img src=x onerror="danger">');
    const byPath = new Map(files.map(file => [file.path, file]));
    const html = byPath.get('index.html')?.content ?? '';
    const pkg = JSON.parse(byPath.get('package.json')?.content ?? '{}') as Record<string, unknown>;
    const contract = byPath.get('tests/static-contract.test.mjs')?.content ?? '';
    const workflow = byPath.get('.github/workflows/ci.yml')?.content ?? '';
    const renderedMarkdown = files
      .filter(file => file.path.endsWith('.md'))
      .map(file => file.content)
      .join('\n');

    expect(files.every(file => !file.path.startsWith('/') && !file.path.includes('..'))).toBe(true);
    expect(html).toContain('&lt;img src=x onerror=&quot;danger&quot;&gt;');
    expect(html).not.toContain('<img src=x onerror="danger">');
    expect(renderedMarkdown).toContain('&lt;img src=x onerror=&quot;danger&quot;&gt;');
    expect(renderedMarkdown).not.toContain('<img src=x onerror="danger">');
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain('<main id="main">');
    expect(html).toContain('class="skip-link"');
    expect(html).not.toMatch(/<script(?:\s|>)(?![^>]*\bsrc=)/i);
    expect(html).not.toMatch(/<style(?:\s|>)/i);
    expect(pkg).toMatchObject({ private: true, type: 'module', scripts: { test: 'node --test' } });
    expect(contract).toContain("import test from 'node:test'");
    expect(contract).toContain('Content-Security-Policy');
    expect(() => transformSync(contract, { loader: 'js', format: 'esm', target: 'node24' })).not.toThrow();
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('run: npm test');

    const tempRoot = mkdtempSync(join(tmpdir(), 'atlasmind-static-contract-'));
    try {
      mkdirSync(join(tempRoot, 'tests'), { recursive: true });
      writeFileSync(join(tempRoot, 'index.html'), html, 'utf8');
      writeFileSync(join(tempRoot, 'tests', 'static-contract.test.mjs'), contract, 'utf8');
      const { spawnSync } = await vi.importActual<typeof import('node:child_process')>('node:child_process');
      const run = spawnSync(process.execPath, ['--test', 'tests/static-contract.test.mjs'], {
        cwd: tempRoot,
        encoding: 'utf8',
      });
      expect(run.status, `${run.stderr}\n${run.stdout}`).toBe(0);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('Scenario: keep content ownership explicit for a blog or CMS', () => {
    expectDeclaredScenario('Keep content ownership explicit for a blog or CMS');
    const files = buildBootstrapTemplateFiles('astro-content-site', 'Editorial');
    const handoff = files.find(file => file.path === 'ASTRO_CONTENT_HANDOFF.md')?.content ?? '';

    expect(handoff).toContain('--template blog --no-install --no-git --no-ai');
    expect(handoff).toContain('repository-owned content, build-time remote content, or live CMS content');
    expect(handoff).toContain('managed CMS');
  });
});

describe('Feature: current frontend project bootstrap', () => {
  it('Scenario: hand off every frontend generator without executing it', () => {
    expectDeclaredScenario('Hand off every frontend generator without executing it');
    const cases = [
      ['nextjs-frontend', 'NEXTJS_FRONTEND_HANDOFF.md', 'create next-app@latest'],
      ['sveltekit-frontend', 'SVELTEKIT_FRONTEND_HANDOFF.md', 'npx sv create'],
      ['nuxt-frontend', 'NUXT_FRONTEND_HANDOFF.md', 'create nuxt@latest'],
      ['react-frontend', 'REACT_FRONTEND_HANDOFF.md', '--template react-ts'],
      ['vue-frontend', 'VUE_FRONTEND_HANDOFF.md', 'create vue@latest'],
    ] as const;

    for (const [template, handoffPath, command] of cases) {
      const files = buildBootstrapTemplateFiles(template, 'UI $(danger) <img onerror="x"> */\nInjected');
      const handoff = files.find(file => file.path === handoffPath)?.content ?? '';
      const commandBlock = /```text\n([\s\S]*?)\n```/.exec(handoff)?.[1] ?? '';

      expect(files.every(file => !file.path.startsWith('/') && !file.path.includes('..')), template).toBe(true);
      expect(files.filter(file => file.root === 'workspace').every(file => file.path.endsWith('.md')), template).toBe(true);
      expect(handoff, template).toContain(command);
      expect(handoff, template).toContain('were not executed by AtlasMind');
      expect(handoff, template).toContain('<folder-name>');
      expect(commandBlock, template).not.toContain('UI $(danger)');
      expect(handoff, template).not.toContain('<img onerror="x">');
      expect(handoff, template).toContain('&lt;img onerror=&quot;x&quot;&gt;');
      expect(files.find(file => file.path === 'docs/privacy.md')?.content, template).toContain('Status: Not assessed');
      expect(files.find(file => file.path === 'docs/compatibility.md')?.content, template).toContain('Status: Not assessed');
    }
  });

  it('Scenario: use the current SvelteKit generator', () => {
    expectDeclaredScenario('Use the current SvelteKit generator');
    const handoff = buildBootstrapTemplateFiles('sveltekit-frontend', 'Interface')
      .find(file => file.path === 'SVELTEKIT_FRONTEND_HANDOFF.md')?.content ?? '';

    expect(handoff).toContain('npx sv create');
    expect(handoff).not.toContain('create-svelte');
  });

  it("Scenario: keep React's framework decision honest", () => {
    expectDeclaredScenario("Keep React's framework decision honest");
    const handoff = buildBootstrapTemplateFiles('react-frontend', 'Interface')
      .find(file => file.path === 'REACT_FRONTEND_HANDOFF.md')?.content ?? '';

    expect(handoff).toContain('React recommends a framework');
    expect(handoff).toContain('routing, data, state, metadata, and authentication integration');
    expect(handoff).toContain('--template react-ts --no-interactive');
  });

  it('Scenario: keep interactive Vue choices with the operator', () => {
    expectDeclaredScenario('Keep interactive Vue choices with the operator');
    const handoff = buildBootstrapTemplateFiles('vue-frontend', 'Interface')
      .find(file => file.path === 'VUE_FRONTEND_HANDOFF.md')?.content ?? '';

    for (const choice of ['TypeScript', 'Router', 'Pinia', 'unit tests', 'end-to-end tests', 'linting', 'formatting', 'developer tools']) {
      expect(handoff).toContain(choice);
    }
    expect(handoff).toContain('npm install');
    expect(handoff).toContain('separate review step');
  });
});

describe('Feature: safety-first mobile project bootstrap', () => {
  it('Scenario: hand off every mobile generator without executing it', () => {
    expectDeclaredScenario('Hand off every mobile generator without executing it');
    const cases = [
      ['react-native-mobile', 'REACT_NATIVE_MOBILE_HANDOFF.md', '@react-native-community/cli@latest'],
      ['expo-mobile', 'EXPO_MOBILE_HANDOFF.md', 'create-expo-app@latest'],
      ['flutter-mobile', 'FLUTTER_MOBILE_HANDOFF.md', 'flutter create --empty'],
    ] as const;

    for (const [template, handoffPath, command] of cases) {
      const files = buildBootstrapTemplateFiles(template, 'Mobile $(danger) <img onerror="x"> */\nInjected');
      const handoff = files.find(file => file.path === handoffPath)?.content ?? '';
      const commandBlock = /```text\n([\s\S]*?)\n```/.exec(handoff)?.[1] ?? '';

      expect(files.every(file => !file.path.startsWith('/') && !file.path.includes('..')), template).toBe(true);
      expect(files.filter(file => file.root === 'workspace').every(file => file.path.endsWith('.md')), template).toBe(true);
      expect(handoff, template).toContain(command);
      expect(handoff, template).toContain('were not executed by AtlasMind');
      expect(commandBlock, template).not.toContain('Mobile $(danger)');
      expect(handoff, template).not.toContain('<img onerror="x">');
      expect(handoff, template).toContain('&lt;img onerror=&quot;x&quot;&gt;');
      expect(files.find(file => file.path === 'docs/privacy.md')?.content, template).toContain('Status: Not assessed');
      expect(files.find(file => file.path === 'docs/compatibility.md')?.content, template).toContain('Status: Not assessed');
    }
  });

  it('Scenario: prefer a framework for a new React Native application', () => {
    expectDeclaredScenario('Prefer a framework for a new React Native application');
    const handoff = buildBootstrapTemplateFiles('react-native-mobile', 'Native App')
      .find(file => file.path === 'REACT_NATIVE_MOBILE_HANDOFF.md')?.content ?? '';

    expect(handoff).toContain('React Native recommends a framework');
    expect(handoff).toContain('constraint that is not served well');
    expect(handoff).toContain('<native-app-name>');
    expect(handoff).toContain('iOS CocoaPods');
  });

  it('Scenario: keep Expo native generation and cloud services explicit', () => {
    expectDeclaredScenario('Keep Expo native generation and cloud services explicit');
    const handoff = buildBootstrapTemplateFiles('expo-mobile', 'Expo App')
      .find(file => file.path === 'EXPO_MOBILE_HANDOFF.md')?.content ?? '';

    expect(handoff).toContain('default@<reviewed-sdk> --no-install --no-agents-md');
    expect(handoff).toContain('skips npm dependencies and CocoaPods');
    expect(handoff).toContain('Continuous Native Generation');
    expect(handoff).toContain('optional EAS');
  });

  it('Scenario: disclose Flutter naming and dependency retrieval', () => {
    expectDeclaredScenario('Disclose Flutter naming and dependency retrieval');
    const handoff = buildBootstrapTemplateFiles('flutter-mobile', 'Flutter App')
      .find(file => file.path === 'FLUTTER_MOBILE_HANDOFF.md')?.content ?? '';

    expect(handoff).toContain('lowercase_with_underscores');
    expect(handoff).toContain('<dart_package_name>');
    expect(handoff).toContain('retrieves necessary dependencies');
    expect(handoff).toContain('does not claim this command is offline');
  });
});

describe('bootstrapProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    mockCreateDirectory.mockReset();
    mockReadDirectory.mockReset();
    mockStat.mockReset();
    showQuickPick.mockReset();
    showInputBox.mockReset();
    showWarningMessage.mockReset();
    showInformationMessage.mockReset();
    showErrorMessage.mockReset();
    executeCommand.mockReset();
    exec.mockReset();
    exec.mockImplementation((...args: unknown[]) => {
      const callback = [...args].reverse().find(
        (arg): arg is (error: Error | null, stdout: string, stderr: string) => void => typeof arg === 'function',
      );
      queueMicrotask(() => callback?.(new Error('Command unavailable in unit test'), '', ''));
      return {};
    });
    configurationUpdates.length = 0;
    configurationState.clear();
    configurationState.set('ssotPath', 'project_memory');
    configurationState.set('projectDependencyMonitoringEnabled', true);
    configurationState.set('projectDependencyMonitoringProviders', ['dependabot']);
    configurationState.set('projectDependencyMonitoringSchedule', 'weekly');
    configurationState.set('projectDependencyMonitoringIssueTemplate', true);
    workspaceStateStore.clear();
    showWarningMessage.mockResolvedValue(undefined);
    setupVirtualFs();
  });

  it('declares a selected Shopify composition in the workflow SSOT', async () => {
    showQuickPick
      .mockResolvedValueOnce({ intakeMode: 'guided' })
      .mockResolvedValueOnce({ label: '$(layers) Shopify composable project', composition: 'shopify' })
      .mockResolvedValueOnce([
        { component: 'theme' },
        { component: 'app' },
        { component: 'extension' },
      ]);

    const reported: string[] = [];
    await bootstrapProject(
      ROOT as any,
      makeAtlas(),
      { markdown: (value: unknown) => { reported.push(String(value)); } } as any,
    );

    const raw = Buffer.from(
      fileResponses.get('/workspace/project_memory/operations/workflow.json') ?? [],
    ).toString('utf-8');
    const workflow = JSON.parse(raw) as {
      composition: { components: Array<{ id: string; location: string; home: boolean }> };
      stages: Array<{ enabled: boolean; automationLevel: string }>;
    };
    const mirror = Buffer.from(
      fileResponses.get('/workspace/project_memory/operations/workflow.md') ?? [],
    ).toString('utf-8');

    expect(workflow.composition.components.map(component => component.id)).toEqual([
      'shopify-theme',
      'shopify-app',
      'shopify-extension',
    ]);
    expect(workflow.composition.components.find(component => component.home)).toMatchObject({
      id: 'shopify-app',
      location: '.',
    });
    expect(workflow.stages.every(stage => !stage.enabled && stage.automationLevel === 'observe')).toBe(true);
    expect(mirror).toContain('Shopify theme');
    expect(mirror).toContain('Shopify app');
    expect(mirror).toContain('Shopify extension');
    expect(reported.join('\n')).toContain('Shopify composition (Theme + App + Extension)');
    expect(executeCommand).not.toHaveBeenCalled();

    const compositionPick = showQuickPick.mock.calls.find(([, options]) => options?.title === 'Shopify Project Composition');
    expect(compositionPick?.[1]).toMatchObject({ canPickMany: true });
  });

  it('never overwrites a newer workflow document with a bootstrap composition', async () => {
    const futureWorkflow = JSON.stringify({
      version: 2,
      futurePolicy: { compositionAuthority: 'team' },
    });
    seedFile('/workspace/project_memory/operations/workflow.json', futureWorkflow);
    showWarningMessage.mockResolvedValueOnce('Continue');
    showQuickPick
      .mockResolvedValueOnce({ intakeMode: 'guided' })
      .mockResolvedValueOnce({ label: '$(layers) Shopify composable project', composition: 'shopify' })
      .mockResolvedValueOnce([
        { component: 'theme' },
        { component: 'app' },
        { component: 'extension' },
      ]);

    const reported: string[] = [];
    await bootstrapProject(
      ROOT as any,
      makeAtlas(),
      { markdown: (value: unknown) => { reported.push(String(value)); } } as any,
    );

    expect(Buffer.from(
      fileResponses.get('/workspace/project_memory/operations/workflow.json') ?? [],
    ).toString('utf-8')).toBe(futureWorkflow);
    expect(fileResponses.has('/workspace/project_memory/operations/workflow.md')).toBe(false);
    expect(reported.join('\n')).toContain('Left the existing workflow declaration untouched');
  });

  it('never replaces a composition the team already declared', async () => {
    const existingWorkflow = JSON.stringify({
      ...seedWorkflowConfig({ profile: 'studio' }),
      composition: buildShopifyProjectComposition(['theme']),
    }, null, 2);
    seedFile('/workspace/project_memory/operations/workflow.json', existingWorkflow);
    showWarningMessage.mockResolvedValueOnce('Continue');
    showQuickPick
      .mockResolvedValueOnce({ intakeMode: 'guided' })
      .mockResolvedValueOnce({ label: '$(layers) Shopify composable project', composition: 'shopify' })
      .mockResolvedValueOnce([{ component: 'app' }, { component: 'extension' }]);

    await bootstrapProject(ROOT as any, makeAtlas());

    expect(Buffer.from(
      fileResponses.get('/workspace/project_memory/operations/workflow.json') ?? [],
    ).toString('utf-8')).toBe(existingWorkflow);
    expect(showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('existing workflow composition'));
  });

  it('offers a game preset that seeds composition without governing it', async () => {
    showQuickPick
      .mockResolvedValueOnce({ intakeMode: 'guided' })
      .mockResolvedValueOnce({ label: 'Game', composition: 'game' })
      .mockResolvedValueOnce({ label: 'Hybrid Git + Perforce studio', presetId: 'hybrid-git-perforce' });

    const reported: string[] = [];
    await bootstrapProject(
      ROOT as any,
      makeAtlas(),
      { markdown: (value: unknown) => { reported.push(String(value)); } } as any,
    );

    const workflow = JSON.parse(Buffer.from(
      fileResponses.get('/workspace/project_memory/operations/workflow.json') ?? [],
    ).toString('utf-8')) as {
      composition: { components: Array<{ id: string; vcs: string; home: boolean }> };
    };
    expect(workflow.composition.components.map(component => component.id)).toEqual([
      'gameplay',
      'backend',
      'content',
    ]);
    expect(workflow.composition.components.find(component => component.id === 'content')?.vcs).toBe('perforce');
    expect(workflow.composition).not.toHaveProperty('preset');
    expect(reported.join('\n')).toContain('Game composition (Hybrid Git + Perforce studio)');
    expect(executeCommand).not.toHaveBeenCalled();

    const presetPick = showQuickPick.mock.calls.find(([, options]) => options?.title === 'Game Architecture Preset');
    expect(presetPick?.[0]).toHaveLength(4);
  });

  it('runs the guided intake and seeds SSOT, settings, and GitHub planning artifacts', async () => {
    showQuickPick
      .mockResolvedValueOnce({ intakeMode: 'guided' })
      .mockResolvedValueOnce('Web App')
      .mockResolvedValueOnce('Fast feedback')
      .mockResolvedValueOnce('Already has an online repo')
      .mockResolvedValueOnce('GitHub')
      .mockResolvedValueOnce('Yes')
      .mockResolvedValueOnce('Yes')
      .mockResolvedValueOnce(['Dependabot', 'Renovate'])
      .mockResolvedValueOnce('Weekly');

    showInputBox
      .mockResolvedValueOnce('Atlas Launchpad')
      .mockResolvedValueOnce('A polished onboarding portal for B2B customers.')
      .mockResolvedValueOnce('Reduce time-to-value during customer onboarding.')
      .mockResolvedValueOnce('A three-person product and platform team.')
      .mockResolvedValueOnce('Private beta in 8 weeks.')
      .mockResolvedValueOnce('Moderate budget with clear ROI expectations.')
      .mockResolvedValueOnce('Activation rate and onboarding completion time.')
      .mockResolvedValueOnce('TypeScript, React, Node.js, PostgreSQL.')
      .mockResolvedValueOnce('Stripe, GitHub Actions, Sentry.');

    const atlas = makeAtlas();
    await bootstrapProject(ROOT as any, atlas);

    const projectSoul = Buffer.from(fileResponses.get('/workspace/project_memory/project_soul.md') ?? []).toString('utf-8');
    const projectBrief = Buffer.from(fileResponses.get('/workspace/project_memory/domain/project-brief.md') ?? []).toString('utf-8');
    const repositoryPlan = Buffer.from(fileResponses.get('/workspace/project_memory/operations/repository-plan.md') ?? []).toString('utf-8');
    const roadmap = Buffer.from(fileResponses.get('/workspace/project_memory/roadmap/bootstrap-plan.md') ?? []).toString('utf-8');
    const developerRoadmap = Buffer.from(fileResponses.get('/workspace/project_memory/roadmap/improvement-plan.md') ?? []).toString('utf-8');
    const ideationBoard = Buffer.from(fileResponses.get('/workspace/project_memory/ideas/atlas-ideation-board.json') ?? []).toString('utf-8');
    const intakeIssue = Buffer.from(fileResponses.get('/workspace/.github/ISSUE_TEMPLATE/project_intake.yml') ?? []).toString('utf-8');
    const planningCsv = Buffer.from(fileResponses.get('/workspace/.github/project-planning/atlasmind-project-items.csv') ?? []).toString('utf-8');
    const featureRequest = Buffer.from(fileResponses.get('/workspace/.github/ISSUE_TEMPLATE/feature_request.md') ?? []).toString('utf-8');
    const storedProfile = workspaceStateStore.get('atlasmind.personalityProfile') as { answers?: Record<string, unknown> } | undefined;

    expect(projectSoul).toContain('Atlas Launchpad');
    expect(projectSoul).toContain('Reduce time-to-value during customer onboarding.');
    expect(projectBrief).toContain('B2B customers');
    expect(projectBrief).toContain('TypeScript, React, Node.js, PostgreSQL.');
    expect(projectBrief).toContain('Existing online repo');
    expect(repositoryPlan).toContain('Existing online repo');
    expect(repositoryPlan).toContain('github');
    expect(roadmap).toContain('Private beta in 8 weeks.');
    expect(developerRoadmap).toContain('# Developer Roadmap');
    expect(developerRoadmap).toContain('Priority order matters');
    expect(developerRoadmap).toContain('- [ ]');
    expect(ideationBoard).toContain('Atlas seeded the ideation board from the bootstrap intake.');
    expect(intakeIssue).toContain('Project intake');
    expect(intakeIssue).toContain('A polished onboarding portal for B2B customers.');
    expect(planningCsv).toContain('Validate target audience');
    expect(featureRequest).toContain('Fit With Project Constraints');
    expect(featureRequest).toContain('Moderate budget with clear ROI expectations.');
    expect(storedProfile?.answers?.primaryPurpose).toContain('Atlas Launchpad');
    expect(storedProfile?.answers?.goalHorizon).toBe('project-aware');
    expect(storedProfile?.answers?.goalModelPersistence).toBe('maintain');

    expect(configurationUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'budgetMode', value: 'balanced' }),
      expect.objectContaining({ key: 'speedMode', value: 'fast' }),
      expect.objectContaining({ key: 'projectDependencyMonitoringProviders', value: ['dependabot', 'renovate'] }),
      expect.objectContaining({ key: 'projectDependencyMonitoringSchedule', value: 'weekly' }),
    ]));
    expect(executeCommand).toHaveBeenCalledWith('git.init');
    expect(atlas.memoryManager.loadFromDisk).toHaveBeenCalled();
    expect(atlas.memoryRefresh.fire).toHaveBeenCalled();
  });

  it('supports a minimal bootstrap where all project questions are skipped', async () => {
    showQuickPick
      .mockResolvedValueOnce({ intakeMode: 'minimal' })
      .mockResolvedValueOnce('No')
      .mockResolvedValueOnce('No');

    const atlas = makeAtlas();
    await bootstrapProject(ROOT as any, atlas);

    const projectBrief = Buffer.from(fileResponses.get('/workspace/project_memory/domain/project-brief.md') ?? []).toString('utf-8');
    const intakeLog = Buffer.from(fileResponses.get('/workspace/project_memory/operations/bootstrap-intake.md') ?? []).toString('utf-8');
    const planningCsv = Buffer.from(fileResponses.get('/workspace/.github/project-planning/atlasmind-project-items.csv') ?? []).toString('utf-8');

    expect(projectBrief).toContain('_Not captured during bootstrap._');
    expect(intakeLog).toContain('Mode: minimal');
    expect(planningCsv).toContain('Confirm project brief');
    expect(configurationUpdates.some(update => update.key === 'budgetMode')).toBe(false);
    expect(executeCommand).not.toHaveBeenCalledWith('git.init');
    expect(atlas.memoryManager.loadFromDisk).toHaveBeenCalled();
  });

  it('never overwrites an ideation board somebody has worked on', async () => {
    // This wrote unconditionally, so running bootstrap a second time destroyed
    // every card, connection and piece of evidence on the board and reported it
    // as "seeded". The board is a document the user authors, not a scaffold
    // AtlasMind maintains — and a board silently discarded on re-run is a board
    // nobody invests in.
    const existing = JSON.stringify({
      version: 1,
      cards: [{ id: 'card-1', title: 'Six weeks of research', kind: 'evidence' }],
    });
    seedFile('/workspace/project_memory/ideas/atlas-ideation-board.json', existing);
    seedFile('/workspace/project_memory/ideas/atlas-ideation-board.md', '# My board');

    // Re-running bootstrap on an existing SSOT asks to confirm first. Answering
    // it is part of this scenario — without it the run returns early and the
    // test would pass because nothing happened.
    showWarningMessage.mockResolvedValueOnce('Continue');

    showQuickPick
      .mockResolvedValueOnce({ intakeMode: 'minimal' })
      .mockResolvedValueOnce('No')
      .mockResolvedValueOnce('No');

    await bootstrapProject(ROOT as any, makeAtlas());

    const board = Buffer.from(
      fileResponses.get('/workspace/project_memory/ideas/atlas-ideation-board.json') ?? [],
    ).toString('utf-8');
    expect(board).toBe(existing);
    expect(board).toContain('Six weeks of research');
    // The summary mirror goes with it: rewriting that alone would leave a board
    // and a summary describing different things.
    expect(Buffer.from(
      fileResponses.get('/workspace/project_memory/ideas/atlas-ideation-board.md') ?? [],
    ).toString('utf-8')).toBe('# My board');
  });

  it('reports that it left the board alone, rather than claiming it seeded one', async () => {
    // `ideationSeeded` returned true either way, so the report said "seeded" for
    // what was an erasure. Both branches now describe what actually happened.
    seedFile('/workspace/project_memory/ideas/atlas-ideation-board.json', '{}');

    // Re-running bootstrap on an existing SSOT asks to confirm first. Answering
    // it is part of this scenario — without it the run returns early and the
    // test would pass because nothing happened.
    showWarningMessage.mockResolvedValueOnce('Continue');

    showQuickPick
      .mockResolvedValueOnce({ intakeMode: 'minimal' })
      .mockResolvedValueOnce('No')
      .mockResolvedValueOnce('No');

    const reported: string[] = [];
    await bootstrapProject(ROOT as any, makeAtlas(), { markdown: (value: unknown) => { reported.push(String(value)); } } as any);

    const summary = reported.join('\n');
    expect(summary).toContain('Left the existing ideation board');
    expect(summary).not.toContain('Seeded ideation defaults');
  });

  it('still seeds a board when there is not one', async () => {
    showQuickPick
      .mockResolvedValueOnce({ intakeMode: 'minimal' })
      .mockResolvedValueOnce('No')
      .mockResolvedValueOnce('No');

    const reported: string[] = [];
    await bootstrapProject(ROOT as any, makeAtlas(), { markdown: (value: unknown) => { reported.push(String(value)); } } as any);

    expect(fileResponses.has('/workspace/project_memory/ideas/atlas-ideation-board.json')).toBe(true);
    expect(reported.join('\n')).toContain('Seeded ideation defaults');
  });

  it('keeps out-of-turn details and skips later prompts when earlier answers already supplied them', async () => {
    showQuickPick
      .mockResolvedValueOnce({ intakeMode: 'guided' })
      .mockResolvedValueOnce('Web App')
      .mockResolvedValueOnce('No')
      .mockResolvedValueOnce('No');

    showInputBox
      .mockResolvedValueOnce('Atlas Launchpad')
      .mockResolvedValueOnce('Summary: A polished onboarding portal. Audience: B2B customers. Builders: a three-person platform team. Timeline: 8 weeks. Budget: lean MVP. Stack: TypeScript, React, Node.js, PostgreSQL. Tools: Stripe, GitHub Actions, Sentry. No online repo yet. Repo host: GitHub. Repo location: acme/platform/atlas-launchpad. Atlas speed mode: fast feedback.')
      .mockResolvedValueOnce('Reduce onboarding time and improve activation rate.');

    const atlas = makeAtlas();
    await bootstrapProject(ROOT as any, atlas);

    const projectBrief = Buffer.from(fileResponses.get('/workspace/project_memory/domain/project-brief.md') ?? []).toString('utf-8');
    const intakeLog = Buffer.from(fileResponses.get('/workspace/project_memory/operations/bootstrap-intake.md') ?? []).toString('utf-8');
    const repositoryPlan = Buffer.from(fileResponses.get('/workspace/project_memory/operations/repository-plan.md') ?? []).toString('utf-8');
    const storedProfile = workspaceStateStore.get('atlasmind.personalityProfile') as { answers?: Record<string, unknown> } | undefined;

    expect(projectBrief).toContain('B2B customers');
    expect(projectBrief).toContain('a three-person platform team');
    expect(projectBrief).toContain('8 weeks');
    expect(projectBrief).toContain('TypeScript, React, Node.js, PostgreSQL');
    expect(projectBrief).toContain('Stripe, GitHub Actions, Sentry');
    expect(projectBrief).toContain('Needs a new online repo');
    expect(projectBrief).toContain('acme/platform/atlas-launchpad');
    expect(configurationUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'budgetMode', value: 'cheap' }),
      expect.objectContaining({ key: 'speedMode', value: 'fast' }),
    ]));
    expect(intakeLog).toContain('Captured target audience from project brief.');
    expect(intakeLog).toContain('Captured tech stack from project brief.');
    expect(intakeLog).toContain('Captured online repo status from project brief.');
    expect(repositoryPlan).toContain('acme/platform/atlas-launchpad');
    expect(storedProfile?.answers?.rememberLongTerm).toContain('Audience: B2B customers');
    // Project name, the dense summary, and the primary outcome are supplied;
    // only success metrics remains uninferred and needs one additional prompt.
    expect(showInputBox).toHaveBeenCalledTimes(4);
  }, 30000);

  it('captures where a missing online repo should be created when the project is not yet hosted', async () => {
    showQuickPick
      .mockResolvedValueOnce({ intakeMode: 'guided' })
      .mockResolvedValueOnce('API Server')
      .mockResolvedValueOnce('Balanced')
      .mockResolvedValueOnce('Needs a new online repo')
      .mockResolvedValueOnce('GitLab')
      .mockResolvedValueOnce('No')
      .mockResolvedValueOnce('No');

    showInputBox
      .mockResolvedValueOnce('Ops API')
      .mockResolvedValueOnce('An internal operations API for field scheduling.')
      .mockResolvedValueOnce('Reduce manual dispatch coordination.')
      .mockResolvedValueOnce('Internal operations coordinators')
      .mockResolvedValueOnce('Platform team')
      .mockResolvedValueOnce('Pilot in 4 weeks')
      .mockResolvedValueOnce('Fixed internal budget')
      .mockResolvedValueOnce('Dispatch turnaround time')
      .mockResolvedValueOnce('TypeScript, Node.js, PostgreSQL')
      .mockResolvedValueOnce('Sentry, Slack')
      .mockResolvedValueOnce('gitlab.company.local/ops/ops-api');

    const atlas = makeAtlas();
    await bootstrapProject(ROOT as any, atlas);

    const projectBrief = Buffer.from(fileResponses.get('/workspace/project_memory/domain/project-brief.md') ?? []).toString('utf-8');
    const repositoryPlan = Buffer.from(fileResponses.get('/workspace/project_memory/operations/repository-plan.md') ?? []).toString('utf-8');
    const roadmap = Buffer.from(fileResponses.get('/workspace/project_memory/roadmap/bootstrap-plan.md') ?? []).toString('utf-8');

    expect(projectBrief).toContain('Needs a new online repo');
    expect(projectBrief).toContain('gitlab.company.local/ops/ops-api');
    expect(repositoryPlan).toContain('Needs a new online repo');
    expect(repositoryPlan).toContain('gitlab (gitlab.company.local/ops/ops-api)');
    expect(roadmap).toContain('Create the online repository on gitlab (gitlab.company.local/ops/ops-api)');
  });
});
