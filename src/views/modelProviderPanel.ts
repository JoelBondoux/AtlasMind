import * as vscode from 'vscode';
import { getWebviewHtmlShell } from './webviewUtils.js';

/**
 * Model Provider management webview – add/edit API keys, enable/disable providers.
 */
export class ModelProviderPanel {
  public static currentPanel: ModelProviderPanel | undefined;
  private static readonly viewType = 'atlasmind.modelProviders';
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (ModelProviderPanel.currentPanel) {
      ModelProviderPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ModelProviderPanel.viewType,
      'Model Providers',
      column,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    ModelProviderPanel.currentPanel = new ModelProviderPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml(extensionUri);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (msg: { type: string; payload?: unknown }) => {
        switch (msg.type) {
          case 'saveApiKey':
            // TODO: Store in SecretStorage
            vscode.window.showInformationMessage('API key saved (placeholder).');
            break;
          case 'refreshModels':
            vscode.window.showInformationMessage('Model refresh coming soon.');
            break;
        }
      },
      null,
      this.disposables,
    );
  }

  private dispose(): void {
    ModelProviderPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private getHtml(_extensionUri: vscode.Uri): string {
    return getWebviewHtmlShell(
      'Model Providers',
      `
      <h1>Model Providers</h1>
      <p>Configure API keys and enable/disable model providers.</p>

      <table>
        <thead>
          <tr><th>Provider</th><th>Status</th><th>Action</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Anthropic (Claude)</td>
            <td><span class="badge">not configured</span></td>
            <td><button onclick="saveKey('anthropic')">Set API Key</button></td>
          </tr>
          <tr>
            <td>OpenAI</td>
            <td><span class="badge">not configured</span></td>
            <td><button onclick="saveKey('openai')">Set API Key</button></td>
          </tr>
          <tr>
            <td>Google (Gemini)</td>
            <td><span class="badge">not configured</span></td>
            <td><button onclick="saveKey('google')">Set API Key</button></td>
          </tr>
          <tr>
            <td>Mistral</td>
            <td><span class="badge">not configured</span></td>
            <td><button onclick="saveKey('mistral')">Set API Key</button></td>
          </tr>
          <tr>
            <td>DeepSeek</td>
            <td><span class="badge">not configured</span></td>
            <td><button onclick="saveKey('deepseek')">Set API Key</button></td>
          </tr>
          <tr>
            <td>Local LLM</td>
            <td><span class="badge">not configured</span></td>
            <td><button onclick="saveKey('local')">Configure</button></td>
          </tr>
        </tbody>
      </table>

      <script>
        const vscode = acquireVsCodeApi();
        function saveKey(provider) {
          vscode.postMessage({ type: 'saveApiKey', payload: provider });
        }
      </script>
      `,
    );
  }
}
