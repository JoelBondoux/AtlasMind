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
import { RECOMMENDED_MCP_SERVERS, getRecommendedMcpStarterDetails } from '../constants.js';
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
  | { type: 'importVsCodeConfig' }
  | { type: 'openSettingsSafety' }
  | { type: 'openAgentPanel' };

interface AddServerPayload {
  editServerId?: string;
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string;        // raw string, split by whitespace
  env?: string;         // JSON object string
  url?: string;
  enabled: boolean;
}

interface McpPanelTarget {
  page?: 'overview' | 'servers' | 'add';
  recommendedServerId?: string;
  statusMessage?: string;
  statusKind?: 'info' | 'success' | 'warning' | 'error';
}

export class McpPanel {
  public static currentPanel: McpPanel | undefined;
  private static readonly viewType = 'atlasmind.mcpPanel';

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private currentTarget: McpPanelTarget | undefined;

  public static createOrShow(
    context: vscode.ExtensionContext,
    registry: McpServerRegistry,
    onRefresh: () => void,
    target?: McpPanelTarget,
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (McpPanel.currentPanel) {
      McpPanel.currentPanel.currentTarget = target;
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

    McpPanel.currentPanel = new McpPanel(panel, registry, onRefresh, target);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private registry: McpServerRegistry,
    private readonly onRefresh: () => void,
    target?: McpPanelTarget,
  ) {
    this.panel = panel;
    this.currentTarget = target;
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
          this.currentTarget = {
            page: 'add',
            statusKind: 'error',
            statusMessage: 'The server details were incomplete or invalid. Please review the form and try again.',
          };
          await this.panel.webview.postMessage({
            type: 'status',
            payload: { kind: 'error', text: this.currentTarget.statusMessage },
          });
          await this.panel.webview.postMessage({
            type: 'addServerComplete',
            payload: { page: 'add' },
          });
          void vscode.window.showErrorMessage('Invalid server configuration. Check the form and try again.');
          return;
        }

        const editServerId = typeof p.editServerId === 'string' && p.editServerId.trim().length > 0
          ? p.editServerId.trim()
          : undefined;
        const existingState = editServerId
          ? this.registry.listServers().find(server => server.config.id === editServerId)
          : undefined;
        const isEditing = Boolean(existingState);

        await this.panel.webview.postMessage({
          type: 'status',
          payload: {
            kind: 'info',
            text: config.enabled
              ? `${isEditing ? 'Updating' : 'Saving'} ${config.name} and starting the MCP connection…`
              : `${isEditing ? 'Updating' : 'Saving'} ${config.name} without connecting yet…`,
          },
        });

        const id = existingState?.config.id ?? this.registry.addServer(config);
        if (existingState) {
          await this.registry.disconnectServer(id);
          this.registry.updateServer(id, config);
        }

        if (config.enabled) {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: isEditing ? `AtlasMind: updating ${config.name}` : `AtlasMind: connecting ${config.name}`,
              cancellable: false,
            },
            async progress => {
              progress.report({ message: 'Waiting for the MCP server to start and complete its first handshake…' });
              await this.registry.connectServer(id);
            },
          );
        }

        const state = this.registry.listServers().find(server => server.config.id === id);
        if (!config.enabled) {
          this.currentTarget = {
            page: 'servers',
            recommendedServerId: this.currentTarget?.recommendedServerId,
            statusKind: 'success',
            statusMessage: `${config.name} was ${isEditing ? 'updated' : 'saved'}. You can connect it later from the Configured Servers page.`,
          };
        } else if (state?.status === 'connected') {
          const successMessage = isEditing
            ? `${config.name} updated successfully and exposed ${state.tools.length} tool${state.tools.length === 1 ? '' : 's'}.`
            : `${config.name} connected successfully and exposed ${state.tools.length} tool${state.tools.length === 1 ? '' : 's'}.`;
          this.currentTarget = {
            page: 'servers',
            recommendedServerId: this.currentTarget?.recommendedServerId,
            statusKind: 'success',
            statusMessage: successMessage,
          };
          void vscode.window.showInformationMessage(successMessage);
        } else {
          const warningMessage = `${config.name} was ${isEditing ? 'updated' : 'saved'}, but the connection did not complete yet.${state?.error ? ` Last error: ${state.error}` : ''}`;
          this.currentTarget = {
            page: 'add',
            recommendedServerId: this.currentTarget?.recommendedServerId,
            statusKind: 'warning',
            statusMessage: warningMessage,
          };
          void vscode.window.showWarningMessage(warningMessage);
        }

        await this.panel.webview.postMessage({
          type: 'status',
          payload: { kind: this.currentTarget.statusKind, text: this.currentTarget.statusMessage },
        });
        await this.panel.webview.postMessage({
          type: 'addServerComplete',
          payload: { page: this.currentTarget.page ?? 'add' },
        });
        this.onRefresh();
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
      case 'importVsCodeConfig':
        await vscode.commands.executeCommand('atlasmind.mcpServers.importFromVsCode');
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
      bodyContent: buildBody(servers, this.currentTarget),
      scriptContent: buildMcpScript(this.currentTarget, servers),
    });
  }
}

// ── HTML helpers ──────────────────────────────────────────────────

function buildBody(servers: McpServerState[], target?: McpPanelTarget): string {
  const connectedCount = servers.filter(server => server.status === 'connected').length;
  const enabledCount = servers.filter(server => server.config.enabled).length;
  const serverRows = servers.length === 0
    ? '<p class="muted">No MCP servers configured yet.</p>'
    : servers.map(renderServerCard).join('');
  const recommendedOptions = buildRecommendedStarterOptions(target?.recommendedServerId);
  const initialStatusMessage = escapeHtml(
    target?.statusMessage ?? 'Choose a recommended starter or enter a custom endpoint below. AtlasMind will save the config and show connection progress here.',
  );
  const initialStatusKind = escapeHtml(target?.statusKind ?? 'info');

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
          <button type="button" id="import-vscode-mcp" class="action-card">
            <span class="action-title">Import VS Code MCP Config</span>
            <span class="action-copy">Scan the current VS Code profile and workspace mcp.json files, then copy compatible servers into AtlasMind.</span>
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
          <p>Edit parameters, reconnect, disable, or remove servers and inspect the tool set currently exposed by each connection.</p>
        </div>
        <section id="server-list" class="content-card">
          ${serverRows}
        </section>
      </section>

      <section id="page-add" class="panel-page" hidden>
        <div class="page-header">
          <p class="page-kicker">Add Server</p>
          <h2>Register a new MCP endpoint</h2>
          <p>Pick a recommended MCP starter or enter your own endpoint details. AtlasMind will show what stage the connection is in while it saves and connects.</p>
        </div>
        <section class="content-card">
          <div class="preset-shell">
            <div class="field-row">
              <label for="recommendedServerPreset">Start from a recommended server</label>
              <select id="recommendedServerPreset">
                <option value="">Choose a preset or continue with a custom endpoint</option>
                ${recommendedOptions}
              </select>
            </div>
            <div id="recommendedServerSummary" class="muted">Select a preset to prefill the form below, or ignore this and enter your own MCP endpoint manually.</div>
            <div id="recommendedServerBadges" class="badge-row" aria-live="polite"></div>
            <div class="preset-links">
              <a id="recommendedServerDocs" href="#" target="_blank" rel="noopener" hidden>View documentation</a>
              <a id="recommendedServerInstall" href="#" target="_blank" rel="noopener" hidden>Open install reference</a>
            </div>
          </div>

          <div id="addServerStatus" class="status-banner status-${initialStatusKind}" aria-live="polite">${initialStatusMessage}</div>
          <div id="addServerModeHint" class="muted">Create a new server entry or prefill this form from a recommended starter.</div>

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
          <input id="argsField" type="text" placeholder="-y @modelcontextprotocol/server-filesystem ." />
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

      <p class="muted">Tip: first-time stdio connections may pause while npm or npx fetches the MCP package and the server completes its handshake.</p>

      <div class="actions">
        <button type="submit" id="submitAddServer">Save &amp; Connect</button>
        <button type="button" id="cancelEditServer" class="btn-small" hidden>Cancel edit</button>
      </div>
          </form>
        </section>
      </section>
    </main>
  </div>
  `;
}

function buildRecommendedStarterOptions(selectedId?: string): string {
  return buildRecommendedPresetData().map(server => {
    const selected = server.id === selectedId ? ' selected' : '';
    return `<option value="${escapeHtml(server.id)}"${selected}>${escapeHtml(`${server.name} · ${server.provenanceLabel} · ${server.setupModeLabel}`)}</option>`;
  }).join('');
}

function getRecommendedProvenanceLabel(provenance: string): string {
  switch (provenance) {
    case 'official':
      return 'Official';
    case 'community':
      return 'Community';
    case 'archived':
      return 'Archived reference';
    default:
      return 'Registry fallback';
  }
}

function getRecommendedProvenanceHint(provenance: string): string {
  switch (provenance) {
    case 'official':
      return 'Verified first-party documentation and upstream reference.';
    case 'community':
      return 'Community-maintained integration; review upstream docs before enabling write-capable tools.';
    case 'archived':
      return 'Historical example that still resolves, but it is no longer actively maintained.';
    default:
      return 'AtlasMind could confirm the catalogue page but not a stable vendor-owned install guide.';
  }
}

function buildRecommendedPresetData(): Array<{
  id: string;
  name: string;
  description: string;
  docsUrl: string;
  installUrl: string;
  provenance: string;
  provenanceLabel: string;
  provenanceHint: string;
  setupMode: 'prefill' | 'manual';
  setupModeLabel: string;
  setupHint: string;
  transport: 'stdio' | 'http';
  command: string;
  args: string;
  url: string;
}> {
  return RECOMMENDED_MCP_SERVERS.map(server => {
    const starter = getRecommendedMcpStarterDetails(server.id);
    return {
      id: server.id,
      name: server.name,
      description: server.description,
      docsUrl: server.docsUrl,
      installUrl: server.installUrl,
      provenance: server.provenance,
      provenanceLabel: getRecommendedProvenanceLabel(server.provenance),
      provenanceHint: getRecommendedProvenanceHint(server.provenance),
      setupMode: starter.setupMode,
      setupModeLabel: starter.setupMode === 'prefill' ? 'AtlasMind-ready' : 'Manual setup',
      setupHint: starter.note,
      transport: starter.transport,
      command: starter.command || '',
      args: (starter.args || []).join(' '),
      url: starter.url || '',
    };
  });
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
        <button class="btn-small" data-action="edit" data-id="${escapeHtml(config.id)}" title="Edit parameters">Edit</button>
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
  .field-row input[type="url"],
  .field-row select {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, #555);
    padding: 6px 8px;
    border-radius: 10px;
    font-size: 0.9em;
    width: 100%;
    box-sizing: border-box;
  }
  .preset-shell { display: grid; gap: 8px; margin-bottom: 14px; }
  .badge-row { display: flex; flex-wrap: wrap; gap: 8px; min-height: 1.5rem; }
  .provenance-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border-radius: 999px;
    border: 1px solid var(--atlas-border);
    font-size: 0.78rem;
    color: var(--vscode-foreground);
    background: color-mix(in srgb, var(--atlas-accent) 10%, transparent);
  }
  .provenance-official { border-color: color-mix(in srgb, #4caf50 55%, var(--atlas-border)); }
  .provenance-community { border-color: color-mix(in srgb, #03a9f4 55%, var(--atlas-border)); }
  .provenance-registry { border-color: color-mix(in srgb, #ff9800 55%, var(--atlas-border)); }
  .provenance-archived { border-color: color-mix(in srgb, #9e9e9e 65%, var(--atlas-border)); }
  .preset-links { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 8px; }
  .preset-links a { color: var(--atlas-accent); }
  .status-banner {
    margin: 10px 0 14px;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid var(--atlas-border);
    background: color-mix(in srgb, var(--atlas-accent) 10%, transparent);
  }
  .status-info { border-color: color-mix(in srgb, var(--atlas-accent) 45%, var(--atlas-border)); }
  .status-success { border-color: color-mix(in srgb, #4caf50 55%, var(--atlas-border)); }
  .status-warning { border-color: color-mix(in srgb, #ff9800 55%, var(--atlas-border)); }
  .status-error { border-color: color-mix(in srgb, #f44336 55%, var(--atlas-border)); }
  .radio-group { display: flex; gap: 16px; }
  .actions { margin-top: 8px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
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

function serializeForInlineScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function buildMcpScript(target?: McpPanelTarget, servers: McpServerState[] = []): string {
  const recommendedServers = serializeForInlineScript(buildRecommendedPresetData());
  const existingServers = serializeForInlineScript(servers.map(server => ({
    id: server.config.id,
    name: server.config.name,
    transport: server.config.transport,
    command: server.config.command ?? '',
    args: (server.config.args ?? []).join(' '),
    env: server.config.env ? JSON.stringify(server.config.env) : '',
    url: server.config.url ?? '',
    enabled: server.config.enabled,
  })));
  const initialPage = JSON.stringify(target?.page ?? 'overview');
  const initialRecommendedServerId = JSON.stringify(target?.recommendedServerId ?? '');

  return `
(function() {
  const vscode = acquireVsCodeApi();
  const recommendedServers = ${recommendedServers};
  const existingServers = ${existingServers};
  const initialPage = ${initialPage};
  const initialRecommendedServerId = ${initialRecommendedServerId};
  const navButtons = Array.from(document.querySelectorAll('[data-page-target]'));
  const pages = Array.from(document.querySelectorAll('.panel-page'));
  const searchInput = document.getElementById('mcpSearch');
  const searchStatus = document.getElementById('mcpSearchStatus');
  const serverCards = Array.from(document.querySelectorAll('.server-card'));
  const presetSelect = document.getElementById('recommendedServerPreset');
  const presetSummary = document.getElementById('recommendedServerSummary');
  const presetBadges = document.getElementById('recommendedServerBadges');
  const presetDocs = document.getElementById('recommendedServerDocs');
  const presetInstall = document.getElementById('recommendedServerInstall');
  const submitButton = document.getElementById('submitAddServer');
  const enabledCheck = document.getElementById('enabledCheck');
  const modeHint = document.getElementById('addServerModeHint');
  const cancelEditButton = document.getElementById('cancelEditServer');
  let activeEditServerId = '';

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

  function setStatus(text, kind) {
    const banner = document.getElementById('addServerStatus');
    if (!(banner instanceof HTMLElement)) { return; }
    banner.textContent = text;
    banner.className = 'status-banner status-' + (typeof kind === 'string' && kind.length > 0 ? kind : 'info');
  }

  function setTransportMode(isStdio) {
    const stdioFields = document.getElementById('stdioFields');
    const httpFields = document.getElementById('httpFields');
    if (stdioFields instanceof HTMLElement) {
      stdioFields.style.display = isStdio ? '' : 'none';
    }
    if (httpFields instanceof HTMLElement) {
      httpFields.style.display = isStdio ? 'none' : '';
    }
  }

  function updateSubmitButton() {
    if (!(submitButton instanceof HTMLButtonElement) || !(enabledCheck instanceof HTMLInputElement)) { return; }

    const nameField = document.getElementById('serverName');
    const transportStdio = document.getElementById('transportStdio');
    const cmdField = document.getElementById('cmdField');
    const urlField = document.getElementById('urlField');
    const editing = activeEditServerId.length > 0;

    const hasName = nameField instanceof HTMLInputElement && nameField.value.trim().length > 0;
    const needsStdio = !(transportStdio instanceof HTMLInputElement) || transportStdio.checked;
    const hasTransportDetails = needsStdio
      ? cmdField instanceof HTMLInputElement && cmdField.value.trim().length > 0
      : urlField instanceof HTMLInputElement && urlField.value.trim().length > 0;

    if (!hasTransportDetails) {
      submitButton.textContent = editing ? 'Enter updated details' : 'Enter connection details';
      submitButton.disabled = true;
      return;
    }

    submitButton.textContent = enabledCheck.checked
      ? (editing ? 'Update & Reconnect' : 'Save & Connect')
      : (editing ? 'Update Server' : 'Save Server');
    submitButton.disabled = !hasName;
  }

  function exitEditMode() {
    activeEditServerId = '';
    if (modeHint instanceof HTMLElement) {
      modeHint.textContent = 'Create a new server entry or prefill this form from a recommended starter.';
    }
    if (cancelEditButton instanceof HTMLButtonElement) {
      cancelEditButton.hidden = true;
    }
    updateSubmitButton();
  }

  function enterEditMode(serverId) {
    const existing = existingServers.find(server => server.id === serverId);
    if (!existing) { return; }

    const nameField = document.getElementById('serverName');
    const cmdField = document.getElementById('cmdField');
    const argsField = document.getElementById('argsField');
    const envField = document.getElementById('envField');
    const urlField = document.getElementById('urlField');
    const transportStdio = document.getElementById('transportStdio');
    const transportHttp = document.getElementById('transportHttp');

    activeEditServerId = existing.id;
    if (presetSelect instanceof HTMLSelectElement) { presetSelect.value = ''; }
    if (nameField instanceof HTMLInputElement) { nameField.value = existing.name || ''; }
    if (cmdField instanceof HTMLInputElement) { cmdField.value = existing.command || ''; }
    if (argsField instanceof HTMLInputElement) { argsField.value = existing.args || ''; }
    if (envField instanceof HTMLInputElement) { envField.value = existing.env || ''; }
    if (urlField instanceof HTMLInputElement) { urlField.value = existing.url || ''; }
    if (enabledCheck instanceof HTMLInputElement) { enabledCheck.checked = Boolean(existing.enabled); }
    if (transportStdio instanceof HTMLInputElement) { transportStdio.checked = existing.transport === 'stdio'; }
    if (transportHttp instanceof HTMLInputElement) { transportHttp.checked = existing.transport === 'http'; }
    if (modeHint instanceof HTMLElement) {
      modeHint.textContent = 'Editing existing server parameters. Update the values below and save to apply the changes.';
    }
    if (cancelEditButton instanceof HTMLButtonElement) {
      cancelEditButton.hidden = false;
    }
    setTransportMode(existing.transport === 'stdio');
    setStatus('Editing this server. Update the parameters below, then save when you are ready.', 'info');
    activatePage('add');
    updateSubmitButton();
  }

  function renderPresetBadges(preset) {
    if (!(presetBadges instanceof HTMLElement)) { return; }
    presetBadges.innerHTML = '';
    if (!preset) { return; }

    const provenanceBadge = document.createElement('span');
    provenanceBadge.className = 'provenance-badge provenance-' + (preset.provenance || 'registry');
    provenanceBadge.textContent = preset.provenanceLabel || 'Registry fallback';
    provenanceBadge.title = preset.provenanceHint || '';
    presetBadges.appendChild(provenanceBadge);

    const setupBadge = document.createElement('span');
    setupBadge.className = 'provenance-badge provenance-' + (preset.setupMode === 'prefill' ? 'official' : 'archived');
    setupBadge.textContent = preset.setupModeLabel || 'Manual setup';
    setupBadge.title = preset.setupHint || '';
    presetBadges.appendChild(setupBadge);
  }

  function applyRecommendedPreset(serverId) {
    const preset = recommendedServers.find(server => server.id === serverId);
    if (!preset) {
      if (presetSummary instanceof HTMLElement) {
        presetSummary.textContent = 'Select a preset to prefill the form below, or ignore this and enter your own MCP endpoint manually.';
      }
      renderPresetBadges(null);
      if (presetDocs instanceof HTMLAnchorElement) { presetDocs.hidden = true; }
      if (presetInstall instanceof HTMLAnchorElement) { presetInstall.hidden = true; }
      return;
    }

    const nameField = document.getElementById('serverName');
    const cmdField = document.getElementById('cmdField');
    const argsField = document.getElementById('argsField');
    const urlField = document.getElementById('urlField');
    const transportStdio = document.getElementById('transportStdio');
    const transportHttp = document.getElementById('transportHttp');

    if (nameField instanceof HTMLInputElement) { nameField.value = preset.name; }
    if (cmdField instanceof HTMLInputElement) { cmdField.value = preset.command || ''; }
    if (argsField instanceof HTMLInputElement) { argsField.value = preset.args || ''; }
    if (urlField instanceof HTMLInputElement) { urlField.value = preset.url || ''; }
    if (transportStdio instanceof HTMLInputElement) { transportStdio.checked = preset.transport === 'stdio'; }
    if (transportHttp instanceof HTMLInputElement) { transportHttp.checked = preset.transport === 'http'; }
    setTransportMode(preset.transport === 'stdio');

    renderPresetBadges(preset);

    if (presetSummary instanceof HTMLElement) {
      const setupHint = preset.setupHint || (
        preset.command || preset.url
          ? 'Review the prefilled connection details, then adjust them if your environment needs different arguments or authentication.'
          : 'This preset points you to verified docs, but AtlasMind could not safely infer a universal one-click command. Review the linked setup guide and enter the exact endpoint details manually.'
      );
      presetSummary.textContent = preset.description + ' ' + preset.provenanceHint + ' ' + setupHint;
    }
    if (presetDocs instanceof HTMLAnchorElement) {
      presetDocs.href = preset.docsUrl;
      presetDocs.hidden = !preset.docsUrl;
    }
    if (presetInstall instanceof HTMLAnchorElement) {
      presetInstall.href = preset.installUrl;
      presetInstall.hidden = !preset.installUrl;
    }

    const needsManualSetup = !preset.command && !preset.url;
    setStatus(
      needsManualSetup
        ? 'This preset links verified documentation, but it still needs the real command or remote URL for your environment before AtlasMind can connect.'
        : 'Preset applied. Review the endpoint details, then save. First-time installs can still take a minute or two.',
      needsManualSetup ? 'warning' : 'info',
    );
    updateSubmitButton();
    activatePage('add');
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
    if (!(button instanceof HTMLButtonElement)) { return; }
    button.addEventListener('click', () => activatePage(button.getAttribute('data-nav-target') || 'overview'));
  });

  activatePage(initialPage);
  if (searchInput instanceof HTMLInputElement) {
    updateSearch(searchInput.value);
    searchInput.addEventListener('input', () => updateSearch(searchInput.value));
  }

  document.querySelectorAll('input[name="transport"]').forEach(radio => {
    if (!(radio instanceof HTMLInputElement)) { return; }
    radio.addEventListener('change', () => {
      setTransportMode(Boolean((document.getElementById('transportStdio') || {}).checked));
      updateSubmitButton();
    });
  });

  if (enabledCheck instanceof HTMLInputElement) {
    enabledCheck.addEventListener('change', () => updateSubmitButton());
  }

  ['serverName', 'cmdField', 'urlField'].forEach(id => {
    const field = document.getElementById(id);
    if (field instanceof HTMLInputElement) {
      field.addEventListener('input', () => updateSubmitButton());
    }
  });

  if (presetSelect instanceof HTMLSelectElement) {
    presetSelect.addEventListener('change', () => applyRecommendedPreset(presetSelect.value));
  }

  document.getElementById('add-form')?.addEventListener('submit', e => {
    e.preventDefault();
    const nameField = document.getElementById('serverName');
    const transportStdio = document.getElementById('transportStdio');
    const cmdField = document.getElementById('cmdField');
    const argsField = document.getElementById('argsField');
    const envField = document.getElementById('envField');
    const urlField = document.getElementById('urlField');

    if (!(nameField instanceof HTMLInputElement) || !(transportStdio instanceof HTMLInputElement)) { return; }
    const name = nameField.value.trim();
    if (!name) { return; }
    const isStdio = transportStdio.checked;
    const payload = {
      editServerId: activeEditServerId || undefined,
      name,
      transport: isStdio ? 'stdio' : 'http',
      command: cmdField instanceof HTMLInputElement ? (cmdField.value.trim() || undefined) : undefined,
      args: argsField instanceof HTMLInputElement ? (argsField.value.trim() || undefined) : undefined,
      env: envField instanceof HTMLInputElement ? (envField.value.trim() || undefined) : undefined,
      url: urlField instanceof HTMLInputElement ? (urlField.value.trim() || undefined) : undefined,
      enabled: enabledCheck instanceof HTMLInputElement ? enabledCheck.checked : true,
    };

    if (submitButton instanceof HTMLButtonElement) {
      submitButton.disabled = true;
      submitButton.textContent = payload.editServerId
        ? (payload.enabled ? 'Updating...' : 'Saving update...')
        : (payload.enabled ? 'Connecting...' : 'Saving...');
    }
    setStatus(
      payload.enabled
        ? 'Saving configuration and starting the MCP handshake. AtlasMind may wait while the server package installs or performs its first startup.'
        : 'Saving server configuration...',
      'info',
    );
    vscode.postMessage({ type: 'addServer', payload });
  });

  document.addEventListener('click', e => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) { return; }
    const btn = target.closest('[data-action]');
    if (!(btn instanceof HTMLElement)) { return; }
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (action === 'edit') {
      enterEditMode(id || '');
    } else if (action === 'reconnect') {
      vscode.postMessage({ type: 'reconnect', payload: { id } });
    } else if (action === 'remove') {
      vscode.postMessage({ type: 'removeServer', payload: { id } });
    }
  });

  document.addEventListener('change', e => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) { return; }
    if (target.dataset && target.dataset.action === 'toggle') {
      vscode.postMessage({ type: 'toggleEnabled', payload: { id: target.dataset.id, enabled: target.checked } });
    }
  });

  cancelEditButton?.addEventListener('click', () => {
    exitEditMode();
    setStatus('Edit mode cancelled. You can create a new server or choose another preset.', 'info');
  });

  document.getElementById('open-settings-safety')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openSettingsSafety' });
  });

  document.getElementById('import-vscode-mcp')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'importVsCodeConfig' });
  });

  document.getElementById('open-agent-panel')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openAgentPanel' });
  });

  window.addEventListener('message', event => {
    const message = event.data;
    if (!message || typeof message !== 'object') { return; }
    if (message.type === 'status') {
      const payload = message.payload;
      if (payload && typeof payload === 'object') {
        const text = typeof payload.text === 'string' ? payload.text : '';
        const kind = typeof payload.kind === 'string' ? payload.kind : 'info';
        setStatus(text, kind);
        return;
      }
      if (typeof payload === 'string') {
        setStatus(payload, 'info');
      }
      return;
    }

    if (message.type === 'addServerComplete') {
      exitEditMode();
      updateSubmitButton();
      if (message.payload && typeof message.payload === 'object' && typeof message.payload.page === 'string') {
        activatePage(message.payload.page);
      }
    }
  });

  setTransportMode(Boolean((document.getElementById('transportStdio') || {}).checked));
  updateSubmitButton();
  if (initialRecommendedServerId && presetSelect instanceof HTMLSelectElement) {
    presetSelect.value = initialRecommendedServerId;
    applyRecommendedPreset(initialRecommendedServerId);
  }
})();
`;
}

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
      if (payload['editServerId'] !== undefined && typeof payload['editServerId'] !== 'string') { return null; }
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
    case 'importVsCodeConfig':
      return { type: 'importVsCodeConfig' };
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
    return { name, transport: 'stdio', command, args, env, url: undefined, enabled: p.enabled };
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
  return { name, transport: 'http', command: undefined, args: undefined, env: undefined, url, enabled: p.enabled };
}
