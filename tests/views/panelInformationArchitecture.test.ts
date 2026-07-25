import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SETTINGS_PAGE_IDS } from '../../src/views/settingsPanel.ts';

/**
 * Section ordering across the panels.
 *
 * Every one of these orders was previously the sequence the sections were
 * *added* rather than the sequence anyone uses them in. These tests pin the
 * intended order so a new section appended to the end cannot silently
 * reintroduce the drift.
 */

const VIEWS = path.join(process.cwd(), 'src', 'views');
const read = (file: string) => readFileSync(path.join(VIEWS, file), 'utf8');

/** Page ids in the order their nav buttons appear in the markup. */
function navOrder(source: string, attribute = 'data-page-target'): string[] {
  const navStart = source.indexOf('role="tablist"');
  const navEnd = source.indexOf('</nav>', navStart);
  const nav = source.slice(navStart, navEnd);
  return [...nav.matchAll(new RegExp(`${attribute}="([a-z-]+)"`, 'g'))].map(m => m[1]!);
}

describe('settings section order', () => {
  const source = read('settingsPanel.ts');

  it('groups pages by what you are configuring, not by when they shipped', () => {
    expect([...SETTINGS_PAGE_IDS]).toEqual([
      'overview',
      // Capabilities — what the extension can do.
      'models', 'discovery',
      // Interaction — how it talks to you.
      'chat', 'ai-instructions',
      // Guardrails — what it is allowed to do.
      'safety', 'testing',
      // Autonomy — how far it may run alone.
      'project', 'loop',
      'experimental',
    ]);
  });

  it('renders the nav in the same order as the canonical list', () => {
    // These are two hand-maintained lists in one file and they had already
    // drifted from the section render order once.
    expect(navOrder(source)).toEqual([...SETTINGS_PAGE_IDS]);
  });

  it('puts Resource Discovery next to Models & Integrations', () => {
    // Discovery is how you *add* a capability; it used to sit last, four pages
    // away from the page it belongs beside.
    const order = [...SETTINGS_PAGE_IDS];
    expect(order.indexOf('discovery') - order.indexOf('models')).toBe(1);
  });

  it('labels each group for sighted users without polluting the tablist', () => {
    expect(source).toContain('class="nav-group" role="presentation"');
    // The captions are decorative: every tab name is already self-describing,
    // and a stray non-tab child would break the tablist's ownership contract.
    expect(source).toMatch(/class="nav-group-label" aria-hidden="true"/);
  });
});

describe('personality profile section order', () => {
  const source = read('personalityProfilePanel.ts');
  const order = [...source.matchAll(/^ {4}id: '([a-zA-Z]+)',$/gm)].map(m => m[1]!);

  it('runs identity → expression → constraints → operations → flavour', () => {
    expect(order).toEqual([
      'identity', 'values',
      'tone', 'cognition', 'memory',
      'boundaries', 'conflict', 'redlines',
      'operations', 'flavor',
    ]);
  });

  it('keeps the three constraint sections together', () => {
    // They were at positions 4, 9 and 10 — scattered across the whole form.
    const constraints = ['boundaries', 'conflict', 'redlines'].map(id => order.indexOf(id));
    expect(Math.max(...constraints) - Math.min(...constraints)).toBe(2);
  });
});

describe('mcp panel section order', () => {
  const source = read('mcpPanel.ts');

  it('lands on the server list rather than a summary of it', () => {
    expect(navOrder(source)).toEqual(['servers', 'add', 'advanced', 'overview']);
    expect(source).toContain("target?.page ?? 'servers'");
  });

  it('no longer restates the hero badges as inert summary cards', () => {
    // Servers / Connected / Enabled appeared twice on one screen: clickable
    // filters in the hero, and inert copies in an Overview summary grid.
    expect(source).not.toContain('MCP endpoints currently registered with AtlasMind.');
    expect(source).toContain('${connectedCount} connected');
  });
});

describe('specialist integrations section order', () => {
  const source = read('specialistIntegrationsPanel.ts');

  it('renders each provider card exactly once', () => {
    // "All Integrations" was a verbatim concatenation of "Live surfaces" and
    // "Future adapters", so every card was in the DOM twice.
    expect(source).not.toContain('liveCards');
    expect(source).not.toContain('futureCards');
    expect((source.match(/\$\{catalogCards\}/g) ?? []).length).toBe(1);
  });

  it('replaces the duplicate tabs with a filter over one page', () => {
    expect(navOrder(source)).toEqual(['overview', 'integrations']);
    expect(source).toContain('data-surface-filter');
    expect(source).toContain('data-surface="${page}"');
  });
});

describe('cost dashboard order', () => {
  const source = read('costDashboardPanel.ts');
  const bodyStart = source.indexOf('const bodyContent = `');
  const body = source.slice(bodyStart, source.indexOf('const displayCurrency', bodyStart));

  const position = (needle: string) => {
    const at = body.indexOf(needle);
    expect(at, `"${needle}" not found in the body template`).toBeGreaterThan(-1);
    return at;
  };

  it('leads with the budget strip — the only number that forces a decision', () => {
    // The budget HUD used to sit inside the Daily Spend card, below a section
    // header and behind the entire summary ribbon.
    expect(source).toContain('class="budget-strip"');
    expect(position('class="budget-strip"')).toBeLessThan(position('class="summary-ribbon"'));
    expect(position('class="budget-strip"')).toBeLessThan(position('<h2>Daily Spend</h2>'));
  });

  it('puts live in-flight spend directly under the budget it is consuming', () => {
    expect(position('buildCurrentLoops')).toBeLessThan(position('class="summary-ribbon"'));
  });

  it('groups the summary cards instead of showing ten equal-weight tiles', () => {
    expect(source).toContain('class="summary-group"');
    expect(source).toContain("label: 'Spend'");
    expect(source).toContain("label: 'Efficiency'");
    expect(source).toContain("label: 'Volume'");
  });

  it('does not repeat the budget strip as summary cards', () => {
    // Today's Spend / Daily Limit are the strip's entire subject; they survive
    // only when no budget is configured and the strip therefore does not render.
    expect(source).toContain('if (!budget) {');
    expect(source).not.toContain("label: 'Daily Limit'");
  });

  it('drills down before it interprets, and ends on the estimate', () => {
    expect(position('<h2>Recent Requests</h2>')).toBeLessThan(position('<h2>Response Feedback by Model</h2>'));
    expect(position('${localSavings}')).toBeGreaterThan(position('<h2>Response Feedback by Model</h2>'));
  });

  it('keeps the timescale control available when the window is empty', () => {
    // Regression guard: the records feeding the chart are themselves scoped by
    // the selected timescale, so hiding this control on an empty window would
    // leave no way to widen it. Only the line/bar switch is conditional.
    const stage = body.slice(position('class="daily-chart-stage"'));
    const styleAt = stage.indexOf('chart-style-controls');
    const timescaleAt = stage.indexOf('cost-dashboard-timescale');
    const guardAt = stage.indexOf('hasDailySpend');
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(styleAt);
    expect(timescaleAt).toBeGreaterThan(styleAt);
    // The timescale block must not be inside the conditional.
    expect(stage.slice(guardAt, timescaleAt)).toContain("` : ''}");
  });
});

describe('chat panel order', () => {
  const source = read('chatWebviewMarkup.ts');
  const at = (needle: string) => {
    const index = source.indexOf(needle);
    expect(index, `"${needle}" not found`).toBeGreaterThan(-1);
    return index;
  };

  it('puts the status line where the things it narrates actually are', () => {
    // #status sat at the top of the panel while the thinking indicator, the
    // streaming reply and the send state are all pinned to the bottom — on a
    // tall transcript it was scrolled off-screen entirely.
    expect(at('id="status"')).toBeGreaterThan(at('id="transcript"'));
    expect(at('id="status"')).toBeLessThan(at('class="composer-shell"'));
  });

  it('announces status changes to assistive tech', () => {
    expect(source).toMatch(/id="status"[^>]*role="status"/);
  });

  it('ships no dead search markup', () => {
    // #composerSearch / #searchInput / #searchResults were never referenced by
    // the script — search mode works through dynamically created controls over
    // the prompt input. The static block was leftover from an earlier design.
    expect(source).not.toContain('id="composerSearch"');
    expect(source).not.toContain('id="searchInput"');
  });
});

describe('run center order', () => {
  const source = read('projectRunCenterPanel.ts');
  const bodyStart = source.indexOf('<div class="run-center-shell">');
  const body = source.slice(bodyStart, source.indexOf('extraCss', bodyStart));
  const at = (needle: string) => {
    const index = body.indexOf(needle);
    expect(index, `"${needle}" not found in the body`).toBeGreaterThan(-1);
    return index;
  };

  it('puts the goal input near the top instead of below four screens of chrome', () => {
    // #goalInput is the panel's primary input; it used to sit below the routine
    // runner, a 34-line hero grid and the stepper.
    expect(at('id="goalInput"')).toBeLessThan(at('class="hero-grid"'));
    expect(at('id="goalInput"')).toBeLessThan(at('routines-card-section'));
  });

  it('leads with the stepper that names the current phase', () => {
    expect(at('id="workflowStepper"')).toBeLessThan(at('id="goalInput"'));
  });

  it('closes with the routine runner, collapsed', () => {
    expect(at('routines-card-section')).toBeGreaterThan(at('class="panel-grid"'));
    expect(source).toContain('routines-details');
  });

  it('gives collapsible sections a visible disclosure cue', () => {
    // .collapsible-shell removed the native marker twice — list-style: none and
    // the -webkit pseudo-element — and put nothing back.
    expect(source).toMatch(/\.collapsible-shell summary > :first-child::before/);
    expect(source).toContain('.collapsible-shell[open] summary > :first-child::before');
  });

  it('separates an empty history from an empty search result', () => {
    expect(source).toContain('No runs match this search');
  });
});

describe('ideation workspace order', () => {
  const script = readFileSync(path.join(process.cwd(), 'media', 'projectIdeation.js'), 'utf8');
  const renderStart = script.indexOf('root.innerHTML =');
  const template = script.slice(renderStart, script.indexOf("';", script.indexOf('ideation-process-section', renderStart)));
  const at = (needle: string) => {
    const index = template.indexOf(needle);
    expect(index, `"${needle}" not found in the render template`).toBeGreaterThan(-1);
    return index;
  };

  it('puts the board above the composer', () => {
    // This is a whiteboard panel whose whiteboard was below the fold: a hero
    // panel, a four-card process guide and a very tall composer came first,
    // and .ideation-main-grid is a single column so the composer stacked on
    // top of the canvas rather than beside it.
    expect(at('renderBoard(snapshot)')).toBeLessThan(at('renderComposer(snapshot)'));
  });

  it('replaces the hero panel with a compact stat strip', () => {
    expect(script).not.toContain('ideation-hero-grid');
    expect(at('ideation-stat-strip')).toBeLessThan(at('renderBoard(snapshot)'));
  });

  it('demotes the staged-workflow guide to the end, collapsed', () => {
    expect(at('ideation-process-section')).toBeGreaterThan(at('ideation-analytics-section'));
    expect(script).toContain('ideation-process-details');
    // Open only while the board is still empty, when it is actually guidance.
    expect(script).toContain("boardIsEmpty ? ' open' : ''");
  });

  it('hides every non-board section in canvas focus mode', () => {
    // The process guide was missing from this list, so it stayed on screen in
    // what is meant to be a full-screen canvas.
    const panel = read('projectIdeationPanel.ts');
    const focusBlock = panel.slice(panel.indexOf('body.canvas-focus-mode .ideation-topbar'));
    const block = focusBlock.slice(0, focusBlock.indexOf('}'));
    for (const section of ['ideation-stat-strip', 'ideation-composer-section', 'ideation-process-section', 'ideation-lower-grid', 'ideation-analytics-section']) {
      expect(block, `${section} is still visible in canvas focus mode`).toContain(section);
    }
  });
});

describe('website studio step order', () => {
  const source = read('websiteStudioPanel.ts');
  const steps = [...source.matchAll(/navButton\('([a-z-]+)', '(\d)'/g)].map(m => ({ id: m[1]!, n: m[2]! }));

  it('defines the shared UI system before the pages that apply it', () => {
    // Each wireframe card tracks a per-page "UI design" stage, which cannot be
    // done consistently before the shared typography/colour/component
    // decisions exist. The numbered steps promise a linear workflow, so the
    // order has to actually be one.
    expect(steps.map(s => s.id)).toEqual(['brief', 'sitemap', 'ui-system', 'wireframes', 'platforms', 'automations']);
  });

  it('numbers the steps consecutively from 1', () => {
    expect(steps.map(s => s.n)).toEqual(['1', '2', '3', '4', '5', '6']);
  });
});
