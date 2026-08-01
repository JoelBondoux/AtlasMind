import * as vscode from 'vscode';

import { analyzeLensTestMap } from '../core/lensTestMap.js';
import {
  buildLensActionDraftPrompt,
  buildLensContextPatch,
  normalizeLensTarget,
} from '../core/lensTarget.js';
import type { LensGraph, LensTestMap, LensVisualTarget } from '../types.js';
import { revealPreferredChatSurface } from './chatPanel.js';
import { getWebviewHtmlShell } from './webviewUtils.js';

type LensTestMessage =
  | { type: 'ready' }
  | { type: 'openTarget'; targetId: string }
  | { type: 'askTarget'; targetId: string };

/** Secure view of source-backed, conservatively classified test evidence. */
export class LensTestPanel {
  private static currentPanel: LensTestPanel | undefined;
  private static readonly viewType = 'atlasmind.lensTestMap';

  private readonly disposables: vscode.Disposable[] = [];
  private readonly targetById = new Map<string, LensVisualTarget>();
  private ready = false;

  public static createOrShow(candidate: LensGraph): void {
    let testMap: LensTestMap;
    try {
      testMap = analyzeLensTestMap(candidate);
    } catch {
      void vscode.window.showWarningMessage('AtlasMind Lens refused an invalid test-evidence graph.');
      return;
    }
    if (LensTestPanel.currentPanel) {
      LensTestPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      LensTestPanel.currentPanel.replaceTestMap(testMap);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      LensTestPanel.viewType,
      'Lens — Test & Behaviour',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    LensTestPanel.currentPanel = new LensTestPanel(panel, testMap);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private testMap: LensTestMap,
  ) {
    this.indexTargets(testMap);
    this.panel.webview.html = buildTestMapHtml(this.panel.webview.cspSource);
    this.panel.webview.onDidReceiveMessage(
      (raw: unknown) => {
        const message = normalizeTestMessage(raw);
        if (message) {
          void this.handleMessage(message);
        }
      },
      null,
      this.disposables,
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private replaceTestMap(testMap: LensTestMap): void {
    this.testMap = testMap;
    this.indexTargets(testMap);
    if (this.ready) {
      void this.panel.webview.postMessage({ type: 'testMap', testMap });
    }
  }

  private indexTargets(testMap: LensTestMap): void {
    this.targetById.clear();
    this.targetById.set(testMap.root.id, testMap.root);
    for (const item of testMap.items) {
      this.targetById.set(item.id, item.target);
    }
  }

  private async handleMessage(message: LensTestMessage): Promise<void> {
    if (message.type === 'ready') {
      this.ready = true;
      await this.panel.webview.postMessage({ type: 'testMap', testMap: this.testMap });
      return;
    }
    const target = normalizeLensTarget(this.targetById.get(message.targetId));
    if (!target) {
      return;
    }
    if (message.type === 'openTarget') {
      const uri = resolveWorkspaceTarget(target);
      if (!uri) {
        void vscode.window.showWarningMessage('AtlasMind Lens refused an invalid or out-of-workspace test target.');
        return;
      }
      await vscode.window.showTextDocument(uri, {
        preview: false,
        ...(target.range ? { selection: toSelection(target) } : {}),
      });
      return;
    }
    await revealPreferredChatSurface({
      draftPrompt: buildLensActionDraftPrompt(target, 'tests'),
      contextPatch: buildLensContextPatch(target),
    });
  }

  private dispose(): void {
    LensTestPanel.currentPanel = undefined;
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }
}

function normalizeTestMessage(value: unknown): LensTestMessage | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }
  if (value.type === 'ready') {
    return { type: 'ready' };
  }
  if (
    (value.type === 'openTarget' || value.type === 'askTarget') &&
    boundedId(value.targetId)
  ) {
    return { type: value.type, targetId: value.targetId };
  }
  return undefined;
}

function boundedId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 500 &&
    !/[\u0000-\u001f\u007f]/.test(value);
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

function buildTestMapHtml(cspSource: string): string {
  return getWebviewHtmlShell({
    title: 'AtlasMind Lens — Test & Behaviour',
    cspSource,
    bodyContent: `
      <main class="test-shell">
        <header class="test-header">
          <div>
            <p class="eyebrow">AtlasMind Lens</p>
            <h1 id="test-title">Test &amp; behaviour evidence</h1>
            <p id="test-summary">Loading source-backed test links…</p>
          </div>
          <span class="mode-badge">Discovered evidence</span>
        </header>
        <ul id="test-notices" class="notices" aria-label="Evidence notices"></ul>
        <section class="test-map" aria-labelledby="test-title">
          <div class="selected-column">
            <h2>Selected symbol</h2>
            <div id="test-selected"></div>
          </div>
          <div class="evidence-column">
            <h2>Linked test-like sources</h2>
            <div id="test-counts" class="test-counts" aria-label="Test-kind summary"></div>
            <div id="test-items" class="test-items"></div>
          </div>
        </section>
        <details class="text-view">
          <summary>Text view</summary>
          <p>A keyboard- and screen-reader-friendly list of the same test evidence.</p>
          <ul id="test-text-items"></ul>
        </details>
      </main>
    `,
    extraCss: `
      .test-shell { max-width: 1320px; margin: 0 auto; }
      .test-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
      .test-header h1 { margin: 0; }
      .test-header p { margin: 4px 0 0; color: var(--vscode-descriptionForeground); }
      .eyebrow { font-size: 0.76rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
      .mode-badge { flex: none; border: 1px solid var(--vscode-widget-border); border-radius: 999px; padding: 4px 9px; color: var(--vscode-descriptionForeground); }
      .notices { padding-left: 20px; color: var(--vscode-descriptionForeground); }
      .test-map { display: grid; grid-template-columns: minmax(220px, 0.8fr) minmax(360px, 2fr); gap: 14px; align-items: start; }
      .selected-column, .evidence-column { padding: 12px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; }
      .selected-column { border-color: var(--vscode-focusBorder); }
      .test-map h2 { margin: 0 0 10px; color: var(--vscode-descriptionForeground); font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.06em; }
      .test-counts { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 10px; }
      .count-badge, .kind-badge { border: 1px solid var(--vscode-widget-border); border-radius: 999px; padding: 2px 7px; color: var(--vscode-descriptionForeground); font-size: 0.74rem; }
      .test-items { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 9px; }
      .test-card { padding: 10px; border: 1px solid var(--vscode-widget-border); border-left: 3px solid var(--vscode-charts-purple, #b180d7); border-radius: 6px; background: var(--vscode-editor-background); }
      .test-card[data-kind="unit"] { border-left-color: var(--vscode-charts-green, #89d185); }
      .test-card[data-kind="integration"] { border-left-color: var(--vscode-charts-blue, #75beff); }
      .test-card[data-kind="contract"] { border-left-color: var(--vscode-charts-orange, #d18616); }
      .test-card[data-kind="end-to-end"] { border-left-color: var(--vscode-charts-purple, #b180d7); }
      .test-card[data-kind="selected"] { border-left-color: var(--vscode-focusBorder); }
      .test-label { margin: 0; font-size: 0.92rem; }
      .test-location, .test-reason, .test-evidence { margin: 4px 0 0; color: var(--vscode-descriptionForeground); font-size: 0.78rem; }
      .test-location { font-family: var(--vscode-editor-font-family, monospace); }
      .test-actions { display: flex; gap: 6px; margin-top: 9px; }
      .test-action { border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
      .test-action:hover { background: var(--vscode-button-secondaryHoverBackground); }
      .test-action:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
      .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
      .text-view { margin-top: 16px; border-top: 1px solid var(--vscode-widget-border); padding-top: 10px; }
      .text-view summary { cursor: pointer; font-weight: 600; }
      .text-view p, .text-view li { color: var(--vscode-descriptionForeground); }
      @media (max-width: 760px) { .test-map { grid-template-columns: 1fr; } .test-header { flex-direction: column; } }
    `,
    scriptContent: `
      const vscode = acquireVsCodeApi();
      const title = document.getElementById('test-title');
      const summary = document.getElementById('test-summary');
      const notices = document.getElementById('test-notices');
      const selected = document.getElementById('test-selected');
      const counts = document.getElementById('test-counts');
      const items = document.getElementById('test-items');
      const textItems = document.getElementById('test-text-items');

      function textElement(parent, tag, className, value) {
        const element = document.createElement(tag);
        if (className) { element.className = className; }
        element.textContent = String(value ?? '');
        parent.appendChild(element);
        return element;
      }

      function card(parent, targetId, target, kind, reason, evidence, classification) {
        const item = document.createElement('article');
        item.className = 'test-card';
        item.dataset.kind = kind;
        textElement(item, 'span', 'kind-badge', kind);
        textElement(item, 'h3', 'test-label', target.label);
        const suffix = target.range ? ':' + target.range.startLine : '';
        textElement(item, 'p', 'test-location', target.workspace.name + ' :: ' + target.workspacePath + suffix);
        if (reason) { textElement(item, 'p', 'test-reason', reason); }
        if (classification) { textElement(item, 'p', 'test-evidence', 'Classification — ' + classification); }
        if (evidence) { textElement(item, 'p', 'test-evidence', evidence.kind + ' link — ' + evidence.source); }
        const actions = document.createElement('div');
        actions.className = 'test-actions';
        const open = textElement(actions, 'button', 'test-action', 'Open');
        open.type = 'button';
        open.addEventListener('click', () => vscode.postMessage({ type: 'openTarget', targetId }));
        const ask = textElement(actions, 'button', 'test-action', 'Ask Atlas');
        ask.type = 'button';
        ask.addEventListener('click', () => vscode.postMessage({ type: 'askTarget', targetId }));
        item.appendChild(actions);
        parent.appendChild(item);
      }

      function renderTestMap(testMap) {
        title.textContent = testMap.label;
        summary.textContent = testMap.items.length + ' linked test-like sources' + (testMap.truncated ? ' · bounded partial view' : '');
        notices.replaceChildren();
        for (const notice of testMap.notices) { textElement(notices, 'li', '', notice); }
        selected.replaceChildren();
        counts.replaceChildren();
        items.replaceChildren();
        textItems.replaceChildren();
        card(selected, testMap.root.id, testMap.root, 'selected', 'Selected source symbol; behaviour assertions remain unknown.', testMap.root.evidence, 'source target');
        const byKind = new Map();
        for (const item of testMap.items) { byKind.set(item.testKind, (byKind.get(item.testKind) || 0) + 1); }
        for (const kind of ['unit', 'integration', 'contract', 'end-to-end', 'unknown']) {
          textElement(counts, 'span', 'count-badge', kind + ' ' + (byKind.get(kind) || 0));
        }
        for (const item of testMap.items) {
          card(items, item.id, item.target, item.testKind, item.reason, item.evidence, item.classification);
          textElement(textItems, 'li', '', item.testKind + ' · ' + item.link + ': ' + item.reason + ' — ' + item.evidence.source);
        }
        if (!testMap.items.length) { textElement(items, 'p', 'empty', 'No test-like caller or reference was returned. This is missing evidence, not a coverage verdict.'); }
      }

      window.addEventListener('message', event => {
        const message = event.data;
        if (message && message.type === 'testMap' && message.testMap) { renderTestMap(message.testMap); }
      });
      vscode.postMessage({ type: 'ready' });
    `,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
