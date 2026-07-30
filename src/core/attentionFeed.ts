/**
 * What needs a person, gathered from every dashboard page onto the Overview.
 *
 * The Overview answers *"how are we doing?"*, and until now it answered it with
 * nine permanently-populated stat cards — "43% coverage", "8 workflows". Those
 * describe **state**, and a card that always shows a number is a card people
 * stop reading. Nothing on the page distinguished a project with three failing
 * tests and an overdue release gate from one with neither.
 *
 * This module is the other question: *what is wrong or due right now*, drawn
 * from the pages that already know. It is deliberately **not** a summary of
 * every page — the Overview once ended with a grid of twelve equally-weighted
 * shortcut cards, and that grid was removed for being a second navigation
 * system competing with the first. The distinguishing property of this section
 * is that **it is empty when nothing needs you**, which a navigation grid can
 * never be.
 *
 * Five rules keep it from becoming the thing that was removed:
 *
 * 1. **Only what needs a person.** Not "43% coverage" — "3 tests failing". The
 *    Project State badge already learned this: a count that includes everything
 *    is permanently non-zero and therefore ignored.
 * 2. **Severity from a declared rule, never a judgement.** Each signal names the
 *    rule that graded it, so a grade can be argued with rather than trusted. The
 *    debt register's reasoning, applied to a different register.
 * 3. **Ranked by consequence, not magnitude.** A red pipeline outranks forty
 *    stale issues. Ties break on declaration order, so the list cannot shuffle
 *    between renders and become unreadable.
 * 4. **Capped, with the remainder stated.** A list that silently truncates reads
 *    as "that's everything".
 * 5. **Unassessed is not clear.** The category that matters most: a page that
 *    could not be read — no `gh`, no test report, never scanned — must never
 *    contribute to a quiet Overview. Silence earned by not looking is the one
 *    failure mode that would make this section actively harmful.
 *
 * Pure and `vscode`-free.
 */

/** How soon a person needs to deal with it. Ordered by consequence. */
export type AttentionUrgency = 'now' | 'soon' | 'unassessed';

export interface AttentionItem {
  id: string;
  urgency: AttentionUrgency;
  /** Short, for the card face. */
  label: string;
  /** One sentence on what it means and why it is here. */
  detail: string;
  /** The dashboard page that owns this fact. */
  pageTarget: string;
  /** The declared rule that graded it, published so the grade can be checked. */
  rule: string;
  /** A count where one is meaningful. Display only; never used for ranking. */
  count?: number;
}

/**
 * Everything the feed reads, mapped by the caller from the dashboard snapshot.
 *
 * Narrow and explicit rather than taking the snapshot itself: this module then
 * depends on eleven fields instead of a two-hundred-field interface, and every
 * field it reads is visible in one place. The same reason `ProjectStateInput`
 * is shaped this way.
 *
 * **Every group is optional, and absent means "not assessed" rather than
 * "nothing there".** That distinction is the whole of rule 5.
 */
export interface AttentionInput {
  testing?: {
    /** Failures counted from the project's own test report. */
    failing: number;
    /** False when no report exists, so failures are unknown rather than zero. */
    hasReport: boolean;
    /** Enabled methodologies with no evidence at all. */
    uncovered: number;
  };
  pipeline?: {
    /** The most recent run's conclusion, when one is known. */
    latestFailed: boolean;
    loaded: boolean;
  };
  issues?: {
    /** False for every `status` other than `ready` — no CLI, not authed, error. */
    loaded: boolean;
    stale: number;
    unassigned: number;
  };
  ssot?: { blocked: number; warned: number };
  director?: { overdue: number };
  documents?: { reviewDue: number; missing: number };
  risk?: { assessed: boolean; open: number };
  debt?: { scanned: boolean; open: number; high: number };
  release?: { blockedGates: number };
  delivery?: { blockedPaths: number };
  workflow?: { nextStepBlocked: boolean; nextStepTitle?: string };
}

/**
 * The rule table, published and ordered.
 *
 * Order **is** the consequence ranking — first entry outranks second, and that
 * is a declared editorial decision rather than an emergent property of counts.
 * A hundred stale issues must not outrank a red pipeline, and sorting by
 * magnitude would let it.
 */
interface AttentionRule {
  id: string;
  urgency: AttentionUrgency;
  rule: string;
  pageTarget: string;
  /** Returns the item's variable parts, or undefined when it does not apply. */
  evaluate: (input: AttentionInput) => { label: string; detail: string; count?: number } | undefined;
}

const RULES: readonly AttentionRule[] = [
  // ── now: something is failing, shut, or past due ──────────────────
  {
    id: 'tests-failing',
    urgency: 'now',
    rule: 'any failing test in the project\'s own report',
    pageTarget: 'testing',
    evaluate: input => (input.testing && input.testing.hasReport && input.testing.failing > 0
      ? {
        label: `${input.testing.failing} test${input.testing.failing === 1 ? '' : 's'} failing`,
        detail: 'Counted from the test report this project wrote. AtlasMind never runs your tests to find out.',
        count: input.testing.failing,
      }
      : undefined),
  },
  {
    id: 'ci-red',
    urgency: 'now',
    rule: 'the most recent CI run concluded in failure',
    pageTarget: 'pipeline',
    evaluate: input => (input.pipeline?.loaded && input.pipeline.latestFailed
      ? { label: 'CI is red', detail: 'The most recent run on this branch failed. The Pipeline page classifies why.' }
      : undefined),
  },
  {
    id: 'ssot-blocked',
    urgency: 'now',
    rule: 'any memory entry blocked by the write gate',
    pageTarget: 'ssot',
    evaluate: input => (input.ssot && input.ssot.blocked > 0
      ? {
        label: `${input.ssot.blocked} memory write${input.ssot.blocked === 1 ? '' : 's'} blocked`,
        detail: 'The security scanner refused these entries, so the project memory behind them is not being kept.',
        count: input.ssot.blocked,
      }
      : undefined),
  },
  {
    id: 'followups-overdue',
    urgency: 'now',
    rule: 'any follow-up past its due date',
    pageTarget: 'director',
    evaluate: input => (input.director && input.director.overdue > 0
      ? {
        label: `${input.director.overdue} follow-up${input.director.overdue === 1 ? '' : 's'} overdue`,
        detail: 'Someone is waiting on this. Overdue is measured against the date you set, not an estimate.',
        count: input.director.overdue,
      }
      : undefined),
  },
  {
    id: 'release-blocked',
    urgency: 'now',
    rule: 'any release gate not passing',
    pageTarget: 'release',
    evaluate: input => (input.release && input.release.blockedGates > 0
      ? {
        label: `${input.release.blockedGates} release gate${input.release.blockedGates === 1 ? '' : 's'} not passing`,
        detail: 'A release from here would be refused. A release is the one step that cannot be undone.',
        count: input.release.blockedGates,
      }
      : undefined),
  },
  {
    id: 'promotion-blocked',
    urgency: 'now',
    rule: 'any promotion path with a declared blocker',
    pageTarget: 'delivery',
    evaluate: input => (input.delivery && input.delivery.blockedPaths > 0
      ? {
        label: `${input.delivery.blockedPaths} promotion path${input.delivery.blockedPaths === 1 ? '' : 's'} blocked`,
        detail: 'Opening the plan will refuse until the blocker is cleared — usually a missing backup or routine.',
        count: input.delivery.blockedPaths,
      }
      : undefined),
  },
  {
    id: 'workflow-step-blocked',
    urgency: 'now',
    rule: 'the next workflow step is blocked rather than actionable',
    pageTarget: 'workflow',
    evaluate: input => (input.workflow?.nextStepBlocked
      ? {
        label: 'The next workflow step is blocked',
        detail: input.workflow.nextStepTitle
          ? `"${input.workflow.nextStepTitle}" cannot proceed until its blocker is cleared.`
          : 'The stage cannot proceed until its blocker is cleared.',
      }
      : undefined),
  },

  // ── soon: real, but nothing is on fire ───────────────────────────
  {
    id: 'debt-high',
    urgency: 'soon',
    rule: 'any open debt entry graded high by the register\'s rule table',
    pageTarget: 'debt',
    evaluate: input => (input.debt?.scanned && input.debt.high > 0
      ? {
        label: `${input.debt.high} high-severity debt`,
        detail: 'Graded by the register\'s published rule table, so the grade is comparable with last month\'s.',
        count: input.debt.high,
      }
      : undefined),
  },
  {
    id: 'risk-open',
    urgency: 'soon',
    rule: 'any open risk finding',
    pageTarget: 'risk',
    evaluate: input => (input.risk?.assessed && input.risk.open > 0
      ? {
        label: `${input.risk.open} open risk finding${input.risk.open === 1 ? '' : 's'}`,
        detail: 'Raised by the ethics, legal or commercial advisors and not yet accepted or resolved.',
        count: input.risk.open,
      }
      : undefined),
  },
  {
    id: 'docs-review-due',
    urgency: 'soon',
    rule: 'any tracked document whose source changed after its last review',
    pageTarget: 'documents',
    evaluate: input => (input.documents && input.documents.reviewDue > 0
      ? {
        label: `${input.documents.reviewDue} document${input.documents.reviewDue === 1 ? '' : 's'} due review`,
        detail: 'The file changed after you last marked it reviewed. Nothing is rewritten on a timer.',
        count: input.documents.reviewDue,
      }
      : undefined),
  },
  {
    id: 'issues-stale',
    urgency: 'soon',
    rule: 'any open issue with no activity inside the staleness window',
    pageTarget: 'issues',
    evaluate: input => (input.issues?.loaded && input.issues.stale > 0
      ? {
        label: `${input.issues.stale} stale issue${input.issues.stale === 1 ? '' : 's'}`,
        detail: 'Open, and untouched for long enough that nobody is likely working on them.',
        count: input.issues.stale,
      }
      : undefined),
  },
  {
    id: 'tests-uncovered',
    urgency: 'soon',
    rule: 'any enabled testing methodology with no evidence at all',
    pageTarget: 'testing',
    evaluate: input => (input.testing && input.testing.uncovered > 0
      ? {
        label: `${input.testing.uncovered} methodolog${input.testing.uncovered === 1 ? 'y' : 'ies'} unevidenced`,
        detail: 'Declared in the testing matrix with nothing on disk to show for it.',
        count: input.testing.uncovered,
      }
      : undefined),
  },

  // ── unassessed: nobody looked, which is not the same as fine ──────
  {
    id: 'tests-no-report',
    urgency: 'unassessed',
    rule: 'no test report exists, so failures cannot be counted',
    pageTarget: 'testing',
    evaluate: input => (input.testing && !input.testing.hasReport
      ? {
        label: 'No test report',
        detail: 'Failures are unknown rather than zero. The Testing page names the command that writes one.',
      }
      : undefined),
  },
  {
    id: 'issues-unreadable',
    urgency: 'unassessed',
    rule: 'the issue tracker could not be read',
    pageTarget: 'issues',
    evaluate: input => (input.issues && !input.issues.loaded
      ? {
        label: 'Issues not readable',
        detail: 'No `gh`, not signed in, or not a GitHub repository — so issue counts are unknown, not zero.',
      }
      : undefined),
  },
  {
    id: 'risk-never-assessed',
    urgency: 'unassessed',
    rule: 'risk oversight has never been run',
    pageTarget: 'risk',
    evaluate: input => (input.risk && !input.risk.assessed
      ? {
        label: 'Risk never assessed',
        detail: 'Ethics, legal and commercial exposure has never been reviewed. Unclaimed rather than clean.',
      }
      : undefined),
  },
  {
    id: 'debt-never-scanned',
    urgency: 'unassessed',
    rule: 'the tech-debt register has never been scanned',
    pageTarget: 'debt',
    evaluate: input => (input.debt && !input.debt.scanned
      ? {
        label: 'Debt never scanned',
        detail: 'An empty register means nothing was found or nothing was scanned. Here it is the second.',
      }
      : undefined),
  },
];

/** How many items are shown before the remainder is summarised. */
export const ATTENTION_VISIBLE_CAP = 6;

export interface AttentionFeed {
  items: AttentionItem[];
  /** Everything that qualified, before the cap. */
  totalCount: number;
  /** Qualifying items not shown, so truncation is never silent. */
  droppedByCap: number;
  counts: Record<AttentionUrgency, number>;
  /**
   * What to say when nothing qualifies.
   *
   * `clear` and `unexamined` are different claims and must not collapse: one
   * says the checks ran and passed, the other says there was almost nothing to
   * check. A dashboard that reports the second as the first is congratulating
   * you for not looking.
   */
  emptyState?: 'clear' | 'unexamined';
  /**
   * The one-line headline, computed here rather than by each surface.
   *
   * Carried on the feed because two renderings phrasing the same counts their
   * own way is how "3 unassessed" becomes "all clear" on one screen and not the
   * other. The distinction between clear and unexamined is the whole point of
   * this module and it must survive every retelling.
   */
  summary: string;
}

/**
 * Build the feed.
 *
 * Rules are evaluated in declaration order and the result keeps it, so ranking
 * is the published editorial order rather than anything derived from counts.
 */
export function buildAttentionFeed(input: AttentionInput): AttentionFeed {
  const all: AttentionItem[] = [];
  for (const rule of RULES) {
    const hit = rule.evaluate(input);
    if (hit) {
      all.push({
        id: rule.id,
        urgency: rule.urgency,
        pageTarget: rule.pageTarget,
        rule: rule.rule,
        label: hit.label,
        detail: hit.detail,
        ...(hit.count === undefined ? {} : { count: hit.count }),
      });
    }
  }

  const counts: Record<AttentionUrgency, number> = { now: 0, soon: 0, unassessed: 0 };
  for (const item of all) {
    counts[item.urgency] += 1;
  }

  const items = all.slice(0, ATTENTION_VISIBLE_CAP);
  const feed: Omit<AttentionFeed, 'summary'> = {
    items,
    totalCount: all.length,
    droppedByCap: all.length - items.length,
    counts,
  };

  if (all.length === 0) {
    // How much was actually assessable decides which of the two things we may
    // claim. Counting the groups the caller supplied is the only honest measure
    // available: an absent group was never looked at.
    const assessed = [
      input.testing, input.pipeline, input.issues, input.ssot, input.director,
      input.documents, input.risk, input.debt, input.release, input.delivery, input.workflow,
    ].filter(group => group !== undefined).length;
    feed.emptyState = assessed >= 4 ? 'clear' : 'unexamined';
  }

  return { ...feed, summary: summarizeAttention(feed) };
}

/** The one-line headline, for a collapsed or narrow rendering. */
export function summarizeAttention(feed: Omit<AttentionFeed, 'summary'>): string {
  if (feed.totalCount === 0) {
    return feed.emptyState === 'clear'
      ? 'Nothing needs you right now.'
      : 'Too little has been assessed to say whether anything needs you.';
  }
  const parts: string[] = [];
  if (feed.counts.now > 0) {
    parts.push(`${feed.counts.now} needing attention now`);
  }
  if (feed.counts.soon > 0) {
    parts.push(`${feed.counts.soon} soon`);
  }
  if (feed.counts.unassessed > 0) {
    parts.push(`${feed.counts.unassessed} unassessed`);
  }
  return parts.join(', ');
}
