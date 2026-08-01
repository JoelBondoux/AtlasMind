import * as vscode from 'vscode';

import {
  buildLensContextPatch,
  buildLensDraftPrompt,
  createSourceLensTarget,
  normalizeLensTarget,
} from '../core/lensTarget.js';
import type { LensSourceRange, LensVisualTarget, LensWorkspaceIdentity } from '../types.js';
import { revealPreferredChatSurface } from './chatPanel.js';

const LENS_VIEW_ID = 'atlasmind.lensView';

/** A source-backed file or symbol displayed in the first AtlasMind Lens view. */
export class LensTreeItem extends vscode.TreeItem {
  public children: LensTreeItem[] | undefined;

  constructor(
    public readonly target: LensVisualTarget,
    public readonly uri: vscode.Uri,
    public readonly navigationRange?: LensSourceRange,
    children?: LensTreeItem[],
  ) {
    super(
      target.label,
      target.kind === 'file' || (children && children.length > 0)
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    this.children = children;
    this.description = describeTarget(target);
    this.tooltip = new vscode.MarkdownString(buildTargetTooltip(target));
    this.iconPath = new vscode.ThemeIcon(target.kind === 'file' ? 'file-code' : symbolIcon(target.symbolKind));
    this.contextValue = target.kind === 'file' ? 'lens-file' : 'lens-target';
    this.command = {
      command: 'atlasmind.lens.openTarget',
      title: 'Open Lens Target',
      arguments: [this],
    };
  }
}

class LensMessageTreeItem extends vscode.TreeItem {
  constructor(label: string, description: string, icon = 'info') {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = 'lens-message';
  }
}

/**
 * Native, active-file outline for AtlasMind Lens.
 *
 * Structure and ranges come from the installed language service. No model call
 * occurs merely because the view is visible; chat is opened only when the
 * operator explicitly asks about a target.
 */
export class LensTreeProvider implements vscode.TreeDataProvider<LensTreeItem | LensMessageTreeItem>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<LensTreeItem | LensMessageTreeItem | undefined>();
  private readonly disposables: vscode.Disposable[];

  public readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor() {
    this.disposables = [
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
      vscode.workspace.onDidSaveTextDocument(document => {
        if (document.uri.toString() === vscode.window.activeTextEditor?.document.uri.toString()) {
          this.refresh();
        }
      }),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document.uri.toString() === vscode.window.activeTextEditor?.document.uri.toString()) {
          this.refresh();
        }
      }),
    ];
  }

  public refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  public dispose(): void {
    this.changeEmitter.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  public getTreeItem(element: LensTreeItem | LensMessageTreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: LensTreeItem | LensMessageTreeItem): Promise<Array<LensTreeItem | LensMessageTreeItem>> {
    if (element instanceof LensMessageTreeItem) {
      return [];
    }
    if (element?.target.kind === 'file') {
      if (!element.children) {
        element.children = await this.loadDocumentSymbols(
          element.uri,
          element.target.workspacePath,
          element.target.workspace,
        );
      }
      return element.children.length > 0
        ? element.children
        : [new LensMessageTreeItem('No outline available', 'The active language service returned no symbols.')];
    }
    if (element) {
      return element.children ?? [];
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return [new LensMessageTreeItem('Open a code file', 'Lens follows the active editor.', 'file-code')];
    }
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (!workspaceFolder) {
      return [new LensMessageTreeItem('Outside the workspace', 'Lens only sends workspace-relative targets to chat.', 'shield')];
    }

    const workspacePath = normalizeRelativePath(vscode.workspace.asRelativePath(editor.document.uri, false));
    if (!workspacePath) {
      return [new LensMessageTreeItem('Unavailable source path', 'Lens could not form a safe workspace-relative target.', 'warning')];
    }
    const fileName = workspacePath.split('/').at(-1) ?? workspacePath;
    const workspace = toLensWorkspaceIdentity(workspaceFolder);
    const target = createSourceLensTarget({ kind: 'file', label: fileName, workspace, workspacePath });
    return [new LensTreeItem(target, editor.document.uri)];
  }

  public async openTarget(candidate: unknown): Promise<void> {
    const item = candidate instanceof LensTreeItem ? candidate : undefined;
    const target = normalizeLensTarget(item?.target);
    if (!item || !target || !isMatchingWorkspaceUri(item.uri, target)) {
      void vscode.window.showWarningMessage('AtlasMind refused an invalid or out-of-workspace Lens target.');
      return;
    }

    await vscode.window.showTextDocument(item.uri, {
      preview: false,
      ...(item.navigationRange ? { selection: toSelection(item.navigationRange) } : {}),
    });
  }

  public async askAboutTarget(candidate: unknown): Promise<void> {
    const item = candidate instanceof LensTreeItem ? candidate : undefined;
    const target = normalizeLensTarget(item?.target);
    if (!item || !target || !isMatchingWorkspaceUri(item.uri, target)) {
      void vscode.window.showWarningMessage('AtlasMind refused an invalid or out-of-workspace Lens target.');
      return;
    }

    await revealPreferredChatSurface({
      draftPrompt: buildLensDraftPrompt(target),
      contextPatch: buildLensContextPatch(target),
    });
  }

  private async loadDocumentSymbols(
    uri: vscode.Uri,
    workspacePath: string,
    workspace: LensWorkspaceIdentity,
  ): Promise<LensTreeItem[]> {
    const raw = await vscode.commands.executeCommand<unknown[]>('vscode.executeDocumentSymbolProvider', uri) ?? [];
    return raw.flatMap(symbol => toLensTreeItem(symbol, uri, workspacePath, workspace));
  }
}

export function registerLensTreeView(context: vscode.ExtensionContext): void {
  const provider = new LensTreeProvider();
  context.subscriptions.push(
    provider,
    vscode.window.registerTreeDataProvider(LENS_VIEW_ID, provider),
    vscode.commands.registerCommand('atlasmind.lens.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('atlasmind.lens.openTarget', (item?: unknown) => provider.openTarget(item)),
    vscode.commands.registerCommand('atlasmind.lens.askTarget', (item?: unknown) => provider.askAboutTarget(item)),
  );
}

function toLensTreeItem(
  value: unknown,
  uri: vscode.Uri,
  workspacePath: string,
  workspace: LensWorkspaceIdentity,
): LensTreeItem[] {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.kind !== 'number') {
    return [];
  }
  const location = isRecord(value.location) ? value.location : undefined;
  if (location && !isSameSourceUri(location.uri, uri)) {
    return [];
  }
  const range = toSourceRange(value.range) ?? toSourceRange(location?.range);
  const navigationRange = toSourceRange(value.selectionRange) ?? range;
  if (!range || !navigationRange) {
    return [];
  }
  const symbolKind = vscode.SymbolKind[value.kind] ?? 'Unknown';
  const children = Array.isArray(value.children)
    ? value.children.flatMap(child => toLensTreeItem(child, uri, workspacePath, workspace))
    : [];
  const detail = typeof value.detail === 'string' && value.detail.trim()
    ? value.detail
    : typeof value.containerName === 'string' && value.containerName.trim()
      ? value.containerName
      : undefined;
  const target = createSourceLensTarget({
    kind: 'symbol',
    label: value.name,
    workspace,
    workspacePath,
    range,
    symbolKind,
    ...(detail ? { detail } : {}),
  });
  return [new LensTreeItem(target, uri, navigationRange, children)];
}

function toSourceRange(value: unknown): LensSourceRange | undefined {
  if (!isRecord(value) || !isPosition(value.start) || !isPosition(value.end)) {
    return undefined;
  }
  return {
    startLine: value.start.line + 1,
    startColumn: value.start.character + 1,
    endLine: value.end.line + 1,
    endColumn: value.end.character + 1,
  };
}

function toSelection(range: LensSourceRange): vscode.Selection {
  return new vscode.Selection(
    range.startLine - 1,
    range.startColumn - 1,
    range.endLine - 1,
    range.endColumn - 1,
  );
}

function isMatchingWorkspaceUri(uri: vscode.Uri, target: LensVisualTarget): boolean {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder || folder.name !== target.workspace.name || folder.index !== target.workspace.index) {
    return false;
  }
  return normalizeRelativePath(vscode.workspace.asRelativePath(uri, false)) === target.workspacePath;
}

function toLensWorkspaceIdentity(folder: vscode.WorkspaceFolder): LensWorkspaceIdentity {
  return { name: folder.name, index: folder.index };
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

function describeTarget(target: LensVisualTarget): string {
  if (target.kind === 'file') {
    return `${target.workspace.name} · ${target.workspacePath}`;
  }
  const range = target.range ? ` · ${target.range.startLine}-${target.range.endLine}` : '';
  return `${target.symbolKind ?? target.kind}${range}`;
}

function buildTargetTooltip(target: LensVisualTarget): string {
  const location = target.range
    ? `${target.workspace.name} :: ${target.workspacePath}:${target.range.startLine}:${target.range.startColumn}`
    : `${target.workspace.name} :: ${target.workspacePath}`;
  return `**${escapeMarkdown(target.label)}**\n\n${target.detail ? `${escapeMarkdown(target.detail)}\n\n` : ''}` +
    `Location: ${escapeMarkdown(location)}\n\n` +
    `Evidence: ${escapeMarkdown(target.evidence.kind)} — ${escapeMarkdown(target.evidence.source)}\n\n` +
    'Use **Ask Atlas about this** to place this exact target in the next chat turn.';
}

function isSameSourceUri(value: unknown, expected: vscode.Uri): boolean {
  if (value === expected) {
    return true;
  }
  return isRecord(value) &&
    typeof value.scheme === 'string' && value.scheme === expected.scheme &&
    typeof value.path === 'string' && value.path === expected.path;
}

function escapeMarkdown(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/([`*_{}\[\]()<>#+\-.!|])/g, '\\$1');
}

function symbolIcon(kind?: string): string {
  const normalized = kind?.toLowerCase();
  if (normalized === 'class' || normalized === 'interface' || normalized === 'struct') {
    return 'symbol-class';
  }
  if (normalized === 'method' || normalized === 'constructor') {
    return 'symbol-method';
  }
  if (normalized === 'function') {
    return 'symbol-function';
  }
  if (normalized === 'property' || normalized === 'field') {
    return 'symbol-property';
  }
  if (normalized === 'variable' || normalized === 'constant') {
    return 'symbol-variable';
  }
  return 'symbol-misc';
}

function isPosition(value: unknown): value is { line: number; character: number } {
  return isRecord(value) &&
    typeof value.line === 'number' && Number.isInteger(value.line) && value.line >= 0 &&
    typeof value.character === 'number' && Number.isInteger(value.character) && value.character >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
