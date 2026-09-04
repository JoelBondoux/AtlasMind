import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  UPSTREAM_DIVERGENCE_MAX_REPORTED_PATHS,
  collectUpstreamDivergence,
  deriveUpstreamDivergenceTrend,
  takeUpstreamDivergenceSnapshot,
  type UpstreamDivergenceGitRunner,
  type UpstreamDivergenceSnapshot,
} from '../../src/core/upstreamDivergence';
import type { ProjectComponent } from '../../src/core/projectComposition';

const OBSERVED_AT = '2026-09-03T10:00:00.000Z';
const HASH = 'a'.repeat(40);

function component(overrides: Partial<ProjectComponent> = {}): ProjectComponent {
  return {
    id: 'vendor-core',
    label: 'Vendor core',
    location: 'vendor/core',
    role: 'shared-library',
    archetype: { archetype: 'library', traits: ['has-native-build'] },
    vcs: 'git',
    home: false,
    upstream: { remote: 'upstream', ref: 'main' },
    ...overrides,
  };
}

function runnerFor(outputs: Record<string, string | Error>) {
  const calls: Array<{ root: string; args: readonly string[] }> = [];
  const runner: UpstreamDivergenceGitRunner = async (root, args) => {
    calls.push({ root, args: [...args] });
    const key = args.join(' ');
    const output = outputs[key];
    if (output instanceof Error) throw output;
    if (output === undefined) throw new Error(`Unexpected Git call: ${key}`);
    return output;
  };
  return { runner, calls };
}

function successfulRunner(localPaths = ['src/local.ts', 'src/shared.ts'], remotePaths = ['docs/remote.md', 'src/shared.ts']) {
  const target = 'refs/remotes/upstream/main';
  return runnerFor({
    [`merge-base -- HEAD ${target}`]: HASH,
    [`rev-list --left-right --count HEAD...${target}`]: '3\t5',
    [`diff --name-only -z --no-renames --no-ext-diff --no-textconv ${HASH} HEAD --`]: `${localPaths.join('\0')}\0`,
    [`diff --name-only -z --no-renames --no-ext-diff --no-textconv ${HASH} ${target} --`]: `${remotePaths.join('\0')}\0`,
  });
}

describe('collectUpstreamDivergence', () => {
  it('reports exact distance and overlap from both sides of the merge base', async () => {
    const { runner, calls } = successfulRunner();
    const report = await collectUpstreamDivergence({
      component: component(),
      repositoryRoot: 'C:/work/vendor/core',
      observedAt: OBSERVED_AT,
    }, runner);

    expect(report).toMatchObject({
      status: 'available',
      componentId: 'vendor-core',
      componentLabel: 'Vendor core',
      upstream: { remote: 'upstream', ref: 'main' },
      commitsAhead: 3,
      commitsBehind: 5,
      filesDiverged: 3,
      divergedPaths: ['docs/remote.md', 'src/local.ts', 'src/shared.ts'],
      conflictPronePathCount: 1,
      conflictPronePaths: ['src/shared.ts'],
      pathsTruncated: false,
      trend: { status: 'first-look', firstLookReason: 'no-snapshot' },
    });
    expect(calls).toHaveLength(4);
    expect(calls.every(call => call.root === 'C:/work/vendor/core' && Array.isArray(call.args))).toBe(true);
  });

  it('uses the declared remote and ref only as one constructed remote-tracking ref', async () => {
    const { runner, calls } = successfulRunner();
    await collectUpstreamDivergence({
      component: component(), repositoryRoot: 'repo', observedAt: OBSERVED_AT,
    }, runner);

    expect(calls.map(call => call.args)).toContainEqual([
      'rev-list', '--left-right', '--count', 'HEAD...refs/remotes/upstream/main',
    ]);
    expect(calls.flatMap(call => call.args)).not.toContain('upstream main');
  });

  it('reports non-Git and unresolved components as not visible without running Git', async () => {
    const runner = vi.fn<UpstreamDivergenceGitRunner>();
    const nonGit = await collectUpstreamDivergence({
      component: component({ vcs: 'perforce' }), repositoryRoot: 'repo', observedAt: OBSERVED_AT,
    }, runner);
    const unresolved = await collectUpstreamDivergence({
      component: component(), observedAt: OBSERVED_AT,
    }, runner);

    expect(nonGit).toMatchObject({ status: 'not-visible' });
    expect(unresolved).toMatchObject({ status: 'not-visible' });
    expect(runner).not.toHaveBeenCalled();
  });

  it('reports a missing declaration instead of treating it as zero divergence', async () => {
    const runner = vi.fn<UpstreamDivergenceGitRunner>();
    const report = await collectUpstreamDivergence({
      component: component({ upstream: undefined }), repositoryRoot: 'repo', observedAt: OBSERVED_AT,
    }, runner);

    expect(report).toMatchObject({ status: 'not-declared' });
    expect(report).not.toHaveProperty('commitsBehind');
    expect(runner).not.toHaveBeenCalled();
  });

  it('refuses flag-shaped or otherwise unsafe upstream coordinates before Git', async () => {
    const runner = vi.fn<UpstreamDivergenceGitRunner>();
    const report = await collectUpstreamDivergence({
      component: component({ upstream: { remote: '--upload-pack=malicious', ref: 'main' } }),
      repositoryRoot: 'repo',
      observedAt: OBSERVED_AT,
    }, runner);

    expect(report).toMatchObject({ status: 'unreadable' });
    expect(runner).not.toHaveBeenCalled();
  });

  it('turns command failures and malformed output into unknown, never partial counts', async () => {
    const target = 'refs/remotes/upstream/main';
    const failed = runnerFor({
      [`merge-base -- HEAD ${target}`]: new Error('credential=secret'),
      [`rev-list --left-right --count HEAD...${target}`]: '0\t0',
    });
    const malformed = runnerFor({
      [`merge-base -- HEAD ${target}`]: HASH,
      [`rev-list --left-right --count HEAD...${target}`]: 'not counts',
    });

    const failedReport = await collectUpstreamDivergence({
      component: component(), repositoryRoot: 'repo', observedAt: OBSERVED_AT,
    }, failed.runner);
    const malformedReport = await collectUpstreamDivergence({
      component: component(), repositoryRoot: 'repo', observedAt: OBSERVED_AT,
    }, malformed.runner);

    expect(failedReport).toMatchObject({ status: 'unreadable' });
    expect(JSON.stringify(failedReport)).not.toContain('secret');
    expect(malformedReport).toMatchObject({ status: 'unreadable' });
    expect(malformedReport).not.toHaveProperty('filesDiverged');
  });

  it('refuses a truncated NUL-delimited path record instead of claiming an exact count', async () => {
    const target = 'refs/remotes/upstream/main';
    const { runner } = runnerFor({
      [`merge-base -- HEAD ${target}`]: HASH,
      [`rev-list --left-right --count HEAD...${target}`]: '1\t2',
      [`diff --name-only -z --no-renames --no-ext-diff --no-textconv ${HASH} HEAD --`]: 'src/incomplete.ts',
      [`diff --name-only -z --no-renames --no-ext-diff --no-textconv ${HASH} ${target} --`]: 'src/remote.ts\0',
    });

    const report = await collectUpstreamDivergence({
      component: component(), repositoryRoot: 'repo', observedAt: OBSERVED_AT,
    }, runner);
    expect(report).toMatchObject({ status: 'unreadable' });
    expect(report).not.toHaveProperty('filesDiverged');
  });

  it('keeps exact counts while bounding only the displayed path lists', async () => {
    const paths = Array.from({ length: UPSTREAM_DIVERGENCE_MAX_REPORTED_PATHS + 3 }, (_, index) => `src/${index}.ts`);
    const { runner } = successfulRunner(paths, paths);
    const report = await collectUpstreamDivergence({
      component: component(), repositoryRoot: 'repo', observedAt: OBSERVED_AT,
    }, runner);

    expect(report).toMatchObject({
      status: 'available',
      filesDiverged: paths.length,
      conflictPronePathCount: paths.length,
      pathsTruncated: true,
    });
    if (report.status === 'available') {
      expect(report.divergedPaths).toHaveLength(UPSTREAM_DIVERGENCE_MAX_REPORTED_PATHS);
      expect(report.conflictPronePaths).toHaveLength(UPSTREAM_DIVERGENCE_MAX_REPORTED_PATHS);
    }
  });
});

describe('upstream divergence trends', () => {
  const snapshot = (overrides: Partial<UpstreamDivergenceSnapshot> = {}): UpstreamDivergenceSnapshot => ({
    componentId: 'vendor-core',
    upstream: { remote: 'upstream', ref: 'main' },
    observedAt: '2026-09-02T10:00:00.000Z',
    commitsAhead: 2,
    commitsBehind: 4,
    filesDiverged: 10,
    conflictPronePathCount: 2,
    ...overrides,
  });

  it.each([
    [{ commitsBehind: 6 }, 'growing'],
    [{ commitsBehind: 2, filesDiverged: 8 }, 'shrinking'],
    [{ commitsBehind: 6, filesDiverged: 8 }, 'mixed'],
    [{}, 'unchanged'],
  ] as const)('classifies a comparable movement as %s → %s', (changes, status) => {
    expect(deriveUpstreamDivergenceTrend(snapshot(), snapshot({
      ...changes,
      observedAt: OBSERVED_AT,
    }))).toMatchObject({ status, since: '2026-09-02T10:00:00.000Z' });
  });

  it('starts a new baseline when the upstream changes', () => {
    expect(deriveUpstreamDivergenceTrend(snapshot(), snapshot({
      upstream: { remote: 'new-upstream', ref: 'stable' }, observedAt: OBSERVED_AT,
    }))).toEqual({ status: 'first-look', firstLookReason: 'different-upstream' });
  });

  it('refuses an internally inconsistent current snapshot', () => {
    expect(deriveUpstreamDivergenceTrend(snapshot(), snapshot({
      observedAt: OBSERVED_AT, filesDiverged: 1, conflictPronePathCount: 2,
    }))).toEqual({ status: 'first-look', firstLookReason: 'unreadable-snapshot' });
  });

  it('takes a fresh, minimal snapshot only from an available report', async () => {
    const { runner } = successfulRunner();
    const report = await collectUpstreamDivergence({
      component: component(), repositoryRoot: 'repo', observedAt: OBSERVED_AT,
    }, runner);
    const taken = takeUpstreamDivergenceSnapshot(report);

    expect(taken).toEqual({
      componentId: 'vendor-core',
      upstream: { remote: 'upstream', ref: 'main' },
      observedAt: OBSERVED_AT,
      commitsAhead: 3,
      commitsBehind: 5,
      filesDiverged: 3,
      conflictPronePathCount: 1,
    });
    expect(taken?.upstream).not.toBe(report.upstream);
    expect(report.upstream?.remote).toBe('upstream');
  });
});

describe('domain independence', () => {
  it('exports no domain-specific symbol names', () => {
    const source = readFileSync(path.resolve(__dirname, '../../src/core/upstreamDivergence.ts'), 'utf8');
    const exports = [...source.matchAll(/export (?:async )?(?:function|const|type|interface)\s+(\w+)/g)]
      .map(match => match[1]);
    expect(exports.join(' ')).not.toMatch(/unreal|unity|godot|game|engine/i);
  });
});
