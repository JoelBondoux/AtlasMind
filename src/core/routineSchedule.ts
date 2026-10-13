/**
 * When a routine is **due** to run on its own — which is not the same as when
 * one runs, and not the same as permission to.
 *
 * A routine (`project_memory/routines/*.md`) may declare a `schedule:`. That
 * line is a request, committed with the routine. Whether anything happens is
 * decided by three further facts, each of them somebody's decision rather than
 * the file's: the master setting `atlasmind.routines.scheduling.enabled`, this
 * developer's approval of *these exact steps* to run unattended, and the
 * workspace being trusted. "The file asks, the settings decide", as in
 * `researchSchedule`.
 *
 * Six rules are enforced here rather than trusted to the caller.
 *
 * **A small declared grammar, validated, never coerced.** Three forms —
 * `daily at HH:MM`, `weekly on <day> at HH:MM`, `every N hours` — and nothing
 * else. A cron string is refused by name rather than half-understood: there is
 * no cron parser in this codebase, and the one-in-a-thousand cron expression a
 * hand-rolled reader gets wrong is a routine running at a time nobody chose.
 * `every N hours` only accepts a divisor of 24, so the windows fall at the same
 * clock times every day and a reader can say when the next one is.
 *
 * **Local time, and the zone is stated.** `daily at 02:00` means 02:00 on the
 * clock of the machine running the editor — not UTC, and not the clock of
 * whoever committed the routine. Every description names the zone, because a
 * routine that runs at 02:00 for one developer runs at 18:00 for another.
 *
 * **Ambient, not background.** A VS Code extension does not run while the
 * editor is closed. Nothing here pretends otherwise: a window that passes with
 * the editor shut simply passes.
 *
 * **A missed window is not a backlog.** Due-ness compares the *most recent*
 * window with the last attempt, so six missed nights produce one catch-up run
 * when the editor next opens, never six. A queue of skipped runs would be an
 * artefact of when somebody opened their laptop, and six dependency updates
 * back to back is not what anyone scheduled.
 *
 * **An attempt closes its window, whatever it produced.** Measured from the last
 * attempt — not the last success, unlike research — because a routine that
 * fails would otherwise be retried on every tick until the next window, and a
 * failing nightly run should report once a night, not once a minute.
 *
 * **A blocker is named, never implied.** Switched off, never approved, changed
 * since it was approved, workspace untrusted, another scheduled run in progress:
 * each produces a state carrying the reason, because a routine that simply
 * never runs looks identical to one that is working.
 *
 * Pure and clock-injected: no `Date.now()`, no `vscode`, no I/O. The state it
 * reads is per developer — see {@link SCHEDULED_ROUTINE_STATE_NOTE}.
 */

import { createHash } from 'node:crypto';

import type { RoutineDefinition } from '../types.js';

// ── Grammar ──────────────────────────────────────────────────────

export type RoutineSchedule =
  | { kind: 'daily'; hour: number; minute: number }
  /** `weekday` follows `Date.getDay()`: 0 is Sunday. */
  | { kind: 'weekly'; weekday: number; hour: number; minute: number }
  | { kind: 'hourly'; everyHours: number };

/** The grammar, published so a refusal can quote it rather than paraphrase it. */
export const ROUTINE_SCHEDULE_GRAMMAR: readonly string[] = [
  'daily at HH:MM',
  'weekly on <monday…sunday> at HH:MM',
  'every N hours (N one of 1, 2, 3, 4, 6, 8, 12)',
];

/** Divisors of 24, so `every N hours` lands on the same clock times each day. */
const HOURLY_STEPS: readonly number[] = [1, 2, 3, 4, 6, 8, 12];

const WEEKDAYS: Readonly<Record<string, number>> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A schedule longer than this is not one of the three forms, whatever it says. */
const MAX_SCHEDULE_LENGTH = 80;

/** Five or six space-separated cron fields. Recognised only so it can be refused by name. */
const CRON_SHAPE = /^[\d*/,?LW#-]+(?:\s+[\d*/,?LW#a-z-]+){4,5}$/i;

export type RoutineScheduleParse =
  | { ok: true; schedule: RoutineSchedule }
  | { ok: false; reason: string };

function grammarSentence(): string {
  return `A schedule is one of: ${ROUTINE_SCHEDULE_GRAMMAR.map(form => `\`${form}\``).join(', ')}.`;
}

function parseClock(hh: string, mm: string): { hour: number; minute: number } | string {
  const hour = Number(hh);
  const minute = Number(mm);
  if (hour > 23) {
    return `\`${hh}:${mm}\` is not a time of day — hours run 00 to 23.`;
  }
  if (minute > 59) {
    return `\`${hh}:${mm}\` is not a time of day — minutes run 00 to 59.`;
  }
  return { hour, minute };
}

/**
 * Read a declared schedule, or say exactly why not.
 *
 * Case and runs of whitespace are normalised — `Daily  at 02:00` is the same
 * request as `daily at 02:00` — and nothing else is. `2:00` is refused rather
 * than read as `02:00`, because a reader that fixes one near-miss teaches
 * people the grammar is a suggestion, and the next near-miss it "fixes" is
 * `14:60`.
 */
export function parseRoutineSchedule(text: unknown): RoutineScheduleParse {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, reason: `No schedule was given. ${grammarSentence()}` };
  }
  if (text.length > MAX_SCHEDULE_LENGTH) {
    return { ok: false, reason: `That schedule is too long to be one of the declared forms. ${grammarSentence()}` };
  }
  const normalised = text.trim().toLowerCase().replace(/\s+/g, ' ');

  if (CRON_SHAPE.test(normalised)) {
    return {
      ok: false,
      reason: `\`${text.trim()}\` looks like cron. AtlasMind does not read cron: it declares a small grammar `
        + `instead, so a schedule always means what it appears to. ${grammarSentence()}`,
    };
  }

  const daily = /^daily at (\d{2}):(\d{2})$/.exec(normalised);
  if (daily) {
    const clock = parseClock(daily[1]!, daily[2]!);
    return typeof clock === 'string' ? { ok: false, reason: clock } : { ok: true, schedule: { kind: 'daily', ...clock } };
  }

  const weekly = /^weekly on ([a-z]+) at (\d{2}):(\d{2})$/.exec(normalised);
  if (weekly) {
    const weekday = WEEKDAYS[weekly[1]!];
    if (weekday === undefined) {
      return { ok: false, reason: `\`${weekly[1]}\` is not a day of the week. Use a day name, e.g. \`weekly on monday at 09:00\`.` };
    }
    const clock = parseClock(weekly[2]!, weekly[3]!);
    return typeof clock === 'string'
      ? { ok: false, reason: clock }
      : { ok: true, schedule: { kind: 'weekly', weekday, ...clock } };
  }

  const hourly = /^every (\d{1,2}) hours?$/.exec(normalised);
  if (hourly) {
    const everyHours = Number(hourly[1]);
    if (!HOURLY_STEPS.includes(everyHours)) {
      return {
        ok: false,
        reason: `\`every ${hourly[1]} hours\` is not accepted: N must divide a day evenly `
          + `(${HOURLY_STEPS.join(', ')}), so the runs fall at the same clock times every day.`,
      };
    }
    return { ok: true, schedule: { kind: 'hourly', everyHours } };
  }

  return { ok: false, reason: `\`${text.trim()}\` is not a schedule AtlasMind can read. ${grammarSentence()}` };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** One sentence, always naming the zone. */
export function describeRoutineSchedule(schedule: RoutineSchedule, timeZone?: string): string {
  const zone = `local time${timeZone ? `, ${timeZone}` : ''}`;
  switch (schedule.kind) {
    case 'daily':
      return `Every day at ${pad(schedule.hour)}:${pad(schedule.minute)} (${zone})`;
    case 'weekly':
      return `Every ${WEEKDAY_NAMES[schedule.weekday]} at ${pad(schedule.hour)}:${pad(schedule.minute)} (${zone})`;
    case 'hourly':
      return schedule.everyHours === 1
        ? `Every hour, on the hour (${zone})`
        : `Every ${schedule.everyHours} hours from midnight (${zone})`;
  }
}

// ── Windows ──────────────────────────────────────────────────────

/**
 * The most recent scheduled moment at or before `now`, in local time.
 *
 * Built with the local `Date` constructor rather than by subtracting
 * milliseconds, so a daylight-saving change moves the window with the clock —
 * `daily at 02:00` stays at 02:00 on the wall, which is what was asked for.
 */
export function latestScheduledWindow(schedule: RoutineSchedule, now: Date): Date {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  switch (schedule.kind) {
    case 'daily': {
      const today = new Date(y, m, d, schedule.hour, schedule.minute);
      return today.getTime() <= now.getTime() ? today : new Date(y, m, d - 1, schedule.hour, schedule.minute);
    }
    case 'weekly': {
      const back = (now.getDay() - schedule.weekday + 7) % 7;
      const candidate = new Date(y, m, d - back, schedule.hour, schedule.minute);
      return candidate.getTime() <= now.getTime()
        ? candidate
        : new Date(y, m, d - back - 7, schedule.hour, schedule.minute);
    }
    case 'hourly': {
      const slot = Math.floor(now.getHours() / schedule.everyHours) * schedule.everyHours;
      const candidate = new Date(y, m, d, slot, 0);
      return candidate.getTime() <= now.getTime() ? candidate : new Date(y, m, d, slot - schedule.everyHours, 0);
    }
  }
}

/** The first scheduled moment strictly after `now`. */
export function nextScheduledWindow(schedule: RoutineSchedule, now: Date): Date {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  switch (schedule.kind) {
    case 'daily': {
      const today = new Date(y, m, d, schedule.hour, schedule.minute);
      return today.getTime() > now.getTime() ? today : new Date(y, m, d + 1, schedule.hour, schedule.minute);
    }
    case 'weekly': {
      const ahead = (schedule.weekday - now.getDay() + 7) % 7;
      const candidate = new Date(y, m, d + ahead, schedule.hour, schedule.minute);
      return candidate.getTime() > now.getTime()
        ? candidate
        : new Date(y, m, d + ahead + 7, schedule.hour, schedule.minute);
    }
    case 'hourly': {
      const slot = Math.floor(now.getHours() / schedule.everyHours) * schedule.everyHours + schedule.everyHours;
      const candidate = new Date(y, m, d, slot, 0);
      return candidate.getTime() > now.getTime()
        ? candidate
        : new Date(y, m, d, slot + schedule.everyHours, 0);
    }
  }
}

/**
 * Whether a run is owed, as one boolean — so "how many runs are owed" is not a
 * question this module can answer with anything but zero or one.
 *
 * `since` is the later of the approval and the last attempt. A window before
 * somebody approved the routine was not missed; it was never theirs.
 */
export function isRoutineScheduleDue(schedule: RoutineSchedule, since: Date, now: Date): boolean {
  return latestScheduledWindow(schedule, now).getTime() > since.getTime();
}

// ── Per-developer state ──────────────────────────────────────────

/**
 * Where approvals and last runs live.
 *
 * Per developer, in workspace state — never `project_memory/`, which is
 * git-tracked. An approval is one person saying "these steps may run on my
 * machine while I am not looking", and a committed one would let a colleague's
 * yes run code on yours. Last-run state has the reason `ambientTriggers` gives
 * for its seen-set: one developer's run says nothing about whether another's
 * happened.
 */
export const SCHEDULED_ROUTINE_STATE_NOTE =
  'Per developer, in workspace state. Never in project_memory: an approval committed to the repository would let one person approve unattended runs on everybody\'s machine.';

export type ScheduledRunOutcome =
  /** Recorded before the first step, so a crash mid-run still closes the window. */
  | 'running'
  /** Every step ran and passed. */
  | 'completed'
  /** The steps it could run passed; it stopped at one that needs somebody present. */
  | 'needs-a-person'
  | 'failed'
  /** Refused before any step: an unresolved placeholder, a missing worktree. */
  | 'refused'
  /** Dry run was on: recorded as what it would have done, nothing executed. */
  | 'dry-run';

const OUTCOMES: readonly ScheduledRunOutcome[] = ['running', 'completed', 'needs-a-person', 'failed', 'refused', 'dry-run'];

export interface ScheduledRunMemo {
  /** The window this attempt served. */
  windowAt: string;
  attemptedAt: string;
  outcome: ScheduledRunOutcome;
  /** One or two sentences, for a notification and a status line. */
  summary: string;
  branch?: string;
  /** Set only when the worktree was kept because it holds changes or commits. */
  worktreePath?: string;
  /** When somebody said they had read this report. Clears it from the attention feed. */
  reviewedAt?: string;
}

export interface ScheduledRoutineApproval {
  /** {@link routineScheduleFingerprint} of the routine as it was shown. */
  fingerprint: string;
  approvedAt: string;
}

export interface ScheduledRoutineState {
  version: 1;
  approvals: Record<string, ScheduledRoutineApproval>;
  runs: Record<string, ScheduledRunMemo>;
}

export function emptyScheduledRoutineState(): ScheduledRoutineState {
  return { version: 1, approvals: {}, runs: {} };
}

const ROUTINE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const FINGERPRINT = /^[0-9a-f]{64}$/;
const SCHEDULED_BRANCH = /^chore\/scheduled-[a-z0-9-]{1,60}$/;
const MAX_STATE_ENTRIES = 200;

function isoOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 40) {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

function clampText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, max) : '';
}

/**
 * Read stored state, never trusting it.
 *
 * Workspace state is AtlasMind's own, but it outlives versions of AtlasMind and
 * an extension can be handed a corrupted store. An entry that does not parse is
 * **dropped**, which errs safe in both halves: an unreadable approval is no
 * approval (nothing runs until somebody approves again), and an unreadable run
 * is no attempt (at most one run happens, which is what an attempt would have
 * allowed anyway). An unrecognised outcome reads as `failed` — the direction
 * that asks somebody to look rather than the one that reports all was well.
 */
export function sanitizeScheduledRoutineState(raw: unknown): ScheduledRoutineState {
  const state = emptyScheduledRoutineState();
  if (!raw || typeof raw !== 'object') {
    return state;
  }
  const record = raw as Record<string, unknown>;

  const approvals = record['approvals'];
  if (approvals && typeof approvals === 'object') {
    for (const [id, value] of Object.entries(approvals as Record<string, unknown>).slice(0, MAX_STATE_ENTRIES)) {
      if (!ROUTINE_ID.test(id) || !value || typeof value !== 'object') {
        continue;
      }
      const entry = value as Record<string, unknown>;
      const approvedAt = isoOrUndefined(entry['approvedAt']);
      const fingerprint = typeof entry['fingerprint'] === 'string' ? entry['fingerprint'] : '';
      if (approvedAt && FINGERPRINT.test(fingerprint)) {
        state.approvals[id] = { fingerprint, approvedAt };
      }
    }
  }

  const runs = record['runs'];
  if (runs && typeof runs === 'object') {
    for (const [id, value] of Object.entries(runs as Record<string, unknown>).slice(0, MAX_STATE_ENTRIES)) {
      if (!ROUTINE_ID.test(id) || !value || typeof value !== 'object') {
        continue;
      }
      const entry = value as Record<string, unknown>;
      const windowAt = isoOrUndefined(entry['windowAt']);
      const attemptedAt = isoOrUndefined(entry['attemptedAt']);
      if (!windowAt || !attemptedAt) {
        continue;
      }
      const outcome = OUTCOMES.includes(entry['outcome'] as ScheduledRunOutcome)
        ? entry['outcome'] as ScheduledRunOutcome
        : 'failed';
      const branch = typeof entry['branch'] === 'string' && SCHEDULED_BRANCH.test(entry['branch']) ? entry['branch'] : undefined;
      const worktreePath = clampText(entry['worktreePath'], 500);
      const reviewedAt = isoOrUndefined(entry['reviewedAt']);
      state.runs[id] = {
        windowAt,
        attemptedAt,
        outcome,
        summary: clampText(entry['summary'], 500),
        ...(branch ? { branch } : {}),
        ...(worktreePath ? { worktreePath } : {}),
        ...(reviewedAt ? { reviewedAt } : {}),
      };
    }
  }
  return state;
}

/**
 * What an approval is an approval *of*: the schedule and every step, exactly.
 *
 * Not the name or the description — renaming a routine changes nothing it
 * does. A step's command, its label (which is what the approval dialog showed)
 * or its failure policy changing does, and invalidates the approval, because a
 * routine file is an ordinary file under `project_memory/` that a model with
 * `file-write` can author. The moment somebody approves is the only moment the
 * steps were read; a step added afterwards was not.
 */
export function routineScheduleFingerprint(routine: Pick<RoutineDefinition, 'schedule' | 'steps'>): string {
  const canonical = JSON.stringify({
    schedule: routine.schedule ?? '',
    steps: (routine.steps ?? []).map(step => [step.id, step.label, step.run, step.on_fail]),
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

// ── The board ────────────────────────────────────────────────────

export type RoutineScheduleState =
  /** The declared schedule does not parse. */
  | 'invalid'
  /** Scheduling is switched off for this developer. */
  | 'off'
  /** Never approved to run unattended. */
  | 'not-approved'
  /** Approved, then edited. The steps that would run are not the ones approved. */
  | 'changed'
  /** Cannot run for a stated reason outside the routine. */
  | 'blocked'
  | 'running'
  /** Due, and queued behind another scheduled run. */
  | 'waiting'
  | 'due'
  | 'current';

export interface RoutineScheduleEntry {
  routineId: string;
  routineName: string;
  /** As written in the routine file. */
  scheduleText: string;
  /** Present when the schedule parsed. Always names the zone. */
  description?: string;
  state: RoutineScheduleState;
  /** Why it is not running, whenever it is not. Named rather than implied. */
  blocker?: string;
  /** Said alongside a due run, e.g. that a dry run will record rather than execute it. */
  note?: string;
  latestWindowAt?: string;
  nextWindowAt?: string;
  approvedAt?: string;
  lastRun?: ScheduledRunMemo;
  /**
   * The last run's outcome as it stands now. `running` in the stored memo but
   * not running in this process means the editor closed or the host crashed
   * mid-run, which is reported as `interrupted` rather than as still going.
   */
  lastOutcome?: ScheduledRunOutcome | 'interrupted';
}

export interface RoutineScheduleBoardInput {
  routines: readonly RoutineDefinition[];
  /** `atlasmind.routines.scheduling.enabled`. Deny by default. */
  enabled: boolean;
  workspaceTrusted: boolean;
  /** Whether dry run is on. Not a blocker: a due run is recorded instead of executed. */
  dryRun: boolean;
  /** The routine a scheduled run is executing right now, if any. */
  runningRoutineId?: string;
  state: ScheduledRoutineState;
  now: Date;
  timeZone?: string;
}

export interface RoutineScheduleBoard {
  enabled: boolean;
  /** Only routines that declare a schedule. Order follows the routine list. */
  entries: RoutineScheduleEntry[];
  summary: string;
}

export function buildRoutineScheduleBoard(input: RoutineScheduleBoardInput): RoutineScheduleBoard {
  const entries: RoutineScheduleEntry[] = [];
  for (const routine of input.routines) {
    if (typeof routine.schedule !== 'string' || routine.schedule.trim().length === 0) {
      continue;
    }
    const lastRun = input.state.runs[routine.id];
    const lastOutcome = lastRun
      ? (lastRun.outcome === 'running' && input.runningRoutineId !== routine.id ? 'interrupted' as const : lastRun.outcome)
      : undefined;
    const base = {
      routineId: routine.id,
      routineName: routine.name,
      scheduleText: routine.schedule.trim(),
      ...(lastRun ? { lastRun } : {}),
      ...(lastOutcome ? { lastOutcome } : {}),
    };

    const parsed = parseRoutineSchedule(routine.schedule);
    if (!parsed.ok) {
      entries.push({ ...base, state: 'invalid', blocker: parsed.reason });
      continue;
    }
    const schedule = parsed.schedule;
    const description = describeRoutineSchedule(schedule, input.timeZone);
    const latest = latestScheduledWindow(schedule, input.now);
    const timed = {
      ...base,
      description,
      latestWindowAt: latest.toISOString(),
      nextWindowAt: nextScheduledWindow(schedule, input.now).toISOString(),
    };

    if (!input.enabled) {
      entries.push({
        ...timed,
        state: 'off',
        blocker: 'Scheduled routines are switched off (atlasmind.routines.scheduling.enabled).',
      });
      continue;
    }
    const approval = input.state.approvals[routine.id];
    if (!approval) {
      entries.push({
        ...timed,
        state: 'not-approved',
        blocker: 'You have not approved this routine to run unattended. The file asks; it does not decide.',
      });
      continue;
    }
    const withApproval = { ...timed, approvedAt: approval.approvedAt };
    if (approval.fingerprint !== routineScheduleFingerprint(routine)) {
      entries.push({
        ...withApproval,
        state: 'changed',
        blocker: 'The routine has changed since you approved it, so the steps that would run are not the ones you read. '
          + 'Approve it again to resume.',
      });
      continue;
    }
    if (!input.workspaceTrusted) {
      entries.push({
        ...withApproval,
        state: 'blocked',
        blocker: 'This workspace is not trusted, and a scheduled run executes its commands.',
      });
      continue;
    }
    if (input.runningRoutineId === routine.id) {
      entries.push({ ...withApproval, state: 'running' });
      continue;
    }

    const since = Math.max(
      Date.parse(approval.approvedAt),
      lastRun ? Date.parse(lastRun.attemptedAt) : Number.NEGATIVE_INFINITY,
    );
    const due = isRoutineScheduleDue(schedule, new Date(since), input.now);
    if (!due) {
      entries.push({ ...withApproval, state: 'current' });
      continue;
    }
    if (input.runningRoutineId !== undefined) {
      entries.push({
        ...withApproval,
        state: 'waiting',
        blocker: 'Another scheduled run is in progress. Scheduled runs go one at a time.',
      });
      continue;
    }
    entries.push({
      ...withApproval,
      state: 'due',
      ...(input.dryRun ? { note: 'Dry run is on: when this runs it is recorded as what it would have done, and nothing executes.' } : {}),
    });
  }
  return { enabled: input.enabled, entries, summary: summarizeBoard(input.enabled, entries) };
}

function summarizeBoard(enabled: boolean, entries: readonly RoutineScheduleEntry[]): string {
  if (entries.length === 0) {
    return 'No routine declares a schedule.';
  }
  if (!enabled) {
    return `${entries.length} routine${entries.length === 1 ? ' declares' : 's declare'} a schedule; scheduled routines are switched off.`;
  }
  const count = (state: RoutineScheduleState): number => entries.filter(entry => entry.state === state).length;
  const parts: string[] = [];
  for (const [state, label] of [
    ['due', 'due'],
    ['running', 'running'],
    ['waiting', 'waiting for another run'],
    ['current', 'up to date'],
    ['changed', 'changed since you approved it'],
    ['not-approved', 'awaiting your approval'],
    ['blocked', 'blocked'],
    ['invalid', 'with an unreadable schedule'],
  ] as const) {
    const n = count(state);
    if (n > 0) {
      parts.push(`${n} ${label}`);
    }
  }
  // Ambient, said every time: a schedule that reads "every day at 02:00" with
  // no qualifier is a promise this extension cannot keep with the editor shut.
  return `${parts.join(', ')}. Runs only while the editor is open.`;
}

/**
 * The one routine a tick may run, or nothing.
 *
 * **One at a time, deliberately.** Three routines due at 02:00 run on three
 * successive ticks, never together: each makes a worktree and runs commands,
 * and parallel unattended runs are how a laptop that was asleep wakes up to
 * three package installs fighting over one disk. The oldest window goes first;
 * ties break on routine id so the choice cannot shuffle between ticks.
 */
export function nextScheduledRoutine(board: RoutineScheduleBoard): RoutineScheduleEntry | undefined {
  const due = board.entries.filter(entry => entry.state === 'due');
  due.sort((a, b) => (a.latestWindowAt ?? '').localeCompare(b.latestWindowAt ?? '')
    || a.routineId.localeCompare(b.routineId));
  return due[0];
}

/**
 * The attention-feed group, or `undefined`.
 *
 * `undefined` when scheduling is switched off, for the reason research gives:
 * this is a group whose absence means *decided against*, not *not assessed*, and
 * a zeroed group would make a disabled feature look like it had been checked.
 * A report somebody has marked reviewed stops counting; nothing else clears one
 * except the next run replacing it.
 */
export function scheduledRoutineAttentionInput(
  board: RoutineScheduleBoard,
): { failed: number; needsYou: number; changed: number } | undefined {
  if (!board.enabled) {
    return undefined;
  }
  const approved = board.entries.filter(entry => entry.approvedAt !== undefined);
  const unreviewed = approved.filter(entry => entry.lastRun && !entry.lastRun.reviewedAt);
  return {
    failed: unreviewed.filter(entry => entry.lastOutcome === 'failed' || entry.lastOutcome === 'interrupted').length,
    needsYou: unreviewed.filter(entry => entry.lastOutcome === 'needs-a-person'
      || entry.lastOutcome === 'refused'
      || (entry.lastOutcome === 'completed' && entry.lastRun?.worktreePath !== undefined)).length,
    changed: approved.filter(entry => entry.state === 'changed').length,
  };
}
