import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AtlasMindContext } from '../extension.js';
import type { TaskImageAttachment } from '../types.js';
import { buildAssistantResponseMetadata, buildWorkstationContext, reconcileAssistantResponse } from '../chat/participant.js';
import { resolvePickedImageAttachments } from '../chat/imageAttachments.js';
import { getWebviewHtmlShell } from './webviewUtils.js';

const execFileAsync = promisify(execFile);
const PROJECT_DASHBOARD_VIEW_TYPE = 'atlasmind.projectDashboard';
const MAX_BRANCHES = 10;
const MAX_COMMITS = 10;
const MAX_RECENT_FILES = 8;
const MAX_RECENT_RUNS = 8;
const MAX_RECENT_SESSIONS = 8;
const SERIES_DAY_RANGE = 90;
const MAX_IDEATION_CARDS = 48;
const MAX_IDEATION_CONNECTIONS = 96;
const MAX_IDEATION_HISTORY = 18;
const IDEATION_BOARD_FILE = 'atlas-ideation-board.json';
const IDEATION_SUMMARY_FILE = 'atlas-ideation-board.md';
const IDEATION_RESPONSE_TAG = 'atlasmind-ideation';
const ALLOWED_DASHBOARD_COMMANDS = new Set([
  'atlasmind.openChatView',
  'atlasmind.openChatPanel',
  'atlasmind.openModelProviders',
  'atlasmind.openProjectRunCenter',
  'atlasmind.openSettingsProject',
  'atlasmind.openSettingsSafety',
  'atlasmind.openToolWebhooks',
  'atlasmind.openAgentPanel',
  'atlasmind.openVoicePanel',
  'atlasmind.openVisionPanel',
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
  | { type: 'openPrompt'; payload: string }
  | { type: 'openFile'; payload: string }
  | { type: 'openRun'; payload: string }
  | { type: 'openSession'; payload: string }
  | { type: 'attachIdeationImages' }
  | { type: 'clearIdeationImages' }
  | { type: 'saveIdeationBoard'; payload: IdeationBoardPayload }
  | { type: 'runIdeationLoop'; payload: IdeationRunPayload };

type DashboardWebviewMessage =
  | { type: 'state'; payload: DashboardSnapshot }
  | { type: 'error'; payload: string }
  | { type: 'navigate'; payload: DashboardPageId }
  | { type: 'ideationBusy'; payload: boolean }
  | { type: 'ideationStatus'; payload: string }
  | { type: 'ideationResponseReset' }
  | { type: 'ideationResponseChunk'; payload: string };

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

type DashboardPageId = 'overview' | 'score' | 'repo' | 'runtime' | 'ssot' | 'security' | 'delivery' | 'ideation';

type IdeationCardKind =
  | 'concept'
  | 'insight'
  | 'question'
  | 'opportunity'
  | 'risk'
  | 'experiment'
  | 'user-need'
  | 'atlas-response'
  | 'attachment';

type IdeationCardAuthor = 'user' | 'atlas';

type IdeationAnchor = 'center' | 'north' | 'east' | 'south' | 'west';

interface IdeationCardRecord {
  id: string;
  title: string;
  body: string;
  kind: IdeationCardKind;
  author: IdeationCardAuthor;
  x: number;
  y: number;
  color: string;
  imageSources: string[];
  createdAt: string;
  updatedAt: string;
}

interface IdeationConnectionRecord {
  id: string;
  fromCardId: string;
  toCardId: string;
  label: string;
}

interface IdeationHistoryEntry {
  role: 'user' | 'atlas';
  content: string;
  timestamp: string;
}

interface IdeationBoardRecord {
  version: 1;
  updatedAt: string;
  cards: IdeationCardRecord[];
  connections: IdeationConnectionRecord[];
  focusCardId?: string;
  lastAtlasResponse: string;
  nextPrompts: string[];
  history: IdeationHistoryEntry[];
}

interface IdeationStructuredSuggestion {
  title: string;
  body: string;
  kind: IdeationCardKind;
  anchor?: IdeationAnchor;
}

interface IdeationResponseParseResult {
  displayResponse: string;
  cards: IdeationStructuredSuggestion[];
  nextPrompts: string[];
}

interface IdeationBoardPayload {
  cards: IdeationCardRecord[];
  connections: IdeationConnectionRecord[];
  focusCardId?: string;
  nextPrompts?: string[];
}

interface IdeationRunPayload {
  prompt: string;
  speakResponse?: boolean;
}

interface DashboardIdeationAttachment {
  source: string;
  mimeType: string;
}

interface DashboardIdeationSnapshot {
  boardPath: string;
  summaryPath: string;
  cards: IdeationCardRecord[];
  connections: IdeationConnectionRecord[];
  focusCardId?: string;
  nextPrompts: string[];
  history: IdeationHistoryEntry[];
  lastAtlasResponse: string;
  imageAttachments: DashboardIdeationAttachment[];
  updatedAt: string;
  updatedRelative: string;
}

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
  tddLabel: string;
  tddTone: Tone;
}

interface DashboardTddSummary {
  summary: string;
  detail: string;
  tone: Tone;
  verified: number;
  blocked: number;
  missing: number;
  notApplicable: number;
  evaluatedSubtasks: number;
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

interface DashboardScoreComponent {
  id: string;
  label: string;
  score: number;
  maxScore: number;
  detail: string;
  tone: Tone;
  pageTarget?: DashboardPageId;
}

interface DashboardOutcomeSignal {
  label: string;
  ok: boolean;
  detail: string;
  actionPrompt?: string;
}

interface DashboardOutcomeCompleteness {
  desiredOutcome: string;
  score: number;
  summary: string;
  referenceCoveragePercent: number;
  roadmapCompleted: number;
  roadmapTotal: number;
  runCompletionPercent: number;
  signals: DashboardOutcomeSignal[];
}

interface DashboardScoreRecommendation {
  horizon: 'short' | 'medium' | 'long';
  title: string;
  detail: string;
  impactLabel: string;
  actionPrompt?: string;
  pageTarget?: DashboardPageId;
  command?: string;
  filePath?: string;
}

interface DashboardScoreBreakdown {
  components: DashboardScoreComponent[];
  outcome: DashboardOutcomeCompleteness;
  recommendations: DashboardScoreRecommendation[];
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
    tdd: DashboardTddSummary;
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
  score: DashboardScoreBreakdown;
  ideation: DashboardIdeationSnapshot;
  quickActions: Array<{
    label: string;
    description: string;
    pageTarget: DashboardPageId;
    command?: string;
    filePath?: string;
  }>;
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
  private ideationAttachments: TaskImageAttachment[] = [];
  private pendingNavigationTarget: DashboardPageId | undefined;

  public static createOrShow(context: vscode.ExtensionContext, atlas: AtlasMindContext, targetPage?: DashboardPageId): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (ProjectDashboardPanel.currentPanel) {
      ProjectDashboardPanel.currentPanel.panel.reveal(column);
      if (targetPage) {
        ProjectDashboardPanel.currentPanel.queueNavigation(targetPage);
      }
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

    ProjectDashboardPanel.currentPanel = new ProjectDashboardPanel(panel, context, atlas, targetPage);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly atlas: AtlasMindContext,
    initialTarget?: DashboardPageId,
  ) {
    this.panel = panel;
    this.pendingNavigationTarget = initialTarget;
    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(message => {
      void this.handleMessage(message);
    }, null, this.disposables);

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

  private queueNavigation(pageId: DashboardPageId): void {
    this.pendingNavigationTarget = pageId;
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
      case 'openPrompt':
        if (message.payload.trim().length > 0) {
          await vscode.commands.executeCommand('atlasmind.openChatPanel', {
            draftPrompt: message.payload.trim(),
            sendMode: 'send',
          });
        }
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
      case 'attachIdeationImages':
        await this.attachIdeationImages();
        return;
      case 'clearIdeationImages':
        this.ideationAttachments = [];
        await this.syncState();
        return;
      case 'saveIdeationBoard':
        await this.saveIdeationBoard(message.payload);
        return;
      case 'runIdeationLoop':
        await this.runIdeationLoop(message.payload);
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
    try {
      const snapshot = await collectDashboardSnapshot(this.atlas, this.ideationAttachments);
      await this.postMessage({ type: 'state', payload: snapshot });
      if (this.pendingNavigationTarget) {
        await this.postMessage({ type: 'navigate', payload: this.pendingNavigationTarget });
        this.pendingNavigationTarget = undefined;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.postMessage({ type: 'error', payload: `Dashboard refresh failed: ${detail}` });
    }
  }

  private async attachIdeationImages(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      await this.postMessage({ type: 'ideationStatus', payload: 'Open a workspace folder before attaching ideation images.' });
      return;
    }

    const selected = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFiles: true,
      canSelectFolders: false,
      defaultUri: workspaceFolder.uri,
      openLabel: 'Attach ideation images',
      filters: { Images: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
    });

    if (!selected || selected.length === 0) {
      return;
    }

    this.ideationAttachments = await resolvePickedImageAttachments(selected);
    await this.postMessage({
      type: 'ideationStatus',
      payload: this.ideationAttachments.length > 0
        ? `Attached ${this.ideationAttachments.length} image${this.ideationAttachments.length === 1 ? '' : 's'} for ideation.`
        : 'No supported images were attached.',
    });
    await this.syncState();
  }

  private async saveIdeationBoard(payload: IdeationBoardPayload): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const ssotPath = normalizeSsotPath(vscode.workspace.getConfiguration('atlasmind').get<string>('ssotPath', 'project_memory'));
    const stored = await loadIdeationBoard(workspaceRoot, ssotPath);
    const nextBoard = sanitizeIdeationBoard({
      ...stored,
      cards: payload.cards,
      connections: payload.connections,
      focusCardId: payload.focusCardId,
      nextPrompts: payload.nextPrompts ?? stored.nextPrompts,
      updatedAt: new Date().toISOString(),
    });
    await persistIdeationBoard(workspaceRoot, ssotPath, nextBoard);
  }

  private async runIdeationLoop(payload: IdeationRunPayload): Promise<void> {
    const trimmedPrompt = payload.prompt.trim();
    if (!trimmedPrompt) {
      await this.postMessage({ type: 'ideationStatus', payload: 'Describe the idea you want Atlas to pressure-test first.' });
      return;
    }

    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const ssotPath = normalizeSsotPath(configuration.get<string>('ssotPath', 'project_memory'));
    const board = await loadIdeationBoard(workspaceRoot, ssotPath);
    const focusCard = board.cards.find(card => card.id === board.focusCardId);
    const sessionContext = this.atlas.sessionConversation.buildContext({
      maxTurns: configuration.get<number>('chatSessionTurnLimit', 6),
      maxChars: configuration.get<number>('chatSessionContextChars', 2500),
    });
    const workstationContext = buildWorkstationContext();
    const ideationPrompt = buildIdeationPrompt(trimmedPrompt, board, focusCard, this.ideationAttachments);

    await this.postMessage({ type: 'ideationResponseReset' });
    await this.postMessage({ type: 'ideationBusy', payload: true });
    await this.postMessage({ type: 'ideationStatus', payload: 'Atlas is shaping the next ideation move...' });

    let streamedText = '';
    try {
      const result = await this.atlas.orchestrator.processTask({
        id: `ideation-${Date.now()}`,
        userMessage: ideationPrompt,
        context: {
          ...(sessionContext ? { sessionContext } : {}),
          ...(workstationContext ? { workstationContext } : {}),
          ideationBoard: summarizeIdeationBoard(board),
          ...(focusCard ? { ideationFocus: `${focusCard.title}: ${focusCard.body}` } : {}),
          ...(this.ideationAttachments.length > 0 ? { imageAttachments: this.ideationAttachments } : {}),
        },
        constraints: {
          budget: toDashboardBudgetMode(configuration.get<string>('budgetMode')),
          speed: toDashboardSpeedMode(configuration.get<string>('speedMode')),
          ...(this.ideationAttachments.length > 0 ? { requiredCapabilities: ['vision'] } : {}),
        },
        timestamp: new Date().toISOString(),
      }, async chunk => {
        if (!chunk) {
          return;
        }
        streamedText += chunk;
        await this.postMessage({ type: 'ideationResponseChunk', payload: chunk });
      });

      const reconciled = reconcileAssistantResponse(streamedText, result.response);
      if (reconciled.additionalText) {
        await this.postMessage({ type: 'ideationResponseChunk', payload: reconciled.additionalText });
      }

      const parsed = parseIdeationResponse(reconciled.transcriptText);
      const updatedBoard = applyIdeationResponse(board, trimmedPrompt, parsed, focusCard?.id, this.ideationAttachments);
      await persistIdeationBoard(workspaceRoot, ssotPath, updatedBoard);

      this.atlas.sessionConversation.recordTurn(
        trimmedPrompt,
        parsed.displayResponse,
        undefined,
        buildAssistantResponseMetadata(trimmedPrompt, result, {
          hasSessionContext: Boolean(sessionContext),
          imageAttachments: this.ideationAttachments,
          routingContext: { ideation: true },
        }),
      );

      if (payload.speakResponse || configuration.get<boolean>('voice.ttsEnabled', false)) {
        this.atlas.voiceManager.speak(parsed.displayResponse);
      }

      await this.postMessage({ type: 'ideationStatus', payload: 'Ideation board updated with Atlas feedback.' });
      await this.syncState();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.postMessage({ type: 'ideationStatus', payload: `Ideation request failed: ${detail}` });
    } finally {
      await this.postMessage({ type: 'ideationBusy', payload: false });
    }
  }

  private async postMessage(message: DashboardWebviewMessage): Promise<void> {
    await this.panel.webview.postMessage(message);
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

  if ((candidate['type'] === 'openCommand' || candidate['type'] === 'openPrompt' || candidate['type'] === 'openFile' || candidate['type'] === 'openRun' || candidate['type'] === 'openSession') && typeof candidate['payload'] === 'string') {
    return candidate['payload'].trim().length > 0;
  }

  if (candidate['type'] === 'attachIdeationImages' || candidate['type'] === 'clearIdeationImages') {
    return true;
  }

  if (candidate['type'] === 'runIdeationLoop') {
    return isIdeationRunPayload(candidate['payload']);
  }

  if (candidate['type'] === 'saveIdeationBoard') {
    return isIdeationBoardPayload(candidate['payload']);
  }

  return false;
}

async function collectDashboardSnapshot(atlas: AtlasMindContext, ideationAttachments: TaskImageAttachment[] = []): Promise<DashboardSnapshot> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name ?? 'No Workspace';
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const ssotPath = normalizeSsotPath(configuration.get<string>('ssotPath', 'project_memory'));
  const workspaceRootLabel = workspaceRoot ? path.basename(workspaceRoot) : 'No folder open';

  const [gitSnapshot, packageSnapshot, workflowSnapshot, ssotSnapshot, ideationBoard] = await Promise.all([
    collectGitSnapshot(workspaceRoot),
    collectPackageSnapshot(workspaceRoot),
    collectWorkflowSnapshot(workspaceRoot),
    collectSsotSnapshot(workspaceRoot, ssotPath),
    loadIdeationBoard(workspaceRoot, ssotPath),
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
  const runtimeTdd = summarizeRuntimeTdd(runs);
  const costSummary = atlas.costTracker.getSummary();
  const memoryEntries = atlas.memoryManager.listEntries();
  const scanResults = atlas.memoryManager.getScanResults();
  const warnedEntries = [...scanResults.values()].filter(result => result.status === 'warned').length;
  const blockedEntries = [...scanResults.values()].filter(result => result.status === 'blocked').length;
  const governanceProviders = detectGovernanceProviders(workspaceRoot);
  const toolApprovalMode = configuration.get<string>('toolApprovalMode', 'ask-on-write');
  const allowTerminalWrite = configuration.get<boolean>('allowTerminalWrite', false);
  const autoVerifyAfterWrite = configuration.get<boolean>('autoVerifyAfterWrite', false);
  const autoVerifyScripts = normalizeVerificationScripts(configuration.get<string[] | string>('autoVerifyScripts', []));
  const securityPolicyPresent = await fileExists(workspaceRoot ? path.join(workspaceRoot, 'SECURITY.md') : undefined);
  const changelogPresent = await fileExists(workspaceRoot ? path.join(workspaceRoot, 'CHANGELOG.md') : undefined);
  const codeownersPresent = await fileExists(workspaceRoot ? path.join(workspaceRoot, '.github', 'CODEOWNERS') : undefined);
  const prTemplatePresent = await fileExists(workspaceRoot ? path.join(workspaceRoot, '.github', 'pull_request_template.md') : undefined);
  const issueTemplateCount = await countIssueTemplates(workspaceRoot);
  const autopilot = atlas.toolApprovalManager.isAutopilot();
  const ssotOpenTarget = ssotSnapshot.recentFiles[0]?.path ?? `${ssotPath}/project_soul.md`;
  const ciSignals = [
    { label: 'Compile script', ok: packageSnapshot.keyScripts.includes('compile') },
    { label: 'Lint script', ok: packageSnapshot.keyScripts.includes('lint') },
    { label: 'Test script', ok: packageSnapshot.keyScripts.includes('test') },
    { label: 'Workflow files', ok: workflowSnapshot.length > 0 },
  ];
  const reviewReadiness = [
    { label: 'PR template', ok: prTemplatePresent },
    { label: 'CODEOWNERS', ok: codeownersPresent },
    { label: 'Issue templates', ok: issueTemplateCount > 0 },
    { label: 'CHANGELOG', ok: changelogPresent },
  ];
  const outcomeCompleteness = await collectOutcomeCompleteness(workspaceRoot, ssotPath, runs, ciSignals);
  const scoreBreakdown = buildScoreBreakdown({
    ssotPath,
    securityPolicyPresent,
    codeownersPresent,
    prTemplatePresent,
    workflowCount: workflowSnapshot.length,
    dirty: gitSnapshot.dirty,
    behind: gitSnapshot.behind,
    ssotCoveragePercent: ssotSnapshot.coveragePercent,
    blockedEntries,
    warnedEntries,
    totalEntries: memoryEntries.length,
    autopilot,
    governanceProviderCount: governanceProviders.length,
    allowTerminalWrite,
    autoVerifyAfterWrite,
    ciSignals,
    reviewReadiness,
    outcomeCompleteness,
  });
  const repoLabel = workspaceRoot && gitSnapshot.currentBranch !== 'Not a git repository'
    ? `${workspaceRootLabel} • ${gitSnapshot.currentBranch}`
    : workspaceRootLabel;
  const quickActions: DashboardSnapshot['quickActions'] = [
    { label: 'Score Breakdown', description: 'Inspect the operational score, outcome completeness, and horizon-based recommendations.', pageTarget: 'score' as DashboardPageId },
    { label: 'Open Chat View', description: 'Jump into the embedded Atlas workspace.', command: 'atlasmind.openChatView', pageTarget: 'runtime' as DashboardPageId },
    { label: 'Ideation Whiteboard', description: 'Open the dedicated project ideation dashboard.', command: 'atlasmind.openProjectIdeation', pageTarget: 'runtime' as DashboardPageId },
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
      value: `${scoreBreakdown.components.reduce((total, component) => total + component.score, 0)}`,
      detail: `Composite score across ${scoreBreakdown.components.length} operational dimensions, including ${outcomeCompleteness.score}% outcome completeness.`,
      tone: blockedEntries > 0 || autopilot ? 'warn' : outcomeCompleteness.score >= 75 ? 'good' : 'accent',
      pageTarget: 'score',
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
      detail: `${healthyProviders}/${totalProviders} providers healthy, ${enabledSkills}/${skills.length} skills enabled. TDD posture: ${runtimeTdd.summary.toLowerCase()}.`,
      tone: runtimeTdd.tone === 'critical' ? 'critical' : healthyProviders === totalProviders ? runtimeTdd.tone : 'warn',
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
    {
      id: 'ideation',
      label: 'Ideation Loop',
      value: `${ideationBoard.cards.length} board card${ideationBoard.cards.length === 1 ? '' : 's'}`,
      detail: `${ideationBoard.nextPrompts.length} follow-up prompt${ideationBoard.nextPrompts.length === 1 ? '' : 's'} queued, ${ideationAttachments.length} live attachment${ideationAttachments.length === 1 ? '' : 's'}.`,
      tone: ideationBoard.cards.length > 0 ? 'accent' : 'neutral',
      command: 'atlasmind.openProjectIdeation',
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
    healthSummary: buildHealthSummary({ healthScore, blockedEntries, autopilot, dirty: gitSnapshot.dirty, workflowCount: workflowSnapshot.length, outcomeScore: outcomeCompleteness.score }),
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
      tdd: runtimeTdd,
      runs: runs.slice(0, MAX_RECENT_RUNS).map(run => {
        const tdd = summarizeRunTdd(run.subTaskArtifacts);
        return {
          id: run.id,
          goal: run.goal,
          status: run.status,
          updatedAt: run.updatedAt,
          updatedRelative: formatRelativeDate(run.updatedAt),
          progressLabel: `${run.completedSubtaskCount}/${run.totalSubtaskCount} subtasks`,
          tddLabel: tdd.summary,
          tddTone: tdd.tone,
        };
      }),
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
      autoVerifyScripts: autoVerifyScripts || 'No verification commands configured.',
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
      ciSignals,
      reviewReadiness,
    },
    score: scoreBreakdown,
    ideation: {
      boardPath: buildIdeationRelativePath(ssotPath, IDEATION_BOARD_FILE),
      summaryPath: buildIdeationRelativePath(ssotPath, IDEATION_SUMMARY_FILE),
      cards: ideationBoard.cards,
      connections: ideationBoard.connections,
      focusCardId: ideationBoard.focusCardId,
      nextPrompts: ideationBoard.nextPrompts,
      history: ideationBoard.history,
      lastAtlasResponse: ideationBoard.lastAtlasResponse,
      imageAttachments: ideationAttachments.map(attachment => ({ source: attachment.source, mimeType: attachment.mimeType })),
      updatedAt: ideationBoard.updatedAt,
      updatedRelative: formatRelativeDate(ideationBoard.updatedAt),
    },
    quickActions,
  };
}

function summarizeRuntimeTdd(runs: Array<{ subTaskArtifacts: Array<{ tddStatus?: 'verified' | 'blocked' | 'missing' | 'not-applicable' }> }>): DashboardTddSummary {
  let verified = 0;
  let blocked = 0;
  let missing = 0;
  let notApplicable = 0;

  for (const run of runs) {
    for (const artifact of run.subTaskArtifacts) {
      switch (artifact.tddStatus) {
        case 'verified':
          verified += 1;
          break;
        case 'blocked':
          blocked += 1;
          break;
        case 'missing':
          missing += 1;
          break;
        case 'not-applicable':
          notApplicable += 1;
          break;
        default:
          break;
      }
    }
  }

  const evaluatedSubtasks = verified + blocked + missing + notApplicable;
  if (evaluatedSubtasks === 0) {
    return {
      summary: 'No TDD telemetry yet',
      detail: 'Recent project runs have not recorded any per-subtask TDD telemetry yet.',
      tone: 'neutral',
      verified,
      blocked,
      missing,
      notApplicable,
      evaluatedSubtasks,
    };
  }

  if (blocked > 0) {
    return {
      summary: `${blocked} blocked by TDD gate`,
      detail: `${verified} verified, ${blocked} blocked, ${missing} missing evidence, ${notApplicable} not applicable across ${evaluatedSubtasks} tracked subtasks.`,
      tone: 'critical',
      verified,
      blocked,
      missing,
      notApplicable,
      evaluatedSubtasks,
    };
  }

  if (missing > 0) {
    return {
      summary: `${missing} missing TDD evidence`,
      detail: `${verified} verified, ${missing} missing evidence, ${notApplicable} not applicable across ${evaluatedSubtasks} tracked subtasks.`,
      tone: 'warn',
      verified,
      blocked,
      missing,
      notApplicable,
      evaluatedSubtasks,
    };
  }

  return {
    summary: `${verified} verified TDD subtasks`,
    detail: `${verified} verified and ${notApplicable} not applicable across ${evaluatedSubtasks} tracked subtasks.`,
    tone: 'good',
    verified,
    blocked,
    missing,
    notApplicable,
    evaluatedSubtasks,
  };
}

function summarizeRunTdd(artifacts: Array<{ tddStatus?: 'verified' | 'blocked' | 'missing' | 'not-applicable' }>): Pick<DashboardTddSummary, 'summary' | 'tone'> {
  const summary = summarizeRuntimeTdd([{ subTaskArtifacts: artifacts }]);
  return { summary: summary.summary, tone: summary.tone };
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

  const commitDates = (await runGit(workspaceRoot, ['log', `--since=${SERIES_DAY_RANGE} days ago`, '--date=short', '--pretty=format:%ad']))
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

async function collectOutcomeCompleteness(
  workspaceRoot: string | undefined,
  ssotPath: string,
  runs: Array<{ completedSubtaskCount: number; totalSubtaskCount: number; status: string }>,
  ciSignals: Array<{ label: string; ok: boolean }>,
): Promise<DashboardOutcomeCompleteness> {
  if (!workspaceRoot) {
    return {
      desiredOutcome: 'Define the desired project outcome in project_memory/project_soul.md.',
      score: 0,
      summary: 'No workspace is open, so AtlasMind cannot measure how complete the desired project outcome is yet.',
      referenceCoveragePercent: 0,
      roadmapCompleted: 0,
      roadmapTotal: 0,
      runCompletionPercent: 0,
      signals: [
        {
          label: 'Outcome defined',
          ok: false,
          detail: 'Open a workspace and define the project vision in project_memory/project_soul.md.',
          actionPrompt: 'Open a workspace for this project, then define the desired outcome in project_memory/project_soul.md by writing a concrete Vision section that explains what done looks like. Make the smallest useful documentation change once the workspace is available, then summarize what still needs to be grounded in roadmap or capability docs.',
        },
      ],
    };
  }

  const projectSoulPath = path.join(workspaceRoot, ssotPath, 'project_soul.md');
  const productCapabilitiesPath = path.join(workspaceRoot, ssotPath, 'domain', 'product-capabilities.md');
  const [projectSoulRaw, productCapabilitiesExists, roadmapFiles] = await Promise.all([
    fs.readFile(projectSoulPath, 'utf-8').catch(() => ''),
    fileExists(productCapabilitiesPath),
    collectMarkdownFiles(path.join(workspaceRoot, ssotPath, 'roadmap')),
  ]);

  const desiredOutcome = extractMarkdownSection(projectSoulRaw, 'Vision')
    .replace(/\r?\n/g, ' ')
    .trim() || 'Define the desired project outcome in project_memory/project_soul.md#Vision.';
  const referencePaths = extractMarkdownBulletItems(extractMarkdownSection(projectSoulRaw, 'References'));
  const resolvedReferenceChecks = await Promise.all(referencePaths.map(async referencePath => {
    const normalizedReference = referencePath.replace(/^`|`$/g, '').trim();
    const directPath = path.join(workspaceRoot, normalizedReference);
    const ssotRelativePath = path.join(workspaceRoot, ssotPath, normalizedReference);
    const filePath = await fileExists(directPath) ? directPath : ssotRelativePath;
    return fileExists(filePath);
  }));
  const referencesPresent = resolvedReferenceChecks.filter(Boolean).length;
  const referenceCoveragePercent = referencePaths.length > 0
    ? Math.round((referencesPresent / referencePaths.length) * 100)
    : 0;

  const roadmapProgress = roadmapFiles.reduce((aggregate, text) => {
    const progress = parseRoadmapProgress(text);
    return {
      completed: aggregate.completed + progress.completed,
      total: aggregate.total + progress.total,
    };
  }, { completed: 0, total: 0 });
  const roadmapProgressPercent = roadmapProgress.total > 0
    ? Math.round((roadmapProgress.completed / roadmapProgress.total) * 100)
    : 0;

  const executionRatios = runs
    .filter(run => run.totalSubtaskCount > 0)
    .map(run => run.completedSubtaskCount / run.totalSubtaskCount);
  const runCompletionPercent = executionRatios.length > 0
    ? Math.round((executionRatios.reduce((total, value) => total + value, 0) / executionRatios.length) * 100)
    : 0;

  const deliveryEvidencePercent = ciSignals.length > 0
    ? Math.round((ciSignals.filter(signal => signal.ok).length / ciSignals.length) * 100)
    : 0;

  let score = 0;
  score += desiredOutcome.startsWith('Define the desired project outcome') ? 0 : 28;
  score += Math.round(referenceCoveragePercent * 0.18);
  score += roadmapProgress.total > 0 ? Math.round(roadmapProgressPercent * 0.26) : 0;
  score += productCapabilitiesExists ? 10 : 0;
  score += Math.round(deliveryEvidencePercent * 0.08);
  score += executionRatios.length > 0 ? Math.round(runCompletionPercent * 0.10) : 0;
  score = Math.max(0, Math.min(100, score));

  const signals: DashboardOutcomeSignal[] = [
    {
      label: 'Outcome defined',
      ok: !desiredOutcome.startsWith('Define the desired project outcome'),
      detail: !desiredOutcome.startsWith('Define the desired project outcome')
        ? 'The project soul defines a concrete vision for the end state.'
        : 'The project soul is missing a concrete vision statement for the desired end state.',
      actionPrompt: 'Open project_memory/project_soul.md and strengthen the Vision section into a concrete desired end state for this project. Make the smallest defensible documentation change that clearly defines what done looks like, then summarize what changed and what still needs follow-up.',
    },
    {
      label: 'Reference coverage',
      ok: referenceCoveragePercent >= 75,
      detail: referencePaths.length > 0
        ? `${referencesPresent}/${referencePaths.length} referenced vision-supporting document(s) resolve on disk.`
        : 'No supporting references are listed beneath the project soul vision.',
      actionPrompt: 'Review the References section in project_memory/project_soul.md and fix the first missing or weak supporting link. Update the referenced document or the reference list so this area has one concrete improvement, then summarize what was repaired and what still remains unresolved.',
    },
    {
      label: 'Roadmap progress',
      ok: roadmapProgress.total > 0 && roadmapProgressPercent >= 50,
      detail: roadmapProgress.total > 0
        ? `${roadmapProgress.completed}/${roadmapProgress.total} roadmap item(s) are marked complete.`
        : 'No tracked roadmap checklist items were found in project_memory/roadmap/.',
      actionPrompt: 'Open project_memory/roadmap/improvement-plan.md and translate the desired outcome into explicit measurable checklist items, or mark the first clearly completed item if that evidence already exists. Make a small first-pass roadmap improvement and then summarize the next milestone that should be addressed.',
    },
    {
      label: 'Execution evidence',
      ok: executionRatios.length > 0 && runCompletionPercent >= 70,
      detail: executionRatios.length > 0
        ? `Recent project runs average ${runCompletionPercent}% completion across planned subtasks.`
        : 'No recent autonomous runs provide evidence that execution is converging on the desired outcome.',
      actionPrompt: 'Review the current roadmap and recent project-run evidence, identify the smallest concrete piece of work that would move the desired outcome forward, and either complete that small step or leave the workspace with a sharply defined first implementation task. Summarize the action taken and the next blocker if it could not be finished in one pass.',
    },
    {
      label: 'Capability baseline',
      ok: productCapabilitiesExists,
      detail: productCapabilitiesExists
        ? 'A product-capabilities memory document exists and gives outcome context beyond the raw vision.'
        : 'No product-capabilities memory document was found to translate vision into concrete capabilities.',
      actionPrompt: 'Open project_memory/domain/product-capabilities.md and add or tighten the first high-signal capability entry that turns the project vision into something concrete and reviewable. Make the smallest useful documentation improvement, then summarize the remaining capability gaps.',
    },
  ];

  const summary = score >= 80
    ? 'The desired outcome is defined, backed by supporting documents, and execution evidence is broadly converging on it.'
    : score >= 55
      ? 'The desired outcome is visible, but roadmap progress, supporting evidence, or execution telemetry still leave noticeable gaps.'
      : 'The desired outcome is only partially translated into roadmap evidence and execution progress. AtlasMind needs sharper completion signals.';

  return {
    desiredOutcome,
    score,
    summary,
    referenceCoveragePercent,
    roadmapCompleted: roadmapProgress.completed,
    roadmapTotal: roadmapProgress.total,
    runCompletionPercent,
    signals,
  };
}

async function collectMarkdownFiles(directoryPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    const files = entries.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md'));
    return Promise.all(files.map(entry => fs.readFile(path.join(directoryPath, entry.name), 'utf-8').catch(() => '')));
  } catch {
    return [];
  }
}

function extractMarkdownSection(text: string, heading: string): string {
  const pattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$([\\s\\S]*?)(?=^##\\s+|$)`, 'im');
  const match = text.match(pattern);
  return match?.[1]?.trim() ?? '';
}

function extractMarkdownBulletItems(text: string): string[] {
  return [...text.matchAll(/^\s*[-*]\s+(.+?)\s*$/gm)]
    .map(match => match[1]?.trim() ?? '')
    .filter(Boolean);
}

function parseRoadmapProgress(text: string): { completed: number; total: number } {
  const items = [...text.matchAll(/^\s*(?:[-*]|\d+\.)\s+(.+?)\s*$/gm)]
    .map(match => match[1]?.trim() ?? '')
    .filter(Boolean);

  const completed = items.filter(item => /^(?:✅|\[x\])/i.test(item)).length;
  return {
    completed,
    total: items.length,
  };
}

function buildScoreBreakdown(input: {
  ssotPath: string;
  securityPolicyPresent: boolean;
  codeownersPresent: boolean;
  prTemplatePresent: boolean;
  workflowCount: number;
  dirty: boolean;
  behind: number;
  ssotCoveragePercent: number;
  blockedEntries: number;
  warnedEntries: number;
  totalEntries: number;
  autopilot: boolean;
  governanceProviderCount: number;
  allowTerminalWrite: boolean;
  autoVerifyAfterWrite: boolean;
  ciSignals: Array<{ label: string; ok: boolean }>;
  reviewReadiness: Array<{ label: string; ok: boolean }>;
  outcomeCompleteness: DashboardOutcomeCompleteness;
}): DashboardScoreBreakdown {
  const components: DashboardScoreComponent[] = [
    {
      id: 'security',
      label: 'Security posture',
      score: Math.max(0, Math.min(22,
        (input.securityPolicyPresent ? 8 : 0)
        + (input.codeownersPresent ? 4 : 0)
        + (input.prTemplatePresent ? 3 : 0)
        + (input.autoVerifyAfterWrite ? 3 : 0)
        + (!input.allowTerminalWrite ? 2 : 0)
        + (!input.autopilot ? 2 : 0)
        - (input.blockedEntries > 0 ? 6 : 0))),
      maxScore: 22,
      detail: `${input.securityPolicyPresent ? 'Security policy present' : 'Security policy missing'}, ${input.blockedEntries} blocked SSOT entr${input.blockedEntries === 1 ? 'y' : 'ies'}, autopilot ${input.autopilot ? 'enabled' : 'disabled'}.`,
      tone: input.blockedEntries > 0 || input.autopilot ? 'warn' : 'good',
      pageTarget: 'security',
    },
    {
      id: 'repo',
      label: 'Repo hygiene',
      score: Math.max(0, Math.min(12,
        (input.dirty ? 0 : 6)
        + (input.behind === 0 ? 3 : 0)
        + (input.workflowCount > 0 ? 3 : 0))),
      maxScore: 12,
      detail: `${input.dirty ? 'Local changes still pending.' : 'Working tree is clean.'} ${input.behind === 0 ? 'Branch is current.' : `${input.behind} upstream commit(s) missing locally.`}`,
      tone: input.dirty || input.behind > 0 ? 'warn' : 'good',
      pageTarget: 'repo',
    },
    {
      id: 'ssot',
      label: 'SSOT coverage',
      score: Math.max(0, Math.min(18,
        Math.round(input.ssotCoveragePercent * 0.14)
        + (input.totalEntries > 0 ? 4 : 0)
        - (input.warnedEntries > 4 ? 2 : 0))),
      maxScore: 18,
      detail: `${input.ssotCoveragePercent}% directory coverage with ${input.totalEntries} indexed entries and ${input.warnedEntries} warned entr${input.warnedEntries === 1 ? 'y' : 'ies'}.`,
      tone: input.ssotCoveragePercent >= 80 && input.warnedEntries <= 4 ? 'good' : 'warn',
      pageTarget: 'ssot',
    },
    {
      id: 'delivery',
      label: 'Delivery flow',
      score: Math.max(0, Math.min(18,
        (input.workflowCount > 0 ? 6 : 0)
        + Math.round((input.ciSignals.filter(signal => signal.ok).length / Math.max(input.ciSignals.length, 1)) * 6)
        + Math.round((input.reviewReadiness.filter(signal => signal.ok).length / Math.max(input.reviewReadiness.length, 1)) * 6))),
      maxScore: 18,
      detail: `${input.ciSignals.filter(signal => signal.ok).length}/${input.ciSignals.length} CI signals and ${input.reviewReadiness.filter(signal => signal.ok).length}/${input.reviewReadiness.length} review signals are in place.`,
      tone: input.workflowCount > 0 && input.ciSignals.every(signal => signal.ok) ? 'good' : 'warn',
      pageTarget: 'delivery',
    },
    {
      id: 'governance',
      label: 'Governance automation',
      score: Math.min(10, input.governanceProviderCount * 5),
      maxScore: 10,
      detail: `${input.governanceProviderCount} dependency-governance provider${input.governanceProviderCount === 1 ? '' : 's'} detected.`,
      tone: input.governanceProviderCount > 0 ? 'good' : 'warn',
      pageTarget: 'security',
    },
    {
      id: 'outcome',
      label: 'Outcome completeness',
      score: Math.round(input.outcomeCompleteness.score * 0.2),
      maxScore: 20,
      detail: input.outcomeCompleteness.summary,
      tone: input.outcomeCompleteness.score >= 75 ? 'good' : input.outcomeCompleteness.score >= 55 ? 'accent' : 'warn',
      pageTarget: 'score',
    },
  ];

  const recommendations: DashboardScoreRecommendation[] = [];

  if (input.blockedEntries > 0) {
    recommendations.push({
      horizon: 'short',
      title: 'Resolve blocked SSOT entries',
      detail: 'Sanitize or rewrite blocked memory files first so the dashboard score is not overstating operational readiness while AtlasMind is excluding context.',
      impactLabel: 'High risk reduction',
      actionPrompt: 'Address this Project Dashboard recommendation: resolve blocked SSOT entries. Inspect the blocked memory material AtlasMind is excluding, make the smallest safe change that removes at least the first blocked item, and summarize what was fixed plus any remaining blocked files.',
      pageTarget: 'ssot',
    });
  }
  if (input.dirty || input.behind > 0) {
    recommendations.push({
      horizon: 'short',
      title: 'Stabilize the working tree',
      detail: 'Reduce branch drift and pending local changes before broadening delivery work, otherwise the operational score is propped up by incomplete repo hygiene.',
      impactLabel: 'Fast hygiene gain',
      actionPrompt: 'Address this Project Dashboard recommendation: stabilize the working tree. Review the current branch drift and local modifications, resolve the smallest meaningful repo-hygiene issue in one pass if possible, otherwise leave the workspace with a clear first cleanup step and summarize what changed.',
      pageTarget: 'repo',
      command: 'workbench.view.scm',
    });
  }
  if (input.outcomeCompleteness.roadmapTotal === 0 || input.outcomeCompleteness.score < 55) {
    recommendations.push({
      horizon: 'short',
      title: 'Translate vision into tracked milestones',
      detail: 'Capture the desired project outcome as explicit roadmap checklist items so completion can be measured instead of inferred.',
      impactLabel: 'Raises outcome completeness',
      actionPrompt: 'Address this Project Dashboard recommendation: translate the project vision into tracked milestones. Update project_memory/roadmap/improvement-plan.md with the first measurable milestone or checklist set that moves the desired outcome from aspiration into execution, then summarize the next milestone that should follow.',
      filePath: `${input.ssotPath}/roadmap/improvement-plan.md`,
    });
  }
  if (input.workflowCount === 0 || input.ciSignals.some(signal => !signal.ok)) {
    recommendations.push({
      horizon: 'medium',
      title: 'Close delivery automation gaps',
      detail: 'Add or tighten CI workflows and missing compile/lint/test signals so delivery readiness contributes real evidence instead of documentation-only confidence.',
      impactLabel: 'Improves delivery confidence',
      actionPrompt: 'Address this Project Dashboard recommendation: close delivery automation gaps. Identify the first missing compile, lint, test, or workflow signal that can be added or repaired with a focused change, implement that improvement if it is small enough, and summarize the remaining delivery gaps afterward.',
      pageTarget: 'delivery',
    });
  }
  if (input.governanceProviderCount === 0) {
    recommendations.push({
      horizon: 'medium',
      title: 'Add dependency governance automation',
      detail: 'Introduce Dependabot, Renovate, or an equivalent provider so governance posture is continuously reinforced rather than manually reviewed.',
      impactLabel: 'Improves governance score',
      actionPrompt: 'Address this Project Dashboard recommendation: add dependency governance automation. Introduce the smallest defensible governance automation improvement for this repo, or if a full setup is too large for one pass, scaffold the first concrete piece and summarize what remains.',
      pageTarget: 'security',
    });
  }
  if (input.outcomeCompleteness.referenceCoveragePercent < 100) {
    recommendations.push({
      horizon: 'medium',
      title: 'Back the outcome with referenced evidence',
      detail: 'Make sure the project soul references resolve to live architecture, operations, and capability docs so the desired outcome is anchored in current evidence.',
      impactLabel: 'Strengthens outcome traceability',
      actionPrompt: 'Address this Project Dashboard recommendation: back the desired outcome with referenced evidence. Fix one missing or stale supporting reference so the project soul points to live architecture, operations, or capability documentation, then summarize which evidence link should be repaired next.',
      pageTarget: 'ssot',
    });
  }
  recommendations.push({
    horizon: 'long',
    title: 'Turn completion into a managed operating metric',
    detail: 'Evolve the roadmap and run telemetry so AtlasMind can compare stated outcome, shipped capabilities, and execution evidence as an ongoing operational loop.',
    impactLabel: 'Sustained score quality',
    actionPrompt: 'Address this Project Dashboard recommendation: turn completion into a managed operating metric. Start the smallest useful improvement that links roadmap progress, shipped capabilities, and run telemetry together, and summarize the next step needed to make outcome completeness a durable operational metric.',
    pageTarget: 'score',
  });

  return {
    components,
    outcome: input.outcomeCompleteness,
    recommendations,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function isIdeationRunPayload(value: unknown): value is IdeationRunPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate['prompt'] !== 'string' || candidate['prompt'].trim().length === 0) {
    return false;
  }
  return typeof candidate['speakResponse'] === 'undefined' || typeof candidate['speakResponse'] === 'boolean';
}

function isIdeationBoardPayload(value: unknown): value is IdeationBoardPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate['cards']) || !Array.isArray(candidate['connections'])) {
    return false;
  }
  if (candidate['cards'].length > MAX_IDEATION_CARDS || candidate['connections'].length > MAX_IDEATION_CONNECTIONS) {
    return false;
  }
  return candidate['cards'].every(isIdeationCardRecord) && candidate['connections'].every(isIdeationConnectionRecord)
    && (typeof candidate['focusCardId'] === 'undefined' || typeof candidate['focusCardId'] === 'string')
    && (typeof candidate['nextPrompts'] === 'undefined' || (Array.isArray(candidate['nextPrompts']) && candidate['nextPrompts'].every(item => typeof item === 'string')));
}

function isIdeationCardRecord(value: unknown): value is IdeationCardRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate['id'] === 'string'
    && typeof candidate['title'] === 'string'
    && typeof candidate['body'] === 'string'
    && typeof candidate['kind'] === 'string'
    && typeof candidate['author'] === 'string'
    && typeof candidate['x'] === 'number'
    && typeof candidate['y'] === 'number'
    && typeof candidate['color'] === 'string'
    && Array.isArray(candidate['imageSources'])
    && typeof candidate['createdAt'] === 'string'
    && typeof candidate['updatedAt'] === 'string';
}

function isIdeationConnectionRecord(value: unknown): value is IdeationConnectionRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate['id'] === 'string'
    && typeof candidate['fromCardId'] === 'string'
    && typeof candidate['toCardId'] === 'string'
    && typeof candidate['label'] === 'string';
}

async function loadIdeationBoard(workspaceRoot: string | undefined, ssotPath: string): Promise<IdeationBoardRecord> {
  if (!workspaceRoot) {
    return createDefaultIdeationBoard();
  }

  const boardPath = path.join(workspaceRoot, ssotPath, 'ideas', IDEATION_BOARD_FILE);
  try {
    const raw = await fs.readFile(boardPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<IdeationBoardRecord>;
    return sanitizeIdeationBoard(parsed);
  } catch {
    return createDefaultIdeationBoard();
  }
}

async function persistIdeationBoard(workspaceRoot: string | undefined, ssotPath: string, board: IdeationBoardRecord): Promise<void> {
  if (!workspaceRoot) {
    return;
  }

  const ideasDir = path.join(workspaceRoot, ssotPath, 'ideas');
  await fs.mkdir(ideasDir, { recursive: true });
  const sanitized = sanitizeIdeationBoard(board);
  await Promise.all([
    fs.writeFile(path.join(ideasDir, IDEATION_BOARD_FILE), JSON.stringify(sanitized, null, 2), 'utf-8'),
    fs.writeFile(path.join(ideasDir, IDEATION_SUMMARY_FILE), buildIdeationSummaryMarkdown(sanitized), 'utf-8'),
  ]);
}

function createDefaultIdeationBoard(): IdeationBoardRecord {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    cards: [],
    connections: [],
    lastAtlasResponse: '',
    nextPrompts: [
      'Who is the primary user, and what job are they trying to complete?',
      'What is the sharpest constraint or risk this project needs to survive?',
      'What is the smallest experiment that would validate the idea quickly?',
    ],
    history: [],
  };
}

function sanitizeIdeationBoard(value: Partial<IdeationBoardRecord> | IdeationBoardRecord): IdeationBoardRecord {
  const fallback = createDefaultIdeationBoard();
  const cards = Array.isArray(value.cards)
    ? value.cards.filter(isIdeationCardRecord).slice(0, MAX_IDEATION_CARDS).map(sanitizeIdeationCard)
    : fallback.cards;
  const cardIds = new Set(cards.map(card => card.id));
  const connections = Array.isArray(value.connections)
    ? value.connections
      .filter(isIdeationConnectionRecord)
      .filter(connection => cardIds.has(connection.fromCardId) && cardIds.has(connection.toCardId))
      .slice(0, MAX_IDEATION_CONNECTIONS)
      .map(connection => ({
        id: connection.id.trim() || createIdeationId('link'),
        fromCardId: connection.fromCardId,
        toCardId: connection.toCardId,
        label: clampText(connection.label, 36),
      }))
    : fallback.connections;
  const history = Array.isArray(value.history)
    ? value.history
      .filter((entry): entry is IdeationHistoryEntry => typeof entry === 'object' && entry !== null && (entry['role'] === 'user' || entry['role'] === 'atlas') && typeof entry['content'] === 'string' && typeof entry['timestamp'] === 'string')
      .slice(-MAX_IDEATION_HISTORY)
      .map(entry => ({ role: entry.role, content: clampText(entry.content, 800), timestamp: normalizeIso(entry.timestamp) }))
    : fallback.history;

  const focusCardId = typeof value.focusCardId === 'string' && cardIds.has(value.focusCardId) ? value.focusCardId : undefined;
  const nextPrompts = Array.isArray(value.nextPrompts)
    ? value.nextPrompts.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).slice(0, 6).map(entry => clampText(entry, 140))
    : fallback.nextPrompts;

  return {
    version: 1,
    updatedAt: normalizeIso(value.updatedAt),
    cards,
    connections,
    focusCardId,
    lastAtlasResponse: typeof value.lastAtlasResponse === 'string' ? clampText(value.lastAtlasResponse, 4000) : fallback.lastAtlasResponse,
    nextPrompts,
    history,
  };
}

function sanitizeIdeationCard(card: IdeationCardRecord): IdeationCardRecord {
  return {
    id: card.id.trim() || createIdeationId('card'),
    title: clampText(card.title, 80) || 'Untitled idea',
    body: clampText(card.body, 320),
    kind: isIdeationCardKind(card.kind) ? card.kind : 'concept',
    author: card.author === 'atlas' ? 'atlas' : 'user',
    x: clampNumber(card.x, -1600, 1600),
    y: clampNumber(card.y, -1200, 1200),
    color: normalizeIdeationColor(card.color),
    imageSources: Array.isArray(card.imageSources) ? card.imageSources.filter(source => typeof source === 'string').slice(0, 4) : [],
    createdAt: normalizeIso(card.createdAt),
    updatedAt: normalizeIso(card.updatedAt),
  };
}

function isIdeationCardKind(value: string): value is IdeationCardKind {
  return ['concept', 'insight', 'question', 'opportunity', 'risk', 'experiment', 'user-need', 'atlas-response', 'attachment'].includes(value);
}

function normalizeIdeationColor(value: string): string {
  const allowed = new Set(['sun', 'sea', 'mint', 'rose', 'sand', 'storm']);
  const normalized = value.trim().toLowerCase();
  return allowed.has(normalized) ? normalized : 'sun';
}

function normalizeIso(value: unknown): string {
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  return new Date().toISOString();
}

function clampText(value: string, limit: number): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, limit);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
}

function createIdeationId(prefix: 'card' | 'link'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildIdeationRelativePath(ssotPath: string, fileName: string): string {
  return `${ssotPath.replace(/\/$/, '')}/ideas/${fileName}`;
}

function summarizeIdeationBoard(board: IdeationBoardRecord): string {
  const cards = board.cards.slice(0, 10).map(card => `- [${card.kind}] ${card.title}: ${card.body}`).join('\n');
  const prompts = board.nextPrompts.map(prompt => `- ${prompt}`).join('\n');
  return [
    `Board cards: ${board.cards.length}.`,
    board.focusCardId ? `Focused card: ${board.cards.find(card => card.id === board.focusCardId)?.title ?? 'unknown'}.` : 'No focused card selected.',
    cards ? `Current board:\n${cards}` : 'Current board is empty.',
    prompts ? `Queued follow-up prompts:\n${prompts}` : 'No queued follow-up prompts.',
  ].join('\n\n');
}

function buildIdeationPrompt(
  prompt: string,
  board: IdeationBoardRecord,
  focusCard: IdeationCardRecord | undefined,
  attachments: TaskImageAttachment[],
): string {
  const boardSummary = summarizeIdeationBoard(board);
  const focusSummary = focusCard
    ? `Focused card:\nTitle: ${focusCard.title}\nType: ${focusCard.kind}\nBody: ${focusCard.body}`
    : 'There is no focused card yet. If the board is sparse, help bootstrap it.';
  const attachmentSummary = attachments.length > 0
    ? `Attached images:\n${attachments.map(attachment => `- ${attachment.source} (${attachment.mimeType})`).join('\n')}`
    : 'No images are attached for this ideation pass.';

  return [
    'You are AtlasMind running a project ideation workshop.',
    'Act like a structured facilitator: pressure-test the idea, surface user needs, risks, opportunities, and next experiments.',
    'Respond in markdown with concise, high-signal guidance for the user.',
    `After the markdown, append a JSON object inside <${IDEATION_RESPONSE_TAG}>...</${IDEATION_RESPONSE_TAG}> with this schema:`,
    '{"cards":[{"title":"string","body":"string","kind":"concept|insight|question|opportunity|risk|experiment|user-need","anchor":"center|north|east|south|west"}],"nextPrompts":["string"]}',
    'Return 2 to 5 cards. Keep card bodies short and actionable. Use anchors to spread cards around the focused card when relevant.',
    '',
    `User request: ${prompt}`,
    '',
    boardSummary,
    '',
    focusSummary,
    '',
    attachmentSummary,
  ].join('\n');
}

function parseIdeationResponse(response: string): IdeationResponseParseResult {
  const tagPattern = new RegExp(`<${IDEATION_RESPONSE_TAG}>([\\s\\S]*?)<\/${IDEATION_RESPONSE_TAG}>`, 'i');
  const match = response.match(tagPattern);
  const displayResponse = response.replace(tagPattern, '').trim();
  if (!match) {
    return {
      displayResponse: displayResponse || 'Atlas updated the ideation board.',
      cards: [{
        title: 'Atlas insight',
        body: clampText(displayResponse || 'Atlas updated the ideation board.', 220),
        kind: 'atlas-response',
        anchor: 'east',
      }],
      nextPrompts: [],
    };
  }

  try {
    const parsed = JSON.parse(match[1]) as Record<string, unknown>;
    const cards = Array.isArray(parsed['cards'])
      ? parsed['cards']
        .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
        .slice(0, 5)
        .map(entry => ({
          title: clampText(typeof entry['title'] === 'string' ? entry['title'] : 'Atlas insight', 80),
          body: clampText(typeof entry['body'] === 'string' ? entry['body'] : '', 220),
          kind: isIdeationCardKind(typeof entry['kind'] === 'string' ? entry['kind'] : '') ? entry['kind'] as IdeationCardKind : 'insight',
          anchor: isIdeationAnchor(typeof entry['anchor'] === 'string' ? entry['anchor'] : '') ? entry['anchor'] as IdeationAnchor : undefined,
        }))
      : [];
    const nextPrompts = Array.isArray(parsed['nextPrompts'])
      ? parsed['nextPrompts'].filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).slice(0, 6).map(entry => clampText(entry, 140))
      : [];

    return {
      displayResponse: displayResponse || 'Atlas updated the ideation board.',
      cards: cards.length > 0 ? cards : [{ title: 'Atlas insight', body: clampText(displayResponse || 'Atlas updated the ideation board.', 220), kind: 'atlas-response', anchor: 'east' }],
      nextPrompts,
    };
  } catch {
    return {
      displayResponse: displayResponse || 'Atlas updated the ideation board.',
      cards: [{ title: 'Atlas insight', body: clampText(displayResponse || 'Atlas updated the ideation board.', 220), kind: 'atlas-response', anchor: 'east' }],
      nextPrompts: [],
    };
  }
}

function isIdeationAnchor(value: string): value is IdeationAnchor {
  return ['center', 'north', 'east', 'south', 'west'].includes(value);
}

function applyIdeationResponse(
  board: IdeationBoardRecord,
  userPrompt: string,
  parsed: IdeationResponseParseResult,
  focusCardId: string | undefined,
  attachments: TaskImageAttachment[],
): IdeationBoardRecord {
  const nextBoard = sanitizeIdeationBoard(board);
  const now = new Date().toISOString();
  const focusCard = focusCardId ? nextBoard.cards.find(card => card.id === focusCardId) : undefined;
  const origin = focusCard ?? { x: 0, y: 0 };
  if (nextBoard.cards.length === 0) {
    nextBoard.cards.push({
      id: createIdeationId('card'),
      title: clampText(userPrompt, 80) || 'Project idea',
      body: clampText(userPrompt, 220),
      kind: 'concept',
      author: 'user',
      x: 0,
      y: 0,
      color: 'sun',
      imageSources: attachments.map(attachment => attachment.source).slice(0, 4),
      createdAt: now,
      updatedAt: now,
    });
  }
  const additions = parsed.cards.map((card, index) => createAtlasIdeationCard(card, origin.x, origin.y, index, attachments, now));

  nextBoard.cards = [...nextBoard.cards, ...additions].slice(-MAX_IDEATION_CARDS);
  const links = focusCard
    ? additions.map((card, index) => ({
      id: createIdeationId('link'),
      fromCardId: focusCard.id,
      toCardId: card.id,
      label: buildIdeationLinkLabel(card.kind, index),
    }))
    : [];
  nextBoard.connections = [...nextBoard.connections, ...links].slice(-MAX_IDEATION_CONNECTIONS);
  nextBoard.focusCardId = additions.at(0)?.id ?? nextBoard.focusCardId;
  nextBoard.lastAtlasResponse = parsed.displayResponse;
  nextBoard.nextPrompts = parsed.nextPrompts.length > 0 ? parsed.nextPrompts : nextBoard.nextPrompts;
  nextBoard.history = [
    ...nextBoard.history,
    { role: 'user' as const, content: clampText(userPrompt, 800), timestamp: now },
    { role: 'atlas' as const, content: parsed.displayResponse, timestamp: now },
  ].slice(-MAX_IDEATION_HISTORY);
  nextBoard.updatedAt = now;
  return sanitizeIdeationBoard(nextBoard);
}

function createAtlasIdeationCard(
  suggestion: IdeationStructuredSuggestion,
  baseX: number,
  baseY: number,
  index: number,
  attachments: TaskImageAttachment[],
  timestamp: string,
): IdeationCardRecord {
  const offset = ideationOffsetForAnchor(suggestion.anchor, index);
  return {
    id: createIdeationId('card'),
    title: clampText(suggestion.title, 80) || 'Atlas insight',
    body: clampText(suggestion.body, 220),
    kind: suggestion.kind,
    author: 'atlas',
    x: clampNumber(baseX + offset.x, -1600, 1600),
    y: clampNumber(baseY + offset.y, -1200, 1200),
    color: ideationColorForKind(suggestion.kind),
    imageSources: attachments.map(attachment => attachment.source).slice(0, 4),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function ideationOffsetForAnchor(anchor: IdeationAnchor | undefined, index: number): { x: number; y: number } {
  const fallbacks = [
    { x: 220, y: -84 },
    { x: 240, y: 54 },
    { x: 0, y: 200 },
    { x: -240, y: 54 },
    { x: -220, y: -84 },
  ];
  switch (anchor) {
    case 'north': return { x: 0, y: -220 };
    case 'east': return { x: 250, y: (index - 1) * 50 };
    case 'south': return { x: 0, y: 220 };
    case 'west': return { x: -250, y: (index - 1) * 50 };
    case 'center': return { x: 40 * index, y: 40 * index };
    default: return fallbacks[index % fallbacks.length];
  }
}

function ideationColorForKind(kind: IdeationCardKind): string {
  switch (kind) {
    case 'risk': return 'rose';
    case 'question': return 'sea';
    case 'experiment': return 'storm';
    case 'opportunity': return 'mint';
    case 'user-need': return 'sand';
    case 'atlas-response': return 'sea';
    default: return 'sun';
  }
}

function buildIdeationLinkLabel(kind: IdeationCardKind, index: number): string {
  if (kind === 'question') {
    return 'question';
  }
  if (kind === 'risk') {
    return 'risk';
  }
  if (kind === 'experiment') {
    return 'test';
  }
  return index === 0 ? 'expands' : 'supports';
}

function buildIdeationSummaryMarkdown(board: IdeationBoardRecord): string {
  const cards = board.cards.map(card => `- **${card.title}** [${card.kind}] (${card.author})\n  ${card.body || 'No notes yet.'}`).join('\n');
  const connections = board.connections.map(connection => `- ${connection.fromCardId} -> ${connection.toCardId}${connection.label ? ` (${connection.label})` : ''}`).join('\n');
  const prompts = board.nextPrompts.map(prompt => `- ${prompt}`).join('\n');
  return [
    '# AtlasMind Ideation Board',
    '',
    `Updated: ${board.updatedAt}`,
    '',
    '## Latest Atlas feedback',
    '',
    board.lastAtlasResponse || 'No Atlas feedback captured yet.',
    '',
    '## Cards',
    '',
    cards || '- No ideation cards yet.',
    '',
    '## Connections',
    '',
    connections || '- No connections yet.',
    '',
    '## Next prompts',
    '',
    prompts || '- No follow-up prompts yet.',
  ].join('\n');
}

function toDashboardBudgetMode(value: string | undefined): 'cheap' | 'balanced' | 'expensive' | 'auto' {
  return value === 'cheap' || value === 'balanced' || value === 'expensive' || value === 'auto' ? value : 'balanced';
}

function toDashboardSpeedMode(value: string | undefined): 'fast' | 'balanced' | 'considered' | 'auto' {
  return value === 'fast' || value === 'balanced' || value === 'considered' || value === 'auto' ? value : 'balanced';
}

function buildHealthSummary(input: { healthScore: number; blockedEntries: number; autopilot: boolean; dirty: boolean; workflowCount: number; outcomeScore: number }): string {
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
  if (input.outcomeScore < 55) {
    return 'The desired project outcome is documented only loosely. Translate the vision into roadmap evidence and execution telemetry.';
  }
  if (input.healthScore >= 85) {
    return 'Project signals look healthy: governance, SSOT coverage, delivery scaffolding, and outcome completeness are broadly aligned.';
  }
  return 'Core signals are present, but governance, SSOT coverage, delivery scaffolding, or outcome completeness still have visible gaps.';
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

function normalizeVerificationScripts(value: string[] | string | undefined): string {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map(entry => entry.trim())
      .filter(Boolean)
      .join(', ');
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  return '';
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
  .branch-card,
  .signal-card {
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

  .tag-good {
    border-color: color-mix(in srgb, var(--dash-good) 65%, var(--dash-border));
    color: color-mix(in srgb, var(--dash-good) 85%, white 15%);
    background: color-mix(in srgb, var(--dash-good) 16%, transparent);
  }

  .tag-warn {
    border-color: color-mix(in srgb, var(--dash-warn) 65%, var(--dash-border));
    color: color-mix(in srgb, var(--dash-warn) 86%, white 14%);
    background: color-mix(in srgb, var(--dash-warn) 14%, transparent);
  }

  .tag-critical {
    border-color: color-mix(in srgb, var(--dash-critical) 70%, var(--dash-border));
    color: color-mix(in srgb, var(--dash-critical) 86%, white 14%);
    background: color-mix(in srgb, var(--dash-critical) 14%, transparent);
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

  .signal-card:hover,
  .signal-card:focus-visible,
  .score-recommendation-item:hover,
  .score-recommendation-item:focus-visible {
    border-color: color-mix(in srgb, var(--dash-accent) 45%, var(--dash-border));
    transform: translateY(-1px);
  }

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

  .score-summary-grid,
  .score-recommendation-grid {
    display: grid;
    gap: 16px;
  }

  .score-summary-grid {
    grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
  }

  .score-recommendation-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .score-component-list {
    display: grid;
    gap: 12px;
  }

  .score-component-row,
  .score-recommendation-item {
    width: 100%;
    text-align: left;
  }

  .score-component-row {
    display: grid;
    gap: 8px;
    border: 1px solid var(--dash-border);
    border-radius: 16px;
    background: color-mix(in srgb, var(--dash-panel) 90%, transparent);
    padding: 14px;
  }

  .score-component-row:hover,
  .score-component-row:focus-visible {
    border-color: color-mix(in srgb, var(--dash-accent) 45%, var(--dash-border));
    transform: translateY(-1px);
  }

  .score-component-bar {
    height: 8px;
  }

  .score-outcome-card .mini-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-top: 12px;
  }

  .ideation-shell,
  .ideation-lower-grid {
    display: grid;
    gap: 16px;
  }

  .ideation-shell {
    grid-template-columns: minmax(320px, 0.9fr) minmax(0, 1.4fr);
    align-items: start;
  }

  .ideation-lower-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .ideation-panel {
    border: 1px solid var(--dash-border);
    border-radius: var(--dash-radius);
    background: linear-gradient(180deg, color-mix(in srgb, var(--dash-panel-strong) 92%, white 8%), var(--dash-panel));
    box-shadow: var(--dash-shadow);
    padding: 18px;
  }

  .ideation-panel-control,
  .ideation-inspector-card,
  .ideation-response-card,
  .ideation-thread-card {
    display: grid;
    gap: 12px;
  }

  .ideation-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--dash-muted);
  }

  .ideation-prompt,
  .ideation-textarea,
  .ideation-input,
  .ideation-select {
    width: 100%;
    box-sizing: border-box;
    border-radius: 16px;
    border: 1px solid var(--dash-border);
    background: color-mix(in srgb, var(--dash-panel) 90%, var(--vscode-input-background) 10%);
    color: var(--vscode-foreground);
    padding: 12px 14px;
    font: inherit;
  }

  .ideation-prompt,
  .ideation-textarea {
    min-height: 120px;
    resize: vertical;
  }

  .ideation-action-row,
  .ideation-attachment-row,
  .ideation-chip-row {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .ideation-status-card {
    padding: 14px;
    border-radius: 18px;
    border: 1px solid color-mix(in srgb, var(--dash-accent) 34%, var(--dash-border));
    background: color-mix(in srgb, var(--dash-accent) 10%, transparent);
  }

  .attachment-pill,
  .ideation-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 999px;
    border: 1px solid var(--dash-border);
    background: color-mix(in srgb, var(--dash-panel) 82%, transparent);
    font-size: 12px;
  }

  .ideation-chip {
    cursor: pointer;
  }

  .ideation-panel-board {
    display: grid;
    gap: 12px;
  }

  .ideation-board-stage {
    position: relative;
    min-height: 760px;
    overflow: hidden;
    border-radius: 22px;
    border: 1px solid var(--dash-border);
    background:
      radial-gradient(circle at top left, color-mix(in srgb, var(--dash-accent) 16%, transparent), transparent 34%),
      linear-gradient(180deg, color-mix(in srgb, var(--dash-panel) 82%, black 18%), color-mix(in srgb, var(--dash-panel-strong) 90%, black 10%));
  }

  .ideation-board-stage::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(color-mix(in srgb, var(--dash-border) 32%, transparent) 1px, transparent 1px),
      linear-gradient(90deg, color-mix(in srgb, var(--dash-border) 32%, transparent) 1px, transparent 1px);
    background-size: 32px 32px;
    pointer-events: none;
    opacity: 0.5;
  }

  .ideation-connections {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .ideation-link {
    fill: none;
    stroke: color-mix(in srgb, var(--dash-accent) 58%, white 22%);
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-dasharray: 10 8;
    opacity: 0.78;
  }

  .ideation-link-label {
    fill: var(--dash-muted);
    font-family: var(--dash-body);
    font-size: 12px;
    text-anchor: middle;
  }

  .ideation-card {
    position: absolute;
    width: 220px;
    min-height: 132px;
    padding: 14px 14px 16px;
    text-align: left;
    display: grid;
    gap: 10px;
    border-radius: 20px;
    border: 1px solid var(--dash-border);
    box-shadow: 0 16px 30px rgba(0, 0, 0, 0.22);
    transform: translate(-50%, -50%);
    cursor: pointer;
    transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
  }

  .ideation-card:hover,
  .ideation-card:focus-visible {
    transform: translate(-50%, -52%);
  }

  .ideation-card.selected {
    border-color: color-mix(in srgb, var(--dash-accent) 78%, white 22%);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--dash-accent) 60%, transparent), 0 20px 36px rgba(0, 0, 0, 0.28);
  }

  .ideation-card.focused {
    outline: 2px solid color-mix(in srgb, var(--dash-good) 68%, white 22%);
    outline-offset: 2px;
  }

  .ideation-card-head {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    align-items: center;
    cursor: grab;
  }

  .ideation-card-head:active {
    cursor: grabbing;
  }

  .ideation-card-type {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: color-mix(in srgb, var(--vscode-foreground) 66%, white 34%);
  }

  .ideation-card strong {
    font-size: 18px;
    line-height: 1.15;
  }

  .ideation-card p {
    margin: 0;
    color: color-mix(in srgb, var(--vscode-foreground) 74%, white 26%);
    font-size: 13px;
    line-height: 1.45;
  }

  .ideation-card-sun {
    background: linear-gradient(180deg, #ffd978, #f1a844);
    color: #37220b;
  }

  .ideation-card-sea {
    background: linear-gradient(180deg, #8ad8ff, #4099d0);
    color: #0e2431;
  }

  .ideation-card-mint {
    background: linear-gradient(180deg, #b8f2cc, #60c78e);
    color: #133021;
  }

  .ideation-card-rose {
    background: linear-gradient(180deg, #ffc0c9, #ea6f84);
    color: #35141d;
  }

  .ideation-card-sand {
    background: linear-gradient(180deg, #f0dcc0, #c89f73);
    color: #312113;
  }

  .ideation-card-storm {
    background: linear-gradient(180deg, #b8c5e8, #6d7ea8);
    color: #151d2f;
  }

  .ideation-empty-state,
  .ideation-empty-mini {
    display: grid;
    place-items: center;
    text-align: center;
    color: var(--dash-muted);
  }

  .ideation-empty-state {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .ideation-empty-mini {
    min-height: 180px;
  }

  .ideation-board-hint {
    color: var(--dash-muted);
    font-size: 12px;
  }

  .ideation-inspector-grid {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ideation-response-box {
    min-height: 260px;
    padding: 16px;
    border-radius: 18px;
    border: 1px solid var(--dash-border);
    background: color-mix(in srgb, var(--dash-panel) 88%, black 12%);
    line-height: 1.6;
    overflow: auto;
  }

  .ideation-history-list {
    display: grid;
    gap: 10px;
  }

  .ideation-history-item {
    cursor: default;
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
    .review-grid,
    .ideation-lower-grid { grid-template-columns: 1fr; }
    .action-grid,
    .panel-grid,
    .repo-grid,
    .hero-grid,
    .ideation-shell { grid-template-columns: 1fr; }
  }

    .score-summary-grid,
    .score-recommendation-grid,
  @media (max-width: 820px) {
    .dashboard-shell { padding: 16px; }
    .stats-grid,
    .signal-grid { grid-template-columns: 1fr; }
  }

    .score-outcome-card .mini-grid { grid-template-columns: 1fr; }
  @keyframes dashBarRise {
    from { transform: scaleY(0.2); opacity: 0.25; }
    to { transform: scaleY(1); opacity: 0.92; }
  }
`;
