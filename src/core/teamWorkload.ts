/**
 * What each person has been asked to do, against what they said they could.
 *
 * The Director module knows who owns what. The roadmap knows what things are
 * estimated to cost. Nothing joined the two, so the question every delivery
 * conversation actually opens with — *is anyone carrying too much?* — had no
 * answer here at all, and the two halves sat one page apart.
 *
 * Eight rules. The first one is not about arithmetic.
 *
 * **This is not a performance measure, and it must never become one.** It counts
 * work somebody has been *given* against capacity they *declared*. It says
 * nothing about how fast anyone works, and a surface that presented it as
 * productivity would be reporting a number that punishes the person who
 * estimates honestly. The distinction is stated on the summary, not left to a
 * reader.
 *
 * **Capacity is declared, never inferred.** There is deliberately no derivation
 * from commit counts, hours of activity or anything else observable: that is
 * surveillance wearing planning's clothes, and it would be wrong as well —
 * somebody quiet for a fortnight may be doing the hardest thing on the board.
 *
 * **Unknown capacity is not full capacity.** A member with no declared
 * allocation is `unknown-capacity` and is excluded from the over/under verdict
 * rather than reported as having room. Reporting somebody as available when
 * nobody knows is precisely how they get handed work they cannot take.
 *
 * **An allocation that cannot be read is unknown, never assumed.** `allocation`
 * is free text somebody typed, and a parser that fell back to full time on
 * anything it did not recognise would be wrong in the one direction that costs
 * a person their week.
 *
 * **An estimate absent is not an estimate of zero** — `roadmapGraph`'s rule,
 * applied to the same numbers. Unestimated work is counted as *unestimated* and
 * never folded into the total, because five unestimated items is not no work,
 * and a total that quietly omitted them would show an overloaded person as
 * comfortable.
 *
 * **Absence is declared and its absence means nothing was recorded.** The
 * asymmetry with capacity is deliberate and worth stating: nobody writes down
 * "I am not away", so no rota entry means *none recorded*, not *available all
 * week*. Capacity is the opposite — nobody's silence should be read as full.
 *
 * **A window is always stated.** "Overloaded" is meaningless without "over what
 * period", and a number without one invites the reader to supply their own.
 *
 * **Overload is reported, never resolved.** Nothing here reassigns anybody.
 * Moving work between people is a conversation, and a tool that shuffled names
 * would be making commitments on somebody else's behalf.
 *
 * Pure, `vscode`-free and unit-tested.
 */

import type { RotaEntry } from '../types.js';

export type { RotaEntry };

/** Working days in a full week, for normalising a percentage allocation. */
export const FULL_WEEK_DAYS = 5;

export interface CapacityRule {
  id: string;
  /** Shown wherever a parsed capacity is shown, so the reading can be argued with. */
  describes: string;
}

/**
 * How an allocation string is read, by declared rule.
 *
 * Ordered; first match wins. The vocabulary is deliberately small and literal —
 * these are the forms people actually type into a roster field, and a parser
 * that tried to be clever would succeed on something it had misread.
 */
export const CAPACITY_RULES: readonly CapacityRule[] = [
  { id: 'percent', describes: 'A percentage of a full week, e.g. "50%".' },
  { id: 'fte', describes: 'A full-time-equivalent fraction, e.g. "0.5 FTE".' },
  { id: 'days-per-week', describes: 'Days per week, e.g. "2 days/wk" or "3 days a week".' },
  { id: 'hours-per-week', describes: 'Hours per week, converted at 7.5 hours to the day.' },
  { id: 'full-time', describes: '"Full time" — the whole week.' },
  { id: 'half-time', describes: '"Half time" — half the week.' },
];

/** Hours in a working day, for reading an hours-per-week allocation. */
const HOURS_PER_DAY = 7.5;

export interface DeclaredCapacity {
  /** Exactly what somebody typed. Kept so a failed reading can be shown. */
  raw: string;
  /** Normalised, when it could be read. Absent means unknown — never full. */
  daysPerWeek?: number;
  /** The rule that read it, or `unreadable`. */
  rule: string;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Read an allocation string.
 *
 * Returns no `daysPerWeek` when it cannot be read, which every caller must treat
 * as unknown. A parser that guessed here would be guessing about somebody's
 * working week.
 */
export function parseAllocation(raw: string | undefined): DeclaredCapacity {
  const text = (raw ?? '').trim();
  if (!text) {
    return { raw: '', rule: 'unreadable' };
  }
  const lower = text.toLowerCase();

  const percent = /^(\d{1,3}(?:\.\d+)?)\s*%$/.exec(lower);
  if (percent) {
    const value = Number(percent[1]);
    if (Number.isFinite(value) && value >= 0 && value <= 100) {
      return { raw: text, daysPerWeek: round((value / 100) * FULL_WEEK_DAYS), rule: 'percent' };
    }
    // Over 100% is not read as more than a full week: it is somebody expressing
    // frustration, and turning it into extra capacity would be the worst
    // possible reading.
    return { raw: text, rule: 'unreadable' };
  }

  const fte = /^(\d(?:\.\d+)?)\s*fte$/.exec(lower);
  if (fte) {
    const value = Number(fte[1]);
    if (Number.isFinite(value) && value >= 0 && value <= 1) {
      return { raw: text, daysPerWeek: round(value * FULL_WEEK_DAYS), rule: 'fte' };
    }
    return { raw: text, rule: 'unreadable' };
  }

  const days = /^(\d(?:\.\d+)?)\s*(?:d|days?)\s*(?:\/|per|a)?\s*(?:w|wk|week)$/.exec(lower);
  if (days) {
    const value = Number(days[1]);
    if (Number.isFinite(value) && value >= 0 && value <= FULL_WEEK_DAYS) {
      return { raw: text, daysPerWeek: round(value), rule: 'days-per-week' };
    }
    return { raw: text, rule: 'unreadable' };
  }

  const hours = /^(\d{1,2}(?:\.\d+)?)\s*(?:h|hrs?|hours?)\s*(?:\/|per|a)?\s*(?:w|wk|week)$/.exec(lower);
  if (hours) {
    const value = Number(hours[1]);
    if (Number.isFinite(value) && value >= 0 && value <= FULL_WEEK_DAYS * HOURS_PER_DAY) {
      return { raw: text, daysPerWeek: round(value / HOURS_PER_DAY), rule: 'hours-per-week' };
    }
    return { raw: text, rule: 'unreadable' };
  }

  if (lower === 'full time' || lower === 'full-time' || lower === 'fulltime') {
    return { raw: text, daysPerWeek: FULL_WEEK_DAYS, rule: 'full-time' };
  }
  if (lower === 'half time' || lower === 'half-time' || lower === 'halftime') {
    return { raw: text, daysPerWeek: FULL_WEEK_DAYS / 2, rule: 'half-time' };
  }

  return { raw: text, rule: 'unreadable' };
}

// ── Declared absence ─────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days of overlap between an entry and a window, inclusive at both ends. */
export function overlapDays(entry: RotaEntry, windowStart: number, windowEnd: number): number {
  const from = Date.parse(entry.from);
  const to = Date.parse(entry.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    // An unreadable or inverted period is not an absence. It is a broken record,
    // and silently treating it as time off would remove capacity nobody agreed
    // to remove.
    return 0;
  }
  const start = Math.max(from, windowStart);
  const end = Math.min(to, windowEnd);
  return end < start ? 0 : Math.floor((end - start) / MS_PER_DAY) + 1;
}

// ── Workload ─────────────────────────────────────────────────────

export interface WorkloadItem {
  id: string;
  title: string;
  ownerContactId?: string;
  /** Absent means unestimated. Never treated as zero. */
  estimateDays?: number;
  /**
   * Whether somebody declared this estimate or a rule produced it.
   *
   * The roadmap grades every item, so excluding derived estimates would leave
   * almost every person reading `unestimated-work` and make the surface useless
   * — but a derived number is a published rule's guess, not a commitment
   * anybody made, and a total that hid the difference would present the two as
   * one. Both count; the derived share is stated.
   *
   * **Unstated provenance counts as derived**, the weaker claim, as
   * `roadmapCostAttribution` does with an unstated attribution.
   */
  estimateSource?: 'declared' | 'derived';
  dueAt?: string;
}

export type WorkloadVerdict =
  /** More committed work than declared capacity in the window. */
  | 'over'
  /** Committed work fits the declared capacity. */
  | 'within'
  /** No declared allocation. Excluded from the verdict rather than called idle. */
  | 'unknown-capacity'
  /** Capacity known, but enough of the work is unestimated to make a total meaningless. */
  | 'unestimated-work'
  /** Nothing assigned. */
  | 'no-work';

export interface MemberWorkload {
  contactId: string;
  name: string;
  capacity: DeclaredCapacity;
  /** Days available in the window after declared absence. Absent when unknown. */
  availableDays?: number;
  /** Days removed by declared absence. Zero means none was recorded. */
  absentDays: number;
  assignedItems: number;
  /** Sum of the estimates that exist. Never includes a guess for the ones that do not. */
  estimatedDays: number;
  /** Items with no estimate. Reported, never folded into the total. */
  unestimatedItems: number;
  /** How many of the counted estimates came from a rule rather than a person. */
  derivedEstimateItems: number;
  verdict: WorkloadVerdict;
  /** One sentence naming the reason, so a verdict is never a bare word. */
  detail: string;
}

export interface TeamWorkloadInput {
  members: ReadonlyArray<{ contactId: string; name: string; allocation?: string }>;
  items: readonly WorkloadItem[];
  rota: readonly RotaEntry[];
  /** Days the window covers, starting at `from`. Always stated on the summary. */
  windowDays: number;
  from: string;
}

export interface TeamWorkloadSummary {
  windowDays: number;
  from: string;
  members: MemberWorkload[];
  /** Items assigned to nobody. Never distributed across the team. */
  unassignedItems: number;
  /** Members whose capacity nobody declared. Coverage, not a fault. */
  unknownCapacity: number;
  over: number;
  /** One sentence a surface cannot restate more optimistically. */
  summary: string;
  /**
   * How an allocation is read, published with the reading.
   *
   * Travels in the payload rather than being copied into the renderer, so a
   * surface shows the rules that actually parsed the allocations rather than a
   * copy that drifted — the same reason the debt and defect registers publish
   * their grading tables.
   */
  capacityRules: readonly CapacityRule[];
  /** Stated on every rendering. This is not a productivity measure. */
  caveat: string;
}

/**
 * The proportion of assigned items that must be estimated before a total means
 * anything.
 *
 * Below this, the verdict is `unestimated-work` rather than a number: a person
 * with two estimated days and six unestimated items is not comfortably within
 * capacity, and reporting them as `within` would be the most confident wrong
 * answer this module could produce.
 */
export const ESTIMATE_COVERAGE_FLOOR = 0.6;

export const WORKLOAD_CAVEAT =
  'This counts work people have been given against capacity they declared. '
  + 'It is not a measure of how fast anybody works, and it should never be read as one.';

/**
 * Join people, their declared capacity, their declared absence and the work
 * assigned to them.
 *
 * Every honest gap is preserved: unknown capacity, unestimated work and
 * unassigned items each get their own count rather than being folded into a
 * total that would look complete.
 */
export function summarizeTeamWorkload(input: TeamWorkloadInput): TeamWorkloadSummary {
  const windowStart = Date.parse(input.from);
  const start = Number.isFinite(windowStart) ? windowStart : Date.now();
  const end = start + ((Math.max(1, input.windowDays) - 1) * MS_PER_DAY);
  const weeks = Math.max(1, input.windowDays) / 7;

  const byOwner = new Map<string, WorkloadItem[]>();
  let unassignedItems = 0;
  for (const item of input.items) {
    if (!item.ownerContactId) {
      // Counted, never distributed. Spreading unowned work across the team
      // would invent commitments nobody made.
      unassignedItems += 1;
      continue;
    }
    const list = byOwner.get(item.ownerContactId) ?? [];
    list.push(item);
    byOwner.set(item.ownerContactId, list);
  }

  const members: MemberWorkload[] = input.members.map(member => {
    const capacity = parseAllocation(member.allocation);
    const items = byOwner.get(member.contactId) ?? [];
    const estimated = items.filter(item => typeof item.estimateDays === 'number' && item.estimateDays >= 0);
    const estimatedDays = round(estimated.reduce((sum, item) => sum + (item.estimateDays ?? 0), 0));
    const unestimatedItems = items.length - estimated.length;
    // Unstated provenance is derived, the weaker claim.
    const derivedEstimateItems = estimated.filter(item => item.estimateSource !== 'declared').length;

    const absentDays = input.rota
      .filter(entry => entry.contactId === member.contactId && entry.kind === 'away')
      .reduce((sum, entry) => sum + overlapDays(entry, start, end), 0);

    let availableDays: number | undefined;
    if (capacity.daysPerWeek !== undefined) {
      const gross = capacity.daysPerWeek * weeks;
      // Absence is capped at the gross figure: somebody cannot be away for more
      // of the window than they were ever going to work in it.
      availableDays = round(Math.max(0, gross - Math.min(gross, absentDays)));
    }

    return {
      contactId: member.contactId,
      name: member.name,
      capacity,
      ...(availableDays === undefined ? {} : { availableDays }),
      absentDays,
      assignedItems: items.length,
      estimatedDays,
      unestimatedItems,
      derivedEstimateItems,
      ...gradeMember({
        assigned: items.length,
        estimatedCount: estimated.length,
        unestimatedItems,
        derivedEstimateItems,
        estimatedDays,
        availableDays,
        absentDays,
      }),
    };
  });

  const over = members.filter(member => member.verdict === 'over').length;
  const unknownCapacity = members.filter(member => member.verdict === 'unknown-capacity').length;

  return {
    windowDays: input.windowDays,
    from: input.from,
    members,
    unassignedItems,
    unknownCapacity,
    over,
    summary: describeTeamWorkload(input.windowDays, members.length, over, unknownCapacity, unassignedItems),
    capacityRules: CAPACITY_RULES,
    caveat: WORKLOAD_CAVEAT,
  };
}

function gradeMember(input: {
  assigned: number;
  estimatedCount: number;
  unestimatedItems: number;
  derivedEstimateItems: number;
  estimatedDays: number;
  availableDays: number | undefined;
  absentDays: number;
}): { verdict: WorkloadVerdict; detail: string } {
  const { assigned, estimatedCount, unestimatedItems, derivedEstimateItems, estimatedDays, availableDays, absentDays } = input;
  if (availableDays === undefined) {
    // Checked before "no work": somebody with nothing assigned and no declared
    // allocation is still somebody whose capacity nobody knows, and calling
    // them free is the mistake this rule exists to prevent.
    return {
      verdict: 'unknown-capacity',
      detail: assigned === 0
        ? 'No allocation is recorded, so there is nothing to compare against. That is not the same as having room.'
        : `${assigned} item${assigned === 1 ? '' : 's'} assigned and no allocation recorded, so whether that fits is unknown.`,
    };
  }
  if (assigned === 0) {
    const away = absentDays > 0 ? ` ${absentDays} day${absentDays === 1 ? '' : 's'} away in this window.` : '';
    return { verdict: 'no-work', detail: `Nothing assigned in this window.${away}` };
  }
  const coverage = assigned === 0 ? 1 : estimatedCount / assigned;
  if (coverage < ESTIMATE_COVERAGE_FLOOR) {
    return {
      verdict: 'unestimated-work',
      detail: `${unestimatedItems} of ${assigned} assigned item${assigned === 1 ? '' : 's'} ${unestimatedItems === 1 ? 'has' : 'have'} no estimate, so a total would be misleading rather than useful.`,
    };
  }
  const remainder = round(availableDays - estimatedDays);
  const unestimatedNote = unestimatedItems > 0
    ? ` ${unestimatedItems} further item${unestimatedItems === 1 ? '' : 's'} ${unestimatedItems === 1 ? 'has' : 'have'} no estimate and ${unestimatedItems === 1 ? 'is' : 'are'} not in this total.`
    : '';
  // Stated rather than folded in silently: a derived estimate is a rule's
  // reading of the item, not a number anybody committed to.
  const derivedNote = derivedEstimateItems > 0
    ? ` ${derivedEstimateItems} of the counted estimate${derivedEstimateItems === 1 ? '' : 's'} ${derivedEstimateItems === 1 ? 'was' : 'were'} derived rather than declared.`
    : '';
  const trailing = `${unestimatedNote}${derivedNote}`;
  if (estimatedDays > availableDays) {
    return {
      verdict: 'over',
      detail: `${estimatedDays} estimated days against ${availableDays} available — ${round(estimatedDays - availableDays)} over.${trailing}`,
    };
  }
  return {
    verdict: 'within',
    detail: `${estimatedDays} estimated days against ${availableDays} available, ${remainder} spare.${trailing}`,
  };
}

function describeTeamWorkload(
  windowDays: number,
  memberCount: number,
  over: number,
  unknownCapacity: number,
  unassigned: number,
): string {
  const window = `over the next ${windowDays} day${windowDays === 1 ? '' : 's'}`;
  if (memberCount === 0) {
    return `Nobody is on the team roster, so there is no workload to read ${window}.`;
  }
  const parts: string[] = [];
  parts.push(over > 0
    ? `${over} of ${memberCount} ${over === 1 ? 'person is' : 'people are'} carrying more than they declared capacity for ${window}`
    : `Nobody is over their declared capacity ${window}`);
  if (unknownCapacity > 0) {
    // Always said when it applies: a clean-looking summary that quietly rests on
    // half the team having no declared capacity is the failure mode here.
    parts.push(`${unknownCapacity} ${unknownCapacity === 1 ? 'person has' : 'people have'} no allocation recorded and could not be assessed`);
  }
  if (unassigned > 0) {
    parts.push(`${unassigned} item${unassigned === 1 ? '' : 's'} ${unassigned === 1 ? 'is' : 'are'} assigned to nobody`);
  }
  return `${parts.join('. ')}.`;
}
