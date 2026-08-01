import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { normalizeForRoadmapMatch } from '../../src/core/ideationDerivation.js';
import {
  assessIdeationReadiness,
  type IdeationReadinessInput,
  type ReadinessCard,
  type ReadinessConnection,
} from '../../src/core/ideationReadiness.js';

function card(overrides: Partial<ReadinessCard> = {}): ReadinessCard {
  return { id: 'c1', kind: 'idea', title: 'Something', ...overrides };
}

function edge(overrides: Partial<ReadinessConnection> = {}): ReadinessConnection {
  return { fromCardId: 'c1', toCardId: 'c2', relation: 'supports', ...overrides };
}

function input(overrides: Partial<IdeationReadinessInput> = {}): IdeationReadinessInput {
  return { cards: [], connections: [], roadmapItems: [], ...overrides };
}

function observationIds(result: ReturnType<typeof assessIdeationReadiness>): string[] {
  return result.observations.map(observation => observation.id);
}

describe('an empty board is unstarted, not clean', () => {
  it('reports unexamined and says what to do', () => {
    const result = assessIdeationReadiness(input());
    expect(result.state).toBe('unexamined');
    expect(observationIds(result)).toContain('board-empty');
    expect(result.summary).toBe('Nothing on the board yet.');
  });

  it('does not congratulate an empty board for having no gaps', () => {
    const result = assessIdeationReadiness(input());
    expect(result.observations.some(observation => observation.tone === 'good')).toBe(false);
  });
});

describe('a contradiction outranks everything else', () => {
  it('leads the reading and is graded blocking', () => {
    const result = assessIdeationReadiness(input({
      cards: [card({ id: 'c1', kind: 'idea' }), card({ id: 'c2', kind: 'risk' })],
      connections: [edge({ relation: 'contradiction' })],
    }));
    expect(result.observations[0]!.id).toBe('contradiction-open');
    expect(result.observations[0]!.tone).toBe('blocking');
    expect(result.summary).toContain('argues against');
  });

  it('ignores an edge to a card that has been archived', () => {
    const result = assessIdeationReadiness(input({
      cards: [card({ id: 'c1' }), card({ id: 'c2', archived: true })],
      connections: [edge({ relation: 'contradiction' })],
    }));
    expect(result.contradictions).toBe(0);
  });
});

describe('the weak signals', () => {
  it('notices a board with nothing checkable on it', () => {
    const result = assessIdeationReadiness(input({ cards: [card()] }));
    expect(observationIds(result)).toContain('no-evidence');
  });

  it('notices a problem with nothing behind it', () => {
    const result = assessIdeationReadiness(input({
      cards: [card({ id: 'p', kind: 'problem' }), card({ id: 'e', kind: 'evidence' })],
      connections: [],
    }));
    expect(observationIds(result)).toContain('unsupported-problems');
  });

  it('accepts a problem supported in the right direction only', () => {
    const supported = assessIdeationReadiness(input({
      cards: [card({ id: 'p', kind: 'problem' }), card({ id: 'e', kind: 'evidence' })],
      connections: [{ fromCardId: 'e', toCardId: 'p', relation: 'supports' }],
    }));
    expect(observationIds(supported)).not.toContain('unsupported-problems');

    // The same edge backwards says the problem supports the evidence, which is
    // a different claim and does not evidence the problem.
    const backwards = assessIdeationReadiness(input({
      cards: [card({ id: 'p', kind: 'problem' }), card({ id: 'e', kind: 'evidence' })],
      connections: [{ fromCardId: 'p', toCardId: 'e', relation: 'supports' }],
    }));
    expect(observationIds(backwards)).toContain('unsupported-problems');
  });

  it('notices a wish list', () => {
    const result = assessIdeationReadiness(input({
      cards: [
        card({ id: 'a', kind: 'idea' }), card({ id: 'b', kind: 'idea' }),
        card({ id: 'c', kind: 'idea' }), card({ id: 'd', kind: 'idea' }),
      ],
    }));
    expect(observationIds(result)).toContain('assertion-heavy');
  });

  it('notices a board where nothing could go wrong', () => {
    const result = assessIdeationReadiness(input({
      cards: [
        card({ id: 'a', kind: 'problem' }), card({ id: 'b', kind: 'requirement' }),
        card({ id: 'c', kind: 'evidence' }), card({ id: 'd', kind: 'experiment' }),
      ],
    }));
    expect(observationIds(result)).toContain('no-risk');
  });

  it('notices unconnected cards', () => {
    const result = assessIdeationReadiness(input({ cards: [card({ id: 'lonely' })] }));
    expect(observationIds(result)).toContain('orphans');
  });
});

describe('reaching the backlog', () => {
  const derived = {
    roadmapText: 'Fix: webhook has no rate limit',
    roadmapNormalized: normalizeForRoadmapMatch('Fix: webhook has no rate limit'),
    derivedAt: '2026-07-30T00:00:00.000Z',
  };

  it('reports a board that never left the whiteboard', () => {
    const result = assessIdeationReadiness(input({ cards: [card({ kind: 'problem' })] }));
    expect(observationIds(result)).toContain('never-realized');
  });

  it('reports a card that became work, and only when the item still exists', () => {
    const matched = assessIdeationReadiness(input({
      cards: [card({ kind: 'problem', derived })],
      roadmapItems: [{ id: 'roadmap-1', text: 'Fix: webhook has no rate limit', completed: false }],
    }));
    expect(observationIds(matched)).toContain('reaching-backlog');

    // The item was renamed. The link no longer resolves, so the card is
    // unrealized again rather than credited to whatever now sits there.
    const renamed = assessIdeationReadiness(input({
      cards: [card({ kind: 'problem', derived })],
      roadmapItems: [{ id: 'roadmap-1', text: 'Something else entirely', completed: false }],
    }));
    expect(observationIds(renamed)).toContain('never-realized');
    expect(renamed.unrealized).toBe(1);
  });
});

describe('a board that carries an argument', () => {
  it('reads as argued when nothing weak or blocking applies', () => {
    const derived = {
      roadmapText: 'Fix: rate limit',
      roadmapNormalized: normalizeForRoadmapMatch('Fix: rate limit'),
      derivedAt: '2026-07-30T00:00:00.000Z',
    };
    const result = assessIdeationReadiness(input({
      cards: [
        card({ id: 'p', kind: 'problem', derived }),
        card({ id: 'e', kind: 'evidence' }),
        card({ id: 'r', kind: 'risk' }),
        card({ id: 'q', kind: 'requirement' }),
      ],
      connections: [
        { fromCardId: 'e', toCardId: 'p', relation: 'supports' },
        { fromCardId: 'r', toCardId: 'p', relation: 'dependency' },
        { fromCardId: 'q', toCardId: 'p', relation: 'dependency' },
      ],
      roadmapItems: [{ id: 'roadmap-1', text: 'Fix: rate limit', completed: false }],
    }));
    expect(result.state).toBe('argued');
    expect(result.summary).toContain('carries an argument');
  });
});

describe('every observation publishes the rule that produced it', () => {
  it('carries a non-empty rule on every reading', () => {
    const result = assessIdeationReadiness(input({ cards: [card()] }));
    expect(result.observations.length).toBeGreaterThan(0);
    for (const observation of result.observations) {
      expect(observation.rule.length).toBeGreaterThan(5);
      expect(observation.detail.length).toBeGreaterThan(20);
    }
  });
});

describe('the roadmap key cannot drift from the derivation', () => {
  it('uses the same normalizer as ideationDerivation', () => {
    // Two normalizers drifting apart would silently break every card-to-item
    // link at once, which is exactly why the dashboard's copy is pinned too.
    const source = readFileSync(path.join(process.cwd(), 'src/core/ideationReadiness.ts'), 'utf8');
    const body = source.slice(source.indexOf('function normalizeRoadmapKey'));
    expect(body).toContain(".toLowerCase().replace(/\\s+/g, ' ').replace(/[.\\s]+$/, '').trim()");
    for (const sample of ['  Fix: Rate  Limit. ', 'API rate limit', 'Trial: thing...']) {
      const viaDerivation = normalizeForRoadmapMatch(sample);
      const result = assessIdeationReadiness(input({
        cards: [card({
          kind: 'problem',
          derived: { roadmapText: sample, roadmapNormalized: viaDerivation, derivedAt: '2026-01-01T00:00:00.000Z' },
        })],
        roadmapItems: [{ id: 'roadmap-1', text: sample, completed: false }],
      }));
      expect(observationIds(result)).toContain('reaching-backlog');
    }
  });
});
