import * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import { CostTracker } from '../../src/core/costTracker.ts';

describe('CostTracker', () => {
  it('aggregates records into a summary', () => {
    const tracker = new CostTracker();

    tracker.record({
      taskId: 't1',
      agentId: 'a1',
      model: 'local/echo-1',
      inputTokens: 100,
      outputTokens: 20,
      costUsd: 0.001,
      timestamp: new Date().toISOString(),
    });

    tracker.record({
      taskId: 't2',
      agentId: 'a1',
      model: 'copilot/default',
      inputTokens: 50,
      outputTokens: 10,
      costUsd: 0.002,
      timestamp: new Date().toISOString(),
    });

    const summary = tracker.getSummary();
    expect(summary.totalRequests).toBe(2);
    expect(summary.totalInputTokens).toBe(150);
    expect(summary.totalOutputTokens).toBe(30);
    expect(summary.totalCostUsd).toBeCloseTo(0.003, 6);
  });

  it('resets all records', () => {
    const tracker = new CostTracker();
    tracker.record({
      taskId: 't1',
      agentId: 'a1',
      model: 'local/echo-1',
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
      timestamp: new Date().toISOString(),
    });

    tracker.reset();

    expect(tracker.getSummary()).toEqual({
      totalCostUsd: 0,
      totalRequests: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
    });
  });

  it('reports a blocked daily budget once the cap is reached', () => {
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
      get: (key: string, fallback?: unknown) => key === 'dailyCostLimitUsd' ? 1 : fallback,
    } as never);

    const tracker = new CostTracker();
    tracker.record({
      taskId: 't1',
      agentId: 'a1',
      model: 'local/echo-1',
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 1,
      timestamp: new Date().toISOString(),
    });

    const status = tracker.getDailyBudgetStatus(0.01);
    expect(status?.blocked).toBe(true);
    expect(status?.reason).toContain('New requests are blocked');
  });
});
