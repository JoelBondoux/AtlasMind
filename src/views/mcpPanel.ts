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
  | { type: 'refresh' }
  | { type: 'openSettingsSafety' }
  | { type: 'openAgentPanel' };

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
      case 'openSettingsSafety':
        await vscode.commands.executeCommand('atlasmind.openSettingsSafety');
        return;
      case 'openAgentPanel':
        await vscode.commands.executeCommand('atlasmind.openAgentPanel');
        return;
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
  const connectedCount = servers.filter(server => server.status === 'connected').length;
  const enabledCount = servers.filter(server => server.config.enabled).length;
  const serverRows = servers.length === 0
    ? '<p class="muted">No MCP servers configured yet.</p>'
    : servers.map(renderServerCard).join('');

  return `
  <div class="panel-hero">
    <div>
      <p class="eyebrow">External tools</p>
      <h1>MCP Servers</h1>
      <p class="hero-copy">Manage external Model Context Protocol servers from a workspace-style surface instead of a single stack of cards and form fields. Connected server tools become AtlasMind skills.</p>
    </div>
    <div class="hero-badges" aria-label="MCP summary">
      <button type="button" class="hero-badge hero-badge-button" data-hero-page-target="servers" data-search-query="" title="Open the configured server list.">${servers.length} configured</button>
      <button type="button" class="hero-badge hero-badge-button" data-hero-page-target="servers" data-search-query="connected" title="Filter the server list to connected MCP servers.">${connectedCount} connected</button>
      <button type="button" class="hero-badge hero-badge-button" data-hero-page-target="servers" data-search-query="enabled" title="Filter the server list to enabled MCP servers.">${enabledCount} enabled</button>
    </div>
  </div>

  <div class="search-shell">
    <label class="search-label" for="mcpSearch">Search MCP servers</label>
    <input id="mcpSearch" type="search" placeholder="Search by server name, transport, or status" />
    <p id="mcpSearchStatus" class="search-status" aria-live="polite">Browse by page or search configured servers.</p>
  </div>

  <div class="panel-layout">
    <nav class="panel-nav" aria-label="MCP server sections" role="tablist" aria-orientation="vertical">
      <button type="button" class="nav-link active" data-page-target="overview" data-search="overview safety settings agents server skills">Overview</button>
      <button type="button" class="nav-link" data-page-target="servers" data-search="servers configured connected disconnected tools stdio http">Configured Servers</button>
      <button type="button" class="nav-link" data-page-target="add" data-search="add server stdio http env args url connect immediately">Add Server</button>
    </nav>

    <main class="panel-main">
      <section id="page-overview" class="panel-page active">
        <div class="page-header">
          <p class="page-kicker">Overview</p>
          <h2>MCP workspace</h2>
          <p>Quickly add a server, jump to safety settings for external tool policy, or open the agent workspace that consumes MCP-exposed skills.</p>
        </div>
        <div class="action-grid">
          <button type="button" class="action-card action-primary" data-nav-target="add">
            <span class="action-title">Add MCP Server</span>
            <span class="action-copy">Move directly into the new-server form with stdio and HTTP transport support.</span>
          </button>
          <button type="button" id="open-settings-safety" class="action-card">
            <span class="action-title">Open Safety Settings</span>
            <span class="action-copy">Review external tool approval and related safety controls.</span>
          </button>
          <button type="button" id="open-agent-panel" class="action-card">
            <span class="action-title">Open Agent Workspace</span>
            <span class="action-copy">Inspect or edit the agents that can consume MCP-provided skills.</span>
          </button>
        </div>
        <div class="summary-grid">
          <article class="summary-card">
            <p class="card-kicker">Servers</p>
            <h3>${servers.length}</h3>
            <p>MCP endpoints currently registered with AtlasMind.</p>
          </article>
          <article class="summary-card">
            <p class="card-kicker">Connected</p>
            <h3>${connectedCount}</h3>
            <p>Servers currently connected and exposing tools.</p>
          </article>
          <article class="summary-card">
            <p class="card-kicker">Enabled</p>
            <h3>${enabledCount}</h3>
            <p>Servers enabled for AtlasMind to connect when available.</p>
          </article>
        </div>
      </section>

      <section id="page-servers" class="panel-page" hidden>
        <div class="page-header">
          <p class="page-kicker">Configured Servers</p>
          <h2>Registered MCP endpoints</h2>
          <p>Reconnect, disable, or remove servers and inspect the tool set currently exposed by each connection.</p>
        </div>
        <section id="server-list" class="content-card">
          ${serverRows}
        </section>
      </section>

      <section id="page-add" class="panel-page" hidden>
        <div class="page-header">
          <p class="page-kicker">Add Server</p>
          <h2>Register a new MCP endpoint</h2>
          <p>Choose stdio for a local subprocess or HTTP for a remote endpoint, then decide whether AtlasMind should connect immediately.</p>
        </div>
        <section class="content-card">
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
      </section>
    </main>
  </div>
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
  <div class="server-card" data-server-search="${escapeHtml([config.name, status, config.transport, toolSummary, config.url ?? config.command ?? ''].join(' ').toLowerCase())}">
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
  :root {
    --atlas-surface: color-mix(in srgb, var(--vscode-editor-background) 80%, var(--vscode-sideBar-background) 20%);
    --atlas-surface-strong: color-mix(in srgb, var(--vscode-editor-background) 64%, var(--vscode-sideBar-background) 36%);
    --atlas-border: var(--vscode-widget-border, rgba(127, 127, 127, 0.35));
    --atlas-accent: var(--vscode-textLink-foreground);
    --atlas-muted: var(--vscode-descriptionForeground, var(--vscode-foreground));
  }
  body { padding: 20px; }
  .panel-hero { display: flex; justify-content: space-between; gap: 20px; padding: 20px 22px; margin-bottom: 18px; border: 1px solid var(--atlas-border); border-radius: 18px; background: radial-gradient(circle at top right, color-mix(in srgb, var(--atlas-accent) 14%, transparent), transparent 40%), linear-gradient(160deg, var(--atlas-surface), var(--vscode-editor-background)); }
  .eyebrow, .page-kicker, .card-kicker { margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.74rem; color: var(--atlas-muted); }
  .panel-hero h1, .page-header h2 { margin: 0; }
  .hero-copy, .page-header p:last-child, .search-status, .summary-card p:last-child { color: var(--atlas-muted); }
  .hero-badges { display: flex; flex-wrap: wrap; gap: 10px; align-content: flex-start; justify-content: flex-end; }
  .hero-badge { border: 1px solid var(--atlas-border); border-radius: 999px; padding: 6px 12px; background: color-mix(in srgb, var(--atlas-accent) 16%, transparent); }
  .hero-badge-button { color: inherit; font: inherit; cursor: pointer; }
  .hero-badge-button:hover, .hero-badge-button:focus-visible { outline: 2px solid var(--atlas-accent); outline-offset: 2px; }
  .search-shell { display: grid; gap: 6px; margin: 0 0 18px; }
  .search-label { font-weight: 600; }
  .search-shell input { width: 100%; box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--atlas-border)); padding: 10px 12px; border-radius: 12px; }
  .panel-layout { display: grid; grid-template-columns: minmax(220px, 240px) minmax(0, 1fr); gap: 18px; align-items: start; }
  .panel-nav { position: sticky; top: 20px; display: grid; gap: 8px; padding: 16px; border: 1px solid var(--atlas-border); border-radius: 18px; background: linear-gradient(180deg, var(--atlas-surface-strong), var(--atlas-surface)); }
  .nav-link { width: 100%; text-align: left; border: 1px solid transparent; border-radius: 12px; padding: 11px 12px; background: transparent; color: var(--vscode-foreground); font-weight: 600; }
  .nav-link.active { background: color-mix(in srgb, var(--atlas-accent) 22%, transparent); border-color: color-mix(in srgb, var(--atlas-accent) 48%, var(--atlas-border)); }
  .nav-link.hidden-by-search { display: none; }
  .panel-page { display: none; }
  .panel-page.active { display: block; }
  .action-grid, .summary-grid { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .action-card, .summary-card, .content-card {
    border: 1px solid var(--atlas-border);
    border-radius: 16px;
    padding: 16px;
    background: linear-gradient(180deg, var(--atlas-surface), var(--vscode-editor-background));
  }
  .action-card { display: flex; flex-direction: column; gap: 6px; text-align: left; }
  .action-primary { border-color: color-mix(in srgb, var(--atlas-accent) 42%, var(--atlas-border)); }
  .action-title { font-weight: 700; }
  .summary-card h3 { margin: 0; font-size: 1.8rem; }
  .server-card {
    border: 1px solid var(--atlas-border);
    border-radius: 12px;
    padding: 10px 14px;
    margin-bottom: 10px;
    background: linear-gradient(180deg, var(--atlas-surface), var(--vscode-editor-background));
  }
  .server-card.hidden-by-search { display: none; }
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
    border-radius: 10px;
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
  .nav-link:hover, .nav-link:focus-visible, .action-card:hover, .action-card:focus-visible, .btn-small:focus-visible, .actions button:focus-visible {
    outline: 2px solid var(--atlas-accent);
    outline-offset: 2px;
  }
  @media (max-width: 920px) {
    .panel-layout, .action-grid, .summary-grid { grid-template-columns: 1fr; }
    .panel-nav { position: static; }
    .panel-hero { flex-direction: column; }
  }
`;

// ── Client-side script ────────────────────────────────────────────

const MCP_SCRIPT = `
(function() {
  const vscode = acquireVsCodeApi();
  const navButtons = Array.from(document.querySelectorAll('[data-page-target]'));
  const pages = Array.from(document.querySelectorAll('.panel-page'));
  const searchInput = document.getElementById('mcpSearch');
  const searchStatus = document.getElementById('mcpSearchStatus');
  const serverCards = Array.from(document.querySelectorAll('.server-card'));

  function activatePage(pageId) {
    navButtons.forEach(button => {
      if (!(button instanceof HTMLButtonElement)) { return; }
      button.classList.toggle('active', button.dataset.pageTarget === pageId);
    });
    pages.forEach(page => {
      if (!(page instanceof HTMLElement)) { return; }
      const active = page.id === 'page-' + pageId;
      page.classList.toggle('active', active);
      page.hidden = !active;
    });
  }

  function updateSearch(query) {
    const normalized = typeof query === 'string' ? query.trim().toLowerCase() : '';
    let visibleCards = 0;
    navButtons.forEach(button => {
      if (!(button instanceof HTMLButtonElement)) { return; }
      const haystack = ((button.textContent || '') + ' ' + (button.dataset.search || '')).toLowerCase();
      const matches = normalized.length === 0 || haystack.includes(normalized);
      button.classList.toggle('hidden-by-search', !matches);
    });
    serverCards.forEach(card => {
      if (!(card instanceof HTMLElement)) { return; }
      const haystack = (card.dataset.serverSearch || '').toLowerCase();
      const matches = normalized.length === 0 || haystack.includes(normalized);
      card.classList.toggle('hidden-by-search', !matches);
      if (matches) { visibleCards += 1; }
    });
    if (searchStatus instanceof HTMLElement) {
      if (normalized.length === 0) {
        searchStatus.textContent = 'Browse by page or search configured servers.';
      } else if (visibleCards === 0) {
        searchStatus.textContent = 'No MCP servers matched that search.';
      } else if (visibleCards === 1) {
        searchStatus.textContent = '1 MCP server matched.';
      } else {
        searchStatus.textContent = visibleCards + ' MCP servers matched.';
      }
    }
  }

  navButtons.forEach(button => {
    if (!(button instanceof HTMLButtonElement)) { return; }
    button.addEventListener('click', () => activatePage(button.dataset.pageTarget || 'overview'));
  });

  document.querySelectorAll('[data-hero-page-target]').forEach(button => {
    if (!(button instanceof HTMLButtonElement)) { return; }
    button.addEventListener('click', () => {
      activatePage(button.dataset.heroPageTarget || 'servers');
      if (searchInput instanceof HTMLInputElement) {
        searchInput.value = button.dataset.searchQuery || '';
        updateSearch(searchInput.value);
        searchInput.focus();
      }
    });
  });

  document.querySelectorAll('[data-nav-target]').forEach(button => {
    button.addEventListener('click', () => activatePage(button.getAttribute('data-nav-target') || 'overview'));
  });

  activatePage('overview');
  if (searchInput instanceof HTMLInputElement) {
    updateSearch(searchInput.value);
    searchInput.addEventListener('input', () => updateSearch(searchInput.value));
  }

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

  document.getElementById('open-settings-safety')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openSettingsSafety' });
  });

  document.getElementById('open-agent-panel')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openAgentPanel' });
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
    case 'openSettingsSafety':
      return { type: 'openSettingsSafety' };
    case 'openAgentPanel':
      return { type: 'openAgentPanel' };
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
