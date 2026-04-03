import type { CostRecord } from '../types.js';

export interface CostSummary {
  totalCostUsd: number;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

/**
 * Tracks cost across all requests in the current session.
 */
export class CostTracker {
  private records: CostRecord[] = [];

  record(entry: CostRecord): void {
    this.records.push(entry);
  }

  getSummary(): CostSummary {
    let totalCostUsd = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const r of this.records) {
      totalCostUsd += r.costUsd;
      totalInputTokens += r.inputTokens;
      totalOutputTokens += r.outputTokens;
    }

    return {
      totalCostUsd,
      totalRequests: this.records.length,
      totalInputTokens,
      totalOutputTokens,
    };
  }

  getRecords(): readonly CostRecord[] {
    return this.records;
  }

  reset(): void {
    this.records = [];
  }
}
