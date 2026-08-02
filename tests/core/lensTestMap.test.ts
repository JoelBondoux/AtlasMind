import { describe, expect, it } from 'vitest';

import { analyzeLensTestMap } from '../../src/core/lensTestMap';
import { normalizeLensGraph } from '../../src/core/lensGraph';
import { createSourceLensTarget } from '../../src/core/lensTarget';

const WORKSPACE = { name: 'atlasmind', index: 0 } as const;

function target(label: string, workspacePath: string, line: number) {
  return createSourceLensTarget({
    kind: 'symbol',
    label,
    workspace: WORKSPACE,
    workspacePath,
    range: { startLine: line, startColumn: 1, endLine: line + 2, endColumn: 2 },
    symbolKind: 'Function',
  });
}

describe('AtlasMind Lens test evidence map', () => {
  it('keeps source-backed test callers/references and classifies only explicit path signals', () => {
    const root = target('saveAccount', 'src/account.ts', 10);
    const unit = target('saves account', 'tests/unit/account.test.ts', 2);
    const integration = target('persists account', 'tests/integration/account.spec.ts', 4);
    const e2e = target('account journey', 'e2e/account.e2e.ts', 6);
    const production = target('renderAccount', 'src/accountView.ts', 8);
    const graph = normalizeLensGraph({
      version: 1,
      id: 'journey:test-evidence',
      label: 'saveAccount journey',
      mode: 'possible',
      rootNodeId: root.id,
      nodes: [
        { id: unit.id, target: unit, role: 'caller', depth: 0 },
        { id: root.id, target: root, role: 'entrypoint', depth: 1 },
        { id: integration.id, target: integration, role: 'reference', depth: 2 },
        { id: e2e.id, target: e2e, role: 'reference', depth: 2 },
        { id: production.id, target: production, role: 'reference', depth: 2 },
      ],
      edges: [
        { id: 'edge:unit', fromNodeId: unit.id, toNodeId: root.id, relation: 'calls', evidence: { kind: 'source', source: 'VS Code call hierarchy' } },
        { id: 'edge:integration', fromNodeId: root.id, toNodeId: integration.id, relation: 'references', evidence: { kind: 'source', source: 'VS Code reference provider' } },
        { id: 'edge:e2e', fromNodeId: root.id, toNodeId: e2e.id, relation: 'references', evidence: { kind: 'source', source: 'VS Code reference provider' } },
        { id: 'edge:production', fromNodeId: root.id, toNodeId: production.id, relation: 'references', evidence: { kind: 'source', source: 'VS Code reference provider' } },
      ],
      notices: [],
      truncated: false,
    });

    const map = analyzeLensTestMap(graph);

    expect(map.items.map(item => [item.testKind, item.link, item.target.workspacePath])).toEqual([
      ['unit', 'calls', 'tests/unit/account.test.ts'],
      ['integration', 'references', 'tests/integration/account.spec.ts'],
      ['end-to-end', 'references', 'e2e/account.e2e.ts'],
    ]);
    expect(map.items.some(item => item.target.workspacePath === 'src/accountView.ts')).toBe(false);
    expect(map.items[0]?.target).toEqual(expect.objectContaining({
      kind: 'relation',
      detail: expect.stringContaining('test-like source calls the selected symbol'),
    }));
    expect(map.notices).toEqual(expect.arrayContaining([
      expect.stringContaining('Path classification is a conservative signal'),
      expect.stringContaining('not proof that the symbol is untested'),
      expect.stringContaining('does not execute tests'),
    ]));
  });

  it('keeps an ordinary test filename as unknown test kind and inherits graph truncation', () => {
    const root = target('root', 'src/root.ts', 1);
    const test = target('root works', '__tests__/root.spec.ts', 2);
    const graph = normalizeLensGraph({
      version: 1,
      id: 'journey:unknown-test-kind',
      label: 'Root journey',
      mode: 'possible',
      rootNodeId: root.id,
      nodes: [
        { id: root.id, target: root, role: 'entrypoint', depth: 1 },
        { id: test.id, target: test, role: 'reference', depth: 2 },
      ],
      edges: [{ id: 'edge:test', fromNodeId: root.id, toNodeId: test.id, relation: 'references', evidence: { kind: 'source', source: 'provider' } }],
      notices: [],
      truncated: true,
    });

    expect(analyzeLensTestMap(graph)).toEqual(expect.objectContaining({
      items: [expect.objectContaining({ testKind: 'unknown' })],
      truncated: true,
    }));
    expect(() => analyzeLensTestMap({ nope: true })).toThrow(/invalid possible-flow graph/i);
  });
});
