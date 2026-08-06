import { describe, expect, it } from 'vitest';
import {
  buildLinkGraph,
  deriveLinksFromWireframe,
  findRootPageId,
  mergeDerivedLinks,
} from '../../src/core/websiteLinkGraph.js';
import type { WebsitePageLink, WebsitePagePlan, WebsiteWireframe } from '../../src/types.js';

function page(id: string, slug: string, overrides: Partial<WebsitePagePlan> = {}): WebsitePagePlan {
  return {
    id,
    title: id,
    slug,
    purpose: '',
    template: 'Standard page',
    sections: [],
    wireframeNotes: '',
    designNotes: '',
    wireframeStatus: 'not-started',
    designStatus: 'not-started',
    contentStatus: 'not-started',
    seoStatus: 'not-started',
    order: 0,
    designPrompt: '',
    links: [],
    ...overrides,
  };
}

function link(id: string, overrides: Partial<WebsitePageLink> = {}): WebsitePageLink {
  return { id, label: id, origin: 'declared', ...overrides };
}

function wireframe(elements: WebsiteWireframe['elements']): WebsiteWireframe {
  return { breakpoint: 'desktop', elements };
}

describe('websiteLinkGraph', () => {
  describe('resolution', () => {
    it('resolves an internal link and records it as inbound on the target', () => {
      const graph = buildLinkGraph([
        page('home', '/', { links: [link('l1', { targetPageId: 'about', label: 'About us' })] }),
        page('about', '/about'),
      ]);
      expect(graph.byPageId.get('home')?.outbound[0]?.targetTitle).toBe('about');
      expect(graph.byPageId.get('about')?.inboundPageIds).toEqual(['home']);
    });

    it('keeps a dangling link and reports it, rather than dropping it', () => {
      // A link whose target was deleted is the evidence that a nav is broken.
      const graph = buildLinkGraph([
        page('home', '/', { links: [link('l1', { targetPageId: 'deleted', label: 'Pricing' })] }),
      ]);
      const outbound = graph.byPageId.get('home')!.outbound;
      expect(outbound).toHaveLength(1);
      expect(outbound[0]?.dangling).toBe(true);
      expect(graph.findings.some(finding => finding.kind === 'dangling-link')).toBe(true);
    });

    it('collects external destinations, sorted and deduplicated', () => {
      const graph = buildLinkGraph([
        page('home', '/', {
          links: [
            link('l1', { externalUrl: 'https://z.example/' }),
            link('l2', { externalUrl: 'https://a.example/' }),
            link('l3', { externalUrl: 'https://a.example/' }),
          ],
        }),
      ]);
      expect(graph.externalUrls).toEqual(['https://a.example/', 'https://z.example/']);
    });
  });

  describe('findings', () => {
    it('never calls the root page an orphan', () => {
      // Nothing links to the front page and nothing needs to; counting it would
      // put a permanent false finding on every site.
      const graph = buildLinkGraph([page('home', '/'), page('about', '/about')]);
      expect(graph.findings.filter(finding => finding.kind === 'orphan-page').map(finding => finding.pageId))
        .toEqual(['about']);
    });

    it('falls back to the first page when nothing sits at the root', () => {
      const pages = [page('docsIndex', '/docs'), page('guide', '/docs/guide')];
      expect(findRootPageId(pages)).toBe('docsIndex');
      const graph = buildLinkGraph(pages);
      expect(graph.findings.some(finding => finding.kind === 'orphan-page' && finding.pageId === 'docsIndex')).toBe(false);
    });

    it('flags a page nothing leaves from', () => {
      const graph = buildLinkGraph([page('home', '/')]);
      expect(graph.findings.some(finding => finding.kind === 'no-outbound')).toBe(true);
    });

    it('reports nothing for a fully linked pair', () => {
      const graph = buildLinkGraph([
        page('home', '/', { links: [link('a', { targetPageId: 'about' })] }),
        page('about', '/about', { links: [link('b', { targetPageId: 'home' })] }),
      ]);
      expect(graph.findings).toEqual([]);
    });
  });

  describe('deriveLinksFromWireframe', () => {
    const navElement = (label: string) => ({
      id: `nav-${label}`,
      kind: 'nav' as const,
      label,
      rect: { x: 0, y: 0, width: 1000, height: 70 },
      designPrompt: '',
      notes: '',
    });

    it('reads a nav label that matches a page title', () => {
      const home = page('home', '/', { wireframe: wireframe([navElement('About')]) });
      const derived = deriveLinksFromWireframe(home, [home, page('about', '/about', { title: 'About' })]);
      expect(derived).toEqual([expect.objectContaining({ targetPageId: 'about', origin: 'derived' })]);
    });

    it('matches case-insensitively but never loosely', () => {
      const home = page('home', '/', { wireframe: wireframe([navElement('about')]) });
      const pages = [home, page('about', '/about', { title: 'About' })];
      expect(deriveLinksFromWireframe(home, pages)).toHaveLength(1);

      // "Get in touch" must not be wired to "Get Started" — a wrong answer that
      // looks like a right one is worse than no link.
      const loose = page('home2', '/', { wireframe: wireframe([navElement('Get in touch')]) });
      expect(deriveLinksFromWireframe(loose, [loose, page('started', '/start', { title: 'Get Started' })])).toEqual([]);
    });

    it('ignores kinds that are not link sources', () => {
      const hero = {
        id: 'hero',
        kind: 'hero' as const,
        label: 'About',
        rect: { x: 0, y: 0, width: 1000, height: 300 },
        designPrompt: '',
        notes: '',
      };
      const home = page('home', '/', { wireframe: wireframe([hero]) });
      expect(deriveLinksFromWireframe(home, [home, page('about', '/about', { title: 'About' })])).toEqual([]);
    });

    it('never links a page to itself', () => {
      const home = page('home', '/', { title: 'Home', wireframe: wireframe([navElement('Home')]) });
      expect(deriveLinksFromWireframe(home, [home])).toEqual([]);
    });

    it('gives a derived link a stable id, so recomputing does not duplicate it', () => {
      const home = page('home', '/', { wireframe: wireframe([navElement('About')]) });
      const pages = [home, page('about', '/about', { title: 'About' })];
      expect(deriveLinksFromWireframe(home, pages)[0]?.id)
        .toBe(deriveLinksFromWireframe(home, pages)[0]?.id);
    });

    it('returns nothing for a page that was never drawn', () => {
      expect(deriveLinksFromWireframe(page('home', '/'), [])).toEqual([]);
    });
  });

  describe('mergeDerivedLinks', () => {
    it('keeps declared links untouched', () => {
      const declared = link('typed', { targetPageId: 'about', label: 'Our story' });
      const merged = mergeDerivedLinks([declared], []);
      expect(merged).toEqual([declared]);
    });

    it('replaces previously derived links rather than accumulating them', () => {
      const stale = link('derived-old', { targetPageId: 'gone', origin: 'derived' });
      const fresh = link('derived-new', { targetPageId: 'about', origin: 'derived' });
      const merged = mergeDerivedLinks([stale], [fresh]);
      expect(merged.map(item => item.id)).toEqual(['derived-new']);
    });

    it('drops a derived link whose destination a declared one already covers', () => {
      const declared = link('typed', { targetPageId: 'about', label: 'Our story' });
      const derived = link('derived-nav', { targetPageId: 'about', origin: 'derived' });
      expect(mergeDerivedLinks([declared], [derived])).toEqual([declared]);
    });
  });
});
