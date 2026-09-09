import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import {
  ESTIMATE_COVERAGE_FLOOR,
  FULL_WEEK_DAYS,
  WORKLOAD_CAVEAT,
  overlapDays,
  parseAllocation,
  summarizeTeamWorkload,
  type RotaEntry,
  type TeamWorkloadInput,
  type WorkloadItem,
} from '../../src/core/teamWorkload';

const SOURCE = readFileSync(
  path.join(process.cwd(), 'src', 'core', 'teamWorkload.ts'),
  'utf8',
);

/** The source with every comment removed, for assertions about what it *does*. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

function input(overrides: Partial<TeamWorkloadInput> = {}): TeamWorkloadInput {
  return {
    members: [{ contactId: 'ann', name: 'Ann', allocation: 'full time' }],
    items: [],
    rota: [],
    windowDays: 14,
    from: '2026-09-07',
    ...overrides,
  };
}

function item(overrides: Partial<WorkloadItem> = {}): WorkloadItem {
  return { id: 'i1', title: 'Something', ownerContactId: 'ann', estimateDays: 1, ...overrides };
}

describe('capacity is declared, never inferred', () => {
  it('reads the forms people actually type', () => {
    expect(parseAllocation('50%')).toMatchObject({ daysPerWeek: 2.5, rule: 'percent' });
    expect(parseAllocation('0.5 FTE')).toMatchObject({ daysPerWeek: 2.5, rule: 'fte' });
    expect(parseAllocation('2 days/wk')).toMatchObject({ daysPerWeek: 2, rule: 'days-per-week' });
    expect(parseAllocation('3 days a week')).toMatchObject({ daysPerWeek: 3, rule: 'days-per-week' });
    expect(parseAllocation('15 hours per week')).toMatchObject({ daysPerWeek: 2, rule: 'hours-per-week' });
    expect(parseAllocation('Full time')).toMatchObject({ daysPerWeek: FULL_WEEK_DAYS, rule: 'full-time' });
    expect(parseAllocation('half-time')).toMatchObject({ daysPerWeek: 2.5, rule: 'half-time' });
  });

  it('leaves an unreadable allocation unknown rather than assuming a full week', () => {
    for (const raw of ['', undefined, 'when I can', 'mornings', '2 days', 'lots', '3 weeks']) {
      const parsed = parseAllocation(raw);
      expect(parsed.daysPerWeek, String(raw)).toBeUndefined();
      expect(parsed.rule, String(raw)).toBe('unreadable');
    }
  });

  it('never reads more than a full week out of an allocation', () => {
    // 150% is somebody making a point, not somebody with seven and a half days.
    expect(parseAllocation('150%').daysPerWeek).toBeUndefined();
    expect(parseAllocation('2 FTE').daysPerWeek).toBeUndefined();
    expect(parseAllocation('7 days/wk').daysPerWeek).toBeUndefined();
    expect(parseAllocation('60 hours per week').daysPerWeek).toBeUndefined();
  });

  it('keeps what was typed so a failed reading can be shown', () => {
    expect(parseAllocation('  when I can  ').raw).toBe('when I can');
  });

  it('derives nothing from activity anywhere in the module', () => {
    // Capacity from commit rate would be surveillance wearing planning's
    // clothes, and wrong as well.
    expect(CODE).not.toMatch(/commit(Count|Rate|sPer)/i);
    expect(CODE).not.toMatch(/velocity/i);
    expect(CODE).not.toMatch(/hoursLogged|timeTracked/i);
  });
});

describe('unknown capacity is not full capacity', () => {
  it('excludes an undeclared member from the verdict rather than calling them free', () => {
    const summary = summarizeTeamWorkload(input({
      members: [{ contactId: 'bo', name: 'Bo' }],
      items: [item({ ownerContactId: 'bo', estimateDays: 40 })],
    }));
    expect(summary.members[0].verdict).toBe('unknown-capacity');
    expect(summary.members[0].availableDays).toBeUndefined();
    expect(summary.over).toBe(0);
    expect(summary.unknownCapacity).toBe(1);
  });

  it('still reads unknown when nothing is assigned', () => {
    const summary = summarizeTeamWorkload(input({ members: [{ contactId: 'bo', name: 'Bo' }] }));
    expect(summary.members[0].verdict).toBe('unknown-capacity');
    expect(summary.members[0].detail).toContain('not the same as having room');
  });

  it('says so on the summary, so a clean-looking reading cannot rest on silence', () => {
    const summary = summarizeTeamWorkload(input({
      members: [
        { contactId: 'ann', name: 'Ann', allocation: 'full time' },
        { contactId: 'bo', name: 'Bo' },
      ],
    }));
    expect(summary.summary).toContain('no allocation recorded');
  });
});

describe('an estimate absent is not an estimate of zero', () => {
  it('never folds an unestimated item into the total', () => {
    const summary = summarizeTeamWorkload(input({
      items: [item({ id: 'a', estimateDays: 2 }), item({ id: 'b', estimateDays: undefined })],
    }));
    expect(summary.members[0].estimatedDays).toBe(2);
    expect(summary.members[0].unestimatedItems).toBe(1);
  });

  it('refuses a total when too little of the work is estimated', () => {
    const items = [
      item({ id: 'a', estimateDays: 1 }),
      item({ id: 'b', estimateDays: undefined }),
      item({ id: 'c', estimateDays: undefined }),
      item({ id: 'd', estimateDays: undefined }),
    ];
    const summary = summarizeTeamWorkload(input({ items }));
    // 25% estimated. A person with one estimated day and three unknowns is not
    // comfortably within capacity.
    expect(1 / 4).toBeLessThan(ESTIMATE_COVERAGE_FLOOR);
    expect(summary.members[0].verdict).toBe('unestimated-work');
  });

  it('states the unestimated remainder alongside a total it did produce', () => {
    const summary = summarizeTeamWorkload(input({
      items: [
        item({ id: 'a', estimateDays: 1 }),
        item({ id: 'b', estimateDays: 1 }),
        item({ id: 'c', estimateDays: undefined }),
      ],
    }));
    expect(summary.members[0].verdict).toBe('within');
    expect(summary.members[0].detail).toContain('no estimate');
  });
});

describe('overload is reported against a stated window', () => {
  it('reports over when the estimates exceed the available days', () => {
    const summary = summarizeTeamWorkload(input({
      windowDays: 7,
      items: [item({ id: 'a', estimateDays: 6 })],
    }));
    expect(summary.members[0].availableDays).toBe(5);
    expect(summary.members[0].verdict).toBe('over');
    expect(summary.members[0].detail).toContain('1 over');
    expect(summary.over).toBe(1);
  });

  it('always names the window in the summary', () => {
    expect(summarizeTeamWorkload(input({ windowDays: 14 })).summary).toContain('14 days');
  });

  it('resolves nothing — nobody is reassigned and nothing is proposed', () => {
    // Read with the prose stripped: the module says it reassigns nobody, and an
    // assertion that matched the sentence rather than the code would pass for
    // the wrong reason the moment somebody wrote the feature and kept the note.
    expect(CODE).not.toMatch(/reassign|rebalance|redistribute/i);
    const summary = summarizeTeamWorkload(input({ items: [item({ estimateDays: 99 })] }));
    expect(Object.keys(summary.members[0])).not.toContain('suggestedOwner');
  });

  it('carries the caveat that this is not a productivity measure', () => {
    expect(summarizeTeamWorkload(input()).caveat).toBe(WORKLOAD_CAVEAT);
    expect(WORKLOAD_CAVEAT).toContain('not a measure of how fast');
  });
});

describe('declared absence', () => {
  const away: RotaEntry = { id: 'r1', contactId: 'ann', from: '2026-09-07', to: '2026-09-11', kind: 'away' };

  it('counts inclusive whole days of overlap', () => {
    expect(overlapDays(away, Date.parse('2026-09-07'), Date.parse('2026-09-20'))).toBe(5);
  });

  it('counts nothing for a period outside the window', () => {
    expect(overlapDays(away, Date.parse('2026-10-01'), Date.parse('2026-10-14'))).toBe(0);
  });

  it('treats an unreadable or inverted period as no absence, never as time off', () => {
    expect(overlapDays({ ...away, from: 'soon', to: 'later' }, Date.parse('2026-09-07'), Date.parse('2026-09-20'))).toBe(0);
    expect(overlapDays({ ...away, from: '2026-09-11', to: '2026-09-07' }, Date.parse('2026-09-07'), Date.parse('2026-09-20'))).toBe(0);
  });

  it('removes declared absence from the available days', () => {
    const summary = summarizeTeamWorkload(input({ windowDays: 7, rota: [away] }));
    expect(summary.members[0].absentDays).toBe(5);
    expect(summary.members[0].availableDays).toBe(0);
  });

  it('never removes more than the person was going to work', () => {
    const summary = summarizeTeamWorkload(input({
      windowDays: 7,
      members: [{ contactId: 'ann', name: 'Ann', allocation: '1 day/wk' }],
      rota: [{ id: 'r1', contactId: 'ann', from: '2026-09-07', to: '2026-09-13', kind: 'away' }],
    }));
    expect(summary.members[0].availableDays).toBe(0);
  });

  it('reads no rota entry as nothing recorded rather than as full availability', () => {
    const summary = summarizeTeamWorkload(input({ windowDays: 7 }));
    expect(summary.members[0].absentDays).toBe(0);
    expect(summary.members[0].availableDays).toBe(5);
  });
});

describe('unassigned work', () => {
  it('counts items owned by nobody and never distributes them', () => {
    const summary = summarizeTeamWorkload(input({
      items: [item({ id: 'a', ownerContactId: undefined, estimateDays: 10 })],
    }));
    expect(summary.unassignedItems).toBe(1);
    expect(summary.members[0].assignedItems).toBe(0);
    expect(summary.members[0].estimatedDays).toBe(0);
    expect(summary.members[0].verdict).toBe('no-work');
    expect(summary.summary).toContain('assigned to nobody');
  });
});

describe('a derived estimate is counted but never passed off as a commitment', () => {
  it('says how many of the counted estimates a rule produced', () => {
    const summary = summarizeTeamWorkload(input({
      items: [
        item({ id: 'a', estimateDays: 1, estimateSource: 'declared' }),
        item({ id: 'b', estimateDays: 1, estimateSource: 'derived' }),
      ],
    }));
    expect(summary.members[0].estimatedDays).toBe(2);
    expect(summary.members[0].derivedEstimateItems).toBe(1);
    expect(summary.members[0].detail).toContain('derived rather than declared');
  });

  it('treats unstated provenance as derived, the weaker claim', () => {
    const summary = summarizeTeamWorkload(input({ items: [item({ id: 'a', estimateDays: 1 })] }));
    expect(summary.members[0].derivedEstimateItems).toBe(1);
  });

  it('says nothing about provenance when every estimate was declared', () => {
    const summary = summarizeTeamWorkload(input({
      items: [item({ id: 'a', estimateDays: 1, estimateSource: 'declared' })],
    }));
    expect(summary.members[0].derivedEstimateItems).toBe(0);
    expect(summary.members[0].detail).not.toContain('derived');
  });
});

describe('an empty roster', () => {
  it('says there is nothing to read rather than reporting a healthy team', () => {
    const summary = summarizeTeamWorkload(input({ members: [] }));
    expect(summary.members).toHaveLength(0);
    expect(summary.summary).toContain('Nobody is on the team roster');
    expect(summary.over).toBe(0);
  });
});
