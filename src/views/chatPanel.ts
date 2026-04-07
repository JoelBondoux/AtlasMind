import * as path from 'path';
import * as vscode from 'vscode';
import type { AtlasMindContext } from '../extension.js';
import type {
  SessionConversationSummary,
  SessionSuggestedFollowup,
  SessionThoughtSummary,
  SessionTranscriptEntry,
} from '../chat/sessionConversation.js';
import type {
  PendingToolApprovalRequest,
  ProjectRunRecord,
  TaskImageAttachment,
  ToolApprovalDecision,
} from '../types.js';
import {
  buildRoadmapStatusMarkdown,
  buildAssistantResponseMetadata,
  buildProjectResponseMetadata,
  buildWorkstationContext,
  reconcileAssistantResponse,
  resolveAtlasChatIntent,
  runProjectCommand,
  toApprovedProjectPrompt,
} from '../chat/participant.js';
import { classifyToolInvocation, getToolApprovalMode, requiresToolApproval } from '../core/toolPolicy.js';
import { resolvePickedImageAttachments } from '../chat/imageAttachments.js';
import { getWebviewHtmlShell } from './webviewUtils.js';

type ComposerSendMode = 'send' | 'steer' | 'new-chat' | 'new-session';

type ChatPanelImportedItem =
  | { transport: 'workspace-path'; value: string }
  | { transport: 'url'; value: string }
  | { transport: 'inline-file'; name: string; mimeType?: string; dataBase64: string };

type ChatPanelMessage =
  | { type: 'submitPrompt'; payload: { prompt: string; mode: ComposerSendMode } }
  | { type: 'stopPrompt' }
  | { type: 'voteAssistantMessage'; payload: { entryId: string; vote: 'up' | 'down' | 'clear' } }
  | { type: 'resolveToolApproval'; payload: { requestId: string; decision: ToolApprovalDecision } }
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
  | { type: 'addDroppedItems'; payload: string[] }
  | { type: 'ingestPromptMedia'; payload: { items: ChatPanelImportedItem[] } };

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
  directResponse?: { markdown: string; modelUsed: string };
  commandIntent?: { commandId: string; args?: unknown[]; summary: string };
  terminalDirective?: ManagedTerminalDirective;
  context: Record<string, unknown>;
  imageAttachments: TaskImageAttachment[];
}

export interface ChatPanelTarget {
  sessionId?: string;
  messageId?: string;
  draftPrompt?: string;
  sendMode?: ComposerSendMode;
}

interface ChatPanelState {
  activeSurface: 'chat' | 'run';
  selectedSessionId: string;
  selectedMessageId?: string;
  composerDraft?: string;
  composerMode?: ComposerSendMode;
  sessions: SessionConversationSummary[];
  transcript: SessionTranscriptEntry[];
  pendingToolApprovals: PendingToolApprovalRequest[];
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

interface ChatPanelSuggestedFollowup extends SessionSuggestedFollowup {
  mode?: ComposerSendMode;
}

interface ManagedTerminalAliasSpec {
  alias: string;
  displayName: string;
  shellPath: string;
  markdownLanguage: string;
  approvalArgsPrefix: string[];
}

interface ManagedTerminalDirective {
  alias: string;
  commandLine: string;
  spec: ManagedTerminalAliasSpec;
}

interface ManagedTerminalExecutionResult {
  commandLine: string;
  statusLine: string;
  output: string;
  exitCode?: number;
}

interface ManagedTerminalPlanningDecision {
  shouldRunFollowUp: boolean;
  followUpCommand?: string;
  rationale?: string;
}

interface ActivePromptExecution {
  taskId: string;
  sessionId: string;
  assistantMessageId: string;
  abortController: AbortController;
  cancellationSource: vscode.CancellationTokenSource;
  interrupt?: () => void;
}

interface PendingPromptSubmission {
  prompt: string;
  mode: ComposerSendMode;
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
  private pendingComposerDraft: string | undefined;
  private pendingComposerMode: ComposerSendMode | undefined;
  private pendingPromptSubmission: PendingPromptSubmission | undefined;
  private activePromptExecution: ActivePromptExecution | undefined;
  private readonly onDisposed?: () => void;

  public static createOrShow(context: vscode.ExtensionContext, atlas: AtlasMindContext, target?: string | ChatPanelTarget): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    const normalizedTarget = normalizeChatPanelTarget(target);

    if (ChatPanel.currentPanel) {
      if (normalizedTarget.sessionId || normalizedTarget.messageId || normalizedTarget.draftPrompt) {
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
    this.pendingComposerDraft = initialTarget?.draftPrompt;
    this.pendingComposerMode = initialTarget?.sendMode;
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
    this.disposables.push({
      dispose: this.atlas.toolApprovalManager?.onPendingApprovalsChange?.(() => {
        void this.syncState();
      }) ?? (() => undefined),
    });
    vscode.window.onDidChangeVisibleTextEditors(() => {
      void this.syncState();
    }, null, this.disposables);
    vscode.window.onDidChangeActiveTextEditor(() => {
      void this.syncState();
    }, null, this.disposables);

    void this.syncState();
  }

  public dispose(): void {
    this.activePromptExecution?.abortController.abort();
    this.activePromptExecution?.cancellationSource.dispose();
    this.activePromptExecution = undefined;
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
    this.pendingComposerDraft = normalizedTarget.draftPrompt;
    this.pendingComposerMode = normalizedTarget.sendMode;
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
      case 'stopPrompt':
        await this.stopActivePrompt();
        return;
      case 'voteAssistantMessage':
        await this.handleAssistantVote(message.payload.entryId, message.payload.vote);
        return;
      case 'resolveToolApproval': {
        const resolved = this.atlas.toolApprovalManager?.resolvePendingRequest?.(
          message.payload.requestId,
          message.payload.decision,
        );
        if (resolved) {
          await this.host.webview.postMessage({
            type: 'status',
            payload: describeApprovalDecision(message.payload.decision),
          });
          await this.syncState();
        }
        return;
      }
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
      case 'ingestPromptMedia':
        await this.addImportedItems(message.payload.items);
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
    if (this.activePromptExecution) {
      if (mode === 'steer') {
        const steerPrompt = rawPrompt.trim();
        if (!steerPrompt) {
          await this.host.webview.postMessage({ type: 'status', payload: 'Enter a steer prompt before redirecting the current request.' });
          return;
        }
        this.pendingPromptSubmission = { prompt: steerPrompt, mode };
        await this.stopActivePrompt('Steering the current chat request. AtlasMind will apply your steer prompt next.');
        return;
      }
      await this.host.webview.postMessage({ type: 'status', payload: 'A chat request is already running. Stop it before starting another one.' });
      return;
    }

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
    const preparedRequest = await this.preparePromptRequest(
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
    const taskId = `chat-panel-${Date.now()}`;
    const abortController = new AbortController();
    const cancellationSource = new vscode.CancellationTokenSource();
    const forwardAbort = () => cancellationSource.cancel();
    abortController.signal.addEventListener('abort', forwardAbort, { once: true });
    this.activePromptExecution = {
      taskId,
      sessionId: activeSessionId,
      assistantMessageId,
      abortController,
      cancellationSource,
    };

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
        await this.runProjectPrompt(
          preparedRequest.projectGoal,
          assistantMessageId,
          activeSessionId,
          submittedAttachments,
          cancellationSource.token,
        );
        await this.host.webview.postMessage({ type: 'status', payload: 'Autonomous project run completed.' });
        return;
      }

      if (preparedRequest.directResponse) {
        this.atlas.sessionConversation.updateMessage(
          assistantMessageId,
          preparedRequest.directResponse.markdown,
          activeSessionId,
          {
            modelUsed: preparedRequest.directResponse.modelUsed,
            thoughtSummary: {
              label: 'Action summary',
              summary: 'Returned a live roadmap status summary from the current SSOT files.',
              bullets: ['Used roadmap files on disk instead of snippet-based memory retrieval.'],
            },
          },
        );
        await this.syncState();
        await this.host.webview.postMessage({ type: 'status', payload: 'Roadmap status completed.' });
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

      if (preparedRequest.terminalDirective) {
        await this.runManagedTerminalPrompt(
          preparedRequest,
          assistantMessageId,
          activeSessionId,
          taskId,
          sessionContext,
        );
        return;
      }

      const result = await this.atlas.orchestrator.processTask({
        id: taskId,
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
      }, abortController.signal);

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
      if (isAbortError(error)) {
        const current = this.atlas.sessionConversation
          .getTranscript(activeSessionId)
          .find(entry => entry.id === assistantMessageId)?.content ?? '';
        const stoppedMessage = current.trim().length > 0
          ? `${current}\n\n_Request stopped._`
          : 'Request stopped.';
        this.atlas.sessionConversation.updateMessage(assistantMessageId, stoppedMessage, activeSessionId);
        await this.syncState();
        await this.host.webview.postMessage({ type: 'status', payload: 'Stopped the current chat request.' });
      } else {
        const message = error instanceof Error ? error.message : String(error);
        this.atlas.sessionConversation.updateMessage(assistantMessageId, `Request failed: ${message}`, activeSessionId);
        await this.syncState();
        await this.host.webview.postMessage({ type: 'status', payload: `Chat request failed: ${message}` });
      }
    } finally {
      let pendingSubmission: PendingPromptSubmission | undefined;
      if (this.activePromptExecution?.taskId === taskId) {
        abortController.signal.removeEventListener('abort', forwardAbort);
        cancellationSource.dispose();
        this.activePromptExecution = undefined;
        pendingSubmission = this.pendingPromptSubmission;
        this.pendingPromptSubmission = undefined;
      }
      await this.host.webview.postMessage({ type: 'busy', payload: false });
      if (pendingSubmission) {
        await this.runPrompt(pendingSubmission.prompt, pendingSubmission.mode);
      }
    }
  }

  private async stopActivePrompt(statusMessage = 'Stopping the current chat request...'): Promise<void> {
    if (!this.activePromptExecution) {
      await this.host.webview.postMessage({ type: 'status', payload: 'No active chat request is running.' });
      return;
    }

    this.atlas.toolApprovalManager?.clearTask?.(this.activePromptExecution.taskId);
    this.activePromptExecution.interrupt?.();
    this.activePromptExecution.abortController.abort();
    await this.host.webview.postMessage({ type: 'status', payload: statusMessage });
  }

  private async runManagedTerminalPrompt(
    preparedRequest: PreparedPromptRequest,
    assistantMessageId: string,
    activeSessionId: string,
    taskId: string,
    sessionContext: string,
  ): Promise<void> {
    const directive = preparedRequest.terminalDirective;
    if (!directive) {
      return;
    }

    await this.ensureManagedTerminalAllowed(directive, taskId);

    const terminal = this.getOrCreateManagedTerminal(directive);
    const executions: ManagedTerminalExecutionResult[] = [];
    const renderManagedTerminal = async (
      status: string,
      analysis = '',
      metadata?: ReturnType<typeof buildAssistantResponseMetadata>,
    ): Promise<void> => {
      this.atlas.sessionConversation.updateMessage(
        assistantMessageId,
        renderManagedTerminalMarkdown(directive, status, executions, analysis),
        activeSessionId,
        metadata,
      );
      await this.syncState();
    };

    await renderManagedTerminal('Launching managed terminal...', '');
    terminal.show(true);

    let shellIntegration = terminal.shellIntegration;
    if (!shellIntegration) {
      await renderManagedTerminal('Waiting for shell integration...');
      shellIntegration = await waitForTerminalShellIntegration(terminal, this.activePromptExecution?.abortController.signal);
    }

    if (!shellIntegration) {
      throw new Error('Shell integration was not available for the managed terminal. Enable terminal shell integration and try again.');
    }

    await this.executeManagedTerminalCommand(
      shellIntegration,
      terminal,
      directive,
      directive.commandLine,
      taskId,
      executions,
      renderManagedTerminal,
    );

    const followUpDecision = await this.planManagedTerminalFollowUp(
      preparedRequest,
      directive,
      activeSessionId,
      assistantMessageId,
      taskId,
      executions,
      renderManagedTerminal,
    );

    if (followUpDecision.shouldRunFollowUp && followUpDecision.followUpCommand) {
      await this.ensureManagedTerminalAllowed({
        ...directive,
        commandLine: followUpDecision.followUpCommand,
      }, taskId);
      await renderManagedTerminal(
        followUpDecision.rationale?.trim().length
          ? `Running one Atlas-requested follow-up command. ${followUpDecision.rationale}`
          : 'Running one Atlas-requested follow-up command.',
      );
      await this.executeManagedTerminalCommand(
        shellIntegration,
        terminal,
        directive,
        followUpDecision.followUpCommand,
        taskId,
        executions,
        renderManagedTerminal,
      );
    }

    const finalContext = this.buildManagedTerminalContext(
      preparedRequest.context,
      activeSessionId,
      assistantMessageId,
      directive,
      executions,
    );
    const finalPrompt = buildManagedTerminalFinalPrompt(preparedRequest.userMessage, directive, executions);

    let streamedText = '';
    const progressNotes: string[] = [];
    const renderAnalysis = async (): Promise<void> => {
      const noteBlock = progressNotes.length > 0
        ? progressNotes.map(note => `_Thinking: ${note}_`).join('\n\n')
        : '';
      const combinedAnalysis = [noteBlock, streamedText].filter(part => part.length > 0).join('\n\n');
      await renderManagedTerminal('Preparing the managed terminal summary...', combinedAnalysis);
    };

    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const result = await this.atlas.orchestrator.processTask({
      id: taskId,
      userMessage: finalPrompt,
      context: finalContext,
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
        await renderAnalysis();
      } catch (error) {
        console.error('[AtlasMind] Failed to stream managed terminal analysis chunk.', error);
      }
    }, async message => {
      if (!message.trim()) {
        return;
      }
      progressNotes.push(message.trim());
      try {
        await renderAnalysis();
      } catch (error) {
        console.error('[AtlasMind] Failed to stream managed terminal analysis progress.', error);
      }
    }, this.activePromptExecution?.abortController.signal);

    const reconciled = reconcileAssistantResponse(streamedText, result.response);
    await renderManagedTerminal(
      followUpDecision.shouldRunFollowUp && followUpDecision.followUpCommand
        ? 'Managed terminal run completed after one Atlas follow-up command.'
        : 'Managed terminal run completed.',
      reconciled.transcriptText,
      buildAssistantResponseMetadata(preparedRequest.userMessage, result, {
        hasSessionContext: Boolean(sessionContext),
        routingContext: {
          ...finalContext,
          ...(sessionContext ? { sessionContext } : {}),
        },
      }),
    );

    if (configuration.get<boolean>('voice.ttsEnabled', false)) {
      this.atlas.voiceManager.speak(reconciled.transcriptText);
    }
    await this.host.webview.postMessage({ type: 'status', payload: `Managed terminal follow-up ready via ${result.modelUsed}.` });
  }

  private async executeManagedTerminalCommand(
    shellIntegration: vscode.TerminalShellIntegration,
    terminal: vscode.Terminal,
    directive: ManagedTerminalDirective,
    commandLine: string,
    taskId: string,
    executions: ManagedTerminalExecutionResult[],
    renderManagedTerminal: (status: string, analysis?: string, metadata?: ReturnType<typeof buildAssistantResponseMetadata>) => Promise<void>,
  ): Promise<void> {
    const executionRecord: ManagedTerminalExecutionResult = {
      commandLine,
      statusLine: 'Launching command...',
      output: '',
    };
    executions.push(executionRecord);
    await renderManagedTerminal(`Running command ${executions.length}...`);

    const execution = shellIntegration.executeCommand(commandLine);
    const executionEnd = waitForTerminalExecutionEnd(terminal, execution, this.activePromptExecution?.abortController.signal);
    if (this.activePromptExecution?.taskId === taskId) {
      this.activePromptExecution.interrupt = () => {
        try {
          terminal.sendText('\u0003', false);
        } catch (error) {
          console.warn('[AtlasMind] Failed to interrupt managed terminal execution.', error);
        }
      };
    }

    const outputReader = (async () => {
      for await (const chunk of execution.read()) {
        if (!chunk) {
          continue;
        }
        executionRecord.output = appendManagedTerminalOutput(executionRecord.output, stripAnsi(chunk));
        executionRecord.statusLine = 'Running...';
        try {
          await renderManagedTerminal(`Running command ${executions.length}...`);
        } catch (error) {
          console.error('[AtlasMind] Failed to stream managed terminal output.', error);
        }
      }
    })();

    const exitCode = await executionEnd;
    await outputReader;
    executionRecord.exitCode = exitCode;
    executionRecord.statusLine = typeof exitCode === 'number'
      ? `Completed with exit code ${exitCode}.`
      : 'Completed.';
    await renderManagedTerminal(`Command ${executions.length} completed.`);
  }

  private buildManagedTerminalContext(
    baseContext: Record<string, unknown>,
    activeSessionId: string,
    assistantMessageId: string,
    directive: ManagedTerminalDirective,
    executions: readonly ManagedTerminalExecutionResult[],
  ): Record<string, unknown> {
    const latestExecution = executions.at(-1);
    return {
      ...baseContext,
      chatSessionId: activeSessionId,
      chatMessageId: assistantMessageId,
      managedTerminal: {
        alias: directive.alias,
        displayName: directive.spec.displayName,
        commandLine: latestExecution?.commandLine ?? directive.commandLine,
        exitCode: latestExecution?.exitCode,
        output: truncateManagedTerminalContext(latestExecution?.output ?? ''),
        commandHistory: executions.map(execution => ({
          commandLine: execution.commandLine,
          exitCode: execution.exitCode,
          output: truncateManagedTerminalContext(execution.output),
        })),
      },
    };
  }

  private async planManagedTerminalFollowUp(
    preparedRequest: PreparedPromptRequest,
    directive: ManagedTerminalDirective,
    activeSessionId: string,
    assistantMessageId: string,
    taskId: string,
    executions: readonly ManagedTerminalExecutionResult[],
    renderManagedTerminal: (status: string, analysis?: string, metadata?: ReturnType<typeof buildAssistantResponseMetadata>) => Promise<void>,
  ): Promise<ManagedTerminalPlanningDecision> {
    await renderManagedTerminal('AtlasMind is deciding whether one extra terminal command would materially improve the answer...');

    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const planningContext = this.buildManagedTerminalContext(
      preparedRequest.context,
      activeSessionId,
      assistantMessageId,
      directive,
      executions,
    );
    const planningResult = await this.atlas.orchestrator.processTask({
      id: `${taskId}-terminal-plan`,
      userMessage: buildManagedTerminalPlanningPrompt(preparedRequest.userMessage, directive, executions),
      context: planningContext,
      constraints: {
        budget: toBudgetMode(configuration.get<string>('budgetMode')),
        speed: toSpeedMode(configuration.get<string>('speedMode')),
      },
      timestamp: new Date().toISOString(),
    }, undefined, undefined, this.activePromptExecution?.abortController.signal);

    return parseManagedTerminalPlanningDecision(planningResult.response);
  }

  private async runProjectPrompt(
    projectGoal: string,
    assistantMessageId: string,
    activeSessionId: string,
    attachments: ChatComposerAttachment[],
    token: vscode.CancellationToken,
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
      token,
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
      ...(this.pendingComposerDraft ? { composerDraft: this.pendingComposerDraft, composerMode: this.pendingComposerMode ?? 'send' } : {}),
      sessions,
      transcript,
      pendingToolApprovals: this.atlas.toolApprovalManager?.listPendingRequests?.() ?? [],
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
    this.pendingComposerDraft = undefined;
    this.pendingComposerMode = undefined;
  }

  private async preparePromptRequest(
    prompt: string,
    attachments: ChatComposerAttachment[],
    mode: ComposerSendMode,
    sessionContext: string,
    activeSessionId: string,
  ): Promise<PreparedPromptRequest> {
    const forceSteer = mode === 'steer';
    const terminalDirectiveResolution = forceSteer ? undefined : resolveManagedTerminalDirective(prompt);
    if (terminalDirectiveResolution?.errorMarkdown) {
      return {
        userMessage: prompt,
        directResponse: {
          markdown: terminalDirectiveResolution.errorMarkdown,
          modelUsed: 'atlasmind/managed-terminal',
        },
        context: {},
        imageAttachments: [],
      };
    }

    const routedIntent = forceSteer
      ? undefined
      : resolveAtlasChatIntent(prompt, this.atlas.sessionConversation.getTranscript(activeSessionId));
    const projectGoal = routedIntent?.kind === 'project' ? routedIntent.goal : undefined;
    const commandIntent = routedIntent?.kind === 'command'
      ? {
          commandId: routedIntent.commandId,
          ...(routedIntent.args ? { args: routedIntent.args } : {}),
          summary: routedIntent.summary,
        }
      : undefined;
    const roadmapStatusMarkdown = forceSteer ? undefined : await buildRoadmapStatusMarkdown(prompt);
    const imageAttachments = attachments
      .map(item => item.imageAttachment)
      .filter((item): item is TaskImageAttachment => Boolean(item));
    const attachmentNote = buildAttachmentContextBlock(attachments);
    const userMessage = forceSteer
      ? [
          'The operator is steering the current AtlasMind response. Replace the prior in-flight direction with this updated instruction and continue from there.',
          prompt,
        ].join('\n\n')
      : prompt;
    const context: Record<string, unknown> = {
      ...(sessionContext ? { sessionContext } : {}),
      ...(buildWorkstationContext() ? { workstationContext: buildWorkstationContext() } : {}),
      ...(attachmentNote ? { attachmentContext: attachmentNote } : {}),
      ...(imageAttachments.length > 0 ? { imageAttachments } : {}),
      ...(forceSteer ? { steerInstruction: prompt } : {}),
    };

    return {
      userMessage,
      projectGoal,
      ...(roadmapStatusMarkdown ? { directResponse: { markdown: roadmapStatusMarkdown, modelUsed: 'atlasmind/roadmap-status' } } : {}),
      commandIntent,
      ...(terminalDirectiveResolution?.directive ? { terminalDirective: terminalDirectiveResolution.directive } : {}),
      context,
      imageAttachments,
    };
  }

  private async ensureManagedTerminalAllowed(directive: ManagedTerminalDirective, taskId: string): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('atlasmind');
    if (!configuration.get<boolean>('allowTerminalWrite', false)) {
      throw new Error('Managed terminal launches are disabled. Enable atlasmind.allowTerminalWrite to use @t aliases.');
    }

    const policy = classifyToolInvocation('terminal-run', {
      command: directive.spec.shellPath,
      args: [...directive.spec.approvalArgsPrefix, directive.commandLine],
    });

    if (this.atlas.toolApprovalManager?.shouldBypass(taskId, policy.category)) {
      return;
    }

    const approvalMode = getToolApprovalMode(configuration.get<string>('toolApprovalMode'));
    if (!requiresToolApproval(approvalMode, policy)) {
      return;
    }

    const decision = await this.atlas.toolApprovalManager.requestApproval({
      taskId,
      toolName: `managed-terminal/${directive.alias}`,
      category: policy.category,
      summary: `Launch ${directive.spec.displayName} via @t${directive.alias}: ${truncateToolApprovalSummary(directive.commandLine)}`,
      risk: policy.risk,
    });

    switch (decision) {
      case 'allow-once':
        return;
      case 'bypass-task':
        this.atlas.toolApprovalManager.bypassTask(taskId);
        return;
      case 'autopilot':
        this.atlas.toolApprovalManager.enableAutopilot();
        return;
      case 'deny':
      default:
        throw new Error(`Managed terminal launch denied for @t${directive.alias}.`);
    }
  }

  private getOrCreateManagedTerminal(directive: ManagedTerminalDirective): vscode.Terminal {
    const terminalName = getManagedTerminalName(directive.alias, directive.spec.displayName);
    const existing = vscode.window.terminals.find(terminal => terminal.name === terminalName);
    if (existing) {
      return existing;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    return vscode.window.createTerminal({
      name: terminalName,
      shellPath: directive.spec.shellPath,
      cwd: workspaceFolder?.uri,
      isTransient: false,
    });
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
    const importedItems: ChatPanelImportedItem[] = items.map(item => {
      const trimmed = item.trim();
      return looksLikeUrl(trimmed)
        ? { transport: 'url' as const, value: trimmed }
        : { transport: 'workspace-path' as const, value: trimmed };
    });
    await this.addImportedItems(importedItems, workspaceRoot);
  }

  private async addImportedItems(
    items: readonly ChatPanelImportedItem[],
    workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  ): Promise<void> {
    const nextAttachments = [...this.composerAttachments];
    for (const item of items) {
      const attachment = await resolveImportedAttachment(item, workspaceRoot);
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
          <div class="chat-column">
            <main class="main-panel">
              <section class="panel-header">
                <div>
                  <div class="eyebrow">Dedicated Workspace</div>
                  <h2 id="panelTitle">AtlasMind Chat</h2>
                  <p id="panelSubtitle" class="panel-subtitle">Persistent workspace chat threads with direct access to recent autonomous runs.</p>
                </div>
                <div class="row toolbar-row">
                  <div class="font-size-controls" aria-label="Adjust chat font size">
                    <button id="decreaseFontSize" class="icon-btn compact-icon-btn" type="button" title="Smaller chat text" aria-label="Smaller chat text">A-</button>
                    <button id="increaseFontSize" class="icon-btn compact-icon-btn" type="button" title="Larger chat text" aria-label="Larger chat text">A+</button>
                  </div>
                  <button id="clearConversation">Clear</button>
                  <button id="copyTranscript">Copy</button>
                  <button id="saveTranscript">Open as Markdown</button>
                </div>
              </section>
              <div id="status" class="status-label">Ready.</div>
              <section id="pendingApprovals" class="approval-stack hidden" aria-live="polite"></section>
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
                  <button id="stopPrompt" class="danger-btn hidden" type="button">Stop</button>
                </div>
                <span id="composerHint" class="hint-label">Enter sends. Shift+Enter newline.</span>
              </div>
            </section>
            <div id="status" class="status-label">Ready.</div>
            <section id="pendingApprovals" class="approval-stack hidden" aria-live="polite"></section>
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
                <button id="stopPrompt" class="danger-btn hidden" type="button">Stop</button>
              </div>
              <span id="composerHint" class="hint-label">Enter sends. Shift+Enter newline.</span>
            </div>
          </section>
        </div>
      `,
      extraCss: `
        html, body {
          height: 100%;
        }
        body {
          margin: 0;
          padding: 0 !important;
          overflow: hidden;
        }

        /* ---- Shell layout: vertical flex, full viewport ---- */
        .chat-shell {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
          overflow: hidden;
          --atlas-chat-font-scale: 1;
        }
        .chat-column {
          flex: 1 1 0;
          min-width: 0;
          min-height: 0;
          display: flex;
          flex-direction: column;
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
          .chat-shell[data-layout="wide"] .chat-column {
            flex: 1 1 0;
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
            cursor: pointer;
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
          .chat-shell[data-layout="wide"][data-session-rail="collapsed"] .session-rail {
            width: 48px;
            min-width: 48px;
          }
          .chat-shell[data-layout="wide"][data-session-rail="collapsed"] .session-rail-header {
            justify-content: center;
            padding: 8px 4px 6px;
          }
          .chat-shell[data-layout="wide"][data-session-rail="collapsed"] .toggle-label,
          .chat-shell[data-layout="wide"][data-session-rail="collapsed"] .session-count-badge,
          .chat-shell[data-layout="wide"][data-session-rail="collapsed"] .create-session-btn {
            display: none;
          }
          .chat-shell[data-layout="wide"][data-session-rail="collapsed"] .session-toggle {
            justify-content: center;
          }
          .chat-shell[data-layout="wide"][data-session-rail="collapsed"] .session-drawer {
            display: none;
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
        .approval-stack {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .approval-stack.hidden {
          display: none;
        }
        .approval-card {
          border: 1px solid color-mix(in srgb, var(--vscode-button-background) 45%, var(--vscode-widget-border, #444));
          border-radius: 10px;
          padding: 10px 12px;
          background: color-mix(in srgb, var(--vscode-button-background) 10%, var(--vscode-editor-background));
        }
        .approval-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 6px;
          flex-wrap: wrap;
        }
        .approval-card-title {
          font-size: 0.82rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--vscode-descriptionForeground);
        }
        .approval-risk-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 0.72rem;
          border: 1px solid var(--vscode-widget-border, #444);
        }
        .approval-risk-badge.high {
          background: color-mix(in srgb, var(--vscode-inputValidation-errorBackground, #5a1d1d) 65%, transparent);
        }
        .approval-risk-badge.medium {
          background: color-mix(in srgb, var(--vscode-inputValidation-warningBackground, #5a451d) 60%, transparent);
        }
        .approval-risk-badge.low {
          background: color-mix(in srgb, var(--vscode-badge-background, var(--vscode-button-background)) 25%, transparent);
        }
        .approval-tool-name {
          font-weight: 700;
          margin-bottom: 4px;
        }
        .approval-meta {
          color: var(--vscode-descriptionForeground);
          font-size: 0.84em;
          margin-bottom: 8px;
        }
        .approval-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .approval-actions button.danger {
          border-color: color-mix(in srgb, var(--vscode-inputValidation-errorBorder, #be1100) 70%, var(--vscode-widget-border, #444));
        }
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
          min-width: 0;
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
          font-size: calc(0.95rem * var(--atlas-chat-font-scale));
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
        .font-size-controls {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          margin-right: 2px;
        }
        .font-size-controls .compact-icon-btn {
          min-width: 28px;
          width: 28px;
          font-size: 0.68rem;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        .font-size-controls .compact-icon-btn:disabled {
          opacity: 0.55;
          cursor: default;
        }
        .chat-content {
          word-break: break-word;
          line-height: 1.55;
        }
        .chat-content > :first-child {
          margin-top: 0;
        }
        .chat-content > :last-child {
          margin-bottom: 0;
        }
        .chat-content p,
        .chat-content ul,
        .chat-content ol,
        .chat-content pre,
        .chat-content blockquote,
        .chat-content hr {
          margin: 0 0 10px;
        }
        .chat-content h1,
        .chat-content h2,
        .chat-content h3,
        .chat-content h4,
        .chat-content h5,
        .chat-content h6 {
          margin: 0 0 8px;
          line-height: 1.3;
        }
        .chat-content h1 {
          font-size: 1.1rem;
        }
        .chat-content h2 {
          font-size: 1rem;
        }
        .chat-content h3,
        .chat-content h4,
        .chat-content h5,
        .chat-content h6 {
          font-size: 0.92rem;
        }
        .chat-content ul,
        .chat-content ol {
          padding-left: 20px;
        }
        .chat-content li + li {
          margin-top: 4px;
        }
        .chat-content code {
          font-family: var(--vscode-editor-font-family, Consolas, 'Courier New', monospace);
          font-size: 0.92em;
          padding: 1px 5px;
          border-radius: 6px;
          background: color-mix(in srgb, var(--vscode-textCodeBlock-background, var(--vscode-editor-background)) 82%, transparent);
        }
        .chat-content pre {
          overflow-x: auto;
          padding: 10px 12px;
          border-radius: 8px;
          border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 78%, transparent);
          background: color-mix(in srgb, var(--vscode-textCodeBlock-background, var(--vscode-editor-background)) 90%, transparent);
        }
        .chat-content pre code {
          padding: 0;
          border-radius: 0;
          background: transparent;
        }
        .chat-content blockquote {
          margin-left: 0;
          padding-left: 12px;
          border-left: 3px solid color-mix(in srgb, var(--vscode-button-background) 45%, var(--vscode-widget-border, #444));
          color: var(--vscode-descriptionForeground, var(--vscode-foreground));
        }
        .chat-content a {
          color: var(--vscode-textLink-foreground, var(--vscode-foreground));
          text-decoration: underline;
        }
        .chat-content hr {
          border: 0;
          border-top: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 78%, transparent);
        }
        .chat-content .thinking-note {
          font-size: 0.9em;
          color: color-mix(in srgb, var(--vscode-descriptionForeground, #999) 88%, var(--vscode-foreground));
          font-style: italic;
        }
        .assistant-footer {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
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
        .assistant-followups {
          display: flex;
          flex: 1 1 100%;
          flex-direction: column;
          gap: 8px;
          margin-top: 2px;
        }
        .assistant-followup-question {
          color: var(--vscode-descriptionForeground, var(--vscode-foreground));
          font-size: 0.82rem;
        }
        .assistant-followup-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .assistant-followup-chip {
          appearance: none;
          border: 1px solid var(--vscode-widget-border, #444);
          background: color-mix(in srgb, var(--vscode-button-background) 10%, transparent);
          color: var(--vscode-foreground);
          border-radius: 999px;
          padding: 4px 10px;
          font-size: 0.78rem;
          cursor: pointer;
        }
        .assistant-followup-chip:hover {
          background: color-mix(in srgb, var(--vscode-button-background) 18%, transparent);
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
          color: color-mix(in srgb, var(--vscode-descriptionForeground) 88%, var(--vscode-foreground));
          font-size: 0.92em;
        }
        .thought-list {
          margin: 8px 0 0 16px;
          padding: 0;
          color: color-mix(in srgb, var(--vscode-descriptionForeground) 88%, var(--vscode-foreground));
          font-size: 0.92em;
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
          transform-origin: center;
          animation: atlas-spin 2.6s linear infinite;
          transform-box: view-box;
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
        .danger-btn {
          padding: 4px 12px;
          font-size: 0.88em;
          border: 1px solid color-mix(in srgb, var(--vscode-errorForeground, #f14c4c) 40%, var(--vscode-widget-border, #444));
          background: color-mix(in srgb, var(--vscode-errorForeground, #f14c4c) 12%, transparent);
          color: var(--vscode-errorForeground, #f14c4c);
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
    ...(typeof target.draftPrompt === 'string' && target.draftPrompt.trim().length > 0 ? { draftPrompt: target.draftPrompt.trim() } : {}),
    ...(target.sendMode === 'send' || target.sendMode === 'steer' || target.sendMode === 'new-chat' || target.sendMode === 'new-session' ? { sendMode: target.sendMode } : {}),
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
      const followupBlock = renderSuggestedFollowupsMarkdown(entry.meta?.followupQuestion, entry.meta?.suggestedFollowups);
      return `## ${entry.role === 'user' ? 'User' : 'AtlasMind'}\n\n${modelLine}${feedbackLine}${entry.content}${thoughtBlock}${followupBlock}`;
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

function renderSuggestedFollowupsMarkdown(
  followupQuestion: string | undefined,
  suggestedFollowups: readonly ChatPanelSuggestedFollowup[] | undefined,
): string {
  if (!followupQuestion || !suggestedFollowups || suggestedFollowups.length === 0) {
    return '';
  }

  return `\n\n**Next step:** ${escapeMarkdownHtml(followupQuestion)}\n\n${suggestedFollowups
    .map(item => `- ${escapeMarkdownHtml(item.label)}`)
    .join('\n')}`;
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
    || message.type === 'stopPrompt'
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

  if (message.type === 'resolveToolApproval') {
    return typeof message.payload === 'object'
      && message.payload !== null
      && typeof (message.payload as { requestId?: unknown }).requestId === 'string'
      && isToolApprovalDecision((message.payload as { decision?: unknown }).decision);
  }

  if (message.type === 'archiveSession') {
    return typeof message.payload === 'string';
  }

  if (message.type === 'addDroppedItems') {
    return Array.isArray(message.payload) && message.payload.every(item => typeof item === 'string');
  }

  if (message.type === 'ingestPromptMedia') {
    return typeof message.payload === 'object'
      && message.payload !== null
      && Array.isArray((message.payload as { items?: unknown }).items)
      && ((message.payload as { items?: unknown[] }).items ?? []).every(isChatPanelImportedItem);
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

function resolveManagedTerminalDirective(prompt: string): { directive?: ManagedTerminalDirective; errorMarkdown?: string } | undefined {
  const match = prompt.match(/^\s*@t([a-z0-9_-]+)\s+([\s\S]+?)\s*$/i);
  if (!match) {
    return undefined;
  }

  const alias = match[1].toLowerCase();
  const commandLine = match[2].trim();
  if (!commandLine) {
    return {
      errorMarkdown: 'Managed terminal launch requires a command. Use `@tps <command>`.',
    };
  }

  const unsupportedAliasReason = getUnsupportedManagedTerminalAliasReason(alias);
  if (unsupportedAliasReason) {
    return {
      errorMarkdown: unsupportedAliasReason,
    };
  }

  const spec = resolveManagedTerminalAlias(alias);
  if (!spec) {
    return {
      errorMarkdown: [
        `Unsupported managed terminal alias \`@t${alias}\`.`,
        '',
        'Supported aliases:',
        ...listManagedTerminalAliasHelpLines(),
      ].join('\n'),
    };
  }

  return {
    directive: {
      alias,
      commandLine,
      spec,
    },
  };
}

function resolveManagedTerminalAlias(alias: string): ManagedTerminalAliasSpec | undefined {
  switch (alias) {
    case 'ps':
    case 'powershell':
    case 'windowspowershell':
    case 'winps':
      return {
        alias: 'ps',
        displayName: 'Windows PowerShell',
        shellPath: process.platform === 'win32' ? 'powershell.exe' : 'pwsh',
        markdownLanguage: 'powershell',
        approvalArgsPrefix: ['-Command'],
      };
    case 'pwsh':
    case 'powershell7':
    case 'ps7':
    case 'psh':
      return {
        alias: 'pwsh',
        displayName: 'PowerShell 7',
        shellPath: 'pwsh',
        markdownLanguage: 'powershell',
        approvalArgsPrefix: ['-Command'],
      };
    case 'cmd':
    case 'commandprompt':
    case 'prompt':
    case 'dos':
      return process.platform === 'win32'
        ? {
            alias: 'cmd',
            displayName: 'Command Prompt',
            shellPath: 'cmd.exe',
            markdownLanguage: 'bat',
            approvalArgsPrefix: ['/c'],
          }
        : undefined;
    case 'bash':
    case 'gitbash':
    case 'git':
    case 'shell':
      return {
        alias: 'bash',
        displayName: 'Bash',
        shellPath: process.platform === 'win32' ? 'bash.exe' : 'bash',
        markdownLanguage: 'bash',
        approvalArgsPrefix: ['-lc'],
      };
    case 'sh':
    case 'posix':
      return process.platform === 'win32'
        ? undefined
        : {
            alias: 'sh',
            displayName: 'POSIX shell',
            shellPath: 'sh',
            markdownLanguage: 'sh',
            approvalArgsPrefix: ['-lc'],
          };
    case 'zsh':
    case 'zshell':
      return process.platform === 'win32'
        ? undefined
        : {
            alias: 'zsh',
            displayName: 'Z shell',
            shellPath: 'zsh',
            markdownLanguage: 'zsh',
            approvalArgsPrefix: ['-lc'],
          };
    default:
      return undefined;
  }
}

function getUnsupportedManagedTerminalAliasReason(alias: string): string | undefined {
  switch (alias) {
    case 'jdt':
    case 'javascriptdebugterminal':
      return 'The `@tjdt` alias is not available yet. JavaScript Debug Terminal is a VS Code profile-backed terminal rather than a local shell executable, and the current managed runner depends on shell integration plus direct command execution and streamed reads from a shell-backed terminal.';
    case 'acsb':
    case 'azurecloudshellbash':
      return 'The `@tacsb` alias is not available yet. Azure Cloud Shell Bash is a remote Azure-backed terminal, and the current managed runner only supports local shell-backed terminals that can be created with a concrete shell path and then driven through VS Code shell integration.';
    case 'acsp':
    case 'azurecloudshellps':
    case 'azurecloudshellpowershell':
      return 'The `@tacsp` alias is not available yet. Azure Cloud Shell PowerShell is a remote Azure-backed terminal, and the current managed runner only supports local shell-backed terminals that can be created with a concrete shell path and then driven through VS Code shell integration.';
    default:
      return undefined;
  }
}

function listManagedTerminalAliasHelpLines(): string[] {
  return [
    '- `@tps`, `@tpowershell`, `@twindowspowershell`, or `@twinps` for Windows PowerShell',
    '- `@tpwsh`, `@tpowershell7`, `@tps7`, or `@tpsh` for PowerShell 7',
    '- `@tbash`, `@tgit`, `@tgitbash`, or `@tshell` for Bash',
    ...(process.platform === 'win32'
      ? ['- `@tcmd`, `@tcommandprompt`, `@tprompt`, or `@tdos` for Command Prompt']
      : ['- `@tsh` or `@tposix` for POSIX sh', '- `@tzsh` or `@tzshell` for Z shell']),
  ];
}

function getManagedTerminalName(alias: string, displayName: string): string {
  return `AtlasMind Terminal (${alias}:${displayName})`;
}

function renderManagedTerminalMarkdown(
  directive: ManagedTerminalDirective,
  status: string,
  executions: readonly ManagedTerminalExecutionResult[],
  analysis: string,
): string {
  const codeFence = '```';
  const sections = [
    '### Managed Terminal',
    `Terminal: ${directive.spec.displayName}`,
    `Alias: @t${directive.alias}`,
    `Status: ${status}`,
  ];

  if (executions.length === 0) {
    sections.push(`Command:\n\n${codeFence}${directive.spec.markdownLanguage}\n${directive.commandLine}\n${codeFence}`);
  }

  for (const [index, execution] of executions.entries()) {
    sections.push(`Command ${index + 1}:\n\n${codeFence}${directive.spec.markdownLanguage}\n${execution.commandLine}\n${codeFence}`);
    sections.push(`Result: ${execution.statusLine}`);
    if (execution.output.trim().length > 0) {
      sections.push(`Output ${index + 1}:\n\n${codeFence}text\n${truncateManagedTerminalTranscript(execution.output)}\n${codeFence}`);
    }
  }

  if (analysis.trim().length > 0) {
    sections.push(`### Atlas Follow-up\n\n${analysis}`);
  }

  return sections.join('\n\n');
}

function appendManagedTerminalOutput(current: string, chunk: string): string {
  if (!chunk) {
    return current;
  }
  const normalizedChunk = chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return (current + normalizedChunk).slice(-24000);
}

function truncateManagedTerminalTranscript(output: string): string {
  if (output.length <= 12000) {
    return output;
  }
  return `... output truncated ...\n${output.slice(-12000)}`;
}

function truncateManagedTerminalContext(output: string): string {
  if (output.length <= 8000) {
    return output;
  }
  return `... output truncated ...\n${output.slice(-8000)}`;
}

function buildManagedTerminalFollowUpPrompt(
  originalPrompt: string,
  directive: ManagedTerminalDirective,
  executions: readonly ManagedTerminalExecutionResult[],
): string {
  return [
    `The user launched a managed terminal session with @t${directive.alias}.`,
    `Original request: ${originalPrompt}`,
    `Terminal: ${directive.spec.displayName}`,
    ...executions.flatMap((execution, index) => {
      const exitSummary = typeof execution.exitCode === 'number'
        ? `Command ${index + 1} exited with code ${execution.exitCode}.`
        : `Command ${index + 1} completed.`;
      return [
        `Command ${index + 1}:\n${execution.commandLine}`,
        exitSummary,
        `Output ${index + 1}:\n${truncateManagedTerminalContext(execution.output) || '(no output)'}`,
      ];
    }),
    'Continue the interaction based on the terminal result. Summarize what happened, explain any issues, and recommend or perform the next AtlasMind action if useful.',
  ].join('\n\n');
}

function buildManagedTerminalPlanningPrompt(
  originalPrompt: string,
  directive: ManagedTerminalDirective,
  executions: readonly ManagedTerminalExecutionResult[],
): string {
  return [
    `The user launched a managed terminal session with @t${directive.alias}.`,
    `Original request: ${originalPrompt}`,
    'You are deciding whether exactly one additional terminal command in the same shell session would materially improve the answer.',
    'You may request at most one follow-up command. Do not ask for a shell prefix or a new @t alias. Return only plain text in one of these formats:',
    'DECISION: STOP\nRATIONALE: <one sentence>',
    'DECISION: RUN\nCOMMAND: <single-line command>\nRATIONALE: <one sentence>',
    ...executions.flatMap((execution, index) => {
      const exitSummary = typeof execution.exitCode === 'number'
        ? `Command ${index + 1} exited with code ${execution.exitCode}.`
        : `Command ${index + 1} completed.`;
      return [
        `Command ${index + 1}: ${execution.commandLine}`,
        exitSummary,
        `Output ${index + 1}:\n${truncateManagedTerminalContext(execution.output) || '(no output)'}`,
      ];
    }),
    'Choose STOP unless one more command is clearly necessary for evidence gathering.',
  ].join('\n\n');
}

function buildManagedTerminalFinalPrompt(
  originalPrompt: string,
  directive: ManagedTerminalDirective,
  executions: readonly ManagedTerminalExecutionResult[],
): string {
  return buildManagedTerminalFollowUpPrompt(originalPrompt, directive, executions);
}

function parseManagedTerminalPlanningDecision(response: string): ManagedTerminalPlanningDecision {
  const decisionMatch = response.match(/(^|\n)DECISION:\s*(RUN|STOP)\s*$/im);
  const rationaleMatch = response.match(/(^|\n)RATIONALE:\s*(.+)$/im);
  if (!decisionMatch) {
    return { shouldRunFollowUp: false };
  }

  if (decisionMatch[2].toUpperCase() !== 'RUN') {
    return {
      shouldRunFollowUp: false,
      ...(rationaleMatch?.[2]?.trim() ? { rationale: rationaleMatch[2].trim() } : {}),
    };
  }

  const commandMatch = response.match(/(^|\n)COMMAND:\s*(.+)$/im);
  const followUpCommand = sanitizeManagedTerminalCommand(commandMatch?.[2]);
  if (!followUpCommand) {
    return {
      shouldRunFollowUp: false,
      ...(rationaleMatch?.[2]?.trim() ? { rationale: rationaleMatch[2].trim() } : {}),
    };
  }

  return {
    shouldRunFollowUp: true,
    followUpCommand,
    ...(rationaleMatch?.[2]?.trim() ? { rationale: rationaleMatch[2].trim() } : {}),
  };
}

function sanitizeManagedTerminalCommand(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.replace(/[\r\n]+/g, ' ').trim();
  if (!normalized || normalized.length > 240) {
    return undefined;
  }
  if (/^@t[a-z0-9_-]+\b/i.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function truncateToolApprovalSummary(commandLine: string): string {
  return commandLine.length > 120 ? `${commandLine.slice(0, 117)}...` : commandLine;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, '');
}

async function waitForTerminalShellIntegration(
  terminal: vscode.Terminal,
  signal?: AbortSignal,
): Promise<vscode.TerminalShellIntegration | undefined> {
  if (terminal.shellIntegration) {
    return terminal.shellIntegration;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      cleanup();
      resolve(terminal.shellIntegration);
    }, 5000);

    const cleanup = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      disposable.dispose();
      signal?.removeEventListener('abort', handleAbort);
    };

    const handleAbort = (): void => {
      cleanup();
      reject(createAbortError());
    };

    const disposable = vscode.window.onDidChangeTerminalShellIntegration(event => {
      if (event.terminal !== terminal || !event.shellIntegration) {
        return;
      }
      cleanup();
      resolve(event.shellIntegration);
    });

    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

async function waitForTerminalExecutionEnd(
  terminal: vscode.Terminal,
  execution: vscode.TerminalShellExecution,
  signal?: AbortSignal,
): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      disposable.dispose();
      signal?.removeEventListener('abort', handleAbort);
    };

    const handleAbort = (): void => {
      cleanup();
      reject(createAbortError());
    };

    const disposable = vscode.window.onDidEndTerminalShellExecution(event => {
      if (event.terminal !== terminal || event.execution !== execution) {
        return;
      }
      cleanup();
      resolve(event.exitCode);
    });

    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

function createAbortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isAssistantVoteMessage(value: unknown): value is 'up' | 'down' | 'clear' {
  return value === 'up' || value === 'down' || value === 'clear';
}

function isToolApprovalDecision(value: unknown): value is ToolApprovalDecision {
  return value === 'allow-once'
    || value === 'bypass-task'
    || value === 'autopilot'
    || value === 'deny';
}

function isChatPanelImportedItem(value: unknown): value is ChatPanelImportedItem {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate['transport'] === 'workspace-path' || candidate['transport'] === 'url') {
    return typeof candidate['value'] === 'string';
  }

  if (candidate['transport'] === 'inline-file') {
    return typeof candidate['name'] === 'string'
      && (candidate['mimeType'] === undefined || typeof candidate['mimeType'] === 'string')
      && typeof candidate['dataBase64'] === 'string'
      && candidate['dataBase64'].trim().length > 0;
  }

  return false;
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

async function resolveImportedAttachment(
  item: ChatPanelImportedItem,
  workspaceRoot: string | undefined,
): Promise<ChatComposerAttachment | undefined> {
  if (item.transport === 'url') {
    const value = item.value.trim();
    return value ? { id: `url:${value}`, label: value, kind: 'url', source: value } : undefined;
  }

  if (item.transport === 'inline-file') {
    const source = `clipboard/${sanitizeInlineAttachmentName(item.name, item.mimeType)}`;
    const mimeType = item.mimeType?.trim() || detectMimeType(source);
    const extension = path.extname(source).toLowerCase();
    if (mimeType?.startsWith('image/')) {
      return {
        id: `inline-image:${source}:${item.dataBase64.length}`,
        label: source,
        kind: 'image',
        source,
        mimeType,
        imageAttachment: { source, mimeType, dataBase64: item.dataBase64 },
      };
    }

    let kind = classifyAttachmentKind(extension, mimeType);
    let inlineText: string | undefined;
    if (kind === 'text') {
      inlineText = decodeInlineText(item.dataBase64);
      if (!inlineText) {
        kind = 'binary';
      }
    }

    return {
      id: `inline-file:${source}:${item.dataBase64.length}`,
      label: source,
      kind,
      source,
      inlineText,
      mimeType,
    };
  }

  if (!workspaceRoot) {
    return undefined;
  }

  const uri = coerceWorkspaceFileUri(item.value, workspaceRoot);
  if (!uri) {
    return undefined;
  }

  const imageAttachments = await resolvePickedImageAttachments([uri]);
  return buildComposerAttachment(uri, imageAttachments[0]);
}

function decodeInlineText(dataBase64: string): string | undefined {
  try {
    const text = Buffer.from(dataBase64, 'base64').toString('utf8');
    if (!text || text.includes('\0')) {
      return undefined;
    }
    return text.slice(0, 6000);
  } catch {
    return undefined;
  }
}

function sanitizeInlineAttachmentName(name: string, mimeType?: string): string {
  const trimmed = name.trim();
  if (trimmed.length > 0) {
    return trimmed.replace(/[\\/:*?"<>|]+/g, '-');
  }

  if (mimeType?.startsWith('image/')) {
    return `pasted-image.${mimeType.split('/')[1] ?? 'png'}`;
  }
  if (mimeType?.startsWith('audio/')) {
    return `pasted-audio.${mimeType.split('/')[1] ?? 'bin'}`;
  }
  if (mimeType?.startsWith('video/')) {
    return `pasted-video.${mimeType.split('/')[1] ?? 'bin'}`;
  }
  return 'pasted-file.bin';
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

function describeApprovalDecision(decision: ToolApprovalDecision): string {
  switch (decision) {
    case 'allow-once':
      return 'Allowed this tool call once.';
    case 'bypass-task':
      return 'Bypassing approvals for the rest of this task.';
    case 'autopilot':
      return 'AtlasMind Autopilot enabled for this session.';
    case 'deny':
      return 'Denied the pending tool request.';
  }
}

