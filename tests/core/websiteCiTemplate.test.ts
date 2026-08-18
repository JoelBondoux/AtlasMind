import { describe, expect, it } from 'vitest';
import {
  CI_WORKFLOW_DIR,
  findUnsubstitutedPlaceholder,
  renderWebsiteCiWorkflow,
  type CiTemplateInput,
} from '../../src/core/websiteCiTemplate.js';
import { WEBSITE_FRAMEWORK_CATALOG } from '../../src/core/websiteFrameworks.js';
import { WEBSITE_PLATFORM_CATALOG } from '../../src/core/websiteWorkspaceManager.js';
import type { WebsitePlatformId } from '../../src/types.js';

function input(overrides: Partial<CiTemplateInput> = {}): CiTemplateInput {
  return {
    frameworkId: 'astro',
    platformId: 'cloudflare-pages',
    packageManager: 'npm',
    developBranch: 'develop',
    stagingBranch: 'staging',
    productionBranch: 'main',
    nodeVersion: '22',
    ...overrides,
  };
}

/** Every pairing the picker can produce that yields a workflow. */
function everyRenderedWorkflow(): string[] {
  const rendered: string[] = [];
  for (const framework of WEBSITE_FRAMEWORK_CATALOG) {
    for (const platform of WEBSITE_PLATFORM_CATALOG) {
      for (const packageManager of ['npm', 'pnpm', 'yarn', 'bun'] as const) {
        const result = renderWebsiteCiWorkflow(input({
          frameworkId: framework.id,
          platformId: platform.id,
          packageManager,
        }));
        if (result.ok) {
          rendered.push(result.contents);
        }
      }
    }
  }
  return rendered;
}

describe('websiteCiTemplate', () => {
  describe('what every generated workflow must contain', () => {
    it('produces at least one workflow to check', () => {
      expect(everyRenderedWorkflow().length).toBeGreaterThan(10);
    });

    it('never leaves a template placeholder unsubstituted', () => {
      // A literal placeholder in a committed workflow is a broken pipeline that
      // looks like a working one.
      for (const contents of everyRenderedWorkflow()) {
        expect(findUnsubstitutedPlaceholder(contents)).toBeUndefined();
      }
    });

    it('declares an explicit permissions block rather than inheriting the repo default', () => {
      for (const contents of everyRenderedWorkflow()) {
        expect(contents).toMatch(/^permissions:$/m);
        expect(contents).toMatch(/^\s+contents: read$/m);
      }
    });

    it('gates production behind a GitHub Environment', () => {
      // AtlasMind's confirmation protects the moment the file is written; the
      // environment protects every run after that.
      for (const contents of everyRenderedWorkflow()) {
        expect(contents).toContain('environment:');
        expect(contents).toContain("'production'");
      }
    });

    it('serialises deploys per branch rather than cancelling them', () => {
      for (const contents of everyRenderedWorkflow()) {
        expect(contents).toContain('concurrency:');
        // A half-finished deploy is worse than a queued one.
        expect(contents).toContain('cancel-in-progress: false');
      }
    });

    it('names secrets and never carries a value', () => {
      for (const contents of everyRenderedWorkflow()) {
        const secretReferences = contents.match(/secrets\.[A-Z_]+/g) ?? [];
        for (const reference of secretReferences) {
          // Every secret must be an expression, never an inline assignment.
          const name = reference.split('.')[1]!;
          expect(contents).toContain(`\${{ secrets.${name} }}`);
          expect(contents).not.toMatch(new RegExp(`${name}\\s*[:=]\\s*["'][A-Za-z0-9]`));
        }
      }
    });

    it('pins every action to a major version', () => {
      for (const contents of everyRenderedWorkflow()) {
        for (const use of contents.match(/uses: \S+/g) ?? []) {
          expect(use, use).toMatch(/@v\d+/);
        }
      }
    });

    it('runs no shell metacharacter in a run: step', () => {
      for (const contents of everyRenderedWorkflow()) {
        for (const line of contents.split('\n')) {
          const run = /^\s*run:\s*(.+)$/.exec(line);
          if (run) {
            expect(run[1], run[1]).not.toMatch(/[;&|`]/);
          }
        }
      }
    });
  });

  describe('refusals', () => {
    it('refuses a platform it has no verified deploy action for, rather than guessing', () => {
      // A workflow that half-works still runs.
      for (const platformId of ['shopify', 'webflow', 'wordpress', 'custom'] as WebsitePlatformId[]) {
        const result = renderWebsiteCiWorkflow(input({ platformId }));
        expect(result.ok, platformId).toBe(false);
        if (!result.ok) {
          expect(result.reason).toContain('no verified deploy action');
        }
      }
    });

    it('refuses a branch name that is not a plain git ref', () => {
      for (const bad of ['main; rm -rf /', 'feature branch', '$(whoami)', '../escape', '']) {
        const result = renderWebsiteCiWorkflow(input({ productionBranch: bad }));
        expect(result.ok, bad).toBe(false);
      }
    });

    it('names which branch field was wrong', () => {
      const result = renderWebsiteCiWorkflow(input({ stagingBranch: 'bad name' }));
      expect(result.ok).toBe(false);
      if (result.ok) { return; }
      expect(result.reason).toContain('staging branch');
    });

    it('refuses a node version that is not a version number', () => {
      const result = renderWebsiteCiWorkflow(input({ nodeVersion: '20; curl evil' }));
      expect(result.ok).toBe(false);
    });
  });

  describe('framework-specific output', () => {
    it('uses the framework output directory in the deploy step', () => {
      const result = renderWebsiteCiWorkflow(input({ frameworkId: 'astro', platformId: 'cloudflare-pages' }));
      expect(result.ok).toBe(true);
      if (!result.ok) { return; }
      expect(result.contents).toContain('pages deploy dist');
    });

    it('sets Hugo up rather than Node for a Hugo site', () => {
      const result = renderWebsiteCiWorkflow(input({ frameworkId: 'hugo', platformId: 'netlify' }));
      expect(result.ok).toBe(true);
      if (!result.ok) { return; }
      expect(result.contents).toContain('actions-hugo');
      expect(result.contents).not.toContain('setup-node');
    });

    it('says plainly when there is no build step', () => {
      const result = renderWebsiteCiWorkflow(input({ frameworkId: 'static', platformId: 'netlify' }));
      expect(result.ok).toBe(true);
      if (!result.ok) { return; }
      expect(result.contents).toContain('No build step');
      expect(result.caveats.join(' ')).toContain('no build step');
    });

    it('uses the chosen package manager to install', () => {
      const result = renderWebsiteCiWorkflow(input({ packageManager: 'pnpm' }));
      expect(result.ok).toBe(true);
      if (!result.ok) { return; }
      expect(result.contents).toContain('pnpm install --frozen-lockfile');
    });

    it('warns that Next.js deploys .next rather than a static export', () => {
      const result = renderWebsiteCiWorkflow(input({ frameworkId: 'nextjs', platformId: 'vercel' }));
      expect(result.ok).toBe(true);
      if (!result.ok) { return; }
      expect(result.caveats.join(' ')).toContain('static export');
    });
  });

  describe('caveats', () => {
    it('always states that no tests run before the deploy', () => {
      const result = renderWebsiteCiWorkflow(input());
      expect(result.ok).toBe(true);
      if (!result.ok) { return; }
      expect(result.caveats.join(' ')).toContain('No tests run before the deploy');
    });

    it('states that production is only gated if reviewers are added', () => {
      const result = renderWebsiteCiWorkflow(input());
      expect(result.ok).toBe(true);
      if (!result.ok) { return; }
      expect(result.caveats.join(' ')).toContain('required reviewers');
    });
  });

  describe('findUnsubstitutedPlaceholder', () => {
    it('finds a leftover template placeholder', () => {
      expect(findUnsubstitutedPlaceholder('name: {{ projectName }}')).toBeDefined();
    });

    it('does not mistake GitHub Actions expression syntax for one', () => {
      // Conflating the two would reject every valid workflow.
      expect(findUnsubstitutedPlaceholder('token: ${{ secrets.TOKEN }}')).toBeUndefined();
      expect(findUnsubstitutedPlaceholder('group: website-deploy-${{ github.ref }}')).toBeUndefined();
    });
  });

  it('writes into the workflows directory under its own filename', () => {
    const result = renderWebsiteCiWorkflow(input());
    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(result.filePath.startsWith(CI_WORKFLOW_DIR)).toBe(true);
    expect(result.filePath).toBe('.github/workflows/website-deploy.yml');
  });
});
