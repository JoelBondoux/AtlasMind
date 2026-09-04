import { describe, expect, it } from 'vitest';
import {
  buildTestingPolicyLaymanGuide,
  deriveTestingPolicyCoverage,
  parseJUnitReport,
  POLICY_MARKERS,
  COMPLIANCE_EVIDENCE_DIR,
  type TestingPolicyEvidenceInput,
} from '../../src/core/testingPolicyCoverage.ts';
import { TESTING_METHODOLOGY_DEFINITIONS } from '../../src/types.ts';
import { complianceCatalogFor } from '../../src/core/complianceControlCatalog.ts';

const baseInput = (over: Partial<TestingPolicyEvidenceInput> = {}): TestingPolicyEvidenceInput => ({
  enabledMethodologies: [],
  testFiles: [],
  dependencies: [],
  scripts: [],
  configFiles: [],
  ...over,
});

describe('parseJUnitReport — untrusted report boundary', () => {
  it('returns undefined for input that is not a report', () => {
    expect(parseJUnitReport('')).toBeUndefined();
    expect(parseJUnitReport('not xml at all')).toBeUndefined();
    expect(parseJUnitReport('<html><body>nope</body></html>')).toBeUndefined();
    expect(parseJUnitReport(undefined as unknown as string)).toBeUndefined();
  });

  it('reads suite totals and failing case detail', () => {
    const xml = `<?xml version="1.0"?>
      <testsuites>
        <testsuite name="unit" tests="3" failures="1" errors="0" skipped="1">
          <testcase name="adds numbers" classname="tests/math.test.ts" file="tests/math.test.ts"/>
          <testcase name="subtracts numbers" classname="tests/math.test.ts" file="tests/math.test.ts">
            <failure message="expected 1 to be 2">stack…</failure>
          </testcase>
          <testcase name="divides numbers" classname="tests/math.test.ts"><skipped/></testcase>
        </testsuite>
      </testsuites>`;
    const report = parseJUnitReport(xml);
    expect(report).toBeDefined();
    expect(report!.tests).toBe(3);
    expect(report!.failed).toBe(1);
    expect(report!.skipped).toBe(1);
    expect(report!.failures).toHaveLength(1);
    expect(report!.failures[0]).toMatchObject({
      name: 'subtracts numbers',
      file: 'tests/math.test.ts',
      status: 'failed',
    });
  });

  it('never keeps the failure message — only enough to open the test', () => {
    const xml = `<testsuite tests="1" failures="1">
      <testcase name="leaks" classname="a"><failure message="API_KEY=sk-live-should-not-surface">secret in stack</failure></testcase>
    </testsuite>`;
    const report = parseJUnitReport(xml);
    expect(JSON.stringify(report)).not.toContain('sk-live-should-not-surface');
    expect(JSON.stringify(report)).not.toContain('secret in stack');
  });

  it('distinguishes an error from a failure', () => {
    const xml = `<testsuite tests="1" errors="1">
      <testcase name="explodes" classname="a"><error message="boom"/></testcase>
    </testsuite>`;
    expect(parseJUnitReport(xml)!.failures[0]!.status).toBe('error');
  });

  it('trusts what it can count over what the report asserts', () => {
    // A report claiming zero failures while carrying two failing cases must not
    // be able to present itself as a clean run.
    const xml = `<testsuite tests="2" failures="0">
      <testcase name="a" classname="x"><failure/></testcase>
      <testcase name="b" classname="x"><failure/></testcase>
    </testsuite>`;
    expect(parseJUnitReport(xml)!.failed).toBe(2);
  });

  it('decodes only the predefined entities and strips control characters', () => {
    const xml = `<testsuite tests="1" failures="1">
      <testcase name="a &amp; b &lt;c&gt;" classname="x"><failure/></testcase>
    </testsuite>`;
    expect(parseJUnitReport(xml)!.failures[0]!.name).toBe('a & b <c>');
  });

  it('caps the number of failing cases it keeps', () => {
    const cases = Array.from({ length: 200 }, (_, i) => `<testcase name="t${i}" classname="x"><failure/></testcase>`).join('');
    const report = parseJUnitReport(`<testsuite tests="200" failures="200">${cases}</testsuite>`);
    expect(report!.failed).toBe(200);
    expect(report!.failures.length).toBeLessThanOrEqual(60);
  });

  it('does not count a self-closing case as failing', () => {
    const xml = '<testsuite tests="1" failures="0"><testcase name="ok" classname="x"/></testsuite>';
    const report = parseJUnitReport(xml);
    expect(report!.failed).toBe(0);
    expect(report!.failures).toEqual([]);
  });
});

describe('deriveTestingPolicyCoverage — status per enabled policy', () => {
  it('reports a policy with matching test files as covered', () => {
    const coverage = deriveTestingPolicyCoverage(baseInput({
      enabledMethodologies: ['unit'],
      testFiles: [{ relativePath: 'tests/math.test.ts', cases: 4, skipped: 1 }],
    }));
    const unit = coverage.rows.find(row => row.id === 'unit')!;
    expect(unit.status).toBe('covered');
    expect(unit.caseCount).toBe(4);
    expect(unit.skippedCount).toBe(1);
    expect(unit.exampleFile).toBe('tests/math.test.ts');
    expect(coverage.coveredCount).toBe(1);
  });

  it('separates "tooling installed but nothing written" from "nothing at all"', () => {
    const coverage = deriveTestingPolicyCoverage(baseInput({
      enabledMethodologies: ['e2e', 'mutation'],
      dependencies: ['@playwright/test'],
    }));
    expect(coverage.rows.find(row => row.id === 'e2e')!.status).toBe('tooling-only');
    expect(coverage.rows.find(row => row.id === 'mutation')!.status).toBe('missing');
    expect(coverage.toolingOnlyCount).toBe(1);
    expect(coverage.missingCount).toBe(1);
  });

  it('never reports a practice-only policy as a gap', () => {
    const coverage = deriveTestingPolicyCoverage(baseInput({
      enabledMethodologies: ['exploratory', 'black-box', 'v-model', 'agile-testing'],
    }));
    expect(coverage.missingCount).toBe(0);
    expect(coverage.toolingOnlyCount).toBe(0);
    expect(coverage.practiceCount).toBe(4);
    for (const row of coverage.rows) {
      expect(row.status).toBe('not-file-evident');
      expect(row.detail).toMatch(/cannot confirm it from the repository/);
    }
  });

  it('does not credit a unit-test file to end-to-end or integration', () => {
    const coverage = deriveTestingPolicyCoverage(baseInput({
      enabledMethodologies: ['unit', 'integration', 'e2e'],
      testFiles: [{ relativePath: 'tests/math.test.ts', cases: 2, skipped: 0 }],
    }));
    expect(coverage.rows.find(row => row.id === 'unit')!.status).toBe('covered');
    expect(coverage.rows.find(row => row.id === 'integration')!.status).toBe('missing');
    expect(coverage.rows.find(row => row.id === 'e2e')!.status).toBe('missing');
  });

  it('credits an e2e file to e2e and keeps it out of unit', () => {
    const coverage = deriveTestingPolicyCoverage(baseInput({
      enabledMethodologies: ['unit', 'e2e'],
      testFiles: [{ relativePath: 'e2e/checkout.spec.ts', cases: 3, skipped: 0 }],
    }));
    expect(coverage.rows.find(row => row.id === 'e2e')!.status).toBe('covered');
    expect(coverage.rows.find(row => row.id === 'unit')!.fileCount).toBe(0);
  });

  it('attributes report failures to the policy that owns the file', () => {
    const report = parseJUnitReport(`<testsuite tests="2" failures="2">
      <testcase name="checkout fails" classname="e2e/checkout.spec.ts" file="e2e/checkout.spec.ts"><failure/></testcase>
      <testcase name="math fails" classname="tests/math.test.ts" file="tests/math.test.ts"><failure/></testcase>
    </testsuite>`)!;
    const coverage = deriveTestingPolicyCoverage(baseInput({
      enabledMethodologies: ['unit', 'e2e'],
      testFiles: [
        { relativePath: 'tests/math.test.ts', cases: 2, skipped: 0 },
        { relativePath: 'e2e/checkout.spec.ts', cases: 1, skipped: 0 },
      ],
      report: { ...report, relativePath: 'test-results/junit.xml' },
    }));
    expect(coverage.rows.find(row => row.id === 'e2e')!.failedCount).toBe(1);
    expect(coverage.rows.find(row => row.id === 'unit')!.failedCount).toBe(1);
    expect(coverage.totalFailed).toBe(2);
    expect(coverage.unattributedFailures).toEqual([]);
  });

  it('keeps a failure that matches no enabled policy rather than dropping it', () => {
    const report = parseJUnitReport(`<testsuite tests="1" failures="1">
      <testcase name="orphan" classname="somewhere/else.txt" file="somewhere/else.txt"><failure/></testcase>
    </testsuite>`)!;
    const coverage = deriveTestingPolicyCoverage(baseInput({
      enabledMethodologies: ['e2e'],
      report: { ...report, relativePath: 'junit.xml' },
    }));
    expect(coverage.unattributedFailures).toHaveLength(1);
    expect(coverage.unattributedFailures[0]!.name).toBe('orphan');
  });

  it('marks a report that predates the newest test file as stale', () => {
    const report = parseJUnitReport('<testsuite tests="1" failures="0"><testcase name="a" classname="x"/></testsuite>')!;
    const coverage = deriveTestingPolicyCoverage(baseInput({
      enabledMethodologies: ['unit'],
      report: { ...report, relativePath: 'junit.xml', generatedAtMs: 1_000 },
      newestTestFileMs: 2_000,
    }));
    expect(coverage.report!.stale).toBe(true);
    expect(coverage.report!.staleDetail).toBeTruthy();
  });

  it('says it has no verdict when no report exists, and how to get one', () => {
    const coverage = deriveTestingPolicyCoverage(baseInput({
      enabledMethodologies: ['unit'],
      frameworkLabel: 'Vitest',
    }));
    expect(coverage.report).toBeUndefined();
    expect(coverage.totalFailed).toBe(0);
    expect(coverage.summary).toContain('no test report to read');
    expect(coverage.reportHint).toContain('vitest');
  });

  it('tailors the report hint to the detected framework', () => {
    const forPytest = deriveTestingPolicyCoverage(baseInput({ frameworkLabel: 'pytest' }));
    expect(forPytest.reportHint).toContain('pytest --junitxml');
    const unknown = deriveTestingPolicyCoverage(baseInput({ frameworkLabel: 'Something else' }));
    expect(unknown.reportHint).toContain('JUnit reporter');
  });

  it('de-duplicates enabled ids and ignores unknown ones', () => {
    const coverage = deriveTestingPolicyCoverage(baseInput({
      enabledMethodologies: ['unit', 'unit', 'not-a-policy' as never],
    }));
    expect(coverage.rows).toHaveLength(1);
    expect(coverage.activeCount).toBe(1);
  });

  it('gives an empty-but-honest readout when nothing is enabled', () => {
    const coverage = deriveTestingPolicyCoverage(baseInput());
    expect(coverage.rows).toEqual([]);
    expect(coverage.summary).toContain('No testing policies are enabled');
  });

  it('offers a fix prompt naming the failing tests, and a scaffold prompt when there are none', () => {
    const report = parseJUnitReport(`<testsuite tests="1" failures="1">
      <testcase name="broken thing" classname="tests/a.test.ts" file="tests/a.test.ts"><failure/></testcase>
    </testsuite>`)!;
    const withFailures = deriveTestingPolicyCoverage(baseInput({
      enabledMethodologies: ['unit'],
      testFiles: [{ relativePath: 'tests/a.test.ts', cases: 1, skipped: 0 }],
      report: { ...report, relativePath: 'junit.xml' },
    }));
    expect(withFailures.rows[0]!.actionPrompt).toContain('broken thing');
    expect(withFailures.rows[0]!.actionPrompt).toContain('fix the cause rather than the assertion');

    const withGap = deriveTestingPolicyCoverage(baseInput({ enabledMethodologies: ['mutation'] }));
    expect(withGap.rows[0]!.actionPrompt).toContain('has no tests');
  });

  it('counts skipped tests across the tree even when no report exists', () => {
    const coverage = deriveTestingPolicyCoverage(baseInput({
      enabledMethodologies: ['unit'],
      testFiles: [
        { relativePath: 'tests/a.test.ts', cases: 3, skipped: 2 },
        { relativePath: 'tests/b.test.ts', cases: 1, skipped: 1 },
      ],
    }));
    expect(coverage.totalSkipped).toBe(3);
    expect(coverage.summary).toContain('3 skipped');
  });
});

describe('buildTestingPolicyLaymanGuide — informative before productive', () => {
  it('has complete novice-facing guidance for every declared methodology', () => {
    for (const definition of TESTING_METHODOLOGY_DEFINITIONS) {
      const guide = buildTestingPolicyLaymanGuide(definition.id);
      expect(guide.whatItIs.length, `${definition.id}: what it is`).toBeGreaterThan(40);
      expect(guide.whatYouNeed.length, `${definition.id}: what is needed`).toBeGreaterThan(40);
      expect(guide.expectedResult.length, `${definition.id}: expected result`).toBeGreaterThan(40);
      expect(guide.whyUseIt.length, `${definition.id}: why use it`).toBeGreaterThan(40);
      expect(guide.tradeoff.length, `${definition.id}: trade-off`).toBeGreaterThan(30);
    }
  });

  it('explains contract testing without assuming the reader knows Pact or consumer-driven testing', () => {
    const guide = buildTestingPolicyLaymanGuide('contract');
    expect(guide.whatItIs).toContain('two separately built components');
    expect(guide.whatItIs).toContain('requests and responses');
    expect(guide.expectedResult).toContain('before deployment');
  });
});

describe('continuous testing — configuration is the artifact', () => {
  it('reads a pipeline definition as covered, not as tooling waiting for tests', () => {
    const coverage = deriveTestingPolicyCoverage(baseInput({
      enabledMethodologies: ['continuous'],
      configFiles: ['.github/workflows/ci.yml'],
    }));

    // Before `configIsEvidence`, `continuous` had no `filePatterns` and so could
    // never reach `covered`: a project running its whole suite on every push was
    // reported as "No tests yet" permanently — a gap it had no way to close.
    expect(coverage.rows[0]!.status).toBe('covered');
    expect(coverage.rows[0]!.detail).toContain('.github/workflows/ci.yml');
    expect(coverage.missingCount).toBe(0);
    expect(coverage.toolingOnlyCount).toBe(0);
  });

  it('does not let a matching script name alone claim coverage', () => {
    // `continuous`'s script patterns include /watch/i, so a bundler's watch task
    // matches. Promoting on a script would report continuous testing for a
    // project that has no pipeline at all.
    const coverage = deriveTestingPolicyCoverage(baseInput({
      enabledMethodologies: ['continuous'],
      scripts: ['watch'],
    }));

    expect(coverage.rows[0]!.status).toBe('tooling-only');
  });

  it('reports nothing found when there is neither a pipeline nor a script', () => {
    const coverage = deriveTestingPolicyCoverage(baseInput({ enabledMethodologies: ['continuous'] }));
    expect(coverage.rows[0]!.status).toBe('missing');
  });

  it('does not promote any other policy on its config files', () => {
    // `configIsEvidence` is deliberately scoped to one policy. A `playwright.config.ts`
    // means the runner is installed, not that end-to-end tests exist.
    const coverage = deriveTestingPolicyCoverage(baseInput({
      enabledMethodologies: ['e2e'],
      configFiles: ['playwright.config.ts'],
    }));
    expect(coverage.rows[0]!.status).toBe('tooling-only');
  });
});


describe('no policy is a gap that can never close', () => {
  /**
   * Every policy must have *some* route to `covered`.
   *
   * `fileEvidencesPolicy` returns false when a policy declares no
   * `filePatterns`, so a policy with neither file patterns nor
   * `configIsEvidence` caps at `tooling-only` — which the summary counts as a
   * gap. The row then reads as a gap that can never close however much work
   * somebody does, which is exactly the dead end `configIsEvidence` was added
   * to fix for the documentary compliance policies, reappearing in the
   * structural ones. `dead-field` and `dependency-graph` both sat in it: a
   * project could adopt `knip`, wire it into CI, and still be told it had
   * nothing to show.
   *
   * Checked against the marker table rather than by feeding paths in, because
   * a probe has to guess each policy's filename convention and a wrong guess
   * reports a reachable policy as unreachable.
   *
   * A practice is exempt: `not-file-evident` is its own status and is
   * deliberately never counted as a gap.
   */
  it('gives every assessable policy either file patterns or config evidence', () => {
    // Governance regimes are exempt, and the exemption is the point rather
    // than a loophole: their route to good standing is the compliance
    // register, not the file tree. Requiring them to have one would be
    // requiring the false tick this change removed.
    const governance = new Set(TESTING_METHODOLOGY_DEFINITIONS
      .filter(definition => definition.category.startsWith('compliance-'))
      .map(definition => definition.id as string));

    const unreachable = Object.entries(POLICY_MARKERS)
      .filter(([id]) => !governance.has(id))
      .filter(([, markers]) => markers.practiceOnly !== true)
      .filter(([, markers]) => (markers.filePatterns ?? []).length === 0 && markers.configIsEvidence !== true)
      .map(([id]) => id);

    expect(unreachable, 'these policies can never read as covered').toEqual([]);
  });

  it('gives every governance regime a control catalog to be graded against', () => {
    // The replacement obligation. A regime with no catalog would be graded
    // against an empty control set, and "the weakest of zero controls" reads
    // fine — the same dead end in the opposite direction.
    const missing = TESTING_METHODOLOGY_DEFINITIONS
      .filter(definition => definition.category.startsWith('compliance-'))
      .filter(definition => complianceCatalogFor(definition.id) === undefined)
      .map(definition => definition.id);

    expect(missing, 'these regimes have nothing to be assessed against').toEqual([]);
  });

  it('declares markers for every methodology the matrix offers', () => {
    // A methodology a project can enable but the matcher has never heard of is
    // dropped from the board entirely by `deriveTestingPolicyCoverage`, so it
    // reads as "not enabled" rather than as "not assessed".
    const missing = TESTING_METHODOLOGY_DEFINITIONS
      .map(definition => definition.id)
      .filter(id => POLICY_MARKERS[id] === undefined);

    expect(missing, 'enabled-able methodologies with no markers').toEqual([]);
  });

  it('evidences the dead-field policy from a test rather than only from tooling', () => {
    // The concrete case behind the invariant above, and the one this project
    // relies on: its dead-field check is a test over its own manifest, not an
    // adopted scanner.
    const coverage = deriveTestingPolicyCoverage(baseInput({
      enabledMethodologies: ['dead-field'],
      testFiles: [{ relativePath: 'tests/dead-field/unreadDeclarations.test.ts', cases: 7, skipped: 0 }],
    }));

    expect(coverage.rows[0]!.status).toBe('covered');
  });
});

describe('a policy matches the filename somebody would actually use', () => {
  /**
   * A stem in `filePatterns` must not carry a whole-word trailing boundary.
   *
   * `explainability` shipped as `(explainab)([./_-]|$)`, which requires the
   * token to *end* at `explainab` — so `tests/explainability/…` never matched
   * and the policy read as a gap nothing could close. The bug is invisible in
   * review because the stem looks right; it only shows when a real filename is
   * fed through it.
   *
   * So: for each policy, the obvious directory and suffix names are checked
   * against its own markers. Policies whose artifact is a config file or a
   * specific tool output are exempt — `bdd` wants a `.feature`, `continuous`
   * wants a pipeline — and are listed rather than skipped silently.
   */
  const NAMED_BY_ARTIFACT_NOT_BY_POLICY = new Set([
    // Named after the artifact the tooling produces, not after the policy:
    // `bdd` wants a `.feature`, `mbt` a model file, `sbom` a CycloneDX
    // document, `continuous` a pipeline definition.
    'bdd', 'atdd', 'sdd', 'mbt', 'continuous', 'type-drift', 'cross-version-parity',
    'sbom', 'dependency-licensing', 'license-compatibility', 'secure-build-pipeline',
    // Documentary regimes: the control mapping is the artifact, and it is
    // deliberately the *only* thing that evidences them.
    'iso-27001', 'soc2', 'nist-800-53', 'ai-safety-compliance',
    'financial-compliance', 'medical-compliance', 'automotive-compliance',
    'aviation-compliance', 'energy-compliance',
  ]);

  it('matches a test named after the policy id', () => {
    const unmatched: string[] = [];

    for (const [id, markers] of Object.entries(POLICY_MARKERS)) {
      if (markers.practiceOnly === true || NAMED_BY_ARTIFACT_NOT_BY_POLICY.has(id)) {
        continue;
      }
      const candidates = [
        `tests/${id}/something.test.ts`,
        `tests/${id}.test.ts`,
      ];
      if (!candidates.some(candidate => (markers.filePatterns ?? []).some(pattern => pattern.test(candidate)))) {
        unmatched.push(id);
      }
    }

    expect(unmatched, 'these policies cannot match a test named after themselves').toEqual([]);
  });

  it('keeps the exemption list honest', () => {
    // An id listed as exempt but no longer in the table is a stale exemption
    // hiding a policy that is not being checked.
    const stale = [...NAMED_BY_ARTIFACT_NOT_BY_POLICY].filter(id => POLICY_MARKERS[id as keyof typeof POLICY_MARKERS] === undefined);
    expect(stale, 'exemptions naming a policy that no longer exists').toEqual([]);
  });
});

describe('a documentary compliance regime is evidenced only by its control mapping', () => {
  /**
   * The false-covered case, which is the one that matters most.
   *
   * `configIsEvidence` promotes *every* matched config file to evidence, so a
   * loose pattern on a documentary policy does not merely over-count — it
   * reports a certification as met. `iso-27001` listed `SECURITY.md`, which is
   * a vulnerability-reporting policy, so any repository with one read as
   * covered for ISO 27001.
   *
   * An unevidenced gap is a prompt to do the work. A false pass on a compliance
   * regime is something somebody repeats to an auditor.
   */
  const DOCUMENTARY = ['iso-27001', 'soc2', 'nist-800-53', 'ai-safety-compliance'] as const;

  it('does not accept SECURITY.md as evidence of any compliance regime', () => {
    for (const id of DOCUMENTARY) {
      const coverage = deriveTestingPolicyCoverage(baseInput({
        enabledMethodologies: [id],
        configFiles: ['SECURITY.md', 'README.md'],
      }));
      expect(coverage.rows[0]!.status, `${id} was evidenced by SECURITY.md`).not.toBe('covered');
    }
  });

  it('no longer accepts the control mapping either, because it now writes it', () => {
    // This assertion is the inverse of the one it replaces, deliberately.
    // The mapping used to be the artifact, gated on one assessed cell. It is
    // now *generated* by AtlasMind from the register, so counting it would be
    // the tool reading its own output back as proof — and the gate it sat
    // behind matched any table cell in the document, review log included.
    for (const id of DOCUMENTARY) {
      const coverage = deriveTestingPolicyCoverage(baseInput({
        enabledMethodologies: [id],
        configFiles: [`${COMPLIANCE_EVIDENCE_DIR}/${id}.md`],
      }));
      expect(coverage.rows[0]!.status, `${id} was evidenced by its own generated mirror`).toBe('governed');
    }
  });

  it('does not let one regime’s mapping evidence another', () => {
    // Every mapping lives in one directory, so a pattern that matched the
    // directory rather than the filename would mark all of them covered the
    // moment any one existed.
    const coverage = deriveTestingPolicyCoverage(baseInput({
      enabledMethodologies: ['soc2'],
      configFiles: [`${COMPLIANCE_EVIDENCE_DIR}/iso-27001.md`],
    }));
    expect(coverage.rows[0]!.status).not.toBe('covered');
  });
});

describe('a governance regime is never evidenced by a file', () => {
  /**
   * This block replaces one that pinned `isAssessedControlMapping`, a gate that
   * let a control mapping count as evidence once **one** cell anywhere in it
   * carried an assessed status. Both the gate and the promotion it guarded are
   * gone.
   *
   * The gate was weaker than its own comment claimed: it matched any cell in
   * any table in the document, including the Owner column and the review log,
   * so typing `Gap` as a reviewer's name qualified. And the mapping is now
   * generated by AtlasMind from the register, so reading it back as evidence
   * would be the tool citing its own output.
   */
  const COMPLIANCE_IDS = TESTING_METHODOLOGY_DEFINITIONS
    .filter(definition => definition.category.startsWith('compliance-'))
    .map(definition => definition.id);

  it('covers all twenty-four regimes', () => {
    expect(COMPLIANCE_IDS).toHaveLength(24);
  });

  it('reads governed whatever evidence the tree happens to contain', () => {
    for (const id of COMPLIANCE_IDS) {
      const coverage = deriveTestingPolicyCoverage(baseInput({
        enabledMethodologies: [id],
        // Everything that used to promote a regime, all at once.
        testFiles: [
          { relativePath: `tests/${id}.test.ts`, cases: 9, skipped: 0 },
          { relativePath: 'tests/data-privacy.test.ts', cases: 4, skipped: 0 },
        ],
        configFiles: [
          `${COMPLIANCE_EVIDENCE_DIR}/${id}.md`,
          'sbom.json', 'deny.toml', 'SECURITY.md', 'PRIVACY.md', '.ort.yml',
          '.github/workflows/sign-release.yml',
        ],
        dependencies: ['vanta', 'drata', 'secureframe'],
        scripts: ['compliance', 'sbom', 'licence'],
      }));
      const row = coverage.rows[0]!;
      expect(row.status, `${id} was promoted by something in the tree`).toBe('governed');
      expect(row.statusLabel).not.toBe('Tested');
      expect(coverage.coveredCount, id).toBe(0);
    }
  });

  it('leaves governance regimes out of the tested denominator entirely', () => {
    const coverage = deriveTestingPolicyCoverage(baseInput({
      enabledMethodologies: ['unit', 'soc2', 'iso-27001'],
      testFiles: [{ relativePath: 'tests/thing.test.ts', cases: 3, skipped: 0 }],
    }));
    expect(coverage.governedCount).toBe(2);
    expect(coverage.assessableCount).toBe(1);
    expect(coverage.coveredCount).toBe(1);
    expect(coverage.summary).toContain('1/1');
    expect(coverage.summary).toContain('governance regimes');
  });

  it('says nothing has been recorded when the register was never read', () => {
    const coverage = deriveTestingPolicyCoverage(baseInput({ enabledMethodologies: ['soc2'] }));
    const row = coverage.rows[0]!;
    expect(row.governance).toBeUndefined();
    expect(row.detail).toContain('Nothing has been recorded');
  });

  it('keeps file and tooling matches as hints rather than dropping them', () => {
    // Still useful: `data-privacy.test.ts` is a reasonable thing to reference
    // against GDPR Art. 17. It was never reasonable as proof of GDPR.
    const coverage = deriveTestingPolicyCoverage(baseInput({
      enabledMethodologies: ['gdpr'],
      testFiles: [{ relativePath: 'tests/data-privacy.test.ts', cases: 4, skipped: 0 }],
    }));
    expect(coverage.rows[0]!.files).toContain('tests/data-privacy.test.ts');
    expect(coverage.rows[0]!.status).toBe('governed');
  });
});
