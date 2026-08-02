import { describe, expect, it } from 'vitest';

import { analyzeLensCodeImpact } from '../../src/core/lensCodeImpact';
import { normalizeLensGraph } from '../../src/core/lensGraph';
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

describe('AtlasMind Lens code impact analysis', () => {
  it('ranks callers, consumers, and downstream callees from explicit graph edges', () => {
    const caller = target('routeHandler', 1);
    const root = target('saveAccount', 10);
    const callee = target('writeAccount', 20);
    const nested = target('serializeAccount', 30);
    const reference = target('accountFixture', 40);
    const graph = normalizeLensGraph({
      version: 1,
      id: 'journey:save-account',
      label: 'saveAccount journey',
      mode: 'possible',
      rootNodeId: root.id,
      nodes: [
        { id: caller.id, target: caller, role: 'caller', depth: 0 },
        { id: root.id, target: root, role: 'entrypoint', depth: 1 },
        { id: callee.id, target: callee, role: 'callee', depth: 2 },
        { id: nested.id, target: nested, role: 'callee', depth: 3 },
        { id: reference.id, target: reference, role: 'reference', depth: 2 },
      ],
      edges: [
        { id: 'edge:caller', fromNodeId: caller.id, toNodeId: root.id, relation: 'calls', evidence: { kind: 'source', source: 'VS Code call hierarchy' } },
        { id: 'edge:callee', fromNodeId: root.id, toNodeId: callee.id, relation: 'calls', evidence: { kind: 'source', source: 'VS Code call hierarchy' } },
        { id: 'edge:nested', fromNodeId: callee.id, toNodeId: nested.id, relation: 'calls', evidence: { kind: 'source', source: 'VS Code call hierarchy' } },
        { id: 'edge:reference', fromNodeId: root.id, toNodeId: reference.id, relation: 'references', evidence: { kind: 'source', source: 'VS Code reference provider' } },
      ],
      notices: ['Static evidence is possible flow.'],
      truncated: false,
    });

    const impact = analyzeLensCodeImpact(graph);

    expect(impact.root.id).toBe(root.id);
    expect(impact.items.map(item => [item.category, item.target.label, item.proximity])).toEqual([
      ['upstream-caller', 'routeHandler', 1],
      ['consumer-reference', 'accountFixture', 1],
      ['downstream-callee', 'writeAccount', 1],
      ['downstream-callee', 'serializeAccount', 2],
    ]);
    expect(impact.items[0]?.target).toEqual(expect.objectContaining({
      kind: 'relation',
      detail: expect.stringContaining('may call the selected symbol'),
      evidence: { kind: 'source', source: 'VS Code call hierarchy' },
    }));
    expect(impact.notices).toEqual(expect.arrayContaining([
      expect.stringContaining('Contracts, schemas, configuration, documentation, tests, and runtime reachability remain unknown'),
      expect.stringContaining('not proof that no other impact exists'),
    ]));
  });

  it('inherits graph truncation and refuses malformed graph input', () => {
    const root = target('root', 1);
    const graph = normalizeLensGraph({
      version: 1,
      id: 'journey:bounded',
      label: 'Bounded journey',
      mode: 'possible',
      rootNodeId: root.id,
      nodes: [{ id: root.id, target: root, role: 'entrypoint', depth: 1 }],
      edges: [],
      notices: [],
      truncated: true,
    });

    expect(analyzeLensCodeImpact(graph).truncated).toBe(true);
    expect(() => analyzeLensCodeImpact({ version: 1 })).toThrow(/invalid possible-flow graph/i);
  });
});
