/**
 * Closed, revision-checked mutations for UI Studio's design graph.
 *
 * Pointer gestures, forms, preview events, and model proposals must all become
 * one of these commands. The reducer is pure: it does not persist, render, call
 * a model, or infer intent. A refusal returns the original session unchanged.
 */

import type {
  UiDesignGraph,
  UiDesignNode,
  UiDesignScreen,
  WireframeBreakpoint,
  WireframeElementKind,
  WireframeRect,
} from '../types.js';
import {
  isWireframeElementKind,
  MAX_WIREFRAME_ELEMENTS,
  sanitizeRect,
  wireframeKindSpec,
  WIREFRAME_CANVAS_HEIGHT,
  WIREFRAME_CANVAS_WIDTH,
  MAX_WIREFRAME_DEPTH,
  WIREFRAME_BREAKPOINTS,
} from './websiteWireframe.js';
import { UI_DESIGN_GRAPH_MAX_REVISION } from './uiDesignGraph.js';

export const UI_EDIT_HISTORY_LIMIT = 100;

interface UiEditCommandBase {
  expectedRevision: number;
}

interface UiNodeCommandBase extends UiEditCommandBase {
  screenId: string;
  nodeId: string;
}

export interface UiNewNode {
  id: string;
  kind: WireframeElementKind;
  label: string;
  rect: WireframeRect;
  parentId?: string;
  designPrompt: string;
  notes: string;
}

export type UiViewportOverrideProperty = 'rect' | 'hidden' | 'all';

export type UiEditCommand =
  | (UiEditCommandBase & { type: 'add-node'; screenId: string; node: UiNewNode })
  | (UiNodeCommandBase & { type: 'delete-node' })
  | (UiNodeCommandBase & { type: 'set-node-kind'; kind: WireframeElementKind })
  | (UiNodeCommandBase & { type: 'set-node-frame'; rect: WireframeRect; parentId: string | null })
  | (UiNodeCommandBase & { type: 'set-node-label'; label: string })
  | (UiNodeCommandBase & { type: 'set-node-design-prompt'; designPrompt: string })
  | (UiNodeCommandBase & { type: 'move-node'; x: number; y: number })
  | (UiNodeCommandBase & { type: 'resize-node'; width: number; height: number })
  | (UiNodeCommandBase & { type: 'reparent-node'; parentId?: string })
  | (UiNodeCommandBase & { type: 'set-node-hidden'; hidden: boolean })
  | (UiNodeCommandBase & {
    type: 'set-node-viewport-override';
    breakpoint: WireframeBreakpoint;
    rect?: WireframeRect;
    hidden?: boolean;
  })
  | (UiNodeCommandBase & {
    type: 'clear-node-viewport-override';
    breakpoint: WireframeBreakpoint;
    property?: UiViewportOverrideProperty;
  })
  | (UiEditCommandBase & { type: 'undo' })
  | (UiEditCommandBase & { type: 'redo' });

export interface UiEditSession {
  graph: UiDesignGraph;
  undo: UiDesignGraph[];
  redo: UiDesignGraph[];
}

export type UiEditRefusalReason =
  | 'stale-revision'
  | 'revision-exhausted'
  | 'screen-not-found'
  | 'node-not-found'
  | 'parent-not-found'
  | 'parent-cannot-contain'
  | 'parent-cycle'
  | 'parent-depth'
  | 'invalid-command'
  | 'no-change'
  | 'history-empty';

export type UiEditResult =
  | { ok: true; session: UiEditSession }
  | { ok: false; reason: UiEditRefusalReason; session: UiEditSession };

/** Parse the exact command vocabulary at a webview/model boundary. */
export function parseUiEditCommand(input: unknown): UiEditCommand | undefined {
  if (!isRecord(input) || typeof input['type'] !== 'string'
      || !Number.isSafeInteger(input['expectedRevision'])) {
    return undefined;
  }
  const expectedRevision = input['expectedRevision'] as number;
  if (input['type'] === 'undo' || input['type'] === 'redo') {
    return exactKeys(input, ['type', 'expectedRevision'])
      ? { type: input['type'], expectedRevision }
      : undefined;
  }
  if (!validIdentifier(input['screenId'])) {
    return undefined;
  }
  const screenId = input['screenId'];
  if (input['type'] === 'add-node') {
    const node = parseNewNode(input['node']);
    return node && exactKeys(input, ['type', 'expectedRevision', 'screenId', 'node'])
      ? { type: 'add-node', expectedRevision, screenId, node }
      : undefined;
  }
  if (!validIdentifier(input['nodeId'])) {
    return undefined;
  }
  const nodeId = input['nodeId'];
  const base = { expectedRevision, screenId, nodeId };
  switch (input['type']) {
    case 'delete-node':
      return exactKeys(input, ['type', 'expectedRevision', 'screenId', 'nodeId'])
        ? { type: 'delete-node', ...base }
        : undefined;
    case 'set-node-kind':
      return exactKeys(input, ['type', 'expectedRevision', 'screenId', 'nodeId', 'kind'])
        && isWireframeElementKind(input['kind'])
        ? { type: 'set-node-kind', ...base, kind: input['kind'] }
        : undefined;
    case 'set-node-frame': {
      const rect = parseRect(input['rect']);
      const parentId = input['parentId'];
      return rect
        && (parentId === null || validIdentifier(parentId))
        && exactKeys(input, ['type', 'expectedRevision', 'screenId', 'nodeId', 'rect', 'parentId'])
        ? { type: 'set-node-frame', ...base, rect, parentId }
        : undefined;
    }
    case 'set-node-label':
      return typeof input['label'] === 'string'
        && input['label'].trim().length > 0
        && input['label'].length <= 120
        && exactKeys(input, ['type', 'expectedRevision', 'screenId', 'nodeId', 'label'])
        ? { type: 'set-node-label', ...base, label: input['label'] }
        : undefined;
    case 'set-node-design-prompt':
      return typeof input['designPrompt'] === 'string'
        && input['designPrompt'].length <= 1_000
        && exactKeys(input, ['type', 'expectedRevision', 'screenId', 'nodeId', 'designPrompt'])
        ? { type: 'set-node-design-prompt', ...base, designPrompt: input['designPrompt'] }
        : undefined;
    case 'move-node':
      return finite(input['x']) && finite(input['y'])
        && exactKeys(input, ['type', 'expectedRevision', 'screenId', 'nodeId', 'x', 'y'])
        ? { type: 'move-node', ...base, x: input['x'], y: input['y'] }
        : undefined;
    case 'resize-node':
      return finite(input['width']) && finite(input['height'])
        && exactKeys(input, ['type', 'expectedRevision', 'screenId', 'nodeId', 'width', 'height'])
        ? { type: 'resize-node', ...base, width: input['width'], height: input['height'] }
        : undefined;
    case 'reparent-node':
      return (input['parentId'] === undefined || validIdentifier(input['parentId']))
        && exactKeys(input, input['parentId'] === undefined
          ? ['type', 'expectedRevision', 'screenId', 'nodeId']
          : ['type', 'expectedRevision', 'screenId', 'nodeId', 'parentId'])
        ? { type: 'reparent-node', ...base, ...(input['parentId'] ? { parentId: input['parentId'] } : {}) }
        : undefined;
    case 'set-node-hidden':
      return typeof input['hidden'] === 'boolean'
        && exactKeys(input, ['type', 'expectedRevision', 'screenId', 'nodeId', 'hidden'])
        ? { type: 'set-node-hidden', ...base, hidden: input['hidden'] }
        : undefined;
    case 'set-node-viewport-override': {
      const breakpoint = input['breakpoint'];
      const hasRect = Object.prototype.hasOwnProperty.call(input, 'rect');
      const rect = hasRect ? parseRect(input['rect']) : undefined;
      const hasHidden = Object.prototype.hasOwnProperty.call(input, 'hidden');
      return isBreakpoint(breakpoint)
        && (hasRect || hasHidden)
        && (!hasRect || rect !== undefined)
        && (!hasHidden || typeof input['hidden'] === 'boolean')
        && exactKeys(
          input,
          ['type', 'expectedRevision', 'screenId', 'nodeId', 'breakpoint'],
          ['rect', 'hidden'],
        )
        ? {
          type: 'set-node-viewport-override',
          ...base,
          breakpoint,
          ...(rect ? { rect } : {}),
          ...(hasHidden ? { hidden: input['hidden'] as boolean } : {}),
        }
        : undefined;
    }
    case 'clear-node-viewport-override': {
      const property = input['property'];
      return isBreakpoint(input['breakpoint'])
        && (property === undefined || isOverrideProperty(property))
        && exactKeys(
          input,
          ['type', 'expectedRevision', 'screenId', 'nodeId', 'breakpoint'],
          ['property'],
        )
        ? {
          type: 'clear-node-viewport-override',
          ...base,
          breakpoint: input['breakpoint'],
          ...(property === undefined ? {} : { property }),
        }
        : undefined;
    }
    default:
      return undefined;
  }
}

function parseNewNode(input: unknown): UiNewNode | undefined {
  if (!isRecord(input)
      || !exactKeys(input, ['id', 'kind', 'label', 'rect', 'designPrompt', 'notes'], ['parentId'])
      || !validIdentifier(input['id'])
      || !isWireframeElementKind(input['kind'])
      || typeof input['label'] !== 'string'
      || input['label'].trim().length === 0
      || input['label'].length > 120
      || typeof input['designPrompt'] !== 'string'
      || input['designPrompt'].length > 1_000
      || typeof input['notes'] !== 'string'
      || input['notes'].length > 1_000
      || (input['parentId'] !== undefined && !validIdentifier(input['parentId']))) {
    return undefined;
  }
  const rect = parseRect(input['rect']);
  if (!rect) {
    return undefined;
  }
  return {
    id: input['id'],
    kind: input['kind'],
    label: input['label'],
    rect,
    ...(input['parentId'] ? { parentId: input['parentId'] } : {}),
    designPrompt: input['designPrompt'],
    notes: input['notes'],
  };
}

export function createUiEditSession(graph: UiDesignGraph): UiEditSession {
  return { graph: cloneGraph(graph), undo: [], redo: [] };
}

export function applyUiEditCommand(session: UiEditSession, command: UiEditCommand): UiEditResult {
  if (!Number.isSafeInteger(command.expectedRevision)
      || command.expectedRevision !== session.graph.revision) {
    return refused(session, 'stale-revision');
  }
  if (session.graph.revision >= UI_DESIGN_GRAPH_MAX_REVISION) {
    return refused(session, 'revision-exhausted');
  }
  if (command.type === 'undo') {
    return restoreHistory(session, 'undo');
  }
  if (command.type === 'redo') {
    return restoreHistory(session, 'redo');
  }

  const screenIndex = session.graph.screens.findIndex(screen => screen.id === command.screenId);
  if (screenIndex < 0) {
    return refused(session, 'screen-not-found');
  }
  const screen = session.graph.screens[screenIndex]!;
  if (command.type === 'add-node') {
    return addNode(session, screenIndex, screen, command.node);
  }
  const nodeIndex = screen.nodes.findIndex(node => node.id === command.nodeId);
  if (nodeIndex < 0) {
    return refused(session, 'node-not-found');
  }
  const node = screen.nodes[nodeIndex]!;
  if (command.type === 'delete-node') {
    return deleteNode(session, screenIndex, screen, node);
  }
  const changed = applyNodeCommand(screen, node, command);
  if (!changed.ok) {
    return refused(session, changed.reason);
  }
  if (sameNode(node, changed.node)) {
    return refused(session, 'no-change');
  }

  const nextGraph = cloneGraph(session.graph);
  nextGraph.revision = session.graph.revision + 1;
  nextGraph.screens[screenIndex]!.nodes[nodeIndex] = changed.node;
  return {
    ok: true,
    session: {
      graph: nextGraph,
      undo: [...session.undo, cloneGraph(session.graph)].slice(-UI_EDIT_HISTORY_LIMIT),
      redo: [],
    },
  };
}

type NodeCommandResult =
  | { ok: true; node: UiDesignNode }
  | { ok: false; reason: UiEditRefusalReason };

function applyNodeCommand(
  screen: UiDesignScreen,
  node: UiDesignNode,
  command: Exclude<UiEditCommand, { type: 'undo' | 'redo' | 'add-node' | 'delete-node' }>,
): NodeCommandResult {
  switch (command.type) {
    case 'set-node-kind': {
      if (!isWireframeElementKind(command.kind)) {
        return { ok: false, reason: 'invalid-command' };
      }
      if (!wireframeKindSpec(command.kind).container
          && screen.nodes.some(candidate => candidate.parentId === node.id)) {
        return { ok: false, reason: 'parent-cannot-contain' };
      }
      return { ok: true, node: withRect({ ...node, kind: command.kind }, node.layout.rect) };
    }
    case 'set-node-frame': {
      if (!validRect(command.rect)
          || (command.parentId !== null && !validIdentifier(command.parentId))) {
        return { ok: false, reason: 'invalid-command' };
      }
      return reparentNode(screen, withRect(node, command.rect), command.parentId ?? undefined);
    }
    case 'set-node-label': {
      if (typeof command.label !== 'string' || command.label.length > 120) {
        return { ok: false, reason: 'invalid-command' };
      }
      const label = command.label.trim();
      if (!label) {
        return { ok: false, reason: 'invalid-command' };
      }
      return { ok: true, node: { ...node, label } };
    }
    case 'set-node-design-prompt': {
      if (typeof command.designPrompt !== 'string' || command.designPrompt.length > 1_000) {
        return { ok: false, reason: 'invalid-command' };
      }
      return { ok: true, node: { ...node, designPrompt: command.designPrompt.trim() } };
    }
    case 'move-node': {
      if (!finite(command.x) || !finite(command.y)) {
        return { ok: false, reason: 'invalid-command' };
      }
      return {
        ok: true,
        node: withRect(node, {
          ...node.layout.rect,
          x: command.x,
          y: command.y,
        }),
      };
    }
    case 'resize-node': {
      if (!finite(command.width) || !finite(command.height)
          || command.width <= 0 || command.height <= 0) {
        return { ok: false, reason: 'invalid-command' };
      }
      return {
        ok: true,
        node: withRect(node, {
          ...node.layout.rect,
          width: command.width,
          height: command.height,
        }),
      };
    }
    case 'set-node-hidden': {
      if (typeof command.hidden !== 'boolean') {
        return { ok: false, reason: 'invalid-command' };
      }
      return { ok: true, node: { ...node, layout: { ...node.layout, hidden: command.hidden } } };
    }
    case 'set-node-viewport-override': {
      if (!isBreakpoint(command.breakpoint)
          || command.breakpoint === screen.baseBreakpoint
          || (command.rect === undefined && command.hidden === undefined)
          || (command.rect !== undefined && !validRect(command.rect))
          || (command.hidden !== undefined && typeof command.hidden !== 'boolean')) {
        return { ok: false, reason: 'invalid-command' };
      }
      const current = node.viewportOverrides[command.breakpoint] ?? {};
      const override = {
        ...current,
        ...(command.rect
          ? { rect: sanitizeRect(command.rect, wireframeKindSpec(node.kind)) }
          : {}),
        ...(command.hidden !== undefined ? { hidden: command.hidden } : {}),
      };
      return {
        ok: true,
        node: {
          ...node,
          viewportOverrides: { ...node.viewportOverrides, [command.breakpoint]: override },
        },
      };
    }
    case 'clear-node-viewport-override': {
      if (!isBreakpoint(command.breakpoint)
          || command.breakpoint === screen.baseBreakpoint
          || (command.property !== undefined && !isOverrideProperty(command.property))) {
        return { ok: false, reason: 'invalid-command' };
      }
      const viewportOverrides = { ...node.viewportOverrides };
      const property = command.property ?? 'all';
      const existing = viewportOverrides[command.breakpoint];
      if (existing && property !== 'all') {
        const remaining = { ...existing };
        delete remaining[property];
        if (remaining.rect === undefined && remaining.hidden === undefined) {
          delete viewportOverrides[command.breakpoint];
        } else {
          viewportOverrides[command.breakpoint] = remaining;
        }
      } else {
        delete viewportOverrides[command.breakpoint];
      }
      return { ok: true, node: { ...node, viewportOverrides } };
    }
    case 'reparent-node':
      return reparentNode(screen, node, command.parentId);
  }
}

function addNode(
  session: UiEditSession,
  screenIndex: number,
  screen: UiDesignScreen,
  input: UiNewNode,
): UiEditResult {
  if (screen.nodes.length >= MAX_WIREFRAME_ELEMENTS
      || !validIdentifier(input.id)
      || screen.nodes.some(node => node.id === input.id)
      || !isWireframeElementKind(input.kind)
      || typeof input.label !== 'string'
      || input.label.trim().length === 0
      || input.label.length > 120
      || typeof input.designPrompt !== 'string'
      || input.designPrompt.length > 1_000
      || typeof input.notes !== 'string'
      || input.notes.length > 1_000
      || !validRect(input.rect)
      || (input.parentId !== undefined && !validIdentifier(input.parentId))) {
    return refused(session, 'invalid-command');
  }
  const draft: UiDesignNode = {
    id: input.id,
    kind: input.kind,
    label: input.label.trim(),
    layout: {
      mode: 'free',
      rect: sanitizeRect(input.rect, wireframeKindSpec(input.kind)),
      widthMode: 'fixed',
      heightMode: 'fixed',
      hidden: false,
    },
    viewportOverrides: {},
    designPrompt: input.designPrompt.trim(),
    notes: input.notes.trim(),
  };
  const parented = reparentNode(screen, draft, input.parentId);
  if (!parented.ok) {
    return refused(session, parented.reason);
  }
  return commitScreen(session, screenIndex, {
    ...screen,
    initialized: true,
    nodes: [...screen.nodes, parented.node],
  });
}

function deleteNode(
  session: UiEditSession,
  screenIndex: number,
  screen: UiDesignScreen,
  node: UiDesignNode,
): UiEditResult {
  const nodes = screen.nodes
    .filter(candidate => candidate.id !== node.id)
    .map(candidate => candidate.parentId === node.id
      ? node.parentId
        ? { ...candidate, parentId: node.parentId }
        : withoutParent(candidate)
      : candidate);
  return commitScreen(session, screenIndex, { ...screen, initialized: true, nodes });
}

function withoutParent(node: UiDesignNode): UiDesignNode {
  const { parentId: _removed, ...root } = node;
  return root;
}

function commitScreen(
  session: UiEditSession,
  screenIndex: number,
  screen: UiDesignScreen,
): UiEditResult {
  const nextGraph = cloneGraph(session.graph);
  nextGraph.revision = session.graph.revision + 1;
  nextGraph.screens[screenIndex] = screen;
  return {
    ok: true,
    session: {
      graph: nextGraph,
      undo: [...session.undo, cloneGraph(session.graph)].slice(-UI_EDIT_HISTORY_LIMIT),
      redo: [],
    },
  };
}

function reparentNode(
  screen: UiDesignScreen,
  node: UiDesignNode,
  parentId: string | undefined,
): NodeCommandResult {
  if (parentId === undefined) {
    const { parentId: _removed, ...rootNode } = node;
    return { ok: true, node: rootNode };
  }
  if (typeof parentId !== 'string' || !/^[a-zA-Z0-9._-]{1,120}$/.test(parentId)) {
    return { ok: false, reason: 'invalid-command' };
  }
  const parent = screen.nodes.find(candidate => candidate.id === parentId);
  if (!parent) {
    return { ok: false, reason: 'parent-not-found' };
  }
  if (parent.id === node.id) {
    return { ok: false, reason: 'parent-cycle' };
  }
  if (!wireframeKindSpec(parent.kind).container) {
    return { ok: false, reason: 'parent-cannot-contain' };
  }

  const byId = new Map(screen.nodes.map(candidate => [candidate.id, candidate]));
  const seen = new Set<string>([node.id]);
  let cursor: UiDesignNode | undefined = parent;
  let depth = 0;
  while (cursor) {
    if (seen.has(cursor.id)) {
      return { ok: false, reason: 'parent-cycle' };
    }
    seen.add(cursor.id);
    depth += 1;
    if (depth >= MAX_WIREFRAME_DEPTH) {
      return { ok: false, reason: 'parent-depth' };
    }
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return { ok: true, node: { ...node, parentId } };
}

function restoreHistory(session: UiEditSession, direction: 'undo' | 'redo'): UiEditResult {
  const source = direction === 'undo' ? session.undo : session.redo;
  const target = direction === 'undo' ? session.redo : session.undo;
  const snapshot = source[source.length - 1];
  if (!snapshot) {
    return refused(session, 'history-empty');
  }
  const restored = cloneGraph(snapshot);
  restored.revision = session.graph.revision + 1;
  const nextTarget = [...target, cloneGraph(session.graph)].slice(-UI_EDIT_HISTORY_LIMIT);
  return {
    ok: true,
    session: direction === 'undo'
      ? { graph: restored, undo: source.slice(0, -1), redo: nextTarget }
      : { graph: restored, undo: nextTarget, redo: source.slice(0, -1) },
  };
}

function withRect(node: UiDesignNode, rect: WireframeRect): UiDesignNode {
  const bounded = sanitizeRect(rect, wireframeKindSpec(node.kind));
  return { ...node, layout: { ...node.layout, rect: bounded } };
}

function sameNode(left: UiDesignNode, right: UiDesignNode): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function refused(session: UiEditSession, reason: UiEditRefusalReason): UiEditResult {
  return { ok: false, reason, session };
}

function finite(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= -WIREFRAME_CANVAS_WIDTH - WIREFRAME_CANVAS_HEIGHT
    && value <= WIREFRAME_CANVAS_WIDTH + WIREFRAME_CANVAS_HEIGHT;
}

function validRect(value: WireframeRect): boolean {
  return finite(value.x)
    && finite(value.y)
    && finite(value.width)
    && finite(value.height)
    && value.width > 0
    && value.height > 0;
}

function parseRect(input: unknown): WireframeRect | undefined {
  if (!isRecord(input)
      || !exactKeys(input, ['x', 'y', 'width', 'height'])) {
    return undefined;
  }
  const rect = {
    x: input['x'],
    y: input['y'],
    width: input['width'],
    height: input['height'],
  };
  return validRect(rect as WireframeRect) ? rect as WireframeRect : undefined;
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9._-]{1,120}$/.test(value);
}

function isBreakpoint(value: unknown): value is WireframeBreakpoint {
  return WIREFRAME_BREAKPOINTS.includes(value as WireframeBreakpoint);
}

function isOverrideProperty(value: unknown): value is UiViewportOverrideProperty {
  return value === 'rect' || value === 'hidden' || value === 'all';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every(key => Object.prototype.hasOwnProperty.call(record, key))
    && Object.keys(record).every(key => allowed.has(key));
}

function cloneGraph(graph: UiDesignGraph): UiDesignGraph {
  return {
    revision: graph.revision,
    screens: graph.screens.map(screen => ({
      ...screen,
      nodes: screen.nodes.map(node => ({
        ...node,
        layout: { ...node.layout, rect: { ...node.layout.rect } },
        viewportOverrides: Object.fromEntries(
          Object.entries(node.viewportOverrides).map(([breakpoint, override]) => [
            breakpoint,
            override ? { ...override, ...(override.rect ? { rect: { ...override.rect } } : {}) } : override,
          ]),
        ),
      })),
    })),
  };
}
