import type * as vscode from 'vscode';
import type { ProjectRunRecord } from '../types.js';

const STORAGE_KEY = 'atlasmind.projectRunHistory';
import { MAX_PROJECT_RUNS } from '../constants.js';

export class ProjectRunHistory {
  constructor(private readonly state: Pick<vscode.Memento, 'get' | 'update'>) {}

  listRuns(limit = MAX_PROJECT_RUNS): ProjectRunRecord[] {
    return this.readRuns().slice(0, Math.max(1, limit));
  }

  getRun(runId: string): ProjectRunRecord | undefined {
    return this.readRuns().find(run => run.id === runId);
  }

  async upsertRun(run: ProjectRunRecord): Promise<void> {
    const runs = this.readRuns().filter(existing => existing.id !== run.id);
    runs.unshift(sanitizeRun(run));
    await this.state.update(STORAGE_KEY, runs.slice(0, MAX_PROJECT_RUNS));
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