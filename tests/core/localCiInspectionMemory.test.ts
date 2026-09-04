import { describe, expect, it } from 'vitest';
import {
  LOCAL_CI_INSPECTION_MEMORY_DAYS,
  applyRememberedInspection,
  describeRememberedInspection,
  rememberLocalCiInspection,
  restoreLocalCiInspection,
} from '../../src/core/localCiInspectionMemory.ts';
import {
  initialLocalCiRunnerSnapshot,
  type LocalCiCapacity,
  type LocalCiRunnerConfiguration,
  type LocalCiRunnerSnapshot,
} from '../../src/core/localCiRunner.ts';

const HOST: LocalCiCapacity = { os: 'win32', arch: 'x64', cpuCount: 24, memoryGb: 63.8 };
const FRESH_NOW = new Date('2026-08-19T09:00:00.000Z');

function configuration(overrides: Partial<LocalCiRunnerConfiguration> = {}): LocalCiRunnerConfiguration {
  return {
    enabled: true,
    workflowFile: 'trusted-local-ci.yml',
    trustedBranch: 'develop',
    runnerLabel: 'atlasmind-trusted-linux-{arch}',
    image: 'ghcr.io/actions/actions-runner@sha256:abc',
    shutdownPolicy: 'ifStartedByAtlasMind',
    maxCpus: 8,
    maxMemoryGb: 16,
    ...overrides,
  };
}

/** A snapshot as it looks after a probe that found a fully set-up machine. */
function inspected(overrides: Partial<LocalCiRunnerSnapshot> = {}): LocalCiRunnerSnapshot {
  const base = initialLocalCiRunnerSnapshot(configuration());
  return {
    ...base,
    host: HOST,
    engine: {
      ...base.engine,
      cliInstalled: true,
      available: true,
      desktopAvailable: true,
      os: 'linux',
      arch: 'x64',
      cpuCount: 16,
      memoryGb: 32,
      version: '27.1.1',
      imagePresent: true,
    },
    prerequisites: { inspection: 'inspected', githubCliInstalled: true, githubAuthenticated: true },
    ...overrides,
  };
}

describe('rememberLocalCiInspection', () => {
  it('refuses to remember a snapshot that was never probed', () => {
    const never = initialLocalCiRunnerSnapshot(configuration());
    expect(rememberLocalCiInspection(never)).toBeUndefined();
  });

  it('records the durable readings and the machine they describe', () => {
    const memory = rememberLocalCiInspection(inspected(), new Date('2026-08-18T09:00:00.000Z'));
    expect(memory).toBeDefined();
    expect(memory?.observedAt).toBe('2026-08-18T09:00:00.000Z');
    expect(memory?.machine).toEqual({ os: 'win32', arch: 'x64', cpuCount: 24, memoryGb: 63.8 });
    expect(memory?.prerequisites).toEqual({ githubCliInstalled: true, githubAuthenticated: true });
    expect(memory?.engine.cliInstalled).toBe(true);
    expect(memory?.engine.imagePresent).toBe(true);
  });

  it('carries no moment-only facts, so nothing can render a stale number as current', () => {
    const memory = rememberLocalCiInspection({
      ...inspected(),
      engine: { ...inspected().engine, otherRunningContainers: 4 },
    });
    expect(memory).toBeDefined();
    expect(JSON.stringify(memory)).not.toContain('otherRunningContainers');
    expect(JSON.stringify(memory)).not.toContain('queuedRun');
    expect(JSON.stringify(memory)).not.toContain('lifecycle');
  });
});

describe('restoreLocalCiInspection', () => {
  const stored = rememberLocalCiInspection(inspected(), new Date('2026-08-18T09:00:00.000Z'));

  it('restores a fresh record for the same machine', () => {
    const outcome = restoreLocalCiInspection(stored, HOST, configuration().image, new Date('2026-08-19T09:00:00.000Z'));
    expect(outcome.restored).toBe(true);
    if (outcome.restored) {
      expect(outcome.ageDays).toBe(1);
      expect(outcome.imageMatches).toBe(true);
    }
  });

  it('treats an absent, unparseable or foreign-shaped record as never having looked', () => {
    for (const value of [undefined, null, 'nonsense', 42, {}, { observedAt: 'not-a-date', machine: {}, engine: {}, prerequisites: {} }]) {
      const outcome = restoreLocalCiInspection(value, HOST, configuration().image);
      expect(outcome.restored).toBe(false);
      if (!outcome.restored) {
        expect(outcome.reason).toBe('absent');
      }
    }
  });

  it('expires a record older than the freshness window rather than believing it', () => {
    const later = new Date(Date.parse('2026-08-18T09:00:00.000Z') + (LOCAL_CI_INSPECTION_MEMORY_DAYS + 1) * 86_400_000);
    const outcome = restoreLocalCiInspection(stored, HOST, configuration().image, later);
    expect(outcome.restored).toBe(false);
    if (!outcome.restored) {
      expect(outcome.reason).toBe('expired');
    }
  });

  it('keeps a record right up to the edge of the window', () => {
    const edge = new Date(Date.parse('2026-08-18T09:00:00.000Z') + LOCAL_CI_INSPECTION_MEMORY_DAYS * 86_400_000);
    expect(restoreLocalCiInspection(stored, HOST, configuration().image, edge).restored).toBe(true);
  });

  it('refuses a record describing a different machine', () => {
    const elsewhere: LocalCiCapacity = { ...HOST, cpuCount: 8 };
    const outcome = restoreLocalCiInspection(stored, elsewhere, configuration().image, FRESH_NOW);
    expect(outcome.restored).toBe(false);
    if (!outcome.restored) {
      expect(outcome.reason).toBe('other-machine');
    }
  });

  it('restores the machine readings but reports that the image no longer matches', () => {
    const outcome = restoreLocalCiInspection(stored, HOST, 'ghcr.io/actions/actions-runner@sha256:different', FRESH_NOW);
    expect(outcome.restored).toBe(true);
    if (outcome.restored) {
      expect(outcome.imageMatches).toBe(false);
    }
  });
});

describe('applyRememberedInspection', () => {
  const stored = rememberLocalCiInspection(inspected(), new Date('2026-08-18T09:00:00.000Z'));

  it('fills in an unprobed snapshot', () => {
    const snapshot = { ...initialLocalCiRunnerSnapshot(configuration()), host: HOST };
    expect(snapshot.prerequisites.inspection).toBe('not-inspected');
    const restored = applyRememberedInspection(snapshot, restoreLocalCiInspection(stored, HOST, configuration().image, FRESH_NOW));
    expect(restored.prerequisites.inspection).toBe('inspected');
    expect(restored.engine.cliInstalled).toBe(true);
    expect(restored.prerequisites.githubAuthenticated).toBe(true);
  });

  it('never overwrites a live probe — a memory is by definition the older reading', () => {
    const live = inspected({
      engine: { ...inspected().engine, cliInstalled: false, available: false },
      prerequisites: { inspection: 'inspected', githubCliInstalled: false, githubAuthenticated: false },
    });
    const restored = applyRememberedInspection(live, restoreLocalCiInspection(stored, HOST, configuration().image, FRESH_NOW));
    expect(restored.engine.cliInstalled).toBe(false);
    expect(restored.prerequisites.githubCliInstalled).toBe(false);
  });

  it('drops the image verdict when the configured image has changed', () => {
    const snapshot = { ...initialLocalCiRunnerSnapshot(configuration()), host: HOST };
    const restored = applyRememberedInspection(
      snapshot,
      restoreLocalCiInspection(stored, HOST, 'ghcr.io/actions/actions-runner@sha256:different', FRESH_NOW),
    );
    expect(restored.engine.imagePresent).toBeUndefined();
    expect(restored.engine.cliInstalled).toBe(true);
  });

  it('leaves an unprobed snapshot untouched when nothing was restored', () => {
    const snapshot = { ...initialLocalCiRunnerSnapshot(configuration()), host: HOST };
    const restored = applyRememberedInspection(snapshot, { restored: false, reason: 'expired' });
    expect(restored).toBe(snapshot);
    expect(restored.prerequisites.inspection).toBe('not-inspected');
  });

  it('never restores a lifecycle, a queued run or a container — a memory guides, it does not authorise', () => {
    const snapshot = {
      ...initialLocalCiRunnerSnapshot(configuration()),
      host: HOST,
      lifecycle: 'not-inspected' as const,
    };
    const restored = applyRememberedInspection(snapshot, restoreLocalCiInspection(stored, HOST, configuration().image, FRESH_NOW));
    expect(restored.lifecycle).toBe('not-inspected');
    expect(restored.queuedRun).toBeUndefined();
    expect(restored.containerName).toBeUndefined();
  });
});

describe('describeRememberedInspection', () => {
  const stored = rememberLocalCiInspection(inspected(), new Date('2026-08-18T09:00:00.000Z'));

  it('says when a restored reading was taken, and that the machine is re-checked before a run', () => {
    const sentence = describeRememberedInspection(
      restoreLocalCiInspection(stored, HOST, configuration().image, new Date('2026-08-21T09:00:00.000Z')),
    );
    expect(sentence).toContain('3 days ago');
    expect(sentence).toContain('re-checks');
  });

  it('explains a refusal rather than reading as "not checked yet" for every cause', () => {
    expect(describeRememberedInspection({ restored: false, reason: 'expired' })).toContain('days old');
    expect(describeRememberedInspection({ restored: false, reason: 'other-machine' })).toContain('different computer');
    expect(describeRememberedInspection({ restored: false, reason: 'absent' })).toContain('has not been inspected');
  });
});
