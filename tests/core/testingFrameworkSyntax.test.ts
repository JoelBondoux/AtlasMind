import { describe, expect, it } from 'vitest';
import {
  frameworkHeader,
  mockApiFor,
  renderNeutralTest,
  testFileSuffix,
  type NeutralTestSpec,
} from '../../src/core/testingFrameworkSyntax.ts';
import {
  E2E_FRAMEWORKS,
  UNIT_FRAMEWORKS,
  type TestFramework,
} from '../../src/core/testingFrameworkDetection.ts';

/**
 * Rendering the same test in six dialects, and the thing that makes it worth
 * doing: fixing the *import line* alone would not have been enough.
 *
 * The scaffolder emitted Vitest source directly, so a Jest project got a file
 * importing a package it does not have and a Mocha project got one that fails
 * on `expect().toBe()` — a matcher Chai does not have. A file that fails on
 * line two instead of line one is not an improvement, so the assertions are
 * rendered per dialect too.
 */

const ALL: readonly TestFramework[] = [...UNIT_FRAMEWORKS, ...E2E_FRAMEWORKS];

const spec: NeutralTestSpec = {
  subject: 'the thing under test',
  purpose: 'A starter that runs, so the first real test has somewhere to go.',
  cases: [
    {
      name: 'returns the expected value',
      assertions: [{ kind: 'equals', actual: '1 + 1', expected: '2' }],
    },
    {
      name: 'refuses bad input',
      purpose: 'The unhappy path, which is the half that gets skipped.',
      assertions: [{ kind: 'throws', actual: "parse('')" }],
    },
  ],
};

describe('every framework renders a syntactically plausible file', () => {
  for (const framework of ALL) {
    it(`renders ${framework} with balanced structure`, () => {
      const output = renderNeutralTest(spec, framework);
      expect(output).toContain("describe('the thing under test'");
      expect(output).toContain("it('returns the expected value'");
      // Balanced braces is a weak check, but it catches the template mistake
      // that actually happens: a missing closing bracket on one dialect only.
      expect((output.match(/\{/g) ?? []).length).toBe((output.match(/\}/g) ?? []).length);
      expect((output.match(/\(/g) ?? []).length).toBe((output.match(/\)/g) ?? []).length);
      expect(output.endsWith('\n')).toBe(true);
    });
  }
});

describe('each dialect uses its own assertion vocabulary', () => {
  it('renders Vitest and Jest with expect matchers', () => {
    for (const framework of ['vitest', 'jest'] as const) {
      const output = renderNeutralTest(spec, framework);
      expect(output).toContain('expect(1 + 1).toBe(2);');
      expect(output).toContain("expect(() => parse('')).toThrow();");
    }
  });

  it('renders Mocha with Chai, not with Jest matchers', () => {
    // The failure this pins: `toBe` is not Chai, so an import-only fix would
    // still produce a file that throws on its first assertion.
    const output = renderNeutralTest(spec, 'mocha');
    expect(output).toContain('expect(1 + 1).to.equal(2);');
    expect(output).not.toContain('.toBe(');
  });

  it('renders the Node runner with assert, not with expect', () => {
    const output = renderNeutralTest(spec, 'node-test');
    expect(output).toContain('assert.strictEqual(1 + 1, 2);');
    expect(output).not.toContain('expect(');
  });
});

describe('each dialect imports what it needs and nothing it must not', () => {
  it('imports the runner where the runner requires it', () => {
    expect(frameworkHeader('vitest').join('\n')).toContain("from 'vitest'");
    expect(frameworkHeader('mocha').join('\n')).toContain("from 'chai'");
    expect(frameworkHeader('node-test').join('\n')).toContain("from 'node:test'");
    expect(frameworkHeader('playwright').join('\n')).toContain("from '@playwright/test'");
  });

  it('imports nothing for the runners that inject their globals', () => {
    // Importing `describe` in Jest without `@jest/globals` installed, or
    // anything at all in Cypress, is an error rather than a style choice.
    expect(frameworkHeader('jest')).toEqual([]);
    expect(frameworkHeader('cypress')).toEqual([]);
    expect(renderNeutralTest(spec, 'jest')).not.toContain('import');
    expect(renderNeutralTest(spec, 'cypress')).not.toContain('import');
  });

  it('never imports one framework into another', () => {
    for (const framework of ALL) {
      const output = renderNeutralTest(spec, framework);
      for (const other of ALL) {
        if (other === framework) {
          continue;
        }
        expect(output, `${framework} output mentions ${other}`).not.toContain(`from '${other}'`);
      }
    }
  });
});

describe('the neutral description survives into the file', () => {
  it('renders the purpose as a comment, never as an assertion', () => {
    for (const framework of ALL) {
      const output = renderNeutralTest(spec, framework);
      expect(output).toMatch(/\/\/ A starter that runs/);
      expect(output).toMatch(/\/\/ The unhappy path/);
    }
  });

  it('escapes a quote in a case name rather than breaking the string', () => {
    const risky: NeutralTestSpec = {
      subject: "the parser's contract",
      cases: [{ name: "doesn't throw", assertions: [{ kind: 'truthy', actual: 'true' }] }],
    };
    for (const framework of ALL) {
      const output = renderNeutralTest(risky, framework);
      expect(output).toContain("describe('the parser\\'s contract'");
      expect(output).toContain("it('doesn\\'t throw'");
    }
  });

  it('marks an async case async', () => {
    const asyncSpec: NeutralTestSpec = {
      subject: 'fetching',
      cases: [{ name: 'resolves', isAsync: true, assertions: [{ kind: 'truthy', actual: 'await ready()' }] }],
    };
    expect(renderNeutralTest(asyncSpec, 'vitest')).toContain("it('resolves', async () => {");
  });
});

describe('file naming and mocking follow the runner', () => {
  it('gives Cypress its own suffix so it is picked up', () => {
    // A `.test.ts` in a Cypress project is not run by anything.
    expect(testFileSuffix('cypress', 'ts')).toBe('cy.ts');
    expect(testFileSuffix('playwright', 'ts')).toBe('spec.ts');
    expect(testFileSuffix('vitest', 'ts')).toBe('test.ts');
    expect(testFileSuffix('mocha', 'js')).toBe('spec.js');
  });

  it('names each runner’s mocking API', () => {
    expect(mockApiFor('vitest')).toBe('vi.mock');
    expect(mockApiFor('jest')).toBe('jest.mock');
    for (const framework of ALL) {
      expect(mockApiFor(framework).trim().length, framework).toBeGreaterThan(0);
    }
  });
});
