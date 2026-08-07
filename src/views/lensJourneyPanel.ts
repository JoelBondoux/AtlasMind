import * as vscode from 'vscode';

import { normalizeLensGraph } from '../core/lensGraph.js';
import {
  buildLensContextPatch,
  buildLensDraftPrompt,
  normalizeLensTarget,
} from '../core/lensTarget.js';
import type { LensGraph, LensVisualTarget } from '../types.js';
import { revealPreferredChatSurface } from './chatPanel.js';
import { LENS_PANEL_CSS, LENS_PANEL_SCRIPT, renderLensHeader } from './lensVisuals.js';
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
    dashboardSkin: true,
    title: 'AtlasMind Lens — Possible Flow',
    cspSource,
    bodyContent: `
      <main class="lens-shell" data-accent="purple">
        ${renderLensHeader({
          eyebrow: 'Atlas Lens',
          title: 'Possible flow',
          titleId: 'journey-title',
          subtitle: 'Loading source-backed relationships…',
          subtitleId: 'journey-summary',
          mode: 'Static evidence',
          info: {
            title: 'Possible flow',
            body: 'Everything your language extension says can reach this symbol, and everything this symbol can reach. Read it before you change something to see who is standing behind you.',
            note: 'A path being possible does not prove it ever runs. This is what the compiler can see, not what your program did.',
          },
        })}
        <ul id="journey-notices" class="lens-notices" aria-label="Evidence notices"></ul>
        <section class="lens-section" aria-labelledby="journey-title">
          <div class="lens-panel lens-stage" id="journey-graph" aria-label="Possible code-flow graph">
            <svg id="journey-edges" class="lens-flow-layer" aria-hidden="true"></svg>
            <div id="journey-columns" class="lens-flow-content graph-columns"></div>
          </div>
        </section>
        <details class="lens-text-view">
          <summary>Text view</summary>
          <p>A keyboard- and screen-reader-friendly list of the same relationships.</p>
          <ul id="journey-text-edges"></ul>
        </details>
      </main>
    `,
    extraCss: `${LENS_PANEL_CSS}
      .graph-columns {
        display: grid; grid-auto-flow: column; grid-auto-columns: minmax(200px, 250px);
        gap: 56px; width: max-content; min-width: 100%;
      }
      #journey-graph { overflow-x: auto; min-height: 260px; }
      .graph-column { display: flex; flex-direction: column; gap: 11px; }
      .column-label {
        margin: 0; color: var(--lens-muted); font-size: .68rem;
        text-transform: uppercase; letter-spacing: .1em; font-weight: 700;
      }
      .column-hint { margin: 0 0 4px; font-size: .74rem; color: var(--lens-muted); }
      .journey-node[data-role="reference"] { --lens-accent: var(--vscode-charts-purple, #b180d7); }
      .journey-node[data-role="caller"] { --lens-accent: var(--vscode-charts-blue, #75beff); }
      .journey-node[data-role="callee"] { --lens-accent: var(--vscode-charts-green, #89d185); }
      @media (max-width: 640px) { .graph-columns { gap: 30px; } }
    `,
    scriptContent: `
      const vscode = acquireVsCodeApi();
      ${LENS_PANEL_SCRIPT}
      const title = document.getElementById('journey-title');
      const summary = document.getElementById('journey-summary');
      const notices = document.getElementById('journey-notices');
      const columns = document.getElementById('journey-columns');
      const textEdges = document.getElementById('journey-text-edges');
      const flow = createLensFlow(document.getElementById('journey-graph'), document.getElementById('journey-edges'));
      const ROLE_ACCENT = { reference: 'purple', caller: 'blue', callee: 'green', root: 'orange' };
      const nodeElements = new Map();
      let activeGraph;

      function appendTextElement(parent, tag, className, value) {
        const element = document.createElement(tag);
        if (className) { element.className = className; }
        element.textContent = String(value ?? '');
        parent.appendChild(element);
        return element;
      }

      function setHighlight(nodeId) {
        flow.highlight(nodeId);
        if (!nodeId || !activeGraph) {
          for (const card of nodeElements.values()) { card.classList.remove('is-dimmed', 'is-highlighted'); }
          return;
        }
        const related = new Set([nodeId]);
        for (const edge of activeGraph.edges) {
          if (edge.fromNodeId === nodeId) { related.add(edge.toNodeId); }
          if (edge.toNodeId === nodeId) { related.add(edge.fromNodeId); }
        }
        for (const [id, card] of nodeElements) {
          card.classList.toggle('is-highlighted', related.has(id));
          card.classList.toggle('is-dimmed', !related.has(id));
        }
      }

      function renderGraph(graph) {
        activeGraph = graph;
        nodeElements.clear();
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
          appendTextElement(column, 'p', 'column-hint', depth === 0
            ? 'Code that reaches the symbol you picked.'
            : depth === 1
              ? 'What you started from.'
              : 'Reached in ' + (depth - 1) + (depth - 1 === 1 ? ' step' : ' steps') + ' from it.');
          for (const node of byDepth.get(depth)) {
            const card = document.createElement('article');
            card.className = 'lens-card journey-node';
            card.dataset.nodeId = node.id;
            card.dataset.role = node.role;
            card.dataset.accent = ROLE_ACCENT[node.role] || 'purple';
            card.tabIndex = 0;
            appendTextElement(card, 'p', 'lens-card-kicker', node.role);
            appendTextElement(card, 'h2', 'lens-card-title', node.target.label);
            const suffix = node.target.range ? ':' + node.target.range.startLine : '';
            appendTextElement(card, 'p', 'lens-card-path', node.target.workspace.name + ' :: ' + node.target.workspacePath + suffix);
            const actions = document.createElement('div');
            actions.className = 'lens-card-actions';
            const open = appendTextElement(actions, 'button', 'lens-button', 'Open');
            open.type = 'button';
            open.addEventListener('click', () => vscode.postMessage({ type: 'openNode', nodeId: node.id }));
            const ask = appendTextElement(actions, 'button', 'lens-button', 'Ask Atlas');
            ask.type = 'button';
            ask.addEventListener('click', () => vscode.postMessage({ type: 'askNode', nodeId: node.id }));
            card.appendChild(actions);
            card.addEventListener('pointerenter', () => setHighlight(node.id));
            card.addEventListener('pointerleave', () => setHighlight(null));
            card.addEventListener('focusin', () => setHighlight(node.id));
            card.addEventListener('focusout', () => setHighlight(null));
            nodeElements.set(node.id, card);
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
        flow.render(graph.edges.map(edge => ({
          id: edge.fromNodeId + '->' + edge.toNodeId,
          fromId: edge.fromNodeId,
          toId: edge.toNodeId,
          from: nodeElements.get(edge.fromNodeId),
          to: nodeElements.get(edge.toNodeId),
          accent: ROLE_ACCENT[byId.get(edge.toNodeId)?.role] || 'purple',
          strength: 'live'
        })));
      }

      window.addEventListener('message', event => {
        const message = event.data;
        if (message && message.type === 'graph' && message.graph) { renderGraph(message.graph); }
      });
      vscode.postMessage({ type: 'ready' });
    `,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
