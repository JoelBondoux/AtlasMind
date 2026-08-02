import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  folders: [] as Array<{ name: string; index: number; uri: { scheme: string; path: string; fsPath: string } }>,
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showQuickPick: vi.fn(),
  showTextDocument: vi.fn(),
}));

vi.mock('vscode', () => ({
  Uri: {
    joinPath: (base: { scheme: string; path: string; fsPath: string }, ...parts: string[]) => {
      const suffix = parts.join('/');
      return {
        scheme: base.scheme,
        path: `${base.path}/${suffix}`,
        fsPath: path.join(base.fsPath, ...parts),
      };
    },
  },
  window: {
    activeTextEditor: undefined,
    showInformationMessage: mocks.showInformationMessage,
    showErrorMessage: mocks.showErrorMessage,
    showWarningMessage: mocks.showWarningMessage,
    showQuickPick: mocks.showQuickPick,
    showTextDocument: mocks.showTextDocument,
  },
  workspace: {
    get workspaceFolders() { return mocks.folders; },
    getWorkspaceFolder: vi.fn(),
  },
  commands: { registerCommand: vi.fn() },
}));

import { setupWorkspaceLensDeclarations } from '../../src/views/lensDeclarationSetup.js';

const roots: string[] = [];

beforeEach(() => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atlasmind-lens-setup-'));
  roots.push(root);
  mocks.folders.splice(0, mocks.folders.length, {
    name: 'demo',
    index: 0,
    uri: { scheme: 'file', path: root.replace(/\\/g, '/'), fsPath: root },
  });
  mocks.showInformationMessage.mockReset();
  mocks.showErrorMessage.mockReset();
  mocks.showWarningMessage.mockReset();
  mocks.showQuickPick.mockReset();
  mocks.showTextDocument.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Lens declaration setup', () => {
  it('creates and opens a valid semantics-free starter', async () => {
    await setupWorkspaceLensDeclarations('state');

    const file = path.join(roots[0]!, '.atlasmind', 'lens-state.json');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, machines: [] });
    expect(mocks.showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: file }),
      { preview: false },
    );
  });

  it('opens an existing declaration without overwriting it', async () => {
    const file = path.join(roots[0]!, '.atlasmind', 'lens-config.json');
    mkdirSync(path.dirname(file), { recursive: true });
    const original = '{"version":1,"settings":[{"project":"owned"}]}\n';
    writeFileSync(file, original, 'utf8');

    await setupWorkspaceLensDeclarations('config');

    expect(readFileSync(file, 'utf8')).toBe(original);
    expect(mocks.showTextDocument).toHaveBeenCalled();
  });

  it('refuses to map a virtual workspace URI onto an ambient filesystem path', async () => {
    mocks.folders[0]!.uri.scheme = 'memfs';

    await setupWorkspaceLensDeclarations('state');

    expect(mocks.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('virtual filesystem'));
    expect(mocks.showTextDocument).not.toHaveBeenCalled();
  });
});
