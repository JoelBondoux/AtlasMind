import type { TestFramework } from './testingFrameworkDetection.js';

/**
 * One test, described before it is written in any particular dialect.
 *
 * The scaffolder used to emit Vitest source directly — forty template strings
 * each opening `import { describe, it, expect } from 'vitest'` — so a Jest
 * project got files it could not run and a Mocha project got files that did
 * not even parse. Worse, the *content* was Vitest-shaped too: `expect().toBe()`
 * is not Chai and `vi.mock` is not `jest.mock`, so even fixing the import line
 * would have produced a file that fails on the second line instead of the
 * first.
 *
 * So a starter test is described neutrally — what it is for, what it asserts —
 * and rendered per framework. The description is the thing worth reviewing; the
 * dialect is a detail the runner decides.
 */
export interface NeutralTestCase {
  /** What this case establishes, as a sentence. */
  readonly name: string;
  /** Why it is worth having. Rendered as a comment, never as an assertion. */
  readonly purpose?: string;
  readonly assertions: readonly NeutralAssertion[];
  readonly isAsync?: boolean;
}

/**
 * An assertion in terms of intent rather than of a matcher.
 *
 * Deliberately small. A large expression language here would be a second test
 * framework — the point is to cover what a *starter* file needs and let a
 * person write the real thing in the dialect their project uses.
 */
export type NeutralAssertion =
  | { kind: 'equals'; actual: string; expected: string }
  | { kind: 'deepEquals'; actual: string; expected: string }
  | { kind: 'truthy'; actual: string }
  | { kind: 'falsy'; actual: string }
  | { kind: 'throws'; actual: string }
  | { kind: 'doesNotThrow'; actual: string }
  | { kind: 'comment'; text: string }
  | { kind: 'statement'; code: string };

export interface NeutralTestSpec {
  /** The `describe` subject. */
  readonly subject: string;
  /** Why this file exists. Rendered as a header comment. */
  readonly purpose?: string;
  /** Imports the body needs, verbatim, excluding the framework's own. */
  readonly imports?: readonly string[];
  /** Code placed above the suite — fixtures, helpers. */
  readonly preamble?: readonly string[];
  readonly cases: readonly NeutralTestCase[];
}

interface Dialect {
  /** The framework's own import line, when it needs one. */
  readonly header: (spec: NeutralTestSpec) => string[];
  readonly assertion: (assertion: NeutralAssertion) => string;
  /** How this framework names its module mock, for guidance text. */
  readonly mockApi: string;
  /** The file suffix this runner conventionally picks up. */
  readonly suffix: (ext: 'ts' | 'js') => string;
}

const bddAssertion = (assertion: NeutralAssertion): string => {
  switch (assertion.kind) {
    case 'equals': return `expect(${assertion.actual}).toBe(${assertion.expected});`;
    case 'deepEquals': return `expect(${assertion.actual}).toEqual(${assertion.expected});`;
    case 'truthy': return `expect(${assertion.actual}).toBe(true);`;
    case 'falsy': return `expect(${assertion.actual}).toBe(false);`;
    case 'throws': return `expect(() => ${assertion.actual}).toThrow();`;
    case 'doesNotThrow': return `expect(() => ${assertion.actual}).not.toThrow();`;
    case 'comment': return `// ${assertion.text}`;
    case 'statement': return assertion.code;
  }
};

const DIALECTS: Readonly<Record<TestFramework, Dialect>> = {
  vitest: {
    header: () => ["import { describe, it, expect } from 'vitest';"],
    assertion: bddAssertion,
    mockApi: 'vi.mock',
    suffix: ext => `test.${ext}`,
  },
  jest: {
    // Jest injects its globals, so no import is required — and adding one is a
    // real error in a plain JS project without `@jest/globals` installed.
    header: () => [],
    assertion: bddAssertion,
    mockApi: 'jest.mock',
    suffix: ext => `test.${ext}`,
  },
  mocha: {
    // Mocha supplies `describe`/`it` and nothing else; the assertion library is
    // a separate decision, and Chai is the one the detection rule pairs it with.
    header: () => ["import { expect } from 'chai';"],
    assertion: assertion => {
      switch (assertion.kind) {
        case 'equals': return `expect(${assertion.actual}).to.equal(${assertion.expected});`;
        case 'deepEquals': return `expect(${assertion.actual}).to.deep.equal(${assertion.expected});`;
        case 'truthy': return `expect(${assertion.actual}).to.be.true;`;
        case 'falsy': return `expect(${assertion.actual}).to.be.false;`;
        case 'throws': return `expect(() => ${assertion.actual}).to.throw();`;
        case 'doesNotThrow': return `expect(() => ${assertion.actual}).to.not.throw();`;
        case 'comment': return `// ${assertion.text}`;
        case 'statement': return assertion.code;
      }
    },
    mockApi: 'sinon / proxyquire',
    suffix: ext => `spec.${ext}`,
  },
  'node-test': {
    header: () => [
      "import { describe, it } from 'node:test';",
      "import assert from 'node:assert/strict';",
    ],
    assertion: assertion => {
      switch (assertion.kind) {
        case 'equals': return `assert.strictEqual(${assertion.actual}, ${assertion.expected});`;
        case 'deepEquals': return `assert.deepStrictEqual(${assertion.actual}, ${assertion.expected});`;
        case 'truthy': return `assert.ok(${assertion.actual});`;
        case 'falsy': return `assert.ok(!(${assertion.actual}));`;
        case 'throws': return `assert.throws(() => ${assertion.actual});`;
        case 'doesNotThrow': return `assert.doesNotThrow(() => ${assertion.actual});`;
        case 'comment': return `// ${assertion.text}`;
        case 'statement': return assertion.code;
      }
    },
    mockApi: 'node:test mock',
    suffix: ext => `test.${ext}`,
  },
  playwright: {
    header: () => ["import { test, expect } from '@playwright/test';"],
    assertion: bddAssertion,
    mockApi: 'page.route',
    suffix: ext => `spec.${ext}`,
  },
  cypress: {
    // Cypress supplies its globals; importing them is an error.
    header: () => [],
    assertion: bddAssertion,
    mockApi: 'cy.intercept',
    suffix: ext => `cy.${ext}`,
  },
};

/** The module-mocking API this framework uses, for guidance text. */
export function mockApiFor(framework: TestFramework): string {
  return DIALECTS[framework].mockApi;
}

/** The conventional test-file suffix, so a scaffolded file is picked up. */
export function testFileSuffix(framework: TestFramework, ext: 'ts' | 'js'): string {
  return DIALECTS[framework].suffix(ext);
}

/**
 * The framework's own import line(s).
 *
 * Exported separately because the specialised policy templates are hand-written
 * bodies that only need their header corrected — rewriting all of them through
 * {@link renderNeutralTest} would lose prose that is worth keeping.
 */
export function frameworkHeader(framework: TestFramework): string[] {
  return DIALECTS[framework].header({ subject: '', cases: [] });
}

/** Render one neutral test in the selected framework's syntax. */
export function renderNeutralTest(spec: NeutralTestSpec, framework: TestFramework): string {
  const dialect = DIALECTS[framework];
  const lines: string[] = [];

  const header = dialect.header(spec);
  lines.push(...header, ...(spec.imports ?? []));
  if (lines.length > 0) {
    lines.push('');
  }

  if (spec.purpose) {
    lines.push(...wrapComment(spec.purpose), '');
  }
  if (spec.preamble && spec.preamble.length > 0) {
    lines.push(...spec.preamble, '');
  }

  lines.push(`describe('${escapeSingle(spec.subject)}', () => {`);
  spec.cases.forEach((testCase, index) => {
    if (index > 0) {
      lines.push('');
    }
    if (testCase.purpose) {
      lines.push(...wrapComment(testCase.purpose).map(line => `  ${line}`));
    }
    const signature = testCase.isAsync ? 'async () => {' : '() => {';
    lines.push(`  it('${escapeSingle(testCase.name)}', ${signature}`);
    for (const assertion of testCase.assertions) {
      lines.push(`    ${dialect.assertion(assertion)}`);
    }
    lines.push('  });');
  });
  lines.push('});', '');

  return lines.join('\n');
}

function escapeSingle(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Wrap prose at a comfortable width so a generated comment reads as written. */
function wrapComment(text: string, width = 76): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '//';
  for (const word of words) {
    if (current.length + word.length + 1 > width) {
      lines.push(current);
      current = '//';
    }
    current += ` ${word}`;
  }
  if (current !== '//') {
    lines.push(current);
  }
  return lines;
}
