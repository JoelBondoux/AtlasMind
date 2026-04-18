/**
 * Global Vitest setup file.
 * The vscode module alias in vitest.config.ts already maps the 'vscode' import
 * to tests/__mocks__/vscode.ts for every test file — no vi.mock() call is needed
 * here. Any test that calls vi.mock('vscode') with no factory will receive the
 * aliased stub automatically.
 */
