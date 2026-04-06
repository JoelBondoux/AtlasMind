import * as path from 'path';
import * as vscode from 'vscode';
import type { AtlasMindContext } from '../extension.js';
import type { SessionConversationSummary, SessionThoughtSummary, SessionTranscriptEntry } from '../chat/sessionConversation.js';
import type { ProjectRunRecord, TaskImageAttachment } from '../types.js';
import {
  buildAssistantResponseMetadata,
  buildProjectResponseMetadata,
  buildWorkstationContext,
  reconcileAssistantResponse,
  resolveAtlasChatIntent,
  runProjectCommand,
  toApprovedProjectPrompt,
} from '../chat/participant.js';
import { resolvePickedImageAttachments } from '../chat/imageAttachments.js';
import { getWebviewHtmlShell } from './webviewUtils.js';

type ComposerSendMode = 'send' | 'steer' | 'new-chat' | 'new-session';

type ChatPanelMessage =
  | { type: 'submitPrompt'; payload: { prompt: string; mode: ComposerSendMode } }
  | { type: 'voteAssistantMessage'; payload: { entryId: string; vote: 'up' | 'down' | 'clear' } }
  | { type: 'clearConversation' }
  | { type: 'copyTranscript' }
  | { type: 'saveTranscript' }
  | { type: 'createSession' }
  | { type: 'archiveSession'; payload: string }
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

interface PreparedPromptRequest {
  userMessage: string;
  projectGoal?: string;
  commandIntent?: { commandId: string; args?: unknown[]; summary: string };
  context: Record<string, unknown>;
  imageAttachments: TaskImageAttachment[];
}

export interface ChatPanelTarget {
  sessionId?: string;
  messageId?: string;
}

interface ChatPanelState {
  activeSurface: 'chat' | 'run';
  selectedSessionId: string;
  selectedMessageId?: string;
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
  private selectedMessageId: string | undefined;
  private selectedRunId: string | undefined;
  private activeSurface: 'chat' | 'run' = 'chat';
  private composerAttachments: ChatComposerAttachment[] = [];
  private readonly onDisposed?: () => void;

  public static createOrShow(context: vscode.ExtensionContext, atlas: AtlasMindContext, target?: string | ChatPanelTarget): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    const normalizedTarget = normalizeChatPanelTarget(target);

    if (ChatPanel.currentPanel) {
      if (normalizedTarget.sessionId || normalizedTarget.messageId) {
        void ChatPanel.currentPanel.showChatSession(normalizedTarget);
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

    ChatPanel.currentPanel = new ChatPanel(panel, context.extensionUri, atlas, normalizedTarget, () => {
      ChatPanel.currentPanel = undefined;
    });
  }

  constructor(
    host: vscode.WebviewPanel | vscode.WebviewView,
    private readonly extensionUri: vscode.Uri,
    private readonly atlas: AtlasMindContext,
    initialTarget?: ChatPanelTarget,
    onDisposed?: () => void,
  ) {
    this.host = host;
    this.onDisposed = onDisposed;
    this.selectedSessionId = initialTarget?.sessionId && atlas.sessionConversation.selectSession(initialTarget.sessionId)
      ? initialTarget.sessionId
      : atlas.sessionConversation.getActiveSessionId();
    this.selectedMessageId = initialTarget?.messageId;
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

  public async showChatSession(target?: string | ChatPanelTarget): Promise<void> {
    const normalizedTarget = normalizeChatPanelTarget(target);
    if (normalizedTarget.sessionId && this.atlas.sessionConversation.selectSession(normalizedTarget.sessionId)) {
      this.selectedSessionId = normalizedTarget.sessionId;
    }
    this.selectedMessageId = normalizedTarget.messageId;
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
      case 'voteAssistantMessage':
        await this.handleAssistantVote(message.payload.entryId, message.payload.vote);
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
        this.selectedMessageId = undefined;
        this.activeSurface = 'chat';
        await this.host.webview.postMessage({ type: 'status', payload: 'Created a new chat session.' });
        return;
      }
      case 'archiveSession': {
        const archived = this.atlas.sessionConversation.archiveSession(message.payload);
        if (!archived) {
          return;
        }
        if (this.selectedSessionId === message.payload) {
          this.selectedSessionId = this.atlas.sessionConversation.getActiveSessionId();
          this.selectedMessageId = undefined;
          this.activeSurface = 'chat';
        }
        await this.host.webview.postMessage({ type: 'status', payload: 'Archived the selected chat session.' });
        return;
      }
      case 'selectSession':
        if (this.atlas.sessionConversation.selectSession(message.payload)) {
          this.selectedSessionId = message.payload;
          this.selectedMessageId = undefined;
          this.activeSurface = 'chat';
          await this.syncState();
        }
        return;
      case 'deleteSession':
        this.atlas.sessionConversation.deleteSession(message.payload);
        this.selectedSessionId = this.atlas.sessionConversation.getActiveSessionId();
        this.selectedMessageId = undefined;
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

  private async handleAssistantVote(entryId: string, vote: 'up' | 'down' | 'clear'): Promise<void> {
    const nextVote = vote === 'clear' ? undefined : vote;
    const changed = this.atlas.sessionConversation.setAssistantVote(entryId, nextVote, this.selectedSessionId);
    if (!changed) {
      return;
    }

    this.atlas.modelRouter.setModelPreferences(this.atlas.sessionConversation.getModelFeedbackSummary());
    await this.host.webview.postMessage({
      type: 'status',
      payload: nextVote === 'up'
        ? 'Saved thumbs-up feedback for this response.'
        : nextVote === 'down'
          ? 'Saved thumbs-down feedback for this response.'
          : 'Cleared feedback for this response.',
    });
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
    this.selectedMessageId = undefined;
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

    let streamedText = '';
    const progressNotes: string[] = [];
    const renderPendingAssistant = async (): Promise<void> => {
      const noteBlock = progressNotes.length > 0
        ? progressNotes.map(note => `_Thinking: ${note}_`).join('\n\n')
        : '';
      const combined = [noteBlock, streamedText].filter(part => part.length > 0).join('\n\n');
      this.atlas.sessionConversation.updateMessage(assistantMessageId, combined, activeSessionId);
      await this.syncState();
    };
    try {
      if (preparedRequest.projectGoal) {
        await this.runProjectPrompt(preparedRequest.projectGoal, assistantMessageId, activeSessionId, submittedAttachments);
        await this.host.webview.postMessage({ type: 'status', payload: 'Autonomous project run completed.' });
        return;
      }

      if (preparedRequest.commandIntent) {
        await vscode.commands.executeCommand(
          preparedRequest.commandIntent.commandId,
          ...(preparedRequest.commandIntent.args ?? []),
        );
        this.atlas.sessionConversation.updateMessage(
          assistantMessageId,
          preparedRequest.commandIntent.summary,
          activeSessionId,
          {
            modelUsed: `command/${preparedRequest.commandIntent.commandId}`,
            thoughtSummary: {
              label: 'Action summary',
              summary: preparedRequest.commandIntent.summary,
              bullets: [`Executed command: ${preparedRequest.commandIntent.commandId}.`],
            },
          },
        );
        await this.syncState();
        await this.host.webview.postMessage({ type: 'status', payload: preparedRequest.commandIntent.summary });
        return;
      }

      const result = await this.atlas.orchestrator.processTask({
        id: `chat-panel-${Date.now()}`,
        userMessage: preparedRequest.userMessage,
        context: {
          ...preparedRequest.context,
          chatSessionId: activeSessionId,
          chatMessageId: assistantMessageId,
        },
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
        streamedText += chunk;
        try {
          await renderPendingAssistant();
        } catch (error) {
          console.error('[AtlasMind] Failed to stream chat panel chunk.', error);
        }
      }, async message => {
        if (!message.trim()) {
          return;
        }
        progressNotes.push(message.trim());
        try {
          await renderPendingAssistant();
        } catch (error) {
          console.error('[AtlasMind] Failed to stream chat panel progress update.', error);
        }
      });

      const reconciled = reconcileAssistantResponse(streamedText, result.response);
      this.atlas.sessionConversation.updateMessage(
        assistantMessageId,
        reconciled.transcriptText,
        activeSessionId,
        buildAssistantResponseMetadata(preparedRequest.userMessage, result, {
          hasSessionContext: Boolean(sessionContext),
          routingContext: {
            ...preparedRequest.context,
            ...(sessionContext ? { sessionContext } : {}),
          },
        }),
      );
      await this.syncState();

      if (configuration.get<boolean>('voice.ttsEnabled', false)) {
        this.atlas.voiceManager.speak(reconciled.transcriptText);
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
    if (!this.atlas.sessionConversation.getSession(this.selectedSessionId)) {
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

    const transcript = this.atlas.sessionConversation.getTranscript(this.selectedSessionId);
    if (this.selectedMessageId && !transcript.some(entry => entry.id === this.selectedMessageId)) {
      this.selectedMessageId = undefined;
    }

    const payload: ChatPanelState = {
      activeSurface: this.activeSurface,
      selectedSessionId: this.selectedSessionId,
      ...(this.selectedMessageId ? { selectedMessageId: this.selectedMessageId } : {}),
      sessions,
      transcript,
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
  ): PreparedPromptRequest {
    const forceSteer = mode === 'steer';
    const routedIntent = forceSteer
      ? { kind: 'project' as const, goal: normalizeProjectGoal(prompt) }
      : resolveAtlasChatIntent(prompt, this.atlas.sessionConversation.getTranscript(activeSessionId));
    const projectGoal = routedIntent?.kind === 'project' ? routedIntent.goal : undefined;
    const commandIntent = routedIntent?.kind === 'command'
      ? {
          commandId: routedIntent.commandId,
          ...(routedIntent.args ? { args: routedIntent.args } : {}),
          summary: routedIntent.summary,
        }
      : undefined;
    const imageAttachments = attachments
      .map(item => item.imageAttachment)
      .filter((item): item is TaskImageAttachment => Boolean(item));
    const attachmentNote = buildAttachmentContextBlock(attachments);
    const userMessage = prompt;
    const context: Record<string, unknown> = {
      ...(sessionContext ? { sessionContext } : {}),
      ...(buildWorkstationContext() ? { workstationContext: buildWorkstationContext() } : {}),
      ...(attachmentNote ? { attachmentContext: attachmentNote } : {}),
      ...(imageAttachments.length > 0 ? { imageAttachments } : {}),
    };

    return {
      userMessage,
      projectGoal,
      commandIntent,
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
    const scriptUri = this.host.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'chatPanel.js'),
    );
    return getWebviewHtmlShell({
      title: 'AtlasMind Chat',
      cspSource: this.host.webview.cspSource,
      bodyContent: `
        <div class="chat-shell">
          <aside class="session-rail">
            <div class="session-rail-header">
              <button id="sessionToggle" class="session-toggle" aria-expanded="false" title="Toggle sessions panel">
                <svg class="toggle-chevron" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6 4l4 4-4 4z"/></svg>
                <span class="toggle-label">Sessions</span>
                <span id="sessionCount" class="session-count-badge">0</span>
              </button>
              <button id="createSession" class="icon-btn compact-icon-btn create-session-btn" type="button" title="New chat session" aria-label="New chat session">+</button>
            </div>
            <div id="sessionDrawer" class="session-drawer" aria-hidden="true">
              <div class="rail-section-label">Chat Threads</div>
              <div id="sessionList" class="session-list"></div>
              <div class="rail-section-label">Autonomous Runs</div>
              <div id="runList" class="session-list"></div>
            </div>
          </aside>
          <main class="main-panel">
            <section class="panel-header">
              <div>
                <div class="eyebrow">Dedicated Workspace</div>
                <h2 id="panelTitle">AtlasMind Chat</h2>
                <p id="panelSubtitle" class="panel-subtitle">Persistent workspace chat threads with direct access to recent autonomous runs.</p>
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
          </main>
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
            <textarea id="promptInput" rows="3" placeholder="Ask AtlasMind to plan, explain, inspect, or implement something…"></textarea>
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
              <span id="composerHint" class="hint-label">Enter sends. Shift+Enter newline.</span>
            </div>
          </section>
        </div>
      `,
      extraCss: `
        /* ---- Shell layout: vertical flex, full viewport ---- */
        .chat-shell {
          display: flex;
          flex-direction: column;
          height: 100vh;
          overflow: hidden;
        }

        /* ---- Sessions collapsible panel ---- */
        .session-rail {
          flex: 0 0 auto;
          border-bottom: 1px solid var(--vscode-sideBar-border, var(--vscode-widget-border, #444));
          min-width: 0;
        }
        .session-rail-header {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 2px 10px;
        }
        .session-toggle {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1 1 auto;
          min-width: 0;
          padding: 4px 0;
          border: 0;
          background: transparent;
          color: var(--vscode-foreground);
          cursor: pointer;
          font-size: 0.82rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .session-toggle:hover {
          background: color-mix(in srgb, var(--vscode-list-hoverBackground, var(--vscode-editor-background)) 60%, transparent);
        }
        .toggle-chevron {
          transition: transform 150ms ease;
          flex: 0 0 14px;
        }
        .session-toggle[aria-expanded="true"] .toggle-chevron {
          transform: rotate(90deg);
        }
        .toggle-label { flex: 1; text-align: left; }
        .session-count-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 18px;
          height: 18px;
          padding: 0 5px;
          border-radius: 999px;
          background: var(--vscode-badge-background, var(--vscode-button-background));
          color: var(--vscode-badge-foreground, #fff);
          font-size: 0.72rem;
          font-weight: 700;
          line-height: 1;
        }
        .create-session-btn {
          flex: 0 0 auto;
          min-width: 22px;
          min-height: 22px;
          width: 22px;
          height: 22px;
          padding: 0;
          font-size: 0.95rem;
          line-height: 1;
        }
        .session-drawer {
          display: none;
          max-height: 50vh;
          overflow-y: auto;
          padding: 4px 10px 10px;
        }
        .session-drawer.open {
          display: block;
        }

        @media (min-width: 1000px) {
          .chat-shell[data-layout="wide"] {
            flex-direction: row;
            align-items: stretch;
          }
          .chat-shell[data-layout="wide"] .session-rail {
            width: min(320px, 32vw);
            border-bottom: 0;
            border-right: 1px solid var(--vscode-sideBar-border, var(--vscode-widget-border, #444));
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          .chat-shell[data-layout="wide"] .session-rail-header {
            padding: 8px 10px 6px;
          }
          .chat-shell[data-layout="wide"] .session-toggle {
            cursor: default;
          }
          .chat-shell[data-layout="wide"] .session-toggle:hover {
            background: transparent;
          }
          .chat-shell[data-layout="wide"] .session-drawer {
            display: block;
            flex: 1 1 auto;
            max-height: none;
            padding: 0 10px 10px;
          }
          .chat-shell[data-layout="wide"] .main-panel {
            padding: 8px 12px 0;
          }
        }

        /* ---- Main content: fills remaining space ---- */
        .main-panel {
          flex: 1 1 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-height: 0;
          overflow: hidden;
          padding: 8px 10px 0;
        }
        .panel-header {
          flex: 0 0 auto;
        }
        .rail-header, .panel-header, .row {
          display: flex;
          gap: 8px;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
        }
        .eyebrow {
          font-size: 10px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--vscode-descriptionForeground);
        }
        h1, h2 {
          margin: 2px 0;
          font-size: 1.05rem;
        }
        .panel-subtitle, .hint-label, .status-label, .session-meta, .empty-state {
          color: var(--vscode-descriptionForeground);
          font-size: 0.85em;
        }
        .status-label { flex: 0 0 auto; }
        .chat-transcript, .run-inspector {
          flex: 1 1 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-height: 80px;
          overflow-y: auto;
          padding: 10px;
          border: 1px solid var(--vscode-widget-border, #444);
          border-radius: 10px;
          background: color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-editorHoverWidget-background, #111) 8%);
        }

        /* ---- Session cards (compact) ---- */
        .session-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding-right: 4px;
        }
        .rail-section-label {
          margin-top: 4px;
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--vscode-descriptionForeground);
        }
        .session-item {
          width: 100%;
          text-align: left;
          border: 1px solid var(--vscode-widget-border, #444);
          background: var(--vscode-sideBar-background, var(--vscode-editor-background));
          border-radius: 6px;
          padding: 6px 8px;
          cursor: pointer;
          color: inherit;
          font-size: 0.88em;
        }
        .session-item.active {
          border-color: var(--vscode-focusBorder, var(--vscode-button-background));
          background: color-mix(in srgb, var(--vscode-button-background) 12%, transparent);
        }
        .session-item-title {
          font-weight: 600;
          margin-bottom: 2px;
          font-size: 0.9em;
        }
        .session-item-preview {
          font-size: 0.82em;
          color: var(--vscode-descriptionForeground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .session-item-actions {
          display: flex;
          justify-content: flex-end;
          gap: 6px;
          margin-top: 4px;
        }
        .session-item-actions button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          padding: 0;
          border-radius: 999px;
          border: 1px solid var(--vscode-widget-border, #444);
          background: transparent;
          color: var(--vscode-foreground);
          cursor: pointer;
        }
        .session-item-actions button:hover {
          background: color-mix(in srgb, var(--vscode-button-background) 10%, transparent);
        }
        .session-item-actions button svg {
          width: 14px;
          height: 14px;
        }
        .session-meta {
          font-size: 0.78em;
          color: var(--vscode-descriptionForeground);
        }

        /* ---- Composer: anchored to bottom ---- */
        .composer-shell {
          flex: 0 0 auto;
          border-top: 1px solid var(--vscode-widget-border, #444);
          border-radius: 0;
          padding: 8px 10px;
          background: color-mix(in srgb, var(--vscode-editor-background) 94%, white 6%);
        }
        .toolbar-row { margin-bottom: 0; }
        .composer-tools, .attach-row, .send-group, .chip-row {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          align-items: center;
        }
        .composer-tools {
          justify-content: flex-start;
          margin-bottom: 4px;
        }
        .composer-section {
          margin: 0 0 4px;
        }
        .compact-section-label {
          margin-top: 0;
          margin-bottom: 2px;
          font-size: 0.68rem;
        }
        .send-group select {
          min-width: 100px;
          padding: 4px 8px;
          font-size: 0.88em;
          color: var(--vscode-input-foreground);
          background: var(--vscode-input-background);
          border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #444));
          border-radius: 6px;
        }
        .attachment-row {
          min-height: 0;
        }
        .chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          border: 1px solid var(--vscode-widget-border, #444);
          border-radius: 999px;
          padding: 3px 8px;
          background: color-mix(in srgb, var(--vscode-editor-background) 92%, white 8%);
          font-size: 0.82em;
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
          min-width: 26px;
          min-height: 26px;
          width: 26px;
          height: 26px;
          padding: 0;
          font-size: 0.82rem;
        }
        .open-file-chip {
          cursor: pointer;
        }
        .drop-hint {
          margin: 2px 0 4px;
          padding: 4px 8px;
          border: 1px dashed var(--vscode-widget-border, #444);
          border-radius: 8px;
          color: var(--vscode-descriptionForeground);
          font-size: 0.82em;
        }
        .drop-hint.dragover, .composer-shell.dragover {
          border-color: var(--vscode-focusBorder, var(--vscode-button-background));
          background: color-mix(in srgb, var(--vscode-button-background) 10%, transparent);
        }
        textarea {
          width: 100%;
          box-sizing: border-box;
          resize: vertical;
          min-height: 56px;
          padding: 6px 10px;
          font-size: 0.92em;
          color: var(--vscode-input-foreground);
          background: var(--vscode-input-background);
          border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #444));
          border-radius: 6px;
        }
        .composer-row {
          margin-top: 4px;
          align-items: center;
        }

        /* ---- Chat messages ---- */
        .chat-message {
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid var(--vscode-widget-border, #444);
          white-space: pre-wrap;
          word-break: break-word;
        }
        .chat-message-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 6px;
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
        .chat-message.selected-message {
          border-color: var(--vscode-focusBorder, var(--vscode-button-background));
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--vscode-focusBorder, var(--vscode-button-background)) 20%, transparent);
        }
        .chat-message.pending {
          border-color: color-mix(in srgb, var(--vscode-focusBorder, var(--vscode-button-background)) 60%, var(--vscode-widget-border, #444));
          box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-button-background) 12%, transparent);
        }
        .chat-role {
          font-size: 0.75em;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--vscode-descriptionForeground);
        }
        .chat-model-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 8px;
          border-radius: 999px;
          border: 1px solid var(--vscode-widget-border, #444);
          background: color-mix(in srgb, var(--vscode-button-background) 12%, transparent);
          font-size: 0.72rem;
          color: var(--vscode-foreground);
        }
        .chat-content {
          white-space: pre-wrap;
          word-break: break-word;
        }
        .assistant-footer {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 78%, transparent);
        }
        .assistant-footer-thought {
          flex: 1 1 auto;
          min-width: 0;
        }
        .chat-message-actions {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-left: auto;
          flex: 0 0 auto;
        }
        .vote-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          min-width: 28px;
          min-height: 28px;
          padding: 0;
          border-radius: 999px;
          border: 1px solid var(--vscode-widget-border, #444);
          background: transparent;
          color: color-mix(in srgb, var(--vscode-foreground) 84%, var(--vscode-descriptionForeground));
          cursor: pointer;
          transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
        }
        .vote-btn svg {
          width: 15px;
          height: 15px;
        }
        .vote-btn.active {
          border-color: var(--vscode-focusBorder, var(--vscode-button-background));
          background: color-mix(in srgb, var(--vscode-button-background) 16%, transparent);
          color: var(--vscode-foreground);
        }
        .vote-btn:hover {
          background: color-mix(in srgb, var(--vscode-button-background) 10%, transparent);
          color: var(--vscode-foreground);
        }
        .thought-details {
          margin-top: 0;
          border-top: 0;
          padding-top: 0;
        }
        .thought-details summary {
          cursor: pointer;
          color: var(--vscode-textLink-foreground, var(--vscode-foreground));
          font-weight: 600;
          list-style: none;
        }
        .thought-status-chip {
          display: inline-flex;
          align-items: center;
          margin-left: 8px;
          padding: 2px 8px;
          border-radius: 999px;
          border: 1px solid var(--vscode-widget-border, #444);
          font-size: 0.8em;
          font-weight: 500;
          vertical-align: middle;
        }
        .thought-status-chip.verified {
          color: var(--vscode-testing-iconPassed, #4ec9b0);
          background: color-mix(in srgb, var(--vscode-testing-iconPassed, #4ec9b0) 14%, transparent);
        }
        .thought-status-chip.blocked,
        .thought-status-chip.missing {
          color: var(--vscode-notificationsWarningIcon-foreground, #ffb347);
          background: color-mix(in srgb, var(--vscode-inputValidation-warningBorder, #cca700) 14%, transparent);
        }
        .thought-status-chip.not-applicable {
          color: var(--vscode-descriptionForeground, #999);
          background: color-mix(in srgb, var(--vscode-descriptionForeground, #999) 12%, transparent);
        }
        .thought-details summary::-webkit-details-marker {
          display: none;
        }
        .thought-details summary::before {
          content: '\\25B8';
          display: inline-block;
          margin-right: 6px;
          transition: transform 120ms ease;
        }
        .thought-details[open] summary::before {
          transform: rotate(90deg);
        }
        .thought-summary {
          margin: 8px 0 0;
          color: var(--vscode-descriptionForeground);
        }
        .thought-list {
          margin: 8px 0 0 16px;
          padding: 0;
        }
        .thought-list li {
          margin: 4px 0;
        }
        .thinking-indicator {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 78%, transparent);
        }
        .thinking-indicator.compact {
          margin-top: 10px;
        }
        .thinking-logo {
          position: relative;
          width: 28px;
          height: 28px;
          flex: 0 0 28px;
        }
        .thinking-logo::before {
          content: '';
          position: absolute;
          inset: -4px;
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
          font-size: 0.9em;
        }
        .thinking-subtitle {
          color: var(--vscode-descriptionForeground);
          font-size: 0.82em;
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

        /* ---- Run inspector ---- */
        .run-card {
          border: 1px solid var(--vscode-widget-border, #444);
          border-radius: 8px;
          padding: 10px;
          background: color-mix(in srgb, var(--vscode-editor-background) 90%, white 10%);
        }
        .run-card h3, .run-card h4 { margin: 0 0 6px; }
        .run-status-pill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 8px;
          border-radius: 999px;
          border: 1px solid var(--vscode-widget-border, #444);
          font-size: 0.82em;
        }
        .run-log-list, .subtask-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .subtask-item {
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px solid var(--vscode-widget-border, #444);
          background: color-mix(in srgb, var(--vscode-sideBar-background, var(--vscode-editor-background)) 78%, transparent);
        }
        .hidden { display: none; }
        .icon-btn {
          min-width: 28px;
          min-height: 28px;
          border-radius: 999px;
          font-size: 0.95rem;
        }
        .primary-btn {
          padding: 4px 12px;
          font-size: 0.88em;
        }
      `,
      scriptUri: scriptUri.toString(),
    });
  }
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'atlasmind.chatView';
  private static currentProvider: ChatViewProvider | undefined;
  private pendingTarget: ChatPanelTarget | undefined;
  private currentView: vscode.WebviewView | undefined;
  private currentSurface: ChatPanel | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly atlas: AtlasMindContext,
  ) {
    ChatViewProvider.currentProvider = this;
  }

  public static async open(target?: string | ChatPanelTarget): Promise<void> {
    ChatViewProvider.currentProvider?.setPendingTarget(target);
    await vscode.commands.executeCommand('workbench.view.extension.atlasmind-sidebar');
    try {
      await vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`);
    } catch {
      // Some VS Code builds do not expose a focus command for custom views.
    }
  }

  public setPendingTarget(target?: string | ChatPanelTarget): void {
    this.pendingTarget = normalizeChatPanelTarget(target);
    if (this.currentSurface) {
      void this.currentSurface.showChatSession(this.pendingTarget);
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
      this.pendingTarget,
      () => {
        this.currentSurface = undefined;
        this.currentView = undefined;
      },
    );
    this.pendingTarget = undefined;
  }
}

function normalizeChatPanelTarget(target?: string | ChatPanelTarget): ChatPanelTarget {
  if (typeof target === 'string') {
    return { sessionId: target };
  }
  if (!target) {
    return {};
  }
  return {
    ...(typeof target.sessionId === 'string' && target.sessionId.trim().length > 0 ? { sessionId: target.sessionId.trim() } : {}),
    ...(typeof target.messageId === 'string' && target.messageId.trim().length > 0 ? { messageId: target.messageId.trim() } : {}),
  };
}

function renderTranscriptMarkdown(title: string, transcript: SessionTranscriptEntry[]): string {
  if (transcript.length === 0) {
      return '';
    }

  return `# ${title}\n\n` + transcript
    .map(entry => {
      const modelLine = entry.meta?.modelUsed ? `**Model:** ${entry.meta.modelUsed}\n\n` : '';
      const feedbackLine = entry.meta?.userVote
        ? `**Feedback:** ${entry.meta.userVote === 'up' ? 'Thumbs up' : 'Thumbs down'}\n\n`
        : '';
      const thoughtBlock = renderThoughtSummaryMarkdown(entry.meta?.thoughtSummary);
      return `## ${entry.role === 'user' ? 'User' : 'AtlasMind'}\n\n${modelLine}${feedbackLine}${entry.content}${thoughtBlock}`;
    })
    .join('\n\n');
}

function renderThoughtSummaryMarkdown(thoughtSummary: SessionThoughtSummary | undefined): string {
  if (!thoughtSummary) {
    return '';
  }

  const statusChip = thoughtSummary.status && thoughtSummary.statusLabel
    ? ` <span class="thought-status-chip ${escapeHtmlAttribute(thoughtSummary.status)}">${escapeMarkdownHtml(thoughtSummary.statusLabel)}</span>`
    : '';
  const bulletBlock = thoughtSummary.bullets.length > 0
    ? `\n${thoughtSummary.bullets.map(item => `- ${escapeMarkdownHtml(item)}`).join('\n')}`
    : '';
  return `\n\n<details class="thought-details">\n<summary>${escapeMarkdownHtml(thoughtSummary.label)}${statusChip}</summary>\n\n${escapeMarkdownHtml(thoughtSummary.summary)}${bulletBlock}\n</details>`;
}

function escapeMarkdownHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
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

  if (message.type === 'voteAssistantMessage') {
    return typeof message.payload === 'object'
      && message.payload !== null
      && typeof (message.payload as { entryId?: unknown }).entryId === 'string'
      && isAssistantVoteMessage((message.payload as { vote?: unknown }).vote);
  }

  if (message.type === 'archiveSession') {
    return typeof message.payload === 'string';
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

function isAssistantVoteMessage(value: unknown): value is 'up' | 'down' | 'clear' {
  return value === 'up' || value === 'down' || value === 'clear';
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
    if (!text || text.includes('\0')) {
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