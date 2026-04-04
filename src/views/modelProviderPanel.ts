import * as vscode from 'vscode';
import type { AtlasMindContext } from '../extension.js';
import type { ProviderId } from '../types.js';
import {
  BEDROCK_ACCESS_KEY_SECRET,
  BEDROCK_MODEL_IDS_SETTING,
  BEDROCK_REGION_SETTING,
  BEDROCK_SECRET_KEY_SECRET,
  BEDROCK_SESSION_TOKEN_SECRET,
  getConfiguredBedrockModelIds,
  getConfiguredBedrockRegion,
  getConfiguredLocalBaseUrl,
  getDefaultLocalBaseUrl,
} from '../providers/index.js';
import { getWebviewHtmlShell } from './webviewUtils.js';

const AZURE_OPENAI_ENDPOINT_SETTING = 'azureOpenAiEndpoint';
const AZURE_OPENAI_DEPLOYMENTS_SETTING = 'azureOpenAiDeployments';

export const PROVIDER_IDS: readonly ProviderId[] = [
  'anthropic',
  'openai',
  'google',
  'azure',
  'mistral',
  'deepseek',
  'zai',
  'bedrock',
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
  | { type: 'refreshModels' }
  | { type: 'openSpecialistIntegrations' };

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
      case 'openSpecialistIntegrations':
        await vscode.commands.executeCommand('atlasmind.openSpecialistIntegrations');
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
  <p><button type="button" id="open-specialists">Open Specialist Integrations</button></p>
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

        const specialistButton = document.getElementById('open-specialists');
        if (specialistButton) {
          specialistButton.addEventListener('click', () => {
            vscode.postMessage({ type: 'openSpecialistIntegrations' });
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
    if (providerId === 'azure') {
      return { displayName: getProviderDisplayName(providerId), badge: configured ? 'configured' : 'configure endpoint + deployments' };
    }
    if (providerId === 'bedrock') {
      return { displayName: getProviderDisplayName(providerId), badge: configured ? 'configured' : 'configure region + model IDs' };
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

  if (message.type === 'openSpecialistIntegrations') {
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
  if (provider === 'copilot') {
    vscode.window.showInformationMessage('GitHub Copilot uses your signed-in VS Code session. No API key is required here.');
    await atlas.refreshProviderHealth();
    atlas.modelsRefresh.fire();
    return;
  }

  if (provider === 'local') {
    await configureLocalProvider(context, atlas);
    return;
  }

  if (provider === 'azure') {
    await configureAzureOpenAiProvider(context, atlas);
    return;
  }

  if (provider === 'bedrock') {
    await configureBedrockProvider(context, atlas);
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
  if (provider === 'azure') {
    const key = await context.secrets.get?.(getProviderSecretKey(provider));
    return Boolean(key && getConfiguredAzureOpenAiEndpoint() && getConfiguredAzureOpenAiDeployments().length > 0);
  }
  if (provider === 'bedrock') {
    const accessKeyId = await context.secrets.get?.(BEDROCK_ACCESS_KEY_SECRET);
    const secretAccessKey = await context.secrets.get?.(BEDROCK_SECRET_KEY_SECRET);
    return Boolean(accessKeyId && secretAccessKey && getConfiguredBedrockRegion() && getConfiguredBedrockModelIds().length > 0);
  }

  const key = await context.secrets.get?.(getProviderSecretKey(provider));
  return Boolean(key);
}

export function getProviderSecretKey(provider: ProviderId): string {
  return `atlasmind.provider.${provider}.apiKey`;
}

export function requiresApiKey(provider: ProviderId): boolean {
  return provider !== 'copilot' && provider !== 'local' && provider !== 'azure' && provider !== 'bedrock';
}

export function getProviderDisplayName(provider: ProviderId): string {
  switch (provider) {
    case 'anthropic':
      return 'Anthropic (Claude)';
    case 'openai':
      return 'OpenAI';
    case 'google':
      return 'Google (Gemini)';
    case 'azure':
      return 'Azure OpenAI';
    case 'mistral':
      return 'Mistral';
    case 'deepseek':
      return 'DeepSeek';
    case 'zai':
      return 'z.ai (GLM)';
    case 'bedrock':
      return 'Amazon Bedrock';
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
  if (provider === 'local' || provider === 'azure' || provider === 'bedrock') {
    return 'Configure';
  }
  return 'Set API Key';
}

async function configureLocalProvider(
  context: vscode.ExtensionContext,
  atlas: AtlasMindContext,
): Promise<void> {
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

  await atlas.refreshProviderHealth();
  atlas.modelsRefresh.fire();
}

async function configureAzureOpenAiProvider(
  context: vscode.ExtensionContext,
  atlas: AtlasMindContext,
): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const endpoint = await vscode.window.showInputBox({
    prompt: 'Enter the Azure OpenAI resource endpoint',
    value: getConfiguredAzureOpenAiEndpoint(),
    placeHolder: 'https://your-resource.openai.azure.com',
    ignoreFocusOut: true,
    validateInput: value => validateAzureEndpoint(value),
  });

  if (endpoint === undefined) {
    return;
  }

  const deploymentInput = await vscode.window.showInputBox({
    prompt: 'Enter Azure OpenAI deployment names (comma separated)',
    value: getConfiguredAzureOpenAiDeployments().join(', '),
    placeHolder: 'gpt-4o, gpt-4.1-mini',
    ignoreFocusOut: true,
    validateInput: value => parseCommaSeparatedValues(value).length === 0 ? 'At least one deployment name is required.' : undefined,
  });

  if (deploymentInput === undefined) {
    return;
  }

  const apiKey = await vscode.window.showInputBox({
    prompt: 'Enter the Azure OpenAI API key',
    password: true,
    ignoreFocusOut: true,
    validateInput: value => value.trim().length === 0 ? 'API key cannot be empty.' : undefined,
  });

  if (apiKey === undefined) {
    return;
  }

  await configuration.update(AZURE_OPENAI_ENDPOINT_SETTING, normalizeLocalEndpoint(endpoint), vscode.ConfigurationTarget.Workspace);
  await configuration.update(AZURE_OPENAI_DEPLOYMENTS_SETTING, parseCommaSeparatedValues(deploymentInput), vscode.ConfigurationTarget.Workspace);
  await context.secrets.store(getProviderSecretKey('azure'), apiKey.trim());

  await validateConfiguredProvider(atlas, 'azure', 'Azure OpenAI');
}

async function configureBedrockProvider(
  context: vscode.ExtensionContext,
  atlas: AtlasMindContext,
): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const region = await vscode.window.showInputBox({
    prompt: 'Enter the AWS region for Amazon Bedrock',
    value: getConfiguredBedrockRegion(),
    placeHolder: 'us-east-1',
    ignoreFocusOut: true,
    validateInput: value => validateAwsRegion(value),
  });

  if (region === undefined) {
    return;
  }

  const modelIdsInput = await vscode.window.showInputBox({
    prompt: 'Enter Bedrock model IDs (comma separated)',
    value: getConfiguredBedrockModelIds().join(', '),
    placeHolder: 'anthropic.claude-3-7-sonnet-20250219-v1:0, amazon.nova-pro-v1:0',
    ignoreFocusOut: true,
    validateInput: value => parseCommaSeparatedValues(value).length === 0 ? 'At least one Bedrock model ID is required.' : undefined,
  });

  if (modelIdsInput === undefined) {
    return;
  }

  const accessKeyId = await vscode.window.showInputBox({
    prompt: 'Enter the AWS access key ID',
    password: true,
    ignoreFocusOut: true,
    validateInput: value => value.trim().length === 0 ? 'Access key ID cannot be empty.' : undefined,
  });

  if (accessKeyId === undefined) {
    return;
  }

  const secretAccessKey = await vscode.window.showInputBox({
    prompt: 'Enter the AWS secret access key',
    password: true,
    ignoreFocusOut: true,
    validateInput: value => value.trim().length === 0 ? 'Secret access key cannot be empty.' : undefined,
  });

  if (secretAccessKey === undefined) {
    return;
  }

  const sessionToken = await vscode.window.showInputBox({
    prompt: 'Optional AWS session token',
    password: true,
    ignoreFocusOut: true,
  });

  if (sessionToken === undefined) {
    return;
  }

  await configuration.update(BEDROCK_REGION_SETTING, region.trim(), vscode.ConfigurationTarget.Workspace);
  await configuration.update(BEDROCK_MODEL_IDS_SETTING, parseCommaSeparatedValues(modelIdsInput), vscode.ConfigurationTarget.Workspace);
  await context.secrets.store(BEDROCK_ACCESS_KEY_SECRET, accessKeyId.trim());
  await context.secrets.store(BEDROCK_SECRET_KEY_SECRET, secretAccessKey.trim());
  if (sessionToken.trim().length > 0) {
    await context.secrets.store(BEDROCK_SESSION_TOKEN_SECRET, sessionToken.trim());
  } else {
    await context.secrets.delete(BEDROCK_SESSION_TOKEN_SECRET);
  }

  await validateConfiguredProvider(atlas, 'bedrock', 'Amazon Bedrock');
}

async function validateConfiguredProvider(
  atlas: AtlasMindContext,
  provider: ProviderId,
  label: string,
): Promise<void> {
  const adapter = atlas.providerRegistry.get(provider);
  if (adapter) {
    try {
      const models = await adapter.listModels();
      if (models.length > 0) {
        vscode.window.showInformationMessage(`Configured ${label} with ${models.length} model(s).`);
      } else {
        vscode.window.showWarningMessage(`${label} was saved, but no models are currently configured.`);
      }
    } catch (error) {
      vscode.window.showWarningMessage(`${label} settings were saved, but AtlasMind could not validate them yet.`);
      void error;
    }
  }

  await atlas.refreshProviderHealth();
  atlas.modelsRefresh.fire();
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

function validateAzureEndpoint(value: string): string | undefined {
  const baseError = validateLocalEndpoint(value);
  if (baseError) {
    return baseError;
  }

  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:') {
      return 'Azure OpenAI endpoints must use https://.';
    }
    return undefined;
  } catch {
    return 'Enter a valid absolute URL.';
  }
}

function validateAwsRegion(value: string): string | undefined {
  return /^[a-z]{2}-[a-z]+-\d+$/.test(value.trim()) ? undefined : 'Enter a valid AWS region like us-east-1.';
}

function parseCommaSeparatedValues(value: string): string[] {
  return value
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0);
}

function getConfiguredAzureOpenAiEndpoint(): string {
  const value = vscode.workspace.getConfiguration('atlasmind').get<string>(AZURE_OPENAI_ENDPOINT_SETTING, '');
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

function getConfiguredAzureOpenAiDeployments(): string[] {
  const value = vscode.workspace.getConfiguration('atlasmind').get<string[]>(AZURE_OPENAI_DEPLOYMENTS_SETTING, []);
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter(item => item.length > 0);
}
