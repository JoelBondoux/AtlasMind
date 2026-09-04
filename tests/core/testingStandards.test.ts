import { describe, expect, it } from 'vitest';
import {
  METHODOLOGY_STANDARDS,
  STANDARD_VERIFICATION_HORIZON_MONTHS,
  describeStandardTracking,
  isStandardStale,
  standardTrackingFor,
} from '../../src/core/testingStandards.ts';
import { TESTING_METHODOLOGY_DEFINITIONS } from '../../src/types.ts';
import { complianceRegimeIds } from '../../src/core/complianceControlCatalog.ts';

const NOW = new Date('2026-09-04T00:00:00.000Z');

describe('every methodology answers the edition question', () => {
  /**
   * `kind: 'none'` is a decision somebody made. A *missing* entry is a decision
   * nobody made, and would let a methodology be graded against whichever
   * edition happened to be current when its rows were written.
   */
  it('declares tracking for all sixty-nine, and for nothing else', () => {
    const ids = TESTING_METHODOLOGY_DEFINITIONS.map(definition => definition.id).sort();
    expect(Object.keys(METHODOLOGY_STANDARDS).sort()).toEqual(ids);
  });

  it('never leaves a tracked entry without a name, edition and date', () => {
    for (const [id, tracking] of Object.entries(METHODOLOGY_STANDARDS)) {
      if (tracking.kind !== 'tracked') {
        continue;
      }
      expect(tracking.name.length, id).toBeGreaterThan(0);
      expect(tracking.edition.length, id).toBeGreaterThan(0);
      expect(Number.isFinite(Date.parse(tracking.verifiedAt)), `${id}: ${tracking.verifiedAt}`).toBe(true);
    }
  });

  it('never leaves an untracked entry without a reason', () => {
    for (const [id, tracking] of Object.entries(METHODOLOGY_STANDARDS)) {
      if (tracking.kind === 'none') {
        expect(tracking.reason.length, id).toBeGreaterThan(20);
      }
    }
  });

  it('tracks an edition for the regimes whose standards actually revise', () => {
    // These are the ones where an edition change renumbers or re-scopes
    // controls, so an assessment against the old one is about another document.
    for (const id of ['iso-27001', 'soc2', 'pci-dss', 'nist-800-53', 'gdpr', 'hipaa'] as const) {
      expect(METHODOLOGY_STANDARDS[id].kind, id).toBe('tracked');
    }
  });

  it('covers every governance regime one way or the other', () => {
    for (const id of complianceRegimeIds()) {
      expect(standardTrackingFor(id), id).toBeDefined();
    }
  });
});

describe('staleness is a question, not a quiet fact', () => {
  const tracked = { kind: 'tracked', name: 'X', edition: '1', verifiedAt: '2026-01-01T00:00:00.000Z' } as const;

  it('reads a recent verification as current', () => {
    expect(isStandardStale(tracked, NOW)).toBe(false);
  });

  it('reads one past the horizon as worth repeating', () => {
    const old = { ...tracked, verifiedAt: '2024-01-01T00:00:00.000Z' };
    expect(isStandardStale(old, NOW)).toBe(true);
    expect(describeStandardTracking(old, NOW)).toContain(String(STANDARD_VERIFICATION_HORIZON_MONTHS));
  });

  it('treats a known-newer edition as stale immediately, whatever the date says', () => {
    // The point is not how long ago somebody looked, but whether what they
    // found still holds.
    const superseded = {
      ...tracked,
      supersededBy: { edition: '2', publishedOn: '2026-06-11T00:00:00.000Z' },
    };
    expect(isStandardStale(superseded, NOW)).toBe(true);
    expect(describeStandardTracking(superseded, NOW)).toContain('is not modelled here yet');
  });

  it('treats an unreadable date as stale rather than as current', () => {
    expect(isStandardStale({ ...tracked, verifiedAt: 'sometime' }, NOW)).toBe(true);
  });

  it('never calls an untracked methodology stale', () => {
    expect(isStandardStale({ kind: 'none', reason: 'A practice, not a specification.' }, NOW)).toBe(false);
  });

  it('says nothing is recorded rather than implying currency, when asked about nothing', () => {
    expect(describeStandardTracking(undefined, NOW)).toContain('No edition is recorded');
  });
});

describe('the description reads as a claim with a date on it', () => {
  it('names the edition and when it was last checked', () => {
    const text = describeStandardTracking(METHODOLOGY_STANDARDS['iso-27001'], NOW);
    expect(text).toContain('ISO/IEC 27001');
    expect(text).toContain('2022');
    expect(text).toContain('Last checked');
  });

  it('gives the reason for a methodology with no standard', () => {
    expect(describeStandardTracking(METHODOLOGY_STANDARDS.tdd, NOW))
      .toBe((METHODOLOGY_STANDARDS.tdd as { reason: string }).reason);
  });
});
