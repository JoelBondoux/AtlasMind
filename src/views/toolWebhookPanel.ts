import * as vscode from 'vscode';
import type { AtlasMindContext } from '../extension.js';
import { escapeHtml, getWebviewHtmlShell } from './webviewUtils.js';

const EVENT_VALUES = ['tool.started', 'tool.completed', 'tool.failed', 'tool.test'] as const;
type ToolWebhookEventName = (typeof EVENT_VALUES)[number];

type ToolWebhookMessage =
  | { type: 'setEnabled'; payload: boolean }
  | { type: 'setUrl'; payload: string }
  | { type: 'setTimeoutMs'; payload: number }
  | { type: 'setEvents'; payload: ToolWebhookEventName[] }
  | { type: 'setToken'; payload: string }
  | { type: 'clearToken' }
  | { type: 'sendTest' }
  | { type: 'clearHistory' }
  | { type: 'refresh' }
  | { type: 'openSettingsSafety' };

export class ToolWebhookPanel {
  public static currentPanel: ToolWebhookPanel | undefined;
  private static readonly viewType = 'atlasmind.toolWebhooks';
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  public static createOrShow(context: vscode.ExtensionContext, atlas: AtlasMindContext): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (ToolWebhookPanel.currentPanel) {
      ToolWebhookPanel.currentPanel.panel.reveal(column);
      void ToolWebhookPanel.currentPanel.render();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ToolWebhookPanel.viewType,
      'Tool Webhooks',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );

    ToolWebhookPanel.currentPanel = new ToolWebhookPanel(panel, atlas);
  }

  private constructor(panel: vscode.WebviewPanel, private readonly atlas: AtlasMindContext) {
    this.panel = panel;
    void this.render();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      message => {
        void this.handleMessage(message);
      },
      null,
      this.disposables,
    );
  }

  private dispose(): void {
    ToolWebhookPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isToolWebhookMessage(message)) {
      return;
    }

    const config = vscode.workspace.getConfiguration('atlasmind');

    switch (message.type) {
      case 'setEnabled':
        if (message.payload) {
          const approved = await this.atlas.toolWebhookDispatcher.ensureWorkspaceApproval(true);
          if (!approved) {
            await config.update('toolWebhookEnabled', false, vscode.ConfigurationTarget.Workspace);
            break;
          }
        }
        await config.update('toolWebhookEnabled', message.payload, vscode.ConfigurationTarget.Workspace);
        break;
      case 'setUrl': {
        const trimmed = message.payload.trim();
        if (trimmed.length > 0 && !isValidWebhookUrl(trimmed)) {
          vscode.window.showErrorMessage('Webhook URL must be an absolute HTTP or HTTPS URL.');
          break;
        }
        await config.update('toolWebhookUrl', trimmed, vscode.ConfigurationTarget.Workspace);
        break;
      }
      case 'setTimeoutMs':
        await config.update('toolWebhookTimeoutMs', Math.max(1000, Math.floor(message.payload)), vscode.ConfigurationTarget.Workspace);
        break;
      case 'setEvents':
        await config.update('toolWebhookEvents', message.payload, vscode.ConfigurationTarget.Workspace);
        break;
      case 'setToken':
        await this.atlas.toolWebhookDispatcher.setToken(message.payload);
        break;
      case 'clearToken':
        await this.atlas.toolWebhookDispatcher.clearToken();
        break;
      case 'sendTest':
        await this.atlas.toolWebhookDispatcher.sendTestEvent();
        break;
      case 'clearHistory':
        await this.atlas.toolWebhookDispatcher.clearHistory();
        break;
      case 'refresh':
        break;
      case 'openSettingsSafety':
        await vscode.commands.executeCommand('atlasmind.openSettingsSafety');
        return;
    }

    await this.render();
  }

  private async render(): Promise<void> {
    this.panel.webview.html = await this.getHtml();
  }

  private async getHtml(): Promise<string> {
    const config = vscode.workspace.getConfiguration('atlasmind');
    const enabled = config.get<boolean>('toolWebhookEnabled', false);
    const url = escapeHtml(config.get<string>('toolWebhookUrl', '') ?? '');
    const timeoutMs = getTimeoutMs(config.get<number>('toolWebhookTimeoutMs'));
    const selectedEvents = new Set<ToolWebhookEventName>(
      (config.get<string[]>('toolWebhookEvents', ['tool.started', 'tool.completed', 'tool.failed']) ?? [])
        .filter((event): event is ToolWebhookEventName => EVENT_VALUES.includes(event as ToolWebhookEventName)),
    );

    const urlValid = url.length === 0 || isValidWebhookUrl(url);
    const hasToken = await this.atlas.toolWebhookDispatcher.hasToken();
    const workspaceApproved = await this.atlas.toolWebhookDispatcher.hasWorkspaceApproval();
    const history = await this.atlas.toolWebhookDispatcher.getRecentHistory();

    const eventOptions = EVENT_VALUES.map(eventName => {
      const checked = selectedEvents.has(eventName) ? 'checked' : '';
      return `<label><input type="checkbox" data-event="${eventName}" ${checked}> ${eventName}</label>`;
    }).join('');

    const historyRows = history.length === 0
      ? '<tr><td colspan="4">No deliveries yet.</td></tr>'
      : history.slice(0, 20).map(item => {
        const status = item.ok ? 'ok' : 'failed';
        const code = item.statusCode ? String(item.statusCode) : '-';
        const error = item.error ? escapeHtml(item.error) : '-';
        const search = escapeHtml([item.timestamp, item.event, status, code, error].join(' ').toLowerCase());
        return `<tr data-history-search="${search}"><td>${escapeHtml(item.timestamp)}</td><td>${escapeHtml(item.event)}</td><td>${status} (${code})</td><td>${error}</td></tr>`;
      }).join('');

    return getWebviewHtmlShell({
      title: 'Tool Webhooks',
      cspSource: this.panel.webview.cspSource,
      bodyContent:
      `
      <div class="panel-hero">
        <div>
          <p class="eyebrow">Outbound delivery</p>
          <h1>Tool Webhooks</h1>
          <p class="hero-copy">Control webhook delivery, authentication, and recent delivery history without scanning one long operational form.</p>
        </div>
        <div class="hero-badges" aria-label="Webhook summary">
          <button type="button" class="hero-badge hero-badge-button" data-hero-page-target="delivery" title="Open webhook delivery controls.">${enabled ? 'enabled' : 'disabled'}</button>
          <button type="button" class="hero-badge hero-badge-button" data-hero-page-target="delivery" title="Open token and authentication controls.">${hasToken ? 'token configured' : 'no token'}</button>
          <button type="button" class="hero-badge hero-badge-button" data-hero-page-target="delivery" title="Open delivery policy and approval details.">${workspaceApproved ? 'workspace approved' : 'approval required'}</button>
        </div>
      </div>

      <div class="search-shell">
        <label class="search-label" for="webhookSearch">Search webhooks</label>
        <input id="webhookSearch" type="search" placeholder="Search pages, events, or delivery history" />
        <p id="webhookSearchStatus" class="search-status" aria-live="polite">Browse by page or search webhook events and history.</p>
      </div>

      <div class="panel-layout">
        <nav class="panel-nav" aria-label="Tool webhook sections" role="tablist" aria-orientation="vertical">
          <button type="button" class="nav-link active" data-page-target="overview" data-search="overview webhook safety settings token approval send test refresh">Overview</button>
          <button type="button" class="nav-link" data-page-target="delivery" data-search="delivery url timeout enabled events authentication bearer token workspace approval">Delivery</button>
          <button type="button" class="nav-link" data-page-target="history" data-search="history recent deliveries tool.started tool.completed tool.failed tool.test errors">History</button>
        </nav>

        <main class="panel-main">
          <section id="page-overview" class="panel-page active">
            <div class="page-header">
              <p class="page-kicker">Overview</p>
              <h2>Webhook workspace</h2>
              <p>Quickly test delivery, clear history, or jump into the AtlasMind safety settings page that governs adjacent policy behavior.</p>
            </div>
            <div class="action-grid">
              <button type="button" id="sendTest" class="action-card action-primary">
                <span class="action-title">Send Test Event</span>
                <span class="action-copy">Trigger a synthetic delivery through the current webhook configuration.</span>
              </button>
              <button type="button" id="open-settings-safety" class="action-card">
                <span class="action-title">Open Safety Settings</span>
                <span class="action-copy">Jump directly to the AtlasMind safety settings page from the webhook workspace.</span>
              </button>
              <button type="button" id="clearHistory" class="action-card">
                <span class="action-title">Clear Delivery History</span>
                <span class="action-copy">Wipe the recent-delivery log to isolate new webhook test runs.</span>
              </button>
            </div>
            <div class="summary-grid">
              <article class="summary-card">
                <p class="card-kicker">Delivery</p>
                <h3>${enabled ? 'On' : 'Off'}</h3>
                <p>Webhook dispatch for Atlas tool events.</p>
              </article>
              <article class="summary-card">
                <p class="card-kicker">Approval</p>
                <h3>${workspaceApproved ? 'Granted' : 'Pending'}</h3>
                <p>Workspace-level outbound approval state.</p>
              </article>
              <article class="summary-card">
                <p class="card-kicker">History</p>
                <h3>${history.length}</h3>
                <p>Recent deliveries currently retained by the dispatcher.</p>
              </article>
            </div>
          </section>

          <section id="page-delivery" class="panel-page" hidden>
            <div class="page-header">
              <p class="page-kicker">Delivery</p>
              <h2>Endpoint and authentication</h2>
              <p>Configure delivery behavior, event selection, and the stored bearer token used for outbound authentication.</p>
            </div>

            <section class="content-card">
              <div class="field-grid">
                <label for="enabled">Enabled</label>
                <input id="enabled" type="checkbox" ${enabled ? 'checked' : ''} />

                <label for="url">Webhook URL</label>
                <div>
                  <input id="url" type="text" value="${url}" placeholder="https://example.com/atlas/tool-webhook" />
                  <div class="hint ${urlValid ? 'hint-ok' : 'hint-error'}">${urlValid ? 'Valid endpoint format.' : 'URL must start with http:// or https:// and include a hostname.'}</div>
                </div>

                <label for="timeoutMs">Timeout (ms)</label>
                <input id="timeoutMs" type="number" min="1000" step="500" value="${timeoutMs}" />
              </div>
            </section>

            <section class="content-card">
              <h3>Events</h3>
              <div class="event-grid">
                ${eventOptions}
              </div>
            </section>

            <section class="content-card">
              <h3>Authentication</h3>
              <p>Bearer token is stored in VS Code SecretStorage (${hasToken ? 'configured' : 'not configured'}).</p>
              <p>Workspace approval for outbound delivery: <strong>${workspaceApproved ? 'granted' : 'not granted'}</strong>.</p>
              <div class="button-row">
                <button type="button" id="setToken">Set / Update Token</button>
                <button type="button" id="clearToken">Clear Token</button>
                <button type="button" id="refresh">Refresh</button>
              </div>
            </section>
          </section>

          <section id="page-history" class="panel-page" hidden>
            <div class="page-header">
              <p class="page-kicker">History</p>
              <h2>Recent deliveries</h2>
              <p>Search recent delivery attempts by event name, timestamp, status, or captured error string.</p>
            </div>
            <section class="content-card">
              <table>
                <thead>
                  <tr><th>Timestamp</th><th>Event</th><th>Status</th><th>Error</th></tr>
                </thead>
                <tbody>
                  ${historyRows}
                </tbody>
              </table>
            </section>
          </section>
        </main>
      </div>
      `,
      extraCss:
      `
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
        .action-card, .summary-card, .content-card { border: 1px solid var(--atlas-border); border-radius: 16px; padding: 16px; background: linear-gradient(180deg, var(--atlas-surface), var(--vscode-editor-background)); }
        .action-card { display: flex; flex-direction: column; gap: 6px; text-align: left; }
        .action-primary { border-color: color-mix(in srgb, var(--atlas-accent) 42%, var(--atlas-border)); }
        .action-title { font-weight: 700; }
        .summary-card h3 { margin: 0; font-size: 1.8rem; }
        .field-grid {
          display: grid;
          grid-template-columns: minmax(180px, 260px) minmax(320px, 1fr);
          gap: 10px 14px;
          align-items: center;
          margin-top: 8px;
        }
        .field-grid input[type="text"],
        .field-grid input[type="number"] {
          width: 100%;
          box-sizing: border-box;
          color: var(--vscode-input-foreground);
          background: var(--vscode-input-background);
          border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #444));
          padding: 8px 10px;
          border-radius: 10px;
        }
        .hint {
          margin-top: 4px;
          font-size: 0.85em;
        }
        .hint-ok {
          color: var(--vscode-descriptionForeground);
        }
        .hint-error {
          color: var(--vscode-errorForeground);
        }
        .event-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 8px;
          margin-top: 8px;
        }
        .event-grid label {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .button-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        tr[data-history-search].hidden-by-search { display: none; }
        .nav-link:hover, .nav-link:focus-visible, .action-card:hover, .action-card:focus-visible, .button-row button:focus-visible { outline: 2px solid var(--atlas-accent); outline-offset: 2px; }
        @media (max-width: 920px) {
          .panel-layout, .action-grid, .summary-grid { grid-template-columns: 1fr; }
          .panel-nav { position: static; }
          .panel-hero { flex-direction: column; }
        }
        @media (max-width: 720px) {
          .field-grid { grid-template-columns: 1fr; }
        }
      `,
      scriptContent:
      `
        const vscode = acquireVsCodeApi();

        const navButtons = Array.from(document.querySelectorAll('[data-page-target]'));
        const pages = Array.from(document.querySelectorAll('.panel-page'));
        const searchInput = document.getElementById('webhookSearch');
        const searchStatus = document.getElementById('webhookSearchStatus');
        const historyRows = Array.from(document.querySelectorAll('tr[data-history-search]'));

        function activatePage(pageId) {
          navButtons.forEach(button => {
            if (!(button instanceof HTMLButtonElement)) {
              return;
            }
            const isActive = button.dataset.pageTarget === pageId;
            button.classList.toggle('active', isActive);
          });
          pages.forEach(page => {
            if (!(page instanceof HTMLElement)) {
              return;
            }
            const isActive = page.id === 'page-' + pageId;
            page.classList.toggle('active', isActive);
            page.hidden = !isActive;
          });
        }

        function updateSearch(query) {
          const normalized = typeof query === 'string' ? query.trim().toLowerCase() : '';
          let visibleHistory = 0;
          navButtons.forEach(button => {
            if (!(button instanceof HTMLButtonElement)) {
              return;
            }
            const haystack = ((button.textContent ?? '') + ' ' + (button.dataset.search ?? '')).toLowerCase();
            const matches = normalized.length === 0 || haystack.includes(normalized);
            button.classList.toggle('hidden-by-search', !matches);
          });
          historyRows.forEach(row => {
            if (!(row instanceof HTMLElement)) {
              return;
            }
            const haystack = (row.dataset.historySearch ?? '').toLowerCase();
            const matches = normalized.length === 0 || haystack.includes(normalized);
            row.classList.toggle('hidden-by-search', !matches);
            if (matches) {
              visibleHistory += 1;
            }
          });
          if (searchStatus instanceof HTMLElement) {
            if (normalized.length === 0) {
              searchStatus.textContent = 'Browse by page or search webhook events and history.';
            } else if (visibleHistory === 0) {
              searchStatus.textContent = 'No webhook history rows matched that search.';
            } else if (visibleHistory === 1) {
              searchStatus.textContent = '1 webhook history row matched.';
            } else {
              searchStatus.textContent = visibleHistory + ' webhook history rows matched.';
            }
          }
        }

        navButtons.forEach(button => {
          if (!(button instanceof HTMLButtonElement)) {
            return;
          }
          button.addEventListener('click', () => {
            activatePage(button.dataset.pageTarget ?? 'overview');
          });
        });

        document.querySelectorAll('[data-hero-page-target]').forEach(button => {
          if (!(button instanceof HTMLButtonElement)) {
            return;
          }
          button.addEventListener('click', () => activatePage(button.dataset.heroPageTarget ?? 'delivery'));
        });

        activatePage('overview');
        if (searchInput instanceof HTMLInputElement) {
          updateSearch(searchInput.value);
          searchInput.addEventListener('input', () => updateSearch(searchInput.value));
        }

        const enabled = document.getElementById('enabled');
        if (enabled instanceof HTMLInputElement) {
          enabled.addEventListener('change', () => {
            vscode.postMessage({ type: 'setEnabled', payload: enabled.checked });
          });
        }

        const url = document.getElementById('url');
        if (url instanceof HTMLInputElement) {
          const send = () => {
            const value = url.value.trim();
            vscode.postMessage({ type: 'setUrl', payload: value });
          };
          url.addEventListener('change', send);
          url.addEventListener('blur', send);
        }

        const timeout = document.getElementById('timeoutMs');
        if (timeout instanceof HTMLInputElement) {
          const send = () => {
            const value = Number.parseInt(timeout.value, 10);
            if (!Number.isFinite(value) || value < 1000) {
              return;
            }
            vscode.postMessage({ type: 'setTimeoutMs', payload: value });
          };
          timeout.addEventListener('change', send);
          timeout.addEventListener('blur', send);
        }

        const emitEvents = () => {
          const selected = Array.from(document.querySelectorAll('input[data-event]:checked'))
            .map(element => element.getAttribute('data-event'))
            .filter(value => typeof value === 'string');
          vscode.postMessage({ type: 'setEvents', payload: selected });
        };

        document.querySelectorAll('input[data-event]').forEach(element => {
          element.addEventListener('change', emitEvents);
        });

        const setToken = document.getElementById('setToken');
        if (setToken) {
          setToken.addEventListener('click', async () => {
            const value = window.prompt('Enter bearer token for webhook authentication. Leave blank to cancel.', '');
            if (value === null) {
              return;
            }
            vscode.postMessage({ type: 'setToken', payload: value });
          });
        }

        const clearToken = document.getElementById('clearToken');
        if (clearToken) {
          clearToken.addEventListener('click', () => {
            vscode.postMessage({ type: 'clearToken' });
          });
        }

        const sendTest = document.getElementById('sendTest');
        if (sendTest) {
          sendTest.addEventListener('click', () => {
            vscode.postMessage({ type: 'sendTest' });
          });
        }

        const clearHistory = document.getElementById('clearHistory');
        if (clearHistory) {
          clearHistory.addEventListener('click', () => {
            vscode.postMessage({ type: 'clearHistory' });
          });
        }

        const refresh = document.getElementById('refresh');
        if (refresh) {
          refresh.addEventListener('click', () => {
            vscode.postMessage({ type: 'refresh' });
          });
        }

        const openSettingsSafety = document.getElementById('open-settings-safety');
        if (openSettingsSafety) {
          openSettingsSafety.addEventListener('click', () => {
            vscode.postMessage({ type: 'openSettingsSafety' });
          });
        }
      `,
    });
  }
}

function getTimeoutMs(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1000) {
    return 5000;
  }
  return Math.floor(value);
}

function isValidWebhookUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isToolWebhookMessage(value: unknown): value is ToolWebhookMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }

  const message = value as { type?: unknown; payload?: unknown };

  if (message.type === 'setEnabled') {
    return typeof message.payload === 'boolean';
  }

  if (message.type === 'setUrl' || message.type === 'setToken') {
    return typeof message.payload === 'string';
  }

  if (message.type === 'setTimeoutMs') {
    return typeof message.payload === 'number' && Number.isFinite(message.payload) && message.payload >= 1000;
  }

  if (message.type === 'setEvents') {
    return Array.isArray(message.payload)
      && message.payload.every(event => typeof event === 'string' && EVENT_VALUES.includes(event as ToolWebhookEventName));
  }

  return (
    message.type === 'clearToken'
    || message.type === 'sendTest'
    || message.type === 'clearHistory'
    || message.type === 'refresh'
    || message.type === 'openSettingsSafety'
  );
}
