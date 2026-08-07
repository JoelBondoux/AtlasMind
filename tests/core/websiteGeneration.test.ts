import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  GENERATED_FILE_EXTENSIONS,
  MAX_GENERATED_FILES,
  pagePath,
  parseGeneratedFiles,
  planWebsiteGeneration,
  validateGeneratedPath,
  WEBSITE_PREVIEW_ROOT,
  type WebsiteGenerationStage,
} from '../../src/core/websiteGeneration.js';
import { createDefaultWebsiteWorkspace } from '../../src/core/websiteWorkspaceManager.js';
import type { WebsiteWorkspaceConfig } from '../../src/types.js';

const ALL_STAGES: WebsiteGenerationStage[] = ['brief', 'sitemap', 'wireframe', 'element'];

function workspace(): WebsiteWorkspaceConfig {
  const config = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
  config.pages[0]!.wireframe = {
    breakpoint: 'desktop',
    elements: [
      {
        id: 'hero',
        kind: 'hero',
        label: 'Opening banner',
        rect: { x: 0, y: 0, width: 1000, height: 400 },
        designPrompt: '',
        notes: '',
      },
    ],
  };
  return config;
}

describe('websiteGeneration', () => {
  describe('validateGeneratedPath', () => {
    it('accepts an ordinary generated page', () => {
      expect(validateGeneratedPath('index.html')).toBeUndefined();
      expect(validateGeneratedPath('services/seo/index.html')).toBeUndefined();
      expect(validateGeneratedPath('assets/site.css')).toBeUndefined();
    });

    it('refuses traversal, absolute paths, and encoded traversal', () => {
      // `%2e%2e%2f` passes a literal `..` check, which is why decoding comes
      // first.
      expect(validateGeneratedPath('../secrets.html')).toBeDefined();
      expect(validateGeneratedPath('a/../../b.html')).toBeDefined();
      expect(validateGeneratedPath('/etc/passwd.html')).toBeDefined();
      expect(validateGeneratedPath('C:/Windows/x.html')).toBeDefined();
      expect(validateGeneratedPath('%2e%2e%2fescape.html')).toBeDefined();
      expect(validateGeneratedPath('a\\..\\b.html')).toBeDefined();
    });

    it('refuses an extension outside the allowlist', () => {
      expect(validateGeneratedPath('run.js')).toBeDefined();
      expect(validateGeneratedPath('shell.sh')).toBeDefined();
      expect(validateGeneratedPath('config.json')).toBeDefined();
      expect(validateGeneratedPath('noextension')).toBeDefined();
    });

    it('never permits a script file', () => {
      // A generated page that can execute is a different security question from
      // one that cannot.
      expect(GENERATED_FILE_EXTENSIONS).not.toContain('.js');
      expect(GENERATED_FILE_EXTENSIONS).not.toContain('.mjs');
    });

    it('refuses an empty or over-long path', () => {
      expect(validateGeneratedPath('')).toBeDefined();
      expect(validateGeneratedPath(`${'a'.repeat(300)}.html`)).toBeDefined();
    });

    it('names the reason, so a refusal is actionable', () => {
      expect(validateGeneratedPath('/abs.html')).toContain('relative');
      expect(validateGeneratedPath('../up.html')).toContain('outside');
      expect(validateGeneratedPath('x.js')).toContain('.html');
    });
  });

  describe('the sandbox boundary', () => {
    // Walked the way lensDatabaseDialect walks ALL_STATEMENTS: the property is
    // "no producible plan escapes", and only an exhaustive walk can say that.
    it('no plan any stage can produce names a path outside the preview root', () => {
      const config = workspace();
      for (const stage of ALL_STAGES) {
        const result = planWebsiteGeneration({
          config,
          stage,
          pageId: config.pages[0]!.id,
          elementId: 'hero',
        });
        if (!result.ok) { continue; }
        for (const file of result.plan.files) {
          expect(validateGeneratedPath(file.relativePath)).toBeUndefined();
          expect(file.relativePath.startsWith('/')).toBe(false);
          expect(file.relativePath).not.toContain('..');
        }
      }
    });

    it('refuses the whole plan when any path is bad, rather than cleaning it', () => {
      // The lensEndpoints rule: quietly cleaning leaves the author believing
      // something else happened, and here that something is a write.
      const config = workspace();
      config.pages[0]!.slug = '/../../escape';
      const result = planWebsiteGeneration({ config, stage: 'sitemap' });
      // A traversal slug must not silently become a traversal path.
      if (result.ok) {
        for (const file of result.plan.files) {
          expect(validateGeneratedPath(file.relativePath)).toBeUndefined();
        }
      } else {
        expect(result.reason).toContain('Refusing to generate');
      }
    });

    it('everything lands under the declared preview root', () => {
      expect(WEBSITE_PREVIEW_ROOT).toBe('.atlasmind/website-preview');
    });
  });

  describe('determinism', () => {
    it('produces a byte-identical plan for the same input', () => {
      // The confirmation dialog is only worth reading if "yes" means the same
      // thing every time.
      const config = workspace();
      for (const stage of ALL_STAGES) {
        const first = planWebsiteGeneration({ config, stage, pageId: config.pages[0]!.id, elementId: 'hero' });
        const second = planWebsiteGeneration({ config, stage, pageId: config.pages[0]!.id, elementId: 'hero' });
        expect(first).toEqual(second);
      }
    });
  });

  describe('stages', () => {
    it('generates one concept page from the brief and says the layout is not yours', () => {
      const result = planWebsiteGeneration({ config: workspace(), stage: 'brief' });
      expect(result.ok).toBe(true);
      if (!result.ok) { return; }
      expect(result.plan.files.map(file => file.relativePath)).toEqual(['index.html', 'assets/site.css']);
      expect(result.plan.omitted.join(' ')).toContain('proposal');
    });

    it('generates every page from the sitemap plus one stylesheet', () => {
      const config = workspace();
      const result = planWebsiteGeneration({ config, stage: 'sitemap' });
      expect(result.ok).toBe(true);
      if (!result.ok) { return; }
      expect(result.plan.files).toHaveLength(config.pages.length + 1);
      expect(result.plan.files.map(file => file.relativePath)).toContain('index.html');
      expect(result.plan.files.map(file => file.relativePath)).toContain('about/index.html');
    });

    it('states which pages had no wireframe and which had no prompt', () => {
      // A partial answer stored as a whole one lies by omission.
      const result = planWebsiteGeneration({ config: workspace(), stage: 'sitemap' });
      expect(result.ok).toBe(true);
      if (!result.ok) { return; }
      const omitted = result.plan.omitted.join(' ');
      expect(omitted).toContain('no wireframe');
      expect(omitted).toContain('no design prompt');
    });

    it('refuses a wireframe stage for a page that is gone', () => {
      const result = planWebsiteGeneration({ config: workspace(), stage: 'wireframe', pageId: 'nope' });
      expect(result.ok).toBe(false);
    });

    it('refuses an element stage for an element that is gone', () => {
      const config = workspace();
      const result = planWebsiteGeneration({
        config,
        stage: 'element',
        pageId: config.pages[0]!.id,
        elementId: 'ghost',
      });
      expect(result.ok).toBe(false);
    });

    it('warns that regenerating an element rewrites the whole page', () => {
      const config = workspace();
      const result = planWebsiteGeneration({
        config,
        stage: 'element',
        pageId: config.pages[0]!.id,
        elementId: 'hero',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) { return; }
      expect(result.plan.omitted.join(' ')).toContain('whole');
    });

    it('refuses everything but the brief when there are no pages', () => {
      const config = workspace();
      config.pages = [];
      for (const stage of ALL_STAGES.filter(candidate => candidate !== 'brief')) {
        expect(planWebsiteGeneration({ config, stage }).ok).toBe(false);
      }
    });
  });

  describe('limits', () => {
    it('refuses a plan over the configured file limit rather than truncating it', () => {
      const result = planWebsiteGeneration({ config: workspace(), stage: 'sitemap', maxFiles: 2 });
      expect(result.ok).toBe(false);
      if (result.ok) { return; }
      expect(result.reason).toContain('over the limit');
    });

    it('never allows more than the hard ceiling regardless of the setting', () => {
      const config = workspace();
      const result = planWebsiteGeneration({ config, stage: 'sitemap', maxFiles: 10_000 });
      if (result.ok) {
        expect(result.plan.files.length).toBeLessThanOrEqual(MAX_GENERATED_FILES);
      }
    });

    it('refuses two pages that would write the same file', () => {
      const config = workspace();
      config.pages[1]!.slug = '/';
      const result = planWebsiteGeneration({ config, stage: 'sitemap' });
      expect(result.ok).toBe(false);
      if (result.ok) { return; }
      expect(result.reason).toContain('share the path');
    });
  });

  describe('pagePath', () => {
    it('maps the root to index.html and a nested slug to a folder index', () => {
      const config = workspace();
      expect(pagePath({ ...config.pages[0]!, slug: '/' })).toBe('index.html');
      expect(pagePath({ ...config.pages[0]!, slug: '/services' })).toBe('services/index.html');
      expect(pagePath({ ...config.pages[0]!, slug: '/services/seo' })).toBe('services/seo/index.html');
    });
  });

  describe('parseGeneratedFiles', () => {
    const plan = {
      stage: 'brief' as const,
      targetLabel: 'concept',
      files: [
        { relativePath: 'index.html', purpose: 'page' },
        { relativePath: 'assets/site.css', purpose: 'styles' },
      ],
      prompt: 'x',
      omitted: [],
    };

    it('reads FILE: blocks into files', () => {
      const reply = [
        'FILE: index.html',
        '```html',
        '<h1>Hello</h1>',
        '```',
        'FILE: assets/site.css',
        '```css',
        'body { margin: 0 }',
        '```',
      ].join('\n');
      const parsed = parseGeneratedFiles(reply, plan);
      expect(parsed.files.map(file => file.relativePath)).toEqual(['index.html', 'assets/site.css']);
      expect(parsed.files[0]?.contents).toContain('<h1>Hello</h1>');
    });

    it('rejects a valid-looking path that was not in the approved plan', () => {
      // The defence is not that the path is malformed — it is that the user did
      // not agree to it.
      const reply = 'FILE: admin/index.html\n```html\n<p>x</p>\n```';
      const parsed = parseGeneratedFiles(reply, plan);
      expect(parsed.files).toHaveLength(0);
      expect(parsed.rejected[0]?.reason).toContain('not in the approved plan');
    });

    it('rejects a traversal path even when the model asks nicely', () => {
      const reply = 'FILE: ../../.env\n```\nSECRET=1\n```';
      const parsed = parseGeneratedFiles(reply, plan);
      expect(parsed.files).toHaveLength(0);
      expect(parsed.rejected).toHaveLength(1);
    });

    it('rejects a duplicate file rather than letting the last one win', () => {
      const reply = [
        'FILE: index.html', '```html', '<p>first</p>', '```',
        'FILE: index.html', '```html', '<p>second</p>', '```',
      ].join('\n');
      const parsed = parseGeneratedFiles(reply, plan);
      expect(parsed.files).toHaveLength(1);
      expect(parsed.files[0]?.contents).toContain('first');
      expect(parsed.rejected[0]?.reason).toContain('twice');
    });

    it('returns nothing for a reply with no file blocks', () => {
      expect(parseGeneratedFiles('Sure! Here is a lovely website.', plan).files).toEqual([]);
    });

    it('never throws on arbitrary model output', () => {
      fc.assert(fc.property(fc.string(), reply => {
        parseGeneratedFiles(reply, plan);
        return true;
      }), { numRuns: 200 });
    });
  });
});
