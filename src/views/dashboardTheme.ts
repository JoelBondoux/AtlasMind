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
