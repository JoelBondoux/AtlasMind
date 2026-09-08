import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COST_HISTORY_MAX_RECORDS,
  costHistoryCommitWarning,
  costHistoryPaths,
  describeCostHistoryMigration,
  planCostHistoryMigration,
  resolveCostHistoryLocation,
} from '../../src/core/costHistoryLocation.js';
import {
  readCostHistoryFile,
  sanitizeCostRecord,
  writeCostHistoryFile,
} from '../../src/core/costHistoryFileStore.js';
import type { CostRecord } from '../../src/types.js';

function record(overrides: Partial<CostRecord> = {}): CostRecord {
  return {
    taskId: 't', agentId: 'a', model: 'anthropic/claude-sonnet-5',
    inputTokens: 100, outputTokens: 20, costUsd: 0.01,
    timestamp: '2026-09-07T10:00:00.000Z',
    ...overrides,
  };
}

describe('the location setting defaults to private', () => {
  it('resolves the two declared values', () => {
    expect(resolveCostHistoryLocation('repository')).toBe('repository');
    expect(resolveCostHistoryLocation('machine-private')).toBe('machine-private');
  });

  /**
   * A typo in settings must not be the reason spend starts being committed.
   */
  it('falls back to private for anything unrecognised', () => {
    for (const value of ['Repository', 'repo', '', undefined, null, 7, {}]) {
      expect(resolveCostHistoryLocation(value)).toBe('machine-private');
    }
  });
});

describe('paths', () => {
  it('puts the repository copy under a declared SSOT folder', () => {
    const paths = costHistoryPaths('repository');
    expect(paths.segments[0]).toBe('operations');
    expect(paths.committed).toBe(true);
  });

  it('marks the private location as uncommitted', () => {
    expect(costHistoryPaths('machine-private').committed).toBe(false);
  });

  it('returns segments rather than a joinable string, so no path can carry a traversal', () => {
    for (const location of ['repository', 'machine-private'] as const) {
      for (const segment of costHistoryPaths(location).segments) {
        expect(segment).not.toContain('..');
        expect(segment).not.toContain('/');
        expect(segment).not.toContain('\\');
      }
    }
  });
});

describe('switching location moves the history', () => {
  it('carries every record across when under the bound', () => {
    const migration = planCostHistoryMigration('machine-private', 'repository', [record(), record()]);
    expect(migration.movedCount).toBe(2);
    expect(migration.droppedCount).toBe(0);
  });

  it('keeps the newest when the bound bites, and reports the loss', () => {
    const many = Array.from({ length: COST_HISTORY_MAX_RECORDS + 3 }, (_unused, index) =>
      record({ taskId: `t${index}` }));
    const migration = planCostHistoryMigration('machine-private', 'repository', many);
    expect(migration.movedCount).toBe(COST_HISTORY_MAX_RECORDS);
    expect(migration.droppedCount).toBe(3);
    expect(migration.records[0]?.taskId).toBe('t3');
  });

  /** "Moved" with no number cannot be told from "moved nothing". */
  it('always states the count', () => {
    const message = describeCostHistoryMigration(
      planCostHistoryMigration('machine-private', 'repository', [record()]),
    );
    expect(message).toMatch(/Moved 1 cost record\b/);
  });

  it('says what was dropped when anything was', () => {
    const many = Array.from({ length: COST_HISTORY_MAX_RECORDS + 2 }, () => record());
    const message = describeCostHistoryMigration(planCostHistoryMigration('repository', 'machine-private', many));
    expect(message).toMatch(/2 older records/);
    expect(message).toContain(String(COST_HISTORY_MAX_RECORDS));
  });
});

describe('the commit warning names the file', () => {
  it('so somebody can go and look at it, or gitignore it', () => {
    const warning = costHistoryCommitWarning('project_memory/operations/cost-history.json');
    expect(warning).toContain('project_memory/operations/cost-history.json');
    expect(warning).toMatch(/committed/i);
  });
});

describe('reading a history written by an older build', () => {
  /**
   * The rule the whole store turns on. A record that predates these fields is
   * real spend and must load — but acquiring a zero cache-write count would make
   * it look repriceable, and acquiring the current workspace would put another
   * project's spend on this project's roadmap item.
   */
  it('does not invent the fields it lacks', () => {
    const parsed = sanitizeCostRecord({
      taskId: 't', agentId: 'a', model: 'm',
      inputTokens: 10, outputTokens: 2, costUsd: 0.5,
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(parsed).toBeDefined();
    expect(parsed).not.toHaveProperty('cacheWriteTokens');
    expect(parsed).not.toHaveProperty('workspaceKey');
    expect(parsed).not.toHaveProperty('roadmapItemId');
  });

  it('keeps a genuine zero, which is not the same as absent', () => {
    const parsed = sanitizeCostRecord({
      taskId: 't', agentId: 'a', model: 'm',
      inputTokens: 10, outputTokens: 2, costUsd: 0.5,
      timestamp: '2026-01-01T00:00:00.000Z', cacheWriteTokens: 0,
    });
    expect(parsed?.cacheWriteTokens).toBe(0);
  });

  it('rejects an entry missing the fields that make it a cost record', () => {
    expect(sanitizeCostRecord({ model: 'm' })).toBeUndefined();
    expect(sanitizeCostRecord(null)).toBeUndefined();
    expect(sanitizeCostRecord('nonsense')).toBeUndefined();
    expect(sanitizeCostRecord({ model: 'm', timestamp: 't', inputTokens: 'x', outputTokens: 1, costUsd: 1 }))
      .toBeUndefined();
  });

  it('ignores an unrecognised attribution rather than trusting it', () => {
    const parsed = sanitizeCostRecord({
      taskId: 't', agentId: 'a', model: 'm', inputTokens: 1, outputTokens: 1, costUsd: 1,
      timestamp: 'x', roadmapAttribution: 'assumed',
    });
    expect(parsed).not.toHaveProperty('roadmapAttribution');
  });
});

describe('the file round-trips and never throws', () => {
  it('writes and reads back the same records', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'atlasmind-cost-'));
    try {
      const file = path.join(dir, 'nested', 'cost-history.json');
      await writeCostHistoryFile(file, [record({ workspaceKey: '/repo', cacheWriteTokens: 4 })]);
      const read = await readCostHistoryFile(file);
      expect(read.existed).toBe(true);
      expect(read.records).toHaveLength(1);
      expect(read.records[0]?.cacheWriteTokens).toBe(4);
      expect(read.unreadableCount).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a missing file as absent rather than as an empty history', async () => {
    const read = await readCostHistoryFile(path.join(tmpdir(), 'atlasmind-does-not-exist', 'x.json'));
    expect(read.existed).toBe(false);
    expect(read.records).toEqual([]);
  });

  /** A caller must not overwrite a corrupt file believing there was nothing there. */
  it('reports a corrupt file as existing', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'atlasmind-cost-'));
    try {
      const file = path.join(dir, 'cost-history.json');
      await writeCostHistoryFile(file, []);
      const { promises } = await import('node:fs');
      await promises.writeFile(file, '{ not json', 'utf8');
      const read = await readCostHistoryFile(file);
      expect(read.existed).toBe(true);
      expect(read.records).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('counts entries it could not read rather than dropping them silently', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'atlasmind-cost-'));
    try {
      const file = path.join(dir, 'cost-history.json');
      const { promises } = await import('node:fs');
      await promises.writeFile(
        file,
        JSON.stringify({ version: 1, records: [record(), { rubbish: true }, null] }),
        'utf8',
      );
      const read = await readCostHistoryFile(file);
      expect(read.records).toHaveLength(1);
      expect(read.unreadableCount).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
