import { defineConfig, mergeConfig } from 'vitest/config';

import base from './vitest.config.ts';

/**
 * The suite as Stryker must run it.
 *
 * Stryker copies the project into a sandbox and runs the tests there, which is
 * correct for almost everything here — the managers under test are `fs`-only,
 * and a copied tree is a perfectly good tree. It is wrong for exactly one kind
 * of test: one whose *subject* is this repository rather than a fixture.
 *
 * `tests/baselines/testTypecheck.test.ts` is a ratchet. It runs `tsc` over the
 * test suite and asserts the error count has not risen above a recorded
 * ceiling, and it fails when the count *drops* too, so nobody can fix errors
 * without lowering the ceiling and recording the win. Inside the sandbox that
 * count comes back as zero, so the ratchet concludes 244 errors were fixed and
 * fails — which meant `npm run test:mutation` could not get past its initial
 * run at all. Stryker will not mutate a suite that is already red, and it is
 * right not to: a mutant "killed" by an already-failing test is not evidence of
 * anything.
 *
 * The exclusion is deliberately one file rather than a list of the fifty tests
 * that read repository paths. Almost all of those work fine, because the
 * sandbox contains the files they read; a broad exclusion would be a list that
 * rots and would quietly narrow what mutation testing covers. If another
 * genuinely sandbox-hostile test appears, it belongs here with its own reason —
 * an entry with no reason is the beginning of a list nobody trusts.
 */
export default mergeConfig(base, defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'tests/baselines/testTypecheck.test.ts',
    ],
    // The whole-suite verdict on disk belongs to `npm run test`. A mutation run
    // executes the suite hundreds of times against deliberately broken code, and
    // letting it overwrite `test-results/junit.xml` would leave the Testing
    // dashboard reporting the failures Stryker *induced* as though they were the
    // project's own — the dashboard reads that file and cannot know better.
    reporters: ['default'],
  },
}));
