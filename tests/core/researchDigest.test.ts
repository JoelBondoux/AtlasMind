import { describe, expect, it } from 'vitest';

import { RESEARCH_SCANS } from '../../src/core/researchScanCatalog.js';
import {
  recordScanRun,
  seedResearchRegister,
  type ResearchFinding,
  type ResearchRegister,
} from '../../src/core/researchRegister.js';
import { buildResearchSchedule, type ResearchScheduleInput } from '../../src/core/researchSchedule.js';
import {
  buildResearchDigest,
  renderResearchDigestMarkdown,
  type ResearchDigestBaseline,
} from '../../src/core/researchDigest.js';

const NOW = new Date('2026-07-30T12:00:00.000Z');
const EARLIER = new Date('2026-06-30T12:00:00.000Z');

function finding(overrides: Partial<ResearchFinding> = {}): ResearchFinding {
  return {
    id: 'competition-acme-shipped-a-planner',
    scanId: 'competition',
    kind: 'finding',
    title: 'Acme shipped a planner',
    detail: '',
    severity: 'low',
    rule: 'a single cited observation',
    citations: [{ url: 'https://example.com/p', host: 'example.com', fetchedAt: NOW.toISOString() }],
    status: 'open',
    firstSeenAt: NOW.toISOString(),
    lastSeenAt: NOW.toISOString(),
    transitions: [],
    ...overrides,
  };
}

function registerWith(findings: ResearchFinding[], scanned: Array<ResearchFinding['scanId']> = ['competition']): ResearchRegister {
  let state: ResearchRegister = { ...seedResearchRegister(NOW), findings };
  for (const scanId of scanned) {
    state = recordScanRun(state, {
      scanId, ranAt: NOW.toISOString(), outcome: 'ok', findingCount: findings.length, questionCount: 0,
    });
  }
  return state;
}

function scheduleFor(register: ResearchRegister, overrides: Partial<ResearchScheduleInput> = {}) {
  return buildResearchSchedule({
    enabled: true,
    masterLevel: 'observe',
    scans: Object.fromEntries(RESEARCH_SCANS.map(scan => [scan.id, { enabled: true }])),
    register,
    sourceAvailable: true,
    monthlySpendCapUsd: 10,
    spentThisMonthUsd: 0,
    now: NOW,
    ...overrides,
  });
}

function baseline(overrides: Partial<ResearchDigestBaseline> = {}): ResearchDigestBaseline {
  return {
    takenAt: EARLIER.toISOString(),
    knownFindingIds: [],
    assessedScans: ['competition'],
    scope: 'acme/atlas',
    ...overrides,
  };
}

describe('rule 1 — no baseline is a first look', () => {
  it('says so rather than reporting every finding as a change', () => {
    const register = registerWith([finding()]);
    const digest = buildResearchDigest({ register, schedule: scheduleFor(register), scope: 'acme/atlas', now: NOW });
    expect(digest.status).toBe('first-look');
    expect(digest.changed[0]!.text).toContain('nothing here is a change');
    expect(digest.summary).toContain('First look');
  });
});

describe('rule 4 — a changed scope discards the baseline', () => {
  it('refuses to subtract two unrelated readings', () => {
    const register = registerWith([finding()]);
    const digest = buildResearchDigest({
      register,
      schedule: scheduleFor(register),
      baseline: baseline({ scope: 'someone/else' }),
      scope: 'acme/atlas',
      now: NOW,
    });
    expect(digest.status).toBe('scope-changed');
    expect(digest.changed[0]!.text).toContain('discarded');
  });
});

describe('rule 2 — unknown to known is not zero to n', () => {
  it('reports a first assessment as a first assessment', () => {
    const register = registerWith(
      [finding({ id: 'market-category-shrinking', scanId: 'market' })],
      ['competition', 'market'],
    );
    const digest = buildResearchDigest({
      register,
      schedule: scheduleFor(register),
      baseline: baseline(),
      scope: 'acme/atlas',
      now: NOW,
    });
    const line = digest.changed.find(entry => entry.scanId === 'market')!;
    expect(line.text).toContain('assessed for the first time');
    expect(line.text).toContain('never looked for before');
  });
});

describe('rule 3 — known to unknown is news, ranked above what it hides', () => {
  it('leads with a scan that can no longer run', () => {
    const register = registerWith([finding({ id: 'competition-new', severity: 'high' })]);
    const digest = buildResearchDigest({
      register,
      schedule: scheduleFor(register, { sourceAvailable: false }),
      baseline: baseline(),
      scope: 'acme/atlas',
      now: NOW,
    });
    expect(digest.changed[0]!.text).toContain('can no longer run');
    expect(digest.changed[0]!.text).toContain('unknown rather than absent');
  });
});

describe('rule 5 — your own actions are not news', () => {
  it('does not report a finding the user dismissed back at them', () => {
    const register = registerWith([finding({ status: 'dismissed' })]);
    const digest = buildResearchDigest({
      register,
      schedule: scheduleFor(register),
      baseline: baseline(),
      scope: 'acme/atlas',
      now: NOW,
    });
    expect(digest.changed.some(line => line.findingId === finding().id)).toBe(false);
  });

  it('does report something genuinely new from an already-assessed scan', () => {
    const register = registerWith([finding()]);
    const digest = buildResearchDigest({
      register,
      schedule: scheduleFor(register),
      baseline: baseline(),
      scope: 'acme/atlas',
      now: NOW,
    });
    expect(digest.changed.some(line => line.findingId === finding().id)).toBe(true);
  });
});

describe('question 3 is always answered', () => {
  it('names every scan that has never produced an answer', () => {
    const register = registerWith([finding()]);
    const digest = buildResearchDigest({ register, schedule: scheduleFor(register), scope: 'acme/atlas', now: NOW });
    // Six of the seven have never run.
    expect(digest.unassessed.length).toBeGreaterThanOrEqual(RESEARCH_SCANS.length - 1);
    expect(digest.unassessed.some(line => line.text.includes('never run'))).toBe(true);
  });

  it('distinguishes never run from attempted with no source', () => {
    let register = registerWith([finding()]);
    register = recordScanRun(register, {
      scanId: 'market', ranAt: NOW.toISOString(), outcome: 'no-source', findingCount: 0, questionCount: 0,
    });
    const digest = buildResearchDigest({ register, schedule: scheduleFor(register), scope: 'acme/atlas', now: NOW });
    expect(digest.unassessed.some(line => line.text.includes('no research source could answer it'))).toBe(true);
  });

  it('is never truncated by the cap', () => {
    const register = seedResearchRegister(NOW);
    const digest = buildResearchDigest({ register, schedule: scheduleFor(register), scope: 'acme/atlas', now: NOW });
    expect(digest.unassessed).toHaveLength(RESEARCH_SCANS.length);
  });

  it('surfaces uncited claims as questions rather than counting them as evidence', () => {
    const register = registerWith([finding({ id: 'competition-hunch', kind: 'question', citations: [] })]);
    const digest = buildResearchDigest({ register, schedule: scheduleFor(register), scope: 'acme/atlas', now: NOW });
    expect(digest.unassessed.some(line => line.text.includes('recorded without a source'))).toBe(true);
  });
});

describe('question 2 comes from the declared table, not a model', () => {
  it('uses the catalog implication and states the counts', () => {
    const register = registerWith([finding({ severity: 'high' })]);
    const digest = buildResearchDigest({ register, schedule: scheduleFor(register), scope: 'acme/atlas', now: NOW });
    expect(digest.meaning[0]!.text).toContain('Where this project should differentiate');
    expect(digest.meaning[0]!.text).toContain('1 graded high');
  });

  it('produces the same digest twice from the same register', () => {
    const register = registerWith([finding(), finding({ id: 'competition-b', title: 'Rival raised money' })]);
    const first = buildResearchDigest({ register, schedule: scheduleFor(register), scope: 'acme/atlas', now: NOW });
    const second = buildResearchDigest({ register, schedule: scheduleFor(register), scope: 'acme/atlas', now: NOW });
    expect(first).toEqual(second);
  });
});

describe('the markdown always carries all three headings', () => {
  it('renders them even when every section is empty', () => {
    const register = seedResearchRegister(NOW);
    const digest = buildResearchDigest({ register, schedule: scheduleFor(register), scope: 'acme/atlas', now: NOW });
    const markdown = renderResearchDigestMarkdown(digest, NOW);
    expect(markdown).toContain('## 1. What changed outside');
    expect(markdown).toContain('## 2. What it means for what we are building');
    expect(markdown).toContain('## 3. What is still unassessed');
    expect(markdown).toContain('No claim here was written by a model');
  });
});

describe('the next baseline is taken from the register that produced the digest', () => {
  it('records the ids and the scans that had answered', () => {
    const register = registerWith([finding()]);
    const digest = buildResearchDigest({ register, schedule: scheduleFor(register), scope: 'acme/atlas', now: NOW });
    expect(digest.nextBaseline.knownFindingIds).toContain(finding().id);
    expect(digest.nextBaseline.assessedScans).toEqual(['competition']);
    expect(digest.nextBaseline.scope).toBe('acme/atlas');
  });
});
