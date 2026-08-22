/**
 * Turning a register finding into planned work.
 *
 * AtlasMind keeps three registers of things somebody found and wrote down — the
 * gap analysis, the tech-debt register, and the risk register. All three feed the
 * operational score and the attention band, and none of them could become work.
 * The nav strip on the Gap Analysis page even said *"Turn a gap into planned
 * work"* and routed to the Roadmap, where you retyped it by hand with no link in
 * either direction. A P1 gap is the most concrete "somebody wrote down that
 * something is wrong" signal on the dashboard, and it was the one that dead-ended.
 *
 * One module rather than three, because the alternative is three rule tables that
 * eventually disagree about how a finding becomes a sentence — and the symptom
 * would be a backlog where a gap and a risk of identical severity read as
 * different kinds of commitment.
 *
 * Four rules:
 *
 * 1. **No model is in this path.** The same finding yields a byte-identical
 *    roadmap line and issue draft, which is what makes them reviewable: the rule
 *    that chose a label is visible, and the next finding is predictable. A
 *    generated issue title is a claim nobody checked, posted publicly under the
 *    user's name. This is the same stance `roadmapIssueDraft` and
 *    `ideationDerivation` already take, and it is the reason all three can share
 *    a confirmation dialog that shows the exact text.
 *
 * 2. **A prefix is added only where it changes what the sentence commits to.**
 *    A register records a *finding* — "no CODEOWNERS file", "TODO: replace this
 *    shim", "the retention claim is unevidenced" — and the work is closing it,
 *    not having it. Without the prefix the backlog reads as if the missing
 *    CODEOWNERS file were the goal. Mirrors `ideationDerivation`'s table, and
 *    `risk` deliberately uses the same word there and here; a test pins them
 *    equal so two vocabularies cannot drift into meaning different things.
 *
 * 3. **Labels come only from the declared taxonomy.** An invented label is
 *    *created* on the repository as a side effect of filing. Several candidates
 *    per category in preference order, the repository's own spelling wins, and an
 *    unmatched intent is reported in `droppedLabels` **and** stated in the issue
 *    body, so the omission is visible to the reader rather than only to the filer.
 *
 * 4. **A draft is not a filed issue, and a derivation is not a roadmap write.**
 *    Nothing here touches `gh` or the filesystem. The confirmation that writes
 *    lives at the call site, behind the same gate as every other outward action.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

import type { IssueDraft } from './issueTracker.js';

/** The three registers that can hand work over. */
export type RegisterKind = 'gap' | 'debt' | 'risk';

/**
 * A finding, normalised to what the hand-off actually needs.
 *
 * Deliberately not the register's own record type. Each of the three has fields
 * this does not want (a debt entry's transition history, a risk finding's
 * confidence), and taking the whole record would couple one module to three
 * shapes that change for unrelated reasons.
 */
export interface RegisterFinding {
  readonly kind: RegisterKind;
  /**
   * The register's own id.
   *
   * All three derive theirs from content rather than from position, so a link
   * recorded against one still resolves after a re-scan — and a *reworded*
   * finding honestly reads as a different finding rather than silently
   * inheriting the old one's history.
   */
  readonly id: string;
  /** The one-line statement of what was found. */
  readonly title: string;
  /** Longer text, where the register has one. */
  readonly detail?: string;
  /** Normalised by the caller from the register's own severity vocabulary. */
  readonly severity: 'high' | 'medium' | 'low';
  /** The register's own category or domain word, which decides the label intent. */
  readonly category: string;
  /** Where the evidence is, when the register points at a file. */
  readonly evidencePath?: string;
  readonly evidenceLine?: number;
  /** The declared rule that graded it, where the register has one. */
  readonly rule?: string;
}

/**
 * What each register's findings commit you to.
 *
 * `risk` matches `ideationDerivation`'s word for the same thing, pinned by test.
 * `gap` and `debt` have no counterpart there: a gap is an absence and the work is
 * closing it; debt is a shortcut that already works, and "pay down" is the
 * idiomatic phrase for removing one without implying it is broken.
 */
const REGISTER_PREFIX: Readonly<Record<RegisterKind, string>> = {
  gap: 'Close',
  debt: 'Pay down',
  risk: 'Mitigate',
};

/** How each register reads in a sentence, for the issue body. */
const REGISTER_WORDS: Readonly<Record<RegisterKind, string>> = {
  gap: 'a gap found by the AtlasMind gap analysis',
  debt: 'an entry in the AtlasMind tech-debt register',
  risk: 'a finding from the AtlasMind risk advisors',
};

/** Which file the register lives in, so the issue can name it. */
const REGISTER_SOURCE: Readonly<Record<RegisterKind, string>> = {
  gap: '`analysis/gap-analysis.md`',
  debt: 'the tech-debt register',
  risk: '`operations/risk-oversight.json`',
};

/**
 * Label intents by category, in preference order.
 *
 * Keyed on the *union* of the three registers' category vocabularies rather than
 * per register, because `security` means the same thing whether a gap or a debt
 * entry raised it, and two tables saying so would eventually disagree. An
 * unlisted category contributes no intent, which yields a draft with the
 * severity label only rather than one carrying a guess.
 */
const CATEGORY_LABEL_CANDIDATES: Readonly<Record<string, readonly string[]>> = {
  // Gap analysis categories.
  architecture: ['architecture', 'refactor', 'tech-debt'],
  security: ['security', 'vulnerability'],
  functionality: ['bug', 'defect', 'enhancement'],
  'ui-ux': ['ui', 'ux', 'design'],
  memory: ['architecture', 'refactor'],
  'code-structure': ['refactor', 'tech-debt', 'architecture'],
  testing: ['testing', 'tests', 'test'],
  delivery: ['ci', 'build', 'infrastructure', 'devops'],
  documentation: ['documentation', 'docs'],
  quality: ['quality', 'tech-debt'],
  general: [],
  // Tech-debt domains not already above.
  code: ['refactor', 'tech-debt'],
  test: ['testing', 'tests', 'test'],
  dependency: ['dependencies', 'dependency'],
  infrastructure: ['infrastructure', 'devops', 'ci'],
  // Risk domains.
  ethics: ['ethics', 'compliance', 'policy'],
  legal: ['legal', 'compliance', 'policy'],
  commercial: ['commercial', 'business', 'product'],
};

/** Severity intents. Only consulted for `high`: everything is at least medium. */
const SEVERITY_LABEL_CANDIDATES: readonly string[] = ['critical', 'high-priority', 'priority-high', 'urgent'];

/** Titles cap here, well short of GitHub's 256, so a list stays readable. */
export const MAX_REGISTER_TITLE_LENGTH = 120;

/** Roadmap lines cap here. The roadmap is a list of sentences, not paragraphs. */
export const MAX_REGISTER_ROADMAP_LENGTH = 240;

export interface RegisterRoadmapDerivation {
  /** The exact line that would be written. Shown before anything is written. */
  readonly text: string;
  /** The prefix that was applied, so the confirmation can explain it. */
  readonly prefix: string;
  /** True when the finding's own wording was cut to fit. */
  readonly clamped: boolean;
}

export interface RegisterIssueDraft extends IssueDraft {
  readonly registerKind: RegisterKind;
  /** The register entry this came from, so the two can be reconciled later. */
  readonly registerId: string;
  /** Label intents that found nothing in the taxonomy. Stated, never silent. */
  readonly droppedLabels: readonly string[];
}

/** Collapse whitespace and strip markup that reads as noise in a title. */
function cleanFindingText(raw: string): string {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    // Checklist leaders, in case a caller passed a raw markdown line.
    .replace(/^\s*[-*]\s*\[[ xX]\]\s*/, '')
    .replace(/^\s*[-*]\s+/, '')
    // The gap analysis writes `[P1] [security] [gap]` prefixes into its lines.
    .replace(/^(?:\s*\[[^\]]{1,24}\]\s*)+/, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cut to a length without cutting a word in half.
 *
 * A title ending mid-word reads as a truncation bug, and somebody scanning a
 * list of issues cannot tell ours from theirs.
 */
function clampText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  const cut = text.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const body = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${body.replace(/[,;:.\s]+$/, '')}…`;
}

/**
 * Lower-case the first word unless it is a name.
 *
 * `Fix: GitHub Actions…` must not become `Fix: gitHub Actions…`, so the whole
 * first word is checked rather than just its first letter — the bug
 * `ideationDerivation` hit and documented.
 */
function decapitalizeFirstWord(text: string): string {
  const [first] = text.split(' ');
  if (first === undefined || first.length === 0) {
    return text;
  }
  const isSentenceCase = /^[A-Z][a-z]+$/.test(first);
  return isSentenceCase ? `${first.charAt(0).toLowerCase()}${text.slice(1)}` : text;
}

/**
 * The roadmap line a finding becomes.
 *
 * Returned rather than written, so the caller can show it in a confirmation
 * before anything reaches a tracked file — the same contract the ideation board's
 * "Add to roadmap" already honours.
 */
export function deriveRegisterRoadmapText(finding: RegisterFinding): RegisterRoadmapDerivation {
  const cleaned = cleanFindingText(finding.title);
  const prefix = REGISTER_PREFIX[finding.kind];
  const sentence = cleaned === ''
    ? ''
    : `${prefix}: ${decapitalizeFirstWord(cleaned)}`;
  const text = clampText(sentence, MAX_REGISTER_ROADMAP_LENGTH);
  return { text, prefix, clamped: text !== sentence };
}

/**
 * The issue draft a finding becomes.
 *
 * `declaredLabels` is the repository's actual label list. An empty list is
 * legitimate — a repository may have none, or they may not have been loaded — and
 * produces a draft with no labels rather than invented ones.
 */
export function deriveRegisterIssueDraft(
  finding: RegisterFinding,
  declaredLabels: readonly string[],
): RegisterIssueDraft {
  const available = new Map(declaredLabels.map(label => [label.toLowerCase(), label]));
  const labels: string[] = [];
  const dropped: string[] = [];

  const take = (candidates: readonly string[]): void => {
    if (candidates.length === 0) {
      return;
    }
    const matched = candidates.find(candidate => available.has(candidate.toLowerCase()));
    if (matched === undefined) {
      // The first candidate names the *intent*, which is what the reader needs
      // to know was dropped — not the four spellings we looked for.
      dropped.push(candidates[0] as string);
      return;
    }
    // The repository's own spelling: `Documentation` and `documentation` are one
    // label to a human and two to `gh`.
    const label = available.get(matched.toLowerCase()) as string;
    if (!labels.includes(label)) {
      labels.push(label);
    }
  };

  take(CATEGORY_LABEL_CANDIDATES[finding.category] ?? []);
  if (finding.severity === 'high') {
    take(SEVERITY_LABEL_CANDIDATES);
  }

  const cleaned = cleanFindingText(finding.title);
  const title = clampText(cleaned, MAX_REGISTER_TITLE_LENGTH);

  return {
    registerKind: finding.kind,
    registerId: finding.id,
    title,
    body: buildRegisterIssueBody(finding, cleaned, labels, dropped),
    labels,
    droppedLabels: dropped,
  };
}

/**
 * The body.
 *
 * Fixed order, fixed sections, no prose that varies with the finding beyond the
 * finding's own words. The provenance section matters most: an issue raised from
 * a register that does not say so becomes a duplicate the first time anybody
 * reads that register again — and it has to say that closing the issue does not
 * resolve the register entry, because the two are separate records and pretending
 * otherwise is how a register quietly stops being true.
 */
function buildRegisterIssueBody(
  finding: RegisterFinding,
  cleaned: string,
  labels: readonly string[],
  dropped: readonly string[],
): string {
  const lines: string[] = ['## What', '', cleaned === '' ? '(no description recorded)' : cleaned, ''];

  const detail = cleanFindingText(finding.detail ?? '');
  if (detail !== '' && detail !== cleaned) {
    lines.push(clampText(detail, 1200), '');
  }

  lines.push('## Why now', '');
  lines.push(
    `Graded **${finding.severity}**${finding.rule === undefined ? '' : ` by the rule “${cleanFindingText(finding.rule)}”`}. `
    + `This is ${REGISTER_WORDS[finding.kind]}.`,
  );
  lines.push('');

  if (finding.evidencePath !== undefined && finding.evidencePath !== '') {
    lines.push('## Evidence', '');
    lines.push(
      finding.evidenceLine === undefined
        ? `\`${finding.evidencePath}\``
        : `\`${finding.evidencePath}\`, line ${finding.evidenceLine}`,
    );
    lines.push('');
  }

  lines.push('## Where this came from', '');
  lines.push(
    `Raised from ${REGISTER_WORDS[finding.kind]}, recorded in ${REGISTER_SOURCE[finding.kind]}. `
    + 'That register remains the source of truth for whether this is still open: '
    + 'closing this issue does not resolve the entry, and resolving the entry does not close this issue.',
  );

  if (dropped.length > 0) {
    lines.push('');
    lines.push(
      `> Not labelled ${dropped.map(label => `\`${label}\``).join(', ')} — `
      + 'no matching label exists on this repository, and AtlasMind does not create labels '
      + 'as a side effect of filing an issue.',
    );
  }

  return lines.join('\n');
}

// Whether a finding is still outstanding is deliberately *not* decided here.
// Only the register itself knows what its own status vocabulary means — an
// `accepted` risk is a decision somebody took, while an `accepted` debt entry is
// still work — so each caller answers that question and passes the answer along.
