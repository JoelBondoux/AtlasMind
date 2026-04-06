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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${options.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${options.cspSource} https: data:; base-uri 'none'; form-action 'none';" />
  <title>${escapeHtml(options.title)}</title>
  <style>
    body {
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 16px;
      line-height: 1.5;
    }
    h1 { font-size: 1.4em; margin-bottom: 0.5em; }
    h2 { font-size: 1.1em; margin-top: 1.2em; }
    section { margin-bottom: 1.5em; }
    table { border-collapse: collapse; width: 100%; margin-top: 0.75em; }
    th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--vscode-widget-border, #444); }
    th { font-weight: 600; }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 4px 12px;
      cursor: pointer;
      border-radius: 2px;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
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
