import { describe, expect, it } from 'vitest';
import {
  evaluateTechnicalControls,
  hasTechnicalControls,
  policiesWithTechnicalControls,
  summarizeTechnicalControls,
  type ComplianceStackSignals,
} from '../../src/core/complianceTechnicalControls.ts';
import { complianceControlsFor } from '../../src/core/testingScaffolder.ts';

/**
 * The rule that matters most here is the one about absence.
 *
 * A compliance surface that reports a control as satisfied because nobody
 * gathered the signal is worse than one that reports nothing at all — it is the
 * false-pass failure, on the board where a false pass gets repeated to an
 * auditor. So the first suite hands the evaluator an empty signal bundle and
 * requires every single check to come back `unknown`.
 */

const NOTHING_GATHERED: ComplianceStackSignals = {};

const HEALTHY: ComplianceStackSignals = {
  ciWorkflowCount: 3,
  ciWorkflowNames: ['ci.yml', 'publish.yml'],
  dependencyUpdatesConfigured: true,
  vulnerabilityScanningConfigured: true,
  secretScanningConfigured: true,
  securityPolicyPresent: true,
  protectedBranches: ['main', 'production'],
  requiredStatusChecks: ['CI'],
  requiredHumanChecks: ['Self-reviewed the diff'],
  backup: { required: true, hasCommand: true, hasVerifyCommand: true, hasDataRepository: true },
  deploymentStages: { count: 3, hasProtectedProduction: true },
  endpoints: { total: 4, plaintextNonLoopback: 0, usingSecretRefs: 4 },
  auditLedger: { present: true, runCount: 12 },
  toolApprovalMode: 'ask-on-write',
  privacy: { enabled: true, compliancePackCount: 1, trustedModelCount: 1 },
  secretsFoundInSettings: false,
  securityTestingEvidenced: true,
  guardrailEvidenced: true,
  auditTrailEvidenced: true,
  modelCardPresent: true,
  providerGovernance: { enabled: 3, withDeclaredGovernance: 3 },
  riskRegister: { assessed: true, openFindings: 2 },
  lintConfigured: true,
  lintInPipeline: true,
};

const UNHEALTHY: ComplianceStackSignals = {
  ciWorkflowCount: 0,
  ciWorkflowNames: [],
  dependencyUpdatesConfigured: false,
  vulnerabilityScanningConfigured: false,
  secretScanningConfigured: false,
  securityPolicyPresent: false,
  protectedBranches: [],
  requiredStatusChecks: [],
  requiredHumanChecks: [],
  backup: { required: false, hasCommand: false, hasVerifyCommand: false, hasDataRepository: true },
  deploymentStages: { count: 1, hasProtectedProduction: false },
  endpoints: { total: 3, plaintextNonLoopback: 2, usingSecretRefs: 0 },
  auditLedger: { present: false, runCount: 0 },
  toolApprovalMode: 'ask-on-write',
  secretsFoundInSettings: true,
  securityTestingEvidenced: false,
  guardrailEvidenced: false,
  auditTrailEvidenced: false,
  modelCardPresent: false,
  privacy: { enabled: false, compliancePackCount: 0, trustedModelCount: 0 },
  providerGovernance: { enabled: 3, withDeclaredGovernance: 1 },
  riskRegister: { assessed: false, openFindings: 0 },
  lintConfigured: false,
  lintInPipeline: false,
};

const REGIMES = policiesWithTechnicalControls();

describe('a signal nobody gathered is never a pass', () => {
  it('covers more than one regime', () => {
    // Guards the loops below against passing on an empty declaration set.
    expect(REGIMES.length).toBeGreaterThan(1);
  });

  for (const policyId of REGIMES) {
    it(`reports every ${policyId} control as unknown when nothing was gathered`, () => {
      const results = evaluateTechnicalControls(policyId, NOTHING_GATHERED);
      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.state, `${result.controlRef} was decided without a signal`).toBe('unknown');
        // No evidence string either — there is nothing to report.
        expect(result.evidence).toBeUndefined();
      }
    });
  }

  it('summarises an ungathered regime as assessed-nothing rather than clean', () => {
    for (const policyId of REGIMES) {
      const summary = summarizeTechnicalControls(policyId, evaluateTechnicalControls(policyId, NOTHING_GATHERED));
      expect(summary.satisfied).toBe(0);
      expect(summary.gaps).toBe(0);
      expect(summary.unknown).toBe(summary.checked);
      expect(summary.summary).toMatch(/not assessed/);
    }
  });
});

describe('a healthy stack is recognised, an unhealthy one is not', () => {
  for (const policyId of REGIMES) {
    it(`satisfies every checkable ${policyId} control on a healthy stack`, () => {
      const results = evaluateTechnicalControls(policyId, HEALTHY);
      const notSatisfied = results.filter(result => result.state !== 'satisfied');
      expect(notSatisfied.map(r => `${r.controlRef}: ${r.state}`)).toEqual([]);
    });

    it(`reports gaps rather than unknowns for ${policyId} on an unhealthy stack`, () => {
      // The distinction the whole module rests on: a checked-and-failing
      // control is a finding, a never-checked one is silence. An unhealthy
      // stack must produce the former.
      const results = evaluateTechnicalControls(policyId, UNHEALTHY);
      for (const result of results) {
        expect(result.state, `${result.controlRef} came back unknown on a fully-gathered stack`).not.toBe('unknown');
      }
      expect(results.some(result => result.state === 'gap')).toBe(true);
    });
  }

  it('explains every decided control', () => {
    for (const policyId of REGIMES) {
      for (const result of evaluateTechnicalControls(policyId, HEALTHY)) {
        expect(result.evidence?.trim().length, result.controlRef).toBeGreaterThan(0);
        expect(result.rule.trim().length, result.controlRef).toBeGreaterThan(0);
        expect(result.question.trim().length, result.controlRef).toBeGreaterThan(0);
      }
    }
  });
});

describe('backups: required is not the same as working', () => {
  const backupResult = (backup: ComplianceStackSignals['backup']) =>
    evaluateTechnicalControls('soc2', { backup })
      .find(result => result.controlRef === 'A1.2')!;

  it('reports a gap when no backup is required at all', () => {
    const result = backupResult({ required: false, hasCommand: false, hasVerifyCommand: false, hasDataRepository: true });
    expect(result.state).toBe('gap');
    expect(result.evidence).toMatch(/No backup is required/);
  });

  it('reports a gap when a backup is required but has no command', () => {
    // Deny-by-default blocks the promotion, which is safe — but a blocked
    // promotion is not a recovery capability, and reporting it as satisfied
    // would claim a backup that has never run.
    const result = backupResult({ required: true, hasCommand: false, hasVerifyCommand: false, hasDataRepository: true });
    expect(result.state).toBe('gap');
    expect(result.evidence).toMatch(/blocked/);
  });

  it('satisfies once a command is configured', () => {
    expect(backupResult({ required: true, hasCommand: true, hasVerifyCommand: false, hasDataRepository: true }).state).toBe('satisfied');
  });

  it('says whether the backup is verified as well as taken', () => {
    const verified = backupResult({ required: true, hasCommand: true, hasVerifyCommand: true, hasDataRepository: true });
    expect(verified.evidence).toMatch(/verified/);
    const unverified = backupResult({ required: true, hasCommand: true, hasVerifyCommand: false, hasDataRepository: true });
    expect(unverified.evidence).toMatch(/no restore verification/i);
  });

  it('stays unknown when no delivery pipeline is declared', () => {
    expect(backupResult(undefined).state).toBe('unknown');
  });
});

describe('encryption in transit', () => {
  const transport = (endpoints: ComplianceStackSignals['endpoints']) =>
    evaluateTechnicalControls('soc2', { endpoints }).find(result => result.controlRef === 'CC6.6')!;

  it('satisfies when every declared endpoint uses TLS or loopback', () => {
    expect(transport({ total: 3, plaintextNonLoopback: 0, usingSecretRefs: 3 }).state).toBe('satisfied');
  });

  it('reports a gap and counts the plaintext destinations', () => {
    const result = transport({ total: 3, plaintextNonLoopback: 2, usingSecretRefs: 0 });
    expect(result.state).toBe('gap');
    expect(result.evidence).toMatch(/2 declared endpoint/);
  });

  it('stays unknown when no endpoint is declared, rather than passing vacuously', () => {
    // Nothing declared means there is no transport to assess. Calling that
    // "protected" would give a project a pass for having no integrations.
    expect(transport({ total: 0, plaintextNonLoopback: 0, usingSecretRefs: 0 }).state).toBe('unknown');
    expect(transport(undefined).state).toBe('unknown');
  });
});

describe('one question asked by three standards gets one answer', () => {
  it('agrees about dependency scanning across ISO, SOC 2 and NIST', () => {
    // ISO A.8.8, SOC 2 CC7.2 and NIST RA-5 are the same check. Three separate
    // implementations would eventually disagree about one repository, which is
    // how a board loses its credibility.
    for (const signals of [HEALTHY, UNHEALTHY]) {
      const states = [
        evaluateTechnicalControls('iso-27001', signals).find(r => r.controlRef === 'A.8.8')!.state,
        evaluateTechnicalControls('soc2', signals).find(r => r.controlRef === 'CC7.2')!.state,
        evaluateTechnicalControls('nist-800-53', signals).find(r => r.controlRef === 'RA-5')!.state,
      ];
      expect(new Set(states).size).toBe(1);
    }
  });

  it('agrees about access control across every regime that asks', () => {
    for (const signals of [HEALTHY, { toolApprovalMode: 'nonsense' }]) {
      const states = [
        evaluateTechnicalControls('iso-27001', signals).find(r => r.controlRef === 'A.5.15')!.state,
        evaluateTechnicalControls('soc2', signals).find(r => r.controlRef === 'CC6.1')!.state,
        evaluateTechnicalControls('nist-800-53', signals).find(r => r.controlRef === 'AC-6')!.state,
        evaluateTechnicalControls('ai-safety-compliance', signals).find(r => r.controlRef === 'GOV-3')!.state,
      ];
      expect(new Set(states).size).toBe(1);
    }
  });
});

describe('the unchecked remainder is stated, not hidden', () => {
  it('reports how many controls still need a person', () => {
    // "4 of 7 verified" beside a regime with ten controls would imply the other
    // three were the whole remainder.
    for (const policyId of REGIMES) {
      const results = evaluateTechnicalControls(policyId, HEALTHY);
      const summary = summarizeTechnicalControls(policyId, results);
      expect(summary.humanControlCount).toBeGreaterThanOrEqual(0);
      if (summary.humanControlCount > 0) {
        expect(summary.summary).toMatch(/for a person/);
      }
    }
  });

  it('never claims more checked controls than the regime declares', () => {
    for (const policyId of REGIMES) {
      const summary = summarizeTechnicalControls(policyId, evaluateTechnicalControls(policyId, HEALTHY));
      expect(summary.checked + summary.humanControlCount).toBeGreaterThanOrEqual(summary.checked);
    }
  });

  it('counts satisfied, gaps and unknown to exactly the checked total', () => {
    for (const policyId of REGIMES) {
      for (const signals of [HEALTHY, UNHEALTHY, NOTHING_GATHERED]) {
        const summary = summarizeTechnicalControls(policyId, evaluateTechnicalControls(policyId, signals));
        expect(summary.satisfied + summary.gaps + summary.unknown).toBe(summary.checked);
      }
    }
  });
});

describe('whether a regime can be automated at all', () => {
  it('reports which policies carry a technical check', () => {
    // This is the question behind "can this protocol be removed?" — a regime
    // with no technical check is one where the dashboard genuinely cannot help.
    for (const policyId of REGIMES) {
      expect(hasTechnicalControls(policyId), policyId).toBe(true);
    }
  });

  it('reports no technical controls for a policy that has none declared', () => {
    expect(hasTechnicalControls('exploratory')).toBe(false);
    expect(evaluateTechnicalControls('exploratory', HEALTHY)).toEqual([]);
  });

  it('says so plainly when a regime has nothing automatable', () => {
    const summary = summarizeTechnicalControls('exploratory', []);
    expect(summary.checked).toBe(0);
    expect(summary.summary).toMatch(/No control in this regime can be checked automatically/);
  });

  it('gives every declared check a distinct reference within its regime', () => {
    for (const policyId of REGIMES) {
      const refs = evaluateTechnicalControls(policyId, HEALTHY).map(result => result.controlRef);
      expect(new Set(refs).size, policyId).toBe(refs.length);
    }
  });
});

describe('the governance half is declared, not just the technical one', () => {
  /**
   * Both regimes shipped as an engineering checklist — ISO listed nine A.8
   * controls and one A.5, SOC 2 had no CC1–CC5 at all. That is not a curated
   * subset, it is half a regime: an auditor opens with the control environment
   * and the risk assessment, and a mapping that never mentions them describes a
   * project that has not started.
   */
  const THEMED = ['iso-27001', 'soc2'] as const;

  for (const id of THEMED) {
    it(`${id} declares governance controls, not only technological ones`, () => {
      const controls = complianceControlsFor(id);
      expect(controls.length).toBeGreaterThan(10);
      const governance = controls.filter(control => control.theme === 'governance');
      expect(governance.length, `${id} declares no governance control`).toBeGreaterThan(4);
    });

    it(`${id} gives every control a theme`, () => {
      // An unthemed control silently renders under Technological, which is the
      // bucket that was already over-represented.
      const untyped = complianceControlsFor(id).filter(control => control.theme === undefined);
      expect(untyped.map(control => control.ref)).toEqual([]);
    });

    it(`${id} gives every control a distinct reference`, () => {
      const refs = complianceControlsFor(id).map(control => control.ref);
      expect(new Set(refs).size).toBe(refs.length);
    });
  }

  it('keeps the declared count in step with the control list', () => {
    // `DECLARED_CONTROL_COUNT` and `COMPLIANCE_PROFILES` live in different files
    // with no compiler relationship. A count that drifted *below* the real set
    // would under-report how much is still a person's job — the direction that
    // flatters, and the one nobody notices.
    for (const policyId of policiesWithTechnicalControls()) {
      const declared = complianceControlsFor(policyId);
      if (declared.length === 0) {
        continue;
      }
      const summary = summarizeTechnicalControls(policyId, evaluateTechnicalControls(policyId, HEALTHY));
      expect(
        summary.checked + summary.humanControlCount,
        `${policyId}: the declared count disagrees with the control list`,
      ).toBe(declared.length);
    }
  });

  it('only claims a check for a control the regime actually declares', () => {
    // A check pointing at a ref that is not in the mapping would report a
    // control verified that an assessor cannot find.
    for (const policyId of policiesWithTechnicalControls()) {
      const declared = new Set(complianceControlsFor(policyId).map(control => control.ref));
      if (declared.size === 0) {
        continue;
      }
      const stray = evaluateTechnicalControls(policyId, HEALTHY)
        .map(result => result.controlRef)
        .filter(ref => !declared.has(ref));
      expect(stray, `${policyId} checks refs the mapping does not declare`).toEqual([]);
    }
  });
});

describe('the governance checks behave like the technical ones', () => {
  it('treats an unrun risk register as unassessed rather than clean', () => {
    // Zero findings because nobody looked is not zero findings because there
    // is nothing there — the distinction `hasBeenScanned` draws elsewhere.
    const unrun = evaluateTechnicalControls('soc2', { riskRegister: { assessed: false, openFindings: 0 } })
      .find(result => result.controlRef === 'CC3.2')!;
    expect(unrun.state).toBe('gap');
    expect(unrun.evidence).toMatch(/never been run/);

    const run = evaluateTechnicalControls('soc2', { riskRegister: { assessed: true, openFindings: 0 } })
      .find(result => result.controlRef === 'CC3.2')!;
    expect(run.state).toBe('satisfied');
  });

  it('reports a provider with no recorded terms as an unassessed sub-processor', () => {
    const partial = evaluateTechnicalControls('iso-27001', {
      providerGovernance: { enabled: 4, withDeclaredGovernance: 2 },
    }).find(result => result.controlRef === 'A.5.19')!;
    expect(partial.state).toBe('gap');
    expect(partial.evidence).toMatch(/2 of 4/);
  });

  it('stays unknown when no provider is enabled, rather than passing vacuously', () => {
    // Nothing is being sent anywhere, so there is no supplier to have got
    // right — the same reasoning as an endpoint file with no endpoints.
    const none = evaluateTechnicalControls('iso-27001', {
      providerGovernance: { enabled: 0, withDeclaredGovernance: 0 },
    }).find(result => result.controlRef === 'A.5.19')!;
    expect(none.state).toBe('unknown');
  });

  it('requires a linter to be enforced, not merely installed', () => {
    const installedOnly = evaluateTechnicalControls('iso-27001', { lintConfigured: true, lintInPipeline: false })
      .find(result => result.controlRef === 'A.8.28')!;
    expect(installedOnly.state).toBe('gap');
    expect(installedOnly.evidence).toMatch(/nothing enforces it/);

    const enforced = evaluateTechnicalControls('iso-27001', { lintConfigured: true, lintInPipeline: true })
      .find(result => result.controlRef === 'A.8.28')!;
    expect(enforced.state).toBe('satisfied');
  });

  it('requires the privacy gate to be on and armed', () => {
    // On with no pack detects nothing, which is the failure mode that looks
    // like protection on a settings page.
    const armed = (compliancePackCount: number) => evaluateTechnicalControls('iso-27001', {
      privacy: { enabled: true, compliancePackCount, trustedModelCount: 0 },
    }).find(result => result.controlRef === 'A.5.34')!;

    expect(armed(0).state).toBe('gap');
    expect(armed(0).evidence).toMatch(/detects nothing/);
    expect(armed(1).state).toBe('satisfied');
  });
});

describe('a control that cannot apply is not a gap', () => {
  /**
   * The mirror of the false pass, and just as corrosive. A board that reports a
   * backup failure to a project holding no data is one people learn to skim,
   * and then the real findings go past too.
   */
  const backupFor = (backup: ComplianceStackSignals['backup']) =>
    evaluateTechnicalControls('soc2', { backup }).find(result => result.controlRef === 'A1.2')!;

  it('marks the backup control not applicable when no stage holds data', () => {
    const result = backupFor({ required: false, hasCommand: false, hasVerifyCommand: false, hasDataRepository: false });
    expect(result.state).toBe('not-applicable');
  });

  it('always states why it does not apply', () => {
    // The control mapping requires a justification beside a `Not applicable`
    // row, and an automated exclusion is held to the same standard — an
    // unexplained one is the first thing an assessor challenges.
    const result = backupFor({ required: false, hasCommand: false, hasVerifyCommand: false, hasDataRepository: false });
    expect(result.evidence?.trim().length ?? 0).toBeGreaterThan(0);
    expect(result.evidence).toMatch(/no application data store/i);
  });

  it('still reports a gap when data exists and no backup is required', () => {
    // The exclusion must be narrow. A project that holds data and has simply
    // not set up a backup is exactly the case the control exists for.
    expect(backupFor({ required: false, hasCommand: false, hasVerifyCommand: false, hasDataRepository: true }).state).toBe('gap');
  });

  it('does not count an inapplicable control as verified', () => {
    const results = evaluateTechnicalControls('soc2', {
      backup: { required: false, hasCommand: false, hasVerifyCommand: false, hasDataRepository: false },
    });
    const summary = summarizeTechnicalControls('soc2', results);
    expect(summary.notApplicable).toBe(1);
    expect(summary.satisfied).toBe(0);
    // And it leaves the denominator: "0/0 verified" beats claiming a pass.
    expect(summary.summary).toMatch(/1 not applicable/);
  });

  it('keeps every state accounted for', () => {
    for (const signals of [HEALTHY, UNHEALTHY, NOTHING_GATHERED]) {
      for (const policyId of REGIMES) {
        const summary = summarizeTechnicalControls(policyId, evaluateTechnicalControls(policyId, signals));
        expect(summary.satisfied + summary.gaps + summary.unknown + summary.notApplicable).toBe(summary.checked);
      }
    }
  });
});
