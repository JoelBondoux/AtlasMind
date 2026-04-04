import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import type { ProjectRunRecord } from '../types.js';

const STORAGE_KEY = 'atlasmind.projectRunHistory';
import { MAX_PROJECT_RUNS } from '../constants.js';

export class ProjectRunHistory {
  private diskDir: string | undefined;

  constructor(private readonly state: Pick<vscode.Memento, 'get' | 'update'>) {}

  /**
   * Enable disk-based storage. Run history is written as individual JSON
   * files to this directory instead of a single globalState blob.
   */
  enableDiskStorage(directoryPath: string): void {
    this.diskDir = directoryPath;
    void this.migrateFromGlobalState();
  }

  listRuns(limit = MAX_PROJECT_RUNS): ProjectRunRecord[] {
    // Read from globalState (synchronous fallback) — disk reads are async
    return this.readRunsFromState().slice(0, Math.max(1, limit));
  }

  async listRunsAsync(limit = MAX_PROJECT_RUNS): Promise<ProjectRunRecord[]> {
    if (this.diskDir) {
      return (await this.readRunsFromDisk()).slice(0, Math.max(1, limit));
    }
    return this.readRunsFromState().slice(0, Math.max(1, limit));
  }

  getRun(runId: string): ProjectRunRecord | undefined {
    return this.readRunsFromState().find(run => run.id === runId);
  }

  async getRunAsync(runId: string): Promise<ProjectRunRecord | undefined> {
    if (this.diskDir) {
      const filePath = path.join(this.diskDir, `${sanitizeFileName(runId)}.json`);
      try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (isProjectRunRecord(parsed)) { return parsed; }
      } catch { /* not found */ }
    }
    return this.readRunsFromState().find(run => run.id === runId);
  }

  async upsertRun(run: ProjectRunRecord): Promise<void> {
    const sanitized = sanitizeRun(run);

    // Write to disk if available
    if (this.diskDir) {
      await fs.mkdir(this.diskDir, { recursive: true });
      const filePath = path.join(this.diskDir, `${sanitizeFileName(run.id)}.json`);
      await fs.writeFile(filePath, JSON.stringify(sanitized, null, 2), 'utf-8');
    }

    // Keep globalState as a lightweight index for synchronous reads
    const runs = this.readRunsFromState().filter(existing => existing.id !== run.id);
    runs.unshift(sanitized);
    await this.state.update(STORAGE_KEY, runs.slice(0, MAX_PROJECT_RUNS));
  }

  private readRunsFromState(): ProjectRunRecord[] {
    const raw = this.state.get<ProjectRunRecord[]>(STORAGE_KEY, []);
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .filter(isProjectRunRecord)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private async readRunsFromDisk(): Promise<ProjectRunRecord[]> {
    if (!this.diskDir) { return this.readRunsFromState(); }
    try {
      const files = await fs.readdir(this.diskDir);
      const runs: ProjectRunRecord[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) { continue; }
        try {
          const raw = await fs.readFile(path.join(this.diskDir, file), 'utf-8');
          const parsed = JSON.parse(raw);
          if (isProjectRunRecord(parsed)) { runs.push(parsed); }
        } catch { /* skip corrupt files */ }
      }
      return runs
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, MAX_PROJECT_RUNS);
    } catch {
      return this.readRunsFromState();
    }
  }

  /** Migrate existing globalState runs to disk on first enable. */
  private async migrateFromGlobalState(): Promise<void> {
    if (!this.diskDir) { return; }
    const existing = this.readRunsFromState();
    if (existing.length === 0) { return; }
    await fs.mkdir(this.diskDir, { recursive: true });
    for (const run of existing) {
      const filePath = path.join(this.diskDir, `${sanitizeFileName(run.id)}.json`);
      try {
        await fs.access(filePath);
        // Already migrated
      } catch {
        await fs.writeFile(filePath, JSON.stringify(run, null, 2), 'utf-8');
      }
    }
  }
}

function sanitizeRun(run: ProjectRunRecord): ProjectRunRecord {
  return {
    ...run,
    failedSubtaskTitles: [...run.failedSubtaskTitles],
    plan: run.plan
      ? {
        ...run.plan,
        subTasks: run.plan.subTasks.map(task => ({ ...task, skills: [...task.skills], dependsOn: [...task.dependsOn] })),
      }
      : undefined,
    logs: run.logs.map(log => ({ ...log })),
    subTaskArtifacts: run.subTaskArtifacts.map(artifact => ({
      ...artifact,
      dependsOn: [...artifact.dependsOn],
      toolCalls: artifact.toolCalls.map(tool => ({ ...tool })),
      checkpointedTools: [...artifact.checkpointedTools],
      changedFiles: artifact.changedFiles.map(file => ({ ...file })),
    })),
    summary: run.summary
      ? {
        ...run.summary,
        subTaskResults: run.summary.subTaskResults.map(item => ({ ...item })),
        changedFiles: run.summary.changedFiles.map(file => ({ ...file })),
        fileAttribution: Object.fromEntries(
          Object.entries(run.summary.fileAttribution).map(([key, value]) => [key, [...value]]),
        ),
        subTaskArtifacts: run.summary.subTaskArtifacts.map(artifact => ({
          ...artifact,
          dependsOn: [...artifact.dependsOn],
          toolCalls: artifact.toolCalls.map(tool => ({ ...tool })),
          checkpointedTools: [...artifact.checkpointedTools],
          changedFiles: artifact.changedFiles.map(file => ({ ...file })),
        })),
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
    && Array.isArray(run['subTaskArtifacts'])
    && typeof run['requireBatchApproval'] === 'boolean'
    && typeof run['paused'] === 'boolean'
    && typeof run['awaitingBatchApproval'] === 'boolean'
    && Array.isArray(run['logs']);
}

/** Sanitize a run ID for use as a safe file name. */
function sanitizeFileName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
}