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
  | { type: 'refresh' };

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
        return `<tr><td>${escapeHtml(item.timestamp)}</td><td>${escapeHtml(item.event)}</td><td>${status} (${code})</td><td>${error}</td></tr>`;
      }).join('');

    return getWebviewHtmlShell({
      title: 'Tool Webhooks',
      cspSource: this.panel.webview.cspSource,
      bodyContent:
      `
      <h1>Tool Webhooks</h1>
      <p>Send outbound webhooks when Atlas tools start, succeed, or fail.</p>

      <section>
        <h2>Delivery Settings</h2>
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

      <section>
        <h2>Events</h2>
        <div class="event-grid">
          ${eventOptions}
        </div>
      </section>

      <section>
        <h2>Authentication</h2>
        <p>Bearer token is stored in VS Code SecretStorage (${hasToken ? 'configured' : 'not configured'}).</p>
        <p>Workspace approval for outbound delivery: <strong>${workspaceApproved ? 'granted' : 'not granted'}</strong>.</p>
        <div class="button-row">
          <button type="button" id="setToken">Set / Update Token</button>
          <button type="button" id="clearToken">Clear Token</button>
        </div>
      </section>

      <section>
        <h2>Actions</h2>
        <div class="button-row">
          <button type="button" id="sendTest">Send Test Event</button>
          <button type="button" id="refresh">Refresh</button>
          <button type="button" id="clearHistory">Clear History</button>
        </div>
      </section>

      <section>
        <h2>Recent Deliveries</h2>
        <table>
          <thead>
            <tr><th>Timestamp</th><th>Event</th><th>Status</th><th>Error</th></tr>
          </thead>
          <tbody>
            ${historyRows}
          </tbody>
        </table>
      </section>
      `,
      extraCss:
      `
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
          padding: 6px 8px;
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
      `,
      scriptContent:
      `
        const vscode = acquireVsCodeApi();

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
  );
}
