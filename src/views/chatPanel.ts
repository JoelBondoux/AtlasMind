import * as path from 'path';
import * as vscode from 'vscode';
import type { AtlasMindContext } from '../extension.js';
import type {
  SessionConversationSummary,
  SessionPromptAttachment,
  SessionSuggestedFollowup,
  SessionThoughtSummary,
  SessionTimelineNote,
  SessionTranscriptEntry,
} from '../chat/sessionConversation.js';
import type {
  ChangedWorkspaceFile,
  PendingToolApprovalRequest,
  ProjectRunRecord,
  ProjectRunReviewDecision,
  TaskImageAttachment,
  ToolApprovalDecision,
} from '../types.js';
import {
  applyOperatorFrustrationAdaptation,
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
import { extractSessionCarryForwardImages, resolvePickedImageAttachments } from '../chat/imageAttachments.js';
import { getWebviewHtmlShell } from './webviewUtils.js';

type ComposerSendMode = 'send' | 'steer' | 'new-chat' | 'new-session';

type PersistentComposerSendMode = Extract<ComposerSendMode, 'send' | 'steer'>;

type ChatPanelImportedItem =
  | { transport: 'workspace-path'; value: string }
  | { transport: 'url'; value: string }
  | { transport: 'inline-file'; name: string; mimeType?: string; dataBase64: string };

const FONT_SCALE_STORAGE_KEY = 'atlasmind.chatFontScale';

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
  | { type: 'reviewRunFile'; payload: { runId: string; relativePath: string; decision: Exclude<ProjectRunReviewDecision, 'pending'> } }
  | { type: 'reviewRunAll'; payload: { runId: string; decision: Exclude<ProjectRunReviewDecision, 'pending'> } }
  | { type: 'openRunReviewFile'; payload: { runId: string; relativePath: string } }
  | { type: 'pickAttachments' }
  | { type: 'attachOpenFile'; payload: string }
  | { type: 'attachOpenFiles' }
  | { type: 'removeAttachment'; payload: string }
  | { type: 'clearAttachments' }
  | { type: 'addDroppedItems'; payload: string[] }
  | { type: 'ingestPromptMedia'; payload: { items: ChatPanelImportedItem[] } }
  | { type: 'continueExecution'; payload: { entryId: string } }
  | { type: 'cancelExecution'; payload: { entryId: string } }
  | { type: 'saveFontScale'; payload: number };

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
  title: string;
  goal: string;
  shortTitle: string;
  status: string;
  updatedAt: string;
  chatSessionId?: string;
  chatMessageId?: string;
  currentBatch: number;
  totalBatches: number;
  paused: boolean;
  awaitingBatchApproval: boolean;
  pendingReviewCount: number;
  acceptedReviewCount: number;
  dismissedReviewCount: number;
  reviewFiles: Array<{
    relativePath: string;
    status: ChangedWorkspaceFile['status'];
    decision: ProjectRunReviewDecision;
    uriPath?: string;
    sourceTitles: string[];
  }>;
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
  policySnapshots?: Array<{ source: 'runtime' | 'personality' | 'safety' | 'project-soul'; label: string; summary: string }>;
  recoveryNotice?: ChatPanelRecoveryNotice;
}

interface ChatPanelRecoveryNotice {
  title: string;
  summary: string;
  tone: 'active' | 'recent';
}

export interface ChatPanelTarget {
  sessionId?: string;
  messageId?: string;
  draftPrompt?: string;
  sendMode?: ComposerSendMode;
  contextPatch?: Record<string, unknown>;
}

interface ChatPanelState {
  activeSurface: 'chat' | 'run';
  chatFontScale?: number;
  selectedSessionId: string;
  selectedMessageId?: string;
  selectedRunId?: string;
  busy?: boolean;
  busySessionId?: string;
  busyAssistantMessageId?: string;
<<<<<<< HEAD
  streamingThought?: string;
=======
>>>>>>> 3ef5f5a0deb5c668b775a31473176b4b9f96f3fa
  composerDraft?: string;
  composerMode?: ComposerSendMode;
  sessions: SessionConversationSummary[];
  transcript: SessionTranscriptEntry[];
  pendingToolApprovals: PendingToolApprovalRequest[];
  attachments: Array<{ id: string; label: string; kind: string; source: string; previewUri?: string }>;
  openFiles: ChatPanelOpenFileLink[];
  projectRuns: Array<{
    id: string;
    goal: string;
    shortTitle: string;
    status: string;
    updatedAt: string;
    chatSessionId?: string;
    chatMessageId?: string;
    completedSubtaskCount: number;
    totalSubtaskCount: number;
    paused: boolean;
    awaitingBatchApproval: boolean;
    pendingReviewCount: number;
    acceptedReviewCount: number;
    dismissedReviewCount: number;
  }>;
  pendingRunReview: {
    totalPendingFiles: number;
    runs: Array<{
      runId: string;
      shortTitle: string;
      chatSessionId?: string;
      chatMessageId?: string;
      pendingFiles: Array<{
        relativePath: string;
        status: ChangedWorkspaceFile['status'];
        uriPath?: string;
      }>;
    }>;
  };
  recoveryNotice?: ChatPanelRecoveryNotice;
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
  private static readonly livePanels = new Set<ChatPanel>();

  private static collectActiveExecutions(): ActivePromptExecution[] {
    return [...ChatPanel.livePanels]
      .map(panel => panel.activePromptExecution)
      .filter((execution): execution is ActivePromptExecution => Boolean(execution));
  }

  private static findBusyExecution(sessionId?: string): ActivePromptExecution | undefined {
    const executions = ChatPanel.collectActiveExecutions();
    if (sessionId) {
      return executions.find(execution => execution.sessionId === sessionId) ?? executions[0];
    }
    return executions[0];
  }

  private static async syncAllPanels(): Promise<void> {
    for (const panel of ChatPanel.livePanels) {
      try {
        await panel.syncState();
      } catch (error) {
        console.error('[AtlasMind] Failed to sync chat panel state across surfaces.', error);
      }
    }
  }

  private readonly host: vscode.WebviewPanel | vscode.WebviewView;
  private readonly disposables: vscode.Disposable[] = [];
  private selectedSessionId: string;
  private selectedMessageId: string | undefined;
  private selectedRunId: string | undefined;
  private activeSurface: 'chat' | 'run' = 'chat';
  private composerAttachments: ChatComposerAttachment[] = [];
  private pendingComposerDraft: string | undefined;
  private pendingComposerMode: ComposerSendMode | undefined;
  private pendingComposerContextPatch: Record<string, unknown> | undefined;
  private pendingPromptSubmission: PendingPromptSubmission | undefined;
  private activePromptExecution: ActivePromptExecution | undefined;
  private recoveryNotice: ChatPanelRecoveryNotice | undefined;
  private streamingThought: string | undefined;
  private readonly onDisposed?: () => void;

  public static createOrShow(context: vscode.ExtensionContext, atlas: AtlasMindContext, target?: string | ChatPanelTarget): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    const normalizedTarget = normalizeChatPanelTarget(target);

    if (ChatPanel.currentPanel) {
      if (normalizedTarget.sessionId || normalizedTarget.messageId || normalizedTarget.draftPrompt || normalizedTarget.contextPatch) {
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

  public static async revealCurrent(target?: string | ChatPanelTarget): Promise<boolean> {
    if (!ChatPanel.currentPanel) {
      return false;
    }

    const normalizedTarget = normalizeChatPanelTarget(target);
    if (normalizedTarget.sessionId || normalizedTarget.messageId || normalizedTarget.draftPrompt || normalizedTarget.contextPatch) {
      await ChatPanel.currentPanel.showChatSession(normalizedTarget);
    }
    if ('reveal' in ChatPanel.currentPanel.host) {
      ChatPanel.currentPanel.host.reveal(vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One);
    }
    return true;
  }

  constructor(
    host: vscode.WebviewPanel | vscode.WebviewView,
    private readonly extensionUri: vscode.Uri,
    private readonly atlas: AtlasMindContext,
    initialTarget?: ChatPanelTarget,
    onDisposed?: () => void,
  ) {
    this.host = host;
    ChatPanel.livePanels.add(this);
    this.onDisposed = onDisposed;
    this.selectedSessionId = initialTarget?.sessionId && atlas.sessionConversation.selectSession(initialTarget.sessionId)
      ? initialTarget.sessionId
      : atlas.sessionConversation.getActiveSessionId();
    this.selectedMessageId = initialTarget?.messageId;
    this.pendingComposerDraft = initialTarget?.draftPrompt;
    this.pendingComposerMode = initialTarget?.sendMode;
    this.pendingComposerContextPatch = initialTarget?.contextPatch;
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
    ChatPanel.livePanels.delete(this);
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
    this.selectedRunId = undefined;
    this.pendingComposerDraft = normalizedTarget.draftPrompt;
    this.pendingComposerMode = normalizedTarget.sendMode;
    this.pendingComposerContextPatch = normalizedTarget.contextPatch;
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
          this.selectedRunId = undefined;
          this.activeSurface = 'chat';
          await this.syncState();
        }
        return;
      case 'deleteSession':
        this.atlas.sessionConversation.deleteSession(message.payload);
        this.selectedSessionId = this.atlas.sessionConversation.getActiveSessionId();
        this.selectedMessageId = undefined;
        this.selectedRunId = undefined;
        this.activeSurface = 'chat';
        await this.host.webview.postMessage({ type: 'status', payload: 'Deleted the selected chat session.' });
        return;
      case 'openProjectRun':
        await this.openProjectRun(message.payload);
        return;
      case 'reviewRunFile':
        await this.applyRunReviewDecision(message.payload.runId, message.payload.decision, message.payload.relativePath);
        return;
      case 'reviewRunAll':
        await this.applyRunReviewDecision(message.payload.runId, message.payload.decision);
        return;
      case 'openRunReviewFile':
        await this.openRunReviewFile(message.payload.runId, message.payload.relativePath);
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
      case 'continueExecution':
        await this.continueFromIterationLimit(message.payload.entryId);
        return;
      case 'cancelExecution':
        await this.cancelFromIterationLimit(message.payload.entryId);
        return;
      case 'saveFontScale':
        await this.atlas.extensionContext.globalState.update(FONT_SCALE_STORAGE_KEY, message.payload);
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

  private async openProjectRun(runId: string): Promise<void> {
    const run = await this.atlas.projectRunHistory.getRunAsync(runId);
    if (!run) {
      await this.host.webview.postMessage({ type: 'status', payload: 'That autonomous run is no longer available.' });
      return;
    }

    this.selectedRunId = run.id;
    if (run.chatSessionId && this.atlas.sessionConversation.selectSession(run.chatSessionId)) {
      this.selectedSessionId = run.chatSessionId;
      this.selectedMessageId = run.chatMessageId;
      this.activeSurface = 'chat';
    } else {
      this.activeSurface = 'run';
    }

    await this.syncState();
  }

  private async applyRunReviewDecision(
    runId: string,
    decision: Exclude<ProjectRunReviewDecision, 'pending'>,
    relativePath?: string,
  ): Promise<void> {
    const run = await this.atlas.projectRunHistory.getRunAsync(runId);
    if (!run) {
      await this.host.webview.postMessage({ type: 'status', payload: 'The autonomous run could not be found.' });
      return;
    }

    const reviewFiles = buildRunReviewFiles(run);
    const targetPaths = relativePath ? new Set([relativePath]) : undefined;
    const nextDecisionAt = new Date().toISOString();
    const existingReviewFiles = new Map((run.reviewFiles ?? []).map(file => [file.relativePath, file]));
    const nextReviewFiles = reviewFiles.map(file => {
      const existing = existingReviewFiles.get(file.relativePath);
      if (targetPaths && !targetPaths.has(file.relativePath)) {
        return {
          relativePath: file.relativePath,
          status: file.status,
          ...(file.uriPath ? { uri: { fsPath: file.uriPath } } : {}),
          decision: file.decision,
          ...(existing?.decidedAt ? { decidedAt: existing.decidedAt } : {}),
        };
      }

      return {
        relativePath: file.relativePath,
        status: file.status,
        ...(file.uriPath ? { uri: { fsPath: file.uriPath } } : {}),
        decision,
        decidedAt: nextDecisionAt,
      };
    });

    await this.atlas.projectRunHistory.upsertRun({
      ...run,
      updatedAt: new Date().toISOString(),
      reviewFiles: nextReviewFiles,
    });
    this.atlas.projectRunsRefresh.fire();
    await this.host.webview.postMessage({
      type: 'status',
      payload: relativePath
        ? `${decision === 'accepted' ? 'Accepted' : 'Dismissed'} ${relativePath} for this autonomous run.`
        : `${decision === 'accepted' ? 'Accepted' : 'Dismissed'} all files in this autonomous run review.`,
    });
  }

  private async openRunReviewFile(runId: string, relativePath: string): Promise<void> {
    const run = await this.atlas.projectRunHistory.getRunAsync(runId);
    if (!run) {
      await this.host.webview.postMessage({ type: 'status', payload: 'The autonomous run could not be found.' });
      return;
    }

    const reviewFile = buildRunReviewFiles(run).find(file => file.relativePath === relativePath);
    const fileUri = reviewFile?.uriPath
      ? vscode.Uri.file(reviewFile.uriPath)
      : resolveWorkspaceRelativeFile(relativePath);
    if (!fileUri) {
      await this.host.webview.postMessage({ type: 'status', payload: `Unable to resolve ${relativePath} in this workspace.` });
      return;
    }

    const document = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(document, { preview: false });
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
    const submittedAttachments = [...this.composerAttachments];
    const promptAttachments = buildPromptAttachmentMetadata(submittedAttachments);
    this.atlas.sessionConversation.appendMessage(
      'user',
      prompt,
      activeSessionId,
      promptAttachments.length > 0 ? { promptAttachments } : undefined,
    );
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

    await ChatPanel.syncAllPanels();
    await this.host.webview.postMessage({
      type: 'busy',
      payload: { busy: true, sessionId: activeSessionId, assistantMessageId },
    });
    await this.host.webview.postMessage({ type: 'status', payload: 'Running AtlasMind chat request...' });

    let streamedText = '';
    let streamingThoughtLines: string[] = [];
    const renderPendingAssistant = async (): Promise<void> => {
      this.atlas.sessionConversation.updateMessage(assistantMessageId, streamedText, activeSessionId);
      this.streamingThought = streamingThoughtLines.length > 0 ? streamingThoughtLines.join('\n') : undefined;
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
        streamingThoughtLines.push(message.trim());
        await this.host.webview.postMessage({ type: 'status', payload: message.trim() });
        try {
          await renderPendingAssistant();
        } catch (error) {
          console.error('[AtlasMind] Failed to stream chat panel progress update.', error);
        }
      });

      const reconciled = reconcileAssistantResponse(streamedText, result.response);
      this.streamingThought = undefined;
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
          policies: [
            ...this.atlas.getWorkspacePolicySnapshots(),
            ...(preparedRequest.policySnapshots ?? []),
          ],
        }),
      );
      await this.syncState();

      if (configuration.get<boolean>('voice.ttsEnabled', false)) {
        this.atlas.voiceManager.speak(reconciled.transcriptText);
      }
      await this.host.webview.postMessage({ type: 'status', payload: `Response ready via ${result.modelUsed}.` });
    } catch (error) {
      this.streamingThought = undefined;
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
      await ChatPanel.syncAllPanels();
      await this.host.webview.postMessage({ type: 'busy', payload: false });
      if (pendingSubmission) {
        await this.runPrompt(pendingSubmission.prompt, pendingSubmission.mode);
      }
    }
  }

  private async stopActivePrompt(statusMessage = 'Stopping the current chat request...'): Promise<void> {
    const targetExecution = this.activePromptExecution
      ?? ChatPanel.findBusyExecution(this.selectedSessionId)
      ?? ChatPanel.findBusyExecution();

    if (!targetExecution) {
      await this.host.webview.postMessage({ type: 'status', payload: 'No active chat request is running.' });
      return;
    }

    this.atlas.toolApprovalManager?.clearTask?.(targetExecution.taskId);
    targetExecution.interrupt?.();
    targetExecution.abortController.abort();
    await this.host.webview.postMessage({ type: 'status', payload: statusMessage });
  }

  private async continueFromIterationLimit(entryId: string): Promise<void> {
    if (this.activePromptExecution) {
      await this.host.webview.postMessage({ type: 'status', payload: 'A chat request is already running.' });
      return;
    }
    const transcript = this.atlas.sessionConversation.getTranscript(this.selectedSessionId);
    const entryIndex = transcript.findIndex(entry => entry.id === entryId);
    if (entryIndex === -1) {
      return;
    }
    const entry = transcript[entryIndex];
    if (!entry.meta?.iterationLimitHit) {
      return;
    }
    const priorUserEntry = [...transcript].slice(0, entryIndex).reverse().find(e => e.role === 'user');
    if (!priorUserEntry) {
      await this.host.webview.postMessage({ type: 'status', payload: 'Could not find the original prompt to continue.' });
      return;
    }
    const updatedMeta = { ...entry.meta, iterationLimitHit: undefined as boolean | undefined };
    delete updatedMeta.iterationLimitHit;
    this.atlas.sessionConversation.updateMessage(entryId, entry.content, this.selectedSessionId, updatedMeta);
    await this.syncState();
    await this.runPrompt(priorUserEntry.content, 'send');
  }

  private async cancelFromIterationLimit(entryId: string): Promise<void> {
    const transcript = this.atlas.sessionConversation.getTranscript(this.selectedSessionId);
    const entry = transcript.find(e => e.id === entryId);
    if (!entry?.meta?.iterationLimitHit) {
      return;
    }
    const updatedMeta = { ...entry.meta, iterationLimitHit: undefined as boolean | undefined };
    delete updatedMeta.iterationLimitHit;
    this.atlas.sessionConversation.updateMessage(
      entryId,
      `${entry.content}\n\n_Execution limit reached. Cancelled._`,
      this.selectedSessionId,
      updatedMeta,
    );
    await this.syncState();
    await this.host.webview.postMessage({ type: 'status', payload: 'Cancelled the iteration-limit prompt.' });
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
    const renderAnalysis = async (): Promise<void> => {
      await renderManagedTerminal('Preparing the managed terminal summary...', streamedText);
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
      await this.host.webview.postMessage({ type: 'status', payload: message.trim() });
      try {
        await renderAnalysis();
      } catch (error) {
        console.error('[AtlasMind] Failed to stream managed terminal analysis progress.', error);
      }
    });

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
        policies: [
          ...this.atlas.getWorkspacePolicySnapshots(),
          ...(preparedRequest.policySnapshots ?? []),
        ],
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
    });

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
      this.selectedRunId = undefined;
      this.activeSurface = 'chat';
    }

    const projectRuns = await this.atlas.projectRunHistory.listRunsAsync(20);
    if (this.selectedRunId && !projectRuns.some(run => run.id === this.selectedRunId)) {
      this.selectedRunId = undefined;
      this.activeSurface = 'chat';
    }

    const selectedRun = this.selectedRunId
      ? projectRuns.find(run => run.id === this.selectedRunId)
      : undefined;

    const transcript = this.atlas.sessionConversation.getTranscript(this.selectedSessionId);
    const transcriptPayload = transcript.map(entry => withAttachmentPreviewUris(entry, this.host.webview));
    if (this.selectedMessageId && !transcript.some(entry => entry.id === this.selectedMessageId)) {
      this.selectedMessageId = undefined;
    }
    const derivedRecoveryNotice = this.recoveryNotice ?? deriveRecoveryNoticeFromTranscript(transcript);
    const busyExecution = ChatPanel.findBusyExecution(this.selectedSessionId);
    const isBusyForSelectedSession = Boolean(busyExecution && busyExecution.sessionId === this.selectedSessionId);
<<<<<<< HEAD

    const storedFontScale = this.atlas.extensionContext.globalState.get<number>(FONT_SCALE_STORAGE_KEY);
=======
>>>>>>> 3ef5f5a0deb5c668b775a31473176b4b9f96f3fa

    const payload: ChatPanelState = {
      activeSurface: this.activeSurface,
      ...(typeof storedFontScale === 'number' ? { chatFontScale: storedFontScale } : {}),
      selectedSessionId: this.selectedSessionId,
      ...(this.selectedMessageId ? { selectedMessageId: this.selectedMessageId } : {}),
      busy: isBusyForSelectedSession,
      ...(busyExecution ? { busySessionId: busyExecution.sessionId, busyAssistantMessageId: busyExecution.assistantMessageId } : {}),
<<<<<<< HEAD
      ...(this.streamingThought ? { streamingThought: this.streamingThought } : {}),
=======
>>>>>>> 3ef5f5a0deb5c668b775a31473176b4b9f96f3fa
      ...(this.pendingComposerDraft ? { composerDraft: this.pendingComposerDraft } : {}),
      composerMode: this.pendingComposerMode ?? getStatusDrivenComposerMode(isBusyForSelectedSession),
      sessions,
      transcript: transcriptPayload,
      pendingToolApprovals: this.atlas.toolApprovalManager?.listPendingRequests?.() ?? [],
      attachments: this.composerAttachments.map(item => toComposerAttachmentView(item, this.host.webview)),
      openFiles: getOpenWorkspaceFiles(),
      projectRuns: projectRuns.map(run => {
        const reviewFiles = buildRunReviewFiles(run);
        return {
          id: run.id,
          title: run.title,
          goal: run.goal,
          shortTitle: buildChatRunShortTitle(run),
          status: run.status,
          updatedAt: run.updatedAt,
          ...(run.chatSessionId ? { chatSessionId: run.chatSessionId } : {}),
          ...(run.chatMessageId ? { chatMessageId: run.chatMessageId } : {}),
          completedSubtaskCount: run.completedSubtaskCount,
          totalSubtaskCount: run.totalSubtaskCount,
          paused: run.paused,
          awaitingBatchApproval: run.awaitingBatchApproval,
          pendingReviewCount: reviewFiles.filter(f => f.decision === 'pending').length,
          acceptedReviewCount: reviewFiles.filter(f => f.decision === 'accepted').length,
          dismissedReviewCount: reviewFiles.filter(f => f.decision === 'dismissed').length,
        };
      }),
      pendingRunReview: buildPendingRunReviewSummary(projectRuns),
      ...(derivedRecoveryNotice && this.activeSurface === 'chat' ? { recoveryNotice: derivedRecoveryNotice } : {}),
      ...(this.selectedRunId ? { selectedRunId: this.selectedRunId } : {}),
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
    const currentImageAttachments = attachments
      .map(item => item.imageAttachment)
      .filter((item): item is TaskImageAttachment => Boolean(item));
    // When no images were explicitly attached this turn, carry forward images from the
    // most recent prior user message that had them so the model retains visual context
    // across follow-up turns (e.g. "is it done?", "what did you find?").
    // Slice off the last transcript entry because appendMessage('user') was called before
    // preparePromptRequest, so the current turn is already present in the transcript.
    const priorTranscript = this.atlas.sessionConversation.getTranscript(activeSessionId).slice(0, -1);
    const carryForwardImages = currentImageAttachments.length === 0
      ? extractSessionCarryForwardImages(priorTranscript)
      : [];
    const imageAttachments = [...currentImageAttachments, ...carryForwardImages];
    const attachmentNote = buildAttachmentContextBlock(attachments);
    const multimodalGuidance = buildMultimodalPromptNote(attachments);
    const userMessage = forceSteer
      ? [
          'The operator is steering the current AtlasMind response. Replace the prior in-flight direction with this updated instruction and continue from there.',
          prompt,
        ].join('\n\n')
      : [prompt, multimodalGuidance].filter(Boolean).join('\n\n');
    const context: Record<string, unknown> = {
      ...(sessionContext ? { sessionContext } : {}),
      ...(buildWorkstationContext() ? { workstationContext: buildWorkstationContext() } : {}),
      ...(attachmentNote ? { attachmentContext: attachmentNote } : {}),
      ...(multimodalGuidance ? { multimodalGuidance } : {}),
      ...(imageAttachments.length > 0 ? { imageAttachments } : {}),
      ...(carryForwardImages.length > 0 ? { carryForwardImages: true } : {}),
      ...(forceSteer ? { steerInstruction: prompt } : {}),
    };
    if (this.pendingComposerContextPatch) {
      Object.assign(context, this.pendingComposerContextPatch);
      this.pendingComposerContextPatch = undefined;
    }
    const operatorAdaptation = forceSteer
      ? undefined
      : await applyOperatorFrustrationAdaptation(prompt, this.atlas, context);
    if (operatorAdaptation) {
      Object.assign(context, operatorAdaptation.contextPatch);
      this.recoveryNotice = {
        title: 'Direct recovery mode',
        summary: 'Atlas detected operator frustration and is biasing this turn toward the next concrete safe corrective action.',
        tone: 'active',
      };
    } else if (!forceSteer) {
      this.recoveryNotice = undefined;
    }

    return {
      userMessage,
      projectGoal,
      ...(roadmapStatusMarkdown ? { directResponse: { markdown: roadmapStatusMarkdown, modelUsed: 'atlasmind/roadmap-status' } } : {}),
      commandIntent,
      ...(terminalDirectiveResolution?.directive ? { terminalDirective: terminalDirectiveResolution.directive } : {}),
      context,
      imageAttachments,
      ...(operatorAdaptation ? { policySnapshots: [operatorAdaptation.policySnapshot] } : {}),
      ...(this.recoveryNotice ? { recoveryNotice: this.recoveryNotice } : {}),
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
              <div id="runSectionLabel" class="rail-section-label">Standalone Runs</div>
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
                  <button id="clearConversation" class="icon-btn compact-icon-btn" type="button" title="Clear conversation" aria-label="Clear conversation">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <polyline points="3,4 13,4"/>
                      <path d="M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1"/>
                      <path d="M5 4l.75 8.5a1 1 0 0 0 1 .9h2.5a1 1 0 0 0 1-.9L11 4"/>
                    </svg>
                  </button>
                  <button id="copyTranscript" class="icon-btn compact-icon-btn" type="button" title="Copy transcript" aria-label="Copy transcript">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <rect x="5" y="1.5" width="8" height="10" rx="1"/>
                      <rect x="2" y="4.5" width="8" height="10" rx="1" fill="var(--vscode-editor-background,#1e1e1e)"/>
                    </svg>
                  </button>
                  <button id="saveTranscript" class="icon-btn compact-icon-btn" type="button" title="Open as Markdown" aria-label="Open as Markdown">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <rect x="2" y="1.5" width="9" height="12" rx="1"/>
                      <line x1="4.5" y1="5" x2="8.5" y2="5"/>
                      <line x1="4.5" y1="7.5" x2="8.5" y2="7.5"/>
                      <line x1="4.5" y1="10" x2="6.5" y2="10"/>
                      <polyline points="10,9.5 13,12.5 10,15.5" stroke-width="1.3"/>
                    </svg>
                  </button>
                </div>
              </section>
              <div id="status" class="status-label">Ready.</div>
              <section id="recoveryNotice" class="recovery-notice hidden" aria-live="polite">
                <div id="recoveryNoticeTitle" class="recovery-notice-title">Direct recovery mode</div>
                <div id="recoveryNoticeSummary" class="recovery-notice-summary"></div>
              </section>
              <section id="transcript" class="chat-transcript" aria-live="polite"></section>
              <section id="runInspector" class="run-inspector hidden"></section>
              <section id="pendingApprovals" class="approval-stack hidden" aria-live="polite"></section>
            </main>
            <div id="imageLightbox" class="media-lightbox hidden" aria-hidden="true">
              <div class="media-lightbox-panel">
                <button id="imageLightboxClose" class="icon-btn compact-icon-btn media-lightbox-close" type="button" aria-label="Close image preview">×</button>
                <img id="imageLightboxImage" class="media-lightbox-image" alt="Expanded attachment preview" />
                <div id="imageLightboxCaption" class="media-lightbox-caption"></div>
              </div>
            </div>
            <section class="composer-shell">
              <div class="row toolbar-row composer-tools">
                <div class="attach-row">
                  <button id="toggleDictation" class="icon-btn compact-icon-btn mic-btn" type="button" title="Start speech input" aria-label="Start speech input" aria-pressed="false">
                    <svg class="mic-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M8 2.25a1.75 1.75 0 0 1 1.75 1.75v4a1.75 1.75 0 1 1-3.5 0V4A1.75 1.75 0 0 1 8 2.25z"/>
                      <path d="M4.75 7.75a3.25 3.25 0 0 0 6.5 0"/>
                      <path d="M8 11v2.75"/>
                      <path d="M5.5 13.75h5"/>
                    </svg>
                  </button>
                  <button id="attachFiles" class="icon-btn compact-icon-btn" title="Add files" aria-label="Add files">+</button>
                  <button id="attachOpenFiles" class="icon-btn compact-icon-btn" title="Add open files" aria-label="Add open files">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <rect x="5" y="1.5" width="8" height="10" rx="1"/>
                      <rect x="3" y="3.5" width="8" height="10" rx="1" fill="var(--vscode-editor-background,#1e1e1e)" stroke="currentColor"/>
                      <line x1="5.5" y1="7" x2="9" y2="7"/>
                      <line x1="5.5" y1="9.5" x2="9" y2="9.5"/>
                    </svg>
                  </button>
                  <button id="clearAttachments" class="icon-btn compact-icon-btn" title="Clear attachments" aria-label="Clear attachments">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <line x1="4" y1="4" x2="12" y2="12"/>
                      <line x1="12" y1="4" x2="4" y2="12"/>
                    </svg>
                  </button>
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
              <div id="pendingRunReviewBar" class="pending-run-review-bar hidden" role="button" tabindex="0" aria-expanded="false" aria-controls="pendingRunReviewFlyout">
                <div class="pending-run-review-copy">
                  <strong id="pendingRunReviewTitle">Autonomous review pending</strong>
                  <span id="pendingRunReviewSummary">Review pending files from recent autonomous runs.</span>
                </div>
                <span class="pending-run-review-chevron" aria-hidden="true">▾</span>
              </div>
              <div id="pendingRunReviewFlyout" class="pending-run-review-flyout hidden"></div>
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
                <span class="composer-hint-wrap">
                  <button id="composerHintBtn" class="icon-btn compact-icon-btn composer-hint-btn" type="button" aria-label="Keyboard shortcuts and tips">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <circle cx="8" cy="8" r="6.5"/>
                      <line x1="8" y1="7" x2="8" y2="11.5"/>
                      <circle cx="8" cy="4.5" r="0.6" fill="currentColor" stroke="none"/>
                    </svg>
                  </button>
                  <div id="composerHint" class="hint-label composer-hint-tooltip" role="tooltip">
                    <div class="composer-hint-title">Composer shortcuts</div>
                    <ul class="composer-hint-list">
                      <li>Enter uses the selected send mode.</li>
                      <li>Shift+Enter starts a new chat thread.</li>
                      <li>Ctrl/Cmd+Enter sends as Steer.</li>
                      <li>Alt+Enter inserts a newline.</li>
                      <li>Up and Down recall recent prompts at the start or end of the composer.</li>
                      <li>Use aliases like @tps, @tpowershell, @tpwsh, @tgit, @tbash, or @tcmd to launch a managed terminal run.</li>
                    </ul>
                  </div>
                </span>
              </div>
            </section>
          </div>
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
        .panel-subtitle, .status-label, .session-meta, .empty-state {
          color: var(--vscode-descriptionForeground);
          font-size: 0.85em;
        }
        .status-label { flex: 0 0 auto; }
        .recovery-notice {
          display: grid;
          gap: 0.25rem;
          margin: 0 1.1rem 0.75rem;
          padding: 0.7rem 0.85rem;
          border-radius: 12px;
          border: 1px solid color-mix(in srgb, var(--vscode-editorWarning-foreground, #c27803) 40%, transparent);
          background: linear-gradient(135deg,
            color-mix(in srgb, var(--vscode-editorWarning-foreground, #c27803) 14%, transparent),
            color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 92%, transparent));
          color: var(--vscode-editor-foreground, #d4d4d4);
        }
        .recovery-notice[data-tone="recent"] {
          border-color: color-mix(in srgb, var(--vscode-editorInfo-foreground, #3794ff) 34%, transparent);
          background: linear-gradient(135deg,
            color-mix(in srgb, var(--vscode-editorInfo-foreground, #3794ff) 12%, transparent),
            color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 92%, transparent));
        }
        .recovery-notice-title {
          font-size: 0.77rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .recovery-notice-summary {
          font-size: 0.88rem;
          line-height: 1.4;
        }
        .composer-hint-wrap {
          position: relative;
          display: inline-flex;
          align-items: center;
        }
        .composer-hint-btn {
          color: var(--vscode-descriptionForeground);
          opacity: 0.7;
        }
        .composer-hint-btn:hover {
          opacity: 1;
        }
        .composer-hint-tooltip {
          display: none;
          position: absolute;
          bottom: calc(100% + 8px);
          right: 0;
          width: min(360px, calc(100vw - 32px));
          background: var(--vscode-editorHoverWidget-background, var(--vscode-editor-background));
          border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-widget-border, #444));
          border-radius: 10px;
          padding: 10px 12px;
          font-size: 0.82em;
          color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground));
          line-height: 1.5;
          white-space: normal;
          z-index: 100;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          pointer-events: none;
        }
        .composer-hint-title {
          margin-bottom: 6px;
          font-size: 0.78rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--vscode-descriptionForeground);
        }
        .composer-hint-list {
          margin: 0;
          padding-left: 18px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .composer-hint-list li {
          margin: 0;
        }
        .composer-hint-wrap:hover .composer-hint-tooltip,
        .composer-hint-wrap:focus-within .composer-hint-tooltip {
          display: block;
        }
        .approval-stack {
          display: flex;
          flex-direction: column;
          gap: 8px;
          flex: 0 0 auto;
        }
        .approval-stack.hidden {
          display: none;
        }
        .approval-card {
          border: 1px solid color-mix(in srgb, var(--vscode-inputValidation-warningBorder, #b89500) 72%, var(--vscode-widget-border, #444));
          border-radius: 10px;
          padding: 12px;
          background: color-mix(in srgb, var(--vscode-inputValidation-warningBackground, #5a451d) 32%, var(--vscode-editor-background));
          box-shadow: inset 3px 0 0 color-mix(in srgb, var(--vscode-inputValidation-warningBorder, #b89500) 82%, transparent);
        }
        .approval-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 6px;
          flex-wrap: wrap;
        }
        .approval-card-heading {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .approval-alert-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          border-radius: 999px;
          color: var(--vscode-inputValidation-warningForeground, #ffcc33);
          background: color-mix(in srgb, var(--vscode-inputValidation-warningForeground, #ffcc33) 14%, transparent);
          border: 1px solid color-mix(in srgb, var(--vscode-inputValidation-warningBorder, #b89500) 68%, transparent);
          flex: 0 0 auto;
        }
        .approval-alert-icon svg {
          width: 14px;
          height: 14px;
        }
        .approval-card-title {
          font-size: 0.82rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
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
        .session-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
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
        .session-child-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-left: 14px;
          padding-left: 10px;
          border-left: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 72%, transparent);
        }
        .session-child-item {
          width: 100%;
          text-align: left;
          border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 80%, transparent);
          background: color-mix(in srgb, var(--vscode-sideBar-background, var(--vscode-editor-background)) 94%, black 6%);
          border-radius: 6px;
          padding: 5px 8px;
          cursor: pointer;
          color: inherit;
          font-size: 0.82em;
        }
        .session-child-item.active {
          border-color: var(--vscode-focusBorder, var(--vscode-button-background));
          background: color-mix(in srgb, var(--vscode-button-background) 12%, transparent);
        }
        .session-child-title {
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-bottom: 2px;
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
        .attachment-chip {
          border-radius: 10px;
          padding: 4px 6px;
          max-width: 100%;
        }
        .attachment-preview-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          text-align: left;
        }
        .attachment-thumb,
        .message-attachment-thumb {
          width: 42px;
          height: 42px;
          object-fit: cover;
          border-radius: 8px;
          border: 1px solid var(--vscode-widget-border, #444);
          background: color-mix(in srgb, var(--vscode-editor-background) 88%, white 12%);
          flex: 0 0 auto;
        }
        .attachment-label-stack {
          display: flex;
          flex-direction: column;
          min-width: 0;
          gap: 2px;
        }
        .attachment-kind-label {
          font-size: 0.72em;
          font-weight: 600;
          letter-spacing: 0.02em;
          text-transform: uppercase;
          color: var(--vscode-descriptionForeground);
        }
        .attachment-source-label,
        .message-attachment-label {
          max-width: 180px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .message-attachment-gallery {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 8px;
        }
        .message-attachment-card,
        .message-attachment-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
          border: 1px solid var(--vscode-widget-border, #444);
          border-radius: 10px;
          background: color-mix(in srgb, var(--vscode-editor-background) 94%, white 6%);
          color: inherit;
        }
        .message-attachment-card {
          cursor: pointer;
          text-align: left;
          max-width: 240px;
        }
        .message-attachment-pill {
          font-size: 0.8em;
        }
        .media-lightbox {
          position: fixed;
          inset: 0;
          z-index: 100;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: color-mix(in srgb, black 78%, transparent);
        }
        .media-lightbox.hidden {
          display: none;
        }
        .media-lightbox-panel {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-width: min(92vw, 1100px);
          max-height: 88vh;
          padding: 12px;
          border-radius: 14px;
          border: 1px solid var(--vscode-widget-border, #444);
          background: var(--vscode-editor-background, #1e1e1e);
          box-shadow: 0 18px 38px rgba(0, 0, 0, 0.42);
        }
        .media-lightbox-close {
          align-self: flex-end;
        }
        .media-lightbox-image {
          max-width: min(88vw, 1040px);
          max-height: calc(88vh - 64px);
          object-fit: contain;
          border-radius: 10px;
          background: color-mix(in srgb, var(--vscode-editor-background) 88%, white 12%);
        }
        .media-lightbox-caption {
          font-size: 0.84em;
          color: var(--vscode-descriptionForeground);
          text-align: center;
        }
        .compact-icon-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 26px;
          min-height: 26px;
          width: 26px;
          height: 26px;
          padding: 0;
          font-size: 0.82rem;
          line-height: 1;
        }
        .mic-btn.listening {
          border-color: color-mix(in srgb, var(--vscode-focusBorder, var(--vscode-button-background)) 70%, var(--vscode-widget-border, #444));
          background: color-mix(in srgb, var(--vscode-button-background) 18%, transparent);
          color: var(--vscode-button-background);
          box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-button-background) 30%, transparent);
        }
        .mic-btn.listening .mic-icon {
          animation: atlasmic-pulse 1.1s ease-in-out infinite;
        }
        .mic-btn:disabled {
          opacity: 0.55;
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
        .pending-run-review-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin: 4px 0 6px;
          padding: 8px 10px;
          border-radius: 10px;
          border: 1px solid color-mix(in srgb, var(--vscode-button-background) 48%, var(--vscode-widget-border, #444));
          background: color-mix(in srgb, var(--vscode-button-background) 14%, transparent);
          cursor: pointer;
        }
        .pending-run-review-copy {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .pending-run-review-copy strong,
        .pending-run-review-copy span {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pending-run-review-copy span {
          font-size: 0.82em;
          color: var(--vscode-descriptionForeground);
        }
        .pending-run-review-chevron {
          font-size: 0.8rem;
          transition: transform 120ms ease;
        }
        .pending-run-review-bar[aria-expanded="true"] .pending-run-review-chevron {
          transform: rotate(180deg);
        }
        .pending-run-review-flyout {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin: 0 0 8px;
          padding: 10px;
          border-radius: 10px;
          border: 1px solid var(--vscode-widget-border, #444);
          background: color-mix(in srgb, var(--vscode-editor-background) 92%, black 8%);
          max-height: 240px;
          overflow-y: auto;
        }
        .pending-run-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding-bottom: 8px;
          border-bottom: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 72%, transparent);
        }
        .pending-run-section:last-child {
          border-bottom: 0;
          padding-bottom: 0;
        }
        .pending-run-header,
        .pending-run-bulk-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .pending-run-header {
          justify-content: space-between;
        }
        .pending-run-title {
          font-weight: 600;
          font-size: 0.88em;
        }
        .pending-run-open-btn {
          width: 28px;
          height: 28px;
          border-radius: 999px;
          border: 1px solid var(--vscode-widget-border, #444);
          background: transparent;
          color: inherit;
          cursor: pointer;
        }
        .pending-run-open-btn.active {
          border-color: var(--vscode-focusBorder, var(--vscode-button-background));
          background: color-mix(in srgb, var(--vscode-button-background) 16%, transparent);
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
          padding: 12px 14px;
          border-radius: 12px;
          border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 82%, transparent);
          white-space: pre-wrap;
          word-break: break-word;
          font-size: calc(0.95rem * var(--atlas-chat-font-scale));
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
        }
        .chat-message-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          margin-bottom: 5px;
          flex-wrap: wrap;
        }
        .chat-message.user {
          align-self: flex-end;
          width: min(90%, 740px);
          background: color-mix(in srgb, var(--vscode-button-background) 16%, transparent);
        }
        .chat-message.assistant {
          align-self: flex-start;
          width: min(94%, 800px);
          background: color-mix(in srgb, var(--vscode-editorHoverWidget-background, var(--vscode-editor-background)) 84%, white 8%);
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
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 22px;
          padding: 0 8px;
          border-radius: 999px;
          border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 72%, transparent);
          background: color-mix(in srgb, var(--vscode-editor-background) 92%, transparent);
          font-size: 0.68rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: color-mix(in srgb, var(--vscode-descriptionForeground) 92%, var(--vscode-foreground));
          opacity: 0.9;
          line-height: 1;
        }
        .chat-model-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 3px;
          min-height: 22px;
          padding: 0 8px;
          border-radius: 999px;
          border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 72%, transparent);
          background: color-mix(in srgb, var(--vscode-editor-background) 93%, transparent);
          font-size: 0.68rem;
          color: color-mix(in srgb, var(--vscode-descriptionForeground) 86%, var(--vscode-foreground));
          opacity: 0.92;
          line-height: 1;
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
          line-height: 1.62;
          color: color-mix(in srgb, var(--vscode-foreground) 96%, white 4%);
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
        .chat-content hr,
        .chat-table-wrap {
          margin: 0 0 12px;
        }
        .chat-content h1,
        .chat-content h2,
        .chat-content h3,
        .chat-content h4,
        .chat-content h5,
        .chat-content h6 {
          margin: 2px 0 7px;
          line-height: 1.28;
          max-width: 76ch;
          font-weight: 600;
          color: color-mix(in srgb, var(--vscode-foreground) 94%, var(--vscode-descriptionForeground));
        }
        .chat-content h1 {
          font-size: 0.98rem;
        }
        .chat-content h2 {
          font-size: 0.94rem;
        }
        .chat-content h3,
        .chat-content h4,
        .chat-content h5,
        .chat-content h6 {
          font-size: 0.88rem;
        }
        .chat-content p,
        .chat-content ul,
        .chat-content ol,
        .chat-content blockquote {
          max-width: 76ch;
        }
        .chat-content ul,
        .chat-content ol {
          padding-left: 18px;
        }
        .chat-content li + li {
          margin-top: 6px;
        }
        .chat-content code {
          font-family: var(--vscode-editor-font-family, Consolas, 'Courier New', monospace);
          font-size: 0.92em;
          padding: 1px 5px;
          border-radius: 6px;
          background: color-mix(in srgb, var(--vscode-textCodeBlock-background, var(--vscode-editor-background)) 82%, transparent);
        }
        .chat-content pre {
          margin: 0;
          overflow: auto;
          max-height: 320px;
          padding: 12px 14px;
          border-radius: 0 0 12px 12px;
          border: 0;
          border-top: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 72%, transparent);
          background: color-mix(in srgb, var(--vscode-textCodeBlock-background, var(--vscode-editor-background)) 92%, transparent);
        }
        .chat-content pre code {
          padding: 0;
          border-radius: 0;
          background: transparent;
          display: block;
          min-width: max-content;
          line-height: 1.5;
        }
        .chat-code-block {
          max-width: min(100%, 88ch);
          margin: 0 0 12px;
          border-radius: 12px;
          border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 82%, transparent);
          overflow: hidden;
          background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 90%, black 10%);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
        }
        .chat-code-block-header {
          padding: 7px 12px;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--vscode-descriptionForeground);
          background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 96%, white 4%);
        }
        .chat-content blockquote {
          margin-left: 0;
          padding: 4px 0 4px 12px;
          border-left: 2px solid color-mix(in srgb, var(--vscode-button-background) 32%, var(--vscode-widget-border, #444));
          color: color-mix(in srgb, var(--vscode-descriptionForeground, var(--vscode-foreground)) 92%, var(--vscode-foreground));
          background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 97%, transparent);
          border-radius: 0 8px 8px 0;
        }
        .chat-table-wrap {
          max-width: min(100%, 88ch);
          overflow-x: auto;
          border-radius: 12px;
          border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 72%, transparent);
          background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 96%, white 4%);
        }
        .chat-markdown-table {
          width: 100%;
          min-width: 360px;
          border-collapse: collapse;
          font-size: 0.875em;
        }
        .chat-markdown-table th,
        .chat-markdown-table td {
          padding: 7px 12px;
          vertical-align: top;
          border-bottom: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 64%, transparent);
        }
        .chat-markdown-table th {
          font-weight: 700;
          white-space: nowrap;
          color: color-mix(in srgb, var(--vscode-foreground) 94%, white 6%);
          background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 90%, white 10%);
        }
        .chat-markdown-table tbody tr:nth-child(even) td {
          background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 94%, transparent);
        }
        .chat-markdown-table tbody tr:last-child td {
          border-bottom: 0;
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
          flex-direction: column;
          align-items: stretch;
          gap: 8px;
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 78%, transparent);
        }
        .assistant-meta-stack {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .assistant-footer-thought {
          min-width: 0;
        }
        .assistant-utility-row {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          flex-wrap: wrap;
        }
        .transcript-disclosure {
          border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 74%, transparent);
          border-radius: 10px;
          background: color-mix(in srgb, var(--vscode-editorHoverWidget-background, var(--vscode-editor-background)) 90%, white 6%);
          overflow: hidden;
        }
        .transcript-disclosure summary::-webkit-details-marker {
          display: none;
        }
        .transcript-disclosure-summary {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 8px 10px;
          cursor: pointer;
          list-style: none;
          background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 96%, transparent);
        }
        .transcript-disclosure-summary::before {
          content: '\\25B8';
          display: inline-block;
          margin-right: 8px;
          color: var(--vscode-descriptionForeground);
          transition: transform 120ms ease;
          flex: 0 0 auto;
        }
        .transcript-disclosure[open] .transcript-disclosure-summary::before {
          transform: rotate(90deg);
        }
        .transcript-disclosure-heading {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          flex: 1 1 auto;
        }
        .transcript-disclosure-title {
          font-size: 0.8rem;
          font-weight: 700;
          color: var(--vscode-foreground);
        }
        .transcript-disclosure-preview {
          min-width: 0;
          font-size: 0.77rem;
          color: var(--vscode-descriptionForeground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .transcript-disclosure-body {
          padding: 0 10px 10px;
        }
        .auxiliary-section {
          max-width: min(100%, 88ch);
          border-style: dashed;
          opacity: 0.94;
        }
        .auxiliary-section.transcript-disclosure {
          background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 94%, white 8%);
          border-color: color-mix(in srgb, var(--vscode-widget-border, #444) 56%, transparent);
        }
        .auxiliary-section .transcript-disclosure-summary {
          background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 97%, white 5%);
        }
        .chat-utility-block {
          display: grid;
          gap: 8px;
        }
        .chat-utility-list {
          margin: 0;
          padding-left: 1rem;
          display: grid;
          gap: 0.4rem;
        }
        .chat-utility-item {
          font-size: 0.8rem;
          line-height: 1.45;
          color: color-mix(in srgb, var(--vscode-descriptionForeground) 88%, var(--vscode-foreground));
        }
        .assistant-timeline-notes {
          min-width: 0;
        }
        .assistant-timeline-list {
          margin: 0;
          padding-left: 1rem;
          display: grid;
          gap: 0.45rem;
          font-size: 0.8rem;
          line-height: 1.45;
          color: color-mix(in srgb, var(--vscode-descriptionForeground) 88%, var(--vscode-foreground));
        }
        .assistant-timeline-list li {
          font-weight: 400;
        }
        .assistant-timeline-inline-label {
          font-weight: 600;
          color: color-mix(in srgb, var(--vscode-foreground) 88%, var(--vscode-descriptionForeground));
        }
        .assistant-timeline-list li.warning {
          color: var(--vscode-editorWarning-foreground, #c27803);
        }
        .run-review-link-row {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          margin-right: auto;
        }
        .run-review-link {
          border: 0;
          background: transparent;
          color: var(--vscode-textLink-foreground, var(--vscode-foreground));
          text-decoration: underline;
          cursor: pointer;
          padding: 0;
          font-size: 0.78rem;
        }
        .run-review-link.active {
          color: var(--vscode-button-background);
          font-weight: 600;
        }
        .chat-message-actions {
          display: inline-flex;
          align-items: center;
          justify-content: flex-end;
          gap: 6px;
          flex: 0 1 auto;
          flex-wrap: wrap;
          margin-left: auto;
        }
        .assistant-followup-controls {
          display: inline-flex;
          align-items: center;
          justify-content: flex-end;
          gap: 6px;
          flex-wrap: wrap;
        }
        .assistant-followup-toggle,
        .assistant-followup-proceed {
          appearance: none;
          border-radius: 999px;
          padding: 4px 10px;
          font-size: 0.75rem;
          line-height: 1.35;
          cursor: pointer;
          transition: background 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease;
        }
        .assistant-followup-toggle {
          border: 1px solid var(--vscode-widget-border, #444);
          background: color-mix(in srgb, var(--vscode-editor-background) 92%, white 8%);
          color: var(--vscode-foreground);
        }
        .assistant-followup-toggle.active {
          border-color: var(--vscode-focusBorder, var(--vscode-button-background));
          background: color-mix(in srgb, var(--vscode-button-background) 18%, transparent);
        }
        .assistant-followup-toggle:hover,
        .assistant-followup-proceed:hover:not(:disabled) {
          background: color-mix(in srgb, var(--vscode-button-background) 18%, transparent);
        }
        .assistant-followup-proceed {
          border: 1px solid color-mix(in srgb, var(--vscode-button-background) 60%, var(--vscode-widget-border, #444));
          background: color-mix(in srgb, var(--vscode-button-background) 84%, transparent);
          color: var(--vscode-button-foreground, var(--vscode-foreground));
          font-weight: 600;
        }
        .assistant-followup-proceed:disabled {
          cursor: not-allowed;
          opacity: 0.6;
          background: color-mix(in srgb, var(--vscode-editor-background) 94%, white 6%);
          color: var(--vscode-descriptionForeground, var(--vscode-foreground));
          border-color: var(--vscode-widget-border, #444);
<<<<<<< HEAD
        }
        .iteration-limit-actions {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-right: 6px;
        }
        .iteration-limit-continue,
        .iteration-limit-cancel {
          appearance: none;
          border-radius: 999px;
          padding: 4px 12px;
          font-size: 0.78rem;
          font-family: inherit;
          cursor: pointer;
          transition: background 0.15s ease, opacity 0.15s ease;
        }
        .iteration-limit-continue {
          border: 1px solid color-mix(in srgb, var(--vscode-button-background) 60%, var(--vscode-widget-border, #444));
          background: color-mix(in srgb, var(--vscode-button-background) 84%, transparent);
          color: var(--vscode-button-foreground, var(--vscode-foreground));
          font-weight: 600;
        }
        .iteration-limit-continue:hover {
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground, var(--vscode-foreground));
        }
        .iteration-limit-cancel {
          border: 1px solid var(--vscode-widget-border, #444);
          background: transparent;
          color: var(--vscode-foreground);
        }
        .iteration-limit-cancel:hover {
          background: color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
=======
>>>>>>> 3ef5f5a0deb5c668b775a31473176b4b9f96f3fa
        }
        .assistant-followups {
          display: flex;
          flex-direction: column;
          gap: 7px;
          margin-top: 2px;
          padding: 9px 10px;
          border-radius: 10px;
          border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 80%, transparent);
          background: color-mix(in srgb, var(--vscode-button-background) 6%, transparent);
        }
        .assistant-followup-question {
          color: var(--vscode-descriptionForeground, var(--vscode-foreground));
          font-size: 0.78rem;
          line-height: 1.45;
        }
        .assistant-followup-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .assistant-followup-chip {
          appearance: none;
          border: 1px solid var(--vscode-widget-border, #444);
          background: color-mix(in srgb, var(--vscode-editor-background) 90%, white 10%);
          color: var(--vscode-foreground);
          border-radius: 999px;
          padding: 4px 9px;
          font-size: 0.75rem;
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
          opacity: 0.92;
        }
        .thought-details .transcript-disclosure-title {
          font-size: 0.75rem;
          color: var(--vscode-descriptionForeground);
          font-weight: 600;
        }
        .thought-details .transcript-disclosure-summary {
          background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 98%, transparent);
        }
        .streaming-thought-details {
          margin-top: 6px;
          margin-bottom: 6px;
        }
        .streaming-thought-details .transcript-disclosure-title {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--vscode-descriptionForeground);
          font-style: italic;
        }
        .streaming-thought-list {
          margin: 4px 0 0 12px;
        }
        .streaming-thought-list li {
          font-size: 0.8em;
          color: color-mix(in srgb, var(--vscode-descriptionForeground) 90%, var(--vscode-foreground));
          margin: 3px 0;
        }
        .streaming-thought-list li:last-child {
          font-weight: 500;
          color: var(--vscode-descriptionForeground);
        }
        .thought-status-chip {
          display: inline-flex;
          align-items: center;
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
        .thought-summary {
          margin: 2px 0 0;
          color: color-mix(in srgb, var(--vscode-descriptionForeground) 88%, var(--vscode-foreground));
          font-size: 0.84em;
          line-height: 1.5;
        }
        .thought-list {
          margin: 8px 0 0 16px;
          padding: 0;
          color: color-mix(in srgb, var(--vscode-descriptionForeground) 88%, var(--vscode-foreground));
          font-size: 0.82em;
        }
        .thought-list li {
          margin: 4px 0;
        }
        .run-review-bubble {
          margin-top: 10px;
          padding: 12px;
          border-radius: 12px;
          border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 80%, transparent);
          background: color-mix(in srgb, var(--vscode-editorHoverWidget-background, var(--vscode-editor-background)) 76%, black 14%);
        }
        .run-review-header,
        .run-review-controls,
        .run-review-file-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .run-review-header {
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .run-review-kicker {
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--vscode-descriptionForeground);
          margin-bottom: 2px;
        }
        .run-review-title {
          margin: 0;
          font-size: 0.95rem;
        }
        .run-review-pill {
          padding: 3px 8px;
          border-radius: 999px;
          border: 1px solid color-mix(in srgb, var(--vscode-button-background) 48%, var(--vscode-widget-border, #444));
          font-size: 0.78rem;
        }
        .run-review-goal,
        .run-review-summary {
          margin: 0 0 8px;
          color: color-mix(in srgb, var(--vscode-descriptionForeground) 88%, var(--vscode-foreground));
        }
        .run-review-controls {
          margin-bottom: 10px;
          flex-wrap: wrap;
        }
        .run-review-open-center {
          border: 1px solid var(--vscode-widget-border, #444);
          border-radius: 999px;
          background: transparent;
          color: inherit;
          padding: 4px 10px;
          cursor: pointer;
        }
        .run-review-file-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .run-review-file-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto auto;
          gap: 8px;
          align-items: center;
          padding: 8px 10px;
          border-radius: 10px;
          border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 78%, transparent);
          background: color-mix(in srgb, var(--vscode-editor-background) 92%, black 8%);
        }
        .run-review-file-row.accepted {
          border-color: color-mix(in srgb, var(--vscode-testing-iconPassed, #4ec9b0) 52%, var(--vscode-widget-border, #444));
        }
        .run-review-file-row.dismissed {
          border-color: color-mix(in srgb, var(--vscode-errorForeground, #f14c4c) 52%, var(--vscode-widget-border, #444));
        }
        .run-review-file-link {
          padding: 0;
          border: 0;
          background: transparent;
          color: var(--vscode-textLink-foreground, var(--vscode-foreground));
          text-align: left;
          text-decoration: underline;
          cursor: pointer;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .run-review-file-meta {
          font-size: 0.78rem;
          color: var(--vscode-descriptionForeground);
          white-space: nowrap;
        }
        .run-review-decision-btn {
          width: 28px;
          height: 28px;
          border-radius: 999px;
          border: 1px solid var(--vscode-widget-border, #444);
          background: transparent;
          color: inherit;
          cursor: pointer;
          font-weight: 700;
        }
        .run-review-decision-btn.accepted {
          color: var(--vscode-testing-iconPassed, #4ec9b0);
        }
        .run-review-decision-btn.dismissed {
          color: var(--vscode-errorForeground, #f14c4c);
        }
        .run-review-decision-btn.active {
          background: color-mix(in srgb, currentColor 14%, transparent);
          border-color: currentColor;
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
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 28px;
          min-height: 28px;
          border-radius: 999px;
          font-size: 0.95rem;
          line-height: 1;
          box-sizing: border-box;
          vertical-align: middle;
        }
        .icon-btn svg {
          display: block;
          flex: 0 0 auto;
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
        @keyframes atlasmic-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.08); opacity: 0.7; }
        }
      `,
      scriptUri: scriptUri.toString(),
    });
  }
}

function deriveRecoveryNoticeFromTranscript(transcript: SessionTranscriptEntry[]): ChatPanelRecoveryNotice | undefined {
  const latestNote = [...transcript]
    .reverse()
    .find(entry => entry.role === 'assistant' && entry.meta?.timelineNotes?.some(note => note.label === 'Learned from friction'))
    ?.meta?.timelineNotes?.find(note => note.label === 'Learned from friction');

  if (!latestNote) {
    return undefined;
  }

  return {
    title: latestNote.label,
    summary: latestNote.summary,
    tone: 'recent',
  };
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

export async function revealPreferredChatSurface(target?: string | ChatPanelTarget): Promise<void> {
  const revealedDetachedPanel = await ChatPanel.revealCurrent(target);
  if (revealedDetachedPanel) {
    return;
  }

  await ChatViewProvider.open(target);
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
    ...(isJsonRecord(target.contextPatch) ? { contextPatch: target.contextPatch } : {}),
  };
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
      const attachmentBlock = entry.meta?.promptAttachments?.length
        ? `**Attachments:**\n${entry.meta.promptAttachments.map(attachment => `- ${escapeMarkdownHtml(attachment.kind)}: ${escapeMarkdownHtml(attachment.label)}`).join('\n')}\n\n`
        : '';
      const thoughtBlock = renderThoughtSummaryMarkdown(entry.meta?.thoughtSummary);
      const timelineBlock = renderTimelineNotesMarkdown(entry.meta?.timelineNotes);
      const followupBlock = renderSuggestedFollowupsMarkdown(entry.meta?.followupQuestion, entry.meta?.suggestedFollowups);
      return `## ${entry.role === 'user' ? 'User' : 'AtlasMind'}\n\n${modelLine}${feedbackLine}${attachmentBlock}${entry.content}${thoughtBlock}${timelineBlock}${followupBlock}`;
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

function renderTimelineNotesMarkdown(timelineNotes: readonly SessionTimelineNote[] | undefined): string {
  if (!timelineNotes || timelineNotes.length === 0) {
    return '';
  }

  return `\n\n<details class="thought-details">\n<summary>Internal monologue</summary>\n\n${timelineNotes.map(note => `- ${escapeMarkdownHtml(note.label)}: ${escapeMarkdownHtml(note.summary)}`).join('\n')}\n</details>`;
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

  if (message.type === 'reviewRunFile') {
    return typeof message.payload === 'object'
      && message.payload !== null
      && typeof (message.payload as { runId?: unknown }).runId === 'string'
      && typeof (message.payload as { relativePath?: unknown }).relativePath === 'string'
      && isRunReviewDecision((message.payload as { decision?: unknown }).decision);
  }

  if (message.type === 'reviewRunAll') {
    return typeof message.payload === 'object'
      && message.payload !== null
      && typeof (message.payload as { runId?: unknown }).runId === 'string'
      && isRunReviewDecision((message.payload as { decision?: unknown }).decision);
  }

  if (message.type === 'openRunReviewFile') {
    return typeof message.payload === 'object'
      && message.payload !== null
      && typeof (message.payload as { runId?: unknown }).runId === 'string'
      && typeof (message.payload as { relativePath?: unknown }).relativePath === 'string';
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

  if (message.type === 'continueExecution' || message.type === 'cancelExecution') {
    return typeof message.payload === 'object'
      && message.payload !== null
      && typeof (message.payload as { entryId?: unknown }).entryId === 'string';
  }

  if (message.type === 'saveFontScale') {
    return typeof message.payload === 'number' && Number.isFinite(message.payload);
  }

  return (message.type === 'selectSession'
    || message.type === 'deleteSession'
    || message.type === 'openProjectRun'
    || message.type === 'attachOpenFile'
    || message.type === 'removeAttachment')
    && typeof message.payload === 'string';
}

export function getStatusDrivenComposerMode(isBusy: boolean): PersistentComposerSendMode {
  return isBusy ? 'steer' : 'send';
}

export function isOneShotComposerMode(mode: ComposerSendMode | undefined): mode is Extract<ComposerSendMode, 'new-chat' | 'new-session'> {
  return mode === 'new-chat' || mode === 'new-session';
}

function isComposerSendMode(value: unknown): value is ComposerSendMode {
  return value === 'send' || value === 'steer' || value === 'new-chat' || value === 'new-session';
}

function isRunReviewDecision(value: unknown): value is Exclude<ProjectRunReviewDecision, 'pending'> {
  return value === 'accepted' || value === 'dismissed';
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
  const ansiPattern = `${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`;
  return value.replace(new RegExp(ansiPattern, 'g'), '');
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

function buildPromptAttachmentMetadata(attachments: ChatComposerAttachment[]): SessionPromptAttachment[] {
  return attachments.map(attachment => ({
    label: attachment.label,
    kind: attachment.kind,
    source: attachment.source,
    ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
    ...(buildInlineImagePreviewUri(attachment.imageAttachment)
      ? { previewDataUri: buildInlineImagePreviewUri(attachment.imageAttachment) }
      : {}),
  }));
}

function buildMultimodalPromptNote(attachments: ChatComposerAttachment[]): string | undefined {
  if (attachments.length === 0) {
    return undefined;
  }

  const summary = attachments.map(attachment => `- ${attachment.kind}: ${attachment.source}`).join('\n');
  return [
    'Use the attached material together with the typed request and the prior session context when answering.',
    'Attached for this turn:',
    summary,
  ].join('\n');
}

function toComposerAttachmentView(
  attachment: ChatComposerAttachment,
  webview: vscode.Webview,
): ChatPanelState['attachments'][number] {
  const previewUri = resolveAttachmentPreviewUri(attachment, webview);
  return {
    id: attachment.id,
    label: attachment.label,
    kind: attachment.kind,
    source: attachment.source,
    ...(previewUri ? { previewUri } : {}),
  };
}

function withAttachmentPreviewUris(
  entry: SessionTranscriptEntry,
  webview: vscode.Webview,
): SessionTranscriptEntry {
  if (!entry.meta?.promptAttachments?.length) {
    return entry;
  }

  return {
    ...entry,
    meta: {
      ...entry.meta,
      promptAttachments: entry.meta.promptAttachments.map(attachment => ({
        ...attachment,
        ...(resolveAttachmentPreviewUri(attachment, webview)
          ? { previewUri: resolveAttachmentPreviewUri(attachment, webview) }
          : {}),
      })),
    },
  };
}

function resolveAttachmentPreviewUri(
  attachment: Pick<SessionPromptAttachment, 'kind' | 'source' | 'previewDataUri'> & Partial<Pick<ChatComposerAttachment, 'uri' | 'imageAttachment'>>,
  webview: vscode.Webview,
): string | undefined {
  if (attachment.kind !== 'image') {
    return undefined;
  }
  if (attachment.previewDataUri) {
    return attachment.previewDataUri;
  }

  const inlinePreview = buildInlineImagePreviewUri(attachment.imageAttachment);
  if (inlinePreview) {
    return inlinePreview;
  }

  if (attachment.uri) {
    return webview.asWebviewUri(attachment.uri).toString();
  }

  if (!attachment.source || attachment.source.startsWith('clipboard/')) {
    return undefined;
  }

  const uri = resolveWorkspaceRelativeFile(attachment.source);
  return uri ? webview.asWebviewUri(uri).toString() : undefined;
}

function buildInlineImagePreviewUri(imageAttachment: TaskImageAttachment | undefined): string | undefined {
  if (!imageAttachment?.mimeType?.startsWith('image/') || !imageAttachment.dataBase64) {
    return undefined;
  }
  return `data:${imageAttachment.mimeType};base64,${imageAttachment.dataBase64}`;
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
  const reviewFiles = buildRunReviewFiles(run);
  return {
    id: run.id,
    title: run.title,
    goal: run.goal,
    shortTitle: buildChatRunShortTitle(run),
    status: run.status,
    updatedAt: run.updatedAt,
    ...(run.chatSessionId ? { chatSessionId: run.chatSessionId } : {}),
    ...(run.chatMessageId ? { chatMessageId: run.chatMessageId } : {}),
    currentBatch: run.currentBatch,
    totalBatches: run.totalBatches,
    paused: run.paused,
    awaitingBatchApproval: run.awaitingBatchApproval,
    pendingReviewCount: reviewFiles.filter(file => file.decision === 'pending').length,
    acceptedReviewCount: reviewFiles.filter(file => file.decision === 'accepted').length,
    dismissedReviewCount: reviewFiles.filter(file => file.decision === 'dismissed').length,
    reviewFiles,
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

function buildChatRunShortTitle(run: ProjectRunRecord): string {
  return run.title;
}

function buildRunReviewFiles(run: ProjectRunRecord): ChatPanelRunSummary['reviewFiles'] {
  const fileMap = new Map<string, { status: ChangedWorkspaceFile['status']; uriPath?: string }>();
  const sourceMap = new Map<string, Set<string>>();

  for (const reviewFile of run.reviewFiles ?? []) {
    fileMap.set(reviewFile.relativePath, {
      status: reviewFile.status,
      ...(reviewFile.uri?.fsPath ? { uriPath: reviewFile.uri.fsPath } : {}),
    });
  }

  const summaryFiles = run.summary?.changedFiles ?? [];
  for (const file of summaryFiles) {
    fileMap.set(file.relativePath, {
      status: file.status,
      ...(file.uri?.fsPath ? { uriPath: file.uri.fsPath } : {}),
    });
    const sourceTitles = run.summary?.fileAttribution[file.relativePath] ?? [];
    if (sourceTitles.length > 0) {
      sourceMap.set(file.relativePath, new Set(sourceTitles));
    }
  }

  for (const artifact of run.subTaskArtifacts) {
    for (const file of artifact.changedFiles) {
      if (!fileMap.has(file.relativePath)) {
        fileMap.set(file.relativePath, {
          status: file.status,
          ...(file.uri?.fsPath ? { uriPath: file.uri.fsPath } : {}),
        });
      }
      const titles = sourceMap.get(file.relativePath) ?? new Set<string>();
      titles.add(artifact.title);
      sourceMap.set(file.relativePath, titles);
    }
  }

  const reviewFileMap = new Map((run.reviewFiles ?? []).map(file => [file.relativePath, file]));
  return [...fileMap.entries()]
    .map(([relativePath, file]) => {
      const review = reviewFileMap.get(relativePath);
      return {
        relativePath,
        status: file.status,
        decision: review?.decision ?? 'pending',
        ...(file.uriPath ? { uriPath: file.uriPath } : {}),
        sourceTitles: [...(sourceMap.get(relativePath) ?? new Set<string>())],
      };
    })
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}


function buildPendingRunReviewSummary(projectRuns: ProjectRunRecord[]): ChatPanelState['pendingRunReview'] {
  const runs = projectRuns
    .map(run => {
      const pendingFiles = buildRunReviewFiles(run)
        .filter(file => file.decision === 'pending')
        .map(file => ({
          relativePath: file.relativePath,
          status: file.status,
          ...(file.uriPath ? { uriPath: file.uriPath } : {}),
        }));
      return pendingFiles.length > 0
        ? {
          runId: run.id,
          shortTitle: buildChatRunShortTitle(run),
          ...(run.chatSessionId ? { chatSessionId: run.chatSessionId } : {}),
          ...(run.chatMessageId ? { chatMessageId: run.chatMessageId } : {}),
          pendingFiles,
        }
        : undefined;
    })
    .filter((run): run is ChatPanelState['pendingRunReview']['runs'][number] => Boolean(run));

  return {
    totalPendingFiles: runs.reduce((total, run) => total + run.pendingFiles.length, 0),
    runs,
  };
}

function resolveWorkspaceRelativeFile(relativePath: string): vscode.Uri | undefined {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    return undefined;
  }

  return coerceWorkspaceFileUri(relativePath, workspaceRoot);
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

