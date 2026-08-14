import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * A separate config so the stress battery never joins the pre-commit suite.
 *
 * `tests/**` asserts what the code is contracted to do; a failure there is a
 * regression and must block a commit. This battery asserts what the *chat
 * window ought to do for a person reading it*, which is a deliberately higher
 * bar than the code currently clears. Its failures are findings, not
 * regressions — wiring them into `npm test` would make every one of them a
 * blocked commit and the whole battery would be deleted within a week.
 *
 * Run: npx vitest run --config evals/vitest.stress.config.ts
 */
export default defineConfig({
  test: {
    root: fileURLToPath(new URL('..', import.meta.url)),
    include: ['evals/**/*.stress.ts'],
    environment: 'node',
    testTimeout: 20_000,
    reporters: ['default'],
    alias: {
      vscode: fileURLToPath(new URL('../tests/__mocks__/vscode.ts', import.meta.url)),
    },
  },
});
