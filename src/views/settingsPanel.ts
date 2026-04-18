import * as path from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import * as vscode from 'vscode';
import { getConfiguredLocalEndpoints, inferLocalEndpointLabel, type LocalEndpointConfig } from '../providers/index.js';
import { RECOMMENDED_MCP_SERVERS, getRecommendedMcpStarterDetails } from '../constants.js';
import { escapeHtml, getWebviewHtmlShell } from './webviewUtils.js';

const BUDGET_MODES = ['cheap', 'balanced', 'expensive', 'auto'] as const;
const SPEED_MODES = ['fast', 'balanced', 'considered', 'auto'] as const;
const BUDGET_MODE_HELP = {
  cheap: 'Excludes expensive model tiers and strongly favors the lowest-cost eligible options. Best for quick edits, light investigation, and scratchpad work where cost matters more than peak capability.',
  balanced: 'Keeps a practical middle ground between price and capability. This is the safest day-to-day default for most coding, debugging, and review work.',
  expensive: 'Allows the full model catalog, including the highest-cost tiers, so AtlasMind can spend more freely on difficult reasoning, architecture, or migration tasks.',
  auto: 'Lets the task profiler infer the budget level from the current request. Use this when your workload swings between quick fixes and deeper analysis.',
} as const;
const SPEED_MODE_HELP = {
  fast: 'Excludes slower reasoning-heavy routes and prefers lower-latency models. Best for tight feedback loops, short follow-ups, and rapid iteration.',
  balanced: 'Keeps a middle ground between responsiveness and reasoning depth. This is the most stable default when you want solid results without over-tuning.',
  considered: 'Allows slower, deeper reasoning routes and longer deliberation. Best for ambiguous debugging, design work, and other problems that benefit from more thought.',
  auto: 'Lets the task profiler infer the speed level from the current request. Use this when some tasks need instant turnaround and others need deeper reasoning.',
} as const;
const DEPENDENCY_MONITORING_PROVIDERS = ['dependabot', 'renovate', 'snyk', 'azure-devops'] as const;
const DEPENDENCY_MONITORING_SCHEDULES = ['daily', 'weekly', 'monthly'] as const;
const DEFAULT_PROJECT_APPROVAL_FILE_THRESHOLD = 12;
const DEFAULT_ESTIMATED_FILES_PER_SUBTASK = 2;
const DEFAULT_CHANGED_FILE_REFERENCE_LIMIT = 5;
const DEFAULT_PROJECT_RUN_REPORT_FOLDER = 'project_memory/operations';
const TEST_SCAN_EXCLUDED_DIRS = new Set(['.git', '.next', '.turbo', 'coverage', 'dist', 'node_modules', 'out', 'project_memory']);
const TEST_FILE_NAME_PATTERN = /(?:^|[.-])(test|spec)\.[cm]?[jt]sx?$/i;
const TEST_CODE_EXT_PATTERN = /\.[cm]?[jt]sx?$/i;
const MAX_DISCOVERED_TEST_FILES = 200;
const MAX_DISCOVERED_TEST_CASES = 600;
const MAX_TEST_FILE_BYTES = 128_000;
const SETTINGS_HELP = {
  budgetMode: 'Budget preference for model selection. Examples: use cheap for scratchpad work, balanced for daily coding, expensive for architecture or migration work, and auto for mixed team workloads.',
  feedbackRoutingWeight: 'Controls how strongly saved thumbs up/down history nudges future model selection. Use 0 to disable feedback-weighted routing, 1 for the default slight influence, or values up to 2 for a somewhat stronger but still capped bias.',
  dailyCostLimitUsd: 'Daily cost cap in USD. Use 0 to disable it. Examples: 5 for an individual guardrail, 20 for a shared team budget, or 0 for unrestricted experimentation.',
  speedMode: 'Speed preference for model selection. Examples: fast for tight feedback loops, balanced for normal work, considered for deeper reasoning, and auto when workloads vary.',
  showImportProjectAction: 'Controls whether the Memory toolbar keeps the Import Existing Project action visible. Keep it on during onboarding and turn it off in already standardized repos.',
  chatSessionTurnLimit: 'How many recent chat turns AtlasMind carries forward. Examples: 4 for short task chats, 6 for the default balance, or 10 when long debugging context matters.',
  chatSessionContextChars: 'Maximum characters reserved for summarized carry-forward context. Examples: 1200 for lightweight carry-forward, 2500 for default use, or 4000+ for complex multi-step work.',
  localOpenAiBaseUrl: 'Legacy single-endpoint fallback for local OpenAI-compatible routing. AtlasMind now prefers the structured local endpoint list when it is present.',
  localOpenAiEndpoints: 'Configure one or more labeled local OpenAI-compatible endpoints. Examples: Ollama at http://127.0.0.1:11434/v1 and LM Studio at http://127.0.0.1:1234/v1. Labels are shown back in provider surfaces so operators can tell which engine owns each routed model.',
  toolApprovalMode: 'Main approval policy for tool execution. Examples: always-ask for regulated repos, ask-on-write for normal coding, ask-on-external for tighter network boundaries, or allow-safe-readonly for investigation-only work.',
  allowTerminalWrite: 'Allows write-capable terminal subprocesses after approval. Enable it in a sandbox where installs and commits are expected, and keep it off where terminal mutations require separate controls.',
  autoVerifyAfterWrite: 'Runs configured verification scripts after successful workspace writes. Enable it for immediate lint or test feedback, or disable it when validation happens elsewhere.',
  autoVerifyScripts: 'Comma-separated package script names AtlasMind runs after writes. Examples: test, lint, compile or test:unit, test:manifest, typecheck.',
  autoVerifyTimeoutMs: 'Maximum time per verification script in milliseconds. Examples: 30000 for fast local checks, 120000 for mixed lint or test workflows, or 300000 for slower pipelines.',
  voiceTtsEnabled: 'Automatically speak AtlasMind freeform responses aloud through the configured voice backend. Keep it off for silent text-only work or enable it for hands-free review and accessibility workflows.',
  voiceRate: 'Speech playback rate for text-to-speech output. Use lower values for careful listening and higher values when reviewing long responses quickly.',
  voicePitch: 'Speech playback pitch for text-to-speech output. Adjust this for comfort and intelligibility rather than correctness.',
  voiceVolume: 'Speech playback volume for text-to-speech output. Set 0 to stay muted while keeping TTS enabled for quick toggling.',
  voiceLanguage: 'BCP 47 language tag for speech synthesis and recognition, such as en-US or fr-FR. Leave it empty to use the browser or OS default language.',
  voiceOutputDeviceId: 'Preferred speaker device id for supported voice backends. Leave it empty to use the system default output device.',
  projectApprovalFileThreshold: 'Estimated changed-file threshold that triggers /project approval gating. Examples: 6 in small repos, 12 as a default balance, or 20+ in monorepos where broader edits are normal.',
  projectEstimatedFilesPerSubtask: 'Heuristic multiplier used to estimate changed files from planned subtasks. Examples: 1 for isolated modules, 2 for typical services, or 3 to 4 for layered shared platforms.',
  projectChangedFileReferenceLimit: 'Maximum number of changed files surfaced as clickable references after /project runs. Examples: 3 for compact summaries, 5 for default use, or 10 for review-heavy workflows.',
  projectRunReportFolder: 'Workspace-relative folder for persisted /project run summary JSON reports. Examples: project_memory/operations, docs/atlasmind/runs, or ops/atlasmind/run-reports.',
  projectDependencyMonitoringEnabled: 'Controls whether AtlasMind bootstrapping scaffolds dependency monitoring defaults for Atlas-built projects. Turn it on for team templates and off when governance is provisioned elsewhere.',
  projectDependencyMonitoringProviders: 'Selects which dependency monitoring providers AtlasMind scaffolds. Examples: Dependabot for GitHub-native repos, Renovate for advanced grouping, Snyk for security-led review, or Azure DevOps for pipeline-centric teams.',
  projectDependencyMonitoringSchedule: 'Default cadence for generated dependency monitoring automation. Examples: daily for security-sensitive services, weekly for normal review cycles, or monthly for stable products.',
  projectDependencyMonitoringIssueTemplate: 'Adds a dependency review issue template during governance scaffolding. Keep it on when updates need formal review or compliance evidence, and off for lightweight personal repos.',
  experimentalSkillLearningEnabled: 'Enables Atlas-generated custom skill drafts. Keep it off in production workspaces and enable it only in sandboxes where generated artifacts will be manually reviewed.',
  maxToolIterations: 'Maximum tool-call loop iterations before AtlasMind stops and surfaces Continue and Cancel actions. Examples: 10 for conservative environments, 20 for the default balance, or 25 for complex multi-step workflows. Higher values allow deeper automation but increase latency and cost.',
} as const;

type BudgetMode = (typeof BUDGET_MODES)[number];
type SpeedMode = (typeof SPEED_MODES)[number];
type DependencyMonitoringProvider = (typeof DEPENDENCY_MONITORING_PROVIDERS)[number];
type DependencyMonitoringSchedule = (typeof DEPENDENCY_MONITORING_SCHEDULES)[number];
type SettingsHelpId = keyof typeof SETTINGS_HELP;

export interface TestingFileSummary {
  relativePath: string;
  category: 'unit' | 'integration' | 'e2e' | 'other';
  suites: number;
  cases: number;
  lastModifiedLabel: string;
}

export interface TestingCaseSummary {
  id: string;
  title: string;
  suiteTitle: string;
  relativePath: string;
  category: 'unit' | 'integration' | 'e2e' | 'other';
  line: number;
  description: string;
  inputSummary: string;
  outputSummary: string;
}

export interface TestingDashboardCategoryCount {
  key: 'unit' | 'integration' | 'e2e' | 'other';
  label: string;
  count: number;
}

export interface TestingDashboardSnapshot {
  frameworkLabel: string;
  testingPolicyLabel: string;
  testingPolicyDetail: string;
  totalFiles: number;
  totalSuites: number;
  totalCases: number;
  unitFiles: number;
  integrationFiles: number;
  e2eFiles: number;
  averageCasesPerFile: string;
  coveragePercent?: string;
  coverageDetail: string;
  packageScripts: string[];
  configFiles: string[];
  coverageReportRelativePath?: string;
  coverageDataRelativePath?: string;
  files: TestingFileSummary[];
  tests: TestingCaseSummary[];
  categoryCounts: TestingDashboardCategoryCount[];
  verificationEnabled: boolean;
  verificationScripts: string[];
}

export const SETTINGS_PAGE_IDS = ['overview', 'chat', 'models', 'safety', 'testing', 'project', 'experimental'] as const;
export type SettingsPageId = (typeof SETTINGS_PAGE_IDS)[number];
export interface SettingsPanelTarget {
  page?: SettingsPageId;
  query?: string;
  section?: string;
}

type SettingsMessage =
  | { type: 'setBudgetMode'; payload: BudgetMode }
  | { type: 'setSpeedMode'; payload: SpeedMode }
  | { type: 'setFeedbackRoutingWeight'; payload: number }
  | { type: 'setLocalOpenAiBaseUrl'; payload: string }
  | { type: 'setLocalOpenAiEndpoints'; payload: LocalEndpointConfig[] }
  | { type: 'setDailyCostLimitUsd'; payload: number }
  | { type: 'setShowImportProjectAction'; payload: boolean }
  | { type: 'setToolApprovalMode'; payload: 'always-ask' | 'ask-on-write' | 'ask-on-external' | 'allow-safe-readonly' }
  | { type: 'setAllowTerminalWrite'; payload: boolean }
  | { type: 'setAutoVerifyAfterWrite'; payload: boolean }
  | { type: 'setAutoVerifyScripts'; payload: string }
  | { type: 'setAutoVerifyTimeoutMs'; payload: number }
  | { type: 'setVoiceTtsEnabled'; payload: boolean }
  | { type: 'setVoiceRate'; payload: number }
  | { type: 'setVoicePitch'; payload: number }
  | { type: 'setVoiceVolume'; payload: number }
  | { type: 'setVoiceLanguage'; payload: string }
  | { type: 'setVoiceOutputDeviceId'; payload: string }
  | { type: 'setChatSessionTurnLimit'; payload: number }
  | { type: 'setChatSessionContextChars'; payload: number }
  | { type: 'setProjectApprovalFileThreshold'; payload: number }
  | { type: 'setProjectEstimatedFilesPerSubtask'; payload: number }
  | { type: 'setProjectChangedFileReferenceLimit'; payload: number }
  | { type: 'setProjectRunReportFolder'; payload: string }
  | { type: 'setProjectDependencyMonitoringEnabled'; payload: boolean }
  | { type: 'setProjectDependencyMonitoringProviders'; payload: DependencyMonitoringProvider[] }
  | { type: 'setProjectDependencyMonitoringSchedule'; payload: DependencyMonitoringSchedule }
  | { type: 'setProjectDependencyMonitoringIssueTemplate'; payload: boolean }
  | { type: 'setExperimentalSkillLearningEnabled'; payload: boolean }
  | { type: 'setMaxToolIterations'; payload: number }
  | { type: 'purgeProjectMemory' }
  | { type: 'openChatView' }
  | { type: 'openChatPanel' }
  | { type: 'openModelProviders' }
  | { type: 'openSpecialistIntegrations' }
  | { type: 'openProjectRunCenter' }
  | { type: 'openVoicePanel' }
  | { type: 'openVisionPanel' }
  | { type: 'openChat' }
  | { type: 'refreshTestingInventory' }
  | { type: 'createTestFile' }
  | { type: 'openCoverageReport' }
  | { type: 'openWorkspaceFile'; payload: string };

/**
 * Settings webview panel – budget/speed modes plus /project execution controls.
 */
export class SettingsPanel {
  public static currentPanel: SettingsPanel | undefined;
  private static readonly viewType = 'atlasmind.settings';
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionVersion: string;
  private initialTarget?: SettingsPanelTarget;
  private disposables: vscode.Disposable[] = [];
  private readonly atlasContext?: import('../extension').AtlasMindContext;

  public static createOrShow(context: vscode.ExtensionContext, target?: SettingsPageId | SettingsPanelTarget, atlasContext?: import('../extension').AtlasMindContext): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    const normalizedTarget = normalizeSettingsPanelTarget(target);

    if (SettingsPanel.currentPanel) {
      SettingsPanel.currentPanel.panel.reveal(column);
      if (normalizedTarget.page || normalizedTarget.query || normalizedTarget.section) {
        void SettingsPanel.currentPanel.retarget(normalizedTarget);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      SettingsPanel.viewType,
      'AtlasMind Settings',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );

    const extensionVersion = String(context.extension.packageJSON?.version ?? 'unknown');
    SettingsPanel.currentPanel = new SettingsPanel(panel, normalizedTarget, extensionVersion, atlasContext);
  }

  private constructor(panel: vscode.WebviewPanel, initialTarget: SettingsPanelTarget | undefined, extensionVersion: string, atlasContext?: import('../extension').AtlasMindContext) {
    this.panel = panel;
    this.initialTarget = initialTarget;
    this.extensionVersion = extensionVersion;
    this.atlasContext = atlasContext;
    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      message => {
        void this.handleMessage(message);
      },
      null,
      this.disposables,
    );

    void this.migrateLegacyLocalOpenAiSettings();
  }

  private dispose(): void {
    SettingsPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private async retarget(target: SettingsPanelTarget): Promise<void> {
    this.initialTarget = target;
    this.panel.webview.html = this.getHtml();
    await this.migrateLegacyLocalOpenAiSettings();
  }

  private async migrateLegacyLocalOpenAiSettings(): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const migratedEndpoints = await migrateLegacyLocalOpenAiSettings(configuration);
    if (!migratedEndpoints || migratedEndpoints.length === 0) {
      return;
    }

    await this.panel.webview.postMessage({
      type: 'syncLocalOpenAiEndpoints',
      payload: migratedEndpoints,
    });
  }

  private async handleMessage(message: unknown): Promise<void> {
    // MCP server install message is not a standard settings message
    if (message && typeof message === 'object' && (message as any).type === 'installMcpServer') {
      await this.handleInstallMcpServer((message as any).payload);
      return;
    }
    if (!isSettingsMessage(message)) {
      return;
    }

    const configuration = vscode.workspace.getConfiguration('atlasmind');
    switch (message.type) {
      case 'setBudgetMode':
        await configuration.update('budgetMode', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setDailyCostLimitUsd':
        await configuration.update('dailyCostLimitUsd', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setSpeedMode':
        await configuration.update('speedMode', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setFeedbackRoutingWeight':
        await configuration.update('feedbackRoutingWeight', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setLocalOpenAiBaseUrl': {
        const normalized = normalizeLocalOpenAiBaseUrl(message.payload);
        if (!normalized) {
          return;
        }
        await configuration.update('localOpenAiBaseUrl', normalized, vscode.ConfigurationTarget.Workspace);
        return;
      }

      case 'setLocalOpenAiEndpoints': {
        const normalized = normalizeLocalOpenAiEndpoints(message.payload);
        await configuration.update('localOpenAiEndpoints', normalized, vscode.ConfigurationTarget.Workspace);
        await configuration.update('localOpenAiBaseUrl', normalized[0]?.baseUrl ?? '', vscode.ConfigurationTarget.Workspace);
        return;
      }

      case 'setToolApprovalMode':
        await configuration.update('toolApprovalMode', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setShowImportProjectAction':
        await configuration.update('showImportProjectAction', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setAllowTerminalWrite':
        await configuration.update('allowTerminalWrite', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setAutoVerifyAfterWrite':
        await configuration.update('autoVerifyAfterWrite', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setAutoVerifyScripts': {
        const scripts = message.payload
          .split(',')
          .map(value => value.trim())
          .filter(value => /^[A-Za-z0-9:_-]+$/.test(value));
        await configuration.update('autoVerifyScripts', scripts, vscode.ConfigurationTarget.Workspace);
        return;
      }

      case 'setAutoVerifyTimeoutMs':
        await configuration.update('autoVerifyTimeoutMs', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setVoiceTtsEnabled':
        await configuration.update('voice.ttsEnabled', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setVoiceRate':
        await configuration.update('voice.rate', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setVoicePitch':
        await configuration.update('voice.pitch', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setVoiceVolume':
        await configuration.update('voice.volume', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setVoiceLanguage':
        await configuration.update('voice.language', message.payload.trim(), vscode.ConfigurationTarget.Workspace);
        return;

      case 'setVoiceOutputDeviceId':
        await configuration.update('voice.outputDeviceId', message.payload.trim(), vscode.ConfigurationTarget.Workspace);
        return;

      case 'setChatSessionTurnLimit':
        await configuration.update('chatSessionTurnLimit', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setChatSessionContextChars':
        await configuration.update('chatSessionContextChars', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setProjectApprovalFileThreshold':
        await configuration.update('projectApprovalFileThreshold', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setProjectEstimatedFilesPerSubtask':
        await configuration.update('projectEstimatedFilesPerSubtask', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setProjectChangedFileReferenceLimit':
        await configuration.update('projectChangedFileReferenceLimit', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setProjectRunReportFolder': {
        const folder = message.payload;
        // Reject paths that attempt directory traversal or use absolute paths
        if (/\.\.[\\/]/.test(folder) || /^[\\/]/.test(folder) || /^[A-Za-z]:/.test(folder)) {
          return;
        }
        await configuration.update('projectRunReportFolder', folder, vscode.ConfigurationTarget.Workspace);
        return;
      }

      case 'setProjectDependencyMonitoringEnabled':
        await configuration.update('projectDependencyMonitoringEnabled', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setProjectDependencyMonitoringProviders':
        await configuration.update('projectDependencyMonitoringProviders', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setProjectDependencyMonitoringSchedule':
        await configuration.update('projectDependencyMonitoringSchedule', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setProjectDependencyMonitoringIssueTemplate':
        await configuration.update('projectDependencyMonitoringIssueTemplate', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setExperimentalSkillLearningEnabled': {
        if (message.payload) {
          const proceed = await vscode.window.showWarningMessage(
            'Experimental skill learning will spend model tokens and may generate unsafe or incorrect code. Generated skills are scanned, but they still require manual review before use. Enable anyway?',
            { modal: true },
            'Enable',
          );
          const enabled = proceed === 'Enable';
          if (enabled) {
            await configuration.update('experimentalSkillLearningEnabled', true, vscode.ConfigurationTarget.Workspace);
          }
          await this.panel.webview.postMessage({ type: 'syncExperimentalSkillLearningEnabled', payload: enabled });
          return;
        }

        await configuration.update('experimentalSkillLearningEnabled', false, vscode.ConfigurationTarget.Workspace);
        await this.panel.webview.postMessage({ type: 'syncExperimentalSkillLearningEnabled', payload: false });
        return;
      }

      case 'setMaxToolIterations': {
        const clamped = Math.max(1, Math.min(50, Math.round(message.payload)));
        await configuration.update('maxToolIterations', clamped, vscode.ConfigurationTarget.Workspace);
        return;
      }

      case 'purgeProjectMemory':
        await vscode.commands.executeCommand('atlasmind.purgeProjectMemory');
        return;

      case 'openModelProviders':
        await vscode.commands.executeCommand('atlasmind.openModelProviders');
        return;

      case 'openSpecialistIntegrations':
        await vscode.commands.executeCommand('atlasmind.openSpecialistIntegrations');
        return;

      case 'openChatView':
        await vscode.commands.executeCommand('atlasmind.openChatView');
        return;

      case 'openChatPanel':
        await vscode.commands.executeCommand('atlasmind.openChatPanel');
        return;

      case 'openProjectRunCenter':
        await vscode.commands.executeCommand('atlasmind.openProjectRunCenter');
        return;

      case 'openVoicePanel':
        await vscode.commands.executeCommand('atlasmind.openVoicePanel');
        return;

      case 'openVisionPanel':
        await vscode.commands.executeCommand('atlasmind.openVisionPanel');
        return;

      case 'openChat':
        await vscode.commands.executeCommand('workbench.action.chat.open');
        return;

      case 'refreshTestingInventory':
        this.panel.webview.html = this.getHtml();
        return;

      case 'createTestFile':
        await this.createTestFile();
        return;

      case 'openCoverageReport':
        await this.openCoverageReport();
        return;

      case 'openWorkspaceFile':
        await this.openWorkspaceFile(message.payload);
        return;
    }
  }

  private async handleInstallMcpServer(payload: unknown): Promise<void> {
    const candidate = payload && typeof payload === 'object'
      ? payload as { id?: unknown; name?: unknown; docsUrl?: unknown }
      : undefined;
    const name = typeof candidate?.name === 'string' && candidate.name.trim().length > 0
      ? candidate.name.trim()
      : 'Selected MCP server';
    const starter = typeof candidate?.id === 'string'
      ? getRecommendedMcpStarterDetails(candidate.id)
      : undefined;

    await vscode.commands.executeCommand('atlasmind.mcpServers.installRecommended', candidate);

    void this.panel.webview.postMessage({
      type: 'status',
      payload: starter?.setupMode === 'prefill'
        ? `${name} is being installed with its verified CLI preset. AtlasMind will also try to bootstrap the required local runtime automatically through a supported package manager on this operating system.`
        : `${name} still needs manual setup, so AtlasMind opened the MCP Add Server workspace with the audited starter details.`,
    });
  }

  private async openWorkspaceFile(relativePath: string): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return;
    }

    const resolved = resolveWorkspaceRelativePath(workspaceRoot, relativePath);
    if (!resolved || !existsSync(resolved)) {
      await vscode.window.showWarningMessage('That workspace file is no longer available.');
      return;
    }

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved));
    await vscode.window.showTextDocument(document, { preview: false });
  }

  private async createTestFile(): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const target = workspaceRoot
      ? path.join(workspaceRoot, 'tests', 'new-feature.test.ts')
      : 'new-feature.test.ts';
    const scaffold = [
      "import { describe, expect, it } from 'vitest';",
      '',
      "describe('new feature', () => {",
      "  it('behaves as expected', () => {",
      '    expect(true).toBe(true);',
      '  });',
      '});',
      '',
    ].join('\n');

    const uri = vscode.Uri.parse(`untitled:${target.replace(/\\/g, '/')}`);
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    if (document.getText().trim().length === 0) {
      await editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(0, 0), scaffold);
      });
    }
  }

  private async openCoverageReport(): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return;
    }

    const snapshot = collectTestingDashboardSnapshot();
    const reportRelativePath = snapshot.coverageReportRelativePath ?? snapshot.coverageDataRelativePath;
    const resolved = reportRelativePath ? resolveWorkspaceRelativePath(workspaceRoot, reportRelativePath) : undefined;
    if (!resolved || !existsSync(resolved)) {
      await vscode.window.showInformationMessage('No coverage report is available yet. Run your coverage script first.');
      return;
    }

    await vscode.env.openExternal(vscode.Uri.file(resolved));
  }

  private getHtml(): string {
    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const selectedBudget = getBudgetMode(configuration.get<string>('budgetMode'));
    const selectedSpeed = getSpeedMode(configuration.get<string>('speedMode'));
    const feedbackRoutingWeight = getRangedNumber(configuration.get<number>('feedbackRoutingWeight'), 1, 0, 2, 2);
    const localOpenAiEndpoints = getConfiguredLocalEndpoints({
      getEndpoints: () => configuration.get<unknown>('localOpenAiEndpoints'),
      getLegacyBaseUrl: () => configuration.get<string>('localOpenAiBaseUrl'),
    });
    const serializedLocalOpenAiEndpoints = serializeForInlineScript(localOpenAiEndpoints);
    const dailyCostLimitUsd = getNonNegativeNumber(configuration.get<number>('dailyCostLimitUsd'), 0);
    const showImportProjectAction = configuration.get<boolean>('showImportProjectAction', true);
    const selectedToolApprovalMode = getToolApprovalMode(configuration.get<string>('toolApprovalMode'));
    const allowTerminalWrite = configuration.get<boolean>('allowTerminalWrite', false);
    const autoVerifyAfterWrite = configuration.get<boolean>('autoVerifyAfterWrite', true);
    const autoVerifyScripts = escapeHtml((configuration.get<string[]>('autoVerifyScripts', ['test']) ?? ['test']).join(', '));
    const autoVerifyTimeoutMs = getPositiveInteger(configuration.get<number>('autoVerifyTimeoutMs'), 120000);
    const voiceTtsEnabled = configuration.get<boolean>('voice.ttsEnabled', false);
    const voiceRate = getRangedNumber(configuration.get<number>('voice.rate'), 1, 0.5, 2, 2);
    const voicePitch = getRangedNumber(configuration.get<number>('voice.pitch'), 1, 0, 2, 2);
    const voiceVolume = getRangedNumber(configuration.get<number>('voice.volume'), 1, 0, 1, 2);
    const voiceLanguage = escapeHtml(configuration.get<string>('voice.language', ''));
    const voiceOutputDeviceId = escapeHtml(configuration.get<string>('voice.outputDeviceId', ''));
    const chatSessionTurnLimit = getPositiveInteger(configuration.get<number>('chatSessionTurnLimit'), 6);
    const chatSessionContextChars = getPositiveInteger(configuration.get<number>('chatSessionContextChars'), 2500);
    const projectApprovalFileThreshold = getPositiveInteger(
      configuration.get<number>('projectApprovalFileThreshold'),
      DEFAULT_PROJECT_APPROVAL_FILE_THRESHOLD,
    );
    const projectEstimatedFilesPerSubtask = getPositiveInteger(
      configuration.get<number>('projectEstimatedFilesPerSubtask'),
      DEFAULT_ESTIMATED_FILES_PER_SUBTASK,
    );
    const projectChangedFileReferenceLimit = getPositiveInteger(
      configuration.get<number>('projectChangedFileReferenceLimit'),
      DEFAULT_CHANGED_FILE_REFERENCE_LIMIT,
    );
    const projectRunReportFolder = escapeHtml(
      getNonEmptyString(
        configuration.get<string>('projectRunReportFolder'),
        DEFAULT_PROJECT_RUN_REPORT_FOLDER,
      ),
    );
    const projectDependencyMonitoringEnabled = configuration.get<boolean>('projectDependencyMonitoringEnabled', true);
    const projectDependencyMonitoringProviders = getDependencyMonitoringProviders(
      configuration.get<string[]>('projectDependencyMonitoringProviders', ['dependabot']),
    );
    const projectDependencyMonitoringSchedule = getDependencyMonitoringSchedule(
      configuration.get<string>('projectDependencyMonitoringSchedule'),
    );
    const projectDependencyMonitoringIssueTemplate = configuration.get<boolean>('projectDependencyMonitoringIssueTemplate', true);
    const experimentalSkillLearningEnabled = configuration.get<boolean>('experimentalSkillLearningEnabled', false);
    const maxToolIterations = getPositiveInteger(configuration.get<number>('maxToolIterations'), 20);
    const testingDashboard = collectTestingDashboardSnapshot();

    const initialPage = this.initialTarget?.page ?? 'overview';
    const hasExplicitInitialPage = this.initialTarget?.page !== undefined;
    const initialQuery = escapeHtml(this.initialTarget?.query ?? '');
    const initialSection = JSON.stringify(this.initialTarget?.section ?? '');
    const extensionVersion = escapeHtml(this.extensionVersion);

    return getWebviewHtmlShell({
      title: 'AtlasMind Settings',
      cspSource: this.panel.webview.cspSource,
      bodyContent:
      `
      <div class="settings-hero">
        <div>
          <p class="eyebrow">Workspace configuration</p>
          <h1>AtlasMind Settings</h1>
          <p class="hero-copy">A navigable control surface for routing, safety, chat context, and autonomous project runs. Every change is still validated before it is written into workspace settings.</p>
        </div>
        <div class="hero-side">
          <div class="hero-badges" aria-label="Settings principles">
            <span class="hero-badge" data-tooltip="AtlasMind validates incoming values inside the extension host before persisting them, instead of trusting raw webview form input." tabindex="0">Validated writes</span>
            <span class="hero-badge" data-tooltip="These controls write to workspace settings so project-specific routing, safety, and run behavior stay local to the current repo." tabindex="0">Workspace scoped</span>
            <span class="hero-badge" data-tooltip="Defaults stay conservative around tool execution, safety approvals, and settings writes until you explicitly loosen them." tabindex="0">Security-first defaults</span>
          </div>
          <span class="hero-version" aria-label="Installed AtlasMind version">v${extensionVersion}</span>
        </div>
      </div>

      <div class="search-shell">
        <label class="search-label" for="settingsSearch">Search settings</label>
        <input id="settingsSearch" type="search" placeholder="Search pages, controls, or workflows" value="${initialQuery}" />
        <p id="searchStatus" class="search-status" aria-live="polite"></p>
      </div>

      <div class="settings-layout">
        <nav class="settings-nav" aria-label="AtlasMind settings sections" role="tablist" aria-orientation="vertical">
          <button type="button" class="nav-link ${initialPage === 'overview' ? 'active' : ''}" id="tab-overview" data-page-target="overview" data-search="overview quick actions budget speed cost limits embedded chat detached chat project run center vscode chat" role="tab" aria-selected="${initialPage === 'overview' ? 'true' : 'false'}" aria-controls="page-overview" ${initialPage === 'overview' ? '' : 'tabindex="-1"'}>Overview</button>
          <button type="button" class="nav-link ${initialPage === 'chat' ? 'active' : ''}" id="tab-chat" data-page-target="chat" data-search="chat sidebar sessions import project carry-forward turns context max chars" role="tab" aria-selected="${initialPage === 'chat' ? 'true' : 'false'}" aria-controls="page-chat" ${initialPage === 'chat' ? '' : 'tabindex="-1"'}>Chat & Sidebar</button>
          <button type="button" class="nav-link ${initialPage === 'models' ? 'active' : ''}" id="tab-models" data-page-target="models" data-search="models integrations providers local endpoint local endpoints ollama lm studio azure bedrock voice vision exa specialist" role="tab" aria-selected="${initialPage === 'models' ? 'true' : 'false'}" aria-controls="page-models" ${initialPage === 'models' ? '' : 'tabindex="-1"'}>Models & Integrations</button>
          <button type="button" class="nav-link ${initialPage === 'safety' ? 'active' : ''}" id="tab-safety" data-page-target="safety" data-search="safety verification approvals tool approval terminal write scripts timeout max tool iterations loop limit" role="tab" aria-selected="${initialPage === 'safety' ? 'true' : 'false'}" aria-controls="page-safety" ${initialPage === 'safety' ? '' : 'tabindex="-1"'}>Safety & Verification</button>
          <button type="button" class="nav-link ${initialPage === 'project' ? 'active' : ''}" id="tab-project" data-page-target="project" data-search="project runs approval threshold estimated files changed file references report folder dependency monitoring dependabot renovate governance updates" role="tab" aria-selected="${initialPage === 'project' ? 'true' : 'false'}" aria-controls="page-project" ${initialPage === 'project' ? '' : 'tabindex="-1"'}>Project Runs</button>
          <button type="button" class="nav-link ${initialPage === 'experimental' ? 'active' : ''}" id="tab-experimental" data-page-target="experimental" data-search="experimental skill learning generated drafts" role="tab" aria-selected="${initialPage === 'experimental' ? 'true' : 'false'}" aria-controls="page-experimental" ${initialPage === 'experimental' ? '' : 'tabindex="-1"'}>Experimental</button>
        </nav>

        <main class="settings-main">
          <section id="page-overview" class="settings-page ${initialPage === 'overview' ? 'active fallback-visible' : ''}" role="tabpanel" aria-labelledby="tab-overview" tabindex="0">
            <div class="page-header">
              <p class="page-kicker">Overview</p>
              <h2>Daily control center</h2>
              <p>Choose how AtlasMind balances cost and speed, then jump straight into the surfaces you use most.</p>
            </div>

            <div class="action-grid">
              <button id="openChatView" class="action-card action-card-primary">
                <span class="action-title">Focus Embedded Chat</span>
                <span class="action-copy">Reveal the Atlas chat workspace inside the sidebar container.</span>
              </button>
              <button id="openChatPanel" class="action-card">
                <span class="action-title">Open Detached Chat</span>
                <span class="action-copy">Use the larger conversation workspace when you want more room.</span>
              </button>
              <button id="openProjectRunCenter" class="action-card">
                <span class="action-title">Project Run Center</span>
                <span class="action-copy">Review batch progress, approvals, pauses, and resumptions.</span>
              </button>
              <button id="openChat" class="action-card">
                <span class="action-title">VS Code Chat</span>
                <span class="action-copy">Jump into the native Chat view and continue with <code>@atlas</code>.</span>
              </button>
            </div>

            <div class="page-grid two-up">
              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Routing</p>
                  <h3>${renderHeadingWithHelp('Budget mode', 'budgetMode')}</h3>
                </div>
                <p class="card-copy">Select how aggressively AtlasMind should spend on models across orchestrated tasks.</p>
                <div class="choice-cluster" role="radiogroup" aria-label="Budget mode">
                  ${renderRoutingChoicePill('budget', 'cheap', 'Cheap', selectedBudget === 'cheap', BUDGET_MODE_HELP.cheap)}
                  ${renderRoutingChoicePill('budget', 'balanced', 'Balanced', selectedBudget === 'balanced', BUDGET_MODE_HELP.balanced)}
                  ${renderRoutingChoicePill('budget', 'expensive', 'Expensive', selectedBudget === 'expensive', BUDGET_MODE_HELP.expensive)}
                  ${renderRoutingChoicePill('budget', 'auto', 'Auto', selectedBudget === 'auto', BUDGET_MODE_HELP.auto)}
                </div>
                <div class="field-stack compact-stack">
                  ${renderFieldLabel('dailyCostLimitUsd', 'Daily Cost Limit (USD)', 'dailyCostLimitUsd')}
                  <input id="dailyCostLimitUsd" type="number" min="0" step="0.01" value="${dailyCostLimitUsd}" />
                  <p class="info-note">Use <code>0</code> for unlimited. AtlasMind warns at 80% and blocks new requests once the limit is reached.</p>
                </div>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Routing</p>
                  <h3>${renderHeadingWithHelp('Speed mode', 'speedMode')}</h3>
                </div>
                <p class="card-copy">Decide how much time AtlasMind should spend choosing and running more capable reasoning paths.</p>
                <div class="choice-cluster" role="radiogroup" aria-label="Speed mode">
                  ${renderRoutingChoicePill('speed', 'fast', 'Fast', selectedSpeed === 'fast', SPEED_MODE_HELP.fast)}
                  ${renderRoutingChoicePill('speed', 'balanced', 'Balanced', selectedSpeed === 'balanced', SPEED_MODE_HELP.balanced)}
                  ${renderRoutingChoicePill('speed', 'considered', 'Considered', selectedSpeed === 'considered', SPEED_MODE_HELP.considered)}
                  ${renderRoutingChoicePill('speed', 'auto', 'Auto', selectedSpeed === 'auto', SPEED_MODE_HELP.auto)}
                </div>
                <div class="info-band">
                  <strong>Tip:</strong> Pair <code>balanced</code> speed with <code>balanced</code> budget when you want stable defaults without over-tuning the router.
                </div>
                <div class="field-stack compact-stack top-gap">
                  ${renderFieldLabel('feedbackRoutingWeight', 'Feedback Routing Weight', 'feedbackRoutingWeight')}
                  <input id="feedbackRoutingWeight" type="number" min="0" max="2" step="0.05" value="${feedbackRoutingWeight}" />
                  <p class="info-note">Set <code>0</code> to ignore thumbs history in routing. Higher values amplify the bias, but AtlasMind still caps the effect so votes cannot override hard capability or provider-health checks.</p>
                </div>
              </article>
            </div>
          </section>

          <section id="page-chat" class="settings-page ${initialPage === 'chat' ? 'active fallback-visible' : ''}" role="tabpanel" aria-labelledby="tab-chat" tabindex="0">
            <div class="page-header">
              <p class="page-kicker">Chat &amp; Sidebar</p>
              <h2>Session carry-forward and sidebar affordances</h2>
              <p>Control how much AtlasMind carries across turns and which actions stay visible in the sidebar workflow.</p>
            </div>

            <div class="page-grid">
              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Atlas workspace</p>
                  <h3>Sidebar behavior</h3>
                </div>
                <div class="field-stack">
                  ${renderFieldLabel('showImportProjectAction', 'Memory toolbar action', 'showImportProjectAction')}
                  <label class="checkbox-card">
                    <input id="showImportProjectAction" type="checkbox" ${showImportProjectAction ? 'checked' : ''}>
                    <span>
                      <strong>${renderHeadingWithHelp('Show Import Existing Project', 'showImportProjectAction')}</strong>
                      <span class="muted-line">Keep the import action visible in the Memory view title bar.</span>
                    </span>
                  </label>
                </div>
                <p class="info-note">AtlasMind Settings remains available from the overflow menu on AtlasMind views.</p>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Context window</p>
                  <h3>Conversation carry-forward</h3>
                </div>
                <div class="field-grid">
                  ${renderFieldLabel('chatSessionTurnLimit', 'Session Carry-forward Turns', 'chatSessionTurnLimit')}
                  <input id="chatSessionTurnLimit" type="number" min="1" step="1" value="${chatSessionTurnLimit}" />

                  ${renderFieldLabel('chatSessionContextChars', 'Session Context Max Chars', 'chatSessionContextChars')}
                  <input id="chatSessionContextChars" type="number" min="400" step="100" value="${chatSessionContextChars}" />
                </div>
                <p class="info-note">Lower values make sessions cheaper and tighter. Higher values keep more local continuity available to the orchestrator.</p>
              </article>
            </div>
          </section>

          <section id="page-models" class="settings-page ${initialPage === 'models' ? 'active fallback-visible' : ''}" role="tabpanel" aria-labelledby="tab-models" tabindex="0">
            <div class="page-header">
              <p class="page-kicker">Models &amp; Integrations</p>
              <h2>Provider endpoints and specialist surfaces</h2>
              <p>Use this page to reach provider management quickly and configure any local OpenAI-compatible endpoint.</p>
            </div>

            <div class="page-grid two-up">
              <article id="localEndpointsCard" class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Local routing</p>
                  <h3>${renderHeadingWithHelp('OpenAI-compatible endpoints', 'localOpenAiEndpoints')}</h3>
                </div>
                <p class="card-copy">Point AtlasMind at Ollama, LM Studio, Open WebUI, or multiple local OpenAI-compatible engines at once. Add rows only when you need them, and give each one a label so AtlasMind can tell you which endpoint owns which local model.</p>
                <div class="field-stack">
                  <div class="local-endpoints-header">
                    <span class="field-label field-label-with-help"><span>Configured local endpoints</span>${renderHelpIndicator('localOpenAiEndpoints')}</span>
                    <div class="local-endpoint-add-wrapper">
                      <button id="addLocalEndpoint" type="button" class="secondary-button local-endpoint-add" aria-label="Add local endpoint">+</button>
                      <ul id="addEndpointMenu" class="endpoint-preset-menu" role="menu" hidden></ul>
                    </div>
                  </div>
                  <div id="localEndpointsList" class="local-endpoints-list"></div>
                </div>
                <p class="info-note">Labels such as <code>Ollama</code> or <code>LM Studio</code> are shown back in the Platform &amp; Local provider page. Local API credentials, when needed, still remain in SecretStorage through the provider surfaces rather than plain settings.</p>
              </article>


              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Management</p>
                  <h3>Provider surfaces</h3>
                </div>
                <div class="button-stack">
                  <button id="openModelProviders">Manage Model Providers</button>
                  <button id="openSpecialistIntegrations">Open Specialist Integrations</button>
                  <button id="openVoicePanel">Voice Panel</button>
                  <button id="openVisionPanel">Vision Panel</button>
                </div>
                <p class="info-note">Use providers for routed models and specialist integrations for focused capabilities such as voice or image tooling.</p>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">MCP Servers</p>
                  <h3>Recommended MCP starters</h3>
                </div>
                <div class="field-stack">
                  <label for="mcpServerCatalogue" class="field-label">Select a recommended MCP server</label>
                  <select id="mcpServerCatalogue"></select>
                  <div id="mcpServerBadges" class="catalogue-badges" aria-live="polite"></div>
                  <div id="mcpServerDescription" class="info-note" style="min-height: 2.5em;"></div>
                  <button id="installMcpServer" class="secondary-button" disabled>Open in Add Server</button>
                  <a id="mcpServerDocs" href="#" target="_blank" rel="noopener" style="display:none; margin-top:6px;">View Documentation</a>
                  <p class="info-note">The full recommended catalogue and the custom endpoint form now live together in the MCP Add Server workspace.</p>
                </div>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Voice output</p>
                  <h3>${renderHeadingWithHelp('Text-to-speech playback', 'voiceTtsEnabled')}</h3>
                </div>
                <label class="checkbox-card">
                  <input id="voiceTtsEnabled" type="checkbox" ${voiceTtsEnabled ? 'checked' : ''}>
                  <span>
                    <strong>${renderHeadingWithHelp('Auto-speak Atlas responses', 'voiceTtsEnabled')}</strong>
                    <span class="muted-line">Use the same voice stack as the Voice Panel when AtlasMind finishes a freeform response.</span>
                  </span>
                </label>
                <div class="field-grid top-gap">
                  ${renderFieldLabel('voiceRate', 'Speech Rate', 'voiceRate')}
                  <input id="voiceRate" type="number" min="0.5" max="2" step="0.05" value="${voiceRate}" />

                  ${renderFieldLabel('voicePitch', 'Speech Pitch', 'voicePitch')}
                  <input id="voicePitch" type="number" min="0" max="2" step="0.05" value="${voicePitch}" />

                  ${renderFieldLabel('voiceVolume', 'Speech Volume', 'voiceVolume')}
                  <input id="voiceVolume" type="number" min="0" max="1" step="0.05" value="${voiceVolume}" />

                  ${renderFieldLabel('voiceLanguage', 'Speech Language', 'voiceLanguage')}
                  <input id="voiceLanguage" type="text" value="${voiceLanguage}" placeholder="e.g. en-US" />

                  ${renderFieldLabel('voiceOutputDeviceId', 'Preferred Speaker Device', 'voiceOutputDeviceId')}
                  <input id="voiceOutputDeviceId" type="text" value="${voiceOutputDeviceId}" placeholder="Leave empty for default output" />
                </div>
                <p class="info-note">Use the dedicated Voice Panel for microphone capture, voice previews, and device inspection. These settings keep TTS behavior visible in the main dashboard.</p>
              </article>
            </div>
          </section>

          <section id="page-safety" class="settings-page ${initialPage === 'safety' ? 'active fallback-visible' : ''}" role="tabpanel" aria-labelledby="tab-safety" tabindex="0">
            <div class="page-header">
              <p class="page-kicker">Safety &amp; Verification</p>
              <h2>Approval policy and automated checks</h2>
              <p>Define when AtlasMind needs your approval and how aggressively it should verify edits after writing files.</p>
            </div>

            <div class="page-grid">
              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Approvals</p>
                  <h3>${renderHeadingWithHelp('Tool execution policy', 'toolApprovalMode')}</h3>
                </div>
                <div class="field-grid">
                  ${renderFieldLabel('toolApprovalMode', 'Tool Approval Mode', 'toolApprovalMode')}
                  <select id="toolApprovalMode">
                    <option value="always-ask" ${selectedToolApprovalMode === 'always-ask' ? 'selected' : ''}>Always ask</option>
                    <option value="ask-on-write" ${selectedToolApprovalMode === 'ask-on-write' ? 'selected' : ''}>Ask on write</option>
                    <option value="ask-on-external" ${selectedToolApprovalMode === 'ask-on-external' ? 'selected' : ''}>Ask on external</option>
                    <option value="allow-safe-readonly" ${selectedToolApprovalMode === 'allow-safe-readonly' ? 'selected' : ''}>Allow safe readonly</option>
                  </select>
                </div>
                <label class="checkbox-card top-gap">
                  <input id="allowTerminalWrite" type="checkbox" ${allowTerminalWrite ? 'checked' : ''}>
                  <span>
                    <strong>${renderHeadingWithHelp('Permit terminal write commands', 'allowTerminalWrite')}</strong>
                    <span class="muted-line">Allow install, commit, or other write-capable subprocesses after the relevant approval step.</span>
                  </span>
                </label>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Verification</p>
                  <h3>${renderHeadingWithHelp('Post-write checks', 'autoVerifyAfterWrite')}</h3>
                </div>
                <label class="checkbox-card">
                  <input id="autoVerifyAfterWrite" type="checkbox" ${autoVerifyAfterWrite ? 'checked' : ''}>
                  <span>
                    <strong>${renderHeadingWithHelp('Auto verify after writes', 'autoVerifyAfterWrite')}</strong>
                    <span class="muted-line">Run configured verification scripts after file-edit, file-write, and git-apply-patch succeed.</span>
                  </span>
                </label>
                <div class="field-grid top-gap">
                  ${renderFieldLabel('autoVerifyScripts', 'Verification Scripts', 'autoVerifyScripts')}
                  <input id="autoVerifyScripts" type="text" value="${autoVerifyScripts}" placeholder="test, lint" />

                  ${renderFieldLabel('autoVerifyTimeoutMs', 'Verification Timeout (ms)', 'autoVerifyTimeoutMs')}
                  <input id="autoVerifyTimeoutMs" type="number" min="5000" step="1000" value="${autoVerifyTimeoutMs}" />
                </div>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Execution limits</p>
                  <h3>${renderHeadingWithHelp('Agentic loop cap', 'maxToolIterations')}</h3>
                </div>
                <div class="field-grid">
                  ${renderFieldLabel('maxToolIterations', 'Max Tool Iterations', 'maxToolIterations')}
                  <input id="maxToolIterations" type="number" min="1" max="50" step="1" value="${maxToolIterations}" />
                </div>
                <p class="info-note">When the limit is reached AtlasMind shows Continue and Cancel actions so you can extend the run without restarting.</p>
              </article>
            </div>
          </section>

          ${renderTestingPage(testingDashboard, initialPage === 'testing')}

          <section id="page-project" class="settings-page ${initialPage === 'project' ? 'active fallback-visible' : ''}" role="tabpanel" aria-labelledby="tab-project" tabindex="0">
            <div class="page-header">
              <p class="page-kicker">Project Runs</p>
              <h2>Autonomous run thresholds and reporting</h2>
              <p>Fine-tune the approval thresholds, diff context density, and report location used by <code>/project</code> execution.</p>
            </div>

            <div class="page-grid">
              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Run guardrails</p>
                  <h3>${renderHeadingWithHelp('Thresholds', 'projectApprovalFileThreshold')}</h3>
                </div>
                <div class="field-grid">
                  ${renderFieldLabel('projectApprovalFileThreshold', 'Approval Threshold (files)', 'projectApprovalFileThreshold')}
                  <input id="projectApprovalFileThreshold" type="number" min="1" step="1" value="${projectApprovalFileThreshold}" />

                  ${renderFieldLabel('projectEstimatedFilesPerSubtask', 'Estimated Files Per Subtask', 'projectEstimatedFilesPerSubtask')}
                  <input id="projectEstimatedFilesPerSubtask" type="number" min="1" step="1" value="${projectEstimatedFilesPerSubtask}" />

                  ${renderFieldLabel('projectChangedFileReferenceLimit', 'Changed File Reference Limit', 'projectChangedFileReferenceLimit')}
                  <input id="projectChangedFileReferenceLimit" type="number" min="1" step="1" value="${projectChangedFileReferenceLimit}" />

                  ${renderFieldLabel('projectRunReportFolder', 'Run Report Folder', 'projectRunReportFolder')}
                  <input id="projectRunReportFolder" type="text" value="${projectRunReportFolder}" />
                </div>
                <p class="info-note">Report folders stay workspace-relative and reject absolute paths or traversal sequences.</p>
              </article>

              <article class="settings-card settings-card-danger">
                <div class="card-header">
                  <p class="card-kicker">Memory lifecycle</p>
                  <h3>Purge imported and manual memory</h3>
                </div>
                <p class="card-copy">Delete the current <code>project_memory</code> tree, recreate the SSOT scaffold, and force AtlasMind to reload from an empty baseline. This is destructive.</p>
                <div class="button-stack">
                  <button id="purgeProjectMemory" class="danger-button">Purge Project Memory</button>
                </div>
                <p class="warning-note">AtlasMind requires two confirmations before deleting workspace memory.</p>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Bootstrap governance</p>
                  <h3>${renderHeadingWithHelp('Dependency monitoring defaults', 'projectDependencyMonitoringEnabled')}</h3>
                </div>
                <label class="checkbox-card">
                  <input id="projectDependencyMonitoringEnabled" type="checkbox" ${projectDependencyMonitoringEnabled ? 'checked' : ''}>
                  <span>
                    <strong>${renderHeadingWithHelp('Scaffold dependency monitoring for Atlas-built projects', 'projectDependencyMonitoringEnabled')}</strong>
                    <span class="muted-line">Bootstrap uses these settings when it generates governance files for a new or newly-governed project.</span>
                  </span>
                </label>
                <div class="field-stack top-gap">
                  <span class="field-label field-label-with-help"><span>Supported automation providers</span>${renderHelpIndicator('projectDependencyMonitoringProviders')}</span>
                  <div class="checkbox-list">
                    <label class="checkbox-card compact-checkbox">
                      <input type="checkbox" name="dependencyMonitoringProvider" value="dependabot" ${projectDependencyMonitoringProviders.includes('dependabot') ? 'checked' : ''}>
                      <span>
                        <strong>Dependabot</strong>
                        <span class="muted-line">GitHub-native dependency and GitHub Actions update PRs.</span>
                      </span>
                    </label>
                    <label class="checkbox-card compact-checkbox">
                      <input type="checkbox" name="dependencyMonitoringProvider" value="renovate" ${projectDependencyMonitoringProviders.includes('renovate') ? 'checked' : ''}>
                      <span>
                        <strong>Renovate</strong>
                        <span class="muted-line">Common professional alternative with broader ecosystem support and grouping rules.</span>
                      </span>
                    </label>
                    <label class="checkbox-card compact-checkbox">
                      <input type="checkbox" name="dependencyMonitoringProvider" value="snyk" ${projectDependencyMonitoringProviders.includes('snyk') ? 'checked' : ''}>
                      <span>
                        <strong>Snyk</strong>
                        <span class="muted-line">Security-focused dependency monitoring through a scheduled GitHub workflow that expects a Snyk token.</span>
                      </span>
                    </label>
                    <label class="checkbox-card compact-checkbox">
                      <input type="checkbox" name="dependencyMonitoringProvider" value="azure-devops" ${projectDependencyMonitoringProviders.includes('azure-devops') ? 'checked' : ''}>
                      <span>
                        <strong>Azure DevOps</strong>
                        <span class="muted-line">Scheduled dependency review pipeline scaffold for teams standardizing on Azure Pipelines.</span>
                      </span>
                    </label>
                  </div>
                </div>
                <div class="field-grid top-gap">
                  ${renderFieldLabel('projectDependencyMonitoringSchedule', 'Monitoring cadence', 'projectDependencyMonitoringSchedule')}
                  <select id="projectDependencyMonitoringSchedule">
                    <option value="daily" ${projectDependencyMonitoringSchedule === 'daily' ? 'selected' : ''}>Daily</option>
                    <option value="weekly" ${projectDependencyMonitoringSchedule === 'weekly' ? 'selected' : ''}>Weekly</option>
                    <option value="monthly" ${projectDependencyMonitoringSchedule === 'monthly' ? 'selected' : ''}>Monthly</option>
                  </select>
                </div>
                <label class="checkbox-card top-gap">
                  <input id="projectDependencyMonitoringIssueTemplate" type="checkbox" ${projectDependencyMonitoringIssueTemplate ? 'checked' : ''}>
                  <span>
                    <strong>${renderHeadingWithHelp('Scaffold dependency review issue template', 'projectDependencyMonitoringIssueTemplate')}</strong>
                    <span class="muted-line">Adds a review template so teams can record approval, exceptions, and follow-up actions after dependency drift is detected.</span>
                  </span>
                </label>
                <p class="info-note">AtlasMind also writes SSOT starter docs for dependency policy and operational review history. The built-in set now covers GitHub-native, Renovate, Snyk, and Azure DevOps patterns, and repo-specific services can still be layered in later.</p>
              </article>
            </div>
          </section>

          <section id="page-experimental" class="settings-page ${initialPage === 'experimental' ? 'active fallback-visible' : ''}" role="tabpanel" aria-labelledby="tab-experimental" tabindex="0">
            <div class="page-header">
              <p class="page-kicker">Experimental</p>
              <h2>Higher-risk features</h2>
              <p>Features here are available for exploration, but they increase token spend and require stricter review of results.</p>
            </div>

            <div class="page-grid">
              <article class="settings-card settings-card-warning">
                <div class="card-header">
                  <p class="card-kicker">Drafting</p>
                  <h3>${renderHeadingWithHelp('Atlas-generated skill drafts', 'experimentalSkillLearningEnabled')}</h3>
                </div>
                <label class="checkbox-card">
                  <input id="experimentalSkillLearningEnabled" type="checkbox" ${experimentalSkillLearningEnabled ? 'checked' : ''}>
                  <span>
                    <strong>${renderHeadingWithHelp('Enable Atlas-generated skill drafts', 'experimentalSkillLearningEnabled')}</strong>
                    <span class="muted-line">Drafts are scanned before import, but still require manual review before use.</span>
                  </span>
                </label>
                <p class="warning-note">Warning: generated skills can still be wrong or unsafe. Review every draft before enabling it in production workflows.</p>
              </article>
            </div>
          </section>
        </main>
      </div>

      `,
      extraCss:
      `
        :root {
          --atlas-panel-border: var(--vscode-widget-border, rgba(127, 127, 127, 0.35));
          --atlas-panel-muted: var(--vscode-descriptionForeground, var(--vscode-foreground));
          --atlas-panel-surface: color-mix(in srgb, var(--vscode-editor-background) 78%, var(--vscode-sideBar-background) 22%);
          --atlas-panel-surface-strong: color-mix(in srgb, var(--vscode-editor-background) 60%, var(--vscode-sideBar-background) 40%);
          --atlas-panel-accent: var(--vscode-textLink-foreground);
          --atlas-panel-accent-soft: color-mix(in srgb, var(--vscode-textLink-foreground) 18%, transparent);
          --atlas-panel-warning: var(--vscode-inputValidation-warningBorder, #cca700);
        }
        body {
          padding: 20px;
        }
        code {
          font-family: var(--vscode-editor-font-family, var(--vscode-font-family, monospace));
        }
        .eyebrow,
        .page-kicker,
        .card-kicker {
          margin: 0 0 6px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-size: 0.74rem;
          color: var(--atlas-panel-muted);
        }
        .settings-hero {
          display: flex;
          justify-content: space-between;
          gap: 20px;
          padding: 20px 22px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 18px;
          background:
            radial-gradient(circle at top right, color-mix(in srgb, var(--atlas-panel-accent) 14%, transparent), transparent 38%),
            linear-gradient(160deg, var(--atlas-panel-surface) 0%, var(--vscode-editor-background) 72%);
          margin-bottom: 18px;
        }
        .settings-hero h1 {
          margin: 0;
          font-size: 1.65rem;
        }
        .hero-copy {
          max-width: 760px;
          margin: 10px 0 0;
          color: var(--atlas-panel-muted);
        }
        .hero-side {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          align-items: flex-end;
          gap: 14px;
          min-width: 220px;
        }
        .hero-version {
          display: inline-flex;
          align-items: center;
          padding: 4px 10px;
          border-radius: 999px;
          border: 1px solid var(--atlas-panel-border);
          background: color-mix(in srgb, var(--atlas-panel-surface-strong) 74%, transparent);
          color: var(--atlas-panel-muted);
          font-size: 0.82rem;
          letter-spacing: 0.04em;
          white-space: nowrap;
        }
        .hero-badges {
          display: flex;
          flex-wrap: wrap;
          align-content: flex-start;
          justify-content: flex-end;
          gap: 10px;
        }
        .hero-badge {
          position: relative;
          display: inline-flex;
          align-items: center;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 999px;
          padding: 6px 12px;
          background: var(--atlas-panel-accent-soft);
          color: var(--vscode-foreground);
          font-size: 0.9rem;
          white-space: nowrap;
        }
        .hero-badge[data-tooltip]::after {
          content: attr(data-tooltip);
          position: absolute;
          right: 0;
          top: calc(100% + 10px);
          width: min(320px, 70vw);
          padding: 10px 12px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 12px;
          background: var(--atlas-panel-surface-strong);
          color: var(--vscode-foreground);
          line-height: 1.45;
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: break-word;
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
          z-index: 20;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
        }
        .hero-badge[data-tooltip]:hover::after,
        .hero-badge[data-tooltip]:focus-visible::after {
          opacity: 1;
          visibility: visible;
        }
        .settings-layout {
          display: grid;
          grid-template-columns: minmax(220px, 240px) minmax(0, 1fr);
          gap: 18px;
          align-items: start;
        }
        .search-shell {
          display: grid;
          gap: 6px;
          margin: 0 0 18px;
        }
        .search-label {
          font-weight: 600;
        }
        .search-shell input {
          width: 100%;
          box-sizing: border-box;
          color: var(--vscode-input-foreground);
          background: var(--vscode-input-background);
          border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #444));
          padding: 10px 12px;
          border-radius: 12px;
        }
        .search-status {
          min-height: 1.2em;
          margin: 0;
          color: var(--atlas-panel-muted);
          font-size: 0.92rem;
        }
        .settings-nav {
          position: sticky;
          top: 20px;
          z-index: 2;
          isolation: isolate;
          display: grid;
          gap: 8px;
          padding: 16px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 18px;
          background: linear-gradient(180deg, var(--atlas-panel-surface-strong), var(--atlas-panel-surface));
        }
        .nav-link {
          display: block;
          width: 100%;
          box-sizing: border-box;
          text-align: left;
          text-decoration: none;
          font: inherit;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid transparent;
          border-radius: 12px;
          padding: 11px 12px;
          background: transparent;
          color: var(--vscode-foreground);
        }
        .nav-link:hover,
        .nav-link:focus-visible {
          background: var(--atlas-panel-accent-soft);
          border-color: var(--atlas-panel-border);
          outline: none;
        }
        .nav-link.active {
          background: color-mix(in srgb, var(--atlas-panel-accent) 22%, transparent);
          border-color: color-mix(in srgb, var(--atlas-panel-accent) 48%, var(--atlas-panel-border));
        }
        .nav-link.hidden-by-search {
          display: none;
        }
        .settings-main {
          min-width: 0;
        }
        .settings-page {
          display: none;
          scroll-margin-top: 20px;
        }
        .settings-page.fallback-visible {
          display: block;
        }
        .settings-pages-ready .settings-page {
          display: none;
        }
        .settings-pages-ready .settings-page.active {
          display: block;
        }
        .page-header {
          margin-bottom: 14px;
        }
        .page-header h2,
        .card-header h3 {
          margin: 0;
        }
        .page-header p:last-child,
        .card-copy,
        .muted-line,
        .info-note {
          color: var(--atlas-panel-muted);
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .page-grid {
          display: grid;
          gap: 14px;
        }
        .two-up {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .action-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 14px;
        }
        .action-card {
          display: flex;
          flex-direction: column;
          gap: 6px;
          text-align: left;
          padding: 18px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 16px;
          background: linear-gradient(180deg, var(--atlas-panel-surface) 0%, var(--vscode-editor-background) 100%);
        }
        .action-card-primary {
          border-color: color-mix(in srgb, var(--atlas-panel-accent) 42%, var(--atlas-panel-border));
          background: linear-gradient(180deg, color-mix(in srgb, var(--atlas-panel-accent) 10%, var(--atlas-panel-surface)), var(--vscode-editor-background));
        }
        .action-title {
          font-weight: 700;
        }
        .action-copy {
          color: var(--atlas-panel-muted);
          font-size: 0.95rem;
        }
        .settings-card {
          border: 1px solid var(--atlas-panel-border);
          border-radius: 18px;
          padding: 20px;
          background: linear-gradient(180deg, var(--atlas-panel-surface) 0%, var(--vscode-editor-background) 100%);
        }
        .settings-card-warning {
          border-color: color-mix(in srgb, var(--atlas-panel-warning) 55%, var(--atlas-panel-border));
        }
        .settings-card-danger {
          border-color: var(--vscode-inputValidation-errorBorder, #d13438);
          background: color-mix(in srgb, var(--vscode-inputValidation-errorBorder, #d13438) 8%, var(--atlas-panel-surface));
        }
        .field-grid {
          display: grid;
          grid-template-columns: minmax(220px, 280px) minmax(260px, 1fr);
          gap: 10px 14px;
          align-items: center;
        }
        .danger-button {
          border-color: var(--vscode-inputValidation-errorBorder, #d13438);
          background: color-mix(in srgb, var(--vscode-inputValidation-errorBorder, #d13438) 20%, var(--vscode-button-background));
        }
        .danger-button:hover,
        .danger-button:focus-visible {
          background: color-mix(in srgb, var(--vscode-inputValidation-errorBorder, #d13438) 30%, var(--vscode-button-background));
        }
        .field-stack {
          display: grid;
          gap: 8px;
        }
        .compact-stack {
          margin-top: 14px;
        }
        .field-grid input,
        .field-stack input {
          width: 100%;
          box-sizing: border-box;
          color: var(--vscode-input-foreground);
          background: var(--vscode-input-background);
          border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #444));
          padding: 8px 10px;
          border-radius: 10px;
        }
        .field-grid select {
          width: 100%;
          box-sizing: border-box;
          color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground));
          background: var(--vscode-dropdown-background, var(--vscode-input-background));
          border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, var(--vscode-widget-border, #444)));
          padding: 8px 10px;
          border-radius: 10px;
        }
        .field-grid label,
        .field-stack label {
          font-weight: 500;
        }
        .secondary-button {
          border: 1px solid var(--atlas-panel-border);
          border-radius: 10px;
          background: var(--atlas-panel-surface-strong);
          color: var(--vscode-foreground);
          padding: 8px 12px;
        }
        .secondary-button:hover,
        .secondary-button:focus-visible {
          border-color: color-mix(in srgb, var(--atlas-panel-accent) 48%, var(--atlas-panel-border));
          outline: none;
        }
        .label-with-help,
        .field-label-with-help,
        .heading-with-help {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .field-label-with-help {
          font-weight: 500;
        }
        .help-indicator {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 999px;
          background: var(--atlas-panel-accent-soft);
          color: var(--vscode-foreground);
          font-size: 0.78rem;
          font-weight: 700;
          cursor: help;
          flex: 0 0 auto;
        }
        .help-indicator::after {
          content: attr(data-tooltip);
          position: absolute;
          left: calc(100% + 10px);
          top: 50%;
          transform: translateY(-50%);
          width: min(360px, 60vw);
          padding: 10px 12px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 12px;
          background: var(--atlas-panel-surface-strong);
          color: var(--vscode-foreground);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
          white-space: normal;
          line-height: 1.45;
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
          z-index: 20;
        }
        .help-indicator:hover::after,
        .help-indicator:focus-visible::after {
          opacity: 1;
          visibility: visible;
        }
        .help-indicator:focus-visible {
          outline: 1px solid color-mix(in srgb, var(--atlas-panel-accent) 70%, white 30%);
          outline-offset: 2px;
        }
        .choice-cluster {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 10px;
        }
        .choice-pill {
          position: relative;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 999px;
          background: var(--atlas-panel-surface-strong);
          cursor: pointer;
        }
        .choice-pill[data-tooltip]::after {
          content: attr(data-tooltip);
          position: absolute;
          left: 0;
          top: calc(100% + 10px);
          width: min(360px, 72vw);
          padding: 10px 12px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 12px;
          background: var(--atlas-panel-surface-strong);
          color: var(--vscode-foreground);
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: break-word;
          line-height: 1.45;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
          z-index: 20;
        }
        .choice-pill[data-tooltip]:hover::after,
        .choice-pill[data-tooltip]:focus-within::after {
          opacity: 1;
          visibility: visible;
        }
        .choice-pill input {
          margin: 0;
        }
        .local-endpoints-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }
        .local-endpoint-add {
          min-width: 40px;
          padding: 6px 12px;
          font-size: 1.2rem;
          line-height: 1;
        }
        .local-endpoint-add-wrapper {
          position: relative;
        }
        .endpoint-preset-menu {
          position: absolute;
          right: 0;
          top: 100%;
          z-index: 10;
          margin: 4px 0 0;
          padding: 4px 0;
          min-width: 210px;
          list-style: none;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 10px;
          background: var(--atlas-panel-surface-strong, #1e1e2e);
          box-shadow: 0 4px 18px rgba(0, 0, 0, 0.4);
        }
        .endpoint-preset-menu[hidden] {
          display: none;
        }
        .endpoint-preset-menu li {
          display: grid;
          grid-template-columns: 1fr;
        }
        .endpoint-preset-menu button {
          display: flex;
          flex-direction: column;
          gap: 1px;
          width: 100%;
          padding: 7px 14px;
          border: none;
          background: transparent;
          color: var(--atlas-panel-fg);
          font: inherit;
          font-size: 0.92rem;
          text-align: left;
          cursor: pointer;
        }
        .endpoint-preset-menu button:hover,
        .endpoint-preset-menu button:focus-visible {
          background: color-mix(in srgb, var(--atlas-panel-accent) 18%, transparent);
          outline: none;
        }
        .endpoint-preset-menu .preset-hint {
          font-size: 0.78rem;
          color: var(--atlas-panel-muted);
        }
        .endpoint-preset-menu .preset-separator {
          height: 1px;
          margin: 4px 10px;
          background: var(--atlas-panel-border);
        }
        .local-endpoints-list {
          display: grid;
          gap: 10px;
        }
        .local-endpoint-row {
          display: grid;
          grid-template-columns: minmax(140px, 180px) minmax(0, 1fr) auto;
          gap: 10px;
          align-items: end;
          padding: 12px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 14px;
          background: color-mix(in srgb, var(--atlas-panel-surface-strong) 74%, transparent);
        }
        .local-endpoint-field {
          display: grid;
          gap: 6px;
        }
        .local-endpoint-field label {
          font-size: 0.88rem;
          color: var(--atlas-panel-muted);
        }
        .local-endpoint-remove {
          align-self: center;
          min-width: 40px;
          padding: 8px 10px;
        }
        .local-endpoints-empty {
          margin: 0;
          padding: 12px;
          border: 1px dashed var(--atlas-panel-border);
          border-radius: 14px;
          color: var(--atlas-panel-muted);
          background: color-mix(in srgb, var(--atlas-panel-surface) 65%, transparent);
        }
        .checkbox-card {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 10px;
          align-items: start;
          padding: 12px 14px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 14px;
          background: color-mix(in srgb, var(--atlas-panel-surface-strong) 74%, transparent);
        }
        .checkbox-card strong {
          display: block;
          margin-bottom: 2px;
        }
        .checkbox-card input {
          margin-top: 2px;
        }
        .muted-line {
          display: block;
          font-size: 0.94rem;
        }
        .button-stack {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 14px;
        }
        .stat-card {
          border: 1px solid var(--atlas-panel-border);
          border-radius: 14px;
          padding: 14px;
          background: color-mix(in srgb, var(--atlas-panel-surface-strong) 76%, transparent);
        }
        .stat-label {
          display: block;
          margin-bottom: 6px;
          color: var(--atlas-panel-muted);
          font-size: 0.88rem;
        }
        .stat-value {
          font-size: 1.35rem;
          font-weight: 700;
        }
        .stat-meta {
          margin-top: 4px;
          color: var(--atlas-panel-muted);
          font-size: 0.88rem;
        }
        .inline-chip-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .info-chip {
          display: inline-flex;
          align-items: center;
          padding: 5px 10px;
          border-radius: 999px;
          border: 1px solid var(--atlas-panel-border);
          background: color-mix(in srgb, var(--atlas-panel-accent) 12%, transparent);
          font-size: 0.88rem;
        }
        .test-file-list {
          display: grid;
          gap: 10px;
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .test-file-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 12px;
          align-items: center;
          padding: 12px 14px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 14px;
          background: color-mix(in srgb, var(--atlas-panel-surface-strong) 74%, transparent);
        }
        .test-file-title {
          font-weight: 600;
        }
        .test-file-path,
        .mini-meta {
          color: var(--atlas-panel-muted);
          font-size: 0.9rem;
        }
        .mini-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 4px;
        }
        .checkbox-list {
          display: grid;
          gap: 10px;
        }
        .compact-checkbox {
          padding: 10px 12px;
        }
        .field-label {
          font-weight: 500;
        }
        .top-gap {
          margin-top: 14px;
        }
        .info-band {
          margin-top: 14px;
          padding: 12px 14px;
          border-radius: 14px;
          background: color-mix(in srgb, var(--atlas-panel-accent) 10%, transparent);
          border: 1px solid var(--atlas-panel-border);
        }
        .warning-note {
          margin-top: 14px;
          padding: 12px 14px;
          border-left: 3px solid var(--atlas-panel-warning);
          background: color-mix(in srgb, var(--atlas-panel-warning) 10%, transparent);
          border-radius: 12px;
        }
        input:focus-visible,
        select:focus-visible,
        button:focus-visible {
          outline: 2px solid var(--atlas-panel-accent);
          outline-offset: 2px;
        }
        @media (max-width: 920px) {
          .settings-layout,
          .two-up,
          .action-grid,
          .stats-grid {
            grid-template-columns: 1fr;
          }
          .settings-nav {
            position: static;
          }
        }
        @media (max-width: 720px) {
          .settings-hero {
            flex-direction: column;
          }
          .field-grid {
            grid-template-columns: 1fr;
          }
          .local-endpoint-row,
          .test-file-row {
            grid-template-columns: 1fr;
          }
          .hero-badges {
            justify-content: flex-start;
          }
        }
        .catalogue-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          min-height: 1.5rem;
        }
        .catalogue-badge {
          display: inline-flex;
          align-items: center;
          padding: 3px 10px;
          border-radius: 999px;
          border: 1px solid var(--panel-border);
          font-size: 0.78rem;
          background: color-mix(in srgb, var(--accent-soft) 65%, transparent);
        }
        .catalogue-badge.official { border-color: color-mix(in srgb, #4caf50 55%, var(--panel-border)); }
        .catalogue-badge.community { border-color: color-mix(in srgb, #03a9f4 55%, var(--panel-border)); }
        .catalogue-badge.registry { border-color: color-mix(in srgb, #ff9800 55%, var(--panel-border)); }
        .catalogue-badge.archived { border-color: color-mix(in srgb, #9e9e9e 65%, var(--panel-border)); }
        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }
      `,
      scriptContent:
      `
        // MCP server catalogue data injected from backend
        const recommendedMcpServers = ${JSON.stringify(RECOMMENDED_MCP_SERVERS.map(server => ({
          ...server,
          starter: getRecommendedMcpStarterDetails(server.id),
        })))};
                // MCP server catalogue UI logic
                const mcpServerCatalogue = document.getElementById('mcpServerCatalogue');
                const mcpServerBadges = document.getElementById('mcpServerBadges');
                const mcpServerDescription = document.getElementById('mcpServerDescription');
                const installMcpServerBtn = document.getElementById('installMcpServer');
                const mcpServerDocs = document.getElementById('mcpServerDocs');
                let selectedMcpServer = null;

                function getMcpProvenanceLabel(provenance) {
                  switch (provenance) {
                    case 'official': return 'Official';
                    case 'community': return 'Community';
                    case 'archived': return 'Archived reference';
                    default: return 'Registry fallback';
                  }
                }

                function getMcpProvenanceHint(provenance) {
                  switch (provenance) {
                    case 'official': return 'Verified first-party documentation and upstream reference.';
                    case 'community': return 'Community-maintained integration; review its upstream guidance before use.';
                    case 'archived': return 'Historical example that still resolves, but it is no longer actively maintained.';
                    default: return 'AtlasMind could confirm the MCP catalogue entry, but not a stable vendor-specific install guide.';
                  }
                }

                function getMcpSetupLabel(server) {
                  return server?.starter?.setupMode === 'prefill' ? 'AtlasMind-ready' : 'Manual setup';
                }

                function getMcpInstallActionLabel(server) {
                  return server?.starter?.setupMode === 'prefill' ? 'Install & Connect' : 'Open in Add Server';
                }

                function getMcpPendingActionLabel(server) {
                  return server?.starter?.setupMode === 'prefill' ? 'Installing...' : 'Opening...';
                }

                function renderMcpServerBadges(server) {
                  if (!(mcpServerBadges instanceof HTMLElement)) return;
                  mcpServerBadges.innerHTML = '';
                  if (!server) return;
                  const badge = document.createElement('span');
                  badge.className = 'catalogue-badge ' + (server.provenance || 'registry');
                  badge.textContent = getMcpProvenanceLabel(server.provenance);
                  badge.title = getMcpProvenanceHint(server.provenance);
                  mcpServerBadges.appendChild(badge);

                  const setupBadge = document.createElement('span');
                  setupBadge.className = 'catalogue-badge ' + (server?.starter?.setupMode === 'prefill' ? 'official' : 'archived');
                  setupBadge.textContent = getMcpSetupLabel(server);
                  setupBadge.title = server?.starter?.note || 'Review the linked setup guide before connecting this preset.';
                  mcpServerBadges.appendChild(setupBadge);
                }

                function updateMcpServerCatalogue() {
                  if (!(mcpServerCatalogue instanceof HTMLSelectElement)) return;
                  mcpServerCatalogue.innerHTML = '';
                  recommendedMcpServers.forEach((server, idx) => {
                    const opt = document.createElement('option');
                    opt.value = server.id;
                    opt.textContent = server.name + ' · ' + getMcpProvenanceLabel(server.provenance) + ' · ' + getMcpSetupLabel(server);
                    mcpServerCatalogue.appendChild(opt);
                  });
                  if (recommendedMcpServers.length > 0) {
                    mcpServerCatalogue.selectedIndex = 0;
                    setSelectedMcpServer(recommendedMcpServers[0].id);
                  }
                }

                function setSelectedMcpServer(serverId) {
                  selectedMcpServer = recommendedMcpServers.find(s => s.id === serverId) || null;
                  if (selectedMcpServer) {
                    renderMcpServerBadges(selectedMcpServer);
                    if (mcpServerDescription) {
                      mcpServerDescription.textContent = selectedMcpServer.description + ' ' + getMcpProvenanceHint(selectedMcpServer.provenance) + ' ' + (selectedMcpServer?.starter?.note || '');
                    }
                    if (installMcpServerBtn) {
                      installMcpServerBtn.disabled = false;
                      installMcpServerBtn.textContent = getMcpInstallActionLabel(selectedMcpServer);
                    }
                    if (mcpServerDocs) {
                      mcpServerDocs.href = selectedMcpServer.docsUrl;
                      mcpServerDocs.style.display = 'inline-block';
                    }
                  } else {
                    renderMcpServerBadges(null);
                    if (mcpServerDescription) mcpServerDescription.textContent = '';
                    if (installMcpServerBtn) installMcpServerBtn.disabled = true;
                    if (mcpServerDocs) mcpServerDocs.style.display = 'none';
                  }
                }

                if (mcpServerCatalogue instanceof HTMLSelectElement) {
                  mcpServerCatalogue.addEventListener('change', () => {
                    setSelectedMcpServer(mcpServerCatalogue.value);
                  });
                }
                if (installMcpServerBtn instanceof HTMLButtonElement) {
                  installMcpServerBtn.addEventListener('click', () => {
                    if (selectedMcpServer) {
                      vscode.postMessage({ type: 'installMcpServer', payload: selectedMcpServer });
                      installMcpServerBtn.disabled = true;
                      installMcpServerBtn.textContent = getMcpPendingActionLabel(selectedMcpServer);
                    }
                  });
                }
                window.addEventListener('message', event => {
                  const message = event.data;
                  if (!message || typeof message !== 'object' || message.type !== 'status') {
                    return;
                  }
                  const payload = typeof message.payload === 'string' ? message.payload : '';
                  if (payload && mcpServerDescription) {
                    mcpServerDescription.textContent = payload;
                  }
                  if (installMcpServerBtn instanceof HTMLButtonElement) {
                    installMcpServerBtn.disabled = false;
                    installMcpServerBtn.textContent = getMcpInstallActionLabel(selectedMcpServer);
                  }
                });
                updateMcpServerCatalogue();
        const vscode = acquireVsCodeApi();
        function createLocalEndpointId() {
          return 'endpoint-' + Math.random().toString(36).slice(2, 10);
        }
        const initialLocalOpenAiEndpoints = ${serializedLocalOpenAiEndpoints};

        const navButtons = Array.from(document.querySelectorAll('[data-page-target]'));
        const pages = Array.from(document.querySelectorAll('.settings-page'));
        const searchInput = document.getElementById('settingsSearch');
        const searchStatus = document.getElementById('searchStatus');
        const knownPages = new Set(['overview', 'chat', 'models', 'safety', 'testing', 'project', 'experimental']);

        function focusSection(sectionId) {
          if (typeof sectionId !== 'string' || sectionId.trim().length === 0) {
            return;
          }
          const section = document.getElementById(sectionId);
          if (!(section instanceof HTMLElement)) {
            return;
          }
          section.scrollIntoView({ block: 'start', behavior: 'auto' });
        }

        function activatePage(pageId, options = {}) {
          const focusPanel = options.focusPanel === true;
          const resolvedPageId = knownPages.has(pageId) ? pageId : 'overview';
          navButtons.forEach(button => {
            if (!(button instanceof HTMLElement)) {
              return;
            }
            const isActive = button.dataset.pageTarget === resolvedPageId;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
            button.tabIndex = isActive ? 0 : -1;
            if (focusPanel && isActive) {
              button.focus();
            }
          });

          pages.forEach(page => {
            if (!(page instanceof HTMLElement)) {
              return;
            }
            const isActive = page.id === 'page-' + resolvedPageId;
            page.classList.toggle('active', isActive);
            page.hidden = !isActive;
          });

          const state = vscode.getState() ?? {};
          vscode.setState({ ...state, activePage: resolvedPageId });
        }

        function updateSearch(query, options = {}) {
          const normalized = typeof query === 'string' ? query.trim().toLowerCase() : '';
          let visibleCount = 0;

          navButtons.forEach(button => {
            if (!(button instanceof HTMLElement)) {
              return;
            }
            const haystack = ((button.textContent ?? '') + ' ' + (button.dataset.search ?? '')).toLowerCase();
            const matches = normalized.length === 0 || haystack.includes(normalized);
            button.classList.toggle('hidden-by-search', !matches);
            if (matches) {
              visibleCount += 1;
            }
          });

          if (searchStatus instanceof HTMLElement) {
            if (normalized.length === 0) {
              searchStatus.textContent = 'Browse by page or search for a control.';
            } else if (visibleCount === 0) {
              searchStatus.textContent = 'No settings pages matched that search.';
            } else if (visibleCount === 1) {
              searchStatus.textContent = '1 matching settings page.';
            } else {
              searchStatus.textContent = visibleCount + ' matching settings pages.';
            }
          }

          const currentActive = navButtons.find(button => button instanceof HTMLElement && button.classList.contains('active') && !button.classList.contains('hidden-by-search'));
          if (!currentActive && visibleCount > 0) {
            const firstVisible = navButtons.find(button => button instanceof HTMLElement && !button.classList.contains('hidden-by-search'));
            if (firstVisible instanceof HTMLElement) {
              activatePage(firstVisible.dataset.pageTarget ?? 'overview', options);
            }
          }

          const state = vscode.getState() ?? {};
          vscode.setState({ ...state, searchQuery: normalized });
        }

        navButtons.forEach((button, index) => {
          if (!(button instanceof HTMLElement)) {
            return;
          }
          button.addEventListener('click', event => {
            event.preventDefault();
            activatePage(button.dataset.pageTarget ?? 'overview');
          });
          button.addEventListener('keydown', event => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') {
              return;
            }

            event.preventDefault();
            let nextIndex = index;
            if (event.key === 'ArrowDown') {
              nextIndex = (index + 1) % navButtons.length;
            } else if (event.key === 'ArrowUp') {
              nextIndex = (index - 1 + navButtons.length) % navButtons.length;
            } else if (event.key === 'Home') {
              nextIndex = 0;
            } else if (event.key === 'End') {
              nextIndex = navButtons.length - 1;
            }

            const nextButton = navButtons[nextIndex];
            if (nextButton instanceof HTMLElement) {
              activatePage(nextButton.dataset.pageTarget ?? 'overview', { focusPanel: true });
            }
          });
        });

        const savedState = vscode.getState();
        const initialPage = ${JSON.stringify(initialPage)};
        const hasExplicitInitialPage = ${JSON.stringify(hasExplicitInitialPage)};
        const initialSection = ${initialSection};
        const restoredPage = typeof savedState?.activePage === 'string' && knownPages.has(savedState.activePage)
          ? savedState.activePage
          : undefined;
        const startupPage = (hasExplicitInitialPage ? initialPage : restoredPage) ?? initialPage;
        activatePage(startupPage);
        if (searchInput instanceof HTMLInputElement) {
          const startingQuery = typeof savedState?.searchQuery === 'string' && savedState.searchQuery.length > 0
            ? savedState.searchQuery
            : searchInput.value;
          if (startingQuery.length > 0) {
            searchInput.value = startingQuery;
          }
          updateSearch(startingQuery);
          searchInput.addEventListener('input', () => {
            updateSearch(searchInput.value);
          });
        }
        if (typeof initialSection === 'string' && initialSection.length > 0) {
          focusSection(initialSection);
        }
        let localEndpointRows = [];
        let renderLocalEndpoints = () => {};
        let experimentalSkillLearningEnabled = null;

        try {
          function bindCommandButton(id, messageType) {
            const element = document.getElementById(id);
            if (!(element instanceof HTMLButtonElement)) {
              return;
            }
            element.addEventListener('click', () => {
              vscode.postMessage({ type: messageType });
            });
          }

          bindCommandButton('openChatView', 'openChatView');
          bindCommandButton('openChatPanel', 'openChatPanel');
          bindCommandButton('openChat', 'openChat');
          bindCommandButton('openModelProviders', 'openModelProviders');
          bindCommandButton('openSpecialistIntegrations', 'openSpecialistIntegrations');
          bindCommandButton('openProjectRunCenter', 'openProjectRunCenter');
          bindCommandButton('openVoicePanel', 'openVoicePanel');
          bindCommandButton('openVisionPanel', 'openVisionPanel');
          bindCommandButton('purgeProjectMemory', 'purgeProjectMemory');
          bindCommandButton('refreshTestingInventory', 'refreshTestingInventory');
          bindCommandButton('createTestFile', 'createTestFile');
          bindCommandButton('openCoverageReport', 'openCoverageReport');

          document.querySelectorAll('[data-open-file]').forEach(element => {
            if (!(element instanceof HTMLButtonElement)) {
              return;
            }
            element.addEventListener('click', () => {
              const relativePath = element.dataset.openFile;
              if (typeof relativePath !== 'string' || relativePath.trim().length === 0) {
                return;
              }
              vscode.postMessage({ type: 'openWorkspaceFile', payload: relativePath });
            });
          });

          document.querySelectorAll('[data-settings-page]').forEach(element => {
            if (!(element instanceof HTMLButtonElement)) {
              return;
            }
            element.addEventListener('click', () => {
              const targetPage = element.dataset.settingsPage ?? 'overview';
              const targetSection = element.dataset.settingsSection ?? '';
              activatePage(targetPage, { focusPanel: true });
              if (targetSection) {
                focusSection(targetSection);
              }
            });
          });

          document.querySelectorAll('input[name="budget"]').forEach(element => {
            element.addEventListener('change', event => {
              const target = event.target;
              if (!(target instanceof HTMLInputElement)) {
                return;
              }
              vscode.postMessage({ type: 'setBudgetMode', payload: target.value });
            });
          });

          document.querySelectorAll('input[name="speed"]').forEach(element => {
            element.addEventListener('change', event => {
              const target = event.target;
              if (!(target instanceof HTMLInputElement)) {
                return;
              }
              vscode.postMessage({ type: 'setSpeedMode', payload: target.value });
            });
          });

          const localEndpointsList = document.getElementById('localEndpointsList');
          const addLocalEndpointButton = document.getElementById('addLocalEndpoint');
          localEndpointRows = Array.isArray(initialLocalOpenAiEndpoints)
            ? initialLocalOpenAiEndpoints.map(endpoint => ({
              id: typeof endpoint.id === 'string' ? endpoint.id : createLocalEndpointId(),
              label: typeof endpoint.label === 'string' ? endpoint.label : '',
              baseUrl: typeof endpoint.baseUrl === 'string' ? endpoint.baseUrl : '',
            }))
            : [];

          function normalizeLocalEndpointUrl(value) {
            const trimmed = typeof value === 'string' ? value.trim() : '';
            if (!trimmed) {
              return undefined;
            }
            try {
              const parsed = new URL(trimmed);
              if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return undefined;
              }
              return trimmed.replace(/\\/+$/, '');
            } catch {
              return undefined;
            }
          }

          function inferLocalEndpointLabelFromUrl(baseUrl) {
            try {
              const parsed = new URL(baseUrl);
              if ((parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') && parsed.port === '11434') {
                return 'Ollama';
              }
              if ((parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') && parsed.port === '1234') {
                return 'LM Studio';
              }
              const host = parsed.hostname === '127.0.0.1' ? 'localhost' : parsed.hostname;
              return parsed.port ? host + ':' + parsed.port : host;
            } catch {
              return 'Local Endpoint';
            }
          }

          function persistLocalEndpoints() {
            const payload = localEndpointRows
              .map(row => {
                const normalizedBaseUrl = normalizeLocalEndpointUrl(row.baseUrl);
                if (!normalizedBaseUrl) {
                  return undefined;
                }
                const label = row.label.trim() || inferLocalEndpointLabelFromUrl(normalizedBaseUrl);
                return {
                  id: row.id,
                  label,
                  baseUrl: normalizedBaseUrl,
                };
              })
              .filter(Boolean);
            vscode.postMessage({ type: 'setLocalOpenAiEndpoints', payload });
          }

          renderLocalEndpoints = () => {
            if (!(localEndpointsList instanceof HTMLElement)) {
              return;
            }
            localEndpointsList.innerHTML = '';
            if (localEndpointRows.length === 0) {
              const empty = document.createElement('p');
              empty.className = 'local-endpoints-empty';
              empty.textContent = 'No local endpoints configured yet. Use + to add one only when you need it.';
              localEndpointsList.appendChild(empty);
              return;
            }

            localEndpointRows.forEach((row, index) => {
              const wrapper = document.createElement('div');
              wrapper.className = 'local-endpoint-row';

              const labelField = document.createElement('div');
              labelField.className = 'local-endpoint-field';
              const labelLabel = document.createElement('label');
              labelLabel.textContent = 'Label';
              labelLabel.setAttribute('for', 'localEndpointLabel-' + row.id);
              const labelInput = document.createElement('input');
              labelInput.id = 'localEndpointLabel-' + row.id;
              labelInput.type = 'text';
              labelInput.placeholder = inferLocalEndpointLabelFromUrl(row.baseUrl || 'http://127.0.0.1:11434/v1');
              labelInput.value = row.label;
              labelInput.addEventListener('input', () => {
                row.label = labelInput.value;
              });
              labelInput.addEventListener('change', persistLocalEndpoints);
              labelInput.addEventListener('blur', persistLocalEndpoints);
              labelField.appendChild(labelLabel);
              labelField.appendChild(labelInput);

              const urlField = document.createElement('div');
              urlField.className = 'local-endpoint-field';
              const urlLabel = document.createElement('label');
              urlLabel.textContent = 'Base URL';
              urlLabel.setAttribute('for', 'localEndpointUrl-' + row.id);
              const urlInput = document.createElement('input');
              urlInput.id = 'localEndpointUrl-' + row.id;
              urlInput.type = 'url';
              urlInput.placeholder = index === 0 ? 'http://127.0.0.1:11434/v1' : 'http://127.0.0.1:1234/v1';
              urlInput.value = row.baseUrl;
              urlInput.addEventListener('input', () => {
                row.baseUrl = urlInput.value;
                labelInput.placeholder = inferLocalEndpointLabelFromUrl(urlInput.value || 'http://127.0.0.1:11434/v1');
              });
              urlInput.addEventListener('change', persistLocalEndpoints);
              urlInput.addEventListener('blur', persistLocalEndpoints);
              urlField.appendChild(urlLabel);
              urlField.appendChild(urlInput);

              const removeButton = document.createElement('button');
              removeButton.type = 'button';
              removeButton.className = 'secondary-button local-endpoint-remove';
              removeButton.textContent = '−';
              removeButton.setAttribute('aria-label', 'Remove local endpoint');
              removeButton.addEventListener('click', () => {
                localEndpointRows.splice(index, 1);
                renderLocalEndpoints();
                persistLocalEndpoints();
              });

              wrapper.appendChild(labelField);
              wrapper.appendChild(urlField);
              wrapper.appendChild(removeButton);
              localEndpointsList.appendChild(wrapper);
            });
          };

          if (addLocalEndpointButton instanceof HTMLButtonElement) {
            const endpointPresets = [
              { label: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
              { label: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1' },
              { label: 'Open WebUI', baseUrl: 'http://localhost:3000/api' },
              { label: 'LocalAI', baseUrl: 'http://localhost:8080/v1' },
              { label: 'llama.cpp', baseUrl: 'http://localhost:8080/v1' },
              { label: 'vLLM', baseUrl: 'http://localhost:8000/v1' },
              { label: 'Jan', baseUrl: 'http://localhost:1337/v1' },
            ];

            const presetMenu = document.getElementById('addEndpointMenu');

            function buildPresetMenu() {
              if (!(presetMenu instanceof HTMLUListElement)) { return; }
              presetMenu.innerHTML = '';
              endpointPresets.forEach(preset => {
                const li = document.createElement('li');
                li.setAttribute('role', 'none');
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.setAttribute('role', 'menuitem');
                const nameSpan = document.createElement('span');
                nameSpan.textContent = preset.label;
                const hintSpan = document.createElement('span');
                hintSpan.className = 'preset-hint';
                hintSpan.textContent = preset.baseUrl;
                btn.appendChild(nameSpan);
                btn.appendChild(hintSpan);
                btn.addEventListener('click', () => {
                  localEndpointRows.push({
                    id: createLocalEndpointId(),
                    label: preset.label,
                    baseUrl: preset.baseUrl,
                  });
                  renderLocalEndpoints();
                  persistLocalEndpoints();
                  closePresetMenu();
                });
                li.appendChild(btn);
                presetMenu.appendChild(li);
              });

              const sep = document.createElement('li');
              sep.setAttribute('role', 'separator');
              const sepDiv = document.createElement('div');
              sepDiv.className = 'preset-separator';
              sep.appendChild(sepDiv);
              presetMenu.appendChild(sep);

              const customLi = document.createElement('li');
              customLi.setAttribute('role', 'none');
              const customBtn = document.createElement('button');
              customBtn.type = 'button';
              customBtn.setAttribute('role', 'menuitem');
              customBtn.textContent = 'Custom endpoint\u2026';
              customBtn.addEventListener('click', () => {
                localEndpointRows.push({ id: createLocalEndpointId(), label: '', baseUrl: '' });
                renderLocalEndpoints();
                closePresetMenu();
              });
              customLi.appendChild(customBtn);
              presetMenu.appendChild(customLi);
            }

            function closePresetMenu() {
              if (presetMenu instanceof HTMLElement) {
                presetMenu.hidden = true;
              }
              document.removeEventListener('click', onOutsideClick, true);
              document.removeEventListener('keydown', onEscapeKey, true);
            }

            function onOutsideClick(event) {
              if (presetMenu instanceof HTMLElement && !presetMenu.contains(event.target) && event.target !== addLocalEndpointButton) {
                closePresetMenu();
              }
            }

            function onEscapeKey(event) {
              if (event.key === 'Escape') {
                closePresetMenu();
                addLocalEndpointButton.focus();
              }
            }

            buildPresetMenu();

            addLocalEndpointButton.addEventListener('click', () => {
              if (!(presetMenu instanceof HTMLElement)) { return; }
              const isOpen = !presetMenu.hidden;
              if (isOpen) {
                closePresetMenu();
              } else {
                presetMenu.hidden = false;
                document.addEventListener('click', onOutsideClick, true);
                document.addEventListener('keydown', onEscapeKey, true);
                const firstButton = presetMenu.querySelector('button');
                if (firstButton) { firstButton.focus(); }
              }
            });
          }

          renderLocalEndpoints();

          const toolApprovalMode = document.getElementById('toolApprovalMode');
          if (toolApprovalMode instanceof HTMLSelectElement) {
            toolApprovalMode.addEventListener('change', () => {
              vscode.postMessage({ type: 'setToolApprovalMode', payload: toolApprovalMode.value });
            });
          }

          const showImportProjectAction = document.getElementById('showImportProjectAction');
          if (showImportProjectAction instanceof HTMLInputElement) {
            showImportProjectAction.addEventListener('change', () => {
              vscode.postMessage({ type: 'setShowImportProjectAction', payload: showImportProjectAction.checked });
            });
          }

          const allowTerminalWrite = document.getElementById('allowTerminalWrite');
          if (allowTerminalWrite instanceof HTMLInputElement) {
            allowTerminalWrite.addEventListener('change', () => {
              vscode.postMessage({ type: 'setAllowTerminalWrite', payload: allowTerminalWrite.checked });
            });
          }

          const autoVerifyAfterWrite = document.getElementById('autoVerifyAfterWrite');
          if (autoVerifyAfterWrite instanceof HTMLInputElement) {
            autoVerifyAfterWrite.addEventListener('change', () => {
              vscode.postMessage({ type: 'setAutoVerifyAfterWrite', payload: autoVerifyAfterWrite.checked });
            });
          }

          const autoVerifyScripts = document.getElementById('autoVerifyScripts');
          if (autoVerifyScripts instanceof HTMLInputElement) {
            const emitScripts = () => {
              vscode.postMessage({ type: 'setAutoVerifyScripts', payload: autoVerifyScripts.value });
            };
            autoVerifyScripts.addEventListener('change', emitScripts);
            autoVerifyScripts.addEventListener('blur', emitScripts);
          }

          function bindPositiveIntegerInput(id, messageType) {
            const element = document.getElementById(id);
            if (!(element instanceof HTMLInputElement)) {
              return;
            }
            const emit = () => {
              const value = Number.parseInt(element.value, 10);
              if (!Number.isFinite(value) || value < 1) {
                return;
              }
              vscode.postMessage({ type: messageType, payload: value });
            };
            element.addEventListener('change', emit);
            element.addEventListener('blur', emit);
          }

          function bindNonNegativeNumberInput(id, messageType) {
            const element = document.getElementById(id);
            if (!(element instanceof HTMLInputElement)) {
              return;
            }
            const emit = () => {
              const value = Number.parseFloat(element.value);
              if (!Number.isFinite(value) || value < 0) {
                return;
              }
              vscode.postMessage({ type: messageType, payload: value });
            };
            element.addEventListener('change', emit);
            element.addEventListener('blur', emit);
          }

          function bindRangedNumberInput(id, messageType, min, max) {
            const element = document.getElementById(id);
            if (!(element instanceof HTMLInputElement)) {
              return;
            }
            const emit = () => {
              const value = Number.parseFloat(element.value);
              if (!Number.isFinite(value) || value < min || value > max) {
                return;
              }
              vscode.postMessage({ type: messageType, payload: value });
            };
            element.addEventListener('change', emit);
            element.addEventListener('blur', emit);
          }

          bindNonNegativeNumberInput('dailyCostLimitUsd', 'setDailyCostLimitUsd');
          bindRangedNumberInput('feedbackRoutingWeight', 'setFeedbackRoutingWeight', 0, 2);
          bindPositiveIntegerInput('autoVerifyTimeoutMs', 'setAutoVerifyTimeoutMs');
          bindPositiveIntegerInput('maxToolIterations', 'setMaxToolIterations');
          bindRangedNumberInput('voiceRate', 'setVoiceRate', 0.5, 2);
          bindRangedNumberInput('voicePitch', 'setVoicePitch', 0, 2);
          bindRangedNumberInput('voiceVolume', 'setVoiceVolume', 0, 1);
          bindPositiveIntegerInput('projectApprovalFileThreshold', 'setProjectApprovalFileThreshold');
          bindPositiveIntegerInput('chatSessionTurnLimit', 'setChatSessionTurnLimit');
          bindPositiveIntegerInput('chatSessionContextChars', 'setChatSessionContextChars');
          bindPositiveIntegerInput('projectEstimatedFilesPerSubtask', 'setProjectEstimatedFilesPerSubtask');
          bindPositiveIntegerInput('projectChangedFileReferenceLimit', 'setProjectChangedFileReferenceLimit');

          const voiceTtsEnabled = document.getElementById('voiceTtsEnabled');
          if (voiceTtsEnabled instanceof HTMLInputElement) {
            voiceTtsEnabled.addEventListener('change', () => {
              vscode.postMessage({ type: 'setVoiceTtsEnabled', payload: voiceTtsEnabled.checked });
            });
          }

          const voiceLanguage = document.getElementById('voiceLanguage');
          if (voiceLanguage instanceof HTMLInputElement) {
            const emitVoiceLanguage = () => {
              vscode.postMessage({ type: 'setVoiceLanguage', payload: voiceLanguage.value });
            };
            voiceLanguage.addEventListener('change', emitVoiceLanguage);
            voiceLanguage.addEventListener('blur', emitVoiceLanguage);
          }

          const voiceOutputDeviceId = document.getElementById('voiceOutputDeviceId');
          if (voiceOutputDeviceId instanceof HTMLInputElement) {
            const emitVoiceOutputDeviceId = () => {
              vscode.postMessage({ type: 'setVoiceOutputDeviceId', payload: voiceOutputDeviceId.value });
            };
            voiceOutputDeviceId.addEventListener('change', emitVoiceOutputDeviceId);
            voiceOutputDeviceId.addEventListener('blur', emitVoiceOutputDeviceId);
          }

          const projectDependencyMonitoringEnabled = document.getElementById('projectDependencyMonitoringEnabled');
          if (projectDependencyMonitoringEnabled instanceof HTMLInputElement) {
            projectDependencyMonitoringEnabled.addEventListener('change', () => {
              vscode.postMessage({ type: 'setProjectDependencyMonitoringEnabled', payload: projectDependencyMonitoringEnabled.checked });
            });
          }

          function emitDependencyMonitoringProviders() {
            const selected = Array.from(document.querySelectorAll('input[name="dependencyMonitoringProvider"]:checked'))
              .map(element => element instanceof HTMLInputElement ? element.value : '')
              .filter(value => value === 'dependabot' || value === 'renovate' || value === 'snyk' || value === 'azure-devops');
            vscode.postMessage({ type: 'setProjectDependencyMonitoringProviders', payload: selected });
          }

          document.querySelectorAll('input[name="dependencyMonitoringProvider"]').forEach(element => {
            element.addEventListener('change', emitDependencyMonitoringProviders);
          });

          const projectDependencyMonitoringSchedule = document.getElementById('projectDependencyMonitoringSchedule');
          if (projectDependencyMonitoringSchedule instanceof HTMLSelectElement) {
            projectDependencyMonitoringSchedule.addEventListener('change', () => {
              vscode.postMessage({ type: 'setProjectDependencyMonitoringSchedule', payload: projectDependencyMonitoringSchedule.value });
            });
          }

          const projectDependencyMonitoringIssueTemplate = document.getElementById('projectDependencyMonitoringIssueTemplate');
          if (projectDependencyMonitoringIssueTemplate instanceof HTMLInputElement) {
            projectDependencyMonitoringIssueTemplate.addEventListener('change', () => {
              vscode.postMessage({ type: 'setProjectDependencyMonitoringIssueTemplate', payload: projectDependencyMonitoringIssueTemplate.checked });
            });
          }

          const projectRunReportFolder = document.getElementById('projectRunReportFolder');
          if (projectRunReportFolder instanceof HTMLInputElement) {
            const emitFolder = () => {
              const value = projectRunReportFolder.value.trim();
              if (value.length === 0) {
                return;
              }
              vscode.postMessage({ type: 'setProjectRunReportFolder', payload: value });
            };
            projectRunReportFolder.addEventListener('change', emitFolder);
            projectRunReportFolder.addEventListener('blur', emitFolder);
          }

          experimentalSkillLearningEnabled = document.getElementById('experimentalSkillLearningEnabled');
          if (experimentalSkillLearningEnabled instanceof HTMLInputElement) {
            experimentalSkillLearningEnabled.addEventListener('change', () => {
              vscode.postMessage({
                type: 'setExperimentalSkillLearningEnabled',
                payload: experimentalSkillLearningEnabled.checked,
              });
            });
          }
        } catch (error) {
          console.error('AtlasMind settings controls failed to initialize', error);
        }

        document.body.classList.add('settings-pages-ready');

        window.addEventListener('message', event => {
          const message = event.data;
          if (message?.type === 'syncNavigation') {
            const page = typeof message.payload?.page === 'string' ? message.payload.page : 'overview';
            const query = typeof message.payload?.query === 'string' ? message.payload.query : '';
            const section = typeof message.payload?.section === 'string' ? message.payload.section : '';
            if (searchInput instanceof HTMLInputElement) {
              searchInput.value = query;
              updateSearch(query);
              searchInput.focus();
              searchInput.select();
            }
            activatePage(page);
            focusSection(section);
            return;
          }
          if (message?.type === 'syncLocalOpenAiEndpoints' && Array.isArray(message.payload)) {
            localEndpointRows.splice(0, localEndpointRows.length, ...message.payload
              .filter(endpoint => endpoint && typeof endpoint === 'object')
              .map(endpoint => ({
                id: typeof endpoint.id === 'string' ? endpoint.id : createLocalEndpointId(),
                label: typeof endpoint.label === 'string' ? endpoint.label : '',
                baseUrl: typeof endpoint.baseUrl === 'string' ? endpoint.baseUrl : '',
              })));
            renderLocalEndpoints();
            return;
          }
          if (message?.type === 'syncExperimentalSkillLearningEnabled' && experimentalSkillLearningEnabled instanceof HTMLInputElement) {
            experimentalSkillLearningEnabled.checked = Boolean(message.payload);
          }
        });
      `,
    });
  }
}

function renderTestingPage(snapshot: TestingDashboardSnapshot, isActive: boolean): string {
  const scriptMarkup = snapshot.packageScripts.length > 0
    ? snapshot.packageScripts.map(script => `<span class="info-chip">${escapeHtml(script)}</span>`).join('')
    : '<span class="info-chip">No test scripts found</span>';

  const configMarkup = snapshot.configFiles.length > 0
    ? snapshot.configFiles.map(file => `<button type="button" class="secondary-button" data-open-file="${escapeHtml(file)}">${escapeHtml(path.posix.basename(file))}</button>`).join('')
    : '<p class="info-note">No dedicated test config files were detected in the workspace root.</p>';

  const fileMarkup = snapshot.files.length > 0
    ? snapshot.files.map(file => {
      const categoryLabel = file.category.charAt(0).toUpperCase() + file.category.slice(1);
      return `
        <li class="test-file-row">
          <div>
            <div class="test-file-title">${escapeHtml(path.posix.basename(file.relativePath))}</div>
            <div class="test-file-path">${escapeHtml(file.relativePath)}</div>
            <div class="mini-meta">
              <span>${escapeHtml(categoryLabel)}</span>
              <span>${file.suites} suites</span>
              <span>${file.cases} cases</span>
              <span>${escapeHtml(file.lastModifiedLabel)}</span>
            </div>
          </div>
          <div class="button-stack">
            <button type="button" class="secondary-button" data-open-file="${escapeHtml(file.relativePath)}">Open</button>
          </div>
        </li>`;
    }).join('')
    : '<p class="local-endpoints-empty">No test files were discovered yet. Use the Create Test File action to seed a new suite.</p>';

  const coverageDisabled = snapshot.coverageReportRelativePath || snapshot.coverageDataRelativePath ? '' : 'disabled';

  return `
          <section id="page-testing" class="settings-page ${isActive ? 'active fallback-visible' : ''}" role="tabpanel" aria-labelledby="tab-testing" tabindex="0">
            <div class="page-header">
              <p class="page-kicker">Testing</p>
              <h2>Test inventory, coverage, and maintenance</h2>
              <p>Review the project test suite, open existing specs for editing, seed new ones, and jump to the settings that affect verification behavior.</p>
            </div>

            <div class="stats-grid">
              ${renderTestingStatCard('Framework', snapshot.frameworkLabel, 'Detected from package scripts and dependencies.')}
              ${renderTestingStatCard('Testing policy', snapshot.testingPolicyLabel, snapshot.testingPolicyDetail)}
              ${renderTestingStatCard('Discovered files', String(snapshot.totalFiles), `${snapshot.unitFiles} unit • ${snapshot.integrationFiles} integration • ${snapshot.e2eFiles} e2e`) }
              ${renderTestingStatCard('Test cases', String(snapshot.totalCases), `${snapshot.totalSuites} describe blocks across the visible suite.`)}
              ${renderTestingStatCard('Coverage report', snapshot.coveragePercent ?? '—', snapshot.coverageDetail)}
            </div>

            <div class="page-grid two-up">
              <article id="testingInventoryCard" class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Review</p>
                  <h3>Test inventory</h3>
                </div>
                <p class="card-copy">Recently changed and discoverable test files in the workspace.</p>
                <ul class="test-file-list">${fileMarkup}</ul>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Actions</p>
                  <h3>Manage tests</h3>
                </div>
                <div class="button-stack">
                  <button id="refreshTestingInventory" type="button">Refresh inventory</button>
                  <button id="createTestFile" type="button">Create Test File</button>
                  <button id="openCoverageReport" type="button" ${coverageDisabled}>Open Coverage Report</button>
                </div>
                <div class="info-band top-gap">
                  <strong>Suite density:</strong> ${escapeHtml(snapshot.averageCasesPerFile)} average cases per discovered file.
                </div>
                <div class="field-stack top-gap">
                  <span class="field-label">Detected test scripts</span>
                  <div class="inline-chip-list">${scriptMarkup}</div>
                </div>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Configuration</p>
                  <h3>Associated settings</h3>
                </div>
                <div class="button-stack">
                  <button type="button" class="secondary-button" data-settings-page="safety" data-settings-section="autoVerifyScripts">Verification scripts</button>
                  <button type="button" class="secondary-button" data-settings-page="safety" data-settings-section="maxToolIterations">Execution limits</button>
                  <button type="button" class="secondary-button" data-settings-page="project" data-settings-section="projectRunReportFolder">Run report folder</button>
                </div>
                <p class="info-note top-gap">These links take you straight to the settings that shape automatic validation and long-running test workflows.</p>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Files</p>
                  <h3>Coverage and test config</h3>
                </div>
                <div class="button-stack">${configMarkup}</div>
                <p class="info-note top-gap">Open the config and manifest files that define how AtlasMind and your package runner verify this workspace.</p>
              </article>
            </div>
          </section>`;
}

function renderTestingStatCard(label: string, value: string, meta: string): string {
  return `
    <article class="stat-card">
      <span class="stat-label">${escapeHtml(label)}</span>
      <span class="stat-value">${escapeHtml(value)}</span>
      <div class="stat-meta">${escapeHtml(meta)}</div>
    </article>`;
}

export function collectTestingDashboardSnapshot(): TestingDashboardSnapshot {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const verificationEnabled = configuration.get<boolean>('autoVerifyAfterWrite', true);
  const verificationScripts = (configuration.get<string[]>('autoVerifyScripts', ['test']) ?? [])
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean);
  const testingPolicyOverride = getNonEmptyString(configuration.get<string>('testingPolicyOverride'), '');
  const testingPolicyLabel = testingPolicyOverride || 'Red-Green TDD';
  const testingPolicyDetail = testingPolicyOverride
    ? 'Using the workspace override configured for AtlasMind testing policy.'
    : verificationEnabled
      ? 'Default Atlas policy: capture the smallest relevant failing test first, then turn it green.'
      : 'Default Atlas policy still prefers tests-first behavior changes, but verification is currently more manual.';

  if (!workspaceRoot) {
    return {
      frameworkLabel: 'No workspace',
      testingPolicyLabel,
      testingPolicyDetail,
      totalFiles: 0,
      totalSuites: 0,
      totalCases: 0,
      unitFiles: 0,
      integrationFiles: 0,
      e2eFiles: 0,
      averageCasesPerFile: '0',
      coverageDetail: 'Open a workspace to inspect tests and coverage.',
      packageScripts: [],
      configFiles: [],
      files: [],
      tests: [],
      categoryCounts: [
        { key: 'unit', label: 'Unit', count: 0 },
        { key: 'integration', label: 'Integration', count: 0 },
        { key: 'e2e', label: 'E2E', count: 0 },
        { key: 'other', label: 'Other', count: 0 },
      ],
      verificationEnabled,
      verificationScripts,
    };
  }

  let packageScripts: string[] = [];
  let frameworkLabel = 'Workspace tests';
  const configFiles: string[] = [];
  const packageJsonPath = path.join(workspaceRoot, 'package.json');
  if (existsSync(packageJsonPath)) {
    configFiles.push('package.json');
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      packageScripts = Object.keys(packageJson.scripts ?? {})
        .filter(name => /(test|coverage|vitest|jest|playwright|cypress|watch)/i.test(name))
        .slice(0, 8);
      frameworkLabel = inferTestingFramework(packageJson);
    } catch {
      frameworkLabel = 'Workspace tests';
    }
  }

  for (const candidate of ['vitest.config.ts', 'vitest.config.mts', 'vitest.config.js', 'jest.config.ts', 'jest.config.js', 'playwright.config.ts']) {
    if (existsSync(path.join(workspaceRoot, candidate))) {
      configFiles.push(candidate);
    }
  }

  const discoveredFiles = discoverTestFiles(workspaceRoot);
  let totalSuites = 0;
  let totalCases = 0;
  let unitFiles = 0;
  let integrationFiles = 0;
  let e2eFiles = 0;
  const discoveredTests: TestingCaseSummary[] = [];

  const fileSummaries = discoveredFiles.map(filePath => {
    const relativePath = toWorkspaceRelativePath(workspaceRoot, filePath);
    const category = inferTestingCategory(relativePath);
    const fileText = safeReadTextFile(filePath);
    const suites = countPatternMatches(fileText, /\bdescribe\s*\(/g);
    const cases = countPatternMatches(fileText, /\b(?:it|test)(?:\.(?:only|skip|todo|fails|concurrent))?(?:\.each\([^)]*\))?\s*\(/g);
    const modified = statSync(filePath).mtime;
    const lastModifiedLabel = `Updated ${modified.toISOString().slice(0, 10)}`;

    totalSuites += suites;
    totalCases += cases;
    discoveredTests.push(...extractIndividualTests(fileText, relativePath, category));
    if (category === 'unit') {
      unitFiles += 1;
    } else if (category === 'integration') {
      integrationFiles += 1;
    } else if (category === 'e2e') {
      e2eFiles += 1;
    }

    return {
      relativePath,
      category,
      suites,
      cases,
      lastModifiedLabel,
    } satisfies TestingFileSummary;
  });

  const coverageInfoPath = path.join(workspaceRoot, 'coverage', 'lcov.info');
  const coverage = parseLcovCoverage(coverageInfoPath);
  const coverageReportRelativePath = existsSync(path.join(workspaceRoot, 'coverage', 'lcov-report', 'index.html'))
    ? 'coverage/lcov-report/index.html'
    : (existsSync(path.join(workspaceRoot, 'coverage', 'index.html')) ? 'coverage/index.html' : undefined);

  return {
    frameworkLabel,
    testingPolicyLabel,
    testingPolicyDetail,
    totalFiles: discoveredFiles.length,
    totalSuites,
    totalCases,
    unitFiles,
    integrationFiles,
    e2eFiles,
    averageCasesPerFile: discoveredFiles.length > 0 ? getRangedNumber(totalCases / discoveredFiles.length, 0, 0, 999, 1) : '0',
    coveragePercent: coverage.percent,
    coverageDetail: coverage.detail,
    packageScripts,
    configFiles,
    coverageReportRelativePath,
    coverageDataRelativePath: coverage.exists ? 'coverage/lcov.info' : undefined,
    files: fileSummaries.slice(0, 12),
    tests: discoveredTests.slice(0, MAX_DISCOVERED_TEST_CASES),
    categoryCounts: [
      { key: 'unit', label: 'Unit', count: discoveredTests.filter(test => test.category === 'unit').length },
      { key: 'integration', label: 'Integration', count: discoveredTests.filter(test => test.category === 'integration').length },
      { key: 'e2e', label: 'E2E', count: discoveredTests.filter(test => test.category === 'e2e').length },
      { key: 'other', label: 'Other', count: discoveredTests.filter(test => test.category === 'other').length },
    ],
    verificationEnabled,
    verificationScripts,
  };
}

function extractIndividualTests(
  fileText: string,
  relativePath: string,
  category: TestingFileSummary['category'],
): TestingCaseSummary[] {
  const lines = fileText.split(/\r?\n/g);
  const tests: TestingCaseSummary[] = [];
  let currentSuite = 'Top-level tests';

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const describeMatch = line.match(/\bdescribe(?:\.(?:only|skip))?\s*\(\s*(["'`])(.+?)\1/);
    if (describeMatch?.[2]) {
      currentSuite = describeMatch[2].trim();
    }

    const testMatch = line.match(/\b(?:it|test)(?:\.(?:only|skip|todo|fails|concurrent))?(?:\.each\([^)]*\))?\s*\(\s*(["'`])(.+?)\1/);
    if (!testMatch?.[2]) {
      continue;
    }

    const title = testMatch[2].trim();
    const blockLines = collectTestBlockLines(lines, index);
    const description = findNearestComment(lines, index) || `${currentSuite} → ${title}`;
    tests.push({
      id: `${relativePath}:${index + 1}:${tests.length + 1}`,
      title,
      suiteTitle: currentSuite,
      relativePath,
      category,
      line: index + 1,
      description,
      inputSummary: summarizeTestInputs(blockLines),
      outputSummary: summarizeTestOutputs(blockLines),
    });
  }

  return tests;
}

function collectTestBlockLines(lines: string[], startIndex: number): string[] {
  const block: string[] = [];
  let depth = 0;

  for (let index = startIndex; index < Math.min(lines.length, startIndex + 24); index += 1) {
    const line = lines[index] ?? '';
    if (index > startIndex && /\b(?:describe|it|test)\b/.test(line) && depth <= 0) {
      break;
    }
    block.push(line);
    depth += countPatternMatches(line, /\{/g) - countPatternMatches(line, /\}/g);
    if (index > startIndex && depth <= 0 && /\)?\s*;?\s*$/.test(line.trim())) {
      break;
    }
  }

  return block;
}

function findNearestComment(lines: string[], index: number): string | undefined {
  for (let cursor = index - 1; cursor >= Math.max(0, index - 3); cursor -= 1) {
    const candidate = (lines[cursor] ?? '').trim().replace(/^\/\/\s?/, '').replace(/^\*\s?/, '');
    if (!candidate) {
      continue;
    }
    if (candidate.startsWith('//') || lines[cursor]?.trim().startsWith('//') || lines[cursor]?.trim().startsWith('*')) {
      return candidate;
    }
    break;
  }
  return undefined;
}

function summarizeTestInputs(lines: string[]): string {
  const inputLines = lines
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .filter(line => !/^\s*(?:it|test|describe)\b/.test(line))
    .filter(line => !/^\s*(?:expect\s*\(|await expect\s*\()/.test(line))
    .filter(line => !/^[)};]+$/.test(line))
    .slice(0, 3)
    .map(cleanCodePreview);
  return inputLines.length > 0 ? inputLines.join(' • ') : 'See the source block for arrange and act details.';
}

function summarizeTestOutputs(lines: string[]): string {
  const outputLines = lines
    .map(line => line.trim())
    .filter(line => /\bexpect\s*\(|\bto(?:Be|Equal|Contain|Match|Throw|Have)\b/.test(line))
    .slice(0, 3)
    .map(cleanCodePreview);
  return outputLines.length > 0 ? outputLines.join(' • ') : 'No explicit assertion summary was detected in this snippet.';
}

function cleanCodePreview(line: string): string {
  return line.replace(/\s+/g, ' ').replace(/^[{(\[]+|[})\];,]+$/g, '').slice(0, 140).trim();
}

function discoverTestFiles(workspaceRoot: string): string[] {
  const results: Array<{ filePath: string; mtimeMs: number }> = [];
  const pending = [workspaceRoot];

  while (pending.length > 0 && results.length < MAX_DISCOVERED_TEST_FILES) {
    const current = pending.pop();
    if (!current) {
      continue;
    }

    let entries: Array<import('node:fs').Dirent<string>>;
    try {
      entries = readdirSync(current, { withFileTypes: true, encoding: 'utf8' });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!TEST_SCAN_EXCLUDED_DIRS.has(entry.name.toLowerCase())) {
          pending.push(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const relativePath = toWorkspaceRelativePath(workspaceRoot, fullPath);
      const isNamedTest = TEST_FILE_NAME_PATTERN.test(entry.name);
      const isTestFolderSource = /(^|\/)(tests?|__tests__)(\/|$)/i.test(relativePath) && TEST_CODE_EXT_PATTERN.test(entry.name) && !entry.name.endsWith('.d.ts');
      if (!isNamedTest && !isTestFolderSource) {
        continue;
      }

      try {
        results.push({ filePath: fullPath, mtimeMs: statSync(fullPath).mtimeMs });
      } catch {
        // Ignore stat failures for transient files.
      }
    }
  }

  return results
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .map(item => item.filePath);
}

function inferTestingFramework(packageJson: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }): string {
  const dependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  };

  if ('vitest' in dependencies) {
    return 'Vitest';
  }
  if ('jest' in dependencies) {
    return 'Jest';
  }
  if ('playwright' in dependencies || '@playwright/test' in dependencies) {
    return 'Playwright';
  }
  if ('cypress' in dependencies) {
    return 'Cypress';
  }
  if ('mocha' in dependencies) {
    return 'Mocha';
  }

  const scriptNames = Object.keys(packageJson.scripts ?? {}).join(' ').toLowerCase();
  if (scriptNames.includes('vitest')) {
    return 'Vitest';
  }
  if (scriptNames.includes('jest')) {
    return 'Jest';
  }
  if (scriptNames.includes('playwright')) {
    return 'Playwright';
  }
  return 'Workspace tests';
}

function inferTestingCategory(relativePath: string): TestingFileSummary['category'] {
  if (/(^|\/)(e2e|playwright|cypress)(\/|$)/i.test(relativePath)) {
    return 'e2e';
  }
  if (/integration/i.test(relativePath)) {
    return 'integration';
  }
  if (/unit/i.test(relativePath) || /(?:test|spec)/i.test(relativePath)) {
    return 'unit';
  }
  return 'other';
}

function safeReadTextFile(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8').slice(0, MAX_TEST_FILE_BYTES);
  } catch {
    return '';
  }
}

function countPatternMatches(content: string, pattern: RegExp): number {
  return content.match(pattern)?.length ?? 0;
}

function parseLcovCoverage(filePath: string): { exists: boolean; percent?: string; detail: string } {
  if (!existsSync(filePath)) {
    return { exists: false, detail: 'No coverage report found yet. Generate one from your test runner when you need line-hit metrics.' };
  }

  try {
    const content = readFileSync(filePath, 'utf8');
    let linesFound = 0;
    let linesHit = 0;
    for (const line of content.split(/\r?\n/g)) {
      if (line.startsWith('LF:')) {
        linesFound += Number.parseInt(line.slice(3), 10) || 0;
      } else if (line.startsWith('LH:')) {
        linesHit += Number.parseInt(line.slice(3), 10) || 0;
      }
    }

    if (linesFound <= 0) {
      return { exists: true, detail: 'Coverage data exists, but AtlasMind could not extract line totals from it.' };
    }

    const percent = ((linesHit / linesFound) * 100).toFixed(1).replace(/\.0$/, '');
    return {
      exists: true,
      percent: `${percent}%`,
      detail: `${linesHit}/${linesFound} lines hit in the latest LCOV report.`,
    };
  } catch {
    return { exists: true, detail: 'Coverage data exists, but the report could not be parsed safely.' };
  }
}

function toWorkspaceRelativePath(workspaceRoot: string, filePath: string): string {
  return path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
}

function isSafeWorkspaceRelativePath(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const normalized = value.trim().replace(/\\/g, '/');
  if (normalized.length === 0 || normalized.includes('\0') || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    return false;
  }
  return normalized.split('/').every(segment => segment.length > 0 && segment !== '..');
}

function resolveWorkspaceRelativePath(workspaceRoot: string, candidate: string): string | undefined {
  if (!isSafeWorkspaceRelativePath(candidate)) {
    return undefined;
  }
  const resolved = path.resolve(workspaceRoot, candidate);
  const relative = path.relative(workspaceRoot, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return undefined;
  }
  return resolved;
}

export function isSettingsMessage(value: unknown): value is SettingsMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }

  const message = value as { type?: unknown; payload?: unknown };
  if (message.type === 'setBudgetMode') {
    return typeof message.payload === 'string' && BUDGET_MODES.includes(message.payload as BudgetMode);
  }

  if (message.type === 'setSpeedMode') {
    return typeof message.payload === 'string' && SPEED_MODES.includes(message.payload as SpeedMode);
  }

  if (message.type === 'setFeedbackRoutingWeight') {
    return typeof message.payload === 'number'
      && Number.isFinite(message.payload)
      && message.payload >= 0
      && message.payload <= 2;
  }

  if (message.type === 'setLocalOpenAiBaseUrl') {
    return typeof message.payload === 'string' && message.payload.trim().length > 0;
  }

  if (message.type === 'setLocalOpenAiEndpoints') {
    return Array.isArray(message.payload) && message.payload.every(candidate => {
      if (typeof candidate !== 'object' || candidate === null) {
        return false;
      }
      const record = candidate as Record<string, unknown>;
      return typeof record['id'] === 'string'
        && record['id'].trim().length > 0
        && typeof record['label'] === 'string'
        && record['label'].trim().length > 0
        && typeof record['baseUrl'] === 'string'
        && record['baseUrl'].trim().length > 0;
    });
  }

  if (message.type === 'setDailyCostLimitUsd') {
    return typeof message.payload === 'number' && Number.isFinite(message.payload) && message.payload >= 0;
  }

  if (message.type === 'setToolApprovalMode') {
    return typeof message.payload === 'string' && [
      'always-ask',
      'ask-on-write',
      'ask-on-external',
      'allow-safe-readonly',
    ].includes(message.payload);
  }

  if (message.type === 'setShowImportProjectAction') {
    return typeof message.payload === 'boolean';
  }

  if (message.type === 'setAllowTerminalWrite') {
    return typeof message.payload === 'boolean';
  }

  if (message.type === 'setAutoVerifyAfterWrite') {
    return typeof message.payload === 'boolean';
  }

  if (message.type === 'setAutoVerifyScripts') {
    return typeof message.payload === 'string';
  }

  if (message.type === 'setVoiceTtsEnabled') {
    return typeof message.payload === 'boolean';
  }

  if (message.type === 'setVoiceLanguage' || message.type === 'setVoiceOutputDeviceId') {
    return typeof message.payload === 'string';
  }

  if (message.type === 'setVoiceRate') {
    return typeof message.payload === 'number'
      && Number.isFinite(message.payload)
      && message.payload >= 0.5
      && message.payload <= 2;
  }

  if (message.type === 'setVoicePitch') {
    return typeof message.payload === 'number'
      && Number.isFinite(message.payload)
      && message.payload >= 0
      && message.payload <= 2;
  }

  if (message.type === 'setVoiceVolume') {
    return typeof message.payload === 'number'
      && Number.isFinite(message.payload)
      && message.payload >= 0
      && message.payload <= 1;
  }

  if (
    message.type === 'setAutoVerifyTimeoutMs' ||
    message.type === 'setChatSessionTurnLimit' ||
    message.type === 'setChatSessionContextChars' ||
    message.type === 'setProjectApprovalFileThreshold' ||
    message.type === 'setProjectEstimatedFilesPerSubtask' ||
    message.type === 'setProjectChangedFileReferenceLimit' ||
    message.type === 'setMaxToolIterations'
  ) {
    return typeof message.payload === 'number' && Number.isFinite(message.payload) && message.payload >= 1;
  }

  if (message.type === 'setProjectRunReportFolder') {
    return typeof message.payload === 'string' && message.payload.trim().length > 0;
  }

  if (message.type === 'setProjectDependencyMonitoringEnabled') {
    return typeof message.payload === 'boolean';
  }

  if (message.type === 'setProjectDependencyMonitoringProviders') {
    return Array.isArray(message.payload) && message.payload.every(value => DEPENDENCY_MONITORING_PROVIDERS.includes(value as DependencyMonitoringProvider));
  }

  if (message.type === 'setProjectDependencyMonitoringSchedule') {
    return typeof message.payload === 'string' && DEPENDENCY_MONITORING_SCHEDULES.includes(message.payload as DependencyMonitoringSchedule);
  }

  if (message.type === 'setProjectDependencyMonitoringIssueTemplate') {
    return typeof message.payload === 'boolean';
  }

  if (message.type === 'setExperimentalSkillLearningEnabled') {
    return typeof message.payload === 'boolean';
  }

  if (message.type === 'openWorkspaceFile') {
    return isSafeWorkspaceRelativePath(message.payload);
  }

  if (
    message.type === 'refreshTestingInventory' ||
    message.type === 'createTestFile' ||
    message.type === 'openCoverageReport'
  ) {
    return true;
  }

  if (
    message.type === 'purgeProjectMemory' ||
    message.type === 'openChatView' ||
    message.type === 'openChatPanel' ||
    message.type === 'openModelProviders' ||
    message.type === 'openSpecialistIntegrations' ||
    message.type === 'openProjectRunCenter' ||
    message.type === 'openVoicePanel' ||
    message.type === 'openVisionPanel' ||
    message.type === 'openChat'
  ) {
    return true;
  }

  return false;
}

function normalizeSettingsPanelTarget(target?: SettingsPageId | SettingsPanelTarget): SettingsPanelTarget {
  if (typeof target === 'string') {
    return { page: isSettingsPageId(target) ? target : undefined };
  }

  const page = isSettingsPageId(target?.page) ? target?.page : undefined;
  const query = typeof target?.query === 'string' && target.query.trim().length > 0 ? target.query.trim() : undefined;
  const section = typeof target?.section === 'string' && target.section.trim().length > 0 ? target.section.trim() : undefined;
  return { page, query, section };
}

function isSettingsPageId(value: unknown): value is SettingsPageId {
  return typeof value === 'string' && SETTINGS_PAGE_IDS.includes(value as SettingsPageId);
}

function getBudgetMode(value: string | undefined): BudgetMode {
  return BUDGET_MODES.includes(value as BudgetMode) ? value as BudgetMode : 'balanced';
}

function getSpeedMode(value: string | undefined): SpeedMode {
  return SPEED_MODES.includes(value as SpeedMode) ? value as SpeedMode : 'balanced';
}

function getNonNegativeNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function getToolApprovalMode(value: string | undefined): 'always-ask' | 'ask-on-write' | 'ask-on-external' | 'allow-safe-readonly' {
  switch (value) {
    case 'always-ask':
    case 'ask-on-write':
    case 'ask-on-external':
    case 'allow-safe-readonly':
      return value;
    default:
      return 'ask-on-write';
  }
}

function getDependencyMonitoringProviders(value: string[] | undefined): DependencyMonitoringProvider[] {
  const providers = (value ?? []).filter(candidate => DEPENDENCY_MONITORING_PROVIDERS.includes(candidate as DependencyMonitoringProvider)) as DependencyMonitoringProvider[];
  return providers;
}

function getDependencyMonitoringSchedule(value: string | undefined): DependencyMonitoringSchedule {
  return DEPENDENCY_MONITORING_SCHEDULES.includes(value as DependencyMonitoringSchedule)
    ? value as DependencyMonitoringSchedule
    : 'weekly';
}

function getPositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.floor(value);
}

function getRangedNumber(value: number | undefined, fallback: number, min: number, max: number, decimals = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback.toFixed(decimals);
  }

  const clamped = Math.min(max, Math.max(min, value));
  return clamped.toFixed(decimals).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function renderFieldLabel(forId: string, text: string, helpId: SettingsHelpId): string {
  return `<label for="${escapeHtml(forId)}" class="label-with-help"><span>${escapeHtml(text)}</span>${renderHelpIndicator(helpId)}</label>`;
}

function renderHeadingWithHelp(text: string, helpId: SettingsHelpId): string {
  return `<span class="heading-with-help"><span>${escapeHtml(text)}</span>${renderHelpIndicator(helpId)}</span>`;
}

function renderRoutingChoicePill(group: 'budget' | 'speed', value: string, label: string, checked: boolean, description: string): string {
  const escapedDescription = escapeHtml(description);
  return `<label class="choice-pill" data-tooltip="${escapedDescription}" title="${escapedDescription}"><input type="radio" name="${escapeHtml(group)}" value="${escapeHtml(value)}" ${checked ? 'checked' : ''} aria-label="${escapeHtml(`${label}. ${description}`)}"><span>${escapeHtml(label)}</span></label>`;
}

function renderHelpIndicator(helpId: SettingsHelpId): string {
  return `<span class="help-indicator" tabindex="0" role="note" aria-label="${escapeHtml(SETTINGS_HELP[helpId])}" data-tooltip="${escapeHtml(SETTINGS_HELP[helpId])}">?</span>`;
}

function getNonEmptyString(value: string | undefined, fallback: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fallback;
  }
  return value.trim();
}

function normalizeLocalOpenAiBaseUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    return trimmed.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

function normalizeLocalOpenAiEndpoints(endpoints: LocalEndpointConfig[]): LocalEndpointConfig[] {
  const usedIds = new Set<string>();
  const normalized: LocalEndpointConfig[] = [];
  for (const [index, endpoint] of endpoints.entries()) {
    const baseUrl = normalizeLocalOpenAiBaseUrl(endpoint.baseUrl);
    if (!baseUrl) {
      continue;
    }

    const label = endpoint.label.trim().length > 0
      ? endpoint.label.trim()
      : inferLocalEndpointLabel(baseUrl);

    let id = endpoint.id.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    if (!id || usedIds.has(id)) {
      id = `endpoint-${index + 1}`;
      let suffix = 2;
      while (usedIds.has(id)) {
        id = `endpoint-${index + 1}-${suffix}`;
        suffix += 1;
      }
    }
    usedIds.add(id);
    normalized.push({ id, label, baseUrl });
  }
  return normalized;
}

type ConfigInspectShape<T> = {
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
};

async function migrateLegacyLocalOpenAiSettings(configuration: vscode.WorkspaceConfiguration): Promise<LocalEndpointConfig[] | undefined> {
  const endpointsInspect = configuration.inspect<unknown>('localOpenAiEndpoints') as ConfigInspectShape<unknown> | undefined;
  if (hasExplicitConfigurationValue(endpointsInspect)) {
    return undefined;
  }

  const legacyInspect = configuration.inspect<string>('localOpenAiBaseUrl') as ConfigInspectShape<string> | undefined;
  const legacyResolution = resolveLegacyLocalEndpointMigration(legacyInspect);
  if (!legacyResolution) {
    return undefined;
  }

  const normalized = normalizeLocalOpenAiEndpoints([{
    id: inferLocalEndpointLabel(legacyResolution.baseUrl),
    label: inferLocalEndpointLabel(legacyResolution.baseUrl),
    baseUrl: legacyResolution.baseUrl,
  }]);
  if (normalized.length === 0) {
    return undefined;
  }

  await configuration.update('localOpenAiEndpoints', normalized, legacyResolution.target);
  return normalized;
}

function hasExplicitConfigurationValue(inspect: ConfigInspectShape<unknown> | undefined): boolean {
  return inspect?.workspaceFolderValue !== undefined
    || inspect?.workspaceValue !== undefined
    || inspect?.globalValue !== undefined;
}

function resolveLegacyLocalEndpointMigration(inspect: ConfigInspectShape<string> | undefined): { baseUrl: string; target: vscode.ConfigurationTarget } | undefined {
  const workspaceFolderBaseUrl = normalizeLocalOpenAiBaseUrl(inspect?.workspaceFolderValue ?? '');
  if (workspaceFolderBaseUrl) {
    return { baseUrl: workspaceFolderBaseUrl, target: vscode.ConfigurationTarget.WorkspaceFolder };
  }

  const workspaceBaseUrl = normalizeLocalOpenAiBaseUrl(inspect?.workspaceValue ?? '');
  if (workspaceBaseUrl) {
    return { baseUrl: workspaceBaseUrl, target: vscode.ConfigurationTarget.Workspace };
  }

  const globalBaseUrl = normalizeLocalOpenAiBaseUrl(inspect?.globalValue ?? '');
  if (globalBaseUrl) {
    return { baseUrl: globalBaseUrl, target: vscode.ConfigurationTarget.Global };
  }

  return undefined;
}

function serializeForInlineScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}
