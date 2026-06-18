/**
 * ArdDiscoveryPanel – webview for Agentic Resource Discovery (ARD).
 *
 * Lets the user search enabled Agent Finders, browse ranked results, install
 * discovered resources (MCP servers land disabled, behind the existing MCP
 * trust gate), manage finders (opt-in), fetch a manifest by URL, and export
 * AtlasMind's own catalog.
 *
 * Security:
 *  - All user / network strings are HTML-escaped before rendering.
 *  - All incoming webview messages are validated before acting on them.
 *  - No inline event handlers; interaction goes through postMessage.
 *  - The CSP restricts scripts to the single nonce embedded at render time.
 *  - The relevance score is always labelled "not a trust/safety rating".
 */

import * as vscode from 'vscode';
import { getWebviewHtmlShell, escapeHtml } from './webviewUtils.js';
import type { ArdClient } from '../ard/ardClient.js';
import type { ArdInstaller } from '../ard/ardInstaller.js';
import type { ArdRegistry } from '../ard/ardRegistry.js';
import type { ArdDiscoveredResource, ArdDiscoveryEndpoint } from '../types.js';

export interface ArdDiscoveryPanelDeps {
  registry: ArdRegistry;
  client: ArdClient;
  installer: ArdInstaller;
  onRefresh: () => void;
}

type PanelMessage =
  | { type: 'search'; payload: { query: string; typeFilter?: string } }
  | { type: 'install'; payload: { identifier: string } }
  | { type: 'toggleFinder'; payload: { id: string; enabled: boolean } }
  | { type: 'removeFinder'; payload: { id: string } }
  | { type: 'addFinder'; payload: { name: string; url: string; kind: string; insecure: boolean } }
  | { type: 'fetchManifest'; payload: { url: string } }
  | { type: 'exportCatalog' }
  | { type: 'refresh' };

interface PanelStatus {
  kind: 'info' | 'success' | 'warning' | 'error';
  text: string;
}

export class ArdDiscoveryPanel {
  public static currentPanel: ArdDiscoveryPanel | undefined;
  private static readonly viewType = 'atlasmind.ardDiscoveryPanel';

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private lastResults: ArdDiscoveredResource[] = [];
  private lastQuery = '';
  private status: PanelStatus | undefined;
  private busy = false;

  public static createOrShow(context: vscode.ExtensionContext, deps: ArdDiscoveryPanelDeps): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (ArdDiscoveryPanel.currentPanel) {
      ArdDiscoveryPanel.currentPanel.deps = deps;
      ArdDiscoveryPanel.currentPanel.panel.reveal(column);
      ArdDiscoveryPanel.currentPanel.render();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      ArdDiscoveryPanel.viewType,
      'AtlasMind: Resource Discovery',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );
    ArdDiscoveryPanel.currentPanel = new ArdDiscoveryPanel(panel, deps);
  }

  private constructor(panel: vscode.WebviewPanel, private deps: ArdDiscoveryPanelDeps) {
    this.panel = panel;
    this.lastResults = deps.registry.getRecentResults();
    this.render();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => { void this.handleMessage(message); },
      null,
      this.disposables,
    );
  }

  private dispose(): void {
    ArdDiscoveryPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) { d.dispose(); }
  }

  private render(): void {
    this.panel.webview.html = this.buildHtml();
  }

  // ── Message handling ─────────────────────────────────────────

  private async handleMessage(raw: unknown): Promise<void> {
    const message = validateMessage(raw);
    if (!message) { return; }

    switch (message.type) {
      case 'search':
        await this.runSearch(message.payload.query, message.payload.typeFilter);
        break;
      case 'fetchManifest':
        await this.runManifestFetch(message.payload.url);
        break;
      case 'install':
        await this.runInstall(message.payload.identifier);
        break;
      case 'toggleFinder':
        this.deps.registry.setEnabled(message.payload.id, message.payload.enabled);
        this.status = { kind: 'info', text: `Finder ${message.payload.enabled ? 'enabled' : 'disabled'}.` };
        break;
      case 'removeFinder':
        this.deps.registry.remove(message.payload.id);
        this.status = { kind: 'info', text: 'Finder removed.' };
        break;
      case 'addFinder':
        this.runAddFinder(message.payload);
        break;
      case 'exportCatalog':
        await vscode.commands.executeCommand('atlasmind.ard.exportCatalog');
        this.status = { kind: 'info', text: 'Catalog export started — see the save dialog.' };
        break;
      case 'refresh':
        break;
    }

    this.render();
    this.deps.onRefresh();
  }

  private async runSearch(rawQuery: string, typeFilter?: string): Promise<void> {
    const query = rawQuery.trim();
    if (!query) {
      this.status = { kind: 'warning', text: 'Enter a search query.' };
      return;
    }
    const endpoints = this.deps.registry.listEnabled();
    if (endpoints.length === 0) {
      this.status = { kind: 'warning', text: 'No Agent Finders are enabled. Enable one below before searching.' };
      return;
    }

    this.lastQuery = query;
    this.busy = true;
    this.render();

    const filter = typeFilter && typeFilter.trim() ? { type: [typeFilter.trim()] } : undefined;
    const { results, errors } = await this.deps.client.searchEndpoints(endpoints, query, filter ? { filter } : {});
    this.busy = false;
    this.lastResults = results;
    this.deps.registry.setRecentResults(results);
    this.status = results.length > 0
      ? { kind: 'success', text: `Found ${results.length} result(s) for "${query}".${errors.length ? ` ${errors.length} finder(s) errored.` : ''}` }
      : { kind: 'warning', text: `No results for "${query}".${errors.length ? ` ${errors.map(e => `${e.endpoint}: ${e.message}`).join('; ')}` : ''}` };
  }

  private async runManifestFetch(rawUrl: string): Promise<void> {
    const url = rawUrl.trim();
    if (!url) {
      this.status = { kind: 'warning', text: 'Enter a manifest or origin URL.' };
      return;
    }
    this.busy = true;
    this.render();
    try {
      const catalog = await this.deps.client.fetchCatalog(url);
      this.lastQuery = url;
      this.lastResults = catalog.entries.map(entry => ({
        identifier: entry.identifier,
        displayName: entry.displayName,
        type: entry.type,
        ...(entry.url ? { url: entry.url } : {}),
        ...(entry.data ? { data: entry.data } : {}),
        ...(entry.description ? { description: entry.description } : {}),
        ...(entry.capabilities ? { capabilities: entry.capabilities } : {}),
        ...(entry.tags ? { tags: entry.tags } : {}),
        ...(entry.trustManifest ? { trustManifest: entry.trustManifest } : {}),
        sourceName: catalog.host?.displayName ?? 'Manifest',
      }));
      this.deps.registry.setRecentResults(this.lastResults);
      this.status = { kind: 'success', text: `Loaded ${this.lastResults.length} entr(ies) from the manifest.` };
    } catch (error) {
      this.status = { kind: 'error', text: `Manifest fetch failed: ${error instanceof Error ? error.message : String(error)}` };
    } finally {
      this.busy = false;
    }
  }

  private async runInstall(identifier: string): Promise<void> {
    const resource = this.lastResults.find(r => r.identifier === identifier);
    if (!resource) {
      this.status = { kind: 'error', text: 'That result is no longer available — search again.' };
      return;
    }
    try {
      const result = await this.deps.installer.install(resource);
      this.status = { kind: result.ok ? 'success' : 'warning', text: result.message };
      if (result.kind === 'mcp-server') {
        void vscode.window.showInformationMessage(result.message, 'Open MCP Servers').then(choice => {
          if (choice === 'Open MCP Servers') {
            void vscode.commands.executeCommand('atlasmind.openMcpServers');
          }
        });
      }
    } catch (error) {
      this.status = { kind: 'error', text: `Install failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private runAddFinder(payload: { name: string; url: string; kind: string; insecure: boolean }): void {
    const name = payload.name.trim();
    const url = payload.url.trim();
    const kind = payload.kind === 'manifest' ? 'manifest' : 'registry';
    if (!name || !url) {
      this.status = { kind: 'warning', text: 'A finder needs both a name and a URL.' };
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      this.status = { kind: 'warning', text: 'Finder URL must start with https:// (or http:// for a trusted local registry).' };
      return;
    }
    this.deps.registry.add({ name, url, kind, enabled: false, insecure: payload.insecure });
    this.status = { kind: 'success', text: `Added "${name}" as a disabled finder. Enable it to search.` };
  }

  // ── HTML ─────────────────────────────────────────────────────

  private buildHtml(): string {
    return getWebviewHtmlShell({
      title: 'Resource Discovery',
      cspSource: this.panel.webview.cspSource,
      extraCss: EXTRA_CSS,
      bodyContent: this.buildBody(),
      scriptContent: SCRIPT,
    });
  }

  private buildBody(): string {
    const finders = this.deps.registry.list();
    const enabledCount = finders.filter(f => f.enabled).length;
    return `
    <h1>Resource Discovery <span class="badge">ARD</span></h1>
    <p class="muted">Discover external agentic resources — MCP servers, agents, skills, and APIs — via
      <a href="https://agenticresourcediscovery.org/">Agentic Resource Discovery</a>. Discovery happens
      before invocation; nothing is installed without your action. ${enabledCount} of ${finders.length} finder(s) enabled.</p>

    ${this.status ? `<p class="status status-${escapeHtml(this.status.kind)}">${escapeHtml(this.status.text)}</p>` : ''}

    <section>
      <h2>Search</h2>
      <form id="searchForm">
        <input id="searchQuery" type="search" placeholder="Describe a capability, e.g. &quot;book a flight&quot;" value="${escapeHtml(this.lastQuery)}" />
        <input id="typeFilter" type="text" placeholder="Optional type filter (e.g. application/mcp-server+json)" />
        <button type="submit">${this.busy ? 'Searching…' : 'Search'}</button>
      </form>
      <details>
        <summary>Fetch a manifest by URL</summary>
        <form id="manifestForm">
          <input id="manifestUrl" type="url" placeholder="https://example.com or https://example.com/.well-known/ai-catalog.json" />
          <button type="submit">Fetch</button>
        </form>
      </details>
    </section>

    <section>
      <h2>Results</h2>
      <p class="disclaimer">The relevance score reflects query match only — it is <strong>not</strong> a trust, compliance, or safety rating. Review each resource before installing.</p>
      ${this.buildResults()}
    </section>

    <section>
      <h2>Agent Finders</h2>
      <p class="muted">Finders ship disabled. Enable one to allow outbound discovery searches.</p>
      ${this.buildFinders(finders)}
      <details>
        <summary>Add a finder</summary>
        <form id="addFinderForm">
          <input id="finderName" type="text" placeholder="Name" />
          <input id="finderUrl" type="url" placeholder="https://registry.example.com/search" />
          <select id="finderKind">
            <option value="registry">Registry (POST /search)</option>
            <option value="manifest">Manifest (ai-catalog.json)</option>
          </select>
          <label class="inline"><input id="finderInsecure" type="checkbox" /> Allow http / localhost</label>
          <button type="submit">Add finder</button>
        </form>
      </details>
    </section>

    <section>
      <h2>Publish</h2>
      <p class="muted">Export AtlasMind's agents, skills, and MCP servers as a spec-conformant <code>ai-catalog.json</code> (system prompts, secrets, and env are never included).</p>
      <button id="exportBtn" type="button">Export this project's catalog…</button>
    </section>
    `;
  }

  private buildResults(): string {
    if (this.busy) {
      return '<p class="muted">Searching enabled finders…</p>';
    }
    if (this.lastResults.length === 0) {
      return '<p class="muted">No results yet. Run a search or fetch a manifest above.</p>';
    }
    return `<div class="results">${this.lastResults.map(r => this.buildResultCard(r)).join('')}</div>`;
  }

  private buildResultCard(r: ArdDiscoveredResource): string {
    const score = typeof r.score === 'number'
      ? `<span class="badge score" title="Semantic relevance — not a trust rating">${r.score}/100</span>`
      : '';
    const trust = r.trustManifest
      ? `<span class="badge trust" title="Publisher provided identity/attestation metadata (not verified by AtlasMind)">trust info</span>`
      : '';
    const caps = (r.capabilities ?? []).slice(0, 6).map(c => `<span class="chip">${escapeHtml(c)}</span>`).join('');
    return `
    <article class="result-card">
      <div class="result-head">
        <strong>${escapeHtml(r.displayName)}</strong>
        <span class="badge type">${escapeHtml(shortType(r.type))}</span>
        ${score}
        ${trust}
      </div>
      <div class="result-meta">${escapeHtml(r.identifier)} · via ${escapeHtml(r.sourceName)}</div>
      ${r.description ? `<p class="result-desc">${escapeHtml(truncate(r.description, 260))}</p>` : ''}
      ${caps ? `<div class="chips">${caps}</div>` : ''}
      ${r.url ? `<div class="result-url"><a href="${escapeHtml(r.url)}">${escapeHtml(r.url)}</a></div>` : ''}
      <div class="result-actions">
        <button type="button" data-install="${escapeHtml(r.identifier)}">Install</button>
      </div>
    </article>`;
  }

  private buildFinders(finders: ArdDiscoveryEndpoint[]): string {
    if (finders.length === 0) {
      return '<p class="muted">No finders configured.</p>';
    }
    return `<table>
      <thead><tr><th>Finder</th><th>Kind</th><th>Enabled</th><th></th></tr></thead>
      <tbody>
        ${finders.map(f => `
        <tr>
          <td><strong>${escapeHtml(f.name)}</strong><br /><span class="muted small">${escapeHtml(f.url)}</span></td>
          <td>${escapeHtml(f.kind)}${f.insecure ? ' <span class="badge warn">insecure</span>' : ''}</td>
          <td><label class="switch"><input type="checkbox" data-toggle-finder="${escapeHtml(f.id)}" ${f.enabled ? 'checked' : ''} /> ${f.enabled ? 'on' : 'off'}</label></td>
          <td>${f.builtIn ? '' : `<button type="button" class="link" data-remove-finder="${escapeHtml(f.id)}">Remove</button>`}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  }
}

// ── Message validation ────────────────────────────────────────────

function validateMessage(raw: unknown): PanelMessage | undefined {
  if (typeof raw !== 'object' || raw === null) { return undefined; }
  const msg = raw as Record<string, unknown>;
  const type = msg['type'];
  const payload = (msg['payload'] ?? {}) as Record<string, unknown>;
  switch (type) {
    case 'search':
      return typeof payload['query'] === 'string'
        ? { type, payload: { query: payload['query'], ...(typeof payload['typeFilter'] === 'string' ? { typeFilter: payload['typeFilter'] } : {}) } }
        : undefined;
    case 'fetchManifest':
      return typeof payload['url'] === 'string' ? { type, payload: { url: payload['url'] } } : undefined;
    case 'install':
      return typeof payload['identifier'] === 'string' ? { type, payload: { identifier: payload['identifier'] } } : undefined;
    case 'toggleFinder':
      return typeof payload['id'] === 'string' && typeof payload['enabled'] === 'boolean'
        ? { type, payload: { id: payload['id'], enabled: payload['enabled'] } }
        : undefined;
    case 'removeFinder':
      return typeof payload['id'] === 'string' ? { type, payload: { id: payload['id'] } } : undefined;
    case 'addFinder':
      return typeof payload['name'] === 'string' && typeof payload['url'] === 'string'
        ? {
            type,
            payload: {
              name: payload['name'],
              url: payload['url'],
              kind: typeof payload['kind'] === 'string' ? payload['kind'] : 'registry',
              insecure: payload['insecure'] === true,
            },
          }
        : undefined;
    case 'exportCatalog':
      return { type: 'exportCatalog' };
    case 'refresh':
      return { type: 'refresh' };
    default:
      return undefined;
  }
}

// ── Presentation helpers ──────────────────────────────────────────

function shortType(type: string): string {
  return type
    .replace(/^application\//, '')
    .replace(/\+json$/, '')
    .replace(/^vnd\.atlasmind\./, '');
}

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

const EXTRA_CSS = `
  .muted { color: var(--vscode-descriptionForeground); }
  .small { font-size: 0.85em; }
  a { color: var(--vscode-textLink-foreground); }
  form { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; align-items: center; }
  input[type="search"], input[type="text"], input[type="url"], select {
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, #555); padding: 5px 8px; border-radius: 3px; min-width: 220px; flex: 1 1 220px;
  }
  label.inline, label.switch { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; }
  details { margin-top: 8px; }
  summary { cursor: pointer; color: var(--vscode-textLink-foreground); }
  .status { padding: 6px 10px; border-radius: 4px; }
  .status-success { background: var(--vscode-testing-iconPassed, #2d4); color: #000; }
  .status-warning { background: var(--vscode-inputValidation-warningBackground, #5a4); }
  .status-error { background: var(--vscode-inputValidation-errorBackground, #844); }
  .status-info { background: var(--vscode-badge-background); }
  .disclaimer { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .results { display: flex; flex-direction: column; gap: 10px; }
  .result-card { border: 1px solid var(--vscode-widget-border, #444); border-radius: 6px; padding: 10px 12px; }
  .result-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .result-meta { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-top: 2px; }
  .result-desc { margin: 6px 0; }
  .result-url { font-size: 0.85em; margin-top: 4px; }
  .result-actions { margin-top: 8px; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .chip { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 8px; padding: 1px 8px; font-size: 0.8em; }
  .badge.type { background: var(--vscode-button-secondaryBackground, #444); }
  .badge.score { background: var(--vscode-charts-blue, #36c); color: #fff; }
  .badge.trust { background: var(--vscode-charts-purple, #93c); color: #fff; }
  .badge.warn { background: var(--vscode-inputValidation-warningBackground, #a83); }
  button.link { background: none; color: var(--vscode-textLink-foreground); padding: 0; }
`;

const SCRIPT = `
  const vscode = acquireVsCodeApi();
  function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }
  function checked(id) { const el = document.getElementById(id); return el ? el.checked : false; }
  const searchForm = document.getElementById('searchForm');
  if (searchForm) searchForm.addEventListener('submit', e => { e.preventDefault(); vscode.postMessage({ type: 'search', payload: { query: val('searchQuery'), typeFilter: val('typeFilter') } }); });
  const manifestForm = document.getElementById('manifestForm');
  if (manifestForm) manifestForm.addEventListener('submit', e => { e.preventDefault(); vscode.postMessage({ type: 'fetchManifest', payload: { url: val('manifestUrl') } }); });
  const addFinderForm = document.getElementById('addFinderForm');
  if (addFinderForm) addFinderForm.addEventListener('submit', e => { e.preventDefault(); vscode.postMessage({ type: 'addFinder', payload: { name: val('finderName'), url: val('finderUrl'), kind: val('finderKind'), insecure: checked('finderInsecure') } }); });
  const exportBtn = document.getElementById('exportBtn');
  if (exportBtn) exportBtn.addEventListener('click', () => vscode.postMessage({ type: 'exportCatalog' }));
  document.addEventListener('click', e => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const install = t.getAttribute('data-install');
    if (install) { vscode.postMessage({ type: 'install', payload: { identifier: install } }); }
    const remove = t.getAttribute('data-remove-finder');
    if (remove) { vscode.postMessage({ type: 'removeFinder', payload: { id: remove } }); }
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    const toggle = t.getAttribute('data-toggle-finder');
    if (toggle) { vscode.postMessage({ type: 'toggleFinder', payload: { id: toggle, enabled: t.checked } }); }
  });
`;
