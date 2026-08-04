import * as vscode from 'vscode';

import { analyzeLensCodeImpact } from '../core/lensCodeImpact.js';
import {
  buildLensActionDraftPrompt,
  buildLensContextPatch,
  normalizeLensTarget,
} from '../core/lensTarget.js';
import type { LensCodeImpact, LensGraph, LensVisualTarget } from '../types.js';
import { revealPreferredChatSurface } from './chatPanel.js';
import { LENS_PANEL_CSS, LENS_PANEL_SCRIPT, renderLensHeader } from './lensVisuals.js';
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
      <main class="lens-shell" data-accent="orange">
        ${renderLensHeader({
          eyebrow: 'Atlas Lens',
          title: 'Change impact',
          titleId: 'impact-title',
          subtitle: 'Loading source-backed impact evidence…',
          subtitleId: 'impact-summary',
          mode: 'Static evidence',
          info: {
            title: 'Change impact',
            body: 'Who would feel it if you changed this symbol: the code that calls it, the code it calls, and everywhere else it is referenced. Ranked by how close each one is.',
            note: 'Code only. Contracts, configuration, docs, and runtime paths are not searched, so an empty column is missing evidence — never a promise that nothing breaks.',
          },
        })}
        <ul id="impact-notices" class="lens-notices" aria-label="Evidence notices"></ul>
        <section class="lens-stage" aria-labelledby="impact-title">
          <svg id="impact-edges" class="lens-flow-layer" aria-hidden="true"></svg>
          <div class="lens-flow-content impact-map">
            <div class="impact-column" data-category="upstream-caller">
              <h2>Upstream callers</h2>
              <p class="column-hint">Code that calls this. A change to the signature reaches them first.</p>
              <div id="impact-upstream" class="impact-items"></div>
            </div>
            <div class="impact-column selected-column">
              <h2>Selected symbol</h2>
              <p class="column-hint">Nothing has been changed. This is the starting point.</p>
              <div id="impact-selected" class="impact-items"></div>
            </div>
            <div class="impact-column" data-category="downstream-callee">
              <h2>Downstream callees</h2>
              <p class="column-hint">Code this calls. A change in behaviour reaches them.</p>
              <div id="impact-downstream" class="impact-items"></div>
            </div>
            <div class="impact-column consumer-column" data-category="consumer-reference">
              <h2>Other source consumers</h2>
              <p class="column-hint">Everywhere else the symbol is named, without a call relationship.</p>
              <div id="impact-consumers" class="impact-items"></div>
            </div>
          </div>
        </section>
        <details class="lens-text-view">
          <summary>Text view</summary>
          <p>A keyboard- and screen-reader-friendly list of the same impact evidence.</p>
          <ul id="impact-text-items"></ul>
        </details>
      </main>
    `,
    extraCss: `${LENS_PANEL_CSS}
      .impact-map { display: grid; grid-template-columns: repeat(3, minmax(230px, 1fr)); gap: 18px; align-items: start; }
      .impact-column {
        min-height: 150px; padding: 14px; border: 1px solid var(--lens-border);
        border-radius: var(--lens-radius); background: var(--lens-surface);
      }
      .impact-column h2 {
        margin: 0 0 4px; font-size: .74rem; color: var(--lens-muted); font-weight: 700;
        text-transform: uppercase; letter-spacing: .09em;
      }
      .column-hint { margin: 0 0 11px; font-size: .74rem; color: var(--lens-muted); }
      .selected-column { border-color: color-mix(in srgb, var(--vscode-charts-orange, #d18616) 55%, var(--lens-border)); }
      .consumer-column { grid-column: 1 / -1; min-height: 0; }
      .consumer-column .impact-items { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; }
      .impact-items { display: grid; gap: 10px; }
      .impact-card[data-category="upstream-caller"] { --lens-accent: var(--vscode-charts-blue, #75beff); }
      .impact-card[data-category="downstream-callee"] { --lens-accent: var(--vscode-charts-green, #89d185); }
      .impact-card[data-category="consumer-reference"] { --lens-accent: var(--vscode-charts-purple, #b180d7); }
      .impact-card[data-category="selected"] { --lens-accent: var(--vscode-charts-orange, #d18616); }
      @media (max-width: 860px) { .impact-map { grid-template-columns: 1fr; } .consumer-column { grid-column: auto; } #impact-edges { display: none; } }
    `,
    scriptContent: `
      const vscode = acquireVsCodeApi();
      ${LENS_PANEL_SCRIPT}
      const title = document.getElementById('impact-title');
      const summary = document.getElementById('impact-summary');
      const notices = document.getElementById('impact-notices');
      const upstream = document.getElementById('impact-upstream');
      const selected = document.getElementById('impact-selected');
      const downstream = document.getElementById('impact-downstream');
      const consumers = document.getElementById('impact-consumers');
      const textItems = document.getElementById('impact-text-items');
      const flow = createLensFlow(document.querySelector('.lens-stage'), document.getElementById('impact-edges'));
      const CATEGORY_ACCENT = {
        'upstream-caller': 'blue', 'downstream-callee': 'green',
        'consumer-reference': 'purple', selected: 'orange'
      };
      const cardElements = new Map();
      let rootElement;

      function textElement(parent, tag, className, value) {
        const element = document.createElement(tag);
        if (className) { element.className = className; }
        element.textContent = String(value ?? '');
        parent.appendChild(element);
        return element;
      }

      function action(parent, label, message) {
        const button = textElement(parent, 'button', 'lens-button', label);
        button.type = 'button';
        button.addEventListener('click', () => vscode.postMessage(message));
      }

      let rootId;

      function setHighlight(targetId) {
        flow.highlight(targetId);
        for (const [id, card] of cardElements) {
          if (!targetId) { card.classList.remove('is-dimmed', 'is-highlighted'); continue; }
          // Every edge touches the selected symbol, so hovering it lights the
          // whole map rather than isolating a card with no relationships drawn.
          const related = targetId === rootId || id === targetId || id === rootId;
          card.classList.toggle('is-highlighted', related);
          card.classList.toggle('is-dimmed', !related);
        }
      }

      function card(parent, targetId, target, category, reason, evidence, proximity) {
        const item = document.createElement('article');
        item.className = 'lens-card impact-card';
        item.dataset.category = category;
        item.dataset.accent = CATEGORY_ACCENT[category] || 'orange';
        item.tabIndex = 0;
        textElement(item, 'p', 'lens-card-kicker', category.replace(/-/g, ' '));
        textElement(item, 'h3', 'lens-card-title', target.label);
        const suffix = target.range ? ':' + target.range.startLine : '';
        textElement(item, 'p', 'lens-card-path', target.workspace.name + ' :: ' + target.workspacePath + suffix);
        if (reason) { textElement(item, 'p', 'lens-card-body', reason); }
        if (evidence) {
          textElement(item, 'p', 'lens-card-meta', evidence.kind + ' — ' + evidence.source + (proximity ? ' · proximity ' + proximity : ''));
        }
        const actions = document.createElement('div');
        actions.className = 'lens-card-actions';
        action(actions, 'Open', { type: 'openTarget', targetId });
        action(actions, 'Ask Atlas', { type: 'askTarget', targetId });
        item.appendChild(actions);
        item.addEventListener('pointerenter', () => setHighlight(targetId));
        item.addEventListener('pointerleave', () => setHighlight(null));
        item.addEventListener('focusin', () => setHighlight(targetId));
        item.addEventListener('focusout', () => setHighlight(null));
        cardElements.set(targetId, item);
        parent.appendChild(item);
        return item;
      }

      function empty(parent, label) { textElement(parent, 'p', 'lens-empty', label); }

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
        cardElements.clear();
        rootId = impact.root.id;
        rootElement = card(selected, impact.root.id, impact.root, 'selected', 'Selected source symbol; no change has been applied.', impact.root.evidence, 0);
        const buckets = {
          'upstream-caller': upstream,
          'downstream-callee': downstream,
          'consumer-reference': consumers,
        };
        const counts = { 'upstream-caller': 0, 'downstream-callee': 0, 'consumer-reference': 0 };
        const edges = [];
        for (const item of impact.items) {
          const parent = buckets[item.category];
          if (!parent) { continue; }
          counts[item.category] += 1;
          card(parent, item.id, item.target, item.category, item.reason, item.evidence, item.proximity);
          textElement(textItems, 'li', '', item.category + ': ' + item.reason + ' — ' + item.evidence.source);
          // Callers point *into* the selected symbol; everything else points out
          // of it. Drawing them all one way would misstate the direction of the
          // dependency, which is the fact the reader came here for.
          const inbound = item.category === 'upstream-caller';
          edges.push({
            id: item.id,
            fromId: inbound ? item.id : impact.root.id,
            toId: inbound ? impact.root.id : item.id,
            from: inbound ? cardElements.get(item.id) : rootElement,
            to: inbound ? rootElement : cardElements.get(item.id),
            accent: CATEGORY_ACCENT[item.category] || 'orange',
            strength: 'live',
            direction: item.category === 'consumer-reference' ? 'vertical' : 'horizontal'
          });
        }
        if (!counts['upstream-caller']) { empty(upstream, 'No upstream caller evidence returned.'); }
        if (!counts['downstream-callee']) { empty(downstream, 'No downstream callee evidence returned.'); }
        if (!counts['consumer-reference']) { empty(consumers, 'No other source-reference evidence returned.'); }
        flow.render(edges);
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
