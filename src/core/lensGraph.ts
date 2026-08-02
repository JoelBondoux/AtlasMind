import type {
  LensEvidence,
  LensEvidenceKind,
  LensGraph,
  LensGraphEdge,
  LensGraphMode,
  LensGraphNode,
  LensGraphNodeRole,
  LensGraphRelation,
} from '../types.js';
import { normalizeLensTarget } from './lensTarget.js';

const GRAPH_MODES = new Set<LensGraphMode>(['possible', 'observed', 'inferred']);
const NODE_ROLES = new Set<LensGraphNodeRole>(['entrypoint', 'caller', 'callee', 'reference']);
const RELATIONS = new Set<LensGraphRelation>(['calls', 'references']);
const EVIDENCE_KINDS = new Set<LensEvidenceKind>(['source', 'runtime', 'framework', 'declared', 'inferred']);

export const LENS_GRAPH_MAX_NODES = 80;
export const LENS_GRAPH_MAX_EDGES = 160;
export const LENS_GRAPH_MAX_NOTICES = 20;

const MAX_ID = 500;
const MAX_LABEL = 240;
const MAX_NOTICE = 400;
const MAX_EVIDENCE_SOURCE = 160;
const MAX_DEPTH = 10;

/** Normalize a graph before it crosses into a Lens webview or chat context. */
export function normalizeLensGraph(value: unknown): LensGraph | undefined {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    return undefined;
  }
  const id = boundedExactText(value.id, MAX_ID);
  const label = boundedText(value.label, MAX_LABEL);
  const mode = typeof value.mode === 'string' && GRAPH_MODES.has(value.mode as LensGraphMode)
    ? value.mode as LensGraphMode
    : undefined;
  const rootNodeId = boundedExactText(value.rootNodeId, MAX_ID);
  if (!id || !label || !mode || !rootNodeId) {
    return undefined;
  }

  const nodes: LensGraphNode[] = [];
  const nodeIds = new Set<string>();
  for (const candidate of value.nodes.slice(0, LENS_GRAPH_MAX_NODES)) {
    const node = normalizeNode(candidate);
    if (!node || nodeIds.has(node.id)) {
      continue;
    }
    nodeIds.add(node.id);
    nodes.push(node);
  }
  if (!nodeIds.has(rootNodeId)) {
    return undefined;
  }

  const edges: LensGraphEdge[] = [];
  const edgeIds = new Set<string>();
  for (const candidate of value.edges.slice(0, LENS_GRAPH_MAX_EDGES)) {
    const edge = normalizeEdge(candidate);
    if (
      !edge ||
      edgeIds.has(edge.id) ||
      !nodeIds.has(edge.fromNodeId) ||
      !nodeIds.has(edge.toNodeId)
    ) {
      continue;
    }
    edgeIds.add(edge.id);
    edges.push(edge);
  }

  const notices = Array.isArray(value.notices)
    ? value.notices
      .slice(0, LENS_GRAPH_MAX_NOTICES)
      .map(notice => boundedText(notice, MAX_NOTICE))
      .filter((notice): notice is string => Boolean(notice))
    : [];
  return {
    version: 1,
    id,
    label,
    mode,
    rootNodeId,
    nodes,
    edges,
    notices,
    truncated: value.truncated === true ||
      value.nodes.length > LENS_GRAPH_MAX_NODES ||
      value.edges.length > LENS_GRAPH_MAX_EDGES,
  };
}

function normalizeNode(value: unknown): LensGraphNode | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = boundedExactText(value.id, MAX_ID);
  const target = normalizeLensTarget(value.target);
  const role = typeof value.role === 'string' && NODE_ROLES.has(value.role as LensGraphNodeRole)
    ? value.role as LensGraphNodeRole
    : undefined;
  const depth = boundedInteger(value.depth, 0, MAX_DEPTH);
  if (!id || !target || !role || depth === undefined || id !== target.id) {
    return undefined;
  }
  return { id, target, role, depth };
}

function normalizeEdge(value: unknown): LensGraphEdge | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = boundedExactText(value.id, MAX_ID);
  const fromNodeId = boundedExactText(value.fromNodeId, MAX_ID);
  const toNodeId = boundedExactText(value.toNodeId, MAX_ID);
  const relation = typeof value.relation === 'string' && RELATIONS.has(value.relation as LensGraphRelation)
    ? value.relation as LensGraphRelation
    : undefined;
  const evidence = normalizeEvidence(value.evidence);
  return id && fromNodeId && toNodeId && relation && evidence
    ? { id, fromNodeId, toNodeId, relation, evidence }
    : undefined;
}

function normalizeEvidence(value: unknown): LensEvidence | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const kind = typeof value.kind === 'string' && EVIDENCE_KINDS.has(value.kind as LensEvidenceKind)
    ? value.kind as LensEvidenceKind
    : undefined;
  const source = boundedText(value.source, MAX_EVIDENCE_SOURCE);
  if (!kind || !source) {
    return undefined;
  }
  const confidence = typeof value.confidence === 'number' && Number.isFinite(value.confidence)
    ? Math.max(0, Math.min(1, value.confidence))
    : undefined;
  return { kind, source, ...(confidence !== undefined ? { confidence } : {}) };
}

function boundedExactText(value: unknown, maximum: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : undefined;
}

function boundedText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maximum) : undefined;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
