import * as vscode from 'vscode';

import type { LensConfigResolutionMap } from '../core/lensConfigResolution.js';
import { buildLensContextPatch, buildLensDraftPrompt, normalizeLensTarget } from '../core/lensTarget.js';
import type { LensVisualTarget } from '../types.js';
import { revealPreferredChatSurface } from './chatPanel.js';
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
      <main class="config-shell">
        <header class="config-header">
          <div><p class="eyebrow">AtlasMind Lens</p><h1 id="map-title">Configuration resolution</h1><p id="map-summary">Loading declared precedence…</p></div>
          <span id="policy-badge" class="mode-badge">Declared model</span>
        </header>
        <ul id="map-notices" class="notices" aria-label="Evidence notices"></ul>
        <section aria-labelledby="map-title">
          <div id="source-chain" class="source-chain" aria-label="Low-to-high configuration precedence"></div>
        </section>
        <details class="text-view" open>
          <summary>Resolution summary</summary>
          <ul id="source-list"></ul>
        </details>
      </main>
    `,
    extraCss: `
      .config-shell { max-width: 1440px; margin: 0 auto; }
      .config-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
      .config-header h1 { margin: 0; } .config-header p { margin: 4px 0 0; color: var(--vscode-descriptionForeground); }
      .eyebrow { font-size: .76rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
      .mode-badge { flex: none; border: 1px solid var(--vscode-widget-border); border-radius: 999px; padding: 4px 9px; color: var(--vscode-descriptionForeground); }
      .notices { padding-left: 20px; color: var(--vscode-descriptionForeground); }
      .source-chain { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(210px, 260px); gap: 28px; overflow-x: auto; padding: 20px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; background: var(--vscode-editor-background); }
      .source-card { position: relative; border: 1px solid var(--vscode-widget-border); border-top: 3px solid var(--vscode-descriptionForeground); border-radius: 6px; padding: 11px; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); }
      .source-card:not(:last-child)::after { content: '→'; position: absolute; right: -21px; top: 45%; color: var(--vscode-descriptionForeground); }
      .source-card[data-status="winner"] { border-top-color: var(--vscode-charts-green, #89d185); box-shadow: inset 0 0 0 1px var(--vscode-charts-green, #89d185); }
      .source-card[data-status="shadowed"] { border-top-color: var(--vscode-charts-blue, #75beff); }
      .source-card[data-status="inactive"] { opacity: .66; border-top-color: var(--vscode-disabledForeground); }
      .source-card h2 { margin: 0; font-size: .95rem; } .source-meta, .source-value { margin: 5px 0; color: var(--vscode-descriptionForeground); }
      .source-value { font-family: var(--vscode-editor-font-family, monospace); overflow-wrap: anywhere; }
      .status-badge { display: inline-block; border: 1px solid var(--vscode-widget-border); border-radius: 999px; padding: 2px 6px; font-size: .68rem; }
      .source-actions { display: flex; gap: 6px; margin-top: 9px; } .source-actions button { font-size: .75rem; }
      .text-view { margin-top: 16px; } .text-view summary { cursor: pointer; font-weight: 600; } .text-view li { color: var(--vscode-descriptionForeground); margin: 4px 0; }
      @media (max-width: 600px) { .config-header { flex-direction: column; } }
    `,
    scriptContent: `
      const vscode = acquireVsCodeApi();
      const title = document.getElementById('map-title');
      const summary = document.getElementById('map-summary');
      const policy = document.getElementById('policy-badge');
      const notices = document.getElementById('map-notices');
      const chain = document.getElementById('source-chain');
      const list = document.getElementById('source-list');
      document.addEventListener('click', event => {
        const button = event.target.closest('button[data-action][data-source-id]');
        if (button) vscode.postMessage({ type: button.dataset.action, sourceId: button.dataset.sourceId });
      });
      window.addEventListener('message', event => { if (event.data?.type === 'map') renderMap(event.data.map); });
      function renderMap(map) {
        title.textContent = map.label;
        summary.textContent = map.key + ' · low → high precedence · ' + (map.winnerSourceId ? 'winner declared' : 'effective value unknown');
        policy.textContent = map.valuePolicy === 'masked' ? 'Values masked' : 'Displayable values';
        notices.replaceChildren(...map.notices.map(notice => element('li', notice)));
        chain.replaceChildren(...map.sources.map(renderSource));
        list.replaceChildren(...map.sources.map(source => element('li', source.label + ': ' + source.status + ' · ' + source.displayValue)));
      }
      function renderSource(source) {
        const card = element('article', '', 'source-card'); card.dataset.status = source.status;
        card.append(element('h2', source.label));
        card.append(element('p', source.kind + ' · precedence ' + source.precedence, 'source-meta'));
        card.append(element('p', source.displayValue, 'source-value'));
        card.append(element('span', source.status, 'status-badge'));
        if (source.target) {
          const actions = element('div', '', 'source-actions');
          actions.append(button('Open', 'openSource', source.id), button('Ask Atlas', 'askSource', source.id)); card.append(actions);
        }
        return card;
      }
      function button(label, action, id) {
        const value = element('button', label); value.type = 'button'; value.dataset.action = action; value.dataset.sourceId = id; return value;
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
