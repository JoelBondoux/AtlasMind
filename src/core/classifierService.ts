/**
 * ClassifierService — replaces per-feature regex heuristics with a single
 * batched LLM call that answers all routing questions at once.
 *
 * Design:
 *  - One call per request, answered by the cheapest available model via the
 *    existing `completeMaintenance` path (local-first, free/subscription preferred).
 *  - The system prompt is prompt-cached across calls; only the ~50-token user
 *    prompt and ~30-token answer vary per request.
 *  - Every answer has a regex fallback so the service degrades gracefully when
 *    no model is available or the response is malformed.
 *  - Callers receive a `ClassificationResult` struct; the orchestrator and
 *    participant replace their regex tests with field lookups.
 */

import type { SpecialistDomain, TaskModality, TaskReasoning } from '../types.js';
import type { ModelRouter } from './modelRouter.js';
import type { ProviderRegistry } from '../providers/index.js';
import type { TaskProfiler } from './taskProfiler.js';

// ── Routing-need IDs (mirrors CommonRoutingNeedId in orchestrator) ──────────
export type RoutingNeedId =
  | 'architecture'
  | 'backend'
  | 'build'
  | 'debugging'
  | 'devops'
  | 'docs'
  | 'frontend'
  | 'git'
  | 'package'
  | 'performance'
  | 'release'
  | 'review'
  | 'security'
  | 'testing';

// ── Workspace execution bias ─────────────────────────────────────────────────
export type WorkspaceBias = 'investigate' | 'act' | 'none';

// ── Natural-language UI command IDs ─────────────────────────────────────────
export type UiCommandId =
  | 'openSettings'
  | 'openSettingsChat'
  | 'openSettingsModels'
  | 'openSettingsSafety'
  | 'openSettingsProject'
  | 'openSettingsAdvanced'
  | 'openPersonalityProfile'
  | 'openCostDashboard'
  | 'showCostSummary'
  | 'openProjectRunCenter'
  | 'openProjectDashboard'
  | 'openProjectIdeation'
  | 'openModelProviders'
  | 'openVoicePanel'
  | 'openVisionPanel'
  | 'openSpecialistIntegrations'
  | 'openMcpServers'
  | 'openAgents'
  | 'openSkills'
  | 'openMemory';

export interface ClassificationResult {
  /** Specialist workflow domain, or null if none applies. */
  specialistDomain: SpecialistDomain | null;
  /** Which engineering sub-domains this request touches (may be empty). */
  routingNeeds: RoutingNeedId[];
  /** Primary content modality for model capability selection. */
  modality: TaskModality;
  /** Reasoning depth hint for model tier selection. */
  reasoning: TaskReasoning;
  /** Whether the request needs workspace investigation, direct action, or neither. */
  workspaceBias: WorkspaceBias;
  /** If the prompt maps to a UI panel command, the command ID; otherwise null. */
  uiCommand: UiCommandId | null;
}

// ── Constants ────────────────────────────────────────────────────────────────
const SPECIALIST_DOMAIN_VALUES: readonly SpecialistDomain[] = [
  'media-generation', 'visual-analysis', 'voice', 'research', 'robotics', 'simulation',
];

const ROUTING_NEED_VALUES: readonly RoutingNeedId[] = [
  'architecture', 'backend', 'build', 'debugging', 'devops', 'docs',
  'frontend', 'git', 'package', 'performance', 'release', 'review', 'security', 'testing',
];

const UI_COMMAND_VALUES: readonly UiCommandId[] = [
  'openSettings', 'openSettingsChat', 'openSettingsModels', 'openSettingsSafety',
  'openSettingsProject', 'openSettingsAdvanced', 'openPersonalityProfile',
  'openCostDashboard', 'showCostSummary', 'openProjectRunCenter', 'openProjectDashboard',
  'openProjectIdeation', 'openModelProviders', 'openVoicePanel', 'openVisionPanel',
  'openSpecialistIntegrations', 'openMcpServers', 'openAgents', 'openSkills', 'openMemory',
];

// ── System prompt (prompt-cached across all calls) ───────────────────────────
const CLASSIFIER_SYSTEM_PROMPT = `You are a routing classifier for an AI coding assistant. Given a user prompt, answer five questions. Reply ONLY with a single JSON object — no prose, no markdown fences.

Schema (all fields required):
{
  "specialistDomain": "<one of: media-generation | visual-analysis | voice | research | robotics | simulation | null>",
  "routingNeeds": ["<zero or more of: architecture | backend | build | debugging | devops | docs | frontend | git | package | performance | release | review | security | testing>"],
  "modality": "<one of: code | vision | text | mixed>",
  "reasoning": "<one of: high | medium | low>",
  "workspaceBias": "<one of: investigate | act | none>",
  "uiCommand": "<one of: openSettings | openSettingsChat | openSettingsModels | openSettingsSafety | openSettingsProject | openSettingsAdvanced | openPersonalityProfile | openCostDashboard | showCostSummary | openProjectRunCenter | openProjectDashboard | openProjectIdeation | openModelProviders | openVoicePanel | openVisionPanel | openSpecialistIntegrations | openMcpServers | openAgents | openSkills | openMemory | null>"
}

Definitions:
- specialistDomain: non-null only if the prompt is PRIMARILY about that specialist workflow (e.g. generating an image, running a voice pipeline, deep web research, robotics control, simulation modelling). Most coding prompts are null.
- routingNeeds: engineering sub-domains that would benefit a specialist agent. Can be multiple. Empty array if none apply.
- modality: "code" if the main content involves source code or software artefacts; "vision" if it involves images/screenshots; "mixed" if both; "text" for everything else.
- reasoning: "high" for architecture, design, security audit, root-cause, complex trade-offs; "medium" for explain/implement/fix/build; "low" for short factual or simple lookup. Simple git operations (commit, push, pull, stash, checkout) are always "low" even when the conversation has covered complex topics.
- workspaceBias: "investigate" if the prompt asks about a bug, broken behavior, or unknown state that requires reading files/logs; "act" if the prompt asks to make a concrete change, commit, deploy, or fix something; "none" for questions, explanations, or advice-only.
- uiCommand: non-null only when the prompt is clearly asking to open a specific AtlasMind panel or UI view. Most prompts are null.

Reply with JSON only.`;

// ── Regex fallbacks (used when LLM call fails) ───────────────────────────────

const FB_RESEARCH = /\b(?:research|deep\s+research|web\s+research|market\s+research|literature\s+review|find\s+sources|papers?|citations?)\b/i;
const FB_VOICE = /\b(?:voice|speech|tts|stt|text-to-speech|speech-to-text|transcrib|dictate|narrate)\b/i;
const FB_MEDIA_GEN = /\b(?:generate|create|make|design)\b.{0,60}\b(?:image|video|logo|icon|illustration|animation)\b/i;
const FB_VISUAL = /\b(?:analyze|describe|inspect|identify)\b.{0,60}\b(?:image|screenshot|photo|diagram)\b/i;
const FB_ROBOTICS = /\b(?:robot|robotic|ros\d?|kinematics|trajectory|actuator|motion.planning)\b/i;
const FB_SIMULATION = /\b(?:simulate|simulation|monte.carlo|what-if|scenario.model)\b/i;

const FB_CODE = /\b(?:code|typescript|javascript|python|java|rust|sql|html|css|react|api|function|class|module|test|build|compile|debug|bug|patch|fix|refactor|deploy)\b/i;
const FB_VISION_MOD = /\b(?:image|screenshot|photo|diagram|figure|ocr|visual|canvas)\b/i;
const FB_HIGH_REASON = /\b(?:architecture|design.pattern|trade-off|security.audit|root.cause|algorithm|optimize|concurrency|distributed)\b/i;
const FB_MED_REASON = /\b(?:explain|implement|fix|update|build|configure|deploy|create|refactor)\b/i;

const FB_INVESTIGATE = /\b(?:bug|broken|failing|not.working|regression|issue|problem|why|sidebar|dropdown|layout|overflow)\b/i;
const FB_ACT = /\b(?:fix|patch|implement|add|create|delete|update|refactor|commit|deploy|push|merge)\b/i;

const FB_ROUTING: Array<{ id: RoutingNeedId; pattern: RegExp }> = [
  { id: 'debugging', pattern: /\b(?:debug|diagnos|root.cause|why.is|failing|error|bug|fix)\b/i },
  { id: 'testing', pattern: /\b(?:test|coverage|vitest|jest|cypress|playwright|regression.test)\b/i },
  { id: 'build', pattern: /\b(?:build|compile|bundle|webpack|vite|esbuild|build.error)\b/i },
  { id: 'frontend', pattern: /\b(?:frontend|ui|ux|css|react|component|layout|webview)\b/i },
  { id: 'backend', pattern: /\b(?:backend|api|endpoint|server|database|sql|orm)\b/i },
  { id: 'security', pattern: /\b(?:security|auth|vulnerability|xss|csrf|injection|owasp)\b/i },
  { id: 'devops', pattern: /\b(?:ci|cd|deploy|docker|kubernetes|pipeline|terraform)\b/i },
  { id: 'git', pattern: /\b(?:commit|push|merge|rebase|branch|checkout|pull.request|pr\b)\b/i },
  { id: 'package', pattern: /\b(?:npm|yarn|pip|cargo|install|dependency|package\.json)\b/i },
  { id: 'performance', pattern: /\b(?:performance|slow|latency|optimize|memory.leak)\b/i },
  { id: 'architecture', pattern: /\b(?:architecture|system.design|design.pattern|refactor.architecture)\b/i },
  { id: 'docs', pattern: /\b(?:readme|docs|documentation|changelog|wiki)\b/i },
  { id: 'review', pattern: /\b(?:code.review|pull.request|pr\b|feedback|audit)\b/i },
  { id: 'release', pattern: /\b(?:release|version|publish|semver|changelog)\b/i },
  { id: 'testing', pattern: /\b(?:test|unit.test|e2e|coverage)\b/i },
];

function regexFallback(prompt: string, hasImageAttachment: boolean): ClassificationResult {
  const p = prompt.toLowerCase();

  let specialistDomain: SpecialistDomain | null = null;
  if (FB_MEDIA_GEN.test(p)) { specialistDomain = 'media-generation'; }
  else if (hasImageAttachment || FB_VISUAL.test(p)) { specialistDomain = 'visual-analysis'; }
  else if (FB_VOICE.test(p)) { specialistDomain = 'voice'; }
  else if (FB_RESEARCH.test(p)) { specialistDomain = 'research'; }
  else if (FB_ROBOTICS.test(p)) { specialistDomain = 'robotics'; }
  else if (FB_SIMULATION.test(p)) { specialistDomain = 'simulation'; }

  const routingNeeds: RoutingNeedId[] = [];
  const seen = new Set<RoutingNeedId>();
  for (const { id, pattern } of FB_ROUTING) {
    if (!seen.has(id) && pattern.test(p)) {
      routingNeeds.push(id);
      seen.add(id);
    }
  }

  const hasVision = hasImageAttachment || FB_VISION_MOD.test(p);
  const hasCode = FB_CODE.test(p);
  const modality: TaskModality = hasVision && hasCode ? 'mixed' : hasVision ? 'vision' : hasCode ? 'code' : 'text';

  const reasoning: TaskReasoning = FB_HIGH_REASON.test(p) ? 'high' : FB_MED_REASON.test(p) ? 'medium' : 'low';

  const workspaceBias: WorkspaceBias = FB_INVESTIGATE.test(p)
    ? 'investigate'
    : FB_ACT.test(p) ? 'act' : 'none';

  return { specialistDomain, routingNeeds, modality, reasoning, workspaceBias, uiCommand: null };
}

function parseClassifierResponse(raw: string, hasImageAttachment: boolean): ClassificationResult | null {
  try {
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) {
      return null;
    }
    const obj = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;

    const specialistDomain = SPECIALIST_DOMAIN_VALUES.includes(obj['specialistDomain'] as SpecialistDomain)
      ? (obj['specialistDomain'] as SpecialistDomain)
      : null;

    const rawNeeds = Array.isArray(obj['routingNeeds']) ? obj['routingNeeds'] : [];
    const routingNeeds = rawNeeds
      .filter((n): n is string => typeof n === 'string')
      .filter((n): n is RoutingNeedId => ROUTING_NEED_VALUES.includes(n as RoutingNeedId));

    const rawModality = obj['modality'];
    const modality: TaskModality = (rawModality === 'code' || rawModality === 'vision' || rawModality === 'mixed')
      ? rawModality
      : hasImageAttachment ? 'vision' : 'text';

    const rawReasoning = obj['reasoning'];
    const reasoning: TaskReasoning = (rawReasoning === 'high' || rawReasoning === 'low') ? rawReasoning : 'medium';

    const rawBias = obj['workspaceBias'];
    const workspaceBias: WorkspaceBias = (rawBias === 'investigate' || rawBias === 'act') ? rawBias : 'none';

    const rawCmd = obj['uiCommand'];
    const uiCommand = typeof rawCmd === 'string' && UI_COMMAND_VALUES.includes(rawCmd as UiCommandId)
      ? (rawCmd as UiCommandId)
      : null;

    return { specialistDomain, routingNeeds, modality, reasoning, workspaceBias, uiCommand };
  } catch {
    return null;
  }
}

type CompletionProvider = {
  complete(request: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    maxTokens: number;
    temperature: number;
  }): Promise<{ content: string }>;
};

function resolveProvider(model: string, router: ModelRouter, providers: ProviderRegistry, fallback: string): CompletionProvider | undefined {
  const metaProvider = router.getModelInfo(model)?.provider ?? fallback;
  return providers.get(metaProvider) as CompletionProvider | undefined;
}

export class ClassifierService {
  constructor(
    private readonly modelRouter: ModelRouter,
    private readonly providers: ProviderRegistry,
    private readonly taskProfiler: TaskProfiler,
  ) {}

  /**
   * Classify a user prompt, answering all routing questions in one model call.
   * Always returns a valid result — falls back to regex if the model call fails.
   */
  async classify(
    userMessage: string,
    options: { hasImageAttachment?: boolean } = {},
  ): Promise<ClassificationResult> {
    const hasImageAttachment = options.hasImageAttachment ?? false;
    const trimmed = userMessage.trim();
    if (!trimmed) {
      return regexFallback('', hasImageAttachment);
    }

    const constraints = { budget: 'cheap', speed: 'fast' };
    const profile = this.taskProfiler.profileTask({
      userMessage: trimmed,
      phase: 'maintenance',
      requiresTools: false,
    });
    const model = this.modelRouter.selectModel(constraints as Parameters<ModelRouter['selectModel']>[0], undefined, profile);

    // Skip the LLM call when only the local echo/fallback provider is available —
    // it will never return valid JSON, so fall straight to regex.
    const resolvedProvider = this.modelRouter.getModelInfo(model)?.provider;
    if (!resolvedProvider || resolvedProvider === 'local') {
      return regexFallback(trimmed, hasImageAttachment);
    }

    const provider = resolveProvider(model, this.modelRouter, this.providers, resolvedProvider);

    if (!provider) {
      return regexFallback(trimmed, hasImageAttachment);
    }

    const promptSuffix = hasImageAttachment ? '\n(Note: the user has attached an image.)' : '';
    try {
      const response = await provider.complete({
        model,
        messages: [
          { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
          { role: 'user', content: `Prompt: ${trimmed.slice(0, 800)}${promptSuffix}` },
        ],
        maxTokens: 256,
        temperature: 0,
      });

      const parsed = parseClassifierResponse(response.content, hasImageAttachment);
      if (parsed) {
        return parsed;
      }
    } catch {
      // Fall through to regex fallback
    }

    return regexFallback(trimmed, hasImageAttachment);
  }
}
