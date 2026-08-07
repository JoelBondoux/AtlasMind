import { describe, expect, it } from 'vitest';

import { deriveCiMetrics } from '../../src/core/workflowMetrics.ts';
import { headCommitCheckRuns, parseGhRunList } from '../../src/views/projectDashboardPanel.ts';

type Run = ReturnType<typeof parseGhRunList>[number];

let nextId = 1;

function run(overrides: Partial<Run> = {}): Run {
  return {
    databaseId: nextId++,
    workflowName: 'CI',
    displayTitle: 'a commit subject',
    conclusion: 'success',
    status: 'completed',
    headSha: 'head',
    createdAt: '2026-08-05T10:00:00Z',
    updatedAt: '2026-08-05T10:05:00Z',
    ...overrides,
  };
}

describe('headCommitCheckRuns', () => {
  it('reports nothing when CI has never been read', () => {
    // The distinction the whole surface rests on: no runs must stay unknown
    // rather than becoming a measured zero.
    expect(headCommitCheckRuns([])).toEqual([]);
    expect(deriveCiMetrics(headCommitCheckRuns([])).passRate.known).toBe(false);
    expect(deriveCiMetrics(headCommitCheckRuns([])).state).toBe('none');
  });

  it('keeps only the runs belonging to the newest run’s commit', () => {
    const checks = headCommitCheckRuns([
      run({ workflowName: 'CI', headSha: 'head' }),
      run({ workflowName: 'Lint', headSha: 'head' }),
      run({ workflowName: 'CI', headSha: 'older', conclusion: 'failure' }),
    ]);

    expect(checks.map(check => check.name).sort()).toEqual(['CI', 'Lint']);
  });

  it('does not let last week’s failure fail today’s commit', () => {
    // The bug this narrowing exists to prevent: a clean commit reading red
    // because of a failure somebody already fixed.
    const metrics = deriveCiMetrics(headCommitCheckRuns([
      run({ workflowName: 'CI', headSha: 'head', conclusion: 'success' }),
      run({ workflowName: 'CI', headSha: 'older', conclusion: 'failure' }),
      run({ workflowName: 'Lint', headSha: 'older', conclusion: 'failure' }),
    ]));

    expect(metrics.state).toBe('pass');
    expect(metrics.failing).toBe(0);
    expect(metrics.failingCheckNames).toEqual([]);
  });

  it('treats a re-run as another attempt at one check, not a second check', () => {
    const checks = headCommitCheckRuns([
      run({ workflowName: 'CI', conclusion: 'success', updatedAt: '2026-08-05T12:00:00Z' }),
      run({ workflowName: 'CI', conclusion: 'failure', updatedAt: '2026-08-05T10:00:00Z' }),
    ]);

    expect(checks).toHaveLength(1);
    expect(checks[0]?.conclusion).toBe('success');
    expect(deriveCiMetrics(checks).state).toBe('pass');
  });

  it('still fails the commit when the newest attempt failed', () => {
    const metrics = deriveCiMetrics(headCommitCheckRuns([
      run({ workflowName: 'CI', conclusion: 'failure', updatedAt: '2026-08-05T12:00:00Z' }),
      run({ workflowName: 'CI', conclusion: 'success', updatedAt: '2026-08-05T10:00:00Z' }),
      run({ workflowName: 'Lint', conclusion: 'success' }),
    ]));

    expect(metrics.state).toBe('fail');
    expect(metrics.failingCheckNames).toEqual(['CI']);
  });

  it('measures no duration for a run that has not finished', () => {
    // `updatedAt` on an in-flight run is "last thing that happened", not a
    // completion. Entering it as one would report a slow build as fast while
    // it is still going.
    const [inFlight] = headCommitCheckRuns([
      run({ workflowName: 'CI', status: 'in_progress', conclusion: '' }),
    ]);

    expect(inFlight?.startedAt).toBe('2026-08-05T10:00:00Z');
    expect(inFlight?.completedAt).toBeUndefined();
    expect(deriveCiMetrics([inFlight!]).medianDurationMs.known).toBe(false);
  });

  it('measures the duration of completed runs, queue time included', () => {
    // Three checks, because `deriveCiMetrics` refuses to call one or two
    // samples a median. The middle one is the answer.
    const metrics = deriveCiMetrics(headCommitCheckRuns([
      run({ workflowName: 'CI', createdAt: '2026-08-05T10:00:00Z', updatedAt: '2026-08-05T10:04:00Z' }),
      run({ workflowName: 'Lint', createdAt: '2026-08-05T10:00:00Z', updatedAt: '2026-08-05T10:05:00Z' }),
      run({ workflowName: 'Package', createdAt: '2026-08-05T10:00:00Z', updatedAt: '2026-08-05T10:09:00Z' }),
    ]));

    expect(metrics.medianDurationMs).toEqual({ known: true, value: 5 * 60 * 1000 });
  });

  it('counts an in-flight run as pending rather than as a pass', () => {
    const metrics = deriveCiMetrics(headCommitCheckRuns([
      run({ workflowName: 'CI', status: 'in_progress', conclusion: '' }),
      run({ workflowName: 'Lint', conclusion: 'success' }),
    ]));

    expect(metrics.state).toBe('pending');
    expect(metrics.pending).toBe(1);
    expect(metrics.passing).toBe(1);
  });

  it('attributes nothing when the newest run names no commit', () => {
    // Every run `gh` could not attribute carries `headSha: ''`. Matching them
    // against each other would gather unrelated runs into one pseudo-commit.
    expect(headCommitCheckRuns([
      run({ headSha: '' }),
      run({ headSha: '', workflowName: 'Lint', conclusion: 'failure' }),
    ])).toEqual([]);
  });

  it('names an unnamed workflow rather than dropping it', () => {
    const checks = headCommitCheckRuns([
      run({ workflowName: '', displayTitle: '' }),
    ]);

    expect(checks[0]?.name).toBe('(unnamed workflow)');
  });

  it('runs over what `gh run list` actually produces', () => {
    const checks = headCommitCheckRuns(parseGhRunList(JSON.stringify([
      {
        databaseId: 2, workflowName: 'CI', displayTitle: 'fix things',
        conclusion: 'failure', status: 'completed', headSha: 'abc',
        createdAt: '2026-08-05T10:00:00Z', updatedAt: '2026-08-05T10:09:00Z',
      },
      {
        databaseId: 1, workflowName: 'CI', displayTitle: 'earlier',
        conclusion: 'success', status: 'completed', headSha: 'def',
        createdAt: '2026-08-04T10:00:00Z', updatedAt: '2026-08-04T10:04:00Z',
      },
    ])));

    expect(checks).toHaveLength(1);
    expect(deriveCiMetrics(checks).state).toBe('fail');
  });
});
