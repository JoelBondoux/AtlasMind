import { describe, expect, it } from 'vitest';

import { buildScoreBreakdown } from '../../src/views/projectDashboardPanel.ts';

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
    ...overrides,
  } as ScoreInput;
}

/** Mirrors how collectDashboardSnapshot derives the headline number. */
function normalize(components: Array<{ score: number; maxScore: number }>): number {
  const earned = components.reduce((total, component) => total + component.score, 0);
  const available = components.reduce((total, component) => total + component.maxScore, 0);
  return available > 0 ? Math.round((earned / available) * 100) : 0;
}

describe('buildScoreBreakdown — risk component', () => {
  it('omits risk entirely until the project has been assessed', () => {
    const breakdown = buildScoreBreakdown(makeInput());
    expect(breakdown.components.map(component => component.id)).not.toContain('risk');
  });

  it('leaves the normalised score untouched when risk is unassessed', () => {
    // The safety property: shipping this feature must not silently drop the health
    // score of every existing project for a risk nobody has been told about.
    const withoutRiskFeature = buildScoreBreakdown(makeInput()).components
      .filter(component => component.id !== 'risk');
    const asShipped = buildScoreBreakdown(makeInput()).components;
    expect(normalize(asShipped)).toBe(normalize(withoutRiskFeature));
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

  it('normalises a perfect project to 100 with and without risk', () => {
    // Guards the reason the denominator is derived rather than hard-coded: adding a
    // 7th category must not push a perfect score past 100, nor dilute it below.
    const perfect: Partial<ScoreInput> = {
      ssotCoveragePercent: 100,
      outcomeCompleteness: { ...makeInput().outcomeCompleteness, score: 100 },
    };
    expect(normalize(buildScoreBreakdown(makeInput(perfect)).components)).toBe(100);
    expect(normalize(buildScoreBreakdown(makeInput({
      ...perfect,
      risk: { ...makeInput().risk, assessed: true, score: 100 },
    })).components)).toBe(100);
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
