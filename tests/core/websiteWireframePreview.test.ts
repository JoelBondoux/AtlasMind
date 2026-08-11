import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  KINDS_WITH_PLACEHOLDER_SHAPE,
  WIREFRAME_INDEX_PATH,
  previewPathFor,
  renderWireframeIndex,
  renderWireframePreview,
} from '../../src/core/websiteWireframePreview.js';
import { WIREFRAME_KIND_CATALOG } from '../../src/core/websiteWireframe.js';
import { pagePath } from '../../src/core/websiteGeneration.js';
import type { WebsiteDesignSystem, WebsitePagePlan, WireframeElementKind } from '../../src/types.js';

const designSystem: WebsiteDesignSystem = {
  brandDirection: '', tone: '',
  primaryColor: '#2563eb', secondaryColor: '#0f172a', accentColor: '#14b8a6',
  headingFont: '', bodyFont: '', spacingScale: '', cornerStyle: '',
  accessibilityTarget: 'WCAG 2.2 AA', componentNotes: [],
};

function page(overrides: Partial<WebsitePagePlan> = {}): WebsitePagePlan {
  return {
    id: 'home', title: 'Home', slug: '/', purpose: '', template: 'Standard page',
    sections: [], wireframeNotes: '', designNotes: '',
    wireframeStatus: 'draft', designStatus: 'not-started',
    contentStatus: 'not-started', seoStatus: 'not-started',
    order: 0, designPrompt: '', links: [],
    ...overrides,
  };
}

function withElements(kinds: readonly WireframeElementKind[]): WebsitePagePlan {
  return page({
    wireframe: {
      breakpoint: 'desktop',
      elements: kinds.map((kind, index) => ({
        id: `e${index}`,
        kind,
        label: `${kind} block`,
        rect: { x: 0, y: index * 200, width: 1000, height: 180 },
        designPrompt: '',
        notes: '',
      })),
    },
  });
}

describe('websiteWireframePreview', () => {
  describe('the CSP contract', () => {
    // The preview server sends `default-src 'none'` with no script. Widening
    // that so a *wireframe* could render would weaken every generated page
    // served alongside it, so the render has to fit the existing policy.
    it('never emits a script tag, for any combination of kinds', () => {
      const allKinds = WIREFRAME_KIND_CATALOG.map(spec => spec.kind);
      const html = renderWireframePreview({ page: withElements(allKinds), designSystem });
      expect(html).not.toMatch(/<script/i);
      expect(renderWireframeIndex([page()], designSystem)).not.toMatch(/<script/i);
    });

    it('emits no inline event handler', () => {
      const html = renderWireframePreview({ page: withElements(['hero', 'cta', 'form']), designSystem });
      expect(html).not.toMatch(/\son(click|load|error|mouseover)=/i);
    });

    it('requests nothing off the page', () => {
      const html = renderWireframePreview({ page: withElements(['media', 'nav']), designSystem });
      // The SVG namespace is the only permitted absolute URL.
      expect(html.replace(/xmlns="[^"]*"/g, '')).not.toMatch(/https?:\/\//i);
      expect(html).not.toMatch(/@import|url\(\s*['"]?https?:/i);
    });
  });

  describe('placeholders are obviously placeholders', () => {
    // Filler that reads as finished is filler somebody signs off.
    it('never emits lorem ipsum or invented prose', () => {
      const html = renderWireframePreview({ page: withElements(['text', 'hero']), designSystem });
      expect(html).not.toMatch(/lorem ipsum/i);
      expect(html).not.toMatch(/dolor sit amet/i);
    });

    it('hatches every block so it reads as unfinished at a glance', () => {
      const html = renderWireframePreview({ page: withElements(['section']), designSystem });
      expect(html).toContain('repeating-linear-gradient');
      expect(html).toContain('border: 1.5px dashed');
    });

    it('says outright that nothing on the page is real content', () => {
      const html = renderWireframePreview({ page: withElements(['hero']), designSystem });
      expect(html).toContain('nothing here is real content');
    });

    it('gives each distinctive kind its own placeholder shape', () => {
      for (const kind of KINDS_WITH_PLACEHOLDER_SHAPE) {
        const html = renderWireframePreview({ page: withElements([kind]), designSystem });
        const hasShape = /wf-(navrow|media|lines|cta|form)/.test(html);
        expect(hasShape, `${kind} should render a placeholder shape`).toBe(true);
      }
    });

    it('shows real page names in a nav rather than invented ones', () => {
      // Page titles are a fact from the sitemap, not filler.
      const home = withElements(['nav']);
      const about = page({ id: 'about', title: 'About', slug: '/about' });
      const html = renderWireframePreview({ page: home, designSystem, siblings: [home, about] });
      expect(html).toContain('>About<');
    });
  });

  describe('geometry', () => {
    it('positions blocks as percentages of the same 1000-unit grid the canvas uses', () => {
      const html = renderWireframePreview({
        page: page({
          wireframe: {
            breakpoint: 'desktop',
            elements: [{
              id: 'half', kind: 'section', label: 'Half',
              rect: { x: 500, y: 0, width: 500, height: 100 },
              designPrompt: '', notes: '',
            }],
          },
        }),
        designSystem,
      });
      expect(html).toContain('left:50.000%');
      expect(html).toContain('width:50.000%');
    });

    it('is deterministic', () => {
      const subject = withElements(['nav', 'hero', 'footer']);
      expect(renderWireframePreview({ page: subject, designSystem }))
        .toBe(renderWireframePreview({ page: subject, designSystem }));
    });

    it('never throws, for any wireframe the sanitizer could produce', () => {
      fc.assert(fc.property(
        fc.array(fc.record({
          kind: fc.constantFrom(...WIREFRAME_KIND_CATALOG.map(spec => spec.kind)),
          label: fc.string(),
          x: fc.double({ min: 0, max: 1000, noNaN: true }),
          y: fc.double({ min: 0, max: 4000, noNaN: true }),
          width: fc.double({ min: 1, max: 1000, noNaN: true }),
          height: fc.double({ min: 1, max: 1000, noNaN: true }),
        }), { maxLength: 20 }),
        elements => {
          const subject = page({
            wireframe: {
              breakpoint: 'desktop',
              elements: elements.map((element, index) => ({
                id: `e${index}`,
                kind: element.kind,
                label: element.label,
                rect: { x: element.x, y: element.y, width: element.width, height: element.height },
                designPrompt: '',
                notes: '',
              })),
            },
          });
          const html = renderWireframePreview({ page: subject, designSystem });
          return typeof html === 'string' && !/<script/i.test(html);
        },
      ), { numRuns: 150 });
    });
  });

  describe('escaping', () => {
    it('escapes a hostile label rather than rendering it', () => {
      const html = renderWireframePreview({
        page: withElements(['section']),
        designSystem: { ...designSystem, primaryColor: '#2563eb' },
        siteName: '<img src=x onerror=alert(1)>',
      });
      expect(html).not.toContain('<img src=x');
      expect(html).toContain('&lt;img src=x');
    });

    it('falls back rather than interpolating a colour that is not one', () => {
      // The value reaches a stylesheet; anything not obviously a colour is
      // replaced rather than escaped and hoped for.
      const html = renderWireframePreview({
        page: withElements(['hero']),
        designSystem: { ...designSystem, primaryColor: 'red; } body { display:none } .x {' },
      });
      expect(html).not.toContain('display:none');
      expect(html).toContain('--accent: #2563eb');
    });

    it('renders exact Markdown copy inertly and makes content gaps conspicuous', () => {
      const html = renderWireframePreview({
        page: withElements(['hero', 'text']),
        designSystem,
        content: {
          pageId: 'home', filePath: 'content/index.md', title: 'Home', metaDescription: '',
          status: 'review', body: '# Real heading\n\nExact client copy.\n\n[PLACEHOLDER: proof point]\n\n<img src=x onerror=alert(1)>',
          placeholders: [{ need: 'proof point', line: 5 }], missing: false, extraFrontMatter: {},
        },
      });
      expect(html).toContain('Real heading');
      expect(html).toContain('Exact client copy.');
      expect(html).toContain('<span class="content-gap">Gap: proof point</span>');
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(html).not.toContain('<img src=x');
      expect(html).toContain('Content proof');
    });

    it('applies safe font tokens and refuses stylesheet injection through them', () => {
      const html = renderWireframePreview({
        page: withElements(['hero']),
        designSystem: {
          ...designSystem,
          headingFont: 'Georgia, serif',
          bodyFont: 'Arial; } body { display:none',
        },
      });
      expect(html).toContain('--heading-font: Georgia, serif');
      expect(html).toContain('--body-font: ui-sans-serif, system-ui, sans-serif');
      expect(html).not.toContain('display:none');
    });
  });

  describe('an undrawn page', () => {
    it('explains itself instead of rendering an empty frame', () => {
      const html = renderWireframePreview({ page: page(), designSystem });
      expect(html).toContain('has not been drawn yet');
      expect(html).toContain('no model is involved');
    });

    it('is marked as undrawn in the index', () => {
      const html = renderWireframeIndex([page()], designSystem);
      expect(html).toContain('not drawn yet');
      expect(html).toContain('href="home.html"');
      expect(html).not.toContain('href="_wireframe/home.html"');
    });

    it('keeps model-generated output separate and one click away', () => {
      const html = renderWireframeIndex([page()], designSystem, 'Northstar', { generatedAvailable: true });
      expect(html).toContain('Live design previews');
      expect(html).toContain('href="../index.html"');
      expect(html).toContain('kept separate from the live Studio draft');
    });
  });

  describe('paths', () => {
    // A wireframe render must never sit where a generated page will go: sharing
    // an address means either a blocked Generate or a silent replacement, and in
    // both cases somebody looks at the wrong thing.
    it('never collides with a generated page path', () => {
      for (const slug of ['/', '/about', '/services/seo']) {
        const subject = page({ slug });
        expect(previewPathFor(subject)).not.toBe(pagePath(subject));
        expect(previewPathFor(subject).startsWith('_wireframe/')).toBe(true);
      }
    });

    it('flattens nested slugs into one folder', () => {
      expect(previewPathFor(page({ slug: '/services/seo' }))).toBe('_wireframe/services-seo.html');
      expect(previewPathFor(page({ slug: '/' }))).toBe('_wireframe/home.html');
      expect(WIREFRAME_INDEX_PATH).toBe('_wireframe/index.html');
      expect(previewPathFor(page({ slug: '/' }))).not.toBe(WIREFRAME_INDEX_PATH);
    });
  });
});
