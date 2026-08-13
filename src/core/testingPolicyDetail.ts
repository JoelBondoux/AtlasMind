/**
 * What a single testing policy needs a person to do about it.
 *
 * The Policy coverage board already answered "is anything testing this?" for
 * every enabled policy. What it could not answer is the question somebody
 * actually acts on: *whose is this, how bad is it, and what is the next move* —
 * so a board with nine gaps on it read as nine equally-weighted paragraphs and
 * nobody owned any of them.
 *
 * Three rules carry the design, and each is the same one another AtlasMind
 * register already keeps.
 *
 * **Severity comes from a declared table, never from a model.** A grade given
 * in March has to be comparable with one given in July, which is the whole
 * value of grading at all — the debt register makes this argument at length and
 * it applies here unchanged. Every finding names the rule that produced it, and
 * the table is rendered on the card so a reader can disagree with the rule
 * rather than with the number.
 *
 * **Nothing here files anything.** This module returns a *reading*: a severity,
 * a statement, and a draft. Filing a GitHub issue is public, outward-facing and
 * posted in the user's name, so severity decides what is offered and
 * emphasised, never what is created. A severity rule that turns out to be too
 * eager can then only be noisy, never damaging — which is the property that
 * makes it safe to tune later.
 *
 * **An unassessed policy is not a healthy one.** A project with no test report
 * has no verdict about failures, and that is reported as unknown rather than as
 * zero — the same distinction `testingPolicyCoverage` draws when it refuses to
 * render "0 failures" for a report nobody produced.
 */

import type { TestingMethodologyId } from '../types.js';
import type { TestingPolicyRow, TestingPolicyCoverage } from './testingPolicyCoverage.js';

/** How much a policy's current state should worry somebody. */
export type TestingFindingSeverity = 'serious' | 'moderate' | 'low' | 'none';

/**
 * The graded rules, in evaluation order. First match wins.
 *
 * Published rather than described: `TESTING_SEVERITY_RULES` is rendered on the
 * Testing page so the rule that graded a card is visible next to the grade.
 * Ordering is the policy — a failing test outranks a missing one, because a
 * test that runs and fails is a statement about the code while a test that was
 * never written is a statement about the plan.
 */
export const TESTING_SEVERITY_RULES = [
  {
    id: 'failing',
    severity: 'serious' as const,
    label: 'Tests for this policy are failing in the last report',
  },
  {
    id: 'unevidenced-sensitive',
    severity: 'serious' as const,
    label: 'An enabled security or compliance policy has no evidence at all',
  },
  {
    id: 'unevidenced',
    severity: 'moderate' as const,
    label: 'An enabled policy has no evidence at all',
  },
  {
    id: 'tooling-only',
    severity: 'low' as const,
    label: 'The tooling is installed but nothing tests with it yet',
  },
  {
    id: 'skipped',
    severity: 'low' as const,
    label: 'Every test for this policy is skipped, so none of it runs',
  },
  {
    id: 'clear',
    severity: 'none' as const,
    label: 'Evidence exists and nothing is failing',
  },
] as const;

export type TestingSeverityRuleId = typeof TESTING_SEVERITY_RULES[number]['id'];

export interface TestingPolicyFinding {
  severity: TestingFindingSeverity;
  /** The rule that graded it, by id — the label is looked up for display. */
  ruleId: TestingSeverityRuleId;
  rule: string;
  /** One sentence a person can act on. Empty only when the severity is `none`. */
  statement: string;
  /**
   * True when the grade rests on a report that does not exist.
   *
   * A project with no report has no verdict about failures. Saying so keeps
   * "nothing is failing" apart from "nobody has looked", which are the two
   * readings a green card would otherwise collapse.
   */
  unverified: boolean;
}

/**
 * The categories where an absent test is a compliance or security gap rather
 * than a coverage gap.
 *
 * Matched on the definition's category rather than a list of ids, so a policy
 * added to one of these families is graded correctly without anybody
 * remembering to update this file.
 */
const SENSITIVE_CATEGORY = /^(compliance-|non-functional$)/;

/** `security-testing` lives under non-functional alongside performance and visual. */
const SENSITIVE_IDS: ReadonlySet<string> = new Set([
  'security-testing', 'guardrail', 'ai-data-policy', 'rbac-compliance', 'audit-trail',
]);

function isSensitive(row: { id: string; category: string }): boolean {
  if (SENSITIVE_IDS.has(row.id)) { return true; }
  // Non-functional is a mixed family — visual regression is not a security
  // concern and should not be graded as one — so only the compliance families
  // qualify by category alone.
  return SENSITIVE_CATEGORY.test(row.category) && row.category !== 'non-functional';
}

const RULE_LABEL = new Map(TESTING_SEVERITY_RULES.map(rule => [rule.id, rule.label] as const));

/** Grades one policy against the declared table. */
export function gradeTestingPolicy(
  row: Pick<TestingPolicyRow, 'id' | 'label' | 'category' | 'status' | 'caseCount' | 'skippedCount' | 'failedCount'>,
  options: { hasReport: boolean },
): TestingPolicyFinding {
  const finish = (ruleId: TestingSeverityRuleId, statement: string): TestingPolicyFinding => {
    const rule = TESTING_SEVERITY_RULES.find(entry => entry.id === ruleId)!;
    return {
      severity: rule.severity,
      ruleId,
      rule: RULE_LABEL.get(ruleId) ?? ruleId,
      statement,
      // Only a claim that rests on the report is weakened by its absence. A
      // policy with no test files at all is a fact about the tree, and no
      // report would change it.
      unverified: !options.hasReport && ruleId === 'clear',
    };
  };

  if (row.failedCount > 0) {
    return finish('failing', `${row.failedCount} test${row.failedCount === 1 ? '' : 's'} for ${row.label} ${row.failedCount === 1 ? 'is' : 'are'} failing.`);
  }
  // A practice leaves no artifact, so it can never be a gap — the coverage
  // board already refuses to report one and this must agree with it.
  if (row.status === 'not-file-evident') {
    return finish('clear', '');
  }
  if (row.status === 'missing') {
    return isSensitive(row)
      ? finish('unevidenced-sensitive', `${row.label} is enabled and has nothing testing it. It governs security or compliance, so the gap is the finding rather than a backlog item.`)
      : finish('unevidenced', `${row.label} is enabled and has nothing testing it.`);
  }
  if (row.status === 'tooling-only') {
    return finish('tooling-only', `${row.label} has its tooling installed but no tests written with it yet.`);
  }
  if (row.caseCount > 0 && row.skippedCount >= row.caseCount) {
    return finish('skipped', `Every test for ${row.label} is skipped, so none of it actually runs.`);
  }
  return finish('clear', '');
}

/** A ToDo the Director can put on somebody's list. */
export interface TestingFollowUpDraft {
  title: string;
  notes: string;
  /** Days from now, from the severity — sooner for a worse finding. */
  dueInDays: number;
}

/**
 * The follow-up a finding warrants.
 *
 * Due dates come from severity rather than being asked for, because a date
 * nobody chose is still better than a list with no dates on it — and the
 * Director page lets it be changed. `undefined` when there is nothing to chase,
 * so a clear policy never manufactures a task.
 */
export function buildTestingFollowUpDraft(
  row: Pick<TestingPolicyRow, 'id' | 'label' | 'detail'>,
  finding: TestingPolicyFinding,
): TestingFollowUpDraft | undefined {
  if (finding.severity === 'none') { return undefined; }
  const dueInDays = finding.severity === 'serious' ? 3 : finding.severity === 'moderate' ? 14 : 30;
  return {
    title: `Testing: ${row.label} — ${finding.severity === 'serious' ? 'needs attention' : 'close the gap'}`,
    notes: [
      finding.statement,
      `Graded ${finding.severity} by the rule: ${finding.rule}.`,
      row.detail,
    ].filter(Boolean).join('\n\n'),
    dueInDays,
  };
}

/**
 * A GitHub issue draft for a finding, or `undefined` when one is not warranted.
 *
 * Only `serious` findings produce one. That is a deliberate narrowing: an issue
 * is public and permanent, and offering to file one for every policy a project
 * has not got round to would turn the tracker into a copy of this page.
 *
 * No model is in this path — the same item yields a byte-identical draft, which
 * is what makes it reviewable before it is posted. Labels are *suggested* only;
 * the caller intersects them with the repository's declared taxonomy, because
 * an unmatched label is created on the repository as a side effect of filing.
 */
export interface TestingIssueDraft {
  title: string;
  body: string;
  suggestedLabels: string[];
}

export function buildTestingIssueDraft(
  row: Pick<TestingPolicyRow, 'id' | 'label' | 'detail' | 'failedCount' | 'failures'>,
  finding: TestingPolicyFinding,
): TestingIssueDraft | undefined {
  if (finding.severity !== 'serious') { return undefined; }

  const failureLines = (row.failures ?? []).slice(0, 10).map(failure => {
    const where = [failure.suite, failure.name].filter(Boolean).join(' › ');
    return `- ${where || 'unnamed case'}${failure.file ? ` (\`${failure.file}\`)` : ''}`;
  });

  const body = [
    finding.statement,
    '',
    `**Policy:** ${row.label}`,
    `**Graded:** ${finding.severity} — ${finding.rule}`,
    '',
    row.detail,
    ...(failureLines.length > 0
      ? ['', `**Failing cases${row.failedCount > failureLines.length ? ` (first ${failureLines.length} of ${row.failedCount})` : ''}:**`, ...failureLines]
      : []),
    '',
    '---',
    `Raised from the AtlasMind Testing dashboard for the \`${row.id}\` policy. Closing this issue does not change the policy's status — that follows the evidence in the repository.`,
  ].join('\n');

  return {
    title: `${row.label}: ${finding.ruleId === 'failing' ? 'failing tests' : 'no test evidence'}`,
    body,
    // Ordered by preference; the caller keeps only what the repository declares.
    suggestedLabels: finding.ruleId === 'unevidenced-sensitive'
      ? ['security', 'bug', 'enhancement']
      : ['bug', 'enhancement'],
  };
}

/** One policy, fully derived, ready to render. */
export interface TestingPolicyDetail {
  id: TestingMethodologyId;
  finding: TestingPolicyFinding;
  followUp?: TestingFollowUpDraft;
  issue?: TestingIssueDraft;
  /**
   * The share of this policy's cases that run, are skipped, or fail.
   *
   * `undefined` when there are no cases — an empty bar and a bar nobody could
   * compute look identical, and only one of them means "no tests".
   */
  caseMix?: { passing: number; skipped: number; failing: number };
  /**
   * True when a per-policy **Scaffold framework** button would create something.
   *
   * Supplied by the caller rather than decided here: whether a starter file
   * exists is a question about the filesystem and the detected stack, and this
   * module stays pure. A policy whose recipe was never written for this stack
   * is not scaffoldable, and offering the button anyway would be a control that
   * does nothing.
   */
  scaffoldable: boolean;
}

export interface TestingPolicyDetailSet {
  details: TestingPolicyDetail[];
  /** Counts by severity, for the at-a-glance band. */
  counts: Record<TestingFindingSeverity, number>;
  /** The single sentence the band shows, so no renderer can restate it. */
  summary: string;
  /**
   * The grading table, carried with the grades.
   *
   * Travels in the payload rather than being imported by the renderer, so the
   * rules shown on a card are provably the ones that produced its grade — a
   * second copy in the webview could describe a table the host no longer uses.
   */
  rules: ReadonlyArray<{ id: string; severity: TestingFindingSeverity; label: string }>;
}

export function deriveTestingPolicyDetails(
  coverage: Pick<TestingPolicyCoverage, 'rows' | 'report'> | undefined,
  options: {
    /** Ids for which a starter framework could still be created. */
    scaffoldable?: ReadonlySet<string>;
  } = {},
): TestingPolicyDetailSet {
  const rows = coverage?.rows ?? [];
  const hasReport = Boolean(coverage?.report);

  const details = rows.map((row): TestingPolicyDetail => {
    const finding = gradeTestingPolicy(row, { hasReport });
    const passing = Math.max(0, row.caseCount - row.skippedCount - row.failedCount);
    return {
      id: row.id,
      finding,
      ...(buildTestingFollowUpDraft(row, finding) ? { followUp: buildTestingFollowUpDraft(row, finding) } : {}),
      ...(buildTestingIssueDraft(row, finding) ? { issue: buildTestingIssueDraft(row, finding)! } : {}),
      ...(row.caseCount > 0 ? { caseMix: { passing, skipped: row.skippedCount, failing: row.failedCount } } : {}),
      // Offered only where there is a gap to close. A policy already
      // evidenced does not need a starter file, and a practice never has one.
      scaffoldable: Boolean(options.scaffoldable?.has(row.id))
        && (row.status === 'missing' || row.status === 'tooling-only'),
    };
  });

  const counts: Record<TestingFindingSeverity, number> = { serious: 0, moderate: 0, low: 0, none: 0 };
  for (const detail of details) { counts[detail.finding.severity] += 1; }

  const summary = rows.length === 0
    ? 'No testing policies are enabled, so there is nothing to report — which is not the same as nothing being wrong.'
    : counts.serious > 0
      ? `${counts.serious} polic${counts.serious === 1 ? 'y needs' : 'ies need'} attention now; ${counts.moderate} ${counts.moderate === 1 ? 'has' : 'have'} no evidence yet.`
      : counts.moderate + counts.low > 0
        ? `Nothing is failing. ${counts.moderate + counts.low} polic${counts.moderate + counts.low === 1 ? 'y' : 'ies'} still ${counts.moderate + counts.low === 1 ? 'has' : 'have'} a gap to close.`
        : hasReport
          ? 'Every enabled policy has evidence and nothing is failing.'
          : 'Every enabled policy has evidence, but no test report has been produced — so nothing here has actually been run.';

  return { details, counts, summary, rules: TESTING_SEVERITY_RULES.map(rule => ({ ...rule })) };
}
