import { defineConfig } from 'vitest/config';

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
