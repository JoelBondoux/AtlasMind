import * as vscode from 'vscode';
import { getConfiguredLocalEndpoints, inferLocalEndpointLabel, type LocalEndpointConfig } from '../providers/index.js';
import { escapeHtml, getWebviewHtmlShell } from './webviewUtils.js';

const BUDGET_MODES = ['cheap', 'balanced', 'expensive', 'auto'] as const;
        function createLocalEndpointId() {
          return 'endpoint-' + Math.random().toString(36).slice(2, 10);
        }

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
} as const;

type BudgetMode = (typeof BUDGET_MODES)[number];
type SpeedMode = (typeof SPEED_MODES)[number];
type DependencyMonitoringProvider = (typeof DEPENDENCY_MONITORING_PROVIDERS)[number];
type DependencyMonitoringSchedule = (typeof DEPENDENCY_MONITORING_SCHEDULES)[number];
type SettingsHelpId = keyof typeof SETTINGS_HELP;
export const SETTINGS_PAGE_IDS = ['overview', 'chat', 'models', 'safety', 'project', 'experimental'] as const;
export type SettingsPageId = (typeof SETTINGS_PAGE_IDS)[number];
export interface SettingsPanelTarget {
  page?: SettingsPageId;
  query?: string;
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
  | { type: 'purgeProjectMemory' }
  | { type: 'openChatView' }
  | { type: 'openChatPanel' }
  | { type: 'openModelProviders' }
  | { type: 'openSpecialistIntegrations' }
  | { type: 'openProjectRunCenter' }
  | { type: 'openVoicePanel' }
  | { type: 'openVisionPanel' }
  | { type: 'openChat' };

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

  public static createOrShow(context: vscode.ExtensionContext, target?: SettingsPageId | SettingsPanelTarget): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    const normalizedTarget = normalizeSettingsPanelTarget(target);

    if (SettingsPanel.currentPanel) {
      SettingsPanel.currentPanel.panel.reveal(column);
      void SettingsPanel.currentPanel.focusTarget(normalizedTarget);
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
    SettingsPanel.currentPanel = new SettingsPanel(panel, normalizedTarget, extensionVersion);
  }

  private constructor(panel: vscode.WebviewPanel, initialTarget?: SettingsPanelTarget, extensionVersion = 'unknown') {
    this.panel = panel;
    this.initialTarget = initialTarget;
    this.extensionVersion = extensionVersion;
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

  private async focusTarget(target?: SettingsPanelTarget): Promise<void> {
    const normalizedTarget = normalizeSettingsPanelTarget(target);
    if (!normalizedTarget.page && !normalizedTarget.query) {
      return;
    }

    await this.panel.webview.postMessage({
      type: 'syncNavigation',
      payload: normalizedTarget,
    });
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
    }
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

    const initialPage = this.initialTarget?.page ?? 'overview';
    const initialQuery = escapeHtml(this.initialTarget?.query ?? '');
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
          <a class="nav-link active" id="tab-overview" href="#page-overview" data-page-target="overview" data-search="overview quick actions budget speed cost limits embedded chat detached chat project run center vscode chat" role="tab" aria-selected="true" aria-controls="page-overview">Overview</a>
          <a class="nav-link" id="tab-chat" href="#page-chat" data-page-target="chat" data-search="chat sidebar sessions import project carry-forward turns context max chars" role="tab" aria-selected="false" aria-controls="page-chat" tabindex="-1">Chat &amp; Sidebar</a>
          <a class="nav-link" id="tab-models" href="#page-models" data-page-target="models" data-search="models integrations providers local endpoint ollama lm studio azure bedrock voice vision exa specialist" role="tab" aria-selected="false" aria-controls="page-models" tabindex="-1">Models &amp; Integrations</a>
          <a class="nav-link" id="tab-safety" href="#page-safety" data-page-target="safety" data-search="safety verification approvals tool approval terminal write scripts timeout" role="tab" aria-selected="false" aria-controls="page-safety" tabindex="-1">Safety &amp; Verification</a>
          <a class="nav-link" id="tab-project" href="#page-project" data-page-target="project" data-search="project runs approval threshold estimated files changed file references report folder dependency monitoring dependabot renovate governance updates" role="tab" aria-selected="false" aria-controls="page-project" tabindex="-1">Project Runs</a>
          <a class="nav-link" id="tab-experimental" href="#page-experimental" data-page-target="experimental" data-search="experimental skill learning generated drafts" role="tab" aria-selected="false" aria-controls="page-experimental" tabindex="-1">Experimental</a>
        </nav>

        <main class="settings-main">
          <section id="page-overview" class="settings-page active" role="tabpanel" aria-labelledby="tab-overview" tabindex="0">
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

          <section id="page-chat" class="settings-page" role="tabpanel" aria-labelledby="tab-chat" tabindex="0" hidden>
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

          <section id="page-models" class="settings-page" role="tabpanel" aria-labelledby="tab-models" tabindex="0" hidden>
            <div class="page-header">
              <p class="page-kicker">Models &amp; Integrations</p>
              <h2>Provider endpoints and specialist surfaces</h2>
              <p>Use this page to reach provider management quickly and configure any local OpenAI-compatible endpoint.</p>
            </div>

            <div class="page-grid two-up">
              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Local routing</p>
                  <h3>${renderHeadingWithHelp('OpenAI-compatible endpoints', 'localOpenAiEndpoints')}</h3>
                </div>
                <p class="card-copy">Point AtlasMind at Ollama, LM Studio, Open WebUI, or multiple local OpenAI-compatible engines at once. Add rows only when you need them, and give each one a label so AtlasMind can tell you which endpoint owns which local model.</p>
                <div class="field-stack">
                  <div class="local-endpoints-header">
                    <span class="field-label field-label-with-help"><span>Configured local endpoints</span>${renderHelpIndicator('localOpenAiEndpoints')}</span>
                    <button id="addLocalEndpoint" type="button" class="secondary-button local-endpoint-add" aria-label="Add local endpoint">+</button>
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

          <section id="page-safety" class="settings-page" role="tabpanel" aria-labelledby="tab-safety" tabindex="0" hidden>
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
            </div>
          </section>

          <section id="page-project" class="settings-page" role="tabpanel" aria-labelledby="tab-project" tabindex="0" hidden>
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

          <section id="page-experimental" class="settings-page" role="tabpanel" aria-labelledby="tab-experimental" tabindex="0" hidden>
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
          text-align: left;
          text-decoration: none;
          border: 1px solid transparent;
          border-radius: 12px;
          padding: 11px 12px;
          background: transparent;
          color: var(--vscode-foreground);
          font-weight: 600;
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
          padding: 16px;
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
          padding: 18px;
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
          .action-grid {
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
          .local-endpoint-row {
            grid-template-columns: 1fr;
          }
          .hero-badges {
            justify-content: flex-start;
          }
        }
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
        const vscode = acquireVsCodeApi();
        const initialLocalOpenAiEndpoints = ${serializedLocalOpenAiEndpoints};

        const navButtons = Array.from(document.querySelectorAll('[data-page-target]'));
        const pages = Array.from(document.querySelectorAll('.settings-page'));
        const searchInput = document.getElementById('settingsSearch');
        const searchStatus = document.getElementById('searchStatus');
        document.body.classList.add('settings-pages-ready');

        function activatePage(pageId, options = {}) {
          const focusPanel = options.focusPanel === true;
          navButtons.forEach(button => {
            if (!(button instanceof HTMLElement)) {
              return;
            }
            const isActive = button.dataset.pageTarget === pageId;
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
            const isActive = page.id === 'page-' + pageId;
            page.classList.toggle('active', isActive);
            page.hidden = !isActive;
          });

          vscode.setState({ activePage: pageId });
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

        document.addEventListener('click', event => {
          const target = event.target;
          if (!(target instanceof Element)) {
            return;
          }
          const button = target.closest('[data-page-target]');
          if (!(button instanceof HTMLElement)) {
            return;
          }
          event.preventDefault();
          activatePage(button.dataset.pageTarget ?? 'overview');
        });

        navButtons.forEach((button, index) => {
          if (!(button instanceof HTMLElement)) {
            return;
          }
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
        activatePage(typeof savedState?.activePage === 'string' ? savedState.activePage : initialPage);
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
              return trimmed.replace(/\/+$/, '');
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
            addLocalEndpointButton.addEventListener('click', () => {
              localEndpointRows.push({ id: createLocalEndpointId(), label: '', baseUrl: '' });
              renderLocalEndpoints();
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

        window.addEventListener('message', event => {
          const message = event.data;
          if (message?.type === 'syncNavigation') {
            const page = typeof message.payload?.page === 'string' ? message.payload.page : 'overview';
            const query = typeof message.payload?.query === 'string' ? message.payload.query : '';
            if (searchInput instanceof HTMLInputElement) {
              searchInput.value = query;
              updateSearch(query);
              searchInput.focus();
              searchInput.select();
            }
            activatePage(page);
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
    message.type === 'setProjectChangedFileReferenceLimit'
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
  return { page, query };
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
