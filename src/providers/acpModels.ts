/**
 * The models inside an ACP subscription — *which* model, not just how hard it thinks.
 *
 * `acpEffort.ts` made the `thought_level` knob routable, and the same
 * `configOptions` array carries a `model` knob that was being read and then
 * discarded: `codex-acp` offers `gpt-5.6-sol` / `gpt-5.6-terra` / …, and
 * `claude-agent-acp` offers `opus[1m]` / `haiku` / …. So a Claude Max or ChatGPT
 * plan presented to the router as one model at N effort levels, when it is
 * really M models at N effort levels, and the orchestrator could never send a
 * throwaway rename to the cheap model and a refactor to the deep one.
 *
 * **The model list is detected, never declared.** Nothing in this file names a
 * model that must exist. Vendors ship models faster than AtlasMind ships
 * releases, so a hardcoded roster would be wrong within weeks and wrong in the
 * worst direction — a model the user is paying for, invisible to the router.
 * Everything here reads whatever the installed agent offers today.
 *
 * What *cannot* be detected is a model's **standing** — whether it is the light,
 * balanced or deep option — because the wire format carries no capability field.
 * That is the whole difficulty, and three rules resolve it:
 *
 * **1. Standing comes from a declared rule, and the rule is published.** Every
 * choice records which rule assigned it, exactly as the debt register does, so a
 * ranking can be argued with rather than trusted. The rules are, in precedence
 * order: what the user declared in settings, then a narrow table of naming
 * conventions this build can actually justify, then keywords in the vendor's own
 * description of that model.
 *
 * **2. Unknown standing is routable, never dropped.** This inverts
 * `acpEffortTiersFor`, which drops effort values it does not recognise — and the
 * difference is deliberate. An unrecognised *effort* value has no depth or cost
 * this build can reason about, so a row for it would be unscoreable. An
 * unrecognised *model* is a real, working model whose only unknown is where it
 * sits relative to its siblings; dropping it would hide capacity the user pays
 * for, and would hide it precisely for the newest model — the one most likely to
 * be worth using. It routes, it is selectable, it simply is not *preferred* on
 * capability grounds, and it says so.
 *
 * **3. A guess is never dressed as knowledge.** `luna` / `terra` / `sol` sit in
 * an obvious size order if you read them as moon/earth/sun, and that is
 * etymology, not a vendor statement. This build reports them as unknown and
 * offers `atlasmind.acp.modelStanding` so somebody who *does* know can say so
 * without waiting for a release. A wrong ranking is worse than an absent one: it
 * sends a refactor to the small model and nobody finds out.
 *
 * Pure and `vscode`-free.
 */

import { ACP_EFFORT_TIERS, type AcpEffortTier } from './acpEffort.js';

/** The `configOptions` category carrying "which model". */
export const ACP_MODEL_CATEGORY = 'model';

/** Separator between an agent's id and its model: `acp/claude@opus`. */
export const ACP_MODEL_SEPARATOR = '@';

/**
 * Where a model sits relative to its siblings on the same plan.
 *
 * `unknown` is a real answer and the common one for a newly shipped model — not
 * an error state, and not a reason to withhold the model.
 */
export type AcpModelStanding = 'light' | 'balanced' | 'deep' | 'unknown';

export interface AcpModelChoice {
  /** The value sent to `session/set_config_option`. */
  value: string;
  /** The agent's own name for it, which is what the user recognises. */
  name: string;
  /** URL/id-safe form used in the routed model id. */
  slug: string;
  standing: AcpModelStanding;
  /** The rule that assigned the standing, published so it can be checked. */
  rule: string;
  /** Absent for `unknown` — the router then scores on effort alone. */
  reasoningDepth?: number;
  /** Relative routing intensity. It is not a subscription-balance measurement. */
  premiumRequestMultiplier: number;
}

/**
 * What each standing means to the router.
 *
 * `unknown` deliberately carries no `reasoningDepth`: a depth invented for it
 * would let it win or lose task-fit scoring on a number nobody stands behind.
 * Its multiplier is 1 — neutral — so it is neither penalised nor preferred.
 */
const STANDING_WEIGHTS: Record<AcpModelStanding, { reasoningDepth?: number; premiumRequestMultiplier: number }> = {
  light: { reasoningDepth: 1, premiumRequestMultiplier: 0.5 },
  balanced: { reasoningDepth: 3, premiumRequestMultiplier: 1 },
  deep: { reasoningDepth: 5, premiumRequestMultiplier: 2 },
  unknown: { premiumRequestMultiplier: 1 },
};

/**
 * Naming conventions this build is willing to stand behind.
 *
 * Deliberately short. Every entry here is a claim about a vendor's lineup, and a
 * wrong one silently misroutes every turn — so the bar is "documented tiering
 * that has held across several releases", not "sounds smaller". Generic words
 * like `pro`, `max` and `turbo` are absent on purpose: they mean opposite things
 * across vendors, and `max` also names an effort level.
 */
const NAME_RULES: ReadonlyArray<{ pattern: RegExp; standing: AcpModelStanding; rule: string }> = [
  { pattern: /\bhaiku\b/i, standing: 'light', rule: 'Anthropic names its light model Haiku' },
  { pattern: /\bsonnet\b/i, standing: 'balanced', rule: 'Anthropic names its balanced model Sonnet' },
  { pattern: /\bopus\b/i, standing: 'deep', rule: 'Anthropic names its deep model Opus' },
];

/**
 * Keywords in the **vendor's own description** of the model.
 *
 * Weaker than a naming convention and checked after it, because marketing copy
 * is not a specification — but it is the vendor describing this exact model,
 * which beats anything this file could infer about a name it has never seen.
 */
const DESCRIPTION_RULES: ReadonlyArray<{ pattern: RegExp; standing: AcpModelStanding; rule: string }> = [
  { pattern: /\b(fastest|lightweight|quick(?:est)?|cheapest|everyday|simple tasks)\b/i, standing: 'light', rule: 'the agent describes this model as the fast or lightweight option' },
  { pattern: /\b(most capable|most powerful|deepest|hardest|complex (?:tasks|reasoning)|frontier)\b/i, standing: 'deep', rule: 'the agent describes this model as the most capable option' },
  { pattern: /\b(balanced|general[- ]purpose|everyday work|default choice)\b/i, standing: 'balanced', rule: 'the agent describes this model as the balanced option' },
];

/** The rule table in the words the UI shows, so the assumption travels with it. */
export const ACP_MODEL_RULE_NOTE =
  'Models are read from the agent\'s own `model` options — AtlasMind never assumes which models a '
  + 'plan has. Where a model sits relative to its siblings cannot be read from the wire, so it is '
  + 'assigned by a declared rule: your `atlasmind.acp.modelStanding` setting first, then a short '
  + 'table of naming conventions, then the agent\'s own description. A model matching none of them '
  + 'is offered with unknown standing — fully routable, but never preferred on capability, because '
  + 'a guessed ranking would misroute every turn without telling you.';

/**
 * `default` means "whatever the agent would have chosen", which is already the
 * base row. Offering it again as a variant would put two ids in the tree that do
 * the same thing, one of which claims to be a choice.
 */
const AGENT_DEFAULT_VALUES = new Set(['default', 'auto', 'inherit']);

/** Cap on rows one agent may contribute, so a long lineup cannot flood the tree. */
export const ACP_MAX_MODEL_ROWS_PER_AGENT = 24;

const MAX_MODELS = 12;

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'model';
}

function normalizeStanding(value: unknown): AcpModelStanding | undefined {
  return value === 'light' || value === 'balanced' || value === 'deep' || value === 'unknown'
    ? value
    : undefined;
}

/**
 * Resolve one model's standing, reporting which rule decided.
 *
 * Precedence is settings → name → description. Settings win because the user
 * knows their plan better than this file does; a naming convention beats a
 * description because it is a narrow claim about a documented lineup, while
 * description matching is keyword-spotting in prose.
 */
function resolveStanding(
  value: string,
  name: string,
  description: string | undefined,
  declared: Readonly<Record<string, string>>,
): { standing: AcpModelStanding; rule: string } {
  // Matched case-insensitively on either the wire value or the display name, so
  // a user can write `{"sol": "deep"}` without knowing it is `gpt-5.6-sol`.
  for (const [key, want] of Object.entries(declared)) {
    const standing = normalizeStanding(want);
    if (!standing) {
      continue;
    }
    const needle = key.trim().toLowerCase();
    if (needle && (value.toLowerCase() === needle || name.toLowerCase() === needle
      || value.toLowerCase().includes(needle))) {
      return { standing, rule: `you declared "${key}" as ${standing} in atlasmind.acp.modelStanding` };
    }
  }

  for (const entry of NAME_RULES) {
    if (entry.pattern.test(value) || entry.pattern.test(name)) {
      return { standing: entry.standing, rule: entry.rule };
    }
  }

  if (description) {
    for (const entry of DESCRIPTION_RULES) {
      if (entry.pattern.test(description)) {
        return { standing: entry.standing, rule: entry.rule };
      }
    }
  }

  return {
    standing: 'unknown',
    rule: 'no declared rule matched this model, so its standing is unknown rather than guessed',
  };
}

/**
 * The models an agent actually offers, in the order it listed them.
 *
 * Declaration order is preserved rather than sorted by standing: it is the
 * agent's own ordering, and re-sorting would impose a ranking on top of the one
 * this module admits it cannot always determine.
 */
export function acpModelChoicesFor(
  configOptions: ReadonlyArray<{ category?: string; options: Array<{ value: string; name?: string; description?: string }> }>,
  declaredStanding: Readonly<Record<string, string>> = {},
): AcpModelChoice[] {
  const option = configOptions.find(entry => entry.category === ACP_MODEL_CATEGORY);
  if (!option) {
    return [];
  }

  const seen = new Set<string>();
  const out: AcpModelChoice[] = [];
  for (const entry of option.options) {
    const value = (entry.value ?? '').trim();
    if (!value || AGENT_DEFAULT_VALUES.has(value.toLowerCase())) {
      continue;
    }
    const name = (entry.name ?? '').trim() || value;
    const slug = slugify(name === value ? value : name);
    // Two models whose names slug identically would produce one id resolving to
    // whichever came first — a turn silently routed to the wrong model.
    if (seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    const { standing, rule } = resolveStanding(value, name, entry.description, declaredStanding);
    const weights = STANDING_WEIGHTS[standing];
    out.push({
      value,
      name,
      slug,
      standing,
      rule,
      ...(weights.reasoningDepth === undefined ? {} : { reasoningDepth: weights.reasoningDepth }),
      premiumRequestMultiplier: weights.premiumRequestMultiplier,
    });
    if (out.length >= MAX_MODELS) {
      break;
    }
  }
  return out;
}

/** `acp/claude` + the Opus choice → `acp/claude@opus`. */
export function buildAcpModelId(baseModelId: string, model: AcpModelChoice): string {
  return `${baseModelId}${ACP_MODEL_SEPARATOR}${model.slug}`;
}

/**
 * Split `acp/claude@opus#high` into agent, model slug and effort suffix.
 *
 * The model segment is separated first because it sits between the two: parsing
 * effort first would leave `acp/claude@opus` as the "base", and the agent lookup
 * would then fail to match any configured agent and fall through to `agents[0]`
 * — a turn quietly running on the wrong subscription.
 */
export function splitAcpModelSegment(modelId: string): { withoutModel: string; modelSlug?: string } {
  const index = modelId.indexOf(ACP_MODEL_SEPARATOR);
  if (index < 0) {
    return { withoutModel: modelId };
  }
  const rest = modelId.slice(index + ACP_MODEL_SEPARATOR.length);
  // Keep any effort suffix attached to the part the effort parser reads.
  const hash = rest.indexOf('#');
  const slug = hash < 0 ? rest : rest.slice(0, hash);
  const tail = hash < 0 ? '' : rest.slice(hash);
  return {
    withoutModel: `${modelId.slice(0, index)}${tail}`,
    ...(slug ? { modelSlug: slug } : {}),
  };
}

/**
 * How a model and an effort compose into one routed row.
 *
 * Both are declared rules rather than derived facts, and both are stated on the
 * row: **depth is the greater of the two** (the deeper knob determines how deep
 * the turn reasons; a light model cannot be made deep by asking harder, and a
 * deep model asked for low effort is still the deep model), and **cost
 * multiplies** (a deep model at high effort spends more of the plan than either
 * alone). A model of unknown standing contributes no depth, so the effort's own
 * depth stands — which is exactly the pre-existing behaviour.
 */
export function composeAcpVariant(model: AcpModelChoice, effort?: AcpEffortTier): {
  reasoningDepth?: number;
  premiumRequestMultiplier: number;
} {
  const depths = [model.reasoningDepth, effort?.reasoningDepth].filter(
    (depth): depth is number => typeof depth === 'number',
  );
  const multiplier = model.premiumRequestMultiplier * (effort?.premiumRequestMultiplier ?? 1);
  return {
    ...(depths.length > 0 ? { reasoningDepth: Math.max(...depths) } : {}),
    premiumRequestMultiplier: Number(multiplier.toFixed(3)),
  };
}

/**
 * Every routed row one agent contributes, capped.
 *
 * Ordered so truncation costs the least: each model's own row comes before any
 * of its effort variants, so a lineup too long for the cap still offers every
 * model rather than every effort of the first two.
 */
export function acpModelRows(
  models: readonly AcpModelChoice[],
  efforts: readonly AcpEffortTier[],
): Array<{ model: AcpModelChoice; effort?: AcpEffortTier }> {
  const rows: Array<{ model: AcpModelChoice; effort?: AcpEffortTier }> = models.map(model => ({ model }));
  for (const effort of efforts) {
    for (const model of models) {
      rows.push({ model, effort });
    }
  }
  return rows.slice(0, ACP_MAX_MODEL_ROWS_PER_AGENT);
}

/** Human-readable standing, for the model row and the provider card. */
export function describeAcpModelStanding(standing: AcpModelStanding): string {
  switch (standing) {
    case 'light': return 'light';
    case 'balanced': return 'balanced';
    case 'deep': return 'deep';
    default: return 'standing unknown';
  }
}

/** Re-exported so a caller wiring rows needs one import, not two. */
export { ACP_EFFORT_TIERS };
