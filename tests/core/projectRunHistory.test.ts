import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectRunHistory } from '../../src/core/projectRunHistory.ts';
import type { ProjectRunRecord } from '../../src/types.ts';

function createMemoryState() {
  const storage = new Map<string, unknown>();
  return {
    get<T>(key: string, defaultValue: T): T {
      return (storage.has(key) ? storage.get(key) : defaultValue) as T;
    },
    async update(key: string, value: unknown): Promise<void> {
      storage.set(key, value);
    },
  };
}

function makeRun(id: string, updatedAt: string): ProjectRunRecord {
  return {
    id,
    goal: `Goal ${id}`,
    status: 'completed',
    createdAt: updatedAt,
    updatedAt,
    estimatedFiles: 4,
    requiresApproval: false,
    planSubtaskCount: 2,
    completedSubtaskCount: 2,
    totalSubtaskCount: 2,
    currentBatch: 1,
    totalBatches: 1,
    failedSubtaskTitles: [],
    subTaskArtifacts: [],
    requireBatchApproval: false,
    paused: false,
    awaitingBatchApproval: false,
    logs: [{ timestamp: updatedAt, level: 'info', message: 'done' }],
    summary: {
      id,
      goal: `Goal ${id}`,
      startedAt: updatedAt,
      generatedAt: updatedAt,
      totalCostUsd: 0.1,
      totalDurationMs: 1000,
      subTaskResults: [],
      changedFiles: [],
      fileAttribution: {},
      subTaskArtifacts: [],
    },
  };
}

describe('ProjectRunHistory', () => {
  it('stores and retrieves runs ordered by updatedAt descending', async () => {
    const history = new ProjectRunHistory(createMemoryState());
    await history.upsertRun(makeRun('older', '2026-04-04T09:00:00.000Z'));
    await history.upsertRun(makeRun('newer', '2026-04-04T10:00:00.000Z'));

    expect(history.listRuns().map(run => run.id)).toEqual(['newer', 'older']);
  });

  it('replaces an existing run when the same id is updated', async () => {
    const history = new ProjectRunHistory(createMemoryState());
    await history.upsertRun(makeRun('run-1', '2026-04-04T09:00:00.000Z'));

    const updated = makeRun('run-1', '2026-04-04T11:00:00.000Z');
    updated.status = 'failed';
    updated.failedSubtaskTitles = ['Task A'];
    await history.upsertRun(updated);

    expect(history.listRuns()).toHaveLength(1);
    expect(history.getRun('run-1')?.status).toBe('failed');
    expect(history.getRun('run-1')?.failedSubtaskTitles).toEqual(['Task A']);
  });

  it('reads disk-backed runs through the async API', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atlasmind-run-history-'));
    const history = new ProjectRunHistory(createMemoryState());
    history.enableDiskStorage(tempDir);

    await history.upsertRun(makeRun('disk-run', '2026-04-04T12:00:00.000Z'));

    const runs = await history.listRunsAsync();
    const run = await history.getRunAsync('disk-run');

    expect(runs.map(item => item.id)).toContain('disk-run');
    expect(run?.id).toBe('disk-run');

    await fs.rm(tempDir, { recursive: true, force: true });
  });
});