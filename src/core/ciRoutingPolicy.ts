/**
 * Which route runs which kind of check — a committed file, not a setting.
 *
 * `ciRoutes` says where a check *can* run. This says where it *should*, and the
 * difference is a team decision, so it arrives as a reviewed diff in
 * `project_memory/operations/ci-routing.json` rather than as a habit nobody
 * wrote down. Same shape as `workflowConfig`, for the same reasons: JSON is the
 * source of truth, a markdown mirror publishes the rules beside it, and the
 * VS Code settings remain a *ceiling* the file cannot raise.
 *
 * Five rules carry the semantics.
 *
 * **Budget pressure never weakens the trust boundary.** This is the one that
 * matters most, and it is enforced structurally rather than by rule authoring.
 * A workload whose input is untrusted may only reach a route that declares
 * `safeForUntrustedCode: 'yes'` — and that filter runs *before* the credit
 * meter is consulted and applies to every fallback, so an exhausted allowance
 * produces a refusal, never a demotion onto somebody's workstation. Without it,
 * "fall back to local when credit runs out" is a mechanism by which running out
 * of money routes hostile code onto a developer's machine. Pinned by test.
 *
 * **An unreadable meter is not an empty one.** `unknown` uses the preferred
 * route and says the meter could not be read, because falling back on a failed
 * billing call would move work off hosted runners whenever GitHub's API had a
 * bad afternoon, and blocking on it would stop CI for the same reason.
 *
 * **A route that cannot produce the required evidence is refused, not
 * preferred.** The check is `routeSatisfiesEvidence`, so the Windows matrix leg
 * cannot be satisfied by a Linux container however convenient — the exact
 * substitution the local-CI documentation already warns against.
 *
 * **Every decision names the rule that made it, and says it twice.** Once as a
 * rule id for somebody debugging, once as a plain sentence for somebody who
 * just wants to know why their tests went where they went.
 *
 * **The file proposes; nothing here executes.** A decision is a recommendation
 * rendered on a page. Running a route remains the separate, confirmed act it
 * already was.
 *
 * `fs`-only + unit-tested. The credit reading and the clock are injected.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  CI_ROUTES,
  findCiRoute,
  routeSatisfiesEvidence,
  type CiRouteAvailability,
  type CiRouteEvidence,
  type CiRouteId,
} from './ciRoutes.js';
import { describeCreditReading, type CiCreditReading } from './ciCreditMeter.js';
import { interpretVersionedDocument, type VersionedDocumentRead } from './schemaMigration.js';

export const CI_ROUTING_SSOT_PATH = 'project_memory/operations/ci-routing.json';
export const CI_ROUTING_SUMMARY_SSOT_PATH = 'project_memory/operations/ci-routing.md';

export type CiWorkloadId =
  | 'fast-feedback'
  | 'full-suite'
  | 'platform-matrix'
  | 'packaging'
  | 'security-scan'
  | 'untrusted-contribution';

export interface CiWorkloadClass {
  id: CiWorkloadId;
  label: string;
  /** What this covers, in the words somebody would use to recognise it. */
  description: string;
  /** The weakest evidence that would actually settle this workload. */
  requiredEvidence: CiRouteEvidence;
  /**
   * Whether the code being executed has been reviewed by somebody trusted.
   *
   * The single most consequential field here. `untrusted` is not a preference
   * about where work should go — it is a hard constraint that no rule, no
   * fallback and no budget state may override.
   */
  input: 'trusted' | 'untrusted';
}

/**
 * The kinds of check a project runs, as a closed vocabulary.
 *
 * Deliberately six rather than one per testing methodology. The 32 methodologies
 * answer "what should be tested"; this answers "what kind of machine settles
 * it", and most methodologies have the same answer. A rule table with 32 rows
 * would be a table nobody reads and nobody keeps accurate.
 */
export const CI_WORKLOAD_CLASSES: readonly CiWorkloadClass[] = [
  {
    id: 'fast-feedback',
    label: 'Fast feedback',
    description: 'Type checks, lint and unit tests — the ones you want before pushing.',
    requiredEvidence: 'this-machine',
    input: 'trusted',
  },
  {
    id: 'full-suite',
    label: 'Full test suite',
    description: 'Everything, including the slow tests, on a clean checkout.',
    requiredEvidence: 'linux-container',
    input: 'trusted',
  },
  {
    id: 'platform-matrix',
    label: 'Platform matrix',
    description: 'Evidence on operating systems other than the one you are sitting at.',
    requiredEvidence: 'declared-matrix',
    input: 'trusted',
  },
  {
    id: 'packaging',
    label: 'Packaging and release artifacts',
    description: 'Building the artifact that would actually ship, from a clean tree.',
    requiredEvidence: 'linux-container',
    input: 'trusted',
  },
  {
    id: 'security-scan',
    label: 'Security and dependency scanning',
    description: 'Secret scanning over full history, SAST and dependency audits.',
    requiredEvidence: 'linux-container',
    input: 'trusted',
  },
  {
    id: 'untrusted-contribution',
    label: 'Contributions not yet reviewed',
    description: 'Pull requests from forks, and any code nobody trusted has read.',
    requiredEvidence: 'declared-matrix',
    input: 'untrusted',
  },
];

export function findCiWorkloadClass(id: string): CiWorkloadClass | undefined {
  return CI_WORKLOAD_CLASSES.find(workload => workload.id === id);
}

/** What to do when the hosted allowance is gone. */
export type CiCreditExhaustedBehaviour =
  /** Try the fallback routes, in order. */
  | 'fallback'
  /** Stop. Correct where no other route could produce the evidence. */
  | 'block';

export interface CiRoutingRule {
  /** Stable id, published in the mirror and cited by every decision. */
  id: string;
  workload: CiWorkloadId;
  /** The route this rule wants. */
  prefer: CiRouteId;
  /** Tried in order when the preferred one cannot be used. */
  fallback: CiRouteId[];
  onCreditExhausted: CiCreditExhaustedBehaviour;
  /** Free text from whoever wrote the rule. Never interpreted. */
  note?: string;
}

export interface CiRoutingConfig {
  version: number;
  updatedAt: string;
  rules: CiRoutingRule[];
  /**
   * What an unreadable meter means.
   *
   * `prefer` by default: a billing API having a bad afternoon must not silently
   * relocate work, in either direction.
   */
  onCreditUnknown: 'prefer' | 'fallback';
}

const CI_ROUTING_VERSION = 1;

/**
 * The starting table, derived from what each route can actually do.
 *
 * Fast feedback runs here because that is the whole point of it. The full suite
 * and packaging prefer hosted but may fall back to the borrowed machine, since
 * both are trusted work and a Linux container settles them. The platform matrix
 * blocks rather than falling back — nothing else produces that evidence, and
 * pretending otherwise is the substitution this whole model exists to refuse.
 * Untrusted contributions have no fallback at all, and could not use one.
 */
export function seedCiRoutingConfig(now: () => Date = () => new Date()): CiRoutingConfig {
  return {
    version: CI_ROUTING_VERSION,
    updatedAt: now().toISOString(),
    onCreditUnknown: 'prefer',
    rules: [
      {
        id: 'fast-feedback-here',
        workload: 'fast-feedback',
        prefer: 'direct-local',
        fallback: [],
        onCreditExhausted: 'fallback',
        note: 'Immediate feedback on the working copy. Spends no hosted allowance.',
      },
      {
        id: 'full-suite-hosted',
        workload: 'full-suite',
        prefer: 'github-hosted',
        fallback: ['local-runner'],
        onCreditExhausted: 'fallback',
        note: 'A clean checkout settles this. The borrowed machine can stand in when the allowance is gone.',
      },
      {
        id: 'packaging-hosted',
        workload: 'packaging',
        prefer: 'github-hosted',
        fallback: ['local-runner'],
        onCreditExhausted: 'fallback',
      },
      {
        id: 'security-scan-hosted',
        workload: 'security-scan',
        prefer: 'github-hosted',
        fallback: ['local-runner'],
        onCreditExhausted: 'fallback',
        note: 'Secret scanning needs full history, which both routes have.',
      },
      {
        id: 'platform-matrix-hosted',
        workload: 'platform-matrix',
        prefer: 'github-hosted',
        fallback: [],
        onCreditExhausted: 'block',
        note: 'No other route can produce evidence for an operating system you are not sitting at.',
      },
      {
        id: 'untrusted-hosted-only',
        workload: 'untrusted-contribution',
        prefer: 'github-hosted',
        fallback: [],
        onCreditExhausted: 'block',
        note: 'Never falls back. Running unreviewed code on a personal machine is not a budget decision.',
      },
    ],
  };
}

// ── Sanitizing and validation ────────────────────────────────────

function sanitizeId(value: unknown, max = 60): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(trimmed) ? trimmed.slice(0, max) : undefined;
}

function sanitizeRouteId(value: unknown): CiRouteId | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return CI_ROUTES.some(route => route.id === trimmed) ? trimmed as CiRouteId : undefined;
}

function sanitizeNote(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.replace(/[ -]/g, ' ').trim() : '';
  return trimmed ? trimmed.slice(0, 300) : undefined;
}

/**
 * Coerce a stored document into a usable config, dropping what it cannot read.
 *
 * A rule naming a route or workload that does not exist is dropped rather than
 * repaired: guessing which one somebody meant would silently route work
 * somewhere they did not choose. `validateCiRoutingConfig` is what reports the
 * loss, so a hand-edit that produced nothing is visible rather than quiet.
 */
export function sanitizeCiRoutingConfig(input: unknown): CiRoutingConfig | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }
  const raw = input as Partial<CiRoutingConfig> & Record<string, unknown>;
  const rules: CiRoutingRule[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(raw.rules) ? raw.rules : []) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const candidate = entry as Partial<CiRoutingRule>;
    const id = sanitizeId(candidate.id);
    const workload = findCiWorkloadClass(String(candidate.workload ?? ''))?.id;
    const prefer = sanitizeRouteId(candidate.prefer);
    if (!id || !workload || !prefer || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const fallback = (Array.isArray(candidate.fallback) ? candidate.fallback : [])
      .map(sanitizeRouteId)
      .filter((value): value is CiRouteId => Boolean(value) && value !== prefer)
      .slice(0, 4);
    const note = sanitizeNote(candidate.note);
    rules.push({
      id,
      workload,
      prefer,
      fallback: [...new Set(fallback)],
      onCreditExhausted: candidate.onCreditExhausted === 'block' ? 'block' : 'fallback',
      ...(note ? { note } : {}),
    });
  }
  const updatedAt = typeof raw.updatedAt === 'string' && raw.updatedAt.trim() ? raw.updatedAt.trim().slice(0, 40) : new Date(0).toISOString();
  return {
    // Unknown top-level fields survive a round trip so an older build saving
    // cannot silently drop a newer one's settings — the rule `workflowConfig`
    // established for exactly this file shape.
    ...raw,
    version: typeof raw.version === 'number' && Number.isFinite(raw.version) ? raw.version : CI_ROUTING_VERSION,
    updatedAt,
    onCreditUnknown: raw.onCreditUnknown === 'fallback' ? 'fallback' : 'prefer',
    rules,
  };
}

function isCiRoutingConfig(value: unknown): value is CiRoutingConfig {
  return Boolean(value) && typeof value === 'object' && Array.isArray((value as CiRoutingConfig).rules);
}

export interface CiRoutingProblem {
  ruleId?: string;
  severity: 'error' | 'warning';
  message: string;
}

/**
 * Check the file names things that exist and asks for nothing forbidden.
 *
 * Separate from sanitizing, as `workflowConfig` separates them: one asks "is
 * this file usable", the other "does everything it names make sense". The trust
 * violation is reported here **and** refused at decision time — a file is
 * hand-editable, so a rule that would run unreviewed code locally must be both
 * visible in the mirror and impossible to act on.
 */
export function validateCiRoutingConfig(config: CiRoutingConfig): CiRoutingProblem[] {
  const problems: CiRoutingProblem[] = [];
  const covered = new Set<CiWorkloadId>();

  for (const rule of config.rules) {
    const workload = findCiWorkloadClass(rule.workload);
    if (!workload) {
      problems.push({ ruleId: rule.id, severity: 'error', message: `Rule ${rule.id} names an unknown workload.` });
      continue;
    }
    if (covered.has(workload.id)) {
      problems.push({
        ruleId: rule.id,
        severity: 'warning',
        message: `More than one rule covers ${workload.label}; the first one wins and the rest are never consulted.`,
      });
    }
    covered.add(workload.id);

    for (const routeId of [rule.prefer, ...rule.fallback]) {
      const route = findCiRoute(routeId);
      if (!route) {
        problems.push({ ruleId: rule.id, severity: 'error', message: `Rule ${rule.id} names route ${routeId}, which does not exist.` });
        continue;
      }
      if (route.implementation === 'declared') {
        problems.push({
          ruleId: rule.id,
          severity: 'warning',
          message: `Rule ${rule.id} names ${route.label}, which AtlasMind has no adapter for. It will be skipped.`,
        });
      }
      if (workload.input === 'untrusted' && route.capabilities.safeForUntrustedCode !== 'yes') {
        problems.push({
          ruleId: rule.id,
          severity: 'error',
          message: `Rule ${rule.id} would send unreviewed code to ${route.label}, which is not safe for it. `
            + 'AtlasMind refuses this at routing time whatever the file says — remove it so the file matches what happens.',
        });
      }
      const evidence = routeSatisfiesEvidence(route, workload.requiredEvidence);
      if (!evidence.satisfied) {
        problems.push({
          ruleId: rule.id,
          severity: 'error',
          message: `Rule ${rule.id}: ${evidence.reason}`,
        });
      }
    }
  }

  for (const workload of CI_WORKLOAD_CLASSES) {
    if (!covered.has(workload.id)) {
      problems.push({
        severity: 'warning',
        message: `No rule covers ${workload.label}, so AtlasMind has no recommendation for it.`,
      });
    }
  }
  return problems;
}

// ── Deciding ─────────────────────────────────────────────────────

export interface CiRouteDecisionInput {
  workload: CiWorkloadId;
  config: CiRoutingConfig;
  availability: readonly CiRouteAvailability[];
  credit: CiCreditReading;
}

export interface CiRouteDecision {
  workload: CiWorkloadId;
  workloadLabel: string;
  outcome: 'routed' | 'blocked';
  routeId?: CiRouteId;
  routeLabel?: string;
  /** The rule that decided, for somebody debugging. */
  ruleId?: string;
  /** Plain language, for somebody who just wants to know why. */
  sentence: string;
  /** Every candidate that was rejected, and why. Never silently dropped. */
  rejected: Array<{ routeId: CiRouteId; reason: string }>;
  /** True when the preferred route was not the one chosen. */
  usedFallback: boolean;
  /** What the meter said, always stated when it influenced anything. */
  creditNote?: string;
}

/**
 * Decide where one workload should run.
 *
 * Order is load-bearing. The trust filter runs first and unconditionally, so no
 * later step — not the credit meter, not a fallback list, not an availability
 * gap — can produce an untrusted workload on an unsafe route. Everything after
 * it only ever narrows further.
 */
export function decideCiRoute(input: CiRouteDecisionInput): CiRouteDecision {
  const workload = findCiWorkloadClass(input.workload);
  if (!workload) {
    return {
      workload: input.workload,
      workloadLabel: input.workload,
      outcome: 'blocked',
      sentence: 'AtlasMind does not recognise that kind of check.',
      rejected: [],
      usedFallback: false,
    };
  }
  const rule = input.config.rules.find(entry => entry.workload === workload.id);
  if (!rule) {
    return {
      workload: workload.id,
      workloadLabel: workload.label,
      outcome: 'blocked',
      sentence: `No rule covers ${workload.label}, so AtlasMind has no recommendation. Add one to the routing file.`,
      rejected: [],
      usedFallback: false,
    };
  }

  const creditNote = describeCreditReading(input.credit);
  const rejected: Array<{ routeId: CiRouteId; reason: string }> = [];
  const candidates: CiRouteId[] = [rule.prefer, ...rule.fallback];

  for (const [index, routeId] of candidates.entries()) {
    const route = findCiRoute(routeId);
    if (!route) {
      rejected.push({ routeId, reason: 'That route does not exist.' });
      continue;
    }

    // 1 — trust, before anything else and regardless of everything else.
    if (workload.input === 'untrusted' && route.capabilities.safeForUntrustedCode !== 'yes') {
      rejected.push({
        routeId,
        reason: `${route.label} is not safe for code nobody has reviewed. This is refused whatever the routing file or the budget says.`,
      });
      continue;
    }

    // 2 — evidence. A route that cannot settle the question is not a fallback.
    const evidence = routeSatisfiesEvidence(route, workload.requiredEvidence);
    if (!evidence.satisfied) {
      rejected.push({ routeId, reason: evidence.reason });
      continue;
    }

    // 3 — is it usable on this machine at all?
    const availability = input.availability.find(entry => entry.route.id === routeId);
    if (!availability || availability.status !== 'available') {
      rejected.push({
        routeId,
        reason: availability?.blockers[0] ?? `${route.label} is not usable here.`,
      });
      continue;
    }

    // 4 — the budget, last, and only for routes that spend one.
    if (route.cost === 'hosted-allowance' && input.credit.state === 'exhausted') {
      if (rule.onCreditExhausted === 'block') {
        return {
          workload: workload.id,
          workloadLabel: workload.label,
          outcome: 'blocked',
          ruleId: rule.id,
          sentence: `${workload.label} needs ${route.label}, and the hosted allowance is gone. Nothing else can produce this evidence, so AtlasMind will not substitute a weaker route.`,
          rejected,
          usedFallback: false,
          creditNote,
        };
      }
      rejected.push({ routeId, reason: `The hosted allowance is gone. ${creditNote}` });
      continue;
    }

    const usedFallback = index > 0;
    const unknownMeterNote = route.cost === 'hosted-allowance' && input.credit.state === 'unknown'
      ? ' AtlasMind could not read the allowance, so it is using the preferred route rather than guessing.'
      : '';
    return {
      workload: workload.id,
      workloadLabel: workload.label,
      outcome: 'routed',
      routeId,
      routeLabel: route.label,
      ruleId: rule.id,
      sentence: usedFallback
        ? `${workload.label} falls back to ${route.label}, because the preferred route could not be used.${unknownMeterNote}`
        : `${workload.label} runs on ${route.label}.${unknownMeterNote}`,
      rejected,
      usedFallback,
      creditNote,
    };
  }

  return {
    workload: workload.id,
    workloadLabel: workload.label,
    outcome: 'blocked',
    ruleId: rule.id,
    sentence: `No route in rule ${rule.id} can run ${workload.label} right now.`,
    rejected,
    usedFallback: false,
    creditNote,
  };
}

/** Decide every workload at once, in declaration order. */
export function decideAllCiRoutes(
  config: CiRoutingConfig,
  availability: readonly CiRouteAvailability[],
  credit: CiCreditReading,
): CiRouteDecision[] {
  return CI_WORKLOAD_CLASSES.map(workload => decideCiRoute({
    workload: workload.id,
    config,
    availability,
    credit,
  }));
}

// ── Markdown mirror ──────────────────────────────────────────────

/**
 * Publish the rules beside the JSON.
 *
 * The mirror carries the rule table itself rather than a summary of it, for the
 * reason the debt register does: a surface that grades things by declared rules
 * should publish the rules that did the grading, so somebody can check the
 * answer rather than trust it.
 */
export function renderCiRoutingMarkdown(config: CiRoutingConfig): string {
  const lines = [
    '# CI routing',
    '',
    '> Generated by AtlasMind from `ci-routing.json`. Edit the JSON, or the Pipeline page.',
    '',
    'Where each kind of check runs, and what happens when the hosted allowance is gone.',
    '',
    '## One rule that no file can change',
    '',
    'A workload whose input has **not been reviewed** may only run on a route that is safe for untrusted',
    'code. AtlasMind applies that before it looks at the budget and applies it to every fallback, so an',
    'exhausted allowance produces a refusal rather than moving unreviewed code onto somebody\'s computer.',
    'A rule that asks for otherwise is reported as an error and is not acted on.',
    '',
    '## Kinds of check',
    '',
    '| Workload | Needs evidence from | Input |',
    '|---|---|---|',
    ...CI_WORKLOAD_CLASSES.map(workload =>
      `| **${workload.label}** — ${workload.description} | ${workload.requiredEvidence} | ${workload.input} |`),
    '',
    '## Rules',
    '',
    '| Rule | Workload | Prefers | Falls back to | If the allowance is gone |',
    '|---|---|---|---|---|',
    ...config.rules.map(rule => {
      const workload = findCiWorkloadClass(rule.workload);
      const prefer = findCiRoute(rule.prefer)?.label ?? rule.prefer;
      const fallback = rule.fallback.length
        ? rule.fallback.map(id => findCiRoute(id)?.label ?? id).join(', ')
        : '—';
      return `| \`${rule.id}\` | ${workload?.label ?? rule.workload} | ${prefer} | ${fallback} | ${rule.onCreditExhausted === 'block' ? 'stop' : 'use the fallback'} |`;
    }),
    '',
  ];

  const noted = config.rules.filter(rule => rule.note);
  if (noted.length > 0) {
    lines.push('## Notes', '');
    for (const rule of noted) {
      lines.push(`- \`${rule.id}\` — ${rule.note}`);
    }
    lines.push('');
  }

  lines.push(
    '## When the allowance cannot be read',
    '',
    config.onCreditUnknown === 'fallback'
      ? 'This project falls back when the allowance cannot be read. Note that a billing API outage will move work off hosted runners.'
      : 'This project uses the preferred route when the allowance cannot be read, and says so. An unreadable meter is not an empty one.',
    '',
    `_Last updated ${config.updatedAt}._`,
    '',
  );
  return lines.join('\n');
}

// ── Persistence (node fs; vscode-free) ───────────────────────────
//
// Internal, unlike `workflowConfig`'s equivalents. Every read and write of this
// file goes through the manager below, which is what keeps "seeding never
// overwrites a newer-format file" true — an exported writer would be a way
// around that, and the only reason to export one would be a caller that does
// not exist.

function readCiRoutingFile(workspaceRoot: string): VersionedDocumentRead<CiRoutingConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path.join(workspaceRoot, CI_ROUTING_SSOT_PATH), 'utf8'));
  } catch {
    return { preserveExisting: false };
  }
  const read = interpretVersionedDocument('ci-routing', parsed, isCiRoutingConfig);
  return {
    ...read,
    ...(read.config === undefined ? {} : { config: sanitizeCiRoutingConfig(read.config)! }),
  };
}

async function writeCiRoutingConfig(workspaceRoot: string, config: CiRoutingConfig): Promise<void> {
  const configPath = path.join(workspaceRoot, CI_ROUTING_SSOT_PATH);
  const summaryPath = path.join(workspaceRoot, CI_ROUTING_SUMMARY_SSOT_PATH);
  await mkdir(path.dirname(configPath), { recursive: true });
  const updated: CiRoutingConfig = { ...config, updatedAt: new Date().toISOString() };
  await Promise.all([
    writeFile(configPath, JSON.stringify(updated, null, 2), 'utf-8'),
    writeFile(summaryPath, renderCiRoutingMarkdown(updated), 'utf-8'),
  ]);
}

/**
 * Holds the routing file for the extension host.
 *
 * Mirrors `WorkflowConfigManager`, including the part that matters: **never
 * seeded on render.** This file gets committed, and writing one because
 * somebody opened a tab would put a statement about how the team works into
 * their repository without being asked. Creating it is an explicit act.
 */
export class CiRoutingConfigManager {
  private config: CiRoutingConfig | undefined;
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
    const read = readCiRoutingFile(this.workspaceRoot);
    this.config = read.config;
    this.preserveExisting = read.preserveExisting;
    this.notice = read.notice;
  }

  getConfig(): CiRoutingConfig | undefined {
    return this.config;
  }

  getNotice(): string | undefined {
    return this.notice;
  }

  reload(): CiRoutingConfig | undefined {
    this.applyRead();
    return this.config;
  }

  async create(): Promise<CiRoutingConfig | undefined> {
    if (this.config) {
      return this.config;
    }
    if (this.preserveExisting) {
      return undefined;
    }
    const seeded = seedCiRoutingConfig();
    this.config = seeded;
    if (this.workspaceRoot) {
      await writeCiRoutingConfig(this.workspaceRoot, seeded);
    }
    return seeded;
  }

  async save(config: CiRoutingConfig): Promise<void> {
    this.config = config;
    if (this.workspaceRoot) {
      await writeCiRoutingConfig(this.workspaceRoot, config);
      this.preserveExisting = false;
      this.notice = undefined;
    }
  }
}
