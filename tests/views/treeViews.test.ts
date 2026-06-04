import { describe, it, expect, vi } from 'vitest';
import { registerTreeViews } from '../../src/views/treeViews';
import * as vscode from 'vscode';

vi.mock('vscode', () => ({
  TreeItem: class {},
  EventEmitter: class {
    fire() {}
    event = vi.fn();
  },
  window: {
    registerWebviewViewProvider: vi.fn(),
    registerTreeDataProvider: vi.fn(),
    createTreeView: vi.fn().mockReturnValue({
      onDidChangeSelection: vi.fn(),
    }),
  },
  commands: {
    registerCommand: vi.fn(),
  },
}));

describe('registerTreeViews', () => {
  it('should register all tree views and commands', () => {
    const mockContext = {
      subscriptions: {
        push: vi.fn(),
      },
    };

    const mockAtlas = {
      agentsRefresh: { event: vi.fn() },
      skillsRefresh: { event: vi.fn() },
      modelsRefresh: { event: vi.fn() },
      projectRunsRefresh: { event: vi.fn() },
      memoryRefresh: { event: vi.fn() },
      sessionConversation: { onDidChange: vi.fn() },
    };
    registerTreeViews(mockContext as any, mockAtlas as any);

    expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalledTimes(2);
    expect(vscode.window.registerTreeDataProvider).toHaveBeenCalledTimes(5);
    expect(vscode.window.createTreeView).toHaveBeenCalledTimes(2);
    expect(vscode.commands.registerCommand).toHaveBeenCalledTimes(2);
  });
});
