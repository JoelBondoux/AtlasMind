/**
 * RiskOversightManager — models a project's **risk register**: the ethics, legal,
 * and commercial findings raised by the oversight advisors, and what a human
 * decided to do about each one.
 *
 * This is a *record*, not an enforcement gate. Following AtlasMind's safety-first,
 * deny-by-default posture, nothing here blocks a commit, a promotion, or a release;
 * an analysis only ever runs because the user explicitly asked for one on the
 * Project Dashboard → Risk page. Findings are never deleted — they transition
 * through {@link RiskStatus} — so the register stays a complete account of what was
 * raised and what was decided, and `risk-oversight-history.json` keeps a bounded,
 * append-only audit trail alongside it.
 *
 * The findings themselves originate as **model output**, which is untrusted input
 * like any other boundary: {@link parseRiskFindings} tolerates absent or malformed
 * JSON without throwing, and {@link sanitizeRiskOversightConfig} clamps every
 * string, coerces every enum to a safe default, and rejects path traversal in cited
 * evidence before anything reaches disk.
 *
 * Like {@link ./documentsManager}, the persistence helpers are free of the `vscode`
 * API (node `fs` only) so seeding/serialisation can be unit tested in isolation, and
 * no secret VALUES are ever stored — only labels, prose, and workspace-relative paths.
 */

import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import type {
  RiskConfidence,
  RiskDomain,
  RiskDomainRun,
  RiskFinding,
  RiskImpact,
  RiskLikelihood,
  RiskOversightConfig,
  RiskOversightHistoryEntry,
  RiskStatus,
} from '../types.js';

export const RISK_SSOT_PATH = 'project_memory/operations/risk-oversight.json';
export const RISK_SUMMARY_SSOT_PATH = 'project_memory/operations/risk-oversight.md';
export const RISK_HISTORY_SSOT_PATH = 'project_memory/operations/risk-oversight-history.json';

export const RISK_DOMAINS: readonly RiskDomain[] = ['ethics', 'legal', 'commercial'];
const LIKELIHOODS: RiskLikelihood[] = ['low', 'medium', 'high'];
const IMPACTS: RiskImpact[] = ['low', 'medium', 'high'];
const CONFIDENCES: RiskConfidence[] = ['low', 'medium', 'high'];
const STATUSES: RiskStatus[] = ['open', 'accepted', 'mitigated', 'closed', 'dismissed'];

const MAX_FIELD = 240;
const MAX_LONG = 2000;
const MAX_PATH = 400;
const MAX_FINDINGS = 500;
const MAX_EVIDENCE = 12;
/**
 * Retained audit records. Deliberately higher than the other operations managers:
 * the register itself is complete (findings transition rather than disappear), and
 * the markdown mirror states this cap rather than truncating silently.
 */
export const MAX_RISK_HISTORY = 1000;

/** Statuses that still represent live, uncontrolled exposure. */
const UNRESOLVED_STATUSES: readonly RiskStatus[] = ['open'];

// ── History ──────────────────────────────────────────────────────

export function readRiskOversightHistory(workspaceRoot: string): RiskOversightHistoryEntry[] {
  try {
    const raw = readFileSync(path.join(workspaceRoot, RISK_HISTORY_SSOT_PATH), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as RiskOversightHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

/** Append an audit record (newest first), capped at {@link MAX_RISK_HISTORY}. */
export async function appendRiskOversightHistory(
  workspaceRoot: string,
  entry: RiskOversightHistoryEntry,
): Promise<void> {
  const file = path.join(workspaceRoot, RISK_HISTORY_SSOT_PATH);
  const history = readRiskOversightHistory(workspaceRoot);
  history.unshift(entry);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(history.slice(0, MAX_RISK_HISTORY), null, 2), 'utf-8');
}

// ── Seeding ──────────────────────────────────────────────────────

/** A fresh, empty register. Risk is "not yet assessed" until an advisor runs. */
export function seedRiskOversightConfig(): RiskOversightConfig {
  return { version: 1, findings: [], runs: [], updatedAt: new Date().toISOString() };
}

// ── Persistence (node fs; vscode-free) ───────────────────────────

export function readRiskOversightConfig(workspaceRoot: string): RiskOversightConfig | undefined {
  try {
    const raw = readFileSync(path.join(workspaceRoot, RISK_SSOT_PATH), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return isRiskOversightConfig(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Persist the register as JSON (source of truth) and regenerate the human-readable
 * markdown mirror alongside it. Both live in `project_memory/operations/`.
 */
export async function writeRiskOversightConfig(workspaceRoot: string, config: RiskOversightConfig): Promise<void> {
  const configPath = path.join(workspaceRoot, RISK_SSOT_PATH);
  const summaryPath = path.join(workspaceRoot, RISK_SUMMARY_SSOT_PATH);
  await mkdir(path.dirname(configPath), { recursive: true });
  const updated: RiskOversightConfig = { ...config, updatedAt: new Date().toISOString() };
  await Promise.all([
    writeFile(configPath, JSON.stringify(updated, null, 2), 'utf-8'),
    writeFile(summaryPath, renderRiskOversightMarkdown(updated), 'utf-8'),
  ]);
}

// ── Validation / sanitisation ────────────────────────────────────

function isRiskOversightConfig(value: unknown): value is RiskOversightConfig {
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
 * Coerce a model/user-supplied path to a safe, workspace-relative POSIX path, or
 * `''` if it escapes the workspace. This is the security boundary for cited
 * evidence: absolute paths, drive letters, `..` traversal, and backslashes are all
 * rejected/normalised so a recorded finding can never point outside the project.
 */
export function normalizeRelPath(value: unknown): string {
  let raw = clampStr(value, MAX_PATH);
  if (!raw) {
    return '';
  }
  // Reject absolute paths and Windows drive letters outright.
  if (path.isAbsolute(raw) || /^[a-zA-Z]:[\\/]/.test(raw)) {
    return '';
  }
  raw = raw.replace(/\\/g, '/');
  // POSIX-normalise and reject anything that still climbs out of the workspace.
  const normalized = path.posix.normalize(raw).replace(/^\.\/+/, '').replace(/\/+$/, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized === '..' || normalized.includes('/../')) {
    return '';
  }
  return normalized;
}

function sanitizeDomain(value: unknown): RiskDomain | undefined {
  const raw = clampStr(value, 40).toLowerCase() as RiskDomain;
  return RISK_DOMAINS.includes(raw) ? raw : undefined;
}

/** Unknown severities coerce to `medium` — neither alarmist nor falsely reassuring. */
function sanitizeLikelihood(value: unknown): RiskLikelihood {
  const raw = clampStr(value, 40).toLowerCase() as RiskLikelihood;
  return LIKELIHOODS.includes(raw) ? raw : 'medium';
}

function sanitizeImpact(value: unknown): RiskImpact {
  const raw = clampStr(value, 40).toLowerCase() as RiskImpact;
  return IMPACTS.includes(raw) ? raw : 'medium';
}

/** Unknown confidence coerces to `low`: an unlabelled claim has not earned trust. */
function sanitizeConfidence(value: unknown): RiskConfidence {
  const raw = clampStr(value, 40).toLowerCase() as RiskConfidence;
  return CONFIDENCES.includes(raw) ? raw : 'low';
}

/** Unknown status coerces to `open`: never silently resolve a finding. */
function sanitizeStatus(value: unknown): RiskStatus {
  const raw = clampStr(value, 40).toLowerCase() as RiskStatus;
  return STATUSES.includes(raw) ? raw : 'open';
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
    const clean = normalizeRelPath(item);
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
 * Coerce one untrusted finding (from a model response or the dashboard editor) into
 * a well-formed {@link RiskFinding}. Returns `undefined` when there is no usable
 * domain or title — a finding with neither cannot be shown or scored meaningfully.
 */
function sanitizeFinding(input: unknown, usedIds: Set<string>, now: string): RiskFinding | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const raw = input as Record<string, unknown>;
  const domain = sanitizeDomain(raw['domain']);
  const title = clampStr(raw['title'], MAX_FIELD);
  if (!domain || !title) {
    return undefined;
  }

  let id = clampStr(raw['id'], 80) || `${domain}-${slugify(title)}`;
  while (usedIds.has(id)) {
    id = `${id}-${usedIds.size}`;
  }
  usedIds.add(id);

  const raisedAt = sanitizeIsoDate(raw['raisedAt'], now);
  return {
    id,
    domain,
    title,
    detail: clampStr(raw['detail'], MAX_LONG),
    likelihood: sanitizeLikelihood(raw['likelihood']),
    impact: sanitizeImpact(raw['impact']),
    confidence: sanitizeConfidence(raw['confidence']),
    status: sanitizeStatus(raw['status']),
    evidence: sanitizeEvidence(raw['evidence']),
    ...(optStr(raw['recommendation'], MAX_LONG) ? { recommendation: optStr(raw['recommendation'], MAX_LONG) } : {}),
    raisedAt,
    ...(optStr(raw['updatedAt'], 40) ? { updatedAt: sanitizeIsoDate(raw['updatedAt'], raisedAt) } : {}),
    ...(optStr(raw['statusNote'], MAX_LONG) ? { statusNote: optStr(raw['statusNote'], MAX_LONG) } : {}),
  };
}

/**
 * Sanitise a list of untrusted findings (the model-output boundary). Bad entries are
 * dropped individually rather than failing the batch, and ids are made collision-safe.
 */
export function sanitizeRiskFindings(input: unknown): RiskFinding[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const now = new Date().toISOString();
  const usedIds = new Set<string>();
  const findings: RiskFinding[] = [];
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
 * This is the model-output boundary and it must never throw: an advisor may wrap
 * its JSON in a fenced block, emit it bare, surround it with prose, return an
 * object with a `findings` key, or produce nothing parseable at all. Anything it
 * cannot understand degrades to `[]` so the caller records no findings rather than
 * failing the run. Shape/enum/path validation happens afterwards in
 * {@link sanitizeRiskFindings} — this function only locates candidate JSON.
 */
export function parseRiskFindings(response: unknown): unknown[] {
  if (typeof response !== 'string' || response.trim().length === 0) {
    return [];
  }

  const candidates: string[] = [];
  // Prefer fenced blocks (```json … ``` or ``` … ```), newest-style first.
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (let match = fencePattern.exec(response); match !== null; match = fencePattern.exec(response)) {
    const body = match[1]?.trim();
    if (body) {
      candidates.push(body);
    }
  }
  // Fall back to the outermost bracketed span, for responses that emit bare JSON.
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
 * Merge freshly-analysed findings for one domain into the existing register.
 *
 * A re-run must not duplicate what is already recorded, and must not silently undo
 * a human decision: when an incoming finding matches one already on file, the prose
 * and severity are refreshed but the existing `status`, `statusNote`, and `raisedAt`
 * are preserved. Findings previously recorded for this domain that the advisor no
 * longer reports are kept (they are history, not noise) — only a human closes them.
 */
export function mergeDomainFindings(
  existing: RiskFinding[],
  incoming: RiskFinding[],
  domain: RiskDomain,
): RiskFinding[] {
  const now = new Date().toISOString();
  const byKey = new Map<string, RiskFinding>();
  for (const finding of existing) {
    byKey.set(`${finding.domain}::${finding.title.toLowerCase()}`, finding);
  }

  const merged = [...existing];
  for (const finding of incoming) {
    if (finding.domain !== domain) {
      continue;
    }
    const key = `${finding.domain}::${finding.title.toLowerCase()}`;
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
        likelihood: finding.likelihood,
        impact: finding.impact,
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
 * Coerce an untrusted payload into a well-formed {@link RiskOversightConfig}.
 * Returns `undefined` when the top-level shape is wrong.
 */
export function sanitizeRiskOversightConfig(input: unknown): RiskOversightConfig | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const raw = input as Record<string, unknown>;
  if (raw['version'] !== 1 || !Array.isArray(raw['findings']) || !Array.isArray(raw['runs'])) {
    return undefined;
  }

  const now = new Date().toISOString();
  const findings = sanitizeRiskFindings(raw['findings']);

  const seenDomains = new Set<RiskDomain>();
  const runs: RiskDomainRun[] = [];
  for (const item of (raw['runs'] as unknown[]).slice(0, RISK_DOMAINS.length * 4)) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const r = item as Record<string, unknown>;
    const domain = sanitizeDomain(r['domain']);
    if (!domain || seenDomains.has(domain)) {
      continue;
    }
    seenDomains.add(domain);
    const count = typeof r['findingCount'] === 'number' && Number.isFinite(r['findingCount'])
      ? Math.max(0, Math.min(MAX_FINDINGS, Math.round(r['findingCount'])))
      : 0;
    runs.push({ domain, ranAt: sanitizeIsoDate(r['ranAt'], now), findingCount: count });
  }

  return { version: 1, findings, runs, updatedAt: now };
}

// ── Derivations (pure) ───────────────────────────────────────────

/** Findings that still represent live exposure (i.e. nobody has decided about them). */
export function openFindings(config: RiskOversightConfig): RiskFinding[] {
  return config.findings.filter(finding => UNRESOLVED_STATUSES.includes(finding.status));
}

/** True once any domain has actually been analysed. Drives "not yet assessed". */
export function hasBeenAssessed(config: RiskOversightConfig | undefined): boolean {
  return Boolean(config && (config.runs.length > 0 || config.findings.length > 0));
}

const SEVERITY_WEIGHT: Record<RiskLikelihood, number> = { low: 1, medium: 2, high: 3 };
const CONFIDENCE_WEIGHT: Record<RiskConfidence, number> = { low: 0.5, medium: 0.8, high: 1 };

/**
 * Weight of a single finding: likelihood x impact, discounted by how confident the
 * advisor was. Range 0.5 (low/low, low confidence) to 9 (high/high, high confidence).
 */
export function findingWeight(finding: RiskFinding): number {
  return SEVERITY_WEIGHT[finding.likelihood] * SEVERITY_WEIGHT[finding.impact] * CONFIDENCE_WEIGHT[finding.confidence];
}

/** Count of findings in each likelihood/impact cell, for the risk matrix. */
export function riskMatrixCounts(findings: RiskFinding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const finding of findings) {
    const key = `${finding.likelihood}:${finding.impact}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

// ── Markdown mirror ──────────────────────────────────────────────

const DOMAIN_LABEL: Record<RiskDomain, string> = {
  ethics: 'Ethics',
  legal: 'Legal',
  commercial: 'Commercial',
};

const STATUS_LABEL: Record<RiskStatus, string> = {
  open: 'Open',
  accepted: 'Accepted (consciously owned)',
  mitigated: 'Mitigated',
  closed: 'Closed',
  dismissed: 'Dismissed',
};

/**
 * Render the natural-language companion document so the register can be read (and
 * reviewed in a diff) without opening the JSON.
 */
export function renderRiskOversightMarkdown(config: RiskOversightConfig): string {
  const lines: string[] = [];
  lines.push('# Risk Oversight');
  lines.push('');
  lines.push('> Maintained by AtlasMind (Project Dashboard → Risk). This is the human-readable');
  lines.push('> mirror of `risk-oversight.json`; both are regenerated together from the dashboard.');
  lines.push('');
  lines.push('These findings are produced by AtlasMind\'s ethics, legal, and commercial oversight');
  lines.push('advisors. **They are advisory only and are not professional advice** — they are');
  lines.push('structured prompts for human judgement, not a clearance to proceed. Anything');
  lines.push('consequential needs qualified review: counsel in the relevant jurisdiction for legal');
  lines.push('exposure, an ethics or DPO review for human impact, and finance or commercial');
  lines.push('sign-off for business commitments.');
  lines.push('');
  lines.push('Nothing here blocks a commit, a promotion, or a release. Findings are never deleted —');
  lines.push('they change status — so this file stays a complete record of what was raised and what');
  lines.push('was decided.');
  lines.push('');

  lines.push('## Last analysed');
  lines.push('');
  if (config.runs.length === 0) {
    lines.push('_No oversight analysis has been run yet._');
    lines.push('');
  } else {
    for (const domain of RISK_DOMAINS) {
      const run = config.runs.find(entry => entry.domain === domain);
      lines.push(run
        ? `- **${DOMAIN_LABEL[domain]}** — ${run.ranAt.slice(0, 10)} (${run.findingCount} finding${run.findingCount === 1 ? '' : 's'})`
        : `- **${DOMAIN_LABEL[domain]}** — never`);
    }
    lines.push('');
  }

  const open = openFindings(config);
  lines.push(`## Open findings (${open.length})`);
  lines.push('');
  if (open.length === 0) {
    lines.push(config.findings.length === 0
      ? '_No findings recorded._'
      : '_No open findings — every recorded finding has been accepted, mitigated, closed, or dismissed._');
    lines.push('');
  } else {
    for (const domain of RISK_DOMAINS) {
      const domainFindings = open.filter(finding => finding.domain === domain);
      if (domainFindings.length === 0) {
        continue;
      }
      lines.push(`### ${DOMAIN_LABEL[domain]}`);
      lines.push('');
      for (const finding of domainFindings) {
        lines.push(`- **${finding.title}**`);
        lines.push(`  - Likelihood: ${finding.likelihood} · Impact: ${finding.impact} · Confidence: ${finding.confidence}`);
        if (finding.detail) {
          lines.push(`  - ${finding.detail}`);
        }
        if (finding.recommendation) {
          lines.push(`  - Recommended: ${finding.recommendation}`);
        }
        if (finding.evidence.length > 0) {
          lines.push(`  - Evidence: ${finding.evidence.map(item => `\`${item}\``).join(', ')}`);
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
      lines.push(`- **${finding.title}** (${DOMAIN_LABEL[finding.domain]}) — ${STATUS_LABEL[finding.status]}`);
      if (finding.statusNote) {
        lines.push(`  - ${finding.statusNote}`);
      }
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`_The full audit trail lives in \`risk-oversight-history.json\`, which retains the most`);
  lines.push(`recent ${MAX_RISK_HISTORY} records; the register above is complete and is not truncated._`);
  lines.push('');
  lines.push(`_Last updated: ${config.updatedAt ?? 'unknown'}._`);
  lines.push('');
  return lines.join('\n');
}

// ── Service ──────────────────────────────────────────────────────

/**
 * Workspace-scoped holder for the risk register. Reads the persisted register at
 * construction and serves it to the dashboard; seeds an empty one on first use.
 */
export class RiskOversightManager {
  private config: RiskOversightConfig | undefined;

  constructor(private readonly workspaceRoot: string | undefined) {
    this.config = workspaceRoot ? readRiskOversightConfig(workspaceRoot) : undefined;
  }

  getConfig(): RiskOversightConfig | undefined { return this.config; }

  hasConfig(): boolean { return this.config !== undefined; }

  /** Re-read the register from disk (e.g. after the file was edited externally). */
  reload(): RiskOversightConfig | undefined {
    this.config = this.workspaceRoot ? readRiskOversightConfig(this.workspaceRoot) : undefined;
    return this.config;
  }

  async ensureSeeded(): Promise<RiskOversightConfig> {
    if (this.config) { return this.config; }
    const seeded = seedRiskOversightConfig();
    this.config = seeded;
    if (this.workspaceRoot) {
      try {
        await writeRiskOversightConfig(this.workspaceRoot, seeded);
      } catch {
        // Best-effort; the in-memory register is still served.
      }
    }
    return seeded;
  }

  /** Persist an updated register (e.g. after an analysis run) and cache it. */
  async save(config: RiskOversightConfig): Promise<void> {
    this.config = config;
    if (this.workspaceRoot) {
      await writeRiskOversightConfig(this.workspaceRoot, config);
    }
  }
}
