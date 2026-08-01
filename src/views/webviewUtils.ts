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
  /** Additional CSS injected into the <style> block. */
  extraCss?: string;
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
    ${options.extraCss ?? ''}
  </style>
</head>
<body>
  ${options.bodyContent}
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
  .atlas-discuss-action.icon-only {
    width: 30px;
    padding: 4px;
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

export interface AtlasDiscussActionOptions {
  iconUri: string;
  action: string;
  label: string;
  title: string;
  targetId?: string;
  iconOnly?: boolean;
}

/** Render a nonce-free, delegated-event button that opens an Atlas discussion. */
export function renderAtlasDiscussAction(options: AtlasDiscussActionOptions): string {
  const target = options.targetId
    ? ` data-id="${escapeHtml(options.targetId)}"`
    : '';
  return `<button type="button" class="atlas-discuss-action${options.iconOnly ? ' icon-only' : ''}" data-action="${escapeHtml(options.action)}"${target} title="${escapeHtml(options.title)}" aria-label="${escapeHtml(options.label)}"><img src="${escapeHtml(options.iconUri)}" alt="" aria-hidden="true" /><span class="atlas-discuss-label">${escapeHtml(options.label)}</span></button>`;
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
