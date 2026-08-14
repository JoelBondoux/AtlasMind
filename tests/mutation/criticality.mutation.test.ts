import { describe, it, expect } from 'vitest';
import { assessCriticality, CriticalityLevel } from '../../src/core/criticality.js';
import type { Task } from '../../src/core/criticality.js';

/**
 * Written for the mutation run, not for coverage.
 *
 * `stryker.config.json` mutates three modules; this one is graded on whether
 * mutants *die*, and the existing suite covers every line of `assessCriticality`
 * while leaving several alive. Line coverage and mutation score diverge exactly
 * here — a test that asserts "this is HIGH" from a task that is HIGH for two
 * independent reasons keeps passing when one of them is deleted.
 *
 * Three families of mutant, and each needs its own shape of assertion:
 *
 *  - **Each keyword and each path pattern deleted individually.** Killed only
 *    by a task that reaches that level through *one* signal, so every case
 *    below is deliberately single-signal. `deploy/prod.json` is the counter-
 *    example already in the suite: it matches the CRITICAL keyword `deploy`
 *    *and* the CRITICAL path pattern, so removing either leaves it green.
 *  - **The comparison in `higherCriticality` flipped** (`>` → `>=`, or the
 *    operands swapped). Killed only by ordered pairs where the answer differs
 *    depending on which of two *different* levels wins, in both argument
 *    orders — a single "the highest wins" case dies to neither.
 *  - **The empty-input guard removed**, so an empty task falls through to LOW.
 *    UNKNOWN and LOW are different claims: one says nothing was assessed, the
 *    other says it was assessed and found harmless.
 */

const task = (description: string, files: string[] = []): Task => ({ description, files });

describe('criticality: every keyword carries its level on its own', () => {
  const KEYWORDS: ReadonlyArray<[string, CriticalityLevel]> = [
    ['deploy', CriticalityLevel.CRITICAL],
    ['migration', CriticalityLevel.CRITICAL],
    ['production', CriticalityLevel.CRITICAL],
    ['auth', CriticalityLevel.HIGH],
    ['security', CriticalityLevel.HIGH],
    ['payment', CriticalityLevel.HIGH],
    ['billing', CriticalityLevel.HIGH],
    ['credentials', CriticalityLevel.HIGH],
    ['refactor', CriticalityLevel.MEDIUM],
    ['performance', CriticalityLevel.MEDIUM],
    ['optimization', CriticalityLevel.MEDIUM],
  ];

  for (const [keyword, expected] of KEYWORDS) {
    it(`grades "${keyword}" as ${expected} with no other signal present`, () => {
      // No files at all, so a path pattern cannot be doing the work instead.
      expect(assessCriticality(task(`please handle the ${keyword} step`))).toBe(expected);
    });
  }

  it('matches a keyword regardless of the case it was typed in', () => {
    expect(assessCriticality(task('Rotate the CREDENTIALS'))).toBe(CriticalityLevel.HIGH);
  });

  it('grades a description with none of the keywords as LOW, not UNKNOWN', () => {
    // Assessed and found harmless is a different statement from not assessed.
    expect(assessCriticality(task('rename a local variable'))).toBe(CriticalityLevel.LOW);
  });
});

describe('criticality: every path pattern carries its level on its own', () => {
  const PATHS: ReadonlyArray<[string, CriticalityLevel]> = [
    ['deploy/prod.json', CriticalityLevel.CRITICAL],
    ['db/2026_migration_01.sql', CriticalityLevel.CRITICAL],
    ['package.json', CriticalityLevel.HIGH],
    ['src/authn/session.ts', CriticalityLevel.HIGH],
    ['src/security/policy.ts', CriticalityLevel.HIGH],
    ['src/core/orchestrator.ts', CriticalityLevel.MEDIUM],
  ];

  for (const [file, expected] of PATHS) {
    it(`grades "${file}" as ${expected} with a neutral description`, () => {
      // The description is deliberately free of every keyword, so only the
      // path pattern can produce the level.
      expect(assessCriticality(task('adjust a value', [file]))).toBe(expected);
    });
  }

  it('grades an unmatched path as LOW', () => {
    expect(assessCriticality(task('adjust a value', ['src/ui/theme.css']))).toBe(CriticalityLevel.LOW);
  });

  it('reads every file, not only the first', () => {
    // A mutant that stops after files[0] survives any single-file case.
    expect(assessCriticality(task('adjust a value', ['README.md', 'deploy/prod.json'])))
      .toBe(CriticalityLevel.CRITICAL);
  });
});

describe('criticality: the highest signal wins, in either order', () => {
  // Ordered pairs. `higherCriticality` folds left over the keyword table then
  // the path table, so a flipped comparison shows up only when the *later*
  // signal is the lower one — which is why both directions are asserted.
  const PAIRS: ReadonlyArray<{ low: Task; high: Task; expected: CriticalityLevel }> = [
    {
      low: task('refactor the module'),
      high: task('refactor the module', ['deploy/prod.json']),
      expected: CriticalityLevel.CRITICAL,
    },
    {
      low: task('handle the deploy step'),
      high: task('handle the deploy step', ['src/core/orchestrator.ts']),
      expected: CriticalityLevel.CRITICAL,
    },
    {
      low: task('performance work', ['package.json']),
      high: task('performance work', ['package.json', 'src/core/router.ts']),
      expected: CriticalityLevel.HIGH,
    },
  ];

  for (const [index, pair] of PAIRS.entries()) {
    it(`keeps the higher level when a lower signal is added (case ${index + 1})`, () => {
      expect(assessCriticality(pair.high)).toBe(pair.expected);
    });
  }

  it('never lets a MEDIUM path lower a CRITICAL keyword', () => {
    expect(assessCriticality(task('production release', ['src/core/x.ts']))).toBe(CriticalityLevel.CRITICAL);
  });

  it('never lets a MEDIUM keyword lower a HIGH path', () => {
    expect(assessCriticality(task('refactor', ['package.json']))).toBe(CriticalityLevel.HIGH);
  });
});

describe('criticality: unassessed is not harmless', () => {
  it('returns UNKNOWN for an empty description and no files', () => {
    expect(assessCriticality(task('', []))).toBe(CriticalityLevel.UNKNOWN);
  });

  it('returns LOW rather than UNKNOWN once there is a file to look at', () => {
    // The guard is "nothing to assess", not "no description".
    expect(assessCriticality(task('', ['src/ui/theme.css']))).toBe(CriticalityLevel.LOW);
  });

  it('survives a malformed task without throwing', () => {
    // `files` is typed, but this function is reached from a model's tool call.
    expect(assessCriticality({ description: undefined, files: undefined } as unknown as Task))
      .toBe(CriticalityLevel.UNKNOWN);
  });
});
