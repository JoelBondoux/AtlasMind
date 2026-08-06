import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  buildSitemapTree,
  flattenSitemap,
  layoutSitemap,
  MAX_SITEMAP_DEPTH,
  nextSiblingOrder,
  normalizeSlug,
  parentSlug,
} from '../../src/core/websiteSitemap.js';
import type { WebsitePagePlan } from '../../src/types.js';

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

describe('websiteSitemap', () => {
  describe('slug handling', () => {
    it('normalizes to one leading slash and no trailing slash', () => {
      expect(normalizeSlug('/')).toBe('/');
      expect(normalizeSlug('')).toBe('/');
      expect(normalizeSlug('services')).toBe('/services');
      expect(normalizeSlug('/services/')).toBe('/services');
      expect(normalizeSlug('//services//seo//')).toBe('/services/seo');
    });

    it('walks one level up', () => {
      expect(parentSlug('/')).toBeUndefined();
      expect(parentSlug('/services')).toBe('/');
      expect(parentSlug('/services/seo')).toBe('/services');
      expect(parentSlug('/a/b/c')).toBe('/a/b');
    });
  });

  describe('hierarchy', () => {
    it('derives the parent from the slug path, so the map builds itself', () => {
      const tree = buildSitemapTree([
        page('home', '/'),
        page('services', '/services'),
        page('seo', '/services/seo'),
      ]);
      const seo = tree.nodesById.get('seo')!;
      expect(seo.parentId).toBe('services');
      expect(seo.parentSource).toBe('slug');
      expect(seo.depth).toBe(2);
    });

    it('lets an explicit parent override the slug', () => {
      // A person who set a parent has made a decision the path convention
      // cannot overrule.
      const tree = buildSitemapTree([
        page('home', '/'),
        page('services', '/services'),
        page('pricing', '/pricing', { parentId: 'services' }),
      ]);
      const pricing = tree.nodesById.get('pricing')!;
      expect(pricing.parentId).toBe('services');
      expect(pricing.parentSource).toBe('explicit');
    });

    it('attaches a page whose slug parent is missing to the root and says so', () => {
      const tree = buildSitemapTree([page('home', '/'), page('seo', '/services/seo')]);
      const seo = tree.nodesById.get('seo')!;
      expect(seo.parentId).toBeUndefined();
      expect(seo.parentSource).toBe('orphaned');
      expect(tree.findings.some(finding => finding.kind === 'orphaned-slug' && finding.pageId === 'seo')).toBe(true);
      // Still drawn — hiding it would lose work.
      expect(tree.roots.some(node => node.page.id === 'seo')).toBe(true);
    });

    it('reports an explicit parent that no longer exists rather than hiding the page', () => {
      const tree = buildSitemapTree([page('home', '/'), page('orphan', '/orphan', { parentId: 'deleted' })]);
      expect(tree.findings.some(finding => finding.kind === 'missing-parent')).toBe(true);
      expect(tree.roots.some(node => node.page.id === 'orphan')).toBe(true);
    });

    it('breaks a cycle and reports it instead of recursing forever', () => {
      const tree = buildSitemapTree([
        page('a', '/a', { parentId: 'b' }),
        page('b', '/b', { parentId: 'a' }),
      ]);
      expect(tree.findings.some(finding => finding.kind === 'cycle')).toBe(true);
      expect(flattenSitemap(tree)).toHaveLength(2);
    });

    it('detaches only the page that closes the loop, not the whole chain', () => {
      const tree = buildSitemapTree([
        page('a', '/a'),
        page('b', '/b', { parentId: 'a' }),
        page('c', '/c', { parentId: 'b' }),
      ]);
      // A clean chain must survive untouched.
      expect(tree.findings.some(finding => finding.kind === 'cycle')).toBe(false);
      expect(tree.nodesById.get('c')?.depth).toBe(2);
    });

    it('reports a page past the depth cap', () => {
      const pages = [page('p0', '/p0')];
      for (let index = 1; index <= MAX_SITEMAP_DEPTH + 1; index += 1) {
        pages.push(page(`p${index}`, `/p${index}`, { parentId: `p${index - 1}` }));
      }
      const tree = buildSitemapTree(pages);
      expect(tree.findings.some(finding => finding.kind === 'depth-capped')).toBe(true);
    });

    it('orders siblings by order, then title, then id — totally', () => {
      const build = () => buildSitemapTree([
        page('home', '/'),
        page('zeta', '/zeta', { order: 1, title: 'Same' }),
        page('alpha', '/alpha', { order: 1, title: 'Same' }),
        page('first', '/first', { order: 0, title: 'First' }),
      ]);
      const once = flattenSitemap(build()).map(node => node.page.id);
      const twice = flattenSitemap(build()).map(node => node.page.id);
      expect(once).toEqual(twice);
      // Equal order and equal title resolve on id.
      expect(once.indexOf('alpha')).toBeLessThan(once.indexOf('zeta'));
    });

    it('does not let a duplicate slug steal another page\'s children', () => {
      const tree = buildSitemapTree([
        page('services', '/services'),
        page('servicesCopy', '/services'),
        page('seo', '/services/seo'),
      ]);
      expect(tree.nodesById.get('seo')?.parentId).toBe('services');
    });
  });

  describe('properties', () => {
    const arbitraryPages = fc.array(
      fc.record({
        id: fc.string({ minLength: 1, maxLength: 6 }),
        slug: fc.oneof(
          fc.constant('/'),
          fc.string({ maxLength: 12 }).map(text => `/${text}`),
          fc.constant('/a/b/c'),
        ),
        parentId: fc.oneof(fc.string({ maxLength: 6 }), fc.constant(undefined)),
        order: fc.integer({ min: 0, max: 5 }),
      }),
      { maxLength: 12 },
    ).map(records => {
      // Ids must be unique for the tree to be well-defined; the sanitizer
      // guarantees that upstream.
      const seen = new Set<string>();
      return records
        .filter(record => (seen.has(record.id) ? false : (seen.add(record.id), true)))
        .map(record => page(record.id, record.slug, {
          ...(record.parentId ? { parentId: record.parentId } : {}),
          order: record.order,
        }));
    });

    it('is total: every page appears exactly once', () => {
      fc.assert(fc.property(arbitraryPages, pages => {
        const tree = buildSitemapTree(pages);
        const flat = flattenSitemap(tree);
        if (flat.length !== pages.length) { return false; }
        const ids = new Set(flat.map(node => node.page.id));
        return ids.size === pages.length;
      }), { numRuns: 250 });
    });

    it('is acyclic: the walk always terminates and depth is finite', () => {
      fc.assert(fc.property(arbitraryPages, pages => {
        const tree = buildSitemapTree(pages);
        return flattenSitemap(tree).every(node => Number.isFinite(node.depth) && node.depth >= 0);
      }), { numRuns: 250 });
    });
  });

  describe('layout', () => {
    it('places children below their parent and centres the parent over them', () => {
      const tree = buildSitemapTree([
        page('home', '/'),
        page('a', '/a'),
        page('b', '/b'),
      ]);
      const layout = layoutSitemap(tree);
      const home = layout.nodes.find(node => node.pageId === 'home')!;
      const a = layout.nodes.find(node => node.pageId === 'a')!;
      const b = layout.nodes.find(node => node.pageId === 'b')!;
      expect(a.y).toBeGreaterThan(home.y);
      const centre = (home.x + home.width / 2);
      const childrenCentre = ((a.x + a.width / 2) + (b.x + b.width / 2)) / 2;
      expect(Math.abs(centre - childrenCentre)).toBeLessThan(1);
    });

    it('produces identical coordinates for identical input', () => {
      // A map that shifts when nothing changed is one nobody trusts.
      const pages = [page('home', '/'), page('a', '/a'), page('deep', '/a/deep')];
      expect(layoutSitemap(buildSitemapTree(pages))).toEqual(layoutSitemap(buildSitemapTree(pages)));
    });

    it('handles an empty sitemap without producing negative dimensions', () => {
      const layout = layoutSitemap(buildSitemapTree([]));
      expect(layout.nodes).toEqual([]);
      expect(layout.width).toBeGreaterThanOrEqual(0);
      expect(layout.height).toBeGreaterThanOrEqual(0);
    });

    it('marks a derived edge so it can be drawn differently from a stated one', () => {
      const tree = buildSitemapTree([page('home', '/'), page('a', '/a')]);
      expect(layoutSitemap(tree).edges[0]?.source).toBe('slug');
    });
  });

  describe('nextSiblingOrder', () => {
    it('appends rather than renumbering the existing siblings', () => {
      const pages = [page('a', '/a', { order: 0 }), page('b', '/b', { order: 5 })];
      expect(nextSiblingOrder(pages)).toBe(6);
    });

    it('counts only siblings under the same parent', () => {
      const pages = [
        page('a', '/a', { order: 9 }),
        page('child', '/a/child', { parentId: 'a', order: 2 }),
      ];
      expect(nextSiblingOrder(pages, 'a')).toBe(3);
    });

    it('starts at zero for an empty site', () => {
      expect(nextSiblingOrder([])).toBe(0);
    });
  });
});
