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
import type { RecommendedMcpStarterDetails } from '../constants.js';
import { checkStarterRuntime, runRuntimeInstallPlan } from '../mcp/mcpRuntime.js';
import { McpEnvironmentScanner, resolveImportedServer } from '../mcp/mcpEnvironmentScanner.js';
import { getWebviewHtmlShell, escapeHtml } from './webviewUtils.js';
import { PANEL_NAV_JS } from './panelNav.js';
import type { McpServerRegistry, DetectedMcpServer } from '../mcp/mcpServerRegistry.js';
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
  | { type: 'openAgentPanel' }
  | { type: 'openResourceDiscovery' }
  // Guided setup wizard
  | { type: 'scanEnvironment' }
  | { type: 'connectDetected'; payload: { index: number } }
  | { type: 'checkPrerequisites'; payload: { serverId: string } }
  | { type: 'installPrerequisite'; payload: { serverId: string } }
  | { type: 'wizardConnect'; payload: WizardConnectPayload }
  // Environment scan (config import + PATH/env discovery)
  | { type: 'rescanMcpEnvironment' }
  | { type: 'importDetectedServer'; payload: { sourcePath: string; name: string; connect: boolean } }
  | { type: 'askAtlasConfigureMcp'; payload: { name: string } };

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

interface WizardConnectPayload {
  serverId: string;
  /** Collected input values keyed by input.key. May contain secret values. */
  inputs: Record<string, string>;
}

interface McpPanelTarget {
  page?: 'overview' | 'servers' | 'add' | 'advanced';
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
  /** Cache of the most recent environment scan, referenced by index from the webview. */
  private lastDetected: DetectedMcpServer[] = [];
  /** Discovers imported MCP configs + PATH/env signals; cached in SSOT. */
  private readonly envScanner: McpEnvironmentScanner;

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
    this.envScanner = new McpEnvironmentScanner(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
    this.panel.webview.html = this.buildHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => { void this.handleMessage(message); },
      null,
      this.disposables,
    );

    // Run a first scan if none is cached yet, then re-render with the results.
    if (!this.envScanner.getCached()) {
      void this.envScanner.scan().then(() => { this.panel.webview.html = this.buildHtml(); }).catch(() => { /* best-effort */ });
    }

    // Auto-refresh the scan when a workspace MCP config file changes (home-dir
    // configs are picked up on the next explicit Rescan).
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceRoot, '{.vscode/mcp.json,.cursor/mcp.json,.mcp.json,mcp.json}'),
      );
      const reScan = () => { void this.envScanner.scan().then(() => { this.panel.webview.html = this.buildHtml(); }).catch(() => { /* best-effort */ }); };
      watcher.onDidChange(reScan);
      watcher.onDidCreate(reScan);
      watcher.onDidDelete(reScan);
      this.disposables.push(watcher);
    }
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
      case 'openResourceDiscovery':
        await vscode.commands.executeCommand('atlasmind.openResourceDiscovery');
        return;
      case 'scanEnvironment':
        await this.handleScanEnvironment();
        return;
      case 'connectDetected':
        await this.handleConnectDetected(message.payload.index);
        return;
      case 'checkPrerequisites':
        await this.handleCheckPrerequisites(message.payload.serverId);
        return;
      case 'installPrerequisite':
        await this.handleInstallPrerequisite(message.payload.serverId);
        return;
      case 'wizardConnect':
        await this.handleWizardConnect(message.payload);
        return;
      case 'rescanMcpEnvironment':
        await this.handleRescanEnvironment();
        return;
      case 'importDetectedServer':
        await this.handleImportDetectedServer(message.payload);
        return;
      case 'askAtlasConfigureMcp':
        await this.handleAskAtlasConfigureMcp(message.payload.name);
        return;
    }

    this.panel.webview.html = this.buildHtml();
  }

  // ── Environment scan handlers ────────────────────────────────

  private async handleRescanEnvironment(): Promise<void> {
    await this.panel.webview.postMessage({ type: 'status', payload: { kind: 'info', text: 'Rescanning your machine and workspace for MCP setups…' } });
    await this.envScanner.scan();
    this.panel.webview.html = this.buildHtml();
  }

  private async handleImportDetectedServer(payload: { sourcePath: string; name: string; connect: boolean }): Promise<void> {
    const resolved = resolveImportedServer(payload.sourcePath, payload.name);
    if (!resolved) {
      this.currentTarget = { page: 'advanced', statusKind: 'error', statusMessage: `AtlasMind could not read "${payload.name}" from ${payload.sourcePath}.` };
      this.panel.webview.html = this.buildHtml();
      return;
    }
    const config: Omit<McpServerConfig, 'id'> = { ...resolved.config, enabled: payload.connect };
    const id = this.registry.addServer(config);
    if (Object.keys(resolved.secrets).length > 0) {
      // Secret values re-read live from the source file → SecretStorage only.
      await this.registry.setServerSecrets(id, resolved.secrets);
    }
    if (payload.connect) {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `AtlasMind: connecting ${config.name}`, cancellable: false },
        async () => { await this.registry.connectServer(id); },
      );
    }
    const state = this.registry.listServers().find(server => server.config.id === id);
    const connected = state?.status === 'connected';
    this.currentTarget = {
      page: connected || !payload.connect ? 'servers' : 'advanced',
      statusKind: connected ? 'success' : payload.connect ? 'warning' : 'success',
      statusMessage: payload.connect
        ? (connected
          ? `Imported ${config.name} from your existing config and connected (${state?.tools.length ?? 0} tool${state?.tools.length === 1 ? '' : 's'}).`
          : `Imported ${config.name}, but the connection did not complete yet.${state?.error ? ` Last error: ${state.error}` : ''}`)
        : `Imported ${config.name} from your existing config (not connected yet).`,
    };
    this.onRefresh();
    this.panel.webview.html = this.buildHtml();
  }

  private async handleAskAtlasConfigureMcp(name: string): Promise<void> {
    const clean = name.trim().slice(0, 120) || 'this MCP server';
    const prompt = [
      `Help me set up the "${clean}" MCP server in AtlasMind's Advanced "Add MCP server" form.`,
      'Tell me, specifically and safely:',
      '1. The exact transport (stdio or HTTP), command, and arguments to use — prefer an official/reputable package.',
      '2. Which credentials I need, where to create them (link the exact console page), and the least-privilege scopes.',
      '3. Which values are secret (so I store them in SecretStorage) vs. plain env vars.',
      'Flag any supply-chain risk and cite the source docs. Keep it to what I can paste into the form.',
    ].join('\n');
    await vscode.commands.executeCommand('atlasmind.openChatPanel', { draftPrompt: prompt, sendMode: 'new-session' });
  }

  // ── Guided setup wizard handlers ─────────────────────────────

  private async handleScanEnvironment(): Promise<void> {
    this.lastDetected = await this.registry.detectAvailableServers();
    const results = this.lastDetected.map((entry, index) => ({
      index,
      name: entry.config.name,
      reason: entry.reason,
      detail: entry.config.transport === 'stdio'
        ? `${entry.config.command ?? ''} ${(entry.config.args ?? []).join(' ')}`.trim()
        : (entry.config.url ?? ''),
    }));
    await this.panel.webview.postMessage({ type: 'scanResults', payload: { results } });
  }

  private async handleConnectDetected(index: number): Promise<void> {
    const entry = this.lastDetected[index];
    if (!entry) { return; }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `AtlasMind: connecting ${entry.config.name}`, cancellable: false },
      async () => { await this.registry.importServers([{ ...entry.config, enabled: true }]); },
    );
    const state = this.registry.listServers().find(server => server.config.name === entry.config.name);
    const connected = state?.status === 'connected';
    this.currentTarget = {
      page: connected ? 'servers' : 'add',
      statusKind: connected ? 'success' : 'warning',
      statusMessage: connected
        ? `${entry.config.name} connected and exposed ${state?.tools.length ?? 0} tool${state?.tools.length === 1 ? '' : 's'}.`
        : `${entry.config.name} was saved, but the connection did not complete yet.${state?.error ? ` Last error: ${state.error}` : ''}`,
    };
    this.onRefresh();
    this.panel.webview.html = this.buildHtml();
  }

  private async handleCheckPrerequisites(serverId: string): Promise<void> {
    const starter = getRecommendedMcpStarterDetails(serverId);
    const runtimeCommand = starter.transport === 'stdio' ? starter.command : undefined;
    const check = checkStarterRuntime(serverId, runtimeCommand);
    await this.panel.webview.postMessage({
      type: 'prerequisiteStatus',
      payload: check.status === 'installable'
        ? { serverId, status: 'installable', displayName: check.plan.displayName, humanCommand: check.plan.humanCommand }
        : check.status === 'manual'
          ? { serverId, status: 'manual', message: check.message }
          : { serverId, status: 'ready' },
    });
  }

  private async handleInstallPrerequisite(serverId: string): Promise<void> {
    const starter = getRecommendedMcpStarterDetails(serverId);
    const runtimeCommand = starter.transport === 'stdio' ? starter.command : undefined;
    const check = checkStarterRuntime(serverId, runtimeCommand);
    if (check.status !== 'installable') {
      await this.handleCheckPrerequisites(serverId);
      return;
    }

    // Confirm before installing anything (confirm-before-install policy).
    const installLabel = `Install ${check.plan.displayName}`;
    const choice = await vscode.window.showInformationMessage(
      `Install ${check.plan.displayName}?`,
      { modal: true, detail: `AtlasMind will run:\n\n${check.plan.humanCommand}\n\nNothing is installed until you choose "${installLabel}".` },
      installLabel,
    );
    if (choice !== installLabel) {
      await this.panel.webview.postMessage({
        type: 'prerequisiteStatus',
        payload: { serverId, status: 'installable', displayName: check.plan.displayName, humanCommand: check.plan.humanCommand, declined: true },
      });
      return;
    }

    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `AtlasMind: installing ${check.plan.displayName}`, cancellable: false },
      async progress => runRuntimeInstallPlan(check.runtimeCommand, check.plan, message => progress.report({ message })),
    );
    if (!result.ok) {
      await this.panel.webview.postMessage({ type: 'prerequisiteStatus', payload: { serverId, status: 'manual', message: result.message } });
      return;
    }
    // Re-check: should now resolve to ready.
    await this.handleCheckPrerequisites(serverId);
  }

  private async handleWizardConnect(payload: WizardConnectPayload): Promise<void> {
    const server = RECOMMENDED_MCP_SERVERS.find(entry => entry.id === payload.serverId);
    if (!server) { return; }
    const starter = getRecommendedMcpStarterDetails(payload.serverId);
    const inputs = payload.inputs ?? {};

    // Diagnose the two distinct failure modes separately instead of always
    // blaming "required fields" — the previous message dead-ended manual-setup
    // starters that show no fields at all.
    const missingRequired = (starter.inputs ?? [])
      .filter(input => input.required && !(inputs[input.key] ?? '').trim())
      .map(input => input.label);
    const hasEndpoint = starter.transport === 'http' ? Boolean(starter.url) : Boolean(starter.command);

    // (a) Nothing to fill AND nothing AtlasMind can auto-fill → genuine manual setup.
    if (!hasEndpoint && missingRequired.length === 0) {
      await this.panel.webview.postMessage({
        type: 'wizardStatus',
        payload: {
          kind: 'error',
          text: `AtlasMind can’t auto-configure ${server.name} — it needs a command or endpoint URL that you supply. Open Advanced setup to enter the connection details manually.`,
        },
      });
      return;
    }

    // (b) The user left one or more required fields blank → name them.
    if (missingRequired.length > 0) {
      const fieldList = missingRequired.map(label => `“${label}”`).join(', ');
      await this.panel.webview.postMessage({
        type: 'wizardStatus',
        payload: {
          kind: 'error',
          text: `Please fill in the required field${missingRequired.length === 1 ? '' : 's'} ${fieldList} before connecting.`,
        },
      });
      return;
    }

    const built = buildWizardServerConfig(server.name, starter, inputs);
    if (!built) {
      await this.panel.webview.postMessage({
        type: 'wizardStatus',
        payload: {
          kind: 'error',
          text: `AtlasMind couldn’t build a valid configuration for ${server.name}. Open Advanced setup to enter the connection details manually.`,
        },
      });
      return;
    }

    const id = this.registry.addServer(built.config);
    // Store secrets BEFORE connecting so they resolve into the process env.
    if (Object.keys(built.secrets).length > 0) {
      await this.registry.setServerSecrets(id, built.secrets);
    }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `AtlasMind: connecting ${server.name}`, cancellable: false },
      async progress => {
        progress.report({ message: 'Starting the MCP server and completing its first handshake…' });
        await this.registry.connectServer(id);
      },
    );

    const state = this.registry.listServers().find(entry => entry.config.id === id);
    const connected = state?.status === 'connected';
    this.currentTarget = {
      page: connected ? 'servers' : 'add',
      statusKind: connected ? 'success' : 'warning',
      statusMessage: connected
        ? `${server.name} connected and exposed ${state?.tools.length ?? 0} tool${state?.tools.length === 1 ? '' : 's'}.`
        : `${server.name} was saved, but the connection did not complete yet.${state?.error ? ` Last error: ${state.error}` : ''}`,
    };
    if (connected) {
      void vscode.window.showInformationMessage(`${server.name} connected successfully.`);
    }
    this.onRefresh();
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
      scriptContent: buildMcpScript(this.currentTarget, servers, this.envScanner.getCached()),
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
      <button type="button" class="hero-badge hero-badge-button" data-hero-page-target="servers" data-search-query="status:connected" title="Filter the server list to connected MCP servers.">${connectedCount} connected</button>
      <button type="button" class="hero-badge hero-badge-button" data-hero-page-target="servers" data-search-query="state:enabled" title="Filter the server list to enabled MCP servers.">${enabledCount} enabled</button>
    </div>
  </div>

  <div class="search-shell">
    <label class="search-label" for="mcpSearch">Search MCP servers</label>
    <input id="mcpSearch" type="search" placeholder="Search by server name, transport, or status" />
    <p id="mcpSearchStatus" class="search-status" aria-live="polite">Browse by page or search configured servers.</p>
  </div>

  <div class="panel-layout">
    <nav class="panel-nav" aria-label="MCP server sections" role="tablist" aria-orientation="vertical">
      <button type="button" class="nav-link active" data-page-target="servers" data-search="servers configured connected disconnected tools stdio http">Configured Servers</button>
      <button type="button" class="nav-link" data-page-target="add" data-search="add server guided setup wizard scan computer browse category connect credentials">Guided Setup</button>
      <button type="button" class="nav-link" data-page-target="advanced" data-search="advanced manual stdio http env args url command custom endpoint">Advanced</button>
      <button type="button" class="nav-link" data-page-target="overview" data-search="overview safety settings agents server skills what is mcp">About MCP</button>
    </nav>

    <main class="panel-main">
      <section id="page-overview" class="panel-page active">
        <div class="page-header">
          <p class="page-kicker">Overview</p>
          <h2>MCP workspace</h2>
          <p>Quickly add a server, jump to safety settings for external tool policy, or open the agent workspace that consumes MCP-exposed skills.</p>
        </div>
        <div class="explainer-card">
          <h3>New to MCP?</h3>
          <p>An <strong>MCP server</strong> is a small helper program that gives AtlasMind extra tools — reading files, running Git, querying a database, posting to Slack, and more. When a server connects, its tools become AtlasMind skills your agents can use.</p>
          <p class="muted">Start with <strong>Guided Setup</strong>: AtlasMind detects what it can, asks only for what it needs, and connects for you. Nothing runs on your machine or installs without your confirmation, and any credentials you enter are stored in the OS secret store.</p>
        </div>
        <div class="action-grid">
          <button type="button" class="action-card action-primary" data-nav-target="add">
            <span class="action-title">Guided Setup</span>
            <span class="action-copy">Scan your computer or browse a curated catalogue. AtlasMind checks prerequisites and collects any credentials for you.</span>
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
          <button type="button" id="open-resource-discovery" class="action-card">
            <span class="action-title">Discover Servers via ARD</span>
            <span class="action-copy">Search Agentic Resource Discovery finders for MCP servers and other resources to install.</span>
          </button>
        </div>
        ${/* The summary grid that stood here restated the three hero badges
              verbatim — the same three numbers twice on one screen, clickable
              in the hero and inert here. The hero badges are the live version,
              so this page keeps only what is unique to it: what MCP is and how
              to get started. */ ''}
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
          <p class="page-kicker">Guided Setup</p>
          <h2>Add an MCP server</h2>
          <p>AtlasMind detects what it can, asks only for what it needs, and connects for you. Prerequisites are never installed without your confirmation.</p>
        </div>

        <div id="wizardStatus" class="status-banner status-${initialStatusKind}" aria-live="polite">${initialStatusMessage}</div>

        <!-- Step: choose a path -->
        <section id="wiz-choose" class="wizard-step content-card">
          <div class="action-grid">
            <button type="button" class="action-card action-primary" id="wiz-scan-btn">
              <span class="action-title">Scan my computer</span>
              <span class="action-copy">Find servers AtlasMind can set up from tools you already have installed.</span>
            </button>
            <button type="button" class="action-card" id="wiz-browse-btn">
              <span class="action-title">Browse by category</span>
              <span class="action-copy">Pick from a curated catalogue grouped by what each server does.</span>
            </button>
          </div>
          <p class="muted">Prefer to type the command yourself? <button type="button" class="link-button" id="wiz-advanced-link">Enter details manually (Advanced)</button>.</p>
        </section>

        <!-- Step: scan results -->
        <section id="wiz-scan" class="wizard-step content-card" hidden>
          <button type="button" class="btn-small" data-wiz-back>&larr; Back</button>
          <h3>Detected on your computer</h3>
          <div id="wiz-scan-list"><p class="muted">Scanning your environment…</p></div>
        </section>

        <!-- Step: browse catalogue -->
        <section id="wiz-browse" class="wizard-step content-card" hidden>
          <button type="button" class="btn-small" data-wiz-back>&larr; Back</button>
          <h3>Browse recommended servers</h3>
          <div id="wiz-browse-list"></div>
        </section>

        <!-- Step: configure the selected server -->
        <section id="wiz-configure" class="wizard-step content-card" hidden>
          <button type="button" class="btn-small" data-wiz-back>&larr; Back</button>
          <h3 id="wiz-config-name"></h3>
          <p id="wiz-config-desc" class="muted"></p>
          <div id="wiz-config-badges" class="badge-row" aria-live="polite"></div>
          <div id="wiz-safety" class="wiz-safety" hidden></div>
          <div id="wiz-guided"></div>
          <div id="wiz-prereq" class="status-banner status-info" aria-live="polite">Checking prerequisites…</div>
          <div id="wiz-prereq-actions" class="actions"></div>
          <form id="wiz-config-form">
            <div id="wiz-inputs"></div>
            <div class="preset-links">
              <a id="wiz-config-docs" href="#" target="_blank" rel="noopener" hidden>View documentation</a>
            </div>
            <div class="actions">
              <button type="submit" id="wiz-connect-btn">Connect</button>
              <button type="button" id="wiz-advanced-btn" class="btn-small" hidden>Open Advanced setup</button>
            </div>
          </form>
        </section>
      </section>

      <section id="page-advanced" class="panel-page" hidden>
        <div class="page-header">
          <p class="page-kicker">Advanced</p>
          <h2>Enter MCP endpoint details manually</h2>
          <p>Pick a recommended starter or type your own endpoint. Use this when you need full control over the command, arguments, or environment.</p>
        </div>
        <section class="content-card">
          <div id="mcp-scan" class="mcp-scan"></div>
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
          <p class="field-help muted">The program that launches the server: <code>npx</code> (Node), <code>uvx</code> (Python/uv), <code>docker</code>, or a full path. AtlasMind finds it on your PATH.</p>
        </div>
        <div class="field-row">
          <label for="argsField">Args (space-separated)</label>
          <input id="argsField" type="text" placeholder="-y @modelcontextprotocol/server-filesystem ." />
          <p class="field-help muted">Arguments passed to the command. <code>\${workspaceFolder}</code> and <code>\${userHome}</code> are expanded; other <code>\${VARS}</code> pass through for the server to expand. Example: <code>-y @modelcontextprotocol/server-filesystem \${workspaceFolder}</code></p>
        </div>
        <div class="field-row">
          <label for="envField">Env vars (JSON)</label>
          <input id="envField" type="text" placeholder='{"NODE_ENV":"production"}' />
          <p class="field-help muted">Environment variables as a JSON object, e.g. <code>{"GITHUB_PERSONAL_ACCESS_TOKEN":"github_pat_…"}</code>. Prefer the Guided Setup for credentials — it stores secrets in the OS secret store instead of your settings.</p>
        </div>
      </div>

      <div id="httpFields" style="display:none">
        <div class="field-row">
          <label for="urlField">URL</label>
          <input id="urlField" type="url" placeholder="http://localhost:3000/mcp" />
          <p class="field-help muted">The server's Streamable-HTTP / SSE endpoint. Must be <code>http://</code> or <code>https://</code>. A bare URL only — endpoints that need an Authorization header aren't supported here yet, so use a local stdio bridge for those.</p>
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

interface WizardInputMeta {
  key: string;
  label: string;
  help: string;
  kind: 'text' | 'secret' | 'folder' | 'url';
  target: 'env' | 'arg';
  defaultValue: string;
  example: string;
  required: boolean;
}

function buildRecommendedPresetData(): Array<{
  id: string;
  name: string;
  description: string;
  category: string;
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
  inputs: WizardInputMeta[];
  prerequisites: string[];
  credentialSteps: string[];
  credentialHelpUrl: string;
  safetyNote: string;
}> {
  return RECOMMENDED_MCP_SERVERS.map(server => {
    const starter = getRecommendedMcpStarterDetails(server.id);
    return {
      id: server.id,
      name: server.name,
      description: server.description,
      category: server.category,
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
      // Input *metadata* only — no secret values ever cross into the webview.
      inputs: (starter.inputs ?? []).map(input => ({
        key: input.key,
        label: input.label,
        help: input.help ?? '',
        kind: input.kind,
        target: input.target,
        defaultValue: input.defaultValue ?? '',
        example: input.example ?? '',
        required: Boolean(input.required),
      })),
      // Novice handholding content for the guided-setup wizard.
      prerequisites: starter.prerequisites ?? [],
      credentialSteps: starter.credentialSteps ?? [],
      credentialHelpUrl: starter.credentialHelpUrl ?? '',
      safetyNote: starter.safetyNote ?? '',
    };
  });
}

/**
 * Build a connect-ready server config from a recommended starter and the values
 * the wizard collected. Secret-kind inputs are split out into `secrets` (for
 * SecretStorage) and recorded as `secretEnvKeys` on the config; other inputs
 * fill env vars or substitute arg placeholders. Returns null if a required
 * input is missing.
 */
export function buildWizardServerConfig(
  serverName: string,
  starter: RecommendedMcpStarterDetails,
  inputValues: Record<string, string>,
): { config: Omit<McpServerConfig, 'id'>; secrets: Record<string, string> } | null {
  let args = [...(starter.args ?? [])];
  const env: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  const secretEnvKeys: string[] = [];

  for (const input of starter.inputs ?? []) {
    const raw = inputValues[input.key];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) {
      if (input.required) { return null; }
      continue; // optional + empty → keep the starter default (e.g. ${workspaceFolder})
    }
    if (input.target === 'arg' && input.placeholder) {
      args = args.map(arg => (arg === input.placeholder ? value : arg));
    } else if (input.target === 'env') {
      if (input.kind === 'secret') {
        secrets[input.key] = value;
        secretEnvKeys.push(input.key);
      } else {
        env[input.key] = value;
      }
    }
  }

  if (starter.transport === 'http') {
    if (!starter.url) { return null; }
    return {
      config: { name: serverName, transport: 'http', url: starter.url, enabled: true },
      secrets,
    };
  }

  if (!starter.command) { return null; }
  return {
    config: {
      name: serverName,
      transport: 'stdio',
      command: starter.command,
      args,
      env: Object.keys(env).length > 0 ? env : undefined,
      secretEnvKeys: secretEnvKeys.length > 0 ? secretEnvKeys : undefined,
      enabled: true,
    },
    secrets,
  };
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
  ${/* The hero badges filter by stuffing a term into this haystack, and both
        were broken: "connected" is a substring of "disconnected", so that
        filter matched the servers it was meant to exclude, and "enabled" was
        never in the haystack at all so it matched nothing. Prefixed tokens
        cannot collide as substrings. */ ''}
  <div class="server-card" data-server-search="${escapeHtml([config.name, status, `status:${status}`, `state:${config.enabled ? 'enabled' : 'disabled'}`, config.transport, toolSummary, config.url ?? config.command ?? ''].join(' ').toLowerCase())}">
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
  /* Guided-setup handholding: "what you'll need" + credential how-to. */
  .wiz-safety {
    margin: 8px 0 12px; padding: 8px 12px; border-radius: 6px; font-size: 0.9em;
    color: var(--vscode-inputValidation-warningForeground, inherit);
    background: color-mix(in srgb, #ff9800 14%, transparent);
    border: 1px solid color-mix(in srgb, #ff9800 55%, var(--atlas-border));
  }
  .wiz-guided-card {
    margin: 0 0 12px; padding: 10px 14px; border-radius: 8px;
    background: color-mix(in srgb, var(--atlas-accent) 6%, transparent);
    border: 1px solid var(--atlas-border);
  }
  .wiz-guided-title { margin: 0 0 6px; font-weight: 600; font-size: 0.92em; }
  .wiz-guided-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 3px; font-size: 0.9em; }
  .wiz-guided-steps { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 5px; font-size: 0.9em; }
  .wiz-guided-steps li { padding-left: 2px; }
  .wiz-guided-links { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 10px; }
  .wiz-guided-link {
    color: var(--atlas-accent); font-size: 0.9em; text-decoration: none; font-weight: 500;
  }
  .wiz-guided-link.primary {
    padding: 4px 10px; border-radius: 6px; background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
  }
  .wiz-guided-link.primary:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
  /* Environment scan (import from other tools + PATH/env hints). */
  .mcp-scan { margin-bottom: 16px; padding: 12px 14px; border-radius: 8px; border: 1px solid var(--atlas-border); background: color-mix(in srgb, var(--atlas-accent) 5%, transparent); }
  .mcp-scan-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
  .mcp-scan-when { font-size: 0.82em; }
  .mcp-scan-sub { font-size: 0.9em; margin: 8px 0 6px; }
  .mcp-scan-card { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 8px 10px; margin: 6px 0; border-radius: 6px; border: 1px solid var(--atlas-border); background: var(--vscode-editor-background, transparent); }
  .mcp-scan-detail { margin-top: 2px; }
  .mcp-scan-detail code { font-size: 0.82em; word-break: break-all; }
  .mcp-scan-env { font-size: 0.8em; margin-top: 2px; }
  .mcp-scan-actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .mcp-scan-launchers { font-size: 0.82em; margin: 8px 0 4px; }
  .mcp-scan-envhints { font-size: 0.82em; margin: 6px 0; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .mcp-env-chip { font-size: 0.82em; padding: 1px 8px; border-radius: 999px; cursor: pointer; border: 1px solid var(--atlas-border); background: color-mix(in srgb, var(--atlas-accent) 10%, transparent); color: inherit; font-family: var(--vscode-editor-font-family, monospace); }
  .mcp-env-chip:hover { background: color-mix(in srgb, var(--atlas-accent) 20%, transparent); }
  .mcp-scan-ask { margin: 8px 0 0; }
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
  .explainer-card { border: 1px solid color-mix(in srgb, var(--atlas-accent) 40%, var(--atlas-border)); border-radius: 16px; padding: 16px 18px; margin-bottom: 16px; background: color-mix(in srgb, var(--atlas-accent) 8%, var(--vscode-editor-background)); }
  .explainer-card h3 { margin: 0 0 6px; }
  .explainer-card p { margin: 0 0 8px; }
  .explainer-card p:last-child { margin-bottom: 0; }
  .link-button { background: none; border: none; color: var(--atlas-accent); cursor: pointer; padding: 0; font: inherit; text-decoration: underline; }
  .link-button:focus-visible { outline: 2px solid var(--atlas-accent); outline-offset: 2px; }
  .wizard-step { margin-bottom: 12px; }
  .wizard-step > .btn-small[data-wiz-back] { margin-bottom: 10px; }
  .wiz-category { margin-bottom: 16px; }
  .wiz-category h4 { margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.78rem; color: var(--atlas-muted); }
  .wiz-server-grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
  .wiz-server-card { display: flex; flex-direction: column; gap: 4px; text-align: left; border: 1px solid var(--atlas-border); border-radius: 12px; padding: 12px; background: var(--vscode-editor-background); color: var(--vscode-foreground); cursor: pointer; }
  .wiz-server-card:hover, .wiz-server-card:focus-visible { outline: 2px solid var(--atlas-accent); outline-offset: 2px; }
  .wiz-server-name { font-weight: 700; }
  .wiz-server-desc { font-size: 0.85em; color: var(--atlas-muted); }
  .wiz-detected-card { display: flex; align-items: center; gap: 12px; justify-content: space-between; flex-wrap: wrap; border: 1px solid var(--atlas-border); border-radius: 12px; padding: 12px; margin-bottom: 8px; }
  .wiz-detected-detail { margin-top: 4px; font-size: 0.82em; color: var(--atlas-muted); }
  .wiz-install-cmd { display: inline-block; margin-left: 8px; padding: 2px 6px; background: var(--atlas-surface-strong); border-radius: 6px; }
  .field-help { margin: 2px 0 0; font-size: 0.8em; }
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

function buildMcpScript(target?: McpPanelTarget, servers: McpServerState[] = [], scan?: import('../types.js').McpEnvironmentScan): string {
  const mcpEnvironmentScan = serializeForInlineScript(scan ?? null);
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
  const initialPage = JSON.stringify(target?.page ?? 'servers');
  const initialRecommendedServerId = JSON.stringify(target?.recommendedServerId ?? '');

  return `
(function() {
  ${PANEL_NAV_JS}

  const vscode = acquireVsCodeApi();
  const recommendedServers = ${recommendedServers};
  const existingServers = ${existingServers};
  const mcpEnvironmentScan = ${mcpEnvironmentScan};
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

  // Tab semantics, roving tabindex and arrow-key navigation come from the
  // shared controller; this panel's markup and styling are unchanged.
  const panelNav = createPanelNav({ tablist: '.panel-nav' });

  function activatePage(pageId) {
    panelNav.activate(pageId);
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
    activatePage('advanced');
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
    activatePage('advanced');
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

  document.getElementById('open-resource-discovery')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openResourceDiscovery' });
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
      return;
    }

    if (message.type === 'scanResults') {
      renderScanResults(message.payload && message.payload.results);
      return;
    }

    if (message.type === 'prerequisiteStatus') {
      applyPrerequisiteStatus(message.payload);
      return;
    }

    if (message.type === 'wizardStatus') {
      const payload = message.payload || {};
      setWizardStatus(typeof payload.text === 'string' ? payload.text : '', typeof payload.kind === 'string' ? payload.kind : 'info');
      const connectBtn = document.getElementById('wiz-connect-btn');
      if (connectBtn instanceof HTMLButtonElement) { connectBtn.disabled = false; connectBtn.textContent = 'Connect'; }
      return;
    }
  });

  // ── Guided setup wizard ──────────────────────────────────────
  const wizardSteps = Array.from(document.querySelectorAll('.wizard-step'));
  let wizardServerId = '';

  function showWizardStep(id) {
    wizardSteps.forEach(step => {
      if (step instanceof HTMLElement) { step.hidden = step.id !== id; }
    });
  }

  function setWizardStatus(text, kind) {
    const banner = document.getElementById('wizardStatus');
    if (!(banner instanceof HTMLElement)) { return; }
    banner.textContent = text;
    banner.className = 'status-banner status-' + (typeof kind === 'string' && kind.length > 0 ? kind : 'info');
  }

  function renderBrowseCategories() {
    const container = document.getElementById('wiz-browse-list');
    if (!(container instanceof HTMLElement)) { return; }
    container.innerHTML = '';
    const byCategory = {};
    recommendedServers.forEach(server => {
      const key = server.category || 'Other';
      (byCategory[key] = byCategory[key] || []).push(server);
    });
    Object.keys(byCategory).sort().forEach(category => {
      const group = document.createElement('div');
      group.className = 'wiz-category';
      const heading = document.createElement('h4');
      heading.textContent = category;
      group.appendChild(heading);
      const grid = document.createElement('div');
      grid.className = 'wiz-server-grid';
      byCategory[category].forEach(server => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'wiz-server-card';
        card.dataset.serverId = server.id;
        const name = document.createElement('span');
        name.className = 'wiz-server-name';
        name.textContent = server.name;
        const desc = document.createElement('span');
        desc.className = 'wiz-server-desc';
        desc.textContent = server.description;
        card.appendChild(name);
        card.appendChild(desc);
        grid.appendChild(card);
      });
      group.appendChild(grid);
      container.appendChild(group);
    });
  }

  function renderWizardBadges(server) {
    const badges = document.getElementById('wiz-config-badges');
    if (!(badges instanceof HTMLElement)) { return; }
    badges.innerHTML = '';
    const provenance = document.createElement('span');
    provenance.className = 'provenance-badge provenance-' + (server.provenance || 'registry');
    provenance.textContent = server.provenanceLabel || 'Registry fallback';
    provenance.title = server.provenanceHint || '';
    badges.appendChild(provenance);
  }

  function renderWizardInputs(server, autoConfigurable) {
    const container = document.getElementById('wiz-inputs');
    if (!(container instanceof HTMLElement)) { return; }
    container.innerHTML = '';
    if (!server.inputs || server.inputs.length === 0) {
      const note = document.createElement('p');
      note.className = 'muted';
      // Be honest about what will happen on Connect: a starter with no fields and
      // no command/URL cannot be auto-configured — say so instead of implying it can.
      note.textContent = autoConfigurable
        ? 'No extra details needed — just connect.'
        : server.name + ' can’t be auto-configured here. It needs a command or endpoint URL you provide — use Open Advanced setup to enter the connection details manually.';
      container.appendChild(note);
      return;
    }
    server.inputs.forEach(input => {
      const row = document.createElement('div');
      row.className = 'field-row';
      const label = document.createElement('label');
      label.textContent = input.label + (input.required ? ' *' : '');
      label.setAttribute('for', 'wiz-input-' + input.key);
      row.appendChild(label);
      const field = document.createElement('input');
      field.id = 'wiz-input-' + input.key;
      field.dataset.inputKey = input.key;
      field.type = input.kind === 'secret' ? 'password' : (input.kind === 'url' ? 'url' : 'text');
      field.autocomplete = 'off';
      if (input.defaultValue) { field.value = input.defaultValue; }
      if (input.example) { field.placeholder = input.example; }
      row.appendChild(field);
      if (input.help) {
        const help = document.createElement('p');
        help.className = 'field-help muted';
        help.textContent = input.help;
        row.appendChild(help);
      }
      if (input.kind === 'secret') {
        const secure = document.createElement('p');
        secure.className = 'field-help muted';
        secure.textContent = 'Stored securely in the OS secret store; never written to settings.';
        row.appendChild(secure);
      }
      container.appendChild(row);
    });
  }

  function openWizardConfigure(serverId) {
    const server = recommendedServers.find(entry => entry.id === serverId);
    if (!server) { return; }
    wizardServerId = serverId;
    const nameEl = document.getElementById('wiz-config-name');
    const descEl = document.getElementById('wiz-config-desc');
    const docsEl = document.getElementById('wiz-config-docs');
    if (nameEl instanceof HTMLElement) { nameEl.textContent = server.name; }
    if (descEl instanceof HTMLElement) { descEl.textContent = server.description; }
    if (docsEl instanceof HTMLAnchorElement) {
      docsEl.href = server.docsUrl || '#';
      docsEl.hidden = !server.docsUrl;
    }
    renderWizardBadges(server);
    // A starter can be connected from the wizard whenever AtlasMind knows its
    // endpoint (a command for stdio, or a URL for http) — including guided-manual
    // community servers, which are prefilled but flagged for review. Only starters
    // with no endpoint at all (the generic custom fallback) route to Advanced.
    const hasEndpoint = server.transport === 'http' ? Boolean(server.url) : Boolean(server.command);
    const autoConfigurable = hasEndpoint;
    // Guided-manual = prefilled but flagged community server (setupMode 'manual'
    // yet has a command). It still connects; only the framing differs.
    const guidedManual = autoConfigurable && server.setupMode === 'manual';
    renderWizardGuided(server);
    renderWizardInputs(server, autoConfigurable);
    const connectBtn = document.getElementById('wiz-connect-btn');
    if (connectBtn instanceof HTMLButtonElement) {
      connectBtn.hidden = !autoConfigurable;
      connectBtn.disabled = false;
      connectBtn.textContent = guidedManual ? 'Add & connect' : 'Connect';
    }
    const advancedBtn = document.getElementById('wiz-advanced-btn');
    if (advancedBtn instanceof HTMLButtonElement) { advancedBtn.hidden = autoConfigurable; }
    const prereq = document.getElementById('wiz-prereq');
    if (prereq instanceof HTMLElement) { prereq.textContent = 'Checking prerequisites…'; prereq.className = 'status-banner status-info'; }
    const actions = document.getElementById('wiz-prereq-actions');
    if (actions instanceof HTMLElement) { actions.innerHTML = ''; }
    showWizardStep('wiz-configure');
    setWizardStatus(
      !autoConfigurable
        ? server.name + ' needs manual setup. Use Open Advanced setup to enter the command or endpoint URL.'
        : guidedManual
          ? 'Community server — review the steps below, then add and connect.'
          : 'Follow the steps below to get your credentials, then connect.',
      autoConfigurable ? (guidedManual ? 'warning' : 'info') : 'warning',
    );
    vscode.postMessage({ type: 'checkPrerequisites', payload: { serverId } });
  }

  // Render the "what you'll need" + step-by-step credential how-to + links for a
  // recommended server so novices are never dropped into a blank form.
  function renderWizardGuided(server) {
    const safety = document.getElementById('wiz-safety');
    if (safety instanceof HTMLElement) {
      if (server.safetyNote) {
        safety.textContent = '⚠ ' + server.safetyNote;
        safety.hidden = false;
      } else {
        safety.textContent = '';
        safety.hidden = true;
      }
    }
    const guided = document.getElementById('wiz-guided');
    if (!(guided instanceof HTMLElement)) { return; }
    guided.innerHTML = '';

    const prereqs = Array.isArray(server.prerequisites) ? server.prerequisites : [];
    const steps = Array.isArray(server.credentialSteps) ? server.credentialSteps : [];

    if (prereqs.length > 0) {
      const card = document.createElement('div');
      card.className = 'wiz-guided-card';
      const h = document.createElement('p');
      h.className = 'wiz-guided-title';
      h.textContent = 'What you’ll need';
      card.appendChild(h);
      const ul = document.createElement('ul');
      ul.className = 'wiz-guided-list';
      prereqs.forEach(item => {
        const li = document.createElement('li');
        li.textContent = item;
        ul.appendChild(li);
      });
      card.appendChild(ul);
      guided.appendChild(card);
    }

    if (steps.length > 0) {
      const card = document.createElement('div');
      card.className = 'wiz-guided-card';
      const h = document.createElement('p');
      h.className = 'wiz-guided-title';
      h.textContent = 'How to get set up';
      card.appendChild(h);
      const ol = document.createElement('ol');
      ol.className = 'wiz-guided-steps';
      steps.forEach(step => {
        const li = document.createElement('li');
        li.textContent = step;
        ol.appendChild(li);
      });
      card.appendChild(ol);
      // Action links: credentials page + docs.
      const links = document.createElement('div');
      links.className = 'wiz-guided-links';
      if (server.credentialHelpUrl) {
        const a = document.createElement('a');
        a.href = server.credentialHelpUrl;
        a.target = '_blank';
        a.rel = 'noopener';
        a.className = 'wiz-guided-link primary';
        a.textContent = 'Open credentials page ↗';
        links.appendChild(a);
      }
      if (server.docsUrl) {
        const a = document.createElement('a');
        a.href = server.docsUrl;
        a.target = '_blank';
        a.rel = 'noopener';
        a.className = 'wiz-guided-link';
        a.textContent = 'Documentation ↗';
        links.appendChild(a);
      }
      if (links.childNodes.length > 0) { card.appendChild(links); }
      guided.appendChild(card);
    }
  }

  function renderScanResults(results) {
    const list = document.getElementById('wiz-scan-list');
    if (!(list instanceof HTMLElement)) { return; }
    list.innerHTML = '';
    if (!Array.isArray(results) || results.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'AtlasMind did not detect any ready-to-connect servers. Try "Browse by category" instead.';
      list.appendChild(empty);
      setWizardStatus('No servers detected automatically. Browse the catalogue to pick one.', 'info');
      return;
    }
    setWizardStatus(results.length + ' server' + (results.length === 1 ? '' : 's') + ' detected. Add the ones you want.', 'success');
    results.forEach(result => {
      const card = document.createElement('div');
      card.className = 'wiz-detected-card';
      const info = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = result.name;
      const reason = document.createElement('span');
      reason.className = 'muted';
      reason.textContent = ' — ' + result.reason;
      info.appendChild(name);
      info.appendChild(reason);
      if (result.detail) {
        const detail = document.createElement('div');
        detail.className = 'wiz-detected-detail';
        const code = document.createElement('code');
        code.textContent = result.detail;
        detail.appendChild(code);
        info.appendChild(detail);
      }
      card.appendChild(info);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn-small';
      button.dataset.detectedIndex = String(result.index);
      button.textContent = 'Add & connect';
      card.appendChild(button);
      list.appendChild(card);
    });
  }

  function applyPrerequisiteStatus(payload) {
    if (!payload || payload.serverId !== wizardServerId) { return; }
    const prereq = document.getElementById('wiz-prereq');
    const actions = document.getElementById('wiz-prereq-actions');
    const connectBtn = document.getElementById('wiz-connect-btn');
    if (!(prereq instanceof HTMLElement)) { return; }
    if (actions instanceof HTMLElement) { actions.innerHTML = ''; }
    // Deny by default. This line used to read "disabled = false" unconditionally
    // and nothing below re-disabled it, so the prerequisite check reported a
    // missing runtime in the banner while leaving Connect fully armed — a gate
    // that displayed its verdict but never enforced it. Connect is now re-armed
    // only on an explicit 'ready'.
    if (connectBtn instanceof HTMLButtonElement) {
      connectBtn.disabled = true;
      connectBtn.textContent = 'Connect';
      connectBtn.title = '';
    }

    if (payload.status === 'ready') {
      prereq.textContent = 'All prerequisites are ready.';
      prereq.className = 'status-banner status-success';
      if (connectBtn instanceof HTMLButtonElement) { connectBtn.disabled = false; }
      return;
    }

    if (payload.status === 'installable') {
      prereq.textContent = (payload.declined ? 'Installation was cancelled. ' : '') + 'This server needs ' + (payload.displayName || 'a runtime') + ', which is not installed yet.';
      prereq.className = 'status-banner status-warning';
      // Say why Connect is unavailable on the control itself; the banner alone
      // left a disabled button looking broken rather than blocked.
      if (connectBtn instanceof HTMLButtonElement) {
        connectBtn.textContent = 'Install ' + (payload.displayName || 'the runtime') + ' first';
        connectBtn.title = 'AtlasMind could not find ' + (payload.displayName || 'the required runtime') + ' on this machine. Install it here, or use Advanced setup to configure the server by hand.';
      }
      if (actions instanceof HTMLElement) {
        const install = document.createElement('button');
        install.type = 'button';
        install.className = 'btn-small';
        install.dataset.wizInstall = '1';
        install.textContent = 'Install ' + (payload.displayName || 'runtime');
        actions.appendChild(install);
        if (payload.humanCommand) {
          const cmd = document.createElement('code');
          cmd.className = 'wiz-install-cmd';
          cmd.textContent = payload.humanCommand;
          actions.appendChild(cmd);
        }
      }
      return;
    }

    // manual
    prereq.textContent = payload.message || 'This server needs manual setup before it can connect.';
    prereq.className = 'status-banner status-warning';
    if (connectBtn instanceof HTMLButtonElement) {
      connectBtn.textContent = 'Manual setup required';
      connectBtn.title = 'This server cannot be configured automatically. Use “Open Advanced setup” to finish it by hand.';
    }
  }

  document.getElementById('wiz-scan-btn')?.addEventListener('click', () => {
    showWizardStep('wiz-scan');
    const list = document.getElementById('wiz-scan-list');
    if (list instanceof HTMLElement) { list.innerHTML = '<p class="muted">Scanning your environment…</p>'; }
    setWizardStatus('Scanning your computer for tools AtlasMind can set up…', 'info');
    vscode.postMessage({ type: 'scanEnvironment' });
  });

  document.getElementById('wiz-browse-btn')?.addEventListener('click', () => {
    renderBrowseCategories();
    showWizardStep('wiz-browse');
    setWizardStatus('Choose a server to set up. AtlasMind will guide you through the rest.', 'info');
  });

  document.getElementById('wiz-advanced-link')?.addEventListener('click', () => activatePage('advanced'));

  // From the configure step, carry the chosen starter into the Advanced form so
  // the user doesn't retype the name/transport before adding the missing endpoint.
  document.getElementById('wiz-advanced-btn')?.addEventListener('click', () => {
    activatePage('advanced');
    if (wizardServerId) {
      if (presetSelect instanceof HTMLSelectElement) { presetSelect.value = wizardServerId; }
      applyRecommendedPreset(wizardServerId);
    }
  });

  document.querySelectorAll('[data-wiz-back]').forEach(button => {
    if (button instanceof HTMLElement) {
      button.addEventListener('click', () => {
        showWizardStep('wiz-choose');
        setWizardStatus('Choose how you would like to add an MCP server.', 'info');
      });
    }
  });

  document.getElementById('wiz-browse-list')?.addEventListener('click', event => {
    const target = event.target instanceof HTMLElement ? event.target.closest('[data-server-id]') : null;
    if (target instanceof HTMLElement && target.dataset.serverId) {
      openWizardConfigure(target.dataset.serverId);
    }
  });

  document.getElementById('wiz-scan-list')?.addEventListener('click', event => {
    const target = event.target instanceof HTMLElement ? event.target.closest('[data-detected-index]') : null;
    if (target instanceof HTMLElement && target.dataset.detectedIndex !== undefined) {
      const index = parseInt(target.dataset.detectedIndex, 10);
      if (!Number.isNaN(index)) {
        if (target instanceof HTMLButtonElement) { target.disabled = true; target.textContent = 'Connecting…'; }
        setWizardStatus('Connecting the detected server…', 'info');
        vscode.postMessage({ type: 'connectDetected', payload: { index } });
      }
    }
  });

  document.getElementById('wiz-prereq-actions')?.addEventListener('click', event => {
    const target = event.target instanceof HTMLElement ? event.target.closest('[data-wiz-install]') : null;
    if (target instanceof HTMLElement && wizardServerId) {
      setWizardStatus('Preparing to install the required runtime…', 'info');
      vscode.postMessage({ type: 'installPrerequisite', payload: { serverId: wizardServerId } });
    }
  });

  document.getElementById('wiz-config-form')?.addEventListener('submit', event => {
    event.preventDefault();
    if (!wizardServerId) { return; }
    const inputs = {};
    document.querySelectorAll('#wiz-inputs [data-input-key]').forEach(field => {
      if (field instanceof HTMLInputElement && field.dataset.inputKey) {
        inputs[field.dataset.inputKey] = field.value;
      }
    });
    const server = recommendedServers.find(entry => entry.id === wizardServerId);
    if (server && Array.isArray(server.inputs)) {
      for (const input of server.inputs) {
        if (input.required && !(inputs[input.key] || '').trim()) {
          setWizardStatus('Please fill in "' + input.label + '" before connecting.', 'warning');
          return;
        }
      }
    }
    const connectBtn = document.getElementById('wiz-connect-btn');
    if (connectBtn instanceof HTMLButtonElement) { connectBtn.disabled = true; connectBtn.textContent = 'Connecting…'; }
    setWizardStatus('Saving and connecting… first-time installs can take a minute.', 'info');
    vscode.postMessage({ type: 'wizardConnect', payload: { serverId: wizardServerId, inputs } });
  });

  // ── Environment scan: import from other tools + PATH/env hints ──
  function renderMcpScan() {
    const host = document.getElementById('mcp-scan');
    if (!(host instanceof HTMLElement)) { return; }
    host.innerHTML = '';
    const scan = mcpEnvironmentScan;

    const head = document.createElement('div');
    head.className = 'mcp-scan-head';
    const title = document.createElement('strong');
    title.textContent = 'Detected on this machine';
    head.appendChild(title);
    const rescan = document.createElement('button');
    rescan.type = 'button';
    rescan.className = 'btn-small';
    rescan.dataset.scanAction = 'rescan';
    rescan.textContent = scan ? 'Rescan' : 'Scan my machine';
    head.appendChild(rescan);
    if (scan && scan.scannedAt) {
      const when = document.createElement('span');
      when.className = 'muted mcp-scan-when';
      let stamp = scan.scannedAt;
      try { stamp = new Date(scan.scannedAt).toLocaleString(); } catch (e) { /* keep ISO */ }
      when.textContent = 'last scanned ' + stamp;
      head.appendChild(when);
    }
    host.appendChild(head);

    if (!scan) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'Scan your machine to import MCP servers you already use in Claude Desktop, Cursor, VS Code, or this repo — and to see which launch tools are installed.';
      host.appendChild(p);
      return;
    }

    const imported = Array.isArray(scan.importedServers) ? scan.importedServers : [];
    if (imported.length > 0) {
      const sub = document.createElement('p');
      sub.className = 'mcp-scan-sub';
      sub.textContent = 'Servers found in your other tools — prefill the form or import directly:';
      host.appendChild(sub);
      imported.forEach(server => {
        const card = document.createElement('div');
        card.className = 'mcp-scan-card';
        const info = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = server.name;
        const src = document.createElement('span');
        src.className = 'muted';
        src.textContent = ' · ' + server.source;
        info.appendChild(name);
        info.appendChild(src);
        const detail = document.createElement('div');
        detail.className = 'mcp-scan-detail';
        const code = document.createElement('code');
        code.textContent = server.transport === 'http'
          ? (server.url || '')
          : ((server.command || '') + ' ' + (Array.isArray(server.args) ? server.args.join(' ') : '')).trim();
        detail.appendChild(code);
        info.appendChild(detail);
        if (Array.isArray(server.envKeys) && server.envKeys.length > 0) {
          const env = document.createElement('div');
          env.className = 'muted mcp-scan-env';
          env.textContent = 'env: ' + server.envKeys.join(', ') + ((server.secretEnvKeys && server.secretEnvKeys.length) ? ' (secrets stored securely on import)' : '');
          info.appendChild(env);
        }
        card.appendChild(info);
        const actions = document.createElement('div');
        actions.className = 'mcp-scan-actions';
        const prefill = document.createElement('button');
        prefill.type = 'button';
        prefill.className = 'btn-small';
        prefill.dataset.scanAction = 'prefill';
        prefill.dataset.source = server.sourcePath;
        prefill.dataset.name = server.name;
        prefill.textContent = 'Prefill form';
        actions.appendChild(prefill);
        const importBtn = document.createElement('button');
        importBtn.type = 'button';
        importBtn.className = 'btn-small';
        importBtn.dataset.scanAction = 'import';
        importBtn.dataset.source = server.sourcePath;
        importBtn.dataset.name = server.name;
        importBtn.textContent = 'Import & connect';
        actions.appendChild(importBtn);
        card.appendChild(actions);
        host.appendChild(card);
      });
    }

    const launchers = scan.launchers || {};
    const present = Object.keys(launchers).filter(k => launchers[k]);
    const launchLine = document.createElement('p');
    launchLine.className = 'muted mcp-scan-launchers';
    launchLine.textContent = present.length > 0
      ? ('Launch tools on your PATH: ' + present.join(', '))
      : 'No MCP launch tools (npx, uvx, docker…) detected on your PATH.';
    host.appendChild(launchLine);

    const envNames = Array.isArray(scan.envVarNames) ? scan.envVarNames : [];
    if (envNames.length > 0) {
      const envWrap = document.createElement('div');
      envWrap.className = 'mcp-scan-envhints';
      const label = document.createElement('span');
      label.className = 'muted';
      label.textContent = 'Env var names in this workspace (click to add — values not included): ';
      envWrap.appendChild(label);
      envNames.forEach(nm => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'mcp-env-chip';
        chip.dataset.scanAction = 'env-name';
        chip.dataset.envName = nm;
        chip.textContent = nm;
        envWrap.appendChild(chip);
      });
      host.appendChild(envWrap);
    }

    const ask = document.createElement('p');
    ask.className = 'mcp-scan-ask';
    const askBtn = document.createElement('button');
    askBtn.type = 'button';
    askBtn.className = 'link-button';
    askBtn.dataset.scanAction = 'ask-atlas';
    askBtn.textContent = 'Not sure how to configure a server? Ask Atlas to help';
    ask.appendChild(askBtn);
    host.appendChild(ask);
  }

  function prefillFromImport(sourcePath, name) {
    const imported = (mcpEnvironmentScan && Array.isArray(mcpEnvironmentScan.importedServers)) ? mcpEnvironmentScan.importedServers : [];
    const server = imported.find(s => s.sourcePath === sourcePath && s.name === name);
    if (!server) { return; }
    const nameField = document.getElementById('serverName');
    const cmdField = document.getElementById('cmdField');
    const argsField = document.getElementById('argsField');
    const envField = document.getElementById('envField');
    const urlField = document.getElementById('urlField');
    const transportStdio = document.getElementById('transportStdio');
    const transportHttp = document.getElementById('transportHttp');
    if (presetSelect instanceof HTMLSelectElement) { presetSelect.value = ''; }
    if (nameField instanceof HTMLInputElement) { nameField.value = server.name || ''; }
    if (cmdField instanceof HTMLInputElement) { cmdField.value = server.command || ''; }
    if (argsField instanceof HTMLInputElement) { argsField.value = Array.isArray(server.args) ? server.args.join(' ') : ''; }
    if (urlField instanceof HTMLInputElement) { urlField.value = server.url || ''; }
    // Env KEYS only — secret values are never copied into the visible form.
    if (envField instanceof HTMLInputElement) {
      const keys = Array.isArray(server.envKeys) ? server.envKeys : [];
      const obj = {};
      keys.forEach(k => { obj[k] = ''; });
      envField.value = keys.length > 0 ? JSON.stringify(obj) : '';
    }
    if (transportStdio instanceof HTMLInputElement) { transportStdio.checked = server.transport === 'stdio'; }
    if (transportHttp instanceof HTMLInputElement) { transportHttp.checked = server.transport === 'http'; }
    setTransportMode(server.transport === 'stdio');
    updateSubmitButton();
    setStatus('Prefilled from ' + server.source + '. Secret values are not copied here — use "Import & connect" to bring them across securely, or paste them yourself.', 'info');
  }

  function addEnvName(name) {
    if (!name) { return; }
    const envField = document.getElementById('envField');
    if (!(envField instanceof HTMLInputElement)) { return; }
    let obj = {};
    const raw = envField.value.trim();
    if (raw) { try { obj = JSON.parse(raw); } catch (e) { obj = {}; } }
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) { obj = {}; }
    if (!(name in obj)) { obj[name] = ''; }
    envField.value = JSON.stringify(obj);
  }

  document.getElementById('mcp-scan')?.addEventListener('click', event => {
    const target = event.target instanceof HTMLElement ? event.target.closest('[data-scan-action]') : null;
    if (!(target instanceof HTMLElement)) { return; }
    const action = target.dataset.scanAction;
    if (action === 'rescan') {
      if (target instanceof HTMLButtonElement) { target.disabled = true; target.textContent = 'Scanning…'; }
      vscode.postMessage({ type: 'rescanMcpEnvironment' });
      return;
    }
    if (action === 'prefill') {
      prefillFromImport(target.dataset.source || '', target.dataset.name || '');
      return;
    }
    if (action === 'import') {
      if (target instanceof HTMLButtonElement) { target.disabled = true; target.textContent = 'Importing…'; }
      setStatus('Importing and connecting the detected server…', 'info');
      vscode.postMessage({ type: 'importDetectedServer', payload: { sourcePath: target.dataset.source || '', name: target.dataset.name || '', connect: true } });
      return;
    }
    if (action === 'env-name') {
      addEnvName(target.dataset.envName || '');
      return;
    }
    if (action === 'ask-atlas') {
      const nameField = document.getElementById('serverName');
      const typed = (nameField instanceof HTMLInputElement && nameField.value.trim()) ? nameField.value.trim() : '';
      const preset = (presetSelect instanceof HTMLSelectElement && presetSelect.value) ? presetSelect.value : '';
      vscode.postMessage({ type: 'askAtlasConfigureMcp', payload: { name: typed || preset || 'a custom MCP server' } });
      return;
    }
  });

  setTransportMode(Boolean((document.getElementById('transportStdio') || {}).checked));
  updateSubmitButton();
  renderMcpScan();
  if (initialRecommendedServerId) {
    if (initialPage === 'add') {
      openWizardConfigure(initialRecommendedServerId);
    } else if (presetSelect instanceof HTMLSelectElement) {
      presetSelect.value = initialRecommendedServerId;
      applyRecommendedPreset(initialRecommendedServerId);
    }
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
    case 'openResourceDiscovery':
      return { type: 'openResourceDiscovery' };
    case 'scanEnvironment':
      return { type: 'scanEnvironment' };
    case 'connectDetected': {
      const p = msg['payload'];
      if (typeof p !== 'object' || p === null) { return null; }
      const index = (p as Record<string, unknown>)['index'];
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) { return null; }
      return { type: 'connectDetected', payload: { index } };
    }
    case 'checkPrerequisites':
    case 'installPrerequisite': {
      const p = msg['payload'];
      if (typeof p !== 'object' || p === null) { return null; }
      const serverId = (p as Record<string, unknown>)['serverId'];
      if (typeof serverId !== 'string' || !serverId) { return null; }
      return { type, payload: { serverId } } as PanelMessage;
    }
    case 'wizardConnect': {
      const p = msg['payload'];
      if (typeof p !== 'object' || p === null) { return null; }
      const pp = p as Record<string, unknown>;
      if (typeof pp['serverId'] !== 'string' || !pp['serverId']) { return null; }
      const rawInputs = pp['inputs'];
      const inputs: Record<string, string> = {};
      if (typeof rawInputs === 'object' && rawInputs !== null) {
        for (const [key, value] of Object.entries(rawInputs as Record<string, unknown>)) {
          if (typeof key === 'string' && typeof value === 'string') { inputs[key] = value; }
        }
      }
      return { type: 'wizardConnect', payload: { serverId: pp['serverId'] as string, inputs } };
    }
    case 'rescanMcpEnvironment':
      return { type: 'rescanMcpEnvironment' };
    case 'importDetectedServer': {
      const p = msg['payload'];
      if (typeof p !== 'object' || p === null) { return null; }
      const pp = p as Record<string, unknown>;
      if (typeof pp['sourcePath'] !== 'string' || !pp['sourcePath']) { return null; }
      if (typeof pp['name'] !== 'string' || !pp['name']) { return null; }
      return { type: 'importDetectedServer', payload: { sourcePath: pp['sourcePath'], name: pp['name'], connect: pp['connect'] === true } };
    }
    case 'askAtlasConfigureMcp': {
      const p = msg['payload'];
      if (typeof p !== 'object' || p === null) { return null; }
      const name = (p as Record<string, unknown>)['name'];
      if (typeof name !== 'string' || !name) { return null; }
      return { type: 'askAtlasConfigureMcp', payload: { name } };
    }
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
