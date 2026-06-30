import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { AtlasMindContext } from '../extension.js';
import type {
  SessionComposerPrefill,
  SessionPolicySnapshot,
  SessionSuggestedFollowup,
  SessionTimelineNote,
  SessionTranscriptEntry,
  SessionTranscriptMetadata,
} from './sessionConversation.js';
import type {
  ChangedWorkspaceFile,
  MissionConfig,
  MissionProgressUpdate,
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
import { MissionRunner } from '../core/missionRunner.js';
import type { MissionCheckpointRequest, MissionBlockedRequest, MissionBlockResolution } from '../core/missionRunner.js';
import { shouldBiasTowardWorkspaceInvestigation } from '../core/orchestrator.js';
import { formatCost, formatCostAdaptive } from '../core/currencyFormatter.js';
import {
  DEFAULT_MISSION_MAX_ITERATIONS,
  DEFAULT_MISSION_MAX_COST_USD,
  DEFAULT_MISSION_MAX_TOKENS,
  DEFAULT_MISSION_MAX_NO_PROGRESS,
  DEFAULT_MISSION_CHECKPOINT_EVERY_N,
  DEFAULT_MISSION_CHECKPOINT_BUDGET_FRACTION,
  DEFAULT_MISSION_GOAL_CONFIDENCE,
} from '../constants.js';
import { mergeImageAttachments, resolveInlineImageAttachments, resolvePickedImageAttachments } from './imageAttachments.js';
import {
  applyManagedInstructionBlock,
  detectedWritebackTools,
  gatherInstructionSources,
  runInstructionMerge,
  runInstructionRender,
  writeUnifiedToSsot,
  type InstructionMergeResult,
  type MergeConflict,
  type MergeDirective,
} from '../utils/aiInstructionMerge.js';

export { extractImagePathCandidates, mergeImageAttachments, resolveInlineImageAttachments } from './imageAttachments.js';

/** workspaceState key for an in-flight two-way instruction sync awaiting conflict resolution. */
const PENDING_INSTRUCTION_SYNC_KEY = 'atlasmind.pendingInstructionSync';

interface PendingInstructionSync {
  unified: MergeDirective[];
  conflicts: MergeConflict[];
  /** Conflict id → chosen option index (overrides the recommended option). */
  choices: Record<string, number>;
  autoResolvedCount: number;
  sourceCount: number;
  createdAt: string;
}

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
const LOOP_APPROVAL_TOKEN = '--approve';
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
/**
 * Detects when the assistant's *own* reply is offering to start an autonomous
 * project run (e.g. "…want me to kick off a project run to build this out?").
 * Requires explicit project/autonomous-run vocabulary — generic "I'll build this"
 * is deliberately excluded so auto-flow never escalates an ordinary edit into a
 * multi-step run. Used by {@link resolveProjectRunAutoFlow}.
 */
const PROJECT_RUN_PROPOSAL_INTENT_PATTERN = /\b(?:(?:autonomous|atlasmind)\s+project\s+run|project\s+run|autonomous\s+run|autonomous\s+project|project\s+execution\s+mode|kick\s+off\s+(?:an?\s+|the\s+)?(?:autonomous\s+)?(?:project\s+)?run|start\s+(?:an?\s+|the\s+)?(?:autonomous\s+)?project\s+run|launch\s+(?:an?\s+|the\s+)?(?:autonomous\s+)?(?:project\s+)?run|run\s+(?:this|it|that)\s+autonomously|run\s+(?:this|it|that)\s+as\s+(?:an?\s+)?(?:autonomous\s+)?(?:project\s+)?run|switch\s+(?:in)?to\s+project\s+(?:execution\s+)?mode)\b/i;
/** First-person offer/readiness lead-ins that mark a proposal as an actual go-ahead the user can accept. */
const PROJECT_RUN_OFFER_PATTERN = /\b(?:want\s+me\s+to|would\s+you\s+like\s+me\s+to|do\s+you\s+want\s+me\s+to|shall\s+i|should\s+i|can\s+i|may\s+i|i\s+can|i'?ll|i\s+will|let\s+me|i'?m\s+ready\s+to|i\s+am\s+ready\s+to|ready\s+to)\b/i;
/** Negation/deferral cues that veto a proposal match — the model is declining or still waiting on the user. */
const PROJECT_RUN_PROPOSAL_NEGATION_PATTERN = /\b(?:won'?t|will\s+not|cannot|can'?t|do\s+not|don'?t|shouldn'?t|not\s+ready|hold\s+off|before\s+(?:i|we)\s+(?:start|begin|run|proceed)|once\s+you|after\s+you)\b/i;
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
// A "plan/build" request asks for an ordered plan, not a status dump — we collect the gaps then hand
// off to real planning. An explicit "status/progress" request still gets the deterministic summary.
const ROADMAP_PLAN_INTENT_PATTERN = /\b(?:plan|planning|build|building|ship|deliver|delivering|route|path|roadmap to|get to|next milestone|mvp|minimum viable)\b/i;
const ROADMAP_STATUS_INTENT_PATTERN = /\b(?:status|progress|outstanding|remaining|left|how many|where are we|what'?s left|done so far|completed|backlog)\b/i;
// The real developer backlog lives between these markers in improvement-plan.md; everything else in
// that file (Project Context, Prioritisation Notes legend) is scaffold, not outstanding work.
const ROADMAP_MANAGED_BLOCK_START = /<!--\s*atlasmind:roadmap-items:start\s*-->/i;
const ROADMAP_MANAGED_BLOCK_END = /<!--\s*atlasmind:roadmap-items:end\s*-->/i;
// A profile field whose value matches one of these is treated as unanswered → posed as a question.
const ROADMAP_UNSPECIFIED_VALUES = new Set(['unspecified', 'tbd', 'to be decided', 'todo', 'to do', 'n/a', 'na', 'none', 'unknown', '?', '-']);
// Known profile fields get hand-written questions/labels; unknown `Key: Unspecified` lines fall back to generated text.
const ROADMAP_PROFILE_FIELDS: Record<string, { question: string; label: string }> = {
  'project': { question: 'What is the project name?', label: 'Project name' },
  'project name': { question: 'What is the project name?', label: 'Project name' },
  'project type': { question: 'What type of project is this?', label: 'Project type' },
  'target audience': { question: 'Who is the target audience?', label: 'Target audience' },
  'audience': { question: 'Who is the target audience?', label: 'Audience' },
  'timeline': { question: 'What is the target timeline?', label: 'Timeline' },
  'deadline': { question: 'What is the deadline?', label: 'Deadline' },
  'tech stack': { question: 'What is the tech stack?', label: 'Tech stack' },
  'stack': { question: 'What is the tech stack?', label: 'Stack' },
  'platform': { question: 'What platform(s) does this target?', label: 'Platform' },
  'budget': { question: 'What is the budget?', label: 'Budget' },
  'goal': { question: 'What is the primary goal?', label: 'Goal' },
};
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

// 'descriptor' = scaffold/legend prose (e.g. Prioritisation Notes) excluded from the tally;
// 'metadata' = resolved profile fields; 'shipped' = release-history notes.
type RoadmapItemKind = 'question' | 'task' | 'completed' | 'shipped' | 'metadata' | 'descriptor';

interface RoadmapChecklistItem {
  path: string;
  text: string;
  completed: boolean;
  kind: RoadmapItemKind;
  question?: RoadmapQuestion;
}

/** An unanswered project-profile field, posed as a direct question the user can answer in chat. */
export interface RoadmapQuestion {
  /** Direct question shown to the user, e.g. "What type of project is this?". */
  question: string;
  /** Nicely-cased field name used in the combined answer block, e.g. "Project type". */
  fieldLabel: string;
  /** Source roadmap file (workspace-relative path). */
  sourcePath: string;
}

export interface RoadmapStatusSnapshot {
  completed: number;
  total: number;
  outstanding: RoadmapChecklistItem[];
  /** Unanswered profile fields posed as questions the user can resolve to unblock planning. */
  questions: RoadmapQuestion[];
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
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?(?:resource\s+discovery|agent\s+finder|discovery\s+panel)\b/i,
    commandId: 'atlasmind.openResourceDiscovery',
    summary: 'Opened AtlasMind Resource Discovery.',
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

    case 'discover':
      await handleDiscoverCommand(request.prompt, stream, atlas);
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

    case 'loop': {
      const { sessionContext } = await prepareProjectRunContext(atlas, sessionId);
      await runLoopCommand(request.prompt, stream, token, atlas, sessionId, sessionContext);
      break;
    }

    case 'runs':
      await handleRunsCommand(stream);
      break;

    case 'ship':
      await handleShipCommand(request.prompt, stream, atlas);
      break;

    case 'sync-instructions':
      await handleSyncInstructionsCommand(request.prompt, stream, atlas);
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

      projectOutcome = await handleFreeformMessage(request, stream, token, atlas, sessionId);
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

/**
 * Build a {@link MissionConfig} from a goal and the user's `atlasmind.loop.*`
 * settings. The chat command surfaces no structured guardrails (the Mission
 * Control panel does); a single always-on safety instruction is injected.
 */
export function buildMissionConfigFromSettings(
  goal: string,
  configuration: Pick<vscode.WorkspaceConfiguration, 'get'>,
  constraints: MissionConfig['constraints'],
): MissionConfig {
  const minutes = Math.max(1, configuration.get<number>('loop.defaultMaxDurationMinutes', 30));
  return {
    id: `mission-${Date.now()}`,
    goal,
    guardrails: {
      instructions: [
        'Make the smallest safe, verifiable change each iteration; prefer existing skills and agents before creating new ones.',
      ],
    },
    budget: {
      maxIterations: Math.max(1, configuration.get<number>('loop.defaultMaxIterations', DEFAULT_MISSION_MAX_ITERATIONS)),
      maxCostUsd: Math.max(0.01, configuration.get<number>('loop.defaultMaxCostUsd', DEFAULT_MISSION_MAX_COST_USD)),
      maxTokens: Math.max(1000, configuration.get<number>('loop.defaultMaxTokens', DEFAULT_MISSION_MAX_TOKENS)),
      maxDurationMs: minutes * 60_000,
      maxConsecutiveNoProgress: Math.max(1, configuration.get<number>('loop.maxConsecutiveNoProgress', DEFAULT_MISSION_MAX_NO_PROGRESS)),
    },
    checkpointPolicy: {
      everyNIterations: Math.max(0, configuration.get<number>('loop.checkpointEveryNIterations', DEFAULT_MISSION_CHECKPOINT_EVERY_N)),
      atBudgetFractions: [clampFraction(configuration.get<number>('loop.checkpointAtBudgetFraction', DEFAULT_MISSION_CHECKPOINT_BUDGET_FRACTION))],
      beforeWriteBatches: configuration.get<boolean>('loop.requireApprovalBeforeWriteBatches', false),
    },
    constraints,
    allowDiscovery: configuration.get<boolean>('loop.allowDiscovery', true),
  };
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MISSION_CHECKPOINT_BUDGET_FRACTION;
  }
  return Math.max(0.01, Math.min(1, value));
}

/**
 * `/loop <goal>` — runs the autonomous goal-seeking Mission Loop. Previews the
 * goal + closed parameter envelope + checkpoint policy, gates the whole run
 * behind an approval token (like `/project`), then streams live iterations.
 * Checkpoints pause for a modal approval mid-run (deny-by-default).
 */
export async function runLoopCommand(
  prompt: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  atlas: AtlasMindContext,
  sessionId?: string,
  sessionContext?: string,
  interaction?: MissionLoopInteraction,
): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  if (!configuration.get<boolean>('loop.enabled', true)) {
    stream.markdown('The Mission Loop is disabled. Enable **`atlasmind.loop.enabled`** in Settings to use `/loop`.');
    return;
  }

  const approved = prompt.includes(LOOP_APPROVAL_TOKEN);
  const goal = prompt.replace(LOOP_APPROVAL_TOKEN, '').trim();
  if (!goal) {
    stream.markdown('Usage: `/loop <goal>` — describe the objective. AtlasMind will loop autonomously toward it within a closed budget, stopping at the goal or when a guardrail confines progress.');
    return;
  }

  const constraints = {
    budget: toBudgetMode(configuration.get<string>('budgetMode')),
    speed: toSpeedMode(configuration.get<string>('speedMode')),
  };
  const missionConfig = buildMissionConfigFromSettings(goal, configuration, constraints);
  const { budget, checkpointPolicy } = missionConfig;

  // Rough cost envelope: a small increment (≈3 subtasks) per iteration, capped by the hard budget.
  const perIteration = atlas.orchestrator.estimateProjectCost(3, constraints);
  const projectedHigh = Math.min(budget.maxCostUsd, perIteration.highUsd * budget.maxIterations);

  stream.markdown(
    `### Mission Loop preview\n\n` +
    `**Goal:** ${goal}\n\n` +
    `**Closed parameter envelope (hard stops):**\n` +
    `- Max iterations: **${budget.maxIterations}**\n` +
    `- Cost cap: **${formatCost(budget.maxCostUsd, 2)}** (projected up to ~${formatCost(projectedHigh, 4)})\n` +
    `- Token cap: **${budget.maxTokens.toLocaleString()}**\n` +
    `- Time cap: **${Math.round(budget.maxDurationMs / 60000)} min**\n` +
    `- Stop after **${budget.maxConsecutiveNoProgress}** no-progress iteration(s)\n\n` +
    `**Checkpoints (you approve to continue):** ` +
    `${checkpointPolicy.everyNIterations ? `every ${checkpointPolicy.everyNIterations} iteration(s)` : 'none'}` +
    `${checkpointPolicy.atBudgetFractions?.length ? `, at ${(checkpointPolicy.atBudgetFractions[0] * 100).toFixed(0)}% of budget` : ''}.\n\n` +
    `**Discovery:** ${missionConfig.allowDiscovery ? 'may synthesize/discover capabilities (gated by approval)' : 'restricted to existing capabilities'}. ` +
    `Deployments are never run directly — they route through the guarded delivery pipeline.\n`,
  );

  if (!approved) {
    stream.markdown(
      `\n⚠️ **Approval required** to start an autonomous loop. ` +
      `Re-run with \`${LOOP_APPROVAL_TOKEN}\` to begin, or open Mission Control to fine-tune the goal, guardrails, and budgets first.`,
    );
    stream.button({
      command: 'atlasmind.openMissionControl',
      title: 'Open Mission Control',
      tooltip: 'Define guardrails, success criteria, and budgets, then launch the mission.',
    });
    return;
  }

  const planner = new Planner(
    atlas.modelRouter,
    atlas.providerRegistry,
    new TaskProfiler(),
    atlas.memoryManager,
    atlas.skillsRegistry,
  );
  const runner = new MissionRunner(atlas.orchestrator, planner, atlas.costTracker, atlas.missionRegistry);

  const abortController = new AbortController();
  const cancelDisposable = token.onCancellationRequested(() => abortController.abort());

  let baseline = await createWorkspaceSnapshot();
  const captureChangedFiles = async (): Promise<ChangedWorkspaceFile[]> => {
    const impact = await collectWorkspaceChangesSince(baseline);
    baseline = impact.snapshot;
    return impact.changedFiles;
  };

  const modalCheckpointGate = async (req: MissionCheckpointRequest): Promise<boolean> => {
    if (token.isCancellationRequested) {
      return false;
    }
    const choice = await vscode.window.showWarningMessage(
      `Mission checkpoint at iteration ${req.iterationIndex}`,
      {
        modal: true,
        detail:
          `${req.reason}\n\n` +
          `Spent ${formatCost(req.spentUsd, 4)} of ${formatCost(req.budgetUsd, 2)} · ` +
          `${req.spentTokens.toLocaleString()} tokens · ${req.iterationsRun} iteration(s) done.\n\n` +
          `Approve to let the loop continue, or stop here.`,
      },
      'Approve & Continue',
    );
    return choice === 'Approve & Continue';
  };

  // The surface decides how gates are presented: the `@atlas` chat view falls back
  // to OS modals; the chat panel injects in-chat buttons via `interaction`.
  const checkpointGate = interaction?.checkpointGate ?? modalCheckpointGate;
  const { blockedGate, restoreOverrides } = createMissionSettingBlockGate(interaction?.blockAsk ?? modalMissionBlockAsk);

  const onProgress = (update: MissionProgressUpdate): void => {
    if (token.isCancellationRequested) {
      return;
    }
    switch (update.type) {
      case 'iteration-start':
        stream.markdown(`\n\n### Iteration ${update.index} / ${update.maxIterations}${update.focus ? `\n\n*Focus: ${update.focus}*` : ''}\n`);
        break;
      case 'planned-increment':
        stream.progress(`Planned ${update.plan.subTasks.length} subtask(s) for iteration ${update.index}`);
        break;
      case 'executing':
        stream.progress(`Executing iteration ${update.index}…`);
        break;
      case 'evaluated': {
        const v = update.verdict;
        const icon = v.verdict === 'achieved' ? '✅' : v.verdict === 'progressing' ? '↗️' : v.verdict === 'blocked' ? '⛔' : '⏸️';
        stream.markdown(
          `${icon} **${v.verdict}** (${(v.confidence * 100).toFixed(0)}% confidence) — ${v.rationale || 'no rationale'}` +
          `${v.nextFocus ? `\n\n*Next: ${v.nextFocus}*` : ''}\n`,
        );
        break;
      }
      case 'checkpoint-required':
        stream.progress(`Checkpoint at iteration ${update.index}: awaiting approval…`);
        break;
      case 'checkpoint-resolved':
        stream.markdown(update.approved ? `_Checkpoint approved — continuing._\n` : `_Checkpoint declined — stopping the mission._\n`);
        break;
      case 'blocked':
        stream.markdown(`\n⛔ **Blocked — ${update.blocker.title}.** ${update.blocker.detail}\n\n_Awaiting your decision (override for this run, open settings, or stop)…_\n`);
        break;
      case 'error':
        stream.markdown(`❌ **Mission error:** ${update.message}`);
        break;
      default:
        break;
    }
  };

  try {
    const result = await runner.run(missionConfig, {
      hooks: { checkpointGate, blockedGate },
      onProgress,
      signal: abortController.signal,
      goalConfidenceThreshold: configuration.get<number>('loop.goalAchievedConfidenceThreshold', DEFAULT_MISSION_GOAL_CONFIDENCE),
      captureChangedFiles,
      sessionContext,
      chatSessionId: sessionId,
    });

    const outcomeIcon = result.achieved ? '✅' : '⏹️';
    stream.markdown(
      `\n\n## ${outcomeIcon} Mission ${result.achieved ? 'complete' : 'stopped'} — \`${result.stopReason}\`\n\n${result.finalSynthesis}`,
    );
    stream.markdown(
      `\n\n---\n*${result.iterations.length} iteration(s) · ` +
      `${(result.totalDurationMs / 1000).toFixed(1)}s · ` +
      `${formatCostAdaptive(result.totalCostUsd)} · ` +
      `${result.totalInputTokens.toLocaleString()} in / ${result.totalOutputTokens.toLocaleString()} out*`,
    );
    stream.markdown(`\n\nFull audit trail saved to **project_memory/operations/missions.md**.`);
    stream.button({
      command: 'atlasmind.openMissionControl',
      title: 'Open Mission Control',
      tooltip: 'Review this mission and its iteration history.',
    });
    if (!token.isCancellationRequested) {
      atlas.sessionConversation.recordTurn(goal, result.finalSynthesis, sessionId);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stream.markdown(`❌ **Mission failed:** ${message}`);
  } finally {
    cancelDisposable.dispose();
    await restoreOverrides();
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

/**
 * Build a chat button that re-submits a `/sync-instructions` subcommand. All
 * sync actions stay in chat by routing through the native chat-open command, so
 * conflict resolution is a normal conversational round-trip.
 */
function syncInstructionsButton(stream: vscode.ChatResponseStream, title: string, args: string): void {
  stream.button({
    title,
    command: 'workbench.action.chat.open',
    arguments: [{ query: `@atlas /sync-instructions ${args}`.trim() }],
  });
}

/**
 * `/sync-instructions` — two-way AI instruction-set sync. Reconciles every
 * detected tool's instructions (+ AtlasMind's own) into one unified set and
 * mirrors it back into each tool's file. Significant conflicts are raised here
 * in chat and the writeback is gated until the user resolves them.
 */
async function handleSyncInstructionsCommand(
  prompt: string,
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    stream.markdown('Open a workspace folder first, then run `/sync-instructions` again.');
    return;
  }
  const workspaceRoot = workspaceFolder.uri.fsPath;
  const sub = prompt.trim();
  const complete = (system: string, user: string): Promise<string> => atlas.orchestrator.completeBootstrap(system, user);

  if (/^apply\b/i.test(sub)) {
    await applyPendingInstructionSync(workspaceRoot, stream, atlas, complete);
    return;
  }
  if (/^choose\b/i.test(sub)) {
    await recordInstructionConflictChoice(sub, stream, atlas);
    return;
  }
  if (/^(reset|cancel)\b/i.test(sub)) {
    await atlas.extensionContext.workspaceState.update(PENDING_INSTRUCTION_SYNC_KEY, undefined);
    stream.markdown('Cleared the pending instruction sync. Run `/sync-instructions` to start over.');
    return;
  }

  // ── Start: gather + reconcile ──────────────────────────────────────────────
  stream.markdown('Scanning AI instruction sets and reconciling them…\n\n');
  const sources = gatherInstructionSources(workspaceRoot);
  if (sources.length === 0) {
    stream.markdown(
      'No AI instruction files were found to sync. Create a `CLAUDE.md`, `.github/copilot-instructions.md`, ' +
      '`AGENTS.md`, or similar (or run `/bootstrap`) first.',
    );
    return;
  }

  let merge: InstructionMergeResult;
  try {
    merge = await runInstructionMerge(sources, complete);
  } catch (err) {
    stream.markdown(`⚠️ Could not reconcile the instruction sets: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  const sourceList = sources.map(source => `\`${source.tool}\``).join(', ');
  stream.markdown(
    `Found **${sources.length}** instruction source${sources.length === 1 ? '' : 's'} (${sourceList}). ` +
    `Reconciled **${merge.unified.length}** directive${merge.unified.length === 1 ? '' : 's'}` +
    (merge.autoResolved.length > 0
      ? `, auto-resolving **${merge.autoResolved.length}** minor difference${merge.autoResolved.length === 1 ? '' : 's'}`
      : '') +
    '.\n\n',
  );

  if (merge.conflicts.length === 0) {
    await atlas.extensionContext.workspaceState.update(PENDING_INSTRUCTION_SYNC_KEY, undefined);
    await performInstructionWriteback(workspaceRoot, merge.unified, stream, atlas, complete);
    return;
  }

  // ── Significant conflicts → raise in chat, gate the writeback ───────────────
  const pending: PendingInstructionSync = {
    unified: merge.unified,
    conflicts: merge.conflicts,
    choices: {},
    autoResolvedCount: merge.autoResolved.length,
    sourceCount: sources.length,
    createdAt: new Date().toISOString(),
  };
  await atlas.extensionContext.workspaceState.update(PENDING_INSTRUCTION_SYNC_KEY, pending);

  stream.markdown(
    `### ⚠️ ${merge.conflicts.length} conflict${merge.conflicts.length === 1 ? '' : 's'} need your decision\n\n` +
    'Nothing is written until these are resolved. AtlasMind has a recommendation for each — apply them as-is, ' +
    'or override any conflict, then finish the sync.\n',
  );
  merge.conflicts.forEach((conflict, index) => {
    const lines: string[] = [`\n**${index + 1}. ${conflict.topic}**`];
    conflict.options.forEach((option, optionIndex) => {
      const recommended = optionIndex === conflict.recommendedOptionIndex ? ' _(recommended)_' : '';
      lines.push(`   - \`${optionIndex + 1}\` **${option.tool}**: ${option.directive}${recommended}`);
    });
    stream.markdown(lines.join('\n') + '\n');
    conflict.options.forEach((option, optionIndex) => {
      syncInstructionsButton(stream, `#${index + 1}: use ${option.tool}'s`, `choose ${index + 1} ${optionIndex + 1}`);
    });
  });
  stream.markdown('\nWhen you are ready:\n');
  syncInstructionsButton(stream, '✅ Apply recommendations & finish sync', 'apply');
}

/** Record a per-conflict override into the pending sync state. */
async function recordInstructionConflictChoice(
  sub: string,
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const pending = atlas.extensionContext.workspaceState.get<PendingInstructionSync>(PENDING_INSTRUCTION_SYNC_KEY);
  if (!pending) {
    stream.markdown('No pending instruction sync. Run `/sync-instructions` first.');
    return;
  }
  const match = /choose\s+(\d+)\s+(\d+)/i.exec(sub);
  if (!match) {
    stream.markdown('Usage: `/sync-instructions choose <conflict #> <option #>` — e.g. `choose 1 2`.');
    return;
  }
  const conflictPos = Number.parseInt(match[1]!, 10) - 1;
  const optionPos = Number.parseInt(match[2]!, 10) - 1;
  const conflict = pending.conflicts[conflictPos];
  if (!conflict) {
    stream.markdown(`There is no conflict #${conflictPos + 1}. There ${pending.conflicts.length === 1 ? 'is' : 'are'} ${pending.conflicts.length}.`);
    return;
  }
  if (optionPos < 0 || optionPos >= conflict.options.length) {
    stream.markdown(`Conflict #${conflictPos + 1} has ${conflict.options.length} options; pick between 1 and ${conflict.options.length}.`);
    return;
  }
  pending.choices[conflict.id] = optionPos;
  await atlas.extensionContext.workspaceState.update(PENDING_INSTRUCTION_SYNC_KEY, pending);

  const chosen = conflict.options[optionPos]!;
  stream.markdown(`Recorded for **${conflict.topic}**: using **${chosen.tool}**'s rule.\n`);
  const decided = Object.keys(pending.choices).length;
  stream.markdown(`${decided} of ${pending.conflicts.length} conflict${pending.conflicts.length === 1 ? '' : 's'} overridden. Apply when ready (unset conflicts use the recommendation).\n`);
  syncInstructionsButton(stream, '✅ Apply & finish sync', 'apply');
}

/** Resolve the pending sync (choices or recommendations) and write everything back. */
async function applyPendingInstructionSync(
  workspaceRoot: string,
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
  complete: (system: string, user: string) => Promise<string>,
): Promise<void> {
  const pending = atlas.extensionContext.workspaceState.get<PendingInstructionSync>(PENDING_INSTRUCTION_SYNC_KEY);
  if (!pending) {
    stream.markdown('No pending instruction sync to apply. Run `/sync-instructions` first.');
    return;
  }
  const resolvedDirectives: MergeDirective[] = pending.conflicts.map(conflict => {
    const index = pending.choices[conflict.id] ?? conflict.recommendedOptionIndex;
    const option = conflict.options[index] ?? conflict.options[conflict.recommendedOptionIndex] ?? conflict.options[0]!;
    return { id: `resolved-${conflict.id}`, category: conflict.topic, text: option.directive, sources: [option.tool] };
  });
  const finalUnified = [...pending.unified, ...resolvedDirectives];
  await atlas.extensionContext.workspaceState.update(PENDING_INSTRUCTION_SYNC_KEY, undefined);
  await performInstructionWriteback(workspaceRoot, finalUnified, stream, atlas, complete);
}

/** Render the unified set per-tool and write the managed blocks + SSOT mirror. */
async function performInstructionWriteback(
  workspaceRoot: string,
  unified: MergeDirective[],
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
  complete: (system: string, user: string) => Promise<string>,
): Promise<void> {
  const targetTools = detectedWritebackTools(workspaceRoot);
  const rendered = await runInstructionRender(unified, targetTools, complete);
  const writeResult = await applyManagedInstructionBlock(workspaceRoot, rendered, unified);
  const isoDate = new Date().toISOString().slice(0, 10);
  const ssotWritten = await writeUnifiedToSsot(workspaceRoot, unified, isoDate);

  const lines: string[] = ['### ✅ Instruction sync complete\n'];
  if (writeResult.updated.length > 0) {
    lines.push(`Mirrored the unified instructions into **${writeResult.updated.length}** tool file${writeResult.updated.length === 1 ? '' : 's'} (managed block only):`);
    for (const updatedPath of writeResult.updated) {
      lines.push(`- \`${updatedPath}\``);
    }
  } else {
    lines.push('No tool instruction files were detected to update.');
  }
  if (writeResult.skipped.length > 0) {
    lines.push('\n**Skipped:**');
    for (const skip of writeResult.skipped) {
      lines.push(`- \`${skip.path}\` — ${skip.reason}`);
    }
  }
  if (ssotWritten) {
    lines.push('\nThe unified set is saved to `project_memory/domain/ai-instructions-sync.md` and loaded as AtlasMind context.');
  }
  stream.markdown(lines.join('\n'));
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

async function handleDiscoverCommand(
  prompt: string,
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const query = prompt.trim();
  if (!query) {
    stream.markdown(
      'Usage: `/discover <what you need>` \u2014 searches enabled Agentic Resource Discovery (ARD) ' +
      'Agent Finders for MCP servers, agents, skills, and APIs.',
    );
    stream.button({
      command: 'atlasmind.openResourceDiscovery',
      title: 'Open Resource Discovery',
      tooltip: 'Manage Agent Finders and browse discovered resources.',
    });
    return;
  }

  const endpoints = atlas.ardRegistry.listEnabled();
  if (endpoints.length === 0) {
    stream.markdown(
      '### Resource Discovery\n\n' +
      'No Agent Finders are enabled. Finders ship **disabled** so AtlasMind makes no outbound ' +
      'discovery calls until you opt in. Open Resource Discovery and enable a finder ' +
      '(e.g. GitHub Agent Finder or Hugging Face Discover) to search.',
    );
    stream.button({
      command: 'atlasmind.openResourceDiscovery',
      title: 'Open Resource Discovery',
      tooltip: 'Enable an Agent Finder, then run /discover again.',
    });
    return;
  }

  stream.progress(`Searching ${endpoints.length} Agent Finder(s) for \u201c${query}\u201d\u2026`);

  let results: import('../types.js').ArdDiscoveredResource[];
  let errors: Array<{ endpoint: string; message: string }>;
  try {
    const outcome = await atlas.ardClient.searchEndpoints(endpoints, query);
    results = outcome.results;
    errors = outcome.errors;
  } catch (err) {
    stream.markdown(`\u274c Discovery failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  atlas.ardRegistry.setRecentResults(results);

  if (results.length === 0) {
    stream.markdown(
      `No resources found for **${query}** across ${endpoints.length} finder(s).` +
      (errors.length > 0 ? `\n\n_Finder errors:_\n${errors.map(e => `- ${e.endpoint}: ${e.message}`).join('\n')}` : ''),
    );
    return;
  }

  const rows = results.map(r => {
    const score = typeof r.score === 'number' ? `${r.score}/100` : '\u2014';
    const ref = r.url ? ` [link](${r.url})` : '';
    return `| ${escapeTableCell(r.displayName)} | \`${escapeTableCell(shortDiscoverType(r.type))}\` | ${score} | ${escapeTableCell(r.sourceName)} |${ref}`;
  });
  stream.markdown(
    `### Discovered ${results.length} resource(s) for \u201c${query}\u201d\n\n` +
    `| Resource | Type | Relevance | Finder |\n|---|---|---|---|\n${rows.join('\n')}\n\n` +
    `_Relevance is a semantic match score \u2014 **not** a trust, compliance, or safety rating. ` +
    `Review each resource before installing._`,
  );

  if (errors.length > 0) {
    stream.markdown(`\n_${errors.length} finder(s) errored: ${errors.map(e => `${e.endpoint} (${e.message})`).join('; ')}._`);
  }

  // Offer one-click install for the top results (MCP servers land disabled behind the MCP trust gate).
  for (const r of results.slice(0, 5)) {
    stream.button({
      command: 'atlasmind.ard.installEntry',
      title: `Install: ${r.displayName}`,
      arguments: [r.identifier],
      tooltip: `Install "${r.displayName}" (${r.type}). MCP servers are added disabled for you to review.`,
    });
  }
  stream.button({
    command: 'atlasmind.openResourceDiscovery',
    title: 'Open Resource Discovery',
    tooltip: 'Browse all results, manage finders, or export this project\'s catalog.',
  });
}

function shortDiscoverType(type: string): string {
  return type.replace(/^application\//, '').replace(/\+json$/, '').replace(/^vnd\.atlasmind\./, '');
}

function escapeTableCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
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
  token: vscode.CancellationToken,
  atlas: AtlasMindContext,
  sessionId: string,
): Promise<ProjectRunOutcome | undefined> {
  const prompt = request.prompt;
  const roadmapStatusMarkdown = await buildRoadmapStatusMarkdown(prompt);
  if (roadmapStatusMarkdown) {
    stream.markdown(roadmapStatusMarkdown);
    return undefined;
  }
  if (await handleRoutineEditIntent(prompt, stream, atlas)) {
    return undefined;
  }
  const imageAttachments = await resolveInlineImageAttachments(prompt);
  const responseText = await runChatTask(prompt, stream, atlas, imageAttachments, sessionId);

  // If the reply offered an autonomous project run, flow straight into it rather
  // than stopping for the operator to type "Proceed" — they already asked for the
  // job. Calls the run with a bare goal (not pre-approved) so the file-count safety
  // gate in runProjectCommand stays active for unusually large runs.
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const autoFlow = resolveProjectRunAutoFlow(
    responseText,
    atlas.sessionConversation.getTranscript(sessionId),
    {
      enabled: configuration.get<boolean>('autoStartProposedProjectRuns', true),
      autopilot: atlas.toolApprovalManager?.isAutopilot?.() ?? false,
    },
  );
  if (!autoFlow || token.isCancellationRequested) {
    return undefined;
  }

  stream.markdown(`\n\n---\n\n${autoFlow.notice}\n\n`);
  const { sessionContextBundle, sessionContext } = await prepareProjectRunContext(atlas, sessionId);
  return runProjectCommand(autoFlow.goal, stream, token, atlas, sessionId, sessionContextBundle, sessionContext);
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
): Promise<string> {
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

  return reconciled.transcriptText;
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

function capitalizeFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Strip bold/inline-code emphasis so a question/option line can be matched and shown cleanly. */
function stripMarkdownEmphasis(line: string): string {
  return line.replace(/\*\*|__|`/g, '').trim();
}

/** Strip a leading list/quote marker (e.g. "- ", "1. ", "> ") from a line. */
function stripLeadingMarker(line: string): string {
  return line.replace(/^\s*(?:[-*•>]\s+|\d+[.)]\s+)/, '').trim();
}

/** True when a line is a markdown bullet or numbered list item with content. */
function isOptionLine(line: string): boolean {
  return /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(line);
}

function endsWithQuestion(line: string): boolean {
  return /\?\s*$/.test(stripMarkdownEmphasis(line));
}

/** Extract a clean pick-one label from a list-item line (lead phrase before any "— explanation"). */
function extractOptionLabel(line: string): string {
  let label = line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '');
  label = label.replace(/\*\*|__|`/g, '');
  label = label.split(/\s+[—–]\s+|\s+-\s+|:\s+/)[0];
  return label.replace(/[.,;:!?]+\s*$/, '').trim();
}

/** Extract the question clause (last sentence ending in "?") from a line. */
function extractQuestionClause(line: string): string | undefined {
  const stripped = stripLeadingMarker(stripMarkdownEmphasis(line));
  const match = /([^.!?]*\?)\s*$/.exec(stripped);
  const question = (match?.[1] ?? stripped).trim();
  return question.length >= 6 && question.length <= 300 ? question : undefined;
}

/**
 * Locate the response's trailing question and any adjacent enumerated option
 * list. Handles three real shapes that the old single-regex missed:
 *  - the question is the last line (optionally a markdown bullet);
 *  - the question is followed by a markdown/numbered option list;
 *  - the option list is followed by the question.
 * Falls back to {@link RESPONSE_TRAILING_QUESTION_PATTERN} for a mid-line
 * question at the very end.
 */
function analyzeTrailingQuestion(text: string): { question: string; optionLines: string[] } | undefined {
  if (!text) { return undefined; }
  const lines = text.split('\n').map(line => line.trim());
  let end = lines.length - 1;
  while (end >= 0 && lines[end] === '') { end -= 1; }
  if (end < 0) { return undefined; }

  let questionIdx = -1;
  let optionLines: string[] = [];

  if (endsWithQuestion(lines[end])) {
    questionIdx = end;
    // Gather a contiguous option block immediately above the question.
    let k = end - 1;
    while (k >= 0 && lines[k] === '') { k -= 1; }
    const block: string[] = [];
    while (k >= 0 && isOptionLine(lines[k])) { block.unshift(lines[k]); k -= 1; }
    optionLines = block;
  } else if (isOptionLine(lines[end])) {
    // Trailing option block; the question is the first non-empty line above it.
    let k = end;
    const block: string[] = [];
    while (k >= 0 && isOptionLine(lines[k])) { block.unshift(lines[k]); k -= 1; }
    while (k >= 0 && lines[k] === '') { k -= 1; }
    if (k >= 0 && endsWithQuestion(lines[k])) {
      questionIdx = k;
      optionLines = block;
    }
  }

  if (questionIdx < 0) {
    const match = RESPONSE_TRAILING_QUESTION_PATTERN.exec(text);
    return match?.[1] ? { question: match[1].trim(), optionLines: [] } : undefined;
  }

  const question = extractQuestionClause(lines[questionIdx]);
  return question ? { question, optionLines } : undefined;
}

/** Confirmatory / first-person-offer / permission questions that take a yes or no. */
function isYesNoQuestion(question: string): boolean {
  return /^\s*(?:(?:want|would\s+you\s+(?:like)?|shall\s+(?:i|we)|should\s+(?:i|we)|do\s+you\s+(?:want|need)|can\s+i|could\s+i|may\s+i|want\s+me|ready|proceed)\b|(?:is\s+that|does\s+that|does\s+this|are\s+you)\b)/i.test(question)
    || /\b(?:sounds?\s+good|looks?\s+good|makes?\s+sense|ok(?:ay)?(?:\s+with\s+you)?)\s*\?*\s*$/i.test(question);
}

/** A question that asks the user to choose between discrete options. */
function isSelectionQuestion(question: string): boolean {
  return /\b(?:which|pick|choose|select|prefer|priorit(?:ise|ize|y)|start\s+with|focus\s+on|tackle|first|next|option|approach|where\s+should)\b/i.test(question);
}

/**
 * Inspect the end of a response and, if it ends with a question, produce
 * quick-reply pill options the user can click to respond in one tap. Recognises:
 * yes/no, an enumerated markdown/numbered option list, an inline "A, B, or C?"
 * list, and "A or B?".
 *
 * Detection is conservative so it never fabricates buttons on rhetorical or open
 * questions: a list only becomes pick-one pills when the question is clearly a
 * selection question, so a yes/no question above a *findings* list stays yes/no.
 */
export function detectResponseQuickReplies(responseText: string): {
  followupQuestion: string;
  quickReplies?: SessionSuggestedFollowup[];
} | undefined {
  const analysis = analyzeTrailingQuestion(responseText.trim());
  if (!analysis) { return undefined; }
  const { question, optionLines } = analysis;

  // Yes / No — confirmatory questions (checked first so a yes/no question that
  // happens to sit above a list is never mistaken for a pick-one).
  if (isYesNoQuestion(question)) {
    return {
      followupQuestion: question,
      quickReplies: [
        { label: 'Yes', prompt: 'yes' },
        { label: 'No', prompt: 'no' },
      ],
    };
  }

  // Enumerated markdown / numbered list — "Which …?\n- A\n- B\n- C" (2–5 options),
  // in either order. Only for selection-style questions.
  if (optionLines.length >= 2 && isSelectionQuestion(question)) {
    const labels = optionLines.map(extractOptionLabel).filter(label => label.length >= 2 && label.length <= 48);
    if (labels.length === optionLines.length && labels.length >= 2 && labels.length <= 5) {
      return {
        followupQuestion: question,
        quickReplies: labels.map(label => ({ label: capitalizeFirst(label), prompt: label })),
      };
    }
  }

  // Inline enumerated list — "…: A, B, or C?" style questions (3–4 options).
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
          quickReplies: cleaned.map(opt => ({ label: capitalizeFirst(opt), prompt: opt })),
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
          { label: capitalizeFirst(optA), prompt: optA },
          { label: capitalizeFirst(optB), prompt: optB },
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

/**
 * Within a roadmap-context prompt, distinguish "plan/build the route to MVP" (collect gaps then
 * hand off to real planning) from an explicit "status/progress" question (deterministic summary).
 * An explicit status word always wins so "outstanding roadmap items" stays a status request.
 */
export function isRoadmapPlanIntent(prompt: string): boolean {
  if (ROADMAP_STATUS_INTENT_PATTERN.test(prompt)) {
    return false;
  }
  return ROADMAP_PLAN_INTENT_PATTERN.test(prompt);
}

export function summarizeRoadmapStatus(files: Array<{ path: string; content: string }>): RoadmapStatusSnapshot {
  const items = files.flatMap(file => extractRoadmapChecklistItems(file.path, file.content));
  const completed = items.filter(item => item.kind === 'completed').length;
  const outstanding = items.filter(item => item.kind === 'task');

  // De-duplicate profile questions by field so the same unanswered field across multiple
  // roadmap files is only posed once.
  const seenQuestions = new Set<string>();
  const questions: RoadmapQuestion[] = [];
  for (const item of items) {
    if (item.kind !== 'question' || !item.question) {
      continue;
    }
    const key = item.question.fieldLabel.toLowerCase();
    if (seenQuestions.has(key)) {
      continue;
    }
    seenQuestions.add(key);
    questions.push(item.question);
  }

  // Shipped release notes, resolved metadata, and scaffold descriptors are deliberately excluded
  // from the tally so the progress count reflects real open work, not template noise.
  return {
    completed,
    total: completed + outstanding.length + questions.length,
    outstanding,
    questions,
  };
}

/** A deterministic roadmap reply plus any composer-prefill chips to surface beneath it. */
export interface RoadmapStatusResult {
  markdown: string;
  questions: RoadmapQuestion[];
  /** Chips rendered under the reply; at most one combined "Answer all" prefill. */
  prefills: SessionComposerPrefill[];
}

export async function buildRoadmapStatusResult(prompt: string): Promise<RoadmapStatusResult | undefined> {
  if (!isRoadmapStatusPrompt(prompt)) {
    return undefined;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    return { markdown: '### Roadmap Status\n\nOpen a workspace to inspect the live roadmap files.', questions: [], prefills: [] };
  }

  const ssotPath = normalizeSsotPathForLookup(
    vscode.workspace.getConfiguration('atlasmind').get<string>('ssotPath', DEFAULT_SSOT_PATH),
  );
  const roadmapRoot = path.join(workspaceRoot, ssotPath, 'roadmap');
  const files = await readRoadmapMarkdownFiles(roadmapRoot, workspaceRoot);
  const snapshot = summarizeRoadmapStatus(files);

  // A "plan/build the route to MVP" request wants an actual plan. If profile gaps block that, ask
  // only those (compact, no checklist dump); once answered, the normal pipeline does the planning.
  // With no gaps, defer entirely so the model plans rather than returning a status summary.
  if (isRoadmapPlanIntent(prompt)) {
    if (snapshot.questions.length === 0) {
      return undefined;
    }
    return buildRoadmapPlanGapsReply(snapshot.questions);
  }

  if (snapshot.total === 0) {
    return {
      markdown: `### Roadmap Status\n\nNo tracked roadmap checklist items were found in \`${ssotPath}/roadmap/\`.`,
      questions: [],
      prefills: [],
    };
  }

  return buildRoadmapStatusReply(snapshot);
}

/** Plan-intent reply: pose only the blocking profile gaps, with a single combined answer chip. */
function buildRoadmapPlanGapsReply(questions: RoadmapQuestion[]): RoadmapStatusResult {
  const lines = [
    '### Plan your MVP',
    '',
    'I can map the fastest safe route — first I need a few project basics so the plan fits your actual stack and audience:',
    '',
  ];
  questions.forEach((item, index) => lines.push(`${index + 1}. ${item.question}`));
  lines.push(
    '',
    `Tap **${questions.length > 1 ? `Answer all ${questions.length} questions` : 'Answer this'}** below to fill them in one message — I'll record them and turn the backlog into an ordered MVP plan.`,
  );
  return { markdown: lines.join('\n'), questions, prefills: [buildRoadmapAnswerAllPrefill(questions)] };
}

/** Status-intent reply: counts + answerable questions, with the outstanding list collapsed. */
function buildRoadmapStatusReply(snapshot: RoadmapStatusSnapshot): RoadmapStatusResult {
  const lines = [
    '### Roadmap Status',
    '',
    `- Dashboard-aligned progress: **${snapshot.completed}/${snapshot.total}** roadmap item(s) marked complete.`,
    `- Outstanding roadmap items: **${snapshot.outstanding.length}**.`,
  ];
  if (snapshot.questions.length > 0) {
    lines.push(`- Open questions you can answer now: **${snapshot.questions.length}**.`);
  }

  if (snapshot.outstanding.length === 0 && snapshot.questions.length === 0) {
    lines.push('', 'All tracked roadmap items are currently marked complete.');
    return { markdown: lines.join('\n'), questions: [], prefills: [] };
  }

  if (snapshot.questions.length > 0) {
    lines.push(
      '',
      '#### Questions to unblock the plan',
      '',
      `Answer any of these and I'll fold them into the roadmap — tap **${snapshot.questions.length > 1 ? 'Answer all' : 'Answer this'}** below, or just reply:`,
      '',
    );
    snapshot.questions.forEach((item, index) => lines.push(`${index + 1}. ${item.question}`));
  }

  if (snapshot.outstanding.length > 0) {
    // Heading matches the chat panel's auxiliary-section detector, so the list renders collapsed.
    lines.push('', '#### Outstanding roadmap items', '');
    for (const item of snapshot.outstanding.slice(0, 25)) {
      lines.push(`- \`${item.path}\` — ${item.text}`);
    }
    if (snapshot.outstanding.length > 25) {
      lines.push(`- ...and **${snapshot.outstanding.length - 25}** more.`);
    }
  }

  const prefills = snapshot.questions.length > 0 ? [buildRoadmapAnswerAllPrefill(snapshot.questions)] : [];
  return { markdown: lines.join('\n'), questions: snapshot.questions, prefills };
}

export async function buildRoadmapStatusMarkdown(prompt: string): Promise<string | undefined> {
  return (await buildRoadmapStatusResult(prompt))?.markdown;
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
  // When a file delimits its real backlog with managed-block markers (improvement-plan.md), only
  // checklist items inside the block are genuine work; everything else (Project Context legend,
  // Prioritisation Notes) is scaffold we must not count as outstanding.
  const startMatch = content.match(ROADMAP_MANAGED_BLOCK_START);
  const endMatch = content.match(ROADMAP_MANAGED_BLOCK_END);
  const hasBlock = Boolean(startMatch && endMatch && (startMatch.index ?? 0) < (endMatch.index ?? 0));
  const blockStart = startMatch?.index ?? -1;
  const blockEnd = endMatch?.index ?? -1;

  const items: RoadmapChecklistItem[] = [];
  for (const match of content.matchAll(/^\s*(?:[-*]|\d+\.)\s+(.+?)\s*$/gm)) {
    const text = match[1]?.trim();
    if (!text) {
      continue;
    }
    const insideBlock = hasBlock && (match.index ?? 0) > blockStart && (match.index ?? 0) < blockEnd;
    items.push(classifyRoadmapLine(text, filePath, { hasBlock, insideBlock }));
  }
  return items;
}

/**
 * Classify a roadmap bullet so the status reply can distinguish real open work from changelog
 * noise (shipped release notes), resolved metadata, scaffold descriptors, and the answerable
 * profile-field questions the user can resolve inline.
 */
function classifyRoadmapLine(
  rawText: string,
  filePath: string,
  block: { hasBlock: boolean; insideBlock: boolean },
): RoadmapChecklistItem {
  const completed = /^(?:✅|\[[xX]\])/.test(rawText);
  // Strip the leading status marker so the displayed text never shows a redundant "[ ]".
  const text = rawText.replace(/^(?:✅|\[[ xX]\])\s*/, '').trim() || rawText;
  const make = (kind: RoadmapItemKind, question?: RoadmapQuestion): RoadmapChecklistItem =>
    ({ path: filePath, text, completed, kind, ...(question ? { question } : {}) });

  // Release history is a shipped changelog, not a backlog — never count it as outstanding.
  if (/(?:^|\/)release-history\.md$/i.test(filePath)) {
    return make('shipped');
  }

  // Profile / metadata fields shaped as "Key: Value" (kept regardless of managed-block position,
  // since the project profile lives outside the backlog block).
  const fieldMatch = text.match(/^([A-Za-z][A-Za-z /]{1,28}):\s*(.*)$/);
  if (fieldMatch) {
    const key = fieldMatch[1].trim().toLowerCase();
    const value = fieldMatch[2].trim();
    const known = ROADMAP_PROFILE_FIELDS[key];
    const unanswered = value === '' || ROADMAP_UNSPECIFIED_VALUES.has(value.toLowerCase());
    if (known) {
      return unanswered ? make('question', buildProfileQuestion(key, known, filePath)) : make('metadata');
    }
    // Unknown key, but explicitly unspecified → still a question the user can answer.
    if (unanswered && value !== '') {
      return make('question', buildProfileQuestion(key, undefined, filePath));
    }
  }

  // A checklist line outside a file's managed backlog block is scaffold/legend prose, not work.
  if (block.hasBlock && !block.insideBlock) {
    return make('descriptor');
  }

  return make(completed ? 'completed' : 'task');
}

function buildProfileQuestion(
  key: string,
  known: { question: string; label: string } | undefined,
  sourcePath: string,
): RoadmapQuestion {
  return {
    question: known?.question ?? `What is the ${key}?`,
    fieldLabel: known?.label ?? toTitleCase(key),
    sourcePath,
  };
}

function toTitleCase(value: string): string {
  return value.replace(/\b\w/g, character => character.toUpperCase());
}

/**
 * Build the single "Answer all" chip that pre-fills the composer with a fill-in-the-blank block
 * covering every open profile question, so the user resolves them in one message.
 */
function buildRoadmapAnswerAllPrefill(questions: RoadmapQuestion[]): SessionComposerPrefill {
  const intro = 'Project basics (fill in and send — I\'ll record them, then plan from there):';
  const fieldLines = questions.map(question => `${question.fieldLabel}: `);
  const template = [intro, ...fieldLines].join('\n');
  // Drop the cursor right after the first field's "Label: " so the user can start typing immediately.
  const cursorOffset = intro.length + 1 + questions[0].fieldLabel.length + 2;
  return {
    label: questions.length > 1 ? `Answer all ${questions.length} questions` : 'Answer this',
    template,
    description: 'Fill in the project basics in one message',
    cursorOffset,
  };
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

/** Result of {@link resolveProjectRunAutoFlow}: the goal to run plus the notice to surface first. */
export interface ProjectRunAutoFlow {
  /** The goal to execute — identical to what typing "Proceed" would resolve. */
  goal: string;
  /** Markdown notice shown before the run starts (cancellable, or Autopilot variant). */
  notice: string;
}

/**
 * True when the assistant's reply ends by offering to start an autonomous project
 * run. Conservative by construction: it requires explicit project/autonomous-run
 * vocabulary {@link PROJECT_RUN_PROPOSAL_INTENT_PATTERN} **and** a first-person
 * go-ahead offer, vetoes negation/deferral, and — when the reply closes with a
 * question — only matches if that question is itself an offer (so requirement-
 * gathering questions never trigger an auto-run).
 */
export function detectProjectRunProposal(responseText: string): boolean {
  const trimmed = responseText.trim();
  if (!trimmed) {
    return false;
  }

  // The offer/readiness line lives at the tail of the reply; bound the scan so an
  // unrelated mid-reply mention of "project run" can't trip detection.
  const window = trimmed.slice(-400);
  if (!PROJECT_RUN_PROPOSAL_INTENT_PATTERN.test(window)) {
    return false;
  }
  if (PROJECT_RUN_PROPOSAL_NEGATION_PATTERN.test(window)) {
    return false;
  }

  // If the reply closes with a question, it must be an *offer* ("Want me to …?"),
  // not an information-seeking one ("What stack are you using?"). An info question
  // means the model is still gathering requirements — don't auto-start.
  const trailingQuestion = RESPONSE_TRAILING_QUESTION_PATTERN.exec(trimmed)?.[1]?.trim();
  if (trailingQuestion) {
    return ASSISTANT_OFFER_LEAD_IN_PATTERN.test(trailingQuestion)
      || PROJECT_RUN_OFFER_PATTERN.test(trailingQuestion);
  }

  // No closing question: accept a first-person readiness statement that offers to run.
  return PROJECT_RUN_OFFER_PATTERN.test(window);
}

/** The notice rendered before an auto-flowed run — Autopilot is immediate; otherwise it's cancellable. */
export function buildProjectRunAutoFlowNotice(goal: string, autopilot: boolean): string {
  const display = truncateForSummary(goal, 160);
  if (autopilot) {
    return `**Autopilot** — auto-continuing into a project run.\n\nGoal: \`${display}\``;
  }
  return `Starting a project run to: **${display}**\n\n_Use Stop to cancel._`;
}

/**
 * Single entry point both chat surfaces use to decide whether a freeform reply that
 * proposed a project run should flow straight into one. Reuses the exact goal that
 * typing "Proceed" resolves ({@link resolveAutonomousContinuationGoal}), so auto-flow
 * changes nothing about execution — it only removes the manual confirmation keystroke.
 * Returns undefined (no auto-flow) when disabled, when no run was proposed, or when no
 * actionable goal resolves.
 */
export function resolveProjectRunAutoFlow(
  responseText: string,
  transcript: SessionTranscriptEntry[],
  options: { enabled: boolean; autopilot: boolean },
): ProjectRunAutoFlow | undefined {
  if (!options.enabled) {
    return undefined;
  }
  if (!detectProjectRunProposal(responseText)) {
    return undefined;
  }
  const goal = resolveAutonomousContinuationGoal('proceed', transcript)?.trim();
  if (!goal) {
    return undefined;
  }
  return { goal, notice: buildProjectRunAutoFlowNotice(goal, options.autopilot) };
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

/** Append the loop approval token so `runLoopCommand` starts the mission immediately (used by the chat panel's "New Loop"). */
export function toApprovedLoopPrompt(goal: string): string {
  const normalized = goal.replace(LOOP_APPROVAL_TOKEN, '').trim();
  return normalized.length > 0 ? `${normalized} ${LOOP_APPROVAL_TOKEN}` : LOOP_APPROVAL_TOKEN;
}

/** How a Mission Loop surface renders its interactive gates (checkpoint + block). */
export interface MissionLoopInteraction {
  checkpointGate: (request: MissionCheckpointRequest) => Promise<boolean>;
  /** Ask the user how to resolve a recoverable setting block (UI only — the override is applied by the gate). */
  blockAsk: (request: MissionBlockedRequest) => Promise<MissionBlockResolution>;
}

/**
 * Default block-resolution prompt: an OS modal offering Override (relax the
 * setting for this run), Open settings (deep-link), or Stop. Used by the `@atlas`
 * chat view, which cannot host in-line blocking buttons. The chat panel and
 * Mission Control inject their own in-surface ask instead.
 */
export async function modalMissionBlockAsk(request: MissionBlockedRequest): Promise<MissionBlockResolution> {
  const choice = await vscode.window.showWarningMessage(
    `Mission blocked: ${request.blocker.title}`,
    {
      modal: true,
      detail:
        `${request.blocker.detail}\n\n` +
        `Setting: ${request.blocker.settingKey}\n\n` +
        'Override it just for this run, open settings to change it, or stop the mission.',
    },
    'Override for this run',
    'Open settings',
    'Stop',
  );
  if (choice === 'Override for this run') {
    return 'override-once';
  }
  if (choice === 'Open settings') {
    await vscode.commands.executeCommand(request.blocker.settingsCommand);
    return 'open-settings';
  }
  return 'stop';
}

/**
 * Build a Mission Loop `blockedGate` from a UI `ask` function. The `ask` only
 * decides the resolution; this gate applies the in-run setting override when the
 * user chooses "override" and reverts it via `restoreOverrides()` (which the
 * caller must invoke when the run ends). Keeps the override side-effect in one
 * place regardless of whether the surface uses a modal or in-chat buttons.
 */
export function createMissionSettingBlockGate(
  ask: (request: MissionBlockedRequest) => Promise<MissionBlockResolution>,
): {
  blockedGate: (request: MissionBlockedRequest) => Promise<MissionBlockResolution>;
  restoreOverrides: () => Promise<void>;
} {
  const applied: Array<{ configKey: string; original: unknown }> = [];

  const blockedGate = async (request: MissionBlockedRequest): Promise<MissionBlockResolution> => {
    const choice = await ask(request);
    if (choice === 'override-once') {
      const configuration = vscode.workspace.getConfiguration('atlasmind');
      applied.push({ configKey: request.blocker.configKey, original: configuration.inspect(request.blocker.configKey)?.workspaceValue });
      try {
        await configuration.update(request.blocker.configKey, request.blocker.overrideValue, vscode.ConfigurationTarget.Workspace);
        return 'override-once';
      } catch {
        applied.pop();
        return 'stop';
      }
    }
    return choice;
  };

  const restoreOverrides = async (): Promise<void> => {
    if (applied.length === 0) {
      return;
    }
    const configuration = vscode.workspace.getConfiguration('atlasmind');
    for (const entry of applied.splice(0)) {
      try {
        await configuration.update(entry.configKey, entry.original, vscode.ConfigurationTarget.Workspace);
      } catch {
        // Best-effort restore — leave the user's setting as-is on failure.
      }
    }
  };

  return { blockedGate, restoreOverrides };
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
