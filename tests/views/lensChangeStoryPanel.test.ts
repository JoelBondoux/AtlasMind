import { describe, expect, it, vi } from 'vitest';

const { createWebviewPanel, postMessage, showTextDocument, revealPreferredChatSurface, messageHandlers, panel, folder } = vi.hoisted(() => {
  const messageHandlers: Array<(message: unknown) => void> = [];
  const webview = { html: '', cspSource: 'vscode-webview:', postMessage: vi.fn(), onDidReceiveMessage: vi.fn((handler: (message: unknown) => void) => { messageHandlers.push(handler); return { dispose: vi.fn() }; }) };
  const panel = { webview, reveal: vi.fn(), onDidDispose: vi.fn(() => ({ dispose: vi.fn() })) };
  return {
    createWebviewPanel: vi.fn(() => panel), postMessage: webview.postMessage, showTextDocument: vi.fn(), revealPreferredChatSurface: vi.fn(), messageHandlers, panel,
    folder: { name: 'web', index: 0, uri: { path: '/workspace', fsPath: '/workspace' } },
  };
});

vi.mock('vscode', () => ({
  ViewColumn: { Beside: 2 },
  Uri: { joinPath: (base: { path: string; fsPath: string }, ...parts: string[]) => ({ path: `${base.path}/${parts.join('/')}`, fsPath: `${base.fsPath}/${parts.join('/')}` }) },
  window: { createWebviewPanel, showTextDocument, showWarningMessage: vi.fn() },
  workspace: { workspaceFolders: [folder], getWorkspaceFolder: vi.fn(() => folder), asRelativePath: vi.fn((uri: { path: string }) => uri.path.replace('/workspace/', '')) },
}));
vi.mock('../../src/views/chatPanel', () => ({ revealPreferredChatSurface }));

import { buildLensChangeStory } from '../../src/core/lensChangeStory';
import { LensChangeStoryPanel } from '../../src/views/lensChangeStoryPanel';

describe('Lens change story panel', () => {
  it('posts after ready and resolves changed-file actions from host-held ids', async () => {
    const map = buildLensChangeStory({
      branch: '</script><script>bad()</script>', baseRef: 'main', mergeBase: 'a'.repeat(40), workspace: { name: 'web', index: 0 },
      commits: [{ hash: 'b'.repeat(40), subject: 'change', author: 'Dev', authoredAt: '2026-08-01T10:00:00Z' }],
      changes: [{ status: 'modified', workspacePath: 'src/app.ts' }], worktreeDirty: false,
    });
    LensChangeStoryPanel.createOrShow(map);
    expect(panel.webview.html).toContain('Content-Security-Policy');
    expect(panel.webview.html).toContain('Commit intent trail');
    expect(panel.webview.html).not.toContain('bad()');
    const handle = messageHandlers.at(-1)!;
    handle({ type: 'ready' });
    expect(postMessage).toHaveBeenCalledWith({ type: 'map', map });
    const changeId = map.changes[0]!.id;
    handle({ type: 'openChange', changeId });
    await vi.waitFor(() => expect(showTextDocument).toHaveBeenCalled());
    handle({ type: 'askChange', changeId });
    await vi.waitFor(() => expect(revealPreferredChatSurface).toHaveBeenCalledWith(expect.objectContaining({
      contextPatch: expect.objectContaining({ atlasmindLens: expect.any(Object) }),
    })));
    showTextDocument.mockClear();
    handle({ type: 'openChange', changeId: 'not-host-owned' });
    await Promise.resolve();
    expect(showTextDocument).not.toHaveBeenCalled();
  });
});
