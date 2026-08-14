/**
 * Which test runner the Scaffold button should use.
 *
 * The runner used to be a two-value guess: Vitest or Jest, decided from a
 * dependency name, defaulting to Vitest whenever neither was found. That is
 * wrong in both directions. A Mocha project got Vitest files it could not run;
 * a React project with no runner at all got Vitest suggested for a stack that
 * has no Vite in it; and — the worst outcome — a project already on Vitest
 * could be handed a `npm install -D jest`, which is how a repository ends up
 * with two runners and a test suite that only one of them can execute.
 *
 * So framework choice is a *decision*, made once, here, and every consumer
 * reads the result rather than re-deriving it. Four properties hold it honest.
 *
 * **What the project already uses always wins.** Detection outranks preference
 * entirely: there is no situation where a project on Mocha should be handed
 * Vitest because Vitest is nicer. The recommendation ladder is only ever
 * consulted when nothing is installed.
 *
 * **Ambiguity is a question, never a coin toss.** Where two runners are both
 * genuinely present, or where the project shape does not imply one, the plan
 * comes back `ask` with the candidates. Guessing here produces a confidently
 * wrong install that somebody then has to unpick.
 *
 * **Unit and end-to-end are separate choices.** Playwright and Cypress are
 * browser automation, not unit runners, and a project can legitimately need
 * both. Collapsing them into one field is what made "already uses Cypress"
 * read as "does not need a unit runner".
 *
 * **Every decision names the rule that made it**, as the debt register and the
 * severity table do, so an unexpected choice can be argued with rather than
 * merely overridden.
 */

/** Every runner AtlasMind can detect, select and generate for. */
export type TestFramework =
  | 'vitest'
  | 'jest'
  | 'mocha'
  | 'node-test'
  | 'playwright'
  | 'cypress';

/** Runners that execute unit and integration tests. */
export const UNIT_FRAMEWORKS: readonly TestFramework[] = ['vitest', 'jest', 'mocha', 'node-test'];

/** Runners that drive a browser. */
export const E2E_FRAMEWORKS: readonly TestFramework[] = ['playwright', 'cypress'];

export const FRAMEWORK_LABEL: Readonly<Record<TestFramework, string>> = {
  vitest: 'Vitest',
  jest: 'Jest',
  mocha: 'Mocha + Chai',
  'node-test': 'Node test runner',
  playwright: 'Playwright',
  cypress: 'Cypress',
};

// ── Evidence ─────────────────────────────────────────────────────

/**
 * What the workspace can be asked about its testing setup.
 *
 * Gathered by the caller so this module stays pure and testable against a
 * described project rather than a real one. Every field is required but may be
 * empty — an empty list means "we looked and found none", which is a different
 * fact from the caller not having looked, and a caller that cannot look should
 * not be calling this at all.
 */
export interface TestFrameworkEvidence {
  /** `dependencies` + `devDependencies` names, lowercased. */
  readonly dependencies: readonly string[];
  /** `scripts` values, joined — a runner is often only visible in a script. */
  readonly scriptText: string;
  /** Workspace-relative config paths that exist. */
  readonly configFiles: readonly string[];
  /** Workspace-relative test file paths. */
  readonly testFiles: readonly string[];
  /** True when the project is a Node backend rather than a browser app. */
  readonly isNodeBackend?: boolean;
  /** True when the project ships a user interface. */
  readonly hasBrowserSurface?: boolean;
}

// ── Decision ─────────────────────────────────────────────────────

export type FrameworkDecisionStatus =
  /** The project already uses it. Nothing is installed. */
  | 'detected'
  /** Nothing is installed and the project shape implies this one. */
  | 'recommended'
  /** The project does not imply one. The user must choose. */
  | 'ask'
  /** Not needed — the project has no such surface. */
  | 'not-needed';

export interface FrameworkChoice {
  /** Absent when `status` is `ask` or `not-needed`. */
  readonly framework?: TestFramework;
  readonly status: FrameworkDecisionStatus;
  /** The declared rule that decided it. */
  readonly rule: string;
  /** What was actually found. */
  readonly evidence: string;
  /** Candidates to put in front of the user. Present only when asking. */
  readonly options?: readonly TestFramework[];
  /** The question to ask, in words. Present only when asking. */
  readonly question?: string;
}

export interface ForbiddenInstall {
  readonly framework: TestFramework;
  readonly reason: string;
}

export interface TestFrameworkPlan {
  /** The runner for unit and integration tests. */
  readonly unit: FrameworkChoice;
  /** The browser-automation runner, when the project has or needs one. */
  readonly e2e: FrameworkChoice;
  /**
   * Runners that must not be installed, each with the reason.
   *
   * This is the "never install Jest alongside Vitest" rule as data rather than
   * as a comment somebody has to remember. The installer reads it; a test walks
   * it.
   */
  readonly forbidden: readonly ForbiddenInstall[];
  /** True when any part of the plan needs the user before scaffolding. */
  readonly needsUserChoice: boolean;
}

// ── Detection ────────────────────────────────────────────────────

/** Dependency and config signatures, by framework. */
const SIGNATURES: Readonly<Record<TestFramework, {
  deps: readonly string[];
  configs: readonly RegExp[];
  scriptHint?: RegExp;
}>> = {
  vitest: {
    deps: ['vitest', '@vitest/ui', '@vitest/coverage-v8'],
    configs: [/^vitest\.config\.[cm]?[jt]s$/i, /^vitest\.workspace\.[cm]?[jt]s$/i],
    scriptHint: /\bvitest\b/,
  },
  jest: {
    deps: ['jest', 'ts-jest', 'babel-jest', '@jest/globals', 'jest-environment-jsdom'],
    configs: [/^jest\.config\.[cm]?[jt]s$/i, /^jest\.config\.json$/i],
    scriptHint: /\bjest\b/,
  },
  mocha: {
    // Mocha is the one runner routinely paired with a separate assertion
    // library, and the pairing is what the rule names — a project with `mocha`
    // and no assertion library is usually a leftover.
    deps: ['mocha', 'chai', '@types/mocha'],
    configs: [/^\.mocharc\.(json|ya?ml|[cm]?js)$/i, /^mocha\.opts$/i],
    scriptHint: /\bmocha\b/,
  },
  'node-test': {
    deps: [],
    configs: [],
    scriptHint: /node\s+--test|node:test/,
  },
  playwright: {
    deps: ['@playwright/test', 'playwright'],
    configs: [/^playwright\.config\.[cm]?[jt]s$/i],
    scriptHint: /\bplaywright\b/,
  },
  cypress: {
    deps: ['cypress'],
    configs: [/^cypress\.config\.[cm]?[jt]s$/i, /^cypress\.json$/i],
    scriptHint: /\bcypress\b/,
  },
};

/** Build tooling, which decides the recommendation when nothing is installed. */
const TOOLING = {
  vite: ['vite', '@vitejs/plugin-react', '@vitejs/plugin-vue', '@sveltejs/kit', 'nuxt', 'astro'],
  metaFramework: ['@sveltejs/kit', 'nuxt', 'astro', 'next'],
  react: ['react', 'react-dom'],
} as const;

const includesAny = (haystack: readonly string[], needles: readonly string[]): boolean =>
  needles.some(needle => haystack.includes(needle));

function isPresent(framework: TestFramework, evidence: TestFrameworkEvidence): boolean {
  const signature = SIGNATURES[framework];
  if (includesAny(evidence.dependencies, signature.deps)) {
    return true;
  }
  if (signature.configs.some(pattern => evidence.configFiles.some(file => pattern.test(basename(file))))) {
    return true;
  }
  // A script is weaker evidence than a dependency but stronger than nothing —
  // `node --test` in particular leaves no dependency at all, which is the
  // whole point of it.
  return signature.scriptHint !== undefined && signature.scriptHint.test(evidence.scriptText);
}

function basename(file: string): string {
  const parts = file.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? file;
}

/**
 * Which runner owns a test file — at most one.
 *
 * Exclusive on purpose. The obvious implementation gives each framework a
 * pattern and counts matches independently, and it is wrong the moment the
 * patterns overlap: Cypress conventionally puts its specs in `cypress/e2e/`,
 * which also matches Playwright's `e2e/` directory rule, so every Cypress file
 * was counted for both. The totals then exceed the number of files and a
 * majority computed from them means nothing — in the case that broke this,
 * Playwright "won" a project with no Playwright tests in it.
 *
 * Ordered most-specific first. A `.cy.` suffix or a `cypress/` directory is
 * unambiguous; Playwright's `e2e/` is a convention it shares with everybody.
 */
function ownerOfTestFile(file: string): TestFramework | undefined {
  const normalized = file.replace(/\\/g, '/');
  if (/\.cy\.[cm]?[jt]sx?$/i.test(normalized) || /(^|\/)cypress\//i.test(normalized)) {
    return 'cypress';
  }
  if (/\.(e2e|pw)\.[cm]?[jt]sx?$/i.test(normalized) || /(^|\/)e2e\//i.test(normalized)) {
    return 'playwright';
  }
  return undefined;
}

/**
 * How many test files a candidate owns.
 *
 * Used only to break a tie between two runners that are both installed:
 * whichever the majority of the suite is written for is the one a new file
 * should join.
 */
function countOwnedTestFiles(framework: TestFramework, testFiles: readonly string[]): number {
  return testFiles.filter(file => ownerOfTestFile(file) === framework).length;
}

// ── Planning ─────────────────────────────────────────────────────

const DETECTION_ORDER: readonly TestFramework[] = ['vitest', 'jest', 'mocha', 'node-test'];

function planUnit(evidence: TestFrameworkEvidence): FrameworkChoice {
  const installed = DETECTION_ORDER.filter(framework => isPresent(framework, evidence));

  if (installed.length === 1) {
    const framework = installed[0]!;
    return {
      framework,
      status: 'detected',
      rule: 'The project already uses this runner.',
      evidence: `${FRAMEWORK_LABEL[framework]} was found in the project.`,
    };
  }

  if (installed.length > 1) {
    // Two runners really are installed. Prefer the one the suite is mostly
    // written for; a leftover dependency should not outvote the actual tests.
    const scored = installed
      .map(framework => ({ framework, count: countOwnedTestFiles(framework, evidence.testFiles) }))
      .sort((left, right) => right.count - left.count);
    const [best, next] = scored;

    if (best && next && best.count > next.count) {
      return {
        framework: best.framework,
        status: 'detected',
        rule: 'Two runners are installed; the one most of the test files are written for wins.',
        evidence: `${FRAMEWORK_LABEL[best.framework]} owns ${best.count} test file(s) against ${FRAMEWORK_LABEL[next.framework]}'s ${next.count}.`,
      };
    }

    return {
      status: 'ask',
      rule: 'Two runners are installed and the test files do not favour either.',
      evidence: `Found ${installed.map(framework => FRAMEWORK_LABEL[framework]).join(' and ')}, with no clear majority in the test files.`,
      options: installed,
      question: 'This project has more than one test runner installed. Which should new tests be written for?',
    };
  }

  // Nothing installed. Only now does the recommendation ladder apply.
  if (includesAny(evidence.dependencies, TOOLING.vite)) {
    const meta = evidence.dependencies.find(dep => (TOOLING.metaFramework as readonly string[]).includes(dep));
    return {
      framework: 'vitest',
      status: 'recommended',
      rule: 'A Vite-based project uses Vitest, which shares its transform pipeline.',
      evidence: meta
        ? `${meta} builds on Vite, so Vitest runs the same config the app is built with.`
        : 'Vite is in the dependency list.',
    };
  }

  if (includesAny(evidence.dependencies, TOOLING.react)) {
    return {
      framework: 'jest',
      status: 'recommended',
      rule: 'A React project without Vite uses Jest.',
      evidence: 'React is present and Vite is not, so the transform pipeline is Babel or Webpack rather than Vite.',
    };
  }

  if (evidence.isNodeBackend === true) {
    // Genuinely a preference, and the spec says so: the built-in runner needs
    // no dependency, Jest brings an ecosystem. Neither is wrong.
    return {
      status: 'ask',
      rule: 'A Node backend can reasonably use either the built-in runner or Jest.',
      evidence: 'No runner is installed and the project is a Node backend.',
      options: ['node-test', 'jest'],
      question: 'No test runner is installed. Node\'s built-in runner needs no dependency; Jest brings mocking and a larger ecosystem. Which would you prefer?',
    };
  }

  return {
    status: 'ask',
    rule: 'Nothing is installed and the project shape does not imply a runner.',
    evidence: 'No test runner, and no Vite, React or Node-backend signal to choose from.',
    options: ['vitest', 'jest', 'mocha', 'node-test'],
    question: 'No test runner is installed and the project shape does not point at one. Which would you like to use?',
  };
}

function planE2e(evidence: TestFrameworkEvidence, unit: FrameworkChoice): FrameworkChoice {
  const installed = E2E_FRAMEWORKS.filter(framework => isPresent(framework, evidence));

  if (installed.length === 1) {
    const framework = installed[0]!;
    return {
      framework,
      status: 'detected',
      rule: 'The project already uses this browser-automation runner.',
      evidence: `${FRAMEWORK_LABEL[framework]} was found in the project.`,
    };
  }

  if (installed.length > 1) {
    const scored = installed
      .map(framework => ({ framework, count: countOwnedTestFiles(framework, evidence.testFiles) }))
      .sort((left, right) => right.count - left.count);
    const [best, next] = scored;
    if (best && next && best.count > next.count) {
      return {
        framework: best.framework,
        status: 'detected',
        rule: 'Both browser runners are installed; the one most of the tests are written for wins.',
        evidence: `${FRAMEWORK_LABEL[best.framework]} owns ${best.count} test file(s) against ${FRAMEWORK_LABEL[next.framework]}'s ${next.count}.`,
      };
    }
    return {
      status: 'ask',
      rule: 'Both browser runners are installed and the test files do not favour either.',
      evidence: 'Found Playwright and Cypress, with no clear majority in the test files.',
      options: installed,
      question: 'This project has both Playwright and Cypress. Which should new end-to-end tests use?',
    };
  }

  if (evidence.hasBrowserSurface !== true) {
    // No user interface, so there is nothing to drive. Reported explicitly
    // rather than left blank: "not needed" and "not decided" are different,
    // and only one of them should produce a question.
    return {
      status: 'not-needed',
      rule: 'The project has no browser surface to automate.',
      evidence: 'No user interface was detected, so no end-to-end runner is required.',
    };
  }

  return {
    framework: 'playwright',
    status: 'recommended',
    rule: 'A project with a browser surface and no end-to-end runner starts with Playwright.',
    evidence: unit.framework === 'cypress'
      ? 'Cypress is already the end-to-end runner.'
      : 'A user interface is present and no browser-automation runner is installed.',
  };
}

/**
 * Everything that must not be installed, and why.
 *
 * The rule that matters: **never add Jest to a project already using Vitest.**
 * Two runners in one repository means two config files, two mocking APIs and a
 * suite where each half only runs under one of them — and it happens by
 * accident, from a scaffolder defaulting to its favourite. Expressed as data so
 * the installer cannot forget it and a test can walk it.
 */
function forbiddenInstalls(evidence: TestFrameworkEvidence, unit: FrameworkChoice): ForbiddenInstall[] {
  const forbidden: ForbiddenInstall[] = [];
  for (const framework of UNIT_FRAMEWORKS) {
    if (framework === unit.framework) {
      continue;
    }
    if (isPresent(framework, evidence)) {
      // Already here and not chosen — leave it alone rather than adding to it.
      continue;
    }
    const chosen = unit.framework;
    if (chosen !== undefined) {
      forbidden.push({
        framework,
        reason: `${FRAMEWORK_LABEL[chosen]} is this project's runner; installing ${FRAMEWORK_LABEL[framework]} alongside it would leave two runners and a suite only one of them can execute.`,
      });
    }
  }
  return forbidden;
}

/**
 * Decide which runners the Scaffold button should use.
 *
 * Pure: the caller gathers the evidence. Returns a plan rather than performing
 * anything, so the decision can be shown to somebody before a dependency is
 * added to their project.
 */
export function planTestFrameworks(evidence: TestFrameworkEvidence): TestFrameworkPlan {
  const unit = planUnit(evidence);
  const e2e = planE2e(evidence, unit);
  return {
    unit,
    e2e,
    forbidden: forbiddenInstalls(evidence, unit),
    needsUserChoice: unit.status === 'ask' || e2e.status === 'ask',
  };
}

/**
 * Every framework the project actually has, not just the one that was chosen.
 *
 * The Testing surfaces reported a single "framework: Vitest" label, which is
 * true and incomplete: a project running Vitest for units and Playwright for
 * end-to-end has two, and a page naming one of them reads as though the other
 * is not there. Ordered by the detection ladder so the list is stable between
 * renders rather than following whatever order the manifest happened to use.
 */
export function detectedFrameworks(evidence: TestFrameworkEvidence): TestFramework[] {
  return [...DETECTION_ORDER, ...E2E_FRAMEWORKS].filter(framework => isPresent(framework, evidence));
}

/**
 * The install command for a framework, or `undefined` when it needs none.
 *
 * `node-test` is the reason this returns `undefined` rather than an empty
 * string: the built-in runner is the one choice that adds no dependency, and a
 * blank command rendered in a setup list reads as a missing step.
 */
export function installCommandFor(framework: TestFramework): string | undefined {
  switch (framework) {
    case 'vitest': return 'npm install -D vitest';
    case 'jest': return 'npm install -D jest';
    case 'mocha': return 'npm install -D mocha chai';
    case 'playwright': return 'npm install -D @playwright/test && npx playwright install';
    case 'cypress': return 'npm install -D cypress';
    case 'node-test': return undefined;
  }
}

/**
 * Is installing this framework permitted by the plan?
 *
 * The installer's gate. Reading the list rather than re-deriving the rule keeps
 * one answer to "may we add Jest here?".
 */
export function mayInstall(plan: TestFrameworkPlan, framework: TestFramework): boolean {
  return !plan.forbidden.some(entry => entry.framework === framework);
}
