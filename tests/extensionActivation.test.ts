import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { mkdtempSync } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { autoLoadWorkspaceSsot, ensureAtlasMindCliOnTerminalPath, requiresExplicitProviderActivation, resolveStartupSsotLocation, runActivationStep, shouldAutoRefreshProjectMemoryForUri } from '../src/extension.ts';

describe('runActivationStep', () => {
  it('returns true when the activation step succeeds', () => {
    const outputChannel = { appendLine: vi.fn() } as never;
    const step = vi.fn();

    const result = runActivationStep('registerCommands', outputChannel, step);

    expect(result).toBe(true);
    expect(step).toHaveBeenCalledTimes(1);
    expect(outputChannel.appendLine).not.toHaveBeenCalled();
  });

  it('logs and returns false when the activation step throws', () => {
    const outputChannel = { appendLine: vi.fn() } as never;

    const result = runActivationStep('registerChatParticipant', outputChannel, () => {
      throw new Error('boom');
    });

    expect(result).toBe(false);
    expect(outputChannel.appendLine).toHaveBeenCalledWith(
      expect.stringContaining('[activate] registerChatParticipant failed:'),
    );
  });

  it('does not import the agent manager panel during activation bootstrap', () => {
    const source = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');

    expect(source).not.toContain("./views/agentManagerPanel.js");
  });

  it('treats Copilot as an explicitly activated provider', () => {
    expect(requiresExplicitProviderActivation('copilot')).toBe(true);
    expect(requiresExplicitProviderActivation('openai')).toBe(false);
  });

  it('refreshes all active providers during activation-time model refresh', () => {
    const source = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');

    expect(source).toContain('await atlasContext!.refreshProviderModels(true);');
  });

  it('falls back to an existing project_memory SSOT when the configured path is missing', async () => {
    const statSpy = vi.spyOn(vscode.workspace.fs, 'stat').mockImplementation(async (uri: { path?: string }) => {
      if (uri.path === '/workspace/project_memory/project_soul.md') {
        return { mtime: 0 } as never;
      }
      if (uri.path === '/workspace/project_memory/architecture' || uri.path === '/workspace/project_memory/decisions' || uri.path === '/workspace/project_memory/roadmap') {
        return { mtime: 0 } as never;
      }
      throw new Error('missing');
    });

    const resolved = await resolveStartupSsotLocation(
      { uri: { path: '/workspace', fsPath: '/workspace' } } as never,
      'custom_memory',
    );

    expect(resolved).toEqual({
      uri: { path: '/workspace/project_memory', fsPath: '/workspace/project_memory' },
      relativePath: 'project_memory',
    });

    statSpy.mockRestore();
  });

  it('does not trust the workspace root as an SSOT just because marker folders exist', async () => {
    const statSpy = vi.spyOn(vscode.workspace.fs, 'stat').mockImplementation(async (uri: { path?: string }) => {
      if (uri.path === '/workspace/project_soul.md') {
        return { mtime: 0 } as never;
      }
      if (uri.path === '/workspace/architecture' || uri.path === '/workspace/decisions' || uri.path === '/workspace/roadmap') {
        return { mtime: 0 } as never;
      }
      throw new Error('missing');
    });

    const resolved = await resolveStartupSsotLocation(
      { uri: { path: '/workspace', fsPath: '/workspace' } } as never,
      'custom_memory',
    );

    expect(resolved).toBeUndefined();

    statSpy.mockRestore();
  });

  it('loads and refreshes the detected workspace SSOT during startup', async () => {
    const statSpy = vi.spyOn(vscode.workspace.fs, 'stat').mockImplementation(async (uri: { path?: string }) => {
      if (uri.path === '/workspace/project_memory') {
        return { mtime: 0 } as never;
      }
      throw new Error('missing');
    });
    const memoryManager = { loadFromDisk: vi.fn().mockResolvedValue(undefined) };
    const memoryRefresh = { fire: vi.fn() };
    const outputChannel = { appendLine: vi.fn() };

    const resolved = await autoLoadWorkspaceSsot(
      { uri: { path: '/workspace', fsPath: '/workspace' } } as never,
      'project_memory',
      memoryManager,
      memoryRefresh as never,
      outputChannel as never,
    );

    expect(resolved).toEqual({
      uri: { path: '/workspace/project_memory', fsPath: '/workspace/project_memory' },
      relativePath: 'project_memory',
    });
    expect(memoryManager.loadFromDisk).toHaveBeenCalledWith({
      path: '/workspace/project_memory',
      fsPath: '/workspace/project_memory',
    });
    expect(memoryRefresh.fire).toHaveBeenCalledTimes(1);
    expect(outputChannel.appendLine).toHaveBeenCalledWith(
      '[activate] loadSsotFromDisk loaded workspace SSOT from project_memory',
    );

    statSpy.mockRestore();
  });

  it('monitors workspace source files but ignores configured SSOT paths for auto-refresh', () => {
    const workspaceFolder = { uri: { fsPath: 'C:/workspace', path: 'C:/workspace' } } as never;

    expect(shouldAutoRefreshProjectMemoryForUri(
      workspaceFolder,
      'project_memory',
      vscode.Uri.file('C:/workspace/src/extension.ts'),
    )).toBe(true);
    expect(shouldAutoRefreshProjectMemoryForUri(
      workspaceFolder,
      'project_memory',
      vscode.Uri.file('C:/workspace/project_memory/domain/notes.md'),
    )).toBe(false);
    expect(shouldAutoRefreshProjectMemoryForUri(
      workspaceFolder,
      'project_memory',
      vscode.Uri.file('C:/other/place/file.ts'),
    )).toBe(false);
  });

  it('ignores auto-discovered project_memory paths even when atlasmind.ssotPath is custom', () => {
    const workspaceFolder = { uri: { fsPath: 'C:/workspace', path: 'C:/workspace' } } as never;

    expect(shouldAutoRefreshProjectMemoryForUri(
      workspaceFolder,
      'notes/atlas',
      vscode.Uri.file('C:/workspace/project_memory/architecture/project-overview.md'),
    )).toBe(false);
    expect(shouldAutoRefreshProjectMemoryForUri(
      workspaceFolder,
      'notes/atlas',
      vscode.Uri.file('C:/workspace/docs/architecture.md'),
    )).toBe(true);
  });

  it('registers in-session project memory freshness listeners in the activation source', () => {
    const source = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');

    expect(source).toContain('registerProjectMemoryAutoRefresh(context, workspaceFolder, outputChannel);');
    expect(source).toContain('vscode.workspace.onDidSaveTextDocument');
    expect(source).toContain('vscode.workspace.onDidCreateFiles');
    expect(source).toContain('vscode.workspace.onDidDeleteFiles');
    expect(source).toContain('vscode.workspace.onDidRenameFiles');
  });

  it('writes AtlasMind CLI shims and prepends them to the integrated terminal PATH', async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atlasmind-cli-'));
    const extensionRoot = path.join(tempRoot, 'extension');
    const globalStorageRoot = path.join(tempRoot, 'storage');
    const cliEntryPath = path.join(extensionRoot, 'out', 'cli', 'main.js');

    await fs.mkdir(path.dirname(cliEntryPath), { recursive: true });
    await fs.mkdir(globalStorageRoot, { recursive: true });
    await fs.writeFile(cliEntryPath, 'console.log("atlasmind");\n', 'utf8');

    const prepend = vi.fn();
    const environmentVariableCollection = {
      description: undefined as string | undefined,
      persistent: false,
      prepend,
    };
    const outputChannel = { appendLine: vi.fn() };

    const binDir = await ensureAtlasMindCliOnTerminalPath({
      extensionUri: vscode.Uri.file(extensionRoot),
      globalStorageUri: vscode.Uri.file(globalStorageRoot),
      environmentVariableCollection: environmentVariableCollection as never,
    }, outputChannel as never);

    expect(binDir).toBe(path.join(globalStorageRoot, 'bin'));
    expect(environmentVariableCollection.description).toBe('AtlasMind CLI for VS Code integrated terminals');
    expect(environmentVariableCollection.persistent).toBe(true);
    expect(prepend).toHaveBeenCalledWith(process.platform === 'win32' ? 'Path' : 'PATH', `${path.join(globalStorageRoot, 'bin')}${path.delimiter}`);

    const shellShim = await fs.readFile(path.join(globalStorageRoot, 'bin', 'atlasmind'), 'utf8');
    const cmdShim = await fs.readFile(path.join(globalStorageRoot, 'bin', 'atlasmind.cmd'), 'utf8');

    expect(shellShim).toContain('ELECTRON_RUN_AS_NODE=1');
    expect(shellShim).toContain('main.js');
    expect(cmdShim).toContain('set ELECTRON_RUN_AS_NODE=1');
    expect(cmdShim).toContain('main.js');
    expect(outputChannel.appendLine).toHaveBeenCalledWith(
      expect.stringContaining('cliPath enabled atlasmind in new integrated terminals'),
    );
  });
});