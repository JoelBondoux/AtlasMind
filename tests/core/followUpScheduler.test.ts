import { describe, expect, it, vi } from 'vitest';
import { summarizeDueFollowUps, buildReminderMessage, FollowUpScheduler } from '../../src/core/followUpScheduler.ts';
import { defaultProjectDirectorConfig } from '../../src/core/projectDirectorManager.ts';
import type { FollowUp, ProjectDirectorConfig } from '../../src/types.ts';

const NOW = new Date('2026-07-24T12:00:00');

function followUp(overrides: Partial<FollowUp>): FollowUp {
  return {
    id: 'fu-1', title: 'Ping', dueDate: '2026-07-24', cadence: 'once', status: 'open',
    linked: { kind: 'none' }, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function configWith(followUps: FollowUp[]): ProjectDirectorConfig {
  return { ...defaultProjectDirectorConfig(), followUps };
}

describe('summarizeDueFollowUps', () => {
  it('counts overdue, due-soon, and total active follow-ups', () => {
    const config = configWith([
      followUp({ id: 'a', dueDate: '2026-07-20' }),                 // overdue
      followUp({ id: 'b', dueDate: '2026-07-25' }),                 // due-soon
      followUp({ id: 'c', dueDate: '2026-09-01' }),                 // upcoming
      followUp({ id: 'd', dueDate: '2026-01-01', status: 'done' }), // excluded
    ]);
    expect(summarizeDueFollowUps(config, NOW)).toEqual({ overdue: 1, dueSoon: 1, total: 3 });
    expect(summarizeDueFollowUps(undefined, NOW)).toEqual({ overdue: 0, dueSoon: 0, total: 0 });
  });
});

describe('buildReminderMessage', () => {
  it('summarises due/overdue, or returns undefined when nothing is due', () => {
    expect(buildReminderMessage({ overdue: 2, dueSoon: 1, total: 3 })).toContain('2 overdue');
    expect(buildReminderMessage({ overdue: 0, dueSoon: 1, total: 1 })).toBe('Project Director: 1 due soon follow-up.');
    expect(buildReminderMessage({ overdue: 0, dueSoon: 0, total: 4 })).toBeUndefined();
  });
});

describe('FollowUpScheduler.runOnce', () => {
  function makeScheduler(config: ProjectDirectorConfig | undefined) {
    let key: string | undefined;
    const notify = vi.fn();
    const scheduler = new FollowUpScheduler({
      getConfig: () => config,
      getLastReminderKey: () => key,
      setLastReminderKey: (k) => { key = k; },
      notify,
      now: () => NOW,
    });
    return { scheduler, notify, getKey: () => key };
  }

  it('nudges once when follow-ups are due, then throttles for the rest of the day', () => {
    const { scheduler, notify, getKey } = makeScheduler(configWith([followUp({ dueDate: '2026-07-20' })]));
    expect(scheduler.runOnce()).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(getKey()).toBe('2026-07-24');
    // Second call the same day is throttled.
    expect(scheduler.runOnce()).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('does not nudge when nothing is due', () => {
    const { scheduler, notify } = makeScheduler(configWith([followUp({ dueDate: '2026-09-01' })]));
    expect(scheduler.runOnce()).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not nudge with no config', () => {
    const { scheduler, notify } = makeScheduler(undefined);
    expect(scheduler.runOnce()).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });
});
