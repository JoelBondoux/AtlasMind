import * as vscode from 'vscode';
import { escapeHtml, getWebviewHtmlShell } from './webviewUtils.js';
import type { CostTracker } from '../core/costTracker.js';
import type { CostRecord } from '../types.js';

type CostDashboardMessage =
  | { type: 'resetHistory' }
  | { type: 'openSettings' };

function isCostDashboardMessage(value: unknown): value is CostDashboardMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) { return false; }
  const m = value as Record<string, unknown>;
  return m['type'] === 'resetHistory' || m['type'] === 'openSettings';
}

/**
 * Cost Management Dashboard — shows per-session and per-day spend, model
 * breakdown, and daily budget utilisation charts.
 *
 * Security:
 * - All dynamic content is escaped through escapeHtml() before injection.
 * - Webview messages are validated by isCostDashboardMessage() before acting.
 * - CSP is nonce-protected via getWebviewHtmlShell().
 */
export class CostDashboardPanel {
  public static currentPanel: CostDashboardPanel | undefined;
  private static readonly viewType = 'atlasmind.costDashboard';

  private readonly panel: vscode.WebviewPanel;
  private readonly costTracker: CostTracker;
  private readonly disposables: vscode.Disposable[] = [];

  public static createOrShow(
    context: vscode.ExtensionContext,
    costTracker: CostTracker,
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (CostDashboardPanel.currentPanel) {
      CostDashboardPanel.currentPanel.panel.reveal(column);
      void CostDashboardPanel.currentPanel.refresh(costTracker);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      CostDashboardPanel.viewType,
      'AtlasMind – Cost Dashboard',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );

    CostDashboardPanel.currentPanel = new CostDashboardPanel(panel, costTracker);
  }

  private constructor(panel: vscode.WebviewPanel, costTracker: CostTracker) {
    this.panel = panel;
    this.costTracker = costTracker;

    this.panel.webview.html = this.buildHtml(costTracker);

    this.panel.webview.onDidReceiveMessage(
      (raw: unknown) => {
        if (!isCostDashboardMessage(raw)) { return; }
        if (raw.type === 'resetHistory') {
          costTracker.reset();
          this.panel.webview.html = this.buildHtml(costTracker);
        }
        if (raw.type === 'openSettings') {
          void vscode.commands.executeCommand('atlasmind.openSettings');
        }
      },
      null,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  public async refresh(costTracker: CostTracker): Promise<void> {
    this.panel.webview.html = this.buildHtml(costTracker);
  }

  public dispose(): void {
    CostDashboardPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) { d.dispose(); }
  }

  // ── HTML building ────────────────────────────────────────────────────────

  private buildHtml(costTracker: CostTracker): string {
    const cspSource = this.panel.webview.cspSource;
    const summary = costTracker.getSummary();
    const records = [...costTracker.getRecords()].reverse().slice(0, 100);
    const budget = costTracker.getDailyBudgetStatus();
    const dailyData = this.buildDailyData(costTracker.getRecords());

    const summaryCards = this.buildSummaryCards(summary, budget);
    const dailyChart = this.buildDailyBarChart(dailyData);
    const modelBreakdown = this.buildModelBreakdown(costTracker.getRecords());
    const recentTable = this.buildRecentTable(records);

    const bodyContent = `
      <div class="dashboard-header">
        <h1>Cost Dashboard</h1>
        <div class="header-actions">
          <button type="button" id="cost-dashboard-open-settings">⚙ Budget Settings</button>
          <button type="button" id="cost-dashboard-reset-history" class="danger-btn">🗑 Reset History</button>
        </div>
      </div>

      <section class="cards-grid">
        ${summaryCards}
      </section>

      ${budget ? `<section class="budget-bar-section">
        <h2>Today's Budget</h2>
        ${this.buildBudgetBar(budget)}
      </section>` : ''}

      <section>
        <h2>Daily Spend (last 14 days)</h2>
        ${dailyChart}
      </section>

      <section>
        <h2>Cost by Model</h2>
        ${modelBreakdown}
      </section>

      <section>
        <h2>Recent Requests</h2>
        ${recentTable}
      </section>
    `;

    const scriptContent = `
      const vscode = acquireVsCodeApi();
      function postMsg(type) { vscode.postMessage({ type }); }

      document.getElementById('cost-dashboard-open-settings')
        ?.addEventListener('click', () => postMsg('openSettings'));

      document.getElementById('cost-dashboard-reset-history')
        ?.addEventListener('click', () => {
          if (confirm('Clear all cost history? This cannot be undone.')) {
            postMsg('resetHistory');
          }
        });
    `;

    return getWebviewHtmlShell({
      title: 'Cost Dashboard',
      cspSource,
      bodyContent,
      scriptContent,
      extraCss: `
        .dashboard-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1em; }
        .header-actions { display: flex; gap: 8px; }
        .danger-btn { background: var(--vscode-inputValidation-errorBackground, #8B0000); }
        .cards-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 1.5em; }
        .card { padding: 12px 16px; background: var(--vscode-sideBar-background, #252526); border-radius: 4px; }
        .card-label { font-size: 0.78em; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.05em; }
        .card-value { font-size: 1.5em; font-weight: 700; margin-top: 2px; }
        .card-value.warning { color: var(--vscode-notificationsWarningIcon-foreground, orange); }
        .card-value.ok { color: var(--vscode-notificationsInfoIcon-foreground, #4ec9b0); }
        .budget-bar-outer { height: 16px; background: var(--vscode-widget-border, #444); border-radius: 8px; overflow: hidden; margin-top: 4px; }
        .budget-bar-inner { height: 100%; border-radius: 8px; transition: width 0.3s; }
        .budget-bar-inner.safe { background: #4ec9b0; }
        .budget-bar-inner.warn { background: orange; }
        .budget-bar-inner.over { background: #f44747; }
        .bar-chart { display: flex; align-items: flex-end; gap: 4px; height: 80px; margin-top: 8px; }
        .bar-col { display: flex; flex-direction: column; align-items: center; flex: 1; }
        .bar-rect { width: 100%; background: var(--vscode-button-background); border-radius: 2px 2px 0 0; min-height: 2px; }
        .bar-label { font-size: 0.65em; margin-top: 2px; opacity: 0.7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 48px; }
        .model-row { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
        .model-bar { height: 10px; background: var(--vscode-button-background); border-radius: 2px; }
        .model-label { font-size: 0.8em; min-width: 160px; }
        .model-cost { font-size: 0.8em; opacity: 0.8; margin-left: auto; }
        .recent-table td.cost { text-align: right; font-family: monospace; }
        .recent-table td.tokens { text-align: right; font-family: monospace; font-size: 0.85em; opacity: 0.8; }
      `,
    });
  }

  private buildSummaryCards(
    summary: ReturnType<CostTracker['getSummary']>,
    budget: ReturnType<CostTracker['getDailyBudgetStatus']>,
  ): string {
    const todayCostUsd = budget?.todayCostUsd ?? 0;
    const pct = budget ? Math.min(100, (budget.todayCostUsd / budget.limitUsd) * 100) : 0;
    const budgetClass = budget ? (pct >= 100 ? 'warning' : pct >= 80 ? 'warning' : 'ok') : '';

    const cards = [
      { label: 'Total Spend', value: `$${summary.totalCostUsd.toFixed(4)}` },
      { label: 'Total Requests', value: String(summary.totalRequests) },
      { label: 'Input Tokens', value: formatTokens(summary.totalInputTokens) },
      { label: 'Output Tokens', value: formatTokens(summary.totalOutputTokens) },
      { label: "Today's Spend", value: `$${todayCostUsd.toFixed(4)}`, cls: budgetClass },
    ];

    if (budget) {
      cards.push({ label: 'Daily Limit', value: `$${budget.limitUsd.toFixed(2)}` });
    }

    return cards.map(card => `
      <div class="card">
        <div class="card-label">${escapeHtml(card.label)}</div>
        <div class="card-value ${escapeHtml(card.cls ?? '')}">${escapeHtml(card.value)}</div>
      </div>
    `).join('');
  }

  private buildBudgetBar(budget: NonNullable<ReturnType<CostTracker['getDailyBudgetStatus']>>): string {
    const pct = Math.min(100, (budget.todayCostUsd / budget.limitUsd) * 100);
    const cls = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'safe';
    const label = budget.blocked ? '⛔ Daily limit reached' : `$${budget.remainingUsd.toFixed(4)} remaining of $${budget.limitUsd.toFixed(2)}`;
    return `
      <div class="budget-bar-outer">
        <div class="budget-bar-inner ${escapeHtml(cls)}" style="width:${pct.toFixed(1)}%"></div>
      </div>
      <p style="font-size:0.8em;margin-top:4px">${escapeHtml(label)}</p>
    `;
  }

  private buildDailyData(records: readonly CostRecord[]): Array<{ date: string; costUsd: number }> {
    const today = new Date();
    const days: Array<{ date: string; costUsd: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      days.push({ date: d.toISOString().slice(0, 10), costUsd: 0 });
    }
    for (const r of records) {
      const day = r.timestamp.slice(0, 10);
      const entry = days.find(d => d.date === day);
      if (entry) { entry.costUsd += r.costUsd; }
    }
    return days;
  }

  private buildDailyBarChart(days: Array<{ date: string; costUsd: number }>): string {
    if (days.every(d => d.costUsd === 0)) {
      return '<p style="opacity:0.6">No spend data yet.</p>';
    }
    const max = Math.max(...days.map(d => d.costUsd), 0.0001);
    const bars = days.map(d => {
      const heightPct = (d.costUsd / max) * 100;
      const label = d.date.slice(5); // MM-DD
      const title = `${d.date}: $${d.costUsd.toFixed(4)}`;
      return `
        <div class="bar-col" title="${escapeHtml(title)}">
          <div class="bar-rect" style="height:${heightPct.toFixed(1)}%"></div>
          <div class="bar-label">${escapeHtml(label)}</div>
        </div>
      `;
    }).join('');
    return `<div class="bar-chart">${bars}</div>`;
  }

  private buildModelBreakdown(records: readonly CostRecord[]): string {
    const byModel = new Map<string, { costUsd: number; requests: number }>();
    for (const r of records) {
      const entry = byModel.get(r.model) ?? { costUsd: 0, requests: 0 };
      entry.costUsd += r.costUsd;
      entry.requests += 1;
      byModel.set(r.model, entry);
    }
    if (byModel.size === 0) {
      return '<p style="opacity:0.6">No model usage data yet.</p>';
    }
    const sorted = [...byModel.entries()].sort((a, b) => b[1].costUsd - a[1].costUsd);
    const maxCost = sorted[0]?.[1]?.costUsd ?? 0.0001;
    return sorted.map(([model, data]) => {
      const barWidth = Math.max(2, (data.costUsd / maxCost) * 200);
      return `
        <div class="model-row">
          <span class="model-label">${escapeHtml(model)}</span>
          <div class="model-bar" style="width:${barWidth.toFixed(0)}px"></div>
          <span class="model-cost">$${data.costUsd.toFixed(4)} (${data.requests} req)</span>
        </div>
      `;
    }).join('');
  }

  private buildRecentTable(records: CostRecord[]): string {
    if (records.length === 0) {
      return '<p style="opacity:0.6">No requests recorded yet.</p>';
    }
    const rows = records.map(r => `
      <tr>
        <td>${escapeHtml(r.timestamp.replace('T', ' ').slice(0, 19))}</td>
        <td>${escapeHtml(r.model)}</td>
        <td>${escapeHtml(r.agentId)}</td>
        <td class="tokens">${formatTokens(r.inputTokens)} / ${formatTokens(r.outputTokens)}</td>
        <td class="cost">$${r.costUsd.toFixed(4)}</td>
      </tr>
    `).join('');
    return `
      <table class="recent-table">
        <thead>
          <tr><th>Time</th><th>Model</th><th>Agent</th><th>In / Out tokens</th><th>Cost</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) { return `${(n / 1_000_000).toFixed(1)}M`; }
  if (n >= 1_000) { return `${(n / 1_000).toFixed(1)}K`; }
  return String(n);
}
