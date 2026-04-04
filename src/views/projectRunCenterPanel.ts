import * as vscode from 'vscode';
import * as path from 'path';
import type { AtlasMindContext } from '../extension.js';
import { Planner } from '../core/planner.js';
import { TaskProfiler } from '../core/taskProfiler.js';
import type {
  ChangedWorkspaceFile,
  ProjectProgressUpdate,
  ProjectRunRecord,
  ProjectRunSummary,
  RoutingConstraints,
  SubTask,
} from '../types.js';
import {
  addFileAttribution,
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
  | { type: 'executePreview' }
  | { type: 'refreshRuns' }
  | { type: 'openRunReport'; payload: string }
  | { type: 'openFileReference'; payload: string }
  | { type: 'openSourceControl' }
  | { type: 'rollbackLastCheckpoint' }
  | { type: 'selectRun'; payload: string };

interface ProjectRunPreviewState {
  runId: string;
  goal: string;
  estimatedFiles: number;
  requiresApproval: boolean;
  approvalThreshold: number;
  subTasks: SubTask[];
}

export class ProjectRunCenterPanel {
  public static currentPanel: ProjectRunCenterPanel | undefined;
  private static readonly viewType = 'atlasmind.projectRunCenter';

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private previewState: ProjectRunPreviewState | undefined;
  private selectedRunId: string | undefined;
  private liveStatus = 'Idle';

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

    this.previewState = {
      runId,
      goal,
      estimatedFiles,
      requiresApproval: estimatedFiles > projectUiConfig.approvalFileThreshold,
      approvalThreshold: projectUiConfig.approvalFileThreshold,
      subTasks: plan.subTasks,
    };
    this.selectedRunId = runId;
    this.liveStatus = 'Preview generated. Review the plan before executing.';

    await this.atlas.projectRunHistory.upsertRun({
      id: runId,
      goal,
      status: 'previewed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      estimatedFiles,
      requiresApproval: this.previewState.requiresApproval,
      planSubtaskCount: plan.subTasks.length,
      completedSubtaskCount: 0,
      totalSubtaskCount: plan.subTasks.length,
      currentBatch: 0,
      totalBatches: 0,
      failedSubtaskTitles: [],
      logs: [{ timestamp: new Date().toISOString(), level: 'info', message: 'Preview generated.' }],
    });
    this.atlas.projectRunsRefresh.fire();
    await this.syncState();
  }

  private async executePreview(): Promise<void> {
    if (!this.previewState) {
      this.liveStatus = 'Preview a goal before executing it.';
      await this.syncState();
      return;
    }

    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const constraints = this.getConstraints(configuration);
    const projectUiConfig = getProjectUiConfig(configuration);
    const baselineSnapshot = await createWorkspaceSnapshot();
    let lastImpactSnapshot = baselineSnapshot;
    const fileAttribution = new Map<string, Set<string>>();
    const failedSubtaskTitles: string[] = [];
    const runStartedAt = new Date().toISOString();
    const runRecord = this.atlas.projectRunHistory.getRun(this.previewState.runId);

    if (!runRecord) {
      this.liveStatus = 'The selected preview is no longer available.';
      await this.syncState();
      return;
    }

    let mutableRun: ProjectRunRecord = {
      ...runRecord,
      status: 'running',
      createdAt: runRecord.createdAt || runStartedAt,
      updatedAt: runStartedAt,
      logs: [...runRecord.logs, { timestamp: runStartedAt, level: 'info', message: 'Execution started.' }],
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
        logs: [...current.logs, { timestamp: new Date().toISOString(), level, message }].slice(-30),
      }));
    };

    const onProgress = (update: ProjectProgressUpdate): void => {
      void this.handleProgressUpdate(update, mutableRun, updateRun, appendLog, failedSubtaskTitles, fileAttribution, () => lastImpactSnapshot, next => {
        lastImpactSnapshot = next;
      });
    };

    try {
      this.liveStatus = 'Running reviewed project...';
      await this.syncState();
      const result = await this.atlas.orchestrator.processProject(this.previewState.goal, constraints, onProgress);
      const impact = await collectWorkspaceChangesSince(baselineSnapshot);
      const changedFiles = impact.changedFiles;
      const summary = buildProjectRunSummary(result, changedFiles, fileAttribution, runStartedAt);
      const reportUri = await writeProjectRunSummaryReport(summary, projectUiConfig.runReportFolder);
      const reportPath = reportUri ? vscode.workspace.asRelativePath(reportUri, false) : undefined;

      await updateRun(current => ({
        ...current,
        status: failedSubtaskTitles.length > 0 ? 'failed' : 'completed',
        completedSubtaskCount: result.subTaskResults.filter(item => item.status === 'completed').length,
        totalSubtaskCount: result.subTaskResults.length,
        failedSubtaskTitles: [...failedSubtaskTitles],
        summary,
        reportPath,
      }));
      await appendLog(
        failedSubtaskTitles.length > 0 ? 'warning' : 'info',
        failedSubtaskTitles.length > 0
          ? `Execution finished with ${failedSubtaskTitles.length} failed subtask(s).`
          : `Execution finished successfully. ${changedFiles.length} file(s) changed (${summarizeChangedFiles(changedFiles)}).`,
      );

      this.liveStatus = 'Execution completed.';
      this.selectedRunId = this.previewState.runId;
      await this.syncState();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateRun(current => ({
        ...current,
        status: 'failed',
        failedSubtaskTitles: failedSubtaskTitles.length > 0 ? [...failedSubtaskTitles] : ['Project execution failed'],
      }));
      await appendLog('error', `Execution failed: ${message}`);
      this.liveStatus = `Execution failed: ${message}`;
      await this.syncState();
    }
  }

  private async handleProgressUpdate(
    update: ProjectProgressUpdate,
    currentRun: ProjectRunRecord,
    updateRun: (mutate: (current: ProjectRunRecord) => ProjectRunRecord) => Promise<void>,
    appendLog: (level: 'info' | 'warning' | 'error', message: string) => Promise<void>,
    failedSubtaskTitles: string[],
    fileAttribution: Map<string, Set<string>>,
    getLastImpactSnapshot: () => Map<string, { signature: string; relativePath: string; uri: vscode.Uri }>,
    setLastImpactSnapshot: (snapshot: Map<string, { signature: string; relativePath: string; uri: vscode.Uri }>) => void,
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
        await appendLog(
          'info',
          `Batch ${update.batchIndex}/${update.totalBatches} started: ${update.subTaskIds.join(', ') || 'no subtasks'}.`,
        );
        return;
      case 'subtask-start':
        this.liveStatus = `Running ${update.title}`;
        await appendLog('info', `Started ${update.title}.`);
        return;
      case 'subtask-done': {
        if (update.result.status === 'failed') {
          failedSubtaskTitles.push(update.result.title);
        }
        await updateRun(run => ({
          ...run,
          completedSubtaskCount: update.completed,
          totalSubtaskCount: update.total,
          failedSubtaskTitles: [...failedSubtaskTitles],
        }));
        const impact = await collectWorkspaceChangesSince(getLastImpactSnapshot());
        setLastImpactSnapshot(impact.snapshot);
        addFileAttribution(fileAttribution, update.result.title, impact.changedFiles);
        await appendLog(
          update.result.status === 'failed' ? 'warning' : 'info',
          `${update.result.title} ${update.result.status === 'failed' ? 'failed' : 'completed'} ` +
          `(${update.completed}/${update.total}).` +
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
    const runs = this.atlas.projectRunHistory.listRuns(20);
    const selectedRun = this.selectedRunId
      ? runs.find(run => run.id === this.selectedRunId)
      : runs[0];

    await this.panel.webview.postMessage({
      type: 'state',
      payload: {
        liveStatus: this.liveStatus,
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
        <p>Review a plan before execution, monitor live subtask batches, and inspect durable run history.</p>
        <section>
          <h2>Review and Apply</h2>
          <textarea id="goalInput" rows="4" placeholder="Describe the project goal you want AtlasMind to plan and execute..."></textarea>
          <div class="row">
            <button id="previewGoal" class="primary-btn">Preview Plan</button>
            <button id="executePreview">Execute Reviewed Plan</button>
            <button id="refreshRuns">Refresh Runs</button>
          </div>
          <div id="liveStatus" class="status-label"></div>
          <div id="previewMeta" class="meta-card"></div>
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
          <ul id="selectedRunFiles" class="attachment-list"></ul>
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
        .run-list {
          display: grid;
          gap: 10px;
        }
        .run-card {
          border: 1px solid var(--vscode-widget-border, #444);
          padding: 10px;
          background: var(--vscode-input-background);
        }
        .run-card h3 {
          margin: 0 0 6px;
          font-size: 1em;
        }
        .run-card button {
          margin-right: 8px;
          margin-top: 8px;
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
        .file-link {
          color: var(--vscode-textLink-foreground);
          text-decoration: underline;
          cursor: pointer;
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
  if (message.type === 'executePreview' || message.type === 'refreshRuns' || message.type === 'openSourceControl' || message.type === 'rollbackLastCheckpoint') {
    return true;
  }

  return (
    message.type === 'previewGoal'
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
    subTasks: preview.subTasks.map(task => ({
      id: task.id,
      title: task.title,
      role: task.role,
      dependsOn: task.dependsOn,
    })),
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
  const executeButton = document.getElementById('executePreview');
  const refreshButton = document.getElementById('refreshRuns');
  const openScmButton = document.getElementById('openScm');
  const rollbackButton = document.getElementById('rollbackCheckpoint');
  const liveStatus = document.getElementById('liveStatus');
  const previewMeta = document.getElementById('previewMeta');
  const previewRows = document.getElementById('previewRows');
  const liveLog = document.getElementById('liveLog');
  const runsList = document.getElementById('runsList');
  const selectedRun = document.getElementById('selectedRun');
  const selectedRunFiles = document.getElementById('selectedRunFiles');

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderPreview(preview) {
    if (!preview) {
      if (previewMeta) { previewMeta.textContent = 'No preview generated yet.'; }
      if (previewRows) { previewRows.innerHTML = ''; }
      return;
    }
    if (previewMeta) {
      previewMeta.textContent =
        'Goal: ' + preview.goal + '\n' +
        'Estimated files: ~' + preview.estimatedFiles + '\n' +
        'Subtasks: ' + preview.subTasks.length + '\n' +
        (preview.requiresApproval
          ? 'Approval note: high-impact run (threshold ' + preview.approvalThreshold + ' files).'
          : 'Approval note: safe to execute from the reviewed plan.');
    }
    if (previewRows) {
      previewRows.innerHTML = preview.subTasks.map(task => {
        const dependsOn = Array.isArray(task.dependsOn) && task.dependsOn.length > 0 ? task.dependsOn.join(', ') : '—';
        return '<tr>' +
          '<td>' + escapeHtml(task.id) + '</td>' +
          '<td>' + escapeHtml(task.title) + '</td>' +
          '<td>' + escapeHtml(task.role) + '</td>' +
          '<td>' + escapeHtml(dependsOn) + '</td>' +
          '</tr>';
      }).join('');
    }
  }

  function renderRunCards(runs) {
    if (!runsList) {
      return;
    }
    if (!Array.isArray(runs) || runs.length === 0) {
      runsList.innerHTML = '<div class="run-card">No project runs recorded yet.</div>';
      return;
    }
    runsList.innerHTML = runs.map(run => {
      const failed = Array.isArray(run.failedSubtaskTitles) && run.failedSubtaskTitles.length > 0
        ? '<div>Failures: ' + escapeHtml(run.failedSubtaskTitles.join(', ')) + '</div>'
        : '';
      const reportButton = run.reportPath
        ? '<button data-action="open-report" data-run-report="' + escapeHtml(run.reportPath) + '">Open Report</button>'
        : '';
      return '<div class="run-card">' +
        '<h3>' + escapeHtml(run.goal) + '<span class="status-badge">' + escapeHtml(run.status) + '</span></h3>' +
        '<div>Updated: ' + escapeHtml(run.updatedAt) + '</div>' +
        '<div>Subtasks: ' + escapeHtml(run.completedSubtaskCount) + '/' + escapeHtml(run.totalSubtaskCount) + '</div>' +
        '<div>Estimated files: ~' + escapeHtml(run.estimatedFiles) + '</div>' +
        failed +
        '<button data-action="select-run" data-run-id="' + escapeHtml(run.id) + '">Inspect Run</button>' +
        reportButton +
        '</div>';
    }).join('');
  }

  function renderSelectedRun(run) {
    if (!selectedRun || !selectedRunFiles) {
      return;
    }
    if (!run) {
      selectedRun.textContent = 'Select a run to inspect it.';
      selectedRunFiles.innerHTML = '';
      return;
    }
    selectedRun.textContent =
      'Goal: ' + run.goal + '\n' +
      'Status: ' + run.status + '\n' +
      'Subtasks: ' + run.completedSubtaskCount + '/' + run.totalSubtaskCount + '\n' +
      'Batches: ' + (run.totalBatches > 0 ? run.currentBatch + '/' + run.totalBatches : 'n/a') + '\n' +
      'Changed files: ' + run.changeSummary;
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
    (Array.isArray(run.logs) ? run.logs : []).forEach(log => {
      if (!liveLog) {
        return;
      }
      liveLog.innerHTML = (run.logs || []).slice(-12).map(entry => '<li>' + escapeHtml(entry.message) + '</li>').join('');
    });
  }

  if (previewButton) {
    previewButton.addEventListener('click', () => {
      const goal = goalInput instanceof HTMLTextAreaElement ? goalInput.value : '';
      vscode.postMessage({ type: 'previewGoal', payload: goal });
    });
  }
  if (executeButton) {
    executeButton.addEventListener('click', () => vscode.postMessage({ type: 'executePreview' }));
  }
  if (refreshButton) {
    refreshButton.addEventListener('click', () => vscode.postMessage({ type: 'refreshRuns' }));
  }
  if (openScmButton) {
    openScmButton.addEventListener('click', () => vscode.postMessage({ type: 'openSourceControl' }));
  }
  if (rollbackButton) {
    rollbackButton.addEventListener('click', () => vscode.postMessage({ type: 'rollbackLastCheckpoint' }));
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

  window.addEventListener('message', event => {
    const message = event.data;
    if (!message || message.type !== 'state') {
      return;
    }
    const payload = message.payload || {};
    if (liveStatus) {
      liveStatus.textContent = String(payload.liveStatus || 'Idle');
    }
    renderPreview(payload.preview || null);
    renderRunCards(payload.runs || []);
    renderSelectedRun(payload.selectedRun || null);
  });
})();`;
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