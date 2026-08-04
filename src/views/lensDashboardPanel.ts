import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';

import {
  buildLensDashboard,
  findLensCatalogEntry,
  type LensDashboardInput,
  type LensDashboardView,
} from '../core/lensDashboard.js';
import { inspectLensDeclarations } from '../core/lensDeclarations.js';
import {
  LENS_PANEL_CSS,
  LENS_PANEL_SCRIPT,
  renderLensHeader,
  renderLensInfo,
} from './lensVisuals.js';
import { getWebviewHtmlShell } from './webviewUtils.js';

const execFileAsync = promisify(execFile);

type LensDashboardMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'openLens'; lensId: string }
  | { type: 'runAction'; actionId: string };

/**
 * The Atlas Lenses home.
 *
 * Lens had eight surfaces and no front door: each one was reached by knowing
 * its command, and nothing anywhere said what the set was, what each lens
 * reads, or why one of them refuses to open. This is that front door, and it is
 * built on three rules the rest of the codebase already keeps.
 *
 * **The webview names an id, never a command.** Every clickable thing posts a
 * bounded lens id or action id; the host resolves it against a map it holds
 * itself and executes the command *that map* names. A compromised or confused
 * webview cannot reach a command the dashboard did not already offer — which is
 * the difference between a panel that routes and a panel that is an arbitrary
 * command executor.
 *
 * **Nothing is seeded by rendering.** Opening the dashboard inspects declaration
 * files read-only and asks Git whether a repository exists. It creates no file,
 * runs no scan of the workspace, and calls no model. A dashboard that wrote
 * something because somebody looked at it would make "have a look" a decision.
 *
 * **Unassessed is drawn as unassessed.** Contract candidates are deliberately
 * *not* counted here: that scan reads up to 200 files, and doing it on render
 * would make opening a summary the most expensive thing in the feature. The
 * card says it has not been assessed and offers to assess it, which is a true
 * statement; reporting "no contracts" without looking would not be.
 */
export class LensDashboardPanel {
  private static currentPanel: LensDashboardPanel | undefined;
  private static readonly viewType = 'atlasmind.lensDashboard';

  private readonly disposables: vscode.Disposable[] = [];
  private view: LensDashboardView;
  private ready = false;

  public static async createOrShow(): Promise<void> {
    if (LensDashboardPanel.currentPanel) {
      LensDashboardPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active);
      await LensDashboardPanel.currentPanel.refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      LensDashboardPanel.viewType,
      'Atlas Lenses',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    LensDashboardPanel.currentPanel = new LensDashboardPanel(panel, buildLensDashboard(await collectLensDashboardInput()));
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    view: LensDashboardView,
  ) {
    this.view = view;
    this.panel.webview.html = buildDashboardHtml(this.panel.webview.cspSource);
    this.panel.webview.onDidReceiveMessage(
      (raw: unknown) => {
        const message = normalizeDashboardMessage(raw);
        if (message) {
          void this.handleMessage(message);
        }
      },
      null,
      this.disposables,
    );
    // The dashboard reports the active editor's target, so it follows the
    // editor the same way the Code Explorer does. Without this the readiness of
    // four lenses would be a snapshot from whenever the panel happened to open.
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => void this.refresh()),
      this.panel.onDidChangeViewState(() => {
        if (this.panel.visible) {
          void this.refresh();
        }
      }),
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private async refresh(): Promise<void> {
    this.view = buildLensDashboard(await collectLensDashboardInput());
    if (this.ready) {
      await this.panel.webview.postMessage({ type: 'dashboard', view: this.view });
    }
  }

  private async handleMessage(message: LensDashboardMessage): Promise<void> {
    if (message.type === 'ready') {
      this.ready = true;
      await this.panel.webview.postMessage({ type: 'dashboard', view: this.view });
      return;
    }
    if (message.type === 'refresh') {
      await this.refresh();
      return;
    }
    if (message.type === 'openLens') {
      // Resolved against the catalog, not against anything the webview sent.
      const entry = findLensCatalogEntry(message.lensId);
      if (!entry) {
        return;
      }
      if (entry.reachedFromSelection) {
        await vscode.commands.executeCommand('atlasmind.lensView.focus');
        void vscode.window.showInformationMessage(
          `${entry.name} starts from a symbol. Pick one in Lens — Code Explorer, then choose "${entry.name}" from its actions menu.`,
        );
        return;
      }
      await vscode.commands.executeCommand(entry.command);
      return;
    }

    const action = this.view.actions.find(candidate => candidate.id === message.actionId);
    if (!action) {
      return;
    }
    if (action.command === 'vscode.openFolder') {
      await vscode.commands.executeCommand('workbench.action.files.openFolder');
      return;
    }
    await (action.commandArg
      ? vscode.commands.executeCommand(action.command, action.commandArg)
      : vscode.commands.executeCommand(action.command));
    await this.refresh();
  }

  private dispose(): void {
    LensDashboardPanel.currentPanel = undefined;
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }
}

/** Register the one command that opens the Lens dashboard. */
export function registerLensDashboard(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('atlasmind.lens.openDashboard', () => LensDashboardPanel.createOrShow()),
  );
}

/**
 * Read-only observation of what each lens has to work with.
 *
 * Every field is optional on purpose: an input this cannot determine is left
 * absent so the core reports it as unassessed rather than as empty.
 */
export async function collectLensDashboardInput(): Promise<LensDashboardInput> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return {};
  }
  const diskBacked = folder.uri.scheme === 'file' || folder.uri.scheme === 'vscode-remote';
  return {
    workspaceName: folder.name,
    ...(activeLensTarget() ? { activeTarget: activeLensTarget() } : {}),
    ...(diskBacked ? { declarations: inspectLensDeclarations(folder.uri.fsPath) } : {}),
    ...(diskBacked ? { git: await readGitState(folder.uri.fsPath) } : {}),
  };
}

function activeLensTarget(): LensDashboardInput['activeTarget'] {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }
  const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (!folder) {
    return undefined;
  }
  const workspacePath = normalizeRelativePath(vscode.workspace.asRelativePath(editor.document.uri, false));
  if (!workspacePath) {
    return undefined;
  }
  return {
    // The dashboard reports the *file*; picking a symbol stays the Code
    // Explorer's job, so a lens that needs one still says so rather than
    // claiming readiness the editor cannot supply.
    kind: 'file',
    label: workspacePath.split('/').at(-1) ?? workspacePath,
    workspacePath,
  };
}

/**
 * Whether the workspace root is a Git repository, and which branch is checked
 * out. Fixed read-only argument arrays through `execFile` — never a shell, and
 * never a value interpolated from anything a user typed.
 */
async function readGitState(cwd: string): Promise<{ repository: boolean; branch?: string }> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      timeout: 4000,
      windowsHide: true,
    });
    const branch = stdout.trim();
    return branch && /^[\w./+-]{1,200}$/.test(branch) ? { repository: true, branch } : { repository: true };
  } catch {
    return { repository: false };
  }
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

function normalizeDashboardMessage(value: unknown): LensDashboardMessage | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }
  if (value.type === 'ready' || value.type === 'refresh') {
    return { type: value.type };
  }
  if (value.type === 'openLens' && boundedId(value.lensId)) {
    return { type: 'openLens', lensId: value.lensId };
  }
  if (value.type === 'runAction' && boundedId(value.actionId)) {
    return { type: 'runAction', actionId: value.actionId };
  }
  return undefined;
}

function boundedId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildDashboardHtml(cspSource: string): string {
  return getWebviewHtmlShell({
    title: 'Atlas Lenses',
    cspSource,
    bodyContent: `
      <main class="lens-shell">
        ${renderLensHeader({
          eyebrow: 'AtlasMind',
          title: 'Atlas Lenses',
          subtitle: 'Eight ways to look at what you are about to change. Each one reads evidence that already exists — your language extension, your repository, your commits — and none of them asks a model anything until you do.',
          subtitleId: 'dashboard-subtitle',
          mode: 'Evidence, not opinion',
          info: {
            title: 'Atlas Lenses',
            body: 'A lens answers one question from one kind of evidence, and always says which. Opening a lens costs nothing: no model runs, no file is written, and nothing in your project is changed.',
            note: 'Where a lens cannot prove something, it says so rather than guessing. An empty result means missing evidence, never a clean bill of health.',
          },
          aside: '<button type="button" id="refresh-dashboard" class="lens-button">Refresh</button>',
        })}

        <section class="lens-section" id="actions-section" aria-labelledby="actions-title">
          <div class="lens-section-head">
            <h2 id="actions-title">Do this next</h2>
            ${renderLensInfo({
              title: 'Do this next',
              body: 'Only the things that need a person right now, ranked by consequence rather than by how many there are. Each one names the rule that raised it.',
              note: 'This band is empty when nothing needs you. It is the only part of this page that can be — which is what makes it worth reading.',
            })}
            <span class="lens-section-count" id="actions-count"></span>
          </div>
          <div id="actions-list" class="actions-list"></div>
          <p id="actions-remainder" class="lens-remainder" hidden></p>
        </section>

        <section class="lens-section" aria-labelledby="flow-title">
          <div class="lens-section-head">
            <h2 id="flow-title">How the lenses fit together</h2>
            ${renderLensInfo({
              title: 'The flow map',
              body: 'Left to right: the evidence a lens reads, the lens itself, and the question it answers. Hover or focus anything to follow its links.',
              note: 'A dashed link means that evidence was never assessed. A faint dotted one means it was assessed and is not there.',
            })}
          </div>
          <div class="lens-panel lens-stage" id="flow-stage">
            <svg class="lens-flow-layer" id="flow-layer" aria-hidden="true"></svg>
            <div class="lens-flow-content flow-columns" id="flow-columns"></div>
          </div>
        </section>

        <section class="lens-section" aria-labelledby="gallery-title">
          <div class="lens-section-head">
            <h2 id="gallery-title">The lenses</h2>
            ${renderLensInfo({
              title: 'The lenses',
              body: 'Click any lens to open it. Cards are grouped by what they are about: your code, your contracts, the model your repository declares for itself, and your history.',
            })}
            <span class="lens-section-count" id="gallery-count"></span>
          </div>
          <div id="gallery" class="gallery"></div>
        </section>

        <details class="lens-text-view">
          <summary>How readiness is decided</summary>
          <p>Every state on this page comes from one of these declared rules. Nothing here is a judgement call, and nothing is inferred by a model.</p>
          <ul id="rules-list"></ul>
        </details>
      </main>
    `,
    extraCss: `${LENS_PANEL_CSS}
      .actions-list { display: grid; gap: 9px; }
      .action-card { display: flex; gap: 12px; align-items: flex-start; }
      .action-card .lens-card-actions { margin-top: 0; }
      .action-body { flex: 1 1 auto; display: flex; flex-direction: column; gap: 4px; }
      .action-rule {
        font-size: .68rem; letter-spacing: .06em; text-transform: uppercase;
        color: var(--lens-muted); font-family: var(--vscode-editor-font-family, monospace);
      }
      .action-card[data-severity="blocking"] { --lens-accent: var(--vscode-errorForeground); }
      .action-card[data-severity="setup"] { --lens-accent: var(--vscode-charts-orange, #d18616); }
      .action-card[data-severity="suggestion"] { --lens-accent: var(--vscode-charts-blue, #75beff); }

      .flow-columns {
        display: grid; grid-template-columns: minmax(150px, .85fr) minmax(190px, 1.1fr) minmax(150px, .85fr);
        gap: 52px;
        /* "stretch", not "start": the columns must fill the tallest row before
           the short ones have any spare height to centre their cards in. */
        align-items: stretch;
      }
      /* The evidence column holds four nodes against the lens column's eight, so
         its cards are centred vertically and the curves fan from a balanced
         group rather than from a stack pinned to the top with a third of the
         panel empty beneath it. The title stays in flow in its own row —
         absolutely positioning it laid it across the first card. */
      .flow-column { display: flex; flex-direction: column; }
      .flow-column-body { display: flex; flex-direction: column; gap: 10px; flex: 1 1 auto; }
      .flow-column[data-column="evidence"] .flow-column-body,
      .flow-column[data-column="question"] .flow-column-body { justify-content: center; }
      .flow-column-title {
        margin: 0 0 12px; font-size: .68rem; font-weight: 700; letter-spacing: .1em;
        text-transform: uppercase; color: var(--lens-muted); flex: none;
      }
      .flow-node {
        position: relative; padding: 9px 11px; border-radius: 8px; font-size: .8rem;
        border: 1px solid var(--lens-border); background: var(--lens-surface-raised);
        transition: border-color 120ms ease, opacity 120ms ease, box-shadow 120ms ease;
      }
      .flow-node.is-dimmed { opacity: .3; }
      .flow-node.is-highlighted {
        border-color: var(--lens-accent);
        box-shadow: 0 0 0 1px var(--lens-accent);
      }
      .flow-node-label { margin: 0; font-weight: 640; display: flex; align-items: center; gap: 6px; }
      .flow-node-detail { margin: 3px 0 0; font-size: .74rem; color: var(--lens-muted); }
      button.flow-node { display: block; width: 100%; text-align: left; cursor: pointer; color: inherit; }
      button.flow-node:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
      .flow-node-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--lens-accent); flex: none; }

      /* One grid, with the group heading spanning a full row. Per-group grids
         left "The contract" as a single card floating in a four-column track. */
      .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 10px; align-items: stretch; }
      .gallery-heading {
        grid-column: 1 / -1; margin: 10px 0 0; font-size: .75rem; font-weight: 700;
        letter-spacing: .09em; text-transform: uppercase; color: var(--lens-muted);
        display: flex; align-items: center; gap: 9px;
      }
      .gallery-heading:first-child { margin-top: 0; }
      .gallery-heading::after {
        content: ''; flex: 1 1 auto; height: 1px;
        background: linear-gradient(90deg, var(--lens-border), transparent);
      }
      .lens-tile { text-align: left; font: inherit; color: inherit; width: 100%; }
      .lens-tile .lens-card-head { align-items: center; }
      .lens-tile-question { margin: 0; font-size: .82rem; color: var(--vscode-foreground); font-weight: 550; }
      .lens-tile-plain { margin: 0; font-size: .79rem; color: var(--lens-muted); }
      /* flex-start, not center: the status line wraps to three lines on a narrow
         card, and centring floated the dot alongside the second one — reading as
         a bullet dropped into the middle of a sentence. */
      .lens-tile-state {
        margin: 2px 0 0; font-size: .75rem; display: flex; align-items: flex-start; gap: 6px;
        color: var(--lens-muted);
      }
      .lens-tile-state::before {
        content: ''; width: 6px; height: 6px; border-radius: 50%; flex: none;
        background: currentColor; margin-top: .42em;
      }
      .lens-tile[data-readiness="ready"] .lens-tile-state { color: var(--vscode-charts-green, #89d185); }
      .lens-tile[data-readiness="needs-setup"] .lens-tile-state { color: var(--vscode-charts-orange, #d18616); }
      .lens-tile[data-readiness="needs-selection"] .lens-tile-state { color: var(--vscode-charts-blue, #75beff); }
      .lens-tile[data-readiness="unavailable"] .lens-tile-state { color: var(--vscode-errorForeground); }
      #rules-list { padding-left: 20px; display: grid; gap: 5px; }
      #rules-list code { font-family: var(--vscode-editor-font-family, monospace); font-size: .76rem; }

      @media (max-width: 900px) {
        .flow-columns { grid-template-columns: 1fr; gap: 18px; }
        /* Links between stacked columns would cross every card between them, so
           the flow layer is hidden rather than drawn wrong. The columns still
           read top-to-bottom in the same order. */
        #flow-layer { display: none; }
      }
    `,
    scriptContent: `
      const vscode = acquireVsCodeApi();
      ${LENS_PANEL_SCRIPT}

      const actionsSection = document.getElementById('actions-section');
      const actionsList = document.getElementById('actions-list');
      const actionsCount = document.getElementById('actions-count');
      const actionsRemainder = document.getElementById('actions-remainder');
      const flowStage = document.getElementById('flow-stage');
      const flowColumns = document.getElementById('flow-columns');
      const gallery = document.getElementById('gallery');
      const galleryCount = document.getElementById('gallery-count');
      const rulesList = document.getElementById('rules-list');
      const subtitle = document.getElementById('dashboard-subtitle');
      const flow = createLensFlow(flowStage, document.getElementById('flow-layer'));
      const nodeElements = new Map();

      const READINESS_LABEL = {
        'ready': 'Ready',
        'needs-selection': 'Waiting for a selection',
        'needs-setup': 'Needs setup',
        'unavailable': 'Unavailable here',
        'unknown': 'Not assessed'
      };
      const COLUMN_TITLE = { evidence: 'What it reads', lens: 'The lens', question: 'What it answers' };

      document.getElementById('refresh-dashboard').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));

      function element(tag, text, className) {
        const node = document.createElement(tag);
        if (text) { node.textContent = text; }
        if (className) { node.className = className; }
        return node;
      }

      function renderDashboard(view) {
        subtitle.textContent = view.workspaceName
          ? view.summary + ' In ' + view.workspaceName + (view.branch ? ' on ' + view.branch : '') + '.'
          : 'No folder is open, so no lens has anything to read yet.';
        renderActions(view);
        renderFlow(view);
        renderGallery(view);
        rulesList.replaceChildren(...view.rules.map(rule => {
          const item = document.createElement('li');
          item.append(element('code', rule.id), document.createTextNode(' — ' + rule.description));
          return item;
        }));
      }

      function renderActions(view) {
        actionsList.replaceChildren();
        actionsCount.textContent = view.actions.length
          ? view.actions.length + (view.actions.length === 1 ? ' item' : ' items')
          : '';
        if (!view.actions.length) {
          // Empty is a real answer here, and which empty it is matters: nothing
          // to do is not the same fact as nothing looked at.
          actionsList.append(element('p', view.emptyState === 'clear'
            ? 'Nothing needs you. Every lens that was assessed is ready.'
            : 'Nothing to do yet — and not much has been assessed. Open a lens to find out where you stand.',
            'lens-empty'));
        }
        for (const action of view.actions) {
          const card = element('article', '', 'lens-card action-card');
          card.dataset.severity = action.severity;
          const body = element('div', '', 'action-body');
          const head = element('div', '', 'lens-card-head');
          head.append(element('h3', action.title, 'lens-card-title'));
          body.append(head);
          body.append(element('p', action.detail, 'lens-card-body'));
          body.append(element('p', 'rule: ' + action.rule, 'action-rule'));
          card.append(body);
          const actions = element('div', '', 'lens-card-actions');
          const button = element('button', action.actionLabel, 'lens-button primary');
          button.type = 'button';
          button.addEventListener('click', () => vscode.postMessage({ type: 'runAction', actionId: action.id }));
          actions.append(button);
          card.append(actions);
          actionsList.append(card);
        }
        actionsRemainder.hidden = view.hiddenActionCount === 0;
        actionsRemainder.textContent = view.hiddenActionCount
          ? view.hiddenActionCount + ' further ' + (view.hiddenActionCount === 1 ? 'item is' : 'items are') + ' not shown.'
          : '';
        actionsSection.dataset.empty = String(view.actions.length === 0);
      }

      function renderFlow(view) {
        nodeElements.clear();
        flowColumns.replaceChildren();
        for (const column of ['evidence', 'lens', 'question']) {
          const wrapper = element('div', '', 'flow-column');
          wrapper.dataset.column = column;
          wrapper.append(element('p', COLUMN_TITLE[column], 'flow-column-title'));
          const body = element('div', '', 'flow-column-body');
          for (const node of view.flow.nodes.filter(candidate => candidate.column === column)) {
            const isLens = Boolean(node.lensId);
            const box = element(isLens ? 'button' : 'div', '', 'flow-node');
            if (isLens) {
              box.type = 'button';
              box.dataset.lensId = node.lensId;
              box.addEventListener('click', () => vscode.postMessage({ type: 'openLens', lensId: node.lensId }));
            }
            if (node.accent) { box.dataset.accent = node.accent; }
            const label = element('p', '', 'flow-node-label');
            if (isLens) { label.append(element('span', '', 'flow-node-dot')); }
            label.append(document.createTextNode(node.label));
            box.append(label);
            box.append(element('p', node.detail, 'flow-node-detail'));
            box.addEventListener('pointerenter', () => setHighlight(node.id));
            box.addEventListener('pointerleave', () => setHighlight(null));
            box.addEventListener('focus', () => setHighlight(node.id));
            box.addEventListener('blur', () => setHighlight(null));
            nodeElements.set(node.id, box);
            body.append(box);
          }
          wrapper.append(body);
          flowColumns.append(wrapper);
        }
        flow.render(view.flow.edges.map(edge => ({
          id: edge.id,
          fromId: edge.fromNodeId,
          toId: edge.toNodeId,
          from: nodeElements.get(edge.fromNodeId),
          to: nodeElements.get(edge.toNodeId),
          accent: edge.accent,
          strength: edge.strength
        })));
        activeEdges = view.flow.edges;
      }

      let activeEdges = [];

      function setHighlight(nodeId) {
        flow.highlight(nodeId);
        if (!nodeId) {
          for (const box of nodeElements.values()) { box.classList.remove('is-dimmed', 'is-highlighted'); }
          return;
        }
        // A node's neighbours stay lit with it. Dimming everything except the
        // hovered card would hide the very relationship the hover is asking about.
        const related = new Set([nodeId]);
        for (const edge of activeEdges) {
          if (edge.fromNodeId === nodeId) { related.add(edge.toNodeId); }
          if (edge.toNodeId === nodeId) { related.add(edge.fromNodeId); }
        }
        for (const [id, box] of nodeElements) {
          box.classList.toggle('is-highlighted', related.has(id));
          box.classList.toggle('is-dimmed', !related.has(id));
        }
      }

      function renderGallery(view) {
        gallery.replaceChildren();
        galleryCount.textContent = view.readyCount + ' of ' + view.lenses.length + ' ready';
        let currentGroup;
        for (const lens of view.lenses) {
          if (lens.group !== currentGroup) {
            currentGroup = lens.group;
            gallery.append(element('h3', currentGroup, 'gallery-heading'));
          }
          gallery.append(renderTile(lens));
        }
      }

      function renderTile(lens) {
        const tile = element('button', '', 'lens-card is-interactive lens-tile');
        tile.type = 'button';
        tile.dataset.accent = lens.accent;
        tile.dataset.readiness = lens.readiness;
        tile.setAttribute('aria-label', lens.name + ' — ' + READINESS_LABEL[lens.readiness] + '. ' + lens.readinessReason);
        const head = element('div', '', 'lens-card-head');
        const heading = element('div');
        // The group name is already the heading above this card; naming the
        // evidence source instead is the fact the reader does not already have.
        heading.append(element('p', lens.evidenceLabel, 'lens-card-kicker'));
        heading.append(element('h4', lens.name, 'lens-card-title'));
        head.append(heading);
        // The info button explains the lens without opening it, which is the
        // whole point: a novice should not have to run something to find out
        // what it would have told them.
        head.append(createLensInfo(lens.name, lens.plain, lens.limit));
        tile.append(head);
        tile.append(element('p', lens.question, 'lens-tile-question'));
        tile.append(element('p', lens.plain, 'lens-tile-plain'));
        const state = element('p', READINESS_LABEL[lens.readiness] + ' · ' + lens.readinessReason, 'lens-tile-state');
        tile.append(state);
        tile.addEventListener('click', () => vscode.postMessage({ type: 'openLens', lensId: lens.id }));
        return tile;
      }

      window.addEventListener('message', event => {
        const message = event.data;
        if (message && message.type === 'dashboard' && message.view) { renderDashboard(message.view); }
      });
      vscode.postMessage({ type: 'ready' });
    `,
  });
}
