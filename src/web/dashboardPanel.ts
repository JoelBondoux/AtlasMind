// Read-only cost & project-run dashboard for the web build. Fetches data from the
// desktop over the cost/runs RPC channels and renders a static webview. No mutation
// paths are exposed. See docs/remote-control.md.
import * as vscode from 'vscode';
import { getWebviewHtmlShell, escapeHtml } from '../views/webviewUtils.js';
import type { RemoteClient } from './remoteClient.js';
import type { RemoteCostSnapshot, RemoteRunsList, RemoteRunSummary } from '../remote/protocol.js';

const REFRESH_SCRIPT = `
  const vscode = acquireVsCodeApi();
  const btn = document.getElementById('refresh');
  if (btn) { btn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' })); }
`;

function formatUsd(value: number): string {
  return `$${(value ?? 0).toFixed(value >= 1 ? 2 : 4)}`;
}

function renderRunsRows(runs: RemoteRunSummary[]): string {
  if (runs.length === 0) {
    return '<tr><td colspan="4" class="muted">No project runs recorded.</td></tr>';
  }
  return runs.map(run => `
    <tr>
      <td>${escapeHtml(run.title)}</td>
      <td><span class="badge">${escapeHtml(run.status)}</span></td>
      <td>${run.completedSubtaskCount}/${run.totalSubtaskCount}</td>
      <td class="muted">${escapeHtml(new Date(run.updatedAt).toLocaleString())}</td>
    </tr>`).join('');
}

function renderHtml(
  cspSource: string,
  cost: RemoteCostSnapshot | undefined,
  runs: RemoteRunsList | undefined,
  error?: string,
): string {
  const summary = cost?.summary;
  const body = `
    <header class="dash-header">
      <h1>AtlasMind — Remote Dashboard</h1>
      <button id="refresh" type="button">Refresh</button>
    </header>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
    <section>
      <h2>Cost</h2>
      ${summary ? `
        <div class="cards">
          <div class="card"><div class="card-label">Total</div><div class="card-value">${formatUsd(summary.totalCostUsd)}</div></div>
          <div class="card"><div class="card-label">Today</div><div class="card-value">${formatUsd(cost!.todayCostUsd)}</div></div>
          <div class="card"><div class="card-label">Billable</div><div class="card-value">${formatUsd(summary.totalBudgetCostUsd)}</div></div>
          <div class="card"><div class="card-label">Compression saved</div><div class="card-value">${formatUsd(summary.totalCompressionSavingsUsd)}</div></div>
          <div class="card"><div class="card-label">Requests</div><div class="card-value">${summary.totalRequests}</div></div>
          <div class="card"><div class="card-label">Tokens (in/out)</div><div class="card-value">${summary.totalInputTokens} / ${summary.totalOutputTokens}</div></div>
        </div>` : '<p class="muted">Cost data unavailable.</p>'}
    </section>
    <section>
      <h2>Project Runs</h2>
      <table>
        <thead><tr><th>Run</th><th>Status</th><th>Subtasks</th><th>Updated</th></tr></thead>
        <tbody>${renderRunsRows(runs?.runs ?? [])}</tbody>
      </table>
    </section>`;

  const extraCss = `
    .dash-header { display: flex; align-items: center; justify-content: space-between; }
    .cards { display: flex; flex-wrap: wrap; gap: 12px; margin: 12px 0; }
    .card { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border, transparent); border-radius: 6px; padding: 10px 14px; min-width: 120px; }
    .card-label { font-size: 0.8em; opacity: 0.75; }
    .card-value { font-size: 1.3em; font-weight: 600; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2)); }
    .muted { opacity: 0.7; }
    .error { color: var(--vscode-errorForeground); }
  `;

  return getWebviewHtmlShell({
    title: 'AtlasMind Remote Dashboard',
    cspSource,
    bodyContent: body,
    extraCss,
    scriptContent: REFRESH_SCRIPT,
  });
}

export class DashboardPanel {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly client: RemoteClient) {}

  async reveal(): Promise<void> {
    if (this.panel) {
      this.panel.reveal();
      await this.refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'atlasmind.remoteDashboard',
      'AtlasMind Remote Dashboard',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel = panel;
    this.disposables.push(
      panel.webview.onDidReceiveMessage(message => {
        if (message && (message as { type?: unknown }).type === 'refresh') {
          void this.refresh();
        }
      }),
    );
    panel.onDidDispose(() => {
      for (const d of this.disposables.splice(0)) {
        d.dispose();
      }
      this.panel = undefined;
    });
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    if (!this.panel) {
      return;
    }
    const cspSource = this.panel.webview.cspSource;
    if (this.client.getState() !== 'connected') {
      this.panel.webview.html = renderHtml(cspSource, undefined, undefined, 'Not connected to a desktop instance.');
      return;
    }
    try {
      const [cost, runs] = await Promise.all([
        this.client.requestRpc('cost', 'cost.snapshot') as Promise<RemoteCostSnapshot>,
        this.client.requestRpc('runs', 'runs.list', { limit: 20 }) as Promise<RemoteRunsList>,
      ]);
      this.panel.webview.html = renderHtml(cspSource, cost, runs);
    } catch (err) {
      this.panel.webview.html = renderHtml(cspSource, undefined, undefined, err instanceof Error ? err.message : 'Failed to load dashboard data.');
    }
  }

  dispose(): void {
    for (const d of this.disposables.splice(0)) {
      d.dispose();
    }
    this.panel?.dispose();
    this.panel = undefined;
  }
}
