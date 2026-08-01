import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readFile, showQuickPick, showInformationMessage, showWarningMessage, showConfig, folder } = vi.hoisted(() => {
  const uri = (path: string) => ({ scheme: 'file', path, fsPath: path, toString: () => `file://${path}` });
  return {
    readFile: vi.fn(), showQuickPick: vi.fn(), showInformationMessage: vi.fn(), showWarningMessage: vi.fn(), showConfig: vi.fn(),
    folder: { name: 'web', index: 0, uri: uri('/workspace') },
  };
});

vi.mock('vscode', () => ({
  Uri: { joinPath: (base: { path: string; fsPath: string }, ...parts: string[]) => ({ path: `${base.path}/${parts.join('/')}`, fsPath: `${base.fsPath}/${parts.join('/')}` }) },
  FileSystemError: class extends Error { code = 'FileNotFound'; },
  window: { activeTextEditor: undefined, showQuickPick, showInformationMessage, showWarningMessage },
  workspace: { workspaceFolders: [folder], getWorkspaceFolder: vi.fn(), fs: { readFile } },
}));
vi.mock('../../src/views/lensConfigPanel', () => ({ LensConfigPanel: { createOrShow: showConfig } }));

import { reviewWorkspaceConfiguration } from '../../src/views/lensConfigCommand';

const FILE = {
  version: 1,
  settings: [{
    id: 'theme', key: 'app.theme', valuePolicy: 'display',
    sources: [{ id: 'default', label: 'Default', kind: 'default', precedence: 0, applies: true, value: 'system' }],
  }],
};

describe('Lens configuration review command', () => {
  beforeEach(() => {
    readFile.mockReset().mockResolvedValue(new TextEncoder().encode(JSON.stringify(FILE)));
    showQuickPick.mockReset().mockImplementation(async (items: unknown[]) => items[0]);
    showInformationMessage.mockReset(); showWarningMessage.mockReset(); showConfig.mockReset();
  });

  it('reads a workspace declaration, selects a setting, and opens its resolution map', async () => {
    await reviewWorkspaceConfiguration();
    expect(readFile).toHaveBeenCalledWith(expect.objectContaining({ path: '/workspace/.atlasmind/lens-config.json' }));
    expect(showConfig).toHaveBeenCalledWith(expect.objectContaining({ key: 'app.theme', winnerSourceId: 'default' }));
  });

  it('refuses malformed configuration metadata', async () => {
    readFile.mockResolvedValue(new TextEncoder().encode('{ bad-json'));
    await reviewWorkspaceConfiguration();
    expect(showConfig).not.toHaveBeenCalled();
    expect(showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('malformed or unreadable'));
  });
});
