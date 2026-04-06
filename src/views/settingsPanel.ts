import * as vscode from 'vscode';
import { escapeHtml, getWebviewHtmlShell } from './webviewUtils.js';

const BUDGET_MODES = ['cheap', 'balanced', 'expensive', 'auto'] as const;
const SPEED_MODES = ['fast', 'balanced', 'considered', 'auto'] as const;
const DEPENDENCY_MONITORING_PROVIDERS = ['dependabot', 'renovate', 'snyk', 'azure-devops'] as const;
const DEPENDENCY_MONITORING_SCHEDULES = ['daily', 'weekly', 'monthly'] as const;
const DEFAULT_PROJECT_APPROVAL_FILE_THRESHOLD = 12;
const DEFAULT_ESTIMATED_FILES_PER_SUBTASK = 2;
const DEFAULT_CHANGED_FILE_REFERENCE_LIMIT = 5;
const DEFAULT_PROJECT_RUN_REPORT_FOLDER = 'project_memory/operations';

type BudgetMode = (typeof BUDGET_MODES)[number];
type SpeedMode = (typeof SPEED_MODES)[number];
type DependencyMonitoringProvider = (typeof DEPENDENCY_MONITORING_PROVIDERS)[number];
type DependencyMonitoringSchedule = (typeof DEPENDENCY_MONITORING_SCHEDULES)[number];
export const SETTINGS_PAGE_IDS = ['overview', 'chat', 'models', 'safety', 'project', 'experimental'] as const;
export type SettingsPageId = (typeof SETTINGS_PAGE_IDS)[number];
export interface SettingsPanelTarget {
  page?: SettingsPageId;
  query?: string;
}

type SettingsMessage =
  | { type: 'setBudgetMode'; payload: BudgetMode }
  | { type: 'setSpeedMode'; payload: SpeedMode }
  | { type: 'setLocalOpenAiBaseUrl'; payload: string }
  | { type: 'setDailyCostLimitUsd'; payload: number }
  | { type: 'setShowImportProjectAction'; payload: boolean }
  | { type: 'setToolApprovalMode'; payload: 'always-ask' | 'ask-on-write' | 'ask-on-external' | 'allow-safe-readonly' }
  | { type: 'setAllowTerminalWrite'; payload: boolean }
  | { type: 'setAutoVerifyAfterWrite'; payload: boolean }
  | { type: 'setAutoVerifyScripts'; payload: string }
  | { type: 'setAutoVerifyTimeoutMs'; payload: number }
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

    SettingsPanel.currentPanel = new SettingsPanel(panel, normalizedTarget);
  }

  private constructor(panel: vscode.WebviewPanel, initialTarget?: SettingsPanelTarget) {
    this.panel = panel;
    this.initialTarget = initialTarget;
    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      message => {
        void this.handleMessage(message);
      },
      null,
      this.disposables,
    );
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

      case 'setLocalOpenAiBaseUrl': {
        const normalized = normalizeLocalOpenAiBaseUrl(message.payload);
        if (!normalized) {
          return;
        }
        await configuration.update('localOpenAiBaseUrl', normalized, vscode.ConfigurationTarget.Workspace);
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
    const localOpenAiBaseUrl = escapeHtml(getNonEmptyString(
      configuration.get<string>('localOpenAiBaseUrl'),
      'http://127.0.0.1:11434/v1',
    ));
    const dailyCostLimitUsd = getNonNegativeNumber(configuration.get<number>('dailyCostLimitUsd'), 0);
    const showImportProjectAction = configuration.get<boolean>('showImportProjectAction', true);
    const selectedToolApprovalMode = getToolApprovalMode(configuration.get<string>('toolApprovalMode'));
    const allowTerminalWrite = configuration.get<boolean>('allowTerminalWrite', false);
    const autoVerifyAfterWrite = configuration.get<boolean>('autoVerifyAfterWrite', true);
    const autoVerifyScripts = escapeHtml((configuration.get<string[]>('autoVerifyScripts', ['test']) ?? ['test']).join(', '));
    const autoVerifyTimeoutMs = getPositiveInteger(configuration.get<number>('autoVerifyTimeoutMs'), 120000);
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
        <div class="hero-badges" aria-label="Settings principles">
          <span class="hero-badge">Validated writes</span>
          <span class="hero-badge">Workspace scoped</span>
          <span class="hero-badge">Security-first defaults</span>
        </div>
      </div>

      <div class="search-shell">
        <label class="search-label" for="settingsSearch">Search settings</label>
        <input id="settingsSearch" type="search" placeholder="Search pages, controls, or workflows" value="${initialQuery}" />
        <p id="searchStatus" class="search-status" aria-live="polite"></p>
      </div>

      <div class="settings-layout">
        <nav class="settings-nav" aria-label="AtlasMind settings sections" role="tablist" aria-orientation="vertical">
          <button type="button" class="nav-link active" id="tab-overview" data-page-target="overview" data-search="overview quick actions budget speed cost limits embedded chat detached chat project run center vscode chat" role="tab" aria-selected="true" aria-controls="page-overview">Overview</button>
          <button type="button" class="nav-link" id="tab-chat" data-page-target="chat" data-search="chat sidebar sessions import project carry-forward turns context max chars" role="tab" aria-selected="false" aria-controls="page-chat" tabindex="-1">Chat &amp; Sidebar</button>
          <button type="button" class="nav-link" id="tab-models" data-page-target="models" data-search="models integrations providers local endpoint ollama lm studio azure bedrock voice vision exa specialist" role="tab" aria-selected="false" aria-controls="page-models" tabindex="-1">Models &amp; Integrations</button>
          <button type="button" class="nav-link" id="tab-safety" data-page-target="safety" data-search="safety verification approvals tool approval terminal write scripts timeout" role="tab" aria-selected="false" aria-controls="page-safety" tabindex="-1">Safety &amp; Verification</button>
          <button type="button" class="nav-link" id="tab-project" data-page-target="project" data-search="project runs approval threshold estimated files changed file references report folder dependency monitoring dependabot renovate governance updates" role="tab" aria-selected="false" aria-controls="page-project" tabindex="-1">Project Runs</button>
          <button type="button" class="nav-link" id="tab-experimental" data-page-target="experimental" data-search="experimental skill learning generated drafts" role="tab" aria-selected="false" aria-controls="page-experimental" tabindex="-1">Experimental</button>
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
                  <h3>Budget mode</h3>
                </div>
                <p class="card-copy">Select how aggressively AtlasMind should spend on models across orchestrated tasks.</p>
                <div class="choice-cluster" role="radiogroup" aria-label="Budget mode">
                  <label class="choice-pill"><input type="radio" name="budget" value="cheap" ${selectedBudget === 'cheap' ? 'checked' : ''}><span>Cheap</span></label>
                  <label class="choice-pill"><input type="radio" name="budget" value="balanced" ${selectedBudget === 'balanced' ? 'checked' : ''}><span>Balanced</span></label>
                  <label class="choice-pill"><input type="radio" name="budget" value="expensive" ${selectedBudget === 'expensive' ? 'checked' : ''}><span>Expensive</span></label>
                  <label class="choice-pill"><input type="radio" name="budget" value="auto" ${selectedBudget === 'auto' ? 'checked' : ''}><span>Auto</span></label>
                </div>
                <div class="field-stack compact-stack">
                  <label for="dailyCostLimitUsd">Daily Cost Limit (USD)</label>
                  <input id="dailyCostLimitUsd" type="number" min="0" step="0.01" value="${dailyCostLimitUsd}" />
                  <p class="info-note">Use <code>0</code> for unlimited. AtlasMind warns at 80% and blocks new requests once the limit is reached.</p>
                </div>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Routing</p>
                  <h3>Speed mode</h3>
                </div>
                <p class="card-copy">Decide how much time AtlasMind should spend choosing and running more capable reasoning paths.</p>
                <div class="choice-cluster" role="radiogroup" aria-label="Speed mode">
                  <label class="choice-pill"><input type="radio" name="speed" value="fast" ${selectedSpeed === 'fast' ? 'checked' : ''}><span>Fast</span></label>
                  <label class="choice-pill"><input type="radio" name="speed" value="balanced" ${selectedSpeed === 'balanced' ? 'checked' : ''}><span>Balanced</span></label>
                  <label class="choice-pill"><input type="radio" name="speed" value="considered" ${selectedSpeed === 'considered' ? 'checked' : ''}><span>Considered</span></label>
                  <label class="choice-pill"><input type="radio" name="speed" value="auto" ${selectedSpeed === 'auto' ? 'checked' : ''}><span>Auto</span></label>
                </div>
                <div class="info-band">
                  <strong>Tip:</strong> Pair <code>balanced</code> speed with <code>balanced</code> budget when you want stable defaults without over-tuning the router.
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
                  <label for="showImportProjectAction">Sessions toolbar action</label>
                  <label class="checkbox-card">
                    <input id="showImportProjectAction" type="checkbox" ${showImportProjectAction ? 'checked' : ''}>
                    <span>
                      <strong>Show Import Existing Project</strong>
                      <span class="muted-line">Keep the import action visible in the Sessions view title bar.</span>
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
                  <label for="chatSessionTurnLimit">Session Carry-forward Turns</label>
                  <input id="chatSessionTurnLimit" type="number" min="1" step="1" value="${chatSessionTurnLimit}" />

                  <label for="chatSessionContextChars">Session Context Max Chars</label>
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
                  <h3>OpenAI-compatible endpoint</h3>
                </div>
                <p class="card-copy">Point AtlasMind at Ollama, LM Studio, Open WebUI, or another local HTTP endpoint that exposes an OpenAI-compatible API.</p>
                <div class="field-stack">
                  <label for="localOpenAiBaseUrl">Local Endpoint Base URL</label>
                  <input id="localOpenAiBaseUrl" type="url" value="${localOpenAiBaseUrl}" placeholder="http://127.0.0.1:11434/v1" />
                </div>
                <p class="info-note">Credentials, when needed, remain in SecretStorage through the provider surfaces rather than plain settings.</p>
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
                  <h3>Tool execution policy</h3>
                </div>
                <div class="field-grid">
                  <label for="toolApprovalMode">Tool Approval Mode</label>
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
                    <strong>Permit terminal write commands</strong>
                    <span class="muted-line">Allow install, commit, or other write-capable subprocesses after the relevant approval step.</span>
                  </span>
                </label>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Verification</p>
                  <h3>Post-write checks</h3>
                </div>
                <label class="checkbox-card">
                  <input id="autoVerifyAfterWrite" type="checkbox" ${autoVerifyAfterWrite ? 'checked' : ''}>
                  <span>
                    <strong>Auto verify after writes</strong>
                    <span class="muted-line">Run configured verification scripts after file-edit, file-write, and git-apply-patch succeed.</span>
                  </span>
                </label>
                <div class="field-grid top-gap">
                  <label for="autoVerifyScripts">Verification Scripts</label>
                  <input id="autoVerifyScripts" type="text" value="${autoVerifyScripts}" placeholder="test, lint" />

                  <label for="autoVerifyTimeoutMs">Verification Timeout (ms)</label>
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
                  <h3>Thresholds</h3>
                </div>
                <div class="field-grid">
                  <label for="projectApprovalFileThreshold">Approval Threshold (files)</label>
                  <input id="projectApprovalFileThreshold" type="number" min="1" step="1" value="${projectApprovalFileThreshold}" />

                  <label for="projectEstimatedFilesPerSubtask">Estimated Files Per Subtask</label>
                  <input id="projectEstimatedFilesPerSubtask" type="number" min="1" step="1" value="${projectEstimatedFilesPerSubtask}" />

                  <label for="projectChangedFileReferenceLimit">Changed File Reference Limit</label>
                  <input id="projectChangedFileReferenceLimit" type="number" min="1" step="1" value="${projectChangedFileReferenceLimit}" />

                  <label for="projectRunReportFolder">Run Report Folder</label>
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
                  <h3>Dependency monitoring defaults</h3>
                </div>
                <label class="checkbox-card">
                  <input id="projectDependencyMonitoringEnabled" type="checkbox" ${projectDependencyMonitoringEnabled ? 'checked' : ''}>
                  <span>
                    <strong>Scaffold dependency monitoring for Atlas-built projects</strong>
                    <span class="muted-line">Bootstrap uses these settings when it generates governance files for a new or newly-governed project.</span>
                  </span>
                </label>
                <div class="field-stack top-gap">
                  <span class="field-label">Supported automation providers</span>
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
                  <label for="projectDependencyMonitoringSchedule">Monitoring cadence</label>
                  <select id="projectDependencyMonitoringSchedule">
                    <option value="daily" ${projectDependencyMonitoringSchedule === 'daily' ? 'selected' : ''}>Daily</option>
                    <option value="weekly" ${projectDependencyMonitoringSchedule === 'weekly' ? 'selected' : ''}>Weekly</option>
                    <option value="monthly" ${projectDependencyMonitoringSchedule === 'monthly' ? 'selected' : ''}>Monthly</option>
                  </select>
                </div>
                <label class="checkbox-card top-gap">
                  <input id="projectDependencyMonitoringIssueTemplate" type="checkbox" ${projectDependencyMonitoringIssueTemplate ? 'checked' : ''}>
                  <span>
                    <strong>Scaffold dependency review issue template</strong>
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
                  <h3>Atlas-generated skill drafts</h3>
                </div>
                <label class="checkbox-card">
                  <input id="experimentalSkillLearningEnabled" type="checkbox" ${experimentalSkillLearningEnabled ? 'checked' : ''}>
                  <span>
                    <strong>Enable Atlas-generated skill drafts</strong>
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
        .hero-badges {
          display: flex;
          flex-wrap: wrap;
          align-content: flex-start;
          justify-content: flex-end;
          gap: 10px;
          min-width: 220px;
        }
        .hero-badge {
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
          display: grid;
          gap: 8px;
          padding: 16px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 18px;
          background: linear-gradient(180deg, var(--atlas-panel-surface-strong), var(--atlas-panel-surface));
        }
        .nav-link {
          width: 100%;
          text-align: left;
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
          display: none;
        }
        .settings-page.active {
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
        .field-grid {
        .settings-card-danger {
          border-color: var(--vscode-inputValidation-errorBorder, #d13438);
          background: color-mix(in srgb, var(--vscode-inputValidation-errorBorder, #d13438) 8%, var(--atlas-panel-surface));
        }
          display: grid;
          grid-template-columns: minmax(220px, 280px) minmax(260px, 1fr);
          gap: 10px 14px;
          align-items: center;
        .danger-button {
          border-color: var(--vscode-inputValidation-errorBorder, #d13438);
          background: color-mix(in srgb, var(--vscode-inputValidation-errorBorder, #d13438) 20%, var(--vscode-button-background));
        }
        .danger-button:hover,
        .danger-button:focus-visible {
          background: color-mix(in srgb, var(--vscode-inputValidation-errorBorder, #d13438) 30%, var(--vscode-button-background));
        }
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
        .choice-cluster {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 10px;
        }
        .choice-pill {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 999px;
          background: var(--atlas-panel-surface-strong);
          cursor: pointer;
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

        const navButtons = Array.from(document.querySelectorAll('[data-page-target]'));
        const pages = Array.from(document.querySelectorAll('.settings-page'));
        const searchInput = document.getElementById('settingsSearch');
        const searchStatus = document.getElementById('searchStatus');

        function activatePage(pageId, options = {}) {
          const focusPanel = options.focusPanel === true;
          navButtons.forEach(button => {
            if (!(button instanceof HTMLButtonElement)) {
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
            if (!(button instanceof HTMLButtonElement)) {
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

          const currentActive = navButtons.find(button => button instanceof HTMLButtonElement && button.classList.contains('active') && !button.classList.contains('hidden-by-search'));
          if (!currentActive && visibleCount > 0) {
            const firstVisible = navButtons.find(button => button instanceof HTMLButtonElement && !button.classList.contains('hidden-by-search'));
            if (firstVisible instanceof HTMLButtonElement) {
              activatePage(firstVisible.dataset.pageTarget ?? 'overview', options);
            }
          }

          const state = vscode.getState() ?? {};
          vscode.setState({ ...state, searchQuery: normalized });
        }

        navButtons.forEach((button, index) => {
          if (!(button instanceof HTMLButtonElement)) {
            return;
          }

          button.addEventListener('click', () => {
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
            if (nextButton instanceof HTMLButtonElement) {
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

        const localOpenAiBaseUrl = document.getElementById('localOpenAiBaseUrl');
        if (localOpenAiBaseUrl instanceof HTMLInputElement) {
          const emitLocalOpenAiBaseUrl = () => {
            const value = localOpenAiBaseUrl.value.trim();
            if (value.length === 0) {
              return;
            }
            vscode.postMessage({ type: 'setLocalOpenAiBaseUrl', payload: value });
          };
          localOpenAiBaseUrl.addEventListener('change', emitLocalOpenAiBaseUrl);
          localOpenAiBaseUrl.addEventListener('blur', emitLocalOpenAiBaseUrl);
        }

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

        bindNonNegativeNumberInput('dailyCostLimitUsd', 'setDailyCostLimitUsd');
        bindPositiveIntegerInput('autoVerifyTimeoutMs', 'setAutoVerifyTimeoutMs');
        bindPositiveIntegerInput('projectApprovalFileThreshold', 'setProjectApprovalFileThreshold');
        bindPositiveIntegerInput('chatSessionTurnLimit', 'setChatSessionTurnLimit');
        bindPositiveIntegerInput('chatSessionContextChars', 'setChatSessionContextChars');
        bindPositiveIntegerInput('projectEstimatedFilesPerSubtask', 'setProjectEstimatedFilesPerSubtask');
        bindPositiveIntegerInput('projectChangedFileReferenceLimit', 'setProjectChangedFileReferenceLimit');

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

        const experimentalSkillLearningEnabled = document.getElementById('experimentalSkillLearningEnabled');
        if (experimentalSkillLearningEnabled instanceof HTMLInputElement) {
          experimentalSkillLearningEnabled.addEventListener('change', () => {
            vscode.postMessage({
              type: 'setExperimentalSkillLearningEnabled',
              payload: experimentalSkillLearningEnabled.checked,
            });
          });
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

  if (message.type === 'setLocalOpenAiBaseUrl') {
    return typeof message.payload === 'string' && message.payload.trim().length > 0;
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
