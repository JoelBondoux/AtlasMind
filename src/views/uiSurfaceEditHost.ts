import * as vscode from 'vscode';
import * as nodeFs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { interceptDryRun } from '../core/dryRunHost.js';
import type { DryRunHostEffect } from '../core/dryRun.js';
import {
  findHtmlSourceElement,
  htmlSourceFingerprint,
  parseHtmlSource,
  type HtmlSourceDocument,
} from '../core/htmlSourceMap.js';
import {
  applyHtmlEditPlan,
  describeHtmlEditConfirmation,
  describeHtmlElement,
  findHtmlInsertionPoint,
  HTML_ATTRIBUTE_RULES,
  htmlAttributeRuleFor,
  htmlElementActions,
  htmlElementText,
  htmlInsertPaletteEntry,
  planHtmlElementEdit,
  validateHtmlAttributeEdit,
  validateHtmlEditText,
  type HtmlEditPlan,
  type HtmlElementActionId,
  type ReadyHtmlEditPlan,
} from '../core/uiSurfaceElementEdit.js';
import {
  buildEditableSurfaceDocument,
  describeUiSurfaceEditRender,
  isUiSurfaceEditMessage,
} from '../core/uiSurfaceEditDocument.js';
import { describeUiSurfaceRender, STATIC_SURFACE_MAX_BYTES } from '../core/uiSurfaceRender.js';
import type { StaticSurfaceTarget, UiSurfaceRenderUpdate } from './uiSurfaceRenderHost.js';

/**
 * Selecting and editing elements in a project's real static page.
 *
 * The page renders in a companion panel of its own — the plain render stays
 * scripts-off — built by `buildEditableSurfaceDocument`: the file's markup with
 * its scripts removed, every mapped element labelled with its source id, and
 * AtlasMind's selection script the only one the policy runs. The page posts an
 * element id or an insertion point id; everything after that happens here, in
 * VS Code's own pickers, against a fresh read of the file:
 *
 * - **The id is looked up in a parse of the file as it is now.** If the file
 *   changed since the render, nothing is offered: the render is refreshed and
 *   the person selects again.
 * - **The edit is planned by `uiSurfaceElementEdit`** — a declared vocabulary,
 *   an attribute allowlist, the containment table — and a refusal is shown with
 *   the rule that made it.
 * - **It is confirmed with the lines before and after**, checked against the dry
 *   run, and written only if the file is still byte-for-byte the one it was
 *   planned against (`applyHtmlEditPlan`). An editor holding unsaved changes to
 *   the file, or a file that is not valid UTF-8, is refused: writing either
 *   back would change bytes nobody edited.
 */

export interface HtmlEditApplyDeps {
  /** The file as it is now, or undefined when it cannot be read faithfully. */
  read(): string | undefined;
  /** Shows the confirmation; resolves true only on an explicit yes. */
  confirm(title: string, detail: string): Promise<boolean>;
  /** The dry-run guard. A returned record means the write must not happen. */
  intercept(effect: DryRunHostEffect): unknown;
  write(text: string): void;
}

export type HtmlEditApplyOutcome =
  | { status: 'written'; text: string }
  | { status: 'declined' }
  | { status: 'dry-run' }
  | { status: 'diverged'; reason: string }
  | { status: 'unreadable' };

/**
 * Check, confirm, check the dry run, check again, and only then write.
 *
 * The order is the policy. The first check means nobody is asked about an edit
 * to a file that has already moved on; the second, after the dialog, means a
 * change made while it was open is never overwritten.
 */
export async function confirmAndApplyHtmlEdit(
  relativePath: string,
  plan: ReadyHtmlEditPlan,
  deps: HtmlEditApplyDeps,
): Promise<HtmlEditApplyOutcome> {
  const before = deps.read();
  if (before === undefined) {
    return { status: 'unreadable' };
  }
  const early = applyHtmlEditPlan(before, plan, htmlSourceFingerprint);
  if (early.status === 'diverged') {
    return early;
  }
  const { title, detail } = describeHtmlEditConfirmation(relativePath, plan, before);
  if (!await deps.confirm(title, detail)) {
    return { status: 'declined' };
  }
  if (deps.intercept({
    surface: 'ui-studio-element-edit',
    kind: 'source-edit',
    summary: `${plan.summary} in ${relativePath} (line ${plan.line})`,
    details: { path: relativePath, start: plan.patch.start, end: plan.patch.end },
    wouldHaveAsked: true,
  })) {
    return { status: 'dry-run' };
  }
  const now = deps.read();
  if (now === undefined) {
    return { status: 'unreadable' };
  }
  const applied = applyHtmlEditPlan(now, plan, htmlSourceFingerprint);
  if (applied.status === 'diverged') {
    return applied;
  }
  deps.write(applied.text);
  return { status: 'written', text: applied.text };
}

const REFRESH_DEBOUNCE_MS = 250;

interface EditSnapshot {
  target: StaticSurfaceTarget;
  real: string;
  doc: HtmlSourceDocument;
}

type FileRead = { status: 'ok'; text: string; real: string; modifiedAt: string } | { status: 'refused'; statement: string };

export class UiSurfaceEditHost {
  private panel: vscode.WebviewPanel | undefined;
  private target: StaticSurfaceTarget | undefined;
  private snapshot: EditSnapshot | undefined;
  private watcher: vscode.FileSystemWatcher | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  /** One edit conversation at a time; a click during one is answered with a status. */
  private busy = false;

  constructor(
    private readonly workspaceRoot: string,
    private readonly report: (update: UiSurfaceRenderUpdate) => void,
  ) {}

  open(target: StaticSurfaceTarget): void {
    this.target = target;
    this.render();
  }

  // ── Rendering ───────────────────────────────────────────────────

  /** Read the surface's file through realpath, bounded, and only if it round-trips as UTF-8. */
  private readFile(target: StaticSurfaceTarget): FileRead {
    let root: string;
    try {
      root = nodeFs.realpathSync(this.workspaceRoot);
    } catch {
      root = path.resolve(this.workspaceRoot);
    }
    let real: string;
    try {
      real = nodeFs.realpathSync(path.resolve(root, ...target.path.split('/')));
    } catch {
      return { status: 'refused', statement: describeUiSurfaceRender({ kind: 'missing', path: target.path }) };
    }
    const relative = path.relative(root, real);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      return { status: 'refused', statement: describeUiSurfaceRender({ kind: 'not-renderable', path: target.path, reason: 'it resolves outside the workspace.' }) };
    }
    try {
      const stat = nodeFs.statSync(real);
      if (stat.size > STATIC_SURFACE_MAX_BYTES) {
        return { status: 'refused', statement: describeUiSurfaceRender({ kind: 'not-renderable', path: target.path, reason: `it is over the ${STATIC_SURFACE_MAX_BYTES / 1024 / 1024} MB an edit render will read.` }) };
      }
      const bytes = nodeFs.readFileSync(real);
      const text = bytes.toString('utf8');
      if (!Buffer.from(text, 'utf8').equals(bytes)) {
        return { status: 'refused', statement: `${target.path} is not valid UTF-8, so it is not edited here: writing it back would change bytes nobody edited. Edit it in the editor.` };
      }
      return { status: 'ok', text, real, modifiedAt: stat.mtime.toISOString() };
    } catch {
      return { status: 'refused', statement: describeUiSurfaceRender({ kind: 'missing', path: target.path }) };
    }
  }

  private render(): void {
    const target = this.target;
    if (!target) {
      return;
    }
    const read = this.readFile(target);
    if (read.status === 'refused') {
      this.snapshot = undefined;
      if (this.panel) {
        this.panel.webview.options = { enableScripts: false, enableForms: false, localResourceRoots: [] };
        this.panel.webview.html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'"><p>${escapeText(read.statement)}</p>`;
      }
      this.report({ surfaceId: target.surfaceId, mode: 'not-renderable', statement: read.statement });
      return;
    }
    const doc = parseHtmlSource(read.text);
    this.snapshot = { target, real: read.real, doc };
    const folder = vscode.Uri.file(path.dirname(read.real));
    const panel = this.ensurePanel(target, folder);
    const editable = buildEditableSurfaceDocument({
      doc,
      baseHref: panel.webview.asWebviewUri(folder).toString(),
      cspSource: panel.webview.cspSource,
      nonce: randomBytes(16).toString('hex'),
    });
    panel.webview.html = editable.html;
    this.watch(folder);
    this.report({
      surfaceId: target.surfaceId,
      mode: 'static-file',
      statement: describeUiSurfaceEditRender({ path: target.path, modifiedAt: read.modifiedAt, document: editable }),
    });
  }

  private ensurePanel(target: StaticSurfaceTarget, folder: vscode.Uri): vscode.WebviewPanel {
    // Scripts on for one script: the policy admits only the nonce on AtlasMind's
    // selection script, and the page's own scripts are not in the document.
    const options: vscode.WebviewOptions = { enableScripts: true, enableForms: false, localResourceRoots: [folder] };
    const title = `${target.label} — edit elements`;
    if (this.panel) {
      this.panel.webview.options = options;
      this.panel.title = title;
      this.panel.reveal(vscode.ViewColumn.Beside, true);
      return this.panel;
    }
    const panel = vscode.window.createWebviewPanel(
      'atlasmind.uiSurfaceEdit',
      title,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      options,
    );
    panel.webview.onDidReceiveMessage(message => { void this.onMessage(message); });
    panel.onDidDispose(() => {
      this.panel = undefined;
      this.snapshot = undefined;
      this.target = undefined;
      this.disposeWatcher();
    });
    this.panel = panel;
    return panel;
  }

  private watch(folder: vscode.Uri): void {
    this.disposeWatcher();
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '**/*'));
    const refresh = () => {
      if (this.refreshTimer) {
        clearTimeout(this.refreshTimer);
      }
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = undefined;
        // Never under an open dialog: the dialog's plan is checked against the
        // file again before anything is written, so a refresh there gains nothing.
        if (this.panel && !this.busy) {
          this.render();
        }
      }, REFRESH_DEBOUNCE_MS);
    };
    watcher.onDidChange(refresh);
    watcher.onDidCreate(refresh);
    watcher.onDidDelete(refresh);
    this.watcher = watcher;
  }

  private disposeWatcher(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.watcher?.dispose();
    this.watcher = undefined;
  }

  private status(text: string): void {
    void this.panel?.webview.postMessage({ type: 'atlasStatus', text });
  }

  // ── Messages ────────────────────────────────────────────────────

  private async onMessage(input: unknown): Promise<void> {
    if (!isUiSurfaceEditMessage(input) || input.type === 'ready') {
      return;
    }
    if (this.busy) {
      this.status('Finish the edit VS Code is asking about first.');
      return;
    }
    this.busy = true;
    try {
      if (input.type === 'selectElement') {
        await this.onSelect(input.payload.elementId);
      } else if (input.type === 'insertAt') {
        await this.onInsert(input.payload.pointId);
      } else {
        await this.onList();
      }
    } catch (error) {
      void vscode.window.showErrorMessage(`UI Studio could not edit that element: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.busy = false;
    }
  }

  /**
   * The parse to act on: the render's, if the file has not changed since.
   * If it has, the render is refreshed and nothing is offered — an id from the
   * old parse names a place in a file that is no longer there.
   */
  private currentDoc(): EditSnapshot | undefined {
    const snapshot = this.snapshot;
    if (!snapshot) {
      return undefined;
    }
    const read = this.readFile(snapshot.target);
    if (read.status === 'refused' || htmlSourceFingerprint(read.text) !== snapshot.doc.fingerprint) {
      void vscode.window.showWarningMessage(`${snapshot.target.path} changed since it was shown here. The render has been refreshed; select the element again.`);
      this.render();
      return undefined;
    }
    return snapshot;
  }

  private async onList(): Promise<void> {
    const snapshot = this.currentDoc();
    if (!snapshot) {
      return;
    }
    const { doc } = snapshot;
    if (doc.truncated) {
      void vscode.window.showWarningMessage(`${snapshot.target.path} is too large or too deeply nested to map completely, so nothing in it is offered for editing.`);
      return;
    }
    const items = doc.elements
      .map((element, index) => ({ element, index }))
      .filter(({ element }) => !element.foreign && !['script', 'style', 'head', 'meta', 'link', 'title', 'base'].includes(element.tagName))
      .map(({ element, index }) => ({ label: describeHtmlElement(doc, index), id: element.id, depth: element.path.length }))
      .map(item => ({ ...item, label: `${'  '.repeat(Math.min(item.depth - 1, 12))}${item.label}` }));
    const picked = await vscode.window.showQuickPick(items, { title: `Elements in ${snapshot.target.path}`, matchOnDescription: true, placeHolder: 'Pick an element to edit' });
    if (picked) {
      void this.panel?.webview.postMessage({ type: 'atlasSelect', elementId: picked.id });
      await this.onSelect(picked.id);
    }
  }

  private async onSelect(elementId: string): Promise<void> {
    const snapshot = this.currentDoc();
    if (!snapshot) {
      return;
    }
    const { doc } = snapshot;
    const index = findHtmlSourceElement(doc, elementId);
    if (index === -1) {
      void vscode.window.showWarningMessage('That element is not in the file as it is now. Select it again. (id-current)');
      return;
    }
    const element = doc.elements[index]!;
    const actions = htmlElementActions(doc, index);
    type Item = vscode.QuickPickItem & { action?: HtmlElementActionId; open?: true; reason?: string };
    const items: Item[] = [
      ...actions.filter(action => action.available).map(action => ({ label: action.label, action: action.id })),
      { label: `Open in the editor at line ${element.line}`, open: true as const },
      { label: 'Not available here', kind: vscode.QuickPickItemKind.Separator },
      ...actions.filter(action => !action.available).map(action => ({ label: `$(circle-slash) ${action.label.replace(/…$/, '')}`, detail: action.reason, reason: action.reason ?? '' })),
    ];
    const picked = await vscode.window.showQuickPick(items, { title: describeHtmlElement(doc, index), placeHolder: `What should change in ${snapshot.target.path}?`, matchOnDetail: true });
    if (!picked) {
      return;
    }
    if (picked.open) {
      await this.openInEditor(snapshot, element.start, element.startTagEnd);
      return;
    }
    if (picked.reason !== undefined) {
      void vscode.window.showInformationMessage(picked.reason);
      return;
    }
    switch (picked.action) {
      case 'set-text': {
        const current = htmlElementText(doc, index);
        const text = await vscode.window.showInputBox({
          title: `Text of <${element.tagName}> at line ${element.line}`,
          value: current.status === 'ok' ? current.text : '',
          prompt: 'Written as plain text: <, > and & are escaped.',
          validateInput: value => validateHtmlEditText(value),
        });
        if (text !== undefined) {
          await this.apply(snapshot, planHtmlElementEdit(doc, { kind: 'set-text', elementId, text }));
        }
        return;
      }
      case 'set-attribute': {
        const name = await this.pickAttributeName(doc, index);
        if (!name) {
          return;
        }
        const existing = element.attributes.find(attribute => attribute.name === name);
        const value = await vscode.window.showInputBox({
          title: `${name} on <${element.tagName}> at line ${element.line}`,
          value: existing?.value ? doc.text.slice(existing.value.start, existing.value.end) : '',
          prompt: htmlAttributeRuleFor(element.tagName, name)?.description,
          validateInput: candidate => validateHtmlAttributeEdit(element.tagName, name, candidate),
        });
        if (value !== undefined) {
          await this.apply(snapshot, planHtmlElementEdit(doc, { kind: 'set-attribute', elementId, name, value }));
        }
        return;
      }
      case 'remove-attribute': {
        const names = element.attributes.map(attribute => attribute.name).filter(name => htmlAttributeRuleFor(element.tagName, name));
        const name = await vscode.window.showQuickPick(names, { title: `Remove an attribute from <${element.tagName}> at line ${element.line}` });
        if (name) {
          await this.apply(snapshot, planHtmlElementEdit(doc, { kind: 'remove-attribute', elementId, name }));
        }
        return;
      }
      case 'insert-before':
      case 'insert-in':
      case 'insert-after':
        await this.insertAt(snapshot, `${elementId}:${picked.action.slice('insert-'.length)}`);
        return;
      case 'move-up':
      case 'move-down':
        await this.apply(snapshot, planHtmlElementEdit(doc, { kind: 'move', elementId, direction: picked.action === 'move-up' ? 'up' : 'down' }));
        return;
      case 'remove':
        await this.apply(snapshot, planHtmlElementEdit(doc, { kind: 'remove', elementId }));
        return;
      default:
        return;
    }
  }

  /** Attributes the allowlist covers on this element, existing first, plus any aria-* by name. */
  private async pickAttributeName(doc: HtmlSourceDocument, index: number): Promise<string | undefined> {
    const element = doc.elements[index]!;
    const existing = element.attributes.map(attribute => attribute.name).filter(name => htmlAttributeRuleFor(element.tagName, name));
    const offered = HTML_ATTRIBUTE_RULES
      .filter(rule => rule.elements.length === 0 || rule.elements.includes(element.tagName))
      .flatMap(rule => (Array.isArray(rule.names) ? rule.names as readonly string[] : ['aria-label']));
    const names = [...new Set([...existing, ...offered])];
    const other = 'Another aria-* attribute…';
    const picked = await vscode.window.showQuickPick([...names, other], { title: `Set an attribute on <${element.tagName}> at line ${element.line}` });
    if (picked !== other) {
      return picked;
    }
    const name = await vscode.window.showInputBox({
      title: 'aria-* attribute name',
      prompt: 'For example aria-describedby.',
      validateInput: value => (/^aria-[a-z]{2,32}$/.test(value) ? undefined : 'An aria-* name in lower case, such as aria-describedby.'),
    });
    return name || undefined;
  }

  private async onInsert(pointId: string): Promise<void> {
    const snapshot = this.currentDoc();
    if (snapshot) {
      await this.insertAt(snapshot, pointId);
    }
  }

  private async insertAt(snapshot: EditSnapshot, pointId: string): Promise<void> {
    const { doc } = snapshot;
    const point = findHtmlInsertionPoint(doc, pointId);
    if (!point) {
      await this.apply(snapshot, planHtmlElementEdit(doc, { kind: 'insert', pointId, entryId: 'custom', text: '' }));
      return;
    }
    const element = doc.elements[point.elementIndex]!;
    const where = point.position === 'in' ? `at the end of <${element.tagName}>` : `${point.position} <${element.tagName}>`;
    const entries = point.entries.map(id => htmlInsertPaletteEntry(id)!).map(entry => ({ label: entry.label, description: `${entry.open}…${entry.close}`, entry }));
    const picked = await vscode.window.showQuickPick(entries, { title: `Insert ${where} at line ${element.line}`, placeHolder: 'Only what this point accepts is listed.' });
    if (!picked) {
      return;
    }
    const text = await vscode.window.showInputBox({
      title: picked.entry.label,
      prompt: `${picked.entry.textPrompt}. Written as plain text.`,
      value: picked.entry.defaultText,
      validateInput: value => validateHtmlEditText(value),
    });
    if (text !== undefined) {
      await this.apply(snapshot, planHtmlElementEdit(doc, { kind: 'insert', pointId, entryId: picked.entry.id, text }));
    }
  }

  // ── Writing ─────────────────────────────────────────────────────

  private async apply(snapshot: EditSnapshot, plan: HtmlEditPlan): Promise<void> {
    if (plan.status === 'refused') {
      void vscode.window.showWarningMessage(`${plan.reason} (${plan.rule})`);
      return;
    }
    const dirty = vscode.workspace.textDocuments.find(document => document.isDirty && samePath(document.uri.fsPath, snapshot.real));
    if (dirty) {
      void vscode.window.showWarningMessage(`${snapshot.target.path} has unsaved changes in the editor. Save or revert them first; UI Studio edits the file on disk and will not guess how the two should combine.`);
      return;
    }
    const outcome = await confirmAndApplyHtmlEdit(snapshot.target.path, plan, {
      read: () => {
        const read = this.readFile(snapshot.target);
        return read.status === 'ok' && samePath(read.real, snapshot.real) ? read.text : undefined;
      },
      confirm: async (title, detail) => (await vscode.window.showWarningMessage(title, { modal: true, detail }, 'Apply edit')) === 'Apply edit',
      intercept: effect => interceptDryRun(effect),
      write: text => nodeFs.writeFileSync(snapshot.real, text, 'utf8'),
    });
    switch (outcome.status) {
      case 'written':
        this.render();
        this.status(`Edited line ${plan.line}: ${plan.summary}.`);
        return;
      case 'diverged':
        void vscode.window.showWarningMessage(outcome.reason);
        this.render();
        return;
      case 'unreadable':
        void vscode.window.showWarningMessage(`${snapshot.target.path} could not be read faithfully, so nothing was written.`);
        this.render();
        return;
      default:
        return;
    }
  }

  private async openInEditor(snapshot: EditSnapshot, start: number, end: number): Promise<void> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(snapshot.real));
    // The editor's text drops a byte-order mark the parse kept.
    const shift = snapshot.doc.text.startsWith('﻿') ? 1 : 0;
    start = Math.max(0, start - shift);
    end = Math.max(0, end - shift);
    const selection = new vscode.Selection(document.positionAt(start), document.positionAt(end));
    await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, selection, preview: false });
  }

  dispose(): void {
    this.disposeWatcher();
    this.panel?.dispose();
    this.panel = undefined;
    this.snapshot = undefined;
  }
}

function samePath(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
