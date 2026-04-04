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
  | { type: 'setProjectApprovalFileThreshold'; payload: number }
  | { type: 'setProjectEstimatedFilesPerSubtask'; payload: number }
  | { type: 'setProjectChangedFileReferenceLimit'; payload: number }
  | { type: 'setProjectRunReportFolder'; payload: string }
  | { type: 'setExperimentalSkillLearningEnabled'; payload: boolean };

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

      case 'setSpeedMode':
        await configuration.update('speedMode', message.payload, vscode.ConfigurationTarget.Workspace);
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

      case 'setProjectRunReportFolder':
        await configuration.update('projectRunReportFolder', message.payload, vscode.ConfigurationTarget.Workspace);
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
    }
  }

  private getHtml(): string {
    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const selectedBudget = getBudgetMode(configuration.get<string>('budgetMode'));
    const selectedSpeed = getSpeedMode(configuration.get<string>('speedMode'));
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

      <section>
        <h2>Budget Mode</h2>
        <div class="slider-group">
          <label><input type="radio" name="budget" value="cheap" ${selectedBudget === 'cheap' ? 'checked' : ''}> Cheap</label>
          <label><input type="radio" name="budget" value="balanced" ${selectedBudget === 'balanced' ? 'checked' : ''}> Balanced</label>
          <label><input type="radio" name="budget" value="expensive" ${selectedBudget === 'expensive' ? 'checked' : ''}> Expensive</label>
          <label><input type="radio" name="budget" value="auto" ${selectedBudget === 'auto' ? 'checked' : ''}> Auto</label>
        </div>
      </section>

      <section>
        <h2>Speed Mode</h2>
        <div class="slider-group">
          <label><input type="radio" name="speed" value="fast" ${selectedSpeed === 'fast' ? 'checked' : ''}> Fast</label>
          <label><input type="radio" name="speed" value="balanced" ${selectedSpeed === 'balanced' ? 'checked' : ''}> Balanced</label>
          <label><input type="radio" name="speed" value="considered" ${selectedSpeed === 'considered' ? 'checked' : ''}> Considered</label>
          <label><input type="radio" name="speed" value="auto" ${selectedSpeed === 'auto' ? 'checked' : ''}> Auto</label>
        </div>
      </section>

      <section>
        <h2>Project Execution UI</h2>
        <p>Configure <code>/project</code> safety and report behaviour.</p>
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
      </section>

      <section>
        <h2>Experimental Skill Learning</h2>
        <p>Allow AtlasMind to draft custom skill files with an LLM. Drafts are scanned and any imported result stays disabled until you review it.</p>
        <label class="checkbox-row">
          <input id="experimentalSkillLearningEnabled" type="checkbox" ${experimentalSkillLearningEnabled ? 'checked' : ''}>
          Enable Atlas-generated skill drafts
        </label>
        <p class="warning-note">Warning: this feature increases token usage and generated code may still be wrong or unsafe. Review every draft before enabling it.</p>
      </section>

      `,
      extraCss:
      `
        .field-grid {
          display: grid;
          grid-template-columns: minmax(220px, 280px) minmax(260px, 1fr);
          gap: 10px 14px;
          margin-top: 8px;
          align-items: center;
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

        bindPositiveIntegerInput('projectApprovalFileThreshold', 'setProjectApprovalFileThreshold');
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

  if (
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

  return false;
}

function getBudgetMode(value: string | undefined): BudgetMode {
  return BUDGET_MODES.includes(value as BudgetMode) ? value as BudgetMode : 'balanced';
}

function getSpeedMode(value: string | undefined): SpeedMode {
  return SPEED_MODES.includes(value as SpeedMode) ? value as SpeedMode : 'balanced';
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
