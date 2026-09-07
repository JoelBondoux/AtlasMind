/**
 * Whether a recorded request can honestly be re-priced, and against what.
 *
 * The claim AtlasMind wants to make is counterfactual: *this work cost X, and
 * the same work at a flagship model would have cost Y.* The arithmetic is
 * trivial. Deciding **which records are entitled to appear in that arithmetic**
 * is not, and it is the whole of this module.
 *
 * Four rules, in the order they matter.
 *
 * **A missing field is unknown, never zero.** Providers differ in what they
 * report: Anthropic reports cache reads and cache writes, an OpenAI-compatible
 * endpoint reports neither in those terms, and a subscription agent may report
 * no usage at all. `cacheWriteTokens: undefined` means "not reported", and
 * treating it as `0` would silently price a cache-heavy request as though it
 * had written nothing to the cache — understating the counterfactual in a
 * direction that flatters us. Every classification below refuses rather than
 * assumes, which is the same rule `lensReachability` applies to "unassessed is
 * never unreachable".
 *
 * **Reads and writes move the price in opposite directions.** A cache read is
 * cheaper than an ordinary input token; a cache write is dearer. So the split is
 * not a refinement of the total, it is load-bearing: two requests with identical
 * `inputTokens` can differ in real cost by a multiple. Before `cacheWriteTokens`
 * existed the write count was folded into `inputTokens` and discarded, and a sum
 * cannot be taken apart afterwards — which is why records written before it
 * exists are `partial` forever rather than repairable.
 *
 * **The floor is stated, not implied.** Flagship models generally emit more
 * output tokens for the same prompt, so re-pricing *our* output count at *their*
 * rate understates what the flagship would actually have cost. That makes every
 * figure here a lower bound, and `REPRICING_CAVEAT` travels with the result so
 * no surface can display the number without the sentence.
 *
 * **A record with no workspace is unattributed, never attributed to the current
 * one.** Cost history predating `workspaceKey` came from some project on this
 * machine and there is no way to learn which. Guessing "probably this one"
 * would put another project's spend on this project's roadmap item.
 *
 * Pure: no `vscode`, no `fs`, no clock. Everything is decided from the record.
 */

import type { CostRecord } from '../types.js';

/**
 * How usable a record is for counterfactual re-pricing.
 *
 * Deliberately three states rather than a boolean. `partial` is the interesting
 * one: the record is real spend and belongs in *actual* cost totals, but cannot
 * carry a savings claim. Collapsing it into `unusable` would understate what was
 * spent; collapsing it into `repriceable` would fabricate a saving.
 */
export type RepricingEligibility = 'repriceable' | 'partial' | 'unusable';

export interface RepricingAssessment {
  eligibility: RepricingEligibility;
  /** The declared rule that decided this, published wherever the verdict is shown. */
  rule: string;
  /** Human-readable reason, safe to render. */
  reason: string;
}

/**
 * The rules, declared rather than inline, so a surface can publish the table
 * that graded its own numbers — the pattern `debtRegister` and
 * `testingPolicyDetail` use.
 */
export const REPRICING_RULES = [
  {
    id: 'no-token-counts',
    eligibility: 'unusable' as const,
    description: 'A record with no input and no output tokens describes no work that can be priced.',
  },
  {
    id: 'cache-split-unreported',
    eligibility: 'partial' as const,
    description:
      'The provider did not report how the input split between cache reads, cache writes and ordinary tokens. '
      + 'Reads and writes are priced in opposite directions, so a counterfactual built on the total alone would be a guess.',
  },
  {
    id: 'predates-cache-write-field',
    eligibility: 'partial' as const,
    description:
      'Recorded before cache writes were captured. The write count was folded into the input total and cannot be recovered from it.',
  },
  {
    id: 'complete',
    eligibility: 'repriceable' as const,
    description: 'Token counts and the full cache split are present, so the identical tokens can be priced against another model.',
  },
] as const;

/** Stated wherever a counterfactual figure appears. Not optional. */
export const REPRICING_CAVEAT =
  'This is a floor, not an estimate. The comparison re-prices the tokens actually used; a flagship model '
  + 'generally emits more output for the same prompt, so its real cost would usually be higher.';

function ruleById(id: string): { id: string; description: string } {
  const found = REPRICING_RULES.find(rule => rule.id === id);
  // Every caller passes a literal from the table above; this is the type-level
  // guarantee made explicit rather than a runtime path anybody reaches.
  return found ?? { id, description: id };
}

/**
 * Can this record carry a counterfactual figure?
 *
 * Note the deliberate asymmetry between reads and writes. A record may honestly
 * report `cachedInputTokens: undefined` and still be complete *if* the provider
 * reports cache usage at all — but we cannot tell "this provider reports caching
 * and there was none" from "this provider does not report caching". So the test
 * is whether **either** cache field is present: one present means the provider
 * speaks about caching and the absent one is a real zero; neither present means
 * silence, and silence is unknown.
 */
export function assessRepricing(record: CostRecord): RepricingAssessment {
  if (record.inputTokens <= 0 && record.outputTokens <= 0) {
    const rule = ruleById('no-token-counts');
    return { eligibility: 'unusable', rule: rule.id, reason: rule.description };
  }

  const reportsRead = record.cachedInputTokens !== undefined;
  const reportsWrite = record.cacheWriteTokens !== undefined;

  if (!reportsRead && !reportsWrite) {
    const rule = ruleById('cache-split-unreported');
    return { eligibility: 'partial', rule: rule.id, reason: rule.description };
  }

  // A read reported without a write is the shape every record written before
  // `cacheWriteTokens` existed has. It is indistinguishable from a provider that
  // reports reads only, and both are equally un-repriceable, so they share a
  // verdict — but the rule names the likelier cause so a reader is not left
  // wondering why their history is half-graded.
  if (reportsRead && !reportsWrite) {
    const rule = ruleById('predates-cache-write-field');
    return { eligibility: 'partial', rule: rule.id, reason: rule.description };
  }

  const rule = ruleById('complete');
  return { eligibility: 'repriceable', rule: rule.id, reason: rule.description };
}

export interface RepricingCoverage {
  total: number;
  repriceable: number;
  partial: number;
  unusable: number;
  /** Records carrying no workspace, and therefore attributable to no project. */
  unattributed: number;
  /**
   * True when nothing can be re-priced.
   *
   * Exposed as its own flag because "0 of 0" and "0 of 400" need different
   * sentences on screen: one is a project that has not run anything yet, the
   * other is a history that predates the fields. A caller reading only the
   * ratio would show the same empty state for both.
   */
  none: boolean;
}

/** Counts, for a surface that has to say how much of a history it can stand behind. */
export function summarizeRepricingCoverage(records: readonly CostRecord[]): RepricingCoverage {
  let repriceable = 0;
  let partial = 0;
  let unusable = 0;
  let unattributed = 0;

  for (const record of records) {
    switch (assessRepricing(record).eligibility) {
      case 'repriceable': repriceable += 1; break;
      case 'partial': partial += 1; break;
      default: unusable += 1; break;
    }
    if (!record.workspaceKey) {
      unattributed += 1;
    }
  }

  return {
    total: records.length,
    repriceable,
    partial,
    unusable,
    unattributed,
    none: repriceable === 0,
  };
}

/**
 * Records belonging to one workspace.
 *
 * A record with no `workspaceKey` is **never** included. It came from some
 * project on this machine and there is no way to learn which; attributing it to
 * whichever workspace happens to be open would put another project's spend on
 * this project's roadmap item, which is worse than reporting less.
 */
export function recordsForWorkspace(
  records: readonly CostRecord[],
  workspaceKey: string,
): readonly CostRecord[] {
  if (!workspaceKey) { return []; }
  return records.filter(record => record.workspaceKey === workspaceKey);
}
