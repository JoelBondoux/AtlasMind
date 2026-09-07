import { describe, expect, it } from 'vitest';
import { modelCatalogFreshness } from '../../src/providers/modelCatalogFreshness.js';
import { MODEL_CATALOG_VERIFIED_AT } from '../../src/providers/modelCatalog.js';

const NOW = new Date('2026-09-07T12:00:00.000Z');

describe('prices carry their own age', () => {
  it('reports the verification date and an age in days', () => {
    const freshness = modelCatalogFreshness(NOW, '2026-08-08');
    expect(freshness.verifiedAt).toBe('2026-08-08');
    expect(freshness.ageDays).toBe(30);
    expect(freshness.stale).toBe(false);
    expect(freshness.note).toContain('2026-08-08');
  });

  it('marks prices past the threshold as stale, and says how old they are', () => {
    const freshness = modelCatalogFreshness(NOW, '2026-01-01');
    expect(freshness.stale).toBe(true);
    expect(freshness.note).toMatch(/may be out of date/i);
    expect(freshness.note).toContain(String(freshness.ageDays));
  });

  /**
   * Stale prices still report. Withholding a figure would push somebody towards
   * a worse source; a stale number honestly dated is more useful than none.
   */
  it('still returns a usable note when stale', () => {
    expect(modelCatalogFreshness(NOW, '2020-01-01').note.length).toBeGreaterThan(0);
  });

  /** The one direction this must not fail in is the reassuring one. */
  it('treats an unreadable date as unknown-and-stale, never as current', () => {
    for (const bad of ['', 'yesterday', '2026-9-7', '07/09/2026', '2026-02-31']) {
      const freshness = modelCatalogFreshness(NOW, bad);
      expect(freshness.stale).toBe(true);
      expect(freshness.verifiedAt).toBeUndefined();
      expect(freshness.ageDays).toBeUndefined();
      expect(freshness.note).toMatch(/unknown age/i);
    }
  });

  it('never reports a negative age when the date is in the future', () => {
    expect(modelCatalogFreshness(NOW, '2027-01-01').ageDays).toBe(0);
  });
});

describe('the shipped catalog date', () => {
  it('is a real ISO date the freshness reader can parse', () => {
    const freshness = modelCatalogFreshness(NOW, MODEL_CATALOG_VERIFIED_AT);
    expect(freshness.verifiedAt).toBe(MODEL_CATALOG_VERIFIED_AT);
    expect(freshness.ageDays).toBeGreaterThanOrEqual(0);
  });
});
