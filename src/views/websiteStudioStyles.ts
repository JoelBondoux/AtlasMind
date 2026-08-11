/**
 * Website Studio's stylesheet.
 *
 * Lifted out of the panel when the wireframe canvas arrived. The panel was
 * carrying roughly 350 lines of CSS and JavaScript in template strings on top of
 * its rendering and message handling; the canvas would have pushed that past the
 * point where any of it could be read. The script now lives in
 * `media/websiteStudio.js` and the styling here.
 *
 * The palette comes from `dashboardTheme.ts` — this file sets layout and the
 * canvas's own affordances, and deliberately declares no colours of its own
 * beyond mixes of the shared tokens, so the Studio follows the editor theme.
 */

export const WEBSITE_STUDIO_CSS = `  /* Palette, page frame and hero come from the shared dashboard theme. */
  body { padding: 24px 24px 92px; }
  .studio-hero { display:flex; justify-content:space-between; gap:24px; align-items:flex-end; padding:28px 0 20px; border-bottom:1px solid var(--studio-border); }
  .studio-hero h1 { margin:2px 0 6px; font-size:2rem; letter-spacing:-.03em; }
  .hero-copy { max-width:760px; color:var(--studio-muted); margin:0; }
  .hero-actions, .card-heading, .platform-topline { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
  .eyebrow { margin:0; color:var(--studio-muted); text-transform:uppercase; letter-spacing:.11em; font-size:.72rem; font-weight:700; }
  button { min-height:34px; border-radius:7px; font-weight:600; }
  button.secondary { background:transparent; color:var(--vscode-foreground); border:1px solid var(--studio-border); }
  button.secondary:hover { background:var(--vscode-list-hoverBackground); }
  button.full { width:100%; }
  button.danger { color:var(--vscode-errorForeground, #f85149); }
  button.subtle { background:transparent; border:1px solid var(--studio-border); }
  .metric-strip { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:12px; padding:16px 0; }
  .metric-card, .panel-card, .platform-card, .automation-card, .wireframe-card { border:1px solid var(--studio-border); background:var(--studio-card); border-radius:12px; }
  .metric-card { padding:14px; display:grid; gap:3px; }
  .metric-card span, .metric-card small { color:var(--studio-muted); }
  .metric-card strong { font-size:1.12rem; }
  .notice { display:none; margin:0 0 14px; padding:10px 13px; border:1px solid var(--studio-border); border-radius:8px; }
  .notice.visible { display:block; }
  .notice.success { border-color:var(--vscode-testing-iconPassed, #3fb950); }
  .notice.error { border-color:var(--vscode-errorForeground, #f85149); }
  .studio-layout { display:grid; grid-template-columns:210px minmax(0,1fr); gap:24px; align-items:start; }
  .studio-nav { position:sticky; top:12px; display:grid; gap:7px; }
  .nav-button { display:flex; align-items:center; gap:10px; text-align:left; background:transparent; color:var(--vscode-foreground); border:1px solid transparent; }
  .nav-button span { width:24px; height:24px; display:grid; place-items:center; border-radius:50%; background:var(--vscode-badge-background); color:var(--vscode-badge-foreground); }
  .nav-button:hover { background:var(--vscode-list-hoverBackground); }
  .nav-button.active { border-color:var(--studio-accent); background:color-mix(in srgb, var(--studio-accent) 12%, transparent); }
  .nav-footer { margin-top:12px; padding-top:12px; border-top:1px solid var(--studio-border); display:grid; gap:7px; }
  .studio-page { display:none; }
  .studio-page.active { display:block; }
  .page-intro { padding:18px 20px; margin-bottom:14px; border-left:4px solid var(--studio-accent); background:color-mix(in srgb, var(--studio-accent) 7%, transparent); border-radius:0 10px 10px 0; }
  .page-intro h2 { margin:4px 0; font-size:1.35rem; }
  .page-intro p:last-child { margin:0; color:var(--studio-muted); max-width:860px; }
  .two-column { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
  .panel-card, .platform-card, .automation-card, .wireframe-card { padding:18px; }
  .panel-card h2, .platform-card h2, .automation-card h2, .wireframe-card h2 { margin:0 0 12px; }
  .field { display:grid; gap:5px; margin:0 0 12px; }
  .field > span { font-weight:600; font-size:.84rem; }
  input, textarea, select { width:100%; border:1px solid var(--vscode-input-border, var(--studio-border)); background:var(--vscode-input-background); color:var(--vscode-input-foreground); border-radius:6px; padding:8px 9px; font:inherit; }
  textarea { resize:vertical; }
  input:focus, textarea:focus, select:focus, button:focus-visible { outline:2px solid var(--vscode-focusBorder); outline-offset:1px; }
  .field-pair, .status-grid, .color-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
  .status-grid, .color-grid { grid-template-columns:repeat(4,minmax(0,1fr)); }
  .color-grid { grid-template-columns:repeat(3,minmax(0,1fr)); }
  .color-field > div { display:flex; gap:6px; }
  .color-field input[type=color] { width:42px; padding:2px; flex:0 0 42px; }
  .import-card { margin-top:14px; display:grid; grid-template-columns:minmax(220px,.75fr) minmax(320px,1.25fr) auto; gap:16px; align-items:end; }
  .table-wrap { overflow:auto; }
  table { min-width:860px; }
  th { color:var(--studio-muted); font-size:.8rem; text-transform:uppercase; letter-spacing:.05em; }
  td { vertical-align:top; }
  .wireframe-grid, .platform-grid, .automation-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
  .hosting-heading { display:flex; justify-content:space-between; gap:16px; align-items:end; margin:18px 0 12px; }
  .hosting-heading h2 { margin:3px 0; }
  .hosting-heading p:last-child { margin:0; color:var(--studio-muted); max-width:820px; }
  .platform-heading { margin-top:24px; padding-top:20px; border-top:1px solid var(--studio-border); }
  .environment-flow { display:grid; grid-template-columns:minmax(0,1fr) 34px minmax(0,1fr) 34px minmax(0,1fr); gap:8px; align-items:stretch; margin-bottom:14px; }
  .environment-card { min-width:0; padding:17px; border:1px solid var(--studio-border); border-top:4px solid var(--studio-accent); background:var(--studio-card); border-radius:12px; }
  .environment-staging { border-top-color:var(--vscode-inputValidation-warningBorder, #cca700); }
  .environment-production { border-top-color:var(--vscode-testing-iconPassed, #3fb950); }
  .environment-arrow { display:grid; place-items:center; color:var(--studio-muted); font-size:1.45rem; }
  .environment-topline { display:flex; justify-content:space-between; gap:10px; align-items:flex-start; }
  .environment-topline h3 { margin:4px 0 0; font-size:1.2rem; }
  .environment-purpose { min-height:52px; color:var(--studio-muted); }
  .locked-field { display:grid; gap:5px; margin:0 0 12px; }
  .locked-field span { font-weight:600; font-size:.84rem; }
  .locked-field strong { min-height:18px; padding:8px 9px; border:1px dashed var(--studio-border); border-radius:6px; color:var(--studio-muted); text-transform:capitalize; }
  .readiness-pill, .guard-badge { border:1px solid var(--studio-border); border-radius:999px; padding:4px 8px; font-size:.74rem; font-weight:700; white-space:nowrap; }
  .readiness-pill.ready { border-color:var(--vscode-testing-iconPassed, #3fb950); color:var(--vscode-testing-iconPassed, #3fb950); }
  .readiness-pill.needs-setup { border-color:var(--vscode-inputValidation-warningBorder, #cca700); color:var(--vscode-inputValidation-warningForeground, #cca700); }
  .readiness-pill.blocked { border-color:var(--vscode-errorForeground, #f85149); color:var(--vscode-errorForeground, #f85149); }
  .guard-badge { display:inline-block; margin:0 0 10px; border-color:var(--vscode-testing-iconPassed, #3fb950); }
  .readiness-issues { margin:4px 0 0; padding-left:20px; color:var(--studio-muted); }
  .readiness-issues li { margin:4px 0; }
  .readiness-clear { margin:4px 0 0; color:var(--vscode-testing-iconPassed, #3fb950); font-size:.84rem; }
  .wireframe-topline { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
  .status-pill { border:1px solid var(--studio-border); border-radius:999px; padding:3px 8px; color:var(--studio-muted); font-size:.78rem; }
  .wireframe-sheet { min-height:210px; background:var(--vscode-editor-background); border:1px dashed var(--studio-border); border-radius:8px; padding:12px; margin:10px 0 14px; display:grid; gap:8px; grid-template-columns:repeat(6,1fr); }
  .wireframe-block { min-height:36px; border:1px solid var(--studio-border); background:color-mix(in srgb, var(--vscode-foreground) 5%, transparent); display:grid; place-items:center; padding:6px; color:var(--studio-muted); font-size:.75rem; text-align:center; }
  .block-1 { grid-column:1/-1; }
  .block-2 { grid-column:span 3; }
  .block-3 { grid-column:span 2; }
  .primary-choice { display:flex; gap:7px; align-items:center; font-weight:650; }
  .primary-choice input { width:auto; }
  .callout { border:1px solid var(--studio-border); border-left:4px solid var(--vscode-testing-iconPassed, #3fb950); padding:12px 14px; border-radius:0 8px 8px 0; margin:0 0 14px; color:var(--studio-muted); }
  .callout strong { color:var(--vscode-foreground); }
  .callout.warning { border-left-color:var(--vscode-inputValidation-warningBorder, #cca700); }
  code { background:var(--vscode-textCodeBlock-background); padding:2px 5px; border-radius:4px; }
  .token-preview { display:flex; align-items:center; gap:8px; margin-top:8px; }
  .token-preview span { width:28px; height:28px; border-radius:50%; border:1px solid var(--studio-border); }
  .empty-state { grid-column:1/-1; min-height:180px; display:grid; place-content:center; text-align:center; gap:5px; border:1px dashed var(--studio-border); border-radius:12px; color:var(--studio-muted); }
  .save-bar { position:fixed; bottom:0; left:0; right:0; z-index:10; display:flex; justify-content:space-between; align-items:center; gap:20px; padding:12px 22px; background:color-mix(in srgb, var(--vscode-editor-background) 94%, transparent); backdrop-filter:blur(12px); border-top:1px solid var(--studio-border); }
  .save-bar div { display:grid; }
  .save-bar span { color:var(--studio-muted); font-size:.82rem; }
  @media (max-width:1050px) {
    .metric-strip { grid-template-columns:repeat(3,minmax(0,1fr)); }
    .studio-layout { grid-template-columns:1fr; }
    .studio-nav { position:static; display:flex; overflow:auto; padding-bottom:5px; }
    .nav-button { white-space:nowrap; }
    .nav-footer { display:none; }
    .import-card { grid-template-columns:1fr; }
    .environment-flow { grid-template-columns:1fr; }
    .environment-arrow { transform:rotate(90deg); min-height:28px; }
  }
  @media (max-width:760px) {
    body { padding-left:14px; padding-right:14px; }
    .studio-hero, .save-bar { align-items:flex-start; flex-direction:column; }
    .metric-strip, .two-column, .wireframe-grid, .platform-grid, .automation-grid { grid-template-columns:1fr; }
    .status-grid, .color-grid, .field-pair { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .metric-strip { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .save-bar button { width:100%; }
  }

  /* ── Site + page design prompts ─────────────────────────────── */
  .prompt-card textarea { width:100%; }
  .generate-button { background:var(--vscode-button-background); color:var(--vscode-button-foreground); }
  .generate-off { font-size:.78rem; color:var(--studio-muted); font-style:italic; }
  .unsaved-badge { font-size:.78rem; color:var(--vscode-editorWarning-foreground, #d29922); font-weight:600; margin-right:auto; }

  /* ── Sitemap hierarchy map ──────────────────────────────────── */
  .map-scroll { overflow-x:auto; padding:8px 0 4px; }
  .map-scroll svg { max-width:100%; height:auto; display:block; }
  .map-edge { fill:none; stroke:var(--studio-border); stroke-width:2; }
  .map-edge.derived { stroke-dasharray:5 4; opacity:.75; }
  .map-node {
    width:100%; height:100%; display:flex; flex-direction:column; justify-content:center;
    gap:2px; padding:8px 10px; text-align:left; border-radius:8px; cursor:pointer;
    border:1px solid var(--studio-border); background:var(--studio-card); color:var(--vscode-foreground);
  }
  .map-node:hover { border-color:var(--studio-accent); background:var(--vscode-list-hoverBackground); }
  .map-node:focus-visible { outline:2px solid var(--vscode-focusBorder); outline-offset:2px; }
  .map-node.orphan { border-style:dashed; border-color:var(--vscode-editorWarning-foreground, #d29922); }
  .map-node-title { font-weight:650; font-size:.86rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .map-node-slug { font-size:.72rem; color:var(--studio-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .map-empty, .structure-empty { color:var(--studio-muted); font-style:italic; }
  .map-legend { display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:.75rem; color:var(--studio-muted); margin:10px 0 0; }
  .legend-swatch { display:inline-block; width:22px; height:0; border-top:2px solid var(--studio-border); margin-left:10px; }
  .legend-swatch.dashed { border-top-style:dashed; }
  .legend-swatch.orphan { border-top:2px dashed var(--vscode-editorWarning-foreground, #d29922); }
  .findings-card ul { margin:8px 0 0; padding-left:20px; }
  .findings-card li { margin-bottom:4px; color:var(--studio-muted); }

  /* ── Page inventory links ───────────────────────────────────── */
  .links-cell { max-width:220px; }
  .link-chip {
    display:inline-block; margin:2px 3px 2px 0; padding:2px 8px; border-radius:999px;
    font-size:.72rem; border:1px solid var(--studio-border);
    background:color-mix(in srgb, var(--studio-accent) 12%, transparent);
  }
  .link-chip.external { border-style:dashed; }
  .link-chip.broken {
    border-color:var(--vscode-errorForeground, #f85149);
    color:var(--vscode-errorForeground, #f85149);
    background:transparent;
  }
  .inbound-count { display:block; margin-top:3px; font-size:.7rem; color:var(--studio-muted); }

  /* ── Wireframe canvas ───────────────────────────────────────── */
  .canvas-toolbar { display:flex; align-items:center; gap:16px; flex-wrap:wrap; margin-bottom:12px; }
  .field.inline { flex-direction:row; align-items:center; gap:8px; margin:0; }
  .canvas-summary { margin:0 auto 0 0; font-size:.8rem; color:var(--studio-muted); }
  .canvas-layout { display:grid; grid-template-columns:150px minmax(0,1fr) 300px; gap:16px; align-items:start; }
  @media (max-width: 1100px) { .canvas-layout { grid-template-columns:1fr; } }

  .canvas-palette { display:flex; flex-direction:column; gap:6px; position:sticky; top:12px; }
  .palette-button {
    text-align:left; border:1px solid var(--studio-border); background:var(--studio-card);
    color:var(--vscode-foreground); border-radius:7px; padding:7px 10px; font-size:.82rem;
  }
  .palette-button:hover { background:var(--vscode-list-hoverBackground); }
  .palette-button.armed { border-color:var(--studio-accent); background:color-mix(in srgb, var(--studio-accent) 18%, transparent); }

  .canvas-frame { border:1px solid var(--studio-border); border-radius:10px; overflow:hidden; background:var(--studio-card); }
  .wf-canvas {
    position:relative; width:100%; touch-action:none; cursor:crosshair;
    /* The 12-column grid is drawn rather than implied, so "line it up" is a
       thing the eye can do before the snap confirms it. */
    background-image:
      repeating-linear-gradient(to right, color-mix(in srgb, var(--studio-border) 55%, transparent) 0 1px, transparent 1px calc(100% / 12)),
      repeating-linear-gradient(to bottom, color-mix(in srgb, var(--studio-border) 30%, transparent) 0 1px, transparent 1px 40px);
  }
  .wf-canvas:focus-visible { outline:2px solid var(--vscode-focusBorder); outline-offset:-2px; }

  .wf-box {
    position:absolute; display:flex; flex-direction:column; justify-content:center; align-items:flex-start;
    gap:2px; padding:6px 9px; overflow:hidden; text-align:left; cursor:grab;
    border:1.5px solid color-mix(in srgb, var(--studio-accent) 60%, var(--studio-border));
    background:color-mix(in srgb, var(--studio-accent) 10%, transparent);
    border-radius:6px; color:var(--vscode-foreground);
  }
  .wf-box:hover { background:color-mix(in srgb, var(--studio-accent) 18%, transparent); }
  .wf-box.selected {
    border-color:var(--studio-accent); border-width:2px;
    background:color-mix(in srgb, var(--studio-accent) 24%, transparent);
    z-index:5;
  }
  .wf-box:focus-visible { outline:2px solid var(--vscode-focusBorder); outline-offset:1px; }
  .wf-box-label { font-weight:650; font-size:.82rem; line-height:1.2; }
  .wf-box-kind { font-size:.68rem; color:var(--studio-muted); text-transform:uppercase; letter-spacing:.08em; }
  /* Structural kinds read as bands, content kinds as blocks. Enough of a
     difference to scan the page shape without turning the canvas into a
     colour-coded legend nobody can remember. */
  .wf-box[data-kind="nav"], .wf-box[data-kind="footer"] { background:color-mix(in srgb, var(--studio-muted) 16%, transparent); }
  .wf-box[data-kind="hero"] { background:color-mix(in srgb, var(--studio-accent) 20%, transparent); }
  .wf-box[data-kind="cta"] { border-style:solid; border-width:2px; }
  .wf-box[data-kind="media"], .wf-box[data-kind="custom"] { border-style:dashed; }

  .wf-handle {
    position:absolute; width:9px; height:9px; background:var(--studio-accent);
    border:1px solid var(--vscode-editor-background); border-radius:2px;
  }
  .wf-handle-nw { top:-5px; left:-5px; cursor:nwse-resize; }
  .wf-handle-n  { top:-5px; left:calc(50% - 4px); cursor:ns-resize; }
  .wf-handle-ne { top:-5px; right:-5px; cursor:nesw-resize; }
  .wf-handle-e  { top:calc(50% - 4px); right:-5px; cursor:ew-resize; }
  .wf-handle-se { bottom:-5px; right:-5px; cursor:nwse-resize; }
  .wf-handle-s  { bottom:-5px; left:calc(50% - 4px); cursor:ns-resize; }
  .wf-handle-sw { bottom:-5px; left:-5px; cursor:nesw-resize; }
  .wf-handle-w  { top:calc(50% - 4px); left:-5px; cursor:ew-resize; }

  .wf-ghost {
    position:absolute; pointer-events:none; border:2px dashed var(--studio-accent);
    background:color-mix(in srgb, var(--studio-accent) 10%, transparent); border-radius:6px;
  }

  .canvas-inspector { display:flex; flex-direction:column; gap:14px; position:sticky; top:12px; }
  #wireframeInspector, .page-prompt-block {
    border:1px solid var(--studio-border); border-radius:10px; padding:14px; background:var(--studio-card);
  }
  .inspector-empty { margin:0; color:var(--studio-muted); font-size:.85rem; }
  .inspector-head h3 { margin:2px 0 2px; font-size:1rem; }
  .inspector-meta { margin:0 0 10px; font-size:.76rem; color:var(--studio-muted); }
  .inspector-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
  .inspector-hint { margin:10px 0 0; font-size:.72rem; color:var(--studio-muted); }
  .page-prompt-block h3 { margin:2px 0 8px; font-size:1rem; }

  /* ── Stack page: framework picker ───────────────────────────── */
  .framework-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(250px, 1fr)); gap:10px; margin-top:12px; }
  .framework-card {
    display:flex; flex-direction:column; align-items:flex-start; gap:4px;
    text-align:left; padding:12px 14px; border-radius:9px; cursor:pointer;
    border:1px solid var(--studio-border); background:var(--studio-card); color:var(--vscode-foreground);
  }
  .framework-card:hover { background:var(--vscode-list-hoverBackground); }
  .framework-card:focus-visible { outline:2px solid var(--vscode-focusBorder); outline-offset:2px; }
  .framework-card.selected { border-color:var(--studio-accent); border-width:2px; padding:11px 13px; }
  .framework-card[disabled] { opacity:.6; cursor:default; }
  .framework-name { font-weight:700; font-size:.92rem; }
  .framework-desc { font-size:.78rem; color:var(--studio-muted); }
  /* The verdict is the reason somebody reads the card, so it is the loudest
     thing on it after the name — and an unsupported pairing stays visible
     rather than being removed from the list. */
  .framework-badge {
    align-self:flex-start; padding:1px 8px; border-radius:999px;
    font-size:.66rem; font-weight:700; text-transform:uppercase; letter-spacing:.07em;
    border:1px solid var(--studio-border);
  }
  .compat-ideal .framework-badge {
    color:var(--vscode-testing-iconPassed, #3fb950);
    border-color:color-mix(in srgb, var(--vscode-testing-iconPassed, #3fb950) 55%, transparent);
    background:color-mix(in srgb, var(--vscode-testing-iconPassed, #3fb950) 12%, transparent);
  }
  .compat-workable .framework-badge {
    color:var(--vscode-editorWarning-foreground, #d29922);
    border-color:color-mix(in srgb, var(--vscode-editorWarning-foreground, #d29922) 55%, transparent);
    background:color-mix(in srgb, var(--vscode-editorWarning-foreground, #d29922) 12%, transparent);
  }
  .compat-unsupported { opacity:.72; }
  .compat-unsupported .framework-badge {
    color:var(--vscode-errorForeground, #f85149);
    border-color:color-mix(in srgb, var(--vscode-errorForeground, #f85149) 55%, transparent);
    background:transparent;
  }
  .framework-reason { font-size:.75rem; color:var(--studio-muted); line-height:1.4; }
  .framework-meta { font-size:.7rem; color:var(--studio-muted); }
  .framework-meta code { font-size:.68rem; }

  .stack-summary { margin-top:14px; padding-top:12px; border-top:1px solid var(--studio-border); }
  .stack-summary dl { display:grid; grid-template-columns:auto 1fr; gap:6px 14px; margin:8px 0 0; font-size:.82rem; }
  .stack-summary dt { color:var(--studio-muted); font-weight:600; }
  .stack-summary dd { margin:0; }

  .drift-readout { margin-top:10px; font-size:.85rem; }
  .drift-readout p { margin:0; }
  .drift-unknown { color:var(--studio-muted); font-style:italic; }

  .element-count { margin:0 0 8px; font-size:.78rem; color:var(--studio-muted); }
  .structure-list { margin:0 0 12px; padding-left:18px; font-size:.84rem; }
  .structure-list small { color:var(--studio-muted); text-transform:uppercase; font-size:.66rem; letter-spacing:.07em; }

  .profile-card { display:grid; grid-template-columns:minmax(0, 1fr) minmax(220px, .45fr); gap:22px; align-items:end; }
  .profile-card h2, .profile-card p { margin-top:0; }
  .content-screen-grid { display:grid; gap:14px; }
  .content-screen-card {
    border:1px solid var(--studio-border);
    border-radius:12px;
    padding:16px;
    background:color-mix(in srgb, var(--studio-surface) 86%, transparent);
  }
  .content-screen-card h3 { margin:0; }
  .content-screen-card .card-heading p { margin:4px 0 0; color:var(--studio-muted); }
  .content-screen-card .content-body { min-height:260px; font-family:var(--vscode-editor-font-family, monospace); }
  .content-editor-footer { display:flex; justify-content:space-between; align-items:center; gap:16px; color:var(--studio-muted); font-size:.8rem; }
  .seed-page-content, .save-page-content { background:var(--vscode-button-background); color:var(--vscode-button-foreground); }
  .implementation-guide { margin-bottom:16px; }
  .preview-launch-card { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:28px; align-items:center; border-top:4px solid var(--studio-accent); }
  .preview-launch-card h2 { font-size:1.35rem; }
  .preview-launch-card p { color:var(--studio-muted); max-width:76ch; }
  .preview-primary-actions { display:grid; gap:9px; min-width:250px; }
  .preview-freshness { font-size:.82rem; }
  .preview-proof-list { margin:8px 0 0; padding-left:20px; color:var(--studio-muted); }
  .preview-proof-list li { margin:7px 0; }
  .preview-coverage-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:9px; }
  .preview-coverage-item { display:grid; gap:3px; padding:11px 12px; border:1px solid var(--studio-border); border-radius:8px; }
  .preview-coverage-item span { color:var(--studio-muted); font-size:.76rem; }
  @media (max-width:760px) {
    .profile-card { grid-template-columns:1fr; }
    .content-editor-footer { align-items:flex-start; flex-direction:column; }
    .preview-launch-card { grid-template-columns:1fr; }
    .preview-primary-actions { min-width:0; }
  }
`;
