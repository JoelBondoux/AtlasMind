import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { effectiveStageLevel, lowerLevel } from '../src/core/workflowGuidance.js';
import { seedWorkflowConfig, stageBlockers } from '../src/core/workflowConfig.js';
import type { AutomationLevel, WorkflowStageConfig } from '../src/types.js';

/**
 * The rules the type system cannot express.
 *
 * `AutomationLevel` is a union of five strings, and the compiler is satisfied
 * by any of them anywhere. What it cannot state is the thing the whole feature
 * rests on: **the level a stage actually operates at is never above what the
 * operator permitted.** That is a lattice property over four inputs — the
 * stage's request, the operator's ceiling, the master switch, and whether the
 * stage is blocked — and it is exactly the shape of rule that survives a
 * refactor visually intact and semantically inverted.
 *
 * It is worth generative testing rather than examples because the failure is a
 * *combination*: a stage requesting `auto` under an `observe` ceiling with the
 * master switch on and one blocker present is a state nobody writes a test for
 * and a user reaches on their first afternoon. Getting it wrong grants an agent
 * authority nobody agreed to, which is the one error in this module that has a
 * cost outside the editor.
 */

const LEVELS: readonly AutomationLevel[] = ['off', 'observe', 'draft', 'propose', 'auto'];
const RANK: Record<AutomationLevel, number> = { off: 0, observe: 1, draft: 2, propose: 3, auto: 4 };

const level = fc.constantFrom(...LEVELS);

const stage = (over: Partial<WorkflowStageConfig> = {}): WorkflowStageConfig => ({
  ...seedWorkflowConfig({ profile: 'solo' }).stages[0]!,
  enabled: true,
  automationLevel: 'auto',
  ...over,
});

describe('lowerLevel is a meet on the automation lattice', () => {
  it('never returns something above either argument', () => {
    fc.assert(
      fc.property(level, level, (a, b) => {
        const result = lowerLevel(a, b);
        expect(RANK[result]).toBeLessThanOrEqual(RANK[a]);
        expect(RANK[result]).toBeLessThanOrEqual(RANK[b]);
      }),
      { numRuns: 200 },
    );
  });

  it('returns one of its arguments rather than inventing a level', () => {
    fc.assert(
      fc.property(level, level, (a, b) => {
        expect([a, b]).toContain(lowerLevel(a, b));
      }),
      { numRuns: 200 },
    );
  });

  it('is commutative, so argument order cannot change what is permitted', () => {
    // A ceiling that depended on which side it was passed would be a ceiling
    // nobody could reason about, and the bug would only appear at one call site.
    fc.assert(
      fc.property(level, level, (a, b) => {
        expect(lowerLevel(a, b)).toBe(lowerLevel(b, a));
      }),
      { numRuns: 200 },
    );
  });

  it('is idempotent and associative', () => {
    fc.assert(
      fc.property(level, level, level, (a, b, c) => {
        expect(lowerLevel(a, a)).toBe(a);
        expect(lowerLevel(lowerLevel(a, b), c)).toBe(lowerLevel(a, lowerLevel(b, c)));
      }),
      { numRuns: 200 },
    );
  });
});

describe('a stage never operates above the ceiling', () => {
  it('holds for every combination of request, ceiling and master switch', () => {
    fc.assert(
      fc.property(level, level, fc.boolean(), fc.boolean(), (requested, ceiling, masterEnabled, enabled) => {
        const effective = effectiveStageLevel(stage({ automationLevel: requested, enabled }), ceiling, masterEnabled);

        expect(RANK[effective], 'a stage exceeded the operator ceiling').toBeLessThanOrEqual(RANK[ceiling]);
        expect(RANK[effective]).toBeLessThanOrEqual(RANK[requested]);
        if (!enabled || !masterEnabled) {
          expect(effective).toBe('off');
        }
      }),
      { numRuns: 500 },
    );
  });

  it('collapses a blocked stage to off whatever it requested', () => {
    // A blocker is not a preference to weigh against a level; it is a statement
    // that the stage cannot run. Reporting `propose` for a stage with an empty
    // required command describes something that refuses the moment it is tried.
    const blocked = stage({ automationLevel: 'auto', command: '' });
    expect(stageBlockers(blocked).length).toBeGreaterThan(0);
    expect(effectiveStageLevel(blocked, 'auto', true)).toBe('off');
  });

  it('keeps an absent command distinct from an empty one', () => {
    // `undefined` means the stage needs no command; `''` means it needs one and
    // does not have it. Collapsing them turns a deliberate blocker into an
    // oversight, or an oversight into a silent pass.
    const needsNone = stage({ automationLevel: 'auto' });
    delete (needsNone as { command?: string }).command;

    expect(stageBlockers(needsNone)).toEqual([]);
    expect(effectiveStageLevel(needsNone, 'auto', true)).toBe('auto');
    expect(effectiveStageLevel(stage({ automationLevel: 'auto', command: '' }), 'auto', true)).toBe('off');
  });

  it('is monotone in the ceiling — raising it never lowers what is permitted', () => {
    fc.assert(
      fc.property(level, fc.integer({ min: 0, max: 4 }), fc.integer({ min: 0, max: 4 }), (requested, i, j) => {
        const [low, high] = i <= j ? [LEVELS[i]!, LEVELS[j]!] : [LEVELS[j]!, LEVELS[i]!];
        const withLow = effectiveStageLevel(stage({ automationLevel: requested }), low, true);
        const withHigh = effectiveStageLevel(stage({ automationLevel: requested }), high, true);
        expect(RANK[withHigh]).toBeGreaterThanOrEqual(RANK[withLow]);
      }),
      { numRuns: 300 },
    );
  });

  it('applies no ceiling when none was supplied, which is the caller’s contract', () => {
    // Stated rather than assumed. `undefined` here means "no ceiling was
    // passed", not "no ceiling exists" — this function is pure and the
    // operator's setting is read by `readWorkflowGuidanceInput`. Pinning it
    // means a future change that made `undefined` grant `auto` *by accident*
    // would have to change this line and say so.
    expect(effectiveStageLevel(stage({ automationLevel: 'draft' }), undefined, true)).toBe('draft');
    expect(effectiveStageLevel(stage({ automationLevel: 'auto' }), undefined, true)).toBe('auto');
  });

  it('still refuses a disabled or blocked stage when no ceiling was supplied', () => {
    // The guards that must not depend on a ceiling being present: an absent
    // ceiling is the one path that skips `lowerLevel` entirely, so if the
    // refusals lived there instead of above it, this is where it would show.
    expect(effectiveStageLevel(stage({ enabled: false }), undefined, true)).toBe('off');
    expect(effectiveStageLevel(stage({ command: '' }), undefined, true)).toBe('off');
    expect(effectiveStageLevel(stage(), undefined, false)).toBe('off');
  });
});
