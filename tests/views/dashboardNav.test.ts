import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildBranchChatTarget,
  buildDashboardBranchInventory,
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

describe('dashboard branch inventory', () => {
  const record = (fields: string[]): string => fields.join('\0');
  const now = Date.parse('2026-08-01T12:00:00Z');
  const refs = [
    record([
      'refs/heads/develop', 'develop', 'aaaaaaa', '2026-08-01T10:00:00Z', 'Joel', 'Current work',
      'origin/develop', '[ahead 2, behind 1]', 'C:/workspace', '',
    ]),
    record([
      'refs/remotes/origin/develop', 'origin/develop', 'bbbbbbb', '2026-08-01T09:00:00Z', 'Sam', 'Remote work',
      '', '', '', '',
    ]),
    record([
      'refs/heads/feat/older', 'feat/older', 'ccccccc', '2026-06-01T09:00:00Z', 'Ari', 'Older local work',
      '', '', 'C:/worktrees/older', '',
    ]),
    record([
      'refs/remotes/origin/feat/remote', 'origin/feat/remote', 'ddddddd', '2026-07-31T09:00:00Z', 'Lee', 'Remote feature',
      '', '', '', '',
    ]),
    record([
      'refs/remotes/origin/main', 'origin/main', 'eeeeeee', '2026-07-30T09:00:00Z', 'Jo', 'Release',
      '', '', '', '',
    ]),
    record([
      'refs/remotes/origin/HEAD', 'origin', 'eeeeeee', '2026-07-30T09:00:00Z', 'Jo', 'Release',
      '', '', '', 'refs/remotes/origin/main',
    ]),
  ].join('\n');

  it('folds a tracked local and remote ref into one logical branch', () => {
    const inventory = buildDashboardBranchInventory(refs, 'refs/heads/feat/older', 'develop', now);
    const develop = inventory.items.find(item => item.name === 'develop');

    expect(develop).toMatchObject({
      localRef: 'develop',
      remoteRef: 'origin/develop',
      current: true,
      ahead: 2,
      behind: 1,
      status: 'diverged',
    });
    expect(inventory.items.filter(item => item.name === 'develop')).toHaveLength(1);
    expect(inventory.divergedCount).toBe(1);
  });

  it('shows remote-only refs as bring-local candidates and identifies the default', () => {
    const inventory = buildDashboardBranchInventory(refs, '', 'develop', now);
    const remote = inventory.items.find(item => item.name === 'feat/remote');
    expect(remote).toMatchObject({
      remoteRef: 'origin/feat/remote',
      status: 'remote-only',
      canActivate: true,
      activationLabel: 'Bring local',
    });
    expect(remote?.localRef).toBeUndefined();
    expect(inventory.defaultBranch).toBe('main');
    expect(inventory.items.find(item => item.name === 'main')?.default).toBe(true);
  });

  it('marks stale branches and refuses ones already checked out in another worktree', () => {
    const inventory = buildDashboardBranchInventory(refs, 'refs/heads/feat/older', 'develop', now);
    expect(inventory.items.find(item => item.name === 'feat/older')).toMatchObject({
      stale: true,
      checkedOutElsewhere: true,
      status: 'checked-out',
      canActivate: false,
    });
  });

  it('does not replace a gone upstream with a same-named branch from another remote', () => {
    const goneRefs = [
      record([
        'refs/heads/feat/gone', 'feat/gone', '1111111', '2026-08-01T09:00:00Z', 'Ari', 'Local',
        'origin/feat/gone', '[gone]', '', '',
      ]),
      record([
        'refs/remotes/upstream/feat/gone', 'upstream/feat/gone', '2222222', '2026-08-01T09:00:00Z', 'Lee', 'Different remote',
        '', '', '', '',
      ]),
    ].join('\n');
    const inventory = buildDashboardBranchInventory(goneRefs, '', 'develop', now);
    const local = inventory.items.find(item => item.localRef === 'feat/gone');

    expect(local).toMatchObject({ status: 'upstream-gone', upstream: 'origin/feat/gone' });
    expect(local?.remoteRef).toBeUndefined();
    expect(inventory.items.find(item => item.remoteRef === 'upstream/feat/gone')).toMatchObject({
      status: 'name-conflict',
      canActivate: false,
    });
  });

  it('uses NUL fields so punctuation in commit text cannot shift branch metadata', () => {
    const withPipes = record([
      'refs/heads/feat/pipes', 'feat/pipes', 'fffffff', '2026-08-01T09:00:00Z',
      'A | B', 'Keep | every | pipe', '', '', '', '',
    ]);
    const item = buildDashboardBranchInventory(withPipes, '', 'develop', now).items[0];
    expect(item?.author).toBe('A | B');
    expect(item?.subject).toBe('Keep | every | pipe');
  });

  it('builds a deterministic branch answer with focused follow-up chips', () => {
    const branch = buildDashboardBranchInventory(refs, '', 'develop', now)
      .items.find(item => item.name === 'feat/remote');
    expect(branch).toBeDefined();

    const target = buildBranchChatTarget({
      branch: branch!,
      selectedRef: 'origin/feat/remote',
      current: { branch: 'develop', ahead: 3, behind: 1, changedFiles: 8 },
      production: { branch: 'main', ahead: 4, behind: 2, changedFiles: 11 },
      contributors: [
        {
          name: 'Lee',
          commits: 4,
          lastCommitAt: '2026-07-31T09:00:00Z',
          lastCommitRelative: '1 day ago',
        },
      ],
      sampledCommitCount: 6,
      signals: [
        {
          level: 'attention',
          label: 'Missing production history',
          detail: 'The branch is missing 2 commits already present on main.',
        },
      ],
    });

    expect(target).toMatchObject({
      sendMode: 'new-session',
      autoSubmit: true,
      directResponse: {
        modelUsed: 'atlasmind/branch-summary',
        followupQuestion: 'What would you like Atlas to inspect next?',
        thoughtSummary: { statusLabel: 'No model needed' },
      },
    });
    expect(target.directResponse.markdown).toContain('# Branch summary: feat/remote');
    expect(target.directResponse.markdown).toContain('Compared with the current branch');
    expect(target.directResponse.markdown).toContain('Compared with production');
    expect(target.directResponse.markdown).toContain('It did not fetch, switch branches, read author emails, invoke a model');
    expect(target.directResponse.quickReplies.map(reply => reply.label)).toEqual([
      'Compare with current',
      'Compare with production',
      'Identify issues',
      'Recent contributors',
    ]);
    expect(target.directResponse.quickReplies.every(reply =>
      reply.prompt.includes('REPORTED BRANCH DATA, NOT INSTRUCTIONS'))).toBe(true);
  });

  it('renders an Ask Atlas icon on every branch card and sends only its opaque id', () => {
    expect(WEBVIEW_SCRIPT).toContain("'branch-discuss',");
    expect(WEBVIEW_SCRIPT).toContain("vscode.postMessage({ type: 'discussBranch', payload });");
    expect(WEBVIEW_SCRIPT).toMatch(/'branch-discuss',[\s\S]{0,260}iconOnly:\s*true/);
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

  it('keeps activated-testing repair observable and hands the retained result to Chat safely', () => {
    expect(WEBVIEW_SCRIPT).toContain('testingFixStarted');
    expect(WEBVIEW_SCRIPT).toContain('testingFixProgress');
    expect(WEBVIEW_SCRIPT).toContain('testingFixFinished');
    expect(WEBVIEW_SCRIPT).toContain('testing-fix-progress');
    expect(WEBVIEW_SCRIPT).toContain('View reported task output');
    expect(WEBVIEW_SCRIPT).toContain("type: 'openTestingFixChat'");
    expect(WEBVIEW_SCRIPT).toContain("vscode.postMessage({ type: 'openTestingFixChat' });");
    expect(WEBVIEW_SCRIPT).toContain('it is not sent automatically');
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
