/**
 * Whether the work just done carries the evidence its testing policy demands.
 *
 * The project declares testing methodologies and `buildTestingObligationGuidance`
 * states them to the model in strong terms — "not suggestions", "produce it or
 * state why not". That is a *request*. Nothing checked afterwards, for any
 * policy except TDD, which meant a declared methodology could be enabled in a
 * bulk pass and never produce a single artifact while every turn reported
 * success. Observed directly: this project has had BDD enabled throughout and
 * has never produced a Given-When-Then spec.
 *
 * The distinction this closes is narrow and worth stating plainly: **AtlasMind
 * verified that tests passed; it never asked whether tests were added.**
 *
 * Five rules, in the order they prevent the failure modes that would make this
 * unusable:
 *
 * **Only a behaviour change owes evidence.** A docs edit, a config tweak, a
 * version bump and a pure test-only change owe nothing. A checker that fires on
 * every commit is one nobody reads — the register's own lesson, learned when it
 * reported its own rule table as technical debt.
 *
 * **A practice cannot be missing.** Exploratory testing leaves no file behind,
 * so there is no artifact whose absence means anything. Proposing a gap for it
 * would be the tool misunderstanding its own data — the rule
 * `testingReconciliation` already states and this one inherits.
 *
 * **A repository-level policy is not a per-change gap.** Continuous testing is
 * satisfied by CI existing and running, and security scanning by SAST being
 * configured; neither is evidenced by any individual commit. Raising them on
 * every change would produce a permanent, ignorable non-zero count — and would
 * be *wrong*, because the policy genuinely is satisfied. They are reported as
 * `repo-level` so the reasoning is visible rather than looking like an omission.
 *
 * **A verdict names the rule that produced it**, as the debt register and
 * attention feed do, so a gap can be argued with rather than merely obeyed.
 *
 * **Unassessed is not satisfied.** When the changed-file list is absent — a turn
 * that reported no artifacts — the result is `unknown`, never a clean pass. A
 * checker that reports success because it could not look is worse than none.
 *
 * Pure — no imports beyond types, no I/O, no clock.
 */
import type { ProjectTestingConfig, TestingMethodologyId } from '../types.js';

/** What kind of change this was, which decides whether evidence is owed. */
export type ChangeClass =
  | 'behaviour'
  | 'tests-only'
  | 'docs-only'
  | 'config-only'
  | 'nothing-changed'
  | 'unknown';

/** The standing of one policy against one piece of work. */
export type ObligationVerdict =
  | 'satisfied'
  | 'missing'
  | 'not-applicable'
  | 'repo-level'
  | 'practice'
  | 'unknown';

export interface PolicyObligation {
  policyId: TestingMethodologyId;
  verdict: ObligationVerdict;
  /** The id of the rule that decided, published in `OBLIGATION_RULES`. */
  rule: string;
  reason: string;
}

export interface ObligationRule {
  id: string;
  reason: string;
}

/** The published rule table. Every verdict cites one of these. */
export const OBLIGATION_RULES: readonly ObligationRule[] = [
  { id: 'not-enabled', reason: 'The project has not enabled this methodology.' },
  { id: 'practice-only', reason: 'This is a way of working and leaves no artifact, so nothing can be missing.' },
  { id: 'repository-level', reason: 'This policy is satisfied by tooling the repository configures, not by any individual change.' },
  { id: 'no-behaviour-change', reason: 'This change altered no behaviour, so it owes no new test evidence.' },
  { id: 'evidence-added', reason: 'The change added or altered test evidence of the kind this policy names.' },
  { id: 'evidence-missing', reason: 'The change altered behaviour and added no test evidence of the kind this policy names.' },
  { id: 'tdd-verified', reason: 'Verification ran and passed for this change.' },
  { id: 'tdd-missing', reason: 'The change altered behaviour without a verification run.' },
  { id: 'not-assessed', reason: 'No changed-file list was available, so nothing could be checked.' },
] as const;

const RULE_REASON = new Map(OBLIGATION_RULES.map(rule => [rule.id, rule.reason]));

/**
 * Methodologies that leave no artifact. Mirrors `PRACTICE_ONLY_METHODOLOGIES` in
 * `testingConfigLoader.ts`; pinned equal by test, because two lists drifting
 * would make a practice start producing gaps somewhere.
 */
export const PRACTICE_ONLY: ReadonlySet<TestingMethodologyId> = new Set<TestingMethodologyId>([
  'v-model', 'white-box', 'test-design', 'black-box', 'gray-box', 'exploratory', 'agile-testing',
]);

/**
 * Methodologies evidenced by repository configuration rather than by a commit.
 *
 * Continuous testing is satisfied when CI runs the suite; security testing when
 * a scanner is configured. Demanding either per change would report a gap that
 * is not one — the policy is genuinely met — and would do it on every commit
 * until somebody switched the checker off.
 */
export const REPOSITORY_LEVEL: ReadonlySet<TestingMethodologyId> = new Set<TestingMethodologyId>([
  'continuous', 'security-testing', 'performance', 'visual',
  // Scanner- and suite-configured: satisfied by the tool being wired up and
  // running, not by a test travelling with each change.
  'dead-field', 'dependency-graph', 'chaos', 'accessibility', 'observability', 'data-quality',
  // Supply chain: the evidence is an artifact the pipeline produces per
  // release, so demanding it per commit would report a gap on every commit
  // while the policy is genuinely met.
  'sbom', 'dependency-licensing', 'license-compatibility', 'secure-build-pipeline',
  // Compliance regimes evidenced by a control mapping rather than by a test.
  // A commit cannot satisfy "Annex A.8.24 — cryptography governed by policy",
  // and asking it to would make every commit owe evidence nobody can produce.
  // The machine-checkable compliance policies (RBAC, audit trail, retention,
  // GDPR erasure, PCI, HIPAA) are deliberately *not* here: those genuinely do
  // owe a test when the behaviour they govern changes.
  'iso-27001', 'soc2', 'nist-800-53', 'change-management',
  'ai-safety-compliance', 'explainability',
  'financial-compliance', 'medical-compliance', 'automotive-compliance',
  'aviation-compliance', 'energy-compliance',
]);

/** Paths that never constitute a behaviour change. */
const DOC_PATTERN = /\.(md|mdx|txt|rst|adoc)$/i;
const CONFIG_PATTERN = /(^|[/\\])(package(-lock)?\.json|tsconfig[^/\\]*\.json|\.eslintrc[^/\\]*|[^/\\]*\.ya?ml|\.gitignore|\.npmrc|\.vscodeignore)$/i;
const TEST_PATTERN = /(^|[/\\])(tests?|__tests__|spec|features)[/\\]|\.(test|spec)\.[cm]?[jt]sx?$|\.feature$/i;

/** Test files that evidence a specific methodology. */
const BDD_PATTERN = /\.feature$|(^|[/\\])features[/\\]|\.steps\.[cm]?[jt]s$/i;

function isDocPath(path: string): boolean { return DOC_PATTERN.test(path); }
function isConfigPath(path: string): boolean { return CONFIG_PATTERN.test(path); }
function isTestPath(path: string): boolean { return TEST_PATTERN.test(path); }

/**
 * What kind of change this was.
 *
 * Order is the policy. A changeset touching both source and docs is a behaviour
 * change — the docs travelling with it do not dilute the obligation. Only a
 * changeset containing *no* production source at all can be docs-, config- or
 * test-only.
 */
export function classifyChange(changedFiles: readonly string[] | undefined): ChangeClass {
  if (changedFiles === undefined) { return 'unknown'; }
  const files = changedFiles.filter(file => typeof file === 'string' && file.trim().length > 0);
  if (files.length === 0) { return 'nothing-changed'; }

  const productionFiles = files.filter(file => !isTestPath(file) && !isDocPath(file) && !isConfigPath(file));
  if (productionFiles.length > 0) { return 'behaviour'; }

  if (files.some(file => isTestPath(file))) { return 'tests-only'; }
  if (files.some(file => isDocPath(file))) { return 'docs-only'; }
  return 'config-only';
}

export interface ObligationInput {
  config: ProjectTestingConfig | undefined;
  /** Files this piece of work changed. `undefined` means nothing was recorded. */
  changedFiles?: readonly string[];
  /**
   * Whether verification ran and passed, from the execution artifact. Only TDD
   * consumes it — the others are evidenced by files, not by a run.
   */
  tddStatus?: 'verified' | 'blocked' | 'missing' | 'not-applicable';
  /**
   * Test source added or altered by this change, keyed by path. Used to tell a
   * property test from an ordinary one without re-reading the repository.
   */
  addedTestSources?: ReadonlyMap<string, string>;
}

export interface ObligationAssessment {
  changeClass: ChangeClass;
  obligations: PolicyObligation[];
  /** Policies that owed evidence and did not get it. The actionable subset. */
  gaps: PolicyObligation[];
}

function decide(policyId: TestingMethodologyId, verdict: ObligationVerdict, rule: string): PolicyObligation {
  return { policyId, verdict, rule, reason: RULE_REASON.get(rule) ?? rule };
}

/**
 * Does the changed test evidence satisfy this specific methodology?
 *
 * Deliberately narrow. `unit` is satisfied by any changed test file; `property`
 * needs a generative-testing import to actually appear, because a project can
 * add fifty unit tests and still have produced no property test; `bdd` needs a
 * feature file or a step definition, since a `describe` block is not a
 * Given-When-Then specification however it is worded.
 */
function evidenceSatisfies(
  policyId: TestingMethodologyId,
  changedTestFiles: readonly string[],
  addedTestSources: ReadonlyMap<string, string> | undefined,
): boolean {
  if (changedTestFiles.length === 0) { return false; }

  switch (policyId) {
    case 'bdd':
      return changedTestFiles.some(file => BDD_PATTERN.test(file));
    case 'property': {
      if (!addedTestSources) { return false; }
      for (const [path, source] of addedTestSources) {
        if (!isTestPath(path) || typeof source !== 'string') { continue; }
        if (/\bfast-check\b|\bfc\.(assert|property|asyncProperty)\b|\bhypothesis\b|\bjsverify\b/.test(source)) {
          return true;
        }
      }
      return false;
    }
    default:
      // unit, integration, snapshot, contract, e2e and the rest are evidenced by
      // a test file changing. A finer reading would need to understand what the
      // test asserts, which is not something a path can tell us.
      return true;
  }
}

/**
 * Assess every enabled policy against one piece of work.
 *
 * Total: any input, including an empty or absent one, yields an assessment.
 */
export function assessTestingObligations(input: ObligationInput): ObligationAssessment {
  const changeClass = classifyChange(input.changedFiles);
  const enabled = (input.config?.methodologies ?? []).filter(entry => entry.enabled);

  const changedTestFiles = (input.changedFiles ?? []).filter(file => isTestPath(file));
  const obligations: PolicyObligation[] = [];

  for (const entry of enabled) {
    const policyId = entry.id;

    if (PRACTICE_ONLY.has(policyId)) {
      obligations.push(decide(policyId, 'practice', 'practice-only'));
      continue;
    }
    if (REPOSITORY_LEVEL.has(policyId)) {
      obligations.push(decide(policyId, 'repo-level', 'repository-level'));
      continue;
    }
    if (changeClass === 'unknown') {
      obligations.push(decide(policyId, 'unknown', 'not-assessed'));
      continue;
    }
    if (changeClass !== 'behaviour') {
      obligations.push(decide(policyId, 'not-applicable', 'no-behaviour-change'));
      continue;
    }

    if (policyId === 'tdd') {
      // TDD is evidenced by a verification run rather than by a file. `blocked`
      // is not a pass: something prevented the check, which is exactly when
      // somebody needs to know.
      obligations.push(input.tddStatus === 'verified'
        ? decide(policyId, 'satisfied', 'tdd-verified')
        : decide(policyId, 'missing', 'tdd-missing'));
      continue;
    }

    obligations.push(evidenceSatisfies(policyId, changedTestFiles, input.addedTestSources)
      ? decide(policyId, 'satisfied', 'evidence-added')
      : decide(policyId, 'missing', 'evidence-missing'));
  }

  return {
    changeClass,
    obligations,
    gaps: obligations.filter(obligation => obligation.verdict === 'missing'),
  };
}

/**
 * The issue a gap becomes when AtlasMind could not close it by writing a test.
 *
 * **Labels come only from the declared taxonomy.** Applying a label GitHub does
 * not have *creates* it, changing the project's label set as a side effect of
 * filing — so the three this uses (`critical`, `test`, `testing-<policy>`) are
 * declared in `workflow.json` deliberately rather than invented here. An area
 * label with no declared counterpart is dropped and the omission is stated in
 * the body, so a reader can see what was left off rather than wondering.
 *
 * **The title names the policy and the file, not the fix.** A gap is a fact
 * about evidence that does not exist; what to write about it is a judgement the
 * person picking it up should make.
 */
export interface TestingGapIssueDraft {
  title: string;
  body: string;
  labels: string[];
  droppedLabels: string[];
}

/** Area label for a policy, by convention `testing-<id>`. */
export function testingAreaLabel(policyId: TestingMethodologyId): string {
  return `testing-${policyId}`;
}

export interface TestingGapIssueInput {
  gap: PolicyObligation;
  /** Files the work changed, used to say what the gap is about. */
  changedFiles: readonly string[];
  /** What the work was, in the operator's words where available. */
  workSummary?: string;
  /** Labels the repository actually declares, by category. */
  declaredLabels: { type: readonly string[]; priority: readonly string[]; area: readonly string[] };
  /** Why the test could not simply be written. */
  writeAttempt?: { attempted: boolean; reason?: string };
}

const MAX_TITLE_CHARS = 90;
const MAX_LISTED_FILES = 12;

function clampTitle(text: string): string {
  if (text.length <= MAX_TITLE_CHARS) { return text; }
  const cut = text.slice(0, MAX_TITLE_CHARS);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > 40 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

/**
 * Turn one unclosed gap into an issue draft.
 *
 * Nothing here files anything: the caller confirms and posts, behind the same
 * gate every other outward-facing write uses.
 */
export function buildTestingGapIssue(input: TestingGapIssueInput): TestingGapIssueDraft {
  const wanted = ['critical', 'test', testingAreaLabel(input.gap.policyId)];
  const declared = new Set<string>([
    ...input.declaredLabels.type, ...input.declaredLabels.priority, ...input.declaredLabels.area,
  ]);
  const labels = wanted.filter(label => declared.has(label));
  const droppedLabels = wanted.filter(label => !declared.has(label));

  const productionFiles = input.changedFiles.filter(file => !isTestPath(file) && !isDocPath(file) && !isConfigPath(file));
  const listed = productionFiles.slice(0, MAX_LISTED_FILES);
  const remainder = productionFiles.length - listed.length;

  const title = clampTitle(
    `${input.gap.policyId.toUpperCase()} evidence missing for ${input.workSummary?.trim() || listed[0] || 'a recent change'}`,
  );

  const body = [
    `A change altered behaviour without producing the evidence the project's **${input.gap.policyId}** policy requires.`,
    '',
    `**Why this was raised:** ${input.gap.reason} (rule \`${input.gap.rule}\`)`,
    input.writeAttempt?.attempted
      ? `**AtlasMind tried to write it and could not:** ${input.writeAttempt.reason ?? 'no reason was recorded'}`
      : '**AtlasMind did not attempt to write it automatically.**',
    '',
    '**Files changed:**',
    ...listed.map(file => `- \`${file}\``),
    remainder > 0 ? `- …and ${remainder} more` : '',
    '',
    droppedLabels.length > 0
      ? `_Labels not applied because the repository does not declare them: ${droppedLabels.join(', ')}._`
      : '',
    '_Raised automatically by AtlasMind\'s testing policy check. Closing this issue does not add the missing evidence._',
  ].filter(line => line !== '').join('\n');

  return { title, body, labels, droppedLabels };
}
