import * as vscode from 'vscode';

import { analyzeLensCodeImpact } from '../core/lensCodeImpact.js';
import {
  buildLensActionDraftPrompt,
  buildLensContextPatch,
  normalizeLensTarget,
} from '../core/lensTarget.js';
import type { LensCodeImpact, LensGraph, LensVisualTarget } from '../types.js';
import { revealPreferredChatSurface } from './chatPanel.js';
import { getWebviewHtmlShell } from './webviewUtils.js';

type LensImpactMessage =
  | { type: 'ready' }
  | { type: 'openTarget'; targetId: string }
  | { type: 'askTarget'; targetId: string };

/** Secure editor-hosted map of bounded, evidence-backed code impact. */
export class LensImpactPanel {
  private static currentPanel: LensImpactPanel | undefined;
  private static readonly viewType = 'atlasmind.lensImpact';

  private readonly disposables: vscode.Disposable[] = [];
  private readonly targetById = new Map<string, LensVisualTarget>();
  private ready = false;

  public static createOrShow(candidate: LensGraph): void {
    let impact: LensCodeImpact;
    try {
      impact = analyzeLensCodeImpact(candidate);
    } catch {
      void vscode.window.showWarningMessage('AtlasMind Lens refused an invalid change-impact graph.');
      return;
    }
    if (LensImpactPanel.currentPanel) {
      LensImpactPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      LensImpactPanel.currentPanel.replaceImpact(impact);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      LensImpactPanel.viewType,
      'Lens — Change Impact',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    LensImpactPanel.currentPanel = new LensImpactPanel(panel, impact);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private impact: LensCodeImpact,
  ) {
    this.indexTargets(impact);
    this.panel.webview.html = buildImpactHtml(this.panel.webview.cspSource);
    this.panel.webview.onDidReceiveMessage(
      (raw: unknown) => {
        const message = normalizeImpactMessage(raw);
        if (message) {
          void this.handleMessage(message);
        }
      },
      null,
      this.disposables,
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private replaceImpact(impact: LensCodeImpact): void {
    this.impact = impact;
    this.indexTargets(impact);
    if (this.ready) {
      void this.panel.webview.postMessage({ type: 'impact', impact });
    }
  }

  private indexTargets(impact: LensCodeImpact): void {
    this.targetById.clear();
    this.targetById.set(impact.root.id, impact.root);
    for (const item of impact.items) {
      this.targetById.set(item.id, item.target);
    }
  }

  private async handleMessage(message: LensImpactMessage): Promise<void> {
    if (message.type === 'ready') {
      this.ready = true;
      await this.panel.webview.postMessage({ type: 'impact', impact: this.impact });
      return;
    }
    const target = normalizeLensTarget(this.targetById.get(message.targetId));
    if (!target) {
      return;
    }
    if (message.type === 'openTarget') {
      const uri = resolveWorkspaceTarget(target);
      if (!uri) {
        void vscode.window.showWarningMessage('AtlasMind Lens refused an invalid or out-of-workspace impact target.');
        return;
      }
      await vscode.window.showTextDocument(uri, {
        preview: false,
        ...(target.range ? { selection: toSelection(target) } : {}),
      });
      return;
    }
    await revealPreferredChatSurface({
      draftPrompt: buildLensActionDraftPrompt(target, 'impact'),
      contextPatch: buildLensContextPatch(target),
    });
  }

  private dispose(): void {
    LensImpactPanel.currentPanel = undefined;
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }
}

function normalizeImpactMessage(value: unknown): LensImpactMessage | undefined {
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

function buildImpactHtml(cspSource: string): string {
  return getWebviewHtmlShell({
    title: 'AtlasMind Lens — Change Impact',
    cspSource,
    bodyContent: `
      <main class="impact-shell">
        <header class="impact-header">
          <div>
            <p class="eyebrow">AtlasMind Lens</p>
            <h1 id="impact-title">Change impact</h1>
            <p id="impact-summary">Loading source-backed impact evidence…</p>
          </div>
          <span class="mode-badge">Static evidence</span>
        </header>
        <ul id="impact-notices" class="notices" aria-label="Evidence notices"></ul>
        <section class="impact-map" aria-labelledby="impact-title">
          <div class="impact-column" data-category="upstream-caller">
            <h2>Upstream callers</h2>
            <div id="impact-upstream" class="impact-items"></div>
          </div>
          <div class="impact-column selected-column">
            <h2>Selected symbol</h2>
            <div id="impact-selected" class="impact-items"></div>
          </div>
          <div class="impact-column" data-category="downstream-callee">
            <h2>Downstream callees</h2>
            <div id="impact-downstream" class="impact-items"></div>
          </div>
          <div class="impact-column consumer-column" data-category="consumer-reference">
            <h2>Other source consumers</h2>
            <div id="impact-consumers" class="impact-items"></div>
          </div>
        </section>
        <details class="text-view">
          <summary>Text view</summary>
          <p>A keyboard- and screen-reader-friendly list of the same impact evidence.</p>
          <ul id="impact-text-items"></ul>
        </details>
      </main>
    `,
    extraCss: `
      .impact-shell { max-width: 1440px; margin: 0 auto; }
      .impact-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
      .impact-header h1 { margin: 0; }
      .impact-header p { margin: 4px 0 0; color: var(--vscode-descriptionForeground); }
      .eyebrow { font-size: 0.76rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
      .mode-badge { flex: none; border: 1px solid var(--vscode-widget-border); border-radius: 999px; padding: 4px 9px; color: var(--vscode-descriptionForeground); }
      .notices { padding-left: 20px; color: var(--vscode-descriptionForeground); }
      .impact-map { display: grid; grid-template-columns: repeat(3, minmax(220px, 1fr)); gap: 14px; align-items: start; }
      .impact-column { min-height: 150px; padding: 12px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; background: var(--vscode-editor-background); }
      .impact-column h2 { margin: 0 0 10px; font-size: 0.85rem; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.06em; }
      .selected-column { border-color: var(--vscode-focusBorder); }
      .consumer-column { grid-column: 1 / -1; min-height: 0; }
      .consumer-column .impact-items { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 9px; }
      .impact-items { display: grid; gap: 9px; }
      .impact-card { padding: 10px; border: 1px solid var(--vscode-widget-border); border-left: 3px solid var(--vscode-charts-blue, #75beff); border-radius: 6px; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); }
      .impact-card[data-category="downstream-callee"] { border-left-color: var(--vscode-charts-green, #89d185); }
      .impact-card[data-category="consumer-reference"] { border-left-color: var(--vscode-charts-purple, #b180d7); }
      .impact-card[data-category="selected"] { border-left-color: var(--vscode-focusBorder); }
      .impact-label { margin: 0; font-size: 0.92rem; }
      .impact-location, .impact-reason, .impact-evidence { margin: 4px 0 0; color: var(--vscode-descriptionForeground); font-size: 0.78rem; }
      .impact-location { font-family: var(--vscode-editor-font-family, monospace); }
      .impact-actions { display: flex; gap: 6px; margin-top: 9px; }
      .impact-action { border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
      .impact-action:hover { background: var(--vscode-button-secondaryHoverBackground); }
      .impact-action:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
      .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
      .text-view { margin-top: 16px; border-top: 1px solid var(--vscode-widget-border); padding-top: 10px; }
      .text-view summary { cursor: pointer; font-weight: 600; }
      .text-view p, .text-view li { color: var(--vscode-descriptionForeground); }
      @media (max-width: 820px) { .impact-map { grid-template-columns: 1fr; } .consumer-column { grid-column: auto; } .impact-header { flex-direction: column; } }
    `,
    scriptContent: `
      const vscode = acquireVsCodeApi();
      const title = document.getElementById('impact-title');
      const summary = document.getElementById('impact-summary');
      const notices = document.getElementById('impact-notices');
      const upstream = document.getElementById('impact-upstream');
      const selected = document.getElementById('impact-selected');
      const downstream = document.getElementById('impact-downstream');
      const consumers = document.getElementById('impact-consumers');
      const textItems = document.getElementById('impact-text-items');

      function textElement(parent, tag, className, value) {
        const element = document.createElement(tag);
        if (className) { element.className = className; }
        element.textContent = String(value ?? '');
        parent.appendChild(element);
        return element;
      }

      function action(parent, label, message) {
        const button = textElement(parent, 'button', 'impact-action', label);
        button.type = 'button';
        button.addEventListener('click', () => vscode.postMessage(message));
      }

      function card(parent, targetId, target, category, reason, evidence, proximity) {
        const item = document.createElement('article');
        item.className = 'impact-card';
        item.dataset.category = category;
        textElement(item, 'h3', 'impact-label', target.label);
        const suffix = target.range ? ':' + target.range.startLine : '';
        textElement(item, 'p', 'impact-location', target.workspace.name + ' :: ' + target.workspacePath + suffix);
        if (reason) { textElement(item, 'p', 'impact-reason', reason); }
        if (evidence) {
          textElement(item, 'p', 'impact-evidence', evidence.kind + ' — ' + evidence.source + (proximity ? ' · proximity ' + proximity : ''));
        }
        const actions = document.createElement('div');
        actions.className = 'impact-actions';
        action(actions, 'Open', { type: 'openTarget', targetId });
        action(actions, 'Ask Atlas', { type: 'askTarget', targetId });
        item.appendChild(actions);
        parent.appendChild(item);
      }

      function empty(parent, label) { textElement(parent, 'p', 'empty', label); }

      function renderImpact(impact) {
        title.textContent = impact.label;
        summary.textContent = impact.items.length + ' evidence-backed implications' + (impact.truncated ? ' · bounded partial view' : '');
        notices.replaceChildren();
        for (const notice of impact.notices) { textElement(notices, 'li', '', notice); }
        upstream.replaceChildren();
        selected.replaceChildren();
        downstream.replaceChildren();
        consumers.replaceChildren();
        textItems.replaceChildren();
        card(selected, impact.root.id, impact.root, 'selected', 'Selected source symbol; no change has been applied.', impact.root.evidence, 0);
        const buckets = {
          'upstream-caller': upstream,
          'downstream-callee': downstream,
          'consumer-reference': consumers,
        };
        const counts = { 'upstream-caller': 0, 'downstream-callee': 0, 'consumer-reference': 0 };
        for (const item of impact.items) {
          const parent = buckets[item.category];
          if (!parent) { continue; }
          counts[item.category] += 1;
          card(parent, item.id, item.target, item.category, item.reason, item.evidence, item.proximity);
          textElement(textItems, 'li', '', item.category + ': ' + item.reason + ' — ' + item.evidence.source);
        }
        if (!counts['upstream-caller']) { empty(upstream, 'No upstream caller evidence returned.'); }
        if (!counts['downstream-callee']) { empty(downstream, 'No downstream callee evidence returned.'); }
        if (!counts['consumer-reference']) { empty(consumers, 'No other source-reference evidence returned.'); }
      }

      window.addEventListener('message', event => {
        const message = event.data;
        if (message && message.type === 'impact' && message.impact) { renderImpact(message.impact); }
      });
      vscode.postMessage({ type: 'ready' });
    `,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
