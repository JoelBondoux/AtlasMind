import type { TestingMethodologyId } from '../types.js';

/**
 * What each control in a governance regime actually needs before anybody may
 * say it is met.
 *
 * The board this replaces graded twenty-four regimes on three signals, and all
 * three were reachable without anybody assessing anything: a filename matching
 * `privacy`, a scaffolded control mapping with one cell filled in, and a single
 * passing stack check promoting a whole regime. The missing idea was not a
 * better heuristic — it was that a control states *what kind of thing* would
 * settle it, and most of them cannot be settled by a repository at all.
 *
 * ── `accepts` is the whole of the ceiling mechanism ────────────────────────
 *
 * The central field is {@link ComplianceControl.accepts}: the evidence kinds
 * that can satisfy *this* control. Deliberately a set rather than a rank.
 *
 * A single ordered `assurance` level was the obvious design and it is wrong,
 * because the four kinds differ **in kind, not in strength**. There is no
 * honest total order in which `machine-check` beats `attestation`, or
 * `artifact` falls below it: no scanner can assess "information security roles
 * and responsibilities assigned", and no person's word produces a bill of
 * materials. Any ranking forces a lie at one end or the other. With a set the
 * ceiling falls out exactly — `accepts: ['independent']` means no attestation
 * ever closes that control, however many are recorded against it — and "may
 * this project close this on its own word?" is answered by reading the row
 * rather than by a second field that can contradict the first.
 *
 * ── Three rules govern how a row is written ────────────────────────────────
 *
 * **`machine-check` appears only where a machine answers the whole control as
 * this product can express it.** ISO A.8.8 is "vulnerabilities identified *and
 * remediated*", so a Dependabot configuration does not evidence it and the row
 * is attestation-and-artifact. SOC 2 CC6.6 is "external access points are
 * protected", and "no declared endpoint uses plaintext http off the loopback"
 * *is* the answer for the declared surface, so that row accepts a machine
 * check. Getting this wrong rebuilds the original bug inside the file that
 * exists to prevent it, which is why every such row carries an
 * {@link ComplianceControl.acceptsReason}.
 *
 * **Scope is a gate, not a field.** Every {@link ComplianceRegimeCatalog.scoping}
 * string says the mapping means nothing until scope is decided — the Statement
 * of Applicability, Type I versus Type II, the SAQ level, the ASIL, the DAL.
 * The register enforces it: with no recorded scope decision every control reads
 * not-assessed whatever is stored against it.
 *
 * **Every regime either declares a control an outside party must sign, or says
 * in {@link ComplianceRegimeCatalog.noIndependentControl} why it has none.** A
 * test pins that, so the author decides per regime rather than omitting by
 * accident. Nine of those controls did not exist in the profiles this file was
 * lifted from, and their absence was itself the defect: the SOC 2 mapping had
 * twenty-four rows and not one of them was "a service auditor issued a report".
 *
 * ── What this file is not ─────────────────────────────────────────────────
 *
 * **It is not the standards.** ISO and PCI control text is copyrighted and
 * licensed; ISO 27001 costs money and may not be redistributed. What follows is
 * a paraphrase of each requirement beside its official reference, which is what
 * the scaffolder's profiles already were. Nothing here is ever fetched,
 * mirrored, or model-generated — a hallucinated control in a compliance catalog
 * is the worst artifact this feature could produce.
 *
 * **It is not where the edition lives.** Which edition of a standard a
 * methodology models, and when AtlasMind last checked that control set, live on
 * `TestingMethodologyDefinition.standardTracking` in `types.ts` — one home for
 * all sixty-nine methodologies rather than a second copy for these twenty-four
 * that could disagree with it.
 */

// ── Identity ─────────────────────────────────────────────────────────────

/**
 * The twenty-four governance regimes, as a compile-time-total union.
 *
 * Derived from `TestingMethodologyId` with `Extract` rather than restated, so a
 * regime cannot be renamed in `types.ts` and left dangling here.
 */
export type ComplianceMethodologyId = Extract<TestingMethodologyId,
  | 'iso-27001' | 'soc2' | 'gdpr' | 'hipaa' | 'pci-dss' | 'nist-800-53'
  | 'change-management' | 'audit-trail' | 'rbac-compliance' | 'data-retention'
  | 'sbom' | 'dependency-licensing' | 'license-compatibility' | 'secure-build-pipeline'
  | 'ai-safety-compliance' | 'model-output-risk' | 'bias-fairness' | 'explainability' | 'ai-data-policy'
  | 'financial-compliance' | 'medical-compliance' | 'automotive-compliance'
  | 'aviation-compliance' | 'energy-compliance'>;

/** Grouping used to order a mapping so it reads the way an assessor works. */
export type ComplianceTheme = 'governance' | 'people' | 'physical' | 'technological';

/**
 * What kind of act produces a piece of evidence.
 *
 * Not ordered, and not orderable — see the module header. Sufficiency is
 * declared per control by {@link ComplianceControl.accepts}.
 */
export type EvidenceKind =
  /**
   * A machine re-derived the fact, and the result is the evidence.
   *
   * Either AtlasMind checking the declared stack, or the project's own tooling
   * producing a result nobody typed — a coverage report, a licence scan, a
   * bill of materials diffed against the resolved dependency graph. The common
   * property is that re-running it would produce the answer again, which is
   * exactly what an attestation cannot promise.
   *
   * AtlasMind's own checks are only ever a statement about the moment they ran,
   * so they are recorded with the timestamp of the render that produced them.
   */
  | 'machine-check'
  /** A named person asserted it on a stated date. */
  | 'attestation'
  /** A document or record exists and is referenced — never copied here. */
  | 'artifact'
  /** An outside party said it: certificate, audit report, pen test, signed agreement. */
  | 'independent';

/**
 * Why evidence for this control stops being current.
 *
 * Only `clock` is enforced. An SBOM expires when the dependency graph changes
 * and a threat model expires when the architecture does, and neither is a
 * duration — so the honest thing is to state the trigger and let the card say
 * "this should be refreshed every release; AtlasMind can only tell you it is
 * four months old", rather than silently treating a release-scoped artifact as
 * good for a year.
 */
export type StaleTrigger = 'clock' | 'release' | 'dependency-change' | 'architecture-change';

// ── Shape ────────────────────────────────────────────────────────────────

export interface ComplianceControl {
  /** The regime's own reference, so a row lines up with the published standard. */
  readonly ref: string;
  /** A paraphrase of the requirement. Never the standard's own text. */
  readonly requirement: string;
  readonly theme: ComplianceTheme;
  /**
   * The evidence kinds that can satisfy this control.
   *
   * A control whose only entry is `independent` cannot be closed by anybody
   * inside the project, however many attestations are recorded against it.
   */
  readonly accepts: readonly EvidenceKind[];
  /** Shown beside the ceiling, so a reader can disagree with the rule. */
  readonly acceptsReason?: string;
  /** Months from the assertion date. Overrides the regime default. */
  readonly periodMonths?: number;
  /** Evidence must span this many months of history (a SOC 2 Type II window). */
  readonly continuityMonths?: number;
  /** Declared and displayed; only `clock` is enforced. */
  readonly staleTrigger?: StaleTrigger;
  /**
   * Per-scope-variant overrides, keyed by the register's recorded scope variant.
   *
   * PCI DSS permits self-assessment at the SAQ levels and requires a QSA at
   * Level 1; a SOC 2 Type II adds a continuity window a Type I does not. Held
   * as declared data rather than as a predicate so the table stays reviewable
   * in a diff.
   */
  readonly variants?: Readonly<Record<string, {
    readonly accepts?: readonly EvidenceKind[];
    readonly periodMonths?: number;
    readonly continuityMonths?: number;
  }>>;
}

export interface ComplianceRegimeCatalog {
  readonly policyId: ComplianceMethodologyId;
  /** The regime's own name, as it would be written on a report. */
  readonly regime: string;
  /** What must be decided before the mapping means anything. */
  readonly scoping: string;
  /** Recognised values for the register's scope variant, so the page can offer them. */
  readonly variants?: readonly string[];
  /** Applied to any control that does not state its own `periodMonths`. */
  readonly defaultPeriodMonths: number;
  readonly controls: readonly ComplianceControl[];
  /**
   * Set only where a regime genuinely has no control an outside party must sign.
   *
   * A test fails when a regime declares neither this nor an `independent`
   * control, so the omission is a decision somebody made rather than one nobody
   * noticed.
   */
  readonly noIndependentControl?: string;
}

// ── Labels ───────────────────────────────────────────────────────────────

export const EVIDENCE_KIND_LABEL: Readonly<Record<EvidenceKind, string>> = {
  'machine-check': 'Checked by AtlasMind',
  attestation: 'A named person states it',
  artifact: 'A document exists',
  independent: 'An outside party says so',
};

export const EVIDENCE_KIND_DETAIL: Readonly<Record<EvidenceKind, string>> = {
  'machine-check': 'AtlasMind re-derived this from the repository or the declared stack. It is only ever a statement about the moment it ran.',
  attestation: 'Somebody named, on a stated date, asserts this is so. The assertion is the artifact.',
  artifact: 'A document or record exists and can be produced — a policy, a report, a signed record. AtlasMind stores a reference to it, never a copy.',
  independent: 'Somebody outside this project says so: a certification body, an auditor, a penetration tester, a counterparty to a signed agreement. Nothing this project produces about itself can substitute.',
};

export const COMPLIANCE_THEME_LABEL: Readonly<Record<ComplianceTheme, string>> = {
  governance: 'Governance and organisational',
  people: 'People',
  physical: 'Physical',
  technological: 'Technological',
};

/** The order a mapping renders in, so it reads the way an assessor works. */
export const COMPLIANCE_THEME_ORDER: readonly ComplianceTheme[] = [
  'governance', 'people', 'physical', 'technological',
];

// ── Shared `accepts` sets ────────────────────────────────────────────────
//
// Named rather than repeated so the three writing rules in the module header
// are visible in the rows themselves: a reader scanning the catalog sees which
// rule produced each ceiling without reading four literals to work it out.

/** A policy, a procedure, or an assignment of responsibility. Nothing checks it. */
const DOCUMENTED: readonly EvidenceKind[] = ['attestation', 'artifact'];
/** A produced record: a report, a signed record, a retained result. */
const RECORDED: readonly EvidenceKind[] = ['artifact', 'attestation'];
/**
 * A machine answers this whole control for the declared surface, and a person
 * can speak to the part of it the declaration does not cover.
 */
const ENFORCED: readonly EvidenceKind[] = ['machine-check', 'attestation'];
/**
 * A tool produces the result and the result is the evidence — a coverage
 * report, a licence scan, a bill of materials. Paired with `artifact` because
 * the output has to be retained and pointed at, not merely have been run once
 * on somebody's laptop.
 */
const PRODUCED: readonly EvidenceKind[] = ['machine-check', 'artifact'];
/** Only somebody outside this project can close it. */
const EXTERNAL: readonly EvidenceKind[] = ['independent'];

// ── The catalog ──────────────────────────────────────────────────────────

export const COMPLIANCE_CONTROL_CATALOG: Readonly<Record<ComplianceMethodologyId, ComplianceRegimeCatalog>> = {
  'iso-27001': {
    policyId: 'iso-27001',
    regime: 'ISO/IEC 27001:2022 Annex A',
    scoping: 'Which Annex A controls are applicable, and which are excluded with a stated justification — your Statement of Applicability. A software team with no premises of its own will usually scope out most of A.7; write the justification down, because "we have no office" is a perfectly good one and an unexplained omission is not.',
    defaultPeriodMonths: 12,
    controls: [
      { ref: 'A.5.1', requirement: 'Information security policy defined, approved and communicated', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'A.5.2', requirement: 'Information security roles and responsibilities assigned', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'A.5.7', requirement: 'Threat intelligence collected and acted on', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'A.5.9', requirement: 'Inventory of information and other associated assets maintained', theme: 'governance', accepts: RECORDED },
      { ref: 'A.5.15', requirement: 'Access control policy defined and applied', theme: 'governance', accepts: DOCUMENTED },
      {
        ref: 'A.5.19',
        requirement: 'Information security in supplier and sub-processor relationships',
        theme: 'governance',
        accepts: DOCUMENTED,
        acceptsReason: 'AtlasMind can see which providers are enabled and whether their data handling is on record, but the control is about the agreements behind them. The stack check corroborates; it does not settle it.',
        periodMonths: 24,
      },
      { ref: 'A.5.23', requirement: 'Information security for use of cloud services', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'A.5.24', requirement: 'Incident management planned and prepared for', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'A.5.26', requirement: 'Response to information security incidents defined', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'A.5.30', requirement: 'ICT readiness for business continuity', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'A.5.31', requirement: 'Legal, statutory, regulatory and contractual requirements identified', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'A.5.34', requirement: 'Privacy and protection of personally identifiable information', theme: 'governance', accepts: DOCUMENTED },
      {
        ref: 'A.5.35',
        requirement: 'Independent review of information security',
        theme: 'governance',
        accepts: EXTERNAL,
        acceptsReason: 'The control is that somebody independent reviewed it. A review this project performs on itself is the thing the control exists to rule out.',
        periodMonths: 12,
      },
      {
        ref: 'CERT-1',
        requirement: 'A certification body has issued a current certificate covering this scope',
        theme: 'governance',
        accepts: EXTERNAL,
        acceptsReason: 'Nobody certifies themselves. Recorded separately from the controls because a certificate covers a stated scope, and a certificate for a different entity or a different boundary is not evidence about this one.',
        periodMonths: 36,
      },
      {
        ref: 'CERT-2',
        requirement: 'Surveillance audit performed within the last twelve months',
        theme: 'governance',
        accepts: EXTERNAL,
        acceptsReason: 'A three-year certificate lapses in practice if the annual surveillance audit is missed, so its currency is a separate fact from the certificate.',
        periodMonths: 12,
      },
      { ref: 'A.6.3', requirement: 'Information security awareness, education and training', theme: 'people', accepts: RECORDED },
      { ref: 'A.6.6', requirement: 'Confidentiality or non-disclosure agreements in place', theme: 'people', accepts: RECORDED, periodMonths: 24 },
      { ref: 'A.7.9', requirement: 'Security of assets off-premises (laptops, portable media)', theme: 'physical', accepts: DOCUMENTED },
      { ref: 'A.8.2', requirement: 'Privileged access rights restricted and reviewed', theme: 'technological', accepts: RECORDED, acceptsReason: 'The review is the control, and a review is a record somebody produced on a date.' },
      {
        ref: 'A.8.8',
        requirement: 'Technical vulnerabilities identified and remediated',
        theme: 'technological',
        accepts: DOCUMENTED,
        acceptsReason: 'A configured scanner evidences identification and says nothing about remediation, which is the half that matters. The stack check corroborates it.',
      },
      { ref: 'A.8.15', requirement: 'Logging of user activities, exceptions and security events', theme: 'technological', accepts: DOCUMENTED },
      { ref: 'A.8.16', requirement: 'Monitoring activities to detect anomalous behaviour', theme: 'technological', accepts: DOCUMENTED },
      { ref: 'A.8.24', requirement: 'Use of cryptography governed by policy', theme: 'technological', accepts: DOCUMENTED, acceptsReason: 'The control is that a policy governs the choices, not that any one connection is encrypted.' },
      { ref: 'A.8.25', requirement: 'Secure development lifecycle defined', theme: 'technological', accepts: DOCUMENTED },
      { ref: 'A.8.28', requirement: 'Secure coding principles applied', theme: 'technological', accepts: DOCUMENTED },
      {
        ref: 'A.8.29',
        requirement: 'Security testing performed in development and acceptance',
        theme: 'technological',
        accepts: ENFORCED,
        acceptsReason: 'Security tests present and running in the tree is what this control asks for, and AtlasMind can see both.',
      },
      {
        ref: 'A.8.31',
        requirement: 'Development, test and production environments separated',
        theme: 'technological',
        accepts: ENFORCED,
        acceptsReason: 'The declared delivery pipeline states the environments and which are protected, which is the answer for the surface this project declares.',
      },
    ],
  },

  soc2: {
    policyId: 'soc2',
    regime: 'SOC 2 Trust Services Criteria',
    scoping: 'Which criteria are in scope — Security is mandatory; Availability, Confidentiality, Processing Integrity and Privacy are opt-in — and whether the report is Type I or Type II. A Type II asks for evidence *over a period*, so decide the observation window before filling anything in: a control satisfied today with no history behind it does not pass a Type II.',
    variants: ['Type I', 'Type II'],
    defaultPeriodMonths: 12,
    controls: [
      { ref: 'CC1.1', requirement: 'Commitment to integrity and ethical values demonstrated', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'CC1.2', requirement: 'Independent oversight of internal control exercised', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'CC1.3', requirement: 'Structures, reporting lines and authority established', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'CC1.4', requirement: 'Commitment to attract, develop and retain competent people', theme: 'people', accepts: DOCUMENTED },
      { ref: 'CC1.5', requirement: 'Individuals held accountable for their control responsibilities', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'CC2.1', requirement: 'Quality information obtained to support internal control', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'CC2.2', requirement: 'Control responsibilities communicated internally', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'CC2.3', requirement: 'Relevant matters communicated to external parties', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'CC3.1', requirement: 'Objectives specified clearly enough to assess risk against', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'CC3.2', requirement: 'Risks to the objectives identified and analysed', theme: 'governance', accepts: RECORDED, acceptsReason: 'A risk register is the artifact. AtlasMind can see whether one has been assessed, which corroborates rather than settles it.' },
      { ref: 'CC3.4', requirement: 'Significant changes assessed for their effect on control', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'CC4.1', requirement: 'Ongoing evaluations confirm the controls are present and working', theme: 'governance', accepts: RECORDED },
      { ref: 'CC4.2', requirement: 'Control deficiencies evaluated and communicated to those who can act', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'CC5.1', requirement: 'Control activities selected and developed to mitigate risk', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'CC6.1', requirement: 'Logical access controls restrict access to protected assets', theme: 'technological', accepts: DOCUMENTED },
      { ref: 'CC6.2', requirement: 'User registration and de-registration are authorised', theme: 'technological', accepts: DOCUMENTED },
      { ref: 'CC6.3', requirement: 'Access is modified and removed on role change or exit', theme: 'technological', accepts: RECORDED },
      {
        ref: 'CC6.6',
        requirement: 'External access points are protected',
        theme: 'technological',
        accepts: ENFORCED,
        acceptsReason: 'No declared endpoint using plaintext http off the loopback *is* the answer for the surface this project declares.',
      },
      { ref: 'CC6.7', requirement: 'Data in transit and at rest is protected', theme: 'technological', accepts: DOCUMENTED, acceptsReason: 'Transit is checkable from the declared endpoints; at rest is not, and half an answer is not the control.' },
      { ref: 'CC7.2', requirement: 'Anomalies are monitored and detected', theme: 'technological', accepts: DOCUMENTED },
      { ref: 'CC7.3', requirement: 'Security incidents are evaluated and responded to', theme: 'technological', accepts: DOCUMENTED },
      {
        ref: 'CC8.1',
        requirement: 'Changes are authorised, tested and approved before deployment',
        theme: 'technological',
        accepts: ENFORCED,
        acceptsReason: 'Protected branches and required reviews in the declared workflow are what this control asks for, and both are readable from the repository.',
      },
      { ref: 'CC9.2', requirement: 'Vendor and business-partner risk assessed and managed', theme: 'governance', accepts: DOCUMENTED, periodMonths: 24 },
      {
        ref: 'A1.2',
        requirement: 'Backup and recovery meet availability commitments (if in scope)',
        theme: 'technological',
        accepts: ENFORCED,
        acceptsReason: 'The declared delivery pipeline states whether a backup is required before a production promotion and whether it is verified.',
      },
      {
        ref: 'REPORT-1',
        requirement: 'A service auditor has issued a SOC 2 report covering the criteria in scope',
        theme: 'governance',
        accepts: EXTERNAL,
        acceptsReason: 'The whole of SOC 2 is that somebody else examined it. The mapping this file replaces had twenty-four control rows and no row for the audit itself, which meant a fully-completed mapping still described a project nobody had audited.',
        periodMonths: 12,
        variants: { 'Type II': { continuityMonths: 6 } },
      },
    ],
  },

  'nist-800-53': {
    policyId: 'nist-800-53',
    regime: 'NIST SP 800-53 Rev. 5 (Release 5.2.0) / SP 800-171',
    scoping: 'The impact-level baseline (Low / Moderate / High) or the 800-171 CUI scope. Map the tailored baseline, not the full catalogue.',
    variants: ['Low', 'Moderate', 'High', '800-171 CUI'],
    defaultPeriodMonths: 12,
    controls: [
      { ref: 'AC-2', requirement: 'Account management', theme: 'technological', accepts: DOCUMENTED },
      { ref: 'AC-6', requirement: 'Least privilege', theme: 'technological', accepts: DOCUMENTED },
      { ref: 'AU-2', requirement: 'Event logging', theme: 'technological', accepts: DOCUMENTED },
      { ref: 'AU-9', requirement: 'Protection of audit information', theme: 'technological', accepts: DOCUMENTED },
      {
        ref: 'CM-3',
        requirement: 'Configuration change control',
        theme: 'technological',
        accepts: ENFORCED,
        acceptsReason: 'Protected branches and required reviews are the change-control mechanism for a repository, and both are readable from the declared workflow.',
      },
      { ref: 'IA-2', requirement: 'Identification and authentication (organisational users)', theme: 'technological', accepts: DOCUMENTED },
      {
        ref: 'RA-5',
        requirement: 'Vulnerability monitoring and scanning',
        theme: 'technological',
        accepts: ENFORCED,
        acceptsReason: 'This control asks for scanning, where ISO A.8.8 asks for scanning *and* remediation. The narrower question is one a machine can answer.',
      },
      {
        ref: 'SA-11',
        requirement: 'Developer testing and evaluation',
        theme: 'technological',
        accepts: ENFORCED,
        acceptsReason: 'Security testing present and running in the tree is what this asks for.',
      },
      {
        ref: 'SC-8',
        requirement: 'Transmission confidentiality and integrity',
        theme: 'technological',
        accepts: ENFORCED,
        acceptsReason: 'Answerable for the declared endpoints, which is the surface this project has stated.',
      },
      { ref: 'SC-28', requirement: 'Protection of information at rest', theme: 'technological', accepts: DOCUMENTED },
      { ref: 'SI-2', requirement: 'Flaw remediation', theme: 'technological', accepts: DOCUMENTED, acceptsReason: 'Remediation is the control; a configured scanner is not evidence that anything was fixed.' },
      {
        ref: 'CA-2',
        requirement: 'Assessment performed by an assessor independent of the developers',
        theme: 'governance',
        accepts: EXTERNAL,
        acceptsReason: 'The catalogue asks for independence explicitly, and a team assessing its own system is what the control rules out.',
        periodMonths: 12,
      },
    ],
  },

  gdpr: {
    policyId: 'gdpr',
    regime: 'GDPR / UK GDPR',
    scoping: 'The lawful basis for each processing purpose, the role held (controller or processor), and whether any processing needs a DPIA.',
    defaultPeriodMonths: 12,
    controls: [
      { ref: 'Art. 5(1)(c)', requirement: 'Data minimisation — each field collected has a stated purpose', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'Art. 6', requirement: 'Lawful basis recorded per processing purpose', theme: 'governance', accepts: RECORDED },
      { ref: 'Art. 15', requirement: 'Subject access export is complete across every store', theme: 'technological', accepts: RECORDED, acceptsReason: 'A test proving the export covers every declared category is the artifact. AtlasMind has no check that can confirm it.' },
      { ref: 'Art. 17', requirement: 'Erasure reaches caches, indexes, analytics, logs and backups', theme: 'technological', accepts: RECORDED, acceptsReason: 'The usual gap is a deletion test that only checks the primary store, so the evidence has to be the test and its result, not a policy.' },
      { ref: 'Art. 25', requirement: 'Data protection by design and by default', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'Art. 30', requirement: 'Record of processing activities maintained', theme: 'governance', accepts: RECORDED },
      { ref: 'Art. 32', requirement: 'Encryption and pseudonymisation appropriate to the risk', theme: 'technological', accepts: DOCUMENTED },
      { ref: 'Art. 33', requirement: 'Breach notification route defined and rehearsed', theme: 'governance', accepts: DOCUMENTED },
      {
        ref: 'Art. 28',
        requirement: 'Processor agreement signed with every sub-processor',
        theme: 'governance',
        accepts: EXTERNAL,
        acceptsReason: 'A data processing agreement is a signed contract with the other party. Your own note that one exists is not the agreement.',
        periodMonths: 24,
      },
      {
        ref: 'Art. 44',
        requirement: 'International transfer mechanism in place where data leaves the region',
        theme: 'governance',
        accepts: EXTERNAL,
        acceptsReason: 'Standard contractual clauses and adequacy findings are instruments issued or signed outside this project.',
        periodMonths: 12,
      },
    ],
  },

  hipaa: {
    policyId: 'hipaa',
    regime: 'HIPAA Security Rule — technical safeguards',
    scoping: 'Whether this system is a covered entity or a business associate, where ePHI lives, and which addressable specifications are implemented versus documented as not reasonable.',
    variants: ['Covered entity', 'Business associate'],
    defaultPeriodMonths: 12,
    controls: [
      { ref: '164.312(a)(1)', requirement: 'Access control — unique user identification', theme: 'technological', accepts: DOCUMENTED },
      { ref: '164.312(a)(2)(iii)', requirement: 'Automatic logoff (addressable)', theme: 'technological', accepts: DOCUMENTED },
      { ref: '164.312(a)(2)(iv)', requirement: 'Encryption and decryption of ePHI at rest (addressable)', theme: 'technological', accepts: DOCUMENTED },
      { ref: '164.312(b)', requirement: 'Audit controls record activity on systems holding ePHI', theme: 'technological', accepts: DOCUMENTED },
      { ref: '164.312(c)(1)', requirement: 'Integrity — ePHI is not improperly altered or destroyed', theme: 'technological', accepts: DOCUMENTED },
      { ref: '164.312(d)', requirement: 'Person or entity authentication', theme: 'technological', accepts: DOCUMENTED },
      {
        ref: '164.312(e)(1)',
        requirement: 'Transmission security over open networks',
        theme: 'technological',
        accepts: ENFORCED,
        acceptsReason: 'Answerable for the declared endpoints.',
      },
      {
        ref: '164.308(b)',
        requirement: 'Business associate agreements in place for downstream processors',
        theme: 'governance',
        accepts: EXTERNAL,
        acceptsReason: 'A business associate agreement is signed by the other party.',
        periodMonths: 24,
      },
    ],
  },

  'pci-dss': {
    policyId: 'pci-dss',
    regime: 'PCI DSS v4.0.1 — application requirements',
    scoping: 'The cardholder data environment boundary and the SAQ type or assessment level. Scope reduction is the strategy: the best answer to most of these is that no system here touches a PAN.',
    variants: ['SAQ-A', 'SAQ-A-EP', 'SAQ-D', 'Level 1'],
    defaultPeriodMonths: 12,
    controls: [
      { ref: 'Req 3.3', requirement: 'PAN masked when displayed; full PAN never in logs or error output', theme: 'technological', accepts: RECORDED, acceptsReason: 'A test asserting a PAN never reaches a log is the artifact this asks for.' },
      { ref: 'Req 3.5', requirement: 'PAN rendered unreadable wherever stored', theme: 'technological', accepts: DOCUMENTED },
      {
        ref: 'Req 4.2',
        requirement: 'Strong cryptography for PAN transmitted over open networks',
        theme: 'technological',
        accepts: ENFORCED,
        acceptsReason: 'Answerable for the declared endpoints.',
      },
      { ref: 'Req 6.2', requirement: 'Bespoke software developed securely; developers trained', theme: 'technological', accepts: DOCUMENTED },
      {
        ref: 'Req 6.3',
        requirement: 'Vulnerabilities identified and ranked; dependencies patched',
        theme: 'technological',
        accepts: ENFORCED,
        acceptsReason: 'A configured scanner and a dependency-update route are what this asks for; the ranking is corroborated by the same evidence.',
      },
      { ref: 'Req 6.4', requirement: 'Public-facing web applications protected against attacks', theme: 'technological', accepts: DOCUMENTED },
      { ref: 'Req 8.3', requirement: 'Strong authentication for all access to the CDE', theme: 'technological', accepts: DOCUMENTED },
      { ref: 'Req 10.2', requirement: 'Audit logs capture all access to cardholder data', theme: 'technological', accepts: DOCUMENTED },
      {
        ref: 'AOC-1',
        requirement: 'Attestation of Compliance signed for the assessment level in scope',
        theme: 'governance',
        accepts: EXTERNAL,
        acceptsReason: 'At Level 1 a Qualified Security Assessor signs it. At the SAQ levels the merchant signs their own, which is why the ceiling moves with the scope variant rather than being fixed here.',
        periodMonths: 12,
        variants: {
          'SAQ-A': { accepts: RECORDED },
          'SAQ-A-EP': { accepts: RECORDED },
          'SAQ-D': { accepts: RECORDED },
          'Level 1': { accepts: EXTERNAL },
        },
      },
    ],
  },

  'change-management': {
    policyId: 'change-management',
    regime: 'Change management',
    scoping: 'Which changes require which approvals, and the documented break-glass path for emergencies. Without a stated emergency route the policy teaches people to bypass it.',
    defaultPeriodMonths: 12,
    noIndependentControl: 'Change management is an internal control. An auditor tests it under ISO A.8.25 or SOC 2 CC8.1 rather than certifying it in its own right, so recording a separate external sign-off here would invent an obligation nobody has.',
    controls: [
      {
        ref: 'CHG-1',
        requirement: 'Protected branches enforce review before merge',
        theme: 'governance',
        accepts: ENFORCED,
        acceptsReason: 'The declared workflow states which branches are protected, and that is exactly the control.',
      },
      {
        ref: 'CHG-2',
        requirement: 'Required approvals defined by change type and area (CODEOWNERS)',
        theme: 'governance',
        accepts: ENFORCED,
        acceptsReason: 'Readable from the repository.',
      },
      {
        ref: 'CHG-3',
        requirement: 'Every production change traces to an issue or ticket',
        theme: 'governance',
        accepts: PRODUCED,
        acceptsReason: 'Repository history answers this directly.',
      },
      { ref: 'CHG-4', requirement: 'Deployment to production requires a recorded approval', theme: 'governance', accepts: RECORDED },
      { ref: 'CHG-5', requirement: 'Emergency change path documented, with retrospective approval required', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'CHG-6', requirement: 'Rollback procedure defined and exercised', theme: 'technological', accepts: RECORDED, acceptsReason: 'Exercised is the operative word, and an exercise leaves a record.' },
      { ref: 'CHG-7', requirement: 'Segregation of duties between author and approver', theme: 'governance', accepts: DOCUMENTED },
    ],
  },

  'audit-trail': {
    policyId: 'audit-trail',
    regime: 'Audit trail completeness',
    scoping: 'Which actions are consequential enough to require an attributable record, and how long those records are kept. Without that list the control is unbounded and nothing can evidence it.',
    defaultPeriodMonths: 12,
    noIndependentControl: 'An audit trail is an internal control that other regimes test — ISO A.8.15, SOC 2 CC7.2, HIPAA 164.312(b). An external party examines it under those, not separately.',
    controls: [
      { ref: 'AUD-1', requirement: 'Consequential actions enumerated, and the list reviewed as the system grows', theme: 'governance', accepts: DOCUMENTED, acceptsReason: 'Keeping the list current is the work that lapses; a stale list makes every other control here read better than it is.' },
      { ref: 'AUD-2', requirement: 'Every consequential action writes actor, time and subject', theme: 'technological', accepts: RECORDED },
      { ref: 'AUD-3', requirement: 'Records are tamper-evident', theme: 'technological', accepts: DOCUMENTED },
      { ref: 'AUD-4', requirement: 'Retention period declared and enforced', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'AUD-5', requirement: 'Records are readable by somebody other than their author', theme: 'governance', accepts: DOCUMENTED, acceptsReason: 'An audit record only an administrator can read is not an audit record.' },
      { ref: 'AUD-6', requirement: 'Completeness verified by test rather than by inspection', theme: 'technological', accepts: PRODUCED, acceptsReason: 'A test enumerating the privileged paths and asserting each writes a record is the artifact; inspection misses the path added last week.' },
    ],
  },

  'rbac-compliance': {
    policyId: 'rbac-compliance',
    regime: 'Role-based access control',
    scoping: 'The role matrix — which roles exist, what each may do, and which resources are protected. Everything below is relative to that matrix, so an out-of-date one silently invalidates the lot.',
    defaultPeriodMonths: 12,
    noIndependentControl: 'Access control is examined by an assessor under ISO A.5.15 and A.8.2 or SOC 2 CC6.1 rather than certified on its own.',
    controls: [
      { ref: 'RBAC-1', requirement: 'Role matrix declared and current', theme: 'governance', accepts: RECORDED },
      { ref: 'RBAC-2', requirement: 'Every protected route enforces authorisation server-side', theme: 'technological', accepts: RECORDED, acceptsReason: 'Testing the policy layer proves nothing if a route bypasses it, so the evidence is a test at the data-access boundary.' },
      { ref: 'RBAC-3', requirement: 'Negative tests exist for each role and resource pair that must be denied', theme: 'technological', accepts: PRODUCED, acceptsReason: 'Privilege escalation lives entirely in the untested half, and the "cannot" half is the half nobody writes.' },
      { ref: 'RBAC-4', requirement: 'Privilege-escalation paths reviewed', theme: 'technological', accepts: DOCUMENTED },
      { ref: 'RBAC-5', requirement: 'Access removed on role change or exit', theme: 'governance', accepts: RECORDED },
      { ref: 'RBAC-6', requirement: 'Periodic access review performed and recorded', theme: 'governance', accepts: RECORDED, periodMonths: 12 },
    ],
  },

  'data-retention': {
    policyId: 'data-retention',
    regime: 'Data retention and deletion',
    scoping: 'The retention period for each data category, its source (regulation, contract, or policy), and what triggers a legal hold.',
    defaultPeriodMonths: 12,
    noIndependentControl: 'Retention is examined under GDPR Art. 5(1)(e) or the sector regime that sets the period, rather than certified separately.',
    controls: [
      { ref: 'RET-1', requirement: 'Retention schedule declared per data category with its source', theme: 'governance', accepts: RECORDED },
      { ref: 'RET-2', requirement: 'Deletion job runs on schedule and is monitored for failure', theme: 'technological', accepts: RECORDED, acceptsReason: 'A deletion job that fails silently is indistinguishable from one that never ran, so the monitoring is the control.' },
      { ref: 'RET-3', requirement: 'Deletion cascades to caches, search indexes and analytics', theme: 'technological', accepts: RECORDED },
      { ref: 'RET-4', requirement: 'Backup expiry aligns with the retention schedule', theme: 'technological', accepts: DOCUMENTED },
      { ref: 'RET-5', requirement: 'Legal hold suspends deletion and is released deliberately', theme: 'governance', accepts: DOCUMENTED, acceptsReason: 'Both directions fail: data outliving its window, and data destroyed while a hold was open.' },
      { ref: 'RET-6', requirement: 'Soft-deleted records are purged within the stated window', theme: 'technological', accepts: RECORDED },
    ],
  },

  sbom: {
    policyId: 'sbom',
    regime: 'Software bill of materials',
    scoping: 'Which artifacts ship, which SBOM format is produced for each, and where consumers obtain it.',
    variants: ['CycloneDX', 'SPDX'],
    defaultPeriodMonths: 3,
    noIndependentControl: 'An SBOM is a produced artifact rather than an assurance claim. Where a customer requires it to be attested, that attestation is the provenance chain under secure-build-pipeline SLSA-7.',
    controls: [
      { ref: 'SBOM-1', requirement: 'An SBOM is produced for every shipped artifact', theme: 'technological', accepts: PRODUCED, staleTrigger: 'release' },
      { ref: 'SBOM-2', requirement: 'The SBOM is generated by the build rather than by hand', theme: 'technological', accepts: PRODUCED, staleTrigger: 'release', acceptsReason: 'A hand-written SBOM is accurate on the day it is written and never again.' },
      {
        ref: 'SBOM-3',
        requirement: 'Completeness verified against the resolved dependency graph',
        theme: 'technological',
        accepts: PRODUCED,
        staleTrigger: 'dependency-change',
        periodMonths: 1,
        acceptsReason: 'A stale SBOM is worse than none, because it is trusted. This is the row that goes out of date without anybody touching it.',
      },
      { ref: 'SBOM-4', requirement: 'The SBOM is published or made available to consumers', theme: 'governance', accepts: DOCUMENTED, periodMonths: 12 },
      { ref: 'SBOM-5', requirement: 'Format and specification version declared', theme: 'technological', accepts: RECORDED, periodMonths: 12 },
      { ref: 'SBOM-6', requirement: 'Transitive and native dependencies included, not just direct ones', theme: 'technological', accepts: PRODUCED, staleTrigger: 'release' },
    ],
  },

  'dependency-licensing': {
    policyId: 'dependency-licensing',
    regime: 'Dependency licence policy',
    scoping: 'The allow and deny lists, and who approves an exception. An allowlist that fails the build on anything unrecognised gets widened under deadline pressure, so decide the triage route now.',
    defaultPeriodMonths: 12,
    noIndependentControl: 'Whether the licence set is compatible with how you distribute is a legal question, and it is asked under license-compatibility LEGAL-1 rather than twice.',
    controls: [
      { ref: 'LIC-1', requirement: 'Licence policy declared, with the allowed and denied sets stated', theme: 'governance', accepts: RECORDED },
      {
        ref: 'LIC-2',
        requirement: 'Every dependency resolves to a known licence identifier',
        theme: 'technological',
        accepts: PRODUCED,
        staleTrigger: 'dependency-change',
        periodMonths: 1,
      },
      {
        ref: 'LIC-3',
        requirement: 'No dependency carries a denied licence',
        theme: 'technological',
        accepts: PRODUCED,
        staleTrigger: 'dependency-change',
        periodMonths: 1,
        acceptsReason: 'A copyleft dependency arriving transitively on a minor version bump is the standard way this becomes a problem, which is why the window is short.',
      },
      { ref: 'LIC-4', requirement: 'Unknown or ambiguous licences resolved by a named person', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'LIC-5', requirement: 'Exceptions recorded with a rationale and an expiry', theme: 'governance', accepts: RECORDED },
      { ref: 'LIC-6', requirement: 'The scan runs in the pipeline rather than on a developer machine', theme: 'technological', accepts: ENFORCED, acceptsReason: 'Readable from the pipeline definition.' },
    ],
  },

  'license-compatibility': {
    policyId: 'license-compatibility',
    regime: 'Open-source licence compatibility',
    scoping: 'How this software is distributed — linked binary, bundled application, SaaS only, or source. The same dependency set gives different answers for each, and the model cannot be inferred.',
    variants: ['SaaS only', 'Distributed binary', 'Source', 'Bundled application'],
    defaultPeriodMonths: 12,
    controls: [
      { ref: 'DIST-1', requirement: 'Distribution model stated and current', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'DIST-2', requirement: 'Outbound licence of this project declared', theme: 'governance', accepts: RECORDED },
      {
        ref: 'COMPAT-1',
        requirement: 'No strong copyleft dependency reaches a proprietary distribution',
        theme: 'technological',
        accepts: PRODUCED,
        staleTrigger: 'dependency-change',
        periodMonths: 3,
      },
      { ref: 'COMPAT-2', requirement: 'Weak copyleft (LGPL/MPL) obligations satisfied for the linking model used', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'COMPAT-3', requirement: 'Licence expressions with AND/OR resolved to a chosen term', theme: 'governance', accepts: RECORDED },
      { ref: 'NOTICE-1', requirement: 'Attribution and NOTICE requirements satisfied in the shipped artifact', theme: 'technological', accepts: RECORDED, staleTrigger: 'release' },
      { ref: 'NOTICE-2', requirement: 'Source-offer obligations met where triggered', theme: 'governance', accepts: DOCUMENTED },
      {
        ref: 'LEGAL-1',
        requirement: 'Counsel has reviewed the distribution model against the licence set',
        theme: 'governance',
        accepts: EXTERNAL,
        acceptsReason: 'Licence compatibility is a legal conclusion. An engineer reading the licence texts is doing something useful and is not doing this.',
        periodMonths: 24,
      },
    ],
  },

  'secure-build-pipeline': {
    policyId: 'secure-build-pipeline',
    regime: 'Build integrity (SLSA)',
    scoping: 'The target SLSA level and which artifacts it applies to. The levels are cumulative, so state the target before assessing anything.',
    variants: ['L1', 'L2', 'L3'],
    defaultPeriodMonths: 12,
    controls: [
      { ref: 'SLSA-1', requirement: 'Target SLSA level stated for each released artifact', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'SLSA-2', requirement: 'Builds run on hosted, ephemeral infrastructure', theme: 'technological', accepts: ENFORCED, acceptsReason: 'Readable from the pipeline definition.' },
      { ref: 'SLSA-3', requirement: 'Provenance generated for every released artifact', theme: 'technological', accepts: PRODUCED, staleTrigger: 'release' },
      { ref: 'SLSA-4', requirement: 'Provenance signed and verifiable by a consumer', theme: 'technological', accepts: PRODUCED, staleTrigger: 'release', acceptsReason: 'Provenance a consumer cannot verify is a file, not a guarantee.' },
      { ref: 'SLSA-5', requirement: 'Build inputs pinned; the build is hermetic or reproducible', theme: 'technological', accepts: DOCUMENTED },
      { ref: 'SLSA-6', requirement: 'Signing keys held where a build step cannot read them', theme: 'technological', accepts: DOCUMENTED },
      {
        ref: 'SLSA-7',
        requirement: 'An independent party has verified the provenance chain',
        theme: 'governance',
        accepts: EXTERNAL,
        acceptsReason: 'A build attesting to its own integrity is the circularity the provenance chain exists to break.',
        periodMonths: 24,
      },
    ],
  },

  'ai-safety-compliance': {
    policyId: 'ai-safety-compliance',
    regime: 'AI safety commitments (EU AI Act / NIST AI RMF alignment)',
    scoping: 'Whether this system is in scope as high-risk or general-purpose under the EU AI Act, and which public safety claims the product makes. The obligations phase in on stated dates, so record which apply now and which are ahead.',
    variants: ['High-risk', 'General-purpose', 'Limited risk', 'Out of scope'],
    defaultPeriodMonths: 12,
    controls: [
      { ref: 'GOV-1', requirement: 'AI system role classified (provider / deployer) and risk tier stated', theme: 'governance', accepts: DOCUMENTED },
      {
        ref: 'GOV-2',
        requirement: 'Model or system card published and current',
        theme: 'governance',
        accepts: PRODUCED,
        acceptsReason: 'Whether the card exists is answerable from the repository. Whether it is honest is not, which is why it is paired with an artifact rather than standing alone.',
      },
      { ref: 'GOV-3', requirement: 'Human oversight mechanism defined for consequential outputs', theme: 'governance', accepts: DOCUMENTED },
      {
        ref: 'GOV-4',
        requirement: 'Declared guardrails have a corresponding enforcement test',
        theme: 'technological',
        accepts: PRODUCED,
        acceptsReason: 'A guardrail without a test is a comment, and whether the test exists is readable from the tree.',
      },
      { ref: 'GOV-5', requirement: 'Red-team evidence retained with dates and scope', theme: 'governance', accepts: RECORDED },
      { ref: 'GOV-6', requirement: 'Incident reporting route defined for AI-specific failures', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'GOV-7', requirement: 'Training-data provenance and permitted use recorded', theme: 'governance', accepts: RECORDED },
      {
        ref: 'GOV-8',
        requirement: 'Third-party evaluation or red-team of the deployed system',
        theme: 'governance',
        accepts: EXTERNAL,
        acceptsReason: 'A team red-teaming its own model finds what it thought to look for. The obligation in the high-risk tier is explicitly for an outside assessment.',
        periodMonths: 12,
      },
    ],
  },

  'model-output-risk': {
    policyId: 'model-output-risk',
    regime: 'Model-output risk classification',
    scoping: 'The risk classes this product distinguishes, and what handling each one triggers — review, disclaimer, refusal, or logging.',
    defaultPeriodMonths: 12,
    noIndependentControl: 'An outside evaluation of the deployed system is asked for once, under ai-safety-compliance GOV-8. Asking for it twice would double-count one engagement.',
    controls: [
      { ref: 'RISK-1', requirement: 'Risk classes defined with examples of each', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'RISK-2', requirement: 'Labelled evaluation set exists and is version-controlled', theme: 'technological', accepts: RECORDED },
      {
        ref: 'RISK-3',
        requirement: 'Recall measured on the rare high-risk class, not overall accuracy alone',
        theme: 'technological',
        accepts: PRODUCED,
        periodMonths: 6,
        acceptsReason: 'A classifier calling everything low-risk scores 95% on a corpus that is 95% low-risk and catches nothing, so the measured number has to be recall on the rare class.',
      },
      { ref: 'RISK-4', requirement: 'Each class maps to a defined handling path', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'RISK-5', requirement: 'Escalation to human review is tested end to end', theme: 'technological', accepts: PRODUCED },
      { ref: 'RISK-6', requirement: 'Threshold changes require re-evaluation against the labelled set', theme: 'governance', accepts: DOCUMENTED },
    ],
  },

  'bias-fairness': {
    policyId: 'bias-fairness',
    regime: 'Fairness assessment',
    scoping: 'Which decisions affect people, which groups are compared, and the fairness metric chosen — with the reason it was chosen over the alternatives. The available definitions are mathematically incompatible, so the choice is a stated value judgement rather than a technical default.',
    defaultPeriodMonths: 12,
    controls: [
      { ref: 'FAIR-1', requirement: 'Affected decisions and the groups compared are identified', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'FAIR-2', requirement: 'Fairness metric chosen and the choice justified against the alternatives', theme: 'governance', accepts: RECORDED, acceptsReason: 'Demographic parity and equalised odds cannot both hold, so an unjustified metric is a decision nobody made.' },
      { ref: 'FAIR-3', requirement: 'Labelled evaluation set exists, version-controlled and representative', theme: 'technological', accepts: RECORDED },
      { ref: 'FAIR-4', requirement: 'Disparity measured per group and recorded with dates', theme: 'technological', accepts: PRODUCED, periodMonths: 6, acceptsReason: 'Disparity is invisible in the aggregate accuracy everyone reports, so the evidence has to be the per-group breakdown.' },
      { ref: 'FAIR-5', requirement: 'An unacceptable-disparity threshold is declared in advance', theme: 'governance', accepts: DOCUMENTED, acceptsReason: 'A threshold chosen after seeing the result is not a threshold.' },
      { ref: 'FAIR-7', requirement: 'Counterfactual or perturbation testing performed', theme: 'technological', accepts: PRODUCED },
      {
        ref: 'FAIR-6',
        requirement: 'Fairness assessment reviewed by somebody outside the building team',
        theme: 'governance',
        accepts: EXTERNAL,
        acceptsReason: 'The team that chose the metric is the team least able to notice the metric was the wrong one.',
        periodMonths: 24,
      },
    ],
  },

  explainability: {
    policyId: 'explainability',
    regime: 'Explainability and transparency',
    scoping: 'Which decisions a person is entitled to an explanation for, and what an adequate explanation contains. GDPR Art. 22 and the EU AI Act both ask for a meaningful explanation without defining the word, so the definition has to be yours and written down.',
    defaultPeriodMonths: 12,
    noIndependentControl: 'Explainability is examined by a regulator against the decision itself rather than certified in advance. FAIR-6 covers the outside review of the model behind it.',
    controls: [
      { ref: 'EXP-1', requirement: 'Decisions requiring an explanation are identified', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'EXP-2', requirement: 'An explanation is produced and retained alongside each such decision', theme: 'technological', accepts: PRODUCED },
      {
        ref: 'EXP-3',
        requirement: 'The explanation is faithful to the mechanism rather than a plausible narration',
        theme: 'technological',
        accepts: RECORDED,
        acceptsReason: 'A plausible explanation that does not match the real reasoning is worse than none, because it will be believed. Faithfulness has to be measured, and the measurement is the evidence.',
      },
      { ref: 'EXP-4', requirement: 'The explanation is intelligible to the affected person, tested with a non-specialist', theme: 'governance', accepts: RECORDED },
      { ref: 'EXP-5', requirement: 'A route to contest a decision is documented and reachable', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'EXP-6', requirement: 'Explanation quality reviewed on a stated cadence', theme: 'governance', accepts: DOCUMENTED },
    ],
  },

  'ai-data-policy': {
    policyId: 'ai-data-policy',
    regime: 'AI memory and data-use policy',
    scoping: 'What the product promises about customer data — training use, retention, and separation between customers — and which provider settings back each promise.',
    defaultPeriodMonths: 12,
    controls: [
      { ref: 'AID-1', requirement: 'Training-use commitment stated and matched by provider configuration', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'AID-2', requirement: 'Provider zero or limited-retention setting verified where promised', theme: 'technological', accepts: RECORDED },
      {
        ref: 'AID-3',
        requirement: 'Every path reaching a model applies the redaction boundary',
        theme: 'technological',
        accepts: PRODUCED,
        acceptsReason: 'The boundary is asserted at the dispatch point, so a test at that point is the artifact.',
      },
      { ref: 'AID-4', requirement: 'Retrieval is filtered by tenant on every query path', theme: 'technological', accepts: PRODUCED },
      {
        ref: 'AID-5',
        requirement: 'Secrets cannot reach a prompt, asserted at the dispatch boundary',
        theme: 'technological',
        accepts: PRODUCED,
        acceptsReason: 'Asserting it anywhere but the dispatch boundary tests a path rather than the property.',
      },
      { ref: 'AID-6', requirement: 'Stored memory has a retention window and a deletion route', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'AID-7', requirement: 'Sub-processor list current and disclosed', theme: 'governance', accepts: RECORDED },
      {
        ref: 'AID-8',
        requirement: 'Provider data-processing terms obtained and on record for every model vendor',
        theme: 'governance',
        accepts: EXTERNAL,
        acceptsReason: 'What a provider does with the text you send is the provider’s statement, not yours. Every enabled provider is a sub-processor, and a promise about training use that rests on nothing but your own reading of their marketing page is not evidence.',
        periodMonths: 24,
      },
    ],
  },

  'financial-compliance': {
    policyId: 'financial-compliance',
    regime: 'Financial services (FFIEC / MiFID II / DORA)',
    scoping: 'Jurisdiction, licence type, and which regimes actually bind this system. A generic financial mapping tests nothing precisely.',
    defaultPeriodMonths: 12,
    controls: [
      { ref: 'REC-1', requirement: 'Transaction records complete, immutable and retained for the required period', theme: 'technological', accepts: RECORDED },
      { ref: 'REC-2', requirement: 'Communications retained where the regime requires it', theme: 'governance', accepts: DOCUMENTED },
      { ref: 'RPT-1', requirement: 'Regulatory reporting reconciles against source records', theme: 'technological', accepts: RECORDED },
      { ref: 'CLK-1', requirement: 'Clock synchronisation meets the prescribed tolerance (MiFID II RTS 25)', theme: 'technological', accepts: RECORDED },
      { ref: 'RES-1', requirement: 'Operational resilience testing performed (DORA where applicable)', theme: 'technological', accepts: RECORDED },
      { ref: 'RES-2', requirement: 'Critical third-party dependencies registered', theme: 'governance', accepts: RECORDED },
      { ref: 'CHG-1', requirement: 'Change control evidences segregation of duties', theme: 'governance', accepts: DOCUMENTED },
      {
        ref: 'AUDIT-1',
        requirement: 'External audit or regulatory examination covering these records',
        theme: 'governance',
        accepts: EXTERNAL,
        acceptsReason: 'These regimes are supervised. The examination is performed by somebody outside the firm, and a firm’s own view of its records is not the finding.',
        periodMonths: 12,
      },
    ],
  },

  'medical-compliance': {
    policyId: 'medical-compliance',
    regime: 'Medical software (FDA 21 CFR Part 11 / IEC 62304)',
    scoping: 'Whether records are submitted to a regulator, the device software safety class (A/B/C), and the validation lifecycle in use.',
    variants: ['Class A', 'Class B', 'Class C'],
    defaultPeriodMonths: 12,
    controls: [
      { ref: '11.10(a)', requirement: 'System validated for accuracy, reliability and consistent intended performance', theme: 'technological', accepts: RECORDED },
      { ref: '11.10(b)', requirement: 'Records can be generated in accurate and complete copies', theme: 'technological', accepts: RECORDED },
      { ref: '11.10(c)', requirement: 'Records protected for the retention period', theme: 'technological', accepts: DOCUMENTED },
      { ref: '11.10(d)', requirement: 'System access limited to authorised individuals', theme: 'technological', accepts: DOCUMENTED },
      { ref: '11.10(e)', requirement: 'Secure, computer-generated, time-stamped audit trail', theme: 'technological', accepts: RECORDED },
      { ref: '11.50', requirement: 'Signature manifestations contain name, date and time, and meaning', theme: 'technological', accepts: RECORDED },
      { ref: '11.70', requirement: 'Signatures linked to their records so they cannot be transferred', theme: 'technological', accepts: RECORDED },
      { ref: '62304-5.5', requirement: 'Software unit verification per safety class', theme: 'technological', accepts: PRODUCED },
      { ref: '62304-5.7', requirement: 'Software system testing with documented results', theme: 'technological', accepts: PRODUCED },
      {
        ref: 'NB-1',
        requirement: 'Notified-body audit or regulatory clearance covering this software',
        theme: 'governance',
        accepts: EXTERNAL,
        acceptsReason: 'Market access here is granted by a regulator or a notified body. Internal validation is a prerequisite for that conversation, not a substitute for it.',
        periodMonths: 36,
      },
    ],
  },

  'automotive-compliance': {
    policyId: 'automotive-compliance',
    regime: 'Automotive functional safety (ISO 26262)',
    scoping: 'The ASIL assigned by hazard analysis and risk assessment (HARA). The level determines which verification methods are required — it is not a choice.',
    variants: ['ASIL A', 'ASIL B', 'ASIL C', 'ASIL D'],
    defaultPeriodMonths: 12,
    controls: [
      // The profile these were lifted from gave four separate controls the same
      // ref, `Part 6-9`. A register keyed on the ref cannot hold four rows under
      // one identity, and an assessor reading four identical references cannot
      // tell which one an evidence record belongs to, so each now carries the
      // clause it actually refers to.
      { ref: 'Part 6-9.4.2', requirement: 'Requirements-based testing at software unit level', theme: 'technological', accepts: PRODUCED },
      { ref: 'Part 6-9.4.5(a)', requirement: 'Statement coverage evidence (ASIL A and above)', theme: 'technological', accepts: PRODUCED },
      { ref: 'Part 6-9.4.5(b)', requirement: 'Branch coverage evidence (ASIL B and above)', theme: 'technological', accepts: PRODUCED },
      { ref: 'Part 6-9.4.5(c)', requirement: 'MC/DC coverage evidence (ASIL D)', theme: 'technological', accepts: PRODUCED },
      { ref: 'Part 6-10', requirement: 'Software integration and interface testing', theme: 'technological', accepts: PRODUCED },
      { ref: 'Part 6-5', requirement: 'Coding guidelines enforced (for example MISRA C) with deviations recorded', theme: 'technological', accepts: ENFORCED },
      { ref: 'Part 8-11', requirement: 'Tool confidence level assessed and tools qualified where required', theme: 'technological', accepts: RECORDED },
      { ref: 'Part 8-6', requirement: 'Bidirectional requirements traceability maintained', theme: 'technological', accepts: RECORDED },
      {
        ref: 'FSA-1',
        requirement: 'Functional safety assessment carried out with the independence the ASIL requires',
        theme: 'governance',
        accepts: EXTERNAL,
        acceptsReason: 'ISO 26262 sets the required degree of independence by ASIL, and at ASIL C and D it is independence from the development team. The standard names this as the control; it is not an optional extra.',
        periodMonths: 36,
      },
    ],
  },

  'aviation-compliance': {
    policyId: 'aviation-compliance',
    regime: 'Airborne software (DO-178C)',
    scoping: 'The Design Assurance Level (A–E) from the system safety assessment, and which supplements apply (DO-330 tools, DO-331 model-based, DO-333 formal methods).',
    variants: ['DAL A', 'DAL B', 'DAL C', 'DAL D', 'DAL E'],
    defaultPeriodMonths: 12,
    controls: [
      { ref: 'A-4', requirement: 'Low-level requirements comply with high-level requirements', theme: 'technological', accepts: RECORDED },
      { ref: 'A-5', requirement: 'Source code complies with and is traceable to low-level requirements', theme: 'technological', accepts: RECORDED },
      { ref: 'A-6', requirement: 'Executable object code complies with requirements (requirements-based testing)', theme: 'technological', accepts: PRODUCED },
      { ref: 'A-7.5', requirement: 'Statement coverage achieved (DAL C and above)', theme: 'technological', accepts: PRODUCED },
      { ref: 'A-7.6', requirement: 'Decision coverage achieved (DAL B and above)', theme: 'technological', accepts: PRODUCED },
      { ref: 'A-7.7', requirement: 'MC/DC achieved (DAL A)', theme: 'technological', accepts: PRODUCED },
      { ref: 'A-7.8', requirement: 'Data and control coupling analysed', theme: 'technological', accepts: RECORDED },
      { ref: 'DO-330', requirement: 'Verification tools qualified where used to eliminate an objective', theme: 'technological', accepts: RECORDED },
      {
        ref: 'Independence',
        requirement: 'Verification independence satisfied for the assigned DAL',
        theme: 'governance',
        accepts: EXTERNAL,
        acceptsReason: 'DO-178C marks specific objectives as requiring independence, which means the verifier is not the developer. That is the objective; asserting it about yourself does not meet it.',
        periodMonths: 36,
      },
      {
        ref: 'SOI-4',
        requirement: 'Stage-of-involvement audits completed with the certification authority',
        theme: 'governance',
        accepts: EXTERNAL,
        acceptsReason: 'The certification authority or its designee performs these. There is no internal equivalent.',
        periodMonths: 36,
      },
    ],
  },

  'energy-compliance': {
    policyId: 'energy-compliance',
    regime: 'Bulk electric system (NERC CIP)',
    scoping: 'The impact rating of the BES cyber systems in scope (Low / Medium / High). Requirements and deadlines differ by rating.',
    variants: ['Low impact', 'Medium impact', 'High impact'],
    defaultPeriodMonths: 12,
    controls: [
      { ref: 'CIP-002', requirement: 'BES cyber asset inventory identified and categorised', theme: 'governance', accepts: RECORDED },
      { ref: 'CIP-005', requirement: 'Electronic security perimeter defined and access points controlled', theme: 'technological', accepts: DOCUMENTED },
      { ref: 'CIP-007 R2', requirement: 'Security patches evaluated within 35 days of availability', theme: 'technological', accepts: RECORDED, periodMonths: 2, acceptsReason: 'The standard states the window in days, so evidence older than a couple of months cannot show the window was met.' },
      { ref: 'CIP-007 R4', requirement: 'Security event monitoring in place', theme: 'technological', accepts: DOCUMENTED },
      { ref: 'CIP-004 R5', requirement: 'Access revoked within the required window on termination', theme: 'governance', accepts: RECORDED },
      { ref: 'CIP-010 R1', requirement: 'Baseline configurations documented and changes authorised', theme: 'technological', accepts: RECORDED },
      { ref: 'CIP-010 R2', requirement: 'Configuration monitoring detects unauthorised change', theme: 'technological', accepts: DOCUMENTED },
      { ref: 'CIP-013', requirement: 'Supply chain risk management plan applied to vendors', theme: 'governance', accepts: DOCUMENTED },
      {
        ref: 'CIP-Audit',
        requirement: 'Regional Entity compliance audit completed within the audit cycle',
        theme: 'governance',
        accepts: EXTERNAL,
        acceptsReason: 'NERC CIP is enforced by audit, with penalties. The Regional Entity performs it.',
        periodMonths: 36,
      },
    ],
  },
};

// ── Lookups ──────────────────────────────────────────────────────────────

const COMPLIANCE_REGIME_IDS = Object.keys(COMPLIANCE_CONTROL_CATALOG) as ComplianceMethodologyId[];

/** Every governance regime, in catalog declaration order. */
export function complianceRegimeIds(): readonly ComplianceMethodologyId[] {
  return COMPLIANCE_REGIME_IDS;
}

export function isComplianceRegime(id: TestingMethodologyId): id is ComplianceMethodologyId {
  return Object.prototype.hasOwnProperty.call(COMPLIANCE_CONTROL_CATALOG, id);
}

export function complianceCatalogFor(id: TestingMethodologyId): ComplianceRegimeCatalog | undefined {
  return isComplianceRegime(id) ? COMPLIANCE_CONTROL_CATALOG[id] : undefined;
}

export function complianceControl(
  catalog: ComplianceRegimeCatalog,
  ref: string,
): ComplianceControl | undefined {
  return catalog.controls.find(control => control.ref === ref);
}

/**
 * The evidence kinds this control accepts, after applying the recorded scope
 * variant.
 *
 * An unrecognised variant falls back to the base set rather than to an empty
 * one: a project that typed its own scope label must not find every control
 * unsatisfiable for a reason that looks like policy.
 */
export function effectiveAccepts(
  control: ComplianceControl,
  variant?: string,
): readonly EvidenceKind[] {
  const override = variant ? control.variants?.[variant]?.accepts : undefined;
  return override ?? control.accepts;
}

export function effectivePeriodMonths(
  catalog: ComplianceRegimeCatalog,
  control: ComplianceControl,
  variant?: string,
): number {
  const override = variant ? control.variants?.[variant]?.periodMonths : undefined;
  return override ?? control.periodMonths ?? catalog.defaultPeriodMonths;
}

export function effectiveContinuityMonths(
  control: ComplianceControl,
  variant?: string,
): number | undefined {
  const override = variant ? control.variants?.[variant]?.continuityMonths : undefined;
  return override ?? control.continuityMonths;
}

/**
 * True when nothing this project produces about itself can close the control.
 *
 * This is the single question the whole catalog exists to answer, so it is a
 * named function rather than an `includes` call spelled out at each call site.
 */
export function requiresIndependence(control: ComplianceControl, variant?: string): boolean {
  const accepts = effectiveAccepts(control, variant);
  return accepts.length > 0 && accepts.every(kind => kind === 'independent');
}

/** Controls an outside party must sign, for the "what is still outstanding" list. */
export function independentControls(
  catalog: ComplianceRegimeCatalog,
  variant?: string,
): readonly ComplianceControl[] {
  return catalog.controls.filter(control => requiresIndependence(control, variant));
}

/** How many controls this regime declares, for stating the unchecked remainder. */
export function declaredControlCount(id: TestingMethodologyId): number {
  return complianceCatalogFor(id)?.controls.length ?? 0;
}
