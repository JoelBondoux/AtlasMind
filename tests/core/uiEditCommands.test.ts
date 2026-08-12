import { describe, expect, it } from 'vitest';
import {
  applyUiEditCommand,
  createUiEditSession,
  parseUiEditCommand,
  UI_EDIT_HISTORY_LIMIT,
} from '../../src/core/uiEditCommands.ts';
import {
  designGraphFromPages,
  resolveUiNodeLayout,
  UI_DESIGN_GRAPH_MAX_REVISION,
} from '../../src/core/uiDesignGraph.ts';
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

  it('adds, frames, changes, and deletes nodes through the same revision boundary', () => {
    let session = createUiEditSession(graph());
    const added = applyUiEditCommand(session, {
      type: 'add-node',
      expectedRevision: 0,
      screenId: 'page-home',
      node: {
        id: 'cta-new', kind: 'cta', label: 'Get started',
        rect: { x: 700, y: 600, width: 250, height: 96 },
        parentId: 'container', designPrompt: '', notes: '',
      },
    });
    expect(added.ok).toBe(true);
    if (!added.ok) { return; }
    session = added.session;
    expect(session.graph.screens[0]?.nodes.at(-1)).toMatchObject({ id: 'cta-new', parentId: 'container' });

    const framed = applyUiEditCommand(session, {
      type: 'set-node-frame', expectedRevision: 1, screenId: 'page-home', nodeId: 'cta-new',
      rect: { x: 500, y: 700, width: 400, height: 120 }, parentId: null,
    });
    expect(framed.ok).toBe(true);
    if (!framed.ok) { return; }
    expect(framed.session.graph.screens[0]?.nodes.at(-1)).toMatchObject({
      id: 'cta-new', layout: { rect: { x: 500, y: 700, width: 400, height: 120 } },
    });
    expect(framed.session.graph.screens[0]?.nodes.at(-1)?.parentId).toBeUndefined();

    const changed = applyUiEditCommand(framed.session, {
      type: 'set-node-kind', expectedRevision: 2, screenId: 'page-home', nodeId: 'cta-new', kind: 'card',
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) { return; }
    const nested = applyUiEditCommand(changed.session, {
      type: 'set-node-frame', expectedRevision: 3, screenId: 'page-home', nodeId: 'child',
      rect: { x: 100, y: 100, width: 400, height: 120 }, parentId: 'container',
    });
    expect(nested.ok).toBe(true);
    if (!nested.ok) { return; }
    const deleted = applyUiEditCommand(nested.session, {
      type: 'delete-node', expectedRevision: 4, screenId: 'page-home', nodeId: 'container',
    });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) { return; }
    expect(deleted.session.graph.screens[0]?.nodes.some(node => node.id === 'container')).toBe(false);
    expect(deleted.session.graph.screens[0]?.nodes.find(node => node.id === 'child')?.parentId).toBeUndefined();
  });

  it('parses only exact bounded commands at an untrusted boundary', () => {
    const command = {
      type: 'set-node-frame', expectedRevision: 4, screenId: 'page-home', nodeId: 'child',
      rect: { x: 1, y: 2, width: 300, height: 100 }, parentId: null,
    };
    expect(parseUiEditCommand(command)).toEqual(command);
    expect(parseUiEditCommand({ ...command, command: 'run' })).toBeUndefined();
    expect(parseUiEditCommand({ ...command, expectedRevision: 4.5 })).toBeUndefined();
    expect(parseUiEditCommand({ ...command, screenId: '../home' })).toBeUndefined();
    expect(parseUiEditCommand({ ...command, rect: { ...command.rect, width: Number.NaN } })).toBeUndefined();
    expect(parseUiEditCommand({
      type: 'add-node', expectedRevision: 4, screenId: 'page-home',
      node: { id: 'new', kind: 'script', label: 'x', rect: command.rect, designPrompt: '', notes: '' },
    })).toBeUndefined();
  });

  it('applies multi-node frames atomically at base and responsive breakpoints', () => {
    const initial = createUiEditSession(graph());
    const frames = [
      { nodeId: 'container', rect: { x: 20, y: 20, width: 960, height: 500 } },
      { nodeId: 'child', rect: { x: 20, y: 120, width: 400, height: 120 } },
    ];
    const aligned = applyUiEditCommand(initial, {
      type: 'set-node-frames', expectedRevision: 0, screenId: 'page-home', frames,
    });
    expect(aligned.ok).toBe(true);
    if (!aligned.ok) { return; }
    expect(aligned.session.graph.revision).toBe(1);
    expect(aligned.session.undo).toHaveLength(1);
    expect(aligned.session.graph.screens[0]!.nodes.map(node => node.layout.rect)).toEqual(frames.map(frame => frame.rect));

    const undone = applyUiEditCommand(aligned.session, { type: 'undo', expectedRevision: 1 });
    expect(undone.ok).toBe(true);
    if (!undone.ok) { return; }
    expect(undone.session.graph.screens[0]!.nodes.map(node => node.layout.rect)).toEqual([
      { x: 0, y: 0, width: 1_000, height: 500 },
      { x: 100, y: 100, width: 400, height: 120 },
    ]);

    const responsive = applyUiEditCommand(initial, {
      type: 'set-node-frames', expectedRevision: 0, screenId: 'page-home', breakpoint: 'mobile', frames,
    });
    expect(responsive.ok).toBe(true);
    if (!responsive.ok) { return; }
    const nodes = responsive.session.graph.screens[0]!.nodes;
    expect(nodes.map(node => node.layout.rect)).toEqual([
      { x: 0, y: 0, width: 1_000, height: 500 },
      { x: 100, y: 100, width: 400, height: 120 },
    ]);
    expect(nodes.map(node => node.viewportOverrides.mobile?.rect)).toEqual(frames.map(frame => frame.rect));

    expect(applyUiEditCommand(initial, {
      type: 'set-node-frames', expectedRevision: 0, screenId: 'page-home',
      frames: [...frames, { nodeId: 'missing', rect: { x: 0, y: 0, width: 100, height: 100 } }],
    })).toMatchObject({ ok: false, reason: 'node-not-found', session: initial });
    expect(applyUiEditCommand(initial, {
      type: 'set-node-frames', expectedRevision: 0, screenId: 'page-home', breakpoint: 'desktop', frames,
    })).toMatchObject({ ok: false, reason: 'invalid-command', session: initial });
  });

  it('parses multi-node frames only when every identity and rectangle is unique and bounded', () => {
    const command = {
      type: 'set-node-frames', expectedRevision: 7, screenId: 'page-home', breakpoint: 'tablet',
      frames: [
        { nodeId: 'container', rect: { x: 0, y: 0, width: 900, height: 500 } },
        { nodeId: 'child', rect: { x: 0, y: 100, width: 400, height: 120 } },
      ],
    };
    expect(parseUiEditCommand(command)).toEqual(command);
    expect(parseUiEditCommand({ ...command, breakpoint: 'watch' })).toBeUndefined();
    expect(parseUiEditCommand({ ...command, frames: [] })).toBeUndefined();
    expect(parseUiEditCommand({ ...command, frames: [command.frames[0], command.frames[0]] })).toBeUndefined();
    expect(parseUiEditCommand({
      ...command,
      frames: [{ nodeId: 'child', rect: { x: 0, y: 0, width: Number.NaN, height: 20 } }],
    })).toBeUndefined();
    expect(parseUiEditCommand({ ...command, command: 'write-file' })).toBeUndefined();
  });

  it('sets container behaviour at base or a responsive breakpoint and resets it as one property family', () => {
    const layout = {
      mode: 'grid' as const,
      widthMode: 'fill' as const,
      heightMode: 'fixed' as const,
      direction: 'horizontal' as const,
      gap: 24,
      padding: 32,
      columns: 3,
      align: 'stretch' as const,
      distribute: 'space-between' as const,
    };
    const base = applyUiEditCommand(createUiEditSession(graph()), {
      type: 'set-node-layout', expectedRevision: 0, screenId: 'page-home', nodeId: 'container', layout,
    });
    expect(base.ok).toBe(true);
    if (!base.ok) { return; }
    expect(base.session.graph.screens[0]!.nodes[0]!.layout).toMatchObject(layout);

    const responsive = applyUiEditCommand(createUiEditSession(graph()), {
      type: 'set-node-layout', expectedRevision: 0, screenId: 'page-home', nodeId: 'container',
      breakpoint: 'mobile', layout,
    });
    expect(responsive.ok).toBe(true);
    if (!responsive.ok) { return; }
    const responsiveNode = responsive.session.graph.screens[0]!.nodes[0]!;
    expect(responsiveNode.layout.mode).toBe('free');
    expect(resolveUiNodeLayout(responsive.session.graph.screens[0]!, responsiveNode, 'mobile').layout)
      .toMatchObject(layout);

    responsiveNode.viewportOverrides.mobile = {
      ...responsiveNode.viewportOverrides.mobile,
      rect: { x: 10, y: 10, width: 900, height: 400 },
      hidden: true,
    };
    const reset = applyUiEditCommand({ ...responsive.session, graph: responsive.session.graph }, {
      type: 'clear-node-viewport-override', expectedRevision: 1,
      screenId: 'page-home', nodeId: 'container', breakpoint: 'mobile', property: 'layout',
    });
    expect(reset.ok).toBe(true);
    if (!reset.ok) { return; }
    expect(reset.session.graph.screens[0]!.nodes[0]!.viewportOverrides.mobile).toEqual({
      rect: { x: 10, y: 10, width: 900, height: 400 }, hidden: true,
    });

    expect(applyUiEditCommand(createUiEditSession(graph()), {
      type: 'set-node-layout', expectedRevision: 0, screenId: 'page-home', nodeId: 'child', layout,
    })).toMatchObject({ ok: false, reason: 'invalid-command' });
  });

  it('parses only exact bounded layout behaviour commands', () => {
    const command = {
      type: 'set-node-layout', expectedRevision: 2, screenId: 'page-home', nodeId: 'container',
      breakpoint: 'tablet',
      layout: {
        mode: 'stack', widthMode: 'fixed', heightMode: 'hug', direction: 'vertical',
        gap: 16, padding: 24, columns: 2, align: 'center', distribute: 'space-between',
      },
    };
    expect(parseUiEditCommand(command)).toEqual(command);
    expect(parseUiEditCommand({ ...command, layout: { ...command.layout, gap: 501 } })).toBeUndefined();
    expect(parseUiEditCommand({ ...command, layout: { ...command.layout, columns: 2.5 } })).toBeUndefined();
    expect(parseUiEditCommand({ ...command, layout: { ...command.layout, mode: 'flex' } })).toBeUndefined();
    expect(parseUiEditCommand({ ...command, layout: { ...command.layout, command: 'run' } })).toBeUndefined();
  });

  it('sets and clears responsive overrides through revisioned, undoable commands', () => {
    const initial = createUiEditSession(graph());
    const tabletRect = { x: 40, y: 120, width: 720, height: 100 };
    const tablet = applyUiEditCommand(initial, {
      type: 'set-node-viewport-override', expectedRevision: 0,
      screenId: 'page-home', nodeId: 'child', breakpoint: 'tablet', rect: tabletRect,
    });
    expect(tablet.ok).toBe(true);
    if (!tablet.ok) { return; }

    const mobile = applyUiEditCommand(tablet.session, {
      type: 'set-node-viewport-override', expectedRevision: 1,
      screenId: 'page-home', nodeId: 'child', breakpoint: 'mobile', hidden: true,
    });
    expect(mobile.ok).toBe(true);
    if (!mobile.ok) { return; }
    const screen = mobile.session.graph.screens[0]!;
    const node = screen.nodes.find(candidate => candidate.id === 'child')!;
    expect(node.layout.rect).toEqual({ x: 100, y: 100, width: 400, height: 120 });
    expect(node.parentId).toBeUndefined();
    const resolved = resolveUiNodeLayout(screen, node, 'mobile');
    expect(resolved.layout).toMatchObject({ rect: tabletRect, hidden: true });
    expect(resolved.provenance.rect).toEqual({ kind: 'override', breakpoint: 'tablet' });
    expect(resolved.provenance.hidden).toEqual({ kind: 'override', breakpoint: 'mobile' });

    const cleared = applyUiEditCommand(mobile.session, {
      type: 'clear-node-viewport-override', expectedRevision: 2,
      screenId: 'page-home', nodeId: 'child', breakpoint: 'tablet', property: 'rect',
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) { return; }
    const clearedNode = cleared.session.graph.screens[0]!.nodes.find(candidate => candidate.id === 'child')!;
    expect(resolveUiNodeLayout(cleared.session.graph.screens[0]!, clearedNode, 'mobile').layout.rect)
      .toEqual(clearedNode.layout.rect);

    const undone = applyUiEditCommand(cleared.session, { type: 'undo', expectedRevision: 3 });
    expect(undone.ok).toBe(true);
    if (!undone.ok) { return; }
    expect(undone.session.graph.revision).toBe(4);
    expect(undone.session.graph.screens[0]!.nodes.find(candidate => candidate.id === 'child')
      ?.viewportOverrides.tablet?.rect).toEqual(tabletRect);

    expect(applyUiEditCommand(undone.session, {
      type: 'set-node-viewport-override', expectedRevision: 4,
      screenId: 'page-home', nodeId: 'child', breakpoint: 'desktop', hidden: true,
    })).toMatchObject({ ok: false, reason: 'invalid-command' });
  });

  it('parses only exact, non-empty responsive override commands', () => {
    const responsive = {
      type: 'set-node-viewport-override', expectedRevision: 2,
      screenId: 'page-home', nodeId: 'child', breakpoint: 'mobile', hidden: true,
    };
    expect(parseUiEditCommand(responsive)).toEqual(responsive);
    expect(parseUiEditCommand({ ...responsive, breakpoint: 'watch' })).toBeUndefined();
    expect(parseUiEditCommand({ ...responsive, hidden: 'yes' })).toBeUndefined();
    expect(parseUiEditCommand({
      type: 'set-node-viewport-override', expectedRevision: 2,
      screenId: 'page-home', nodeId: 'child', breakpoint: 'mobile',
    })).toBeUndefined();
    expect(parseUiEditCommand({ ...responsive, command: 'write-file' })).toBeUndefined();
    expect(parseUiEditCommand({
      type: 'clear-node-viewport-override', expectedRevision: 3,
      screenId: 'page-home', nodeId: 'child', breakpoint: 'tablet', property: 'hidden',
    })).toEqual({
      type: 'clear-node-viewport-override', expectedRevision: 3,
      screenId: 'page-home', nodeId: 'child', breakpoint: 'tablet', property: 'hidden',
    });
    expect(parseUiEditCommand({
      type: 'clear-node-viewport-override', expectedRevision: 3,
      screenId: 'page-home', nodeId: 'child', breakpoint: 'tablet',
    })).toEqual({
      type: 'clear-node-viewport-override', expectedRevision: 3,
      screenId: 'page-home', nodeId: 'child', breakpoint: 'tablet',
    });
    expect(parseUiEditCommand({
      type: 'clear-node-viewport-override', expectedRevision: 3,
      screenId: 'page-home', nodeId: 'child', breakpoint: 'tablet', property: 'style',
    })).toBeUndefined();
  });

  it('resets one responsive property without discarding another', () => {
    const initial = graph();
    const child = initial.screens[0]!.nodes.find(candidate => candidate.id === 'child')!;
    child.viewportOverrides.mobile = {
      rect: { x: 20, y: 30, width: 500, height: 100 },
      hidden: true,
    };
    const rectReset = applyUiEditCommand(createUiEditSession(initial), {
      type: 'clear-node-viewport-override', expectedRevision: 0,
      screenId: 'page-home', nodeId: 'child', breakpoint: 'mobile', property: 'rect',
    });
    expect(rectReset.ok).toBe(true);
    if (!rectReset.ok) { return; }
    expect(rectReset.session.graph.screens[0]!.nodes.find(candidate => candidate.id === 'child')
      ?.viewportOverrides.mobile).toEqual({ hidden: true });

    const hiddenReset = applyUiEditCommand(rectReset.session, {
      type: 'clear-node-viewport-override', expectedRevision: 1,
      screenId: 'page-home', nodeId: 'child', breakpoint: 'mobile', property: 'hidden',
    });
    expect(hiddenReset.ok).toBe(true);
    if (!hiddenReset.ok) { return; }
    expect(hiddenReset.session.graph.screens[0]!.nodes.find(candidate => candidate.id === 'child')
      ?.viewportOverrides.mobile).toBeUndefined();
  });
});
