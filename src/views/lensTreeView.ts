import * as vscode from 'vscode';

import {
  buildLensActionDraftPrompt,
  buildLensContextPatch,
  buildLensDraftPrompt,
  createSourceLensTarget,
  normalizeLensTarget,
} from '../core/lensTarget.js';
import type { LensTargetActionId } from '../core/lensTarget.js';
import type { LensSourceRange, LensVisualTarget, LensWorkspaceIdentity } from '../types.js';
import { revealPreferredChatSurface } from './chatPanel.js';
import { reviewWorkspaceContractWiring } from './lensContractReviewCommand.js';
import { LensImpactPanel } from './lensImpactPanel.js';
import { LensJourneyPanel } from './lensJourneyPanel.js';
import { LensLanguageGraphAdapter } from './lensLanguageGraph.js';

const LENS_VIEW_ID = 'atlasmind.lensView';
const LENS_FILTER_STORAGE_KEY = 'atlasmind.lens.symbolFilter';

type LensSymbolFilter = 'all' | 'types' | 'callables' | 'data' | 'containers';

interface LensSymbolFilterOption extends vscode.QuickPickItem {
  filter: LensSymbolFilter;
}

type LensTargetMenuAction = LensTargetActionId | 'journey';

interface LensTargetActionOption extends vscode.QuickPickItem {
  action: LensTargetMenuAction;
}

const SYMBOL_FILTER_OPTIONS: readonly LensSymbolFilterOption[] = [
  { label: 'All symbols', description: 'Show every symbol returned by the language service', filter: 'all' },
  { label: 'Types', description: 'Classes, interfaces, structs, enums, and type parameters', filter: 'types' },
  { label: 'Callables', description: 'Functions, methods, constructors, and operators', filter: 'callables' },
  { label: 'Data', description: 'Variables, constants, properties, fields, and enum members', filter: 'data' },
  { label: 'Containers', description: 'Modules, namespaces, packages, objects, and classes', filter: 'containers' },
];

const TARGET_ACTION_OPTIONS: readonly LensTargetActionOption[] = [
  { label: 'Trace possible flow', description: 'Open a bounded references and call-hierarchy journey', action: 'journey' },
  { label: 'Explain this', description: 'Draft a question about behaviour and dependencies', action: 'explain' },
  { label: 'Show impact', description: 'Draft a change-impact review with evidence labels', action: 'impact' },
  { label: 'Find tests', description: 'Draft a test and behaviour coverage review', action: 'tests' },
];

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
  private readonly languageGraph = new LensLanguageGraphAdapter();
  private symbolFilter: LensSymbolFilter;

  public readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly workspaceState?: vscode.Memento) {
    this.symbolFilter = normalizeSymbolFilter(workspaceState?.get<unknown>(LENS_FILTER_STORAGE_KEY));
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

  public async chooseSymbolFilter(): Promise<void> {
    const selected = await vscode.window.showQuickPick(
      SYMBOL_FILTER_OPTIONS.map(option => ({ ...option, picked: option.filter === this.symbolFilter })),
      {
        title: 'AtlasMind Lens symbol filter',
        placeHolder: 'Choose which symbol kinds the Code Explorer should show',
      },
    );
    if (!selected || selected.filter === this.symbolFilter) {
      return;
    }
    this.symbolFilter = selected.filter;
    await this.workspaceState?.update(LENS_FILTER_STORAGE_KEY, selected.filter);
    this.refresh();
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
        : [new LensMessageTreeItem(
          this.symbolFilter === 'all' ? 'No outline available' : 'No symbols match the filter',
          this.symbolFilter === 'all'
            ? 'The active language service returned no symbols.'
            : `The active language service returned no ${symbolFilterLabel(this.symbolFilter).toLowerCase()}.`,
        )];
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

  public async runTargetAction(candidate: unknown): Promise<void> {
    const item = candidate instanceof LensTreeItem ? candidate : undefined;
    const target = normalizeLensTarget(item?.target);
    if (!item || !target || !isMatchingWorkspaceUri(item.uri, target)) {
      void vscode.window.showWarningMessage('AtlasMind refused an invalid or out-of-workspace Lens target.');
      return;
    }

    const options = target.kind === 'symbol' && target.range
      ? TARGET_ACTION_OPTIONS
      : TARGET_ACTION_OPTIONS.filter(option => option.action !== 'journey');
    const selected = await vscode.window.showQuickPick([...options], {
      title: `Lens actions for ${target.label}`,
      placeHolder: 'Choose a source-backed Lens action',
    });
    if (!selected) {
      return;
    }
    if (
      selected.action === 'journey' ||
      (selected.action === 'impact' && target.kind === 'symbol' && Boolean(target.range))
    ) {
      try {
        const graph = await this.languageGraph.buildPossibleFlow(target, item.uri);
        if (selected.action === 'impact') {
          LensImpactPanel.createOrShow(graph);
        } else {
          LensJourneyPanel.createOrShow(graph);
        }
      } catch {
        void vscode.window.showWarningMessage(
          selected.action === 'impact'
            ? 'AtlasMind Lens could not build a safe change-impact map for this symbol.'
            : 'AtlasMind Lens could not build a safe possible-flow journey for this symbol.',
        );
      }
      return;
    }
    await revealPreferredChatSurface({
      draftPrompt: buildLensActionDraftPrompt(target, selected.action),
      contextPatch: buildLensContextPatch(target),
    });
  }

  private async loadDocumentSymbols(
    uri: vscode.Uri,
    workspacePath: string,
    workspace: LensWorkspaceIdentity,
  ): Promise<LensTreeItem[]> {
    const raw = await vscode.commands.executeCommand<unknown[]>('vscode.executeDocumentSymbolProvider', uri) ?? [];
    const symbols = raw.flatMap(symbol => toLensTreeItem(symbol, uri, workspacePath, workspace));
    return filterLensTreeItems(symbols, this.symbolFilter);
  }
}

export function registerLensTreeView(context: vscode.ExtensionContext): void {
  const provider = new LensTreeProvider(context.workspaceState);
  context.subscriptions.push(
    provider,
    vscode.window.registerTreeDataProvider(LENS_VIEW_ID, provider),
    vscode.commands.registerCommand('atlasmind.lens.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('atlasmind.lens.filterSymbols', () => provider.chooseSymbolFilter()),
    vscode.commands.registerCommand('atlasmind.lens.reviewContracts', () => reviewWorkspaceContractWiring()),
    vscode.commands.registerCommand('atlasmind.lens.openTarget', (item?: unknown) => provider.openTarget(item)),
    vscode.commands.registerCommand('atlasmind.lens.askTarget', (item?: unknown) => provider.askAboutTarget(item)),
    vscode.commands.registerCommand('atlasmind.lens.moreTargetActions', (item?: unknown) => provider.runTargetAction(item)),
  );
}

function filterLensTreeItems(items: LensTreeItem[], filter: LensSymbolFilter): LensTreeItem[] {
  if (filter === 'all') {
    return items;
  }
  return items.flatMap(item => {
    const children = filterLensTreeItems(item.children ?? [], filter);
    if (!matchesSymbolFilter(item.target.symbolKind, filter) && children.length === 0) {
      return [];
    }
    return [new LensTreeItem(item.target, item.uri, item.navigationRange, children)];
  });
}

function matchesSymbolFilter(kind: string | undefined, filter: LensSymbolFilter): boolean {
  const normalized = kind?.toLowerCase() ?? '';
  if (filter === 'types') {
    return ['class', 'interface', 'struct', 'enum', 'typeparameter'].includes(normalized);
  }
  if (filter === 'callables') {
    return ['function', 'method', 'constructor', 'operator'].includes(normalized);
  }
  if (filter === 'data') {
    return ['variable', 'constant', 'property', 'field', 'enummember'].includes(normalized);
  }
  return ['module', 'namespace', 'package', 'object', 'class'].includes(normalized);
}

function normalizeSymbolFilter(value: unknown): LensSymbolFilter {
  return value === 'types' || value === 'callables' || value === 'data' || value === 'containers'
    ? value
    : 'all';
}

function symbolFilterLabel(filter: LensSymbolFilter): string {
  return SYMBOL_FILTER_OPTIONS.find(option => option.filter === filter)?.label ?? 'All symbols';
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
