import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import {
  buildLensDeclarationDraftPrompt,
  mergeLensDeclarationDraft,
  renderLensDraftSummary,
  reviewLensDeclarationDraft,
  type LensDeclarationDraftReview,
  type LensDraftMergeResult,
} from '../core/lensDeclarationDraft.js';
import {
  buildLensDeclarationPlan,
  LENS_DECLARATION_EXAMPLES,
} from '../core/lensDeclarationPlan.js';
import {
  buildLensDeclarationStarter,
  findLensDeclarationDescriptor,
  inspectLensDeclarations,
  isLensDeclarationKind,
  lensDeclarationDescriptors,
  lensDeclarationStatusLabel,
  type LensDeclarationKind,
  type LensDeclarationStatus,
} from '../core/lensDeclarations.js';
import type { AtlasMindContext } from '../extension.js';
import { LENS_PANEL_CSS } from './lensVisuals.js';
import { getWebviewHtmlShell } from './webviewUtils.js';

type GuideMessage =
  | { type: 'ready' }
  | { type: 'selectKind'; kind: LensDeclarationKind }
  | { type: 'createStarter' }
  | { type: 'openFile' }
  | { type: 'askAtlas' }
  | { type: 'acceptDraft' }
  | { type: 'discardDraft' };

interface GuideDraftState {
  kind: LensDeclarationKind;
  review: LensDeclarationDraftReview;
  merge: LensDraftMergeResult;
}

/**
 * The Lens declaration guide — the answer to "I have no idea what to put in these".
 *
 * The Lenses dashboard could say `.atlasmind/lens-state.json` was missing and
 * could create one. What it created was a valid empty file, and the next
 * instruction was to fill it in with schema autocomplete — which is only
 * actionable if you already know both what the format means and what your own
 * project's state machines are. This panel is the missing middle: what the file
 * is for, a worked example small enough to read, and a model that will go and
 * look at the repository if you ask it to.
 *
 * Three rules govern the host side, and all three exist because this panel is
 * the one Lens surface that *writes* to a tracked repository file.
 *
 * **The webview names a declaration kind and never a path.** Every message
 * carries one of four known kinds; the host resolves it against the declaration
 * table and derives the path itself. A webview cannot name a file to create, to
 * read, or to overwrite — which is the difference between a panel with four
 * buttons and an arbitrary file writer.
 *
 * **The draft never round-trips through the webview.** An accepted proposal is
 * held here, in host memory, between review and write. Posting the JSON out and
 * taking it back on accept would mean the thing written to disk is whatever came
 * back, and every check in `lensDeclarationDraft.ts` would be advisory.
 *
 * **The starter is create-only and the draft is confirm-only.** A starter uses
 * the `wx` flag so it can never truncate a file that appeared in between; a
 * draft write is gated on a modal that names the file and the exact counts, and
 * merges rather than replaces — existing entries win every collision.
 */
export class LensDeclarationGuidePanel {
  private static currentPanel: LensDeclarationGuidePanel | undefined;
  private static readonly viewType = 'atlasmind.lensDeclarationGuide';

  private readonly disposables: vscode.Disposable[] = [];
  private ready = false;
  private busy = false;
  private draft: GuideDraftState | undefined;

  public static async createOrShow(kind: LensDeclarationKind, atlas: AtlasMindContext): Promise<void> {
    if (LensDeclarationGuidePanel.currentPanel) {
      LensDeclarationGuidePanel.currentPanel.panel.reveal(vscode.ViewColumn.Active);
      await LensDeclarationGuidePanel.currentPanel.selectKind(kind);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      LensDeclarationGuidePanel.viewType,
      'Lens — Declaration guide',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    LensDeclarationGuidePanel.currentPanel = new LensDeclarationGuidePanel(panel, kind, atlas);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private kind: LensDeclarationKind,
    private readonly atlas: AtlasMindContext,
  ) {
    this.panel.webview.html = buildGuideHtml(this.panel.webview.cspSource);
    this.panel.webview.onDidReceiveMessage(
      (raw: unknown) => {
        const message = normalizeGuideMessage(raw);
        if (message) {
          void this.handleMessage(message);
        }
      },
      null,
      this.disposables,
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private async handleMessage(message: GuideMessage): Promise<void> {
    if (message.type === 'ready') {
      this.ready = true;
      await this.render();
      return;
    }
    if (message.type === 'selectKind') {
      await this.selectKind(message.kind);
      return;
    }
    if (message.type === 'discardDraft') {
      this.draft = undefined;
      await this.render();
      return;
    }
    // Everything below touches the filesystem or spends money, and none of it
    // should be re-entrant from a double click.
    if (this.busy) {
      return;
    }
    if (message.type === 'createStarter') {
      await this.createStarter();
      return;
    }
    if (message.type === 'openFile') {
      await this.openFile();
      return;
    }
    if (message.type === 'askAtlas') {
      await this.askAtlas();
      return;
    }
    await this.acceptDraft();
  }

  private async selectKind(kind: LensDeclarationKind): Promise<void> {
    if (kind !== this.kind) {
      // A draft belongs to the file it was drafted for. Carrying it across would
      // offer a state-machine proposal for the configuration file.
      this.draft = undefined;
      this.kind = kind;
    }
    await this.render();
  }

  private async createStarter(): Promise<void> {
    const folder = requireDiskFolder();
    if (!folder) {
      return;
    }
    const descriptor = findLensDeclarationDescriptor(this.kind);
    const target = path.join(folder.uri.fsPath, ...descriptor.workspacePath.split('/'));
    try {
      await mkdir(path.dirname(target), { recursive: true });
      // `wx` is the create-only guarantee: an existing file is never truncated,
      // including one that appeared between the status read and this write.
      await writeFile(target, buildLensDeclarationStarter(this.kind), { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if (!isAlreadyExists(error)) {
        void vscode.window.showErrorMessage(
          `AtlasMind could not create ${descriptor.workspacePath}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
    }
    await this.openFile();
    await this.render();
  }

  private async openFile(): Promise<void> {
    const folder = requireDiskFolder();
    if (!folder) {
      return;
    }
    const descriptor = findLensDeclarationDescriptor(this.kind);
    const uri = vscode.Uri.joinPath(folder.uri, ...descriptor.workspacePath.split('/'));
    try {
      await vscode.window.showTextDocument(uri, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    } catch {
      void vscode.window.showWarningMessage(
        `AtlasMind could not open ${descriptor.workspacePath}. Create it first, or check the file permissions.`,
      );
    }
  }

  /**
   * Ask a model to propose a draft, then put it through every check before it is
   * shown — let alone written.
   *
   * The reply is treated exactly like any other untrusted model output: parsed
   * defensively, scrubbed of unverifiable anchors and credential-shaped values,
   * and refused whole if it does not pass the same normalizer the lens reads the
   * file with. What reaches the screen is a proposal plus the list of everything
   * AtlasMind had to correct, because a draft that needed three corrections is a
   * draft whose remaining entries deserve a closer read.
   */
  private async askAtlas(): Promise<void> {
    const folder = requireDiskFolder();
    if (!folder) {
      return;
    }
    const descriptor = findLensDeclarationDescriptor(this.kind);
    this.busy = true;
    this.draft = undefined;
    await this.render();

    try {
      let streamed = '';
      // The user's own budget and speed settings, not a pinned pair. Drafting a
      // declaration is ordinary work and has no reason to opt out of routing.
      const configuration = vscode.workspace.getConfiguration('atlasmind');
      const result = await this.atlas.orchestrator.processTask(
        {
          id: `lens-draft-${this.kind}-${Date.now()}`,
          userMessage: buildLensDeclarationDraftPrompt(this.kind),
          context: {},
          constraints: {
            budget: toBudgetMode(configuration.get<string>('budgetMode')),
            speed: toSpeedMode(configuration.get<string>('speedMode')),
          },
          timestamp: new Date().toISOString(),
        },
        (chunk: string) => { streamed += chunk ?? ''; },
        (progress: string) => { void this.post({ type: 'status', text: progress }); },
      );

      const replyText = streamed.trim() || (result.response ?? '');
      const root = folder.uri.fsPath;
      const review = reviewLensDeclarationDraft(this.kind, replyText, {
        anchorExists: workspacePath => fileExists(root, workspacePath),
      });

      if (review.outcome === 'refused' || !review.document) {
        this.draft = { kind: this.kind, review, merge: { document: {}, added: 0, skipped: 0, kept: 0 } };
      } else {
        const existing = await readJsonIfPresent(path.join(root, ...descriptor.workspacePath.split('/')));
        this.draft = {
          kind: this.kind,
          review,
          merge: mergeLensDeclarationDraft(this.kind, existing, review.document),
        };
      }
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Atlas could not draft ${descriptor.workspacePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.busy = false;
      await this.render();
    }
  }

  /**
   * Write an accepted draft.
   *
   * Re-merged against what is on disk *now* rather than against what was read
   * when the draft came back — the user may well have been editing the file in
   * the editor this panel opened for them, and writing a merge computed minutes
   * ago would silently discard that.
   */
  private async acceptDraft(): Promise<void> {
    const draft = this.draft;
    const folder = requireDiskFolder();
    if (!draft || !folder || draft.review.outcome !== 'accepted' || !draft.review.document || draft.kind !== this.kind) {
      return;
    }
    const descriptor = findLensDeclarationDescriptor(this.kind);
    const target = path.join(folder.uri.fsPath, ...descriptor.workspacePath.split('/'));
    const existing = await readJsonIfPresent(target);
    const merge = mergeLensDeclarationDraft(this.kind, existing, draft.review.document);

    const confirmation = await vscode.window.showWarningMessage(
      `Write ${merge.added} drafted ${merge.added === 1 ? 'entry' : 'entries'} into ${descriptor.workspacePath}?`,
      {
        modal: true,
        detail: [
          merge.kept > 0
            ? `${merge.kept} existing ${merge.kept === 1 ? 'entry stays' : 'entries stay'} exactly as ${merge.kept === 1 ? 'it is' : 'they are'}.`
            : 'The file has no entries of its own yet.',
          merge.skipped > 0
            ? `${merge.skipped} drafted ${merge.skipped === 1 ? 'entry was' : 'entries were'} dropped because you already declare that id.`
            : '',
          'This is a model\'s proposal derived from your repository, not a verified description of it. It will be committed with the rest of your changes.',
        ].filter(Boolean).join('\n\n'),
      },
      'Write the file',
    );
    if (confirmation !== 'Write the file') {
      return;
    }

    this.busy = true;
    await this.render();
    try {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, `${JSON.stringify(merge.document, null, 2)}\n`, 'utf8');
      this.draft = undefined;
      void vscode.window.showInformationMessage(
        `Wrote ${merge.added} ${merge.added === 1 ? 'entry' : 'entries'} to ${descriptor.workspacePath}. Read it before committing.`,
      );
      await this.openFile();
    } catch (error) {
      void vscode.window.showErrorMessage(
        `AtlasMind could not write ${descriptor.workspacePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.busy = false;
      await this.render();
    }
  }

  private async render(): Promise<void> {
    if (!this.ready) {
      return;
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    const diskBacked = folder?.uri.scheme === 'file' || folder?.uri.scheme === 'vscode-remote';
    const snapshot = folder && diskBacked ? inspectLensDeclarations(folder.uri.fsPath) : undefined;
    const steps = buildLensDeclarationPlan({
      ...(folder ? { workspaceName: folder.name } : {}),
      ...(snapshot ? { declarations: snapshot } : {}),
    });
    const file = snapshot?.files.find(candidate => candidate.kind === this.kind);
    const step = steps.find(candidate => candidate.id === this.kind);
    const descriptor = findLensDeclarationDescriptor(this.kind);

    await this.post({
      type: 'view',
      view: {
        kind: this.kind,
        busy: this.busy,
        title: descriptor.label,
        workspacePath: descriptor.workspacePath,
        purpose: descriptor.purpose,
        required: descriptor.required,
        statusLabel: file ? lensDeclarationStatusLabel(file.status) : 'No workspace',
        status: file?.status ?? 'unavailable',
        detail: step?.detail ?? descriptor.purpose,
        guidance: (step?.guidance ?? []).map(line => ({ text: line.text, ...(line.command ? { command: line.command } : {}) })),
        example: LENS_DECLARATION_EXAMPLES[this.kind].json,
        tabs: lensDeclarationDescriptors().map(entry => ({
          kind: entry.kind,
          label: entry.label,
          required: entry.required,
          status: snapshot?.files.find(candidate => candidate.kind === entry.kind)?.status ?? 'unavailable',
        })),
        ...(this.draft && this.draft.kind === this.kind ? {
          draft: {
            accepted: this.draft.review.outcome === 'accepted',
            summary: renderLensDraftSummary(
              this.draft.review,
              this.draft.review.outcome === 'accepted' ? this.draft.merge : undefined,
            ),
            json: this.draft.review.outcome === 'accepted'
              ? JSON.stringify(this.draft.merge.document, null, 2)
              : '',
          },
        } : {}),
      } satisfies GuideView,
    });
  }

  private async post(message: unknown): Promise<void> {
    if (this.ready) {
      await this.panel.webview.postMessage(message);
    }
  }

  private dispose(): void {
    LensDeclarationGuidePanel.currentPanel = undefined;
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }
}

interface GuideView {
  kind: LensDeclarationKind;
  busy: boolean;
  title: string;
  workspacePath: string;
  purpose: string;
  required: boolean;
  statusLabel: string;
  status: LensDeclarationStatus['status'];
  detail: string;
  guidance: Array<{ text: string; command?: string }>;
  example: string;
  tabs: Array<{ kind: LensDeclarationKind; label: string; required: boolean; status: LensDeclarationStatus['status'] }>;
  draft?: { accepted: boolean; summary: string; json: string };
}

/** Register the guide. Named `open…` so it is admissible as a setup-plan action. */
export function registerLensDeclarationGuide(
  context: vscode.ExtensionContext,
  atlas: AtlasMindContext,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('atlasmind.lens.openDeclarationGuide', (kind?: unknown) =>
      LensDeclarationGuidePanel.createOrShow(isLensDeclarationKind(kind) ? kind : 'state', atlas)),
  );
}

function requireDiskFolder(): vscode.WorkspaceFolder | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showInformationMessage('Open a repository before writing AtlasMind Lens declarations.');
    return undefined;
  }
  if (folder.uri.scheme !== 'file' && folder.uri.scheme !== 'vscode-remote') {
    void vscode.window.showWarningMessage(
      `AtlasMind cannot safely write declarations in the "${folder.uri.scheme}" filesystem. Open the repository from disk instead.`,
    );
    return undefined;
  }
  return folder;
}

/**
 * Whether a drafted anchor resolves to a real file.
 *
 * `statSync` rather than `existsSync` so a directory does not satisfy a claim
 * about a source file. The path has already been checked for traversal by the
 * draft reviewer; joining is safe here because that check ran first.
 */
function fileExists(root: string, workspacePath: string): boolean {
  try {
    return statSync(path.join(root, ...workspacePath.split('/'))).isFile();
  } catch {
    return false;
  }
}

async function readJsonIfPresent(target: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(target, 'utf8')) as unknown;
  } catch {
    // Absent or unparseable both mean "nothing here to preserve". An
    // unparseable file is not silently replaced: the merge writes a valid
    // document, and the modal already said how many entries it would carry.
    return undefined;
  }
}

function toBudgetMode(value: string | undefined): 'cheap' | 'balanced' | 'expensive' | 'auto' {
  return value === 'cheap' || value === 'balanced' || value === 'expensive' || value === 'auto' ? value : 'balanced';
}

function toSpeedMode(value: string | undefined): 'fast' | 'balanced' | 'considered' | 'auto' {
  return value === 'fast' || value === 'balanced' || value === 'considered' || value === 'auto' ? value : 'balanced';
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    ((error as { code?: unknown }).code === 'EEXIST' || (error as { code?: unknown }).code === 'FileExists');
}

function normalizeGuideMessage(value: unknown): GuideMessage | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record.type === 'selectKind') {
    return isLensDeclarationKind(record.kind) ? { type: 'selectKind', kind: record.kind } : undefined;
  }
  return record.type === 'ready' || record.type === 'createStarter' || record.type === 'openFile' ||
    record.type === 'askAtlas' || record.type === 'acceptDraft' || record.type === 'discardDraft'
    ? { type: record.type }
    : undefined;
}

function buildGuideHtml(cspSource: string): string {
  return getWebviewHtmlShell({
    cspSource,
    title: 'Lens — Declaration guide',
    extraCss: `${LENS_PANEL_CSS}
      .guide-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
      .guide-tab { padding: 6px 12px; border-radius: 6px; border: 1px solid var(--vscode-panel-border); background: transparent; color: var(--vscode-foreground); cursor: pointer; font-size: 12px; }
      .guide-tab[aria-pressed="true"] { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
      .guide-tab .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; background: var(--vscode-descriptionForeground); }
      .guide-tab .dot.ready { background: var(--vscode-testing-iconPassed, #3fb950); }
      .guide-section { margin: 18px 0; }
      .guide-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
      .guide-actions button { padding: 7px 14px; border-radius: 6px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); cursor: pointer; }
      .guide-actions button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
      .guide-actions button:disabled { opacity: .5; cursor: default; }
      pre.guide-code { overflow-x: auto; padding: 12px; border-radius: 6px; background: var(--vscode-textCodeBlock-background); border: 1px solid var(--vscode-panel-border); font-size: 12px; }
      .guide-draft { border: 1px solid var(--vscode-panel-border); border-left: 3px solid var(--vscode-button-background); border-radius: 6px; padding: 14px; margin-top: 18px; }
      .guide-draft.refused { border-left-color: var(--vscode-editorError-foreground, #f85149); }
      .guide-draft pre { white-space: pre-wrap; margin: 0 0 12px; font-family: inherit; font-size: 13px; }
      .guide-note { color: var(--vscode-descriptionForeground); font-size: 12px; }
      .guide-optional { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--vscode-descriptionForeground); }
    `,
    bodyContent: `
      <header class="lens-header">
        <h1 id="guideTitle">Lens declarations</h1>
        <p id="guideStatus" class="guide-note"></p>
      </header>
      <div class="guide-tabs" id="guideTabs" role="group" aria-label="Declaration files"></div>
      <p id="guideDetail"></p>
      <div class="guide-actions" id="guideActions"></div>
      <div class="guide-section" id="guideGuidance"></div>
      <div class="guide-section">
        <h2>The shape</h2>
        <pre class="guide-code" id="guideExample"></pre>
      </div>
      <div id="guideDraft"></div>
    `,
    scriptContent: GUIDE_SCRIPT,
  });
}

/**
 * The webview.
 *
 * Renders only, and posts only the six bounded message types above. It never
 * holds the drafted document — the host does — so "Write the file" is a request
 * to write the reviewed draft, not a submission of content to write.
 */
const GUIDE_SCRIPT = /* javascript */ `
  const vscode = acquireVsCodeApi();
  const el = id => document.getElementById(id);

  function button(label, action, primary) {
    const node = document.createElement('button');
    node.textContent = label;
    if (primary) { node.className = 'primary'; }
    node.addEventListener('click', () => vscode.postMessage({ type: action }));
    return node;
  }

  function render(view) {
    el('guideTitle').textContent = view.title;
    el('guideStatus').textContent = view.workspacePath + ' — ' + view.statusLabel +
      (view.required ? '' : ' · optional');
    el('guideDetail').textContent = view.detail;

    const tabs = el('guideTabs');
    tabs.replaceChildren();
    for (const tab of view.tabs) {
      const node = document.createElement('button');
      node.className = 'guide-tab';
      node.setAttribute('aria-pressed', String(tab.kind === view.kind));
      const dot = document.createElement('span');
      dot.className = 'dot' + (tab.status === 'ready' ? ' ready' : '');
      node.append(dot, document.createTextNode(tab.label + (tab.required ? '' : ' (optional)')));
      node.addEventListener('click', () => vscode.postMessage({ type: 'selectKind', kind: tab.kind }));
      tabs.append(node);
    }

    const actions = el('guideActions');
    actions.replaceChildren();
    if (view.status === 'missing') {
      actions.append(button('Create the starter file', 'createStarter', true));
    } else if (view.status !== 'unavailable') {
      actions.append(button('Open ' + view.workspacePath, 'openFile', false));
    }
    const ask = button(view.busy ? 'Atlas is reading the repository…' : 'Ask Atlas to draft it', 'askAtlas', view.status !== 'missing');
    ask.disabled = view.busy || view.status === 'unavailable';
    actions.append(ask);

    const guidance = el('guideGuidance');
    guidance.replaceChildren();
    if (view.guidance.length > 0) {
      const list = document.createElement('ul');
      for (const line of view.guidance) {
        if (line.command) { continue; }
        const item = document.createElement('li');
        item.textContent = line.text;
        list.append(item);
      }
      guidance.append(list);
    }

    el('guideExample').textContent = view.example;

    const draftHost = el('guideDraft');
    draftHost.replaceChildren();
    if (view.draft) {
      const box = document.createElement('div');
      box.className = 'guide-draft' + (view.draft.accepted ? '' : ' refused');
      const summary = document.createElement('pre');
      summary.textContent = view.draft.summary;
      box.append(summary);
      if (view.draft.accepted) {
        const code = document.createElement('pre');
        code.className = 'guide-code';
        code.textContent = view.draft.json;
        box.append(code);
        const row = document.createElement('div');
        row.className = 'guide-actions';
        const write = button('Write the file', 'acceptDraft', true);
        write.disabled = view.busy;
        row.append(write, button('Discard', 'discardDraft', false));
        box.append(row);
      } else {
        const row = document.createElement('div');
        row.className = 'guide-actions';
        row.append(button('Dismiss', 'discardDraft', false));
        box.append(row);
      }
      draftHost.append(box);
    }
  }

  window.addEventListener('message', event => {
    const message = event.data;
    if (message && message.type === 'view') { render(message.view); }
    if (message && message.type === 'status') { el('guideStatus').textContent = message.text; }
  });

  vscode.postMessage({ type: 'ready' });
`;
