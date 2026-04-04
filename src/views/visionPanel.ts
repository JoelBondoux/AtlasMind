import * as vscode from 'vscode';
import type { AtlasMindContext } from '../extension.js';
import type { TaskImageAttachment } from '../types.js';
import { resolvePickedImageAttachments } from '../chat/imageAttachments.js';
import { getWebviewHtmlShell } from './webviewUtils.js';

type VisionPanelMessage =
  | { type: 'attachImages' }
  | { type: 'clearImages' }
  | { type: 'submitPrompt'; payload: string };

export class VisionPanel {
  public static currentPanel: VisionPanel | undefined;
  private static readonly viewType = 'atlasmind.vision';

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private attachments: TaskImageAttachment[] = [];

  public static createOrShow(context: vscode.ExtensionContext, atlas: AtlasMindContext): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (VisionPanel.currentPanel) {
      VisionPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      VisionPanel.viewType,
      'AtlasMind Vision',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );

    VisionPanel.currentPanel = new VisionPanel(panel, atlas);
  }

  private constructor(panel: vscode.WebviewPanel, private readonly atlas: AtlasMindContext) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(message => {
      void this.handleMessage(message);
    }, null, this.disposables);

    void this.syncAttachments();
  }

  private dispose(): void {
    VisionPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isVisionPanelMessage(message)) {
      return;
    }

    switch (message.type) {
      case 'attachImages':
        await this.attachImages();
        return;
      case 'clearImages':
        this.attachments = [];
        await this.syncAttachments();
        return;
      case 'submitPrompt':
        await this.runPrompt(message.payload);
        return;
    }
  }

  private async attachImages(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showWarningMessage('Open a workspace folder first to attach images.');
      return;
    }

    const selected = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFiles: true,
      canSelectFolders: false,
      defaultUri: workspaceFolder.uri,
      openLabel: 'Attach images to AtlasMind Vision',
      filters: { Images: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
    });

    if (!selected || selected.length === 0) {
      return;
    }

    this.attachments = await resolvePickedImageAttachments(selected);
    await this.syncAttachments();
  }

  private async runPrompt(rawPrompt: string): Promise<void> {
    if (this.attachments.length === 0) {
      await this.panel.webview.postMessage({ type: 'status', payload: 'Attach at least one image before running a vision prompt.' });
      return;
    }

    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const sessionContext = this.atlas.sessionConversation.buildContext({
      maxTurns: configuration.get<number>('chatSessionTurnLimit', 6),
      maxChars: configuration.get<number>('chatSessionContextChars', 2500),
    });
    const prompt = rawPrompt.trim().length > 0
      ? rawPrompt.trim()
      : 'Describe the attached images and highlight anything important.';

    await this.panel.webview.postMessage({ type: 'responseReset' });
    await this.panel.webview.postMessage({ type: 'busy', payload: true });
    await this.panel.webview.postMessage({ type: 'status', payload: 'Running vision request...' });

    let streamed = false;
    try {
      const result = await this.atlas.orchestrator.processTask({
        id: `vision-${Date.now()}`,
        userMessage: prompt,
        context: {
          ...(sessionContext ? { sessionContext } : {}),
          imageAttachments: this.attachments,
        },
        constraints: {
          budget: toBudgetMode(configuration.get<string>('budgetMode')),
          speed: toSpeedMode(configuration.get<string>('speedMode')),
          requiredCapabilities: ['vision'],
        },
        timestamp: new Date().toISOString(),
      }, async chunk => {
        if (!chunk) {
          return;
        }
        streamed = true;
        await this.panel.webview.postMessage({ type: 'responseChunk', payload: chunk });
      });

      if (!streamed) {
        await this.panel.webview.postMessage({ type: 'responseChunk', payload: result.response });
      }

      this.atlas.sessionConversation.recordTurn(prompt, result.response);
      if (configuration.get<boolean>('voice.ttsEnabled', false)) {
        this.atlas.voiceManager.speak(result.response);
      }
      await this.panel.webview.postMessage({ type: 'status', payload: 'Vision request completed.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.panel.webview.postMessage({ type: 'status', payload: `Vision request failed: ${message}` });
    } finally {
      await this.panel.webview.postMessage({ type: 'busy', payload: false });
    }
  }

  private async syncAttachments(): Promise<void> {
    await this.panel.webview.postMessage({
      type: 'attachments',
      payload: this.attachments.map(attachment => ({
        source: attachment.source,
        mimeType: attachment.mimeType,
      })),
    });
  }

  private getHtml(): string {
    return getWebviewHtmlShell({
      title: 'AtlasMind Vision',
      cspSource: this.panel.webview.cspSource,
      bodyContent: `
        <h1>AtlasMind Vision</h1>
        <p>Attach workspace images, enter a prompt, and run a multimodal request without using slash commands.</p>
        <section>
          <h2>Attachments</h2>
          <div class="row">
            <button id="attachImages" class="primary-btn">Attach Images</button>
            <button id="clearImages">Clear</button>
          </div>
          <ul id="attachmentList" class="attachment-list"></ul>
        </section>
        <section>
          <h2>Prompt</h2>
          <textarea id="promptInput" rows="4" placeholder="Describe what you want AtlasMind to inspect in the attached images…"></textarea>
          <div class="row">
            <button id="runVision" class="primary-btn">Run Vision Prompt</button>
          </div>
          <div id="status" class="status-label"></div>
        </section>
        <section>
          <h2>Response</h2>
          <pre id="responseOutput" class="output-box" aria-live="polite"></pre>
        </section>
      `,
      extraCss: `
        .row { display: flex; gap: 10px; margin: 10px 0; }
        .primary-btn { font-weight: 600; }
        textarea {
          width: 100%;
          resize: vertical;
          color: var(--vscode-input-foreground);
          background: var(--vscode-input-background);
          border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #444));
          padding: 8px;
          font-family: var(--vscode-font-family, system-ui, sans-serif);
        }
        .attachment-list {
          margin: 8px 0 0;
          padding-left: 18px;
        }
        .output-box {
          min-height: 180px;
          max-height: 420px;
          overflow-y: auto;
          padding: 10px;
          border: 1px solid var(--vscode-widget-border, #444);
          background: var(--vscode-input-background);
          white-space: pre-wrap;
          word-break: break-word;
          font-family: var(--vscode-editor-font-family, monospace);
        }
        .status-label {
          font-size: 0.9em;
          color: var(--vscode-descriptionForeground);
          margin-top: 6px;
        }
      `,
      scriptContent: buildScript(),
    });
  }
}

export function isVisionPanelMessage(value: unknown): value is VisionPanelMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }

  const message = value as { type?: unknown; payload?: unknown };
  if (message.type === 'attachImages' || message.type === 'clearImages') {
    return true;
  }

  return message.type === 'submitPrompt' && typeof message.payload === 'string';
}

function buildScript(): string {
  return `
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const attachButton = document.getElementById('attachImages');
  const clearButton = document.getElementById('clearImages');
  const runButton = document.getElementById('runVision');
  const promptInput = document.getElementById('promptInput');
  const attachmentList = document.getElementById('attachmentList');
  const responseOutput = document.getElementById('responseOutput');
  const status = document.getElementById('status');

  function setBusy(isBusy) {
    if (attachButton) { attachButton.disabled = isBusy; }
    if (clearButton) { clearButton.disabled = isBusy; }
    if (runButton) { runButton.disabled = isBusy; }
  }

  if (attachButton) {
    attachButton.addEventListener('click', () => vscode.postMessage({ type: 'attachImages' }));
  }
  if (clearButton) {
    clearButton.addEventListener('click', () => vscode.postMessage({ type: 'clearImages' }));
  }
  if (runButton) {
    runButton.addEventListener('click', () => {
      const prompt = promptInput instanceof HTMLTextAreaElement ? promptInput.value : '';
      vscode.postMessage({ type: 'submitPrompt', payload: prompt });
    });
  }

  window.addEventListener('message', event => {
    const message = event.data;
    if (!message || typeof message.type !== 'string') {
      return;
    }

    switch (message.type) {
      case 'attachments': {
        if (!(attachmentList instanceof HTMLUListElement)) {
          return;
        }
        attachmentList.textContent = '';
        const attachments = Array.isArray(message.payload) ? message.payload : [];
        if (attachments.length === 0) {
          const item = document.createElement('li');
          item.textContent = 'No images attached yet.';
          attachmentList.appendChild(item);
          return;
        }
        attachments.forEach(attachment => {
          const item = document.createElement('li');
          item.textContent = attachment.source + ' (' + attachment.mimeType + ')';
          attachmentList.appendChild(item);
        });
        return;
      }
      case 'responseReset':
        if (responseOutput) { responseOutput.textContent = ''; }
        return;
      case 'responseChunk':
        if (responseOutput) { responseOutput.textContent += String(message.payload || ''); }
        return;
      case 'status':
        if (status) { status.textContent = String(message.payload || ''); }
        return;
      case 'busy':
        setBusy(Boolean(message.payload));
        return;
    }
  });
})();`;
}

function toBudgetMode(value: string | undefined): 'cheap' | 'balanced' | 'expensive' | 'auto' {
  if (value === 'cheap' || value === 'balanced' || value === 'expensive' || value === 'auto') {
    return value;
  }
  return 'balanced';
}

function toSpeedMode(value: string | undefined): 'fast' | 'balanced' | 'considered' | 'auto' {
  if (value === 'fast' || value === 'balanced' || value === 'considered' || value === 'auto') {
    return value;
  }
  return 'balanced';
}