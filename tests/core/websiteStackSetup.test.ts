import { describe, expect, it, vi } from 'vitest';
import * as path from 'node:path';
import {
  describeStackSetupRun,
  executeWebsiteStackSetup,
  planWebsiteStackSetup,
  validateSetupPath,
  validateStep,
  type StackSetupProbe,
  type StackSetupStep,
} from '../../src/core/websiteStackSetup.js';
import {
  WEBSITE_FRAMEWORK_CATALOG,
  type WebsiteFrameworkId,
  type WebsitePackageManager,
} from '../../src/core/websiteFrameworks.js';
import { WEBSITE_PLATFORM_CATALOG } from '../../src/core/websiteWorkspaceManager.js';
import type { WebsiteHostingEnvironment, WebsitePlatformId } from '../../src/types.js';

const ROOT = path.resolve('/work/site');

const ENVIRONMENTS: WebsiteHostingEnvironment[] = [
  { id: 'develop', name: 'Develop', purpose: '', hostingMode: 'local', accessPolicy: 'local-only', url: 'http://localhost:3000/', notes: '', promotionProtected: false },
  { id: 'staging', name: 'Staging', purpose: '', hostingMode: 'hosted', accessPolicy: 'password-protected', notes: '', promotionProtected: false },
  { id: 'production', name: 'Production', purpose: '', hostingMode: 'hosted', accessPolicy: 'public', notes: '', promotionProtected: true },
];

const EMPTY_PROBE: StackSetupProbe = {
  hasNode: true,
  hasHugo: true,
  hasPackageJson: false,
  existingPaths: [],
  existingBranches: [],
};

function plan(
  frameworkId: WebsiteFrameworkId,
  platformId: WebsitePlatformId,
  overrides: Partial<Parameters<typeof planWebsiteStackSetup>[0]> = {},
) {
  return planWebsiteStackSetup({
    frameworkId,
    platformId,
    packageManager: 'npm',
    environments: ENVIRONMENTS,
    probe: EMPTY_PROBE,
    generateCi: true,
    allowRemoteProjectCreation: false,
    ...overrides,
  });
}

/** Every framework × platform × package manager pairing the UI can produce. */
function everyProducibleStep(): StackSetupStep[] {
  const managers: WebsitePackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];
  const steps: StackSetupStep[] = [];
  for (const framework of WEBSITE_FRAMEWORK_CATALOG) {
    for (const platform of WEBSITE_PLATFORM_CATALOG) {
      for (const manager of managers) {
        for (const generateCi of [true, false]) {
          for (const allowRemote of [true, false]) {
            const result = planWebsiteStackSetup({
              frameworkId: framework.id,
              platformId: platform.id,
              packageManager: manager,
              environments: ENVIRONMENTS,
              probe: EMPTY_PROBE,
              generateCi,
              allowRemoteProjectCreation: allowRemote,
            });
            if (result.ok) {
              steps.push(...result.plan.steps);
            }
          }
        }
      }
    }
  }
  return steps;
}

describe('websiteStackSetup', () => {
  describe('the no-shell guarantee', () => {
    // Walked exhaustively rather than sampled, the way lensDatabaseDialect walks
    // ALL_STATEMENTS: the claim is "no producible plan runs a shell", and only
    // enumerating every producible plan can support it.
    it('no producible step carries a shell metacharacter', () => {
      const steps = everyProducibleStep();
      expect(steps.length).toBeGreaterThan(50);

      for (const step of steps) {
        if (step.command) {
          expect(step.command, `command in step ${step.id}`).not.toMatch(/[;&|`$(){}<>\n\r]/);
        }
        for (const arg of step.args ?? []) {
          expect(arg, `arg in step ${step.id}`).not.toMatch(/[;&|`$(){}<>\n\r]/);
        }
      }
    });

    it('no producible step names a shell or a downloader as its command', () => {
      const forbidden = ['sh', 'bash', 'zsh', 'cmd', 'cmd.exe', 'powershell', 'pwsh', 'curl', 'wget'];
      for (const step of everyProducibleStep()) {
        if (step.command) {
          expect(forbidden).not.toContain(step.command.toLowerCase());
        }
      }
    });

    it('no producible step writes outside the workspace', () => {
      for (const step of everyProducibleStep()) {
        if (step.filePath) {
          expect(validateSetupPath(step.filePath), `path in step ${step.id}`).toBeUndefined();
        }
      }
    });
  });

  describe('validateStep', () => {
    it('refuses metacharacters in a command or an argument', () => {
      expect(validateStep({ id: 'x', kind: 'scaffold', purpose: '', command: 'npm; rm', args: [] })).toBeDefined();
      expect(validateStep({ id: 'x', kind: 'scaffold', purpose: '', command: 'npm', args: ['install && echo'] })).toBeDefined();
      expect(validateStep({ id: 'x', kind: 'scaffold', purpose: '', command: 'npm', args: ['install'] })).toBeUndefined();
    });

    it('refuses a traversal or absolute file path', () => {
      expect(validateSetupPath('../outside.txt')).toBeDefined();
      expect(validateSetupPath('/etc/passwd')).toBeDefined();
      expect(validateSetupPath('C:/Windows/x')).toBeDefined();
      expect(validateSetupPath('a\\b')).toBeDefined();
      expect(validateSetupPath('src/config.json')).toBeUndefined();
    });
  });

  describe('planning', () => {
    it('plans a scaffold, a config file and branches for a fresh Astro project', () => {
      const result = plan('astro', 'cloudflare-pages');
      expect(result.ok).toBe(true);
      if (!result.ok) { return; }
      const kinds = result.plan.steps.map(step => step.kind);
      expect(kinds).toContain('scaffold');
      expect(kinds).toContain('config-file');
      expect(kinds).toContain('branches');
      const config = result.plan.steps.find(step => step.filePath === 'wrangler.toml');
      expect(config?.contents).toContain('pages_build_output_dir = "dist"');
    });

    it('skips the scaffold when a package.json already exists, and says why', () => {
      // Running a create command over an existing project overwrites it.
      const result = plan('astro', 'cloudflare-pages', {
        probe: { ...EMPTY_PROBE, hasPackageJson: true, existingPaths: ['package.json'] },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) { return; }
      expect(result.plan.steps.some(step => step.kind === 'scaffold')).toBe(false);
      expect(result.plan.caveats.join(' ')).toContain('already has a package.json');
    });

    it('offers no scaffold command for a framework it has not verified one for', () => {
      const result = plan('custom', 'cloudflare-pages');
      expect(result.ok).toBe(true);
      if (!result.ok) { return; }
      expect(result.plan.steps.some(step => step.kind === 'scaffold')).toBe(false);
      expect(result.plan.caveats.join(' ')).toContain('no verified setup command');
    });

    it('marks every file and branch step create-only', () => {
      const result = plan('astro', 'netlify');
      expect(result.ok).toBe(true);
      if (!result.ok) { return; }
      for (const step of result.plan.steps) {
        if (step.filePath || step.kind === 'branches') {
          expect(step.createOnly, `step ${step.id}`).toBe(true);
        }
      }
    });

    it('reports an existing config file as untouched rather than planning to merge it', () => {
      const result = plan('astro', 'netlify', {
        probe: { ...EMPTY_PROBE, existingPaths: ['netlify.toml'] },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) { return; }
      expect(result.plan.caveats.join(' ')).toContain('netlify.toml already exists');
    });

    it('creates only the branches that are missing', () => {
      const result = plan('astro', 'netlify', {
        probe: { ...EMPTY_PROBE, existingBranches: ['develop', 'main'] },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) { return; }
      const branches = result.plan.steps.find(step => step.kind === 'branches');
      expect(branches?.args).toEqual(['branch', 'staging']);
    });

    it('never checks out, pushes or forces a branch', () => {
      for (const step of everyProducibleStep()) {
        if (step.command === 'git') {
          expect(step.args?.[0]).toBe('branch');
          expect(step.args).not.toContain('--force');
          expect(step.args).not.toContain('-f');
        }
      }
    });

    it('writes only variable names into .env.example, never a value', () => {
      const withReference: WebsiteHostingEnvironment[] = ENVIRONMENTS.map(environment =>
        environment.id === 'staging'
          ? { ...environment, credentialReference: 'SecretStorage:website.staging.password' }
          : environment);
      const result = plan('astro', 'netlify', { environments: withReference });
      expect(result.ok).toBe(true);
      if (!result.ok) { return; }
      const env = result.plan.steps.find(step => step.filePath === '.env.example');
      expect(env?.contents).toContain('SITE_URL_STAGING=');
      // The reference is a pointer, not a secret; the value never appears.
      expect(env?.contents).toContain('SecretStorage:website.staging.password');
      expect(env?.contents).toMatch(/SITE_URL_STAGING=\s*$/m);
    });
  });

  describe('remote project creation', () => {
    it('is manual by default', () => {
      const result = plan('astro', 'cloudflare-pages');
      expect(result.ok).toBe(true);
      if (!result.ok) { return; }
      const remote = result.plan.steps.find(step => step.id === 'remote-project');
      expect(remote?.manualOnly).toBe(true);
      expect(remote?.purpose).toContain('AtlasMind will not');
    });

    it('becomes runnable only when explicitly allowed', () => {
      const result = plan('astro', 'cloudflare-pages', { allowRemoteProjectCreation: true });
      expect(result.ok).toBe(true);
      if (!result.ok) { return; }
      expect(result.plan.steps.find(step => step.id === 'remote-project')?.manualOnly).toBeFalsy();
    });
  });

  describe('CI gating', () => {
    it('plans no workflow when CI generation is off, and says so', () => {
      const result = plan('astro', 'cloudflare-pages', { generateCi: false });
      expect(result.ok).toBe(true);
      if (!result.ok) { return; }
      expect(result.plan.steps.some(step => step.kind === 'ci')).toBe(false);
      expect(result.plan.caveats.join(' ')).toContain('CI generation is off');
    });

    it('plans a workflow and names the secrets when it is on', () => {
      const result = plan('astro', 'cloudflare-pages', { generateCi: true });
      expect(result.ok).toBe(true);
      if (!result.ok) { return; }
      const ci = result.plan.steps.find(step => step.kind === 'ci');
      expect(ci?.filePath).toBe('.github/workflows/website-deploy.yml');
      expect(result.plan.requiredSecrets.map(secret => secret.name)).toContain('CLOUDFLARE_API_TOKEN');
    });
  });

  describe('execution', () => {
    function writer() {
      const written = new Map<string, string>();
      const writeFileIfAbsent = vi.fn(async (absolutePath: string, contents: string) => {
        const relation = path.relative(ROOT, absolutePath);
        if (relation.startsWith('..') || path.isAbsolute(relation)) {
          throw new Error(`ESCAPED THE WORKSPACE: ${absolutePath}`);
        }
        if (written.has(relation)) {
          return 'exists' as const;
        }
        written.set(relation, contents);
        return 'written' as const;
      });
      return { writeFileIfAbsent, written };
    }

    const noopMerge = vi.fn(async () => 'written' as const);

    it('never hands the writer a path outside the workspace', async () => {
      const built = plan('astro', 'cloudflare-pages');
      expect(built.ok).toBe(true);
      if (!built.ok) { return; }
      const { writeFileIfAbsent } = writer();

      const result = await executeWebsiteStackSetup({
        plan: built.plan,
        workspaceRoot: ROOT,
        exec: async () => undefined,
        writeFileIfAbsent,
        mergePackageScripts: noopMerge,
      });

      expect(result.completed).toBe(true);
      for (const call of writeFileIfAbsent.mock.calls) {
        expect(path.relative(ROOT, call[0] as string).startsWith('..')).toBe(false);
      }
    });

    it('never executes a manual-only step', async () => {
      const built = plan('astro', 'cloudflare-pages');
      expect(built.ok).toBe(true);
      if (!built.ok) { return; }
      const exec = vi.fn(async () => undefined);

      const result = await executeWebsiteStackSetup({
        plan: built.plan,
        workspaceRoot: ROOT,
        exec,
        writeFileIfAbsent: writer().writeFileIfAbsent,
        mergePackageScripts: noopMerge,
      });

      const manualIds = built.plan.steps.filter(step => step.manualOnly).map(step => step.id);
      for (const id of manualIds) {
        expect(result.results.find(item => item.stepId === id)?.outcome).toBe('manual');
      }
      // `remote-project` is manual by default, so its command must never run.
      const executed = exec.mock.calls.map(call => `${call[0]} ${(call[1] as string[]).join(' ')}`);
      expect(executed.some(line => line.includes('pages project create'))).toBe(false);
    });

    it('reports an existing file as skipped rather than overwriting it', async () => {
      const built = plan('astro', 'netlify');
      expect(built.ok).toBe(true);
      if (!built.ok) { return; }

      const writeFileIfAbsent = vi.fn(async (absolutePath: string) =>
        absolutePath.endsWith('netlify.toml') ? 'exists' as const : 'written' as const);

      const result = await executeWebsiteStackSetup({
        plan: built.plan,
        workspaceRoot: ROOT,
        exec: async () => undefined,
        writeFileIfAbsent,
        mergePackageScripts: noopMerge,
      });

      const skipped = result.results.find(item => item.detail?.includes('netlify.toml'));
      expect(skipped?.outcome).toBe('skipped-exists');
    });

    it('stops at the first failure and reports what had already succeeded', async () => {
      const built = plan('astro', 'cloudflare-pages');
      expect(built.ok).toBe(true);
      if (!built.ok) { return; }

      const result = await executeWebsiteStackSetup({
        plan: built.plan,
        workspaceRoot: ROOT,
        exec: async () => { throw new Error('npm exploded'); },
        writeFileIfAbsent: writer().writeFileIfAbsent,
        mergePackageScripts: noopMerge,
      });

      expect(result.completed).toBe(false);
      expect(result.results.some(item => item.outcome === 'failed')).toBe(true);
      expect(describeStackSetupRun(result)).toContain('npm exploded');
    });
  });

  describe('describeStackSetupRun', () => {
    it('names every non-ideal outcome rather than reporting a bare count', () => {
      const message = describeStackSetupRun({
        completed: true,
        results: [
          { stepId: 'a', outcome: 'applied' },
          { stepId: 'b', outcome: 'skipped-exists' },
          { stepId: 'c', outcome: 'manual' },
        ],
      });
      expect(message).toContain('Applied 1 step');
      expect(message).toContain('already present');
      expect(message).toContain('need running by you');
    });
  });
});
