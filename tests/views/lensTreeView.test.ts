import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  executeCommand,
  showQuickPick,
  showTextDocument,
  showWarningMessage,
  revealPreferredChatSurface,
  buildPossibleFlow,
  showJourney,
  activeEditor,
  primaryUri,
  secondaryUri,
  workspaceFolders,
} = vi.hoisted(() => {
  const primaryUri = { scheme: 'file', path: '/workspace/src/example.ts', fsPath: '/workspace/src/example.ts' };
  const secondaryUri = { scheme: 'file', path: '/api/src/example.ts', fsPath: '/api/src/example.ts' };
  return {
    executeCommand: vi.fn(),
    showQuickPick: vi.fn(),
    showTextDocument: vi.fn(),
    showWarningMessage: vi.fn(),
    revealPreferredChatSurface: vi.fn(),
    buildPossibleFlow: vi.fn(),
    showJourney: vi.fn(),
    primaryUri,
    secondaryUri,
    workspaceFolders: [
      { name: 'web', index: 0, uri: { scheme: 'file', path: '/workspace', fsPath: '/workspace' } },
      { name: 'api', index: 1, uri: { scheme: 'file', path: '/api', fsPath: '/api' } },
    ],
    activeEditor: {
      document: {
        uri: primaryUri,
        fileName: '/workspace/src/example.ts',
      },
    },
  };
});

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
  SymbolKind: {
    4: 'Class',
    5: 'Method',
    7: 'Property',
    11: 'Function',
    Class: 4,
    Method: 5,
    Property: 7,
    Function: 11,
  },
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
    showWarningMessage,
    showQuickPick,
  },
  workspace: {
    workspaceFolders,
    getWorkspaceFolder: vi.fn((uri: { path: string }) => uri.path.startsWith('/api/') ? workspaceFolders[1] : workspaceFolders[0]),
    asRelativePath: vi.fn(() => 'src/example.ts'),
    onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
  },
  commands: { executeCommand },
}));

vi.mock('../../src/views/chatPanel', () => ({ revealPreferredChatSurface }));
vi.mock('../../src/views/lensLanguageGraph', () => ({
  LensLanguageGraphAdapter: class {
    buildPossibleFlow = buildPossibleFlow;
  },
}));
vi.mock('../../src/views/lensJourneyPanel', () => ({
  LensJourneyPanel: { createOrShow: showJourney },
}));

import { LensTreeProvider } from '../../src/views/lensTreeView';

describe('AtlasMind Lens outline tree', () => {
  beforeEach(() => {
    activeEditor.document.uri = primaryUri;
    executeCommand.mockReset();
    showQuickPick.mockReset();
    showTextDocument.mockReset();
    showWarningMessage.mockReset();
    revealPreferredChatSurface.mockReset();
    buildPossibleFlow.mockReset();
    showJourney.mockReset();
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
      workspace: { name: 'web', index: 0 },
      workspacePath: 'src/example.ts',
    }));
    expect(symbols[0]?.target).toEqual(expect.objectContaining({
      kind: 'symbol',
      label: 'Example',
      workspace: { name: 'web', index: 0 },
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

  it('gives identical relative paths distinct workspace-root identities', async () => {
    executeCommand.mockResolvedValue([]);
    const provider = new LensTreeProvider();

    const primary = await provider.getChildren();
    activeEditor.document.uri = secondaryUri;
    const secondary = await provider.getChildren();

    expect(primary[0]?.target.workspace).toEqual({ name: 'web', index: 0 });
    expect(secondary[0]?.target.workspace).toEqual({ name: 'api', index: 1 });
    expect(primary[0]?.target.workspacePath).toBe('src/example.ts');
    expect(secondary[0]?.target.workspacePath).toBe('src/example.ts');
    expect(primary[0]?.target.id).not.toBe(secondary[0]?.target.id);
  });

  it('refuses navigation when the target names a different workspace root', async () => {
    executeCommand.mockResolvedValue([]);
    const provider = new LensTreeProvider();
    const roots = await provider.getChildren();
    (roots[0] as unknown as { target: { workspace: { name: string; index: number } } }).target.workspace = {
      name: 'api',
      index: 1,
    };

    await provider.openTarget(roots[0]);

    expect(showTextDocument).not.toHaveBeenCalled();
    expect(showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('invalid or out-of-workspace'));
  });

  it('filters symbol kinds while retaining ancestors of matching descendants', async () => {
    executeCommand.mockResolvedValueOnce([{
      name: 'Controller',
      kind: 4,
      range: { start: { line: 1, character: 0 }, end: { line: 20, character: 1 } },
      selectionRange: { start: { line: 1, character: 6 }, end: { line: 1, character: 16 } },
      children: [
        {
          name: 'run',
          kind: 5,
          range: { start: { line: 4, character: 2 }, end: { line: 8, character: 3 } },
          selectionRange: { start: { line: 4, character: 2 }, end: { line: 4, character: 5 } },
          children: [],
        },
        {
          name: 'status',
          kind: 7,
          range: { start: { line: 10, character: 2 }, end: { line: 10, character: 20 } },
          selectionRange: { start: { line: 10, character: 2 }, end: { line: 10, character: 8 } },
          children: [],
        },
      ],
    }]);
    showQuickPick.mockResolvedValue({ label: 'Callables', filter: 'callables' });
    const provider = new LensTreeProvider();

    await provider.chooseSymbolFilter();
    const roots = await provider.getChildren();
    const symbols = await provider.getChildren(roots[0]);
    const children = await provider.getChildren(symbols[0]);

    expect(symbols.map(item => item.label)).toEqual(['Controller']);
    expect(children.map(item => item.label)).toEqual(['run']);
  });

  it('turns a selected target action into an editable, evidence-aware chat draft', async () => {
    executeCommand.mockResolvedValue([]);
    showQuickPick.mockResolvedValue({ label: 'Show impact', action: 'impact' });
    const provider = new LensTreeProvider();
    const roots = await provider.getChildren();

    await provider.runTargetAction(roots[0]);

    expect(revealPreferredChatSurface).toHaveBeenCalledWith(expect.objectContaining({
      draftPrompt: expect.stringContaining('Assess the change impact'),
      contextPatch: expect.objectContaining({
        atlasmindLens: expect.objectContaining({ target: roots[0]?.target }),
      }),
    }));
  });

  it('builds and opens a possible-flow journey from the selected symbol', async () => {
    executeCommand.mockResolvedValueOnce([{
      name: 'run',
      kind: 11,
      range: { start: { line: 3, character: 0 }, end: { line: 6, character: 1 } },
      selectionRange: { start: { line: 3, character: 0 }, end: { line: 3, character: 3 } },
      children: [],
    }]);
    showQuickPick.mockResolvedValue({ label: 'Trace possible flow', action: 'journey' });
    const graph = { id: 'graph' };
    buildPossibleFlow.mockResolvedValue(graph);
    const provider = new LensTreeProvider();
    const roots = await provider.getChildren();
    const symbols = await provider.getChildren(roots[0]);

    await provider.runTargetAction(symbols[0]);

    expect(buildPossibleFlow).toHaveBeenCalledWith(symbols[0]?.target, primaryUri);
    expect(showJourney).toHaveBeenCalledWith(graph);
    expect(revealPreferredChatSurface).not.toHaveBeenCalled();
  });
});
