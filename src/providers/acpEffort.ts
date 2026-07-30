/**
 * Effort levels inside an ACP subscription — how hard the agent is asked to think.
 *
 * Until now AtlasMind selected nothing inside an ACP plan. `discoverModels()`
 * returned exactly one model per agent, so a Claude Max subscription presented
 * to the router as a single fixed-depth model and every turn ran at whatever the
 * agent defaulted to. Meanwhile the agents were *already telling us* what they
 * could do, on every session, and the adapter was discarding it: `session/new`
 * returns `configOptions`, and both live agents carry a `thought_level` knob.
 *
 * Three rules hold this module together, and each closes a way the feature could
 * be worse than not having it.
 *
 * **1. `category` is the identity, never `id`.** Codex calls the knob
 * `reasoning_effort`; Claude Agent calls it `effort`. Both label it
 * `category: "thought_level"`. Matching on `id` would work against one agent and
 * silently no-op against the other — a failure that looks exactly like success,
 * because the turn still completes, just at the wrong effort.
 *
 * **2. Only two categories may ever be set, and `mode` is not one of them.**
 * The same `configOptions` array that carries effort also carries the agent's
 * *permission* mode, whose values include `agent-full-access` (Codex) and
 * `bypassPermissions` (Claude Agent). A settings channel that can turn those on
 * is a privilege escalation with a friendly name, and it would bypass
 * `toolApprovalManager` entirely rather than going through it. The allowlist is
 * therefore deny-by-default and holds exactly `model` and `thought_level`.
 * `model_config` (Codex's "fast mode": *"1.5x speed, increased usage"*) is
 * excluded too — spending more of somebody's subscription is their call, not a
 * routing optimisation.
 *
 * **3. The cost of effort is a declared rule, not vendor data.** No vendor
 * publishes what a `max`-effort turn costs against a plan's allowance. So the
 * multipliers below are AtlasMind's own stated assumption, published here and
 * surfaced on the model rows, exactly as the debt register publishes the table
 * that graded an entry. They are what make the router's existing budget gate
 * express an effort gradient — `cheap` reaches `low`, `balanced` reaches `high`,
 * `expensive` reaches the top — and being a declared rule is what makes that
 * gradient arguable rather than merely trusted.
 */

/**
 * The config categories AtlasMind will set. Deny-by-default: anything absent
 * here is left at whatever the agent chose, including — deliberately — every
 * permission mode.
 */
export const ACP_SETTABLE_CONFIG_CATEGORIES = ['model', 'thought_level'] as const;

/** The category carrying "how hard should this think". */
export const ACP_EFFORT_CATEGORY = 'thought_level';

/**
 * Values observed across `codex-acp` 1.1.7 and `claude-agent-acp` 0.63.0, in
 * increasing order of effort. `default` is deliberately absent: it means "the
 * agent's own choice", which is the base model row rather than a variant.
 */
export interface AcpEffortTier {
  /** The value sent to `session/set_config_option`. */
  value: string;
  /** Suffix on the routed model id: `acp/claude#high`. */
  label: string;
  /**
   * Feeds `ModelInfo.reasoningDepth`, which is how the router's existing task-fit
   * scoring already reasons about depth. Nothing new is invented for ACP.
   */
  reasoningDepth: number;
  /**
   * Quota units a turn at this effort is assumed to consume. **A declared rule,
   * not a published figure** — see the module note. This is what the budget gate
   * reads, so it is also what stops `cheap` mode from routing to `max`.
   */
  premiumRequestMultiplier: number;
}

export const ACP_EFFORT_TIERS: readonly AcpEffortTier[] = [
  { value: 'low',    label: 'low',    reasoningDepth: 1, premiumRequestMultiplier: 0.5 },
  { value: 'medium', label: 'medium', reasoningDepth: 2, premiumRequestMultiplier: 1 },
  { value: 'high',   label: 'high',   reasoningDepth: 3, premiumRequestMultiplier: 2 },
  { value: 'xhigh',  label: 'xhigh',  reasoningDepth: 4, premiumRequestMultiplier: 3 },
  { value: 'max',    label: 'max',    reasoningDepth: 5, premiumRequestMultiplier: 5 },
  { value: 'ultra',  label: 'ultra',  reasoningDepth: 5, premiumRequestMultiplier: 8 },
];

/** The rule table, in the words the UI shows, so the assumption travels with the number. */
export const ACP_EFFORT_RULE_NOTE =
  'Effort tiers are read from the agent\'s own `thought_level` options. The quota cost of each '
  + 'tier is an AtlasMind assumption, not a published vendor figure — no vendor states what a '
  + 'max-effort turn costs against a plan. Adjust the plan\'s remaining count if it drifts.';

/** Separator between an agent's model id and its effort variant: `acp/claude#high`. */
export const ACP_VARIANT_SEPARATOR = '#';

export function findAcpEffortTier(value: string): AcpEffortTier | undefined {
  return ACP_EFFORT_TIERS.find(tier => tier.value === value);
}

/**
 * Split `acp/claude#high` into its base model id and effort.
 *
 * Total and forgiving: an id with no separator is a base model with no effort,
 * and an unrecognised suffix yields no effort rather than a guess — a variant
 * this build does not know is not one it should apply.
 */
export function parseAcpModelVariant(modelId: string): { baseModelId: string; effort?: AcpEffortTier } {
  const index = modelId.indexOf(ACP_VARIANT_SEPARATOR);
  if (index < 0) {
    return { baseModelId: modelId };
  }
  const baseModelId = modelId.slice(0, index);
  const tier = findAcpEffortTier(modelId.slice(index + ACP_VARIANT_SEPARATOR.length));
  return tier ? { baseModelId, effort: tier } : { baseModelId };
}

/** `acp/claude` + `high` → `acp/claude#high`. */
export function buildAcpModelVariantId(baseModelId: string, effort: AcpEffortTier): string {
  return `${baseModelId}${ACP_VARIANT_SEPARATOR}${effort.label}`;
}

/**
 * The effort tiers an agent actually offers, in declared order.
 *
 * Intersected with {@link ACP_EFFORT_TIERS} rather than taken from the agent
 * wholesale: an unknown value has no depth or cost this build can reason about,
 * so offering it as a routed model would put a row in the tree that the router
 * cannot score. Returns nothing when the agent has no effort knob, which is a
 * perfectly ordinary answer — not every agent has one.
 */
export function acpEffortTiersFor(
  configOptions: ReadonlyArray<{ category?: string; options: Array<{ value: string }> }>,
): AcpEffortTier[] {
  const option = configOptions.find(entry => entry.category === ACP_EFFORT_CATEGORY);
  if (!option) {
    return [];
  }
  const offered = new Set(option.options.map(value => value.value));
  return ACP_EFFORT_TIERS.filter(tier => offered.has(tier.value));
}

/**
 * Whether AtlasMind may set this option.
 *
 * Written as a function over the allowlist rather than a comparison at each call
 * site, so there is one place to read to know what can be changed — and so a new
 * caller cannot quietly widen it by spelling the check slightly differently.
 */
export function isSettableAcpConfigCategory(category: string | undefined): boolean {
  return category !== undefined
    && (ACP_SETTABLE_CONFIG_CATEGORIES as readonly string[]).includes(category);
}
