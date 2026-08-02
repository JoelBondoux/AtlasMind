import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFile, showQuickPick, showInformationMessage, showWarningMessage, showStory, folder } = vi.hoisted(() => ({
  execFile: vi.fn(), showQuickPick: vi.fn(), showInformationMessage: vi.fn(), showWarningMessage: vi.fn(), showStory: vi.fn(),
  folder: { name: 'web', index: 0, uri: { path: '/workspace', fsPath: '/workspace' } },
}));

vi.mock('node:child_process', () => ({ execFile }));
vi.mock('vscode', () => ({
  ProgressLocation: { Notification: 15 },
  window: {
    activeTextEditor: undefined, showQuickPick, showInformationMessage, showWarningMessage,
    withProgress: vi.fn((_options: unknown, task: () => unknown) => task()),
  },
  workspace: { workspaceFolders: [folder], getWorkspaceFolder: vi.fn() },
}));
vi.mock('../../src/views/lensChangeStoryPanel', () => ({ LensChangeStoryPanel: { createOrShow: showStory } }));

import {
  reviewWorkspaceChangeStory,
  reviewWorkspaceChangeStoryForRefs,
} from '../../src/views/lensChangeStoryCommand';

describe('Lens change story command', () => {
  beforeEach(() => {
    execFile.mockReset().mockImplementation((_command: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => {
      const operation = args[0];
      if (operation === 'rev-parse') callback(null, '/workspace\n');
      else if (operation === 'symbolic-ref' && args.at(-1) === 'HEAD') callback(null, 'feature/story\n');
      else if (operation === 'symbolic-ref') callback(null, 'origin/main\n');
      else if (operation === 'for-each-ref') callback(null, 'main\nfeature/story\norigin/main\norigin/HEAD\n');
      else if (operation === 'merge-base') callback(null, `${'a'.repeat(40)}\n`);
      else if (operation === 'log') callback(null, `${'b'.repeat(40)}\n2026-08-01T10:00:00Z\nDeveloper\nfeat: story\0`);
      else if (operation === 'diff') callback(null, 'M\0src/app.ts\0A\0tests/app.test.ts\0R100\0src/old.ts\0src/new.ts\0');
      else if (operation === 'status') callback(null, ' M src/local.ts\0');
      else callback(new Error('unexpected git call'), '');
    });
    showQuickPick.mockReset().mockImplementation(async (items: unknown[]) => items[0]);
    showInformationMessage.mockReset(); showWarningMessage.mockReset(); showStory.mockReset();
  });

  it('collects read-only merge-base evidence and opens a normalized story', async () => {
    await reviewWorkspaceChangeStory();

    expect(showStory).toHaveBeenCalledWith(expect.objectContaining({
      branch: 'feature/story', baseRef: 'origin/main',
      commits: [expect.objectContaining({ subject: 'feat: story' })],
      changes: expect.arrayContaining([
        expect.objectContaining({ workspacePath: 'src/app.ts', status: 'modified' }),
        expect.objectContaining({ workspacePath: 'src/new.ts', previousPath: 'src/old.ts', status: 'renamed' }),
      ]),
    }));
    expect(execFile.mock.calls.every(call => call[0] === 'git' && Array.isArray(call[1]))).toBe(true);
  });

  it('stops when the workspace folder is nested inside a wider repository', async () => {
    execFile.mockImplementation((_command: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => {
      callback(null, args[0] === 'rev-parse' ? '/parent\n' : '');
    });
    await reviewWorkspaceChangeStory();
    expect(showStory).not.toHaveBeenCalled();
    expect(showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('repository root'));
  });

  it('reviews a host-resolved dashboard branch without switching HEAD', async () => {
    await reviewWorkspaceChangeStoryForRefs(folder as never, {
      branchLabel: 'feature/story',
      headRef: 'origin/feature/story',
      baseRef: 'origin/main',
    });

    expect(showStory).toHaveBeenCalledWith(expect.objectContaining({
      branch: 'feature/story',
      baseRef: 'origin/main',
    }));
    expect(execFile.mock.calls.some(call =>
      call[1][0] === 'log' && call[1].some((arg: string) => arg.endsWith('..origin/feature/story')))).toBe(true);
    expect(execFile.mock.calls.some(call =>
      call[1][0] === 'diff' && call[1].includes('origin/feature/story'))).toBe(true);
    expect(execFile.mock.calls.some(call =>
      call[1][0] === 'switch' || call[1][0] === 'checkout')).toBe(false);
  });
});
