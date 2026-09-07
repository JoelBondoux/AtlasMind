import * as vscode from 'vscode';
import type { CostRecord } from '../types.js';
import { formatCost } from './currencyFormatter.js';
import { normalizeWorkspaceKey } from './projectRunHistory.js';
import { recordsForWorkspace, summarizeRepricingCoverage, type RepricingCoverage } from './costRepricing.js';
import { deleteCostHistoryFile, readCostHistoryFile, writeCostHistoryFile } from './costHistoryFileStore.js';
import {
  describeCostHistoryMigration,
  planCostHistoryMigration,
  type CostHistoryLocation,
} from './costHistoryLocation.js';

export interface CostSummary {
  totalCostUsd: number;
  totalBudgetCostUsd: number;
  totalSubscriptionIncludedUsd: number;
  totalCompressionSavingsUsd: number;
  totalCacheSavingsUsd: number;
  totalCachedInputTokens: number;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface CostQueryOptions {
  days?: number;
  period?: 'mtd' | 'qtd' | 'ytd' | 'all';
  excludeSubscriptionIncluded?: boolean;
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

function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Tracks cost across all requests with optional persistence and budget alerts.
 */
export class CostTracker {
  private records: CostRecord[] = [];
  private dailyTotals: Record<string, number> = {};
  private globalState: vscode.Memento | undefined;
  private budgetAlertLevel: 'none' | 'warning' | 'limit' = 'none';
  private workspaceKey: string | undefined;
  /** When set, the file is authoritative and `globalState` is no longer written. */
  private historyFilePath: string | undefined;
  private historyLocation: CostHistoryLocation | undefined;
  private pendingWrite: ReturnType<typeof setTimeout> | undefined;

  /** Optionally attach globalState for persistence across sessions. */
  attachStorage(globalState: vscode.Memento): void {
    this.globalState = globalState;
    this.loadFromStorage();
  }

  /**
   * The workspace new records belong to.
   *
   * Normalized through `projectRunHistory`'s function rather than a copy, so a
   * cost record and a run record produced on the same machine key identically
   * — the join between them is what makes cost-per-roadmap-item possible, and
   * two normalizers would break it silently rather than loudly.
   */
  setWorkspaceKey(workspaceKey: string | undefined): void {
    this.workspaceKey = normalizeWorkspaceKey(workspaceKey);
  }

  /**
   * Records for the attached workspace only.
   *
   * Storage is machine-wide, so without this every project's spend is in one
   * list. Records predating `workspaceKey` are excluded rather than assumed to
   * be this project's — see `recordsForWorkspace`.
   */
  getWorkspaceRecords(options?: CostQueryOptions): readonly CostRecord[] {
    if (!this.workspaceKey) { return []; }
    return recordsForWorkspace(this.filterRecords(options), this.workspaceKey);
  }

  /** How much of the history can honestly carry a counterfactual figure. */
  getRepricingCoverage(options?: CostQueryOptions): RepricingCoverage {
    return summarizeRepricingCoverage(this.filterRecords(options));
  }

  /**
   * Make a file the authoritative history.
   *
   * On first attach, a `globalState` history left by an earlier build is adopted
   * rather than abandoned — months of spend must not vanish because the storage
   * moved. Adoption happens only when the file does not yet exist, so a real
   * file is never overwritten by stale editor state.
   */
  async attachHistoryFile(
    filePath: string,
    location: CostHistoryLocation,
  ): Promise<{ adoptedFromEditorState: number; unreadableCount: number }> {
    this.historyFilePath = filePath;
    this.historyLocation = location;

    const read = await readCostHistoryFile(filePath);
    if (read.existed) {
      this.records = read.records;
      this.dailyTotals = this.buildDailyTotals(this.records);
      return { adoptedFromEditorState: 0, unreadableCount: read.unreadableCount };
    }

    const legacy = this.records;
    if (legacy.length > 0) {
      await writeCostHistoryFile(filePath, legacy);
    }
    return { adoptedFromEditorState: legacy.length, unreadableCount: 0 };
  }

  /**
   * Move the history to a new location, reporting what moved.
   *
   * The old file is removed only after the new one is written, so an
   * interruption leaves two copies rather than none.
   */
  async moveHistoryTo(
    filePath: string,
    location: CostHistoryLocation,
  ): Promise<string> {
    const previousPath = this.historyFilePath;
    const migration = planCostHistoryMigration(
      this.historyLocation ?? 'machine-private',
      location,
      this.records,
    );
    await writeCostHistoryFile(filePath, migration.records);
    if (previousPath && previousPath !== filePath) {
      await deleteCostHistoryFile(previousPath);
    }
    this.records = [...migration.records];
    this.dailyTotals = this.buildDailyTotals(this.records);
    this.historyFilePath = filePath;
    this.historyLocation = location;
    return describeCostHistoryMigration(migration);
  }

  /**
   * Write any pending history now.
   *
   * Called on deactivate: the debounce below exists so a busy session does not
   * rewrite a five-thousand-record file per request, and without a flush the
   * last few records of every session would be the ones lost.
   */
  async flushHistory(): Promise<void> {
    if (this.pendingWrite) {
      clearTimeout(this.pendingWrite);
      this.pendingWrite = undefined;
    }
    if (this.historyFilePath) {
      await writeCostHistoryFile(this.historyFilePath, this.records);
    }
  }

  private scheduleHistoryWrite(): void {
    if (!this.historyFilePath) { return; }
    if (this.pendingWrite) { clearTimeout(this.pendingWrite); }
    this.pendingWrite = setTimeout(() => {
      this.pendingWrite = undefined;
      const target = this.historyFilePath;
      if (!target) { return; }
      // Fire and forget: a failed history write must never fail the request that
      // produced the record. The next write retries the whole file anyway.
      void writeCostHistoryFile(target, this.records).catch(() => undefined);
    }, 2000);
  }

  record(entry: CostRecord): void {
    // Stamped here rather than at each call site: there are several, and one
    // that forgot would produce spend attributable to no project, which reads
    // on the dashboard as a project that cost nothing.
    const stamped: CostRecord = entry.workspaceKey || !this.workspaceKey
      ? entry
      : { ...entry, workspaceKey: this.workspaceKey };
    this.records.push(stamped);
    const day = localIsoDate(new Date(entry.timestamp));
    this.dailyTotals[day] = (this.dailyTotals[day] ?? 0) + this.getBudgetCostUsd(entry);
    this.persist();
    this.checkBudgetAlert();
  }

  getSummary(options?: CostQueryOptions): CostSummary {
    let totalCostUsd = 0;
    let totalBudgetCostUsd = 0;
    let totalSubscriptionIncludedUsd = 0;
    let totalCompressionSavingsUsd = 0;
    let totalCacheSavingsUsd = 0;
    let totalCachedInputTokens = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    const records = this.filterRecords(options);

    for (const r of records) {
      totalCostUsd += r.costUsd;
      totalBudgetCostUsd += this.getBudgetCostUsd(r);
      totalCompressionSavingsUsd += r.compressionSavingsUsd ?? 0;
      totalCacheSavingsUsd += r.cacheSavingsUsd ?? 0;
      totalCachedInputTokens += r.cachedInputTokens ?? 0;
      if (this.isSubscriptionIncludedRecord(r)) {
        totalSubscriptionIncludedUsd += r.costUsd;
      }
      totalInputTokens += r.inputTokens;
      totalOutputTokens += r.outputTokens;
    }

    return {
      totalCostUsd,
      totalBudgetCostUsd,
      totalSubscriptionIncludedUsd,
      totalCompressionSavingsUsd,
      totalCacheSavingsUsd,
      totalCachedInputTokens,
      totalRequests: records.length,
      totalInputTokens,
      totalOutputTokens,
    };
  }

  /** Budget-affecting cost for today's date (local time). */
  getTodayCostUsd(): number {
    const today = localIsoDate(new Date());
    return this.dailyTotals[today] ?? 0;
  }

  getRecords(options?: CostQueryOptions): readonly CostRecord[] {
    return this.filterRecords(options);
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
          `AtlasMind has reached the daily cost limit of ${formatCost(limitUsd, 2)} ` +
          `(${formatCost(todayCostUsd, 4)} spent today). New requests are blocked until the limit is raised or the day rolls over.`,
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
          `This request is blocked because AtlasMind has ${formatCost(remainingUsd, 4)} remaining in today's ` +
          `${formatCost(limitUsd, 2)} budget, and the estimated minimum request cost would push it over the cap.`,
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
      this.dailyTotals = this.buildDailyTotals(this.records);
    }
  }

  private persist(): void {
    // Once a history file is attached it is authoritative, and `globalState`
    // stops being written. Writing both would leave two histories that diverge,
    // and the next attach would have to guess which one is real.
    if (this.historyFilePath) {
      this.scheduleHistoryWrite();
      return;
    }
    if (!this.globalState) { return; }
    const trimmed = this.records.slice(-MAX_PERSISTED_RECORDS);
    void this.globalState.update(STORAGE_KEY, {
      records: trimmed,
      dailyTotals: this.buildDailyTotals(trimmed),
    } satisfies PersistedCostData);
  }

  private filterRecords(options?: CostQueryOptions): CostRecord[] {
    const cutoffDate = this.resolveCutoffDate(options);

    return this.records.filter(record => {
      if (cutoffDate && record.timestamp.slice(0, 10) < cutoffDate) {
        return false;
      }
      if (options?.excludeSubscriptionIncluded && this.isSubscriptionIncludedRecord(record)) {
        return false;
      }
      return true;
    });
  }

  private buildDailyTotals(records: readonly CostRecord[]): Record<string, number> {
    const totals: Record<string, number> = {};
    for (const record of records) {
      const day = localIsoDate(new Date(record.timestamp));
      totals[day] = (totals[day] ?? 0) + this.getBudgetCostUsd(record);
    }
    return totals;
  }

  private isSubscriptionIncludedRecord(record: CostRecord): boolean {
    return record.billingCategory === 'subscription-included';
  }

  private getBudgetCostUsd(record: CostRecord): number {
    return Math.max(0, record.budgetCostUsd ?? record.costUsd);
  }

  private getLocalDayOffset(daysAgo: number): string {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return localIsoDate(date);
  }

  private checkBudgetAlert(): void {
    const budget = this.getDailyBudgetStatus();
    if (!budget) {
      return;
    }

    if (budget.todayCostUsd >= budget.limitUsd && this.budgetAlertLevel !== 'limit') {
      this.budgetAlertLevel = 'limit';
      void vscode.window.showErrorMessage(
        `AtlasMind has reached today's cost limit of ${formatCost(budget.limitUsd, 2)}. ` +
        `New requests are now blocked until you raise the limit or the day rolls over.`,
      );
      return;
    }

    if (budget.todayCostUsd >= budget.limitUsd * 0.8 && this.budgetAlertLevel === 'none') {
      this.budgetAlertLevel = 'warning';
      void vscode.window.showInformationMessage(
        `AtlasMind daily cost is at ${formatCost(budget.todayCostUsd, 4)}, approaching limit of ${formatCost(budget.limitUsd, 2)}.`,
      );
    }
  }

  private resolveCutoffDate(options?: CostQueryOptions): string | undefined {
    if (options?.period === 'all') {
      return undefined;
    }

    if (options?.period) {
      const now = new Date();
      switch (options.period) {
        case 'mtd':
          now.setDate(1);
          return localIsoDate(now);
        case 'qtd': {
          const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
          now.setMonth(quarterStartMonth, 1);
          return localIsoDate(now);
        }
        case 'ytd':
          now.setMonth(0, 1);
          return localIsoDate(now);
        default:
          break;
      }
    }

    const days = options?.days && Number.isFinite(options.days)
      ? Math.max(1, Math.floor(options.days))
      : undefined;
    return days ? this.getLocalDayOffset(days - 1) : undefined;
  }
}
