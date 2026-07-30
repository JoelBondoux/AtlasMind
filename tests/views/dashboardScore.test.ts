import { describe, expect, it } from 'vitest';

import { buildContributorSeries, buildScoreBreakdown } from '../../src/views/projectDashboardPanel.ts';

type ScoreInput = Parameters<typeof buildScoreBreakdown>[0];

function makeInput(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    ssotPath: 'project_memory',
    securityPolicyPresent: true,
    codeownersPresent: true,
    prTemplatePresent: true,
    workflowCount: 2,
    dirty: false,
    behind: 0,
    ssotCoveragePercent: 80,
    blockedEntries: 0,
    warnedEntries: 0,
    totalEntries: 20,
    autopilot: false,
    governanceProviderCount: 2,
    allowTerminalWrite: false,
    autoVerifyAfterWrite: true,
    ciSignals: [{ label: 'ci', ok: true }],
    reviewReadiness: [{ label: 'review', ok: true }],
    outcomeCompleteness: {
      desiredOutcome: 'Ship the thing',
      score: 80,
      summary: 'Outcome is well defined.',
      referenceCoveragePercent: 80,
      roadmapCompleted: 4,
      roadmapTotal: 5,
      runCompletionPercent: 80,
      signals: [],
    },
    risk: {
      filePath: 'project_memory/operations/risk-oversight.json',
      summaryPath: 'project_memory/operations/risk-oversight.md',
      assessed: false,
      domains: [],
      findings: [],
      openCount: 0,
      acceptedCount: 0,
      resolvedCount: 0,
      matrix: {},
      trend: [],
      history: [],
      summary: 'Risk has not been assessed yet.',
    },
    privacy: {
      enabled: false,
      rules: [],
      compliancePacks: [],
      trustedModelIds: [],
      providers: [],
      packs: [],
      activity: { total: 0, redactedCount: 0, bySource: [], byDay: [] },
      governance: [],
    },
    ...overrides,
  } as ScoreInput;
}

/**
 * A project that has done everything the score asks of it. Kept in one place so
 * a new category shows up as a single failing assertion rather than a puzzle.
 */
const PERFECT: Partial<ScoreInput> = {
  ssotCoveragePercent: 100,
  outcomeCompleteness: { ...makeInput().outcomeCompleteness, score: 100 },
  risk: { ...makeInput().risk, assessed: true, score: 100 },
  privacy: {
    ...makeInput().privacy,
    enabled: true,
    compliancePacks: ['gdpr'],
    trustedModelIds: ['local/llama'],
  },
  testing: { assessable: 6, evidenced: 6, hasReport: true, failing: 0 },
};

/** Mirrors how collectDashboardSnapshot derives the headline number. */
function normalize(components: Array<{ score: number; maxScore: number }>): number {
  const earned = components.reduce((total, component) => total + component.score, 0);
  const available = components.reduce((total, component) => total + component.maxScore, 0);
  return available > 0 ? Math.round((earned / available) * 100) : 0;
}

describe('buildScoreBreakdown — risk component', () => {
  // This reverses the original contract, which omitted risk until an advisor had
  // run so that shipping the feature could not drop anyone's score overnight.
  // That protected the number at the cost of what the number is for: with the
  // component absent, a project never assessed scored *identically* to one
  // assessed and found clean — the one comparison the score most needs to make.
  it('always carries a risk component, scoring zero until the project is assessed', () => {
    const breakdown = buildScoreBreakdown(makeInput());
    const risk = breakdown.components.find(component => component.id === 'risk');
    expect(risk).toBeDefined();
    expect(risk!.score).toBe(0);
    expect(risk!.maxScore).toBe(15);
    expect(risk!.tone).toBe('warn');
    expect(risk!.detail).toMatch(/unclaimed/i);
  });

  it('scores an unassessed project below an assessed-and-clean one', () => {
    const unassessed = normalize(buildScoreBreakdown(makeInput()).components);
    const clean = normalize(buildScoreBreakdown(makeInput({
      risk: { ...makeInput().risk, assessed: true, score: 100 },
    })).components);
    expect(unassessed).toBeLessThan(clean);
  });

  it('tells the manager how to claim the unassessed points', () => {
    const breakdown = buildScoreBreakdown(makeInput());
    expect(breakdown.recommendations.some(entry => /\+15 pts/.test(JSON.stringify(entry)))).toBe(true);
  });

  it('adds risk once assessed, and a clean register raises nothing alarming', () => {
    const breakdown = buildScoreBreakdown(makeInput({
      risk: { ...makeInput().risk, assessed: true, score: 100, summary: 'No open findings.' },
    }));
    const risk = breakdown.components.find(component => component.id === 'risk');
    expect(risk).toBeDefined();
    expect(risk!.score).toBe(15);
    expect(risk!.maxScore).toBe(15);
    expect(risk!.tone).toBe('good');
    expect(risk!.pageTarget).toBe('risk');
  });

  it('scales the risk component from the 0-100 register score', () => {
    for (const [registerScore, expected] of [[0, 0], [50, 8], [80, 12], [100, 15]] as const) {
      const breakdown = buildScoreBreakdown(makeInput({
        risk: { ...makeInput().risk, assessed: true, score: registerScore },
      }));
      expect(breakdown.components.find(component => component.id === 'risk')!.score, String(registerScore))
        .toBe(expected);
    }
  });

  it('escalates tone as the register score falls', () => {
    const toneAt = (score: number) => buildScoreBreakdown(makeInput({
      risk: { ...makeInput().risk, assessed: true, score },
    })).components.find(component => component.id === 'risk')!.tone;

    expect(toneAt(90)).toBe('good');
    expect(toneAt(60)).toBe('accent');
    expect(toneAt(40)).toBe('warn');
    expect(toneAt(10)).toBe('critical');
  });

  it('drags the normalised total down when risk is bad, not just the risk row', () => {
    const clean = normalize(buildScoreBreakdown(makeInput({
      risk: { ...makeInput().risk, assessed: true, score: 100 },
    })).components);
    const bad = normalize(buildScoreBreakdown(makeInput({
      risk: { ...makeInput().risk, assessed: true, score: 0 },
    })).components);
    expect(bad).toBeLessThan(clean);
  });
});

describe('buildScoreBreakdown — privacy component', () => {
  it('always carries a privacy component, scoring zero until configured', () => {
    const privacy = buildScoreBreakdown(makeInput()).components
      .find(component => component.id === 'privacy');
    expect(privacy).toBeDefined();
    expect(privacy!.score).toBe(0);
    expect(privacy!.maxScore).toBe(12);
    expect(privacy!.tone).toBe('warn');
    expect(privacy!.pageTarget).toBe('privacy');
    expect(privacy!.detail).toMatch(/unclaimed/i);
  });

  it('credits the gate, the packs and the trusted models independently', () => {
    const scoreFor = (privacy: Partial<ScoreInput['privacy']>) => buildScoreBreakdown(makeInput({
      privacy: { ...makeInput().privacy, ...privacy },
    })).components.find(component => component.id === 'privacy')!.score;

    expect(scoreFor({ enabled: true })).toBe(5);
    expect(scoreFor({ compliancePacks: ['gdpr'] })).toBe(4);
    expect(scoreFor({ trustedModelIds: ['local/llama'] })).toBe(3);
    expect(scoreFor({ enabled: true, compliancePacks: ['gdpr'], trustedModelIds: ['local/llama'] })).toBe(12);
  });

  it('counts an enabled rule as cover even with no compliance pack chosen', () => {
    // A hand-written rule is a deliberate act; refusing it credit would push
    // people toward packs they do not need just to move the number.
    const score = buildScoreBreakdown(makeInput({
      privacy: {
        ...makeInput().privacy,
        rules: [{ id: 'r1', label: 'Customer IDs', pattern: '\\bCUS-\\d+', enabled: true } as never],
      },
    })).components.find(component => component.id === 'privacy')!.score;
    expect(score).toBe(4);
  });

  it('ignores a rule that exists but is switched off', () => {
    const score = buildScoreBreakdown(makeInput({
      privacy: {
        ...makeInput().privacy,
        rules: [{ id: 'r1', label: 'Customer IDs', pattern: '\\bCUS-\\d+', enabled: false } as never],
      },
    })).components.find(component => component.id === 'privacy')!.score;
    expect(score).toBe(0);
  });
});

describe('buildScoreBreakdown — normalisation invariant', () => {
  it('never lets a component exceed its own maxScore', () => {
    const breakdown = buildScoreBreakdown(makeInput({
      risk: { ...makeInput().risk, assessed: true, score: 100 },
    }));
    for (const component of breakdown.components) {
      expect(component.score, component.id).toBeGreaterThanOrEqual(0);
      expect(component.score, component.id).toBeLessThanOrEqual(component.maxScore);
    }
  });

  it('normalises a perfect project to 100', () => {
    // Guards the reason the denominator is derived rather than hard-coded: adding
    // a category must not push a perfect score past 100, nor dilute it below.
    // Every category now counts unconditionally, so "perfect" has to include
    // having actually run the advisors and configured the privacy gate.
    expect(normalize(buildScoreBreakdown(makeInput(PERFECT)).components)).toBe(100);
  });

  it('leaves no component unearned in the perfect fixture', () => {
    // If a new category is added without extending PERFECT, the test above would
    // fail with an opaque number. This says which row is short.
    for (const component of buildScoreBreakdown(makeInput(PERFECT)).components) {
      expect(component.score, `${component.id} is not maxed in the perfect fixture`)
        .toBe(component.maxScore);
    }
  });

  it('normalises a worst-case project to 0', () => {
    const breakdown = buildScoreBreakdown(makeInput({
      securityPolicyPresent: false,
      codeownersPresent: false,
      prTemplatePresent: false,
      autoVerifyAfterWrite: false,
      allowTerminalWrite: true,
      autopilot: true,
      blockedEntries: 3,
      workflowCount: 0,
      dirty: true,
      behind: 4,
      ssotCoveragePercent: 0,
      totalEntries: 0,
      governanceProviderCount: 0,
      ciSignals: [{ label: 'ci', ok: false }],
      reviewReadiness: [{ label: 'review', ok: false }],
      outcomeCompleteness: { ...makeInput().outcomeCompleteness, score: 0 },
      risk: { ...makeInput().risk, assessed: true, score: 0 },
    }));
    expect(normalize(breakdown.components)).toBe(0);
  });
});

describe('buildContributorSeries', () => {
  const day = (offset: number): string => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    return date.toISOString().slice(0, 10);
  };

  it('ranks contributors by commit count and builds a series each', () => {
    const result = buildContributorSeries([
      { date: day(0), author: 'Ada' },
      { date: day(1), author: 'Ada' },
      { date: day(1), author: 'Grace' },
    ], 7);
    expect(result.contributors.map(c => c.name)).toEqual(['Ada', 'Grace']);
    expect(result.contributors[0]!.total).toBe(2);
    expect(result.contributors[0]!.series).toHaveLength(7);
    expect(result.totalCommits).toBe(3);
    expect(result.otherCount).toBe(0);
  });

  it('merges the long tail into one Others entry rather than dropping it', () => {
    // A chart that silently omitted contributors would misreport who did the
    // work, so the overflow keeps its commits and says how many people it is.
    const entries = Array.from({ length: 12 }, (_, i) => ({ date: day(0), author: `Dev ${i}` }));
    const result = buildContributorSeries(entries, 7, 3);
    expect(result.contributors).toHaveLength(4);
    expect(result.contributors[3]!.name).toBe('Others (9)');
    expect(result.contributors[3]!.total).toBe(9);
    expect(result.otherCount).toBe(9);
    const charted = result.contributors.reduce((sum, entry) => sum + entry.total, 0);
    expect(charted).toBe(result.totalCommits);
  });

  it('orders ties by name so slice colours are stable between renders', () => {
    const result = buildContributorSeries([
      { date: day(0), author: 'Zoe' },
      { date: day(0), author: 'Ada' },
    ], 7);
    expect(result.contributors.map(c => c.name)).toEqual(['Ada', 'Zoe']);
  });

  it('labels a missing author rather than dropping the commit', () => {
    const result = buildContributorSeries([{ date: day(0), author: '' }], 7);
    expect(result.contributors[0]!.name).toBe('Unknown');
    expect(result.totalCommits).toBe(1);
  });

  it('ignores entries with no usable date', () => {
    const result = buildContributorSeries([
      { date: '', author: 'Ada' },
      { date: day(0), author: 'Ada' },
    ], 7);
    expect(result.totalCommits).toBe(1);
  });

  it('clamps a long author name', () => {
    const result = buildContributorSeries([{ date: day(0), author: 'a'.repeat(200) }], 7);
    expect(result.contributors[0]!.name.length).toBeLessThanOrEqual(60);
  });

  it('returns an empty-but-valid result for no commits', () => {
    const result = buildContributorSeries([], 7);
    expect(result.contributors).toEqual([]);
    expect(result.totalCommits).toBe(0);
  });
});

describe('buildScoreBreakdown — testing component', () => {
  const testingComponent = (input: Partial<ScoreInput>) =>
    buildScoreBreakdown(makeInput(input)).components.find(component => component.id === 'testing');

  it('is always present, so a project that declared nothing does not score the same as one that did', () => {
    // Before this component existed a project with fourteen declared and zero
    // evidenced scored *better* than one that declared none, because neither
    // carried a testing number and the first looked more organised elsewhere.
    const component = testingComponent({});
    expect(component).toBeDefined();
    expect(component!.maxScore).toBe(15);
    expect(component!.score).toBe(0);
    expect(component!.pageTarget).toBe('testing');
  });

  it('reads an unassessed project as unclaimed rather than failing', () => {
    const component = testingComponent({});
    // `warn`, not `critical`: nobody has looked, which is not the same as looking
    // and finding it broken.
    expect(component!.tone).toBe('warn');
    expect(component!.detail).toContain('unclaimed');
  });

  it('scores evidence as a ratio and the report separately', () => {
    const full = testingComponent({ testing: { assessable: 4, evidenced: 4, hasReport: true, failing: 0 } });
    expect(full!.score).toBe(15);
    expect(full!.tone).toBe('good');

    const half = testingComponent({ testing: { assessable: 4, evidenced: 2, hasReport: true, failing: 0 } });
    expect(half!.score).toBe(10);
  });

  it('withholds the report points when no report exists, and says pass/fail is unknown', () => {
    const component = testingComponent({ testing: { assessable: 4, evidenced: 4, hasReport: false, failing: 0 } });

    // The exact state that let this project's Testing page look settled for
    // seven weeks: everything evidenced, nothing verified.
    expect(component!.score).toBe(10);
    expect(component!.detail).toContain('unknown rather than clean');
  });

  it('costs points for failing tests without erasing the evidence already there', () => {
    const clean = testingComponent({ testing: { assessable: 4, evidenced: 4, hasReport: true, failing: 0 } });
    const failing = testingComponent({ testing: { assessable: 4, evidenced: 4, hasReport: true, failing: 3 } });

    expect(failing!.score).toBeLessThan(clean!.score);
    expect(failing!.score).toBe(12);
    expect(failing!.detail).toContain('3 failing');
  });

  it('recommends declaring a policy when none is enabled', () => {
    const breakdown = buildScoreBreakdown(makeInput({}));
    const recommendation = breakdown.recommendations.find(entry => entry.pageTarget === 'testing');
    expect(recommendation?.impactLabel).toBe('+15 pts');
  });

  it('recommends closing or retiring unevidenced methodologies', () => {
    const breakdown = buildScoreBreakdown(makeInput({
      testing: { assessable: 10, evidenced: 2, hasReport: true, failing: 0 },
    }));
    const recommendation = breakdown.recommendations.find(entry => entry.pageTarget === 'testing');
    // "Close or retire" — both are legitimate resolutions. A declaration the
    // project has outgrown is not a failure to fix by writing tests for it.
    expect(recommendation?.title).toContain('retire');
    expect(recommendation?.title).toContain('8');
  });
});
