import { describe, expect, it } from 'vitest';
import {
  COMPLIANCE_SETUP_GUIDE,
  COMPLIANCE_WALKTHROUGH_STEP_IDS,
  REQUIRED_COMPLIANCE_STEP_IDS,
  buildComplianceSetupPlan,
  complianceSetupProgress,
  isComplianceSetupReady,
  nextComplianceSetupStep,
  type ComplianceSetupState,
} from '../../src/core/complianceSetupPlan.ts';
import { findNonOpeningActions } from '../../src/core/setupWalkthrough.ts';

function state(overrides: Partial<ComplianceSetupState> = {}): ComplianceSetupState {
  return {
    declaredRegimes: [],
    registeredRegimes: [],
    scopedRegimes: [],
    pendingImports: [],
    focusControlCount: 0,
    focusAssessedCount: 0,
    evidenceCount: 0,
    verifiableEvidenceCount: 0,
    expiringWithoutFollowUp: 0,
    hasRoster: false,
    preserveExisting: false,
    ...overrides,
  };
}

/** A project that has done everything the walkthrough asks. */
const COMPLETE = state({
  declaredRegimes: ['soc2'],
  registeredRegimes: ['soc2'],
  scopedRegimes: ['soc2'],
  focusRegime: 'soc2',
  focusRegimeLabel: 'SOC 2',
  focusControlCount: 25,
  focusAssessedCount: 3,
  evidenceCount: 2,
  verifiableEvidenceCount: 1,
  hasRoster: true,
});

describe('a plan never records anything', () => {
  /**
   * The shared allowlist's rule is "a plan is never an installer". Here it
   * becomes "a plan never marks a control satisfied" — and since a status needs
   * a named person and a date, a walkthrough that could set one would be a
   * walkthrough that could forge an attestation.
   */
  const STATES: readonly ComplianceSetupState[] = [
    state(),
    COMPLETE,
    state({ preserveExisting: true }),
    state({ declaredRegimes: ['iso-27001'], pendingImports: ['iso-27001'] }),
    state({ declaredRegimes: ['gdpr'], hasRoster: true, focusRegime: 'gdpr' }),
    state({ ...COMPLETE, expiringWithoutFollowUp: 3 }),
  ];

  it('offers only actions that open a surface, in every state', () => {
    for (const [index, candidate] of STATES.entries()) {
      const offenders = findNonOpeningActions(buildComplianceSetupPlan(candidate));
      expect(offenders, `state ${index} offered: ${offenders.join(', ')}`).toEqual([]);
    }
  });

  it('never offers an action that names a status or a control', () => {
    for (const candidate of STATES) {
      for (const step of buildComplianceSetupPlan(candidate)) {
        const serialized = JSON.stringify(step.action ?? {});
        expect(serialized).not.toMatch(/satisfied|setControl|recordEvidence|decideScope/i);
      }
    }
  });
});

describe('the walkthrough does not grow with the control set', () => {
  /**
   * A step per control makes "step 7 of 31", a trail that wraps four times, and
   * a finish line that moves when a second regime is enabled. Setup is a
   * one-time act; assessing controls is ongoing work that is never finished.
   */
  it('counts the same number of steps whatever size the regime is', () => {
    const small = complianceSetupProgress(buildComplianceSetupPlan(
      state({ ...COMPLETE, focusControlCount: 6 }),
    ));
    const large = complianceSetupProgress(buildComplianceSetupPlan(
      state({ ...COMPLETE, focusControlCount: 25 }),
    ));
    expect(small.total).toBe(large.total);
    expect(large.total).toBe(COMPLIANCE_WALKTHROUGH_STEP_IDS.length);
  });

  it('does not move the finish line when a second regime is declared', () => {
    const one = complianceSetupProgress(buildComplianceSetupPlan(COMPLETE));
    const two = complianceSetupProgress(buildComplianceSetupPlan(
      state({ ...COMPLETE, declaredRegimes: ['soc2', 'iso-27001'] }),
    ));
    expect(one.total).toBe(two.total);
  });

  it('names no per-control step', () => {
    for (const id of COMPLIANCE_WALKTHROUGH_STEP_IDS) {
      expect(id).not.toMatch(/control-\d|ref/i);
    }
  });
});

describe('what "ready" means', () => {
  it('requires an asserter, because a status cannot be recorded without one', () => {
    // The load-bearing choice. Skipping the roster would hand somebody a
    // register in which every action silently fails.
    expect(REQUIRED_COMPLIANCE_STEP_IDS).toContain('owner');
    const withoutRoster = buildComplianceSetupPlan(state({ ...COMPLETE, hasRoster: false }));
    expect(isComplianceSetupReady(withoutRoster)).toBe(false);
  });

  it('does not require proving a control end to end', () => {
    // Worth walking somebody through; not a precondition for the register
    // working. Reporting a correctly-configured project as unready would be
    // wrong the same way reporting an unassessed regime as met would be.
    expect(REQUIRED_COMPLIANCE_STEP_IDS).not.toContain('firstControl');
    const ready = buildComplianceSetupPlan(state({ ...COMPLETE, focusAssessedCount: 0 }));
    expect(isComplianceSetupReady(ready)).toBe(true);
  });

  it('never reports an empty project as ready', () => {
    expect(isComplianceSetupReady(buildComplianceSetupPlan(state()))).toBe(false);
  });

  it('keeps "hold a producible record" optional, so honesty is not nagged at', () => {
    // A report recorded as "held in Vanta" is the right answer for that report.
    const plan = buildComplianceSetupPlan(state({ ...COMPLETE, verifiableEvidenceCount: 0 }));
    expect(plan.find(step => step.id === 'verifiable')!.status).toBe('optional');
    expect(isComplianceSetupReady(plan)).toBe(true);
  });
});

describe('the next step is always the right one', () => {
  it('starts at declaring a regime', () => {
    expect(nextComplianceSetupStep(buildComplianceSetupPlan(state()))?.id).toBe('regime');
  });

  it('moves to scope once a regime and a roster exist', () => {
    const plan = buildComplianceSetupPlan(state({
      declaredRegimes: ['soc2'], focusRegime: 'soc2', hasRoster: true,
    }));
    expect(nextComplianceSetupStep(plan)?.id).toBe('scope');
  });

  it('never nominates a step blocked only by an optional one', () => {
    const plan = buildComplianceSetupPlan(state({ ...COMPLETE, expiringWithoutFollowUp: 4 }));
    expect(nextComplianceSetupStep(plan)).toBeUndefined();
  });

  it('blocks everything downstream when a newer build wrote the register', () => {
    const plan = buildComplianceSetupPlan(state({ ...COMPLETE, preserveExisting: true }));
    const preserved = plan.find(step => step.id === 'preserved')!;
    expect(preserved.status).toBe('blocked');
    expect(preserved.detail).toContain('will not write over it');
  });
});

describe('the guide describes itself honestly', () => {
  it('declares the steps it counts', () => {
    expect(COMPLIANCE_SETUP_GUIDE.stepIds).toEqual(COMPLIANCE_WALKTHROUGH_STEP_IDS);
    expect(COMPLIANCE_SETUP_GUIDE.command).toBe('/compliance');
  });

  it('gives every step a detail line rather than a bare title', () => {
    for (const step of buildComplianceSetupPlan(state())) {
      expect(step.detail.length, step.id).toBeGreaterThan(10);
    }
  });

  it('explains why evidence is referenced and not copied', () => {
    const evidence = buildComplianceSetupPlan(COMPLETE).find(step => step.id === 'evidence')!;
    const text = (evidence.guidance ?? []).map(line => line.text).join(' ');
    expect(text).toContain('tracked by git');
    expect(text).toContain('never the document');
  });
});
