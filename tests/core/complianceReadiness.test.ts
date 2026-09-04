import { describe, expect, it } from 'vitest';
import {
  COMPLIANCE_CONTROL_CATALOG,
  complianceRegimeIds,
  requiresIndependence,
  type ComplianceMethodologyId,
  type ComplianceRegimeCatalog,
} from '../../src/core/complianceControlCatalog.ts';
import {
  CONTROL_RULES,
  COMPLIANCE_DISCLAIMER,
  READINESS_LABEL,
  REGIME_RULES,
  gradeComplianceRegime,
  summarizeComplianceBoard,
  type ComplianceControlReading,
  type TechnicalCheckInput,
} from '../../src/core/complianceReadiness.ts';
import type {
  ComplianceAttribution,
  ComplianceControlRecord,
  ComplianceControlStatus,
  ComplianceEvidence,
  ComplianceEvidenceLibrary,
  ComplianceRegimeRegister,
} from '../../src/core/complianceEvidenceRegister.ts';
import { METHODOLOGY_STANDARDS } from '../../src/core/testingStandards.ts';

const NOW = new Date('2026-09-04T00:00:00.000Z');

function human(at = '2026-08-01T00:00:00.000Z'): ComplianceAttribution {
  return { contactId: 'person-1', source: 'human', at };
}

function evidence(overrides: Partial<ComplianceEvidence> = {}): ComplianceEvidence {
  return {
    id: 'ev-1',
    kind: 'attestation',
    title: 'An attestation',
    locator: { kind: 'url', url: 'https://example.com/policy', host: 'example.com' },
    assertedBy: human(),
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function library(entries: ComplianceEvidence[]): ComplianceEvidenceLibrary {
  return { version: 1, evidence: entries, updatedAt: NOW.toISOString() };
}

function control(
  ref: string,
  status: ComplianceControlStatus,
  overrides: Partial<ComplianceControlRecord> = {},
): ComplianceControlRecord {
  return {
    ref,
    requirement: 'r',
    status,
    evidenceIds: [],
    transitions: [],
    ...(status === 'not-assessed' ? {} : { assertedBy: human() }),
    ...overrides,
  };
}

function register(
  catalog: ComplianceRegimeCatalog,
  controls: ComplianceControlRecord[],
  options: { scoped?: boolean; variant?: string } = {},
): ComplianceRegimeRegister {
  const scoped = options.scoped ?? true;
  const declared = new Map(controls.map(entry => [entry.ref, entry]));
  return {
    version: 1,
    regimeId: catalog.policyId,
    regime: catalog.regime,
    scope: scoped
      ? {
        statement: 'Everything is in scope.',
        exclusions: [],
        decidedBy: human(),
        decidedAt: '2026-07-01T00:00:00.000Z',
        ...(options.variant ? { variant: options.variant } : {}),
      }
      : { exclusions: [] },
    controls: catalog.controls.map(entry => declared.get(entry.ref) ?? control(entry.ref, 'not-assessed')),
    reviews: [],
    updatedAt: NOW.toISOString(),
  };
}

/** A regime whose controls all accept an attestation, for the simple cases. */
const SELF_CLOSABLE: ComplianceMethodologyId = 'change-management';
/** A regime with a control only an outside party can close. */
const NEEDS_OUTSIDE: ComplianceMethodologyId = 'iso-27001';

describe('nothing this module produces means compliant', () => {
  /**
   * The whole feature exists because a green "Tested" tag was reachable from a
   * filename. Replacing it with a differently-worded green tag would be the
   * same defect in new clothes, so the vocabulary is pinned rather than trusted
   * to reviewer memory.
   */
  const FORBIDDEN = /\b(compliant|compliance with|certified|verified|passed|approved|covered|tested)\b/i;

  it('uses no word that could read as a verdict, in any label', () => {
    for (const [readiness, label] of Object.entries(READINESS_LABEL)) {
      expect(FORBIDDEN.test(label), `${readiness} label: ${label}`).toBe(false);
    }
  });

  it('uses no such word in any rule description', () => {
    for (const rule of [...CONTROL_RULES, ...REGIME_RULES]) {
      expect(FORBIDDEN.test(rule.describes), `${rule.id}: ${rule.describes}`).toBe(false);
    }
  });

  it('carries the disclaimer on every reading', () => {
    for (const id of complianceRegimeIds()) {
      const reading = gradeComplianceRegime({ catalog: COMPLIANCE_CONTROL_CATALOG[id], now: NOW });
      expect(reading.disclaimer).toBe(COMPLIANCE_DISCLAIMER);
    }
  });

  it('never renders a good tone', () => {
    for (const tone of Object.values(READINESS_LABEL)) {
      expect(tone).toBeTruthy();
    }
    for (const id of complianceRegimeIds()) {
      const reading = gradeComplianceRegime({ catalog: COMPLIANCE_CONTROL_CATALOG[id], now: NOW });
      expect(reading.tone).not.toBe('good');
    }
  });
});

describe('the defect this replaces cannot be reached', () => {
  /**
   * The direct regression for `settingsPanel.ts`, where
   * `results.some(r => r.state === 'satisfied')` promoted a whole regime. Here
   * every technical check passes and the register is empty, which is exactly
   * the state that used to read "Tested".
   */
  it('an empty register grades unexamined even when every stack check passes', () => {
    const catalog = COMPLIANCE_CONTROL_CATALOG[NEEDS_OUTSIDE];
    const technical: TechnicalCheckInput[] = catalog.controls.map(entry => ({
      controlRef: entry.ref,
      state: 'satisfied',
      rule: 'everything-passes',
      question: entry.requirement,
      evidence: 'All good.',
    }));

    const reading = gradeComplianceRegime({ catalog, technical, now: NOW });

    expect(reading.readiness).toBe('unexamined');
    expect(reading.ruleId).toBe('regime-unscoped');
    expect(reading.counts['satisfied-self']).toBe(0);
    expect(reading.counts['satisfied-independent']).toBe(0);
  });

  it('one satisfied control out of many never exceeds in-progress', () => {
    const catalog = COMPLIANCE_CONTROL_CATALOG[SELF_CLOSABLE];
    const first = catalog.controls[0]!;
    const lib = library([evidence({ id: 'ev-a', kind: 'attestation' })]);

    const reading = gradeComplianceRegime({
      catalog,
      register: register(catalog, [control(first.ref, 'satisfied', { evidenceIds: ['ev-a'] })]),
      library: lib,
      now: NOW,
    });

    expect(catalog.controls.length).toBeGreaterThan(1);
    expect(reading.readiness).toBe('in-progress');
    expect(reading.ruleId).toBe('regime-control-unassessed');
  });

  it('a machine check never satisfies a control whose catalog does not accept one', () => {
    const catalog = COMPLIANCE_CONTROL_CATALOG[NEEDS_OUTSIDE];
    const documentary = catalog.controls.find(entry => !entry.accepts.includes('machine-check'))!;

    const reading = gradeComplianceRegime({
      catalog,
      register: register(catalog, [control(documentary.ref, 'satisfied')]),
      technical: [{
        controlRef: documentary.ref,
        state: 'satisfied',
        rule: 'a-stack-check',
        question: 'Is something configured?',
        evidence: 'It is.',
      }],
      now: NOW,
    });

    const grade = reading.controls.find(entry => entry.ref === documentary.ref)!;
    expect(grade.reading).not.toBe('satisfied-self');
    expect(grade.reading).not.toBe('satisfied-independent');
    // Shown as a signal rather than dropped — it is real, it is just not enough.
    expect(grade.corroborating).toHaveLength(1);
  });
});

describe('the evidence-class ceiling', () => {
  it('holds an independence-only control at awaiting-independent on an attestation', () => {
    const catalog = COMPLIANCE_CONTROL_CATALOG[NEEDS_OUTSIDE];
    const external = catalog.controls.find(entry => requiresIndependence(entry))!;
    const lib = library([evidence({ id: 'ev-self', kind: 'attestation' })]);

    const reading = gradeComplianceRegime({
      catalog,
      register: register(catalog, [control(external.ref, 'satisfied', { evidenceIds: ['ev-self'] })]),
      library: lib,
      now: NOW,
    });

    const grade = reading.controls.find(entry => entry.ref === external.ref)!;
    expect(grade.reading).toBe('awaiting-independent');
    expect(grade.ruleId).toBe('control-awaiting-independent');
  });

  it('grades the wrong kind of evidence as a gap, naming the kinds that would settle it', () => {
    const catalog = COMPLIANCE_CONTROL_CATALOG.sbom;
    const machineOnly = catalog.controls.find(entry =>
      !entry.accepts.includes('attestation') && entry.accepts.includes('artifact'))!;
    const lib = library([evidence({ id: 'ev-word', kind: 'attestation' })]);

    const reading = gradeComplianceRegime({
      catalog,
      register: register(catalog, [control(machineOnly.ref, 'satisfied', { evidenceIds: ['ev-word'] })]),
      library: lib,
      now: NOW,
    });

    const grade = reading.controls.find(entry => entry.ref === machineOnly.ref)!;
    expect(grade.reading).toBe('gap');
    expect(grade.ruleId).toBe('control-evidence-class-insufficient');
  });

  it('a described locator cannot carry a document-class control past partial', () => {
    const catalog = COMPLIANCE_CONTROL_CATALOG[NEEDS_OUTSIDE];
    const external = catalog.controls.find(entry => requiresIndependence(entry))!;
    const lib = library([evidence({
      id: 'ev-somewhere',
      kind: 'independent',
      issuer: 'A certification body',
      locator: { kind: 'described', where: 'Held in the compliance drawer' },
    })]);

    const reading = gradeComplianceRegime({
      catalog,
      register: register(catalog, [control(external.ref, 'satisfied', { evidenceIds: ['ev-somewhere'] })]),
      library: lib,
      now: NOW,
    });

    const grade = reading.controls.find(entry => entry.ref === external.ref)!;
    expect(grade.reading).toBe('partial');
    expect(grade.ruleId).toBe('control-evidence-unverifiable');
  });
});

describe('expiry', () => {
  const catalog = COMPLIANCE_CONTROL_CATALOG[SELF_CLOSABLE];
  const target = catalog.controls.find(entry => entry.accepts.includes('attestation'))!;

  function readingWith(assertedAt: string, validUntil?: string): ComplianceControlReading {
    const lib = library([evidence({
      id: 'ev-dated',
      kind: 'attestation',
      assertedBy: human(assertedAt),
      ...(validUntil ? { validUntil } : {}),
    })]);
    const reading = gradeComplianceRegime({
      catalog,
      register: register(catalog, [control(target.ref, 'satisfied', { evidenceIds: ['ev-dated'] })]),
      library: lib,
      now: NOW,
    });
    return reading.controls.find(entry => entry.ref === target.ref)!.reading;
  }

  it('reads evidence inside the control period as met', () => {
    expect(readingWith('2026-08-01T00:00:00.000Z')).toBe('satisfied-self');
  });

  it('reads evidence older than the control period as lapsed, not as a gap', () => {
    // A twelve-month period, asserted two years ago.
    expect(readingWith('2024-08-01T00:00:00.000Z')).toBe('expired');
  });

  it('lets a stated expiry win over the period when it is earlier', () => {
    expect(readingWith('2026-08-01T00:00:00.000Z', '2026-08-15T00:00:00.000Z')).toBe('expired');
  });

  it('grades identically whatever year the clock is set to', () => {
    const lib = library([evidence({ id: 'ev-x', assertedBy: human('2019-01-01T00:00:00.000Z') })]);
    const reg = register(catalog, [control(target.ref, 'satisfied', { evidenceIds: ['ev-x'] })]);
    const past = gradeComplianceRegime({ catalog, register: reg, library: lib, now: new Date('2019-02-01T00:00:00.000Z') });
    const future = gradeComplianceRegime({ catalog, register: reg, library: lib, now: new Date('2039-02-01T00:00:00.000Z') });
    expect(past.controls.find(c => c.ref === target.ref)!.reading).toBe('satisfied-self');
    expect(future.controls.find(c => c.ref === target.ref)!.reading).toBe('expired');
  });
});

describe('the scope gate', () => {
  it('reads every control as not assessed until scope is decided', () => {
    const catalog = COMPLIANCE_CONTROL_CATALOG[SELF_CLOSABLE];
    const lib = library([evidence({ id: 'ev-a' })]);
    const reading = gradeComplianceRegime({
      catalog,
      register: register(
        catalog,
        catalog.controls.map(entry => control(entry.ref, 'satisfied', { evidenceIds: ['ev-a'] })),
        { scoped: false },
      ),
      library: lib,
      now: NOW,
    });

    expect(reading.readiness).toBe('unexamined');
    expect(reading.ruleId).toBe('regime-unscoped');
  });

  it('reports scoped-and-empty as scoped, which is not a pass', () => {
    const catalog = COMPLIANCE_CONTROL_CATALOG[SELF_CLOSABLE];
    const reading = gradeComplianceRegime({
      catalog,
      register: register(catalog, []),
      now: NOW,
    });
    expect(reading.readiness).toBe('scoped');
    expect(reading.ruleId).toBe('regime-nothing-assessed');
  });
});

describe('exclusions', () => {
  it('grades an unjustified not-applicable as not assessed', () => {
    const catalog = COMPLIANCE_CONTROL_CATALOG[SELF_CLOSABLE];
    const first = catalog.controls[0]!;
    const reading = gradeComplianceRegime({
      catalog,
      register: register(catalog, [control(first.ref, 'not-applicable')]),
      now: NOW,
    });
    const grade = reading.controls.find(entry => entry.ref === first.ref)!;
    expect(grade.reading).toBe('not-assessed');
    expect(grade.ruleId).toBe('control-excluded-unjustified');
  });

  it('removes a justified exclusion from the denominator without counting it as met', () => {
    const catalog = COMPLIANCE_CONTROL_CATALOG[SELF_CLOSABLE];
    const first = catalog.controls[0]!;
    const reading = gradeComplianceRegime({
      catalog,
      register: register(catalog, [
        control(first.ref, 'not-applicable', { justification: 'We have no premises of our own.' }),
      ]),
      now: NOW,
    });
    expect(reading.applicableCount).toBe(catalog.controls.length - 1);
    expect(reading.counts['not-applicable']).toBe(1);
    expect(reading.counts['satisfied-self']).toBe(0);
  });
});

describe('the weakest applicable control decides the reading', () => {
  it('reaches independently assured only when every outside control has outside evidence', () => {
    const catalog = COMPLIANCE_CONTROL_CATALOG[NEEDS_OUTSIDE];
    const lib = library([
      evidence({ id: 'ev-self', kind: 'attestation' }),
      evidence({
        id: 'ev-outside',
        kind: 'independent',
        issuer: 'A certification body',
        issuerScope: 'The whole ISMS',
        locator: { kind: 'url', url: 'https://certs.example.com/x', host: 'certs.example.com' },
      }),
      evidence({ id: 'ev-doc', kind: 'artifact' }),
    ]);

    const controls = catalog.controls.map(entry => {
      const ids = requiresIndependence(entry)
        ? ['ev-outside']
        : entry.accepts.includes('attestation') ? ['ev-self'] : ['ev-doc', 'ev-self'];
      return control(entry.ref, 'satisfied', { evidenceIds: ids });
    });

    const reading = gradeComplianceRegime({
      catalog,
      register: register(catalog, controls),
      library: lib,
      technical: catalog.controls
        .filter(entry => entry.accepts.includes('machine-check'))
        .map(entry => ({
          controlRef: entry.ref,
          state: 'satisfied' as const,
          rule: 'stack',
          question: entry.requirement,
        })),
      now: NOW,
    });

    expect(reading.counts['not-assessed']).toBe(0);
    expect(reading.readiness).toBe('independently-assured');
  });

  it('falls back to self-attested the moment one outside control is unsigned', () => {
    const catalog = COMPLIANCE_CONTROL_CATALOG[NEEDS_OUTSIDE];
    const externals = catalog.controls.filter(entry => requiresIndependence(entry));
    expect(externals.length).toBeGreaterThan(1);

    const lib = library([
      evidence({ id: 'ev-self', kind: 'attestation' }),
      evidence({ id: 'ev-doc', kind: 'artifact' }),
      evidence({
        id: 'ev-outside',
        kind: 'independent',
        issuer: 'A certification body',
        locator: { kind: 'url', url: 'https://certs.example.com/x', host: 'certs.example.com' },
      }),
    ]);

    const controls = catalog.controls.map(entry => {
      if (requiresIndependence(entry)) {
        // Every outside control signed except the last one, which rests on our word.
        const ids = entry.ref === externals[externals.length - 1]!.ref ? ['ev-self'] : ['ev-outside'];
        return control(entry.ref, 'satisfied', { evidenceIds: ids });
      }
      return control(entry.ref, 'satisfied', {
        evidenceIds: entry.accepts.includes('attestation') ? ['ev-self'] : ['ev-doc', 'ev-self'],
      });
    });

    const reading = gradeComplianceRegime({
      catalog,
      register: register(catalog, controls),
      library: lib,
      technical: catalog.controls
        .filter(entry => entry.accepts.includes('machine-check'))
        .map(entry => ({ controlRef: entry.ref, state: 'satisfied' as const, rule: 'stack', question: entry.requirement })),
      now: NOW,
    });

    expect(reading.readiness).toBe('self-attested');
    expect(reading.ruleId).toBe('regime-awaiting-independent');
    expect(reading.weakest?.reading).toBe('awaiting-independent');
  });
});

describe('every grade names a declared rule', () => {
  const controlRuleIds = new Set(CONTROL_RULES.map(rule => rule.id));
  const regimeRuleIds = new Set(REGIME_RULES.map(rule => rule.id));

  it('holds across every regime, for a register nobody has touched', () => {
    for (const id of complianceRegimeIds()) {
      const reading = gradeComplianceRegime({ catalog: COMPLIANCE_CONTROL_CATALOG[id], now: NOW });
      expect(regimeRuleIds.has(reading.ruleId), `${id}: ${reading.ruleId}`).toBe(true);
      expect(reading.rule.length).toBeGreaterThan(0);
      for (const grade of reading.controls) {
        expect(controlRuleIds.has(grade.ruleId), `${id}/${grade.ref}: ${grade.ruleId}`).toBe(true);
        expect(grade.statement.length).toBeGreaterThan(0);
      }
    }
  });

  it('publishes both rule tables on the reading itself', () => {
    const reading = gradeComplianceRegime({ catalog: COMPLIANCE_CONTROL_CATALOG.soc2, now: NOW });
    expect(reading.rules.control).toEqual(CONTROL_RULES);
    expect(reading.rules.regime).toEqual(REGIME_RULES);
  });
});

describe('recording a failure is free, claiming success is not', () => {
  it('keeps a declared gap as a gap even with no asserter or evidence', () => {
    const catalog = COMPLIANCE_CONTROL_CATALOG[SELF_CLOSABLE];
    const first = catalog.controls[0]!;
    const reading = gradeComplianceRegime({
      catalog,
      register: register(catalog, [{
        ref: first.ref, requirement: 'r', status: 'gap', evidenceIds: [], transitions: [],
      }]),
      now: NOW,
    });
    const grade = reading.controls.find(entry => entry.ref === first.ref)!;
    expect(grade.reading).toBe('gap');
    expect(grade.ruleId).toBe('control-declared-gap');
  });

  it('will not take a satisfied status with nothing behind it', () => {
    const catalog = COMPLIANCE_CONTROL_CATALOG[SELF_CLOSABLE];
    const first = catalog.controls[0]!;
    const reading = gradeComplianceRegime({
      catalog,
      register: register(catalog, [control(first.ref, 'satisfied')]),
      now: NOW,
    });
    const grade = reading.controls.find(entry => entry.ref === first.ref)!;
    expect(grade.reading).toBe('not-assessed');
    expect(grade.ruleId).toBe('control-claim-unattributed');
  });
});

describe('determinism', () => {
  it('produces byte-identical output for the same input and clock', () => {
    const catalog = COMPLIANCE_CONTROL_CATALOG.soc2;
    const lib = library([evidence({ id: 'ev-a' })]);
    const reg = register(catalog, [control(catalog.controls[0]!.ref, 'satisfied', { evidenceIds: ['ev-a'] })]);
    const a = gradeComplianceRegime({ catalog, register: reg, library: lib, now: NOW });
    const b = gradeComplianceRegime({ catalog, register: reg, library: lib, now: NOW });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('the board', () => {
  it('says nothing is declared rather than reporting a clean sweep', () => {
    const board = summarizeComplianceBoard([], NOW);
    expect(board.summary).toContain('No governance regime');
    expect(board.disclaimer).toBe(COMPLIANCE_DISCLAIMER);
  });

  it('counts a never-touched regime as unexamined rather than omitting it', () => {
    const readings = complianceRegimeIds()
      .map(id => gradeComplianceRegime({ catalog: COMPLIANCE_CONTROL_CATALOG[id], now: NOW }));
    const board = summarizeComplianceBoard(readings, NOW);
    expect(board.counts.unexamined).toBe(readings.length);
    expect(board.counts['independently-assured']).toBe(0);
  });
});

describe('an assessment made against another edition is named, never re-pointed', () => {
  /**
   * ISO 27001 went 2013 to 2022 and renumbered most of Annex A. Carrying a
   * 2013 status onto the 2022 control set would be a silent promotion of the
   * worst kind — every row would look assessed and none of them would be about
   * the control they now sit beside.
   */
  it('reports the drift and grades the register on the modelled edition', () => {
    const catalog = COMPLIANCE_CONTROL_CATALOG[NEEDS_OUTSIDE];
    const base = register(catalog, []);
    const reading = gradeComplianceRegime({
      catalog,
      register: { ...base, assessedAgainst: { name: 'ISO/IEC 27001', edition: '2013' } },
      now: NOW,
    });

    expect(reading.editionDrift?.assessedAgainst).toContain('2013');
    expect(reading.editionDrift?.modelled).toContain('2022');
    expect(reading.editionDrift?.modelled).not.toContain('2013');
    expect(reading.notes.some(note => note.includes('not been carried across'))).toBe(true);
  });

  it('says nothing when the register matches the edition AtlasMind models', () => {
    // Read from the standards table rather than hardcoded. A literal here went
    // stale the moment the ISO edition was corrected to carry its 2024
    // amendment — the detector was right and the fixture was wrong, which is
    // exactly the direction this test should fail in.
    const catalog = COMPLIANCE_CONTROL_CATALOG[NEEDS_OUTSIDE];
    const tracking = METHODOLOGY_STANDARDS[NEEDS_OUTSIDE];
    expect(tracking.kind).toBe('tracked');
    const current = tracking as { name: string; edition: string };
    const base = register(catalog, []);
    const reading = gradeComplianceRegime({
      catalog,
      register: { ...base, assessedAgainst: { name: current.name, edition: current.edition } },
      now: NOW,
    });
    expect(reading.editionDrift).toBeUndefined();
  });

  it('states the edition on every governance regime reading', () => {
    for (const id of complianceRegimeIds()) {
      const reading = gradeComplianceRegime({ catalog: COMPLIANCE_CONTROL_CATALOG[id], now: NOW });
      expect(reading.standardDetail.length, id).toBeGreaterThan(0);
      expect(typeof reading.standardStale, id).toBe('boolean');
    }
  });
});
