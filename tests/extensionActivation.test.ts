import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import * as vscode from 'vscode';
import { autoLoadWorkspaceSsot, requiresExplicitProviderActivation, resolveStartupSsotLocation, runActivationStep } from '../src/extension.ts';

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

  it('defers interactive providers during activation-time model refresh', () => {
    const source = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');

    expect(source).toContain('await atlasContext!.refreshProviderModels(false);');
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
});