import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import { deriveProjectRunTitle } from '../chat/sessionConversation.js';
import type { ProjectRunExecutionOptions, ProjectRunRecord } from '../types.js';

const STORAGE_KEY = 'atlasmind.projectRunHistory';
import { MAX_PROJECT_RUNS } from '../constants.js';

interface ProjectRunHistoryOptions {
  workspaceKey?: string;
  legacyState?: Pick<vscode.Memento, 'get' | 'update'>;
}

export class ProjectRunHistory {
  private diskDir: string | undefined;
  private readonly workspaceKey: string | undefined;
  private readonly legacyState: Pick<vscode.Memento, 'get' | 'update'> | undefined;

  constructor(
    private readonly state: Pick<vscode.Memento, 'get' | 'update'>,
    options: ProjectRunHistoryOptions = {},
  ) {
    this.workspaceKey = normalizeWorkspaceKey(options.workspaceKey);
    this.legacyState = options.legacyState;
  }

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
        if (isProjectRunRecord(parsed) && this.belongsToCurrentWorkspace(parsed)) { return parsed; }
      } catch { /* not found */ }
    }
    return this.readRunsFromState().find(run => run.id === runId);
  }

  async upsertRun(run: ProjectRunRecord): Promise<void> {
    const sanitized = sanitizeRun(run, this.workspaceKey ?? normalizeWorkspaceKey(run.workspaceKey));

    // Write to disk if available
    if (this.diskDir) {
      await fs.mkdir(this.diskDir, { recursive: true });
      const filePath = path.join(this.diskDir, `${sanitizeFileName(run.id)}.json`);
      await fs.writeFile(filePath, JSON.stringify(sanitized, null, 2), 'utf-8');
    }

    // Keep globalState as a lightweight index for synchronous reads
    const runs = this.readRunsFromState(false).filter(existing => existing.id !== run.id);
    runs.unshift(sanitized);
    await this.state.update(STORAGE_KEY, this.filterAndSortRuns(runs).slice(0, MAX_PROJECT_RUNS));
  }

  async deleteRunAsync(runId: string): Promise<boolean> {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) {
      return false;
    }

    let deleted = false;

    if (this.diskDir) {
      const filePath = path.join(this.diskDir, `${sanitizeFileName(normalizedRunId)}.json`);
      try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (isProjectRunRecord(parsed) && this.shouldDeleteRun(parsed, normalizedRunId)) {
          await fs.rm(filePath, { force: true });
          deleted = true;
        }
      } catch {
        // Ignore missing or unreadable disk entries and fall back to state cleanup.
      }
    }

    if (await this.deleteRunFromState(this.state, normalizedRunId)) {
      deleted = true;
    }

    if (this.legacyState && await this.deleteRunFromState(this.legacyState, normalizedRunId)) {
      deleted = true;
    }

    return deleted;
  }

  private readRunsFromState(includeLegacyState = true): ProjectRunRecord[] {
    const runs = [
      ...this.readRunsFromSingleState(this.state),
      ...(includeLegacyState && this.legacyState ? this.readLegacyRunsFromState() : []),
    ];
    return this.filterAndSortRuns(runs);
  }

  private readRunsFromSingleState(state: Pick<vscode.Memento, 'get' | 'update'>): ProjectRunRecord[] {
    const raw = state.get<ProjectRunRecord[]>(STORAGE_KEY, []);
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .filter(isProjectRunRecord)
      .map(run => sanitizeRun(run, normalizeWorkspaceKey(run.workspaceKey)));
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
          if (isProjectRunRecord(parsed) && this.belongsToCurrentWorkspace(parsed)) {
            runs.push(sanitizeRun(parsed, normalizeWorkspaceKey(parsed.workspaceKey)));
          }
        } catch { /* skip corrupt files */ }
      }
      return this.filterAndSortRuns(runs).slice(0, MAX_PROJECT_RUNS);
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
    await this.state.update(STORAGE_KEY, this.filterAndSortRuns(existing).slice(0, MAX_PROJECT_RUNS));
  }

  private readLegacyRunsFromState(): ProjectRunRecord[] {
    if (!this.legacyState) {
      return [];
    }

    return this.readRunsFromSingleState(this.legacyState)
      .map(run => this.normalizeLegacyRun(run))
      .filter((run): run is ProjectRunRecord => Boolean(run));
  }

  private async deleteRunFromState(
    state: Pick<vscode.Memento, 'get' | 'update'>,
    runId: string,
  ): Promise<boolean> {
    const runs = this.readRunsFromSingleState(state);
    const remaining = runs.filter(run => !this.shouldDeleteRun(run, runId));
    if (remaining.length === runs.length) {
      return false;
    }
    await state.update(STORAGE_KEY, sortRuns(remaining).slice(0, MAX_PROJECT_RUNS));
    return true;
  }

  private filterAndSortRuns(runs: ProjectRunRecord[]): ProjectRunRecord[] {
    const deduped = new Map<string, ProjectRunRecord>();
    for (const run of runs) {
      if (!this.belongsToCurrentWorkspace(run)) {
        continue;
      }
      const existing = deduped.get(run.id);
      if (!existing || existing.updatedAt.localeCompare(run.updatedAt) < 0) {
        deduped.set(run.id, run);
      }
    }
    return [...deduped.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private belongsToCurrentWorkspace(run: ProjectRunRecord): boolean {
    if (!this.workspaceKey) {
      return true;
    }
    return normalizeWorkspaceKey(run.workspaceKey) === this.workspaceKey;
  }

  private shouldDeleteRun(run: ProjectRunRecord, runId: string): boolean {
    return run.id === runId && (this.belongsToCurrentWorkspace(run) || this.isAdoptableLegacyRun(run));
  }

  private normalizeLegacyRun(run: ProjectRunRecord): ProjectRunRecord | undefined {
    if (!this.workspaceKey) {
      return run;
    }
    if (run.workspaceKey) {
      return this.belongsToCurrentWorkspace(run) ? run : undefined;
    }
    return sanitizeRun(run, this.workspaceKey);
  }

  private isAdoptableLegacyRun(run: ProjectRunRecord): boolean {
    return Boolean(this.workspaceKey) && !run.workspaceKey;
  }
}

function sanitizeRun(run: ProjectRunRecord, workspaceKey?: string): ProjectRunRecord {
  const normalizedTitle = typeof run.title === 'string' && run.title.trim().length > 0
    ? run.title.trim()
    : deriveProjectRunTitle(run.goal);
  const executionOptions = sanitizeExecutionOptions(run.executionOptions, run.requireBatchApproval);

  return {
    ...run,
    title: normalizedTitle,
    workspaceKey,
    ...(run.chatSessionId ? { chatSessionId: run.chatSessionId } : {}),
    ...(run.chatMessageId ? { chatMessageId: run.chatMessageId } : {}),
    ...(run.carryForwardSummary ? { carryForwardSummary: run.carryForwardSummary } : {}),
    ...(run.ideationOrigin
      ? {
        ideationOrigin: {
          boardPath: run.ideationOrigin.boardPath,
          launchMode: run.ideationOrigin.launchMode,
          ...(run.ideationOrigin.sourceCardId ? { sourceCardId: run.ideationOrigin.sourceCardId } : {}),
          ...(run.ideationOrigin.sourceCardTitle ? { sourceCardTitle: run.ideationOrigin.sourceCardTitle } : {}),
          ...(run.ideationOrigin.sourcePrompt ? { sourcePrompt: run.ideationOrigin.sourcePrompt } : {}),
        },
      }
      : {}),
    executionOptions,
    failedSubtaskTitles: [...run.failedSubtaskTitles],
    plannerSeedResults: run.plannerSeedResults?.map(result => ({ ...result })),
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
        synthesis: run.summary.synthesis ?? '',
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
    reviewFiles: run.reviewFiles?.map(file => ({ ...file, ...(file.uri ? { uri: { ...file.uri } } : {}) })),
  };
}

function isProjectRunRecord(value: unknown): value is ProjectRunRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const run = value as Record<string, unknown>;
  return typeof run['id'] === 'string'
    && (run['title'] === undefined || typeof run['title'] === 'string')
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
    && (run['chatSessionId'] === undefined || typeof run['chatSessionId'] === 'string')
    && (run['chatMessageId'] === undefined || typeof run['chatMessageId'] === 'string')
    && (run['reviewFiles'] === undefined || isProjectRunReviewFiles(run['reviewFiles']))
    && (run['plannerRootRunId'] === undefined || typeof run['plannerRootRunId'] === 'string')
    && (run['plannerJobIndex'] === undefined || typeof run['plannerJobIndex'] === 'number')
    && (run['plannerJobCount'] === undefined || typeof run['plannerJobCount'] === 'number')
    && (run['plannerSeedResults'] === undefined || isProjectRunSeedResults(run['plannerSeedResults']))
    && (run['carryForwardSummary'] === undefined || typeof run['carryForwardSummary'] === 'string')
    && (run['ideationOrigin'] === undefined || isProjectRunIdeationOrigin(run['ideationOrigin']))
    && (run['executionOptions'] === undefined || isProjectRunExecutionOptions(run['executionOptions']))
    && Array.isArray(run['logs']);
}

function isProjectRunIdeationOrigin(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate['boardPath'] === 'string'
    && (candidate['launchMode'] === 'focused-card' || candidate['launchMode'] === 'board-thread')
    && (candidate['sourceCardId'] === undefined || typeof candidate['sourceCardId'] === 'string')
    && (candidate['sourceCardTitle'] === undefined || typeof candidate['sourceCardTitle'] === 'string')
    && (candidate['sourcePrompt'] === undefined || typeof candidate['sourcePrompt'] === 'string');
}

function sanitizeExecutionOptions(
  value: ProjectRunExecutionOptions | undefined,
  requireBatchApproval: boolean,
): ProjectRunExecutionOptions {
  const normalizedRequireApproval = value?.requireBatchApproval ?? requireBatchApproval;
  const autonomousMode = value?.autonomousMode ?? !normalizedRequireApproval;
  return {
    autonomousMode,
    requireBatchApproval: normalizedRequireApproval,
    mirrorProgressToChat: value?.mirrorProgressToChat ?? true,
    injectOutputIntoFollowUp: value?.injectOutputIntoFollowUp ?? true,
  };
}

function isProjectRunExecutionOptions(value: unknown): value is ProjectRunExecutionOptions {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate['autonomousMode'] === 'boolean'
    && typeof candidate['requireBatchApproval'] === 'boolean'
    && typeof candidate['mirrorProgressToChat'] === 'boolean'
    && typeof candidate['injectOutputIntoFollowUp'] === 'boolean';
}

function isProjectRunReviewFiles(value: unknown): boolean {
  return Array.isArray(value) && value.every(item => {
    if (typeof item !== 'object' || item === null) {
      return false;
    }

    const file = item as Record<string, unknown>;
    return typeof file['relativePath'] === 'string'
      && (file['status'] === 'created' || file['status'] === 'modified' || file['status'] === 'deleted')
      && (file['decision'] === 'pending' || file['decision'] === 'accepted' || file['decision'] === 'dismissed')
      && (file['decidedAt'] === undefined || typeof file['decidedAt'] === 'string')
      && (file['uri'] === undefined || isRunFileUri(file['uri']));
  });
}

function isRunFileUri(value: unknown): boolean {
  return typeof value === 'object'
    && value !== null
    && typeof (value as Record<string, unknown>)['fsPath'] === 'string';
}

function isProjectRunSeedResults(value: unknown): value is Array<{ subTaskId: string; title: string; output: string }> {
  return Array.isArray(value) && value.every(item => {
    if (typeof item !== 'object' || item === null) {
      return false;
    }

    const result = item as Record<string, unknown>;
    return typeof result['subTaskId'] === 'string'
      && typeof result['title'] === 'string'
      && typeof result['output'] === 'string';
  });
}

/** Sanitize a run ID for use as a safe file name. */
function sanitizeFileName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
}

function normalizeWorkspaceKey(workspaceKey: string | undefined): string | undefined {
  const trimmed = workspaceKey?.trim();
  if (!trimmed) {
    return undefined;
  }
  return path.resolve(trimmed).replace(/\\+/g, '/').toLowerCase();
}

function sortRuns(runs: ProjectRunRecord[]): ProjectRunRecord[] {
  return [...runs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}