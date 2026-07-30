import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAttentionFeed } from '../../src/core/attentionFeed.ts';

/**
 * The seam between the attention feed and the Overview that renders it.
 *
 * `attentionFeed.ts` is pure and fully unit-tested, so the interesting failures
 * are all on this side of the boundary and all of them are silent: a card that
 * routes to a page id nobody defines does nothing when clicked, and a band that
 * is never called from `renderOverview` simply never appears. Neither shows up
 * in a type error, because the page id is a string in one file and a union in
 * another, and the renderer is a function in a webview script.
 */

const root = process.cwd();
const read = (relative: string) => readFileSync(path.join(root, relative), 'utf8');

const panel = read('src/views/projectDashboardPanel.ts');
const feedSource = read('src/core/attentionFeed.ts');
const webview = read('media/projectDashboard.js');

/** The page ids the dashboard router will actually accept. */
const pageIds = (() => {
  const block = /const DASHBOARD_PAGE_IDS = \[([\s\S]*?)\] as const;/.exec(panel);
  expect(block, 'DASHBOARD_PAGE_IDS not found — the test is reading the wrong shape').toBeTruthy();
  return new Set([...block![1]!.matchAll(/'([a-zA-Z]+)'/g)].map(match => match[1]!));
})();

/**
 * The body of `renderAttentionBand`, sliced between its own declaration and the
 * next one. Line endings are CRLF in this repository, so a regex anchored on
 * `\n  }` alone silently matches nothing and every assertion below would pass
 * vacuously — which is exactly the class of failure these tests exist to catch.
 */
function attentionBandSource(): string {
  const start = webview.indexOf('function renderAttentionBand(snapshot)');
  const end = webview.indexOf('function renderOverviewNextActions(snapshot)', start);
  expect(start, 'renderAttentionBand not found').toBeGreaterThan(-1);
  expect(end, 'renderOverviewNextActions not found after it').toBeGreaterThan(start);
  return webview.slice(start, end);
}

describe('every attention card goes somewhere real', () => {
  it('routes only to declared dashboard pages', () => {
    // A `pageTarget` is a free-form string in the rule table and a union member
    // in the router. Nothing but this test connects the two.
    const targets = [...feedSource.matchAll(/pageTarget: '([a-zA-Z]+)'/g)].map(match => match[1]!);
    expect(targets.length).toBeGreaterThan(10);
    for (const target of new Set(targets)) {
      expect(pageIds, `attention rule routes to unknown page "${target}"`).toContain(target);
    }
  });

  it('is rendered from the Overview rather than merely defined', () => {
    expect(webview).toContain('function renderAttentionBand(');
    // Above the stat grid: the band is the only thing here that can be empty,
    // and an empty band below nine always-populated cards is a band nobody sees
    // on the days it has something to say.
    const overview = /function renderOverview\(snapshot\)[\s\S]*?\n  }/.exec(webview);
    expect(overview).toBeTruthy();
    const body = overview![0]!;
    expect(body).toContain('renderAttentionBand(snapshot)');
    expect(body.indexOf('renderAttentionBand(snapshot)')).toBeLessThan(body.indexOf('stats-grid'));
  });
});

describe('the mapping keeps "unassessed is not clear"', () => {
  it('reads the release plan\'s own blocked list rather than recounting gates', () => {
    // `blockedBy` already encodes "an `unknown` gate is not a pass". Counting
    // `status === 'fail'` here instead would quietly turn every unknown into a
    // pass, on the one page where that mistake cannot be undone.
    expect(panel).toContain('snapshot.release.plan.blockedBy.length');
  });

  it('treats a never-scanned debt register as unscanned, not empty', () => {
    expect(panel).toContain('scanned: snapshot.debt.lastScanAt !== undefined');
  });

  it('treats an unfetched CI reading as unknown, not healthy', () => {
    expect(panel).toContain('loaded: latestCiConclusion !== undefined');
  });

  it('reports an issue tracker with no summary as unreadable', () => {
    // `status === 'ready'` alone would let a summary-less snapshot render as
    // "0 stale", which is a count nobody produced.
    expect(panel).toMatch(/snapshot\.issues\.status === 'ready' && snapshot\.issues\.summary/);
  });
});

describe('the band disappears when there is nothing to say', () => {
  it('produces no cards for a cleared project', () => {
    // The property that separates this from the twelve-card shortcut grid that
    // was removed from this page. Asserted on the feed, since the renderer's
    // empty branch is driven entirely by `totalCount`.
    const feed = buildAttentionFeed({
      testing: { failing: 0, hasReport: true, uncovered: 0 },
      pipeline: { latestFailed: false, loaded: true },
      issues: { loaded: true, stale: 0, unassigned: 0 },
      ssot: { blocked: 0, warned: 0 },
      risk: { assessed: true, open: 0 },
    });
    expect(feed.totalCount).toBe(0);
    expect(feed.emptyState).toBe('clear');
  });

  it('takes its empty-state sentence from the module rather than restating it', () => {
    // Two renderings phrasing the same counts their own way is how "3
    // unassessed" becomes "all clear" on one screen and not the other.
    const band = attentionBandSource();
    expect(band).toContain('escapeHtml(feed.summary)');
    expect(band).toContain("feed.emptyState === 'clear'");
    // The unexamined case is the only one that offers a way out of itself.
    expect(band).toContain('Work through the setup');
  });

  it('leaves the delta out unless something actually moved', () => {
    // `first-look` and `unchanged` are worth explaining and the Workflow page
    // explains them. Repeating that here would make the band permanently
    // non-empty, which is the whole failure this design avoids.
    const band = /const moved = delta && delta\.status === 'changed' && delta\.changes\.length > 0/.exec(webview);
    expect(band).toBeTruthy();
  });

  it('never grows a second "Mark as seen"', () => {
    // The delta advances exactly once, and the Workflow page owns that control.
    // A second one here would clear a delta the user had not read.
    const band = attentionBandSource();
    expect(band).not.toContain('delta-seen');
    expect(band).toContain('data-payload="workflow"');
  });
});
