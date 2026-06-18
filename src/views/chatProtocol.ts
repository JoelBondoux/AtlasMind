// Node-free chat webview protocol: the message union exchanged between the chat
// webview front-end and its host, plus the runtime validators.
//
// This module MUST stay free of Node built-ins and `vscode` runtime imports so it
// can be bundled into the browser (web extension host) build and shared by the
// remote-control transport. See docs/remote-control.md.
import type { ToolApprovalDecision, ProjectRunReviewDecision } from '../types.js';

export type ComposerSendMode = 'send' | 'steer' | 'new-chat' | 'new-session';

export type PersistentComposerSendMode = Extract<ComposerSendMode, 'send' | 'steer'>;

export type ChatPanelImportedItem =
  | { transport: 'workspace-path'; value: string }
  | { transport: 'url'; value: string }
  | { transport: 'inline-file'; name: string; mimeType?: string; dataBase64: string };

export type ChatPanelMessage =
  | { type: 'ready' }
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
  | { type: 'raiseIterationLimitPermanent'; payload: { entryId: string; value: number } }
  | { type: 'raiseIterationLimitTemporary'; payload: { entryId: string; value: number } }
  | { type: 'raiseToolCallsPerTurnLimitPermanent'; payload: { entryId: string; value: number } }
  | { type: 'raiseToolCallsPerTurnLimitTemporary'; payload: { entryId: string; value: number } }
  | { type: 'saveFontScale'; payload: number }
  | { type: 'toggleAutopilot' }
  | { type: 'importSessionContext'; payload: string }
  | { type: 'searchSession'; payload: { query: string } }
  | { type: 'deleteMessage'; payload: string }
  | { type: 'sendToTerminal'; payload: { code: string } }
  | { type: 'syncAiInstructions' }
  | { type: 'dismissAiInstructionNudge' }
  | { type: 'openSettings' }
  | { type: 'openProjectDashboard' };

export function getStatusDrivenComposerMode(isBusy: boolean): PersistentComposerSendMode {
  return isBusy ? 'steer' : 'send';
}

export function isOneShotComposerMode(mode: ComposerSendMode | undefined): mode is Extract<ComposerSendMode, 'new-chat' | 'new-session'> {
  return mode === 'new-chat' || mode === 'new-session';
}

export function isComposerSendMode(value: unknown): value is ComposerSendMode {
  return value === 'send' || value === 'steer' || value === 'new-chat' || value === 'new-session';
}

export function isAssistantVoteMessage(value: unknown): value is 'up' | 'down' | 'clear' {
  return value === 'up' || value === 'down' || value === 'clear';
}

export function isToolApprovalDecision(value: unknown): value is ToolApprovalDecision {
  return value === 'allow-once'
    || value === 'bypass-task'
    || value === 'autopilot'
    || value === 'deny';
}

export function isRunReviewDecision(value: unknown): value is Exclude<ProjectRunReviewDecision, 'pending'> {
  return value === 'accepted' || value === 'dismissed';
}

export function isChatPanelImportedItem(value: unknown): value is ChatPanelImportedItem {
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

export function isChatPanelMessage(value: unknown): value is ChatPanelMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }

  const message = value as { type?: unknown; payload?: unknown };
  if (
    message.type === 'ready'
    || message.type === 'clearConversation'
    || message.type === 'copyTranscript'
    || message.type === 'saveTranscript'
    || message.type === 'createSession'
    || message.type === 'stopPrompt'
    || message.type === 'pickAttachments'
    || message.type === 'attachOpenFiles'
    || message.type === 'clearAttachments'
    || message.type === 'toggleAutopilot'
    || message.type === 'syncAiInstructions'
    || message.type === 'dismissAiInstructionNudge'
    || message.type === 'openSettings'
    || message.type === 'openProjectDashboard'
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

  if (
    message.type === 'raiseIterationLimitPermanent' ||
    message.type === 'raiseIterationLimitTemporary' ||
    message.type === 'raiseToolCallsPerTurnLimitPermanent' ||
    message.type === 'raiseToolCallsPerTurnLimitTemporary'
  ) {
    return typeof message.payload === 'object'
      && message.payload !== null
      && typeof (message.payload as { entryId?: unknown }).entryId === 'string'
      && typeof (message.payload as { value?: unknown }).value === 'number';
  }

  if (message.type === 'saveFontScale') {
    return typeof message.payload === 'number' && Number.isFinite(message.payload);
  }

  if (message.type === 'searchSession') {
    return typeof message.payload === 'object'
      && message.payload !== null
      && typeof (message.payload as { query?: unknown }).query === 'string';
  }

  if (message.type === 'sendToTerminal') {
    return typeof message.payload === 'object'
      && message.payload !== null
      && typeof (message.payload as { code?: unknown }).code === 'string';
  }

  return (message.type === 'selectSession'
    || message.type === 'deleteSession'
    || message.type === 'openProjectRun'
    || message.type === 'attachOpenFile'
    || message.type === 'removeAttachment'
    || message.type === 'importSessionContext'
    || message.type === 'deleteMessage')
    && typeof message.payload === 'string';
}
