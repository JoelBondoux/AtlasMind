import { describe, expect, it } from 'vitest';
import {
  buildCommandFor,
  describeStackCompatibility,
  devCommandFor,
  forPackageManager,
  frameworksRecommendedFor,
  isWebsiteFrameworkId,
  isWebsitePackageManager,
  renderCommandLine,
  WEBSITE_FRAMEWORK_CATALOG,
  WEBSITE_PACKAGE_MANAGERS,
  websiteFrameworkSpec,
} from '../../src/core/websiteFrameworks.js';
import { WEBSITE_PLATFORM_CATALOG } from '../../src/core/websiteWorkspaceManager.js';

describe('websiteFrameworks', () => {
  describe('the catalog is safe by construction', () => {
    it('carries no shell metacharacter in any command', () => {
      // A command in this file is executed via execFile. Anything that would
      // only matter to a shell has no business being here.
      for (const spec of WEBSITE_FRAMEWORK_CATALOG) {
        if (!spec.scaffold) { continue; }
        expect(spec.scaffold.command, spec.id).not.toMatch(/[;&|`$(){}<>\s]/);
        for (const arg of spec.scaffold.args) {
          expect(arg, `${spec.id}: ${arg}`).not.toMatch(/[;&|`$(){}<>\n]/);
        }
      }
    });

    it('never names a shell or a downloader as a scaffold command', () => {
      const forbidden = ['sh', 'bash', 'zsh', 'cmd', 'powershell', 'pwsh', 'curl', 'wget', 'iex'];
      for (const spec of WEBSITE_FRAMEWORK_CATALOG) {
        if (spec.scaffold) {
          expect(forbidden).not.toContain(spec.scaffold.command.toLowerCase());
        }
      }
    });

    it('never bakes a filesystem path into a scaffold argument', () => {
      // The planner appends the project directory after validating it, so a path
      // must never already be here. A scoped npm package name (`@11ty/eleventy`)
      // contains a slash and is not a path — the check is for traversal,
      // absolute paths and relative path prefixes, not for the character.
      for (const spec of WEBSITE_FRAMEWORK_CATALOG) {
        for (const arg of spec.scaffold?.args ?? []) {
          const label = `${spec.id}: ${arg}`;
          expect(arg, label).not.toContain('..');
          expect(arg.startsWith('/'), label).toBe(false);
          expect(arg.startsWith('./'), label).toBe(false);
          expect(arg, label).not.toMatch(/^[A-Za-z]:/);
          expect(arg, label).not.toContain('\\');
        }
      }
    });

    it('gives every framework a plain relative output directory', () => {
      for (const spec of WEBSITE_FRAMEWORK_CATALOG) {
        expect(spec.outputDir, spec.id).not.toContain('..');
        expect(spec.outputDir.startsWith('/'), spec.id).toBe(false);
        expect(spec.outputDir.length, spec.id).toBeGreaterThan(0);
      }
    });

    it('leaves the frameworks with no verified command without one', () => {
      // An improvised command that usually works is worse than an honest gap,
      // because the failure lands in somebody's repository.
      for (const id of ['static', 'custom', 'wordpress-theme'] as const) {
        expect(websiteFrameworkSpec(id).scaffold).toBeUndefined();
      }
    });

    it('gives every framework that cannot scaffold either a doc link or a plain description of the gap', () => {
      for (const spec of WEBSITE_FRAMEWORK_CATALOG) {
        if (!spec.scaffold) {
          expect(spec.description.length).toBeGreaterThan(20);
        }
      }
    });

    it('has unique ids and a custom fallback', () => {
      const ids = WEBSITE_FRAMEWORK_CATALOG.map(spec => spec.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toContain('custom');
    });
  });

  describe('lookup', () => {
    it('recognises catalog ids and nothing else', () => {
      expect(isWebsiteFrameworkId('astro')).toBe(true);
      expect(isWebsiteFrameworkId('jekyll')).toBe(false);
      expect(isWebsiteFrameworkId(undefined)).toBe(false);
    });

    it('degrades an unknown id to custom, which cannot scaffold', () => {
      // The safe direction: an unrecognised framework means "we will not run
      // anything for you".
      const spec = websiteFrameworkSpec('nonsense' as never);
      expect(spec.id).toBe('custom');
      expect(spec.scaffold).toBeUndefined();
    });
  });

  describe('compatibility', () => {
    it('grades every pairing and always gives a reason', () => {
      for (const spec of WEBSITE_FRAMEWORK_CATALOG) {
        for (const platform of WEBSITE_PLATFORM_CATALOG) {
          const verdict = describeStackCompatibility(spec.id, platform.id);
          expect(['ideal', 'workable', 'unsupported']).toContain(verdict.compatibility);
          expect(verdict.reason.length, `${spec.id} on ${platform.id}`).toBeGreaterThan(10);
        }
      }
    });

    it('calls Astro on Cloudflare Pages ideal', () => {
      expect(describeStackCompatibility('astro', 'cloudflare-pages').compatibility).toBe('ideal');
    });

    it('explains why a static generator cannot target Shopify', () => {
      const verdict = describeStackCompatibility('hugo', 'shopify');
      expect(verdict.compatibility).toBe('unsupported');
      expect(verdict.reason).toContain('Liquid');
    });

    it('treats a WordPress theme as ideal on WordPress and unsupported elsewhere', () => {
      expect(describeStackCompatibility('wordpress-theme', 'wordpress').compatibility).toBe('ideal');
      expect(describeStackCompatibility('wordpress-theme', 'cloudflare-pages').compatibility).toBe('unsupported');
    });

    it('warns that a server framework will not run as-is on GitHub Pages', () => {
      const verdict = describeStackCompatibility('nextjs', 'github-pages');
      expect(verdict.compatibility).toBe('unsupported');
      expect(verdict.reason).toContain('only serves pre-built files');
    });

    it('treats a custom platform as workable and says the deploy step is yours', () => {
      const verdict = describeStackCompatibility('astro', 'custom');
      expect(verdict.compatibility).toBe('workable');
      expect(verdict.reason).toContain('yours to describe');
    });

    it('recommends at least one framework for every code-first platform', () => {
      for (const platformId of ['cloudflare-pages', 'netlify', 'vercel', 'github-pages'] as const) {
        expect(frameworksRecommendedFor(platformId).length, platformId).toBeGreaterThan(0);
      }
    });
  });

  describe('package managers', () => {
    it('recognises the four it supports', () => {
      for (const manager of WEBSITE_PACKAGE_MANAGERS) {
        expect(isWebsitePackageManager(manager)).toBe(true);
      }
      expect(isWebsitePackageManager('cargo')).toBe(false);
    });

    it('swaps only the executable for a run command', () => {
      expect(forPackageManager(['run', 'build'], 'npm')).toEqual({ command: 'npm', args: ['run', 'build'] });
      expect(forPackageManager(['run', 'build'], 'pnpm')).toEqual({ command: 'pnpm', args: ['run', 'build'] });
      expect(forPackageManager(['run', 'build'], 'bun')).toEqual({ command: 'bun', args: ['run', 'build'] });
    });

    it('maps exec onto each manager\'s own runner', () => {
      expect(forPackageManager(['exec', 'eleventy'], 'bun').command).toBe('bunx');
      expect(forPackageManager(['exec', 'eleventy'], 'yarn')).toEqual({ command: 'yarn', args: ['eleventy'] });
    });

    it('passes flags through untouched', () => {
      expect(forPackageManager(['exec', 'eleventy', '--serve'], 'npm').args).toEqual(['exec', 'eleventy', '--serve']);
    });
  });

  describe('commands', () => {
    it('uses the maintained React Router generator for new Remix-style applications', () => {
      const scaffold = websiteFrameworkSpec('remix').scaffold;
      expect(scaffold).toMatchObject({ command: 'npx', args: ['create-react-router@latest'] });
      expect(scaffold?.args.join(' ')).not.toContain('remix@latest');
    });

    it('routes Hugo through its own binary rather than a package manager', () => {
      const spec = websiteFrameworkSpec('hugo');
      expect(devCommandFor(spec, 'npm')?.command).toBe('hugo');
    });

    it('returns nothing for a framework with no dev server or build', () => {
      const spec = websiteFrameworkSpec('static');
      expect(devCommandFor(spec, 'npm')).toBeUndefined();
      expect(buildCommandFor(spec, 'npm')).toBeUndefined();
    });

    it('builds a Hugo site by running hugo with no verb', () => {
      // Hugo's build *is* the bare binary, which is expressed as an empty
      // argument list rather than a missing field — the two mean different
      // things, and the CI template relies on the distinction to decide whether
      // to set Node up.
      expect(buildCommandFor(websiteFrameworkSpec('hugo'), 'npm')).toEqual({ command: 'hugo', args: [] });
    });

    it('renders a command line for display', () => {
      expect(renderCommandLine('npm', ['run', 'build'])).toBe('npm run build');
    });
  });
});
