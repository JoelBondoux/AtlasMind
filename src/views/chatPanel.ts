import * as path from 'path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import type { AtlasMindContext } from '../extension.js';
import type {
  SessionComposerPrefill,
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
  buildRoadmapStatusResult,
  buildAssistantResponseMetadata,
  buildProjectResponseMetadata,
  buildWorkstationContext,
  ensureAssistantVisibleResponse,
  reconcileAssistantResponse,
  resolveAtlasChatIntent,
  runProjectCommand,
  runLoopCommand,
  toApprovedProjectPrompt,
  toApprovedLoopPrompt,
} from '../chat/participant.js';
import { classifyToolInvocation, getToolApprovalMode, requiresToolApproval } from '../core/toolPolicy.js';
import { extractSessionCarryForwardImages, resolvePickedImageAttachments } from '../chat/imageAttachments.js';
import { buildChatWebviewHtml } from './chatWebviewMarkup.js';
import { hasAiInstructionSyncFile, scanAiInstructionFiles, syncAiInstructionFiles } from '../utils/aiInstructionSync.js';
import { stripAnsiSequences } from '../utils/terminalOutput.js';

import {
  type ComposerSendMode,
  type ChatPanelImportedItem,
  type LoopDecisionRequest,
  getStatusDrivenComposerMode,
  isOneShotComposerMode,
  isChatPanelMessage,
} from './chatProtocol.js';
import type { MissionCheckpointRequest, MissionBlockedRequest, MissionBlockResolution } from '../core/missionRunner.js';
import { formatCost } from '../core/currencyFormatter.js';

// Re-exported for existing importers/tests that resolve these from chatPanel.
export { getStatusDrivenComposerMode, isOneShotComposerMode, isChatPanelMessage };
export type { ComposerSendMode, ChatPanelMessage } from './chatProtocol.js';

const FONT_SCALE_STORAGE_KEY = 'atlasmind.chatFontScale';

/**
 * Structural subset of `vscode.WebviewPanel` / `vscode.WebviewView` that ChatPanel
 * depends on. Real panels/views satisfy this automatically; the remote-control
 * server supplies a synthetic host that pipes the same protocol over a WebSocket,
 * so a single ChatPanel implementation serves both local and remote surfaces.
 */
export interface ChatPanelHost {
  readonly webview: {
    html: string;
    postMessage(message: unknown): Thenable<boolean>;
    onDidReceiveMessage(
      listener: (message: unknown) => unknown,
      thisArgs?: unknown,
      disposables?: vscode.Disposable[],
    ): vscode.Disposable;
    asWebviewUri(localResource: vscode.Uri): vscode.Uri;
    readonly cspSource: string;
  };
  onDidDispose(listener: () => unknown, thisArgs?: unknown, disposables?: vscode.Disposable[]): vscode.Disposable;
  /** Present only on editor-panel hosts (vscode.WebviewPanel), not on views or the remote host. */
  reveal?(viewColumn?: vscode.ViewColumn, preserveFocus?: boolean): void;
}

/** Minimal webview surface needed to resolve attachment preview URIs. */
type AttachmentPreviewWebview = Pick<vscode.Webview, 'asWebviewUri'>;

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
  loopGoal?: string;
  directResponse?: { markdown: string; modelUsed: string; composerPrefills?: SessionComposerPrefill[] };
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
  autoSubmit?: boolean;
  contextPatch?: Record<string, unknown>;
  preserveFocus?: boolean;
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
  streamingThought?: string;
  streamingModels?: string[];
  composerDraft?: string;
  composerMode?: ComposerSendMode;
  sessions: SessionConversationSummary[];
  transcript: SessionTranscriptEntry[];
  pendingToolApprovals: PendingToolApprovalRequest[];
  /** An in-chat decision a running Mission Loop is waiting on (checkpoint / block recovery). */
  pendingLoopDecision?: LoopDecisionRequest;
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
  autopilotEnabled?: boolean;
  /** Name of the active workspace folder, announced in the sidebar brand header. */
  projectName?: string;
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
  public static lastUsedSurface: 'panel' | 'sidebar' | undefined;
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

  private readonly host: ChatPanelHost;
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
  /** In-chat Mission Loop decision the panel is currently awaiting (checkpoint / block recovery). */
  private pendingLoopDecision: LoopDecisionRequest | undefined;
  private pendingLoopDecisionResolve: ((choice: string) => void) | undefined;
  /** Cached project display name: the connected Git repo name when available, else the workspace folder name. */
  private cachedProjectName: string | undefined;
  private gitWatchersRegistered = false;
  private streamingThought: string | undefined;
  private streamingModels: string[] = [];
  private readonly onDisposed?: () => void;
  private _isDisposed = false;

  public static createOrShow(context: vscode.ExtensionContext, atlas: AtlasMindContext, target?: string | ChatPanelTarget): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    const normalizedTarget = normalizeChatPanelTarget(target);

    if (ChatPanel.currentPanel) {
      if (normalizedTarget.sessionId || normalizedTarget.messageId || normalizedTarget.draftPrompt || normalizedTarget.contextPatch || normalizedTarget.autoSubmit) {
        void ChatPanel.currentPanel.showChatSession(normalizedTarget);
      }
      ChatPanel.currentPanel.host.reveal?.(column, normalizedTarget.preserveFocus ?? false);
      ChatPanel.lastUsedSurface = 'panel';
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
    ChatPanel.lastUsedSurface = 'panel';
  }

  public static async revealCurrent(target?: string | ChatPanelTarget): Promise<boolean> {
    if (!ChatPanel.currentPanel) {
      return false;
    }

    const normalizedTarget = normalizeChatPanelTarget(target);
    if (normalizedTarget.sessionId || normalizedTarget.messageId || normalizedTarget.draftPrompt || normalizedTarget.contextPatch || normalizedTarget.autoSubmit) {
      await ChatPanel.currentPanel.showChatSession(normalizedTarget);
    }
    ChatPanel.currentPanel.host.reveal?.(
      vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One,
      normalizedTarget.preserveFocus ?? false,
    );
    return true;
  }

  constructor(
    host: ChatPanelHost,
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
    this.pendingComposerDraft = initialTarget?.autoSubmit ? undefined : initialTarget?.draftPrompt;
    this.pendingComposerMode = initialTarget?.sendMode;
    this.pendingComposerContextPatch = initialTarget?.contextPatch;
    this.host.webview.html = this.getHtml();

    this.host.onDidDispose(() => this.dispose(), null, this.disposables);
    this.host.webview.onDidReceiveMessage(message => {
      void this.handleMessage(message);
    }, null, this.disposables);

    this.atlas.sessionConversation.onDidChange(() => {
      // Keep each chat surface pinned to its locally selected session.
      // syncState() already falls back to active session if that local selection is deleted.
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
    this.disposables.push({
      dispose: this.atlas.toolApprovalManager?.onAutopilotChange?.(() => {
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
    void this.refreshProjectName();
    this.checkAiInstructionNudge();
    if (initialTarget?.autoSubmit && initialTarget.draftPrompt) {
      void this.runPrompt(initialTarget.draftPrompt, initialTarget.sendMode ?? 'send');
    }
  }

  public dispose(): void {
    this._isDisposed = true;
    this.settleLoopDecision('stop');
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
    this.pendingComposerDraft = normalizedTarget.autoSubmit ? undefined : normalizedTarget.draftPrompt;
    this.pendingComposerMode = normalizedTarget.sendMode;
    this.pendingComposerContextPatch = normalizedTarget.contextPatch;
    this.activeSurface = 'chat';
    await this.syncState();
    if (normalizedTarget.autoSubmit && normalizedTarget.draftPrompt) {
      await this.runPrompt(normalizedTarget.draftPrompt, normalizedTarget.sendMode ?? 'send');
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isChatPanelMessage(message)) {
      return;
    }

    switch (message.type) {
      case 'ready':
        // The webview script has loaded and attached its message listener. Push
        // the current state now so a freshly (re)resolved surface — notably the
        // sidebar view, which VS Code destroys and re-resolves whenever it is
        // hidden — never gets stuck on the static "no sessions" markup if it
        // missed the constructor's initial syncState().
        await this.syncState();
        return;
      case 'searchSession': {
        const rawQuery = typeof message.payload?.query === 'string' ? message.payload.query.trim() : '';
        const query = rawQuery.toLowerCase();
        await this.host.webview.postMessage({
          type: 'status',
          payload: rawQuery ? `Searching this session for "${rawQuery}"…` : 'Enter text to search this session.',
        });

        const transcript = this.atlas.sessionConversation.getTranscript(this.selectedSessionId);
        const results: Array<{ messageId: string; indices: Array<{ start: number; end: number }>; matchIndex: number }> = [];
        if (query && Array.isArray(transcript)) {
          transcript.forEach(entry => {
            if (typeof entry.content !== 'string' || entry.content.length === 0) {
              return;
            }
            const contentLower = entry.content.toLowerCase();
            let startIdx = 0;
            let matchIdx = 0;
            while (startIdx <= contentLower.length) {
              const found = contentLower.indexOf(query, startIdx);
              if (found === -1) {
                break;
              }
              results.push({
                messageId: entry.id,
                indices: [{ start: found, end: found + query.length }],
                matchIndex: matchIdx,
              });
              startIdx = found + query.length;
              matchIdx += 1;
            }
          });
        }

        await this.host.webview.postMessage({ type: 'searchResults', payload: results });
        if (rawQuery) {
          await this.host.webview.postMessage({
            type: 'status',
            payload: results.length > 0
              ? `Found ${results.length} match${results.length === 1 ? '' : 'es'} for "${rawQuery}".`
              : `No matches found for "${rawQuery}".`,
          });
        }
        return;
      }
      case 'deleteMessage': {
              // Remove the message from the current session transcript
              const deleted = this.atlas.sessionConversation.deleteMessage(message.payload, this.selectedSessionId);
              if (deleted) {
                await this.syncState();
                await this.host.webview.postMessage({ type: 'status', payload: 'Message deleted.' });
              } else {
                await this.host.webview.postMessage({ type: 'status', payload: 'Message not found.' });
              }
              return;
            }
      case 'submitPrompt':
        await this.runPrompt(message.payload.prompt, message.payload.mode);
        return;
      case 'resolveLoopDecision':
        if (this.pendingLoopDecision && this.pendingLoopDecision.id === message.payload.id) {
          this.settleLoopDecision(message.payload.choice);
          await this.syncState();
        }
        return;
      case 'stopPrompt':
        await this.stopActivePrompt();
        return;
      case 'toggleAutopilot': {
        const enabled = this.atlas.toolApprovalManager?.toggleAutopilot?.();
        await this.host.webview.postMessage({
          type: 'status',
          payload: enabled
            ? 'Autopilot enabled — tool approvals will be granted automatically.'
            : 'Autopilot disabled — tool approvals will require confirmation.',
        });
        return;
      }
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
        void this.atlas.sessionContextManager?.deleteSession(message.payload).catch(() => undefined);
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
      case 'raiseIterationLimitPermanent':
        await this.raiseIterationLimit(message.payload.entryId, message.payload.value, true);
        return;
      case 'raiseIterationLimitTemporary':
        await this.raiseIterationLimit(message.payload.entryId, message.payload.value, false);
        return;
      case 'raiseToolCallsPerTurnLimitPermanent':
        await this.raiseToolCallsPerTurnLimit(message.payload.entryId, message.payload.value, true);
        return;
      case 'raiseToolCallsPerTurnLimitTemporary':
        await this.raiseToolCallsPerTurnLimit(message.payload.entryId, message.payload.value, false);
        return;
      case 'saveFontScale':
        await this.atlas.extensionContext?.globalState?.update(FONT_SCALE_STORAGE_KEY, message.payload);
        return;
      case 'importSessionContext':
        await this.importSessionContext(message.payload);
        return;
      case 'sendToTerminal': {
        const terminal = vscode.window.activeTerminal ?? vscode.window.createTerminal('AtlasMind');
        terminal.show(true);
        terminal.sendText(message.payload.code, false);
        return;
      }
      case 'syncAiInstructions': {
        await this.handleSyncAiInstructionNudge();
        return;
      }
      case 'dismissAiInstructionNudge': {
        await this.atlas.extensionContext?.workspaceState?.update(ChatPanel.NUDGE_DISMISSED_KEY, true);
        await this.host.webview.postMessage({ type: 'hideAiInstructionNudge' });
        return;
      }
      case 'openSettings':
        await vscode.commands.executeCommand('atlasmind.openSettings');
        return;
      case 'openProjectDashboard':
        await vscode.commands.executeCommand('atlasmind.openProjectDashboard');
        return;
    }
  }

  private static readonly NUDGE_DISMISSED_KEY = 'atlasmind.aiInstructionNudgeDismissed';

  private async handleSyncAiInstructionNudge(): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return;
    }
    const files = scanAiInstructionFiles(workspaceRoot);
    if (files.length === 0) {
      await this.host.webview.postMessage({ type: 'hideAiInstructionNudge' });
      return;
    }
    const result = await syncAiInstructionFiles(workspaceRoot, files.map(f => f.relativePath));
    if (result.success) {
      await this.host.webview.postMessage({ type: 'hideAiInstructionNudge' });
      await this.host.webview.postMessage({
        type: 'status',
        payload: `AI instructions synced: ${result.summary}`,
      });
    } else {
      await this.host.webview.postMessage({ type: 'resetSyncButton' });
      await this.host.webview.postMessage({
        type: 'status',
        payload: `AI instruction sync failed: ${result.summary}`,
      });
    }
  }

  private checkAiInstructionNudge(): void {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot || this.atlas.extensionContext?.workspaceState?.get<boolean>(ChatPanel.NUDGE_DISMISSED_KEY) === true) {
      return;
    }
    if (hasAiInstructionSyncFile(workspaceRoot)) {
      return;
    }
    const files = scanAiInstructionFiles(workspaceRoot);
    if (files.length === 0) {
      return;
    }
    const fileList = files.map(f => f.relativePath).join(', ');
    void this.host.webview.postMessage({
      type: 'showAiInstructionNudge',
      payload: { files: fileList },
    });
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
    if (this._isDisposed) return;
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
    // If another panel is actively executing on this same session, spawn a separate session
    // so their transcripts stay isolated and neither sees the other's streaming responses.
    const sessionConflict = mode === 'send' && ChatPanel.collectActiveExecutions()
      .some(exec => exec.sessionId === this.selectedSessionId);
    // "New Loop" also starts in its own fresh session (like "New Session") so the
    // autonomous run's transcript stays isolated from the current conversation.
    const activeSessionId = (mode === 'new-session' || mode === 'new-loop' || sessionConflict)
      ? this.atlas.sessionConversation.spawnSession()
      : this.selectedSessionId;
    if (mode === 'new-chat') {
      this.atlas.sessionConversation.clearSession(activeSessionId);
    }
    // Load structured session context; fall back to legacy string if not yet available.
    const sessionContextBundle = await this.atlas.sessionContextManager?.loadContext(activeSessionId).catch(() => null) ?? null;
    const sessionContext = sessionContextBundle
      ? ''
      : this.atlas.sessionConversation.buildContext({
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
      sessionContextBundle ?? undefined,
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
    const streamingThoughtLines: string[] = [];
    this.streamingModels = [];
    const renderPendingAssistant = async (): Promise<void> => {
      this.atlas.sessionConversation.updateMessage(assistantMessageId, streamedText, activeSessionId);
      this.streamingThought = streamingThoughtLines.length > 0 ? streamingThoughtLines.join('\n') : undefined;
      await this.syncState();
    };
    const handleModelSelected = async (model: string): Promise<void> => {
      if (!this.streamingModels.includes(model)) {
        this.streamingModels.push(model);
        await this.syncState();
      }
    };
    try {
      if (preparedRequest.loopGoal) {
        await this.runLoopPrompt(
          preparedRequest.loopGoal,
          assistantMessageId,
          activeSessionId,
          cancellationSource.token,
          sessionContext || undefined,
        );
        await this.host.webview.postMessage({ type: 'status', payload: 'Mission loop finished.' });
        return;
      }

      if (preparedRequest.projectGoal) {
        await this.runProjectPrompt(
          preparedRequest.projectGoal,
          assistantMessageId,
          activeSessionId,
          submittedAttachments,
          cancellationSource.token,
          sessionContextBundle ?? undefined,
          sessionContext || undefined,
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
            ...(preparedRequest.directResponse.composerPrefills
              ? { composerPrefills: preparedRequest.directResponse.composerPrefills }
              : {}),
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
        signal: abortController.signal,
      }, async chunk => {
        if (!chunk || abortController.signal.aborted) {
          return;
        }
        streamedText += chunk;
        try {
          await renderPendingAssistant();
        } catch (error) {
          console.error('[AtlasMind] Failed to stream chat panel chunk.', error);
        }
      }, async message => {
        if (abortController.signal.aborted || !message.trim()) {
          return;
        }
        if (isSignificantProgressMessage(message.trim())) {
          streamingThoughtLines.push(message.trim());
        }
        await this.host.webview.postMessage({ type: 'status', payload: message.trim() });
        try {
          await renderPendingAssistant();
        } catch (error) {
          console.error('[AtlasMind] Failed to stream chat panel progress update.', error);
        }
      }, async model => {
        if (!abortController.signal.aborted) {
          await handleModelSelected(model);
        }
      });

      if (abortController.signal.aborted) {
        throw createAbortError();
      }

      const reconciled = reconcileAssistantResponse(streamedText, result.response);
      this.streamingThought = undefined;
      const completedModels = this.streamingModels.length > 0 ? [...this.streamingModels] : undefined;
      this.streamingModels = [];
      const assistantMeta = {
        ...buildAssistantResponseMetadata(preparedRequest.userMessage, result, {
          hasSessionContext: Boolean(sessionContext),
          responseText: reconciled.transcriptText,
          routingContext: {
            ...preparedRequest.context,
            ...(sessionContext ? { sessionContext } : {}),
          },
          policies: [
            ...this.atlas.getWorkspacePolicySnapshots(),
            ...(preparedRequest.policySnapshots ?? []),
          ],
        }),
        ...(completedModels && completedModels.length > 1 ? { modelsUsed: completedModels } : {}),
      };
      const visibleTranscriptText = ensureAssistantVisibleResponse(reconciled.transcriptText, assistantMeta);
      this.atlas.sessionConversation.updateMessage(
        assistantMessageId,
        visibleTranscriptText,
        activeSessionId,
        assistantMeta,
      );
      await this.persistGapAnalysisIfRequested(preparedRequest.context, visibleTranscriptText);
      // Trigger session SSOT maintenance fire-and-forget — never blocks the response.
      this.atlas.sessionContextManager?.maintainContext(
        activeSessionId,
        this.atlas.sessionConversation.getTranscript(activeSessionId),
      );
      await this.syncState();

      if (configuration.get<boolean>('voice.ttsEnabled', false)) {
        this.atlas.voiceManager.speak(visibleTranscriptText);
      }
      await this.host.webview.postMessage({ type: 'status', payload: `Response ready via ${result.modelUsed}.` });
    } catch (error) {
      this.streamingThought = undefined;
      this.streamingModels = [];
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

  private async persistGapAnalysisIfRequested(context: Record<string, unknown>, response: string): Promise<void> {
    const request = context['dashboardGapAnalysis'];
    if (!isJsonRecord(request) || request['persist'] !== true) {
      return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return;
    }

    const ssotPath = typeof request['ssotPath'] === 'string' && request['ssotPath'].trim().length > 0
      ? request['ssotPath'].trim()
      : 'project_memory';
    const checklistLines = extractGapAnalysisChecklist(response);
    const outputPath = path.join(workspaceRoot, ssotPath, 'analysis', 'gap-analysis.md');

    if (checklistLines.length === 0) {
      // Claude didn't emit a structured checklist. Don't overwrite the file with the
      // old seed items — that would silently revert the dashboard to its pre-analysis
      // state. Leave whatever is on disk unchanged and just trigger a re-read.
      this.atlas.memoryRefresh.fire();
      await this.host.webview.postMessage({ type: 'status', payload: 'Gap analysis complete. No structured checklist found in the response; the existing analysis was retained.' });
      return;
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${checklistLines.join('\n')}\n`, 'utf8');
    this.atlas.memoryRefresh.fire();
    await this.host.webview.postMessage({ type: 'status', payload: 'Gap analysis saved back to the Project Dashboard.' });
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
    // Resolve any in-chat loop decision so a paused mission halts cleanly.
    this.settleLoopDecision('stop');
    targetExecution.interrupt?.();
    targetExecution.abortController.abort();
    await this.host.webview.postMessage({ type: 'busy', payload: false });
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

  private async raiseIterationLimit(entryId: string, value: number, permanent: boolean): Promise<void> {
    const safeValue = Math.max(1, Math.min(50, Math.round(value)));
    this.atlas.orchestrator.updateConfig({ maxToolIterations: safeValue });
    if (permanent) {
      await vscode.workspace.getConfiguration('atlasmind').update('maxToolIterations', safeValue, vscode.ConfigurationTarget.Workspace);
    }
    await this.continueFromIterationLimit(entryId);
  }

  private async raiseToolCallsPerTurnLimit(entryId: string, value: number, permanent: boolean): Promise<void> {
    const safeValue = Math.max(1, Math.min(30, Math.round(value)));
    this.atlas.orchestrator.updateConfig({ maxToolCallsPerTurn: safeValue });
    if (permanent) {
      await vscode.workspace.getConfiguration('atlasmind').update('maxToolCallsPerTurn', safeValue, vscode.ConfigurationTarget.Workspace);
    }
    await this.continueFromIterationLimit(entryId);
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
        responseText: reconciled.transcriptText,
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
        executionRecord.output = appendManagedTerminalOutput(executionRecord.output, stripAnsiSequences(chunk));
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
    sessionContextBundle?: import('../types.js').SessionContextBundle,
    sessionContext?: string,
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
      undefined,
      sessionContextBundle,
      sessionContext,
    );
  }

  /**
   * Run an autonomous Mission Loop from the composer's "New Loop" mode, streaming
   * iteration progress into the assistant message via a synthetic chat stream
   * (mirrors {@link runProjectPrompt}). The prompt becomes the mission goal and is
   * auto-approved — selecting "New Loop" and sending is the operator's go-ahead;
   * per-iteration checkpoints and budget caps still apply.
   */
  private async runLoopPrompt(
    loopGoal: string,
    assistantMessageId: string,
    activeSessionId: string,
    token: vscode.CancellationToken,
    sessionContext?: string,
  ): Promise<void> {
    await this.appendAssistantMessage(
      assistantMessageId,
      activeSessionId,
      '### Mission Loop\n\nStarting an autonomous goal-seeking loop for this prompt.',
    );

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

    // In-chat decision gates: checkpoints and recoverable-block prompts render as
    // buttons at the base of the chat surface (never an OS modal).
    const checkpointGate = async (req: MissionCheckpointRequest): Promise<boolean> => {
      if (token.isCancellationRequested) {
        return false;
      }
      const choice = await this.requestLoopDecision({
        title: `Checkpoint — iteration ${req.iterationIndex}`,
        detail:
          `${req.reason} Spent ${formatCost(req.spentUsd, 4)} of ${formatCost(req.budgetUsd, 2)} · ` +
          `${req.spentTokens.toLocaleString()} tokens · ${req.iterationsRun} iteration(s) done.`,
        options: [
          { id: 'continue', label: 'Approve & continue', kind: 'primary' },
          { id: 'stop', label: 'Stop', kind: 'danger' },
        ],
      });
      return choice === 'continue';
    };

    const blockAsk = async (req: MissionBlockedRequest): Promise<MissionBlockResolution> => {
      const choice = await this.requestLoopDecision({
        title: `Blocked — ${req.blocker.title}`,
        detail: `${req.blocker.detail} (setting: ${req.blocker.settingKey})`,
        options: [
          { id: 'override', label: 'Override for this run', kind: 'primary' },
          { id: 'settings', label: 'Open settings' },
          { id: 'stop', label: 'Stop', kind: 'danger' },
        ],
      });
      if (choice === 'override') {
        return 'override-once';
      }
      if (choice === 'settings') {
        await vscode.commands.executeCommand(req.blocker.settingsCommand);
        return 'open-settings';
      }
      return 'stop';
    };

    // sessionId is passed undefined so runLoopCommand does not double-record the
    // turn — the panel already manages this session's transcript via the sink.
    await runLoopCommand(
      toApprovedLoopPrompt(loopGoal),
      sink,
      token,
      this.atlas,
      undefined,
      sessionContext,
      { checkpointGate, blockAsk },
    );
  }

  /**
   * Surface an in-chat decision (rendered as buttons below the transcript) and
   * resolve with the option id the user clicks. Deny-safe: a prior unresolved
   * decision, a stop, or disposal resolves to 'stop'.
   */
  private requestLoopDecision(request: Omit<LoopDecisionRequest, 'id'>): Promise<string> {
    this.settleLoopDecision('stop');
    const id = `loop-decision-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.pendingLoopDecision = { id, ...request };
    void this.syncState();
    return new Promise<string>(resolve => {
      this.pendingLoopDecisionResolve = resolve;
    });
  }

  private settleLoopDecision(choice: string): void {
    const resolve = this.pendingLoopDecisionResolve;
    this.pendingLoopDecision = undefined;
    this.pendingLoopDecisionResolve = undefined;
    if (resolve) {
      resolve(choice);
    }
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
    if (this._isDisposed) return;
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

    const storedFontScale = this.atlas.extensionContext?.globalState?.get<number>(FONT_SCALE_STORAGE_KEY);

    const payload: ChatPanelState = {
      activeSurface: this.activeSurface,
      ...(typeof storedFontScale === 'number' ? { chatFontScale: storedFontScale } : {}),
      selectedSessionId: this.selectedSessionId,
      ...(this.selectedMessageId ? { selectedMessageId: this.selectedMessageId } : {}),
      busy: isBusyForSelectedSession,
      ...(busyExecution ? { busySessionId: busyExecution.sessionId, busyAssistantMessageId: busyExecution.assistantMessageId } : {}),
      ...(this.streamingThought ? { streamingThought: this.streamingThought } : {}),
      ...(this.streamingModels.length > 0 ? { streamingModels: [...this.streamingModels] } : {}),
      ...(this.pendingComposerDraft ? { composerDraft: this.pendingComposerDraft } : {}),
      composerMode: this.pendingComposerMode ?? getStatusDrivenComposerMode(isBusyForSelectedSession),
      sessions,
      transcript: transcriptPayload,
      pendingToolApprovals: this.atlas.toolApprovalManager?.listPendingRequests?.() ?? [],
      ...(this.pendingLoopDecision ? { pendingLoopDecision: this.pendingLoopDecision } : {}),
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
      autopilotEnabled: this.atlas.toolApprovalManager?.isAutopilot?.() ?? false,
      ...(this.resolveProjectName() ? { projectName: this.resolveProjectName() } : {}),
    };

    await this.host.webview.postMessage({ type: 'state', payload });
    this.pendingComposerDraft = undefined;
    this.pendingComposerMode = undefined;
  }

  /**
   * The name announced in the sidebar brand header: the connected Git repository
   * name when one has been resolved, otherwise the active workspace folder name.
   */
  private resolveProjectName(): string | undefined {
    return this.cachedProjectName ?? vscode.workspace.workspaceFolders?.[0]?.name;
  }

  /**
   * Asynchronously resolves the connected Git repository name from the built-in
   * Git extension and caches it. Re-syncs the webview when the resolved name
   * differs from what is currently displayed, and watches for the repo (or its
   * remotes) being connected later in the session.
   */
  private async refreshProjectName(): Promise<void> {
    if (this._isDisposed) return;
    try {
      const api = await getGitApi();
      if (this._isDisposed || !api) {
        return;
      }

      // Watch (once per panel) for a repo or remote being connected later in the
      // session so the brand header updates without a reload.
      if (!this.gitWatchersRegistered) {
        this.gitWatchersRegistered = true;
        const onChange = () => { void this.refreshProjectName(); };
        this.disposables.push(api.onDidOpenRepository(repo => {
          this.disposables.push(repo.state.onDidChange(onChange));
          onChange();
        }));
        for (const repo of api.repositories) {
          this.disposables.push(repo.state.onDidChange(onChange));
        }
      }

      const repoName = resolveRepoNameFromApi(api);
      if (this._isDisposed || repoName === this.cachedProjectName) {
        return;
      }
      this.cachedProjectName = repoName;
      await this.syncState();
    } catch (error) {
      console.error('[AtlasMind] Failed to resolve the connected Git repository name.', error);
    }
  }

  private async preparePromptRequest(
    prompt: string,
    attachments: ChatComposerAttachment[],
    mode: ComposerSendMode,
    sessionContext: string,
    activeSessionId: string,
    sessionContextBundle?: import('../types.js').SessionContextBundle,
  ): Promise<PreparedPromptRequest> {
    const forceSteer = mode === 'steer';
    // "New Loop" treats the whole prompt as a mission goal: skip steer, terminal
    // directive parsing, and intent routing so the goal runs as a loop verbatim.
    const isNewLoop = mode === 'new-loop';
    const terminalDirectiveResolution = forceSteer || isNewLoop ? undefined : resolveManagedTerminalDirective(prompt);
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

    // "New Loop" composer mode: the whole prompt is the mission goal, bypassing
    // intent routing and the project path.
    const loopGoal = isNewLoop ? prompt : undefined;
    const routedIntent = forceSteer || isNewLoop
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
    const roadmapStatus = forceSteer ? undefined : await buildRoadmapStatusResult(prompt);
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
      chatSessionId: activeSessionId,
      ...(sessionContextBundle ? { sessionContextBundle } : (sessionContext ? { sessionContext } : {})),
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
      ...(loopGoal ? { loopGoal } : {}),
      ...(roadmapStatus
        ? {
          directResponse: {
            markdown: roadmapStatus.markdown,
            modelUsed: 'atlasmind/roadmap-status',
            ...(roadmapStatus.prefills.length > 0 ? { composerPrefills: roadmapStatus.prefills } : {}),
          },
        }
        : {}),
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

  private async importSessionContext(sourceSessionId: string): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      await this.host.webview.postMessage({ type: 'status', payload: 'Open a workspace folder first to import session context.' });
      return;
    }

    if (sourceSessionId === this.selectedSessionId) {
      await this.host.webview.postMessage({ type: 'status', payload: 'Cannot import context from the currently active session.' });
      return;
    }

    const sourceSession = this.atlas.sessionConversation.getSession(sourceSessionId);
    if (!sourceSession) {
      await this.host.webview.postMessage({ type: 'status', payload: 'Source session not found.' });
      return;
    }

    const transcript = this.atlas.sessionConversation.getTranscript(sourceSessionId);
    if (transcript.length === 0) {
      await this.host.webview.postMessage({ type: 'status', payload: 'The selected session has no messages to summarize.' });
      return;
    }

    await this.host.webview.postMessage({ type: 'status', payload: `Generating context summary for "${sourceSession.title}"…` });

    const transcriptText = transcript
      .map(entry => `${entry.role === 'user' ? 'User' : 'Assistant'}: ${entry.content}`)
      .join('\n\n');

    const systemPrompt = [
      'You are summarizing a chat session for use as reasoning context in a different session.',
      'Produce a concise markdown document with the following sections (omit any that are not relevant):',
      '- **Goal** – What the user was trying to accomplish.',
      '- **Key Decisions** – Important choices or conclusions reached.',
      '- **Findings** – Notable facts, results, or discoveries.',
      '- **Open Items** – Unresolved questions or next steps.',
      'Do not reproduce the full conversation verbatim. Focus on what would be most useful as reasoning context.',
      'Begin the document with: ## Session Context: ' + sourceSession.title,
    ].join('\n');

    const userPrompt = `--- BEGIN TRANSCRIPT ---\n${transcriptText}\n--- END TRANSCRIPT ---`;

    let summary: string;
    try {
      summary = (await this.atlas.orchestrator.summarizeText(systemPrompt, userPrompt)).trim();
    } catch (error) {
      console.error('[AtlasMind] Failed to generate session context summary.', error);
      await this.host.webview.postMessage({ type: 'status', payload: 'Failed to generate session context summary.' });
      return;
    }

    if (!summary) {
      await this.host.webview.postMessage({ type: 'status', payload: 'The model returned an empty summary.' });
      return;
    }

    const safeTitle = sourceSession.title.replace(/[^a-z0-9-_]/gi, '-').toLowerCase().slice(0, 48);
    const fileName = `session-context-${safeTitle}-${sourceSessionId.slice(0, 8)}.md`;
    const dirPath = path.join(workspaceRoot, '.atlasmind');
    const filePath = path.join(dirPath, fileName);
    const fileUri = vscode.Uri.file(filePath);

    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(summary, 'utf8'));
    } catch (error) {
      console.error('[AtlasMind] Failed to write session context file.', error);
      await this.host.webview.postMessage({ type: 'status', payload: 'Failed to write session context file.' });
      return;
    }

    await this.addAttachmentUris([fileUri]);
    await this.host.webview.postMessage({
      type: 'status',
      payload: `Session context from "${sourceSession.title}" attached to the composer.`,
    });
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
    ).toString();
    return buildChatWebviewHtml({ scriptUri, cspSource: this.host.webview.cspSource });
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
    const normalizedTarget = normalizeChatPanelTarget(target);
    ChatPanel.lastUsedSurface = 'sidebar';
    ChatViewProvider.currentProvider?.setPendingTarget(target);
    await vscode.commands.executeCommand('workbench.view.extension.atlasmind-sidebar');
    if (!normalizedTarget.preserveFocus) {
      try {
        await vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`);
      } catch {
        // Some VS Code builds do not expose a focus command for custom views.
      }
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
    return this.initializeWebviewView(webviewView);
  }

  private async initializeWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.currentSurface?.dispose();
    this.currentView = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };

    // Let VS Code settle the underlying webview document before attaching
    // AtlasMind's chat surface to reduce startup-time invalid state races.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    if (this.currentView !== webviewView) {
      return;
    }

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
  // If the user last explicitly used the detached panel, reveal it (if still alive).
  if (ChatPanel.lastUsedSurface === 'panel') {
    const revealed = await ChatPanel.revealCurrent(target);
    if (revealed) { return; }
  }
  // Default to the sidebar view — covers "sidebar last used", "no preference yet", and
  // "panel was last used but has since been closed".
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
    ...(target.sendMode === 'send' || target.sendMode === 'steer' || target.sendMode === 'new-chat' || target.sendMode === 'new-session' || target.sendMode === 'new-loop' ? { sendMode: target.sendMode } : {}),
    ...(target.autoSubmit === true ? { autoSubmit: true } : {}),
    ...(isJsonRecord(target.contextPatch) ? { contextPatch: target.contextPatch } : {}),
    ...(target.preserveFocus === true ? { preserveFocus: true } : {}),
  };
}

function extractGapAnalysisChecklist(response: string): string[] {
  return response
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /^- \[( |x)](?: \[(P[1-3])])?(?: \[([a-z0-9-]+)])? \[(gap|concern|praise)] .+$/i.test(line))
    .map(line => /^- \[( |x)] \[(gap|concern|praise)] .+$/i.test(line)
      ? line.replace(/^(- \[(?: |x)]) \[(gap|concern|praise)] /i, '$1 [P2] [general] [$2] ')
      : line);
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structural subset of the built-in `vscode.git` extension API we rely on. */
interface GitRemoteLike {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}
interface GitRepositoryLike {
  rootUri: vscode.Uri;
  state: {
    remotes: readonly GitRemoteLike[];
    onDidChange: vscode.Event<void>;
  };
}
interface GitApiLike {
  repositories: readonly GitRepositoryLike[];
  onDidOpenRepository: vscode.Event<GitRepositoryLike>;
}
interface GitExtensionLike {
  getAPI(version: number): GitApiLike;
}

/**
 * Returns the built-in `vscode.git` extension API, activating the extension if
 * needed. Returns `undefined` when Git tooling is unavailable (e.g. a web host
 * without the Git extension).
 */
async function getGitApi(): Promise<GitApiLike | undefined> {
  const extension = vscode.extensions.getExtension<GitExtensionLike>('vscode.git');
  if (!extension) {
    return undefined;
  }
  if (!extension.isActive) {
    await extension.activate();
  }
  return extension.exports.getAPI(1);
}

/**
 * Resolves the connected Git repository name for the active workspace. Returns
 * `undefined` when Git is unavailable, no repo is open, or no remote is
 * configured — callers fall back to the folder name.
 */
function resolveRepoNameFromApi(api: GitApiLike): string | undefined {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const repo = (workspaceRoot
    && api.repositories.find(candidate => candidate.rootUri.fsPath === workspaceRoot))
    ?? api.repositories[0];
  if (!repo) {
    return undefined;
  }

  const remotes = repo.state.remotes;
  const origin = remotes.find(remote => remote.name === 'origin') ?? remotes[0];
  const url = origin?.fetchUrl ?? origin?.pushUrl;
  return url ? parseRepoNameFromRemoteUrl(url) : undefined;
}

/**
 * Extracts the repository name from a Git remote URL. Handles HTTPS/SSH/SCP
 * forms (`https://host/owner/repo.git`, `git@host:owner/repo.git`, `ssh://…`),
 * trailing `.git`, and trailing slashes. Returns `undefined` when no name can
 * be isolated.
 */
function parseRepoNameFromRemoteUrl(remoteUrl: string): string | undefined {
  let path = remoteUrl.trim();
  if (!path) {
    return undefined;
  }
  // Strip scheme/host: take everything after the last ':' or '/' boundary group.
  // scp-like `git@host:owner/repo` and URL `scheme://host/owner/repo` both end
  // in `owner/repo`, so normalise separators then take the final segment.
  path = path.replace(/\.git$/i, '').replace(/\/+$/, '');
  const segments = path.split(/[/:]/).filter(segment => segment.length > 0);
  const last = segments[segments.length - 1];
  return last && last.length > 0 ? last : undefined;
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

  const stats = await fs.stat(uri.fsPath).catch(() => undefined);
  if (!stats?.isFile()) {
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
  webview: AttachmentPreviewWebview,
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
  webview: AttachmentPreviewWebview,
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
  webview: AttachmentPreviewWebview,
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

// Patterns for progress messages that are purely internal orchestrator mechanics
// and add no value to the streaming-thought activity display shown to the user.
const SUPPRESSED_PROGRESS_PATTERNS: RegExp[] = [
  /^Tool round \d+: asking the model to inspect/,
  /^Preferring a local tool-capable model for this terse tool action/,
  /^No model matched the current budget\/speed gates; retrying/,
  /^Pinned models for .+ excluded tool-capable options/,
  /^No function-calling model matched for/,
];

function isSignificantProgressMessage(message: string): boolean {
  return !SUPPRESSED_PROGRESS_PATTERNS.some(pattern => pattern.test(message));
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
      return 'Denied the pending request.';
  }
}

