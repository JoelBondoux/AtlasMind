import * as vscode from 'vscode';
import { getWebviewHtmlShell } from './webviewUtils.js';

/**
 * Settings webview panel – budget/speed sliders, global behaviour.
 */
export class SettingsPanel {
  public static currentPanel: SettingsPanel | undefined;
  private static readonly viewType = 'atlasmind.settings';
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (SettingsPanel.currentPanel) {
      SettingsPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      SettingsPanel.viewType,
      'AtlasMind Settings',
      column,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    SettingsPanel.currentPanel = new SettingsPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml(extensionUri);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (msg: { type: string; payload?: unknown }) => {
        switch (msg.type) {
          case 'setBudgetMode':
            vscode.workspace
              .getConfiguration('atlasmind')
              .update('budgetMode', msg.payload, vscode.ConfigurationTarget.Workspace);
            break;
          case 'setSpeedMode':
            vscode.workspace
              .getConfiguration('atlasmind')
              .update('speedMode', msg.payload, vscode.ConfigurationTarget.Workspace);
            break;
        }
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

  private getHtml(_extensionUri: vscode.Uri): string {
    return getWebviewHtmlShell(
      'AtlasMind Settings',
      `
      <h1>AtlasMind Settings</h1>

      <section>
        <h2>Budget Mode</h2>
        <div class="slider-group">
          <label><input type="radio" name="budget" value="cheap"> Cheap</label>
          <label><input type="radio" name="budget" value="balanced" checked> Balanced</label>
          <label><input type="radio" name="budget" value="expensive"> Expensive</label>
          <label><input type="radio" name="budget" value="auto"> Auto</label>
        </div>
      </section>

      <section>
        <h2>Speed Mode</h2>
        <div class="slider-group">
          <label><input type="radio" name="speed" value="fast"> Fast</label>
          <label><input type="radio" name="speed" value="balanced" checked> Balanced</label>
          <label><input type="radio" name="speed" value="considered"> Considered</label>
          <label><input type="radio" name="speed" value="auto"> Auto</label>
        </div>
      </section>

      <script>
        const vscode = acquireVsCodeApi();
        document.querySelectorAll('input[name="budget"]').forEach(el => {
          el.addEventListener('change', e => {
            vscode.postMessage({ type: 'setBudgetMode', payload: e.target.value });
          });
        });
        document.querySelectorAll('input[name="speed"]').forEach(el => {
          el.addEventListener('change', e => {
            vscode.postMessage({ type: 'setSpeedMode', payload: e.target.value });
          });
        });
      </script>
      `,
    );
  }
}
