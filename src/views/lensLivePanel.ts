/**
 * The live-probe result surface: what the service served, and how it differs.
 *
 * Host-owned like every other Lens panel — the webview receives data and sends
 * back bounded ids, never a command, never a destination. That matters more here
 * than elsewhere: this is the only Lens surface whose subject is a real service,
 * and a webview that could name a host would be a way to make AtlasMind send a
 * request somewhere nobody declared.
 *
 * Two presentational decisions carry meaning:
 *
 * **The outcome banner is drawn before the findings, and an unassessed outcome
 * replaces them rather than sitting above an empty list.** A results table with
 * no rows reads as "nothing wrong" whatever the caption says.
 *
 * **`absent-remotely` and `undeclared-remotely` are visually distinct, not two
 * rows of one colour.** They need opposite fixes, and the whole reason the core
 * keeps them apart would be undone by a renderer that greys them the same.
 */

import * as vscode from 'vscode';

import type { LensLiveAnalysis } from '../core/lensProbeRunner.js';
import { buildLensContextPatch, buildLensDraftPrompt, normalizeLensTarget } from '../core/lensTarget.js';
import type {
  LensDatabaseHealth,
  LensEndpointDeclaration,
  LensProbeResult,
  LensReachabilityMap,
  LensVisualTarget,
  LensWorkspaceIdentity,
} from '../types.js';
import { revealPreferredChatSurface } from './chatPanel.js';
import { LENS_PANEL_CSS, renderLensHeader } from './lensVisuals.js';
import { getWebviewHtmlShell } from './webviewUtils.js';

export interface LensLivePanelInput {
  workspace: LensWorkspaceIdentity;
  endpoint: LensEndpointDeclaration;
  result: LensProbeResult;
  analysis: LensLiveAnalysis;
  reachability: LensReachabilityMap;
  trustPolicyPresent: boolean;
  /** Metrics, latency and plan. Only a direct database probe produces these. */
  health?: LensDatabaseHealth;
}

type LensLiveMessage =
  | { type: 'ready' }
  | { type: 'openFinding'; findingId: string }
  | { type: 'askFinding'; findingId: string };

/** Secure host-owned view of one live probe and what it found. */
export class LensLivePanel {
  private static currentPanel: LensLivePanel | undefined;
  private static readonly viewType = 'atlasmind.lensLive';
  private readonly disposables: vscode.Disposable[] = [];
  private readonly targetByFindingId = new Map<string, LensVisualTarget>();
  private ready = false;

  public static createOrShow(input: LensLivePanelInput): void {
    if (LensLivePanel.currentPanel) {
      LensLivePanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      LensLivePanel.currentPanel.replaceInput(input);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      LensLivePanel.viewType,
      'Lens — Live Services',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    LensLivePanel.currentPanel = new LensLivePanel(panel, input);
  }

  private constructor(private readonly panel: vscode.WebviewPanel, private input: LensLivePanelInput) {
    this.indexTargets();
    this.panel.webview.html = buildLiveHtml(this.panel.webview.cspSource);
    this.panel.webview.onDidReceiveMessage(
      (raw: unknown) => {
        const message = normalizeLiveMessage(raw);
        if (message) void this.handleMessage(message);
      },
      null,
      this.disposables,
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private replaceInput(input: LensLivePanelInput): void {
    this.input = input;
    this.indexTargets();
    if (this.ready) {
      void this.panel.webview.postMessage({ type: 'view', view: this.buildView() });
    }
  }

  private indexTargets(): void {
    this.targetByFindingId.clear();
    for (const report of this.input.analysis.drift) {
      for (const finding of report.findings) {
        const target = finding.target ? normalizeLensTarget(finding.target) : undefined;
        if (target) {
          this.targetByFindingId.set(finding.id, target);
        }
      }
    }
  }

  /**
   * The data the webview draws.
   *
   * Assembled here rather than posting the raw analysis, so the panel sends only
   * what it means to render and no internal field can leak into a DOM node by
   * accident.
   */
  private buildView(): Record<string, unknown> {
    const { endpoint, result, analysis, reachability } = this.input;
    const findings = analysis.drift.flatMap(report => report.findings.map(finding => ({
      id: finding.id,
      kind: finding.kind,
      severity: finding.severity,
      label: finding.label,
      reason: finding.reason,
      fieldPath: finding.fieldPath,
      declared: finding.declared ?? '',
      served: finding.served ?? '',
      hasTarget: this.targetByFindingId.has(finding.id),
    })));
    const notices = [
      ...new Set(analysis.drift.flatMap(report => report.notices)),
      ...(analysis.trust?.notices ?? []),
      ...(this.input.trustPolicyPresent
        ? []
        : ['No .atlasmind/lens-data-trust.json exists, so Live Data Trust has no policy to compare against.']),
      ...(analysis.unclaimedServedLabels.length > 0
        ? [`The service also serves ${analysis.unclaimedServedLabels.length} schema(s) no repository contract `
          + `claims: ${analysis.unclaimedServedLabels.slice(0, 8).join(', ')}.`]
        : []),
    ];

    return {
      endpoint: {
        label: endpoint.label,
        kind: endpoint.kind,
        stage: endpoint.stage,
      },
      outcome: result.outcome,
      outcomeReason: result.reason,
      latencyMs: result.latencyMs ?? null,
      observedAt: result.observedAt,
      findings,
      trust: (analysis.trust?.items ?? []).map(item => ({
        id: item.id,
        fieldPath: item.fieldPath,
        status: item.status,
        classification: item.classification ?? '',
        controls: item.controls.join(', '),
        reason: item.reason,
      })),
      undeclaredCount: analysis.trust?.undeclaredCount ?? 0,
      reachability: {
        items: reachability.items.map(item => ({
          id: item.id,
          label: item.label,
          kind: item.kind,
          stage: item.stage,
          outcome: item.outcome,
          reason: item.reason,
          latencyMs: item.latencyMs ?? null,
          dangling: item.danglingContractIds.join(', '),
        })),
        reachedCount: reachability.reachedCount,
        unreachableCount: reachability.unreachableCount,
        unassessedCount: reachability.unassessedCount,
        notices: reachability.notices,
      },
      health: this.buildHealthView(),
      notices,
    };
  }

  /**
   * The measured half.
   *
   * `rowEstimate` is passed as `null` when unknown rather than `0`, and the
   * renderer prints "unknown". A table nobody has analyzed must never read as an
   * empty one — that is the single most expensive wrong answer this panel could
   * give somebody checking whether a migration ran.
   */
  private buildHealthView(): Record<string, unknown> | null {
    const health = this.input.health;
    if (!health) {
      return null;
    }
    const constraintsByTable = new Map<string, number>();
    for (const constraint of health.constraints) {
      constraintsByTable.set(constraint.table, (constraintsByTable.get(constraint.table) ?? 0) + 1);
    }
    return {
      dialect: health.dialect,
      serverVersion: health.serverVersion ?? '',
      latency: health.latency ?? null,
      plan: health.plan ?? null,
      notices: health.notices,
      tables: health.tables.slice(0, 200).map(table => ({
        table: table.table,
        rowEstimate: table.rowEstimate ?? null,
        totalBytes: table.totalBytes ?? null,
        indexCount: table.indexCount ?? null,
        constraints: constraintsByTable.get(table.table) ?? 0,
        lastAnalyzedAt: table.lastAnalyzedAt ?? '',
        // The staleness question is the one that decides whether the estimate
        // is worth anything, so it is answered here rather than left to the eye.
        neverAnalyzed: table.rowEstimate === undefined,
      })),
    };
  }

  private async handleMessage(message: LensLiveMessage): Promise<void> {
    if (message.type === 'ready') {
      this.ready = true;
      await this.panel.webview.postMessage({ type: 'view', view: this.buildView() });
      return;
    }
    const target = normalizeLensTarget(this.targetByFindingId.get(message.findingId));
    if (!target) {
      return;
    }
    if (message.type === 'openFinding') {
      const uri = resolveWorkspaceTarget(target);
      if (!uri) {
        void vscode.window.showWarningMessage('AtlasMind Lens refused an invalid or out-of-workspace target.');
        return;
      }
      await vscode.window.showTextDocument(uri, {
        preview: false,
        ...(target.range ? { selection: toSelection(target) } : {}),
      });
      return;
    }
    await revealPreferredChatSurface({
      draftPrompt: buildLensDraftPrompt(target),
      contextPatch: buildLensContextPatch(target),
    });
  }

  private dispose(): void {
    LensLivePanel.currentPanel = undefined;
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }
}

function normalizeLiveMessage(value: unknown): LensLiveMessage | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }
  if (value.type === 'ready') {
    return { type: 'ready' };
  }
  if (
    (value.type === 'openFinding' || value.type === 'askFinding') &&
    typeof value.findingId === 'string' && value.findingId.length > 0 &&
    value.findingId.length <= 500 && !hasControlCharacter(value.findingId)
  ) {
    return { type: value.type, findingId: value.findingId };
  }
  return undefined;
}

function resolveWorkspaceTarget(target: LensVisualTarget): vscode.Uri | undefined {
  const folder = vscode.workspace.workspaceFolders?.find(candidate =>
    candidate.name === target.workspace.name && candidate.index === target.workspace.index,
  );
  if (!folder) {
    return undefined;
  }
  const uri = vscode.Uri.joinPath(folder.uri, ...target.workspacePath.split('/'));
  const resolved = vscode.workspace.getWorkspaceFolder(uri);
  return resolved && resolved.name === folder.name && resolved.index === folder.index &&
    normalizeRelativePath(vscode.workspace.asRelativePath(uri, false)) === target.workspacePath ? uri : undefined;
}

function toSelection(target: LensVisualTarget): vscode.Selection | undefined {
  return target.range ? new vscode.Selection(
    target.range.startLine - 1, target.range.startColumn - 1,
    target.range.endLine - 1, target.range.endColumn - 1,
  ) : undefined;
}

function normalizeRelativePath(value: string): string | undefined {
  const normalized = value.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    return undefined;
  }
  const segments = normalized.split('/');
  return segments.some(segment => !segment || segment === '.' || segment === '..') ? undefined : segments.join('/');
}

function buildLiveHtml(cspSource: string): string {
  return getWebviewHtmlShell({
    dashboardSkin: true,
    title: 'AtlasMind Lens — Live Services',
    cspSource,
    bodyContent: `
      <main class="lens-shell" data-accent="red">
        ${renderLensHeader({
          eyebrow: 'Atlas Lens',
          title: 'Live services',
          titleId: 'live-title',
          subtitle: 'Loading probe result…',
          subtitleId: 'live-summary',
          mode: 'Live evidence',
          info: {
            title: 'Live contract drift, reachability, and data trust',
            body: 'Compares the schema your repository declares against the one a running service actually serves. Red rows are declared and not served — a dead end for code reading that field. Amber rows are served and not declared.',
            note: 'AtlasMind reads shape only: the schema a service publishes, or an information_schema listing. It never reads a row, a record, or a field value, and it never writes. A field it cannot see may still exist behind a permission.',
          },
          aside: '<span id="outcome-badge" class="lens-badge">Probing…</span>',
        })}
        <p id="outcome-banner" class="outcome-banner"></p>
        <ul id="live-notices" class="lens-notices" aria-label="Evidence notices"></ul>
        <section class="lens-section" aria-labelledby="drift-heading">
          <h2 id="drift-heading" class="section-heading">Contract drift</h2>
          <div id="drift-list" class="card-grid"></div>
        </section>
        <section class="lens-section" aria-labelledby="reach-heading">
          <h2 id="reach-heading" class="section-heading">Reachability</h2>
          <p id="reach-summary" class="lens-card-meta"></p>
          <div id="reach-list" class="card-grid"></div>
        </section>
        <section class="lens-section" aria-labelledby="trust-heading">
          <h2 id="trust-heading" class="section-heading">Live data trust</h2>
          <p id="trust-summary" class="lens-card-meta"></p>
          <div id="trust-list" class="card-grid"></div>
        </section>
        <section class="lens-section" id="health-section" aria-labelledby="health-heading" hidden>
          <h2 id="health-heading" class="section-heading">Measured</h2>
          <p id="health-summary" class="lens-card-meta"></p>
          <ul id="health-notices" class="lens-notices" aria-label="Measurement notices"></ul>
          <div id="health-tables" class="card-grid"></div>
        </section>
      </main>
    `,
    extraCss: `${LENS_PANEL_CSS}
      .section-heading { font-size: .95rem; margin: 18px 0 8px; }
      .card-grid { display: grid; gap: 10px; }
      .outcome-banner {
        margin: 12px 0 0; padding: 10px 14px; border-radius: 6px; font-size: .85rem;
        border-left: 3px solid var(--lens-accent);
        background: color-mix(in srgb, var(--lens-accent) 8%, transparent);
      }
      .finding[data-kind="absent-remotely"] { --lens-accent: var(--vscode-charts-red, #f14c4c); }
      .finding[data-kind="undeclared-remotely"] { --lens-accent: var(--vscode-charts-orange, #d18616); }
      .finding[data-kind="type-changed"] { --lens-accent: var(--vscode-charts-red, #f14c4c); }
      .finding[data-kind="nullability-changed"] { --lens-accent: var(--vscode-charts-yellow, #cca700); }
      .finding[data-kind="presence-changed"] { --lens-accent: var(--vscode-charts-yellow, #cca700); }
      .finding[data-kind="matched"] { --lens-accent: var(--vscode-charts-green, #89d185); opacity: .72; }
      .finding[data-outcome="unreachable"] { --lens-accent: var(--vscode-charts-red, #f14c4c); }
      .finding[data-outcome="reached"] { --lens-accent: var(--vscode-charts-green, #89d185); }
      .finding[data-outcome="unassessed"] { --lens-accent: var(--vscode-disabledForeground, var(--lens-muted)); }
      .finding[data-status="served-undeclared"] { --lens-accent: var(--vscode-charts-orange, #d18616); }
      .finding[data-status="declared-absent"] { --lens-accent: var(--vscode-charts-yellow, #cca700); }
      .finding[data-status="confirmed"] { --lens-accent: var(--vscode-charts-green, #89d185); opacity: .72; }
      .shape-row {
        display: flex; gap: 10px; flex-wrap: wrap; font-family: var(--vscode-editor-font-family, monospace);
        font-size: .76rem; color: var(--vscode-foreground);
      }
      .shape-row span { border: 1px solid var(--lens-border); border-radius: 4px; padding: 1px 7px; }
      .empty-note { font-size: .84rem; color: var(--lens-muted); margin: 0; }
    `,
    scriptContent: `
      const vscode = acquireVsCodeApi();
      const title = document.getElementById('live-title');
      const summary = document.getElementById('live-summary');
      const badge = document.getElementById('outcome-badge');
      const banner = document.getElementById('outcome-banner');
      const notices = document.getElementById('live-notices');
      const driftList = document.getElementById('drift-list');
      const reachList = document.getElementById('reach-list');
      const reachSummary = document.getElementById('reach-summary');
      const trustList = document.getElementById('trust-list');
      const trustSummary = document.getElementById('trust-summary');
      const healthSection = document.getElementById('health-section');
      const healthSummary = document.getElementById('health-summary');
      const healthNotices = document.getElementById('health-notices');
      const healthTables = document.getElementById('health-tables');

      document.addEventListener('click', event => {
        const button = event.target.closest('button[data-action][data-finding-id]');
        if (button) vscode.postMessage({ type: button.dataset.action, findingId: button.dataset.findingId });
      });
      window.addEventListener('message', event => { if (event.data?.type === 'view') render(event.data.view); });

      function render(view) {
        title.textContent = view.endpoint.label;
        summary.textContent = view.endpoint.kind + ' · ' + view.endpoint.stage + ' · observed ' + view.observedAt;
        badge.textContent = view.outcome;
        banner.textContent = view.outcomeReason + (view.latencyMs === null ? '' : ' (' + view.latencyMs + 'ms)');
        notices.replaceChildren(...view.notices.map(notice => element('li', notice)));

        // An unassessed outcome replaces the findings rather than sitting above
        // an empty list — an empty table reads as "nothing wrong".
        if (view.outcome !== 'reached') {
          driftList.replaceChildren(element('p',
            'Nothing was read from this service, so no comparison was made. This is not a finding of "no drift".',
            'empty-note'));
        } else if (view.findings.length === 0) {
          driftList.replaceChildren(element('p',
            'The probe succeeded and no repository contract paired with what the service serves. Check the notices above.',
            'empty-note'));
        } else {
          driftList.replaceChildren(...view.findings.map(renderFinding));
        }

        reachSummary.textContent = view.reachability.reachedCount + ' reached · '
          + view.reachability.unreachableCount + ' unreachable · '
          + view.reachability.unassessedCount + ' not assessed';
        reachList.replaceChildren(...view.reachability.items.map(renderReach));

        trustSummary.textContent = view.outcome === 'reached'
          ? view.undeclaredCount + ' served field(s) have no classification'
          : 'Not assessed — nothing was read from this service.';
        trustList.replaceChildren(...view.trust.slice(0, 200).map(renderTrust));

        // Hidden entirely rather than shown empty: only a direct database probe
        // measures anything, and an empty "Measured" heading on an API probe
        // would read as a measurement that came back with nothing.
        if (!view.health) {
          healthSection.hidden = true;
          return;
        }
        healthSection.hidden = false;
        renderHealth(view.health);
      }

      function renderHealth(health) {
        const parts = [health.dialect];
        if (health.serverVersion) parts.push(health.serverVersion);
        if (health.latency) {
          parts.push('first ' + health.latency.firstMs + 'ms · p50 ' + health.latency.p50Ms
            + 'ms · p95 ' + health.latency.p95Ms + 'ms');
          if (health.latency.coldStartSuspected) parts.push('cold start suspected');
        }
        if (health.plan && health.plan.available) {
          if (health.plan.planningMs !== undefined) parts.push('plan ' + health.plan.planningMs + 'ms');
          if (health.plan.rootNode) parts.push(health.plan.rootNode);
        }
        healthSummary.textContent = parts.join(' · ');
        healthNotices.replaceChildren(...health.notices.map(notice => element('li', notice)));
        healthTables.replaceChildren(...health.tables.map(renderHealthTable));
      }

      function renderHealthTable(table) {
        const card = element('article', '', 'lens-card finding');
        card.dataset.status = table.neverAnalyzed ? 'declared-absent' : 'confirmed';
        card.append(element('h3', table.table, 'lens-card-title'));
        const shapes = element('div', '', 'shape-row');
        // Unknown is printed as unknown. A table nobody has analyzed must never
        // read as an empty one.
        shapes.append(element('span', 'rows: ' + (table.rowEstimate === null
          ? 'unknown (never analyzed)'
          : '~' + table.rowEstimate.toLocaleString())));
        if (table.totalBytes !== null) shapes.append(element('span', 'size: ' + formatBytes(table.totalBytes)));
        if (table.indexCount !== null) shapes.append(element('span', 'indexes: ' + table.indexCount));
        shapes.append(element('span', 'constraints: ' + table.constraints));
        card.append(shapes);
        card.append(element('p', table.lastAnalyzedAt
          ? 'Estimate last refreshed ' + table.lastAnalyzedAt
          : 'This table has never been analyzed, so its row count is unknown — not zero.',
          'lens-card-meta'));
        return card;
      }

      function formatBytes(bytes) {
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let value = bytes, unit = 0;
        while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
        return (unit === 0 ? value : value.toFixed(1)) + ' ' + units[unit];
      }

      function renderFinding(finding) {
        const card = element('article', '', 'lens-card finding');
        card.dataset.kind = finding.kind;
        card.append(element('h3', finding.fieldPath, 'lens-card-title'));
        card.append(element('p', finding.label + ' · ' + finding.severity, 'lens-card-meta'));
        card.append(element('p', finding.reason));
        if (finding.declared || finding.served) {
          const shapes = element('div', '', 'shape-row');
          if (finding.declared) shapes.append(element('span', 'declared: ' + finding.declared));
          if (finding.served) shapes.append(element('span', 'served: ' + finding.served));
          card.append(shapes);
        }
        if (finding.hasTarget) {
          const actions = element('div', '', 'lens-card-actions');
          actions.append(button('Open', 'openFinding', finding.id));
          actions.append(button('Ask Atlas', 'askFinding', finding.id));
          card.append(actions);
        }
        return card;
      }

      function renderReach(item) {
        const card = element('article', '', 'lens-card finding');
        card.dataset.outcome = item.outcome;
        card.append(element('h3', item.label, 'lens-card-title'));
        card.append(element('p', item.kind + ' · ' + item.stage + ' · ' + item.outcome
          + (item.latencyMs === null ? '' : ' · ' + item.latencyMs + 'ms'), 'lens-card-meta'));
        card.append(element('p', item.reason));
        if (item.dangling) card.append(element('p', 'Names a contract the repository no longer has: ' + item.dangling));
        return card;
      }

      function renderTrust(item) {
        const card = element('article', '', 'lens-card finding');
        card.dataset.status = item.status;
        card.append(element('h3', item.fieldPath, 'lens-card-title'));
        card.append(element('p', item.status + (item.classification ? ' · ' + item.classification : '')
          + (item.controls ? ' · ' + item.controls : ''), 'lens-card-meta'));
        card.append(element('p', item.reason));
        return card;
      }

      function button(label, action, id) {
        const value = element('button', label, 'lens-button');
        value.type = 'button'; value.dataset.action = action; value.dataset.findingId = id;
        return action === 'askFinding'
          ? makeAtlasDiscussButton(value, 'Ask Atlas about this live finding', 'Open this live contract finding in Atlas Chat')
          : value;
      }
      function element(tag, text, className) {
        const value = document.createElement(tag);
        if (text) value.textContent = text;
        if (className) value.className = className;
        return value;
      }
      vscode.postMessage({ type: 'ready' });
    `,
  });
}

/** Whether the text carries a C0 control character or DEL. */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
