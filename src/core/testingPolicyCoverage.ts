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
  /**
   * Every test file whose path evidences this policy.
   *
   * Exposed for subject-level coverage: deciding whether a *particular* endpoint
   * or migration is tested means reading the sources that claim to test this
   * policy, and recomputing the match outside would be a second copy of the
   * marker rules. Bounded, because the list is carried into a webview payload.
   */
  files: string[];
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

/**
 * Where a documentary compliance policy keeps its control-mapping evidence.
 *
 * Under `operations/` rather than a new top-level SSOT folder: `SSOT_FOLDERS`
 * is a declared set and a control mapping is an operational record, not a new
 * kind of memory. The scaffolder writes here and this module reads here, so the
 * two cannot drift about where the evidence lives.
 */
export const COMPLIANCE_EVIDENCE_DIR = 'project_memory/operations/compliance';

/** The one file that evidences a documentary compliance policy. */
function COMPLIANCE_DOC(id: string): RegExp {
  return new RegExp(`^${COMPLIANCE_EVIDENCE_DIR}/${id}\\.md$`, 'i');
}
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

  // ── Structural drift and integrity ──────────────────────────────
  'dead-field': {
    dependencies: ['knip', 'ts-prune', 'ts-unused-exports', 'unimported', 'vulture', 'depcheck'],
    scriptPatterns: [/knip/i, /ts-prune/i, /unused/i, /deadcode/i],
    configPatterns: [/^knip\.(json|jsonc|ts|js)$/i, /^\.knip\./i, /^\.unimportedrc/i],
  },
  'type-drift': {
    filePatterns: [/(^|[./_-])(schema|schemas)([./_-]|$)/i, /(^|\/)schemas?\//i],
    dependencies: ['zod', 'valibot', 'io-ts', 'arktype', 'typia', 'runtypes', 'superstruct', 'pydantic', 'cattrs'],
    scriptPatterns: [/type-?drift/i, /validate:schema/i],
  },
  'dependency-graph': {
    dependencies: ['dependency-cruiser', 'madge', 'eslint-plugin-boundaries', 'import-linter', 'archunit', 'go-arch-lint'],
    scriptPatterns: [/depcruise/i, /dependency-cruiser/i, /madge/i, /boundaries/i, /arch(itecture)?:?(test|lint)/i],
    configPatterns: [/^\.dependency-cruiser\./i, /^\.importlinter$/i, /^\.madgerc$/i],
  },

  // ── Behavioral parity and consistency ───────────────────────────
  // These leave ordinary test files behind, distinguished only by naming. The
  // patterns are deliberately narrow: a bare /parity/ would match far too much.
  'cross-surface-parity': {
    filePatterns: [/(^|[./_-])(cross-?surface|surface-?parity|parity)([./_-]|$)/i],
    scriptPatterns: [/parity/i],
  },
  'cross-representation': {
    filePatterns: [/(^|[./_-])(round-?trip|roundtrip|cross-?representation)([./_-]|$)/i],
    scriptPatterns: [/round-?trip/i],
  },
  'cross-version-parity': {
    filePatterns: [/(^|\/)(__approvals__|approvals|golden|baselines?)\//i, /\.(approved|golden)\.[a-z0-9]+$/i],
    dependencies: ['approvals', 'jest-image-snapshot', 'oasdiff', 'openapi-diff', '@microsoft/api-extractor', 'buf'],
    scriptPatterns: [/api-?extractor/i, /oasdiff/i, /openapi-?diff/i, /version-?parity/i],
    configPatterns: [/^api-extractor\.json$/i],
  },
  'semantic-constraint': {
    filePatterns: [/(^|[./_-])(invariants?|constraints?)([./_-]|$)/i],
    dependencies: ['class-validator', 'ajv-formats', 'pgtap'],
    scriptPatterns: [/invariant/i, /constraint/i],
  },
  'anti-uniformity': {
    filePatterns: [/(^|[./_-])(anti-?uniformity|diversity|distribution)([./_-]|$)/i],
    scriptPatterns: [/anti-?uniformity/i],
  },
  'output-schema-drift': {
    filePatterns: [/(^|[./_-])(schema-?drift|output-?schema)([./_-]|$)/i],
    dependencies: ['ajv', 'oasdiff', 'openapi-diff', 'buf', '@apidevtools/swagger-parser', 'jsonschema'],
    scriptPatterns: [/schema-?drift/i, /validate:output/i, /buf breaking/i],
  },
  'hallucination-detection': {
    filePatterns: [/(^|[./_-])(groundedness|faithfulness|hallucination)([./_-]|$)/i],
    dependencies: ['ragas', 'deepeval', 'trulens', 'trulens-eval', 'promptfoo', 'autoevals'],
    scriptPatterns: [/groundedness/i, /faithfulness/i, /hallucination/i],
  },

  // ── Non-functional ──────────────────────────────────────────────
  chaos: {
    filePatterns: [/(^|\/)chaos\//i, /(^|[./_-])chaos([./_-]|$)/i],
    dependencies: ['chaos-toolkit', 'chaostoolkit', 'toxiproxy-node-client', 'toxiproxy', 'litmus', 'gremlin'],
    scriptPatterns: [/chaos/i, /resilience/i, /fault-?injection/i],
  },
  accessibility: {
    filePatterns: [/(^|[./_-])(a11y|accessibility|axe)([./_-]|$)/i],
    dependencies: ['axe-core', '@axe-core/playwright', '@axe-core/react', 'jest-axe', 'pa11y', 'lighthouse', 'eslint-plugin-jsx-a11y', 'cypress-axe', 'axe-playwright'],
    scriptPatterns: [/a11y/i, /accessibility/i, /pa11y/i, /lighthouse/i],
    configPatterns: [/^\.pa11yci/i, /^pa11y\.json$/i, /^lighthouserc\./i],
  },
  observability: {
    filePatterns: [/(^|[./_-])(telemetry|observability|tracing|instrumentation)([./_-]|$)/i],
    dependencies: ['@opentelemetry/sdk-node', '@opentelemetry/api', 'opentelemetry', 'prom-client', 'prometheus-client', 'promtool'],
    scriptPatterns: [/telemetry/i, /observability/i, /promtool/i, /alert.*test/i],
  },

  // ── Data & schema ───────────────────────────────────────────────
  'data-quality': {
    filePatterns: [/(^|\/)(great_expectations|expectations)\//i, /(^|[./_-])data-?quality([./_-]|$)/i, /(^|\/)models\/.*\.yml$/i],
    dependencies: ['great-expectations', 'great_expectations', 'soda-core', 'pandera', 'dbt-core', 'pydeequ'],
    scriptPatterns: [/dbt test/i, /data-?quality/i, /soda/i, /expectations/i],
    configPatterns: [/^great_expectations\.yml$/i, /^dbt_project\.yml$/i, /^soda\./i],
  },
  'schema-migration': {
    filePatterns: [/(^|\/)migrations?\//i, /(^|[./_-])migration([./_-]|$)/i],
    dependencies: ['prisma', 'knex', 'typeorm', 'sequelize', 'alembic', 'flyway', 'liquibase', 'testcontainers', 'db-migrate', 'atlas-provider'],
    scriptPatterns: [/migrat/i],
    configPatterns: [/^alembic\.ini$/i, /^flyway\.conf$/i, /^liquibase\.properties$/i, /^atlas\.hcl$/i],
  },
  compatibility: {
    filePatterns: [/(^|[./_-])(compat|compatibility|backward|forward)([./_-]|$)/i],
    dependencies: ['buf', '@confluentinc/schemaregistry', 'avro-js', 'avsc', 'protobufjs'],
    scriptPatterns: [/compat/i, /breaking/i],
    configPatterns: [/^buf\.ya?ml$/i, /^buf\.gen\.ya?ml$/i],
  },
  'state-drift': {
    filePatterns: [/(^|[./_-])(state-?drift|schema-?version|persisted)([./_-]|$)/i, /(^|\/)fixtures?\/(legacy|historical|versions?)\//i],
    scriptPatterns: [/state-?drift/i],
  },

  // ── AI-specific ─────────────────────────────────────────────────
  'prompt-regression': {
    filePatterns: [/(^|\/)(evals?|prompts?)\//i, /(^|[./_-])(eval|prompt)([./_-]|$)/i],
    dependencies: ['promptfoo', 'braintrust', 'langsmith', 'deepeval', 'autoevals', 'evals'],
    scriptPatterns: [/promptfoo/i, /^eval(s)?$/i, /^eval:/i, /prompt-?regression/i],
    configPatterns: [/^promptfooconfig\.ya?ml$/i, /^\.promptfoo/i, /^braintrust\./i],
  },
  'model-routing': {
    filePatterns: [/(^|[./_-])(routing|router|failover|fallback)([./_-]|$)/i],
    scriptPatterns: [/routing/i],
  },
  guardrail: {
    filePatterns: [/(^|[./_-])(guardrail|red-?team|jailbreak|injection)([./_-]|$)/i],
    dependencies: ['nemoguardrails', 'garak', 'pyrit', 'rebuff', 'llm-guard', 'guardrails-ai'],
    scriptPatterns: [/guardrail/i, /red-?team/i],
  },
  'agent-collaboration': {
    filePatterns: [/(^|[./_-])(handoff|delegation|multi-?agent|collaboration)([./_-]|$)/i],
    scriptPatterns: [/handoff/i, /multi-?agent/i],
  },
  'determinism-boundary': {
    filePatterns: [/(^|[./_-])(determinism|deterministic|reproducib)([./_-]|$)/i, /(^|\/)(cassettes|__cassettes__|fixtures\/recorded)\//i],
    dependencies: ['nock', 'msw', 'polly', '@pollyjs/core', 'vcrpy', 'betamax'],
    scriptPatterns: [/determinism/i, /flake/i],
  },

  // ── Compliance ──────────────────────────────────────────────────
  //
  // Two shapes here, and the difference is deliberate. A control that a machine
  // can check leaves a test file behind and is scored like any other policy. A
  // control that only a person can attest to leaves a *control-mapping
  // document* behind, and for those the document genuinely is the artifact —
  // so they carry `configIsEvidence`, the same reading `continuous` needed for
  // its pipeline definition. Without it a documentary policy would cap at "No
  // tests yet" forever and read as a gap that can never close, which is exactly
  // the outcome the archetype packs' `discouraged` list exists to prevent.
  'iso-27001': {
    configPatterns: [COMPLIANCE_DOC('iso-27001'), /^SECURITY\.md$/i],
    dependencies: ['vanta', 'drata'],
    configIsEvidence: true,
  },
  soc2: {
    configPatterns: [COMPLIANCE_DOC('soc2')],
    dependencies: ['vanta', 'drata', 'secureframe'],
    configIsEvidence: true,
  },
  gdpr: {
    filePatterns: [/(^|[./_-])(gdpr|privacy|erasure|dsar|retention|consent)([./_-]|$)/i],
    configPatterns: [COMPLIANCE_DOC('gdpr'), /^PRIVACY\.md$/i],
    scriptPatterns: [/gdpr/i, /privacy/i],
  },
  hipaa: {
    filePatterns: [/(^|[./_-])(hipaa|phi|safeguard)([./_-]|$)/i],
    configPatterns: [COMPLIANCE_DOC('hipaa')],
    scriptPatterns: [/hipaa/i],
  },
  'pci-dss': {
    filePatterns: [/(^|[./_-])(pci|cardholder|pan-?leak|tokeni[sz]ation)([./_-]|$)/i],
    configPatterns: [COMPLIANCE_DOC('pci-dss')],
    dependencies: ['gitleaks', 'trufflehog', 'detect-secrets'],
    scriptPatterns: [/pci/i],
  },
  'nist-800-53': {
    configPatterns: [COMPLIANCE_DOC('nist-800-53'), /(^|\/)oscal\//i],
    dependencies: ['inspec', 'oscal', 'compliance-trestle'],
    configIsEvidence: true,
  },

  'change-management': {
    filePatterns: [/(^|[./_-])(change-?management|branch-?protection|codeowners)([./_-]|$)/i],
    configPatterns: [COMPLIANCE_DOC('change-management'), /^\.github\/CODEOWNERS$/i, /^CODEOWNERS$/i],
    scriptPatterns: [/change-?management/i],
  },
  'audit-trail': {
    filePatterns: [/(^|[./_-])(audit-?trail|audit-?log|auditlog)([./_-]|$)/i],
    scriptPatterns: [/audit-?trail/i, /audit-?log/i],
  },
  'rbac-compliance': {
    filePatterns: [/(^|[./_-])(rbac|abac|authori[sz]ation|permissions?|roles?)([./_-]|$)/i],
    dependencies: ['casbin', '@openfga/sdk', 'oso', 'cerbos', 'opa', '@cerbos/http'],
    scriptPatterns: [/rbac/i, /authz/i, /permissions?/i],
  },
  'data-retention': {
    filePatterns: [/(^|[./_-])(retention|purge|ttl|legal-?hold)([./_-]|$)/i],
    configPatterns: [COMPLIANCE_DOC('data-retention')],
    scriptPatterns: [/retention/i, /purge/i],
  },

  sbom: {
    configPatterns: [/^(sbom|bom)[^/]*\.(json|xml|spdx)$/i, /\.(cdx|spdx)\.json$/i, /(^|\/)sbom\//i],
    dependencies: ['@cyclonedx/cyclonedx-npm', 'cyclonedx-bom', 'syft', 'cdxgen', 'spdx-tools'],
    scriptPatterns: [/sbom/i, /cyclonedx/i, /syft/i],
    configIsEvidence: true,
  },
  'dependency-licensing': {
    configPatterns: [/^\.?licen[cs]e-?(check|policy|allowlist)\./i, /^deny\.toml$/i, /^\.fossa\.ya?ml$/i],
    dependencies: ['license-checker', 'license-checker-rseidelsohn', 'licensee', 'pip-licenses', 'cargo-deny', 'go-licenses', 'fossa-cli'],
    scriptPatterns: [/licen[cs]e/i],
    configIsEvidence: true,
  },
  'license-compatibility': {
    configPatterns: [COMPLIANCE_DOC('license-compatibility'), /^\.ort\.ya?ml$/i, /(^|\/)ort\//i],
    dependencies: ['ort', 'scancode-toolkit', 'licensed'],
    scriptPatterns: [/licen[cs]e-?compat/i, /^ort$/i],
    configIsEvidence: true,
  },
  'secure-build-pipeline': {
    configPatterns: [/^\.github\/workflows\/.*(slsa|provenance|attest|sign).*\.ya?ml$/i, /^cosign\./i, /(^|\/)attestations?\//i, /^\.slsa/i],
    dependencies: ['sigstore', '@sigstore/sign', 'cosign', 'slsa-verifier', 'in-toto'],
    scriptPatterns: [/slsa/i, /cosign/i, /provenance/i, /attest/i],
    configIsEvidence: true,
  },

  'ai-safety-compliance': {
    configPatterns: [COMPLIANCE_DOC('ai-safety-compliance'), /^MODEL_CARD\.md$/i, /(^|\/)model-?cards?\//i],
    configIsEvidence: true,
  },
  'model-output-risk': {
    filePatterns: [/(^|[./_-])(risk-?classif|output-?risk|moderation)([./_-]|$)/i],
    configPatterns: [COMPLIANCE_DOC('model-output-risk')],
    scriptPatterns: [/risk-?classif/i, /moderation/i],
  },
  'bias-fairness': {
    filePatterns: [/(^|[./_-])(bias|fairness|disparate|demographic)([./_-]|$)/i],
    dependencies: ['fairlearn', 'aif360', 'aequitas', 'responsibleai'],
    scriptPatterns: [/bias/i, /fairness/i],
  },
  explainability: {
    filePatterns: [/(^|[./_-])(explainab|interpretab|shap|lime|reason-?code)([./_-]|$)/i],
    dependencies: ['shap', 'lime', 'captum', 'interpret', 'eli5', 'alibi'],
    scriptPatterns: [/explainab/i, /interpretab/i],
  },
  'ai-data-policy': {
    filePatterns: [/(^|[./_-])(redaction|tenant-?isolation|data-?policy|prompt-?payload)([./_-]|$)/i],
    configPatterns: [COMPLIANCE_DOC('ai-data-policy')],
    scriptPatterns: [/redaction/i, /data-?policy/i],
  },

  // Industry regimes. Documentary by nature — the executable parts of each are
  // already covered by the policies above (audit trail, RBAC, retention), and
  // duplicating them here would double-count the same evidence.
  'financial-compliance': { configPatterns: [COMPLIANCE_DOC('financial-compliance')], configIsEvidence: true },
  'medical-compliance': { configPatterns: [COMPLIANCE_DOC('medical-compliance')], configIsEvidence: true },
  'automotive-compliance': { configPatterns: [COMPLIANCE_DOC('automotive-compliance')], configIsEvidence: true },
  'aviation-compliance': { configPatterns: [COMPLIANCE_DOC('aviation-compliance')], configIsEvidence: true },
  'energy-compliance': { configPatterns: [COMPLIANCE_DOC('energy-compliance')], configIsEvidence: true },

  // Practices. Real, valuable, and invisible to a file scan — so never a "gap".
  'v-model': { practiceOnly: true },
  'white-box': { practiceOnly: true },
  'test-design': { practiceOnly: true },
  'black-box': { practiceOnly: true },
  'gray-box': { practiceOnly: true },
  exploratory: { practiceOnly: true },
  'agile-testing': { practiceOnly: true },
};

/**
 * Which of these test files evidence which policy.
 *
 * Exported so subject-level coverage can be computed without a second copy of
 * the marker rules — the Testing dashboard and the agent obligation prompt both
 * need this mapping, and two implementations would eventually disagree about
 * whether a given test counts, which is exactly the kind of drift that makes a
 * dashboard number untrustworthy.
 */
export function matchTestFilesToPolicies(
  enabled: readonly TestingMethodologyId[],
  testFilePaths: readonly string[],
): Map<TestingMethodologyId, string[]> {
  const matched = new Map<TestingMethodologyId, string[]>();
  for (const id of enabled) {
    const markers = POLICY_MARKERS[id];
    if (!markers || markers.practiceOnly) { continue; }
    matched.set(id, testFilePaths.filter(candidate => fileEvidencesPolicy(candidate, markers)));
  }
  return matched;
}

// ── Plain-language guidance ──────────────────────────────────────

/**
 * The novice-facing explanation behind every Policy Coverage "Ask Atlas"
 * action.
 *
 * These sentences are declared rather than model-generated because AtlasMind
 * already owns the meaning of its policy catalogue. Asking a general model to
 * rediscover that meaning is slower, costs capacity, and can turn an
 * explanation into a clarification loop. Keeping one row per methodology also
 * makes the promise total: a newly-added methodology cannot quietly fall back
 * to jargon without a type error and a failing completeness test.
 */
const POLICY_LAYMAN_COPY: Record<TestingMethodologyId, { whatItIs: string; expectedResult: string }> = {
  tdd: {
    whatItIs: 'Write a small test for the next behaviour before writing the behaviour itself. Watch the test fail, add only enough code to make it pass, then tidy the code without breaking the test.',
    expectedResult: 'Each change starts with a meaningful failing test and ends with that test, plus the existing suite, passing. The test remains as a guard against the same bug returning.',
  },
  bdd: {
    whatItIs: 'Describe behaviour as concrete examples that product, testing, and engineering people can all read — usually “Given this starting point, when this happens, then this result should follow.”',
    expectedResult: 'The agreed examples become repeatable scenarios. They pass when the product behaves as the examples promise and fail when a user-visible rule changes or breaks.',
  },
  atdd: {
    whatItIs: 'Agree the customer-facing acceptance checks before building the feature, then automate those checks where practical.',
    expectedResult: 'A feature is complete only when its agreed acceptance examples pass, giving the customer or product owner visible evidence that the requested outcome was delivered.',
  },
  sdd: {
    whatItIs: 'Write the interface specification first — for example an API schema — and use it as the shared agreement that implementation and consumers must follow.',
    expectedResult: 'The specification can be validated automatically, and implementations fail the check when they drift from the published requests, responses, fields, or rules.',
  },
  'v-model': {
    whatItIs: 'Pair every planning and design stage with a later check: requirements with acceptance tests, system design with system tests, and component design with component tests.',
    expectedResult: 'Every important requirement can be traced to a named check and a recorded result, so an unverified requirement is visible rather than assumed.',
  },
  unit: {
    whatItIs: 'Check one small piece of code — usually a function or class — on its own, without starting the whole application or relying on real external services.',
    expectedResult: 'Fast, focused tests pass for correct inputs and fail close to the faulty function when a small rule or calculation regresses.',
  },
  integration: {
    whatItIs: 'Check that two or more real parts of the system work together, such as application code with a database, queue, filesystem, or service adapter.',
    expectedResult: 'The test proves that the parts exchange the right data and handle real boundary behaviour; it fails when wiring, schemas, configuration, or assumptions no longer match.',
  },
  mutation: {
    whatItIs: 'Deliberately make many tiny faults in the code and check whether the existing tests notice. It measures the strength of the tests, not just how many lines they execute.',
    expectedResult: 'Good tests “kill” most artificial faults by failing. Surviving faults reveal assertions or cases that may be too weak.',
  },
  property: {
    whatItIs: 'Describe a rule that should always hold, then let a tool generate many different inputs — including awkward edge cases — to try to disprove it.',
    expectedResult: 'The property holds across the generated examples, or the tool returns a small reproducible counter-example that exposes a real edge case.',
  },
  continuous: {
    whatItIs: 'Run the project’s checks automatically and early — normally on every pull request or commit — instead of relying on somebody to remember before release.',
    expectedResult: 'The pipeline gives a repeatable pass/fail result for each change and blocks or clearly flags a change when the configured checks fail.',
  },
  'white-box': {
    whatItIs: 'Design tests with knowledge of the code inside, deliberately covering important branches, conditions, error paths, and data flows.',
    expectedResult: 'Important internal paths have named tests and coverage evidence; a missed branch or broken internal rule is visible instead of hidden behind a single happy-path check.',
  },
  e2e: {
    whatItIs: 'Exercise a complete user journey through the running product — for example signing in, changing a setting, or completing checkout — in the way a user would.',
    expectedResult: 'The critical journey completes from start to finish in a realistic environment and fails when any participating screen, service, or connection breaks the flow.',
  },
  snapshot: {
    whatItIs: 'Save a reviewed example of stable output, then compare future output with it so unexpected changes are shown as a diff.',
    expectedResult: 'Unchanged behaviour matches the approved snapshot; an intentional change produces a reviewable diff, and an accidental change fails the test.',
  },
  contract: {
    whatItIs: 'Check that two separately built components agree on exactly how they communicate. A consumer records the requests and responses it relies on, and the provider proves it still honours them.',
    expectedResult: 'Consumer and provider checks pass while both sides honour the agreement and fail before deployment when a request, response, field, status, or rule changes incompatibly.',
  },
  mbt: {
    whatItIs: 'Describe the system as states and allowed transitions, then generate tests that travel through that model instead of hand-writing every possible journey.',
    expectedResult: 'Generated paths cover the important states and transitions and expose an implementation that allows a forbidden move or mishandles a valid one.',
  },
  'test-design': {
    whatItIs: 'Choose test cases systematically — for example values just below, on, and above a boundary — so a small set represents the important input space.',
    expectedResult: 'Each input group, boundary, and important combination has a deliberate case, reducing blind spots without trying every possible value.',
  },
  'black-box': {
    whatItIs: 'Test only through the public behaviour or interface, without using knowledge of how the code is implemented inside.',
    expectedResult: 'Inputs produce the promised outputs and errors from a user or consumer perspective, regardless of the internal implementation.',
  },
  'gray-box': {
    whatItIs: 'Test through the public interface while using limited inside knowledge — such as a schema or state model — to choose stronger cases.',
    expectedResult: 'Public behaviour is verified with cases informed by known internal risks, while the test remains independent of most implementation details.',
  },
  performance: {
    whatItIs: 'Measure speed, throughput, and stability under a defined amount of realistic work rather than relying on how fast the product feels on one machine.',
    expectedResult: 'Results show whether agreed response-time and capacity targets are met, and identify the load at which the system slows down or fails.',
  },
  'security-testing': {
    whatItIs: 'Use repeatable checks to find vulnerable code, unsafe dependencies, leaked secrets, or weaknesses in a running application.',
    expectedResult: 'The chosen scans and attack-focused tests produce a reviewable finding list, fail on policy-breaking issues, and can be rerun to prove fixes remain effective.',
  },
  visual: {
    whatItIs: 'Capture approved screenshots of important screens or components and compare later renders to catch unintended visual changes.',
    expectedResult: 'Intended screens match their baselines; layout, colour, spacing, font, or rendering changes produce a reviewable image difference.',
  },
  exploratory: {
    whatItIs: 'A person investigates the product with a focused question or charter, follows what they learn, and records surprises that scripted tests did not anticipate.',
    expectedResult: 'The session records its scope, observations, risks, and follow-up work. It produces learning rather than a simple automated pass/fail result.',
  },
  'agile-testing': {
    whatItIs: 'Make quality a shared activity throughout each piece of work: clarify examples early, test while building, and include verification in the team’s definition of done.',
    expectedResult: 'Each work item carries agreed quality checks and evidence before it is called done, with gaps owned during the iteration rather than handed to a final testing phase.',
  },

  'dead-field': {
    whatItIs: 'Search the code for pieces that are declared but never actually used — a setting nothing reads, a field filled in and never looked at, a prop passed to nothing.',
    expectedResult: 'A list of unused declarations, each either removed or connected to the code that was meant to use it. A field written but never read usually means the part that should have consumed it was never finished.',
  },
  'type-drift': {
    whatItIs: 'Check that the descriptions your code carries about incoming data still match the data that really arrives — from an interface, a config file, or a stored record.',
    expectedResult: 'Data is checked as it enters the system rather than assumed. When an outside source changes a name or a shape, you get a clear error at the doorway instead of a confusing failure deep inside.',
  },
  'dependency-graph': {
    whatItIs: 'Check that the parts of the codebase only depend on each other in the directions the design allows, and that no circular dependencies have formed.',
    expectedResult: 'The intended structure is written down as a rule that runs automatically. Adding an import that crosses a boundary fails the check, instead of quietly making the code harder to change.',
  },

  'cross-surface-parity': {
    whatItIs: 'Where the same fact appears in more than one place — a command line and a screen, a summary and the detail page behind it — check that both places give the same answer.',
    expectedResult: 'One shared set of examples is run against every place that states the fact, so two screens can never disagree about the same number.',
  },
  'cross-representation': {
    whatItIs: 'Take a value, convert it to another form and back again, and check that nothing was lost or changed on the way.',
    expectedResult: 'Saving and reloading, or converting between formats, returns exactly what went in — including the awkward cases like empty text, accents and emoji, and the difference between "empty" and "not set".',
  },
  'cross-version-parity': {
    whatItIs: 'Record what the current version does with a set of real inputs, then check the next version still answers the same way.',
    expectedResult: 'Any change in behaviour is shown to you as a difference to approve or reject, so nothing changes for existing users without somebody deciding it should.',
  },
  'semantic-constraint': {
    whatItIs: 'Write down the rules your subject area requires but the code cannot express on its own — an end date after its start, a total matching its parts — and check them.',
    expectedResult: 'Impossible combinations are rejected where they are created rather than discovered later in a report, and the rules live next to the data they govern.',
  },
  'anti-uniformity': {
    whatItIs: 'Check that output which should vary actually varies. A process that returns the same answer for every input still looks fine to most checks.',
    expectedResult: 'A generator, recommendation, or batch process that quietly collapses to one repeated value fails, instead of passing because each individual value has the right shape.',
  },
  'output-schema-drift': {
    whatItIs: 'Check that what your system produces still matches the published description others rely on to read it.',
    expectedResult: 'A changed or removed field is caught before release, so the people consuming your output are not the ones who discover it.',
  },
  'hallucination-detection': {
    whatItIs: 'Check that facts stated by an AI feature are actually supported by the source material given to it, rather than invented.',
    expectedResult: 'Answers are scored for whether each claim traces back to a provided source. A confident, well-written, entirely made-up answer fails, where ordinary checks would pass it.',
  },

  chaos: {
    whatItIs: 'Deliberately break something — a slow network, an unavailable service, a restarted machine — and check that the system copes instead of collapsing.',
    expectedResult: 'Recovery behaviour that was written and never tried is actually exercised, with the system degrading in a controlled way rather than failing in an unplanned one.',
  },
  accessibility: {
    whatItIs: 'Check the interface can be used by people using a screen reader, a keyboard only, magnification, or with limited colour vision.',
    expectedResult: 'Automated checks catch missing labels, poor contrast and incorrect structure. A short keyboard and screen-reader pass covers what tools cannot see — roughly two thirds of real issues.',
  },
  observability: {
    whatItIs: 'Check that the system records enough about what it did — logs, measurements and traces — to explain itself when something goes wrong later.',
    expectedResult: 'Important actions are proven to emit records that can be linked together, so an investigation has the information it needs rather than discovering the gap during the incident.',
  },

  'data-quality': {
    whatItIs: 'Check the data itself, not just the code: required values present, no duplicates, numbers in sensible ranges, references pointing at things that exist.',
    expectedResult: 'Bad data is caught where it enters or is transformed, rather than surfacing as a wrong figure in a report that somebody has already acted on.',
  },
  'schema-migration': {
    whatItIs: 'Rehearse the changes that alter how stored information is structured: apply them, undo them, and check existing records survive intact.',
    expectedResult: 'Each change is proven to apply cleanly to realistic existing data and to be reversible, before it runs once against the real thing where mistakes are hard to undo.',
  },
  compatibility: {
    whatItIs: 'Check that older and newer versions can work with each other\'s data — both the new reading the old, and the old reading the new.',
    expectedResult: 'During an update, where both versions run at once, neither breaks on the other\'s data. Older clients that cannot be forced to update keep working.',
  },
  'state-drift': {
    whatItIs: 'Check that information saved earlier can still be read correctly by the current version, including records written months ago by a build that no longer exists.',
    expectedResult: 'Old saved data is recognised and upgraded rather than misread. Crucially, data written by a *newer* version is refused rather than overwritten, so an older build cannot destroy it.',
  },

  'prompt-regression': {
    whatItIs: 'Keep a set of example inputs with known-good answers, and re-run them whenever the instructions given to an AI model are edited.',
    expectedResult: 'Reworded instructions are measured against the whole example set, so a change that helps one case and harms nine is visible before release instead of after.',
  },
  'model-routing': {
    whatItIs: 'Check that the rules choosing which AI model handles a request actually pick the intended one, and switch correctly when one is unavailable.',
    expectedResult: 'The choice is proven against a table of expected outcomes. A rule quietly sending everything to the most expensive model fails here rather than appearing on an invoice weeks later.',
  },
  guardrail: {
    whatItIs: 'Try to make the system do the things its safety rules forbid, including through deliberately tricky input, and check it refuses.',
    expectedResult: 'Safety rules are demonstrated to hold under attack rather than assumed. Equally, the system is checked for refusing too much, which passes a safety test and fails the product.',
  },
  'agent-collaboration': {
    whatItIs: 'Where several AI agents hand work to one another, check that each stays within its own permissions and that the chain cannot loop or run away.',
    expectedResult: 'An agent asking another for help never gains an ability it was denied, hand-off depth is limited, and loops are refused — none of which is visible when each agent is tested alone.',
  },
  'determinism-boundary': {
    whatItIs: 'Decide and write down which parts of the system must give exactly the same answer every time, and which are allowed to vary.',
    expectedResult: 'The repeatable parts are checked exactly, and the variable parts are checked for qualities rather than exact wording. A flaky test becomes a real signal again instead of something to re-run until green.',
  },

  'iso-27001': {
    whatItIs: 'Keep a maintained map from each information-security control to the actual evidence in this project that satisfies it.',
    expectedResult: 'A reviewed document showing, control by control, what is in place, where the evidence lives, and what is still outstanding — ready for an audit rather than assembled during one.',
  },
  soc2: {
    whatItIs: 'Map the trust criteria your customers ask about to the controls you operate, and keep evidence that they ran continuously rather than once.',
    expectedResult: 'A control map plus an unbroken evidence record over the review period. Gaps in evidence are treated as findings in their own right, because for a Type II report they are.',
  },
  gdpr: {
    whatItIs: 'Check the promises made about personal data actually hold: only what is needed is collected, people can get a copy, and deletion really deletes.',
    expectedResult: 'A deletion request is proven to clear every place a copy is held — including caches, search indexes and analytics — not just the main database, which is the usual gap.',
  },
  hipaa: {
    whatItIs: 'Check the technical protections around health information: who can reach it, what is recorded when they do, and that it is encrypted in transit and at rest.',
    expectedResult: 'Access control, audit records, unique user identification and encryption are each demonstrated by a test or a documented decision, rather than assumed from the configuration.',
  },
  'pci-dss': {
    whatItIs: 'Check the handling of payment card data — most importantly that a card number never reaches a log, an error report, or an analytics event.',
    expectedResult: 'Card data is proven absent from everywhere it should not be, connections are properly encrypted, and the number of systems touching card data is as small as the design allows.',
  },
  'nist-800-53': {
    whatItIs: 'Map the government control catalogue, narrowed to the level that applies to you, onto how this system actually implements each one.',
    expectedResult: 'A tailored control map with implementation notes and a record of known gaps and their remediation plan — scoped to your baseline rather than the whole catalogue.',
  },

  'change-management': {
    whatItIs: 'Check that changes reaching production went through the process you told people (and auditors) they go through — review, approval, and a link to why.',
    expectedResult: 'Repository history proves every production change was reviewed and approved as required, with a documented emergency route for the cases that legitimately bypass it.',
  },
  'audit-trail': {
    whatItIs: 'Check that every significant action leaves a record of who did it, what they did and when — and that the record cannot be quietly altered.',
    expectedResult: 'Every privileged action is confirmed to write an attributable record. New action paths are caught when they miss the audit log, rather than during an investigation that needs it.',
  },
  'rbac-compliance': {
    whatItIs: 'Check each role can do what it should — and, more importantly, that it cannot do anything else by any route.',
    expectedResult: 'The "cannot" half is tested as thoroughly as the "can" half, because that is where privilege escalation lives. Separate customers\' or tenants\' data is proven not to reach each other.',
  },
  'data-retention': {
    whatItIs: 'Check information is removed when the retention schedule says it should be, and kept when a hold requires it.',
    expectedResult: 'Both failure directions are covered: nothing outlives its retention window, and nothing under legal hold is destroyed early. Backups are included, not just the live store.',
  },

  sbom: {
    whatItIs: 'Produce a machine-readable list of everything your software is built from, and check the list actually matches what shipped.',
    expectedResult: 'A current, valid inventory published with each release. The check that matters is accuracy — an out-of-date list is worse than none, because people trust it.',
  },
  'dependency-licensing': {
    whatItIs: 'Check the licence of every third-party component you depend on, including the ones pulled in indirectly.',
    expectedResult: 'The build fails when a component arrives with a licence your policy does not permit, or with none declared — catching it when it is added rather than at a customer review.',
  },
  'license-compatibility': {
    whatItIs: 'Check that the combination of licences works for the way you actually distribute your software — which can fail even when each licence individually is allowed.',
    expectedResult: 'Conflicting obligations are identified against your stated distribution model, with the reasoning recorded so the same question is not re-argued each release.',
  },
  'secure-build-pipeline': {
    whatItIs: 'Check that a released artifact can be proven to have come from your source, built by your pipeline, without tampering along the way.',
    expectedResult: 'Each release carries signed provenance that a consumer can verify. The verification step is exercised too — provenance nobody checks is paperwork, not protection.',
  },

  'ai-safety-compliance': {
    whatItIs: 'Check that the AI safety commitments stated publicly or to regulators match what the system actually implements and can evidence.',
    expectedResult: 'A maintained map from each stated commitment to its implementation and evidence, with a documented review cadence — since the rules in this area are still changing.',
  },
  'model-output-risk': {
    whatItIs: 'Check that AI output needing special handling is correctly identified as such, and that the identification actually triggers the handling.',
    expectedResult: 'Classification is measured against labelled examples, with particular attention to the rare risky cases — the ones a high overall accuracy score hides most effectively.',
  },
  'bias-fairness': {
    whatItIs: 'Compare outcomes across groups of people to find differences the system cannot justify.',
    expectedResult: 'Results are broken down by group rather than reported as one overall figure, with the chosen definition of fairness stated explicitly — since the available definitions genuinely conflict.',
  },
  explainability: {
    whatItIs: 'Check that an automated decision can be explained to the person it affects, in terms that reflect what actually drove it.',
    expectedResult: 'Explanations are tested for faithfulness, not just presence. A plausible explanation that does not match the real reasoning is worse than none, because it will be believed.',
  },
  'ai-data-policy': {
    whatItIs: 'Check what the AI features remember and send matches what was promised — no customer data used for training, no secrets or other customers\' data reaching a prompt.',
    expectedResult: 'Every path that reaches a model is proven to apply the redaction and separation rules, since a single missed path defeats the policy everywhere else it is applied.',
  },

  'financial-compliance': {
    whatItIs: 'Map the financial-sector obligations that apply to your licence and jurisdiction onto the controls and records this system keeps.',
    expectedResult: 'A control map covering record completeness, reporting accuracy, timekeeping precision and operational resilience — scoped to the obligations that genuinely apply.',
  },
  'medical-compliance': {
    whatItIs: 'Map the electronic-records requirements for regulated medical software onto documented validation evidence.',
    expectedResult: 'Validation records showing audit trails, record integrity, and signatures bound to their records — evidence of a controlled process, which is regulated as strictly as the function itself.',
  },
  'automotive-compliance': {
    whatItIs: 'Map road-vehicle functional-safety requirements onto the verification evidence each safety level demands.',
    expectedResult: 'A safety case with requirements traced to tests, and structural coverage evidence at the depth the assigned safety level requires — determined by hazard analysis, not by preference.',
  },
  'aviation-compliance': {
    whatItIs: 'Map airborne-software certification objectives onto the verification evidence required at your assurance level.',
    expectedResult: 'Requirements-based tests traced in both directions, with structural coverage evidence at the required depth and the independence between development and verification the level demands.',
  },
  'energy-compliance': {
    whatItIs: 'Map critical-infrastructure protection requirements onto asset inventories, boundary controls and access records.',
    expectedResult: 'Evidence that the asset inventory is accurate, the security boundary is enforced, access is revoked within the required window, and patches are assessed on the prescribed cycle.',
  },
};

export interface TestingPolicyLaymanGuide {
  whatItIs: string;
  whatYouNeed: string;
  expectedResult: string;
  whyUseIt: string;
  tradeoff: string;
}

/**
 * Return the complete, model-free novice guide for one methodology.
 */
export function buildTestingPolicyLaymanGuide(id: TestingMethodologyId): TestingPolicyLaymanGuide {
  // The registry and copy table are both total over TestingMethodologyId; the
  // completeness test additionally walks the runtime array so a drift cannot
  // survive CI. TypeScript cannot infer that relationship through Array.find.
  const definition = TESTING_METHODOLOGY_DEFINITIONS.find(entry => entry.id === id)!;
  const copy = POLICY_LAYMAN_COPY[id];
  const markers = POLICY_MARKERS[id];

  const whatYouNeed = markers.practiceOnly
    ? 'A named owner, an agreed way of working, and a small durable record such as a checklist, charter, traceability table, or Definition of Done. This is a team practice, so installing a test package alone cannot establish it.'
    : markers.configIsEvidence
      ? `A working CI pipeline file, existing test or verification commands for it to call, and an agreed rule for when a failed check stops delivery. Common platforms include: ${definition.keyTools}.`
      : id === 'tdd'
        ? `A fast test runner, one clearly stated behaviour at a time, and the discipline to see the new test fail before implementation begins. Common tools include: ${definition.keyTools}.`
        : `A real behaviour or boundary worth protecting, a clear example of the correct result, one or more matching test files, and a repeatable command that runs them. Common tools include: ${definition.keyTools}.`;

  return {
    whatItIs: copy.whatItIs,
    whatYouNeed,
    expectedResult: copy.expectedResult,
    whyUseIt: definition.whenToUse,
    tradeoff: definition.tradeoffs,
  };
}

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
      files: matchingFiles.slice(0, 200).map(file => file.relativePath),
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
