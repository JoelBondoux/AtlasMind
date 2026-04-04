import * as vscode from 'vscode';
import type { CostRecord } from '../types.js';

export interface CostSummary {
  totalCostUsd: number;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
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
  private budgetAlertShown = false;

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

  reset(): void {
    this.records = [];
    this.dailyTotals = {};
    this.budgetAlertShown = false;
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
    if (this.budgetAlertShown) { return; }
    const config = vscode.workspace.getConfiguration('atlasmind');
    const limit = config.get<number>('dailyCostLimitUsd', 0);
    if (limit <= 0) { return; }
    const todayCost = this.getTodayCostUsd();
    if (todayCost >= limit) {
      this.budgetAlertShown = true;
      void vscode.window.showWarningMessage(
        `AtlasMind daily cost has reached $${todayCost.toFixed(4)} (limit: $${limit.toFixed(2)}). ` +
        `Requests will continue unless you stop manually. Adjust the limit in Settings → Budget.`,
      );
    } else if (todayCost >= limit * 0.8) {
      this.budgetAlertShown = true;
      void vscode.window.showInformationMessage(
        `AtlasMind daily cost is at $${todayCost.toFixed(4)}, approaching limit of $${limit.toFixed(2)}.`,
      );
    }
  }
}
