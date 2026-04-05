import * as vscode from 'vscode';
import * as path from 'path';
import type { AtlasMindContext } from '../extension.js';
import type { TaskImageAttachment } from '../types.js';
import { buildAssistantResponseMetadata } from '../chat/participant.js';
import { resolvePickedImageAttachments } from '../chat/imageAttachments.js';
import { getWebviewHtmlShell } from './webviewUtils.js';

type VisionPanelMessage =
  | { type: 'attachImages' }
  | { type: 'clearImages' }
  | { type: 'submitPrompt'; payload: string }
  | { type: 'openFileReference'; payload: string }
  | { type: 'copyResponse' }
  | { type: 'saveResponse' };

export class VisionPanel {
  public static currentPanel: VisionPanel | undefined;
  private static readonly viewType = 'atlasmind.vision';

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private attachments: TaskImageAttachment[] = [];
  private lastResponse = '';

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
      case 'openFileReference':
        await this.openFileReference(message.payload);
        return;
      case 'copyResponse':
        await vscode.env.clipboard.writeText(this.lastResponse);
        await this.panel.webview.postMessage({
          type: 'status',
          payload: this.lastResponse ? 'Response copied to the clipboard.' : 'No response available yet.',
        });
        return;
      case 'saveResponse':
        await this.saveResponse();
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
    this.lastResponse = '';

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
      this.lastResponse = result.response;

      this.atlas.sessionConversation.recordTurn(
        prompt,
        result.response,
        undefined,
        buildAssistantResponseMetadata(prompt, result, {
          hasSessionContext: Boolean(sessionContext),
          imageAttachments: this.attachments,
        }),
      );
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

  private async openFileReference(reference: string): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return;
    }

    const parsed = parseWorkspaceFileReference(reference, workspaceRoot);
    if (!parsed) {
      return;
    }

    const document = await vscode.workspace.openTextDocument(parsed.uri);
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    if (typeof parsed.line === 'number') {
      const position = new vscode.Position(parsed.line, parsed.column ?? 0);
      const selection = new vscode.Selection(position, position);
      editor.selection = selection;
      editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
    }
  }

  private async saveResponse(): Promise<void> {
    if (!this.lastResponse) {
      await this.panel.webview.postMessage({ type: 'status', payload: 'No response available yet.' });
      return;
    }

    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: this.lastResponse,
    });
    await vscode.window.showTextDocument(document, { preview: false });
    await this.panel.webview.postMessage({ type: 'status', payload: 'Opened the latest response in a markdown editor.' });
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
          <div class="row">
            <button id="copyResponse">Copy Response</button>
            <button id="saveResponse">Open as Markdown</button>
          </div>
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
          word-break: break-word;
          line-height: 1.55;
        }
        .output-box pre {
          margin: 12px 0;
          padding: 10px;
          overflow-x: auto;
          border-radius: 4px;
          background: var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.12));
        }
        .output-box code {
          font-family: var(--vscode-editor-font-family, monospace);
        }
        .output-box p {
          margin: 0 0 10px;
        }
        .output-box ul {
          margin: 0 0 10px 18px;
          padding: 0;
        }
        .output-box ol {
          margin: 0 0 10px 18px;
          padding: 0;
        }
        .output-box table {
          width: 100%;
          border-collapse: collapse;
          margin: 10px 0;
        }
        .output-box th,
        .output-box td {
          border: 1px solid var(--vscode-widget-border, #444);
          padding: 6px 8px;
          text-align: left;
        }
        .output-box a {
          color: var(--vscode-textLink-foreground);
          text-decoration: underline;
          cursor: pointer;
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
  if (
    message.type === 'attachImages'
    || message.type === 'clearImages'
    || message.type === 'copyResponse'
    || message.type === 'saveResponse'
  ) {
    return true;
  }

  return (message.type === 'submitPrompt' || message.type === 'openFileReference')
    && typeof message.payload === 'string';
}

export function parseWorkspaceFileReference(
  reference: string,
  workspaceRoot: string,
): { uri: vscode.Uri; line?: number; column?: number } | undefined {
  const trimmed = reference.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  let filePart = trimmed;
  let lineNumber: number | undefined;
  let columnNumber: number | undefined;

  const hashMatch = /^(.*?)(?:#L(\d+)(?:C(\d+))?)$/.exec(trimmed);
  if (hashMatch) {
    filePart = hashMatch[1] ?? trimmed;
    lineNumber = parsePositiveInteger(hashMatch[2]);
    columnNumber = parsePositiveInteger(hashMatch[3]);
  } else {
    const colonMatch = /^(.*?):(\d+)(?::(\d+))?$/.exec(trimmed);
    if (colonMatch && !/^[A-Za-z]:$/.test(colonMatch[1] ?? '')) {
      filePart = colonMatch[1] ?? trimmed;
      lineNumber = parsePositiveInteger(colonMatch[2]);
      columnNumber = parsePositiveInteger(colonMatch[3]);
    }
  }

  if (filePart.length === 0) {
    return undefined;
  }

  const resolvedPath = path.resolve(workspaceRoot, filePart);
  const normalizedRoot = normalizePathForComparison(workspaceRoot);
  const normalizedCandidate = normalizePathForComparison(resolvedPath);
  if (normalizedCandidate !== normalizedRoot && !normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)) {
    return undefined;
  }

  const uri = vscode.Uri.file(resolvedPath);
  if (!lineNumber) {
    return { uri };
  }

  return {
    uri,
    line: Math.max(0, lineNumber - 1),
    column: Math.max(0, (columnNumber ?? 1) - 1),
  };
}

function buildScript(): string {
  return `
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const attachButton = document.getElementById('attachImages');
  const clearButton = document.getElementById('clearImages');
  const runButton = document.getElementById('runVision');
  const copyButton = document.getElementById('copyResponse');
  const saveButton = document.getElementById('saveResponse');
  const promptInput = document.getElementById('promptInput');
  const attachmentList = document.getElementById('attachmentList');
  const responseOutput = document.getElementById('responseOutput');
  const status = document.getElementById('status');
  let responseMarkdown = '';

  function setBusy(isBusy) {
    if (attachButton) { attachButton.disabled = isBusy; }
    if (clearButton) { clearButton.disabled = isBusy; }
    if (runButton) { runButton.disabled = isBusy; }
    if (copyButton) { copyButton.disabled = isBusy; }
    if (saveButton) { saveButton.disabled = isBusy; }
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
  if (copyButton) {
    copyButton.addEventListener('click', () => vscode.postMessage({ type: 'copyResponse' }));
  }
  if (saveButton) {
    saveButton.addEventListener('click', () => vscode.postMessage({ type: 'saveResponse' }));
  }
  if (responseOutput) {
    responseOutput.addEventListener('click', event => {
      const target = event.target;
      if (!(target instanceof HTMLAnchorElement)) {
        return;
      }
      const fileRef = target.getAttribute('data-file-ref');
      if (!fileRef) {
        return;
      }
      event.preventDefault();
      vscode.postMessage({ type: 'openFileReference', payload: fileRef });
    });
  }

  function escapeHtml(value) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderInline(text) {
    // Escape all HTML first so structural tags below operate on safe content.
    return escapeHtml(text)
      .replace(/\\[([^\\]]+)\\]\\(([^)\\s]+(?:#[^)]+)?)\\)/g, (_, label, target) => {
        // label and target are already HTML-escaped — do not double-escape.
        return '<a href="#" data-file-ref="' + target + '">' + label + '</a>';
      })
      .replace(new RegExp('\`([^\`]+)\`', 'g'), '<code>$1</code>')
      .replace(/[*][*]([^*]+)[*][*]/g, '<strong>$1</strong>');
  }

  function renderMarkdown(text) {
    const blocks = text.replace(/\r\n/g, '\n').split(/\n\n+/g);
    return blocks.map(block => {
      if (block.startsWith('\`\`\`') && block.endsWith('\`\`\`')) {
        const code = block
          .replace(new RegExp('^\`\`\`[a-zA-Z0-9_-]*\\n?'), '')
          .replace(new RegExp('\\n?\`\`\`$'), '');
        return '<pre><code>' + escapeHtml(code) + '</code></pre>';
      }
      const lines = block.split('\n');
      if (lines.length >= 2 && lines[0].includes('|') && /^\\s*[|]?\\s*[-:]+/.test(lines[1])) {
        const rows = lines.map(line => line.split('|').map(cell => cell.trim()).filter(Boolean));
        const header = rows[0] || [];
        const body = rows.slice(2);
        return '<table><thead><tr>' + header.map(cell => '<th>' + renderInline(cell) + '</th>').join('') + '</tr></thead><tbody>' +
          body.map(row => '<tr>' + row.map(cell => '<td>' + renderInline(cell) + '</td>').join('') + '</tr>').join('') +
          '</tbody></table>';
      }
      if (lines.every(line => /^-\\s+/.test(line))) {
        return '<ul>' + lines.map(line => '<li>' + renderInline(line.replace(/^-\\s+/, '')) + '</li>').join('') + '</ul>';
      }
      if (lines.every(line => /^\\d+\\.\\s+/.test(line))) {
        return '<ol>' + lines.map(line => '<li>' + renderInline(line.replace(/^\\d+\\.\\s+/, '')) + '</li>').join('') + '</ol>';
      }
      if (/^#{1,3}\\s+/.test(lines[0] || '')) {
        const level = Math.min(3, (lines[0].match(/^#+/) || [''])[0].length);
        const content = renderInline((lines[0] || '').replace(/^#{1,3}\\s+/, ''));
        return '<h' + level + '>' + content + '</h' + level + '>';
      }
      return '<p>' + lines.map(renderInline).join('<br>') + '</p>';
    }).join('');
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
        responseMarkdown = '';
        if (responseOutput) { responseOutput.innerHTML = ''; }
        return;
      case 'responseChunk':
        responseMarkdown += String(message.payload || '');
        if (responseOutput) { responseOutput.innerHTML = renderMarkdown(responseMarkdown); }
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

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizePathForComparison(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}