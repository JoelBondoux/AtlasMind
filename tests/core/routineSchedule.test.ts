import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  ROUTINE_SCHEDULE_GRAMMAR,
  SCHEDULED_ROUTINE_STATE_NOTE,
  buildRoutineScheduleBoard,
  describeRoutineSchedule,
  emptyScheduledRoutineState,
  isRoutineScheduleDue,
  latestScheduledWindow,
  nextScheduledRoutine,
  nextScheduledWindow,
  parseRoutineSchedule,
  routineScheduleFingerprint,
  sanitizeScheduledRoutineState,
  scheduledRoutineAttentionInput,
  type RoutineSchedule,
  type RoutineScheduleBoardInput,
  type ScheduledRoutineState,
} from '../../src/core/routineSchedule.ts';
import type { RoutineDefinition } from '../../src/types.ts';

/** Local-time constructor, so these tests mean the same thing in every time zone. */
const at = (y: number, mo: number, d: number, h = 0, mi = 0): Date => new Date(y, mo - 1, d, h, mi);

function parsed(text: string): RoutineSchedule {
  const result = parseRoutineSchedule(text);
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result.schedule;
}

describe('the grammar is small, declared, and validated rather than coerced', () => {
  it('reads the three declared forms', () => {
    expect(parsed('daily at 02:00')).toEqual({ kind: 'daily', hour: 2, minute: 0 });
    expect(parsed('weekly on monday at 09:30')).toEqual({ kind: 'weekly', weekday: 1, hour: 9, minute: 30 });
    expect(parsed('weekly on Sun at 23:59')).toEqual({ kind: 'weekly', weekday: 0, hour: 23, minute: 59 });
    expect(parsed('every 6 hours')).toEqual({ kind: 'hourly', everyHours: 6 });
    expect(parsed('every 1 hour')).toEqual({ kind: 'hourly', everyHours: 1 });
  });

  it('normalises case and whitespace, and nothing else', () => {
    expect(parsed('  Daily   AT 02:00 ')).toEqual({ kind: 'daily', hour: 2, minute: 0 });
  });

  it.each([
    ['daily at 2:00', /not a schedule/],
    ['daily at 24:00', /hours run 00 to 23/],
    ['daily at 12:60', /minutes run 00 to 59/],
    ['weekly on someday at 09:00', /not a day of the week/],
    ['every 5 hours', /divide a day evenly/],
    ['every 24 hours', /divide a day evenly/],
    ['hourly', /not a schedule/],
    ['', /No schedule/],
  ])('refuses %j with a reason', (text, reason) => {
    const result = parseRoutineSchedule(text);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toMatch(reason);
  });

  it('refuses cron by name rather than half-understanding it', () => {
    for (const cron of ['0 2 * * *', '*/15 * * * *', '0 9 * * 1-5']) {
      const result = parseRoutineSchedule(cron);
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.reason).toMatch(/looks like cron/);
    }
  });

  it('quotes the published grammar in a refusal', () => {
    const result = parseRoutineSchedule('whenever');
    expect(result.ok ? '' : result.reason).toContain(ROUTINE_SCHEDULE_GRAMMAR[0]!);
  });

  it('never throws, whatever it is handed', () => {
    fc.assert(fc.property(fc.anything(), value => {
      const result = parseRoutineSchedule(value);
      return typeof result.ok === 'boolean';
    }));
  });

  it('always names the time zone when it describes a schedule', () => {
    expect(describeRoutineSchedule(parsed('daily at 02:00'), 'Europe/London')).toBe('Every day at 02:00 (local time, Europe/London)');
    expect(describeRoutineSchedule(parsed('weekly on friday at 17:05'))).toBe('Every Friday at 17:05 (local time)');
    expect(describeRoutineSchedule(parsed('every 1 hour'))).toContain('Every hour');
    expect(describeRoutineSchedule(parsed('every 4 hours'))).toContain('Every 4 hours from midnight');
  });
});

describe('windows fall in local time', () => {
  it('daily: today when it has passed, yesterday when it has not', () => {
    const schedule = parsed('daily at 02:00');
    expect(latestScheduledWindow(schedule, at(2026, 10, 8, 3))).toEqual(at(2026, 10, 8, 2));
    expect(latestScheduledWindow(schedule, at(2026, 10, 8, 1))).toEqual(at(2026, 10, 7, 2));
    expect(nextScheduledWindow(schedule, at(2026, 10, 8, 1))).toEqual(at(2026, 10, 8, 2));
    expect(nextScheduledWindow(schedule, at(2026, 10, 8, 2))).toEqual(at(2026, 10, 9, 2));
  });

  it('weekly: back to the most recent named day', () => {
    const schedule = parsed('weekly on monday at 09:00');
    // 2026-10-08 is a Thursday.
    expect(latestScheduledWindow(schedule, at(2026, 10, 8, 12))).toEqual(at(2026, 10, 5, 9));
    expect(latestScheduledWindow(schedule, at(2026, 10, 5, 8))).toEqual(at(2026, 9, 28, 9));
    expect(nextScheduledWindow(schedule, at(2026, 10, 8, 12))).toEqual(at(2026, 10, 12, 9));
  });

  it('every N hours: on the same clock times every day', () => {
    const schedule = parsed('every 6 hours');
    expect(latestScheduledWindow(schedule, at(2026, 10, 8, 13, 30))).toEqual(at(2026, 10, 8, 12));
    expect(nextScheduledWindow(schedule, at(2026, 10, 8, 13, 30))).toEqual(at(2026, 10, 8, 18));
    expect(nextScheduledWindow(schedule, at(2026, 10, 8, 23))).toEqual(at(2026, 10, 9, 0));
  });

  const schedules = fc.oneof(
    fc.record({ kind: fc.constant('daily' as const), hour: fc.integer({ min: 0, max: 23 }), minute: fc.integer({ min: 0, max: 59 }) }),
    fc.record({
      kind: fc.constant('weekly' as const),
      weekday: fc.integer({ min: 0, max: 6 }),
      hour: fc.integer({ min: 0, max: 23 }),
      minute: fc.integer({ min: 0, max: 59 }),
    }),
    fc.record({ kind: fc.constant('hourly' as const), everyHours: fc.constantFrom(1, 2, 3, 4, 6, 8, 12) }),
  );
  const instants = fc.integer({ min: Date.UTC(2024, 0, 1), max: Date.UTC(2030, 0, 1) }).map(ms => new Date(ms));

  it('brackets now: the latest window is at or before it, the next strictly after', () => {
    fc.assert(fc.property(schedules, instants, (schedule, now) => {
      return latestScheduledWindow(schedule, now).getTime() <= now.getTime()
        && nextScheduledWindow(schedule, now).getTime() > now.getTime();
    }));
  });
});

describe('a missed window is not a backlog', () => {
  const schedules = fc.oneof(
    fc.constant(parsed('daily at 02:00')),
    fc.constant(parsed('weekly on wednesday at 18:15')),
    fc.constant(parsed('every 3 hours')),
    fc.constant(parsed('every 1 hour')),
  );

  /**
   * Simulates an editor that is open at arbitrary, irregular moments over a
   * month — including long gaps with it closed — and runs whenever the module
   * says a run is owed. Two properties must hold whatever the pattern:
   * between two consecutive windows there is at most one run, and the first
   * tick after any gap produces exactly one run, never one per missed window.
   */
  it('never runs more than once per window, however the editor was opened', () => {
    fc.assert(fc.property(
      schedules,
      fc.array(fc.integer({ min: 0, max: 30 * 24 * 60 }), { minLength: 1, maxLength: 120 }),
      (schedule, minuteOffsets) => {
        const start = at(2026, 3, 1);
        const ticks = [...new Set(minuteOffsets)].sort((a, b) => a - b)
          .map(offset => new Date(start.getTime() + offset * 60_000));
        const approvedAt = start;
        let lastAttempt: Date | undefined;
        const runs: Date[] = [];
        for (const tick of ticks) {
          const since = lastAttempt && lastAttempt > approvedAt ? lastAttempt : approvedAt;
          if (isRoutineScheduleDue(schedule, since, tick)) {
            runs.push(tick);
            lastAttempt = tick;
          }
        }
        // At most one run per window: the windows the runs fall in are all distinct.
        const windows = runs.map(run => latestScheduledWindow(schedule, run).getTime());
        return new Set(windows).size === windows.length;
      },
    ));
  });

  it('catches up exactly once after a long gap', () => {
    const schedule = parsed('daily at 02:00');
    const lastRun = at(2026, 10, 1, 2, 5);
    // Six nights missed with the editor closed.
    const reopened = at(2026, 10, 8, 9);
    expect(isRoutineScheduleDue(schedule, lastRun, reopened)).toBe(true);
    // Having run once at reopening, nothing else is owed until tomorrow.
    expect(isRoutineScheduleDue(schedule, reopened, at(2026, 10, 8, 23, 59))).toBe(false);
    expect(isRoutineScheduleDue(schedule, reopened, at(2026, 10, 9, 2))).toBe(true);
  });

  it('owes nothing for a window before the routine was approved', () => {
    const schedule = parsed('daily at 02:00');
    expect(isRoutineScheduleDue(schedule, at(2026, 10, 8, 10), at(2026, 10, 8, 11))).toBe(false);
  });

  it('an attempt closes its window, whatever it produced', () => {
    fc.assert(fc.property(schedules, fc.integer({ min: 0, max: 60 * 24 * 14 }), (schedule, offset) => {
      const attempt = new Date(at(2026, 5, 1).getTime() + offset * 60_000);
      const stillThisWindow = new Date(nextScheduledWindow(schedule, attempt).getTime() - 1);
      return !isRoutineScheduleDue(schedule, attempt, stillThisWindow);
    }));
  });
});

// ── The board ────────────────────────────────────────────────────

const DAILY: RoutineDefinition = {
  id: 'nightly',
  name: 'Nightly check',
  description: '',
  schedule: 'daily at 02:00',
  steps: [{ id: 'outdated', label: 'Outdated', run: 'npm outdated', on_fail: 'continue' }],
};

function approved(routine: RoutineDefinition, approvedAt: Date): ScheduledRoutineState {
  const state = emptyScheduledRoutineState();
  state.approvals[routine.id] = { fingerprint: routineScheduleFingerprint(routine), approvedAt: approvedAt.toISOString() };
  return state;
}

function board(overrides: Partial<RoutineScheduleBoardInput> = {}) {
  return buildRoutineScheduleBoard({
    routines: [DAILY],
    enabled: true,
    workspaceTrusted: true,
    dryRun: false,
    state: approved(DAILY, at(2026, 10, 6, 12)),
    now: at(2026, 10, 8, 3),
    timeZone: 'Europe/London',
    ...overrides,
  });
}

describe('the file asks; the settings and the developer decide', () => {
  it('lists only routines that declare a schedule', () => {
    const plain: RoutineDefinition = { ...DAILY, id: 'plain', schedule: undefined };
    expect(board({ routines: [DAILY, plain] }).entries.map(entry => entry.routineId)).toEqual(['nightly']);
  });

  it('is off until the master setting is on, and says which setting', () => {
    const entry = board({ enabled: false }).entries[0]!;
    expect(entry.state).toBe('off');
    expect(entry.blocker).toContain('atlasmind.routines.scheduling.enabled');
    expect(nextScheduledRoutine(board({ enabled: false }))).toBeUndefined();
  });

  it('is not approved until this developer approves it', () => {
    const entry = board({ state: emptyScheduledRoutineState() }).entries[0]!;
    expect(entry.state).toBe('not-approved');
    expect(entry.blocker).toMatch(/not approved/);
  });

  it('withdraws an approval when any step changes after it', () => {
    const edited: RoutineDefinition = { ...DAILY, steps: [{ ...DAILY.steps[0]!, run: 'npm outdated && curl evil' }] };
    const entry = board({ routines: [edited] }).entries[0]!;
    expect(entry.state).toBe('changed');
    expect(entry.blocker).toMatch(/not the ones you read/);
  });

  it('is unchanged by renaming, which changes nothing it does', () => {
    const renamed: RoutineDefinition = { ...DAILY, name: 'Renamed', description: 'different' };
    expect(routineScheduleFingerprint(renamed)).toBe(routineScheduleFingerprint(DAILY));
    expect(routineScheduleFingerprint({ ...DAILY, schedule: 'daily at 03:00' })).not.toBe(routineScheduleFingerprint(DAILY));
  });

  it('is blocked in an untrusted workspace, and says why', () => {
    const entry = board({ workspaceTrusted: false }).entries[0]!;
    expect(entry.state).toBe('blocked');
    expect(entry.blocker).toMatch(/not trusted/);
  });

  it('reports an unreadable schedule with the parser\'s reason, even when switched off', () => {
    const entry = board({ routines: [{ ...DAILY, schedule: '0 2 * * *' }], enabled: false }).entries[0]!;
    expect(entry.state).toBe('invalid');
    expect(entry.blocker).toMatch(/cron/);
  });

  it('is due after a window it has not served, and names the zone', () => {
    const entry = board().entries[0]!;
    expect(entry.state).toBe('due');
    expect(entry.description).toContain('Europe/London');
    expect(nextScheduledRoutine(board())?.routineId).toBe('nightly');
  });

  it('is current once the window has an attempt', () => {
    const state = approved(DAILY, at(2026, 10, 6, 12));
    state.runs[DAILY.id] = { windowAt: at(2026, 10, 8, 2).toISOString(), attemptedAt: at(2026, 10, 8, 2, 1).toISOString(), outcome: 'failed', summary: 'x' };
    expect(board({ state }).entries[0]!.state).toBe('current');
  });

  it('notes, rather than blocks, a dry run', () => {
    const entry = board({ dryRun: true }).entries[0]!;
    expect(entry.state).toBe('due');
    expect(entry.note).toMatch(/recorded/);
  });

  it('runs one at a time: a due routine waits while another runs', () => {
    const other: RoutineDefinition = { ...DAILY, id: 'other', name: 'Other' };
    const state = approved(DAILY, at(2026, 10, 6, 12));
    state.approvals[other.id] = { fingerprint: routineScheduleFingerprint(other), approvedAt: at(2026, 10, 6, 12).toISOString() };
    const result = board({ routines: [DAILY, other], state, runningRoutineId: 'other' });
    expect(result.entries.find(entry => entry.routineId === 'nightly')!.state).toBe('waiting');
    expect(result.entries.find(entry => entry.routineId === 'other')!.state).toBe('running');
    expect(nextScheduledRoutine(result)).toBeUndefined();
  });

  it('picks exactly one due routine, oldest window first, ties on id', () => {
    const weekly: RoutineDefinition = { ...DAILY, id: 'aaa-weekly', schedule: 'weekly on monday at 09:00' };
    const b: RoutineDefinition = { ...DAILY, id: 'b' };
    const state = emptyScheduledRoutineState();
    for (const routine of [DAILY, weekly, b]) {
      state.approvals[routine.id] = { fingerprint: routineScheduleFingerprint(routine), approvedAt: at(2026, 9, 1).toISOString() };
    }
    const result = board({ routines: [DAILY, weekly, b], state });
    expect(result.entries.filter(entry => entry.state === 'due')).toHaveLength(3);
    expect(nextScheduledRoutine(result)?.routineId).toBe('aaa-weekly');
  });

  it('reports a run left `running` by a crashed host as interrupted', () => {
    const state = approved(DAILY, at(2026, 10, 6, 12));
    state.runs[DAILY.id] = { windowAt: at(2026, 10, 8, 2).toISOString(), attemptedAt: at(2026, 10, 8, 2).toISOString(), outcome: 'running', summary: '' };
    expect(board({ state }).entries[0]!.lastOutcome).toBe('interrupted');
  });

  it('says it runs only while the editor is open', () => {
    expect(board().summary).toMatch(/only while the editor is open/);
    expect(board({ routines: [] }).summary).toBe('No routine declares a schedule.');
  });
});

describe('state is per developer and read defensively', () => {
  it('says where it must live', () => {
    expect(SCHEDULED_ROUTINE_STATE_NOTE).toMatch(/workspace state/);
    expect(SCHEDULED_ROUTINE_STATE_NOTE).toMatch(/Never in project_memory/);
  });

  it('drops an unreadable approval rather than trusting it', () => {
    const state = sanitizeScheduledRoutineState({
      approvals: {
        ok: { fingerprint: 'a'.repeat(64), approvedAt: '2026-10-01T00:00:00.000Z' },
        short: { fingerprint: 'abc', approvedAt: '2026-10-01T00:00:00.000Z' },
        'bad id/..': { fingerprint: 'a'.repeat(64), approvedAt: '2026-10-01T00:00:00.000Z' },
        nodate: { fingerprint: 'a'.repeat(64), approvedAt: 'yesterday' },
      },
    });
    expect(Object.keys(state.approvals)).toEqual(['ok']);
  });

  it('reads an unrecognised outcome as failed, and refuses a branch outside chore/scheduled-', () => {
    const state = sanitizeScheduledRoutineState({
      runs: {
        r: {
          windowAt: '2026-10-08T02:00:00.000Z',
          attemptedAt: '2026-10-08T02:00:01.000Z',
          outcome: 'fine-honestly',
          summary: 'line\u0000with control',
          branch: 'main',
        },
      },
    });
    expect(state.runs['r']).toMatchObject({ outcome: 'failed', summary: 'linewith control' });
    expect(state.runs['r']!.branch).toBeUndefined();
  });

  it('never throws, and round-trips what it accepts', () => {
    fc.assert(fc.property(fc.anything(), raw => {
      const once = sanitizeScheduledRoutineState(raw);
      return JSON.stringify(sanitizeScheduledRoutineState(JSON.parse(JSON.stringify(once)))) === JSON.stringify(once);
    }));
  });
});

describe('the attention group', () => {
  it('is absent when scheduling is switched off — decided against, not overlooked', () => {
    expect(scheduledRoutineAttentionInput(board({ enabled: false }))).toBeUndefined();
  });

  it('counts unreviewed failures, runs waiting for a person, and edits that paused a routine', () => {
    const state = approved(DAILY, at(2026, 10, 6, 12));
    const kept: RoutineDefinition = { ...DAILY, id: 'kept' };
    const stopped: RoutineDefinition = { ...DAILY, id: 'stopped' };
    const reviewed: RoutineDefinition = { ...DAILY, id: 'reviewed' };
    for (const routine of [kept, stopped, reviewed]) {
      state.approvals[routine.id] = { fingerprint: routineScheduleFingerprint(routine), approvedAt: at(2026, 10, 6).toISOString() };
    }
    const memo = { windowAt: at(2026, 10, 8, 2).toISOString(), attemptedAt: at(2026, 10, 8, 2).toISOString(), summary: '' };
    state.runs['nightly'] = { ...memo, outcome: 'failed' };
    state.runs['kept'] = { ...memo, outcome: 'completed', branch: 'chore/scheduled-kept-2026-10-08', worktreePath: '/x' };
    state.runs['stopped'] = { ...memo, outcome: 'needs-a-person' };
    state.runs['reviewed'] = { ...memo, outcome: 'failed', reviewedAt: at(2026, 10, 8, 8).toISOString() };
    const changed: RoutineDefinition = { ...DAILY, id: 'changed' };
    state.approvals['changed'] = { fingerprint: 'f'.repeat(64), approvedAt: at(2026, 10, 6).toISOString() };
    expect(scheduledRoutineAttentionInput(board({ routines: [DAILY, kept, stopped, reviewed, changed], state })))
      .toEqual({ failed: 1, needsYou: 2, changed: 1 });
  });
});
