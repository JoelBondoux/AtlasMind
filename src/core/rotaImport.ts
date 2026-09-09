/**
 * Declared absence, read out of a calendar somebody else's rota app produced.
 *
 * `teamWorkload` reads absence and refuses to infer any of it. That leaves the
 * entries to be typed by hand, which is where a workload reading quietly stops
 * being accurate — the rota already exists, in Deputy or When I Work or
 * whatever the team actually uses, and retyping it is the step nobody does.
 *
 * Every one of those tools exports the same thing: an iCalendar feed. So this
 * reads iCalendar, not a vendor API — one format, published as RFC 5545 and
 * pinned at `ICALENDAR_SPEC_VERIFIED_AT`, rather than a stack of integrations
 * that each break on their own schedule.
 *
 * Six rules.
 *
 * **A rota says when you are *working*, and that is the opposite of an
 * absence.** This is the rule the whole module turns on, and getting it wrong
 * is not a small error: importing a shift feed wholesale would mark somebody
 * away on exactly the days they are rostered on, and the workload reading would
 * then show a full week as free. So only an event whose summary matches the
 * declared `ABSENCE_TERMS` becomes an entry, and **everything else is counted
 * and reported rather than silently dropped**, because an import that says "12
 * events, 2 imported" is arguable and one that says "2 imported" is not.
 *
 * **`DTEND` is non-inclusive for a `DATE` value**, which RFC 5545 states and
 * illustrates: an event running 28 June to 8 July inclusive carries
 * `DTEND;VALUE=DATE:20070709`. A reader that took it literally would add a
 * phantom day to every absence it imported, and the error is invisible — one
 * day long, in the right week, on a record nobody re-reads.
 *
 * **A date that cannot be read without guessing is refused, never converted.**
 * A `DATE`, a floating date-time and a date-time with a `TZID` all name a
 * calendar day directly, so the literal `YYYYMMDD` is the right answer for
 * each. A `Z` date-time is the only form whose day depends on a zone, and it is
 * read at UTC with the conversion stated rather than shifted to a guess.
 *
 * **The person is chosen, never matched out of the file.** Feeds carry
 * `ATTENDEE` addresses, and matching one to a roster contact would attach a
 * colleague's calendar to the wrong person — a mistake that reads as a fact
 * afterwards. The caller supplies the contact.
 *
 * **Nothing is deleted and nothing is overwritten.** Entry ids are derived from
 * the contact and the dates, so re-importing an updated feed updates in place
 * rather than duplicating, and an entry somebody typed is never removed because
 * a feed did not mention it — absence recorded by hand is a statement, not a
 * cache of somebody else's calendar.
 *
 * **This module reads text and never fetches.** Google's own documentation
 * calls a calendar's iCal URL a *secret address* and tells you not to share it;
 * anyone holding one can read the whole calendar. There is deliberately no URL
 * field anywhere here and no field that could hold one, because `rota` lives in
 * `project-director.json`, which is committed. A feed is downloaded by the
 * person, as a file, and read from disk.
 *
 * Pure + unit-tested; the file picker and the confirmation live at the call
 * site.
 */

import type { RotaEntry } from '../types.js';

/**
 * When the iCalendar contract below was last read against the published spec.
 *
 * RFC 5545: content-line folding (§3.1), `VEVENT` with the non-inclusive
 * `DTEND` example (§3.6.1), `DATE` and `DATE-TIME` value types (§3.3.4–3.3.5).
 */
export const ICALENDAR_SPEC_VERIFIED_AT = '2026-09-09';

export interface RotaSource {
  id: string;
  name: string;
  /** How somebody gets the file out of this tool, in that tool's own words. */
  export: string;
  /**
   * Whether the iCalendar export was verified against the vendor's own
   * documentation, or is merely reported to exist.
   *
   * Kept apart because a confident wrong instruction sends somebody looking for
   * a menu item that is not there, and they conclude the feature is broken.
   */
  verified: boolean;
}

/**
 * Rota tools known to export iCalendar, each read from its own documentation.
 *
 * Deliberately short. This is a list of places to look, not a claim to
 * integrate with anything — the integration is the format, and any tool that
 * exports `.ics` works whether or not it is named here.
 */
export const ROTA_SOURCES: readonly RotaSource[] = [
  {
    id: 'deputy',
    name: 'Deputy',
    export: 'Profile → "Add your Shifts to your personal calendar app" offers a WebCal link or a downloadable .ics file.',
    verified: true,
  },
  {
    id: 'when-i-work',
    name: 'When I Work',
    export: 'My Schedule → Calendar Sync gives an iCalendar link. Opening it in a browser downloads the .ics file.',
    verified: true,
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    export: 'Settings → the calendar → Integrate calendar → "Secret address in iCal format". Treat that URL as a password: anyone holding it can read the calendar.',
    verified: true,
  },
  {
    id: 'other',
    name: 'Anything else',
    export: 'Any tool that exports or publishes an iCalendar (.ics) file works. The format is what is supported, not a list of vendors.',
    verified: true,
  },
];

/**
 * What counts as an absence, by declared term.
 *
 * Matched against the event summary on a word boundary. Short and literal on
 * purpose: a wider vocabulary would start claiming shifts, which is the one
 * failure that inverts the answer rather than degrading it. A term nobody's
 * calendar uses costs nothing; a term that matches a working shift costs
 * somebody a week they are actually on the rota for.
 */
export const ABSENCE_TERMS: readonly string[] = [
  'annual leave',
  'holiday',
  'vacation',
  'pto',
  'time off',
  'day off',
  'off work',
  'ooo',
  'out of office',
  'sick',
  'sick leave',
  'parental leave',
  'maternity leave',
  'paternity leave',
  'bereavement',
  'sabbatical',
  'unavailable',
];

export interface IcsEvent {
  /** Event summary, control-stripped and clamped. May be empty. */
  summary: string;
  /** Inclusive start, `YYYY-MM-DD`. Absent when it could not be read. */
  start?: string;
  /**
   * Inclusive end, `YYYY-MM-DD`, already corrected for the non-inclusive
   * `DTEND`. Absent when there was none, which means a single day.
   */
  end?: string;
  /** True when a `Z` date-time was read at UTC, so the reading can say so. */
  utcConverted: boolean;
}

export interface IcsReading {
  events: IcsEvent[];
  /** Events past the cap, stated rather than silently omitted. */
  truncated: number;
  /** Events whose dates could not be read. Reported, never guessed at. */
  unreadable: number;
}

/** Beyond this the file is not a rota, and reading it all is not worth it. */
const MAX_EVENTS = 2000;
const MAX_SUMMARY = 200;
/** A single .ics larger than this is refused rather than parsed. */
export const MAX_ICS_BYTES = 4 * 1024 * 1024;

/**
 * Undo RFC 5545 §3.1 content-line folding.
 *
 * A CRLF followed by one space or tab is a continuation, not a new line.
 * Without this a folded `SUMMARY` is truncated at 75 octets and the term that
 * would have matched is in the half thrown away.
 */
function unfold(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
}

function stripControl(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
}

/** Unescape the text escapes RFC 5545 §3.3.11 defines, and nothing else. */
function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/** `YYYYMMDD` from a DATE or DATE-TIME value, or nothing. */
function readCalendarDate(value: string): { date: string; utc: boolean } | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})(T\d{6}(Z)?)?$/.exec(value.trim());
  if (!match) {
    return undefined;
  }
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  // Validated rather than trusted: `20260231` matches the shape and is not a
  // day, and rolling it into March would move an absence to a week nobody named.
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    return undefined;
  }
  return { date, utc: match[5] === 'Z' };
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/**
 * Read the events out of an iCalendar file.
 *
 * Never throws: this is third-party text produced by software nobody here
 * controls, and a parse failure must degrade to "nothing found" rather than to
 * an exception in a dialog.
 */
export function parseIcsEvents(text: string): IcsReading {
  const reading: IcsReading = { events: [], truncated: 0, unreadable: 0 };
  if (typeof text !== 'string' || text.length === 0) {
    return reading;
  }

  let inEvent = false;
  let summary = '';
  let start: { date: string; utc: boolean } | undefined;
  let end: { date: string; utc: boolean } | undefined;
  let dateFailed = false;

  const flush = (): void => {
    if (!start) {
      // No readable start is not an event with no dates; it is an event this
      // reader could not place, which is a different fact and is counted.
      if (dateFailed) { reading.unreadable += 1; }
      return;
    }
    if (reading.events.length >= MAX_EVENTS) {
      reading.truncated += 1;
      return;
    }
    // RFC 5545 §3.6.1: DTEND is the non-inclusive end. The last day the person
    // is actually away is the day before it.
    const inclusiveEnd = end ? addDays(end.date, -1) : undefined;
    reading.events.push({
      summary,
      start: start.date,
      // An end before the start is a broken record, not a one-day event: the
      // start alone is kept rather than inventing a range.
      ...(inclusiveEnd && inclusiveEnd >= start.date ? { end: inclusiveEnd } : {}),
      utcConverted: start.utc || (end?.utc ?? false),
    });
  };

  for (const line of unfold(text)) {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true;
      summary = '';
      start = undefined;
      end = undefined;
      dateFailed = false;
      continue;
    }
    if (trimmed === 'END:VEVENT') {
      if (inEvent) { flush(); }
      inEvent = false;
      continue;
    }
    if (!inEvent) {
      continue;
    }
    const separator = trimmed.indexOf(':');
    if (separator < 0) {
      continue;
    }
    // The name may carry parameters (`DTSTART;VALUE=DATE`); only the name
    // before the first `;` decides what the line is.
    const name = trimmed.slice(0, separator).split(';')[0].toUpperCase();
    const value = trimmed.slice(separator + 1);
    if (name === 'SUMMARY') {
      summary = stripControl(unescapeText(value)).slice(0, MAX_SUMMARY);
    } else if (name === 'DTSTART') {
      start = readCalendarDate(value);
      if (!start) { dateFailed = true; }
    } else if (name === 'DTEND') {
      end = readCalendarDate(value);
    }
  }

  return reading;
}

/** Whether an event summary names a declared absence. */
export function absenceTermFor(summary: string): string | undefined {
  const text = ` ${summary.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  // Longest first, so "annual leave" is reported rather than a shorter term
  // that happens to sit inside it.
  const ordered = [...ABSENCE_TERMS].sort((a, b) => b.length - a.length);
  return ordered.find(term => text.includes(` ${term} `));
}

export interface RotaImportPlan {
  /** Entries this import would add or update, ready to be written. */
  entries: RotaEntry[];
  /** Entries already present and unchanged. */
  unchanged: number;
  /** Events that are not absences — a shift feed is mostly these. */
  notAbsence: number;
  /** Events whose dates could not be read. */
  unreadable: number;
  /** Events past the cap. */
  truncated: number;
  /** True when any date was read at UTC rather than as a stated calendar day. */
  utcConverted: boolean;
  /** One sentence a surface cannot restate more favourably. */
  summary: string;
  /** Set when nothing can be imported, with what to change. */
  refusal?: string;
}

function entryId(contactId: string, from: string, to: string): string {
  // Deterministic, so re-importing an amended feed updates in place. Not a
  // timestamp or a random value: `project_memory/` is committed, and two people
  // importing the same feed must not produce a diff.
  return `rota-ics-${contactId}-${from}-${to}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

/**
 * What importing this file would do, as a value.
 *
 * Returns the plan rather than performing it, so the confirmation can show the
 * exact entries — a dialog cannot show somebody what is composed after they
 * agree to it.
 */
export function planRotaImport(input: {
  text: string;
  contactId: string;
  /** Absence already recorded, so this can say what is new. */
  existing: readonly RotaEntry[];
}): RotaImportPlan {
  const reading = parseIcsEvents(input.text);
  const plan: RotaImportPlan = {
    entries: [],
    unchanged: 0,
    notAbsence: 0,
    unreadable: reading.unreadable,
    truncated: reading.truncated,
    utcConverted: false,
    summary: '',
  };

  if (!input.contactId) {
    plan.refusal = 'No person was chosen. A calendar is imported against somebody named, never matched to a contact from the addresses inside the file.';
    plan.summary = plan.refusal;
    return plan;
  }

  for (const event of reading.events) {
    if (!event.start) {
      continue;
    }
    const term = absenceTermFor(event.summary);
    if (!term) {
      // A rota feed is mostly shifts somebody is working. Counted, and never
      // imported: an absence recorded on a working day inverts the answer.
      plan.notAbsence += 1;
      continue;
    }
    const from = event.start;
    const to = event.end ?? event.start;
    const id = entryId(input.contactId, from, to);
    const already = input.existing.find(entry => entry.id === id);
    if (already && already.from === from && already.to === to) {
      plan.unchanged += 1;
      continue;
    }
    if (event.utcConverted) {
      plan.utcConverted = true;
    }
    plan.entries.push({
      id,
      contactId: input.contactId,
      from,
      to,
      kind: 'away',
      note: event.summary.slice(0, 200) || `Imported (${term})`,
    });
  }

  if (reading.events.length === 0) {
    plan.refusal = 'No calendar events were found in that file. Check it is the .ics the tool exported rather than a screenshot or a link.';
  } else if (plan.entries.length === 0 && plan.unchanged === 0) {
    plan.refusal = `None of the ${reading.events.length} event(s) name an absence. A rota feed is mostly the shifts somebody is working, and importing those would record them as away on exactly the days they are rostered on.`;
  }

  plan.summary = plan.refusal ?? describeImport(plan, reading.events.length);
  return plan;
}

function describeImport(plan: RotaImportPlan, total: number): string {
  const parts: string[] = [
    `${plan.entries.length} absence${plan.entries.length === 1 ? '' : 's'} from ${total} calendar event${total === 1 ? '' : 's'}`,
  ];
  if (plan.unchanged > 0) {
    parts.push(`${plan.unchanged} already recorded`);
  }
  if (plan.notAbsence > 0) {
    // Always said. This is the number that shows the rule worked, and a plan
    // omitting it reads as though the file held nothing else.
    parts.push(`${plan.notAbsence} event${plan.notAbsence === 1 ? '' : 's'} left alone because ${plan.notAbsence === 1 ? 'it does' : 'they do'} not name an absence`);
  }
  if (plan.unreadable > 0) {
    parts.push(`${plan.unreadable} with dates that could not be read`);
  }
  if (plan.truncated > 0) {
    parts.push(`${plan.truncated} past the ${MAX_EVENTS}-event cap`);
  }
  const utc = plan.utcConverted
    ? ' Some times were given in UTC and have been read at their UTC date.'
    : '';
  return `${parts.join('; ')}.${utc}`;
}

/**
 * Merge a plan into the recorded rota.
 *
 * Additive by id. An entry somebody typed is never removed because a feed did
 * not mention it — absence recorded by hand is a statement, not a cache of
 * somebody else's calendar.
 */
export function applyRotaImport(existing: readonly RotaEntry[], plan: RotaImportPlan): RotaEntry[] {
  const merged = existing.filter(entry => !plan.entries.some(added => added.id === entry.id));
  return [...merged, ...plan.entries];
}
