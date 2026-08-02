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
    title: '',
    webview,
    reveal: vi.fn(),
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
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

import { LensJourneyPanel } from '../../src/views/lensJourneyPanel';
import { normalizeLensGraph } from '../../src/core/lensGraph';
import { createSourceLensTarget } from '../../src/core/lensTarget';

describe('Lens journey panel', () => {
  it('renders graph data after a ready handshake and resolves node actions in the host', async () => {
    const root = createSourceLensTarget({
      kind: 'symbol',
      label: '</script><script>bad()</script>',
      workspace: { name: 'atlasmind', index: 0 },
      workspacePath: 'src/root.ts',
      range: { startLine: 2, startColumn: 1, endLine: 4, endColumn: 2 },
      symbolKind: 'Function',
    });
    const graph = normalizeLensGraph({
      version: 1,
      id: 'journey:test',
      label: 'Possible request journey',
      mode: 'possible',
      rootNodeId: root.id,
      nodes: [{ id: root.id, target: root, role: 'entrypoint', depth: 1 }],
      edges: [],
      notices: ['Possible flow is not observed execution.'],
      truncated: false,
    });
    expect(graph).toBeDefined();

    LensJourneyPanel.createOrShow(graph!);

    expect(panel.webview.html).toContain('Content-Security-Policy');
    expect(panel.webview.html).toContain('Text view');
    expect(panel.webview.html).not.toContain('bad()');
    const handleMessage = messageHandlers.at(-1);
    expect(handleMessage).toBeDefined();

    handleMessage?.({ type: 'ready' });
    expect(postMessage).toHaveBeenCalledWith({ type: 'graph', graph });

    handleMessage?.({ type: 'openNode', nodeId: root.id });
    await vi.waitFor(() => expect(showTextDocument).toHaveBeenCalled());
    handleMessage?.({ type: 'askNode', nodeId: root.id });
    await vi.waitFor(() => expect(revealPreferredChatSurface).toHaveBeenCalledWith(expect.objectContaining({
      contextPatch: expect.objectContaining({ atlasmindLens: expect.any(Object) }),
    })));

    showTextDocument.mockClear();
    handleMessage?.({ type: 'openNode', nodeId: 'not-in-the-host-graph' });
    await Promise.resolve();
    expect(showTextDocument).not.toHaveBeenCalled();
  });
});
