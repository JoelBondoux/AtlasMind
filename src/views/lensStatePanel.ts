import * as vscode from 'vscode';

import type { LensStateMap } from '../core/lensStateMachine.js';
import { buildLensContextPatch, buildLensDraftPrompt, normalizeLensTarget } from '../core/lensTarget.js';
import type { LensVisualTarget } from '../types.js';
import { revealPreferredChatSurface } from './chatPanel.js';
import { getWebviewHtmlShell } from './webviewUtils.js';

type LensStateMessage =
  | { type: 'ready' }
  | { type: 'openItem'; itemId: string }
  | { type: 'askItem'; itemId: string };

/** Secure host-owned view of one explicitly declared state lifecycle. */
export class LensStatePanel {
  private static currentPanel: LensStatePanel | undefined;
  private static readonly viewType = 'atlasmind.lensState';

  private readonly disposables: vscode.Disposable[] = [];
  private readonly targetByItemId = new Map<string, LensVisualTarget>();
  private ready = false;

  public static createOrShow(map: LensStateMap): void {
    if (LensStatePanel.currentPanel) {
      LensStatePanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      LensStatePanel.currentPanel.replaceMap(map);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      LensStatePanel.viewType,
      'Lens — State Lifecycle',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    LensStatePanel.currentPanel = new LensStatePanel(panel, map);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private map: LensStateMap,
  ) {
    this.indexTargets();
    this.panel.webview.html = buildStateHtml(this.panel.webview.cspSource);
    this.panel.webview.onDidReceiveMessage(
      (raw: unknown) => {
        const message = normalizeStateMessage(raw);
        if (message) void this.handleMessage(message);
      },
      null,
      this.disposables,
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private replaceMap(map: LensStateMap): void {
    this.map = map;
    this.indexTargets();
    if (this.ready) void this.panel.webview.postMessage({ type: 'map', map });
  }

  private indexTargets(): void {
    this.targetByItemId.clear();
    for (const state of this.map.states) {
      const target = normalizeLensTarget(state.target);
      if (target) this.targetByItemId.set(`state:${state.id}`, target);
    }
    for (const transition of this.map.transitions) {
      const target = normalizeLensTarget(transition.target);
      if (target) this.targetByItemId.set(`transition:${transition.id}`, target);
    }
  }

  private async handleMessage(message: LensStateMessage): Promise<void> {
    if (message.type === 'ready') {
      this.ready = true;
      await this.panel.webview.postMessage({ type: 'map', map: this.map });
      return;
    }
    const target = normalizeLensTarget(this.targetByItemId.get(message.itemId));
    if (!target) return;
    if (message.type === 'openItem') {
      const uri = resolveWorkspaceTarget(target);
      if (!uri) {
        void vscode.window.showWarningMessage('AtlasMind Lens refused an invalid or out-of-workspace lifecycle target.');
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
    LensStatePanel.currentPanel = undefined;
    while (this.disposables.length > 0) this.disposables.pop()?.dispose();
  }
}

function normalizeStateMessage(value: unknown): LensStateMessage | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined;
  if (value.type === 'ready') return { type: 'ready' };
  if (
    (value.type === 'openItem' || value.type === 'askItem') &&
    typeof value.itemId === 'string' && value.itemId.length > 0 && value.itemId.length <= 500 &&
    !/[\u0000-\u001f\u007f]/.test(value.itemId)
  ) {
    return { type: value.type, itemId: value.itemId };
  }
  return undefined;
}

function resolveWorkspaceTarget(target: LensVisualTarget): vscode.Uri | undefined {
  const folder = vscode.workspace.workspaceFolders?.find(candidate =>
    candidate.name === target.workspace.name && candidate.index === target.workspace.index,
  );
  if (!folder) return undefined;
  const uri = vscode.Uri.joinPath(folder.uri, ...target.workspacePath.split('/'));
  const resolved = vscode.workspace.getWorkspaceFolder(uri);
  return resolved && resolved.name === folder.name && resolved.index === folder.index &&
    normalizeRelativePath(vscode.workspace.asRelativePath(uri, false)) === target.workspacePath
    ? uri
    : undefined;
}

function toSelection(target: LensVisualTarget): vscode.Selection | undefined {
  return target.range ? new vscode.Selection(
    target.range.startLine - 1,
    target.range.startColumn - 1,
    target.range.endLine - 1,
    target.range.endColumn - 1,
  ) : undefined;
}

function normalizeRelativePath(value: string): string | undefined {
  const normalized = value.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) return undefined;
  const segments = normalized.split('/');
  return segments.some(segment => !segment || segment === '.' || segment === '..') ? undefined : segments.join('/');
}

function buildStateHtml(cspSource: string): string {
  return getWebviewHtmlShell({
    title: 'AtlasMind Lens — State Lifecycle',
    cspSource,
    bodyContent: `
      <main class="state-shell">
        <header class="state-header">
          <div><p class="eyebrow">AtlasMind Lens</p><h1 id="map-title">State lifecycle</h1><p id="map-summary">Loading declared lifecycle…</p></div>
          <span class="mode-badge">Declared model</span>
        </header>
        <ul id="map-notices" class="notices" aria-label="Evidence notices"></ul>
        <section aria-labelledby="map-title">
          <div id="state-columns" class="state-columns" aria-label="Lifecycle state graph"></div>
        </section>
        <section class="transition-section" aria-labelledby="transition-title">
          <h2 id="transition-title">Declared transitions</h2>
          <div id="transition-list" class="transition-list"></div>
        </section>
      </main>
    `,
    extraCss: `
      .state-shell { max-width: 1440px; margin: 0 auto; }
      .state-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
      .state-header h1 { margin: 0; } .state-header p { margin: 4px 0 0; color: var(--vscode-descriptionForeground); }
      .eyebrow { font-size: .76rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
      .mode-badge { flex: none; border: 1px solid var(--vscode-widget-border); border-radius: 999px; padding: 4px 9px; color: var(--vscode-descriptionForeground); }
      .notices { padding-left: 20px; color: var(--vscode-descriptionForeground); }
      .state-columns { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(210px, 1fr); gap: 24px; overflow-x: auto; padding: 18px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; background: var(--vscode-editor-background); }
      .state-column { min-width: 210px; } .state-column h2 { margin: 0 0 10px; color: var(--vscode-descriptionForeground); font-size: .76rem; letter-spacing: .08em; text-transform: uppercase; }
      .state-card { margin-bottom: 10px; border: 1px solid var(--vscode-widget-border); border-left: 3px solid var(--vscode-focusBorder); border-radius: 6px; padding: 10px; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); }
      .state-card[data-terminal="true"] { border-left-color: var(--vscode-charts-green, #89d185); }
      .state-card[data-reachable="false"] { border-left-color: var(--vscode-charts-orange, #d18616); opacity: .78; }
      .state-card[data-dead-end="true"] { box-shadow: inset 0 0 0 1px var(--vscode-errorForeground); }
      .state-card h3 { margin: 0; font-size: .95rem; } .state-card p { margin: 5px 0; color: var(--vscode-descriptionForeground); }
      .badges { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 7px; } .badge { border: 1px solid var(--vscode-widget-border); border-radius: 999px; padding: 2px 6px; font-size: .68rem; }
      .item-actions { display: flex; gap: 6px; margin-top: 8px; } .item-actions button { font-size: .75rem; }
      .transition-section { margin-top: 18px; } .transition-section h2 { font-size: 1rem; }
      .transition-list { display: grid; gap: 8px; } .transition-card { border: 1px solid var(--vscode-widget-border); border-radius: 6px; padding: 10px; }
      .transition-route { font-family: var(--vscode-editor-font-family, monospace); font-weight: 600; }
      .transition-detail { color: var(--vscode-descriptionForeground); margin: 5px 0 0; }
      @media (max-width: 600px) { .state-header { flex-direction: column; } }
    `,
    scriptContent: `
      const vscode = acquireVsCodeApi();
      const title = document.getElementById('map-title');
      const summary = document.getElementById('map-summary');
      const notices = document.getElementById('map-notices');
      const columns = document.getElementById('state-columns');
      const transitionList = document.getElementById('transition-list');

      document.addEventListener('click', event => {
        const button = event.target.closest('button[data-action][data-item-id]');
        if (!button) return;
        vscode.postMessage({ type: button.dataset.action, itemId: button.dataset.itemId });
      });
      window.addEventListener('message', event => {
        if (event.data?.type === 'map') renderMap(event.data.map);
      });

      function renderMap(map) {
        title.textContent = map.label;
        summary.textContent = (map.description ? map.description + ' · ' : '') + map.states.length + ' states · ' + map.transitions.length + ' transitions';
        notices.replaceChildren(...map.notices.map(notice => element('li', notice)));
        const depths = [...new Set(map.states.map(state => state.depth))].sort((a, b) => {
          if (a < 0) return 1; if (b < 0) return -1; return a - b;
        });
        columns.replaceChildren(...depths.map(depth => renderColumn(depth, map.states.filter(state => state.depth === depth))));
        transitionList.replaceChildren(...map.transitions.map(renderTransition));
      }
      function renderColumn(depth, states) {
        const column = element('section', '', 'state-column');
        column.append(element('h2', depth < 0 ? 'Unreachable' : depth === 0 ? 'Initial' : 'Step ' + depth));
        for (const state of states) {
          const card = element('article', '', 'state-card');
          card.dataset.terminal = String(state.terminal); card.dataset.reachable = String(state.reachable); card.dataset.deadEnd = String(state.deadEnd);
          card.append(element('h3', state.label));
          if (state.description) card.append(element('p', state.description));
          const badges = element('div', '', 'badges');
          if (state.initial) badges.append(element('span', 'initial', 'badge'));
          if (state.terminal) badges.append(element('span', 'terminal', 'badge'));
          if (!state.reachable) badges.append(element('span', 'unreachable', 'badge'));
          if (state.deadEnd) badges.append(element('span', 'dead end', 'badge'));
          card.append(badges);
          if (state.target) card.append(actions('state:' + state.id));
          column.append(card);
        }
        return column;
      }
      function renderTransition(transition) {
        const card = element('article', '', 'transition-card');
        card.append(element('div', transition.from + ' → ' + transition.to, 'transition-route'));
        const details = [transition.event && 'event: ' + transition.event, transition.guard && 'guard: ' + transition.guard, transition.effect && 'effect: ' + transition.effect].filter(Boolean);
        if (details.length) card.append(element('p', details.join(' · '), 'transition-detail'));
        if (transition.target) card.append(actions('transition:' + transition.id));
        return card;
      }
      function actions(itemId) {
        const row = element('div', '', 'item-actions');
        row.append(button('Open', 'openItem', itemId), button('Ask Atlas', 'askItem', itemId));
        return row;
      }
      function button(label, action, itemId) {
        const value = element('button', label); value.type = 'button'; value.dataset.action = action; value.dataset.itemId = itemId; return value;
      }
      function element(tag, text, className) {
        const value = document.createElement(tag); if (text) value.textContent = text; if (className) value.className = className; return value;
      }
      vscode.postMessage({ type: 'ready' });
    `,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
