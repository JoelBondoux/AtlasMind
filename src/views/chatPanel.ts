import * as vscode from 'vscode';
import type { AtlasMindContext } from '../extension.js';
import type { SessionConversationSummary, SessionTranscriptEntry } from '../chat/sessionConversation.js';
import type { ProjectRunRecord } from '../types.js';
import { getWebviewHtmlShell } from './webviewUtils.js';

type ChatPanelMessage =
  | { type: 'submitPrompt'; payload: string }
  | { type: 'clearConversation' }
  | { type: 'copyTranscript' }
  | { type: 'saveTranscript' }
  | { type: 'createSession' }
  | { type: 'selectSession'; payload: string }
  | { type: 'deleteSession'; payload: string }
  | { type: 'openProjectRun'; payload: string }
  | { type: 'openProjectRunCenter'; payload: string };

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

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private selectedSessionId: string;
  private selectedRunId: string | undefined;
  private activeSurface: 'chat' | 'run' = 'chat';

  public static createOrShow(context: vscode.ExtensionContext, atlas: AtlasMindContext, selectedSessionId?: string): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (ChatPanel.currentPanel) {
      if (selectedSessionId) {
        ChatPanel.currentPanel.selectedSessionId = selectedSessionId;
        ChatPanel.currentPanel.activeSurface = 'chat';
        atlas.sessionConversation.selectSession(selectedSessionId);
        void ChatPanel.currentPanel.syncState();
      }
      ChatPanel.currentPanel.panel.reveal(column);
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

    ChatPanel.currentPanel = new ChatPanel(panel, atlas, selectedSessionId);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly atlas: AtlasMindContext,
    selectedSessionId?: string,
  ) {
    this.panel = panel;
    this.selectedSessionId = selectedSessionId && atlas.sessionConversation.selectSession(selectedSessionId)
      ? selectedSessionId
      : atlas.sessionConversation.getActiveSessionId();
    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(message => {
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

    void this.syncState();
  }

  private dispose(): void {
    ChatPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isChatPanelMessage(message)) {
      return;
    }

    switch (message.type) {
      case 'submitPrompt':
        await this.runPrompt(message.payload);
        return;
      case 'clearConversation':
        this.atlas.sessionConversation.clearSession(this.selectedSessionId);
        await this.panel.webview.postMessage({ type: 'status', payload: 'Conversation cleared for the selected session.' });
        return;
      case 'copyTranscript':
        await vscode.env.clipboard.writeText(await this.renderActiveSurfaceMarkdown());
        await this.panel.webview.postMessage({ type: 'status', payload: 'Copied the current session view to the clipboard.' });
        return;
      case 'saveTranscript':
        await this.saveTranscript();
        return;
      case 'createSession': {
        this.selectedSessionId = this.atlas.sessionConversation.createSession();
        this.activeSurface = 'chat';
        await this.panel.webview.postMessage({ type: 'status', payload: 'Created a new chat session.' });
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
        await this.panel.webview.postMessage({ type: 'status', payload: 'Deleted the selected chat session.' });
        return;
      case 'openProjectRun':
        this.selectedRunId = message.payload;
        this.activeSurface = 'run';
        await this.syncState();
        return;
      case 'openProjectRunCenter':
        await vscode.commands.executeCommand('atlasmind.openProjectRunCenter', message.payload);
        return;
    }
  }

  private async runPrompt(rawPrompt: string): Promise<void> {
    const prompt = rawPrompt.trim();
    if (!prompt) {
      await this.panel.webview.postMessage({ type: 'status', payload: 'Enter a prompt before sending a chat request.' });
      return;
    }

    if (this.activeSurface !== 'chat') {
      await this.panel.webview.postMessage({ type: 'status', payload: 'Select a chat session before sending a prompt.' });
      return;
    }

    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const sessionContext = this.atlas.sessionConversation.buildContext({
      maxTurns: configuration.get<number>('chatSessionTurnLimit', 6),
      maxChars: configuration.get<number>('chatSessionContextChars', 2500),
      sessionId: this.selectedSessionId,
    });

    const activeSessionId = this.selectedSessionId;
    this.atlas.sessionConversation.selectSession(activeSessionId);
    this.atlas.sessionConversation.appendMessage('user', prompt, activeSessionId);
    const assistantMessageId = this.atlas.sessionConversation.appendMessage('assistant', '', activeSessionId);

    await this.syncState();
    await this.panel.webview.postMessage({ type: 'busy', payload: true });
    await this.panel.webview.postMessage({ type: 'status', payload: 'Running AtlasMind chat request...' });

    let streamed = false;
    try {
      const result = await this.atlas.orchestrator.processTask({
        id: `chat-panel-${Date.now()}`,
        userMessage: prompt,
        context: sessionContext ? { sessionContext } : {},
        constraints: {
          budget: toBudgetMode(configuration.get<string>('budgetMode')),
          speed: toSpeedMode(configuration.get<string>('speedMode')),
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
        this.atlas.sessionConversation.updateMessage(assistantMessageId, result.response, activeSessionId);
        await this.syncState();
      }

      if (configuration.get<boolean>('voice.ttsEnabled', false)) {
        this.atlas.voiceManager.speak(result.response);
      }
      await this.panel.webview.postMessage({ type: 'status', payload: `Response ready via ${result.modelUsed}.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.atlas.sessionConversation.updateMessage(assistantMessageId, `Request failed: ${message}`, activeSessionId);
      await this.syncState();
      await this.panel.webview.postMessage({ type: 'status', payload: `Chat request failed: ${message}` });
    } finally {
      await this.panel.webview.postMessage({ type: 'busy', payload: false });
    }
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

    await this.panel.webview.postMessage({ type: 'state', payload });
  }

  private async saveTranscript(): Promise<void> {
    const markdown = await this.renderActiveSurfaceMarkdown();
    if (!markdown) {
      await this.panel.webview.postMessage({ type: 'status', payload: 'No session content available yet.' });
      return;
    }

    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: markdown,
    });
    await vscode.window.showTextDocument(document, { preview: false });
    await this.panel.webview.postMessage({ type: 'status', payload: 'Opened the current session in a markdown editor.' });
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
      cspSource: this.panel.webview.cspSource,
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
              <textarea id="promptInput" rows="5" placeholder="Ask AtlasMind to plan, explain, inspect, or implement something…"></textarea>
              <div class="row toolbar-row composer-row">
                <button id="sendPrompt" class="primary-btn">Send</button>
                <span id="composerHint" class="hint-label">Enter sends. Shift+Enter adds a newline.</span>
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
        .chat-role {
          font-size: 0.8em;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 6px;
          color: var(--vscode-descriptionForeground);
        }
        .composer-shell {
          border: 1px solid var(--vscode-widget-border, #444);
          border-radius: 12px;
          padding: 12px;
          background: color-mix(in srgb, var(--vscode-editor-background) 94%, white 6%);
        }
        textarea {
          width: 100%;
          box-sizing: border-box;
          resize: vertical;
          min-height: 110px;
          padding: 10px 12px;
          color: var(--vscode-input-foreground);
          background: var(--vscode-input-background);
          border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #444));
          border-radius: 8px;
        }
        .composer-row { margin-top: 10px; }
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
        const clearConversation = document.getElementById('clearConversation');
        const copyTranscript = document.getElementById('copyTranscript');
        const saveTranscript = document.getElementById('saveTranscript');
        const createSession = document.getElementById('createSession');
        const panelTitle = document.getElementById('panelTitle');
        const panelSubtitle = document.getElementById('panelSubtitle');
        const composerHint = document.getElementById('composerHint');

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

        function renderTranscript(entries) {
          transcript.innerHTML = '';
          if (!Array.isArray(entries) || entries.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = 'No messages yet. Start a conversation with AtlasMind from this panel.';
            transcript.appendChild(empty);
            return;
          }

          for (const entry of entries) {
            const item = document.createElement('div');
            item.className = 'chat-message ' + (entry.role === 'user' ? 'user' : 'assistant');

            const role = document.createElement('div');
            role.className = 'chat-role';
            role.textContent = entry.role === 'user' ? 'You' : 'AtlasMind';

            const content = document.createElement('div');
            content.textContent = entry.content || (entry.role === 'assistant' ? '…' : '');

            item.appendChild(role);
            item.appendChild(content);
            transcript.appendChild(item);
          }

          transcript.scrollTop = transcript.scrollHeight;
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

        sendPrompt.addEventListener('click', () => {
          vscode.postMessage({ type: 'submitPrompt', payload: promptInput.value });
          promptInput.value = '';
          promptInput.focus();
        });

        promptInput.addEventListener('keydown', event => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendPrompt.click();
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

        window.addEventListener('message', event => {
          const message = event.data;
          if (!message || typeof message.type !== 'string') {
            return;
          }

          if (message.type === 'state') {
            const state = message.payload || {};
            renderSessions(state.sessions, state.selectedSessionId);
            renderRuns(state.projectRuns, state.selectedRun ? state.selectedRun.id : undefined);

            const isRun = state.activeSurface === 'run';
            transcript.classList.toggle('hidden', isRun);
            runInspector.classList.toggle('hidden', !isRun);
            promptInput.disabled = isRun;
            sendPrompt.disabled = isRun;
            clearConversation.disabled = isRun;
            panelTitle.textContent = isRun
              ? (state.selectedRun ? state.selectedRun.goal : 'Autonomous Run')
              : ((state.sessions || []).find(session => session.id === state.selectedSessionId)?.title || 'AtlasMind Chat');
            panelSubtitle.textContent = isRun
              ? 'Inspect live sub-agent activity here, then open the Project Run Center to pause, approve, or resume batches.'
              : 'Persistent workspace chat threads with direct access to recent autonomous runs.';
            composerHint.textContent = isRun
              ? 'Composer disabled while viewing a run session. Switch back to a chat thread to send a prompt.'
              : 'Enter sends. Shift+Enter adds a newline.';

            if (isRun) {
              renderRunInspector(state.selectedRun);
            } else {
              renderTranscript(state.transcript);
            }
            return;
          }

          if (message.type === 'status') {
            status.textContent = typeof message.payload === 'string' ? message.payload : '';
            return;
          }

          if (message.type === 'busy') {
            const busy = Boolean(message.payload);
            if (!promptInput.disabled) {
              sendPrompt.disabled = busy;
              promptInput.disabled = busy;
            }
          }
        });
      `,
    });
  }
}

function renderTranscriptMarkdown(title: string, transcript: SessionTranscriptEntry[]): string {
  if (transcript.length === 0) {
      return '';
    }

  return `# ${title}\n\n` + transcript
    .map(entry => `## ${entry.role === 'user' ? 'User' : 'AtlasMind'}\n\n${entry.content}`)
    .join('\n\n');
}

export function isChatPanelMessage(value: unknown): value is ChatPanelMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }

  const message = value as { type?: unknown; payload?: unknown };
  if (message.type === 'clearConversation' || message.type === 'copyTranscript' || message.type === 'saveTranscript' || message.type === 'createSession') {
    return true;
  }

  return (message.type === 'submitPrompt'
    || message.type === 'selectSession'
    || message.type === 'deleteSession'
    || message.type === 'openProjectRun'
    || message.type === 'openProjectRunCenter')
    && typeof message.payload === 'string';
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