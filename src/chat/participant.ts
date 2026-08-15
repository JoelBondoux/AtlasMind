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
import {
  describeImageRejections,
  mergeImageAttachments,
  resolveInlineImageAttachmentsDetailed,
  resolvePickedImageAttachmentsDetailed,
} from './imageAttachments.js';
import type { ImageAttachmentResolution } from './imageAttachments.js';
import { ATLAS_SLASH_COMMANDS } from '../views/chatSlashRouting.js';
import { detectGovernedAction } from '../core/workflowChatGuard.js';
import { answerConversationRecall, parseConversationRecallRequest } from '../core/conversationRecall.js';
import { deriveSessionFitSuggestions } from '../core/sessionFitSuggestions.js';
import { buildCapabilityIndex } from '../core/capabilityIndex.js';
import { assessIdeationReadiness } from '../core/ideationReadiness.js';
import { extractItemGates, parseRoadmapGates, stripRoadmapGatesBlock } from '../core/roadmapGates.js';
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
/** Where a drafted operator-feedback note waits until somebody asks for it to be written. */
const PENDING_OPERATOR_FEEDBACK_STORAGE_KEY = 'atlasmind.pendingOperatorFeedback';
/**
 * The values an earlier build wrote on the operator's behalf. Kept only so
 * {@link restoreSettingsWrittenWithoutAsking} can recognise its own handiwork
 * and put the originals back; nothing writes them any more.
 */
const MIN_FRUSTRATION_SESSION_TURNS = 8;
const MIN_FRUSTRATION_SESSION_CHARS = 4000;
const FRUSTRATION_SETTINGS_STORAGE_KEY = 'atlasmind.frustrationSettingsSnapshot';
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
/**
 * A prompt asking to be *told* something, which is never an executable goal.
 *
 * Two shapes, and only the first was recognised. The interrogative — "what does
 * X do?" — needs its question mark. The imperative — "tell me about who makes
 * playwright", "explain the routing", "describe the pipeline" — asks for exactly
 * the same thing and carries no question mark at all, so it read as an
 * actionable prompt.
 *
 * Observed: `carry on` after "tell me about who makes playwright" started an
 * autonomous project run whose stated goal was that sentence. It touched four
 * files and every model attempt failed. The Preview prints its goal now, which
 * is the only reason the run was legible as wrong rather than merely
 * unsuccessful.
 */
/**
 * A prompt that asks for an answer rather than for work.
 *
 * The interrogative branch used to require a trailing `?`, while the imperative
 * branch never did — so "explain the router" was informational and "what was my
 * question three turns ago" was an executable goal, which is how `carry on`
 * started an autonomous run whose stated goal was a question about the
 * conversation. Typing the question mark is optional in practice, and omitting
 * it is commonest when typing quickly, which is exactly when somebody then says
 * "carry on".
 *
 * That asymmetry is gone: an opening interrogative is informational whatever it
 * ends with. This is the fourth detector here to key on `?` and be wrong for it
 * — a full stop inside a filename (0.311.1), no question mark at all (0.315.0),
 * something after the question mark (0.320.0) — and the lesson is the same each
 * time: the punctuation is not the signal, the opening word is.
 */
const INFORMATIONAL_QUESTION_PATTERN = /^\s*(?:(?:what|why|how|which|where|when|who|whose|whom)\b[\s\S]*\?\s*$|(?:please\s+)?(?:tell\s+me\s+(?:about|what|how|why)|explain|describe|summari[sz]e|walk\s+me\s+through|what'?s\s+the\s+difference|remind\s+me)\b)/i;

/**
 * The same question, typed without the question mark.
 *
 * Narrower than the punctuated form, because dropping the `?` requirement
 * wholesale reads statements as questions. Two exclusions carry that:
 *
 * - **`when` and `where` are omitted.** They open a subordinate clause at least
 *   as often as a question — "When AtlasMind prompts for tool use it should
 *   offer Autopilot" is a requirement, not an enquiry.
 * - **An obligation modal disqualifies it.** "What the router should do is pick
 *   the cheapest model" states a rule; a person asking a question does not tell
 *   you what the answer must be.
 *
 * Everything else opening with an interrogative is treated as a question,
 * because typing the mark is optional and skipping it is commonest when typing
 * quickly — which is exactly when somebody then says "carry on".
 */
const UNPUNCTUATED_QUESTION_PATTERN = /^\s*(?:what|why|how|which|who|whose|whom)\b/i;
const OBLIGATION_MODAL_PATTERN = /\b(?:should|must|shall|needs?\s+to|has\s+to|have\s+to|ought\s+to)\b/i;

/** True when the prompt asks for an answer rather than for work. */
function isInformationalQuestion(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (INFORMATIONAL_QUESTION_PATTERN.test(trimmed)) {
    return true;
  }
  return UNPUNCTUATED_QUESTION_PATTERN.test(trimmed) && !OBLIGATION_MODAL_PATTERN.test(trimmed);
}
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
const PROJECT_RUN_META_ACTION_PREFIX = /^\s*(?:(?:go\s+ahead\s+and\s+)?(?:kick\s+off|start|launch|begin)\s+)?(?:an?\s+|the\s+)?(?:autonomous\s+)?(?:project\s+)?run\b(?:\s+(?:to|for|on|about))?\s*/i;
const DEICTIC_PROJECT_RUN_ACTION = /^(?:(?:build|implement|fix|do|run|execute|handle|complete)\s+)?(?:this|that|it)(?:\s+(?:out|work|plan|change|implementation))?$/i;
/**
 * A closing offer whose whole content is the *permission being asked for* rather
 * than the work.
 *
 * "Shall I go ahead?" strips its offer lead-in to `go ahead`, and that string
 * used to become the project goal — so the plan, the subtask table, the file
 * estimate and the cost estimate were all derived from the word the operator
 * used to agree. It also explains why such a run reads as unannounced: its
 * stated goal is a fragment of a sentence rather than anything anybody asked
 * for.
 */
const BARE_AFFIRMATION_ACTION = /^(?:go\s+ahead|proceed|continue|carry\s+on|do\s+it|do\s+that|start|begin|run\s+it|yes|ok(?:ay)?|sure|please)[.!]?$/i;
/**
 * An offer to talk rather than to act. Saying yes to "Shall I explain the
 * routing?" is a conversation, and drawing a Start-run card on it would make the
 * card mean nothing.
 */
const NON_EXECUTING_OFFER_ACTION = /^(?:explain|describe|show you|tell you|walk (?:you )?through|summari[sz]e|clarify|answer|go over|talk through|outline)\b/i;
/** "go ahead and <work>" — the affirmation is a preamble, the work follows it. */
const GO_AHEAD_PREFIX_PATTERN = /^(?:go\s+ahead\s+and|please\s+go\s+ahead\s+and)\s+/i;
/**
 * The assistant stating it is waiting on the operator before it can start.
 *
 * A bare "continue" supplies none of what was asked for, so it must not override
 * the precondition — the run would begin on exactly the information the model
 * said it did not have. A continuation that *carries* detail is different, and
 * is allowed through.
 */
const ASSISTANT_DEFERRAL_PATTERN = /\b(?:once you|after you|when you(?:'ve| have)|as soon as you|before (?:i|we) (?:start|begin|run|proceed))\b/i;
const SAVE_PROPOSED_RUN_PATTERN = /^\s*save\s+(?:this|the)\s+(?:proposed\s+)?(?:project\s+)?run\s+for\s+later[.!?]*\s*$/i;
const CANCEL_PROPOSED_RUN_PATTERN = /^\s*(?:cancel|dismiss|skip)\s+(?:this|the)\s+(?:proposed\s+)?(?:project\s+)?run[.!?]*\s*$/i;
const EXPLICIT_FIX_PROMPT_PATTERN = /\b(?:fix|patch|repair|resolve|implement|update|change|modify|correct|adjust|rewrite|refactor)\b/i;
const EXPLICIT_NO_FIX_PATTERN = /\b(?:do not fix|don't fix|without changing|no code changes|read only|explain only|question only)\b/i;
const CONCRETE_ISSUE_PROMPT_PATTERN = /\b(?:bug|issue|problem|broken|regression|failing|fails|error|incorrect|wrong|missing|stuck|overflow|scroll|layout|sidebar|dropdown|panel|webview|tooltip|session rail|hides|hidden|crash|hang|stops|stopped|too tall|too wide|not working|doesn't|does not|won't|will not|can't|cannot)\b/i;
const DEICTIC_EXECUTION_FOLLOWUP_PATTERN = /^\s*(?:please\s+)?(?:(?:go\s+ahead(?:\s+and)?|proceed|continue|resume|carry\s+on|do|handle|apply|merge|rebase|ship|run)\s+(?:that|this|it|them|those|these)|take\s+care\s+of\s+(?:that|this|it|them|those|these)|(?:can|could)\s+you\s+(?:do|handle|take\s+care\s+of|apply|merge|rebase|ship|run)\s+(?:that|this|it|them|those|these))(?:\s+for\s+me)?[\s.!?]*$/i;
/** Matches meta-execution commands like "Fix this issue autonomously" that reference a prior problem via deictic pronoun + autonomous modifier. These are not goal descriptions and should be skipped when scanning back through the transcript for the actual goal. */
const DEICTIC_FIX_EXECUTION_PATTERN = /^\s*(?:please\s+)?(?:fix|implement|resolve|apply|address)\s+(?:this|that|it|them|those|these)(?:\s+(?:issue|problem|bug|error|task|thing))?\b[^.!?]*\b(?:autonomously|automatically|without\s+waiting|on\s+autopilot|with\s+autopilot|continue\s+through)\b/i;
const CONTEXTUAL_FOLLOWUP_HINT_PATTERN = /\b(?:based\s+on\s+(?:this|the|our)\s+(?:chat|thread|conversation|discussion)|from\s+(?:this|the|our)\s+(?:chat|thread|conversation|discussion)|using\s+(?:this|the|our)\s+(?:chat|thread|conversation|discussion)|given\s+(?:this|the|our)\s+(?:chat|thread|conversation|discussion)|given\s+the\s+above|based\s+on\s+the\s+above|from\s+the\s+above|earlier\s+in\s+(?:the\s+)?(?:chat|thread|conversation)|previous\s+messages|prior\s+messages|conversation\s+so\s+far|thread\s+so\s+far)\b/i;
const AMBIGUOUS_CONTEXT_DEPENDENT_PROMPT_PATTERN = /^\s*(?:(?:why|how|what|which|where|when)\b|(?:and|also|instead)\b|(?:that|this|it|them|those|these)\b|(?:can|could|would|will)\s+you\s+(?:do|fix|change|update|explain|summari[sz]e|show|handle)\s+(?:that|this|it|them|those|these)\b)/i;
const STRONG_SUBJECT_SHIFT_HINT_PATTERN = /\b(?:create|generate|design|draw|make)\b[\s\S]{0,80}\b(?:image|logo|illustration|icon|graphic|banner|artwork|mockup|poster)\b|\b(?:image|logo|illustration|icon|graphic|banner|artwork|mockup|poster)\b[\s\S]{0,80}\b(?:create|generate|design|draw|make)\b/i;
/**
 * A short instruction that substitutes one thing for another — "use Playwright
 * instead", "switch to Vitest", "do it with fast-check rather than by hand".
 *
 * These carry a new noun and almost none of the previous turn's vocabulary, so
 * lexical overlap scores them as a change of subject when they are the opposite:
 * unanswerable *without* the previous turn. Bounded in length so a long prompt
 * that merely contains "instead" is still judged on its content.
 */
const INSTRUMENTAL_SUBSTITUTION_PATTERN = /^[\s\S]{0,120}\b(?:instead|rather than|in place of|switch to|swap (?:it |that )?(?:for|to)|use .{1,40} (?:instead|rather))\b[\s\S]{0,40}$/i;
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
  /** True when one or more subtasks paused at an agentic execution cap. */
  iterationLimitHit?: boolean;
  /** Suggested temporary/permanent maxToolIterations value for resuming the run. */
  suggestedIterationLimit?: number;
  /** Suggested temporary/permanent maxToolCallsPerTurn value for resuming the run. */
  suggestedToolCallsPerTurnLimit?: number;
  /**
   * Set when the run stopped at the file-count safety gate: the exact prompt that
   * would approve *this* run.
   *
   * Carried on the outcome rather than left to the operator to retype. The gate
   * used to end the turn with "re-run with `--approve`" and no control that could
   * do it, so the only way past a safety gate was to retype the goal by hand and
   * hope it matched — which is why the natural retry ("Proceed") looped forever.
   */
  approvalRequiredPrompt?: string;
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

const ATLASMIND_EXTENSION_ID = 'JoelBondoux.atlasmind';

/**
 * AtlasMind's own surface, for the prompt.
 *
 * Read from the running extension's manifest rather than a bundled copy, so it
 * cannot describe a previous release. Returns undefined when the manifest is not
 * reachable (tests, the CLI) rather than falling back to a stale list — the
 * model answering from its own recall is a known quantity, and a wrong list
 * presented as authoritative is worse.
 */
function buildCapabilityIndexContext(): string | undefined {
  try {
    const manifest = vscode.extensions.getExtension(ATLASMIND_EXTENSION_ID)?.packageJSON as
      | { contributes?: { configuration?: { properties?: Record<string, never> }; commands?: Array<{ command: string; title?: string }> } }
      | undefined;
    if (!manifest?.contributes) {
      return undefined;
    }
    return buildCapabilityIndex({
      settings: manifest.contributes.configuration?.properties,
      commands: manifest.contributes.commands,
    }).text;
  } catch {
    return undefined;
  }
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

  // Appended here rather than threaded through five call sites. Every surface
  // that reaches a model already carries workstation context, so this is the one
  // place that puts AtlasMind's own page and settings list in front of the model
  // everywhere at once.
  const capabilityIndex = buildCapabilityIndexContext();
  const workstation = `Workstation context:\n- ${lines.join('\n- ')}`;
  return capabilityIndex ? `${workstation}\n\n${capabilityIndex}` : workstation;
}

async function handleNativeChatRequest(
  request: vscode.ChatRequest,
  chatContext: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  atlas: AtlasMindContext,
): Promise<vscode.ChatResult> {
  const sessionId = resolveThreadSessionId(request, chatContext, atlas.sessionConversation);

  // Every turn goes through one dispatcher, whether or not a slash command is set.
  //
  // This used to answer plain turns inline and delegate only commands, which made
  // `handleChatRequest`'s default branch — and everything it reaches — unreachable
  // code on this surface: conversation recall, roadmap status, routine-edit intent,
  // inline image attachment, project-run auto-flow, the response footer, and the
  // typed-slash recovery whose own comment calls it load-bearing. Recall existed
  // and could not be reached from the surface the manifest advertises, while the
  // panel had it. One dispatcher is what makes "both surfaces behave identically"
  // a fact rather than a claim.
  return handleChatRequest(request, chatContext, stream, token, atlas, sessionId);
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

  // A short instruction that swaps one thing for another is contextual by
  // construction: "use Playwright instead" is unanswerable without knowing what
  // it replaces, and it shares no words with the prompts that set the topic. The
  // overlap test was measuring vocabulary rather than continuity, and dropped
  // the thread on exactly the turn that needed it most.
  if (INSTRUMENTAL_SUBSTITUTION_PATTERN.test(trimmed)) {
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
  // A prompt too short to state a subject is shorthand, and shorthand is
  // contextual. "git status" and "project_memory/" both carry exactly two topic
  // tokens, share none with what came before, and were dropped — after which a
  // model with no session to look at still narrated one, reporting that it had
  // made no changes on a turn where it had edited a file two turns earlier. The
  // subject-shift veto above still runs first, so an explicit change of topic
  // stays dropped however briefly it is put.
  if (promptTokens.length <= 2) {
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

/**
 * Slash commands declared in `package.json` under `contributes.chatParticipants`.
 *
 * Kept here so a command arriving as prompt text can be recovered rather than
 * handed to the general agent. Pinned by a test against the manifest, because
 * the failure of a stale list is silent: the command just quietly starts
 * behaving like a freeform question.
 */
/**
 * The commands both chat surfaces accept.
 *
 * Re-exported from `views/chatSlashRouting.ts`, which owns the list, rather than
 * declared here a second time. Two copies is how the chat panel came to have
 * never heard of commands the manifest declares — and the panel's failure mode
 * for an unrecognised command was to hand it to a model, silently.
 */
export const KNOWN_SLASH_COMMANDS: ReadonlySet<string> = new Set<string>(ATLAS_SLASH_COMMANDS);

/**
 * Run one deterministic slash command against a response stream.
 *
 * Split out of {@link handleChatRequest} so the AtlasMind chat panel can run the
 * **same** handlers through a collecting stream instead of growing its own
 * near-copies. `/project` and `/loop` are deliberately absent: they are
 * long-running, need cancellation and a prepared run context, and each surface
 * already owns that path natively — the panel through its composer's run and
 * loop modes. Returns `false` for anything it does not handle, so a caller can
 * tell "ran it" from "not mine" without matching on the command list twice.
 */
export async function runDeterministicSlashCommand(
  command: string,
  argument: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  atlas: AtlasMindContext,
  sessionId: string,
): Promise<boolean> {
  switch (command) {
    case 'bootstrap': await handleBootstrapCommand(stream, atlas); return true;
    case 'import': await handleImportCommand(stream, atlas); return true;
    case 'agents': await handleAgentsCommand(stream, atlas); return true;
    case 'skills': await handleSkillsCommand(stream, atlas); return true;
    case 'discover': await handleDiscoverCommand(argument, stream, atlas); return true;
    case 'memory': await handleMemoryCommand(argument, stream, atlas); return true;
    case 'cost': await handleCostCommand(stream, atlas); return true;
    case 'runs': await handleRunsCommand(stream); return true;
    case 'director': await handleDirectorCommand(stream, atlas); return true;
    case 'buzz': await handleBuzzCommand(argument, stream, atlas, token); return true;
    case 'acp': await handleAcpCommand(argument, stream, atlas); return true;
    case 'lens': await handleLensCommand(stream); return true;
    case 'setup': await handleSetupCommand(argument, stream, atlas, token); return true;
    case 'followups': await handleFollowUpsCommand(stream, atlas); return true;
    case 'research': await handleResearchCommand(argument, stream, atlas); return true;
    case 'ideate': await handleIdeateCommand(stream); return true;
    case 'ship': await handleShipCommand(argument, stream, atlas); return true;
    case 'sync-instructions': await handleSyncInstructionsCommand(argument, stream, atlas); return true;
    case 'voice': await handleVoiceCommand(stream); return true;
    case 'vision':
      // The only entry here that reaches a model. `handleVisionCommand` reads
      // nothing from the request but its prompt, so a minimal stand-in is
      // faithful rather than a shortcut — and it is passed explicitly so this
      // stays visible if the handler ever starts reading more.
      await handleVisionCommand(
        { prompt: argument, command: 'vision', references: [] } as unknown as vscode.ChatRequest,
        stream,
        atlas,
        sessionId,
      );
      return true;
    default:
      return false;
  }
}

async function handleChatRequest(
  request: vscode.ChatRequest,
  chatContext: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  atlas: AtlasMindContext,
  sessionId: string,
): Promise<vscode.ChatResult> {
  let command = request.command;
  let prompt = request.prompt;
  let projectOutcome: ProjectRunOutcome | undefined;
  let freeformFollowups: SessionSuggestedFollowup[] | undefined;

  if (token.isCancellationRequested) {
    return {};
  }

  // A slash command can arrive as *text* rather than as `request.command` —
  // notably when another surface opens chat with a pre-filled query, which is
  // how the Settings → Buzz "Guide me through setup" button works. VS Code
  // renders the chip either way, so this is invisible until the command
  // silently falls through to the general agent.
  //
  // That fall-through is the part that matters. `/buzz` is deliberately
  // deterministic and touches no model at all; reaching the freeform path
  // instead hands a Buzz question to an agent holding every connected tool,
  // which is both wrong and a wider surface than the command was ever meant
  // to have. Recovering the command here keeps that from being possible.
  if (!command) {
    const typed = /^\/([a-z-]+)\b[ \t]*([\s\S]*)$/i.exec(prompt.trim());
    if (typed && KNOWN_SLASH_COMMANDS.has(typed[1]!.toLowerCase())) {
      command = typed[1]!.toLowerCase();
      prompt = typed[2] ?? '';
    }
  }

  // The deterministic commands live in `runDeterministicSlashCommand`, which the
  // chat panel also calls. Anything it claims is handled; the cases below are
  // the two that need a prepared run context and cancellation, plus freeform.
  if (command && command !== 'project' && command !== 'loop' && command !== 'vision') {
    const handled = await runDeterministicSlashCommand(command, prompt, stream, token, atlas, sessionId);
    if (handled) {
      return { metadata: { command, outcome: undefined } };
    }
  }

  // The declared workflow, stated before acting on a request it covers.
  //
  // Both chat surfaces get this, from one implementation, for the reason the
  // slash dispatch is shared: two copies of "what does the workflow expect"
  // would answer differently within a release. `gate` returns without running
  // the turn; `inform` prepends a line and continues.
  // Gated on the synchronous detector so an ordinary turn does no async work
  // here at all — see the note in `ChatPanel.runPrompt`.
  const workflowNotice = detectGovernedAction(prompt)
    ? await buildWorkflowNoticeForChat(prompt, atlas)
    : undefined;
  if (workflowNotice) {
    if (workflowNotice.executionPolicy) {
      stream.progress(`Following the declared ${workflowNotice.stageId} workflow…`);
    } else {
      stream.markdown(`${workflowNotice.markdown}

`);
    }
    if (workflowNotice.blocking) {
      return { metadata: { command: command ?? 'freeform', outcome: undefined } };
    }
  }

  switch (command) {
    case 'project': {
      const { sessionContextBundle, sessionContext } = await prepareProjectRunContext(atlas, sessionId);
      projectOutcome = await runProjectCommand(prompt, stream, token, atlas, sessionId, sessionContextBundle, sessionContext);
      break;
    }

    case 'loop': {
      const { sessionContext } = await prepareProjectRunContext(atlas, sessionId);
      await runLoopCommand(prompt, stream, token, atlas, sessionId, sessionContext);
      break;
    }

    case 'vision':
      // Kept here rather than delegated: this surface has the real
      // `ChatRequest`, whose references the handler may come to need.
      await handleVisionCommand(request, stream, atlas, sessionId, token);
      break;

    default: {
      // Intent routing used to be resolved here as well as inside the freeform
      // path, so the same prompt was classified twice by two copies of the rule.
      // `resolveFreeformPreflight` owns that decision now — one classifier, one
      // answer, shared with the panel.
      const freeform = await handleFreeformMessage(
        request,
        chatContext,
        stream,
        token,
        atlas,
        sessionId,
        workflowNotice?.executionPolicy,
      );
      projectOutcome = freeform.outcome;
      freeformFollowups = freeform.assistantMeta?.suggestedFollowups ?? freeform.assistantMeta?.quickReplies;
      break;
    }
  }

  return {
    metadata: {
      command: command ?? 'freeform',
      outcome: projectOutcome,
      ...(freeformFollowups ? { suggestedFollowups: freeformFollowups } : {}),
    },
  };
}

/**
 * The workflow notice for a chat turn, or `undefined` when there is nothing to say.
 *
 * Mirrors `ChatPanel.announceWorkflowExpectation`, and deliberately delegates the
 * *decision* to the same pure module rather than restating the rules: the panel
 * and `@atlas` must not disagree about what this repository expects.
 *
 * Never throws. The notice is advisory, and a guard that took a turn down would
 * be worse than the silence it replaced.
 */
async function buildWorkflowNoticeForChat(
  prompt: string,
  atlas: AtlasMindContext,
): Promise<import('../core/workflowChatGuard.js').WorkflowChatNotice | undefined> {
  void atlas;
  try {
    const [{ buildWorkflowChatNotice, parseWorkflowChatGuidanceMode }, { readWorkflowConfig }] = await Promise.all([
      import('../core/workflowChatGuard.js'),
      import('../core/workflowConfig.js'),
    ]);
    const settings = vscode.workspace.getConfiguration('atlasmind');
    const mode = parseWorkflowChatGuidanceMode(settings.get<string>('workflow.chatGuidance', 'follow'));
    if (mode === 'off') {
      return undefined;
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return undefined;
    }
    return buildWorkflowChatNotice({ prompt, mode, config: readWorkflowConfig(workspaceRoot) });
  } catch {
    return undefined;
  }
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
  recordSessionTurn = true,
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
  const planner = new Planner(
    atlas.modelRouter,
    atlas.providerRegistry,
    new TaskProfiler(),
    atlas.memoryManager,
    atlas.skillsRegistry,
  );
  const runStartedAt = new Date().toISOString();
  const baselineSnapshot = await createWorkspaceSnapshot();
  const workspaceReadiness = assessProjectWorkspace(
    vscode.workspace.workspaceFolders?.length ?? 0,
    baselineSnapshot.size,
  );
  if (workspaceReadiness.kind === 'no-folder') {
    // Refused before planning, because planning costs a model call and there is
    // no answer it could produce that would be usable.
    stream.markdown(
      'There is no folder open, so there is nowhere for this project to run.\n\n'
      + 'Open the folder you want Atlas to work in, then ask again.',
    );
    return noOpOutcome;
  }
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
    // The goal is printed before anything happens, because it is not always
    // something the operator typed: when a run starts from "yes", it is resolved
    // from what the assistant proposed. A resolved goal that reads oddly is the
    // one thing a person can catch instantly and no gate can, and until this line
    // existed the plan, the file estimate and the cost were all derived from a
    // string nobody had seen.
    `Goal: **${escapeMd(truncateForSummary(goal, 200))}**\n\n` +
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

  // Two independent reasons to stop, stated together rather than as two gates in
  // sequence: a run is approved once, and an operator who cleared one gate and
  // immediately met another would reasonably read the second as the first having
  // failed.
  const approvalReasons: string[] = [];
  if (workspaceReadiness.kind === 'empty') {
    approvalReasons.push(
      'This folder is **empty** — there are no files for Atlas to read, so the plan above was built '
      + 'from your goal alone. If you meant to start a new project here, that is fine and the run will '
      + 'create the files. If you meant to work on an existing codebase, the wrong folder is open.',
    );
  }
  if (estimatedFiles > projectUiConfig.approvalFileThreshold) {
    approvalReasons.push(
      `This project is estimated to modify **~${estimatedFiles} files**, which exceeds the safety `
      + `threshold of ${projectUiConfig.approvalFileThreshold}. This gate exists to prevent unreviewed `
      + `large-scale changes — you can adjust it in AtlasMind Settings → Advanced → Approval Threshold.`,
    );
  }

  if (approvalReasons.length > 0 && !approved) {
    stream.markdown(
      '\n\n⚠️ **Approval required**\n\n'
      + approvalReasons.map(reason => `- ${reason}`).join('\n\n')
      + '\n\nThe plan above is what will run. Approve it below, or refine the goal and ask again.',
    );
    stream.button({
      command: 'atlasmind.showCostSummary',
      title: 'Show Cost Summary',
      tooltip: 'Review current session cost before approving a large run.',
    });
    // The approving prompt travels with the outcome so the surface can offer it
    // as one click. A gate whose only exit was retyping a magic token is one
    // people learn to route around, which costs the gate its purpose — and the
    // natural retry ("Proceed") re-entered here unapproved and looped forever.
    return { ...noOpOutcome, approvalRequiredPrompt: toApprovedProjectPrompt(goal) };
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

    const suggestedIterationLimit = pausedSubtasks
      .map(p => p.suggestedIterationLimit)
      .filter((value): value is number => typeof value === 'number')
      .reduce<number | undefined>((max, value) => max === undefined ? value : Math.max(max, value), undefined);
    const suggestedToolCallsPerTurnLimit = pausedSubtasks
      .map(p => p.suggestedToolCallsPerTurnLimit)
      .filter((value): value is number => typeof value === 'number')
      .reduce<number | undefined>((max, value) => max === undefined ? value : Math.max(max, value), undefined);

    // One or more subtasks paused at the agentic safety cap rather than failing.
    // Surface the choice the user actually has \u2014 raise the limit (once or
    // permanently) and re-run, or skip \u2014 instead of letting the run end silently.
    if (pausedSubtasks.length > 0) {
      const titles = pausedSubtasks.map(p => `**${p.title}**`).join(', ');
      const suggestedLimitText = suggestedIterationLimit !== undefined
        ? `\`${suggestedIterationLimit}\` tool iterations`
        : suggestedToolCallsPerTurnLimit !== undefined
          ? `\`${suggestedToolCallsPerTurnLimit}\` tool calls per turn`
          : 'the suggested execution limit';
      stream.markdown(
        `\n\n### \u23f8\ufe0f Paused \u2014 tool-iteration limit reached\n\n` +
        `${pausedSubtasks.length} subtask(s) stopped at the agentic safety cap (\`maxToolIterations\`) ` +
        `before finishing: ${titles}. The run did **not** fail \u2014 it is waiting on your decision.\n\n` +
        `Would you like AtlasMind to use ${suggestedLimitText} for **this run only**, ` +
        `save that limit **permanently**, or keep the partial result and cancel the retry?\n`,
      );
      stream.button({
        command: 'workbench.action.openSettings',
        title: suggestedIterationLimit !== undefined
          ? `Raise max tool iterations (suggested: ${suggestedIterationLimit})`
          : 'Open tool-iteration limit setting',
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
    if (!token.isCancellationRequested && recordSessionTurn) {
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
      ...(pausedSubtasks.length > 0 ? { iterationLimitHit: true } : {}),
      ...(suggestedIterationLimit !== undefined ? { suggestedIterationLimit } : {}),
      ...(suggestedToolCallsPerTurnLimit !== undefined ? { suggestedToolCallsPerTurnLimit } : {}),
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

/** Neutralise markdown control characters in user-authored text for chat output. */
function escapeMd(value: string): string {
  return String(value ?? '').replace(/([\\`*_{}\[\]()#+\-!|])/g, '\\$1');
}

/** Targets confirmed for sending this session. Cleared when the window closes. */
const buzzConfirmedTargets = new Set<string>();

/**
 * `/buzz read` — show the conversation, with reactions.
 *
 * Session-scoped and never written to disk. Tier 3 deliberately keeps message
 * bodies out of `project_memory/` because that folder is committed; showing you
 * a message you already have access to is a different thing entirely.
 */
async function handleBuzzRead(
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const service = atlas.buzzInbound;
  if (!service) {
    stream.markdown('Buzz inbound is not running. Ask **/buzz** for the setup checklist.');
    return;
  }
  const messages = service.readAllConversations(20);
  if (messages.length === 0) {
    stream.markdown([
      '### Buzz — nothing yet',
      '',
      `Subscription status: **${service.getStatus()}**.`,
      '',
      'Messages appear here as they arrive. If this stays empty while the status says subscribed, the relay may have no recent activity in the channels you are watching.',
    ].join('\n'));
    stream.button({ command: 'atlasmind.openSettings', title: 'Open Settings → Buzz', arguments: ['buzz'] });
    return;
  }

  const identities = new Map(service.listIdentities().map(identity => [identity.pubkey, identity]));
  const self = service.getSelfPubkey();
  const lines = ['### Buzz — recent messages', ''];
  for (const message of [...messages].reverse()) {
    const identity = identities.get(message.authorPubkey);
    const who = identity?.displayName ?? `${message.authorPubkey.slice(0, 12)}…`;
    const mine = self && message.authorPubkey === self.toLowerCase() ? ' *(you)*' : '';
    const when = new Date(message.createdAt * 1000).toISOString().slice(11, 16);
    // Emoji in the body and in the reactions are shown as published — the
    // point of forwarding them is that they arrive intact.
    const reactions = message.reactions.length > 0
      ? `  ${message.reactions.map(entry => `${entry.emoji} ${entry.count}`).join('  ')}`
      : '';
    lines.push(`**${escapeMd(who)}**${mine} · ${when}`);
    lines.push(`${escapeMd(message.text)}${message.truncated ? ' …' : ''}${reactions}`);
    lines.push('');
  }
  lines.push('_Held in memory for this session only — Buzz conversations are never written into project memory._');
  stream.markdown(lines.join('\n'));
  stream.markdown('\nReply with **`/buzz send <your message>`**.');
}

/**
 * `/buzz send <message>` — post to Buzz through the guarded bridge.
 *
 * The confirmation policy lives in `buzzSendPolicy`: a message you wrote, aimed
 * at a channel you chose and have already sent to this session, goes without a
 * dialog, because you confirmed it by typing it. Everything else confirms.
 */
async function handleBuzzSend(
  body: string,
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const [{ validateOutboundMessage }, { decideBuzzSend, describeBuzzSend }, { mcpSkillId }] = await Promise.all([
    import('../core/buzzConversation.js'),
    import('../core/buzzSendPolicy.js'),
    import('../mcp/mcpServerRegistry.js'),
  ]);

  const configuration = vscode.workspace.getConfiguration('atlasmind');
  if (!configuration.get<boolean>('buzz.enabled', false)) {
    stream.markdown('Buzz is off. Ask **/buzz** for the setup checklist.');
    return;
  }

  const validation = validateOutboundMessage(body);
  if (!validation.ok || !validation.text) {
    stream.markdown(`Not sent. ${escapeMd(validation.reason ?? 'The message could not be validated.')}`);
    return;
  }

  const channels = (configuration.get<string[]>('buzz.inboundChannels', []) ?? []).filter(Boolean);
  if (channels.length !== 1) {
    stream.markdown(channels.length === 0
      ? 'No Buzz channel is configured to send to. Add exactly one channel id under **Settings → Buzz** so there is no ambiguity about where a message goes.'
      : `You are watching ${channels.length} channels, so AtlasMind will not guess which one to post to. Sending to the wrong channel is not recoverable.`);
    stream.button({ command: 'atlasmind.openSettings', title: 'Open Settings → Buzz', arguments: ['buzz'] });
    return;
  }
  const target = channels[0]!;

  const server = (atlas.mcpServerRegistry?.listServers() ?? [])
    .find(entry => entry.config.id === 'mcp-server-buzz' || /buzz/i.test(entry.config.name ?? ''));
  const tool = server?.tools.find(entry => entry.name === 'buzz_post_message');
  if (!server || !tool) {
    stream.markdown('The Buzz Communications bridge is not connected, so there is no way to send. Ask **/buzz** — it will tell you what is missing.');
    stream.button({ command: 'atlasmind.openMcpServers', title: 'Manage MCP servers' });
    return;
  }

  const decision = decideBuzzSend({
    composer: 'human',
    target,
    targetChosenByUser: true,
    confirmedTargets: [...buzzConfirmedTargets],
  });
  if (decision.requiresConfirmation) {
    const choice = await vscode.window.showWarningMessage(
      describeBuzzSend(
        { composer: 'human', target, targetChosenByUser: true, confirmedTargets: [...buzzConfirmedTargets] },
        decision,
        validation.text,
      ),
      { modal: true },
      'Send',
    );
    if (choice !== 'Send') {
      stream.markdown('Not sent.');
      return;
    }
  }

  const skillId = mcpSkillId(server.config.id, tool.name);
  const skill = atlas.skillsRegistry.get(skillId);
  if (!skill || !atlas.skillsRegistry.isEnabled(skill.id)) {
    stream.markdown('The Buzz send tool is unavailable. Reconnect the server from MCP Servers.');
    return;
  }

  try {
    await skill.execute({ channel: target, content: validation.text }, atlas.skillContext);
    if (decision.remembersTarget) {
      buzzConfirmedTargets.add(target);
    }
    stream.markdown(`Sent to Buzz. ${decision.requiresConfirmation ? '' : '_(No dialog: you wrote it, you chose the channel, and you have sent here already this session.)_'}`);
  } catch (error) {
    stream.markdown(`Send failed: ${escapeMd(error instanceof Error ? error.message : String(error))}`);
  }
}

/**
 * `/buzz dm <person> <message>` — direct-message a Director contact.
 *
 * The contact is resolved by name from the Director roster and their Buzz key
 * read from the `buzz` channel already on their card, so the person you added
 * once is the person you can message. A contact whose handle is not a public
 * key cannot be DM'd — Buzz DMs are addressed to an identity, and a channel
 * UUID is not one.
 */
async function handleBuzzDirectMessage(
  who: string,
  body: string,
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const [{ validateOutboundMessage }, { decideBuzzSend, describeBuzzSend }, { mcpSkillId }, { normalizeBuzzPubkey }] =
    await Promise.all([
      import('../core/buzzConversation.js'),
      import('../core/buzzSendPolicy.js'),
      import('../mcp/mcpServerRegistry.js'),
      import('../core/buzzSigner.js'),
    ]);

  const configuration = vscode.workspace.getConfiguration('atlasmind');
  if (!configuration.get<boolean>('buzz.enabled', false)) {
    stream.markdown('Buzz is off. Ask **/buzz** for the setup checklist.');
    return;
  }

  const config = atlas.projectDirectorManager?.getConfig();
  const needle = who.trim().toLowerCase();
  const matches = (config?.contacts ?? []).filter(contact =>
    contact.name.toLowerCase() === needle || contact.name.toLowerCase().includes(needle));
  if (matches.length === 0) {
    stream.markdown(`No one called **${escapeMd(who)}** on the Director roster. Add them there with a \`buzz\` channel first.`);
    stream.button({ command: 'atlasmind.openProjectDirector', title: 'Open the Director roster' });
    return;
  }
  if (matches.length > 1) {
    // Guessing which colleague you meant is exactly the mistake that cannot be
    // undone once the message is out.
    stream.markdown(`**${escapeMd(who)}** matches ${matches.length} people: ${matches.map(c => escapeMd(c.name)).join(', ')}. Use the full name.`);
    return;
  }

  const contact = matches[0]!;
  const buzzLink = contact.links.find(link => link.kind === 'buzz');
  const pubkey = buzzLink ? normalizeBuzzPubkey(buzzLink.handle) : undefined;
  if (!pubkey) {
    stream.markdown(buzzLink
      ? `**${escapeMd(contact.name)}** has a Buzz handle, but it is not a public key, so there is no identity to DM. A Buzz DM is addressed to an \`npub…\` or 64-character hex key.`
      : `**${escapeMd(contact.name)}** has no Buzz channel on their Director card. Add one with their \`npub…\` key.`);
    stream.button({ command: 'atlasmind.openProjectDirector', title: 'Open the Director roster' });
    return;
  }

  const validation = validateOutboundMessage(body);
  if (!validation.ok || !validation.text) {
    stream.markdown(`Not sent. ${escapeMd(validation.reason ?? 'The message could not be validated.')}`);
    return;
  }

  const server = (atlas.mcpServerRegistry?.listServers() ?? [])
    .find(entry => entry.config.id === 'mcp-server-buzz' || /buzz/i.test(entry.config.name ?? ''));
  const tool = server?.tools.find(entry => entry.name === 'buzz_send_dm');
  if (!server || !tool) {
    stream.markdown('The Buzz Communications bridge is not connected, so there is no way to send a DM. Ask **/buzz**.');
    stream.button({ command: 'atlasmind.openMcpServers', title: 'Manage MCP servers' });
    return;
  }

  const request = {
    composer: 'human' as const,
    target: pubkey,
    targetChosenByUser: true,
    confirmedTargets: [...buzzConfirmedTargets],
  };
  const decision = decideBuzzSend(request);
  if (decision.requiresConfirmation) {
    const choice = await vscode.window.showWarningMessage(
      describeBuzzSend(request, decision, validation.text, contact.name),
      { modal: true },
      'Send',
    );
    if (choice !== 'Send') {
      stream.markdown('Not sent.');
      return;
    }
  }

  const skillId = mcpSkillId(server.config.id, tool.name);
  const skill = atlas.skillsRegistry.get(skillId);
  if (!skill || !atlas.skillsRegistry.isEnabled(skill.id)) {
    stream.markdown('The Buzz DM tool is unavailable. Reconnect the server from MCP Servers.');
    return;
  }

  try {
    await skill.execute({ pubkey, content: validation.text }, atlas.skillContext);
    if (decision.remembersTarget) {
      buzzConfirmedTargets.add(pubkey);
    }
    stream.markdown(`DM sent to **${escapeMd(contact.name)}** on Buzz.`);
  } catch (error) {
    stream.markdown(`DM failed: ${escapeMd(error instanceof Error ? error.message : String(error))}`);
  }
}

/**
 * Read one pinned Buzz documentation URL.
 *
 * Bounded and total: HTTPS only, an origin the caller has already pinned, a
 * hard timeout, and a size cap. Any failure returns undefined so the setup
 * guide falls back to its built-in text — a walkthrough that breaks when
 * offline is worse than one that is merely less current.
 */
async function fetchBuzzDoc(url: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) {
      return undefined;
    }
    const text = await response.text();
    return text.slice(0, 512 * 1024);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `/buzz` — walk through Buzz setup and say exactly what is left.
 *
 * Deliberately **not** an installer. Every button opens a surface; none of them
 * enables a gate, writes a setting, or stores a secret. Buzz is deny-by-default
 * in three places so that switching it on is a decision a human makes, and a
 * setup assistant that flipped those switches to be helpful would be removing
 * the property they exist to provide.
 *
 * Also deliberately **not** model-generated. Every line comes from observed
 * state, because a hallucinated setup step sends someone to configure something
 * that does not exist and leaves them trusting a broken result.
 */
/**
 * Gather the Buzz setup state.
 *
 * Extracted from the `/buzz` handler so `/setup` can report Buzz's progress
 * without rendering its walkthrough — one gatherer, so the index and the guide
 * can never disagree about how far along it is.
 */
export async function collectBuzzSetupSteps(atlas: AtlasMindContext): Promise<import('../core/setupWalkthrough.js').SetupStep[]> {
  const [{ buildBuzzSetupPlan }, { hasLauncherOnPath }, { BUZZ_AGENT_KEY_SECRET }, { parseAgentBindings }] =
    await Promise.all([
      import('../core/buzzSetupPlan.js'),
      import('../mcp/mcpEnvironmentScanner.js'),
      import('../core/buzzSigner.js'),
      import('../core/buzzAgentBindings.js'),
    ]);

  const cfg = vscode.workspace.getConfiguration('atlasmind');
  let hasAgentKey = false;
  try {
    hasAgentKey = Boolean((await atlas.extensionContext.secrets.get(BUZZ_AGENT_KEY_SECRET))?.trim());
  } catch {
    // An unreadable secret store is reported as "no key" rather than crashing
    // the walkthrough — the remedy is the same either way.
  }

  const rawChannels = cfg.get<unknown>('buzz.inboundChannels', []);
  return buildBuzzSetupPlan({
    cliOnPath: hasLauncherOnPath('buzz'),
    hasAgentKey,
    relayUrl: cfg.get<string>('buzz.relayUrl', ''),
    allowRemoteRelay: cfg.get<boolean>('buzz.allowRemoteRelay', false),
    enabled: cfg.get<boolean>('buzz.enabled', false),
    inboundEnabled: cfg.get<boolean>('buzz.inboundEnabled', false),
    channelIds: Array.isArray(rawChannels) ? rawChannels.filter((c): c is string => typeof c === 'string') : [],
    autoCreateFollowUps: cfg.get<boolean>('buzz.autoCreateFollowUps', false),
    mcpServerRegistered: (atlas.mcpServerRegistry?.listServers() ?? [])
      .some(server => server.config.id === 'mcp-server-buzz' || /buzz/i.test(server.config.name ?? '')),
    ...(atlas.buzzInbound ? { inboundStatus: atlas.buzzInbound.getStatus() } : {}),
    observedIdentities: atlas.buzzInbound?.listIdentities().length ?? 0,
    agentBindings: parseAgentBindings(cfg.get('buzz.agentBindings')).bindings.length,
    relayMode: cfg.get<'local' | 'hosted' | 'undecided'>('buzz.relayMode', 'undecided'),
  });
}

/**
 * Gather the ACP setup state from what is actually configured.
 *
 * Derived, never asked for — the same rule the Buzz guide follows. The probe is
 * the only part that costs anything, and it is skipped entirely when no agent
 * has been named, because there would be nothing to probe *for*.
 */
export async function collectAcpSetupSteps(atlas: AtlasMindContext): Promise<import('../core/setupWalkthrough.js').SetupStep[]> {
  const [
    { buildAcpSetupPlan },
    { parseAcpAgentSettings, AcpAdapter, VERIFIED_ACP_AGENTS, acpInstallCommand, acpSignInFor },
    { ACP_PROTOCOL_VERSION },
  ] = await Promise.all([
    import('../core/acpSetupPlan.js'),
    import('../providers/acp.js'),
    import('../providers/acpProtocol.js'),
  ]);

  const cfg = vscode.workspace.getConfiguration('atlasmind');
  const agents = parseAcpAgentSettings(cfg.get<unknown>('acp.agents'));
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const consoleSetting = cfg.inspect<boolean>('acp.hideConsoleWindows');
  const { isAcpConsoleModeChosen } = await import('../providers/acpWindowsLauncher.js');
  const consoleModeChosen = isAcpConsoleModeChosen(process.platform, [
    consoleSetting?.workspaceFolderValue,
    consoleSetting?.workspaceValue,
    consoleSetting?.globalValue,
  ]);
  const hideConsoleWindows = cfg.get<boolean>('acp.hideConsoleWindows', false);

  let probe: { installed: boolean; authenticated: boolean; protocolVersion?: number; message?: string } | undefined;
  // On Windows the setup guide must explain the launch choices *before* a probe
  // starts the process tree whose windows are in question.
  if (agents.length > 0 && (process.platform !== 'win32' || consoleModeChosen)) {
    const adapter = new AcpAdapter({
      agents,
      ...(workspaceRoot ? { cwd: workspaceRoot } : {}),
      hideConsoleWindows,
    });
    probe = await adapter.probe().catch(() => undefined);
  }

  const providerEnabled = atlas.modelRouter.listProviders()
    .some(provider => provider.id === 'acp' && provider.enabled);

  return buildAcpSetupPlan({
    configuredAgents: agents.map(agent => ({ id: agent.id, command: agent.command, ...(agent.label ? { label: agent.label } : {}) })),
    platform: process.platform,
    consoleModeChosen,
    hideConsoleWindows,
    ...(probe ? { installed: probe.installed, authenticated: probe.authenticated } : {}),
    ...(probe?.protocolVersion !== undefined ? { protocolVersion: probe.protocolVersion } : {}),
    ...(probe?.message ? { probeMessage: probe.message } : {}),
    clientProtocolVersion: ACP_PROTOCOL_VERSION,
    providerEnabled,
    // "Has it ever answered here" is read from cost records, which is the only
    // evidence that survives a reload — and evidence, rather than a claim.
    hasCompletedATurn: atlas.costTracker.getRecords().some(record => (record.model ?? '').startsWith('acp/')),
    // The one list of agents, install commands and ACP-mode flags, passed in
    // rather than restated — see `AcpSetupState.suggestions`.
    suggestions: VERIFIED_ACP_AGENTS.map(agent => ({
      id: agent.id,
      label: agent.label.replace(/\s*\(.*\)$/, ''),
      command: agent.command,
      args: agent.args,
      install: acpInstallCommand(agent.npmPackage),
      ...(agent.eligibility ? { eligibility: agent.eligibility } : {}),
    })),
    // Absent for an agent whose sign-in AtlasMind has never read — the guide
    // says so rather than printing a command nobody verified.
    ...(agents[0] ? (signIn => signIn ? { signIn } : {})(acpSignInFor(agents[0].command)) : {}),
  });
}

/**
 * `/acp` — the ACP setup walkthrough.
 *
 * Deliberately the same shape as `/buzz`: one step at a time, derived state,
 * the command written out, and nothing switched on for you. The mechanics are
 * literally shared (`setupWalkthrough.ts`), so the two cannot drift.
 */
async function handleAcpCommand(
  prompt: string,
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const trimmed = (prompt ?? '').trim();
  const showAll = /^all$/i.test(trimmed);
  const [{ ACP_SETUP_GUIDE, isAcpProviderReady, REQUIRED_ACP_STEP_IDS }, walkthrough] = await Promise.all([
    import('../core/acpSetupPlan.js'),
    import('../core/setupWalkthrough.js'),
  ]);

  const steps = await collectAcpSetupSteps(atlas);
  const next = walkthrough.nextSetupStep(steps, ACP_SETUP_GUIDE.stepIds);

  if (!next && !showAll) {
    stream.markdown([
      '### ACP setup — done',
      '',
      'An ACP agent is configured, installed, signed in, enabled for routing, and has answered at least once. Its subscription is now capacity the router can choose.',
      '',
      'Ask **`/acp all`** for the full checklist.',
    ].join('\n'));
    stream.button({ command: 'atlasmind.openModelProviderPanel', title: 'Open model providers' });
    return;
  }

  if (!showAll && next) {
    const position = walkthrough.setupStepPosition(steps, ACP_SETUP_GUIDE.stepIds, next.id);
    stream.markdown(walkthrough.renderSetupStepMarkdown('ACP', next, position, "The Agent Client Protocol's documentation"));
    // The last step is about proving it works rather than making it work.
    // Without saying so, "1 step left" reads as though it is still broken.
    if (isAcpProviderReady(steps)) {
      stream.markdown('\n\n> **The provider itself is already wired** — an agent is named, installed, signed in, and enabled. What is left is confirming a reply actually comes back.');
    }
    if (next.action && walkthrough.isOpeningAction(next.action.command)) {
      stream.button({
        command: next.action.command,
        title: next.action.title,
        ...(next.action.args ? { arguments: next.action.args } : {}),
      });
    }
    stream.markdown(`\n\n_Step ${position.index} of ${position.total}. Say **\`/acp\`** again once done, or **\`/acp all\`** to see everything._`);
    // Required steps are what gate routing; the proof step is separate.
    void REQUIRED_ACP_STEP_IDS;
    return;
  }

  const MARK: Record<string, string> = { done: '✅', todo: '⬜', blocked: '⏸️', optional: '◽' };
  const lines = ['### ACP setup — full checklist', ''];
  for (const step of steps) {
    lines.push(`${MARK[step.status] ?? '⬜'} **${escapeMd(step.title)}** — ${escapeMd(step.detail)}`);
  }
  lines.push('', 'AtlasMind installs nothing and enables nothing for you: you name a command you already have, and the provider stays off until you turn it on.');
  stream.markdown(lines.join('\n'));
}

/**
 * Inspect the workspace's Lens declarations and derive the guide's steps.
 *
 * No model and no configuration — just four files on disk — so this returns the
 * same answer on a fresh install with nothing set up, which is exactly when
 * somebody is most likely to be asking.
 */
export async function collectLensSetupSteps(): Promise<import('../core/setupWalkthrough.js').SetupStep[]> {
  const [{ buildLensDeclarationPlan }, { inspectLensDeclarations }] = await Promise.all([
    import('../core/lensDeclarationPlan.js'),
    import('../core/lensDeclarations.js'),
  ]);
  const folder = vscode.workspace.workspaceFolders?.[0];
  const diskBacked = folder?.uri.scheme === 'file' || folder?.uri.scheme === 'vscode-remote';
  return buildLensDeclarationPlan({
    ...(folder ? { workspaceName: folder.name } : {}),
    ...(folder && diskBacked ? { declarations: inspectLensDeclarations(folder.uri.fsPath) } : {}),
  });
}

/**
 * `/lens` — the declaration walkthrough.
 *
 * Renders the whole plan rather than one step at a time, which is the opposite
 * of `/acp`, and deliberately: the ACP steps are sequential (you cannot sign in
 * to an agent you have not installed), whereas these four files are independent
 * and someone may well only ever want one of them. A checklist lets them pick;
 * a wizard would march them through three files to reach the one they came for.
 */
async function handleLensCommand(stream: vscode.ChatResponseStream): Promise<void> {
  const [{ LENS_SETUP_GUIDE }, walkthrough] = await Promise.all([
    import('../core/lensDeclarationPlan.js'),
    import('../core/setupWalkthrough.js'),
  ]);
  const steps = await collectLensSetupSteps();
  const progress = walkthrough.summarizeSetupProgress(steps, LENS_SETUP_GUIDE.stepIds);

  stream.markdown(walkthrough.renderSetupGuideMarkdown(LENS_SETUP_GUIDE, steps, progress));
  stream.markdown([
    '',
    '---',
    '',
    'Each file has a guide with a worked example, and Atlas can read the repository and propose a first draft.',
    'A draft is shown to you in full and written only if you accept it — anything it cannot anchor to a real file is dropped, and any value that looks like a credential is left out.',
  ].join('\n'));

  const next = walkthrough.nextSetupStep(steps, LENS_SETUP_GUIDE.stepIds);
  if (next?.action && walkthrough.isOpeningAction(next.action.command)) {
    stream.button({
      command: next.action.command,
      title: next.action.title,
      ...(next.action.args ? { arguments: next.action.args } : {}),
    });
  }
  stream.button({ command: 'atlasmind.lens.openDashboard', title: 'Open Atlas Lenses' });
  void progress;
}

/**
 * `/setup` — the index of every setup guide, with how far along each one is.
 *
 * Exists because a feature that needs configuring should be discoverable before
 * someone hits the failure that configuring it would have prevented.
 */
async function handleSetupCommand(
  prompt: string,
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
  token: vscode.CancellationToken,
): Promise<void> {
  const trimmed = (prompt ?? '').trim().toLowerCase();
  const [{ SETUP_GUIDES, findSetupGuide, buildSetupIndex }, walkthrough] = await Promise.all([
    import('../core/setupGuideRegistry.js'),
    import('../core/setupWalkthrough.js'),
  ]);

  // `/setup acp` is a shortcut into that guide rather than a second dialect.
  const requested = trimmed ? findSetupGuide(trimmed) : undefined;
  if (requested?.id === 'acp') {
    await handleAcpCommand('', stream, atlas);
    return;
  }
  if (requested?.id === 'buzz') {
    await handleBuzzCommand('', stream, atlas, token);
    return;
  }
  if (requested?.id === 'lens') {
    await handleLensCommand(stream);
    return;
  }

  const plans: Array<{ guideId: string; steps: import('../core/setupWalkthrough.js').SetupStep[] }> = [];
  plans.push({ guideId: 'acp', steps: await collectAcpSetupSteps(atlas).catch(() => []) });
  plans.push({ guideId: 'buzz', steps: await collectBuzzSetupSteps(atlas).catch(() => []) });
  plans.push({ guideId: 'lens', steps: await collectLensSetupSteps().catch(() => []) });

  stream.markdown(walkthrough.renderSetupIndexMarkdown(buildSetupIndex(plans)));
  if (trimmed && !requested) {
    stream.markdown(`\n\n_No setup guide called \`${escapeMd(trimmed)}\`. Available: ${SETUP_GUIDES.map(guide => `\`${guide.id}\``).join(', ')}._`);
  }
}

async function handleBuzzCommand(
  prompt: string,
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
  token: vscode.CancellationToken,
): Promise<void> {
  const trimmed = (prompt ?? '').trim();
  if (/^read\b/i.test(trimmed)) {
    await handleBuzzRead(stream, atlas);
    return;
  }
  const mode = /^(local|hosted)$/i.exec(trimmed);
  if (mode) {
    // `/buzz local` used to write workspace settings outright, with no
    // confirmation and no mention of it in the reply — eighty lines above the
    // same handler's own promise that none of these guides switches anything on
    // for you. A setting write is a change to a file most repositories commit,
    // so it goes behind the same modal every other outward-facing write here
    // does, naming the key, both values and the scope.
    const requested = mode[1]!.toLowerCase() as 'local' | 'hosted';
    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const current = configuration.get<'local' | 'hosted' | 'undecided'>('buzz.relayMode', 'undecided');
    if (current === requested) {
      stream.markdown(`Buzz relay mode is already **${requested}**. Nothing to change.\n\n`);
    } else {
      const choice = await vscode.window.showWarningMessage(
        `Change the Buzz relay mode to "${requested}"?`,
        {
          modal: true,
          detail: `Sets atlasmind.buzz.relayMode to "${requested}" (currently "${current}") in this workspace's settings, which is a file most repositories commit.`,
        },
        'Change setting',
      );
      if (choice !== 'Change setting') {
        stream.markdown(`Left \`atlasmind.buzz.relayMode\` at **${current}**.\n\n`);
        return;
      }
      try {
        await configuration.update('buzz.relayMode', requested, vscode.ConfigurationTarget.Workspace);
        stream.markdown(`Set \`atlasmind.buzz.relayMode\` to **${requested}** (was \`${current}\`).\n\n`);
      } catch (error) {
        // Previously swallowed. A write that silently failed left the guide
        // describing a mode that was never set.
        const message = error instanceof Error ? error.message : String(error);
        stream.markdown(`Could not update \`atlasmind.buzz.relayMode\`: ${message}\n\n`);
        return;
      }
    }
  }

  const dm = /^dm\s+(\S+)\s+([\s\S]+)$/i.exec(trimmed);
  if (dm) {
    await handleBuzzDirectMessage(dm[1]!, dm[2]!, stream, atlas);
    return;
  }
  const send = /^send\s+([\s\S]+)$/i.exec(trimmed);
  if (send) {
    await handleBuzzSend(send[1]!, stream, atlas);
    return;
  }

  const [{ isBuzzInboundReady, nextBuzzSetupStep }, docsModule] =
    await Promise.all([
      import('../core/buzzSetupPlan.js'),
      import('../core/buzzDocsSource.js'),
    ]);
  const docsModule2 = await import('../core/buzzSetupPlan.js');

  const steps = await collectBuzzSetupSteps(atlas);

  const next = nextBuzzSetupStep(steps);
  // "Ready" is the walkthrough being finished, not just inbound being wired: a
  // feed nothing was ever seen arriving on, routed to nobody, is not a setup to
  // congratulate someone for.
  const ready = !next;
  const showAll = /^all$/i.test(trimmed);

  if (ready && !showAll) {
    stream.markdown([
      '### Buzz setup — done',
      '',
      'Reading Buzz is set up, a message has been seen arriving, and at least one Buzz identity is bound to an AtlasMind agent. The optional extras (recording follow-ups, the CLI, the MCP bridge, the desktop app) are choices, not gaps.',
      '',
      'Ask **`/buzz all`** for the full checklist, or **`/buzz read`** to see the conversation.',
    ].join('\n'));
    stream.button({ command: 'atlasmind.openProjectDirector', title: 'Open the Director roster' });
    return;
  }

  if (!showAll && next) {
    // One step at a time. The whole list at once was a wall of bullets in which
    // the thing to do right now was indistinguishable from context.
    const position = docsModule2.buzzStepPosition(steps, next.id);
    stream.markdown(docsModule2.renderBuzzStepMarkdown(next, position));
    // The last two steps are about making what arrives useful rather than making
    // it arrive. Without saying so, "2 steps left" reads as though the
    // connection itself is still broken.
    if (isBuzzInboundReady(steps)) {
      stream.markdown('\n\n> **The connection itself is already working** — Buzz is enabled, the relay is set, your key is stored, and the subscription is on. What is left is making what arrives useful.');
    }

    if (next.action) {
      stream.button({
        command: next.action.command,
        title: next.action.title,
        ...(next.action.args ? { arguments: next.action.args.map(arg => typeof arg === 'string' && /^https?:\/\//.test(arg) ? vscode.Uri.parse(arg) : arg) } : {}),
      });
    }
    // A command AtlasMind wrote can be typed into a terminal for you. Pressing
    // Enter stays yours — these clone repositories and start containers.
    for (const line of next.guidance ?? []) {
      if (line.command && line.authored) {
        stream.button({
          command: 'atlasmind.buzz.prepareCommand',
          title: `Put \`${line.command}\` in a terminal`,
          arguments: [line.command],
        });
      }
    }
    stream.markdown(`\n\n_Step ${position.index} of ${position.total}. Say **\`/buzz\`** again once done, or **\`/buzz all\`** to see everything._`);
  } else {
    const MARK: Record<string, string> = { done: '✅', todo: '⬜', blocked: '⏸️', optional: '◽' };
    const lines = ['### Buzz setup — full checklist', ''];
    for (const step of steps) {
      lines.push(`${MARK[step.status] ?? '⬜'} **${escapeMd(step.title)}** — ${escapeMd(step.detail)}`);
    }
    lines.push('', 'AtlasMind will not switch any of this on for you: each gate is off by default so that turning it on stays your decision.');
    stream.markdown(lines.join('\n'));
  }

  // Buzz ships releases, so the *how* is read from Buzz's own documentation
  // rather than from prose written here that quietly goes stale. Assessing your
  // machine stays deterministic above; only the external how-to is cited.
  const wanted = steps.filter(step => step.status === 'todo' || step.status === 'blocked')
    .map(step => (step.id === 'relay' ? 'relay' : step.id === 'cli' || step.id === 'mcp' ? 'cli' : step.id === 'agentKey' ? 'key' : undefined))
    .filter((topic): topic is 'relay' | 'cli' | 'key' => topic !== undefined);
  if (wanted.length > 0 && !token.isCancellationRequested) {
    const now = Date.now();
    const docs = await docsModule.fetchBuzzDocs([...new Set(wanted)], fetchBuzzDoc, now);
    if (docs.excerpts.length > 0) {
      const docLines = ['', '---', '', '#### From Buzz’s current documentation'];
      for (const excerpt of docs.excerpts) {
        const covers = [excerpt.topic, ...excerpt.alsoCovers].join(', ');
        docLines.push('', `**${escapeMd(excerpt.heading ?? excerpt.topic)}** — covers ${escapeMd(covers)} · [${escapeMd(docsModule.describeDocSource(excerpt, now))}](${excerpt.sourceUrl})`);
        for (const line of excerpt.lines) {
          docLines.push(`> ${escapeMd(line)}`);
        }
        for (const command of excerpt.suggestedCommands) {
          docLines.push('', '```', command, '```');
        }
      }
      docLines.push('', '_Quoted from Buzz’s documentation, not written by AtlasMind. Read any command before running it — AtlasMind does not run them, and cannot vouch for text it did not write._');
      stream.markdown(docLines.join('\n'));
    } else if (docs.unavailableReason) {
      stream.markdown(`\n\n_${escapeMd(docs.unavailableReason)} The steps above still apply; only the quoted how-to is missing._`);
    }
  }

  // One button per incomplete step, in dependency order, so the first is always
  // the right next click.
  const seen = new Set<string>();
  for (const step of steps) {
    if (step.status === 'done' || !step.action || seen.has(step.action.title)) {
      continue;
    }
    seen.add(step.action.title);
    stream.button({
      command: step.action.command,
      title: step.action.title,
      ...(step.action.args ? { arguments: step.action.args.map(arg => typeof arg === 'string' && /^https?:\/\//.test(arg) ? vscode.Uri.parse(arg) : arg) } : {}),
    });
  }
  if (ready) {
    stream.button({ command: 'atlasmind.openProjectDirector', title: 'Open the Director roster' });
  }
}

async function handleDirectorCommand(
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const { countOverdueFollowUps, resolveTeamMode } = await import('../core/projectDirectorManager.js');
  const config = atlas.projectDirectorManager?.getConfig();
  if (!config) {
    stream.markdown('### Project Director\n\nNo people model yet. Open the Director tab to seed a roster from your repo (git contributors, CODEOWNERS, package author).');
    stream.button({ command: 'atlasmind.openProjectDirector', title: 'Open Project Director' });
    return;
  }
  const mode = resolveTeamMode(config);
  const openFollowUps = config.followUps.filter(f => f.status !== 'done' && f.status !== 'cancelled');
  const overdue = countOverdueFollowUps(config);
  const lines = [
    `### Project Director — ${escapeMd(config.project.name || 'this project')} (${mode})`,
    '',
    `- **People:** ${config.contacts.length} (${config.stakeholders.length} stakeholder(s), ${config.teamMembers.length} team)`,
    `- **Responsibilities:** ${config.responsibilities.length}`,
    `- **Assignments:** ${config.assignments.length}`,
    `- **Follow-ups:** ${openFollowUps.length} open${overdue > 0 ? ` — ⚠️ ${overdue} overdue` : ''}`,
  ];
  stream.markdown(lines.join('\n'));
  stream.button({ command: 'atlasmind.openProjectDirector', title: 'Open Project Director' });
}

async function handleFollowUpsCommand(
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const { deriveFollowUpUrgency } = await import('../core/projectDirectorManager.js');
  const config = atlas.projectDirectorManager?.getConfig();
  const active = (config?.followUps ?? []).filter(f => f.status !== 'done' && f.status !== 'cancelled');
  if (active.length === 0) {
    stream.markdown('### Follow-ups\n\nNo open follow-ups. Add one from the Director tab to track a check-in or deadline.');
    stream.button({ command: 'atlasmind.openProjectDirector', title: 'Open Project Director' });
    return;
  }
  const nameOf = (contactId: string | undefined): string =>
    config?.contacts.find(c => c.id === contactId)?.name ?? '';
  const groups: Array<{ heading: string; urgency: string }> = [
    { heading: 'Overdue', urgency: 'overdue' },
    { heading: 'Due soon', urgency: 'due-soon' },
    { heading: 'Upcoming', urgency: 'upcoming' },
  ];
  const out: string[] = ['### Follow-ups', ''];
  for (const group of groups) {
    const items = active.filter(f => deriveFollowUpUrgency(f) === group.urgency);
    if (items.length === 0) { continue; }
    out.push(`**${group.heading}**`);
    for (const followUp of items) {
      const withWhom = followUp.withContactId ? ` — with ${nameOf(followUp.withContactId)}` : '';
      out.push(`- ${escapeMd(followUp.title)} (due ${followUp.dueDate})${withWhom}`);
    }
    out.push('');
  }
  stream.markdown(out.join('\n'));
  stream.button({ command: 'atlasmind.openProjectDirector', title: 'Open Project Director' });
}

const IDEATION_COMMAND_MAX_FILE_BYTES = 512 * 1024;
const IDEATION_COMMAND_MAX_CARDS = 48;
const IDEATION_COMMAND_MAX_CONNECTIONS = 96;
const IDEATION_BOARD_DEFAULT_FILE = 'atlas-ideation-board.json';
const IDEATION_WORKSPACE_REGISTRY_FILE = 'atlas-ideation-workspaces.json';
const IDEATION_ROADMAP_ITEMS_START = '<!-- atlasmind:roadmap-items:start -->';
const IDEATION_ROADMAP_ITEMS_END = '<!-- atlasmind:roadmap-items:end -->';

interface IdeationCommandBoard {
  workspaceTitle: string;
  exists: boolean;
  omittedCardCount: number;
  omittedConnectionCount: number;
  cards: Array<{
    id: string;
    kind: string;
    title: string;
    archived?: boolean;
    derived?: { roadmapText: string; roadmapNormalized: string; derivedAt: string };
  }>;
  connections: Array<{
    fromCardId: string;
    toCardId: string;
    relation: 'supports' | 'causal' | 'dependency' | 'contradiction' | 'opportunity';
  }>;
}

/**
 * `/ideate` — a read-only stage-0 status check and two routes back into the
 * work. It deliberately reads the persisted board instead of running a model,
 * scan, or board mutation: opening a status command must not change the thing
 * it is describing.
 */
async function handleIdeateCommand(stream: vscode.ChatResponseStream): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    stream.markdown('### Ideation\n\nOpen a workspace folder to inspect the active ideation board.');
    stream.button({ command: 'atlasmind.openProjectIdeation', title: 'Open canvas' });
    return;
  }

  const ssotSegments = ideationCommandSsotSegments(
    vscode.workspace.getConfiguration('atlasmind').get<string>('ssotPath', DEFAULT_SSOT_PATH),
  );
  if (!ssotSegments) {
    stream.markdown([
      '### Ideation',
      '',
      'The configured SSOT path cannot be read safely, so AtlasMind did not inspect an ideation file outside this workspace.',
    ].join('\n'));
    stream.button({ command: 'workbench.action.openSettings', title: 'Open SSOT path setting', arguments: ['atlasmind.ssotPath'] });
    return;
  }

  const ideasRoot = path.join(workspaceRoot, ...ssotSegments, 'ideas');
  const roadmapPath = path.join(workspaceRoot, ...ssotSegments, 'roadmap', 'improvement-plan.md');
  const [board, roadmapMarkdown] = await Promise.all([
    readIdeationCommandBoard(ideasRoot),
    readIdeationCommandText(roadmapPath),
  ]);
  const readiness = assessIdeationReadiness({
    cards: board.cards,
    connections: board.connections,
    roadmapItems: extractIdeationCommandRoadmapItems(roadmapMarkdown ?? ''),
  });
  const realized = readiness.observations.find(observation => observation.id === 'reaching-backlog')?.count ?? 0;
  const out: string[] = [
    '### Ideation',
    '',
    `**${escapeMd(readiness.summary)}**`,
    '',
    '**Board state**',
    '',
    `- Active cards: ${readiness.activeCards}`,
    `- Evidence cards: ${readiness.evidenceCards}`,
    `- Not yet work: ${readiness.unrealized}`,
    `- Became roadmap work: ${realized}`,
    `- Unresolved contradictions: ${readiness.contradictions}`,
    '',
  ];

  if (!board.exists) {
    out.push('_No saved active board was found; the reading above is an unstarted board, not a clean one._', '');
  } else {
    out.push(`_Active workspace: ${escapeMd(board.workspaceTitle)}._`, '');
  }
  if (board.omittedCardCount > 0 || board.omittedConnectionCount > 0) {
    out.push(
      `_This reading used the first ${IDEATION_COMMAND_MAX_CARDS} cards and ${IDEATION_COMMAND_MAX_CONNECTIONS} connections `
      + `from an oversized board; ${board.omittedCardCount} card${board.omittedCardCount === 1 ? '' : 's'} and `
      + `${board.omittedConnectionCount} connection${board.omittedConnectionCount === 1 ? '' : 's'} were not included._`,
      '',
    );
  }

  // The readiness module ranks observations by consequence and has a bounded
  // rule table, so every observation can be shown rather than silently capped.
  out.push('**Needs attention**', '');
  if (readiness.observations.length === 0) {
    out.push('- No readiness observations are available yet.', '');
  } else {
    for (const observation of readiness.observations) {
      out.push(`- \`${observation.tone}\` ${escapeMd(observation.label)} — ${escapeMd(observation.detail)}`);
    }
    out.push('');
  }

  out.push('_This command only reads the board and roadmap. It does not run a scan or change either file._');
  stream.markdown(out.join('\n'));
  stream.button({ command: 'atlasmind.openProjectDashboard', title: 'Open ideation overview', arguments: ['ideation'] });
  stream.button({ command: 'atlasmind.openProjectIdeation', title: 'Open canvas' });
}

function ideationCommandSsotSegments(value: string | undefined): string[] | undefined {
  const normalized = normalizeSsotPathForLookup(value);
  const segments = normalized.split('/').filter(Boolean);
  return segments.length > 0 && segments.every(segment => /^[A-Za-z0-9._-]+$/.test(segment) && segment !== '.' && segment !== '..')
    ? segments
    : undefined;
}

async function readIdeationCommandBoard(ideasRoot: string): Promise<IdeationCommandBoard> {
  const registry = await readIdeationCommandJson(path.join(ideasRoot, IDEATION_WORKSPACE_REGISTRY_FILE));
  let boardFile = IDEATION_BOARD_DEFAULT_FILE;
  let workspaceTitle = 'Primary ideation';
  if (isIdeationCommandRecord(registry)) {
    const activeWorkspaceId = ideationCommandText(registry['activeWorkspaceId'], 80);
    const workspaces = Array.isArray(registry['workspaces'])
      ? registry['workspaces'].filter(isIdeationCommandRecord)
      : [];
    const activeWorkspace = workspaces.find(workspace => ideationCommandText(workspace['id'], 80) === activeWorkspaceId)
      ?? workspaces[0];
    if (activeWorkspace) {
      const candidateFile = ideationCommandText(activeWorkspace['boardFile'], 140);
      if (isSafeIdeationCommandBoardFile(candidateFile)) {
        boardFile = candidateFile;
      }
      workspaceTitle = ideationCommandText(activeWorkspace['title'], 80) || workspaceTitle;
    }
  }

  const rawBoard = await readIdeationCommandJson(path.join(ideasRoot, boardFile));
  if (!isIdeationCommandRecord(rawBoard)) {
    return { workspaceTitle, exists: false, omittedCardCount: 0, omittedConnectionCount: 0, cards: [], connections: [] };
  }

  const rawCards = Array.isArray(rawBoard['cards']) ? rawBoard['cards'] : [];
  const rawConnections = Array.isArray(rawBoard['connections']) ? rawBoard['connections'] : [];
  const cards = rawCards
    .slice(0, IDEATION_COMMAND_MAX_CARDS)
    .flatMap(item => {
      if (!isIdeationCommandRecord(item)) {
        return [];
      }
      const id = ideationCommandText(item['id'], 160);
      const title = ideationCommandText(item['title'], 160);
      if (!isSafeIdeationCommandId(id) || !title) {
        return [];
      }
      const derived = isIdeationCommandRecord(item['derived'])
        ? ideationCommandDerivedRecord(item['derived'])
        : undefined;
      return [{
        id,
        kind: ideationCommandText(item['kind'], 40) || 'unknown',
        title,
        ...(ideationCommandText(item['archivedAt'], 64) ? { archived: true } : {}),
        ...(derived ? { derived } : {}),
      }];
    });
  const connections = rawConnections
    .slice(0, IDEATION_COMMAND_MAX_CONNECTIONS)
    .flatMap(item => {
      if (!isIdeationCommandRecord(item)) {
        return [];
      }
      const fromCardId = ideationCommandText(item['fromCardId'], 160);
      const toCardId = ideationCommandText(item['toCardId'], 160);
      const relation = item['relation'];
      if (!isSafeIdeationCommandId(fromCardId) || !isSafeIdeationCommandId(toCardId)
        || !isIdeationCommandRelation(relation)) {
        return [];
      }
      return [{ fromCardId, toCardId, relation }];
    });
  return {
    workspaceTitle,
    exists: true,
    omittedCardCount: Math.max(0, rawCards.length - IDEATION_COMMAND_MAX_CARDS),
    omittedConnectionCount: Math.max(0, rawConnections.length - IDEATION_COMMAND_MAX_CONNECTIONS),
    cards,
    connections,
  };
}

async function readIdeationCommandJson(filePath: string): Promise<unknown | undefined> {
  const text = await readIdeationCommandText(filePath);
  if (text === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function readIdeationCommandText(filePath: string): Promise<string | undefined> {
  try {
    const metadata = await fs.lstat(filePath);
    if (!metadata.isFile() || metadata.size > IDEATION_COMMAND_MAX_FILE_BYTES) {
      return undefined;
    }
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return undefined;
  }
}

function extractIdeationCommandRoadmapItems(markdown: string): Array<{ id: string; text: string; completed: boolean }> {
  const withoutGateBlock = stripRoadmapGatesBlock(markdown);
  const start = withoutGateBlock.indexOf(IDEATION_ROADMAP_ITEMS_START);
  const end = withoutGateBlock.indexOf(IDEATION_ROADMAP_ITEMS_END);
  const region = start >= 0 && end > start
    ? withoutGateBlock.slice(start + IDEATION_ROADMAP_ITEMS_START.length, end)
    : withoutGateBlock;
  let gates: ReturnType<typeof parseRoadmapGates> = [];
  try {
    gates = parseRoadmapGates(markdown);
  } catch {
    // A malformed gate declaration must not stop `/ideate` reporting the board.
  }
  const seen = new Set<string>();
  const items = [...region.matchAll(/^\s*(?:[-*]|\d+\.)\s+(.+?)\s*$/gm)]
    .flatMap(match => {
      const raw = ideationCommandText(match[1], 320);
      if (!raw) {
        return [];
      }
      const completed = /^(?:✅|\[x\])/i.test(raw);
      const withoutCheckbox = raw.replace(/^(?:✅|\[(?:x| )\])\s*/i, '').trim();
      const text = ideationCommandText(extractItemGates(withoutCheckbox, gates).text, 300);
      const key = text.toLowerCase().replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();
      if (!text || seen.has(key)) {
        return [];
      }
      seen.add(key);
      return [{ text, completed }];
    });
  return items.map((item, index) => ({ id: `roadmap-${index + 1}`, ...item }));
}

function ideationCommandDerivedRecord(value: Record<string, unknown>): { roadmapText: string; roadmapNormalized: string; derivedAt: string } | undefined {
  const roadmapText = ideationCommandText(value['roadmapText'], 300);
  const roadmapNormalized = ideationCommandText(value['roadmapNormalized'], 300);
  const derivedAt = ideationCommandText(value['derivedAt'], 64);
  return roadmapText && roadmapNormalized && derivedAt ? { roadmapText, roadmapNormalized, derivedAt } : undefined;
}

function isIdeationCommandRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function ideationCommandText(value: unknown, limit: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit)
    : '';
}

function isSafeIdeationCommandId(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,160}$/.test(value);
}

function isIdeationCommandRelation(
  value: unknown,
): value is IdeationCommandBoard['connections'][number]['relation'] {
  return value === 'supports' || value === 'causal' || value === 'dependency'
    || value === 'contradiction' || value === 'opportunity';
}

function isSafeIdeationCommandBoardFile(value: string): boolean {
  return value === path.basename(value) && /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.json$/.test(value);
}

/**
 * `/research` — what the world outside this repository has told us, and what it
 * has not been asked.
 *
 * Reads only. Running a scan spends money and reaches the network, so it stays
 * behind the command's own modal confirmation; this surface offers the button and
 * never presses it.
 *
 * The section that must never be dropped is the last one. A list of findings
 * reads as a complete picture, and the questions nobody has asked are exactly
 * what a research surface is for — so scans that have never produced an answer
 * are reported here even when everything else is quiet.
 */
async function handleResearchCommand(
  argument: string,
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const [
    { RESEARCH_SCANS, researchScan },
    { openResearchFindings, researchQuestions, seedResearchRegister },
    { buildResearchSchedule },
    { readResearchSettings },
    { detectResearchSources },
  ] = await Promise.all([
    import('../core/researchScanCatalog.js'),
    import('../core/researchRegister.js'),
    import('../core/researchSchedule.js'),
    import('../core/researchSettings.js'),
    import('../core/researchSources.js'),
  ]);

  const settings = readResearchSettings(vscode.workspace.getConfiguration('atlasmind'));
  if (!settings.enabled) {
    stream.markdown([
      '### Research',
      '',
      'Research scans are switched off. They ask questions about the world *outside* this repository —',
      'competition, customers, technology, feature gaps, market, funding, regulation — and they reach the',
      'network and spend on a model, so they are off by default.',
      '',
      'Findings are only ever recorded with a retrievable source. A claim with no source is kept as a',
      '*question to research*, never as evidence.',
    ].join('\n'));
    stream.button({ command: 'workbench.action.openSettings', title: 'Open research settings', arguments: ['atlasmind.research.enabled'] });
    return;
  }

  const register = atlas.researchRegisterManager?.getRegister() ?? seedResearchRegister();
  const sources = detectResearchSources({
    exaKeyPresent: settings.searchSource !== 'none',
    mcpToolIds: atlas.skillsRegistry.listSkills().map(skill => skill.id).filter(id => id.startsWith('mcp:')),
    webFetchEnabled: atlas.skillsRegistry.get('web-fetch') !== undefined,
    preference: settings.searchSource,
  });
  const schedule = buildResearchSchedule({
    enabled: settings.enabled,
    masterLevel: settings.automationLevel,
    scans: settings.scans,
    register,
    sourceAvailable: sources.selected !== undefined,
    monthlySpendCapUsd: settings.monthlySpendCapUsd,
    spentThisMonthUsd: 0,
    now: new Date(),
  });

  const showAll = /^all$/i.test(argument.trim());
  const open = openResearchFindings(register);
  const questions = researchQuestions(register);
  const out: string[] = ['### Research', '', `**${schedule.summary}**`, ''];

  if (open.length > 0) {
    out.push('**Open findings**', '');
    for (const finding of [...open]
      .sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a.severity] - ({ high: 0, medium: 1, low: 2 })[b.severity])
      .slice(0, 8)) {
      const host = finding.citations[0]?.host ?? 'no source';
      out.push(`- \`${finding.severity}\` ${escapeMd(finding.title)} — ${escapeMd(researchScan(finding.scanId).label)}, via ${escapeMd(host)}`);
    }
    if (open.length > 8) {
      out.push(`- …and ${open.length - 8} more in the register.`);
    }
    out.push('');
  }

  const due = schedule.dueNow;
  if (due.length > 0) {
    out.push('**Due now**', '');
    for (const scan of due) {
      out.push(`- ${escapeMd(scan.label)} — last answered ${scan.daysSinceRun ?? '?'} days ago, cadence ${scan.cadenceDays} days`);
    }
    out.push('');
  }

  const blocked = schedule.scans.filter(scan => scan.state === 'blocked');
  if (blocked.length > 0) {
    out.push('**Blocked**', '');
    for (const scan of blocked) {
      out.push(`- ${escapeMd(scan.label)} — ${escapeMd(scan.blocker ?? 'blocked')}`);
    }
    out.push('');
  }

  // Never omitted. A findings list on its own reads as a complete picture, and
  // the whole point of this surface is the questions nobody has asked yet.
  const never = schedule.neverScanned;
  out.push('**Never assessed**', '');
  if (never.length === 0) {
    out.push('- Every switched-on scan has produced an answer.', '');
  } else {
    for (const scan of never) {
      out.push(`- ${escapeMd(scan.label)} — ${escapeMd(researchScan(scan.scanId as never).question)}`);
    }
    out.push('');
  }

  const off = schedule.scans.filter(scan => scan.state === 'disabled');
  if (off.length > 0) {
    out.push(
      `_${off.length} of ${RESEARCH_SCANS.length} scans are switched off: `
      + off.map(scan => escapeMd(scan.label)).join(', ') + '._',
      '',
    );
  }

  if (questions.length > 0) {
    out.push(
      `_${questions.length} claim${questions.length === 1 ? '' : 's'} recorded without a source, held as `
      + 'questions to research rather than as evidence._',
      '',
    );
  }

  if (showAll) {
    out.push('**Every scan**', '');
    for (const scan of schedule.scans) {
      out.push(
        `- ${escapeMd(scan.label)} — \`${scan.state}\`, \`${scan.effectiveLevel}\`, every ${scan.cadenceDays} days`
        + (scan.levelReason ? ` (${escapeMd(scan.levelReason)})` : ''),
      );
    }
    out.push('');
  }

  out.push(`_Source: ${escapeMd(sources.selected ?? sources.noSourceReason ?? 'none')}_`);
  stream.markdown(out.join('\n'));
  stream.button({ command: 'atlasmind.research.runScan', title: 'Run a scan' });
  stream.button({ command: 'atlasmind.research.openDigest', title: 'Open the digest' });
  stream.button({ command: 'atlasmind.research.openRegister', title: 'Open the register' });
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
  // Headed for what it actually counts.
  //
  // `costTracker.getSummary()` is a running total for the workspace, not for the
  // conversation — it survives new chats and reloads, and it was headed "Session
  // Cost Summary". Measured one turn apart: 501 requests / £81.82 and then 502 /
  // £81.84, in a chat holding three messages. A number that cannot be reconciled
  // with what is on screen is worse than no number, because the reader either
  // distrusts every figure AtlasMind reports or, worse, believes this one.
  const summary = atlas.costTracker.getSummary();
  stream.markdown(
    `### Cost so far — this workspace, all sessions\n\n` +
    `| Metric | Value |\n|---|---|\n` +
    `| Total cost | ${formatCostAdaptive(summary.totalCostUsd)} |\n` +
    `| Requests | ${summary.totalRequests} |\n` +
    `| Input tokens | ${summary.totalInputTokens.toLocaleString()} |\n` +
    `| Output tokens | ${summary.totalOutputTokens.toLocaleString()} |\n\n` +
    `_Running totals since tracking began, not this conversation. Each reply's own cost is in its footer._`,
  );
}

/**
 * The deterministic gates a freeform prompt passes before any model sees it,
 * resolved once and returned as data so every surface answers them identically.
 *
 * Both chat surfaces call this — the `@atlas` participant renders the result
 * onto a `ChatResponseStream`, the panel maps it onto its `directResponse`
 * shape — because the audit found three diverging freeform implementations,
 * and the divergence was the defect: conversation recall existed on one
 * surface, intent routing behaved differently on another. A resolver that
 * returns data cannot drift per surface; only the rendering can.
 *
 * Order is deliberate and canonical: a pending-run answer beats everything
 * (the operator is replying to a question we asked); deterministic
 * transcript/registry answers (recall, roadmap, routine-edit) beat intent
 * routing, because an exact answer from a record should never lose to a
 * phrasing match that starts work.
 */
export type FreeformPreflight =
  | { kind: 'recall'; markdown: string }
  | { kind: 'roadmap'; markdown: string; prefills?: SessionComposerPrefill[] }
  | { kind: 'pending-run'; action: 'save' | 'cancel'; entryId: string; goal: string }
  | { kind: 'save-operator-feedback' }
  | { kind: 'intent'; intent: AtlasChatIntent }
  | { kind: 'routine-edit' }
  | undefined;

// Deliberately module-private until the panel adopts it in the cutover commit.
// An export nothing reads is debt this repository measures and caps, and
// "a future commit will use it" is exactly the excuse that ceiling exists to refuse.
async function resolveFreeformPreflight(
  prompt: string,
  transcript: SessionTranscriptEntry[],
): Promise<FreeformPreflight> {
  const pendingRunEntry = [...transcript]
    .reverse()
    .find(entry => entry.role === 'assistant' && entry.meta?.projectRunProposal?.status === 'pending');
  const pendingRunGoal = pendingRunEntry?.meta?.projectRunProposal?.goal;
  if (pendingRunEntry && pendingRunGoal) {
    if (SAVE_PROPOSED_RUN_PATTERN.test(prompt)) {
      return { kind: 'pending-run', action: 'save', entryId: pendingRunEntry.id, goal: pendingRunGoal };
    }
    if (CANCEL_PROPOSED_RUN_PATTERN.test(prompt)) {
      return { kind: 'pending-run', action: 'cancel', entryId: pendingRunEntry.id, goal: pendingRunGoal };
    }
  }

  // The chip's own prompt, matched exactly. Deterministic because it is a write
  // to a git-tracked file: a model deciding whether this counted as a request to
  // save would be the automatic write again, wearing a different hat.
  if (prompt.trim().toLowerCase() === SAVE_OPERATOR_FEEDBACK_PROMPT.toLowerCase()) {
    return { kind: 'save-operator-feedback' };
  }

  // Answered from the transcript, before any model sees it.
  //
  // "What was my question two turns ago?" was answered with a paraphrase of the
  // task in progress — a question the operator had never asked. Of every
  // fabrication available here that is the worst-shaped: fabricating about code
  // can be checked against the code, while fabricating about the exchange
  // contradicts a verbatim record and leaves the operator to remember better
  // than the assistant claims to. The record is exact and sitting in memory, so
  // routing the question to a model can only make the answer worse.
  const recallRequest = parseConversationRecallRequest(prompt);
  if (recallRequest) {
    const recalled = answerConversationRecall(recallRequest, transcript, prompt);
    return { kind: 'recall', markdown: recalled.markdown };
  }

  const roadmapStatus = await buildRoadmapStatusResult(prompt);
  if (roadmapStatus) {
    return {
      kind: 'roadmap',
      markdown: roadmapStatus.markdown,
      ...(roadmapStatus.prefills.length > 0 ? { prefills: roadmapStatus.prefills } : {}),
    };
  }

  if (ROUTINE_EDIT_PATTERN.test(prompt)) {
    return { kind: 'routine-edit' };
  }

  const intent = resolveAtlasChatIntent(prompt, transcript);
  if (intent) {
    return { kind: 'intent', intent };
  }

  return undefined;
}

interface FreeformMessageResult {
  outcome?: ProjectRunOutcome;
  assistantMeta?: SessionTranscriptMetadata;
  handledBy: 'recall' | 'roadmap' | 'routine-edit' | 'pending-run' | 'save-operator-feedback' | 'intent-command' | 'intent-project' | 'model';
}

async function handleFreeformMessage(
  request: vscode.ChatRequest,
  chatContext: vscode.ChatContext | undefined,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  atlas: AtlasMindContext,
  sessionId: string,
  workflowExecutionPolicy?: import('../core/workflowChatGuard.js').WorkflowChatExecutionPolicy,
): Promise<FreeformMessageResult> {
  const prompt = request.prompt;
  const transcript = atlas.sessionConversation.getTranscript(sessionId);
  const preflight = await resolveFreeformPreflight(prompt, transcript);

  if (preflight?.kind === 'pending-run') {
    const entry = transcript.find(item => item.id === preflight.entryId);
    if (entry) {
      atlas.sessionConversation.updateMessage(entry.id, entry.content, sessionId, {
        ...entry.meta,
        projectRunProposal: {
          goal: preflight.goal,
          status: preflight.action === 'save' ? 'saved' : 'cancelled',
        },
      });
    }
    if (preflight.action === 'save') {
      await vscode.commands.executeCommand('atlasmind.openProjectRunCenter', {
        goal: preflight.goal,
        autoPreview: true,
      });
      stream.markdown('Saved the proposed run in **Project Run Center**. You can review and start it there later.');
    } else {
      stream.markdown('Cancelled the proposed project run. No run was started or saved.');
    }
    return { handledBy: 'pending-run' };
  }

  if (preflight?.kind === 'save-operator-feedback') {
    stream.markdown(await saveOperatorFeedbackDraft(atlas));
    return { handledBy: 'save-operator-feedback' };
  }

  if (preflight?.kind === 'recall') {
    stream.markdown(preflight.markdown);
    return { handledBy: 'recall' };
  }

  if (preflight?.kind === 'roadmap') {
    // Prefills are a panel affordance (composer chips); this surface renders the
    // markdown alone and VS Code's own followups carry any next step.
    stream.markdown(preflight.markdown);
    return { handledBy: 'roadmap' };
  }

  if (preflight?.kind === 'routine-edit') {
    await handleRoutineEditIntent(prompt, stream, atlas);
    return { handledBy: 'routine-edit' };
  }

  if (preflight?.kind === 'intent' && preflight.intent.kind === 'project') {
    const pendingRunEntry = [...transcript]
      .reverse()
      .find(entry => entry.role === 'assistant' && entry.meta?.projectRunProposal?.status === 'pending');
    if (pendingRunEntry && isAutonomousContinuationPrompt(prompt)) {
      atlas.sessionConversation.updateMessage(pendingRunEntry.id, pendingRunEntry.content, sessionId, {
        ...pendingRunEntry.meta,
        projectRunProposal: { goal: preflight.intent.goal, status: 'started' },
      });
    }
    stream.markdown('### Autonomous Run\n\nStarting the proposed project run.');
    const { sessionContextBundle, sessionContext } = await prepareProjectRunContext(atlas, sessionId);
    // The goal is passed through **unapproved**, whichever way the run was asked
    // for: a routed intent is a phrasing match on the operator's prompt, not a
    // review of what the run would touch. The file-count gate renders the plan
    // first and offers an "Approve and run" chip carrying the approving prompt.
    const outcome = await runProjectCommand(
      preflight.intent.goal,
      stream,
      token,
      atlas,
      sessionId,
      sessionContextBundle,
      sessionContext,
    );
    return { outcome, handledBy: 'intent-project' };
  }

  if (preflight?.kind === 'intent' && preflight.intent.kind === 'command') {
    await vscode.commands.executeCommand(preflight.intent.commandId, ...(preflight.intent.args ?? []));
    stream.markdown(preflight.intent.summary);
    return { handledBy: 'intent-command' };
  }

  const carryForward = shouldCarryForwardConversationContext(prompt, transcript, chatContext);
  const taskResult = await runChatTask(prompt, stream, atlas, sessionId, {
    token,
    carryForward,
    detectRunProposal: true,
    ...(chatContext ? { native: { request, chatContext } } : {}),
    ...(workflowExecutionPolicy ? { workflowExecutionPolicy } : {}),
  });
  if (taskResult.outcome !== 'completed') {
    return { assistantMeta: taskResult.assistantMeta, handledBy: 'model' };
  }

  // If the reply offered an autonomous project run, flow straight into it rather
  // than stopping for the operator to type "Proceed" — they already asked for the
  // job. Calls the run with a bare goal (not pre-approved) so the file-count safety
  // gate in runProjectCommand stays active for unusually large runs.
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const autoFlow = resolveProjectRunAutoFlow(
    taskResult.transcriptText,
    atlas.sessionConversation.getTranscript(sessionId),
    {
      enabled: configuration.get<boolean>('autoStartProposedProjectRuns', true),
      autopilot: atlas.toolApprovalManager?.isAutopilot?.() ?? false,
    },
  );
  if (!autoFlow || token.isCancellationRequested) {
    return { assistantMeta: taskResult.assistantMeta, handledBy: 'model' };
  }

  stream.markdown(`\n\n---\n\n${autoFlow.notice}\n\n`);
  const { sessionContextBundle, sessionContext } = await prepareProjectRunContext(atlas, sessionId);
  const outcome = await runProjectCommand(autoFlow.goal, stream, token, atlas, sessionId, sessionContextBundle, sessionContext);
  return { outcome, assistantMeta: taskResult.assistantMeta, handledBy: 'model' };
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
  token?: vscode.CancellationToken,
): Promise<void> {
  const { attachments: selectedAttachments, rejections } = await pickImageAttachments();
  const rejectionNotice = describeImageRejections(rejections);

  if (selectedAttachments.length === 0) {
    // "No images were selected" was reported whether the dialog came back empty
    // or every file it returned was refused — so picking one 5 MB screenshot
    // read as picking nothing, and the reason was never stated.
    stream.markdown(rejectionNotice
      ? `${rejectionNotice}\n\nNothing was left to analyse. Run \`/vision\` again with a supported image under the size limit.`
      : 'No images were selected. Run `/vision` again and choose one or more workspace images.');
    return;
  }

  stream.markdown(
    `### Attached Images\n\n${selectedAttachments.map(image => `- ${image.source}`).join('\n')}`
    + (rejectionNotice ? `\n\n${rejectionNotice}` : ''),
  );

  const prompt = request.prompt.trim().length > 0
    ? request.prompt.trim()
    : 'Describe the attached images and highlight anything important.';

  await runChatTask(prompt, stream, atlas, sessionId, {
    attachments: selectedAttachments,
    ...(token ? { token } : {}),
  });
}

interface ChatTaskOptions {
  /** Explicit image attachments (e.g. the /vision picker). When present, inline prompt-path resolution is skipped. */
  attachments?: TaskImageAttachment[];
  /**
   * Cancellation for the model call itself. Without it, Stop left the request
   * running and was consulted only after it returned — so the turn kept spending
   * after the operator had said no.
   */
  token?: vscode.CancellationToken;
  /**
   * Native-surface extras: the live `ChatRequest`/`ChatContext` pair, whose
   * history lines and reference summary the panel assembles for itself. When
   * present, context assembly matches what the native inline path sent.
   */
  native?: { request: vscode.ChatRequest; chatContext: vscode.ChatContext };
  /**
   * Whether prior-turn context travels with this turn. Callers gate this via
   * `shouldCarryForwardConversationContext`; the default (true) preserves the
   * behaviour of paths that always carried it.
   */
  carryForward?: boolean;
  /**
   * Detect a proposed project run in the reply and stamp the pending-proposal
   * metadata (Start / Save for later / Cancel) on the recorded turn.
   */
  detectRunProposal?: boolean;
  workflowExecutionPolicy?: import('../core/workflowChatGuard.js').WorkflowChatExecutionPolicy;
}

interface ChatTaskResult {
  transcriptText: string;
  assistantMeta: SessionTranscriptMetadata;
  outcome: 'completed' | 'cancelled' | 'failed';
}

async function runChatTask(
  prompt: string,
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
  sessionId?: string,
  options: ChatTaskOptions = {},
): Promise<ChatTaskResult> {
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const carryForward = options.carryForward ?? true;
  const storedSessionContext = carryForward
    ? atlas.sessionConversation.buildContext({
      maxTurns: configuration.get<number>('chatSessionTurnLimit', 6),
      maxChars: configuration.get<number>('chatSessionContextChars', 2500),
      ...(sessionId ? { sessionId } : {}),
    })
    : '';
  const nativeHistory = options.native && carryForward
    ? buildNativeChatHistoryLines(options.native.chatContext).join('\n')
    : '';
  const nativeChatContext = options.native
    ? buildNativeChatContextSummary(options.native.request, options.native.chatContext, {
      includeHistory: carryForward,
    })
    : '';
  const sessionContext = [storedSessionContext, nativeHistory].filter(Boolean).join('\n\n');
  const workstationContext = buildWorkstationContext();
  const explicitAttachments = options.attachments ?? [];
  const inlineResolution = explicitAttachments.length > 0
    ? { attachments: [], rejections: [] }
    : await resolveInlineImageAttachmentsDetailed(prompt);
  const imageAttachments = mergeImageAttachments(explicitAttachments, inlineResolution.attachments);
  // Said before the answer, not after: an operator who mentioned a screenshot
  // should learn it was too large to send *while* reading the reply, not conclude
  // the model looked at it and misunderstood.
  const inlineRejectionNotice = describeImageRejections(inlineResolution.rejections);
  if (inlineRejectionNotice) {
    stream.markdown(`${inlineRejectionNotice}\n\n`);
  }
  const operatorAdaptation = await applyOperatorFrustrationAdaptation(prompt, atlas, {
    sessionContext,
    ...(nativeChatContext ? { nativeChatContext } : {}),
  });
  let streamedText = '';
  const chunkBuffer = createStreamBuffer(stream);
  const abortController = new AbortController();
  const cancellationSubscription = options.token?.onCancellationRequested(() => abortController.abort());

  let result: TaskResult;
  try {
    result = await atlas.orchestrator.processTask({
      id: `task-${Date.now()}`,
      userMessage: prompt,
      context: {
        ...(sessionContext ? { sessionContext } : {}),
        ...(nativeChatContext ? { nativeChatContext } : {}),
        ...(workstationContext ? { workstationContext } : {}),
        ...(imageAttachments.length > 0 ? { imageAttachments } : {}),
        ...(operatorAdaptation?.contextPatch ?? {}),
        ...(options.workflowExecutionPolicy ? { __workflowChatPolicy: options.workflowExecutionPolicy } : {}),
      },
      constraints: {
        budget: toBudgetMode(configuration.get<string>('budgetMode')),
        speed: toSpeedMode(configuration.get<string>('speedMode')),
        ...(imageAttachments.length > 0 ? { requiredCapabilities: ['vision' as const] } : {}),
      },
      timestamp: new Date().toISOString(),
      ...(options.token ? { signal: abortController.signal } : {}),
    }, chunk => {
      if (!chunk || abortController.signal.aborted) {
        return;
      }
      streamedText += chunk;
      chunkBuffer.push(chunk);
    }, message => {
      if (!message.trim() || abortController.signal.aborted) {
        return;
      }
      stream.progress(message);
    });
  } catch (error) {
    // A provider throw used to escape the handler to VS Code's generic error
    // banner, and `recordTurn` never ran — so the turn disappeared from history
    // entirely, the operator's own message with it. Whatever was streamed before
    // the failure is kept: a partial answer is worth more than a deleted one.
    chunkBuffer.flush();
    const cancelled = abortController.signal.aborted || options.token?.isCancellationRequested === true;
    const message = error instanceof Error ? error.message : String(error);
    const notice = cancelled
      ? '_Request stopped._'
      : `**Request failed:** ${message}\n\n_Send the prompt again to retry._`;
    stream.markdown(`${streamedText ? '\n\n' : ''}${notice}`);
    const transcriptText = [streamedText.trim(), notice].filter(Boolean).join('\n\n');
    const assistantMeta: SessionTranscriptMetadata = {
      modelUsed: cancelled ? 'atlasmind/stopped' : 'atlasmind/error',
      turnError: cancelled ? { kind: 'cancelled' } : { kind: 'failed', message },
    };
    atlas.sessionConversation.recordTurn(prompt, transcriptText, sessionId, assistantMeta, {
      assistantClassification: cancelled ? 'system' : 'error',
    });
    cancellationSubscription?.dispose();
    return { transcriptText, assistantMeta, outcome: cancelled ? 'cancelled' : 'failed' };
  } finally {
    cancellationSubscription?.dispose();
  }
  chunkBuffer.flush();

  if (abortController.signal.aborted || options.token?.isCancellationRequested) {
    const notice = '_Request stopped._';
    stream.markdown(`${streamedText ? '\n\n' : ''}${notice}`);
    const transcriptText = [streamedText.trim(), notice].filter(Boolean).join('\n\n');
    const assistantMeta: SessionTranscriptMetadata = {
      modelUsed: 'atlasmind/stopped',
      turnError: { kind: 'cancelled' },
    };
    atlas.sessionConversation.recordTurn(prompt, transcriptText, sessionId, assistantMeta, {
      assistantClassification: 'system',
    });
    return { transcriptText, assistantMeta, outcome: 'cancelled' };
  }

  const reconciled = reconcileAssistantResponse(streamedText, result.response);
  if (reconciled.additionalText) {
    writeMarkdownChunk(stream, reconciled.additionalText, 'chat task completion');
  }
  let assistantMeta = buildAssistantResponseMetadata(prompt, result, {
    hasSessionContext: Boolean(sessionContext),
    imageAttachments,
    routingContext: {
      ...(sessionContext ? { sessionContext } : {}),
      ...(nativeChatContext ? { nativeChatContext } : {}),
      ...(operatorAdaptation?.contextPatch ?? {}),
    },
    policies: [
      ...atlas.getWorkspacePolicySnapshots(),
      ...(operatorAdaptation?.policySnapshot ? [operatorAdaptation.policySnapshot] : []),
    ],
    ...(options.native ? { responseText: reconciled.transcriptText } : {}),
  });

  if (options.detectRunProposal) {
    const transcript = sessionId ? atlas.sessionConversation.getTranscript(sessionId) : [];
    const proposal = resolveProjectRunProposal(
      reconciled.transcriptText,
      [
        ...transcript,
        {
          id: `proposal-${Date.now()}`,
          role: 'assistant',
          content: reconciled.transcriptText,
          timestamp: new Date().toISOString(),
        },
      ],
    );
    if (proposal) {
      assistantMeta = {
        ...assistantMeta,
        followupQuestion: 'What should I do with this proposed project run?',
        quickReplies: undefined,
        projectRunProposal: { goal: proposal.goal, status: 'pending' },
        suggestedFollowups: [
          { label: 'Start run', prompt: 'Proceed', description: 'Start the autonomous project run now.' },
          { label: 'Save for later', prompt: 'Save this proposed project run for later.', description: 'Create a reviewed preview in Project Run Center.' },
          { label: 'Cancel', prompt: 'Cancel this proposed project run.', description: 'Dismiss the proposal without starting or saving it.' },
        ],
      };
    }
  }

  stream.markdown(renderAssistantResponseFooter(assistantMeta, reconciled.transcriptText));
  atlas.sessionConversation.recordTurn(prompt, reconciled.transcriptText, sessionId, assistantMeta);

  // If TTS auto-speak is enabled, forward the response to the voice manager.
  if (configuration.get<boolean>('voice.ttsEnabled', false)) {
    atlas.voiceManager.speak(reconciled.transcriptText);
  }

  return { transcriptText: reconciled.transcriptText, assistantMeta, outcome: 'completed' };
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

  // The orchestrator now commits only the winning attempt, so normal routed
  // turns reach this function with identical streamed and final text. If a
  // legacy caller has already rendered divergent text we cannot retract it from
  // VS Code's append-only stream. Separate the authoritative completion
  // visually, while retaining only that completion in conversation history.
  //
  // It is **labelled**, because a horizontal rule alone left the operator
  // reading two different answers to one question with nothing saying which was
  // real — and the first one, the one they had already read, was the wrong one.
  // Retracting is impossible on an append-only stream; saying so is not.
  const authoritative = sanitizeResponseTail(finalResponse);
  return {
    additionalText: `\n\n---\n\n_The reply above was superseded while it was being written. This is the answer AtlasMind committed:_\n\n${authoritative}`,
    transcriptText: authoritative,
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

  // Strip a trailing bare section header (heading line with nothing after it) —
  // but not where dropping it takes content with it.
  //
  // Two cases it used to destroy. A closing prompt formatted as a heading
  // ("### Ready to proceed?") *is* the question, and models format one that way
  // constantly; because this runs before quick-reply detection, striking it
  // deleted the question before the operator could ever see it. And a heading
  // that answers a lead-in ("Here is what I would change:\n\n## Next steps")
  // leaves the reply ending on a colon pointing at nothing, which reads as a
  // truncation bug rather than as tidying.
  result = result.replace(/\n(#{1,6}\s+[^\n]+)\n?\s*$/, (whole: string, header: string) => {
    if (/\?\s*$/.test(header.trim())) {
      return whole;
    }
    const before = result.slice(0, result.length - whole.length).trimEnd();
    return /[:—-]$/.test(before) ? whole : '';
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
    if (metadata?.quickReplies?.length) {
      return `${followupQuestion}\n\nChoose an option below, or type a different response.`;
    }
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

/** Longest trailing clause that may follow the question and still be an aside. */
const MAX_POST_QUESTION_CLAUSE_CHARS = 120;

/**
 * Drop a short clause that follows the question on the same line.
 *
 * *"Would you like me to inspect the exact agent configuration for you? If so, I
 * can fetch and analyze `agents/customer-researcher.md` directly."* — taken from
 * a real session. The question is there; it simply is not last, and every check
 * in this file anchored on the line *ending* in `?`, so the operator got no
 * chips and no recorded follow-up.
 *
 * That is the third shape of one mistake. A question mark preceded by a full
 * stop was fixed in v0.311.1, an offer with no question mark at all in v0.315.0,
 * and this is a question mark with something after it. Each was found by running
 * real output rather than by writing another probe, because a probe corpus
 * written by the same hand as the detector shares its assumptions about what
 * output looks like.
 *
 * Bounded, because the aside has to *be* an aside: a long paragraph following a
 * rhetorical question is prose, and turning it into a prompt would put a
 * Yes/No under a sentence nobody was being asked to answer.
 */
function trimClauseAfterQuestion(line: string): string {
  const lastQuestion = line.lastIndexOf('?');
  if (lastQuestion < 0 || lastQuestion === line.trimEnd().length - 1) {
    return line;
  }
  const trailing = line.slice(lastQuestion + 1).trim();
  return trailing.length > 0 && trailing.length <= MAX_POST_QUESTION_CLAUSE_CHARS
    ? line.slice(0, lastQuestion + 1)
    : line;
}

/**
 * A conditional opener addressed to the operator: "If you want, …",
 * "Let me know if …", "Happy to …".
 */
// `s?` on the verb, not a bare `\b` after it. "If **The User wants**, I can …"
// is a real transcript, and `\b` cannot fire between the "t" of "want" and the
// "s" that follows it — both are word characters. Every hand-written probe used
// "if you want," where the comma supplied the boundary, so the whole shape
// passed while the real one did not.
const OFFER_CONDITION_PATTERN = /\b(?:if\s+(?:you|the\s+user)(?:'d|\s+would)?\s*(?:want|like|prefer|wish)(?:s|ed)?\b|let\s+me\s+know\s+if\b|say\s+the\s+word\b)/i;

/**
 * Phrasings that are an offer on their own, needing no separate condition.
 *
 * "Happy to split that into two commits" is elliptical for "I would be happy
 * to", so the undertaking and the offer are the same words — requiring a
 * condition beside it would miss the shape entirely.
 */
const SELF_EVIDENT_OFFER_PATTERN = /\b(?:i'?d\s+be\s+(?:glad|happy)\s+to|i'?m\s+happy\s+to|happy\s+to)\s+\w/i;

/**
 * A first-person undertaking to *do* it: "I can …", "I'll …", "let me …".
 *
 * Required alongside the condition, and it is what separates an offer from
 * advice. "If you want multi-instance durability, **use** Cloudflare KV" opens
 * identically and then tells the operator what to do — turning that into a
 * Yes/No prompt would submit an answer to a question nobody asked.
 */
const OFFER_UNDERTAKING_PATTERN = /\b(?:i\s+can|i\s+could|i'?ll|i\s+will|i'?d\s+be\s+glad\s+to|let\s+me)\s+(?!see\b|tell\b|confirm\b|report\b|find\b)\w/i;

/**
 * An offer the model made without a question mark.
 *
 * Every one of an ACP model's four turns in a real session closed this way —
 * "If you want, I can also add a short release notes heading…", "If The User
 * wants, I can start a project run next to…" — and the detector keys on `?`, so
 * the operator was shown three genuine offers and given no way to accept any of
 * them. The automated probes all passed throughout, because their inputs were
 * written by the same hand that wrote the detector and every one carried a `?`.
 *
 * Both halves are required. A condition alone is advice; an undertaking alone is
 * narration ("I can see the file is missing", excluded above by verb).
 */
function extractDeclarativeOffer(line: string): string | undefined {
  const stripped = stripLeadingMarker(stripMarkdownEmphasis(line));
  if (stripped.length < 12 || stripped.length > 300) {
    return undefined;
  }
  const offered = SELF_EVIDENT_OFFER_PATTERN.test(stripped)
    || (OFFER_CONDITION_PATTERN.test(stripped) && OFFER_UNDERTAKING_PATTERN.test(stripped));
  return offered ? stripped : undefined;
}

/** Longest pill label shown before it is abbreviated. */
const MAX_QUICK_REPLY_LABEL_CHARS = 48;

/**
 * Abbreviate a pill label on a word boundary, marking it as abbreviated.
 *
 * A mid-word cut reads as a rendering bug; the ellipsis reads as "there is more
 * here", which is true — the full text is what the pill submits.
 */
function clampQuickReplyLabel(label: string): string {
  if (label.length <= MAX_QUICK_REPLY_LABEL_CHARS) {
    return label;
  }
  const head = label.slice(0, MAX_QUICK_REPLY_LABEL_CHARS - 1);
  const lastSpace = head.lastIndexOf(' ');
  return `${(lastSpace > 20 ? head.slice(0, lastSpace) : head).trimEnd()}…`;
}

/** Extract a clean pick-one label from a list-item line (lead phrase before any "— explanation"). */
function extractOptionLabel(line: string): string {
  let label = line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '');
  label = label.replace(/\*\*|__|`/g, '');
  label = label.split(/\s+[—–]\s+|\s+-\s+|:\s+/)[0];
  return label.replace(/[.,;:!?]+\s*$/, '').trim();
}

/**
 * Split a line into sentences, treating a full stop as a boundary only where a
 * human would.
 *
 * A bare `[^.!?]*` — which is what this replaced — cannot cross a full stop at
 * all, so "Want me to update README.md?" yielded `md?`: three characters, below
 * the length guard, discarded. The question then reached the operator as
 * nothing at all — no pills, no follow-up prompt. Every closing offer naming a
 * file, a path or a version disappeared the same way, which is most of what
 * Atlas offers to do in a codebase.
 *
 * Requiring whitespace *and* a capital after the stop is what distinguishes a
 * sentence boundary from the dots inside `README.md`, `src/chat/participant.ts`
 * and `v0.310.2` — none of which is followed by a space — and from `i.e.` and
 * `e.g.`, which are followed by a lower-case word.
 */
function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=["'“(\[]?[A-Z0-9])/).map(part => part.trim()).filter(Boolean);
}

/**
 * Extract the question clause from a line.
 *
 * Where the line ends with several questions ("Should I update the wiki as well?
 * And do you want a changelog entry?") all of the trailing consecutive ones are
 * returned together. Surfacing only the last made the operator's "yes" answer a
 * question they had never seen singled out.
 */
function extractQuestionClause(line: string): string | undefined {
  const stripped = stripLeadingMarker(stripMarkdownEmphasis(line));
  const sentences = splitSentences(stripped);

  let start = sentences.length;
  while (start > 0 && /\?\s*$/.test(sentences[start - 1]!)) {
    start -= 1;
  }
  const question = (start < sentences.length ? sentences.slice(start).join(' ') : stripped).trim();
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
function analyzeTrailingQuestion(text: string): { question: string; optionLines: string[]; isOffer?: boolean } | undefined {
  if (!text) { return undefined; }
  // The trailing aside is dropped before anything else looks at the line, so
  // every check below still sees a line that ends in its question.
  const lines = text.split('\n').map(line => trimClauseAfterQuestion(line.trim()));
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
    if (match?.[1]) {
      return { question: match[1].trim(), optionLines: [] };
    }
    // No question mark anywhere. An offer can still have been made — models
    // routinely close with "If you want, I can …" — and it takes a yes or no
    // exactly as "Want me to …?" does.
    const offer = extractDeclarativeOffer(lines[end]!);
    return offer ? { question: offer, optionLines: [], isOffer: true } : undefined;
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
  const { question, optionLines, isOffer } = analysis;

  // Yes / No — confirmatory questions (checked first so a yes/no question that
  // happens to sit above a list is never mistaken for a pick-one). A declarative
  // offer is one of these by construction: it proposes a single action, and the
  // only answers are take it or leave it.
  if (isOffer || isYesNoQuestion(question)) {
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
    // A long option is truncated for the pill, not dropped.
    //
    // The cap used to discard the whole set: asked to explain its options a model
    // writes clauses rather than nouns ("Narrow the tool-failure predicate to an
    // exit code so ordinary file reads stop counting"), every label exceeded 48
    // characters, and a genuine two-way choice arrived with nothing to click. The
    // submitted prompt stays the full label, and the ellipsis tells the operator
    // the pill is showing them an abbreviation.
    const labels = optionLines.map(extractOptionLabel).filter(label => label.length >= 2);
    if (labels.length === optionLines.length && labels.length >= 2 && labels.length <= 5) {
      return {
        followupQuestion: question,
        quickReplies: labels.map(label => ({
          label: capitalizeFirst(clampQuickReplyLabel(label)),
          prompt: label,
        })),
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

/**
 * A webview-ready quick-reply payload for the surfaces outside the main Chat
 * panel (the dashboard ideation chat, the Ideation panel, the Vision panel).
 *
 * Those panels don't consume `SessionTranscriptMetadata`, so they need the pills
 * as their own message. Pills only — a bare detected question yields nothing,
 * matching the Chat panel, where a question with no clean options gets the text
 * input rather than invented buttons.
 *
 * Both fields are **model output**: the label is rendered and the prompt is
 * *submitted on click*, so each is length-capped and control-stripped here, at
 * the single point where they cross into a webview.
 */
export interface WebviewQuickReplyPayload {
  question: string;
  replies: Array<{ label: string; prompt: string }>;
}

const MAX_QUICK_REPLY_PILLS = 5;

export function buildQuickReplyPayload(responseText: string | undefined): WebviewQuickReplyPayload | undefined {
  if (typeof responseText !== 'string' || responseText.trim().length === 0) {
    return undefined;
  }
  const detected = detectResponseQuickReplies(responseText);
  if (!detected?.quickReplies?.length) {
    return undefined;
  }
  const clampField = (value: unknown, max: number): string => (
    typeof value === 'string'
      ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
      : ''
  );
  const replies = detected.quickReplies
    .slice(0, MAX_QUICK_REPLY_PILLS)
    .map(reply => ({ label: clampField(reply.label, 60), prompt: clampField(reply.prompt, 400) }))
    .filter(reply => reply.label.length > 0 && reply.prompt.length > 0);
  if (replies.length === 0) {
    return undefined;
  }
  return { question: clampField(detected.followupQuestion, 300), replies };
}

export function buildAssistantResponseMetadata(
  prompt: string,
  result: Pick<TaskResult, 'agentId' | 'modelUsed' | 'costUsd' | 'inputTokens' | 'outputTokens' | 'modelAttempts' | 'artifacts' | 'autoDisabledProvider' | 'contextCompressionSavingsUsd' | 'iterationLimitHit' | 'suggestedIterationLimit' | 'suggestedToolCallsPerTurnLimit'>,
  options?: { hasSessionContext?: boolean; imageAttachments?: TaskImageAttachment[]; routingContext?: Record<string, unknown>; policies?: SessionPolicySnapshot[]; responseText?: string },
): SessionTranscriptMetadata {
  const toolCallCount = result.artifacts?.toolCallCount ?? 0;
  const toolCalls = result.artifacts?.toolCalls ?? [];
  const responseWasEmpty = options?.responseText !== undefined && options.responseText.trim().length === 0;
  const attempts = result.modelAttempts ?? [];
  const failedAttempts = attempts.filter(attempt =>
    attempt.status === 'timeout' || attempt.status === 'error' || attempt.status === 'capability-mismatch',
  );
  const supersededAttempts = attempts.filter(attempt => attempt.status === 'escalated');

  // Build a concise, action-oriented summary line.
  let summary: string;
  if (responseWasEmpty) {
    summary = result.autoDisabledProvider
      ? `${result.autoDisabledProvider.displayName} stopped before returning an answer.`
      : 'No usable answer was returned.';
  } else if (failedAttempts.some(attempt => attempt.model !== result.modelUsed)) {
    const others = failedAttempts.filter(attempt => attempt.model !== result.modelUsed).length;
    summary = `Completed after ${attempts.length} model attempt${attempts.length === 1 ? '' : 's'}; ${others} did not complete.`;
  } else if (toolCallCount > 0) {
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

  if (result.autoDisabledProvider) {
    bullets.push(
      result.autoDisabledProvider.failoverModelUsed
        ? `${result.autoDisabledProvider.displayName} was paused; failover attempted with ${result.autoDisabledProvider.failoverModelUsed}.`
        : `${result.autoDisabledProvider.displayName} was paused and no fallback model completed the request.`,
    );
  }
  // The model that answered is never also reported as having failed.
  //
  // A model can be tried, refused, and tried again successfully, which produced
  // a summary reading "final model: mistral-small" directly above "Did not
  // complete: ..., mistral-small (capability-mismatch)" — and a headline of
  // "Completed after 5 attempts; 5 did not complete", which cannot be true of a
  // turn that produced an answer. The reader's question is which models failed
  // them, and for the one that answered the honest answer is none.
  const unsuccessfulAttempts = failedAttempts.filter(attempt => attempt.model !== result.modelUsed);
  if (attempts.length > 1 || unsuccessfulAttempts.length > 0 || supersededAttempts.length > 0) {
    bullets.push(
      `${attempts.length} model attempt${attempts.length === 1 ? '' : 's'}; final model: ${result.modelUsed}.`,
    );
  }
  if (unsuccessfulAttempts.length > 0) {
    bullets.push(`Did not complete: ${unsuccessfulAttempts.map(attempt => `${attempt.model} (${attempt.status})`).join(', ')}.`);
  }
  if (supersededAttempts.length > 0) {
    bullets.push(`Superseded after a struggle signal: ${supersededAttempts.map(attempt => attempt.model).join(', ')}.`);
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

  const suggestedFollowups = responseWasEmpty
    ? undefined
    : buildSuggestedExecutionFollowups(prompt, options?.routingContext ?? {});
  const timelineNotes = buildTimelineNotes(options?.routingContext ?? {});

  const emptyResponseRecovery = responseWasEmpty
    ? {
      followupQuestion: result.autoDisabledProvider
        ? `${result.autoDisabledProvider.displayName} returned no answer. What should Atlas do next?`
        : 'The model returned no usable answer. What should Atlas do next?',
      quickReplies: [
        {
          label: result.autoDisabledProvider ? 'Retry elsewhere' : 'Retry',
          prompt: 'Retry my previous request using available local or subscription-backed capacity. If no eligible model is available, explain why.',
          description: 'Retry without selecting the failed pay-per-token route.',
        },
        {
          label: 'Provider status',
          prompt: 'Show which model providers are currently eligible and explain why the previous request failed.',
          description: 'Review routing eligibility and the provider failure.',
        },
      ],
    } satisfies Pick<SessionTranscriptMetadata, 'followupQuestion' | 'quickReplies'>
    : undefined;

  // Detect quick-reply opportunities from the response text. These take lower
  // priority than the explicit suggestedFollowups (fix/explain/autonomous choices).
  const responseQuickReplies = !emptyResponseRecovery && !suggestedFollowups && options?.responseText
    ? detectResponseQuickReplies(options.responseText)
    : undefined;

  return {
    modelUsed: result.modelUsed,
    // Carried so the footer can say what the turn cost. Zero is meaningful — a
    // local or subscription-backed turn — so this is not conditional on truthiness.
    ...(typeof result.costUsd === 'number' ? { costUsd: result.costUsd } : {}),
    ...(typeof result.inputTokens === 'number' ? { inputTokens: result.inputTokens } : {}),
    ...(typeof result.outputTokens === 'number' ? { outputTokens: result.outputTokens } : {}),
    ...(attempts.length > 1
      ? { modelsUsed: [...new Set(attempts.map(attempt => attempt.model))] }
      : {}),
    ...(result.iterationLimitHit ? { iterationLimitHit: true } : {}),
    ...(typeof result.suggestedIterationLimit === 'number' ? { suggestedIterationLimit: result.suggestedIterationLimit } : {}),
    ...(typeof result.suggestedToolCallsPerTurnLimit === 'number'
      ? { suggestedToolCallsPerTurnLimit: result.suggestedToolCallsPerTurnLimit }
      : {}),
    ...(options?.policies?.length ? { policies: options.policies.map(policy => ({ ...policy })) } : {}),
    ...(timelineNotes.length ? { timelineNotes } : {}),
    ...(emptyResponseRecovery
      ? emptyResponseRecovery
      : suggestedFollowups
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
  const pausedSubtasks = result?.subTaskResults.filter(subtask => subtask.status === 'needs-input') ?? [];
  const suggestedIterationLimit = pausedSubtasks
    .map(subtask => subtask.suggestedIterationLimit)
    .filter((value): value is number => typeof value === 'number')
    .reduce<number | undefined>((max, value) => max === undefined ? value : Math.max(max, value), undefined);
  const suggestedToolCallsPerTurnLimit = pausedSubtasks
    .map(subtask => subtask.suggestedToolCallsPerTurnLimit)
    .filter((value): value is number => typeof value === 'number')
    .reduce<number | undefined>((max, value) => max === undefined ? value : Math.max(max, value), undefined);
  if (result) {
    const completedCount = result.subTaskResults.filter(r => r.status === 'completed').length;
    bullets.push(`${completedCount}/${result.subTaskResults.length} subtask(s) completed.`);
    if (pausedSubtasks.length > 0) {
      bullets.push(`${pausedSubtasks.length} subtask(s) paused at an execution safety limit and need your decision.`);
    }
    bullets.push(`${formatCost(result.totalCostUsd, 4)} · ${result.totalInputTokens.toLocaleString()} in / ${result.totalOutputTokens.toLocaleString()} out`);
  } else {
    bullets.push('Planner, execution, and synthesis may each pick a different model based on cost, speed, and capability constraints.');
    bullets.push('Open the Project Run Center to inspect per-subtask outputs and execution history.');
  }

  return {
    modelUsed: 'multiple routed models',
    ...(pausedSubtasks.length > 0 ? { iterationLimitHit: true } : {}),
    ...(suggestedIterationLimit !== undefined ? { suggestedIterationLimit } : {}),
    ...(suggestedToolCallsPerTurnLimit !== undefined ? { suggestedToolCallsPerTurnLimit } : {}),
    thoughtSummary: {
      label: 'Execution summary',
      summary: result
        ? `Project completed: ${result.subTaskResults.length} subtask(s) executed with autonomous model routing.`
        : 'Autonomous project mode can route planning, sub-agents, and synthesis through different models.',
      bullets,
    },
  };
}

/**
 * @param answerText the reply this footer will sit beneath, when the caller has
 * it. Used only to suppress a "Next step" that would repeat a question the
 * operator has just read.
 */
export function renderAssistantResponseFooter(
  metadata: SessionTranscriptMetadata | undefined,
  answerText?: string,
): string {
  if (!metadata?.modelUsed && !metadata?.thoughtSummary && !metadata?.followupQuestion && !metadata?.timelineNotes?.length) {
    return '';
  }

  const sections: string[] = [];
  if (metadata.modelUsed) {
    // The transcript is where the spend is actually incurred, and it was the one
    // surface that never mentioned it: the footer named the model and stopped,
    // on a product that routes across paid providers and ships a cost dashboard.
    // Zero is worth printing — a local or subscription-backed turn costing
    // nothing is a fact about the routing, not an absence of information.
    const spend = typeof metadata.costUsd === 'number'
      ? ` · ${formatCost(metadata.costUsd, 4)}`
      : '';
    const tokens = typeof metadata.inputTokens === 'number' && typeof metadata.outputTokens === 'number'
      ? ` · ${metadata.inputTokens.toLocaleString()} in / ${metadata.outputTokens.toLocaleString()} out`
      : '';
    sections.push(`\n\n---\n_Model: ${metadata.modelUsed}${spend}${tokens}_`);
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
    // The question is lifted out of the reply's own tail, so restating it under
    // "Next step" printed it twice in one turn, the two copies separated by a
    // few lines. Where the answer already ends with it, only the options are
    // worth adding.
    const labels = metadata.suggestedFollowups?.map(item => `- ${item.label}`).join('\n') ?? '';
    const alreadyAsked = typeof answerText === 'string'
      && answerText.trimEnd().toLowerCase().endsWith(metadata.followupQuestion.trim().toLowerCase());
    if (!alreadyAsked) {
      sections.push(`\n\n**Next step:** ${metadata.followupQuestion}${labels ? `\n\n${labels}` : ''}`);
    } else if (labels) {
      sections.push(`\n\n${labels}`);
    }
  }

  if (metadata.timelineNotes?.length) {
    const notes = metadata.timelineNotes.map(note => `- ${note.label}: ${note.summary}`).join('\n');
    sections.push(`\n\n**Session timeline:**\n${notes}`);
  }

  // Suggestions, never changes. The automatic path that used to act on this kind
  // of signal wrote settings into a committed file without naming them; what was
  // worth keeping about it was the noticing. Applying one goes through
  // `atlasmind-settings`, which puts a modal naming both values in front of the
  // operator.
  const fit = deriveSessionFitSuggestions({
    ...(metadata.iterationLimitHit ? { iterationLimitHit: true } : {}),
    ...(typeof metadata.suggestedIterationLimit === 'number' ? { suggestedIterationLimit: metadata.suggestedIterationLimit } : {}),
    ...(typeof metadata.suggestedToolCallsPerTurnLimit === 'number'
      ? { toolCallsPerTurnLimitHit: true, suggestedToolCallsPerTurnLimit: metadata.suggestedToolCallsPerTurnLimit }
      : {}),
  });
  if (fit.length > 0) {
    sections.push(`\n\n**Worth changing:**\n${fit.map(entry => `- ${entry.message}`).join('\n')}`);
  }

  return sections.join('');
}

function buildTimelineNotes(routingContext: Record<string, unknown>): SessionTimelineNote[] {
  if (typeof routingContext['userFrustrationSignal'] !== 'string') {
    return [];
  }

  return [{
    label: 'Learned from friction',
    summary: 'Atlas adjusted its approach for this session after the operator signalled frustration, and drafted a note for project memory. Nothing was written — use "Save this feedback rule" to keep it.',
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

  const followups: SessionSuggestedFollowup[] = [
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

  // Offered, never taken automatically: the note goes into a git-tracked file and
  // quotes the operator's own words back.
  if (typeof routingContext['userFrustrationSignal'] === 'string') {
    followups.push({
      label: 'Save this feedback rule',
      prompt: SAVE_OPERATOR_FEEDBACK_PROMPT,
      description: `Writes ${OPERATOR_FEEDBACK_FILE} in project memory, which is tracked by git.`,
    });
  }

  return followups;
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
      // `just do it` carries a lookahead because it is the one phrase here that is
      // just as often an ordinary instruction: "just do it the simple way" says
      // *how*, and reading that as a complaint was one of two false positives
      // measured against benign phrasing.
      pattern: /\b(?:frustrat(?:ed|ing)|annoy(?:ed|ing)|useless|stop giving me|just do (?:it|that)\b(?!\s+(?:the|a|an|in|with|using|for)\b)|not doing what i ask|doesn'?t want to do|why aren'?t you doing|you'?re not listening|you are not listening|forget it|i'?ll do it myself)\b/i,
      matchedCue: 'explicit-frustration',
      summary: 'The operator explicitly signaled frustration with Atlas failing to act.',
      guidance: 'Acknowledge the miss briefly, then move straight to the most concrete safe action instead of repeating advisory prose.',
    },
    {
      level: 'moderate',
      // `can you do this for me` is NOT here, deliberately. It is an ordinary
      // polite request — the other measured false positive — and it used to fire
      // this whole adaptation on a turn where nothing had gone wrong. Its negated
      // form ("can you *not* do this for me") stays, because that is a complaint.
      //
      // The additions are shapes taken from how people actually complain, all of
      // which went unrecognised: repetition ("that's the third time"), a
      // correction naming what was asked for instead ("I asked you to fix it, not
      // explain it"), and the offer-instead-of-doing pattern this codebase
      // produces often enough to have its own probe.
      pattern: /\b(?:can you not do (?:this|that|it|them) for me|i want .* resolved|i want the reason .* resolved|no,? i want|instead of (?:advice|explaining)|not doing what i asked|(?:that'?s|this is) the (?:second|third|fourth|fifth|\d+(?:st|nd|rd|th)) time|for the (?:second|third|fourth|fifth) time|i asked you (?:to|for) [^,]{2,60},? not\b|you keep (?:offering|asking|suggesting|telling)|why do you keep)\b/i,
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
  // Runs whichever way the branch below goes: it is undoing writes an earlier
  // build made without asking, and that is owed regardless of what this turn
  // says.
  const workspaceState = atlas.extensionContext?.workspaceState;
  if (workspaceState) {
    await restoreSettingsWrittenWithoutAsking(workspaceState);
  }

  const signal = detectUserFrustrationSignal(prompt);
  if (!signal) {
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

  // The note is drafted and held, not written.
  //
  // This used to write `project_memory/operations/operator-feedback.md` — a
  // git-tracked file — containing an excerpt of the operator's own prompt, on
  // any frustration-cue match, announced nowhere they would read it. It is the
  // same shape as the settings write DECISION-2 already removed, one file over,
  // and it outlives the conversation in a way nothing else here does. The draft
  // now waits behind a chip; the offer is in the reply, and the write happens
  // when somebody asks for it.
  await workspaceState.update(PENDING_OPERATOR_FEEDBACK_STORAGE_KEY, {
    version: 1 as const,
    timestamp: now,
    markdown: buildOperatorFeedbackMarkdown(prompt, signal, profile, now),
  });
}

/**
 * The exact prompt the "Save this feedback rule" chip submits, and the phrase the
 * preflight matches. One constant so the chip and its handler cannot drift.
 */
export const SAVE_OPERATOR_FEEDBACK_PROMPT = 'Save the operator-feedback note to project memory.';

interface PendingOperatorFeedbackDraft {
  version: 1;
  timestamp: string;
  markdown: string;
}

function isPendingOperatorFeedbackDraft(value: unknown): value is PendingOperatorFeedbackDraft {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate['version'] === 1
    && typeof candidate['timestamp'] === 'string'
    && typeof candidate['markdown'] === 'string';
}

/** Writes the held draft, if there is one. Returns what the reply should say. */
export async function saveOperatorFeedbackDraft(atlas: AtlasMindContext): Promise<string> {
  const workspaceState = atlas.extensionContext.workspaceState;
  const stored = workspaceState.get<unknown>(PENDING_OPERATOR_FEEDBACK_STORAGE_KEY);
  if (!isPendingOperatorFeedbackDraft(stored)) {
    return 'There is no operator-feedback note waiting to be saved.';
  }

  const ssotRoot = getSsotRootUri();
  if (!ssotRoot) {
    return 'No project memory folder is available in this workspace, so the note was not saved.';
  }

  try {
    const targetUri = vscode.Uri.joinPath(ssotRoot, ...OPERATOR_FEEDBACK_FILE.split('/'));
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(ssotRoot, 'operations'));
    await vscode.workspace.fs.writeFile(targetUri, Buffer.from(stored.markdown, 'utf-8'));
    await atlas.memoryManager.loadFromDisk(ssotRoot);
    atlas.memoryRefresh.fire();
    await workspaceState.update(PENDING_OPERATOR_FEEDBACK_STORAGE_KEY, undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Could not write \`${OPERATOR_FEEDBACK_FILE}\`: ${message}`;
  }

  // Quoted back, because the file is committed and contains an excerpt of the
  // operator's own words. They should see exactly what was stored, here, rather
  // than discovering it in a diff.
  return [
    `Saved \`${OPERATOR_FEEDBACK_FILE}\` in project memory. This file is tracked by git — here is exactly what it now contains:`,
    '',
    '```markdown',
    stored.markdown.trim(),
    '```',
  ].join('\n');
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

/**
 * Undo the settings an earlier build wrote on the operator's behalf.
 *
 * Until v0.310.4 a detected frustration signal raised `chatSessionTurnLimit` and
 * `chatSessionContextChars` automatically, at
 * `ConfigurationTarget.Workspace` — i.e. into `.vscode/settings.json`, a file
 * most repositories commit — and named neither in anything the operator read.
 * The only trace in the turn was a timeline note reading "Learned from friction".
 *
 * Two things made that indefensible rather than merely brisk. The detector fired
 * on ordinary polite requests ("can you do this for me when you have a moment"),
 * so the write happened on turns where nothing had gone wrong. And a settings
 * change nobody is told about cannot be reviewed, reverted, or even attributed —
 * it just appears in somebody's diff.
 *
 * A tuning suggestion is the right shape for this, and that already exists: the
 * tool-iteration ceiling names a value and offers a button. This restores what
 * was written, once, and clears the snapshot; the suggestion path carries the
 * intent from here.
 *
 * Restoration is conservative in the same way the old cooling logic was — a
 * value is only put back if it still equals what was written, so an operator who
 * has since chosen their own number keeps it.
 */
async function restoreSettingsWrittenWithoutAsking(workspaceState: vscode.Memento): Promise<void> {
  const stored = workspaceState.get<unknown>(FRUSTRATION_SETTINGS_STORAGE_KEY);
  if (!isFrustrationSettingsSnapshot(stored)) {
    return;
  }

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
  // Ahead of everything else, including model-suggested followups: a run stopped
  // at a safety gate is the only state here where the turn cannot continue at all
  // without the operator, and the approving prompt is one the surface knows
  // exactly and the operator would otherwise have to reconstruct by hand.
  if (outcome?.approvalRequiredPrompt) {
    return [
      { prompt: outcome.approvalRequiredPrompt, label: 'Approve and run' },
      { prompt: '/runs', label: 'Review previous runs first' },
    ];
  }

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

    case 'director':
      return [
        { prompt: '/followups', label: "What's due" },
        { prompt: '/runs', label: 'Autonomous runs' },
      ];

    case 'buzz':
      return [
        { prompt: '/buzz local', label: 'I want to run Buzz locally' },
        { prompt: '/buzz hosted', label: 'I have a hosted relay' },
        { prompt: '/buzz', label: 'Next step' },
        { prompt: '/buzz all', label: 'Show the whole checklist' },
      ];

    case 'followups':
      return [
        { prompt: '/director', label: 'Open Project Director' },
      ];

    case 'research':
      return [
        { prompt: '/research due', label: 'What is due' },
        { prompt: '/research all', label: 'Every scan' },
      ];

    case 'ideate':
      return [
        { prompt: '/ideate', label: 'Refresh board status' },
        { prompt: '/research', label: 'Review outside research' },
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

  // The assistant said it was waiting on the operator. A bare continuation
  // supplies nothing, so honouring the word would start the run on precisely the
  // information the model had just said it lacked. A continuation carrying
  // detail ("yes, use 0.310.5") answers the precondition and is allowed.
  if (!followupDetail && assistantDeferredPendingInput(transcript)) {
    return undefined;
  }

  // Deliberately NOT gated on the last turn having made an offer.
  //
  // Requiring one was tried and reverted: it broke the ordinary case where the
  // assistant describes a plan without a closing offer and the operator says
  // "proceed", which is the operator instructing rather than agreeing. Six tests
  // pinned that as intended, and they are right.
  //
  // The defect the STOP lane found was never that a continuation is accepted —
  // it is that a turn which *had* made an offer said nothing about a run being
  // pending. That is fixed by widening the announcement
  // ({@link detectProjectRunProposal}) and by keeping the question and its pills
  // beside the decision card, not by narrowing what the operator may type. What
  // a resolved goal must always be is something the operator can recognise from
  // the conversation, which is what the checks above enforce.

  // A bare affirmation ("yes", "go ahead") accepts whatever the assistant just
  // offered, so the assistant's closing proposal is the real goal. Without this the
  // resolver fell back to the most recent *user* message — typically the question
  // that prompted the offer — and the autonomous run just re-ran that question.
  const proposedAction = normalizeProjectRunProposalAction(extractAssistantProposedAction(transcript));

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

function normalizeProjectRunProposalAction(action: string | undefined): string | undefined {
  if (!action) {
    return undefined;
  }
  const meta = (PROJECT_RUN_META_ACTION_PREFIX.test(action)
    ? action.replace(PROJECT_RUN_META_ACTION_PREFIX, '').trim()
    : action.trim())
    // "…a project run **next to:** validate the checks" — a connector the meta
    // prefix leaves behind, which would otherwise open the stated goal.
    .replace(/^(?:next\s+)?to:?\s+/i, '')
    .trim();
  // "Shall I go ahead and update the README?" leaves "go ahead and update the
  // README". The affirmation is a preamble to the action, not part of it.
  const normalized = meta.replace(GO_AHEAD_PREFIX_PATTERN, '').trim();
  if (!normalized
    || DEICTIC_PROJECT_RUN_ACTION.test(normalized)
    || BARE_AFFIRMATION_ACTION.test(normalized)) {
    return undefined;
  }
  return normalized;
}

/**
 * When the user affirms ("yes"), the goal is the action the assistant just proposed.
 * Inspect the most recent assistant turn's closing question and, if it is a first-person
 * offer ("Want me to …?"), return the proposed action with the offer lead-in and trailing
 * "?" stripped. Returns undefined when the last assistant turn made no actionable offer
 * (e.g. it ended with a statement or a non-offer question like "Is that correct?").
 */
/**
 * True when the most recent assistant turn made its offer conditional on
 * something the operator has not yet supplied.
 *
 * Scoped to the tail of the reply, where the offer lives, so a deferral
 * mentioned in passing halfway through a long answer does not veto a genuine
 * closing offer.
 */
function assistantDeferredPendingInput(transcript: SessionTranscriptEntry[]): boolean {
  const lastAssistant = [...transcript]
    .reverse()
    .find(entry => entry.role === 'assistant' && entry.content.trim().length > 0);
  if (!lastAssistant) {
    return false;
  }
  return ASSISTANT_DEFERRAL_PATTERN.test(lastAssistant.content.trim().slice(-400));
}

export function extractAssistantProposedAction(
  transcript: SessionTranscriptEntry[],
): string | undefined {
  const lastAssistant = [...transcript]
    .reverse()
    .find(entry => entry.role === 'assistant' && entry.content.trim().length > 0);
  if (!lastAssistant) {
    return undefined;
  }

  const content = lastAssistant.content.trim();
  const questionMatch = RESPONSE_TRAILING_QUESTION_PATTERN.exec(content);
  const question = questionMatch?.[1]?.trim();

  if (question && ASSISTANT_OFFER_LEAD_IN_PATTERN.test(question)) {
    const action = question
      .replace(ASSISTANT_OFFER_LEAD_IN_PATTERN, '')
      .replace(/\?+\s*$/, '')
      .trim();
    return action.length >= 3 ? action : undefined;
  }

  // No question mark, but the reply may still have offered something.
  //
  // This is where the decision card was being lost. `detectProjectRunProposal`
  // correctly returned true for "If The User wants, I can start a project run
  // next to: …", but `resolveProjectRunProposal` also needs a *goal*, and this
  // function keyed on the trailing `?` alone — so it returned undefined, goal
  // resolution fell through to the prior user prompts (an affirmation and an
  // informational question, both skipped by design), and the card silently
  // never rendered. Detection said a decision was pending and nothing on screen
  // said so: exactly the symptom the STOP lane exists for, arriving by a
  // different route from the one it already closed.
  const lines = content.split('\n').map(line => line.trim()).filter(Boolean);
  const offer = extractDeclarativeOffer(lines[lines.length - 1] ?? '');
  if (!offer) {
    return undefined;
  }

  const action = offer
    // "If you want, " / "If The User wants, " / "Let me know if you want me to "
    .replace(/^\s*(?:if\s+(?:you|the\s+user)(?:'d|\s+would)?\s*(?:want|like|prefer|wish)[^,]{0,40},\s*|let\s+me\s+know\s+if\s+(?:you'?d\s+like\s+me\s+to|you\s+want\s+me\s+to)\s*)/i, '')
    // "I can " / "I'll " / "happy to " — the undertaking, not the work.
    .replace(/^\s*(?:i\s+can|i\s+could|i'?ll|i\s+will|let\s+me|i'?d\s+be\s+(?:glad|happy)\s+to|i'?m\s+happy\s+to|happy\s+to)\s+/i, '')
    .replace(/\s+if\s+(?:you|the\s+user)(?:'d|\s+would)?\s*(?:want|like|prefer|wish)\s*[.!]?\s*$/i, '')
    .replace(/[.!]\s*$/, '')
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

/** A non-mutating project-run proposal resolved from the assistant reply and chat history. */
export interface ProjectRunProposal {
  goal: string;
}

/**
 * The sentence the offer is made in — the trailing question if there is one,
 * otherwise the last sentence of the reply.
 *
 * Exists so the deferral/negation veto can be scoped to it. The veto used to run
 * over the last 400 characters, which meant an ordinary "I don't need anything
 * else from you." two sentences above a genuine offer deleted the decision card,
 * leaving the offer on screen with no control behind it. Those words appear in
 * ordinary prose constantly; the *offer* is where a refusal actually lives.
 */
function extractOfferSentence(trimmed: string): string {
  const trailingQuestion = RESPONSE_TRAILING_QUESTION_PATTERN.exec(trimmed)?.[1]?.trim();
  if (trailingQuestion) {
    return trailingQuestion;
  }
  const sentences = trimmed.split(/(?<=[.!?])\s+/);
  return sentences[sentences.length - 1]?.trim() ?? trimmed;
}

/**
 * True when the assistant's reply ends by offering to do work the operator can
 * accept — the single test the decision card, the quick-reply pills and the
 * acceptance of "yes"/"continue" are all now derived from.
 *
 * **It used to require the literal words "project run".** Three detectors decided
 * independently whether a turn was waiting: this one drew the card,
 * `detectResponseQuickReplies` drew the pills, and `isAutonomousContinuationPrompt`
 * *accepted the answer* — unconditionally. The acceptor was strictly the widest,
 * so a reply closing "I can implement this across the four files. Shall I go
 * ahead?" got no card, no notice and no mention of a run, while "yes" started a
 * planned multi-subtask one. That gap is the whole "it stops and never tells me"
 * symptom, and closing it means widening the announcement rather than narrowing
 * what the operator may type.
 *
 * So an explicit run offer still matches, and now so does any first-person offer
 * to act. An offer to *talk* ("Shall I explain the routing?") does not: saying
 * yes to that is a conversation, not a run.
 */
export function detectProjectRunProposal(responseText: string): boolean {
  const trimmed = responseText.trim();
  if (!trimmed) {
    return false;
  }

  // The offer/readiness line lives at the tail of the reply; bound the scan so an
  // unrelated mid-reply mention of "project run" can't trip detection.
  const window = trimmed.slice(-400);
  const offerSentence = extractOfferSentence(trimmed);

  // Scoped to the offer, not the window: see extractOfferSentence.
  if (PROJECT_RUN_PROPOSAL_NEGATION_PATTERN.test(offerSentence)
    || ASSISTANT_DEFERRAL_PATTERN.test(offerSentence)) {
    return false;
  }

  const trailingQuestion = RESPONSE_TRAILING_QUESTION_PATTERN.exec(trimmed)?.[1]?.trim();

  if (PROJECT_RUN_PROPOSAL_INTENT_PATTERN.test(window)) {
    // If the reply closes with a question, it must be an *offer* ("Want me to …?"),
    // not an information-seeking one ("What stack are you using?"). An info question
    // means the model is still gathering requirements — don't auto-start.
    if (trailingQuestion) {
      return ASSISTANT_OFFER_LEAD_IN_PATTERN.test(trailingQuestion)
        || PROJECT_RUN_OFFER_PATTERN.test(trailingQuestion);
    }
    // No closing question: accept a first-person readiness statement that offers to run.
    return PROJECT_RUN_OFFER_PATTERN.test(window);
  }

  // No run vocabulary, but a first-person offer to act is still a pending
  // decision — because saying yes to it starts a run.
  if (!trailingQuestion || !ASSISTANT_OFFER_LEAD_IN_PATTERN.test(trailingQuestion)) {
    return false;
  }
  const action = trailingQuestion.replace(ASSISTANT_OFFER_LEAD_IN_PATTERN, '').replace(/\?+\s*$/, '').trim();
  return action.length >= 3 && !NON_EXECUTING_OFFER_ACTION.test(action);
}

/**
 * Resolve the executable goal behind a project-run proposal without starting it.
 * Chat surfaces use this to render Start / Save for later / Cancel controls.
 */
export function resolveProjectRunProposal(
  responseText: string,
  transcript: SessionTranscriptEntry[],
): ProjectRunProposal | undefined {
  if (!detectProjectRunProposal(responseText)) {
    return undefined;
  }
  const goal = resolveAutonomousContinuationGoal('proceed', transcript)?.trim();
  return goal ? { goal } : undefined;
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
/**
 * The narrow test: the reply offered a **project run** in so many words.
 *
 * {@link detectProjectRunProposal} was widened so that any first-person offer to
 * act announces itself as a pending decision — that is what stops a turn ending
 * in silence. Auto-flow keeps the narrow test, because the two questions are
 * different: *should the operator be told a decision is waiting* (yes, always)
 * is not *may this start on its own* (only when the reply said a run is what
 * starts). Without the split, widening the announcement would also mean an
 * ordinary "Want me to start?" escalating into an unattended multi-subtask run
 * under Autopilot, which is an escalation nobody asked for.
 */
function offersExplicitProjectRun(responseText: string): boolean {
  const trimmed = responseText.trim();
  return trimmed.length > 0
    && PROJECT_RUN_PROPOSAL_INTENT_PATTERN.test(trimmed.slice(-400))
    && detectProjectRunProposal(trimmed);
}

export function resolveProjectRunAutoFlow(
  responseText: string,
  transcript: SessionTranscriptEntry[],
  options: { enabled: boolean; autopilot: boolean },
): ProjectRunAutoFlow | undefined {
  // Outside Autopilot the safe handoff is an explicit in-chat decision card.
  // The legacy setting still controls whether Autopilot may flow straight
  // through; it no longer bypasses the operator when approvals are interactive.
  if (!options.enabled || !options.autopilot) {
    return undefined;
  }
  if (!offersExplicitProjectRun(responseText)) {
    return undefined;
  }
  const proposal = resolveProjectRunProposal(responseText, transcript);
  if (!proposal) {
    return undefined;
  }
  return { goal: proposal.goal, notice: buildProjectRunAutoFlowNotice(proposal.goal, options.autopilot) };
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
  if (isInformationalQuestion(trimmed)) {
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

/**
 * Whether a project run has anything to run against.
 *
 * The planner reads the goal string, memory and the skill catalogue — it never
 * looks at the workspace. So on an empty folder it invents subtasks from the
 * wording alone and the executor then searches, reads and edits files that do
 * not exist. Nothing on the path noticed: the snapshot taken immediately before
 * planning came back empty and nobody read its size.
 *
 * `no-folder` is a refusal because there is nowhere to write. `empty` is *not*,
 * because starting a project in an empty directory is a real thing people do —
 * it is ambiguous, which is exactly the case the approval gate exists for, and
 * the far commoner cause is the wrong folder being open.
 */
export type ProjectWorkspaceReadiness =
  | { kind: 'no-folder' }
  | { kind: 'empty' }
  | { kind: 'populated'; fileCount: number };

export function assessProjectWorkspace(
  workspaceFolderCount: number,
  fileCount: number,
): ProjectWorkspaceReadiness {
  if (workspaceFolderCount < 1) {
    return { kind: 'no-folder' };
  }
  return fileCount < 1 ? { kind: 'empty' } : { kind: 'populated', fileCount };
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

async function pickImageAttachments(): Promise<ImageAttachmentResolution> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return { attachments: [], rejections: [] };
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
    return { attachments: [], rejections: [] };
  }

  return resolvePickedImageAttachmentsDetailed(selected);
}
