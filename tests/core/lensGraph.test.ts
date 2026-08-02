import { describe, expect, it } from 'vitest';

import {
  LENS_GRAPH_MAX_EDGES,
  LENS_GRAPH_MAX_NODES,
  normalizeLensGraph,
} from '../../src/core/lensGraph';
import { createSourceLensTarget } from '../../src/core/lensTarget';

const WORKSPACE = { name: 'atlasmind', index: 0 } as const;

function target(label: string, line: number) {
  return createSourceLensTarget({
    kind: 'symbol',
    label,
    workspace: WORKSPACE,
    workspacePath: `src/${label}.ts`,
    range: { startLine: line, startColumn: 1, endLine: line + 2, endColumn: 2 },
    symbolKind: 'Function',
  });
}

describe('AtlasMind Lens graph contract', () => {
  it('normalizes a bounded possible-flow graph with explicit edge evidence', () => {
    const root = target('handleRequest', 10);
    const callee = target('loadAccount', 30);
    const graph = normalizeLensGraph({
      version: 1,
      id: 'journey:handle-request',
      label: 'handleRequest journey',
      mode: 'possible',
      rootNodeId: root.id,
      nodes: [
        { id: root.id, target: root, role: 'entrypoint', depth: 1 },
        { id: callee.id, target: callee, role: 'callee', depth: 2 },
      ],
      edges: [{
        id: 'edge:calls:1',
        fromNodeId: root.id,
        toNodeId: callee.id,
        relation: 'calls',
        evidence: { kind: 'source', source: 'VS Code call hierarchy', confidence: 1 },
      }],
      notices: ['Static call hierarchy is possible flow, not observed execution.'],
      truncated: false,
    });

    expect(graph).toEqual(expect.objectContaining({
      version: 1,
      mode: 'possible',
      rootNodeId: root.id,
      truncated: false,
    }));
    expect(graph?.nodes).toHaveLength(2);
    expect(graph?.edges[0]).toEqual(expect.objectContaining({
      relation: 'calls',
      evidence: { kind: 'source', source: 'VS Code call hierarchy', confidence: 1 },
    }));
  });

  it('drops malformed edges and refuses a graph whose root is unavailable', () => {
    const root = target('root', 1);
    const malformed = {
      version: 1,
      id: 'journey:bad-edge',
      label: 'Bad edge',
      mode: 'possible',
      rootNodeId: root.id,
      nodes: [{ id: root.id, target: root, role: 'entrypoint', depth: 0 }],
      edges: [{
        id: 'edge:missing',
        fromNodeId: root.id,
        toNodeId: 'missing-node',
        relation: 'calls',
        evidence: { kind: 'source', source: 'test' },
      }],
      notices: [],
      truncated: false,
    };

    expect(normalizeLensGraph(malformed)?.edges).toEqual([]);
    expect(normalizeLensGraph({ ...malformed, rootNodeId: 'missing-node' })).toBeUndefined();
  });

  it('enforces the published node and edge budgets and labels the view truncated', () => {
    const targets = Array.from({ length: LENS_GRAPH_MAX_NODES + 20 }, (_, index) => target(`node-${index}`, index + 1));
    const graph = normalizeLensGraph({
      version: 1,
      id: 'journey:bounded',
      label: 'Bounded journey',
      mode: 'possible',
      rootNodeId: targets[0]?.id,
      nodes: targets.map((item, index) => ({
        id: item.id,
        target: item,
        role: index === 0 ? 'entrypoint' : 'callee',
        depth: index === 0 ? 1 : 2,
      })),
      edges: Array.from({ length: LENS_GRAPH_MAX_EDGES + 40 }, (_, index) => ({
        id: `edge:${index}`,
        fromNodeId: targets[index % LENS_GRAPH_MAX_NODES]?.id,
        toNodeId: targets[(index + 1) % LENS_GRAPH_MAX_NODES]?.id,
        relation: 'calls',
        evidence: { kind: 'source', source: 'test provider' },
      })),
      notices: [],
      truncated: false,
    });

    expect(graph?.nodes).toHaveLength(LENS_GRAPH_MAX_NODES);
    expect(graph?.edges).toHaveLength(LENS_GRAPH_MAX_EDGES);
    expect(graph?.truncated).toBe(true);
  });
});
