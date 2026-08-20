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
  resolveProjectRunProposal,
  resolveProjectRunAutoFlow,
  runProjectCommand,
  runLoopCommand,
  toApprovedLoopPrompt,
} from '../chat/participant.js';
import { classifyToolInvocation, getToolApprovalMode, requiresToolApproval } from '../core/toolPolicy.js';
import { decideApprovalAttention } from '../core/approvalAttention.js';
import { extractSessionCarryForwardImages, resolvePickedImageAttachments } from '../chat/imageAttachments.js';
import { buildChatWebviewHtml } from './chatWebviewMarkup.js';
import { hasAiInstructionSyncFile, scanAiInstructionFiles, syncAiInstructionFiles } from '../utils/aiInstructionSync.js';
import { stripAnsiSequences } from '../utils/terminalOutput.js';
import { answerConversationRecall, parseConversationRecallRequest } from '../core/conversationRecall.js';
import { collectPickableModels, resolveModelOverride, type ModelOverride, type PickableModel } from './modelPickerShared.js';
import { estimateTokens } from '../core/orchestrator.js';
import { redactSecrets } from '../utils/secretRedactor.js';

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
import { ATLAS_SLASH_COMMANDS, routePanelPrompt, type PanelSlashRoute } from './chatSlashRouting.js';
import { detectGovernedAction } from '../core/workflowChatGuard.js';
export type { ComposerSendMode, ChatPanelMessage } from './chatProtocol.js';

const FONT_SCALE_STORAGE_KEY = 'atlasmind.chatFontScale';
/**
 * How often a streaming reply pushes state to the webview.
 *
 * Roughly a frame. Low enough that the reply still reads as it is written, high
 * enough that a fast provider cannot drive hundreds of full state rebuilds
 * through a single answer.
 */
const COALESCED_SYNC_INTERVAL_MS = 60;

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
  /** Present on sidebar-view hosts (vscode.WebviewView). */
  show?(preserveFocus?: boolean): void;
  /**
   * Whether the surface is on screen. Absent on the remote host, where it is
   * unknowable — treated as not visible, so a waiting approval is announced
   * rather than assumed to have been seen.
   */
  readonly visible?: boolean;
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
  /** False for continuation/card starts so the file-count safety gate still runs. */
  loopGoal?: string;
  directResponse?: ChatPanelDirectResponse;
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
  /**
   * A bounded host-authored answer that accompanies an auto-submitted prompt.
   *
   * Used when AtlasMind itself owns the answer (for example the meaning and
   * evidence rules of a Testing Policy Coverage row). It avoids routing a
   * deterministic explanation through one or more models merely to recover the
   * catalogue AtlasMind already declared.
   */
  directResponse?: ChatPanelDirectResponse;
  contextPatch?: Record<string, unknown>;
  preserveFocus?: boolean;
}

export interface ChatPanelDirectResponse {
  markdown: string;
  modelUsed: string;
  statusMessage?: string;
  thoughtSummary?: SessionThoughtSummary;
  followupQuestion?: string;
  quickReplies?: SessionSuggestedFollowup[];
  composerPrefills?: SessionComposerPrefill[];
}

/**
 * What the next turn would send, and the ceiling it is measured against.
 *
 * Two different ceilings, and which one applies is the interesting part. When a
 * model is known — pinned, or the one that answered last — the bar is measured
 * against that model's real context window. When none is known the bar falls
 * back to the operator's own session budget, because claiming a percentage of a
 * window nobody has chosen would be a number invented to fill a bar.
 */
interface ChatContextMeter {
  /** Estimated tokens the next turn would carry, excluding the unsent draft. */
  estimatedTokens: number;
  /** The model the estimate is measured against, when one is known. */
  modelId?: string;
  /** That model's context window, when it publishes one. */
  contextWindow?: number;
  /** Session budget, always present: the fallback ceiling and the honest one. */
  contextChars: number;
  charBudget: number;
  turnCount: number;
  turnLimit: number;
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
  /** Slash commands the composer offers, sorted. Sent once per state sync. */
  slashCommands?: Array<{ name: string; description: string }>;
  /** Models the operator may pin, from providers they have configured. */
  availableModels?: PickableModel[];
  /** The pin currently in force, if any. */
  modelOverride?: ModelOverride;
  /** What the next turn would carry, and what it is measured against. */
  contextMeter?: ChatContextMeter;
  /** Task ids with a stored file snapshot, so a turn can offer to restore it. */
  checkpointTaskIds?: string[];
  sessions: SessionConversationSummary[];
  transcript: SessionTranscriptEntry[];
  pendingToolApprovals: PendingToolApprovalRequest[];
  /** An in-chat decision a running Mission Loop is waiting on (checkpoint / block recovery). */
  pendingLoopDecision?: LoopDecisionRequest;
  /**
   * A question the Buzz setup walkthrough is asking, rendered as chips.
   *
   * Separate from `pendingLoopDecision` on purpose: a mission decision gates a
   * run, and reusing its slot would let a setup question and a blocked run
   * overwrite each other.
   */
  pendingGuideChoice?: { id: string; title: string; detail?: string; options: Array<{ id: string; label: string }> };
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
  /** Approval request ids already announced, so a resolution does not re-fire one. */
  private announcedApprovalIds: string[] = [];
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
  /** The last real text editor, for code-block actions. See the listener that sets it. */
  private lastActiveTextEditor: vscode.TextEditor | undefined;
  /**
   * The routed model the operator pinned, if any.
   *
   * Held per surface rather than persisted: a pin is a decision about the
   * conversation in front of you, and one silently surviving a reload would be
   * a routing change nobody remembers making.
   */
  private modelOverride: ModelOverride | undefined;
  private pickableModels: PickableModel[] = [];
  /** Whether the provider enumeration has succeeded at least once this session. */
  private providerListLoaded = false;
  private coalescedSyncTimer: ReturnType<typeof setTimeout> | undefined;
  private coalescedSyncDirty = false;
  /**
   * Task ids that currently have a file snapshot.
   *
   * Cached from the last sync so the transcript renderer can decide whether to
   * offer a restore without asking the store per bubble. Stale by at most one
   * render, and the handler re-checks before doing anything.
   */
  private checkpointTaskIds: string[] = [];
  private activeSurface: 'chat' | 'run' = 'chat';
  private composerAttachments: ChatComposerAttachment[] = [];
  private pendingComposerDraft: string | undefined;
  private pendingComposerMode: ComposerSendMode | undefined;
  private pendingDirectResponse: ChatPanelDirectResponse | undefined;
  private pendingComposerContextPatch: Record<string, unknown> | undefined;
  private pendingPromptSubmission: PendingPromptSubmission | undefined;
  private activePromptExecution: ActivePromptExecution | undefined;
  private recoveryNotice: ChatPanelRecoveryNotice | undefined;
  /** In-chat Mission Loop decision the panel is currently awaiting (checkpoint / block recovery). */
  private pendingLoopDecision: LoopDecisionRequest | undefined;
  private pendingGuideChoice: ChatPanelState['pendingGuideChoice'];
  /**
   * What each guide option actually does, held extension-side.
   *
   * The webview only ever sends back an option **id**. Keeping the command here
   * means a webview message cannot name a command to run — the mapping is
   * authored by the extension and looked up, never supplied.
   */
  private guideChoiceActions = new Map<string, { command: string; args?: unknown[] }>();
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
      if (normalizedTarget.sessionId || normalizedTarget.messageId || normalizedTarget.draftPrompt || normalizedTarget.directResponse || normalizedTarget.contextPatch || normalizedTarget.autoSubmit) {
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
    if (normalizedTarget.sessionId || normalizedTarget.messageId || normalizedTarget.draftPrompt || normalizedTarget.directResponse || normalizedTarget.contextPatch || normalizedTarget.autoSubmit) {
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
    this.pendingDirectResponse = initialTarget?.directResponse;
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
      dispose: this.atlas.toolApprovalManager?.onPendingApprovalsChange?.(requests => {
        void this.syncState();
        this.announcePendingApprovals(requests);
      }) ?? (() => undefined),
    });
    this.disposables.push({
      dispose: this.atlas.toolApprovalManager?.onAutopilotChange?.(() => {
        void this.syncState();
      }) ?? (() => undefined),
    });
    // Both of these fire on ordinary editor navigation and change exactly one
    // thing in the payload — the open-file chip list — so they are coalesced
    // rather than each triggering a credential-store enumeration and two disk
    // reads. See `scheduleCoalescedSync`.
    vscode.window.onDidChangeVisibleTextEditors(() => {
      this.scheduleCoalescedSync();
    }, null, this.disposables);
    vscode.window.onDidChangeActiveTextEditor(editor => {
      // Remembered because the chat panel is itself the active editor much of
      // the time: by the moment somebody clicks "Insert at cursor",
      // `activeTextEditor` is often this panel or nothing at all. The last real
      // text editor is the one they mean. Recorded synchronously — it is a
      // source of truth, not rendering, and "Insert at cursor" can be clicked
      // before the coalesced push lands.
      if (editor && editor.document.uri.scheme !== 'output') {
        this.lastActiveTextEditor = editor;
      }
      this.scheduleCoalescedSync();
    }, null, this.disposables);
    if (vscode.window.activeTextEditor) {
      this.lastActiveTextEditor = vscode.window.activeTextEditor;
    }

    void this.syncState();
    void this.refreshProjectName();
    this.checkAiInstructionNudge();
    if (initialTarget?.autoSubmit && initialTarget.draftPrompt) {
      void this.runPrompt(initialTarget.draftPrompt, initialTarget.sendMode ?? 'send');
    }
  }

  public dispose(): void {
    this._isDisposed = true;
    if (this.coalescedSyncTimer) {
      clearTimeout(this.coalescedSyncTimer);
      this.coalescedSyncTimer = undefined;
    }
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
    this.pendingDirectResponse = normalizedTarget.directResponse;
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
      case 'deleteMessage': {
              if (!await this.confirmDestructiveAction('delete-message', message.payload)) {
                await this.host.webview.postMessage({ type: 'status', payload: 'Message not deleted.' });
                return;
              }
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
        if (message.payload?.id === 'buzz-guide') {
          // Look the action up rather than trusting the message to name one.
          const action = this.guideChoiceActions.get(String(message.payload.choice));
          if (action) {
            await vscode.commands.executeCommand(action.command, ...(action.args ?? []));
          }
          return;
        }
        if (message.payload?.id === 'buzz-relay-mode') {
          // Answering the walkthrough's question is a preference, not a gate:
          // it changes which half of the relay instructions is shown and
          // connects nothing.
          const choice = message.payload.choice === 'hosted' ? 'hosted' : 'local';
          this.pendingGuideChoice = undefined;
          await vscode.workspace.getConfiguration('atlasmind')
            .update('buzz.relayMode', choice, vscode.ConfigurationTarget.Workspace)
            .then(undefined, () => undefined);
          await vscode.commands.executeCommand('atlasmind.buzz.openGuide');
          return;
        }
        if (this.pendingLoopDecision && this.pendingLoopDecision.id === message.payload.id) {
          this.settleLoopDecision(message.payload.choice);
          await this.syncState();
        }
        return;
      case 'resolveProjectRunProposal':
        await this.resolveProjectRunProposal(message.payload.entryId, message.payload.decision);
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
      case 'clearConversation': {
        if (!await this.confirmDestructiveAction('clear', this.selectedSessionId)) {
          await this.host.webview.postMessage({ type: 'status', payload: 'Conversation not cleared.' });
          return;
        }
        this.atlas.sessionConversation.clearSession(this.selectedSessionId);
        await this.host.webview.postMessage({ type: 'status', payload: 'Conversation cleared for the selected session.' });
        return;
      }
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
        if (!await this.confirmDestructiveAction('delete-session', message.payload)) {
          await this.host.webview.postMessage({ type: 'status', payload: 'Session not deleted.' });
          return;
        }
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
      case 'openProjectRunCenter':
        // The command already accepts a run id; only the message route was
        // missing, so both "Open Run Center" buttons were silently inert —
        // `isChatPanelMessage` rejected the payload and `handleMessage` dropped
        // it without a sound.
        await vscode.commands.executeCommand('atlasmind.openProjectRunCenter', message.payload);
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
      case 'openFileReference':
        await this.openFileReference(message.payload);
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
      case 'transcribeAudio':
        await this.transcribeComposerAudio(message.payload.dataBase64);
        return;
      case 'restoreCheckpoint':
        await this.restoreCheckpointForTurn(message.payload.entryId);
        return;
      case 'editMessage':
        await this.rewindAndResubmit(message.payload.entryId, message.payload.content);
        return;
      case 'regenerateMessage':
        await this.rewindAndResubmit(message.payload.entryId);
        return;
      case 'renameSession': {
        const renamed = this.atlas.sessionConversation.renameSession(message.payload.sessionId, message.payload.title);
        await this.host.webview.postMessage({
          type: 'status',
          payload: renamed ? 'Renamed.' : 'That name is already in use, or the chat no longer exists.',
        });
        await this.syncState();
        return;
      }
      case 'searchAllSessions':
        await this.replyWithCrossSessionResults(message.payload.query);
        return;
      case 'setModelOverride':
        await this.applyModelOverride(message.payload);
        return;
      case 'queryFileMentions':
        await this.replyWithFileMentions(message.payload.query);
        return;
      case 'attachEditorSelection':
        await this.attachEditorSelection();
        return;
      case 'attachProblems':
        await this.attachProblems();
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
        // Focus moves with the command. The withheld newline is what keeps the
        // human's keystroke the last gate on anything AtlasMind types, and that
        // gate is only real if Enter reaches the terminal rather than the chat
        // composer the caret is still sitting in.
        terminal.show();
        terminal.sendText(message.payload.code, false);
        return;
      }
      case 'insertCodeAtCursor':
        await this.insertCodeAtCursor(message.payload.code);
        return;
      case 'createFileFromCode':
        await this.createFileFromCode(message.payload.code, message.payload.language);
        return;
      case 'applyCodeToFile':
        await this.applyCodeToFile(message.payload.code);
        return;
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

  /**
   * The right-hand side of the "apply this block" diff.
   *
   * A virtual document rather than a temp file: nothing is written to disk to
   * preview a change the operator may decline, and the scheme is read-only by
   * construction, so the preview cannot be edited and mistaken for the real
   * file. One pending preview at a time — the diff opens and is answered in the
   * same gesture.
   */
  /** Caps for the two context attachments read from the editor rather than from disk. */
  /**
   * The commands the composer offers, with descriptions read from the manifest.
   *
   * The names come from `ATLAS_SLASH_COMMANDS`, which is also what the router
   * dispatches on — so the list cannot advertise a command the router would not
   * recognise. Descriptions are a nicety: if the manifest cannot be read the
   * names still complete, which is the part that matters.
   */
  private static slashCommandCatalogue(): Array<{ name: string; description: string }> {
    let described = new Map<string, string>();
    try {
      const contributed = vscode.extensions.getExtension('JoelBondoux.atlasmind')
        ?.packageJSON?.contributes?.chatParticipants?.[0]?.commands as
        Array<{ name?: unknown; description?: unknown }> | undefined;
      described = new Map(
        (contributed ?? [])
          .filter(entry => typeof entry?.name === 'string')
          .map(entry => [String(entry.name), typeof entry.description === 'string' ? entry.description : '']),
      );
    } catch {
      described = new Map();
    }
    return [...ATLAS_SLASH_COMMANDS]
      .sort()
      .map(name => ({ name, description: described.get(name) ?? '' }));
  }

  private static readonly MAX_FILE_MENTIONS = 20;
  private static readonly MAX_CROSS_SESSION_RESULTS = 50;
  private static readonly MAX_SELECTION_CHARS = 60_000;
  private static readonly MAX_PROBLEMS = 100;
  private static readonly MAX_PROBLEMS_CHARS = 20_000;

  private static readonly APPLY_PREVIEW_SCHEME = 'atlasmind-apply';
  private static pendingApplyPreview = '';

  /** Registered once for the process; every chat surface shares the one scheme. */
  public static registerApplyPreviewProvider(): vscode.Disposable {
    return vscode.workspace.registerTextDocumentContentProvider(ChatPanel.APPLY_PREVIEW_SCHEME, {
      provideTextDocumentContent: () => ChatPanel.pendingApplyPreview,
    });
  }

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

  /**
   * The gate in front of the three chat actions that destroy something.
   *
   * Deleting a session, clearing a conversation and deleting a message all fired
   * on the click, with no confirmation and no undo — a transcript holding a
   * day's work was one mis-click from gone, and nothing in this panel could put
   * it back. Every other outward-facing write in this codebase is already
   * modal-gated; these three were simply missed.
   *
   * The dialog names the count, because that is the part the operator cannot see
   * from the button: a session row shows a title, not that it holds forty
   * messages. Where the count cannot be read, it says so rather than reporting
   * zero — the one number that would make a destructive dialog reassuring and
   * wrong.
   */
  private async confirmDestructiveAction(
    kind: 'clear' | 'delete-session' | 'delete-message',
    targetId: string,
  ): Promise<boolean> {
    if (kind === 'delete-message') {
      const entry = this.atlas.sessionConversation
        .getTranscript(this.selectedSessionId)
        .find(item => item.id === targetId);
      const excerpt = typeof entry?.content === 'string'
        ? redactSecrets(entry.content.replace(/\s+/g, ' ').trim()).text.slice(0, 120)
        : '';
      const choice = await vscode.window.showWarningMessage(
        'Delete this message?',
        {
          modal: true,
          detail: excerpt
            ? `This removes it from the transcript permanently.\n\n"${excerpt}${excerpt.length >= 120 ? '…' : ''}"`
            : 'This removes it from the transcript permanently.',
        },
        'Delete message',
      );
      return choice === 'Delete message';
    }

    const session = this.atlas.sessionConversation.getSession(targetId);
    const title = session?.title?.trim() || 'this chat';
    const messageCount = session ? session.entries.length : undefined;
    const held = messageCount === undefined
      ? 'Its message count could not be read.'
      : `It holds ${messageCount} message${messageCount === 1 ? '' : 's'}.`;

    if (kind === 'clear') {
      const choice = await vscode.window.showWarningMessage(
        `Clear the conversation in "${title}"?`,
        { modal: true, detail: `${held} They are removed permanently and cannot be recovered from this panel.` },
        'Clear conversation',
      );
      return choice === 'Clear conversation';
    }

    const choice = await vscode.window.showWarningMessage(
      `Delete the chat session "${title}"?`,
      {
        modal: true,
        detail: `${held} The session and its stored project-memory context are removed permanently.`,
      },
      'Delete session',
    );
    return choice === 'Delete session';
  }

  /** The editor a code-block action should target, or undefined with a reason posted. */
  private async resolveTargetEditor(action: string): Promise<vscode.TextEditor | undefined> {
    const editor = this.lastActiveTextEditor && !this.lastActiveTextEditor.document.isClosed
      ? this.lastActiveTextEditor
      : vscode.window.activeTextEditor;
    if (!editor) {
      await this.host.webview.postMessage({
        type: 'status',
        payload: `Open a file first — ${action} needs somewhere to go.`,
      });
      return undefined;
    }
    return editor;
  }

  private async insertCodeAtCursor(code: string): Promise<void> {
    const editor = await this.resolveTargetEditor('inserting code');
    if (!editor) {
      return;
    }
    // Replaces the selection when there is one, which is what every editor does
    // with a paste; with an empty selection this is an insert at the caret.
    const applied = await editor.edit(builder => builder.replace(editor.selection, code));
    await vscode.window.showTextDocument(editor.document, { viewColumn: editor.viewColumn, preview: false });
    await this.host.webview.postMessage({
      type: 'status',
      payload: applied
        ? `Inserted into ${vscode.workspace.asRelativePath(editor.document.uri, false)}.`
        : 'Could not insert into that editor.',
    });
  }

  private async createFileFromCode(code: string, language?: string): Promise<void> {
    // Untitled, not written to disk: naming and placing a file is a decision
    // AtlasMind should not make, and an unsaved buffer costs nothing to discard.
    // That is also why this one needs no confirmation — it destroys nothing.
    const document = await vscode.workspace.openTextDocument({
      content: code,
      ...(language ? { language } : {}),
    });
    await vscode.window.showTextDocument(document, { preview: false });
    await this.host.webview.postMessage({
      type: 'status',
      payload: 'Opened the block as a new unsaved file. Save it where you want it.',
    });
  }

  /**
   * Replace the selection — or the whole file — with the block, after showing
   * exactly what would change.
   *
   * Deliberately not a "smart apply": there is no model in this path and no
   * fuzzy merge of a fragment into surrounding code. It replaces precisely what
   * the diff showed, which is the version whose behaviour can be predicted from
   * looking at it. The edit goes through `editor.edit` rather than a filesystem
   * write so it lands on the undo stack like anything the user typed.
   */
  private async applyCodeToFile(code: string): Promise<void> {
    const editor = await this.resolveTargetEditor('applying code');
    if (!editor) {
      return;
    }

    const document = editor.document;
    const hasSelection = !editor.selection.isEmpty;
    const target = hasSelection
      ? editor.selection
      : new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
    const relativePath = vscode.workspace.asRelativePath(document.uri, false);
    const scope = hasSelection
      ? `lines ${target.start.line + 1}–${target.end.line + 1}`
      : 'the whole file';

    const proposed = document.getText().slice(0, document.offsetAt(target.start))
      + code
      + document.getText().slice(document.offsetAt(target.end));
    if (proposed === document.getText()) {
      await this.host.webview.postMessage({ type: 'status', payload: 'That block already matches the file.' });
      return;
    }

    ChatPanel.pendingApplyPreview = proposed;
    const previewUri = vscode.Uri.parse(`${ChatPanel.APPLY_PREVIEW_SCHEME}:${relativePath}`);
    await vscode.commands.executeCommand(
      'vscode.diff',
      document.uri,
      previewUri,
      `${relativePath} ↔ proposed (${scope})`,
      { preview: true },
    );

    const choice = await vscode.window.showWarningMessage(
      `Apply this code block to ${relativePath}?`,
      {
        modal: true,
        detail: `Replaces ${scope}. The diff beside this dialog is exactly what will change, and the edit is undoable.`,
      },
      'Apply',
    );
    if (choice !== 'Apply') {
      await this.host.webview.postMessage({ type: 'status', payload: 'Not applied.' });
      return;
    }

    const applied = await editor.edit(builder => builder.replace(target, code));
    await this.host.webview.postMessage({
      type: 'status',
      payload: applied ? `Applied to ${relativePath}. Undo reverts it.` : 'Could not apply to that editor.',
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

  /**
   * Open a file a reply linked to.
   *
   * The reference is text a model wrote, so it is treated as untrusted at both
   * ends: the anchor is stripped before resolution (a line number is not part of
   * the path), and containment is `resolveWorkspaceRelativeFile`'s decision, not
   * this method's. A path outside the workspace is *reported* rather than opened
   * — silently doing nothing would be indistinguishable from the dead links this
   * replaced, which is the failure worth not rebuilding.
   */
  private async openFileReference(reference: string): Promise<void> {
    const parsed = parseFileReference(reference);
    if (!parsed) {
      await this.host.webview.postMessage({ type: 'status', payload: 'That link does not name a file path.' });
      return;
    }

    const fileUri = resolveWorkspaceRelativeFile(parsed.path);
    if (!fileUri) {
      await this.host.webview.postMessage({
        type: 'status',
        payload: `${parsed.path} is outside this workspace, so it was not opened.`,
      });
      return;
    }

    try {
      const document = await vscode.workspace.openTextDocument(fileUri);
      const selection = parsed.line === undefined
        ? undefined
        // The model counts lines from 1; the editor counts from 0.
        : new vscode.Range(Math.max(0, parsed.line - 1), 0, Math.max(0, parsed.line - 1), 0);
      await vscode.window.showTextDocument(document, { preview: false, selection });
    } catch {
      await this.host.webview.postMessage({
        type: 'status',
        payload: `${parsed.path} could not be opened — it may have been moved or deleted.`,
      });
    }
  }

  private async runPrompt(rawPrompt: string, mode: ComposerSendMode): Promise<void> {
    if (this._isDisposed) return;
    if (this.activePromptExecution) {
      if (this.pendingDirectResponse && mode !== 'steer') {
        // A host-authored answer is tied to the target's prompt. Queue the pair
        // together until the active request releases this panel rather than
        // rejecting it and leaving the answer armed for whatever the operator
        // happens to type next.
        this.pendingPromptSubmission = { prompt: rawPrompt.trim(), mode };
        await this.host.webview.postMessage({
          type: 'status',
          payload: 'The policy explanation is queued and will open when the current chat request finishes.',
        });
        return;
      }
      if (mode === 'steer') {
        const steerPrompt = rawPrompt.trim();
        if (!steerPrompt) {
          await this.host.webview.postMessage({ type: 'status', payload: 'Type what to change before steering.' });
          return;
        }
        this.pendingPromptSubmission = { prompt: steerPrompt, mode };
        await this.stopActivePrompt('Steering the current chat request. AtlasMind will apply your steer prompt next.');
        return;
      }
      await this.host.webview.postMessage({ type: 'status', payload: 'Still working on your last message. Stop it first, or use Steer to redirect it.' });
      return;
    }

    const prompt = rawPrompt.trim();
    if (!prompt) {
      await this.host.webview.postMessage({ type: 'status', payload: 'Type something to send.' });
      return;
    }

    if (this.activeSurface !== 'chat') {
      await this.host.webview.postMessage({ type: 'status', payload: 'Select a chat session before sending a prompt.' });
      return;
    }

    // A slash command is answered by AtlasMind, never by a model.
    //
    // Until this existed the panel had no slash dispatch at all, so every
    // declared command reached the orchestrator as prose — and on a machine with
    // no provider configured, `/acp` was answered by the built-in echo adapter
    // with "Answered from context." The command was declared, documented,
    // autocompleted, and inert. Worse, a *setup* question asked because nothing
    // is set up yet was handed to an agent holding every connected tool.
    //
    // Steering is exempt: mid-run, the composer's text redirects the request in
    // flight rather than starting anything, and a `/`-prefixed steer is prose.
    //
    // The two long-running commands *rewrite this request* rather than starting a
    // second one — recursing into `runPrompt` would re-enter this very block.
    //
    // `routePanelPrompt` is synchronous and imported statically, so an ordinary
    // prose prompt pays **nothing** here — not even a microtask. That matters
    // more than it looks: an `await` in front of this block delays the busy
    // indicator for every message, and a test counting microtasks caught it
    // immediately when the first version awaited two dynamic imports before
    // deciding the prompt was prose after all.
    let effectivePrompt = prompt;
    let effectiveMode = mode;
    let forcedProjectGoal: string | undefined;
    const route = mode === 'steer' ? { kind: 'prose' as const } : routePanelPrompt(prompt);
    if (route.kind !== 'prose') {
      const decision = await this.runSlashCommand(route);
      if (decision.kind === 'handled') {
        return;
      }
      if (decision.kind === 'loop') {
        effectiveMode = 'new-loop';
        effectivePrompt = decision.goal;
      } else if (decision.kind === 'project') {
        // The goal is forced, but **not** pre-approved: `/project` is a request
        // to plan, and the file-count proposal gate still applies. Wrapping it
        // in the approval token would have removed a safety gate in passing.
        forcedProjectGoal = decision.goal;
      }
    }

    // The declared workflow, said out loud at the moment it applies.
    //
    // Nothing in the chat path had ever read the workflow: it lived on a
    // dashboard page and in *other* tools' instruction files, so asking Atlas to
    // "commit and push this" got no workflow awareness at all. A novice's
    // failure mode is not breaking a rule, it is not knowing one existed — so at
    // the default level this follows the enabled route in the same turn. `gate`
    // stops instead, and is opt-in because a prompt on every commit becomes one
    // people learn to click through.
    //
    // Steering is exempt for the same reason it is exempt from slash routing:
    // mid-run text redirects a request already in flight.
    //
    // `detectGovernedAction` is synchronous and statically imported, and it gates
    // everything else here. That ordering is the point: the first version awaited
    // two dynamic imports and a git call in front of **every** prompt, which
    // delayed the busy indicator on every message — the identical mistake the
    // slash router made, caught by the identical microtask-counting test. An
    // ordinary prompt now pays one regex pass and no microtask.
    let workflowExecutionPolicy: import('../core/workflowChatGuard.js').WorkflowChatExecutionPolicy | undefined;
    if (mode !== 'steer' && detectGovernedAction(prompt)) {
      const workflowDecision = await this.announceWorkflowExpectation(prompt);
      if (workflowDecision.stop) {
        return;
      }
      workflowExecutionPolicy = workflowDecision.executionPolicy;
    }

    const configuration = vscode.workspace.getConfiguration('atlasmind');
    // If another panel is actively executing on this same session, spawn a separate session
    // so their transcripts stay isolated and neither sees the other's streaming responses.
    const sessionConflict = effectiveMode === 'send' && ChatPanel.collectActiveExecutions()
      .some(exec => exec.sessionId === this.selectedSessionId);
    // "New Loop" also starts in its own fresh session (like "New Session") so the
    // autonomous run's transcript stays isolated from the current conversation.
    // `/loop` reaches here as `new-loop`, so it gets that isolation too.
    const activeSessionId = (effectiveMode === 'new-session' || effectiveMode === 'new-loop' || sessionConflict)
      ? this.atlas.sessionConversation.spawnSession()
      : this.selectedSessionId;
    if (effectiveMode === 'new-chat') {
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
      effectivePrompt,
      submittedAttachments,
      effectiveMode,
      sessionContext,
      activeSessionId,
      sessionContextBundle ?? undefined,
      forcedProjectGoal,
      workflowExecutionPolicy,
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
    await this.host.webview.postMessage({ type: 'status', payload: 'Working on it…' });

    let streamedText = '';
    const streamingThoughtLines: string[] = [];
    this.streamingModels = [];
    const renderPendingAssistant = async (): Promise<void> => {
      // The transcript entry is updated on every chunk — that is the source of
      // truth and must not be rate-limited. Only the push to the webview is
      // coalesced; see `scheduleCoalescedSync`.
      this.atlas.sessionConversation.updateMessage(assistantMessageId, streamedText, activeSessionId);
      this.streamingThought = streamingThoughtLines.length > 0 ? streamingThoughtLines.join('\n') : undefined;
      this.scheduleCoalescedSync();
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
        const directResponse = preparedRequest.directResponse;
        this.atlas.sessionConversation.updateMessage(
          assistantMessageId,
          directResponse.markdown,
          activeSessionId,
          {
            modelUsed: directResponse.modelUsed,
            thoughtSummary: directResponse.thoughtSummary ?? {
              label: 'Action summary',
              summary: 'Returned a live roadmap status summary from the current SSOT files.',
              bullets: ['Used roadmap files on disk instead of snippet-based memory retrieval.'],
            },
            ...(directResponse.followupQuestion
              ? { followupQuestion: directResponse.followupQuestion }
              : {}),
            ...(directResponse.quickReplies
              ? { quickReplies: directResponse.quickReplies }
              : {}),
            ...(directResponse.composerPrefills
              ? { composerPrefills: directResponse.composerPrefills }
              : {}),
          },
        );
        await this.syncState();
        await this.host.webview.postMessage({
          type: 'status',
          payload: directResponse.statusMessage ?? 'AtlasMind explanation ready.',
        });
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

      // Taken once for the turn, before the branch: the terminal path and the
      // ordinary path are alternatives, and a turn-scoped pin must be consumed
      // exactly once whichever one runs.
      const preferredModel = this.takeModelOverrideForTurn();

      if (preparedRequest.terminalDirective) {
        await this.runManagedTerminalPrompt(
          preparedRequest,
          assistantMessageId,
          activeSessionId,
          taskId,
          sessionContext,
          preferredModel,
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
          ...(preferredModel ? { preferredModel } : {}),
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
      const completedModels = result.modelAttempts && result.modelAttempts.length > 1
        ? [...new Set(result.modelAttempts.map(attempt => attempt.model))]
        : undefined;
      this.streamingModels = [];
      const assistantMeta = {
        // Recorded so the transcript can point at this turn's file snapshot
        // later. Without it a checkpoint exists but nothing on screen knows
        // which turn produced it.
        taskId,
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
      const proposedRun = resolveProjectRunProposal(
        visibleTranscriptText,
        this.atlas.sessionConversation.getTranscript(activeSessionId),
      );
      const autopilotEnabled = this.atlas.toolApprovalManager?.isAutopilot?.() ?? false;
      const autoStartProposedRuns = configuration.get<boolean>('autoStartProposedProjectRuns', true);
      if (proposedRun && (!autopilotEnabled || !autoStartProposedRuns)) {
        // The question and its pills are KEPT alongside the decision card.
        //
        // They used to be deleted here, leaving the card as the only affordance —
        // and the question detector is silent on any offer naming a file, so a
        // turn ending "Want me to update README.md?" could surface neither. The
        // card is a control, the question is what was asked; dropping the second
        // is how a turn came to be waiting with nothing on screen saying so.
        // Double-triggering is not a risk here: the card resolves once, host-side.
        this.atlas.sessionConversation.updateMessage(
          assistantMessageId,
          visibleTranscriptText,
          activeSessionId,
          {
            ...assistantMeta,
            projectRunProposal: { goal: proposedRun.goal, status: 'pending' },
          },
        );
      }
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

      // If the reply offered an autonomous project run, flow straight into it instead
      // of stopping for the operator to type "Proceed" — they already asked for the
      // job. Immediate under Autopilot; otherwise after a cancellable notice. The run
      // uses a bare goal (not pre-approved) so runProjectCommand's file-count safety
      // gate still applies to unusually large runs.
      const autoFlow = resolveProjectRunAutoFlow(
        visibleTranscriptText,
        this.atlas.sessionConversation.getTranscript(activeSessionId),
        {
          enabled: autoStartProposedRuns,
          autopilot: autopilotEnabled,
        },
      );
      if (autoFlow && !abortController.signal.aborted) {
        // Drop the now-redundant Yes/No pills so the operator can't double-trigger the run.
        this.atlas.sessionConversation.updateMessage(
          assistantMessageId,
          visibleTranscriptText,
          activeSessionId,
          { ...assistantMeta, followupQuestion: undefined, quickReplies: undefined, suggestedFollowups: undefined },
        );
        await this.appendAssistantMessage(assistantMessageId, activeSessionId, `\n\n---\n\n${autoFlow.notice}`);
        await this.runProjectPrompt(
          autoFlow.goal,
          assistantMessageId,
          activeSessionId,
          [],
          cancellationSource.token,
          sessionContextBundle ?? undefined,
          sessionContext || undefined,
        );
        await this.host.webview.postMessage({ type: 'status', payload: 'Autonomous project run completed.' });
      }
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
      // The turn is over on every path through here — completed, failed or
      // stopped — and the sync below is unconditional, so a coalesced tick still
      // in flight has nothing left to contribute. Cancelling it keeps the final
      // state the last thing written rather than a race with it.
      if (this.coalescedSyncTimer) {
        clearTimeout(this.coalescedSyncTimer);
        this.coalescedSyncTimer = undefined;
      }
      this.coalescedSyncDirty = false;
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

  private async stopActivePrompt(statusMessage = 'Stopped.'): Promise<void> {
    const targetExecution = this.activePromptExecution
      ?? ChatPanel.findBusyExecution(this.selectedSessionId)
      ?? ChatPanel.findBusyExecution();

    if (!targetExecution) {
      await this.host.webview.postMessage({ type: 'status', payload: 'Nothing is running.' });
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
      await this.host.webview.postMessage({ type: 'status', payload: 'Still working on your last message.' });
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
    if (!Number.isFinite(value)) {
      return;
    }
    const safeValue = Math.max(1, Math.min(50, Math.round(value)));
    const entry = this.atlas.sessionConversation
      .getTranscript(this.selectedSessionId)
      .find(candidate => candidate.id === entryId);
    if (!entry?.meta?.iterationLimitHit || entry.meta.suggestedIterationLimit !== safeValue) {
      await this.host.webview.postMessage({ type: 'status', payload: 'That iteration-limit choice is no longer valid.' });
      return;
    }
    if (permanent) {
      this.atlas.orchestrator.updateConfig({ maxToolIterations: safeValue });
      await vscode.workspace.getConfiguration('atlasmind').update('maxToolIterations', safeValue, vscode.ConfigurationTarget.Workspace);
      await this.continueFromIterationLimit(entryId);
      return;
    }

    const previousValue = this.atlas.orchestrator.getExecutionLimits().maxToolIterations;
    this.atlas.orchestrator.updateConfig({ maxToolIterations: safeValue });
    try {
      await this.continueFromIterationLimit(entryId);
    } finally {
      this.atlas.orchestrator.updateConfig({ maxToolIterations: previousValue });
    }
  }

  private async raiseToolCallsPerTurnLimit(entryId: string, value: number, permanent: boolean): Promise<void> {
    if (!Number.isFinite(value)) {
      return;
    }
    const safeValue = Math.max(1, Math.min(30, Math.round(value)));
    const entry = this.atlas.sessionConversation
      .getTranscript(this.selectedSessionId)
      .find(candidate => candidate.id === entryId);
    if (!entry?.meta?.iterationLimitHit || entry.meta.suggestedToolCallsPerTurnLimit !== safeValue) {
      await this.host.webview.postMessage({ type: 'status', payload: 'That tool-call-limit choice is no longer valid.' });
      return;
    }
    if (permanent) {
      this.atlas.orchestrator.updateConfig({ maxToolCallsPerTurn: safeValue });
      await vscode.workspace.getConfiguration('atlasmind').update('maxToolCallsPerTurn', safeValue, vscode.ConfigurationTarget.Workspace);
      await this.continueFromIterationLimit(entryId);
      return;
    }

    const previousValue = this.atlas.orchestrator.getExecutionLimits().maxToolCallsPerTurn;
    this.atlas.orchestrator.updateConfig({ maxToolCallsPerTurn: safeValue });
    try {
      await this.continueFromIterationLimit(entryId);
    } finally {
      this.atlas.orchestrator.updateConfig({ maxToolCallsPerTurn: previousValue });
    }
  }

  private async runManagedTerminalPrompt(
    preparedRequest: PreparedPromptRequest,
    assistantMessageId: string,
    activeSessionId: string,
    taskId: string,
    sessionContext: string,
    preferredModel?: string,
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
        ...(preferredModel ? { preferredModel } : {}),
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
      button: async (button: { command?: string; title: string }) => {
        // The project outcome below promotes execution-cap recovery into real
        // in-chat chips. Do not flatten the native Settings button into inert
        // transcript text in the custom panel.
        if (button.command === 'workbench.action.openSettings' && /tool iterations?/i.test(button.title)) {
          return;
        }
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

    const outcome = await runProjectCommand(
      // Always the bare goal: nothing reaching here has been shown a plan or a
      // file estimate yet, so nothing here has been reviewed.
      //
      // "Explicit project requests are pre-approved (the operator typed the run)"
      // was the reasoning, and it had the gate backwards — typing a request is
      // the moment of *least* review, not most. It also contradicted the `/project`
      // path a few hundred lines up, which says in as many words that wrapping a
      // goal in the approval token "would have removed a safety gate in passing".
      // The gate now renders the plan and offers approval as one click instead.
      projectGoal,
      sink,
      token,
      this.atlas,
      undefined,
      sessionContextBundle,
      sessionContext,
      false,
    );

    // Stopped at the file-count gate: offer the approving prompt as one click.
    //
    // The panel's only route past this gate used to be retyping the goal with the
    // `--approve` token, which is not something an operator can be expected to
    // know — and the natural retry re-entered unapproved and stopped in the same
    // place. Rendering it as a quick reply reuses the pill the panel already has.
    if (outcome.approvalRequiredPrompt) {
      const entry = this.atlas.sessionConversation
        .getTranscript(activeSessionId)
        .find(candidate => candidate.id === assistantMessageId && candidate.role === 'assistant');
      if (entry) {
        this.atlas.sessionConversation.updateMessage(
          assistantMessageId,
          entry.content,
          activeSessionId,
          {
            ...entry.meta,
            followupQuestion: 'This run exceeds the safety threshold. Approve it?',
            quickReplies: [
              {
                label: 'Approve and run',
                prompt: outcome.approvalRequiredPrompt,
                description: 'Start the run despite the estimated file count.',
              },
            ],
          },
        );
        await this.syncState();
      }
    }

    if (outcome.iterationLimitHit) {
      const entry = this.atlas.sessionConversation
        .getTranscript(activeSessionId)
        .find(candidate => candidate.id === assistantMessageId && candidate.role === 'assistant');
      if (entry) {
        this.atlas.sessionConversation.updateMessage(
          assistantMessageId,
          entry.content,
          activeSessionId,
          {
            ...entry.meta,
            iterationLimitHit: true,
            ...(typeof outcome.suggestedIterationLimit === 'number'
              ? { suggestedIterationLimit: outcome.suggestedIterationLimit }
              : {}),
            ...(typeof outcome.suggestedToolCallsPerTurnLimit === 'number'
              ? { suggestedToolCallsPerTurnLimit: outcome.suggestedToolCallsPerTurnLimit }
              : {}),
          },
        );
        await this.syncState();
      }
    }
  }

  private async resolveProjectRunProposal(
    entryId: string,
    decision: 'start' | 'save' | 'cancel',
  ): Promise<void> {
    const entry = this.atlas.sessionConversation
      .getTranscript(this.selectedSessionId)
      .find(candidate => candidate.id === entryId && candidate.role === 'assistant');
    const proposal = entry?.meta?.projectRunProposal;
    if (!entry || !proposal || proposal.status !== 'pending') {
      await this.host.webview.postMessage({ type: 'status', payload: 'That proposed run is no longer waiting for a decision.' });
      return;
    }

    const status = decision === 'start' ? 'started' : decision === 'save' ? 'saved' : 'cancelled';
    this.atlas.sessionConversation.updateMessage(
      entry.id,
      entry.content,
      this.selectedSessionId,
      {
        ...entry.meta,
        projectRunProposal: { ...proposal, status },
      },
    );
    await this.syncState();

    if (decision === 'cancel') {
      await this.host.webview.postMessage({ type: 'status', payload: 'Proposed project run cancelled.' });
      return;
    }

    if (decision === 'save') {
      await vscode.commands.executeCommand('atlasmind.openProjectRunCenter', {
        goal: proposal.goal,
        autoPreview: true,
      });
      await this.host.webview.postMessage({ type: 'status', payload: 'Run saved in Project Run Center for later.' });
      return;
    }

    await this.runPrompt('Proceed', 'send');
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

  /**
   * Show the walkthrough's chips — its question, and the actions for this step.
   *
   * The guide's prose says "press the button below", which was true in VS Code
   * chat (where `stream.button` renders) and a lie in this panel, which had no
   * buttons at all. Now it has them.
   */
  public async setGuideChoice(
    choice: ChatPanelState['pendingGuideChoice'],
    actions?: Map<string, { command: string; args?: unknown[] }>,
  ): Promise<void> {
    this.pendingGuideChoice = choice;
    this.guideChoiceActions = actions ?? new Map();
    await this.syncState();
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

  /**
   * Bring a waiting approval to the user's attention.
   *
   * A tool approval blocks the run until answered, and the bar lives in this
   * panel — which you may not be looking at. Repainting a hidden webview
   * announces nothing, so the run appears to hang. Kept deliberately quiet when
   * the panel is already on screen: interrupting someone toward something they
   * are already looking at is how prompts get trained into reflex dismissal.
   */
  private announcePendingApprovals(requests: readonly PendingToolApprovalRequest[]): void {
    if (this._isDisposed) {
      return;
    }
    const attention = decideApprovalAttention({
      previousIds: this.announcedApprovalIds,
      pending: requests,
      // Unknowable on the remote host, where `visible` is absent. Treated as
      // hidden, because a missed approval costs more than a redundant nudge.
      surfaceVisible: this.host.visible === true,
      revealEnabled: vscode.workspace.getConfiguration('atlasmind')
        .get<boolean>('chat.revealOnApprovalRequest', true),
    });
    if (!attention) {
      return;
    }
    this.announcedApprovalIds = attention.announcedIds;

    if (attention.reveal) {
      this.revealSurface();
    }
    if (attention.notify) {
      void vscode.window
        .showWarningMessage(`AtlasMind is waiting for your approval: ${attention.summary}`, 'Review')
        .then(choice => {
          if (choice === 'Review') {
            this.revealSurface();
          }
        });
    }
  }

  /** Bring this surface forward, whichever kind of host it is. */
  private revealSurface(): void {
    try {
      this.host.reveal?.(undefined, false);
      this.host.show?.(false);
    } catch {
      // A host that cannot be revealed still got the notification.
    }
  }

  /**
   * Push state at most once per frame-ish interval, for events that arrive in
   * bursts and cannot have changed which providers are configured.
   *
   * A full `syncState()` is not a cheap thing to run repeatedly: it enumerates
   * every provider (which reaches credential storage, and for ACP performs two
   * dynamic imports), reads the checkpoint store and the run history off disk,
   * rebuilds the context meter over the whole transcript, and then posts the
   * entire transcript across the webview boundary. Two callers used to run all
   * of that far more often than anything they changed warranted:
   *
   * - **Every streamed chunk.** The cost of a turn therefore scaled with how
   *   *long* the reply was and how much was already in the session, which is
   *   exactly why short, simple turns still felt slow — the work was never
   *   proportional to the question.
   * - **Every editor change.** `onDidChangeVisibleTextEditors` and
   *   `onDidChangeActiveTextEditor` fire on ordinary navigation, so clicking
   *   between files re-read the credential store and the disk each time, while
   *   the only thing that had actually changed was the open-file chip list.
   *
   * Coalescing rate-limits the *push* and nothing else — a streamed chunk still
   * updates its transcript entry synchronously, and `lastActiveTextEditor` is
   * still recorded the moment it changes, because both are sources of truth
   * rather than rendering.
   *
   * The trailing edge matters more than the leading one: dropping an
   * intermediate frame is invisible, dropping the last one would leave the reply
   * truncated on screen. So a dirty flag always survives to the next tick, and
   * `runPrompt` cancels any pending tick and syncs unconditionally when the turn
   * ends, on completion, failure and stop alike.
   */
  private scheduleCoalescedSync(): void {
    if (this._isDisposed) return;
    this.coalescedSyncDirty = true;
    if (this.coalescedSyncTimer) return;
    this.coalescedSyncTimer = setTimeout(() => {
      this.coalescedSyncTimer = undefined;
      if (!this.coalescedSyncDirty || this._isDisposed) return;
      this.coalescedSyncDirty = false;
      void this.syncState({ reuseProviderList: true });
    }, COALESCED_SYNC_INTERVAL_MS);
  }

  private async syncState(options?: { reuseProviderList?: boolean }): Promise<void> {
    if (this._isDisposed) return;
    // Enumerating providers touches credential storage, and which providers are
    // configured is a property of settings — a streamed chunk cannot change it.
    // So a streaming sync reuses what the last full sync found, and every other
    // sync re-reads. That is the whole staleness window: one reply.
    if (!options?.reuseProviderList || !this.providerListLoaded) {
      await this.refreshPickableModels();
    }
    try {
      this.checkpointTaskIds = (await this.atlas.listCheckpoints?.() ?? []).map(item => item.taskId);
    } catch {
      // A store that cannot be read offers nothing, rather than offering a
      // restore that would fail when clicked.
      this.checkpointTaskIds = [];
    }
    const meterConfiguration = vscode.workspace.getConfiguration('atlasmind');
    const contextMeter = this.buildContextMeter(
      meterConfiguration.get<number>('chatSessionContextChars', 2500),
      meterConfiguration.get<number>('chatSessionTurnLimit', 6),
    );
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
      slashCommands: ChatPanel.slashCommandCatalogue(),
      availableModels: this.pickableModels,
      ...(contextMeter ? { contextMeter } : {}),
      ...(this.checkpointTaskIds.length > 0 ? { checkpointTaskIds: this.checkpointTaskIds } : {}),
      ...(this.modelOverride ? { modelOverride: this.modelOverride } : {}),
      sessions,
      transcript: transcriptPayload,
      pendingToolApprovals: this.atlas.toolApprovalManager?.listPendingRequests?.() ?? [],
      ...(this.pendingLoopDecision ? { pendingLoopDecision: this.pendingLoopDecision } : {}),
      ...(this.pendingGuideChoice ? { pendingGuideChoice: this.pendingGuideChoice } : {}),
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

  /**
   * Decide what a submitted prompt starting with `/` means.
   *
   * `handled` means AtlasMind has already answered and the caller must stop
   * before reaching a model — the whole point of this path. `project` and `loop`
   * hand a goal back for the caller to run on the panel's own long-running
   * paths, which already own run proposals, loop checkpoints and the run-center
   * wiring. `prose` means it was never a command.
   *
   * The deterministic commands run the **participant's own handlers** through
   * {@link ChatStreamCollector}, so the panel and `@atlas` cannot answer
   * `/agents` differently. The alternative was nineteen near-copies kept correct
   * by hand.
   */
  private async runSlashCommand(route: Exclude<PanelSlashRoute, { kind: 'prose' }>): Promise<
    | { kind: 'handled' }
    | { kind: 'project'; goal: string }
    | { kind: 'loop'; goal: string }
  > {
    if (route.kind === 'loop') {
      return { kind: 'loop', goal: route.goal };
    }
    if (route.kind === 'project') {
      return { kind: 'project', goal: route.goal };
    }

    if (route.kind === 'unknown' || route.kind === 'needs-argument') {
      // Recorded in the transcript rather than flashed as a status line: the user
      // typed something and is owed a reply where replies appear.
      await this.postAssistantNotice(route.raw, route.message);
      return { kind: 'handled' };
    }

    // Imported only now: a replay is the one branch that needs it, and putting
    // this import in front of every prompt is what delayed the busy indicator.
    const { ChatStreamCollector, renderCollectedResponse } = await import('./chatStreamCollector.js');

    const sessionId = this.selectedSessionId;
    this.atlas.sessionConversation.appendMessage('user', route.raw, sessionId);
    const assistantMessageId = this.atlas.sessionConversation.appendMessage(
      'assistant',
      `Running \`/${route.command}\`…`,
      sessionId,
    );
    await this.syncState();

    const collector = new ChatStreamCollector();
    const cancellation = new vscode.CancellationTokenSource();
    try {
      const { runDeterministicSlashCommand } = await import('../chat/participant.js');
      const handled = await runDeterministicSlashCommand(
        route.command,
        route.argument,
        collector.asStream(),
        cancellation.token,
        this.atlas,
        sessionId,
      );
      if (!handled) {
        // The router classified it and the dispatch disowned it. That is a
        // disagreement between two lists, so it is reported as our bug rather
        // than dressed up as the command doing nothing.
        this.atlas.sessionConversation.updateMessage(
          assistantMessageId,
          `\`/${route.command}\` is recognised but has no handler. This is an AtlasMind bug — please report it.`,
          sessionId,
        );
        await this.syncState();
        return { kind: 'handled' };
      }

      const collected = collector.collect();
      this.atlas.sessionConversation.updateMessage(
        assistantMessageId,
        renderCollectedResponse(collected),
        sessionId,
      );
      await this.syncState();

      // Buttons become the panel's chips. Only ids cross to the webview; the
      // commands they map to stay here, exactly as the Buzz guide does it.
      if (collected.buttons.length > 0) {
        const actions = new Map<string, { command: string; args?: unknown[] }>();
        for (const button of collected.buttons) {
          actions.set(button.id, { command: button.command, ...(button.args.length > 0 ? { args: button.args } : {}) });
        }
        await this.setGuideChoice(
          {
            id: 'buzz-guide',
            title: `\`/${route.command}\``,
            options: collected.buttons.map(button => ({ id: button.id, label: button.title })),
          },
          actions,
        );
      }
      return { kind: 'handled' };
    } catch (error) {
      this.atlas.sessionConversation.updateMessage(
        assistantMessageId,
        `\`/${route.command}\` did not complete: ${error instanceof Error ? error.message : String(error)}`,
        sessionId,
      );
      await this.syncState();
      return { kind: 'handled' };
    } finally {
      cancellation.dispose();
    }
  }

  /**
   * Say what the declared workflow expects, before doing what was asked.
   *
   * Returns `stop: true` only at `gate`. `follow` stays off the durable
   * transcript: a short status line shows that the policy was applied, and the
   * validated execution policy travels to the Orchestrator as trusted host
   * context for this turn. `inform` remains a visible, non-blocking note.
   *
   * Reads its own settings rather than taking them as arguments: this is the
   * `vscode`-aware half, and `workflowChatGuard.ts` is the pure half that decides
   * what to say.
   */
  private async announceWorkflowExpectation(prompt: string): Promise<{
    stop: boolean;
    executionPolicy?: import('../core/workflowChatGuard.js').WorkflowChatExecutionPolicy;
  }> {
    let notice: import('../core/workflowChatGuard.js').WorkflowChatNotice | undefined;
    try {
      const [{ buildWorkflowChatNotice, parseWorkflowChatGuidanceMode }, { readWorkflowConfig }] = await Promise.all([
        import('../core/workflowChatGuard.js'),
        import('../core/workflowConfig.js'),
      ]);
      const settings = vscode.workspace.getConfiguration('atlasmind');
      const mode = parseWorkflowChatGuidanceMode(settings.get<string>('workflow.chatGuidance', 'follow'));
      if (mode === 'off') {
        return { stop: false };
      }
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        return { stop: false };
      }
      const branch = await readCurrentBranch(workspaceRoot);
      notice = buildWorkflowChatNotice({
        prompt,
        mode,
        config: readWorkflowConfig(workspaceRoot),
        ...(branch ? { currentBranch: branch } : {}),
      });
    } catch {
      // Advisory by nature. A guard that took a turn down would be worse than
      // the silence it was meant to replace.
      return { stop: false };
    }

    if (!notice) {
      return { stop: false };
    }

    const sessionId = this.selectedSessionId;
    if (notice.blocking) {
      // A gate records the request too, so the transcript shows what was asked
      // and what stopped it rather than only the refusal.
      this.atlas.sessionConversation.appendMessage('user', prompt, sessionId);
      this.atlas.sessionConversation.appendMessage('assistant', notice.markdown, sessionId);
      await this.syncState();
      return { stop: true };
    }

    if (notice.executionPolicy) {
      await this.host.webview.postMessage({
        type: 'status',
        payload: `Following the declared ${notice.stageId} workflow for this request.`,
      });
      return { stop: false, executionPolicy: notice.executionPolicy };
    }

    this.atlas.sessionConversation.appendMessage('assistant', notice.markdown, sessionId);
    await this.syncState();
    return { stop: false };
  }

  /** Put a short AtlasMind-authored reply in the transcript, with no model involved. */
  private async postAssistantNotice(userPrompt: string, notice: string): Promise<void> {
    const sessionId = this.selectedSessionId;
    this.atlas.sessionConversation.appendMessage('user', userPrompt, sessionId);
    this.atlas.sessionConversation.appendMessage('assistant', notice, sessionId);
    await this.syncState();
  }

  private async preparePromptRequest(
    prompt: string,
    attachments: ChatComposerAttachment[],
    mode: ComposerSendMode,
    sessionContext: string,
    activeSessionId: string,
    sessionContextBundle?: import('../types.js').SessionContextBundle,
    /**
     * A project goal named outright by `/project <goal>`, bypassing the prose
     * intent router but **not** the approval gate.
     *
     * Needed because project detection is otherwise inferred from the wording of
     * a prose prompt, and a goal typed after `/project` will often not match
     * those patterns — so the command would silently become an ordinary chat
     * turn. Forcing the goal is the fix; pre-approving it would have been a
     * different change wearing the same clothes, since the file-count proposal
     * gate is the only thing standing between `/project` and an unattended run.
     */
    forcedProjectGoal?: string,
    /** Validated host policy for a governed chat action; never user-authored text. */
    workflowExecutionPolicy?: import('../core/workflowChatGuard.js').WorkflowChatExecutionPolicy,
  ): Promise<PreparedPromptRequest> {
    const hostAuthoredResponse = this.pendingDirectResponse;
    if (hostAuthoredResponse) {
      // One target authorises one answer. Clear it before any await so a queued
      // or re-entrant submission cannot reuse the response for a different
      // user message. Context patches exist for routed work and must not leak
      // past a model-free turn.
      this.pendingDirectResponse = undefined;
      this.pendingComposerContextPatch = undefined;
      return {
        userMessage: prompt,
        directResponse: hostAuthoredResponse,
        context: {},
        imageAttachments: [],
      };
    }

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
    const projectGoal = forcedProjectGoal ?? (routedIntent?.kind === 'project' ? routedIntent.goal : undefined);
    const commandIntent = routedIntent?.kind === 'command'
      ? {
          commandId: routedIntent.commandId,
          ...(routedIntent.args ? { args: routedIntent.args } : {}),
          summary: routedIntent.summary,
        }
      : undefined;
    // Answered from the transcript, before any model sees it.
    //
    // This was deferred on the belief that the panel already had it. It did not
    // — `parseConversationRecallRequest` was only ever called from the
    // participant — so "what was my question three turns ago" went to a model
    // here and came back with a confident, entirely invented question, plus an
    // invented summary of a conversation that had a verbatim record sitting in
    // memory. Of every fabrication available in this product that is the
    // worst-shaped: it contradicts something the operator can scroll up and read.
    const recallRequest = forceSteer ? undefined : parseConversationRecallRequest(prompt);
    const recalled = recallRequest
      ? answerConversationRecall(
        recallRequest,
        // Excludes the question being asked right now: it was appended before
        // `preparePromptRequest` ran, and "three turns ago" means three before
        // this one.
        this.atlas.sessionConversation.getTranscript(activeSessionId).slice(0, -1),
        prompt,
      )
      : undefined;

    const roadmapStatus = forceSteer || recalled ? undefined : await buildRoadmapStatusResult(prompt);
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
      ...(workflowExecutionPolicy ? { __workflowChatPolicy: workflowExecutionPolicy } : {}),
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
      ...(recalled
        ? { directResponse: { markdown: recalled.markdown, modelUsed: 'atlasmind/conversation-recall' } }
        : {}),
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

  /**
   * The editor selection, attached as ordinary text.
   *
   * An attachment rather than a new context field, so it travels the pipeline
   * every other attachment already uses — including the secret redaction added
   * in 0.329.0, which a bespoke context key would have quietly bypassed.
   */
  private async attachEditorSelection(): Promise<void> {
    const editor = this.lastActiveTextEditor && !this.lastActiveTextEditor.document.isClosed
      ? this.lastActiveTextEditor
      : vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      await this.host.webview.postMessage({
        type: 'status',
        payload: 'Select some code in an editor first, then attach it.',
      });
      return;
    }

    const document = editor.document;
    const relativePath = vscode.workspace.asRelativePath(document.uri, false);
    const startLine = editor.selection.start.line + 1;
    const endLine = editor.selection.end.line + 1;
    const raw = document.getText(editor.selection);
    const truncated = raw.length > ChatPanel.MAX_SELECTION_CHARS;
    const body = redactSecrets(truncated ? raw.slice(0, ChatPanel.MAX_SELECTION_CHARS) : raw).text;
    const range = startLine === endLine ? `line ${startLine}` : `lines ${startLine}–${endLine}`;

    await this.addAttachmentUris([], [{
      id: `selection:${relativePath}:${startLine}-${endLine}`,
      label: `${relativePath} · ${range}`,
      kind: 'text',
      source: relativePath,
      inlineText: [
        `Selected from ${relativePath}, ${range}${truncated ? ' (truncated)' : ''}:`,
        '',
        '```' + (document.languageId || ''),
        body,
        '```',
      ].join('\n'),
    }]);
  }

  /**
   * The Problems panel, attached as ordinary text.
   *
   * Counted in the label because "Problems" alone says nothing about whether it
   * is worth sending: three errors and four hundred warnings are different
   * attachments, and only one of them is worth a model's context.
   */
  private async attachProblems(): Promise<void> {
    const bySeverity = { errors: 0, warnings: 0, other: 0 };
    const lines: string[] = [];
    let listed = 0;
    let omitted = 0;

    for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
      const relativePath = vscode.workspace.asRelativePath(uri, false);
      for (const diagnostic of diagnostics) {
        if (diagnostic.severity === vscode.DiagnosticSeverity.Error) {
          bySeverity.errors += 1;
        } else if (diagnostic.severity === vscode.DiagnosticSeverity.Warning) {
          bySeverity.warnings += 1;
        } else {
          bySeverity.other += 1;
        }
        if (listed >= ChatPanel.MAX_PROBLEMS) {
          omitted += 1;
          continue;
        }
        const severity = diagnostic.severity === vscode.DiagnosticSeverity.Error
          ? 'error'
          : diagnostic.severity === vscode.DiagnosticSeverity.Warning ? 'warning' : 'info';
        const source = diagnostic.source ? `${diagnostic.source}: ` : '';
        lines.push(`- ${relativePath}:${diagnostic.range.start.line + 1} — ${severity} — ${source}${diagnostic.message}`);
        listed += 1;
      }
    }

    const total = bySeverity.errors + bySeverity.warnings + bySeverity.other;
    if (total === 0) {
      await this.host.webview.postMessage({ type: 'status', payload: 'No problems reported in this workspace.' });
      return;
    }

    const summary = [
      bySeverity.errors ? `${bySeverity.errors} error${bySeverity.errors === 1 ? '' : 's'}` : '',
      bySeverity.warnings ? `${bySeverity.warnings} warning${bySeverity.warnings === 1 ? '' : 's'}` : '',
      bySeverity.other ? `${bySeverity.other} other` : '',
    ].filter(Boolean).join(', ');

    const body = redactSecrets([
      `Problems reported in this workspace (${summary}):`,
      '',
      ...lines,
      // Stated rather than silently dropped: a truncated list read as the whole
      // list is how a model concludes a problem was fixed.
      ...(omitted > 0 ? ['', `_${omitted} further problem${omitted === 1 ? '' : 's'} not listed._`] : []),
    ].join('\n')).text.slice(0, ChatPanel.MAX_PROBLEMS_CHARS);

    await this.addAttachmentUris([], [{
      id: 'problems:workspace',
      label: `Problems · ${summary}`,
      kind: 'text',
      source: 'Problems panel',
      inlineText: body,
    }]);
  }

  /**
   * Answers an `@`-mention lookup.
   *
   * The query is echoed back so the webview can discard a stale reply: typing is
   * faster than a workspace search, and replies do not necessarily arrive in the
   * order they were asked for — without the echo, pausing after "src/ch" could
   * leave the list showing matches for "src/c".
   */
  /**
   * Pin a model, or clear the pin.
   *
   * The requested id is checked against the list this panel published rather
   * than trusted: the webview supplies data, and "which models exist" is a
   * question only the host can answer.
   */
  private async applyModelOverride(request: { modelId: string | null; scope: 'turn' | 'session' }): Promise<void> {
    // Refreshed before validating rather than trusting the last sync: the first
    // pin can arrive before the opening `syncState` has resolved, and validating
    // against an empty list would reject a model the operator was just shown.
    await this.refreshPickableModels();
    const resolved = resolveModelOverride(request, this.pickableModels);
    if (resolved === 'unknown-model') {
      await this.host.webview.postMessage({ type: 'status', payload: 'That model is not available.' });
      return;
    }
    this.modelOverride = resolved;
    await this.host.webview.postMessage({
      type: 'status',
      payload: resolved
        ? `Using ${resolved.modelId}${resolved.scope === 'turn' ? ' for the next message' : ' for this chat'}.`
        : 'Back to automatic model routing.',
    });
    await this.syncState();
  }

  /**
   * The pin to apply to the turn being sent, consuming a turn-scoped one.
   *
   * Consumed here rather than after the turn completes, so a pin cannot survive
   * a failed or cancelled request and quietly apply to the next thing typed.
   */
  private takeModelOverrideForTurn(): string | undefined {
    const override = this.modelOverride;
    if (!override) {
      return undefined;
    }
    if (override.scope === 'turn') {
      this.modelOverride = undefined;
      void this.syncState();
    }
    return override.modelId;
  }

  /**
   * What the next turn would carry.
   *
   * Measured from the same `buildContext` call the turn itself uses, plus the
   * attachment text, so the bar and the packing cannot disagree. The unsent
   * draft is deliberately excluded and added client-side instead: recomputing
   * this on every keystroke would mean a session-context rebuild per character.
   */
  private buildContextMeter(sessionContextChars: number, turnLimit: number): ChatContextMeter | undefined {
    // A meter that cannot measure is absent, never zero, and never fatal: this
    // runs inside `syncState` on every render, so an optional capability being
    // missing must cost a bar, not the panel.
    if (typeof this.atlas.sessionConversation?.buildContext !== 'function') {
      return undefined;
    }
    const sessionContext = this.atlas.sessionConversation.buildContext({
      maxTurns: turnLimit,
      maxChars: sessionContextChars,
      sessionId: this.selectedSessionId,
    });
    const attachmentText = this.composerAttachments
      .map(attachment => attachment.inlineText ?? '')
      .join('\n');
    const carried = [sessionContext, attachmentText].join('\n');

    // Pinned first, then whoever answered last. Neither is a promise about the
    // next turn — the router may choose differently — which is why the absence
    // of both falls back to the session budget rather than guessing a window.
    const modelId = this.modelOverride?.modelId
      ?? [...this.atlas.sessionConversation.getTranscript(this.selectedSessionId)]
        .reverse()
        .find(entry => entry.role === 'assistant' && typeof entry.meta?.modelUsed === 'string')
        ?.meta?.modelUsed;
    const contextWindow = modelId
      ? this.atlas.modelRouter?.getModelInfo?.(modelId)?.contextWindow
      : undefined;

    const transcript = this.atlas.sessionConversation.getTranscript(this.selectedSessionId);
    return {
      estimatedTokens: estimateTokens(carried),
      ...(modelId ? { modelId } : {}),
      ...(typeof contextWindow === 'number' && contextWindow > 0 ? { contextWindow } : {}),
      contextChars: carried.trim().length,
      charBudget: sessionContextChars,
      turnCount: Math.ceil(transcript.length / 2),
      turnLimit,
    };
  }

  private async refreshPickableModels(): Promise<void> {
    const router = this.atlas.modelRouter as { listProviders?: unknown } | undefined;
    if (!router || typeof router.listProviders !== 'function') {
      this.pickableModels = [];
      return;
    }
    try {
      this.pickableModels = await collectPickableModels(
        this.atlas.modelRouter as never,
        providerId => this.atlas.isProviderConfigured(providerId),
      );
      this.providerListLoaded = true;
    } catch {
      // A picker that cannot enumerate is empty, never stale: offering a model
      // that is no longer configured would pin a turn to something that fails.
      this.pickableModels = [];
    }
  }

  /**
   * Search every stored session for a phrase.
   *
   * Host-side because only the host holds the other sessions — the webview has
   * the open one and nothing else. Cheap enough to run per request: the store
   * caps at 30 sessions, so this is a scan over what is already in memory
   * rather than a query anyone needs to index for.
   */
  /**
   * Rewind the conversation to a message and run it again.
   *
   * One method for both editing a prompt and regenerating a reply, because they
   * are the same operation seen from two ends: find the user turn to run, drop
   * everything after it, and send it. Splitting them would give two chances to
   * get the discard boundary wrong.
   */
  /**
   * Put the files back as they were before a turn.
   *
   * Files only, and the dialog says so: the conversation is untouched, because
   * a transcript that silently rewound itself alongside the working tree would
   * leave no record of what had been tried. The two are separate decisions and
   * `Edit`/`Regenerate` is the one that rewinds the conversation.
   */
  /**
   * Turn a dictated utterance into composer text.
   *
   * The transcript is **inserted, never submitted**. Speech recognition gets
   * words wrong, and a mis-heard sentence that sends itself is a turn the
   * operator did not ask for — with a cost. Reading it first is the whole
   * safeguard, and it costs one keystroke.
   */
  private async transcribeComposerAudio(dataBase64: string): Promise<void> {
    const transcribe = this.atlas.voiceManager?.transcribeWav?.bind(this.atlas.voiceManager);
    if (!transcribe) {
      await this.host.webview.postMessage({ type: 'status', payload: 'Dictation is unavailable here.' });
      return;
    }

    await this.host.webview.postMessage({ type: 'status', payload: 'Transcribing on this machine…' });
    let wav: Buffer;
    try {
      wav = Buffer.from(dataBase64, 'base64');
    } catch {
      await this.host.webview.postMessage({ type: 'status', payload: 'That recording could not be read.' });
      return;
    }

    const result = await transcribe(wav);
    if (!result.ok) {
      // Named rather than generic: "the model is not downloaded yet" and "the
      // microphone recorded nothing" want different things from the operator.
      await this.host.webview.postMessage({ type: 'status', payload: `Dictation failed — ${result.reason}` });
      return;
    }
    if (result.text.length === 0) {
      await this.host.webview.postMessage({ type: 'status', payload: 'Nothing was heard.' });
      return;
    }
    await this.host.webview.postMessage({ type: 'transcriptReady', payload: { text: result.text } });
    await this.host.webview.postMessage({ type: 'status', payload: 'Ready.' });
  }

  private async restoreCheckpointForTurn(entryId: string): Promise<void> {
    const entry = this.atlas.sessionConversation
      .getTranscript(this.selectedSessionId)
      .find(item => item.id === entryId);
    const taskId = entry?.meta?.taskId;
    if (!taskId) {
      await this.host.webview.postMessage({ type: 'status', payload: 'This turn has no file snapshot.' });
      return;
    }

    const available = await this.atlas.listCheckpoints?.().catch(() => []) ?? [];
    const checkpoint = available.find(item => item.taskId === taskId);
    if (!checkpoint) {
      // Snapshots age out of a ring buffer, so "there was one" and "there is
      // one" are different facts and the operator should be told which.
      await this.host.webview.postMessage({
        type: 'status',
        payload: 'The file snapshot for that turn is no longer stored.',
      });
      return;
    }

    const choice = await vscode.window.showWarningMessage(
      `Restore ${checkpoint.fileCount} file${checkpoint.fileCount === 1 ? '' : 's'} to their state before this turn?`,
      {
        modal: true,
        detail: 'Only files are restored. The conversation is left exactly as it is, and anything changed since is overwritten.',
      },
      'Restore files',
    );
    if (choice !== 'Restore files') {
      await this.host.webview.postMessage({ type: 'status', payload: 'Nothing restored.' });
      return;
    }

    const result = await this.atlas.rollbackCheckpointByTaskId?.(taskId)
      ?? { ok: false, summary: 'Restoring files is unavailable here.', restoredPaths: [] };
    await this.host.webview.postMessage({ type: 'status', payload: result.summary });
    await this.syncState();
  }

  private async rewindAndResubmit(entryId: string, replacementText?: string): Promise<void> {
    if (this.activePromptExecution) {
      await this.host.webview.postMessage({ type: 'status', payload: 'Still working on your last message.' });
      return;
    }

    const transcript = this.atlas.sessionConversation.getTranscript(this.selectedSessionId);
    const index = transcript.findIndex(entry => entry.id === entryId);
    if (index === -1) {
      await this.host.webview.postMessage({ type: 'status', payload: 'That message is no longer in this chat.' });
      return;
    }

    // Regenerating names an assistant reply; the thing to re-run is the prompt
    // that produced it, which is the nearest user turn above.
    let userIndex = index;
    while (userIndex >= 0 && transcript[userIndex]?.role !== 'user') {
      userIndex -= 1;
    }
    const userEntry = userIndex >= 0 ? transcript[userIndex] : undefined;
    if (!userEntry) {
      await this.host.webview.postMessage({ type: 'status', payload: 'There is no message of yours to re-run here.' });
      return;
    }

    const prompt = (replacementText ?? userEntry.content).trim();
    if (!prompt) {
      await this.host.webview.postMessage({ type: 'status', payload: 'That message is empty.' });
      return;
    }

    const discarded = transcript.length - (userIndex + 1);
    if (discarded > 0) {
      const choice = await vscode.window.showWarningMessage(
        replacementText ? 'Edit this message and run it again?' : 'Generate a new reply?',
        {
          modal: true,
          detail: `This discards the ${discarded} message${discarded === 1 ? '' : 's'} after it in this chat. They cannot be recovered.`,
        },
        replacementText ? 'Edit and re-run' : 'Regenerate',
      );
      if (choice === undefined) {
        await this.host.webview.postMessage({ type: 'status', payload: 'Left as it was.' });
        return;
      }
    }

    if (replacementText) {
      this.atlas.sessionConversation.updateMessage(userEntry.id, prompt, this.selectedSessionId);
    }
    // Truncate from the user turn itself: `runPrompt` appends it again, and a
    // rewind that kept the old copy would show the prompt twice.
    this.atlas.sessionConversation.truncateAfter(userEntry.id, this.selectedSessionId);
    this.atlas.sessionConversation.deleteMessage(userEntry.id, this.selectedSessionId);

    // The session bundle is a rolling summary with no per-turn identity, so it
    // cannot be rewound — only rebuilt from what the transcript now says. Left
    // stale it would keep describing turns that no longer exist.
    void this.atlas.sessionContextManager
      ?.bootstrapFromTranscript(
        this.selectedSessionId,
        this.atlas.sessionConversation.getTranscript(this.selectedSessionId),
      )
      .catch(() => undefined);

    await this.syncState();
    await this.runPrompt(prompt, 'send');
  }

  private async replyWithCrossSessionResults(query: string): Promise<void> {
    const needle = query.trim().toLowerCase();
    const results: Array<{ sessionId: string; sessionTitle: string; entryId: string; snippet: string; timestamp: string }> = [];

    for (const summary of this.atlas.sessionConversation.listSessions()) {
      for (const entry of this.atlas.sessionConversation.getTranscript(summary.id)) {
        if (results.length >= ChatPanel.MAX_CROSS_SESSION_RESULTS) {
          break;
        }
        if (typeof entry.content !== 'string') {
          continue;
        }
        const at = entry.content.toLowerCase().indexOf(needle);
        if (at === -1) {
          continue;
        }
        // A window around the hit rather than the head of the message: the
        // match is what the reader is looking for, and a snippet that does not
        // contain it makes them open every result to find out.
        const from = Math.max(0, at - 60);
        const snippet = `${from > 0 ? '…' : ''}${entry.content.slice(from, at + needle.length + 90).replace(/\s+/g, ' ').trim()}…`;
        results.push({
          sessionId: summary.id,
          sessionTitle: summary.title,
          entryId: entry.id,
          snippet: redactSecrets(snippet).text,
          timestamp: entry.timestamp,
        });
      }
    }

    await this.host.webview.postMessage({
      type: 'crossSessionSearchResults',
      payload: { query, results, capped: results.length >= ChatPanel.MAX_CROSS_SESSION_RESULTS },
    });
  }

  private async replyWithFileMentions(query: string): Promise<void> {
    const trimmed = query.trim();
    let files: string[] = [];
    if (trimmed.length > 0) {
      try {
        const found = await vscode.workspace.findFiles(
          `**/*${trimmed.replace(/[*?[\]{}]/g, '')}*`,
          '**/{node_modules,out,dist,.git}/**',
          ChatPanel.MAX_FILE_MENTIONS,
        );
        files = found.map(uri => vscode.workspace.asRelativePath(uri, false));
      } catch {
        files = [];
      }
    }
    await this.host.webview.postMessage({ type: 'fileMentions', payload: { query, files } });
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
    // Loaded first so `window.hljs` exists by the time the panel script runs.
    // Built from the pinned devDependency by esbuild.mjs, never fetched: the
    // panel's CSP has no CDN in it, deliberately.
    const highlightUri = this.host.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'vendor', 'highlight.min.js'),
    ).toString();
    return buildChatWebviewHtml({
      scriptUri,
      vendorScriptUris: [highlightUri],
      cspSource: this.host.webview.cspSource,
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
  // A direct answer is meaningful only as one atomic auto-submitted prompt +
  // response pair. Without both fields it would remain armed and could answer
  // an unrelated later message.
  const directResponse = target.autoSubmit === true
    && typeof target.draftPrompt === 'string'
    && target.draftPrompt.trim().length > 0
    ? normalizeChatPanelDirectResponse(target.directResponse)
    : undefined;
  return {
    ...(typeof target.sessionId === 'string' && target.sessionId.trim().length > 0 ? { sessionId: target.sessionId.trim() } : {}),
    ...(typeof target.messageId === 'string' && target.messageId.trim().length > 0 ? { messageId: target.messageId.trim() } : {}),
    ...(typeof target.draftPrompt === 'string' && target.draftPrompt.trim().length > 0 ? { draftPrompt: target.draftPrompt.trim() } : {}),
    ...(target.sendMode === 'send' || target.sendMode === 'steer' || target.sendMode === 'new-chat' || target.sendMode === 'new-session' || target.sendMode === 'new-loop' ? { sendMode: target.sendMode } : {}),
    ...(target.autoSubmit === true ? { autoSubmit: true } : {}),
    ...(directResponse ? { directResponse } : {}),
    ...(isJsonRecord(target.contextPatch) ? { contextPatch: target.contextPatch } : {}),
    ...(target.preserveFocus === true ? { preserveFocus: true } : {}),
  };
}

function normalizeChatPanelDirectResponse(value: unknown): ChatPanelDirectResponse | undefined {
  if (!isJsonRecord(value)) {
    return undefined;
  }
  const clean = (candidate: unknown, max: number, preserveLines = false): string => {
    if (typeof candidate !== 'string') {
      return '';
    }
    const withoutControls = preserveLines
      ? candidate.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, '')
      : candidate.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ');
    return redactSecrets(withoutControls).text.trim().slice(0, max);
  };
  const markdown = clean(value['markdown'], 40_000, true);
  const modelUsed = clean(value['modelUsed'], 120);
  if (!markdown || !/^atlasmind\/[a-z0-9._/-]+$/i.test(modelUsed)) {
    return undefined;
  }

  let thoughtSummary: SessionThoughtSummary | undefined;
  if (isJsonRecord(value['thoughtSummary'])) {
    const source = value['thoughtSummary'];
    const label = clean(source['label'], 80);
    const summary = clean(source['summary'], 320);
    const bullets = Array.isArray(source['bullets'])
      ? source['bullets'].slice(0, 12).map(item => clean(item, 320)).filter(Boolean)
      : [];
    const status = source['status'];
    if (label && summary) {
      thoughtSummary = {
        label,
        summary,
        bullets,
        ...(status === 'verified' || status === 'blocked' || status === 'missing' || status === 'not-applicable'
          ? { status }
          : {}),
        ...(clean(source['statusLabel'], 80) ? { statusLabel: clean(source['statusLabel'], 80) } : {}),
      };
    }
  }

  const quickReplies = Array.isArray(value['quickReplies'])
    ? value['quickReplies'].slice(0, 5).flatMap(item => {
      if (!isJsonRecord(item)) {
        return [];
      }
      const label = clean(item['label'], 60);
      const prompt = clean(item['prompt'], 800, true);
      const description = clean(item['description'], 180);
      return label && prompt
        ? [{ label, prompt, ...(description ? { description } : {}) }]
        : [];
    })
    : [];

  const composerPrefills = Array.isArray(value['composerPrefills'])
    ? value['composerPrefills'].slice(0, 5).flatMap(item => {
      if (!isJsonRecord(item)) {
        return [];
      }
      const label = clean(item['label'], 60);
      const template = clean(item['template'], 4000, true);
      const description = clean(item['description'], 180);
      const cursorOffset = Number(item['cursorOffset']);
      return label && template
        ? [{
            label,
            template,
            ...(description ? { description } : {}),
            ...(Number.isInteger(cursorOffset) && cursorOffset >= 0 && cursorOffset <= template.length ? { cursorOffset } : {}),
          }]
        : [];
    })
    : [];

  const statusMessage = clean(value['statusMessage'], 180);
  const followupQuestion = clean(value['followupQuestion'], 300);
  return {
    markdown,
    modelUsed,
    ...(statusMessage ? { statusMessage } : {}),
    ...(thoughtSummary ? { thoughtSummary } : {}),
    ...(followupQuestion ? { followupQuestion } : {}),
    ...(quickReplies.length > 0 ? { quickReplies } : {}),
    ...(composerPrefills.length > 0 ? { composerPrefills } : {}),
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
    /**
     * The checked-out ref, when there is one.
     *
     * Optional because a detached HEAD and a freshly-initialised repository both
     * legitimately have no branch name — and because the workflow notice that
     * reads this must degrade to a general message rather than claim you are on
     * a branch it could not identify.
     */
    HEAD?: { name?: string };
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
 * The branch the workspace is on, or `undefined`.
 *
 * Used to make the workflow notice specific — "you are on `main`, which this
 * project marks protected" is worth saying, where the general form is not.
 * Undefined on a detached HEAD, in a repository with no commits, and anywhere
 * the Git extension is absent; every one of those degrades to the general
 * message rather than guessing.
 */
async function readCurrentBranch(workspaceRoot: string | undefined): Promise<string | undefined> {
  if (!workspaceRoot) {
    return undefined;
  }
  try {
    // Bounded, because `getGitApi` awaits the Git extension's activation and this
    // sits in front of a chat turn. An extension that is slow to activate must
    // cost the notice its specificity, never cost the user their request.
    const api = await Promise.race([
      getGitApi(),
      new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), GIT_BRANCH_READ_TIMEOUT_MS)),
    ]);
    const repo = api?.repositories.find(candidate => workspaceRoot.startsWith(candidate.rootUri.fsPath))
      ?? api?.repositories[0];
    const name = repo?.state.HEAD?.name;
    return typeof name === 'string' && name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

/** Long enough for a warm Git extension, short enough not to be felt. */
const GIT_BRANCH_READ_TIMEOUT_MS = 750;

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
      const followupBlock = renderSuggestedFollowupsMarkdown(entry.meta?.followupQuestion, entry.meta?.suggestedFollowups, entry.content);
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
  answerText?: string,
): string {
  if (!followupQuestion || !suggestedFollowups || suggestedFollowups.length === 0) {
    return '';
  }

  // The question is lifted out of the reply's own tail, so restating it here
  // printed it twice in one exported turn.
  if (typeof answerText === 'string'
    && answerText.trimEnd().toLowerCase().endsWith(followupQuestion.trim().toLowerCase())) {
    return `\n\n${suggestedFollowups.map(item => `- ${escapeMarkdownHtml(item.label)}`).join('\n')}`;
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

/**
 * Terminal output on its way into a model prompt.
 *
 * Redacted here rather than at each of the three prompt builders, because this
 * is the only path any of them uses and a boundary with three doors is one
 * somebody eventually walks around. A managed terminal runs whatever the
 * operator typed — `env`, a failing deploy that echoes its connection string, a
 * CLI printing the token it just used — and that output went to the model
 * verbatim. The orchestrator redacts the context it assembles itself; this text
 * is assembled by the panel and never passed through it.
 *
 * Truncation keeps the tail, so redaction runs first: a secret split across the
 * cut would otherwise leave half a credential looking like ordinary text.
 */
export function truncateManagedTerminalContext(output: string): string {
  const safe = redactSecrets(output).text;
  if (safe.length <= 8000) {
    return safe;
  }
  return `... output truncated ...\n${safe.slice(-8000)}`;
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
    // The paste and drag-drop path into the same context as readAttachmentSnippet.
    return redactSecrets(text).text.slice(0, 6000);
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
    // Attaching a file is the easiest way to send a model a `.env`, a
    // `wrangler.toml` or a log holding a bearer token — it is one drag from the
    // explorer, and nothing about the gesture suggests the contents are being
    // read. Redacted before the slice for the same reason as the terminal path.
    return redactSecrets(text).text.slice(0, 6000);
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

/**
 * Split a linked file reference into the path and the line it points at.
 *
 * Models write the same reference four ways — `src/a.ts`, `src/a.ts:12`,
 * `src/a.ts#L12` and `src/a.ts#L12-20` — and the anchor has to come off before
 * the path is resolved, because `src/a.ts:12` names no file on any platform. A
 * range keeps only its first line: the reference is a place to go, not a
 * selection to make.
 *
 * A reference that is only an anchor (`#L12`) yields nothing rather than
 * resolving to the workspace root, which would open a folder for a link that
 * named no file.
 */
export function parseFileReference(reference: string): { path: string; line?: number } | undefined {
  const trimmed = String(reference ?? '').trim();
  if (!trimmed) {
    return undefined;
  }

  const anchored = /^(.*?)(?:#L(\d+)(?:[-,]\d+)?|:(\d+)(?::\d+)?)$/i.exec(trimmed);
  const rawPath = anchored ? anchored[1] : trimmed;
  const rawLine = anchored ? (anchored[2] ?? anchored[3]) : undefined;
  if (!rawPath) {
    return undefined;
  }

  const line = rawLine === undefined ? undefined : Number.parseInt(rawLine, 10);
  return line === undefined || !Number.isFinite(line) || line < 1
    ? { path: rawPath }
    : { path: rawPath, line };
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

