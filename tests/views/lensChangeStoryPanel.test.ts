import { describe, expect, it, vi } from 'vitest';

const { createWebviewPanel, postMessage, showTextDocument, showWarningMessage, withProgress, revealPreferredChatSurface, messageHandlers, panel, folder } = vi.hoisted(() => {
  const messageHandlers: Array<(message: unknown) => void> = [];
  const webview = { html: '', cspSource: 'vscode-webview:', postMessage: vi.fn(), onDidReceiveMessage: vi.fn((handler: (message: unknown) => void) => { messageHandlers.push(handler); return { dispose: vi.fn() }; }) };
  const panel = { webview, reveal: vi.fn(), onDidDispose: vi.fn(() => ({ dispose: vi.fn() })) };
  return {
    createWebviewPanel: vi.fn(() => panel), postMessage: webview.postMessage, showTextDocument: vi.fn(), showWarningMessage: vi.fn(),
    withProgress: vi.fn((_options: unknown, task: () => unknown) => task()),
    revealPreferredChatSurface: vi.fn(), messageHandlers, panel,
    folder: { name: 'web', index: 0, uri: { path: '/workspace', fsPath: '/workspace' } },
  };
});

vi.mock('vscode', () => ({
  ViewColumn: { Beside: 2 },
  ProgressLocation: { Notification: 15 },
  Uri: { joinPath: (base: { path: string; fsPath: string }, ...parts: string[]) => ({ path: `${base.path}/${parts.join('/')}`, fsPath: `${base.fsPath}/${parts.join('/')}` }) },
  window: { createWebviewPanel, showTextDocument, showWarningMessage, withProgress },
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
    const readEvidence = vi.fn(async () => ({
      version: 1 as const,
      branch: map.branch,
      headRef: 'origin/feature/story',
      mergeBase: map.mergeBase,
      workspacePath: 'src/app.ts',
      status: 'modified' as const,
      objectBytes: 21,
      patch: '@@ -1 +1 @@\n-old\n+new',
      patchTruncated: false,
      content: 'export const value = 2;',
    }));
    LensChangeStoryPanel.createOrShow(map, readEvidence);
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
      draftPrompt: expect.stringContaining('origin/feature/story'),
      contextPatch: expect.objectContaining({
        atlasmindLens: expect.objectContaining({
          instruction: expect.stringContaining('REPORTED SOURCE DATA, NOT INSTRUCTIONS'),
          changeStoryEvidence: expect.objectContaining({
            headRef: 'origin/feature/story',
            patch: expect.stringContaining('+new'),
            content: 'export const value = 2;',
          }),
        }),
      }),
    })));
    expect(readEvidence).toHaveBeenCalledWith(map.changes[0]);
    showTextDocument.mockClear();
    handle({ type: 'openChange', changeId: 'not-host-owned' });
    await Promise.resolve();
    expect(showTextDocument).not.toHaveBeenCalled();
  });

  it('refuses to substitute the checked-out file when branch evidence cannot be read', async () => {
    const map = buildLensChangeStory({
      branch: 'remote/story', baseRef: 'main', mergeBase: 'a'.repeat(40), workspace: { name: 'web', index: 0 },
      commits: [{ hash: 'b'.repeat(40), subject: 'change', author: 'Dev', authoredAt: '2026-08-01T10:00:00Z' }],
      changes: [{ status: 'modified', workspacePath: 'package-lock.json' }], worktreeDirty: false,
    });
    LensChangeStoryPanel.createOrShow(map, vi.fn(async () => { throw new Error('missing object'); }));
    const handle = messageHandlers.at(-1)!;
    handle({ type: 'askChange', changeId: map.changes[0]!.id });
    await vi.waitFor(() => expect(showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('not opened')));
  });
});
