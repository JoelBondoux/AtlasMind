import type {
  LensGraph,
  LensGraphEdge,
  LensGraphNode,
  LensTestEvidenceItem,
  LensTestKind,
  LensTestMap,
} from '../types.js';
import { normalizeLensGraph } from './lensGraph.js';
import { normalizeLensTarget } from './lensTarget.js';

export const LENS_TEST_MAP_MAX_ITEMS = 80;

const KIND_ORDER: Record<LensTestKind, number> = {
  unit: 0,
  integration: 1,
  contract: 2,
  'end-to-end': 3,
  unknown: 4,
};

interface TestPathClassification {
  kind: LensTestKind;
  source: string;
}

/**
 * Find test-like callers and references in an already bounded language graph.
 * Filename/folder signals are classification evidence, not proof of assertions,
 * execution, coverage, or behaviour.
 */
export function analyzeLensTestMap(candidate: unknown): LensTestMap {
  const graph = normalizeLensGraph(candidate);
  if (!graph) {
    throw new Error('AtlasMind Lens refused an invalid possible-flow graph for test mapping.');
  }
  const root = graph.nodes.find(node => node.id === graph.rootNodeId);
  if (!root) {
    throw new Error('AtlasMind Lens could not resolve the test-map root.');
  }
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const itemByNodeId = new Map<string, LensTestEvidenceItem>();
  for (const edge of graph.edges) {
    const linked = linkedTestNode(edge, root, nodes);
    if (!linked) {
      continue;
    }
    const classification = classifyTestPath(linked.target.workspacePath);
    if (!classification) {
      continue;
    }
    const item = buildItem(graph, root, linked, edge, classification);
    const existing = itemByNodeId.get(linked.id);
    if (!existing || (item.link === 'calls' && existing.link !== 'calls')) {
      itemByNodeId.set(linked.id, item);
    }
  }

  const ranked = [...itemByNodeId.values()].sort((left, right) =>
    KIND_ORDER[left.testKind] - KIND_ORDER[right.testKind] ||
    (left.link === right.link ? 0 : left.link === 'calls' ? -1 : 1) ||
    left.target.workspacePath.localeCompare(right.target.workspacePath) ||
    left.target.label.localeCompare(right.target.label) ||
    left.id.localeCompare(right.id),
  );
  const truncated = graph.truncated || ranked.length > LENS_TEST_MAP_MAX_ITEMS;
  return {
    version: 1,
    id: `lens-test-map:${stableHash(graph.id)}`,
    label: `${root.target.label} test & behaviour evidence`,
    root: root.target,
    items: ranked.slice(0, LENS_TEST_MAP_MAX_ITEMS),
    notices: [
      ...graph.notices,
      'Path classification is a conservative signal from test-like filenames and folders; it does not inspect assertions or prove a test kind.',
      'No discovered test item is not proof that the symbol is untested or that a behaviour lacks coverage.',
      'This map does not execute tests, read coverage output, infer pass/fail state, or claim runtime behaviour.',
      'Production references that do not carry an explicit test path signal are omitted from this test-focused view.',
      ...(truncated ? ['The source graph or test evidence reached its published budget; this is a bounded partial view.'] : []),
    ].slice(0, 50),
    truncated,
  };
}

function linkedTestNode(
  edge: LensGraphEdge,
  root: LensGraphNode,
  nodes: Map<string, LensGraphNode>,
): LensGraphNode | undefined {
  if (edge.relation === 'calls' && edge.toNodeId === root.id) {
    const node = nodes.get(edge.fromNodeId);
    return node?.id === root.id ? undefined : node;
  }
  if (edge.relation === 'references' && edge.fromNodeId === root.id) {
    const node = nodes.get(edge.toNodeId);
    return node?.id === root.id ? undefined : node;
  }
  return undefined;
}

function classifyTestPath(workspacePath: string): TestPathClassification | undefined {
  const path = workspacePath.toLowerCase();
  const segments = path.split('/');
  const fileName = segments.at(-1) ?? path;
  const testSegment = segments.find(segment =>
    segment === 'test' || segment === 'tests' || segment === '__tests__' ||
    segment === 'e2e' || segment === 'cypress' || segment === 'playwright',
  );
  const fileSignal = /(?:^|\.)(?:test|tests|spec|e2e)(?:\.|$)/.exec(fileName)?.[0];
  if (!testSegment && !fileSignal) {
    return undefined;
  }
  if (segments.includes('unit') || /(?:^|\.)unit(?:\.|$)/.test(fileName)) {
    return { kind: 'unit', source: 'unit filename/folder signal' };
  }
  if (segments.includes('integration') || /(?:^|\.)integration(?:\.|$)/.test(fileName)) {
    return { kind: 'integration', source: 'integration filename/folder signal' };
  }
  if (segments.includes('contract') || /(?:^|\.)contract(?:\.|$)/.test(fileName)) {
    return { kind: 'contract', source: 'contract-test filename/folder signal' };
  }
  if (
    segments.includes('e2e') || segments.includes('cypress') || segments.includes('playwright') ||
    /(?:^|\.)e2e(?:\.|$)/.test(fileName)
  ) {
    return { kind: 'end-to-end', source: 'end-to-end filename/folder signal' };
  }
  return { kind: 'unknown', source: `${testSegment ? `${testSegment}/ folder` : fileSignal} test-path signal` };
}

function buildItem(
  graph: LensGraph,
  root: LensGraphNode,
  node: LensGraphNode,
  edge: LensGraphEdge,
  classification: TestPathClassification,
): LensTestEvidenceItem {
  const id = `lens-test-evidence:${stableHash(`${graph.id}:${node.id}:${edge.relation}`)}`;
  const reason = edge.relation === 'calls'
    ? `${classification.kind} test-like source calls the selected symbol ${root.target.label}.`
    : `${classification.kind} test-like source contains a reference returned for ${root.target.label}.`;
  const target = normalizeLensTarget({
    ...node.target,
    id,
    kind: 'relation',
    detail: reason,
    evidence: edge.evidence,
  });
  if (!target) {
    throw new Error('AtlasMind Lens refused an invalid test-evidence target.');
  }
  return {
    id,
    testKind: classification.kind,
    link: edge.relation,
    target,
    reason,
    classification: classification.source,
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
