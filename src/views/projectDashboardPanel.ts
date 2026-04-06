import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AtlasMindContext } from '../extension.js';
import { getWebviewHtmlShell } from './webviewUtils.js';

const execFileAsync = promisify(execFile);
const PROJECT_DASHBOARD_VIEW_TYPE = 'atlasmind.projectDashboard';
const MAX_BRANCHES = 10;
const MAX_COMMITS = 10;
const MAX_RECENT_FILES = 8;
const MAX_RECENT_RUNS = 8;
const MAX_RECENT_SESSIONS = 8;
const SERIES_DAY_RANGE = 90;
const ALLOWED_DASHBOARD_COMMANDS = new Set([
  'atlasmind.openChatView',
  'atlasmind.openChatPanel',
  'atlasmind.openModelProviders',
  'atlasmind.openProjectRunCenter',
  'atlasmind.openSettingsProject',
  'atlasmind.openSettingsSafety',
  'atlasmind.openToolWebhooks',
  'atlasmind.openAgentPanel',
  'atlasmind.toggleAutopilot',
  'workbench.view.scm',
]);
const EXPECTED_SSOT_DIRECTORIES = [
  'agents',
  'analysis',
  'architecture',
  'decisions',
  'domain',
  'ideas',
  'index',
  'misadventures',
  'operations',
  'roadmap',
  'skills',
];

type ProjectDashboardMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'openCommand'; payload: string }
  | { type: 'openFile'; payload: string }
  | { type: 'openRun'; payload: string }
  | { type: 'openSession'; payload: string };

type Tone = 'accent' | 'good' | 'warn' | 'critical' | 'neutral';

interface DashboardStat {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: Tone;
  pageTarget?: DashboardPageId;
  command?: string;
}

type DashboardPageId = 'overview' | 'repo' | 'runtime' | 'ssot' | 'security' | 'delivery';

interface DashboardSeriesPoint {
  date: string;
  label: string;
  value: number;
}

interface DashboardBranch {
  name: string;
  lastCommitAt: string;
  lastCommitRelative: string;
  subject: string;
  upstream?: string;
  current: boolean;
}

interface DashboardCommit {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  committedAt: string;
  committedRelative: string;
}

interface DashboardWorkflow {
  name: string;
  path: string;
  triggers: string[];
  lastModified: string;
}

interface DashboardRunSummary {
  id: string;
  goal: string;
  status: string;
  updatedAt: string;
  updatedRelative: string;
  progressLabel: string;
}

interface DashboardSessionSummary {
  id: string;
  title: string;
  turnCount: number;
  updatedAt: string;
  updatedRelative: string;
  active: boolean;
}

interface DashboardRecentFile {
  path: string;
  lastModified: string;
  lastModifiedRelative: string;
}

interface DashboardSnapshot {
  generatedAt: string;
  workspaceName: string;
  workspaceRootLabel: string;
  repositoryLabel: string;
  currentBranch: string;
  healthScore: number;
  healthSummary: string;
  stats: DashboardStat[];
  charts: {
    commits: DashboardSeriesPoint[];
    runs: DashboardSeriesPoint[];
    memory: DashboardSeriesPoint[];
  };
  repo: {
    dirty: boolean;
    ahead: number;
    behind: number;
    staged: number;
    modified: number;
    untracked: number;
    branchCount: number;
    branches: DashboardBranch[];
    commits: DashboardCommit[];
  };
  runtime: {
    enabledAgents: number;
    totalAgents: number;
    enabledSkills: number;
    totalSkills: number;
    healthyProviders: number;
    totalProviders: number;
    enabledModels: number;
    totalModels: number;
    sessionCount: number;
    projectRunCount: number;
    activeSessionId: string;
    autopilot: boolean;
    totalCostUsd: number;
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    runs: DashboardRunSummary[];
    sessions: DashboardSessionSummary[];
  };
  ssot: {
    path: string;
    totalEntries: number;
    totalFilesOnDisk: number;
    coveragePercent: number;
    coverage: Array<{ name: string; count: number; present: boolean }>;
    recentFiles: DashboardRecentFile[];
    warnedEntries: number;
    blockedEntries: number;
  };
  security: {
    toolApprovalMode: string;
    allowTerminalWrite: boolean;
    autoVerifyAfterWrite: boolean;
    autoVerifyScripts: string;
    securityPolicyPresent: boolean;
    codeownersPresent: boolean;
    prTemplatePresent: boolean;
    issueTemplateCount: number;
    changelogPresent: boolean;
    governanceProviders: string[];
  };
  delivery: {
    packageVersion: string;
    dependencyCount: number;
    devDependencyCount: number;
    scriptCount: number;
    keyScripts: string[];
    workflows: DashboardWorkflow[];
    coverageFolderPresent: boolean;
    ciSignals: Array<{ label: string; ok: boolean }>;
    reviewReadiness: Array<{ label: string; ok: boolean }>;
  };
  quickActions: Array<{ label: string; description: string; command?: string; filePath?: string; pageTarget?: DashboardPageId }>;
}

interface GitSnapshot {
  currentBranch: string;
  ahead: number;
  behind: number;
  staged: number;
  modified: number;
  untracked: number;
  dirty: boolean;
  branches: DashboardBranch[];
  commits: DashboardCommit[];
  commitDates: string[];
}

interface PackageSnapshot {
  version: string;
  dependencyCount: number;
  devDependencyCount: number;
  scriptCount: number;
  keyScripts: string[];
}

interface SsotDiskSnapshot {
  totalFiles: number;
  coverage: Array<{ name: string; count: number; present: boolean }>;
  recentFiles: DashboardRecentFile[];
}

export class ProjectDashboardPanel {
  public static currentPanel: ProjectDashboardPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  public static createOrShow(context: vscode.ExtensionContext, atlas: AtlasMindContext): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (ProjectDashboardPanel.currentPanel) {
      ProjectDashboardPanel.currentPanel.panel.reveal(column);
      void ProjectDashboardPanel.currentPanel.syncState();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      PROJECT_DASHBOARD_VIEW_TYPE,
      'AtlasMind Project Dashboard',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );

    ProjectDashboardPanel.currentPanel = new ProjectDashboardPanel(panel, context, atlas);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly atlas: AtlasMindContext,
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(message => {
      void this.handleMessage(message);
    }, null, this.disposables);

    this.atlas.agentsRefresh.event(() => { void this.syncState(); }, null, this.disposables);
    this.atlas.skillsRefresh.event(() => { void this.syncState(); }, null, this.disposables);
    this.atlas.modelsRefresh.event(() => { void this.syncState(); }, null, this.disposables);
    this.atlas.projectRunsRefresh.event(() => { void this.syncState(); }, null, this.disposables);
    this.atlas.memoryRefresh.event(() => { void this.syncState(); }, null, this.disposables);
    this.atlas.sessionConversation.onDidChange(() => { void this.syncState(); }, null, this.disposables);
    this.disposables.push({
      dispose: this.atlas.toolApprovalManager.onAutopilotChange(() => {
        void this.syncState();
      }),
    });

    void this.syncState();
  }

  private dispose(): void {
    ProjectDashboardPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isProjectDashboardMessage(message)) {
      return;
    }

    switch (message.type) {
      case 'ready':
      case 'refresh':
        await this.syncState();
        return;
      case 'openCommand':
        if (ALLOWED_DASHBOARD_COMMANDS.has(message.payload)) {
          await vscode.commands.executeCommand(message.payload);
        }
        return;
      case 'openFile':
        await this.openWorkspaceRelativeFile(message.payload);
        return;
      case 'openRun':
        if (message.payload.trim().length > 0) {
          await vscode.commands.executeCommand('atlasmind.openProjectRunCenter', message.payload.trim());
        }
        return;
      case 'openSession':
        if (message.payload.trim().length > 0) {
          await vscode.commands.executeCommand('atlasmind.openChatView', message.payload.trim());
        }
        return;
    }
  }

  private async openWorkspaceRelativeFile(relativePath: string): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return;
    }

    const target = resolveWorkspacePath(workspaceRoot, relativePath);
    if (!target) {
      return;
    }

    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
      await vscode.window.showTextDocument(document, { preview: false });
    } catch {
      // Ignore invalid or missing targets.
    }
  }

  private async syncState(): Promise<void> {
    const snapshot = await collectDashboardSnapshot(this.atlas);
    await this.panel.webview.postMessage({ type: 'state', payload: snapshot });
  }

  private getHtml(): string {
    const scriptUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'projectDashboard.js'));
    return getWebviewHtmlShell({
      title: 'AtlasMind Project Dashboard',
      cspSource: this.panel.webview.cspSource,
      scriptUri: scriptUri.toString(),
      bodyContent: `
        <div class="dashboard-shell">
          <div class="dashboard-topbar">
            <div>
              <p class="dashboard-kicker">Command center</p>
              <h1>Project Dashboard</h1>
              <p class="dashboard-copy">Operational visibility across workspace health, AtlasMind runtime state, SSOT coverage, security posture, delivery workflow, and review readiness.</p>
            </div>
            <div class="dashboard-actions" role="group" aria-label="Dashboard actions">
              <button id="dashboard-refresh" class="dashboard-button dashboard-button-ghost" type="button">Refresh</button>
            </div>
          </div>
          <div id="dashboard-root" class="dashboard-root" aria-live="polite">
            <div class="dashboard-loading">Loading dashboard signals…</div>
          </div>
        </div>
      `,
      extraCss: DASHBOARD_CSS,
    });
  }
}

export function isProjectDashboardMessage(message: unknown): message is ProjectDashboardMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }

  const candidate = message as Record<string, unknown>;
  if (candidate['type'] === 'ready' || candidate['type'] === 'refresh') {
    return true;
  }

  if ((candidate['type'] === 'openCommand' || candidate['type'] === 'openFile' || candidate['type'] === 'openRun' || candidate['type'] === 'openSession') && typeof candidate['payload'] === 'string') {
    return candidate['payload'].trim().length > 0;
  }

  return false;
}

async function collectDashboardSnapshot(atlas: AtlasMindContext): Promise<DashboardSnapshot> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name ?? 'No Workspace';
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const ssotPath = normalizeSsotPath(configuration.get<string>('ssotPath', 'project_memory'));
  const workspaceRootLabel = workspaceRoot ? path.basename(workspaceRoot) : 'No folder open';

  const [gitSnapshot, packageSnapshot, workflowSnapshot, ssotSnapshot] = await Promise.all([
    collectGitSnapshot(workspaceRoot),
    collectPackageSnapshot(workspaceRoot),
    collectWorkflowSnapshot(workspaceRoot),
    collectSsotSnapshot(workspaceRoot, ssotPath),
  ]);

  const providers = atlas.modelRouter.listProviders();
  const totalProviders = providers.length;
  const healthyProviders = providers.filter(provider => atlas.modelRouter.isProviderHealthy(provider.id)).length;
  const enabledModels = providers.reduce((total, provider) => total + provider.models.filter(model => model.enabled !== false).length, 0);
  const totalModels = providers.reduce((total, provider) => total + provider.models.length, 0);
  const agents = atlas.agentRegistry.listAgents();
  const enabledAgents = agents.filter(agent => atlas.agentRegistry.isEnabled(agent.id)).length;
  const skills = atlas.skillsRegistry.listSkills();
  const enabledSkills = skills.filter(skill => atlas.skillsRegistry.isEnabled(skill.id)).length;
  const sessions = atlas.sessionConversation.listSessions();
  const runs = await atlas.projectRunHistory.listRunsAsync(40);
  const costSummary = atlas.costTracker.getSummary();
  const costRecords = atlas.costTracker.getRecords();
  const memoryEntries = atlas.memoryManager.listEntries();
  const scanResults = atlas.memoryManager.getScanResults();
  const warnedEntries = [...scanResults.values()].filter(result => result.status === 'warned').length;
  const blockedEntries = [...scanResults.values()].filter(result => result.status === 'blocked').length;
  const governanceProviders = detectGovernanceProviders(workspaceRoot);
  const toolApprovalMode = configuration.get<string>('toolApprovalMode', 'ask-on-write');
  const allowTerminalWrite = configuration.get<boolean>('allowTerminalWrite', false);
  const autoVerifyAfterWrite = configuration.get<boolean>('autoVerifyAfterWrite', false);
  const autoVerifyScripts = configuration.get<string>('autoVerifyScripts', '');
  const securityPolicyPresent = await fileExists(workspaceRoot ? path.join(workspaceRoot, 'SECURITY.md') : undefined);
  const changelogPresent = await fileExists(workspaceRoot ? path.join(workspaceRoot, 'CHANGELOG.md') : undefined);
  const codeownersPresent = await fileExists(workspaceRoot ? path.join(workspaceRoot, '.github', 'CODEOWNERS') : undefined);
  const prTemplatePresent = await fileExists(workspaceRoot ? path.join(workspaceRoot, '.github', 'pull_request_template.md') : undefined);
  const issueTemplateCount = await countIssueTemplates(workspaceRoot);
  const autopilot = atlas.toolApprovalManager.isAutopilot();
  const ssotOpenTarget = ssotSnapshot.recentFiles[0]?.path ?? `${ssotPath}/project_soul.md`;
  const repoLabel = workspaceRoot && gitSnapshot.currentBranch !== 'Not a git repository'
    ? `${workspaceRootLabel} • ${gitSnapshot.currentBranch}`
    : workspaceRootLabel;
  const quickActions: DashboardSnapshot['quickActions'] = [
    { label: 'Open Chat View', description: 'Jump into the embedded Atlas workspace.', command: 'atlasmind.openChatView', pageTarget: 'runtime' as DashboardPageId },
    { label: 'Project Run Center', description: 'Inspect recent autonomous runs and approval state.', command: 'atlasmind.openProjectRunCenter', pageTarget: 'runtime' as DashboardPageId },
    { label: 'Model Providers', description: 'Check routed model health and configuration.', command: 'atlasmind.openModelProviders', pageTarget: 'runtime' as DashboardPageId },
    { label: 'Safety Settings', description: 'Review approvals, verification, and terminal policy.', command: 'atlasmind.openSettingsSafety', pageTarget: 'security' as DashboardPageId },
    { label: 'Project Settings', description: 'Adjust project-run thresholds and governance defaults.', command: 'atlasmind.openSettingsProject', pageTarget: 'delivery' as DashboardPageId },
    { label: 'Security Policy', description: 'Open the repository security policy.', filePath: 'SECURITY.md', pageTarget: 'security' as DashboardPageId },
    { label: 'Workflow File', description: 'Inspect the primary CI workflow.', filePath: workflowSnapshot[0]?.path, pageTarget: 'delivery' as DashboardPageId },
    { label: 'SSOT Entry', description: 'Open the most recently touched SSOT document.', filePath: ssotOpenTarget, pageTarget: 'ssot' as DashboardPageId },
  ].filter(action => typeof action.filePath !== 'undefined' ? action.filePath.trim().length > 0 : true);

  const stats: DashboardStat[] = [
    {
      id: 'health',
      label: 'Operational Health',
      value: `${computeHealthScore({
        securityPolicyPresent,
        codeownersPresent,
        prTemplatePresent,
        workflowCount: workflowSnapshot.length,
        dirty: gitSnapshot.dirty,
        ssotCoveragePercent: ssotSnapshot.coveragePercent,
        blockedEntries,
        autopilot,
        governanceProviderCount: governanceProviders.length,
      })}`,
      detail: 'Composite score across delivery, governance, repo hygiene, and memory coverage.',
      tone: blockedEntries > 0 || autopilot ? 'warn' : 'accent',
      pageTarget: 'overview',
    },
    {
      id: 'branch',
      label: 'Branch State',
      value: gitSnapshot.currentBranch,
      detail: `${gitSnapshot.staged + gitSnapshot.modified + gitSnapshot.untracked} pending file changes, ${gitSnapshot.ahead} ahead / ${gitSnapshot.behind} behind.`,
      tone: gitSnapshot.dirty ? 'warn' : 'good',
      pageTarget: 'repo',
      command: 'workbench.view.scm',
    },
    {
      id: 'runtime',
      label: 'Atlas Runtime',
      value: `${enabledAgents}/${agents.length} agents`,
      detail: `${healthyProviders}/${totalProviders} providers healthy, ${enabledSkills}/${skills.length} skills enabled.`,
      tone: healthyProviders === totalProviders ? 'good' : 'warn',
      pageTarget: 'runtime',
      command: 'atlasmind.openAgentPanel',
    },
    {
      id: 'ssot',
      label: 'SSOT Coverage',
      value: `${ssotSnapshot.coveragePercent}%`,
      detail: `${memoryEntries.length} indexed entries, ${warnedEntries} warned, ${blockedEntries} blocked.`,
      tone: blockedEntries > 0 ? 'critical' : ssotSnapshot.coveragePercent >= 80 ? 'good' : 'warn',
      pageTarget: 'ssot',
    },
    {
      id: 'security',
      label: 'Security Posture',
      value: toolApprovalMode,
      detail: `${autoVerifyAfterWrite ? 'Post-write verification on' : 'Verification off'} • terminal writes ${allowTerminalWrite ? 'enabled' : 'blocked'}.`,
      tone: autopilot || allowTerminalWrite ? 'warn' : 'good',
      pageTarget: 'security',
      command: 'atlasmind.openSettingsSafety',
    },
    {
      id: 'delivery',
      label: 'Delivery Flow',
      value: `${workflowSnapshot.length} workflow${workflowSnapshot.length === 1 ? '' : 's'}`,
      detail: `${packageSnapshot.keyScripts.length} critical scripts, ${governanceProviders.length} governance provider${governanceProviders.length === 1 ? '' : 's'}.`,
      tone: workflowSnapshot.length > 0 ? 'good' : 'warn',
      pageTarget: 'delivery',
    },
  ];

  const healthScore = Number(stats.find(stat => stat.id === 'health')?.value ?? '0');

  return {
    generatedAt: new Date().toISOString(),
    workspaceName,
    workspaceRootLabel,
    repositoryLabel: repoLabel,
    currentBranch: gitSnapshot.currentBranch,
    healthScore,
    healthSummary: buildHealthSummary({ healthScore, blockedEntries, autopilot, dirty: gitSnapshot.dirty, workflowCount: workflowSnapshot.length }),
    stats,
    charts: {
      commits: buildDailySeries(gitSnapshot.commitDates, SERIES_DAY_RANGE),
      runs: buildDailySeries(runs.map(run => run.updatedAt), SERIES_DAY_RANGE),
      memory: buildDailySeries(memoryEntries.map(entry => entry.lastModified), SERIES_DAY_RANGE),
    },
    repo: {
      dirty: gitSnapshot.dirty,
      ahead: gitSnapshot.ahead,
      behind: gitSnapshot.behind,
      staged: gitSnapshot.staged,
      modified: gitSnapshot.modified,
      untracked: gitSnapshot.untracked,
      branchCount: gitSnapshot.branches.length,
      branches: gitSnapshot.branches,
      commits: gitSnapshot.commits,
    },
    runtime: {
      enabledAgents,
      totalAgents: agents.length,
      enabledSkills,
      totalSkills: skills.length,
      healthyProviders,
      totalProviders,
      enabledModels,
      totalModels,
      sessionCount: sessions.length,
      projectRunCount: runs.length,
      activeSessionId: atlas.sessionConversation.getActiveSessionId(),
      autopilot,
      totalCostUsd: costSummary.totalCostUsd,
      totalRequests: costSummary.totalRequests,
      totalInputTokens: costSummary.totalInputTokens,
      totalOutputTokens: costSummary.totalOutputTokens,
      runs: runs.slice(0, MAX_RECENT_RUNS).map(run => ({
        id: run.id,
        goal: run.goal,
        status: run.status,
        updatedAt: run.updatedAt,
        updatedRelative: formatRelativeDate(run.updatedAt),
        progressLabel: `${run.completedSubtaskCount}/${run.totalSubtaskCount} subtasks`,
      })),
      sessions: sessions.slice(0, MAX_RECENT_SESSIONS).map(session => ({
        id: session.id,
        title: session.title,
        turnCount: session.turnCount,
        updatedAt: session.updatedAt,
        updatedRelative: formatRelativeDate(session.updatedAt),
        active: session.isActive,
      })),
    },
    ssot: {
      path: ssotPath,
      totalEntries: memoryEntries.length,
      totalFilesOnDisk: ssotSnapshot.totalFiles,
      coveragePercent: ssotSnapshot.coveragePercent,
      coverage: ssotSnapshot.coverage,
      recentFiles: ssotSnapshot.recentFiles,
      warnedEntries,
      blockedEntries,
    },
    security: {
      toolApprovalMode,
      allowTerminalWrite,
      autoVerifyAfterWrite,
      autoVerifyScripts: autoVerifyScripts.trim() || 'No verification commands configured.',
      securityPolicyPresent,
      codeownersPresent,
      prTemplatePresent,
      issueTemplateCount,
      changelogPresent,
      governanceProviders,
    },
    delivery: {
      packageVersion: packageSnapshot.version,
      dependencyCount: packageSnapshot.dependencyCount,
      devDependencyCount: packageSnapshot.devDependencyCount,
      scriptCount: packageSnapshot.scriptCount,
      keyScripts: packageSnapshot.keyScripts,
      workflows: workflowSnapshot,
      coverageFolderPresent: await fileExists(workspaceRoot ? path.join(workspaceRoot, 'coverage') : undefined),
      ciSignals: [
        { label: 'Compile script', ok: packageSnapshot.keyScripts.includes('compile') },
        { label: 'Lint script', ok: packageSnapshot.keyScripts.includes('lint') },
        { label: 'Test script', ok: packageSnapshot.keyScripts.includes('test') },
        { label: 'Workflow files', ok: workflowSnapshot.length > 0 },
      ],
      reviewReadiness: [
        { label: 'PR template', ok: prTemplatePresent },
        { label: 'CODEOWNERS', ok: codeownersPresent },
        { label: 'Issue templates', ok: issueTemplateCount > 0 },
        { label: 'CHANGELOG', ok: changelogPresent },
      ],
    },
    quickActions,
  };
}

async function collectGitSnapshot(workspaceRoot: string | undefined): Promise<GitSnapshot> {
  if (!workspaceRoot) {
    return emptyGitSnapshot();
  }

  try {
    await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: workspaceRoot, windowsHide: true });
  } catch {
    return emptyGitSnapshot();
  }

  const [statusOutput, branchOutput, commitOutput] = await Promise.all([
    runGit(workspaceRoot, ['status', '--short', '--branch']),
    runGit(workspaceRoot, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)|%(committerdate:iso8601)|%(upstream:short)|%(subject)', 'refs/heads']),
    runGit(workspaceRoot, ['log', '--date=iso-strict', '--pretty=format:%H|%ad|%an|%s', `-n${MAX_COMMITS}`]),
  ]);

  const statusLines = statusOutput.split(/\r?\n/).filter(Boolean);
  const branchLine = statusLines[0] ?? '';
  const currentBranch = parseCurrentBranch(branchLine);
  const { ahead, behind } = await collectAheadBehind(workspaceRoot);
  const staged = statusLines.slice(1).filter(line => line.length >= 1 && line[0] !== ' ' && line[0] !== '?').length;
  const modified = statusLines.slice(1).filter(line => line.length >= 2 && line[1] !== ' ' && line[0] !== '?').length;
  const untracked = statusLines.slice(1).filter(line => line.startsWith('??')).length;
  const dirty = staged + modified + untracked > 0;

  const branches = branchOutput
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, MAX_BRANCHES)
    .map(line => {
      const [name = '', lastCommitAt = '', upstream = '', subject = ''] = line.split('|');
      return {
        name,
        lastCommitAt,
        lastCommitRelative: formatRelativeDate(lastCommitAt),
        subject,
        upstream: upstream || undefined,
        current: name === currentBranch,
      } satisfies DashboardBranch;
    });

  const commits = commitOutput
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const [hash = '', committedAt = '', author = '', ...subjectParts] = line.split('|');
      const subject = subjectParts.join('|');
      return {
        hash,
        shortHash: hash.slice(0, 7),
        subject,
        author,
        committedAt,
        committedRelative: formatRelativeDate(committedAt),
      } satisfies DashboardCommit;
    });

  const commitDates = (await runGit(workspaceRoot, ['log', `--since=${SERIES_DAY_RANGE}.days`, '--date=short', '--pretty=format:%ad']))
    .split(/\r?\n/)
    .filter(Boolean);

  return {
    currentBranch,
    ahead,
    behind,
    staged,
    modified,
    untracked,
    dirty,
    branches,
    commits,
    commitDates,
  };
}

async function collectAheadBehind(workspaceRoot: string): Promise<{ ahead: number; behind: number }> {
  try {
    const upstream = await runGit(workspaceRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
    if (upstream.trim().length === 0) {
      return { ahead: 0, behind: 0 };
    }
    const output = await runGit(workspaceRoot, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
    const [aheadText = '0', behindText = '0'] = output.trim().split(/\s+/);
    return {
      ahead: Number(aheadText) || 0,
      behind: Number(behindText) || 0,
    };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

async function collectPackageSnapshot(workspaceRoot: string | undefined): Promise<PackageSnapshot> {
  if (!workspaceRoot) {
    return {
      version: 'N/A',
      dependencyCount: 0,
      devDependencyCount: 0,
      scriptCount: 0,
      keyScripts: [],
    };
  }

  const packagePath = path.join(workspaceRoot, 'package.json');
  try {
    const raw = await fs.readFile(packagePath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const dependencies = asStringMap(parsed['dependencies']);
    const devDependencies = asStringMap(parsed['devDependencies']);
    const scripts = asStringMap(parsed['scripts']);
    const keyScripts = ['compile', 'watch', 'lint', 'test', 'test:coverage', 'package:vsix', 'publish:pre-release']
      .filter(script => typeof scripts[script] === 'string');
    return {
      version: typeof parsed['version'] === 'string' ? parsed['version'] : 'N/A',
      dependencyCount: Object.keys(dependencies).length,
      devDependencyCount: Object.keys(devDependencies).length,
      scriptCount: Object.keys(scripts).length,
      keyScripts,
    };
  } catch {
    return {
      version: 'N/A',
      dependencyCount: 0,
      devDependencyCount: 0,
      scriptCount: 0,
      keyScripts: [],
    };
  }
}

async function collectWorkflowSnapshot(workspaceRoot: string | undefined): Promise<DashboardWorkflow[]> {
  if (!workspaceRoot) {
    return [];
  }

  const workflowsDir = path.join(workspaceRoot, '.github', 'workflows');
  try {
    const entries = await fs.readdir(workflowsDir, { withFileTypes: true });
    const files = entries.filter(entry => entry.isFile() && /\.ya?ml$/i.test(entry.name));
    const workflows = await Promise.all(files.map(async entry => {
      const filePath = path.join(workflowsDir, entry.name);
      const [text, stat] = await Promise.all([
        fs.readFile(filePath, 'utf-8'),
        fs.stat(filePath),
      ]);
      const nameMatch = text.match(/^name:\s*(.+)$/m);
      const triggers = ['push', 'pull_request', 'workflow_dispatch', 'schedule', 'release']
        .filter(trigger => new RegExp(`(^|\\n)\\s*${trigger}:`, 'm').test(text) || new RegExp(`on:\s*\[[^\]]*${trigger}[^\]]*\]`, 'm').test(text));
      return {
        name: (nameMatch?.[1] ?? entry.name).trim(),
        path: toWorkspaceRelative(workspaceRoot, filePath),
        triggers,
        lastModified: new Date(stat.mtime).toISOString(),
      } satisfies DashboardWorkflow;
    }));
    return workflows.sort((left, right) => right.lastModified.localeCompare(left.lastModified));
  } catch {
    return [];
  }
}

async function collectSsotSnapshot(workspaceRoot: string | undefined, ssotPath: string): Promise<SsotDiskSnapshot & { coveragePercent: number }> {
  if (!workspaceRoot) {
    const coverage = EXPECTED_SSOT_DIRECTORIES.map(name => ({ name, count: 0, present: false }));
    return { totalFiles: 0, coverage, coveragePercent: 0, recentFiles: [] };
  }

  const absoluteSsotPath = path.join(workspaceRoot, ssotPath);
  const coverage = await Promise.all(EXPECTED_SSOT_DIRECTORIES.map(async name => {
    const directoryPath = path.join(absoluteSsotPath, name);
    const count = await countFiles(directoryPath);
    return {
      name,
      count,
      present: count > 0 || await fileExists(directoryPath),
    };
  }));
  const recentFiles = await collectRecentFiles(absoluteSsotPath, workspaceRoot);
  const totalFiles = coverage.reduce((total, entry) => total + entry.count, 0);
  const presentCount = coverage.filter(entry => entry.present).length;
  return {
    totalFiles,
    coverage,
    coveragePercent: Math.round((presentCount / EXPECTED_SSOT_DIRECTORIES.length) * 100),
    recentFiles,
  };
}

async function collectRecentFiles(directoryPath: string, workspaceRoot: string): Promise<DashboardRecentFile[]> {
  const files: Array<{ filePath: string; mtime: number }> = [];
  await walkFiles(directoryPath, async filePath => {
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile()) {
        files.push({ filePath, mtime: stat.mtimeMs });
      }
    } catch {
      // Ignore disappearing files.
    }
  });
  return files
    .sort((left, right) => right.mtime - left.mtime)
    .slice(0, MAX_RECENT_FILES)
    .map(file => ({
      path: toWorkspaceRelative(workspaceRoot, file.filePath),
      lastModified: new Date(file.mtime).toISOString(),
      lastModifiedRelative: formatRelativeDate(new Date(file.mtime).toISOString()),
    }));
}

async function walkFiles(directoryPath: string, visitor: (filePath: string) => Promise<void>): Promise<void> {
  try {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    await Promise.all(entries.map(async entry => {
      const fullPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        await walkFiles(fullPath, visitor);
        return;
      }
      await visitor(fullPath);
    }));
  } catch {
    // Ignore missing directories.
  }
}

async function countFiles(directoryPath: string): Promise<number> {
  let total = 0;
  await walkFiles(directoryPath, async () => {
    total += 1;
  });
  return total;
}

function buildDailySeries(timestamps: string[], days: number): DashboardSeriesPoint[] {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const counts = new Map<string, number>();
  for (const timestamp of timestamps) {
    const isoDay = normalizeDateKey(timestamp);
    if (!isoDay) {
      continue;
    }
    counts.set(isoDay, (counts.get(isoDay) ?? 0) + 1);
  }

  const series: DashboardSeriesPoint[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(end);
    day.setDate(end.getDate() - offset);
    const key = day.toISOString().slice(0, 10);
    series.push({
      date: key,
      label: day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      value: counts.get(key) ?? 0,
    });
  }
  return series;
}

function computeHealthScore(input: {
  securityPolicyPresent: boolean;
  codeownersPresent: boolean;
  prTemplatePresent: boolean;
  workflowCount: number;
  dirty: boolean;
  ssotCoveragePercent: number;
  blockedEntries: number;
  autopilot: boolean;
  governanceProviderCount: number;
}): number {
  let score = 42;
  score += input.securityPolicyPresent ? 10 : 0;
  score += input.codeownersPresent ? 8 : 0;
  score += input.prTemplatePresent ? 6 : 0;
  score += input.workflowCount > 0 ? 10 : 0;
  score += Math.round(input.ssotCoveragePercent * 0.18);
  score += Math.min(10, input.governanceProviderCount * 4);
  score -= input.dirty ? 8 : 0;
  score -= input.blockedEntries > 0 ? 16 : 0;
  score -= input.autopilot ? 6 : 0;
  return Math.max(0, Math.min(100, score));
}

function buildHealthSummary(input: { healthScore: number; blockedEntries: number; autopilot: boolean; dirty: boolean; workflowCount: number }): string {
  if (input.blockedEntries > 0) {
    return 'Security scanning is actively excluding SSOT material from model context. Review blocked entries first.';
  }
  if (input.autopilot) {
    return 'Autopilot is enabled for this session. Review approval posture before executing write-capable workflows.';
  }
  if (input.dirty) {
    return 'The repo is carrying local changes. Review the current branch before widening delivery or review workflows.';
  }
  if (input.workflowCount === 0) {
    return 'No CI workflow files were detected. Delivery automation looks incomplete.';
  }
  if (input.healthScore >= 85) {
    return 'Project signals look healthy: governance, SSOT coverage, and delivery scaffolding are broadly in place.';
  }
  return 'Core signals are present, but governance, SSOT coverage, or delivery scaffolding still have visible gaps.';
}

function detectGovernanceProviders(workspaceRoot: string | undefined): string[] {
  if (!workspaceRoot) {
    return [];
  }

  const providers: string[] = [];
  if (pathExistsSync(path.join(workspaceRoot, '.github', 'dependabot.yml'))) {
    providers.push('Dependabot');
  }
  if (
    pathExistsSync(path.join(workspaceRoot, 'renovate.json')) ||
    pathExistsSync(path.join(workspaceRoot, 'renovate.json5')) ||
    pathExistsSync(path.join(workspaceRoot, '.github', 'renovate.json'))
  ) {
    providers.push('Renovate');
  }
  if (pathExistsSync(path.join(workspaceRoot, '.github', 'workflows', 'snyk-monitor.yml'))) {
    providers.push('Snyk');
  }
  if (pathExistsSync(path.join(workspaceRoot, 'azure-pipelines.yml'))) {
    providers.push('Azure DevOps');
  }
  return providers;
}

async function countIssueTemplates(workspaceRoot: string | undefined): Promise<number> {
  if (!workspaceRoot) {
    return 0;
  }
  try {
    const entries = await fs.readdir(path.join(workspaceRoot, '.github', 'ISSUE_TEMPLATE'), { withFileTypes: true });
    return entries.filter(entry => entry.isFile()).length;
  } catch {
    return 0;
  }
}

async function runGit(workspaceRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: workspaceRoot,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 4,
  });
  return stdout.trim();
}

function parseCurrentBranch(statusLine: string): string {
  const match = statusLine.match(/^##\s+([^\.\s]+)/);
  return match?.[1] ?? 'Detached';
}

function emptyGitSnapshot(): GitSnapshot {
  return {
    currentBranch: 'Not a git repository',
    ahead: 0,
    behind: 0,
    staged: 0,
    modified: 0,
    untracked: 0,
    dirty: false,
    branches: [],
    commits: [],
    commitDates: [],
  };
}

function normalizeSsotPath(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.replace(/\\/g, '/') : 'project_memory';
}

function normalizeDateKey(value: string): string | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString().slice(0, 10);
}

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }
  const deltaMs = Date.now() - date.getTime();
  const deltaDays = Math.floor(deltaMs / (1000 * 60 * 60 * 24));
  if (deltaDays <= 0) {
    return 'Today';
  }
  if (deltaDays === 1) {
    return '1 day ago';
  }
  if (deltaDays < 30) {
    return `${deltaDays} days ago`;
  }
  const deltaMonths = Math.floor(deltaDays / 30);
  if (deltaMonths === 1) {
    return '1 month ago';
  }
  if (deltaMonths < 12) {
    return `${deltaMonths} months ago`;
  }
  const deltaYears = Math.floor(deltaMonths / 12);
  return deltaYears === 1 ? '1 year ago' : `${deltaYears} years ago`;
}

async function fileExists(filePath: string | undefined): Promise<boolean> {
  if (!filePath) {
    return false;
  }
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function pathExistsSync(filePath: string): boolean {
  return existsSync(filePath);
}

function asStringMap(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') {
      result[key] = entry;
    }
  }
  return result;
}

function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string | undefined {
  const trimmed = relativePath.trim();
  if (trimmed.length === 0 || path.isAbsolute(trimmed)) {
    return undefined;
  }
  const resolved = path.resolve(workspaceRoot, trimmed);
  const normalizedRoot = path.resolve(workspaceRoot);
  return resolved.startsWith(normalizedRoot) ? resolved : undefined;
}

function toWorkspaceRelative(workspaceRoot: string, absolutePath: string): string {
  return path.relative(workspaceRoot, absolutePath).replace(/\\/g, '/');
}

const DASHBOARD_CSS = `
  :root {
    --dash-bg: radial-gradient(circle at top left, color-mix(in srgb, var(--vscode-button-background) 18%, transparent), transparent 40%), linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background) 86%, black 14%), var(--vscode-editor-background));
    --dash-panel: color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-editor-background)) 78%, transparent);
    --dash-panel-strong: color-mix(in srgb, var(--vscode-sideBar-background, var(--vscode-editor-background)) 88%, black 12%);
    --dash-border: color-mix(in srgb, var(--vscode-widget-border, var(--vscode-panel-border)) 70%, transparent);
    --dash-accent: var(--vscode-button-background);
    --dash-accent-strong: color-mix(in srgb, var(--vscode-button-background) 78%, white 22%);
    --dash-good: var(--vscode-testing-iconPassed, #4bb878);
    --dash-warn: var(--vscode-testing-iconQueued, #d7a34b);
    --dash-critical: var(--vscode-testing-iconFailed, #d05f5f);
    --dash-muted: var(--vscode-descriptionForeground);
    --dash-heading: "Segoe UI Variable Display", "Aptos Display", "Trebuchet MS", sans-serif;
    --dash-body: "Segoe UI Variable Text", "Aptos", "Segoe UI", sans-serif;
    --dash-radius: 20px;
    --dash-shadow: 0 18px 48px rgba(0, 0, 0, 0.18);
  }

  body {
    padding: 0;
    background: var(--dash-bg);
    font-family: var(--dash-body);
  }

  .dashboard-shell {
    min-height: 100vh;
    padding: 24px;
    box-sizing: border-box;
  }

  .dashboard-topbar {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    align-items: flex-start;
    margin-bottom: 24px;
  }

  .dashboard-kicker,
  .card-kicker,
  .section-kicker,
  .chart-kicker {
    margin: 0 0 8px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-size: 11px;
    color: var(--dash-muted);
  }

  .dashboard-topbar h1,
  .dashboard-root h2,
  .dashboard-root h3,
  .dashboard-root h4 {
    font-family: var(--dash-heading);
    letter-spacing: -0.02em;
  }

  .dashboard-topbar h1 {
    margin: 0;
    font-size: clamp(30px, 4vw, 44px);
  }

  .dashboard-copy {
    margin: 10px 0 0;
    max-width: 780px;
    color: var(--dash-muted);
    font-size: 14px;
  }

  .dashboard-button {
    border-radius: 999px;
    padding: 10px 18px;
    font-weight: 600;
  }

  .dashboard-button-ghost {
    background: transparent;
    border: 1px solid var(--dash-border);
    color: var(--vscode-foreground);
  }

  .dashboard-root {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .dashboard-loading,
  .dashboard-empty {
    display: grid;
    place-items: center;
    min-height: 280px;
    border: 1px solid var(--dash-border);
    border-radius: var(--dash-radius);
    background: var(--dash-panel);
    box-shadow: var(--dash-shadow);
    color: var(--dash-muted);
  }

  .hero-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.7fr) minmax(260px, 0.8fr);
    gap: 18px;
  }

  .hero-card,
  .score-card,
  .stat-card,
  .chart-card,
  .panel-card,
  .action-card,
  .branch-card,
  .list-card,
  .signal-card,
  .workflow-card,
  .coverage-card,
  .recent-item,
  .metric-pill,
  .governance-pill,
  .timeline-detail,
  .review-card {
    border: 1px solid var(--dash-border);
    border-radius: var(--dash-radius);
    background: linear-gradient(180deg, color-mix(in srgb, var(--dash-panel-strong) 92%, white 8%), var(--dash-panel));
    box-shadow: var(--dash-shadow);
  }

  .hero-card {
    padding: 24px;
    position: relative;
    overflow: hidden;
  }

  .hero-card::after {
    content: '';
    position: absolute;
    inset: auto -40px -60px auto;
    width: 220px;
    height: 220px;
    background: radial-gradient(circle, color-mix(in srgb, var(--dash-accent) 22%, transparent), transparent 68%);
    pointer-events: none;
  }

  .hero-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 18px;
  }

  .meta-pill,
  .governance-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 999px;
    border: 1px solid var(--dash-border);
    background: color-mix(in srgb, var(--dash-panel) 78%, transparent);
    font-size: 12px;
  }

  .score-card {
    padding: 24px;
    display: grid;
    gap: 16px;
    align-content: start;
  }

  .score-ring {
    width: 150px;
    height: 150px;
    margin: 0 auto;
    display: block;
  }

  .score-ring-track {
    fill: none;
    stroke: color-mix(in srgb, var(--dash-border) 75%, transparent);
    stroke-width: 12;
  }

  .score-ring-progress {
    fill: none;
    stroke: var(--dash-accent-strong);
    stroke-width: 12;
    stroke-linecap: round;
    transform: rotate(-90deg);
    transform-origin: 50% 50%;
    transition: stroke-dashoffset 420ms ease;
  }

  .score-value {
    text-align: center;
    font-size: 42px;
    font-weight: 700;
    line-height: 1;
  }

  .score-caption {
    text-align: center;
    color: var(--dash-muted);
    font-size: 13px;
  }

  .toolbar-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }

  .page-nav,
  .timescale-switch {
    display: inline-flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .page-nav button,
  .timescale-switch button,
  .action-link {
    border-radius: 999px;
    border: 1px solid var(--dash-border);
    background: color-mix(in srgb, var(--dash-panel) 82%, transparent);
    color: var(--vscode-foreground);
    padding: 8px 14px;
    font-size: 12px;
    font-weight: 600;
  }

  .page-nav button.active,
  .timescale-switch button.active,
  .action-link:hover,
  .action-link:focus-visible {
    background: color-mix(in srgb, var(--dash-accent) 84%, transparent);
    border-color: color-mix(in srgb, var(--dash-accent) 80%, white 20%);
  }

  .stats-grid,
  .chart-grid,
  .action-grid,
  .panel-grid,
  .delivery-grid,
  .repo-grid,
  .runtime-grid,
  .security-grid,
  .review-grid {
    display: grid;
    gap: 16px;
  }

  .stats-grid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }

  .chart-grid,
  .delivery-grid,
  .runtime-grid,
  .security-grid,
  .review-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .action-grid,
  .panel-grid,
  .repo-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .stat-card,
  .chart-card,
  .panel-card,
  .action-card,
  .branch-card,
  .list-card,
  .signal-card,
  .workflow-card,
  .review-card {
    padding: 18px;
  }

  .stat-card {
    min-height: 150px;
    display: grid;
    gap: 12px;
    cursor: pointer;
    transition: transform 160ms ease, border-color 160ms ease;
  }

  .stat-card:hover,
  .stat-card:focus-visible,
  .action-card:hover,
  .action-card:focus-visible,
  .recent-item:hover,
  .recent-item:focus-visible,
  .branch-card:hover,
  .branch-card:focus-visible,
  .workflow-card:hover,
  .workflow-card:focus-visible,
  .review-card:hover,
  .review-card:focus-visible {
    transform: translateY(-2px);
    border-color: color-mix(in srgb, var(--dash-accent) 60%, white 40%);
  }

  .tone-accent { border-color: color-mix(in srgb, var(--dash-accent) 45%, var(--dash-border)); }
  .tone-good { border-color: color-mix(in srgb, var(--dash-good) 45%, var(--dash-border)); }
  .tone-warn { border-color: color-mix(in srgb, var(--dash-warn) 45%, var(--dash-border)); }
  .tone-critical { border-color: color-mix(in srgb, var(--dash-critical) 55%, var(--dash-border)); }

  .stat-value {
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.03em;
  }

  .stat-detail,
  .muted,
  .signal-detail,
  .list-meta,
  .timeline-empty,
  .timeline-detail,
  .section-copy {
    color: var(--dash-muted);
    font-size: 13px;
  }

  .chart-card {
    display: grid;
    gap: 14px;
    min-height: 320px;
  }

  .chart-shell {
    position: relative;
    min-height: 190px;
    display: grid;
    align-items: end;
  }

  .chart-bars {
    display: grid;
    grid-template-columns: repeat(var(--bar-count), minmax(0, 1fr));
    gap: 6px;
    align-items: end;
    height: 190px;
    padding-top: 18px;
  }

  .chart-bar {
    position: relative;
    border: 0;
    background: transparent;
    padding: 0;
    height: 100%;
    cursor: pointer;
  }

  .chart-bar-column {
    position: absolute;
    inset: auto 0 0;
    border-radius: 12px 12px 8px 8px;
    min-height: 4px;
    background: linear-gradient(180deg, color-mix(in srgb, var(--dash-accent) 96%, white 4%), color-mix(in srgb, var(--dash-accent) 44%, transparent));
    transform-origin: bottom;
    animation: dashBarRise 520ms ease forwards;
    opacity: 0.88;
  }

  .chart-bar.active .chart-bar-column,
  .chart-bar:hover .chart-bar-column,
  .chart-bar:focus-visible .chart-bar-column {
    opacity: 1;
    box-shadow: 0 0 0 1px color-mix(in srgb, white 35%, transparent), 0 8px 24px color-mix(in srgb, var(--dash-accent) 28%, transparent);
  }

  .chart-axis {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    font-size: 11px;
    color: var(--dash-muted);
  }

  .timeline-detail {
    padding: 12px 14px;
  }

  .action-card,
  .recent-item,
  .workflow-card,
  .review-card,
  .branch-card {
    cursor: pointer;
  }

  .action-card {
    display: grid;
    gap: 8px;
    min-height: 128px;
  }

  .action-card strong,
  .panel-card h3,
  .branch-card h4,
  .list-card h3,
  .signal-card h4,
  .workflow-card h4,
  .review-card h4 {
    font-size: 17px;
    margin: 0;
  }

  .panel-card h3,
  .list-card h3 {
    margin-bottom: 10px;
  }

  .mini-grid {
    display: grid;
    gap: 10px;
  }

  .metric-pill {
    padding: 12px 14px;
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }

  .metric-label {
    color: var(--dash-muted);
    font-size: 12px;
  }

  .metric-value {
    font-weight: 700;
  }

  .stack-list {
    display: grid;
    gap: 10px;
  }

  .recent-item,
  .workflow-card,
  .review-card,
  .branch-card {
    text-align: left;
    width: 100%;
  }

  .row-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: flex-start;
  }

  .tag-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }

  .tag {
    display: inline-flex;
    align-items: center;
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--dash-border);
    font-size: 11px;
    color: var(--dash-muted);
  }

  .coverage-list {
    display: grid;
    gap: 10px;
  }

  .coverage-row {
    display: grid;
    gap: 6px;
  }

  .coverage-bar {
    height: 10px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--dash-border) 45%, transparent);
    overflow: hidden;
  }

  .coverage-bar > span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, color-mix(in srgb, var(--dash-accent) 94%, white 6%), color-mix(in srgb, var(--dash-good) 70%, var(--dash-accent)));
  }

  .signal-grid {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .signal-card.good { border-color: color-mix(in srgb, var(--dash-good) 46%, var(--dash-border)); }
  .signal-card.warn { border-color: color-mix(in srgb, var(--dash-warn) 46%, var(--dash-border)); }

  .checkline {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
  }

  .checkline::before {
    content: '';
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: var(--dash-good);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--dash-good) 24%, transparent);
  }

  .signal-card.warn .checkline::before {
    background: var(--dash-warn);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--dash-warn) 24%, transparent);
  }

  .page-section {
    display: none;
    gap: 16px;
  }

  .page-section.active {
    display: grid;
  }

  .mono {
    font-family: var(--vscode-editor-font-family, Consolas, monospace);
    font-size: 12px;
  }

  @media (max-width: 1280px) {
    .stats-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .chart-grid,
    .delivery-grid,
    .runtime-grid,
    .security-grid,
    .review-grid { grid-template-columns: 1fr; }
    .action-grid,
    .panel-grid,
    .repo-grid,
    .hero-grid { grid-template-columns: 1fr; }
  }

  @media (max-width: 820px) {
    .dashboard-shell { padding: 16px; }
    .stats-grid,
    .signal-grid { grid-template-columns: 1fr; }
  }

  @keyframes dashBarRise {
    from { transform: scaleY(0.2); opacity: 0.25; }
    to { transform: scaleY(1); opacity: 0.92; }
  }
`;
