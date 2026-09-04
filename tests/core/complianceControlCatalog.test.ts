import { describe, expect, it } from 'vitest';
import {
  COMPLIANCE_CONTROL_CATALOG,
  COMPLIANCE_THEME_ORDER,
  EVIDENCE_KIND_LABEL,
  complianceCatalogFor,
  complianceRegimeIds,
  declaredControlCount,
  effectiveAccepts,
  effectivePeriodMonths,
  independentControls,
  isComplianceRegime,
  requiresIndependence,
  type EvidenceKind,
} from '../../src/core/complianceControlCatalog.ts';
import { TESTING_METHODOLOGY_DEFINITIONS } from '../../src/types.ts';

const REGIME_IDS = complianceRegimeIds();

describe('the catalog is total over every governance regime', () => {
  /**
   * The hole this closes: seven regimes had no control set at all, and
   * "graded by the weakest applicable control" over an empty set grades *fine*.
   * A missing catalog is invisible precisely where it matters most.
   */
  it('declares a catalog for every compliance-* methodology and no others', () => {
    const compliance = TESTING_METHODOLOGY_DEFINITIONS
      .filter(definition => definition.category.startsWith('compliance-'))
      .map(definition => definition.id)
      .sort();
    expect([...REGIME_IDS].sort()).toEqual(compliance);
  });

  it('gives every regime at least one control', () => {
    for (const id of REGIME_IDS) {
      expect(COMPLIANCE_CONTROL_CATALOG[id].controls.length, id).toBeGreaterThan(0);
    }
  });

  it('keeps control references unique inside a regime', () => {
    // Four controls in the automotive profile this was lifted from all carried
    // the ref `Part 6-9`. A register keyed on the ref cannot hold four rows
    // under one identity, and an assessor cannot tell which row an evidence
    // record belongs to.
    for (const id of REGIME_IDS) {
      const refs = COMPLIANCE_CONTROL_CATALOG[id].controls.map(control => control.ref);
      expect(new Set(refs).size, `${id} has duplicate refs`).toBe(refs.length);
    }
  });

  it('states its own policy id on every entry', () => {
    for (const id of REGIME_IDS) {
      expect(COMPLIANCE_CONTROL_CATALOG[id].policyId).toBe(id);
    }
  });
});

describe('every control declares what would settle it', () => {
  it('never leaves accepts empty, which would make a control unsatisfiable', () => {
    for (const id of REGIME_IDS) {
      for (const control of COMPLIANCE_CONTROL_CATALOG[id].controls) {
        expect(control.accepts.length, `${id}/${control.ref}`).toBeGreaterThan(0);
      }
    }
  });

  it('uses only declared evidence kinds', () => {
    const known = new Set<EvidenceKind>(Object.keys(EVIDENCE_KIND_LABEL) as EvidenceKind[]);
    for (const id of REGIME_IDS) {
      for (const control of COMPLIANCE_CONTROL_CATALOG[id].controls) {
        for (const kind of control.accepts) {
          expect(known.has(kind), `${id}/${control.ref}: ${kind}`).toBe(true);
        }
      }
    }
  });

  it('gives every control a theme the renderer can group by', () => {
    for (const id of REGIME_IDS) {
      for (const control of COMPLIANCE_CONTROL_CATALOG[id].controls) {
        expect(COMPLIANCE_THEME_ORDER, `${id}/${control.ref}`).toContain(control.theme);
      }
    }
  });

  it('states a positive period wherever one is declared', () => {
    for (const id of REGIME_IDS) {
      const catalog = COMPLIANCE_CONTROL_CATALOG[id];
      expect(catalog.defaultPeriodMonths, id).toBeGreaterThan(0);
      for (const control of catalog.controls) {
        expect(effectivePeriodMonths(catalog, control), `${id}/${control.ref}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('outside assurance is a decision, never an omission', () => {
  /**
   * The nine controls that did not exist before this catalog. The SOC 2 mapping
   * had twenty-four rows and none of them was "a service auditor issued a
   * report", so a fully-completed mapping still described a project nobody had
   * audited.
   */
  it('declares an independence-only control, or says why the regime has none', () => {
    for (const id of REGIME_IDS) {
      const catalog = COMPLIANCE_CONTROL_CATALOG[id];
      const external = independentControls(catalog);
      const explained = Boolean(catalog.noIndependentControl);
      expect(
        external.length > 0 || explained,
        `${id} declares no control an outside party must sign, and gives no reason`,
      ).toBe(true);
      expect(
        external.length > 0 && explained,
        `${id} says it has no outside control but declares ${external.length}`,
      ).toBe(false);
    }
  });

  it('gives every independence-only control a stated reason a reader can argue with', () => {
    for (const id of REGIME_IDS) {
      for (const control of independentControls(COMPLIANCE_CONTROL_CATALOG[id])) {
        expect(control.acceptsReason, `${id}/${control.ref}`).toBeTruthy();
      }
    }
  });

  it('treats a control as needing independence only when nothing else is accepted', () => {
    for (const id of REGIME_IDS) {
      for (const control of COMPLIANCE_CONTROL_CATALOG[id].controls) {
        const only = control.accepts.every(kind => kind === 'independent');
        expect(requiresIndependence(control), `${id}/${control.ref}`).toBe(only);
      }
    }
  });
});

describe('scope variants change the ceiling as declared data', () => {
  it('moves PCI between self-assessment and a qualified assessor by level', () => {
    const catalog = COMPLIANCE_CONTROL_CATALOG['pci-dss'];
    const aoc = catalog.controls.find(control => control.ref === 'AOC-1')!;
    expect(requiresIndependence(aoc, 'SAQ-A')).toBe(false);
    expect(requiresIndependence(aoc, 'Level 1')).toBe(true);
  });

  it('falls back to the base set for a variant nobody declared', () => {
    // A project that typed its own scope label must not find every control
    // unsatisfiable for a reason that looks like policy.
    const catalog = COMPLIANCE_CONTROL_CATALOG['pci-dss'];
    const aoc = catalog.controls.find(control => control.ref === 'AOC-1')!;
    expect(effectiveAccepts(aoc, 'something-else')).toEqual(aoc.accepts);
  });

  it('adds the Type II continuity window without changing the control line', () => {
    const catalog = COMPLIANCE_CONTROL_CATALOG.soc2;
    const report = catalog.controls.find(control => control.ref === 'REPORT-1')!;
    expect(report.variants?.['Type II']?.continuityMonths).toBeGreaterThan(0);
    expect(requiresIndependence(report, 'Type II')).toBe(true);
  });

  it('only offers variants the catalog declares', () => {
    for (const id of REGIME_IDS) {
      const catalog = COMPLIANCE_CONTROL_CATALOG[id];
      const declared = new Set(catalog.variants ?? []);
      for (const control of catalog.controls) {
        for (const key of Object.keys(control.variants ?? {})) {
          expect(declared.has(key), `${id}/${control.ref}: variant "${key}" is not declared on the regime`).toBe(true);
        }
      }
    }
  });
});

describe('the catalog paraphrases and never reproduces a standard', () => {
  it('keeps requirement text short enough to be a summary rather than a quotation', () => {
    for (const id of REGIME_IDS) {
      for (const control of COMPLIANCE_CONTROL_CATALOG[id].controls) {
        expect(control.requirement.length, `${id}/${control.ref}`).toBeLessThan(160);
        expect(control.requirement.length, `${id}/${control.ref}`).toBeGreaterThan(10);
      }
    }
  });

  it('states the scoping question for every regime', () => {
    for (const id of REGIME_IDS) {
      expect(COMPLIANCE_CONTROL_CATALOG[id].scoping.length, id).toBeGreaterThan(40);
    }
  });
});

describe('lookups', () => {
  it('recognises a governance regime and rejects an ordinary methodology', () => {
    expect(isComplianceRegime('soc2')).toBe(true);
    expect(isComplianceRegime('unit')).toBe(false);
    expect(complianceCatalogFor('unit')).toBeUndefined();
    expect(complianceCatalogFor('soc2')?.policyId).toBe('soc2');
  });

  it('reports zero declared controls for a methodology that is not a regime', () => {
    expect(declaredControlCount('unit')).toBe(0);
    expect(declaredControlCount('soc2')).toBe(COMPLIANCE_CONTROL_CATALOG.soc2.controls.length);
  });
});
