import * as vscode from 'vscode';
import { escapeHtml, getWebviewHtmlShell } from './webviewUtils.js';

const BUDGET_MODES = ['cheap', 'balanced', 'expensive', 'auto'] as const;
const SPEED_MODES = ['fast', 'balanced', 'considered', 'auto'] as const;
const DEFAULT_PROJECT_APPROVAL_FILE_THRESHOLD = 12;
const DEFAULT_ESTIMATED_FILES_PER_SUBTASK = 2;
const DEFAULT_CHANGED_FILE_REFERENCE_LIMIT = 5;
const DEFAULT_PROJECT_RUN_REPORT_FOLDER = 'project_memory/operations';

type BudgetMode = (typeof BUDGET_MODES)[number];
type SpeedMode = (typeof SPEED_MODES)[number];

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
  | { type: 'setExperimentalSkillLearningEnabled'; payload: boolean }
  | { type: 'openChatPanel' }
  | { type: 'openModelProviders' }
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
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(context: vscode.ExtensionContext): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (SettingsPanel.currentPanel) {
      SettingsPanel.currentPanel.panel.reveal(column);
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

    SettingsPanel.currentPanel = new SettingsPanel(panel);
  }

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
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

      case 'openModelProviders':
        await vscode.commands.executeCommand('atlasmind.openModelProviders');
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
    const experimentalSkillLearningEnabled = configuration.get<boolean>('experimentalSkillLearningEnabled', false);

    return getWebviewHtmlShell({
      title: 'AtlasMind Settings',
      cspSource: this.panel.webview.cspSource,
      bodyContent:
      `
      <h1>AtlasMind Settings</h1>
      <p>Security-first defaults are enforced: settings are validated before being written to the workspace configuration.</p>

      <details open>
        <summary><h2>Quick Actions</h2></summary>
        <p>Jump directly to AtlasMind's main surfaces so chat, project review, voice, and vision are all reachable from one place.</p>
        <div class="button-row">
          <button id="openChatPanel" class="primary-btn">Open AtlasMind Chat Panel</button>
          <button id="openChat" class="primary-btn">Open Chat</button>
          <button id="openModelProviders">Model Providers</button>
          <button id="openProjectRunCenter">Project Run Center</button>
          <button id="openVoicePanel">Voice Panel</button>
          <button id="openVisionPanel">Vision Panel</button>
        </div>
      </details>

      <details open>
        <summary><h2>Budget Mode</h2></summary>
        <div class="slider-group">
          <label><input type="radio" name="budget" value="cheap" ${selectedBudget === 'cheap' ? 'checked' : ''}> Cheap</label>
          <label><input type="radio" name="budget" value="balanced" ${selectedBudget === 'balanced' ? 'checked' : ''}> Balanced</label>
          <label><input type="radio" name="budget" value="expensive" ${selectedBudget === 'expensive' ? 'checked' : ''}> Expensive</label>
          <label><input type="radio" name="budget" value="auto" ${selectedBudget === 'auto' ? 'checked' : ''}> Auto</label>
        </div>
        <div class="field-grid budget-grid">
          <label for="dailyCostLimitUsd">Daily Cost Limit (USD)</label>
          <input id="dailyCostLimitUsd" type="number" min="0" step="0.01" value="${dailyCostLimitUsd}" />
        </div>
        <p class="info-note">Set this to <code>0</code> for unlimited. AtlasMind warns at 80% and blocks new requests once the limit is reached.</p>
      </details>

      <details open>
        <summary><h2>Speed Mode</h2></summary>
        <div class="slider-group">
          <label><input type="radio" name="speed" value="fast" ${selectedSpeed === 'fast' ? 'checked' : ''}> Fast</label>
          <label><input type="radio" name="speed" value="balanced" ${selectedSpeed === 'balanced' ? 'checked' : ''}> Balanced</label>
          <label><input type="radio" name="speed" value="considered" ${selectedSpeed === 'considered' ? 'checked' : ''}> Considered</label>
          <label><input type="radio" name="speed" value="auto" ${selectedSpeed === 'auto' ? 'checked' : ''}> Auto</label>
        </div>
      </details>

      <details>
        <summary><h2>Local Model Endpoint</h2></summary>
        <p>Configure a local OpenAI-compatible endpoint such as Ollama, LM Studio, or Open WebUI.</p>
        <div class="field-grid">
          <label for="localOpenAiBaseUrl">Local Endpoint Base URL</label>
          <input id="localOpenAiBaseUrl" type="url" value="${localOpenAiBaseUrl}" placeholder="http://127.0.0.1:11434/v1" />
        </div>
        <p class="info-note">Authentication, if needed, is still stored in SecretStorage from the Model Providers panel.</p>
      </details>

      <details>
        <summary><h2>Sidebar &amp; Panel</h2></summary>
        <p>Control the AtlasMind sidebar affordances that are exposed directly in the Sessions view toolbar and panel menus.</p>
        <div class="field-grid">
          <label for="showImportProjectAction">Show Import Project Button</label>
          <label class="checkbox-row inline-checkbox">
            <input id="showImportProjectAction" type="checkbox" ${showImportProjectAction ? 'checked' : ''}>
            Show <code>Import Existing Project</code> in the AtlasMind Sessions view title bar
          </label>
        </div>
        <p class="info-note">AtlasMind Settings is also available from each AtlasMind view's three-dots menu.</p>
      </details>

      <details open>
        <summary><h2>Safety &amp; Approval</h2></summary>
        <p>Configure how AtlasMind requests approval before running tools.</p>
        <div class="field-grid">
          <label for="toolApprovalMode">Tool Approval Mode</label>
          <select id="toolApprovalMode">
            <option value="always-ask" ${selectedToolApprovalMode === 'always-ask' ? 'selected' : ''}>Always ask</option>
            <option value="ask-on-write" ${selectedToolApprovalMode === 'ask-on-write' ? 'selected' : ''}>Ask on write</option>
            <option value="ask-on-external" ${selectedToolApprovalMode === 'ask-on-external' ? 'selected' : ''}>Ask on external</option>
            <option value="allow-safe-readonly" ${selectedToolApprovalMode === 'allow-safe-readonly' ? 'selected' : ''}>Allow safe readonly</option>
          </select>

          <label for="allowTerminalWrite">Allow Terminal Write Commands</label>
          <label class="checkbox-row inline-checkbox">
            <input id="allowTerminalWrite" type="checkbox" ${allowTerminalWrite ? 'checked' : ''}>
            Permit install / commit / other write-capable subprocesses after approval
          </label>
        </div>
      </details>

      <details open>
        <summary><h2>Verification</h2></summary>
        <p>Run scripts automatically after file writes to catch regressions early.</p>
        <div class="field-grid">
          <label for="autoVerifyAfterWrite">Auto Verify After Writes</label>
          <label class="checkbox-row inline-checkbox">
            <input id="autoVerifyAfterWrite" type="checkbox" ${autoVerifyAfterWrite ? 'checked' : ''}>
            Run configured verification scripts after file-edit, file-write, and git-apply-patch succeed
          </label>

          <label for="autoVerifyScripts">Verification Scripts</label>
          <input id="autoVerifyScripts" type="text" value="${autoVerifyScripts}" placeholder="test, lint" />

          <label for="autoVerifyTimeoutMs">Verification Timeout (ms)</label>
          <input id="autoVerifyTimeoutMs" type="number" min="5000" step="1000" value="${autoVerifyTimeoutMs}" />
        </div>
      </details>

      <details>
        <summary><h2>Advanced — Project Execution</h2></summary>
        <p>Fine-tune <code>/project</code> safety, reporting, and session behaviour. Defaults are safe for most users.</p>
        <div class="field-grid">
          <label for="chatSessionTurnLimit">Session Carry-forward Turns</label>
          <input id="chatSessionTurnLimit" type="number" min="1" step="1" value="${chatSessionTurnLimit}" />

          <label for="chatSessionContextChars">Session Context Max Chars</label>
          <input id="chatSessionContextChars" type="number" min="400" step="100" value="${chatSessionContextChars}" />

          <label for="projectApprovalFileThreshold">Approval Threshold (files)</label>
          <input id="projectApprovalFileThreshold" type="number" min="1" step="1" value="${projectApprovalFileThreshold}" />

          <label for="projectEstimatedFilesPerSubtask">Estimated Files Per Subtask</label>
          <input id="projectEstimatedFilesPerSubtask" type="number" min="1" step="1" value="${projectEstimatedFilesPerSubtask}" />

          <label for="projectChangedFileReferenceLimit">Changed File Reference Limit</label>
          <input id="projectChangedFileReferenceLimit" type="number" min="1" step="1" value="${projectChangedFileReferenceLimit}" />

          <label for="projectRunReportFolder">Run Report Folder</label>
          <input id="projectRunReportFolder" type="text" value="${projectRunReportFolder}" />
        </div>
      </details>

      <details>
        <summary><h2>Experimental — Skill Learning</h2></summary>
        <p>Allow AtlasMind to draft custom skill files with an LLM. Drafts are scanned and any imported result stays disabled until you review it.</p>
        <label class="checkbox-row">
          <input id="experimentalSkillLearningEnabled" type="checkbox" ${experimentalSkillLearningEnabled ? 'checked' : ''}>
          Enable Atlas-generated skill drafts
        </label>
        <p class="warning-note">Warning: this feature increases token usage and generated code may still be wrong or unsafe. Review every draft before enabling it.</p>
      </details>

      `,
      extraCss:
      `
        details {
          margin-bottom: 16px;
          border: 1px solid var(--vscode-widget-border, #444);
          border-radius: 4px;
          padding: 0 14px;
        }
        details[open] {
          padding-bottom: 14px;
        }
        details summary {
          cursor: pointer;
          padding: 10px 0;
          list-style: revert;
        }
        details summary h2 {
          display: inline;
          margin: 0;
          font-size: 1.15em;
        }
        .button-row {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 8px;
        }
        .field-grid {
          display: grid;
          grid-template-columns: minmax(220px, 280px) minmax(260px, 1fr);
          gap: 10px 14px;
          margin-top: 8px;
          align-items: center;
        }
        .budget-grid {
          margin-top: 14px;
        }
        .field-grid input {
          width: 100%;
          max-width: 480px;
          box-sizing: border-box;
          color: var(--vscode-input-foreground);
          background: var(--vscode-input-background);
          border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #444));
          padding: 6px 8px;
        }
        .field-grid select {
          width: 100%;
          max-width: 480px;
          box-sizing: border-box;
          color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground));
          background: var(--vscode-dropdown-background, var(--vscode-input-background));
          border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, var(--vscode-widget-border, #444)));
          padding: 6px 8px;
        }
        .field-grid label {
          font-weight: 500;
        }
        .checkbox-row {
          display: flex;
          align-items: center;
          gap: 10px;
          font-weight: 500;
          margin-top: 8px;
        }
        .inline-checkbox {
          margin-top: 0;
          align-items: flex-start;
        }
        .warning-note {
          margin-top: 8px;
          padding: 10px 12px;
          border-left: 3px solid var(--vscode-inputValidation-warningBorder, #cca700);
          background: var(--vscode-textBlockQuote-background, rgba(204, 167, 0, 0.08));
        }
      `,
      scriptContent:
      `
        const vscode = acquireVsCodeApi();

        function bindCommandButton(id, messageType) {
          const element = document.getElementById(id);
          if (!(element instanceof HTMLButtonElement)) {
            return;
          }
          element.addEventListener('click', () => {
            vscode.postMessage({ type: messageType });
          });
        }

        bindCommandButton('openChatPanel', 'openChatPanel');
        bindCommandButton('openChat', 'openChat');
        bindCommandButton('openModelProviders', 'openModelProviders');
        bindCommandButton('openProjectRunCenter', 'openProjectRunCenter');
        bindCommandButton('openVoicePanel', 'openVoicePanel');
        bindCommandButton('openVisionPanel', 'openVisionPanel');

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

  if (message.type === 'setExperimentalSkillLearningEnabled') {
    return typeof message.payload === 'boolean';
  }

  if (
    message.type === 'openChatPanel' ||
    message.type === 'openModelProviders' ||
    message.type === 'openProjectRunCenter' ||
    message.type === 'openVoicePanel' ||
    message.type === 'openVisionPanel' ||
    message.type === 'openChat'
  ) {
    return true;
  }

  return false;
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
