import * as vscode from 'vscode';
import * as path from 'path';
import type { AtlasMindContext } from '../extension.js';
import type { TaskImageAttachment } from '../types.js';
import { buildAssistantResponseMetadata, buildWorkstationContext, reconcileAssistantResponse } from '../chat/participant.js';
import { resolvePickedImageAttachments } from '../chat/imageAttachments.js';
import { getWebviewHtmlShell } from './webviewUtils.js';

type VisionPanelMessage =
  | { type: 'attachImages' }
  | { type: 'clearImages' }
  | { type: 'submitPrompt'; payload: string }
  | { type: 'openFileReference'; payload: string }
  | { type: 'copyResponse' }
  | { type: 'saveResponse' }
  | { type: 'openChatView' }
  | { type: 'openSpecialistIntegrations' }
  | { type: 'openSettingsModels' };

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
      case 'openChatView':
        await vscode.commands.executeCommand('atlasmind.openChatView');
        return;
      case 'openSpecialistIntegrations':
        await vscode.commands.executeCommand('atlasmind.openSpecialistIntegrations');
        return;
      case 'openSettingsModels':
        await vscode.commands.executeCommand('atlasmind.openSettingsModels');
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
    const workstationContext = buildWorkstationContext();
    const prompt = rawPrompt.trim().length > 0
      ? rawPrompt.trim()
      : 'Describe the attached images and highlight anything important.';

    await this.panel.webview.postMessage({ type: 'responseReset' });
    await this.panel.webview.postMessage({ type: 'busy', payload: true });
    await this.panel.webview.postMessage({ type: 'status', payload: 'Running vision request...' });
    this.lastResponse = '';

    let streamedText = '';
    try {
      const result = await this.atlas.orchestrator.processTask({
        id: `vision-${Date.now()}`,
        userMessage: prompt,
        context: {
          ...(sessionContext ? { sessionContext } : {}),
          ...(workstationContext ? { workstationContext } : {}),
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
        streamedText += chunk;
        try {
          await this.panel.webview.postMessage({ type: 'responseChunk', payload: chunk });
        } catch (error) {
          console.error('[AtlasMind] Failed to stream vision response chunk.', error);
        }
      });

      const reconciled = reconcileAssistantResponse(streamedText, result.response);
      if (reconciled.additionalText) {
        await this.panel.webview.postMessage({ type: 'responseChunk', payload: reconciled.additionalText });
      }
      this.lastResponse = reconciled.transcriptText;

      this.atlas.sessionConversation.recordTurn(
        prompt,
        reconciled.transcriptText,
        undefined,
        buildAssistantResponseMetadata(prompt, result, {
          hasSessionContext: Boolean(sessionContext),
          imageAttachments: this.attachments,
          routingContext: sessionContext ? { sessionContext } : {},
        }),
      );
      if (configuration.get<boolean>('voice.ttsEnabled', false)) {
        this.atlas.voiceManager.speak(reconciled.transcriptText);
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
        <div class="panel-hero">
          <div>
            <p class="eyebrow">Specialist integration</p>
            <h1>AtlasMind Vision</h1>
            <p class="hero-copy">Attach workspace images, run a multimodal prompt, and review the streamed response from a workspace-style panel with faster navigation.</p>
          </div>
          <div class="hero-badges" aria-label="Vision capabilities">
            <span class="hero-badge">Workspace images</span>
            <span class="hero-badge">Vision prompts</span>
            <span class="hero-badge">Streaming output</span>
          </div>
        </div>

        <div class="search-shell">
          <label class="search-label" for="visionSearch">Search vision workspace</label>
          <input id="visionSearch" type="search" placeholder="Search pages like attachments, prompt, or response" />
          <p id="visionSearchStatus" class="search-status" aria-live="polite">Browse the workspace pages or search for the part of the vision flow you need.</p>
        </div>

        <div class="panel-layout">
          <nav class="panel-nav" aria-label="Vision pages" role="tablist" aria-orientation="vertical">
            <button type="button" class="nav-link active" data-page-target="overview" data-search="overview vision multimodal settings chat">Overview</button>
            <button type="button" class="nav-link" data-page-target="attachments" data-search="attachments images workspace png jpg webp">Attachments</button>
            <button type="button" class="nav-link" data-page-target="prompt" data-search="prompt inspect describe analyze run">Prompt</button>
            <button type="button" class="nav-link" data-page-target="response" data-search="response markdown copy save output references">Response</button>
          </nav>

          <main class="panel-main">
            <section id="page-overview" class="panel-page active">
              <div class="page-header">
                <p class="page-kicker">Overview</p>
                <h2>Vision workspace</h2>
                <p>Move through the normal multimodal flow without leaving the panel: attach images, enter a prompt, inspect streamed output, then jump back into chat or the broader specialist configuration surfaces.</p>
              </div>
              <div class="action-grid">
                <button type="button" class="action-card action-primary" data-nav-target="attachments">
                  <span class="action-title">Manage Attachments</span>
                  <span class="action-copy">Select workspace images and curate the input set for the next vision request.</span>
                </button>
                <button type="button" class="action-card" data-nav-target="prompt">
                  <span class="action-title">Write Prompt</span>
                  <span class="action-copy">Describe what AtlasMind should inspect or compare in the attached images.</span>
                </button>
                <button type="button" class="action-card" data-nav-target="response">
                  <span class="action-title">Review Response</span>
                  <span class="action-copy">Copy or export the latest streamed vision output once the request finishes.</span>
                </button>
                <button type="button" id="open-chat-view" class="action-card">
                  <span class="action-title">Focus Chat View</span>
                  <span class="action-copy">Jump back to Atlas chat after gathering visual context.</span>
                </button>
                <button type="button" id="open-specialist-integrations" class="action-card">
                  <span class="action-title">Open Specialist Integrations</span>
                  <span class="action-copy">Review how multimodal vendors fit alongside routed chat models and other specialists.</span>
                </button>
                <button type="button" id="open-settings-models" class="action-card">
                  <span class="action-title">Open Model Settings</span>
                  <span class="action-copy">Adjust the core routing preferences that shape multimodal execution choices.</span>
                </button>
              </div>
            </section>

            <section id="page-attachments" class="panel-page" hidden>
              <div class="page-header">
                <p class="page-kicker">Attachments</p>
                <h2>Prepare image input</h2>
                <p>Attach workspace images before running a request. Clear the list when you want to start a new multimodal comparison.</p>
              </div>
              <section class="content-card">
                <div class="row">
                  <button id="attachImages" class="primary-btn">Attach Images</button>
                  <button id="clearImages">Clear</button>
                </div>
                <ul id="attachmentList" class="attachment-list"></ul>
              </section>
            </section>

            <section id="page-prompt" class="panel-page" hidden>
              <div class="page-header">
                <p class="page-kicker">Prompt</p>
                <h2>Run a vision request</h2>
                <p>Enter a prompt that explains what to inspect, compare, summarize, or extract from the currently attached images.</p>
              </div>
              <section class="content-card">
                <textarea id="promptInput" rows="5" placeholder="Describe what you want AtlasMind to inspect in the attached images…"></textarea>
                <div class="row">
                  <button id="runVision" class="primary-btn">Run Vision Prompt</button>
                </div>
                <div id="status" class="status-label"></div>
              </section>
            </section>

            <section id="page-response" class="panel-page" hidden>
              <div class="page-header">
                <p class="page-kicker">Response</p>
                <h2>Inspect streamed output</h2>
                <p>Copy the latest response or open it as markdown. File references stay clickable inside the rendered output.</p>
              </div>
              <section class="content-card">
                <div class="row">
                  <button id="copyResponse">Copy Response</button>
                  <button id="saveResponse">Open as Markdown</button>
                </div>
                <pre id="responseOutput" class="output-box" aria-live="polite"></pre>
              </section>
            </section>
          </main>
        </div>
      `,
      extraCss: `
        :root {
          --atlas-surface: color-mix(in srgb, var(--vscode-editor-background) 80%, var(--vscode-sideBar-background) 20%);
          --atlas-surface-strong: color-mix(in srgb, var(--vscode-editor-background) 64%, var(--vscode-sideBar-background) 36%);
          --atlas-border: var(--vscode-widget-border, rgba(127, 127, 127, 0.35));
          --atlas-accent: var(--vscode-textLink-foreground);
          --atlas-muted: var(--vscode-descriptionForeground, var(--vscode-foreground));
        }
        body { padding: 20px; }
        .panel-hero { display: flex; justify-content: space-between; gap: 20px; padding: 20px 22px; margin-bottom: 18px; border: 1px solid var(--atlas-border); border-radius: 18px; background: radial-gradient(circle at top right, color-mix(in srgb, var(--atlas-accent) 14%, transparent), transparent 40%), linear-gradient(160deg, var(--atlas-surface), var(--vscode-editor-background)); }
        .eyebrow, .page-kicker { margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.74rem; color: var(--atlas-muted); }
        .panel-hero h1, .page-header h2 { margin: 0; }
        .hero-copy, .page-header p:last-child, .search-status, .status-label { color: var(--atlas-muted); }
        .hero-badges { display: flex; flex-wrap: wrap; gap: 10px; align-content: flex-start; justify-content: flex-end; }
        .hero-badge { border: 1px solid var(--atlas-border); border-radius: 999px; padding: 6px 12px; background: color-mix(in srgb, var(--atlas-accent) 16%, transparent); }
        .search-shell { display: grid; gap: 6px; margin: 0 0 18px; }
        .search-label { font-weight: 600; }
        .search-shell input { width: 100%; box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--atlas-border)); padding: 10px 12px; border-radius: 12px; }
        .panel-layout { display: grid; grid-template-columns: minmax(220px, 240px) minmax(0, 1fr); gap: 18px; align-items: start; }
        .panel-nav { position: sticky; top: 20px; display: grid; gap: 8px; padding: 16px; border: 1px solid var(--atlas-border); border-radius: 18px; background: linear-gradient(180deg, var(--atlas-surface-strong), var(--atlas-surface)); }
        .nav-link { width: 100%; text-align: left; border: 1px solid transparent; border-radius: 12px; padding: 11px 12px; background: transparent; color: var(--vscode-foreground); font-weight: 600; }
        .nav-link.active { background: color-mix(in srgb, var(--atlas-accent) 22%, transparent); border-color: color-mix(in srgb, var(--atlas-accent) 48%, var(--atlas-border)); }
        .nav-link.hidden-by-search { display: none; }
        .panel-page { display: none; }
        .panel-page.active { display: block; }
        .action-grid { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .action-card, .content-card {
          border: 1px solid var(--atlas-border);
          border-radius: 16px;
          padding: 16px;
          background: linear-gradient(180deg, var(--atlas-surface), var(--vscode-editor-background));
        }
        .action-card { display: flex; flex-direction: column; gap: 6px; text-align: left; }
        .action-primary { border-color: color-mix(in srgb, var(--atlas-accent) 42%, var(--atlas-border)); }
        .action-title { font-weight: 700; }
        .row { display: flex; gap: 10px; margin: 10px 0; }
        .primary-btn { font-weight: 600; }
        textarea {
          width: 100%;
          resize: vertical;
          color: var(--vscode-input-foreground);
          background: var(--vscode-input-background);
          border: 1px solid var(--vscode-input-border, var(--atlas-border));
          padding: 8px;
          font-family: var(--vscode-font-family, system-ui, sans-serif);
          border-radius: 12px;
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
          border: 1px solid var(--atlas-border);
          background: var(--vscode-input-background);
          word-break: break-word;
          line-height: 1.55;
          border-radius: 12px;
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
          margin-top: 6px;
        }
        .nav-link:hover, .nav-link:focus-visible, .action-card:hover, .action-card:focus-visible, button:focus-visible {
          outline: 2px solid var(--atlas-accent);
          outline-offset: 2px;
        }
        @media (max-width: 920px) {
          .panel-layout, .action-grid { grid-template-columns: 1fr; }
          .panel-nav { position: static; }
          .panel-hero { flex-direction: column; }
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
    || message.type === 'openChatView'
    || message.type === 'openSpecialistIntegrations'
    || message.type === 'openSettingsModels'
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
  const navButtons = Array.from(document.querySelectorAll('[data-page-target]'));
  const pages = Array.from(document.querySelectorAll('.panel-page'));
  const searchInput = document.getElementById('visionSearch');
  const searchStatus = document.getElementById('visionSearchStatus');
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

  function activatePage(pageId) {
    navButtons.forEach(button => {
      if (!(button instanceof HTMLButtonElement)) { return; }
      button.classList.toggle('active', button.dataset.pageTarget === pageId);
    });
    pages.forEach(page => {
      if (!(page instanceof HTMLElement)) { return; }
      const active = page.id === 'page-' + pageId;
      page.classList.toggle('active', active);
      page.hidden = !active;
    });
  }

  function updateSearch(query) {
    const normalized = typeof query === 'string' ? query.trim().toLowerCase() : '';
    let visiblePages = 0;
    navButtons.forEach(button => {
      if (!(button instanceof HTMLButtonElement)) { return; }
      const haystack = ((button.textContent || '') + ' ' + (button.dataset.search || '')).toLowerCase();
      const matches = normalized.length === 0 || haystack.includes(normalized);
      button.classList.toggle('hidden-by-search', !matches);
      if (matches) { visiblePages += 1; }
    });
    if (searchStatus instanceof HTMLElement) {
      if (normalized.length === 0) {
        searchStatus.textContent = 'Browse the workspace pages or search for the part of the vision flow you need.';
      } else if (visiblePages === 0) {
        searchStatus.textContent = 'No vision pages matched that search.';
      } else if (visiblePages === 1) {
        searchStatus.textContent = '1 vision page matched.';
      } else {
        searchStatus.textContent = visiblePages + ' vision pages matched.';
      }
    }
  }

  navButtons.forEach(button => {
    if (!(button instanceof HTMLButtonElement)) { return; }
    button.addEventListener('click', () => activatePage(button.dataset.pageTarget || 'overview'));
  });

  document.querySelectorAll('[data-nav-target]').forEach(button => {
    button.addEventListener('click', () => activatePage(button.getAttribute('data-nav-target') || 'overview'));
  });

  activatePage('overview');
  if (searchInput instanceof HTMLInputElement) {
    updateSearch(searchInput.value);
    searchInput.addEventListener('input', () => updateSearch(searchInput.value));
  }

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
  document.getElementById('open-chat-view')?.addEventListener('click', () => vscode.postMessage({ type: 'openChatView' }));
  document.getElementById('open-specialist-integrations')?.addEventListener('click', () => vscode.postMessage({ type: 'openSpecialistIntegrations' }));
  document.getElementById('open-settings-models')?.addEventListener('click', () => vscode.postMessage({ type: 'openSettingsModels' }));
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
      .replace(/[<]/g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderInline(text) {
    // Escape all HTML first so structural tags below operate on safe content.
    return escapeHtml(text)
      .replace(/\\[([^\\]]+)\\]\\(([^)\\s]+(?:#[^)]+)?)\\)/g, (_, label, target) => {
        // label and target are already HTML-escaped — do not double-escape.
        return '<a href="#" data-file-ref="' + target + '">' + label + ''<' + '/a>';
      })
      .replace(new RegExp('\`([^\`]+)\`', 'g'), '<code>$1' + '<' + '/code>')
      .replace(/[*][*]([^*]+)[*][*]/g, '<strong>$1' + '<' + '/strong>');
  }

  function renderMarkdown(text) {
    const blocks = text.replace(new RegExp('\\r\\n', 'g'), '\\n').split(new RegExp('\\n\\n+', 'g'));
    return blocks.map(block => {
      if (block.startsWith('\`\`\`') && block.endsWith('\`\`\`')) {
        const code = block
          .replace(new RegExp('^\`\`\`[a-zA-Z0-9_-]*\\n?'), '')
          .replace(new RegExp('\\n?\`\`\`$'), '');
        return '<pre><code>' + escapeHtml(code) + '<' + '/code><' + '/pre>';
      }
      const lines = block.split('\\n');
      if (lines.length >= 2 && lines[0].includes('|') && /^\\s*[|]?\\s*[-:]+/.test(lines[1])) {
        const rows = lines.map(line => line.split('|').map(cell => cell.trim()).filter(Boolean));
        const header = rows[0] || [];
        const body = rows.slice(2);
        return '<table><thead><tr>' + header.map(cell => '<th>' + renderInline(cell) + '<' + '/th>').join('') + '<' + '/tr><' + '/thead><tbody>' +
          body.map(row => '<tr>' + row.map(cell => '<td>' + renderInline(cell) + '<' + '/td>').join('') + '<' + '/tr>').join('') +
          '<' + '/tbody><' + '/table>';
      }
      if (lines.every(line => /^-\\s+/.test(line))) {
        return '<ul>' + lines.map(line => '<li>' + renderInline(line.replace(/^-\\s+/, '')) + '<' + '/li>').join('') + '<' + '/ul>';
      }
      if (lines.every(line => /^\\d+\\.\\s+/.test(line))) {
        return '<ol>' + lines.map(line => '<li>' + renderInline(line.replace(/^\\d+\\.\\s+/, '')) + '<' + '/li>').join('') + '<' + '/ol>';
      }
      if (/^#{1,3}\\s+/.test(lines[0] || '')) {
        const level = Math.min(3, (lines[0].match(/^#+/) || [''])[0].length);
        const content = renderInline((lines[0] || '').replace(/^#{1,3}\\s+/, ''));
        return '<h' + level + '>' + content + '<' + '/h' + level + '>';
      }
      return '<p>' + lines.map(renderInline).join('<br>') + '<' + '/p>';
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