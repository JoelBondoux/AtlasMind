import * as vscode from 'vscode';
import type { AtlasMindContext } from '../extension.js';
import { escapeHtml, getWebviewHtmlShell } from './webviewUtils.js';

const PROJECT_PERSONALITY_PROFILE_STORAGE_KEY = 'atlasmind.personalityProfile';
const GLOBAL_PERSONALITY_PROFILE_STORAGE_KEY = 'atlasmind.globalPersonalityProfile';
const DEFAULT_SSOT_PATH = 'project_memory';
const PROFILE_JSON_FILE = 'atlas-personality-profile.json';
const PROFILE_MARKDOWN_FILE = 'atlas-personality-profile.md';
const PROJECT_SOUL_FILE = 'project_soul.md';
const PROJECT_SOUL_MARKER_START = '<!-- atlasmind:personality-profile:start -->';
const PROJECT_SOUL_MARKER_END = '<!-- atlasmind:personality-profile:end -->';

type PersonalitySectionId =
  | 'identity'
  | 'tone'
  | 'cognition'
  | 'boundaries'
  | 'operations'
  | 'values'
  | 'flavor'
  | 'memory'
  | 'conflict'
  | 'redlines';

type ProfileAnswerId =
  | 'primaryPurpose'
  | 'optimiseFor'
  | 'notResponsibleFor'
  | 'tradeoffPriority'
  | 'northStar'
  | 'formality'
  | 'humourStyle'
  | 'challengeStyle'
  | 'defaultVerbosity'
  | 'formattingStyle'
  | 'styleMirroring'
  | 'reasoningVisibility'
  | 'alternativeBehavior'
  | 'sessionContextBehavior'
  | 'riskTolerance'
  | 'creativityMode'
  | 'avoidTopics'
  | 'confirmationTriggers'
  | 'autonomyLevel'
  | 'safetyOverrideBehavior'
  | 'emotionalFraming'
  | 'guidanceDepth'
  | 'defaultActionBias'
  | 'structureMaintenance'
  | 'goalHorizon'
  | 'costAwareness'
  | 'priorityValues'
  | 'openSourcePreference'
  | 'proprietaryFallback'
  | 'autonomyVsInitiative'
  | 'humourLevel'
  | 'metaphoricalLens'
  | 'signaturePhrase'
  | 'culturalReferences'
  | 'rememberLongTerm'
  | 'neverStore'
  | 'autoSessionSummaries'
  | 'goalModelPersistence'
  | 'instructionConflictPolicy'
  | 'ambiguityHandling'
  | 'assumptionPolicy'
  | 'personalityVsRequest'
  | 'neverExhibit'
  | 'forbiddenPhrasing'
  | 'outOfScopeSuggestions'
  | 'constraintViolationResponse';

type ConfigValueMap = {
  budgetMode: 'cheap' | 'balanced' | 'expensive' | 'auto';
  speedMode: 'fast' | 'balanced' | 'considered' | 'auto';
  toolApprovalMode: 'always-ask' | 'ask-on-write' | 'ask-on-external' | 'allow-safe-readonly';
  dailyCostLimitUsd: number;
  chatSessionTurnLimit: number;
  chatSessionContextChars: number;
  showImportProjectAction: boolean;
};

type _ProfileConfigKey = keyof ConfigValueMap;

interface PersonalityProfileRecord {
  version: 1;
  updatedAt: string;
  answers: Partial<Record<ProfileAnswerId, string>>;
}

interface ProfileConfigSnapshot extends ConfigValueMap {}

type ConfigSnapshotScope = 'effective' | 'global' | 'default';

type SaveScope = 'global' | 'project';

type EffectiveSettingsSource = 'default' | 'global' | 'project';

interface PersonalityProfileState {
  profile: PersonalityProfileRecord;
  config: ProfileConfigSnapshot;
  globalProfile: PersonalityProfileRecord;
  globalConfig: ProfileConfigSnapshot;
  defaultProfile: PersonalityProfileRecord;
  defaultConfig: ProfileConfigSnapshot;
  hasGlobalProfile: boolean;
  hasProjectProfile: boolean;
  effectiveProfileSource: EffectiveSettingsSource;
  effectiveConfigSource: EffectiveSettingsSource;
  ssot: {
    available: boolean;
    relativePath?: string;
    profileJsonPath?: string;
    profileMarkdownPath?: string;
    projectSoulPath?: string;
  };
}

type PersonalityProfileMessage =
  | { type: 'ready' }
  | { type: 'saveProfile'; payload: { scope: SaveScope; answers: Partial<Record<ProfileAnswerId, string>>; config: ConfigValueMap } }
  | { type: 'revertProjectToGlobal' }
  | { type: 'openCommand'; payload: 'atlasmind.openSettings' | 'atlasmind.openSettingsChat' | 'atlasmind.openSettingsModels' | 'atlasmind.openSettingsSafety' | 'atlasmind.openSettingsProject' | 'atlasmind.openCostDashboard' | 'atlasmind.openProjectDashboard' | 'atlasmind.openGettingStarted' }
  | { type: 'openProfileFile'; payload: 'profileMarkdown' | 'projectSoul' };

interface PersonalityQuestionDefinition {
  id: ProfileAnswerId;
  label: string;
  help: string;
  placeholder?: string;
  kind?: 'textarea' | 'select';
  options?: Array<{ value: string; label: string }>;
  quickFill?: string[];
}

interface PersonalitySectionDefinition {
  id: PersonalitySectionId;
  label: string;
  kicker: string;
  description: string;
  summary: string;
  questions: PersonalityQuestionDefinition[];
}

const PROFILE_SECTIONS: PersonalitySectionDefinition[] = [
  {
    id: 'identity',
    label: 'Core Identity',
    kicker: 'Mission',
    description: 'Define Atlas\'s role, scope, and the principle it should default to when a prompt is underspecified.',
    summary: 'Purpose, outcomes, and north-star behavior.',
    questions: [
      {
        id: 'primaryPurpose',
        label: 'Primary purpose in this workspace',
        help: 'What Atlas exists to do here.',
        placeholder: 'Example: Act as a safety-first senior engineering copilot for AtlasMind release and architecture work.',
      },
      {
        id: 'optimiseFor',
        label: 'Outcomes to optimise for',
        help: 'Name the outcomes Atlas should pursue above all else.',
        placeholder: 'Example: correctness, maintainability, trustworthy autonomy, release hygiene.',
      },
      {
        id: 'notResponsibleFor',
        label: 'What Atlas is not responsible for',
        help: 'Set scope boundaries explicitly.',
        placeholder: 'Example: inventing product direction without evidence, bypassing review, storing secrets in memory.',
      },
      {
        id: 'tradeoffPriority',
        label: 'Trade-off priority',
        help: 'How should Atlas resolve speed vs quality trade-offs?',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / inherit current Atlas behavior' },
          { value: 'safety', label: 'Safety first' },
          { value: 'accuracy', label: 'Accuracy first' },
          { value: 'speed', label: 'Speed first' },
          { value: 'creativity', label: 'Creativity first' },
          { value: 'balanced', label: 'Balanced' },
        ],
      },
      {
        id: 'northStar',
        label: 'North-star principle when uncertain',
        help: 'A short rule Atlas can fall back to.',
        placeholder: 'Example: Choose the safest path that still moves the work forward and leaves an audit trail.',
      },
    ],
  },
  {
    id: 'tone',
    label: 'Tone & Voice',
    kicker: 'Communication',
    description: 'Shape how Atlas sounds, how direct it should be, and whether it mirrors the operator or keeps a stable voice.',
    summary: 'Formality, humour, verbosity, formatting, mirroring.',
    questions: [
      {
        id: 'formality',
        label: 'Formality level',
        help: 'Choose the default conversational register.',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / current default' },
          { value: 'formal', label: 'Formal' },
          { value: 'professional', label: 'Professional and direct' },
          { value: 'casual', label: 'Casual' },
        ],
      },
      {
        id: 'humourStyle',
        label: 'Humour, metaphor, or literal mode',
        help: 'Define whether Atlas should stay literal or use colour.',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / minimal humour' },
          { value: 'literal', label: 'Strictly literal' },
          { value: 'light-humour', label: 'Light humour' },
          { value: 'metaphorical', label: 'Metaphors welcome' },
        ],
      },
      {
        id: 'challengeStyle',
        label: 'How much Atlas should challenge you',
        help: 'Decide whether Atlas stays neutral or pushes back.',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / pragmatic pushback' },
          { value: 'supportive', label: 'Supportive first' },
          { value: 'neutral', label: 'Neutral' },
          { value: 'challenging', label: 'Challenge assumptions directly' },
        ],
      },
      {
        id: 'defaultVerbosity',
        label: 'Default verbosity',
        help: 'How compact the default response should be.',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / concise' },
          { value: 'compact', label: 'Compact' },
          { value: 'balanced', label: 'Balanced' },
          { value: 'elaborative', label: 'Elaborative' },
        ],
      },
      {
        id: 'formattingStyle',
        label: 'Preferred formatting style',
        help: 'Whether Atlas should lean on markdown or stay plain.',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / markdown when useful' },
          { value: 'markdown', label: 'Markdown' },
          { value: 'plain-text', label: 'Plain text' },
          { value: 'emoji-light', label: 'Light emoji use' },
        ],
      },
      {
        id: 'styleMirroring',
        label: 'Style mirroring policy',
        help: 'Should Atlas mirror the user or keep a stable voice?',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / stable voice with adaptation' },
          { value: 'mirror', label: 'Mirror the operator' },
          { value: 'stable', label: 'Maintain its own style' },
          { value: 'hybrid', label: 'Hybrid' },
        ],
      },
    ],
  },
  {
    id: 'cognition',
    label: 'Cognitive Style',
    kicker: 'Reasoning',
    description: 'Tune how much reasoning Atlas surfaces, how proactively it proposes options, and how cautiously it should infer context.',
    summary: 'Reasoning visibility, alternatives, context carry-forward, risk tolerance.',
    questions: [
      {
        id: 'reasoningVisibility',
        label: 'Reasoning visibility',
        help: 'How much reasoning should Atlas expose?',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / concise rationale only' },
          { value: 'minimal', label: 'Minimal reasoning' },
          { value: 'high-level', label: 'High-level reasoning' },
          { value: 'detailed', label: 'Detailed explanation' },
        ],
      },
      {
        id: 'alternativeBehavior',
        label: 'Alternative proposals',
        help: 'Whether Atlas should surface alternatives without being asked.',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / when materially useful' },
          { value: 'proactive', label: 'Proactively propose alternatives' },
          { value: 'on-request', label: 'Wait to be asked' },
        ],
      },
      {
        id: 'sessionContextBehavior',
        label: 'Context carry-forward behavior',
        help: 'How much Atlas should assume from prior sessions.',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / use memory with caution' },
          { value: 'assume-memory', label: 'Assume prior context when available' },
          { value: 'ask-first', label: 'Ask for clarification first' },
          { value: 'fresh-start', label: 'Prefer fresh context' },
        ],
      },
      {
        id: 'riskTolerance',
        label: 'Suggestion risk tolerance',
        help: 'How aggressive Atlas should be in its recommendations.',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / risk-aware' },
          { value: 'risk-averse', label: 'Risk-averse' },
          { value: 'risk-neutral', label: 'Risk-neutral' },
          { value: 'risk-tolerant', label: 'Risk-tolerant' },
        ],
      },
      {
        id: 'creativityMode',
        label: 'Determinism vs creativity',
        help: 'Whether Atlas should favor repeatable workflows or creative exploration.',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / deterministic by default' },
          { value: 'deterministic', label: 'Deterministic workflows' },
          { value: 'balanced', label: 'Balanced' },
          { value: 'creative', label: 'Allow more probabilistic creativity' },
        ],
      },
    ],
  },
  {
    id: 'boundaries',
    label: 'Boundaries',
    kicker: 'Constraints',
    description: 'Encode hard limits around safety, confirmation gates, autonomy, and emotional framing.',
    summary: 'Avoid topics, approval gates, autonomy, empathy policy.',
    questions: [
      {
        id: 'avoidTopics',
        label: 'Topics to avoid entirely',
        help: 'List domains Atlas should refuse or deflect.',
        placeholder: 'Example: legal advice, storing secrets in memory, destructive git operations without explicit approval.',
      },
      {
        id: 'confirmationTriggers',
        label: 'Actions requiring explicit confirmation',
        help: 'Specify the exact classes of risky action that must stop for approval.',
        placeholder: 'Example: dependency installs, external network actions, deleting files, branch changes, force pushes.',
      },
      {
        id: 'autonomyLevel',
        label: 'Desired autonomy level',
        help: 'How independent Atlas should be inside its domain.',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / partial autonomy' },
          { value: 'none', label: 'No autonomy' },
          { value: 'partial', label: 'Partial autonomy' },
          { value: 'full-domain', label: 'Full autonomy within defined domains' },
        ],
      },
      {
        id: 'safetyOverrideBehavior',
        label: 'Safety override behavior',
        help: 'Should Atlas ever override user instructions for safety or consistency?',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / safety overrides when required' },
          { value: 'safety-first', label: 'Yes, prioritize safety' },
          { value: 'ask-before-refusing', label: 'Ask before refusing when possible' },
          { value: 'strict-user-control', label: 'Prefer user control unless blocked' },
        ],
      },
      {
        id: 'emotionalFraming',
        label: 'Emotional framing',
        help: 'How emotionally neutral or empathetic Atlas should sound.',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / calm and neutral' },
          { value: 'neutral', label: 'Strictly neutral' },
          { value: 'empathetic', label: 'Light empathetic framing' },
          { value: 'supportive', label: 'Supportive and warm' },
        ],
      },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    kicker: 'Workflow',
    description: 'Blend high-level behavior preferences with live AtlasMind settings. This section is where the profile becomes executable.',
    summary: 'Workflow defaults plus real routed settings and context limits.',
    questions: [
      {
        id: 'guidanceDepth',
        label: 'Preferred guidance depth',
        help: 'Minimal steps vs detailed breakdowns.',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / concise with detail when needed' },
          { value: 'minimal', label: 'Minimal steps' },
          { value: 'step-by-step', label: 'Detailed step-by-step' },
        ],
      },
      {
        id: 'defaultActionBias',
        label: 'Default action bias',
        help: 'Should Atlas default to doing, explaining, or asking first?',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / act unless the prompt implies discussion' },
          { value: 'generate-code', label: 'Generate or change code by default' },
          { value: 'explain-first', label: 'Explain first' },
          { value: 'ask-first', label: 'Ask before acting' },
        ],
      },
      {
        id: 'structureMaintenance',
        label: 'Project-structure maintenance',
        help: 'Whether Atlas should proactively keep docs and structure aligned.',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / maintain when required by repo rules' },
          { value: 'proactive', label: 'Proactively maintain structure' },
          { value: 'explicit-only', label: 'Wait for explicit instructions' },
        ],
      },
      {
        id: 'goalHorizon',
        label: 'Goal horizon',
        help: 'Should Atlas track long-term direction or stay local to the task?',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / track material long-term goals' },
          { value: 'task-only', label: 'Focus on current task only' },
          { value: 'project-aware', label: 'Keep project goals in view' },
        ],
      },
      {
        id: 'costAwareness',
        label: 'Cost-awareness behavior',
        help: 'How visible routing cost and model choices should be.',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / surface when relevant' },
          { value: 'always-surface', label: 'Surface cost awareness automatically' },
          { value: 'quiet', label: 'Keep cost discussion quiet unless asked' },
        ],
      },
    ],
  },
  {
    id: 'values',
    label: 'Values',
    kicker: 'Compass',
    description: 'Capture the values Atlas should use when several technically valid answers compete.',
    summary: 'Values, open-source preference, autonomy balance.',
    questions: [
      {
        id: 'priorityValues',
        label: 'Priority values',
        help: 'List the values Atlas should optimize for in order.',
        placeholder: 'Example: transparency, precision, efficiency, kindness, creativity.',
      },
      {
        id: 'openSourcePreference',
        label: 'Open-source preference',
        help: 'Whether Atlas should prefer open-source solutions when practical.',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / prefer open where reasonable' },
          { value: 'prefer-open', label: 'Prefer open-source' },
          { value: 'neutral', label: 'Neutral' },
          { value: 'best-tool', label: 'Use the best tool regardless of license' },
        ],
      },
      {
        id: 'proprietaryFallback',
        label: 'Proprietary tool fallback',
        help: 'How reluctant Atlas should be to suggest proprietary tools.',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / only when materially better' },
          { value: 'avoid', label: 'Avoid unless necessary' },
          { value: 'neutral', label: 'Neutral' },
          { value: 'allowed', label: 'Allowed when useful' },
        ],
      },
      {
        id: 'autonomyVsInitiative',
        label: 'User autonomy vs agent initiative',
        help: 'Which side Atlas should favor when both are viable.',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / preserve user autonomy' },
          { value: 'user-autonomy', label: 'Favor user autonomy' },
          { value: 'balanced', label: 'Balanced' },
          { value: 'agent-initiative', label: 'Favor agent initiative' },
        ],
      },
    ],
  },
  {
    id: 'flavor',
    label: 'Personal Flavor',
    kicker: 'Optional',
    description: 'Add personality color without changing the hard behavioral contract.',
    summary: 'Humour level, lens, signature, references.',
    questions: [
      {
        id: 'humourLevel',
        label: 'Sense of humour',
        help: 'How much personality color is welcome.',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / very light' },
          { value: 'none', label: 'None' },
          { value: 'light', label: 'Light' },
          { value: 'playful', label: 'Playful' },
        ],
      },
      {
        id: 'metaphoricalLens',
        label: 'Metaphorical lens',
        help: 'A framing identity such as mentor, strategist, or engineer.',
        placeholder: 'Example: engineer, navigator, systems strategist.',
      },
      {
        id: 'signaturePhrase',
        label: 'Signature phrase or quirk',
        help: 'Optional recurring phrase or stylistic tick.',
        placeholder: 'Leave blank to keep Atlas neutral.',
      },
      {
        id: 'culturalReferences',
        label: 'Allowed cultural domains',
        help: 'Optional references such as games, sci-fi, or philosophy.',
        placeholder: 'Example: light sci-fi metaphors only; avoid pop culture references.',
      },
    ],
  },
  {
    id: 'memory',
    label: 'Memory & Continuity',
    kicker: 'Continuity',
    description: 'Tell Atlas what it should retain, what it must never persist, and how it should handle session summaries.',
    summary: 'Retention rules, session summaries, goal continuity.',
    questions: [
      {
        id: 'rememberLongTerm',
        label: 'What Atlas should remember long-term',
        help: 'Describe durable preferences, goals, or architectural facts.',
        placeholder: 'Example: preferred coding style, active roadmap themes, release hygiene expectations.',
      },
      {
        id: 'neverStore',
        label: 'What Atlas must never store',
        help: 'Call out secrets or classes of data that stay out of memory.',
        placeholder: 'Example: API keys, credentials, personal sensitive data, speculative HR or legal notes.',
      },
      {
        id: 'autoSessionSummaries',
        label: 'Automatic session summaries',
        help: 'Whether Atlas should summarize sessions automatically.',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / summarize when meaningful' },
          { value: 'always', label: 'Always summarize' },
          { value: 'important-only', label: 'Only major sessions' },
          { value: 'never', label: 'Never' },
        ],
      },
      {
        id: 'goalModelPersistence',
        label: 'Running model of goals and projects',
        help: 'Should Atlas maintain an ongoing view of your goals?',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / yes when useful' },
          { value: 'maintain', label: 'Maintain a running model' },
          { value: 'task-local', label: 'Keep goals task-local' },
        ],
      },
    ],
  },
  {
    id: 'conflict',
    label: 'Conflict Resolution',
    kicker: 'Escalation',
    description: 'Define how Atlas should behave when instructions conflict, ambiguity is high, or personality preferences and immediate requests diverge.',
    summary: 'Conflict handling, clarifications, assumptions, escalation.',
    questions: [
      {
        id: 'instructionConflictPolicy',
        label: 'When instructions conflict',
        help: 'What should Atlas do first?',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / choose the safest coherent interpretation' },
          { value: 'ask-clarifying', label: 'Ask clarifying questions' },
          { value: 'safest-interpretation', label: 'Choose the safest interpretation' },
          { value: 'follow-latest', label: 'Favor the latest explicit instruction' },
        ],
      },
      {
        id: 'ambiguityHandling',
        label: 'Ambiguity handling',
        help: 'How should Atlas react when the request is underspecified?',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / proceed when safe, ask when blocking' },
          { value: 'ask-first', label: 'Ask first' },
          { value: 'safe-assumptions', label: 'Proceed with safe assumptions' },
          { value: 'escalate', label: 'Escalate uncertainty explicitly' },
        ],
      },
      {
        id: 'assumptionPolicy',
        label: 'Assumption policy',
        help: 'How aggressive Atlas should be in making assumptions.',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / narrow assumptions only' },
          { value: 'minimal', label: 'Minimal assumptions' },
          { value: 'pragmatic', label: 'Pragmatic assumptions' },
          { value: 'assertive', label: 'Assertive assumptions' },
        ],
      },
      {
        id: 'personalityVsRequest',
        label: 'Personality vs immediate request',
        help: 'Which should win when they diverge?',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto / prioritize safe user intent' },
          { value: 'personality', label: 'Keep personality consistent' },
          { value: 'request', label: 'Favor the immediate request' },
          { value: 'hybrid', label: 'Blend both' },
        ],
      },
    ],
  },
  {
    id: 'redlines',
    label: 'Red Lines',
    kicker: 'Non-negotiables',
    description: 'Document the behaviors, tones, and recommendation classes Atlas must never cross.',
    summary: 'Forbidden behaviors, phrasing, actions, and refusal posture.',
    questions: [
      {
        id: 'neverExhibit',
        label: 'Behaviors Atlas must never exhibit',
        help: 'The hard stop list.',
        placeholder: 'Example: false confidence, secret exfiltration, destructive changes without approval, manipulative framing.',
      },
      {
        id: 'forbiddenPhrasing',
        label: 'Tone or phrasing that is forbidden',
        help: 'Specify wording or attitude Atlas should avoid.',
        placeholder: 'Example: condescension, sarcasm toward the operator, hype language, guilt framing.',
      },
      {
        id: 'outOfScopeSuggestions',
        label: 'Suggestions or actions that are out of scope',
        help: 'Name recommendation classes Atlas should not offer.',
        placeholder: 'Example: legal advice, fake certainty, production deployment without review, storing secrets in docs.',
      },
      {
        id: 'constraintViolationResponse',
        label: 'Response when a request violates constraints',
        help: 'How Atlas should refuse or redirect.',
        placeholder: 'Example: briefly explain the constraint, refuse the unsafe part, and offer the closest safe alternative.',
      },
    ],
  },
];

const SELECT_ANSWER_IDS = new Set<ProfileAnswerId>(
  PROFILE_SECTIONS.flatMap(section => section.questions.filter(question => question.kind === 'select').map(question => question.id)),
);

export class PersonalityProfilePanel {
  public static currentPanel: PersonalityProfilePanel | undefined;
  private static readonly viewType = 'atlasmind.personalityProfile';

  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private readonly atlas: AtlasMindContext;
  private disposables: vscode.Disposable[] = [];

  public static async createOrShow(context: vscode.ExtensionContext, atlas: AtlasMindContext): Promise<void> {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (PersonalityProfilePanel.currentPanel) {
      PersonalityProfilePanel.currentPanel.panel.reveal(column);
      await PersonalityProfilePanel.currentPanel.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      PersonalityProfilePanel.viewType,
      'Atlas Personality Profile',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    const instance = new PersonalityProfilePanel(panel, context, atlas);
    PersonalityProfilePanel.currentPanel = instance;
    await instance.refresh();
  }

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, atlas: AtlasMindContext) {
    this.panel = panel;
    this.context = context;
    this.atlas = atlas;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(message => {
      void this.handleMessage(message);
    }, null, this.disposables);
  }

  private dispose(): void {
    PersonalityProfilePanel.currentPanel = undefined;
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async refresh(statusMessage?: string): Promise<void> {
    const state = await this.getState();
    this.panel.webview.html = this.buildHtml(state, statusMessage);
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isPersonalityProfileMessage(message)) {
      return;
    }

    if (message.type === 'ready') {
      return;
    }

    if (message.type === 'openCommand') {
      await vscode.commands.executeCommand(message.payload);
      return;
    }

    if (message.type === 'openProfileFile') {
      await this.openProfileFile(message.payload);
      return;
    }

    if (message.type === 'revertProjectToGlobal') {
      const revertedState = await this.revertProjectToGlobal();
      this.panel.webview.html = this.buildHtml(revertedState.state, revertedState.statusMessage);
      await this.panel.webview.postMessage({ type: 'saved', payload: revertedState.statusMessage });
      return;
    }

    const savedState = await this.saveProfile(message.payload.scope, message.payload.answers, message.payload.config);
    this.panel.webview.html = this.buildHtml(savedState.state, savedState.statusMessage);
    await this.panel.webview.postMessage({ type: 'saved', payload: savedState.statusMessage });
  }

  private async openProfileFile(target: 'profileMarkdown' | 'projectSoul'): Promise<void> {
    const ssotRoot = await this.resolveSsotRoot();
    if (!ssotRoot) {
      return;
    }

    const fileUri = target === 'profileMarkdown'
      ? vscode.Uri.joinPath(ssotRoot, 'agents', PROFILE_MARKDOWN_FILE)
      : vscode.Uri.joinPath(ssotRoot, PROJECT_SOUL_FILE);

    if (!(await uriExists(fileUri))) {
      void vscode.window.showInformationMessage('That project profile artifact does not exist yet. Save a project-specific profile first.');
      return;
    }

    const document = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  private async getState(): Promise<PersonalityProfileState> {
    const config = readConfigSnapshot('effective');
    const globalConfig = readConfigSnapshot('global');
    const defaultConfig = readConfigSnapshot('default');
    const globalProfile = this.loadGlobalProfileRecord();
    const projectProfile = await this.loadProjectProfileRecord();
    const ssotInfo = await this.resolveSsotInfo();
    const hasGlobalProfile = hasMeaningfulProfile(globalProfile);
    const hasProjectProfile = hasMeaningfulProfile(projectProfile);

    return {
      profile: mergeProfileRecords(globalProfile, projectProfile),
      config,
      globalProfile,
      globalConfig,
      defaultProfile: emptyProfileRecord(),
      defaultConfig,
      hasGlobalProfile,
      hasProjectProfile,
      effectiveProfileSource: hasProjectProfile ? 'project' : hasGlobalProfile ? 'global' : 'default',
      effectiveConfigSource: detectEffectiveConfigSource(),
      ssot: ssotInfo,
    };
  }

  private loadGlobalProfileRecord(): PersonalityProfileRecord {
    const stored = this.context.globalState.get<unknown>(GLOBAL_PERSONALITY_PROFILE_STORAGE_KEY);
    if (isPersonalityProfileRecord(stored)) {
      return stored;
    }

    return emptyProfileRecord();
  }

  private async loadProjectProfileRecord(): Promise<PersonalityProfileRecord> {
    const stored = this.context.workspaceState.get<unknown>(PROJECT_PERSONALITY_PROFILE_STORAGE_KEY);
    if (isPersonalityProfileRecord(stored)) {
      return stored;
    }

    const ssotRoot = await this.resolveSsotRoot();
    if (!ssotRoot) {
      return emptyProfileRecord();
    }

    const fileUri = vscode.Uri.joinPath(ssotRoot, 'agents', PROFILE_JSON_FILE);
    try {
      const raw = await vscode.workspace.fs.readFile(fileUri);
      const parsed = JSON.parse(Buffer.from(raw).toString('utf-8')) as unknown;
      if (isPersonalityProfileRecord(parsed)) {
        await this.context.workspaceState.update(PROJECT_PERSONALITY_PROFILE_STORAGE_KEY, parsed);
        return parsed;
      }
    } catch {
      // Ignore malformed or missing persisted profile files and fall back to an empty record.
    }

    return emptyProfileRecord();
  }

  private async saveProfile(
    scope: SaveScope,
    answers: Partial<Record<ProfileAnswerId, string>>,
    config: ConfigValueMap,
  ): Promise<{ state: PersonalityProfileState; statusMessage: string }> {
    const sanitizedAnswers = sanitizeAnswers(answers);
    const record: PersonalityProfileRecord = {
      version: 1,
      updatedAt: new Date().toISOString(),
      answers: sanitizedAnswers,
    };
    const hasProfileContent = hasMeaningfulProfile(record);

    if (scope === 'global') {
      await this.applyConfig(config, vscode.ConfigurationTarget.Global);
      await this.context.globalState.update(GLOBAL_PERSONALITY_PROFILE_STORAGE_KEY, hasProfileContent ? record : undefined);
      return {
        state: await this.getState(),
        statusMessage: hasProfileContent
          ? 'Global personality defaults saved. They apply to workspaces without project overrides.'
          : 'Global personality defaults cleared. Atlas will fall back to its built-in defaults unless a project override exists.',
      };
    }

    await this.applyConfig(config, vscode.ConfigurationTarget.Workspace);

    const ssotRoot = await this.resolveSsotRoot();
    let statusMessage = 'Project personality overrides saved for this workspace.';

    if (hasProfileContent) {
      await this.context.workspaceState.update(PROJECT_PERSONALITY_PROFILE_STORAGE_KEY, record);
      if (ssotRoot) {
        await this.writeProfileArtifacts(ssotRoot, record, config);
        await this.atlas.memoryManager.loadFromDisk(ssotRoot);
        this.atlas.memoryRefresh.fire();
        statusMessage = 'Project personality overrides saved and synced into project memory.';
      } else {
        statusMessage = 'Project personality overrides saved to workspace state. Run bootstrap or import to sync them into project memory.';
      }
    } else {
      await this.context.workspaceState.update(PROJECT_PERSONALITY_PROFILE_STORAGE_KEY, undefined);
      if (ssotRoot) {
        await this.clearProjectProfileArtifacts(ssotRoot);
        await this.atlas.memoryManager.loadFromDisk(ssotRoot);
        this.atlas.memoryRefresh.fire();
      }
      statusMessage = 'Project personality answers were cleared. Atlas will use the global profile here unless workspace settings override it.';
    }

    return {
      state: await this.getState(),
      statusMessage,
    };
  }

  private async revertProjectToGlobal(): Promise<{ state: PersonalityProfileState; statusMessage: string }> {
    await this.context.workspaceState.update(PROJECT_PERSONALITY_PROFILE_STORAGE_KEY, undefined);
    await this.clearWorkspaceConfigOverrides();

    const ssotRoot = await this.resolveSsotRoot();
    if (ssotRoot) {
      await this.clearProjectProfileArtifacts(ssotRoot);
      await this.atlas.memoryManager.loadFromDisk(ssotRoot);
      this.atlas.memoryRefresh.fire();
    }

    return {
      state: await this.getState(),
      statusMessage: 'Project overrides removed. Atlas will fall back to the saved global profile and user-level settings for this workspace.',
    };
  }

  private async applyConfig(config: ConfigValueMap, target: vscode.ConfigurationTarget.Global | vscode.ConfigurationTarget.Workspace): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('atlasmind');
    await configuration.update('budgetMode', config.budgetMode, target);
    await configuration.update('speedMode', config.speedMode, target);
    await configuration.update('toolApprovalMode', config.toolApprovalMode, target);
    await configuration.update('dailyCostLimitUsd', clampNumber(config.dailyCostLimitUsd, 0, 1_000_000), target);
    await configuration.update('chatSessionTurnLimit', clampNumber(config.chatSessionTurnLimit, 1, 50), target);
    await configuration.update('chatSessionContextChars', clampNumber(config.chatSessionContextChars, 250, 25_000), target);
    await configuration.update('showImportProjectAction', Boolean(config.showImportProjectAction), target);
  }

  private async clearWorkspaceConfigOverrides(): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('atlasmind');
    await configuration.update('budgetMode', undefined, vscode.ConfigurationTarget.Workspace);
    await configuration.update('speedMode', undefined, vscode.ConfigurationTarget.Workspace);
    await configuration.update('toolApprovalMode', undefined, vscode.ConfigurationTarget.Workspace);
    await configuration.update('dailyCostLimitUsd', undefined, vscode.ConfigurationTarget.Workspace);
    await configuration.update('chatSessionTurnLimit', undefined, vscode.ConfigurationTarget.Workspace);
    await configuration.update('chatSessionContextChars', undefined, vscode.ConfigurationTarget.Workspace);
    await configuration.update('showImportProjectAction', undefined, vscode.ConfigurationTarget.Workspace);
  }

  private async writeProfileArtifacts(
    ssotRoot: vscode.Uri,
    profile: PersonalityProfileRecord,
    config: ConfigValueMap,
  ): Promise<void> {
    const agentsDir = vscode.Uri.joinPath(ssotRoot, 'agents');
    await vscode.workspace.fs.createDirectory(agentsDir);

    const jsonUri = vscode.Uri.joinPath(agentsDir, PROFILE_JSON_FILE);
    const markdownUri = vscode.Uri.joinPath(agentsDir, PROFILE_MARKDOWN_FILE);
    const soulUri = vscode.Uri.joinPath(ssotRoot, PROJECT_SOUL_FILE);

    await vscode.workspace.fs.writeFile(jsonUri, Buffer.from(`${JSON.stringify(profile, null, 2)}\n`, 'utf-8'));
    await vscode.workspace.fs.writeFile(markdownUri, Buffer.from(buildProfileMarkdown(profile, config), 'utf-8'));

    const soulContent = await readTextIfExists(soulUri);
    const updatedSoul = upsertProjectSoulSection(soulContent, profile, config);
    await vscode.workspace.fs.writeFile(soulUri, Buffer.from(updatedSoul, 'utf-8'));
  }

  private async clearProjectProfileArtifacts(ssotRoot: vscode.Uri): Promise<void> {
    const jsonUri = vscode.Uri.joinPath(ssotRoot, 'agents', PROFILE_JSON_FILE);
    const markdownUri = vscode.Uri.joinPath(ssotRoot, 'agents', PROFILE_MARKDOWN_FILE);
    const soulUri = vscode.Uri.joinPath(ssotRoot, PROJECT_SOUL_FILE);

    await deleteUriIfExists(jsonUri);
    await deleteUriIfExists(markdownUri);

    const soulContent = await readTextIfExists(soulUri);
    const updatedSoul = removeProjectSoulSection(soulContent);
    if (updatedSoul !== soulContent) {
      await vscode.workspace.fs.writeFile(soulUri, Buffer.from(updatedSoul, 'utf-8'));
    }
  }

  private async resolveSsotRoot(): Promise<vscode.Uri | undefined> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return undefined;
    }

    const relativePath = normalizeSsotPath(vscode.workspace.getConfiguration('atlasmind').get<string>('ssotPath', DEFAULT_SSOT_PATH));
    if (!relativePath) {
      return undefined;
    }

    const rootUri = vscode.Uri.joinPath(workspaceFolder.uri, ...relativePath.split('/'));
    const soulUri = vscode.Uri.joinPath(rootUri, PROJECT_SOUL_FILE);
    return await uriExists(soulUri) ? rootUri : undefined;
  }

  private async resolveSsotInfo(): Promise<PersonalityProfileState['ssot']> {
    const ssotRoot = await this.resolveSsotRoot();
    if (!ssotRoot) {
      return { available: false };
    }

    const relativeRoot = vscode.workspace.asRelativePath(ssotRoot, false).replace(/\\/g, '/');
    return {
      available: true,
      relativePath: relativeRoot,
      profileJsonPath: `${relativeRoot}/agents/${PROFILE_JSON_FILE}`,
      profileMarkdownPath: `${relativeRoot}/agents/${PROFILE_MARKDOWN_FILE}`,
      projectSoulPath: `${relativeRoot}/${PROJECT_SOUL_FILE}`,
    };
  }

  private buildHtml(state: PersonalityProfileState, statusMessage?: string): string {
    const bodyContent = `
      <div class="personality-shell">
        <header class="hero-card">
          <div>
            <p class="hero-kicker">Guided Configuration</p>
            <h1>Atlas Personality Profile</h1>
            <p class="hero-copy">Shape Atlas with both a reusable global baseline and optional project-specific overrides. Skip unanswered prompts, leave anything on auto, and keep the live routed settings beside tone, memory, and red-line constraints.</p>
          </div>
          <div class="hero-actions" role="group" aria-label="Profile actions">
            <button type="button" class="ghost-button" data-command="atlasmind.openGettingStarted">Getting Started</button>
            <button type="button" class="ghost-button" data-command="atlasmind.openSettings">Atlas Settings</button>
            <button type="button" class="solid-button" data-command="atlasmind.openProjectDashboard">Project Dashboard</button>
          </div>
        </header>

        <section class="status-strip" aria-label="Profile status">
          <article class="status-card">
            <span class="status-label">Effective profile</span>
            <strong>${escapeHtml(describeEffectiveProfileSource(state.effectiveProfileSource))}</strong>
            <span>${escapeHtml(countAnsweredQuestions(state.profile.answers))} prompts answered across ${PROFILE_SECTIONS.length} sections.</span>
          </article>
          <article class="status-card">
            <span class="status-label">Global defaults</span>
            <strong>${escapeHtml(state.hasGlobalProfile ? `Updated ${formatRelativeLabel(state.globalProfile.updatedAt)}` : 'Not saved yet')}</strong>
            <span>${escapeHtml(state.hasGlobalProfile ? 'Use Save as Global Default to update the baseline for future projects.' : 'Save a global baseline to carry your preferred personality into new workspaces.')}</span>
          </article>
          <article class="status-card">
            <span class="status-label">Live defaults</span>
            <strong>${escapeHtml(describeEffectiveConfigSource(state.effectiveConfigSource))}</strong>
            <span>${escapeHtml(describeLiveDefaults(state.config))}</span>
          </article>
        </section>

        <div class="workspace-note${state.ssot.available ? '' : ' warn'}">
          <strong>${state.ssot.available ? (state.hasProjectProfile ? 'Project memory is active for project overrides.' : 'Project memory is ready if you save project overrides.') : 'Project memory sync is waiting.'}</strong>
          ${state.ssot.available
            ? `<span>Save for This Project to update <button type="button" class="inline-link-button" data-open-file="profileMarkdown">${escapeHtml(state.ssot.profileMarkdownPath ?? 'the profile markdown')}</button> and the personality summary inside <button type="button" class="inline-link-button" data-open-file="projectSoul">${escapeHtml(state.ssot.projectSoulPath ?? PROJECT_SOUL_FILE)}</button>. Save as Global Default stays local to your VS Code profile and is not written into project memory.</span>`
            : `<span>${escapeHtml('You can still save global defaults now. Project-specific overrides will stay in workspace state until bootstrap or import enables SSOT sync.')}</span>`}
        </div>

        <div id="save-status" class="save-status${statusMessage ? ' visible' : ''}" aria-live="polite">${escapeHtml(statusMessage ?? '')}</div>

        <div class="profile-layout">
          <nav class="profile-nav" aria-label="Personality profile sections"></nav>
          <main class="profile-main">
            <section class="section-overview" id="section-overview"></section>
            <section class="section-live-settings" id="section-live-settings"></section>
            <form id="personality-form" class="questionnaire" novalidate></form>
          </main>
        </div>
      </div>
    `;

    return getWebviewHtmlShell({
      title: 'Atlas Personality Profile',
      bodyContent,
      cspSource: this.panel.webview.cspSource,
      extraCss: getExtraCss(),
      scriptContent: this.buildScript(state),
    });
  }

  private buildScript(state: PersonalityProfileState): string {
    const serializedState = serializeForScript(state);
    const serializedSections = serializeForScript(PROFILE_SECTIONS);

    return `
      const vscode = acquireVsCodeApi();
      const initialState = ${serializedState};
      const sections = ${serializedSections};
      const sectionOrder = sections.map(section => section.id);
      let activeSection = sectionOrder[0];
      const formState = structuredClone(initialState);

      const navRoot = document.querySelector('.profile-nav');
      const formRoot = document.getElementById('personality-form');
      const overviewRoot = document.getElementById('section-overview');
      const liveSettingsRoot = document.getElementById('section-live-settings');
      const saveStatus = document.getElementById('save-status');

      function answeredCount(sectionId) {
        const section = sections.find(entry => entry.id === sectionId);
        if (!section) { return 0; }
        return section.questions.filter(question => {
          const value = formState.profile.answers?.[question.id];
          return typeof value === 'string' && value.trim().length > 0 && value !== 'auto';
        }).length;
      }

      function formatConfigLabel(key, value) {
        if (key === 'dailyCostLimitUsd') {
          return Number(value) > 0 ? '$' + Number(value).toFixed(2) + ' / day' : 'No daily cost cap';
        }
        if (key === 'showImportProjectAction') {
          return value ? 'Import action visible' : 'Import action hidden';
        }
        return String(value);
      }

      function renderOverview() {
        const answered = Object.values(formState.profile.answers ?? {}).filter(value => typeof value === 'string' && value.trim().length > 0 && value !== 'auto').length;
        overviewRoot.innerHTML = '';

        const card = document.createElement('article');
        card.className = 'overview-card';
        card.innerHTML = [
          '<div class="overview-copy">',
          '<p class="section-kicker">Questionnaire flow</p>',
          '<h2>Move section by section, or skip to what matters.</h2>',
          '<p>Every prompt includes an editable freeform answer plus a quick-fill preset picker. Save as a global baseline for future workspaces, or save project overrides that only apply in this repo.</p>',
          '<p class="overview-note">Load Saved Global and Load Atlas Defaults only refill the editor. Clear Saved Project Override removes the stored project-only version and falls back to the global baseline after the save completes.</p>',
          '</div>',
          '<div class="overview-actions">',
          '<button type="button" class="ghost-button" id="clear-current-section">Clear Current Section</button>',
          '<button type="button" class="ghost-button" id="restore-global"' + (formState.hasGlobalProfile ? '' : ' disabled') + '>Load Saved Global</button>',
          '<button type="button" class="ghost-button" id="restore-defaults">Load Atlas Defaults</button>',
          '<button type="button" class="ghost-button" id="revert-project"' + (formState.hasProjectProfile ? '' : ' disabled') + '>Clear Saved Project Override</button>',
          '<button type="button" class="solid-button" id="save-global">Save as Global Default</button>',
          '<button type="button" class="solid-button" id="save-project">Save for This Project</button>',
          '</div>',
          '<div class="overview-metrics">',
          '<div class="metric-pill"><span>Answered</span><strong>' + answered + '</strong></div>',
          '<div class="metric-pill"><span>Current section</span><strong>' + (sections.find(section => section.id === activeSection)?.label ?? '') + '</strong></div>',
          '<div class="metric-pill"><span>Profile source</span><strong>' + String(formState.effectiveProfileSource) + '</strong></div>',
          '<div class="metric-pill"><span>Config source</span><strong>' + String(formState.effectiveConfigSource) + '</strong></div>',
          '<div class="metric-pill"><span>SSOT</span><strong>' + (formState.ssot.available ? (formState.hasProjectProfile ? 'project sync active' : 'ready') : 'pending') + '</strong></div>',
          '</div>',
        ].join('');
        overviewRoot.appendChild(card);

        document.getElementById('clear-current-section')?.addEventListener('click', () => {
          const current = sections.find(section => section.id === activeSection);
          if (!current) { return; }
          current.questions.forEach(question => {
            formState.profile.answers[question.id] = question.kind === 'select' ? 'auto' : '';
          });
          render();
        });

        document.getElementById('restore-global')?.addEventListener('click', () => {
          formState.profile = structuredClone(formState.globalProfile);
          formState.config = structuredClone(formState.globalConfig);
          render();
        });

        document.getElementById('restore-defaults')?.addEventListener('click', () => {
          formState.profile = structuredClone(formState.defaultProfile);
          formState.config = structuredClone(formState.defaultConfig);
          render();
        });

        document.getElementById('revert-project')?.addEventListener('click', () => {
          vscode.postMessage({ type: 'revertProjectToGlobal' });
        });

        document.getElementById('save-global')?.addEventListener('click', () => saveProfile('global'));
        document.getElementById('save-project')?.addEventListener('click', () => saveProfile('project'));
      }

      function renderLiveSettings() {
        liveSettingsRoot.innerHTML = '';
        const card = document.createElement('article');
        card.className = 'settings-card';

        const settings = [
          ['budgetMode', 'Budget mode', 'Model spend posture', 'atlasmind.openSettingsModels', 'Open model settings'],
          ['speedMode', 'Speed mode', 'Routing latency posture', 'atlasmind.openSettingsModels', 'Open model settings'],
          ['toolApprovalMode', 'Tool approval mode', 'Execution gate', 'atlasmind.openSettingsSafety', 'Open safety settings'],
          ['dailyCostLimitUsd', 'Daily cost limit', 'Workspace budget cap', 'atlasmind.openSettings', 'Open overview settings'],
          ['chatSessionTurnLimit', 'Carry-forward turns', 'Recent session memory', 'atlasmind.openSettingsChat', 'Open chat settings'],
          ['chatSessionContextChars', 'Carry-forward characters', 'Conversation summary budget', 'atlasmind.openSettingsChat', 'Open chat settings'],
          ['showImportProjectAction', 'Import project action', 'Sidebar memory affordance', 'atlasmind.openSettingsProject', 'Open project settings'],
        ];

        const grid = document.createElement('div');
        grid.className = 'settings-grid';
        for (const [key, label, hint, command, actionLabel] of settings) {
          const tile = document.createElement('button');
          tile.type = 'button';
          tile.className = 'settings-tile settings-link-tile';
          tile.dataset.command = command;
          tile.setAttribute('aria-label', label + '. ' + actionLabel + '.');
          tile.innerHTML = '<span>' + label + '</span><strong>' + formatConfigLabel(key, formState.config[key]) + '</strong><small>' + hint + '</small><em>' + actionLabel + '</em>';
          grid.appendChild(tile);
        }

        card.innerHTML = '<p class="section-kicker">Live AtlasMind settings</p><h2>These values can be saved globally or per project.</h2><p>The operations section below controls the routed defaults Atlas uses today; global saves write user settings, while project saves write workspace overrides.</p>';
        card.appendChild(grid);
        liveSettingsRoot.appendChild(card);
      }

      function renderNav() {
        navRoot.innerHTML = '';
        sections.forEach(section => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'nav-button' + (section.id === activeSection ? ' active' : '');
          button.setAttribute('aria-current', section.id === activeSection ? 'page' : 'false');
          button.innerHTML = '<span class="nav-kicker">' + section.kicker + '</span><strong>' + section.label + '</strong><small>' + answeredCount(section.id) + ' answered</small>';
          button.addEventListener('click', () => {
            activeSection = section.id;
            render();
          });
          navRoot.appendChild(button);
        });
      }

      function createInput(question) {
        const wrapper = document.createElement('label');
        wrapper.className = 'question-card';
        wrapper.htmlFor = question.id;

        const head = document.createElement('div');
        head.className = 'question-head';
        head.innerHTML = '<span>' + question.label + '</span><small>' + question.help + '</small>';
        wrapper.appendChild(head);

        const currentValue = formState.profile.answers?.[question.id] ?? (question.kind === 'select' ? 'auto' : '');
        const quickFill = document.createElement('div');
        quickFill.className = 'quick-fill-row';

        const quickFillLabel = document.createElement('span');
        quickFillLabel.className = 'quick-fill-label';
        quickFillLabel.textContent = 'Quick fill';

        const quickFillSelect = document.createElement('select');
        quickFillSelect.className = 'quick-fill-select';
        quickFillSelect.innerHTML = '<option value="">Choose a common option...</option>';

        buildQuickFillOptions(question).forEach(option => {
          const optionElement = document.createElement('option');
          optionElement.value = option.value;
          optionElement.textContent = option.label;
          quickFillSelect.appendChild(optionElement);
        });

        const input = document.createElement('textarea');
        input.placeholder = question.placeholder ?? 'Add a custom answer here or use the quick-fill options.';
        input.rows = 4;
        input.value = currentValue;
        input.id = question.id;
        input.name = question.id;
        input.addEventListener('input', event => {
          const value = event.target instanceof HTMLTextAreaElement ? event.target.value : '';
          formState.profile.answers[question.id] = value;
        });

        quickFillSelect.addEventListener('change', event => {
          if (!(event.target instanceof HTMLSelectElement)) { return; }
          if (!event.target.value) { return; }
          input.value = event.target.value;
          formState.profile.answers[question.id] = event.target.value;
          event.target.value = '';
        });

        quickFill.appendChild(quickFillLabel);
        quickFill.appendChild(quickFillSelect);
        wrapper.appendChild(quickFill);
        wrapper.appendChild(input);
        return wrapper;
      }

      function buildQuickFillOptions(question) {
        const options = [];
        const seen = new Set();

        function addOption(value, label) {
          const normalized = typeof value === 'string' ? value.trim() : '';
          if (!normalized || seen.has(normalized)) { return; }
          seen.add(normalized);
          options.push({ value: normalized, label: label || normalized });
        }

        if (Array.isArray(question.options)) {
          question.options.forEach(option => addOption(option.value, option.label));
        }

        if (Array.isArray(question.quickFill)) {
          question.quickFill.forEach(value => addOption(value, value));
        }

        const placeholder = typeof question.placeholder === 'string' ? question.placeholder : '';
        const exampleMatch = placeholder.match(/Example: *(.+)$/i);
        if (exampleMatch && exampleMatch[1]) {
          addOption(exampleMatch[1].trim(), 'Use example');
        }

        addOption('auto', 'Auto / keep Atlas default');
        addOption('Ask first if this matters.', 'Ask first if this matters');
        return options;
      }

      function renderOperationsControls(sectionBody) {
        const liveCard = document.createElement('div');
        liveCard.className = 'settings-form-card';
        liveCard.innerHTML = '<div class="settings-form-head"><span>Live Atlas settings</span><small>These values write straight into workspace config when you save.</small></div>';

        const configFields = document.createElement('div');
        configFields.className = 'config-fields';

        const budgetField = createSelectField('Budget mode', 'budgetMode', formState.config.budgetMode, [
          ['cheap', 'Cheap'], ['balanced', 'Balanced'], ['expensive', 'Expensive'], ['auto', 'Auto'],
        ]);
        const speedField = createSelectField('Speed mode', 'speedMode', formState.config.speedMode, [
          ['fast', 'Fast'], ['balanced', 'Balanced'], ['considered', 'Considered'], ['auto', 'Auto'],
        ]);
        const approvalField = createSelectField('Tool approval mode', 'toolApprovalMode', formState.config.toolApprovalMode, [
          ['always-ask', 'Always ask'],
          ['ask-on-write', 'Ask on write'],
          ['ask-on-external', 'Ask on external'],
          ['allow-safe-readonly', 'Allow safe read-only'],
        ]);
        const dailyCostField = createNumberField('Daily cost limit (USD)', 'dailyCostLimitUsd', formState.config.dailyCostLimitUsd, 0, 1000000, 0.5);
        const turnsField = createNumberField('Carry-forward turns', 'chatSessionTurnLimit', formState.config.chatSessionTurnLimit, 1, 50, 1);
        const charsField = createNumberField('Carry-forward characters', 'chatSessionContextChars', formState.config.chatSessionContextChars, 250, 25000, 50);
        const importField = createCheckboxField('Keep Import Project action visible', 'showImportProjectAction', formState.config.showImportProjectAction);

        [budgetField, speedField, approvalField, dailyCostField, turnsField, charsField, importField].forEach(field => configFields.appendChild(field));
        liveCard.appendChild(configFields);
        sectionBody.appendChild(liveCard);
      }

      function createSelectField(label, key, currentValue, options) {
        const field = document.createElement('label');
        field.className = 'config-field';
        const select = document.createElement('select');
        select.id = key;
        options.forEach(([value, text]) => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = text;
          if (value === currentValue) {
            option.selected = true;
          }
          select.appendChild(option);
        });
        select.addEventListener('change', event => {
          if (!(event.target instanceof HTMLSelectElement)) { return; }
          formState.config[key] = event.target.value;
          renderLiveSettings();
        });
        field.appendChild(Object.assign(document.createElement('span'), { textContent: label }));
        field.appendChild(select);
        return field;
      }

      function createNumberField(label, key, currentValue, min, max, step) {
        const field = document.createElement('label');
        field.className = 'config-field';
        const input = document.createElement('input');
        input.type = 'number';
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.value = String(currentValue);
        input.addEventListener('input', event => {
          if (!(event.target instanceof HTMLInputElement)) { return; }
          const parsed = Number(event.target.value);
          formState.config[key] = Number.isFinite(parsed) ? parsed : currentValue;
          renderLiveSettings();
        });
        field.appendChild(Object.assign(document.createElement('span'), { textContent: label }));
        field.appendChild(input);
        return field;
      }

      function createCheckboxField(label, key, currentValue) {
        const field = document.createElement('label');
        field.className = 'config-field checkbox-field';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = Boolean(currentValue);
        input.addEventListener('change', event => {
          if (!(event.target instanceof HTMLInputElement)) { return; }
          formState.config[key] = event.target.checked;
          renderLiveSettings();
        });
        const body = document.createElement('span');
        body.textContent = label;
        field.appendChild(input);
        field.appendChild(body);
        return field;
      }

      function renderForm() {
        formRoot.innerHTML = '';
        const section = sections.find(entry => entry.id === activeSection);
        if (!section) { return; }

        const sectionHeader = document.createElement('article');
        sectionHeader.className = 'section-card';
        sectionHeader.innerHTML = [
          '<div>',
          '<p class="section-kicker">' + section.kicker + '</p>',
          '<h2>' + section.label + '</h2>',
          '<p>' + section.description + '</p>',
          '</div>',
          '<div class="section-summary"><strong>' + section.summary + '</strong><span>' + answeredCount(section.id) + ' answered in this section.</span></div>',
        ].join('');
        formRoot.appendChild(sectionHeader);

        const questionGrid = document.createElement('div');
        questionGrid.className = 'question-grid';
        section.questions.forEach(question => questionGrid.appendChild(createInput(question)));
        formRoot.appendChild(questionGrid);

        if (section.id === 'operations') {
          renderOperationsControls(formRoot);
        }

        const footer = document.createElement('div');
        footer.className = 'section-footer';
        const previousIndex = Math.max(0, sectionOrder.indexOf(activeSection) - 1);
        const nextIndex = Math.min(sectionOrder.length - 1, sectionOrder.indexOf(activeSection) + 1);
        footer.innerHTML = [
          '<button type="button" class="ghost-button" id="previous-section">Previous</button>',
          '<div class="section-footer-copy"><strong>Skip freely.</strong><span>Leave fields blank or on auto if Atlas should keep its default behavior.</span></div>',
          '<div class="section-footer-actions">',
          '<button type="button" class="ghost-button" id="next-section">Next</button>',
          '<button type="button" class="ghost-button" id="save-global-footer">Save Global Default</button>',
          '<button type="button" class="solid-button" id="save-project-footer">Save Project Override</button>',
          '</div>',
        ].join('');
        formRoot.appendChild(footer);

        document.getElementById('previous-section')?.addEventListener('click', () => {
          activeSection = sectionOrder[previousIndex];
          render();
        });
        document.getElementById('next-section')?.addEventListener('click', () => {
          activeSection = sectionOrder[nextIndex];
          render();
        });
        document.getElementById('save-global-footer')?.addEventListener('click', () => saveProfile('global'));
        document.getElementById('save-project-footer')?.addEventListener('click', () => saveProfile('project'));
      }

      function saveProfile(scope) {
        vscode.postMessage({
          type: 'saveProfile',
          payload: {
            scope,
            answers: formState.profile.answers,
            config: formState.config,
          },
        });
      }

      function render() {
        renderOverview();
        renderLiveSettings();
        renderNav();
        renderForm();
        document.querySelectorAll('[data-command]').forEach(button => {
          button.addEventListener('click', event => {
            const target = event.currentTarget;
            if (!(target instanceof HTMLElement)) { return; }
            const command = target.dataset.command;
            if (!command) { return; }
            vscode.postMessage({ type: 'openCommand', payload: command });
          }, { once: true });
        });
        document.querySelectorAll('[data-open-file]').forEach(button => {
          button.addEventListener('click', event => {
            const target = event.currentTarget;
            if (!(target instanceof HTMLElement)) { return; }
            const fileTarget = target.dataset.openFile;
            if (fileTarget !== 'profileMarkdown' && fileTarget !== 'projectSoul') { return; }
            vscode.postMessage({ type: 'openProfileFile', payload: fileTarget });
          }, { once: true });
        });
      }

      window.addEventListener('message', event => {
        if (event.data?.type === 'saved') {
          if (saveStatus) {
            saveStatus.textContent = String(event.data.payload ?? 'Profile saved.');
            saveStatus.classList.add('visible');
          }
        }
      });

      render();
      vscode.postMessage({ type: 'ready' });
    `;
  }
}

function emptyProfileRecord(): PersonalityProfileRecord {
  return {
    version: 1,
    updatedAt: '',
    answers: Object.fromEntries(
      PROFILE_SECTIONS.flatMap(section => section.questions.map(question => [question.id, question.kind === 'select' ? 'auto' : ''])),
    ) as Partial<Record<ProfileAnswerId, string>>,
  };
}

function sanitizeAnswers(input: Partial<Record<ProfileAnswerId, string>>): Partial<Record<ProfileAnswerId, string>> {
  const next: Partial<Record<ProfileAnswerId, string>> = {};
  for (const [key, value] of Object.entries(input) as Array<[ProfileAnswerId, string]>) {
    if (!isProfileAnswerId(key)) {
      continue;
    }
    const normalized = typeof value === 'string' ? value.trim().slice(0, 2_000) : '';
    if (SELECT_ANSWER_IDS.has(key)) {
      next[key] = normalized.length > 0 ? normalized : 'auto';
      continue;
    }
    next[key] = normalized;
  }

  for (const section of PROFILE_SECTIONS) {
    for (const question of section.questions) {
      if (!(question.id in next)) {
        next[question.id] = question.kind === 'select' ? 'auto' : '';
      }
    }
  }

  return next;
}

function hasMeaningfulProfile(profile: PersonalityProfileRecord): boolean {
  return PROFILE_SECTIONS.some(section => section.questions.some(question => {
    const value = profile.answers[question.id];
    if (typeof value !== 'string') {
      return false;
    }
    const normalized = value.trim();
    if (!normalized) {
      return false;
    }
    return question.kind === 'select' ? normalized !== 'auto' : true;
  }));
}

function mergeProfileRecords(globalProfile: PersonalityProfileRecord, projectProfile: PersonalityProfileRecord): PersonalityProfileRecord {
  const answers: Partial<Record<ProfileAnswerId, string>> = {};

  for (const section of PROFILE_SECTIONS) {
    for (const question of section.questions) {
      const projectValue = projectProfile.answers[question.id];
      const globalValue = globalProfile.answers[question.id];
      answers[question.id] = resolveProfileAnswer(question, projectValue, globalValue);
    }
  }

  return {
    version: 1,
    updatedAt: projectProfile.updatedAt || globalProfile.updatedAt || '',
    answers,
  };
}

function resolveProfileAnswer(
  question: PersonalityQuestionDefinition,
  projectValue: string | undefined,
  globalValue: string | undefined,
): string {
  const normalizedProjectValue = typeof projectValue === 'string' ? projectValue.trim() : '';
  if (normalizedProjectValue && (question.kind !== 'select' || normalizedProjectValue !== 'auto')) {
    return normalizedProjectValue;
  }

  const normalizedGlobalValue = typeof globalValue === 'string' ? globalValue.trim() : '';
  if (normalizedGlobalValue && (question.kind !== 'select' || normalizedGlobalValue !== 'auto')) {
    return normalizedGlobalValue;
  }

  return question.kind === 'select' ? 'auto' : '';
}

function readConfigSnapshot(scope: ConfigSnapshotScope = 'effective'): ProfileConfigSnapshot {
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  return {
    budgetMode: normalizeBudgetMode(readScopedConfigValue(configuration, 'budgetMode', 'auto', scope)),
    speedMode: normalizeSpeedMode(readScopedConfigValue(configuration, 'speedMode', 'auto', scope)),
    toolApprovalMode: normalizeToolApprovalMode(readScopedConfigValue(configuration, 'toolApprovalMode', 'ask-on-write', scope)),
    dailyCostLimitUsd: clampNumber(readScopedConfigValue(configuration, 'dailyCostLimitUsd', 0, scope), 0, 1_000_000),
    chatSessionTurnLimit: clampNumber(readScopedConfigValue(configuration, 'chatSessionTurnLimit', 6, scope), 1, 50),
    chatSessionContextChars: clampNumber(readScopedConfigValue(configuration, 'chatSessionContextChars', 2500, scope), 250, 25_000),
    showImportProjectAction: Boolean(readScopedConfigValue(configuration, 'showImportProjectAction', true, scope)),
  };
}

function readScopedConfigValue<T>(
  configuration: vscode.WorkspaceConfiguration,
  key: keyof ConfigValueMap,
  fallback: T,
  scope: ConfigSnapshotScope,
): T {
  if (scope === 'effective') {
    return (configuration.get<T>(key, fallback) ?? fallback) as T;
  }

  const inspected = configuration.inspect<T>(key);
  if (!inspected) {
    return fallback;
  }

  if (scope === 'global') {
    return (inspected.globalValue ?? inspected.defaultValue ?? fallback) as T;
  }

  return (inspected.defaultValue ?? fallback) as T;
}

function detectEffectiveConfigSource(): EffectiveSettingsSource {
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const keys: Array<keyof ConfigValueMap> = [
    'budgetMode',
    'speedMode',
    'toolApprovalMode',
    'dailyCostLimitUsd',
    'chatSessionTurnLimit',
    'chatSessionContextChars',
    'showImportProjectAction',
  ];

  if (keys.some(key => configuration.inspect(key)?.workspaceValue !== undefined)) {
    return 'project';
  }
  if (keys.some(key => configuration.inspect(key)?.globalValue !== undefined)) {
    return 'global';
  }
  return 'default';
}

function normalizeBudgetMode(value: string | undefined): ConfigValueMap['budgetMode'] {
  return value === 'cheap' || value === 'balanced' || value === 'expensive' || value === 'auto' ? value : 'auto';
}

function normalizeSpeedMode(value: string | undefined): ConfigValueMap['speedMode'] {
  return value === 'fast' || value === 'balanced' || value === 'considered' || value === 'auto' ? value : 'auto';
}

function normalizeToolApprovalMode(value: string | undefined): ConfigValueMap['toolApprovalMode'] {
  return value === 'always-ask' || value === 'ask-on-write' || value === 'ask-on-external' || value === 'allow-safe-readonly'
    ? value
    : 'ask-on-write';
}

function clampNumber(value: number | undefined, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  const numericValue = value ?? min;
  return Math.min(max, Math.max(min, Math.round(numericValue)));
}

function normalizeSsotPath(input: string | undefined): string | undefined {
  const raw = (input ?? DEFAULT_SSOT_PATH).trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!raw || raw.startsWith('/') || /^[A-Za-z]:/.test(raw) || raw.includes('..')) {
    return undefined;
  }
  return raw;
}

async function readTextIfExists(uri: vscode.Uri): Promise<string> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf-8');
  } catch {
    return '';
  }
}

async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function deleteUriIfExists(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.delete(uri);
  } catch {
    // Ignore missing generated artifacts.
  }
}

function isPersonalityProfileRecord(value: unknown): value is PersonalityProfileRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate['version'] === 1
    && typeof candidate['updatedAt'] === 'string'
    && typeof candidate['answers'] === 'object'
    && candidate['answers'] !== null;
}

function isPersonalityProfileMessage(value: unknown): value is PersonalityProfileMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate['type'] === 'ready') {
    return true;
  }
  if (candidate['type'] === 'revertProjectToGlobal') {
    return true;
  }
  if (candidate['type'] === 'openCommand') {
    return candidate['payload'] === 'atlasmind.openSettings'
      || candidate['payload'] === 'atlasmind.openSettingsChat'
      || candidate['payload'] === 'atlasmind.openSettingsModels'
      || candidate['payload'] === 'atlasmind.openSettingsSafety'
      || candidate['payload'] === 'atlasmind.openSettingsProject'
      || candidate['payload'] === 'atlasmind.openCostDashboard'
      || candidate['payload'] === 'atlasmind.openProjectDashboard'
      || candidate['payload'] === 'atlasmind.openGettingStarted';
  }
  if (candidate['type'] === 'openProfileFile') {
    return candidate['payload'] === 'profileMarkdown' || candidate['payload'] === 'projectSoul';
  }
  if (candidate['type'] !== 'saveProfile' || typeof candidate['payload'] !== 'object' || candidate['payload'] === null) {
    return false;
  }
  const payload = candidate['payload'] as Record<string, unknown>;
  return (payload['scope'] === 'global' || payload['scope'] === 'project')
    && isRecordOfStrings(payload['answers'])
    && isConfigValueMap(payload['config']);
}

function isConfigValueMap(value: unknown): value is ConfigValueMap {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return normalizeBudgetMode(typeof candidate['budgetMode'] === 'string' ? candidate['budgetMode'] : undefined) === candidate['budgetMode']
    && normalizeSpeedMode(typeof candidate['speedMode'] === 'string' ? candidate['speedMode'] : undefined) === candidate['speedMode']
    && normalizeToolApprovalMode(typeof candidate['toolApprovalMode'] === 'string' ? candidate['toolApprovalMode'] : undefined) === candidate['toolApprovalMode']
    && typeof candidate['dailyCostLimitUsd'] === 'number'
    && typeof candidate['chatSessionTurnLimit'] === 'number'
    && typeof candidate['chatSessionContextChars'] === 'number'
    && typeof candidate['showImportProjectAction'] === 'boolean';
}

function isRecordOfStrings(value: unknown): value is Partial<Record<ProfileAnswerId, string>> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return Object.entries(value as Record<string, unknown>).every(([key, entry]) => isProfileAnswerId(key) && typeof entry === 'string');
}

function isProfileAnswerId(value: string): value is ProfileAnswerId {
  return PROFILE_SECTIONS.some(section => section.questions.some(question => question.id === value));
}

function buildProfileMarkdown(profile: PersonalityProfileRecord, config: ConfigValueMap): string {
  const lines = [
    '# Atlas Personality Profile',
    '',
    '> Guided operator profile for Atlas in this workspace.',
    '',
    `- Updated: ${profile.updatedAt || new Date().toISOString()}`,
    `- Budget mode: ${config.budgetMode}`,
    `- Speed mode: ${config.speedMode}`,
    `- Tool approval mode: ${config.toolApprovalMode}`,
    `- Daily cost limit: ${config.dailyCostLimitUsd > 0 ? `$${config.dailyCostLimitUsd.toFixed(2)}` : 'disabled'}`,
    `- Chat carry-forward: ${config.chatSessionTurnLimit} turns / ${config.chatSessionContextChars} chars`,
    `- Show Import Project action: ${config.showImportProjectAction ? 'yes' : 'no'}`,
    '',
  ];

  for (const section of PROFILE_SECTIONS) {
    lines.push(`## ${section.label}`);
    lines.push('');
    for (const question of section.questions) {
      const answer = profile.answers[question.id] ?? (question.kind === 'select' ? 'auto' : '');
      lines.push(`- **${question.label}:** ${answer.trim().length > 0 ? answer : 'Not set'}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}

function upsertProjectSoulSection(existing: string, profile: PersonalityProfileRecord, config: ConfigValueMap): string {
  const section = [
    PROJECT_SOUL_MARKER_START,
    '## Atlas Personality Profile',
    '',
    `- Profile updated: ${profile.updatedAt || new Date().toISOString()}`,
    `- Operating defaults: budget=${config.budgetMode}, speed=${config.speedMode}, approval=${config.toolApprovalMode}`,
    `- Memory sync: guided profile stored in \`agents/${PROFILE_MARKDOWN_FILE}\` and \`agents/${PROFILE_JSON_FILE}\`.`,
    `- North star: ${fallbackAnswer(profile.answers.northStar, 'Use the safest path that still moves the work forward.')}`,
    `- Primary purpose: ${fallbackAnswer(profile.answers.primaryPurpose, 'Not specified yet.')}`,
    `- Optimize for: ${fallbackAnswer(profile.answers.optimiseFor, 'Inherit current Atlas defaults.')}`,
    `- Red lines: ${fallbackAnswer(profile.answers.neverExhibit, 'Follow repository safety rules and explicit approvals.')}`,
    PROJECT_SOUL_MARKER_END,
  ].join('\n');

  if (!existing.trim()) {
    return `# Project Soul\n\n> This file is the living identity of the project.\n\n${section}\n`;
  }

  if (existing.includes(PROJECT_SOUL_MARKER_START) && existing.includes(PROJECT_SOUL_MARKER_END)) {
    return existing.replace(new RegExp(`${escapeForRegex(PROJECT_SOUL_MARKER_START)}[\\s\\S]*?${escapeForRegex(PROJECT_SOUL_MARKER_END)}`), section);
  }

  return `${existing.trimEnd()}\n\n${section}\n`;
}

function removeProjectSoulSection(existing: string): string {
  if (!existing.includes(PROJECT_SOUL_MARKER_START) || !existing.includes(PROJECT_SOUL_MARKER_END)) {
    return existing;
  }

  const withoutSection = existing.replace(new RegExp(`${escapeForRegex(PROJECT_SOUL_MARKER_START)}[\\s\\S]*?${escapeForRegex(PROJECT_SOUL_MARKER_END)}\n?`, 'g'), '').replace(/\n{3,}/g, '\n\n');
  return `${withoutSection.trimEnd()}\n`;
}

function fallbackAnswer(value: string | undefined, fallback: string): string {
  if (!value || !value.trim() || value === 'auto') {
    return fallback;
  }
  return value.trim();
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function serializeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function countAnsweredQuestions(answers: Partial<Record<ProfileAnswerId, string>>): string {
  const count = Object.values(answers).filter(value => typeof value === 'string' && value.trim().length > 0 && value !== 'auto').length;
  return `${count}`;
}

function formatRelativeLabel(timestamp: string): string {
  const deltaMs = Date.now() - new Date(timestamp).getTime();
  if (!Number.isFinite(deltaMs)) {
    return 'just now';
  }
  const deltaMinutes = Math.round(deltaMs / 60000);
  if (deltaMinutes <= 1) {
    return 'just now';
  }
  if (deltaMinutes < 60) {
    return `${deltaMinutes} min ago`;
  }
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours} hr ago`;
  }
  const deltaDays = Math.round(deltaHours / 24);
  return `${deltaDays} day${deltaDays === 1 ? '' : 's'} ago`;
}

function describeLiveDefaults(config: ProfileConfigSnapshot): string {
  const costLabel = config.dailyCostLimitUsd > 0 ? `$${config.dailyCostLimitUsd.toFixed(2)} daily cap` : 'no daily cap';
  return `${config.budgetMode} budget, ${config.speedMode} speed, ${config.toolApprovalMode}, ${costLabel}`;
}

function describeEffectiveProfileSource(source: EffectiveSettingsSource): string {
  if (source === 'project') {
    return 'Project overrides active';
  }
  if (source === 'global') {
    return 'Using global defaults';
  }
  return 'Using Atlas defaults';
}

function describeEffectiveConfigSource(source: EffectiveSettingsSource): string {
  if (source === 'project') {
    return 'Workspace settings in effect';
  }
  if (source === 'global') {
    return 'User settings in effect';
  }
  return 'Built-in defaults in effect';
}

function getExtraCss(): string {
  return `
    :root {
      --atlas-ink: color-mix(in srgb, var(--vscode-foreground) 88%, #d9cfbb 12%);
      --atlas-muted: color-mix(in srgb, var(--vscode-descriptionForeground, var(--vscode-foreground)) 82%, #c5baa4 18%);
      --atlas-panel: linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background) 88%, #c18f52 12%), color-mix(in srgb, var(--vscode-sideBar-background, var(--vscode-editor-background)) 94%, #102127 6%));
      --atlas-panel-soft: color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-editor-background)) 88%, #efe2c6 12%);
      --atlas-border: color-mix(in srgb, var(--vscode-widget-border, #4d4d4d) 72%, #d2a76a 28%);
      --atlas-accent: #c98d4d;
      --atlas-accent-strong: #dfb26a;
      --atlas-accent-deep: #6f4420;
      --atlas-teal: #5e8b88;
      --atlas-danger: #b45f55;
      --atlas-shadow: 0 18px 50px rgba(0, 0, 0, 0.24);
    }
    body {
      padding: 0;
      color: var(--atlas-ink);
      background:
        radial-gradient(circle at top left, rgba(201, 141, 77, 0.16), transparent 28%),
        radial-gradient(circle at bottom right, rgba(94, 139, 136, 0.14), transparent 22%),
        linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background) 96%, #0f1719 4%), color-mix(in srgb, var(--vscode-editor-background) 88%, #0c1113 12%));
      font-family: "Segoe UI Variable Text", "Aptos", "Georgia", serif;
    }
    .personality-shell {
      padding: 24px;
      display: grid;
      gap: 18px;
    }
    .hero-card,
    .status-card,
    .workspace-note,
    .overview-card,
    .section-card,
    .settings-card,
    .settings-form-card,
    .question-card {
      border: 1px solid var(--atlas-border);
      border-radius: 22px;
      background: var(--atlas-panel-soft);
      box-shadow: var(--atlas-shadow);
    }
    .hero-card {
      display: grid;
      grid-template-columns: 1.7fr 1fr;
      gap: 20px;
      padding: 24px;
      background: var(--atlas-panel);
      position: relative;
      overflow: hidden;
    }
    .hero-card::after {
      content: '';
      position: absolute;
      inset: auto -40px -50px auto;
      width: 180px;
      height: 180px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(223, 178, 106, 0.3), transparent 68%);
      pointer-events: none;
    }
    .hero-kicker,
    .section-kicker,
    .status-label {
      margin: 0 0 6px;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      font-size: 0.72rem;
      color: var(--atlas-muted);
    }
    .nav-kicker {
      margin: 0;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 0.68rem;
      color: color-mix(in srgb, var(--atlas-muted) 92%, var(--atlas-ink) 8%);
      line-height: 1.15;
    }
    .hero-card h1,
    .section-card h2,
    .overview-card h2,
    .settings-card h2 {
      margin: 0;
      line-height: 1.02;
      font-family: "Aptos Display", "Segoe UI Variable Display", "Georgia", serif;
    }
    .hero-card h1 { font-size: 2.4rem; }
    .hero-copy {
      margin: 12px 0 0;
      max-width: 76ch;
      color: var(--atlas-muted);
    }
    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 10px;
      align-content: flex-start;
    }
    .solid-button,
    .ghost-button,
    .nav-button,
    .section-footer button {
      border-radius: 999px;
      border: 1px solid var(--atlas-border);
      padding: 10px 14px;
      font: inherit;
      cursor: pointer;
      transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
    }
    .solid-button {
      background: linear-gradient(135deg, var(--atlas-accent), var(--atlas-accent-deep));
      color: #fdf7ef;
    }
    .ghost-button {
      background: color-mix(in srgb, var(--vscode-editor-background) 70%, transparent);
      color: var(--atlas-ink);
    }
    .solid-button:hover,
    .ghost-button:hover,
    .nav-button:hover,
    .section-footer button:hover {
      transform: translateY(-1px);
    }
    .status-strip {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }
    .status-card {
      padding: 16px 18px;
      display: grid;
      gap: 6px;
    }
    .status-card strong { font-size: 1.05rem; }
    .status-card span:last-child { color: var(--atlas-muted); }
    .workspace-note {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 18px;
      align-items: center;
      background: color-mix(in srgb, var(--atlas-panel-soft) 80%, #113438 20%);
    }
    .workspace-note.warn {
      background: color-mix(in srgb, var(--atlas-panel-soft) 78%, #53331d 22%);
    }
    .workspace-note span { color: var(--atlas-muted); }
    .save-status {
      opacity: 0;
      transform: translateY(-4px);
      transition: opacity 180ms ease, transform 180ms ease;
      color: var(--atlas-muted);
    }
    .save-status.visible {
      opacity: 1;
      transform: translateY(0);
    }
    .profile-layout {
      display: grid;
      grid-template-columns: minmax(220px, 270px) minmax(0, 1fr);
      gap: 18px;
      align-items: start;
    }
    .profile-nav {
      position: sticky;
      top: 18px;
      display: grid;
      gap: 10px;
    }
    .nav-button {
      text-align: left;
      padding: 14px 16px;
      background: color-mix(in srgb, var(--vscode-sideBar-background, var(--vscode-editor-background)) 82%, #183138 18%);
      display: grid;
      gap: 6px;
      align-content: center;
    }
    .nav-button strong {
      line-height: 1.12;
      font-size: 1.02rem;
    }
    .nav-button small {
      color: var(--atlas-muted);
      line-height: 1.2;
    }
    .nav-button.active {
      background: linear-gradient(180deg, rgba(201, 141, 77, 0.24), rgba(94, 139, 136, 0.18));
      border-color: color-mix(in srgb, var(--atlas-accent-strong) 55%, var(--atlas-border) 45%);
    }
    .profile-main,
    .questionnaire {
      display: grid;
      gap: 16px;
    }
    .overview-card,
    .section-card,
    .settings-card,
    .settings-form-card {
      padding: 20px;
    }
    .overview-card {
      display: grid;
      gap: 16px;
    }
    .overview-actions,
    .overview-metrics {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }
    .metric-pill {
      min-width: 120px;
      padding: 10px 12px;
      border-radius: 16px;
      background: color-mix(in srgb, var(--vscode-editor-background) 75%, transparent);
      display: grid;
      gap: 4px;
      border: 1px solid color-mix(in srgb, var(--atlas-border) 80%, transparent);
    }
    .metric-pill span,
    .question-head small,
    .section-summary span,
    .config-field span,
    .settings-tile small,
    .section-footer-copy span {
      color: var(--atlas-muted);
    }
    .settings-grid {
      margin-top: 14px;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }
    .settings-tile {
      padding: 12px;
      border-radius: 16px;
      background: color-mix(in srgb, var(--vscode-editor-background) 72%, transparent);
      border: 1px solid color-mix(in srgb, var(--atlas-border) 78%, transparent);
      display: grid;
      gap: 4px;
    }
    .settings-link-tile {
      width: 100%;
      text-align: left;
      font: inherit;
      color: var(--atlas-ink);
      cursor: pointer;
      transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
    }
    .settings-link-tile:hover {
      transform: translateY(-1px);
      border-color: color-mix(in srgb, var(--atlas-accent-strong) 40%, var(--atlas-border) 60%);
      background: color-mix(in srgb, var(--vscode-editor-background) 64%, rgba(201, 141, 77, 0.12) 36%);
    }
    .settings-link-tile em {
      margin-top: 6px;
      font-style: normal;
      font-size: 0.8rem;
      color: var(--atlas-accent-strong);
    }
    .question-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }
    .question-card {
      padding: 16px;
      display: grid;
      gap: 12px;
      animation: card-in 220ms ease;
    }
    .question-card textarea,
    .question-card select,
    .config-field select,
    .config-field input[type="number"] {
      width: 100%;
      border-radius: 14px;
      border: 1px solid color-mix(in srgb, var(--atlas-border) 82%, transparent);
      background: color-mix(in srgb, var(--vscode-input-background, var(--vscode-editor-background)) 86%, transparent);
      color: var(--atlas-ink);
      padding: 12px 14px;
      font: inherit;
      resize: vertical;
      box-sizing: border-box;
    }
    .question-card textarea { min-height: 110px; }
    .quick-fill-row {
      display: grid;
      gap: 8px;
    }
    .quick-fill-label {
      font-size: 0.76rem;
      font-weight: 700;
      color: var(--atlas-muted);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .inline-link-button {
      appearance: none;
      border: 0;
      padding: 0;
      background: transparent;
      color: var(--atlas-accent-strong);
      text-decoration: underline;
      text-underline-offset: 2px;
      font: inherit;
      cursor: pointer;
    }
    .inline-link-button:hover {
      color: var(--atlas-ink);
    }
    .question-head {
      display: grid;
      gap: 6px;
    }
    .question-head span,
    .settings-form-head span,
    .section-summary strong,
    .config-field > span,
    .settings-tile strong,
    .section-footer-copy strong {
      font-weight: 700;
    }
    .settings-form-card {
      display: grid;
      gap: 16px;
      background: linear-gradient(180deg, rgba(94, 139, 136, 0.16), rgba(201, 141, 77, 0.12));
    }
    .settings-form-head {
      display: grid;
      gap: 4px;
    }
    .config-fields {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .config-field {
      display: grid;
      gap: 8px;
    }
    .checkbox-field {
      grid-template-columns: auto 1fr;
      align-items: center;
      gap: 10px;
      padding: 14px;
      border-radius: 16px;
      background: color-mix(in srgb, var(--vscode-editor-background) 75%, transparent);
      border: 1px solid color-mix(in srgb, var(--atlas-border) 78%, transparent);
    }
    .checkbox-field input {
      width: 18px;
      height: 18px;
      accent-color: var(--atlas-teal);
    }
    .section-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .section-footer-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    @keyframes card-in {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @media (max-width: 1100px) {
      .hero-card,
      .profile-layout,
      .question-grid,
      .config-fields,
      .settings-grid {
        grid-template-columns: 1fr;
      }
      .profile-nav {
        position: static;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .status-strip { grid-template-columns: 1fr; }
      .workspace-note,
      .section-footer {
        flex-direction: column;
        align-items: flex-start;
      }
      .hero-actions { justify-content: flex-start; }
    }
    @media (max-width: 720px) {
      .personality-shell { padding: 16px; }
      .profile-nav { grid-template-columns: 1fr; }
      .overview-actions,
      .overview-metrics,
      .section-footer-actions { width: 100%; }
      .solid-button,
      .ghost-button,
      .nav-button,
      .section-footer button { width: 100%; }
    }
  `;
}