import * as vscode from 'vscode';
import type { AtlasMindContext } from '../extension.js';
import type { ProviderId } from '../types.js';
import { getConfiguredLocalBaseUrl, getDefaultLocalBaseUrl } from '../providers/index.js';
import { getWebviewHtmlShell } from './webviewUtils.js';

export const PROVIDER_IDS: readonly ProviderId[] = [
  'anthropic',
  'openai',
  'google',
  'mistral',
  'deepseek',
  'zai',
  'xai',
  'cohere',
  'perplexity',
  'huggingface',
  'nvidia',
  'local',
  'copilot',
];

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
      void ModelProviderPanel.currentPanel.refresh();
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
    void this.refresh();

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

  private async refresh(): Promise<void> {
    this.panel.webview.html = await this.getHtml();
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isModelProviderMessage(message)) {
      return;
    }

    switch (message.type) {
      case 'saveApiKey': {
        await configureProvider(this.context, this.atlas, message.payload);
        await this.refresh();
        return;
      }
      case 'refreshModels':
        {
          const summary = await this.atlas.refreshProviderModels();
          await this.atlas.refreshProviderHealth();
          vscode.window.showInformationMessage(
            `Refreshed ${summary.providersUpdated} provider(s). ` +
            `${summary.modelsAvailable} models are now available to routing.`,
          );
        }
        await this.refresh();
        return;
    }
  }

  private async getHtml(): Promise<string> {
    const rows = await Promise.all(PROVIDER_IDS.map(async providerId => {
      const status = await this.getProviderStatus(providerId);
      const actionLabel = getProviderActionLabel(providerId);
      return `
          <tr>
            <td>${status.displayName}</td>
            <td><span class="badge">${status.badge}</span></td>
            <td><button type="button" data-provider="${providerId}">${actionLabel}</button></td>
          </tr>`;
    }));

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
          ${rows.join('')}
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

  private async getProviderStatus(providerId: ProviderId): Promise<{ displayName: string; badge: string }> {
    const configured = await isProviderConfigured(this.context, providerId);
    if (providerId === 'copilot') {
      return { displayName: 'GitHub Copilot', badge: 'uses VS Code sign-in' };
    }
    if (providerId === 'local') {
      return { displayName: 'Local LLM', badge: configured ? 'configured' : 'configure endpoint in settings' };
    }

    return {
      displayName: getProviderDisplayName(providerId),
      badge: configured ? 'configured' : 'not configured',
    };
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

export async function configureProvider(
  context: vscode.ExtensionContext,
  atlas: AtlasMindContext,
  provider: ProviderId,
): Promise<void> {
  if (!requiresApiKey(provider)) {
    if (provider === 'copilot') {
      vscode.window.showInformationMessage('GitHub Copilot uses your signed-in VS Code session. No API key is required here.');
    } else {
      const configuration = vscode.workspace.getConfiguration('atlasmind');
      const configuredUrl = getConfiguredLocalBaseUrl() ?? getDefaultLocalBaseUrl();
      const endpoint = await vscode.window.showInputBox({
        prompt: 'Enter the base URL for your local OpenAI-compatible endpoint',
        value: configuredUrl,
        ignoreFocusOut: true,
        validateInput: value => validateLocalEndpoint(value),
      });

      if (endpoint === undefined) {
        return;
      }

      await configuration.update('localOpenAiBaseUrl', normalizeLocalEndpoint(endpoint), vscode.ConfigurationTarget.Workspace);

      const keyAction = await vscode.window.showQuickPick([
        { label: 'No API key', value: 'none' },
        { label: 'Set or update API key', value: 'set' },
        { label: 'Clear saved API key', value: 'clear' },
      ], {
        title: 'Local endpoint authentication',
        placeHolder: 'Choose how AtlasMind should authenticate to the local endpoint.',
        ignoreFocusOut: true,
      });

      if (keyAction?.value === 'set') {
        const apiKey = await vscode.window.showInputBox({
          prompt: 'Optional API key for the local endpoint',
          password: true,
          ignoreFocusOut: true,
        });

        if (apiKey !== undefined) {
          if (apiKey.trim().length > 0) {
            await context.secrets.store(getProviderSecretKey('local'), apiKey.trim());
          } else {
            await context.secrets.delete(getProviderSecretKey('local'));
          }
        }
      } else if (keyAction?.value === 'clear') {
        await context.secrets.delete(getProviderSecretKey('local'));
      }

      const adapter = atlas.providerRegistry.get('local');
      if (adapter && await adapter.healthCheck()) {
        vscode.window.showInformationMessage(`Local endpoint configured at ${normalizeLocalEndpoint(endpoint)}.`);
      } else {
        vscode.window.showWarningMessage(`Saved local endpoint ${normalizeLocalEndpoint(endpoint)}, but AtlasMind could not verify it yet.`);
      }
    }
    await atlas.refreshProviderHealth();
    atlas.modelsRefresh.fire();
    atlas.modelsRefresh.fire();
    return;
  }

  const apiKey = await vscode.window.showInputBox({
    prompt: `Enter the API key for ${provider}`,
    password: true,
    ignoreFocusOut: true,
    validateInput: value => value.trim().length === 0 ? 'API key cannot be empty.' : undefined,
  });

  if (apiKey === undefined) {
    return;
  }

  await context.secrets.store(getProviderSecretKey(provider), apiKey.trim());

  const adapter = atlas.providerRegistry.get(provider);
  if (adapter) {
    try {
      const models = await adapter.listModels();
      if (models.length > 0) {
        vscode.window.showInformationMessage(
          `✅ ${provider} key verified — ${models.length} model(s) available.`,
        );
      } else {
        vscode.window.showWarningMessage(
          `Key stored for ${provider}, but no models were returned. Verify the key is correct.`,
        );
      }
    } catch {
      vscode.window.showWarningMessage(
        `Key stored for ${provider}, but validation failed. The key may be invalid or the provider may be down.`,
      );
    }
  } else {
    vscode.window.showInformationMessage(`Stored ${provider} credentials in VS Code SecretStorage.`);
  }

  await atlas.refreshProviderHealth();
  atlas.modelsRefresh.fire();
}

export async function isProviderConfigured(
  context: Pick<vscode.ExtensionContext, 'secrets'>,
  provider: ProviderId,
): Promise<boolean> {
  if (provider === 'copilot') {
    return true;
  }
  if (provider === 'local') {
    return Boolean(getConfiguredLocalBaseUrl());
  }

  const key = await context.secrets.get?.(getProviderSecretKey(provider));
  return Boolean(key);
}

export function getProviderSecretKey(provider: ProviderId): string {
  return `atlasmind.provider.${provider}.apiKey`;
}

export function requiresApiKey(provider: ProviderId): boolean {
  return provider !== 'copilot' && provider !== 'local';
}

export function getProviderDisplayName(provider: ProviderId): string {
  switch (provider) {
    case 'anthropic':
      return 'Anthropic (Claude)';
    case 'openai':
      return 'OpenAI';
    case 'google':
      return 'Google (Gemini)';
    case 'mistral':
      return 'Mistral';
    case 'deepseek':
      return 'DeepSeek';
    case 'zai':
      return 'z.ai (GLM)';
    case 'xai':
      return 'xAI (Grok)';
    case 'cohere':
      return 'Cohere';
    case 'perplexity':
      return 'Perplexity';
    case 'huggingface':
      return 'Hugging Face Inference';
    case 'nvidia':
      return 'NVIDIA NIM';
    case 'local':
      return 'Local LLM';
    case 'copilot':
      return 'GitHub Copilot';
  }
}

export function getProviderActionLabel(provider: ProviderId): string {
  if (provider === 'copilot') {
    return 'Use Session';
  }
  if (provider === 'local') {
    return 'Configure';
  }
  return 'Set API Key';
}

function validateLocalEndpoint(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'Endpoint URL is required.';
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'Use an http:// or https:// URL.';
    }
    return undefined;
  } catch {
    return 'Enter a valid absolute URL.';
  }
}

function normalizeLocalEndpoint(value: string): string {
  return value.trim().replace(/\/+$/, '');
}
