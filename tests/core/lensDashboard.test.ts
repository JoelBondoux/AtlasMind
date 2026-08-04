import { describe, expect, it } from 'vitest';

import {
  buildLensDashboard,
  findLensCatalogEntry,
  LENS_ACTION_CAP,
  LENS_CATALOG,
  LENS_RULES,
  type LensDashboardInput,
} from '../../src/core/lensDashboard';
import type { LensDeclarationsSnapshot } from '../../src/core/lensDeclarations';

function declarations(
  state: LensDeclarationsSnapshot['files'][number]['status'],
  config: LensDeclarationsSnapshot['files'][number]['status'],
  counts: [number, number] = [0, 0],
): LensDeclarationsSnapshot {
  const files: LensDeclarationsSnapshot['files'] = [
    { kind: 'state', label: 'State Lifecycle', workspacePath: '.atlasmind/lens-state.json', status: state, declarationCount: counts[0] },
    { kind: 'config', label: 'Configuration Resolution', workspacePath: '.atlasmind/lens-config.json', status: config, declarationCount: counts[1] },
  ];
  return { files, readyCount: files.filter(file => file.status === 'ready').length, totalCount: files.length };
}

const fullyReady: LensDashboardInput = {
  workspaceName: 'web',
  activeTarget: { kind: 'symbol', label: 'placeOrder', workspacePath: 'src/orders.ts' },
  declarations: declarations('ready', 'ready', [2, 3]),
  git: { repository: true, branch: 'feat/orders' },
  contractCandidates: 4,
};

describe('Lens dashboard model', () => {
  it('reports every catalog lens with a readiness and never invents an id', () => {
    const view = buildLensDashboard(fullyReady);

    expect(view.lenses).toHaveLength(LENS_CATALOG.length);
    expect(view.lenses.map(lens => lens.id)).toEqual(LENS_CATALOG.map(entry => entry.id));
    expect(view.lenses.every(lens => lens.readiness === 'ready')).toBe(true);
    expect(view.actions).toEqual([]);
    expect(view.emptyState).toBe('clear');
    expect(view.summary).toContain('8 of 8 lenses ready');
  });

  it('treats an unassessed input as unknown rather than as ready or empty', () => {
    // Nothing is supplied beyond a workspace: no declarations were inspected,
    // Git was never asked, and no contract scan ran. A dashboard that called
    // that "clear" would be earning silence by not looking.
    const view = buildLensDashboard({ workspaceName: 'web' });

    const declarationLens = view.lenses.find(lens => lens.id === 'state-lifecycle');
    expect(declarationLens?.readiness).toBe('unknown');
    expect(declarationLens?.rule).toBe('not-assessed');
    expect(view.lenses.find(lens => lens.id === 'change-story')?.readiness).toBe('unknown');
    expect(view.lenses.find(lens => lens.id === 'field-wiring')?.readiness).toBe('unknown');
    expect(view.emptyState).toBe('unexamined');
    expect(view.assessedCount).toBe(0);
  });

  it('separates "assessed and absent" from "never assessed"', () => {
    const absent = buildLensDashboard({ workspaceName: 'web', git: { repository: false }, contractCandidates: 0 });

    expect(absent.lenses.find(lens => lens.id === 'change-story')?.readiness).toBe('unavailable');
    expect(absent.lenses.find(lens => lens.id === 'change-story')?.rule).toBe('no-git-history');
    expect(absent.lenses.find(lens => lens.id === 'field-wiring')?.rule).toBe('no-contract-files');
    expect(absent.assessedCount).toBe(2);
  });

  it('refuses to call anything ready without a workspace, and asks for one exactly once', () => {
    const view = buildLensDashboard({});

    expect(view.lenses.every(lens => lens.readiness === 'unavailable')).toBe(true);
    expect(view.lenses.every(lens => lens.rule === 'no-workspace')).toBe(true);
    // Eight lenses share one cause; eight identical actions would be noise.
    expect(view.actions).toHaveLength(1);
    expect(view.actions[0]?.rule).toBe('no-workspace');
    expect(view.workspaceName).toBeUndefined();
  });

  it('ranks actions by the declared rule order, not by how many lenses raised them', () => {
    const view = buildLensDashboard({
      workspaceName: 'web',
      declarations: declarations('missing', 'invalid'),
      git: { repository: false },
      contractCandidates: 0,
    });

    const rules = view.actions.map(action => action.rule);
    // 'declaration-invalid' outranks 'declaration-missing' — somebody wrote that
    // file and it is broken — and both outrank the two suggestion-level rules.
    expect(rules.indexOf('declaration-invalid')).toBeLessThan(rules.indexOf('declaration-missing'));
    expect(rules.indexOf('declaration-missing')).toBeLessThan(rules.indexOf('no-git-history'));
    const declaredOrder = LENS_RULES.map(rule => rule.id);
    const positions = rules.map(rule => declaredOrder.indexOf(rule));
    expect([...positions].sort((left, right) => left - right)).toEqual(positions);
  });

  it('is deterministic — the same state always produces the same order', () => {
    const input: LensDashboardInput = {
      workspaceName: 'web',
      declarations: declarations('empty', 'missing'),
      git: { repository: true, branch: 'main' },
      contractCandidates: 1,
    };
    const first = buildLensDashboard(input);
    const second = buildLensDashboard(input);

    expect(second.actions.map(action => action.id)).toEqual(first.actions.map(action => action.id));
    expect(second.flow.edges.map(edge => edge.id)).toEqual(first.flow.edges.map(edge => edge.id));
  });

  it('collapses one "open a file" action rather than raising it per code lens', () => {
    const view = buildLensDashboard({ workspaceName: 'web' });

    const fileActions = view.actions.filter(action => action.rule === 'needs-active-file');
    expect(fileActions).toHaveLength(1);
  });

  it('asks for a symbol only for the lenses that start from one', () => {
    const view = buildLensDashboard({
      workspaceName: 'web',
      activeTarget: { kind: 'file', label: 'orders.ts', workspacePath: 'src/orders.ts' },
    });

    expect(view.lenses.find(lens => lens.id === 'code-explorer')?.readiness).toBe('ready');
    for (const id of ['possible-flow', 'change-impact', 'test-evidence'] as const) {
      expect(view.lenses.find(lens => lens.id === id)?.rule).toBe('needs-active-symbol');
    }
  });

  it('caps the actions band and states the remainder', () => {
    const view = buildLensDashboard({
      workspaceName: 'web',
      declarations: declarations('invalid', 'missing'),
      git: { repository: false },
      contractCandidates: 0,
    });

    expect(view.actions.length).toBeLessThanOrEqual(LENS_ACTION_CAP);
    expect(view.hiddenActionCount).toBe(0);
    const total = view.actions.length + view.hiddenActionCount;
    expect(total).toBeGreaterThan(0);
  });

  it('draws every lens between its evidence and a question, and marks unread evidence', () => {
    const view = buildLensDashboard({
      workspaceName: 'web',
      activeTarget: { kind: 'symbol', label: 'placeOrder', workspacePath: 'src/orders.ts' },
      git: { repository: false },
    });

    for (const lens of LENS_CATALOG) {
      expect(view.flow.edges.some(edge => edge.toNodeId === `lens:${lens.id}`)).toBe(true);
      expect(view.flow.edges.some(edge => edge.fromNodeId === `lens:${lens.id}`)).toBe(true);
    }
    // Every edge must land on a node that exists, or the renderer draws a curve
    // to nowhere and silently swallows it.
    const nodeIds = new Set(view.flow.nodes.map(node => node.id));
    for (const edge of view.flow.edges) {
      expect(nodeIds.has(edge.fromNodeId)).toBe(true);
      expect(nodeIds.has(edge.toNodeId)).toBe(true);
    }
    const storyEdge = view.flow.edges.find(edge => edge.toNodeId === 'lens:change-story');
    expect(storyEdge?.strength).toBe('absent');
    const unknownEdge = view.flow.edges.find(edge => edge.toNodeId === 'lens:field-wiring');
    expect(unknownEdge?.strength).toBe('declared');
  });

  it('describes the contract gate as "fewer than two", which is what it tests', () => {
    // One source is the case most likely to occur and the one where the old
    // wording lied. The rule table is published on the page, so a description
    // that does not match its own condition defeats the point of publishing it.
    const oneSource = buildLensDashboard({ workspaceName: 'web', contractCandidates: 1 });
    const action = oneSource.actions.find(candidate => candidate.rule === 'no-contract-files');
    const rule = oneSource.rules.find(candidate => candidate.id === 'no-contract-files');

    expect(action).toBeDefined();
    for (const text of [action!.title, action!.detail, rule!.description]) {
      expect(text.toLowerCase()).not.toContain('nothing');
      expect(text.toLowerCase()).not.toMatch(/\bno (schema|contract)/);
    }
    expect(`${action!.title} ${rule!.description}`.toLowerCase()).toContain('two');

    // And the same text has to stay true when there genuinely are none.
    const noSources = buildLensDashboard({ workspaceName: 'web', contractCandidates: 0 });
    expect(noSources.actions.find(candidate => candidate.rule === 'no-contract-files')?.title)
      .toBe(action!.title);
  });

  it('publishes the rule behind every action so nothing is graded invisibly', () => {
    const view = buildLensDashboard({ workspaceName: 'web', declarations: declarations('missing', 'empty') });

    expect(view.actions.length).toBeGreaterThan(0);
    const declaredRules = new Set(LENS_RULES.map(rule => rule.id));
    for (const action of view.actions) {
      expect(declaredRules.has(action.rule)).toBe(true);
      expect(action.detail.length).toBeGreaterThan(0);
    }
    expect(view.rules).toEqual([...LENS_RULES]);
  });

  it('every catalog entry states what it cannot prove', () => {
    for (const entry of LENS_CATALOG) {
      expect(entry.limit.length).toBeGreaterThan(20);
      expect(entry.plain.length).toBeGreaterThan(20);
      expect(entry.question.endsWith('?')).toBe(true);
    }
  });

  it('resolves only ids the catalog declares', () => {
    expect(findLensCatalogEntry('change-impact')?.name).toBe('Change Impact');
    expect(findLensCatalogEntry('../../etc/passwd')).toBeUndefined();
    expect(findLensCatalogEntry(42)).toBeUndefined();
    expect(findLensCatalogEntry(undefined)).toBeUndefined();
  });
});
