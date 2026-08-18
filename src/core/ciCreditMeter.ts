/**
 * How much hosted CI allowance is left, and the honest answer when nobody knows.
 *
 * Routing work away from hosted runners when the allowance runs out is only
 * safe if "the allowance ran out" is a fact rather than a guess. This module
 * exists to keep those apart, because the failure it prevents is specific and
 * expensive: a billing endpoint that returns 403 because a scope was never
 * granted looks, to naive code, exactly like zero minutes remaining — and the
 * routing engine would then move every job onto somebody's workstation on the
 * strength of a permissions error.
 *
 * Three states, and the third is the point.
 *
 * **`remaining`** — a reading was obtained and there is headroom. Carries the
 * `basis`, because "1,200 of 2,000 minutes used" and "this repository is public
 * so Actions is free" are both headroom and only one of them can ever run out.
 *
 * **`exhausted`** — a reading was obtained and there is none, *or* GitHub itself
 * refused a run for a billing reason. The second source matters: the
 * documentation already warns against assuming budget is the cause of a refused
 * run, so an observed refusal is only accepted when GitHub's own message says
 * so, matched against a declared phrase list rather than inferred from a
 * failure.
 *
 * **`unknown`** — nothing was read. Never silently treated as either of the
 * others. A caller deciding what to do with `unknown` must say so in the same
 * sentence as the decision, which is what `describeCreditReading` is for.
 *
 * The API shape is read from GitHub's published billing endpoints and pinned in
 * `GITHUB_BILLING_VERIFIED_AT`; the response is untrusted input, so parsing
 * never throws and an unreadable field degrades to `unknown` rather than to a
 * convenient number.
 *
 * Pure: the caller performs the `gh` request. Unit-tested.
 */

/**
 * The endpoints that answer this, by account type.
 *
 * Constants rather than composed strings: these reach `gh api`, and the owner
 * segment is interpolated by the caller from an already-validated slug.
 * Verified against GitHub's REST documentation for Actions billing.
 */
export const GITHUB_BILLING_ENDPOINTS = {
  user: 'users/{owner}/settings/billing/actions',
  organization: 'orgs/{owner}/settings/billing/actions',
} as const;

/** When the endpoint shape below was last checked against the published API. */
export const GITHUB_BILLING_VERIFIED_AT = '2026-08-18';

export type CiCreditBasis =
  /** Read from the Actions billing endpoint. */
  | 'billing-api'
  /** Public repositories do not consume the allowance at all. */
  | 'not-metered'
  /** GitHub refused a run and said why. */
  | 'observed-refusal';

export type CiCreditReading =
  | {
    state: 'remaining';
    basis: CiCreditBasis;
    includedMinutes?: number;
    usedMinutes?: number;
    /** Percentage of the included allowance consumed, when both are known. */
    usedPercent?: number;
  }
  | {
    state: 'exhausted';
    basis: CiCreditBasis;
    detail: string;
    includedMinutes?: number;
    usedMinutes?: number;
  }
  | {
    state: 'unknown';
    /** Why nothing is known. Shown to the user, never swallowed. */
    reason: string;
  };

/**
 * Phrases in a GitHub refusal that genuinely mean "you are out of allowance".
 *
 * Deliberately narrow and matched case-insensitively against the whole message.
 * A generic failure must not be read as a billing failure: the local-CI
 * documentation makes exactly this point, warning against assuming budget is
 * the cause before checking the actual message, and a wrong reading here moves
 * work onto a workstation.
 */
const BILLING_REFUSAL_PHRASES = [
  'spending limit',
  'payment method',
  'billing',
  'exceeded the maximum',
  'out of minutes',
  'insufficient funds',
] as const;

interface BillingResponseShape {
  total_minutes_used?: unknown;
  included_minutes?: unknown;
  total_paid_minutes_used?: unknown;
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Read an Actions billing response.
 *
 * A response missing either number yields `unknown`, not a partial guess: the
 * decision this feeds is "may work move off hosted runners", and half a reading
 * is not a basis for it.
 */
export function parseGithubBillingUsage(raw: string): CiCreditReading {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: 'unknown', reason: 'GitHub\'s billing response could not be read.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { state: 'unknown', reason: 'GitHub\'s billing response was not an object.' };
  }
  const shape = parsed as BillingResponseShape;
  const includedMinutes = finiteNonNegative(shape.included_minutes);
  const usedMinutes = finiteNonNegative(shape.total_minutes_used);
  if (includedMinutes === undefined || usedMinutes === undefined) {
    return {
      state: 'unknown',
      reason: 'GitHub\'s billing response did not carry both the included and used minute counts.',
    };
  }
  // A paid overage means somebody has decided to keep spending, so the
  // allowance being gone is not a reason to move work: report headroom and let
  // the spend cap in settings be the thing that stops it.
  const paidUsed = finiteNonNegative(shape.total_paid_minutes_used) ?? 0;
  if (usedMinutes < includedMinutes || paidUsed > 0) {
    return {
      state: 'remaining',
      basis: 'billing-api',
      includedMinutes,
      usedMinutes,
      ...(includedMinutes > 0
        ? { usedPercent: Math.min(100, Math.round((usedMinutes / includedMinutes) * 100)) }
        : {}),
    };
  }
  return {
    state: 'exhausted',
    basis: 'billing-api',
    includedMinutes,
    usedMinutes,
    detail: `${usedMinutes} of ${includedMinutes} included Actions minutes are used, and no paid overage is enabled.`,
  };
}

/**
 * A public repository does not consume the allowance.
 *
 * Modelled as headroom with its own basis rather than as a large number,
 * because "free" and "plenty left" behave identically today and differently the
 * moment the repository is made private — and a surface that showed a number
 * nobody is counting would be inventing one.
 */
export function notMeteredReading(): CiCreditReading {
  return { state: 'remaining', basis: 'not-metered' };
}

/**
 * Classify a GitHub failure as a billing refusal, or decline to.
 *
 * Returns `undefined` for anything that is not clearly about billing, so the
 * caller keeps whatever reading it already had. Guessing here would let a
 * network blip empty the meter.
 */
export function readBillingRefusal(message: string): CiCreditReading | undefined {
  const text = String(message ?? '').toLowerCase();
  if (!text) {
    return undefined;
  }
  const matched = BILLING_REFUSAL_PHRASES.find(phrase => text.includes(phrase));
  return matched
    ? {
      state: 'exhausted',
      basis: 'observed-refusal',
      detail: `GitHub refused a run and its message mentioned ${matched}.`,
    }
    : undefined;
}

/**
 * One sentence describing the reading, for the surface that shows a decision.
 *
 * Every branch says where the answer came from. A routing decision that cites
 * the meter without saying whether the meter was actually read is the failure
 * this module exists to prevent, one layer up.
 */
export function describeCreditReading(reading: CiCreditReading): string {
  if (reading.state === 'unknown') {
    return `Hosted allowance not known — ${reading.reason}`;
  }
  if (reading.basis === 'not-metered') {
    return 'This repository is public, so GitHub-hosted runners do not consume an allowance.';
  }
  if (reading.state === 'exhausted') {
    return reading.detail;
  }
  return reading.includedMinutes !== undefined && reading.usedMinutes !== undefined
    ? `${reading.usedMinutes} of ${reading.includedMinutes} included Actions minutes used${reading.usedPercent === undefined ? '' : ` (${reading.usedPercent}%)`}.`
    : 'Hosted allowance has headroom.';
}
