import * as vscode from 'vscode';
import * as path from 'path';
import type { AtlasMindContext } from '../extension.js';
import { Planner, parsePlannerResponse, removeCycles } from '../core/planner.js';
import { TaskProfiler } from '../core/taskProfiler.js';
import type {
  ChangedWorkspaceFile,
  ProjectPlan,
  ProjectProgressUpdate,
  ProjectRunRecord,
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
import { getWebviewHtmlShell } from './webviewUtils.js';

type ProjectRunCenterMessage =
  | { type: 'previewGoal'; payload: string }
  | { type: 'updatePlanDraft'; payload: string }
  | { type: 'executePreview' }
  | { type: 'refreshRuns' }
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
    };
    this.selectedRunId = runId;
    this.liveStatus = 'Preview generated. Review the plan before executing.';

    await this.atlas.projectRunHistory.upsertRun({
      id: runId,
      goal,
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
    };

    const existing = await this.atlas.projectRunHistory.getRunAsync(this.previewState.runId);
    if (existing) {
      await this.atlas.projectRunHistory.upsertRun({
        ...existing,
        goal: this.previewState.goal,
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

    this.previewState = { ...this.previewState, plan: draftPlan };
    await this.executeRun(existing, { resumeFailedOnly: false, planOverride: draftPlan });
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

  private async executeRun(
    sourceRun: ProjectRunRecord,
    options: { resumeFailedOnly: boolean; planOverride: ProjectPlan },
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
      ? sourceRun.subTaskArtifacts
        .filter(artifact => artifact.status === 'completed')
        .map(artifact => artifactToResult(artifact))
      : [];

    let mutableRun: ProjectRunRecord = {
      ...sourceRun,
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
      await appendLog(
        failedSubtaskTitles.length > 0 ? 'warning' : 'info',
        failedSubtaskTitles.length > 0
          ? `Execution finished with ${failedSubtaskTitles.length} failed subtask(s).`
          : `Execution finished successfully. ${changedFiles.length} file(s) changed (${summarizeChangedFiles(changedFiles)}).`,
      );

      this.liveStatus = 'Execution completed.';
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

    await this.panel.webview.postMessage({
      type: 'state',
      payload: {
        liveStatus: this.liveStatus,
        requireBatchApproval: this.requireBatchApproval,
        preview: this.previewState ? serializePreview(this.previewState) : null,
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
        <h1>AtlasMind Project Run Center</h1>
        <p>Review a plan before execution, gate each batch, and inspect subtask-level diffs and artifacts.</p>
        <section>
          <h2>Review and Apply</h2>
          <textarea id="goalInput" rows="4" placeholder="Describe the project goal you want AtlasMind to plan and execute..."></textarea>
          <div class="row">
            <button id="previewGoal" class="primary-btn">Preview Plan</button>
            <button id="applyPlanEdits">Apply Plan Edits</button>
            <button id="executePreview">Execute Reviewed Plan</button>
            <button id="refreshRuns">Refresh Runs</button>
          </div>
          <label class="checkbox-row"><input id="requireBatchApproval" type="checkbox" /> Require approval before each batch</label>
          <div id="liveStatus" class="status-label"></div>
          <div id="previewMeta" class="meta-card"></div>
          <textarea id="planDraftInput" rows="14" placeholder="Preview the project plan, then edit the JSON here before execution."></textarea>
          <table>
            <thead>
              <tr><th>ID</th><th>Title</th><th>Role</th><th>Depends On</th></tr>
            </thead>
            <tbody id="previewRows"></tbody>
          </table>
        </section>
        <section>
          <h2>Live Execution</h2>
          <ul id="liveLog" class="log-list"></ul>
          <div class="row">
            <button id="approveNextBatch">Approve Next Batch</button>
            <button id="pauseRun">Pause Before Next Batch</button>
            <button id="resumeRun">Resume</button>
            <button id="openScm">Open Source Control</button>
            <button id="rollbackCheckpoint">Rollback Last Checkpoint</button>
          </div>
        </section>
        <section>
          <h2>Recent Runs</h2>
          <div id="runsList" class="run-list"></div>
        </section>
        <section>
          <h2>Selected Run</h2>
          <div id="selectedRun" class="meta-card"></div>
          <div id="selectedRunActions" class="row"></div>
          <ul id="selectedRunFiles" class="attachment-list"></ul>
          <div id="artifactList" class="artifact-list"></div>
        </section>
      `,
      extraCss: `
        textarea {
          width: 100%;
          resize: vertical;
          color: var(--vscode-input-foreground);
          background: var(--vscode-input-background);
          border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #444));
          padding: 8px;
          font-family: var(--vscode-font-family, system-ui, sans-serif);
        }
        .row { display: flex; gap: 10px; margin: 10px 0; flex-wrap: wrap; }
        .checkbox-row { display: flex; gap: 8px; align-items: center; margin: 8px 0; }
        .primary-btn { font-weight: 600; }
        .status-label { font-size: 0.95em; color: var(--vscode-descriptionForeground); margin-top: 4px; }
        .meta-card {
          border: 1px solid var(--vscode-widget-border, #444);
          padding: 10px;
          background: var(--vscode-input-background);
          margin-top: 10px;
          white-space: pre-wrap;
        }
        .log-list, .attachment-list {
          margin: 8px 0 0;
          padding-left: 18px;
        }
        .run-list, .artifact-list {
          display: grid;
          gap: 10px;
        }
        .run-card, .artifact-card {
          border: 1px solid var(--vscode-widget-border, #444);
          padding: 10px;
          background: var(--vscode-input-background);
        }
        .run-card h3, .artifact-card h3 {
          margin: 0 0 6px;
          font-size: 1em;
        }
        .run-card button {
          margin-right: 8px;
          margin-top: 8px;
        }
        .artifact-card pre {
          overflow-x: auto;
          white-space: pre-wrap;
          word-break: break-word;
          background: var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.12));
          padding: 8px;
        }
        .status-badge {
          display: inline-block;
          margin-left: 8px;
          padding: 2px 8px;
          border-radius: 999px;
          background: var(--vscode-badge-background);
          color: var(--vscode-badge-foreground);
          font-size: 0.85em;
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
  };
}

function serializeRun(run: ProjectRunRecord) {
  return {
    id: run.id,
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
  const executeButton = document.getElementById('executePreview');
  const refreshButton = document.getElementById('refreshRuns');
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

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/[<]/g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderPreview(preview) {
    if (!preview) {
      if (previewMeta) { previewMeta.textContent = 'No preview generated yet.'; }
      if (previewRows) { previewRows.innerHTML = ''; }
      if (planDraftInput) { planDraftInput.value = ''; }
      return;
    }
    if (previewMeta) {
      previewMeta.textContent =
        'Goal: ' + preview.goal + '\\n' +
        'Estimated files: ~' + preview.estimatedFiles + '\\n' +
        'Subtasks: ' + preview.plan.subTasks.length + '\\n' +
        (preview.requiresApproval
          ? 'Approval note: high-impact run (threshold ' + preview.approvalThreshold + ' files).'
          : 'Approval note: safe to execute from the reviewed plan.');
    }
    if (previewRows) {
      previewRows.innerHTML = preview.plan.subTasks.map(task => {
        const dependsOn = Array.isArray(task.dependsOn) && task.dependsOn.length > 0 ? task.dependsOn.join(', ') : '—';
        return '<tr>' +
          '<td>' + escapeHtml(task.id) + ''<' + '/td>' +
          '<td>' + escapeHtml(task.title) + ''<' + '/td>' +
          '<td>' + escapeHtml(task.role) + ''<' + '/td>' +
          '<td>' + escapeHtml(dependsOn) + ''<' + '/td>' +
          ''<' + '/tr>';
      }).join('');
    }
    if (planDraftInput) {
      planDraftInput.value = preview.planDraft || '';
    }
  }

  function renderRunCards(runs) {
    if (!runsList) {
      return;
    }
    if (!Array.isArray(runs) || runs.length === 0) {
      runsList.innerHTML = '<div class="run-card">No project runs recorded yet.'<' + '/div>';
      return;
    }
    runsList.innerHTML = runs.map(run => {
      const failed = Array.isArray(run.failedSubtaskTitles) && run.failedSubtaskTitles.length > 0
        ? '<div>Failures: ' + escapeHtml(run.failedSubtaskTitles.join(', ')) + ''<' + '/div>'
        : '';
      const reportButton = run.reportPath
        ? '<button data-action="open-report" data-run-report="' + escapeHtml(run.reportPath) + '">Open Report'<' + '/button>'
        : '';
      return '<div class="run-card">' +
        '<h3>' + escapeHtml(run.goal) + '<span class="status-badge">' + escapeHtml(run.status) + ''<' + '/span>'<' + '/h3>' +
        '<div>Updated: ' + escapeHtml(run.updatedAt) + ''<' + '/div>' +
        '<div>Subtasks: ' + escapeHtml(run.completedSubtaskCount) + '/' + escapeHtml(run.totalSubtaskCount) + ''<' + '/div>' +
        '<div>Estimated files: ~' + escapeHtml(run.estimatedFiles) + ''<' + '/div>' +
        failed +
        '<button data-action="select-run" data-run-id="' + escapeHtml(run.id) + '">Inspect Run'<' + '/button>' +
        reportButton +
        ''<' + '/div>';
    }).join('');
  }

  function renderSelectedRun(run) {
    if (!selectedRun || !selectedRunFiles || !selectedRunActions || !artifactList) {
      return;
    }
    if (!run) {
      selectedRun.textContent = 'Select a run to inspect it.';
      selectedRunActions.innerHTML = '';
      selectedRunFiles.innerHTML = '';
      artifactList.innerHTML = '';
      return;
    }
    selectedRun.textContent =
      'Goal: ' + run.goal + '\\n' +
      'Status: ' + run.status + '\\n' +
      'Subtasks: ' + run.completedSubtaskCount + '/' + run.totalSubtaskCount + '\\n' +
      'Batches: ' + (run.totalBatches > 0 ? run.currentBatch + '/' + run.totalBatches : 'n/a') + '\\n' +
      'Changed files: ' + run.changeSummary;
    selectedRunActions.innerHTML = '';
    if (run.reportPath) {
      selectedRunActions.innerHTML += '<button data-action="open-report" data-run-report="' + escapeHtml(run.reportPath) + '">Open Report'<' + '/button>';
    }
    if (run.status === 'failed') {
      selectedRunActions.innerHTML += '<button data-action="retry-failed">Retry Failed Subtasks'<' + '/button>';
    }
    selectedRunFiles.innerHTML = '';
    (Array.isArray(run.changedFiles) ? run.changedFiles : []).forEach(file => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.textContent = file.relativePath + ' (' + file.status + ')';
      button.setAttribute('data-action', 'open-file');
      button.setAttribute('data-file-path', file.relativePath);
      item.appendChild(button);
      selectedRunFiles.appendChild(item);
    });
    artifactList.innerHTML = (Array.isArray(run.subTaskArtifacts) ? run.subTaskArtifacts : []).map(artifact => {
      const diff = artifact.diffPreview ? '<pre>' + escapeHtml(artifact.diffPreview) + ''<' + '/pre>' : '';
      const verification = artifact.verificationSummary ? '<div>Verification: ' + escapeHtml(artifact.verificationSummary) + ''<' + '/div>' : '';
      const tools = artifact.toolCallCount > 0
        ? '<div>Tools: ' + escapeHtml(String(artifact.toolCallCount)) + ' (' + escapeHtml((artifact.toolCalls || []).map(tool => tool.toolName).join(', ')) + ')'<' + '/div>'
        : '<div>Tools: none'<' + '/div>';
      return '<div class="artifact-card">' +
        '<h3>' + escapeHtml(artifact.title) + '<span class="status-badge">' + escapeHtml(artifact.status) + ''<' + '/span>'<' + '/h3>' +
        '<div>Role: ' + escapeHtml(artifact.role) + ''<' + '/div>' +
        '<div>Depends on: ' + escapeHtml((artifact.dependsOn || []).join(', ') || '—') + ''<' + '/div>' +
        '<div>Duration: ' + escapeHtml(String(artifact.durationMs)) + 'ms'<' + '/div>' +
        tools +
        verification +
        '<div>Changed files: ' + escapeHtml((artifact.changedFiles || []).map(file => file.relativePath).join(', ') || 'none') + ''<' + '/div>' +
        diff +
        ''<' + '/div>';
    }).join('');
    if (liveLog) {
      liveLog.innerHTML = (run.logs || []).slice(-12).map(entry => '<li>' + escapeHtml(entry.message) + ''<' + '/li>').join('');
    }
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
    });
  }

  window.addEventListener('message', event => {
    const message = event.data;
    if (!message || message.type !== 'state') {
      return;
    }
    const payload = message.payload || {};
    if (liveStatus) {
      liveStatus.textContent = String(payload.liveStatus || 'Idle');
    }
    if (requireBatchApproval instanceof HTMLInputElement) {
      requireBatchApproval.checked = Boolean(payload.requireBatchApproval);
    }
    renderPreview(payload.preview || null);
    renderRunCards(payload.runs || []);
    renderSelectedRun(payload.selectedRun || null);
  });
})();`;
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