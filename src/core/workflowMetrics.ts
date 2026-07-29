/**
 * Every statistic the Workflow dashboard shows, derived purely.
 *
 * The module exists so the numbers can be tested against fixtures rather than
 * inspected by eye in a webview. Nothing here performs I/O, imports `vscode`,
 * or reads a clock — `now` is always a parameter, so a metric over a time
 * window is reproducible in a test.
 *
 * One idea does most of the work here: {@link MetricVerdict}. A metric is
 * either *known* or it is *not*, and "not known" carries a reason. This exists
 * because the most damaging thing a delivery dashboard can do is render a
 * confident zero for something it never measured. A test suite that did not run
 * is not a test suite that passed; a repository with no merged pull requests has
 * no median review latency, and displaying "0 hours" would be a lie that looks
 * like an achievement. Making the absence a *type* rather than a convention
 * means a renderer cannot forget to handle it.
 *
 * Output shapes match the dashboard's existing render primitives — series for
 * `renderChartCard`, slices for `renderDonutChart`, segments for
 * `renderDistributionBar`, values for `renderMetricPill` — so the wall is
 * assembled from components that already exist rather than a new vocabulary.
 */

// ── Core primitives ──────────────────────────────────────────────────────────

/**
 * A measured value, or an honest account of why there isn't one.
 *
 * `reason` is shown to the user, so it says what is missing and — where
 * applicable — what would produce it.
 */
export type MetricVerdict<T> =
  | { known: true; value: T }
  | { known: false; reason: string; fixHint?: string };

export function known<T>(value: T): MetricVerdict<T> {
  return { known: true, value };
}

export function unknown<T>(reason: string, fixHint?: string): MetricVerdict<T> {
  return fixHint === undefined ? { known: false, reason } : { known: false, reason, fixHint };
}

/** A point on a time-series chart. Matches `renderChartCard`'s series shape. */
export interface MetricSeriesPoint {
  label: string;
  value: number;
}

/** A slice of a donut. Matches `renderDonutChart`. */
export interface MetricSlice {
  label: string;
  value: number;
}

/** A segment of a distribution bar. Matches `renderDistributionBar`. */
export interface MetricSegment {
  key: string;
  label: string;
  value: number;
  tone?: 'good' | 'warn' | 'critical' | 'accent';
}

export type MetricTone = 'good' | 'warn' | 'critical' | 'neutral';

/** A headline number. Matches `renderMetricPill`. */
export interface MetricValue {
  label: string;
  value: string;
  detail?: string;
  tone?: MetricTone;
}

/**
 * Below this many samples, a median is noise dressed as insight.
 *
 * Three is deliberately low — it is enough to be a median at all — but it stops
 * a single merged pull request from being reported as "median time to merge",
 * which reads as a stable characteristic of the project rather than one data
 * point.
 */
export const MIN_SAMPLES_FOR_MEDIAN = 3;

/** Issues untouched for this long are surfaced as stale. Matches the issue tracker. */
export const STALE_DAYS = 30;

/** Branches untouched for this long are surfaced as stale. */
export const STALE_BRANCH_DAYS = 60;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ── Small pure helpers ───────────────────────────────────────────────────────

/** Parse an ISO timestamp, or `undefined`. Never throws, never returns NaN. */
export function parseTimestamp(value: string | undefined | null): number | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function daysBetween(fromMs: number, toMs: number): number {
  return Math.floor((toMs - fromMs) / MS_PER_DAY);
}

/**
 * The median, with a declared tie rule.
 *
 * Even-length inputs take the mean of the two central values. Stated rather
 * than left to the reader because "the median" is ambiguous for even samples
 * and a metric whose definition is ambiguous cannot be compared over time.
 */
export function median(values: readonly number[]): MetricVerdict<number> {
  const usable = values.filter(value => Number.isFinite(value));
  if (usable.length < MIN_SAMPLES_FOR_MEDIAN) {
    return unknown(
      `Not enough data — ${usable.length} of ${MIN_SAMPLES_FOR_MEDIAN} samples needed.`,
    );
  }
  const sorted = [...usable].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
  return known(value);
}

/**
 * Count timestamps into one bucket per day, oldest first.
 *
 * Produces a point for *every* day in the window including empty ones, because
 * a chart that omits quiet days compresses time and makes a gap look like
 * activity.
 */
export function bucketByDay(
  timestamps: readonly number[],
  days: number,
  now: number,
): MetricSeriesPoint[] {
  const span = Math.max(1, Math.floor(days));
  const buckets = new Array<number>(span).fill(0);
  for (const timestamp of timestamps) {
    const age = daysBetween(timestamp, now);
    if (age >= 0 && age < span) {
      buckets[span - 1 - age] = (buckets[span - 1 - age] ?? 0) + 1;
    }
  }
  return buckets.map((value, index) => {
    const dayMs = now - (span - 1 - index) * MS_PER_DAY;
    return { label: new Date(dayMs).toISOString().slice(0, 10), value };
  });
}

/** A percentage, rounded, clamped, and safe when the denominator is zero. */
export function percentage(part: number, whole: number): MetricVerdict<number> {
  if (!Number.isFinite(whole) || whole <= 0) {
    return unknown('Nothing to measure yet.');
  }
  return known(Math.max(0, Math.min(100, Math.round((part / whole) * 100))));
}

/** Hours, to one decimal, for durations that are usually sub-day. */
export function formatHours(ms: number): string {
  const hours = ms / (60 * 60 * 1000);
  if (hours < 1) {
    return `${Math.round(hours * 60)}m`;
  }
  if (hours < 48) {
    return `${hours.toFixed(1)}h`;
  }
  return `${(hours / 24).toFixed(1)}d`;
}

/**
 * Count occurrences, largest first, with a stable tie-break on the key.
 *
 * The tie-break matters: without it two labels with equal counts can swap
 * position between renders, which reads as data changing when nothing did.
 */
export function tally(values: readonly string[], limit = 12): MetricSlice[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, Math.max(1, limit))
    .map(([label, value]) => ({ label, value }));
}

// ── Issues ───────────────────────────────────────────────────────────────────

/** The shape this module needs from an issue. Structural, so callers can pass more. */
export interface MetricIssueInput {
  number: number;
  state: string;
  labels?: readonly string[];
  assignees?: readonly string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface IssueMetrics {
  open: number;
  closed: number;
  unassigned: number;
  stale: number;
  byLabel: MetricSlice[];
  byAssignee: MetricSlice[];
  /** Open-issue age, bucketed. Ageing is the signal; the total is not. */
  ageDistribution: MetricSegment[];
  medianOpenAgeDays: MetricVerdict<number>;
}

export function deriveIssueMetrics(
  issues: readonly MetricIssueInput[],
  now: number,
): IssueMetrics {
  const open = issues.filter(issue => issue.state.toLowerCase() === 'open');
  const closed = issues.length - open.length;

  const ages: number[] = [];
  let stale = 0;
  let unassigned = 0;
  const buckets = { fresh: 0, week: 0, month: 0, quarter: 0, older: 0 };

  for (const issue of open) {
    if ((issue.assignees ?? []).length === 0) {
      unassigned += 1;
    }
    const updated = parseTimestamp(issue.updatedAt);
    if (updated !== undefined && daysBetween(updated, now) > STALE_DAYS) {
      stale += 1;
    }
    const created = parseTimestamp(issue.createdAt);
    if (created !== undefined) {
      const age = daysBetween(created, now);
      ages.push(age);
      if (age <= 1) {
        buckets.fresh += 1;
      } else if (age <= 7) {
        buckets.week += 1;
      } else if (age <= 30) {
        buckets.month += 1;
      } else if (age <= 90) {
        buckets.quarter += 1;
      } else {
        buckets.older += 1;
      }
    }
  }

  return {
    open: open.length,
    closed,
    unassigned,
    stale,
    byLabel: tally(open.flatMap(issue => [...(issue.labels ?? [])])),
    byAssignee: tally(open.flatMap(issue => [...(issue.assignees ?? [])])),
    ageDistribution: [
      { key: 'fresh', label: 'Today', value: buckets.fresh, tone: 'good' },
      { key: 'week', label: 'This week', value: buckets.week, tone: 'good' },
      { key: 'month', label: 'This month', value: buckets.month, tone: 'accent' },
      { key: 'quarter', label: 'Over a month', value: buckets.quarter, tone: 'warn' },
      { key: 'older', label: 'Over a quarter', value: buckets.older, tone: 'critical' },
    ],
    medianOpenAgeDays: median(ages),
  };
}

// ── Branches ─────────────────────────────────────────────────────────────────

export interface MetricBranchInput {
  name: string;
  lastCommitAt?: string;
  merged?: boolean;
  ahead?: number;
  behind?: number;
}

export interface BranchMetrics {
  total: number;
  stale: number;
  merged: number;
  /** Branches whose name does not match the declared convention. */
  nonConforming: string[];
  conformanceRate: MetricVerdict<number>;
  ageDistribution: MetricSegment[];
}

/**
 * The default convention: `<type>/<issue>-<slug>`.
 *
 * Permissive on the slug and strict on the shape, because the shape is what
 * makes a branch list filterable and the slug is where judgement lives.
 */
export const DEFAULT_BRANCH_PATTERN = /^(feat|fix|chore|docs|refactor|test|perf)\/\d+-[a-z0-9]+(-[a-z0-9]+)*$/;

export function deriveBranchMetrics(
  branches: readonly MetricBranchInput[],
  now: number,
  options: { pattern?: RegExp; exempt?: readonly string[] } = {},
): BranchMetrics {
  const pattern = options.pattern ?? DEFAULT_BRANCH_PATTERN;
  // The integration and release branches are not feature branches and must
  // never be reported as convention violations — doing so would produce a
  // permanent, unfixable gap, which teaches people to ignore gaps.
  const exempt = new Set(options.exempt ?? ['main', 'master', 'develop', 'production', 'staging']);

  let stale = 0;
  let merged = 0;
  const nonConforming: string[] = [];
  const buckets = { active: 0, week: 0, month: 0, older: 0 };

  for (const branch of branches) {
    if (branch.merged) {
      merged += 1;
    }
    if (!exempt.has(branch.name) && !pattern.test(branch.name)) {
      nonConforming.push(branch.name);
    }
    const last = parseTimestamp(branch.lastCommitAt);
    if (last !== undefined) {
      const age = daysBetween(last, now);
      if (age > STALE_BRANCH_DAYS) {
        stale += 1;
      }
      if (age <= 1) {
        buckets.active += 1;
      } else if (age <= 7) {
        buckets.week += 1;
      } else if (age <= 30) {
        buckets.month += 1;
      } else {
        buckets.older += 1;
      }
    }
  }

  const considered = branches.filter(branch => !exempt.has(branch.name)).length;

  return {
    total: branches.length,
    stale,
    merged,
    nonConforming: nonConforming.sort((a, b) => a.localeCompare(b)),
    conformanceRate: percentage(considered - nonConforming.length, considered),
    ageDistribution: [
      { key: 'active', label: 'Active today', value: buckets.active, tone: 'good' },
      { key: 'week', label: 'This week', value: buckets.week, tone: 'good' },
      { key: 'month', label: 'This month', value: buckets.month, tone: 'accent' },
      { key: 'older', label: 'Over a month', value: buckets.older, tone: 'warn' },
    ],
  };
}

// ── CI ───────────────────────────────────────────────────────────────────────

export interface MetricCheckRunInput {
  name: string;
  status?: string;
  conclusion?: string | null;
  startedAt?: string;
  completedAt?: string;
}

export type CiState = 'pass' | 'fail' | 'pending' | 'none';

export interface CiMetrics {
  state: CiState;
  passing: number;
  failing: number;
  pending: number;
  byCheck: MetricSegment[];
  passRate: MetricVerdict<number>;
  medianDurationMs: MetricVerdict<number>;
  failingCheckNames: string[];
}

/**
 * Worst state wins.
 *
 * A run with one failure and nine passes is a failing run. Reporting "90%
 * green" for a commit that cannot merge would be true and useless.
 */
export function deriveCiMetrics(runs: readonly MetricCheckRunInput[]): CiMetrics {
  if (runs.length === 0) {
    return {
      state: 'none',
      passing: 0,
      failing: 0,
      pending: 0,
      byCheck: [],
      passRate: unknown(
        'No check runs found for this commit.',
        'Add a CI workflow so changes are verified before they merge.',
      ),
      medianDurationMs: unknown('No check runs found for this commit.'),
      failingCheckNames: [],
    };
  }

  let passing = 0;
  let failing = 0;
  let pending = 0;
  const failingCheckNames: string[] = [];
  const durations: number[] = [];

  for (const run of runs) {
    const conclusion = (run.conclusion ?? '').toLowerCase();
    const status = (run.status ?? '').toLowerCase();

    if (status && status !== 'completed') {
      pending += 1;
    } else if (conclusion === 'success' || conclusion === 'neutral' || conclusion === 'skipped') {
      passing += 1;
    } else if (conclusion === '') {
      pending += 1;
    } else {
      failing += 1;
      failingCheckNames.push(run.name);
    }

    const started = parseTimestamp(run.startedAt);
    const completed = parseTimestamp(run.completedAt);
    if (started !== undefined && completed !== undefined && completed >= started) {
      durations.push(completed - started);
    }
  }

  const state: CiState = failing > 0 ? 'fail' : pending > 0 ? 'pending' : 'pass';

  return {
    state,
    passing,
    failing,
    pending,
    byCheck: [
      { key: 'pass', label: 'Passing', value: passing, tone: 'good' },
      { key: 'pending', label: 'Running', value: pending, tone: 'accent' },
      { key: 'fail', label: 'Failing', value: failing, tone: 'critical' },
    ],
    passRate: percentage(passing, passing + failing),
    medianDurationMs: median(durations),
    failingCheckNames: failingCheckNames.sort((a, b) => a.localeCompare(b)),
  };
}

// ── Pull requests ────────────────────────────────────────────────────────────

/** The shape this module needs from a pull request. Structural, so callers pass more. */
export interface MetricPullRequestInput {
  number: number;
  state: string;
  createdAt?: string;
  updatedAt?: string;
  mergedAt?: string;
  additions?: number;
  deletions?: number;
  reviews?: readonly { verdict: string; submittedAt?: string }[];
  linkedIssues?: readonly number[];
}

export interface PullRequestMetrics {
  open: number;
  merged: number;
  draft: number;
  awaitingReview: number;
  /** Merged pull requests per day, for the throughput chart. */
  throughput: MetricSeriesPoint[];
  /** Author push → first submitted review. The review-latency signal. */
  medianTimeToFirstReviewMs: MetricVerdict<number>;
  /** Open → merged. Includes review time, so read it alongside the above. */
  medianTimeToMergeMs: MetricVerdict<number>;
  /** Lines changed, bucketed. Review quality falls off a cliff with size. */
  sizeDistribution: MetricSegment[];
  medianSize: MetricVerdict<number>;
  /** Share of merged pull requests that closed an issue. */
  linkedRate: MetricVerdict<number>;
}

/**
 * Size buckets.
 *
 * The boundaries are declared rather than computed from the data, so the same
 * pull request lands in the same bucket this month as last — a distribution
 * whose buckets move cannot be compared with itself.
 */
const SIZE_BUCKETS: readonly { key: string; label: string; max: number; tone: MetricSegment['tone'] }[] = [
  { key: 'xs', label: '< 10 lines', max: 10, tone: 'good' },
  { key: 's', label: '10–99', max: 100, tone: 'good' },
  { key: 'm', label: '100–399', max: 400, tone: 'accent' },
  { key: 'l', label: '400–999', max: 1000, tone: 'warn' },
  { key: 'xl', label: '1000+', max: Number.POSITIVE_INFINITY, tone: 'critical' },
];

export function derivePullRequestMetrics(
  pullRequests: readonly MetricPullRequestInput[],
  now: number,
  windowDays = 30,
): PullRequestMetrics {
  const open: MetricPullRequestInput[] = [];
  const merged: MetricPullRequestInput[] = [];
  let draft = 0;
  let awaitingReview = 0;

  for (const pr of pullRequests) {
    const state = pr.state.toLowerCase();
    if (state === 'merged') {
      merged.push(pr);
    } else if (state === 'open' || state === 'draft') {
      open.push(pr);
      if (state === 'draft') {
        draft += 1;
      }
      const substantive = (pr.reviews ?? []).filter(review => review.verdict !== 'pending');
      if (substantive.length === 0) {
        awaitingReview += 1;
      }
    }
  }

  const timeToFirstReview: number[] = [];
  const timeToMerge: number[] = [];
  const sizes: number[] = [];
  const buckets = new Map<string, number>(SIZE_BUCKETS.map(bucket => [bucket.key, 0]));
  let linked = 0;

  // Size and linkage are measured over *merged* pull requests: an open one is
  // still growing, so counting it would report a distribution of unfinished work.
  for (const pr of merged) {
    const created = parseTimestamp(pr.createdAt);
    const mergedAt = parseTimestamp(pr.mergedAt);
    if (created !== undefined && mergedAt !== undefined && mergedAt >= created) {
      timeToMerge.push(mergedAt - created);
    }

    const firstReview = (pr.reviews ?? [])
      .filter(review => review.verdict !== 'pending')
      .map(review => parseTimestamp(review.submittedAt))
      .filter((value): value is number => value !== undefined)
      .sort((a, b) => a - b)[0];
    if (created !== undefined && firstReview !== undefined && firstReview >= created) {
      timeToFirstReview.push(firstReview - created);
    }

    const size = Math.max(0, (pr.additions ?? 0) + (pr.deletions ?? 0));
    sizes.push(size);
    const bucket = SIZE_BUCKETS.find(candidate => size < candidate.max) ?? SIZE_BUCKETS.at(-1)!;
    buckets.set(bucket.key, (buckets.get(bucket.key) ?? 0) + 1);

    if ((pr.linkedIssues ?? []).length > 0) {
      linked += 1;
    }
  }

  return {
    open: open.length,
    merged: merged.length,
    draft,
    awaitingReview,
    throughput: bucketByDay(
      merged.map(pr => parseTimestamp(pr.mergedAt)).filter((v): v is number => v !== undefined),
      windowDays,
      now,
    ),
    medianTimeToFirstReviewMs: median(timeToFirstReview),
    medianTimeToMergeMs: median(timeToMerge),
    sizeDistribution: SIZE_BUCKETS.map(bucket => ({
      key: bucket.key,
      label: bucket.label,
      value: buckets.get(bucket.key) ?? 0,
      ...(bucket.tone === undefined ? {} : { tone: bucket.tone }),
    })),
    medianSize: median(sizes),
    linkedRate: percentage(linked, merged.length),
  };
}

// ── Commits and release ──────────────────────────────────────────────────────

/**
 * Conventional-commit conformance.
 *
 * Worth measuring because the version bump and the changelog are *derived* from
 * these prefixes. A project at 40% conformance cannot trust its own automated
 * bump, and the number explains why far better than a surprised maintainer will.
 */
export const CONVENTIONAL_COMMIT_PATTERN =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]*\))?!?:\s.+/;

export interface CommitConformance {
  total: number;
  conforming: number;
  rate: MetricVerdict<number>;
  byType: MetricSlice[];
  examples: string[];
}

export function deriveCommitConformance(subjects: readonly string[]): CommitConformance {
  const usable = subjects.filter(subject => typeof subject === 'string' && subject.trim().length > 0);
  const conformingSubjects: string[] = [];
  const nonConforming: string[] = [];
  const types: string[] = [];

  for (const subject of usable) {
    const trimmed = subject.trim();
    // A merge commit is generated by the platform, not authored, so counting it
    // as a violation would penalise a team for using squash merges.
    if (/^Merge (branch|pull request|remote-tracking)/i.test(trimmed)) {
      continue;
    }
    const match = CONVENTIONAL_COMMIT_PATTERN.exec(trimmed);
    if (match) {
      conformingSubjects.push(trimmed);
      types.push(match[1] ?? 'other');
    } else {
      nonConforming.push(trimmed.slice(0, 80));
    }
  }

  const counted = conformingSubjects.length + nonConforming.length;

  return {
    total: counted,
    conforming: conformingSubjects.length,
    rate: percentage(conformingSubjects.length, counted),
    byType: tally(types),
    examples: nonConforming.slice(0, 5),
  };
}

export interface ReleaseMetrics {
  version?: string;
  commitsSinceTag: number;
  changelogCurrent: boolean;
  /** Set when the manifest version has no changelog section — a release blocker. */
  drift?: string;
  conformance: CommitConformance;
}

export function deriveReleaseMetrics(input: {
  version?: string;
  changelogVersions?: readonly string[];
  commitsSinceTag?: number;
  commitSubjects?: readonly string[];
}): ReleaseMetrics {
  const version = input.version;
  const changelogVersions = input.changelogVersions ?? [];
  const changelogCurrent = version !== undefined && changelogVersions.includes(version);

  return {
    ...(version === undefined ? {} : { version }),
    commitsSinceTag: Math.max(0, Math.floor(input.commitsSinceTag ?? 0)),
    changelogCurrent,
    ...(version !== undefined && !changelogCurrent
      ? { drift: `\`CHANGELOG.md\` has no entry for ${version}.` }
      : {}),
    conformance: deriveCommitConformance(input.commitSubjects ?? []),
  };
}

// ── Delivery performance (DORA) ──────────────────────────────────────────────

/**
 * The four keys, and why they are worth the trouble.
 *
 * Deployment frequency, lead time for change, change failure rate and time to
 * restore are the standard professional framing for delivery performance, which
 * makes them the right thing to *teach* as well as to measure. They are also
 * unusually honest as metrics go: two describe speed and two describe stability,
 * so a team cannot improve the pair it likes by quietly ruining the other.
 *
 * Every derivation below is pure over data the dashboard already fetched, and
 * every one of them declares its window and its inclusion rule on the card. A
 * delivery metric whose definition is implicit cannot be compared with last
 * month's, which defeats the point of measuring it.
 */

/** One published release, as `gh release list --json` reports it. */
export interface MetricReleaseInput {
  tagName: string;
  publishedAt?: string;
  isPrerelease?: boolean;
  isDraft?: boolean;
}

/** Default window. Long enough for a monthly cadence to register at all. */
export const DORA_WINDOW_DAYS = 90;

/**
 * The declared change-failure rule.
 *
 * A change failure is *supposed* to mean "a deployment that required remediation",
 * which no repository records directly. Everything measurable is a proxy, so the
 * proxy is declared in one place, shown on the card, and applied literally —
 * rather than inferred per-run by something that might reason differently twice.
 *
 * Deliberately narrow. A wider rule ("any patch release") would count ordinary
 * incremental releases as failures, and a metric that fires on normal work
 * teaches people to ignore it.
 */
export const CHANGE_FAILURE_WINDOW_HOURS = 48;
export const DECLARED_CHANGE_FAILURE_RULE =
  `A release counts as a failure when a patch release follows it within ${CHANGE_FAILURE_WINDOW_HOURS} hours. ` +
  'That is a proxy — no repository records "this deployment needed remediation" — but it is applied literally ' +
  'and identically every time, so the number can be compared with last month\'s.';

export type DoraKey = 'deploymentFrequency' | 'leadTime' | 'changeFailureRate' | 'timeToRestore';
export type DoraBand = 'elite' | 'high' | 'medium' | 'low';

/**
 * Orientation bands.
 *
 * These are the widely cited thresholds, not a certification: the exact
 * boundaries have moved between annual industry reports, and a team's own trend
 * matters far more than which side of a line it sits on. The numbers are here so
 * they are reviewable in a diff rather than invented at render time.
 */
export const DORA_BANDS: Record<DoraKey, { elite: number; high: number; medium: number; better: 'higher' | 'lower' }> = {
  // Deployments per week.
  deploymentFrequency: { elite: 7, high: 1, medium: 0.25, better: 'higher' },
  // Hours from merge to the release that carries it.
  leadTime: { elite: 24, high: 24 * 7, medium: 24 * 30, better: 'lower' },
  // Percent of releases followed by a remediating release.
  changeFailureRate: { elite: 5, high: 15, medium: 30, better: 'lower' },
  // Hours from the failing release to the one that fixed it.
  timeToRestore: { elite: 1, high: 24, medium: 24 * 7, better: 'lower' },
};

export function classifyDoraBand(key: DoraKey, value: number): DoraBand {
  const band = DORA_BANDS[key];
  if (band.better === 'higher') {
    if (value >= band.elite) { return 'elite'; }
    if (value >= band.high) { return 'high'; }
    if (value >= band.medium) { return 'medium'; }
    return 'low';
  }
  if (value <= band.elite) { return 'elite'; }
  if (value <= band.high) { return 'high'; }
  if (value <= band.medium) { return 'medium'; }
  return 'low';
}

export interface DoraFailure {
  tag: string;
  followedBy: string;
  hoursToRestore: number;
}

export interface DoraMetrics {
  /** Releases per week across the window. */
  deploymentFrequency: MetricVerdict<number>;
  /** Median hours from a pull request merging to the release that carried it. */
  leadTimeHours: MetricVerdict<number>;
  /** Percent of releases meeting the declared failure rule. */
  changeFailureRate: MetricVerdict<number>;
  /** Median hours from a failing release to its remediating release. */
  timeToRestoreHours: MetricVerdict<number>;
  bands: Partial<Record<DoraKey, DoraBand>>;
  windowDays: number;
  releasesInWindow: number;
  /** Every release the rule counted, named — so the number can be argued with. */
  failures: DoraFailure[];
  /** Releases per day, for the frequency chart. */
  series: MetricSeriesPoint[];
}

/**
 * Derive the four keys from releases and merged pull requests.
 *
 * Lead time is measured merge → release rather than first-commit → release. Both
 * are defensible; this one is chosen because it is the half a team can actually
 * act on (how long finished work waits to ship) and because the other half
 * depends on branch history that squash-merging destroys. The card states which
 * is used, so nobody compares it against a differently-defined number.
 */
export function deriveDoraMetrics(input: {
  releases: readonly MetricReleaseInput[];
  pullRequests?: readonly MetricPullRequestInput[];
  now: number;
  windowDays?: number;
}): DoraMetrics {
  const windowDays = Math.max(1, Math.floor(input.windowDays ?? DORA_WINDOW_DAYS));
  const cutoff = input.now - windowDays * MS_PER_DAY;

  // Drafts and pre-releases are excluded: neither is a deployment to anybody.
  const published = input.releases
    .filter(release => !release.isDraft && !release.isPrerelease)
    .map(release => ({ tag: release.tagName, at: parseTimestamp(release.publishedAt) }))
    .filter((release): release is { tag: string; at: number } => release.at !== undefined)
    .sort((a, b) => a.at - b.at);

  const inWindow = published.filter(release => release.at >= cutoff);

  const frequency = inWindow.length === 0
    ? unknown<number>(
      'No published releases in the window.',
      'Publish a release, or widen the window, before reading a cadence.',
    )
    : known(Number(((inWindow.length / windowDays) * 7).toFixed(2)));

  // Lead time: for each merged pull request, the first release published after
  // it. A pull request merged after the last release has not shipped yet and is
  // excluded rather than counted as infinitely slow.
  const merges = (input.pullRequests ?? [])
    .map(pr => parseTimestamp(pr.mergedAt))
    .filter((at): at is number => at !== undefined && at >= cutoff)
    .sort((a, b) => a - b);

  const leadSamples: number[] = [];
  for (const mergedAt of merges) {
    const shipped = published.find(release => release.at >= mergedAt);
    if (shipped) {
      leadSamples.push((shipped.at - mergedAt) / (60 * 60 * 1000));
    }
  }
  const leadTimeHours = merges.length === 0
    ? unknown<number>(
      'No merged pull requests in the window.',
      'Lead time is measured from merge to the release that carried it.',
    )
    : leadSamples.length === 0
      ? unknown<number>(
        'Every merge in the window is still unreleased.',
        'That is itself the answer: finished work is waiting. Publish a release to measure how long.',
      )
      : median(leadSamples);

  // Change failures, by the declared rule and nothing else.
  const failures: DoraFailure[] = [];
  for (let index = 0; index < published.length - 1; index += 1) {
    const current = published[index]!;
    const next = published[index + 1]!;
    if (current.at < cutoff) {
      continue;
    }
    const hours = (next.at - current.at) / (60 * 60 * 1000);
    if (hours > CHANGE_FAILURE_WINDOW_HOURS) {
      continue;
    }
    if (!isPatchSuccessor(current.tag, next.tag)) {
      continue;
    }
    failures.push({ tag: current.tag, followedBy: next.tag, hoursToRestore: Number(hours.toFixed(2)) });
  }

  const changeFailureRate = inWindow.length === 0
    ? unknown<number>('No published releases in the window.')
    : percentage(failures.length, inWindow.length);

  const timeToRestoreHours = failures.length === 0
    ? unknown<number>(
      inWindow.length === 0
        ? 'No published releases in the window.'
        : 'No release in the window met the failure rule — there was nothing to restore from.',
    )
    : median(failures.map(failure => failure.hoursToRestore));

  const bands: Partial<Record<DoraKey, DoraBand>> = {};
  if (frequency.known) { bands.deploymentFrequency = classifyDoraBand('deploymentFrequency', frequency.value); }
  if (leadTimeHours.known) { bands.leadTime = classifyDoraBand('leadTime', leadTimeHours.value); }
  if (changeFailureRate.known) { bands.changeFailureRate = classifyDoraBand('changeFailureRate', changeFailureRate.value); }
  if (timeToRestoreHours.known) { bands.timeToRestore = classifyDoraBand('timeToRestore', timeToRestoreHours.value); }

  return {
    deploymentFrequency: frequency,
    leadTimeHours,
    changeFailureRate,
    timeToRestoreHours,
    bands,
    windowDays,
    releasesInWindow: inWindow.length,
    failures,
    series: bucketByDay(inWindow.map(release => release.at), Math.min(windowDays, 90), input.now),
  };
}

/**
 * Whether `next` is the patch successor of `current` — the second half of the
 * declared failure rule.
 *
 * Requires the same major and minor with a higher patch. A minor or major
 * release within the window is a *planned* follow-up, not a remediation, and
 * counting it would make an active release day look like an outage.
 */
export function isPatchSuccessor(current: string, next: string): boolean {
  const parse = (tag: string): [number, number, number] | undefined => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(tag.trim());
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
  };
  const a = parse(current);
  const b = parse(next);
  if (!a || !b) {
    return false;
  }
  return a[0] === b[0] && a[1] === b[1] && b[2] > a[2];
}

// ── Overall health ───────────────────────────────────────────────────────────

export interface HealthComponent {
  key: string;
  label: string;
  /** 0–100, or absent when it could not be measured. */
  score: MetricVerdict<number>;
  weight: number;
}

export interface WorkflowHealth {
  /** Absent when nothing at all could be measured. */
  score: MetricVerdict<number>;
  components: HealthComponent[];
  /** Components excluded from the score because they had no verdict. */
  omitted: string[];
}

/**
 * A weighted health score over whatever could actually be measured.
 *
 * Unmeasured components are **omitted and their weight redistributed**, never
 * scored as zero. Scoring an unmeasured component as zero would mean a project
 * that has not yet connected GitHub looks catastrophically unhealthy, which is
 * both false and discouraging at exactly the wrong moment. The omissions are
 * returned so the surface can say which parts of the score are missing.
 */
export function deriveWorkflowHealth(components: readonly HealthComponent[]): WorkflowHealth {
  const measured = components.filter(component => component.score.known);
  const omitted = components
    .filter(component => !component.score.known)
    .map(component => component.label);

  if (measured.length === 0) {
    return {
      score: unknown('Nothing measurable yet — connect a repository to begin.'),
      components: [...components],
      omitted,
    };
  }

  const totalWeight = measured.reduce((sum, component) => sum + Math.max(0, component.weight), 0);
  if (totalWeight <= 0) {
    return {
      score: unknown('No weighted components available.'),
      components: [...components],
      omitted,
    };
  }

  const weighted = measured.reduce((sum, component) => {
    const value = component.score.known ? component.score.value : 0;
    return sum + value * Math.max(0, component.weight);
  }, 0);

  return {
    score: known(Math.round(weighted / totalWeight)),
    components: [...components],
    omitted,
  };
}

/** Tone for a 0–100 score, using one threshold pair everywhere. */
export function scoreTone(score: number): MetricTone {
  if (score >= 80) {
    return 'good';
  }
  if (score >= 50) {
    return 'warn';
  }
  return 'critical';
}

/** Render a verdict for display without the caller re-deciding the wording. */
export function formatVerdict(
  verdict: MetricVerdict<number>,
  format: (value: number) => string,
): { text: string; known: boolean; detail?: string } {
  if (verdict.known) {
    return { text: format(verdict.value), known: true };
  }
  return {
    text: '—',
    known: false,
    ...(verdict.fixHint === undefined
      ? { detail: verdict.reason }
      : { detail: `${verdict.reason} ${verdict.fixHint}` }),
  };
}
