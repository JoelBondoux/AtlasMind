import { describe, expect, it } from 'vitest';

import { RESEARCH_SCANS } from '../../src/core/researchScanCatalog.js';
import {
  recordScanRun,
  seedResearchRegister,
  type ResearchRegister,
} from '../../src/core/researchRegister.js';
import {
  buildResearchSchedule,
  minAutomationLevel,
  nextAutomaticScan,
  sanitizeResearchScanSettings,
  type ResearchScheduleInput,
} from '../../src/core/researchSchedule.js';

const NOW = new Date('2026-07-30T12:00:00.000Z');

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function registerWithRun(
  scanId: 'competition' | 'market' | 'regulatory',
  days: number,
  outcome: 'ok' | 'failed' | 'no-source' = 'ok',
): ResearchRegister {
  return recordScanRun(seedResearchRegister(NOW), {
    scanId, ranAt: daysAgo(days), outcome, findingCount: 0, questionCount: 0,
  });
}

function input(overrides: Partial<ResearchScheduleInput> = {}): ResearchScheduleInput {
  return {
    enabled: true,
    masterLevel: 'auto',
    scans: Object.fromEntries(RESEARCH_SCANS.map(scan => [scan.id, { enabled: true, automationLevel: 'auto' as const }])),
    register: seedResearchRegister(NOW),
    sourceAvailable: true,
    monthlySpendCapUsd: 10,
    spentThisMonthUsd: 0,
    now: NOW,
    ...overrides,
  };
}

function statusOf(schedule: ReturnType<typeof buildResearchSchedule>, scanId: string) {
  return schedule.scans.find(scan => scan.scanId === scanId)!;
}

describe('the gates come first, and each names itself', () => {
  it('reports every scan disabled when the master gate is off', () => {
    const schedule = buildResearchSchedule(input({ enabled: false }));
    expect(schedule.scans.every(scan => scan.state === 'disabled')).toBe(true);
    expect(schedule.scans[0]!.blocker).toContain('atlasmind.research.enabled');
    expect(schedule.summary).toBe('Research is switched off.');
  });

  it('treats a scan nobody switched on as disabled, not as due', () => {
    const schedule = buildResearchSchedule(input({ scans: {} }));
    expect(schedule.dueNow).toHaveLength(0);
    expect(statusOf(schedule, 'market').state).toBe('disabled');
  });

  it('blocks rather than quietly never becoming due when no source exists', () => {
    const schedule = buildResearchSchedule(input({ sourceAvailable: false }));
    expect(statusOf(schedule, 'market').state).toBe('blocked');
    expect(statusOf(schedule, 'market').blocker).toContain('could only guess');
  });

  it('blocks automatic runs when nothing may be spent', () => {
    const schedule = buildResearchSchedule(input({ monthlySpendCapUsd: 0 }));
    expect(statusOf(schedule, 'market').state).toBe('blocked');
    const spent = buildResearchSchedule(input({ monthlySpendCapUsd: 5, spentThisMonthUsd: 5 }));
    expect(statusOf(spent, 'market').blocker).toContain('spend cap');
  });

  it('does not block a spend cap for a scan that would never spend automatically', () => {
    // `observe` costs nothing, so the cap is irrelevant to it.
    const schedule = buildResearchSchedule(input({ masterLevel: 'observe', monthlySpendCapUsd: 0 }));
    expect(statusOf(schedule, 'market').state).toBe('never');
  });
});

describe('never assessed is not the same as up to date', () => {
  it('reports never for a scan that has produced no answer', () => {
    const schedule = buildResearchSchedule(input());
    expect(schedule.neverScanned).toHaveLength(RESEARCH_SCANS.length);
    expect(schedule.summary).toContain('never assessed');
  });

  it('does not count a failed attempt as an assessment', () => {
    const schedule = buildResearchSchedule(input({ register: registerWithRun('market', 1, 'failed') }));
    expect(statusOf(schedule, 'market').state).toBe('never');
    // The attempt is still reported, because "tried yesterday and got nothing" matters.
    expect(statusOf(schedule, 'market').daysSinceRun).toBe(1);
  });
});

describe('due-ness is derived, never accumulated', () => {
  it('is current inside the cadence and due past it', () => {
    const fresh = buildResearchSchedule(input({ register: registerWithRun('competition', 5) }));
    expect(statusOf(fresh, 'competition').state).toBe('current');
    expect(statusOf(fresh, 'competition').dueInDays).toBe(25);

    const stale = buildResearchSchedule(input({ register: registerWithRun('competition', 45) }));
    expect(statusOf(stale, 'competition').state).toBe('due');
    expect(statusOf(stale, 'competition').dueInDays).toBe(-15);
  });

  it('turns six missed windows into one due scan, not six', () => {
    // Six weeks with the editor closed on a 30-day cadence is two windows'
    // worth of elapsed time and exactly one thing to do about it.
    const schedule = buildResearchSchedule(input({ register: registerWithRun('competition', 180) }));
    expect(schedule.dueNow.filter(scan => scan.scanId === 'competition')).toHaveLength(1);
  });

  it('measures from the last run that answered, not the last attempt', () => {
    let register = registerWithRun('market', 200, 'ok');
    register = { ...register, runs: [...register.runs, { scanId: 'market', ranAt: daysAgo(1), outcome: 'failed', findingCount: 0, questionCount: 0 }] };
    const schedule = buildResearchSchedule(input({ register }));
    // A failed attempt yesterday must not reset a clock that last ticked in January.
    expect(statusOf(schedule, 'market').state).toBe('due');
  });

  it('honours a declared cadence override and clamps a nonsensical one', () => {
    const schedule = buildResearchSchedule(input({
      register: registerWithRun('competition', 5),
      scans: { competition: { enabled: true, cadenceDays: 2, automationLevel: 'observe' } },
    }));
    expect(statusOf(schedule, 'competition').state).toBe('due');

    const clamped = buildResearchSchedule(input({
      scans: { competition: { enabled: true, cadenceDays: -9000, automationLevel: 'observe' } },
    }));
    expect(statusOf(clamped, 'competition').cadenceDays).toBe(1);
  });
});

describe('the ceiling states every reduction it makes', () => {
  it('caps a scan to the master level and says so', () => {
    const schedule = buildResearchSchedule(input({
      masterLevel: 'propose',
      scans: { market: { enabled: true, automationLevel: 'auto' } },
    }));
    const market = statusOf(schedule, 'market');
    expect(market.effectiveLevel).toBe('propose');
    expect(market.levelReason).toContain('capped to `propose`');
  });

  it('says nothing when the scan got what it asked for', () => {
    const schedule = buildResearchSchedule(input({ masterLevel: 'auto' }));
    expect(statusOf(schedule, 'market').levelReason).toBeUndefined();
  });

  it('takes the lower of two rungs', () => {
    expect(minAutomationLevel('auto', 'observe')).toBe('observe');
    expect(minAutomationLevel('propose', 'auto')).toBe('propose');
    expect(minAutomationLevel('auto', 'auto')).toBe('auto');
  });
});

describe('an automatic pass runs one scan', () => {
  it('picks nothing when nothing is at auto', () => {
    const schedule = buildResearchSchedule(input({ masterLevel: 'observe' }));
    expect(nextAutomaticScan(schedule)).toBeUndefined();
  });

  it('prefers never-assessed over merely overdue', () => {
    const schedule = buildResearchSchedule(input({ register: registerWithRun('competition', 400) }));
    const next = nextAutomaticScan(schedule);
    expect(next?.state).toBe('never');
    expect(next?.scanId).not.toBe('competition');
  });

  it('breaks ties on catalog order so the choice cannot shuffle', () => {
    const first = nextAutomaticScan(buildResearchSchedule(input()));
    const second = nextAutomaticScan(buildResearchSchedule(input()));
    expect(first?.scanId).toBe(RESEARCH_SCANS[0]!.id);
    expect(second?.scanId).toBe(first?.scanId);
  });
});

describe('settings are a boundary', () => {
  it('drops unknown scan ids and coerces a malformed level to observe', () => {
    const settings = sanitizeResearchScanSettings({
      market: { enabled: true, automationLevel: 'auto' },
      gap: { enabled: true },
      regulatory: { enabled: 'yes', automationLevel: 'yolo' },
      nonsense: 42,
    });
    expect(Object.keys(settings).sort()).toEqual(['market', 'regulatory']);
    expect(settings['market']!.automationLevel).toBe('auto');
    expect(settings['regulatory']!.automationLevel).toBe('observe');
    // `enabled: 'yes'` is not `true`, and deny-by-default means it stays off.
    expect(settings['regulatory']!.enabled).toBe(false);
  });

  it('survives junk', () => {
    expect(sanitizeResearchScanSettings(null)).toEqual({});
    expect(sanitizeResearchScanSettings('nope')).toEqual({});
  });
});
