import {
  EVIDENCE_KIND_LABEL,
  complianceCatalogFor,
  type ComplianceMethodologyId,
  type ComplianceTheme,
  type EvidenceKind,
} from './complianceControlCatalog.js';
import {
  COMPLIANCE_CONTROL_STATUS_LABEL,
  daysUntilExpiry,
  evidenceFreshness,
  evidenceUsage,
  isVerifiableLocator,
  orphanedEvidence,
  type ComplianceControlStatus,
  type ComplianceDemotion,
  type ComplianceEvidence,
  type ComplianceEvidenceLibrary,
  type ComplianceRegimeRegister,
  type EvidenceFreshness,
} from './complianceEvidenceRegister.js';
import {
  CONTROL_RULES,
  REGIME_RULES,
  type ComplianceReading,
  type ComplianceRule,
} from './complianceReadiness.js';

/**
 * What the Compliance page draws, derived once and shared.
 *
 * Pure: it takes the registers, the evidence library and the readings the
 * grader produced, and returns view records. The panel reads files and posts
 * the result; nothing here touches a filesystem, so the whole shape — including
 * the questions an assessor would ask — is unit-testable without a workspace.
 *
 * The one thing worth stating up front is what this module is *for*. The board
 * it replaces answered "is this regime met?" with a green tag. This answers a
 * different question — **what would somebody outside this project ask next, and
 * what would you say?** — because that is the question a compliance surface can
 * honestly help with, and the one a tick can never answer.
 */

// ── Views ────────────────────────────────────────────────────────────────

export interface ComplianceEvidenceView {
  readonly id: string;
  readonly kind: EvidenceKind;
  readonly kindLabel: string;
  readonly title: string;
  readonly locatorKind: 'workspace-file' | 'url' | 'described';
  /** The relative path, the host, or the description. Never a full URL. */
  readonly locatorLabel: string;
  /** False for a described location: honest, useful, and not a document. */
  readonly verifiable: boolean;
  readonly issuer?: string;
  readonly issuerScope?: string;
  readonly assertedByContactId: string;
  readonly assertedAt: string;
  readonly validUntil?: string;
  readonly freshness: EvidenceFreshness;
  readonly daysUntilExpiry?: number;
  readonly retired: boolean;
  /** Which controls, across every regime, rest on this record. */
  readonly usedBy: readonly { readonly regimeId: string; readonly controlRef: string }[];
}

export interface ComplianceControlView {
  readonly ref: string;
  readonly requirement: string;
  readonly theme: ComplianceTheme;
  readonly themeLabel: string;
  /** What is recorded. */
  readonly status: ComplianceControlStatus;
  readonly statusLabel: string;
  /** What that is worth, once the rules have been applied. */
  readonly reading: string;
  readonly readingLabel: string;
  readonly ruleId: string;
  readonly rule: string;
  readonly statement: string;
  readonly acceptsLabel: string;
  readonly acceptsReason?: string;
  readonly requiresIndependence: boolean;
  readonly periodMonths: number;
  readonly evidenceIds: readonly string[];
  readonly ownerContactId?: string;
  readonly note?: string;
  readonly justification?: string;
  readonly daysUntilExpiry?: number;
  /** Checks that ran but that this control does not accept as sufficient. */
  readonly corroborating: readonly { readonly question: string; readonly evidence: string }[];
  /**
   * Statuses this control can actually reach, given what is attached.
   *
   * Sent so the page can explain why `satisfied` is not on the menu rather than
   * accepting it and demoting it on read — which would be correct and would
   * feel like a bug.
   */
  readonly reachableStatuses: readonly ComplianceControlStatus[];
  readonly ceilingReason?: string;
}

export interface ComplianceRegimeView {
  readonly id: ComplianceMethodologyId;
  readonly label: string;
  readonly regime: string;
  readonly registerPath: string;
  readonly summaryPath: string;
  readonly notesPath: string;
  readonly notesExist: boolean;
  /** A hand-edited mapping is on disk and has not been read in yet. */
  readonly importable: boolean;
  readonly registered: boolean;
  readonly scopeDecided: boolean;
  readonly scopeStatement?: string;
  readonly scopeProposed?: string;
  readonly scopeVariant?: string;
  readonly scopingQuestion: string;
  readonly variants: readonly string[];
  readonly readiness: string;
  readonly readinessLabel: string;
  readonly tone: 'muted' | 'warn' | 'critical' | 'accent';
  readonly ruleId: string;
  readonly rule: string;
  readonly statement: string;
  readonly standardDetail: string;
  readonly standardStale: boolean;
  readonly editionDrift?: { readonly assessedAgainst: string; readonly modelled: string };
  readonly declaredCount: number;
  readonly applicableCount: number;
  readonly counts: Readonly<Record<string, number>>;
  readonly weakestRef?: string;
  readonly controls: readonly ComplianceControlView[];
  readonly notes: readonly string[];
  /** Statuses the sanitizer would not accept on read, so nothing is lost quietly. */
  readonly demotions: readonly ComplianceDemotion[];
  readonly lastReviewedAt?: string;
}

export interface ComplianceQuestion {
  readonly id: string;
  /** Phrased the way it will actually arrive, because that is what it is. */
  readonly question: string;
  readonly ruleId: string;
  readonly regimeId?: ComplianceMethodologyId;
  readonly controlRef?: string;
  readonly evidenceId?: string;
}

export interface ComplianceSnapshot {
  readonly available: boolean;
  readonly evidencePath: string;
  readonly evidenceSummaryPath: string;
  /** True once any register file exists. */
  readonly registered: boolean;
  /** A newer-format file this build must not write over. */
  readonly readOnly: boolean;
  readonly notice?: string;
  readonly regimes: readonly ComplianceRegimeView[];
  readonly evidence: readonly ComplianceEvidenceView[];
  readonly orphanedEvidenceIds: readonly string[];
  readonly expiredCount: number;
  readonly expiringSoonCount: number;
  readonly unverifiableCount: number;
  readonly demotedOnRead: number;
  readonly questions: readonly ComplianceQuestion[];
  readonly summary: string;
  readonly disclaimer: string;
  readonly rules: {
    readonly control: readonly ComplianceRule[];
    readonly regime: readonly ComplianceRule[];
    readonly question: readonly ComplianceRule[];
  };
}

// ── The questions an assessor asks ───────────────────────────────────────

/**
 * Declared, ordered by consequence. First match per regime wins for the
 * regime-level rules; control-level ones are emitted per control.
 *
 * These are phrased as questions because a question is what actually arrives.
 * "CC6.1 is unevidenced" is a status; *"show me the report behind CC6.1"* is
 * the sentence somebody says in a room, and it is much harder to nod along to.
 */
export const QUESTION_RULES: readonly ComplianceRule[] = [
  { id: 'question-no-register', describes: 'A regime is declared and no control mapping exists at all. The first thing an assessor asks for is the mapping.' },
  { id: 'question-unscoped', describes: 'No scope decision is recorded. Scope is what an assessor establishes before reading a single control.' },
  { id: 'question-evidence-expired', describes: 'Evidence a control rests on is past its validity date. A lapsed certificate is a claim that has become false.' },
  { id: 'question-edition-drift', describes: 'The assessment was made against a different edition of the standard from the one now modelled.' },
  { id: 'question-awaiting-independent', describes: 'A control that only an outside party can close is recorded as met on the project’s own word.' },
  { id: 'question-unjustified-exclusion', describes: 'A control was excluded from scope with no written justification. An unexplained exclusion is challenged first.' },
  { id: 'question-unverifiable', describes: 'A control rests only on a note saying where a document is held. The next question is whether it can be produced.' },
  { id: 'question-control-gap', describes: 'A control is recorded as not met, or rests on evidence of a kind it does not accept.' },
  { id: 'question-unassessed', describes: 'Controls have never been assessed. Unassessed is not a pass, and somebody has to own each one.' },
];

const MAX_QUESTIONS = 8;

function shortDate(iso: string): string {
  return iso.slice(0, 10);
}

function buildQuestions(
  regimes: readonly ComplianceRegimeView[],
  evidenceById: ReadonlyMap<string, ComplianceEvidence>,
): readonly ComplianceQuestion[] {
  const out: ComplianceQuestion[] = [];
  const push = (entry: ComplianceQuestion): void => {
    if (out.length < MAX_QUESTIONS) {
      out.push(entry);
    }
  };

  for (const regime of regimes) {
    if (!regime.registered) {
      push({
        id: `no-register:${regime.id}`,
        ruleId: 'question-no-register',
        regimeId: regime.id,
        question: `You have declared ${regime.label}. Where is your control mapping?`,
      });
      continue;
    }
    if (!regime.scopeDecided) {
      push({
        id: `unscoped:${regime.id}`,
        ruleId: 'question-unscoped',
        regimeId: regime.id,
        question: `What is in scope for ${regime.label}, and who decided it?`,
      });
    }
    if (regime.editionDrift) {
      push({
        id: `drift:${regime.id}`,
        ruleId: 'question-edition-drift',
        regimeId: regime.id,
        question: `Your ${regime.label} mapping was assessed against ${regime.editionDrift.assessedAgainst}. `
          + `Has it been re-checked against ${regime.editionDrift.modelled}?`,
      });
    }
  }

  // Expired evidence first across every regime: a lapsed certificate is not a
  // late task, it is a claim on a page an outsider reads that has become false.
  for (const regime of regimes) {
    for (const control of regime.controls) {
      if (control.reading !== 'expired') {
        continue;
      }
      const lapsed = control.evidenceIds
        .map(id => evidenceById.get(id))
        .find(entry => entry && evidenceFreshness(entry) === 'expired');
      push({
        id: `expired:${regime.id}:${control.ref}`,
        ruleId: 'question-evidence-expired',
        regimeId: regime.id,
        controlRef: control.ref,
        ...(lapsed ? { evidenceId: lapsed.id } : {}),
        question: lapsed?.validUntil
          ? `Your evidence for ${control.ref} ("${lapsed.title}") expired on ${shortDate(lapsed.validUntil)}. What is the current one?`
          : `The evidence behind ${control.ref} is out of date. What is the current one?`,
      });
    }
  }

  for (const regime of regimes) {
    for (const control of regime.controls) {
      if (control.reading === 'awaiting-independent') {
        push({
          id: `independent:${regime.id}:${control.ref}`,
          ruleId: 'question-awaiting-independent',
          regimeId: regime.id,
          controlRef: control.ref,
          question: `${control.ref} needs somebody outside the project. Who signed it off, and can I see their statement?`,
        });
      }
    }
  }

  for (const regime of regimes) {
    for (const control of regime.controls) {
      if (control.status === 'not-applicable' && !control.justification) {
        push({
          id: `exclusion:${regime.id}:${control.ref}`,
          ruleId: 'question-unjustified-exclusion',
          regimeId: regime.id,
          controlRef: control.ref,
          question: `${control.ref} is marked Not applicable. On what basis?`,
        });
      }
    }
  }

  for (const regime of regimes) {
    for (const control of regime.controls) {
      if (control.reading !== 'partial' || control.ruleId !== 'control-evidence-unverifiable') {
        continue;
      }
      const held = control.evidenceIds.map(id => evidenceById.get(id)).find(Boolean);
      push({
        id: `unverifiable:${regime.id}:${control.ref}`,
        ruleId: 'question-unverifiable',
        regimeId: regime.id,
        controlRef: control.ref,
        question: held
          ? `You say "${held.title}" is held elsewhere. Can you produce it?`
          : `The evidence for ${control.ref} is described rather than held. Can you produce it?`,
      });
    }
  }

  for (const regime of regimes) {
    for (const control of regime.controls) {
      if (control.reading === 'gap') {
        push({
          id: `gap:${regime.id}:${control.ref}`,
          ruleId: 'question-control-gap',
          regimeId: regime.id,
          controlRef: control.ref,
          question: `${control.ref} is not met. What is the plan, and by when?`,
        });
      }
    }
  }

  for (const regime of regimes) {
    const unassessed = regime.controls.filter(control => control.reading === 'not-assessed');
    if (unassessed.length > 0 && regime.scopeDecided) {
      push({
        id: `unassessed:${regime.id}`,
        ruleId: 'question-unassessed',
        regimeId: regime.id,
        controlRef: unassessed[0]!.ref,
        question: `${unassessed.length} ${regime.label} control${unassessed.length === 1 ? ' has' : 's have'} never been assessed, `
          + `starting with ${unassessed[0]!.ref}. Who owns them?`,
      });
    }
  }

  return out;
}

// ── Reachable statuses ───────────────────────────────────────────────────

/**
 * Which statuses this control can actually reach with what is attached.
 *
 * Offered so the page can withhold `satisfied` **and say why**. Accepting it
 * and demoting it on the next read would be correct and would feel like a bug;
 * explaining that this control needs an outside party, and that none is
 * attached, teaches the model of the system in one sentence.
 */
export function reachableStatuses(
  reading: ComplianceReading['controls'][number],
  attached: readonly ComplianceEvidence[],
): { statuses: readonly ComplianceControlStatus[]; ceilingReason?: string } {
  const base: ComplianceControlStatus[] = ['not-assessed', 'in-progress', 'partial', 'gap', 'not-applicable'];
  const live = attached.filter(entry => !entry.retiredAt);
  const ofAcceptedKind = live.filter(entry => reading.accepts.includes(entry.kind));

  if (live.length === 0) {
    return {
      statuses: base,
      ceilingReason: 'Nothing is attached yet, so there is nothing for a satisfied status to rest on.',
    };
  }
  // Independence before the class rule, for the reason the grader orders them
  // the same way: both fire on an attestation attached to an
  // independence-only control, and "we need somebody outside the project to
  // say this" tells you what to do next where "the evidence is the wrong
  // kind" is true and useless.
  if (reading.requiresIndependence && !live.some(entry => entry.kind === 'independent')) {
    return {
      statuses: base,
      ceilingReason: 'This control can only be closed by a party outside the project, and no such statement is attached.',
    };
  }
  if (ofAcceptedKind.length === 0) {
    return {
      statuses: base,
      ceilingReason: `Nothing attached is of a kind this control accepts — it is settled by ${reading.acceptsLabel.toLowerCase()}.`,
    };
  }
  const documentClass = reading.accepts.includes('artifact') || reading.accepts.includes('independent');
  if (documentClass && !reading.accepts.includes('attestation')
    && !ofAcceptedKind.some(entry => isVerifiableLocator(entry.locator))) {
    return {
      statuses: base,
      ceilingReason: 'The only record is a note about where the document is held, which is not the document.',
    };
  }
  return { statuses: [...base, 'satisfied'] };
}

// ── Snapshot ─────────────────────────────────────────────────────────────

export interface ComplianceSnapshotInput {
  readonly readings: readonly ComplianceReading[];
  readonly registers: ReadonlyMap<ComplianceMethodologyId, ComplianceRegimeRegister>;
  readonly demotions: ReadonlyMap<ComplianceMethodologyId, readonly ComplianceDemotion[]>;
  readonly library: ComplianceEvidenceLibrary;
  readonly labels: ReadonlyMap<ComplianceMethodologyId, string>;
  readonly notesPresent: ReadonlySet<ComplianceMethodologyId>;
  readonly importable?: ReadonlySet<ComplianceMethodologyId>;
  readonly paths: {
    readonly evidence: string;
    readonly evidenceSummary: string;
    readonly register: (id: ComplianceMethodologyId) => string;
    readonly summary: (id: ComplianceMethodologyId) => string;
    readonly notes: (id: ComplianceMethodologyId) => string;
  };
  readonly readOnly?: boolean;
  readonly notice?: string;
  readonly now: Date;
}

export function buildComplianceSnapshot(input: ComplianceSnapshotInput): ComplianceSnapshot {
  const { library, now } = input;
  const byId = new Map(library.evidence.map(entry => [entry.id, entry]));
  const registerList = [...input.registers.values()];

  const regimes: ComplianceRegimeView[] = input.readings.map(reading => {
    const catalog = complianceCatalogFor(reading.policyId)!;
    const register = input.registers.get(reading.policyId);
    const demotions = input.demotions.get(reading.policyId) ?? [];

    const controls: ComplianceControlView[] = reading.controls.map(grade => {
      const record = register?.controls.find(entry => entry.ref === grade.ref);
      const attached = (record?.evidenceIds ?? [])
        .map(id => byId.get(id))
        .filter((entry): entry is ComplianceEvidence => entry !== undefined);
      const reach = reachableStatuses(grade, attached);
      return {
        ref: grade.ref,
        requirement: grade.requirement,
        theme: grade.theme,
        themeLabel: grade.themeLabel,
        status: record?.status ?? 'not-assessed',
        statusLabel: COMPLIANCE_CONTROL_STATUS_LABEL[record?.status ?? 'not-assessed'],
        reading: grade.reading,
        readingLabel: grade.readingLabel,
        ruleId: grade.ruleId,
        rule: grade.rule,
        statement: grade.statement,
        acceptsLabel: grade.acceptsLabel,
        ...(grade.acceptsReason ? { acceptsReason: grade.acceptsReason } : {}),
        requiresIndependence: grade.requiresIndependence,
        periodMonths: grade.periodMonths,
        evidenceIds: record?.evidenceIds ?? [],
        ...(record?.ownerContactId ? { ownerContactId: record.ownerContactId } : {}),
        ...(record?.note ? { note: record.note } : {}),
        ...(record?.justification ? { justification: record.justification } : {}),
        ...(grade.daysUntilExpiry !== undefined ? { daysUntilExpiry: grade.daysUntilExpiry } : {}),
        corroborating: grade.corroborating.map(entry => ({
          question: entry.question,
          evidence: entry.evidence,
        })),
        reachableStatuses: reach.statuses,
        ...(reach.ceilingReason ? { ceilingReason: reach.ceilingReason } : {}),
      };
    });

    return {
      id: reading.policyId,
      label: input.labels.get(reading.policyId) ?? reading.policyId,
      regime: reading.regime,
      registerPath: input.paths.register(reading.policyId),
      summaryPath: input.paths.summary(reading.policyId),
      notesPath: input.paths.notes(reading.policyId),
      notesExist: input.notesPresent.has(reading.policyId),
      importable: input.importable?.has(reading.policyId) ?? false,
      registered: register !== undefined,
      scopeDecided: reading.scopeDecided,
      ...(register?.scope.statement ? { scopeStatement: register.scope.statement } : {}),
      ...(register?.scope.proposed ? { scopeProposed: register.scope.proposed } : {}),
      ...(reading.scopeVariant ? { scopeVariant: reading.scopeVariant } : {}),
      scopingQuestion: catalog.scoping,
      variants: catalog.variants ?? [],
      readiness: reading.readiness,
      readinessLabel: reading.readinessLabel,
      tone: reading.tone,
      ruleId: reading.ruleId,
      rule: reading.rule,
      statement: reading.statement,
      standardDetail: reading.standardDetail,
      standardStale: reading.standardStale,
      ...(reading.editionDrift ? { editionDrift: reading.editionDrift } : {}),
      declaredCount: reading.declaredCount,
      applicableCount: reading.applicableCount,
      counts: reading.counts,
      ...(reading.weakest ? { weakestRef: reading.weakest.ref } : {}),
      controls,
      notes: reading.notes,
      demotions,
      ...(register?.reviews[0]?.at ? { lastReviewedAt: register.reviews[0]!.at } : {}),
    };
  });

  const evidence: ComplianceEvidenceView[] = library.evidence.map(entry => {
    const freshness = evidenceFreshness(entry, now);
    const days = daysUntilExpiry(entry, now);
    return {
      id: entry.id,
      kind: entry.kind,
      kindLabel: EVIDENCE_KIND_LABEL[entry.kind],
      title: entry.title,
      locatorKind: entry.locator.kind,
      locatorLabel: entry.locator.kind === 'workspace-file'
        ? entry.locator.path
        : entry.locator.kind === 'url' ? entry.locator.host : entry.locator.where,
      verifiable: isVerifiableLocator(entry.locator),
      ...(entry.issuer ? { issuer: entry.issuer } : {}),
      ...(entry.issuerScope ? { issuerScope: entry.issuerScope } : {}),
      assertedByContactId: entry.assertedBy.contactId,
      assertedAt: entry.assertedBy.at,
      ...(entry.validUntil ? { validUntil: entry.validUntil } : {}),
      freshness,
      ...(days !== undefined ? { daysUntilExpiry: days } : {}),
      retired: Boolean(entry.retiredAt),
      usedBy: evidenceUsage(entry.id, registerList),
    };
  })
    // Expiring first: the thing that needs a person before it lapses.
    .sort((a, b) => {
      const rank = (entry: ComplianceEvidenceView): number =>
        entry.freshness === 'expired' ? 0 : entry.freshness === 'expiring' ? 1 : entry.retired ? 3 : 2;
      const byRank = rank(a) - rank(b);
      return byRank !== 0 ? byRank : a.title.localeCompare(b.title);
    });

  const expiredCount = evidence.filter(entry => !entry.retired && entry.freshness === 'expired').length;
  const expiringSoonCount = evidence.filter(entry => !entry.retired && entry.freshness === 'expiring').length;
  const unverifiableCount = regimes.reduce(
    (sum, regime) => sum + regime.controls.filter(control => control.ruleId === 'control-evidence-unverifiable').length,
    0,
  );
  const demotedOnRead = regimes.reduce((sum, regime) => sum + regime.demotions.length, 0);
  const questions = buildQuestions(regimes, byId);

  return {
    available: true,
    evidencePath: input.paths.evidence,
    evidenceSummaryPath: input.paths.evidenceSummary,
    registered: regimes.some(regime => regime.registered),
    readOnly: Boolean(input.readOnly),
    ...(input.notice ? { notice: input.notice } : {}),
    regimes,
    evidence,
    orphanedEvidenceIds: orphanedEvidence(library, registerList).map(entry => entry.id),
    expiredCount,
    expiringSoonCount,
    unverifiableCount,
    demotedOnRead,
    questions,
    summary: buildSummary(regimes, expiredCount, expiringSoonCount),
    disclaimer: input.readings[0]?.disclaimer
      ?? 'AtlasMind records what evidence exists and who said so. It does not determine compliance with any regime.',
    rules: { control: CONTROL_RULES, regime: REGIME_RULES, question: QUESTION_RULES },
  };
}

function buildSummary(
  regimes: readonly ComplianceRegimeView[],
  expired: number,
  expiring: number,
): string {
  if (regimes.length === 0) {
    return 'No governance regime is enabled for this project. Enable one on the Testing page if a customer, '
      + 'a regulator or a contract asks for it.';
  }
  const parts: string[] = [`${regimes.length} regime${regimes.length === 1 ? '' : 's'} declared`];
  const unregistered = regimes.filter(regime => !regime.registered).length;
  if (unregistered > 0) {
    // Unassessed is never folded into a reassuring number.
    parts.push(`${unregistered} with no register at all`);
  }
  const unscoped = regimes.filter(regime => regime.registered && !regime.scopeDecided).length;
  if (unscoped > 0) {
    parts.push(`${unscoped} unscoped`);
  }
  if (expired > 0) {
    parts.push(`${expired} record${expired === 1 ? '' : 's'} lapsed`);
  }
  if (expiring > 0) {
    parts.push(`${expiring} expiring within 90 days`);
  }
  const assured = regimes.filter(regime => regime.readiness === 'independently-assured').length;
  if (assured > 0) {
    parts.push(`${assured} independently assured`);
  }
  return `${parts.join(' · ')}.`;
}

/**
 * Which reading most deserves a person's attention, in order.
 *
 * Never assessed first — an unexamined control is the one nobody has thought
 * about — then a declared failure, then evidence that has run out, then the one
 * waiting on somebody outside. Declared here so the page, the chat command and
 * the webview walk the same order; the webview holds a copy and names this
 * constant in a comment, the way the focus-kind list already does.
 */
export const CONTROL_ATTENTION_ORDER: readonly string[] = [
  'not-assessed', 'gap', 'expired', 'awaiting-independent',
];

/** The next control worth looking at, for the per-control walk. */
export function nextUnassessedControl<T extends { readonly reading: string }>(
  regime: { readonly controls: readonly T[] },
): T | undefined {
  for (const reading of CONTROL_ATTENTION_ORDER) {
    const found = regime.controls.find(control => control.reading === reading);
    if (found) {
      return found;
    }
  }
  return undefined;
}
