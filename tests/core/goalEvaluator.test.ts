import { describe, expect, it } from 'vitest';
import { GoalEvaluator, applyVerificationGuard, parseGoalVerdict } from '../../src/core/goalEvaluator.ts';
import type { GoalEvaluationInput } from '../../src/core/goalEvaluator.ts';

// ── parseGoalVerdict (untrusted output) ──────────────────────────

describe('parseGoalVerdict', () => {
  it('parses a clean JSON verdict', () => {
    const v = parseGoalVerdict('{"verdict":"achieved","confidence":0.9,"remaining":[],"nextFocus":"","rationale":"done"}');
    expect(v).toEqual({ verdict: 'achieved', confidence: 0.9, remaining: [], nextFocus: '', rationale: 'done' });
  });

  it('strips markdown fences and extra prose', () => {
    const raw = 'Here is my verdict:\n```json\n{"verdict":"progressing","confidence":0.5,"remaining":["x"],"nextFocus":"y","rationale":"r"}\n```';
    const v = parseGoalVerdict(raw);
    expect(v?.verdict).toBe('progressing');
    expect(v?.remaining).toEqual(['x']);
  });

  it('clamps confidence into [0,1]', () => {
    expect(parseGoalVerdict('{"verdict":"stalled","confidence":5}')?.confidence).toBe(1);
    expect(parseGoalVerdict('{"verdict":"stalled","confidence":-3}')?.confidence).toBe(0);
    expect(parseGoalVerdict('{"verdict":"stalled","confidence":"0.4"}')?.confidence).toBeCloseTo(0.4);
  });

  it('rejects an unknown verdict kind', () => {
    expect(parseGoalVerdict('{"verdict":"winning","confidence":1}')).toBeUndefined();
  });

  it('returns undefined for malformed / empty / non-object input', () => {
    expect(parseGoalVerdict('not json at all')).toBeUndefined();
    expect(parseGoalVerdict('')).toBeUndefined();
    expect(parseGoalVerdict('[1,2,3]')).toBeUndefined();
    expect(parseGoalVerdict('{"verdict":')).toBeUndefined();
  });

  it('coerces non-array remaining to an empty list and bounds the count', () => {
    expect(parseGoalVerdict('{"verdict":"stalled","remaining":"oops"}')?.remaining).toEqual([]);
    const many = Array.from({ length: 50 }, (_, i) => `item-${i}`);
    const v = parseGoalVerdict(JSON.stringify({ verdict: 'progressing', remaining: many }));
    expect(v!.remaining.length).toBeLessThanOrEqual(12);
  });
});

// ── applyVerificationGuard ───────────────────────────────────────

const baseInput = (over: Partial<GoalEvaluationInput> = {}): GoalEvaluationInput => ({
  goal: 'Build a thing',
  iterationIndex: 1,
  maxIterations: 8,
  latestSynthesis: 'did work',
  changedFiles: [{ relativePath: 'src/a.ts', status: 'modified' }],
  ...over,
});

describe('applyVerificationGuard', () => {
  it('downgrades achieved → progressing when files changed but verification is missing', () => {
    const guarded = applyVerificationGuard(
      { verdict: 'achieved', confidence: 0.95, remaining: [], nextFocus: '', rationale: 'done' },
      baseInput({ tddStatus: 'missing' }),
    );
    expect(guarded.verdict).toBe('progressing');
    expect(guarded.confidence).toBeLessThanOrEqual(0.5);
  });

  it('downgrades achieved → progressing when verification is blocked', () => {
    const guarded = applyVerificationGuard(
      { verdict: 'achieved', confidence: 0.9, remaining: [], nextFocus: '', rationale: 'done' },
      baseInput({ tddStatus: 'blocked' }),
    );
    expect(guarded.verdict).toBe('progressing');
  });

  it('keeps achieved when verification passed', () => {
    const guarded = applyVerificationGuard(
      { verdict: 'achieved', confidence: 0.9, remaining: [], nextFocus: '', rationale: 'done' },
      baseInput({ tddStatus: 'verified' }),
    );
    expect(guarded.verdict).toBe('achieved');
  });

  it('keeps achieved when no files changed (nothing to verify)', () => {
    const guarded = applyVerificationGuard(
      { verdict: 'achieved', confidence: 0.9, remaining: [], nextFocus: '', rationale: 'done' },
      baseInput({ changedFiles: [], tddStatus: 'missing' }),
    );
    expect(guarded.verdict).toBe('achieved');
  });

  it('does not touch non-achieved verdicts', () => {
    const v = { verdict: 'stalled' as const, confidence: 0.2, remaining: [], nextFocus: '', rationale: 'r' };
    expect(applyVerificationGuard(v, baseInput({ tddStatus: 'blocked' }))).toEqual(v);
  });
});

// ── GoalEvaluator.evaluate ───────────────────────────────────────

describe('GoalEvaluator.evaluate', () => {
  it('returns a validated verdict from the completion function', async () => {
    const evaluator = new GoalEvaluator(async () =>
      '{"verdict":"progressing","confidence":0.6,"remaining":["finish tests"],"nextFocus":"tests","rationale":"r"}',
    );
    const v = await evaluator.evaluate(baseInput({ tddStatus: 'verified' }));
    expect(v.verdict).toBe('progressing');
    expect(v.nextFocus).toBe('tests');
  });

  it('falls back to stalled/zero-confidence on a malformed response', async () => {
    const evaluator = new GoalEvaluator(async () => 'totally not json');
    const v = await evaluator.evaluate(baseInput());
    expect(v.verdict).toBe('stalled');
    expect(v.confidence).toBe(0);
  });

  it('falls back safely when the completion function throws', async () => {
    const evaluator = new GoalEvaluator(async () => { throw new Error('network down'); });
    const v = await evaluator.evaluate(baseInput());
    expect(v.verdict).toBe('stalled');
    expect(v.confidence).toBe(0);
    expect(v.rationale).toContain('network down');
  });

  it('applies the verification guard to a model-claimed achievement', async () => {
    const evaluator = new GoalEvaluator(async () =>
      '{"verdict":"achieved","confidence":0.99,"remaining":[],"nextFocus":"","rationale":"all done"}',
    );
    const v = await evaluator.evaluate(baseInput({ tddStatus: 'missing' }));
    expect(v.verdict).toBe('progressing');
  });
});
