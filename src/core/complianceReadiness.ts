import {
  COMPLIANCE_THEME_LABEL,
  EVIDENCE_KIND_LABEL,
  effectiveAccepts,
  effectiveContinuityMonths,
  effectivePeriodMonths,
  requiresIndependence,
  type ComplianceControl,
  type ComplianceMethodologyId,
  type ComplianceRegimeCatalog,
  type ComplianceTheme,
  type EvidenceKind,
} from './complianceControlCatalog.js';
import { describeStandardTracking, isStandardStale, standardTrackingFor, type StandardTracking } from './testingStandards.js';
import {
  isEvidenceLive,
  isVerifiableLocator,
  type ComplianceEvidence,
  type ComplianceEvidenceLibrary,
  type ComplianceRegimeRegister,
} from './complianceEvidenceRegister.js';

/**
 * How far along a governance regime actually is, and what the weakest thing in
 * it is.
 *
 * ── Nothing here ever means compliant ────────────────────────────────────
 *
 * The board this replaces rendered a green **Tested** tag on twenty-four
 * regimes, and the tag was reachable from a filename. The fix is not a stricter
 * threshold for the same word — it is that no reading this module can produce
 * says a project complies with anything. AtlasMind records what evidence exists
 * and who said so, and grades that against a declared catalog. Only a
 * certification body, an auditor, a regulator or counsel can say the other
 * thing. {@link COMPLIANCE_DISCLAIMER} travels on every reading and is written
 * into every mirror, and a test asserts no label, rule or statement in this
 * module contains "compliant", "certified", "verified", "passed", "approved",
 * "covered" or "tested".
 *
 * ── Graded by the weakest applicable control ─────────────────────────────
 *
 * Every regime rule below fires on *at least one* control in a state, so
 * twenty-four unassessed controls can never hide behind one satisfied one. That
 * is the specific arithmetic the old board got wrong: it promoted a whole
 * regime when `results.some(r => r.state === 'satisfied')`.
 *
 * ── `awaiting-independent` ───────────────────────────────────────────────
 *
 * The reading that took the most thought. A control only an outside party can
 * close, recorded as done on this project's own word, could be graded two ways
 * and both are wrong. Grading it `satisfied-self` lets a regime made *entirely*
 * of independence-requiring controls — PCI at Level 1, aviation, energy — show
 * **Self-attested** with no outside evidence at all, which is the original
 * defect one notch down the ladder. Grading it a flat `gap` makes
 * `self-attested` unreachable for almost every regime, leaving a project that
 * has genuinely done all of its own work on the same amber as one that has done
 * none.
 *
 * So it is its own reading: not satisfied, unable to lift a regime to assured,
 * and able to produce the sentence that is actually true — *every control that
 * can rest on our own word does; N still need an outside party*.
 *
 * ── Recording a failure is free; claiming success is not ─────────────────
 *
 * `control-declared-gap` sits **above** the attribution rules deliberately. A
 * project honestly writing down that a control is not met should not have that
 * downgraded to "not assessed" for want of a signature — the honest direction
 * costs nothing and should not be taxed. Only satisfaction requires attributed,
 * unexpired, class-appropriate evidence.
 *
 * Pure and clock-injected: `now` is a required field on the input, never
 * ambient, so the whole module is pinnable at any date.
 */

export const COMPLIANCE_DISCLAIMER =
  'AtlasMind records what evidence exists and who said so, and grades it against a declared '
  + 'catalog. It does not and cannot determine compliance with any regime — only the relevant '
  + 'certification body, auditor, regulator or counsel can do that.';

// ── Readings ─────────────────────────────────────────────────────────────

export type ComplianceControlReading =
  | 'not-assessed'
  | 'not-applicable'
  | 'gap'
  | 'partial'
  | 'expired'
  | 'awaiting-independent'
  | 'satisfied-self'
  | 'satisfied-independent';

export const CONTROL_READING_LABEL: Readonly<Record<ComplianceControlReading, string>> = {
  'not-assessed': 'Not assessed',
  'not-applicable': 'Not applicable',
  gap: 'Not met',
  partial: 'Partly met',
  expired: 'Evidence lapsed',
  'awaiting-independent': 'Awaiting an outside party',
  'satisfied-self': 'Met on our own evidence',
  'satisfied-independent': 'Met, confirmed outside',
};

export type ComplianceReadiness =
  | 'unexamined'
  | 'scoped'
  | 'in-progress'
  | 'self-attested'
  | 'independently-assured';

/**
 * Deliberately none of these is a verdict, and none renders `good`.
 *
 * `independently-assured` is the strongest reading available and it still only
 * says every control has evidence of the kind it asks for.
 */
export const READINESS_LABEL: Readonly<Record<ComplianceReadiness, string>> = {
  unexamined: 'Not examined',
  scoped: 'Scope decided',
  'in-progress': 'Assessment in progress',
  'self-attested': 'Self-attested',
  'independently-assured': 'Independently assured',
};

/** Tone for the renderer. Never `good` — see the module header. */
export const READINESS_TONE: Readonly<Record<ComplianceReadiness, 'muted' | 'warn' | 'critical' | 'accent'>> = {
  unexamined: 'critical',
  scoped: 'warn',
  'in-progress': 'warn',
  'self-attested': 'muted',
  'independently-assured': 'accent',
};

// ── Rule tables ──────────────────────────────────────────────────────────

export interface ComplianceRule {
  readonly id: string;
  readonly describes: string;
}

/**
 * Ordered; first match wins. The order *is* the policy.
 *
 * `control-declared-gap` above the attribution rules is the one placement worth
 * arguing about, and the module header states why.
 */
export const CONTROL_RULES: readonly ComplianceRule[] = [
  { id: 'control-excluded-unjustified', describes: 'Marked not applicable with no written justification, or with no named decider and date. An unexplained exclusion is the first thing an assessor challenges, so it is graded as never having been looked at.' },
  { id: 'control-excluded', describes: 'Excluded from scope with a written justification. Removed from the denominator rather than counted as met.' },
  { id: 'control-declared-gap', describes: 'Recorded as not met. Taken at face value with no evidence required — writing down a failure costs nothing and is the honest direction.' },
  { id: 'control-declared-partial', describes: 'Recorded as partly met, or still in progress.' },
  { id: 'control-unassessed', describes: 'Nobody has recorded anything. Unassessed is not a pass.' },
  { id: 'control-claim-unattributed', describes: 'Recorded as met, but no evidence names both a person and a date. A status somebody typed is a claim, not evidence.' },
  { id: 'control-evidence-expired', describes: 'Every qualifying record is past its validity date, or past the period this control allows. Lapsed is neither a gap nor a pass — it is a claim that has run out.' },
  { id: 'control-evidence-class-insufficient', describes: 'The evidence on record is not of a kind this control accepts. A person’s word does not produce a bill of materials.' },
  { id: 'control-evidence-unverifiable', describes: 'The only evidence is a note saying where a document is held. That is worth recording and is not the document.' },
  { id: 'control-awaiting-independent', describes: 'This control can only be closed by a party outside the project. It is recorded as met on the project’s own word, which is worth having and is not what the control asks for.' },
  { id: 'control-continuity-short', describes: 'The evidence is current but does not yet span the period this scope requires. A control satisfied today with no history behind it does not pass a Type II.' },
  { id: 'control-satisfied-independent', describes: 'An unexpired record from a named outside party satisfies it.' },
  { id: 'control-satisfied-self', describes: 'An unexpired, attributed record of a kind this control accepts satisfies it.' },
];

export const REGIME_RULES: readonly ComplianceRule[] = [
  { id: 'regime-no-catalog', describes: 'No control catalog is declared for this regime, so there is nothing to assess against.' },
  { id: 'regime-unscoped', describes: 'No scope decision is recorded. Until scope is decided the mapping states nothing — it is a list of controls nobody has claimed apply.' },
  { id: 'regime-nothing-assessed', describes: 'Scope is recorded and no control has been assessed. Nothing here is a pass.' },
  { id: 'regime-evidence-expired', describes: 'Evidence this regime rests on is past its validity date.' },
  { id: 'regime-control-gap', describes: 'At least one applicable control is recorded as not met, or rests on evidence of a kind it does not accept.' },
  { id: 'regime-control-unassessed', describes: 'At least one applicable control has never been assessed. Unassessed is not a pass.' },
  { id: 'regime-control-partial', describes: 'At least one applicable control is partly met, or its evidence does not yet span the period this scope requires.' },
  { id: 'regime-awaiting-independent', describes: 'Every control that may rest on this project’s own word does. The controls requiring an outside party have not been signed off by one.' },
  { id: 'regime-self-attested', describes: 'Every applicable control is met on evidence this project produced itself. No outside party has confirmed any of it.' },
  { id: 'regime-independently-assured', describes: 'Every applicable control is met, and every control requiring an outside party has unexpired evidence from one. This is the strongest reading AtlasMind can produce. It is not a statement of compliance.' },
];

const CONTROL_RULE_BY_ID = new Map(CONTROL_RULES.map(rule => [rule.id, rule]));
const REGIME_RULE_BY_ID = new Map(REGIME_RULES.map(rule => [rule.id, rule]));

// ── Output ───────────────────────────────────────────────────────────────

/** A machine check that ran against a control but is not evidence for it. */
export interface CorroboratingCheck {
  readonly ruleId: string;
  readonly question: string;
  readonly evidence: string;
}

export interface ControlGrade {
  readonly ref: string;
  readonly requirement: string;
  readonly theme: ComplianceTheme;
  readonly themeLabel: string;
  readonly reading: ComplianceControlReading;
  readonly readingLabel: string;
  readonly ruleId: string;
  readonly rule: string;
  readonly statement: string;
  readonly accepts: readonly EvidenceKind[];
  readonly acceptsLabel: string;
  readonly acceptsReason?: string;
  readonly requiresIndependence: boolean;
  readonly periodMonths: number;
  readonly countedEvidenceIds: readonly string[];
  readonly currentUntil?: string;
  readonly daysUntilExpiry?: number;
  readonly ownerContactId?: string;
  /**
   * Checks that ran against this reference but that the catalog does not accept
   * as sufficient for it. Shown as a signal, never counted as evidence — a
   * machine check covers a fragment of a control, not the whole of it.
   */
  readonly corroborating: readonly CorroboratingCheck[];
}

export interface ComplianceReading {
  readonly policyId: ComplianceMethodologyId;
  readonly regime: string;
  readonly readiness: ComplianceReadiness;
  readonly readinessLabel: string;
  readonly tone: 'muted' | 'warn' | 'critical' | 'accent';
  readonly ruleId: string;
  readonly rule: string;
  readonly statement: string;
  readonly scopeDecided: boolean;
  readonly scopeVariant?: string;
  readonly controls: readonly ControlGrade[];
  readonly counts: Readonly<Record<ComplianceControlReading, number>>;
  readonly declaredCount: number;
  readonly applicableCount: number;
  /** The single control that produced the readiness. */
  readonly weakest?: { readonly ref: string; readonly reading: ComplianceControlReading; readonly ruleId: string };
  readonly nextExpiry?: { readonly ref: string; readonly on: string; readonly inDays: number };
  /** Facts worth stating that never change the reading. */
  readonly notes: readonly string[];
  /** Which edition of the standard this control set models, and when it was checked. */
  readonly standard?: StandardTracking;
  readonly standardDetail: string;
  /** True when the verification is old, or a newer edition is known to exist. */
  readonly standardStale: boolean;
  /**
   * Set when the register was assessed against a different edition from the one
   * the catalog now models. Reported rather than re-pointed: an assessment made
   * against ISO/IEC 27001:2013 is about a different document, and quietly
   * carrying its statuses onto the 2022 control set would be the worst kind of
   * silent promotion.
   */
  readonly editionDrift?: { readonly assessedAgainst: string; readonly modelled: string };
  readonly disclaimer: string;
  readonly rules: {
    readonly control: readonly ComplianceRule[];
    readonly regime: readonly ComplianceRule[];
  };
}

/** A satisfied stack check, offered as evidence for one control reference. */
export interface TechnicalCheckInput {
  readonly controlRef: string;
  readonly state: 'satisfied' | 'gap' | 'not-applicable' | 'unknown';
  readonly rule: string;
  readonly question: string;
  readonly evidence?: string;
}

export interface ComplianceGradeInput {
  readonly catalog: ComplianceRegimeCatalog;
  readonly register?: ComplianceRegimeRegister;
  readonly library?: ComplianceEvidenceLibrary;
  /** Live results from `complianceTechnicalControls`. Evidence, never status. */
  readonly technical?: readonly TechnicalCheckInput[];
  readonly now: Date;
}

// ── Grading ──────────────────────────────────────────────────────────────

function ruleText(map: Map<string, ComplianceRule>, id: string): string {
  return map.get(id)?.describes ?? id;
}

function acceptsLabel(accepts: readonly EvidenceKind[]): string {
  return accepts.map(kind => EVIDENCE_KIND_LABEL[kind]).join(' or ');
}

interface ControlVerdict {
  readonly reading: ComplianceControlReading;
  readonly ruleId: string;
  readonly statement: string;
  readonly counted: readonly ComplianceEvidence[];
}

function gradeControl(input: {
  control: ComplianceControl;
  catalog: ComplianceRegimeCatalog;
  register?: ComplianceRegimeRegister;
  attached: readonly ComplianceEvidence[];
  synthetic: readonly ComplianceEvidence[];
  now: Date;
}): ControlVerdict {
  const { control, catalog, register, now } = input;
  const variant = register?.scope.variant;
  const accepts = effectiveAccepts(control, variant);
  const period = effectivePeriodMonths(catalog, control, variant);
  const continuity = effectiveContinuityMonths(control, variant);
  const record = register?.controls.find(entry => entry.ref === control.ref);
  const status = record?.status ?? 'not-assessed';

  // 1 / 2 — exclusion. The register's sanitizer already refuses an unjustified
  // one, but the rule is stated here too so the grade names it rather than
  // silently reading `not-assessed` for a reason nobody can see.
  if (status === 'not-applicable') {
    if (!record?.justification) {
      return {
        reading: 'not-assessed',
        ruleId: 'control-excluded-unjustified',
        statement: 'Excluded from scope with no written justification, so it is graded as never having been looked at.',
        counted: [],
      };
    }
    return {
      reading: 'not-applicable',
      ruleId: 'control-excluded',
      statement: `Excluded from scope: ${record.justification}`,
      counted: [],
    };
  }

  // 3 — a declared failure is taken at face value.
  if (status === 'gap') {
    return {
      reading: 'gap',
      ruleId: 'control-declared-gap',
      statement: 'Recorded as not met.',
      counted: [],
    };
  }

  // 4 — partly met, or still being worked.
  if (status === 'partial' || status === 'in-progress') {
    return {
      reading: 'partial',
      ruleId: 'control-declared-partial',
      statement: status === 'in-progress' ? 'Recorded as in progress.' : 'Recorded as partly met.',
      counted: [],
    };
  }

  // 5 — nothing on record.
  if (status !== 'satisfied') {
    return {
      reading: 'not-assessed',
      ruleId: 'control-unassessed',
      statement: 'Nobody has recorded a decision about this control.',
      counted: [],
    };
  }

  // From here the register claims the control is met, and every remaining rule
  // is about whether anything actually supports that.
  const usable = [...input.attached, ...input.synthetic]
    .filter(evidence => accepts.includes(evidence.kind));

  // 6 — a status with nothing behind it.
  if (input.attached.length === 0 && input.synthetic.length === 0) {
    return {
      reading: 'not-assessed',
      ruleId: 'control-claim-unattributed',
      statement: 'Recorded as met with no evidence attached, so there is nothing to read but the claim itself.',
      counted: [],
    };
  }

  const live = usable.filter(evidence => isEvidenceLive(evidence, period, now));
  const needsIndependence = requiresIndependence(control, variant);
  const independentLive = live.filter(evidence => evidence.kind === 'independent');

  // 7 — a control only an outside party can close, checked *before* the class
  // rule below. Both would fire on an attestation attached to an
  // independence-only control, and they say different things: "we need someone
  // else to say this" is specific and actionable, where "the evidence is the
  // wrong kind" is technically true and tells nobody what to do next. The more
  // useful sentence has to win, so it is asked first.
  if (needsIndependence) {
    const independentUsable = usable.filter(evidence => evidence.kind === 'independent');
    // Signed once and lapsed is a different fact from never signed.
    if (independentUsable.length > 0 && independentLive.length === 0) {
      return {
        reading: 'expired',
        ruleId: 'control-evidence-expired',
        statement: `The outside party's statement is past its validity, or older than the ${period} month${period === 1 ? '' : 's'} this control allows.`,
        counted: [],
      };
    }
    if (independentUsable.length === 0) {
      return {
        reading: 'awaiting-independent',
        ruleId: 'control-awaiting-independent',
        statement: 'Recorded as met on this project’s own evidence. This control can only be closed by a party outside the project.',
        counted: [],
      };
    }
  }

  // 8 — everything that would have counted has run out.
  if (usable.length > 0 && live.length === 0) {
    return {
      reading: 'expired',
      ruleId: 'control-evidence-expired',
      statement: `Every record that would satisfy this control is past its validity, or older than the ${period} month${period === 1 ? '' : 's'} this control allows.`,
      counted: [],
    };
  }

  // 9 — the wrong kind of thing entirely.
  if (live.length === 0) {
    return {
      reading: 'gap',
      ruleId: 'control-evidence-class-insufficient',
      statement: `This control is settled by ${acceptsLabel(accepts)}. Nothing of that kind is on record.`,
      counted: [],
    };
  }

  // 10 — a locator-less record cannot carry a document-class control.
  const documentClass = accepts.includes('artifact') || accepts.includes('independent');
  const producible = live.filter(evidence => isVerifiableLocator(evidence.locator));
  if (documentClass && !accepts.includes('attestation') && producible.length === 0) {
    return {
      reading: 'partial',
      ruleId: 'control-evidence-unverifiable',
      statement: 'The only record is a note about where the document is held. That is worth having and is not the document.',
      counted: live.map(entry => entry),
    };
  }

  // 11 — current, but the window this scope asks for is not covered yet.
  if (continuity !== undefined) {
    const spans = live.some(evidence => (evidence.observedPeriods ?? []).some(periodEntry => {
      const from = Date.parse(periodEntry.from);
      const to = Date.parse(periodEntry.to);
      if (!Number.isFinite(from) || !Number.isFinite(to)) {
        return false;
      }
      return (to - from) >= continuity * 30 * 86_400_000;
    }));
    if (!spans) {
      return {
        reading: 'partial',
        ruleId: 'control-continuity-short',
        statement: `This scope asks for ${continuity} months of evidence. Nothing on record states a period that long.`,
        counted: live,
      };
    }
  }

  // 12 / 13 — met.
  if (independentLive.length > 0) {
    return {
      reading: 'satisfied-independent',
      ruleId: 'control-satisfied-independent',
      statement: `Confirmed by ${independentLive[0]!.issuer ?? 'an outside party'}.`,
      counted: live,
    };
  }
  return {
    reading: 'satisfied-self',
    ruleId: 'control-satisfied-self',
    statement: `Met on this project’s own evidence (${acceptsLabel(accepts)}).`,
    counted: live,
  };
}

const EMPTY_COUNTS: Readonly<Record<ComplianceControlReading, number>> = {
  'not-assessed': 0,
  'not-applicable': 0,
  gap: 0,
  partial: 0,
  expired: 0,
  'awaiting-independent': 0,
  'satisfied-self': 0,
  'satisfied-independent': 0,
};

/**
 * Grade one regime.
 *
 * A `satisfied` technical result becomes an ephemeral `machine-check` evidence
 * record asserted *now* — load-bearing, because a stack check is only ever a
 * statement about the render that produced it. It counts only where the
 * catalog lists `machine-check` in that control's `accepts`; everywhere else it
 * lands in `corroborating`. A `gap` contributes a note and an `unknown`
 * contributes nothing at all, because "we did not look" is not a finding.
 */
export function gradeComplianceRegime(input: ComplianceGradeInput): ComplianceReading {
  const { catalog, register, now } = input;
  const library = input.library ?? { version: 1 as const, evidence: [], updatedAt: now.toISOString() };
  const byId = new Map(library.evidence.filter(entry => !entry.retiredAt).map(entry => [entry.id, entry]));
  const scopeDecided = Boolean(register?.scope.decidedAt);
  const variant = register?.scope.variant;
  const notes: string[] = [];
  const standard = standardTrackingFor(catalog.policyId);

  // An assessment made against an older edition is about a different document.
  // Named, never re-pointed.
  const modelledEdition = standard?.kind === 'tracked' ? standard.edition : undefined;
  const editionDrift = register?.assessedAgainst && modelledEdition
    && register.assessedAgainst.edition !== modelledEdition
    ? { assessedAgainst: `${register.assessedAgainst.name} ${register.assessedAgainst.edition}`, modelled: `${standard!.kind === 'tracked' ? standard!.name : ''} ${modelledEdition}`.trim() }
    : undefined;
  if (editionDrift) {
    notes.push(
      `This register was assessed against ${editionDrift.assessedAgainst}, and AtlasMind now models `
      + `${editionDrift.modelled}. The control statuses have not been carried across.`,
    );
  }
  if (isStandardStale(standard, now)) {
    notes.push(describeStandardTracking(standard, now));
  }

  if (catalog.controls.length === 0) {
    return {
      policyId: catalog.policyId,
      regime: catalog.regime,
      readiness: 'unexamined',
      readinessLabel: READINESS_LABEL.unexamined,
      tone: READINESS_TONE.unexamined,
      ruleId: 'regime-no-catalog',
      rule: ruleText(REGIME_RULE_BY_ID, 'regime-no-catalog'),
      statement: 'No control catalog is declared for this regime.',
      scopeDecided,
      controls: [],
      counts: EMPTY_COUNTS,
      declaredCount: 0,
      applicableCount: 0,
        notes,
      ...(standard ? { standard } : {}),
      standardDetail: describeStandardTracking(standard, now),
      standardStale: isStandardStale(standard, now),
      disclaimer: COMPLIANCE_DISCLAIMER,
      rules: { control: CONTROL_RULES, regime: REGIME_RULES },
    };
  }

  const technicalByRef = new Map<string, TechnicalCheckInput[]>();
  for (const result of input.technical ?? []) {
    const list = technicalByRef.get(result.controlRef) ?? [];
    list.push(result);
    technicalByRef.set(result.controlRef, list);
  }

  const grades: ControlGrade[] = catalog.controls.map(control => {
    const record = register?.controls.find(entry => entry.ref === control.ref);
    const attached = (record?.evidenceIds ?? [])
      .map(id => byId.get(id))
      .filter((entry): entry is ComplianceEvidence => entry !== undefined);

    const accepts = effectiveAccepts(control, variant);
    const checks = technicalByRef.get(control.ref) ?? [];
    const satisfiedChecks = checks.filter(check => check.state === 'satisfied');
    const acceptsMachine = accepts.includes('machine-check');

    const synthetic: ComplianceEvidence[] = acceptsMachine
      ? satisfiedChecks.map(check => ({
        id: `machine:${control.ref}:${check.rule}`,
        kind: 'machine-check' as const,
        title: check.question,
        locator: { kind: 'described' as const, where: 'Re-derived by AtlasMind from the declared stack' },
        assertedBy: { contactId: 'atlasmind', source: 'human' as const, at: now.toISOString() },
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      }))
      : [];

    const corroborating: CorroboratingCheck[] = checks
      .filter(check => check.state === 'satisfied' && !acceptsMachine)
      .map(check => ({
        ruleId: check.rule,
        question: check.question,
        evidence: check.evidence ?? 'Checked, with nothing recorded about what was found.',
      }));

    for (const check of checks) {
      if (check.state === 'gap') {
        notes.push(`${control.ref}: a stack check did not pass — ${check.evidence ?? check.question}`);
      }
    }

    const verdict = gradeControl({ control, catalog, register, attached, synthetic, now });
    const period = effectivePeriodMonths(catalog, control, variant);

    const expiries = verdict.counted
      .map(entry => entry.validUntil)
      .filter((value): value is string => typeof value === 'string')
      .map(value => Date.parse(value))
      .filter(value => Number.isFinite(value))
      .sort((a, b) => a - b);
    const soonest = expiries[0];

    return {
      ref: control.ref,
      requirement: control.requirement,
      theme: control.theme,
      themeLabel: COMPLIANCE_THEME_LABEL[control.theme],
      reading: verdict.reading,
      readingLabel: CONTROL_READING_LABEL[verdict.reading],
      ruleId: verdict.ruleId,
      rule: ruleText(CONTROL_RULE_BY_ID, verdict.ruleId),
      statement: verdict.statement,
      accepts,
      acceptsLabel: acceptsLabel(accepts),
      ...(control.acceptsReason ? { acceptsReason: control.acceptsReason } : {}),
      requiresIndependence: requiresIndependence(control, variant),
      periodMonths: period,
      countedEvidenceIds: verdict.counted.map(entry => entry.id),
      ...(soonest !== undefined
        ? {
          currentUntil: new Date(soonest).toISOString(),
          daysUntilExpiry: Math.floor((soonest - now.getTime()) / 86_400_000),
        }
        : {}),
      ...(record?.ownerContactId ? { ownerContactId: record.ownerContactId } : {}),
      corroborating,
    };
  });

  const counts: Record<ComplianceControlReading, number> = { ...EMPTY_COUNTS };
  for (const grade of grades) {
    counts[grade.reading] += 1;
  }

  const applicable = grades.filter(grade => grade.reading !== 'not-applicable');
  const applicableCount = applicable.length;

  if (counts['not-applicable'] > catalog.controls.length / 2) {
    notes.push(
      `${counts['not-applicable']} of ${catalog.controls.length} controls are excluded from scope. `
      + 'An assessor reads the exclusions before the mapping.',
    );
  }

  // Ranked by consequence: the first rule that fires names the weakest thing.
  const firstOf = (reading: ComplianceControlReading): ControlGrade | undefined =>
    applicable.find(grade => grade.reading === reading);

  let ruleId: string;
  let readiness: ComplianceReadiness;
  let weakest: ControlGrade | undefined;

  if (!scopeDecided) {
    readiness = 'unexamined';
    ruleId = 'regime-unscoped';
  } else if (applicable.every(grade => grade.reading === 'not-assessed')) {
    readiness = 'scoped';
    ruleId = 'regime-nothing-assessed';
  } else if ((weakest = firstOf('expired'))) {
    readiness = 'in-progress';
    ruleId = 'regime-evidence-expired';
  } else if ((weakest = firstOf('gap'))) {
    readiness = 'in-progress';
    ruleId = 'regime-control-gap';
  } else if ((weakest = firstOf('not-assessed'))) {
    readiness = 'in-progress';
    ruleId = 'regime-control-unassessed';
  } else if ((weakest = firstOf('partial'))) {
    readiness = 'in-progress';
    ruleId = 'regime-control-partial';
  } else if ((weakest = firstOf('awaiting-independent'))) {
    readiness = 'self-attested';
    ruleId = 'regime-awaiting-independent';
  } else if (applicable.some(grade => grade.reading === 'satisfied-independent')
    && applicable.every(grade => grade.reading === 'satisfied-independent' || grade.reading === 'satisfied-self')
    && applicable.filter(grade => grade.requiresIndependence)
      .every(grade => grade.reading === 'satisfied-independent')) {
    readiness = 'independently-assured';
    ruleId = 'regime-independently-assured';
  } else {
    readiness = 'self-attested';
    ruleId = 'regime-self-attested';
  }

  const awaiting = applicable.filter(grade => grade.reading === 'awaiting-independent');
  if (readiness === 'self-attested' && awaiting.length > 0) {
    notes.push(
      `${awaiting.length} control${awaiting.length === 1 ? '' : 's'} can only be closed by a party `
      + `outside the project: ${awaiting.slice(0, 4).map(grade => grade.ref).join(', ')}`
      + `${awaiting.length > 4 ? `, and ${awaiting.length - 4} more` : ''}.`,
    );
  }

  const upcoming = grades
    .filter(grade => grade.currentUntil !== undefined)
    .sort((a, b) => Date.parse(a.currentUntil!) - Date.parse(b.currentUntil!))[0];

  const statement = weakest
    ? `${ruleText(REGIME_RULE_BY_ID, ruleId)} The weakest is ${weakest.ref}: ${weakest.statement}`
    : ruleText(REGIME_RULE_BY_ID, ruleId);

  return {
    policyId: catalog.policyId,
    regime: catalog.regime,
    readiness,
    readinessLabel: READINESS_LABEL[readiness],
    tone: READINESS_TONE[readiness],
    ruleId,
    rule: ruleText(REGIME_RULE_BY_ID, ruleId),
    statement,
    scopeDecided,
    ...(variant ? { scopeVariant: variant } : {}),
    controls: grades,
    counts,
    declaredCount: catalog.controls.length,
    applicableCount,
    ...(weakest ? { weakest: { ref: weakest.ref, reading: weakest.reading, ruleId: weakest.ruleId } } : {}),
    ...(upcoming?.currentUntil !== undefined
      ? {
        nextExpiry: {
          ref: upcoming.ref,
          on: upcoming.currentUntil,
          inDays: upcoming.daysUntilExpiry ?? 0,
        },
      }
      : {}),
    notes: notes.slice(0, 12),
    ...(standard ? { standard } : {}),
    standardDetail: describeStandardTracking(standard, now),
    standardStale: isStandardStale(standard, now),
    ...(editionDrift ? { editionDrift } : {}),
    disclaimer: COMPLIANCE_DISCLAIMER,
    rules: { control: CONTROL_RULES, regime: REGIME_RULES },
  };
}

// ── Board ────────────────────────────────────────────────────────────────

export interface ComplianceBoard {
  readonly readings: readonly ComplianceReading[];
  readonly counts: Readonly<Record<ComplianceReadiness, number>>;
  readonly expiringSoon: readonly {
    readonly policyId: ComplianceMethodologyId;
    readonly ref: string;
    readonly on: string;
    readonly inDays: number;
  }[];
  readonly summary: string;
  readonly disclaimer: string;
}

export function summarizeComplianceBoard(
  readings: readonly ComplianceReading[],
  // Taken and unused on purpose. Expiry was already computed per control by
  // `gradeComplianceRegime` against this same clock, and recomputing it here
  // would give one render two answers. The parameter stays so no caller is
  // tempted to derive freshness itself against a second `new Date()`.
  _now: Date,
): ComplianceBoard {
  const counts: Record<ComplianceReadiness, number> = {
    unexamined: 0, scoped: 0, 'in-progress': 0, 'self-attested': 0, 'independently-assured': 0,
  };
  for (const reading of readings) {
    counts[reading.readiness] += 1;
  }

  const expiringSoon = readings
    .flatMap(reading => reading.controls
      .filter(control => control.daysUntilExpiry !== undefined && control.daysUntilExpiry <= 90)
      .map(control => ({
        policyId: reading.policyId,
        ref: control.ref,
        on: control.currentUntil!,
        inDays: control.daysUntilExpiry!,
      })))
    .sort((a, b) => a.inDays - b.inDays);

  const parts: string[] = [];
  if (readings.length === 0) {
    parts.push('No governance regime is enabled for this project');
  } else {
    parts.push(`${readings.length} regime${readings.length === 1 ? '' : 's'} declared`);
    if (counts.unexamined > 0) {
      parts.push(`${counts.unexamined} never examined`);
    }
    if (counts['in-progress'] > 0) {
      parts.push(`${counts['in-progress']} in progress`);
    }
    if (counts['self-attested'] > 0) {
      parts.push(`${counts['self-attested']} self-attested`);
    }
    if (counts['independently-assured'] > 0) {
      parts.push(`${counts['independently-assured']} independently assured`);
    }
    if (expiringSoon.length > 0) {
      parts.push(`${expiringSoon.length} record${expiringSoon.length === 1 ? '' : 's'} expiring within 90 days`);
    }
  }

  return {
    readings,
    counts,
    expiringSoon,
    summary: `${parts.join(' · ')}.`,
    disclaimer: COMPLIANCE_DISCLAIMER,
  };
}

/**
 * The compact per-regime summary the testing board carries on a governed row.
 *
 * Kept small and serialisable on purpose: the Testing page renders it without
 * importing the catalog, and a webview never needs the control list to draw a
 * card.
 */
export interface TestingPolicyGovernance {
  readonly readiness: ComplianceReadiness;
  readonly readinessLabel: string;
  readonly tone: 'muted' | 'warn' | 'critical' | 'accent';
  readonly ruleId: string;
  readonly rule: string;
  readonly declared: number;
  readonly applicable: number;
  readonly satisfiedSelf: number;
  readonly satisfiedIndependent: number;
  readonly awaitingIndependent: number;
  readonly expired: number;
  readonly gaps: number;
  readonly notAssessed: number;
  readonly weakestRef?: string;
  readonly nextExpiryInDays?: number;
}

export function toPolicyGovernance(reading: ComplianceReading): TestingPolicyGovernance {
  return {
    readiness: reading.readiness,
    readinessLabel: reading.readinessLabel,
    tone: reading.tone,
    ruleId: reading.ruleId,
    rule: reading.rule,
    declared: reading.declaredCount,
    applicable: reading.applicableCount,
    satisfiedSelf: reading.counts['satisfied-self'],
    satisfiedIndependent: reading.counts['satisfied-independent'],
    awaitingIndependent: reading.counts['awaiting-independent'],
    expired: reading.counts.expired,
    gaps: reading.counts.gap,
    notAssessed: reading.counts['not-assessed'],
    ...(reading.weakest ? { weakestRef: reading.weakest.ref } : {}),
    ...(reading.nextExpiry ? { nextExpiryInDays: reading.nextExpiry.inDays } : {}),
  };
}
