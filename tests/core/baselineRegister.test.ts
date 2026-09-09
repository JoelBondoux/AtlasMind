import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import {
  BASELINE_OLD_AFTER_DAYS,
  BASELINE_RULES,
  EMPTY_BASELINE_REGISTER,
  MAX_NAMED_BASELINES,
  captureBaseline,
  compareAgainstBaseline,
  orderedBaselines,
  removeBaseline,
  sanitizeBaselineRegister,
  type BaselineRegister,
} from '../../src/core/baselineRegister';
import type { WorkflowObservedState } from '../../src/core/workflowCurriculum';

const SOURCE = readFileSync(
  path.join(process.cwd(), 'src', 'core', 'baselineRegister.ts'),
  'utf8',
);
/** The source with its prose removed, for assertions about what it does. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

function state(overrides: Partial<WorkflowObservedState> = {}): WorkflowObservedState {
  return {
    repoSlug: 'acme/widgets',
    openIssueCount: 4,
    ...overrides,
  } as WorkflowObservedState;
}

function capture(register: BaselineRegister, label: string, now: string, current = state()) {
  return captureBaseline({ register, label, current, now });
}

describe('a named baseline is captured deliberately', () => {
  it('captures under a name, with the reading at that moment', () => {
    const result = capture(EMPTY_BASELINE_REGISTER, 'Before the migration', '2026-08-01T09:00:00.000Z');
    expect(result.captured?.label).toBe('Before the migration');
    expect(result.captured?.takenAt).toBe('2026-08-01T09:00:00.000Z');
    expect(result.register.baselines).toHaveLength(1);
  });

  it('writes nothing on a read', () => {
    // Asserted by behaviour, not by looking for words: the rule table says
    // "nothing expires", so a text search matches the sentence rather than the
    // code and passes for the wrong reason.
    let register = capture(EMPTY_BASELINE_REGISTER, 'Kept', '2026-08-01T09:00:00.000Z').register;
    register = capture(register, 'Also kept', '2026-08-02T09:00:00.000Z').register;
    const before = JSON.parse(JSON.stringify(register));
    compareAgainstBaseline({
      baseline: register.baselines[0],
      current: state({ openIssueCount: 99 }),
      now: '2026-12-01T09:00:00.000Z',
    });
    orderedBaselines(register);
    sanitizeBaselineRegister(register);
    expect(register).toEqual(before);
  });

  it('starts no timer, so nothing can advance while nobody is looking', () => {
    expect(CODE).not.toMatch(/setInterval|setTimeout/);
  });

  it('refuses a baseline with no name rather than inventing one', () => {
    const result = capture(EMPTY_BASELINE_REGISTER, '   ', '2026-08-01T09:00:00.000Z');
    expect(result.refusal).toBe('no-label');
    expect(result.detail).toBeTruthy();
    expect(result.register.baselines).toHaveLength(0);
  });

  it('refuses a duplicate name, since two spans with one name cannot be told apart', () => {
    const first = capture(EMPTY_BASELINE_REGISTER, 'Release 1.0', '2026-08-01T09:00:00.000Z');
    const second = capture(first.register, 'release 1.0', '2026-08-08T09:00:00.000Z');
    expect(second.refusal).toBe('duplicate-label');
    expect(second.register.baselines).toHaveLength(1);
  });
});

describe('past the cap, capture is refused and the oldest is never evicted', () => {
  function full(): BaselineRegister {
    let register: BaselineRegister = EMPTY_BASELINE_REGISTER;
    for (let index = 0; index < MAX_NAMED_BASELINES; index += 1) {
      const day = String(index + 1).padStart(2, '0');
      register = capture(register, `Baseline ${index}`, `2026-08-${day}T09:00:00.000Z`).register;
    }
    return register;
  }

  it('keeps every existing baseline and says what to remove', () => {
    const register = full();
    const result = capture(register, 'One too many', '2026-09-01T09:00:00.000Z');
    expect(result.refusal).toBe('at-capacity');
    expect(result.register.baselines).toHaveLength(MAX_NAMED_BASELINES);
    // The oldest is the only one that can answer a question about the whole
    // project, so it is named rather than discarded.
    expect(result.detail).toContain('Baseline 0');
    expect(result.register.baselines.some(entry => entry.label === 'Baseline 0')).toBe(true);
  });

  it('accepts again once somebody removes one', () => {
    const register = full();
    const trimmed = removeBaseline(register, register.baselines[3].id);
    expect(trimmed.baselines).toHaveLength(MAX_NAMED_BASELINES - 1);
    expect(capture(trimmed, 'Now there is room', '2026-09-01T09:00:00.000Z').captured).toBeTruthy();
  });

  it('removing an id that is not there changes nothing', () => {
    const register = capture(EMPTY_BASELINE_REGISTER, 'Kept', '2026-08-01T09:00:00.000Z').register;
    expect(removeBaseline(register, 'baseline-nope').baselines).toHaveLength(1);
  });
});

describe('the age is always stated', () => {
  const baseline = capture(EMPTY_BASELINE_REGISTER, 'Release 1.0', '2026-08-01T09:00:00.000Z').captured!;

  it('carries the day count and the span sentence on every comparison', () => {
    const comparison = compareAgainstBaseline({
      baseline,
      current: state({ openIssueCount: 9 }),
      now: '2026-09-12T09:00:00.000Z',
    });
    expect(comparison.ageDays).toBe(42);
    expect(comparison.span).toContain('42 days ago');
    expect(comparison.span).toContain('Release 1.0');
  });

  it('grades a baseline older than the declared window as old', () => {
    const fresh = compareAgainstBaseline({ baseline, current: state(), now: '2026-08-02T09:00:00.000Z' });
    expect(fresh.staleness).toBe('fresh');
    const old = compareAgainstBaseline({
      baseline,
      current: state(),
      now: `2026-10-01T09:00:00.000Z`,
    });
    expect(old.ageDays).toBeGreaterThanOrEqual(BASELINE_OLD_AFTER_DAYS);
    expect(old.staleness).toBe('old');
  });

  it('says nothing moved rather than reporting an empty list of changes', () => {
    const comparison = compareAgainstBaseline({
      baseline,
      current: state(),
      now: '2026-08-01T10:00:00.000Z',
    });
    expect(comparison.delta.status).toBe('unchanged');
    expect(comparison.span).toContain('Nothing tracked has moved');
  });
});

describe('a baseline that cannot speak here is reported, never deleted', () => {
  it('says why rather than reporting no changes', () => {
    const baseline = capture(EMPTY_BASELINE_REGISTER, 'Other project', '2026-08-01T09:00:00.000Z').captured!;
    const comparison = compareAgainstBaseline({
      baseline,
      current: state({ repoSlug: 'acme/other-thing' }),
      now: '2026-08-08T09:00:00.000Z',
    });
    expect(comparison.delta.status).toBe('first-look');
    expect(comparison.span).toContain('cannot be compared here');
    // "No changes" would be a different claim, and a reassuring one.
    expect(comparison.span).not.toContain('Nothing tracked has moved');
  });

  it('has no path that deletes a baseline except the explicit one', () => {
    // Opening a different folder must not cost somebody a record.
    const removals = [...CODE.matchAll(/baselines\s*[:.].*filter/g)];
    expect(removals.length).toBe(1);
  });
});

describe('one comparison, not a second implementation', () => {
  it('delegates to observedDelta rather than comparing fields itself', () => {
    // Two implementations would eventually disagree, and the symptom would be
    // two cards on one dashboard reporting different numbers for one fortnight.
    expect(CODE).toContain('compareObservedState');
    expect(CODE).toContain('takeObservedSnapshot');
    expect(CODE).not.toMatch(/FIELD_RULES|significance/);
  });

  it('publishes the rules it applied', () => {
    expect(BASELINE_RULES.length).toBeGreaterThan(4);
    for (const rule of BASELINE_RULES) {
      expect(rule.describes.length, rule.id).toBeGreaterThan(40);
    }
  });
});

describe('a stored register is untrusted', () => {
  it('never throws, whatever it is handed', () => {
    for (const value of [undefined, null, 42, 'text', [], {}, { baselines: 'no' }]) {
      expect(() => sanitizeBaselineRegister(value)).not.toThrow();
    }
  });

  it('drops an entry with no readable snapshot rather than offering a broken span', () => {
    const register = sanitizeBaselineRegister({
      version: 1,
      baselines: [
        { id: 'a', label: 'Good', takenAt: '2026-08-01T09:00:00.000Z', snapshot: { takenAt: 'x', state: {} } },
        { id: 'b', label: 'No snapshot', takenAt: '2026-08-01T09:00:00.000Z' },
        { id: 'c', label: 'Bad date', takenAt: 'soon', snapshot: { state: {} } },
        { id: 'd', takenAt: '2026-08-01T09:00:00.000Z', snapshot: { state: {} } },
      ],
    });
    expect(register.baselines.map(entry => entry.label)).toEqual(['Good']);
  });

  it('clamps a label and gives two entries claiming one id different ids', () => {
    const register = sanitizeBaselineRegister({
      version: 1,
      baselines: [
        { id: 'same', label: 'x'.repeat(500), takenAt: '2026-08-01T09:00:00.000Z', snapshot: { state: {} } },
        { id: 'same', label: 'Another', takenAt: '2026-08-02T09:00:00.000Z', snapshot: { state: {} } },
      ],
    });
    expect(register.baselines[0].label.length).toBeLessThanOrEqual(60);
    expect(register.baselines[0].id).not.toBe(register.baselines[1].id);
  });

  it('never returns more than the cap', () => {
    const register = sanitizeBaselineRegister({
      version: 1,
      baselines: Array.from({ length: 50 }, (_unused, index) => ({
        id: `b${index}`,
        label: `Baseline ${index}`,
        takenAt: '2026-08-01T09:00:00.000Z',
        snapshot: { state: {} },
      })),
    });
    expect(register.baselines.length).toBeLessThanOrEqual(MAX_NAMED_BASELINES);
  });
});

describe('the chooser order', () => {
  it('offers the newest first', () => {
    let register = capture(EMPTY_BASELINE_REGISTER, 'Older', '2026-08-01T09:00:00.000Z').register;
    register = capture(register, 'Newer', '2026-09-01T09:00:00.000Z').register;
    expect(orderedBaselines(register).map(entry => entry.label)).toEqual(['Newer', 'Older']);
  });
});
