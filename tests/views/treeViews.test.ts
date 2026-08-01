import { describe, it, expect, vi } from 'vitest';
import { describeAcpBridgeState, resolveAcpBridgeState, registerTreeViews } from '../../src/views/treeViews';
import * as vscode from 'vscode';

vi.mock('vscode', () => ({
  TreeItem: class {},
  EventEmitter: class {
    fire() {}
    event = vi.fn();
  },
  workspace: {
    // The Project State view reads settings per scope, so `inspect` must be
    // present — `get` alone would resolve workspace above user, which is the
    // precedence bug fixed in 0.185.1.
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn(),
      inspect: vi.fn().mockReturnValue(undefined),
    }),
    onDidSaveTextDocument: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onDidChangeTextDocument: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  },
  window: {
    activeTextEditor: undefined,
    onDidChangeActiveTextEditor: vi.fn().mockReturnValue({ dispose: vi.fn() }),
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
    expect(vscode.window.registerTreeDataProvider).toHaveBeenCalledTimes(7);
    // Sessions, Models, Project Director, Project State — the four that need a
    // TreeView handle rather than just a data provider, because each carries a
    // badge or a selection listener.
    expect(vscode.window.createTreeView).toHaveBeenCalledTimes(4);
    // Ten: the seven Lens commands, two memory-entry commands, and
    // `refreshProjectState`, which the
    // Project State titlebar needs. The refresh already existed as a closure
    // and only tree events reached it — a glance surface whose only way to
    // update is an unrelated event firing is one people learn not to trust.
    expect(vscode.commands.registerCommand).toHaveBeenCalledTimes(10);
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

  it('separates "not checked yet" from "not responding"', () => {
    // The bug this pins: `acp` is one provider id in front of several agents,
    // and the row read a provider-wide health flag. A discovery pass that never
    // reached the agent — because ACP was misreported as unconfigured, or
    // because the probe overran its budget — left that flag false, and the row
    // announced "agent not responding" about a process nobody had spawned. A
    // verdict requires having asked.
    expect(resolveAcpBridgeState({ ...ready, healthy: false, probed: true })).toBe('unhealthy');
    expect(resolveAcpBridgeState({ ...ready, healthy: false, probed: false })).toBe('unverified');
  });

  it('leaves an unmeasured pass alone', () => {
    // Health defaults to healthy before the first check, so downgrading an
    // unmeasured *pass* would put a question mark on every agent at startup.
    // Only an unmeasured failure is the claim that cannot be supported.
    expect(resolveAcpBridgeState({ ...ready, healthy: true, probed: false })).toBe('ready');
  });

  it('treats an omitted `probed` as measured, so existing callers keep their verdict', () => {
    expect(resolveAcpBridgeState({ ...ready, healthy: false })).toBe('unhealthy');
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
