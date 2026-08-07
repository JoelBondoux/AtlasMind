/**
 * The sitemap as a hierarchy, built from the pages that already exist.
 *
 * Website Studio's sitemap was a flat `WebsitePagePlan[]` rendered as a table.
 * Hierarchy was implied by the slug string and read by whoever was looking, so
 * adding `/services/seo` produced another table row rather than a child of
 * Services — and "what does this site actually look like?" had no answer on the
 * page that exists to answer it.
 *
 * Four rules decide the shape.
 *
 * **An explicit parent wins; otherwise the slug derives one.** Slug derivation
 * is what makes the map build itself as pages are added — the ordinary case
 * needs nobody to draw an edge. But a person who set a parent on purpose has
 * made a decision the path convention cannot overrule, so `parentId` is checked
 * first.
 *
 * **A slug whose parent does not exist attaches to root and says so.** The
 * tempting alternatives are both worse: hiding the page loses work, and quietly
 * attaching it to the nearest ancestor that *does* exist invents a relationship
 * nobody stated. It goes to the top level carrying `parentSource: 'orphaned'`,
 * which the map renders as a visible gap rather than a tidy lie.
 *
 * **A cycle is broken at the repeat and reported, never followed.** Explicit
 * parents come from a webview and from a hand-editable JSON file, so `A → B → A`
 * is reachable, and a renderer that trusted the graph would recurse forever.
 *
 * **The order is total.** Siblings sort on `order`, then title, then id. Without
 * the final tie-break the map reshuffles between renders and the reader cannot
 * tell a moved page from a redrawn one.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

import type { WebsitePagePlan } from '../types.js';

/** How a page came to sit where it does. Rendered on the map, so a derived edge is never mistaken for a stated one. */
export type SitemapParentSource =
  /** Somebody set `parentId`. */
  | 'explicit'
  /** Derived from the slug path — `/services/seo` under `/services`. */
  | 'slug'
  /** Top level: a root-ish slug with no parent to have. */
  | 'root'
  /** The slug names a parent path that no page occupies. Shown at the top level, flagged. */
  | 'orphaned';

export interface SitemapNode {
  page: WebsitePagePlan;
  depth: number;
  parentId?: string;
  parentSource: SitemapParentSource;
  children: SitemapNode[];
}

/** Something about the hierarchy a person should know, rather than a thing silently fixed. */
export interface SitemapFinding {
  pageId: string;
  kind: 'missing-parent' | 'cycle' | 'orphaned-slug' | 'depth-capped';
  /** Plain sentence naming the page and what happened to it. */
  message: string;
}

export interface SitemapTree {
  roots: SitemapNode[];
  nodesById: ReadonlyMap<string, SitemapNode>;
  findings: SitemapFinding[];
  /** Deepest level reached, 0 for a flat site. */
  maxDepth: number;
}

/**
 * Deeper than this and the map stops being readable, and a path convention has
 * almost certainly been mistaken for a hierarchy. Pages past the cap keep their
 * parent but are reported.
 */
export const MAX_SITEMAP_DEPTH = 6;

// ── Slugs ────────────────────────────────────────────────────────

/**
 * Normalize a slug for comparison: one leading slash, no trailing slash, no
 * empty segments. Done once, here, because two callers normalizing slightly
 * differently is how `/services` and `/services/` become different parents.
 */
export function normalizeSlug(slug: string): string {
  const segments = slug.split('/').map(part => part.trim()).filter(part => part.length > 0);
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

/** The slug one level up, or undefined at the root. */
export function parentSlug(slug: string): string | undefined {
  const normalized = normalizeSlug(slug);
  if (normalized === '/') {
    return undefined;
  }
  const segments = normalized.split('/').filter(part => part.length > 0);
  segments.pop();
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

// ── Building ─────────────────────────────────────────────────────

export function buildSitemapTree(pages: readonly WebsitePagePlan[]): SitemapTree {
  const byId = new Map(pages.map(page => [page.id, page]));
  const bySlug = new Map<string, WebsitePagePlan>();
  for (const page of pages) {
    const slug = normalizeSlug(page.slug);
    // First page to claim a slug keeps it. A duplicate is a data problem, but
    // resolving it by reassignment here would move somebody's children under a
    // page they never named.
    if (!bySlug.has(slug)) {
      bySlug.set(slug, page);
    }
  }

  const findings: SitemapFinding[] = [];
  const resolved = new Map<string, { parentId?: string; source: SitemapParentSource }>();

  for (const page of pages) {
    resolved.set(page.id, resolveParent(page, byId, bySlug, findings));
  }

  breakCycles(pages, resolved, findings);

  // Build nodes, then link them. Two passes because a child can appear before
  // its parent in the array and a single pass would need the parent to exist.
  const nodesById = new Map<string, SitemapNode>();
  for (const page of pages) {
    const link = resolved.get(page.id)!;
    nodesById.set(page.id, {
      page,
      depth: 0,
      ...(link.parentId ? { parentId: link.parentId } : {}),
      parentSource: link.source,
      children: [],
    });
  }

  const roots: SitemapNode[] = [];
  for (const node of nodesById.values()) {
    const parent = node.parentId ? nodesById.get(node.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  sortSiblings(roots);
  for (const node of nodesById.values()) {
    sortSiblings(node.children);
  }

  const maxDepth = assignDepths(roots, findings);

  return { roots, nodesById, findings, maxDepth };
}

function resolveParent(
  page: WebsitePagePlan,
  byId: ReadonlyMap<string, WebsitePagePlan>,
  bySlug: ReadonlyMap<string, WebsitePagePlan>,
  findings: SitemapFinding[],
): { parentId?: string; source: SitemapParentSource } {
  // 1. An explicit parent is a decision. Honour it, unless it names nothing.
  if (page.parentId && page.parentId !== page.id) {
    if (byId.has(page.parentId)) {
      return { parentId: page.parentId, source: 'explicit' };
    }
    findings.push({
      pageId: page.id,
      kind: 'missing-parent',
      message: `"${page.title}" names a parent page that no longer exists. It is shown at the top level until a parent is chosen.`,
    });
    return { source: 'orphaned' };
  }

  // 2. Otherwise the path says it.
  const ownSlug = normalizeSlug(page.slug);
  const wanted = parentSlug(ownSlug);
  if (!wanted) {
    return { source: 'root' };
  }
  const parent = bySlug.get(wanted);
  if (parent && parent.id !== page.id) {
    return { parentId: parent.id, source: 'slug' };
  }

  // 3. The path claims a parent that is not there. Say so rather than tidy it.
  findings.push({
    pageId: page.id,
    kind: 'orphaned-slug',
    message: `"${page.title}" sits at ${ownSlug}, but no page occupies ${wanted}. It is shown at the top level.`,
  });
  return { source: 'orphaned' };
}

/**
 * Detach the page that closes a cycle.
 *
 * Walks up from each page with a bounded step count. The first page found to
 * reach itself loses its parent — not every page in the loop, which would
 * scatter a chain that is mostly correct because of one bad edge.
 */
function breakCycles(
  pages: readonly WebsitePagePlan[],
  resolved: Map<string, { parentId?: string; source: SitemapParentSource }>,
  findings: SitemapFinding[],
): void {
  for (const page of pages) {
    const seen = new Set<string>([page.id]);
    let cursor = resolved.get(page.id)?.parentId;
    while (cursor) {
      if (seen.has(cursor)) {
        resolved.set(page.id, { source: 'orphaned' });
        findings.push({
          pageId: page.id,
          kind: 'cycle',
          message: `"${page.title}" is part of a loop in the page hierarchy. Its parent has been cleared so the sitemap can be drawn.`,
        });
        break;
      }
      seen.add(cursor);
      cursor = resolved.get(cursor)?.parentId;
    }
  }
}

/**
 * Siblings sort on `order`, then title, then id.
 *
 * The id tie-break is not decoration. Two pages added in the same action share
 * an `order` and may share a title; without a final total ordering the map
 * swaps them between renders, and every reader learns to distrust the layout.
 */
function sortSiblings(nodes: SitemapNode[]): void {
  nodes.sort((a, b) => {
    if (a.page.order !== b.page.order) {
      return a.page.order - b.page.order;
    }
    const byTitle = a.page.title.localeCompare(b.page.title);
    if (byTitle !== 0) {
      return byTitle;
    }
    return a.page.id < b.page.id ? -1 : a.page.id > b.page.id ? 1 : 0;
  });
}

function assignDepths(roots: readonly SitemapNode[], findings: SitemapFinding[]): number {
  let maxDepth = 0;
  const walk = (node: SitemapNode, depth: number): void => {
    node.depth = depth;
    maxDepth = Math.max(maxDepth, depth);
    if (depth >= MAX_SITEMAP_DEPTH) {
      findings.push({
        pageId: node.page.id,
        kind: 'depth-capped',
        message: `"${node.page.title}" sits ${depth} levels deep. Past ${MAX_SITEMAP_DEPTH} the map is hard to read and the path is probably not a hierarchy.`,
      });
      return;
    }
    for (const child of node.children) {
      walk(child, depth + 1);
    }
  };
  for (const root of roots) {
    walk(root, 0);
  }
  return maxDepth;
}

/** Every node, parents before children, in the order the map draws them. */
export function flattenSitemap(tree: SitemapTree): SitemapNode[] {
  const out: SitemapNode[] = [];
  const walk = (nodes: readonly SitemapNode[]): void => {
    for (const node of nodes) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(tree.roots);
  return out;
}

// ── Layout ───────────────────────────────────────────────────────

export interface SitemapLayoutNode {
  pageId: string;
  title: string;
  slug: string;
  depth: number;
  parentSource: SitemapParentSource;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SitemapLayoutEdge {
  fromPageId: string;
  toPageId: string;
  /** `slug` edges are drawn dashed: derived, not stated. */
  source: SitemapParentSource;
}

export interface SitemapLayout {
  nodes: SitemapLayoutNode[];
  edges: SitemapLayoutEdge[];
  width: number;
  height: number;
}

export const SITEMAP_NODE_WIDTH = 180;
export const SITEMAP_NODE_HEIGHT = 64;
const SITEMAP_H_GAP = 28;
const SITEMAP_V_GAP = 96;
const SITEMAP_PADDING = 24;

/**
 * A tidy layered tree: depth sets the row, and a parent centres over its
 * children.
 *
 * Written out rather than pulled from a library because the CSP forbids a CDN
 * and the whole algorithm is thirty lines: leaves take the next free column,
 * internal nodes take the midpoint of their children's span. Traversal order is
 * the tree's own total order, so the same pages always produce the same
 * coordinates — a map that shifts when nothing changed is one nobody trusts.
 */
export function layoutSitemap(tree: SitemapTree): SitemapLayout {
  const nodes: SitemapLayoutNode[] = [];
  const edges: SitemapLayoutEdge[] = [];
  let nextColumn = 0;

  const place = (node: SitemapNode): number => {
    let centre: number;
    if (node.children.length === 0) {
      centre = nextColumn;
      nextColumn += 1;
    } else {
      const childCentres = node.children.map(place);
      centre = (childCentres[0]! + childCentres[childCentres.length - 1]!) / 2;
    }

    nodes.push({
      pageId: node.page.id,
      title: node.page.title,
      slug: normalizeSlug(node.page.slug),
      depth: node.depth,
      parentSource: node.parentSource,
      x: SITEMAP_PADDING + centre * (SITEMAP_NODE_WIDTH + SITEMAP_H_GAP),
      y: SITEMAP_PADDING + node.depth * (SITEMAP_NODE_HEIGHT + SITEMAP_V_GAP),
      width: SITEMAP_NODE_WIDTH,
      height: SITEMAP_NODE_HEIGHT,
    });

    for (const child of node.children) {
      edges.push({ fromPageId: node.page.id, toPageId: child.page.id, source: child.parentSource });
    }
    return centre;
  };

  for (const root of tree.roots) {
    place(root);
  }

  const width = SITEMAP_PADDING * 2 + Math.max(nextColumn, 1) * (SITEMAP_NODE_WIDTH + SITEMAP_H_GAP) - SITEMAP_H_GAP;
  const height = SITEMAP_PADDING * 2 + (tree.maxDepth + 1) * (SITEMAP_NODE_HEIGHT + SITEMAP_V_GAP) - SITEMAP_V_GAP;

  // Sorted so the SVG's document order matches the reading order rather than
  // the post-order the placement pass produced.
  nodes.sort((a, b) => (a.y - b.y) || (a.x - b.x) || (a.pageId < b.pageId ? -1 : 1));

  return { nodes, edges, width: Math.max(width, 0), height: Math.max(height, 0) };
}

/**
 * The next `order` value for a new page under a given parent.
 *
 * Appending rather than inserting: a new page joining its siblings at the end
 * is predictable, and renumbering the others to make room would rewrite rows
 * nobody touched.
 */
export function nextSiblingOrder(pages: readonly WebsitePagePlan[], parentId?: string): number {
  const siblings = pages.filter(page => (page.parentId ?? undefined) === parentId);
  return siblings.reduce((highest, page) => Math.max(highest, page.order), -1) + 1;
}
