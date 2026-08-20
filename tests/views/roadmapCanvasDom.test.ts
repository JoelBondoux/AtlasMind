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
  anchored: true,
  routes: {
    alpha: { nodeIds: ['alpha'], edgeKeys: [], order: ['alpha'], routeDays: 2, completedCount: 0 },
    beta: { nodeIds: ['alpha', 'beta'], edgeKeys: ['alpha->beta'], order: ['alpha', 'beta'], routeDays: 6, completedCount: 0 },
    gamma: { nodeIds: ['gamma'], edgeKeys: [], order: [], routeDays: 0, completedCount: 1 },
  },
  people: [{ id: 'contact-1', name: 'Joel' }],
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

    expect(harness.root().querySelector('.rm-canvas-card img')).toBeNull();
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

describe('the canvas reports what it could not do', () => {
  it('shows the notes the host sent rather than a silently shorter graph', () => {
    const harness = mount();
    harness.send(snapshot());
    expect(harness.html()).toContain('refused for contradicting a link somebody drew');
  });

  it('warns when the roadmap has no durable ids yet', () => {
    const harness = mount();
    harness.send(snapshot({ anchored: false }));
    expect(harness.html()).toContain('has not been wired to the canvas yet');
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
