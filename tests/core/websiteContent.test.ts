import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  buildContentReport,
  contentPathFor,
  findPlaceholders,
  parsePageContent,
  renderContentForPrompt,
  renderPageContent,
  sanitizeContentDirectory,
  seedPageContent,
  splitFrontMatter,
} from '../../src/core/websiteContent.js';
import type { WebsitePagePlan, WireframeElementKind } from '../../src/types.js';

function page(overrides: Partial<WebsitePagePlan> = {}): WebsitePagePlan {
  return {
    id: 'home', title: 'Home', slug: '/', purpose: 'Sell the thing.', template: 'Standard page',
    sections: [], wireframeNotes: '', designNotes: '',
    wireframeStatus: 'draft', designStatus: 'not-started',
    contentStatus: 'not-started', seoStatus: 'not-started',
    order: 0, designPrompt: '', links: [],
    ...overrides,
  };
}

function withSections(labels: readonly string[]): WebsitePagePlan {
  return page({
    wireframe: {
      breakpoint: 'desktop',
      elements: labels.map((label, index) => ({
        id: `e${index}`,
        kind: 'section' as WireframeElementKind,
        label,
        rect: { x: 0, y: index * 200, width: 1000, height: 180 },
        designPrompt: '',
        notes: '',
      })),
    },
  });
}

describe('websiteContent', () => {
  describe('missing is not empty', () => {
    // A page nobody has written and a page written and left blank are different
    // facts, and the Content page needs to tell them apart.
    it('reports an absent file as missing', () => {
      expect(parsePageContent(page(), undefined).missing).toBe(true);
    });

    it('reports an existing empty file as present', () => {
      const parsed = parsePageContent(page(), '---\ntitle: Home\n---\n\n');
      expect(parsed.missing).toBe(false);
      expect(parsed.body.trim()).toBe('');
    });

    it('never describes a missing file as having zero placeholders', () => {
      const report = buildContentReport([page()], new Map([['home', parsePageContent(page(), undefined)]]));
      expect(report.pages[0]?.summary).toBe('No content file yet.');
      expect(report.pages[0]?.summary).not.toContain('0 placeholder');
    });

    it('distinguishes the two in the report', () => {
      const report = buildContentReport(
        [page(), page({ id: 'about', title: 'About', slug: '/about' })],
        new Map([
          ['home', parsePageContent(page(), undefined)],
          ['about', parsePageContent(page({ id: 'about' }), '---\n---\n\n')],
        ]),
      );
      expect(report.pages[0]?.summary).toContain('No content file');
      expect(report.pages[1]?.summary).toContain('empty');
    });
  });

  describe('placeholders', () => {
    it('counts them with their line and what they need', () => {
      const found = findPlaceholders('## Story\n\n[PLACEHOLDER: two paragraphs on the founding]\n\nReal copy.');
      expect(found).toHaveLength(1);
      expect(found[0]?.need).toBe('two paragraphs on the founding');
      expect(found[0]?.line).toBe(3);
    });

    it('matches a lower-case marker too', () => {
      // A marker that silently does not match is worse than no marker: the page
      // then reads as finished.
      expect(findPlaceholders('[placeholder: a caption]')).toHaveLength(1);
    });

    it('counts several on one line', () => {
      expect(findPlaceholders('[PLACEHOLDER: a] and [PLACEHOLDER: b]')).toHaveLength(2);
    });

    it('records "unspecified" rather than dropping an empty marker', () => {
      expect(findPlaceholders('[PLACEHOLDER:]')[0]?.need).toBe('unspecified');
    });

    it('surfaces the count in the report', () => {
      const parsed = parsePageContent(page(), '---\n---\nHi [PLACEHOLDER: a] [PLACEHOLDER: b]');
      const report = buildContentReport([page()], new Map([['home', parsed]]));
      expect(report.pages[0]?.placeholderCount).toBe(2);
      expect(report.pages[0]?.complete).toBe(false);
      expect(report.pages[0]?.summary).toContain('2 placeholders remaining');
    });

    it('treats a page with copy and no placeholders as complete but not approved', () => {
      const parsed = parsePageContent(page(), '---\nstatus: draft\n---\nAll written.');
      const report = buildContentReport([page()], new Map([['home', parsed]]));
      expect(report.pages[0]?.complete).toBe(true);
      // Complete is derived; approved is a decision somebody records.
      expect(report.pages[0]?.status).toBe('draft');
      expect(report.pages[0]?.summary).toContain('awaiting sign-off');
    });
  });

  describe('front matter', () => {
    it('parses the known fields and keeps unknown ones', () => {
      const parsed = parsePageContent(page(), [
        '---', 'title: About Us', 'metaDescription: "A short line"', 'status: review',
        'layout: wide', '---', '', 'Body.',
      ].join('\n'));
      expect(parsed.title).toBe('About Us');
      expect(parsed.metaDescription).toBe('A short line');
      expect(parsed.status).toBe('review');
      expect(parsed.extraFrontMatter['layout']).toBe('wide');
    });

    it('reads an empty quoted string as empty, not as two quotes', () => {
      expect(parsePageContent(page(), '---\nmetaDescription: ""\n---\nx').metaDescription).toBe('');
    });

    it('falls back to the page title rather than inventing one', () => {
      expect(parsePageContent(page({ title: 'Home' }), '---\n---\nx').title).toBe('Home');
    });

    it('falls back to draft for an unrecognised status', () => {
      expect(parsePageContent(page(), '---\nstatus: shipped\n---\nx').status).toBe('draft');
    });

    it('treats a file with no front matter as all body', () => {
      const { frontMatter, body } = splitFrontMatter('Just words.');
      expect(frontMatter).toEqual({});
      expect(body).toBe('Just words.');
    });

    it('survives a round trip without losing anything', () => {
      const original = parsePageContent(page(), [
        '---', 'title: About Us', 'metaDescription: ""', 'status: review', 'layout: wide', '---',
        '', '## Story', '', '[PLACEHOLDER: the founding]', '', 'Real copy.',
      ].join('\n'));
      const round = parsePageContent(page(), renderPageContent(original));
      expect(round.title).toBe(original.title);
      expect(round.status).toBe(original.status);
      expect(round.extraFrontMatter).toEqual(original.extraFrontMatter);
      expect(round.placeholders).toHaveLength(1);
      expect(round.body).toContain('Real copy.');
    });

    it('preserves paragraph breaks rather than collapsing whitespace', () => {
      // Markdown is line-structured; collapsing would destroy every paragraph.
      const parsed = parsePageContent(page(), '---\n---\nOne.\n\nTwo.');
      expect(parsed.body).toContain('One.\n\nTwo.');
    });
  });

  describe('seeding', () => {
    it('writes a placeholder per drawn section and no prose', () => {
      // Seeding plausible copy is the exact failure this module exists to
      // prevent: it reads as somebody's work and gets signed off.
      const seeded = seedPageContent(withSections(['Hero', 'Services']));
      const parsed = parsePageContent(page(), renderPageContent(seeded));
      expect(parsed.placeholders).toHaveLength(2);

      const prose = seeded.body
        .replace(/\[PLACEHOLDER:[^\]]*\]/gi, '')
        .replace(/^##.*$/gm, '')
        .trim();
      expect(prose).toBe('');
    });

    it('leaves the meta description empty rather than generating one', () => {
      // A meta description is published text; an invented one is invented text
      // on a search results page.
      expect(seedPageContent(page()).metaDescription).toBe('');
    });

    it('still seeds a placeholder for an undrawn page', () => {
      expect(seedPageContent(page()).body).toContain('[PLACEHOLDER:');
    });
  });

  describe('paths', () => {
    it('derives the file from the slug', () => {
      expect(contentPathFor(page({ slug: '/' }))).toBe('content/index.md');
      expect(contentPathFor(page({ slug: '/about' }))).toBe('content/about.md');
      expect(contentPathFor(page({ slug: '/services/seo' }))).toBe('content/services/seo.md');
    });

    it('refuses a directory that escapes the workspace', () => {
      for (const bad of ['../outside', '/etc', 'a/../../b', '', '   ']) {
        expect(sanitizeContentDirectory(bad)).toBe('content');
      }
      expect(sanitizeContentDirectory('src/content')).toBe('src/content');
    });

    it('reports a file no page claims, rather than deleting it', () => {
      const report = buildContentReport(
        [page()],
        new Map([['home', parsePageContent(page(), '---\n---\nx')]]),
        ['content/index.md', 'content/old-campaign.md'],
      );
      expect(report.orphanFiles).toEqual(['content/old-campaign.md']);
      expect(report.summary).toContain('no matching page');
    });
  });

  describe('the generation prompt', () => {
    it('tells the model to mark everything when there is no file', () => {
      expect(renderContentForPrompt(parsePageContent(page(), undefined)))
        .toContain('must mark as such');
    });

    it('passes placeholders through and forbids filling them', () => {
      const parsed = parsePageContent(page(), '---\n---\n[PLACEHOLDER: the story]');
      const rendered = renderContentForPrompt(parsed);
      expect(rendered).toContain('[PLACEHOLDER: the story]');
      expect(rendered).toContain('Do not write copy to fill them');
    });

    it('adds no instruction when the copy is complete', () => {
      const parsed = parsePageContent(page(), '---\n---\nAll written.');
      expect(renderContentForPrompt(parsed)).not.toContain('Do not write copy');
    });
  });

  describe('robustness', () => {
    it('never throws on arbitrary file contents', () => {
      fc.assert(fc.property(fc.string(), raw => {
        const parsed = parsePageContent(page(), raw);
        return typeof parsed.body === 'string' && Array.isArray(parsed.placeholders);
      }), { numRuns: 300 });
    });

    it('strips control characters but keeps newlines and tabs', () => {
      const bell = String.fromCharCode(7);
      const raw = ['---', '---', 'One' + bell + 'two', 'three\tfour'].join('\n');
      const parsed = parsePageContent(page(), raw);

      expect(parsed.body).not.toContain(bell);
      // Markdown is line-structured: collapsing these would destroy every
      // paragraph break in the document.
      expect(parsed.body).toContain('\n');
      expect(parsed.body).toContain('\t');
    });
  });
});
