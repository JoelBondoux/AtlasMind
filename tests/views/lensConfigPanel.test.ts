import { describe, expect, it, vi } from 'vitest';

const { createWebviewPanel, postMessage, showTextDocument, revealPreferredChatSurface, messageHandlers, panel, folder } = vi.hoisted(() => {
  const messageHandlers: Array<(message: unknown) => void> = [];
  const uri = (path: string) => ({ path, fsPath: path, toString: () => `file://${path}` });
  const webview = { html: '', cspSource: 'vscode-webview:', postMessage: vi.fn(), onDidReceiveMessage: vi.fn((handler: (message: unknown) => void) => { messageHandlers.push(handler); return { dispose: vi.fn() }; }) };
  const panel = { webview, reveal: vi.fn(), onDidDispose: vi.fn(() => ({ dispose: vi.fn() })) };
  return {
    createWebviewPanel: vi.fn(() => panel), postMessage: webview.postMessage, showTextDocument: vi.fn(),
    revealPreferredChatSurface: vi.fn(), messageHandlers, panel, folder: { name: 'web', index: 0, uri: uri('/workspace') },
  };
});

vi.mock('vscode', () => ({
  ViewColumn: { Beside: 2 },
  Selection: class { constructor(public a: number, public b: number, public c: number, public d: number) {} },
  Uri: { joinPath: (base: { path: string; fsPath: string }, ...parts: string[]) => ({ path: `${base.path}/${parts.join('/')}`, fsPath: `${base.fsPath}/${parts.join('/')}` }) },
  window: { createWebviewPanel, showTextDocument, showWarningMessage: vi.fn() },
  workspace: { workspaceFolders: [folder], getWorkspaceFolder: vi.fn(() => folder), asRelativePath: vi.fn((uri: { path: string }) => uri.path.replace('/workspace/', '')) },
}));
vi.mock('../../src/views/chatPanel', () => ({ revealPreferredChatSurface }));

import { buildLensConfigResolutionMap, normalizeLensConfigFile } from '../../src/core/lensConfigResolution';
import { LensConfigPanel } from '../../src/views/lensConfigPanel';

describe('Lens configuration panel', () => {
  it('uses a ready handshake and host-owned source ids for exact Open/Ask actions', async () => {
    const file = normalizeLensConfigFile({
      version: 1,
      settings: [{
        id: 'token', key: '</script><script>bad()</script>', valuePolicy: 'masked',
        sources: [{ id: 'env', label: 'Environment', kind: 'environment', precedence: 10, applies: true, present: true, source: { workspacePath: 'config/env.ts' } }],
      }],
    });
    const map = buildLensConfigResolutionMap(file!.settings[0]!, { name: 'web', index: 0 });
    LensConfigPanel.createOrShow(map);

    expect(panel.webview.html).toContain('Content-Security-Policy');
    expect(panel.webview.html).toContain('Resolution summary');
    expect(panel.webview.html).not.toContain('bad()');
    const handle = messageHandlers.at(-1)!;
    handle({ type: 'ready' });
    expect(postMessage).toHaveBeenCalledWith({ type: 'map', map });
    handle({ type: 'openSource', sourceId: 'env' });
    await vi.waitFor(() => expect(showTextDocument).toHaveBeenCalled());
    handle({ type: 'askSource', sourceId: 'env' });
    await vi.waitFor(() => expect(revealPreferredChatSurface).toHaveBeenCalledWith(expect.objectContaining({
      contextPatch: expect.objectContaining({ atlasmindLens: expect.any(Object) }),
    })));
    expect(JSON.stringify(revealPreferredChatSurface.mock.calls)).not.toContain('present — value hidden');

    showTextDocument.mockClear();
    handle({ type: 'openSource', sourceId: 'not-host-owned' });
    await Promise.resolve();
    expect(showTextDocument).not.toHaveBeenCalled();
  });
});
