import * as vscode from 'vscode';
import type { AtlasMindContext } from '../extension.js';
import { getWebviewHtmlShell } from './webviewUtils.js';

const PROVIDER_IDS = ['anthropic', 'openai', 'google', 'mistral', 'deepseek', 'zai', 'local', 'copilot'] as const;
type ProviderId = (typeof PROVIDER_IDS)[number];

type ModelProviderMessage =
  | { type: 'saveApiKey'; payload: ProviderId }
  | { type: 'refreshModels' };

/**
 * Model Provider management webview – add/edit API keys, enable/disable providers.
 */
export class ModelProviderPanel {
  public static currentPanel: ModelProviderPanel | undefined;
  private static readonly viewType = 'atlasmind.modelProviders';
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(context: vscode.ExtensionContext, atlas: AtlasMindContext): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (ModelProviderPanel.currentPanel) {
      ModelProviderPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ModelProviderPanel.viewType,
      'Model Providers',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );

    ModelProviderPanel.currentPanel = new ModelProviderPanel(panel, context, atlas);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly atlas: AtlasMindContext,
  ) {
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
    ModelProviderPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isModelProviderMessage(message)) {
      return;
    }

    switch (message.type) {
      case 'saveApiKey': {
        if (!requiresApiKey(message.payload)) {
          if (message.payload === 'copilot') {
            vscode.window.showInformationMessage('GitHub Copilot uses your signed-in VS Code session. No API key is required here.');
          } else {
            vscode.window.showInformationMessage('Local LLM uses a locally running server. Configure the endpoint in AtlasMind settings.');
          }
          return;
        }

        const apiKey = await vscode.window.showInputBox({
          prompt: `Enter the API key for ${message.payload}`,
          password: true,
          ignoreFocusOut: true,
          validateInput: value => value.trim().length === 0 ? 'API key cannot be empty.' : undefined,
        });

        if (apiKey === undefined) {
          return;
        }

        await this.context.secrets.store(
          getProviderSecretKey(message.payload),
          apiKey.trim(),
        );

        // Validate the key immediately by running a health check
        const adapter = this.atlas.providerRegistry.get(message.payload);
        if (adapter) {
          try {
            const models = await adapter.listModels();
            if (models.length > 0) {
              vscode.window.showInformationMessage(
                `✅ ${message.payload} key verified — ${models.length} model(s) available.`,
              );
            } else {
              vscode.window.showWarningMessage(
                `Key stored for ${message.payload}, but no models were returned. Verify the key is correct.`,
              );
            }
          } catch {
            vscode.window.showWarningMessage(
              `Key stored for ${message.payload}, but validation failed. The key may be invalid or the provider may be down.`,
            );
          }
        } else {
          vscode.window.showInformationMessage(`Stored ${message.payload} credentials in VS Code SecretStorage.`);
        }
        return;
      }
      case 'refreshModels':
        {
          const summary = await this.atlas.refreshProviderModels();
          vscode.window.showInformationMessage(
            `Refreshed ${summary.providersUpdated} provider(s). ` +
            `${summary.modelsAvailable} models are now available to routing.`,
          );
        }
        return;
    }
  }

  private getHtml(): string {
    return getWebviewHtmlShell({
      title: 'Model Providers',
      cspSource: this.panel.webview.cspSource,
      bodyContent:
      `
      <h1>Model Providers</h1>
      <p>Configure API keys and enable or disable model providers.</p>
      <p>Provider credentials are stored in VS Code SecretStorage, not in settings or project files.</p>

      <table>
        <thead>
          <tr><th>Provider</th><th>Status</th><th>Action</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Anthropic (Claude)</td>
            <td><span class="badge">not configured</span></td>
            <td><button type="button" data-provider="anthropic">Set API Key</button></td>
          </tr>
          <tr>
            <td>OpenAI</td>
            <td><span class="badge">not configured</span></td>
            <td><button type="button" data-provider="openai">Set API Key</button></td>
          </tr>
          <tr>
            <td>z.ai (GLM)</td>
            <td><span class="badge">not configured</span></td>
            <td><button type="button" data-provider="zai">Set API Key</button></td>
          </tr>
          <tr>
            <td>Google (Gemini)</td>
            <td><span class="badge">not configured</span></td>
            <td><button type="button" data-provider="google">Set API Key</button></td>
          </tr>
          <tr>
            <td>Mistral</td>
            <td><span class="badge">not configured</span></td>
            <td><button type="button" data-provider="mistral">Set API Key</button></td>
          </tr>
          <tr>
            <td>DeepSeek</td>
            <td><span class="badge">not configured</span></td>
            <td><button type="button" data-provider="deepseek">Set API Key</button></td>
          </tr>
          <tr>
            <td>Local LLM</td>
            <td><span class="badge">not configured</span></td>
            <td><button type="button" data-provider="local">Configure</button></td>
          </tr>
          <tr>
            <td>GitHub Copilot</td>
            <td><span class="badge">uses VS Code sign-in</span></td>
            <td><button type="button" data-provider="copilot">Use Session</button></td>
          </tr>
        </tbody>
      </table>

      <p><button type="button" id="refresh-models">Refresh Model Metadata</button></p>
      `,
      scriptContent:
      `
        const vscode = acquireVsCodeApi();

        document.querySelectorAll('button[data-provider]').forEach(button => {
          button.addEventListener('click', () => {
            const provider = button.getAttribute('data-provider');
            if (!provider) {
              return;
            }
            vscode.postMessage({ type: 'saveApiKey', payload: provider });
          });
        });

        const refreshButton = document.getElementById('refresh-models');
        if (refreshButton) {
          refreshButton.addEventListener('click', () => {
            vscode.postMessage({ type: 'refreshModels' });
          });
        }
      `,
    });
  }
}

export function isModelProviderMessage(value: unknown): value is ModelProviderMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }

  const message = value as { type?: unknown; payload?: unknown };
  if (message.type === 'refreshModels') {
    return true;
  }

  return message.type === 'saveApiKey'
    && typeof message.payload === 'string'
    && PROVIDER_IDS.includes(message.payload as ProviderId);
}

function getProviderSecretKey(provider: ProviderId): string {
  return `atlasmind.provider.${provider}.apiKey`;
}

function requiresApiKey(provider: ProviderId): boolean {
  return provider !== 'copilot' && provider !== 'local';
}
