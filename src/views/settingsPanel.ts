import * as vscode from 'vscode';
import { getWebviewHtmlShell } from './webviewUtils.js';

const BUDGET_MODES = ['cheap', 'balanced', 'expensive', 'auto'] as const;
const SPEED_MODES = ['fast', 'balanced', 'considered', 'auto'] as const;

type BudgetMode = (typeof BUDGET_MODES)[number];
type SpeedMode = (typeof SPEED_MODES)[number];

type SettingsMessage =
  | { type: 'setBudgetMode'; payload: BudgetMode }
  | { type: 'setSpeedMode'; payload: SpeedMode };

/**
 * Settings webview panel – budget/speed sliders, global behaviour.
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
    if (message.type === 'setBudgetMode') {
      await configuration.update('budgetMode', message.payload, vscode.ConfigurationTarget.Workspace);
      return;
    }

    await configuration.update('speedMode', message.payload, vscode.ConfigurationTarget.Workspace);
  }

  private getHtml(): string {
    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const selectedBudget = getBudgetMode(configuration.get<string>('budgetMode'));
    const selectedSpeed = getSpeedMode(configuration.get<string>('speedMode'));

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
      `,
    });
  }
}

function isSettingsMessage(value: unknown): value is SettingsMessage {
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

  return false;
}

function getBudgetMode(value: string | undefined): BudgetMode {
  return BUDGET_MODES.includes(value as BudgetMode) ? value as BudgetMode : 'balanced';
}

function getSpeedMode(value: string | undefined): SpeedMode {
  return SPEED_MODES.includes(value as SpeedMode) ? value as SpeedMode : 'balanced';
}
