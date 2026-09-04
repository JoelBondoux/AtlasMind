import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { interpretVersionedDocument, type VersionedDocumentRead } from './schemaMigration.js';
import { redactSecrets } from '../utils/secretRedactor.js';
import {
  COMPLIANCE_THEME_ORDER,
  COMPLIANCE_THEME_LABEL,
  EVIDENCE_KIND_LABEL,
  complianceCatalogFor,
  effectiveAccepts,
  effectivePeriodMonths,
  requiresIndependence,
  type ComplianceMethodologyId,
  type ComplianceRegimeCatalog,
  type EvidenceKind,
} from './complianceControlCatalog.js';

/**
 * What this project has actually recorded about a governance regime, and who
 * said so.
 *
 * The register is the half of the fix that the catalog cannot supply. The
 * catalog says what a control would need; this says what is on record, who
 * asserted it, when, and when it stops being true. Before it existed a regime
 * read "Tested" because a file was named `data-privacy.test.ts`, and there was
 * nowhere in the model to put a certificate, an auditor's report, a signed
 * processor agreement, or the name of the person who said the control was met.
 *
 * ── Evidence is referenced, never copied ──────────────────────────────────
 *
 * `project_memory/` is git-tracked. Copying a signed SOC 2 report, a data
 * processing agreement or an ISO certificate into it would commit somebody
 * else's confidential document to the repository and to every clone of it, and
 * AtlasMind could not take it back out. So a {@link ComplianceEvidence} record
 * holds a *locator* and metadata and never a byte of the document, and nothing
 * in this module ever opens an artifact or sends any part of one to a model —
 * the "derive, don't mirror" rule that governs `researchRegister`, applied to a
 * document that belongs to a third party.
 *
 * ── The invariants are re-enforced on every read ──────────────────────────
 *
 * {@link sanitizeComplianceRegimeRegister} runs on load, not only on save, so a
 * hand-edit — or an agent edit — cannot promote a control. This is the same
 * shape as the citation gate in `researchRegister`, where a stored finding
 * whose citations were deleted is demoted on read rather than trusted: a
 * promise enforced in a sanitizer is a guarantee, where the same promise in a
 * prompt is a request.
 *
 * Seven of them, each stated on its rule constant below. The one that carries
 * the most weight is attribution: a status other than not-assessed requires a
 * named person, a parseable date, and `source: 'human'`. A status somebody
 * typed with nothing behind it is a claim, not evidence, and the whole defect
 * this feature exists to remove was claims being counted as evidence.
 *
 * Every demotion is **counted and reported** rather than applied quietly.
 * Silent demotion is indistinguishable from data loss, and a compliance record
 * that appears to have lost somebody's work is worse than one that explains why
 * it did not accept it.
 *
 * ── What this module will not do ─────────────────────────────────────────
 *
 * It does not grade. {@link ComplianceReading} comes from `complianceReadiness`,
 * which is pure and clock-injected; the sanitizer guarantees and the grader
 * explains, and keeping them apart is what lets the grader be tested against
 * generated input without a filesystem.
 *
 * It is **never seeded on render**. Twenty-four regimes; opening a tab must not
 * put committed files in somebody's repository. A register file appears the
 * first time a person records something, and the migration from a hand-edited
 * mapping is an explicit confirmed act rather than something that happens
 * because a page loaded.
 */

// ── Paths ────────────────────────────────────────────────────────────────

export const COMPLIANCE_DIR = 'project_memory/operations/compliance';
export const COMPLIANCE_EVIDENCE_SSOT_PATH = `${COMPLIANCE_DIR}/compliance-evidence.json`;
export const COMPLIANCE_EVIDENCE_SUMMARY_PATH = `${COMPLIANCE_DIR}/compliance-evidence.md`;
export const COMPLIANCE_HISTORY_SSOT_PATH = `${COMPLIANCE_DIR}/compliance-history.json`;

export function complianceRegimePath(id: ComplianceMethodologyId): string {
  return `${COMPLIANCE_DIR}/${id}.json`;
}

/** The generated mirror. This is the document somebody hands an assessor. */
export function complianceRegimeSummaryPath(id: ComplianceMethodologyId): string {
  return `${COMPLIANCE_DIR}/${id}.md`;
}

/**
 * The one file in this directory a person writes by hand.
 *
 * A generated mirror normally means an edit to it is lost on the next write.
 * This resolves that without leaving two documents both claiming to be the
 * control mapping: prose goes here, the generator absorbs it into the mirror,
 * and the mirror stays the single thing anybody reads.
 */
export function complianceRegimeNotesPath(id: ComplianceMethodologyId): string {
  return `${COMPLIANCE_DIR}/${id}-user-edit.md`;
}

// ── Caps ─────────────────────────────────────────────────────────────────

const MAX_FIELD = 240;
const MAX_LONG = 2000;
const MAX_URL = 500;
const MAX_PATH = 400;
const MAX_EVIDENCE_RECORDS = 200;
const MAX_EVIDENCE_PER_CONTROL = 8;
const MAX_CONTROLS_PER_REGIME = 300;
const MAX_TRANSITIONS_PER_CONTROL = 50;
const MAX_EXCLUSIONS = 300;
const MAX_REVIEWS = 100;
export const MAX_COMPLIANCE_HISTORY = 1000;

/** Evidence inside this window is reported as expiring rather than current. */
export const EVIDENCE_FRESHNESS_HORIZON_DAYS = 90;

// ── Types ────────────────────────────────────────────────────────────────

/**
 * Where an artifact is. Three honest forms and nothing else.
 *
 * `described` is a first-class answer rather than a fallback. "Held in Vanta;
 * ask the security lead" tells an assessor how to obtain the document.
 * An absolute local path tells them nothing and *looks* like it tells them
 * something, which is worse — see {@link sanitizeComplianceLocator}.
 */
export type ComplianceLocator =
  | { readonly kind: 'workspace-file'; readonly path: string }
  | { readonly kind: 'url'; readonly url: string; readonly host: string }
  | { readonly kind: 'described'; readonly where: string };

/**
 * Who said so.
 *
 * A contact id resolved against the Director roster, never a typed name: the
 * Director owns people, holds the consent flag for storing personal data, and
 * prefers a system-of-record reference to raw detail. `source` exists so the
 * sanitizer can refuse a model-authored assertion structurally rather than by
 * inspecting wording.
 */
export interface ComplianceAttribution {
  readonly contactId: string;
  readonly source: 'human' | 'atlas-draft';
  readonly at: string;
}

export interface ComplianceEvidence {
  readonly id: string;
  readonly kind: EvidenceKind;
  readonly title: string;
  readonly detail?: string;
  readonly locator: ComplianceLocator;
  /** Required for `independent`: who issued the statement. */
  readonly issuer?: string;
  /**
   * Required for `independent`: what their statement actually covers.
   *
   * The field that stops a certificate issued for a different legal entity, or
   * a different system boundary, being reused here as though it said something
   * about this one.
   */
  readonly issuerScope?: string;
  readonly assertedBy: ComplianceAttribution;
  readonly validFrom?: string;
  /** Absent means no stated expiry, which is not the same as current. */
  readonly validUntil?: string;
  /** Dated periods this evidence covers, for a continuity requirement. */
  readonly observedPeriods?: readonly { readonly from: string; readonly to: string }[];
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Retired rather than deleted; evidence transitions like everything else here. */
  readonly retiredAt?: string;
  readonly retiredNote?: string;
}

export interface ComplianceEvidenceLibrary {
  readonly version: 1;
  readonly evidence: readonly ComplianceEvidence[];
  readonly updatedAt: string;
}

export type ComplianceControlStatus =
  | 'not-assessed'
  | 'in-progress'
  | 'partial'
  | 'satisfied'
  | 'gap'
  | 'not-applicable';

export const COMPLIANCE_CONTROL_STATUS_LABEL: Readonly<Record<ComplianceControlStatus, string>> = {
  'not-assessed': 'Not assessed',
  'in-progress': 'In progress',
  partial: 'Partial',
  satisfied: 'Satisfied',
  gap: 'Gap',
  'not-applicable': 'Not applicable',
};

export interface ComplianceControlTransition {
  readonly at: string;
  readonly status: ComplianceControlStatus;
  readonly by: ComplianceAttribution;
  readonly note?: string;
}

export interface ComplianceControlRecord {
  readonly ref: string;
  /** Carried so the JSON reads standalone; the catalog stays authoritative. */
  readonly requirement: string;
  readonly status: ComplianceControlStatus;
  /** Required for `not-applicable`. An unexplained exclusion is not an exclusion. */
  readonly justification?: string;
  readonly evidenceIds: readonly string[];
  readonly ownerContactId?: string;
  readonly assertedBy?: ComplianceAttribution;
  readonly note?: string;
  readonly transitions: readonly ComplianceControlTransition[];
  readonly lastReviewedAt?: string;
  /** How this row arrived, so a reader knows a migrated row was hand-typed. */
  readonly provenance?: 'seeded' | 'entered' | 'migrated-markdown';
}

/**
 * The scoping decision. Nothing in a regime means anything until this exists.
 *
 * `proposed` holds a draft — from the scaffolder's own prose, or from Atlas —
 * which is deliberately not the same field as a decision. Adopting it is a
 * human act, and until then the scope gate still holds.
 */
export interface ComplianceScope {
  readonly statement?: string;
  readonly exclusions: readonly { readonly ref: string; readonly reason: string }[];
  readonly decidedBy?: ComplianceAttribution;
  readonly decidedAt?: string;
  /** One of the catalog's declared variants: 'Type II', 'SAQ-D', 'ASIL C'. */
  readonly variant?: string;
  readonly proposed?: string;
}

export interface ComplianceReview {
  readonly at: string;
  readonly by: ComplianceAttribution;
  readonly scope: string;
}

export interface ComplianceRegimeRegister {
  readonly version: 1;
  readonly regimeId: ComplianceMethodologyId;
  readonly regime: string;
  /**
   * Which edition of the standard this assessment was made against.
   *
   * An assessment made against ISO/IEC 27001:2013 is about a *different
   * document* from one made against :2022, and must never be silently
   * re-pointed at a newer control set. Recorded here so the page can say the
   * catalog has moved ahead rather than quietly grading old work by new rules.
   */
  readonly assessedAgainst?: { readonly name: string; readonly edition: string };
  readonly scope: ComplianceScope;
  readonly controls: readonly ComplianceControlRecord[];
  readonly reviews: readonly ComplianceReview[];
  /** Set once by the markdown import, so a second import cannot run. */
  readonly importedFrom?: {
    readonly format: 'markdown-v1';
    readonly at: string;
    readonly demotedRows: number;
  };
  readonly updatedAt: string;
}

export interface ComplianceHistoryEntry {
  readonly id: string;
  readonly kind:
    | 'register-created' | 'scope-decided' | 'evidence-recorded' | 'evidence-renewed'
    | 'evidence-retired' | 'evidence-attached' | 'evidence-detached' | 'status-set'
    | 'reviewed' | 'imported';
  readonly summary: string;
  readonly regimeId?: ComplianceMethodologyId;
  readonly controlRef?: string;
  readonly evidenceId?: string;
  readonly actorContactId?: string;
  readonly at: string;
}

/** What the sanitizer would not accept, so the page can say so rather than lose it. */
export interface ComplianceDemotion {
  readonly ref: string;
  readonly from: ComplianceControlStatus;
  readonly rule: string;
  readonly reason: string;
}

// ── Boundary helpers ─────────────────────────────────────────────────────

function clampStr(value: unknown, max: number): string {
  if (typeof value !== 'string') {
    return '';
  }
  // Control characters first: this text reaches a committed markdown file and a
  // webview, and stripping after redaction would let a split sequence through.
  const stripped = value.replace(/[\u0000-\u001F\u007F]/g, ' ');
  // Somebody will paste a portal URL with a token in it.
  const redacted = redactSecrets(stripped).text;
  return redacted.replace(/\s+/g, ' ').trim().slice(0, max);
}

function optStr(value: unknown, max: number): string | undefined {
  const text = clampStr(value, max);
  return text.length > 0 ? text : undefined;
}

function isoOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

/**
 * Reject a path that climbs out of the workspace, is absolute, or names a
 * Windows drive. Returns `''` rather than throwing, so a bad entry is dropped
 * individually instead of failing the whole document.
 *
 * Copied in behaviour from `documentsManager.normalizeRelPath` deliberately —
 * a second, weaker path validator is how one of them drifts.
 */
export function normalizeRelPath(value: unknown): string {
  let raw = clampStr(value, MAX_PATH);
  if (!raw) {
    return '';
  }
  if (path.isAbsolute(raw) || /^[a-zA-Z]:[\\/]/.test(raw)) {
    return '';
  }
  raw = raw.replace(/\\/g, '/');
  const normalized = path.posix.normalize(raw).replace(/^\.\/+/, '').replace(/\/+$/, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../')
    || normalized === '..' || normalized.includes('/../')) {
    return '';
  }
  return normalized;
}

const LOOPBACK_HOST = /^(localhost|127(\.\d{1,3}){3}|\[?::1\]?|0\.0\.0\.0)$/i;

/**
 * A locator, or nothing.
 *
 * Three rules beyond the shape. **https only**, no plaintext fallback — a
 * citation is a promise somebody will click. **Query and fragment are
 * stripped**, because an evidence URL carrying a query string is usually a
 * pre-signed link or a session token, and committing one of those to a tracked
 * file is the same class of mistake as committing the report. **Userinfo is
 * refused rather than stripped**: a nearly-valid locator made plausible is
 * worse than a missing one.
 */
export function sanitizeComplianceLocator(value: unknown): ComplianceLocator | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const kind = raw['kind'];

  if (kind === 'workspace-file') {
    const rel = normalizeRelPath(raw['path']);
    return rel ? { kind: 'workspace-file', path: rel } : undefined;
  }

  if (kind === 'url') {
    const text = clampStr(raw['url'], MAX_URL);
    if (!text) {
      return undefined;
    }
    let parsed: URL;
    try {
      parsed = new URL(text);
    } catch {
      return undefined;
    }
    if (parsed.protocol !== 'https:') {
      return undefined;
    }
    if (parsed.username || parsed.password) {
      return undefined;
    }
    if (LOOPBACK_HOST.test(parsed.hostname)) {
      return undefined;
    }
    const clean = `${parsed.origin}${parsed.pathname}`.replace(/\/$/, '') || parsed.origin;
    return { kind: 'url', url: clean, host: parsed.hostname };
  }

  if (kind === 'described') {
    const where = optStr(raw['where'], MAX_LONG);
    return where ? { kind: 'described', where } : undefined;
  }

  return undefined;
}

/**
 * True when a locator points at something a reader could actually obtain.
 *
 * A `described` locator is honest and useful and is still not a document. The
 * grader uses this to hold an artifact- or independence-class control below
 * satisfied when the only thing on record is a note about where the artifact
 * lives.
 */
export function isVerifiableLocator(locator: ComplianceLocator): boolean {
  return locator.kind !== 'described';
}

function sanitizeAttribution(value: unknown): ComplianceAttribution | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const contactId = optStr(raw['contactId'], MAX_FIELD);
  const at = isoOrUndefined(raw['at']);
  if (!contactId || !at) {
    return undefined;
  }
  // An unlabelled source has not earned trust. Coercing the other way would
  // let an unrecognised value read as a human assertion, which is the one
  // direction this must never guess in.
  const source = raw['source'] === 'human' ? 'human' : 'atlas-draft';
  return { contactId, source, at };
}

const EVIDENCE_KINDS: readonly EvidenceKind[] = ['machine-check', 'attestation', 'artifact', 'independent'];

function sanitizeEvidenceKind(value: unknown): EvidenceKind {
  // Coerce to the kind that claims least. `independent` would manufacture
  // assurance out of an unreadable field.
  return EVIDENCE_KINDS.includes(value as EvidenceKind) ? value as EvidenceKind : 'attestation';
}

const CONTROL_STATUSES: readonly ComplianceControlStatus[] = [
  'not-assessed', 'in-progress', 'partial', 'satisfied', 'gap', 'not-applicable',
];

function sanitizeControlStatus(value: unknown): ComplianceControlStatus {
  return CONTROL_STATUSES.includes(value as ComplianceControlStatus)
    ? value as ComplianceControlStatus
    : 'not-assessed';
}

// ── Evidence library ─────────────────────────────────────────────────────

function sanitizeEvidence(value: unknown, used: Set<string>): ComplianceEvidence | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const title = optStr(raw['title'], MAX_FIELD);
  const locator = sanitizeComplianceLocator(raw['locator']);
  const assertedBy = sanitizeAttribution(raw['assertedBy']);
  if (!title || !locator || !assertedBy) {
    return undefined;
  }

  let id = optStr(raw['id'], MAX_FIELD) ?? '';
  if (!/^ev-[A-Za-z0-9][A-Za-z0-9-]{0,60}$/.test(id)) {
    id = `ev-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'record'}`;
  }
  let unique = id;
  let suffix = 2;
  while (used.has(unique)) {
    unique = `${id}-${suffix}`;
    suffix += 1;
  }
  used.add(unique);

  const kind = sanitizeEvidenceKind(raw['kind']);
  const createdAt = isoOrUndefined(raw['createdAt']) ?? assertedBy.at;

  const periodsRaw = Array.isArray(raw['observedPeriods']) ? raw['observedPeriods'] : [];
  const observedPeriods = periodsRaw
    .map(entry => {
      if (typeof entry !== 'object' || entry === null) {
        return undefined;
      }
      const from = isoOrUndefined((entry as Record<string, unknown>)['from']);
      const to = isoOrUndefined((entry as Record<string, unknown>)['to']);
      return from && to && Date.parse(from) <= Date.parse(to) ? { from, to } : undefined;
    })
    .filter((entry): entry is { from: string; to: string } => entry !== undefined)
    .slice(0, 24);

  return {
    id: unique,
    kind,
    title,
    ...(optStr(raw['detail'], MAX_LONG) ? { detail: optStr(raw['detail'], MAX_LONG)! } : {}),
    locator,
    ...(optStr(raw['issuer'], MAX_FIELD) ? { issuer: optStr(raw['issuer'], MAX_FIELD)! } : {}),
    ...(optStr(raw['issuerScope'], MAX_LONG) ? { issuerScope: optStr(raw['issuerScope'], MAX_LONG)! } : {}),
    assertedBy,
    ...(isoOrUndefined(raw['validFrom']) ? { validFrom: isoOrUndefined(raw['validFrom'])! } : {}),
    ...(isoOrUndefined(raw['validUntil']) ? { validUntil: isoOrUndefined(raw['validUntil'])! } : {}),
    ...(observedPeriods.length > 0 ? { observedPeriods } : {}),
    createdAt,
    updatedAt: isoOrUndefined(raw['updatedAt']) ?? createdAt,
    ...(isoOrUndefined(raw['retiredAt']) ? { retiredAt: isoOrUndefined(raw['retiredAt'])! } : {}),
    ...(optStr(raw['retiredNote'], MAX_LONG) ? { retiredNote: optStr(raw['retiredNote'], MAX_LONG)! } : {}),
  };
}

export function sanitizeComplianceEvidenceLibrary(
  value: unknown,
  now: Date = new Date(),
): ComplianceEvidenceLibrary {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const list = Array.isArray(raw['evidence']) ? raw['evidence'] : [];
  const used = new Set<string>();
  const evidence: ComplianceEvidence[] = [];
  for (const entry of list) {
    if (evidence.length >= MAX_EVIDENCE_RECORDS) {
      break;
    }
    const record = sanitizeEvidence(entry, used);
    if (record) {
      evidence.push(record);
    }
  }
  return {
    version: 1,
    evidence,
    updatedAt: isoOrUndefined(raw['updatedAt']) ?? now.toISOString(),
  };
}

export function emptyEvidenceLibrary(now: Date = new Date()): ComplianceEvidenceLibrary {
  return { version: 1, evidence: [], updatedAt: now.toISOString() };
}

// ── Freshness ────────────────────────────────────────────────────────────

export type EvidenceFreshness = 'current' | 'expiring' | 'expired' | 'no-expiry';

/**
 * Derived against `now`, never stored.
 *
 * A persisted `'expired'` is a fact about the day it was written presented as a
 * current one — the same failure the scaffolded mapping's own preamble warns
 * about, and the reason `documentsManager` derives freshness from mtime rather
 * than recording it.
 */
export function evidenceFreshness(
  evidence: ComplianceEvidence,
  now: Date = new Date(),
): EvidenceFreshness {
  if (!evidence.validUntil) {
    return 'no-expiry';
  }
  const until = Date.parse(evidence.validUntil);
  if (!Number.isFinite(until)) {
    return 'no-expiry';
  }
  const ms = until - now.getTime();
  if (ms < 0) {
    return 'expired';
  }
  return ms <= EVIDENCE_FRESHNESS_HORIZON_DAYS * 86_400_000 ? 'expiring' : 'current';
}

export function daysUntilExpiry(evidence: ComplianceEvidence, now: Date = new Date()): number | undefined {
  if (!evidence.validUntil) {
    return undefined;
  }
  const until = Date.parse(evidence.validUntil);
  return Number.isFinite(until) ? Math.floor((until - now.getTime()) / 86_400_000) : undefined;
}

function addMonths(iso: string, months: number): number {
  const base = new Date(Date.parse(iso));
  const moved = new Date(base.getTime());
  moved.setMonth(moved.getMonth() + months);
  return moved.getTime();
}

/**
 * Whether this evidence still counts, for a control with a stated period.
 *
 * Two clocks, and the earlier wins: the item's own stated expiry, and the
 * period the catalog allows for that control. A certificate valid for three
 * years does not make an annual access review three years old acceptable.
 */
export function isEvidenceLive(
  evidence: ComplianceEvidence,
  periodMonths: number,
  now: Date = new Date(),
): boolean {
  if (evidence.retiredAt) {
    return false;
  }
  const asserted = Date.parse(evidence.assertedBy.at);
  if (!Number.isFinite(asserted)) {
    return false;
  }
  const periodEnd = addMonths(evidence.assertedBy.at, periodMonths);
  const stated = evidence.validUntil ? Date.parse(evidence.validUntil) : Number.POSITIVE_INFINITY;
  const effectiveEnd = Math.min(periodEnd, Number.isFinite(stated) ? stated : Number.POSITIVE_INFINITY);
  return now.getTime() <= effectiveEnd;
}

// ── Regime register ──────────────────────────────────────────────────────

const INVARIANT_RULES = {
  reference: 'evidence-reference-missing',
  attribution: 'status-unattributed',
  modelAuthored: 'status-not-human-attributed',
  exclusion: 'exclusion-unjustified',
  unknownControl: 'control-not-in-catalog',
  scopeGate: 'scope-not-decided',
  emptyCatalog: 'regime-has-no-controls',
} as const;

export const COMPLIANCE_INVARIANTS: readonly { readonly id: string; readonly describes: string }[] = [
  { id: INVARIANT_RULES.unknownControl, describes: 'The register names a control this regime does not declare. Evidence recorded against an unknown reference is not evidence about this regime.' },
  { id: INVARIANT_RULES.scopeGate, describes: 'No scope decision is recorded. Until scope is decided the mapping states nothing, so every control reads Not assessed whatever is stored against it.' },
  { id: INVARIANT_RULES.emptyCatalog, describes: 'The regime declares no controls, so there is nothing to assess against and nothing can read as assessed.' },
  { id: INVARIANT_RULES.reference, describes: 'The control cites an evidence record that is not in the library. A reference to something that is not there is not evidence.' },
  { id: INVARIANT_RULES.attribution, describes: 'A status other than Not assessed needs a named person and a date. A status somebody typed is a claim, not evidence.' },
  { id: INVARIANT_RULES.modelAuthored, describes: 'The assertion is recorded as a draft rather than as a person. AtlasMind may draft narrative; it may never assert that a control is met.' },
  { id: INVARIANT_RULES.exclusion, describes: 'Not applicable was recorded without a written justification. An unexplained exclusion is the first thing an assessor challenges, so it is graded as never having been looked at.' },
];

export interface SanitizedRegimeRegister {
  readonly register: ComplianceRegimeRegister;
  readonly demotions: readonly ComplianceDemotion[];
}

function sanitizeTransitions(value: unknown): ComplianceControlTransition[] {
  const list = Array.isArray(value) ? value : [];
  const out: ComplianceControlTransition[] = [];
  for (const entry of list) {
    if (out.length >= MAX_TRANSITIONS_PER_CONTROL || typeof entry !== 'object' || entry === null) {
      continue;
    }
    const raw = entry as Record<string, unknown>;
    const at = isoOrUndefined(raw['at']);
    const by = sanitizeAttribution(raw['by']);
    if (!at || !by) {
      continue;
    }
    out.push({
      at,
      status: sanitizeControlStatus(raw['status']),
      by,
      ...(optStr(raw['note'], MAX_LONG) ? { note: optStr(raw['note'], MAX_LONG)! } : {}),
    });
  }
  return out;
}

function sanitizeScope(value: unknown, catalog: ComplianceRegimeCatalog): ComplianceScope {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const declaredRefs = new Set(catalog.controls.map(control => control.ref));
  const exclusionsRaw = Array.isArray(raw['exclusions']) ? raw['exclusions'] : [];
  const exclusions: { ref: string; reason: string }[] = [];
  for (const entry of exclusionsRaw) {
    if (exclusions.length >= MAX_EXCLUSIONS || typeof entry !== 'object' || entry === null) {
      continue;
    }
    const ref = optStr((entry as Record<string, unknown>)['ref'], MAX_FIELD);
    const reason = optStr((entry as Record<string, unknown>)['reason'], MAX_LONG);
    if (ref && reason && declaredRefs.has(ref)) {
      exclusions.push({ ref, reason });
    }
  }

  const decidedBy = sanitizeAttribution(raw['decidedBy']);
  const statement = optStr(raw['statement'], MAX_LONG);
  const variantRaw = optStr(raw['variant'], MAX_FIELD);
  const variant = variantRaw && (catalog.variants ?? []).includes(variantRaw) ? variantRaw : undefined;

  // A scope decision needs the same attribution a control status does: it is
  // the decision every other row rests on, so an unattributed one would let the
  // whole regime past the gate on nobody's authority.
  const decidedAt = decidedBy?.source === 'human' && statement
    ? isoOrUndefined(raw['decidedAt']) ?? decidedBy.at
    : undefined;

  return {
    ...(statement ? { statement } : {}),
    exclusions,
    ...(decidedAt && decidedBy ? { decidedBy, decidedAt } : {}),
    ...(variant ? { variant } : {}),
    ...(optStr(raw['proposed'], MAX_LONG) ? { proposed: optStr(raw['proposed'], MAX_LONG)! } : {}),
  };
}

/**
 * Apply every read-time invariant, and say what was not accepted.
 *
 * Runs on load as well as save. The demotions are returned rather than logged
 * so the page can state them: a compliance record that silently drops somebody's
 * work is worse than one that explains why it did not take it.
 */
export function sanitizeComplianceRegimeRegister(
  value: unknown,
  regimeId: ComplianceMethodologyId,
  library: ComplianceEvidenceLibrary,
  now: Date = new Date(),
): SanitizedRegimeRegister {
  const catalog = complianceCatalogFor(regimeId);
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const demotions: ComplianceDemotion[] = [];

  if (!catalog) {
    return {
      register: {
        version: 1,
        regimeId,
        regime: regimeId,
        scope: { exclusions: [] },
        controls: [],
        reviews: [],
        updatedAt: now.toISOString(),
      },
      demotions,
    };
  }

  const scope = sanitizeScope(raw['scope'], catalog);
  const scopeDecided = Boolean(scope.decidedAt);
  const liveEvidence = new Map(
    library.evidence.filter(entry => !entry.retiredAt).map(entry => [entry.id, entry]),
  );
  const declared = new Map(catalog.controls.map(control => [control.ref, control]));
  const excluded = new Map(scope.exclusions.map(entry => [entry.ref, entry.reason]));

  const storedRaw = Array.isArray(raw['controls']) ? raw['controls'] : [];
  const stored = new Map<string, Record<string, unknown>>();
  for (const entry of storedRaw) {
    if (stored.size >= MAX_CONTROLS_PER_REGIME || typeof entry !== 'object' || entry === null) {
      continue;
    }
    const ref = optStr((entry as Record<string, unknown>)['ref'], MAX_FIELD);
    if (!ref) {
      continue;
    }
    if (!declared.has(ref)) {
      // Reported, never imported. A row about a control this regime does not
      // declare cannot be a fact about this regime.
      demotions.push({
        ref,
        from: sanitizeControlStatus((entry as Record<string, unknown>)['status']),
        rule: INVARIANT_RULES.unknownControl,
        reason: `${ref} is not a control this regime declares. It may belong to an earlier edition of the standard.`,
      });
      continue;
    }
    stored.set(ref, entry as Record<string, unknown>);
  }

  const controls: ComplianceControlRecord[] = catalog.controls.map(control => {
    const entry = stored.get(control.ref);
    const base = {
      ref: control.ref,
      requirement: control.requirement,
      evidenceIds: [] as string[],
      transitions: [] as ComplianceControlTransition[],
    };
    if (!entry) {
      return { ...base, status: 'not-assessed' as const, provenance: 'seeded' as const };
    }

    const storedStatus = sanitizeControlStatus(entry['status']);
    const assertedBy = sanitizeAttribution(entry['assertedBy']);
    const note = optStr(entry['note'], MAX_LONG);
    const justification = optStr(entry['justification'], MAX_LONG)
      ?? (excluded.get(control.ref) ? excluded.get(control.ref) : undefined);
    const transitions = sanitizeTransitions(entry['transitions']);
    const provenanceRaw = entry['provenance'];
    const provenance = provenanceRaw === 'entered' || provenanceRaw === 'migrated-markdown'
      ? provenanceRaw
      : 'seeded';

    // Invariant 1 — a reference to evidence that is not in the library is not
    // evidence. Dropped rather than repaired, and the drop is what can then
    // pull the status down through invariant 2 in the grader.
    const requestedIds = Array.isArray(entry['evidenceIds']) ? entry['evidenceIds'] : [];
    const evidenceIds: string[] = [];
    let lostReference = false;
    for (const candidate of requestedIds) {
      if (evidenceIds.length >= MAX_EVIDENCE_PER_CONTROL) {
        break;
      }
      const id = optStr(candidate, MAX_FIELD);
      if (!id) {
        continue;
      }
      if (liveEvidence.has(id)) {
        evidenceIds.push(id);
      } else {
        lostReference = true;
      }
    }

    let status = storedStatus;
    const demote = (rule: string, reason: string): void => {
      if (status === 'not-assessed') {
        return;
      }
      demotions.push({ ref: control.ref, from: status, rule, reason });
      status = 'not-assessed';
    };

    if (status !== 'not-assessed') {
      if (lostReference && evidenceIds.length === 0) {
        demote(
          INVARIANT_RULES.reference,
          'Every evidence record this control cited is missing from the library, so nothing supports the status.',
        );
      }
    }
    if (status !== 'not-assessed' && !assertedBy) {
      demote(
        INVARIANT_RULES.attribution,
        'No asserter and date are recorded, so the status is a claim rather than evidence.',
      );
    } else if (status !== 'not-assessed' && assertedBy && assertedBy.source !== 'human') {
      demote(
        INVARIANT_RULES.modelAuthored,
        'The assertion is recorded as a draft rather than as a named person.',
      );
    }
    if (status === 'not-applicable' && !justification) {
      demotions.push({
        ref: control.ref,
        from: 'not-applicable',
        rule: INVARIANT_RULES.exclusion,
        reason: 'Not applicable was recorded with no written justification.',
      });
      status = 'not-assessed';
    }
    // Invariant 6 — the scope gate. Applied last so the more specific reasons
    // above are the ones a reader is shown when both would fire.
    if (!scopeDecided && status !== 'not-assessed') {
      demotions.push({
        ref: control.ref,
        from: status,
        rule: INVARIANT_RULES.scopeGate,
        reason: 'No scope decision is recorded for this regime yet.',
      });
      status = 'not-assessed';
    }

    return {
      ref: control.ref,
      requirement: control.requirement,
      status,
      ...(justification ? { justification } : {}),
      evidenceIds,
      ...(optStr(entry['ownerContactId'], MAX_FIELD) ? { ownerContactId: optStr(entry['ownerContactId'], MAX_FIELD)! } : {}),
      ...(assertedBy ? { assertedBy } : {}),
      ...(note ? { note } : {}),
      transitions,
      ...(isoOrUndefined(entry['lastReviewedAt']) ? { lastReviewedAt: isoOrUndefined(entry['lastReviewedAt'])! } : {}),
      provenance,
    };
  });

  const reviewsRaw = Array.isArray(raw['reviews']) ? raw['reviews'] : [];
  const reviews: ComplianceReview[] = [];
  for (const entry of reviewsRaw) {
    if (reviews.length >= MAX_REVIEWS || typeof entry !== 'object' || entry === null) {
      continue;
    }
    const at = isoOrUndefined((entry as Record<string, unknown>)['at']);
    const by = sanitizeAttribution((entry as Record<string, unknown>)['by']);
    const reviewScope = optStr((entry as Record<string, unknown>)['scope'], MAX_LONG);
    if (at && by && reviewScope) {
      reviews.push({ at, by, scope: reviewScope });
    }
  }

  const importedRaw = raw['importedFrom'];
  const importedAt = typeof importedRaw === 'object' && importedRaw !== null
    ? isoOrUndefined((importedRaw as Record<string, unknown>)['at'])
    : undefined;

  const assessedRaw = raw['assessedAgainst'];
  const assessedName = typeof assessedRaw === 'object' && assessedRaw !== null
    ? optStr((assessedRaw as Record<string, unknown>)['name'], MAX_FIELD)
    : undefined;
  const assessedEdition = typeof assessedRaw === 'object' && assessedRaw !== null
    ? optStr((assessedRaw as Record<string, unknown>)['edition'], MAX_FIELD)
    : undefined;

  return {
    register: {
      version: 1,
      regimeId,
      regime: catalog.regime,
      ...(assessedName && assessedEdition
        ? { assessedAgainst: { name: assessedName, edition: assessedEdition } }
        : {}),
      scope,
      controls,
      reviews,
      ...(importedAt
        ? {
          importedFrom: {
            format: 'markdown-v1' as const,
            at: importedAt,
            demotedRows: Math.max(0, Math.trunc(Number(
              (importedRaw as Record<string, unknown>)['demotedRows'],
            ) || 0)),
          },
        }
        : {}),
      updatedAt: isoOrUndefined(raw['updatedAt']) ?? now.toISOString(),
    },
    demotions,
  };
}

/** A register with every control seeded Not assessed, and no scope decision. */
export function seedComplianceRegister(
  catalog: ComplianceRegimeCatalog,
  now: Date = new Date(),
): ComplianceRegimeRegister {
  return {
    version: 1,
    regimeId: catalog.policyId,
    regime: catalog.regime,
    scope: { exclusions: [] },
    controls: catalog.controls.map(control => ({
      ref: control.ref,
      requirement: control.requirement,
      status: 'not-assessed' as const,
      evidenceIds: [],
      transitions: [],
      provenance: 'seeded' as const,
    })),
    reviews: [],
    updatedAt: now.toISOString(),
  };
}

// ── Predicates ───────────────────────────────────────────────────────────

export function hasScopeDecision(register: ComplianceRegimeRegister | undefined): boolean {
  return Boolean(register?.scope.decidedAt);
}

/**
 * Has anybody assessed a single control?
 *
 * Only a status that survived the invariants counts, which is the point: a
 * register full of unattributed claims has not been assessed, and saying so is
 * the whole of the fix.
 */
export function hasBeenAssessed(register: ComplianceRegimeRegister | undefined): boolean {
  return (register?.controls ?? []).some(control => control.status !== 'not-assessed');
}

export function evidenceById(
  library: ComplianceEvidenceLibrary,
): ReadonlyMap<string, ComplianceEvidence> {
  return new Map(library.evidence.map(entry => [entry.id, entry]));
}

/** Live evidence attached to a control, with the catalog's period applied. */
export function currentEvidenceFor(
  register: ComplianceRegimeRegister,
  controlRef: string,
  library: ComplianceEvidenceLibrary,
  now: Date = new Date(),
): readonly ComplianceEvidence[] {
  const catalog = complianceCatalogFor(register.regimeId);
  const control = catalog?.controls.find(entry => entry.ref === controlRef);
  if (!catalog || !control) {
    return [];
  }
  const period = effectivePeriodMonths(catalog, control, register.scope.variant);
  const byId = evidenceById(library);
  const record = register.controls.find(entry => entry.ref === controlRef);
  return (record?.evidenceIds ?? [])
    .map(id => byId.get(id))
    .filter((entry): entry is ComplianceEvidence => entry !== undefined)
    .filter(entry => isEvidenceLive(entry, period, now));
}

/** Evidence no control in any loaded regime references any more. */
export function orphanedEvidence(
  library: ComplianceEvidenceLibrary,
  registers: readonly ComplianceRegimeRegister[],
): readonly ComplianceEvidence[] {
  const referenced = new Set<string>();
  for (const register of registers) {
    for (const control of register.controls) {
      for (const id of control.evidenceIds) {
        referenced.add(id);
      }
    }
  }
  return library.evidence.filter(entry => !entry.retiredAt && !referenced.has(entry.id));
}

/** Which controls an evidence record is doing work for, across every regime. */
export function evidenceUsage(
  evidenceId: string,
  registers: readonly ComplianceRegimeRegister[],
): readonly { readonly regimeId: ComplianceMethodologyId; readonly controlRef: string }[] {
  const out: { regimeId: ComplianceMethodologyId; controlRef: string }[] = [];
  for (const register of registers) {
    for (const control of register.controls) {
      if (control.evidenceIds.includes(evidenceId)) {
        out.push({ regimeId: register.regimeId, controlRef: control.ref });
      }
    }
  }
  return out;
}

// ── Reading and writing ──────────────────────────────────────────────────

function readJson(root: string, relative: string): unknown | undefined {
  try {
    return JSON.parse(readFileSync(path.join(root, relative), 'utf8'));
  } catch {
    return undefined;
  }
}

export function readComplianceEvidenceFile(
  workspaceRoot: string,
): VersionedDocumentRead<ComplianceEvidenceLibrary> {
  const parsed = readJson(workspaceRoot, COMPLIANCE_EVIDENCE_SSOT_PATH);
  if (parsed === undefined) {
    return { preserveExisting: false };
  }
  return interpretVersionedDocument('compliance-evidence', parsed, isEvidenceLibrary);
}

function isEvidenceLibrary(value: unknown): value is ComplianceEvidenceLibrary {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate['version'] === 1 && Array.isArray(candidate['evidence']);
}

export function readComplianceRegimeFile(
  workspaceRoot: string,
  regimeId: ComplianceMethodologyId,
): VersionedDocumentRead<ComplianceRegimeRegister> {
  const parsed = readJson(workspaceRoot, complianceRegimePath(regimeId));
  if (parsed === undefined) {
    return { preserveExisting: false };
  }
  return interpretVersionedDocument('compliance-regime', parsed, isRegimeRegister);
}

function isRegimeRegister(value: unknown): value is ComplianceRegimeRegister {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate['version'] === 1
    && typeof candidate['regimeId'] === 'string'
    && Array.isArray(candidate['controls']);
}

export function readComplianceHistory(workspaceRoot: string): ComplianceHistoryEntry[] {
  const parsed = readJson(workspaceRoot, COMPLIANCE_HISTORY_SSOT_PATH);
  return Array.isArray(parsed) ? parsed as ComplianceHistoryEntry[] : [];
}

export function appendComplianceHistory(workspaceRoot: string, entry: ComplianceHistoryEntry): void {
  const history = readComplianceHistory(workspaceRoot);
  history.unshift(entry);
  const target = path.join(workspaceRoot, COMPLIANCE_HISTORY_SSOT_PATH);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(history.slice(0, MAX_COMPLIANCE_HISTORY), null, 2)}\n`, 'utf8');
}

export function writeComplianceEvidenceLibrary(
  workspaceRoot: string,
  library: ComplianceEvidenceLibrary,
  registers: readonly ComplianceRegimeRegister[],
  now: Date = new Date(),
): void {
  const stamped: ComplianceEvidenceLibrary = { ...library, updatedAt: now.toISOString() };
  const dir = path.join(workspaceRoot, COMPLIANCE_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(workspaceRoot, COMPLIANCE_EVIDENCE_SSOT_PATH),
    `${JSON.stringify(stamped, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    path.join(workspaceRoot, COMPLIANCE_EVIDENCE_SUMMARY_PATH),
    renderComplianceEvidenceMarkdown(stamped, registers, now),
    'utf8',
  );
}

/** Read the hand-written notes file, if there is one. Never created here. */
export function readComplianceNotes(
  workspaceRoot: string,
  regimeId: ComplianceMethodologyId,
): string | undefined {
  try {
    return readFileSync(path.join(workspaceRoot, complianceRegimeNotesPath(regimeId)), 'utf8');
  } catch {
    return undefined;
  }
}

export function complianceNotesExist(
  workspaceRoot: string,
  regimeId: ComplianceMethodologyId,
): boolean {
  return existsSync(path.join(workspaceRoot, complianceRegimeNotesPath(regimeId)));
}

// ── The notes file ───────────────────────────────────────────────────────

export interface AbsorbedNotes {
  /** Regime-level sections, keyed by their normalised heading. */
  readonly sections: ReadonlyMap<string, string>;
  /** Per-control prose, keyed by control ref. */
  readonly perControl: ReadonlyMap<string, string>;
  /** Headings that matched no slot and no declared ref, kept rather than dropped. */
  readonly unmatched: readonly { readonly heading: string; readonly body: string; readonly why: string }[];
}

/** The regime-level headings the generated mirror has a place for. */
export const NOTES_SECTION_SLOTS = ['context', 'assessor narrative', 'remediation plan'] as const;

/**
 * Read the hand-written notes file into prose blocks.
 *
 * **Narrative only, and that is structural.** A merge that could carry a status
 * would mean parsing hand-edited markdown for grades, which is exactly the
 * failure this whole feature removes. Nothing this function returns can reach a
 * control's status, its evidence, or any date the grader computes on.
 *
 * A leading `|` is neutralised on every line, so pasted prose cannot render as
 * a control row and make the generated document lie to a human reader even
 * though it could never change a grade.
 *
 * An unmatched heading is kept and reported. Silently dropping somebody's prose
 * is the one behaviour this file must not have.
 */
export function absorbComplianceNotes(
  markdown: string | undefined,
  catalog: ComplianceRegimeCatalog,
): AbsorbedNotes {
  const sections = new Map<string, string>();
  const perControl = new Map<string, string>();
  const unmatched: { heading: string; body: string; why: string }[] = [];
  if (!markdown) {
    return { sections, perControl, unmatched };
  }

  const declaredRefs = new Map(
    catalog.controls.map(control => [control.ref.toLowerCase(), control.ref]),
  );

  let currentHeading: { level: number; text: string } | undefined;
  let buffer: string[] = [];

  const flush = (): void => {
    if (!currentHeading) {
      buffer = [];
      return;
    }
    const body = buffer.join('\n').trim();
    buffer = [];
    if (!body) {
      return;
    }
    const clean = clampStr(body.replace(/^\s*\|/gm, '\\|'), MAX_LONG);
    if (!clean) {
      return;
    }
    const key = currentHeading.text.toLowerCase();
    if (currentHeading.level === 2 && (NOTES_SECTION_SLOTS as readonly string[]).includes(key)) {
      sections.set(key, clean);
      return;
    }
    const ref = declaredRefs.get(key);
    if (currentHeading.level >= 3 && ref) {
      perControl.set(ref, clean);
      return;
    }
    unmatched.push({
      heading: currentHeading.text,
      body: clean,
      why: currentHeading.level >= 3
        ? `${currentHeading.text} is not a control this regime declares.`
        : `"${currentHeading.text}" is not one of the sections the mirror has a place for.`,
    });
  };

  for (const line of markdown.split('\n')) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      const text = clampStr(heading[2]!.replace(/[`*_]/g, ''), MAX_FIELD);
      currentHeading = level === 1 ? undefined : { level, text };
      continue;
    }
    if (currentHeading) {
      buffer.push(line);
    }
  }
  flush();

  return { sections, perControl, unmatched };
}

/** The header seeded into a new notes file. Create-only; never rewritten. */
export function complianceNotesTemplate(catalog: ComplianceRegimeCatalog): string {
  const example = catalog.controls[0]?.ref ?? 'CONTROL-REF';
  return [
    `# ${catalog.regime} — your notes`,
    '',
    `This file is yours. AtlasMind reads it and folds it into \`${catalog.policyId}.md\`, and never`,
    'writes over it. It is the one document here you edit by hand.',
    '',
    '**It carries prose, never decisions.** Nothing written here changes a control status, an',
    'evidence record, or a date. Statuses are set on the Compliance page, where they are recorded',
    'against a named person and a date — which is what makes them worth anything.',
    '',
    'Three headings have a place in the generated document:',
    '',
    '## Context',
    '',
    'What somebody reading this regime needs to know first — the shape of the business, the',
    'jurisdictions it reaches, anything that makes the mapping below read differently.',
    '',
    '## Assessor narrative',
    '',
    'The story you would tell an assessor before they start reading rows.',
    '',
    '## Remediation plan',
    '',
    'What is outstanding, who is doing it, and by when.',
    '',
    `Below that, a \`###\` heading naming a control reference puts a note beside that control:`,
    '',
    `### ${example}`,
    '',
    'Whatever a reader of this control should know that the status alone does not say.',
    '',
    'A heading that matches none of these is kept and shown under "Additional notes" rather than',
    'dropped — but it will not appear beside a control.',
    '',
  ].join('\n');
}

// ── Mirrors ──────────────────────────────────────────────────────────────

function fence(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function evidenceLine(
  evidence: ComplianceEvidence,
  now: Date,
): string {
  const freshness = evidenceFreshness(evidence, now);
  const where = evidence.locator.kind === 'workspace-file'
    ? `\`${evidence.locator.path}\``
    : evidence.locator.kind === 'url'
      ? evidence.locator.host
      : 'held elsewhere';
  const validity = evidence.validUntil
    ? `${freshness === 'expired' ? 'expired' : 'valid until'} ${evidence.validUntil.slice(0, 10)}`
    : 'no stated expiry';
  return `${fence(evidence.title)} (${EVIDENCE_KIND_LABEL[evidence.kind]}, ${where}, ${validity})`;
}

/**
 * The document somebody hands an assessor.
 *
 * Generated from the JSON beside it, absorbing the hand-written notes file. The
 * reading is passed in rather than computed here, so the grader stays pure and
 * this module stays free of grading rules that could drift from it.
 */
export function renderComplianceRegimeMarkdown(
  register: ComplianceRegimeRegister,
  library: ComplianceEvidenceLibrary,
  catalog: ComplianceRegimeCatalog,
  options: {
    readonly notes?: AbsorbedNotes;
    readonly readingLabel?: string;
    readonly readingRule?: string;
    readonly disclaimer: string;
    readonly standard?: { readonly name: string; readonly edition: string; readonly verifiedAt: string };
    readonly demotions?: readonly ComplianceDemotion[];
  },
  now: Date = new Date(),
): string {
  const byId = evidenceById(library);
  const lines: string[] = [];

  lines.push(`# ${catalog.regime} — control mapping`, '');
  lines.push(`**Regime:** ${catalog.regime}`, '');
  lines.push(
    '> Generated by AtlasMind from the JSON file beside this one, which is the source of truth.',
    `> Your own prose belongs in \`${catalog.policyId}-user-edit.md\`, which is never overwritten`,
    '> and is folded into this document.',
    '',
  );
  lines.push(`> ${options.disclaimer}`, '');

  if (options.readingLabel) {
    lines.push(`**Reading:** ${options.readingLabel}`);
    if (options.readingRule) {
      lines.push('', `_${options.readingRule}_`);
    }
    lines.push('');
  }

  if (options.standard) {
    lines.push(
      `**Assessed against:** ${options.standard.name} ${options.standard.edition}. `
      + `AtlasMind last verified this control set on ${options.standard.verifiedAt.slice(0, 10)}.`,
      '',
    );
  }
  if (register.assessedAgainst
    && options.standard
    && register.assessedAgainst.edition !== options.standard.edition) {
    lines.push(
      `> **This assessment was made against ${register.assessedAgainst.name} `
      + `${register.assessedAgainst.edition}**, and AtlasMind now models `
      + `${options.standard.edition}. An assessment made against a different edition is about a `
      + 'different document; the rows below have not been re-pointed at the newer control set.',
      '',
    );
  }

  const context = options.notes?.sections.get('context');
  if (context) {
    lines.push('## Context', '', '<!-- from the notes file -->', '', context, '');
  }

  lines.push('## Scope', '');
  lines.push(catalog.scoping, '');
  if (register.scope.decidedAt && register.scope.statement) {
    lines.push(`**Decided ${register.scope.decidedAt.slice(0, 10)}.** ${register.scope.statement}`, '');
    if (register.scope.variant) {
      lines.push(`**Variant:** ${register.scope.variant}`, '');
    }
  } else {
    lines.push(
      '**No scope decision is recorded.** Until one is, every control below reads *Not assessed* '
      + 'whatever has been entered against it — a mapping filled in before anybody decided what is '
      + 'in scope looks complete and answers nothing.',
      '',
    );
    if (register.scope.proposed) {
      lines.push('A draft is on file and has not been adopted:', '', `> ${register.scope.proposed}`, '');
    }
  }
  if (register.scope.exclusions.length > 0) {
    lines.push('### Excluded from scope', '');
    lines.push('| Ref | Justification |', '|---|---|');
    for (const exclusion of register.scope.exclusions) {
      lines.push(`| \`${exclusion.ref}\` | ${fence(exclusion.reason)} |`);
    }
    lines.push('');
  }

  lines.push('## Controls', '');
  lines.push(
    'A status is only recorded here once a named person asserted it on a date. A status with no '
    + 'asserter is not carried across — it is a claim, not evidence.',
    '',
  );

  const recordByRef = new Map(register.controls.map(control => [control.ref, control]));
  for (const theme of COMPLIANCE_THEME_ORDER) {
    const controls = catalog.controls.filter(control => control.theme === theme);
    if (controls.length === 0) {
      continue;
    }
    lines.push(`### ${COMPLIANCE_THEME_LABEL[theme]}`, '');
    lines.push('| Ref | Requirement | What would settle it | Status | Evidence | Owner |', '|---|---|---|---|---|---|');
    for (const control of controls) {
      const record = recordByRef.get(control.ref);
      const accepts = effectiveAccepts(control, register.scope.variant)
        .map(kind => EVIDENCE_KIND_LABEL[kind]).join(' or ');
      const evidence = (record?.evidenceIds ?? [])
        .map(id => byId.get(id))
        .filter((entry): entry is ComplianceEvidence => entry !== undefined)
        .map(entry => evidenceLine(entry, now));
      lines.push([
        '',
        `\`${control.ref}\``,
        fence(control.requirement),
        accepts,
        COMPLIANCE_CONTROL_STATUS_LABEL[record?.status ?? 'not-assessed'],
        evidence.length > 0 ? evidence.join('; ') : '_none recorded_',
        record?.ownerContactId ? fence(record.ownerContactId) : '_unassigned_',
        '',
      ].join(' | ').trim());
    }
    lines.push('');
    for (const control of controls) {
      const note = options.notes?.perControl.get(control.ref);
      const record = recordByRef.get(control.ref);
      if (note) {
        lines.push(`> **${control.ref} — your note.** ${note}`, '');
      }
      if (record?.justification) {
        lines.push(`> **${control.ref} — not applicable.** ${record.justification}`, '');
      }
    }
  }

  const outstanding = catalog.controls.filter(control => requiresIndependence(control, register.scope.variant));
  if (outstanding.length > 0) {
    lines.push('## Controls only an outside party can close', '');
    lines.push(
      'Nothing this project produces about itself satisfies these. They are listed separately '
      + 'because a mapping that is otherwise complete still stops short of assurance while any of '
      + 'them is outstanding.',
      '',
    );
    for (const control of outstanding) {
      const record = recordByRef.get(control.ref);
      lines.push(
        `- \`${control.ref}\` — ${control.requirement} `
        + `(${COMPLIANCE_CONTROL_STATUS_LABEL[record?.status ?? 'not-assessed']})`,
      );
    }
    lines.push('');
  } else if (catalog.noIndependentControl) {
    lines.push('## Outside assurance', '', catalog.noIndependentControl, '');
  }

  const narrative = options.notes?.sections.get('assessor narrative');
  if (narrative) {
    lines.push('## Assessor narrative', '', '<!-- from the notes file -->', '', narrative, '');
  }
  const remediation = options.notes?.sections.get('remediation plan');
  if (remediation) {
    lines.push('## Remediation plan', '', '<!-- from the notes file -->', '', remediation, '');
  }

  if (options.demotions && options.demotions.length > 0) {
    lines.push('## Statuses not accepted on read', '');
    lines.push(
      'These were stored with a status AtlasMind could not accept. Nothing was deleted — the '
      + 'wording is kept on the control — but they read as *Not assessed* until the missing piece '
      + 'is supplied.',
      '',
    );
    lines.push('| Ref | Was | Why |', '|---|---|---|');
    for (const demotion of options.demotions.slice(0, 60)) {
      lines.push(`| \`${demotion.ref}\` | ${COMPLIANCE_CONTROL_STATUS_LABEL[demotion.from]} | ${fence(demotion.reason)} |`);
    }
    lines.push('');
  }

  if (register.reviews.length > 0) {
    lines.push('## Review log', '');
    lines.push('| Date | Scope | By |', '|---|---|---|');
    for (const review of register.reviews.slice(0, 40)) {
      lines.push(`| ${review.at.slice(0, 10)} | ${fence(review.scope)} | ${fence(review.by.contactId)} |`);
    }
    lines.push('');
  }

  const unmatched = options.notes?.unmatched ?? [];
  if (unmatched.length > 0) {
    lines.push('## Additional notes', '');
    lines.push(
      'From the notes file, under headings that matched no section and no control reference. '
      + 'Kept here rather than dropped.',
      '',
    );
    for (const entry of unmatched) {
      lines.push(`### ${fence(entry.heading)}`, '', `_${entry.why}_`, '', entry.body, '');
    }
  }

  lines.push('---', '');
  lines.push(`_Generated ${now.toISOString().slice(0, 10)}. Do not edit this file; edit \`${catalog.policyId}-user-edit.md\`._`, '');
  return lines.join('\n');
}

export function renderComplianceEvidenceMarkdown(
  library: ComplianceEvidenceLibrary,
  registers: readonly ComplianceRegimeRegister[],
  now: Date = new Date(),
): string {
  const lines: string[] = [];
  lines.push('# Compliance evidence', '');
  lines.push(
    '> Generated by AtlasMind from `compliance-evidence.json`, which is the source of truth.',
    '',
  );
  lines.push(
    'Every record here is a **reference** to something held elsewhere. AtlasMind never copies an '
    + 'artifact into this repository and never reads one: `project_memory/` is tracked by git, and '
    + 'a certificate, an audit report or a signed agreement committed here would go to everyone who '
    + 'can clone it.',
    '',
  );

  const live = library.evidence.filter(entry => !entry.retiredAt);
  if (live.length === 0) {
    lines.push('No evidence has been recorded yet.', '');
  } else {
    lines.push('| Record | Kind | Where | Issued by | Valid until | Used by |', '|---|---|---|---|---|---|');
    for (const entry of live) {
      const usage = evidenceUsage(entry.id, registers);
      const where = entry.locator.kind === 'workspace-file'
        ? `\`${entry.locator.path}\``
        : entry.locator.kind === 'url'
          ? entry.locator.host
          : 'held elsewhere';
      const freshness = evidenceFreshness(entry, now);
      const validity = entry.validUntil
        ? `${entry.validUntil.slice(0, 10)}${freshness === 'expired' ? ' **(expired)**' : freshness === 'expiring' ? ' (expiring)' : ''}`
        : '_none stated_';
      lines.push([
        '',
        fence(entry.title),
        EVIDENCE_KIND_LABEL[entry.kind],
        where,
        entry.issuer ? fence(entry.issuer) : '—',
        validity,
        usage.length > 0 ? `${usage.length} control${usage.length === 1 ? '' : 's'}` : '_nothing_',
        '',
      ].join(' | ').trim());
    }
    lines.push('');
  }

  const retired = library.evidence.filter(entry => entry.retiredAt);
  if (retired.length > 0) {
    lines.push('## Retired', '');
    lines.push(
      'Retained rather than deleted. The evidence was real for the period it covered, and an '
      + 'assessor may ask about that period.',
      '',
    );
    for (const entry of retired) {
      lines.push(`- ${fence(entry.title)} — retired ${entry.retiredAt!.slice(0, 10)}${entry.retiredNote ? `: ${fence(entry.retiredNote)}` : ''}`);
    }
    lines.push('');
  }

  lines.push(
    `_Generated ${now.toISOString().slice(0, 10)}. History is capped at the most recent `
    + `${MAX_COMPLIANCE_HISTORY} entries._`,
    '',
  );
  return lines.join('\n');
}
