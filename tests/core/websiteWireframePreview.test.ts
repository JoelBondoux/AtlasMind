import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  KINDS_WITH_PLACEHOLDER_SHAPE,
  UI_PREVIEW_MOBILE_MAX_WIDTH,
  UI_PREVIEW_TABLET_MAX_WIDTH,
  WIREFRAME_INDEX_PATH,
  previewPathFor,
  renderWireframeIndex,
  renderWireframePreview,
} from '../../src/core/websiteWireframePreview.js';
import { WIREFRAME_KIND_CATALOG } from '../../src/core/websiteWireframe.js';
import { pagePath } from '../../src/core/websiteGeneration.js';
import { designGraphFromPages } from '../../src/core/uiDesignGraph.js';
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

    it('marks every block with graph identity for full-preview selection', () => {
      const html = renderWireframePreview({ page: withElements(['hero', 'cta']), designSystem });
      expect(html).toContain('data-atlas-screen-id="home"');
      expect(html).toContain('data-atlas-node-id="e0"');
      expect(html).toContain('data-atlas-node-id="e1"');
      expect(html).toContain('[data-atlas-preview-selected]');
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

    it('projects inherited tablet and mobile layouts through static media rules', () => {
      const subject = withElements(['hero', 'cta']);
      const graph = designGraphFromPages([subject]);
      const screen = graph.screens[0]!;
      screen.nodes[0]!.viewportOverrides.tablet = {
        rect: { x: 100, y: 40, width: 800, height: 240 },
      };
      screen.nodes[0]!.viewportOverrides.mobile = { hidden: true };
      screen.nodes[1]!.viewportOverrides.mobile = {
        rect: { x: 80, y: 100, width: 840, height: 120 },
      };

      const html = renderWireframePreview({ page: subject, designSystem, responsiveScreen: screen });
      expect(html).toContain('<style data-atlas-responsive-layout>');
      expect(html).toContain(`@media (max-width: ${UI_PREVIEW_TABLET_MAX_WIDTH}px)`);
      expect(html).toContain(`@media (max-width: ${UI_PREVIEW_MOBILE_MAX_WIDTH}px)`);
      expect(html).toContain('.wf-block[data-atlas-screen-id="home"][data-atlas-node-id="e0"]');
      expect(html).toContain('left:10.000% !important');
      expect(html).toContain('display:none !important');
      expect(html).toContain('left:8.000% !important');
      expect(html).not.toContain('<script');
    });

    it('uses the same deterministic container projection for base and responsive preview', () => {
      const subject = withElements(['section', 'text', 'text']);
      subject.wireframe!.elements[0]!.rect = { x: 0, y: 0, width: 1_000, height: 420 };
      subject.wireframe!.elements[1]!.parentId = 'e0';
      subject.wireframe!.elements[2]!.parentId = 'e0';
      const screen = designGraphFromPages([subject]).screens[0]!;
      Object.assign(screen.nodes[0]!.layout, {
        mode: 'grid', columns: 2, padding: 20, gap: 20, align: 'stretch', direction: 'horizontal',
      });
      screen.nodes[1]!.layout.widthMode = 'fill';
      screen.nodes[2]!.layout.widthMode = 'fill';
      screen.nodes[1]!.layout.maxWidth = 300;
      screen.nodes[2]!.layout.minHeight = 220;
      screen.nodes[0]!.viewportOverrides.mobile = { mode: 'stack', direction: 'vertical', gap: 8 };

      const html = renderWireframePreview({ page: subject, designSystem, responsiveScreen: screen });
      expect(html).toContain('data-atlas-node-id="e1" style="left:2.000%');
      expect(html).toContain('data-atlas-node-id="e2" style="left:51.000%');
      expect(html).toContain('width:30.000%');
      expect(html).toContain('height:36.667%');
      expect(html).toContain('@media (max-width: 599px)');
      expect(html).toContain('left:2.000% !important');
      expect(html).toContain('width:96.000% !important');
      expect(screen.nodes[1]!.layout.rect.x).toBe(0);
    });

    it('renders ordered wrapped stack lines through the shared full-preview projection', () => {
      const subject = withElements(['section', 'text', 'text']);
      subject.wireframe!.elements[0]!.rect = { x: 0, y: 0, width: 1_000, height: 500 };
      for (const child of subject.wireframe!.elements.slice(1)) {
        child.parentId = 'e0';
        child.rect = { ...child.rect, width: 600, height: 100 };
      }
      const screen = designGraphFromPages([subject]).screens[0]!;
      Object.assign(screen.nodes[0]!.layout, {
        mode: 'stack', direction: 'horizontal', wrap: 'wrap', padding: 20, gap: 20, align: 'start',
      });
      screen.nodes[2]!.layout.order = -1;

      const html = renderWireframePreview({ page: subject, designSystem, responsiveScreen: screen });
      expect(html).toContain('data-atlas-node-id="e1" style="left:2.000%;top:23.333%');
      expect(html).toContain('data-atlas-node-id="e2" style="left:2.000%;top:3.333%');
    });

    it('ignores a responsive screen that does not own the rendered page', () => {
      const subject = withElements(['hero']);
      const screen = designGraphFromPages([subject]).screens[0]!;
      screen.pageId = 'another-page';
      expect(renderWireframePreview({ page: subject, designSystem, responsiveScreen: screen }))
        .not.toContain('data-atlas-responsive-layout');
    });

    it('escapes responsive graph identities before using them in CSS selectors', () => {
      const subject = withElements(['hero']);
      const screen = designGraphFromPages([subject]).screens[0]!;
      screen.id = 'home</style><script>alert(1)</script>';
      screen.nodes[0]!.id = 'hero"]{display:none}</style>';
      const html = renderWireframePreview({ page: subject, designSystem, responsiveScreen: screen });
      expect(html).toContain('data-atlas-responsive-layout');
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).not.toContain('hero"]{display:none}</style>');
      expect(html).toContain('\\3c ');
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

    it('projects resolved typed tokens into semantic roles, unique adapter variables, and breakpoints', () => {
      const subject = withElements(['hero']);
      const screen = designGraphFromPages([subject]).screens[0]!;
      const html = renderWireframePreview({
        page: subject,
        designSystem,
        responsiveScreen: screen,
        tokens: [
          { id: 'brand-base', label: 'Brand base', kind: 'color', value: '#123456' },
          { id: 'color-primary', label: 'Primary', kind: 'color', aliasOf: 'brand-base' },
          { id: 'font-heading', label: 'Heading', kind: 'font-family', value: 'Georgia, serif' },
          { id: 'spacing-base', label: 'Spacing', kind: 'spacing', value: 18 },
          { id: 'radius-base', label: 'Radius', kind: 'radius', value: 14 },
          { id: 'breakpoint-tablet', label: 'Tablet', kind: 'breakpoint', value: 900 },
          { id: 'breakpoint-mobile', label: 'Mobile', kind: 'breakpoint', value: 480 },
          { id: 'motion-fast', label: 'Fast', kind: 'motion', value: { durationMs: 120, easing: 'ease-out' } },
        ],
      });
      expect(html).toContain('--accent: #123456');
      expect(html).toContain('--heading-font: Georgia, serif');
      expect(html).toContain('--atlas-spacing-base: 18px');
      expect(html).toContain('--atlas-radius-base: 14px');
      expect(html).toContain('@media (max-width: 900px)');
      expect(html).toContain('@media (max-width: 480px)');
      expect(html).toContain('--atlas-token-6d-6f-74-69-6f-6e-2d-66-61-73-74-duration: 120ms');
      expect(html).not.toContain('[object Object]');
    });

    it('projects explicit component variants and interaction states without markup authority', () => {
      const subject = withElements(['cta']);
      const screen = designGraphFromPages([subject]).screens[0]!;
      screen.nodes[0]!.componentInstance = {
        definitionId: 'button', variantId: 'primary', state: 'disabled', propertyOverrides: { label: 'Buy' },
      };
      const html = renderWireframePreview({
        page: subject, designSystem, responsiveScreen: screen,
        components: [{
          id: 'button', label: 'Button', description: '', rootKind: 'cta',
          properties: [{ id: 'label', label: 'Label', kind: 'text', defaultValue: 'Continue' }],
          slots: [], variants: [{ id: 'primary', label: 'Primary', propertyValues: {} }],
          states: ['default', 'disabled'],
        }],
      });
      expect(html).toContain('data-component="button"');
      expect(html).toContain('data-component-state="disabled"');
      expect(html).toContain('Button · Primary · disabled');
      expect(html).not.toContain('<script');
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
