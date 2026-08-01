import { describe, expect, it, vi } from 'vitest';

const {
  createWebviewPanel,
  postMessage,
  showTextDocument,
  revealPreferredChatSurface,
  workspaceFolder,
  messageHandlers,
  panel,
} = vi.hoisted(() => {
  const messageHandlers: Array<(message: unknown) => void> = [];
  const uri = (path: string) => ({ scheme: 'file', path, fsPath: path, toString: () => `file://${path}` });
  const webview = {
    html: '',
    cspSource: 'vscode-webview:',
    postMessage: vi.fn(),
    onDidReceiveMessage: vi.fn((handler: (message: unknown) => void) => {
      messageHandlers.push(handler);
      return { dispose: vi.fn() };
    }),
  };
  const panel = {
    webview,
    reveal: vi.fn(),
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
  };
  return {
    createWebviewPanel: vi.fn(() => panel),
    postMessage: webview.postMessage,
    showTextDocument: vi.fn(),
    revealPreferredChatSurface: vi.fn(),
    workspaceFolder: { name: 'atlasmind', index: 0, uri: uri('/workspace') },
    messageHandlers,
    panel,
  };
});

vi.mock('vscode', () => ({
  ViewColumn: { Beside: 2 },
  Selection: class {
    constructor(
      public readonly startLine: number,
      public readonly startColumn: number,
      public readonly endLine: number,
      public readonly endColumn: number,
    ) {}
  },
  Uri: {
    joinPath: (base: { path: string; fsPath: string }, ...parts: string[]) => ({
      scheme: 'file',
      path: `${base.path}/${parts.join('/')}`,
      fsPath: `${base.fsPath}/${parts.join('/')}`,
      toString: () => `file://${base.path}/${parts.join('/')}`,
    }),
  },
  window: {
    createWebviewPanel,
    showTextDocument,
    showWarningMessage: vi.fn(),
  },
  workspace: {
    workspaceFolders: [workspaceFolder],
    getWorkspaceFolder: vi.fn(() => workspaceFolder),
    asRelativePath: vi.fn((uri: { path: string }) => uri.path.replace('/workspace/', '')),
  },
}));

vi.mock('../../src/views/chatPanel', () => ({ revealPreferredChatSurface }));

import { normalizeLensGraph } from '../../src/core/lensGraph';
import { createSourceLensTarget } from '../../src/core/lensTarget';
import { LensTestPanel } from '../../src/views/lensTestPanel';

describe('Lens test and behaviour panel', () => {
  it('renders after ready and resolves linked-test actions against host-held targets', async () => {
    const root = createSourceLensTarget({
      kind: 'symbol',
      label: '</script><script>bad()</script>',
      workspace: { name: 'atlasmind', index: 0 },
      workspacePath: 'src/root.ts',
      range: { startLine: 2, startColumn: 1, endLine: 4, endColumn: 2 },
      symbolKind: 'Function',
    });
    const test = createSourceLensTarget({
      kind: 'symbol',
      label: 'root works',
      workspace: { name: 'atlasmind', index: 0 },
      workspacePath: 'tests/unit/root.test.ts',
      range: { startLine: 8, startColumn: 1, endLine: 10, endColumn: 2 },
      symbolKind: 'Function',
    });
    const graph = normalizeLensGraph({
      version: 1,
      id: 'journey:test-map',
      label: 'Test map input',
      mode: 'possible',
      rootNodeId: root.id,
      nodes: [
        { id: test.id, target: test, role: 'caller', depth: 0 },
        { id: root.id, target: root, role: 'entrypoint', depth: 1 },
      ],
      edges: [{
        id: 'edge:test',
        fromNodeId: test.id,
        toNodeId: root.id,
        relation: 'calls',
        evidence: { kind: 'source', source: 'VS Code call hierarchy' },
      }],
      notices: [],
      truncated: false,
    })!;

    LensTestPanel.createOrShow(graph);

    expect(panel.webview.html).toContain('Content-Security-Policy');
    expect(panel.webview.html).toContain('Test &amp; behaviour evidence');
    expect(panel.webview.html).toContain('Text view');
    expect(panel.webview.html).not.toContain('bad()');
    const handleMessage = messageHandlers.at(-1);
    handleMessage?.({ type: 'ready' });
    const posted = postMessage.mock.calls.at(-1)?.[0];
    expect(posted).toEqual(expect.objectContaining({
      type: 'testMap',
      testMap: expect.objectContaining({
        items: [expect.objectContaining({ testKind: 'unit', link: 'calls' })],
      }),
    }));

    const itemId = posted.testMap.items[0].id as string;
    handleMessage?.({ type: 'openTarget', targetId: itemId });
    await vi.waitFor(() => expect(showTextDocument).toHaveBeenCalled());
    handleMessage?.({ type: 'askTarget', targetId: itemId });
    await vi.waitFor(() => expect(revealPreferredChatSurface).toHaveBeenCalledWith(expect.objectContaining({
      draftPrompt: expect.stringContaining('Find and assess tests'),
      contextPatch: expect.objectContaining({
        atlasmindLens: expect.objectContaining({
          target: expect.objectContaining({ detail: expect.stringContaining('test-like source calls') }),
        }),
      }),
    })));

    showTextDocument.mockClear();
    handleMessage?.({ type: 'openTarget', targetId: 'not-in-the-host-map' });
    await Promise.resolve();
    expect(showTextDocument).not.toHaveBeenCalled();
  });
});
