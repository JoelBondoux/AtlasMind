import { describe, expect, it } from 'vitest';
import { buildProducerReportData } from '../../src/core/producerReport.js';
import {
  DEFAULT_PUBLISHED_SECTIONS,
  buildPublishableReport,
  decidePublication,
  type PublicationSettings,
} from '../../src/core/producerReportPublication.js';

function settings(overrides: Partial<PublicationSettings> = {}): PublicationSettings {
  return { enabled: true, sections: {}, ...overrides };
}

const FULL = buildProducerReportData({
  projectName: 'AtlasMind',
  generatedAt: new Date('2026-09-07T12:00:00.000Z'),
  gates: [{ gate: 'mvp', total: 5, delivered: 2 }],
  delivery: [{ name: 'Production', ready: false, blockedBy: 'CI red' }],
  risks: [{ title: 'Vendor lock-in', severity: 'high', status: 'open' }],
  cost: { lines: [{ label: 'Item A', costUsd: 12 }], unattributedCostUsd: 3, totalCostUsd: 15 },
});

describe('publishing is off until switched on', () => {
  it('publishes nothing while the master switch is off, whatever the sections say', () => {
    const decision = decidePublication(
      settings({ enabled: false, sections: { risks: true, cost: true } }),
      'public',
    );
    expect(decision.publish).toBe(false);
    expect(decision.publishedSections).toEqual([]);
    expect(decision.reason).toMatch(/switched off/i);
  });

  it('does not publish an empty page when every section is off', () => {
    const decision = decidePublication(
      settings({ sections: { gates: false, delivery: false } }),
      'public',
    );
    expect(decision.publish).toBe(false);
    expect(decision.reason).toMatch(/every section/i);
  });
});

describe('the default set is what a client asks for, and nothing sensitive', () => {
  it('publishes progress and readiness, withholding risks and cost', () => {
    const decision = decidePublication(settings(), 'public');
    expect(decision.publishedSections).toEqual([...DEFAULT_PUBLISHED_SECTIONS]);
    expect(decision.withheldSections).toContain('risks');
    expect(decision.withheldSections).toContain('cost');
  });

  it('requires each sensitive section to be switched on individually', () => {
    const withRisks = decidePublication(settings({ sections: { risks: true } }), 'public');
    expect(withRisks.publishedSections).toContain('risks');
    expect(withRisks.withheldSections).toContain('cost');
  });

  it('names what a sensitive section exposes, before it is published', () => {
    const decision = decidePublication(settings({ sections: { risks: true, cost: true } }), 'public');
    expect(decision.warnings.join(' ')).toMatch(/legal and ethical/i);
    expect(decision.warnings.join(' ')).toMatch(/what the project has spent/i);
  });
});

/**
 * The fact most likely to surprise somebody: a Pages site is public even from a
 * private repository. A user who made the repo private has already expressed an
 * intent the Pages default contradicts.
 */
describe('repository visibility changes the warning, not the outcome', () => {
  it('calls out the contradiction explicitly for a private repository', () => {
    const decision = decidePublication(settings(), 'private');
    expect(decision.publish).toBe(true);
    expect(decision.warnings[0]).toMatch(/private/i);
    expect(decision.warnings[0]).toMatch(/still readable|will be public/i);
  });

  it('treats unknown visibility as public rather than assuming the safe-looking case', () => {
    const decision = decidePublication(settings(), 'unknown');
    expect(decision.warnings[0]).toMatch(/could not be determined/i);
    expect(decision.warnings[0]).toMatch(/anyone with the link/i);
  });

  it('always warns that the page is world-readable when it will publish', () => {
    for (const visibility of ['public', 'private', 'unknown'] as const) {
      const decision = decidePublication(settings(), visibility);
      expect(decision.publish).toBe(true);
      expect(decision.warnings.length).toBeGreaterThan(0);
    }
  });
});

describe('the outbound copy is narrowed, and says what it withheld', () => {
  it('leaves the local report untouched', () => {
    const decision = decidePublication(settings(), 'public');
    const publishable = buildPublishableReport(FULL, decision);
    expect(publishable.data).not.toBe(FULL);
    expect(FULL.risks.entries).toHaveLength(1);
    expect(FULL.cost.lines).toHaveLength(1);
  });

  it('drops withheld entries but keeps the section, so the page states the omission', () => {
    const decision = decidePublication(settings(), 'public');
    const publishable = buildPublishableReport(FULL, decision);
    expect(publishable.data.risks.entries).toEqual([]);
    expect(publishable.data.risks.state).toBe('not-assessed');
    expect(publishable.data.cost.lines).toEqual([]);
    expect(publishable.data.cost.state).toBe('not-assessed');
  });

  it('keeps the sections that were cleared', () => {
    const decision = decidePublication(settings(), 'public');
    const publishable = buildPublishableReport(FULL, decision);
    expect(publishable.data.gates.entries).toHaveLength(1);
    expect(publishable.data.delivery.entries).toHaveLength(1);
  });

  /**
   * Withholding cost must never leave a total behind — a page showing "$15
   * total" with no lines discloses the number it was meant to withhold.
   */
  it('carries no residual totals for a withheld cost section', () => {
    const decision = decidePublication(settings(), 'public');
    const publishable = buildPublishableReport(FULL, decision);
    expect(publishable.data.cost.totalCostUsd).toBeUndefined();
    expect(publishable.data.cost.unattributedCostUsd).toBeUndefined();
    expect(JSON.stringify(publishable.data)).not.toContain('15');
  });
});
