import * as vscode from 'vscode';
import type { CostRecord } from '../types.js';

export interface CostSummary {
  totalCostUsd: number;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface DailyBudgetStatus {
  limitUsd: number;
  todayCostUsd: number;
  remainingUsd: number;
  projectedTotalUsd: number;
  blocked: boolean;
  reason?: string;
}

interface PersistedCostData {
  records: CostRecord[];
  dailyTotals: Record<string, number>;
}

const STORAGE_KEY = 'atlasmind.costHistory';
const MAX_PERSISTED_RECORDS = 500;

/**
 * Tracks cost across all requests with optional persistence and budget alerts.
 */
export class CostTracker {
  private records: CostRecord[] = [];
  private dailyTotals: Record<string, number> = {};
  private globalState: vscode.Memento | undefined;
  private budgetAlertLevel: 'none' | 'warning' | 'limit' = 'none';

  /** Optionally attach globalState for persistence across sessions. */
  attachStorage(globalState: vscode.Memento): void {
    this.globalState = globalState;
    this.loadFromStorage();
  }

  record(entry: CostRecord): void {
    this.records.push(entry);
    const day = entry.timestamp.slice(0, 10);
    this.dailyTotals[day] = (this.dailyTotals[day] ?? 0) + entry.costUsd;
    this.persist();
    this.checkBudgetAlert();
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

  /** Cost for today's date. */
  getTodayCostUsd(): number {
    const today = new Date().toISOString().slice(0, 10);
    return this.dailyTotals[today] ?? 0;
  }

  getRecords(): readonly CostRecord[] {
    return this.records;
  }

  getDailyBudgetStatus(projectedAdditionalCostUsd = 0): DailyBudgetStatus | undefined {
    const config = vscode.workspace.getConfiguration('atlasmind');
    const limitUsd = config.get<number>('dailyCostLimitUsd', 0);
    if (limitUsd <= 0) {
      return undefined;
    }

    const todayCostUsd = this.getTodayCostUsd();
    const projectedTotalUsd = todayCostUsd + Math.max(0, projectedAdditionalCostUsd);
    const remainingUsd = Math.max(0, limitUsd - todayCostUsd);

    if (todayCostUsd >= limitUsd) {
      return {
        limitUsd,
        todayCostUsd,
        remainingUsd: 0,
        projectedTotalUsd,
        blocked: true,
        reason:
          `AtlasMind has reached the daily cost limit of $${limitUsd.toFixed(2)} ` +
          `($${todayCostUsd.toFixed(4)} spent today). New requests are blocked until the limit is raised or the day rolls over.`,
      };
    }

    if (projectedAdditionalCostUsd > 0 && projectedTotalUsd > limitUsd) {
      return {
        limitUsd,
        todayCostUsd,
        remainingUsd,
        projectedTotalUsd,
        blocked: true,
        reason:
          `This request is blocked because AtlasMind has $${remainingUsd.toFixed(4)} remaining in today's ` +
          `$${limitUsd.toFixed(2)} budget, and the estimated minimum request cost would push it over the cap.`,
      };
    }

    return {
      limitUsd,
      todayCostUsd,
      remainingUsd,
      projectedTotalUsd,
      blocked: false,
    };
  }

  reset(): void {
    this.records = [];
    this.dailyTotals = {};
    this.budgetAlertLevel = 'none';
    this.persist();
  }

  private loadFromStorage(): void {
    if (!this.globalState) { return; }
    const data = this.globalState.get<PersistedCostData>(STORAGE_KEY);
    if (data) {
      this.records = data.records ?? [];
      this.dailyTotals = data.dailyTotals ?? {};
    }
  }

  private persist(): void {
    if (!this.globalState) { return; }
    const trimmed = this.records.slice(-MAX_PERSISTED_RECORDS);
    void this.globalState.update(STORAGE_KEY, {
      records: trimmed,
      dailyTotals: this.dailyTotals,
    } satisfies PersistedCostData);
  }

  private checkBudgetAlert(): void {
    const budget = this.getDailyBudgetStatus();
    if (!budget) {
      return;
    }

    if (budget.todayCostUsd >= budget.limitUsd && this.budgetAlertLevel !== 'limit') {
      this.budgetAlertLevel = 'limit';
      void vscode.window.showErrorMessage(
        `AtlasMind has reached today's cost limit of $${budget.limitUsd.toFixed(2)}. ` +
        `New requests are now blocked until you raise the limit or the day rolls over.`,
      );
      return;
    }

    if (budget.todayCostUsd >= budget.limitUsd * 0.8 && this.budgetAlertLevel === 'none') {
      this.budgetAlertLevel = 'warning';
      void vscode.window.showInformationMessage(
        `AtlasMind daily cost is at $${budget.todayCostUsd.toFixed(4)}, approaching limit of $${budget.limitUsd.toFixed(2)}.`,
      );
    }
  }
}
