import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  listChangelogVersions,
  normalizeDashboardPromptRequest,
  parseGhReleaseList,
} from '../../src/views/projectDashboardPanel.ts';

/**
 * The dashboard nav is rendered by `media/projectDashboard.js`, but prompts
 * raised from a page are validated against `DASHBOARD_PAGE_IDS` in
 * `src/views/projectDashboardPanel.ts`. Those two lists are in different files
 * and different languages, and they have drifted before: `privacy` shipped in
 * the nav while missing from the allowlist, silently dropping `sourcePage` on
 * every "Ask Atlas" raised from that page.
 *
 * These tests read the real nav definition out of the webview script so a page
 * added to one side cannot quietly go missing from the other.
 */

const WEBVIEW_SCRIPT = readFileSync(
  path.join(process.cwd(), 'media', 'projectDashboard.js'),
  'utf8',
);

/** Extract the `PAGE_GROUPS` nav definition from the webview script. */
function readNavGroups(): Array<{ id: string; label: string; pages: string[] }> {
  const start = WEBVIEW_SCRIPT.indexOf('const PAGE_GROUPS = [');
  expect(start, 'PAGE_GROUPS not found in media/projectDashboard.js').toBeGreaterThan(-1);
  const end = WEBVIEW_SCRIPT.indexOf('\n  ];', start);
  expect(end, 'PAGE_GROUPS terminator not found').toBeGreaterThan(start);
  const block = WEBVIEW_SCRIPT.slice(start, end);

  const groups: Array<{ id: string; label: string; pages: string[] }> = [];
  for (const chunk of block.split(/\n\s*\{\s*\n/).slice(1)) {
    const id = /id:\s*'([^']+)'/.exec(chunk)?.[1];
    const label = /label:\s*'([^']+)'/.exec(chunk)?.[1];
    if (!id || !label) {
      continue;
    }
    const pages = [...chunk.matchAll(/\['([A-Za-z]+)',\s*'[^']*'\]/g)].map(match => match[1]!);
    groups.push({ id, label, pages });
  }
  return groups;
}

describe('dashboard nav definition', () => {
  const groups = readNavGroups();
  const navPages = groups.flatMap(group => group.pages);

  it('groups every tab into a labelled cluster', () => {
    // Floors, so a regex that stops matching fails loudly instead of turning
    // every assertion below into a vacuous pass over an empty list.
    expect(groups.length).toBeGreaterThanOrEqual(3);
    expect(navPages.length).toBeGreaterThanOrEqual(10);
    expect(navPages).toContain('overview');
    for (const group of groups) {
      expect(group.pages.length, `group "${group.label}" is empty`).toBeGreaterThan(0);
      expect(group.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('lists every nav page exactly once', () => {
    expect(new Set(navPages).size).toBe(navPages.length);
  });

  it('keeps every nav page valid as a prompt sourcePage', () => {
    // If a page is in the nav but not in DASHBOARD_PAGE_IDS, the normaliser
    // drops sourcePage and "Ask Atlas" loses the origin page.
    for (const page of navPages) {
      expect(
        normalizeDashboardPromptRequest({ prompt: 'Look at this', sourcePage: page }),
        `nav page "${page}" is missing from DASHBOARD_PAGE_IDS`,
      ).toEqual({ prompt: 'Look at this', sourcePage: page });
    }
  });

  it('renders a panel for every nav page', () => {
    // pageSectionOpen(id) emits the tabpanel; a nav entry with no matching call
    // would render a tab that reveals nothing.
    for (const page of navPages) {
      expect(
        WEBVIEW_SCRIPT.includes(`pageSectionOpen('${page}')`),
        `nav page "${page}" has no pageSectionOpen call`,
      ).toBe(true);
    }
  });

  it('puts ideation under Where we stand and keeps it a valid prompt origin', () => {
    // The dashboard is the stage-0 overview; the dedicated panel remains the
    // canvas. Both paths rely on the same page id, so it must be a genuine tab
    // as well as a valid sourcePage for an Ask Atlas prompt.
    expect(navPages).toContain('ideation');
    expect(groups.find(group => group.id === 'stand')?.pages).toContain('ideation');
    expect(normalizeDashboardPromptRequest({ prompt: 'x', sourcePage: 'ideation' }))
      .toEqual({ prompt: 'x', sourcePage: 'ideation' });
  });

  it('renders the stage-0 evidence bridge without making the dashboard a board writer', () => {
    expect(WEBVIEW_SCRIPT).toContain('function renderIdeation(snapshot)');
    expect(WEBVIEW_SCRIPT).toContain("type: 'addIdeationEvidence'");
    expect(WEBVIEW_SCRIPT).toContain('data-action="ideation-evidence"');
  });

  it('normalises an unknown activePage back to overview in the webview', () => {
    // Guards the blank-dashboard failure mode: state.activePage used to be
    // assigned straight from the click payload and the host navigate message.
    expect(WEBVIEW_SCRIPT).toContain('function normalizePageId(');
    expect(WEBVIEW_SCRIPT).toMatch(/state\.activePage\s*=\s*normalizePageId\(/);
  });
});

describe('testing methodology guidance', () => {
  it('uses the shared Settings catalogue instead of a labels-only dashboard copy', () => {
    expect(WEBVIEW_SCRIPT).toContain('testing.methodologyDefinitions');
    expect(WEBVIEW_SCRIPT).toContain('methodology-dashboard-description');
    expect(WEBVIEW_SCRIPT).toContain('When to use it and the trade-offs');
    expect(WEBVIEW_SCRIPT).not.toContain('const METHODOLOGY_DEFS = [');
  });

  it('offers a host-confirmed repair action for every activated test surface', () => {
    expect(WEBVIEW_SCRIPT).toContain('Fix activated testing');
    expect(WEBVIEW_SCRIPT).toContain("type: 'fixActivatedTesting'");
    expect(WEBVIEW_SCRIPT).toContain('normal tool approvals');
  });
});

describe('dashboard motion safety', () => {
  it('honours prefers-reduced-motion in both CSS and script', () => {
    const panel = readFileSync(
      path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'),
      'utf8',
    );
    expect(panel).toContain('@media (prefers-reduced-motion: reduce)');
    expect(WEBVIEW_SCRIPT).toContain('prefers-reduced-motion: reduce');
  });

  it('drives value animations from script rather than bare CSS transitions', () => {
    // A CSS transition cannot interpolate across the wholesale innerHTML swap in
    // render(); the score ring, metric meters and MVP bar were all inert because
    // of it. applyValueAnimations() is what makes them move.
    expect(WEBVIEW_SCRIPT).toContain('function applyValueAnimations(');
    expect(WEBVIEW_SCRIPT).toMatch(/data-anim-key="score-ring"/);
  });
});

/**
 * The changelog check that could not fail.
 *
 * `changelogHasCurrentVersion` used to be derived as "does `CHANGELOG.md`
 * exist", which meant the single most commonly missing thing at release time —
 * an entry for the version about to ship — was reported as present on every
 * repository that had ever written a changelog at all. Stage 6 read as complete
 * on a changelog whose last entry was six versions old.
 */
describe('listChangelogVersions', () => {
  it('reads the versions a changelog actually documents', () => {
    const doc = [
      '# Changelog',
      '',
      '## [0.3.0] - 2026-07-29',
      '- New.',
      '',
      '## [0.2.1]',
      '- Older.',
      '',
      '## 0.2.0 — codename',
      '- Oldest.',
    ].join('\n');
    expect(listChangelogVersions(doc)).toEqual(['0.3.0', '0.2.1', '0.2.0']);
  });

  it('does not report a version the document has no entry for', () => {
    // The regression: presence of the file is not presence of the entry.
    expect(listChangelogVersions('# Changelog\n\n## [0.1.0]\n- Old.\n')).not.toContain('0.2.0');
  });

  it('ignores headings that are not versions', () => {
    expect(listChangelogVersions('# Changelog\n\n## [Unreleased]\n\n## Notes\n')).toEqual([]);
  });

  it('is total — nothing usable in, empty list out', () => {
    expect(listChangelogVersions(undefined)).toEqual([]);
    expect(listChangelogVersions('')).toEqual([]);
    expect(listChangelogVersions('no headings at all')).toEqual([]);
  });
});

describe('parseGhReleaseList', () => {
  it('keeps the flags that decide whether a release counts as a deployment', () => {
    const raw = JSON.stringify([
      { tagName: 'v1.0.0', publishedAt: '2026-01-01T00:00:00Z' },
      { tagName: 'v1.1.0-rc.1', publishedAt: '2026-01-02T00:00:00Z', isPrerelease: true },
      { tagName: 'v1.1.0', isDraft: true },
    ]);
    expect(parseGhReleaseList(raw)).toEqual([
      { tagName: 'v1.0.0', publishedAt: '2026-01-01T00:00:00Z' },
      { tagName: 'v1.1.0-rc.1', publishedAt: '2026-01-02T00:00:00Z', isPrerelease: true },
      { tagName: 'v1.1.0', isDraft: true },
    ]);
  });

  it('never throws, whatever gh returns', () => {
    expect(parseGhReleaseList('not json')).toEqual([]);
    expect(parseGhReleaseList('{}')).toEqual([]);
    expect(parseGhReleaseList('[null, 3, {"tagName": ""}]')).toEqual([]);
  });
});
