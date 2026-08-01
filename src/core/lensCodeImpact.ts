import type {
  LensCodeImpact,
  LensCodeImpactCategory,
  LensCodeImpactItem,
  LensGraph,
  LensGraphEdge,
  LensGraphNode,
} from '../types.js';
import { normalizeLensGraph } from './lensGraph.js';
import { normalizeLensTarget } from './lensTarget.js';

export const LENS_CODE_IMPACT_MAX_ITEMS = 80;

const CATEGORY_ORDER: Record<LensCodeImpactCategory, number> = {
  'upstream-caller': 0,
  'consumer-reference': 1,
  'downstream-callee': 2,
};

/**
 * Project a bounded language-service graph into a deterministic change-impact map.
 * This initial adapter is deliberately code-only: undiscovered tests, contracts,
 * configuration, documentation, and runtime paths remain named unknowns.
 */
export function analyzeLensCodeImpact(candidate: unknown): LensCodeImpact {
  const graph = normalizeLensGraph(candidate);
  if (!graph) {
    throw new Error('AtlasMind Lens refused an invalid possible-flow graph for change-impact analysis.');
  }
  const rootNode = graph.nodes.find(node => node.id === graph.rootNodeId);
  if (!rootNode) {
    throw new Error('AtlasMind Lens could not resolve the change-impact root.');
  }

  const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
  const itemByKey = new Map<string, LensCodeImpactItem>();
  for (const edge of graph.edges) {
    const classified = classifyEdge(edge, rootNode, nodeById);
    if (!classified) {
      continue;
    }
    const key = `${classified.category}:${classified.node.id}`;
    const item = buildItem(graph, rootNode, edge, classified.node, classified.category);
    const existing = itemByKey.get(key);
    if (!existing || item.proximity < existing.proximity) {
      itemByKey.set(key, item);
    }
  }

  const ranked = [...itemByKey.values()].sort((left, right) =>
    CATEGORY_ORDER[left.category] - CATEGORY_ORDER[right.category] ||
    left.proximity - right.proximity ||
    left.target.workspacePath.localeCompare(right.target.workspacePath) ||
    left.target.label.localeCompare(right.target.label) ||
    left.id.localeCompare(right.id),
  );
  const truncated = graph.truncated || ranked.length > LENS_CODE_IMPACT_MAX_ITEMS;
  return {
    version: 1,
    id: `lens-code-impact:${stableHash(graph.id)}`,
    label: `${rootNode.target.label} change impact`,
    root: rootNode.target,
    items: ranked.slice(0, LENS_CODE_IMPACT_MAX_ITEMS),
    notices: [
      ...graph.notices,
      'This first Change Impact Map contains static language-service callers, callees, and references only.',
      'Contracts, schemas, configuration, documentation, tests, and runtime reachability remain unknown until their Lens adapters contribute evidence.',
      'A missing item is missing evidence, not proof that no other impact exists.',
      'Opening this map invokes no model, runs no project code, and makes no source edits.',
      ...(truncated ? ['The source graph or impact list reached its published budget; this is a bounded partial view.'] : []),
    ].slice(0, 50),
    truncated,
  };
}

function classifyEdge(
  edge: LensGraphEdge,
  root: LensGraphNode,
  nodeById: Map<string, LensGraphNode>,
): { category: LensCodeImpactCategory; node: LensGraphNode } | undefined {
  if (edge.relation === 'calls' && edge.toNodeId === root.id) {
    const node = nodeById.get(edge.fromNodeId);
    return node && node.id !== root.id ? { category: 'upstream-caller', node } : undefined;
  }
  if (edge.relation === 'calls') {
    const node = nodeById.get(edge.toNodeId);
    return node && node.id !== root.id && node.role === 'callee'
      ? { category: 'downstream-callee', node }
      : undefined;
  }
  if (edge.relation === 'references' && edge.fromNodeId === root.id) {
    const node = nodeById.get(edge.toNodeId);
    return node && node.id !== root.id ? { category: 'consumer-reference', node } : undefined;
  }
  return undefined;
}

function buildItem(
  graph: LensGraph,
  root: LensGraphNode,
  edge: LensGraphEdge,
  node: LensGraphNode,
  category: LensCodeImpactCategory,
): LensCodeImpactItem {
  const proximity = category === 'downstream-callee'
    ? Math.max(1, node.depth - root.depth)
    : 1;
  const reason = category === 'upstream-caller'
    ? `${node.target.label} may call the selected symbol ${root.target.label}.`
    : category === 'downstream-callee'
      ? `${root.target.label}'s possible flow may reach ${node.target.label} at call depth ${proximity}.`
      : `${node.target.label} is a source reference returned for the selected symbol ${root.target.label}.`;
  const id = `lens-code-impact-item:${stableHash(`${graph.id}:${category}:${node.id}:${edge.id}`)}`;
  const target = normalizeLensTarget({
    ...node.target,
    id,
    kind: 'relation',
    detail: reason,
    evidence: edge.evidence,
  });
  if (!target) {
    throw new Error('AtlasMind Lens refused an invalid source target in a change-impact item.');
  }
  return {
    id,
    category,
    relation: edge.relation,
    proximity,
    target,
    reason,
    evidence: edge.evidence,
  };
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
