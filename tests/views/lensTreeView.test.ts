import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeCommand, showTextDocument, activeEditor } = vi.hoisted(() => ({
  executeCommand: vi.fn(),
  showTextDocument: vi.fn(),
  activeEditor: {
    document: {
      uri: { scheme: 'file', path: '/workspace/src/example.ts', fsPath: '/workspace/src/example.ts' },
      fileName: '/workspace/src/example.ts',
    },
  },
}));

vi.mock('vscode', () => ({
  EventEmitter: class {
    event = vi.fn();
    fire = vi.fn();
    dispose = vi.fn();
  },
  TreeItem: class {
    label: string;
    collapsibleState: number;
    constructor(label: string, collapsibleState: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class { constructor(public readonly id: string) {} },
  MarkdownString: class { constructor(public readonly value: string) {} },
  SymbolKind: { 4: 'Class', 11: 'Function', Class: 4, Function: 11 },
  Selection: class {
    constructor(public readonly start: unknown, public readonly end: unknown) {}
  },
  Uri: {
    joinPath: (base: { path: string; fsPath: string }, child: string) => ({
      scheme: 'file',
      path: `${base.path}/${child}`,
      fsPath: `${base.fsPath}/${child}`,
    }),
  },
  window: {
    activeTextEditor: activeEditor,
    onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
    showTextDocument,
  },
  workspace: {
    workspaceFolders: [{ name: 'workspace', uri: { scheme: 'file', path: '/workspace', fsPath: '/workspace' } }],
    getWorkspaceFolder: vi.fn(() => ({ name: 'workspace', uri: { scheme: 'file', path: '/workspace', fsPath: '/workspace' } })),
    asRelativePath: vi.fn(() => 'src/example.ts'),
    onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
  },
  commands: { executeCommand },
}));

import { LensTreeProvider } from '../../src/views/lensTreeView';

describe('AtlasMind Lens outline tree', () => {
  beforeEach(() => {
    executeCommand.mockReset();
    showTextDocument.mockReset();
  });

  it('maps the active file and nested language-service symbols into queryable targets', async () => {
    executeCommand.mockResolvedValueOnce([{
      name: 'Example',
      detail: 'class Example',
      kind: 4,
      range: {
        start: { line: 2, character: 0 },
        end: { line: 20, character: 1 },
      },
      selectionRange: {
        start: { line: 2, character: 6 },
        end: { line: 2, character: 13 },
      },
      children: [{
        name: 'run',
        detail: 'run(): void',
        kind: 11,
        range: {
          start: { line: 5, character: 2 },
          end: { line: 9, character: 3 },
        },
        selectionRange: {
          start: { line: 5, character: 2 },
          end: { line: 5, character: 5 },
        },
        children: [],
      }],
    }]);

    const provider = new LensTreeProvider();
    const roots = await provider.getChildren();
    const symbols = await provider.getChildren(roots[0]);
    const children = await provider.getChildren(symbols[0]);

    expect(roots[0]?.target).toEqual(expect.objectContaining({
      kind: 'file',
      workspacePath: 'src/example.ts',
    }));
    expect(symbols[0]?.target).toEqual(expect.objectContaining({
      kind: 'symbol',
      label: 'Example',
      symbolKind: 'Class',
      range: { startLine: 3, startColumn: 1, endLine: 21, endColumn: 2 },
    }));
    expect(children[0]?.target).toEqual(expect.objectContaining({ label: 'run' }));
    expect(executeCommand).toHaveBeenCalledWith(
      'vscode.executeDocumentSymbolProvider',
      activeEditor.document.uri,
    );
  });

  it('opens the exact source selection represented by a symbol item', async () => {
    executeCommand.mockResolvedValueOnce([]);
    const provider = new LensTreeProvider();
    const roots = await provider.getChildren();
    await provider.openTarget(roots[0]);

    expect(showTextDocument).toHaveBeenCalledWith(
      activeEditor.document.uri,
      expect.objectContaining({ preview: false }),
    );
  });

  it('supports flat SymbolInformation results and escapes untrusted tooltip markdown', async () => {
    executeCommand.mockResolvedValueOnce([{
      name: '[handler](command:malicious)',
      containerName: 'Router ![pixel](https://example.invalid/x)',
      kind: 11,
      location: {
        uri: activeEditor.document.uri,
        range: {
          start: { line: 7, character: 1 },
          end: { line: 9, character: 2 },
        },
      },
    }]);

    const provider = new LensTreeProvider();
    const roots = await provider.getChildren();
    const symbols = await provider.getChildren(roots[0]);
    const tooltip = (symbols[0] as unknown as { tooltip: { value: string } }).tooltip.value;

    expect(symbols[0]?.target).toEqual(expect.objectContaining({
      label: '[handler](command:malicious)',
      detail: 'Router ![pixel](https://example.invalid/x)',
      range: { startLine: 8, startColumn: 2, endLine: 10, endColumn: 3 },
    }));
    expect(tooltip).not.toContain('[handler](command:malicious)');
    expect(tooltip).not.toContain('![pixel](https://example.invalid/x)');
  });
});
