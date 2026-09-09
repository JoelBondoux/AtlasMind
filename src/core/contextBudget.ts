/**
 * What the next turn will carry, broken into its parts — and, just as
 * importantly, what this reading cannot see.
 *
 * The chat already had a meter: one bar, one total, against the model's window.
 * It answered "am I near the limit" and nothing else, so the question people
 * actually ask — *why did it not know that?* — had no surface at all. The
 * answer is almost always that something was trimmed, and nothing said what,
 * or in what order, or what could be done about it.
 *
 * Five rules.
 *
 * **An estimate is an estimate.** Tokens here are derived from characters at
 * roughly four to one, not from the provider's tokenizer, and the caveat
 * travels with every figure this module produces. A number that looks exact
 * invites decisions it cannot support — dropping a file because a bar says 98%
 * when the real figure was 71%.
 *
 * **Unmeasured is named, never zeroed.** The system prompt, the tool schemas
 * and any images are charged against the same window and are not measured in
 * the chat panel. Listing only what *is* measured would let the bar read
 * comfortable while the turn was full, which is the exact failure the meter was
 * supposed to prevent.
 *
 * **Headroom is not free space.** The reply comes out of the same window, so
 * what is left is not what you may add. It is reported as headroom rather than
 * as room, and never as a suggestion to fill it.
 *
 * **The trim order is published.** When the budget is exceeded something is
 * dropped, and which thing goes first is a decision this project already made
 * in `buildPromptBudget`. Publishing it is what turns "it forgot" into "the
 * oldest turns went first, and here is how to keep them".
 *
 * **Pruning changes the next turn, never this one.** Nothing here rewrites a
 * turn that has run, and no reading is a claim about what a past turn carried.
 *
 * Pure — no `fs`, no clock, no model. The caller measures; this interprets.
 */

export type ContextPartId =
  | 'session-history'
  | 'attachments'
  | 'draft'
  | 'system-prompt'
  | 'tool-schemas'
  | 'images';

export type ContextBudgetRuleId =
  | 'estimate-is-an-estimate'
  | 'unmeasured-is-named'
  | 'headroom-is-not-room'
  | 'trim-order-is-published'
  | 'pruning-is-for-the-next-turn';

export interface ContextBudgetRule {
  id: ContextBudgetRuleId;
  description: string;
}

/** Travels with every figure, because every figure here is approximate. */
export const CONTEXT_ESTIMATE_CAVEAT =
  'Estimated from character counts at about four characters per token, not from the provider\'s own tokenizer. Treat it as a reading, not a measurement.';

export const CONTEXT_BUDGET_RULES: readonly ContextBudgetRule[] = [
  {
    id: 'estimate-is-an-estimate',
    description: CONTEXT_ESTIMATE_CAVEAT,
  },
  {
    id: 'unmeasured-is-named',
    description: 'The system prompt, tool schemas and images are charged against the same window and are not measured here. They are listed as unmeasured rather than left out, because a bar that only counts what it can see reads comfortable while the turn is full.',
  },
  {
    id: 'headroom-is-not-room',
    description: 'The reply comes out of the same window, so what is left is not what you may add.',
  },
  {
    id: 'trim-order-is-published',
    description: 'When the budget is exceeded, something is dropped. Which thing goes first is stated, because that is the answer to "why did it not know that?".',
  },
  {
    id: 'pruning-is-for-the-next-turn',
    description: 'Changing what is carried affects the next message. It never rewrites a turn that has already run.',
  },
];

export interface ContextPartInput {
  id: ContextPartId;
  /** Characters this part contributes. Absent means this reading cannot see it. */
  chars?: number;
  /** How many items it stands for — turns, files, images — when that is meaningful. */
  itemCount?: number;
}

export interface ContextPart {
  id: ContextPartId;
  label: string;
  /** What this part is, in one line, so nothing on the panel needs a glossary. */
  describes: string;
  chars: number;
  estimatedTokens: number;
  /** Share of the measured total, 0–100. Absent when nothing was measured. */
  sharePercent?: number;
  itemCount?: number;
  /** Whether the reader can make this smaller from here. */
  prunable: boolean;
}

export interface ContextBudgetCeiling {
  kind: 'model-window' | 'session-budget';
  label: string;
  /** The model's context window, when one is known. */
  tokens?: number;
  /** The operator's own character budget, which always exists. */
  chars?: number;
}

export interface ContextBudgetReading {
  parts: ContextPart[];
  /** Parts charged against the same window that this reading cannot measure. */
  unmeasured: ContextPart[];
  measuredChars: number;
  measuredTokens: number;
  ceiling: ContextBudgetCeiling;
  /** Share of the ceiling used by what was measured, 0–1. */
  usedRatio: number;
  /** What is left of the ceiling. Not room to fill — the reply comes out of it too. */
  headroomTokens?: number;
  /** Ids in the order they are dropped when the budget is exceeded, first first. */
  trimOrder: ContextPartId[];
  /** Reads `tight` at four fifths, the point where trimming starts to bite. */
  pressure: 'comfortable' | 'tight' | 'over';
  caveat: string;
  rules: readonly ContextBudgetRule[];
}

/** Four characters to a token, matching `estimateTokens` in the orchestrator. */
const CHARS_PER_TOKEN = 4;

const PART_META: Record<ContextPartId, { label: string; describes: string; prunable: boolean }> = {
  'session-history': {
    label: 'Session history',
    describes: 'Earlier turns of this conversation, oldest first.',
    prunable: true,
  },
  attachments: {
    label: 'Attachments',
    describes: 'Files and snippets you attached to the composer.',
    prunable: true,
  },
  draft: {
    label: 'Your draft',
    describes: 'What is in the composer right now.',
    prunable: true,
  },
  'system-prompt': {
    label: 'System prompt',
    describes: 'The agent\'s role, the guardrails, and the project\'s own instructions.',
    prunable: false,
  },
  'tool-schemas': {
    label: 'Tool definitions',
    describes: 'Every tool the turn may call, with its parameters. Charged whether or not one is used.',
    prunable: false,
  },
  images: {
    label: 'Images',
    describes: 'Attached screenshots, charged at a flat rate per image.',
    prunable: true,
  },
};

/**
 * Dropped first to last.
 *
 * The draft is never in this list: a turn that silently trimmed what somebody
 * just typed would be indefensible, and it is the one part they can see.
 */
const TRIM_ORDER: readonly ContextPartId[] = [
  'session-history',
  'attachments',
  'images',
  'tool-schemas',
  'system-prompt',
];

function toPart(input: ContextPartInput, measuredChars: number): ContextPart {
  const meta = PART_META[input.id];
  const chars = Math.max(0, Math.round(input.chars ?? 0));
  return {
    id: input.id,
    label: meta.label,
    describes: meta.describes,
    chars,
    estimatedTokens: Math.ceil(chars / CHARS_PER_TOKEN),
    ...(measuredChars > 0 ? { sharePercent: Math.round((chars / measuredChars) * 1000) / 10 } : {}),
    ...(input.itemCount === undefined ? {} : { itemCount: input.itemCount }),
    prunable: meta.prunable,
  };
}

/**
 * The reading the chat panel shows.
 *
 * A part with no `chars` is *unmeasured*, which is a different statement from
 * zero and is kept in its own list so no total can quietly absorb it.
 */
export function buildContextBudgetReading(
  inputs: readonly ContextPartInput[],
  ceiling: ContextBudgetCeiling,
): ContextBudgetReading {
  const measured = inputs.filter(input => input.chars !== undefined);
  const measuredChars = measured.reduce((total, input) => total + Math.max(0, input.chars ?? 0), 0);
  const measuredTokens = Math.ceil(measuredChars / CHARS_PER_TOKEN);

  const parts = measured
    .map(input => toPart(input, measuredChars))
    .sort((left, right) => right.chars - left.chars || left.id.localeCompare(right.id));

  const unmeasured = inputs
    .filter(input => input.chars === undefined)
    .map(input => toPart(input, 0))
    .sort((left, right) => left.id.localeCompare(right.id));

  const ceilingTokens = ceiling.kind === 'model-window' && ceiling.tokens !== undefined && ceiling.tokens > 0
    ? ceiling.tokens
    : ceiling.chars !== undefined && ceiling.chars > 0
      ? Math.ceil(ceiling.chars / CHARS_PER_TOKEN)
      : undefined;

  const usedRatio = ceilingTokens === undefined ? 0 : measuredTokens / ceilingTokens;

  return {
    parts,
    unmeasured,
    measuredChars,
    measuredTokens,
    ceiling,
    usedRatio,
    // Reported, never framed as room to fill: the reply is charged against the
    // same window, and so is everything in `unmeasured`.
    ...(ceilingTokens === undefined ? {} : { headroomTokens: Math.max(0, ceilingTokens - measuredTokens) }),
    trimOrder: TRIM_ORDER.filter(id => inputs.some(input => input.id === id)),
    pressure: usedRatio >= 1 ? 'over' : usedRatio >= 0.8 ? 'tight' : 'comfortable',
    caveat: CONTEXT_ESTIMATE_CAVEAT,
    rules: CONTEXT_BUDGET_RULES,
  };
}

/**
 * How many turns to carry, given what somebody asked for and what is allowed.
 *
 * A cap is a *request for the next turn*, so it is clamped rather than refused:
 * a nonsense value from a stale webview should not stop the conversation. Zero
 * is a legitimate answer — "carry nothing" is a real way to start again in the
 * same session — and is why this returns a number rather than an optional.
 */
export function resolveCarriedTurns(configuredLimit: number, requestedCap: number | undefined): number {
  const limit = Number.isFinite(configuredLimit) ? Math.max(0, Math.floor(configuredLimit)) : 6;
  if (requestedCap === undefined || !Number.isFinite(requestedCap)) {
    return limit;
  }
  // Never *raises* the configured limit: the setting is the operator's ceiling,
  // and a panel control that could exceed it would be a setting with no effect.
  return Math.max(0, Math.min(limit, Math.floor(requestedCap)));
}

/** One sentence for the panel, naming the pressure and what would go first. */
export function describeContextBudget(reading: ContextBudgetReading): string {
  const percent = Math.round(reading.usedRatio * 100);
  const first = reading.trimOrder[0];
  const firstLabel = first ? PART_META[first].label.toLowerCase() : undefined;
  const against = reading.ceiling.kind === 'model-window'
    ? `of ${reading.ceiling.label}`
    : `of your ${reading.ceiling.label}`;

  if (reading.pressure === 'over') {
    return `Over budget at about ${percent}% ${against}`
      + (firstLabel ? `, so ${firstLabel} is being trimmed.` : '.');
  }
  if (reading.pressure === 'tight') {
    return `About ${percent}% ${against}`
      + (firstLabel ? `. ${firstLabel[0]?.toUpperCase()}${firstLabel.slice(1)} goes first when it fills.` : '.');
  }
  return `About ${percent}% ${against}.`;
}
