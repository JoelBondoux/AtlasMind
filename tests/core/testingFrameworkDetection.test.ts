import { describe, expect, it } from 'vitest';
import {
  E2E_FRAMEWORKS,
  FRAMEWORK_LABEL,
  UNIT_FRAMEWORKS,
  installCommandFor,
  mayInstall,
  planTestFrameworks,
  type TestFramework,
  type TestFrameworkEvidence,
} from '../../src/core/testingFrameworkDetection.ts';

/**
 * The rule this whole module exists for is the one in the middle:
 * **never install Jest into a project already using Vitest.**
 *
 * Two runners in one repository means two config files, two mocking APIs and a
 * suite where each half only runs under one of them — and it does not happen
 * because somebody decided to, it happens because a scaffolder defaulted to its
 * favourite. So that is asserted first, exhaustively, and separately from
 * everything else.
 */

const evidence = (over: Partial<TestFrameworkEvidence> = {}): TestFrameworkEvidence => ({
  dependencies: [],
  scriptText: '',
  configFiles: [],
  testFiles: [],
  ...over,
});

describe('what the project already uses always wins', () => {
  const INSTALLED: ReadonlyArray<{ label: string; framework: TestFramework; evidence: TestFrameworkEvidence }> = [
    { label: 'a vitest dependency', framework: 'vitest', evidence: evidence({ dependencies: ['vitest'] }) },
    { label: 'a vitest config', framework: 'vitest', evidence: evidence({ configFiles: ['vitest.config.ts'] }) },
    { label: 'a jest dependency', framework: 'jest', evidence: evidence({ dependencies: ['jest'] }) },
    { label: 'a jest config', framework: 'jest', evidence: evidence({ configFiles: ['jest.config.js'] }) },
    { label: 'mocha and chai', framework: 'mocha', evidence: evidence({ dependencies: ['mocha', 'chai'] }) },
    { label: 'a .mocharc', framework: 'mocha', evidence: evidence({ configFiles: ['.mocharc.json'] }) },
    { label: 'a node --test script', framework: 'node-test', evidence: evidence({ scriptText: 'node --test' }) },
  ];

  for (const entry of INSTALLED) {
    it(`selects ${FRAMEWORK_LABEL[entry.framework]} from ${entry.label}`, () => {
      const plan = planTestFrameworks(entry.evidence);
      expect(plan.unit.framework).toBe(entry.framework);
      expect(plan.unit.status).toBe('detected');
      expect(plan.needsUserChoice).toBe(false);
    });
  }

  it('prefers what is installed over what the project shape would suggest', () => {
    // A Vite project already on Mocha keeps Mocha. Detection outranks
    // preference entirely — there is no case where a working suite should be
    // told to move because another runner is a better fit on paper.
    const plan = planTestFrameworks(evidence({ dependencies: ['vite', 'mocha', 'chai'] }));
    expect(plan.unit.framework).toBe('mocha');
    expect(plan.unit.status).toBe('detected');
  });

  it('names the rule that decided it', () => {
    for (const entry of INSTALLED) {
      const plan = planTestFrameworks(entry.evidence);
      expect(plan.unit.rule.trim().length, entry.label).toBeGreaterThan(0);
      expect(plan.unit.evidence.trim().length, entry.label).toBeGreaterThan(0);
    }
  });
});

describe('Jest is never installed alongside Vitest', () => {
  it('forbids it whenever Vitest is the chosen runner', () => {
    const plan = planTestFrameworks(evidence({ dependencies: ['vitest'] }));
    expect(mayInstall(plan, 'jest')).toBe(false);
    const reason = plan.forbidden.find(entry => entry.framework === 'jest')?.reason ?? '';
    expect(reason).toMatch(/two runners/i);
  });

  it('forbids every unit runner that is not the chosen one', () => {
    // Stated as a property rather than for Jest alone: the failure is a
    // scaffolder adding *a* second runner, and Jest is only its commonest form.
    const plan = planTestFrameworks(evidence({ dependencies: ['vitest'] }));
    for (const framework of UNIT_FRAMEWORKS) {
      if (framework === 'vitest') {
        expect(mayInstall(plan, framework)).toBe(true);
        continue;
      }
      expect(mayInstall(plan, framework), `${framework} was installable alongside Vitest`).toBe(false);
    }
  });

  it('does not forbid a runner the project already has', () => {
    // Already installed and not chosen is a fact to leave alone, not a thing to
    // add to. Listing it as forbidden would imply the scaffolder should remove
    // it, which is a migration and a separate decision.
    const plan = planTestFrameworks(evidence({
      dependencies: ['vitest', 'mocha', 'chai'],
      testFiles: ['tests/a.test.ts', 'tests/b.test.ts'],
    }));
    expect(plan.forbidden.some(entry => entry.framework === 'mocha')).toBe(false);
  });

  it('gives every forbidden entry a reason', () => {
    const plan = planTestFrameworks(evidence({ dependencies: ['vitest'] }));
    expect(plan.forbidden.length).toBeGreaterThan(0);
    for (const entry of plan.forbidden) {
      expect(entry.reason.trim().length, entry.framework).toBeGreaterThan(0);
    }
  });
});

describe('two runners installed: the test files decide, or the user does', () => {
  it('picks the one most of the test files are written for', () => {
    const plan = planTestFrameworks(evidence({
      dependencies: ['cypress', 'playwright'],
      testFiles: ['cypress/e2e/a.cy.ts', 'cypress/e2e/b.cy.ts', 'e2e/c.e2e.ts'],
    }));
    expect(plan.e2e.framework).toBe('cypress');
    expect(plan.e2e.evidence).toMatch(/2 test file/);
  });

  it('asks when the test files do not favour either', () => {
    const plan = planTestFrameworks(evidence({ dependencies: ['cypress', 'playwright'] }));
    expect(plan.e2e.status).toBe('ask');
    expect(plan.e2e.framework).toBeUndefined();
    expect(plan.e2e.options).toEqual(['playwright', 'cypress']);
    expect(plan.e2e.question).toMatch(/\?$/);
    expect(plan.needsUserChoice).toBe(true);
  });

  it('asks rather than guessing between two unit runners', () => {
    const plan = planTestFrameworks(evidence({ dependencies: ['vitest', 'jest'] }));
    expect(plan.unit.status).toBe('ask');
    expect(plan.unit.options).toContain('vitest');
    expect(plan.unit.options).toContain('jest');
    expect(plan.needsUserChoice).toBe(true);
  });

  it('never returns a framework on a question', () => {
    // An `ask` that also carried an answer would be acted on by any caller that
    // read the framework first, which defeats the point of asking.
    const plan = planTestFrameworks(evidence({ dependencies: ['vitest', 'jest'] }));
    expect(plan.unit.framework).toBeUndefined();
  });
});

describe('nothing installed: the project shape chooses', () => {
  const CASES: ReadonlyArray<{ label: string; deps: string[]; expected: TestFramework }> = [
    { label: 'Vite', deps: ['vite'], expected: 'vitest' },
    { label: 'SvelteKit', deps: ['@sveltejs/kit'], expected: 'vitest' },
    { label: 'Nuxt', deps: ['nuxt'], expected: 'vitest' },
    { label: 'Astro', deps: ['astro'], expected: 'vitest' },
    { label: 'React with Vite', deps: ['react', 'vite'], expected: 'vitest' },
    { label: 'React without Vite', deps: ['react', 'react-dom'], expected: 'jest' },
  ];

  for (const entry of CASES) {
    it(`chooses ${FRAMEWORK_LABEL[entry.expected]} for ${entry.label}`, () => {
      const plan = planTestFrameworks(evidence({ dependencies: entry.deps }));
      expect(plan.unit.framework).toBe(entry.expected);
      expect(plan.unit.status).toBe('recommended');
    });
  }

  it('asks a Node backend rather than deciding for it', () => {
    // Genuinely a preference: the built-in runner adds no dependency, Jest
    // brings an ecosystem. Neither is wrong, so neither is assumed.
    const plan = planTestFrameworks(evidence({ dependencies: ['express'], isNodeBackend: true }));
    expect(plan.unit.status).toBe('ask');
    expect(plan.unit.options).toEqual(['node-test', 'jest']);
  });

  it('asks when the shape implies nothing at all', () => {
    const plan = planTestFrameworks(evidence());
    expect(plan.unit.status).toBe('ask');
    expect(plan.unit.options?.length).toBeGreaterThan(1);
  });

  it('never silently defaults to Vitest', () => {
    // The old behaviour: `testRunner ?? 'vitest'`, which handed a Vitest file
    // to every project that had no runner regardless of what it was built with.
    const plan = planTestFrameworks(evidence({ dependencies: ['express'], isNodeBackend: true }));
    expect(plan.unit.framework).not.toBe('vitest');
  });
});

describe('unit and end-to-end are separate choices', () => {
  it('keeps a unit runner when Cypress owns end-to-end', () => {
    // The case the old single-field model got wrong: "already uses Cypress"
    // read as "does not need a unit runner".
    const plan = planTestFrameworks(evidence({
      dependencies: ['vite', 'cypress'],
      hasBrowserSurface: true,
    }));
    expect(plan.e2e.framework).toBe('cypress');
    expect(plan.unit.framework).toBe('vitest');
    expect(UNIT_FRAMEWORKS).toContain(plan.unit.framework!);
  });

  it('reports no end-to-end runner as not-needed rather than as a question', () => {
    // A library has nothing to drive. "Not needed" and "not decided" are
    // different, and only one of them should interrupt somebody.
    const plan = planTestFrameworks(evidence({ dependencies: ['vitest'] }));
    expect(plan.e2e.status).toBe('not-needed');
    expect(plan.needsUserChoice).toBe(false);
  });

  it('recommends Playwright for a browser surface with no runner', () => {
    const plan = planTestFrameworks(evidence({ dependencies: ['vite'], hasBrowserSurface: true }));
    expect(plan.e2e.framework).toBe('playwright');
    expect(plan.e2e.status).toBe('recommended');
  });

  it('never puts a browser runner in the unit slot', () => {
    for (const deps of [['cypress'], ['@playwright/test'], ['cypress', 'vitest']]) {
      const plan = planTestFrameworks(evidence({ dependencies: deps, hasBrowserSurface: true }));
      if (plan.unit.framework) {
        expect(E2E_FRAMEWORKS, `${deps.join('+')} put a browser runner in the unit slot`)
          .not.toContain(plan.unit.framework);
      }
    }
  });
});

describe('install commands', () => {
  it('gives every framework that needs one a command', () => {
    for (const framework of [...UNIT_FRAMEWORKS, ...E2E_FRAMEWORKS]) {
      if (framework === 'node-test') {
        continue;
      }
      expect(installCommandFor(framework), framework).toBeTruthy();
    }
  });

  it('gives the built-in runner no command rather than an empty one', () => {
    // The one choice that adds no dependency. A blank command rendered in a
    // setup list reads as a missing step.
    expect(installCommandFor('node-test')).toBeUndefined();
  });

  it('installs chai with mocha, because the rule pairs them', () => {
    expect(installCommandFor('mocha')).toContain('chai');
  });

  it('labels every framework it can select', () => {
    for (const framework of [...UNIT_FRAMEWORKS, ...E2E_FRAMEWORKS]) {
      expect(FRAMEWORK_LABEL[framework]?.trim().length, framework).toBeGreaterThan(0);
    }
  });
});
