/**
 * The preview window beside the Studio.
 *
 * This panel exists as its own webview for one reason worth stating plainly: it
 * needs `frame-src http://127.0.0.1:*`, and the shared shell in
 * `webviewUtils.ts` is used by every other panel in AtlasMind. Widening the
 * shared CSP so one feature can show an iframe would let *any* panel frame a
 * local port, which is a permission none of them asked for and none of them
 * would be audited against. So this file builds its own document, with its own
 * policy, and `getWebviewHtmlShell` is deliberately not used — a test pins the
 * shared shell's CSP so this decision cannot quietly be undone later.
 *
 * `portMapping` is VS Code's sanctioned way to reach a local server from a
 * webview: the iframe requests a port inside the webview's origin and the editor
 * forwards it to the extension host's real port. It keeps working over Remote
 * SSH, WSL and Codespaces, where a raw `http://127.0.0.1:PORT` in the iframe
 * would point at the wrong machine.
 *
 * The content in the frame is model-authored markup. It is sandboxed here, and
 * the preview server sets its own restrictive CSP on every response — two
 * independent boundaries, because this is the one place generated output is
 * executed as a document.
 */

import * as vscode from 'vscode';
import { escapeHtml } from './webviewUtils.js';

/** Viewport widths the preview can be pinned to, for checking a responsive design. */
export const PREVIEW_WIDTHS: ReadonlyArray<{ id: string; label: string; width: number | undefined }> = [
  { id: 'fluid', label: 'Fit', width: undefined },
  { id: 'desktop', label: 'Desktop 1280', width: 1280 },
  { id: 'tablet', label: 'Tablet 834', width: 834 },
  { id: 'mobile', label: 'Mobile 390', width: 390 },
];

export type WebsitePreviewMessage =
  | { type: 'reload' }
  | { type: 'stop' }
  | { type: 'openExternal' };

export function isWebsitePreviewMessage(input: unknown): input is WebsitePreviewMessage {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return false;
  }
  const type = (input as Record<string, unknown>)['type'];
  return type === 'reload' || type === 'stop' || type === 'openExternal';
}

export class WebsitePreviewPanel {
  public static currentPanel: WebsitePreviewPanel | undefined;
  public static readonly viewType = 'atlasmind.websitePreview';

  /**
   * Show the preview for a running server.
   *
   * `ViewColumn.Beside` rather than a fixed column: the point is that it sits
   * next to the Studio, wherever the Studio happens to be.
   */
  public static createOrShow(
    context: vscode.ExtensionContext,
    previewUrl: string,
    port: number,
    onStop: () => void,
  ): WebsitePreviewPanel {
    if (WebsitePreviewPanel.currentPanel) {
      WebsitePreviewPanel.currentPanel.update(previewUrl, port);
      WebsitePreviewPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside, true);
      return WebsitePreviewPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      WebsitePreviewPanel.viewType,
      'UI responsive preview',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [context.extensionUri],
        // The mapping that makes the iframe work on remote hosts. Both sides are
        // the same port; the indirection is what lets VS Code tunnel it.
        portMapping: [{ webviewPort: port, extensionHostPort: port }],
      },
    );

    WebsitePreviewPanel.currentPanel = new WebsitePreviewPanel(panel, previewUrl, port, onStop);
    return WebsitePreviewPanel.currentPanel;
  }

  public static close(): void {
    WebsitePreviewPanel.currentPanel?.panel.dispose();
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private previewUrl: string,
    private port: number,
    private readonly onStop: () => void,
  ) {
    this.render();
    this.panel.onDidDispose(() => {
      WebsitePreviewPanel.currentPanel = undefined;
      // This lab is not the server owner: the full preview may still be open in
      // Simple Browser. The explicit Stop button below still stops both.
    });
    this.panel.webview.onDidReceiveMessage(message => {
      if (!isWebsitePreviewMessage(message)) {
        return;
      }
      switch (message.type) {
        case 'reload':
          this.render();
          return;
        case 'stop':
          this.onStop();
          this.panel.dispose();
          return;
        case 'openExternal':
          // The panel holds the URL; the webview only asks. It cannot name an
          // address for the editor to open.
          void vscode.commands.executeCommand(
            'simpleBrowser.api.open',
            this.previewUrl,
            { title: 'UI Studio Preview', viewColumn: vscode.ViewColumn.Beside },
          );
          return;
      }
    });
  }

  public update(previewUrl: string, port: number): void {
    this.previewUrl = previewUrl;
    this.port = port;
    this.render();
  }

  /** Reload the frame after a regeneration wrote new files. */
  public refresh(): void {
    this.render();
  }

  private render(): void {
    this.panel.webview.html = getWebsitePreviewHtml(
      this.panel.webview.cspSource,
      this.previewUrl,
      this.port,
    );
  }
}

/**
 * The preview document.
 *
 * Exported so the CSP and the sandbox flags are testable without opening a
 * window — they are the security-relevant part of this file and should not be
 * checked only by eye.
 */
export function getWebsitePreviewHtml(cspSource: string, previewUrl: string, port: number): string {
  const nonce = getNonce();
  // A cache-buster so pressing Reload after a regeneration actually shows the
  // new files. The server already sends `no-store`, but the iframe's own
  // history can still serve a stale document without it.
  const framedUrl = `${previewUrl}${previewUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; frame-src http://127.0.0.1:${port} http://localhost:${port}; base-uri 'none'; form-action 'none';" />
  <title>UI responsive preview</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      height: 100vh;
      display: flex;
      flex-direction: column;
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 10px;
      border-bottom: 1px solid var(--vscode-widget-border, rgba(127,127,127,.35));
      flex-wrap: wrap;
    }
    .bar button, .bar select {
      font: inherit;
      font-size: .8rem;
      color: var(--vscode-foreground);
      background: transparent;
      border: 1px solid var(--vscode-widget-border, rgba(127,127,127,.35));
      border-radius: 6px;
      padding: 3px 10px;
      cursor: pointer;
    }
    .bar button:hover { background: var(--vscode-list-hoverBackground); }
    .spacer { margin-left: auto; }
    .origin {
      font-size: .72rem;
      opacity: .7;
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .stage {
      flex: 1;
      min-height: 0;
      display: flex;
      justify-content: center;
      background: var(--vscode-editorWidget-background, rgba(127,127,127,.08));
      padding: 10px;
    }
    iframe {
      width: 100%;
      height: 100%;
      border: 1px solid var(--vscode-widget-border, rgba(127,127,127,.35));
      border-radius: 6px;
      background: #fff;
      transition: max-width 120ms ease;
    }
  </style>
</head>
<body>
  <div class="bar">
    <button type="button" id="reload" title="Re-read the generated files">Reload</button>
    <label class="origin" for="width">Width</label>
    <select id="width" aria-label="Preview width">
      ${PREVIEW_WIDTHS.map(option =>
        `<option value="${option.width ?? ''}">${escapeHtml(option.label)}</option>`).join('')}
    </select>
    <span class="spacer"></span>
    <span class="origin">${escapeHtml(`127.0.0.1:${port}`)}</span>
    <button type="button" id="external" title="Open the full preview in VS Code's built-in browser">Open full preview</button>
    <button type="button" id="stop" title="Stop the local preview server">Stop</button>
  </div>
  <div class="stage">
    <!--
      "allow-scripts" is deliberately absent: generated pages have no JavaScript
      by construction (websiteGeneration excludes .js), so withholding it costs
      nothing and closes the case where somebody hand-adds a script to the
      preview folder.

      "allow-same-origin" is required rather than lax. Without it the framed
      document gets an opaque origin, and the preview server's own
      "style-src 'self'" then matches nothing — the design would render
      unstyled, which looks like a generation bug rather than a sandbox one.
    -->
    <iframe
      id="frame"
      src="${escapeHtml(framedUrl)}"
      title="Generated website preview"
      sandbox="allow-same-origin"
      referrerpolicy="no-referrer"></iframe>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('reload').addEventListener('click', () => vscode.postMessage({ type: 'reload' }));
    document.getElementById('stop').addEventListener('click', () => vscode.postMessage({ type: 'stop' }));
    document.getElementById('external').addEventListener('click', () => vscode.postMessage({ type: 'openExternal' }));
    document.getElementById('width').addEventListener('change', event => {
      const frame = document.getElementById('frame');
      frame.style.maxWidth = event.target.value ? event.target.value + 'px' : '100%';
    });
  </script>
</body>
</html>`;
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
