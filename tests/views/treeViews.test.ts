import { describe, it, expect, vi } from 'vitest';
import { describeAcpBridgeState, resolveAcpBridgeState, registerTreeViews } from '../../src/views/treeViews';
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
    // registerTreeViews sets context keys eagerly, so the `when` clauses that
    // hide empty views are correct on the very first render rather than after
    // the first unrelated refresh.
    executeCommand: vi.fn(),
  },
  ThemeIcon: class { constructor(public readonly id: string) {} },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
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
    // Sessions, Models, Project Director, Project State — the four that need a
    // TreeView handle rather than just a data provider, because each carries a
    // badge or a selection listener.
    expect(vscode.window.createTreeView).toHaveBeenCalledTimes(4);
    expect(vscode.commands.registerCommand).toHaveBeenCalledTimes(2);
  });
});

describe('resolveAcpBridgeState — the row must not claim a route the router will not take', () => {
  const ready = { configured: true, providerEnabled: true, modelCount: 1, modelEnabled: true, healthy: true };

  it('reports every unmet condition distinctly', () => {
    expect(resolveAcpBridgeState({ ...ready, configured: false })).toBe('not-set-up');
    expect(resolveAcpBridgeState({ ...ready, providerEnabled: false })).toBe('provider-off');
    expect(resolveAcpBridgeState({ ...ready, modelCount: 0, modelEnabled: false })).toBe('not-discovered');
    expect(resolveAcpBridgeState({ ...ready, modelEnabled: false })).toBe('model-disabled');
    expect(resolveAcpBridgeState({ ...ready, healthy: false })).toBe('unhealthy');
    expect(resolveAcpBridgeState(ready)).toBe('ready');
  });

  it('separates "no model discovered yet" from "model disabled"', () => {
    // They look identical and mean opposite things: only `acp/claude` is seeded,
    // so a freshly configured Codex agent has no model row until discovery runs.
    // Calling that "disabled" sent the user looking for a switch that does not
    // exist. One needs a refresh, the other a toggle.
    expect(resolveAcpBridgeState({ ...ready, modelCount: 0, modelEnabled: false })).toBe('not-discovered');
    expect(resolveAcpBridgeState({ ...ready, modelCount: 1, modelEnabled: false })).toBe('model-disabled');
  });

  it('never reports ready unless every condition is met', () => {
    // The regression this pins: a seeded, enabled `acp/claude` model under a
    // disabled provider previously showed a green tick on an untouched install.
    for (let mask = 0; mask < 15; mask += 1) {
      const state = resolveAcpBridgeState({
        configured: (mask & 1) !== 0,
        providerEnabled: (mask & 2) !== 0,
        modelCount: 1,
        modelEnabled: (mask & 4) !== 0,
        healthy: (mask & 8) !== 0,
      });
      expect(state).not.toBe('ready');
    }
  });

  it('names "not set up" ahead of every other cause', () => {
    // Configuration is the first thing to fix; reporting "provider off" to
    // someone who never configured an agent sends them to the wrong switch.
    expect(resolveAcpBridgeState({ ...ready, configured: false, providerEnabled: false, healthy: false }))
      .toBe('not-set-up');
  });

  it('labels the unfinished states with the next step, not the fault', () => {
    expect(describeAcpBridgeState('not-set-up')).toBe('(ACP — set up)');
    expect(describeAcpBridgeState('not-discovered')).toBe('(ACP — refresh to finish)');
    expect(describeAcpBridgeState('ready')).toBe('(ACP)');
  });
});
