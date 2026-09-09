import { describe, expect, it } from 'vitest';

import {
  CONTEXT_BUDGET_RULES,
  CONTEXT_ESTIMATE_CAVEAT,
  buildContextBudgetReading,
  describeContextBudget,
  resolveCarriedTurns,
} from '../../src/core/contextBudget.ts';

/**
 * What the next turn carries, and what the reading cannot see.
 *
 * The failure this guards against is a bar that reads comfortable because it
 * only counted the parts it could measure.
 */

const WINDOW = { kind: 'model-window' as const, label: 'the model window', tokens: 1000 };
const SESSION = { kind: 'session-budget' as const, label: 'session budget', chars: 4000 };

describe('parts', () => {
  it('estimates tokens from characters and shares of the measured total', () => {
    const reading = buildContextBudgetReading([
      { id: 'session-history', chars: 3000, itemCount: 6 },
      { id: 'attachments', chars: 1000 },
    ], WINDOW);

    expect(reading.measuredChars).toBe(4000);
    expect(reading.measuredTokens).toBe(1000);
    expect(reading.parts.map(part => [part.id, part.estimatedTokens, part.sharePercent]))
      .toEqual([['session-history', 750, 75], ['attachments', 250, 25]]);
    expect(reading.parts[0]?.itemCount).toBe(6);
  });

  it('orders parts by size, so the thing to prune is the thing at the top', () => {
    const reading = buildContextBudgetReading([
      { id: 'draft', chars: 40 },
      { id: 'attachments', chars: 900 },
      { id: 'session-history', chars: 300 },
    ], WINDOW);

    expect(reading.parts.map(part => part.id)).toEqual(['attachments', 'session-history', 'draft']);
  });

  it('says what each part is, so nothing on the panel needs a glossary', () => {
    const reading = buildContextBudgetReading([{ id: 'tool-schemas' }], WINDOW);
    expect(reading.unmeasured[0]?.describes).toContain('whether or not one is used');
  });

  it('marks what the reader can actually make smaller', () => {
    const reading = buildContextBudgetReading([
      { id: 'session-history', chars: 100 },
      { id: 'system-prompt' },
    ], WINDOW);

    expect(reading.parts[0]?.prunable).toBe(true);
    expect(reading.unmeasured[0]?.prunable).toBe(false);
  });
});

describe('unmeasured is named, never zeroed', () => {
  it('keeps a part with no character count out of the totals and in its own list', () => {
    // A bar that only counts what it can see reads comfortable while the turn
    // is full — the exact failure the old single-bar meter had.
    const reading = buildContextBudgetReading([
      { id: 'session-history', chars: 2000 },
      { id: 'tool-schemas' },
      { id: 'system-prompt' },
    ], WINDOW);

    expect(reading.measuredChars).toBe(2000);
    expect(reading.parts.map(part => part.id)).toEqual(['session-history']);
    expect(reading.unmeasured.map(part => part.id)).toEqual(['system-prompt', 'tool-schemas']);
    expect(reading.unmeasured.every(part => part.estimatedTokens === 0)).toBe(true);
  });

  it('publishes the rule that says so', () => {
    const reading = buildContextBudgetReading([{ id: 'session-history', chars: 10 }], WINDOW);
    expect(reading.rules).toBe(CONTEXT_BUDGET_RULES);
    expect(reading.rules.map(rule => rule.id)).toContain('unmeasured-is-named');
  });
});

describe('the ceiling', () => {
  it('measures against the model window when one is known', () => {
    const reading = buildContextBudgetReading([{ id: 'session-history', chars: 2000 }], WINDOW);
    expect(reading.usedRatio).toBe(0.5);
    expect(reading.headroomTokens).toBe(500);
  });

  it('falls back to the operator\'s own character budget rather than inventing a window', () => {
    const reading = buildContextBudgetReading([{ id: 'session-history', chars: 2000 }], SESSION);
    expect(reading.ceiling.kind).toBe('session-budget');
    expect(reading.usedRatio).toBe(0.5);
  });

  it('reads tight at four fifths and over past the ceiling', () => {
    const at = (chars: number) => buildContextBudgetReading([{ id: 'session-history', chars }], WINDOW).pressure;
    expect(at(1000)).toBe('comfortable');
    expect(at(3200)).toBe('tight');
    expect(at(4400)).toBe('over');
  });

  it('never reports negative headroom', () => {
    const reading = buildContextBudgetReading([{ id: 'session-history', chars: 40000 }], WINDOW);
    expect(reading.headroomTokens).toBe(0);
    expect(reading.pressure).toBe('over');
  });
});

describe('the trim order', () => {
  it('publishes what is dropped first', () => {
    // "Why did it not know that?" is the question this surface exists to
    // answer, and the answer is almost always that something was trimmed.
    const reading = buildContextBudgetReading([
      { id: 'draft', chars: 10 },
      { id: 'attachments', chars: 10 },
      { id: 'session-history', chars: 10 },
    ], WINDOW);

    expect(reading.trimOrder).toEqual(['session-history', 'attachments']);
  });

  it('never lists the draft, because trimming what somebody just typed is indefensible', () => {
    const reading = buildContextBudgetReading([{ id: 'draft', chars: 4000 }], WINDOW);
    expect(reading.trimOrder).toEqual([]);
  });

  it('lists only parts this turn actually has', () => {
    const reading = buildContextBudgetReading([{ id: 'tool-schemas' }], WINDOW);
    expect(reading.trimOrder).toEqual(['tool-schemas']);
  });
});

describe('the caveat travels with every figure', () => {
  it('is on the reading itself, not only in the rules', () => {
    const reading = buildContextBudgetReading([{ id: 'draft', chars: 8 }], WINDOW);
    expect(reading.caveat).toBe(CONTEXT_ESTIMATE_CAVEAT);
    expect(reading.caveat).toContain('not from the provider');
  });
});

describe('carrying fewer turns', () => {
  it('uses the configured limit when nothing was requested', () => {
    expect(resolveCarriedTurns(6, undefined)).toBe(6);
  });

  it('honours a smaller request', () => {
    expect(resolveCarriedTurns(6, 2)).toBe(2);
  });

  it('never raises the operator\'s ceiling', () => {
    // A panel control that could exceed the setting would be a setting with no
    // effect.
    expect(resolveCarriedTurns(6, 50)).toBe(6);
  });

  it('accepts zero, because carrying nothing is a real way to start again', () => {
    expect(resolveCarriedTurns(6, 0)).toBe(0);
  });

  it('clamps nonsense rather than refusing, so a stale panel cannot stop the turn', () => {
    expect(resolveCarriedTurns(6, -4)).toBe(0);
    expect(resolveCarriedTurns(6, Number.NaN)).toBe(6);
    expect(resolveCarriedTurns(Number.NaN, 3)).toBe(3);
  });
});

describe('the sentence on the panel', () => {
  it('names the pressure and what goes first when it is tight', () => {
    const reading = buildContextBudgetReading([{ id: 'session-history', chars: 3400 }], WINDOW);
    expect(describeContextBudget(reading)).toBe('About 85% of the model window. Session history goes first when it fills.');
  });

  it('says it is being trimmed once it is over', () => {
    const reading = buildContextBudgetReading([{ id: 'session-history', chars: 8000 }], WINDOW);
    expect(describeContextBudget(reading)).toContain('Over budget');
    expect(describeContextBudget(reading)).toContain('session history is being trimmed');
  });

  it('stays quiet about trimming when there is room', () => {
    const reading = buildContextBudgetReading([{ id: 'session-history', chars: 400 }], WINDOW);
    expect(describeContextBudget(reading)).toBe('About 10% of the model window.');
  });
});
