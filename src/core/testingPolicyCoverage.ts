/**
 * TestingPolicyCoverage — what each *enabled* testing policy actually has to
 * show for itself.
 *
 * The Testing dashboard could already say how many test files and cases a
 * project has, and which methodologies were switched on. It could not say the
 * one thing that matters once a policy is enabled: **is anything actually
 * testing it, and is any of it failing?** A project with `mutation` and
 * `visual` ticked and no mutation or visual test in the tree reads as fully
 * covered, which is worse than reading as unconfigured.
 *
 * Two deliberate constraints shape this module:
 *
 * 1. **Absence of evidence is reported as absence of evidence.** A policy that
 *    leaves no file artifact — exploratory testing, black-box technique, agile
 *    practice — is reported as *not file-evident*, never as "missing tests".
 *    Flagging a practice as a gap trains people to ignore the panel.
 * 2. **Failures are only ever read from a report the project produced.** This
 *    module never runs a test command; a dashboard that shells out on render is
 *    both a surprise and an execution surface. When no report exists the panel
 *    says so and shows the command that would create one — it never renders
 *    "0 failures", because no data is not a green light.
 *
 * Pure and `vscode`-free: the caller gathers the evidence (file list, deps,
 * scripts, report text) and this module derives the readout, so the whole
 * derivation is unit-testable.
 */

import { TESTING_METHODOLOGY_DEFINITIONS, type TestingMethodologyId } from '../types.js';

// ── Public shapes ────────────────────────────────────────────────

export type TestingPolicyStatus =
  /** Test files matching this policy exist. */
  | 'covered'
  /** Its tooling is installed but nothing in the tree tests with it. */
  | 'tooling-only'
  /** Enabled, with no tooling and no tests to show for it. */
  | 'missing'
  /** A practice rather than an artifact — nothing to detect from files. */
  | 'not-file-evident';

export interface TestingPolicyFailure {
  /** Test case name as the report recorded it. */
  name: string;
  /** Owning suite/class as the report recorded it, when present. */
  suite?: string;
  /** Workspace-relative file, when the report attributes one. */
  file?: string;
  /** 'failure' | 'error' as distinguished by the report. */
  kind: 'failure' | 'error';
}

export interface TestingPolicyRow {
  id: TestingMethodologyId;
  label: string;
  category: string;
  status: TestingPolicyStatus;
  statusLabel: string;
  /** Test files whose path evidences this policy. */
  fileCount: number;
  /** Test cases in those files. */
  caseCount: number;
  /** Cases in those files marked skip/todo — written but not running. */
  skippedCount: number;
  /** Failing cases from the report attributed to this policy. */
  failedCount: number;
  /** Tooling signals found: dependency, script, or config names. */
  toolingSignals: string[];
  detail: string;
  /** A representative file to open, when one exists. */
  exampleFile?: string;
  /** Chat prompt that addresses this row's gap (or reviews its failures). */
  actionPrompt: string;
  failures: TestingPolicyFailure[];
}

export interface TestingPolicyReportInfo {
  relativePath: string;
  suites: number;
  tests: number;
  failed: number;
  skipped: number;
  /** True when the report predates the newest test file — its verdict is old. */
  stale: boolean;
  staleDetail?: string;
}

export interface TestingPolicyCoverage {
  rows: TestingPolicyRow[];
  activeCount: number;
  coveredCount: number;
  toolingOnlyCount: number;
  missingCount: number;
  practiceCount: number;
  /** Failing cases across the whole report (not just attributed ones). */
  totalFailed: number;
  /** Skipped cases counted from the workspace's own test files. */
  totalSkipped: number;
  /** Report failures that matched no enabled policy. */
  unattributedFailures: TestingPolicyFailure[];
  report?: TestingPolicyReportInfo;
  /** How to produce a report, when there isn't one. */
  reportHint: string;
  summary: string;
}

export interface TestingPolicyTestFile {
  relativePath: string;
  cases: number;
  /** Cases marked skip/todo in this file. */
  skipped: number;
}

export interface TestingPolicyEvidenceInput {
  /** Enabled methodology ids. */
  enabledMethodologies: TestingMethodologyId[];
  testFiles: TestingPolicyTestFile[];
  /** Dependency + devDependency names. */
  dependencies: string[];
  /** package.json (or equivalent) script names. */
  scripts: string[];
  /** Workspace-relative config/spec paths that were found. */
  configFiles: string[];
  /** Parsed report, when the project produced one. */
  report?: ParsedTestReport & { relativePath: string; generatedAtMs?: number };
  /** Newest test-file mtime, for the staleness comparison. */
  newestTestFileMs?: number;
  /** Detected framework label, used to suggest the right report command. */
  frameworkLabel?: string;
}

// ── Markers ──────────────────────────────────────────────────────

interface PolicyMarkers {
  /** Paths that evidence this policy. */
  filePatterns?: RegExp[];
  /** Paths that look like this policy but belong to a more specific one. */
  excludePatterns?: RegExp[];
  /** Dependency names, matched as a substring of a lowercased dep name. */
  dependencies?: string[];
  /** Script names, matched case-insensitively. */
  scriptPatterns?: RegExp[];
  /** Config/spec paths that evidence the tooling. */
  configPatterns?: RegExp[];
  /**
   * A practice rather than an artifact. Nothing about the file tree can confirm
   * or deny it, so it is never reported as a gap.
   */
  practiceOnly?: boolean;
  /**
   * For this policy the configuration *is* the artifact, not merely the tooling.
   *
   * Every other policy leaves test files behind and its config only proves the
   * runner is installed — so `tooling-only` ("No tests yet") is the honest
   * reading. Continuous testing leaves behind a pipeline definition and nothing
   * else; without this, a project running its whole suite on every push capped
   * at "No tests yet" permanently and read as a gap it could never close.
   *
   * Only a matching **config file** counts. Script names deliberately do not:
   * `continuous`'s script patterns include `/watch/i`, and a `npm run watch` for
   * a bundler would otherwise be reported as continuous testing. A false
   * "covered" is the one outcome this panel must not produce.
   */
  configIsEvidence?: boolean;
}

const GENERIC_TEST_FILE = /(^|\/)(tests?|__tests__|spec)\//i;
const TEST_FILE_SUFFIX = /\.(test|spec)\.[a-z0-9]+$/i;
const E2E_MARKERS = [/(^|[./_-])e2e([./_-]|$)/i, /(^|\/)(cypress|playwright|e2e)\//i, /\.cy\.[a-z0-9]+$/i];
const INTEGRATION_MARKERS = [/(^|[./_-])integration([./_-]|$)/i, /(^|\/)integration\//i];

/**
 * What each policy leaves behind when it is actually practised.
 *
 * Deliberately conservative: a marker earns its place by being something the
 * tooling itself creates (a `.feature` file, a `stryker.conf`, a `__snapshots__`
 * directory), not by being a word that might appear in a filename. A false
 * "covered" is the one outcome this panel must not produce.
 */
const POLICY_MARKERS: Record<TestingMethodologyId, PolicyMarkers> = {
  // TDD's artifact is simply that tests exist and are maintained alongside code.
  tdd: {
    filePatterns: [TEST_FILE_SUFFIX, GENERIC_TEST_FILE, /_test\.[a-z0-9]+$/i, /(^|\/)test_[^/]+\.py$/i],
    dependencies: ['vitest', 'jest', 'mocha', 'jasmine', 'pytest', 'junit', 'rspec', 'minitest', 'xunit', 'nunit'],
    scriptPatterns: [/^test$/i, /^test:/i],
  },
  unit: {
    filePatterns: [TEST_FILE_SUFFIX, /_test\.[a-z0-9]+$/i, /(^|\/)test_[^/]+\.py$/i],
    excludePatterns: [...E2E_MARKERS, ...INTEGRATION_MARKERS],
    dependencies: ['vitest', 'jest', 'mocha', 'jasmine', 'pytest', 'junit', 'xunit', 'nunit', 'minitest'],
    scriptPatterns: [/^test$/i, /unit/i],
  },
  integration: {
    filePatterns: INTEGRATION_MARKERS,
    scriptPatterns: [/integration/i],
  },
  e2e: {
    filePatterns: E2E_MARKERS,
    dependencies: ['@playwright/test', 'playwright', 'cypress', 'puppeteer', 'webdriverio', 'selenium', 'nightwatch', 'testcafe'],
    scriptPatterns: [/e2e/i, /cypress/i, /playwright/i],
    configPatterns: [/^playwright\.config\./i, /^cypress\.config\./i, /^wdio\.conf\./i],
  },
  bdd: {
    filePatterns: [/\.feature$/i, /(^|\/)features?\//i, /(^|\/)step[-_]?definitions?\//i],
    dependencies: ['cucumber', 'jest-cucumber', 'codeceptjs', 'behave', 'specflow', 'pytest-bdd'],
    scriptPatterns: [/cucumber/i, /bdd/i],
  },
  atdd: {
    filePatterns: [/\.robot$/i, /(^|\/)acceptance\//i],
    dependencies: ['robotframework', 'fitnesse', 'gauge', 'cucumber'],
    scriptPatterns: [/acceptance/i, /atdd/i],
  },
  sdd: {
    filePatterns: [/(^|\/)(openapi|asyncapi|swagger)[^/]*\.(ya?ml|json)$/i, /(^|\/)(api|spec)\/(openapi|asyncapi)/i],
    dependencies: ['@stoplight/spectral-cli', 'spectral', 'dredd', '@stoplight/prism-cli', 'openapi', 'schemathesis'],
    scriptPatterns: [/spectral/i, /openapi/i, /contract:spec/i],
    configPatterns: [/^\.spectral\./i, /^redocly\./i],
  },
  mutation: {
    filePatterns: [/(^|\/)mutation\//i],
    dependencies: ['@stryker-mutator/core', 'stryker', 'mutmut', 'cosmic-ray', 'pitest', 'mutant'],
    scriptPatterns: [/mutation/i, /stryker/i],
    configPatterns: [/^stryker\.conf\./i, /^\.stryker/i, /^setup\.cfg$/i],
  },
  property: {
    filePatterns: [/(^|[./_-])propert(y|ies)([./_-]|$)/i, /(^|\/)fuzz\//i],
    dependencies: ['fast-check', 'hypothesis', 'jsverify', 'proptest', 'quickcheck', 'jqwik'],
    scriptPatterns: [/propert/i, /fuzz/i],
  },
  snapshot: {
    filePatterns: [/(^|\/)__snapshots__\//i, /\.snap$/i, /(^|[./_-])snapshot([./_-]|$)/i],
    dependencies: ['syrupy', 'snapshottest', 'jest-serializer'],
    scriptPatterns: [/snapshot/i],
  },
  contract: {
    filePatterns: [/(^|\/)pacts?\//i, /(^|[./_-])contract([./_-]|$)/i],
    dependencies: ['@pact-foundation/pact', 'pact', 'pactman', 'spring-cloud-contract', 'schemathesis'],
    scriptPatterns: [/contract/i, /pact/i],
  },
  continuous: {
    configPatterns: [
      /^\.github\/workflows\//i, /^\.gitlab-ci\.ya?ml$/i, /^azure-pipelines\.ya?ml$/i,
      /^Jenkinsfile$/i, /^\.circleci\//i, /^\.travis\.ya?ml$/i, /^bitbucket-pipelines\.ya?ml$/i,
    ],
    scriptPatterns: [/^ci$/i, /^ci:/i, /watch/i],
    configIsEvidence: true,
  },
  performance: {
    filePatterns: [/(^|\/)(performance|perf|bench(marks?)?|load)\//i, /\.k6\.[a-z0-9]+$/i, /(^|\/)locustfile\.py$/i, /\.jmx$/i],
    dependencies: ['k6', 'artillery', 'autocannon', 'benchmark', 'tinybench', 'locust', 'jmeter', 'gatling'],
    scriptPatterns: [/perf/i, /bench/i, /load/i],
  },
  'security-testing': {
    filePatterns: [/(^|\/)security\//i, /(^|[./_-])security([./_-]|$)/i],
    dependencies: ['semgrep', 'snyk', 'bandit', 'safety', 'zaproxy', 'trivy', 'gitleaks', 'audit-ci'],
    scriptPatterns: [/security/i, /audit/i, /semgrep/i, /snyk/i],
    configPatterns: [/^\.semgrep/i, /^semgrep\.ya?ml$/i, /^\.snyk$/i, /^\.gitleaks/i, /^SECURITY\.md$/i],
  },
  visual: {
    filePatterns: [/(^|\/)(visual|__image_snapshots__|backstop_data|\.reg)\//i, /(^|[./_-])visual([./_-]|$)/i],
    dependencies: ['backstopjs', '@percy/cli', 'percy', 'chromatic', 'reg-suit', 'loki', 'jest-image-snapshot', 'pixelmatch'],
    scriptPatterns: [/visual/i, /percy/i, /chromatic/i, /backstop/i],
    configPatterns: [/^backstop\.json$/i, /^\.percy\./i, /^loki\.config\./i],
  },
  mbt: {
    filePatterns: [/(^|\/)models?\/.*\.(json|graphml|dot)$/i],
    dependencies: ['graphwalker', 'modeljunit', 'altwalker'],
    scriptPatterns: [/model-based/i, /mbt/i],
  },
  // Practices. Real, valuable, and invisible to a file scan — so never a "gap".
  'v-model': { practiceOnly: true },
  'white-box': { practiceOnly: true },
  'test-design': { practiceOnly: true },
  'black-box': { practiceOnly: true },
  'gray-box': { practiceOnly: true },
  exploratory: { practiceOnly: true },
  'agile-testing': { practiceOnly: true },
};

// ── Report parsing (untrusted input) ─────────────────────────────

export interface ParsedTestReportCase {
  name: string;
  suite?: string;
  file?: string;
  status: 'failed' | 'error' | 'skipped' | 'passed';
}

export interface ParsedTestReport {
  suites: number;
  tests: number;
  failed: number;
  skipped: number;
  /** Failing/erroring cases, capped. */
  failures: ParsedTestReportCase[];
}

const MAX_REPORT_BYTES = 4_000_000;
const MAX_REPORT_FAILURES = 60;
const MAX_NAME = 200;

/**
 * Parse a JUnit-style XML report (the interchange format every mainstream runner
 * can emit: vitest/jest reporters, pytest `--junitxml`, Playwright, surefire,
 * gotestsum, dotnet).
 *
 * The file is untrusted input — it may be generated by CI from a branch nobody
 * reviewed — so this never throws, never resolves entities or external DTDs
 * (attributes are read by regex, not by an XML parser), caps how much it reads,
 * and clamps every string it keeps. **Failure messages are deliberately not
 * extracted**: an assertion message can contain values from a test environment,
 * and this data is rendered in a webview. Names, suites, and file paths are
 * enough to open the failing test.
 */
export function parseJUnitReport(xml: string): ParsedTestReport | undefined {
  if (typeof xml !== 'string' || xml.length === 0) {
    return undefined;
  }
  const text = xml.slice(0, MAX_REPORT_BYTES);
  if (!/<testsuite[\s>]/i.test(text) && !/<testcase[\s>]/i.test(text)) {
    return undefined;
  }

  let suites = 0;
  let tests = 0;
  let failed = 0;
  let skipped = 0;
  const failures: ParsedTestReportCase[] = [];

  // Suite-level totals when the report provides them. `testsuites` (the root
  // aggregate) is skipped so its counts are not added on top of its children.
  const suiteTagPattern = /<testsuite\s([^>]*)>/gi;
  let suiteMatch: RegExpExecArray | null;
  while ((suiteMatch = suiteTagPattern.exec(text)) !== null) {
    suites += 1;
    const attrs = suiteMatch[1] ?? '';
    tests += readIntAttr(attrs, 'tests');
    failed += readIntAttr(attrs, 'failures') + readIntAttr(attrs, 'errors');
    skipped += readIntAttr(attrs, 'skipped');
  }

  // Case-level detail. A `<testcase …/>` that self-closes cannot have failed.
  const casePattern = /<testcase\s([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/gi;
  let caseMatch: RegExpExecArray | null;
  let countedCases = 0;
  let countedFailures = 0;
  let countedSkips = 0;
  while ((caseMatch = casePattern.exec(text)) !== null) {
    countedCases += 1;
    const attrs = caseMatch[1] ?? '';
    const body = caseMatch[3] ?? '';
    const isError = /<error[\s>/]/i.test(body);
    const isFailure = /<failure[\s>/]/i.test(body);
    const isSkipped = /<skipped[\s>/]/i.test(body);
    if (isSkipped) {
      countedSkips += 1;
    }
    if (!isError && !isFailure) {
      continue;
    }
    countedFailures += 1;
    if (failures.length >= MAX_REPORT_FAILURES) {
      continue;
    }
    const name = clamp(readAttr(attrs, 'name')) || '(unnamed test)';
    const suite = clamp(readAttr(attrs, 'classname'));
    const file = clamp(readAttr(attrs, 'file'));
    failures.push({
      name,
      ...(suite ? { suite } : {}),
      ...(file ? { file: file.replace(/\\/g, '/') } : {}),
      status: isError ? 'error' : 'failed',
    });
  }

  // Prefer the counts we can see over the ones the report asserts: a truncated
  // or hand-edited report should not be able to claim a clean run.
  if (tests === 0) {
    tests = countedCases;
  }
  if (countedFailures > failed) {
    failed = countedFailures;
  }
  if (countedSkips > skipped) {
    skipped = countedSkips;
  }
  if (suites === 0 && countedCases > 0) {
    suites = 1;
  }

  return { suites, tests, failed, skipped, failures };
}

function readAttr(attrs: string, name: string): string {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(attrs);
  const raw = match?.[2] ?? match?.[3] ?? '';
  return decodeXmlEntities(raw);
}

function readIntAttr(attrs: string, name: string): number {
  const parsed = Number.parseInt(readAttr(attrs, name), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 1_000_000) : 0;
}

/** Only the five predefined entities — never a numeric or custom entity. */
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Strip control characters and clamp — this text lands in a webview. */
function clamp(value: string, max = MAX_NAME): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// ── Derivation ───────────────────────────────────────────────────

const STATUS_LABEL: Record<TestingPolicyStatus, string> = {
  covered: 'Tested',
  'tooling-only': 'No tests yet',
  missing: 'Nothing found',
  'not-file-evident': 'Practice',
};

function matchesAny(value: string, patterns: RegExp[] | undefined): boolean {
  return (patterns ?? []).some(pattern => pattern.test(value));
}

/** Does this file path evidence this policy? */
function fileEvidencesPolicy(relativePath: string, markers: PolicyMarkers): boolean {
  if (!matchesAny(relativePath, markers.filePatterns)) {
    return false;
  }
  return !matchesAny(relativePath, markers.excludePatterns);
}

/**
 * The config files that evidence this policy — a strict subset of its tooling
 * signals, kept separate because `configIsEvidence` may promote these to
 * `covered` and must not be able to promote a script name.
 */
function configSignalsFor(markers: PolicyMarkers, input: TestingPolicyEvidenceInput): string[] {
  return input.configFiles.filter(config => matchesAny(config, markers.configPatterns));
}

function toolingSignalsFor(markers: PolicyMarkers, input: TestingPolicyEvidenceInput): string[] {
  const signals: string[] = [];
  for (const dep of input.dependencies) {
    const lower = dep.toLowerCase();
    if ((markers.dependencies ?? []).some(marker => lower === marker || lower.includes(marker))) {
      signals.push(dep);
    }
  }
  for (const script of input.scripts) {
    if (matchesAny(script, markers.scriptPatterns)) {
      signals.push(`npm run ${script}`);
    }
  }
  for (const config of input.configFiles) {
    if (matchesAny(config, markers.configPatterns)) {
      signals.push(config);
    }
  }
  return [...new Set(signals)].slice(0, 6);
}

/**
 * Suggest the command that would produce a JUnit report for the detected runner.
 * A hint, quoted for the user to run — nothing here executes it.
 */
function reportCommandHint(frameworkLabel: string | undefined): string {
  const label = (frameworkLabel ?? '').toLowerCase();
  if (label.includes('vitest')) {
    return 'npx vitest run --reporter=junit --outputFile=test-results/junit.xml';
  }
  if (label.includes('jest')) {
    return 'npx jest --reporters=default --reporters=jest-junit';
  }
  if (label.includes('playwright')) {
    return 'npx playwright test --reporter=junit';
  }
  if (label.includes('pytest') || label.includes('python')) {
    return 'pytest --junitxml=test-results/junit.xml';
  }
  if (label.includes('go')) {
    return 'gotestsum --junitfile test-results/junit.xml';
  }
  if (label.includes('cargo') || label.includes('rust')) {
    return 'cargo nextest run --profile ci';
  }
  if (label.includes('maven') || label.includes('junit')) {
    return 'mvn test  # surefire writes target/surefire-reports/*.xml';
  }
  if (label.includes('dotnet')) {
    return 'dotnet test --logger "junit;LogFilePath=test-results/junit.xml"';
  }
  return 'Run your test command with a JUnit reporter, writing to test-results/junit.xml';
}

/**
 * Derive the per-policy readout from gathered evidence.
 *
 * Total by construction: unknown ids are ignored, missing evidence produces an
 * honest status rather than an assumption, and no branch throws.
 */
export function deriveTestingPolicyCoverage(input: TestingPolicyEvidenceInput): TestingPolicyCoverage {
  const enabled = [...new Set(input.enabledMethodologies)]
    .filter(id => POLICY_MARKERS[id] !== undefined);
  const report = input.report;
  const attributed = new Set<number>();

  const rows: TestingPolicyRow[] = enabled.map(id => {
    const definition = TESTING_METHODOLOGY_DEFINITIONS.find(entry => entry.id === id);
    const markers = POLICY_MARKERS[id];
    const label = definition?.label ?? id;
    const category = definition?.category ?? 'structural';

    const matchingFiles = markers.practiceOnly
      ? []
      : input.testFiles.filter(file => fileEvidencesPolicy(file.relativePath, markers));
    const caseCount = matchingFiles.reduce((sum, file) => sum + Math.max(0, file.cases), 0);
    const skippedCount = matchingFiles.reduce((sum, file) => sum + Math.max(0, file.skipped), 0);
    const toolingSignals = markers.practiceOnly ? [] : toolingSignalsFor(markers, input);

    const failures: TestingPolicyFailure[] = [];
    if (!markers.practiceOnly && report) {
      report.failures.forEach((failure, index) => {
        const haystack = `${failure.file ?? ''} ${failure.suite ?? ''}`.trim();
        if (haystack && fileEvidencesPolicy(haystack, markers)) {
          attributed.add(index);
          if (failures.length < 12) {
            failures.push({
              name: failure.name,
              ...(failure.suite ? { suite: failure.suite } : {}),
              ...(failure.file ? { file: failure.file } : {}),
              kind: failure.status === 'error' ? 'error' : 'failure',
            });
          }
        }
      });
    }

    // A policy whose artifact is its configuration (see `configIsEvidence`) is
    // covered by that configuration alone — but only by the config file, never
    // by a script name that merely matched.
    const configEvidence = !markers.practiceOnly && markers.configIsEvidence === true
      ? configSignalsFor(markers, input)
      : [];

    const status: TestingPolicyStatus = markers.practiceOnly
      ? 'not-file-evident'
      : matchingFiles.length > 0 || configEvidence.length > 0
        ? 'covered'
        : toolingSignals.length > 0
          ? 'tooling-only'
          : 'missing';

    const detail = buildDetail({ status, label, matchingFileCount: matchingFiles.length, caseCount, skippedCount, toolingSignals, configEvidence, failureCount: failures.length });

    return {
      id,
      label,
      category,
      status,
      statusLabel: STATUS_LABEL[status],
      fileCount: matchingFiles.length,
      caseCount,
      skippedCount,
      failedCount: failures.length,
      toolingSignals,
      detail,
      ...(matchingFiles[0] ? { exampleFile: matchingFiles[0].relativePath } : {}),
      actionPrompt: buildActionPrompt(id, label, status, failures),
      failures,
    };
  });

  const unattributedFailures: TestingPolicyFailure[] = [];
  if (report) {
    report.failures.forEach((failure, index) => {
      if (!attributed.has(index) && unattributedFailures.length < 20) {
        unattributedFailures.push({
          name: failure.name,
          ...(failure.suite ? { suite: failure.suite } : {}),
          ...(failure.file ? { file: failure.file } : {}),
          kind: failure.status === 'error' ? 'error' : 'failure',
        });
      }
    });
  }

  const coveredCount = rows.filter(row => row.status === 'covered').length;
  const toolingOnlyCount = rows.filter(row => row.status === 'tooling-only').length;
  const missingCount = rows.filter(row => row.status === 'missing').length;
  const practiceCount = rows.filter(row => row.status === 'not-file-evident').length;
  const totalSkipped = input.testFiles.reduce((sum, file) => sum + Math.max(0, file.skipped), 0);

  let reportInfo: TestingPolicyReportInfo | undefined;
  if (report) {
    const stale = typeof report.generatedAtMs === 'number'
      && typeof input.newestTestFileMs === 'number'
      && input.newestTestFileMs > report.generatedAtMs;
    reportInfo = {
      relativePath: report.relativePath,
      suites: report.suites,
      tests: report.tests,
      failed: report.failed,
      skipped: report.skipped,
      stale,
      ...(stale ? { staleDetail: 'A test file changed after this report was written, so its verdict may be out of date.' } : {}),
    };
  }

  return {
    rows,
    activeCount: rows.length,
    coveredCount,
    toolingOnlyCount,
    missingCount,
    practiceCount,
    totalFailed: report?.failed ?? 0,
    totalSkipped,
    unattributedFailures,
    ...(reportInfo ? { report: reportInfo } : {}),
    reportHint: reportCommandHint(input.frameworkLabel),
    summary: buildSummary({ activeCount: rows.length, coveredCount, toolingOnlyCount, missingCount, practiceCount, report: reportInfo, totalSkipped }),
  };
}

function buildDetail(input: {
  status: TestingPolicyStatus;
  label: string;
  matchingFileCount: number;
  caseCount: number;
  skippedCount: number;
  toolingSignals: string[];
  configEvidence: string[];
  failureCount: number;
}): string {
  if (input.status === 'not-file-evident') {
    return 'A way of working rather than a file — AtlasMind cannot confirm it from the repository, so it is not counted as a gap.';
  }
  if (input.status === 'missing') {
    return 'Enabled, but no matching test file and no tooling for it was found. Scaffold a starting point or turn the policy off.';
  }
  if (input.status === 'tooling-only') {
    return `Tooling is present (${input.toolingSignals.slice(0, 3).join(', ')}) but nothing in the tree tests with it yet.`;
  }
  // Covered by configuration rather than by test files: say which file, because
  // "3 files · 0 cases" would be a nonsense reading of a pipeline definition.
  if (input.matchingFileCount === 0 && input.configEvidence.length > 0) {
    return `Evidenced by ${input.configEvidence.slice(0, 3).join(', ')} — the pipeline is the artifact for this policy.`;
  }
  const parts = [`${input.matchingFileCount} file${input.matchingFileCount === 1 ? '' : 's'}`, `${input.caseCount} case${input.caseCount === 1 ? '' : 's'}`];
  if (input.skippedCount > 0) {
    parts.push(`${input.skippedCount} skipped`);
  }
  if (input.failureCount > 0) {
    parts.push(`${input.failureCount} failing`);
  }
  return `${parts.join(' · ')}.`;
}

function buildActionPrompt(id: TestingMethodologyId, label: string, status: TestingPolicyStatus, failures: TestingPolicyFailure[]): string {
  if (failures.length > 0) {
    const names = failures.slice(0, 5).map(failure => `"${failure.name}"${failure.file ? ` (${failure.file})` : ''}`).join(', ');
    return `These ${label} tests are failing: ${names}. Read each one, work out why it fails, and fix the cause rather than the assertion. Report what was actually wrong.`;
  }
  if (status === 'missing' || status === 'tooling-only') {
    return `The ${label} testing policy (${id}) is enabled for this project but has no tests. Propose the smallest useful set of ${label} tests for this codebase, say which files they should cover and why, and write the first one.`;
  }
  return `Review the ${label} tests in this project: what behaviour do they actually verify, what is left uncovered, and are the assertions strong enough?`;
}

function buildSummary(input: {
  activeCount: number;
  coveredCount: number;
  toolingOnlyCount: number;
  missingCount: number;
  practiceCount: number;
  report?: TestingPolicyReportInfo;
  totalSkipped: number;
}): string {
  if (input.activeCount === 0) {
    return 'No testing policies are enabled yet. Enable the ones this project actually follows to see what each has to show for itself.';
  }
  const parts = [`${input.coveredCount}/${input.activeCount} enabled polic${input.activeCount === 1 ? 'y has' : 'ies have'} tests`];
  const gaps = input.toolingOnlyCount + input.missingCount;
  if (gaps > 0) {
    parts.push(`${gaps} with none`);
  }
  if (input.practiceCount > 0) {
    parts.push(`${input.practiceCount} not detectable from files`);
  }
  if (input.report) {
    parts.push(input.report.failed > 0 ? `${input.report.failed} failing test${input.report.failed === 1 ? '' : 's'} in the last report` : 'last report was clean');
  } else {
    parts.push('no test report to read');
  }
  if (input.totalSkipped > 0) {
    parts.push(`${input.totalSkipped} skipped`);
  }
  return `${parts.join(' · ')}.`;
}
