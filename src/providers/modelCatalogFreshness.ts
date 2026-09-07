/**
 * How old the prices behind a cost figure are.
 *
 * Every saving AtlasMind reports is arithmetic against a table of prices
 * committed to this repository. That is the right design — no runtime network
 * call, no service to run, the same numbers for everyone on a given release —
 * and it has one failure mode: the table goes stale and nothing says so, and a
 * confident figure is produced from prices that moved months ago.
 *
 * Three rules.
 *
 * **A figure carries the date of the prices that produced it.** Not as a
 * footnote a surface may drop, but as a value returned alongside, so a caller
 * has to decide to hide it rather than forget to show it.
 *
 * **Stale prices still report.** Past the threshold this says the numbers are
 * old; it does not withhold them. A stale figure honestly dated is more useful
 * than no figure, and refusing to report would push somebody towards a worse
 * source.
 *
 * **An unparseable date is treated as unknown, never as current.** The one
 * direction it must not fail in is the reassuring one.
 *
 * Pure, clock injected.
 */

import { MODEL_CATALOG_STALE_AFTER_DAYS, MODEL_CATALOG_VERIFIED_AT } from './modelCatalog.js';

export interface CatalogFreshness {
  /** ISO date the prices were last verified, or `undefined` if it could not be read. */
  verifiedAt?: string;
  /** Whole days since verification. `undefined` when the date is unknown. */
  ageDays?: number;
  /** True when the prices are past the staleness threshold, or the date is unknown. */
  stale: boolean;
  /** One sentence, safe to render beside any figure derived from these prices. */
  note: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseIsoDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) { return undefined; }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) { return undefined; }
  // Round-tripped, so 2026-02-31 is refused rather than rolled into March —
  // the same rule the roadmap graph applies to deadlines.
  return parsed.toISOString().slice(0, 10) === value ? parsed : undefined;
}

export function modelCatalogFreshness(
  now: Date,
  verifiedAt: string = MODEL_CATALOG_VERIFIED_AT,
  staleAfterDays: number = MODEL_CATALOG_STALE_AFTER_DAYS,
): CatalogFreshness {
  const parsed = parseIsoDate(verifiedAt);
  if (!parsed) {
    return {
      stale: true,
      note: 'Model prices carry no readable verification date, so any figure derived from them is of unknown age.',
    };
  }

  const ageDays = Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / MS_PER_DAY));
  const stale = ageDays > staleAfterDays;

  return {
    verifiedAt,
    ageDays,
    stale,
    note: stale
      ? `Model prices were last verified on ${verifiedAt}, ${ageDays} days ago. Figures below may be out of date.`
      : `Model prices verified ${verifiedAt}.`,
  };
}
