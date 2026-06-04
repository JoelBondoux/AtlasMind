import { describe, it, expect, vi } from 'vitest';
import { registerTreeViews } from '../../src/views/treeViews';
import * as vscode from 'vscode';

vi.mock('vscode', () => ({
  window: {
    registerTreeDataProvider: vi.fn(),
    createTreeView: vi.fn(),
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

    registerTreeViews(mockContext as any);

    expect(vscode.window.registerTreeDataProvider).toHaveBeenCalledTimes(4);
    expect(vscode.window.createTreeView).toHaveBeenCalledTimes(4);
    expect(vscode.commands.registerCommand).toHaveBeenCalledTimes(15);
  });
});
