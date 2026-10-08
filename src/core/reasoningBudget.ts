/**
 * Reasoning budget — the third routing axis, beside budget and speed.
 *
 * Budget says what a turn may cost; speed says how long it may take. Neither
 * says how hard the model should *think*, and for a model that thinks before it
 * answers that is the largest lever on both: the same model at a higher effort
 * spends more tokens, takes longer and gets more right on hard problems. Before
 * this module existed the only way to buy depth was to buy a different model.
 *
 * Six rules, most of them about what this must not claim.
 *
 * 1. **The level comes from a declared table, never a model.** `auto` maps the
 *    profiler's reasoning tier through `AUTO_REASONING_RULES`; the other three
 *    preferences are the operator's explicit choice. Every resolution names the
 *    rule that produced it, so a routing explanation can say *why deep*.
 * 2. **A parameter is sent only to a model declared capable on its own
 *    provider.** The declaration lives in `modelCatalog.ts`
 *    (`REASONING_CONTROL_CATALOG`), read from each vendor's published request
 *    shape; `planReasoningRequest` re-checks that the control belongs to the
 *    model's provider, so a Claude row reached through another vendor's endpoint
 *    can never carry Anthropic's parameter there. Everything else is
 *    `not-sent`, with the reason named.
 * 3. **Unknown is routable, never preferred.** A model with no declared control
 *    stays a candidate — the axis must not starve a provider whose catalog is
 *    behind — but it earns none of the depth bonus, because a bonus resting on a
 *    capability nobody verified is a guess wearing a score.
 * 4. **Thinking is output, and the estimate says so.** Every vendor wired here
 *    bills thinking tokens at the output rate (Anthropic's effort page, OpenAI's
 *    reasoning guide, Google's pricing table "Output price (including thinking
 *    tokens)"). A capable model's projected output therefore grows with the
 *    level (`REASONING_LEVEL_COSTS`), so a deep request is never compared — or
 *    budgeted — as though it would answer in a paragraph.
 * 5. **A budget cap steps the level down, never up, and says so.** When the
 *    projected cost of a level would breach a per-task cap, the next level down
 *    is tried; the step is a named rule rather than a silent downgrade. If even
 *    `minimal` does not fit, `minimal` is kept and the existing cap stops the
 *    loop — refusing to answer is the cap's job, not this module's.
 * 6. **`max_tokens` makes room for the thinking.** Thinking counts against the
 *    output ceiling on every vendor here, so a directive raises the request's
 *    ceiling to at least the projected thinking plus a reply, bounded by what
 *    the context window can hold. A ceiling sized for the visible answer alone
 *    would truncate the answer the extra thinking was paid for.
 *
 * Pure and dependency-free apart from types, so the router can use it without
 * importing a provider module.
 */
import type {
  ModelInfo,
  ReasoningControlId,
  ReasoningDirective,
  ReasoningLevel,
  ReasoningPreference,
  TaskProfile,
  TaskReasoning,
  TaskReasoningDecision,
} from '../types.js';

/** When the vendor request shapes in `REASONING_CONTROLS` were last read against published docs. */
export const REASONING_CONTROLS_VERIFIED_AT = '2026-10-08';

export const REASONING_PREFERENCES: readonly ReasoningPreference[] = ['auto', 'minimal', 'standard', 'deep'];
export const REASONING_LEVELS: readonly ReasoningLevel[] = ['minimal', 'standard', 'deep'];

interface ReasoningControlSpec {
  /** Providers whose adapter implements this control. Nothing else may be sent it. */
  providers: readonly string[];
  /** The request field, as a human reads it in a routing explanation. */
  wire: string;
  /** The vendor's value for each level. Only values every declared model accepts. */
  values: Readonly<Record<ReasoningLevel, 'low' | 'medium' | 'high'>>;
  /** The published page the shape and values were read from. */
  source: string;
}

/**
 * The verified vendor controls.
 *
 * `low`/`medium`/`high` are the only values used, because they are the only
 * values every declared model of each vendor accepts: Claude Opus 4.5 has no
 * `xhigh` or `max`; GPT-6.1 Sol has no `none` or `minimal`. A wider range per
 * model would be a second table to keep honest, and the three levels here have
 * nowhere to put a fourth value anyway.
 *
 * - **anthropic-effort** — `output_config.effort`. GA, no beta header. Effort
 *   applies to every output token whether or not thinking is on, so this module
 *   never touches the `thinking` field: on Opus 4.6–4.8 thinking stays as the
 *   adapter leaves it, and on Opus 5.5 / Sonnet 5.5 / Fable, where thinking is
 *   always on, effort is the depth control. Not sending `thinking` also means
 *   no thinking blocks need round-tripping through the tool loop.
 * - **openai-reasoning-effort** — `reasoning_effort` on Chat Completions.
 *   Reasoning tokens are billed as output.
 * - **gemini-reasoning-effort** — `reasoning_effort` on Gemini's
 *   OpenAI-compatible endpoint, which maps it onto thinking levels (Gemini 3.x)
 *   or budgets (Gemini 2.5: low 1,024 / medium 8,192 / high 24,576). It must not
 *   be combined with `thinking_config`, which AtlasMind never sends.
 */
export const REASONING_CONTROLS: Readonly<Record<ReasoningControlId, ReasoningControlSpec>> = {
  'anthropic-effort': {
    providers: ['anthropic'],
    wire: 'output_config.effort',
    values: { minimal: 'low', standard: 'medium', deep: 'high' },
    source: 'https://platform.claude.com/docs/en/build-with-claude/effort',
  },
  'openai-reasoning-effort': {
    providers: ['openai'],
    wire: 'reasoning_effort',
    values: { minimal: 'low', standard: 'medium', deep: 'high' },
    source: 'https://developers.openai.com/api/docs/guides/reasoning',
  },
  'gemini-reasoning-effort': {
    providers: ['google'],
    wire: 'reasoning_effort',
    values: { minimal: 'low', standard: 'medium', deep: 'high' },
    source: 'https://ai.google.dev/gemini-api/docs/openai',
  },
};

export interface AutoReasoningRule {
  id: string;
  when: TaskReasoning;
  level: ReasoningLevel;
  describes: string;
}

/**
 * How `auto` becomes a level. One row per profiler tier, total by construction
 * (a test walks every tier), so `auto` never falls through to a default.
 */
export const AUTO_REASONING_RULES: readonly AutoReasoningRule[] = [
  { id: 'auto-low', when: 'low', level: 'minimal', describes: 'a low-reasoning task (mechanical or conversational) gets minimal thinking' },
  { id: 'auto-medium', when: 'medium', level: 'standard', describes: 'a medium-reasoning task (implement, explain, fix) gets standard thinking' },
  { id: 'auto-high', when: 'high', level: 'deep', describes: 'a high-reasoning task (planning, architecture, root cause, review) gets deep thinking' },
];

/** `auto` with no task profile: the middle level, never the most expensive one. */
export const AUTO_UNPROFILED_RULE = { id: 'auto-unprofiled', level: 'standard' as ReasoningLevel, describes: 'no task profile was available, so auto used the middle level rather than assuming depth' };
export const EXPLICIT_PREFERENCE_RULE = { id: 'explicit-preference', describes: 'the reasoning mode was set explicitly' };
export const BUDGET_STEP_DOWN_RULE = { id: 'budget-cap-step-down', describes: 'the projected cost at the requested level would breach the task budget cap, so the next level down was used' };

/**
 * What a level is projected to cost on a model that honours it.
 *
 * `projectedThinkingTokens` is AtlasMind's declared planning figure, not a
 * vendor promise — thinking is adaptive on most of these models and a budget is
 * a target, not a cap. They match Gemini 2.5's published budgets for the same
 * levels, the only vendor that publishes numbers, and they are used where a
 * single request must be priced before it runs (the daily-limit pre-flight and
 * the budget step-down). `outputMultiplier` is the same idea for the router's
 * per-1K cost comparison, which has no absolute request size to add to.
 */
export const REASONING_LEVEL_COSTS: Readonly<Record<ReasoningLevel, { projectedThinkingTokens: number; outputMultiplier: number }>> = {
  minimal: { projectedThinkingTokens: 1_024, outputMultiplier: 1.25 },
  standard: { projectedThinkingTokens: 8_192, outputMultiplier: 2 },
  deep: { projectedThinkingTokens: 24_576, outputMultiplier: 4 },
};

/** Room left for the visible reply above the projected thinking, when a directive raises `max_tokens`. */
export const REASONING_REPLY_ROOM_TOKENS = 2_400;

/** Score bonus for a declared-capable model when deep thinking is wanted. Unknown capability earns 0. */
export const DEEP_REASONING_CAPABLE_BONUS = 0.6;

export interface ReasoningResolution {
  preference: ReasoningPreference;
  level: ReasoningLevel;
  rule: string;
  describes: string;
}

/** An untrusted setting value becomes a preference; anything unrecognised is `auto`. */
export function sanitizeReasoningPreference(value: unknown): ReasoningPreference {
  return typeof value === 'string' && (REASONING_PREFERENCES as readonly string[]).includes(value)
    ? value as ReasoningPreference
    : 'auto';
}

/** Turn a preference into a level, naming the rule that did it. */
export function resolveReasoningLevel(preference: ReasoningPreference, profile?: Pick<TaskProfile, 'reasoning'>): ReasoningResolution {
  if (preference !== 'auto') {
    return { preference, level: preference, rule: EXPLICIT_PREFERENCE_RULE.id, describes: EXPLICIT_PREFERENCE_RULE.describes };
  }
  if (!profile) {
    return { preference, level: AUTO_UNPROFILED_RULE.level, rule: AUTO_UNPROFILED_RULE.id, describes: AUTO_UNPROFILED_RULE.describes };
  }
  const rule = AUTO_REASONING_RULES.find(entry => entry.when === profile.reasoning) ?? AUTO_REASONING_RULES[1];
  return { preference, level: rule.level, rule: rule.id, describes: rule.describes };
}

/**
 * The control a model may actually be sent: declared on the model *and*
 * implemented by its provider's adapter. Either missing → `undefined`.
 */
export function modelReasoningControl(model: Pick<ModelInfo, 'provider' | 'reasoningControl'> | undefined): ReasoningControlId | undefined {
  const control = model?.reasoningControl;
  if (!control || !Object.prototype.hasOwnProperty.call(REASONING_CONTROLS, control)) {
    return undefined;
  }
  return REASONING_CONTROLS[control].providers.includes(model.provider) ? control : undefined;
}

export type ReasoningRequestPlan =
  | { kind: 'applied'; directive: ReasoningDirective; parameter: string }
  | { kind: 'not-sent'; rule: 'unknown-model' | 'no-declared-control' | 'provider-does-not-implement-control'; describes: string };

/** What, if anything, to send a model for a level. */
export function planReasoningRequest(model: ModelInfo | undefined, level: ReasoningLevel): ReasoningRequestPlan {
  if (!model) {
    return { kind: 'not-sent', rule: 'unknown-model', describes: 'the model is not known to the router, so no reasoning parameter was sent' };
  }
  if (!model.reasoningControl) {
    return { kind: 'not-sent', rule: 'no-declared-control', describes: `reasoning control is unknown for ${model.id}, so no reasoning parameter was sent` };
  }
  const control = modelReasoningControl(model);
  if (!control) {
    return { kind: 'not-sent', rule: 'provider-does-not-implement-control', describes: `${model.provider} does not implement ${model.reasoningControl}, so no reasoning parameter was sent` };
  }
  const spec = REASONING_CONTROLS[control];
  const value = spec.values[level];
  return {
    kind: 'applied',
    directive: { control, level, value, rule: `${control}:${level}` },
    parameter: `${spec.wire}=${value}`,
  };
}

/** Thinking tokens a plan is projected to add to one request's output. */
export function projectedThinkingTokens(plan: ReasoningRequestPlan | undefined): number {
  return plan?.kind === 'applied' ? REASONING_LEVEL_COSTS[plan.directive.level].projectedThinkingTokens : 0;
}

/**
 * The output ceiling for a request carrying a directive: at least the projected
 * thinking plus room for a reply, never above `ceiling` (what the context window
 * can hold). Without a directive the requested value passes through untouched.
 */
export function reasoningMaxTokens(directive: ReasoningDirective | undefined, requested: number, ceiling: number): number {
  if (!directive) {
    return requested;
  }
  const floor = REASONING_LEVEL_COSTS[directive.level].projectedThinkingTokens + REASONING_REPLY_ROOM_TOKENS;
  return Math.max(requested, Math.min(floor, Math.max(requested, ceiling)));
}

/**
 * The multiplier the router applies to a model's output price at a level.
 * A capable model thinks more as the level rises; a model that cannot be sent
 * the parameter keeps its own declared multiplier, since asking it harder
 * changes nothing it does.
 */
export function reasoningOutputMultiplier(model: ModelInfo, level: ReasoningLevel | undefined): number {
  const base = model.thinkingTokenMultiplier ?? 1;
  if (!level || !modelReasoningControl(model)) {
    return base;
  }
  return Math.max(base, REASONING_LEVEL_COSTS[level].outputMultiplier);
}

/** Routing preference for depth: only a declared-capable model is preferred, and only when deep is wanted. */
export function scoreReasoningFit(model: ModelInfo, level: ReasoningLevel | undefined): number {
  return level === 'deep' && modelReasoningControl(model) ? DEEP_REASONING_CAPABLE_BONUS : 0;
}

export interface BudgetFittedLevel {
  level: ReasoningLevel;
  rule: string;
  describes: string;
  steppedFrom?: ReasoningLevel;
}

/**
 * Step a level down until its projected cost fits under a cap. `costAt` prices
 * one request at a level; the caller owns the pricing so this stays pure.
 */
export function fitReasoningLevelToBudget(
  resolution: ReasoningResolution,
  costAt: (level: ReasoningLevel) => number,
  capUsd: number | undefined,
): BudgetFittedLevel {
  if (capUsd === undefined || !(capUsd > 0)) {
    return { level: resolution.level, rule: resolution.rule, describes: resolution.describes };
  }
  const order = REASONING_LEVELS.slice(0, REASONING_LEVELS.indexOf(resolution.level) + 1).reverse();
  for (const level of order) {
    if (costAt(level) <= capUsd) {
      return level === resolution.level
        ? { level, rule: resolution.rule, describes: resolution.describes }
        : { level, rule: BUDGET_STEP_DOWN_RULE.id, describes: BUDGET_STEP_DOWN_RULE.describes, steppedFrom: resolution.level };
    }
  }
  return resolution.level === 'minimal'
    ? { level: 'minimal', rule: resolution.rule, describes: resolution.describes }
    : { level: 'minimal', rule: BUDGET_STEP_DOWN_RULE.id, describes: BUDGET_STEP_DOWN_RULE.describes, steppedFrom: resolution.level };
}

/** The decision carried on a task result. */
export function buildReasoningDecision(
  preference: ReasoningPreference,
  fitted: BudgetFittedLevel,
  modelId: string,
  plan: ReasoningRequestPlan,
): TaskReasoningDecision {
  return {
    preference,
    level: fitted.level,
    levelRule: fitted.rule,
    model: modelId,
    outcome: plan.kind === 'applied' ? 'applied' : 'not-sent',
    ...(plan.kind === 'applied' ? { parameter: plan.parameter } : { notSentRule: plan.rule }),
  };
}

/** One line for a routing explanation, composed here so no surface restates it more reassuringly. */
export function describeReasoningDecision(decision: TaskReasoningDecision): string {
  const source = decision.preference === 'auto' ? `auto → ${decision.level}` : decision.level;
  const sent = decision.outcome === 'applied'
    ? `sent ${decision.parameter} to ${decision.model}`
    : `nothing sent to ${decision.model} (${decision.notSentRule})`;
  return `Reasoning: ${source} (rule: ${decision.levelRule}); ${sent}.`;
}
