import * as vscode from 'vscode';

import {
  LENS_GRAPH_MAX_EDGES,
  LENS_GRAPH_MAX_NODES,
  normalizeLensGraph,
} from '../core/lensGraph.js';
import { createSourceLensTarget, normalizeLensTarget } from '../core/lensTarget.js';
import type {
  LensGraph,
  LensGraphEdge,
  LensGraphNode,
  LensGraphNodeRole,
  LensGraphRelation,
  LensSourceRange,
  LensVisualTarget,
} from '../types.js';

const OUTGOING_DEPTH = 2;
const POSSIBLE_FLOW_NOTICE = 'Static language-service relationships are possible flow, not observed execution.';

interface CallHierarchyItemRecord {
  value: Record<string, unknown>;
  uri: vscode.Uri;
  range: LensSourceRange;
  selectionRange: LensSourceRange;
  name: string;
  detail?: string;
  symbolKind: string;
}

interface GraphAccumulator {
  nodes: LensGraphNode[];
  edges: LensGraphEdge[];
  nodeIdByLocation: Map<string, string>;
  edgeIds: Set<string>;
  truncated: boolean;
}

/** Uses VS Code language providers to build a bounded, static possible-flow graph. */
export class LensLanguageGraphAdapter {
  public async buildPossibleFlow(candidate: LensVisualTarget, uri: vscode.Uri): Promise<LensGraph> {
    const root = normalizeLensTarget(candidate);
    if (!root || !root.range || !isMatchingWorkspaceUri(uri, root)) {
      throw new Error('AtlasMind Lens refused an invalid journey root.');
    }
    const accumulator: GraphAccumulator = {
      nodes: [{ id: root.id, target: root, role: 'entrypoint', depth: 1 }],
      edges: [],
      nodeIdByLocation: new Map([[targetLocationKey(root), root.id]]),
      edgeIds: new Set(),
      truncated: false,
    };
    const notices = [POSSIBLE_FLOW_NOTICE];
    const position = new vscode.Position(root.range.startLine - 1, root.range.startColumn - 1);

    const prepared = await safeLanguageCommand('vscode.prepareCallHierarchy', uri, position);
    if (prepared.failed) {
      notices.push('Call hierarchy unavailable for this symbol; references may still be shown.');
    } else {
      const rootItem = prepared.items.map(toCallHierarchyItem).find((item): item is CallHierarchyItemRecord => Boolean(item));
      if (rootItem) {
        await this.addIncomingCalls(rootItem, root, accumulator, notices);
        await this.addOutgoingCalls(rootItem, root.id, 1, accumulator, notices);
      } else {
        notices.push('The active language provider returned no call hierarchy for this symbol.');
      }
    }

    const references = await safeLanguageCommand('vscode.executeReferenceProvider', uri, position);
    if (references.failed) {
      notices.push('References unavailable for this symbol.');
    } else {
      for (const candidateLocation of references.items) {
        const location = toLocation(candidateLocation);
        const reference = location ? createLocationTarget(location.uri, location.range) : undefined;
        if (!reference) {
          continue;
        }
        const referenceId = addNode(accumulator, reference, 'reference', 2);
        if (referenceId && referenceId !== root.id) {
          addEdge(accumulator, root.id, referenceId, 'references', 'VS Code reference provider');
        }
      }
    }

    const graph = normalizeLensGraph({
      version: 1,
      id: `lens-journey:${stableHash(root.id)}`,
      label: `${root.label} journey`,
      mode: 'possible',
      rootNodeId: root.id,
      nodes: accumulator.nodes,
      edges: accumulator.edges,
      notices,
      truncated: accumulator.truncated,
    });
    if (!graph) {
      throw new Error('AtlasMind Lens could not build a safe journey graph.');
    }
    return graph;
  }

  private async addIncomingCalls(
    rootItem: CallHierarchyItemRecord,
    root: LensVisualTarget,
    accumulator: GraphAccumulator,
    notices: string[],
  ): Promise<void> {
    const incoming = await safeLanguageCommand('vscode.provideIncomingCalls', rootItem.value);
    if (incoming.failed) {
      notices.push('Incoming calls unavailable for this symbol.');
      return;
    }
    for (const candidate of incoming.items) {
      const item = isRecord(candidate) ? toCallHierarchyItem(candidate.from) : undefined;
      const target = item ? createCallTarget(item) : undefined;
      if (!target) {
        continue;
      }
      const callerId = addNode(accumulator, target, 'caller', 0);
      if (callerId) {
        addEdge(accumulator, callerId, root.id, 'calls', 'VS Code call hierarchy');
      }
    }
  }

  private async addOutgoingCalls(
    item: CallHierarchyItemRecord,
    fromNodeId: string,
    depth: number,
    accumulator: GraphAccumulator,
    notices: string[],
  ): Promise<void> {
    if (depth > OUTGOING_DEPTH || accumulator.nodes.length >= LENS_GRAPH_MAX_NODES) {
      accumulator.truncated = true;
      return;
    }
    const outgoing = await safeLanguageCommand('vscode.provideOutgoingCalls', item.value);
    if (outgoing.failed) {
      if (!notices.includes('Some outgoing calls were unavailable from the active language provider.')) {
        notices.push('Some outgoing calls were unavailable from the active language provider.');
      }
      return;
    }
    for (const candidate of outgoing.items) {
      const child = isRecord(candidate) ? toCallHierarchyItem(candidate.to) : undefined;
      const target = child ? createCallTarget(child) : undefined;
      if (!child || !target) {
        continue;
      }
      const before = accumulator.nodes.length;
      const childId = addNode(accumulator, target, 'callee', depth + 1);
      if (!childId) {
        continue;
      }
      addEdge(accumulator, fromNodeId, childId, 'calls', 'VS Code call hierarchy');
      if (accumulator.nodes.length > before && depth < OUTGOING_DEPTH) {
        await this.addOutgoingCalls(child, childId, depth + 1, accumulator, notices);
      }
    }
  }
}

function addNode(
  accumulator: GraphAccumulator,
  target: LensVisualTarget,
  role: LensGraphNodeRole,
  depth: number,
): string | undefined {
  const key = targetLocationKey(target);
  const existing = accumulator.nodeIdByLocation.get(key);
  if (existing) {
    return existing;
  }
  if (accumulator.nodes.length >= LENS_GRAPH_MAX_NODES) {
    accumulator.truncated = true;
    return undefined;
  }
  accumulator.nodeIdByLocation.set(key, target.id);
  accumulator.nodes.push({ id: target.id, target, role, depth });
  return target.id;
}

function addEdge(
  accumulator: GraphAccumulator,
  fromNodeId: string,
  toNodeId: string,
  relation: LensGraphRelation,
  source: string,
): void {
  const id = `lens-edge:${relation}:${stableHash(`${fromNodeId}:${toNodeId}`)}`;
  if (accumulator.edgeIds.has(id)) {
    return;
  }
  if (accumulator.edges.length >= LENS_GRAPH_MAX_EDGES) {
    accumulator.truncated = true;
    return;
  }
  accumulator.edgeIds.add(id);
  accumulator.edges.push({
    id,
    fromNodeId,
    toNodeId,
    relation,
    evidence: { kind: 'source', source, confidence: 1 },
  });
}

function createCallTarget(item: CallHierarchyItemRecord): LensVisualTarget | undefined {
  const source = workspaceSource(item.uri);
  if (!source) {
    return undefined;
  }
  try {
    return createSourceLensTarget({
      kind: 'symbol',
      label: item.name,
      detail: item.detail,
      workspace: source.workspace,
      workspacePath: source.workspacePath,
      range: item.range,
      symbolKind: item.symbolKind,
    });
  } catch {
    return undefined;
  }
}

function createLocationTarget(uri: vscode.Uri, range: LensSourceRange): LensVisualTarget | undefined {
  const source = workspaceSource(uri);
  if (!source) {
    return undefined;
  }
  const fileName = source.workspacePath.split('/').at(-1) ?? source.workspacePath;
  try {
    return createSourceLensTarget({
      kind: 'code-range',
      label: `${fileName}:${range.startLine}`,
      workspace: source.workspace,
      workspacePath: source.workspacePath,
      range,
    });
  } catch {
    return undefined;
  }
}

function workspaceSource(uri: vscode.Uri): {
  workspace: { name: string; index: number };
  workspacePath: string;
} | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) {
    return undefined;
  }
  const workspacePath = normalizeRelativePath(vscode.workspace.asRelativePath(uri, false));
  return workspacePath
    ? { workspace: { name: folder.name, index: folder.index }, workspacePath }
    : undefined;
}

function toCallHierarchyItem(value: unknown): CallHierarchyItemRecord | undefined {
  if (
    !isRecord(value) ||
    typeof value.name !== 'string' ||
    typeof value.kind !== 'number' ||
    !isUri(value.uri)
  ) {
    return undefined;
  }
  const range = toSourceRange(value.range);
  const selectionRange = toSourceRange(value.selectionRange) ?? range;
  if (!range || !selectionRange) {
    return undefined;
  }
  return {
    value,
    uri: value.uri,
    range,
    selectionRange,
    name: value.name,
    ...(typeof value.detail === 'string' && value.detail.trim() ? { detail: value.detail } : {}),
    symbolKind: vscode.SymbolKind[value.kind] ?? 'Unknown',
  };
}

function toLocation(value: unknown): { uri: vscode.Uri; range: LensSourceRange } | undefined {
  if (!isRecord(value) || !isUri(value.uri)) {
    return undefined;
  }
  const range = toSourceRange(value.range);
  return range ? { uri: value.uri, range } : undefined;
}

function toSourceRange(value: unknown): LensSourceRange | undefined {
  if (!isRecord(value) || !isPosition(value.start) || !isPosition(value.end)) {
    return undefined;
  }
  return {
    startLine: value.start.line + 1,
    startColumn: value.start.character + 1,
    endLine: value.end.line + 1,
    endColumn: value.end.character + 1,
  };
}

async function safeLanguageCommand(command: string, ...args: unknown[]): Promise<{ items: unknown[]; failed: boolean }> {
  try {
    const result = await vscode.commands.executeCommand<unknown>(command, ...args);
    return { items: Array.isArray(result) ? result : [], failed: false };
  } catch {
    return { items: [], failed: true };
  }
}

function isMatchingWorkspaceUri(uri: vscode.Uri, target: LensVisualTarget): boolean {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  return Boolean(
    folder &&
    folder.name === target.workspace.name &&
    folder.index === target.workspace.index &&
    normalizeRelativePath(vscode.workspace.asRelativePath(uri, false)) === target.workspacePath,
  );
}

function targetLocationKey(target: LensVisualTarget): string {
  const range = target.range
    ? `${target.range.startLine}:${target.range.startColumn}-${target.range.endLine}:${target.range.endColumn}`
    : 'file';
  return `${target.workspace.index}:${target.workspace.name}:${target.workspacePath}:${range}`;
}

function normalizeRelativePath(value: string): string | undefined {
  const normalized = value.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    return undefined;
  }
  const segments = normalized.split('/');
  return segments.some(segment => !segment || segment === '.' || segment === '..')
    ? undefined
    : segments.join('/');
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function isUri(value: unknown): value is vscode.Uri {
  return isRecord(value) && typeof value.scheme === 'string' && typeof value.path === 'string';
}

function isPosition(value: unknown): value is { line: number; character: number } {
  return isRecord(value) &&
    typeof value.line === 'number' && Number.isInteger(value.line) && value.line >= 0 &&
    typeof value.character === 'number' && Number.isInteger(value.character) && value.character >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
