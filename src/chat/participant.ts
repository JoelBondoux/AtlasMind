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
import { deriveProjectRunTitle } from './sessionConversation.js';
import type {
  BudgetMode,
  ChangedWorkspaceFile,
  ModelCapability,
  ModelInfo,
  ProviderId,
  ProjectProgressUpdate,
  ProjectResult,
  ProjectRunSubTaskArtifact,
  ProjectRunSummary,
  RoutingConstraints,
  SpecialistDomain,
  SubTaskResult,
  TaskImageAttachment,
  TaskResult,
} from '../types.js';
import { Planner } from '../core/planner.js';
import { TaskProfiler } from '../core/taskProfiler.js';
import { describeCommonRoutingNeeds, shouldBiasTowardWorkspaceInvestigation } from '../core/orchestrator.js';
import { mergeImageAttachments, resolveInlineImageAttachments, resolvePickedImageAttachments } from './imageAttachments.js';

export { extractImagePathCandidates, mergeImageAttachments, resolveInlineImageAttachments } from './imageAttachments.js';

export const ATLASMIND_CHAT_PARTICIPANT_ID = 'atlasmind.orchestrator';

const PROJECT_APPROVAL_TOKEN = '--approve';
const PROJECT_PERSONALITY_PROFILE_STORAGE_KEY = 'atlasmind.personalityProfile';
const DEFAULT_SSOT_PATH = 'project_memory';
const OPERATOR_FEEDBACK_FILE = 'operations/operator-feedback.md';
const MIN_FRUSTRATION_SESSION_TURNS = 8;
const MIN_FRUSTRATION_SESSION_CHARS = 4000;
const DEFAULT_PROJECT_APPROVAL_FILE_THRESHOLD = 12;
const DEFAULT_ESTIMATED_FILES_PER_SUBTASK = 2;
const DEFAULT_CHANGED_FILE_REFERENCE_LIMIT = 5;
const DEFAULT_PROJECT_RUN_REPORT_FOLDER = 'project_memory/operations';
const WORKSPACE_SNAPSHOT_EXCLUDE = '**/{.git,node_modules,out,dist,coverage}/**';
const AUTONOMOUS_CONTINUATION_PATTERN = /^\s*(?:please\s+)?(?:proceed|continue|resume|carry on|go ahead)(?:\s+(?:autonomously|automatically|with autopilot|on autopilot))?(?:\s*(?:on|with|for)\s+(.+?))?[.!?]*\s*$/i;
const PROJECT_RUN_REQUEST_PATTERN = /^\s*(?:please\s+)?(?:(?:start|begin|run|launch|kick off|continue|switch to)\s+(?:an?\s+)?)?(?:atlasmind\s+)?(?:autonomous\s+)?project(?:\s+run|\s+execution|\s+task)?\b(?:\s+(?:to|for|on|about|that|which))?\s*(.+)?$/i;
const EXPLICIT_FIX_PROMPT_PATTERN = /\b(?:fix|patch|repair|resolve|implement|update|change|modify|correct|adjust|rewrite|refactor)\b/i;
const EXPLICIT_NO_FIX_PATTERN = /\b(?:do not fix|don't fix|without changing|no code changes|read only|explain only|question only)\b/i;
const CONCRETE_ISSUE_PROMPT_PATTERN = /\b(?:bug|issue|problem|broken|regression|failing|fails|error|incorrect|wrong|missing|stuck|overflow|scroll|layout|sidebar|dropdown|panel|webview|tooltip|session rail|hides|hidden|crash|hang|stops|stopped|too tall|too wide|not working|doesn't|does not|won't|will not|can't|cannot)\b/i;
const DEICTIC_EXECUTION_FOLLOWUP_PATTERN = /^\s*(?:please\s+)?(?:(?:go\s+ahead(?:\s+and)?|proceed|continue|resume|carry\s+on|do|handle|apply|merge|rebase|ship|run)\s+(?:that|this|it|them|those|these)|take\s+care\s+of\s+(?:that|this|it|them|those|these)|(?:can|could)\s+you\s+(?:do|handle|take\s+care\s+of|apply|merge|rebase|ship|run)\s+(?:that|this|it|them|those|these))(?:\s+for\s+me)?[\s.!?]*$/i;
const CONNECTED_PROVIDER_MODEL_REVIEW_PATTERN = /\b(?:current|currently|connected|configured|active|enabled|live)\b[^\n]{0,120}\b(?:providers?|models?)\b|\b(?:what|which)\b[^\n]{0,120}\b(?:providers?|models?)\b[^\n]{0,120}\b(?:atlas|atlasmind)\b|\b(?:llm|model)\b[^\n]{0,120}\bproviders?\b[^\n]{0,120}\b(?:connected|configured|enabled|active|using|talking\s+to)\b/i;
const CONTEXTUAL_FOLLOWUP_HINT_PATTERN = /\b(?:based\s+on\s+(?:this|the|our)\s+(?:chat|thread|conversation|discussion)|from\s+(?:this|the|our)\s+(?:chat|thread|conversation|discussion)|using\s+(?:this|the|our)\s+(?:chat|thread|conversation|discussion)|given\s+(?:this|the|our)\s+(?:chat|thread|conversation|discussion)|given\s+the\s+above|based\s+on\s+the\s+above|from\s+the\s+above|earlier\s+in\s+(?:the\s+)?(?:chat|thread|conversation)|previous\s+messages|prior\s+messages|conversation\s+so\s+far|thread\s+so\s+far)\b/i;
const AMBIGUOUS_CONTEXT_DEPENDENT_PROMPT_PATTERN = /^\s*(?:(?:why|how|what|which|where|when)\b|(?:and|also|instead)\b|(?:that|this|it|them|those|these)\b|(?:can|could|would|will)\s+you\s+(?:do|fix|change|update|explain|summari[sz]e|show|handle)\s+(?:that|this|it|them|those|these)\b)/i;
const STRONG_SUBJECT_SHIFT_HINT_PATTERN = /\b(?:create|generate|design|draw|make)\b[\s\S]{0,80}\b(?:image|logo|illustration|icon|graphic|banner|artwork|mockup|poster)\b|\b(?:image|logo|illustration|icon|graphic|banner|artwork|mockup|poster)\b[\s\S]{0,80}\b(?:create|generate|design|draw|make)\b/i;
const IMAGE_GENERATION_ACTION_PATTERN = /\b(?:create|generate|make|design|draft|render|produce|invent)\b/i;
const IMAGE_GENERATION_SUBJECT_PATTERN = /\b(?:image|images|logo|logos|icon|icons|illustration|illustrations|graphic|graphics|artwork|avatar|avatars|banner|banners|poster|posters|thumbnail|thumbnails|mascot|concept\s+art|video|videos|clip|clips|audio|voice|speech|music|soundtrack|animation|animated)\b/i;
const IMAGE_GENERATION_CODE_EXCLUSION_PATTERN = /\b(?:component|components|react|vue|angular|svelte|tsx|jsx|typescript|javascript|css|html|module|class|function|hook|file|files|code|widget)\b/i;
const IMAGE_ANALYSIS_ACTION_PATTERN = /\b(?:analy[sz]e|describe|inspect|recogni[sz]e|detect|extract|caption|classify|identify|compare|review|read|ocr)\b/i;
const IMAGE_ANALYSIS_SUBJECT_PATTERN = /\b(?:image|images|photo|photos|picture|pictures|screenshot|screenshots|logo|logos|icon|icons|illustration|illustrations|graphic|graphics|artwork|diagram|figure|figures|chart|charts)\b/i;
const VOICE_WORKFLOW_PATTERN = /\b(?:voice|speech|spoken|tts|stt|text\s*-?to\s*-?speech|speech\s*-?to\s*-?text|transcrib(?:e|ing|er|tion)|dictat(?:e|ion)|narrat(?:e|ion)|read\s+aloud|speak(?:ing)?|audio\s+transcript)\b/i;
const VIDEO_MEDIA_RECOGNITION_PATTERN = /\b(?:analy[sz]e|describe|inspect|review|summari[sz]e|extract|recogni[sz]e|detect|caption|identify)\b[\s\S]{0,80}\b(?:video|videos|clip|clips|movie|movies|footage|audio|media|multimedia)\b|\b(?:video|videos|clip|clips|movie|movies|footage|audio|media|multimedia)\b[\s\S]{0,80}\b(?:analy[sz]e|describe|inspect|review|summari[sz]e|extract|recogni[sz]e|detect|caption|identify)\b/i;
const RESEARCH_WORKFLOW_PATTERN = /\b(?:research|deep\s+research|web\s+research|internet\s+research|search\s+the\s+web|market\s+research|competitive\s+analysis|competitive\s+research|literature\s+review|survey\s+the\s+literature|find\s+sources|gather\s+sources|source-?backed|current\s+sources|papers?|citations?)\b/i;
const SIMULATION_WORKFLOW_PATTERN = /\b(?:simulate|simulation|simulator|scenario\s+model(?:ing)?|what-?if\s+analysis|monte\s+carlo|digital\s+twin|agent-?based\s+model|run\s+a\s+simulation|model\s+the\s+system)\b/i;
const ROBOTICS_WORKFLOW_PATTERN = /\b(?:robot|robotic|robotics|ros2?|kinematics|trajectory\s+planning|motion\s+planning|path\s+planning|actuator|actuators|servo|servos|manipulator|gripper|autonomous\s+vehicle|control\s+loop|pid\s+controller)\b/i;
const SPECIALIST_DOMAIN_VALUES: readonly SpecialistDomain[] = [
  'media-generation',
  'visual-analysis',
  'voice',
  'research',
  'robotics',
  'simulation',
];
const SPECIALIST_ROUTING_DEFINITIONS: Record<SpecialistDomain, SpecialistDomainDefinition> = {
  'media-generation': {
    id: 'media-generation',
    label: 'Specialist media workflow',
    summary: 'Opened Specialist Integrations because this request belongs on a dedicated media workflow rather than the generic routed chat path.',
    commandId: 'atlasmind.openSpecialistIntegrations',
    routingHint: 'This is a specialist media-generation request. Use dedicated generation tooling or provider-specific media workflows instead of generic chat-model responses.',
  },
  'visual-analysis': {
    id: 'visual-analysis',
    label: 'Image recognition and visual analysis',
    summary: 'Routed this request as a dedicated visual-analysis task.',
    commandId: 'atlasmind.openVisionPanel',
    budget: 'expensive',
    speed: 'considered',
    requiredCapabilities: ['vision'],
    routingHint: 'This is a specialist visual-analysis request. Prefer multimodal reasoning over generic text-only responses, and use attached image evidence directly.',
  },
  voice: {
    id: 'voice',
    label: 'Voice and speech workflow',
    summary: 'Opened the AtlasMind Voice Panel for a dedicated speech and audio workflow.',
    commandId: 'atlasmind.openVoicePanel',
    routingHint: 'This is a specialist voice workflow. Prefer speech and audio tooling over generic chat-model output.',
  },
  research: {
    id: 'research',
    label: 'Research and source-backed retrieval',
    summary: 'Routed this request as a specialist research task.',
    budget: 'expensive',
    speed: 'considered',
    requiredCapabilities: ['reasoning'],
    routingHint: 'This is a specialist research request. Prefer current external evidence over unsupported recollection. If search tooling is available, use EXA or web retrieval. If a deep-research provider is available, bias toward that route.',
  },
  robotics: {
    id: 'robotics',
    label: 'Robotics and control-system reasoning',
    summary: 'Routed this request as a specialist robotics task.',
    budget: 'expensive',
    speed: 'considered',
    requiredCapabilities: ['reasoning', 'code'],
    routingHint: 'This is a specialist robotics request. Prefer tool-backed analysis, code-aware reasoning, and concrete control or kinematics evidence over generic prose.',
  },
  simulation: {
    id: 'simulation',
    label: 'Simulation and what-if modeling',
    summary: 'Routed this request as a specialist simulation task.',
    budget: 'expensive',
    speed: 'considered',
    requiredCapabilities: ['reasoning', 'code'],
    routingHint: 'This is a specialist simulation request. Prefer executable or code-backed modeling, explicit assumptions, and tool-backed scenario analysis over hand-wavy prose.',
  },
};
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

export interface SpecialistRoutingPlan {
  kind: 'command' | 'task';
  id: string;
  domain?: SpecialistDomain;
  label: string;
  summary: string;
  commandId?: string;
  constraintsPatch?: Partial<RoutingConstraints>;
  contextPatch?: Record<string, unknown>;
}

interface SpecialistRoutingOverride {
  enabled?: boolean;
  preferredProvider?: ProviderId;
  budget?: BudgetMode;
  speed?: RoutingConstraints['speed'];
  requiredCapabilities?: ModelCapability[];
  commandId?: string;
}

type SpecialistRoutingOverrideMap = Partial<Record<SpecialistDomain, SpecialistRoutingOverride>>;

interface SpecialistModelAvailability {
  providerId: ProviderId;
  modelId: string;
  capabilities: ModelCapability[];
  specialistDomains: SpecialistDomain[];
}

interface SpecialistDomainDefinition {
  id: SpecialistDomain;
  label: string;
  summary: string;
  commandId?: string;
  budget?: BudgetMode;
  speed?: RoutingConstraints['speed'];
  requiredCapabilities?: ModelCapability[];
  routingHint: string;
}

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
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?(?:specialist\s+integrations|specialist\s+panel)\b/i,
    commandId: 'atlasmind.openSpecialistIntegrations',
    summary: 'Opened Specialist Integrations.',
  },
];

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
  if (request.command) {
    return handleChatRequest(request, chatContext, stream, token, atlas);
  }

  const connectedProviderInventory = await getConnectedProviderInventoryMarkdown(request.prompt, atlas);
  if (connectedProviderInventory) {
    writeMarkdownChunk(stream, connectedProviderInventory, 'connected provider inventory');
    if (!token.isCancellationRequested) {
      atlas.sessionConversation.recordTurn(request.prompt, connectedProviderInventory);
    }
    return {
      metadata: {
        command: 'freeform',
      },
    };
  }

  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const transcript = atlas.sessionConversation.getTranscript();
  const carryForwardConversationContext = shouldCarryForwardConversationContext(request.prompt, transcript, chatContext);
  const storedSessionContext = carryForwardConversationContext
    ? atlas.sessionConversation.buildContext({
      maxTurns: configuration.get<number>('chatSessionTurnLimit', 6),
      maxChars: configuration.get<number>('chatSessionContextChars', 2500),
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
    writeMarkdownChunk(stream, chunk, 'native chat response chunk');
  }, message => {
    if (!message.trim()) {
      return;
    }
    stream.progress(message);
  });

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
    atlas.sessionConversation.recordTurn(request.prompt, reconciled.transcriptText, undefined, assistantMeta);
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

    case 'project':
      projectOutcome = await runProjectCommand(request.prompt, stream, token, atlas);
      break;

    case 'runs':
      await handleRunsCommand(stream);
      break;

    case 'voice':
      await handleVoiceCommand(stream);
      break;

    case 'vision':
      await handleVisionCommand(request, stream, atlas);
      break;

    default: {
      const routedIntent = resolveAtlasChatIntent(
        request.prompt,
        atlas.sessionConversation.getTranscript(),
      );
      if (routedIntent?.kind === 'project') {
        stream.markdown('### Autonomous Run\n\nContinuing from your earlier request and switching into project execution mode.');
        projectOutcome = await runProjectCommand(
          toApprovedProjectPrompt(routedIntent.goal),
          stream,
          token,
          atlas,
        );
        break;
      }

      if (routedIntent?.kind === 'command') {
        await vscode.commands.executeCommand(routedIntent.commandId, ...(routedIntent.args ?? []));
        stream.markdown(routedIntent.summary);
        break;
      }

      await handleFreeformMessage(request, stream, atlas);
      break;
    }
  }

  return { metadata: { command: command ?? 'freeform', outcome: projectOutcome } };
}

export async function runProjectCommand(
  prompt: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  atlas: AtlasMindContext,
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
      `Estimated cost: **$${costEstimate.lowUsd.toFixed(4)} – $${costEstimate.highUsd.toFixed(4)}**\n\n`,
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
        const icon = r.status === 'completed' ? '\u2705' : '\u274c';
        const body = r.status === 'completed'
          ? r.output.slice(0, 400) + (r.output.length > 400 ? '\u2026' : '')
          : `*Error: ${r.error ?? 'unknown'}*`;
        stream.markdown(
          `${icon} **${r.title}** \u2014 ${update.completed}/${update.total} ` +
          `(${r.durationMs}ms, $${r.costUsd.toFixed(4)})\n\n${body}\n\n---\n`,
        );
        if (r.status === 'failed') {
          failedSubtaskTitles.push(r.title);
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

  try {
    const result = await atlas.orchestrator.processProject(
      goal,
      constraints,
      onProgress,
    );
    await impactReporting;
    const changedFiles = (await collectWorkspaceChangesSince(baselineSnapshot)).changedFiles;
    const report = buildProjectRunSummary(result, changedFiles, fileAttribution, runStartedAt);
    const reportUri = await writeProjectRunSummaryReport(report, projectUiConfig.runReportFolder);

    stream.markdown(`## Project Report\n\n${result.synthesis}`);
    stream.markdown(
      `\n\n---\n*${result.subTaskResults.length} subtask(s) \u00b7 ` +
      `${(result.totalDurationMs / 1000).toFixed(1)}s \u00b7 ` +
      `$${result.totalCostUsd.toFixed(4)}*`,
    );
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
      title: deriveProjectRunTitle(goal),
      goal,
      status: failedSubtaskTitles.length > 0 ? 'failed' : 'completed',
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
      executionOptions: {
        autonomousMode: true,
        requireBatchApproval: false,
        mirrorProgressToChat: true,
        injectOutputIntoFollowUp: true,
      },
      requireBatchApproval: false,
      paused: false,
      awaitingBatchApproval: false,
      reportPath,
      summary: report,
      logs: [
        {
          timestamp: new Date().toISOString(),
          level: failedSubtaskTitles.length > 0 ? 'warning' : 'info',
          message: failedSubtaskTitles.length > 0
            ? `Run completed with ${failedSubtaskTitles.length} failed subtask(s).`
            : 'Run completed successfully.',
        },
      ],
    });
    atlas.projectRunsRefresh.fire();
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
    stream.markdown(
      `\u274c **Project execution failed:** ${err instanceof Error ? err.message : String(err)}`,
    );
    return { hasFailures: true, hasChangedFiles: false, failedSubtaskTitles: ['Project execution failed'] };
  }
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
    `| Total cost | $${summary.totalCostUsd.toFixed(4)} |\n` +
    `| Requests | ${summary.totalRequests} |\n` +
    `| Input tokens | ${summary.totalInputTokens.toLocaleString()} |\n` +
    `| Output tokens | ${summary.totalOutputTokens.toLocaleString()} |`,
  );
}

async function handleFreeformMessage(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const prompt = request.prompt;
  const connectedProviderInventory = await getConnectedProviderInventoryMarkdown(prompt, atlas);
  if (connectedProviderInventory) {
    stream.markdown(connectedProviderInventory);
    atlas.sessionConversation.recordTurn(prompt, connectedProviderInventory);
    return;
  }
  const roadmapStatusMarkdown = await buildRoadmapStatusMarkdown(prompt);
  if (roadmapStatusMarkdown) {
    stream.markdown(roadmapStatusMarkdown);
    return;
  }
  const imageAttachments = await resolveInlineImageAttachments(prompt);
  const specialistRoute = resolveSpecialistRoutingPlan(prompt, {
    imageAttachmentCount: imageAttachments.length,
    availableModels: listAvailableSpecialistModels(atlas),
    overrides: getConfiguredSpecialistRoutingOverrides(),
  });

  if (specialistRoute?.kind === 'command' && specialistRoute.commandId) {
    await vscode.commands.executeCommand(specialistRoute.commandId);
    stream.markdown(specialistRoute.summary);
    return;
  }

  await runChatTask(prompt, stream, atlas, imageAttachments, specialistRoute);
}

export function isConnectedProviderInventoryPrompt(prompt: string): boolean {
  return CONNECTED_PROVIDER_MODEL_REVIEW_PATTERN.test(prompt.trim());
}

async function getConnectedProviderInventoryMarkdown(
  prompt: string,
  atlas: AtlasMindContext,
): Promise<string | undefined> {
  if (!isConnectedProviderInventoryPrompt(prompt)) {
    return undefined;
  }

  const providers = atlas.modelRouter.listProviders();
  const registeredProviderIds = new Set(atlas.providerRegistry.list().map(adapter => adapter.providerId));
  const rows = await Promise.all(providers.map(async provider => {
    const configured = await atlas.isProviderConfigured(provider.id);
    const enabledModels = provider.models.filter(model => model.enabled);
    const healthy = atlas.modelRouter.isProviderHealthy(provider.id);
    const adapterRegistered = registeredProviderIds.has(provider.id);
    const connected = configured && provider.enabled && healthy && enabledModels.length > 0;

    return {
      id: provider.id,
      displayName: provider.displayName,
      pricingModel: provider.pricingModel,
      configured,
      enabled: provider.enabled,
      healthy,
      adapterRegistered,
      connected,
      enabledModels,
      totalModels: provider.models.length,
    };
  }));

  const connectedRows = rows.filter(row => row.connected);
  const otherConfiguredRows = rows.filter(row => !row.connected && row.configured);
  const sections: string[] = [
    '### Connected Providers And Models',
    '',
    `This is the live runtime inventory, not a general architecture review. Atlas currently has **${connectedRows.length}** connected provider${connectedRows.length === 1 ? '' : 's'} with usable routed models.`,
  ];

  if (connectedRows.length > 0) {
    sections.push('', '| Provider | Pricing | Health | Enabled models |', '|---|---|---|---|');
    for (const row of connectedRows) {
      sections.push(`| ${row.displayName} | ${row.pricingModel} | ${row.healthy ? 'healthy' : 'unhealthy'} | ${row.enabledModels.length}/${row.totalModels} |`);
    }

    for (const row of connectedRows) {
      sections.push('', `**${row.displayName}** (${row.id})`, '');
      for (const model of row.enabledModels) {
        sections.push(`- \`${model.id}\` — capabilities: ${model.capabilities.join(', ')}`);
      }
    }
  } else {
    sections.push('', 'No providers are both configured and currently usable for routed model execution.');
  }

  if (otherConfiguredRows.length > 0) {
    sections.push('', '### Configured But Not Currently Usable', '');
    for (const row of otherConfiguredRows) {
      const blockers = [
        row.enabled ? undefined : 'provider disabled',
        row.adapterRegistered ? undefined : 'adapter not registered',
        row.healthy ? undefined : 'health check failing',
        row.enabledModels.length > 0 ? undefined : 'no enabled routed models',
      ].filter((value): value is string => Boolean(value));
      sections.push(`- **${row.displayName}** — ${blockers.join(', ') || 'not currently usable'}`);
    }
  }

  return sections.join('\n');
}

async function handleVisionCommand(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
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

  await runChatTask(prompt, stream, atlas, selectedAttachments);
}

async function runChatTask(
  prompt: string,
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
  explicitAttachments: TaskImageAttachment[] = [],
  specialistRoute?: SpecialistRoutingPlan,
): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const sessionContext = atlas.sessionConversation.buildContext({
    maxTurns: configuration.get<number>('chatSessionTurnLimit', 6),
    maxChars: configuration.get<number>('chatSessionContextChars', 2500),
  });
  const workstationContext = buildWorkstationContext();
  const inlineAttachments = explicitAttachments.length > 0 ? [] : await resolveInlineImageAttachments(prompt);
  const imageAttachments = mergeImageAttachments(explicitAttachments, inlineAttachments);
  const operatorAdaptation = await applyOperatorFrustrationAdaptation(prompt, atlas, { sessionContext });
  let streamedText = '';
  const result = await atlas.orchestrator.processTask({
    id: `task-${Date.now()}`,
    userMessage: prompt,
    context: {
      ...(sessionContext ? { sessionContext } : {}),
      ...(workstationContext ? { workstationContext } : {}),
      ...(imageAttachments.length > 0 ? { imageAttachments } : {}),
      ...(specialistRoute?.contextPatch ?? {}),
      ...(operatorAdaptation?.contextPatch ?? {}),
    },
    constraints: {
      budget: specialistRoute?.constraintsPatch?.budget ?? toBudgetMode(configuration.get<string>('budgetMode')),
      speed: specialistRoute?.constraintsPatch?.speed ?? toSpeedMode(configuration.get<string>('speedMode')),
      ...(specialistRoute?.constraintsPatch?.preferredProvider
        ? { preferredProvider: specialistRoute.constraintsPatch.preferredProvider }
        : {}),
      ...(specialistRoute?.constraintsPatch?.maxCostUsd !== undefined
        ? { maxCostUsd: specialistRoute.constraintsPatch.maxCostUsd }
        : {}),
      ...(specialistRoute?.constraintsPatch?.parallelSlots !== undefined
        ? { parallelSlots: specialistRoute.constraintsPatch.parallelSlots }
        : {}),
      ...(specialistRoute?.constraintsPatch?.requiredCapabilities?.length
        ? { requiredCapabilities: specialistRoute.constraintsPatch.requiredCapabilities }
        : {}),
      ...(imageAttachments.length > 0 ? { requiredCapabilities: ['vision' as const] } : {}),
    },
    timestamp: new Date().toISOString(),
  }, chunk => {
    if (!chunk) {
      return;
    }
    streamedText += chunk;
    writeMarkdownChunk(stream, chunk, 'chat task response chunk');
  });

  const reconciled = reconcileAssistantResponse(streamedText, result.response);
  if (reconciled.additionalText) {
    writeMarkdownChunk(stream, reconciled.additionalText, 'chat task completion');
  }
  const assistantMeta = buildAssistantResponseMetadata(prompt, result, {
    hasSessionContext: Boolean(sessionContext),
    imageAttachments,
    routingContext: {
      ...(sessionContext ? { sessionContext } : {}),
      ...(specialistRoute?.contextPatch ?? {}),
      ...(operatorAdaptation?.contextPatch ?? {}),
    },
    policies: [
      ...atlas.getWorkspacePolicySnapshots(),
      ...(operatorAdaptation?.policySnapshot ? [operatorAdaptation.policySnapshot] : []),
    ],
  });
  stream.markdown(renderAssistantResponseFooter(assistantMeta));
  atlas.sessionConversation.recordTurn(prompt, reconciled.transcriptText, undefined, assistantMeta);

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
      additionalText: finalResponse,
      transcriptText: finalResponse,
    };
  }

  if (!finalResponse) {
    return {
      additionalText: '',
      transcriptText: streamedText,
    };
  }

  if (streamedText === finalResponse || streamedText.trim() === finalResponse.trim()) {
    return {
      additionalText: '',
      transcriptText: finalResponse,
    };
  }

  if (finalResponse.startsWith(streamedText)) {
    return {
      additionalText: finalResponse.slice(streamedText.length),
      transcriptText: finalResponse,
    };
  }

  const joined = joinAssistantResponseSegments(streamedText, finalResponse);
  return {
    additionalText: joined.slice(streamedText.length),
    transcriptText: joined,
  };
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

export function buildAssistantResponseMetadata(
  prompt: string,
  result: Pick<TaskResult, 'agentId' | 'modelUsed' | 'costUsd' | 'inputTokens' | 'outputTokens' | 'artifacts'>,
  options?: { hasSessionContext?: boolean; imageAttachments?: TaskImageAttachment[]; routingContext?: Record<string, unknown>; policies?: SessionPolicySnapshot[] },
): SessionTranscriptMetadata {
  const taskProfile = new TaskProfiler().profileTask({
    userMessage: prompt,
    context: {
      ...(options?.hasSessionContext ? { sessionContext: true } : {}),
      ...(options?.imageAttachments?.length ? { imageAttachments: options.imageAttachments } : {}),
    },
    phase: 'execution',
    requiresTools: Boolean(result.artifacts?.toolCallCount),
  });

  const bullets = [
    `Reasoning intensity: ${taskProfile.reasoning}.`,
    `Task modality: ${taskProfile.modality}.`,
    `Selected agent: ${result.agentId}.`,
  ];

  const routingHints = describeCommonRoutingNeeds(prompt);
  if (routingHints.length > 0) {
    bullets.push(`Routing hints: ${routingHints.join(', ')}.`);
  }

  if (typeof options?.routingContext?.['specialistRouteLabel'] === 'string') {
    bullets.push(`Specialist routing: ${options.routingContext['specialistRouteLabel']}.`);
  }

  if (shouldBiasTowardWorkspaceInvestigation(prompt, options?.routingContext ?? {})) {
    bullets.push('Workspace investigation bias applied before execution.');
  }

  if (typeof options?.routingContext?.['userFrustrationSignal'] === 'string') {
    bullets.push('Operator frustration signal detected; Atlas strengthened direct-action and correction guidance for this turn.');
  }

  if (taskProfile.requiredCapabilities.length > 0) {
    bullets.push(`Required capabilities: ${taskProfile.requiredCapabilities.join(', ')}.`);
  }

  if (options?.hasSessionContext) {
    bullets.push('Included recent session context when routing the response.');
  }

  if (result.artifacts?.toolCallCount) {
    bullets.push(`Tool loop used ${result.artifacts.toolCallCount} call(s).`);
  } else {
    bullets.push('Answered directly without invoking tools.');
  }

  bullets.push(
    `Usage: ${result.inputTokens.toLocaleString()} input token(s), ` +
    `${result.outputTokens.toLocaleString()} output token(s), ` +
    `$${result.costUsd.toFixed(4)}.`,
  );

  const includeTddCue = options?.routingContext?.['ideation'] !== true;
  const tddCue = includeTddCue
    ? buildThoughtSummaryTddCue(result.artifacts?.tddStatus, result.artifacts?.tddSummary)
    : undefined;
  if (tddCue) {
    bullets.push(`Red-to-green: ${tddCue.statusLabel}.`);
    if (result.artifacts?.tddSummary) {
      bullets.push(`TDD evidence: ${result.artifacts.tddSummary}.`);
    }
  }

  if (result.artifacts?.checkpointedTools.length) {
    bullets.push(`Checkpointed tools: ${result.artifacts.checkpointedTools.join(', ')}.`);
  }

  if (result.artifacts?.verificationSummary) {
    bullets.push(`Verification: ${result.artifacts.verificationSummary}.`);
  }

  const suggestedFollowups = buildSuggestedExecutionFollowups(prompt, options?.routingContext ?? {});
  const timelineNotes = buildTimelineNotes(options?.routingContext ?? {});

  return {
    modelUsed: result.modelUsed,
    ...(options?.policies?.length ? { policies: options.policies.map(policy => ({ ...policy })) } : {}),
    ...(timelineNotes.length ? { timelineNotes } : {}),
    ...(suggestedFollowups
      ? {
        followupQuestion: FOLLOWUP_FIX_QUESTION,
        suggestedFollowups,
      }
      : {}),
    thoughtSummary: {
      label: 'Thinking summary',
      summary: `${capitalize(taskProfile.reasoning)}-reasoning ${taskProfile.modality} task routed to ${result.modelUsed}.`,
      bullets,
      status: tddCue?.status,
      statusLabel: tddCue?.statusLabel,
    },
  };
}

export function buildProjectResponseMetadata(goal: string): SessionTranscriptMetadata {
  return {
    modelUsed: 'multiple routed models',
    thoughtSummary: {
      label: 'Execution summary',
      summary: 'Autonomous project mode can route planning, sub-agents, and synthesis through different models.',
      bullets: [
        `Goal: ${truncateForSummary(goal, 120)}.`,
        'Planner, execution, and synthesis may each pick a different model based on cost, speed, and capability constraints.',
        'Open the Project Run Center to inspect per-subtask outputs and execution history.',
      ],
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
  await applyFrustrationSettingsTuning();
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

async function applyFrustrationSettingsTuning(): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const currentTurnLimit = configuration.get<number>('chatSessionTurnLimit', 6) ?? 6;
  const currentContextChars = configuration.get<number>('chatSessionContextChars', 2500) ?? 2500;

  if (currentTurnLimit < MIN_FRUSTRATION_SESSION_TURNS) {
    await configuration.update('chatSessionTurnLimit', MIN_FRUSTRATION_SESSION_TURNS, vscode.ConfigurationTarget.Workspace);
  }

  if (currentContextChars < MIN_FRUSTRATION_SESSION_CHARS) {
    await configuration.update('chatSessionContextChars', MIN_FRUSTRATION_SESSION_CHARS, vscode.ConfigurationTarget.Workspace);
  }
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

function capitalize(value: string): string {
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
  return AUTONOMOUS_CONTINUATION_PATTERN.test(prompt.trim());
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

  if (isImageGenerationWorkflowRequest(prompt)) {
    return {
      kind: 'command',
      commandId: 'atlasmind.openSpecialistIntegrations',
      summary: 'Opened Specialist Integrations for image-generation setup. AtlasMind keeps generated-image workflows separate from routed chat models.',
    };
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

export function resolveSpecialistRoutingPlan(
  prompt: string,
  options?: {
    imageAttachmentCount?: number;
    availableModels?: SpecialistModelAvailability[];
    overrides?: SpecialistRoutingOverrideMap;
  },
): SpecialistRoutingPlan | undefined {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return undefined;
  }

  const imageAttachmentCount = options?.imageAttachmentCount ?? 0;
  const availableModels = options?.availableModels ?? [];
  const overrides = options?.overrides ?? getConfiguredSpecialistRoutingOverrides();

  const buildTaskPlan = (domain: SpecialistDomain): SpecialistRoutingPlan | undefined => {
    const definition = SPECIALIST_ROUTING_DEFINITIONS[domain];
    const override = overrides[domain];
    if (override?.enabled === false) {
      return undefined;
    }

    const preferredProvider = choosePreferredProviderForDomain(
      domain,
      availableModels,
      definition.requiredCapabilities,
      override?.preferredProvider,
    );
    const requiredCapabilities = sanitizeModelCapabilities(override?.requiredCapabilities) ?? definition.requiredCapabilities;

    return {
      kind: 'task',
      id: domain,
      domain,
      label: definition.label,
      summary: definition.summary,
      constraintsPatch: {
        budget: override?.budget ?? definition.budget,
        speed: override?.speed ?? definition.speed,
        ...(preferredProvider ? { preferredProvider } : {}),
        ...(requiredCapabilities?.length ? { requiredCapabilities } : {}),
      },
      contextPatch: {
        specialistRouteLabel: definition.label.toLowerCase(),
        specialistRoutingHint: definition.routingHint,
        ...(preferredProvider ? { specialistPreferredProvider: preferredProvider } : {}),
      },
    };
  };

  const buildCommandPlan = (domain: SpecialistDomain): SpecialistRoutingPlan | undefined => {
    const definition = SPECIALIST_ROUTING_DEFINITIONS[domain];
    const override = overrides[domain];
    if (override?.enabled === false) {
      return undefined;
    }
    const commandId = override?.commandId ?? definition.commandId;
    if (!commandId) {
      return undefined;
    }
    return {
      kind: 'command',
      id: domain,
      domain,
      label: definition.label,
      commandId,
      summary: definition.summary,
    };
  };

  if (isVoiceWorkflowRequest(trimmed)) {
    const commandPlan = buildCommandPlan('voice');
    return commandPlan
      ? {
        ...commandPlan,
        id: 'voice-workflow',
      }
      : undefined;
  }

  if (isImageAnalysisWorkflowRequest(trimmed)) {
    if (imageAttachmentCount > 0) {
      return buildTaskPlan('visual-analysis');
    }

    const commandPlan = buildCommandPlan('visual-analysis');
    return commandPlan
      ? {
        ...commandPlan,
        id: 'vision-workflow',
        label: 'Vision workflow',
        summary: 'Opened the AtlasMind Vision Panel so you can attach media and run a dedicated recognition workflow.',
      }
      : undefined;
  }

  if (isMediaGenerationWorkflowRequest(trimmed) || isVideoMediaRecognitionRequest(trimmed)) {
    return buildCommandPlan('media-generation');
  }

  if (isResearchWorkflowRequest(trimmed)) {
    return buildTaskPlan('research');
  }

  if (isRoboticsWorkflowRequest(trimmed)) {
    return buildTaskPlan('robotics');
  }

  if (isSimulationWorkflowRequest(trimmed)) {
    return buildTaskPlan('simulation');
  }

  return undefined;
}

function isImageGenerationWorkflowRequest(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return false;
  }

  return IMAGE_GENERATION_ACTION_PATTERN.test(trimmed)
    && IMAGE_GENERATION_SUBJECT_PATTERN.test(trimmed)
    && !IMAGE_GENERATION_CODE_EXCLUSION_PATTERN.test(trimmed);
}

function isImageAnalysisWorkflowRequest(prompt: string): boolean {
  return IMAGE_ANALYSIS_ACTION_PATTERN.test(prompt) && IMAGE_ANALYSIS_SUBJECT_PATTERN.test(prompt);
}

function isVoiceWorkflowRequest(prompt: string): boolean {
  return VOICE_WORKFLOW_PATTERN.test(prompt);
}

function isMediaGenerationWorkflowRequest(prompt: string): boolean {
  return isImageGenerationWorkflowRequest(prompt);
}

function isVideoMediaRecognitionRequest(prompt: string): boolean {
  return VIDEO_MEDIA_RECOGNITION_PATTERN.test(prompt);
}

function isResearchWorkflowRequest(prompt: string): boolean {
  return RESEARCH_WORKFLOW_PATTERN.test(prompt);
}

function isSimulationWorkflowRequest(prompt: string): boolean {
  return SIMULATION_WORKFLOW_PATTERN.test(prompt);
}

function isRoboticsWorkflowRequest(prompt: string): boolean {
  return ROBOTICS_WORKFLOW_PATTERN.test(prompt);
}

function listAvailableSpecialistModels(atlas: AtlasMindContext): SpecialistModelAvailability[] {
  return atlas.modelRouter.listProviders()
    .filter(provider => provider.enabled && atlas.modelRouter.isProviderHealthy(provider.id))
    .flatMap(provider => provider.models
      .filter(model => model.enabled)
      .map(model => ({
        providerId: provider.id,
        modelId: model.id,
        capabilities: [...model.capabilities],
        specialistDomains: deriveSpecialistDomainsFromModel(model),
      })));
}

function deriveSpecialistDomainsFromModel(model: Pick<ModelInfo, 'id' | 'capabilities' | 'specialistDomains'>): SpecialistDomain[] {
  const domains = new Set<SpecialistDomain>(model.specialistDomains ?? []);
  const normalized = model.id.toLowerCase();

  if (model.capabilities.includes('vision')) {
    domains.add('visual-analysis');
  }
  if (/(?:sonar|research|retriev|citation|search)/i.test(normalized)) {
    domains.add('research');
  }
  if (/(?:tts|stt|speech|audio|voice|transcrib)/i.test(normalized)) {
    domains.add('voice');
  }
  if (/(?:image-?gen|text-?to-?image|stable-?diffusion|sdxl|dall-?e|flux|sora|veo|runway|video-?gen|media-?gen)/i.test(normalized)) {
    domains.add('media-generation');
  }
  if (/(?:robot|robotic|ros\d?|kinematic|trajectory|motion-?planning|control-?loop|pid)/i.test(normalized)) {
    domains.add('robotics');
  }
  if (/(?:simulat|monte-?carlo|scenario-?model|what-?if)/i.test(normalized)) {
    domains.add('simulation');
  }

  return [...domains];
}

function choosePreferredProviderForDomain(
  domain: SpecialistDomain,
  availableModels: SpecialistModelAvailability[],
  requiredCapabilities?: readonly ModelCapability[],
  overrideProvider?: ProviderId,
): ProviderId | undefined {
  const eligibleModels = availableModels.filter(model =>
    (requiredCapabilities ?? []).every(capability => model.capabilities.includes(capability)),
  );

  if (overrideProvider && eligibleModels.some(model => model.providerId === overrideProvider)) {
    return overrideProvider;
  }

  const scores = new Map<ProviderId, number>();
  for (const model of eligibleModels) {
    const domainScore = model.specialistDomains.includes(domain) ? 10 : 0;
    const capabilityScore = (requiredCapabilities ?? []).filter(capability => model.capabilities.includes(capability)).length * 3;
    const nextScore = domainScore + capabilityScore;
    const existingScore = scores.get(model.providerId) ?? 0;
    if (nextScore > existingScore) {
      scores.set(model.providerId, nextScore);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

function getConfiguredSpecialistRoutingOverrides(): SpecialistRoutingOverrideMap {
  const raw = vscode.workspace.getConfiguration('atlasmind').get<unknown>('specialistRoutingOverrides', {});
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }

  const overrides: SpecialistRoutingOverrideMap = {};
  for (const domain of SPECIALIST_DOMAIN_VALUES) {
    const candidate = (raw as Record<string, unknown>)[domain];
    if (typeof candidate !== 'object' || candidate === null) {
      continue;
    }

    const record = candidate as Record<string, unknown>;
    const override: SpecialistRoutingOverride = {};
    if (typeof record['enabled'] === 'boolean') {
      override.enabled = record['enabled'];
    }
    if (isProviderId(record['preferredProvider'])) {
      override.preferredProvider = record['preferredProvider'];
    }
    if (isBudgetMode(record['budget'])) {
      override.budget = record['budget'];
    }
    if (isSpeedMode(record['speed'])) {
      override.speed = record['speed'];
    }
    const requiredCapabilities = sanitizeModelCapabilities(record['requiredCapabilities']);
    if (requiredCapabilities) {
      override.requiredCapabilities = requiredCapabilities;
    }
    if (typeof record['commandId'] === 'string' && record['commandId'].trim().length > 0) {
      override.commandId = record['commandId'].trim();
    }

    overrides[domain] = override;
  }

  return overrides;
}

function sanitizeModelCapabilities(value: unknown): ModelCapability[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const capabilities = value.filter(isModelCapability);
  return capabilities.length > 0 ? [...new Set(capabilities)] : undefined;
}

function isModelCapability(value: unknown): value is ModelCapability {
  return value === 'chat'
    || value === 'code'
    || value === 'vision'
    || value === 'function_calling'
    || value === 'reasoning';
}

function isProviderId(value: unknown): value is ProviderId {
  return value === 'claude-cli'
    || value === 'anthropic'
    || value === 'openai'
    || value === 'google'
    || value === 'mistral'
    || value === 'deepseek'
    || value === 'zai'
    || value === 'azure'
    || value === 'bedrock'
    || value === 'xai'
    || value === 'cohere'
    || value === 'perplexity'
    || value === 'huggingface'
    || value === 'nvidia'
    || value === 'local'
    || value === 'copilot';
}

function isBudgetMode(value: unknown): value is BudgetMode {
  return value === 'cheap' || value === 'balanced' || value === 'expensive' || value === 'auto';
}

function isSpeedMode(value: unknown): value is RoutingConstraints['speed'] {
  return value === 'fast' || value === 'balanced' || value === 'considered' || value === 'auto';
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
  const priorPrompt = [...transcript]
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

function normalizeAutonomousSourcePrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed || isAutonomousContinuationPrompt(trimmed)) {
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
