import * as vscode from 'vscode';
import * as path from 'path';
import type { AtlasMindContext } from '../extension.js';
import { Planner, parsePlannerResponse, removeCycles, splitPlanIntoExecutionJobs } from '../core/planner.js';
import { TaskProfiler } from '../core/taskProfiler.js';
import type {
  ChangedWorkspaceFile,
  ProjectPlan,
  ProjectProgressUpdate,
  ProjectRunRecord,
  ProjectRunSeedResult,
  ProjectRunSubTaskArtifact,
  RoutingConstraints,
  SubTaskResult,
} from '../types.js';
import {
  addFileAttribution,
  buildChangedFilesDiffPreview,
  buildProjectRunSubTaskArtifacts,
  buildProjectRunSummary,
  collectWorkspaceChangesSince,
  createWorkspaceSnapshot,
  estimateTouchedFiles,
  getProjectUiConfig,
  summarizeChangedFiles,
  writeProjectRunSummaryReport,
} from '../chat/participant.js';
import { deriveProjectRunTitle } from '../chat/sessionConversation.js';
import { getWebviewHtmlShell } from './webviewUtils.js';

interface ProjectRunDiscussionPayload {
  goal: string;
  planDraft: string;
}

type ProjectRunCenterMessage =
  | { type: 'previewGoal'; payload: string }
  | { type: 'updatePlanDraft'; payload: string }
  | { type: 'executePreview' }
  | { type: 'refreshRuns' }
  | { type: 'discussDraft'; payload: ProjectRunDiscussionPayload }
  | { type: 'deleteRun'; payload: string }
  | { type: 'openIdeation' }
  | { type: 'openRunReport'; payload: string }
  | { type: 'openFileReference'; payload: string }
  | { type: 'openSourceControl' }
  | { type: 'rollbackLastCheckpoint' }
  | { type: 'selectRun'; payload: string }
  | { type: 'approveNextBatch' }
  | { type: 'pauseRun' }
  | { type: 'resumeRun' }
  | { type: 'retryFailedSubtasks' }
  | { type: 'setRequireBatchApproval'; payload: boolean };

interface ProjectRunPreviewState {
  runId: string;
  goal: string;
  estimatedFiles: number;
  requiresApproval: boolean;
  approvalThreshold: number;
  plan: ProjectPlan;
  planDraft: string;
  executionJobCount: number;
  firstExecutionJobSubtaskCount: number;
  remainingExecutionSubtaskCount: number;
}

type SnapshotEntry = {
  signature: string;
  relativePath: string;
  uri: vscode.Uri;
  textContent?: string;
};

type SnapshotMap = Map<string, SnapshotEntry>;

export class ProjectRunCenterPanel {
  public static currentPanel: ProjectRunCenterPanel | undefined;
  private static readonly viewType = 'atlasmind.projectRunCenter';

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private previewState: ProjectRunPreviewState | undefined;
  private selectedRunId: string | undefined;
  private liveStatus = 'Idle';
  private requireBatchApproval = false;
  private pauseBeforeNextBatch = false;
  private approvalResolver: (() => void) | undefined;
  private resumeResolver: (() => void) | undefined;

  public static createOrShow(
    context: vscode.ExtensionContext,
    atlas: AtlasMindContext,
    selectedRunId?: string,
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (ProjectRunCenterPanel.currentPanel) {
      if (selectedRunId) {
        ProjectRunCenterPanel.currentPanel.selectedRunId = selectedRunId;
        void ProjectRunCenterPanel.currentPanel.syncState();
      }
      ProjectRunCenterPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ProjectRunCenterPanel.viewType,
      'AtlasMind Project Run Center',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );

    ProjectRunCenterPanel.currentPanel = new ProjectRunCenterPanel(panel, atlas, selectedRunId);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly atlas: AtlasMindContext,
    selectedRunId?: string,
  ) {
    this.panel = panel;
    this.selectedRunId = selectedRunId;
    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(message => {
      void this.handleMessage(message);
    }, null, this.disposables);

    this.atlas.projectRunsRefresh.event(() => {
      void this.syncState();
    }, null, this.disposables);

    void this.syncState();
  }

  private dispose(): void {
    ProjectRunCenterPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isProjectRunCenterMessage(message)) {
      return;
    }

    switch (message.type) {
      case 'previewGoal':
        await this.previewGoal(message.payload);
        return;
      case 'updatePlanDraft':
        await this.updatePlanDraft(message.payload);
        return;
      case 'executePreview':
        await this.executePreview();
        return;
      case 'refreshRuns':
        await this.syncState();
        return;
      case 'discussDraft':
        await this.discussDraft(message.payload);
        return;
      case 'deleteRun':
        await this.deleteRun(message.payload);
        return;
      case 'openIdeation':
        await vscode.commands.executeCommand('atlasmind.openProjectIdeation');
        return;
      case 'openRunReport':
        await this.openWorkspaceRelativePath(message.payload);
        return;
      case 'openFileReference':
        await this.openWorkspaceRelativePath(message.payload);
        return;
      case 'openSourceControl':
        await vscode.commands.executeCommand('workbench.view.scm');
        return;
      case 'rollbackLastCheckpoint':
        await this.rollbackLastCheckpoint();
        return;
      case 'selectRun':
        this.selectedRunId = message.payload;
        await this.syncState();
        return;
      case 'approveNextBatch':
        if (this.approvalResolver) {
          const resolve = this.approvalResolver;
          this.approvalResolver = undefined;
          resolve();
        }
        this.liveStatus = 'Approved the next batch.';
        await this.syncState();
        return;
      case 'pauseRun':
        this.pauseBeforeNextBatch = true;
        this.liveStatus = 'The run will pause before the next batch.';
        await this.syncState();
        return;
      case 'resumeRun':
        this.pauseBeforeNextBatch = false;
        if (this.resumeResolver) {
          const resolve = this.resumeResolver;
          this.resumeResolver = undefined;
          resolve();
        }
        this.liveStatus = 'Resumed the run.';
        await this.syncState();
        return;
      case 'retryFailedSubtasks':
        await this.retryFailedSubtasks();
        return;
      case 'setRequireBatchApproval':
        this.requireBatchApproval = message.payload;
        this.liveStatus = message.payload ? 'Batch approval enabled.' : 'Batch approval disabled.';
        await this.syncState();
        return;
    }
  }

  private async previewGoal(rawGoal: string): Promise<void> {
    const goal = rawGoal.trim();
    if (!goal) {
      this.liveStatus = 'Enter a goal before previewing a project run.';
      await this.syncState();
      return;
    }

    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const constraints = this.getConstraints(configuration);
    const projectUiConfig = getProjectUiConfig(configuration);
    const planner = new Planner(this.atlas.modelRouter, this.atlas.providerRegistry, new TaskProfiler());
    const plan = await planner.plan(goal, constraints);
    const estimatedFiles = estimateTouchedFiles(plan.subTasks.length, projectUiConfig.estimatedFilesPerSubtask);
    const runId = `project-run-${Date.now()}`;
    const createdAt = new Date().toISOString();

    this.previewState = {
      runId,
      goal,
      estimatedFiles,
      requiresApproval: estimatedFiles > projectUiConfig.approvalFileThreshold,
      approvalThreshold: projectUiConfig.approvalFileThreshold,
      plan,
      planDraft: JSON.stringify({ subTasks: plan.subTasks }, null, 2),
      ...buildExecutionSplitPreview(plan, projectUiConfig),
    };
    this.selectedRunId = runId;
    this.liveStatus = 'Preview generated. Review the plan before executing.';

    await this.atlas.projectRunHistory.upsertRun({
      id: runId,
      title: deriveProjectRunTitle(goal),
      goal,
      plannerRootRunId: runId,
      plannerJobIndex: 1,
      plannerJobCount: this.previewState.executionJobCount,
      plannerSeedResults: [],
      status: 'previewed',
      createdAt,
      updatedAt: createdAt,
      estimatedFiles,
      requiresApproval: this.previewState.requiresApproval,
      planSubtaskCount: plan.subTasks.length,
      completedSubtaskCount: 0,
      totalSubtaskCount: plan.subTasks.length,
      currentBatch: 0,
      totalBatches: 0,
      failedSubtaskTitles: [],
      plan,
      subTaskArtifacts: [],
      requireBatchApproval: this.requireBatchApproval,
      paused: false,
      awaitingBatchApproval: false,
      logs: [{ timestamp: createdAt, level: 'info', message: 'Preview generated.' }],
    });
    this.atlas.projectRunsRefresh.fire();
    await this.syncState();
  }

  private async updatePlanDraft(rawDraft: string): Promise<void> {
    if (!this.previewState) {
      this.liveStatus = 'Preview a goal before editing its plan.';
      await this.syncState();
      return;
    }

    const plan = parseEditableProjectPlan(this.previewState.goal, this.previewState.runId, rawDraft);
    if (!plan) {
      this.liveStatus = 'Plan edits were rejected. Keep valid JSON with a subTasks array.';
      await this.syncState();
      return;
    }

    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const projectUiConfig = getProjectUiConfig(configuration);
    const estimatedFiles = estimateTouchedFiles(plan.subTasks.length, projectUiConfig.estimatedFilesPerSubtask);
    this.previewState = {
      ...this.previewState,
      plan,
      planDraft: rawDraft,
      estimatedFiles,
      requiresApproval: estimatedFiles > projectUiConfig.approvalFileThreshold,
      approvalThreshold: projectUiConfig.approvalFileThreshold,
      ...buildExecutionSplitPreview(plan, projectUiConfig),
    };

    const existing = await this.atlas.projectRunHistory.getRunAsync(this.previewState.runId);
    if (existing) {
      await this.atlas.projectRunHistory.upsertRun({
        ...existing,
        title: deriveProjectRunTitle(this.previewState.goal),
        goal: this.previewState.goal,
        plannerJobCount: this.previewState.executionJobCount,
        plan,
        estimatedFiles,
        requiresApproval: this.previewState.requiresApproval,
        planSubtaskCount: plan.subTasks.length,
        totalSubtaskCount: plan.subTasks.length,
        updatedAt: new Date().toISOString(),
        logs: [...existing.logs, { timestamp: new Date().toISOString(), level: 'info' as const, message: 'Plan edited before execution.' }].slice(-40),
      });
      this.atlas.projectRunsRefresh.fire();
    }

    this.liveStatus = 'Plan edits applied.';
    await this.syncState();
  }

  private async executePreview(): Promise<void> {
    if (!this.previewState) {
      this.liveStatus = 'Preview a goal before executing it.';
      await this.syncState();
      return;
    }

    const configuration = vscode.workspace.getConfiguration('atlasmind');

    const draftPlan = parseEditableProjectPlan(this.previewState.goal, this.previewState.runId, this.previewState.planDraft);
    if (!draftPlan) {
      this.liveStatus = 'The current plan draft is invalid. Fix it before executing.';
      await this.syncState();
      return;
    }

    const existing = await this.atlas.projectRunHistory.getRunAsync(this.previewState.runId);
    if (!existing) {
      this.liveStatus = 'The selected preview is no longer available.';
      await this.syncState();
      return;
    }

    const projectUiConfig = getProjectUiConfig(configuration);
    const executionJobs = splitPlanIntoExecutionJobs(draftPlan, {
      maxEstimatedFilesPerJob: projectUiConfig.approvalFileThreshold,
      estimatedFilesPerSubtask: projectUiConfig.estimatedFilesPerSubtask,
      precompletedSubtaskIds: (existing.plannerSeedResults ?? []).map(seed => seed.subTaskId),
    });
    const firstJob = executionJobs[0]?.plan ?? draftPlan;
    const remainingTasks = executionJobs.slice(1).flatMap(job => job.plan.subTasks.map(task => ({
      ...task,
      skills: [...task.skills],
      dependsOn: [...task.dependsOn],
    })));
    const continuationPlan = remainingTasks.length > 0
      ? {
        id: `${draftPlan.id}-continuation`,
        goal: draftPlan.goal,
        subTasks: remainingTasks,
      }
      : undefined;
    const plannerJobIndex = existing.plannerJobIndex ?? 1;
    const plannerJobCount = Math.max(existing.plannerJobCount ?? executionJobs.length, plannerJobIndex + executionJobs.length - 1);

    this.previewState = {
      ...this.previewState,
      plan: draftPlan,
      ...buildExecutionSplitPreview(draftPlan, projectUiConfig, (existing.plannerSeedResults ?? []).map(seed => seed.subTaskId)),
    };
    await this.executeRun(existing, {
      resumeFailedOnly: false,
      planOverride: firstJob,
      continuationPlan,
      plannerJobIndex,
      plannerJobCount,
    });
  }

  private async retryFailedSubtasks(): Promise<void> {
    const run = this.selectedRunId ? await this.atlas.projectRunHistory.getRunAsync(this.selectedRunId) : undefined;
    if (!run || run.status !== 'failed' || !run.plan) {
      this.liveStatus = 'Select a failed run with a stored plan to retry only the failed subtasks.';
      await this.syncState();
      return;
    }

    await this.executeRun(run, { resumeFailedOnly: true, planOverride: run.plan });
  }

  private async discussDraft(payload: ProjectRunDiscussionPayload): Promise<void> {
    const goal = payload.goal.trim();
    const planDraft = payload.planDraft.trim();
    if (!goal && !planDraft) {
      this.liveStatus = 'Add a goal or draft before opening a refinement discussion.';
      await this.syncState();
      return;
    }

    await vscode.commands.executeCommand('atlasmind.openChatPanel', {
      draftPrompt: buildDraftDiscussionPrompt(goal, planDraft, this.previewState),
      sendMode: 'steer',
    });
    this.liveStatus = 'Opened Atlas chat with a draft-refinement prompt.';
    await this.syncState();
  }

  private async deleteRun(rawRunId: string): Promise<void> {
    const runId = rawRunId.trim();
    if (!runId) {
      this.liveStatus = 'Select a saved run before deleting it.';
      await this.syncState();
      return;
    }

    const run = await this.atlas.projectRunHistory.getRunAsync(runId);
    if (!run) {
      if (this.selectedRunId === runId) {
        this.selectedRunId = undefined;
      }
      if (this.previewState?.runId === runId) {
        this.previewState = undefined;
      }
      this.liveStatus = 'That run is no longer available.';
      await this.syncState();
      return;
    }

    if (run.status === 'running') {
      this.liveStatus = 'Running project runs cannot be deleted.';
      await this.syncState();
      return;
    }

    const confirmation = await vscode.window.showWarningMessage(
      `Delete project run "${run.goal}" from local history? Saved run reports and workspace files will be left untouched.`,
      { modal: true },
      'Delete Run',
    );
    if (confirmation !== 'Delete Run') {
      this.liveStatus = 'Run deletion canceled.';
      await this.syncState();
      return;
    }

    const deleted = await this.atlas.projectRunHistory.deleteRunAsync(runId);
    if (!deleted) {
      this.liveStatus = 'The run could not be deleted.';
      await this.syncState();
      return;
    }

    if (this.selectedRunId === runId) {
      this.selectedRunId = undefined;
    }
    if (this.previewState?.runId === runId) {
      this.previewState = undefined;
    }

    this.liveStatus = 'Deleted the selected run from local history.';
    this.atlas.projectRunsRefresh.fire();
    await this.syncState();
  }

  private async executeRun(
    sourceRun: ProjectRunRecord,
    options: {
      resumeFailedOnly: boolean;
      planOverride: ProjectPlan;
      continuationPlan?: ProjectPlan;
      plannerJobIndex?: number;
      plannerJobCount?: number;
    },
  ): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const constraints = this.getConstraints(configuration);
    const projectUiConfig = getProjectUiConfig(configuration);
    const baselineSnapshot = await createWorkspaceSnapshot();
    let lastImpactSnapshot = baselineSnapshot;
    const fileAttribution = new Map<string, Set<string>>();
    const failedSubtaskTitles: string[] = [];
    const runStartedAt = new Date().toISOString();
    const initialCompletedResults = options.resumeFailedOnly
      ? [
        ...seedResultsToSubTaskResults(sourceRun.plannerSeedResults),
        ...sourceRun.subTaskArtifacts
          .filter(artifact => artifact.status === 'completed')
          .map(artifact => artifactToResult(artifact)),
      ]
      : seedResultsToSubTaskResults(sourceRun.plannerSeedResults);
    const plannerRootRunId = sourceRun.plannerRootRunId ?? sourceRun.id;

    let mutableRun: ProjectRunRecord = {
      ...sourceRun,
      title: deriveProjectRunTitle(options.planOverride.goal),
      plannerRootRunId,
      plannerJobIndex: options.plannerJobIndex ?? sourceRun.plannerJobIndex ?? 1,
      plannerJobCount: options.plannerJobCount ?? sourceRun.plannerJobCount ?? 1,
      plannerSeedResults: sourceRun.plannerSeedResults?.map(result => ({ ...result })) ?? [],
      goal: options.planOverride.goal,
      plan: options.planOverride,
      status: 'running',
      updatedAt: runStartedAt,
      failedSubtaskTitles: [],
      currentBatch: 0,
      totalBatches: 0,
      subTaskArtifacts: options.resumeFailedOnly ? sourceRun.subTaskArtifacts.map(artifact => cloneArtifact(artifact)) : [],
      requireBatchApproval: this.requireBatchApproval,
      paused: false,
      awaitingBatchApproval: false,
      logs: [
        ...sourceRun.logs,
        {
          timestamp: runStartedAt,
          level: 'info' as const,
          message: options.resumeFailedOnly ? 'Retrying failed subtasks only.' : 'Execution started from the reviewed plan.',
        },
      ].slice(-40),
    };
    await this.atlas.projectRunHistory.upsertRun(mutableRun);
    this.atlas.projectRunsRefresh.fire();

    const updateRun = async (mutate: (current: ProjectRunRecord) => ProjectRunRecord): Promise<void> => {
      mutableRun = mutate(mutableRun);
      mutableRun.updatedAt = new Date().toISOString();
      await this.atlas.projectRunHistory.upsertRun(mutableRun);
      this.atlas.projectRunsRefresh.fire();
      await this.syncState();
    };

    const appendLog = async (level: 'info' | 'warning' | 'error', message: string): Promise<void> => {
      await updateRun(current => ({
        ...current,
        logs: [...current.logs, { timestamp: new Date().toISOString(), level, message }].slice(-40),
      }));
    };

    const beforeBatch = async (batch: { batchIndex: number; totalBatches: number; batchSize: number; subTaskIds: string[] }): Promise<void> => {
      await updateRun(current => ({
        ...current,
        currentBatch: batch.batchIndex,
        totalBatches: batch.totalBatches,
      }));

      if (this.pauseBeforeNextBatch) {
        this.liveStatus = `Paused before batch ${batch.batchIndex}/${batch.totalBatches}.`;
        await updateRun(current => ({
          ...current,
          paused: true,
          awaitingBatchApproval: false,
        }));
        await appendLog('warning', `Paused before batch ${batch.batchIndex}/${batch.totalBatches}.`);
        await new Promise<void>(resolve => {
          this.resumeResolver = resolve;
        });
        this.pauseBeforeNextBatch = false;
        this.resumeResolver = undefined;
        await updateRun(current => ({
          ...current,
          paused: false,
        }));
      }

      if (this.requireBatchApproval) {
        this.liveStatus = `Awaiting approval for batch ${batch.batchIndex}/${batch.totalBatches}.`;
        await updateRun(current => ({
          ...current,
          awaitingBatchApproval: true,
          requireBatchApproval: true,
        }));
        await appendLog('info', `Awaiting approval for batch ${batch.batchIndex}/${batch.totalBatches}.`);
        await new Promise<void>(resolve => {
          this.approvalResolver = resolve;
        });
        this.approvalResolver = undefined;
        await updateRun(current => ({
          ...current,
          awaitingBatchApproval: false,
        }));
      }
    };

    const onProgress = (update: ProjectProgressUpdate): void => {
      void this.handleProgressUpdate(
        update,
        updateRun,
        appendLog,
        failedSubtaskTitles,
        fileAttribution,
        () => lastImpactSnapshot,
        next => {
          lastImpactSnapshot = next;
        },
      );
    };

    try {
      this.liveStatus = options.resumeFailedOnly ? 'Retrying failed subtasks...' : 'Running reviewed project...';
      await this.syncState();
      const result = await this.atlas.orchestrator.processProject(
        options.planOverride.goal,
        constraints,
        onProgress,
        {
          planOverride: options.planOverride,
          resumeFromResults: initialCompletedResults,
          beforeBatch,
        },
      );
      const impact = await collectWorkspaceChangesSince(baselineSnapshot);
      const changedFiles = impact.changedFiles;
      const finalArtifacts = mergeArtifacts(
        mutableRun.subTaskArtifacts,
        buildProjectRunSubTaskArtifacts(result.subTaskResults),
      );
      const summary = buildProjectRunSummary(result, changedFiles, fileAttribution, runStartedAt, finalArtifacts);
      const reportUri = await writeProjectRunSummaryReport(summary, projectUiConfig.runReportFolder);
      const reportPath = reportUri ? vscode.workspace.asRelativePath(reportUri, false) : undefined;

      await updateRun(current => ({
        ...current,
        status: failedSubtaskTitles.length > 0 ? 'failed' : 'completed',
        completedSubtaskCount: result.subTaskResults.filter(item => item.status === 'completed').length,
        totalSubtaskCount: result.subTaskResults.length,
        failedSubtaskTitles: [...failedSubtaskTitles],
        subTaskArtifacts: finalArtifacts,
        reportPath,
        summary,
        paused: false,
        awaitingBatchApproval: false,
      }));

      if (!options.resumeFailedOnly && !failedSubtaskTitles.length && options.continuationPlan && options.continuationPlan.subTasks.length > 0) {
        const nextPlannerJobIndex = (mutableRun.plannerJobIndex ?? 1) + 1;
        const continuationEstimatedFiles = estimateTouchedFiles(
          options.continuationPlan.subTasks.length,
          projectUiConfig.estimatedFilesPerSubtask,
        );
        await this.atlas.projectRunHistory.upsertRun({
          id: buildPlannerFollowUpRunId(plannerRootRunId, nextPlannerJobIndex),
          title: sourceRun.title,
          goal: sourceRun.goal,
          plannerRootRunId,
          plannerJobIndex: nextPlannerJobIndex,
          plannerJobCount: mutableRun.plannerJobCount,
          plannerSeedResults: mergePlannerSeedResults(mutableRun.plannerSeedResults, result.subTaskResults),
          status: 'previewed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          estimatedFiles: continuationEstimatedFiles,
          requiresApproval: continuationEstimatedFiles > projectUiConfig.approvalFileThreshold,
          planSubtaskCount: options.continuationPlan.subTasks.length,
          completedSubtaskCount: 0,
          totalSubtaskCount: options.continuationPlan.subTasks.length,
          currentBatch: 0,
          totalBatches: 0,
          failedSubtaskTitles: [],
          plan: options.continuationPlan,
          subTaskArtifacts: [],
          requireBatchApproval: false,
          paused: false,
          awaitingBatchApproval: false,
          logs: [{
            timestamp: new Date().toISOString(),
            level: 'info',
            message: `Queued automatically after planner job ${mutableRun.plannerJobIndex ?? 1}/${mutableRun.plannerJobCount ?? 1} completed.`,
          }],
        });
        this.atlas.projectRunsRefresh.fire();
        this.liveStatus = `Execution completed. Queued planner job ${nextPlannerJobIndex}/${mutableRun.plannerJobCount ?? nextPlannerJobIndex} as the next draft.`;
      } else {
        this.liveStatus = 'Execution completed.';
      }

      await appendLog(
        failedSubtaskTitles.length > 0 ? 'warning' : 'info',
        failedSubtaskTitles.length > 0
          ? `Execution finished with ${failedSubtaskTitles.length} failed subtask(s).`
          : `Execution finished successfully. ${changedFiles.length} file(s) changed (${summarizeChangedFiles(changedFiles)}).`,
      );
      this.selectedRunId = sourceRun.id;
      await this.syncState();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateRun(current => ({
        ...current,
        status: 'failed',
        failedSubtaskTitles: failedSubtaskTitles.length > 0 ? [...failedSubtaskTitles] : ['Project execution failed'],
        paused: false,
        awaitingBatchApproval: false,
      }));
      await appendLog('error', `Execution failed: ${message}`);
      this.liveStatus = `Execution failed: ${message}`;
      await this.syncState();
    }
  }

  private async handleProgressUpdate(
    update: ProjectProgressUpdate,
    updateRun: (mutate: (current: ProjectRunRecord) => ProjectRunRecord) => Promise<void>,
    appendLog: (level: 'info' | 'warning' | 'error', message: string) => Promise<void>,
    failedSubtaskTitles: string[],
    fileAttribution: Map<string, Set<string>>,
    getLastImpactSnapshot: () => SnapshotMap,
    setLastImpactSnapshot: (snapshot: SnapshotMap) => void,
  ): Promise<void> {
    switch (update.type) {
      case 'planned':
        await appendLog('info', `Planner produced ${update.plan.subTasks.length} subtask(s).`);
        return;
      case 'batch-start':
        this.liveStatus = `Batch ${update.batchIndex}/${update.totalBatches} running ${update.batchSize} subtask(s)`;
        await updateRun(run => ({
          ...run,
          currentBatch: update.batchIndex,
          totalBatches: update.totalBatches,
        }));
        await appendLog('info', `Batch ${update.batchIndex}/${update.totalBatches} started: ${update.subTaskIds.join(', ') || 'no subtasks'}.`);
        return;
      case 'subtask-start':
        this.liveStatus = `Running ${update.title}`;
        await appendLog('info', `Started ${update.title}.`);
        return;
      case 'subtask-done': {
        if (update.result.status === 'failed') {
          failedSubtaskTitles.push(update.result.title);
        }
        const previousSnapshot = getLastImpactSnapshot();
        const impact = await collectWorkspaceChangesSince(previousSnapshot);
        const diffPreview = buildChangedFilesDiffPreview(previousSnapshot, impact.snapshot, impact.changedFiles);
        setLastImpactSnapshot(impact.snapshot);
        addFileAttribution(fileAttribution, update.result.title, impact.changedFiles);
        const artifact = buildArtifactFromResult(update.result, impact.changedFiles, diffPreview);
        await updateRun(run => ({
          ...run,
          completedSubtaskCount: update.completed,
          totalSubtaskCount: update.total,
          failedSubtaskTitles: [...failedSubtaskTitles],
          subTaskArtifacts: upsertArtifact(run.subTaskArtifacts, artifact),
        }));
        await appendLog(
          update.result.status === 'failed' ? 'warning' : 'info',
          `${update.result.title} ${update.result.status === 'failed' ? 'failed' : 'completed'} ` +
          `(${update.completed}/${update.total}). tool calls: ${artifact.toolCallCount}.` +
          (impact.changedFiles.length > 0 ? ` ${impact.changedFiles.length} file(s) changed.` : ''),
        );
        return;
      }
      case 'synthesizing':
        this.liveStatus = 'Synthesizing project result...';
        await appendLog('info', 'Synthesizing subtask outputs into the final report.');
        return;
      case 'error':
        this.liveStatus = `Planner error: ${update.message}`;
        await appendLog('error', update.message);
        return;
    }
  }

  private async rollbackLastCheckpoint(): Promise<void> {
    const result = await this.atlas.rollbackLastCheckpoint();
    this.liveStatus = result.summary;
    await this.syncState();
    void vscode.window.showInformationMessage(result.summary);
  }

  private async openWorkspaceRelativePath(relativePath: string): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return;
    }

    const sanitized = relativePath.trim();
    if (!sanitized) {
      return;
    }

    const resolved = path.resolve(workspaceRoot, sanitized);
    const normalizedRoot = normalizePathForComparison(workspaceRoot);
    const normalizedCandidate = normalizePathForComparison(resolved);
    if (normalizedCandidate !== normalizedRoot && !normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)) {
      return;
    }

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved));
    await vscode.window.showTextDocument(document, { preview: false });
  }

  private async syncState(): Promise<void> {
    const runs = await this.atlas.projectRunHistory.listRunsAsync(20);
    const selectedRun = this.selectedRunId
      ? runs.find(run => run.id === this.selectedRunId)
      : runs[0];
    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const projectUiConfig = getProjectUiConfig(configuration);
    const previewState = this.previewState?.runId === selectedRun?.id
      ? this.previewState
      : selectedRun
        ? hydratePreviewStateFromRun(selectedRun, projectUiConfig)
        : undefined;

    this.previewState = previewState;

    this.selectedRunId = selectedRun?.id;

    await this.panel.webview.postMessage({
      type: 'state',
      payload: {
        liveStatus: this.liveStatus,
        requireBatchApproval: this.requireBatchApproval,
        preview: previewState ? serializePreview(previewState) : null,
        runs: runs.map(run => serializeRun(run)),
        selectedRun: selectedRun ? serializeRun(selectedRun) : null,
      },
    });
  }

  private getConstraints(configuration: Pick<vscode.WorkspaceConfiguration, 'get'>): RoutingConstraints {
    return {
      budget: toBudgetMode(configuration.get<string>('budgetMode')),
      speed: toSpeedMode(configuration.get<string>('speedMode')),
    };
  }

  private getHtml(): string {
    return getWebviewHtmlShell({
      title: 'AtlasMind Project Run Center',
      cspSource: this.panel.webview.cspSource,
      bodyContent: `
        <div class="run-center-shell">
          <div class="dashboard-topbar">
            <div>
              <p class="dashboard-kicker">Command center</p>
              <h1>Project Run Center</h1>
              <p class="dashboard-copy">Turn a project goal into a reviewable execution draft. Preview shows the planned subtasks, estimated impact, and approval posture; execution then runs that draft in dependency-safe batches and records the outcome here.</p>
            </div>
            <div class="dashboard-actions" role="group" aria-label="Project run center actions">
              <button id="openIdeation" class="dashboard-button dashboard-button-ghost" type="button">Open Ideation Board</button>
              <button id="refreshRuns" class="dashboard-button dashboard-button-ghost" type="button">Refresh Runs</button>
            </div>
          </div>

          <section class="hero-grid">
            <article class="hero-card">
              <p class="dashboard-kicker">Autonomous delivery</p>
              <h2>Review-first orchestration</h2>
              <p class="section-copy">Use the same planner, scheduler, and run history pipeline that powers <code>/project</code>, but with an operator-facing surface for refining the draft, making approval decisions, and seeing exactly what Atlas is doing while it runs.</p>
              <div class="hero-meta">
                <span id="heroLiveStatus" class="meta-pill">Idle</span>
                <span id="heroApprovalMode" class="meta-pill">Batch approval off</span>
                <span id="heroRunCount" class="meta-pill">0 tracked runs</span>
              </div>
            </article>

            <article class="score-card">
              <p class="dashboard-kicker">Current posture</p>
              <div class="posture-grid">
                <div class="metric-pill">
                  <span class="metric-label">Selected run</span>
                  <strong id="metricSelectedStatus">No run selected</strong>
                </div>
                <div class="metric-pill">
                  <span class="metric-label">Run progress</span>
                  <strong id="metricSelectedProgress">0/0 subtasks</strong>
                </div>
                <div class="metric-pill">
                  <span class="metric-label">Change scope</span>
                  <strong id="metricSelectedImpact">No recorded changes</strong>
                </div>
                <div class="metric-pill">
                  <span class="metric-label">Preview</span>
                  <strong id="metricPreviewStatus">No preview loaded</strong>
                </div>
              </div>
            </article>
          </section>

          <section class="workspace-grid">
            <article class="panel-card panel-card-review">
              <div class="panel-header-row">
                <div>
                  <p class="section-kicker">Plan review</p>
                  <h2>Draft and refine</h2>
                  <p class="section-copy">Start with the desired outcome, preview AtlasMind's proposed execution draft, and refine it before you commit to the run. If the scope still feels fuzzy, discuss it in chat or move into ideation before execution.</p>
                </div>
              </div>

              <div class="preview-meta-grid preview-meta-grid-static">
                <div class="preview-pill">
                  <p class="field-label">What this panel does</p>
                  <strong>Plan first, execute second</strong>
                  <span>Preview builds a draft execution plan. Execution uses that reviewed draft instead of improvising from the original request.</span>
                </div>
                <div class="preview-pill">
                  <p class="field-label">Expected output</p>
                  <strong>A reviewable execution draft</strong>
                  <span>You should expect subtasks, dependency order, impact signals, and then a durable run record with logs, changed files, and artifacts.</span>
                </div>
              </div>

              <div class="field-stack">
                <label class="field-label" for="goalInput">Project goal</label>
                <textarea id="goalInput" rows="4" placeholder="Describe the project goal you want AtlasMind to plan and execute..."></textarea>
              </div>

              <div class="button-row">
                <button id="previewGoal" class="dashboard-button dashboard-button-solid" type="button">Preview Plan</button>
                <button id="applyPlanEdits" class="dashboard-button dashboard-button-ghost" type="button">Apply Plan Edits</button>
                <button id="discussDraft" class="dashboard-button dashboard-button-ghost" type="button">Discuss Draft</button>
                <button id="executePreview" class="dashboard-button dashboard-button-ghost" type="button">Execute Reviewed Plan</button>
              </div>

              <label class="checkbox-card checkbox-inline">
                <input id="requireBatchApproval" type="checkbox" />
                <span>
                  <strong>Require approval before each batch</strong>
                  <span class="muted-line">Enable an operator checkpoint before every scheduled execution batch.</span>
                </span>
              </label>

              <div id="previewMeta" class="preview-meta-grid"></div>

              <div class="editor-shell">
                <div class="editor-header">
                  <div>
                    <p class="section-kicker">Editable draft</p>
                    <h3>Plan JSON</h3>
                  </div>
                  <span class="meta-pill">Validated before execution</span>
                </div>
                <textarea id="planDraftInput" rows="14" placeholder="Preview the project plan, then edit the JSON here before execution."></textarea>
              </div>

              <div class="table-shell">
                <div class="editor-header compact-header">
                  <div>
                    <p class="section-kicker">Planner DAG</p>
                    <h3>Subtasks</h3>
                  </div>
                </div>
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr><th>ID</th><th>Title</th><th>Role</th><th>Depends On</th></tr>
                    </thead>
                    <tbody id="previewRows"></tbody>
                  </table>
                </div>
              </div>
            </article>

            <article class="panel-card panel-card-execution">
              <div class="panel-header-row">
                <div>
                  <p class="section-kicker">Execution control</p>
                  <h2>Batch steering</h2>
                  <p class="section-copy">Monitor the current run state, approve the next batch when approval mode is enabled, pause before the next checkpoint, resume execution, or open source control and rollback tools.</p>
                </div>
              </div>

              <div id="liveStatus" class="status-banner"></div>

              <div class="button-stack">
                <button id="approveNextBatch" class="dashboard-button dashboard-button-solid" type="button">Approve Next Batch</button>
                <button id="pauseRun" class="dashboard-button dashboard-button-ghost" type="button">Pause Before Next Batch</button>
                <button id="resumeRun" class="dashboard-button dashboard-button-ghost" type="button">Resume</button>
                <button id="openScm" class="dashboard-button dashboard-button-ghost" type="button">Open Source Control</button>
                <button id="rollbackCheckpoint" class="dashboard-button dashboard-button-danger" type="button">Rollback Last Checkpoint</button>
              </div>

              <div class="timeline-shell">
                <div class="editor-header compact-header">
                  <div>
                    <p class="section-kicker">Recent telemetry</p>
                    <h3>Live log</h3>
                  </div>
                </div>
                <ul id="liveLog" class="timeline-list"></ul>
              </div>
            </article>
          </section>

          <section class="panel-grid">
            <article class="list-card">
              <div class="panel-header-row">
                <div>
                  <p class="section-kicker">Run history</p>
                  <h2>Recent runs</h2>
                  <p class="section-copy">Inspect the most recent AtlasMind autonomous runs and reopen reports or failed work for targeted follow-up.</p>
                </div>
              </div>
              <div id="runsList" class="run-list"></div>
            </article>

            <article class="list-card selected-run-card">
              <div class="panel-header-row">
                <div>
                  <p class="section-kicker">Run review</p>
                  <h2>Selected run</h2>
                  <p class="section-copy">Review the chosen run's summary, changed files, and per-subtask artifacts without leaving the workspace.</p>
                </div>
              </div>
              <div id="selectedRun" class="selected-run-summary"></div>
              <div id="selectedRunActions" class="action-strip"></div>
              <div class="details-grid">
                <section class="detail-section">
                  <div class="editor-header compact-header">
                    <div>
                      <p class="section-kicker">Workspace impact</p>
                      <h3>Changed files</h3>
                    </div>
                  </div>
                  <ul id="selectedRunFiles" class="attachment-list"></ul>
                </section>
                <section class="detail-section">
                  <div class="editor-header compact-header">
                    <div>
                      <p class="section-kicker">Subtask review</p>
                      <h3>Artifacts</h3>
                    </div>
                  </div>
                  <div id="artifactList" class="artifact-list"></div>
                </section>
              </div>
            </article>
          </section>
        </div>
      `,
      extraCss: `
        :root {
          --run-bg: radial-gradient(circle at top left, color-mix(in srgb, var(--vscode-button-background) 18%, transparent), transparent 40%), linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background) 88%, black 12%), var(--vscode-editor-background));
          --run-panel: color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-editor-background)) 78%, transparent);
          --run-panel-strong: color-mix(in srgb, var(--vscode-sideBar-background, var(--vscode-editor-background)) 88%, black 12%);
          --run-border: color-mix(in srgb, var(--vscode-widget-border, var(--vscode-panel-border)) 70%, transparent);
          --run-accent: var(--vscode-button-background);
          --run-good: var(--vscode-testing-iconPassed, #4bb878);
          --run-warn: var(--vscode-testing-iconQueued, #d7a34b);
          --run-critical: var(--vscode-testing-iconFailed, #d05f5f);
          --run-muted: var(--vscode-descriptionForeground);
          --run-heading: "Segoe UI Variable Display", "Aptos Display", "Trebuchet MS", sans-serif;
          --run-body: "Segoe UI Variable Text", "Aptos", "Segoe UI", sans-serif;
          --run-radius: 22px;
          --run-shadow: 0 18px 48px rgba(0, 0, 0, 0.18);
        }

        body {
          padding: 0;
          background: var(--run-bg);
          font-family: var(--run-body);
        }

        code {
          font-family: var(--vscode-editor-font-family, var(--vscode-font-family, monospace));
        }

        button,
        input,
        textarea,
        table {
          font: inherit;
        }

        textarea {
          width: 100%;
          resize: vertical;
          color: var(--vscode-input-foreground);
          background: color-mix(in srgb, var(--vscode-input-background) 92%, transparent);
          border: 1px solid var(--run-border);
          padding: 12px 14px;
          border-radius: 16px;
          box-sizing: border-box;
        }

        textarea:focus,
        button:focus,
        input:focus {
          outline: 2px solid color-mix(in srgb, var(--vscode-focusBorder, var(--run-accent)) 70%, transparent);
          outline-offset: 2px;
        }

        table {
          width: 100%;
          border-collapse: collapse;
        }

        th,
        td {
          padding: 12px 14px;
          text-align: left;
          border-bottom: 1px solid color-mix(in srgb, var(--run-border) 86%, transparent);
          vertical-align: top;
        }

        th {
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--run-muted);
        }

        .run-center-shell {
          min-height: 100vh;
          padding: 24px;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .dashboard-topbar {
          display: flex;
          justify-content: space-between;
          gap: 24px;
          align-items: flex-start;
        }

        .dashboard-kicker,
        .section-kicker,
        .metric-label,
        .field-label {
          margin: 0 0 8px;
          text-transform: uppercase;
          letter-spacing: 0.18em;
          font-size: 11px;
          color: var(--run-muted);
        }

        .dashboard-topbar h1,
        .run-center-shell h2,
        .run-center-shell h3,
        .run-center-shell h4 {
          font-family: var(--run-heading);
          letter-spacing: -0.02em;
        }

        .dashboard-topbar h1 {
          margin: 0;
          font-size: clamp(30px, 4vw, 44px);
        }

        .dashboard-copy,
        .section-copy,
        .muted-line {
          color: var(--run-muted);
          line-height: 1.5;
        }

        .dashboard-copy,
        .section-copy {
          margin: 10px 0 0;
          max-width: 78ch;
          font-size: 14px;
        }

        .dashboard-actions,
        .button-row,
        .action-strip,
        .hero-meta {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .dashboard-button {
          border-radius: 999px;
          padding: 10px 18px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid var(--run-border);
          transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
        }

        .dashboard-button:hover {
          transform: translateY(-1px);
        }

        .dashboard-button-ghost {
          background: transparent;
          color: var(--vscode-foreground);
        }

        .dashboard-button-solid {
          background: linear-gradient(135deg, color-mix(in srgb, var(--run-accent) 86%, white 14%), color-mix(in srgb, var(--run-accent) 72%, black 10%));
          color: var(--vscode-button-foreground);
          border-color: color-mix(in srgb, var(--run-accent) 75%, white 10%);
        }

        .dashboard-button-danger {
          background: color-mix(in srgb, var(--run-critical) 22%, transparent);
          color: var(--vscode-foreground);
          border-color: color-mix(in srgb, var(--run-critical) 55%, transparent);
        }

        .hero-grid,
        .panel-grid,
        .workspace-grid,
        .details-grid,
        .preview-meta-grid,
        .posture-grid {
          display: grid;
          gap: 18px;
        }

        .hero-grid {
          grid-template-columns: minmax(0, 1.7fr) minmax(280px, 0.85fr);
        }

        .workspace-grid {
          grid-template-columns: minmax(0, 1.5fr) minmax(300px, 0.9fr);
          align-items: start;
        }

        .panel-grid {
          grid-template-columns: minmax(280px, 0.85fr) minmax(0, 1.15fr);
        }

        .details-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          align-items: start;
        }

        .preview-meta-grid,
        .posture-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .hero-card,
        .score-card,
        .panel-card,
        .list-card,
        .metric-pill,
        .preview-pill,
        .run-card,
        .artifact-card,
        .meta-pill,
        .status-banner,
        .detail-section,
        .timeline-entry,
        .file-chip,
        .empty-card {
          border: 1px solid var(--run-border);
          border-radius: var(--run-radius);
          background: linear-gradient(180deg, color-mix(in srgb, var(--run-panel-strong) 92%, white 8%), var(--run-panel));
          box-shadow: var(--run-shadow);
        }

        .hero-card,
        .score-card,
        .panel-card,
        .list-card,
        .detail-section {
          padding: 22px;
          box-sizing: border-box;
        }

        .hero-card {
          position: relative;
          overflow: hidden;
        }

        .hero-card::after {
          content: '';
          position: absolute;
          inset: auto -40px -60px auto;
          width: 220px;
          height: 220px;
          background: radial-gradient(circle, color-mix(in srgb, var(--run-accent) 22%, transparent), transparent 68%);
          pointer-events: none;
        }

        .meta-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 14px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--run-accent) 12%, transparent);
          box-shadow: none;
          font-size: 13px;
        }

        .metric-pill,
        .preview-pill {
          padding: 16px;
          box-shadow: none;
        }

        .metric-pill strong,
        .preview-pill strong {
          display: block;
          font-size: 15px;
          line-height: 1.4;
        }

        .preview-pill span {
          display: block;
          margin-top: 6px;
          color: var(--run-muted);
          font-size: 13px;
          line-height: 1.45;
        }

        .panel-header-row,
        .editor-header,
        .run-card-header,
        .artifact-header,
        .timeline-body {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
        }

        .compact-header {
          margin-bottom: 12px;
        }

        .field-stack,
        .editor-shell,
        .table-shell,
        .timeline-shell,
        .run-list,
        .artifact-list,
        .attachment-list,
        .button-stack {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .checkbox-card {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 12px;
          align-items: start;
          padding: 16px;
          border-radius: 18px;
          border: 1px solid var(--run-border);
          background: color-mix(in srgb, var(--run-panel) 92%, transparent);
        }

        .checkbox-inline {
          margin-top: 2px;
        }

        .checkbox-card input {
          margin-top: 2px;
        }

        .editor-shell,
        .table-shell,
        .timeline-shell,
        .detail-section {
          padding: 18px;
          border-radius: 20px;
          background: color-mix(in srgb, var(--run-panel) 92%, transparent);
          border: 1px solid var(--run-border);
          box-shadow: none;
        }

        .table-wrap {
          overflow-x: auto;
        }

        .status-banner {
          padding: 18px;
          box-shadow: none;
        }

        .status-banner[data-active='true'] {
          border-color: color-mix(in srgb, var(--run-accent) 58%, var(--run-border));
          background: linear-gradient(180deg, color-mix(in srgb, var(--run-accent) 14%, var(--run-panel-strong)), var(--run-panel));
        }

        .status-banner p {
          margin: 8px 0 0;
          color: var(--run-muted);
          line-height: 1.5;
        }

        .status-banner[data-active='true'] p {
          color: color-mix(in srgb, var(--vscode-foreground) 88%, var(--run-muted));
        }

        .status-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          background: color-mix(in srgb, var(--vscode-badge-background) 80%, transparent);
          color: var(--vscode-badge-foreground);
        }

        .tone-good {
          background: color-mix(in srgb, var(--run-good) 22%, transparent);
          color: color-mix(in srgb, var(--run-good) 84%, white 16%);
        }

        .tone-warn {
          background: color-mix(in srgb, var(--run-warn) 22%, transparent);
          color: color-mix(in srgb, var(--run-warn) 84%, white 16%);
        }

        .tone-critical {
          background: color-mix(in srgb, var(--run-critical) 20%, transparent);
          color: color-mix(in srgb, var(--run-critical) 84%, white 16%);
        }

        .tone-accent,
        .tone-neutral {
          background: color-mix(in srgb, var(--run-accent) 18%, transparent);
          color: color-mix(in srgb, var(--run-accent) 76%, white 24%);
        }

        .run-list,
        .artifact-list {
          display: grid;
          gap: 12px;
        }

        .run-card,
        .artifact-card {
          padding: 18px;
          box-shadow: none;
        }

        .run-card.active {
          border-color: color-mix(in srgb, var(--run-accent) 60%, transparent);
          background: linear-gradient(180deg, color-mix(in srgb, var(--run-accent) 14%, var(--run-panel-strong)), var(--run-panel));
        }

        .run-card h3,
        .artifact-card h3,
        .detail-section h3 {
          margin: 0;
          font-size: 18px;
        }

        .run-card p,
        .artifact-card p,
        .selected-run-summary p,
        .timeline-entry p,
        .empty-card p {
          margin: 0;
          color: var(--run-muted);
          line-height: 1.5;
        }

        .run-meta,
        .artifact-meta,
        .summary-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-top: 12px;
        }

        .summary-grid {
          margin-top: 0;
          margin-bottom: 12px;
        }

        .summary-block {
          padding: 14px 16px;
          border-radius: 18px;
          background: color-mix(in srgb, var(--run-panel) 92%, transparent);
          border: 1px solid var(--run-border);
        }

        .summary-block strong,
        .summary-block span {
          display: block;
        }

        .summary-block span {
          margin-top: 6px;
          color: var(--run-muted);
          font-size: 13px;
        }

        .timeline-list,
        .attachment-list {
          list-style: none;
          margin: 0;
          padding: 0;
        }

        .timeline-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .timeline-entry {
          display: grid;
          grid-template-columns: 10px 1fr;
          gap: 14px;
          padding: 14px 16px;
          box-shadow: none;
        }

        .timeline-dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          margin-top: 5px;
          background: color-mix(in srgb, var(--run-accent) 72%, white 28%);
        }

        .timeline-time,
        .subtle-label {
          display: block;
          margin-top: 6px;
          color: var(--run-muted);
          font-size: 12px;
        }

        .attachment-list {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }

        .file-chip {
          border: 1px solid var(--run-border);
          padding: 0;
          box-shadow: none;
          overflow: hidden;
        }

        .file-chip button,
        .run-card button,
        .action-strip button {
          width: 100%;
          text-align: left;
          border: 0;
          background: transparent;
          color: inherit;
          padding: 12px 14px;
          cursor: pointer;
        }

        .file-chip button:hover,
        .run-card button:hover,
        .action-strip button:hover {
          background: color-mix(in srgb, var(--run-accent) 10%, transparent);
        }

        .action-strip {
          margin-bottom: 14px;
        }

        .selected-run-summary {
          margin-bottom: 14px;
        }

        .artifact-card pre {
          overflow-x: auto;
          white-space: pre-wrap;
          word-break: break-word;
          background: var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.12));
          padding: 12px;
          border-radius: 14px;
          margin: 12px 0 0;
          border: 1px solid color-mix(in srgb, var(--run-border) 88%, transparent);
        }

        .empty-card {
          padding: 18px;
          box-shadow: none;
        }

        .empty-card strong {
          display: block;
          margin-bottom: 6px;
        }

        @media (max-width: 1180px) {
          .workspace-grid,
          .panel-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 920px) {
          .hero-grid,
          .details-grid,
          .preview-meta-grid,
          .posture-grid,
          .summary-grid,
          .run-meta,
          .artifact-meta {
            grid-template-columns: 1fr;
          }

          .dashboard-topbar,
          .panel-header-row,
          .editor-header {
            flex-direction: column;
          }
        }

        @media (max-width: 640px) {
          .run-center-shell {
            padding: 18px;
          }

          .hero-card,
          .score-card,
          .panel-card,
          .list-card,
          .detail-section {
            padding: 18px;
          }
        }
      `,
      scriptContent: buildScript(),
    });
  }
}

export function isProjectRunCenterMessage(value: unknown): value is ProjectRunCenterMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }

  const message = value as { type?: unknown; payload?: unknown };
  if (
    message.type === 'executePreview'
    || message.type === 'refreshRuns'
    || message.type === 'deleteRun'
    || message.type === 'openIdeation'
    || message.type === 'openSourceControl'
    || message.type === 'rollbackLastCheckpoint'
    || message.type === 'approveNextBatch'
    || message.type === 'pauseRun'
    || message.type === 'resumeRun'
    || message.type === 'retryFailedSubtasks'
  ) {
    return true;
  }

  if (message.type === 'setRequireBatchApproval' && typeof message.payload === 'boolean') {
    return true;
  }

  if (message.type === 'discussDraft') {
    return isProjectRunDiscussionPayload(message.payload);
  }

  return (
    message.type === 'previewGoal'
    || message.type === 'updatePlanDraft'
    || message.type === 'openRunReport'
    || message.type === 'openFileReference'
    || message.type === 'selectRun'
  ) && typeof message.payload === 'string';
}

function serializePreview(preview: ProjectRunPreviewState) {
  return {
    runId: preview.runId,
    goal: preview.goal,
    estimatedFiles: preview.estimatedFiles,
    requiresApproval: preview.requiresApproval,
    approvalThreshold: preview.approvalThreshold,
    plan: {
      subTasks: preview.plan.subTasks.map(task => ({
        id: task.id,
        title: task.title,
        role: task.role,
        dependsOn: task.dependsOn,
      })),
    },
    planDraft: preview.planDraft,
    executionJobCount: preview.executionJobCount,
    firstExecutionJobSubtaskCount: preview.firstExecutionJobSubtaskCount,
    remainingExecutionSubtaskCount: preview.remainingExecutionSubtaskCount,
  };
}

function serializeRun(run: ProjectRunRecord) {
  return {
    id: run.id,
    title: run.title,
    goal: run.goal,
    status: run.status,
    updatedAt: run.updatedAt,
    estimatedFiles: run.estimatedFiles,
    requiresApproval: run.requiresApproval,
    planSubtaskCount: run.planSubtaskCount,
    completedSubtaskCount: run.completedSubtaskCount,
    totalSubtaskCount: run.totalSubtaskCount,
    currentBatch: run.currentBatch,
    totalBatches: run.totalBatches,
    requireBatchApproval: run.requireBatchApproval,
    plannerJobIndex: run.plannerJobIndex,
    plannerJobCount: run.plannerJobCount,
    failedSubtaskTitles: run.failedSubtaskTitles,
    reportPath: run.reportPath,
    logs: run.logs,
    subTaskArtifacts: run.subTaskArtifacts,
    changedFiles: run.summary?.changedFiles ?? [],
    changeSummary: run.summary ? summarizeChangedFiles(run.summary.changedFiles) : 'created 0, modified 0, deleted 0',
  };
}

function buildScript(): string {
  return `
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const goalInput = document.getElementById('goalInput');
  const previewButton = document.getElementById('previewGoal');
  const applyPlanEditsButton = document.getElementById('applyPlanEdits');
  const discussDraftButton = document.getElementById('discussDraft');
  const executeButton = document.getElementById('executePreview');
  const refreshButton = document.getElementById('refreshRuns');
  const openIdeationButton = document.getElementById('openIdeation');
  const approveBatchButton = document.getElementById('approveNextBatch');
  const pauseRunButton = document.getElementById('pauseRun');
  const resumeRunButton = document.getElementById('resumeRun');
  const openScmButton = document.getElementById('openScm');
  const rollbackButton = document.getElementById('rollbackCheckpoint');
  const requireBatchApproval = document.getElementById('requireBatchApproval');
  const liveStatus = document.getElementById('liveStatus');
  const previewMeta = document.getElementById('previewMeta');
  const previewRows = document.getElementById('previewRows');
  const planDraftInput = document.getElementById('planDraftInput');
  const liveLog = document.getElementById('liveLog');
  const runsList = document.getElementById('runsList');
  const selectedRun = document.getElementById('selectedRun');
  const selectedRunActions = document.getElementById('selectedRunActions');
  const selectedRunFiles = document.getElementById('selectedRunFiles');
  const artifactList = document.getElementById('artifactList');
  const heroLiveStatus = document.getElementById('heroLiveStatus');
  const heroApprovalMode = document.getElementById('heroApprovalMode');
  const heroRunCount = document.getElementById('heroRunCount');
  const metricSelectedStatus = document.getElementById('metricSelectedStatus');
  const metricSelectedProgress = document.getElementById('metricSelectedProgress');
  const metricSelectedImpact = document.getElementById('metricSelectedImpact');
  const metricPreviewStatus = document.getElementById('metricPreviewStatus');

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/[<]/g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatTimestamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value || 'Unknown');
    }
    return date.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  }

  function getStatusTone(status) {
    switch (String(status || '').toLowerCase()) {
      case 'completed':
        return 'good';
      case 'failed':
        return 'critical';
      case 'running':
        return 'accent';
      case 'previewed':
        return 'neutral';
      default:
        return 'warn';
    }
  }

  function getLogTone(level) {
    switch (String(level || '').toLowerCase()) {
      case 'error':
        return 'critical';
      case 'warning':
        return 'warn';
      default:
        return 'accent';
    }
  }

  function renderStatusBadge(label, tone) {
    return '<span class="status-badge tone-' + escapeHtml(tone) + '">' + escapeHtml(label) + '<' + '/span>';
  }

  function getTddTone(status) {
    switch (status) {
      case 'verified':
        return 'good';
      case 'blocked':
        return 'critical';
      case 'missing':
        return 'warn';
      default:
        return 'neutral';
    }
  }

  function summarizeTddStatuses(artifacts) {
    const counts = { verified: 0, blocked: 0, missing: 0, 'not-applicable': 0 };
    (Array.isArray(artifacts) ? artifacts : []).forEach(artifact => {
      const status = artifact && typeof artifact.tddStatus === 'string' ? artifact.tddStatus : 'not-applicable';
      if (status in counts) {
        counts[status] += 1;
      }
    });
    return [
      counts.verified > 0 ? String(counts.verified) + ' verified' : '',
      counts.blocked > 0 ? String(counts.blocked) + ' blocked' : '',
      counts.missing > 0 ? String(counts.missing) + ' missing evidence' : '',
      counts['not-applicable'] > 0 ? String(counts['not-applicable']) + ' n/a' : '',
    ].filter(Boolean).join(' • ') || 'No TDD telemetry recorded';
  }

  function renderEmptyCard(title, copy) {
    return '<div class="empty-card"><strong>' + escapeHtml(title) + '<' + '/strong><p>' + escapeHtml(copy) + '<' + '/p><' + '/div>';
  }

  function setText(element, value) {
    if (element) {
      element.textContent = value;
    }
  }

  function renderOverview(payload) {
    const runs = Array.isArray(payload.runs) ? payload.runs : [];
    const preview = payload.preview || null;
    const run = payload.selectedRun || null;
    const liveMessage = String(payload.liveStatus || 'Idle');
    const approvalEnabled = Boolean(payload.requireBatchApproval);
    const isRunning = Boolean(run && run.status === 'running');
    const awaitingApproval = Boolean(run && run.awaitingBatchApproval);
    const isPaused = Boolean(run && run.paused);

    setText(heroLiveStatus, liveMessage);
    setText(heroApprovalMode, approvalEnabled ? 'Batch approval on' : 'Batch approval off');
    setText(heroRunCount, String(runs.length) + ' tracked run' + (runs.length === 1 ? '' : 's'));
    setText(metricSelectedStatus, run ? String(run.status || 'Unknown') : 'No run selected');
    setText(metricSelectedProgress, run ? String(run.completedSubtaskCount) + '/' + String(run.totalSubtaskCount) + ' subtasks' : '0/0 subtasks');
    setText(metricSelectedImpact, run ? String(run.changeSummary || 'No recorded changes') : 'No recorded changes');
    setText(metricPreviewStatus, preview
      ? String(preview.plan && Array.isArray(preview.plan.subTasks) ? preview.plan.subTasks.length : 0) + ' subtasks ready'
      : 'No preview loaded');

    if (liveStatus) {
      liveStatus.innerHTML =
        renderStatusBadge(run ? run.status : approvalEnabled ? 'approval mode' : 'idle', run ? getStatusTone(run.status) : approvalEnabled ? 'warn' : 'neutral') +
        '<p>' + escapeHtml(buildExecutionMessage(liveMessage, run, approvalEnabled)) + '<' + '/p>';
      liveStatus.setAttribute('data-active', isRunning || awaitingApproval || isPaused ? 'true' : 'false');
    }

    if (approveBatchButton instanceof HTMLButtonElement) {
      approveBatchButton.hidden = !approvalEnabled;
      approveBatchButton.disabled = !awaitingApproval;
      approveBatchButton.title = awaitingApproval
        ? 'Approve the next scheduled batch.'
        : approvalEnabled
          ? 'Atlas is not currently waiting for batch approval.'
          : 'Enable batch approval to use this control.';
    }
    if (pauseRunButton instanceof HTMLButtonElement) {
      pauseRunButton.disabled = !isRunning || isPaused;
    }
    if (resumeRunButton instanceof HTMLButtonElement) {
      resumeRunButton.disabled = !isPaused;
    }
  }

  function renderPreview(preview) {
    if (!preview) {
      if (previewMeta) {
        previewMeta.innerHTML = renderEmptyCard('No preview generated yet', 'Describe a goal and generate a planner preview before editing or executing a run.');
      }
      if (previewRows) { previewRows.innerHTML = ''; }
      if (planDraftInput) { planDraftInput.value = ''; }
      return;
    }
    if (previewMeta) {
      previewMeta.innerHTML = [
        '<div class="preview-pill">',
        '<p class="field-label">Preview output<' + '/p>',
        '<strong>Execution draft ready for review<' + '/strong>',
        '<span>Stored under run id ' + escapeHtml(preview.runId) + '. Atlas will execute this reviewed draft, not the raw goal text, once you proceed.' + '<' + '/span>',
        '<' + '/div>',
        '<div class="preview-pill">',
        '<p class="field-label">Subtasks explained<' + '/p>',
        '<strong>' + escapeHtml(String((preview.plan && Array.isArray(preview.plan.subTasks) ? preview.plan.subTasks.length : 0))) + ' dependency-safe work chunks<' + '/strong>',
        '<span>Each subtask is a chunk of work Atlas can schedule safely. Dependencies decide batch order so later work waits for prerequisites.' + '<' + '/span>',
        '<' + '/div>',
        '<div class="preview-pill">',
        '<p class="field-label">Impact estimate<' + '/p>',
        '<strong>~' + escapeHtml(String(preview.estimatedFiles)) + ' files<' + '/strong>',
        '<span>' + escapeHtml(preview.requiresApproval
          ? 'This is above the review threshold of ' + preview.approvalThreshold + ' files. That threshold is not a hard cap; it means Atlas recommends extra review or batch approvals before you execute the full plan.'
          : 'This is below the current review threshold. The estimate is a heuristic, not a hard file cap, so the real change set can still vary.') + '<' + '/span>',
        '<' + '/div>',
        '<div class="preview-pill">',
        '<p class="field-label">Decision guide<' + '/p>',
        '<strong>' + escapeHtml(preview.executionJobCount > 1
          ? 'Atlas will stage this into multiple planner jobs'
          : (preview.requiresApproval ? 'Refine or execute with checkpoints' : 'Review and execute when ready')) + '<' + '/strong>',
        '<span>' + escapeHtml(preview.requiresApproval
          ? (preview.executionJobCount > 1
            ? 'This preview is large enough that Atlas will start with the first planner job and queue the remaining scope as a follow-up draft once that first stage succeeds.'
            : 'You can still execute all planned work. Your options are: discuss the draft in chat, move into ideation if scope is still fuzzy, or keep batch approval enabled so Atlas pauses for human review while it works through the full plan.')
          : (preview.executionJobCount > 1
            ? 'Atlas can start with the first planner job now and leave the remaining work as the next draft, which keeps a very large project reviewable without losing the overall plan.'
            : 'If the scope is right, execute it. If not, discuss the draft with Atlas or move into ideation before you lock the plan.')) + '<' + '/span>',
        '<' + '/div>',
        (preview.executionJobCount > 1
          ? '<div class="preview-pill">' +
              '<p class="field-label">Planner jobs<' + '/p>' +
              '<strong>' + escapeHtml(String(preview.executionJobCount)) + ' staged job(s)<' + '/strong>' +
              '<span>Executing now will run the first ' + escapeHtml(String(preview.firstExecutionJobSubtaskCount)) + ' subtask(s). The remaining ' + escapeHtml(String(preview.remainingExecutionSubtaskCount)) + ' subtask(s) stay queued as the next draft.' + '<' + '/span>' +
            '<' + '/div>'
          : '')
      ].join('');
    }
    if (previewRows) {
      previewRows.innerHTML = preview.plan.subTasks.map(task => {
        const dependsOn = Array.isArray(task.dependsOn) && task.dependsOn.length > 0 ? task.dependsOn.join(', ') : 'None';
        return '<tr>' +
          '<td>' + escapeHtml(task.id) + '<' + '/td>' +
          '<td>' + escapeHtml(task.title) + '<' + '/td>' +
          '<td>' + escapeHtml(task.role) + '<' + '/td>' +
          '<td>' + escapeHtml(dependsOn) + '<' + '/td>' +
          '<' + '/tr>';
      }).join('');
    }
    if (planDraftInput) {
      planDraftInput.value = preview.planDraft || '';
    }
  }

  function renderRunCards(runs, selectedRunId) {
    if (!runsList) {
      return;
    }
    if (!Array.isArray(runs) || runs.length === 0) {
      runsList.innerHTML = renderEmptyCard('No project runs recorded yet', 'The run history will appear here after you preview or execute a project run.');
      return;
    }
    runsList.innerHTML = runs.map(run => {
      const failed = Array.isArray(run.failedSubtaskTitles) && run.failedSubtaskTitles.length > 0
        ? '<p>Failures: ' + escapeHtml(run.failedSubtaskTitles.join(', ')) + '<' + '/p>'
        : '<p>No failed subtasks recorded.<' + '/p>';
      const reportButton = run.reportPath
        ? '<button type="button" data-action="open-report" data-run-report="' + escapeHtml(run.reportPath) + '">Open Report<' + '/button>'
        : '';
      const deleteButton = run.status !== 'running'
        ? '<button type="button" data-action="delete-run" data-run-id="' + escapeHtml(run.id) + '">Delete Run<' + '/button>'
        : '';
      const activeClass = run.id === selectedRunId ? ' active' : '';
      return '<article class="run-card' + activeClass + '">' +
        '<div class="run-card-header">' +
          '<div>' +
            '<p class="section-kicker">Tracked run<' + '/p>' +
            '<h3>' + escapeHtml(run.title) + '<' + '/h3>' +
            '<p class="section-copy">' + escapeHtml(run.goal) + '<' + '/p>' +
          '<' + '/div>' +
          renderStatusBadge(run.status, getStatusTone(run.status)) +
        '<' + '/div>' +
        '<div class="run-meta">' +
          '<div><span class="metric-label">Updated<' + '/span><strong>' + escapeHtml(formatTimestamp(run.updatedAt)) + '<' + '/strong><' + '/div>' +
          '<div><span class="metric-label">Progress<' + '/span><strong>' + escapeHtml(String(run.completedSubtaskCount) + '/' + String(run.totalSubtaskCount)) + ' subtasks<' + '/strong><' + '/div>' +
          '<div><span class="metric-label">Estimated files<' + '/span><strong>~' + escapeHtml(String(run.estimatedFiles)) + '<' + '/strong><' + '/div>' +
          '<div><span class="metric-label">Change summary<' + '/span><strong>' + escapeHtml(run.changeSummary || 'No changes recorded') + '<' + '/strong><' + '/div>' +
        '<' + '/div>' +
        failed +
        '<div class="action-strip">' +
          '<button type="button" data-action="select-run" data-run-id="' + escapeHtml(run.id) + '">Inspect Run<' + '/button>' +
          reportButton +
          deleteButton +
        '<' + '/div>' +
      '<' + '/article>';
    }).join('');
  }

  function renderLogEntries(entries) {
    if (!liveLog) {
      return;
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      liveLog.innerHTML = '<li>' + renderEmptyCard('No telemetry yet', 'Run activity and planner updates will appear here once AtlasMind begins writing run history logs.') + '<' + '/li>';
      return;
    }
    liveLog.innerHTML = entries.slice(-12).reverse().map(entry =>
      '<li class="timeline-entry">' +
        '<span class="timeline-dot tone-' + escapeHtml(getLogTone(entry.level)) + '"><' + '/span>' +
        '<div class="timeline-body">' +
          '<div>' +
            '<strong>' + escapeHtml(entry.message) + '<' + '/strong>' +
            '<span class="subtle-label">' + escapeHtml(String(entry.level || 'info').toUpperCase()) + '<' + '/span>' +
          '<' + '/div>' +
          '<span class="timeline-time">' + escapeHtml(formatTimestamp(entry.timestamp)) + '<' + '/span>' +
        '<' + '/div>' +
      '<' + '/li>'
    ).join('');
  }

  function renderSelectedRun(run) {
    if (!selectedRun || !selectedRunFiles || !selectedRunActions || !artifactList) {
      return;
    }
    if (!run) {
      selectedRun.innerHTML = renderEmptyCard('Select a run to inspect it', 'Choose a tracked run from the history list to review its files, report, and subtask artifacts.');
      selectedRunActions.innerHTML = '';
      selectedRunFiles.innerHTML = '';
      artifactList.innerHTML = renderEmptyCard('No artifacts selected', 'Subtask-level diff previews and verification notes appear once a run is selected.');
      renderLogEntries([]);
      return;
    }
    const tddSummary = summarizeTddStatuses(run.subTaskArtifacts);
    selectedRun.innerHTML =
      '<div class="summary-grid">' +
        '<div class="summary-block"><span class="metric-label">Run<' + '/span><strong>' + escapeHtml(run.title) + '<' + '/strong><span>' + escapeHtml(run.goal) + '<' + '/span><' + '/div>' +
        '<div class="summary-block"><span class="metric-label">Status<' + '/span><strong>' + renderStatusBadge(run.status, getStatusTone(run.status)) + '<' + '/strong><' + '/div>' +
        (run.plannerJobIndex && run.plannerJobCount
          ? '<div class="summary-block"><span class="metric-label">Planner job<' + '/span><strong>' + escapeHtml(String(run.plannerJobIndex)) + '/' + escapeHtml(String(run.plannerJobCount)) + '<' + '/strong><span>Large plans can advance one staged draft at a time.<' + '/span><' + '/div>'
          : '') +
        '<div class="summary-block"><span class="metric-label">Subtasks<' + '/span><strong>' + escapeHtml(String(run.completedSubtaskCount) + '/' + String(run.totalSubtaskCount)) + '<' + '/strong><span>' + escapeHtml(run.planSubtaskCount ? String(run.planSubtaskCount) + ' planned initially' : 'Planner count unavailable') + '<' + '/span><' + '/div>' +
        '<div class="summary-block"><span class="metric-label">Batches<' + '/span><strong>' + escapeHtml(run.totalBatches > 0 ? String(run.currentBatch) + '/' + String(run.totalBatches) : 'n/a') + '<' + '/strong><span>' + escapeHtml(run.changeSummary || 'No changed files recorded') + '<' + '/span><' + '/div>' +
        '<div class="summary-block"><span class="metric-label">TDD<' + '/span><strong>' + escapeHtml(tddSummary) + '<' + '/strong><span>Implementation writes now require a failing test signal first.<' + '/span><' + '/div>' +
      '<' + '/div>';
    selectedRunActions.innerHTML = '';
    if (run.reportPath) {
      selectedRunActions.innerHTML += '<button type="button" data-action="open-report" data-run-report="' + escapeHtml(run.reportPath) + '">Open Report<' + '/button>';
    }
    if (run.status === 'failed') {
      selectedRunActions.innerHTML += '<button type="button" data-action="retry-failed">Retry Failed Subtasks<' + '/button>';
    }
    if (run.status !== 'running') {
      selectedRunActions.innerHTML += '<button type="button" data-action="delete-run" data-run-id="' + escapeHtml(run.id) + '">Delete Run<' + '/button>';
    }
    selectedRunFiles.innerHTML = '';
    if (!Array.isArray(run.changedFiles) || run.changedFiles.length === 0) {
      selectedRunFiles.innerHTML = '<li>' + renderEmptyCard('No changed files recorded', 'This run did not persist any changed file references into its summary.') + '<' + '/li>';
    }
    (Array.isArray(run.changedFiles) ? run.changedFiles : []).forEach(file => {
      const item = document.createElement('li');
      item.className = 'file-chip';
      const button = document.createElement('button');
      button.textContent = file.relativePath + ' (' + file.status + ')';
      button.setAttribute('data-action', 'open-file');
      button.setAttribute('data-file-path', file.relativePath);
      item.appendChild(button);
      selectedRunFiles.appendChild(item);
    });
    if (!Array.isArray(run.subTaskArtifacts) || run.subTaskArtifacts.length === 0) {
      artifactList.innerHTML = renderEmptyCard('No artifacts recorded', 'Artifacts will appear here after AtlasMind persists per-subtask execution details.');
      renderLogEntries(run.logs || []);
      return;
    }
    artifactList.innerHTML = (Array.isArray(run.subTaskArtifacts) ? run.subTaskArtifacts : []).map(artifact => {
      const diff = artifact.diffPreview ? '<pre>' + escapeHtml(artifact.diffPreview) + '<' + '/pre>' : '';
      const verification = artifact.verificationSummary ? '<p>Verification: ' + escapeHtml(artifact.verificationSummary) + '<' + '/p>' : '';
      const tdd = artifact.tddStatus
        ? '<p>TDD: ' + renderStatusBadge(artifact.tddStatus, getTddTone(artifact.tddStatus)) + (artifact.tddSummary ? ' ' + escapeHtml(artifact.tddSummary) : '') + '<' + '/p>'
        : '';
      const tools = artifact.toolCallCount > 0
        ? '<p>Tools: ' + escapeHtml(String(artifact.toolCallCount)) + ' (' + escapeHtml((artifact.toolCalls || []).map(tool => tool.toolName).join(', ')) + ')<' + '/p>'
        : '<p>Tools: none<' + '/p>';
      return '<article class="artifact-card">' +
        '<div class="artifact-header">' +
          '<h3>' + escapeHtml(artifact.title) + '<' + '/h3>' +
          renderStatusBadge(artifact.status, getStatusTone(artifact.status)) +
        '<' + '/div>' +
        '<div class="artifact-meta">' +
          '<div><span class="metric-label">Role<' + '/span><strong>' + escapeHtml(artifact.role) + '<' + '/strong><' + '/div>' +
          '<div><span class="metric-label">Depends on<' + '/span><strong>' + escapeHtml((artifact.dependsOn || []).join(', ') || 'None') + '<' + '/strong><' + '/div>' +
          '<div><span class="metric-label">Duration<' + '/span><strong>' + escapeHtml(String(artifact.durationMs)) + 'ms<' + '/strong><' + '/div>' +
          '<div><span class="metric-label">Changed files<' + '/span><strong>' + escapeHtml((artifact.changedFiles || []).map(file => file.relativePath).join(', ') || 'none') + '<' + '/strong><' + '/div>' +
        '<' + '/div>' +
        tools +
        tdd +
        verification +
        diff +
      '<' + '/article>';
    }).join('');
    renderLogEntries(run.logs || []);
  }

  if (previewButton) {
    previewButton.addEventListener('click', () => {
      const goal = goalInput instanceof HTMLTextAreaElement ? goalInput.value : '';
      vscode.postMessage({ type: 'previewGoal', payload: goal });
    });
  }
  if (applyPlanEditsButton) {
    applyPlanEditsButton.addEventListener('click', () => {
      const value = planDraftInput instanceof HTMLTextAreaElement ? planDraftInput.value : '';
      vscode.postMessage({ type: 'updatePlanDraft', payload: value });
    });
  }
  if (discussDraftButton) {
    discussDraftButton.addEventListener('click', () => {
      const goal = goalInput instanceof HTMLTextAreaElement ? goalInput.value : '';
      const planDraft = planDraftInput instanceof HTMLTextAreaElement ? planDraftInput.value : '';
      vscode.postMessage({ type: 'discussDraft', payload: { goal: goal, planDraft: planDraft } });
    });
  }
  if (executeButton) {
    executeButton.addEventListener('click', () => vscode.postMessage({ type: 'executePreview' }));
  }
  if (refreshButton) {
    refreshButton.addEventListener('click', () => vscode.postMessage({ type: 'refreshRuns' }));
  }
  if (approveBatchButton) {
    approveBatchButton.addEventListener('click', () => vscode.postMessage({ type: 'approveNextBatch' }));
  }
  if (pauseRunButton) {
    pauseRunButton.addEventListener('click', () => vscode.postMessage({ type: 'pauseRun' }));
  }
  if (resumeRunButton) {
    resumeRunButton.addEventListener('click', () => vscode.postMessage({ type: 'resumeRun' }));
  }
  if (openScmButton) {
    openScmButton.addEventListener('click', () => vscode.postMessage({ type: 'openSourceControl' }));
  }
  if (openIdeationButton) {
    openIdeationButton.addEventListener('click', () => vscode.postMessage({ type: 'openIdeation' }));
  }
  if (rollbackButton) {
    rollbackButton.addEventListener('click', () => vscode.postMessage({ type: 'rollbackLastCheckpoint' }));
  }
  if (requireBatchApproval instanceof HTMLInputElement) {
    requireBatchApproval.addEventListener('change', () => {
      vscode.postMessage({ type: 'setRequireBatchApproval', payload: requireBatchApproval.checked });
    });
  }
  if (runsList) {
    runsList.addEventListener('click', event => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement)) {
        return;
      }
      const action = target.getAttribute('data-action');
      if (action === 'select-run') {
        vscode.postMessage({ type: 'selectRun', payload: target.getAttribute('data-run-id') || '' });
      }
      if (action === 'open-report') {
        vscode.postMessage({ type: 'openRunReport', payload: target.getAttribute('data-run-report') || '' });
      }
      if (action === 'delete-run') {
        vscode.postMessage({ type: 'deleteRun', payload: target.getAttribute('data-run-id') || '' });
      }
    });
  }
  if (selectedRunFiles) {
    selectedRunFiles.addEventListener('click', event => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement)) {
        return;
      }
      if (target.getAttribute('data-action') === 'open-file') {
        vscode.postMessage({ type: 'openFileReference', payload: target.getAttribute('data-file-path') || '' });
      }
    });
  }
  if (selectedRunActions) {
    selectedRunActions.addEventListener('click', event => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement)) {
        return;
      }
      const action = target.getAttribute('data-action');
      if (action === 'open-report') {
        vscode.postMessage({ type: 'openRunReport', payload: target.getAttribute('data-run-report') || '' });
      }
      if (action === 'retry-failed') {
        vscode.postMessage({ type: 'retryFailedSubtasks' });
      }
      if (action === 'delete-run') {
        vscode.postMessage({ type: 'deleteRun', payload: target.getAttribute('data-run-id') || '' });
      }
    });
  }

  window.addEventListener('message', event => {
    const message = event.data;
    if (!message || message.type !== 'state') {
      return;
    }
    const payload = message.payload || {};
    if (requireBatchApproval instanceof HTMLInputElement) {
      requireBatchApproval.checked = Boolean(payload.requireBatchApproval);
    }
    renderOverview(payload);
    renderPreview(payload.preview || null);
    renderRunCards(payload.runs || [], payload.selectedRun ? payload.selectedRun.id : '');
    renderSelectedRun(payload.selectedRun || null);
  });

  function buildExecutionMessage(liveMessage, run, approvalEnabled) {
    if (!run) {
      return approvalEnabled
        ? 'Batch approval mode is enabled. Preview a plan to decide whether you want Atlas to stop at each batch boundary.'
        : liveMessage;
    }
    if (run.status === 'running' && run.awaitingBatchApproval) {
      return 'Atlas is paused at a batch checkpoint and waiting for your approval before it continues.';
    }
    if (run.status === 'running' && run.paused) {
      return 'Atlas has paused before the next batch. Resume when you want execution to continue.';
    }
    if (run.status === 'running') {
      return 'Atlas is actively executing the reviewed plan. Watch the live log below for subtask starts, completions, and batch changes.';
    }
    if (run.status === 'previewed') {
      return 'This run is still a draft. Review the JSON plan, discuss or refine it if needed, then execute when the scope looks right.';
    }
    return liveMessage;
  }
})();`;
}

function isProjectRunDiscussionPayload(value: unknown): value is ProjectRunDiscussionPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  return typeof payload['goal'] === 'string' && typeof payload['planDraft'] === 'string';
}

function buildDraftDiscussionPrompt(
  goal: string,
  planDraft: string,
  previewState: ProjectRunPreviewState | undefined,
): string {
  const trimmedGoal = goal.trim() || previewState?.goal || 'No goal provided yet.';
  const draft = planDraft.trim() || previewState?.planDraft || '{}';
  const subtaskCount = previewState?.plan.subTasks.length;
  return [
    'Help me refine this AtlasMind Project Run draft before I execute it.',
    'Pressure-test the scope, expected outputs, missing assumptions, dependency order, approval strategy, and whether this should move into ideation first.',
    'If the draft is too broad, suggest a smaller v1 plus the best follow-up runs.',
    '',
    `Goal: ${trimmedGoal}`,
    ...(typeof subtaskCount === 'number' ? [`Current preview subtasks: ${subtaskCount}`] : []),
    '',
    'Current plan draft:',
    '```json',
    draft,
    '```',
  ].join('\n');
}

function buildExecutionSplitPreview(
  plan: ProjectPlan,
  projectUiConfig: { approvalFileThreshold: number; estimatedFilesPerSubtask: number },
  precompletedSubtaskIds: string[] = [],
): Pick<ProjectRunPreviewState, 'executionJobCount' | 'firstExecutionJobSubtaskCount' | 'remainingExecutionSubtaskCount'> {
  const jobs = splitPlanIntoExecutionJobs(plan, {
    maxEstimatedFilesPerJob: projectUiConfig.approvalFileThreshold,
    estimatedFilesPerSubtask: projectUiConfig.estimatedFilesPerSubtask,
    precompletedSubtaskIds,
  });
  const firstExecutionJobSubtaskCount = jobs[0]?.plan.subTasks.length ?? plan.subTasks.length;
  return {
    executionJobCount: jobs.length,
    firstExecutionJobSubtaskCount,
    remainingExecutionSubtaskCount: Math.max(0, plan.subTasks.length - firstExecutionJobSubtaskCount),
  };
}

function hydratePreviewStateFromRun(
  run: ProjectRunRecord,
  projectUiConfig: { approvalFileThreshold: number; estimatedFilesPerSubtask: number },
): ProjectRunPreviewState | undefined {
  if (run.status !== 'previewed' || !run.plan) {
    return undefined;
  }

  return {
    runId: run.id,
    goal: run.goal,
    estimatedFiles: run.estimatedFiles,
    requiresApproval: run.requiresApproval,
    approvalThreshold: projectUiConfig.approvalFileThreshold,
    plan: run.plan,
    planDraft: JSON.stringify({ subTasks: run.plan.subTasks }, null, 2),
    ...buildExecutionSplitPreview(run.plan, projectUiConfig, (run.plannerSeedResults ?? []).map(seed => seed.subTaskId)),
  };
}

function seedResultsToSubTaskResults(seedResults: ProjectRunSeedResult[] | undefined): SubTaskResult[] {
  return (seedResults ?? []).map(seed => ({
    subTaskId: seed.subTaskId,
    title: seed.title,
    status: 'completed',
    output: seed.output,
    costUsd: 0,
    durationMs: 0,
  }));
}

function mergePlannerSeedResults(
  existingSeedResults: ProjectRunSeedResult[] | undefined,
  results: SubTaskResult[],
): ProjectRunSeedResult[] {
  const merged = new Map<string, ProjectRunSeedResult>();
  for (const seed of existingSeedResults ?? []) {
    merged.set(seed.subTaskId, { ...seed });
  }
  for (const result of results) {
    if (result.status !== 'completed') {
      continue;
    }
    merged.set(result.subTaskId, {
      subTaskId: result.subTaskId,
      title: result.title,
      output: result.output,
    });
  }
  return [...merged.values()];
}

function buildPlannerFollowUpRunId(rootRunId: string, plannerJobIndex: number): string {
  return `${rootRunId}-job-${plannerJobIndex}`;
}

export function parseEditableProjectPlan(goal: string, runId: string, rawDraft: string): ProjectPlan | undefined {
  const parsedTasks = parsePlannerResponse(rawDraft);
  if (parsedTasks.length === 0) {
    return undefined;
  }

  return {
    id: runId,
    goal,
    subTasks: removeCycles(parsedTasks),
  };
}

function buildArtifactFromResult(
  result: SubTaskResult,
  changedFiles: ChangedWorkspaceFile[],
  diffPreview: string | undefined,
): ProjectRunSubTaskArtifact {
  return {
    subTaskId: result.subTaskId,
    title: result.title,
    role: result.role ?? 'general-assistant',
    dependsOn: [...(result.dependsOn ?? [])],
    status: result.status,
    output: result.output,
    outputPreview: result.artifacts?.outputPreview ?? result.output.slice(0, 600),
    costUsd: result.costUsd,
    durationMs: result.durationMs,
    error: result.error,
    toolCallCount: result.artifacts?.toolCallCount ?? 0,
    toolCalls: result.artifacts?.toolCalls.map(tool => ({ ...tool })) ?? [],
    verificationSummary: result.artifacts?.verificationSummary,
    tddStatus: result.artifacts?.tddStatus,
    tddSummary: result.artifacts?.tddSummary,
    checkpointedTools: [...(result.artifacts?.checkpointedTools ?? [])],
    changedFiles: changedFiles.map(file => ({ ...file })),
    diffPreview,
  };
}

function upsertArtifact(artifacts: ProjectRunSubTaskArtifact[], nextArtifact: ProjectRunSubTaskArtifact): ProjectRunSubTaskArtifact[] {
  const remaining = artifacts.filter(artifact => artifact.subTaskId !== nextArtifact.subTaskId);
  return [...remaining, nextArtifact].sort((left, right) => left.subTaskId.localeCompare(right.subTaskId));
}

function mergeArtifacts(
  existingArtifacts: ProjectRunSubTaskArtifact[],
  nextArtifacts: ProjectRunSubTaskArtifact[],
): ProjectRunSubTaskArtifact[] {
  const merged = new Map<string, ProjectRunSubTaskArtifact>();
  for (const artifact of existingArtifacts) {
    merged.set(artifact.subTaskId, cloneArtifact(artifact));
  }
  for (const artifact of nextArtifacts) {
    const previous = merged.get(artifact.subTaskId);
    merged.set(artifact.subTaskId, {
      ...(previous ?? cloneArtifact(artifact)),
      ...cloneArtifact(artifact),
      changedFiles: artifact.changedFiles.length > 0 ? artifact.changedFiles.map(file => ({ ...file })) : previous?.changedFiles.map(file => ({ ...file })) ?? [],
      diffPreview: artifact.diffPreview ?? previous?.diffPreview,
    });
  }
  return [...merged.values()].sort((left, right) => left.subTaskId.localeCompare(right.subTaskId));
}

function cloneArtifact(artifact: ProjectRunSubTaskArtifact): ProjectRunSubTaskArtifact {
  return {
    ...artifact,
    dependsOn: [...artifact.dependsOn],
    toolCalls: artifact.toolCalls.map(tool => ({ ...tool })),
    checkpointedTools: [...artifact.checkpointedTools],
    changedFiles: artifact.changedFiles.map(file => ({ ...file })),
  };
}

function artifactToResult(artifact: ProjectRunSubTaskArtifact): SubTaskResult {
  return {
    subTaskId: artifact.subTaskId,
    title: artifact.title,
    status: artifact.status,
    output: artifact.output,
    costUsd: artifact.costUsd,
    durationMs: artifact.durationMs,
    error: artifact.error,
    role: artifact.role,
    dependsOn: [...artifact.dependsOn],
    artifacts: {
      output: artifact.output,
      outputPreview: artifact.outputPreview,
      toolCallCount: artifact.toolCallCount,
      toolCalls: artifact.toolCalls.map(tool => ({ ...tool })),
      verificationSummary: artifact.verificationSummary,
      tddStatus: artifact.tddStatus,
      tddSummary: artifact.tddSummary,
      checkpointedTools: [...artifact.checkpointedTools],
      changedFiles: artifact.changedFiles.map(file => ({ ...file })),
      diffPreview: artifact.diffPreview,
    },
  };
}

function toBudgetMode(value: string | undefined): 'cheap' | 'balanced' | 'expensive' | 'auto' {
  if (value === 'cheap' || value === 'balanced' || value === 'expensive' || value === 'auto') {
    return value;
  }
  return 'balanced';
}

function toSpeedMode(value: string | undefined): 'fast' | 'balanced' | 'considered' | 'auto' {
  if (value === 'fast' || value === 'balanced' || value === 'considered' || value === 'auto') {
    return value;
  }
  return 'balanced';
}

function normalizePathForComparison(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}