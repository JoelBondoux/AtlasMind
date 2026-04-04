import type * as vscode from 'vscode';
import type { ProjectRunRecord } from '../types.js';

const STORAGE_KEY = 'atlasmind.projectRunHistory';
const MAX_RUNS = 40;

export class ProjectRunHistory {
  constructor(private readonly state: Pick<vscode.Memento, 'get' | 'update'>) {}

  listRuns(limit = MAX_RUNS): ProjectRunRecord[] {
    return this.readRuns().slice(0, Math.max(1, limit));
  }

  getRun(runId: string): ProjectRunRecord | undefined {
    return this.readRuns().find(run => run.id === runId);
  }

  async upsertRun(run: ProjectRunRecord): Promise<void> {
    const runs = this.readRuns().filter(existing => existing.id !== run.id);
    runs.unshift(sanitizeRun(run));
    await this.state.update(STORAGE_KEY, runs.slice(0, MAX_RUNS));
  }

  private readRuns(): ProjectRunRecord[] {
    const raw = this.state.get<ProjectRunRecord[]>(STORAGE_KEY, []);
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .filter(isProjectRunRecord)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
}

function sanitizeRun(run: ProjectRunRecord): ProjectRunRecord {
  return {
    ...run,
    failedSubtaskTitles: [...run.failedSubtaskTitles],
    logs: run.logs.map(log => ({ ...log })),
    summary: run.summary
      ? {
        ...run.summary,
        subTaskResults: run.summary.subTaskResults.map(item => ({ ...item })),
        changedFiles: run.summary.changedFiles.map(file => ({ ...file })),
        fileAttribution: Object.fromEntries(
          Object.entries(run.summary.fileAttribution).map(([key, value]) => [key, [...value]]),
        ),
      }
      : undefined,
  };
}

function isProjectRunRecord(value: unknown): value is ProjectRunRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const run = value as Record<string, unknown>;
  return typeof run['id'] === 'string'
    && typeof run['goal'] === 'string'
    && typeof run['status'] === 'string'
    && typeof run['createdAt'] === 'string'
    && typeof run['updatedAt'] === 'string'
    && typeof run['estimatedFiles'] === 'number'
    && typeof run['requiresApproval'] === 'boolean'
    && typeof run['planSubtaskCount'] === 'number'
    && typeof run['completedSubtaskCount'] === 'number'
    && typeof run['totalSubtaskCount'] === 'number'
    && typeof run['currentBatch'] === 'number'
    && typeof run['totalBatches'] === 'number'
    && Array.isArray(run['failedSubtaskTitles'])
    && Array.isArray(run['logs']);
}