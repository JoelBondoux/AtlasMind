import { DASHBOARD_PANEL_BASE_CSS, DASHBOARD_PANEL_SKIN_CSS } from './dashboardTheme.js';

/** The extension mark as a CSP-safe data URI for panels without local resource roots. */
export const ATLAS_ICON_DATA_URI = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Ccircle cx=%2212%22 cy=%2212%22 r=%2210%22/%3E%3Cpath d=%22M12 2 C7 7,7 17,12 22%22/%3E%3Cpath d=%22M12 2 C17 7,17 17,12 22%22/%3E%3Cline x1=%222%22 y1=%2212%22 x2=%2222%22 y2=%2212%22/%3E%3C/svg%3E';

/**
 * Shared HTML shell for webview panels.
 * Keeps styling consistent across all AtlasMind panels.
 */
export interface WebviewShellOptions {
  title: string;
  bodyContent: string;
  cspSource: string;
  scriptContent?: string;
  /** URI to an external script loaded via <script src>. Preferred over scriptContent. */
  scriptUri?: string;
  /**
   * Scripts loaded *before* `scriptUri`, in order.
   *
   * For vendored libraries the panel script expects on `window`. Kept separate
   * from `scriptUri` so the panel's own script stays the last thing to run and
   * can assume its dependencies are present.
   */
  vendorScriptUris?: readonly string[];
  /** Additional CSS injected into the <style> block. */
  extraCss?: string;
  /**
   * Render this panel in the Project Dashboard's design language.
   *
   * The shell wraps `extraCss` in the two layers described in
   * `dashboardTheme.ts`: the tokens and page frame before it, the skin after.
   * That ordering is the point — the panel keeps its own layout and loses its
   * own palette — and doing it here rather than at each call site is what stops
   * one panel from concatenating the layers in the wrong order and quietly
   * looking like it did before.
   *
   * Opt-in rather than default, because the Personality Profile's warm palette
   * is deliberate and stays as it is.
   */
  dashboardSkin?: boolean;
}

export function getWebviewHtmlShell(options: WebviewShellOptions): string {
  const nonce = getNonce();
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${options.cspSource} https: data: blob:; media-src ${options.cspSource} https: data: blob:; font-src ${options.cspSource} data:; style-src ${options.cspSource} 'unsafe-inline'; script-src ${options.cspSource} 'nonce-${nonce}' blob:; worker-src ${options.cspSource} blob:; connect-src ${options.cspSource} https: wss: data: blob:; child-src ${options.cspSource} blob:; frame-src ${options.cspSource} blob:; base-uri 'none'; form-action 'none';" />
  <title>${escapeHtml(options.title)}</title>
  <style>
    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }
    /* Only structural boxes get a zero minimum. Applying this to inline text,
       labels and controls lets flex/grid shrink them below their longest word;
       Chromium then "solves" the row by rendering a word like "requirement"
       as fragments. Containers should shrink, content-sized controls
       should wrap or move to the next row. */
    :where(section, article, div, p, h1, h2, h3, h4, h5, h6, ul, ol, li, textarea, input, select, table, th, td) {
      min-width: 0;
    }
    /* "break-word" contains a genuinely long token without changing the
       element's min-content width. "anywhere" does change that width and is
       reserved below for links, where an unbroken URL really may be wider than
       the panel. */
    :where(p, h1, h2, h3, h4, h5, h6, li, td, th, strong, span) {
      overflow-wrap: break-word;
      word-break: normal;
    }
    :where(a) {
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    :where(button, label) {
      max-width: 100%;
      overflow-wrap: break-word;
      word-break: normal;
    }
    html, body {
      max-width: 100%;
      overflow-x: hidden;
    }
    /* Theme-direction tint.
       Panel CSS repeatedly lightens an accent for legibility — e.g.
       "color-mix(in srgb, var(--accent) 80%, white 20%)". That is correct on a
       dark theme and backwards on a light one, where the same rule washes the
       text out against a white page. VS Code puts "vscode-light" /
       "vscode-dark" / "vscode-high-contrast" on the webview body, so mixing
       toward "var(--tint-away)" instead of a literal moves the colour *away*
       from the page background in whichever theme is active.
       "--tint-toward" is the opposite direction, for tinting surfaces. */
    :root {
      --tint-away: white;
      --tint-toward: black;
    }
    body.vscode-light {
      --tint-away: black;
      --tint-toward: white;
    }
    body {
      margin: 0;
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 18px;
      line-height: 1.5;
    }
    h1 { font-size: 1.4em; margin-bottom: 0.5em; }
    h2 { font-size: 1.1em; margin-top: 1.2em; }
    section { margin-bottom: 1.5em; }
    table { border-collapse: collapse; width: 100%; margin-top: 0.75em; }
    th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--vscode-widget-border, #444); }
    th { font-weight: 600; }
    /* Structural defaults apply to every button.
       "color: inherit" is load-bearing, not tidiness. A <button> with no author
       "color" falls back to the UA keyword "buttontext", which Chromium paints
       black regardless of the VS Code theme. That is invisible to any audit of
       declared colours — it is a *missing* declaration, not a wrong one — and it
       is exactly what turned every classed button black-on-black in dark mode
       once the paint below was scoped to unclassed buttons: rules like
       ".action-title { font-weight: 700 }" set weight and let the colour come
       from the surface, which is what "inherit" restores. */
    button {
      border: none;
      padding: 4px 12px;
      cursor: pointer;
      border-radius: 2px;
      font-family: inherit;
      color: inherit;
      max-width: 100%;
      white-space: normal;
    }
    /* Same hazard, same fix, for text-entry controls: unstyled they take the UA
       "field"/"fieldtext" pair (white on black text). Colour and background are
       set together so neither can be inherited into a same-on-same pairing.
       Wrapped in :where() so specificity stays 0 and any panel rule wins. */
    :where(input:not([type="radio"]):not([type="checkbox"]), select, textarea) {
      color: var(--vscode-input-foreground, var(--vscode-foreground));
      background: var(--vscode-input-background, var(--vscode-editor-background));
    }
    /* The primary *paint* is scoped to genuinely unclassed buttons.
       It used to apply to all of them, and "button:hover" at specificity
       (0,1,1) then beat every single-class variant (0,1,0) no matter what
       order the panel's own CSS came in. That inverted real state: a chat
       toggle's "on" tint (a translucent color-mix) rendered *fainter* than its
       "off" state, which was borrowing this solid fill. It also meant a button
       given a class with no rule of its own silently looked like a primary
       action — which is how a destructive "Remove" became the loudest control
       on the Resource Discovery page.
       ":not([class])" does not out-specify panel variants; it simply stops
       matching them, so each panel controls its own surface. Unclassed buttons
       inside a styled container (e.g. ".segmented button") tie on specificity
       and resolve in the panel's favour, since extraCss is injected after this. */
    button:not([class]) {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button:not([class]):hover { background: var(--vscode-button-hoverBackground); }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.85em;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .slider-group { display: flex; gap: 16px; margin-top: 8px; }
    .slider-group label { cursor: pointer; }
    input[type="radio"] { margin-right: 4px; }
    ${options.dashboardSkin ? DASHBOARD_PANEL_BASE_CSS : ''}
    ${options.extraCss ?? ''}
    ${options.dashboardSkin ? DASHBOARD_PANEL_SKIN_CSS : ''}
  </style>
</head>
<body>
  ${options.bodyContent}
  ${(options.vendorScriptUris ?? [])
    .map(uri => `<script nonce="${nonce}" src="${uri}"></script>`)
    .join('\n  ')}
  ${options.scriptUri
    ? `<script nonce="${nonce}" src="${options.scriptUri}"></script>`
    : options.scriptContent
      ? `<script nonce="${nonce}">${options.scriptContent}</script>`
      : ''}
</body>
</html>`;
}

/**
 * Quick-reply pill styling, shared by every surface that can ask a question.
 *
 * One-tap answers were a Chat-panel-only affordance, which made them read as a
 * property of that panel rather than of Atlas asking a question. Defined once
 * here so the Chat panel, the dashboard ideation chat, the Ideation panel, and
 * the Vision panel cannot drift into four slightly different pills.
 */
export const QUICK_REPLY_CSS = `
        /* Quick-reply pill buttons — immediate-submit, no Proceed step required */
        .quick-reply-buttons {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
          margin-right: 6px;
        }
        .quick-reply-btn {
          appearance: none;
          border-radius: 999px;
          padding: 4px 14px;
          font-size: 0.75rem;
          line-height: 1.35;
          cursor: pointer;
          font-weight: 600;
          border: 1px solid color-mix(in srgb, var(--vscode-button-background) 70%, var(--vscode-widget-border, #444));
          background: color-mix(in srgb, var(--vscode-button-background) 14%, transparent);
          color: var(--vscode-foreground);
          transition: background 100ms ease, border-color 100ms ease, transform 80ms ease;
        }
        .quick-reply-btn:hover {
          background: color-mix(in srgb, var(--vscode-button-background) 28%, transparent);
          border-color: var(--vscode-button-background);
        }
        .quick-reply-btn:active {
          transform: scale(0.96);
        }`;

/**
 * Shared Atlas-chat affordance used when a panel can explain or resolve the
 * state it is showing. The logo is never the only accessible label: compact
 * uses keep text for assistive technology, while roomy error rows show it.
 */
export const ATLAS_DISCUSS_ACTION_CSS = `
  .atlas-discuss-action {
    appearance: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    align-self: flex-start;
    gap: 6px;
    width: max-content;
    min-width: 30px;
    min-height: 30px;
    max-width: 100%;
    padding: 4px 9px;
    border: 1px solid color-mix(in srgb, var(--vscode-textLink-foreground) 52%, var(--vscode-widget-border, rgba(127, 127, 127, 0.4)));
    border-radius: 999px;
    background: color-mix(in srgb, var(--vscode-textLink-foreground) 12%, transparent);
    color: var(--vscode-textLink-foreground);
    font: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    line-height: 1.2;
    cursor: pointer;
    flex: 0 0 auto;
  }
  .atlas-discuss-action:hover {
    background: color-mix(in srgb, var(--vscode-textLink-foreground) 22%, transparent);
    border-color: var(--vscode-textLink-foreground);
  }
  .atlas-discuss-action:focus-visible {
    outline: 2px solid var(--vscode-focusBorder);
    outline-offset: 2px;
  }
  .atlas-discuss-action img {
    width: 18px;
    height: 18px;
    object-fit: contain;
    flex: 0 0 auto;
  }
  body.vscode-dark .atlas-discuss-action img,
  body.vscode-high-contrast .atlas-discuss-action img {
    filter: invert(1);
  }
  /*
   * The compact Atlas action: a pill carrying two symbols — the Atlas mark on
   * the left saying *who* is being asked, and a glyph on the right saying
   * *what* it will do.
   *
   * It replaces a bare circular icon that was the same button everywhere,
   * whatever it did: "Ask Atlas" told you who but never what, so a row of them
   * was a row of identical circles and the only way to tell them apart was to
   * hover each one. The glyph makes the action visible at a glance while the
   * tooltip and the accessible name still carry the full sentence.
   */
  .atlas-discuss-action.icon-only {
    padding: 3px 9px 3px 5px;
    gap: 5px;
  }
  .atlas-discuss-action.icon-only .atlas-discuss-glyph {
    font-size: 0.86em;
    line-height: 1;
    opacity: 0.9;
  }
  .atlas-discuss-action.icon-only .atlas-discuss-label {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
`;

/**
 * The glyph vocabulary, declared once so the same intent looks the same on
 * every surface.
 *
 * Deliberately short: a symbol set nobody can learn is decoration. Each of
 * these appears beside the Atlas mark, and the tooltip always carries the
 * sentence — the glyph narrows what the button does, it never has to carry the
 * whole meaning alone.
 */
export const ATLAS_ACTION_GLYPHS = {
  /** Explain, review, or discuss something that already exists. */
  discuss: '☷',
  /** Propose a change to it. */
  improve: '✎',
  /** Work through a problem — a failure, a gap, a piece of debt. */
  fix: '⚒',
  /** Draft something that does not exist yet. */
  draft: '+',
  /** Summarise or report on a body of work. */
  summarise: '≡',
} as const;

export type AtlasActionIntent = keyof typeof ATLAS_ACTION_GLYPHS;

export interface AtlasDiscussActionOptions {
  iconUri: string;
  action: string;
  label: string;
  title: string;
  targetId?: string;
  /** What this button will do, shown as a glyph beside the Atlas mark. */
  intent?: AtlasActionIntent;
}

/** Render a nonce-free, delegated-event button that opens an Atlas discussion. */
export function renderAtlasDiscussAction(options: AtlasDiscussActionOptions): string {
  const target = options.targetId
    ? ` data-id="${escapeHtml(options.targetId)}"`
    : '';
  const glyph = ATLAS_ACTION_GLYPHS[options.intent ?? 'discuss'];
  return `<button type="button" class="atlas-discuss-action icon-only" data-action="${escapeHtml(options.action)}"${target} title="${escapeHtml(options.title)}" aria-label="${escapeHtml(options.label)}"><img src="${escapeHtml(options.iconUri)}" alt="" aria-hidden="true" /><span class="atlas-discuss-glyph" aria-hidden="true">${glyph}</span><span class="atlas-discuss-label">${escapeHtml(options.label)}</span></button>`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
