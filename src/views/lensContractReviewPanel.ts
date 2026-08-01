import * as vscode from 'vscode';

import {
  normalizeLensContract,
  normalizeLensContractMappingFile,
  reviewLensContractWiring,
} from '../core/lensContract.js';
import {
  buildLensContextPatch,
  buildLensDraftPrompt,
  normalizeLensTarget,
} from '../core/lensTarget.js';
import type {
  LensContract,
  LensContractField,
  LensContractMappingFile,
  LensContractReview,
  LensFieldWire,
  LensVisualTarget,
} from '../types.js';
import { revealPreferredChatSurface } from './chatPanel.js';
import { getWebviewHtmlShell } from './webviewUtils.js';

export interface LensContractReviewPanelInput {
  upstream: LensContract;
  downstream: LensContract;
  mappingFile: LensContractMappingFile;
  sourceNotices?: string[];
}

interface LensContractReviewSnapshot {
  version: 1;
  upstream: LensContract;
  downstream: LensContract;
  review: LensContractReview;
  notices: string[];
}

type LensContractReviewMessage =
  | { type: 'ready' }
  | { type: 'openField'; fieldId: string }
  | { type: 'askField'; fieldId: string }
  | { type: 'askWire'; wireId: string };

/** Secure field-wiring board for two normalized adjacent contract layers. */
export class LensContractReviewPanel {
  private static currentPanel: LensContractReviewPanel | undefined;
  private static readonly viewType = 'atlasmind.lensContractReview';

  private readonly disposables: vscode.Disposable[] = [];
  private fieldById = new Map<string, LensContractField>();
  private wireById = new Map<string, LensFieldWire>();
  private ready = false;

  public static createOrShow(candidate: LensContractReviewPanelInput): void {
    const snapshot = normalizePanelInput(candidate);
    if (!snapshot) {
      void vscode.window.showWarningMessage('AtlasMind Lens refused an invalid contract review.');
      return;
    }
    if (LensContractReviewPanel.currentPanel) {
      LensContractReviewPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      LensContractReviewPanel.currentPanel.replaceSnapshot(snapshot);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      LensContractReviewPanel.viewType,
      'Lens — Field Wiring',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    LensContractReviewPanel.currentPanel = new LensContractReviewPanel(panel, snapshot);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private snapshot: LensContractReviewSnapshot,
  ) {
    this.indexSnapshot(snapshot);
    this.panel.webview.html = buildContractReviewHtml(this.panel.webview.cspSource);
    this.panel.webview.onDidReceiveMessage(
      (raw: unknown) => {
        const message = normalizeMessage(raw);
        if (message) {
          void this.handleMessage(message);
        }
      },
      null,
      this.disposables,
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private replaceSnapshot(snapshot: LensContractReviewSnapshot): void {
    this.snapshot = snapshot;
    this.indexSnapshot(snapshot);
    if (this.ready) {
      void this.panel.webview.postMessage({ type: 'snapshot', snapshot });
    }
  }

  private indexSnapshot(snapshot: LensContractReviewSnapshot): void {
    this.fieldById = new Map(
      [...snapshot.upstream.fields, ...snapshot.downstream.fields].map(field => [field.id, field]),
    );
    this.wireById = new Map(snapshot.review.wires.map(wire => [wire.id, wire]));
  }

  private async handleMessage(message: LensContractReviewMessage): Promise<void> {
    if (message.type === 'ready') {
      this.ready = true;
      await this.panel.webview.postMessage({ type: 'snapshot', snapshot: this.snapshot });
      return;
    }
    if (message.type === 'askWire') {
      const wire = this.wireById.get(message.wireId);
      const relation = wire ? this.createWireTarget(wire) : undefined;
      if (relation) {
        await revealPreferredChatSurface({
          draftPrompt: buildLensDraftPrompt(relation),
          contextPatch: buildLensContextPatch(relation),
        });
      }
      return;
    }

    const field = this.fieldById.get(message.fieldId);
    const target = normalizeLensTarget(field?.target);
    if (!target) {
      return;
    }
    if (message.type === 'askField') {
      await revealPreferredChatSurface({
        draftPrompt: buildLensDraftPrompt(target),
        contextPatch: buildLensContextPatch(target),
      });
      return;
    }
    const uri = resolveWorkspaceTarget(target);
    if (!uri) {
      void vscode.window.showWarningMessage('AtlasMind Lens refused an invalid or out-of-workspace contract field target.');
      return;
    }
    await vscode.window.showTextDocument(uri, {
      preview: false,
      ...(target.range ? { selection: toSelection(target) } : {}),
    });
  }

  private createWireTarget(wire: LensFieldWire): LensVisualTarget | undefined {
    const fromField = wire.fromFieldId ? this.fieldById.get(wire.fromFieldId) : undefined;
    const toField = wire.toFieldId ? this.fieldById.get(wire.toFieldId) : undefined;
    const anchor = normalizeLensTarget(fromField?.target) ?? normalizeLensTarget(toField?.target);
    if (!anchor) {
      return undefined;
    }
    const fromLabel = wire.from?.fieldPath ?? '∅';
    const toLabel = wire.to?.fieldPath ?? '∅';
    return normalizeLensTarget({
      ...anchor,
      id: `lens:relation:${wire.id}`,
      kind: 'relation',
      label: `${fromLabel} → ${toLabel}`,
      detail: `${wire.status}: ${wire.reason}`,
      evidence: wire.evidence,
    });
  }

  private dispose(): void {
    LensContractReviewPanel.currentPanel = undefined;
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }
}

function normalizePanelInput(value: LensContractReviewPanelInput): LensContractReviewSnapshot | undefined {
  const upstream = normalizeLensContract(value.upstream);
  const downstream = normalizeLensContract(value.downstream);
  const mappingFile = normalizeLensContractMappingFile(value.mappingFile);
  if (!upstream || !downstream || !mappingFile) {
    return undefined;
  }
  const sourceNotices = Array.isArray(value.sourceNotices)
    ? value.sourceNotices
      .slice(0, 50)
      .map(notice => normalizeNotice(notice))
      .filter((notice): notice is string => Boolean(notice))
    : [];
  const review = reviewLensContractWiring(upstream, downstream, mappingFile);
  return {
    version: 1,
    upstream,
    downstream,
    review,
    notices: [...sourceNotices, ...review.notices].slice(0, 50),
  };
}

function normalizeMessage(value: unknown): LensContractReviewMessage | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }
  if (value.type === 'ready') {
    return { type: 'ready' };
  }
  if (
    (value.type === 'openField' || value.type === 'askField') &&
    boundedId(value.fieldId)
  ) {
    return { type: value.type, fieldId: value.fieldId as string };
  }
  if (value.type === 'askWire' && boundedId(value.wireId)) {
    return { type: 'askWire', wireId: value.wireId as string };
  }
  return undefined;
}

function boundedId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 500 &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function normalizeNotice(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 400) : undefined;
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
  return resolved &&
    resolved.name === target.workspace.name &&
    resolved.index === target.workspace.index &&
    normalizeRelativePath(vscode.workspace.asRelativePath(uri, false)) === target.workspacePath
    ? uri
    : undefined;
}

function toSelection(target: LensVisualTarget): vscode.Selection | undefined {
  return target.range
    ? new vscode.Selection(
      target.range.startLine - 1,
      target.range.startColumn - 1,
      target.range.endLine - 1,
      target.range.endColumn - 1,
    )
    : undefined;
}

function normalizeRelativePath(value: string): string | undefined {
  const normalized = value.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    return undefined;
  }
  const segments = normalized.split('/');
  return segments.some(segment => !segment || segment === '.' || segment === '..')
    ? undefined
    : segments.join('/');
}

function buildContractReviewHtml(cspSource: string): string {
  return getWebviewHtmlShell({
    title: 'AtlasMind Lens — Field Wiring',
    cspSource,
    bodyContent: `
      <main class="wiring-shell">
        <header class="wiring-header">
          <div>
            <p class="eyebrow">AtlasMind Lens</p>
            <h1>Field wiring</h1>
            <p id="wiring-summary">Loading normalized contract evidence…</p>
          </div>
          <div class="filters" aria-label="Wiring filters">
            <label for="status-filter">Status</label>
            <select id="status-filter">
              <option value="all">All</option>
              <option value="exact">Exact</option>
              <option value="transformed">Transformed</option>
              <option value="dropped">Dropped</option>
              <option value="introduced">Introduced</option>
              <option value="incompatible">Incompatible</option>
              <option value="unverified">Unverified</option>
              <option value="inferred">Inferred</option>
            </select>
            <label class="suppression-toggle"><input id="show-suppressed" type="checkbox" checked /> Show suppressed</label>
          </div>
        </header>
        <ul id="wiring-notices" class="notices" aria-label="Evidence notices"></ul>
        <div class="table-scroll">
          <table>
            <thead><tr><th id="upstream-heading">Upstream</th><th>Status</th><th id="downstream-heading">Downstream</th><th>Evidence and actions</th></tr></thead>
            <tbody id="wiring-rows"></tbody>
          </table>
        </div>
      </main>
    `,
    extraCss: `
      .wiring-shell { max-width: 1500px; margin: 0 auto; }
      .wiring-header { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; }
      .wiring-header h1 { margin: 0; }
      .wiring-header p { margin: 4px 0 0; color: var(--vscode-descriptionForeground); }
      .eyebrow { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
      .filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .filters select { border: 1px solid var(--vscode-dropdown-border); padding: 4px 7px; }
      .suppression-toggle { display: inline-flex; align-items: center; gap: 5px; color: var(--vscode-descriptionForeground); }
      .notices { padding-left: 20px; color: var(--vscode-descriptionForeground); }
      .table-scroll { overflow: auto; border: 1px solid var(--vscode-widget-border); border-radius: 7px; }
      table { min-width: 840px; margin: 0; }
      th { position: sticky; top: 0; z-index: 1; background: var(--vscode-editor-background); }
      td { vertical-align: top; }
      .field-name { display: block; font-weight: 650; }
      .field-shape, .wire-reason, .wire-evidence, .suppression { display: block; margin-top: 3px; color: var(--vscode-descriptionForeground); font-size: 0.82rem; }
      .field-actions, .wire-actions { display: flex; gap: 5px; margin-top: 7px; }
      .small-action { border: 1px solid var(--vscode-button-border, var(--vscode-widget-border)); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
      .small-action:hover { background: var(--vscode-button-secondaryHoverBackground); }
      .small-action:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
      .status { display: inline-block; border-radius: 999px; padding: 2px 8px; font-size: 0.76rem; font-weight: 650; border: 1px solid var(--vscode-widget-border); }
      .status-exact { color: var(--vscode-testing-iconPassed, #73c991); }
      .status-transformed, .status-inferred { color: var(--vscode-charts-blue, #75beff); }
      .status-incompatible, .status-dropped { color: var(--vscode-testing-iconFailed, #f14c4c); }
      .status-introduced { color: var(--vscode-charts-purple, #b180d7); }
      .status-unverified { color: var(--vscode-editorWarning-foreground, #cca700); }
      tr.is-suppressed { opacity: 0.72; }
      .empty-cell { color: var(--vscode-descriptionForeground); }
      @media (max-width: 700px) { .wiring-header { flex-direction: column; } }
    `,
    scriptContent: `
      const vscode = acquireVsCodeApi();
      const summary = document.getElementById('wiring-summary');
      const notices = document.getElementById('wiring-notices');
      const rows = document.getElementById('wiring-rows');
      const upstreamHeading = document.getElementById('upstream-heading');
      const downstreamHeading = document.getElementById('downstream-heading');
      const statusFilter = document.getElementById('status-filter');
      const showSuppressed = document.getElementById('show-suppressed');
      let activeSnapshot;

      function textElement(parent, tag, className, value) {
        const element = document.createElement(tag);
        if (className) { element.className = className; }
        element.textContent = String(value ?? '');
        parent.appendChild(element);
        return element;
      }

      function action(parent, label, message) {
        const button = textElement(parent, 'button', 'small-action', label);
        button.type = 'button';
        button.addEventListener('click', () => vscode.postMessage(message));
      }

      function renderField(cell, field, side) {
        if (!field) { textElement(cell, 'span', 'empty-cell', '—'); return; }
        textElement(cell, 'span', 'field-name', field.path);
        textElement(cell, 'span', 'field-shape', field.dataType + (field.format ? ':' + field.format : '') + ' · ' + field.presence + ' · ' + field.nullability);
        textElement(cell, 'span', 'field-shape', field.evidence.kind + ' — ' + field.evidence.source);
        if (field.target) {
          const actions = document.createElement('div');
          actions.className = 'field-actions';
          action(actions, 'Open', { type: 'openField', fieldId: field.id });
          action(actions, 'Ask Atlas', { type: 'askField', fieldId: field.id });
          cell.appendChild(actions);
        }
        cell.setAttribute('data-side', side);
      }

      function render() {
        if (!activeSnapshot) { return; }
        rows.replaceChildren();
        const fields = new Map([...activeSnapshot.upstream.fields, ...activeSnapshot.downstream.fields].map(field => [field.id, field]));
        const status = statusFilter.value;
        const includeSuppressed = showSuppressed.checked;
        let visible = 0;
        for (const wire of activeSnapshot.review.wires) {
          if ((status !== 'all' && wire.status !== status) || (!includeSuppressed && wire.suppressed)) { continue; }
          visible += 1;
          const row = document.createElement('tr');
          row.dataset.status = wire.status;
          if (wire.suppressed) { row.className = 'is-suppressed'; }
          const fromField = wire.fromFieldId ? fields.get(wire.fromFieldId) : undefined;
          const toField = wire.toFieldId ? fields.get(wire.toFieldId) : undefined;
          const upstream = document.createElement('td');
          renderField(upstream, fromField, 'upstream');
          const statusCell = document.createElement('td');
          textElement(statusCell, 'span', 'status status-' + wire.status, wire.status);
          const downstream = document.createElement('td');
          renderField(downstream, toField, 'downstream');
          const evidence = document.createElement('td');
          textElement(evidence, 'span', 'wire-reason', wire.reason);
          textElement(evidence, 'span', 'wire-evidence', wire.evidence.kind + ' — ' + wire.evidence.source);
          if (wire.suppressed) { textElement(evidence, 'span', 'suppression', 'Suppressed: ' + (wire.suppressionReason || 'declared suppression')); }
          if (fromField?.target || toField?.target) {
            const wireActions = document.createElement('div');
            wireActions.className = 'wire-actions';
            action(wireActions, 'Ask about connection', { type: 'askWire', wireId: wire.id });
            evidence.appendChild(wireActions);
          }
          row.append(upstream, statusCell, downstream, evidence);
          rows.appendChild(row);
        }
        summary.textContent = activeSnapshot.upstream.label + ' → ' + activeSnapshot.downstream.label + ' · ' + visible + ' of ' + activeSnapshot.review.wires.length + ' wires shown' + (activeSnapshot.review.truncated ? ' · bounded view' : '');
      }

      function load(snapshot) {
        activeSnapshot = snapshot;
        upstreamHeading.textContent = snapshot.upstream.label + ' (' + snapshot.upstream.layer + ')';
        downstreamHeading.textContent = snapshot.downstream.label + ' (' + snapshot.downstream.layer + ')';
        notices.replaceChildren();
        for (const notice of snapshot.notices) { textElement(notices, 'li', '', notice); }
        render();
      }

      statusFilter.addEventListener('change', render);
      showSuppressed.addEventListener('change', render);
      window.addEventListener('message', event => {
        const message = event.data;
        if (message && message.type === 'snapshot' && message.snapshot) { load(message.snapshot); }
      });
      vscode.postMessage({ type: 'ready' });
    `,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
