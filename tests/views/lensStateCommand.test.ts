import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readFile, showQuickPick, showInformationMessage, showWarningMessage, showState, folder } = vi.hoisted(() => {
  const uri = (path: string) => ({ scheme: 'file', path, fsPath: path, toString: () => `file://${path}` });
  return {
    readFile: vi.fn(),
    showQuickPick: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showState: vi.fn(),
    folder: { name: 'web', index: 0, uri: uri('/workspace') },
  };
});

vi.mock('vscode', () => ({
  Uri: {
    joinPath: (base: { path: string; fsPath: string }, ...parts: string[]) => ({
      scheme: 'file', path: `${base.path}/${parts.join('/')}`, fsPath: `${base.fsPath}/${parts.join('/')}`,
    }),
  },
  FileSystemError: class extends Error { code = 'FileNotFound'; },
  window: { activeTextEditor: undefined, showQuickPick, showInformationMessage, showWarningMessage },
  workspace: { workspaceFolders: [folder], getWorkspaceFolder: vi.fn(), fs: { readFile } },
}));

vi.mock('../../src/views/lensStatePanel', () => ({ LensStatePanel: { createOrShow: showState } }));

import { reviewWorkspaceStateLifecycle } from '../../src/views/lensStateCommand';

const FILE = {
  version: 1,
  machines: [{
    id: 'upload', label: 'Upload', initial: 'idle',
    states: [{ id: 'idle', label: 'Idle' }, { id: 'done', label: 'Done', terminal: true }],
    transitions: [{ id: 'finish', from: 'idle', to: 'done', event: 'COMPLETE' }],
  }],
};

describe('Lens state lifecycle command', () => {
  beforeEach(() => {
    readFile.mockReset().mockResolvedValue(new TextEncoder().encode(JSON.stringify(FILE)));
    showQuickPick.mockReset().mockImplementation(async (items: unknown[]) => items[0]);
    showInformationMessage.mockReset();
    showWarningMessage.mockReset();
    showState.mockReset();
  });

  it('reads an explicit declaration, selects a machine, and opens its derived map', async () => {
    await reviewWorkspaceStateLifecycle();

    expect(readFile).toHaveBeenCalledWith(expect.objectContaining({ path: '/workspace/.atlasmind/lens-state.json' }));
    expect(showState).toHaveBeenCalledWith(expect.objectContaining({
      machineId: 'upload',
      states: expect.arrayContaining([expect.objectContaining({ id: 'idle', initial: true })]),
    }));
  });

  it('does not open a panel for a malformed declaration', async () => {
    readFile.mockResolvedValue(new TextEncoder().encode('{ bad-json'));

    await reviewWorkspaceStateLifecycle();

    expect(showState).not.toHaveBeenCalled();
    expect(showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('malformed or unreadable'));
  });
});
