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
    const summaryCardCount = budget ? 8 : 7;
    const dailyChart = this.buildDailyBarChart(dailyData);
    const modelBreakdown = this.buildModelBreakdown(filteredRecords);
    const recentTable = this.buildRecentTable(records);
    const timescaleButtons = [7, 14, 30, 60].map(days => `
      <button
        type="button"
        class="${days === this.timescaleDays ? 'active' : ''}"
        data-timescale-days="${days}"
        aria-pressed="${days === this.timescaleDays ? 'true' : 'false'}"
      >${days}D</button>
    `).join('');
    const spendModeLabel = this.excludeSubscriptionIncluded ? 'Included usage hidden' : 'Included usage visible';

    const bodyContent = `
      <div class="dashboard-shell cost-shell">
        <div class="dashboard-topbar">
          <div>
            <p class="dashboard-kicker">Command center</p>
            <h1>Cost Dashboard</h1>
            <p class="dashboard-copy">Track AtlasMind spend, budget pressure, feedback-weighted model behavior, and message-level costs in a cleaner operational view.</p>
          </div>
          <div class="dashboard-actions" role="group" aria-label="Cost dashboard actions">
            <button type="button" id="cost-dashboard-exclude-subscriptions" class="dashboard-button ${this.excludeSubscriptionIncluded ? 'dashboard-button-solid active' : 'dashboard-button-ghost'}">${escapeHtml(spendModeLabel)}</button>
            <button type="button" id="cost-dashboard-open-settings" class="dashboard-button dashboard-button-ghost">Budget Settings</button>
            <button type="button" id="cost-dashboard-reset-history" class="dashboard-button dashboard-button-danger">Reset History</button>
          </div>
        </div>

        <section class="summary-ribbon" style="--summary-columns: ${summaryCardCount};">
          ${summaryCards}
        </section>

        <section class="cost-spotlight-grid">
          <article class="panel-card panel-card-hero">
            <div class="panel-header-row">
              <div>
                <p class="section-kicker">Spend telemetry</p>
                <h2>Daily Spend</h2>
                <p class="section-copy">Windowed spend signal across the last ${escapeHtml(String(this.timescaleDays))} day${this.timescaleDays === 1 ? '' : 's'}, with the timescale selector overlaid directly on the chart.</p>
              </div>
              <div class="meta-pill-row">
                <span class="meta-pill">${escapeHtml(spendModeLabel)}</span>
                ${budget ? `<span class="meta-pill ${budget.blocked ? 'meta-pill-danger' : ''}">Budget ${escapeHtml(budget.blocked ? 'blocked' : 'tracking')}</span>` : ''}
              </div>
            </div>
            ${budget ? this.buildBudgetBar(budget) : ''}
            <div class="daily-chart-stage">
              <div id="cost-dashboard-timescale" class="chart-overlay-controls" role="group" aria-label="Daily spend timescale">
                ${timescaleButtons}
              </div>
              ${dailyChart}
            </div>
          </article>

          <article class="panel-card">
            <div class="panel-header-row">
              <div>
                <p class="section-kicker">Spend distribution</p>
                <h2>Cost by Model</h2>
                <p class="section-copy">Current window cost mix across routed models.</p>
              </div>
            </div>
            ${modelBreakdown}
          </article>
        </section>

        <section class="panel-card">
          <div class="panel-header-row">
            <div>
              <p class="section-kicker">Preference signals</p>
              <h2>Response Feedback by Model</h2>
              <p class="section-copy">Thumbs feedback is stored per assistant response and nudges routing by model. Current routing weight: <strong>${escapeHtml(formatFeedbackWeightLabel(feedbackWeight))}</strong>.</p>
            </div>
          </div>
          ${feedbackOverview}
        </section>

        <section class="panel-card">
          <div class="panel-header-row">
            <div>
              <p class="section-kicker">Recent activity</p>
              <h2>Recent Requests</h2>
              <p class="section-copy">Message-level request costs, with deep links back to chat responses when the transcript entry still exists.</p>
            </div>
          </div>
          ${recentTable}
        </section>
      </div>
    `;

    const scriptContent = `
      const vscode = acquireVsCodeApi();
      function postMsg(type) { vscode.postMessage({ type }); }

      function formatAnimatedValue(value, format) {
        if (format === 'currency-2') {
          return '$' + value.toFixed(2);
        }
        if (format === 'currency-4') {
          return '$' + value.toFixed(4);
        }
        if (format === 'tokens') {
          if (value >= 1000000) { return (value / 1000000).toFixed(1) + 'M'; }
          if (value >= 1000) { return (value / 1000).toFixed(1) + 'K'; }
          return String(Math.round(value));
        }
        return String(Math.round(value));
      }

      function animateCounters() {
        document.querySelectorAll('[data-count-to]').forEach((element) => {
          const targetValue = Number(element.getAttribute('data-count-to'));
          const format = element.getAttribute('data-count-format') || 'integer';
          if (!Number.isFinite(targetValue)) {
            return;
          }
          const start = performance.now();
          const duration = 680;
          const initial = 0;
          function tick(now) {
            const progress = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = initial + ((targetValue - initial) * eased);
            element.textContent = formatAnimatedValue(current, format);
            if (progress < 1) {
              requestAnimationFrame(tick);
            }
          }
          requestAnimationFrame(tick);
        });
      }

      document.getElementById('cost-dashboard-open-settings')
        ?.addEventListener('click', () => postMsg('openSettings'));

      document.querySelectorAll('[data-timescale-days]')
        .forEach((element) => {
          element.addEventListener('click', () => {
            const rawValue = element.getAttribute('data-timescale-days');
            const value = Number(rawValue);
            if (Number.isFinite(value) && value >= 1) {
              vscode.postMessage({ type: 'setTimescaleDays', value: Math.floor(value) });
            }
          });
        });

      document.getElementById('cost-dashboard-exclude-subscriptions')
        ?.addEventListener('click', () => {
          vscode.postMessage({
            type: 'setExcludeSubscriptionIncluded',
            value: ${this.excludeSubscriptionIncluded ? 'false' : 'true'},
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

      animateCounters();
    `;

    return getWebviewHtmlShell({
      title: 'Cost Dashboard',
      cspSource,
      bodyContent,
      scriptContent,
      extraCss: `
        body { background: radial-gradient(circle at top, color-mix(in srgb, var(--vscode-focusBorder, #0e639c) 12%, transparent) 0%, transparent 38%), linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background) 92%, black 8%) 0%, var(--vscode-editor-background) 100%); }
        .cost-shell { display: flex; flex-direction: column; gap: 18px; padding: 6px 2px 20px; }
        .dashboard-topbar { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
        .dashboard-kicker { margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.14em; font-size: 0.72rem; color: var(--vscode-descriptionForeground); }
        .dashboard-topbar h1 { margin: 0; font-size: 2rem; line-height: 1.05; }
        .dashboard-copy { margin: 8px 0 0; max-width: 70ch; color: var(--vscode-descriptionForeground); line-height: 1.5; }
        .dashboard-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
        .dashboard-button { border-radius: 999px; border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 88%, transparent); padding: 10px 14px; font: inherit; cursor: pointer; transition: transform 140ms ease, border-color 140ms ease, background 140ms ease; }
        .dashboard-button:hover { transform: translateY(-1px); }
        .dashboard-button-ghost { background: color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-sideBar-background)) 92%, transparent); color: var(--vscode-foreground); }
        .dashboard-button-solid { background: linear-gradient(135deg, color-mix(in srgb, var(--vscode-button-background) 94%, white 6%), color-mix(in srgb, var(--vscode-button-background) 70%, black 14%)); color: var(--vscode-button-foreground); border-color: color-mix(in srgb, var(--vscode-button-background) 65%, white 8%); }
        .dashboard-button-solid.active { box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-focusBorder, var(--vscode-button-background)) 50%, transparent); }
        .dashboard-button-danger { background: color-mix(in srgb, var(--vscode-inputValidation-errorBackground, #7a2f31) 78%, black 22%); color: var(--vscode-inputValidation-errorForeground, #fff); border-color: color-mix(in srgb, var(--vscode-inputValidation-errorBorder, #be1100) 78%, transparent); }
        .summary-ribbon { display: grid; grid-template-columns: repeat(var(--summary-columns), minmax(144px, 1fr)); gap: 12px; overflow-x: auto; padding-bottom: 2px; }
        .summary-card { min-width: 0; padding: 14px 16px; border-radius: 18px; border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 80%, transparent); background: linear-gradient(180deg, color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-sideBar-background)) 92%, white 3%), color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-sideBar-background)) 96%, black 4%)); box-shadow: 0 18px 30px rgba(0, 0, 0, 0.12); }
        .summary-label { margin: 0; font-size: 0.72rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
        .summary-value { margin-top: 8px; font-size: clamp(1.15rem, 2vw, 1.75rem); font-weight: 700; font-variant-numeric: tabular-nums; }
        .summary-value.warning { color: var(--vscode-notificationsWarningIcon-foreground, #ffb347); }
        .summary-value.ok { color: var(--vscode-notificationsInfoIcon-foreground, #4ec9b0); }
        .summary-detail { margin: 8px 0 0; font-size: 0.8rem; color: var(--vscode-descriptionForeground); }
        .cost-spotlight-grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.85fr); gap: 16px; align-items: stretch; }
        .panel-card { position: relative; padding: 18px; border-radius: 24px; border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 80%, transparent); background: linear-gradient(180deg, color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-sideBar-background)) 96%, white 2%), color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-sideBar-background)) 94%, black 6%)); box-shadow: 0 20px 42px rgba(0, 0, 0, 0.14); overflow: hidden; }
        .panel-card-hero::before { content: ''; position: absolute; inset: 0 auto auto 0; width: 220px; height: 220px; background: radial-gradient(circle, color-mix(in srgb, var(--vscode-button-background) 24%, transparent) 0%, transparent 72%); pointer-events: none; }
        .panel-header-row { position: relative; display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 14px; }
        .section-kicker { margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.12em; font-size: 0.72rem; color: var(--vscode-descriptionForeground); }
        .panel-header-row h2 { margin: 0; font-size: 1.35rem; }
        .section-copy { margin: 8px 0 0; color: var(--vscode-descriptionForeground); line-height: 1.5; }
        .meta-pill-row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
        .meta-pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 6px 10px; font-size: 0.78rem; background: color-mix(in srgb, var(--vscode-badge-background, #444) 74%, transparent); color: var(--vscode-badge-foreground, var(--vscode-foreground)); }
        .meta-pill-danger { background: color-mix(in srgb, var(--vscode-inputValidation-errorBackground, #7a2f31) 62%, transparent); }
        .budget-hud { margin-bottom: 16px; padding: 14px; border-radius: 18px; background: color-mix(in srgb, var(--vscode-editor-background) 64%, transparent); border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 72%, transparent); }
        .budget-hud-top { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
        .budget-track { position: relative; height: 12px; border-radius: 999px; overflow: hidden; background: color-mix(in srgb, var(--vscode-widget-border, #444) 68%, transparent); }
        .budget-track-fill { height: 100%; border-radius: inherit; transform-origin: left center; transform: scaleX(0); animation: budget-fill 720ms cubic-bezier(0.22, 1, 0.36, 1) forwards; }
        .budget-track-fill.safe { background: linear-gradient(90deg, #36cfc9, #4ec9b0); }
        .budget-track-fill.warn { background: linear-gradient(90deg, #f5a623, #ffcb6b); }
        .budget-track-fill.over { background: linear-gradient(90deg, #f36b6b, #f44747); }
        .budget-caption { margin: 10px 0 0; font-size: 0.82rem; color: var(--vscode-descriptionForeground); }
        .daily-chart-stage { position: relative; min-height: 320px; border-radius: 22px; padding: 18px 14px 12px; background: linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background) 54%, transparent), color-mix(in srgb, var(--vscode-editor-background) 30%, transparent)); border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 65%, transparent); overflow: hidden; }
        .chart-overlay-controls { position: absolute; top: 14px; right: 14px; z-index: 3; display: inline-flex; gap: 6px; padding: 6px; border-radius: 999px; backdrop-filter: blur(16px); background: color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-sideBar-background)) 82%, transparent); border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 72%, transparent); }
        .chart-overlay-controls button { border: 0; border-radius: 999px; background: transparent; color: var(--vscode-descriptionForeground); padding: 6px 10px; cursor: pointer; font: inherit; }
        .chart-overlay-controls button.active { background: color-mix(in srgb, var(--vscode-button-background) 82%, white 4%); color: var(--vscode-button-foreground); }
        .daily-chart { position: relative; min-height: 286px; padding-top: 16px; }
        .daily-chart-grid { position: absolute; inset: 16px 0 30px; display: grid; grid-template-rows: repeat(4, 1fr); pointer-events: none; }
        .daily-chart-grid span { border-top: 1px dashed color-mix(in srgb, var(--vscode-widget-border, #444) 44%, transparent); }
        .daily-chart-svg { position: absolute; inset: 16px 0 30px; width: 100%; height: calc(100% - 46px); overflow: visible; pointer-events: none; }
        .daily-area { fill: url(#daily-spend-area); opacity: 0; animation: chart-area-fade 700ms ease forwards 120ms; }
        .daily-line { fill: none; stroke: color-mix(in srgb, var(--vscode-button-background) 82%, white 8%); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1000; stroke-dashoffset: 1000; animation: chart-line-draw 950ms cubic-bezier(0.22, 1, 0.36, 1) forwards 120ms; }
        .daily-dot { fill: var(--vscode-editor-background); stroke: color-mix(in srgb, var(--vscode-button-background) 90%, white 4%); stroke-width: 2; opacity: 0; animation: chart-dot-in 420ms ease forwards; }
        .daily-bars { position: relative; display: grid; grid-template-columns: repeat(var(--chart-columns), minmax(0, 1fr)); align-items: end; gap: 6px; height: 240px; margin-top: 20px; }
        .daily-bar-col { display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 10px; min-width: 0; }
        .daily-bar-meter { width: min(24px, 100%); border-radius: 999px; background: linear-gradient(180deg, color-mix(in srgb, var(--vscode-button-background) 35%, white 18%), color-mix(in srgb, var(--vscode-button-background) 88%, black 8%)); transform-origin: bottom center; transform: scaleY(0); animation: bar-rise 720ms cubic-bezier(0.22, 1, 0.36, 1) forwards; animation-delay: calc(var(--bar-index) * 28ms); box-shadow: 0 10px 18px color-mix(in srgb, var(--vscode-button-background) 22%, transparent); }
        .daily-bar-label { font-size: 0.72rem; color: var(--vscode-descriptionForeground); white-space: nowrap; }
        .daily-chart-footer { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
        .chart-foot-stat { padding: 10px 12px; border-radius: 14px; background: color-mix(in srgb, var(--vscode-editor-background) 68%, transparent); border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 60%, transparent); }
        .chart-foot-label { margin: 0; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--vscode-descriptionForeground); }
        .chart-foot-value { margin-top: 6px; font-size: 1rem; font-weight: 700; font-variant-numeric: tabular-nums; }
        .model-list { display: flex; flex-direction: column; gap: 12px; }
        .model-entry { padding: 12px 14px; border-radius: 18px; background: color-mix(in srgb, var(--vscode-editor-background) 60%, transparent); border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 58%, transparent); }
        .model-entry-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
        .model-label { font-size: 0.9rem; font-weight: 600; }
        .model-cost { font-size: 0.85rem; color: var(--vscode-descriptionForeground); }
        .model-track { position: relative; height: 12px; border-radius: 999px; overflow: hidden; background: color-mix(in srgb, var(--vscode-widget-border, #444) 64%, transparent); }
        .model-fill { height: 100%; border-radius: inherit; transform-origin: left center; transform: scaleX(0); animation: budget-fill 720ms cubic-bezier(0.22, 1, 0.36, 1) forwards; animation-delay: calc(var(--model-index) * 40ms); background: linear-gradient(90deg, color-mix(in srgb, var(--vscode-button-background) 94%, white 6%), color-mix(in srgb, var(--vscode-button-background) 70%, black 14%)); }
        .model-meta { display: flex; justify-content: space-between; gap: 10px; margin-top: 8px; font-size: 0.8rem; color: var(--vscode-descriptionForeground); }
        .feedback-summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
        .feedback-card { padding: 14px 16px; border-radius: 18px; background: color-mix(in srgb, var(--vscode-editor-background) 60%, transparent); border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 58%, transparent); }
        .feedback-table, .recent-table { width: 100%; border-collapse: collapse; }
        .feedback-table th, .feedback-table td, .recent-table th, .recent-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 58%, transparent); }
        .feedback-table th, .recent-table th { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--vscode-descriptionForeground); }
        .feedback-table td.numeric { text-align: right; font-variant-numeric: tabular-nums; }
        .feedback-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: color-mix(in srgb, var(--vscode-badge-background, #444) 70%, transparent); font-size: 0.78rem; }
        .feedback-chip.up { color: var(--vscode-testing-iconPassed, #4ec9b0); }
        .feedback-chip.down { color: var(--vscode-testing-iconFailed, #f14c4c); }
        .feedback-chip.none { opacity: 0.7; }
        .recent-table-wrapper, .feedback-table-wrapper { overflow-x: auto; }
        .recent-table td.cost, .recent-table td.tokens { text-align: right; font-variant-numeric: tabular-nums; font-family: Consolas, 'Courier New', monospace; }
        .recent-table td.billing, .recent-table td.feedback { white-space: nowrap; }
        .recent-row-link { cursor: pointer; transition: background 120ms ease; }
        .recent-row-link:hover td, .recent-row-link:focus td { background: color-mix(in srgb, var(--vscode-list-hoverBackground, transparent) 90%, transparent); }
        .recent-row-link:focus { outline: none; }
        .dashboard-empty { padding: 24px; border-radius: 18px; background: color-mix(in srgb, var(--vscode-editor-background) 60%, transparent); color: var(--vscode-descriptionForeground); text-align: center; }
        @keyframes bar-rise { from { transform: scaleY(0); } to { transform: scaleY(var(--bar-height)); } }
        @keyframes budget-fill { from { transform: scaleX(0); } to { transform: scaleX(var(--fill-scale, 1)); } }
        @keyframes chart-line-draw { to { stroke-dashoffset: 0; } }
        @keyframes chart-area-fade { from { opacity: 0; transform: translateY(8px); } to { opacity: 0.92; transform: translateY(0); } }
        @keyframes chart-dot-in { from { opacity: 0; transform: scale(0.4); } to { opacity: 1; transform: scale(1); } }
        @media (max-width: 1100px) {
          .cost-spotlight-grid { grid-template-columns: 1fr; }
          .feedback-summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 780px) {
          .dashboard-topbar { flex-direction: column; }
          .dashboard-actions { justify-content: flex-start; }
          .daily-chart-footer { grid-template-columns: 1fr; }
          .feedback-summary-grid { grid-template-columns: 1fr; }
        }
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
      { label: 'Total Spend', value: formatCurrency(summary.totalCostUsd, 4), detail: 'All filtered request spend', countTo: summary.totalCostUsd, countFormat: 'currency-4' },
      { label: 'Budgeted Spend', value: formatCurrency(summary.totalBudgetCostUsd, 4), detail: 'Counts against daily budget', countTo: summary.totalBudgetCostUsd, countFormat: 'currency-4' },
      { label: 'Included Subscriptions', value: formatCurrency(summary.totalSubscriptionIncludedUsd, 4), detail: 'Visible even when not budgeted', countTo: summary.totalSubscriptionIncludedUsd, countFormat: 'currency-4' },
      { label: 'Total Requests', value: String(summary.totalRequests), detail: 'Requests in current window', countTo: summary.totalRequests, countFormat: 'integer' },
      { label: 'Input Tokens', value: formatTokens(summary.totalInputTokens), detail: 'Prompt-side token volume', countTo: summary.totalInputTokens, countFormat: 'tokens' },
      { label: 'Output Tokens', value: formatTokens(summary.totalOutputTokens), detail: 'Response-side token volume', countTo: summary.totalOutputTokens, countFormat: 'tokens' },
      { label: "Today's Spend", value: formatCurrency(todayCostUsd, 4), detail: 'Current day budget pressure', cls: budgetClass, countTo: todayCostUsd, countFormat: 'currency-4' },
    ];

    if (budget) {
      cards.push({ label: 'Daily Limit', value: formatCurrency(budget.limitUsd, 2), detail: 'Configured spending ceiling', countTo: budget.limitUsd, countFormat: 'currency-2' });
    }

    return cards.map(card => `
      <article class="summary-card">
        <p class="summary-label">${escapeHtml(card.label)}</p>
        <div class="summary-value ${escapeHtml(card.cls ?? '')}" data-count-to="${escapeHtml(String(card.countTo))}" data-count-format="${escapeHtml(card.countFormat)}">${escapeHtml(card.value)}</div>
        <p class="summary-detail">${escapeHtml(card.detail)}</p>
      </article>
    `).join('');
  }

  private buildBudgetBar(budget: NonNullable<ReturnType<CostTracker['getDailyBudgetStatus']>>): string {
    const pct = Math.min(100, (budget.todayCostUsd / budget.limitUsd) * 100);
    const cls = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'safe';
    const label = budget.blocked
      ? 'Daily budget is currently blocking new requests.'
      : `${formatCurrency(budget.remainingUsd, 4)} remaining of ${formatCurrency(budget.limitUsd, 2)}.`;
    return `
      <div class="budget-hud">
        <div class="budget-hud-top">
          <div>
            <p class="summary-label">Budget headroom</p>
            <div class="summary-value" data-count-to="${escapeHtml(String(budget.todayCostUsd))}" data-count-format="currency-4">${escapeHtml(formatCurrency(budget.todayCostUsd, 4))}</div>
          </div>
          <div class="meta-pill-row">
            <span class="meta-pill">Projected ${escapeHtml(formatCurrency(budget.projectedTotalUsd, 4))}</span>
            <span class="meta-pill ${budget.blocked ? 'meta-pill-danger' : ''}">${escapeHtml(budget.blocked ? 'Limit reached' : `${pct.toFixed(0)}% of daily limit`)}</span>
          </div>
        </div>
        <div class="budget-track">
          <div class="budget-track-fill ${escapeHtml(cls)}" style="--fill-scale:${(pct / 100).toFixed(4)}"></div>
        </div>
        <p class="budget-caption">${escapeHtml(label)}</p>
      </div>
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
      return '<div class="dashboard-empty">No spend data yet for the selected window.</div>';
    }
    const max = Math.max(...days.map(d => d.costUsd), 0.0001);
    const total = days.reduce((sum, day) => sum + day.costUsd, 0);
    const peak = days.reduce((best, day) => day.costUsd > best.costUsd ? day : best, days[0]);
    const average = total / days.length;
    const chartHeight = 182;
    const chartWidth = Math.max(420, days.length * 36);
    const leftPad = 14;
    const rightPad = 14;
    const topPad = 12;
    const bottomPad = 22;
    const usableHeight = chartHeight - topPad - bottomPad;
    const usableWidth = chartWidth - leftPad - rightPad;
    const points = days.map((day, index) => {
      const x = leftPad + (days.length === 1 ? usableWidth / 2 : (usableWidth / (days.length - 1)) * index);
      const y = chartHeight - bottomPad - ((day.costUsd / max) * usableHeight);
      return { x, y, day, index };
    });
    const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
    const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${(chartHeight - bottomPad).toFixed(2)} L ${points[0].x.toFixed(2)} ${(chartHeight - bottomPad).toFixed(2)} Z`;
    const dots = points.map(point => `
      <circle class="daily-dot" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="4" style="animation-delay:${120 + (point.index * 32)}ms"></circle>
    `).join('');
    const bars = days.map((day, index) => {
      const heightRatio = Math.max(0.04, day.costUsd / max);
      const title = `${day.date}: ${formatCurrency(day.costUsd, 4)}`;
      return `
        <div class="daily-bar-col" title="${escapeHtml(title)}">
          <div class="daily-bar-meter" style="height:180px; --bar-height:${heightRatio.toFixed(4)}; --bar-index:${index}"></div>
          <div class="daily-bar-label">${escapeHtml(formatChartDateLabel(day.date, index, days.length))}</div>
        </div>
      `;
    }).join('');

    return `
      <div class="daily-chart">
        <div class="daily-chart-grid"><span></span><span></span><span></span><span></span></div>
        <svg class="daily-chart-svg" viewBox="0 0 ${chartWidth} ${chartHeight}" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="daily-spend-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--vscode-button-background)" stop-opacity="0.38"></stop>
              <stop offset="100%" stop-color="var(--vscode-button-background)" stop-opacity="0"></stop>
            </linearGradient>
          </defs>
          <path class="daily-area" d="${areaPath}"></path>
          <path class="daily-line" d="${linePath}"></path>
          ${dots}
        </svg>
        <div class="daily-bars" style="--chart-columns:${days.length}">${bars}</div>
      </div>
      <div class="daily-chart-footer">
        <div class="chart-foot-stat">
          <p class="chart-foot-label">Window spend</p>
          <div class="chart-foot-value" data-count-to="${escapeHtml(String(total))}" data-count-format="currency-4">${escapeHtml(formatCurrency(total, 4))}</div>
        </div>
        <div class="chart-foot-stat">
          <p class="chart-foot-label">Average / day</p>
          <div class="chart-foot-value" data-count-to="${escapeHtml(String(average))}" data-count-format="currency-4">${escapeHtml(formatCurrency(average, 4))}</div>
        </div>
        <div class="chart-foot-stat">
          <p class="chart-foot-label">Peak day</p>
          <div class="chart-foot-value">${escapeHtml(formatChartDateLabel(peak.date, 0, days.length))} · ${escapeHtml(formatCurrency(peak.costUsd, 4))}</div>
        </div>
      </div>
    `;
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
      return '<div class="dashboard-empty">No model usage data yet.</div>';
    }
    const sorted = [...byModel.entries()].sort((a, b) => b[1].costUsd - a[1].costUsd);
    const maxCost = sorted[0]?.[1]?.costUsd ?? 0.0001;
    return `<div class="model-list">${sorted.map(([model, data], index) => {
      const fillScale = Math.max(0.04, data.costUsd / maxCost);
      return `
        <div class="model-entry">
          <div class="model-entry-top">
            <span class="model-label">${escapeHtml(model)}</span>
            <span class="model-cost">${escapeHtml(formatCurrency(data.costUsd, 4))}</span>
          </div>
          <div class="model-track">
            <div class="model-fill" style="--fill-scale:${fillScale.toFixed(4)}; --model-index:${index}"></div>
          </div>
          <div class="model-meta">
            <span>${escapeHtml(String(data.requests))} request${data.requests === 1 ? '' : 's'}</span>
            <span>${escapeHtml(`${Math.round(fillScale * 100)}% of leading model`)}</span>
          </div>
        </div>
      `;
    }).join('')}</div>`;
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
      return '<div class="dashboard-empty">No thumbs feedback has been recorded yet.</div>';
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
      <div class="feedback-table-wrapper">
        <table class="feedback-table">
          <thead>
            <tr><th>Model</th><th>Approval</th><th>Up</th><th>Down</th><th>Filtered Requests</th><th>Filtered Spend</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  private buildRecentTable(records: CostRecord[]): string {
    if (records.length === 0) {
      return '<div class="dashboard-empty">No requests recorded yet.</div>';
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
      <div class="recent-table-wrapper">
        <table class="recent-table">
          <thead>
            <tr><th>Time</th><th>Model</th><th>Provider</th><th>Agent</th><th>Billing</th><th>Feedback</th><th>In / Out tokens</th><th>Message Cost</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) { return `${(n / 1_000_000).toFixed(1)}M`; }
  if (n >= 1_000) { return `${(n / 1_000).toFixed(1)}K`; }
  return String(n);
}

function formatCurrency(value: number, decimals = 4): string {
  return `$${value.toFixed(decimals)}`;
}

function formatChartDateLabel(date: string, index: number, total: number): string {
  const compact = date.slice(5);
  if (total <= 10) {
    return compact;
  }
  const interval = Math.max(1, Math.floor(total / 6));
  if (index === 0 || index === total - 1 || index % interval === 0) {
    return compact;
  }
  return '·';
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
