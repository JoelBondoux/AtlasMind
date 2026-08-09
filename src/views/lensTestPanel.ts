import * as vscode from 'vscode';

import { analyzeLensTestMap } from '../core/lensTestMap.js';
import {
  buildLensActionDraftPrompt,
  buildLensContextPatch,
  normalizeLensTarget,
} from '../core/lensTarget.js';
import type { LensGraph, LensTestMap, LensVisualTarget } from '../types.js';
import { revealPreferredChatSurface } from './chatPanel.js';
import { LENS_PANEL_CSS, LENS_PANEL_SCRIPT, renderLensHeader } from './lensVisuals.js';
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
    dashboardSkin: true,
    title: 'AtlasMind Lens — Test & Behaviour',
    cspSource,
    bodyContent: `
      <main class="lens-shell" data-accent="green">
        ${renderLensHeader({
          eyebrow: 'Atlas Lens',
          title: 'Test & behaviour evidence',
          titleId: 'test-title',
          subtitle: 'Loading source-backed test links…',
          subtitleId: 'test-summary',
          mode: 'Discovered evidence',
          info: {
            title: 'Test evidence',
            body: 'The test-like files that already reference this symbol, classified only where the path itself names the kind of test.',
            note: 'Nothing is executed and no assertion is read. An empty map means no linked test file was found — it is missing evidence, not a verdict that the code is untested.',
          },
        })}
        <ul id="test-notices" class="lens-notices" aria-label="Evidence notices"></ul>
        <section class="lens-stage" aria-labelledby="test-title">
          <svg id="test-edges" class="lens-flow-layer" aria-hidden="true"></svg>
          <div class="lens-flow-content test-map">
            <div class="selected-column">
              <h2>Selected symbol</h2>
              <div id="test-selected"></div>
            </div>
            <div class="evidence-column">
              <h2>Linked test-like sources</h2>
              <div id="test-counts" class="test-counts" aria-label="Test-kind summary"></div>
              <div id="test-items" class="test-items"></div>
            </div>
          </div>
        </section>
        <details class="lens-text-view">
          <summary>Text view</summary>
          <p>A keyboard- and screen-reader-friendly list of the same test evidence.</p>
          <ul id="test-text-items"></ul>
        </details>
      </main>
    `,
    extraCss: `${LENS_PANEL_CSS}
      .test-map { display: grid; grid-template-columns: minmax(230px, .8fr) minmax(360px, 2fr); gap: 24px; align-items: start; }
      .selected-column, .evidence-column {
        padding: 14px; border: 1px solid var(--lens-border);
        border-radius: var(--lens-radius); background: var(--lens-surface);
      }
      .selected-column { border-color: color-mix(in srgb, var(--vscode-charts-green, #89d185) 50%, var(--lens-border)); }
      .test-map h2 {
        margin: 0 0 11px; color: var(--lens-muted); font-size: .74rem; font-weight: 700;
        text-transform: uppercase; letter-spacing: .09em;
      }
      .test-counts { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 12px; }
      .count-badge { border: 1px solid var(--lens-border); border-radius: 999px; padding: 3px 9px; color: var(--lens-muted); font-size: .72rem; }
      .count-badge[data-empty="false"] { color: var(--vscode-foreground); border-color: color-mix(in srgb, var(--vscode-charts-green, #89d185) 50%, var(--lens-border)); }
      .test-items { display: grid; grid-template-columns: repeat(auto-fit, minmax(255px, 1fr)); gap: 10px; }
      .test-card[data-kind="unit"] { --lens-accent: var(--vscode-charts-green, #89d185); }
      .test-card[data-kind="integration"] { --lens-accent: var(--vscode-charts-blue, #75beff); }
      .test-card[data-kind="contract"] { --lens-accent: var(--vscode-charts-orange, #d18616); }
      .test-card[data-kind="end-to-end"] { --lens-accent: var(--vscode-charts-purple, #b180d7); }
      .test-card[data-kind="unknown"] { --lens-accent: var(--lens-muted); }
      .test-card[data-kind="selected"] { --lens-accent: var(--vscode-charts-green, #89d185); }
      @media (max-width: 800px) { .test-map { grid-template-columns: 1fr; } #test-edges { display: none; } }
    `,
    scriptContent: `
      const vscode = acquireVsCodeApi();
      ${LENS_PANEL_SCRIPT}
      const title = document.getElementById('test-title');
      const summary = document.getElementById('test-summary');
      const notices = document.getElementById('test-notices');
      const selected = document.getElementById('test-selected');
      const counts = document.getElementById('test-counts');
      const items = document.getElementById('test-items');
      const textItems = document.getElementById('test-text-items');
      const flow = createLensFlow(document.querySelector('.lens-stage'), document.getElementById('test-edges'));
      const KIND_ACCENT = {
        unit: 'green', integration: 'blue', contract: 'orange',
        'end-to-end': 'purple', unknown: 'blue', selected: 'green'
      };
      const cardElements = new Map();
      let rootId;
      let rootElement;

      function textElement(parent, tag, className, value) {
        const element = document.createElement(tag);
        if (className) { element.className = className; }
        element.textContent = String(value ?? '');
        parent.appendChild(element);
        return element;
      }

      function setHighlight(targetId) {
        flow.highlight(targetId);
        for (const [id, card] of cardElements) {
          if (!targetId) { card.classList.remove('is-dimmed', 'is-highlighted'); continue; }
          const related = targetId === rootId || id === targetId || id === rootId;
          card.classList.toggle('is-highlighted', related);
          card.classList.toggle('is-dimmed', !related);
        }
      }

      function card(parent, targetId, target, kind, reason, evidence, classification) {
        const item = document.createElement('article');
        item.className = 'lens-card test-card';
        item.dataset.kind = kind;
        item.dataset.accent = KIND_ACCENT[kind] || 'green';
        item.tabIndex = 0;
        textElement(item, 'p', 'lens-card-kicker', kind);
        textElement(item, 'h3', 'lens-card-title', target.label);
        const suffix = target.range ? ':' + target.range.startLine : '';
        textElement(item, 'p', 'lens-card-path', target.workspace.name + ' :: ' + target.workspacePath + suffix);
        if (reason) { textElement(item, 'p', 'lens-card-body', reason); }
        if (classification) { textElement(item, 'p', 'lens-card-meta', 'Classification — ' + classification); }
        if (evidence) { textElement(item, 'p', 'lens-card-meta', evidence.kind + ' link — ' + evidence.source); }
        const actions = document.createElement('div');
        actions.className = 'lens-card-actions';
        const open = textElement(actions, 'button', 'lens-button', 'Open');
        open.type = 'button';
        open.addEventListener('click', () => vscode.postMessage({ type: 'openTarget', targetId }));
        const ask = textElement(actions, 'button', 'lens-button', 'Ask Atlas');
        ask.type = 'button';
        makeAtlasDiscussButton(ask, 'Ask Atlas about this test target', 'Open this test target in Atlas Chat');
        ask.addEventListener('click', () => vscode.postMessage({ type: 'askTarget', targetId }));
        item.appendChild(actions);
        item.addEventListener('pointerenter', () => setHighlight(targetId));
        item.addEventListener('pointerleave', () => setHighlight(null));
        item.addEventListener('focusin', () => setHighlight(targetId));
        item.addEventListener('focusout', () => setHighlight(null));
        cardElements.set(targetId, item);
        parent.appendChild(item);
        return item;
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
        cardElements.clear();
        rootId = testMap.root.id;
        rootElement = card(selected, testMap.root.id, testMap.root, 'selected', 'Selected source symbol; behaviour assertions remain unknown.', testMap.root.evidence, 'source target');
        const byKind = new Map();
        for (const item of testMap.items) { byKind.set(item.testKind, (byKind.get(item.testKind) || 0) + 1); }
        for (const kind of ['unit', 'integration', 'contract', 'end-to-end', 'unknown']) {
          const badge = textElement(counts, 'span', 'count-badge', kind + ' ' + (byKind.get(kind) || 0));
          badge.dataset.empty = String(!byKind.get(kind));
        }
        const edges = [];
        for (const item of testMap.items) {
          card(items, item.id, item.target, item.testKind, item.reason, item.evidence, item.classification);
          textElement(textItems, 'li', '', item.testKind + ' · ' + item.link + ': ' + item.reason + ' — ' + item.evidence.source);
          edges.push({
            id: item.id,
            fromId: testMap.root.id,
            toId: item.id,
            from: rootElement,
            to: cardElements.get(item.id),
            accent: KIND_ACCENT[item.testKind] || 'green',
            strength: item.testKind === 'unknown' ? 'declared' : 'live'
          });
        }
        if (!testMap.items.length) { textElement(items, 'p', 'lens-empty', 'No test-like caller or reference was returned. This is missing evidence, not a coverage verdict.'); }
        flow.render(edges);
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
