import { readFileSync } from 'node:fs';
import path from 'node:path';

// jsdom ships no type declarations, and `tsconfig.test.json` carries no DOM lib
// — so nothing reached through the mounted window is typed here. That is the
// standing cost of executing a webview at all, and it stays contained to the two
// files that do it.
// @ts-expect-error -- no `@types/jsdom` in this repository
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

/** Anything reached through the mounted window. See the import note above. */
type Mounted = ReturnType<typeof Object.create>;

/**
 * The roadmap canvas, actually executed.
 *
 * `tests/views/roadmapCanvasSurface.test.ts` asserts the canvas's *source text*,
 * which is the right tool for "is this value escaped" and the wrong one for "does
 * this draw". The chat panel taught that distinction the expensive way: a free
 * variable left behind by a refactor threw on every assistant bubble, no
 * source-text assertion could see it, and the file is `@ts-nocheck` so the
 * compiler could not either.
 *
 * So this harness renders. Mount the real host root, run the real script, push a
 * snapshot the way the extension host does, and look at what came out. It is
 * deliberately narrow — its value is in being *executed*, not in breadth.
 */

/**
 * The real script, with one substitution.
 *
 * `render()` wraps twenty-odd page renderers in a try/catch and turns anything
 * thrown into an error card, which is right for a user and useless for a test:
 * the message survives and the stack — the only thing that says *which* renderer
 * broke — does not. Keeping the thrown error lets a failure here point at a line
 * instead of at a page.
 */
const WEBVIEW = readFileSync(path.join(process.cwd(), 'media', 'projectDashboard.js'), 'utf8')
  .replace(
    'renderError(error instanceof Error ? error.message : String(error));',
    'window.__renderError = error; renderError(error instanceof Error ? error.message : String(error));',
  );

interface Harness {
  window: Mounted;
  posted: Array<{ type?: string; payload?: unknown }>;
  send(message: unknown): void;
  root(): Mounted;
  html(): string;
  click(selector: string): void;
}

function mount(): Harness {
  const dom = new JSDOM(
    `<!doctype html><html><body>
       <div id="dashboard-version-strip"></div>
       <span id="dashboard-project-name"></span>
       <span id="dashboard-project-summary"></span>
       <span id="dashboard-provenance"></span>
       <span id="dashboard-score-chip"></span>
       <div id="dashboard-root"></div>
     </body></html>`,
    // A real origin, not the default `about:blank`: an opaque origin makes any
    // `localStorage` touch throw a `SecurityError` that surfaces as an unrelated
    // assertion failure.
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
  // jsdom has no layout, so the canvas's pointer capture and animation hooks
  // need stubs. Nothing asserted here depends on them.
  (window.Element.prototype as unknown as { setPointerCapture: unknown }).setPointerCapture = () => undefined;
  (window.Element.prototype as unknown as { releasePointerCapture: unknown }).releasePointerCapture = () => undefined;

  window.eval(WEBVIEW);

  const root = (): Mounted => window.document.getElementById('dashboard-root');
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
  };
}

/** A node as `resolveRoadmapGraph` produces it. */
function node(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    itemId: `roadmap-${id}`,
    text: `Item ${id}`,
    completed: false,
    focus: 'feature',
    gates: [],
    priorityScore: 10,
    branch: `feat/${id}`,
    branchSource: 'derived',
    schedule: { state: 'no-deadline', routeDays: 2, reason: 'No deadline set. 2d of work on this route.' },
    estimate: { days: 2, source: 'derived', rule: '3d base for feature work', aiAssisted: true, alternativeDays: 4.5 },
    position: { x: 80, y: 80 },
    positionSource: 'derived',
    depth: 0,
    prerequisites: [],
    dependents: [],
    blockedBy: [],
    ...overrides,
  };
}

const GRAPH = {
  active: [
    node('alpha', { position: { x: 80, y: 80 }, dependents: ['beta'] }),
    node('beta', {
      text: 'Ship the <img src=x onerror=alert(1)> export',
      position: { x: 400, y: 80 },
      depth: 1,
      prerequisites: ['alpha'],
      blockedBy: ['alpha'],
      deadline: '2026-08-22',
      schedule: { state: 'at-risk', daysLeft: 2, routeDays: 6, reason: '6d of work still ahead on this route, and 2d left.' },
    }),
  ],
  completed: [node('gamma', { completed: true, completedAt: '2026-05-04T09:00:00.000Z', schedule: { state: 'done', routeDays: 0, reason: 'Delivered.' } })],
  completedColumns: [{ key: '2026-05', label: 'May 2026' }],
  retainedIds: [],
  edges: [{ from: 'alpha', to: 'beta', origin: 'declared' }],
  suggested: [{ from: 'alpha', to: 'beta2', origin: 'derived', rule: 'shared-subject-phase', evidence: 'both mention “export”' }],
  layers: [['alpha'], ['beta']],
  cycles: [],
  notes: ['1 suggestion refused for contradicting a link somebody drew.'],
  rules: [{ id: 'explicit-reference', label: 'Names what it waits for', detail: 'The item says “after”…', rank: 0 }],
  suggestLinks: true,
  orientation: 'horizontal',
  anchored: true,
  routes: {
    alpha: { nodeIds: ['alpha'], edgeKeys: [], order: ['alpha'], routeDays: 2, completedCount: 0 },
    beta: { nodeIds: ['alpha', 'beta'], edgeKeys: ['alpha->beta'], order: ['alpha', 'beta'], routeDays: 6, completedCount: 0 },
    gamma: { nodeIds: ['gamma'], edgeKeys: [], order: [], routeDays: 0, completedCount: 1 },
  },
  people: [{ id: 'contact-1', name: 'Joel' }],
  criticalPath: {
    state: 'ok',
    days: 6,
    nodeIds: ['beta'],
    slack: [
      { nodeId: 'beta', slackDays: 0, earliestFinishDays: 6, latestFinishDays: 6, critical: true },
      { nodeId: 'alpha', slackDays: 4, earliestFinishDays: 2, latestFinishDays: 6, critical: false },
    ],
    offPathCount: 1,
    rules: [],
  },
  criticalPathSummary: '6 days of work along a chain of 1 item. The other 1 outstanding item has room to slip without moving the finish.',
  timeline: {
    state: 'ok',
    finishDay: 6,
    horizonDays: 6,
    bars: [
      {
        nodeId: 'beta', text: 'Ship the export', focus: 'feature', gates: ['mvp'],
        startDay: 2, endDay: 6, latestEndDay: 6, slackDays: 0, critical: true,
        estimateDays: 4, estimateSource: 'derived', estimateScale: 'human',
        waiting: true, deadline: '2026-08-22', deadlineDay: 2, scheduleState: 'at-risk',
      },
      {
        nodeId: 'alpha', text: 'Item alpha', focus: 'feature', gates: [],
        startDay: 0, endDay: 2, latestEndDay: 6, slackDays: 4, critical: false,
        estimateDays: 2, estimateSource: 'derived', estimateScale: 'human',
        waiting: false, scheduleState: 'no-deadline',
      },
    ],
    milestones: [
      { gateId: 'mvp', label: 'MVP', totalCount: 1, completedCount: 0, finishDay: 6, delivered: false, unscheduledCount: 0 },
    ],
    outstandingCount: 2,
    deliveredCount: 1,
    criticalCount: 1,
    rules: [{ id: 'duration-not-date', description: 'The axis is days from today.' }],
  },
  timelineSummary: '2 items across 6d, 1 on the critical path and 1 with room to slip.',
  filePath: 'project_memory/roadmap/improvement-plan.md',
};

/**
 * A snapshot the dashboard can render.
 *
 * `render()` runs every page's renderer on every push, so this has to satisfy all
 * of them — it is built from the real shapes rather than trimmed to the roadmap,
 * because a renderer that throws is caught and turned into an error page, which
 * is exactly the failure this file exists to catch.
 */
function snapshot(graphOverrides: Record<string, unknown> = {}) {
  const series: unknown[] = [];
  return {
    type: 'state',
    payload: {
      generatedAt: '2026-08-20T12:00:00.000Z',
      ssotPresent: true,
      workspaceName: 'AtlasMind',
      workspaceRootLabel: 'AtlasMind',
      repositoryLabel: 'JoelBondoux/AtlasMind',
      currentBranch: 'develop',
      versions: { current: { version: '0.371.0', branch: 'develop' }, production: undefined },
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
        ci: { workflows: [], runs: [] }, release: { }, health: { }, commitSeries: series, delta: undefined, pullRequests: { open: [], counts: {} },
      },
      githubLinks: { slug: '', links: {} },
      issues: { status: 'unavailable', issues: [], busy: false, counts: { open: 0, unassigned: 0, stale: 0 } },
      taxonomy: { labels: [], milestones: [], drift: { declaredMissing: [], undeclaredUsed: [] } },
      security: { policyPresent: false, codeownersPresent: false, prTemplatePresent: false, workflowCount: 0, findings: [], reviews: [], governanceProviders: [], assetsPresent: 0, review: { findings: [], lastRun: undefined } },
      delivery: { config: undefined, stages: [], promotions: [], history: [], blockers: [], keyScripts: [], guide: undefined, artifacts: [], ciSignals: [], reviewReadiness: [], workflows: [], dependencyCount: 0, devDependencyCount: 0, packageVersion: '0.371.0', scriptCount: 0 },
      release: { gates: [], notes: '', version: '', blockedBy: [], metrics: {} },
      debt: { entries: [], summary: { open: 0, serious: 0 }, lastScanAt: undefined, rules: [] },
      workAssignments: { targets: [] },
      director: { config: undefined, followUps: [], assignments: [], teamMode: 'solo', overdueCount: 0 },
      documents: { config: undefined, autoUpdate: [], shelves: [] },
      risk: { findings: [], lastRun: undefined, score: undefined, matrix: [], domains: [], openCount: 0, trend: [], history: [], summary: '' },
      score: { total: 0, maxTotal: 0, components: [], recommendations: [], outcome: { desiredOutcome: '', score: 0, summary: '', referenceCoveragePercent: 0, roadmapCompleted: 0, roadmapTotal: 0, runCompletionPercent: 0, signals: [] } },
      ideation: { cards: [], connections: [], readiness: { observations: [] }, workspaces: [] },
      gapAnalysis: { completed: false, items: [], lastRun: null },
      privacy: { enabled: false, rules: [], compliancePacks: [], trustedModelIds: [], providers: [], packs: [], activity: { total: 0, blocked: 0, warned: 0, redactedCount: 0, entries: [], bySource: [], byRule: [], recent: [] } },
      attention: { items: [], emptyState: 'unexamined', summary: '', remainder: 0 },
      roadmap: {
        filePath: 'project_memory/roadmap/improvement-plan.md',
        items: [
          { id: 'roadmap-1', nodeId: 'alpha', text: 'Item alpha', completed: false, focus: 'feature', priorityScore: 10, priorityReason: 'product progress', isMvp: false, gates: [], mvpCandidate: false },
        ],
        completedCount: 1,
        outstandingCount: 2,
        nextSuggestedWork: [],
        mvp: { hasTaggedItems: false, totalCount: 0, completedCount: 0, progressPercent: 0, route: [], candidates: [], summary: '', planPrompt: '' },
        boardBacklog: { total: 0, needsAttention: 0 },
        gates: [{ id: 'mvp', label: 'MVP', order: 0, builtIn: true, totalCount: 0, completedCount: 0, progressPercent: 0 }],
        gateRoutes: {},
        graph: { ...GRAPH, ...graphOverrides },
      },
    },
  };
}

describe('the roadmap canvas draws', () => {
  it('renders a node per active item, positioned where the host said', () => {
    const harness = mount();
    harness.send(snapshot());

    const nodes = harness.root().querySelectorAll('[data-rm-node]');
    expect([...nodes].map(el => el.getAttribute('data-rm-node'))).toEqual(['alpha', 'beta']);
    expect(nodes[1].style.left).toBe('400px');
  });

  it('draws one path per declared edge and one per suggestion', () => {
    const harness = mount();
    harness.send(snapshot());
    // The suggestion points at a node that is not on the board, so it must not
    // be drawn — an arrow to nowhere is worse than a missing one.
    expect(harness.root().querySelectorAll('.rm-edge')).toHaveLength(1);
    expect(harness.root().querySelectorAll('.rm-edge-suggested')).toHaveLength(0);
  });

  it('draws a suggestion dashed once both of its ends are on the board', () => {
    const harness = mount();
    harness.send(snapshot({
      suggested: [{ from: 'alpha', to: 'beta', origin: 'derived', rule: 'shared-subject-phase', evidence: 'both mention “export”' }],
    }));
    const suggested = harness.root().querySelectorAll('.rm-edge-suggested');
    expect(suggested).toHaveLength(1);
    expect(suggested[0]?.getAttribute('marker-end')).toBe('url(#rmArrowSuggested)');
  });

  it('escapes an item title that contains markup', () => {
    // Asserted against the DOM, not the serialized string: an attribute value
    // holding `<img …>` comes back out of `innerHTML` looking raw, because the
    // serializer only escapes `&` and `"` inside attributes. What matters is
    // that nothing was ever *parsed* as markup, which is a question only the
    // tree can answer.
    const harness = mount();
    harness.send(snapshot());

    // Scoped to the title: the toolbar and the cards' own Atlas pills carry a
    // legitimate AtlasMind mark, so "no <img> anywhere" would be the wrong
    // claim — what must hold is that the *title's* markup never parsed.
    expect(harness.root().querySelector('.rm-node-title img')).toBeNull();
    expect(harness.root().querySelector('[onerror]')).toBeNull();
    expect(harness.root().querySelector('[data-rm-node="beta"] .rm-node-title')?.textContent)
      .toBe('Ship the <img src=x onerror=alert(1)> export');
  });

  it('shows the schedule state it was given rather than a computed zero', () => {
    const harness = mount();
    harness.send(snapshot());
    const alpha = harness.root().querySelector('[data-rm-node="alpha"]');
    expect(alpha?.querySelector('.rm-chip-no-deadline')?.textContent).toBe('no deadline');
    const beta = harness.root().querySelector('[data-rm-node="beta"]');
    expect(beta?.querySelector('.rm-chip-at-risk')?.textContent).toBe('2d left');
    expect(beta?.className).toContain('rm-state-at-risk');
  });

  it('does not render the error page — every other page renderer survived the push', () => {
    const harness = mount();
    harness.send(snapshot());
    expect(harness.html()).not.toContain('dashboard-error');
  });
});

describe('filtering to a route is offline', () => {
  it('hides everything that is not on the route, and sends no message', () => {
    const harness = mount();
    harness.send(snapshot());
    harness.posted.length = 0;

    harness.click('[data-action="roadmap-focus-node"][data-payload="alpha"]');

    expect([...harness.root().querySelectorAll('[data-rm-node]')].map(el => el.getAttribute('data-rm-node')))
      .toEqual(['alpha']);
    expect(harness.posted).toEqual([]);
  });

  it('restores the whole plan when the filter is cleared', () => {
    const harness = mount();
    harness.send(snapshot());
    harness.click('[data-action="roadmap-focus-node"][data-payload="alpha"]');
    harness.click('[data-action="roadmap-clear-focus"]');
    expect(harness.root().querySelectorAll('[data-rm-node]')).toHaveLength(2);
  });

  it('keeps a completed prerequisite on the route', () => {
    const harness = mount();
    harness.send(snapshot());
    harness.click('[data-action="roadmap-focus-node"][data-payload="beta"]');
    expect([...harness.root().querySelectorAll('[data-rm-node]')].map(el => el.getAttribute('data-rm-node')))
      .toEqual(['alpha', 'beta']);
  });
});

describe('switching views', () => {
  it('draws the delivered canvas from the completed nodes', () => {
    const harness = mount();
    harness.send(snapshot());
    harness.click('[data-action="roadmap-view"][data-payload="completed"]');

    expect([...harness.root().querySelectorAll('[data-rm-node]')].map(el => el.getAttribute('data-rm-node')))
      .toEqual(['gamma']);
    expect(harness.html()).toContain('May 2026');
  });

  it('shows the ordered backlog, not the canvas, on the list view', () => {
    const harness = mount();
    harness.send(snapshot());
    harness.click('[data-action="roadmap-view"][data-payload="list"]');

    expect(harness.root().querySelectorAll('[data-rm-node]')).toHaveLength(0);
    expect(harness.root().querySelectorAll('[data-roadmap-id]').length).toBeGreaterThan(0);
  });
});

describe('the canvas talks to the host in node ids', () => {
  it('sends a link with both ends once a pair is chosen', () => {
    const harness = mount();
    harness.send(snapshot());
    harness.click('[data-action="roadmap-link-from"][data-payload="alpha"]');
    harness.posted.length = 0;
    harness.click('[data-action="roadmap-link-to"][data-payload="beta"]');

    expect(harness.posted).toEqual([
      { type: 'roadmapLinkCreate', payload: { from: 'alpha', to: 'beta' } },
    ]);
  });

  it('removes an existing dependency by naming both of its ends', () => {
    const harness = mount();
    harness.send(snapshot());
    harness.posted.length = 0;
    harness.click('[data-action="roadmap-link-remove"][data-payload="alpha::beta"]');

    expect(harness.posted).toEqual([
      { type: 'roadmapLinkDelete', payload: { from: 'alpha', to: 'beta' } },
    ]);
  });

  it('sends the cleared fields as null, so clearing a deadline is not a no-op', () => {
    const harness = mount();
    harness.send(snapshot());
    harness.click('[data-action="roadmap-node-edit"][data-payload="beta"]');

    const deadline = harness.root().querySelector('[data-rm-field="deadline"][data-rm-node-id="beta"]');
    expect(deadline.value).toBe('2026-08-22');
    deadline.value = '';
    harness.posted.length = 0;
    harness.click('[data-action="roadmap-node-save"][data-payload="beta"]');

    expect(harness.posted).toHaveLength(1);
    expect(harness.posted[0]?.payload).toMatchObject({ nodeId: 'beta', deadline: null });
  });

  it('does not turn an untouched derived branch name into a declared one', () => {
    const harness = mount();
    harness.send(snapshot());
    harness.click('[data-action="roadmap-node-edit"][data-payload="alpha"]');
    harness.posted.length = 0;
    harness.click('[data-action="roadmap-node-save"][data-payload="alpha"]');

    expect(harness.posted[0]?.payload).not.toHaveProperty('branch');
  });

  it('toggles suggestions by sending the opposite of what it was shown', () => {
    const harness = mount();
    harness.send(snapshot());
    harness.posted.length = 0;
    harness.click('[data-action="roadmap-suggest-toggle"]');

    expect(harness.posted).toEqual([{ type: 'roadmapSuggestToggle', payload: false }]);
  });
});

/**
 * jsdom reports every element as zero-sized, and the fit reads the frame's own
 * box. Pinned on the prototype rather than on one element because a render
 * replaces the frame, and a test that pins the instance measures a detached node
 * from the second render onward.
 */
function pinFrameSize(harness: { window: { HTMLElement: { prototype: object } } }, width: number, height: number): void {
  Object.defineProperty(harness.window.HTMLElement.prototype, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(harness.window.HTMLElement.prototype, 'clientHeight', { value: height, configurable: true });
}

describe('arranging the canvas', () => {
  it('fits the whole plan without asking the host anything', () => {
    const harness = mount();
    harness.send(snapshot());
    // jsdom reports a zero-size frame, so pin the measurement the fit reads.
    const frame = harness.root().querySelector('[data-rm-frame="true"]');
    Object.defineProperty(frame, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(frame, 'clientHeight', { value: 400, configurable: true });
    harness.posted.length = 0;

    harness.click('[data-action="roadmap-fit"]');

    const world = harness.root().querySelector('[data-rm-world="true"]');
    expect(world.style.transform).toContain('scale(');
    expect(harness.posted).toEqual([]);
  });

  it('never zooms past 100% to fill the frame', () => {
    // A two-node plan blown up to 160% is harder to read than the same two nodes
    // at their natural size.
    const harness = mount();
    harness.send(snapshot());
    const frame = harness.root().querySelector('[data-rm-frame="true"]');
    Object.defineProperty(frame, 'clientWidth', { value: 4000, configurable: true });
    Object.defineProperty(frame, 'clientHeight', { value: 3000, configurable: true });

    harness.click('[data-action="roadmap-fit"]');

    const world = harness.root().querySelector('[data-rm-world="true"]');
    const scale = Number(/scale\(([\d.]+)\)/.exec(world.style.transform)?.[1]);
    expect(scale).toBeLessThanOrEqual(1);
  });

  it('concludes a search by framing what it matched, not the whole plan', () => {
    const harness = mount();
    // Searching re-renders, which replaces the frame — so the measurement the
    // fit reads is pinned on the prototype rather than on one element.
    pinFrameSize(harness, 800, 400);
    harness.send(snapshot());
    // The after-render fit only runs on the page it is about, and the harness
    // opens on the default page with every section rendered.
    harness.click('[data-action="page"][data-payload="roadmap"]');
    harness.click('[data-action="roadmap-fit"]');
    const transform = (): string =>
      harness.root().querySelector('[data-rm-world="true"]')?.style.transform ?? '';
    const whole = transform();

    // Search stopped removing nodes from the canvas, so a re-fit that framed
    // *all* of them framed exactly what it framed before — a no-op dressed as a
    // response. The match is alpha alone, which sits 320px left of beta.
    const input = harness.root().querySelector('#roadmap-search-input');
    input.value = 'alpha';
    input.dispatchEvent(new harness.window.Event('input', { bubbles: true }));

    expect(harness.root().querySelector('[data-rm-node="alpha"]')?.className).toContain('is-search-match');
    expect(harness.root().querySelector('[data-rm-node="beta"]')?.className).toContain('is-search-dim');
    expect(transform()).not.toBe(whole);
    // Every node is still drawn: the dependencies around a match are the useful
    // half of the answer. Only the framing narrowed.
    expect(harness.root().querySelectorAll('[data-rm-node]').length).toBe(2);
  });

  it('frames the whole plan when a search matches nothing', () => {
    const harness = mount();
    pinFrameSize(harness, 800, 400);
    harness.send(snapshot());
    harness.click('[data-action="page"][data-payload="roadmap"]');

    const transform = (): string =>
      harness.root().querySelector('[data-rm-world="true"]')?.style.transform ?? '';
    harness.click('[data-action="roadmap-fit"]');
    const whole = transform();

    const input = harness.root().querySelector('#roadmap-search-input');
    input.value = 'nothing here matches this';
    input.dispatchEvent(new harness.window.Event('input', { bubbles: true }));

    // A query that found nothing has nothing to frame, and flying off to an
    // empty region of the canvas would read as the plan having been lost. It
    // falls back to the whole plan, which is exactly where Fit all puts it.
    expect(harness.root().querySelector('.is-search-match')).toBeNull();
    expect(transform()).toBe(whole);
  });

  it('glows on the side the plan continues past', () => {
    const harness = mount();
    // Small enough that beta (x=400) is wholly past the right edge and alpha
    // (x=80) is not past any of them.
    pinFrameSize(harness, 200, 200);
    harness.send(snapshot());
    harness.click('[data-action="page"][data-payload="roadmap"]');

    const frame = harness.root().querySelector('[data-rm-frame="true"]');
    expect(frame.className).toContain('has-off-right');
    expect(frame.className).not.toContain('has-off-left');
    expect(frame.className).not.toContain('has-off-top');
    // The frame clips, so a node outside it is absent rather than small — and
    // absent is indistinguishable from does-not-exist.
    expect(harness.root().querySelectorAll('.rm-edge-hint').length).toBe(4);
  });

  it('lights no edge when the whole plan is in the frame', () => {
    const harness = mount();
    pinFrameSize(harness, 1200, 800);
    harness.send(snapshot());
    harness.click('[data-action="page"][data-payload="roadmap"]');

    const frame = harness.root().querySelector('[data-rm-frame="true"]');
    for (const side of ['has-off-left', 'has-off-right', 'has-off-top', 'has-off-bottom']) {
      expect(frame.className, `${side} must be off when nothing is out of view`).not.toContain(side);
    }
  });

  it('lights no edge when the frame cannot be measured', () => {
    // jsdom's default: every box is zero. An unmeasurable frame is not an empty
    // one — without the guard every node reads as past the right and bottom
    // edges, so a hidden or not-yet-laid-out page lights all four strips.
    const harness = mount();
    harness.send(snapshot());
    harness.click('[data-action="page"][data-payload="roadmap"]');

    const frame = harness.root().querySelector('[data-rm-frame="true"]');
    for (const side of ['has-off-left', 'has-off-right', 'has-off-top', 'has-off-bottom']) {
      expect(frame.className, `${side} must be off when the frame has no size`).not.toContain(side);
    }
  });

  it('puts an edge glow out when a drag-pan brings the plan back into the frame', () => {
    // The wheel pans through `rmApplyViewTransform`, which refreshes the hints;
    // a drag writes the transform itself and used to leave them saying what was
    // true before the gesture. Sideways is exactly how a wide plan is read, so
    // the horizontal strips stayed lit over nodes that were back on screen.
    const harness = mount();
    pinFrameSize(harness, 200, 200);
    harness.send(snapshot());
    harness.click('[data-action="page"][data-payload="roadmap"]');

    const frame = harness.root().querySelector('[data-rm-frame="true"]');
    expect(frame.className).toContain('has-off-right');

    const drag = (type: string, init: Record<string, unknown> = {}): void => {
      frame.dispatchEvent(new harness.window.MouseEvent(type, { bubbles: true, button: 0, ...init }));
    };
    // beta sits at x=400 in a 200px frame; pulling the world 300px left brings it
    // in without pushing alpha (x=80) off the other side.
    drag('pointerdown', { clientX: 400, clientY: 100 });
    drag('pointermove', { clientX: 100, clientY: 100 });

    expect(frame.className, 'the right strip must go out once beta is in view').not.toContain('has-off-right');
    expect(frame.className, 'and the drag must not light the other side').not.toContain('has-off-left');
  });

  it('measures the real right edge of a card rather than assuming the nominal width', () => {
    // A card is given `RM_NODE_WIDTH` of *content*; its padding and borders put
    // another 24px on the far side. Assuming the constant reported the right
    // edge further left than it is, so the left strip stayed lit over a card
    // still poking into the frame.
    const harness = mount();
    pinFrameSize(harness, 200, 200);
    Object.defineProperty(harness.window.HTMLElement.prototype, 'offsetWidth', { value: 274, configurable: true });
    harness.send(snapshot());
    harness.click('[data-action="page"][data-payload="roadmap"]');

    const frame = harness.root().querySelector('[data-rm-frame="true"]');
    // alpha sits at x=80. Panned 340px left, its nominal right edge (80 + 250)
    // is 10px past the frame while its real one (80 + 274) is 14px inside it.
    // Through the wheel rather than a drag, so this asserts the measurement and
    // not the refresh the test above covers.
    frame.dispatchEvent(new harness.window.WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaX: 340, deltaY: 0,
    }));

    expect(frame.className, 'a sliver of the card is still on screen').not.toContain('has-off-left');
  });

  it('does nothing rather than throwing when there is nothing to fit', () => {
    const harness = mount();
    harness.send(snapshot({ active: [], edges: [], suggested: [], routes: {} }));
    expect(() => harness.click('[data-action="roadmap-fit"]')).not.toThrow();
  });

  it('toggles snap-to-grid locally and remembers it', () => {
    const harness = mount();
    harness.send(snapshot());
    harness.posted.length = 0;

    expect(harness.root().querySelector('[data-action="roadmap-snap-toggle"]')?.textContent?.trim())
      .toBe('Snap off');
    harness.click('[data-action="roadmap-snap-toggle"]');

    expect(harness.root().querySelector('[data-action="roadmap-snap-toggle"]')?.getAttribute('aria-pressed'))
      .toBe('true');
    // A viewing preference, not a change to the plan: nothing is sent.
    expect(harness.posted).toEqual([]);
  });

  it('sends only a direction when auto-aligning, never coordinates', () => {
    const harness = mount();
    harness.send(snapshot());
    harness.posted.length = 0;

    harness.click('[data-action="roadmap-auto-align"][data-payload="vertical"]');

    expect(harness.posted).toEqual([{ type: 'roadmapAutoLayout', payload: 'vertical' }]);
  });

  it('shows which direction the tree currently runs', () => {
    const harness = mount();
    harness.send(snapshot({ orientation: 'vertical' }));
    expect(harness.root().querySelector('[data-action="roadmap-auto-align"][data-payload="vertical"]')?.getAttribute('aria-pressed'))
      .toBe('true');
    expect(harness.root().querySelector('[data-action="roadmap-auto-align"][data-payload="horizontal"]')?.getAttribute('aria-pressed'))
      .toBe('false');
  });

  it('draws an edge out of the bottom face when the tree runs downward', () => {
    const horizontal = mount();
    horizontal.send(snapshot());
    const across = horizontal.root().querySelector('.rm-edge')?.getAttribute('d');

    const vertical = mount();
    vertical.send(snapshot({ orientation: 'vertical' }));
    const down = vertical.root().querySelector('.rm-edge')?.getAttribute('d');

    expect(down).not.toBe(across);
    // `alpha` sits at (80, 80) and is 250 wide, 132 tall: across leaves its right
    // edge, down leaves the middle of its bottom edge.
    expect(across?.startsWith('M 330 146')).toBe(true);
    expect(down?.startsWith('M 205 212')).toBe(true);
  });

  it('offers the tree calculation as an Atlas action that only asks', () => {
    const harness = mount();
    harness.send(snapshot());
    harness.posted.length = 0;

    const button = harness.root().querySelector('[data-action="roadmap-derive-links"]');
    expect(button.querySelector('img')).not.toBeNull();
    expect(button.getAttribute('aria-label')).toContain('AtlasMind');

    harness.click('[data-action="roadmap-derive-links"]');
    // The webview asks; the confirmation and every write live in the host.
    expect(harness.posted).toEqual([{ type: 'roadmapDeriveLinks' }]);
  });

  it('hides arranging controls on the delivered canvas, where they mean nothing', () => {
    const harness = mount();
    harness.send(snapshot());
    harness.click('[data-action="roadmap-view"][data-payload="completed"]');

    expect(harness.root().querySelector('[data-action="roadmap-auto-align"]')).toBeNull();
    expect(harness.root().querySelector('[data-action="roadmap-derive-links"]')).toBeNull();
    expect(harness.root().querySelector('[data-action="roadmap-snap-toggle"]')).toBeNull();
    // Fit and zoom still apply — a delivered plan is still something you look at.
    expect(harness.root().querySelector('[data-action="roadmap-fit"]')).not.toBeNull();
  });
});

describe('the canvas reports what it could not do', () => {
  it('shows the notes the host sent rather than a silently shorter graph', () => {
    const harness = mount();
    harness.send(snapshot());
    expect(harness.html()).toContain('refused for contradicting a link somebody drew');
  });

  it('warns when the roadmap has no durable ids yet', () => {
    const harness = mount();
    harness.send(snapshot({ anchored: false }));
    expect(harness.html()).toContain('is not wired to the canvas yet');
  });

  it('closes the node editor the moment Save is pressed, not when the host answers', () => {
    // A Save that leaves the form sitting there until a round trip completes
    // reads as a button that did nothing.
    const harness = mount();
    harness.send(snapshot());
    harness.click('[data-action="roadmap-node-edit"][data-payload="alpha"]');
    expect(harness.root().querySelector('.rm-node-editing')).not.toBeNull();

    harness.click('[data-action="roadmap-node-save"]');
    expect(harness.root().querySelector('.rm-node-editing')).toBeNull();
  });

  it('raises a circular plan as an alert, and still draws it', () => {
    const harness = mount();
    harness.send(snapshot({ cycles: [['alpha', 'beta']] }));
    expect(harness.root().querySelector('.rm-banner-bad')?.textContent)
      .toContain('circular');
    expect(harness.root().querySelectorAll('[data-rm-node]')).toHaveLength(2);
    expect(harness.root().querySelector('[data-rm-node="alpha"]')?.className).toContain('is-cycle');
  });

  it('draws an empty canvas as an invitation rather than a blank frame', () => {
    const harness = mount();
    harness.send(snapshot({ active: [], edges: [], suggested: [], routes: {} }));
    expect(harness.root().querySelector('.rm-empty')?.textContent).toContain('Nothing to draw yet');
  });
});

describe('looking around never rebuilds the page', () => {
  // Zoom used to call the full render — every page's markup rebuilt and the
  // dashboard's innerHTML swapped, once per wheel tick — which is what made the
  // canvas feel broken. A way of looking touches one transform and one label.

  it('zooms in place: the transform changes, the DOM stays, nothing is sent', () => {
    const harness = mount();
    harness.send(snapshot());
    const world = harness.root().querySelector('[data-rm-world="true"]');
    harness.posted.length = 0;

    harness.click('[data-action="roadmap-zoom-in"]');

    expect(world.style.transform).toContain('scale(1.15)');
    // Same element instance: the page was not rebuilt for a zoom.
    expect(harness.root().querySelector('[data-rm-world="true"]')).toBe(world);
    expect(harness.root().querySelector('[data-action="roadmap-zoom-reset"]')?.textContent).toBe('115%');
    expect(harness.posted).toEqual([]);
  });

  it('pans with a plain wheel instead of letting the page scroll the canvas away', () => {
    // The frame does not scroll, so an unmodified wheel used to fall through
    // and scroll the whole dashboard — yanking the canvas out of view, which
    // read as the canvas ignoring the wheel entirely.
    const harness = mount();
    harness.send(snapshot());
    const frame = harness.root().querySelector('[data-rm-frame="true"]');
    const world = harness.root().querySelector('[data-rm-world="true"]');
    harness.posted.length = 0;

    frame.dispatchEvent(new harness.window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 40 }));

    expect(world.style.transform).toContain('translate(0px, -40px)');
    expect(harness.posted).toEqual([]);
  });

  it('zooms at the cursor on a modified wheel', () => {
    const harness = mount();
    harness.send(snapshot());
    const frame = harness.root().querySelector('[data-rm-frame="true"]');
    const world = harness.root().querySelector('[data-rm-world="true"]');

    frame.dispatchEvent(new harness.window.WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaY: -40, ctrlKey: true, clientX: 200, clientY: 100,
    }));

    expect(world.style.transform).toContain('scale(1.1)');
    // Anchored: the pan moved to keep the point under the cursor fixed, so it
    // is no longer the origin it started at.
    expect(world.style.transform).not.toContain('translate(0px, 0px)');
  });
});

describe('dragging survives the host', () => {
  const pointer = (
    harness: Harness,
    target: Mounted,
    type: string,
    init: Record<string, unknown> = {},
  ): void => {
    target.dispatchEvent(new harness.window.MouseEvent(type, { bubbles: true, button: 0, ...init }));
  };

  it('defers a snapshot that arrives mid-drag, and applies it on release with the drop kept', () => {
    const harness = mount();
    harness.send(snapshot());
    const card = harness.root().querySelector('[data-rm-node="alpha"]');
    pointer(harness, card.querySelector('.rm-node-head'), 'pointerdown', { clientX: 10, clientY: 10 });
    pointer(harness, card, 'pointermove', { clientX: 60, clientY: 30 });

    // A refresh landing now must not swap the DOM out from under the pointer
    // capture — that ended the drag and threw the gesture away.
    harness.send(snapshot());
    expect(harness.root().querySelector('[data-rm-node="alpha"]')).toBe(card);

    harness.window.dispatchEvent(new harness.window.MouseEvent('pointerup', { button: 0 }));

    // The drop was sent, the deferred snapshot applied, and the dropped node
    // kept its new position — the held snapshot predates the drop.
    expect(harness.posted).toContainEqual({ type: 'roadmapNodeMove', payload: { nodeId: 'alpha', x: 130, y: 100 } });
    const after = harness.root().querySelector('[data-rm-node="alpha"]');
    expect(after).not.toBe(card);
    expect(after.style.left).toBe('130px');
    expect(after.style.top).toBe('100px');
  });

  it('drags from the card body, but a press on one of its buttons stays a click', () => {
    const harness = mount();
    harness.send(snapshot());
    const card = harness.root().querySelector('[data-rm-node="alpha"]');
    expect(card.getAttribute('data-rm-drag')).toBe('alpha');

    // A press on a button must not start a drag: with no drag in flight, the
    // next snapshot applies immediately and the DOM swaps.
    pointer(harness, card.querySelector('[data-action="roadmap-link-from"]'), 'pointerdown');
    harness.send(snapshot());
    expect(harness.root().querySelector('[data-rm-node="alpha"]')).not.toBe(card);

    // A press on the card body does: the snapshot is deferred.
    const body = harness.root().querySelector('[data-rm-node="alpha"]');
    pointer(harness, body.querySelector('.rm-node-meta'), 'pointerdown', { clientX: 5, clientY: 5 });
    harness.send(snapshot());
    expect(harness.root().querySelector('[data-rm-node="alpha"]')).toBe(body);
    harness.window.dispatchEvent(new harness.window.MouseEvent('pointerup', { button: 0 }));
  });
});

describe('the three Atlas hand-offs on every entry', () => {
  it('renders Plan, Resolve and Completion check on an outstanding canvas node, sending only the id', () => {
    const harness = mount();
    harness.send(snapshot());
    const card = harness.root().querySelector('[data-rm-node="alpha"]');
    expect(card.querySelector('[data-action="roadmap-atlas-plan"]')).not.toBeNull();
    expect(card.querySelector('[data-action="roadmap-atlas-resolve"]')).not.toBeNull();
    expect(card.querySelector('[data-action="roadmap-atlas-check"]')).not.toBeNull();

    harness.posted.length = 0;
    card.querySelector('[data-action="roadmap-atlas-plan"]')
      .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
    // One opaque id — never the text, a path, or a prompt.
    expect(harness.posted).toEqual([{ type: 'roadmapPlan', payload: 'alpha' }]);
  });

  it('keeps only the Completion check on a delivered entry', () => {
    // Nothing is left to plan or resolve, but "is it actually done?" is a
    // question a delivered item still has to answer.
    const harness = mount();
    harness.send(snapshot());
    harness.click('[data-action="roadmap-view"][data-payload="completed"]');
    const card = harness.root().querySelector('[data-rm-node="gamma"]');
    expect(card.querySelector('[data-action="roadmap-atlas-plan"]')).toBeNull();
    expect(card.querySelector('[data-action="roadmap-atlas-resolve"]')).toBeNull();
    expect(card.querySelector('[data-action="roadmap-atlas-check"]')).not.toBeNull();
  });

  it('links an entry to its filed plan by id, never by path', () => {
    const harness = mount();
    harness.send(snapshot({
      active: [node('alpha', { planPath: 'project_memory/roadmap/plans/alpha.md' })],
      edges: [], suggested: [], routes: {},
    }));
    harness.posted.length = 0;
    harness.click('[data-action="roadmap-open-plan"]');
    expect(harness.posted).toEqual([{ type: 'roadmapOpenPlan', payload: 'alpha' }]);
  });

  it('shows no plan link before a plan has been filed', () => {
    const harness = mount();
    harness.send(snapshot());
    expect(harness.root().querySelector('[data-action="roadmap-open-plan"]')).toBeNull();
  });

  it('carries the pills onto the backlog list rows, falling back to the positional id', () => {
    const harness = mount();
    harness.send(snapshot());
    harness.click('[data-action="roadmap-view"][data-payload="list"]');
    const row = harness.root().querySelector('[data-roadmap-id="roadmap-1"]');
    const pill = row.querySelector('[data-action="roadmap-atlas-resolve"]');
    expect(pill).not.toBeNull();

    harness.posted.length = 0;
    pill.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
    // This row's item does not resolve to a graph node in the fixture, so the
    // positional id goes up — the host resolves either kind.
    expect(harness.posted).toEqual([{ type: 'roadmapResolve', payload: 'roadmap-1' }]);
  });
});

describe('reading a dense plan', () => {
  it('lights a node’s neighbourhood on a body click, and puts it back on a second', () => {
    const harness = mount();
    harness.send(snapshot());
    harness.posted.length = 0;
    const card = harness.root().querySelector('[data-rm-node="alpha"]');
    card.querySelector('.rm-node-title')
      .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));

    const world = harness.root().querySelector('[data-rm-world="true"]');
    expect(world.className).toContain('rm-has-highlight');
    expect(harness.root().querySelector('[data-rm-node="alpha"]')?.className).toContain('rm-hl-focus');
    // beta waits on alpha, so it is a neighbour; the edge between them lights.
    expect(harness.root().querySelector('[data-rm-node="beta"]')?.className).toContain('rm-hl-near');
    expect(harness.root().querySelector('.rm-edge[data-rm-from="alpha"]')?.getAttribute('class')).toContain('rm-hl-edge');
    // Nothing was sent: highlighting is a way of looking.
    expect(harness.posted).toEqual([]);

    card.querySelector('.rm-node-title')
      .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
    expect(world.className).not.toContain('rm-has-highlight');
  });

  it('survives a re-render, and Escape sheds it first', () => {
    const harness = mount();
    harness.send(snapshot());
    harness.root().querySelector('[data-rm-node="alpha"] .rm-node-title')
      .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
    harness.send(snapshot());
    expect(harness.root().querySelector('[data-rm-world="true"]')?.className).toContain('rm-has-highlight');

    harness.window.document.dispatchEvent(new harness.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(harness.root().querySelector('[data-rm-world="true"]')?.className).not.toContain('rm-has-highlight');
  });

  it('marks what matches and dims the rest, so the plan around a match stays readable', () => {
    const harness = mount();
    harness.send(snapshot({
      active: [
        node('alpha', { position: { x: 80, y: 80 }, dependents: ['beta'] }),
        node('beta', { position: { x: 400, y: 80 }, depth: 1, prerequisites: ['alpha'] }),
        node('loner', { text: 'Completely unrelated item', position: { x: 80, y: 400 } }),
      ],
      edges: [{ from: 'alpha', to: 'beta', origin: 'declared' }],
      suggested: [],
    }));
    harness.posted.length = 0;
    const input = harness.root().querySelector('#roadmap-search-input');
    expect(input).not.toBeNull();
    input.value = 'Item alpha';
    input.dispatchEvent(new harness.window.Event('input', { bubbles: true }));

    // Nothing is removed. A search answers "where is this item", and the useful
    // half of that answer is what sits around it — so every node stays drawn,
    // with its arrows, and the match is the one that is marked.
    const classOf = (id: string) => harness.root().querySelector(`[data-rm-node="${id}"]`)?.className ?? '';
    expect(classOf('alpha')).toContain('is-search-match');
    expect(classOf('alpha')).not.toContain('is-search-dim');
    expect(classOf('beta')).toContain('is-search-dim');
    expect(harness.root().querySelector('[data-rm-node="loner"]')).not.toBeNull();
    expect(classOf('loner')).toContain('is-search-dim');
    // The edge between them is still drawn — dimming would be pointless if the
    // dependency it exists to keep visible went with the node.
    expect(harness.root().querySelector('.rm-edge[data-rm-from="alpha"]')).not.toBeNull();
    expect(harness.posted).toEqual([]);

    // One clear for every lens: three separate clears would be three clicks to
    // get back to a plan you can read.
    harness.click('[data-action="roadmap-emphasis-clear"]');
    expect(classOf('loner')).not.toContain('is-search-dim');
    expect(classOf('alpha')).not.toContain('is-search-match');
  });

  it('says when nothing matches, and still draws the plan', () => {
    const harness = mount();
    harness.send(snapshot());
    const input = harness.root().querySelector('#roadmap-search-input');
    input.value = 'zzz-no-such-item';
    input.dispatchEvent(new harness.window.Event('input', { bubbles: true }));
    // A banner rather than an empty canvas: everything is dimmed, so without
    // one this state is indistinguishable from the plan having been wiped.
    expect(harness.root().querySelector('.rm-banner-search')?.textContent).toContain('No item matches');
    expect(harness.root().querySelectorAll('[data-rm-node]').length).toBeGreaterThan(0);
  });

  it('highlights the items on a release gate, and leaves the rest drawn', () => {
    const harness = mount();
    harness.send(snapshot({
      active: [
        node('alpha', { gates: ['mvp'], position: { x: 80, y: 80 }, dependents: ['beta'] }),
        node('beta', { position: { x: 400, y: 80 }, depth: 1, prerequisites: ['alpha'] }),
      ],
      edges: [{ from: 'alpha', to: 'beta', origin: 'declared' }],
      suggested: [],
    }));
    harness.posted.length = 0;

    const select = harness.root().querySelector('[data-action="roadmap-emphasis-gate"]');
    expect(select).not.toBeNull();
    select.value = 'mvp';
    select.dispatchEvent(new harness.window.Event('change', { bubbles: true }));

    const classOf = (id: string) => harness.root().querySelector(`[data-rm-node="${id}"]`)?.className ?? '';
    expect(classOf('alpha')).toContain('is-search-match');
    expect(classOf('beta')).toContain('is-search-dim');
    // Nothing removed, and the arrow between them survives — the point of
    // highlighting rather than filtering is seeing what the answer depends on.
    expect(harness.root().querySelector('.rm-edge[data-rm-from="alpha"]')).not.toBeNull();
    // A way of looking: nothing is sent and nothing is written.
    expect(harness.posted).toEqual([]);
  });

  it('combines the lenses rather than letting one cancel another', () => {
    const harness = mount();
    harness.send(snapshot({
      active: [
        node('alpha', { gates: ['mvp'], position: { x: 80, y: 80 } }),
        node('beta', { text: 'Item alpha too', position: { x: 400, y: 80 } }),
      ],
      edges: [],
      suggested: [],
    }));

    const select = harness.root().querySelector('[data-action="roadmap-emphasis-gate"]');
    select.value = 'mvp';
    select.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
    const input = harness.root().querySelector('#roadmap-search-input');
    input.value = 'alpha';
    input.dispatchEvent(new harness.window.Event('input', { bubbles: true }));

    const classOf = (id: string) => harness.root().querySelector(`[data-rm-node="${id}"]`)?.className ?? '';
    // "MVP items whose text says alpha" — beta matches the text and not the
    // gate, so it is not emphasised. Switching between lenses instead of
    // combining them is what reads as a filter that does not work.
    expect(classOf('alpha')).toContain('is-search-match');
    expect(classOf('beta')).toContain('is-search-dim');
  });

  it('states what the finish date rests on without a lens being switched on', () => {
    // The one lens that answers a question rather than narrowing to an answer
    // you already had. What the date depends on is worth knowing before you
    // think to ask for it.
    const harness = mount();
    harness.send(snapshot());

    expect(harness.root().querySelector('.rm-critical-summary')?.textContent)
      .toContain('6 days of work along a chain of 1 item');
    expect(harness.root().querySelector('[data-action="roadmap-emphasis-critical"]')).not.toBeNull();
  });

  it('emphasises the chain and leaves the work with slack drawn and dimmed', () => {
    const harness = mount();
    harness.send(snapshot());
    harness.posted.length = 0;

    const toggle = harness.root().querySelector('[data-action="roadmap-emphasis-critical"]');
    toggle.checked = true;
    toggle.dispatchEvent(new harness.window.Event('change', { bubbles: true }));

    const classOf = (id: string) => harness.root().querySelector(`[data-rm-node="${id}"]`)?.className ?? '';
    expect(classOf('beta')).toContain('is-search-match');
    // Dimmed rather than hidden: the items *not* on the path are the ones with
    // room to slip, and removing them takes away the comparison.
    expect(classOf('alpha')).toContain('is-search-dim');
    // A way of looking — nothing is sent and nothing is written.
    expect(harness.posted).toEqual([]);
  });

  it('offers no critical-path lens on the delivered record', () => {
    // Delivered work is never on the path, so the lens would match nothing and
    // read as broken rather than as inapplicable.
    const harness = mount();
    harness.send(snapshot());
    harness.click('[data-action="roadmap-view"][data-payload="completed"]');

    expect(harness.root().querySelector('[data-action="roadmap-emphasis-critical"]')).toBeNull();
    expect(harness.root().querySelector('.rm-critical-summary')).toBeNull();
  });

  it('clears the critical-path lens with the others', () => {
    const harness = mount();
    harness.send(snapshot());
    const toggle = harness.root().querySelector('[data-action="roadmap-emphasis-critical"]');
    toggle.checked = true;
    toggle.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
    expect(harness.root().querySelector('[data-rm-node="alpha"]')?.className).toContain('is-search-dim');

    harness.click('[data-action="roadmap-emphasis-clear"]');

    expect(harness.root().querySelector('[data-rm-node="alpha"]')?.className).not.toContain('is-search-dim');
  });

  it('keeps every edge on a live repaint while a lens is on', () => {
    const harness = mount();
    harness.send(snapshot({
      active: [
        node('alpha', { position: { x: 80, y: 80 }, dependents: ['beta'] }),
        node('beta', { text: 'Completely unrelated', position: { x: 400, y: 80 }, depth: 1, prerequisites: ['alpha'] }),
      ],
      edges: [{ from: 'alpha', to: 'beta', origin: 'declared' }],
      suggested: [],
    }));
    const input = harness.root().querySelector('#roadmap-search-input');
    input.value = 'Item alpha';
    input.dispatchEvent(new harness.window.Event('input', { bubbles: true }));

    // The edge redraw used to drop anything outside the search's connected set,
    // which since matches stopped hiding nodes would strip the arrows off a
    // node still on screen the moment anything triggered a repaint.
    expect(harness.root().querySelector('.rm-edge[data-rm-from="alpha"]')).not.toBeNull();
  });

  it('gives the Delivered chart the same lenses as the plan', () => {
    const harness = mount();
    harness.send(snapshot());
    harness.click('[data-action="roadmap-view"][data-payload="completed"]');

    // "When did the auth work ship" and "what did Sam deliver" are questions
    // about history, and they were unanswerable because the lenses stopped at
    // the outstanding plan.
    expect(harness.root().querySelector('#roadmap-search-input')).not.toBeNull();
    expect(harness.root().querySelector('[data-action="roadmap-emphasis-gate"]')).not.toBeNull();
    expect(harness.root().querySelector('[data-action="roadmap-emphasis-person"]')).not.toBeNull();

    const input = harness.root().querySelector('#roadmap-search-input');
    input.value = 'gamma';
    input.dispatchEvent(new harness.window.Event('input', { bubbles: true }));
    expect(harness.root().querySelector('[data-rm-node="gamma"]')?.className).toContain('is-search-match');
  });

  it('keeps the authoring controls off the Delivered chart', () => {
    const harness = mount();
    harness.send(snapshot());
    harness.click('[data-action="roadmap-view"][data-payload="completed"]');

    // Parity is about the ways of *looking*. Nothing is added to a record of
    // what already happened, and the chart is columned by month, so a tree
    // layout would fight the columns rather than arrange them.
    for (const action of ['roadmap-add', 'roadmap-import', 'roadmap-derive-links', 'roadmap-auto-align', 'roadmap-suggest-toggle']) {
      expect(
        harness.root().querySelector(`[data-action="${action}"]`),
        `${action} must not appear on the Delivered chart`,
      ).toBeNull();
    }
    // The ways of looking that do apply are still there.
    expect(harness.root().querySelector('[data-action="roadmap-fit"]')).not.toBeNull();
    expect(harness.root().querySelector('[data-action="roadmap-zoom-in"]')).not.toBeNull();
  });

  it('zooms in on a node when it is double-clicked', () => {
    const harness = mount();
    harness.send(snapshot());
    harness.posted.length = 0;
    const world = () => harness.root().querySelector('[data-rm-world="true"]') as { style: { transform: string } } | null;
    expect(world()?.style.transform ?? '').not.toContain('scale(1.25)');

    const card = harness.root().querySelector('[data-rm-node="alpha"]');
    expect(card).not.toBeNull();
    card.dispatchEvent(new harness.window.MouseEvent('dblclick', { bubbles: true }));

    // A view change and nothing else: zooming is a way of looking, so it must
    // not post a message or write anything.
    expect(world()?.style.transform ?? '').toContain('scale(1.25)');
    expect(harness.posted).toEqual([]);
  });

  it('offers gates and an owner on the entry form, and saves the gates with the item', () => {
    const harness = mount();
    harness.send(snapshot());
    harness.click('[data-action="roadmap-view"][data-payload="list"]');
    harness.click('[data-action="roadmap-add"]');

    // Gates ride along in the save payload the host already understands; the
    // owner cannot, because assignment names a node by an id that does not
    // exist until the item has been written.
    expect(harness.root().querySelector('[data-action="roadmap-draft-gate"]')).not.toBeNull();
    const textarea = harness.root().querySelector('textarea[data-roadmap-draft]');
    expect(textarea).not.toBeNull();
    expect(Number(textarea.getAttribute('rows'))).toBeGreaterThan(8);

    textarea.value = 'A brand new backlog item';
    textarea.dispatchEvent(new harness.window.Event('input', { bubbles: true }));
    harness.click('[data-action="roadmap-draft-gate"][data-payload="mvp"]');
    harness.posted.length = 0;
    harness.click('[data-action="roadmap-save"]');

    const saved = harness.posted.find(message => message.type === 'saveRoadmap');
    const items = (saved?.payload as { items: Array<{ text: string; gates: string[] }> } | undefined)?.items ?? [];
    const created = items.find(item => item.text === 'A brand new backlog item');
    expect(created?.gates).toEqual(['mvp']);
  });

  it('reports an owner it could not apply rather than dropping it', () => {
    const harness = mount();
    harness.send(snapshot());
    harness.click('[data-action="roadmap-view"][data-payload="list"]');
    harness.click('[data-action="roadmap-add"]');

    const textarea = harness.root().querySelector('textarea[data-roadmap-draft]');
    textarea.value = 'An item nobody will find';
    textarea.dispatchEvent(new harness.window.Event('input', { bubbles: true }));
    // Choose an owner, then let a snapshot arrive that does not contain the
    // item — the host rejected the write, or re-minted it beyond recognition.
    const select = harness.root().querySelector('[data-action="roadmap-draft-owner"]');
    expect(select, 'the fixture has a roster, so the owner picker must render').not.toBeNull();
    select.value = 'contact-1';
    select.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
    harness.click('[data-action="roadmap-save"]');
    harness.send(snapshot());

    // The user watched themselves pick an owner, so the one outcome ruled out
    // is silence.
    expect(harness.root().querySelector('.rm-banner-owner')?.textContent)
      .toContain('could not be assigned');
  });

  it('gives the backlog list its own search box, and filters the queue with it', () => {
    const harness = mount();
    harness.send(snapshot());
    harness.click('[data-action="roadmap-view"][data-payload="list"]');

    // The canvas toolbar carries a search box and does not render in this view,
    // so without one here the queue filter had nothing to drive it.
    expect(harness.root().querySelector('#roadmap-search-input')).not.toBeNull();
    expect(harness.root().querySelectorAll('.roadmap-item').length).toBe(1);

    // Re-queried each time: the input is rebuilt by the render its own event
    // triggers, so a held reference is detached and its events reach nothing.
    const type = (value: string) => {
      const el = harness.root().querySelector('#roadmap-search-input');
      el.value = value;
      el.dispatchEvent(new harness.window.Event('input', { bubbles: true }));
    };

    type('zzz-no-such-item');
    expect(harness.root().querySelectorAll('.roadmap-item').length).toBe(0);
    expect(harness.root().querySelector('.roadmap-list')?.textContent).toContain('Nothing in the backlog matches');

    type('alpha');
    expect(harness.root().querySelectorAll('.roadmap-item').length).toBe(1);
    // Reordering is by item id against the whole plan, so a filtered drag is
    // safe — the queue says so rather than leaving it to be discovered.
    expect(harness.root().querySelector('.rm-queue-filter-note')?.textContent)
      .toContain('reorders against the whole plan');
  });

  it('does not zoom when the double-click landed on a control inside the node', () => {
    const harness = mount();
    harness.send(snapshot());
    const button = harness.root().querySelector('[data-rm-node="alpha"] button');
    if (button) {
      button.dispatchEvent(new harness.window.MouseEvent('dblclick', { bubbles: true }));
      const world = harness.root().querySelector('[data-rm-world="true"]') as { style: { transform: string } } | null;
      expect(world?.style.transform ?? '').not.toContain('scale(1.25)');
    }
  });

  it('spreads a fan of edges across the node face instead of stacking them', () => {
    const harness = mount();
    harness.send(snapshot({
      active: [
        node('alpha', { position: { x: 80, y: 80 }, dependents: ['beta', 'third'] }),
        node('beta', { position: { x: 400, y: 80 }, depth: 1, prerequisites: ['alpha'] }),
        node('third', { position: { x: 400, y: 400 }, depth: 1, prerequisites: ['alpha'] }),
      ],
      edges: [
        { from: 'alpha', to: 'beta', origin: 'declared' },
        { from: 'alpha', to: 'third', origin: 'declared' },
      ],
      suggested: [],
    }));
    const starts = [...harness.root().querySelectorAll('.rm-edge[data-rm-from="alpha"]')]
      .map((el: { getAttribute(name: string): string | null }) => /M (\d+) (\d+)/.exec(el.getAttribute('d') ?? ''))
      .map(match => `${match?.[1]},${match?.[2]}`);
    expect(starts).toHaveLength(2);
    // Two distinct exit points on alpha's face — not one knot.
    expect(new Set(starts).size).toBe(2);
  });
});

describe('a flat plan offers its own way out', () => {
  it('puts Calculate tree in the banner that explains the single column', () => {
    // This state is exactly where somebody concludes the canvas cannot make a
    // tree, so the gesture that makes one lives in the sentence explaining it.
    const harness = mount();
    harness.send(snapshot({ edges: [], suggested: [{ from: 'alpha', to: 'beta', origin: 'derived', rule: 'shared-subject-phase', evidence: 'both mention “export”' }] }));
    const banner = harness.root().querySelector('.rm-banner-actionable');
    expect(banner?.textContent).toContain('Nothing is linked yet');
    expect(banner?.querySelector('[data-action="roadmap-derive-links"]')).not.toBeNull();
  });
});

describe('the timeline view', () => {
  const openTimeline = (graphOverrides: Record<string, unknown> = {}) => {
    const harness = mount();
    pinFrameSize(harness, 900, 500);
    harness.send(snapshot(graphOverrides));
    harness.click('[data-action="page"][data-payload="roadmap"]');
    harness.click('[data-action="roadmap-view"][data-payload="timeline"]');
    return harness;
  };

  it('draws one row per bar, positioned by the schedule the host computed', () => {
    const harness = openTimeline();
    const rows = [...harness.root().querySelectorAll('.rm-tl-row')];

    expect(rows).toHaveLength(2);
    // beta starts on day 2 of a 6-day horizon and runs to the end.
    const critical = harness.root().querySelector('.rm-tl-row.is-critical .rm-tl-bar');
    expect(critical?.getAttribute('style')).toContain('left:33.33');
    expect(harness.root().querySelectorAll('.rm-tl-bar')).toHaveLength(2);
  });

  it('draws float as a tail only where there is room', () => {
    // Float is room before the *plan's* finish moves. The item on the path has
    // none, so a tail there would say the opposite of what is true.
    const harness = openTimeline();
    const floats = [...harness.root().querySelectorAll('.rm-tl-float')];
    expect(floats).toHaveLength(1);
    expect(harness.root().querySelector('.rm-tl-row.is-critical .rm-tl-float')).toBeNull();
  });

  it('marks a deadline the earliest finish is already past', () => {
    const harness = openTimeline();
    expect(harness.root().querySelector('.rm-tl-deadline.is-late')).not.toBeNull();
  });

  it('pins each dated milestone on the axis', () => {
    const harness = openTimeline();
    const milestone = harness.root().querySelector('.rm-tl-milestone');
    expect(milestone?.textContent).toContain('MVP');
    expect(milestone?.getAttribute('style')).toContain('left:100');
  });

  it('publishes the rules that drew the chart', () => {
    // Same habit as the debt register and the critical path: a surface shows
    // the rules that graded it rather than a copy that drifts.
    const harness = openTimeline();
    expect(harness.root().querySelector('.rm-tl-rules')?.textContent).toContain('duration-not-date');
  });

  it('says why there is no chart rather than drawing an empty axis', () => {
    // An empty chart with an axis reads as "this plan takes no time".
    const harness = openTimeline({
      timeline: {
        state: 'circular', horizonDays: 0, bars: [], milestones: [],
        outstandingCount: 2, deliveredCount: 0, criticalCount: 0, rules: [],
        note: 'This plan has a circular dependency, so it cannot be laid out on a time axis.',
      },
    });

    expect(harness.root().querySelector('.rm-tl-row')).toBeNull();
    expect(harness.root().querySelector('.rm-timeline-card')?.textContent).toContain('circular dependency');
  });

  it('leaves the canvas alone: no frame, and nothing fitted', () => {
    const harness = openTimeline();
    expect(harness.root().querySelector('[data-rm-frame="true"]')).toBeNull();
    expect(harness.posted.filter(message => message.type === 'roadmapNodeMove')).toEqual([]);
  });
});
