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
      providerId: 'local',
      pricingModel: 'free',
      billingCategory: 'free',
      inputTokens: 100,
      outputTokens: 20,
      costUsd: 0.001,
      budgetCostUsd: 0,
      timestamp: new Date().toISOString(),
    });

    tracker.record({
      taskId: 't2',
      agentId: 'a1',
      model: 'copilot/default',
      providerId: 'copilot',
      pricingModel: 'subscription',
      billingCategory: 'subscription-included',
      inputTokens: 50,
      outputTokens: 10,
      costUsd: 0.002,
      budgetCostUsd: 0,
      timestamp: new Date().toISOString(),
    });

    const summary = tracker.getSummary();
    expect(summary.totalRequests).toBe(2);
    expect(summary.totalInputTokens).toBe(150);
    expect(summary.totalOutputTokens).toBe(30);
    expect(summary.totalCostUsd).toBeCloseTo(0.003, 6);
    expect(summary.totalBudgetCostUsd).toBe(0);
    expect(summary.totalSubscriptionIncludedUsd).toBeCloseTo(0.002, 6);
  });

  it('resets all records', () => {
    const tracker = new CostTracker();
    tracker.record({
      taskId: 't1',
      agentId: 'a1',
      model: 'local/echo-1',
      providerId: 'local',
      pricingModel: 'free',
      billingCategory: 'free',
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
      budgetCostUsd: 0,
      timestamp: new Date().toISOString(),
    });

    tracker.reset();

    expect(tracker.getSummary()).toEqual({
      totalCostUsd: 0,
      totalBudgetCostUsd: 0,
      totalSubscriptionIncludedUsd: 0,
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
      providerId: 'local',
      pricingModel: 'pay-per-token',
      billingCategory: 'pay-per-token',
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 1,
      budgetCostUsd: 1,
      timestamp: new Date().toISOString(),
    });

    const status = tracker.getDailyBudgetStatus(0.01);
    expect(status?.blocked).toBe(true);
    expect(status?.reason).toContain('New requests are blocked');
  });

  it('excludes subscription-included usage from daily budget while preserving it in totals', () => {
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
      get: (key: string, fallback?: unknown) => key === 'dailyCostLimitUsd' ? 0.5 : fallback,
    } as never);

    const tracker = new CostTracker();
    tracker.record({
      taskId: 't1',
      agentId: 'a1',
      model: 'copilot/default',
      providerId: 'copilot',
      pricingModel: 'subscription',
      billingCategory: 'subscription-included',
      inputTokens: 120,
      outputTokens: 40,
      costUsd: 0.25,
      budgetCostUsd: 0,
      timestamp: new Date().toISOString(),
    });

    tracker.record({
      taskId: 't2',
      agentId: 'a1',
      model: 'openai/gpt-4.1',
      providerId: 'openai',
      pricingModel: 'pay-per-token',
      billingCategory: 'pay-per-token',
      inputTokens: 120,
      outputTokens: 40,
      costUsd: 0.3,
      budgetCostUsd: 0.3,
      timestamp: new Date().toISOString(),
    });

    const summary = tracker.getSummary();
    expect(summary.totalCostUsd).toBeCloseTo(0.55, 6);
    expect(summary.totalBudgetCostUsd).toBeCloseTo(0.3, 6);
    expect(summary.totalSubscriptionIncludedUsd).toBeCloseTo(0.25, 6);

    const filteredSummary = tracker.getSummary({ excludeSubscriptionIncluded: true });
    expect(filteredSummary.totalCostUsd).toBeCloseTo(0.3, 6);
    expect(filteredSummary.totalRequests).toBe(1);

    const status = tracker.getDailyBudgetStatus(0.19);
    expect(status?.blocked).toBe(false);

    const overflowStatus = tracker.getDailyBudgetStatus(0.25);
    expect(overflowStatus?.blocked).toBe(true);
  });
});
