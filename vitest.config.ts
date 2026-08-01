import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
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
