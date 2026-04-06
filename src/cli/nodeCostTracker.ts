import type { CostRecord } from '../types.js';

export interface CliCostSummary {
  totalCostUsd: number;
  totalRequests: number;
}

export class NodeCostTracker {
  private readonly records: CostRecord[] = [];

  constructor(private readonly dailyLimitUsd = 0) {}

  record(entry: CostRecord): void {
    this.records.push(entry);
  }

  getSummary(): CliCostSummary {
    return {
      totalCostUsd: this.records.reduce((sum, record) => sum + record.costUsd, 0),
      totalRequests: this.records.length,
    };
  }

  getDailyBudgetStatus(projectedAdditionalCostUsd = 0): {
    limitUsd: number;
    todayCostUsd: number;
    remainingUsd: number;
    projectedTotalUsd: number;
    blocked: boolean;
    reason?: string;
  } | undefined {
    if (this.dailyLimitUsd <= 0) {
      return undefined;
    }

    const today = new Date().toISOString().slice(0, 10);
    const todayCostUsd = this.records
      .filter(record => record.timestamp.slice(0, 10) === today)
      .reduce((sum, record) => sum + record.costUsd, 0);
    const projectedTotalUsd = todayCostUsd + Math.max(0, projectedAdditionalCostUsd);
    const remainingUsd = Math.max(0, this.dailyLimitUsd - todayCostUsd);

    if (todayCostUsd >= this.dailyLimitUsd || projectedTotalUsd > this.dailyLimitUsd) {
      return {
        limitUsd: this.dailyLimitUsd,
        todayCostUsd,
        remainingUsd,
        projectedTotalUsd,
        blocked: true,
        reason: `AtlasMind CLI blocked this request because the daily budget of $${this.dailyLimitUsd.toFixed(2)} would be exceeded.`,
      };
    }

    return {
      limitUsd: this.dailyLimitUsd,
      todayCostUsd,
      remainingUsd,
      projectedTotalUsd,
      blocked: false,
    };
  }
}