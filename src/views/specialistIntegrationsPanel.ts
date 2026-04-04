import * as vscode from 'vscode';
import { getWebviewHtmlShell } from './webviewUtils.js';

type SpecialistSurfaceCommand = 'atlasmind.openVoicePanel' | 'atlasmind.openVisionPanel';

interface SpecialistProviderDefinition {
  id: string;
  displayName: string;
  category: string;
  description: string;
  surfaceLabel: string;
  command?: SpecialistSurfaceCommand;
}

const SPECIALIST_PROVIDERS: readonly SpecialistProviderDefinition[] = [
  {
    id: 'exa',
    displayName: 'EXA AI',
    category: 'Search',
    description: 'Research and web retrieval APIs belong on a search integration surface, not the routed chat-provider list.',
    surfaceLabel: 'Search integrations',
  },
  {
    id: 'elevenlabs',
    displayName: 'ElevenLabs',
    category: 'Voice',
    description: 'Voice synthesis and transcription credentials feed the Voice Panel rather than chat routing.',
    surfaceLabel: 'Voice panel',
    command: 'atlasmind.openVoicePanel',
  },
  {
    id: 'stability',
    displayName: 'Stability AI',
    category: 'Image',
    description: 'Image generation belongs on the vision workflow surface instead of the model router.',
    surfaceLabel: 'Vision panel',
    command: 'atlasmind.openVisionPanel',
  },
  {
    id: 'runway',
    displayName: 'Runway',
    category: 'Video',
    description: 'Video generation and editing need a dedicated media workflow rather than a chat completion adapter.',
    surfaceLabel: 'Media workflow',
  },
  {
    id: 'meta',
    displayName: 'Meta',
    category: 'Future multimodal',
    description: 'Open-source Meta models may appear through other routed providers today; direct specialist support is tracked separately.',
    surfaceLabel: 'Future adapter',
  },
  {
    id: 'ludus',
    displayName: 'Ludus AI',
    category: 'Future multimodal',
    description: 'Ludus AI is tracked as a specialist integration so it does not distort routed-provider assumptions.',
    surfaceLabel: 'Future adapter',
  },
  {
    id: 'reka',
    displayName: 'Reka AI',
    category: 'Future multimodal',
    description: 'Reka AI requires a dedicated adapter path and remains separated from routed chat providers for now.',
    surfaceLabel: 'Future adapter',
  },
  {
    id: 'alephalpha',
    displayName: 'Aleph Alpha',
    category: 'Future multimodal',
    description: 'Aleph Alpha is staged as a specialist integration until AtlasMind adds a dedicated runtime adapter.',
    surfaceLabel: 'Future adapter',
  },
] as const;

type SpecialistProviderId = typeof SPECIALIST_PROVIDERS[number]['id'];

type SpecialistIntegrationsMessage =
  | { type: 'configureProvider'; payload: SpecialistProviderId }
  | { type: 'openCommand'; payload: SpecialistSurfaceCommand };

export class SpecialistIntegrationsPanel {
  public static currentPanel: SpecialistIntegrationsPanel | undefined;
  private static readonly viewType = 'atlasmind.specialistIntegrations';
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(context: vscode.ExtensionContext): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (SpecialistIntegrationsPanel.currentPanel) {
      SpecialistIntegrationsPanel.currentPanel.panel.reveal(column);
      void SpecialistIntegrationsPanel.currentPanel.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      SpecialistIntegrationsPanel.viewType,
      'Specialist Integrations',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );

    SpecialistIntegrationsPanel.currentPanel = new SpecialistIntegrationsPanel(panel, context);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.panel = panel;
    void this.refresh();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(message => {
      void this.handleMessage(message);
    }, null, this.disposables);
  }

  private dispose(): void {
    SpecialistIntegrationsPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async refresh(): Promise<void> {
    this.panel.webview.html = await this.getHtml();
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isSpecialistIntegrationsMessage(message)) {
      return;
    }

    if (message.type === 'openCommand') {
      await vscode.commands.executeCommand(message.payload);
      return;
    }

    await configureSpecialistProvider(this.context, message.payload);
    await this.refresh();
  }

  private async getHtml(): Promise<string> {
    const rows = await Promise.all(SPECIALIST_PROVIDERS.map(async provider => {
      const configured = await isSpecialistProviderConfigured(this.context, provider.id);
      const surfaceButton = provider.command
        ? `<button type="button" data-command="${provider.command}">Open</button>`
        : '<span class="badge">coming soon</span>';

      return `
        <tr>
          <td>${provider.displayName}</td>
          <td>${provider.category}</td>
          <td><span class="badge">${configured ? 'credential stored' : 'not configured'}</span></td>
          <td>${provider.surfaceLabel}</td>
          <td>${provider.description}</td>
          <td><button type="button" data-provider="${provider.id}">${configured ? 'Update Key' : 'Store Key'}</button></td>
          <td>${surfaceButton}</td>
        </tr>`;
    }));

    return getWebviewHtmlShell({
      title: 'Specialist Integrations',
      cspSource: this.panel.webview.cspSource,
      bodyContent:
      `
      <h1>Specialist Integrations</h1>
      <p>AtlasMind keeps search, voice, image, and video vendors off the routed chat-provider list. Configure them here and open the matching specialist surface when available.</p>
      <p>Credentials are stored in VS Code SecretStorage.</p>
      <table>
        <thead>
          <tr><th>Provider</th><th>Category</th><th>Status</th><th>Surface</th><th>Notes</th><th>Credential</th><th>Open</th></tr>
        </thead>
        <tbody>
          ${rows.join('')}
        </tbody>
      </table>
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
            vscode.postMessage({ type: 'configureProvider', payload: provider });
          });
        });

        document.querySelectorAll('button[data-command]').forEach(button => {
          button.addEventListener('click', () => {
            const command = button.getAttribute('data-command');
            if (!command) {
              return;
            }
            vscode.postMessage({ type: 'openCommand', payload: command });
          });
        });
      `,
    });
  }
}

export function isSpecialistIntegrationsMessage(value: unknown): value is SpecialistIntegrationsMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }

  const message = value as { type?: unknown; payload?: unknown };
  if (message.type === 'openCommand') {
    return message.payload === 'atlasmind.openVoicePanel' || message.payload === 'atlasmind.openVisionPanel';
  }

  return message.type === 'configureProvider'
    && typeof message.payload === 'string'
    && SPECIALIST_PROVIDERS.some(provider => provider.id === message.payload);
}

async function configureSpecialistProvider(
  context: vscode.ExtensionContext,
  providerId: SpecialistProviderId,
): Promise<void> {
  const existing = await context.secrets.get(getSpecialistProviderSecretKey(providerId));
  const selection = await vscode.window.showQuickPick([
    { label: existing ? 'Update API key' : 'Store API key', value: 'store' },
    { label: 'Clear saved API key', value: 'clear' },
  ], {
    title: `Configure ${getSpecialistProviderDisplayName(providerId)}`,
    placeHolder: 'Choose how AtlasMind should manage this credential.',
    ignoreFocusOut: true,
  });

  if (!selection) {
    return;
  }

  if (selection.value === 'clear') {
    await context.secrets.delete(getSpecialistProviderSecretKey(providerId));
    vscode.window.showInformationMessage(`Cleared saved credentials for ${getSpecialistProviderDisplayName(providerId)}.`);
    return;
  }

  const apiKey = await vscode.window.showInputBox({
    prompt: `Enter the API key for ${getSpecialistProviderDisplayName(providerId)}`,
    password: true,
    ignoreFocusOut: true,
    validateInput: value => value.trim().length === 0 ? 'API key cannot be empty.' : undefined,
  });

  if (apiKey === undefined) {
    return;
  }

  await context.secrets.store(getSpecialistProviderSecretKey(providerId), apiKey.trim());
  vscode.window.showInformationMessage(`Stored ${getSpecialistProviderDisplayName(providerId)} credentials in VS Code SecretStorage.`);
}

async function isSpecialistProviderConfigured(
  context: Pick<vscode.ExtensionContext, 'secrets'>,
  providerId: SpecialistProviderId,
): Promise<boolean> {
  const apiKey = await context.secrets.get(getSpecialistProviderSecretKey(providerId));
  return Boolean(apiKey);
}

function getSpecialistProviderSecretKey(providerId: SpecialistProviderId): string {
  return `atlasmind.integration.${providerId}.apiKey`;
}

function getSpecialistProviderDisplayName(providerId: SpecialistProviderId): string {
  return SPECIALIST_PROVIDERS.find(provider => provider.id === providerId)?.displayName ?? providerId;
}
