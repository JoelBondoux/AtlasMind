/**
 * What the same work would have cost at a different model.
 *
 * This is the module that makes AtlasMind's central claim, so almost all of it
 * is about **when to refuse**. The arithmetic is four multiplications; the value
 * is in never producing a number that flatters us.
 *
 * The method, stated plainly because it is published with the figure: take a
 * request that was actually made, keep its exact token counts — including the
 * split between ordinary input, cache reads and cache writes — and price those
 * identical tokens at a nominated comparison model. Report the difference.
 *
 * Six rules.
 *
 * **A record that cannot be re-priced is excluded from both sides.** Not counted
 * as a zero saving, not counted at its actual cost against a missing
 * counterfactual — excluded, and the exclusion reported. Leaving it in either
 * total would make the comparison a mixture of measured and assumed.
 *
 * **A missing rate refuses the record rather than falling back.** If the record
 * has cache reads and the comparison model has no cache-read rate, pricing them
 * at the full input rate would raise the counterfactual and therefore *increase
 * the apparent saving*. Every available fallback here errs in our favour, which
 * is precisely why there is none.
 *
 * **A negative saving is reported as negative.** Routing to something dearer than
 * the comparison model is a real outcome and clamping it at zero would turn a
 * loss into a wash — the one arithmetic choice that could make the headline
 * figure a lie rather than merely an overstatement.
 *
 * **No records priced means no figure**, not a saving of zero. A project that has
 * not run anything and a project whose history predates the cache fields both
 * produce nothing to compare, and `$0.00 saved` reads as *this did not help*.
 *
 * **The comparison model is named in the result**, so no surface can show a
 * saving without saying what it is a saving against.
 *
 * **The figure is a floor, and says so.** Flagship models generally emit more
 * output for the same prompt, so re-pricing *our* output count at *their* rate
 * understates what they would really have cost. `REPRICING_CAVEAT` travels with
 * every result.
 *
 * Pure: no `vscode`, no `fs`, no clock, no catalog lookup — rates are supplied by
 * the caller, which is the only thing that knows the router's defaults.
 */

import type { CostRecord } from '../types.js';
import { REPRICING_CAVEAT, assessRepricing } from './costRepricing.js';

/** The rates to price against. Supplied, never looked up here. */
export interface ComparisonModelRates {
  /** Routing id, e.g. `anthropic/claude-opus-5`. */
  modelId: string;
  /** What to call it on screen. */
  displayName: string;
  inputPricePer1k: number;
  outputPricePer1k: number;
  /** Price per 1K cache-read input tokens. Absent refuses records with cache reads. */
  cachedInputPricePer1k?: number;
  /** Price per 1K cache-write input tokens. Absent refuses records with cache writes. */
  cacheWritePricePer1k?: number;
}

export const COUNTERFACTUAL_RULES = [
  {
    id: 'not-repriceable',
    description: 'The record does not carry the full cache split, so its tokens cannot be priced against another model.',
  },
  {
    id: 'unpriced-actual',
    description: 'The model actually used had no known price, so there is no measured cost to compare against.',
  },
  {
    id: 'no-cache-read-rate',
    description: 'The record has cache reads and the comparison model has no cache-read rate. Pricing them at the full input rate would inflate the comparison.',
  },
  {
    id: 'no-cache-write-rate',
    description: 'The record has cache writes and the comparison model has no cache-write rate. Pricing them at the full input rate would inflate the comparison.',
  },
  { id: 'priced', description: 'Token counts and every rate needed were present.' },
] as const;

export type CounterfactualOutcome =
  | { status: 'priced'; actualUsd: number; counterfactualUsd: number; rule: 'priced' }
  | { status: 'refused'; rule: string; reason: string };

function ruleDescription(id: string): string {
  return COUNTERFACTUAL_RULES.find(rule => rule.id === id)?.description ?? id;
}

function refuse(rule: string): CounterfactualOutcome {
  return { status: 'refused', rule, reason: ruleDescription(rule) };
}

/** One record, priced against the comparison model — or refused, with the rule. */
export function repriceRecord(record: CostRecord, target: ComparisonModelRates): CounterfactualOutcome {
  if (record.unpriced) {
    // There is no measured side to compare. Including it would compare a real
    // counterfactual against a placeholder zero and report the whole thing as
    // saving.
    return refuse('unpriced-actual');
  }
  if (assessRepricing(record).eligibility !== 'repriceable') {
    return refuse('not-repriceable');
  }

  const cacheRead = record.cachedInputTokens ?? 0;
  const cacheWrite = record.cacheWriteTokens ?? 0;
  if (cacheRead > 0 && target.cachedInputPricePer1k === undefined) {
    return refuse('no-cache-read-rate');
  }
  if (cacheWrite > 0 && target.cacheWritePricePer1k === undefined) {
    return refuse('no-cache-write-rate');
  }

  // Ordinary input is whatever was not served from, or written to, the cache.
  // Clamped at zero: a provider reporting a split that exceeds the total is
  // reporting something we cannot reconcile, and a negative token count would
  // silently reduce the counterfactual.
  const plainInput = Math.max(0, record.inputTokens - cacheRead - cacheWrite);

  const counterfactualUsd =
    (plainInput / 1000) * target.inputPricePer1k
    + (cacheRead / 1000) * (target.cachedInputPricePer1k ?? 0)
    + (cacheWrite / 1000) * (target.cacheWritePricePer1k ?? 0)
    + (record.outputTokens / 1000) * target.outputPricePer1k;

  return { status: 'priced', actualUsd: record.costUsd, counterfactualUsd, rule: 'priced' };
}

export interface CounterfactualSummary {
  comparisonModelId: string;
  comparisonModelName: string;
  /** Records that could be priced on both sides. */
  pricedCount: number;
  /** Records excluded, by rule id. */
  refusedCounts: Readonly<Record<string, number>>;
  /** Total actual cost of the priced records only. */
  actualUsd: number;
  /** What those same records would have cost at the comparison model. */
  counterfactualUsd: number;
  /**
   * Counterfactual minus actual. Negative when the comparison model would have
   * been *cheaper* — reported rather than clamped.
   */
  savedUsd: number;
  /**
   * Share of the counterfactual avoided, 0–1, or `undefined` when there is no
   * counterfactual to take a share of.
   */
  savedFraction?: number;
  /** `false` when nothing could be priced: show no figure, not a zero. */
  hasFigure: boolean;
  /** Published with the number, always. */
  caveat: string;
}

/**
 * Compare a set of records against one model.
 *
 * Both totals cover **only the records that were priced**, so the comparison is
 * like-for-like. The refusals are reported alongside so a reader can see how
 * much of their history the figure speaks for.
 */
export function summarizeCounterfactual(
  records: readonly CostRecord[],
  target: ComparisonModelRates,
): CounterfactualSummary {
  const refusedCounts: Record<string, number> = {};
  let pricedCount = 0;
  let actualUsd = 0;
  let counterfactualUsd = 0;

  for (const record of records) {
    const outcome = repriceRecord(record, target);
    if (outcome.status === 'refused') {
      refusedCounts[outcome.rule] = (refusedCounts[outcome.rule] ?? 0) + 1;
      continue;
    }
    pricedCount += 1;
    actualUsd += outcome.actualUsd;
    counterfactualUsd += outcome.counterfactualUsd;
  }

  const savedUsd = counterfactualUsd - actualUsd;

  return {
    comparisonModelId: target.modelId,
    comparisonModelName: target.displayName,
    pricedCount,
    refusedCounts,
    actualUsd,
    counterfactualUsd,
    savedUsd,
    ...(counterfactualUsd > 0 ? { savedFraction: savedUsd / counterfactualUsd } : {}),
    hasFigure: pricedCount > 0,
    caveat: REPRICING_CAVEAT,
  };
}

/**
 * The sentence to show beside the figure.
 *
 * One function so every surface says it the same way, and so the caveat and the
 * comparison model cannot be dropped by a renderer that only wanted the number.
 */
export function describeCounterfactual(summary: CounterfactualSummary): string {
  if (!summary.hasFigure) {
    return 'No spend could be compared yet — a comparison needs requests recorded with their full cache split.';
  }

  const refused = Object.values(summary.refusedCounts).reduce((total, count) => total + count, 0);
  const money = (value: number): string => `$${Math.abs(value).toFixed(2)}`;
  const direction = summary.savedUsd >= 0
    ? `saved ${money(summary.savedUsd)}`
    : `cost ${money(summary.savedUsd)} more`;

  const scope = refused > 0
    ? ` Across ${summary.pricedCount} comparable request${summary.pricedCount === 1 ? '' : 's'}; `
      + `${refused} could not be compared.`
    : ` Across ${summary.pricedCount} request${summary.pricedCount === 1 ? '' : 's'}.`;

  return `Routing ${direction} against ${summary.comparisonModelName} `
    + `(${money(summary.actualUsd)} spent, ${money(summary.counterfactualUsd)} at ${summary.comparisonModelName}).`
    + `${scope} ${summary.caveat}`;
}
