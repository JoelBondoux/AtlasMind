import * as path from 'path';
import * as vscode from 'vscode';
import type { AtlasMindContext } from '../extension.js';
import type { SessionConversationSummary, SessionThoughtSummary, SessionTranscriptEntry } from '../chat/sessionConversation.js';
import type { ProjectRunRecord, TaskImageAttachment } from '../types.js';
import {
  buildAssistantResponseMetadata,
  buildProjectResponseMetadata,
  resolveProjectExecutionGoal,
  runProjectCommand,
  toApprovedProjectPrompt,
} from '../chat/participant.js';
import { resolvePickedImageAttachments } from '../chat/imageAttachments.js';
import { getWebviewHtmlShell } from './webviewUtils.js';

type ComposerSendMode = 'send' | 'steer' | 'new-chat' | 'new-session';

type ChatPanelMessage =
  | { type: 'submitPrompt'; payload: { prompt: string; mode: ComposerSendMode } }
  | { type: 'clearConversation' }
  | { type: 'copyTranscript' }
  | { type: 'saveTranscript' }
  | { type: 'createSession' }
  | { type: 'selectSession'; payload: string }
  | { type: 'deleteSession'; payload: string }
  | { type: 'openProjectRun'; payload: string }
  | { type: 'openProjectRunCenter'; payload: string }
  | { type: 'pickAttachments' }
  | { type: 'attachOpenFile'; payload: string }
  | { type: 'attachOpenFiles' }
  | { type: 'removeAttachment'; payload: string }
  | { type: 'clearAttachments' }
  | { type: 'addDroppedItems'; payload: string[] };

interface ChatComposerAttachment {
  id: string;
  label: string;
  kind: 'text' | 'image' | 'audio' | 'video' | 'url' | 'binary';
  source: string;
  uri?: vscode.Uri;
  inlineText?: string;
  mimeType?: string;
  imageAttachment?: TaskImageAttachment;
}

interface ChatPanelOpenFileLink {
  path: string;
  isActive: boolean;
}

interface ChatPanelRunSummary {
  id: string;
  goal: string;
  status: string;
  updatedAt: string;
  currentBatch: number;
  totalBatches: number;
  paused: boolean;
  awaitingBatchApproval: boolean;
  failedSubtaskTitles: string[];
  logs: Array<{ timestamp: string; level: string; message: string }>;
  subTaskArtifacts: Array<{
    subTaskId: string;
    title: string;
    role: string;
    status: string;
    outputPreview: string;
    changedFiles: Array<{ relativePath: string; status: string }>;
  }>;
}

interface ChatPanelState {
  activeSurface: 'chat' | 'run';
  selectedSessionId: string;
  sessions: SessionConversationSummary[];
  transcript: SessionTranscriptEntry[];
  attachments: Array<{ id: string; label: string; kind: string; source: string }>;
  openFiles: ChatPanelOpenFileLink[];
  projectRuns: Array<{
    id: string;
    goal: string;
    status: string;
    updatedAt: string;
    completedSubtaskCount: number;
    totalSubtaskCount: number;
    paused: boolean;
    awaitingBatchApproval: boolean;
  }>;
  selectedRun?: ChatPanelRunSummary;
}

export class ChatPanel {
  public static currentPanel: ChatPanel | undefined;
  private static readonly viewType = 'atlasmind.chatPanel';

  private readonly host: vscode.WebviewPanel | vscode.WebviewView;
  private readonly disposables: vscode.Disposable[] = [];
  private selectedSessionId: string;
  private selectedRunId: string | undefined;
  private activeSurface: 'chat' | 'run' = 'chat';
  private composerAttachments: ChatComposerAttachment[] = [];
  private readonly onDisposed?: () => void;

  public static createOrShow(context: vscode.ExtensionContext, atlas: AtlasMindContext, selectedSessionId?: string): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (ChatPanel.currentPanel) {
      if (selectedSessionId) {
        void ChatPanel.currentPanel.showChatSession(selectedSessionId);
      }
      if ('reveal' in ChatPanel.currentPanel.host) {
        ChatPanel.currentPanel.host.reveal(column);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ChatPanel.viewType,
      'AtlasMind Chat',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );

    ChatPanel.currentPanel = new ChatPanel(panel, context.extensionUri, atlas, selectedSessionId, () => {
      ChatPanel.currentPanel = undefined;
    });
  }

  constructor(
    host: vscode.WebviewPanel | vscode.WebviewView,
    private readonly extensionUri: vscode.Uri,
    private readonly atlas: AtlasMindContext,
    selectedSessionId?: string,
    onDisposed?: () => void,
  ) {
    this.host = host;
    this.onDisposed = onDisposed;
    this.selectedSessionId = selectedSessionId && atlas.sessionConversation.selectSession(selectedSessionId)
      ? selectedSessionId
      : atlas.sessionConversation.getActiveSessionId();
    this.host.webview.html = this.getHtml();

    this.host.onDidDispose(() => this.dispose(), null, this.disposables);
    this.host.webview.onDidReceiveMessage(message => {
      void this.handleMessage(message);
    }, null, this.disposables);

    this.atlas.sessionConversation.onDidChange(() => {
      if (this.activeSurface === 'chat') {
        this.selectedSessionId = this.atlas.sessionConversation.getActiveSessionId();
      }
      void this.syncState();
    }, null, this.disposables);
    this.atlas.projectRunsRefresh.event(() => {
      void this.syncState();
    }, null, this.disposables);
    vscode.window.onDidChangeVisibleTextEditors(() => {
      void this.syncState();
    }, null, this.disposables);
    vscode.window.onDidChangeActiveTextEditor(() => {
      void this.syncState();
    }, null, this.disposables);

    void this.syncState();
  }

  public dispose(): void {
    this.onDisposed?.();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  public async showChatSession(sessionId?: string): Promise<void> {
    if (sessionId && this.atlas.sessionConversation.selectSession(sessionId)) {
      this.selectedSessionId = sessionId;
    }
    this.activeSurface = 'chat';
    await this.syncState();
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isChatPanelMessage(message)) {
      return;
    }

    switch (message.type) {
      case 'submitPrompt':
        await this.runPrompt(message.payload.prompt, message.payload.mode);
        return;
      case 'clearConversation':
        this.atlas.sessionConversation.clearSession(this.selectedSessionId);
        await this.host.webview.postMessage({ type: 'status', payload: 'Conversation cleared for the selected session.' });
        return;
      case 'copyTranscript':
        await vscode.env.clipboard.writeText(await this.renderActiveSurfaceMarkdown());
        await this.host.webview.postMessage({ type: 'status', payload: 'Copied the current session view to the clipboard.' });
        return;
      case 'saveTranscript':
        await this.saveTranscript();
        return;
      case 'createSession': {
        this.selectedSessionId = this.atlas.sessionConversation.createSession();
        this.activeSurface = 'chat';
        await this.host.webview.postMessage({ type: 'status', payload: 'Created a new chat session.' });
        return;
      }
      case 'selectSession':
        if (this.atlas.sessionConversation.selectSession(message.payload)) {
          this.selectedSessionId = message.payload;
          this.activeSurface = 'chat';
          await this.syncState();
        }
        return;
      case 'deleteSession':
        this.atlas.sessionConversation.deleteSession(message.payload);
        this.selectedSessionId = this.atlas.sessionConversation.getActiveSessionId();
        this.activeSurface = 'chat';
        await this.host.webview.postMessage({ type: 'status', payload: 'Deleted the selected chat session.' });
        return;
      case 'openProjectRun':
        this.selectedRunId = message.payload;
        this.activeSurface = 'run';
        await this.syncState();
        return;
      case 'openProjectRunCenter':
        await vscode.commands.executeCommand('atlasmind.openProjectRunCenter', message.payload);
        return;
      case 'pickAttachments':
        await this.pickAttachments();
        return;
      case 'attachOpenFile':
        await this.attachOpenFile(message.payload);
        return;
      case 'attachOpenFiles':
        await this.attachOpenFiles();
        return;
      case 'removeAttachment':
        this.composerAttachments = this.composerAttachments.filter(item => item.id !== message.payload);
        await this.syncState();
        return;
      case 'clearAttachments':
        this.composerAttachments = [];
        await this.syncState();
        return;
      case 'addDroppedItems':
        await this.addDroppedItems(message.payload);
        return;
    }
  }

  private async runPrompt(rawPrompt: string, mode: ComposerSendMode): Promise<void> {
    const prompt = rawPrompt.trim();
    if (!prompt) {
      await this.host.webview.postMessage({ type: 'status', payload: 'Enter a prompt before sending a chat request.' });
      return;
    }

    if (this.activeSurface !== 'chat') {
      await this.host.webview.postMessage({ type: 'status', payload: 'Select a chat session before sending a prompt.' });
      return;
    }

    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const activeSessionId = mode === 'new-session'
      ? this.atlas.sessionConversation.createSession()
      : this.selectedSessionId;
    if (mode === 'new-chat') {
      this.atlas.sessionConversation.clearSession(activeSessionId);
    }
    const sessionContext = this.atlas.sessionConversation.buildContext({
      maxTurns: configuration.get<number>('chatSessionTurnLimit', 6),
      maxChars: configuration.get<number>('chatSessionContextChars', 2500),
      sessionId: activeSessionId,
    });

    this.selectedSessionId = activeSessionId;
    this.activeSurface = 'chat';
    this.atlas.sessionConversation.selectSession(activeSessionId);
    this.atlas.sessionConversation.appendMessage('user', prompt, activeSessionId);
    const submittedAttachments = [...this.composerAttachments];
    this.composerAttachments = [];
    const preparedRequest = this.preparePromptRequest(
      prompt,
      submittedAttachments,
      mode,
      sessionContext,
      activeSessionId,
    );
    const assistantMessageId = this.atlas.sessionConversation.appendMessage(
      'assistant',
      '',
      activeSessionId,
      preparedRequest.projectGoal ? buildProjectResponseMetadata(preparedRequest.projectGoal) : undefined,
    );

    await this.syncState();
    await this.host.webview.postMessage({ type: 'busy', payload: true });
    await this.host.webview.postMessage({ type: 'status', payload: 'Running AtlasMind chat request...' });

    let streamed = false;
    try {
      if (preparedRequest.projectGoal) {
        await this.runProjectPrompt(preparedRequest.projectGoal, assistantMessageId, activeSessionId, submittedAttachments);
        await this.host.webview.postMessage({ type: 'status', payload: 'Autonomous project run completed.' });
        return;
      }

      const result = await this.atlas.orchestrator.processTask({
        id: `chat-panel-${Date.now()}`,
        userMessage: preparedRequest.userMessage,
        context: preparedRequest.context,
        constraints: {
          budget: toBudgetMode(configuration.get<string>('budgetMode')),
          speed: toSpeedMode(configuration.get<string>('speedMode')),
          ...(preparedRequest.imageAttachments.length > 0 ? { requiredCapabilities: ['vision' as const] } : {}),
        },
        timestamp: new Date().toISOString(),
      }, async chunk => {
        if (!chunk) {
          return;
        }
        streamed = true;
        const current = this.atlas.sessionConversation
          .getTranscript(activeSessionId)
          .find(entry => entry.id === assistantMessageId)?.content ?? '';
        this.atlas.sessionConversation.updateMessage(assistantMessageId, current + chunk, activeSessionId);
        await this.syncState();
      });

      if (!streamed) {
        this.atlas.sessionConversation.updateMessage(
          assistantMessageId,
          result.response,
          activeSessionId,
          buildAssistantResponseMetadata(preparedRequest.userMessage, result, { hasSessionContext: Boolean(sessionContext) }),
        );
        await this.syncState();
      } else {
        const current = this.atlas.sessionConversation
          .getTranscript(activeSessionId)
          .find(entry => entry.id === assistantMessageId)?.content ?? '';
        this.atlas.sessionConversation.updateMessage(
          assistantMessageId,
          current,
          activeSessionId,
          buildAssistantResponseMetadata(preparedRequest.userMessage, result, { hasSessionContext: Boolean(sessionContext) }),
        );
        await this.syncState();
      }

      if (configuration.get<boolean>('voice.ttsEnabled', false)) {
        this.atlas.voiceManager.speak(result.response);
      }
      await this.host.webview.postMessage({ type: 'status', payload: `Response ready via ${result.modelUsed}.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.atlas.sessionConversation.updateMessage(assistantMessageId, `Request failed: ${message}`, activeSessionId);
      await this.syncState();
      await this.host.webview.postMessage({ type: 'status', payload: `Chat request failed: ${message}` });
    } finally {
      await this.host.webview.postMessage({ type: 'busy', payload: false });
    }
  }

  private async runProjectPrompt(
    projectGoal: string,
    assistantMessageId: string,
    activeSessionId: string,
    attachments: ChatComposerAttachment[],
  ): Promise<void> {
    await this.appendAssistantMessage(
      assistantMessageId,
      activeSessionId,
      '### Autonomous Run\n\nContinuing in project execution mode.',
    );
    if (attachments.length > 0) {
      await this.appendAssistantMessage(
        assistantMessageId,
        activeSessionId,
        `Attached context: ${attachments.map(item => item.label).join(', ')}`,
      );
    }

    const sink = {
      markdown: async (value: string) => {
        await this.appendAssistantMessage(assistantMessageId, activeSessionId, value);
      },
      progress: async (value: string) => {
        await this.appendAssistantMessage(assistantMessageId, activeSessionId, `Status: ${value}`);
      },
      button: async (button: { title: string }) => {
        await this.appendAssistantMessage(assistantMessageId, activeSessionId, `[Action available: ${button.title}]`);
      },
      reference: async (uri: vscode.Uri) => {
        await this.appendAssistantMessage(
          assistantMessageId,
          activeSessionId,
          `[Reference: ${vscode.workspace.asRelativePath(uri, false)}]`,
        );
      },
    } as unknown as vscode.ChatResponseStream;

    await runProjectCommand(
      toApprovedProjectPrompt(projectGoal),
      sink,
      createIdleCancellationToken(),
      this.atlas,
    );
  }

  private async appendAssistantMessage(assistantMessageId: string, sessionId: string, fragment: string): Promise<void> {
    const current = this.atlas.sessionConversation
      .getTranscript(sessionId)
      .find(entry => entry.id === assistantMessageId)?.content ?? '';
    const next = current.length > 0 ? `${current}\n\n${fragment}` : fragment;
    this.atlas.sessionConversation.updateMessage(assistantMessageId, next, sessionId);
    await this.syncState();
  }

  private async syncState(): Promise<void> {
    const sessions = this.atlas.sessionConversation.listSessions();
    if (!sessions.some(session => session.id === this.selectedSessionId)) {
      this.selectedSessionId = this.atlas.sessionConversation.getActiveSessionId();
      this.activeSurface = 'chat';
    }

    const projectRuns = await this.atlas.projectRunHistory.listRunsAsync(20);
    if (this.activeSurface === 'run' && this.selectedRunId && !projectRuns.some(run => run.id === this.selectedRunId)) {
      this.activeSurface = 'chat';
      this.selectedRunId = undefined;
    }

    const selectedRun = this.activeSurface === 'run' && this.selectedRunId
      ? projectRuns.find(run => run.id === this.selectedRunId)
      : undefined;

    const payload: ChatPanelState = {
      activeSurface: this.activeSurface,
      selectedSessionId: this.selectedSessionId,
      sessions,
      transcript: this.atlas.sessionConversation.getTranscript(this.selectedSessionId),
      attachments: this.composerAttachments.map(item => ({ id: item.id, label: item.label, kind: item.kind, source: item.source })),
      openFiles: getOpenWorkspaceFiles(),
      projectRuns: projectRuns.map(run => ({
        id: run.id,
        goal: run.goal,
        status: run.status,
        updatedAt: run.updatedAt,
        completedSubtaskCount: run.completedSubtaskCount,
        totalSubtaskCount: run.totalSubtaskCount,
        paused: run.paused,
        awaitingBatchApproval: run.awaitingBatchApproval,
      })),
      selectedRun: selectedRun ? toRunSummary(selectedRun) : undefined,
    };

    await this.host.webview.postMessage({ type: 'state', payload });
  }

  private preparePromptRequest(
    prompt: string,
    attachments: ChatComposerAttachment[],
    mode: ComposerSendMode,
    sessionContext: string,
    activeSessionId: string,
  ): { userMessage: string; projectGoal?: string; context: Record<string, unknown>; imageAttachments: TaskImageAttachment[] } {
    const forceSteer = mode === 'steer';
    const projectGoal = forceSteer
      ? normalizeProjectGoal(prompt)
      : resolveProjectExecutionGoal(prompt, this.atlas.sessionConversation.getTranscript(activeSessionId));
    const imageAttachments = attachments
      .map(item => item.imageAttachment)
      .filter((item): item is TaskImageAttachment => Boolean(item));
    const attachmentNote = buildAttachmentContextBlock(attachments);
    const userMessage = attachmentNote ? `${prompt}\n\n${attachmentNote}` : prompt;
    const context: Record<string, unknown> = {
      ...(sessionContext ? { sessionContext } : {}),
      ...(imageAttachments.length > 0 ? { imageAttachments } : {}),
    };

    return {
      userMessage,
      projectGoal: projectGoal ? (attachmentNote ? `${projectGoal}\n\n${attachmentNote}` : projectGoal) : undefined,
      context,
      imageAttachments,
    };
  }

  private async pickAttachments(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      await this.host.webview.postMessage({ type: 'status', payload: 'Open a workspace folder first to attach files.' });
      return;
    }

    const selected = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFiles: true,
      canSelectFolders: false,
      defaultUri: workspaceFolder.uri,
      openLabel: 'Attach files to AtlasMind Chat',
    });
    if (!selected || selected.length === 0) {
      return;
    }

    await this.addAttachmentUris(selected);
  }

  private async attachOpenFiles(): Promise<void> {
    const openFiles = getOpenWorkspaceFileUris();
    if (openFiles.length === 0) {
      await this.host.webview.postMessage({ type: 'status', payload: 'No open workspace files are available to attach.' });
      return;
    }
    await this.addAttachmentUris(openFiles);
  }

  private async attachOpenFile(relativePath: string): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return;
    }
    await this.addAttachmentUris([vscode.Uri.file(path.resolve(workspaceRoot, relativePath))]);
  }

  private async addDroppedItems(items: string[]): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return;
    }

    const uris: vscode.Uri[] = [];
    const urlAttachments: ChatComposerAttachment[] = [];
    for (const rawItem of items) {
      const item = rawItem.trim();
      if (!item) {
        continue;
      }
      if (looksLikeUrl(item)) {
        urlAttachments.push({ id: `url:${item}`, label: item, kind: 'url', source: item });
        continue;
      }
      const fileUri = coerceWorkspaceFileUri(item, workspaceRoot);
      if (fileUri) {
        uris.push(fileUri);
      }
    }

    await this.addAttachmentUris(uris, urlAttachments);
  }

  private async addAttachmentUris(uris: readonly vscode.Uri[], extra: ChatComposerAttachment[] = []): Promise<void> {
    const nextAttachments = [...this.composerAttachments];
    for (const attachment of extra) {
      if (!nextAttachments.some(existing => existing.id === attachment.id)) {
        nextAttachments.push(attachment);
      }
    }

    const imageAttachments = await resolvePickedImageAttachments(uris);
    const imageByPath = new Map(imageAttachments.map(item => [item.source, item]));
    for (const uri of uris) {
      const relativePath = vscode.workspace.asRelativePath(uri, false);
      const attachment = await buildComposerAttachment(uri, imageByPath.get(relativePath));
      if (!attachment) {
        continue;
      }
      if (!nextAttachments.some(existing => existing.id === attachment.id)) {
        nextAttachments.push(attachment);
      }
    }

    this.composerAttachments = nextAttachments.slice(0, 12);
    await this.syncState();
  }

  private async saveTranscript(): Promise<void> {
    const markdown = await this.renderActiveSurfaceMarkdown();
    if (!markdown) {
      await this.host.webview.postMessage({ type: 'status', payload: 'No session content available yet.' });
      return;
    }

    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: markdown,
    });
    await vscode.window.showTextDocument(document, { preview: false });
    await this.host.webview.postMessage({ type: 'status', payload: 'Opened the current session in a markdown editor.' });
  }

  private async renderActiveSurfaceMarkdown(): Promise<string> {
    if (this.activeSurface === 'run' && this.selectedRunId) {
      const run = await this.atlas.projectRunHistory.getRunAsync(this.selectedRunId);
      return run ? renderRunMarkdown(run) : '';
    }

    return renderTranscriptMarkdown(
      this.atlas.sessionConversation.getSession(this.selectedSessionId)?.title ?? 'AtlasMind Chat',
      this.atlas.sessionConversation.getTranscript(this.selectedSessionId),
    );
  }

  private getHtml(): string {
    return getWebviewHtmlShell({
      title: 'AtlasMind Chat',
      cspSource: this.host.webview.cspSource,
      bodyContent: `
        <div class="chat-shell">
          <aside class="session-rail">
            <div class="rail-header">
              <div>
                <div class="eyebrow">Workspace</div>
                <h1>Sessions</h1>
              </div>
              <button id="createSession" class="icon-btn" title="New chat session">+</button>
            </div>
            <div class="rail-section-label">Chat Threads</div>
            <div id="sessionList" class="session-list"></div>
            <div class="rail-section-label">Autonomous Runs</div>
            <div id="runList" class="session-list"></div>
          </aside>
          <main class="main-panel">
            <section class="panel-header">
              <div>
                <div class="eyebrow">Dedicated Workspace</div>
                <h2 id="panelTitle">AtlasMind Chat</h2>
                <p id="panelSubtitle" class="panel-subtitle">Use AtlasMind in a dedicated conversation surface without relying on VS Code's built-in chat view.</p>
              </div>
              <div class="row toolbar-row">
                <button id="clearConversation">Clear</button>
                <button id="copyTranscript">Copy</button>
                <button id="saveTranscript">Open as Markdown</button>
              </div>
            </section>
            <div id="status" class="status-label">Ready.</div>
            <section id="transcript" class="chat-transcript" aria-live="polite"></section>
            <section id="runInspector" class="run-inspector hidden"></section>
            <section class="composer-shell">
              <div class="row toolbar-row composer-tools">
                <div class="attach-row">
                  <button id="attachFiles" class="icon-btn compact-icon-btn" title="Add files" aria-label="Add files">+</button>
                  <button id="attachOpenFiles" class="icon-btn compact-icon-btn" title="Add open files" aria-label="Add open files">[]</button>
                  <button id="clearAttachments" class="icon-btn compact-icon-btn" title="Clear attachments" aria-label="Clear attachments">x</button>
                </div>
              </div>
              <div id="openFilesSection" class="composer-section hidden">
                <div class="rail-section-label compact-section-label">Open Files</div>
                <div id="openFileLinks" class="chip-row"></div>
              </div>
              <div id="attachmentsSection" class="composer-section hidden">
                <div class="rail-section-label compact-section-label">Attachments</div>
                <div id="attachmentList" class="chip-row attachment-row"></div>
              </div>
              <div id="dropHint" class="drop-hint">Drop code files, images, audio, video, or URLs onto the composer to attach them.</div>
              <textarea id="promptInput" rows="5" placeholder="Ask AtlasMind to plan, explain, inspect, or implement something…"></textarea>
              <div class="row toolbar-row composer-row">
                <div class="send-group">
                  <select id="sendMode" aria-label="Choose send mode">
                    <option value="send">Send</option>
                    <option value="steer">Steer</option>
                    <option value="new-chat">New Chat</option>
                    <option value="new-session">New Session</option>
                  </select>
                  <button id="sendPrompt" class="primary-btn">Send</button>
                </div>
                <span id="composerHint" class="hint-label">Enter sends with the selected mode. Shift+Enter adds a newline.</span>
              </div>
            </section>
          </main>
        </div>
      `,
      extraCss: `
        .chat-shell {
          display: grid;
          grid-template-columns: 290px minmax(0, 1fr);
          min-height: 78vh;
          gap: 18px;
        }
        .session-rail {
          border-right: 1px solid var(--vscode-sideBar-border, var(--vscode-widget-border, #444));
          padding-right: 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .rail-header, .panel-header, .row {
          display: flex;
          gap: 10px;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
        }
        .eyebrow {
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--vscode-descriptionForeground);
        }
        h1, h2 {
          margin: 4px 0;
          font-size: 1.15rem;
        }
        .panel-subtitle, .hint-label, .status-label, .session-meta, .empty-state {
          color: var(--vscode-descriptionForeground);
        }
        .session-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 28vh;
          overflow-y: auto;
          padding-right: 4px;
        }
        .rail-section-label {
          margin-top: 6px;
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--vscode-descriptionForeground);
        }
        .session-item {
          width: 100%;
          text-align: left;
          border: 1px solid var(--vscode-widget-border, #444);
          background: var(--vscode-sideBar-background, var(--vscode-editor-background));
          border-radius: 10px;
          padding: 10px 12px;
          cursor: pointer;
          color: inherit;
        }
        .session-item.active {
          border-color: var(--vscode-focusBorder, var(--vscode-button-background));
          background: color-mix(in srgb, var(--vscode-button-background) 12%, transparent);
        }
        .session-item-title {
          font-weight: 600;
          margin-bottom: 6px;
        }
        .session-item-preview {
          font-size: 0.92em;
          color: var(--vscode-descriptionForeground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .session-item-actions {
          display: flex;
          justify-content: flex-end;
          margin-top: 8px;
        }
        .main-panel {
          display: flex;
          flex-direction: column;
          gap: 12px;
          min-width: 0;
        }
        .toolbar-row { margin-bottom: 0; }
        .composer-tools, .attach-row, .send-group, .chip-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }
        .composer-tools {
          justify-content: flex-start;
          margin-bottom: 6px;
        }
        .composer-section {
          margin: 0 0 6px;
        }
        .compact-section-label {
          margin-top: 0;
          margin-bottom: 4px;
          font-size: 0.72rem;
        }
        .send-group select {
          min-width: 124px;
          padding: 8px 10px;
          color: var(--vscode-input-foreground);
          background: var(--vscode-input-background);
          border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #444));
          border-radius: 8px;
        }
        .attachment-row {
          min-height: 0;
        }
        .chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: 1px solid var(--vscode-widget-border, #444);
          border-radius: 999px;
          padding: 6px 10px;
          background: color-mix(in srgb, var(--vscode-editor-background) 92%, white 8%);
          font-size: 0.92em;
        }
        .chip button {
          padding: 0;
          min-width: auto;
          border: 0;
          background: transparent;
          color: inherit;
          cursor: pointer;
        }
        .compact-icon-btn {
          min-width: 32px;
          min-height: 32px;
          width: 32px;
          height: 32px;
          padding: 0;
          font-size: 0.9rem;
        }
        .open-file-chip {
          cursor: pointer;
        }
        .drop-hint {
          margin: 4px 0 8px;
          padding: 8px 10px;
          border: 1px dashed var(--vscode-widget-border, #444);
          border-radius: 10px;
          color: var(--vscode-descriptionForeground);
          font-size: 0.92em;
        }
        .drop-hint.dragover, .composer-shell.dragover {
          border-color: var(--vscode-focusBorder, var(--vscode-button-background));
          background: color-mix(in srgb, var(--vscode-button-background) 10%, transparent);
        }
        .chat-transcript, .run-inspector {
          display: flex;
          flex-direction: column;
          gap: 12px;
          min-height: 320px;
          max-height: 52vh;
          overflow-y: auto;
          padding: 14px;
          border: 1px solid var(--vscode-widget-border, #444);
          border-radius: 12px;
          background: color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-editorHoverWidget-background, #111) 8%);
        }
        .chat-message {
          padding: 12px 14px;
          border-radius: 12px;
          border: 1px solid var(--vscode-widget-border, #444);
          white-space: pre-wrap;
          word-break: break-word;
        }
        .chat-message-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 8px;
          flex-wrap: wrap;
        }
        .chat-message.user {
          align-self: flex-end;
          width: min(92%, 760px);
          background: color-mix(in srgb, var(--vscode-button-background) 16%, transparent);
        }
        .chat-message.assistant {
          align-self: flex-start;
          width: min(96%, 820px);
          background: color-mix(in srgb, var(--vscode-editorHoverWidget-background, var(--vscode-editor-background)) 78%, white 8%);
        }
        .chat-message.pending {
          border-color: color-mix(in srgb, var(--vscode-focusBorder, var(--vscode-button-background)) 60%, var(--vscode-widget-border, #444));
          box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-button-background) 12%, transparent);
        }
        .chat-role {
          font-size: 0.8em;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--vscode-descriptionForeground);
        }
        .chat-model-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 999px;
          border: 1px solid var(--vscode-widget-border, #444);
          background: color-mix(in srgb, var(--vscode-button-background) 12%, transparent);
          font-size: 0.78rem;
          color: var(--vscode-foreground);
        }
        .chat-content {
          white-space: pre-wrap;
          word-break: break-word;
        }
        .thought-details {
          margin-top: 10px;
          border-top: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 78%, transparent);
          padding-top: 10px;
        }
        .thought-details summary {
          cursor: pointer;
          color: var(--vscode-textLink-foreground, var(--vscode-foreground));
          font-weight: 600;
          list-style: none;
        }
        .thought-details summary::-webkit-details-marker {
          display: none;
        }
        .thought-details summary::before {
          content: '▸';
          display: inline-block;
          margin-right: 8px;
          transition: transform 120ms ease;
        }
        .thought-details[open] summary::before {
          transform: rotate(90deg);
        }
        .thought-summary {
          margin: 10px 0 0;
          color: var(--vscode-descriptionForeground);
        }
        .thought-list {
          margin: 10px 0 0 18px;
          padding: 0;
        }
        .thought-list li {
          margin: 6px 0;
        }
        .thinking-indicator {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 78%, transparent);
        }
        .thinking-indicator.compact {
          margin-top: 12px;
        }
        .thinking-logo {
          position: relative;
          width: 34px;
          height: 34px;
          flex: 0 0 34px;
        }
        .thinking-logo::before {
          content: '';
          position: absolute;
          inset: -5px;
          border-radius: 999px;
          background: radial-gradient(circle, color-mix(in srgb, var(--vscode-button-background) 24%, transparent) 0%, transparent 72%);
          animation: atlas-glow 1.8s ease-in-out infinite;
        }
        .thinking-logo svg {
          position: relative;
          width: 100%;
          height: 100%;
          color: var(--vscode-button-background);
          animation: atlas-float 1.8s ease-in-out infinite;
        }
        .thinking-logo .atlas-outline {
          opacity: 0.9;
        }
        .thinking-logo .atlas-axis {
          transform-origin: 12px 12px;
          animation: atlas-spin 2.6s linear infinite;
          transform-box: fill-box;
        }
        .thinking-copy {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .thinking-title {
          font-weight: 600;
        }
        .thinking-subtitle {
          color: var(--vscode-descriptionForeground);
          font-size: 0.92em;
        }
        @keyframes atlas-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes atlas-float {
          0%, 100% { transform: scale(0.96); opacity: 0.88; }
          50% { transform: scale(1.04); opacity: 1; }
        }
        @keyframes atlas-glow {
          0%, 100% { opacity: 0.28; transform: scale(0.92); }
          50% { opacity: 0.75; transform: scale(1.08); }
        }
        .composer-shell {
          border: 1px solid var(--vscode-widget-border, #444);
          border-radius: 12px;
          padding: 10px;
          background: color-mix(in srgb, var(--vscode-editor-background) 94%, white 6%);
        }
        textarea {
          width: 100%;
          box-sizing: border-box;
          resize: vertical;
          min-height: 92px;
          padding: 10px 12px;
          color: var(--vscode-input-foreground);
          background: var(--vscode-input-background);
          border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #444));
          border-radius: 8px;
        }
        .composer-row {
          margin-top: 8px;
          align-items: center;
        }
        .run-card {
          border: 1px solid var(--vscode-widget-border, #444);
          border-radius: 10px;
          padding: 12px;
          background: color-mix(in srgb, var(--vscode-editor-background) 90%, white 10%);
        }
        .run-card h3, .run-card h4 { margin: 0 0 8px; }
        .run-status-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 999px;
          border: 1px solid var(--vscode-widget-border, #444);
          font-size: 0.9em;
        }
        .run-log-list, .subtask-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .subtask-item {
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid var(--vscode-widget-border, #444);
          background: color-mix(in srgb, var(--vscode-sideBar-background, var(--vscode-editor-background)) 78%, transparent);
        }
        .hidden { display: none; }
        .icon-btn {
          min-width: 34px;
          min-height: 34px;
          border-radius: 999px;
          font-size: 1.1rem;
        }
        @media (max-width: 980px) {
          .chat-shell {
            grid-template-columns: 1fr;
          }
          .session-rail {
            border-right: 0;
            border-bottom: 1px solid var(--vscode-sideBar-border, var(--vscode-widget-border, #444));
            padding-right: 0;
            padding-bottom: 14px;
          }
        }
      `,
      scriptContent: `
        const vscode = acquireVsCodeApi();
        const sessionList = document.getElementById('sessionList');
        const runList = document.getElementById('runList');
        const transcript = document.getElementById('transcript');
        const runInspector = document.getElementById('runInspector');
        const promptInput = document.getElementById('promptInput');
        const status = document.getElementById('status');
        const sendPrompt = document.getElementById('sendPrompt');
        const sendMode = document.getElementById('sendMode');
        const attachFiles = document.getElementById('attachFiles');
        const attachOpenFiles = document.getElementById('attachOpenFiles');
        const clearAttachments = document.getElementById('clearAttachments');
        const attachmentsSection = document.getElementById('attachmentsSection');
        const openFilesSection = document.getElementById('openFilesSection');
        const attachmentList = document.getElementById('attachmentList');
        const openFileLinks = document.getElementById('openFileLinks');
        const dropHint = document.getElementById('dropHint');
        const composerShell = document.querySelector('.composer-shell');
        const clearConversation = document.getElementById('clearConversation');
        const copyTranscript = document.getElementById('copyTranscript');
        const saveTranscript = document.getElementById('saveTranscript');
        const createSession = document.getElementById('createSession');
        const panelTitle = document.getElementById('panelTitle');
        const panelSubtitle = document.getElementById('panelSubtitle');
        const composerHint = document.getElementById('composerHint');
        let latestState = undefined;
        let isBusy = false;

        function renderSessions(sessions, selectedSessionId) {
          sessionList.innerHTML = '';
          if (!Array.isArray(sessions) || sessions.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = 'No chat sessions yet. Create one to start working.';
            sessionList.appendChild(empty);
            return;
          }

          for (const session of sessions) {
            const button = document.createElement('button');
            button.className = 'session-item' + (session.id === selectedSessionId ? ' active' : '');
            button.dataset.sessionId = session.id;

            const title = document.createElement('div');
            title.className = 'session-item-title';
            title.textContent = session.title;

            const meta = document.createElement('div');
            meta.className = 'session-meta';
            meta.textContent = session.turnCount + ' turn' + (session.turnCount === 1 ? '' : 's');

            const preview = document.createElement('div');
            preview.className = 'session-item-preview';
            preview.textContent = session.preview;

            const actions = document.createElement('div');
            actions.className = 'session-item-actions';
            const remove = document.createElement('button');
            remove.textContent = 'Delete';
            remove.addEventListener('click', event => {
              event.stopPropagation();
              vscode.postMessage({ type: 'deleteSession', payload: session.id });
            });
            actions.appendChild(remove);

            button.appendChild(title);
            button.appendChild(meta);
            button.appendChild(preview);
            button.appendChild(actions);
            button.addEventListener('click', () => {
              vscode.postMessage({ type: 'selectSession', payload: session.id });
            });
            sessionList.appendChild(button);
          }
        }

        function describeRun(run) {
          if (run.awaitingBatchApproval) {
            return 'Awaiting approval';
          }
          if (run.paused) {
            return 'Paused';
          }
          return run.status;
        }

        function renderRuns(runs, selectedRunId) {
          runList.innerHTML = '';
          if (!Array.isArray(runs) || runs.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = 'No autonomous runs recorded yet.';
            runList.appendChild(empty);
            return;
          }

          for (const run of runs) {
            const button = document.createElement('button');
            button.className = 'session-item' + (run.id === selectedRunId ? ' active' : '');
            button.dataset.runId = run.id;

            const title = document.createElement('div');
            title.className = 'session-item-title';
            title.textContent = run.goal;

            const meta = document.createElement('div');
            meta.className = 'session-meta';
            meta.textContent = describeRun(run) + ' • ' + run.completedSubtaskCount + '/' + run.totalSubtaskCount;

            button.appendChild(title);
            button.appendChild(meta);
            button.addEventListener('click', () => {
              vscode.postMessage({ type: 'openProjectRun', payload: run.id });
            });
            runList.appendChild(button);
          }
        }

        function renderAttachments(attachments) {
          const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
          attachmentsSection.classList.toggle('hidden', !hasAttachments);
          attachmentList.innerHTML = '';
          if (!hasAttachments) {
            return;
          }

          for (const attachment of attachments) {
            const chip = document.createElement('div');
            chip.className = 'chip';
            chip.innerHTML = '<span>' + attachment.label + ' [' + attachment.kind + ']</span>';
            const remove = document.createElement('button');
            remove.textContent = '×';
            remove.title = 'Remove attachment';
            remove.addEventListener('click', () => {
              vscode.postMessage({ type: 'removeAttachment', payload: attachment.id });
            });
            chip.appendChild(remove);
            attachmentList.appendChild(chip);
          }
        }

        function renderOpenFiles(files) {
          const hasFiles = Array.isArray(files) && files.length > 0;
          openFilesSection.classList.toggle('hidden', !hasFiles);
          openFileLinks.innerHTML = '';
          if (!hasFiles) {
            return;
          }

          for (const file of files) {
            const chip = document.createElement('button');
            chip.className = 'chip open-file-chip' + (file.isActive ? ' active' : '');
            chip.textContent = file.path;
            chip.addEventListener('click', () => {
              vscode.postMessage({ type: 'attachOpenFile', payload: file.path });
            });
            openFileLinks.appendChild(chip);
          }
        }

        function collectDroppedItems(event) {
          const values = new Set();
          const uriList = event.dataTransfer.getData('text/uri-list');
          if (uriList) {
            for (const line of uriList.split(/\r?\n/)) {
              const trimmed = line.trim();
              if (trimmed && !trimmed.startsWith('#')) {
                values.add(trimmed);
              }
            }
          }
          const plainText = event.dataTransfer.getData('text/plain');
          if (plainText) {
            for (const line of plainText.split(/\r?\n/)) {
              const trimmed = line.trim();
              if (trimmed) {
                values.add(trimmed);
              }
            }
          }
          for (const file of Array.from(event.dataTransfer.files || [])) {
            if (file && typeof file.path === 'string' && file.path.length > 0) {
              values.add(file.path);
            } else if (file && typeof file.name === 'string' && file.name.length > 0) {
              values.add(file.name);
            }
          }
          return Array.from(values);
        }

        function setDropState(enabled) {
          dropHint.classList.toggle('dragover', enabled);
          composerShell.classList.toggle('dragover', enabled);
        }

        function setComposerAvailability(options = {}) {
          const disabled = Boolean(options.disabled);
          promptInput.disabled = disabled;
          sendPrompt.disabled = disabled;
          sendMode.disabled = disabled;
          attachFiles.disabled = disabled;
          attachOpenFiles.disabled = disabled;
          clearAttachments.disabled = disabled;
        }

        function submitPrompt() {
          if (sendPrompt.disabled) {
            return;
          }
          vscode.postMessage({ type: 'submitPrompt', payload: { prompt: promptInput.value, mode: sendMode.value } });
          promptInput.value = '';
          promptInput.focus();
        }

        function renderTranscript(entries, busy) {
          transcript.innerHTML = '';
          if (!Array.isArray(entries) || entries.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = 'No messages yet. Start a conversation with AtlasMind from this panel.';
            transcript.appendChild(empty);
            return;
          }

          let lastAssistantIndex = -1;
          for (let index = entries.length - 1; index >= 0; index -= 1) {
            if (entries[index] && entries[index].role === 'assistant') {
              lastAssistantIndex = index;
              break;
            }
          }

          entries.forEach((entry, index) => {
            const item = document.createElement('div');
            item.className = 'chat-message ' + (entry.role === 'user' ? 'user' : 'assistant');
            const showThinking = busy && entry.role === 'assistant' && index === lastAssistantIndex;
            if (showThinking) {
              item.classList.add('pending');
            }

            const header = document.createElement('div');
            header.className = 'chat-message-header';

            const role = document.createElement('div');
            role.className = 'chat-role';
            role.textContent = entry.role === 'user' ? 'You' : 'AtlasMind';

            header.appendChild(role);

            if (entry.role === 'assistant' && entry.meta && entry.meta.modelUsed) {
              const badge = document.createElement('div');
              badge.className = 'chat-model-badge';
              badge.textContent = entry.meta.modelUsed;
              header.appendChild(badge);
            }

            const content = document.createElement('div');
            content.className = 'chat-content';
            content.textContent = entry.content || (showThinking ? '' : (entry.role === 'assistant' ? '…' : ''));

            item.appendChild(header);
            if (content.textContent) {
              item.appendChild(content);
            }

            if (entry.role === 'assistant' && entry.meta && entry.meta.thoughtSummary) {
              item.appendChild(renderThoughtSummary(entry.meta.thoughtSummary));
            }

            if (showThinking) {
              item.appendChild(renderThinkingIndicator(Boolean(entry.content)));
            }

            transcript.appendChild(item);
          });

          transcript.scrollTop = transcript.scrollHeight;
        }

        function renderThinkingIndicator(hasContent) {
          const wrapper = document.createElement('div');
          wrapper.className = 'thinking-indicator' + (hasContent ? ' compact' : '');

          const logo = document.createElement('div');
          logo.className = 'thinking-logo atlas-globe-loader';
          logo.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            + '<circle class="atlas-outline" cx="12" cy="12" r="10"></circle>'
            + '<g class="atlas-axis">'
            + '<path d="M12 2 C7 7, 7 17, 12 22"></path>'
            + '<path d="M12 2 C17 7, 17 17, 12 22"></path>'
            + '<line x1="2" y1="12" x2="22" y2="12"></line>'
            + '</g>'
            + '</svg>';

          const copy = document.createElement('div');
          copy.className = 'thinking-copy';

          const title = document.createElement('div');
          title.className = 'thinking-title';
          title.textContent = 'AtlasMind is thinking';

          const subtitle = document.createElement('div');
          subtitle.className = 'thinking-subtitle';
          subtitle.textContent = hasContent
            ? 'The response is still streaming.'
            : 'The model has not stopped; waiting for the next token batch.';

          copy.appendChild(title);
          copy.appendChild(subtitle);
          wrapper.appendChild(logo);
          wrapper.appendChild(copy);
          return wrapper;
        }

        function renderThoughtSummary(thoughtSummary) {
          const details = document.createElement('details');
          details.className = 'thought-details';

          const summary = document.createElement('summary');
          summary.textContent = thoughtSummary.label || 'Thinking summary';
          details.appendChild(summary);

          if (thoughtSummary.summary) {
            const summaryText = document.createElement('p');
            summaryText.className = 'thought-summary';
            summaryText.textContent = thoughtSummary.summary;
            details.appendChild(summaryText);
          }

          if (Array.isArray(thoughtSummary.bullets) && thoughtSummary.bullets.length > 0) {
            const list = document.createElement('ul');
            list.className = 'thought-list';
            for (const bullet of thoughtSummary.bullets) {
              const item = document.createElement('li');
              item.textContent = bullet;
              list.appendChild(item);
            }
            details.appendChild(list);
          }

          return details;
        }

        function renderRunInspector(run) {
          runInspector.innerHTML = '';
          if (!run) {
            return;
          }

          const summary = document.createElement('div');
          summary.className = 'run-card';
          summary.innerHTML = '<h3>' + run.goal + '</h3>' +
            '<div class="run-status-pill">' + describeRun(run) + '</div>' +
            '<p class="session-meta">Batch ' + (run.totalBatches > 0 ? run.currentBatch + '/' + run.totalBatches : 'n/a') + ' • Updated ' + run.updatedAt + '</p>';

          const actionRow = document.createElement('div');
          actionRow.className = 'row';
          const openCenter = document.createElement('button');
          openCenter.textContent = 'Open Run Center';
          openCenter.addEventListener('click', () => {
            vscode.postMessage({ type: 'openProjectRunCenter', payload: run.id });
          });
          actionRow.appendChild(openCenter);
          summary.appendChild(actionRow);
          runInspector.appendChild(summary);

          const logCard = document.createElement('div');
          logCard.className = 'run-card';
          logCard.innerHTML = '<h4>Recent Activity</h4>';
          const logList = document.createElement('div');
          logList.className = 'run-log-list';
          const logs = Array.isArray(run.logs) ? run.logs.slice(-8).reverse() : [];
          if (logs.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = 'No logs recorded yet.';
            logList.appendChild(empty);
          } else {
            for (const entry of logs) {
              const item = document.createElement('div');
              item.className = 'subtask-item';
              item.innerHTML = '<strong>' + entry.level.toUpperCase() + '</strong><div class="session-meta">' + entry.timestamp + '</div><div>' + entry.message + '</div>';
              logList.appendChild(item);
            }
          }
          logCard.appendChild(logList);
          runInspector.appendChild(logCard);

          const subtasksCard = document.createElement('div');
          subtasksCard.className = 'run-card';
          subtasksCard.innerHTML = '<h4>Sub-Agent Work</h4>';
          const subtaskList = document.createElement('div');
          subtaskList.className = 'subtask-list';
          const artifacts = Array.isArray(run.subTaskArtifacts) ? run.subTaskArtifacts : [];
          if (artifacts.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = 'No subtask artifacts recorded yet.';
            subtaskList.appendChild(empty);
          } else {
            for (const artifact of artifacts) {
              const item = document.createElement('div');
              item.className = 'subtask-item';
              const changedCount = Array.isArray(artifact.changedFiles) ? artifact.changedFiles.length : 0;
              item.innerHTML = '<strong>' + artifact.title + '</strong>' +
                '<div class="session-meta">' + artifact.role + ' • ' + artifact.status + ' • ' + changedCount + ' file' + (changedCount === 1 ? '' : 's') + '</div>' +
                '<div>' + (artifact.outputPreview || 'No output yet.') + '</div>';
              subtaskList.appendChild(item);
            }
          }
          subtasksCard.appendChild(subtaskList);
          runInspector.appendChild(subtasksCard);
        }

        sendPrompt.addEventListener('click', submitPrompt);

        promptInput.addEventListener('keydown', event => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submitPrompt();
          }
        });

        clearConversation.addEventListener('click', () => {
          vscode.postMessage({ type: 'clearConversation' });
        });
        copyTranscript.addEventListener('click', () => {
          vscode.postMessage({ type: 'copyTranscript' });
        });
        saveTranscript.addEventListener('click', () => {
          vscode.postMessage({ type: 'saveTranscript' });
        });
        createSession.addEventListener('click', () => {
          vscode.postMessage({ type: 'createSession' });
        });
        attachFiles.addEventListener('click', () => {
          vscode.postMessage({ type: 'pickAttachments' });
        });
        attachOpenFiles.addEventListener('click', () => {
          vscode.postMessage({ type: 'attachOpenFiles' });
        });
        clearAttachments.addEventListener('click', () => {
          vscode.postMessage({ type: 'clearAttachments' });
        });

        for (const target of [dropHint, promptInput, composerShell]) {
          target.addEventListener('dragover', event => {
            event.preventDefault();
            setDropState(true);
          });
          target.addEventListener('dragleave', () => {
            setDropState(false);
          });
          target.addEventListener('drop', event => {
            event.preventDefault();
            setDropState(false);
            const droppedItems = collectDroppedItems(event);
            if (droppedItems.length > 0) {
              vscode.postMessage({ type: 'addDroppedItems', payload: droppedItems });
            }
          });
        }

        window.addEventListener('message', event => {
          const message = event.data;
          if (!message || typeof message.type !== 'string') {
            return;
          }

          if (message.type === 'state') {
            const state = message.payload || {};
            latestState = state;
            renderSessions(state.sessions, state.selectedSessionId);
            renderRuns(state.projectRuns, state.selectedRun ? state.selectedRun.id : undefined);
            renderAttachments(state.attachments);
            renderOpenFiles(state.openFiles);

            const isRun = state.activeSurface === 'run';
            transcript.classList.toggle('hidden', isRun);
            runInspector.classList.toggle('hidden', !isRun);
            setComposerAvailability({ disabled: isRun || isBusy });
            clearConversation.disabled = isRun;
            panelTitle.textContent = isRun
              ? (state.selectedRun ? state.selectedRun.goal : 'Autonomous Run')
              : ((state.sessions || []).find(session => session.id === state.selectedSessionId)?.title || 'AtlasMind Chat');
            panelSubtitle.textContent = isRun
              ? 'Inspect live sub-agent activity here, then open the Project Run Center to pause, approve, or resume batches.'
              : 'Persistent workspace chat threads with direct access to recent autonomous runs.';
            composerHint.textContent = isRun
              ? 'Composer disabled while viewing a run session. Switch back to a chat thread to send a prompt.'
              : 'Enter sends with the selected mode. Shift+Enter adds a newline.';

            if (isRun) {
              renderRunInspector(state.selectedRun);
            } else {
              renderTranscript(state.transcript, isBusy);
            }
            return;
          }

          if (message.type === 'status') {
            status.textContent = typeof message.payload === 'string' ? message.payload : '';
            return;
          }

          if (message.type === 'busy') {
            const busy = Boolean(message.payload);
            isBusy = busy;
            if (latestState && latestState.activeSurface !== 'run') {
              renderTranscript(latestState.transcript, isBusy);
            }
            setComposerAvailability({ disabled: busy || Boolean(latestState && latestState.activeSurface === 'run') });
          }
        });
      `,
    });
  }
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'atlasmind.chatView';
  private static currentProvider: ChatViewProvider | undefined;
  private pendingSessionId: string | undefined;
  private currentView: vscode.WebviewView | undefined;
  private currentSurface: ChatPanel | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly atlas: AtlasMindContext,
  ) {
    ChatViewProvider.currentProvider = this;
  }

  public static async open(sessionId?: string): Promise<void> {
    ChatViewProvider.currentProvider?.setPendingSession(sessionId);
    await vscode.commands.executeCommand('workbench.view.extension.atlasmind-sidebar');
    try {
      await vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`);
    } catch {
      // Some VS Code builds do not expose a focus command for custom views.
    }
  }

  public setPendingSession(sessionId?: string): void {
    this.pendingSessionId = sessionId;
    if (this.currentSurface) {
      void this.currentSurface.showChatSession(sessionId);
    }
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void | Thenable<void> {
    this.currentSurface?.dispose();
    this.currentView = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };

    this.currentSurface = new ChatPanel(
      webviewView,
      this.extensionUri,
      this.atlas,
      this.pendingSessionId,
      () => {
        this.currentSurface = undefined;
        this.currentView = undefined;
      },
    );
    this.pendingSessionId = undefined;
  }
}

function renderTranscriptMarkdown(title: string, transcript: SessionTranscriptEntry[]): string {
  if (transcript.length === 0) {
      return '';
    }

  return `# ${title}\n\n` + transcript
    .map(entry => {
      const modelLine = entry.meta?.modelUsed ? `**Model:** ${entry.meta.modelUsed}\n\n` : '';
      const thoughtBlock = renderThoughtSummaryMarkdown(entry.meta?.thoughtSummary);
      return `## ${entry.role === 'user' ? 'User' : 'AtlasMind'}\n\n${modelLine}${entry.content}${thoughtBlock}`;
    })
    .join('\n\n');
}

function renderThoughtSummaryMarkdown(thoughtSummary: SessionThoughtSummary | undefined): string {
  if (!thoughtSummary) {
    return '';
  }

  const bulletBlock = thoughtSummary.bullets.length > 0
    ? `\n${thoughtSummary.bullets.map(item => `- ${escapeMarkdownHtml(item)}`).join('\n')}`
    : '';
  return `\n\n<details>\n<summary>${escapeMarkdownHtml(thoughtSummary.label)}</summary>\n\n${escapeMarkdownHtml(thoughtSummary.summary)}${bulletBlock}\n</details>`;
}

function escapeMarkdownHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function isChatPanelMessage(value: unknown): value is ChatPanelMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }

  const message = value as { type?: unknown; payload?: unknown };
  if (
    message.type === 'clearConversation'
    || message.type === 'copyTranscript'
    || message.type === 'saveTranscript'
    || message.type === 'createSession'
    || message.type === 'pickAttachments'
    || message.type === 'attachOpenFiles'
    || message.type === 'clearAttachments'
  ) {
    return true;
  }

  if (message.type === 'submitPrompt') {
    return typeof message.payload === 'object'
      && message.payload !== null
      && typeof (message.payload as { prompt?: unknown }).prompt === 'string'
      && isComposerSendMode((message.payload as { mode?: unknown }).mode);
  }

  if (message.type === 'addDroppedItems') {
    return Array.isArray(message.payload) && message.payload.every(item => typeof item === 'string');
  }

  return (message.type === 'selectSession'
    || message.type === 'deleteSession'
    || message.type === 'openProjectRun'
    || message.type === 'openProjectRunCenter'
    || message.type === 'attachOpenFile'
    || message.type === 'removeAttachment')
    && typeof message.payload === 'string';
}

function isComposerSendMode(value: unknown): value is ComposerSendMode {
  return value === 'send' || value === 'steer' || value === 'new-chat' || value === 'new-session';
}

function normalizeProjectGoal(prompt: string): string {
  const trimmed = prompt.trim();
  return trimmed.startsWith('/project')
    ? trimmed.slice('/project'.length).replace('--approve', '').trim()
    : trimmed;
}

function getOpenWorkspaceFileUris(): vscode.Uri[] {
  const seen = new Map<string, vscode.Uri>();
  for (const editor of vscode.window.visibleTextEditors ?? []) {
    const uri = editor.document.uri;
    if (uri.scheme !== 'file') {
      continue;
    }
    const relativePath = vscode.workspace.asRelativePath(uri, false);
    if (!relativePath || relativePath === uri.fsPath || relativePath.startsWith('..')) {
      continue;
    }
    seen.set(relativePath, uri);
  }

  return [...seen.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([, uri]) => uri);
}

function getOpenWorkspaceFiles(): ChatPanelOpenFileLink[] {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  const activePath = activeUri ? vscode.workspace.asRelativePath(activeUri, false) : undefined;
  return getOpenWorkspaceFileUris().map(uri => {
    const relativePath = vscode.workspace.asRelativePath(uri, false);
    return {
      path: relativePath,
      isActive: relativePath === activePath,
    };
  });
}

async function buildComposerAttachment(
  uri: vscode.Uri,
  imageAttachment?: TaskImageAttachment,
): Promise<ChatComposerAttachment | undefined> {
  const relativePath = vscode.workspace.asRelativePath(uri, false);
  if (!relativePath || relativePath === uri.fsPath || relativePath.startsWith('..')) {
    return undefined;
  }

  if (imageAttachment) {
    return {
      id: `file:${relativePath}`,
      label: relativePath,
      kind: 'image',
      source: relativePath,
      uri,
      mimeType: detectMimeType(relativePath),
      imageAttachment,
    };
  }

  const mimeType = detectMimeType(relativePath);
  let kind = classifyAttachmentKind(path.extname(relativePath).toLowerCase(), mimeType);
  let inlineText: string | undefined;
  if (kind === 'text') {
    inlineText = await readAttachmentSnippet(uri);
    if (!inlineText) {
      kind = 'binary';
    }
  }

  return {
    id: `file:${relativePath}`,
    label: relativePath,
    kind,
    source: relativePath,
    uri,
    inlineText,
    mimeType,
  };
}

async function readAttachmentSnippet(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString('utf8');
    if (!text || /\u0000/.test(text)) {
      return undefined;
    }
    return text.slice(0, 6000);
  } catch {
    return undefined;
  }
}

function buildAttachmentContextBlock(attachments: ChatComposerAttachment[]): string | undefined {
  if (attachments.length === 0) {
    return undefined;
  }

  const sections = attachments.map(attachment => {
    if (attachment.kind === 'url') {
      return `- URL: ${attachment.source}`;
    }
    if (attachment.kind === 'image') {
      return `- Image: ${attachment.source}`;
    }
    if (attachment.kind === 'audio') {
      return `- Audio file: ${attachment.source}`;
    }
    if (attachment.kind === 'video') {
      return `- Video file: ${attachment.source}`;
    }
    if (attachment.kind === 'binary') {
      return `- Binary file: ${attachment.source}`;
    }

    const language = fenceLanguageFromPath(attachment.source);
    const fence = '```';
    return `- File: ${attachment.source}\n\n${fence}${language}\n${attachment.inlineText ?? ''}\n${fence}`;
  });

  return `Attached context:\n\n${sections.join('\n\n')}`;
}

function detectMimeType(filePath: string): string | undefined {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.mp3': return 'audio/mpeg';
    case '.wav': return 'audio/wav';
    case '.ogg': return 'audio/ogg';
    case '.m4a': return 'audio/mp4';
    case '.mp4': return 'video/mp4';
    case '.mov': return 'video/quicktime';
    case '.webm': return 'video/webm';
    case '.mkv': return 'video/x-matroska';
    default: return undefined;
  }
}

function classifyAttachmentKind(extension: string, mimeType?: string): ChatComposerAttachment['kind'] {
  if (mimeType?.startsWith('audio/')) {
    return 'audio';
  }
  if (mimeType?.startsWith('video/')) {
    return 'video';
  }
  if (mimeType?.startsWith('image/')) {
    return 'image';
  }

  const textExtensions = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.py', '.cs', '.cpp', '.c', '.h', '.java', '.go', '.rs', '.rb', '.php', '.css', '.scss', '.html', '.xml', '.yml', '.yaml', '.toml', '.txt', '.sh', '.ps1', '.sql', '.kt', '.swift', '.dart', '.vue', '.svelte', '.env', '.gitignore', '.editorconfig', '.ini', '.conf', '.cfg', '.log',
  ]);
  return textExtensions.has(extension) || extension.length === 0 ? 'text' : 'binary';
}

function fenceLanguageFromPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.ts': return 'ts';
    case '.tsx': return 'tsx';
    case '.js': return 'js';
    case '.jsx': return 'jsx';
    case '.json': return 'json';
    case '.md': return 'md';
    case '.py': return 'py';
    case '.cs': return 'cs';
    case '.cpp': return 'cpp';
    case '.c': return 'c';
    case '.java': return 'java';
    case '.go': return 'go';
    case '.rs': return 'rust';
    case '.rb': return 'rb';
    case '.php': return 'php';
    case '.css': return 'css';
    case '.scss': return 'scss';
    case '.html': return 'html';
    case '.xml': return 'xml';
    case '.yml':
    case '.yaml': return 'yaml';
    case '.toml': return 'toml';
    case '.sh': return 'sh';
    case '.ps1': return 'powershell';
    case '.sql': return 'sql';
    default: return '';
  }
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function coerceWorkspaceFileUri(rawValue: string, workspaceRoot: string): vscode.Uri | undefined {
  let value = rawValue.trim();
  if (!value) {
    return undefined;
  }

  if (/^file:\/\//i.test(value)) {
    try {
      value = vscode.Uri.parse(value).fsPath;
    } catch {
      return undefined;
    }
  }

  const resolvedPath = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(workspaceRoot, value);
  const normalizedRoot = path.resolve(workspaceRoot);
  if (resolvedPath !== normalizedRoot && !resolvedPath.startsWith(`${normalizedRoot}${path.sep}`)) {
    return undefined;
  }
  return vscode.Uri.file(resolvedPath);
}

function createIdleCancellationToken(): vscode.CancellationToken {
  return {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => undefined }),
  } as vscode.CancellationToken;
}

function toRunSummary(run: ProjectRunRecord): ChatPanelRunSummary {
  return {
    id: run.id,
    goal: run.goal,
    status: run.status,
    updatedAt: run.updatedAt,
    currentBatch: run.currentBatch,
    totalBatches: run.totalBatches,
    paused: run.paused,
    awaitingBatchApproval: run.awaitingBatchApproval,
    failedSubtaskTitles: [...run.failedSubtaskTitles],
    logs: run.logs.map(entry => ({ ...entry })),
    subTaskArtifacts: run.subTaskArtifacts.map(artifact => ({
      subTaskId: artifact.subTaskId,
      title: artifact.title,
      role: artifact.role,
      status: artifact.status,
      outputPreview: artifact.outputPreview,
      changedFiles: artifact.changedFiles.map(file => ({ ...file })),
    })),
  };
}

function renderRunMarkdown(run: ProjectRunRecord): string {
  const logSection = run.logs.length > 0
    ? run.logs.slice(-12).map(entry => `- [${entry.level}] ${entry.timestamp} ${entry.message}`).join('\n')
    : '- No logs recorded.';
  const subtaskSection = run.subTaskArtifacts.length > 0
    ? run.subTaskArtifacts.map(artifact => `## ${artifact.title}\n\nRole: ${artifact.role}\nStatus: ${artifact.status}\n\n${artifact.outputPreview || 'No output yet.'}`).join('\n\n')
    : 'No subtask artifacts recorded.';

  return `# ${run.goal}\n\nStatus: ${run.status}\nUpdated: ${run.updatedAt}\n\n## Recent Activity\n\n${logSection}\n\n## Sub-Agent Work\n\n${subtaskSection}`;
}

function toBudgetMode(value: string | undefined): 'cheap' | 'balanced' | 'expensive' | 'auto' {
  return value === 'cheap' || value === 'balanced' || value === 'expensive' || value === 'auto'
    ? value
    : 'balanced';
}

function toSpeedMode(value: string | undefined): 'fast' | 'balanced' | 'considered' | 'auto' {
  return value === 'fast' || value === 'balanced' || value === 'considered' || value === 'auto'
    ? value
    : 'balanced';
}