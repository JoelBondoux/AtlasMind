import { describe, it, expect, vi } from 'vitest';
import { describeAcpBridgeState, registerTreeViews } from '../../src/views/treeViews';
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
      discoveryRefresh: { event: vi.fn() },
      ardRegistry: { list: vi.fn(() => []), getRecentResults: vi.fn(() => []) },
      sessionConversation: { onDidChange: vi.fn() },
    };
    registerTreeViews(mockContext as any, mockAtlas as any);

    expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalledTimes(1);
    expect(vscode.window.registerTreeDataProvider).toHaveBeenCalledTimes(6);
    expect(vscode.window.createTreeView).toHaveBeenCalledTimes(3);
    expect(vscode.commands.registerCommand).toHaveBeenCalledTimes(2);
  });
});

describe('describeAcpBridgeState — the row must not claim a route the router will not take', () => {
  // The four conditions `getCandidateModels` actually requires. All of them fail
  // the same way from outside — prompts quietly go somewhere else — so each has
  // to be named separately or the user checks the wrong screen.
  it('reports every unmet condition distinctly, and only says plain (ACP) when all four hold', () => {
    expect(describeAcpBridgeState(false, false, false, false)).toBe('(ACP — not set up)');
    expect(describeAcpBridgeState(true, false, true, true)).toBe('(ACP — provider off)');
    expect(describeAcpBridgeState(true, true, false, true)).toBe('(ACP — model disabled)');
    expect(describeAcpBridgeState(true, true, true, false)).toBe('(⚠ ACP — agent not responding)');
    expect(describeAcpBridgeState(true, true, true, true)).toBe('(ACP)');
  });

  it('never reports plain (ACP) unless every condition is met', () => {
    // The regression this pins: a seeded, enabled `acp/claude` model under a
    // disabled provider previously showed a green tick on an untouched install.
    for (let mask = 0; mask < 15; mask += 1) {
      const state = describeAcpBridgeState(
        (mask & 1) !== 0,
        (mask & 2) !== 0,
        (mask & 4) !== 0,
        (mask & 8) !== 0,
      );
      expect(state).not.toBe('(ACP)');
    }
  });

  it('names "not set up" ahead of every other cause', () => {
    // Configuration is the first thing to fix; reporting "provider off" to
    // someone who never configured an agent sends them to the wrong switch.
    expect(describeAcpBridgeState(false, true, true, true)).toBe('(ACP — not set up)');
  });
});
