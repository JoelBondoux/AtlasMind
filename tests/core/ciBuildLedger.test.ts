import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CI_BUILD_LEDGER_CAP,
  buildCiLedgerView,
  describeCiBuild,
  githubRunToBuild,
  nextCiPollDelayMs,
  recordCiBuild,
  sanitizeCiBuildLedger,
  upsertCiBuild,
  type CiBuildRecord,
  type GithubRunInput,
} from '../../src/core/ciBuildLedger.ts';

function local(overrides: Partial<Parameters<typeof recordCiBuild>[0]> = {}): CiBuildRecord {
  return recordCiBuild({
    id: 'local-1',
    source: 'local',
    routeId: 'local-runner',
    routeLabel: 'Lend this computer to GitHub',
    evidence: 'linux-container',
    observation: 'live',
    status: 'running',
    title: 'Trusted quality',
    startedAt: '2026-08-18T10:00:00.000Z',
    ...overrides,
  });
}

function githubRun(overrides: Partial<GithubRunInput> = {}): GithubRunInput {
  return {
    databaseId: 991,
    workflowName: 'CI',
    displayTitle: 'Fix the thing',
    conclusion: 'success',
    status: 'completed',
    headSha: 'a'.repeat(40),
    headBranch: 'develop',
    createdAt: '2026-08-18T09:00:00.000Z',
    updatedAt: '2026-08-18T09:10:00.000Z',
    ...overrides,
  };
}

describe('a build nobody watched', () => {
  /**
   * The rule that keeps this page honest. AtlasMind types the direct-local
   * commands into a terminal and deliberately does not read it, so a green tick
   * beside one of those runs would be an invented pass on the surface people
   * check before shipping.
   */
  it('never reports a verdict, whatever the caller passes', () => {
    for (const status of ['passed', 'failed', 'running', 'cancelled'] as const) {
      const build = local({ observation: 'unobserved', status, routeId: 'direct-local' });
      expect(build.status).toBe('unknown');
    }
  });

  it('re-applies the rule when reading stored records', () => {
    const stored = sanitizeCiBuildLedger([{
      id: 'x',
      source: 'local',
      routeId: 'direct-local',
      routeLabel: 'Run here',
      evidence: 'this-machine',
      observation: 'unobserved',
      status: 'passed',
      title: 'checks',
      startedAt: '2026-08-18T10:00:00.000Z',
    }]);
    expect(stored[0]?.status).toBe('unknown');
  });

  it('says plainly that it cannot report the result', () => {
    const build = local({ observation: 'unobserved', routeId: 'direct-local' });
    expect(describeCiBuild(build)).toContain('does not read it');
  });

  it('holds for any generated record', () => {
    fc.assert(fc.property(
      fc.record({
        observation: fc.constantFrom('live' as const, 'polled' as const, 'unobserved' as const),
        status: fc.constantFrom('running' as const, 'passed' as const, 'failed' as const, 'cancelled' as const, 'unknown' as const),
      }),
      sample => {
        const build = local(sample);
        if (sample.observation === 'unobserved') {
          expect(build.status).toBe('unknown');
        } else {
          expect(build.status).toBe(sample.status);
        }
      },
    ), { numRuns: 200 });
  });
});

describe('the ledger holds no logs', () => {
  /**
   * The type is the enforcement, as it is in `workflowAuditRecord`. Logs are
   * large, often carry secrets, and already live in the output channel.
   */
  it('has no field a log could be put in', () => {
    const build = local();
    const keys = Object.keys(build);
    for (const forbidden of ['log', 'logs', 'output', 'stdout', 'stderr', 'body']) {
      expect(keys).not.toContain(forbidden);
    }
    expect(build.pointer === undefined || Object.keys(build.pointer)).not.toContain('log');
  });

  it('points at where the detail lives instead', () => {
    const build = local({ pointer: { kind: 'output-channel', label: 'AtlasMind Local CI' } });
    expect(build.pointer).toEqual({ kind: 'output-channel', label: 'AtlasMind Local CI' });
  });
});

describe('GitHub run mapping', () => {
  /**
   * `status` and `conclusion` are separate fields and only one is meaningful at
   * a time. Reading an empty conclusion as a failure — or a pass — is the
   * classic misreading.
   */
  it('never reads an in-progress run as passed or failed', () => {
    for (const status of ['in_progress', 'queued', 'pending', 'waiting']) {
      const build = githubRunToBuild(githubRun({ status, conclusion: '' }));
      expect(build.status).toBe('running');
      expect(build.endedAt).toBeUndefined();
    }
  });

  it('maps the conclusions it recognises and refuses the ones it does not', () => {
    expect(githubRunToBuild(githubRun({ conclusion: 'success' })).status).toBe('passed');
    expect(githubRunToBuild(githubRun({ conclusion: 'failure' })).status).toBe('failed');
    expect(githubRunToBuild(githubRun({ conclusion: 'timed_out' })).status).toBe('failed');
    expect(githubRunToBuild(githubRun({ conclusion: 'cancelled' })).status).toBe('cancelled');
    expect(githubRunToBuild(githubRun({ conclusion: 'neutral' })).status).toBe('unknown');
    expect(githubRunToBuild(githubRun({ conclusion: '' })).status).toBe('unknown');
  });

  it('marks hosted builds as polled rather than live', () => {
    expect(githubRunToBuild(githubRun()).observation).toBe('polled');
    expect(describeCiBuild(githubRunToBuild(githubRun({ status: 'in_progress', conclusion: '' }))))
      .toContain('not streamed');
  });
});

describe('merging into one list', () => {
  /**
   * "Nothing was fetched" and "nothing ran" are very different facts, and
   * rendering them identically is how a build page reassures somebody wrongly.
   */
  it('keeps unfetched GitHub history distinct from empty history', () => {
    expect(buildCiLedgerView([], undefined).githubLoaded).toBe(false);
    expect(buildCiLedgerView([], []).githubLoaded).toBe(true);
  });

  it('orders newest first and breaks ties deterministically', () => {
    const same = '2026-08-18T10:00:00.000Z';
    const view = buildCiLedgerView(
      [local({ id: 'a', startedAt: same }), local({ id: 'b', startedAt: same })],
      [githubRun({ databaseId: 5, createdAt: '2026-08-18T11:00:00.000Z' })],
    );
    expect(view.builds.map(build => build.id)).toEqual(['5', 'b', 'a']);
    expect(buildCiLedgerView(
      [local({ id: 'b', startedAt: same }), local({ id: 'a', startedAt: same })],
      [githubRun({ databaseId: 5, createdAt: '2026-08-18T11:00:00.000Z' })],
    ).builds.map(build => build.id)).toEqual(['5', 'b', 'a']);
  });

  it('reports what is still running and what cannot be verdicted', () => {
    const view = buildCiLedgerView(
      [
        local({ id: 'run', status: 'running' }),
        local({ id: 'blind', observation: 'unobserved', routeId: 'direct-local' }),
      ],
      [githubRun()],
    );
    expect(view.hasRunning).toBe(true);
    expect(view.unobservedCount).toBe(1);
  });

  it('caps the merged list', () => {
    const many = Array.from({ length: 80 }, (_, index) => local({
      id: `x-${index}`,
      startedAt: new Date(Date.UTC(2026, 7, 18, 0, index)).toISOString(),
    }));
    expect(buildCiLedgerView(many, []).builds.length).toBe(CI_BUILD_LEDGER_CAP);
  });
});

describe('storing local records', () => {
  it('updates a build in place rather than listing it twice', () => {
    const started = local({ id: 'one', status: 'running' });
    const finished = local({ id: 'one', status: 'passed', endedAt: '2026-08-18T10:05:00.000Z' });
    const after = upsertCiBuild(upsertCiBuild([], started), finished);
    expect(after).toHaveLength(1);
    expect(after[0]?.status).toBe('passed');
  });

  it('keeps a local and a GitHub build that share an id apart', () => {
    const localBuild = local({ id: '77' });
    const hosted = githubRunToBuild(githubRun({ databaseId: 77 }));
    expect(upsertCiBuild([localBuild], hosted)).toHaveLength(2);
  });

  it('drops unreadable stored entries without throwing', () => {
    expect(sanitizeCiBuildLedger('nonsense')).toEqual([]);
    expect(sanitizeCiBuildLedger([null, 3, {}, { id: 'x' }])).toEqual([]);
  });
});

describe('polling schedule', () => {
  /**
   * A poller that keeps going against a finished build is a background process
   * nobody asked for, against a rate-limited API.
   */
  it('stops when nothing is running', () => {
    expect(nextCiPollDelayMs(0, false)).toBeUndefined();
    expect(nextCiPollDelayMs(9, false)).toBeUndefined();
  });

  it('backs off and then holds steady', () => {
    expect(nextCiPollDelayMs(0, true)).toBe(4_000);
    expect(nextCiPollDelayMs(1, true)).toBe(8_000);
    expect(nextCiPollDelayMs(2, true)).toBe(16_000);
    expect(nextCiPollDelayMs(3, true)).toBe(30_000);
    expect(nextCiPollDelayMs(50, true)).toBe(30_000);
  });
});
