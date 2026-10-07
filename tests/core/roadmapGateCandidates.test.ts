import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  GATE_CANDIDATE_CAP,
  GATE_CANDIDATE_RULES,
  gateNameTerms,
  isFoundationalRoadmapWork,
  resolveGateCandidateSelection,
  scanRoadmapGateCandidates,
  type GateCandidateInputItem,
} from '../../src/core/roadmapGateCandidates.ts';
import type { RoadmapFocus } from '../../src/core/roadmapGraph.ts';

let order = 0;
function item(id: string, text: string, overrides: Partial<GateCandidateInputItem> = {}): GateCandidateInputItem {
  order += 1;
  return { id, text, completed: false, gates: [], focus: 'feature', order, ...overrides };
}

const BETA = { id: 'beta', label: 'Public beta' };

describe('the rule table', () => {
  it('is ranked by consequence, with unique ids and ranks', () => {
    expect(GATE_CANDIDATE_RULES.map(rule => rule.id)).toEqual([
      'prerequisite-of-gated', 'names-gate', 'mvp-foundation', 'shares-subject', 'depends-on-gated', 'same-focus',
    ]);
    const ranks = GATE_CANDIDATE_RULES.map(rule => rule.rank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it('marks the weak signals as corroborating only', () => {
    const weak = GATE_CANDIDATE_RULES.filter(rule => !rule.standalone).map(rule => rule.id);
    expect(weak).toEqual(['depends-on-gated', 'same-focus']);
  });

  it('scopes the foundation heuristic to the MVP gate, as the suggested route always did', () => {
    expect(GATE_CANDIDATE_RULES.find(rule => rule.id === 'mvp-foundation')?.scope).toBe('mvp');
  });
});

describe('isFoundationalRoadmapWork — the one MVP heuristic', () => {
  it('counts security and architecture work as foundational', () => {
    expect(isFoundationalRoadmapWork('rotate the keys', 'security')).toBe(true);
    expect(isFoundationalRoadmapWork('split the module', 'architecture')).toBe(true);
  });

  it('counts foundational wording on any kind of work', () => {
    expect(isFoundationalRoadmapWork('Core onboarding flow', 'feature')).toBe(true);
    expect(isFoundationalRoadmapWork('minimum viable checkout', 'feature')).toBe(true);
    expect(isFoundationalRoadmapWork('polish the settings page', 'feature')).toBe(false);
  });
});

describe('gateNameTerms', () => {
  it('reads distinctive words from the label and drops generic release words', () => {
    expect(gateNameTerms({ id: 'beta', label: 'Public beta' }).words).toEqual(['public', 'beta']);
    expect(gateNameTerms({ id: 'version-two', label: 'Version two' }).words).toEqual([]);
  });

  it('keeps a short or numbered tag as a whole-word literal the tokeniser would drop', () => {
    expect(gateNameTerms({ id: 'v2', label: 'v2' }).literals).toEqual(['v2']);
    expect(gateNameTerms({ id: 'mvp', label: 'MVP' }).literals).toEqual(['mvp']);
    expect(gateNameTerms({ id: 'v1.0', label: 'v1.0' }).literals).toEqual(['v1.0']);
    expect(gateNameTerms({ id: 'next-release', label: 'Next release' })).toEqual({ words: [], literals: [] });
  });
});

describe('scanRoadmapGateCandidates', () => {
  it('lists an item that names the release, with the rule and what it matched', () => {
    const report = scanRoadmapGateCandidates({
      gate: BETA,
      items: [item('a', 'Invite the beta testers'), item('b', 'Polish the settings page')],
      edges: [],
    });
    expect(report.status).toBe('candidates');
    expect(report.candidates.map(candidate => candidate.id)).toEqual(['a']);
    expect(report.candidates[0]?.matches[0]).toEqual({ rule: 'names-gate', evidence: 'mentions “beta”' });
  });

  it('matches a short tag only as a whole word', () => {
    const report = scanRoadmapGateCandidates({
      gate: { id: 'v2', label: 'v2' },
      items: [item('a', 'Ship the v2 importer'), item('b', 'Bump to v21 of the parser'), item('c', 'Use av2 codec')],
      edges: [],
    });
    expect(report.candidates.map(candidate => candidate.id)).toEqual(['a']);
  });

  it('ranks what the gate waits on above everything else, transitively, through declared links', () => {
    const gated = item('gated', 'Publish the marketplace listing', { gates: ['beta'] });
    const direct = item('direct', 'Write the marketplace screenshots');
    const indirect = item('indirect', 'Pick a screenshot tool');
    const named = item('named', 'Invite beta testers');
    const report = scanRoadmapGateCandidates({
      gate: BETA,
      items: [named, gated, direct, indirect],
      edges: [{ from: 'direct', to: 'gated' }, { from: 'indirect', to: 'direct' }],
    });
    expect(report.candidates.map(candidate => candidate.id)).toEqual(['direct', 'indirect', 'named']);
    expect(report.candidates[0]?.leadingRule).toBe('prerequisite-of-gated');
    expect(report.candidates[0]?.matches[0]?.evidence).toBe('“Publish the marketplace listing” waits on it');
    expect(report.candidates[1]?.matches[0]?.evidence).toContain('through 1 other item');
  });

  it('survives a hand-edited cycle in the links', () => {
    const report = scanRoadmapGateCandidates({
      gate: BETA,
      items: [item('g', 'Gated thing', { gates: ['beta'] }), item('x', 'Loop one'), item('y', 'Loop two')],
      edges: [{ from: 'x', to: 'g' }, { from: 'y', to: 'x' }, { from: 'x', to: 'y' }],
    });
    expect(report.candidates.map(candidate => candidate.id).sort()).toEqual(['x', 'y']);
  });

  it('lists work sharing two distinctive words with an item on the gate', () => {
    const report = scanRoadmapGateCandidates({
      gate: { id: 'next-release', label: 'Next release' },
      items: [
        item('g', 'Webhook retry queue', { gates: ['next-release'] }),
        item('a', 'Expose webhook retry counts'),
        item('b', 'Expose webhook signing'),
      ],
      edges: [],
    });
    expect(report.candidates.map(candidate => candidate.id)).toEqual(['a']);
    expect(report.candidates[0]?.matches[0]?.rule).toBe('shares-subject');
  });

  it('does not count two shared words between two long paragraphs as the same subject', () => {
    const report = scanRoadmapGateCandidates({
      gate: { id: 'next-release', label: 'Next release' },
      items: [
        item('g', 'Webhook retry queue with exponential backoff, jitter, dead letters, alerting, dashboards and replay tooling', { gates: ['next-release'] }),
        item('a', 'Webhook retry visibility across billing invoices, receipts, refunds, disputes, payouts, ledgers and statements'),
      ],
      edges: [],
    });
    expect(report.status).toBe('none');
  });

  it('applies the foundation heuristic to the MVP gate only', () => {
    const items = [item('auth', 'Rotate session tokens', { focus: 'security' }), item('ui', 'Polish the toolbar')];
    const mvp = scanRoadmapGateCandidates({ gate: { id: 'mvp', label: 'MVP' }, items, edges: [] });
    expect(mvp.candidates.map(candidate => candidate.id)).toEqual(['auth']);
    expect(mvp.candidates[0]?.matches[0]).toEqual({ rule: 'mvp-foundation', evidence: 'security work' });

    const later = scanRoadmapGateCandidates({ gate: { id: 'v2', label: 'v2' }, items, edges: [] });
    expect(later.skipped.find(skip => skip.rule === 'mvp-foundation')?.reason).toBe('Applies to the MVP gate only.');
    expect(later.candidates).toEqual([]);
  });

  it('never lists an item on a corroborating rule alone', () => {
    const report = scanRoadmapGateCandidates({
      gate: { id: 'next-release', label: 'Next release' },
      items: [
        item('g1', 'Alpha widget', { gates: ['next-release'], focus: 'delivery' }),
        item('g2', 'Gamma gadget', { gates: ['next-release'], focus: 'delivery' }),
        item('follows', 'Omega thing', { focus: 'delivery' }),
      ],
      edges: [{ from: 'g1', to: 'follows' }],
    });
    expect(report.applied).toContain('same-focus');
    expect(report.applied).toContain('depends-on-gated');
    expect(report.status).toBe('none');
    expect(report.candidates).toEqual([]);
  });

  it('adds corroboration to the score and the match list once something stands alone', () => {
    const report = scanRoadmapGateCandidates({
      gate: BETA,
      items: [
        item('g1', 'Alpha widget', { gates: ['beta'], focus: 'delivery' }),
        item('g2', 'Gamma gadget', { gates: ['beta'], focus: 'delivery' }),
        item('c', 'Beta release notes', { focus: 'delivery' }),
      ],
      edges: [{ from: 'g1', to: 'c' }],
    });
    const candidate = report.candidates[0];
    expect(candidate?.matches.map(match => match.rule)).toEqual(['names-gate', 'depends-on-gated', 'same-focus']);
    expect(candidate?.score).toBe(30 + 8 + 5);
  });

  it('never proposes delivered items or items already on the gate, and says how many it left out', () => {
    const report = scanRoadmapGateCandidates({
      gate: BETA,
      items: [
        item('done', 'Beta signup page', { completed: true }),
        item('on', 'Beta feedback form', { gates: ['beta'] }),
        item('off', 'Beta invite email'),
      ],
      edges: [],
    });
    expect(report.candidates.map(candidate => candidate.id)).toEqual(['off']);
    expect(report.excluded).toEqual({ onGate: 1, completed: 1 });
    expect(report.scannedCount).toBe(1);
  });

  it('reports the other gates a candidate is already on', () => {
    const report = scanRoadmapGateCandidates({
      gate: BETA,
      items: [item('a', 'Beta onboarding tour', { gates: ['mvp'] })],
      edges: [],
    });
    expect(report.candidates[0]?.otherGates).toEqual(['mvp']);
  });

  describe('could-not-assess is not none-found', () => {
    it('refuses to call a gate with no usable name and nothing on it clear', () => {
      const report = scanRoadmapGateCandidates({
        gate: { id: 'next-release', label: 'Next release' },
        items: [item('a', 'Webhook retries')],
        edges: [],
      });
      expect(report.status).toBe('unassessable');
      expect(report.candidates).toEqual([]);
      expect(report.summary).toMatch(/^Could not assess Next release/);
      expect(report.summary).toContain('no distinctive word');
      expect(report.applied).toEqual([]);
    });

    it('says nothing matched when rules were applied and found nothing', () => {
      const report = scanRoadmapGateCandidates({
        gate: BETA,
        items: [item('a', 'Webhook retries')],
        edges: [],
      });
      expect(report.status).toBe('none');
      expect(report.summary).toContain('none matched Public beta');
    });

    it('says there was nothing to scan when every outstanding item is already on the gate', () => {
      const report = scanRoadmapGateCandidates({
        gate: BETA,
        items: [item('a', 'Webhook retries', { gates: ['beta'] })],
        edges: [],
      });
      expect(report.status).toBe('nothing-eligible');
    });

    it('reports unreadable links as not assessed rather than as no prerequisites', () => {
      const report = scanRoadmapGateCandidates({
        gate: BETA,
        items: [item('g', 'Gated', { gates: ['beta'] }), item('a', 'Other')],
        edges: undefined,
      });
      expect(report.skipped.find(skip => skip.rule === 'prerequisite-of-gated')?.reason).toMatch(/could not be read/);
      expect(report.applied).not.toContain('prerequisite-of-gated');
    });
  });

  it('caps the list and states the remainder', () => {
    const items = Array.from({ length: GATE_CANDIDATE_CAP + 3 }, (_, index) => item(`i${index}`, `Beta task number ${index}`));
    const report = scanRoadmapGateCandidates({ gate: BETA, items, edges: [] });
    expect(report.candidates).toHaveLength(GATE_CANDIDATE_CAP);
    expect(report.remainder).toBe(3);
    expect(report.summary).toContain('3 more not shown');
  });
});

describe('resolveGateCandidateSelection', () => {
  const report = scanRoadmapGateCandidates({
    gate: BETA,
    items: [item('a', 'Beta invite'), item('b', 'Beta survey'), item('c', 'Unrelated', { gates: ['beta'] })],
    edges: [],
  });

  it('accepts only ids the scan proposed, in ranking order', () => {
    const result = resolveGateCandidateSelection(report, ['b', 'a']);
    expect(result.accepted.map(candidate => candidate.id)).toEqual(['a', 'b']);
    expect(result.refused).toEqual([]);
  });

  it('refuses an id that is not a candidate, including one already on the gate', () => {
    const result = resolveGateCandidateSelection(report, ['a', 'c', 'nope', 'nope']);
    expect(result.accepted.map(candidate => candidate.id)).toEqual(['a']);
    expect(result.refused).toEqual(['c', 'nope']);
  });

  it('accepts nothing from a malformed selection', () => {
    expect(resolveGateCandidateSelection(report, 'a').accepted).toEqual([]);
    expect(resolveGateCandidateSelection(report, [42, null]).accepted).toEqual([]);
  });
});

// ── Properties ─────────────────────────────────────────────────────────────

const FOCI: RoadmapFocus[] = ['security', 'architecture', 'delivery', 'feature', 'documentation'];
const WORDS = ['beta', 'webhook', 'retry', 'queue', 'signing', 'onboarding', 'tour', 'billing', 'export', 'core', 'v2', 'launch'];

const itemsArb = fc.uniqueArray(
  fc.record({
    id: fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/),
    words: fc.array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 5 }),
    completed: fc.boolean(),
    gates: fc.subarray(['mvp', 'beta', 'v2']),
    focus: fc.constantFrom(...FOCI),
  }),
  { selector: entry => entry.id, maxLength: 30 },
).map(entries => entries.map((entry, index) => ({
  id: entry.id,
  text: entry.words.join(' '),
  completed: entry.completed,
  gates: entry.gates,
  focus: entry.focus,
  order: index + 1,
})));

const scanArb = fc.record({
  items: itemsArb,
  gate: fc.constantFrom({ id: 'mvp', label: 'MVP' }, BETA, { id: 'v2', label: 'v2' }, { id: 'next-release', label: 'Next release' }),
  edgePairs: fc.array(fc.tuple(fc.nat(29), fc.nat(29)), { maxLength: 40 }),
  edgesKnown: fc.boolean(),
}).map(({ items, gate, edgePairs, edgesKnown }) => ({
  gate,
  items,
  edges: edgesKnown && items.length > 0
    ? edgePairs.map(([from, to]) => ({ from: items[from % items.length]!.id, to: items[to % items.length]!.id }))
    : undefined,
}));

describe('properties', () => {
  it('never proposes a delivered item or one already on the gate', () => {
    fc.assert(fc.property(scanArb, input => {
      const report = scanRoadmapGateCandidates(input);
      const byId = new Map(input.items.map(entry => [entry.id, entry]));
      for (const candidate of report.candidates) {
        const source = byId.get(candidate.id)!;
        expect(source.completed).toBe(false);
        expect(source.gates).not.toContain(input.gate.id);
      }
    }));
  });

  it('names at least one rule for every candidate, and at least one that can stand alone', () => {
    const standalone = new Set(GATE_CANDIDATE_RULES.filter(rule => rule.standalone).map(rule => rule.id));
    fc.assert(fc.property(scanArb, input => {
      const report = scanRoadmapGateCandidates(input);
      for (const candidate of report.candidates) {
        expect(candidate.matches.length).toBeGreaterThan(0);
        expect(candidate.matches[0]!.rule).toBe(candidate.leadingRule);
        expect(candidate.matches.some(match => standalone.has(match.rule))).toBe(true);
        expect(report.applied).toEqual(expect.arrayContaining(candidate.matches.map(match => match.rule)));
      }
    }));
  });

  it('is deterministic, whatever order the items arrive in', () => {
    fc.assert(fc.property(scanArb, fc.integer(), (input, seed) => {
      const shuffled = [...input.items].sort((a, b) => ((a.id.charCodeAt(0) * seed) % 7) - ((b.id.charCodeAt(0) * seed) % 7));
      expect(scanRoadmapGateCandidates({ ...input, items: shuffled })).toEqual(scanRoadmapGateCandidates(input));
    }));
  });

  it('caps the list, counts the rest, and only says "candidates" when it has some', () => {
    fc.assert(fc.property(scanArb, input => {
      const report = scanRoadmapGateCandidates(input);
      expect(report.candidates.length).toBeLessThanOrEqual(GATE_CANDIDATE_CAP);
      expect(report.remainder).toBeGreaterThanOrEqual(0);
      expect(report.status === 'candidates').toBe(report.candidates.length > 0);
      if (report.status === 'unassessable') {
        expect(report.applied.filter(id => GATE_CANDIDATE_RULES.find(rule => rule.id === id)?.standalone)).toEqual([]);
      }
    }));
  });

  it('ranks by leading rule first', () => {
    const rank = new Map(GATE_CANDIDATE_RULES.map(rule => [rule.id, rule.rank]));
    fc.assert(fc.property(scanArb, input => {
      const ranks = scanRoadmapGateCandidates(input).candidates.map(candidate => rank.get(candidate.leadingRule)!);
      expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    }));
  });
});
