/**
 * McpPanel – webview panel for managing MCP server connections.
 *
 * Security:
 *  - All user-supplied strings are HTML-escaped before rendering.
 *  - All incoming webview messages are validated before acting on them.
 *  - No inline event handlers; all interaction goes through postMessage/onDidReceiveMessage.
 *  - The CSP restricts scripts to the single nonce embedded at render time.
 */

import * as vscode from 'vscode';
import { getWebviewHtmlShell, escapeHtml } from './webviewUtils.js';
import type { McpServerRegistry } from '../mcp/mcpServerRegistry.js';
import type { McpServerConfig, McpServerState } from '../types.js';

// ── Validated message types from the webview ─────────────────────

type PanelMessage =
  | { type: 'addServer'; payload: AddServerPayload }
  | { type: 'removeServer'; payload: { id: string } }
  | { type: 'reconnect'; payload: { id: string } }
  | { type: 'toggleEnabled'; payload: { id: string; enabled: boolean } }
  | { type: 'refresh' };

interface AddServerPayload {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string;        // raw string, split by whitespace
  env?: string;         // JSON object string
  url?: string;
  enabled: boolean;
}

export class McpPanel {
  public static currentPanel: McpPanel | undefined;
  private static readonly viewType = 'atlasmind.mcpPanel';

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(
    context: vscode.ExtensionContext,
    registry: McpServerRegistry,
    onRefresh: () => void,
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (McpPanel.currentPanel) {
      McpPanel.currentPanel.panel.reveal(column);
      McpPanel.currentPanel.update(registry);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      McpPanel.viewType,
      'AtlasMind: MCP Servers',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );

    McpPanel.currentPanel = new McpPanel(panel, registry, onRefresh);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private registry: McpServerRegistry,
    private readonly onRefresh: () => void,
  ) {
    this.panel = panel;
    this.panel.webview.html = this.buildHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => { void this.handleMessage(message); },
      null,
      this.disposables,
    );
  }

  /** Re-render with fresh registry state. */
  update(registry: McpServerRegistry): void {
    this.registry = registry;
    this.panel.webview.html = this.buildHtml();
  }

  private dispose(): void {
    McpPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) { d.dispose(); }
  }

  // ── Message handling ─────────────────────────────────────────

  private async handleMessage(raw: unknown): Promise<void> {
    const message = validatePanelMessage(raw);
    if (!message) { return; }

    switch (message.type) {
      case 'addServer': {
        const p = message.payload;
        const config = buildServerConfig(p);
        if (!config) {
          void vscode.window.showErrorMessage('Invalid server configuration. Check the form and try again.');
          return;
        }
        const id = this.registry.addServer(config);
        if (config.enabled) {
          await this.registry.connectServer(id);
          this.onRefresh();
        }
        break;
      }
      case 'removeServer': {
        const { id } = message.payload;
        if (typeof id !== 'string' || !id) { return; }
        await this.registry.removeServer(id);
        this.onRefresh();
        break;
      }
      case 'reconnect': {
        const { id } = message.payload;
        if (typeof id !== 'string' || !id) { return; }
        await this.registry.disconnectServer(id);
        await this.registry.connectServer(id);
        this.onRefresh();
        break;
      }
      case 'toggleEnabled': {
        const { id, enabled } = message.payload;
        if (typeof id !== 'string' || typeof enabled !== 'boolean') { return; }
        this.registry.updateServer(id, { enabled });
        if (!enabled) {
          await this.registry.disconnectServer(id);
        } else {
          await this.registry.connectServer(id);
        }
        this.onRefresh();
        break;
      }
      case 'refresh':
        break;
    }

    this.panel.webview.html = this.buildHtml();
  }

  // ── HTML rendering ───────────────────────────────────────────

  private buildHtml(): string {
    const servers = this.registry.listServers();
    return getWebviewHtmlShell({
      title: 'MCP Servers',
      cspSource: this.panel.webview.cspSource,
      extraCss: MCP_EXTRA_CSS,
      bodyContent: buildBody(servers),
      scriptContent: MCP_SCRIPT,
    });
  }
}

// ── HTML helpers ──────────────────────────────────────────────────

function buildBody(servers: McpServerState[]): string {
  const serverRows = servers.length === 0
    ? '<p class="muted">No MCP servers configured. Use the form below to add one.</p>'
    : servers.map(renderServerCard).join('');

  return `
  <h1>MCP Servers</h1>
  <p>Connect AtlasMind to external MCP servers. Each server's tools become available as skills.</p>

  <section id="server-list">
    <h2>Configured Servers</h2>
    ${serverRows}
  </section>

  <section>
    <h2>Add Server</h2>
    <form id="add-form">
      <div class="field-row">
        <label for="serverName">Name</label>
        <input id="serverName" type="text" placeholder="My MCP Server" required />
      </div>

      <div class="field-row">
        <label>Transport</label>
        <div class="radio-group">
          <label><input type="radio" name="transport" value="stdio" checked id="transportStdio" /> stdio (subprocess)</label>
          <label><input type="radio" name="transport" value="http" id="transportHttp" /> HTTP / SSE (remote)</label>
        </div>
      </div>

      <div id="stdioFields">
        <div class="field-row">
          <label for="cmdField">Command</label>
          <input id="cmdField" type="text" placeholder="npx" />
        </div>
        <div class="field-row">
          <label for="argsField">Args (space-separated)</label>
          <input id="argsField" type="text" placeholder="-y @modelcontextprotocol/server-filesystem /tmp" />
        </div>
        <div class="field-row">
          <label for="envField">Env vars (JSON)</label>
          <input id="envField" type="text" placeholder='{"NODE_ENV":"production"}' />
        </div>
      </div>

      <div id="httpFields" style="display:none">
        <div class="field-row">
          <label for="urlField">URL</label>
          <input id="urlField" type="url" placeholder="http://localhost:3000/mcp" />
        </div>
      </div>

      <div class="field-row">
        <label><input type="checkbox" id="enabledCheck" checked /> Connect immediately</label>
      </div>

      <div class="actions">
        <button type="submit">Add Server</button>
      </div>
    </form>
  </section>
  `;
}

function renderServerCard(state: McpServerState): string {
  const { config, status, error, tools } = state;
  const statusClass = `status-${status}`;
  const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
  const toolCount = tools.length;
  const toolSummary = toolCount === 1 ? '1 tool' : `${toolCount} tools`;

  const toolRows = tools.length > 0
    ? `<details class="tool-list"><summary>${escapeHtml(toolSummary)}</summary><ul>` +
      tools.map(t =>
        `<li><strong>${escapeHtml(t.name)}</strong>${t.description ? ' – ' + escapeHtml(t.description) : ''}</li>`,
      ).join('') +
      '</ul></details>'
    : `<span class="muted">${status === 'connected' ? 'No tools exposed' : toolSummary}</span>`;

  const configDetail = config.transport === 'stdio'
    ? `stdio: <code>${escapeHtml(config.command ?? '')} ${escapeHtml((config.args ?? []).join(' ')).trim()}</code>`
    : `http: <code>${escapeHtml(config.url ?? '')}</code>`;

  return `
  <div class="server-card">
    <div class="server-header">
      <span class="status-dot ${statusClass}" title="${escapeHtml(statusLabel)}"></span>
      <strong>${escapeHtml(config.name)}</strong>
      <span class="server-meta">${configDetail}</span>
      <div class="server-actions">
        <button class="btn-small" data-action="reconnect" data-id="${escapeHtml(config.id)}" title="Reconnect">↺</button>
        <button class="btn-small btn-danger" data-action="remove" data-id="${escapeHtml(config.id)}" title="Remove">✕</button>
        <label class="toggle-label" title="${config.enabled ? 'Enabled – click to disable' : 'Disabled – click to enable'}">
          <input type="checkbox" data-action="toggle" data-id="${escapeHtml(config.id)}" ${config.enabled ? 'checked' : ''} /> Enabled
        </label>
      </div>
    </div>
    ${error ? `<div class="error-msg">${escapeHtml(error)}</div>` : ''}
    <div class="tool-summary">${toolRows}</div>
  </div>
  `;
}

// ── CSS ───────────────────────────────────────────────────────────

const MCP_EXTRA_CSS = `
  .server-card {
    border: 1px solid var(--vscode-widget-border, #444);
    border-radius: 4px;
    padding: 10px 14px;
    margin-bottom: 10px;
  }
  .server-header {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .server-meta { font-size: 0.85em; color: var(--vscode-descriptionForeground); flex: 1; }
  .server-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; }
  .status-dot {
    width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex-shrink: 0;
  }
  .status-connected  { background: #4caf50; }
  .status-connecting { background: #ff9800; }
  .status-error      { background: #f44336; }
  .status-disconnected { background: var(--vscode-descriptionForeground, #888); }
  .error-msg { color: var(--vscode-errorForeground, #f44336); font-size: 0.85em; margin-top: 4px; }
  .tool-list { margin-top: 6px; }
  .tool-list summary { cursor: pointer; font-size: 0.9em; }
  .tool-list ul { margin: 4px 0 0 16px; padding: 0; list-style: disc; }
  .tool-list li { font-size: 0.85em; margin-bottom: 2px; }
  .tool-summary { margin-top: 6px; }
  .muted { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .field-row { display: flex; flex-direction: column; margin-bottom: 10px; gap: 4px; }
  .field-row label { font-size: 0.9em; font-weight: 500; }
  .field-row input[type="text"],
  .field-row input[type="url"] {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, #555);
    padding: 4px 8px;
    border-radius: 2px;
    font-size: 0.9em;
    width: 100%;
    box-sizing: border-box;
  }
  .radio-group { display: flex; gap: 16px; }
  .actions { margin-top: 8px; }
  .btn-small {
    padding: 2px 8px;
    font-size: 0.85em;
    cursor: pointer;
    background: var(--vscode-button-secondaryBackground, #444);
    color: var(--vscode-button-secondaryForeground, #fff);
    border: none;
    border-radius: 2px;
  }
  .btn-danger:hover { background: #c62828; }
  .toggle-label { display: flex; align-items: center; gap: 4px; font-size: 0.85em; cursor: pointer; }
  code { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.85em; }
`;

// ── Client-side script ────────────────────────────────────────────

const MCP_SCRIPT = `
(function() {
  const vscode = acquireVsCodeApi();

  // Transport toggle
  document.querySelectorAll('input[name="transport"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isStdio = document.getElementById('transportStdio').checked;
      document.getElementById('stdioFields').style.display = isStdio ? '' : 'none';
      document.getElementById('httpFields').style.display = isStdio ? 'none' : '';
    });
  });

  // Add server form
  document.getElementById('add-form')?.addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('serverName').value.trim();
    if (!name) { return; }
    const isStdio = document.getElementById('transportStdio').checked;
    const payload = {
      name,
      transport: isStdio ? 'stdio' : 'http',
      command: document.getElementById('cmdField').value.trim() || undefined,
      args: document.getElementById('argsField').value.trim() || undefined,
      env: document.getElementById('envField').value.trim() || undefined,
      url: document.getElementById('urlField').value.trim() || undefined,
      enabled: document.getElementById('enabledCheck').checked,
    };
    vscode.postMessage({ type: 'addServer', payload });
  });

  // Reconnect / remove / toggle buttons
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) { return; }
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (action === 'reconnect') {
      vscode.postMessage({ type: 'reconnect', payload: { id } });
    } else if (action === 'remove') {
      vscode.postMessage({ type: 'removeServer', payload: { id } });
    }
  });

  // Enable/disable toggle
  document.addEventListener('change', e => {
    const chk = e.target;
    if (chk.dataset && chk.dataset.action === 'toggle') {
      vscode.postMessage({ type: 'toggleEnabled', payload: { id: chk.dataset.id, enabled: chk.checked } });
    }
  });
})();
`;

// ── Validation helpers ────────────────────────────────────────────

export function validatePanelMessage(raw: unknown): PanelMessage | null {
  if (typeof raw !== 'object' || raw === null) { return null; }
  const msg = raw as Record<string, unknown>;
  const type = msg['type'];

  switch (type) {
    case 'addServer': {
      const p = msg['payload'];
      if (typeof p !== 'object' || p === null) { return null; }
      const payload = p as Record<string, unknown>;
      if (payload['transport'] !== 'stdio' && payload['transport'] !== 'http') { return null; }
      if (typeof payload['name'] !== 'string' || !payload['name']) { return null; }
      return { type: 'addServer', payload: payload as unknown as AddServerPayload };
    }
    case 'removeServer':
    case 'reconnect': {
      const p = msg['payload'];
      if (typeof p !== 'object' || p === null) { return null; }
      const id = (p as Record<string, unknown>)['id'];
      if (typeof id !== 'string' || !id) { return null; }
      return { type, payload: { id } } as PanelMessage;
    }
    case 'toggleEnabled': {
      const p = msg['payload'];
      if (typeof p !== 'object' || p === null) { return null; }
      const pp = p as Record<string, unknown>;
      if (typeof pp['id'] !== 'string' || typeof pp['enabled'] !== 'boolean') { return null; }
      return { type: 'toggleEnabled', payload: { id: pp['id'] as string, enabled: pp['enabled'] as boolean } };
    }
    case 'refresh':
      return { type: 'refresh' };
    default:
      return null;
  }
}

/**
 * Parse an AddServerPayload into an McpServerConfig (minus id).
 * Returns null if the payload is insufficient to build a valid config.
 */
function buildServerConfig(p: AddServerPayload): Omit<McpServerConfig, 'id'> | null {
  const name = (p.name ?? '').trim();
  if (!name) { return null; }

  if (p.transport === 'stdio') {
    const command = (p.command ?? '').trim();
    if (!command) { return null; }
    const args = p.args ? p.args.trim().split(/\s+/).filter(Boolean) : [];
    let env: Record<string, string> | undefined;
    if (p.env) {
      try {
        const parsed: unknown = JSON.parse(p.env);
        if (typeof parsed === 'object' && parsed !== null) {
          env = parsed as Record<string, string>;
        }
      } catch {
        return null; // Invalid env JSON
      }
    }
    return { name, transport: 'stdio', command, args, env, enabled: p.enabled };
  }

  // http
  const url = (p.url ?? '').trim();
  if (!url) { return null; }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') { return null; }
  } catch {
    return null;
  }
  return { name, transport: 'http', url, enabled: p.enabled };
}
