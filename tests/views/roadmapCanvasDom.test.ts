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
