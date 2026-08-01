import * as vscode from 'vscode';

import {
  normalizeLensContract,
  normalizeLensContractMappingFile,
  reviewLensContractWiring,
} from '../core/lensContract.js';
import { analyzeLensContractDrift } from '../core/lensContractDrift.js';
import { normalizeLensContractRelations } from '../core/lensContractRelations.js';
import {
  analyzeLensDataTrust,
  normalizeLensDataTrustPolicyFile,
} from '../core/lensDataTrust.js';
import { analyzeLensSchemaChangeImpact } from '../core/lensSchemaImpact.js';
import {
  buildLensContextPatch,
  buildLensDraftPrompt,
  normalizeLensTarget,
} from '../core/lensTarget.js';
import type {
  LensContract,
  LensContractDriftFinding,
  LensContractDriftReport,
  LensContractField,
  LensContractMappingFile,
  LensContractRelation,
  LensContractReview,
  LensDataTrustMap,
  LensDataTrustPolicyFile,
  LensFieldWire,
  LensSchemaChangeImpact,
  LensSchemaChangeKind,
  LensVisualTarget,
} from '../types.js';
import { revealPreferredChatSurface } from './chatPanel.js';
import { getWebviewHtmlShell } from './webviewUtils.js';

export interface LensContractReviewPanelInput {
  upstream: LensContract;
  downstream: LensContract;
  mappingFile: LensContractMappingFile;
  dataTrustPolicy: LensDataTrustPolicyFile;
  relations?: LensContractRelation[];
  sourceNotices?: string[];
}

interface LensContractReviewSnapshot {
  version: 1;
  upstream: LensContract;
  downstream: LensContract;
  review: LensContractReview;
  drift: LensContractDriftReport;
  relations: LensContractRelation[];
  notices: string[];
}

interface NormalizedLensContractReviewPanelInput {
  snapshot: LensContractReviewSnapshot;
  dataTrustPolicy: LensDataTrustPolicyFile;
}

type LensContractReviewMessage =
  | { type: 'ready' }
  | { type: 'openField'; fieldId: string }
  | { type: 'askField'; fieldId: string }
  | { type: 'askWire'; wireId: string }
  | { type: 'previewImpact'; fieldId: string }
  | { type: 'openImpact'; impactItemId: string }
  | { type: 'askImpact'; impactItemId: string }
  | { type: 'previewTrust'; fieldId: string }
  | { type: 'openTrust'; trustItemId: string }
  | { type: 'askTrust'; trustItemId: string }
  | { type: 'openRelation'; relationId: string }
  | { type: 'askRelation'; relationId: string };

interface ImpactChangePick extends vscode.QuickPickItem {
  changeKind: LensSchemaChangeKind;
}

const IMPACT_CHANGE_PICKS: ImpactChangePick[] = [
  { label: '$(edit) Rename field', description: 'Preview compatibility, mapping, migration, and rollout implications.', changeKind: 'rename' },
  { label: '$(trash) Remove field', description: 'Preview consumers, staged removal, retention, and rollback implications.', changeKind: 'remove' },
  { label: '$(symbol-keyword) Change type', description: 'Preview serialization, cast, persistence, and compatibility implications.', changeKind: 'type' },
  { label: '$(symbol-string) Change format', description: 'Preview validation, serialization, and historical-data implications.', changeKind: 'format' },
  { label: '$(question) Change required/optional', description: 'Preview request, validation, default, and stored-data implications.', changeKind: 'presence' },
  { label: '$(circle-outline) Change nullability', description: 'Preview validation, backfill, constraint, and rollout implications.', changeKind: 'nullability' },
];

/** Secure field-wiring board for two normalized adjacent contract layers. */
export class LensContractReviewPanel {
  private static currentPanel: LensContractReviewPanel | undefined;
  private static readonly viewType = 'atlasmind.lensContractReview';

  private readonly disposables: vscode.Disposable[] = [];
  private fieldById = new Map<string, LensContractField>();
  private wireById = new Map<string, LensFieldWire>();
  private findingByWireId = new Map<string, LensContractDriftFinding>();
  private impactTargetById = new Map<string, LensVisualTarget>();
  private trustTargetById = new Map<string, LensVisualTarget>();
  private relationTargetById = new Map<string, LensVisualTarget>();
  private ready = false;

  public static createOrShow(candidate: LensContractReviewPanelInput): void {
    const normalized = normalizePanelInput(candidate);
    if (!normalized) {
      void vscode.window.showWarningMessage('AtlasMind Lens refused an invalid contract review.');
      return;
    }
    if (LensContractReviewPanel.currentPanel) {
      LensContractReviewPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      LensContractReviewPanel.currentPanel.replaceInput(normalized);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      LensContractReviewPanel.viewType,
      'Lens — Field Wiring',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    LensContractReviewPanel.currentPanel = new LensContractReviewPanel(
      panel,
      normalized.snapshot,
      normalized.dataTrustPolicy,
    );
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private snapshot: LensContractReviewSnapshot,
    private dataTrustPolicy: LensDataTrustPolicyFile,
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

  private replaceInput(normalized: NormalizedLensContractReviewPanelInput): void {
    this.snapshot = normalized.snapshot;
    this.dataTrustPolicy = normalized.dataTrustPolicy;
    this.indexSnapshot(normalized.snapshot);
    if (this.ready) {
      void this.panel.webview.postMessage({ type: 'snapshot', snapshot: normalized.snapshot });
    }
  }

  private indexSnapshot(snapshot: LensContractReviewSnapshot): void {
    this.fieldById = new Map(
      [...snapshot.upstream.fields, ...snapshot.downstream.fields].map(field => [field.id, field]),
    );
    this.wireById = new Map(snapshot.review.wires.map(wire => [wire.id, wire]));
    this.findingByWireId = new Map(snapshot.drift.findings.map(finding => [finding.wireId, finding]));
    this.impactTargetById.clear();
    this.trustTargetById.clear();
    this.relationTargetById = new Map(
      snapshot.relations.flatMap(relation => {
        const target = relation.target ? normalizeLensTarget({
          ...relation.target,
          id: `lens:relation:${relation.id}`,
          kind: 'relation',
          label: relation.label,
          detail: `${relation.kind}: ${relation.from.contractLabel}.${relation.from.fieldPath} → ${relation.to.contractLabel}.${relation.to.fieldPath}`,
          evidence: relation.evidence,
        }) : undefined;
        return target ? [[relation.id, target] as const] : [];
      }),
    );
  }

  private async handleMessage(message: LensContractReviewMessage): Promise<void> {
    if (message.type === 'ready') {
      this.ready = true;
      await this.panel.webview.postMessage({ type: 'snapshot', snapshot: this.snapshot });
      return;
    }
    if (message.type === 'previewImpact') {
      await this.previewImpact(message.fieldId);
      return;
    }
    if (message.type === 'previewTrust') {
      this.previewTrust(message.fieldId);
      return;
    }
    if (message.type === 'openTrust' || message.type === 'askTrust') {
      const target = this.trustTargetById.get(message.trustItemId);
      if (!target) {
        return;
      }
      if (message.type === 'askTrust') {
        await revealPreferredChatSurface({
          draftPrompt: buildLensDraftPrompt(target),
          contextPatch: buildLensContextPatch(target),
        });
      } else {
        await this.openTarget(target);
      }
      return;
    }
    if (message.type === 'openImpact' || message.type === 'askImpact') {
      const target = this.impactTargetById.get(message.impactItemId);
      if (!target) {
        return;
      }
      if (message.type === 'askImpact') {
        await revealPreferredChatSurface({
          draftPrompt: buildLensDraftPrompt(target),
          contextPatch: buildLensContextPatch(target),
        });
      } else {
        await this.openTarget(target);
      }
      return;
    }
    if (message.type === 'openRelation' || message.type === 'askRelation') {
      const target = this.relationTargetById.get(message.relationId);
      if (!target) {
        return;
      }
      if (message.type === 'askRelation') {
        await revealPreferredChatSurface({
          draftPrompt: buildLensDraftPrompt(target),
          contextPatch: buildLensContextPatch(target),
        });
      } else {
        await this.openTarget(target);
      }
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
    await this.openTarget(target);
  }

  private async previewImpact(fieldId: string): Promise<void> {
    const field = this.fieldById.get(fieldId);
    if (!field) {
      return;
    }
    const pick = await vscode.window.showQuickPick(IMPACT_CHANGE_PICKS, {
      title: `AtlasMind Lens — preview a change to ${field.path}`,
      placeHolder: 'Choose the proposed field-shape change; AtlasMind will not edit the workspace',
      matchOnDescription: true,
    });
    if (!pick) {
      return;
    }
    const impact = analyzeLensSchemaChangeImpact({
      upstream: this.snapshot.upstream,
      downstream: this.snapshot.downstream,
      review: this.snapshot.review,
      relations: this.snapshot.relations,
      seedFieldId: field.id,
      changeKind: pick.changeKind,
    });
    this.indexImpact(impact);
    await this.panel.webview.postMessage({ type: 'impact', impact });
  }

  private indexImpact(impact: LensSchemaChangeImpact): void {
    this.impactTargetById = new Map(
      impact.items
        .filter(item => Boolean(item.target))
        .map(item => [item.id, item.target!]),
    );
  }

  private previewTrust(fieldId: string): void {
    if (!this.fieldById.has(fieldId)) {
      return;
    }
    const dataTrust = analyzeLensDataTrust({
      upstream: this.snapshot.upstream,
      downstream: this.snapshot.downstream,
      review: this.snapshot.review,
      policy: this.dataTrustPolicy,
      seedFieldId: fieldId,
    });
    this.indexTrust(dataTrust);
    void this.panel.webview.postMessage({ type: 'dataTrust', dataTrust });
  }

  private indexTrust(dataTrust: LensDataTrustMap): void {
    this.trustTargetById = new Map(
      dataTrust.items
        .filter(item => Boolean(item.target))
        .map(item => [item.id, item.target!]),
    );
  }

  private async openTarget(target: LensVisualTarget): Promise<void> {
    const uri = resolveWorkspaceTarget(target);
    if (!uri) {
      void vscode.window.showWarningMessage('AtlasMind Lens refused an invalid or out-of-workspace contract target.');
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
    const finding = this.findingByWireId.get(wire.id);
    return normalizeLensTarget({
      ...anchor,
      id: `lens:relation:${wire.id}`,
      kind: 'relation',
      label: `${fromLabel} → ${toLabel}`,
      detail: finding
        ? `${finding.findingClass} (${finding.severity}): ${finding.reason}`
        : `${wire.status}: ${wire.reason}`,
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

function normalizePanelInput(value: LensContractReviewPanelInput): NormalizedLensContractReviewPanelInput | undefined {
  const upstream = normalizeLensContract(value.upstream);
  const downstream = normalizeLensContract(value.downstream);
  const mappingFile = normalizeLensContractMappingFile(value.mappingFile);
  const dataTrustPolicy = normalizeLensDataTrustPolicyFile(value.dataTrustPolicy);
  const allRelations = normalizeLensContractRelations(value.relations ?? []);
  if (!upstream || !downstream || !mappingFile || !dataTrustPolicy || !allRelations) {
    return undefined;
  }
  const sourceNotices = Array.isArray(value.sourceNotices)
    ? value.sourceNotices
      .slice(0, 50)
      .map(notice => normalizeNotice(notice))
      .filter((notice): notice is string => Boolean(notice))
    : [];
  const review = reviewLensContractWiring(upstream, downstream, mappingFile);
  const drift = analyzeLensContractDrift(review);
  const relationContractIds = new Set([upstream.id, downstream.id]);
  const relationLabels = new Set([upstream.label.toLowerCase(), downstream.label.toLowerCase()]);
  const relations = allRelations.filter(relation =>
    (relation.from.contractId && relationContractIds.has(relation.from.contractId)) ||
    (relation.to.contractId && relationContractIds.has(relation.to.contractId)) ||
    relationLabels.has(relation.from.contractLabel.toLowerCase()) ||
    relationLabels.has(relation.to.contractLabel.toLowerCase()),
  );
  return {
    dataTrustPolicy,
    snapshot: {
      version: 1,
      upstream,
      downstream,
      review,
      drift,
      relations,
      notices: [...sourceNotices, ...review.notices, ...drift.notices].slice(0, 50),
    },
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
    (value.type === 'openField' || value.type === 'askField' || value.type === 'previewImpact' || value.type === 'previewTrust') &&
    boundedId(value.fieldId)
  ) {
    return { type: value.type, fieldId: value.fieldId as string };
  }
  if (value.type === 'askWire' && boundedId(value.wireId)) {
    return { type: 'askWire', wireId: value.wireId as string };
  }
  if (
    (value.type === 'openImpact' || value.type === 'askImpact') &&
    boundedId(value.impactItemId)
  ) {
    return { type: value.type, impactItemId: value.impactItemId as string };
  }
  if (
    (value.type === 'openTrust' || value.type === 'askTrust') &&
    boundedId(value.trustItemId)
  ) {
    return { type: value.type, trustItemId: value.trustItemId as string };
  }
  if (
    (value.type === 'openRelation' || value.type === 'askRelation') &&
    boundedId(value.relationId)
  ) {
    return { type: value.type, relationId: value.relationId as string };
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
            <label for="finding-filter">Finding</label>
            <select id="finding-filter">
              <option value="all">All rows</option>
              <option value="findings">Findings only</option>
              <option value="definite-conflict">Definite conflict</option>
              <option value="likely-drift">Likely drift</option>
              <option value="missing-evidence">Missing evidence</option>
              <option value="intentional-transform">Intentional transform</option>
              <option value="dead-wire">Dead wire</option>
              <option value="dropped-wire">Dropped wire</option>
              <option value="undocumented-wire">Undocumented wire</option>
            </select>
            <label class="suppression-toggle"><input id="show-suppressed" type="checkbox" checked /> Show suppressed</label>
          </div>
        </header>
        <section class="drift-review" aria-labelledby="drift-heading">
          <div>
            <p class="eyebrow">Evidence-based triage</p>
            <h2 id="drift-heading">Contract drift review</h2>
          </div>
          <dl class="drift-summary" aria-label="Contract finding summary">
            <div><dt>Active</dt><dd id="drift-active">0</dd></div>
            <div><dt>Conflicts</dt><dd id="drift-errors">0</dd></div>
            <div><dt>Warnings</dt><dd id="drift-warnings">0</dd></div>
            <div><dt>Missing evidence</dt><dd id="drift-missing">0</dd></div>
            <div><dt>Suppressed</dt><dd id="drift-suppressed">0</dd></div>
          </dl>
        </section>
        <section id="relationship-map" class="relationship-map" aria-labelledby="relationship-heading" hidden>
          <div>
            <p class="eyebrow">Declared traversal evidence</p>
            <h2 id="relationship-heading">Relationship map</h2>
            <p id="relationship-summary"></p>
          </div>
          <div id="relationship-items" class="relationship-items" role="list" aria-label="Declared contract relationships"></div>
        </section>
        <ul id="wiring-notices" class="notices" aria-label="Evidence notices"></ul>
        <section id="impact-preview" class="impact-preview" aria-labelledby="impact-heading" hidden>
          <div class="impact-header">
            <div>
              <p class="eyebrow">Proposed change — no edits made</p>
              <h2 id="impact-heading">Schema change impact</h2>
              <p id="impact-summary"></p>
            </div>
            <button id="close-impact" type="button" class="small-action">Close preview</button>
          </div>
          <ul id="impact-notices" class="notices" aria-label="Impact evidence notices"></ul>
          <div id="impact-items" class="impact-items" role="list" aria-label="Ranked impact items"></div>
        </section>
        <section id="trust-preview" class="trust-preview" aria-labelledby="trust-heading" hidden>
          <div class="impact-header">
            <div>
              <p class="eyebrow">Declared policy metadata — no data values</p>
              <h2 id="trust-heading">Data trust map</h2>
              <p id="trust-summary"></p>
            </div>
            <button id="close-trust" type="button" class="small-action">Close map</button>
          </div>
          <ul id="trust-notices" class="notices" aria-label="Data trust evidence notices"></ul>
          <div id="trust-items" class="trust-items" role="list" aria-label="Data trust field journey"></div>
        </section>
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
      .drift-review { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; margin: 18px 0 8px; padding: 13px; border: 1px solid var(--vscode-widget-border); border-radius: 7px; }
      .drift-review h2 { margin: 0; font-size: 1rem; }
      .drift-summary { display: flex; flex-wrap: wrap; gap: 9px; margin: 0; }
      .drift-summary div { min-width: 82px; padding: 7px 9px; border-radius: 5px; background: var(--vscode-editorWidget-background); }
      .drift-summary dt { color: var(--vscode-descriptionForeground); font-size: 0.72rem; }
      .drift-summary dd { margin: 2px 0 0; font-size: 1.05rem; font-weight: 700; }
      .relationship-map { margin: 14px 0; padding: 13px; border: 1px solid var(--vscode-widget-border); border-radius: 7px; }
      .relationship-map[hidden] { display: none; }
      .relationship-map h2 { margin: 0; font-size: 1rem; }
      .relationship-map p { margin: 4px 0 0; color: var(--vscode-descriptionForeground); }
      .relationship-items { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; margin-top: 10px; }
      .relationship-item { padding: 9px; border: 1px solid var(--vscode-widget-border); border-radius: 5px; background: var(--vscode-editorWidget-background); }
      .relationship-path { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; font-weight: 700; }
      .relationship-arrow { color: var(--vscode-charts-blue, #75beff); }
      .relationship-meta, .relationship-evidence { display: block; margin-top: 5px; color: var(--vscode-descriptionForeground); font-size: 0.8rem; }
      .impact-preview { margin: 14px 0; padding: 13px; border: 1px solid var(--vscode-focusBorder); border-radius: 7px; background: var(--vscode-editorWidget-background); }
      .impact-preview[hidden] { display: none; }
      .impact-header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
      .impact-header h2 { margin: 0; }
      .impact-header p { margin: 4px 0 0; color: var(--vscode-descriptionForeground); }
      .impact-items { display: grid; gap: 8px; }
      .impact-item { padding: 9px; border: 1px solid var(--vscode-widget-border); border-radius: 5px; background: var(--vscode-editor-background); }
      .impact-item-head { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
      .impact-label { font-weight: 700; }
      .impact-meta, .impact-detail, .impact-evidence { display: block; margin-top: 4px; color: var(--vscode-descriptionForeground); font-size: 0.82rem; }
      .impact-severity { border-radius: 999px; padding: 2px 7px; font-size: 0.72rem; font-weight: 700; border: 1px solid var(--vscode-widget-border); }
      .impact-severity-high { color: var(--vscode-testing-iconFailed, #f14c4c); }
      .impact-severity-medium { color: var(--vscode-editorWarning-foreground, #cca700); }
      .impact-severity-review { color: var(--vscode-descriptionForeground); }
      .trust-preview { margin: 14px 0; padding: 13px; border: 1px solid var(--vscode-charts-purple, var(--vscode-focusBorder)); border-radius: 7px; background: var(--vscode-editorWidget-background); }
      .trust-preview[hidden] { display: none; }
      .trust-items { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 8px; }
      .trust-item { padding: 9px; border: 1px solid var(--vscode-widget-border); border-left: 3px solid var(--vscode-charts-purple, #b180d7); border-radius: 5px; background: var(--vscode-editor-background); }
      .trust-item[data-status="unknown"] { border-left-color: var(--vscode-editorWarning-foreground, #cca700); }
      .trust-label { font-weight: 700; }
      .trust-meta, .trust-controls, .trust-note, .trust-evidence { display: block; margin-top: 4px; color: var(--vscode-descriptionForeground); font-size: 0.82rem; }
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
      .finding { display: block; margin-top: 6px; font-size: 0.78rem; font-weight: 650; }
      .finding-error { color: var(--vscode-testing-iconFailed, #f14c4c); }
      .finding-warning { color: var(--vscode-editorWarning-foreground, #cca700); }
      .finding-info { color: var(--vscode-descriptionForeground); }
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
      const findingFilter = document.getElementById('finding-filter');
      const showSuppressed = document.getElementById('show-suppressed');
      const impactPreview = document.getElementById('impact-preview');
      const impactSummary = document.getElementById('impact-summary');
      const impactNotices = document.getElementById('impact-notices');
      const impactItems = document.getElementById('impact-items');
      const closeImpact = document.getElementById('close-impact');
      const trustPreview = document.getElementById('trust-preview');
      const trustSummary = document.getElementById('trust-summary');
      const trustNotices = document.getElementById('trust-notices');
      const trustItems = document.getElementById('trust-items');
      const closeTrust = document.getElementById('close-trust');
      const relationshipMap = document.getElementById('relationship-map');
      const relationshipSummary = document.getElementById('relationship-summary');
      const relationshipItems = document.getElementById('relationship-items');
      const driftActive = document.getElementById('drift-active');
      const driftErrors = document.getElementById('drift-errors');
      const driftWarnings = document.getElementById('drift-warnings');
      const driftMissing = document.getElementById('drift-missing');
      const driftSuppressed = document.getElementById('drift-suppressed');
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
        const actions = document.createElement('div');
        actions.className = 'field-actions';
        if (field.target) {
          action(actions, 'Open', { type: 'openField', fieldId: field.id });
          action(actions, 'Ask Atlas', { type: 'askField', fieldId: field.id });
        }
        action(actions, 'Preview impact', { type: 'previewImpact', fieldId: field.id });
        action(actions, 'Review trust', { type: 'previewTrust', fieldId: field.id });
        cell.appendChild(actions);
        cell.setAttribute('data-side', side);
      }

      function renderImpact(impact) {
        impactPreview.hidden = false;
        impactSummary.textContent = impact.changeKind + ' · ' + impact.items.length + ' ranked implications' + (impact.truncated ? ' · bounded view' : '');
        impactNotices.replaceChildren();
        for (const notice of impact.notices) { textElement(impactNotices, 'li', '', notice); }
        impactItems.replaceChildren();
        for (const item of impact.items) {
          const container = document.createElement('article');
          container.className = 'impact-item';
          container.setAttribute('role', 'listitem');
          const head = document.createElement('div');
          head.className = 'impact-item-head';
          textElement(head, 'span', 'impact-label', item.label);
          textElement(head, 'span', 'impact-severity impact-severity-' + item.severity, item.severity);
          container.appendChild(head);
          textElement(container, 'span', 'impact-meta', item.category + ' · proximity ' + item.proximity);
          textElement(container, 'span', 'impact-detail', item.detail);
          textElement(container, 'span', 'impact-evidence', item.evidence.kind + ' — ' + item.evidence.source);
          if (item.target) {
            const actions = document.createElement('div');
            actions.className = 'field-actions';
            action(actions, 'Open', { type: 'openImpact', impactItemId: item.id });
            action(actions, 'Ask Atlas', { type: 'askImpact', impactItemId: item.id });
            container.appendChild(actions);
          }
          impactItems.appendChild(container);
        }
        impactPreview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      function renderTrust(dataTrust) {
        trustPreview.hidden = false;
        const declared = dataTrust.items.filter(item => item.status === 'declared').length;
        trustSummary.textContent = dataTrust.items.length + ' field endpoints · ' + declared + ' with declared trust metadata' + (dataTrust.truncated ? ' · bounded view' : '');
        trustNotices.replaceChildren();
        for (const notice of dataTrust.notices) { textElement(trustNotices, 'li', '', notice); }
        trustItems.replaceChildren();
        for (const item of dataTrust.items) {
          const container = document.createElement('article');
          container.className = 'trust-item';
          container.dataset.status = item.status;
          container.setAttribute('role', 'listitem');
          textElement(container, 'span', 'trust-label', item.label);
          textElement(container, 'span', 'trust-meta', item.status + ' · ' + (item.classification || 'classification unknown') + ' · proximity ' + item.proximity);
          textElement(container, 'span', 'trust-controls', item.controls.length ? 'Declared controls: ' + item.controls.join(', ') : 'No controls declared for this endpoint');
          if (item.note) { textElement(container, 'span', 'trust-note', item.note); }
          textElement(container, 'span', 'trust-evidence', item.evidence.kind + ' — ' + item.evidence.source);
          if (item.target) {
            const actions = document.createElement('div');
            actions.className = 'field-actions';
            action(actions, 'Open', { type: 'openTrust', trustItemId: item.id });
            action(actions, 'Ask Atlas', { type: 'askTrust', trustItemId: item.id });
            container.appendChild(actions);
          }
          trustItems.appendChild(container);
        }
        trustPreview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      function renderRelationships(relations) {
        relationshipItems.replaceChildren();
        relationshipMap.hidden = relations.length === 0;
        if (relations.length === 0) { return; }
        const resolved = relations.filter(relation => relation.from.fieldId && relation.to.fieldId).length;
        relationshipSummary.textContent = relations.length + ' declared relation' + (relations.length === 1 ? '' : 's') + ' · ' + resolved + ' fully resolved in the bounded declaration set';
        for (const relation of relations) {
          const item = document.createElement('article');
          item.className = 'relationship-item';
          item.setAttribute('role', 'listitem');
          const path = document.createElement('div');
          path.className = 'relationship-path';
          textElement(path, 'span', '', relation.from.contractLabel + '.' + relation.from.fieldPath);
          textElement(path, 'span', 'relationship-arrow', '→');
          textElement(path, 'span', '', relation.to.contractLabel + '.' + relation.to.fieldPath);
          item.appendChild(path);
          textElement(item, 'span', 'relationship-meta', relation.kind + ' · ' + (relation.from.fieldId && relation.to.fieldId ? 'resolved endpoints' : 'unresolved endpoint'));
          textElement(item, 'span', 'relationship-evidence', relation.evidence.kind + ' — ' + relation.evidence.source);
          if (relation.target) {
            const actions = document.createElement('div');
            actions.className = 'field-actions';
            action(actions, 'Open declaration', { type: 'openRelation', relationId: relation.id });
            action(actions, 'Ask Atlas', { type: 'askRelation', relationId: relation.id });
            item.appendChild(actions);
          }
          relationshipItems.appendChild(item);
        }
      }

      function render() {
        if (!activeSnapshot) { return; }
        rows.replaceChildren();
        const fields = new Map([...activeSnapshot.upstream.fields, ...activeSnapshot.downstream.fields].map(field => [field.id, field]));
        const findings = new Map(activeSnapshot.drift.findings.map(finding => [finding.wireId, finding]));
        const status = statusFilter.value;
        const findingClass = findingFilter.value;
        const includeSuppressed = showSuppressed.checked;
        let visible = 0;
        for (const wire of activeSnapshot.review.wires) {
          const finding = findings.get(wire.id);
          if (
            (status !== 'all' && wire.status !== status) ||
            (findingClass === 'findings' && !finding) ||
            (findingClass !== 'all' && findingClass !== 'findings' && finding?.findingClass !== findingClass) ||
            (!includeSuppressed && wire.suppressed)
          ) { continue; }
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
          if (finding) {
            textElement(evidence, 'span', 'finding finding-' + finding.severity, finding.label + ' · ' + finding.findingClass + ' · ' + finding.severity);
          }
          if (wire.suppressed) { textElement(evidence, 'span', 'suppression', 'Suppressed: ' + (wire.suppressionReason || 'declared suppression')); }
          if (fromField?.target || toField?.target) {
            const wireActions = document.createElement('div');
            wireActions.className = 'wire-actions';
            action(wireActions, finding ? 'Ask about finding' : 'Ask about connection', { type: 'askWire', wireId: wire.id });
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
        driftActive.textContent = String(snapshot.drift.summary.active);
        driftErrors.textContent = String(snapshot.drift.summary.errors);
        driftWarnings.textContent = String(snapshot.drift.summary.warnings);
        driftMissing.textContent = String(snapshot.drift.summary.byClass['missing-evidence']);
        driftSuppressed.textContent = String(snapshot.drift.summary.suppressed);
        renderRelationships(snapshot.relations);
        notices.replaceChildren();
        for (const notice of snapshot.notices) { textElement(notices, 'li', '', notice); }
        render();
      }

      statusFilter.addEventListener('change', render);
      findingFilter.addEventListener('change', render);
      showSuppressed.addEventListener('change', render);
      closeImpact.addEventListener('click', () => { impactPreview.hidden = true; });
      closeTrust.addEventListener('click', () => { trustPreview.hidden = true; });
      window.addEventListener('message', event => {
        const message = event.data;
        if (message && message.type === 'snapshot' && message.snapshot) { load(message.snapshot); }
        if (message && message.type === 'impact' && message.impact) { renderImpact(message.impact); }
        if (message && message.type === 'dataTrust' && message.dataTrust) { renderTrust(message.dataTrust); }
      });
      vscode.postMessage({ type: 'ready' });
    `,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
