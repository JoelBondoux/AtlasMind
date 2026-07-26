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
    :where(section, article, div, button, label, p, h1, h2, h3, h4, h5, h6, span, strong, small, em, a, ul, ol, li, textarea, input, select, table, th, td) {
      min-width: 0;
    }
    :where(p, h1, h2, h3, h4, h5, h6, li, td, th, button, label, strong, span, a) {
      overflow-wrap: anywhere;
      word-break: break-word;
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
