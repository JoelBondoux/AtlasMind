/**
 * The research register — what a scan found about the world outside this
 * repository, and what a human decided about it.
 *
 * Shaped after `riskOversightManager`, because that module already solved this
 * problem: findings transition rather than disappear, the grade comes from a
 * published rule table, the JSON is the source of truth and the markdown is a
 * mirror, and the whole thing is `fs`-only so it can be tested without a running
 * editor. What is different here is where the evidence comes from, and that
 * difference is the entire security story.
 *
 * **A finding carries a citation or it is not a finding.** A model asked about a
 * market will answer, fluently and specifically, and the answer is
 * indistinguishable from a researched one. Written into `project_memory/` — which
 * is git-tracked — and read six weeks later by somebody deciding what to build, it
 * is indistinguishable from evidence. So the citation check lives in
 * {@link sanitizeIncomingFindings}, not in a prompt: a prompt is a request, a
 * sanitizer is a guarantee. An uncited claim is not discarded — it is recorded as
 * a `question`, which is a perfectly good thing to have written down and a
 * perfectly bad thing to plan against.
 *
 * **Derive, don't mirror.** The register stores a claim and the URL it came from.
 * It never stores the page. `project_memory/` is committed, and mirroring a
 * competitor's site into this repository would be a licensing problem wearing a
 * feature's clothes — the same rule `buzzInboundDerivation` applies to colleagues'
 * messages, for the same reason.
 *
 * **A decision outlives the scan that prompted it.** Reconciliation supersedes an
 * `open` finding the latest scan did not reproduce, because the world moved. It
 * never supersedes one somebody accepted, actioned or dismissed, because that
 * would quietly undo a human judgement — and `superseded` and `dismissed` stay
 * distinct statuses for the same reason the debt register keeps `resolved` and
 * `obsolete` apart: one says the world changed, the other says a person
 * disagreed, and collapsing them reports a judgement nobody made.
 *
 * `fs`-only. No `vscode`, no network — fetching belongs to the skills layer, and
 * this module only ever sees what came back.
 */

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { interpretVersionedDocument, type VersionedDocumentRead } from './schemaMigration.js';
import { redactSecrets } from '../utils/secretRedactor.js';
import {
  gradeResearchFinding,
  isResearchGradeRefusal,
  isResearchScanId,
  NO_CITATION_RULE,
  RESEARCH_SCANS,
  renderResearchCatalogTable,
  renderResearchRuleTable,
  researchScan,
  type ResearchScanId,
  type ResearchSeverity,
} from './researchScanCatalog.js';

export const RESEARCH_SSOT_PATH = 'project_memory/analysis/research.json';
export const RESEARCH_SUMMARY_SSOT_PATH = 'project_memory/analysis/research.md';
export const RESEARCH_HISTORY_SSOT_PATH = 'project_memory/analysis/research-history.json';

const MAX_FIELD = 240;
const MAX_LONG = 2000;
const MAX_URL = 500;
/** Findings retained. Matches the risk register: transitions mean nothing is lost to churn. */
export const MAX_RESEARCH_FINDINGS = 500;
/** Citations kept per finding. Past this it is a bibliography, not evidence. */
export const MAX_CITATIONS_PER_FINDING = 6;
export const MAX_RESEARCH_HISTORY = 1000;

// ── Model ────────────────────────────────────────────────────────────

/**
 * `finding` carries a citation. `question` does not, and is therefore never
 * counted as evidence, charted, or summarised as something that changed.
 */
export type ResearchFindingClass = 'finding' | 'question';

export type ResearchFindingStatus =
  | 'open'
  | 'accepted'
  | 'actioned'
  | 'superseded'
  | 'dismissed';

/** Statuses a human chose. Reconciliation must not overwrite one. */
const HUMAN_DECIDED: readonly ResearchFindingStatus[] = ['accepted', 'actioned', 'dismissed'];

export interface ResearchCitation {
  readonly url: string;
  /** Derived from the URL. Distinct hosts are what "corroborated" means. */
  readonly host: string;
  readonly title?: string;
  readonly fetchedAt: string;
}

export interface ResearchTransition {
  readonly at: string;
  readonly status: ResearchFindingStatus;
  readonly note?: string;
}

export interface ResearchFinding {
  readonly id: string;
  readonly scanId: ResearchScanId;
  readonly kind: ResearchFindingClass;
  readonly title: string;
  readonly detail: string;
  readonly severity: ResearchSeverity;
  /** The declared rule that graded it, carried so the grade can be argued with. */
  readonly rule: string;
  readonly citations: readonly ResearchCitation[];
  /** A stated deadline or end-of-life date, when the finding carries one. */
  readonly deadline?: string;
  readonly status: ResearchFindingStatus;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly transitions: readonly ResearchTransition[];
  /** Set once the finding has become a card on the ideation board. */
  readonly derivedCardId?: string;
}

/** Why a scan produced nothing, when it produced nothing. */
export type ResearchRunOutcome = 'ok' | 'no-source' | 'failed';

export interface ResearchScanRun {
  readonly scanId: ResearchScanId;
  readonly ranAt: string;
  readonly outcome: ResearchRunOutcome;
  readonly findingCount: number;
  readonly questionCount: number;
  /**
   * What this run could not assess, stated rather than omitted. A hybrid scan
   * with no external source fills this in; so does a failed fetch.
   */
  readonly unassessed?: string;
  /** Which source answered, so a thin result can be attributed. */
  readonly source?: string;
  readonly costUsd?: number;
}

export interface ResearchRegister {
  readonly version: 1;
  readonly findings: readonly ResearchFinding[];
  readonly runs: readonly ResearchScanRun[];
  readonly updatedAt: string;
}

// ── Seeding ──────────────────────────────────────────────────────────

/** A fresh register. Nothing has been scanned, which is unknown rather than clean. */
export function seedResearchRegister(now: Date = new Date()): ResearchRegister {
  return { version: 1, findings: [], runs: [], updatedAt: now.toISOString() };
}

// ── Persistence ──────────────────────────────────────────────────────

export function readResearchRegister(workspaceRoot: string): ResearchRegister | undefined {
  return readResearchRegisterFile(workspaceRoot).config;
}

/**
 * Read the register, distinguishing "no usable file" from "a file this build must
 * not touch" — the distinction `interpretVersionedDocument` exists for. Both look
 * like `undefined` to a plain reader, and seeding over the second destroys a newer
 * build's work.
 */
export function readResearchRegisterFile(workspaceRoot: string): VersionedDocumentRead<ResearchRegister> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path.join(workspaceRoot, RESEARCH_SSOT_PATH), 'utf8'));
  } catch {
    return { preserveExisting: false };
  }
  return interpretVersionedDocument('research', parsed, isResearchRegister);
}

export async function writeResearchRegister(
  workspaceRoot: string,
  register: ResearchRegister,
  now: Date = new Date(),
): Promise<void> {
  const configPath = path.join(workspaceRoot, RESEARCH_SSOT_PATH);
  const summaryPath = path.join(workspaceRoot, RESEARCH_SUMMARY_SSOT_PATH);
  await mkdir(path.dirname(configPath), { recursive: true });
  const updated: ResearchRegister = { ...register, updatedAt: now.toISOString() };
  await Promise.all([
    writeFile(configPath, JSON.stringify(updated, null, 2), 'utf-8'),
    writeFile(summaryPath, renderResearchMarkdown(updated), 'utf-8'),
  ]);
}

export interface ResearchHistoryEntry {
  readonly id: string;
  readonly kind: 'scan-run' | 'transition' | 'derived';
  readonly summary: string;
  readonly scanId?: ResearchScanId;
  readonly at: string;
}

export function readResearchHistory(workspaceRoot: string): ResearchHistoryEntry[] {
  try {
    const raw = readFileSync(path.join(workspaceRoot, RESEARCH_HISTORY_SSOT_PATH), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ResearchHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

/** Append newest-first, capped. The mirror states the cap rather than truncating silently. */
export async function appendResearchHistory(
  workspaceRoot: string,
  entry: ResearchHistoryEntry,
): Promise<void> {
  const file = path.join(workspaceRoot, RESEARCH_HISTORY_SSOT_PATH);
  const history = readResearchHistory(workspaceRoot);
  history.unshift(entry);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(history.slice(0, MAX_RESEARCH_HISTORY), null, 2), 'utf-8');
}

// ── Boundary: model output and fetched text ──────────────────────────

function clampStr(value: unknown, max = MAX_FIELD): string {
  if (typeof value !== 'string') {
    return '';
  }
  // Control characters are stripped before anything else: this text is rendered
  // into markdown and into webview HTML, and a fetched page is exactly as
  // untrusted as an issue body.
  const stripped = value.replace(/[\u0000-\u001F\u007F]/g, ' ');
  return redactSecrets(stripped).text.replace(/\s+/g, ' ').trim().slice(0, max);
}

function optStr(value: unknown, max = MAX_FIELD): string | undefined {
  const trimmed = clampStr(value, max);
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * A citation, or nothing.
 *
 * `https` only, and no fallback to `http`. A citation is a *retrieval promise* —
 * somebody will click it to check the claim — and a plaintext one made from a
 * scan we ran is a promise we should not make. A URL that does not parse is
 * dropped rather than repaired: a nearly-valid citation made plausible is worse
 * than a missing one.
 */
export function sanitizeCitation(value: unknown, fallbackFetchedAt: string): ResearchCitation | undefined {
  if (typeof value !== 'object' || value === null) {
    // A bare string is the shape models produce most often, so it is accepted.
    if (typeof value === 'string') {
      return sanitizeCitation({ url: value }, fallbackFetchedAt);
    }
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const rawUrl = clampStr(candidate['url'], MAX_URL);
  if (rawUrl === '') {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:') {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase();
  if (host === '') {
    return undefined;
  }
  const fetchedAt = normalizeIso(candidate['fetchedAt']) ?? fallbackFetchedAt;
  const title = optStr(candidate['title']);
  return { url: parsed.toString().slice(0, MAX_URL), host, fetchedAt, ...(title ? { title } : {}) };
}

function normalizeIso(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

/**
 * Pull findings out of a model reply without throwing.
 *
 * The advisor is asked for a fenced JSON block. It may not produce one, may
 * produce prose around it, or may produce something else entirely — and none of
 * those is an error worth surfacing as a stack trace. Mirrors `parseRiskFindings`.
 */
export function parseResearchFindings(response: string): unknown[] {
  if (typeof response !== 'string' || response.trim() === '') {
    return [];
  }
  const blocks: string[] = [];
  for (const match of response.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) {
    if (match[1]) {
      blocks.push(match[1]);
    }
  }
  // A reply that is nothing but JSON is also valid, and common from smaller models.
  blocks.push(response);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (trimmed === '') {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (typeof parsed === 'object' && parsed !== null) {
      const findings = (parsed as Record<string, unknown>)['findings'];
      if (Array.isArray(findings)) {
        return findings;
      }
    }
  }
  return [];
}

/** The join key. Same shape as the roadmap's, and for the same reason: ids move, text does not. */
export function normalizeResearchTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();
}

export function researchFindingId(scanId: ResearchScanId, title: string): string {
  const slug = normalizeResearchTitle(title)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return `${scanId}-${slug === '' ? 'untitled' : slug}`;
}

export interface SanitizeFindingsOptions {
  /**
   * Titles already on this project's roadmap, normalized. Used by the severity
   * rule that asks whether a competitor covers something we also claim — a fact
   * about *our* repository, computed by the caller, never asserted by a model.
   */
  readonly roadmapTitles?: ReadonlySet<string>;
}

export interface SanitizedFindings {
  /** Cited claims, graded. */
  readonly findings: readonly ResearchFinding[];
  /** Uncited claims, kept as questions rather than discarded. */
  readonly questions: readonly ResearchFinding[];
  /** Entries too malformed to record at all, counted rather than silently dropped. */
  readonly unreadable: number;
}

/**
 * Turn raw model output into records.
 *
 * The citation check is here, and it is the reason this function returns two
 * lists instead of one. Demoting rather than discarding matters: an analyst's
 * hunch is worth writing down, and the register's job is to make sure nobody
 * mistakes it for a source.
 */
export function sanitizeIncomingFindings(
  raw: readonly unknown[],
  scanId: ResearchScanId,
  now: Date,
  options: SanitizeFindingsOptions = {},
): SanitizedFindings {
  const findings: ResearchFinding[] = [];
  const questions: ResearchFinding[] = [];
  const seen = new Set<string>();
  let unreadable = 0;
  const stamp = now.toISOString();

  for (const entry of raw.slice(0, MAX_RESEARCH_FINDINGS)) {
    if (typeof entry !== 'object' || entry === null) {
      unreadable += 1;
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    const title = clampStr(candidate['title']);
    if (title === '') {
      unreadable += 1;
      continue;
    }
    const id = researchFindingId(scanId, title);
    if (seen.has(id)) {
      // The same claim twice in one reply is one claim.
      continue;
    }
    seen.add(id);

    const rawCitations = Array.isArray(candidate['citations']) ? candidate['citations'] : [];
    const citations: ResearchCitation[] = [];
    const citedUrls = new Set<string>();
    for (const rawCitation of rawCitations) {
      const citation = sanitizeCitation(rawCitation, stamp);
      if (citation && !citedUrls.has(citation.url)) {
        citedUrls.add(citation.url);
        citations.push(citation);
      }
      if (citations.length >= MAX_CITATIONS_PER_FINDING) {
        break;
      }
    }

    const deadline = normalizeIso(candidate['deadline']);
    const grade = gradeResearchFinding(
      {
        scanId,
        citationHosts: new Set(citations.map(citation => citation.host)).size,
        ...(deadline ? { deadline } : {}),
        overlapsRoadmap: options.roadmapTitles?.has(normalizeResearchTitle(title)) ?? false,
      },
      now,
    );

    const base = {
      id,
      scanId,
      title,
      detail: clampStr(candidate['detail'], MAX_LONG),
      citations,
      ...(deadline ? { deadline } : {}),
      status: 'open' as const,
      firstSeenAt: stamp,
      lastSeenAt: stamp,
      transitions: [] as readonly ResearchTransition[],
    };

    if (isResearchGradeRefusal(grade)) {
      // Not evidence. Recorded so the thought is not lost, and marked so nobody
      // plans against it.
      questions.push({ ...base, kind: 'question', severity: 'low', rule: NO_CITATION_RULE });
    } else {
      findings.push({ ...base, kind: 'finding', severity: grade.severity, rule: grade.rule });
    }
  }

  return { findings, questions, unreadable };
}

// ── Reconciliation ───────────────────────────────────────────────────

export interface ReconcileResult {
  readonly findings: readonly ResearchFinding[];
  readonly added: number;
  readonly updated: number;
  readonly superseded: number;
}

/**
 * Merge one scan's results into the register.
 *
 * Three rules, and the second is the one that matters:
 *
 * 1. A match updates in place — new citations, a fresh grade, a new `lastSeenAt` —
 *    and keeps the finding's history.
 * 2. **A human decision is never overwritten.** An `open` finding this scan did
 *    not reproduce becomes `superseded`; an `accepted`, `actioned` or `dismissed`
 *    one is left exactly as it is. Auto-superseding a decision would quietly undo
 *    it, and the register's whole claim is that it is a complete account of what
 *    was decided.
 * 3. Only this scan's findings are touched. A competition run has nothing to say
 *    about what the regulatory scan found.
 */
export function reconcileScanFindings(
  existing: readonly ResearchFinding[],
  incoming: readonly ResearchFinding[],
  scanId: ResearchScanId,
  now: Date,
): ReconcileResult {
  const stamp = now.toISOString();
  const incomingById = new Map(incoming.map(finding => [finding.id, finding]));
  const kept: ResearchFinding[] = [];
  let updated = 0;
  let superseded = 0;

  for (const finding of existing) {
    if (finding.scanId !== scanId) {
      kept.push(finding);
      continue;
    }
    const match = incomingById.get(finding.id);
    if (match) {
      incomingById.delete(finding.id);
      kept.push({
        ...finding,
        kind: match.kind,
        title: match.title,
        detail: match.detail,
        severity: match.severity,
        rule: match.rule,
        citations: match.citations,
        ...(match.deadline ? { deadline: match.deadline } : {}),
        lastSeenAt: stamp,
        // A finding that had been superseded and has come back is open again;
        // a human decision stands.
        status: finding.status === 'superseded' ? 'open' : finding.status,
      });
      updated += 1;
      continue;
    }
    if (!HUMAN_DECIDED.includes(finding.status) && finding.status === 'open') {
      kept.push({
        ...finding,
        status: 'superseded',
        transitions: [
          ...finding.transitions,
          { at: stamp, status: 'superseded', note: 'A later scan did not reproduce this.' },
        ],
      });
      superseded += 1;
      continue;
    }
    kept.push(finding);
  }

  const added = [...incomingById.values()];
  return {
    findings: [...added, ...kept].slice(0, MAX_RESEARCH_FINDINGS),
    added: added.length,
    updated,
    superseded,
  };
}

/**
 * Record a human decision.
 *
 * Returns the register unchanged when the id is unknown, rather than throwing:
 * the caller is usually a webview message, and an unknown id is a stale view, not
 * a fault.
 */
export function transitionResearchFinding(
  register: ResearchRegister,
  findingId: string,
  status: ResearchFindingStatus,
  now: Date,
  note?: string,
): ResearchRegister {
  const stamp = now.toISOString();
  let changed = false;
  const findings = register.findings.map(finding => {
    if (finding.id !== findingId || finding.status === status) {
      return finding;
    }
    changed = true;
    return {
      ...finding,
      status,
      transitions: [...finding.transitions, { at: stamp, status, ...(note ? { note: clampStr(note, MAX_LONG) } : {}) }],
    };
  });
  return changed ? { ...register, findings, updatedAt: stamp } : register;
}

/** Link a finding to the card it became, so provenance runs in both directions. */
export function recordDerivedCard(
  register: ResearchRegister,
  findingId: string,
  cardId: string,
  now: Date,
): ResearchRegister {
  const stamp = now.toISOString();
  let changed = false;
  const findings = register.findings.map(finding => {
    if (finding.id !== findingId) {
      return finding;
    }
    changed = true;
    return {
      ...finding,
      derivedCardId: clampStr(cardId, MAX_FIELD),
      status: 'actioned' as const,
      transitions: [
        ...finding.transitions,
        { at: stamp, status: 'actioned' as const, note: 'Raised onto the ideation board.' },
      ],
    };
  });
  return changed ? { ...register, findings, updatedAt: stamp } : register;
}

// ── Reads ────────────────────────────────────────────────────────────

/** Findings still awaiting a decision. Questions are never included — they are not evidence. */
export function openResearchFindings(register: ResearchRegister): readonly ResearchFinding[] {
  return register.findings.filter(finding => finding.kind === 'finding' && finding.status === 'open');
}

export function researchQuestions(register: ResearchRegister): readonly ResearchFinding[] {
  return register.findings.filter(finding => finding.kind === 'question' && finding.status === 'open');
}

export function lastRunFor(register: ResearchRegister, scanId: ResearchScanId): ResearchScanRun | undefined {
  return register.runs
    .filter(run => run.scanId === scanId)
    .sort((a, b) => Date.parse(b.ranAt) - Date.parse(a.ranAt))[0];
}

/**
 * Has this scan ever produced an answer?
 *
 * A `no-source` or `failed` run is **not** an assessment. Counting it as one is
 * exactly the failure mode the attention feed's fifth rule exists to prevent:
 * silence earned by not looking.
 */
export function hasBeenScanned(register: ResearchRegister, scanId: ResearchScanId): boolean {
  return register.runs.some(run => run.scanId === scanId && run.outcome === 'ok');
}

export function recordScanRun(register: ResearchRegister, run: ResearchScanRun): ResearchRegister {
  return {
    ...register,
    // One run per scan is kept as the current state; the audit trail lives in
    // the history file, which is append-only and capped.
    runs: [...register.runs.filter(entry => entry.scanId !== run.scanId), run],
    updatedAt: run.ranAt,
  };
}

// ── Validation ───────────────────────────────────────────────────────

function isResearchRegister(value: unknown): value is ResearchRegister {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate['version'] === 1
    && Array.isArray(candidate['findings'])
    && Array.isArray(candidate['runs']);
}

const STATUSES: readonly ResearchFindingStatus[] = ['open', 'accepted', 'actioned', 'superseded', 'dismissed'];
const SEVERITIES: readonly ResearchSeverity[] = ['low', 'medium', 'high'];
const OUTCOMES: readonly ResearchRunOutcome[] = ['ok', 'no-source', 'failed'];

/**
 * Coerce a persisted register into something safe to render.
 *
 * The file is git-tracked and hand-editable, so this is a boundary like any
 * other. An unrecognised status coerces to `open` rather than being dropped:
 * losing a finding is worse than losing a decision, and an `open` finding is
 * visible enough that the loss will be noticed.
 */
export function sanitizeResearchRegister(value: unknown, now: Date = new Date()): ResearchRegister {
  const stamp = now.toISOString();
  if (typeof value !== 'object' || value === null) {
    return seedResearchRegister(now);
  }
  const candidate = value as Record<string, unknown>;
  const rawFindings = Array.isArray(candidate['findings']) ? candidate['findings'] : [];
  const rawRuns = Array.isArray(candidate['runs']) ? candidate['runs'] : [];

  const findings: ResearchFinding[] = [];
  for (const raw of rawFindings.slice(0, MAX_RESEARCH_FINDINGS)) {
    if (typeof raw !== 'object' || raw === null) {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const scanId = entry['scanId'];
    const title = clampStr(entry['title']);
    if (!isResearchScanId(scanId) || title === '') {
      continue;
    }
    const citations: ResearchCitation[] = [];
    const rawCitations = Array.isArray(entry['citations']) ? entry['citations'] : [];
    for (const rawCitation of rawCitations.slice(0, MAX_CITATIONS_PER_FINDING)) {
      const citation = sanitizeCitation(rawCitation, stamp);
      if (citation) {
        citations.push(citation);
      }
    }
    const status = STATUSES.includes(entry['status'] as ResearchFindingStatus)
      ? entry['status'] as ResearchFindingStatus
      : 'open';
    const severity = SEVERITIES.includes(entry['severity'] as ResearchSeverity)
      ? entry['severity'] as ResearchSeverity
      : 'low';
    // A record claiming to be a finding with no citation is demoted, not trusted.
    // The file is editable, and this is the one invariant that must not be
    // editable away.
    const kind: ResearchFindingClass = citations.length > 0 && entry['kind'] !== 'question' ? 'finding' : 'question';
    const deadline = normalizeIso(entry['deadline']);
    const derivedCardId = optStr(entry['derivedCardId']);
    const transitions: ResearchTransition[] = [];
    const rawTransitions = Array.isArray(entry['transitions']) ? entry['transitions'] : [];
    for (const rawTransition of rawTransitions.slice(0, 50)) {
      if (typeof rawTransition !== 'object' || rawTransition === null) {
        continue;
      }
      const transition = rawTransition as Record<string, unknown>;
      const at = normalizeIso(transition['at']);
      const transitionStatus = transition['status'];
      if (!at || !STATUSES.includes(transitionStatus as ResearchFindingStatus)) {
        continue;
      }
      const note = optStr(transition['note'], MAX_LONG);
      transitions.push({ at, status: transitionStatus as ResearchFindingStatus, ...(note ? { note } : {}) });
    }
    findings.push({
      id: optStr(entry['id']) ?? researchFindingId(scanId, title),
      scanId,
      kind,
      title,
      detail: clampStr(entry['detail'], MAX_LONG),
      severity: kind === 'question' ? 'low' : severity,
      rule: kind === 'question' ? NO_CITATION_RULE : (optStr(entry['rule'], MAX_LONG) ?? 'ungraded — rule not recorded'),
      citations,
      ...(deadline ? { deadline } : {}),
      status,
      firstSeenAt: normalizeIso(entry['firstSeenAt']) ?? stamp,
      lastSeenAt: normalizeIso(entry['lastSeenAt']) ?? stamp,
      transitions,
      ...(derivedCardId ? { derivedCardId } : {}),
    });
  }

  const runs: ResearchScanRun[] = [];
  for (const raw of rawRuns.slice(0, RESEARCH_SCANS.length * 4)) {
    if (typeof raw !== 'object' || raw === null) {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const scanId = entry['scanId'];
    const ranAt = normalizeIso(entry['ranAt']);
    if (!isResearchScanId(scanId) || !ranAt) {
      continue;
    }
    const outcome = OUTCOMES.includes(entry['outcome'] as ResearchRunOutcome)
      ? entry['outcome'] as ResearchRunOutcome
      // An unreadable outcome is not an assessment. Coercing it to `ok` would
      // make an unreadable file look like a clean bill of health.
      : 'failed';
    const unassessed = optStr(entry['unassessed'], MAX_LONG);
    const source = optStr(entry['source']);
    const costUsd = typeof entry['costUsd'] === 'number' && Number.isFinite(entry['costUsd'])
      ? Math.max(0, entry['costUsd'] as number)
      : undefined;
    runs.push({
      scanId,
      ranAt,
      outcome,
      findingCount: toCount(entry['findingCount']),
      questionCount: toCount(entry['questionCount']),
      ...(unassessed ? { unassessed } : {}),
      ...(source ? { source } : {}),
      ...(costUsd === undefined ? {} : { costUsd }),
    });
  }

  return {
    version: 1,
    findings,
    runs,
    updatedAt: normalizeIso(candidate['updatedAt']) ?? stamp,
  };
}

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

// ── The mirror ───────────────────────────────────────────────────────

const SEVERITY_ORDER: Readonly<Record<ResearchSeverity, number>> = { high: 0, medium: 1, low: 2 };

/**
 * The human-readable register.
 *
 * Publishes the rule table and the catalog, because a grade nobody can check is a
 * number to be trusted — and states what has *not* been scanned, because a
 * register that only lists what it found reads as a complete picture.
 */
export function renderResearchMarkdown(register: ResearchRegister): string {
  const lines: string[] = [
    '# Research register',
    '',
    '> Generated by AtlasMind. The JSON beside this file is the source of truth.',
    '> **Findings are advisory.** Every one carries the URL it came from and the declared rule that',
    '> graded it, so both can be checked. A claim with no citation is recorded as a *question*, never',
    '> as evidence.',
    '',
    `_Last updated: ${register.updatedAt}_`,
    '',
  ];

  const open = openResearchFindings(register);
  const questions = researchQuestions(register);

  lines.push('## Coverage', '');
  lines.push('| Scan | Last run | Outcome | Open findings |', '|---|---|---|---|');
  for (const scan of RESEARCH_SCANS) {
    const run = lastRunFor(register, scan.id);
    const openCount = open.filter(finding => finding.scanId === scan.id).length;
    lines.push(
      `| \`${scan.id}\` | ${run ? run.ranAt.slice(0, 10) : '— never'} | ${run ? run.outcome : 'not assessed'} | ${openCount} |`,
    );
  }
  lines.push('');

  const unassessed = RESEARCH_SCANS.filter(scan => !hasBeenScanned(register, scan.id));
  if (unassessed.length > 0) {
    lines.push(
      `**${unassessed.length} of ${RESEARCH_SCANS.length} scans have never produced an answer.** `
      + 'Unknown rather than clear: '
      + unassessed.map(scan => `\`${scan.id}\``).join(', ') + '.',
      '',
    );
  }

  for (const run of register.runs) {
    if (run.unassessed) {
      lines.push(`- \`${run.scanId}\` could not assess: ${run.unassessed}`);
    }
  }
  if (register.runs.some(run => run.unassessed)) {
    lines.push('');
  }

  lines.push('## Open findings', '');
  if (open.length === 0) {
    lines.push('_None recorded._', '');
  } else {
    const ordered = [...open].sort((a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
      || Date.parse(a.firstSeenAt) - Date.parse(b.firstSeenAt));
    for (const finding of ordered) {
      lines.push(`### ${finding.title}`, '');
      lines.push(`- **Scan:** \`${finding.scanId}\` · **Severity:** \`${finding.severity}\` · **Rule:** ${finding.rule}`);
      lines.push(`- **First seen:** ${finding.firstSeenAt.slice(0, 10)} · **Last confirmed:** ${finding.lastSeenAt.slice(0, 10)}`);
      if (finding.deadline) {
        lines.push(`- **Stated date:** ${finding.deadline.slice(0, 10)}`);
      }
      if (finding.detail) {
        lines.push('', finding.detail);
      }
      lines.push('', '**Sources**', '');
      for (const citation of finding.citations) {
        lines.push(`- [${citation.title ?? citation.host}](${citation.url}) — fetched ${citation.fetchedAt.slice(0, 10)}`);
      }
      lines.push('');
    }
  }

  if (questions.length > 0) {
    lines.push(
      '## Questions to research',
      '',
      '_Recorded without a source. These are **not** evidence and are deliberately kept out of the',
      'findings above — they are worth investigating, not worth planning against._',
      '',
    );
    for (const question of questions) {
      lines.push(`- **${question.title}** — \`${question.scanId}\``);
    }
    lines.push('');
  }

  lines.push('## How a finding is graded', '', renderResearchRuleTable(), '');
  lines.push('## The scan catalog', '', renderResearchCatalogTable(), '');
  lines.push(
    `_History is capped at ${MAX_RESEARCH_HISTORY} entries and findings at ${MAX_RESEARCH_FINDINGS}._`,
    '',
  );
  return lines.join('\n');
}

/** The scan's own brief, for a prompt. Kept here so callers do not re-derive it. */
export function researchScanBrief(scanId: ResearchScanId): string {
  return researchScan(scanId).brief;
}

/**
 * The register's lifetime, held for the extension host.
 *
 * Mirrors `RiskOversightManager` exactly, including the `preserveExisting`
 * distinction that matters more than it looks: a file written by a *newer*
 * AtlasMind is intact and readable by that build, and seeding a default over it
 * would destroy real work. "No file" and "a file I must not touch" are different
 * answers that both look like `undefined` to a plain reader.
 */
export class ResearchRegisterManager {
  private register: ResearchRegister | undefined;
  private preserveExisting = false;
  private notice: string | undefined;

  constructor(private readonly workspaceRoot: string | undefined) {
    this.applyRead();
  }

  private applyRead(): void {
    if (!this.workspaceRoot) {
      this.register = undefined;
      this.preserveExisting = false;
      this.notice = undefined;
      return;
    }
    const read = readResearchRegisterFile(this.workspaceRoot);
    this.register = read.config;
    this.preserveExisting = read.preserveExisting;
    this.notice = read.notice;
  }

  getNotice(): string | undefined {
    return this.notice;
  }

  getRegister(): ResearchRegister | undefined {
    return this.register;
  }

  hasRegister(): boolean {
    return this.register !== undefined;
  }

  reload(): ResearchRegister | undefined {
    this.applyRead();
    return this.register;
  }

  /**
   * An in-memory empty register, **not written to disk**.
   *
   * Deliberately different from the risk manager's `ensureSeeded`. This file
   * gets committed, and creating `project_memory/analysis/research.json` because
   * somebody opened a tab would put a file in their repository they never asked
   * for — the same reason `workflowConfig` is never seeded on render. It is
   * written the first time a scan actually records something.
   */
  ensureLoaded(now: Date = new Date()): ResearchRegister {
    if (!this.register) {
      this.register = seedResearchRegister(now);
    }
    return this.register;
  }

  async save(register: ResearchRegister): Promise<void> {
    this.register = register;
    if (this.workspaceRoot && !this.preserveExisting) {
      await writeResearchRegister(this.workspaceRoot, register);
    }
  }
}
