/**
 * DeliveryManager — models a project's deployment stages (local → staging →
 * production …) and the promotion ("push") edges between them.
 *
 * Phase 1 is read-only modelling: the manager seeds a sensible, professional
 * pipeline from the repository's branch layout, persists it as the single
 * source of truth, and renders a human-readable markdown mirror so the pipeline
 * is understandable and editable by a newcomer without asking the AI. Later
 * phases add a stage editor and the guarded promotion engine.
 *
 * Like {@link ../core/dataPrivacyManager}, the persistence helpers are free of
 * the `vscode` API (node `fs` only) so the seeding and serialisation logic can
 * be unit tested in isolation.
 *
 * Safety-first defaults baked into the seed:
 *  - Production is `isProtected` and requires explicit approval before any push.
 *  - Production requires a data backup before promotion, but ships WITHOUT a
 *    backup command — deny-by-default means a promotion to production stays
 *    blocked until the user supplies one. The reasoning is surfaced verbatim in
 *    the dashboard and the markdown mirror.
 *  - No secret VALUES are ever stored — only labels and workspace-relative
 *    paths that point at where config/secrets live.
 */

import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import type {
  DeliveryConfig,
  DeploymentStage,
  DeploymentStageKind,
  PromotionPath,
} from '../types.js';

export const DELIVERY_SSOT_PATH = 'project_memory/operations/delivery.json';
export const DELIVERY_SUMMARY_SSOT_PATH = 'project_memory/operations/delivery.md';

/** Inputs used to seed a first-run pipeline from the repository's branches. */
export interface DeliverySeedInput {
  /** The branch currently checked out. */
  currentBranch: string;
  /** Detected production branch (already normalised, e.g. "master" / "main"). */
  productionBranch?: string;
  /** Detected integration branch, when one exists (e.g. "develop"). */
  developBranch?: string;
}

export function defaultDeliveryConfig(): DeliveryConfig {
  return { version: 1, stages: [], paths: [] };
}

// ── Seeding ──────────────────────────────────────────────────────

/**
 * Build a professional dev → staging → production pipeline from the detected
 * branch layout. Every field is filled with a sensible default and a plain
 * description so a first-time user sees a complete, well-reasoned setup rather
 * than an empty form. Everything seeded here is fully editable afterwards.
 */
export function seedDeliveryConfig(input: DeliverySeedInput): DeliveryConfig {
  const stagingBranch = input.developBranch ?? input.currentBranch;
  const productionBranch = input.productionBranch ?? 'main';

  const local: DeploymentStage = {
    id: 'stage-local',
    name: 'Local',
    kind: 'local',
    rank: 0,
    description:
      'Your own machine. Where you write and run code day to day. Data here is disposable — nothing your users see lives at this stage.',
    branchRef: undefined,
    config: { sourceLabel: '.env.local', sourcePath: '.env.local' },
    hosting: { provider: 'localhost' },
    data: { kind: 'local', label: 'Local development database (disposable)' },
    backupPolicy: { required: false },
    promotionPolicy: {
      requiresApproval: false,
      requireVersionBump: false,
      requireChangelog: false,
      requiredChecks: [],
    },
    rollbackPolicy: {},
    isProtected: false,
  };

  const staging: DeploymentStage = {
    id: 'stage-staging',
    name: 'Staging',
    kind: 'staging',
    rank: 1,
    description:
      'A production-like rehearsal environment. Changes land here first so they can be tested against realistic data and settings before any real users are affected.',
    branchRef: stagingBranch,
    config: { sourceLabel: '.env.staging', sourcePath: '.env.staging' },
    hosting: { provider: 'TBD', url: '', healthCheckUrl: '' },
    data: { kind: 'TBD', label: 'Staging database (safe to reset)' },
    backupPolicy: {
      required: false,
      retention: 'Optional — staging data is generally reproducible.',
    },
    promotionPolicy: {
      requiresApproval: false,
      requireVersionBump: true,
      requireChangelog: true,
      requiredChecks: ['Working tree clean', 'Compile passes', 'Tests pass'],
    },
    rollbackPolicy: {
      runbookRef: DELIVERY_SUMMARY_SSOT_PATH,
    },
    isProtected: false,
  };

  const production: DeploymentStage = {
    id: 'stage-production',
    name: 'Production',
    kind: 'production',
    rank: 2,
    description:
      'The live environment your real users depend on. Every change here is treated as high-risk: it is backed up first, requires sign-off, and is never force-pushed.',
    branchRef: productionBranch,
    config: { sourceLabel: '.env.production', sourcePath: '.env.production' },
    hosting: { provider: 'TBD', url: '', healthCheckUrl: '' },
    data: { kind: 'TBD', label: 'Production database (real user data)' },
    backupPolicy: {
      required: true,
      // Intentionally empty: deny-by-default keeps promotion to production
      // blocked until the user supplies a real backup command.
      command: '',
      runbookRef: DELIVERY_SUMMARY_SSOT_PATH,
      retention: 'Recommended: keep at least 7 daily snapshots.',
    },
    promotionPolicy: {
      requiresApproval: true,
      requireVersionBump: true,
      requireChangelog: true,
      requiredChecks: [
        'Working tree clean',
        'Compile passes',
        'Tests pass',
        'CI green',
        'Staging verified',
      ],
    },
    rollbackPolicy: {
      runbookRef: DELIVERY_SUMMARY_SSOT_PATH,
    },
    isProtected: true,
  };

  const paths: PromotionPath[] = [
    {
      id: 'promote-local-staging',
      fromStageId: local.id,
      toStageId: staging.id,
      routineId: 'promote-staging',
    },
    {
      id: 'promote-staging-production',
      fromStageId: staging.id,
      toStageId: production.id,
      routineId: 'promote-production',
    },
  ];

  return {
    version: 1,
    stages: [local, staging, production],
    paths,
    updatedAt: new Date().toISOString(),
  };
}

// ── Validation ───────────────────────────────────────────────────

function isDeliveryConfig(value: unknown): value is DeliveryConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate['version'] === 1
    && Array.isArray(candidate['stages'])
    && Array.isArray(candidate['paths']);
}

const STAGE_KINDS: DeploymentStageKind[] = ['local', 'development', 'staging', 'production', 'preview', 'custom'];
const MAX_FIELD = 240;
const MAX_LONG = 2000;
const MAX_PATH = 400;

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function clampStr(value: unknown, max = MAX_FIELD): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function optStr(value: unknown, max = MAX_FIELD): string | undefined {
  const trimmed = clampStr(value, max);
  return trimmed.length > 0 ? trimmed : undefined;
}

function asBool(value: unknown): boolean {
  return value === true;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || String(Date.now());
}

/**
 * Coerce an untrusted payload (e.g. from the dashboard stage editor) into a
 * well-formed {@link DeliveryConfig}: strings are trimmed and length-capped,
 * unknown stage kinds fall back to `custom`, ids are de-duplicated and
 * generated when missing, and promotion edges that reference a non-existent
 * (or self) stage are dropped. Returns `undefined` when the top-level shape is
 * not a delivery config at all. This is the webview → disk security boundary;
 * no secret values are ever expected here (only labels/paths/commands).
 */
export function sanitizeDeliveryConfig(input: unknown): DeliveryConfig | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const raw = input as Record<string, unknown>;
  if (raw['version'] !== 1 || !Array.isArray(raw['stages']) || !Array.isArray(raw['paths'])) {
    return undefined;
  }

  const usedStageIds = new Set<string>();
  const stages: DeploymentStage[] = [];
  for (const item of raw['stages'] as unknown[]) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const s = item as Record<string, unknown>;
    const name = clampStr(s['name'], 120);
    if (!name) {
      continue;
    }
    let id = clampStr(s['id'], 80) || `stage-${slugify(name)}`;
    while (usedStageIds.has(id)) {
      id = `${id}-${usedStageIds.size}`;
    }
    usedStageIds.add(id);

    const kindRaw = clampStr(s['kind'], 40) as DeploymentStageKind;
    const kind = STAGE_KINDS.includes(kindRaw) ? kindRaw : 'custom';
    const rankNum = Number(s['rank']);
    const rank = Number.isFinite(rankNum) ? Math.max(0, Math.min(99, Math.trunc(rankNum))) : stages.length;

    const config = asObject(s['config']);
    const hosting = asObject(s['hosting']);
    const data = asObject(s['data']);
    const backup = asObject(s['backupPolicy']);
    const promo = asObject(s['promotionPolicy']);
    const rollback = asObject(s['rollbackPolicy']);

    stages.push({
      id,
      name,
      kind,
      rank,
      description: clampStr(s['description'], MAX_LONG),
      branchRef: optStr(s['branchRef'], 200),
      config: {
        sourceLabel: optStr(config['sourceLabel']),
        sourcePath: optStr(config['sourcePath'], MAX_PATH),
      },
      hosting: {
        provider: optStr(hosting['provider']),
        url: optStr(hosting['url'], MAX_PATH),
        healthCheckUrl: optStr(hosting['healthCheckUrl'], MAX_PATH),
      },
      data: {
        kind: optStr(data['kind']),
        label: optStr(data['label']),
        migrationsPath: optStr(data['migrationsPath'], MAX_PATH),
      },
      backupPolicy: {
        required: asBool(backup['required']),
        command: optStr(backup['command'], MAX_LONG),
        runbookRef: optStr(backup['runbookRef'], MAX_PATH),
        retention: optStr(backup['retention']),
      },
      promotionPolicy: {
        requiresApproval: asBool(promo['requiresApproval']),
        requireVersionBump: asBool(promo['requireVersionBump']),
        requireChangelog: asBool(promo['requireChangelog']),
        requiredChecks: Array.isArray(promo['requiredChecks'])
          ? (promo['requiredChecks'] as unknown[]).map(check => clampStr(check, 120)).filter(Boolean).slice(0, 30)
          : [],
      },
      rollbackPolicy: {
        command: optStr(rollback['command'], MAX_LONG),
        runbookRef: optStr(rollback['runbookRef'], MAX_PATH),
      },
      isProtected: asBool(s['isProtected']),
    });
  }

  const stageIds = new Set(stages.map(stage => stage.id));
  const usedPathIds = new Set<string>();
  const paths: PromotionPath[] = [];
  for (const item of raw['paths'] as unknown[]) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const p = item as Record<string, unknown>;
    const fromStageId = clampStr(p['fromStageId'], 80);
    const toStageId = clampStr(p['toStageId'], 80);
    if (!stageIds.has(fromStageId) || !stageIds.has(toStageId) || fromStageId === toStageId) {
      continue;
    }
    let id = clampStr(p['id'], 100) || `promote-${fromStageId}-${toStageId}`;
    while (usedPathIds.has(id)) {
      id = `${id}-${usedPathIds.size}`;
    }
    usedPathIds.add(id);

    const last = asObject(p['lastPromotion']);
    const hasLast = typeof p['lastPromotion'] === 'object' && p['lastPromotion'] !== null && typeof last['ranAt'] === 'string';
    paths.push({
      id,
      fromStageId,
      toStageId,
      routineId: optStr(p['routineId'], 120),
      lastPromotion: hasLast
        ? {
            ranAt: clampStr(last['ranAt'], 40),
            succeeded: asBool(last['succeeded']),
            version: optStr(last['version'], 40),
            runId: optStr(last['runId'], 120),
            rollbackHandle: optStr(last['rollbackHandle'], 200),
          }
        : undefined,
    });
  }

  return { version: 1, stages, paths, updatedAt: new Date().toISOString() };
}

// ── Persistence (node fs; vscode-free) ───────────────────────────

export function readDeliveryConfig(workspaceRoot: string): DeliveryConfig | undefined {
  const configPath = path.join(workspaceRoot, DELIVERY_SSOT_PATH);
  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return isDeliveryConfig(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Persist the config as JSON (source of truth) and regenerate the human-readable
 * markdown mirror alongside it. Both files live in `project_memory/operations/`.
 */
export async function writeDeliveryConfig(workspaceRoot: string, config: DeliveryConfig): Promise<void> {
  const configPath = path.join(workspaceRoot, DELIVERY_SSOT_PATH);
  const summaryPath = path.join(workspaceRoot, DELIVERY_SUMMARY_SSOT_PATH);
  await mkdir(path.dirname(configPath), { recursive: true });
  const updated: DeliveryConfig = { ...config, updatedAt: new Date().toISOString() };
  await Promise.all([
    writeFile(configPath, JSON.stringify(updated, null, 2), 'utf-8'),
    writeFile(summaryPath, renderDeliveryMarkdown(updated), 'utf-8'),
  ]);
}

// ── Markdown mirror ──────────────────────────────────────────────

/**
 * Render the natural-language companion document. The goal is that a developer
 * who has never used AtlasMind can read this file top to bottom and understand
 * the whole pipeline, the safety reasoning, and how a promotion proceeds.
 */
export function renderDeliveryMarkdown(config: DeliveryConfig): string {
  const lines: string[] = [];
  lines.push('# Delivery Pipeline');
  lines.push('');
  lines.push('> Maintained by AtlasMind (Project Dashboard → Delivery). This is the human-readable');
  lines.push('> mirror of `delivery.json`; edit either and the other is kept in sync from the dashboard.');
  lines.push('');
  lines.push('A **stage** is one environment your software runs in. A **promotion** ("push") moves a');
  lines.push('build from one stage to the next — safely, with a backup taken first and the listed');
  lines.push('checks required to pass before anything changes.');
  lines.push('');

  lines.push('## Stages');
  lines.push('');
  const orderedStages = [...config.stages].sort((a, b) => a.rank - b.rank);
  for (const stage of orderedStages) {
    lines.push(`### ${stage.rank + 1}. ${stage.name} — \`${stage.kind}\`${stage.isProtected ? ' 🔒 protected' : ''}`);
    lines.push('');
    lines.push(stage.description);
    lines.push('');
    lines.push(`- **Branch:** ${stage.branchRef ? `\`${stage.branchRef}\`` : '— (working tree)'}`);
    lines.push(`- **Hosting:** ${describe(stage.hosting.provider)}${stage.hosting.url ? ` — ${stage.hosting.url}` : ''}`);
    if (stage.hosting.healthCheckUrl) {
      lines.push(`- **Health check:** ${stage.hosting.healthCheckUrl}`);
    }
    lines.push(`- **Config source:** ${describe(stage.config.sourceLabel)} (location only — secret values stay in your secret store)`);
    lines.push(`- **Data:** ${describe(stage.data.label ?? stage.data.kind)}`);
    lines.push(`- **Backup before promotion:** ${stage.backupPolicy.required ? 'required' : 'not required'}${
      stage.backupPolicy.required && !stage.backupPolicy.command
        ? ' — ⚠️ no backup command set yet, so promotion to this stage is blocked until you add one'
        : ''
    }`);
    if (stage.backupPolicy.retention) {
      lines.push(`  - Retention: ${stage.backupPolicy.retention}`);
    }
    lines.push('');
  }

  lines.push('## Promotions');
  lines.push('');
  for (const promo of config.paths) {
    const from = config.stages.find(s => s.id === promo.fromStageId);
    const to = config.stages.find(s => s.id === promo.toStageId);
    if (!from || !to) {
      continue;
    }
    lines.push(`### ${from.name} → ${to.name}`);
    lines.push('');
    lines.push('Every promotion runs the same guarded sequence:');
    lines.push('');
    lines.push('1. **Preflight gate** — the required checks below must all pass, or the promotion aborts.');
    lines.push(`2. **Backup** — ${to.backupPolicy.required ? `a snapshot of **${to.name}** is taken before any change, so it can be recovered` : 'optional for this target'}.`);
    lines.push('3. **Promote** — the build is merged/tagged forward. AtlasMind never force-pushes.');
    lines.push('4. **Verify** — the target is health-checked after deploy.');
    lines.push('');
    const checks = to.promotionPolicy.requiredChecks;
    lines.push(`- **Required checks:** ${checks.length > 0 ? checks.map(c => `\`${c}\``).join(', ') : 'none configured'}`);
    lines.push(`- **Approval:** ${to.promotionPolicy.requiresApproval ? 'a human must sign off before anything runs' : 'not required'}`);
    lines.push(`- **Version bump required:** ${to.promotionPolicy.requireVersionBump ? 'yes' : 'no'}`);
    lines.push(`- **Changelog entry required:** ${to.promotionPolicy.requireChangelog ? 'yes' : 'no'}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`_Last updated: ${config.updatedAt ?? 'unknown'}._`);
  lines.push('');
  return lines.join('\n');
}

function describe(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : '—';
}

// ── Service ──────────────────────────────────────────────────────

/**
 * Workspace-scoped holder for the delivery config. Reads the persisted pipeline
 * at construction and serves it to the dashboard; seeds and persists a default
 * pipeline on first use. The guarded promotion engine (later phase) will hang
 * off this service.
 */
export class DeliveryManager {
  private config: DeliveryConfig | undefined;

  constructor(private readonly workspaceRoot: string | undefined) {
    this.config = workspaceRoot ? readDeliveryConfig(workspaceRoot) : undefined;
  }

  getConfig(): DeliveryConfig | undefined {
    return this.config;
  }

  hasConfig(): boolean {
    return this.config !== undefined;
  }

  /** Re-read the config from disk (e.g. after the file was edited externally). */
  reload(): DeliveryConfig | undefined {
    this.config = this.workspaceRoot ? readDeliveryConfig(this.workspaceRoot) : undefined;
    return this.config;
  }

  /**
   * Return the existing config, or seed + persist a default pipeline if none
   * exists yet. Persistence is best-effort: if the workspace is read-only the
   * seeded config is still returned in memory.
   */
  async ensureSeeded(seed: DeliverySeedInput): Promise<DeliveryConfig> {
    if (this.config) {
      return this.config;
    }
    const seeded = seedDeliveryConfig(seed);
    this.config = seeded;
    if (this.workspaceRoot) {
      try {
        await writeDeliveryConfig(this.workspaceRoot, seeded);
      } catch {
        // Best-effort; the in-memory config is still served.
      }
    }
    return seeded;
  }

  /** Persist an updated config (e.g. from the stage editor) and cache it. */
  async save(config: DeliveryConfig): Promise<void> {
    this.config = config;
    if (this.workspaceRoot) {
      await writeDeliveryConfig(this.workspaceRoot, config);
    }
  }
}
