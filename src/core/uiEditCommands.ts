/**
 * Closed, revision-checked mutations for UI Studio's design graph.
 *
 * Pointer gestures, forms, preview events, and model proposals must all become
 * one of these commands. The reducer is pure: it does not persist, render, call
 * a model, or infer intent. A refusal returns the original session unchanged.
 */

import type { UiDesignGraph, UiDesignNode, UiDesignScreen, WireframeRect } from '../types.js';
import {
  sanitizeRect,
  wireframeKindSpec,
  WIREFRAME_CANVAS_HEIGHT,
  WIREFRAME_CANVAS_WIDTH,
  MAX_WIREFRAME_DEPTH,
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

export type UiEditCommand =
  | (UiNodeCommandBase & { type: 'set-node-label'; label: string })
  | (UiNodeCommandBase & { type: 'set-node-design-prompt'; designPrompt: string })
  | (UiNodeCommandBase & { type: 'move-node'; x: number; y: number })
  | (UiNodeCommandBase & { type: 'resize-node'; width: number; height: number })
  | (UiNodeCommandBase & { type: 'reparent-node'; parentId?: string })
  | (UiNodeCommandBase & { type: 'set-node-hidden'; hidden: boolean })
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
  const nodeIndex = screen.nodes.findIndex(node => node.id === command.nodeId);
  if (nodeIndex < 0) {
    return refused(session, 'node-not-found');
  }
  const node = screen.nodes[nodeIndex]!;
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
  command: Exclude<UiEditCommand, { type: 'undo' | 'redo' }>,
): NodeCommandResult {
  switch (command.type) {
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
    case 'reparent-node':
      return reparentNode(screen, node, command.parentId);
  }
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

function finite(value: number): boolean {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= -WIREFRAME_CANVAS_WIDTH - WIREFRAME_CANVAS_HEIGHT
    && value <= WIREFRAME_CANVAS_WIDTH + WIREFRAME_CANVAS_HEIGHT;
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
