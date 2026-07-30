import { describe, expect, it } from 'vitest';

import {
  gradeResearchFinding,
  isResearchGradeRefusal,
  isResearchScanId,
  NO_CITATION_RULE,
  RESEARCH_SCANS,
  RESEARCH_SUBSCRIPTIONS,
  renderResearchCatalogTable,
  renderResearchRuleTable,
  researchScan,
  type ResearchGradeFacts,
} from '../../src/core/researchScanCatalog.js';

const NOW = new Date('2026-07-30T12:00:00.000Z');

function facts(overrides: Partial<ResearchGradeFacts> = {}): ResearchGradeFacts {
  return { scanId: 'competition', citationHosts: 1, ...overrides };
}

describe('the catalog', () => {
  it('declares unique ids with a runnable shape', () => {
    const ids = RESEARCH_SCANS.map(scan => scan.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const scan of RESEARCH_SCANS) {
      expect(scan.cadenceDays).toBeGreaterThan(0);
      expect(scan.agentId).not.toBe('');
      expect(scan.question.endsWith('?')).toBe(true);
      expect(scan.brief.length).toBeGreaterThan(20);
      expect(scan.implication.length).toBeGreaterThan(20);
    }
  });

  it('declares no scan whose evidence lives in this repository', () => {
    // The whole architectural decision: a question answerable from the working
    // tree belongs to the register that already owns it. A scan declared
    // `internal` here would be a second opinion competing with an existing one.
    expect(RESEARCH_SCANS.every(scan => scan.evidenceClass !== 'internal')).toBe(true);
  });

  it('keeps subscriptions and scans in disjoint id spaces', () => {
    const scanIds = new Set<string>(RESEARCH_SCANS.map(scan => scan.id));
    for (const subscription of RESEARCH_SUBSCRIPTIONS) {
      expect(scanIds.has(subscription.id)).toBe(false);
      expect(subscription.pageTarget).not.toBe('');
    }
  });

  it('resolves a declared id and rejects anything else', () => {
    expect(isResearchScanId('market')).toBe(true);
    expect(isResearchScanId('gap')).toBe(false);
    expect(isResearchScanId(7)).toBe(false);
    expect(researchScan('market').label).toBe('Market');
  });
});

describe('grading refuses what it cannot grade', () => {
  it('refuses a claim with no citation rather than grading it low', () => {
    // The one rule the whole feature stands on: an uncited model claim must not
    // enter the evidence set at any severity.
    const grade = gradeResearchFinding(facts({ citationHosts: 0 }), NOW);
    expect(isResearchGradeRefusal(grade)).toBe(true);
    expect(grade).toEqual({ refused: 'no-citation', rule: NO_CITATION_RULE });
  });

  it('grades a single cited observation low', () => {
    const grade = gradeResearchFinding(facts(), NOW);
    expect(isResearchGradeRefusal(grade)).toBe(false);
    expect(grade).toMatchObject({ severity: 'low', rule: 'a single cited observation' });
  });
});

describe('the rule table, evaluated over facts', () => {
  it('grades a regulatory obligation with a live deadline high', () => {
    const grade = gradeResearchFinding(
      facts({ scanId: 'regulatory', deadline: '2026-11-01T00:00:00.000Z' }),
      NOW,
    );
    expect(grade).toMatchObject({ severity: 'high' });
  });

  it('grades a funding deadline high, and a passed one low', () => {
    expect(gradeResearchFinding(facts({ scanId: 'funding', deadline: '2026-09-01' }), NOW))
      .toMatchObject({ severity: 'high' });
    expect(gradeResearchFinding(facts({ scanId: 'funding', deadline: '2026-01-01' }), NOW))
      .toMatchObject({ severity: 'low', rule: 'a stated deadline that has already passed' });
  });

  it('does not treat a deadline beyond the horizon as live', () => {
    // A date four years out is a fact, not a thing to plan this quarter around.
    expect(gradeResearchFinding(facts({ scanId: 'regulatory', deadline: '2030-01-01' }), NOW))
      .toMatchObject({ severity: 'low' });
  });

  it('grades a competitor covering something this roadmap claims high', () => {
    expect(gradeResearchFinding(facts({ scanId: 'competition', overlapsRoadmap: true }), NOW))
      .toMatchObject({ severity: 'high' });
    expect(gradeResearchFinding(facts({ scanId: 'feature', overlapsRoadmap: true }), NOW))
      .toMatchObject({ severity: 'high' });
    // The same overlap on a scan where it means nothing does not inherit the grade.
    expect(gradeResearchFinding(facts({ scanId: 'market', overlapsRoadmap: true }), NOW))
      .toMatchObject({ severity: 'low' });
  });

  it('grades an announced end of life medium whether it has passed or not', () => {
    expect(gradeResearchFinding(facts({ scanId: 'technology', deadline: '2026-12-01' }), NOW))
      .toMatchObject({ severity: 'medium' });
    expect(gradeResearchFinding(facts({ scanId: 'technology', deadline: '2025-12-01' }), NOW))
      .toMatchObject({ severity: 'medium' });
  });

  it('grades a claim carried by two independent hosts medium', () => {
    expect(gradeResearchFinding(facts({ citationHosts: 2 }), NOW))
      .toMatchObject({ severity: 'medium', rule: 'the same claim carried by two or more independent sources' });
  });

  it('ignores an unparseable deadline rather than treating it as live', () => {
    expect(gradeResearchFinding(facts({ scanId: 'regulatory', deadline: 'sometime next year' }), NOW))
      .toMatchObject({ severity: 'low' });
  });

  it('is deterministic for the same facts and the same clock', () => {
    const input = facts({ scanId: 'regulatory', deadline: '2026-11-01', citationHosts: 3 });
    expect(gradeResearchFinding(input, NOW)).toEqual(gradeResearchFinding(input, NOW));
  });
});

describe('the tables are published, not described', () => {
  it('renders every rule, including the one that refuses', () => {
    const table = renderResearchRuleTable();
    expect(table).toContain('a single cited observation');
    expect(table).toContain(NO_CITATION_RULE);
    expect(table).toContain('*not a finding*');
  });

  it('renders every scan with its evidence class', () => {
    const table = renderResearchCatalogTable();
    for (const scan of RESEARCH_SCANS) {
      expect(table).toContain(`\`${scan.id}\``);
    }
    expect(table).toContain('hybrid');
  });
});
