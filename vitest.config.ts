import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
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
        lines: 65,
        functions: 65,
      },
    },
  },
});
