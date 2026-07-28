/**
 * SecurityReviewManager — models a project's **security register**: the weaknesses
 * the security reviewer raised across four areas, and what a human decided about each.
 *
 * It is the security counterpart to {@link ./riskOversightManager}, and deliberately
 * the same shape: a *record*, not an enforcement gate. Nothing here blocks a commit, a
 * promotion, or a release; a review only ever runs because the user asked for one on
 * the Project Dashboard → Security page. Findings transition rather than disappear, so
 * the register stays a complete account, with a bounded append-only audit trail beside
 * it in `security-review-history.json`.
 *
 * Three things it deliberately is **not**:
 * - not a vulnerability scanner — it reasons about the code, it does not execute it,
 *   and it makes no claim of completeness;
 * - not {@link ./skillScanner}, which discovers workspace *tools*;
 * - not the Data Privacy gate, which redacts at runtime. This looks at the codebase.
 *
 * Findings originate as **model output**, untrusted like any other boundary:
 * {@link parseSecurityFindings} never throws on absent or malformed JSON, and
 * {@link sanitizeSecurityFindings} clamps every string, coerces every enum to a safe
 * default, and rejects path traversal in cited evidence before anything reaches disk.
 *
 * Free of the `vscode` API (node `fs` only) so seeding, sanitisation, scoring, and
 * serialisation are unit-testable in isolation. No secret VALUES are ever stored —
 * only labels, prose, and workspace-relative paths.
 */

import * as path from 'node:path';
import { interpretVersionedDocument, type VersionedDocumentRead } from './schemaMigration.js';
import { readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import type {
  SecurityAreaRun,
  SecurityConfidence,
  SecurityExploitability,
  SecurityFinding,
  SecurityFindingStatus,
  SecurityReviewArea,
  SecurityReviewConfig,
  SecurityReviewHistoryEntry,
  SecuritySeverity,
} from '../types.js';

export const SECURITY_REVIEW_SSOT_PATH = 'project_memory/operations/security-review.json';
export const SECURITY_REVIEW_SUMMARY_SSOT_PATH = 'project_memory/operations/security-review.md';
export const SECURITY_REVIEW_HISTORY_SSOT_PATH = 'project_memory/operations/security-review-history.json';

export const SECURITY_REVIEW_AREAS: readonly SecurityReviewArea[] = ['secrets', 'boundaries', 'dependencies', 'permissions'];

/**
 * A security review goes stale faster than a risk assessment: dependencies move,
 * and the code under review changes every week. 45 days rather than risk's 90.
 */
export const SECURITY_REVIEW_STALE_DAYS = 45;

const SEVERITIES: SecuritySeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
const EXPLOITABILITIES: SecurityExploitability[] = ['low', 'medium', 'high'];
const CONFIDENCES: SecurityConfidence[] = ['low', 'medium', 'high'];
const STATUSES: SecurityFindingStatus[] = ['open', 'accepted', 'mitigated', 'closed', 'dismissed'];
const ORIGINS = ['review', 'gap-analysis'] as const;

const MAX_FIELD = 240;
const MAX_LONG = 2000;
const MAX_PATH = 400;
const MAX_FINDINGS = 500;
const MAX_EVIDENCE = 12;

/** Retained audit records; matches the risk register's cap for the same reasons. */
export const MAX_SECURITY_REVIEW_HISTORY = 1000;

/** Statuses that still represent live, unowned exposure. */
const UNRESOLVED_STATUSES: readonly SecurityFindingStatus[] = ['open'];

// ── Area profiles ────────────────────────────────────────────────

/**
 * What each area covers, in the reviewer's words and the user's.
 *
 * `checklist` is the answer to "it found nothing — what did it actually look for?".
 * It is shown on the page *and* injected into the prompt, from this one definition,
 * so what the page claims was checked and what the reviewer was asked to check cannot
 * drift apart. Restating it in two places is exactly how that guarantee is lost.
 */
export interface SecurityAreaProfile {
  label: string;
  /** One sentence, shown under the area card. */
  coverage: string;
  /** The specific checks. Shown in the disclosure and sent in the prompt. */
  checklist: readonly string[];
}

export const SECURITY_AREA_PROFILE: Record<SecurityReviewArea, SecurityAreaProfile> = {
  secrets: {
    label: 'Secrets & credentials',
    coverage: 'Where credentials live, how they reach a provider, and whether they can leak into logs, settings, memory files, or model context.',
    checklist: [
      'API keys and tokens held in secret storage rather than settings, source, or committed files',
      'Redaction applied before prompts, logs, error messages, and telemetry leave the process',
      'No secret values written into project memory, caches, or generated markdown mirrors',
      'Credential-bearing config (.env, wrangler.toml, CI variables) read for names only',
      'Nothing secret embedded in webview HTML, which is a separate document the user can inspect',
    ],
  },
  boundaries: {
    label: 'Trust boundaries',
    coverage: 'Every point where untrusted input enters — chat, webview messages, workspace files, model output, tool parameters — and whether it is validated before it is acted on.',
    checklist: [
      'Webview messages validated before they mutate configuration, touch secrets, or invoke commands',
      'User and model-supplied paths rejected for traversal, absolute paths, and drive letters',
      'Model output treated as untrusted: parsed defensively, never executed or trusted as markup',
      'HTML escaped at the point of interpolation, and webview scripts nonce-protected with no inline handlers',
      'Network responses (registries, catalogs, sync endpoints) shape-checked and screened for SSRF',
    ],
  },
  dependencies: {
    label: 'Dependencies & supply chain',
    coverage: 'What the project pulls in, whether those versions are pinned and current, and what a compromised package could reach.',
    checklist: [
      'A lockfile is committed and the declared ranges are pinned rather than floating',
      'No dependency with a known advisory left un-triaged, and no abandoned or unmaintained package in the runtime path',
      'Install and build scripts reviewed — postinstall hooks run with full user privilege',
      'Downloaded binaries and models verified by checksum before execution',
      'The distinction between runtime and dev dependencies holds, so dev tooling does not ship',
    ],
  },
  permissions: {
    label: 'Permissions & execution',
    coverage: 'What can run, write, or reach the network without asking — and whether the defaults are the safe ones.',
    checklist: [
      'Destructive and outbound actions confirm first, and confirmation is not bypassable by configuration alone',
      'Terminal and filesystem writes are denied by default and scoped to the workspace',
      'Tool approval cannot be satisfied by model output alone — a human decides',
      'Spawned processes take no untrusted input in their command line, and are tied to the host lifetime',
      'Declared extension capabilities and activation events are no broader than the features need',
    ],
  },
};

// ── History ──────────────────────────────────────────────────────

export function readSecurityReviewHistory(workspaceRoot: string): SecurityReviewHistoryEntry[] {
  try {
    const raw = readFileSync(path.join(workspaceRoot, SECURITY_REVIEW_HISTORY_SSOT_PATH), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as SecurityReviewHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

/** Append an audit record (newest first), capped at {@link MAX_SECURITY_REVIEW_HISTORY}. */
export async function appendSecurityReviewHistory(
  workspaceRoot: string,
  entry: SecurityReviewHistoryEntry,
): Promise<void> {
  const file = path.join(workspaceRoot, SECURITY_REVIEW_HISTORY_SSOT_PATH);
  const history = readSecurityReviewHistory(workspaceRoot);
  history.unshift(entry);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(history.slice(0, MAX_SECURITY_REVIEW_HISTORY), null, 2), 'utf-8');
}

// ── Seeding ──────────────────────────────────────────────────────

/** A fresh, empty register. Security is "not yet reviewed" until the reviewer runs. */
export function seedSecurityReviewConfig(): SecurityReviewConfig {
  return { version: 1, findings: [], runs: [], updatedAt: new Date().toISOString() };
}

// ── Persistence (node fs; vscode-free) ───────────────────────────

export function readSecurityReviewConfig(workspaceRoot: string): SecurityReviewConfig | undefined {
  return readSecurityReviewFile(workspaceRoot).config;
}

/**
 * Read the security review register, distinguishing "no usable file" from "a file this build
 * must not touch".
 *
 * `preserveExisting` is true when the file was written by a *newer* AtlasMind.
 * It is intact and readable by that build, so seeding a default over it would
 * destroy real work — and the plain reader cannot say so, because both cases
 * look like `undefined`.
 */
export function readSecurityReviewFile(workspaceRoot: string): VersionedDocumentRead<SecurityReviewConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path.join(workspaceRoot, SECURITY_REVIEW_SSOT_PATH), 'utf8'));
  } catch {
    // Absent or unparseable: there is nothing to preserve.
    return { preserveExisting: false };
  }
  return interpretVersionedDocument('security-review', parsed, isSecurityReviewConfig);
}

/**
 * Persist the register as JSON (source of truth) and regenerate the human-readable
 * markdown mirror alongside it. Both live in `project_memory/operations/`.
 */
export async function writeSecurityReviewConfig(workspaceRoot: string, config: SecurityReviewConfig): Promise<void> {
  const configPath = path.join(workspaceRoot, SECURITY_REVIEW_SSOT_PATH);
  const summaryPath = path.join(workspaceRoot, SECURITY_REVIEW_SUMMARY_SSOT_PATH);
  await mkdir(path.dirname(configPath), { recursive: true });
  const updated: SecurityReviewConfig = { ...config, updatedAt: new Date().toISOString() };
  await Promise.all([
    writeFile(configPath, JSON.stringify(updated, null, 2), 'utf-8'),
    writeFile(summaryPath, renderSecurityReviewMarkdown(updated), 'utf-8'),
  ]);
}

// ── Validation / sanitisation ────────────────────────────────────

function isSecurityReviewConfig(value: unknown): value is SecurityReviewConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate['version'] === 1
    && Array.isArray(candidate['findings'])
    && Array.isArray(candidate['runs']);
}

function clampStr(value: unknown, max = MAX_FIELD): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function optStr(value: unknown, max = MAX_FIELD): string | undefined {
  const trimmed = clampStr(value, max);
  return trimmed.length > 0 ? trimmed : undefined;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || String(Date.now());
}

/**
 * Coerce a model/user-supplied path to a safe, workspace-relative POSIX path, or `''`
 * if it escapes the workspace. This is the security boundary for cited evidence:
 * absolute paths, drive letters, `..` traversal, and backslashes are rejected or
 * normalised so a recorded finding can never point outside the project.
 */
export function normalizeEvidencePath(value: unknown): string {
  let raw = clampStr(value, MAX_PATH);
  if (!raw) {
    return '';
  }
  if (path.isAbsolute(raw) || /^[a-zA-Z]:[\\/]/.test(raw)) {
    return '';
  }
  raw = raw.replace(/\\/g, '/');
  const normalized = path.posix.normalize(raw).replace(/^\.\/+/, '').replace(/\/+$/, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized === '..' || normalized.includes('/../')) {
    return '';
  }
  return normalized;
}

function sanitizeArea(value: unknown): SecurityReviewArea | undefined {
  const raw = clampStr(value, 40).toLowerCase() as SecurityReviewArea;
  return SECURITY_REVIEW_AREAS.includes(raw) ? raw : undefined;
}

/**
 * Unknown severity coerces to `medium`.
 *
 * Not to `info`, which would let a malformed or adversarial response silently
 * zero-weight itself out of the score, and not to `critical`, which would let noise
 * dominate the page. `medium` is the choice that neither hides nor shouts.
 */
function sanitizeSeverity(value: unknown): SecuritySeverity {
  const raw = clampStr(value, 40).toLowerCase() as SecuritySeverity;
  return SEVERITIES.includes(raw) ? raw : 'medium';
}

function sanitizeExploitability(value: unknown): SecurityExploitability {
  const raw = clampStr(value, 40).toLowerCase() as SecurityExploitability;
  return EXPLOITABILITIES.includes(raw) ? raw : 'medium';
}

/** Unknown confidence coerces to `low`: an unlabelled claim has not earned trust. */
function sanitizeConfidence(value: unknown): SecurityConfidence {
  const raw = clampStr(value, 40).toLowerCase() as SecurityConfidence;
  return CONFIDENCES.includes(raw) ? raw : 'low';
}

/** Unknown status coerces to `open`: never silently resolve a finding. */
function sanitizeStatus(value: unknown): SecurityFindingStatus {
  const raw = clampStr(value, 40).toLowerCase() as SecurityFindingStatus;
  return STATUSES.includes(raw) ? raw : 'open';
}

function sanitizeOrigin(value: unknown): SecurityFinding['origin'] | undefined {
  const raw = clampStr(value, 40).toLowerCase() as NonNullable<SecurityFinding['origin']>;
  return ORIGINS.includes(raw) ? raw : undefined;
}

function sanitizeIsoDate(value: unknown, fallback: string): string {
  const raw = clampStr(value, 40);
  if (!raw) {
    return fallback;
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString();
}

function sanitizeEvidence(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  for (const item of value.slice(0, MAX_EVIDENCE * 4)) {
    const clean = normalizeEvidencePath(item);
    if (clean) {
      seen.add(clean);
    }
    if (seen.size >= MAX_EVIDENCE) {
      break;
    }
  }
  return [...seen];
}

/**
 * Coerce one untrusted finding into a well-formed {@link SecurityFinding}. Returns
 * `undefined` when there is no usable area or title — a finding with neither cannot be
 * shown or scored meaningfully.
 */
function sanitizeFinding(input: unknown, usedIds: Set<string>, now: string): SecurityFinding | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const raw = input as Record<string, unknown>;
  const area = sanitizeArea(raw['area']);
  const title = clampStr(raw['title'], MAX_FIELD);
  if (!area || !title) {
    return undefined;
  }

  let id = clampStr(raw['id'], 80) || `${area}-${slugify(title)}`;
  while (usedIds.has(id)) {
    id = `${id}-${usedIds.size}`;
  }
  usedIds.add(id);

  const raisedAt = sanitizeIsoDate(raw['raisedAt'], now);
  const origin = sanitizeOrigin(raw['origin']);
  return {
    id,
    area,
    title,
    detail: clampStr(raw['detail'], MAX_LONG),
    severity: sanitizeSeverity(raw['severity']),
    exploitability: sanitizeExploitability(raw['exploitability']),
    confidence: sanitizeConfidence(raw['confidence']),
    status: sanitizeStatus(raw['status']),
    evidence: sanitizeEvidence(raw['evidence']),
    ...(optStr(raw['recommendation'], MAX_LONG) ? { recommendation: optStr(raw['recommendation'], MAX_LONG) } : {}),
    ...(origin ? { origin } : {}),
    raisedAt,
    ...(optStr(raw['updatedAt'], 40) ? { updatedAt: sanitizeIsoDate(raw['updatedAt'], raisedAt) } : {}),
    ...(optStr(raw['statusNote'], MAX_LONG) ? { statusNote: optStr(raw['statusNote'], MAX_LONG) } : {}),
  };
}

/**
 * Sanitise a list of untrusted findings (the model-output boundary). Bad entries are
 * dropped individually rather than failing the batch, and ids are made collision-safe.
 */
export function sanitizeSecurityFindings(input: unknown): SecurityFinding[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const now = new Date().toISOString();
  const usedIds = new Set<string>();
  const findings: SecurityFinding[] = [];
  for (const item of input.slice(0, MAX_FINDINGS)) {
    const clean = sanitizeFinding(item, usedIds, now);
    if (clean) {
      findings.push(clean);
    }
  }
  return findings;
}

/**
 * Extract the finding array from a raw model response.
 *
 * This is the model-output boundary and it must never throw: the reviewer may fence
 * its JSON, emit it bare, surround it with prose, wrap it in a `findings` key, or
 * produce nothing parseable at all. Anything it cannot understand degrades to `[]` so
 * the caller records no findings rather than failing the run. Shape, enum, and path
 * validation happen afterwards in {@link sanitizeSecurityFindings} — this only
 * locates candidate JSON.
 */
export function parseSecurityFindings(response: unknown): unknown[] {
  if (typeof response !== 'string' || response.trim().length === 0) {
    return [];
  }

  const candidates: string[] = [];
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (let match = fencePattern.exec(response); match !== null; match = fencePattern.exec(response)) {
    const body = match[1]?.trim();
    if (body) {
      candidates.push(body);
    }
  }
  for (const [open, close] of [['[', ']'], ['{', '}']] as const) {
    const start = response.indexOf(open);
    const end = response.lastIndexOf(close);
    if (start !== -1 && end > start) {
      candidates.push(response.slice(start, end + 1));
    }
  }

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
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

/**
 * Merge freshly-reviewed findings for one area into the existing register.
 *
 * A re-run must not duplicate what is already recorded, and must not silently undo a
 * human decision: when an incoming finding matches one on file, the prose and severity
 * are refreshed but the existing `status`, `statusNote`, `origin`, and `raisedAt` are
 * preserved. Findings the reviewer no longer reports are kept — they are history, not
 * noise, and only a human closes them.
 */
export function mergeAreaFindings(
  existing: SecurityFinding[],
  incoming: SecurityFinding[],
  area: SecurityReviewArea,
): SecurityFinding[] {
  const now = new Date().toISOString();
  const byKey = new Map<string, SecurityFinding>();
  for (const finding of existing) {
    byKey.set(`${finding.area}::${finding.title.toLowerCase()}`, finding);
  }

  const merged = [...existing];
  for (const finding of incoming) {
    if (finding.area !== area) {
      continue;
    }
    const key = `${finding.area}::${finding.title.toLowerCase()}`;
    const prior = byKey.get(key);
    if (!prior) {
      merged.push({ ...finding, raisedAt: finding.raisedAt || now, updatedAt: now });
      byKey.set(key, finding);
      continue;
    }
    const index = merged.indexOf(prior);
    if (index !== -1) {
      merged[index] = {
        ...prior,
        detail: finding.detail || prior.detail,
        severity: finding.severity,
        exploitability: finding.exploitability,
        confidence: finding.confidence,
        evidence: finding.evidence.length > 0 ? finding.evidence : prior.evidence,
        ...(finding.recommendation ? { recommendation: finding.recommendation } : {}),
        updatedAt: now,
      };
    }
  }
  return merged.slice(0, MAX_FINDINGS);
}

/**
 * Coerce an untrusted payload into a well-formed {@link SecurityReviewConfig}.
 * Returns `undefined` when the top-level shape is wrong.
 */
export function sanitizeSecurityReviewConfig(input: unknown): SecurityReviewConfig | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const raw = input as Record<string, unknown>;
  if (raw['version'] !== 1 || !Array.isArray(raw['findings']) || !Array.isArray(raw['runs'])) {
    return undefined;
  }

  const now = new Date().toISOString();
  const findings = sanitizeSecurityFindings(raw['findings']);

  const seenAreas = new Set<SecurityReviewArea>();
  const runs: SecurityAreaRun[] = [];
  for (const item of (raw['runs'] as unknown[]).slice(0, SECURITY_REVIEW_AREAS.length * 4)) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const r = item as Record<string, unknown>;
    const area = sanitizeArea(r['area']);
    if (!area || seenAreas.has(area)) {
      continue;
    }
    seenAreas.add(area);
    const count = typeof r['findingCount'] === 'number' && Number.isFinite(r['findingCount'])
      ? Math.max(0, Math.min(MAX_FINDINGS, Math.round(r['findingCount'])))
      : 0;
    runs.push({ area, ranAt: sanitizeIsoDate(r['ranAt'], now), findingCount: count });
  }

  return { version: 1, findings, runs, updatedAt: now };
}

// ── Derivations (pure) ───────────────────────────────────────────

/** Findings that still represent live exposure (i.e. nobody has decided about them). */
export function openSecurityFindings(config: SecurityReviewConfig): SecurityFinding[] {
  return config.findings.filter(finding => UNRESOLVED_STATUSES.includes(finding.status));
}

/** True once any area has actually been reviewed. Drives "not yet reviewed". */
export function hasBeenReviewed(config: SecurityReviewConfig | undefined): boolean {
  return Boolean(config && (config.runs.length > 0 || config.findings.length > 0));
}

const SEVERITY_WEIGHT: Record<SecuritySeverity, number> = { critical: 10, high: 6, medium: 3, low: 1, info: 0 };
const EXPLOITABILITY_WEIGHT: Record<SecurityExploitability, number> = { low: 0.6, medium: 1, high: 1.5 };
const CONFIDENCE_WEIGHT: Record<SecurityConfidence, number> = { low: 0.5, medium: 0.8, high: 1 };

/**
 * Weight of a single finding: severity x exploitability, discounted by confidence.
 * Range 0 (`info`) to 15 (critical, highly exploitable, high confidence).
 */
export function securityFindingWeight(finding: SecurityFinding): number {
  return SEVERITY_WEIGHT[finding.severity] * EXPLOITABILITY_WEIGHT[finding.exploitability] * CONFIDENCE_WEIGHT[finding.confidence];
}

/** Open findings per severity, for the page's severity distribution bar. */
export function securitySeverityCounts(findings: SecurityFinding[]): Record<SecuritySeverity, number> {
  const counts: Record<SecuritySeverity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return counts;
}

/**
 * Security health as 0-100, higher is better.
 *
 * Starts at 100, deducts weighted open findings, then scales by how much of the
 * surface was actually reviewed and how long ago. `accepted` findings are excluded —
 * consciously owned exposure is a decision, not an unmanaged gap.
 *
 * The three multipliers exist so the number cannot be gamed by inaction: reviewing one
 * area out of four and finding nothing yields 25, not 100, and a year-old clean review
 * decays rather than standing as current assurance.
 */
export function computeSecurityReviewScore(config: SecurityReviewConfig, now = Date.now()): number {
  const open = openSecurityFindings(config);
  const burden = open.reduce((total, finding) => total + securityFindingWeight(finding), 0);
  // 15 is a single worst-case finding; two of those floor the findings term.
  const fromFindings = Math.max(0, 100 - Math.round((burden / 30) * 100));

  const reviewedAreas = SECURITY_REVIEW_AREAS.filter(area => config.runs.some(run => run.area === area));
  if (reviewedAreas.length === 0) {
    return fromFindings;
  }
  // Coverage: an unreviewed area is unknown, so it cannot count as assurance.
  const coverage = reviewedAreas.length / SECURITY_REVIEW_AREAS.length;
  // Staleness: linear decay to 0.5 at twice the stale threshold.
  const oldestDays = Math.max(...reviewedAreas.map(area => {
    const run = config.runs.find(entry => entry.area === area)!;
    const parsed = Date.parse(run.ranAt);
    return Number.isNaN(parsed) ? SECURITY_REVIEW_STALE_DAYS * 2 : Math.floor((now - parsed) / 86_400_000);
  }));
  const freshness = oldestDays <= SECURITY_REVIEW_STALE_DAYS
    ? 1
    : Math.max(0.5, 1 - ((oldestDays - SECURITY_REVIEW_STALE_DAYS) / (SECURITY_REVIEW_STALE_DAYS * 2)) * 0.5);

  return Math.max(0, Math.min(100, Math.round(fromFindings * coverage * freshness)));
}

// ── Markdown mirror ──────────────────────────────────────────────

const STATUS_LABEL: Record<SecurityFindingStatus, string> = {
  open: 'Open',
  accepted: 'Accepted (consciously owned)',
  mitigated: 'Mitigated',
  closed: 'Closed',
  dismissed: 'Dismissed',
};

const SEVERITY_ORDER: readonly SecuritySeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

/**
 * Render the natural-language companion document so the register can be read (and
 * reviewed in a diff) without opening the JSON.
 */
export function renderSecurityReviewMarkdown(config: SecurityReviewConfig): string {
  const lines: string[] = [];
  lines.push('# Security Review');
  lines.push('');
  lines.push('> Maintained by AtlasMind (Project Dashboard → Security). This is the human-readable');
  lines.push('> mirror of `security-review.json`; both are regenerated together from the dashboard.');
  lines.push('');
  lines.push('These findings are produced by AtlasMind\'s security reviewer reading the workspace.');
  lines.push('**This is a review, not a guarantee** — it reasons about the code, it does not execute');
  lines.push('or attack it, it cannot see your deployed infrastructure, and a clean result means');
  lines.push('nothing was found in the areas listed below, not that nothing exists. It is not a');
  lines.push('substitute for a penetration test, a dependency advisory feed, or a professional audit.');
  lines.push('');
  lines.push('Nothing here blocks a commit, a promotion, or a release. Findings are never deleted —');
  lines.push('they change status — so this file stays a complete record of what was raised and what');
  lines.push('was decided.');
  lines.push('');

  lines.push('## Last reviewed');
  lines.push('');
  if (config.runs.length === 0) {
    lines.push('_No security review has been run yet._');
    lines.push('');
  } else {
    for (const area of SECURITY_REVIEW_AREAS) {
      const run = config.runs.find(entry => entry.area === area);
      lines.push(run
        ? `- **${SECURITY_AREA_PROFILE[area].label}** — ${run.ranAt.slice(0, 10)} (${run.findingCount} finding${run.findingCount === 1 ? '' : 's'})`
        : `- **${SECURITY_AREA_PROFILE[area].label}** — never`);
    }
    lines.push('');
  }

  lines.push('## What each area covers');
  lines.push('');
  for (const area of SECURITY_REVIEW_AREAS) {
    const profile = SECURITY_AREA_PROFILE[area];
    lines.push(`### ${profile.label}`);
    lines.push('');
    lines.push(profile.coverage);
    lines.push('');
    for (const item of profile.checklist) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  const open = openSecurityFindings(config);
  lines.push(`## Open findings (${open.length})`);
  lines.push('');
  if (open.length === 0) {
    lines.push(config.findings.length === 0
      ? '_No findings recorded._'
      : '_No open findings — every recorded finding has been accepted, mitigated, closed, or dismissed._');
    lines.push('');
  } else {
    for (const area of SECURITY_REVIEW_AREAS) {
      const areaFindings = open
        .filter(finding => finding.area === area)
        .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
      if (areaFindings.length === 0) {
        continue;
      }
      lines.push(`### ${SECURITY_AREA_PROFILE[area].label}`);
      lines.push('');
      for (const finding of areaFindings) {
        lines.push(`- **${finding.title}**`);
        lines.push(`  - Severity: ${finding.severity} · Exploitability: ${finding.exploitability} · Confidence: ${finding.confidence}`);
        if (finding.detail) {
          lines.push(`  - ${finding.detail}`);
        }
        if (finding.recommendation) {
          lines.push(`  - Recommended: ${finding.recommendation}`);
        }
        if (finding.evidence.length > 0) {
          lines.push(`  - Evidence: ${finding.evidence.map(item => `\`${item}\``).join(', ')}`);
        }
        if (finding.origin === 'gap-analysis') {
          lines.push('  - Routed here from the Gap Analysis page.');
        }
        lines.push(`  - Raised: ${finding.raisedAt.slice(0, 10)}`);
      }
      lines.push('');
    }
  }

  const resolved = config.findings.filter(finding => !UNRESOLVED_STATUSES.includes(finding.status));
  lines.push(`## Resolved and accepted (${resolved.length})`);
  lines.push('');
  if (resolved.length === 0) {
    lines.push('_Nothing resolved yet._');
    lines.push('');
  } else {
    for (const finding of resolved) {
      lines.push(`- **${finding.title}** (${SECURITY_AREA_PROFILE[finding.area].label}) — ${STATUS_LABEL[finding.status]}`);
      if (finding.statusNote) {
        lines.push(`  - ${finding.statusNote}`);
      }
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`_The full audit trail lives in \`security-review-history.json\`, which retains the most`);
  lines.push(`recent ${MAX_SECURITY_REVIEW_HISTORY} records; the register above is complete and is not truncated._`);
  lines.push('');
  lines.push(`_Last updated: ${config.updatedAt ?? 'unknown'}._`);
  lines.push('');
  return lines.join('\n');
}

// ── Service ──────────────────────────────────────────────────────

/**
 * Workspace-scoped holder for the security register. Reads the persisted register at
 * construction and serves it to the dashboard; seeds an empty one on first use.
 */
export class SecurityReviewManager {
  private config: SecurityReviewConfig | undefined;
  /**
   * True when a file exists that this build must not overwrite — it was written
   * by a newer AtlasMind. Distinct from "no config", which is safe to seed over.
   */
  private preserveExisting = false;
  private notice: string | undefined;

  constructor(private readonly workspaceRoot: string | undefined) {
    this.applyRead();
  }

  private applyRead(): void {
    if (!this.workspaceRoot) {
      this.config = undefined;
      this.preserveExisting = false;
      this.notice = undefined;
      return;
    }
    const read = readSecurityReviewFile(this.workspaceRoot);
    this.config = read.config;
    this.preserveExisting = read.preserveExisting;
    this.notice = read.notice;
  }

  /** Something worth telling the user about the file itself, if anything. */
  getNotice(): string | undefined {
    return this.notice;
  }

  getConfig(): SecurityReviewConfig | undefined { return this.config; }

  hasConfig(): boolean { return this.config !== undefined; }

  /** Re-read the register from disk (e.g. after the file was edited externally). */
  reload(): SecurityReviewConfig | undefined {
    // Through applyRead, so the preserve flag and notice are refreshed too —
    // a stale flag would either block a legitimate seed or permit a clobber.
    this.applyRead();
    return this.config;
  }

  async ensureSeeded(): Promise<SecurityReviewConfig> {
    if (this.config) { return this.config; }
    const seeded = seedSecurityReviewConfig();
    this.config = seeded;
    // Never write over a file from a newer AtlasMind: it is not corrupt, this
    // build simply cannot read it, and replacing it would destroy real work.
    if (this.workspaceRoot && !this.preserveExisting) {
      try {
        await writeSecurityReviewConfig(this.workspaceRoot, seeded);
      } catch {
        // Best-effort; the in-memory register is still served.
      }
    }
    return seeded;
  }

  /** Persist an updated register (e.g. after a review run) and cache it. */
  async save(config: SecurityReviewConfig): Promise<void> {
    this.config = config;
    if (this.workspaceRoot) {
      await writeSecurityReviewConfig(this.workspaceRoot, config);
    }
  }
}
