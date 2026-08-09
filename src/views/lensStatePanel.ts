import * as vscode from 'vscode';

import type { LensStateMap } from '../core/lensStateMachine.js';
import { buildLensContextPatch, buildLensDraftPrompt, normalizeLensTarget } from '../core/lensTarget.js';
import type { LensVisualTarget } from '../types.js';
import { revealPreferredChatSurface } from './chatPanel.js';
import { LENS_PANEL_CSS, LENS_PANEL_SCRIPT, renderLensHeader } from './lensVisuals.js';
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
    dashboardSkin: true,
    title: 'AtlasMind Lens — State Lifecycle',
    cspSource,
    bodyContent: `
      <main class="lens-shell" data-accent="red">
        ${renderLensHeader({
          eyebrow: 'Atlas Lens',
          title: 'State lifecycle',
          titleId: 'map-title',
          subtitle: 'Loading declared lifecycle…',
          subtitleId: 'map-summary',
          mode: 'Declared model',
          info: {
            title: 'State lifecycle',
            body: 'The states something can be in and the moves between them, read from the state machine your repository declares in .atlasmind/lens-state.json.',
            note: 'Declared intent, not observed execution. A state marked unreachable means nothing declares a way in — which is usually a bug in the declaration or in the design, and worth knowing either way.',
          },
        })}
        <ul id="map-notices" class="lens-notices" aria-label="Evidence notices"></ul>
        <section class="lens-section" aria-labelledby="map-title">
          <div class="lens-panel lens-stage" id="state-stage">
            <svg id="state-edges" class="lens-flow-layer" aria-hidden="true"></svg>
            <div id="state-columns" class="lens-flow-content state-columns" aria-label="Lifecycle state graph"></div>
          </div>
        </section>
        <section class="lens-section" aria-labelledby="transition-title">
          <div class="lens-section-head">
            <h2 id="transition-title">Declared transitions</h2>
            <span class="lens-section-count" id="transition-count"></span>
          </div>
          <div id="transition-list" class="transition-list"></div>
        </section>
      </main>
    `,
    extraCss: `${LENS_PANEL_CSS}
      .state-columns {
        display: grid; grid-auto-flow: column; grid-auto-columns: minmax(215px, 1fr);
        gap: 48px; width: max-content; min-width: 100%;
      }
      #state-stage { overflow-x: auto; }
      .state-column { display: flex; flex-direction: column; gap: 11px; }
      .state-column > h2 {
        margin: 0 0 2px; color: var(--lens-muted); font-size: .68rem;
        letter-spacing: .1em; text-transform: uppercase; font-weight: 700;
      }
      .state-card[data-terminal="true"] { --lens-accent: var(--vscode-charts-green, #89d185); }
      .state-card[data-reachable="false"] { --lens-accent: var(--vscode-charts-orange, #d18616); }
      .state-card[data-dead-end="true"] { --lens-accent: var(--vscode-errorForeground); }
      .state-badges { display: flex; gap: 5px; flex-wrap: wrap; }
      .state-badge {
        border: 1px solid var(--lens-border); border-radius: 999px;
        padding: 2px 8px; font-size: .68rem; color: var(--lens-muted);
      }
      .state-badge[data-tone="warn"] { color: var(--vscode-charts-orange, #d18616); border-color: color-mix(in srgb, var(--vscode-charts-orange, #d18616) 45%, transparent); }
      .state-badge[data-tone="bad"] { color: var(--vscode-errorForeground); border-color: color-mix(in srgb, var(--vscode-errorForeground) 45%, transparent); }
      .transition-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(285px, 1fr)); gap: 10px; }
      .transition-route {
        font-family: var(--vscode-editor-font-family, monospace); font-weight: 600;
        font-size: .86rem; margin: 0; display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
      }
      .transition-arrow { color: var(--lens-accent); }
      @media (max-width: 640px) { .state-columns { gap: 26px; } }
    `,
    scriptContent: `
      const vscode = acquireVsCodeApi();
      ${LENS_PANEL_SCRIPT}
      const title = document.getElementById('map-title');
      const summary = document.getElementById('map-summary');
      const notices = document.getElementById('map-notices');
      const columns = document.getElementById('state-columns');
      const transitionList = document.getElementById('transition-list');
      const transitionCount = document.getElementById('transition-count');
      const flow = createLensFlow(document.getElementById('state-stage'), document.getElementById('state-edges'));
      const stateElements = new Map();
      let activeMap;

      document.addEventListener('click', event => {
        const button = event.target.closest('button[data-action][data-item-id]');
        if (!button) return;
        vscode.postMessage({ type: button.dataset.action, itemId: button.dataset.itemId });
      });
      window.addEventListener('message', event => {
        if (event.data?.type === 'map') renderMap(event.data.map);
      });

      function setHighlight(stateId) {
        flow.highlight(stateId);
        if (!stateId || !activeMap) {
          for (const card of stateElements.values()) { card.classList.remove('is-dimmed', 'is-highlighted'); }
          return;
        }
        const related = new Set([stateId]);
        for (const transition of activeMap.transitions) {
          if (transition.from === stateId) { related.add(transition.to); }
          if (transition.to === stateId) { related.add(transition.from); }
        }
        for (const [id, card] of stateElements) {
          card.classList.toggle('is-highlighted', related.has(id));
          card.classList.toggle('is-dimmed', !related.has(id));
        }
      }

      function renderMap(map) {
        activeMap = map;
        stateElements.clear();
        title.textContent = map.label;
        summary.textContent = (map.description ? map.description + ' · ' : '') + map.states.length + ' states · ' + map.transitions.length + ' transitions';
        notices.replaceChildren(...map.notices.map(notice => element('li', notice)));
        const depths = [...new Set(map.states.map(state => state.depth))].sort((a, b) => {
          if (a < 0) return 1; if (b < 0) return -1; return a - b;
        });
        columns.replaceChildren(...depths.map(depth => renderColumn(depth, map.states.filter(state => state.depth === depth))));
        transitionCount.textContent = map.transitions.length + (map.transitions.length === 1 ? ' transition' : ' transitions');
        transitionList.replaceChildren(...map.transitions.map(renderTransition));
        // Every declared transition is drawn between the two state cards it
        // names. The list below stays, because a curve cannot carry a guard.
        flow.render(map.transitions
          .filter(transition => stateElements.has(transition.from) && stateElements.has(transition.to))
          .map(transition => ({
            id: transition.id,
            fromId: transition.from,
            toId: transition.to,
            from: stateElements.get(transition.from),
            to: stateElements.get(transition.to),
            accent: 'red',
            strength: 'live'
          })));
      }
      function renderColumn(depth, states) {
        const column = element('section', '', 'state-column');
        column.append(element('h2', depth < 0 ? 'Unreachable' : depth === 0 ? 'Initial' : 'Step ' + depth));
        for (const state of states) {
          const card = element('article', '', 'lens-card state-card');
          card.dataset.terminal = String(state.terminal);
          card.dataset.reachable = String(state.reachable);
          card.dataset.deadEnd = String(state.deadEnd);
          card.dataset.accent = 'red';
          card.tabIndex = 0;
          card.append(element('h3', state.label, 'lens-card-title'));
          if (state.description) card.append(element('p', state.description, 'lens-card-body'));
          const badges = element('div', '', 'state-badges');
          if (state.initial) badges.append(badge('initial'));
          if (state.terminal) badges.append(badge('terminal'));
          if (!state.reachable) badges.append(badge('nothing reaches this', 'warn'));
          if (state.deadEnd) badges.append(badge('nothing leaves this', 'bad'));
          card.append(badges);
          if (state.target) card.append(actions('state:' + state.id));
          card.addEventListener('pointerenter', () => setHighlight(state.id));
          card.addEventListener('pointerleave', () => setHighlight(null));
          card.addEventListener('focusin', () => setHighlight(state.id));
          card.addEventListener('focusout', () => setHighlight(null));
          stateElements.set(state.id, card);
          column.append(card);
        }
        return column;
      }
      function renderTransition(transition) {
        const card = element('article', '', 'lens-card transition-card');
        card.dataset.accent = 'red';
        const route = element('p', '', 'transition-route');
        route.append(document.createTextNode(transition.from), element('span', '→', 'transition-arrow'), document.createTextNode(transition.to));
        card.append(route);
        const details = [transition.event && 'event: ' + transition.event, transition.guard && 'guard: ' + transition.guard, transition.effect && 'effect: ' + transition.effect].filter(Boolean);
        if (details.length) card.append(element('p', details.join(' · '), 'lens-card-meta'));
        if (transition.target) card.append(actions('transition:' + transition.id));
        card.addEventListener('pointerenter', () => setHighlight(transition.from));
        card.addEventListener('pointerleave', () => setHighlight(null));
        return card;
      }
      function badge(label, tone) {
        const value = element('span', label, 'state-badge');
        if (tone) value.dataset.tone = tone;
        return value;
      }
      function actions(itemId) {
        const row = element('div', '', 'lens-card-actions');
        row.append(button('Open', 'openItem', itemId), button('Ask Atlas', 'askItem', itemId));
        return row;
      }
      function button(label, action, itemId) {
        const value = element('button', label, 'lens-button'); value.type = 'button'; value.dataset.action = action; value.dataset.itemId = itemId;
        return action === 'askItem'
          ? makeAtlasDiscussButton(value, 'Ask Atlas about this state item', 'Open this state item in Atlas Chat')
          : value;
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
