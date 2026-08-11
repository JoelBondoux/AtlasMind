import { describe, expect, it } from 'vitest';
import {
  applyUiEditCommand,
  createUiEditSession,
  UI_EDIT_HISTORY_LIMIT,
} from '../../src/core/uiEditCommands.ts';
import { designGraphFromPages, UI_DESIGN_GRAPH_MAX_REVISION } from '../../src/core/uiDesignGraph.ts';
import { createDefaultWebsiteWorkspace } from '../../src/core/websiteWorkspaceManager.ts';

function graph() {
  const pages = createDefaultWebsiteWorkspace().pages;
  pages[0]!.wireframe = {
    breakpoint: 'desktop',
    elements: [
      {
        id: 'container',
        kind: 'section',
        label: 'Container',
        rect: { x: 0, y: 0, width: 1_000, height: 500 },
        designPrompt: '',
        notes: '',
      },
      {
        id: 'child',
        kind: 'text',
        label: 'Child',
        rect: { x: 100, y: 100, width: 400, height: 120 },
        designPrompt: '',
        notes: '',
      },
    ],
  };
  return designGraphFromPages(pages);
}

describe('UI edit commands', () => {
  it('applies a closed node edit and advances the revision once', () => {
    const session = createUiEditSession(graph());
    const result = applyUiEditCommand(session, {
      type: 'set-node-label',
      expectedRevision: 0,
      screenId: 'page-home',
      nodeId: 'child',
      label: 'Intro copy',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(result.session.graph.revision).toBe(1);
    expect(result.session.graph.screens[0]?.nodes[1]?.label).toBe('Intro copy');
    expect(result.session.undo).toHaveLength(1);
    expect(session.graph.screens[0]?.nodes[1]?.label).toBe('Child');
  });

  it('refuses stale, missing, invalid, and no-op edits without mutation', () => {
    const session = createUiEditSession(graph());
    const stale = applyUiEditCommand(session, {
      type: 'move-node', expectedRevision: 4, screenId: 'page-home', nodeId: 'child', x: 1, y: 2,
    });
    const missing = applyUiEditCommand(session, {
      type: 'move-node', expectedRevision: 0, screenId: 'page-home', nodeId: 'missing', x: 1, y: 2,
    });
    const invalid = applyUiEditCommand(session, {
      type: 'resize-node', expectedRevision: 0, screenId: 'page-home', nodeId: 'child', width: Number.NaN, height: 20,
    });
    const noChange = applyUiEditCommand(session, {
      type: 'set-node-label', expectedRevision: 0, screenId: 'page-home', nodeId: 'child', label: 'Child',
    });

    expect(stale).toMatchObject({ ok: false, reason: 'stale-revision', session });
    expect(missing).toMatchObject({ ok: false, reason: 'node-not-found', session });
    expect(invalid).toMatchObject({ ok: false, reason: 'invalid-command', session });
    expect(noChange).toMatchObject({ ok: false, reason: 'no-change', session });
    expect(session.graph.revision).toBe(0);

    const exhaustedGraph = graph();
    exhaustedGraph.revision = UI_DESIGN_GRAPH_MAX_REVISION;
    const exhausted = createUiEditSession(exhaustedGraph);
    expect(applyUiEditCommand(exhausted, {
      type: 'set-node-hidden',
      expectedRevision: UI_DESIGN_GRAPH_MAX_REVISION,
      screenId: 'page-home',
      nodeId: 'child',
      hidden: true,
    })).toMatchObject({ ok: false, reason: 'revision-exhausted' });
  });

  it('bounds geometry and validates reparenting before changing the graph', () => {
    let session = createUiEditSession(graph());
    const moved = applyUiEditCommand(session, {
      type: 'move-node', expectedRevision: 0, screenId: 'page-home', nodeId: 'child', x: 5_000, y: -500,
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) { return; }
    session = moved.session;
    expect(session.graph.screens[0]?.nodes[1]?.layout.rect).toMatchObject({ x: 600, y: 0 });

    const nested = applyUiEditCommand(session, {
      type: 'reparent-node', expectedRevision: 1, screenId: 'page-home', nodeId: 'child', parentId: 'container',
    });
    expect(nested.ok).toBe(true);
    if (!nested.ok) { return; }
    expect(nested.session.graph.screens[0]?.nodes[1]?.parentId).toBe('container');

    const cannotContain = applyUiEditCommand(nested.session, {
      type: 'reparent-node', expectedRevision: 2, screenId: 'page-home', nodeId: 'container', parentId: 'child',
    });
    expect(cannotContain).toMatchObject({ ok: false, reason: 'parent-cannot-contain' });
  });

  it('undoes and redoes content while revisions remain monotonic', () => {
    const initial = createUiEditSession(graph());
    const edited = applyUiEditCommand(initial, {
      type: 'set-node-hidden', expectedRevision: 0, screenId: 'page-home', nodeId: 'child', hidden: true,
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) { return; }
    const undone = applyUiEditCommand(edited.session, { type: 'undo', expectedRevision: 1 });
    expect(undone.ok).toBe(true);
    if (!undone.ok) { return; }
    expect(undone.session.graph.revision).toBe(2);
    expect(undone.session.graph.screens[0]?.nodes[1]?.layout.hidden).toBe(false);

    const redone = applyUiEditCommand(undone.session, { type: 'redo', expectedRevision: 2 });
    expect(redone.ok).toBe(true);
    if (!redone.ok) { return; }
    expect(redone.session.graph.revision).toBe(3);
    expect(redone.session.graph.screens[0]?.nodes[1]?.layout.hidden).toBe(true);

    expect(applyUiEditCommand(redone.session, { type: 'redo', expectedRevision: 3 }))
      .toMatchObject({ ok: false, reason: 'history-empty' });
  });

  it('caps history and clears redo after a new branch of edits', () => {
    let session = createUiEditSession(graph());
    for (let index = 0; index < UI_EDIT_HISTORY_LIMIT + 5; index += 1) {
      const result = applyUiEditCommand(session, {
        type: 'set-node-label',
        expectedRevision: session.graph.revision,
        screenId: 'page-home',
        nodeId: 'child',
        label: `Child ${index}`,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) { return; }
      session = result.session;
    }
    expect(session.undo).toHaveLength(UI_EDIT_HISTORY_LIMIT);

    const undone = applyUiEditCommand(session, { type: 'undo', expectedRevision: session.graph.revision });
    expect(undone.ok).toBe(true);
    if (!undone.ok) { return; }
    expect(undone.session.redo).toHaveLength(1);
    const branched = applyUiEditCommand(undone.session, {
      type: 'set-node-label',
      expectedRevision: undone.session.graph.revision,
      screenId: 'page-home',
      nodeId: 'child',
      label: 'New branch',
    });
    expect(branched.ok).toBe(true);
    if (!branched.ok) { return; }
    expect(branched.session.redo).toEqual([]);
  });
});
