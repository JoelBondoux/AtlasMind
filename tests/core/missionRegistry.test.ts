import { describe, expect, it, vi } from 'vitest';
import {
  MissionRegistry,
  renderMissionsMarkdown,
  toPersistedRecord,
} from '../../src/core/missionRegistry.ts';
import type { MissionRunRecord } from '../../src/types.ts';

function makeRecord(over: Partial<MissionRunRecord> = {}): MissionRunRecord {
  return {
    id: 'mission-1',
    goal: 'Add a feature',
    status: 'completed',
    createdAt: '2026-06-20T10:00:00.000Z',
    updatedAt: '2026-06-20T10:30:00.000Z',
    achieved: true,
    stopReason: 'goal-achieved',
    totalCostUsd: 0.42,
    totalInputTokens: 1000,
    totalOutputTokens: 500,
    totalDurationMs: 1800000,
    createdCapabilities: [],
    config: {
      id: 'mission-1',
      goal: 'Add a feature',
      guardrails: { instructions: ['do not touch auth'], protectedPaths: ['src/auth/'] },
      budget: { maxIterations: 8, maxCostUsd: 5, maxTokens: 2000000, maxDurationMs: 1800000, maxConsecutiveNoProgress: 2 },
      checkpointPolicy: { everyNIterations: 3 },
      constraints: { budget: 'balanced', speed: 'balanced' },
      allowDiscovery: true,
    },
    iterations: [
      {
        index: 1,
        plan: { id: 'p1', goal: 'Add a feature', subTasks: [] },
        synthesis: 'made progress',
        verdict: { verdict: 'achieved', confidence: 0.9, remaining: [], nextFocus: 'ship', rationale: 'done' },
        costUsd: 0.42,
        inputTokens: 1000,
        outputTokens: 500,
        durationMs: 1800000,
        changedFiles: [{ relativePath: 'src/a.ts', status: 'modified' }],
        createdCapabilities: [],
        subTaskResults: [],
      },
    ],
    ...over,
  };
}

describe('toPersistedRecord', () => {
  it('trims long synthesis text to a bounded preview', () => {
    const big = 'x'.repeat(10_000);
    const rec = makeRecord();
    rec.iterations[0].synthesis = big;
    const persisted = toPersistedRecord(rec);
    expect(persisted.iterations[0].synthesis.length).toBeLessThan(big.length);
    expect(persisted.iterations[0].synthesis).toContain('[trimmed for audit]');
  });

  it('drops heavy subtask artifacts and trims subtask output', () => {
    const rec = makeRecord();
    rec.iterations[0].subTaskResults = [
      {
        subTaskId: 's1',
        title: 'T',
        status: 'completed',
        output: 'y'.repeat(10_000),
        costUsd: 0.1,
        durationMs: 10,
        artifacts: {
          output: 'big',
          outputPreview: 'big',
          toolCallCount: 3,
          toolCalls: [],
          checkpointedTools: [],
          changedFiles: [],
        },
      },
    ];
    const persisted = toPersistedRecord(rec);
    expect(persisted.iterations[0].subTaskResults[0].artifacts).toBeUndefined();
    expect(persisted.iterations[0].subTaskResults[0].output).toContain('[trimmed for audit]');
  });

  it('dedupes created capabilities by kind:id', () => {
    const rec = makeRecord({
      createdCapabilities: [
        { kind: 'skill', id: 'web-fetch', name: 'Web Fetch', source: 'registry' },
        { kind: 'skill', id: 'web-fetch', name: 'Web Fetch', source: 'synthesized' },
        { kind: 'agent', id: 'web-fetch', name: 'Web Fetch agent', source: 'synthesized' },
      ],
    });
    const persisted = toPersistedRecord(rec);
    expect(persisted.createdCapabilities).toHaveLength(2);
  });
});

describe('renderMissionsMarkdown', () => {
  it('renders an empty-state message when there are no missions', () => {
    expect(renderMissionsMarkdown([])).toContain('No missions have been run yet');
  });

  it('renders goal, outcome, guardrails, and an iteration table', () => {
    const md = renderMissionsMarkdown([makeRecord()]);
    expect(md).toContain('## Add a feature');
    expect(md).toContain('goal achieved');
    expect(md).toContain('do not touch auth');
    expect(md).toContain('`src/auth/`');
    expect(md).toContain('| # | Verdict | Confidence | Cost | Files | Next focus |');
    expect(md).toContain('| 1 | achieved | 90% |');
  });

  it('escapes pipe characters in the next-focus cell', () => {
    const rec = makeRecord();
    rec.iterations[0].verdict.nextFocus = 'do a | b';
    const md = renderMissionsMarkdown([rec]);
    expect(md).toContain('do a \\| b');
  });
});

describe('MissionRegistry — live state', () => {
  it('listActive returns only running and awaiting-checkpoint missions', async () => {
    const registry = new MissionRegistry(undefined); // no workspace → in-memory only
    await registry.save(makeRecord({ id: 'm-run', status: 'running' }));
    await registry.save(makeRecord({ id: 'm-wait', status: 'awaiting-checkpoint' }));
    await registry.save(makeRecord({ id: 'm-done', status: 'completed' }));
    await registry.save(makeRecord({ id: 'm-fail', status: 'failed' }));

    const activeIds = registry.listActive().map(m => m.id).sort();
    expect(activeIds).toEqual(['m-run', 'm-wait']);
  });

  it('notifies subscribers on save and stops after dispose', async () => {
    const registry = new MissionRegistry(undefined);
    const listener = vi.fn();
    const sub = registry.onChange(listener);

    await registry.save(makeRecord({ id: 'm-1', status: 'running' }));
    expect(listener).toHaveBeenCalledTimes(1);

    await registry.save(makeRecord({ id: 'm-1', status: 'completed' }));
    expect(listener).toHaveBeenCalledTimes(2);

    sub.dispose();
    await registry.save(makeRecord({ id: 'm-2', status: 'running' }));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('isolates a throwing subscriber from others', async () => {
    const registry = new MissionRegistry(undefined);
    const good = vi.fn();
    registry.onChange(() => { throw new Error('boom'); });
    registry.onChange(good);

    await expect(registry.save(makeRecord({ id: 'm-x', status: 'running' }))).resolves.toBeUndefined();
    expect(good).toHaveBeenCalledTimes(1);
  });
});
