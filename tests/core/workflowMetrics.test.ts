import { describe, expect, it } from 'vitest';
import {
  CONVENTIONAL_COMMIT_PATTERN,
  DEFAULT_BRANCH_PATTERN,
  MIN_SAMPLES_FOR_MEDIAN,
  bucketByDay,
  daysBetween,
  deriveBranchMetrics,
  deriveCiMetrics,
  deriveCommitConformance,
  deriveIssueMetrics,
  derivePullRequestMetrics,
  deriveReleaseMetrics,
  deriveWorkflowHealth,
  formatHours,
  formatVerdict,
  known,
  median,
  parseTimestamp,
  percentage,
  scoreTone,
  tally,
  unknown,
  type HealthComponent,
} from '../../src/core/workflowMetrics.ts';

/** A fixed clock. Every windowed metric takes `now` so tests are reproducible. */
const NOW = Date.parse('2026-07-28T12:00:00.000Z');
const daysAgo = (n: number): string => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

describe('parseTimestamp', () => {
  it('returns undefined rather than NaN for anything unusable', () => {
    expect(parseTimestamp(undefined)).toBeUndefined();
    expect(parseTimestamp('')).toBeUndefined();
    expect(parseTimestamp('not a date')).toBeUndefined();
    expect(parseTimestamp(null)).toBeUndefined();
  });

  it('parses ISO timestamps', () => {
    expect(parseTimestamp('2026-07-28T12:00:00.000Z')).toBe(NOW);
  });
});

describe('median — the not-enough-data rule', () => {
  it('refuses to report a median below the sample floor', () => {
    // One merged pull request is not a "median time to merge". Reporting it as
    // one reads as a stable property of the project rather than a single point.
    expect(median([5]).known).toBe(false);
    expect(median([5, 7]).known).toBe(false);
    expect(median([]).known).toBe(false);
    expect(MIN_SAMPLES_FOR_MEDIAN).toBe(3);
  });

  it('says how many samples are still needed', () => {
    const verdict = median([1, 2]);
    expect(verdict.known).toBe(false);
    if (!verdict.known) {
      expect(verdict.reason).toContain('2 of 3');
    }
  });

  it('takes the middle value for odd samples', () => {
    expect(median([3, 1, 2])).toEqual({ known: true, value: 2 });
  });

  it('takes the mean of the two central values for even samples', () => {
    // Declared rather than left ambiguous: a metric whose definition is
    // ambiguous cannot be compared with itself over time.
    expect(median([1, 2, 3, 4])).toEqual({ known: true, value: 2.5 });
  });

  it('ignores non-finite values', () => {
    expect(median([1, 2, 3, Number.NaN, Number.POSITIVE_INFINITY])).toEqual({ known: true, value: 2 });
  });
});

describe('percentage', () => {
  it('has no verdict when the denominator is zero', () => {
    // Never 0% — "nothing to measure" and "measured, and it is zero" are
    // different facts and only one of them is a problem.
    expect(percentage(0, 0).known).toBe(false);
    expect(percentage(5, -1).known).toBe(false);
  });

  it('rounds and clamps', () => {
    expect(percentage(1, 3)).toEqual({ known: true, value: 33 });
    expect(percentage(3, 3)).toEqual({ known: true, value: 100 });
    expect(percentage(5, 3)).toEqual({ known: true, value: 100 });
  });
});

describe('bucketByDay', () => {
  it('emits a point for every day including empty ones', () => {
    // Omitting quiet days compresses time and makes a gap look like activity.
    const series = bucketByDay([NOW, NOW], 7, NOW);
    expect(series).toHaveLength(7);
    expect(series.at(-1)?.value).toBe(2);
    expect(series.slice(0, 6).every(point => point.value === 0)).toBe(true);
  });

  it('drops timestamps outside the window rather than clamping them in', () => {
    const series = bucketByDay([NOW - 40 * 24 * 60 * 60 * 1000], 7, NOW);
    expect(series.reduce((sum, point) => sum + point.value, 0)).toBe(0);
  });

  it('labels points as ISO dates, oldest first', () => {
    const series = bucketByDay([], 3, NOW);
    expect(series.map(point => point.label)).toEqual(['2026-07-26', '2026-07-27', '2026-07-28']);
  });
});

describe('tally', () => {
  it('orders by count then breaks ties on the key', () => {
    // Without the tie-break, equal-count labels swap position between renders,
    // which reads as data changing when nothing did.
    expect(tally(['b', 'a', 'c', 'c'])).toEqual([
      { label: 'c', value: 2 },
      { label: 'a', value: 1 },
      { label: 'b', value: 1 },
    ]);
  });

  it('caps the number of slices', () => {
    expect(tally(['a', 'b', 'c', 'd'], 2)).toHaveLength(2);
  });
});

describe('deriveIssueMetrics', () => {
  const issues = [
    { number: 1, state: 'open', labels: ['bug'], assignees: ['ana'], createdAt: daysAgo(2), updatedAt: daysAgo(1) },
    { number: 2, state: 'open', labels: ['bug', 'ui'], assignees: [], createdAt: daysAgo(45), updatedAt: daysAgo(40) },
    { number: 3, state: 'open', labels: ['docs'], assignees: [], createdAt: daysAgo(100), updatedAt: daysAgo(95) },
    { number: 4, state: 'closed', labels: ['bug'], assignees: ['ana'], createdAt: daysAgo(10), updatedAt: daysAgo(9) },
  ];

  it('counts open, closed, unassigned and stale separately', () => {
    const metrics = deriveIssueMetrics(issues, NOW);
    expect(metrics.open).toBe(3);
    expect(metrics.closed).toBe(1);
    expect(metrics.unassigned).toBe(2);
    expect(metrics.stale).toBe(2);
  });

  it('only counts labels and assignees on open issues', () => {
    // A closed issue's label says what was fixed, not what is outstanding.
    const metrics = deriveIssueMetrics(issues, NOW);
    expect(metrics.byLabel.find(slice => slice.label === 'bug')?.value).toBe(2);
    expect(metrics.byAssignee).toEqual([{ label: 'ana', value: 1 }]);
  });

  it('buckets open-issue age into a fixed distribution', () => {
    const metrics = deriveIssueMetrics(issues, NOW);
    const bucket = (key: string) => metrics.ageDistribution.find(segment => segment.key === key)?.value;
    expect(bucket('week')).toBe(1);
    expect(bucket('quarter')).toBe(1);
    expect(bucket('older')).toBe(1);
  });

  it('has no median age verdict when too few issues are open', () => {
    expect(deriveIssueMetrics([issues[0]!], NOW).medianOpenAgeDays.known).toBe(false);
  });

  it('handles an empty repository without inventing zeroes', () => {
    const metrics = deriveIssueMetrics([], NOW);
    expect(metrics.open).toBe(0);
    expect(metrics.byLabel).toEqual([]);
    expect(metrics.medianOpenAgeDays.known).toBe(false);
  });
});

describe('deriveBranchMetrics', () => {
  const branches = [
    { name: 'main', lastCommitAt: daysAgo(1) },
    { name: 'develop', lastCommitAt: daysAgo(1) },
    { name: 'feat/12-add-thing', lastCommitAt: daysAgo(2) },
    { name: 'fix2', lastCommitAt: daysAgo(90) },
  ];

  it('never reports the integration or release branch as non-conforming', () => {
    // A permanent, unfixable gap teaches people to ignore gaps.
    const metrics = deriveBranchMetrics(branches, NOW);
    expect(metrics.nonConforming).toEqual(['fix2']);
  });

  it('computes conformance over non-exempt branches only', () => {
    const metrics = deriveBranchMetrics(branches, NOW);
    expect(metrics.conformanceRate).toEqual({ known: true, value: 50 });
  });

  it('has no conformance verdict when every branch is exempt', () => {
    const metrics = deriveBranchMetrics([{ name: 'main' }], NOW);
    expect(metrics.conformanceRate.known).toBe(false);
  });

  it('counts stale branches past the threshold', () => {
    expect(deriveBranchMetrics(branches, NOW).stale).toBe(1);
  });

  it('accepts every conventional type and rejects malformed names', () => {
    for (const name of ['feat/1-a', 'fix/22-two-words', 'chore/3-x', 'docs/4-y', 'perf/5-z']) {
      expect(DEFAULT_BRANCH_PATTERN.test(name), name).toBe(true);
    }
    for (const name of ['feat/add-thing', 'feature/1-x', 'feat/1-', 'feat/1-Bad-Case', 'wip']) {
      expect(DEFAULT_BRANCH_PATTERN.test(name), name).toBe(false);
    }
  });
});

describe('deriveCiMetrics — worst state wins', () => {
  it('reports "none" and offers the fix when there are no checks', () => {
    // Not "0% passing" — a commit with no checks has not failed, it has not
    // been checked, and only one of those is fixed by reading a log.
    const metrics = deriveCiMetrics([]);
    expect(metrics.state).toBe('none');
    expect(metrics.passRate.known).toBe(false);
    if (!metrics.passRate.known) {
      expect(metrics.passRate.fixHint).toContain('CI workflow');
    }
  });

  it('reports failure when any single check fails', () => {
    const metrics = deriveCiMetrics([
      { name: 'a', status: 'completed', conclusion: 'success' },
      { name: 'b', status: 'completed', conclusion: 'failure' },
    ]);
    expect(metrics.state).toBe('fail');
    expect(metrics.failingCheckNames).toEqual(['b']);
  });

  it('treats a running check as pending, not as a pass', () => {
    const metrics = deriveCiMetrics([
      { name: 'a', status: 'completed', conclusion: 'success' },
      { name: 'b', status: 'in_progress' },
    ]);
    expect(metrics.state).toBe('pending');
    expect(metrics.pending).toBe(1);
  });

  it('counts neutral and skipped as passing', () => {
    const metrics = deriveCiMetrics([
      { name: 'a', status: 'completed', conclusion: 'skipped' },
      { name: 'b', status: 'completed', conclusion: 'neutral' },
    ]);
    expect(metrics.state).toBe('pass');
    expect(metrics.passing).toBe(2);
  });

  it('sorts failing check names so the list is stable between renders', () => {
    const metrics = deriveCiMetrics([
      { name: 'z', status: 'completed', conclusion: 'failure' },
      { name: 'a', status: 'completed', conclusion: 'failure' },
    ]);
    expect(metrics.failingCheckNames).toEqual(['a', 'z']);
  });
});

describe('derivePullRequestMetrics', () => {
  const pr = (over: Partial<Parameters<typeof derivePullRequestMetrics>[0][number]> = {}) => ({
    number: 1, state: 'merged',
    createdAt: daysAgo(3), mergedAt: daysAgo(1),
    additions: 20, deletions: 5,
    reviews: [{ verdict: 'approved', submittedAt: daysAgo(2) }],
    linkedIssues: [7],
    ...over,
  });

  it('separates open, draft and merged', () => {
    const metrics = derivePullRequestMetrics([
      pr({ state: 'merged' }),
      pr({ state: 'open', mergedAt: undefined }),
      pr({ state: 'draft', mergedAt: undefined }),
      pr({ state: 'closed', mergedAt: undefined }),
    ], NOW);
    expect(metrics.merged).toBe(1);
    expect(metrics.open).toBe(2);
    expect(metrics.draft).toBe(1);
  });

  it('counts an open pull request with no submitted review as awaiting review', () => {
    const metrics = derivePullRequestMetrics([
      pr({ state: 'open', mergedAt: undefined, reviews: [] }),
      pr({ state: 'open', mergedAt: undefined, reviews: [{ verdict: 'pending' }] }),
      pr({ state: 'open', mergedAt: undefined, reviews: [{ verdict: 'approved' }] }),
    ], NOW);
    expect(metrics.awaitingReview).toBe(2);
  });

  it('measures size and linkage over merged pull requests only', () => {
    // An open pull request is still growing; counting it would report a
    // distribution of unfinished work.
    const metrics = derivePullRequestMetrics([
      pr({ state: 'merged', additions: 5, deletions: 0, linkedIssues: [1] }),
      pr({ state: 'open', mergedAt: undefined, additions: 5000, deletions: 0, linkedIssues: [] }),
    ], NOW);
    expect(metrics.sizeDistribution.find(s => s.key === 'xs')?.value).toBe(1);
    expect(metrics.sizeDistribution.find(s => s.key === 'xl')?.value).toBe(0);
    expect(metrics.linkedRate).toEqual({ known: true, value: 100 });
  });

  it('buckets size against declared boundaries', () => {
    const sizes = [5, 50, 200, 700, 5000];
    const metrics = derivePullRequestMetrics(
      sizes.map((n, i) => pr({ number: i, additions: n, deletions: 0 })), NOW,
    );
    expect(metrics.sizeDistribution.map(s => s.value)).toEqual([1, 1, 1, 1, 1]);
  });

  it('has no latency verdict below the sample floor', () => {
    const metrics = derivePullRequestMetrics([pr()], NOW);
    expect(metrics.medianTimeToFirstReviewMs.known).toBe(false);
    expect(metrics.medianTimeToMergeMs.known).toBe(false);
  });

  it('computes review and merge latency once there are enough samples', () => {
    const metrics = derivePullRequestMetrics([pr(), pr({ number: 2 }), pr({ number: 3 })], NOW);
    // created 3d ago, first review 2d ago, merged 1d ago.
    expect(metrics.medianTimeToFirstReviewMs).toEqual({ known: true, value: 24 * 60 * 60 * 1000 });
    expect(metrics.medianTimeToMergeMs).toEqual({ known: true, value: 2 * 24 * 60 * 60 * 1000 });
  });

  it('ignores a review timestamped before the pull request existed', () => {
    // Clock skew and backfilled data both produce these; a negative latency
    // would drag a median into nonsense.
    const metrics = derivePullRequestMetrics([
      pr({ reviews: [{ verdict: 'approved', submittedAt: daysAgo(9) }] }),
      pr({ number: 2 }), pr({ number: 3 }), pr({ number: 4 }),
    ], NOW);
    expect(metrics.medianTimeToFirstReviewMs).toEqual({ known: true, value: 24 * 60 * 60 * 1000 });
  });

  it('takes the earliest submitted review as "first"', () => {
    const metrics = derivePullRequestMetrics([1, 2, 3].map(n => pr({
      number: n,
      reviews: [
        { verdict: 'approved', submittedAt: daysAgo(1) },
        { verdict: 'commented', submittedAt: daysAgo(2) },
      ],
    })), NOW);
    expect(metrics.medianTimeToFirstReviewMs).toEqual({ known: true, value: 24 * 60 * 60 * 1000 });
  });

  it('has no linked-rate verdict when nothing has merged', () => {
    expect(derivePullRequestMetrics([pr({ state: 'open', mergedAt: undefined })], NOW).linkedRate.known)
      .toBe(false);
  });

  it('charts merge throughput over the window', () => {
    const metrics = derivePullRequestMetrics([pr(), pr({ number: 2 })], NOW, 7);
    expect(metrics.throughput).toHaveLength(7);
    expect(metrics.throughput.reduce((sum, p) => sum + p.value, 0)).toBe(2);
  });

  it('handles an empty repository without inventing numbers', () => {
    const metrics = derivePullRequestMetrics([], NOW);
    expect(metrics.merged).toBe(0);
    expect(metrics.medianTimeToMergeMs.known).toBe(false);
    expect(metrics.linkedRate.known).toBe(false);
  });
});

describe('deriveCommitConformance', () => {
  it('recognises conventional prefixes including scopes and breaking markers', () => {
    const result = deriveCommitConformance([
      'feat: add a thing',
      'fix(core): correct a thing',
      'refactor!: break a thing',
    ]);
    expect(result.conforming).toBe(3);
    expect(result.rate).toEqual({ known: true, value: 100 });
  });

  it('excludes platform-generated merge commits from the denominator', () => {
    // Counting them as violations would penalise a team for using squash merges.
    const result = deriveCommitConformance([
      'feat: add a thing',
      'Merge pull request #12 from acme/feat',
      'Merge branch develop',
    ]);
    expect(result.total).toBe(1);
    expect(result.rate).toEqual({ known: true, value: 100 });
  });

  it('returns non-conforming examples so the number is actionable', () => {
    const result = deriveCommitConformance(['feat: ok', 'wip', 'stuff']);
    expect(result.examples).toEqual(['wip', 'stuff']);
    expect(result.rate).toEqual({ known: true, value: 33 });
  });

  it('has no verdict for an empty history', () => {
    expect(deriveCommitConformance([]).rate.known).toBe(false);
  });

  it('rejects a prefix with no message body', () => {
    expect(CONVENTIONAL_COMMIT_PATTERN.test('feat:')).toBe(false);
    expect(CONVENTIONAL_COMMIT_PATTERN.test('feat: x')).toBe(true);
  });
});

describe('deriveReleaseMetrics', () => {
  it('reports drift when the manifest version has no changelog section', () => {
    const metrics = deriveReleaseMetrics({ version: '1.2.3', changelogVersions: ['1.2.2'] });
    expect(metrics.changelogCurrent).toBe(false);
    expect(metrics.drift).toContain('1.2.3');
  });

  it('reports no drift when the changelog is current', () => {
    const metrics = deriveReleaseMetrics({ version: '1.2.3', changelogVersions: ['1.2.3', '1.2.2'] });
    expect(metrics.changelogCurrent).toBe(true);
    expect(metrics.drift).toBeUndefined();
  });

  it('does not claim drift when there is no version to compare', () => {
    expect(deriveReleaseMetrics({}).drift).toBeUndefined();
  });
});

describe('deriveWorkflowHealth — omit, never zero', () => {
  const component = (key: string, score: number | undefined, weight = 1): HealthComponent => ({
    key,
    label: key,
    score: score === undefined ? unknown('not measured') : known(score),
    weight,
  });

  it('omits unmeasured components and redistributes their weight', () => {
    // Scoring an unmeasured component as zero would make a project that has not
    // yet connected GitHub look catastrophic, which is false and discouraging
    // at exactly the wrong moment.
    const health = deriveWorkflowHealth([component('a', 80), component('b', undefined)]);
    expect(health.score).toEqual({ known: true, value: 80 });
    expect(health.omitted).toEqual(['b']);
  });

  it('has no score at all when nothing could be measured', () => {
    const health = deriveWorkflowHealth([component('a', undefined)]);
    expect(health.score.known).toBe(false);
    expect(health.omitted).toEqual(['a']);
  });

  it('weights components', () => {
    const health = deriveWorkflowHealth([component('a', 100, 3), component('b', 0, 1)]);
    expect(health.score).toEqual({ known: true, value: 75 });
  });

  it('has no score when every weight is zero', () => {
    expect(deriveWorkflowHealth([component('a', 50, 0)]).score.known).toBe(false);
  });
});

describe('formatting', () => {
  it('renders an em dash and the reason for an unknown verdict', () => {
    const formatted = formatVerdict(unknown('No data.', 'Run the tests.'), value => `${value}`);
    expect(formatted.text).toBe('—');
    expect(formatted.known).toBe(false);
    expect(formatted.detail).toBe('No data. Run the tests.');
  });

  it('renders a known verdict through the supplied formatter', () => {
    expect(formatVerdict(known(42), value => `${value}%`)).toEqual({ text: '42%', known: true });
  });

  it('scales duration units with magnitude', () => {
    expect(formatHours(30 * 60 * 1000)).toBe('30m');
    expect(formatHours(5 * 60 * 60 * 1000)).toBe('5.0h');
    expect(formatHours(72 * 60 * 60 * 1000)).toBe('3.0d');
  });

  it('uses one threshold pair for every score tone', () => {
    expect(scoreTone(80)).toBe('good');
    expect(scoreTone(79)).toBe('warn');
    expect(scoreTone(50)).toBe('warn');
    expect(scoreTone(49)).toBe('critical');
  });

  it('measures whole days between timestamps', () => {
    expect(daysBetween(Date.parse(daysAgo(3)), NOW)).toBe(3);
  });
});
