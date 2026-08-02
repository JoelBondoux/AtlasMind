import { describe, expect, it, vi } from 'vitest';

const { createWebviewPanel, postMessage, showTextDocument, revealPreferredChatSurface, messageHandlers, panel, folder } = vi.hoisted(() => {
  const messageHandlers: Array<(message: unknown) => void> = [];
  const uri = (path: string) => ({ scheme: 'file', path, fsPath: path, toString: () => `file://${path}` });
  const webview = {
    html: '', cspSource: 'vscode-webview:', postMessage: vi.fn(),
    onDidReceiveMessage: vi.fn((handler: (message: unknown) => void) => { messageHandlers.push(handler); return { dispose: vi.fn() }; }),
  };
  const panel = { webview, reveal: vi.fn(), onDidDispose: vi.fn(() => ({ dispose: vi.fn() })) };
  return {
    createWebviewPanel: vi.fn(() => panel), postMessage: webview.postMessage, showTextDocument: vi.fn(),
    revealPreferredChatSurface: vi.fn(), messageHandlers, panel,
    folder: { name: 'web', index: 0, uri: uri('/workspace') },
  };
});

vi.mock('vscode', () => ({
  ViewColumn: { Beside: 2 },
  Selection: class {
    constructor(public startLine: number, public startColumn: number, public endLine: number, public endColumn: number) {}
  },
  Uri: { joinPath: (base: { path: string; fsPath: string }, ...parts: string[]) => ({ path: `${base.path}/${parts.join('/')}`, fsPath: `${base.fsPath}/${parts.join('/')}` }) },
  window: { createWebviewPanel, showTextDocument, showWarningMessage: vi.fn() },
  workspace: {
    workspaceFolders: [folder], getWorkspaceFolder: vi.fn(() => folder),
    asRelativePath: vi.fn((uri: { path: string }) => uri.path.replace('/workspace/', '')),
  },
}));
vi.mock('../../src/views/chatPanel', () => ({ revealPreferredChatSurface }));

import { buildLensStateMap, normalizeLensStateMachineFile } from '../../src/core/lensStateMachine';
import { LensStatePanel } from '../../src/views/lensStatePanel';

describe('Lens state lifecycle panel', () => {
  it('posts only after ready and resolves open/chat actions through host-owned targets', async () => {
    const file = normalizeLensStateMachineFile({
      version: 1,
      machines: [{
        id: 'job', label: '</script><script>bad()</script>', initial: 'queued',
        states: [{ id: 'queued', label: 'Queued', source: { workspacePath: 'src/job.ts', range: { startLine: 3, startColumn: 1, endLine: 5, endColumn: 2 } } }],
        transitions: [],
      }],
    });
    const map = buildLensStateMap(file!.machines[0]!, { name: 'web', index: 0 });

    LensStatePanel.createOrShow(map);

    expect(panel.webview.html).toContain('Content-Security-Policy');
    expect(panel.webview.html).toContain('Declared transitions');
    expect(panel.webview.html).not.toContain('bad()');
    const handle = messageHandlers.at(-1)!;
    handle({ type: 'ready' });
    expect(postMessage).toHaveBeenCalledWith({ type: 'map', map });

    handle({ type: 'openItem', itemId: 'state:queued' });
    await vi.waitFor(() => expect(showTextDocument).toHaveBeenCalled());
    handle({ type: 'askItem', itemId: 'state:queued' });
    await vi.waitFor(() => expect(revealPreferredChatSurface).toHaveBeenCalledWith(expect.objectContaining({
      contextPatch: expect.objectContaining({ atlasmindLens: expect.any(Object) }),
    })));

    showTextDocument.mockClear();
    handle({ type: 'openItem', itemId: 'state:not-host-owned' });
    await Promise.resolve();
    expect(showTextDocument).not.toHaveBeenCalled();
  });
});
