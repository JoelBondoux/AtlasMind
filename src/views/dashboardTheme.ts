/**
 * Shared design language for AtlasMind webview panels.
 *
 * Every webview is an isolated document, so a panel cannot inherit another
 * panel's stylesheet — the tokens have to be injected into each one. Before
 * this module they were copy-pasted: `missionControlPanel.ts` held a
 * byte-identical duplicate of the Project Dashboard's `:root` block, which had
 * already drifted (it never received the motion tokens). Everything below is
 * the single source of truth; panels compose it rather than re-declaring it.
 *
 * Usage in a panel's `getHtml()`:
 *
 * ```ts
 * extraCss: `${DASHBOARD_THEME_CSS}\n${MY_PANEL_CSS}`
 * ```
 *
 * `DASHBOARD_THEME_CSS` bundles the tokens, the reduced-motion baseline, and
 * the handful of primitives that must look and behave identically everywhere
 * (segmented controls, the affordance rules, focus rings, screen-reader-only
 * text). Panel-specific styling stays in the panel.
 */

/**
 * Design tokens. Derived from VS Code theme variables so every AtlasMind panel
 * tracks the user's colour theme rather than pinning its own palette.
 */
export const DASHBOARD_TOKENS_CSS = `
  :root {
    --dash-bg: radial-gradient(circle at top left, color-mix(in srgb, var(--vscode-button-background) 18%, transparent), transparent 40%), linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background) 86%, black 14%), var(--vscode-editor-background));
    --dash-panel: color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-editor-background)) 78%, transparent);
    --dash-panel-strong: color-mix(in srgb, var(--vscode-sideBar-background, var(--vscode-editor-background)) 88%, black 12%);
    --dash-border: color-mix(in srgb, var(--vscode-widget-border, var(--vscode-panel-border)) 70%, transparent);
    --dash-accent: var(--vscode-button-background);
    --dash-accent-strong: color-mix(in srgb, var(--vscode-button-background) 78%, white 22%);
    --dash-good: var(--vscode-testing-iconPassed, #4bb878);
    --dash-warn: var(--vscode-testing-iconQueued, #d7a34b);
    --dash-critical: var(--vscode-testing-iconFailed, #d05f5f);
    --dash-muted: var(--vscode-descriptionForeground);
    --dash-heading: "Segoe UI Variable Display", "Aptos Display", "Trebuchet MS", sans-serif;
    --dash-body: "Segoe UI Variable Text", "Aptos", "Segoe UI", sans-serif;
    --dash-mono: var(--vscode-editor-font-family, "Cascadia Code", Consolas, monospace);
    --dash-radius: 20px;
    /* The dashboard has always had a smaller radius for dense elements — 12px
       on chips and inner boxes, 6-8px on inputs — it just spelled the numbers
       out at each site. Naming them is what lets another panel land on the same
       scale rather than inventing a third one. */
    --dash-radius-sm: 12px;
    --dash-radius-xs: 8px;
    --dash-shadow: 0 18px 48px rgba(0, 0, 0, 0.18);
    /* Motion scale. Three tiers: a micro-interaction (hover/border/focus), a
       value that changed (meter, ring, progress), an element that entered. */
    --dash-dur-fast: 140ms;
    --dash-dur-value: 420ms;
    --dash-dur-entry: 520ms;
    --dash-ease: cubic-bezier(0.22, 0.61, 0.36, 1);
  }
`;

/**
 * Reduced-motion baseline.
 *
 * Deliberately universal rather than a hand-written selector list: a panel
 * cannot forget to add its own animation here, and a selector list would go
 * stale the moment someone adds a keyframe. Durations collapse rather than
 * animations being removed, so `animation-fill-mode: forwards` still applies
 * its end state and nothing disappears — only the movement does.
 *
 * A panel may layer additional rules on top (the Project Dashboard also
 * neutralises hover `transform`s, which this cannot express).
 */
export const REDUCED_MOTION_CSS = `
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
`;

/**
 * Primitives that must behave identically in every panel.
 *
 * The affordance rules encode the project's "no dead hover" position: a hand
 * cursor and a hover lift are a promise that clicking does something, so they
 * are attached to `is-actionable` (or a real button/anchor) rather than to a
 * card class that renders in both live and inert forms. `.static` is the
 * explicit opt-out for the inert variant.
 */
export const SHARED_CONTROL_CSS = `
  /* Screen-reader-only text (live-region status, control labels). */
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }

  /* ── Segmented control ────────────────────────────────────────────────
     A filter or mode switch: squared corners, segments joined inside one
     border, muted at rest. Deliberately a different visual family from
     free-standing round nav pills — mixing the two made a chart range picker
     read as a row of tabs on the Project Dashboard. */
  .segmented {
    display: inline-flex;
    flex: none;
    border: 1px solid var(--dash-border);
    border-radius: 9px;
    overflow: hidden;
    background: color-mix(in srgb, var(--dash-panel) 55%, transparent);
  }

  .segmented button {
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--dash-muted);
    padding: 5px 13px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    cursor: pointer;
    transition: background var(--dash-dur-fast) var(--dash-ease), color var(--dash-dur-fast) var(--dash-ease);
  }

  .segmented button + button { border-left: 1px solid var(--dash-border); }

  .segmented button:hover {
    background: color-mix(in srgb, var(--dash-panel) 92%, transparent);
    color: var(--vscode-foreground);
  }

  .segmented button.active {
    background: color-mix(in srgb, var(--dash-accent) 34%, transparent);
    color: var(--vscode-foreground);
    font-weight: 700;
  }

  .segmented button:focus-visible {
    outline: 2px solid var(--dash-accent-strong);
    outline-offset: -2px;
  }

  /* ── Affordance discipline ────────────────────────────────────────────
     Anything that looks clickable must be clickable. Card classes that render
     in both live and inert forms get their interactive styling from
     \`.is-actionable\` (or from being a real button), never from the bare class,
     and \`.static\` states the inert case explicitly. */
  .is-actionable {
    cursor: pointer;
    transition: transform var(--dash-dur-fast) var(--dash-ease), border-color var(--dash-dur-fast) var(--dash-ease);
  }

  .is-actionable:hover,
  .is-actionable:focus-visible {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--dash-accent) 60%, var(--dash-border));
  }

  .static {
    cursor: default;
  }

  /* An at-rest marker, so a live row reads as live before hover rather than
     only after the user has committed to a click. */
  .is-actionable.has-chevron {
    position: relative;
    padding-right: 30px;
  }

  .is-actionable.has-chevron::after {
    content: "\\203A";
    position: absolute;
    top: 12px;
    right: 13px;
    font-size: 15px;
    line-height: 1;
    color: color-mix(in srgb, var(--dash-accent-strong) 78%, transparent);
    opacity: 0.55;
    transition: opacity var(--dash-dur-fast) var(--dash-ease), transform var(--dash-dur-fast) var(--dash-ease);
  }

  .is-actionable.has-chevron:hover::after,
  .is-actionable.has-chevron:focus-visible::after {
    opacity: 1;
    transform: translateX(2px);
  }

  /* Keyboard focus must always be visible. Several panels defined no
     focus-visible styling at all. */
  button:focus-visible,
  a:focus-visible,
  [tabindex]:focus-visible {
    outline: 2px solid var(--dash-accent-strong);
    outline-offset: 2px;
  }
`;

/**
 * The full shared theme: tokens + reduced-motion baseline + shared primitives.
 * This is what a panel injects ahead of its own CSS.
 */
export const DASHBOARD_THEME_CSS = `
${DASHBOARD_TOKENS_CSS}
${REDUCED_MOTION_CSS}
${SHARED_CONTROL_CSS}
`;

/* ═════════════════════════════════════════════════════════════════════════
   The Project Dashboard's presentation layer, for every other panel.

   The tokens above were shared; the *look* was not. Nineteen panels had each
   grown their own palette under their own prefix — `--atlas-*`, `--lens-*`,
   `--run-*`, `--studio-*`, `--atlas-panel-*` — and four of those were
   near-verbatim copies of the dashboard's, drifted by a radius here and a
   surface mix there. Reading them side by side, no two AtlasMind surfaces
   agreed on what a card was.

   ## Why this is two layers rather than one

   A panel's stylesheet is a mix of two different things: *identity* (what a
   card looks like) and *layout* (where the cards go). Only the first should be
   shared, and the two need opposite cascade positions.

   - {@link DASHBOARD_PANEL_BASE_CSS} is injected **before** a panel's own CSS.
     It carries the tokens, the legacy-name aliases and the page frame. A panel
     that genuinely needs something else can still say so.
   - {@link DASHBOARD_PANEL_SKIN_CSS} is injected **after**. It re-asserts the
     handful of properties that *are* the dashboard's identity — surface,
     radius, border, shadow, type — over the class vocabulary the panels
     already use. Later wins on a specificity tie, so a panel keeps its layout
     and loses its private palette.

   Both are applied together by {@link withDashboardSkin}, which is what a
   panel actually calls.

   ## Why the skin names classes instead of matching them

   The selector lists below are written out. A substring match on `-card` would
   be shorter and would also catch `.card-header-row`, `.card-kicker` and the
   next class somebody names after a card without meaning one — and a skin that
   silently repaints an element nobody registered is exactly the failure this
   module exists to end. A name that is not in the list keeps its own styling,
   visibly, until somebody adds it.
   ═════════════════════════════════════════════════════════════════════════ */

/**
 * Legacy per-panel token names, redirected onto the dashboard's.
 *
 * Each panel used to open its stylesheet with a `:root` block of its own. Those
 * blocks are deleted; these aliases are what keeps every rule that *reads* them
 * working, so the migration is a palette change rather than a rewrite of a
 * thousand declarations.
 *
 * `--lens-accent` is deliberately absent. It is not a palette choice: the Lens
 * surfaces key it per lens (`data-accent="blue"`, `"red"`, …) so the colour of
 * the header rule says which lens you are reading, and collapsing eight hues
 * into one accent would delete information rather than unify a style.
 */
export const DASHBOARD_TOKEN_ALIASES_CSS = `
  :root {
    /* Tabbed panels: MCP, Model Providers, Specialists, Tool Webhooks,
       Vision, Voice, Agent Manager. */
    --atlas-surface: var(--dash-panel);
    --atlas-surface-strong: var(--dash-panel-strong);
    --atlas-border: var(--dash-border);
    --atlas-accent: var(--dash-accent-strong);
    --atlas-muted: var(--dash-muted);

    /* Settings. */
    --atlas-panel-surface: var(--dash-panel);
    --atlas-panel-surface-strong: var(--dash-panel-strong);
    --atlas-panel-border: var(--dash-border);
    --atlas-panel-accent: var(--dash-accent-strong);
    --atlas-panel-accent-soft: color-mix(in srgb, var(--dash-accent-strong) 18%, transparent);
    --atlas-panel-muted: var(--dash-muted);
    --atlas-panel-warning: var(--dash-warn);

    /* Project Run Center. */
    --run-bg: var(--dash-bg);
    --run-panel: var(--dash-panel);
    --run-panel-strong: var(--dash-panel-strong);
    --run-border: var(--dash-border);
    --run-accent: var(--dash-accent);
    --run-good: var(--dash-good);
    --run-warn: var(--dash-warn);
    --run-critical: var(--dash-critical);
    --run-muted: var(--dash-muted);
    --run-heading: var(--dash-heading);
    --run-body: var(--dash-body);
    --run-radius: var(--dash-radius);
    --run-shadow: var(--dash-shadow);

    /* Website Studio. */
    --studio-accent: var(--dash-accent);
    --studio-border: var(--dash-border);
    --studio-muted: var(--dash-muted);
    --studio-card: var(--dash-panel);

    /* Lens. The accent stays per-surface; everything else joins the system. */
    --lens-gap: 14px;
    --lens-radius: var(--dash-radius-sm);
    --lens-surface: var(--dash-panel);
    --lens-surface-raised: var(--dash-panel-strong);
    --lens-border: var(--dash-border);
    --lens-muted: var(--dash-muted);
  }
`;

/**
 * The page frame: background, type scale, and the shell a panel's content sits
 * in.
 *
 * `body` keeps the padding here rather than requiring every panel to grow a
 * wrapper element. The Project Dashboard, the Run Center and the Cost Dashboard
 * already have one (`.dashboard-shell`), and their own CSS zeroes the body
 * padding after this — which is the cascade working as intended, not a special
 * case.
 */
export const DASHBOARD_PAGE_CSS = `
  body {
    padding: 24px;
    background: var(--dash-bg);
    font-family: var(--dash-body);
  }

  .dashboard-shell {
    min-height: 100vh;
    padding: 24px;
    box-sizing: border-box;
  }
`;

/**
 * Layer A. Tokens, aliases, the reduced-motion baseline, the shared control
 * primitives and the page frame — everything a panel's own CSS is allowed to
 * overrule.
 */
export const DASHBOARD_PANEL_BASE_CSS = `
${DASHBOARD_THEME_CSS}
${DASHBOARD_TOKEN_ALIASES_CSS}
${DASHBOARD_PAGE_CSS}
`;

/* ── The class vocabulary the skin recognises ──────────────────────────────
   Written as constants so the same list cannot be spelled two ways in the
   rules below, and so a test can read the vocabulary rather than a regex over
   a template literal. */

/** Page headers. Every panel opens with one; each had drawn its own. */
const HEADER_SELECTOR = [
  '.dashboard-topbar',
  '.panel-hero',
  '.settings-hero',
  '.studio-hero',
  '.workspace-header',
  '.mc-topbar',
  '.ideation-topbar',
  '.lens-header',
].join(',\n  ');

/** Eyebrow / kicker text above a heading. */
const KICKER_SELECTOR = [
  '.dashboard-kicker',
  '.card-kicker',
  '.section-kicker',
  '.chart-kicker',
  '.page-kicker',
  '.eyebrow',
  '.lens-eyebrow',
  '.mc-kicker',
  '.studio-kicker',
].join(',\n  ');

/**
 * Raised surfaces. This is the list the dashboard already had, plus the
 * page-level containers the other panels use for the same thing.
 *
 * Three families are deliberately absent, and each would be a worse page if it
 * were here:
 *
 * - **The Ideation board's cards.** `.ideation-card` is a sticky note on a
 *   canvas, tinted by `.ideation-card-sun` and its five siblings. Painting them
 *   all with one surface would delete the colour the user chose.
 * - **The chat transcript.** `.chat-message`, `.approval-card` and the run
 *   inspector are a conversation, not a report. A 20px corner and a drop shadow
 *   on every message turns a thread into a deck of cards.
 * - **Notices.** `.status-banner`, `.warning-note`, `.info-band` carry a tone,
 *   and a tone is the one thing a shared surface must not overwrite.
 */
const CARD_SELECTOR = [
  // Project Dashboard.
  '.hero-card', '.score-card', '.stat-card', '.chart-card', '.panel-card',
  '.action-card', '.branch-card', '.list-card', '.signal-card',
  '.workflow-card', '.coverage-card', '.review-card', '.timeline-detail',
  // Tabbed panels.
  '.content-card', '.summary-card', '.integration-card', '.provider-card',
  '.server-card', '.policy-card', '.status-card', '.import-card',
  '.editor-card', '.editor-section', '.empty-editor', '.explainer-card',
  '.feedback-card', '.metric-card', '.output-box',
  '.wiz-detected-card', '.wiz-server-card',
  // Settings.
  '.settings-card', '.agent-policy-card', '.ard-result-card',
  '.local-model-recommendation-card', '.checkbox-card',
  // Run Center.
  '.run-card', '.stage-card', '.routine-card', '.routines-card',
  '.selected-run-card', '.promotion-card', '.mvp-card', '.artifact-card',
  '.detail-section', '.tracker-section', '.summary-block', '.table-shell',
  '.timeline-shell', '.progress-shell', '.result-output-shell', '.editor-shell',
  '.collapsible-shell',
  // Cost Dashboard and Model Comparison.
  '.daily-chart-stage', '.model-entry', '.provider-group', '.compare-card',
  // Mission Control, Website Studio, Ideation, Lens.
  '.mc-card', '.studio-card', '.automation-card', '.platform-card',
  '.wireframe-card', '.environment-card', '.scan-card',
  '.ideation-panel', '.ideation-inspector', '.ideation-sync-card',
  '.ideation-template-card',
  '.lens-card', '.lens-panel',
].join(',\n  ');

/** Vertical tab rails and the pill tabs on them. */
const NAV_RAIL_SELECTOR = ['.panel-nav', '.settings-nav', '.studio-nav', '.agent-sidebar'].join(',\n  ');
const NAV_LINK_SELECTOR = ['.nav-link', '.nav-button', '.nav-tab', '.page-nav button'].join(',\n  ');

/**
 * Layer B — the skin. Injected **after** a panel's own CSS.
 *
 * Every rule here sets identity and nothing else: surface, border, radius,
 * shadow, type. Layout — grid templates, gaps, flex direction, sticky offsets —
 * is never touched, because that is the part each panel legitimately owns and
 * the part a blanket override would wreck.
 *
 * Colour is set only where the element *is* the colour (a tag's tone, a
 * selected tab). A `.danger` button keeps its red, because the skin declares
 * shape for buttons and leaves paint to the panel that knows what the button
 * does.
 */
export const DASHBOARD_PANEL_SKIN_CSS = `
  /* ── Type ─────────────────────────────────────────────────────────────
     One display face for headings, one text face for everything else. */
  h1, h2, h3, h4 {
    font-family: var(--dash-heading);
    letter-spacing: -0.02em;
  }

  ${HEADER_SELECTOR} {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 24px;
    flex-wrap: wrap;
    /* Flat, not framed. Several panels drew the header as a rounded gradient
       card, which gave the page two competing top-level surfaces — the header
       and the first real card — and made the actual content read as secondary. */
    padding: 0;
    margin: 0 0 24px;
    border: 0;
    border-radius: 0;
    background: none;
    box-shadow: none;
  }

  ${HEADER_SELECTOR.split(',\n  ').map(selector => `${selector} h1`).join(',\n  ')} {
    margin: 0;
    font-family: var(--dash-heading);
    font-size: clamp(30px, 4vw, 44px);
    letter-spacing: -0.02em;
    line-height: 1.1;
  }

  ${KICKER_SELECTOR} {
    margin: 0 0 8px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-size: 11px;
    font-weight: 600;
    color: var(--dash-muted);
  }

  .dashboard-copy,
  .hero-copy,
  .lens-subtitle,
  .section-copy,
  .page-header > p:last-child {
    margin: 10px 0 0;
    max-width: 780px;
    color: var(--dash-muted);
    font-size: 14px;
  }

  /* ── Surfaces ─────────────────────────────────────────────────────────
     The dashboard's card: a 20px corner, a hairline border, a surface that
     lifts very slightly toward the top edge, and one shadow depth. */
  ${CARD_SELECTOR} {
    border: 1px solid var(--dash-border);
    border-radius: var(--dash-radius);
    background: linear-gradient(180deg, color-mix(in srgb, var(--dash-panel-strong) 92%, white 8%), var(--dash-panel));
    box-shadow: var(--dash-shadow);
  }

  /* Dense cards keep the smaller corner rather than a 20px radius eating a
     three-line card. */
  .lens-card,
  .metric-card,
  .status-card,
  .scan-card {
    border-radius: var(--dash-radius-sm);
  }

  .dashboard-loading,
  .dashboard-empty,
  .lens-empty,
  .empty-card,
  .empty-state {
    display: grid;
    place-items: center;
    padding: 24px;
    border: 1px dashed var(--dash-border);
    border-radius: var(--dash-radius);
    background: color-mix(in srgb, var(--dash-panel) 55%, transparent);
    color: var(--dash-muted);
    text-align: center;
  }

  /* ── Buttons ──────────────────────────────────────────────────────────
     Shape only. Paint stays with the panel, so a destructive action can still
     be the loud one. */
  button {
    font-family: var(--dash-body);
    font-weight: 600;
    border-radius: 999px;
    padding: 7px 15px;
  }

  /* The segmented control is a deliberate second family — squared, joined
     inside one border — and re-asserts itself after the blanket rule above. */
  .segmented button {
    border-radius: 0;
    padding: 5px 13px;
  }

  .dashboard-button {
    padding: 10px 18px;
  }

  .dashboard-button-primary,
  button.primary,
  .lens-button.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: 1px solid var(--vscode-button-background);
  }

  .dashboard-button-primary:hover,
  button.primary:hover,
  .lens-button.primary:hover {
    background: var(--vscode-button-hoverBackground);
  }

  .dashboard-button-secondary,
  .dashboard-button-ghost,
  .lens-button {
    border: 1px solid var(--dash-border);
    background: color-mix(in srgb, var(--dash-panel) 82%, transparent);
    color: var(--vscode-foreground);
  }

  .dashboard-button-secondary:hover,
  .dashboard-button-ghost:hover,
  .lens-button:hover {
    border-color: color-mix(in srgb, var(--dash-accent) 60%, var(--dash-border));
    background: color-mix(in srgb, var(--dash-panel) 96%, transparent);
  }

  /* ── Navigation ───────────────────────────────────────────────────────
     Seven panels rail their tabs down the left and the dashboard runs them
     across the top. The arrangement is each panel's own; the tab is not. */
  ${NAV_RAIL_SELECTOR} {
    padding: 14px;
    border: 1px solid var(--dash-border);
    border-radius: var(--dash-radius);
    background: linear-gradient(180deg, color-mix(in srgb, var(--dash-panel-strong) 92%, white 8%), var(--dash-panel));
    box-shadow: var(--dash-shadow);
  }

  ${NAV_LINK_SELECTOR} {
    position: relative;
    border-radius: 999px;
    border: 1px solid var(--dash-border);
    background: color-mix(in srgb, var(--dash-panel) 82%, transparent);
    color: var(--vscode-foreground);
    padding: 8px 14px;
    font-size: 12px;
    font-weight: 600;
    transition: background var(--dash-dur-fast) var(--dash-ease), border-color var(--dash-dur-fast) var(--dash-ease), color var(--dash-dur-fast) var(--dash-ease);
  }

  ${NAV_LINK_SELECTOR.split(',\n  ').map(selector => `${selector}:hover`).join(',\n  ')} {
    border-color: color-mix(in srgb, var(--dash-accent) 60%, var(--dash-border));
    background: color-mix(in srgb, var(--dash-panel) 96%, transparent);
  }

  /* Selection carries weight, a ring and an underline as well as colour, so it
     survives a high-contrast theme and a colour-vision difference. */
  .nav-link.active,
  .nav-button.active,
  .nav-tab[aria-selected="true"],
  .page-nav button[aria-selected="true"] {
    background: color-mix(in srgb, var(--dash-accent) 84%, transparent);
    border-color: color-mix(in srgb, var(--dash-accent) 80%, white 20%);
    color: var(--vscode-button-foreground, var(--vscode-foreground));
    font-weight: 700;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--dash-accent-strong) 55%, transparent), 0 6px 16px color-mix(in srgb, var(--dash-accent) 26%, transparent);
  }

  .nav-group-label {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.11em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--dash-muted) 88%, transparent);
    padding-left: 4px;
  }

  /* ── Pills, tags and badges ───────────────────────────────────────────── */
  .meta-pill,
  .hero-badge,
  .lens-badge,
  .governance-pill,
  .intro-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid var(--dash-border);
    background: color-mix(in srgb, var(--dash-panel) 78%, transparent);
    font-size: 12px;
    color: var(--vscode-foreground);
  }

  .tag {
    display: inline-flex;
    align-items: center;
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--dash-border);
    font-size: 11px;
    color: var(--dash-muted);
  }

  /* ── Inputs ───────────────────────────────────────────────────────────
     Panels spelled these six ways, from a 2px corner to a 12px one.

     The exclusions are wrapped in \`:where()\` deliberately, so this stays at
     element specificity. An input a panel has styled by class — the chat
     composer, the ideation prompt — keeps what it was given; an input nobody
     ever styled picks up the system's. A \`:not()\` chain would have out-ranked
     both and repainted the composer from a stylesheet that has never seen it. */
  input:where(:not([type="radio"], [type="checkbox"], [type="range"])),
  select,
  textarea {
    border: 1px solid var(--vscode-input-border, var(--dash-border));
    border-radius: var(--dash-radius-xs);
    padding: 7px 10px;
    font-family: inherit;
    color: var(--vscode-input-foreground, var(--vscode-foreground));
    background: var(--vscode-input-background, var(--vscode-editor-background));
  }

  input:focus-visible,
  select:focus-visible,
  textarea:focus-visible {
    outline: 2px solid var(--dash-accent-strong);
    outline-offset: 1px;
  }

  /* ── Tables ───────────────────────────────────────────────────────────── */
  table {
    border-collapse: collapse;
    width: 100%;
  }

  th, td {
    text-align: left;
    padding: 9px 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--dash-border) 70%, transparent);
  }

  th {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--dash-muted);
  }

  /* The webview shell's structural rule is re-asserted last: several panels
     set a flex or grid display on elements they also toggle with [hidden],
     and any display value outranks the user-agent rule for it. */
  [hidden] { display: none !important; }
`;

/*
 * There is deliberately no helper here that concatenates the two layers.
 *
 * `getWebviewHtmlShell({ dashboardSkin: true })` is the only way to apply them,
 * so the ordering that makes the whole thing work — base, then the panel, then
 * the skin — exists in one place. A second entry point would be a second chance
 * to get the order wrong, and the symptom of getting it wrong is a panel that
 * looks exactly as it did before, which nobody would report as a bug.
 */
