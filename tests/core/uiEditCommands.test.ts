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

const buttonComponent = {
  id: 'button', label: 'Button', description: 'Shared action', rootKind: 'cta' as const,
  properties: [
    { id: 'label', label: 'Label', kind: 'text' as const, defaultValue: 'Continue' },
    { id: 'size', label: 'Size', kind: 'choice' as const, defaultValue: 'medium', choices: ['small', 'medium', 'large'] },
  ],
  slots: [{ id: 'icon', label: 'Icon', required: false, allowedKinds: ['media' as const], maxChildren: 1 }],
  variants: [{ id: 'primary', label: 'Primary', propertyValues: { size: 'large' } }],
  states: ['default', 'hover', 'disabled'] as const,
};

describe('UI edit commands', () => {
  it('adds, changes, aliases, deletes, and restores tokens through the same revision history', () => {
    let session = createUiEditSession(graph());
    const added = applyUiEditCommand(session, {
      type: 'add-token', expectedRevision: 0,
      token: { id: 'color-primary', label: 'Primary', kind: 'color', value: '#2563eb' },
    });
    expect(added.ok).toBe(true);
    if (!added.ok) { return; }
    session = added.session;
    expect(session.graph.tokens[0]).toEqual({
      id: 'color-primary', label: 'Primary', kind: 'color', value: '#2563EB',
    });

    const alias = applyUiEditCommand(session, {
      type: 'add-token', expectedRevision: 1,
      token: { id: 'color-action', label: 'Action', kind: 'color', aliasOf: 'color-primary' },
    });
    expect(alias.ok).toBe(true);
    if (!alias.ok) { return; }
    const changed = applyUiEditCommand(alias.session, {
      type: 'set-token', expectedRevision: 2, tokenId: 'color-primary',
      token: { id: 'color-primary', label: 'Primary brand', kind: 'color', value: '#123456' },
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) { return; }
    expect(changed.session.graph.tokens[0]).toMatchObject({ label: 'Primary brand', value: '#123456' });
    expect(applyUiEditCommand(changed.session, {
      type: 'delete-token', expectedRevision: 3, tokenId: 'color-primary',
    })).toMatchObject({ ok: false, reason: 'token-in-use' });

    const removedAlias = applyUiEditCommand(changed.session, {
      type: 'delete-token', expectedRevision: 3, tokenId: 'color-action',
    });
    expect(removedAlias.ok).toBe(true);
    if (!removedAlias.ok) { return; }
    const undone = applyUiEditCommand(removedAlias.session, { type: 'undo', expectedRevision: 4 });
    expect(undone.ok).toBe(true);
    if (!undone.ok) { return; }
    expect(undone.session.graph.tokens.some(token => token.id === 'color-action')).toBe(true);
    expect(undone.session.graph.revision).toBe(5);
  });

  it('parses only exact bounded token commands and refuses invalid dependency graphs', () => {
    const direct = {
      type: 'add-token' as const, expectedRevision: 0,
      token: { id: 'space-md', label: 'Medium', kind: 'spacing' as const, value: 16 },
    };
    expect(parseUiEditCommand(direct)).toEqual(direct);
    expect(parseUiEditCommand({ ...direct, command: 'write-file' })).toBeUndefined();
    expect(parseUiEditCommand({ ...direct, token: { ...direct.token, value: -1 } })).toBeUndefined();
    expect(parseUiEditCommand({
      type: 'set-token', expectedRevision: 0, tokenId: 'other', token: direct.token,
    })).toBeUndefined();

    const session = createUiEditSession(graph());
    expect(applyUiEditCommand(session, {
      type: 'add-token', expectedRevision: 0,
      token: { id: 'space-alias', label: 'Alias', kind: 'spacing', aliasOf: 'missing' },
    })).toMatchObject({ ok: false, reason: 'invalid-command' });
  });

  it('propagates component definitions while preserving bounded instance overrides', () => {
    const initial = graph();
    initial.screens[0]!.nodes[1]!.kind = 'cta';
    let result = applyUiEditCommand(createUiEditSession(initial), {
      type: 'add-component', expectedRevision: 0, component: structuredClone(buttonComponent),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    result = applyUiEditCommand(result.session, {
      type: 'set-node-component', expectedRevision: 1, screenId: 'page-home', nodeId: 'child',
      instance: { definitionId: 'button', variantId: 'primary', state: 'hover', propertyOverrides: { label: 'Buy now' } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(result.session.graph.screens[0]!.nodes[1]!.componentInstance).toEqual({
      definitionId: 'button', variantId: 'primary', state: 'hover', propertyOverrides: { label: 'Buy now' },
    });

    const changed = structuredClone(buttonComponent);
    changed.properties[1]!.defaultValue = 'small';
    changed.variants[0]!.propertyValues.size = 'small';
    const updated = applyUiEditCommand(result.session, {
      type: 'set-component', expectedRevision: 2, componentId: 'button', component: changed,
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) { return; }
    expect(updated.session.graph.components[0]!.variants[0]!.propertyValues.size).toBe('small');
    expect(updated.session.graph.screens[0]!.nodes[1]!.componentInstance?.propertyOverrides).toEqual({ label: 'Buy now' });
    expect(applyUiEditCommand(updated.session, {
      type: 'delete-component', expectedRevision: 3, componentId: 'button',
    })).toMatchObject({ ok: false, reason: 'component-in-use' });
  });

  it('parses exact component commands and validates slots against the parent definition', () => {
    const add = { type: 'add-component' as const, expectedRevision: 0, component: structuredClone(buttonComponent) };
    expect(parseUiEditCommand(add)).toEqual(add);
    expect(parseUiEditCommand({ ...add, run: 'shell' })).toBeUndefined();
    expect(parseUiEditCommand({ ...add, component: { ...add.component, states: ['hover'] } })).toBeUndefined();
    expect(parseUiEditCommand({
      ...add,
      component: {
        ...add.component,
        variants: [{ id: 'primary', label: 'Primary', propertyValues: { undeclared: 'x' } }],
      },
    })).toBeUndefined();
    expect(parseUiEditCommand({
      ...add,
      component: {
        ...add.component,
        slots: [{ ...add.component.slots[0]!, allowedKinds: ['media', 'script'] }],
      },
    })).toBeUndefined();

    const initial = graph();
    initial.screens[0]!.nodes[0]!.kind = 'cta';
    initial.screens[0]!.nodes[1]!.kind = 'media';
    initial.screens[0]!.nodes[1]!.parentId = 'container';
    initial.components = [structuredClone(buttonComponent)];
    initial.screens[0]!.nodes[0]!.componentInstance = {
      definitionId: 'button', state: 'default', propertyOverrides: {},
    };
    const assigned = applyUiEditCommand(createUiEditSession(initial), {
      type: 'set-node-component-slot', expectedRevision: 0, screenId: 'page-home', nodeId: 'child', slotId: 'icon',
    });
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) { return; }
    expect(assigned.session.graph.screens[0]!.nodes[1]!.componentSlot).toBe('icon');
    expect(parseUiEditCommand({
      type: 'set-node-component', expectedRevision: 1, screenId: 'page-home', nodeId: 'child',
      instance: { definitionId: 'x', state: 'default', propertyOverrides: {}, execute: true },
    })).toBeUndefined();
    expect(applyUiEditCommand(createUiEditSession(initial), {
      type: 'set-node-component', expectedRevision: 0, screenId: 'page-home', nodeId: 'container',
      instance: { definitionId: 'button', state: 'default', propertyOverrides: { undeclared: 'x' } },
    })).toMatchObject({ ok: false, reason: 'invalid-command' });
  });

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

  it('duplicates a complete subtree atomically with remapped identities and responsive geometry', () => {
    const sourceGraph = graph();
    const sourceScreen = sourceGraph.screens[0]!;
    sourceScreen.nodes[1]!.parentId = 'container';
    sourceScreen.nodes[0]!.viewportOverrides.mobile = {
      rect: { x: 12, y: 20, width: 800, height: 420 },
    };
    const session = createUiEditSession(sourceGraph);
    const duplicated = applyUiEditCommand(session, {
      type: 'duplicate-node', expectedRevision: 0, screenId: 'page-home', nodeId: 'container',
      identities: [
        { sourceId: 'container', newId: 'container-copy' },
        { sourceId: 'child', newId: 'child-copy' },
      ],
      offsetX: 24, offsetY: 32,
    });

    expect(duplicated.ok).toBe(true);
    if (!duplicated.ok) { return; }
    expect(duplicated.session.graph.revision).toBe(1);
    expect(duplicated.session.undo).toHaveLength(1);
    expect(duplicated.session.graph.screens[0]?.nodes).toHaveLength(4);
    expect(duplicated.session.graph.screens[0]?.nodes.find(node => node.id === 'container-copy')).toMatchObject({
      label: 'Container copy',
      locked: false,
      layout: { rect: { x: 0, y: 32, width: 1_000, height: 500 } },
      viewportOverrides: { mobile: { rect: { x: 36, y: 52, width: 800, height: 420 } } },
    });
    expect(duplicated.session.graph.screens[0]?.nodes.find(node => node.id === 'child-copy')).toMatchObject({
      label: 'Child', parentId: 'container-copy', locked: false,
      layout: { rect: { x: 124, y: 132, width: 400, height: 120 } },
    });
    expect(session.graph.screens[0]?.nodes).toHaveLength(2);

    expect(applyUiEditCommand(session, {
      type: 'duplicate-node', expectedRevision: 0, screenId: 'page-home', nodeId: 'container',
      identities: [{ sourceId: 'container', newId: 'container-copy' }], offsetX: 24, offsetY: 24,
    })).toMatchObject({ ok: false, reason: 'invalid-command', session });
    expect(applyUiEditCommand(session, {
      type: 'duplicate-node', expectedRevision: 0, screenId: 'page-home', nodeId: 'container',
      identities: [
        { sourceId: 'container', newId: 'container' },
        { sourceId: 'child', newId: 'child-copy' },
      ], offsetX: 24, offsetY: 24,
    })).toMatchObject({ ok: false, reason: 'invalid-command', session });
  });

  it('enforces locks in the reducer, including atomic batches and structural parent edits', () => {
    const sourceGraph = graph();
    sourceGraph.screens[0]!.nodes[1]!.parentId = 'container';
    const initial = createUiEditSession(sourceGraph);
    const locked = applyUiEditCommand(initial, {
      type: 'set-node-locked', expectedRevision: 0, screenId: 'page-home', nodeId: 'child', locked: true,
    });
    expect(locked.ok).toBe(true);
    if (!locked.ok) { return; }
    expect(locked.session.graph.screens[0]?.nodes[1]?.locked).toBe(true);

    expect(applyUiEditCommand(locked.session, {
      type: 'set-node-label', expectedRevision: 1, screenId: 'page-home', nodeId: 'child', label: 'Changed',
    })).toMatchObject({ ok: false, reason: 'node-locked', session: locked.session });
    expect(applyUiEditCommand(locked.session, {
      type: 'set-node-frames', expectedRevision: 1, screenId: 'page-home',
      frames: [{ nodeId: 'child', rect: { x: 20, y: 20, width: 400, height: 120 } }],
    })).toMatchObject({ ok: false, reason: 'node-locked', session: locked.session });
    expect(applyUiEditCommand(locked.session, {
      type: 'delete-node', expectedRevision: 1, screenId: 'page-home', nodeId: 'container',
    })).toMatchObject({ ok: false, reason: 'node-locked', session: locked.session });
    expect(applyUiEditCommand(locked.session, {
      type: 'duplicate-node', expectedRevision: 1, screenId: 'page-home', nodeId: 'container',
      identities: [
        { sourceId: 'container', newId: 'container-copy' },
        { sourceId: 'child', newId: 'child-copy' },
      ], offsetX: 24, offsetY: 24,
    })).toMatchObject({ ok: false, reason: 'node-locked', session: locked.session });

    const unlocked = applyUiEditCommand(locked.session, {
      type: 'set-node-locked', expectedRevision: 1, screenId: 'page-home', nodeId: 'child', locked: false,
    });
    expect(unlocked.ok).toBe(true);
    if (!unlocked.ok) { return; }
    expect(unlocked.session.graph.screens[0]?.nodes[1]?.locked).toBe(false);
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

    const duplicate = {
      type: 'duplicate-node', expectedRevision: 4, screenId: 'page-home', nodeId: 'container',
      identities: [
        { sourceId: 'container', newId: 'container-copy' },
        { sourceId: 'child', newId: 'child-copy' },
      ], offsetX: 24, offsetY: 24,
    } as const;
    expect(parseUiEditCommand(duplicate)).toEqual(duplicate);
    expect(parseUiEditCommand({ ...duplicate, identities: [duplicate.identities[0], duplicate.identities[0]] })).toBeUndefined();
    expect(parseUiEditCommand({
      ...duplicate,
      identities: [{ sourceId: 'container', newId: 'container-copy', command: 'run' }],
    })).toBeUndefined();
    expect(parseUiEditCommand({
      type: 'set-node-locked', expectedRevision: 4, screenId: 'page-home', nodeId: 'child', locked: true,
    })).toEqual({
      type: 'set-node-locked', expectedRevision: 4, screenId: 'page-home', nodeId: 'child', locked: true,
    });
    expect(parseUiEditCommand({
      type: 'set-node-locked', expectedRevision: 4, screenId: 'page-home', nodeId: 'child', locked: 1,
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
      minWidth: 240,
      maxWidth: 900,
      minHeight: null,
      maxHeight: 600,
      wrap: 'wrap' as const,
      order: -2,
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
        minWidth: 200, maxWidth: 800, minHeight: null, maxHeight: 600,
        wrap: 'nowrap', order: 4,
      },
    };
    expect(parseUiEditCommand(command)).toEqual(command);
    expect(parseUiEditCommand({ ...command, layout: { ...command.layout, gap: 501 } })).toBeUndefined();
    expect(parseUiEditCommand({ ...command, layout: { ...command.layout, columns: 2.5 } })).toBeUndefined();
    expect(parseUiEditCommand({ ...command, layout: { ...command.layout, minWidth: 900 } })).toBeUndefined();
    expect(parseUiEditCommand({ ...command, layout: { ...command.layout, maxHeight: 4_001 } })).toBeUndefined();
    expect(parseUiEditCommand({ ...command, layout: { ...command.layout, order: 1_001 } })).toBeUndefined();
    expect(parseUiEditCommand({ ...command, layout: { ...command.layout, wrap: 'reverse' } })).toBeUndefined();
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
