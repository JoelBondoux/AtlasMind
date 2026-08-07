/**
 * Where each page leads — the question the page inventory could not answer.
 *
 * The inventory listed pages. It did not know that Home's nav points at
 * Services, that nothing points at the new Pricing page, or that Contact still
 * links to a page somebody deleted last week. Those are the three things a
 * sitemap review is actually for, and all three are derivable from data the
 * workspace already holds once links are modelled at all.
 *
 * Four rules.
 *
 * **A dangling link is reported, never dropped.** A link whose target page no
 * longer exists is the trace of a deletion — quietly removing it would erase the
 * evidence that a nav is now broken, which is precisely the finding. Same
 * reasoning as `lensReachability`'s `danglingContractIds`.
 *
 * **The root page is never an orphan.** Nothing links to the front page, and it
 * needs nothing to. Counting it would put a permanent false finding at the top
 * of every site's report, and a report with a permanent finding is one people
 * learn to skim.
 *
 * **A derived link never overwrites a declared one.** Links read off nav and CTA
 * boxes are recomputed whenever the canvas changes; links somebody typed are
 * not. Collapsing the two would lose a decision every time a box moved.
 *
 * **Matching a label to a page is exact, then case-insensitive, and says
 * which.** A "Services" button matching the Services page is worth having. A
 * fuzzy match that silently points a button at the wrong page is worse than no
 * link at all, so nothing looser is attempted.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

import type { WebsitePagePlan, WebsitePageLink, WebsiteWireframeElement } from '../types.js';
import { isLinkSourceKind, orderedWireframeElements } from './websiteWireframe.js';
import { normalizeSlug } from './websiteSitemap.js';

/** A resolved outbound link, carrying what it points at and how sure we are. */
export interface ResolvedLink {
  link: WebsitePageLink;
  /** Present when the link resolves to a page in this workspace. */
  targetPageId?: string;
  targetTitle?: string;
  /** Present for an external destination. */
  externalUrl?: string;
  /** The link names a page id that no longer exists. */
  dangling: boolean;
}

export interface PageLinkSummary {
  pageId: string;
  outbound: ResolvedLink[];
  /** Pages that link here, deduplicated, in sitemap order. */
  inboundPageIds: string[];
}

export interface LinkGraphFinding {
  pageId: string;
  kind: 'dangling-link' | 'orphan-page' | 'no-outbound';
  message: string;
}

export interface WebsiteLinkGraph {
  byPageId: ReadonlyMap<string, PageLinkSummary>;
  findings: LinkGraphFinding[];
  /** Every distinct external destination the site points at, sorted. */
  externalUrls: string[];
}

const MAX_LINKS_PER_PAGE = 40;

export function buildLinkGraph(pages: readonly WebsitePagePlan[]): WebsiteLinkGraph {
  const byId = new Map(pages.map(page => [page.id, page]));
  const rootId = findRootPageId(pages);

  const byPageId = new Map<string, PageLinkSummary>();
  const inbound = new Map<string, Set<string>>();
  const findings: LinkGraphFinding[] = [];
  const externalUrls = new Set<string>();

  for (const page of pages) {
    const outbound: ResolvedLink[] = [];
    for (const link of page.links.slice(0, MAX_LINKS_PER_PAGE)) {
      if (link.targetPageId) {
        const target = byId.get(link.targetPageId);
        if (target) {
          outbound.push({ link, targetPageId: target.id, targetTitle: target.title, dangling: false });
          const set = inbound.get(target.id) ?? new Set<string>();
          set.add(page.id);
          inbound.set(target.id, set);
        } else {
          outbound.push({ link, dangling: true });
          findings.push({
            pageId: page.id,
            kind: 'dangling-link',
            message: `"${page.title}" links to a page that no longer exists${link.label ? ` via "${link.label}"` : ''}. The link is kept so the break stays visible.`,
          });
        }
        continue;
      }
      if (link.externalUrl) {
        externalUrls.add(link.externalUrl);
        outbound.push({ link, externalUrl: link.externalUrl, dangling: false });
      }
    }
    byPageId.set(page.id, { pageId: page.id, outbound, inboundPageIds: [] });
  }

  // Second pass: inbound is only complete once every page's outbound has been
  // read. Order follows the page array so the UI list is stable.
  for (const page of pages) {
    const summary = byPageId.get(page.id)!;
    const sources = inbound.get(page.id);
    summary.inboundPageIds = sources
      ? pages.filter(candidate => sources.has(candidate.id)).map(candidate => candidate.id)
      : [];

    if (summary.inboundPageIds.length === 0 && page.id !== rootId) {
      findings.push({
        pageId: page.id,
        kind: 'orphan-page',
        message: `Nothing links to "${page.title}". A visitor can only reach it by typing the address.`,
      });
    }
    if (summary.outbound.length === 0) {
      findings.push({
        pageId: page.id,
        kind: 'no-outbound',
        message: `"${page.title}" has no links leaving it. Visitors who arrive here have nowhere to go next.`,
      });
    }
  }

  return { byPageId, findings, externalUrls: [...externalUrls].sort() };
}

/**
 * The front page: the one at `/`, or failing that the first page.
 *
 * A site with no page at `/` is unusual but not wrong — a documentation set
 * mounted under a path, for instance — and picking the first page keeps exactly
 * one page exempt from the orphan rule. Exempting none would flag the entry
 * point of every such site forever.
 */
export function findRootPageId(pages: readonly WebsitePagePlan[]): string | undefined {
  const atRoot = pages.find(page => normalizeSlug(page.slug) === '/');
  return atRoot?.id ?? pages[0]?.id;
}

// ── Deriving links from the canvas ───────────────────────────────

/**
 * Read nav and CTA boxes as links.
 *
 * The label is matched against page titles and slugs, exactly first and then
 * case-insensitively. Anything looser is deliberately not attempted: a "Get in
 * touch" button silently wired to a "Get Started" page is a wrong answer that
 * looks like a right one, and the cost of missing it is only that somebody sets
 * the link by hand.
 *
 * Returns *proposals*. The caller merges them, and `mergeDerivedLinks` is where
 * the rule that a declared link is never overwritten actually lives.
 */
export function deriveLinksFromWireframe(
  page: WebsitePagePlan,
  allPages: readonly WebsitePagePlan[],
): WebsitePageLink[] {
  if (!page.wireframe) {
    return [];
  }

  const candidates = orderedWireframeElements(page.wireframe).filter(element => isLinkSourceKind(element.kind));
  const derived: WebsitePageLink[] = [];
  const claimed = new Set<string>();

  for (const element of candidates) {
    const target = matchPageByLabel(element.label, allPages, page.id);
    if (!target || claimed.has(target.id)) {
      continue;
    }
    claimed.add(target.id);
    derived.push({
      id: derivedLinkId(element),
      label: element.label,
      targetPageId: target.id,
      origin: 'derived',
    });
  }

  return derived;
}

/**
 * A derived link's id is a function of the element it came from, so recomputing
 * produces the same id and the merge below can recognise its own previous
 * output instead of accumulating duplicates on every canvas edit.
 */
function derivedLinkId(element: WebsiteWireframeElement): string {
  return `derived-${element.id}`;
}

function matchPageByLabel(
  label: string,
  pages: readonly WebsitePagePlan[],
  excludePageId: string,
): WebsitePagePlan | undefined {
  const trimmed = label.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const others = pages.filter(page => page.id !== excludePageId);

  const exact = others.find(page => page.title === trimmed || normalizeSlug(page.slug) === normalizeSlug(trimmed));
  if (exact) {
    return exact;
  }

  const lowered = trimmed.toLowerCase();
  return others.find(page => page.title.toLowerCase() === lowered
    || normalizeSlug(page.slug).toLowerCase() === normalizeSlug(lowered));
}

/**
 * Fold freshly derived links into a page's existing set.
 *
 * Declared links are kept exactly as they are. Previously derived links are
 * replaced wholesale, because they describe a canvas that has since changed and
 * keeping the old ones would leave links to boxes that no longer exist. A
 * derived link pointing at a page a declared link already covers is dropped, so
 * the same destination is not listed twice.
 */
export function mergeDerivedLinks(
  existing: readonly WebsitePageLink[],
  derived: readonly WebsitePageLink[],
): WebsitePageLink[] {
  const declared = existing.filter(link => link.origin === 'declared');
  const declaredTargets = new Set(
    declared.map(link => link.targetPageId ?? link.externalUrl).filter((value): value is string => Boolean(value)),
  );

  const fresh = derived.filter(link => {
    const target = link.targetPageId ?? link.externalUrl;
    return target !== undefined && !declaredTargets.has(target);
  });

  return [...declared, ...fresh].slice(0, MAX_LINKS_PER_PAGE);
}
