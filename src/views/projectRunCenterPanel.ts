import * as vscode from 'vscode';
import * as path from 'path';
import type { AtlasMindContext } from '../extension.js';
import { Planner, parsePlannerResponse, removeCycles, splitPlanIntoExecutionJobs } from '../core/planner.js';
import { TaskProfiler } from '../core/taskProfiler.js';
import type {
  ChangedWorkspaceFile,
  ProjectPlan,
  ProjectProgressUpdate,
  ProjectRunExecutionOptions,
  ProjectRunIdeationOrigin,
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
import type { SessionThoughtSummary, SessionTimelineNote, SessionTranscriptMetadata } from '../chat/sessionConversation.js';
import { deriveProjectRunTitle } from '../chat/sessionConversation.js';
import { getWebviewHtmlShell } from './webviewUtils.js';

interface ProjectRunDiscussionPayload {
  goal: string;
  planDraft: string;
}

export interface ProjectRunCenterOpenTarget {
  runId?: string;
  goal?: string;
  ideationOrigin?: ProjectRunIdeationOrigin;
  autoPreview?: boolean;
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
  | { type: 'setRequireBatchApproval'; payload: boolean }
  | { type: 'setAutonomousMode'; payload: boolean }
  | { type: 'setMirrorProgressToChat'; payload: boolean }
  | { type: 'setInjectOutputIntoFollowUp'; payload: boolean }
  | { type: 'openRunChat'; payload: string }
  | { type: 'feedbackToOriginIdeation'; payload: string }
  | { type: 'createIdeationFromRun'; payload: string };

interface ProjectRunPreviewState {
  runId: string;
  goal: string;
  estimatedFiles: number;
  requiresApproval: boolean;
  approvalThreshold: number;
  executionOptions: ProjectRunExecutionOptions;
  ideationOrigin?: ProjectRunIdeationOrigin;
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
  private executionOptions: ProjectRunExecutionOptions = createDefaultExecutionOptions();
  private pauseBeforeNextBatch = false;
  private approvalResolver: (() => void) | undefined;
  private resumeResolver: (() => void) | undefined;

  public static createOrShow(
    context: vscode.ExtensionContext,
    atlas: AtlasMindContext,
    target?: string | ProjectRunCenterOpenTarget,
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    const openTarget = typeof target === 'string' ? { runId: target } : target;

    if (ProjectRunCenterPanel.currentPanel) {
      void ProjectRunCenterPanel.currentPanel.applyOpenTarget(openTarget);
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

    ProjectRunCenterPanel.currentPanel = new ProjectRunCenterPanel(panel, atlas, openTarget);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly atlas: AtlasMindContext,
    target?: ProjectRunCenterOpenTarget,
  ) {
    this.panel = panel;
    this.selectedRunId = target?.runId;
    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(message => {
      void this.handleMessage(message);
    }, null, this.disposables);

    this.atlas.projectRunsRefresh.event(() => {
      void this.syncState();
    }, null, this.disposables);

    void this.applyOpenTarget(target);
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
      case 'openRunChat':
        await this.openRunChat(message.payload);
        return;
      case 'feedbackToOriginIdeation':
        await this.sendRunFeedbackToIdeation(message.payload, 'origin');
        return;
      case 'createIdeationFromRun':
        await this.sendRunFeedbackToIdeation(message.payload, 'new-thread');
        return;
      case 'setRequireBatchApproval':
        await this.updateExecutionOptions(current => ({
          ...current,
          requireBatchApproval: message.payload,
          autonomousMode: message.payload ? false : current.autonomousMode,
        }), message.payload ? 'Batch approval enabled.' : 'Batch approval disabled.');
        return;
      case 'setAutonomousMode':
        await this.updateExecutionOptions(current => ({
          ...current,
          autonomousMode: message.payload,
          requireBatchApproval: message.payload ? false : current.requireBatchApproval,
        }), message.payload ? 'Autonomous mode enabled.' : 'Autonomous mode disabled.');
        return;
      case 'setMirrorProgressToChat':
        await this.updateExecutionOptions(current => ({
          ...current,
          mirrorProgressToChat: message.payload,
        }), message.payload ? 'Run updates will mirror into a dedicated chat session.' : 'Run updates will stay in the Run Center only.');
        return;
      case 'setInjectOutputIntoFollowUp':
        await this.updateExecutionOptions(current => ({
          ...current,
          injectOutputIntoFollowUp: message.payload,
        }), message.payload ? 'Completed run output will be carried into queued follow-up runs.' : 'Queued follow-up runs will not inherit the completed run synthesis.');
        return;
    }
  }

  private async applyOpenTarget(target?: ProjectRunCenterOpenTarget): Promise<void> {
    if (!target) {
      await this.syncState();
      return;
    }

    if (typeof target.runId === 'string' && target.runId.trim().length > 0) {
      this.selectedRunId = target.runId.trim();
    }

    if (typeof target.goal === 'string' && target.goal.trim().length > 0 && target.autoPreview !== false) {
      await this.previewGoal(target.goal, target.ideationOrigin);
      return;
    }

    await this.syncState();
  }

  private async updateExecutionOptions(
    mutate: (current: ProjectRunExecutionOptions) => ProjectRunExecutionOptions,
    statusMessage: string,
  ): Promise<void> {
    const next = normalizeExecutionOptions(mutate(this.executionOptions));
    this.executionOptions = next;

    if (this.previewState) {
      this.previewState = {
        ...this.previewState,
        executionOptions: next,
      };

      const previewRun = await this.atlas.projectRunHistory.getRunAsync(this.previewState.runId);
      if (previewRun && previewRun.status === 'previewed') {
        await this.atlas.projectRunHistory.upsertRun({
          ...previewRun,
          executionOptions: next,
          requireBatchApproval: next.requireBatchApproval,
          updatedAt: new Date().toISOString(),
        });
        this.atlas.projectRunsRefresh.fire();
      }
    }

    this.liveStatus = statusMessage;
    await this.syncState();
  }

  private async openRunChat(runId: string): Promise<void> {
    const run = await this.atlas.projectRunHistory.getRunAsync(runId);
    if (!run?.chatSessionId) {
      this.liveStatus = 'This run does not have a dedicated chat session yet.';
      await this.syncState();
      return;
    }

    await vscode.commands.executeCommand('atlasmind.openChatPanel', {
      sessionId: run.chatSessionId,
      messageId: run.chatMessageId,
      sendMode: 'send',
    });
    this.liveStatus = 'Opened the dedicated run chat session.';
    await this.syncState();
  }

  private async ensureRunChatContext(run: ProjectRunRecord): Promise<ProjectRunRecord> {
    if (!run.executionOptions.mirrorProgressToChat) {
      return run;
    }

    let sessionId = run.chatSessionId;
    if (!sessionId || !this.atlas.sessionConversation.getSession(sessionId)) {
      sessionId = this.atlas.sessionConversation.createSession(`Run: ${deriveProjectRunTitle(run.goal)}`);
      this.atlas.sessionConversation.appendMessage('user', buildRunChatPrompt(run), sessionId);
    }

    const metadata = buildRunTranscriptMetadata(run);
    let messageId = run.chatMessageId;
    if (!messageId) {
      messageId = this.atlas.sessionConversation.appendMessage(
        'assistant',
        buildRunChatMirrorMarkdown(run),
        sessionId,
        metadata,
      );
    } else {
      this.atlas.sessionConversation.updateMessage(
        messageId,
        buildRunChatMirrorMarkdown(run),
        sessionId,
        metadata,
      );
    }

    return {
      ...run,
      chatSessionId: sessionId,
      chatMessageId: messageId,
    };
  }

  private async syncRunChatMirror(run: ProjectRunRecord): Promise<void> {
    if (!run.executionOptions.mirrorProgressToChat || !run.chatSessionId || !run.chatMessageId) {
      return;
    }

    this.atlas.sessionConversation.updateMessage(
      run.chatMessageId,
      buildRunChatMirrorMarkdown(run),
      run.chatSessionId,
      buildRunTranscriptMetadata(run),
    );
  }

  private async previewGoal(rawGoal: string, ideationOrigin?: ProjectRunIdeationOrigin): Promise<void> {
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
      executionOptions: this.executionOptions,
      ...(ideationOrigin ? { ideationOrigin } : {}),
      plan,
      planDraft: JSON.stringify({ subTasks: plan.subTasks }, null, 2),
      ...buildExecutionSplitPreview(plan, projectUiConfig),
    };
    this.selectedRunId = runId;
    this.liveStatus = ideationOrigin
      ? 'Preview generated from ideation. Review the plan before executing.'
      : 'Preview generated. Review the plan before executing.';

    await this.atlas.projectRunHistory.upsertRun({
      id: runId,
      title: deriveProjectRunTitle(goal),
      goal,
      plannerRootRunId: runId,
      plannerJobIndex: 1,
      plannerJobCount: this.previewState.executionJobCount,
      plannerSeedResults: [],
      ...(ideationOrigin ? { ideationOrigin } : {}),
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
      executionOptions: this.executionOptions,
      requireBatchApproval: this.executionOptions.requireBatchApproval,
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
      executionOptions: this.executionOptions,
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
        executionOptions: this.executionOptions,
        requireBatchApproval: this.executionOptions.requireBatchApproval,
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

    const sessionId = this.atlas.sessionConversation.createSession(`Draft: ${deriveProjectRunTitle(goal || this.previewState?.goal || 'Project Run')}`);

    await vscode.commands.executeCommand('atlasmind.openChatPanel', {
      sessionId,
      draftPrompt: buildDraftDiscussionPrompt(goal, planDraft, this.previewState),
      sendMode: 'send',
    });
    this.liveStatus = 'Opened a dedicated chat session for refining the draft.';
    await this.syncState();
  }

  private async sendRunFeedbackToIdeation(runId: string, feedbackMode: 'origin' | 'new-thread'): Promise<void> {
    const run = await this.atlas.projectRunHistory.getRunAsync(runId);
    if (!run) {
      this.liveStatus = 'That run is no longer available.';
      await this.syncState();
      return;
    }

    if (feedbackMode === 'origin' && !run.ideationOrigin) {
      this.liveStatus = 'This run was not launched from ideation, so there is no originating ideation thread to update.';
      await this.syncState();
      return;
    }

    if (run.status !== 'completed' && run.status !== 'failed') {
      this.liveStatus = 'Wait for the run to finish before sending its learnings back into ideation.';
      await this.syncState();
      return;
    }

    await vscode.commands.executeCommand('atlasmind.openProjectIdeation', {
      importRunId: run.id,
      feedbackMode,
    });
    this.liveStatus = feedbackMode === 'origin'
      ? 'Opened the originating ideation thread with this run ready to feed back into it.'
      : 'Opened ideation to start a new feedback thread from the selected run.';
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
    const executionOptions = normalizeExecutionOptions(sourceRun.executionOptions ?? this.executionOptions);

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
      carryForwardSummary: sourceRun.carryForwardSummary,
      executionOptions,
      requireBatchApproval: executionOptions.requireBatchApproval,
      paused: false,
      awaitingBatchApproval: false,
      logs: [
        ...sourceRun.logs,
        {
          timestamp: runStartedAt,
          level: 'info' as const,
          message: options.resumeFailedOnly ? 'Retrying failed subtasks only.' : 'Execution started from the reviewed plan.',
        },
        ...(sourceRun.carryForwardSummary
          ? [{
            timestamp: runStartedAt,
            level: 'info' as const,
            message: 'Loaded carry-forward synthesis from the previous planner job into the run context.',
          }]
          : []),
      ].slice(-40),
    };
    this.executionOptions = executionOptions;
    mutableRun = await this.ensureRunChatContext(mutableRun);
    await this.atlas.projectRunHistory.upsertRun(mutableRun);
    this.atlas.projectRunsRefresh.fire();

    const updateRun = async (mutate: (current: ProjectRunRecord) => ProjectRunRecord): Promise<void> => {
      mutableRun = mutate(mutableRun);
      mutableRun.updatedAt = new Date().toISOString();
      await this.atlas.projectRunHistory.upsertRun(mutableRun);
      await this.syncRunChatMirror(mutableRun);
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

      if (mutableRun.executionOptions.requireBatchApproval) {
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
          carryForwardSummary: mutableRun.executionOptions.injectOutputIntoFollowUp ? summary.synthesis : undefined,
          executionOptions: mutableRun.executionOptions,
          requireBatchApproval: mutableRun.executionOptions.requireBatchApproval,
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
      this.selectedRunId = mutableRun.id;
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

    if (previewState?.executionOptions) {
      this.executionOptions = previewState.executionOptions;
    } else if (selectedRun?.executionOptions) {
      this.executionOptions = normalizeExecutionOptions(selectedRun.executionOptions);
    }

    this.selectedRunId = selectedRun?.id;

    await this.panel.webview.postMessage({
      type: 'state',
      payload: {
        liveStatus: this.liveStatus,
        executionOptions: this.executionOptions,
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

          <div id="workflowStepper" class="workflow-stepper" aria-label="Current workflow phase">
            <div class="step-item" data-step="draft">
              <div class="step-dot"></div>
              <span class="step-label">Draft goal</span>
            </div>
            <div class="step-connector"></div>
            <div class="step-item" data-step="preview">
              <div class="step-dot"></div>
              <span class="step-label">Preview plan</span>
            </div>
            <div class="step-connector"></div>
            <div class="step-item" data-step="execute">
              <div class="step-dot"></div>
              <span class="step-label">Execute</span>
            </div>
            <div class="step-connector"></div>
            <div class="step-item" data-step="review">
              <div class="step-dot"></div>
              <span class="step-label">Review results</span>
            </div>
          </div>

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
                <span class="btn-tip" id="tip-previewGoal"><button id="previewGoal" class="dashboard-button dashboard-button-solid" type="button">Preview Plan</button></span>
                <span class="btn-tip" id="tip-applyPlanEdits"><button id="applyPlanEdits" class="dashboard-button dashboard-button-ghost" type="button">Apply Plan Edits</button></span>
                <span class="btn-tip" id="tip-discussDraft"><button id="discussDraft" class="dashboard-button dashboard-button-ghost" type="button">Discuss Draft</button></span>
                <span class="btn-tip" id="tip-executePreview"><button id="executePreview" class="dashboard-button dashboard-button-ghost" type="button">Execute Reviewed Plan</button></span>
              </div>

              <div class="option-grid">
                <label class="checkbox-card checkbox-inline" title="Let Atlas continue without waiting for manual checkpoints.">
                  <input id="autonomousMode" type="checkbox" />
                  <span>
                    <strong>Autonomous walk-away mode</strong>
                    <span class="muted-line">Run the reviewed draft end-to-end unless you manually pause it.</span>
                  </span>
                </label>
                <label class="checkbox-card checkbox-inline" title="Pause at each execution batch so you can inspect the run before it continues.">
                  <input id="requireBatchApproval" type="checkbox" />
                  <span>
                    <strong>Require approval before each batch</strong>
                    <span class="muted-line">Enable operator checkpoints at each scheduled batch boundary.</span>
                  </span>
                </label>
                <label class="checkbox-card checkbox-inline" title="Write the live run log and final synthesis into a dedicated chat session.">
                  <input id="mirrorProgressToChat" type="checkbox" />
                  <span>
                    <strong>Mirror live run log into chat</strong>
                    <span class="muted-line">Keep the run's internal monologue and final output in a dedicated thread.</span>
                  </span>
                </label>
                <label class="checkbox-card checkbox-inline" title="Carry the completed synthesis into the next queued planner job when a large run stages follow-up work.">
                  <input id="injectOutputIntoFollowUp" type="checkbox" />
                  <span>
                    <strong>Carry output into follow-up runs</strong>
                    <span class="muted-line">Preserve the previous synthesis for staged continuation jobs.</span>
                  </span>
                </label>
              </div>

              <div id="previewMeta" class="preview-meta-grid"></div>

              <details class="collapsible-shell" open>
                <summary>
                  <span>
                    <p class="section-kicker">Editable draft</p>
                    <h3>Plan JSON</h3>
                  </span>
                  <span class="meta-pill">Validated before execution</span>
                </summary>
                <div class="editor-shell editor-shell-flat">
                  <textarea id="planDraftInput" rows="14" placeholder="Preview the project plan, then edit the JSON here before execution."></textarea>
                </div>
              </details>

              <details class="collapsible-shell">
                <summary>
                  <span>
                    <p class="section-kicker">Planner DAG</p>
                    <h3>Subtasks</h3>
                  </span>
                </summary>
                <div class="table-shell table-shell-flat">
                  <div class="table-wrap">
                    <table>
                      <thead>
                        <tr><th>ID</th><th>Title</th><th>Role</th><th>Depends On</th></tr>
                      </thead>
                      <tbody id="previewRows"></tbody>
                    </table>
                  </div>
                </div>
              </details>
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
              <div class="progress-shell" aria-label="Run progress">
                <div id="liveProgressBar" class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></div>
              </div>

              <div class="tracker-section">
                <div class="editor-header compact-header">
                  <div>
                    <p class="section-kicker">Live execution</p>
                    <h3>Subtask progress</h3>
                  </div>
                  <span id="subtaskTrackerSummary" class="meta-pill"></span>
                </div>
                <div id="subtaskTracker" class="subtask-tracker-shell"></div>
              </div>

              <div class="button-stack">
                <span class="btn-tip" id="tip-approveNextBatch"><button id="approveNextBatch" class="dashboard-button dashboard-button-solid" type="button">Approve Next Batch</button></span>
                <span class="btn-tip" id="tip-pauseRun"><button id="pauseRun" class="dashboard-button dashboard-button-ghost" type="button">Pause Before Next Batch</button></span>
                <span class="btn-tip" id="tip-resumeRun"><button id="resumeRun" class="dashboard-button dashboard-button-ghost" type="button">Resume</button></span>
                <span class="btn-tip" id="tip-openScm"><button id="openScm" class="dashboard-button dashboard-button-ghost" type="button">Open Source Control</button></span>
                <span class="btn-tip" id="tip-rollbackCheckpoint"><button id="rollbackCheckpoint" class="dashboard-button dashboard-button-danger" type="button">Rollback Last Checkpoint</button></span>
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
              <div class="search-shell">
                <input id="runSearch" type="search" placeholder="Search recent runs by goal, status, or output..." />
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
              <section class="detail-section detail-section-output">
                <div class="editor-header compact-header">
                  <div>
                    <p class="section-kicker">Primary result</p>
                    <h3>Final output</h3>
                  </div>
                </div>
                <div id="selectedRunOutput"></div>
              </section>
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

        input[type='search'] {
          width: 100%;
          border-radius: 14px;
          border: 1px solid var(--run-border);
          color: var(--vscode-input-foreground);
          background: color-mix(in srgb, var(--vscode-input-background) 92%, transparent);
          padding: 10px 12px;
          box-sizing: border-box;
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
        .posture-grid,
        .option-grid {
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

        .option-grid {
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
        .button-stack,
        .search-shell {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .collapsible-shell {
          border-radius: 20px;
          border: 1px solid var(--run-border);
          background: color-mix(in srgb, var(--run-panel) 92%, transparent);
          padding: 0 18px 18px;
        }

        .collapsible-shell summary {
          list-style: none;
          display: flex;
          justify-content: space-between;
          align-items: center;
          cursor: pointer;
          padding: 18px 0 12px;
        }

        .collapsible-shell summary::-webkit-details-marker {
          display: none;
        }

        .editor-shell-flat,
        .table-shell-flat {
          padding: 0;
          border: 0;
          background: transparent;
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

        .progress-shell {
          height: 10px;
          border-radius: 999px;
          overflow: hidden;
          background: color-mix(in srgb, var(--run-panel-strong) 84%, black 16%);
          border: 1px solid var(--run-border);
        }

        .progress-bar {
          width: 0;
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(90deg, color-mix(in srgb, var(--run-accent) 86%, white 14%), color-mix(in srgb, var(--run-good) 84%, white 16%));
          transition: width 180ms ease;
        }

        .status-banner[data-active='true'] + .progress-shell .progress-bar {
          animation: progressGlow 1.2s linear infinite;
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

        .run-row {
          padding: 14px 16px;
        }

        .run-row-header h3 {
          font-size: 16px;
        }

        .run-row-copy {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .run-row-meta {
          grid-template-columns: repeat(4, minmax(0, 1fr));
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

        .detail-section-output {
          margin-bottom: 14px;
        }

        .result-output-shell {
          border-radius: 18px;
          border: 1px solid color-mix(in srgb, var(--run-accent) 35%, var(--run-border));
          background: linear-gradient(180deg, color-mix(in srgb, var(--run-accent) 8%, var(--run-panel-strong)), color-mix(in srgb, var(--run-panel) 96%, transparent));
          padding: 16px;
        }

        .result-output {
          white-space: pre-wrap;
          word-break: break-word;
          line-height: 1.6;
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
          .artifact-meta,
          .option-grid {
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

        @keyframes progressGlow {
          0% { filter: saturate(1); }
          50% { filter: saturate(1.25) brightness(1.1); }
          100% { filter: saturate(1); }
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        /* ── Workflow stepper ── */
        .workflow-stepper {
          display: flex;
          align-items: center;
          padding: 14px 22px;
          background: linear-gradient(180deg, color-mix(in srgb, var(--run-panel-strong) 92%, white 8%), var(--run-panel));
          border: 1px solid var(--run-border);
          border-radius: var(--run-radius);
          box-shadow: var(--run-shadow);
        }

        .step-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
        }

        .step-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: color-mix(in srgb, var(--run-muted) 50%, transparent);
          border: 2px solid var(--run-border);
          transition: background 220ms ease, box-shadow 220ms ease;
        }

        .step-label {
          font-size: 11px;
          color: var(--run-muted);
          letter-spacing: 0.1em;
          text-transform: uppercase;
          white-space: nowrap;
          transition: color 220ms ease, font-weight 220ms ease;
        }

        .step-connector {
          flex: 1;
          height: 2px;
          min-width: 20px;
          background: var(--run-border);
          margin: 0 10px;
          margin-bottom: 20px;
        }

        .step-item.is-active .step-dot {
          background: var(--run-accent);
          border-color: color-mix(in srgb, var(--run-accent) 70%, white);
          box-shadow: 0 0 0 4px color-mix(in srgb, var(--run-accent) 20%, transparent);
        }

        .step-item.is-active .step-label {
          color: color-mix(in srgb, var(--run-accent) 90%, white 10%);
          font-weight: 700;
        }

        .step-item.is-done .step-dot {
          background: var(--run-good);
          border-color: var(--run-good);
        }

        .step-item.is-done .step-label {
          color: var(--run-good);
        }

        /* ── Subtask tracker ── */
        .tracker-section {
          padding: 16px;
          border-radius: 18px;
          border: 1px solid var(--run-border);
          background: color-mix(in srgb, var(--run-panel) 88%, transparent);
        }

        .subtask-tracker-shell {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .subtask-tracker-empty {
          color: var(--run-muted);
          font-size: 13px;
          padding: 4px 0;
        }

        .subtask-track-row {
          display: grid;
          grid-template-columns: 22px 1fr auto;
          gap: 10px;
          align-items: center;
          padding: 8px 12px;
          border-radius: 11px;
          border: 1px solid color-mix(in srgb, var(--run-border) 65%, transparent);
          background: color-mix(in srgb, var(--run-panel) 55%, transparent);
          font-size: 13px;
          transition: border-color 200ms ease, background 200ms ease;
        }

        .subtask-track-row.is-running {
          border-color: color-mix(in srgb, var(--run-accent) 55%, transparent);
          background: color-mix(in srgb, var(--run-accent) 9%, var(--run-panel));
        }

        .subtask-track-row.is-completed {
          border-color: color-mix(in srgb, var(--run-good) 38%, transparent);
        }

        .subtask-track-row.is-failed {
          border-color: color-mix(in srgb, var(--run-critical) 38%, transparent);
        }

        .subtask-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          flex-shrink: 0;
        }

        .subtask-spinner {
          width: 14px;
          height: 14px;
          border: 2px solid color-mix(in srgb, var(--run-accent) 22%, transparent);
          border-top-color: var(--run-accent);
          border-radius: 50%;
          animation: spin 0.75s linear infinite;
          flex-shrink: 0;
        }

        .subtask-tick {
          font-size: 14px;
          font-weight: 700;
          color: var(--run-good);
          line-height: 1;
        }

        .subtask-cross {
          font-size: 14px;
          font-weight: 700;
          color: var(--run-critical);
          line-height: 1;
        }

        .subtask-pending-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          border: 2px solid color-mix(in srgb, var(--run-muted) 55%, transparent);
        }

        .subtask-track-title {
          font-weight: 500;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          line-height: 1.3;
        }

        .subtask-track-meta {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 3px;
          flex-shrink: 0;
        }

        .subtask-track-role {
          font-size: 11px;
          color: var(--run-muted);
          letter-spacing: 0.08em;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .subtask-retry-hint {
          font-size: 11px;
          color: color-mix(in srgb, var(--run-warn) 88%, white 12%);
          white-space: nowrap;
        }

        /* ── Run card status icons ── */
        .run-card-header-inner {
          display: flex;
          align-items: flex-start;
          gap: 10px;
        }

        .run-status-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          flex-shrink: 0;
          margin-top: 2px;
        }

        .run-card-spinner {
          width: 14px;
          height: 14px;
          border: 2px solid color-mix(in srgb, var(--run-accent) 22%, transparent);
          border-top-color: var(--run-accent);
          border-radius: 50%;
          animation: spin 0.75s linear infinite;
        }

        .run-card-tick {
          font-size: 15px;
          font-weight: 700;
          color: var(--run-good);
          line-height: 1;
        }

        .run-card-cross {
          font-size: 15px;
          font-weight: 700;
          color: var(--run-critical);
          line-height: 1;
        }

        .run-card-draft-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          border: 2px solid color-mix(in srgb, var(--run-accent) 55%, transparent);
          background: color-mix(in srgb, var(--run-accent) 18%, transparent);
        }

        /* ── Button states: disabled, loading, tooltip ── */

        .dashboard-button:disabled:not(.is-loading) {
          opacity: 0.38;
          cursor: not-allowed;
        }

        /* Loading spinner overlay — hides text, shows spinner */
        .dashboard-button.is-loading {
          position: relative;
          pointer-events: none;
        }

        .dashboard-button.is-loading > * {
          visibility: hidden;
        }

        /* Make the text invisible but keep layout */
        .dashboard-button.is-loading {
          color: transparent !important;
        }

        .dashboard-button.is-loading::after {
          content: '';
          position: absolute;
          inset: 0;
          margin: auto;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          animation: spin 0.75s linear infinite;
        }

        .dashboard-button-solid.is-loading::after {
          border: 2px solid rgba(255,255,255,0.28);
          border-top-color: rgba(255,255,255,0.92);
        }

        .dashboard-button-ghost.is-loading::after,
        .dashboard-button-danger.is-loading::after {
          border: 2px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
          border-top-color: var(--vscode-foreground);
        }

        /* btn-tip wrapper: tooltip shown on hover when data-tip is set */
        .btn-tip {
          position: relative;
          display: inline-flex;
        }

        /* Prevent the wrapper from intercepting pointer events while button is enabled */
        .btn-tip button:not(:disabled) {
          pointer-events: auto;
        }

        /* Disabled buttons must pass pointer-events to wrapper so tooltip can show */
        .btn-tip button:disabled {
          pointer-events: none;
        }

        .btn-tip[data-tip]:hover::after {
          content: attr(data-tip);
          position: absolute;
          bottom: calc(100% + 8px);
          left: 50%;
          transform: translateX(-50%);
          width: max-content;
          max-width: 240px;
          white-space: normal;
          text-align: center;
          background: var(--vscode-editorHoverWidget-background, var(--run-panel-strong));
          color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground));
          border: 1px solid var(--vscode-editorHoverWidget-border, var(--run-border));
          border-radius: 8px;
          padding: 7px 11px;
          font-size: 12px;
          line-height: 1.45;
          z-index: 200;
          pointer-events: none;
          box-shadow: 0 4px 14px rgba(0,0,0,0.22);
        }

        /* Keep button-stack / button-row flex children behaving correctly */
        .button-row .btn-tip,
        .button-stack .btn-tip {
          flex-shrink: 0;
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

  if (
    (message.type === 'setRequireBatchApproval'
      || message.type === 'setAutonomousMode'
      || message.type === 'setMirrorProgressToChat'
      || message.type === 'setInjectOutputIntoFollowUp')
    && typeof message.payload === 'boolean'
  ) {
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
    || message.type === 'openRunChat'
    || message.type === 'feedbackToOriginIdeation'
    || message.type === 'createIdeationFromRun'
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
    executionOptions: preview.executionOptions,
    ideationOrigin: preview.ideationOrigin,
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
    executionOptions: run.executionOptions,
    requireBatchApproval: run.requireBatchApproval,
    paused: run.paused,
    awaitingBatchApproval: run.awaitingBatchApproval,
    plannerJobIndex: run.plannerJobIndex,
    plannerJobCount: run.plannerJobCount,
    failedSubtaskTitles: run.failedSubtaskTitles,
    reportPath: run.reportPath,
    chatSessionId: run.chatSessionId,
    chatMessageId: run.chatMessageId,
    carryForwardSummary: run.carryForwardSummary,
    ideationOrigin: run.ideationOrigin,
    logs: run.logs,
    subTaskArtifacts: run.subTaskArtifacts,
    changedFiles: (run.summary?.changedFiles ?? []).map(file => ({
      relativePath: file.relativePath,
      status: file.status,
      sourceTitles: run.summary?.fileAttribution[file.relativePath] ?? [],
    })),
    synthesis: run.summary?.synthesis ?? '',
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
  const autonomousMode = document.getElementById('autonomousMode');
  const mirrorProgressToChat = document.getElementById('mirrorProgressToChat');
  const injectOutputIntoFollowUp = document.getElementById('injectOutputIntoFollowUp');
  const liveStatus = document.getElementById('liveStatus');
  const liveProgressBar = document.getElementById('liveProgressBar');
  const previewMeta = document.getElementById('previewMeta');
  const previewRows = document.getElementById('previewRows');
  const planDraftInput = document.getElementById('planDraftInput');
  const liveLog = document.getElementById('liveLog');
  const runsList = document.getElementById('runsList');
  const runSearch = document.getElementById('runSearch');
  const selectedRun = document.getElementById('selectedRun');
  const selectedRunActions = document.getElementById('selectedRunActions');
  const selectedRunOutput = document.getElementById('selectedRunOutput');
  const selectedRunFiles = document.getElementById('selectedRunFiles');
  const artifactList = document.getElementById('artifactList');
  const heroLiveStatus = document.getElementById('heroLiveStatus');
  const heroApprovalMode = document.getElementById('heroApprovalMode');
  const heroRunCount = document.getElementById('heroRunCount');
  const metricSelectedStatus = document.getElementById('metricSelectedStatus');
  const metricSelectedProgress = document.getElementById('metricSelectedProgress');
  const metricSelectedImpact = document.getElementById('metricSelectedImpact');
  const metricPreviewStatus = document.getElementById('metricPreviewStatus');
  const workflowStepper = document.getElementById('workflowStepper');
  const subtaskTracker = document.getElementById('subtaskTracker');
  const subtaskTrackerSummary = document.getElementById('subtaskTrackerSummary');
  const clientState = { payload: { runs: [], selectedRun: null, preview: null, executionOptions: {} }, search: '' };

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

  /**
   * Set a static panel button's disabled state and tooltip reason.
   * Also clears any in-flight loading state so a fresh state push always wins.
   */
  function setBtn(id, disabled, tip) {
    const btn = document.getElementById(id);
    if (!(btn instanceof HTMLButtonElement)) { return; }
    btn.classList.remove('is-loading');
    btn.disabled = Boolean(disabled);
    const wrap = document.getElementById('tip-' + id);
    if (wrap) {
      if (disabled && tip) {
        wrap.setAttribute('data-tip', tip);
      } else {
        wrap.removeAttribute('data-tip');
      }
    }
  }

  /** Immediately put a button into a loading/in-progress visual state. */
  function setButtonLoading(id) {
    const btn = document.getElementById(id);
    if (!(btn instanceof HTMLButtonElement)) { return; }
    btn.classList.add('is-loading');
    btn.disabled = true;
    const wrap = document.getElementById('tip-' + id);
    if (wrap) { wrap.removeAttribute('data-tip'); }
  }

  function getRunCardIcon(status) {
    switch (String(status || '').toLowerCase()) {
      case 'running':
        return '<div class="run-status-icon"><div class="run-card-spinner"></div><' + '/div>';
      case 'completed':
        return '<div class="run-status-icon"><span class="run-card-tick">✓<' + '/span><' + '/div>';
      case 'failed':
        return '<div class="run-status-icon"><span class="run-card-cross">✗<' + '/span><' + '/div>';
      case 'previewed':
        return '<div class="run-status-icon"><div class="run-card-draft-dot"><' + '/div><' + '/div>';
      default:
        return '<div class="run-status-icon"><' + '/div>';
    }
  }

  function renderSubtaskTracker(preview, run, liveMessage) {
    if (!subtaskTracker || !subtaskTrackerSummary) {
      return;
    }
    if (!preview || !preview.plan || !Array.isArray(preview.plan.subTasks) || preview.plan.subTasks.length === 0) {
      subtaskTrackerSummary.textContent = '';
      subtaskTracker.innerHTML = '<p class="subtask-tracker-empty">Preview a goal to see planned subtasks here.<' + '/p>';
      return;
    }

    const tasks = preview.plan.subTasks;
    const artifacts = run && Array.isArray(run.subTaskArtifacts) ? run.subTaskArtifacts : [];
    const isRunning = run && run.status === 'running';

    // Derive the currently-running subtask title from liveStatus ("Running <title>")
    const runningTitle = isRunning && typeof liveMessage === 'string' && liveMessage.startsWith('Running ')
      ? liveMessage.slice('Running '.length).trim()
      : '';

    let doneCount = 0;
    let failedCount = 0;
    let runningCount = 0;

    const rows = tasks.map(task => {
      const artifact = artifacts.find(a => a.title === task.title);
      let state = 'pending';
      if (artifact) {
        state = artifact.status === 'failed' ? 'failed' : 'completed';
      } else if (runningTitle && task.title === runningTitle) {
        state = 'running';
      }

      if (state === 'completed') { doneCount++; }
      else if (state === 'failed') { failedCount++; }
      else if (state === 'running') { runningCount++; }

      let iconHtml;
      if (state === 'running') {
        iconHtml = '<div class="subtask-icon"><div class="subtask-spinner"><' + '/div><' + '/div>';
      } else if (state === 'completed') {
        iconHtml = '<div class="subtask-icon"><span class="subtask-tick">✓<' + '/span><' + '/div>';
      } else if (state === 'failed') {
        iconHtml = '<div class="subtask-icon"><span class="subtask-cross">✗<' + '/span><' + '/div>';
      } else {
        iconHtml = '<div class="subtask-icon"><div class="subtask-pending-dot"><' + '/div><' + '/div>';
      }

      const retryHint = state === 'failed'
        ? '<span class="subtask-retry-hint">requires retry<' + '/span>'
        : '';

      return '<div class="subtask-track-row is-' + state + '">' +
        iconHtml +
        '<span class="subtask-track-title">' + escapeHtml(task.title) + '<' + '/span>' +
        '<div class="subtask-track-meta">' +
          '<span class="subtask-track-role">' + escapeHtml(task.role || '') + '<' + '/span>' +
          retryHint +
        '<' + '/div>' +
      '<' + '/div>';
    });

    subtaskTracker.innerHTML = rows.join('');

    // Update summary pill
    const parts = [];
    if (doneCount > 0) { parts.push(doneCount + ' done'); }
    if (runningCount > 0) { parts.push(runningCount + ' running'); }
    if (failedCount > 0) { parts.push(failedCount + ' failed'); }
    const pending = tasks.length - doneCount - failedCount - runningCount;
    if (pending > 0) { parts.push(pending + ' pending'); }
    subtaskTrackerSummary.textContent = parts.length > 0 ? parts.join(' · ') : String(tasks.length) + ' subtasks';
  }

  function updateWorkflowStepper(run, preview) {
    if (!workflowStepper) {
      return;
    }
    let activeStep = 'draft';
    if (run) {
      const s = String(run.status || '').toLowerCase();
      if (s === 'running') { activeStep = 'execute'; }
      else if (s === 'previewed') { activeStep = 'preview'; }
      else if (s === 'completed' || s === 'failed') { activeStep = 'review'; }
    } else if (preview) {
      activeStep = 'preview';
    }

    const stepOrder = ['draft', 'preview', 'execute', 'review'];
    const activeIdx = stepOrder.indexOf(activeStep);

    workflowStepper.querySelectorAll('.step-item').forEach(function (item) {
      const step = item.getAttribute('data-step');
      const idx = stepOrder.indexOf(step || '');
      item.classList.remove('is-active', 'is-done');
      if (step === activeStep) {
        item.classList.add('is-active');
      } else if (idx < activeIdx) {
        item.classList.add('is-done');
      }
    });
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
    const executionOptions = payload.executionOptions || {};
    updateWorkflowStepper(run, preview);
    renderSubtaskTracker(preview, run, liveMessage);
    const approvalEnabled = Boolean(executionOptions.requireBatchApproval);
    const isRunning = Boolean(run && run.status === 'running');
    const awaitingApproval = Boolean(run && run.awaitingBatchApproval);
    const isPaused = Boolean(run && run.paused);
    const progressRatio = run && Number(run.totalSubtaskCount) > 0
      ? Math.max(0, Math.min(100, Math.round((Number(run.completedSubtaskCount) / Number(run.totalSubtaskCount)) * 100)))
      : 0;

    setText(heroLiveStatus, liveMessage);
    setText(heroApprovalMode, executionOptions.autonomousMode
      ? 'Autonomous walk-away mode'
      : approvalEnabled
        ? 'Approval checkpoints enabled'
        : 'Operator-steered mode');
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
    if (liveProgressBar) {
      liveProgressBar.style.width = progressRatio + '%';
      liveProgressBar.setAttribute('aria-valuenow', String(progressRatio));
    }

    // ── Plan-review buttons ─────────────────────────────────────────
    const hasPreview = Boolean(preview);
    const isExecutable = hasPreview && !isRunning;

    setBtn('applyPlanEdits',
      !hasPreview,
      !hasPreview ? 'Preview a plan first before editing it.' : null);

    setBtn('discussDraft',
      !hasPreview,
      !hasPreview ? 'Preview a plan first to open a refinement discussion.' : null);

    setBtn('executePreview',
      !isExecutable,
      !hasPreview
        ? 'Preview a goal first to generate a plan to execute.'
        : isRunning
          ? 'A run is already in progress — wait for it to finish before starting another.'
          : null);

    // ── Execution-control buttons ────────────────────────────────────
    const approveDisabled = !awaitingApproval;
    setBtn('approveNextBatch',
      approveDisabled,
      !approvalEnabled
        ? 'Enable batch approval mode in the options above to use this control.'
        : awaitingApproval
          ? null
          : 'Atlas is not currently waiting for batch approval.');
    // Keep approve hidden when approval mode is off
    if (approveBatchButton instanceof HTMLButtonElement) {
      approveBatchButton.hidden = !approvalEnabled;
    }

    setBtn('pauseRun',
      !isRunning || isPaused,
      !isRunning
        ? 'Only available while a run is actively executing.'
        : isPaused
          ? 'The run is already paused.'
          : null);

    setBtn('resumeRun',
      !isPaused,
      !isPaused
        ? (isRunning ? 'The run is not currently paused.' : 'No run is paused.')
        : null);

    setBtn('rollbackCheckpoint',
      isRunning,
      isRunning ? 'Cannot roll back while a run is in progress.' : null);
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
        '<div class="preview-pill">',
        '<p class="field-label">Run mode<' + '/p>',
        '<strong>' + escapeHtml(preview.executionOptions && preview.executionOptions.autonomousMode ? 'Autonomous walk-away mode' : 'Operator-steered mode') + '<' + '/strong>',
        '<span>' + escapeHtml(preview.executionOptions && preview.executionOptions.mirrorProgressToChat
          ? 'Progress and the internal monologue will mirror into a dedicated run chat session.'
          : 'Progress will stay in the Run Center unless you reopen the run chat manually.') + '<' + '/span>',
        '<' + '/div>',
        (preview.ideationOrigin
          ? '<div class="preview-pill">' +
              '<p class="field-label">Ideation source<' + '/p>' +
              '<strong>' + escapeHtml(preview.ideationOrigin.sourceCardTitle || 'Ideation-launched run') + '<' + '/strong>' +
              '<span>' + escapeHtml(preview.ideationOrigin.sourcePrompt || 'This preview was seeded directly from the ideation board.') + '<' + '/span>' +
            '<' + '/div>'
          : ''),
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
    if (goalInput instanceof HTMLTextAreaElement && document.activeElement !== goalInput) {
      goalInput.value = preview.goal || '';
    }
  }

  function renderRunCards(runs, selectedRunId) {
    if (!runsList) {
      return;
    }
    const normalizedSearch = String(clientState.search || '').trim().toLowerCase();
    const visibleRuns = (Array.isArray(runs) ? runs : []).filter(run => {
      if (!normalizedSearch) {
        return true;
      }
      const haystack = [run.title, run.goal, run.status, run.changeSummary].join(' ').toLowerCase();
      return haystack.includes(normalizedSearch);
    });
    if (visibleRuns.length === 0) {
      runsList.innerHTML = renderEmptyCard('No project runs recorded yet', 'The run history will appear here after you preview or execute a project run.');
      return;
    }
    runsList.innerHTML = visibleRuns.map(run => {
      const failed = Array.isArray(run.failedSubtaskTitles) && run.failedSubtaskTitles.length > 0
        ? '<p><span class="subtask-cross" style="font-size:12px">✗<' + '/span> ' + escapeHtml(run.failedSubtaskTitles.join(', ')) + ' — use <em>Retry Failed Subtasks<' + '/em> to reattempt<' + '/p>'
        : '';
      const reportButton = run.reportPath
        ? '<button type="button" data-action="open-report" data-run-report="' + escapeHtml(run.reportPath) + '">Open Report<' + '/button>'
        : '';
      const chatButton = run.chatSessionId
        ? '<button type="button" data-action="open-run-chat" data-run-id="' + escapeHtml(run.id) + '">Open Run Chat<' + '/button>'
        : '';
      const feedbackOriginButton = run.ideationOrigin && (run.status === 'completed' || run.status === 'failed')
        ? '<button type="button" data-action="feedback-origin" data-run-id="' + escapeHtml(run.id) + '">Update Origin Ideation<' + '/button>'
        : '';
      const feedbackThreadButton = run.status === 'completed' || run.status === 'failed'
        ? '<button type="button" data-action="feedback-new-thread" data-run-id="' + escapeHtml(run.id) + '">Create Ideation Thread<' + '/button>'
        : '';
      const deleteButton = run.status !== 'running'
        ? '<button type="button" data-action="delete-run" data-run-id="' + escapeHtml(run.id) + '">Delete Run<' + '/button>'
        : '';
      const activeClass = run.id === selectedRunId ? ' active' : '';
      return '<article class="run-card run-row' + activeClass + '">' +
        '<div class="run-card-header run-row-header">' +
          '<div class="run-card-header-inner">' +
            getRunCardIcon(run.status) +
            '<div>' +
              '<h3>' + escapeHtml(run.title) + '<' + '/h3>' +
              '<p class="section-copy run-row-copy">' + escapeHtml(run.goal) + '<' + '/p>' +
            '<' + '/div>' +
          '<' + '/div>' +
          renderStatusBadge(run.status, getStatusTone(run.status)) +
        '<' + '/div>' +
        '<div class="run-meta run-row-meta">' +
          '<div><span class="metric-label">Updated<' + '/span><strong>' + escapeHtml(formatTimestamp(run.updatedAt)) + '<' + '/strong><' + '/div>' +
          '<div><span class="metric-label">Progress<' + '/span><strong>' + escapeHtml(String(run.completedSubtaskCount) + '/' + String(run.totalSubtaskCount)) + ' subtasks<' + '/strong><' + '/div>' +
          '<div><span class="metric-label">Mode<' + '/span><strong>' + escapeHtml(run.executionOptions && run.executionOptions.autonomousMode ? 'Autonomous' : run.executionOptions && run.executionOptions.requireBatchApproval ? 'Checkpointed' : 'Steered') + '<' + '/strong><' + '/div>' +
          '<div><span class="metric-label">Change summary<' + '/span><strong>' + escapeHtml(run.changeSummary || 'No changes recorded') + '<' + '/strong><' + '/div>' +
          (run.ideationOrigin ? '<div><span class="metric-label">Origin<' + '/span><strong>' + escapeHtml(run.ideationOrigin.sourceCardTitle || 'Ideation') + '<' + '/strong><' + '/div>' : '') +
        '<' + '/div>' +
        failed +
        '<div class="action-strip">' +
          '<button type="button" data-action="select-run" data-run-id="' + escapeHtml(run.id) + '">Inspect Run<' + '/button>' +
          chatButton +
          feedbackOriginButton +
          feedbackThreadButton +
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
    if (!selectedRun || !selectedRunFiles || !selectedRunActions || !artifactList || !selectedRunOutput) {
      return;
    }
    if (!run) {
      selectedRun.innerHTML = renderEmptyCard('Select a run to inspect it', 'Choose a tracked run from the history list to review its files, report, and subtask artifacts.');
      selectedRunActions.innerHTML = '';
      selectedRunOutput.innerHTML = renderEmptyCard('No final output selected', 'The primary synthesis for the selected run appears here once a run is chosen.');
      selectedRunFiles.innerHTML = '';
      artifactList.innerHTML = renderEmptyCard('No artifacts selected', 'Subtask-level diff previews and verification notes appear once a run is selected.');
      renderLogEntries([]);
      return;
    }
    const tddSummary = summarizeTddStatuses(run.subTaskArtifacts);
    selectedRun.innerHTML =
      '<div class="summary-grid">' +
        '<div class="summary-block"><span class="metric-label">Run<' + '/span><strong>' + escapeHtml(run.title) + '<' + '/strong><span>' + escapeHtml(run.goal) + '<' + '/span><' + '/div>' +
        '<div class="summary-block"><span class="metric-label">Status<' + '/span><strong>' + getRunCardIcon(run.status) + renderStatusBadge(run.status, getStatusTone(run.status)) + '<' + '/strong><' + '/div>' +
        (run.plannerJobIndex && run.plannerJobCount
          ? '<div class="summary-block"><span class="metric-label">Planner job<' + '/span><strong>' + escapeHtml(String(run.plannerJobIndex)) + '/' + escapeHtml(String(run.plannerJobCount)) + '<' + '/strong><span>Large plans can advance one staged draft at a time.<' + '/span><' + '/div>'
          : '') +
        '<div class="summary-block"><span class="metric-label">Subtasks<' + '/span><strong>' + escapeHtml(String(run.completedSubtaskCount) + '/' + String(run.totalSubtaskCount)) + '<' + '/strong><span>' + escapeHtml(run.planSubtaskCount ? String(run.planSubtaskCount) + ' planned initially' : 'Planner count unavailable') + '<' + '/span><' + '/div>' +
        '<div class="summary-block"><span class="metric-label">Batches<' + '/span><strong>' + escapeHtml(run.totalBatches > 0 ? String(run.currentBatch) + '/' + String(run.totalBatches) : 'n/a') + '<' + '/strong><span>' + escapeHtml(run.changeSummary || 'No changed files recorded') + '<' + '/span><' + '/div>' +
        '<div class="summary-block"><span class="metric-label">Execution mode<' + '/span><strong>' + escapeHtml(run.executionOptions && run.executionOptions.autonomousMode ? 'Autonomous' : run.executionOptions && run.executionOptions.requireBatchApproval ? 'Checkpointed' : 'Steered') + '<' + '/strong><span>' + escapeHtml(run.executionOptions && run.executionOptions.mirrorProgressToChat ? 'Dedicated chat mirror enabled' : 'Run center only') + '<' + '/span><' + '/div>' +
        (run.ideationOrigin
          ? '<div class="summary-block"><span class="metric-label">Ideation source<' + '/span><strong>' + escapeHtml(run.ideationOrigin.sourceCardTitle || 'Ideation-launched run') + '<' + '/strong><span>' + escapeHtml(run.ideationOrigin.sourcePrompt || 'Linked to the project ideation board.') + '<' + '/span><' + '/div>'
          : '') +
        '<div class="summary-block"><span class="metric-label">TDD<' + '/span><strong>' + escapeHtml(tddSummary) + '<' + '/strong><span>Implementation writes now require a failing test signal first.<' + '/span><' + '/div>' +
      '<' + '/div>';
    selectedRunActions.innerHTML = '';
    if (run.chatSessionId) {
      selectedRunActions.innerHTML += '<button type="button" data-action="open-run-chat" data-run-id="' + escapeHtml(run.id) + '">Open Run Chat<' + '/button>';
    }
    if (run.reportPath) {
      selectedRunActions.innerHTML += '<button type="button" data-action="open-report" data-run-report="' + escapeHtml(run.reportPath) + '">Open Report<' + '/button>';
    }
    if (run.ideationOrigin && (run.status === 'completed' || run.status === 'failed')) {
      selectedRunActions.innerHTML += '<button type="button" data-action="feedback-origin" data-run-id="' + escapeHtml(run.id) + '">Send Learnings To Origin Ideation<' + '/button>';
    }
    if (run.status === 'completed' || run.status === 'failed') {
      selectedRunActions.innerHTML += '<button type="button" data-action="feedback-new-thread" data-run-id="' + escapeHtml(run.id) + '">Create New Ideation Thread<' + '/button>';
    }
    if (run.status === 'failed') {
      selectedRunActions.innerHTML += '<button type="button" data-action="retry-failed">Retry Failed Subtasks<' + '/button>';
    }
    if (run.status !== 'running') {
      selectedRunActions.innerHTML += '<button type="button" data-action="delete-run" data-run-id="' + escapeHtml(run.id) + '">Delete Run<' + '/button>';
    }
    selectedRunOutput.innerHTML = run.synthesis
      ? '<div class="result-output-shell"><div class="result-output">' + escapeHtml(run.synthesis).replace(/\n/g, '<br />') + '<' + '/div><' + '/div>'
      : renderEmptyCard('No synthesized output recorded yet', 'The final project response will appear here once Atlas finishes the run.');
    selectedRunFiles.innerHTML = '';
    if (!Array.isArray(run.changedFiles) || run.changedFiles.length === 0) {
      selectedRunFiles.innerHTML = '<li>' + renderEmptyCard('No changed files recorded', 'This run did not persist any changed file references into its summary.') + '<' + '/li>';
    }
    (Array.isArray(run.changedFiles) ? run.changedFiles : []).forEach(file => {
      const item = document.createElement('li');
      item.className = 'file-chip';
      const button = document.createElement('button');
      const sourceSuffix = Array.isArray(file.sourceTitles) && file.sourceTitles.length > 0 ? ' - ' + file.sourceTitles.join(', ') : '';
      button.textContent = file.relativePath + ' (' + file.status + ')' + sourceSuffix;
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
      setButtonLoading('previewGoal');
      vscode.postMessage({ type: 'previewGoal', payload: goal });
    });
  }
  if (applyPlanEditsButton) {
    applyPlanEditsButton.addEventListener('click', () => {
      const value = planDraftInput instanceof HTMLTextAreaElement ? planDraftInput.value : '';
      setButtonLoading('applyPlanEdits');
      vscode.postMessage({ type: 'updatePlanDraft', payload: value });
    });
  }
  if (discussDraftButton) {
    discussDraftButton.addEventListener('click', () => {
      const goal = goalInput instanceof HTMLTextAreaElement ? goalInput.value : '';
      const planDraft = planDraftInput instanceof HTMLTextAreaElement ? planDraftInput.value : '';
      setButtonLoading('discussDraft');
      vscode.postMessage({ type: 'discussDraft', payload: { goal: goal, planDraft: planDraft } });
    });
  }
  if (executeButton) {
    executeButton.addEventListener('click', () => {
      setButtonLoading('executePreview');
      vscode.postMessage({ type: 'executePreview' });
    });
  }
  if (refreshButton) {
    refreshButton.addEventListener('click', () => vscode.postMessage({ type: 'refreshRuns' }));
  }
  if (approveBatchButton) {
    approveBatchButton.addEventListener('click', () => {
      setButtonLoading('approveNextBatch');
      vscode.postMessage({ type: 'approveNextBatch' });
    });
  }
  if (pauseRunButton) {
    pauseRunButton.addEventListener('click', () => {
      setButtonLoading('pauseRun');
      vscode.postMessage({ type: 'pauseRun' });
    });
  }
  if (resumeRunButton) {
    resumeRunButton.addEventListener('click', () => {
      setButtonLoading('resumeRun');
      vscode.postMessage({ type: 'resumeRun' });
    });
  }
  if (openScmButton) {
    openScmButton.addEventListener('click', () => vscode.postMessage({ type: 'openSourceControl' }));
  }
  if (openIdeationButton) {
    openIdeationButton.addEventListener('click', () => vscode.postMessage({ type: 'openIdeation' }));
  }
  if (rollbackButton) {
    rollbackButton.addEventListener('click', () => {
      setButtonLoading('rollbackCheckpoint');
      vscode.postMessage({ type: 'rollbackLastCheckpoint' });
    });
  }
  if (requireBatchApproval instanceof HTMLInputElement) {
    requireBatchApproval.addEventListener('change', () => {
      vscode.postMessage({ type: 'setRequireBatchApproval', payload: requireBatchApproval.checked });
    });
  }
  if (autonomousMode instanceof HTMLInputElement) {
    autonomousMode.addEventListener('change', () => {
      vscode.postMessage({ type: 'setAutonomousMode', payload: autonomousMode.checked });
    });
  }
  if (mirrorProgressToChat instanceof HTMLInputElement) {
    mirrorProgressToChat.addEventListener('change', () => {
      vscode.postMessage({ type: 'setMirrorProgressToChat', payload: mirrorProgressToChat.checked });
    });
  }
  if (injectOutputIntoFollowUp instanceof HTMLInputElement) {
    injectOutputIntoFollowUp.addEventListener('change', () => {
      vscode.postMessage({ type: 'setInjectOutputIntoFollowUp', payload: injectOutputIntoFollowUp.checked });
    });
  }
  if (runSearch instanceof HTMLInputElement) {
    runSearch.addEventListener('input', () => {
      clientState.search = runSearch.value || '';
      renderRunCards(clientState.payload.runs || [], clientState.payload.selectedRun ? clientState.payload.selectedRun.id : '');
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
      if (action === 'open-run-chat') {
        vscode.postMessage({ type: 'openRunChat', payload: target.getAttribute('data-run-id') || '' });
      }
      if (action === 'feedback-origin') {
        vscode.postMessage({ type: 'feedbackToOriginIdeation', payload: target.getAttribute('data-run-id') || '' });
      }
      if (action === 'feedback-new-thread') {
        vscode.postMessage({ type: 'createIdeationFromRun', payload: target.getAttribute('data-run-id') || '' });
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
      if (action === 'open-run-chat') {
        vscode.postMessage({ type: 'openRunChat', payload: target.getAttribute('data-run-id') || '' });
      }
      if (action === 'feedback-origin') {
        vscode.postMessage({ type: 'feedbackToOriginIdeation', payload: target.getAttribute('data-run-id') || '' });
      }
      if (action === 'feedback-new-thread') {
        vscode.postMessage({ type: 'createIdeationFromRun', payload: target.getAttribute('data-run-id') || '' });
      }
    });
  }

  window.addEventListener('message', event => {
    const message = event.data;
    if (!message || message.type !== 'state') {
      return;
    }
    const payload = message.payload || {};
    clientState.payload = payload;
    if (requireBatchApproval instanceof HTMLInputElement) {
      requireBatchApproval.checked = Boolean(payload.executionOptions && payload.executionOptions.requireBatchApproval);
    }
    if (autonomousMode instanceof HTMLInputElement) {
      autonomousMode.checked = Boolean(payload.executionOptions && payload.executionOptions.autonomousMode);
    }
    if (mirrorProgressToChat instanceof HTMLInputElement) {
      mirrorProgressToChat.checked = Boolean(payload.executionOptions && payload.executionOptions.mirrorProgressToChat);
    }
    if (injectOutputIntoFollowUp instanceof HTMLInputElement) {
      injectOutputIntoFollowUp.checked = Boolean(payload.executionOptions && payload.executionOptions.injectOutputIntoFollowUp);
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

function createDefaultExecutionOptions(): ProjectRunExecutionOptions {
  return {
    autonomousMode: true,
    requireBatchApproval: false,
    mirrorProgressToChat: true,
    injectOutputIntoFollowUp: true,
  };
}

function normalizeExecutionOptions(value: ProjectRunExecutionOptions | undefined): ProjectRunExecutionOptions {
  const defaults = createDefaultExecutionOptions();
  const requireBatchApproval = value?.requireBatchApproval ?? defaults.requireBatchApproval;
  const autonomousMode = value?.autonomousMode ?? (!requireBatchApproval && defaults.autonomousMode);
  return {
    autonomousMode: requireBatchApproval ? false : autonomousMode,
    requireBatchApproval,
    mirrorProgressToChat: value?.mirrorProgressToChat ?? defaults.mirrorProgressToChat,
    injectOutputIntoFollowUp: value?.injectOutputIntoFollowUp ?? defaults.injectOutputIntoFollowUp,
  };
}

function buildRunChatPrompt(run: ProjectRunRecord): string {
  return [
    `Project run goal: ${run.goal}`,
    '',
    `Execution mode: ${run.executionOptions.autonomousMode ? 'Autonomous walk-away mode' : 'Operator-steered mode'}`,
    `Batch approvals: ${run.executionOptions.requireBatchApproval ? 'required before each batch' : 'not required'}`,
    `Mirror progress to chat: ${run.executionOptions.mirrorProgressToChat ? 'enabled' : 'disabled'}`,
    `Carry forward output into follow-up runs: ${run.executionOptions.injectOutputIntoFollowUp ? 'enabled' : 'disabled'}`,
    ...(run.carryForwardSummary
      ? ['', 'Carry-forward synthesis from the previous planner job:', '', run.carryForwardSummary]
      : []),
  ].join('\n');
}

function buildRunChatMirrorMarkdown(run: ProjectRunRecord): string {
  const lines = [
    `# ${run.title}`,
    '',
    `Status: ${run.status}`,
    `Progress: ${run.completedSubtaskCount}/${run.totalSubtaskCount || run.planSubtaskCount || 0} subtasks`,
    `Batches: ${run.currentBatch}/${run.totalBatches || 0}`,
    '',
  ];

  if (run.summary?.synthesis) {
    lines.push('## Final output', '', run.summary.synthesis, '');
  }

  lines.push('## Internal monologue', '');
  const logLines = run.logs.slice(-10).map(entry => `- ${entry.timestamp} [${entry.level}] ${entry.message}`);
  lines.push(...(logLines.length > 0 ? logLines : ['- No run telemetry yet.']), '');

  if (run.reportPath) {
    lines.push(`Report: ${run.reportPath}`, '');
  }

  return lines.join('\n');
}

function buildRunTranscriptMetadata(run: ProjectRunRecord): SessionTranscriptMetadata {
  return {
    thoughtSummary: buildRunThoughtSummary(run),
    timelineNotes: run.logs.slice(-8).map<SessionTimelineNote>(entry => ({
      label: entry.level === 'error' ? 'Error' : entry.level === 'warning' ? 'Checkpoint' : 'Progress',
      summary: entry.message,
      tone: entry.level === 'warning' || entry.level === 'error' ? 'warning' : 'info',
    })),
  };
}

function buildRunThoughtSummary(run: ProjectRunRecord): SessionThoughtSummary {
  const completed = run.completedSubtaskCount;
  const total = run.totalSubtaskCount || run.planSubtaskCount || 0;
  const changedFileCount = run.summary?.changedFiles.length ?? 0;
  const failedCount = run.failedSubtaskTitles.length;
  const highlights = [
    `${completed}/${total} subtasks completed across ${run.totalBatches || 0} batches.`,
    changedFileCount > 0 ? `${changedFileCount} workspace file(s) changed.` : 'No workspace changes recorded yet.',
    run.summary ? `Run cost $${run.summary.totalCostUsd.toFixed(4)} over ${Math.max(1, Math.round(run.summary.totalDurationMs / 1000))}s.` : 'Final synthesis is still pending.',
    failedCount > 0 ? `${failedCount} subtask(s) failed and remain visible for follow-up.` : 'No failed subtasks are currently recorded.',
  ];

  return {
    label: run.status === 'completed' ? 'Project run completed' : run.status === 'failed' ? 'Project run needs follow-up' : 'Project run in progress',
    summary: run.summary?.synthesis
      ? run.summary.synthesis
      : run.status === 'running'
        ? 'AtlasMind is still executing the reviewed plan and mirroring its live progress here.'
        : 'The run has not produced a final synthesis yet.',
    bullets: highlights,
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
    executionOptions: normalizeExecutionOptions(run.executionOptions),
    ...(run.ideationOrigin ? { ideationOrigin: run.ideationOrigin } : {}),
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