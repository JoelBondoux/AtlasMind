import * as vscode from 'vscode';

import type { LensConfigResolutionMap } from '../core/lensConfigResolution.js';
import { buildLensContextPatch, buildLensDraftPrompt, normalizeLensTarget } from '../core/lensTarget.js';
import type { LensVisualTarget } from '../types.js';
import { revealPreferredChatSurface } from './chatPanel.js';
import { LENS_PANEL_CSS, LENS_PANEL_SCRIPT, renderLensHeader } from './lensVisuals.js';
import { getWebviewHtmlShell } from './webviewUtils.js';

type LensConfigMessage =
  | { type: 'ready' }
  | { type: 'openSource'; sourceId: string }
  | { type: 'askSource'; sourceId: string };

/** Secure host-owned view of one explicit configuration precedence chain. */
export class LensConfigPanel {
  private static currentPanel: LensConfigPanel | undefined;
  private static readonly viewType = 'atlasmind.lensConfig';
  private readonly disposables: vscode.Disposable[] = [];
  private readonly targetBySourceId = new Map<string, LensVisualTarget>();
  private ready = false;

  public static createOrShow(map: LensConfigResolutionMap): void {
    if (LensConfigPanel.currentPanel) {
      LensConfigPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      LensConfigPanel.currentPanel.replaceMap(map);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      LensConfigPanel.viewType,
      'Lens — Configuration Resolution',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    LensConfigPanel.currentPanel = new LensConfigPanel(panel, map);
  }

  private constructor(private readonly panel: vscode.WebviewPanel, private map: LensConfigResolutionMap) {
    this.indexTargets();
    this.panel.webview.html = buildConfigHtml(this.panel.webview.cspSource);
    this.panel.webview.onDidReceiveMessage(
      (raw: unknown) => {
        const message = normalizeConfigMessage(raw);
        if (message) void this.handleMessage(message);
      },
      null,
      this.disposables,
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private replaceMap(map: LensConfigResolutionMap): void {
    this.map = map;
    this.indexTargets();
    if (this.ready) void this.panel.webview.postMessage({ type: 'map', map });
  }

  private indexTargets(): void {
    this.targetBySourceId.clear();
    for (const source of this.map.sources) {
      const target = normalizeLensTarget(source.target);
      if (target) this.targetBySourceId.set(source.id, target);
    }
  }

  private async handleMessage(message: LensConfigMessage): Promise<void> {
    if (message.type === 'ready') {
      this.ready = true;
      await this.panel.webview.postMessage({ type: 'map', map: this.map });
      return;
    }
    const target = normalizeLensTarget(this.targetBySourceId.get(message.sourceId));
    if (!target) return;
    if (message.type === 'openSource') {
      const uri = resolveWorkspaceTarget(target);
      if (!uri) {
        void vscode.window.showWarningMessage('AtlasMind Lens refused an invalid or out-of-workspace configuration target.');
        return;
      }
      await vscode.window.showTextDocument(uri, {
        preview: false,
        ...(target.range ? { selection: toSelection(target) } : {}),
      });
      return;
    }
    await revealPreferredChatSurface({ draftPrompt: buildLensDraftPrompt(target), contextPatch: buildLensContextPatch(target) });
  }

  private dispose(): void {
    LensConfigPanel.currentPanel = undefined;
    while (this.disposables.length > 0) this.disposables.pop()?.dispose();
  }
}

function normalizeConfigMessage(value: unknown): LensConfigMessage | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined;
  if (value.type === 'ready') return { type: 'ready' };
  if (
    (value.type === 'openSource' || value.type === 'askSource') && typeof value.sourceId === 'string' &&
    value.sourceId.length > 0 && value.sourceId.length <= 500 && !/[\u0000-\u001f\u007f]/.test(value.sourceId)
  ) {
    return { type: value.type, sourceId: value.sourceId };
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
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) return undefined;
  const segments = normalized.split('/');
  return segments.some(segment => !segment || segment === '.' || segment === '..') ? undefined : segments.join('/');
}

function buildConfigHtml(cspSource: string): string {
  return getWebviewHtmlShell({
    title: 'AtlasMind Lens — Configuration Resolution',
    cspSource,
    bodyContent: `
      <main class="lens-shell" data-accent="teal">
        ${renderLensHeader({
          eyebrow: 'Atlas Lens',
          title: 'Configuration resolution',
          titleId: 'map-title',
          subtitle: 'Loading declared precedence…',
          subtitleId: 'map-summary',
          mode: 'Declared model',
          info: {
            title: 'Configuration resolution',
            body: 'Every place one setting can come from, laid out lowest to highest. The green card is the one that wins; the blue ones are set but overridden; the faded ones do not apply here.',
            note: 'Declared precedence from .atlasmind/lens-config.json. Live environment variables, remote feature flags, and secrets are never read, so this is the intended answer rather than a verified one.',
          },
          aside: '<span id="policy-badge" class="lens-badge">Declared model</span>',
        })}
        <ul id="map-notices" class="lens-notices" aria-label="Evidence notices"></ul>
        <section class="lens-section" aria-labelledby="map-title">
          <div class="lens-panel lens-stage" id="config-stage">
            <svg id="config-edges" class="lens-flow-layer" aria-hidden="true"></svg>
            <div id="source-chain" class="lens-flow-content source-chain" aria-label="Low-to-high configuration precedence"></div>
          </div>
        </section>
        <details class="lens-text-view" open>
          <summary>Resolution summary</summary>
          <ul id="source-list"></ul>
        </details>
      </main>
    `,
    extraCss: `${LENS_PANEL_CSS}
      .source-chain {
        display: grid; grid-auto-flow: column; grid-auto-columns: minmax(215px, 265px);
        gap: 46px; width: max-content; min-width: 100%;
      }
      #config-stage { overflow-x: auto; }
      .source-card[data-status="winner"] { --lens-accent: var(--vscode-charts-green, #89d185); }
      .source-card[data-status="winner"] { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--vscode-charts-green, #89d185) 60%, transparent); }
      .source-card[data-status="shadowed"] { --lens-accent: var(--vscode-charts-blue, #75beff); }
      .source-card[data-status="inactive"] { --lens-accent: var(--vscode-disabledForeground, var(--lens-muted)); opacity: .7; }
      .source-value {
        margin: 0; font-family: var(--vscode-editor-font-family, monospace);
        font-size: .78rem; overflow-wrap: anywhere; color: var(--vscode-foreground);
      }
      .status-badge {
        align-self: flex-start; border: 1px solid var(--lens-border); border-radius: 999px;
        padding: 2px 9px; font-size: .68rem; color: var(--lens-accent);
        border-color: color-mix(in srgb, var(--lens-accent) 45%, transparent);
      }
      #source-list { padding-left: 20px; display: grid; gap: 4px; }
      @media (max-width: 640px) { .source-chain { gap: 24px; } }
    `,
    scriptContent: `
      const vscode = acquireVsCodeApi();
      ${LENS_PANEL_SCRIPT}
      const title = document.getElementById('map-title');
      const summary = document.getElementById('map-summary');
      const policy = document.getElementById('policy-badge');
      const notices = document.getElementById('map-notices');
      const chain = document.getElementById('source-chain');
      const list = document.getElementById('source-list');
      const flow = createLensFlow(document.getElementById('config-stage'), document.getElementById('config-edges'));
      const sourceElements = new Map();

      document.addEventListener('click', event => {
        const button = event.target.closest('button[data-action][data-source-id]');
        if (button) vscode.postMessage({ type: button.dataset.action, sourceId: button.dataset.sourceId });
      });
      window.addEventListener('message', event => { if (event.data?.type === 'map') renderMap(event.data.map); });

      function renderMap(map) {
        sourceElements.clear();
        title.textContent = map.label;
        summary.textContent = map.key + ' · low → high precedence · ' + (map.winnerSourceId ? 'winner declared' : 'effective value unknown');
        policy.textContent = map.valuePolicy === 'masked' ? 'Values masked' : 'Displayable values';
        notices.replaceChildren(...map.notices.map(notice => element('li', notice)));
        chain.replaceChildren(...map.sources.map(renderSource));
        list.replaceChildren(...map.sources.map(source => element('li', source.label + ': ' + source.status + ' · ' + source.displayValue)));
        // The chain is the point of this lens, so the links between adjacent
        // sources are drawn rather than implied by a '→' glyph in the margin.
        // A link into the winner is drawn live; everything past it is spent.
        const edges = [];
        for (let index = 0; index < map.sources.length - 1; index += 1) {
          const from = map.sources[index];
          const to = map.sources[index + 1];
          edges.push({
            id: from.id + '->' + to.id,
            fromId: from.id,
            toId: to.id,
            from: sourceElements.get(from.id),
            to: sourceElements.get(to.id),
            accent: to.status === 'winner' ? 'green' : to.status === 'inactive' ? 'blue' : 'teal',
            strength: to.status === 'inactive' ? 'absent' : 'live'
          });
        }
        flow.render(edges);
      }
      function renderSource(source) {
        const card = element('article', '', 'lens-card source-card');
        card.dataset.status = source.status;
        card.dataset.accent = source.status === 'winner' ? 'green' : source.status === 'shadowed' ? 'blue' : 'teal';
        card.tabIndex = 0;
        card.append(element('h2', source.label, 'lens-card-title'));
        card.append(element('p', source.kind + ' · precedence ' + source.precedence, 'lens-card-meta'));
        card.append(element('p', source.displayValue, 'source-value'));
        card.append(element('span', source.status === 'winner' ? 'this value wins' : source.status, 'status-badge'));
        if (source.target) {
          const actions = element('div', '', 'lens-card-actions');
          actions.append(button('Open', 'openSource', source.id), button('Ask Atlas', 'askSource', source.id)); card.append(actions);
        }
        card.addEventListener('pointerenter', () => flow.highlight(source.id));
        card.addEventListener('pointerleave', () => flow.highlight(null));
        card.addEventListener('focusin', () => flow.highlight(source.id));
        card.addEventListener('focusout', () => flow.highlight(null));
        sourceElements.set(source.id, card);
        return card;
      }
      function button(label, action, id) {
        const value = element('button', label, 'lens-button'); value.type = 'button'; value.dataset.action = action; value.dataset.sourceId = id; return value;
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
