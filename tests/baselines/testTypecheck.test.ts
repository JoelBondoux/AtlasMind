import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The test suite's own type errors, ratcheted down.
 *
 * `tsconfig.json` builds `src/**` and emits to `out/`, so tests were never
 * type-checked at all — vitest transpiles without checking, and `npm run lint`
 * is not type-aware. The gap is not theoretical: `CiRouteMachineFacts` gained a
 * required field while a fixture declaring that return type kept omitting it.
 * The fixture ran with `undefined`, the tests passed, and the only reason it
 * surfaced was somebody reading the diff.
 *
 * Turning the check on wholesale is not available: there are a few hundred
 * pre-existing mismatches, most of them partial mocks that are idiomatic in
 * tests and would need a cast to satisfy the compiler — churn that would buy
 * little and hide the ones that matter. So this uses the same ratchet
 * `unreadDeclarations` uses for dead exports: a ceiling that fails when the
 * count rises **and** when it falls without being lowered, so the number can
 * only go one way and cannot quietly become a fiction after a cleanup.
 *
 * A new test file that does not type-check therefore fails this, which is the
 * property worth having today. Driving the baseline to zero is a separate piece
 * of work, and this is what makes progress on it visible.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Lower this after fixing errors. Never raise it: a rise means a new test was
 * added that does not type-check, and the message names the files.
 */
const TEST_TYPE_ERROR_CEILING = 244;

function collectTypeErrors(): string[] {
  try {
    execFileSync(
      process.execPath,
      [path.join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', 'tsconfig.test.json'],
      { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 },
    );
    return [];
  } catch (error) {
    // A non-zero exit is the expected path while the baseline is above zero;
    // the diagnostics are on stdout, not stderr.
    const output = String((error as { stdout?: string }).stdout ?? '');
    return output.split(/\r?\n/).filter(line => /error TS\d+/.test(line));
  }
}

describe('the test suite type-checks', () => {
  const errors = collectTypeErrors();
  // Only the test files matter here. `src` is already checked by the build, and
  // counting it twice would let a source regression be absorbed by this
  // ceiling instead of failing the compile where it belongs.
  const testErrors = errors.filter(line => /^tests[\\/]/.test(line));

  it(`has no more than ${TEST_TYPE_ERROR_CEILING} type errors in tests`, () => {
    const files = [...new Set(testErrors.map(line => line.split('(')[0]))];
    expect(
      testErrors.length,
      testErrors.length > TEST_TYPE_ERROR_CEILING
        // The files, not just the count: "245 > 244" tells whoever hit this
        // nothing about what they added.
        ? `test type errors rose to ${testErrors.length}. Files involved:\n${files.join('\n')}`
        : '',
    ).toBeLessThanOrEqual(TEST_TYPE_ERROR_CEILING);
  });

  it('keeps the ceiling honest by failing when it is set above the real count', () => {
    expect(
      testErrors.length,
      `${TEST_TYPE_ERROR_CEILING - testErrors.length} test type error(s) were fixed — lower TEST_TYPE_ERROR_CEILING to ${testErrors.length}`,
    ).toBe(TEST_TYPE_ERROR_CEILING);
  });

  /**
   * A misconfigured project reports zero errors and would turn this file green
   * for the worst possible reason. `src` compiling clean is the signal that the
   * compiler ran and resolved the project at all.
   */
  it('actually ran the compiler rather than passing because nothing was checked', () => {
    expect(errors.filter(line => /^src[\\/]/.test(line))).toEqual([]);
    expect(testErrors.length).toBeGreaterThan(0);
  });
});
