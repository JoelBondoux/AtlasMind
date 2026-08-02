import * as vscode from 'vscode';

import { normalizeLensGraph } from '../core/lensGraph.js';
import {
  buildLensContextPatch,
  buildLensDraftPrompt,
  normalizeLensTarget,
} from '../core/lensTarget.js';
import type { LensGraph, LensVisualTarget } from '../types.js';
import { revealPreferredChatSurface } from './chatPanel.js';
import { getWebviewHtmlShell } from './webviewUtils.js';

type LensJourneyMessage =
  | { type: 'ready' }
  | { type: 'openNode'; nodeId: string }
  | { type: 'askNode'; nodeId: string };

/** Secure, source-backed view of a bounded AtlasMind Lens graph. */
export class LensJourneyPanel {
  private static currentPanel: LensJourneyPanel | undefined;
  private static readonly viewType = 'atlasmind.lensJourney';

  private readonly disposables: vscode.Disposable[] = [];
  private readonly nodeById: Map<string, LensVisualTarget>;
  private ready = false;

  public static createOrShow(candidate: LensGraph): void {
    const graph = normalizeLensGraph(candidate);
    if (!graph) {
      void vscode.window.showWarningMessage('AtlasMind Lens refused an invalid journey graph.');
      return;
    }

    if (LensJourneyPanel.currentPanel) {
      LensJourneyPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      LensJourneyPanel.currentPanel.replaceGraph(graph);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      LensJourneyPanel.viewType,
      'Lens — Possible Flow',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );
    LensJourneyPanel.currentPanel = new LensJourneyPanel(panel, graph);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private graph: LensGraph,
  ) {
    this.nodeById = new Map(graph.nodes.map(node => [node.id, node.target]));
    this.panel.webview.html = buildJourneyHtml(this.panel.webview.cspSource);
    this.panel.webview.onDidReceiveMessage(
      (raw: unknown) => {
        const message = normalizeJourneyMessage(raw);
        if (message) {
          void this.handleMessage(message);
        }
      },
      null,
      this.disposables,
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private replaceGraph(graph: LensGraph): void {
    this.graph = graph;
    this.nodeById.clear();
    for (const node of graph.nodes) {
      this.nodeById.set(node.id, node.target);
    }
    if (this.ready) {
      void this.panel.webview.postMessage({ type: 'graph', graph: this.graph });
    }
  }

  private async handleMessage(message: LensJourneyMessage): Promise<void> {
    if (message.type === 'ready') {
      this.ready = true;
      await this.panel.webview.postMessage({ type: 'graph', graph: this.graph });
      return;
    }

    const target = normalizeLensTarget(this.nodeById.get(message.nodeId));
    if (!target) {
      return;
    }
    if (message.type === 'openNode') {
      const uri = resolveWorkspaceTarget(target);
      if (!uri) {
        void vscode.window.showWarningMessage('AtlasMind Lens refused an invalid or out-of-workspace journey target.');
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
    LensJourneyPanel.currentPanel = undefined;
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }
}

function normalizeJourneyMessage(value: unknown): LensJourneyMessage | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }
  if (value.type === 'ready') {
    return { type: 'ready' };
  }
  if (
    (value.type === 'openNode' || value.type === 'askNode') &&
    typeof value.nodeId === 'string' &&
    value.nodeId.length > 0 &&
    value.nodeId.length <= 500 &&
    !/[\u0000-\u001f\u007f]/.test(value.nodeId)
  ) {
    return { type: value.type, nodeId: value.nodeId };
  }
  return undefined;
}

function resolveWorkspaceTarget(target: LensVisualTarget): vscode.Uri | undefined {
  const folder = vscode.workspace.workspaceFolders?.find(candidate =>
    candidate.name === target.workspace.name && candidate.index === target.workspace.index,
  );
  if (!folder) {
    return undefined;
  }
  const uri = vscode.Uri.joinPath(folder.uri, ...target.workspacePath.split('/'));
  const resolvedFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (
    !resolvedFolder ||
    resolvedFolder.name !== target.workspace.name ||
    resolvedFolder.index !== target.workspace.index ||
    normalizeRelativePath(vscode.workspace.asRelativePath(uri, false)) !== target.workspacePath
  ) {
    return undefined;
  }
  return uri;
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

function buildJourneyHtml(cspSource: string): string {
  return getWebviewHtmlShell({
    title: 'AtlasMind Lens — Possible Flow',
    cspSource,
    bodyContent: `
      <main class="journey-shell">
        <header class="journey-header">
          <div>
            <p class="eyebrow">AtlasMind Lens</p>
            <h1 id="journey-title">Possible flow</h1>
            <p id="journey-summary">Loading source-backed relationships…</p>
          </div>
          <span class="mode-badge">Static evidence</span>
        </header>
        <section aria-labelledby="journey-title">
          <ul id="journey-notices" class="notices" aria-label="Evidence notices"></ul>
          <div id="journey-graph" class="graph-stage" aria-label="Possible code-flow graph">
            <svg id="journey-edges" class="edge-layer" aria-hidden="true"></svg>
            <div id="journey-columns" class="graph-columns"></div>
          </div>
        </section>
        <details class="text-view">
          <summary>Text view</summary>
          <p>A keyboard- and screen-reader-friendly list of the same relationships.</p>
          <ul id="journey-text-edges"></ul>
        </details>
      </main>
    `,
    extraCss: `
      .journey-shell { max-width: 1440px; margin: 0 auto; }
      .journey-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
      .journey-header h1 { margin: 0; }
      .journey-header p { margin: 4px 0 0; color: var(--vscode-descriptionForeground); }
      .eyebrow { font-size: 0.76rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
      .mode-badge { flex: none; border: 1px solid var(--vscode-widget-border); border-radius: 999px; padding: 4px 9px; color: var(--vscode-descriptionForeground); }
      .notices { padding-left: 20px; color: var(--vscode-descriptionForeground); }
      .graph-stage { position: relative; overflow-x: auto; border: 1px solid var(--vscode-widget-border); border-radius: 8px; padding: 20px; min-height: 240px; background: var(--vscode-editor-background); }
      .graph-columns { position: relative; z-index: 1; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(190px, 240px); gap: 44px; width: max-content; min-width: 100%; }
      .graph-column { display: flex; flex-direction: column; gap: 12px; }
      .column-label { margin: 0 0 2px; color: var(--vscode-descriptionForeground); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; }
      .journey-node { border: 1px solid var(--vscode-widget-border); border-left: 3px solid var(--vscode-focusBorder); border-radius: 6px; padding: 10px; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); box-shadow: 0 2px 8px color-mix(in srgb, black 18%, transparent); }
      .journey-node[data-role="reference"] { border-left-color: var(--vscode-charts-purple, #b180d7); }
      .journey-node[data-role="caller"] { border-left-color: var(--vscode-charts-blue, #75beff); }
      .journey-node[data-role="callee"] { border-left-color: var(--vscode-charts-green, #89d185); }
      .node-role { margin: 0 0 3px; color: var(--vscode-descriptionForeground); font-size: 0.72rem; text-transform: uppercase; }
      .node-label { margin: 0; font-size: 0.92rem; }
      .node-location { margin: 4px 0 9px; color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family, monospace); font-size: 0.75rem; }
      .node-actions { display: flex; gap: 6px; }
      .node-action { border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
      .node-action:hover { background: var(--vscode-button-secondaryHoverBackground); }
      .node-action:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
      .edge-layer { position: absolute; inset: 0; z-index: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
      .edge-line { stroke: var(--vscode-descriptionForeground); stroke-width: 1.5; opacity: 0.72; fill: none; }
      .text-view { margin-top: 16px; border-top: 1px solid var(--vscode-widget-border); padding-top: 10px; }
      .text-view summary { cursor: pointer; font-weight: 600; }
      .text-view p, .text-view li { color: var(--vscode-descriptionForeground); }
      @media (max-width: 600px) { .journey-header { flex-direction: column; } .graph-columns { gap: 28px; } }
    `,
    scriptContent: `
      const vscode = acquireVsCodeApi();
      const title = document.getElementById('journey-title');
      const summary = document.getElementById('journey-summary');
      const notices = document.getElementById('journey-notices');
      const columns = document.getElementById('journey-columns');
      const edgesLayer = document.getElementById('journey-edges');
      const textEdges = document.getElementById('journey-text-edges');
      let activeGraph;

      function appendTextElement(parent, tag, className, value) {
        const element = document.createElement(tag);
        if (className) { element.className = className; }
        element.textContent = String(value ?? '');
        parent.appendChild(element);
        return element;
      }

      function renderGraph(graph) {
        activeGraph = graph;
        title.textContent = graph.label;
        summary.textContent = graph.nodes.length + ' nodes · ' + graph.edges.length + ' relationships' + (graph.truncated ? ' · bounded view' : '');
        notices.replaceChildren();
        for (const notice of graph.notices) { appendTextElement(notices, 'li', '', notice); }
        columns.replaceChildren();
        textEdges.replaceChildren();

        const byId = new Map(graph.nodes.map(node => [node.id, node]));
        const byDepth = new Map();
        for (const node of graph.nodes) {
          const group = byDepth.get(node.depth) || [];
          group.push(node);
          byDepth.set(node.depth, group);
        }
        for (const depth of [...byDepth.keys()].sort((left, right) => left - right)) {
          const column = document.createElement('div');
          column.className = 'graph-column';
          column.dataset.depth = String(depth);
          appendTextElement(column, 'p', 'column-label', depth === 0 ? 'Incoming' : depth === 1 ? 'Selected' : 'Depth ' + (depth - 1));
          for (const node of byDepth.get(depth)) {
            const card = document.createElement('article');
            card.className = 'journey-node';
            card.dataset.nodeId = node.id;
            card.dataset.role = node.role;
            appendTextElement(card, 'p', 'node-role', node.role);
            appendTextElement(card, 'h2', 'node-label', node.target.label);
            const suffix = node.target.range ? ':' + node.target.range.startLine : '';
            appendTextElement(card, 'p', 'node-location', node.target.workspace.name + ' :: ' + node.target.workspacePath + suffix);
            const actions = document.createElement('div');
            actions.className = 'node-actions';
            const open = appendTextElement(actions, 'button', 'node-action', 'Open');
            open.type = 'button';
            open.addEventListener('click', () => vscode.postMessage({ type: 'openNode', nodeId: node.id }));
            const ask = appendTextElement(actions, 'button', 'node-action', 'Ask Atlas');
            ask.type = 'button';
            ask.addEventListener('click', () => vscode.postMessage({ type: 'askNode', nodeId: node.id }));
            card.appendChild(actions);
            column.appendChild(card);
          }
          columns.appendChild(column);
        }

        if (graph.edges.length === 0) { appendTextElement(textEdges, 'li', '', 'No relationships were returned by the active language provider.'); }
        for (const edge of graph.edges) {
          const from = byId.get(edge.fromNodeId);
          const to = byId.get(edge.toNodeId);
          if (!from || !to) { continue; }
          appendTextElement(textEdges, 'li', '', from.target.label + ' ' + edge.relation + ' ' + to.target.label + ' — ' + edge.evidence.source);
        }
        requestAnimationFrame(drawEdges);
      }

      function drawEdges() {
        edgesLayer.replaceChildren();
        if (!activeGraph) { return; }
        const stageRect = edgesLayer.parentElement.getBoundingClientRect();
        edgesLayer.setAttribute('viewBox', '0 0 ' + stageRect.width + ' ' + stageRect.height);
        for (const edge of activeGraph.edges) {
          const from = columns.querySelector('[data-node-id="' + CSS.escape(edge.fromNodeId) + '"]');
          const to = columns.querySelector('[data-node-id="' + CSS.escape(edge.toNodeId) + '"]');
          if (!from || !to) { continue; }
          const fromRect = from.getBoundingClientRect();
          const toRect = to.getBoundingClientRect();
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          const startX = fromRect.right - stageRect.left;
          const startY = fromRect.top + fromRect.height / 2 - stageRect.top;
          const endX = toRect.left - stageRect.left;
          const endY = toRect.top + toRect.height / 2 - stageRect.top;
          const curve = Math.max(24, Math.abs(endX - startX) * 0.42);
          path.setAttribute('d', 'M ' + startX + ' ' + startY + ' C ' + (startX + curve) + ' ' + startY + ', ' + (endX - curve) + ' ' + endY + ', ' + endX + ' ' + endY);
          path.setAttribute('class', 'edge-line');
          edgesLayer.appendChild(path);
        }
      }

      window.addEventListener('message', event => {
        const message = event.data;
        if (message && message.type === 'graph' && message.graph) { renderGraph(message.graph); }
      });
      window.addEventListener('resize', () => requestAnimationFrame(drawEdges));
      vscode.postMessage({ type: 'ready' });
    `,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
