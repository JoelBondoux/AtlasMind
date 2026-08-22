import { readFileSync } from 'node:fs';
import path from 'node:path';

// jsdom ships no type declarations, and `tsconfig.test.json` carries no DOM lib
// — so nothing reached through the mounted window is typed here. Same standing
// cost, and same containment, as `roadmapCanvasDom.test.ts`.
// @ts-expect-error -- no `@types/jsdom` in this repository
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { PROJECT_DASHBOARD_VIEW_TYPE } from '../../src/views/webviewUtils.js';

/**
 * A dashboard that has lost its host must say so.
 *
 * Reported as "the Delivery runbook's copy and send to terminal do not work".
 * Every link in that chain was correct: the buttons carry the right
 * `data-action`, the click delegate has a branch for each, the payload passes
 * the host's validator, the handlers exist and resolve. What had gone was the
 * *channel* — the panel was a leftover from before an extension update, so the
 * `ProjectDashboardPanel` that owned `onDidReceiveMessage` no longer existed
 * and every message posted into nothing.
 *
 * From inside the webview that is indistinguishable from a wired-up page:
 * hover works, moving between pages works because it is local, and the console
 * stays clean because nothing threw. The only visible symptom was the Refresh
 * button spinning for ever, which is precisely the tell this file pins — not
 * that the runbook works, but that when nothing can work, somebody is told.
 */

const WATCHDOG_MS = 20000;

const WEBVIEW = readFileSync(path.join(process.cwd(), 'media', 'projectDashboard.js'), 'utf8')
  .replace(
    'renderError(error instanceof Error ? error.message : String(error));',
    'window.__renderError = error; renderError(error instanceof Error ? error.message : String(error));',
  );

/** Anything reached through the mounted window. See the import note above. */
type Mounted = ReturnType<typeof Object.create>;

interface Harness {
  window: Mounted;
  posted: Array<{ type?: string; payload?: unknown }>;
  send(message: unknown): void;
  root(): Mounted;
  html(): string;
  click(selector: string): void;
  /** Fire only the watchdog's timer, leaving animation and cadence timers alone. */
  expireHostWatchdog(): void;
  pendingWatchdogs(): number;
}

function mount(): Harness {
  const dom = new JSDOM(
    `<!doctype html><html><body>
       <div id="dashboard-version-strip"></div>
       <span id="dashboard-project-name"></span>
       <span id="dashboard-project-summary"></span>
       <span id="dashboard-provenance"></span>
       <span id="dashboard-score-chip"></span>
       <button id="dashboard-refresh" type="button"><span class="refresh-button-label">Refresh</span></button>
       <div id="dashboard-root"></div>
     </body></html>`,
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://atlasmind.test/' },
  );
  const { window } = dom;
  const posted: Array<{ type?: string; payload?: unknown }> = [];

  (window as unknown as { acquireVsCodeApi: unknown }).acquireVsCodeApi = () => ({
    postMessage: (message: unknown) => { posted.push(message as { type?: string }); },
    getState: () => undefined,
    setState: () => undefined,
  });
  (window as unknown as { matchMedia: unknown }).matchMedia = () => ({
    matches: false,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  window.Element.prototype.scrollIntoView = () => undefined;
  (window.Element.prototype as unknown as { setPointerCapture: unknown }).setPointerCapture = () => undefined;
  (window.Element.prototype as unknown as { releasePointerCapture: unknown }).releasePointerCapture = () => undefined;

  // Only the watchdog is driven by hand. Firing every pending timer would drag
  // in the value animations and the CI refresh cadence, whose side effects have
  // nothing to do with what is under test — so the fake keeps them queued and
  // this harness fires the one delay the watchdog uses.
  const scheduled = new Map<number, { fn: () => void; delay: number }>();
  let nextTimerId = 1;
  (window as unknown as { setTimeout: unknown }).setTimeout = (fn: () => void, delay: number) => {
    const id = nextTimerId++;
    scheduled.set(id, { fn, delay });
    return id;
  };
  (window as unknown as { clearTimeout: unknown }).clearTimeout = (id: number) => {
    scheduled.delete(id);
  };

  window.eval(WEBVIEW);

  const root = (): Mounted => window.document.getElementById('dashboard-root');
  const watchdogIds = (): number[] => [...scheduled.entries()]
    .filter(([, timer]) => timer.delay === WATCHDOG_MS)
    .map(([id]) => id);

  return {
    window,
    posted,
    send(message: unknown) {
      (window as unknown as { __renderError?: Error }).__renderError = undefined;
      window.dispatchEvent(new window.MessageEvent('message', { data: message }));
      const thrown = (window as unknown as { __renderError?: Error }).__renderError;
      if (thrown !== undefined) {
        throw new Error(`the dashboard failed to render: ${thrown.message}\n${thrown.stack ?? ''}`);
      }
    },
    root,
    html: () => root().innerHTML,
    click(selector: string) {
      const target = root().querySelector(selector);
      expect(target, `nothing matched ${selector}`).not.toBeNull();
      target.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    },
    expireHostWatchdog() {
      const ids = watchdogIds();
      expect(ids.length, 'no host watchdog was armed').toBeGreaterThan(0);
      for (const id of ids) {
        const timer = scheduled.get(id);
        scheduled.delete(id);
        timer?.fn();
      }
    },
    pendingWatchdogs: () => watchdogIds().length,
  };
}

/** The smallest snapshot every page renderer will accept. */
function snapshot() {
  const series: unknown[] = [];
  const graph = {
    active: [], completed: [], completedColumns: [], retainedIds: [], edges: [], suggested: [],
    layers: [], cycles: [], notes: [], rules: [], suggestLinks: true, orientation: 'horizontal',
    anchored: true, routes: {}, people: [], filePath: 'project_memory/roadmap/improvement-plan.md',
  };
  return {
    type: 'state',
    payload: {
      generatedAt: '2026-08-20T12:00:00.000Z',
      ssotPresent: true,
      workspaceName: 'AtlasMind',
      workspaceRootLabel: 'AtlasMind',
      repositoryLabel: 'JoelBondoux/AtlasMind',
      currentBranch: 'develop',
      versions: { current: { version: '0.374.0', branch: 'develop' }, production: undefined },
      versionStrip: { pills: [], source: 'branches', overflowCount: 0 },
      healthScore: 70,
      healthSummary: 'Healthy',
      stats: [],
      charts: { commits: series, runs: series, memory: series, contributors: [], contributorTotal: 0 },
      repo: { dirty: false, ahead: 0, behind: 0, staged: 0, modified: 0, untracked: 0, branchCount: 1, branches: [], commits: [] },
      branches: { items: [], dirty: false, grouping: 'none', search: '', warnings: [], nonConforming: [], cleanup: { candidates: [] } },
      runtime: {
        enabledAgents: 0, totalAgents: 0, enabledSkills: 0, totalSkills: 0,
        healthyProviders: 0, totalProviders: 0, enabledModels: 0, totalModels: 0,
        sessionCount: 0, projectRunCount: 0, activeSessionId: '', autopilot: false,
        totalCostUsd: 0, totalRequests: 0, totalInputTokens: 0, totalOutputTokens: 0,
        tdd: { total: 0, withEvidence: 0, missing: 0, blocked: 0, percent: 0, detail: '' },
        runs: [], sessions: [],
      },
      testing: {
        methodologies: [], methodologyDefinitions: [], tests: [], categories: [],
        policyCoverage: { rows: [], summary: { covered: 0, gaps: 0, failing: 0 } },
        policyDetails: { details: [], rules: [] },
        frameworks: [], suites: [], report: undefined, subjects: { policies: [] },
        technicalControls: { entries: [] }, projectTestingConfig: undefined,
      },
      ssot: {
        path: 'project_memory', totalEntries: 0, totalFilesOnDisk: 0, coveragePercent: 0,
        coverage: [], recentFiles: [], warnedEntries: 0, blockedEntries: 0,
        delta: { entries: [], summary: '', checkedAt: '' },
      },
      guidedWorkflow: {
        config: undefined, stages: [], blockers: [], pullRequestRecords: [], labels: [],
        ci: { workflows: [], runs: [] }, release: {}, health: {}, commitSeries: series,
        delta: undefined, pullRequests: { open: [], counts: {} },
      },
      githubLinks: { slug: '', links: {} },
      issues: { status: 'unavailable', issues: [], busy: false, counts: { open: 0, unassigned: 0, stale: 0 } },
      taxonomy: { labels: [], milestones: [], drift: { declaredMissing: [], undeclaredUsed: [] } },
      security: {
        policyPresent: false, codeownersPresent: false, prTemplatePresent: false, workflowCount: 0,
        findings: [], reviews: [], governanceProviders: [], assetsPresent: 0,
        review: { findings: [], lastRun: undefined },
      },
      delivery: {
        config: undefined, stages: [], promotions: [], history: [], blockers: [], keyScripts: [],
        guide: undefined, artifacts: [], ciSignals: [], reviewReadiness: [], workflows: [],
        dependencyCount: 0, devDependencyCount: 0, packageVersion: '0.374.0', scriptCount: 0,
      },
      release: { gates: [], notes: '', version: '', blockedBy: [], metrics: {} },
      debt: { entries: [], summary: { open: 0, serious: 0 }, lastScanAt: undefined, rules: [] },
      workAssignments: { targets: [] },
      director: { config: undefined, followUps: [], assignments: [], teamMode: 'solo', overdueCount: 0 },
      documents: { config: undefined, autoUpdate: [], shelves: [] },
      risk: { findings: [], lastRun: undefined, score: undefined, matrix: [], domains: [], openCount: 0, trend: [], history: [], summary: '' },
      score: {
        total: 0, maxTotal: 0, components: [], recommendations: [],
        outcome: { desiredOutcome: '', score: 0, summary: '', referenceCoveragePercent: 0, roadmapCompleted: 0, roadmapTotal: 0, runCompletionPercent: 0, signals: [] },
      },
      ideation: { cards: [], connections: [], readiness: { observations: [] }, workspaces: [] },
      gapAnalysis: { completed: false, items: [], lastRun: null },
      privacy: {
        enabled: false, rules: [], compliancePacks: [], trustedModelIds: [], providers: [], packs: [],
        activity: { total: 0, blocked: 0, warned: 0, redactedCount: 0, entries: [], bySource: [], byRule: [], recent: [] },
      },
      attention: { items: [], emptyState: 'unexamined', summary: '', remainder: 0 },
      roadmap: {
        filePath: 'project_memory/roadmap/improvement-plan.md',
        items: [], completedCount: 0, outstandingCount: 0, nextSuggestedWork: [],
        mvp: { hasTaggedItems: false, totalCount: 0, completedCount: 0, progressPercent: 0, route: [], candidates: [], summary: '', planPrompt: '' },
        boardBacklog: { total: 0, needsAttention: 0 },
        gates: [], gateRoutes: {}, graph,
      },
    },
  };
}

describe('a dashboard whose host has gone says so', () => {
  it('arms a watchdog on the opening request rather than loading for ever', () => {
    const harness = mount();
    // The panel posts `ready` on load; nothing answers it here, which is exactly
    // what a restored panel with no host experiences.
    expect(harness.posted.map(message => message.type)).toContain('ready');
    expect(harness.pendingWatchdogs(), 'the opening request must be watched').toBe(1);

    harness.expireHostWatchdog();

    // A panel restored without a host never leaves the no-snapshot branch, so
    // that branch is the one that has to stop claiming to be loading.
    expect(harness.html()).not.toContain('Loading dashboard signals…');
    expect(harness.html()).toContain('no longer connected to AtlasMind');
  });

  it('names closing and reopening the tab, because no button in here can reach a host that is gone', () => {
    const harness = mount();
    harness.expireHostWatchdog();
    const html = harness.html();
    // The instruction is the fix. "Try again" is offered too, but a banner whose
    // only affordance posts into the same dead channel would repeat the original
    // failure with more ceremony.
    expect(html).toContain('AtlasMind: Open Project Dashboard');
    expect(html).toContain('data-action="host-retry"');
  });

  it('clears itself the moment anything arrives from the host', () => {
    const harness = mount();
    harness.expireHostWatchdog();
    expect(harness.html()).toContain('no longer connected to AtlasMind');

    harness.send(snapshot());

    expect(harness.html()).not.toContain('no longer connected to AtlasMind');
  });

  it('treats any host message as proof of life, not only a snapshot', () => {
    // A long refresh reports progress before it reports a result. A watchdog
    // cleared only by `state` would fire in the middle of one that is working
    // perfectly well.
    const harness = mount();
    harness.send({ type: 'repositoryRefreshBusy', payload: true });
    expect(harness.pendingWatchdogs()).toBe(0);
  });

  it('is cleared by the bare acknowledgement the host sends before doing anything slow', () => {
    // Collecting a cold snapshot reaches git, the filesystem and the routine
    // registry. Waiting for the *result* would report a slow machine as a
    // disconnected one — the same lie in the more damaging direction, since it
    // teaches the reader to dismiss the banner.
    const harness = mount();
    expect(harness.pendingWatchdogs()).toBe(1);
    harness.send({ type: 'hostAck' });
    expect(harness.pendingWatchdogs()).toBe(0);
  });

  it('stops the Refresh spinner it disproved', () => {
    const harness = mount();
    harness.send(snapshot());
    harness.window.document.getElementById('dashboard-refresh')
      ?.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));

    const refresh = harness.window.document.getElementById('dashboard-refresh');
    expect(refresh?.getAttribute('aria-busy'), 'the refresh should start busy').toBe('true');

    harness.expireHostWatchdog();

    // The spinner is the lie being corrected: nothing is in progress.
    expect(refresh?.getAttribute('aria-busy')).toBe('false');
    expect(harness.html()).toContain('no longer connected to AtlasMind');
  });

  it('re-arms rather than clearing when the retry also goes unanswered', () => {
    const harness = mount();
    harness.expireHostWatchdog();
    harness.posted.length = 0;

    harness.click('[data-action="host-retry"]');

    // The same request the Refresh button makes, rather than a second recovery
    // path that could work while the ordinary one does not.
    expect(harness.posted.map(message => message.type)).toEqual(['refresh']);
    expect(harness.pendingWatchdogs(), 'the retry must be watched too').toBe(1);
    expect(harness.html(), 'a retry is not evidence of a reply').toContain('no longer connected to AtlasMind');
  });
});

describe('a restored dashboard is given its host back', () => {
  const commands = readFileSync(path.join(process.cwd(), 'src', 'commands.ts'), 'utf8');
  const panel = readFileSync(path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'), 'utf8');

  it('registers a serializer for the view type the panel actually creates', () => {
    // Registered under the wrong view type, a serializer simply never fires and
    // nothing reports that — so both sides read the one exported constant.
    expect(PROJECT_DASHBOARD_VIEW_TYPE).toBe('atlasmind.projectDashboard');
    expect(commands).toMatch(/registerWebviewPanelSerializer\(PROJECT_DASHBOARD_VIEW_TYPE/);
    expect(panel).not.toMatch(/const PROJECT_DASHBOARD_VIEW_TYPE\s*=/);
    expect(panel).toMatch(/PROJECT_DASHBOARD_VIEW_TYPE.*from '\.\/webviewUtils\.js'/s);
  });

  it('re-applies the webview capabilities a restored panel does not keep', () => {
    // A restored panel keeps its content and not its options. Without
    // `localResourceRoots` the script this panel is entirely made of is blocked,
    // which would revive it into a blank page.
    const revive = panel.slice(panel.indexOf('public static revive('));
    expect(revive).toMatch(/panel\.webview\.options\s*=/);
    expect(revive).toContain('localResourceRoots');
    expect(revive).toContain('enableScripts: true');
  });

  it('never adopts a second host for a view type that already has one', () => {
    const revive = panel.slice(panel.indexOf('public static revive('), panel.indexOf('private constructor('));
    expect(revive).toMatch(/if \(ProjectDashboardPanel\.currentPanel\) \{[\s\S]{0,300}?panel\.dispose\(\);/);
  });

  it('acknowledges a message before the work it triggers', () => {
    // Order is the whole point: an acknowledgement sent after the handler would
    // arrive at the same time as the result and prove nothing the result did
    // not already prove.
    const body = panel.slice(panel.indexOf('private async handleMessage('));
    const ack = body.indexOf("type: 'hostAck'");
    const dispatch = body.indexOf('switch (message.type)');
    expect(ack, 'no acknowledgement is sent').toBeGreaterThan(-1);
    expect(ack).toBeLessThan(dispatch);
  });

  it('reads nothing out of the restored webview', () => {
    // Whatever a restored webview holds was written by a build that may no
    // longer exist. The panel rebuilds its snapshot from the workspace on
    // `ready`, so trusting the persisted value would buy nothing and would make
    // a webview's own storage an input to the host.
    const block = /registerWebviewPanelSerializer\([\s\S]{0,1200}?\n {4}\}\),/.exec(commands)?.[0] ?? '';
    expect(block, 'the serializer registration was not found').toContain('deserializeWebviewPanel');
    expect(block).not.toMatch(/\bstate\b\s*[:)]/);
  });

  it('disposes a panel it cannot serve rather than leaving a dead one on screen', () => {
    const block = /registerWebviewPanelSerializer\([\s\S]{0,1200}?\n {4}\}\),/.exec(commands)?.[0] ?? '';
    expect(block).toMatch(/if \(!atlas\) \{[\s\S]{0,300}?panel\.dispose\(\);/);
  });
});
