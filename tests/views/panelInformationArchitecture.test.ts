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
      'agents', 'models', 'discovery', 'mcp', 'buzz',
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
    // The timescale disclosure must not be inside the conditional.
    expect(stage.slice(guardAt, timescaleAt)).toContain("` : '<span></span>'}");
    expect(stage).toContain('class="chart-timescale-disclosure"');
    expect(stage).toContain('<summary aria-label="Select daily spend time period">');
  });

  it('keeps chart controls in a toolbar outside the cost plot', () => {
    const stage = body.slice(position('class="daily-chart-stage"'));
    expect(stage.indexOf('class="chart-toolbar"')).toBeLessThan(stage.indexOf('${dailyChart}'));
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

  it('adds the actively routed model to the activity strip', () => {
    const script = read('../../media/chatPanel.js');
    // The strip appends the model to whatever it is currently saying. Asserted
    // on the composition rather than on the exact separator, which changed when
    // the strip became a bubble and the redundant "Model:" label was dropped —
    // the id is self-evidently a model beside a line about what is happening.
    expect(script).toMatch(/currentStatusText \+ '[^']*' \+ currentStatusModel/);
    expect(script).toContain('setCurrentStatusModel(isBusy ? activeModels[activeModels.length - 1] : undefined)');
  });

  it('hides the activity strip when nothing is happening', () => {
    const script = read('../../media/chatPanel.js');
    // A strip permanently reading "Ready." is the instrumentation the bubble
    // replaced, not an improvement on it.
    expect(script).toContain('IDLE_STATUS_PATTERN');
    expect(script).toContain("status.classList.toggle('idle', idle)");
  });

  it('renders execution-limit recovery as a question with one-run and permanent chips', () => {
    const script = read('../../media/chatPanel.js');
    expect(script).toContain('This run reached its safety limit.');
    expect(script).toContain("raiseTempBtn.textContent = 'Use ' + suggestedIter + ' this run'");
    expect(script).toContain("raisePermBtn.textContent = 'Always use ' + suggestedIter");
    expect(script).toContain("cancelBtn.textContent = 'Keep partial result'");
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
  const template = script.slice(renderStart, script.indexOf("';", script.indexOf('ideation-drawer-section', renderStart)));
  const at = (needle: string) => {
    const index = template.indexOf(needle);
    expect(index, `"${needle}" not found in the render template`).toBeGreaterThan(-1);
    return index;
  };

  it('keeps the board leading, beside a rail rather than above a stack', () => {
    // Three versions of this layout were spent rearranging chrome above and
    // below a single column. The fault all three left in place was that the
    // inspector sat under a canvas that filled the first screen, so every
    // click on a card meant scrolling away from the board to edit it.
    expect(script).not.toContain('ideation-hero-grid');
    expect(script).not.toContain('ideation-stat-strip');
    expect(at('renderHeader(snapshot)')).toBeLessThan(at('renderBoard(snapshot)'));
    expect(at('renderBoard(snapshot)')).toBeLessThan(at('renderRail('));
    expect(at('renderRail(')).toBeLessThan(at('renderDrawer(snapshot)'));
    // Board and rail share one grid section; the drawer is its own.
    const grid = template.slice(template.indexOf('ideation-main-grid'), template.indexOf('ideation-drawer-section'));
    expect(grid).toContain('renderBoard(snapshot)');
    expect(grid).toContain('<aside class="ideation-rail"');
  });

  it('has no stages left to explain', () => {
    // The four-card guide became four tabs and the tabs still needed the
    // guide, because two of them rendered the same panels as their
    // neighbours. There is no order to explain: you are looking at the board
    // or at the thing you clicked.
    for (const relic of ['ideation-process-details', 'renderProcessGuide', 'renderModeBar', 'renderStage(', 'IDEATION_MODES', "data-action=\"ideation-mode\"", 'deriveModeStatus']) {
      expect(script, `${relic} survived`).not.toContain(relic);
    }
  });

  it('follows the selection in the rail', () => {
    // A link → its editor. A card → the inspector. Nothing → the prompt. One
    // place, one thing at a time, never a tab to pick first.
    const rail = script.slice(script.indexOf('function renderRail('));
    const body = rail.slice(0, rail.indexOf('\n  }'));
    expect(body.indexOf('if (selectedLink)')).toBeLessThan(body.indexOf('if (selectedCard)'));
    expect(body).toContain('renderLinkEditor(snapshot, selectedLink)');
    expect(body).toContain('renderInspector(snapshot, selectedCard)');
    expect(body.trimEnd().endsWith("renderComposer(snapshot, boardIsEmpty);")).toBe(true);
  });

  it('offers the brief and the starter frames only while the board is empty', () => {
    // The frames append and never replace — but a picker that could touch a
    // board with work on it is a picker somebody eventually clicks by accident.
    // The brief sits behind the same guard: it is an onboarding question.
    const rail = script.slice(script.indexOf('function renderRail('));
    const body = rail.slice(0, rail.indexOf('\n  }'));
    const guarded = body.slice(body.indexOf('boardIsEmpty ?'), body.indexOf(" : ''"));
    expect(guarded).toContain('renderProjectBrief(snapshot)');
    expect(guarded).toContain('renderStarterFrames(snapshot)');
    // And the canvas no longer competes with a second "start here".
    expect(script).not.toContain('Start with one sharp note');
  });

  it('has one way off the board, with readiness inside it', () => {
    // "Send to Project Run" sat in the drawing toolbar, again in the inspector,
    // and "Add to roadmap" in a third card, with the difference never stated.
    const toolbar = script.slice(script.indexOf('function renderBoard('), script.indexOf('function renderShortcuts('));
    expect(toolbar).not.toContain('ideation-promote-card');
    expect(toolbar).not.toContain('ideation-raise-work');
    const exit = script.slice(script.indexOf('function renderExit('), script.indexOf('function renderQuickReplies('));
    expect(exit).toContain('renderWorkHandoff(card)');
    expect(exit).toContain('ideation-promote-card');
    expect(exit).toContain('ideation-readiness-toggle');
    // Exactly one promote control across the whole script.
    expect(script.split('data-action="ideation-promote-card"').length - 1).toBe(1);
  });

  it('keeps the shortcut list off the page until asked for', () => {
    // A 180-word paragraph of shortcuts plus a chip strip repeating it, under
    // every board, all the time. Reference material is looked up, not read.
    expect(script).not.toContain('ideation-hint');
    expect(script).not.toContain('renderCanvasShortcutStrip');
    const board = script.slice(script.indexOf('function renderBoard('), script.indexOf('function renderShortcuts('));
    expect(board).toContain("state.shortcutsOpen ? renderShortcuts() : ''");
  });

  it('puts what Atlas said in a drawer that opens itself when it speaks', () => {
    const drawer = script.slice(script.indexOf('function renderDrawer('), script.indexOf('function renderProjectBrief('));
    expect(drawer).toContain("['latest', 'Latest pass']");
    expect(drawer).toContain("['history', 'History']");
    expect(drawer).toContain("['analytics', 'Analytics']");
    // The answer to what you just asked must not land in a closed drawer.
    const chunk = script.slice(script.indexOf("message.type === 'ideationResponseChunk'"));
    expect(chunk.slice(0, chunk.indexOf('render();'))).toContain('state.drawerOpen = true');
  });

  it('holds every disclosure in module state, not in the DOM', () => {
    // render() replaces the markup wholesale; a native <details open> snaps
    // shut on every update. This is the rule the dashboard's help panels keep.
    const rail = script.slice(script.indexOf('function renderRail('), script.indexOf('function renderAnalytics('));
    expect(rail).not.toContain('<details');
    for (const key of ['drawerOpen', 'inspectorMore', 'constraintsOpen', 'shortcutsOpen', 'readinessOpen']) {
      expect(script).toContain(`${key}: false`);
    }
  });

  it('publishes what a card kind commits to, where the kind is chosen', () => {
    // `KIND_PREFIX` decided that a problem becomes "Fix: …" and a risk becomes
    // "Mitigate: …" from the day it was written, and none of it reached the
    // person picking the kind.
    const inspector = script.slice(script.indexOf('function describeKindConsequence('));
    const body = inspector.slice(0, inspector.indexOf('\n  }'));
    expect(body).toContain('Fix:');
    expect(body).toContain('Mitigate:');
    expect(body).toContain('Trial:');
    expect(script).toContain('describeKindConsequence(selectedCard.kind)');
  });

  it('publishes exactly the kinds the derivation actually prefixes', () => {
    // The webview restates a rule that lives in `ideationDerivation.ts`. The
    // wording is allowed to differ; the *set* is not, or the panel would promise
    // a prefix the roadmap never adds.
    const derivation = readFileSync(path.join(process.cwd(), 'src', 'core', 'ideationDerivation.ts'), 'utf8');
    const table = derivation.slice(derivation.indexOf('const KIND_PREFIX'), derivation.indexOf('};', derivation.indexOf('const KIND_PREFIX')));
    const prefixed = [...table.matchAll(/^\s*'?([a-z-]+)'?:\s*'([A-Z][a-z]+)',/gm)].map(match => [match[1]!, match[2]!]);
    expect(prefixed.map(entry => entry[0]).sort()).toEqual(['experiment', 'problem', 'risk']);
    const copy = script.slice(script.indexOf('function describeKindConsequence('));
    const body = copy.slice(0, copy.indexOf('\n  }'));
    for (const [kind, prefix] of prefixed) {
      const branch = body.slice(body.indexOf(`case '${kind}':`));
      expect(branch.slice(0, branch.indexOf('case ', 6)), kind).toContain(`${prefix}:`);
    }
  });

  it('hides every non-board section in canvas focus mode', () => {
    const panel = read('projectIdeationPanel.ts');
    const focusBlock = panel.slice(panel.indexOf('body.canvas-focus-mode .ideation-topbar'));
    const block = focusBlock.slice(0, focusBlock.indexOf('}'));
    for (const section of ['ideation-header', 'ideation-rail', 'ideation-drawer-section']) {
      expect(block, `${section} is still visible in canvas focus mode`).toContain(section);
    }
  });
});

describe('ui studio shell', () => {
  const source = read('websiteStudioPanel.ts');

  it('has no numbered steps', () => {
    // Three earlier layouts numbered the pages one to eight and promised a
    // waterfall the work does not have: nobody finishes the brief before
    // drawing, and the preview is not a stage after the canvas it previews.
    // The rail says *what* you are designing and the strip says *which
    // aspect*; neither is ordered.
    expect(source).not.toMatch(/navButton\(/);
    expect(source).not.toMatch(/data-page-target="[a-z-]+">\s*<span>\d/);
  });

  it('lands on the canvas, and lists the views with design first', () => {
    // The strip's order is the order of attention, not of work: the surface
    // itself, then its structure, its brand, its words, and only then where it
    // goes. The brief is last because it is read once and drawn against daily.
    const strip = source.slice(source.indexOf('function renderViewStrip('), source.indexOf('function renderBrandCards('));
    const ids = [...strip.matchAll(/\['([a-z-]+)', /g)].map(m => m[1]!);
    expect(ids).toEqual(['design', 'structure', 'brands', 'content', 'handoff', 'delivery', 'brief']);
    expect(source).toMatch(/activePage: WebsiteStudioPage = 'design'/);
  });

  it('puts the surfaces rail before the views, not a metric strip above them', () => {
    // Six metric tiles summarised a project nobody had asked about yet; the
    // rail is the navigation, since a surface is the thing you pick.
    const shell = source.slice(source.indexOf('<header class="studio-hero">'), source.indexOf('<footer class="save-bar">'));
    expect(shell).not.toContain('metric-strip');
    expect(shell.indexOf('surfaces-rail')).toBeGreaterThan(-1);
    expect(shell.indexOf('surfaces-rail')).toBeLessThan(shell.indexOf('<main>'));
    expect(shell.indexOf('renderViewStrip(')).toBeLessThan(shell.indexOf('renderWireframesPage('));
  });
});

describe('ideation hero title bar', () => {
  const panel = read('projectIdeationPanel.ts');

  it('styles its topbar as a hero, like the other dashboards', () => {
    // The topbar was lumped in with the generic flex rows (gap 10, centred), so
    // it read as a toolbar rather than the page title — and the panel lost its
    // only visual anchor when the hero explainer grid was retired.
    expect(panel).toMatch(/\.ideation-topbar \{[^}]*justify-content: space-between/s);
    expect(panel).toMatch(/\.ideation-topbar h1 \{[^}]*font-size: clamp\(30px, 4vw, 44px\)/s);
  });

  it('keeps the topbar out of the generic flex-row group', () => {
    const genericGroup = panel.slice(panel.indexOf('.row-head,'), panel.indexOf('.row-head,') + 400);
    expect(genericGroup).not.toContain('.ideation-topbar,');
  });
});

describe('risk advisor coverage', () => {
  const panel = read('projectDashboardPanel.ts');
  const script = readFileSync(path.join(process.cwd(), 'media', 'projectDashboard.js'), 'utf8');

  it('sources what each advisor reviews from its own definition', () => {
    // Restating the scope in the dashboard would let the two drift; the agent
    // description is the authoritative statement.
    expect(panel).toContain('coverage?: string');
    expect(panel).toContain('atlas.agentRegistry?.get?.(agentId)?.description');
  });

  it('shows what was checked when an assessment finds nothing', () => {
    // "0 open" reads as "nothing was checked" unless the scope is visible, so
    // the disclosure opens itself exactly in the clean-result case.
    expect(script).toContain('risk-coverage');
    expect(script).toContain("!never && domain.openCount === 0 ? ' open' : ''");
    expect(script).toContain('Reviewed, nothing flagged');
  });
});
