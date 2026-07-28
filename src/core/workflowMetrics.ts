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
