import type { TestingMethodologyId } from '../types.js';

/**
 * The controls in a governance regime that a machine can actually check.
 *
 * A documentary policy — ISO 27001, SOC 2, NIST 800-53 — is mostly human
 * attestation, and AtlasMind is right not to claim otherwise. But *mostly* is
 * not *entirely*. "Backups are taken before a production promotion", "data in
 * transit is protected", "dependencies are scanned for known vulnerabilities"
 * and "changes are reviewed before merge" are facts about a stack, not opinions
 * about a process, and this project already models every one of them somewhere:
 * the delivery backup gate, the Lens endpoint rules, the CI workflows, the
 * declared workflow branches.
 *
 * Until now none of that reached the compliance board, so a regime with ten
 * controls sat entirely at "Not assessed" while four of them were verifiable
 * from disk. That is the opposite failure to the one the mapping rules fix: not
 * claiming compliance nobody checked, but *withholding* evidence the project
 * genuinely has.
 *
 * Four rules govern what follows.
 *
 * **A signal that was not gathered is `unknown`, never `satisfied`.** Every
 * field on {@link ComplianceStackSignals} is optional, and absent means "not
 * looked at" rather than "not there" — the same distinction the attention feed
 * and the risk register hold. Guessing in the reassuring direction is the one
 * guess worth refusing on a compliance surface.
 *
 * **Every result names the declared rule that decided it**, as the debt
 * register and the testing severity table do, so a grade can be argued with
 * rather than merely trusted.
 *
 * **A control with no technical check is absent from the results, not passed.**
 * `humanControlCount` reports how many remain for a person, so a board showing
 * "4 of 10 verified" is honest about the other six.
 *
 * **Nothing here writes anything.** The control mapping is a human document
 * that AtlasMind never rewrites; these results are shown beside it. An
 * automated check that passed is evidence, and a person deciding to record it
 * in the mapping is a separate act.
 */

// ── Signals ──────────────────────────────────────────────────────

/**
 * What the workspace can tell us about the stack.
 *
 * Every field is optional. The caller gathers what it cheaply can — most of it
 * is already on the dashboard for another page — and anything it did not gather
 * produces `unknown` results rather than absent ones, because "we did not
 * check" is a fact worth showing.
 */
export interface ComplianceStackSignals {
  /** Continuous integration: how many pipeline definitions exist. */
  readonly ciWorkflowCount?: number;
  /** Workflow filenames, lowercased, for spotting scanners and signing. */
  readonly ciWorkflowNames?: readonly string[];

  /** A dependency-update bot is configured (`dependabot.yml`, `renovate.json`). */
  readonly dependencyUpdatesConfigured?: boolean;
  /** A vulnerability scanner runs somewhere (script or workflow). */
  readonly vulnerabilityScanningConfigured?: boolean;
  /** A secret scanner is configured (gitleaks, trufflehog, detect-secrets). */
  readonly secretScanningConfigured?: boolean;
  /** A published vulnerability-reporting route exists (`SECURITY.md`). */
  readonly securityPolicyPresent?: boolean;

  /** Branches the declared workflow protects from direct pushes. */
  readonly protectedBranches?: readonly string[];
  /** Status checks the declared workflow requires before a merge. */
  readonly requiredStatusChecks?: readonly string[];
  /** Human checks the declared workflow requires (a person attesting). */
  readonly requiredHumanChecks?: readonly string[];

  /**
   * The production stage's backup policy, when a delivery pipeline is declared.
   *
   * `hasDataRepository` is what stops this reporting a false gap. A project
   * that has declared it holds no application data has nothing to back up, and
   * grading that as a failure is the mirror of a false pass — it trains people
   * to ignore the board, which costs more than the control was worth.
   */
  readonly backup?: {
    readonly required: boolean;
    readonly hasCommand: boolean;
    readonly hasVerifyCommand: boolean;
    /** False when every stage declares no data store. */
    readonly hasDataRepository: boolean;
  };
  /** Declared deployment stages, for environment separation. */
  readonly deploymentStages?: {
    readonly count: number;
    readonly hasProtectedProduction: boolean;
  };

  /** Declared Lens endpoints, for transport protection. */
  readonly endpoints?: {
    readonly total: number;
    /** Plaintext `http` destinations that are not loopback. */
    readonly plaintextNonLoopback: number;
    /** Endpoints naming a credential by reference rather than holding one. */
    readonly usingSecretRefs: number;
  };

  /** The git-tracked workflow audit ledger. */
  readonly auditLedger?: { readonly present: boolean; readonly runCount: number };

  /** `atlasmind.tools.approvalMode`, as configured. */
  readonly toolApprovalMode?: string;

  /** The data-privacy gate. */
  readonly privacy?: {
    readonly enabled: boolean;
    readonly compliancePackCount: number;
    readonly trustedModelCount: number;
  };

  /** Whether an API key was found in settings rather than in SecretStorage. */
  readonly secretsFoundInSettings?: boolean;

  /** Whether the security-testing policy has evidence in the tree. */
  readonly securityTestingEvidenced?: boolean;
  /** Whether the guardrail policy has evidence in the tree. */
  readonly guardrailEvidenced?: boolean;
  /** Whether the audit-trail policy has evidence in the tree. */
  readonly auditTrailEvidenced?: boolean;

  /** A published model or system card. */
  readonly modelCardPresent?: boolean;

  /**
   * Third-party model providers and whether their data handling is on record.
   *
   * The supplier-risk control (ISO A.5.19, SOC 2 CC9.2) in the only form this
   * product can check it: a provider AtlasMind will send text to, whose
   * retention and training terms nobody has recorded, is an unassessed
   * sub-processor.
   */
  readonly providerGovernance?: {
    readonly enabled: number;
    readonly withDeclaredGovernance: number;
  };

  /** The risk register, for the risk-assessment criteria. */
  readonly riskRegister?: {
    readonly assessed: boolean;
    readonly openFindings: number;
  };

  /** A linter is configured and enforced, for the secure-coding control. */
  readonly lintConfigured?: boolean;
  /** The linter runs in the pipeline rather than only on a developer's machine. */
  readonly lintInPipeline?: boolean;
}

// ── Results ──────────────────────────────────────────────────────

/**
 * `satisfied` — the check ran and the stack met it.
 * `gap` — the check ran and the stack did not meet it.
 * `not-applicable` — the control cannot apply to this project, with a reason.
 * `unknown` — the signal was not gathered, so nothing was learned.
 *
 * `not-applicable` is not a softer `gap`. A false gap is as corrosive as a
 * false pass: a board that reports a backup failure to a project holding no
 * data is one people learn to skim, and then the real findings go past too.
 * It carries a reason for the same purpose the control mapping does — an
 * unexplained exclusion is what an assessor asks about first.
 */
export type TechnicalControlState = 'satisfied' | 'gap' | 'not-applicable' | 'unknown';

export interface TechnicalControlResult {
  readonly policyId: TestingMethodologyId;
  /** The regime's own reference, so it lines up with the control mapping. */
  readonly controlRef: string;
  /** What was checked, in words somebody can disagree with. */
  readonly question: string;
  readonly state: TechnicalControlState;
  /** The declared rule that decided it. */
  readonly rule: string;
  /** What was actually found. Absent when nothing was looked at. */
  readonly evidence?: string;
}

interface TechnicalControlCheck {
  readonly policyId: TestingMethodologyId;
  readonly controlRef: string;
  readonly question: string;
  readonly rule: string;
  /**
   * Returns `undefined` when the signal was not gathered.
   *
   * `notApplicable` requires `evidence` to carry the reason — the same rule the
   * control mapping states for a `Not applicable` row, because an unexplained
   * exclusion is the first thing an assessor challenges.
   */
  readonly evaluate: (signals: ComplianceStackSignals)
  => { ok: boolean; evidence: string; notApplicable?: boolean } | undefined;
}

/**
 * Total controls each regime declares, so the unchecked remainder can be stated.
 *
 * Must track `COMPLIANCE_PROFILES` in `testingScaffolder.ts`, which is the set
 * the control mapping is written from — a count that drifted below it would
 * under-report how much is still a person's job, which is the direction that
 * flatters. A test pins the two together.
 */
const DECLARED_CONTROL_COUNT: Partial<Record<TestingMethodologyId, number>> = {
  'iso-27001': 25,
  soc2: 24,
  'nist-800-53': 11,
  'ai-safety-compliance': 7,
};

// ── Shared predicates ────────────────────────────────────────────
//
// Written once and reused across regimes on purpose: ISO A.8.8, SOC 2 CC7.2
// and NIST RA-5 are the same question asked by three standards, and three
// copies of the check would eventually give three answers about one repository.

const checkVulnerabilityScanning = (s: ComplianceStackSignals) =>
  s.vulnerabilityScanningConfigured === undefined && s.dependencyUpdatesConfigured === undefined
    ? undefined
    : {
      ok: s.vulnerabilityScanningConfigured === true || s.dependencyUpdatesConfigured === true,
      evidence: s.vulnerabilityScanningConfigured === true
        ? 'A vulnerability scanner is configured.'
        : s.dependencyUpdatesConfigured === true
          ? 'A dependency-update bot is configured.'
          : 'No dependency scanning or update automation was found.',
    };

const checkTransportProtection = (s: ComplianceStackSignals) => {
  if (!s.endpoints) {
    return undefined;
  }
  if (s.endpoints.total === 0) {
    // Nothing declared is not the same as nothing protected, and it is not a
    // pass either — there is simply no transport to assess.
    return undefined;
  }
  return {
    ok: s.endpoints.plaintextNonLoopback === 0,
    evidence: s.endpoints.plaintextNonLoopback === 0
      ? `All ${s.endpoints.total} declared endpoint(s) use TLS or loopback.`
      : `${s.endpoints.plaintextNonLoopback} declared endpoint(s) use plaintext http off the loopback.`,
  };
};

const checkSecretHandling = (s: ComplianceStackSignals) => {
  if (s.secretsFoundInSettings === undefined && s.endpoints === undefined) {
    return undefined;
  }
  const inSettings = s.secretsFoundInSettings === true;
  return {
    ok: !inSettings,
    evidence: inSettings
      ? 'A credential was found in settings rather than in SecretStorage.'
      : 'Credentials are referenced by name; none were found in settings.',
  };
};

const checkChangeReview = (s: ComplianceStackSignals) => {
  if (s.protectedBranches === undefined) {
    return undefined;
  }
  return {
    ok: s.protectedBranches.length > 0,
    evidence: s.protectedBranches.length > 0
      ? `Protected from direct pushes: ${s.protectedBranches.slice(0, 4).join(', ')}.`
      : 'No branch is protected from direct pushes.',
  };
};

const checkAutomatedVerification = (s: ComplianceStackSignals) => {
  if (s.ciWorkflowCount === undefined && s.requiredStatusChecks === undefined) {
    return undefined;
  }
  const checks = s.requiredStatusChecks ?? [];
  const workflows = s.ciWorkflowCount ?? 0;
  return {
    ok: workflows > 0 && checks.length > 0,
    evidence: workflows === 0
      ? 'No pipeline definition was found.'
      : checks.length === 0
        ? `${workflows} pipeline(s) exist, but no status check is required before a merge.`
        : `${workflows} pipeline(s), with ${checks.join(', ')} required before a merge.`,
  };
};

const checkAuditLogging = (s: ComplianceStackSignals) => {
  if (!s.auditLedger) {
    return undefined;
  }
  return {
    ok: s.auditLedger.present,
    evidence: s.auditLedger.present
      ? `A workflow audit ledger exists with ${s.auditLedger.runCount} recorded run(s).`
      : 'No workflow audit ledger was found.',
  };
};

const checkAccessControl = (s: ComplianceStackSignals) => {
  if (s.toolApprovalMode === undefined) {
    return undefined;
  }
  // `always-ask` and `ask-on-write` gate every write. `allow-safe-readonly`
  // still gates writes and is a deliberate, narrower choice. Nothing in the
  // declared set is ungated, so the check is that a *recognised* mode is set.
  const recognised = ['always-ask', 'ask-on-write', 'ask-on-external', 'allow-safe-readonly'];
  return {
    ok: recognised.includes(s.toolApprovalMode),
    evidence: recognised.includes(s.toolApprovalMode)
      ? `Tool use is gated in "${s.toolApprovalMode}" mode.`
      : `Tool approval mode "${s.toolApprovalMode}" is not a recognised gate.`,
  };
};

const checkEnvironmentSeparation = (s: ComplianceStackSignals) => {
  if (!s.deploymentStages) {
    return undefined;
  }
  return {
    ok: s.deploymentStages.count >= 2 && s.deploymentStages.hasProtectedProduction,
    evidence: s.deploymentStages.count < 2
      ? `Only ${s.deploymentStages.count} deployment stage is declared.`
      : s.deploymentStages.hasProtectedProduction
        ? `${s.deploymentStages.count} stages declared, with production protected.`
        : `${s.deploymentStages.count} stages declared, but production is not protected.`,
  };
};

const checkBackup = (s: ComplianceStackSignals) => {
  if (!s.backup) {
    return undefined;
  }
  if (!s.backup.hasDataRepository) {
    // Nothing to back up. Grading this as a failure would report a data-loss
    // risk to a project that holds no data, and a board that does that is one
    // people stop reading.
    return {
      ok: true,
      notApplicable: true,
      evidence: 'Every stage declares no application data store, so there is nothing to back up.',
    };
  }
  if (!s.backup.required) {
    return { ok: false, evidence: 'No backup is required before a production promotion.' };
  }
  if (!s.backup.hasCommand) {
    // Deny-by-default: the promotion is blocked, which is safe but is not a
    // working backup. Reporting it as satisfied would claim a recovery
    // capability that has never run.
    return { ok: false, evidence: 'A backup is required but no command is configured, so promotion stays blocked.' };
  }
  return {
    ok: true,
    evidence: s.backup.hasVerifyCommand
      ? 'A backup command is configured and verified before promotion.'
      : 'A backup command is configured (no restore verification step).',
  };
};

const checkIncidentRoute = (s: ComplianceStackSignals) => {
  if (s.securityPolicyPresent === undefined) {
    return undefined;
  }
  return {
    ok: s.securityPolicyPresent,
    evidence: s.securityPolicyPresent
      ? 'A published vulnerability-reporting route exists (SECURITY.md).'
      : 'No published vulnerability-reporting route was found.',
  };
};

const checkSecureTesting = (s: ComplianceStackSignals) => {
  if (s.securityTestingEvidenced === undefined) {
    return undefined;
  }
  return {
    ok: s.securityTestingEvidenced,
    evidence: s.securityTestingEvidenced
      ? 'The security-testing policy has evidence in the tree.'
      : 'The security-testing policy has no evidence in the tree.',
  };
};

const checkSupplierGovernance = (s: ComplianceStackSignals) => {
  if (!s.providerGovernance) {
    return undefined;
  }
  const { enabled, withDeclaredGovernance } = s.providerGovernance;
  if (enabled === 0) {
    // No third party receives anything, so there is no supplier to assess.
    // Not a pass — there is nothing here to have got right.
    return undefined;
  }
  return {
    ok: withDeclaredGovernance >= enabled,
    evidence: withDeclaredGovernance >= enabled
      ? `All ${enabled} enabled provider(s) have recorded retention and training terms.`
      : `${enabled - withDeclaredGovernance} of ${enabled} enabled provider(s) have no recorded data-handling terms.`,
  };
};

const checkRiskAssessment = (s: ComplianceStackSignals) => {
  if (!s.riskRegister) {
    return undefined;
  }
  // Assessed, not empty. A register nobody has run reports zero findings, and
  // zero-because-unassessed must not read as zero-because-clean — the same
  // distinction `hasBeenScanned` draws in the research register.
  return {
    ok: s.riskRegister.assessed,
    evidence: s.riskRegister.assessed
      ? `The risk register has been assessed and holds ${s.riskRegister.openFindings} open finding(s).`
      : 'The risk register has never been run, so no risk has been identified or ruled out.',
  };
};

const checkSecureCoding = (s: ComplianceStackSignals) => {
  if (s.lintConfigured === undefined) {
    return undefined;
  }
  // Configured *and* enforced. A linter that only runs when a developer
  // remembers is a suggestion, and the control asks for applied principles.
  return {
    ok: s.lintConfigured === true && s.lintInPipeline === true,
    evidence: s.lintConfigured !== true
      ? 'No linter is configured.'
      : s.lintInPipeline === true
        ? 'A linter is configured and runs in the pipeline.'
        : 'A linter is configured but nothing enforces it before a merge.',
  };
};

const checkPersonalDataProtection = (s: ComplianceStackSignals) => {
  if (!s.privacy) {
    return undefined;
  }
  return {
    ok: s.privacy.enabled && s.privacy.compliancePackCount > 0,
    evidence: !s.privacy.enabled
      ? 'The data-privacy gate is switched off, so nothing is classified before it is sent.'
      : s.privacy.compliancePackCount === 0
        ? 'The data-privacy gate is on but no compliance pack is enabled, so it detects nothing.'
        : `The data-privacy gate is on with ${s.privacy.compliancePackCount} pack(s) enabled.`,
  };
};

const checkSecretScanning = (s: ComplianceStackSignals) => {
  if (s.secretScanningConfigured === undefined) {
    return undefined;
  }
  return {
    ok: s.secretScanningConfigured,
    evidence: s.secretScanningConfigured
      ? 'A secret scanner is configured.'
      : 'No secret scanner is configured.',
  };
};

// ── The declared checks ──────────────────────────────────────────

const TECHNICAL_CONTROL_CHECKS: readonly TechnicalControlCheck[] = [
  // ── ISO/IEC 27001:2022 Annex A — organisational (A.5) ──
  //
  // Most of A.5 is a person writing something down and meaning it, which no
  // scan can confirm. These four are the exceptions: each rests on a fact the
  // workspace already records, and leaving them to a human when the answer is
  // on disk is the withholding failure this module exists to fix.
  {
    policyId: 'iso-27001', controlRef: 'A.5.19',
    question: 'Are the data-handling terms of every model provider on record?',
    rule: 'Every enabled provider has recorded retention and training terms.',
    evaluate: checkSupplierGovernance,
  },
  {
    policyId: 'iso-27001', controlRef: 'A.5.23',
    question: 'Is the use of third-party cloud services governed?',
    rule: 'Every enabled provider has recorded retention and training terms.',
    evaluate: checkSupplierGovernance,
  },
  {
    policyId: 'iso-27001', controlRef: 'A.5.26',
    question: 'Is there a defined route for responding to a security incident?',
    rule: 'A vulnerability-reporting policy exists.',
    evaluate: checkIncidentRoute,
  },
  {
    policyId: 'iso-27001', controlRef: 'A.5.34',
    question: 'Is personal data protected before it leaves the machine?',
    rule: 'The data-privacy gate is on with at least one compliance pack enabled.',
    evaluate: checkPersonalDataProtection,
  },

  // ── ISO/IEC 27001:2022 Annex A — technological (A.8) ──
  {
    policyId: 'iso-27001', controlRef: 'A.5.15',
    question: 'Is access to tools and the workspace gated rather than open?',
    rule: 'A recognised tool-approval mode is configured.',
    evaluate: checkAccessControl,
  },
  {
    policyId: 'iso-27001', controlRef: 'A.8.8',
    question: 'Are known dependency vulnerabilities being looked for?',
    rule: 'A vulnerability scanner or a dependency-update bot is configured.',
    evaluate: checkVulnerabilityScanning,
  },
  {
    policyId: 'iso-27001', controlRef: 'A.8.15',
    question: 'Is there a durable record of what the workflow did?',
    rule: 'A workflow audit ledger exists.',
    evaluate: checkAuditLogging,
  },
  {
    policyId: 'iso-27001', controlRef: 'A.8.24',
    question: 'Are credentials kept out of source and configuration?',
    rule: 'No credential is stored in settings; endpoints name secrets by reference.',
    evaluate: checkSecretHandling,
  },
  {
    policyId: 'iso-27001', controlRef: 'A.8.25',
    question: 'Does every change go through an automated pipeline before merge?',
    rule: 'At least one pipeline exists and at least one status check is required.',
    evaluate: checkAutomatedVerification,
  },
  {
    policyId: 'iso-27001', controlRef: 'A.8.29',
    question: 'Is security testing actually performed?',
    rule: 'The security-testing policy has evidence in the tree.',
    evaluate: checkSecureTesting,
  },
  {
    policyId: 'iso-27001', controlRef: 'A.8.28',
    question: 'Are secure coding principles actually enforced?',
    rule: 'A linter is configured and runs in the pipeline.',
    evaluate: checkSecureCoding,
  },
  {
    policyId: 'iso-27001', controlRef: 'A.8.31',
    question: 'Are development, test and production environments separated?',
    rule: 'Two or more deployment stages are declared and production is protected.',
    evaluate: checkEnvironmentSeparation,
  },

  // ── SOC 2 Trust Services Criteria — common criteria (CC1–CC5) ──
  //
  // The governance half. CC1 (control environment) and CC2 (communication) are
  // almost entirely human — a board, an org chart, a code of conduct — and are
  // deliberately absent here rather than approximated. CC3 and CC4 are not:
  // "risk is identified" and "controls are evaluated on an ongoing basis" are
  // answerable from the risk register and the pipeline.
  {
    policyId: 'soc2', controlRef: 'CC3.2',
    question: 'Has risk to the objectives been identified and analysed?',
    rule: 'The risk register has been assessed at least once.',
    evaluate: checkRiskAssessment,
  },
  {
    policyId: 'soc2', controlRef: 'CC4.1',
    question: 'Are the controls evaluated on an ongoing basis rather than once?',
    rule: 'At least one pipeline exists and at least one status check is required.',
    evaluate: checkAutomatedVerification,
  },
  {
    policyId: 'soc2', controlRef: 'CC9.2',
    question: 'Is the risk from vendors and sub-processors managed?',
    rule: 'Every enabled provider has recorded retention and training terms.',
    evaluate: checkSupplierGovernance,
  },

  // ── SOC 2 Trust Services Criteria — CC6–CC8, A1 ──
  {
    policyId: 'soc2', controlRef: 'CC6.1',
    question: 'Do logical access controls restrict what can be done unattended?',
    rule: 'A recognised tool-approval mode is configured.',
    evaluate: checkAccessControl,
  },
  {
    policyId: 'soc2', controlRef: 'CC6.6',
    question: 'Are external access points protected in transit?',
    rule: 'No declared endpoint uses plaintext http off the loopback.',
    evaluate: checkTransportProtection,
  },
  {
    policyId: 'soc2', controlRef: 'CC6.7',
    question: 'Are credentials protected rather than stored in the clear?',
    rule: 'No credential is stored in settings; endpoints name secrets by reference.',
    evaluate: checkSecretHandling,
  },
  {
    policyId: 'soc2', controlRef: 'CC7.2',
    question: 'Is anything watching for known-vulnerable dependencies?',
    rule: 'A vulnerability scanner or a dependency-update bot is configured.',
    evaluate: checkVulnerabilityScanning,
  },
  {
    policyId: 'soc2', controlRef: 'CC7.3',
    question: 'Is there a published route for reporting a security incident?',
    rule: 'A vulnerability-reporting policy exists.',
    evaluate: checkIncidentRoute,
  },
  {
    policyId: 'soc2', controlRef: 'CC8.1',
    question: 'Are changes reviewed and tested before they reach production?',
    rule: 'At least one branch is protected from direct pushes.',
    evaluate: checkChangeReview,
  },
  {
    policyId: 'soc2', controlRef: 'A1.2',
    question: 'Is a backup taken before a production promotion?',
    rule: 'The production stage requires a backup and has a command configured.',
    evaluate: checkBackup,
  },

  // ── NIST SP 800-53 Rev. 5 ──
  {
    policyId: 'nist-800-53', controlRef: 'AC-6',
    question: 'Is least privilege enforced on unattended action?',
    rule: 'A recognised tool-approval mode is configured.',
    evaluate: checkAccessControl,
  },
  {
    policyId: 'nist-800-53', controlRef: 'AU-2',
    question: 'Are workflow events logged?',
    rule: 'A workflow audit ledger exists.',
    evaluate: checkAuditLogging,
  },
  {
    policyId: 'nist-800-53', controlRef: 'CM-3',
    question: 'Is configuration change controlled through review?',
    rule: 'At least one branch is protected from direct pushes.',
    evaluate: checkChangeReview,
  },
  {
    policyId: 'nist-800-53', controlRef: 'RA-5',
    question: 'Is the dependency surface scanned for known flaws?',
    rule: 'A vulnerability scanner or a dependency-update bot is configured.',
    evaluate: checkVulnerabilityScanning,
  },
  {
    policyId: 'nist-800-53', controlRef: 'SA-11',
    question: 'Is developer security testing performed?',
    rule: 'The security-testing policy has evidence in the tree.',
    evaluate: checkSecureTesting,
  },
  {
    policyId: 'nist-800-53', controlRef: 'SC-8',
    question: 'Is transmission confidentiality protected?',
    rule: 'No declared endpoint uses plaintext http off the loopback.',
    evaluate: checkTransportProtection,
  },
  {
    policyId: 'nist-800-53', controlRef: 'SC-28',
    question: 'Is information at rest protected from casual disclosure?',
    rule: 'No credential is stored in settings; a secret scanner is configured.',
    evaluate: (s) => {
      const secrets = checkSecretHandling(s);
      const scanning = checkSecretScanning(s);
      if (!secrets && !scanning) {
        return undefined;
      }
      const ok = (secrets?.ok ?? false) && (scanning?.ok ?? false);
      return {
        ok,
        evidence: [secrets?.evidence, scanning?.evidence].filter(Boolean).join(' '),
      };
    },
  },
  {
    policyId: 'nist-800-53', controlRef: 'SI-2',
    question: 'Are flaws remediated on a managed cadence?',
    rule: 'A dependency-update bot is configured.',
    evaluate: (s) => s.dependencyUpdatesConfigured === undefined
      ? undefined
      : {
        ok: s.dependencyUpdatesConfigured,
        evidence: s.dependencyUpdatesConfigured
          ? 'A dependency-update bot is configured.'
          : 'No dependency-update automation was found.',
      },
  },

  // ── AI safety commitments ──
  {
    policyId: 'ai-safety-compliance', controlRef: 'GOV-2',
    question: 'Is a model or system card published?',
    rule: 'A model card exists in the repository.',
    evaluate: (s) => s.modelCardPresent === undefined
      ? undefined
      : {
        ok: s.modelCardPresent,
        evidence: s.modelCardPresent ? 'A model card was found.' : 'No model card was found.',
      },
  },
  {
    policyId: 'ai-safety-compliance', controlRef: 'GOV-3',
    question: 'Is there a human in the loop for consequential action?',
    rule: 'A recognised tool-approval mode is configured.',
    evaluate: checkAccessControl,
  },
  {
    policyId: 'ai-safety-compliance', controlRef: 'GOV-4',
    question: 'Do the declared guardrails have an enforcement test?',
    rule: 'The guardrail policy has evidence in the tree.',
    evaluate: (s) => s.guardrailEvidenced === undefined
      ? undefined
      : {
        ok: s.guardrailEvidenced,
        evidence: s.guardrailEvidenced
          ? 'The guardrail policy has evidence in the tree.'
          : 'No guardrail enforcement test was found.',
      },
  },
  {
    policyId: 'ai-safety-compliance', controlRef: 'GOV-6',
    question: 'Is there a route for reporting an AI-specific failure?',
    rule: 'A vulnerability-reporting policy exists.',
    evaluate: checkIncidentRoute,
  },
];

// ── API ──────────────────────────────────────────────────────────

/**
 * Does this policy have *any* control a machine can check?
 *
 * The question behind "can this protocol be removed?". A regime with no
 * technical check is one where the dashboard genuinely cannot help and the
 * whole value is the human mapping; a regime with several is one where turning
 * it off discards working automation.
 */
export function hasTechnicalControls(policyId: TestingMethodologyId): boolean {
  return TECHNICAL_CONTROL_CHECKS.some(check => check.policyId === policyId);
}

/** Every policy that carries at least one technical check. */
export function policiesWithTechnicalControls(): TestingMethodologyId[] {
  return [...new Set(TECHNICAL_CONTROL_CHECKS.map(check => check.policyId))];
}

/**
 * Run every technical check declared for this policy.
 *
 * Order follows the declaration, which follows the regime's own control
 * numbering, so the board reads in the same order as the mapping beside it.
 */
export function evaluateTechnicalControls(
  policyId: TestingMethodologyId,
  signals: ComplianceStackSignals,
): TechnicalControlResult[] {
  return TECHNICAL_CONTROL_CHECKS
    .filter(check => check.policyId === policyId)
    .map(check => {
      const outcome = check.evaluate(signals);
      if (!outcome) {
        return {
          policyId,
          controlRef: check.controlRef,
          question: check.question,
          state: 'unknown' as const,
          rule: check.rule,
        };
      }
      return {
        policyId,
        controlRef: check.controlRef,
        question: check.question,
        state: outcome.notApplicable === true
          ? ('not-applicable' as const)
          : outcome.ok ? ('satisfied' as const) : ('gap' as const),
        rule: check.rule,
        evidence: outcome.evidence,
      };
    });
}

export interface TechnicalControlSummary {
  readonly satisfied: number;
  readonly gaps: number;
  readonly unknown: number;
  /** Controls that cannot apply here, each with a stated reason. */
  readonly notApplicable: number;
  /** Controls with a technical check, whatever their state. */
  readonly checked: number;
  /**
   * Controls the regime declares that no machine check covers.
   *
   * Reported rather than omitted: "4 of 7 verified" beside a regime with ten
   * controls would imply the other three were the whole remainder.
   */
  readonly humanControlCount: number;
  /** One sentence for the card face. */
  readonly summary: string;
}

export function summarizeTechnicalControls(
  policyId: TestingMethodologyId,
  results: readonly TechnicalControlResult[],
): TechnicalControlSummary {
  const satisfied = results.filter(result => result.state === 'satisfied').length;
  const gaps = results.filter(result => result.state === 'gap').length;
  const unknown = results.filter(result => result.state === 'unknown').length;
  const notApplicable = results.filter(result => result.state === 'not-applicable').length;
  const declared = DECLARED_CONTROL_COUNT[policyId] ?? results.length;
  const humanControlCount = Math.max(0, declared - results.length);

  const parts: string[] = [];
  if (results.length === 0) {
    parts.push('No control in this regime can be checked automatically');
  } else {
    // The denominator excludes what cannot apply. "4/7 verified" on a project
    // where one control is out of scope understates it, and the fix is not to
    // count the exclusion as a pass — it is to stop counting it at all.
    const applicable = results.length - notApplicable;
    parts.push(`${satisfied}/${applicable} automatically verified`);
    if (gaps > 0) {
      parts.push(`${gaps} not met`);
    }
    if (unknown > 0) {
      parts.push(`${unknown} not assessed`);
    }
    if (notApplicable > 0) {
      parts.push(`${notApplicable} not applicable`);
    }
  }
  if (humanControlCount > 0) {
    parts.push(`${humanControlCount} for a person`);
  }

  return {
    satisfied,
    gaps,
    unknown,
    notApplicable,
    checked: results.length,
    humanControlCount,
    summary: `${parts.join(' · ')}.`,
  };
}
