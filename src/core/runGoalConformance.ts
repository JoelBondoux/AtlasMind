/**
 * Whether a run did the thing, or only said it would.
 *
 * An autonomous run ended with the single sentence "I will now edit README.md to
 * fix the test failure." — future tense, no diff, no verification — and that was
 * reported as a completed phase. Nothing in the run path asked the one question
 * a reader wants answered: is there any evidence this happened? A run that
 * changed nothing and proved nothing is not a failure in every case (a research
 * subtask legitimately changes no files), but a run whose whole answer is a
 * promise is never a completion.
 *
 * Three rules carry the design.
 *
 * **Unknown is never zero.** Every evidence input is optional, and absent means
 * "not observable" rather than "none happened". An ACP-routed subtask executes
 * its tools inside the agent's own session, so AtlasMind sees no tool calls at
 * all — counting that as zero would report every subscription-backed run as
 * having done nothing. Absent evidence yields `unassessed`, a different sentence
 * from `no-evidence` and deliberately not a criticism.
 *
 * **A promise is the only verdict that contradicts a completion.** `no-evidence`
 * is a notice: plenty of honest work produces prose. `stated-intent` is the one
 * saying the run described its next step instead of taking it, and it is matched
 * on forward-looking phrasing *only when there is no evidence at all* — an
 * answer that says "I will now run the tests" after changing six files is
 * describing what comes next, not standing in for what happened.
 *
 * **Nothing here blocks, retries or re-runs anything.** It produces a reading,
 * and a reading may be ignored — the choice `ideationReadiness` makes for the
 * same reason. A rule that is too eager stays noisy rather than becoming
 * expensive.
 */

/** What the evidence says about one unit of work. */
export type RunConformanceVerdict =
  /** Files changed, tools ran, or verification was recorded. */
  | 'evidenced'
  /** No evidence, and the answer is a forward-looking promise. */
  | 'stated-intent'
  /** No evidence, and the answer is not a promise — often legitimate. */
  | 'no-evidence'
  /** Nothing was observable, so nothing is claimed either way. */
  | 'unassessed';

export type RunConformanceRuleId =
  | 'not-observable'
  | 'files-changed'
  | 'tools-ran'
  | 'verification-recorded'
  | 'promise-without-evidence'
  | 'answered-without-evidence';

/** The declared rules, published with every assessment. */
export interface RunConformanceRule {
  id: RunConformanceRuleId;
  verdict: RunConformanceVerdict;
  description: string;
}

export const RUN_CONFORMANCE_RULES: readonly RunConformanceRule[] = [
  {
    id: 'not-observable',
    verdict: 'unassessed',
    description: 'No evidence channel was observable, so nothing is claimed either way.',
  },
  {
    id: 'files-changed',
    verdict: 'evidenced',
    description: 'The workspace changed.',
  },
  {
    id: 'tools-ran',
    verdict: 'evidenced',
    description: 'At least one tool call was made.',
  },
  {
    id: 'verification-recorded',
    verdict: 'evidenced',
    description: 'A verification summary was recorded.',
  },
  {
    id: 'promise-without-evidence',
    verdict: 'stated-intent',
    description: 'The answer describes what it is about to do, and nothing shows it happened.',
  },
  {
    id: 'answered-without-evidence',
    verdict: 'no-evidence',
    description: 'The answer changed nothing and proved nothing, which is not always wrong.',
  },
];

/**
 * One unit of work as this module needs it.
 *
 * A projection rather than a `SubTaskResult`: that type carries cost, tokens and
 * scheduling fields this question has no use for, and taking the whole record
 * would couple a rule table to a shape that changes for unrelated reasons.
 * Every evidence field is optional, and every absence means "not observable".
 */
export interface RunConformanceInput {
  id: string;
  title: string;
  output: string;
  toolCallCount?: number;
  changedFileCount?: number;
  verificationSummary?: string;
}

export interface RunConformanceAssessment {
  id: string;
  title: string;
  verdict: RunConformanceVerdict;
  rule: RunConformanceRuleId;
}

export interface RunConformanceReport {
  /** The worst verdict present, by the declared severity order. */
  verdict: RunConformanceVerdict;
  assessments: RunConformanceAssessment[];
  /** Only those that promised rather than did — the actionable set. */
  statedIntent: RunConformanceAssessment[];
  /** Published so a surface shows the rules that actually graded the run. */
  rules: readonly RunConformanceRule[];
}

/**
 * Forward-looking openings that stand in for work.
 *
 * Anchored to a line start and to the *first person*: "I will now edit", "Next
 * I'll update", "Let me check". A sentence buried mid-answer is describing a
 * next step, which is ordinary and correct; a whole answer opening this way and
 * showing nothing is the failure. "going to" is included because "I'm going to"
 * is the commonest spelling of the same promise. Leading filler is consumed
 * first, since the observed case opened "You're right. I have enough
 * information to act. I will now edit README.md".
 */
const PROMISE_LEAD_IN = '(?:ok(?:ay)?|right|great|understood|sure|you\'re right|i have enough information to act)[,.!]?\\s+';
const PROMISE_SUBJECT = '(?:i\'ll|i will|i am going to|i\'m going to|let me|i can now)';
const PROMISE_PATTERN = new RegExp(
  `^\\s*(?:${PROMISE_LEAD_IN})*(?:now\\s+|next[,]?\\s+|first[,]?\\s+|then\\s+)?${PROMISE_SUBJECT}\\b`,
  'im',
);

/** True when an evidence-free answer is a promise rather than a report. */
export function statesIntentWithoutDoing(output: string): boolean {
  return PROMISE_PATTERN.test(output);
}

/** Grade one unit of work. Root-cause first: observability, then evidence, then wording. */
export function assessRunConformance(input: RunConformanceInput): RunConformanceAssessment {
  const base = { id: input.id, title: input.title };

  const observable = input.toolCallCount !== undefined
    || input.changedFileCount !== undefined
    || input.verificationSummary !== undefined;
  if (!observable) {
    return { ...base, verdict: 'unassessed', rule: 'not-observable' };
  }

  if ((input.changedFileCount ?? 0) > 0) {
    return { ...base, verdict: 'evidenced', rule: 'files-changed' };
  }
  if ((input.toolCallCount ?? 0) > 0) {
    return { ...base, verdict: 'evidenced', rule: 'tools-ran' };
  }
  if ((input.verificationSummary ?? '').trim().length > 0) {
    return { ...base, verdict: 'evidenced', rule: 'verification-recorded' };
  }

  if (statesIntentWithoutDoing(input.output)) {
    return { ...base, verdict: 'stated-intent', rule: 'promise-without-evidence' };
  }
  return { ...base, verdict: 'no-evidence', rule: 'answered-without-evidence' };
}

/** Severity order for rolling several assessments into one. Worst first. */
const VERDICT_ORDER: readonly RunConformanceVerdict[] = [
  'stated-intent',
  'no-evidence',
  'unassessed',
  'evidenced',
];

/**
 * Roll a run's units into one reading.
 *
 * An empty run is `unassessed`, never `evidenced`: a run with no units did not
 * demonstrate anything, and reporting silence as success is the one direction
 * this module exists to refuse.
 */
export function assessRunGoalConformance(
  inputs: readonly RunConformanceInput[],
): RunConformanceReport {
  const assessments = inputs.map(assessRunConformance);
  const verdict = VERDICT_ORDER.find(candidate => assessments.some(item => item.verdict === candidate))
    ?? 'unassessed';
  return {
    verdict,
    assessments,
    statedIntent: assessments.filter(item => item.verdict === 'stated-intent'),
    rules: RUN_CONFORMANCE_RULES,
  };
}

/**
 * One line for the run report, or nothing.
 *
 * Absent when there is nothing to say, on the rule the attention feed follows:
 * a notice that is always present is one nobody reads.
 */
export function describeRunGoalConformance(report: RunConformanceReport): string | undefined {
  if (report.statedIntent.length === 0) {
    return undefined;
  }
  const titles = report.statedIntent.map(item => `**${item.title}**`).join(', ');
  const subject = report.statedIntent.length === 1 ? 'subtask' : 'subtasks';
  return `⚠️ ${report.statedIntent.length} ${subject} described what would happen next without `
    + `changing a file, calling a tool, or recording a verification: ${titles}. `
    + 'Stated intent is not evidence of completion — treat this run as unfinished.';
}
