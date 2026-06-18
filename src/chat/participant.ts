import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { AtlasMindContext } from '../extension.js';
import type {
  SessionPolicySnapshot,
  SessionSuggestedFollowup,
  SessionTimelineNote,
  SessionTranscriptEntry,
  SessionTranscriptMetadata,
} from './sessionConversation.js';
import type {
  ChangedWorkspaceFile,
  ProjectProgressUpdate,
  ProjectResult,
  ProjectRunSubTaskArtifact,
  ProjectRunSummary,
  SubTaskResult,
  TaskImageAttachment,
  TaskResult,
} from '../types.js';
import { Planner } from '../core/planner.js';
import { TaskProfiler } from '../core/taskProfiler.js';
import { shouldBiasTowardWorkspaceInvestigation } from '../core/orchestrator.js';
import { formatCost, formatCostAdaptive } from '../core/currencyFormatter.js';
import { mergeImageAttachments, resolveInlineImageAttachments, resolvePickedImageAttachments } from './imageAttachments.js';

export { extractImagePathCandidates, mergeImageAttachments, resolveInlineImageAttachments } from './imageAttachments.js';

export const ATLASMIND_CHAT_PARTICIPANT_ID = 'atlasmind.orchestrator';

/**
 * Maps a VS Code chat thread fingerprint (first user prompt, up to 100 chars) to an
 * AtlasMind session ID.  Kept module-level so it survives across individual request
 * handler calls within the same extension host session.
 *
 * The map is never explicitly cleared — entries for pruned sessions are handled lazily:
 * if getSession() returns undefined the entry is replaced with a fresh spawnSession().
 */
const threadSessionMap = new Map<string, string>();

/**
 * Returns the AtlasMind session ID that should be used for the current VS Code chat
 * request.  The mapping is derived from the first user-side turn in the thread's
 * history, which is stable across all follow-up requests in the same chat panel.
 *
 * On the very first request of a thread (empty history) a new session is spawned and
 * registered under the opening prompt so the second request can find it.
 */
export function resolveThreadSessionId(
  request: Pick<vscode.ChatRequest, 'prompt'>,
  chatContext: Pick<vscode.ChatContext, 'history'>,
  sessionConversation: Pick<import('./sessionConversation.js').SessionConversation, 'spawnSession' | 'getSession'>,
): string {
  const history = chatContext.history ?? [];

  // Find the first user-side turn — this is the stable fingerprint for the whole thread.
  let fingerprint: string | undefined;
  for (const item of history) {
    if ('prompt' in item && typeof item.prompt === 'string' && item.prompt.trim()) {
      fingerprint = item.prompt.trim().slice(0, 100);
      break;
    }
  }

  if (fingerprint) {
    const existingId = threadSessionMap.get(fingerprint);
    if (existingId && sessionConversation.getSession(existingId)) {
      return existingId;
    }
    // Session was pruned or map entry is stale — spawn a fresh one.
    const newId = sessionConversation.spawnSession();
    threadSessionMap.set(fingerprint, newId);
    return newId;
  }

  // First request of a new thread (no history yet).  Spawn a dedicated session and
  // register it under this prompt so the second request can look it up.
  const newId = sessionConversation.spawnSession();
  const promptFingerprint = request.prompt.trim().slice(0, 100);
  if (promptFingerprint) {
    threadSessionMap.set(promptFingerprint, newId);
  }
  return newId;
}

const PROJECT_APPROVAL_TOKEN = '--approve';
const PROJECT_PERSONALITY_PROFILE_STORAGE_KEY = 'atlasmind.personalityProfile';
const DEFAULT_SSOT_PATH = 'project_memory';
const OPERATOR_FEEDBACK_FILE = 'operations/operator-feedback.md';
const MIN_FRUSTRATION_SESSION_TURNS = 8;
const MIN_FRUSTRATION_SESSION_CHARS = 4000;
const FRUSTRATION_SETTINGS_STORAGE_KEY = 'atlasmind.frustrationSettingsSnapshot';
const FRUSTRATION_COOLING_PERIOD_MS = 30 * 60 * 1000;
const DEFAULT_PROJECT_APPROVAL_FILE_THRESHOLD = 12;
const DEFAULT_ESTIMATED_FILES_PER_SUBTASK = 2;
const DEFAULT_CHANGED_FILE_REFERENCE_LIMIT = 5;
const DEFAULT_PROJECT_RUN_REPORT_FOLDER = 'project_memory/operations';
const WORKSPACE_SNAPSHOT_EXCLUDE = '**/{.git,node_modules,out,dist,coverage}/**';
const AUTONOMOUS_CONTINUATION_PATTERN = /^\s*(?:please\s+)?(?:proceed|continue|resume|carry on|go ahead|yes(?:\s+please)?|yes(?:,?\s+(?:do\s+(?:it|that)|go\s+(?:for\s+it|ahead)))?|sure(?:\s+(?:go\s+ahead|do\s+it))?|ok(?:ay)?(?:\s+(?:go\s+ahead|proceed))?|yep|yup|go\s+for\s+it)(?:\s+(?:autonomously|automatically|with autopilot|on autopilot))?(?:\s*(?:on|with|for)\s+(.+?))?[.!?]*\s*$/i;
/** Matches bare "no" / "no thanks" / "stop" quick-reply responses — treated as a continuation signal so the model doesn't re-analyse. */
const QUICK_REPLY_NEGATIVE_PATTERN = /^\s*(?:no(?:\s+(?:thanks|thank you|please|not now|need|want))?|nope|nah|stop|skip(?:\s+(?:it|that))?|cancel(?:\s+(?:it|that))?|don'?t(?:\s+(?:do\s+it|proceed|bother))?)[.!?]*\s*$/i;
/** Detects a closing question in the last sentence of a response. */
const RESPONSE_TRAILING_QUESTION_PATTERN = /(?:^|[.!?\n])([^.!?\n]{10,300}\?)[\s]*$/;
/**
 * Matches the lead-in of a first-person offer the assistant closes with
 * ("Want me to …?", "Shall I …?", "Would you like me to …?"). Stripping this lead-in
 * from the trailing question yields the proposed action that a bare "yes" accepts.
 * Mirrors the yes/no shape recognised in {@link detectResponseQuickReplies}.
 */
const ASSISTANT_OFFER_LEAD_IN_PATTERN = /^\s*(?:so\s+|then\s+|now\s+|ok(?:ay)?,?\s+|alright,?\s+|sure,?\s+)?(?:do\s+you\s+want\s+me\s+to|would\s+you\s+like\s+me\s+to|would\s+you\s+like\s+to|want\s+me\s+to|shall\s+i|should\s+i|can\s+i|may\s+i)\s+(?:go\s+ahead\s+and\s+|please\s+)?/i;
/** Matches a bare informational question ("what/why/how/… ?"), which is not an executable goal. */
const INFORMATIONAL_QUESTION_PATTERN = /^\s*(?:what|why|how|which|where|when|who|whose|whom)\b[\s\S]*\?\s*$/i;
const PROJECT_RUN_REQUEST_PATTERN = /^\s*(?:please\s+)?(?:(?:start|begin|run|launch|kick off|continue|switch to)\s+(?:an?\s+)?)?(?:atlasmind\s+)?(?:autonomous\s+)?project(?:\s+run|\s+execution|\s+task)?\b(?:\s+(?:to|for|on|about|that|which))?\s*(.+)?$/i;
const EXPLICIT_FIX_PROMPT_PATTERN = /\b(?:fix|patch|repair|resolve|implement|update|change|modify|correct|adjust|rewrite|refactor)\b/i;
const EXPLICIT_NO_FIX_PATTERN = /\b(?:do not fix|don't fix|without changing|no code changes|read only|explain only|question only)\b/i;
const CONCRETE_ISSUE_PROMPT_PATTERN = /\b(?:bug|issue|problem|broken|regression|failing|fails|error|incorrect|wrong|missing|stuck|overflow|scroll|layout|sidebar|dropdown|panel|webview|tooltip|session rail|hides|hidden|crash|hang|stops|stopped|too tall|too wide|not working|doesn't|does not|won't|will not|can't|cannot)\b/i;
const DEICTIC_EXECUTION_FOLLOWUP_PATTERN = /^\s*(?:please\s+)?(?:(?:go\s+ahead(?:\s+and)?|proceed|continue|resume|carry\s+on|do|handle|apply|merge|rebase|ship|run)\s+(?:that|this|it|them|those|these)|take\s+care\s+of\s+(?:that|this|it|them|those|these)|(?:can|could)\s+you\s+(?:do|handle|take\s+care\s+of|apply|merge|rebase|ship|run)\s+(?:that|this|it|them|those|these))(?:\s+for\s+me)?[\s.!?]*$/i;
/** Matches meta-execution commands like "Fix this issue autonomously" that reference a prior problem via deictic pronoun + autonomous modifier. These are not goal descriptions and should be skipped when scanning back through the transcript for the actual goal. */
const DEICTIC_FIX_EXECUTION_PATTERN = /^\s*(?:please\s+)?(?:fix|implement|resolve|apply|address)\s+(?:this|that|it|them|those|these)(?:\s+(?:issue|problem|bug|error|task|thing))?\b[^.!?]*\b(?:autonomously|automatically|without\s+waiting|on\s+autopilot|with\s+autopilot|continue\s+through)\b/i;
const CONTEXTUAL_FOLLOWUP_HINT_PATTERN = /\b(?:based\s+on\s+(?:this|the|our)\s+(?:chat|thread|conversation|discussion)|from\s+(?:this|the|our)\s+(?:chat|thread|conversation|discussion)|using\s+(?:this|the|our)\s+(?:chat|thread|conversation|discussion)|given\s+(?:this|the|our)\s+(?:chat|thread|conversation|discussion)|given\s+the\s+above|based\s+on\s+the\s+above|from\s+the\s+above|earlier\s+in\s+(?:the\s+)?(?:chat|thread|conversation)|previous\s+messages|prior\s+messages|conversation\s+so\s+far|thread\s+so\s+far)\b/i;
const AMBIGUOUS_CONTEXT_DEPENDENT_PROMPT_PATTERN = /^\s*(?:(?:why|how|what|which|where|when)\b|(?:and|also|instead)\b|(?:that|this|it|them|those|these)\b|(?:can|could|would|will)\s+you\s+(?:do|fix|change|update|explain|summari[sz]e|show|handle)\s+(?:that|this|it|them|those|these)\b)/i;
const STRONG_SUBJECT_SHIFT_HINT_PATTERN = /\b(?:create|generate|design|draw|make)\b[\s\S]{0,80}\b(?:image|logo|illustration|icon|graphic|banner|artwork|mockup|poster)\b|\b(?:image|logo|illustration|icon|graphic|banner|artwork|mockup|poster)\b[\s\S]{0,80}\b(?:create|generate|design|draw|make)\b/i;
const CONTEXT_TOKEN_SKIP_WORDS = new Set([
  'a', 'about', 'after', 'all', 'alternative', 'an', 'and', 'any', 'are', 'atlas', 'atlasmind', 'based', 'be', 'before', 'but', 'by', 'can', 'change', 'chat',
  'continue', 'create', 'current', 'design', 'do', 'does', 'earlier', 'explain', 'fix', 'for', 'from', 'generate', 'go', 'had', 'handle', 'help', 'here', 'how',
  'i', 'if', 'image', 'in', 'into', 'is', 'it', 'its', 'just', 'let', 'like', 'make', 'me', 'my', 'new', 'of', 'on', 'or', 'our', 'please', 'previous', 'prior',
  'prompt', 'question', 'reply', 'response', 'session', 'show', 'something', 'subject', 'suggestion', 'summarize', 'summary', 'talking', 'text', 'that', 'the',
  'their', 'them', 'then', 'there', 'these', 'they', 'this', 'thread', 'to', 'try', 'understand', 'update', 'use', 'using', 'want', 'was', 'we', 'what', 'when',
  'where', 'which', 'why', 'with', 'work', 'would', 'you', 'your', 'logo',
]);
const ROADMAP_STATUS_PROMPT_PATTERN = /\broadmap\b/i;
const ROADMAP_STATUS_DETAIL_PATTERN = /\b(?:outstanding|remaining|left|pending|todo|to do|next steps?|follow-?ups?|progress|complete|completed|incomplete|address)\b/i;
const FOLLOWUP_FIX_QUESTION = 'Do you want me to fix this?';

interface StoredPersonalityProfileRecord {
  version: 1;
  updatedAt: string;
  answers: Record<string, unknown>;
}

interface FrustrationSettingsSnapshot {
  originalTurnLimit: number;
  originalContextChars: number;
  lastFrustrationAt: string;
}

export interface UserFrustrationSignal {
  level: 'moderate' | 'high';
  summary: string;
  matchedCue: string;
  guidance: string;
}

interface RoadmapChecklistItem {
  path: string;
  text: string;
  completed: boolean;
}

export interface RoadmapStatusSnapshot {
  completed: number;
  total: number;
  outstanding: RoadmapChecklistItem[];
}

export interface AtlasChatProjectIntent {
  kind: 'project';
  goal: string;
}

export interface AtlasChatCommandIntent {
  kind: 'command';
  commandId: string;
  args?: unknown[];
  summary: string;
}

export type AtlasChatIntent = AtlasChatProjectIntent | AtlasChatCommandIntent;

interface AtlasCommandIntentDefinition {
  pattern: RegExp;
  commandId: string;
  args?: unknown[];
  summary: string;
}

const NATURAL_LANGUAGE_COMMAND_INTENTS: AtlasCommandIntentDefinition[] = [
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?chat settings\b/i,
    commandId: 'atlasmind.openSettingsChat',
    summary: 'Opened AtlasMind Chat Settings.',
  },
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?model settings\b/i,
    commandId: 'atlasmind.openSettingsModels',
    summary: 'Opened AtlasMind Model Settings.',
  },
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?safety settings\b/i,
    commandId: 'atlasmind.openSettingsSafety',
    summary: 'Opened AtlasMind Safety Settings.',
  },
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?project settings\b/i,
    commandId: 'atlasmind.openSettingsProject',
    summary: 'Opened AtlasMind Project Settings.',
  },
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?settings\b/i,
    commandId: 'atlasmind.openSettings',
    summary: 'Opened AtlasMind Settings.',
  },
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlas(?:mind)?\s+)?(?:personality\s+profile|profile\s+dashboard|atlas\s+profile)\b/i,
    commandId: 'atlasmind.openPersonalityProfile',
    summary: 'Opened the Atlas Personality Profile.',
  },
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?cost\s+(?:panel|dashboard)\b/i,
    commandId: 'atlasmind.openCostDashboard',
    summary: 'Opened the AtlasMind Cost Dashboard.',
  },
  {
    pattern: /\b(?:show|open)\s+(?:the\s+)?(?:atlasmind\s+)?cost\s+summary\b/i,
    commandId: 'atlasmind.showCostSummary',
    summary: 'Opened the AtlasMind cost summary.',
  },
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?project run center\b/i,
    commandId: 'atlasmind.openProjectRunCenter',
    summary: 'Opened the AtlasMind Project Run Center.',
  },
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?project dashboard\b/i,
    commandId: 'atlasmind.openProjectDashboard',
    summary: 'Opened the AtlasMind Project Dashboard.',
  },
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?(?:project\s+)?(?:ideation\s+board|ideation\s+workspace|ideation\s+whiteboard|whiteboard)\b/i,
    commandId: 'atlasmind.openProjectIdeation',
    summary: 'Opened the AtlasMind Project Ideation workspace.',
  },
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?(?:model\s+providers|providers\s+panel)\b/i,
    commandId: 'atlasmind.openModelProviders',
    summary: 'Opened AtlasMind Model Providers.',
  },
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?chat\s+panel\b/i,
    commandId: 'atlasmind.openChatPanel',
    summary: 'Opened the AtlasMind Chat Panel.',
  },
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?voice\s+panel\b/i,
    commandId: 'atlasmind.openVoicePanel',
    summary: 'Opened the AtlasMind Voice Panel.',
  },
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?vision\s+panel\b/i,
    commandId: 'atlasmind.openVisionPanel',
    summary: 'Opened the AtlasMind Vision Panel.',
  },
];

/** Matches natural-language requests to open/edit a routine file. */
const ROUTINE_EDIT_PATTERN =
  /\b(?:edit|update|change|modify|open|show\s+me)\s+(?:the\s+|my\s+)?(?:(?:ship|publish(?:ing)?|deploy(?:ment)?|build|release|commit|push)\s+)?routine\b/i;

export interface WorkspaceSnapshotEntry {
  signature: string;
  relativePath: string;
  uri: vscode.Uri;
  textContent?: string;
}

export interface ProjectUiConfig {
  approvalFileThreshold: number;
  estimatedFilesPerSubtask: number;
  changedFileReferenceLimit: number;
  runReportFolder: string;
}

export interface ProjectRunOutcome {
  hasFailures: boolean;
  hasChangedFiles: boolean;
  /** Display titles of subtasks that ended with status 'failed'. */
  failedSubtaskTitles: string[];
}

export interface AssistantResponseReconciliation {
  additionalText: string;
  transcriptText: string;
}

/**
 * Registers the @atlas chat participant with VS Code's Chat API.
 */
export function registerChatParticipant(
  context: vscode.ExtensionContext,
  atlas: AtlasMindContext,
): void {
  const participant = vscode.chat.createChatParticipant(
    ATLASMIND_CHAT_PARTICIPANT_ID,
    createAtlasMindChatRequestHandler(atlas),
  );

  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');

  participant.followupProvider = createAtlasMindFollowupProvider();

  context.subscriptions.push(participant);
}

export function createAtlasMindChatRequestHandler(atlas: AtlasMindContext) {
  return (request: vscode.ChatRequest, chatContext: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken) =>
    handleNativeChatRequest(request, chatContext, stream, token, atlas);
}

export function createAtlasMindFollowupProvider(): vscode.ChatFollowupProvider {
  return {
    provideFollowups(
      result: vscode.ChatResult,
      _context: vscode.ChatContext,
      _token: vscode.CancellationToken,
    ): vscode.ChatFollowup[] {
      return buildFollowups(
        result.metadata?.['command'] as string | undefined,
        result.metadata?.['outcome'] as ProjectRunOutcome | undefined,
        result.metadata?.['suggestedFollowups'] as SessionSuggestedFollowup[] | undefined,
      );
    },
  };
}

export function buildNativeChatContextSummary(
  request: Pick<vscode.ChatRequest, 'references' | 'toolReferences' | 'model'>,
  chatContext: Pick<vscode.ChatContext, 'history'>,
  options?: { includeHistory?: boolean },
): string {
  const sections: string[] = [];

  const references = [
    ...(request.references ?? []).map(reference => reference.modelDescription ?? String(reference.value ?? reference.id ?? 'reference')),
    ...(request.toolReferences ?? []).map(reference => reference.name ?? 'tool-reference'),
  ].filter(item => typeof item === 'string' && item.trim().length > 0);

  if (references.length > 0) {
    sections.push(`Attached chat references:\n- ${references.join('\n- ')}`);
  }

  if (request.model?.id) {
    sections.push(`VS Code chat model: ${request.model.id}.`);
  }

  const historyLines = options?.includeHistory === false ? [] : buildNativeChatHistoryLines(chatContext);
  if (historyLines.length > 0) {
    sections.push(`Native chat history:\n${historyLines.join('\n')}`);
  }

  return sections.join('\n\n');
}

export function buildWorkstationContext(
  options?: { platform?: NodeJS.Platform; terminalProfile?: string },
): string | undefined {
  const platform = options?.platform ?? process.platform;
  const platformLabel = toPlatformLabel(platform);
  const terminalProfile = options?.terminalProfile ?? getConfiguredTerminalProfile(platform);

  const lines = [`Host OS: ${platformLabel}.`];
  if (terminalProfile) {
    lines.push(`Preferred terminal in VS Code: ${terminalProfile}.`);
  }

  if (platform === 'win32') {
    const preferredShell = terminalProfile ?? 'PowerShell';
    lines.push(`When suggesting commands, default to ${preferredShell} syntax, Windows paths, and VS Code terminal usage unless the user asks for another shell or platform.`);
  } else if (terminalProfile) {
    lines.push(`When suggesting commands, default to ${terminalProfile} syntax and conventions unless the user asks for another shell or platform.`);
  }

  return `Workstation context:\n- ${lines.join('\n- ')}`;
}

async function handleNativeChatRequest(
  request: vscode.ChatRequest,
  chatContext: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  atlas: AtlasMindContext,
): Promise<vscode.ChatResult> {
  const sessionId = resolveThreadSessionId(request, chatContext, atlas.sessionConversation);

  if (request.command) {
    return handleChatRequest(request, chatContext, stream, token, atlas, sessionId);
  }

  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const transcript = atlas.sessionConversation.getTranscript(sessionId);
  const carryForwardConversationContext = shouldCarryForwardConversationContext(request.prompt, transcript, chatContext);
  const storedSessionContext = carryForwardConversationContext
    ? atlas.sessionConversation.buildContext({
      maxTurns: configuration.get<number>('chatSessionTurnLimit', 6),
      maxChars: configuration.get<number>('chatSessionContextChars', 2500),
      sessionId,
    })
    : '';
  const nativeHistory = carryForwardConversationContext ? buildNativeChatHistoryLines(chatContext).join('\n') : '';
  const nativeChatContext = buildNativeChatContextSummary(request, chatContext, {
    includeHistory: carryForwardConversationContext,
  });
  const workstationContext = buildWorkstationContext();
  const sessionContext = [storedSessionContext, nativeHistory].filter(Boolean).join('\n\n');
  const operatorAdaptation = await applyOperatorFrustrationAdaptation(request.prompt, atlas, {
    sessionContext,
    nativeChatContext,
  });

  let streamedText = '';
  const chunkBuffer = createStreamBuffer(stream);
  const result = await atlas.orchestrator.processTask({
    id: `task-${Date.now()}`,
    userMessage: request.prompt,
    context: {
      ...(sessionContext ? { sessionContext } : {}),
      ...(nativeChatContext ? { nativeChatContext } : {}),
      ...(workstationContext ? { workstationContext } : {}),
      ...(operatorAdaptation?.contextPatch ?? {}),
    },
    constraints: {
      budget: toBudgetMode(configuration.get<string>('budgetMode')),
      speed: toSpeedMode(configuration.get<string>('speedMode')),
    },
    timestamp: new Date().toISOString(),
  }, chunk => {
    if (!chunk) {
      return;
    }
    streamedText += chunk;
    chunkBuffer.push(chunk);
  }, message => {
    if (!message.trim()) {
      return;
    }
    stream.progress(message);
  });
  chunkBuffer.flush();

  const reconciled = reconcileAssistantResponse(streamedText, result.response);
  if (reconciled.additionalText) {
    writeMarkdownChunk(stream, reconciled.additionalText, 'native chat completion');
  }

  const assistantMeta = buildAssistantResponseMetadata(request.prompt, result, {
    hasSessionContext: Boolean(sessionContext),
    routingContext: {
      ...(sessionContext ? { sessionContext } : {}),
      ...(nativeChatContext ? { nativeChatContext } : {}),
      ...(operatorAdaptation?.contextPatch ?? {}),
    },
    policies: [
      ...atlas.getWorkspacePolicySnapshots(),
      ...(operatorAdaptation?.policySnapshot ? [operatorAdaptation.policySnapshot] : []),
    ],
  });
  if (assistantMeta.followupQuestion) {
    writeMarkdownChunk(stream, `\n\n**Next step:** ${assistantMeta.followupQuestion}`, 'native chat follow-up prompt');
  }
  if (!token.isCancellationRequested) {
    atlas.sessionConversation.recordTurn(request.prompt, reconciled.transcriptText, sessionId, assistantMeta);
  }

  return {
    metadata: {
      command: request.command ?? 'freeform',
      ...(assistantMeta.suggestedFollowups ? { suggestedFollowups: assistantMeta.suggestedFollowups } : {}),
    },
  };
}

function buildNativeChatHistoryLines(chatContext: Pick<vscode.ChatContext, 'history'>): string[] {
  const lines: string[] = [];
  for (const item of chatContext.history ?? []) {
    if ('prompt' in item && typeof item.prompt === 'string' && item.prompt.trim().length > 0) {
      lines.push(`User: ${item.prompt.trim()}`);
    }
    if ('response' in item && Array.isArray(item.response)) {
      for (const part of item.response) {
        if (part && typeof part === 'object' && 'value' in part && typeof part.value === 'string' && part.value.trim().length > 0) {
          lines.push(`Assistant: ${part.value.trim()}`);
        }
      }
    }
  }
  return lines;
}

export function shouldCarryForwardConversationContext(
  prompt: string,
  transcript: SessionTranscriptEntry[],
  chatContext?: Pick<vscode.ChatContext, 'history'>,
): boolean {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return true;
  }

  if (isAutonomousContinuationPrompt(trimmed)
    || DEICTIC_EXECUTION_FOLLOWUP_PATTERN.test(trimmed)
    || CONTEXTUAL_FOLLOWUP_HINT_PATTERN.test(trimmed)
    || AMBIGUOUS_CONTEXT_DEPENDENT_PROMPT_PATTERN.test(trimmed)) {
    return true;
  }

  const recentPrompts = collectRecentUserPrompts(transcript, chatContext);
  if (recentPrompts.length === 0) {
    return true;
  }

  if (STRONG_SUBJECT_SHIFT_HINT_PATTERN.test(trimmed)) {
    return false;
  }

  const promptTokens = extractTopicTokens(trimmed);
  if (promptTokens.length < 2) {
    return true;
  }

  const recentTokenSet = new Set(recentPrompts.flatMap(entry => extractTopicTokens(entry)));
  const overlapCount = promptTokens.filter(tokenText => recentTokenSet.has(tokenText)).length;
  const overlapRatio = overlapCount / promptTokens.length;

  if (overlapRatio >= 0.34) {
    return true;
  }

  return overlapCount > 0;
}

function collectRecentUserPrompts(
  transcript: SessionTranscriptEntry[],
  chatContext?: Pick<vscode.ChatContext, 'history'>,
): string[] {
  const prompts: string[] = [];

  for (const entry of [...transcript].reverse()) {
    if (entry.role !== 'user') {
      continue;
    }

    const trimmed = entry.content.trim();
    if (trimmed.length > 0) {
      prompts.push(trimmed);
    }
    if (prompts.length >= 3) {
      break;
    }
  }

  if (prompts.length >= 3) {
    return prompts;
  }

  for (const item of [...(chatContext?.history ?? [])].reverse()) {
    if (!('prompt' in item) || typeof item.prompt !== 'string') {
      continue;
    }

    const trimmed = item.prompt.trim();
    if (!trimmed || prompts.includes(trimmed)) {
      continue;
    }

    prompts.push(trimmed);
    if (prompts.length >= 3) {
      break;
    }
  }

  return prompts;
}

function extractTopicTokens(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? [];
  const seen = new Set<string>();
  const tokens: string[] = [];

  for (const match of matches) {
    if (CONTEXT_TOKEN_SKIP_WORDS.has(match)) {
      continue;
    }
    if (seen.has(match)) {
      continue;
    }
    seen.add(match);
    tokens.push(match);
  }

  return tokens;
}

async function handleChatRequest(
  request: vscode.ChatRequest,
  _chatContext: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  atlas: AtlasMindContext,
  sessionId: string,
): Promise<vscode.ChatResult> {
  const command = request.command;
  let projectOutcome: ProjectRunOutcome | undefined;

  if (token.isCancellationRequested) {
    return {};
  }

  switch (command) {
    case 'bootstrap':
      await handleBootstrapCommand(stream, atlas);
      break;

    case 'import':
      await handleImportCommand(stream, atlas);
      break;

    case 'agents':
      await handleAgentsCommand(stream, atlas);
      break;

    case 'skills':
      await handleSkillsCommand(stream, atlas);
      break;

    case 'memory':
      await handleMemoryCommand(request.prompt, stream, atlas);
      break;

    case 'cost':
      await handleCostCommand(stream, atlas);
      break;

    case 'project': {
      const { sessionContextBundle, sessionContext } = await prepareProjectRunContext(atlas, sessionId);
      projectOutcome = await runProjectCommand(request.prompt, stream, token, atlas, sessionId, sessionContextBundle, sessionContext);
      break;
    }

    case 'runs':
      await handleRunsCommand(stream);
      break;

    case 'ship':
      await handleShipCommand(request.prompt, stream, atlas);
      break;

    case 'voice':
      await handleVoiceCommand(stream);
      break;

    case 'vision':
      await handleVisionCommand(request, stream, atlas, sessionId);
      break;

    default: {
      const routedIntent = resolveAtlasChatIntent(
        request.prompt,
        atlas.sessionConversation.getTranscript(sessionId),
      );
      if (routedIntent?.kind === 'project') {
        stream.markdown('### Autonomous Run\n\nContinuing from your earlier request and switching into project execution mode.');
        const { sessionContextBundle, sessionContext } = await prepareProjectRunContext(atlas, sessionId);
        projectOutcome = await runProjectCommand(
          toApprovedProjectPrompt(routedIntent.goal),
          stream,
          token,
          atlas,
          sessionId,
          sessionContextBundle,
          sessionContext,
        );
        break;
      }

      if (routedIntent?.kind === 'command') {
        await vscode.commands.executeCommand(routedIntent.commandId, ...(routedIntent.args ?? []));
        stream.markdown(routedIntent.summary);
        break;
      }

      await handleFreeformMessage(request, stream, atlas, sessionId);
      break;
    }
  }

  return { metadata: { command: command ?? 'freeform', outcome: projectOutcome } };
}

export async function prepareProjectRunContext(
  atlas: AtlasMindContext,
  sessionId?: string,
): Promise<{ sessionContextBundle?: import('../types.js').SessionContextBundle; sessionContext: string }> {
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const sessionContextBundle = sessionId
    ? await atlas.sessionContextManager?.loadContext(sessionId).catch(() => null) ?? null
    : null;
  const sessionContext = sessionContextBundle
    ? ''
    : atlas.sessionConversation.buildContext({
        maxTurns: configuration.get<number>('chatSessionTurnLimit', 6),
        maxChars: configuration.get<number>('chatSessionContextChars', 2500),
        sessionId,
      });

  return {
    sessionContextBundle: sessionContextBundle ?? undefined,
    sessionContext,
  };
}

export async function runProjectCommand(
  prompt: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  atlas: AtlasMindContext,
  sessionId?: string,
  sessionContextBundle?: import('../types.js').SessionContextBundle,
  sessionContext?: string,
): Promise<ProjectRunOutcome> {
  const noOpOutcome: ProjectRunOutcome = { hasFailures: false, hasChangedFiles: false, failedSubtaskTitles: [] };

  if (!prompt.trim()) {
    stream.markdown('Usage: `/project <goal>` — describe what you want to build or accomplish.');
    return noOpOutcome;
  }

  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const constraints = {
    budget: toBudgetMode(configuration.get<string>('budgetMode')),
    speed: toSpeedMode(configuration.get<string>('speedMode')),
  };
  const projectUiConfig = getProjectUiConfig(configuration);

  const approved = prompt.includes(PROJECT_APPROVAL_TOKEN);
  const goal = prompt.replace(PROJECT_APPROVAL_TOKEN, '').trim();
  const planner = new Planner(atlas.modelRouter, atlas.providerRegistry, new TaskProfiler());
  const runStartedAt = new Date().toISOString();
  const baselineSnapshot = await createWorkspaceSnapshot();
  let lastImpactSnapshot = baselineSnapshot;
  let impactReporting = Promise.resolve();
  const fileAttribution = new Map<string, Set<string>>();

  // Preview plan and estimate impact before execution.
  const preview = await planner.plan(goal, constraints);
  const estimatedFiles = estimateTouchedFiles(
    preview.subTasks.length,
    projectUiConfig.estimatedFilesPerSubtask,
  );
  stream.markdown(
    `### Preview\n\n` +
    `Estimated files to touch: **~${estimatedFiles}**\n\n` +
    `Execution policy: **tests first where behavior changes**. Atlas will try to follow a red-green-refactor loop autonomously and report the verification evidence it found.\n\n`,
  );

  // Cost estimation
  const costEstimate = atlas.orchestrator.estimateProjectCost(preview.subTasks.length, constraints);
  if (costEstimate.highUsd > 0) {
    stream.markdown(
      `Estimated cost: **${formatCost(costEstimate.lowUsd, 4)} – ${formatCost(costEstimate.highUsd, 4)}**\n\n`,
    );
  }

  stream.markdown(
    `| ID | Title | Role | Depends on |\n|---|---|---|---|\n` +
    preview.subTasks
      .map(t => `| ${t.id} | ${t.title} | ${t.role} | ${t.dependsOn.join(', ') || '-'} |`)
      .join('\n'),
  );

  if (estimatedFiles > projectUiConfig.approvalFileThreshold && !approved) {
    stream.markdown(
      `\n\n\u26a0\ufe0f **Approval required**: this project is estimated to modify **~${estimatedFiles} files**, ` +
      `which exceeds the safety threshold of ${projectUiConfig.approvalFileThreshold}. ` +
      `This gate exists to prevent unreviewed large-scale changes — you can adjust it in ` +
      `AtlasMind Settings → Advanced → Approval Threshold.\n\n` +
      `Re-run with \`${PROJECT_APPROVAL_TOKEN}\` to proceed.`,
    );
    stream.button({
      command: 'atlasmind.showCostSummary',
      title: 'Show Cost Summary',
      tooltip: 'Review current session cost before approving a large run.',
    });
    return noOpOutcome;
  }

  stream.progress('Planning project...');

  const failedSubtaskTitles: string[] = [];
  const pausedSubtasks: Array<{ title: string; suggestedIterationLimit?: number; suggestedToolCallsPerTurnLimit?: number }> = [];

  const onProgress = (update: ProjectProgressUpdate): void => {
    if (token.isCancellationRequested) { return; }

    switch (update.type) {
      case 'planned': {
        const rows = update.plan.subTasks.map(
          t => `| ${t.id} | ${t.title} | ${t.role} | ${t.dependsOn.join(', ') || '\u2014'} |`,
        );
        stream.markdown(
          `### Plan: ${update.plan.subTasks.length} subtask(s)\n\n` +
          `| ID | Title | Role | Depends on |\n|---|---|---|---|\n` +
          rows.join('\n') + '\n',
        );
        break;
      }
      case 'batch-start':
        stream.progress(
          `Batch ${update.batchIndex}/${update.totalBatches}: ${update.batchSize} subtask(s) running in parallel`,
        );
        break;
      case 'subtask-start':
        stream.progress(`Running: ${update.title}`);
        break;
      case 'subtask-done': {
        const r = update.result;
        const icon = r.status === 'completed'
          ? '\u2705'
          : r.status === 'needs-input'
            ? '\u23f8\ufe0f'
            : '\u274c';
        let body: string;
        if (r.status === 'completed') {
          body = r.output.slice(0, 400) + (r.output.length > 400 ? '\u2026' : '');
        } else if (r.status === 'needs-input') {
          const raiseHint = typeof r.suggestedIterationLimit === 'number'
            ? ` Raise the tool-iteration limit to **${r.suggestedIterationLimit}** to resume.`
            : '';
          body = `*Paused \u2014 reached the agentic safety limit before finishing.*${raiseHint}`;
        } else {
          body = `*Error: ${r.error ?? 'unknown'}*`;
        }
        stream.markdown(
          `${icon} **${r.title}** \u2014 ${update.completed}/${update.total} ` +
          `(${r.durationMs}ms, ${formatCost(r.costUsd, 4)})\n\n${body}\n\n---\n`,
        );
        if (r.status === 'failed') {
          failedSubtaskTitles.push(r.title);
        } else if (r.status === 'needs-input') {
          pausedSubtasks.push({
            title: r.title,
            ...(typeof r.suggestedIterationLimit === 'number' ? { suggestedIterationLimit: r.suggestedIterationLimit } : {}),
            ...(typeof r.suggestedToolCallsPerTurnLimit === 'number' ? { suggestedToolCallsPerTurnLimit: r.suggestedToolCallsPerTurnLimit } : {}),
          });
        }
        impactReporting = impactReporting.then(async () => {
          const impact = await collectWorkspaceChangesSince(lastImpactSnapshot);
          lastImpactSnapshot = impact.snapshot;
          const changedFiles = impact.changedFiles;
          if (token.isCancellationRequested || changedFiles.length === 0) {
            return;
          }

          addFileAttribution(fileAttribution, r.title, changedFiles);

          const summary = summarizeChangedFiles(changedFiles);
          stream.markdown(
            `_Subtask file impact: ${changedFiles.length} changed file(s)` +
            ` (${summary})_`,
          );
        });
        break;
      }
      case 'synthesizing':
        stream.progress('Synthesizing results...');
        break;
      case 'error':
        stream.markdown(`\u274c **Planning error:** ${update.message}`);
        break;
    }
  };

  const abortController = new AbortController();
  const cancelDisposable = token.onCancellationRequested(() => abortController.abort());

  try {
    const result = await atlas.orchestrator.processProject(
      goal,
      constraints,
      onProgress,
      {
        planOverride: preview,
        signal: abortController.signal,
        sessionContextBundle,
        sessionContext,
      },
    );
    cancelDisposable.dispose();
    await impactReporting;
    const changedFiles = (await collectWorkspaceChangesSince(baselineSnapshot)).changedFiles;
    const report = buildProjectRunSummary(result, changedFiles, fileAttribution, runStartedAt);
    const reportUri = await writeProjectRunSummaryReport(report, projectUiConfig.runReportFolder);

    stream.markdown(`## Project Report\n\n${result.synthesis}`);
    stream.markdown(
      `\n\n---\n*${result.subTaskResults.length} subtask(s) \u00b7 ` +
      `${(result.totalDurationMs / 1000).toFixed(1)}s \u00b7 ` +
      `${formatCostAdaptive(result.totalCostUsd)} \u00b7 ` +
      `${result.totalInputTokens.toLocaleString()} in / ${result.totalOutputTokens.toLocaleString()} out*`,
    );

    // One or more subtasks paused at the agentic safety cap rather than failing.
    // Surface the choice the user actually has \u2014 raise the limit (once or
    // permanently) and re-run, or skip \u2014 instead of letting the run end silently.
    if (pausedSubtasks.length > 0) {
      const suggested = pausedSubtasks
        .map(p => p.suggestedIterationLimit)
        .filter((v): v is number => typeof v === 'number')
        .reduce((max, v) => Math.max(max, v), 0);
      const titles = pausedSubtasks.map(p => `**${p.title}**`).join(', ');
      stream.markdown(
        `\n\n### \u23f8\ufe0f Paused \u2014 tool-iteration limit reached\n\n` +
        `${pausedSubtasks.length} subtask(s) stopped at the agentic safety cap (\`maxToolIterations\`) ` +
        `before finishing: ${titles}. The run did **not** fail \u2014 it is waiting on your decision:\n\n` +
        (suggested > 0
          ? `- **Raise permanently** to \`${suggested}\` in Settings, then re-run \`/project\` to resume.\n` +
            `- **Raise once** by re-running \`/project\` after temporarily bumping the limit.\n`
          : `- **Raise** \`maxToolIterations\` in Settings, then re-run \`/project\` to resume.\n`) +
        `- **Skip** these subtasks and accept the partial result above.\n`,
      );
      stream.button({
        command: 'workbench.action.openSettings',
        title: suggested > 0 ? `Raise max tool iterations (suggested: ${suggested})` : 'Open tool-iteration limit setting',
        arguments: ['atlasmind.maxToolIterations'],
        tooltip: 'Open the maxToolIterations setting so you can raise the agentic safety cap, then re-run /project to resume.',
      });
    }

    if (changedFiles.length > 0) {
      stream.markdown(
        `\n\n### Changed Files\n\n` +
        `${changedFiles.length} file(s) changed since the project started ` +
        `(${summarizeChangedFiles(changedFiles)}).`,
      );

      // Diff preview table
      const diffRows = changedFiles.slice(0, projectUiConfig.changedFileReferenceLimit).map(file => {
        return `| \`${file.relativePath}\` | ${file.status} |`;
      });
      stream.markdown(
        `\n\n| File | Status |\n|---|---|\n${diffRows.join('\n')}\n`,
      );

      for (const file of changedFiles.slice(0, projectUiConfig.changedFileReferenceLimit)) {
        if (file.uri) {
          const referenceUri = 'scheme' in file.uri
            ? file.uri as vscode.Uri
            : vscode.Uri.file(file.uri.fsPath);
          stream.reference(referenceUri);
        }
      }

      stream.button({
        command: 'workbench.view.scm',
        title: 'Open Source Control',
        tooltip: 'View all diffs in the Source Control panel.',
      });
    }
    if (reportUri) {
      stream.markdown(`\n\nProject run summary saved to **${vscode.workspace.asRelativePath(reportUri, false)}**.`);
      stream.reference(reportUri);
      stream.button({
        command: 'vscode.open',
        title: 'Open Run Summary',
        arguments: [reportUri],
        tooltip: 'Open the JSON report for this /project execution.',
      });
    }
    const reportPath = reportUri ? vscode.workspace.asRelativePath(reportUri, false) : undefined;
    const subTaskArtifacts = buildProjectRunSubTaskArtifacts(result.subTaskResults);
    await atlas.projectRunHistory.upsertRun({
      id: result.id,
      title: goal.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Project run',
      goal,
      status: (failedSubtaskTitles.length > 0 || pausedSubtasks.length > 0) ? 'failed' : 'completed',
      createdAt: runStartedAt,
      updatedAt: new Date().toISOString(),
      estimatedFiles,
      requiresApproval: estimatedFiles > projectUiConfig.approvalFileThreshold,
      planSubtaskCount: preview.subTasks.length,
      completedSubtaskCount: result.subTaskResults.filter(item => item.status === 'completed').length,
      totalSubtaskCount: result.subTaskResults.length,
      currentBatch: 0,
      totalBatches: 0,
      failedSubtaskTitles: [...failedSubtaskTitles],
      plan: preview,
      subTaskArtifacts,
      requireBatchApproval: false,
      paused: pausedSubtasks.length > 0,
      awaitingBatchApproval: false,
      reportPath,
      summary: report,
      executionOptions: {
        autonomousMode: true,
        requireBatchApproval: false,
        mirrorProgressToChat: true,
        injectOutputIntoFollowUp: true,
      },
      logs: [
        {
          timestamp: new Date().toISOString(),
          level: (failedSubtaskTitles.length > 0 || pausedSubtasks.length > 0) ? 'warning' : 'info',
          message: pausedSubtasks.length > 0
            ? `Run paused: ${pausedSubtasks.length} subtask(s) hit the tool-iteration limit and need a decision to resume.${failedSubtaskTitles.length > 0 ? ` ${failedSubtaskTitles.length} subtask(s) also failed.` : ''}`
            : failedSubtaskTitles.length > 0
              ? `Run completed with ${failedSubtaskTitles.length} failed subtask(s).`
              : 'Run completed successfully.',
        },
      ],
    });
    atlas.projectRunsRefresh.fire();
    if (!token.isCancellationRequested) {
      atlas.sessionConversation.recordTurn(goal, result.synthesis, sessionId, buildProjectResponseMetadata(goal, result));
    }
    stream.button({
      command: 'atlasmind.showCostSummary',
      title: 'Show Cost Summary',
      tooltip: 'Open a quick session cost summary.',
    });
    stream.button({
      command: 'atlasmind.openProjectRunCenter',
      title: 'Open Project Run Center',
      tooltip: 'Review run history and execute the next reviewed project run.',
    });
    stream.button({
      command: 'workbench.action.tasks.test',
      title: 'Run Tests',
      tooltip: 'Run the test task for this workspace.',
    });
    stream.button({
      command: 'atlasmind.openModelProviders',
      title: 'Manage Providers',
      tooltip: 'Review model/provider settings after execution.',
    });

    if (failedSubtaskTitles.length > 0) {
      stream.markdown(
        `\n\n---\n\u26a0\ufe0f **${failedSubtaskTitles.length} subtask(s) failed:**\n\n` +
        failedSubtaskTitles.map(t => `- ${t}`).join('\n'),
      );
      if (changedFiles.length > 0) {
        stream.markdown(
          `\n_${changedFiles.length} file(s) were modified before the failure. ` +
          `Use Source Control to review or revert the partial changes._`,
        );
        stream.button({
          command: 'workbench.view.scm',
          title: 'View Source Control',
          tooltip: 'Review and revert changes made by the partial run.',
        });
      }
    }

    return {
      hasFailures: failedSubtaskTitles.length > 0,
      hasChangedFiles: changedFiles.length > 0,
      failedSubtaskTitles,
    };
  } catch (err) {
    cancelDisposable.dispose();
    const errMsg = err instanceof Error ? err.message : String(err);
    if (err instanceof Error && err.name === 'AbortError') {
      stream.markdown('_Project run cancelled._');
    } else {
      stream.markdown(`\u274c **Project execution failed:** ${errMsg}`);
    }
    return { hasFailures: true, hasChangedFiles: false, failedSubtaskTitles: ['Project execution failed'] };
  }
}

async function handleShipCommand(
  prompt: string,
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    stream.markdown('Open a workspace folder first, then run `/ship` again.');
    return;
  }

  // Resolve routine: named ID in prompt takes precedence, else default.
  const routineId = prompt.trim();
  const routine = routineId
    ? atlas.routineRegistry.get(routineId)
    : atlas.routineRegistry.getDefault();

  if (!routine) {
    const available = atlas.routineRegistry.list();
    if (available.length === 0) {
      stream.markdown(
        '### No routines found\n\n' +
        'Create a routine file in `project_memory/routines/` to get started.\n\n' +
        'See `project_memory/routines/README.md` for the file format.',
      );
    } else {
      const list = available.map(r => `- \`${r.id}\` — ${r.name}`).join('\n');
      stream.markdown(`Routine \`${routineId}\` not found. Available routines:\n\n${list}`);
    }
    return;
  }

  // Extract commit message from prompt if present (text after routine ID, or full prompt when no ID).
  const vars: Record<string, string> = {};
  const messageMatch = prompt.match(/(?:^|\S+\s+)(.*)/);
  if (messageMatch?.[1]) {
    vars['message'] = messageMatch[1].trim();
  }

  stream.markdown(`### ${routine.name}\n\n${routine.description}\n\n`);

  const lines: string[] = [];
  const { RoutineRunner } = await import('../core/routineRunner.js');
  const runner = new RoutineRunner(atlas.projectRunHistory);

  const result = await runner.run(
    routine,
    vars,
    workspaceRoot,
    (step, index, total) => {
      lines.push(`- ⏳ **Step ${index + 1}/${total}:** ${step.label}`);
      stream.markdown(lines.join('\n'));
    },
    async (step, stepResult) => {
      stream.markdown(
        `\n\n**Step failed:** ${step.label}\n\n` +
        `\`\`\`\n${stepResult.stderr || stepResult.stdout || 'No output'}\n\`\`\`\n\n` +
        'The step is configured to stop on failure.',
      );
      return 'abort';
    },
  );

  // Replace pending indicators with final status
  const finalLines = result.steps.map((s, i) => {
    const icon = s.skipped ? '⏭️' : s.exitCode === 0 ? '✅' : '❌';
    return `- ${icon} **Step ${i + 1}/${result.steps.length}:** ${s.label}`;
  });
  stream.markdown(finalLines.join('\n'));

  if (result.succeeded) {
    stream.markdown('\n\n**Routine completed successfully.**');
  } else {
    const failedStep = result.steps.find(s => s.stepId === result.failedStep);
    stream.markdown(
      `\n\n**Routine aborted at step:** ${failedStep?.label ?? result.failedStep}\n\n` +
      (failedStep?.stderr ? `\`\`\`\n${failedStep.stderr}\n\`\`\`` : ''),
    );
  }

  atlas.routinesRefresh.fire();
}

async function handleRunsCommand(stream: vscode.ChatResponseStream): Promise<void> {
  stream.markdown(
    '### Project Run Center\n\n' +
    'Open the Project Run Center to preview a goal before execution, inspect durable run history, ' +
    'and review changed files or reports from earlier project runs.',
  );
  stream.button({
    command: 'atlasmind.openProjectRunCenter',
    title: 'Open Project Run Center',
    tooltip: 'Open the review/apply and run-history panel.',
  });
}

async function handleAgentsCommand(
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const agents = atlas.agentRegistry.listAgents();
  if (agents.length === 0) {
    stream.markdown('No agents registered yet. Use the sidebar to add agents.');
    return;
  }
  const lines = agents.map(a => `- **${a.name}** \u2013 ${a.role}`);
  stream.markdown(`### Registered Agents\n\n${lines.join('\n')}`);
}

async function handleBootstrapCommand(
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    stream.markdown('Open a workspace folder first, then run `/bootstrap` again.');
    return;
  }

  const { bootstrapProject } = await import('../bootstrap/bootstrapper.js');
  await bootstrapProject(workspaceFolder.uri, atlas);
  stream.markdown('Bootstrap completed. AtlasMind also offered governance baseline scaffolding for this project.');
}

async function handleImportCommand(
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    stream.markdown('Open a workspace folder first, then run `/import` again.');
    return;
  }

  stream.markdown('Scanning project files and populating memory…\n\n');

  const { importProject } = await import('../bootstrap/bootstrapper.js');
  const result = await importProject(workspaceFolder.uri, atlas);

  const lines: string[] = [];
  lines.push(`### Project Import Complete\n`);
  if (result.projectType) {
    lines.push(`**Detected type**: ${result.projectType}\n`);
  }
  lines.push(`- **${result.entriesCreated}** memory entries created`);
  lines.push(`- **${result.entriesSkipped}** entries skipped (duplicate or rejected)\n`);
  lines.push('The SSOT memory is now populated. Use `/memory` to query it, or ask `@atlas` a question about the project.');

  stream.markdown(lines.join('\n'));
}

async function handleSkillsCommand(
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const skills = atlas.skillsRegistry.listSkills();
  if (skills.length === 0) {
    stream.markdown('No skills registered yet.');
    return;
  }
  const lines = skills.map(s => `- **${s.name}** \u2013 ${s.description}`);
  stream.markdown(`### Registered Skills\n\n${lines.join('\n')}`);
}

async function handleCostCommand(
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const summary = atlas.costTracker.getSummary();
  stream.markdown(
    `### Session Cost Summary\n\n` +
    `| Metric | Value |\n|---|---|\n` +
    `| Total cost | ${formatCostAdaptive(summary.totalCostUsd)} |\n` +
    `| Requests | ${summary.totalRequests} |\n` +
    `| Input tokens | ${summary.totalInputTokens.toLocaleString()} |\n` +
    `| Output tokens | ${summary.totalOutputTokens.toLocaleString()} |`,
  );
}

async function handleFreeformMessage(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
  sessionId: string,
): Promise<void> {
  const prompt = request.prompt;
  const roadmapStatusMarkdown = await buildRoadmapStatusMarkdown(prompt);
  if (roadmapStatusMarkdown) {
    stream.markdown(roadmapStatusMarkdown);
    return;
  }
  if (await handleRoutineEditIntent(prompt, stream, atlas)) {
    return;
  }
  const imageAttachments = await resolveInlineImageAttachments(prompt);
  await runChatTask(prompt, stream, atlas, imageAttachments, sessionId);
}

/**
 * Detects "edit/update/change the [X] routine" intent and opens the matching
 * routine file in the VS Code editor so the user can modify it directly.
 * Returns true if the intent was handled (caller should return early).
 */
async function handleRoutineEditIntent(
  prompt: string,
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<boolean> {
  if (!ROUTINE_EDIT_PATTERN.test(prompt)) { return false; }

  const routines = atlas.routineRegistry.list();
  if (routines.length === 0) {
    stream.markdown(
      'No routines found in `project_memory/routines/`.\n\n' +
      'Run `@atlas /import` to scaffold a routine from your project instructions, ' +
      'or create a routine file manually (see `project_memory/routines/README.md` for the format).',
    );
    return true;
  }

  // Find the best matching routine: check if any routine name or ID appears in the prompt
  let target = routines.find(r => {
    const idPattern = new RegExp(`\\b${r.id.replace(/-/g, '[\\s-]')}\\b`, 'i');
    const namePattern = new RegExp(`\\b${r.name.replace(/\s+/g, '\\s+')}\\b`, 'i');
    return idPattern.test(prompt) || namePattern.test(prompt);
  });
  if (!target) { target = atlas.routineRegistry.getDefault() ?? routines[0]; }

  if (!target.source) {
    stream.markdown(
      `Routine **${target.name}** has no source file path. ` +
      'It may be a built-in routine — create a file in `project_memory/routines/` to override it.',
    );
    return true;
  }

  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target.source));
    await vscode.window.showTextDocument(doc);
    stream.markdown(
      `Opened **${target.name}** for editing.\n\n` +
      `File: \`${target.source}\`\n\n` +
      'Edit the YAML steps and save. The routine will be picked up automatically on the next `/ship` run.',
    );
  } catch {
    stream.markdown(
      `Could not open \`${target.source}\`. ` +
      'The file may have been moved or deleted. Run `@atlas /import` to re-scaffold it.',
    );
  }

  return true;
}

async function handleVisionCommand(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
  sessionId: string,
): Promise<void> {
  const selectedAttachments = await pickImageAttachments();
  if (selectedAttachments.length === 0) {
    stream.markdown('No images were selected. Run `/vision` again and choose one or more workspace images.');
    return;
  }

  stream.markdown(
    `### Attached Images\n\n${selectedAttachments.map(image => `- ${image.source}`).join('\n')}`,
  );

  const prompt = request.prompt.trim().length > 0
    ? request.prompt.trim()
    : 'Describe the attached images and highlight anything important.';

  await runChatTask(prompt, stream, atlas, selectedAttachments, sessionId);
}

async function runChatTask(
  prompt: string,
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
  explicitAttachments: TaskImageAttachment[] = [],
  sessionId?: string,
): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const sessionContext = atlas.sessionConversation.buildContext({
    maxTurns: configuration.get<number>('chatSessionTurnLimit', 6),
    maxChars: configuration.get<number>('chatSessionContextChars', 2500),
    ...(sessionId ? { sessionId } : {}),
  });
  const workstationContext = buildWorkstationContext();
  const inlineAttachments = explicitAttachments.length > 0 ? [] : await resolveInlineImageAttachments(prompt);
  const imageAttachments = mergeImageAttachments(explicitAttachments, inlineAttachments);
  const operatorAdaptation = await applyOperatorFrustrationAdaptation(prompt, atlas, { sessionContext });
  let streamedText = '';
  const chunkBuffer = createStreamBuffer(stream);
  const result = await atlas.orchestrator.processTask({
    id: `task-${Date.now()}`,
    userMessage: prompt,
    context: {
      ...(sessionContext ? { sessionContext } : {}),
      ...(workstationContext ? { workstationContext } : {}),
      ...(imageAttachments.length > 0 ? { imageAttachments } : {}),
      ...(operatorAdaptation?.contextPatch ?? {}),
    },
    constraints: {
      budget: toBudgetMode(configuration.get<string>('budgetMode')),
      speed: toSpeedMode(configuration.get<string>('speedMode')),
      ...(imageAttachments.length > 0 ? { requiredCapabilities: ['vision' as const] } : {}),
    },
    timestamp: new Date().toISOString(),
  }, chunk => {
    if (!chunk) {
      return;
    }
    streamedText += chunk;
    chunkBuffer.push(chunk);
  });
  chunkBuffer.flush();

  const reconciled = reconcileAssistantResponse(streamedText, result.response);
  if (reconciled.additionalText) {
    writeMarkdownChunk(stream, reconciled.additionalText, 'chat task completion');
  }
  const assistantMeta = buildAssistantResponseMetadata(prompt, result, {
    hasSessionContext: Boolean(sessionContext),
    imageAttachments,
    routingContext: {
      ...(sessionContext ? { sessionContext } : {}),
      ...(operatorAdaptation?.contextPatch ?? {}),
    },
    policies: [
      ...atlas.getWorkspacePolicySnapshots(),
      ...(operatorAdaptation?.policySnapshot ? [operatorAdaptation.policySnapshot] : []),
    ],
  });
  stream.markdown(renderAssistantResponseFooter(assistantMeta));
  atlas.sessionConversation.recordTurn(prompt, reconciled.transcriptText, sessionId, assistantMeta);

  // If TTS auto-speak is enabled, forward the response to the voice manager.
  if (configuration.get<boolean>('voice.ttsEnabled', false)) {
    atlas.voiceManager.speak(reconciled.transcriptText);
  }
}

export function reconcileAssistantResponse(
  streamedText: string,
  finalResponse: string,
): AssistantResponseReconciliation {
  if (!streamedText) {
    return {
      additionalText: sanitizeResponseTail(finalResponse),
      transcriptText: sanitizeResponseTail(finalResponse),
    };
  }

  if (!finalResponse) {
    return {
      additionalText: '',
      transcriptText: sanitizeResponseTail(streamedText),
    };
  }

  if (streamedText === finalResponse || streamedText.trim() === finalResponse.trim()) {
    return {
      additionalText: '',
      transcriptText: sanitizeResponseTail(finalResponse),
    };
  }

  if (finalResponse.startsWith(streamedText)) {
    const sanitized = sanitizeResponseTail(finalResponse);
    return {
      additionalText: sanitized.slice(streamedText.length),
      transcriptText: sanitized,
    };
  }

  const joined = sanitizeResponseTail(joinAssistantResponseSegments(streamedText, finalResponse));
  return {
    additionalText: joined.slice(streamedText.length),
    transcriptText: joined,
  };
}

/**
 * Removes structurally malformed tails from a model response before it enters
 * the session transcript.  Two cases:
 * - An unclosed code fence: close it so the next turn doesn't parse stale code.
 * - A lone section header at the very end with no body: strip it rather than
 *   leave an empty heading that confuses subsequent context assembly.
 */
export function sanitizeResponseTail(text: string): string {
  if (!text) {
    return text;
  }
  let result = text;

  // Close any unclosed fenced code block.
  const fenceCount = (result.match(/^```/mg) ?? []).length;
  if (fenceCount % 2 !== 0) {
    result = result.trimEnd() + '\n```';
  }

  // Strip a trailing bare section header (heading line with nothing after it).
  result = result.replace(/\n(#{1,6}\s+[^\n]+)\n?\s*$/, (_, header) => {
    // Keep the header only if there is non-whitespace content after it — i.e.,
    // the regex matched because the header is the last non-empty line.  We
    // unconditionally drop it here to remove the dangling heading.
    void header;
    return '';
  });

  return result;
}

export function ensureAssistantVisibleResponse(
  transcriptText: string,
  metadata: SessionTranscriptMetadata | undefined,
): string {
  if (transcriptText.trim().length > 0) {
    return transcriptText;
  }

  const followupQuestion = metadata?.followupQuestion?.trim();
  if (followupQuestion) {
    return `${followupQuestion}\n\nSay "Proceed" to continue, or pick a follow-up option below.`;
  }

  const thoughtSummary = metadata?.thoughtSummary?.summary?.trim();
  // Only surface the thought summary as a continuation hint when it describes meaningful
  // work (tool calls, model reasoning, etc.). The generic "Answered from context" summary
  // means the model returned nothing useful — show an honest diagnostic instead of
  // presenting internal metadata as if it were an actual answer.
  if (thoughtSummary && !/^Answered from context/i.test(thoughtSummary)) {
    return `${thoughtSummary}\n\nSay "Proceed" to continue, or tell Atlas what to do next.`;
  }

  // Last-resort fallback — the orchestrator should have already generated a targeted
  // clarifying question, so this only fires if that call also failed.
  return 'Could you share more details about what you\'d like me to do? Providing relevant files, error messages, or examples would help.';
}

function joinAssistantResponseSegments(streamedText: string, finalResponse: string): string {
  if (!streamedText) {
    return finalResponse;
  }
  if (!finalResponse) {
    return streamedText;
  }

  const needsSeparator = !/[\s\n]$/.test(streamedText) && !/^[\s\n]/.test(finalResponse);
  return `${streamedText}${needsSeparator ? '\n\n' : ''}${finalResponse}`;
}

function writeMarkdownChunk(
  stream: Pick<vscode.ChatResponseStream, 'markdown'>,
  text: string,
  context: string,
): void {
  if (!text) {
    return;
  }

  try {
    stream.markdown(text);
  } catch (error) {
    console.error(`[AtlasMind] Failed to write ${context}.`, error);
  }
}

/**
 * Batches streaming token chunks and flushes to stream.markdown() at a fixed
 * interval instead of on every token. Reduces the extension-host→renderer IPC
 * call rate by up to 50×, which prevents the extension host from starving
 * VS Code's own event loop during long streaming responses.
 */
function createStreamBuffer(
  stream: Pick<vscode.ChatResponseStream, 'markdown'>,
  intervalMs = 50,
): { push: (chunk: string) => void; flush: () => void } {
  let pending = '';
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending) {
      try { stream.markdown(pending); } catch { /* ignore */ }
      pending = '';
    }
  };

  return {
    push(chunk: string): void {
      pending += chunk;
      if (timer === null) {
        timer = setTimeout(flush, intervalMs);
      }
    },
    flush,
  };
}

async function handleVoiceCommand(
  stream: vscode.ChatResponseStream,
): Promise<void> {
  stream.markdown(
    '### Voice Panel\n\n' +
    'The Voice Panel provides **Text-to-Speech** (TTS) and **Speech-to-Text** (STT) ' +
    'via the browser Web Speech API — no external API key required.\n\n' +
    '| Feature | Description |\n|---|---|\n' +
    '| 🎙️ STT | Click **Start Listening** to dictate; final transcript is sent back to the extension. |\n' +
    '| 🔊 TTS | Type text and click **Speak**, or enable auto-speak in Settings to hear @atlas responses. |\n' +
    '| ⚙️ Settings | Rate, pitch, volume, and language are configurable in the panel. |\n\n' +
    '**Quick settings (in VS Code Settings):**\n' +
    '- `atlasmind.voice.ttsEnabled` — auto-speak @atlas freeform responses\n' +
    '- `atlasmind.voice.rate` — speech rate (0.5–2.0)\n',
  );
  stream.button({ command: 'atlasmind.openVoicePanel', title: '🎙️ Open Voice Panel' });
}

function labelToolCall(toolName: string): string {
  const n = toolName.toLowerCase();
  if (n.includes('file-read') || n.includes('file_read') || n === 'file-read') return 'read';
  if (n.includes('file-write') || n.includes('file_write')) return 'wrote';
  if (n.includes('file-edit') || n.includes('file_edit') || n.includes('-edit')) return 'edited';
  if (n.includes('file-search') || n.includes('file_search')) return 'searched';
  if (n.includes('glob') || n.includes('grep')) return 'searched';
  if (n.includes('terminal') || n.includes('command') || n.includes('shell') || n.includes('-run')) return 'ran commands';
  if (n.includes('memory') || n.includes('ssot') || n.includes('memory-query')) return 'queried memory';
  if (n.includes('git')) return 'git ops';
  if (n.includes('web') || n.includes('fetch') || n.includes('http')) return 'fetched URLs';
  return toolName;
}

function summarizeToolActionsForDisplay(toolCalls: Array<{ toolName: string }>): string {
  const groups: Record<string, number> = {};
  for (const call of toolCalls) {
    const label = labelToolCall(call.toolName);
    groups[label] = (groups[label] ?? 0) + 1;
  }
  return Object.entries(groups)
    .map(([label, count]) => count > 1 ? `${label} ×${count}` : label)
    .join(', ');
}

/**
 * Inspect the final sentence of a response and, if it ends with a "?", produce
 * quick-reply pill options that the user can click to respond in one tap.
 *
 * Detection is intentionally conservative: we only recognise well-known question
 * shapes so we don't accidentally generate buttons on rhetorical questions.
 */
export function detectResponseQuickReplies(responseText: string): {
  followupQuestion: string;
  quickReplies?: SessionSuggestedFollowup[];
} | undefined {
  const match = RESPONSE_TRAILING_QUESTION_PATTERN.exec(responseText.trim());
  if (!match?.[1]) { return undefined; }
  const question = match[1].trim();

  // Yes / No — confirmatory questions
  const isYesNo = /^\s*(?:(?:want|would\s+you\s+(?:like)?|shall\s+i|should\s+i|do\s+you\s+want|can\s+i|may\s+i|ready|proceed)\s+|(?:is\s+that|does\s+that|does\s+this|are\s+you)\s+)/i.test(question);
  if (isYesNo) {
    return {
      followupQuestion: question,
      quickReplies: [
        { label: 'Yes', prompt: 'yes' },
        { label: 'No', prompt: 'no' },
      ],
    };
  }

  // Enumerated list — "…: A, B, or C?" style questions (3–4 options). Checked
  // before the 2-option case so triage answers ("work on X, Y, or Z?") become a
  // clickable pick-one list instead of falling through to a plain text input.
  {
    const optionSegment = question.replace(/\?+\s*$/, '').split(/[:：]/).pop()?.trim() ?? '';
    if (/,/.test(optionSegment) && /\bor\b/i.test(optionSegment)) {
      const rawParts = optionSegment.split(/\s*,\s*|\s+\bor\b\s+/i).map(part => part.trim()).filter(Boolean);
      const cleaned = rawParts
        .map(part => part.replace(/^(?:should\s+i|shall\s+i|do\s+you\s+(?:want|prefer)|would\s+you\s+(?:like|prefer)|either|and|or)\s+/i, '').trim())
        .filter(part => part.length >= 2 && part.length <= 40 && !/[.!?]$/.test(part));
      if (cleaned.length >= 3 && cleaned.length <= 4 && cleaned.length === rawParts.length) {
        return {
          followupQuestion: question,
          quickReplies: cleaned.map(opt => ({ label: opt.charAt(0).toUpperCase() + opt.slice(1), prompt: opt })),
        };
      }
    }
  }

  // A or B — extract option labels from "X or Y?" patterns (max 2 options, labels ≤ 40 chars each)
  const orMatch = /\b(.{3,40}?)\s+or\s+(.{3,40}?)\?[\s]*$/.exec(question);
  if (orMatch?.[1] && orMatch[2]) {
    const optA = orMatch[1].replace(/^(?:should\s+i|shall\s+i|do\s+you\s+(?:want|prefer)|would\s+you\s+(?:like|prefer))\s+/i, '').trim();
    const optB = orMatch[2].trim();
    if (optA.length >= 2 && optA.length <= 40 && optB.length >= 2 && optB.length <= 40) {
      return {
        followupQuestion: question,
        quickReplies: [
          { label: optA.charAt(0).toUpperCase() + optA.slice(1), prompt: optA },
          { label: optB.charAt(0).toUpperCase() + optB.slice(1), prompt: optB },
        ],
      };
    }
  }

  // Generic — question detected but no clean options: surface text input only (no pills)
  return { followupQuestion: question };
}

export function buildAssistantResponseMetadata(
  prompt: string,
  result: Pick<TaskResult, 'agentId' | 'modelUsed' | 'costUsd' | 'inputTokens' | 'outputTokens' | 'artifacts' | 'contextCompressionSavingsUsd'>,
  options?: { hasSessionContext?: boolean; imageAttachments?: TaskImageAttachment[]; routingContext?: Record<string, unknown>; policies?: SessionPolicySnapshot[]; responseText?: string },
): SessionTranscriptMetadata {
  const toolCallCount = result.artifacts?.toolCallCount ?? 0;
  const toolCalls = result.artifacts?.toolCalls ?? [];

  // Build a concise, action-oriented summary line.
  let summary: string;
  if (toolCallCount > 0) {
    const actionSummary = toolCalls.length > 0 ? summarizeToolActionsForDisplay(toolCalls) : '';
    summary = actionSummary
      ? `Used ${toolCallCount} tool call${toolCallCount === 1 ? '' : 's'} — ${actionSummary}.`
      : `Used ${toolCallCount} tool call${toolCallCount === 1 ? '' : 's'}.`;
  } else {
    summary = `Answered from context${options?.hasSessionContext ? ' and session history' : ''}.`;
  }

  const bullets: string[] = [];

  // Actions — only include if there were actual tool calls worth surfacing
  if (toolCallCount > 0) {
    const actionDetail = toolCalls.length > 0 ? ` — ${summarizeToolActionsForDisplay(toolCalls)}` : '';
    bullets.push(`${toolCallCount} tool call${toolCallCount === 1 ? '' : 's'}${actionDetail}.`);
  }

  // Context factors
  if (options?.hasSessionContext) {
    bullets.push('Used recent session context.');
  }

  if (shouldBiasTowardWorkspaceInvestigation(prompt, options?.routingContext ?? {})) {
    bullets.push('Workspace investigation applied.');
  }

  if (typeof options?.routingContext?.['userFrustrationSignal'] === 'string') {
    bullets.push('Direct-action mode active.');
  }

  // TDD / verification
  const tddCue = buildThoughtSummaryTddCue(result.artifacts?.tddStatus, result.artifacts?.tddSummary);
  if (tddCue) {
    bullets.push(`Red-to-green: ${tddCue.statusLabel}.`);
    if (result.artifacts?.tddSummary) {
      bullets.push(`TDD evidence: ${result.artifacts.tddSummary}.`);
    }
  }
  if (result.artifacts?.tddStatus === 'missing') {
    bullets.push('⚠️ No test coverage signal recorded for this change — verify manually that the new behaviour is tested and that any test files are visible to the project\'s test runner.');
  }

  if (result.artifacts?.checkpointedTools.length) {
    bullets.push(`Checkpointed: ${result.artifacts.checkpointedTools.join(', ')}.`);
  }

  if (result.artifacts?.verificationSummary) {
    bullets.push(`Verified: ${result.artifacts.verificationSummary}.`);
  }

  if (typeof result.contextCompressionSavingsUsd === 'number' && result.contextCompressionSavingsUsd > 0) {
    bullets.push(`Compression savings: ${formatCost(result.contextCompressionSavingsUsd, 4)}.`);
  }

  // Cost/token detail — kept last; concise so it doesn't dominate the summary
  bullets.push(`${formatCost(result.costUsd, 4)} · ${result.inputTokens.toLocaleString()} in / ${result.outputTokens.toLocaleString()} out`);

  const suggestedFollowups = buildSuggestedExecutionFollowups(prompt, options?.routingContext ?? {});
  const timelineNotes = buildTimelineNotes(options?.routingContext ?? {});

  // Detect quick-reply opportunities from the response text. These take lower
  // priority than the explicit suggestedFollowups (fix/explain/autonomous choices).
  const responseQuickReplies = !suggestedFollowups && options?.responseText
    ? detectResponseQuickReplies(options.responseText)
    : undefined;

  return {
    modelUsed: result.modelUsed,
    ...(options?.policies?.length ? { policies: options.policies.map(policy => ({ ...policy })) } : {}),
    ...(timelineNotes.length ? { timelineNotes } : {}),
    ...(suggestedFollowups
      ? {
        followupQuestion: FOLLOWUP_FIX_QUESTION,
        suggestedFollowups,
      }
      : responseQuickReplies
        ? {
          followupQuestion: responseQuickReplies.followupQuestion,
          ...(responseQuickReplies.quickReplies ? { quickReplies: responseQuickReplies.quickReplies } : {}),
        }
        : {}),
    thoughtSummary: {
      label: 'What Atlas did',
      summary,
      bullets,
      status: tddCue?.status,
      statusLabel: tddCue?.statusLabel,
    },
  };
}

export function buildProjectResponseMetadata(goal: string, result?: Pick<ProjectResult, 'totalInputTokens' | 'totalOutputTokens' | 'totalCostUsd' | 'subTaskResults'>): SessionTranscriptMetadata {
  const bullets: string[] = [
    `Goal: ${truncateForSummary(goal, 120)}.`,
  ];
  if (result) {
    const completedCount = result.subTaskResults.filter(r => r.status === 'completed').length;
    bullets.push(`${completedCount}/${result.subTaskResults.length} subtask(s) completed.`);
    bullets.push(`${formatCost(result.totalCostUsd, 4)} · ${result.totalInputTokens.toLocaleString()} in / ${result.totalOutputTokens.toLocaleString()} out`);
  } else {
    bullets.push('Planner, execution, and synthesis may each pick a different model based on cost, speed, and capability constraints.');
    bullets.push('Open the Project Run Center to inspect per-subtask outputs and execution history.');
  }

  return {
    modelUsed: 'multiple routed models',
    thoughtSummary: {
      label: 'Execution summary',
      summary: result
        ? `Project completed: ${result.subTaskResults.length} subtask(s) executed with autonomous model routing.`
        : 'Autonomous project mode can route planning, sub-agents, and synthesis through different models.',
      bullets,
    },
  };
}

export function renderAssistantResponseFooter(metadata: SessionTranscriptMetadata | undefined): string {
  if (!metadata?.modelUsed && !metadata?.thoughtSummary && !metadata?.followupQuestion && !metadata?.timelineNotes?.length) {
    return '';
  }

  const sections: string[] = [];
  if (metadata.modelUsed) {
    sections.push(`\n\n---\n_Model: ${metadata.modelUsed}_`);
  }

  if (metadata.thoughtSummary) {
    const tddLine = metadata.thoughtSummary.statusLabel
      ? `\n\n**Red-to-green:** ${metadata.thoughtSummary.statusLabel}`
      : '';
    const bulletBlock = metadata.thoughtSummary.bullets.length > 0
      ? `\n\n${metadata.thoughtSummary.bullets.map(item => `- ${item}`).join('\n')}`
      : '';
    sections.push(`\n\n**${metadata.thoughtSummary.label}:** ${metadata.thoughtSummary.summary}${tddLine}${bulletBlock}`);
  }

  if (metadata.followupQuestion) {
    const labels = metadata.suggestedFollowups?.map(item => `- ${item.label}`).join('\n') ?? '';
    sections.push(`\n\n**Next step:** ${metadata.followupQuestion}${labels ? `\n\n${labels}` : ''}`);
  }

  if (metadata.timelineNotes?.length) {
    const notes = metadata.timelineNotes.map(note => `- ${note.label}: ${note.summary}`).join('\n');
    sections.push(`\n\n**Session timeline:**\n${notes}`);
  }

  return sections.join('');
}

function buildTimelineNotes(routingContext: Record<string, unknown>): SessionTimelineNote[] {
  if (typeof routingContext['userFrustrationSignal'] !== 'string') {
    return [];
  }

  return [{
    label: 'Learned from friction',
    summary: 'Atlas updated this workspace session with stronger direct-recovery guidance after the operator signaled frustration on this turn.',
    tone: 'warning',
  }];
}

function buildSuggestedExecutionFollowups(
  prompt: string,
  routingContext: Record<string, unknown>,
): SessionSuggestedFollowup[] | undefined {
  if (!shouldOfferExecutionChoices(prompt, routingContext)) {
    return undefined;
  }

  return [
    {
      label: 'Fix This',
      prompt: 'Fix this issue in the workspace. Make the smallest defensible change, verify it, and summarize what changed.',
    },
    {
      label: 'Explain Only',
      prompt: 'Explain the root cause and the best next step only. Do not make code changes.',
    },
    {
      label: 'Fix Autonomously',
      prompt: 'Fix this issue in the workspace autonomously. Continue through implementation and verification without waiting for another prompt unless you hit a real blocker.',
    },
  ];
}

function shouldOfferExecutionChoices(
  prompt: string,
  routingContext: Record<string, unknown>,
): boolean {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return false;
  }

  if (resolveAtlasChatIntent(trimmed, [])) {
    return false;
  }

  if (isActionableFollowupPrompt(trimmed, routingContext)) {
    return false;
  }

  if (EXPLICIT_FIX_PROMPT_PATTERN.test(trimmed) || EXPLICIT_NO_FIX_PATTERN.test(trimmed)) {
    return false;
  }

  if (!CONCRETE_ISSUE_PROMPT_PATTERN.test(trimmed)) {
    return false;
  }

  return shouldBiasTowardWorkspaceInvestigation(trimmed, routingContext);
}

function isActionableFollowupPrompt(prompt: string, routingContext: Record<string, unknown>): boolean {
  if (isAutonomousContinuationPrompt(prompt)) {
    return true;
  }

  if (DEICTIC_EXECUTION_FOLLOWUP_PATTERN.test(prompt) && shouldBiasTowardWorkspaceInvestigation(prompt, routingContext)) {
    return true;
  }

  return Boolean(detectUserFrustrationSignal(prompt) && shouldBiasTowardWorkspaceInvestigation(prompt, routingContext));
}

export function detectUserFrustrationSignal(prompt: string): UserFrustrationSignal | undefined {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return undefined;
  }

  const cues: Array<{ level: UserFrustrationSignal['level']; pattern: RegExp; matchedCue: string; summary: string; guidance: string }> = [
    {
      level: 'high',
      pattern: /\b(?:frustrat(?:ed|ing)|annoy(?:ed|ing)|useless|stop giving me|just do (?:it|that)|not doing what i ask|doesn'?t want to do|why aren'?t you doing)\b/i,
      matchedCue: 'explicit-frustration',
      summary: 'The operator explicitly signaled frustration with Atlas failing to act.',
      guidance: 'Acknowledge the miss briefly, then move straight to the most concrete safe action instead of repeating advisory prose.',
    },
    {
      level: 'moderate',
      pattern: /\b(?:can you not do (?:this|that|it|them) for me|can you do (?:this|that|it|them) for me|could you do (?:this|that|it|them) for me|i want .* resolved|i want the reason .* resolved|no,? i want|instead of (?:advice|explaining)|not doing what i asked)\b/i,
      matchedCue: 'frustrated-correction',
      summary: 'The operator corrected Atlas toward concrete execution after a disappointing response.',
      guidance: 'Prefer direct execution, recover from the missed expectation immediately, and avoid asking another redundant follow-up question.',
    },
  ];

  const matched = cues.find(cue => cue.pattern.test(trimmed));
  if (!matched) {
    return undefined;
  }

  return {
    level: matched.level,
    matchedCue: matched.matchedCue,
    summary: matched.summary,
    guidance: matched.guidance,
  };
}

export async function applyOperatorFrustrationAdaptation(
  prompt: string,
  atlas: AtlasMindContext,
  routingContext: Record<string, unknown>,
): Promise<{ signal: UserFrustrationSignal; contextPatch: Record<string, unknown>; policySnapshot: SessionPolicySnapshot } | undefined> {
  const signal = detectUserFrustrationSignal(prompt);
  if (!signal) {
    const workspaceState = atlas.extensionContext?.workspaceState;
    if (workspaceState) {
      await maybeCoolFrustrationSettings(workspaceState);
    }
    return undefined;
  }

  await persistFrustrationLearning(atlas, prompt, signal);

  return {
    signal,
    contextPatch: {
      userFrustrationSignal: buildUserFrustrationContextMessage(signal, routingContext),
    },
    policySnapshot: {
      source: 'runtime',
      label: 'Operator friction signal',
      summary: 'The operator sounded frustrated after Atlas failed to act. Recover with a brief acknowledgement, concrete next action, and tool-backed execution when safe.',
    },
  };
}

function buildUserFrustrationContextMessage(signal: UserFrustrationSignal, routingContext: Record<string, unknown>): string {
  const sessionContext = typeof routingContext['sessionContext'] === 'string'
    ? truncateForSummary(routingContext['sessionContext'], 280)
    : '';
  return [
    `Operator frustration signal (${signal.level}): ${signal.summary}`,
    `Recovery guidance: ${signal.guidance}`,
    ...(sessionContext ? [`Recent context: ${sessionContext}`] : []),
  ].join('\n');
}

async function persistFrustrationLearning(atlas: AtlasMindContext, prompt: string, signal: UserFrustrationSignal): Promise<void> {
  const now = new Date().toISOString();
  const workspaceState = atlas.extensionContext.workspaceState;
  const stored = workspaceState.get<unknown>(PROJECT_PERSONALITY_PROFILE_STORAGE_KEY);
  const profile = isStoredPersonalityProfileRecord(stored)
    ? {
        version: 1 as const,
        updatedAt: now,
        answers: { ...stored.answers },
      }
    : {
        version: 1 as const,
        updatedAt: now,
        answers: {},
      };

  profile.answers['defaultActionBias'] = appendLearnedPreference(
    profile.answers['defaultActionBias'],
    'When the operator signals frustration after Atlas failed to act, prefer the most concrete safe tool-backed action over more advice.',
  );
  profile.answers['ambiguityHandling'] = appendLearnedPreference(
    profile.answers['ambiguityHandling'],
    'For terse follow-ups after a miss, infer the intended workspace action from recent session context instead of asking another redundant follow-up question.',
  );
  profile.answers['constraintViolationResponse'] = appendLearnedPreference(
    profile.answers['constraintViolationResponse'],
    'Acknowledge the miss in one sentence, correct course immediately, and do not repeat the same non-actionable explanation.',
  );
  profile.answers['emotionalFraming'] = appendLearnedPreference(
    profile.answers['emotionalFraming'],
    'Stay calm, direct, and non-defensive when the operator is frustrated.',
  );
  profile.answers['rememberLongTerm'] = appendLearnedPreference(
    profile.answers['rememberLongTerm'],
    'Remember when the operator is frustrated by advice instead of execution: bias toward concrete action and stronger carry-forward of recent context.',
  );

  await workspaceState.update(PROJECT_PERSONALITY_PROFILE_STORAGE_KEY, profile);
  await applyFrustrationSettingsTuning(workspaceState);
  await writeFrustrationFeedbackToSsot(atlas, prompt, signal, profile, now);
}

function isStoredPersonalityProfileRecord(value: unknown): value is StoredPersonalityProfileRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return candidate['version'] === 1
    && typeof candidate['updatedAt'] === 'string'
    && typeof candidate['answers'] === 'object'
    && candidate['answers'] !== null;
}

function appendLearnedPreference(existing: unknown, addition: string): string {
  const normalizedAddition = addition.trim();
  const current = typeof existing === 'string' ? existing.trim() : '';
  if (!current) {
    return normalizedAddition;
  }
  if (current.toLowerCase().includes(normalizedAddition.toLowerCase())) {
    return current;
  }
  return `${current}\n- ${normalizedAddition}`;
}

async function applyFrustrationSettingsTuning(workspaceState: vscode.Memento): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const currentTurnLimit = configuration.get<number>('chatSessionTurnLimit', 6) ?? 6;
  const currentContextChars = configuration.get<number>('chatSessionContextChars', 2500) ?? 2500;

  // Save original values before any boost so we can restore them later.
  const existing = workspaceState.get<unknown>(FRUSTRATION_SETTINGS_STORAGE_KEY);
  if (!isFrustrationSettingsSnapshot(existing)) {
    await workspaceState.update(FRUSTRATION_SETTINGS_STORAGE_KEY, {
      originalTurnLimit: currentTurnLimit,
      originalContextChars: currentContextChars,
      lastFrustrationAt: new Date().toISOString(),
    } satisfies FrustrationSettingsSnapshot);
  } else {
    await workspaceState.update(FRUSTRATION_SETTINGS_STORAGE_KEY, {
      ...existing,
      lastFrustrationAt: new Date().toISOString(),
    } satisfies FrustrationSettingsSnapshot);
  }

  if (currentTurnLimit < MIN_FRUSTRATION_SESSION_TURNS) {
    await configuration.update('chatSessionTurnLimit', MIN_FRUSTRATION_SESSION_TURNS, vscode.ConfigurationTarget.Workspace);
  }

  if (currentContextChars < MIN_FRUSTRATION_SESSION_CHARS) {
    await configuration.update('chatSessionContextChars', MIN_FRUSTRATION_SESSION_CHARS, vscode.ConfigurationTarget.Workspace);
  }
}

async function maybeCoolFrustrationSettings(workspaceState: vscode.Memento): Promise<void> {
  const stored = workspaceState.get<unknown>(FRUSTRATION_SETTINGS_STORAGE_KEY);
  if (!isFrustrationSettingsSnapshot(stored)) {
    return;
  }

  const msSinceFrustration = Date.now() - new Date(stored.lastFrustrationAt).getTime();
  if (msSinceFrustration < FRUSTRATION_COOLING_PERIOD_MS) {
    return;
  }

  // Cooling period elapsed: restore original values — but only if they still
  // equal what we boosted them to (so a user's manual change is not overwritten).
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const currentTurnLimit = configuration.get<number>('chatSessionTurnLimit', 6) ?? 6;
  const currentContextChars = configuration.get<number>('chatSessionContextChars', 2500) ?? 2500;

  if (currentTurnLimit === MIN_FRUSTRATION_SESSION_TURNS && stored.originalTurnLimit < MIN_FRUSTRATION_SESSION_TURNS) {
    await configuration.update('chatSessionTurnLimit', stored.originalTurnLimit, vscode.ConfigurationTarget.Workspace);
  }
  if (currentContextChars === MIN_FRUSTRATION_SESSION_CHARS && stored.originalContextChars < MIN_FRUSTRATION_SESSION_CHARS) {
    await configuration.update('chatSessionContextChars', stored.originalContextChars, vscode.ConfigurationTarget.Workspace);
  }

  await workspaceState.update(FRUSTRATION_SETTINGS_STORAGE_KEY, undefined);
}

function isFrustrationSettingsSnapshot(value: unknown): value is FrustrationSettingsSnapshot {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate['originalTurnLimit'] === 'number'
    && typeof candidate['originalContextChars'] === 'number'
    && typeof candidate['lastFrustrationAt'] === 'string';
}

async function writeFrustrationFeedbackToSsot(
  atlas: AtlasMindContext,
  prompt: string,
  signal: UserFrustrationSignal,
  profile: StoredPersonalityProfileRecord,
  timestamp: string,
): Promise<void> {
  const ssotRoot = getSsotRootUri();
  if (!ssotRoot) {
    return;
  }

  const targetUri = vscode.Uri.joinPath(ssotRoot, ...OPERATOR_FEEDBACK_FILE.split('/'));
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(ssotRoot, 'operations'));
  const content = buildOperatorFeedbackMarkdown(prompt, signal, profile, timestamp);
  await vscode.workspace.fs.writeFile(targetUri, Buffer.from(content, 'utf-8'));
  await atlas.memoryManager.loadFromDisk(ssotRoot);
  atlas.memoryRefresh.fire();
}

function getSsotRootUri(): vscode.Uri | undefined {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceFolder) {
    return undefined;
  }

  const configured = vscode.workspace.getConfiguration('atlasmind').get<string>('ssotPath', DEFAULT_SSOT_PATH) ?? DEFAULT_SSOT_PATH;
  const normalized = configured.replace(/\\+/g, '/').trim();
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.includes('..')) {
    return undefined;
  }

  return vscode.Uri.joinPath(workspaceFolder, ...normalized.split('/').filter(Boolean));
}

function buildOperatorFeedbackMarkdown(
  prompt: string,
  signal: UserFrustrationSignal,
  profile: StoredPersonalityProfileRecord,
  timestamp: string,
): string {
  return [
    '# Operator Feedback',
    '',
    '> Learned workspace-specific guidance captured from explicit operator frustration during chat.',
    '',
    `- Updated: ${timestamp}`,
    `- Signal level: ${signal.level}`,
    `- Trigger cue: ${signal.matchedCue}`,
    `- Prompt excerpt: ${truncateForSummary(prompt, 180)}`,
    `- Learned response rule: ${signal.guidance}`,
    `- Settings adjustment: preserve at least ${MIN_FRUSTRATION_SESSION_TURNS} carried turns and ${MIN_FRUSTRATION_SESSION_CHARS} characters of chat context.`,
    '',
    '## Personality Updates',
    '',
    `- Default action bias: ${stringAnswer(profile.answers['defaultActionBias'])}`,
    `- Ambiguity handling: ${stringAnswer(profile.answers['ambiguityHandling'])}`,
    `- Constraint violation response: ${stringAnswer(profile.answers['constraintViolationResponse'])}`,
    `- Emotional framing: ${stringAnswer(profile.answers['emotionalFraming'])}`,
    '',
    '## Current Operating Guidance',
    '',
    '- When the operator expresses frustration after a missed execution cue, respond with one brief acknowledgement at most.',
    '- Then state the next concrete safe action and perform it when tools and approvals allow.',
    '- Avoid repeating advisory prose that already failed to satisfy the request.',
    '',
  ].join('\n');
}

function stringAnswer(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : 'Not set';
}

function _capitalize(value: string): string {
  return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
}

function buildThoughtSummaryTddCue(
  status: 'verified' | 'blocked' | 'missing' | 'not-applicable' | undefined,
  _summary: string | undefined,
): { status: 'verified' | 'blocked' | 'missing' | 'not-applicable'; statusLabel: string } | undefined {
  switch (status) {
    case 'verified':
      return { status: 'verified', statusLabel: '[Red->Green observed]' };
    case 'blocked':
      return { status: 'blocked', statusLabel: '[Red signal required before writes]' };
    case 'missing':
      return { status: 'missing', statusLabel: '[Red->Green missing]' };
    case 'not-applicable':
      return { status: 'not-applicable', statusLabel: '[TDD not applicable]' };
    default:
      return undefined;
  }
}

function toPlatformLabel(platform: NodeJS.Platform): string {
  switch (platform) {
    case 'win32':
      return 'Windows';
    case 'darwin':
      return 'macOS';
    case 'linux':
      return 'Linux';
    default:
      return platform;
  }
}

function getConfiguredTerminalProfile(platform: NodeJS.Platform): string | undefined {
  const suffix = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'osx' : 'linux';
  const configured = vscode.workspace.getConfiguration('terminal.integrated').get<string>(`defaultProfile.${suffix}`)?.trim();
  if (configured) {
    return configured;
  }

  if (platform === 'win32') {
    return 'PowerShell';
  }

  return undefined;
}

function truncateForSummary(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(1, maxChars - 1))}…`;
}

async function handleMemoryCommand(
  prompt: string,
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const query = prompt.trim();
  if (query.length === 0) {
    stream.markdown('Usage: `/memory <search terms>`');
    return;
  }

  const results = await atlas.memoryManager.queryRelevant(query);
  if (results.length === 0) {
    stream.markdown('No matching memory entries found.');
    return;
  }

  const rows = results.map(
    entry => `- **${entry.title}** (${entry.path})\n  ${entry.snippet.slice(0, 180).replace(/\n/g, ' ')}`,
  );
  stream.markdown(`### Memory Results\n\n${rows.join('\n')}`);
}

export function isRoadmapStatusPrompt(prompt: string): boolean {
  return ROADMAP_STATUS_PROMPT_PATTERN.test(prompt) && ROADMAP_STATUS_DETAIL_PATTERN.test(prompt);
}

export function summarizeRoadmapStatus(files: Array<{ path: string; content: string }>): RoadmapStatusSnapshot {
  const items = files.flatMap(file => extractRoadmapChecklistItems(file.path, file.content));
  return {
    completed: items.filter(item => item.completed).length,
    total: items.length,
    outstanding: items.filter(item => !item.completed),
  };
}

export async function buildRoadmapStatusMarkdown(prompt: string): Promise<string | undefined> {
  if (!isRoadmapStatusPrompt(prompt)) {
    return undefined;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    return '### Roadmap Status\n\nOpen a workspace to inspect the live roadmap files.';
  }

  const ssotPath = normalizeSsotPathForLookup(
    vscode.workspace.getConfiguration('atlasmind').get<string>('ssotPath', DEFAULT_SSOT_PATH),
  );
  const roadmapRoot = path.join(workspaceRoot, ssotPath, 'roadmap');
  const files = await readRoadmapMarkdownFiles(roadmapRoot, workspaceRoot);
  const snapshot = summarizeRoadmapStatus(files);

  if (snapshot.total === 0) {
    return `### Roadmap Status\n\nNo tracked roadmap checklist items were found in \`${ssotPath}/roadmap/\`.`;
  }

  const lines = [
    '### Roadmap Status',
    '',
    `- Dashboard-aligned progress: **${snapshot.completed}/${snapshot.total}** roadmap item(s) marked complete.`,
    `- Outstanding roadmap items: **${snapshot.outstanding.length}**.`,
  ];

  if (snapshot.outstanding.length === 0) {
    lines.push('', 'All tracked roadmap items are currently marked complete.');
    return lines.join('\n');
  }

  lines.push('', '#### Outstanding Items', '');
  for (const item of snapshot.outstanding.slice(0, 25)) {
    lines.push(`- [ ] \`${item.path}\` — ${item.text}`);
  }
  if (snapshot.outstanding.length > 25) {
    lines.push(`- ...and **${snapshot.outstanding.length - 25}** more outstanding roadmap item(s).`);
  }

  return lines.join('\n');
}

function normalizeSsotPathForLookup(value: string | undefined): string {
  const raw = (value ?? DEFAULT_SSOT_PATH).trim();
  if (!raw) {
    return DEFAULT_SSOT_PATH;
  }
  return raw.replace(/[\\/]+/g, '/').replace(/^\/+|\/+$/g, '') || DEFAULT_SSOT_PATH;
}

async function readRoadmapMarkdownFiles(roadmapRoot: string, workspaceRoot: string): Promise<Array<{ path: string; content: string }>> {
  try {
    const entries = await fs.readdir(roadmapRoot, { withFileTypes: true });
    const files = await Promise.all(entries
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map(async entry => {
        const absolutePath = path.join(roadmapRoot, entry.name);
        const content = await fs.readFile(absolutePath, 'utf-8');
        const relativePath = path.relative(workspaceRoot, absolutePath).split(path.sep).join('/');
        return { path: relativePath, content };
      }));
    return files.sort((left, right) => left.path.localeCompare(right.path));
  } catch {
    return [];
  }
}

function extractRoadmapChecklistItems(filePath: string, content: string): RoadmapChecklistItem[] {
  return [...content.matchAll(/^\s*(?:[-*]|\d+\.)\s+(.+?)\s*$/gm)]
    .map(match => match[1]?.trim() ?? '')
    .filter(Boolean)
    .map(text => ({
      path: filePath,
      text,
      completed: /^(?:✅|\[x\])/i.test(text),
    }));
}

// -- Follow-up suggestions -------------------------------------------------

export function buildFollowups(
  command: string | undefined,
  outcome?: ProjectRunOutcome,
  suggestedFollowups?: SessionSuggestedFollowup[],
): vscode.ChatFollowup[] {
  if (suggestedFollowups && suggestedFollowups.length > 0) {
    return suggestedFollowups.map(item => ({ prompt: item.prompt, label: item.label }));
  }

  switch (command) {
    case 'bootstrap':
      return [
        { prompt: '/agents', label: 'View registered agents' },
        { prompt: '/skills', label: 'View registered skills' },
        { prompt: '/memory project soul', label: 'Query project memory' },
        { prompt: '/project scaffold the first feature', label: 'Start building with /project' },
      ];

    case 'import':
      return [
        { prompt: '/memory project overview', label: 'View imported overview' },
        { prompt: '/memory dependencies', label: 'View imported dependencies' },
        { prompt: '/agents', label: 'View registered agents' },
        { prompt: '/project', label: 'Start a project task' },
      ];

    case 'agents':
      return [
        { prompt: '/skills', label: 'View registered skills' },
        { prompt: '/project', label: 'Run a project with these agents' },
        { prompt: 'How do I add a custom agent?', label: 'How to add an agent' },
      ];

    case 'skills':
      return [
        { prompt: '/agents', label: 'View registered agents' },
        { prompt: 'How do I add a custom skill?', label: 'How to add a skill' },
        { prompt: '/project', label: 'Run a project using these skills' },
      ];

    case 'memory':
      return [
        { prompt: '/memory architecture', label: 'Search architecture notes' },
        { prompt: '/memory decisions', label: 'Search decisions log' },
        { prompt: '/project based on the current memory context', label: 'Start a project from memory' },
      ];

    case 'cost':
      return [
        { prompt: '/agents', label: 'See which agents ran' },
        { prompt: 'How can I reduce costs?', label: 'Tips to reduce cost' },
      ];

    case 'project': {
      // Outcome-driven chips: surface the most relevant next action first.
      if (outcome?.hasFailures) {
        return [
          { prompt: '/cost', label: 'Review session cost' },
          { prompt: '/project', label: 'Retry the project' },
          { prompt: 'What went wrong with the failed subtasks?', label: 'Diagnose failures' },
        ];
      }
      if (outcome?.hasChangedFiles) {
        return [
          { prompt: '/cost', label: 'Review session cost' },
          { prompt: '/memory save the project plan', label: 'Save plan to memory' },
          { prompt: 'Write tests for the files that were changed', label: 'Add tests' },
        ];
      }
      return [
        { prompt: '/cost', label: 'Review session cost' },
        { prompt: '/memory save the project plan', label: 'Save plan to memory' },
        { prompt: '/project', label: 'Run another project' },
      ];
    }

    case 'runs':
      return [
        { prompt: '/project', label: 'Run a new project' },
        { prompt: '/cost', label: 'Review session cost' },
        { prompt: '/memory operations', label: 'Search operations memory' },
      ];

    case 'ship':
      return [
        { prompt: '/runs', label: 'View run history' },
        { prompt: '/cost', label: 'Review session cost' },
      ];

    case 'voice':
      return [
        { prompt: '/agents', label: 'View agents' },
        { prompt: '/skills', label: 'View skills' },
        { prompt: 'How do I use voice input?', label: 'Voice input help' },
      ];

    default: // freeform
      return [
        { prompt: '/project', label: 'Turn this into a full project' },
        { prompt: '/memory', label: 'Search project memory' },
        { prompt: '/cost', label: 'Check session cost' },
        { prompt: '/vision', label: 'Ask with images' },
        { prompt: '/voice', label: 'Open voice panel' },
      ];
  }
}

export function isAutonomousContinuationPrompt(prompt: string): boolean {
  const t = prompt.trim();
  return AUTONOMOUS_CONTINUATION_PATTERN.test(t) || QUICK_REPLY_NEGATIVE_PATTERN.test(t);
}

export function resolveProjectExecutionGoal(
  prompt: string,
  transcript: SessionTranscriptEntry[],
): string | undefined {
  const trimmed = prompt.trim();
  if (trimmed.startsWith('/project')) {
    const goal = trimmed.slice('/project'.length).replace(PROJECT_APPROVAL_TOKEN, '').trim();
    return goal.length > 0 ? goal : undefined;
  }

  return resolveAutonomousContinuationGoal(prompt, transcript);
}

export function resolveNaturalLanguageProjectGoal(
  prompt: string,
  transcript: SessionTranscriptEntry[],
): string | undefined {
  const explicitGoal = resolveProjectExecutionGoal(prompt, transcript);
  if (explicitGoal) {
    return explicitGoal;
  }

  const match = PROJECT_RUN_REQUEST_PATTERN.exec(prompt.trim());
  if (!match) {
    return undefined;
  }

  const requestedGoal = match[1]?.trim().replace(/^[\s:.-]+/, '') ?? '';
  if (requestedGoal.length > 0) {
    return requestedGoal;
  }

  return undefined;
}

export function resolveAtlasChatIntent(
  prompt: string,
  transcript: SessionTranscriptEntry[],
): AtlasChatIntent | undefined {
  const projectGoal = resolveNaturalLanguageProjectGoal(prompt, transcript);
  if (projectGoal) {
    return { kind: 'project', goal: projectGoal };
  }

  for (const intent of NATURAL_LANGUAGE_COMMAND_INTENTS) {
    if (intent.pattern.test(prompt.trim())) {
      return {
        kind: 'command',
        commandId: intent.commandId,
        ...(intent.args ? { args: intent.args } : {}),
        summary: intent.summary,
      };
    }
  }

  return undefined;
}

export function resolveAutonomousContinuationGoal(
  prompt: string,
  transcript: SessionTranscriptEntry[],
): string | undefined {
  const match = AUTONOMOUS_CONTINUATION_PATTERN.exec(prompt.trim());
  if (!match) {
    return undefined;
  }

  const followupDetail = match[1]?.trim();

  // A bare affirmation ("yes", "go ahead") accepts whatever the assistant just
  // offered, so the assistant's closing proposal is the real goal. Without this the
  // resolver fell back to the most recent *user* message — typically the question
  // that prompted the offer — and the autonomous run just re-ran that question.
  const proposedAction = extractAssistantProposedAction(transcript);

  const priorPrompt = proposedAction ?? [...transcript]
    .reverse()
    .filter(entry => entry.role === 'user')
    .map(entry => normalizeAutonomousSourcePrompt(entry.content))
    .find(candidate => candidate.length > 0);

  if (!priorPrompt) {
    return followupDetail && followupDetail.length > 0 ? followupDetail : undefined;
  }

  if (!followupDetail) {
    return priorPrompt;
  }

  return `${priorPrompt}\n\nAdditional execution instruction: ${followupDetail}`;
}

/**
 * When the user affirms ("yes"), the goal is the action the assistant just proposed.
 * Inspect the most recent assistant turn's closing question and, if it is a first-person
 * offer ("Want me to …?"), return the proposed action with the offer lead-in and trailing
 * "?" stripped. Returns undefined when the last assistant turn made no actionable offer
 * (e.g. it ended with a statement or a non-offer question like "Is that correct?").
 */
export function extractAssistantProposedAction(
  transcript: SessionTranscriptEntry[],
): string | undefined {
  const lastAssistant = [...transcript]
    .reverse()
    .find(entry => entry.role === 'assistant' && entry.content.trim().length > 0);
  if (!lastAssistant) {
    return undefined;
  }

  const questionMatch = RESPONSE_TRAILING_QUESTION_PATTERN.exec(lastAssistant.content.trim());
  const question = questionMatch?.[1]?.trim();
  if (!question || !ASSISTANT_OFFER_LEAD_IN_PATTERN.test(question)) {
    return undefined;
  }

  const action = question
    .replace(ASSISTANT_OFFER_LEAD_IN_PATTERN, '')
    .replace(/\?+\s*$/, '')
    .trim();
  return action.length >= 3 ? action : undefined;
}

function normalizeAutonomousSourcePrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed || isAutonomousContinuationPrompt(trimmed)) {
    return '';
  }

  // A bare informational question ("what is the most important item?") is not an
  // executable goal. Skip it so an affirmation doesn't autonomously "run" the question
  // when there is no assistant proposal to anchor the goal — fall back to an earlier
  // actionable user prompt instead.
  if (INFORMATIONAL_QUESTION_PATTERN.test(trimmed)) {
    return '';
  }

  // Skip meta-execution commands like "Fix this issue in the workspace autonomously" — they
  // reference a prior problem by deictic pronoun and carry no goal content themselves.
  if (DEICTIC_FIX_EXECUTION_PATTERN.test(trimmed)) {
    return '';
  }

  if (trimmed.startsWith('/project')) {
    return trimmed.slice('/project'.length).replace(PROJECT_APPROVAL_TOKEN, '').trim();
  }

  if (trimmed.startsWith('/')) {
    return '';
  }

  return trimmed.replace(PROJECT_APPROVAL_TOKEN, '').trim();
}

export function toApprovedProjectPrompt(goal: string): string {
  const normalized = goal.replace(PROJECT_APPROVAL_TOKEN, '').trim();
  return normalized.length > 0 ? `${normalized} ${PROJECT_APPROVAL_TOKEN}` : PROJECT_APPROVAL_TOKEN;
}

export function getProjectUiConfig(
  configuration: Pick<vscode.WorkspaceConfiguration, 'get'>,
): ProjectUiConfig {
  return {
    approvalFileThreshold: getPositiveIntegerSetting(
      configuration,
      'projectApprovalFileThreshold',
      DEFAULT_PROJECT_APPROVAL_FILE_THRESHOLD,
    ),
    estimatedFilesPerSubtask: getPositiveIntegerSetting(
      configuration,
      'projectEstimatedFilesPerSubtask',
      DEFAULT_ESTIMATED_FILES_PER_SUBTASK,
    ),
    changedFileReferenceLimit: getPositiveIntegerSetting(
      configuration,
      'projectChangedFileReferenceLimit',
      DEFAULT_CHANGED_FILE_REFERENCE_LIMIT,
    ),
    runReportFolder: getStringSetting(
      configuration,
      'projectRunReportFolder',
      DEFAULT_PROJECT_RUN_REPORT_FOLDER,
    ),
  };
}

export function estimateTouchedFiles(subTaskCount: number, estimatedFilesPerSubtask: number): number {
  return Math.max(1, subTaskCount * Math.max(1, estimatedFilesPerSubtask));
}

export async function createWorkspaceSnapshot(): Promise<Map<string, WorkspaceSnapshotEntry>> {
  const uris = await vscode.workspace.findFiles('**/*', WORKSPACE_SNAPSHOT_EXCLUDE);
  const snapshot = new Map<string, WorkspaceSnapshotEntry>();

  await Promise.all(uris.map(async (uri) => {
    const stat = await vscode.workspace.fs.stat(uri);
    const key = toSnapshotKey(uri);
    snapshot.set(key, {
      signature: `${stat.mtime}:${stat.size}`,
      relativePath: vscode.workspace.asRelativePath(uri, false),
      uri,
      textContent: await readSnapshotTextContent(uri, stat.size),
    });
  }));

  return snapshot;
}

export async function collectWorkspaceChangesSince(
  baseline: Map<string, WorkspaceSnapshotEntry>,
): Promise<{ snapshot: Map<string, WorkspaceSnapshotEntry>; changedFiles: ChangedWorkspaceFile[] }> {
  const current = await createWorkspaceSnapshot();
  return {
    snapshot: current,
    changedFiles: diffWorkspaceSnapshots(baseline, current),
  };
}

export function diffWorkspaceSnapshots(
  baseline: Map<string, WorkspaceSnapshotEntry>,
  current: Map<string, WorkspaceSnapshotEntry>,
): ChangedWorkspaceFile[] {
  const changed: ChangedWorkspaceFile[] = [];
  const keys = new Set<string>([...baseline.keys(), ...current.keys()]);

  for (const key of keys) {
    const before = baseline.get(key);
    const after = current.get(key);

    if (!before && after) {
      changed.push({ relativePath: after.relativePath, status: 'created', uri: after.uri });
      continue;
    }

    if (before && !after) {
      changed.push({ relativePath: before.relativePath, status: 'deleted' });
      continue;
    }

    if (before && after && before.signature !== after.signature) {
      changed.push({ relativePath: after.relativePath, status: 'modified', uri: after.uri });
    }
  }

  return changed.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function summarizeChangedFiles(changedFiles: ChangedWorkspaceFile[]): string {
  const created = changedFiles.filter(file => file.status === 'created').length;
  const modified = changedFiles.filter(file => file.status === 'modified').length;
  const deleted = changedFiles.filter(file => file.status === 'deleted').length;
  return `created ${created}, modified ${modified}, deleted ${deleted}`;
}

export function buildChangedFilesDiffPreview(
  baseline: Map<string, WorkspaceSnapshotEntry>,
  current: Map<string, WorkspaceSnapshotEntry>,
  changedFiles: ChangedWorkspaceFile[],
): string | undefined {
  const previews = changedFiles
    .slice(0, 3)
    .map(file => buildSingleFileDiffPreview(file, baseline, current))
    .filter((value): value is string => Boolean(value));

  if (previews.length === 0) {
    return undefined;
  }

  return previews.join('\n\n');
}

export function addFileAttribution(
  attributionMap: Map<string, Set<string>>,
  subTaskTitle: string,
  changedFiles: ChangedWorkspaceFile[],
): void {
  for (const file of changedFiles) {
    const existing = attributionMap.get(file.relativePath) ?? new Set<string>();
    existing.add(subTaskTitle);
    attributionMap.set(file.relativePath, existing);
  }
}

export function toSerializableAttribution(
  attributionMap: Map<string, Set<string>>,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [filePath, subTaskTitles] of attributionMap) {
    result[filePath] = [...subTaskTitles].sort((a, b) => a.localeCompare(b));
  }
  return result;
}

export function buildProjectRunSummary(
  result: ProjectResult,
  changedFiles: ChangedWorkspaceFile[],
  fileAttribution: Map<string, Set<string>>,
  runStartedAt: string,
  subTaskArtifacts?: ProjectRunSubTaskArtifact[],
): ProjectRunSummary {
  return {
    id: result.id,
    goal: result.goal,
    startedAt: runStartedAt,
    generatedAt: new Date().toISOString(),
    synthesis: result.synthesis,
    totalCostUsd: result.totalCostUsd,
    totalDurationMs: result.totalDurationMs,
    subTaskResults: result.subTaskResults.map(item => ({
      subTaskId: item.subTaskId,
      title: item.title,
      status: item.status,
      costUsd: item.costUsd,
      durationMs: item.durationMs,
      error: item.error,
    })),
    changedFiles,
    fileAttribution: toSerializableAttribution(fileAttribution),
    subTaskArtifacts: subTaskArtifacts ?? buildProjectRunSubTaskArtifacts(result.subTaskResults),
  };
}

export function buildProjectRunSubTaskArtifacts(results: SubTaskResult[]): ProjectRunSubTaskArtifact[] {
  return results.map(result => ({
    subTaskId: result.subTaskId,
    title: result.title,
    role: result.role ?? 'general-assistant',
    dependsOn: [...(result.dependsOn ?? [])],
    status: result.status,
    output: result.output,
    outputPreview: result.artifacts?.outputPreview ?? truncatePreview(result.output),
    costUsd: result.costUsd,
    durationMs: result.durationMs,
    error: result.error,
    toolCallCount: result.artifacts?.toolCallCount ?? 0,
    toolCalls: result.artifacts?.toolCalls.map(tool => ({ ...tool })) ?? [],
    verificationSummary: result.artifacts?.verificationSummary,
    tddStatus: result.artifacts?.tddStatus,
    tddSummary: result.artifacts?.tddSummary,
    checkpointedTools: [...(result.artifacts?.checkpointedTools ?? [])],
    changedFiles: result.artifacts?.changedFiles.map(file => ({ ...file })) ?? [],
    diffPreview: result.artifacts?.diffPreview,
  }));
}

export async function writeProjectRunSummaryReport(
  report: ProjectRunSummary,
  reportFolder: string,
): Promise<vscode.Uri | undefined> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return undefined;
  }

  const safeFolder = reportFolder.replace(/\\/g, '/').replace(/^\/+/, '').trim() || DEFAULT_PROJECT_RUN_REPORT_FOLDER;
  const folderUri = vscode.Uri.joinPath(workspaceFolder.uri, ...safeFolder.split('/').filter(Boolean));
  await vscode.workspace.fs.createDirectory(folderUri);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileUri = vscode.Uri.joinPath(folderUri, `project-run-${timestamp}.json`);
  const payload = JSON.stringify(report, null, 2);
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(payload, 'utf-8'));
  return fileUri;
}

function toSnapshotKey(uri: vscode.Uri): string {
  return uri.fsPath.toLowerCase();
}

async function readSnapshotTextContent(uri: vscode.Uri, size: number): Promise<string | undefined> {
  if (size > 200_000) {
    return undefined;
  }

  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.includes(0)) {
      return undefined;
    }
    return Buffer.from(bytes).toString('utf-8');
  } catch {
    return undefined;
  }
}

function buildSingleFileDiffPreview(
  changedFile: ChangedWorkspaceFile,
  baseline: Map<string, WorkspaceSnapshotEntry>,
  current: Map<string, WorkspaceSnapshotEntry>,
): string | undefined {
  const entry = current.get(toSnapshotLookupKey(changedFile.relativePath)) ?? baseline.get(toSnapshotLookupKey(changedFile.relativePath));
  const relativePath = entry?.relativePath ?? changedFile.relativePath;
  const before = baseline.get(toSnapshotLookupKey(relativePath))?.textContent;
  const after = current.get(toSnapshotLookupKey(relativePath))?.textContent;

  if (changedFile.status === 'created' && after) {
    return `+++ ${relativePath}\n${takeFirstLines(after).map(line => `+ ${line}`).join('\n')}`;
  }
  if (changedFile.status === 'deleted' && before) {
    return `--- ${relativePath}\n${takeFirstLines(before).map(line => `- ${line}`).join('\n')}`;
  }
  if (changedFile.status === 'modified' && before !== undefined && after !== undefined) {
    const beforeLines = before.split(/\r?\n/);
    const afterLines = after.split(/\r?\n/);
    const previewLines: string[] = [`*** ${relativePath}`];
    const maxLines = Math.max(beforeLines.length, afterLines.length);
    for (let index = 0; index < maxLines && previewLines.length < 25; index += 1) {
      if (beforeLines[index] === afterLines[index]) {
        continue;
      }
      if (beforeLines[index] !== undefined) {
        previewLines.push(`- ${beforeLines[index]}`);
      }
      if (afterLines[index] !== undefined) {
        previewLines.push(`+ ${afterLines[index]}`);
      }
    }
    return previewLines.join('\n');
  }

  return undefined;
}

function takeFirstLines(text: string, maxLines = 12): string[] {
  return text.split(/\r?\n/).slice(0, maxLines);
}

function truncatePreview(value: string, maxLength = 600): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}...`;
}

function toSnapshotLookupKey(relativePath: string): string {
  return relativePath.toLowerCase();
}

function getPositiveIntegerSetting(
  configuration: Pick<vscode.WorkspaceConfiguration, 'get'>,
  key: string,
  fallback: number,
): number {
  const value = configuration.get<number>(key);
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return Math.floor(value);
}

function getStringSetting(
  configuration: Pick<vscode.WorkspaceConfiguration, 'get'>,
  key: string,
  fallback: string,
): string {
  const value = configuration.get<string>(key);
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fallback;
  }

  return value.trim();
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

async function pickImageAttachments(): Promise<TaskImageAttachment[]> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return [];
  }

  const selected = await vscode.window.showOpenDialog({
    canSelectMany: true,
    canSelectFiles: true,
    canSelectFolders: false,
    defaultUri: workspaceFolder.uri,
    openLabel: 'Attach images to AtlasMind chat',
    filters: {
      Images: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
    },
  });

  if (!selected || selected.length === 0) {
    return [];
  }

  return resolvePickedImageAttachments(selected);
}
