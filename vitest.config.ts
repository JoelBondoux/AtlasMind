import { defineConfig } from 'vitest/config';

/**
 * The worker allowance a containerised runner declared for this job, if any.
 *
 * Read here rather than left to `VITEST_MAX_WORKERS` alone so the neutral
 * spelling works too, and validated rather than trusted: an unreadable or
 * absurd value falls through to the normal rules instead of pinning the suite
 * to one worker for the rest of the run.
 */
const declaredWorkers = Number.parseInt(
  process.env.ATLASMIND_TEST_MAX_WORKERS ?? process.env.VITEST_MAX_WORKERS ?? '',
  10,
);
const ciWorkers = Number.isSafeInteger(declaredWorkers) && declaredWorkers > 0 && declaredWorkers <= 256
  ? declaredWorkers
  : undefined;

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // Vitest's default is 5000ms, which this suite outgrew.
    //
    // A large share of these tests are not unit tests in the cheap sense: they
    // `mkdtempSync` a real directory, write a project tree into it, and drive a
    // panel or manager across it. That is deliberate — the managers under test
    // are `fs`-only by design, and mocking the filesystem would test the mock.
    // But it means each one's duration depends on the host's disk, and a
    // developer checkout can sit on a synced folder (OneDrive, Dropbox) where
    // an `mkdtemp` + several writes is an order of magnitude slower than on CI.
    //
    // At 5000ms the margin was thin enough that a filesystem-heavy test would
    // pass alone and time out under full-suite load — which is the worst kind of
    // failure, because it is indistinguishable from a real one at the moment it
    // blocks a commit, and it teaches whoever hits it to reach for --no-verify,
    // skipping compile and lint too. Raising the ceiling does not hide a hang: a
    // genuinely stuck test still fails, just later.
    testTimeout: 20_000,
    // Every run writes a JUnit report, and it is deliberately not opt-in.
    //
    // AtlasMind's own Testing dashboard reads pass/fail from a report the project
    // wrote — it never runs a test command to find out. Until this existed, no
    // path in this repository emitted one, so the dashboard's failure half was
    // permanently dark on the very project that ships it, and rendered "no test
    // report" rather than a verdict. Putting it behind a separate script would
    // have reproduced that: the report would exist only when somebody remembered.
    //
    // `default` stays first so console output is unchanged. The pre-commit hook
    // already runs the full suite, so the report on disk is never older than the
    // last commit. `test:providers:local-recommendations` overrides `--reporter`
    // and therefore writes nothing, which is correct — a single-file run must not
    // overwrite the whole-suite verdict.
    // Leave the machine usable while its own checks run.
    //
    // Vitest's default is `availableParallelism() - 1`, which on a 24-thread
    // developer machine is 23 worker processes — and this suite is not a cheap
    // one: a large share of its tests `mkdtemp` a real directory and write a
    // project tree into it, so those workers saturate the CPU *and* the disk at
    // once. `npm run ci:local` then runs the whole thing twice, once more under
    // coverage. The measured effect is an editor that stops responding for the
    // duration, which is how somebody learns to skip the pre-commit hook.
    //
    // CI keeps the default, deliberately. A hosted runner has nothing else to
    // be responsive for, and halving its parallelism would buy nobody anything
    // while making every pull request slower.
    //
    // With one exception, and it is the reason `ciWorkers` exists: AtlasMind's
    // own trusted local runner sets `CI=true` *on this machine*, inside a
    // container capped at a few CPUs. Taking the CI branch there meant asking
    // for one worker per host thread — 23 of them behind an 8-CPU quota, paying
    // full per-worker memory for parallelism the cgroup will not grant. The
    // runner therefore passes `ATLASMIND_TEST_MAX_WORKERS` (and the runner-native
    // spellings) describing the container's real allowance, and it wins over the
    // CI default whenever it is present. A hosted GitHub runner sets none of
    // these and is unaffected.
    //
    // A percentage rather than a fixed number so it scales with the machine —
    // 50% of 4 is 2, 50% of 24 is 12 — and `VITEST_MAX_WORKERS` still overrides
    // it, since Vitest applies that env var after the config is resolved. Set
    // it when you want the whole machine and are not using it for anything else.
    //
    // Not a limit on memory: a worker's footprint is a property of the test, not
    // of the pool, and capping the pool is the lever that exists. Stryker is
    // unaffected — its runner pins `maxWorkers: 1` per instance and bounds the
    // instances with its own `concurrency`.
    maxWorkers: ciWorkers ?? (process.env.CI ? undefined : '50%'),
    reporters: ['default', 'junit'],
    outputFile: {
      junit: 'test-results/junit.xml',
    },
    alias: {
      // Stub the vscode module so tests that transitively import it compile and run.
      // Tests that need specific vscode behaviour should use vi.mock('vscode', ...) locally.
      vscode: new URL('./tests/__mocks__/vscode.ts', import.meta.url).pathname,
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: [
        'src/core/**/*.ts',
        'src/skills/**/*.ts',
        'src/memory/**/*.ts',
        'src/providers/**/*.ts',
        'src/mcp/**/*.ts',
        'src/bootstrap/**/*.ts',
        'src/views/**/*.ts',
        'src/chat/**/*.ts',
      ],
      thresholds: {
        lines: 45,
        functions: 45,
      },
    },
  },
});
