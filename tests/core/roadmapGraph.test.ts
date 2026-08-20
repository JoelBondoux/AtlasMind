import { describe, expect, it } from 'vitest';
import {
  AI_ASSIST_MULTIPLIER,
  MAX_DERIVED_EDGES_IN,
  ROADMAP_EDGE_RULES,
  daysUntilDeadline,
  deriveRoadmapEdges,
  describeRoadmapSchedule,
  edgeKey,
  estimateRoadmapEffort,
  layoutRoadmapCompletion,
  normalizeRoadmapNodeText,
  parseRoadmapDeadline,
  partitionRoadmapCompletion,
  resolveRoadmapEstimate,
  resolveRoadmapGraph,
  roadmapRouteTo,
  roadmapSubjectTokens,
  type RoadmapDerivationItem,
  type RoadmapEdge,
  type RoadmapGraphInputItem,
  type RoadmapNodeRecord,
} from '../../src/core/roadmapGraph.ts';

const NOW = new Date('2026-08-20T12:00:00Z');

const item = (overrides: Partial<RoadmapGraphInputItem> & { id: string }): RoadmapGraphInputItem => ({
  itemId: `roadmap-${overrides.id}`,
  text: overrides.id,
  completed: false,
  focus: 'feature',
  gates: [],
  priorityScore: 10,
  order: 0,
  ...overrides,
});

const derivable = (overrides: Partial<RoadmapDerivationItem> & { id: string }): RoadmapDerivationItem => ({
  text: overrides.id,
  focus: 'feature',
  completed: false,
  gates: [],
  order: 0,
  ...overrides,
});

const declaredEdge = (from: string, to: string): RoadmapEdge => ({ from, to, origin: 'declared' });

describe('roadmapSubjectTokens', () => {
  it('keeps the subject and drops the kind of work', () => {
    // "security" and "testing" say what kind of work this is; every security
    // item shares them, so treating them as subject would link all of them.
    expect(roadmapSubjectTokens('Add security testing for the webhook receiver'))
      .toEqual(['webhook', 'receiver']);
  });

  it('drops words too short or too generic to identify anything', () => {
    expect(roadmapSubjectTokens('Fix the API')).toEqual([]);
  });

  it('de-duplicates while keeping first-seen order', () => {
    expect(roadmapSubjectTokens('Webhook retry for webhook delivery')).toEqual(['webhook', 'retry']);
  });
});

describe('estimateRoadmapEffort', () => {
  it('grades from the declared table and publishes the rule that did it', () => {
    const plain = estimateRoadmapEffort('Add a settings toggle', 'feature', false);
    expect(plain.days).toBe(2.5);
    expect(plain.rule).toContain('3d base for feature work');
    expect(plain.rule).toContain('no AI-assistance discount applied');
  });

  it('applies exactly one AI multiplier, and says so', () => {
    const assisted = estimateRoadmapEffort('Add a settings toggle', 'feature', true);
    const unassisted = estimateRoadmapEffort('Add a settings toggle', 'feature', false);
    expect(assisted.days).toBeLessThan(unassisted.days);
    expect(assisted.rule).toContain(`×${AI_ASSIST_MULTIPLIER}`);
  });

  it('never grades work below half a day', () => {
    expect(estimateRoadmapEffort('Typo', 'documentation', true).days).toBe(0.5);
  });

  it('is deterministic — the same backlog grades the same twice', () => {
    const text = 'Design the persistence migration ladder for agent memory';
    expect(estimateRoadmapEffort(text, 'architecture', true))
      .toEqual(estimateRoadmapEffort(text, 'architecture', true));
  });

  it('charges for a complexity marker in the text', () => {
    const withMarker = estimateRoadmapEffort('Write the migration for stored profiles', 'feature', false);
    const without = estimateRoadmapEffort('Write the handler for stored profiles', 'feature', false);
    expect(withMarker.days).toBeGreaterThan(without.days);
    expect(withMarker.rule).toContain('complexity marker');
  });
});

describe('resolveRoadmapEstimate', () => {
  it('prefers a declared estimate and still reports what the table would have said', () => {
    const resolved = resolveRoadmapEstimate('Add a settings toggle', 'feature', { estimateDays: 9 });
    expect(resolved).toMatchObject({ days: 9, source: 'declared' });
    expect(resolved.rule).toContain('Set by hand');
  });

  it('defaults to AI-assisted, and treats an explicit false as a decision', () => {
    expect(resolveRoadmapEstimate('Add a toggle', 'feature', undefined).aiAssisted).toBe(true);
    expect(resolveRoadmapEstimate('Add a toggle', 'feature', {}).aiAssisted).toBe(true);
    expect(resolveRoadmapEstimate('Add a toggle', 'feature', { aiAssisted: false }).aiAssisted).toBe(false);
  });

  it('carries the other setting so the toggle can say what it would change', () => {
    const resolved = resolveRoadmapEstimate('Add a settings toggle', 'feature', { aiAssisted: true });
    expect(resolved.alternativeDays).toBeGreaterThan(resolved.days);
  });
});

describe('parseRoadmapDeadline', () => {
  it('accepts a calendar date and refuses everything else', () => {
    expect(parseRoadmapDeadline('2026-09-01')).toBe('2026-09-01');
    expect(parseRoadmapDeadline('01/09/2026')).toBeUndefined();
    expect(parseRoadmapDeadline('')).toBeUndefined();
    expect(parseRoadmapDeadline(undefined)).toBeUndefined();
  });

  it('refuses a date that does not exist rather than rolling it forward', () => {
    // Rule 5 in miniature: `2026-02-31` becoming 3 March is a silently wrong
    // deadline, which is worse than no deadline at all.
    expect(parseRoadmapDeadline('2026-02-31')).toBeUndefined();
  });
});

describe('describeRoadmapSchedule', () => {
  it('reports no deadline as its own state, never as zero days left', () => {
    const schedule = describeRoadmapSchedule({ completed: false, routeDays: 3, now: NOW });
    expect(schedule.state).toBe('no-deadline');
    expect(schedule.daysLeft).toBeUndefined();
  });

  it('ranks a passed deadline above an unaffordable route', () => {
    const schedule = describeRoadmapSchedule({ completed: false, deadline: '2026-08-01', routeDays: 40, now: NOW });
    expect(schedule.state).toBe('overdue');
    expect(schedule.reason).toContain('past the deadline');
  });

  it('calls a node at risk when the whole route will not fit before the date', () => {
    const schedule = describeRoadmapSchedule({ completed: false, deadline: '2026-08-22', routeDays: 9, now: NOW });
    expect(schedule.state).toBe('at-risk');
    expect(schedule.reason).toContain('9d of work still ahead');
  });

  it('is comfortable when the work fits', () => {
    expect(describeRoadmapSchedule({ completed: false, deadline: '2026-09-30', routeDays: 4, now: NOW }).state)
      .toBe('on-track');
  });

  it('says nothing about deadlines for delivered work', () => {
    expect(describeRoadmapSchedule({ completed: true, deadline: '2026-01-01', routeDays: 9, now: NOW }).state)
      .toBe('done');
  });
});

describe('daysUntilDeadline', () => {
  it('counts whole days and goes negative once the date has passed', () => {
    expect(daysUntilDeadline('2026-08-25', NOW)).toBe(5);
    expect(daysUntilDeadline('2026-08-20', NOW)).toBe(0);
    expect(daysUntilDeadline('2026-08-18', NOW)).toBe(-2);
  });
});

describe('deriveRoadmapEdges', () => {
  it('links an item that names what it waits for', () => {
    const { suggested } = deriveRoadmapEdges([
      derivable({ id: 'a', text: 'Build the webhook receiver endpoint', order: 0 }),
      derivable({ id: 'b', text: 'Add retries after the webhook receiver lands', order: 1 }),
    ], []);
    expect(suggested).toHaveLength(1);
    expect(suggested[0]).toMatchObject({ from: 'a', to: 'b', origin: 'derived', rule: 'explicit-reference' });
  });

  it('puts foundation work before the feature that shares its subject', () => {
    const { suggested } = deriveRoadmapEdges([
      derivable({ id: 'feature', text: 'Ship the invoice export screen', focus: 'feature', order: 0 }),
      derivable({ id: 'arch', text: 'Model the invoice export pipeline', focus: 'architecture', order: 1 }),
    ], []);
    expect(suggested.map(edge => edgeKey(edge))).toContain('arch->feature');
  });

  it('will not link two items that merely share one common word', () => {
    const { suggested } = deriveRoadmapEdges([
      derivable({ id: 'a', text: 'Model the invoice pipeline', focus: 'architecture', order: 0 }),
      derivable({ id: 'b', text: 'Ship the payroll screen', focus: 'feature', order: 1 }),
    ], []);
    expect(suggested).toHaveLength(0);
  });

  it('never contradicts a link somebody drew, and says it refused', () => {
    // Rule 1. The declared edge says b comes first; the phase rule wants the
    // opposite. The decision wins.
    const { suggested, notes } = deriveRoadmapEdges([
      derivable({ id: 'a', text: 'Model the invoice export pipeline', focus: 'architecture', order: 0 }),
      derivable({ id: 'b', text: 'Ship the invoice export screen', focus: 'feature', order: 1 }),
    ], [declaredEdge('b', 'a')]);
    expect(suggested).toHaveLength(0);
    expect(notes.join(' ')).toContain('contradicting a link somebody drew');
  });

  it('never duplicates a link that already exists', () => {
    const { suggested } = deriveRoadmapEdges([
      derivable({ id: 'a', text: 'Model the invoice export pipeline', focus: 'architecture', order: 0 }),
      derivable({ id: 'b', text: 'Ship the invoice export screen', focus: 'feature', order: 1 }),
    ], [declaredEdge('a', 'b')]);
    expect(suggested).toHaveLength(0);
  });

  it('never closes a cycle', () => {
    // Rule 3. a → b is declared; the phase rule wants b → a via a shared subject.
    const { suggested } = deriveRoadmapEdges([
      derivable({ id: 'a', text: 'Ship the invoice export screen', focus: 'feature', order: 0 }),
      derivable({ id: 'mid', text: 'Test the invoice export screen', focus: 'delivery', order: 1 }),
      derivable({ id: 'b', text: 'Model the invoice export pipeline', focus: 'architecture', order: 2 }),
    ], [declaredEdge('a', 'mid'), declaredEdge('mid', 'b')]);
    for (const edge of suggested) {
      expect(edgeKey(edge)).not.toBe('b->a');
    }
  });

  it('caps fan-in per node and states the remainder', () => {
    const many = Array.from({ length: MAX_DERIVED_EDGES_IN + 3 }, (_unused, index) => derivable({
      id: `arch-${index}`,
      text: `Model the invoice export component ${index}`,
      focus: 'architecture',
      order: index,
    }));
    const { suggested, notes } = deriveRoadmapEdges([
      ...many,
      derivable({ id: 'feature', text: 'Ship the invoice export screen', focus: 'feature', order: 99 }),
    ], []);
    expect(suggested.filter(edge => edge.to === 'feature').length).toBeLessThanOrEqual(MAX_DERIVED_EDGES_IN);
    expect(notes.join(' ')).toContain('caps were reached');
  });

  it('orders items on an earlier release before a later one', () => {
    const { suggested } = deriveRoadmapEdges([
      derivable({ id: 'later', text: 'Polish the telemetry dashboard', gates: ['v2'], order: 0 }),
      derivable({ id: 'earlier', text: 'Emit the telemetry events', gates: ['mvp'], order: 1 }),
    ], [], { gateOrder: ['mvp', 'v2'] });
    expect(suggested.map(edge => edgeKey(edge))).toContain('earlier->later');
  });

  it('produces the same suggestions twice — it is a rule table, not a guess', () => {
    const items = [
      derivable({ id: 'a', text: 'Model the invoice export pipeline', focus: 'architecture', order: 0 }),
      derivable({ id: 'b', text: 'Ship the invoice export screen', focus: 'feature', order: 1 }),
      derivable({ id: 'c', text: 'Document the invoice export pipeline', focus: 'documentation', order: 2 }),
    ];
    expect(deriveRoadmapEdges(items, [])).toEqual(deriveRoadmapEdges(items, []));
  });

  it('every suggestion names a rule that is in the published table', () => {
    const ruleIds = new Set(ROADMAP_EDGE_RULES.map(rule => rule.id));
    const { suggested } = deriveRoadmapEdges([
      derivable({ id: 'a', text: 'Model the invoice export pipeline', focus: 'architecture', order: 0 }),
      derivable({ id: 'b', text: 'Ship the invoice export screen', focus: 'feature', order: 1 }),
    ], []);
    expect(suggested.length).toBeGreaterThan(0);
    for (const edge of suggested) {
      expect(edge.rule !== undefined && ruleIds.has(edge.rule)).toBe(true);
      expect(edge.evidence).toBeTruthy();
    }
  });
});

describe('resolveRoadmapGraph', () => {
  it('lays nodes out in dependency columns', () => {
    const graph = resolveRoadmapGraph({
      items: [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' })],
      records: [],
      declaredEdges: [declaredEdge('a', 'b'), declaredEdge('b', 'c')],
      deriveSuggestions: false,
      now: NOW,
    });
    expect(graph.nodes.map(node => [node.id, node.depth])).toEqual([['a', 0], ['b', 1], ['c', 2]]);
    expect(graph.layers).toEqual([['a'], ['b'], ['c']]);
  });

  it('keeps a stored position and never overwrites it with the layout', () => {
    const records: RoadmapNodeRecord[] = [{ id: 'a', normalizedText: 'a', position: { x: 900, y: 40 } }];
    const graph = resolveRoadmapGraph({
      items: [item({ id: 'a' }), item({ id: 'b' })],
      records,
      declaredEdges: [],
      deriveSuggestions: false,
      now: NOW,
    });
    const a = graph.nodes.find(node => node.id === 'a');
    expect(a?.position).toEqual({ x: 900, y: 40 });
    expect(a?.positionSource).toBe('declared');
    expect(graph.nodes.find(node => node.id === 'b')?.positionSource).toBe('derived');
  });

  it('reports a declared cycle by name rather than breaking it', () => {
    const graph = resolveRoadmapGraph({
      items: [item({ id: 'a' }), item({ id: 'b' })],
      records: [],
      declaredEdges: [declaredEdge('a', 'b'), declaredEdge('b', 'a')],
      deriveSuggestions: false,
      now: NOW,
    });
    expect(graph.cycles).toEqual([['a', 'b']]);
    expect(graph.notes.join(' ')).toContain('circular');
    // It still draws: a page that refuses to render is not a fix.
    expect(graph.nodes).toHaveLength(2);
  });

  it('drops an edge pointing at an item that is gone, and says how many', () => {
    const graph = resolveRoadmapGraph({
      items: [item({ id: 'a' })],
      records: [],
      declaredEdges: [declaredEdge('a', 'ghost')],
      deriveSuggestions: false,
      now: NOW,
    });
    expect(graph.edges).toHaveLength(0);
    expect(graph.notes.join(' ')).toContain('no longer on the roadmap');
  });

  it('counts a whole route of outstanding work, ignoring what is already done', () => {
    const graph = resolveRoadmapGraph({
      items: [
        item({ id: 'done', completed: true }),
        item({ id: 'mid', text: 'Add a settings toggle' }),
        item({ id: 'end', text: 'Add a settings toggle' }),
      ],
      records: [{ id: 'mid', normalizedText: 'mid', estimateDays: 2 }, { id: 'end', normalizedText: 'end', estimateDays: 3 }],
      declaredEdges: [declaredEdge('done', 'mid'), declaredEdge('mid', 'end')],
      deriveSuggestions: false,
      now: NOW,
    });
    expect(graph.nodes.find(node => node.id === 'end')?.schedule.routeDays).toBe(5);
  });

  it('marks a node blocked only by prerequisites that are not done', () => {
    const graph = resolveRoadmapGraph({
      items: [item({ id: 'done', completed: true }), item({ id: 'open' }), item({ id: 'target' })],
      records: [],
      declaredEdges: [declaredEdge('done', 'target'), declaredEdge('open', 'target')],
      deriveSuggestions: false,
      now: NOW,
    });
    const target = graph.nodes.find(node => node.id === 'target');
    expect(target?.prerequisites).toEqual(['done', 'open']);
    expect(target?.blockedBy).toEqual(['open']);
  });

  it('hides a dismissed suggestion and says it did', () => {
    const items = [
      item({ id: 'arch', text: 'Model the invoice export pipeline', focus: 'architecture' }),
      item({ id: 'feat', text: 'Ship the invoice export screen', focus: 'feature', order: 1 }),
    ];
    const before = resolveRoadmapGraph({ items, records: [], declaredEdges: [], now: NOW });
    expect(before.suggested.length).toBeGreaterThan(0);

    const after = resolveRoadmapGraph({
      items,
      records: [],
      declaredEdges: [],
      dismissedEdges: [{ from: 'arch', to: 'feat' }],
      now: NOW,
    });
    expect(after.suggested.map(edge => edgeKey(edge))).not.toContain('arch->feat');
    expect(after.notes.join(' ')).toContain('dismissed before');
  });

  it('makes no suggestions at all when the project turned them off', () => {
    const graph = resolveRoadmapGraph({
      items: [
        item({ id: 'arch', text: 'Model the invoice export pipeline', focus: 'architecture' }),
        item({ id: 'feat', text: 'Ship the invoice export screen', focus: 'feature', order: 1 }),
      ],
      records: [],
      declaredEdges: [],
      deriveSuggestions: false,
      now: NOW,
    });
    expect(graph.suggested).toEqual([]);
  });

  it('keeps a suggestion out of the plan: it moves no column and blocks nothing', () => {
    const graph = resolveRoadmapGraph({
      items: [
        item({ id: 'arch', text: 'Model the invoice export pipeline', focus: 'architecture' }),
        item({ id: 'feat', text: 'Ship the invoice export screen', focus: 'feature', order: 1 }),
      ],
      records: [],
      declaredEdges: [],
      now: NOW,
    });
    expect(graph.suggested.length).toBeGreaterThan(0);
    expect(graph.nodes.every(node => node.depth === 0)).toBe(true);
    expect(graph.nodes.every(node => node.blockedBy.length === 0)).toBe(true);
  });

  it('uses the derived branch name unless one was set by hand', () => {
    const graph = resolveRoadmapGraph({
      items: [
        item({ id: 'a', derivedBranch: 'feat/derived-name' }),
        item({ id: 'b', derivedBranch: 'feat/other' }),
        item({ id: 'c' }),
      ],
      records: [{ id: 'b', normalizedText: 'b', branch: 'fix/by-hand' }],
      declaredEdges: [],
      deriveSuggestions: false,
      now: NOW,
    });
    expect(graph.nodes.find(node => node.id === 'a')).toMatchObject({ branch: 'feat/derived-name', branchSource: 'derived' });
    expect(graph.nodes.find(node => node.id === 'b')).toMatchObject({ branch: 'fix/by-hand', branchSource: 'declared' });
    expect(graph.nodes.find(node => node.id === 'c')).toMatchObject({ branch: '', branchSource: 'unavailable' });
  });
});

describe('roadmapRouteTo', () => {
  const graph = resolveRoadmapGraph({
    items: [
      item({ id: 'root', completed: true }),
      item({ id: 'mid' }),
      item({ id: 'target' }),
      item({ id: 'after' }),
      item({ id: 'unrelated' }),
    ],
    records: [],
    declaredEdges: [declaredEdge('root', 'mid'), declaredEdge('mid', 'target'), declaredEdge('target', 'after')],
    deriveSuggestions: false,
    now: NOW,
  });

  it('includes the node and everything that has to happen first', () => {
    expect(roadmapRouteTo(graph, 'target')?.nodeIds).toEqual(['mid', 'root', 'target']);
  });

  it('excludes what happens after, and everything unrelated', () => {
    const route = roadmapRouteTo(graph, 'target');
    expect(route?.nodeIds).not.toContain('after');
    expect(route?.nodeIds).not.toContain('unrelated');
  });

  it('keeps completed prerequisites and counts them', () => {
    const route = roadmapRouteTo(graph, 'target');
    expect(route?.nodeIds).toContain('root');
    expect(route?.completedCount).toBe(1);
    expect(route?.order).toEqual(['mid', 'target']);
  });

  it('returns nothing for a node that is not on the graph', () => {
    expect(roadmapRouteTo(graph, 'ghost')).toBeUndefined();
  });
});

describe('partitionRoadmapCompletion', () => {
  const graph = resolveRoadmapGraph({
    items: [
      item({ id: 'shipped', completed: true }),
      item({ id: 'shipped-blocking', completed: true }),
      item({ id: 'waiting' }),
    ],
    records: [],
    declaredEdges: [declaredEdge('shipped-blocking', 'waiting')],
    deriveSuggestions: false,
    now: NOW,
  });

  it('moves delivered work off the plan', () => {
    const partition = partitionRoadmapCompletion(graph);
    expect(partition.active.map(node => node.id)).not.toContain('shipped');
    expect(partition.completed.map(node => node.id)).toContain('shipped');
  });

  it('keeps delivered work on the plan while something outstanding still needs it', () => {
    const partition = partitionRoadmapCompletion(graph);
    expect(partition.active.map(node => node.id)).toContain('shipped-blocking');
    expect(partition.retained.map(node => node.id)).toEqual(['shipped-blocking']);
  });

  it('still records retained work as delivered', () => {
    // It shipped. A record of delivery that omits the load-bearing half would be
    // a strange record.
    expect(partitionRoadmapCompletion(graph).completed.map(node => node.id)).toContain('shipped-blocking');
  });
});

describe('layoutRoadmapCompletion', () => {
  const graph = resolveRoadmapGraph({
    items: [item({ id: 'jan', completed: true }), item({ id: 'mar', completed: true }), item({ id: 'none', completed: true })],
    records: [
      { id: 'jan', normalizedText: 'jan', completedAt: '2026-01-14T09:00:00.000Z' },
      { id: 'mar', normalizedText: 'mar', completedAt: '2026-03-02T09:00:00.000Z' },
    ],
    declaredEdges: [],
    deriveSuggestions: false,
    now: NOW,
  });

  it('columns by month, in order', () => {
    const laid = layoutRoadmapCompletion(graph.nodes);
    expect(laid.columns.map(column => column.label)).toEqual(['January 2026', 'March 2026', 'No date recorded']);
  });

  it('puts undated work last rather than at the start of the chronology', () => {
    const laid = layoutRoadmapCompletion(graph.nodes);
    const undated = laid.nodes.find(node => node.id === 'none');
    const january = laid.nodes.find(node => node.id === 'jan');
    expect(undated?.position.x).toBeGreaterThan(january?.position.x ?? 0);
  });

  it('separates parallel work into rows within a month', () => {
    const sameMonth = resolveRoadmapGraph({
      items: [item({ id: 'one', completed: true }), item({ id: 'two', completed: true })],
      records: [
        { id: 'one', normalizedText: 'one', completedAt: '2026-05-04T09:00:00.000Z' },
        { id: 'two', normalizedText: 'two', completedAt: '2026-05-19T09:00:00.000Z' },
      ],
      declaredEdges: [],
      deriveSuggestions: false,
      now: NOW,
    });
    const laid = layoutRoadmapCompletion(sameMonth.nodes);
    expect(laid.columns).toHaveLength(1);
    expect(new Set(laid.nodes.map(node => node.position.y)).size).toBe(2);
  });
});

describe('normalizeRoadmapNodeText', () => {
  it('collapses whitespace and case so a repair match is not defeated by formatting', () => {
    expect(normalizeRoadmapNodeText('  Ship   the  Export ')).toBe('ship the export');
  });
});
