import * as vscode from 'vscode';
import { escapeHtml, getWebviewHtmlShell } from './webviewUtils.js';
import type { SessionConversation } from '../chat/sessionConversation.js';
import type { CostTracker } from '../core/costTracker.js';
import type { CostRecord } from '../types.js';

type CostDashboardMessage =
  | { type: 'resetHistory' }
  | { type: 'openSettings' }
  | { type: 'setTimescaleDays'; value: number }
  | { type: 'setExcludeSubscriptionIncluded'; value: boolean }
  | { type: 'openChatMessage'; sessionId: string; messageId: string };

export function isCostDashboardMessage(value: unknown): value is CostDashboardMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) { return false; }
  const m = value as Record<string, unknown>;
  if (m['type'] === 'resetHistory' || m['type'] === 'openSettings') {
    return true;
  }
  if (m['type'] === 'setTimescaleDays') {
    return typeof m['value'] === 'number' && Number.isFinite(m['value']) && m['value'] >= 1;
  }
  if (m['type'] === 'setExcludeSubscriptionIncluded') {
    return typeof m['value'] === 'boolean';
  }
  if (m['type'] === 'openChatMessage') {
    return typeof m['sessionId'] === 'string' && m['sessionId'].length > 0
      && typeof m['messageId'] === 'string' && m['messageId'].length > 0;
  }
  return false;
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
  private readonly sessionConversation: Pick<SessionConversation, 'getTranscript' | 'getModelFeedbackSummary'>;
  private readonly disposables: vscode.Disposable[] = [];
  private timescaleDays = 14;
  private excludeSubscriptionIncluded = false;

  public static createOrShow(
    context: vscode.ExtensionContext,
    costTracker: CostTracker,
    sessionConversation: Pick<SessionConversation, 'getTranscript' | 'getModelFeedbackSummary'>,
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

    CostDashboardPanel.currentPanel = new CostDashboardPanel(panel, costTracker, sessionConversation);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    costTracker: CostTracker,
    sessionConversation: Pick<SessionConversation, 'getTranscript' | 'getModelFeedbackSummary'>,
  ) {
    this.panel = panel;
    this.costTracker = costTracker;
    this.sessionConversation = sessionConversation;

    this.panel.webview.html = this.buildHtml(costTracker);

    this.panel.webview.onDidReceiveMessage(
      (raw: unknown) => {
        if (!isCostDashboardMessage(raw)) { return; }
        if (raw.type === 'resetHistory') {
          costTracker.reset();
          this.panel.webview.html = this.buildHtml(costTracker);
        }
        if (raw.type === 'openSettings') {
          void vscode.commands.executeCommand('atlasmind.openSettings', {
            page: 'overview',
            query: 'budget daily cost',
          });
        }
        if (raw.type === 'setTimescaleDays') {
          this.timescaleDays = Math.max(1, Math.floor(raw.value));
          this.panel.webview.html = this.buildHtml(costTracker);
        }
        if (raw.type === 'setExcludeSubscriptionIncluded') {
          this.excludeSubscriptionIncluded = raw.value;
          this.panel.webview.html = this.buildHtml(costTracker);
        }
        if (raw.type === 'openChatMessage') {
          void vscode.commands.executeCommand('atlasmind.openChatPanel', {
            sessionId: raw.sessionId,
            messageId: raw.messageId,
          });
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
    const query = {
      days: this.timescaleDays,
      excludeSubscriptionIncluded: this.excludeSubscriptionIncluded,
    };
    const filteredRecords = costTracker.getRecords(query);
    const summary = costTracker.getSummary(query);
    const records = [...filteredRecords].reverse().slice(0, 100);
    const budget = costTracker.getDailyBudgetStatus();
    const dailyData = this.buildDailyData(filteredRecords, this.timescaleDays);
    const feedbackSummary = this.sessionConversation.getModelFeedbackSummary();
    const feedbackOverview = this.buildFeedbackOverview(filteredRecords, feedbackSummary);
    const feedbackWeight = getFeedbackRoutingWeight();

    const summaryCards = this.buildSummaryCards(summary, budget);
    const dailyChart = this.buildDailyBarChart(dailyData);
    const modelBreakdown = this.buildModelBreakdown(filteredRecords);
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

      <section class="cost-controls">
        <label class="control-field">
          <span>Timescale (days)</span>
          <input id="cost-dashboard-timescale" type="number" min="1" step="1" value="${escapeHtml(String(this.timescaleDays))}" />
        </label>
        <label class="toggle-field">
          <input id="cost-dashboard-exclude-subscriptions" type="checkbox" ${this.excludeSubscriptionIncluded ? 'checked' : ''} />
          <span>Exclude included subscription usage from charts and totals</span>
        </label>
      </section>

      ${budget ? `<section class="budget-bar-section">
        <h2>Today's Budgeted Spend</h2>
        ${this.buildBudgetBar(budget)}
      </section>` : ''}

      <section>
        <h2>Daily Spend (last ${escapeHtml(String(this.timescaleDays))} day${this.timescaleDays === 1 ? '' : 's'})</h2>
        ${dailyChart}
      </section>

      <section>
        <h2>Cost by Model</h2>
        ${modelBreakdown}
      </section>

      <section>
        <h2>Response Feedback by Model</h2>
        <p class="section-note">Thumbs feedback is stored per assistant response and nudges routing by model. Current routing weight: <strong>${escapeHtml(formatFeedbackWeightLabel(feedbackWeight))}</strong>.</p>
        ${feedbackOverview}
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

      document.getElementById('cost-dashboard-timescale')
        ?.addEventListener('change', (event) => {
          const target = event.target;
          const value = Number(target && typeof target === 'object' && 'value' in target ? target.value : 14);
          if (Number.isFinite(value) && value >= 1) {
            vscode.postMessage({ type: 'setTimescaleDays', value: Math.floor(value) });
          }
        });

      document.getElementById('cost-dashboard-exclude-subscriptions')
        ?.addEventListener('change', (event) => {
          const target = event.target;
          vscode.postMessage({
            type: 'setExcludeSubscriptionIncluded',
            value: Boolean(target && typeof target === 'object' && 'checked' in target ? target.checked : false),
          });
        });

      document.querySelectorAll('[data-cost-session-id][data-cost-message-id]')
        .forEach((element) => {
          element.addEventListener('click', () => {
            const sessionId = element.getAttribute('data-cost-session-id');
            const messageId = element.getAttribute('data-cost-message-id');
            if (sessionId && messageId) {
              vscode.postMessage({ type: 'openChatMessage', sessionId, messageId });
            }
          });
          element.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') {
              return;
            }
            event.preventDefault();
            const sessionId = element.getAttribute('data-cost-session-id');
            const messageId = element.getAttribute('data-cost-message-id');
            if (sessionId && messageId) {
              vscode.postMessage({ type: 'openChatMessage', sessionId, messageId });
            }
          });
        });

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
        .cost-controls { display: flex; flex-wrap: wrap; gap: 16px; align-items: end; margin-bottom: 1.5em; }
        .control-field { display: flex; flex-direction: column; gap: 6px; min-width: 160px; }
        .control-field input[type="number"] { max-width: 140px; }
        .toggle-field { display: inline-flex; align-items: center; gap: 8px; }
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
        .section-note { opacity: 0.82; margin: 0 0 10px; }
        .feedback-summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 1em; }
        .feedback-card { padding: 12px 16px; background: var(--vscode-sideBar-background, #252526); border-radius: 4px; }
        .feedback-table { width: 100%; border-collapse: collapse; }
        .feedback-table th, .feedback-table td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--vscode-widget-border, #444); }
        .feedback-table td.numeric { text-align: right; font-variant-numeric: tabular-nums; }
        .feedback-chip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--vscode-badge-background, #444) 70%, transparent); }
        .feedback-chip.up { color: var(--vscode-testing-iconPassed, #4ec9b0); }
        .feedback-chip.down { color: var(--vscode-testing-iconFailed, #f14c4c); }
        .feedback-chip.none { opacity: 0.7; }
        .recent-table td.cost { text-align: right; font-family: monospace; }
        .recent-table td.tokens { text-align: right; font-family: monospace; font-size: 0.85em; opacity: 0.8; }
        .recent-table td.billing { white-space: nowrap; }
        .recent-table td.feedback { white-space: nowrap; }
        .recent-row-link { cursor: pointer; }
        .recent-row-link:hover td { background: color-mix(in srgb, var(--vscode-list-hoverBackground, transparent) 90%, transparent); }
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
      { label: 'Budgeted Spend', value: `$${summary.totalBudgetCostUsd.toFixed(4)}` },
      { label: 'Included Subscriptions', value: `$${summary.totalSubscriptionIncludedUsd.toFixed(4)}` },
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

  private buildDailyData(records: readonly CostRecord[], daysToShow: number): Array<{ date: string; costUsd: number }> {
    const today = new Date();
    const days: Array<{ date: string; costUsd: number }> = [];
    for (let i = Math.max(0, daysToShow - 1); i >= 0; i--) {
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

  private buildFeedbackOverview(
    records: readonly CostRecord[],
    feedbackSummary: ReturnType<SessionConversation['getModelFeedbackSummary']>,
  ): string {
    const models = new Set<string>([
      ...Object.keys(feedbackSummary),
      ...records.map(record => record.model),
    ]);

    const feedbackRows = [...models]
      .map(modelId => {
        const votes = feedbackSummary[modelId] ?? { upVotes: 0, downVotes: 0 };
        const spend = records
          .filter(record => record.model === modelId)
          .reduce((total, record) => total + record.costUsd, 0);
        const requests = records.filter(record => record.model === modelId).length;
        return {
          modelId,
          upVotes: votes.upVotes,
          downVotes: votes.downVotes,
          totalVotes: votes.upVotes + votes.downVotes,
          approvalRate: getApprovalRate(votes.upVotes, votes.downVotes),
          spend,
          requests,
        };
      })
      .filter(row => row.totalVotes > 0)
      .sort((left, right) => {
        if (right.totalVotes !== left.totalVotes) {
          return right.totalVotes - left.totalVotes;
        }
        return right.spend - left.spend;
      });

    if (feedbackRows.length === 0) {
      return '<p style="opacity:0.6">No thumbs feedback has been recorded yet.</p>';
    }

    const totalUpVotes = feedbackRows.reduce((total, row) => total + row.upVotes, 0);
    const totalDownVotes = feedbackRows.reduce((total, row) => total + row.downVotes, 0);
    const totalVotes = totalUpVotes + totalDownVotes;
    const ratedSpend = feedbackRows.reduce((total, row) => total + row.spend, 0);
    const summaryCards = [
      { label: 'Rated Responses', value: String(totalVotes) },
      { label: 'Approval Rate', value: formatApprovalRate(getApprovalRate(totalUpVotes, totalDownVotes)) },
      { label: 'Thumbs Up', value: String(totalUpVotes) },
      { label: 'Filtered Spend On Rated Models', value: `$${ratedSpend.toFixed(4)}` },
    ].map(card => `
      <div class="feedback-card">
        <div class="card-label">${escapeHtml(card.label)}</div>
        <div class="card-value">${escapeHtml(card.value)}</div>
      </div>
    `).join('');

    const rows = feedbackRows.map(row => `
      <tr>
        <td>${escapeHtml(row.modelId)}</td>
        <td class="numeric">${escapeHtml(formatApprovalRate(row.approvalRate))}</td>
        <td class="numeric">${escapeHtml(String(row.upVotes))}</td>
        <td class="numeric">${escapeHtml(String(row.downVotes))}</td>
        <td class="numeric">${escapeHtml(String(row.requests))}</td>
        <td class="numeric">$${row.spend.toFixed(4)}</td>
      </tr>
    `).join('');

    return `
      <div class="feedback-summary-grid">${summaryCards}</div>
      <table class="feedback-table">
        <thead>
          <tr><th>Model</th><th>Approval</th><th>Up</th><th>Down</th><th>Filtered Requests</th><th>Filtered Spend</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  private buildRecentTable(records: CostRecord[]): string {
    if (records.length === 0) {
      return '<p style="opacity:0.6">No requests recorded yet.</p>';
    }
    const rows = records.map(r => `
      <tr${renderRecentRequestRowAttrs(r, this.sessionConversation)}>
        <td>${escapeHtml(r.timestamp.replace('T', ' ').slice(0, 19))}</td>
        <td>${escapeHtml(r.model)}</td>
        <td>${escapeHtml(r.providerId ?? inferProviderId(r.model))}</td>
        <td>${escapeHtml(r.agentId)}</td>
        <td class="billing">${escapeHtml(formatBillingCategory(r.billingCategory))}</td>
        <td class="feedback">${renderFeedbackChip(getRecentRequestFeedback(r, this.sessionConversation))}</td>
        <td class="tokens">${formatTokens(r.inputTokens)} / ${formatTokens(r.outputTokens)}</td>
        <td class="cost" title="Per-request message cost">${escapeHtml(formatRecentRequestCost(r))}</td>
      </tr>
    `).join('');
    return `
      <table class="recent-table">
        <thead>
          <tr><th>Time</th><th>Model</th><th>Provider</th><th>Agent</th><th>Billing</th><th>Feedback</th><th>In / Out tokens</th><th>Message Cost</th></tr>
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

function inferProviderId(modelId: string): string {
  const slashIndex = modelId.indexOf('/');
  return slashIndex > 0 ? modelId.slice(0, slashIndex) : 'unknown';
}

function formatBillingCategory(category: CostRecord['billingCategory']): string {
  switch (category) {
    case 'subscription-included':
      return 'Subscription';
    case 'subscription-overflow':
      return 'Overflow';
    case 'free':
      return 'Free';
    case 'pay-per-token':
    default:
      return 'Direct';
  }
}

function formatRecentRequestCost(record: CostRecord): string {
  return `$${record.costUsd.toFixed(4)}`;
}

function getApprovalRate(upVotes: number, downVotes: number): number {
  const totalVotes = upVotes + downVotes;
  if (totalVotes <= 0) {
    return 0;
  }
  return upVotes / totalVotes;
}

function formatApprovalRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function getFeedbackRoutingWeight(): number {
  const configured = vscode.workspace.getConfiguration('atlasmind').get<number>('feedbackRoutingWeight', 1);
  if (typeof configured !== 'number' || !Number.isFinite(configured)) {
    return 1;
  }
  return Math.max(0, Math.min(2, configured));
}

function formatFeedbackWeightLabel(weight: number): string {
  if (weight <= 0) {
    return 'Disabled';
  }
  return `${weight.toFixed(2)}x`;
}

function renderFeedbackChip(vote: 'up' | 'down' | undefined): string {
  if (vote === 'up') {
    return '<span class="feedback-chip up">👍 Up</span>';
  }
  if (vote === 'down') {
    return '<span class="feedback-chip down">👎 Down</span>';
  }
  return '<span class="feedback-chip none">No vote</span>';
}

function getRecentRequestFeedback(
  record: CostRecord,
  sessionConversation: Pick<SessionConversation, 'getTranscript'>,
): 'up' | 'down' | undefined {
  if (
    typeof record.sessionId !== 'string'
    || record.sessionId.length === 0
    || typeof record.messageId !== 'string'
    || record.messageId.length === 0
  ) {
    return undefined;
  }

  const entry = sessionConversation.getTranscript(record.sessionId).find(candidate => candidate.id === record.messageId);
  const vote = entry?.meta?.userVote;
  return vote === 'up' || vote === 'down' ? vote : undefined;
}

function renderRecentRequestRowAttrs(
  record: CostRecord,
  sessionConversation: Pick<SessionConversation, 'getTranscript'>,
): string {
  if (
    typeof record.sessionId === 'string'
    && record.sessionId.length > 0
    && typeof record.messageId === 'string'
    && record.messageId.length > 0
    && sessionConversation.getTranscript(record.sessionId).some(entry => entry.id === record.messageId)
  ) {
    return ` class="recent-row-link" title="Open this chat message" role="button" tabindex="0" data-cost-session-id="${escapeHtml(record.sessionId)}" data-cost-message-id="${escapeHtml(record.messageId)}"`;
  }
  return '';
}
