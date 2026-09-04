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
import {
  deploysToHostedEnvironment,
  fromDeliveryArchetype,
  type ArchetypeTrait,
  type ProjectArchetype,
} from './projectArchetype.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import type {
  DeliveryConfig,
  DeploymentStage,
  DeploymentStageKind,
  PromotionHistoryEntry,
  PromotionPath,
  RoutineDefinition,
} from '../types.js';

export const DELIVERY_SSOT_PATH = 'project_memory/operations/delivery.json';
export const DELIVERY_SUMMARY_SSOT_PATH = 'project_memory/operations/delivery.md';
export const DELIVERY_HISTORY_SSOT_PATH = 'project_memory/operations/delivery-history.json';

/** Most recent promotion/rollback records retained on disk. */
const MAX_HISTORY = 200;

export function readPromotionHistory(workspaceRoot: string): PromotionHistoryEntry[] {
  try {
    const raw = readFileSync(path.join(workspaceRoot, DELIVERY_HISTORY_SSOT_PATH), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PromotionHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

/** Append an audit record (newest first), capped at {@link MAX_HISTORY}. */
export async function appendPromotionHistory(workspaceRoot: string, entry: PromotionHistoryEntry): Promise<void> {
  const file = path.join(workspaceRoot, DELIVERY_HISTORY_SSOT_PATH);
  const history = readPromotionHistory(workspaceRoot);
  history.unshift(entry);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(history.slice(0, MAX_HISTORY), null, 2), 'utf-8');
}

// ── Concurrency lock ─────────────────────────────────────────────

export const DELIVERY_LOCK_SSOT_PATH = 'project_memory/operations/.delivery-lock.json';
/** A lock older than this is treated as stale (a crashed run) and ignored. */
const LOCK_STALE_MS = 60 * 60 * 1000;

export interface DeliveryLock {
  label: string;
  startedAt: string;
}

/** Return a live (non-stale) lock if one is held, else undefined. */
export function readDeliveryLock(workspaceRoot: string): DeliveryLock | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path.join(workspaceRoot, DELIVERY_LOCK_SSOT_PATH), 'utf8')) as DeliveryLock;
    if (!parsed || typeof parsed.startedAt !== 'string') {
      return undefined;
    }
    return (Date.now() - new Date(parsed.startedAt).getTime() > LOCK_STALE_MS) ? undefined : parsed;
  } catch {
    return undefined;
  }
}

/** Acquire the single-flight delivery lock; returns false if one is already held. */
export async function acquireDeliveryLock(workspaceRoot: string, label: string): Promise<boolean> {
  if (readDeliveryLock(workspaceRoot)) {
    return false;
  }
  const file = path.join(workspaceRoot, DELIVERY_LOCK_SSOT_PATH);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ label, startedAt: new Date().toISOString() }, null, 2), 'utf-8');
  return true;
}

export async function releaseDeliveryLock(workspaceRoot: string): Promise<void> {
  try {
    await rm(path.join(workspaceRoot, DELIVERY_LOCK_SSOT_PATH));
  } catch {
    // Already released.
  }
}

/**
 * Broad project shape used to tailor the seeded pipeline to reality.
 *
 * @deprecated Superseded by `ProjectArchetype` in `projectArchetype.ts`, which
 * is the single vocabulary shared with the testing scaffolder, the bootstrap
 * intake, and the guided workflow. This alias remains only so callers that have
 * not migrated keep compiling; `seedDeliveryConfig` maps it forward.
 *
 * It was never persisted — `delivery.json` holds no archetype — so retiring it
 * needs no schema migration.
 */
export type DeliveryArchetype = 'vscode-extension' | 'library' | 'web-service' | 'generic';

/**
 * Signals imported from the repository to seed a pipeline that reflects the
 * delivery protocol *already in place* — not a generic template. Everything is
 * optional so callers can supply only what they can detect; sensible defaults
 * fill the rest.
 */
export interface DeliverySeedInput {
  /** The branch currently checked out. */
  currentBranch: string;
  /** Detected production branch (e.g. "master" / "main"). */
  productionBranch?: string;
  /** Detected integration branch, when one exists (e.g. "develop"). */
  developBranch?: string;
  /**
   * Project shape; drives stage naming and whether a database/backups apply.
   *
   * @deprecated Supply `projectArchetype` (and optionally `traits`) instead.
   * Both are read, with the new vocabulary taking precedence when present.
   */
  archetype?: DeliveryArchetype;
  /** Project shape in the shared vocabulary. Takes precedence over `archetype`. */
  projectArchetype?: ProjectArchetype;
  /** Composable facts about the project — `has-server` in particular affects staging. */
  traits?: readonly ArchetypeTrait[];
  /** Whether the project has an application database (drives backup-required). */
  hasDatabase?: boolean;
  /** Where production ships (e.g. "VS Code Marketplace", "npm registry", "Fly.io"). */
  publishTarget?: string;
  /** Public production URL, when derivable (e.g. from fly.toml app name). */
  productionUrl?: string;
  /** Detected env/config files per stage role (workspace-relative names). */
  envFiles?: { local?: string; staging?: string; production?: string };
  /** Which standard npm scripts exist, used to derive required checks. */
  scripts?: { build?: boolean; lint?: boolean; test?: boolean };
  /** Whether CI workflows are present (adds a "CI green" gate). */
  hasCi?: boolean;
  /** Existing routine id to bind to the production promotion path. */
  productionRoutineId?: string;
  /** Existing routine id to bind to the staging/integration promotion path. */
  stagingRoutineId?: string;
  /** Whether promotion into the integration/production branch goes via a Pull Request. */
  viaPullRequest?: { staging?: boolean; production?: boolean };
  /** CI status-check names gating the integration/production branch. */
  statusChecks?: { staging?: string[]; production?: string[] };
  /** CD workflow file to dispatch for promotion (trigger CD instead of local deploy). */
  dispatchWorkflow?: { staging?: string; production?: string };
}

// ── Project-specific delivery guide ─────────────────────────────

export type DeliveryGuideStepStatus = 'configured' | 'conventional' | 'manual' | 'missing';
export type DeliveryGuidePhaseId = 'prepare' | 'validate' | 'package' | 'deploy' | 'publish';

export interface DeliveryGuideStep {
  id: string;
  /**
   * The address a surface uses to name this step, unique across every runbook
   * on the page.
   *
   * `id` names the step *within its runbook* and repeats across stages: the
   * Local and Production runbooks both derive `validate-test-1` from the same
   * `test` script. Once one page shows a runbook per stage, an action carrying
   * only `id` is ambiguous about which environment it belongs to — and the two
   * are not interchangeable, because the same-looking column ends in `npm test`
   * for one stage and `vsce publish` for another. The key carries the stage id
   * verbatim (the delivery config's sanitizer clamps and de-duplicates those),
   * so host-side resolution is exact string equality and can never land on a
   * neighbouring stage's command.
   */
  key: string;
  label: string;
  detail: string;
  status: DeliveryGuideStepStatus;
  /** Display-only. Rendering this command never authorizes or executes it. */
  command?: string;
  /** Safe workspace-relative evidence path, when one exists. */
  path?: string;
  /** Missing this item prevents a trustworthy delivery path. */
  blocking: boolean;
}

export interface DeliveryGuidePhase {
  /** Which *kind* of column this is. Repeats across stages by design. */
  id: DeliveryGuidePhaseId;
  /** Unique address across every runbook on the page. See {@link DeliveryGuideStep.key}. */
  key: string;
  label: string;
  description: string;
  steps: DeliveryGuideStep[];
}

export interface ProjectDeliveryGuide {
  /**
   * The delivery stage this runbook describes, when the pipeline declares one.
   *
   * Absent means the runbook is about the project as a whole — the shape every
   * caller got before the page grew one runbook per stage, and still what a
   * project with no configured pipeline gets.
   */
  stageId?: string;
  /** What to call this runbook on screen. `Project` when no stage is claimed. */
  stageName: string;
  stageKind?: DeploymentStageKind;
  stageRank?: number;
  /** Promotions into this stage always confirm and never force-push. */
  isProtected: boolean;
  /** The branch whose committed version represents this stage, when declared. */
  branchRef?: string;
  ecosystem: string;
  toolchain: string;
  target: string;
  configuredCount: number;
  totalCount: number;
  blockerCount: number;
  phases: DeliveryGuidePhase[];
}

export interface DeliveryGuideWorkflowInput {
  name: string;
  path: string;
  triggers: readonly string[];
}

/**
 * Read-only evidence used to explain how this particular project ships.
 *
 * Manifest text and routine commands are workspace-authored, untrusted data.
 * The builder strips controls, caps lengths, and only returns commands for
 * display. The dashboard cannot execute a guide step; guarded promotion keeps
 * its separate server-side command source and authorization boundary.
 */
export interface ProjectDeliveryGuideInput {
  /**
   * Which stage the runbook is for. Must be the id of a stage in
   * `deliveryConfig`; an id that resolves to nothing produces an *unstaged*
   * runbook rather than a differently-staged one, because a runbook labelled
   * for a stage that does not exist is worse than one that claims no stage.
   *
   * Omitted means production — what a single-runbook caller has always meant
   * by "how does this project ship".
   */
  stageId?: string;
  files: readonly string[];
  manifestContents?: Readonly<Record<string, string>>;
  packageJson?: unknown;
  deliveryConfig?: DeliveryConfig;
  routines?: readonly RoutineDefinition[];
  workflows?: readonly DeliveryGuideWorkflowInput[];
  workingTreeClean?: boolean;
}

const GUIDE_PHASE_COPY: Record<DeliveryGuidePhaseId, { label: string; description: string }> = {
  prepare: { label: 'Prerequisites', description: 'What must be present before a release attempt is meaningful.' },
  validate: { label: 'Validate', description: 'Project checks detected from scripts or the runtime convention. Nothing is run on refresh.' },
  package: { label: 'Package', description: 'How source becomes the artifact that is shipped.' },
  deploy: { label: 'Deploy', description: 'How the artifact moves into a hosted environment or production branch.' },
  publish: { label: 'Publish', description: 'How the finished version reaches a registry, marketplace, or release channel.' },
};

/**
 * The column heading for one stage's runbook.
 *
 * Only two columns genuinely change meaning between stages, and both are on the
 * local one: there is nothing to *deploy* on your own machine — the equivalent
 * act is starting the project — and the prerequisites are about being able to
 * build at all rather than about a release being meaningful. Every other column
 * keeps one wording across stages on purpose, so a column that looks the same in
 * two runbooks *is* the same question asked of two environments.
 */
function guidePhaseCopy(
  phaseId: DeliveryGuidePhaseId,
  stage: DeploymentStage | undefined,
  stageName: string,
): { label: string; description: string } {
  if (stage?.kind === 'local') {
    if (phaseId === 'prepare') {
      return {
        label: 'Prerequisites',
        description: 'What must be present before this project will build and run on your own machine.',
      };
    }
    if (phaseId === 'deploy') {
      return {
        label: 'Run it here',
        description: 'How to start the project on this machine. Nothing here leaves your computer.',
      };
    }
  }
  const base = GUIDE_PHASE_COPY[phaseId];
  if (!stage || phaseId !== 'deploy') {
    return base;
  }
  const branch = guideText(stage.branchRef, 120);
  return {
    label: base.label,
    description: `How the artifact reaches ${stageName}${branch ? ` (branch ${branch})` : ''}.`,
  };
}

function guideText(value: unknown, max = 800): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max)
    : '';
}

function guidePath(value: unknown): string | undefined {
  const normalized = guideText(value, 400).replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || path.isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    return undefined;
  }
  return normalized;
}

function guideId(phase: DeliveryGuidePhaseId, label: string, index: number): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'step';
  return `${phase}-${slug}-${index + 1}`;
}

/**
 * The page-wide address of a phase or step. The stage id is carried verbatim
 * rather than slugged: two stage ids that differ only in punctuation must stay
 * two addresses, and the config sanitizer has already clamped and de-duplicated
 * them. Without a stage the local id is already unique on the page.
 */
function guideKey(stageId: string | undefined, id: string): string {
  return stageId ? `${stageId}::${id}` : id;
}

/**
 * Derive the newcomer-facing delivery runbook from facts already committed to
 * the repository. Exact project scripts/routines are labelled `configured`;
 * standard runtime commands are labelled `conventional`; human-only gates stay
 * `manual`; absent load-bearing facts are `missing` rather than guessed.
 *
 * The runbook is written **for one stage**. That used to be implicit — the
 * builder read the production stage and produced a single guide — which meant
 * a project with a Local, a Staging and a Production environment had exactly
 * one answer to "how do I run this", and it was the production one. Every fact
 * that differs between environments (the version-bump and changelog gates, the
 * required checks, the backup, the dispatch workflow, the reviewed pull
 * request, whether anything is published at all) comes off the *selected*
 * stage, so the three runbooks differ where the pipeline says they differ and
 * nowhere else.
 */
export function buildProjectDeliveryGuide(input: ProjectDeliveryGuideInput): ProjectDeliveryGuide {
  const originalFiles = input.files.map(file => guidePath(file)).filter((file): file is string => file !== undefined);
  const fileByLower = new Map(originalFiles.map(file => [file.toLowerCase(), file]));
  const hasFile = (...candidates: string[]): boolean => candidates.some(candidate => fileByLower.has(candidate.toLowerCase()));
  const firstFile = (...candidates: string[]): string | undefined => {
    for (const candidate of candidates) {
      const found = fileByLower.get(candidate.toLowerCase());
      if (found) { return found; }
    }
    return undefined;
  };
  const manifests = new Map<string, string>();
  for (const [name, content] of Object.entries(input.manifestContents ?? {})) {
    const safe = guidePath(name);
    // Preserve line boundaries for anchored manifest syntax (`go 1.24`, Cargo
    // tables, and similar). Matched values are passed through `guideText`
    // before they can reach the view model.
    if (safe && typeof content === 'string') { manifests.set(safe.toLowerCase(), content.slice(0, 60_000)); }
  }
  const manifest = (name: string): string => manifests.get(name.toLowerCase()) ?? '';

  const rawPackage = typeof input.packageJson === 'object' && input.packageJson !== null
    ? input.packageJson as Record<string, unknown>
    : {};
  const rawScripts = typeof rawPackage['scripts'] === 'object' && rawPackage['scripts'] !== null
    ? rawPackage['scripts'] as Record<string, unknown>
    : {};
  const scripts = new Map<string, string>();
  for (const [name, command] of Object.entries(rawScripts)) {
    const safeName = guideText(name, 100);
    const safeCommand = guideText(command, 1_200);
    if (safeName && safeCommand) { scripts.set(safeName, safeCommand); }
  }

  const packageFile = firstFile('package.json');
  const pyproject = firstFile('pyproject.toml', 'requirements.txt');
  const goMod = firstFile('go.mod');
  const cargo = firstFile('Cargo.toml');
  const pom = firstFile('pom.xml');
  const gradle = firstFile('build.gradle', 'build.gradle.kts');
  const dotnet = originalFiles.find(file => /(?:^|\/)[^/]+\.(?:sln|csproj)$/i.test(file));
  const dockerfile = firstFile('Dockerfile');

  let ecosystem = 'Undeclared';
  let manifestPath: string | undefined;
  if (packageFile || Object.keys(rawPackage).length > 0) { ecosystem = 'Node.js'; manifestPath = packageFile; }
  else if (pyproject) { ecosystem = 'Python'; manifestPath = pyproject; }
  else if (goMod) { ecosystem = 'Go'; manifestPath = goMod; }
  else if (cargo) { ecosystem = 'Rust'; manifestPath = cargo; }
  else if (pom || gradle) { ecosystem = pom ? 'Java / Maven' : 'Java / Gradle'; manifestPath = pom ?? gradle; }
  else if (dotnet) { ecosystem = '.NET'; manifestPath = dotnet; }
  else if (dockerfile) { ecosystem = 'Container'; manifestPath = dockerfile; }

  let toolchain = ecosystem;
  let installCommand = '';
  if (ecosystem === 'Node.js') {
    const declared = guideText(rawPackage['packageManager'], 80).split('@')[0]?.toLowerCase();
    const manager = declared === 'pnpm' || declared === 'yarn' || declared === 'bun' || declared === 'npm'
      ? declared
      : hasFile('pnpm-lock.yaml') ? 'pnpm'
        : hasFile('yarn.lock') ? 'yarn'
          : hasFile('bun.lock', 'bun.lockb') ? 'bun'
            : 'npm';
    toolchain = manager;
    installCommand = manager === 'pnpm' ? 'pnpm install --frozen-lockfile'
      : manager === 'yarn' ? 'yarn install --immutable'
        : manager === 'bun' ? 'bun install --frozen-lockfile'
          : hasFile('package-lock.json', 'npm-shrinkwrap.json') ? 'npm ci' : 'npm install';
  } else if (ecosystem === 'Python') {
    if (hasFile('uv.lock')) { toolchain = 'Python + uv'; installCommand = 'uv sync --frozen'; }
    else if (hasFile('poetry.lock')) { toolchain = 'Python + Poetry'; installCommand = 'poetry install --sync'; }
    else if (hasFile('requirements.txt')) { toolchain = 'Python + pip'; installCommand = 'python -m pip install -r requirements.txt'; }
    else { toolchain = 'Python'; }
  } else if (ecosystem === 'Go') { toolchain = 'Go modules'; installCommand = 'go mod download'; }
  else if (ecosystem === 'Rust') { toolchain = 'Cargo'; installCommand = hasFile('Cargo.lock') ? 'cargo fetch --locked' : 'cargo fetch'; }
  else if (ecosystem === 'Java / Maven') { toolchain = hasFile('mvnw', 'mvnw.cmd') ? 'Maven Wrapper' : 'Maven'; installCommand = `${hasFile('mvnw', 'mvnw.cmd') ? './mvnw' : 'mvn'} dependency:go-offline`; }
  else if (ecosystem === 'Java / Gradle') { toolchain = hasFile('gradlew', 'gradlew.bat') ? 'Gradle Wrapper' : 'Gradle'; installCommand = `${hasFile('gradlew', 'gradlew.bat') ? './gradlew' : 'gradle'} dependencies`; }
  else if (ecosystem === '.NET') { toolchain = '.NET SDK'; installCommand = 'dotnet restore'; }

  const config = input.deliveryConfig;
  const orderedStages = [...(config?.stages ?? [])].sort((a, b) => a.rank - b.rank);
  // Which environment this runbook is about. A caller that names a stage gets
  // that stage or nothing; a caller that names none gets production, which is
  // what a single-runbook caller has always meant.
  const stage = input.stageId
    ? orderedStages.find(candidate => candidate.id === input.stageId)
    : orderedStages.find(candidate => candidate.kind === 'production') ?? orderedStages.at(-1);
  const isLocalStage = stage?.kind === 'local';
  const stageName = guideText(stage?.name, 120) || 'Project';
  const stageKey = stage?.id;
  const target = guideText(stage?.hosting.provider) && !/^tbd$/i.test(guideText(stage?.hosting.provider))
    ? guideText(stage?.hosting.provider)
    : 'Not configured';
  const stagePaths = (config?.paths ?? []).filter(candidate => candidate.toStageId === stage?.id);
  const boundRoutineIds = new Set(stagePaths.map(candidate => candidate.routineId).filter((id): id is string => Boolean(id)));
  const routines = (input.routines ?? []).filter(routine => boundRoutineIds.has(routine.id));

  const phases = new Map<DeliveryGuidePhaseId, DeliveryGuidePhase>();
  for (const id of ['prepare', 'validate', 'package', 'deploy', 'publish'] as const) {
    phases.set(id, { id, key: guideKey(stageKey, id), ...guidePhaseCopy(id, stage, stageName), steps: [] });
  }
  const seenCommands = new Set<string>();
  const add = (
    phaseId: DeliveryGuidePhaseId,
    step: Omit<DeliveryGuideStep, 'id' | 'key'>,
  ): void => {
    const phase = phases.get(phaseId)!;
    const command = guideText(step.command, 1_200);
    if (command && seenCommands.has(command)) { return; }
    if (command) { seenCommands.add(command); }
    const safePath = guidePath(step.path);
    const id = guideId(phaseId, step.label, phase.steps.length);
    phase.steps.push({
      ...step,
      ...(command ? { command } : {}),
      ...(safePath ? { path: safePath } : {}),
      id,
      key: guideKey(stageKey, id),
    });
  };

  add('prepare', {
    label: manifestPath ? `${ecosystem} project manifest` : 'Project manifest',
    detail: manifestPath ? `Detected ${manifestPath}.` : 'No supported root manifest was detected, so AtlasMind cannot derive a trustworthy build path.',
    status: manifestPath ? 'configured' : 'missing',
    ...(manifestPath ? { path: manifestPath } : {}),
    blocking: !manifestPath,
  });
  if (installCommand) {
    add('prepare', {
      label: `Restore dependencies with ${toolchain}`,
      detail: 'Detected from the project manifest and lockfile. Confirm the required runtime is installed on this machine.',
      command: installCommand,
      path: manifestPath,
      status: 'conventional',
      blocking: false,
    });
  } else {
    add('prepare', {
      label: 'Dependency restore',
      detail: 'No deterministic dependency-restore command could be derived. Document the project setup command for new contributors.',
      status: 'manual',
      blocking: false,
    });
  }

  const runtimeRequirement = (() => {
    if (ecosystem === 'Node.js') {
      const engines = typeof rawPackage['engines'] === 'object' && rawPackage['engines'] !== null ? rawPackage['engines'] as Record<string, unknown> : {};
      return guideText(engines['node'], 80);
    }
    if (ecosystem === 'Python') { return manifest('pyproject.toml').match(/requires-python\s*=\s*["']([^"']+)/i)?.[1] ?? ''; }
    if (ecosystem === 'Go') { return manifest('go.mod').match(/^go\s+([^\s]+)/m)?.[1] ?? ''; }
    if (ecosystem === 'Rust') { return hasFile('rust-toolchain.toml', 'rust-toolchain') ? 'declared in rust-toolchain' : ''; }
    if (ecosystem === '.NET') { return hasFile('global.json') ? 'declared in global.json' : ''; }
    return '';
  })();
  add('prepare', {
    label: 'Runtime requirement',
    detail: runtimeRequirement
      ? `${ecosystem} requirement: ${guideText(runtimeRequirement, 120)}. AtlasMind has detected the declaration, not verified the installed runtime.`
      : `No ${ecosystem === 'Undeclared' ? 'runtime' : ecosystem} version requirement was detected. New machines may reproduce a different build.`,
    status: runtimeRequirement ? 'configured' : 'manual',
    path: manifestPath,
    blocking: false,
  });
  // A dirty tree means opposite things at opposite ends of the pipeline. On
  // your own machine it is the ordinary state of working; on a stage you
  // promote *into*, it means the artifact would not represent what is on disk.
  // Grading local uncommitted work as a blocker would make the one runbook a
  // developer reads every day permanently red for doing its job.
  add('prepare', {
    label: 'Working tree clean',
    detail: isLocalStage
      ? input.workingTreeClean === false
        ? 'Pending changes are normal while you work here. They matter when you promote, not when you run.'
        : 'No pending workspace changes were detected.'
      : input.workingTreeClean === true
        ? 'No pending workspace changes were detected.'
        : input.workingTreeClean === false
          ? 'The working tree has pending changes; a package or tag would not represent everything on disk.'
          : 'Git cleanliness was not available and must be checked before shipping.',
    status: input.workingTreeClean === true
      ? 'configured'
      : isLocalStage ? 'manual' : input.workingTreeClean === false ? 'missing' : 'manual',
    command: 'git status --short',
    blocking: !isLocalStage && input.workingTreeClean === false,
  });
  const requiresVersionBump = stage?.promotionPolicy.requireVersionBump === true;
  if (requiresVersionBump) {
    const versionScript = ['prepare:release', 'release:prepare', 'version:bump', 'bump:version', 'version']
      .find(name => scripts.has(name));
    const currentVersion = guideText(rawPackage['version'], 80);
    add('prepare', {
      label: 'Prepare release version',
      detail: versionScript
        ? `Exact script declared in package.json: ${guideText(scripts.get(versionScript), 300)}`
        : currentVersion
          ? `package.json currently declares ${currentVersion}. Promotion requires a newer version and synchronized release notes; Resolve & run prepares them together.`
          : `${stageName} requires a version bump, but no manifest version or release-preparation script was detected.`,
      ...(versionScript ? { command: toolchain === 'yarn' ? `yarn ${versionScript}` : `${toolchain} run ${versionScript}` } : {}),
      path: packageFile,
      status: versionScript ? 'configured' : currentVersion ? 'manual' : 'missing',
      blocking: !currentVersion && !versionScript,
    });
  }
  const requiresChangelog = stage?.promotionPolicy.requireChangelog === true;
  if (requiresChangelog) {
    add('prepare', {
      label: 'Release notes / changelog',
      detail: hasFile('CHANGELOG.md') ? 'CHANGELOG.md is present; confirm it contains the version being shipped.' : `${stageName} requires a changelog, but CHANGELOG.md is missing.`,
      status: hasFile('CHANGELOG.md') ? 'manual' : 'missing',
      path: firstFile('CHANGELOG.md'),
      blocking: !hasFile('CHANGELOG.md'),
    });
  }
  // Where a stage is hosted is a question about a stage you ship *to*. Asking
  // it of the local one produces the step "Local target: localhost", which is
  // noise on the runbook a developer opens most often.
  if (!isLocalStage) {
    add('prepare', {
      label: `${stageName} target`,
      detail: target === 'Not configured'
        ? `The Delivery pipeline does not name where ${stageName} is hosted or published.`
        : `${stageName} is configured for ${target}.`,
      status: target === 'Not configured' ? 'missing' : 'configured',
      path: DELIVERY_SSOT_PATH,
      blocking: target === 'Not configured',
    });
  }
  if (stage?.backupPolicy.required) {
    add('prepare', {
      label: `${stageName} backup`,
      detail: stage.backupPolicy.command ? 'A backup command is configured and remains gated by the promotion flow.' : 'A backup is required, but no command is configured. Promotion remains blocked.',
      status: stage.backupPolicy.command ? 'configured' : 'missing',
      path: DELIVERY_SSOT_PATH,
      blocking: !stage.backupPolicy.command,
    });
  }

  const nodeRun = (name: string): string => toolchain === 'yarn' ? `yarn ${name}` : `${toolchain} run ${name}`;
  const addScript = (phaseId: DeliveryGuidePhaseId, name: string): void => {
    if (!scripts.has(name)) { return; }
    add(phaseId, {
      label: name,
      detail: `Exact script declared in package.json: ${guideText(scripts.get(name), 300)}`,
      command: nodeRun(name),
      path: packageFile,
      status: 'configured',
      blocking: false,
    });
  };
  if (ecosystem === 'Node.js') {
    ['typecheck', 'compile', 'lint', 'test', 'test:coverage', 'check', 'verify'].forEach(name => addScript('validate', name));
  } else if (ecosystem === 'Python') {
    const pythonText = `${manifest('pyproject.toml')}\n${manifest('requirements.txt')}`.toLowerCase();
    if (/pytest/.test(pythonText)) { add('validate', { label: 'Python tests', detail: 'Pytest is declared by the project.', command: 'python -m pytest', path: pyproject, status: 'conventional', blocking: false }); }
    if (/ruff/.test(pythonText)) { add('validate', { label: 'Python lint', detail: 'Ruff is declared by the project.', command: 'ruff check .', path: pyproject, status: 'conventional', blocking: false }); }
    if (/mypy/.test(pythonText)) { add('validate', { label: 'Python type check', detail: 'Mypy is declared by the project.', command: 'mypy .', path: pyproject, status: 'conventional', blocking: false }); }
  } else if (ecosystem === 'Go') {
    add('validate', { label: 'Go tests', detail: 'Standard Go module validation.', command: 'go test ./...', path: goMod, status: 'conventional', blocking: false });
    add('validate', { label: 'Go vet', detail: 'Standard Go static analysis.', command: 'go vet ./...', path: goMod, status: 'conventional', blocking: false });
  } else if (ecosystem === 'Rust') {
    add('validate', { label: 'Rust format', detail: 'Standard Cargo formatting validation.', command: 'cargo fmt --check', path: cargo, status: 'conventional', blocking: false });
    add('validate', { label: 'Rust lint', detail: 'Standard Cargo lint validation.', command: 'cargo clippy --all-targets -- -D warnings', path: cargo, status: 'conventional', blocking: false });
    add('validate', { label: 'Rust tests', detail: 'Standard Cargo test command.', command: 'cargo test', path: cargo, status: 'conventional', blocking: false });
  } else if (ecosystem === 'Java / Maven') {
    add('validate', { label: 'Maven verification', detail: 'Standard Maven verification lifecycle.', command: `${toolchain === 'Maven Wrapper' ? './mvnw' : 'mvn'} verify`, path: pom, status: 'conventional', blocking: false });
  } else if (ecosystem === 'Java / Gradle') {
    add('validate', { label: 'Gradle checks', detail: 'Standard Gradle verification lifecycle.', command: `${toolchain === 'Gradle Wrapper' ? './gradlew' : 'gradle'} check`, path: gradle, status: 'conventional', blocking: false });
  } else if (ecosystem === '.NET') {
    add('validate', { label: '.NET tests', detail: 'Standard .NET solution test command.', command: 'dotnet test --no-restore', path: dotnet, status: 'conventional', blocking: false });
  }

  // The checks a stage declares in `delivery.json` are the clearest statement
  // of how it differs from the one below it, and until now the runbook did not
  // read them at all: a stage requiring four green workflows and one requiring
  // none produced the same Validate column. Both kinds stay `manual` — a
  // required check is a promise someone else keeps, not a command AtlasMind
  // can run — and the two are kept apart because a person saying "I looked"
  // and a machine saying "it passed" must never stand in for each other.
  //
  // A declared check that restates a step the runbook already derived is one
  // fact, not two: the seeded pipeline lists "Working tree clean" as a required
  // check, and the Prerequisites column already shows it with the git command
  // that answers it. Listing both puts the same sentence in two columns and
  // makes the second look like something extra to do.
  const derivedLabels = new Set(
    [...phases.values()].flatMap(phase => phase.steps).map(step => step.label.toLowerCase()),
  );
  const declaredChecks = (stage?.promotionPolicy.requiredChecks ?? [])
    .map(check => guideText(check, 120))
    .filter(check => check && !derivedLabels.has(check.toLowerCase()));
  const declaredStatusChecks = (stage?.promotionPolicy.requiredStatusChecks ?? []).map(check => guideText(check, 160)).filter(Boolean);
  const CHECK_DISPLAY_CAP = 8;
  for (const check of declaredChecks.slice(0, CHECK_DISPLAY_CAP)) {
    add('validate', {
      label: check,
      detail: `Declared in the delivery pipeline as a human check for ${stageName}. Someone confirms it; AtlasMind does not.`,
      path: DELIVERY_SSOT_PATH,
      status: 'manual',
      blocking: false,
    });
  }
  for (const check of declaredStatusChecks.slice(0, CHECK_DISPLAY_CAP)) {
    add('validate', {
      label: `CI check: ${check}`,
      detail: `Named CI status check that must be green before a promotion into ${stageName}.`,
      path: DELIVERY_SSOT_PATH,
      status: 'manual',
      blocking: false,
    });
  }
  const hiddenCheckCount = Math.max(0, declaredChecks.length - CHECK_DISPLAY_CAP)
    + Math.max(0, declaredStatusChecks.length - CHECK_DISPLAY_CAP);
  if (hiddenCheckCount > 0) {
    add('validate', {
      label: `${hiddenCheckCount} further declared check${hiddenCheckCount === 1 ? '' : 's'}`,
      detail: `${stageName} declares more checks than this column lists. Open the pipeline file for the full set.`,
      path: DELIVERY_SSOT_PATH,
      status: 'manual',
      blocking: false,
    });
  }

  if (ecosystem === 'Node.js') {
    const packageScripts = ['package', 'package:vsix', 'pack', 'bundle'].filter(name => scripts.has(name));
    if (packageScripts.length > 0) { packageScripts.forEach(name => addScript('package', name)); }
    else if (scripts.has('build')) { addScript('package', 'build'); }
  } else if (ecosystem === 'Python' && firstFile('pyproject.toml')) {
    add('package', { label: 'Build Python distributions', detail: 'Standard pyproject build, inferred from pyproject.toml.', command: 'python -m build', path: 'pyproject.toml', status: 'conventional', blocking: false });
  } else if (ecosystem === 'Go') {
    add('package', { label: 'Build Go binaries', detail: 'Standard Go module build.', command: 'go build ./...', path: goMod, status: 'conventional', blocking: false });
  } else if (ecosystem === 'Rust') {
    add('package', { label: 'Build release artifacts', detail: 'Standard optimized Cargo build.', command: 'cargo build --release', path: cargo, status: 'conventional', blocking: false });
  } else if (ecosystem === 'Java / Maven') {
    add('package', { label: 'Package with Maven', detail: 'Standard Maven package lifecycle.', command: `${toolchain === 'Maven Wrapper' ? './mvnw' : 'mvn'} package`, path: pom, status: 'conventional', blocking: false });
  } else if (ecosystem === 'Java / Gradle') {
    add('package', { label: 'Build with Gradle', detail: 'Standard Gradle build lifecycle.', command: `${toolchain === 'Gradle Wrapper' ? './gradlew' : 'gradle'} build`, path: gradle, status: 'conventional', blocking: false });
  } else if (ecosystem === '.NET') {
    add('package', { label: 'Publish .NET artifacts', detail: 'Standard release publish output.', command: 'dotnet publish -c Release --no-restore', path: dotnet, status: 'conventional', blocking: false });
  } else if (dockerfile) {
    add('package', { label: 'Build container image', detail: 'Dockerfile detected; choose and record an immutable image tag before publishing.', command: 'docker build .', path: dockerfile, status: 'conventional', blocking: false });
  }

  // What "deploy" means on your own machine. This is the question the single
  // production-shaped runbook could never answer — how do I actually start the
  // thing — and it is the first one a new contributor asks.
  if (isLocalStage) {
    if (ecosystem === 'Node.js') {
      ['dev', 'start', 'watch', 'serve', 'debug'].forEach(name => addScript('deploy', name));
    } else if (ecosystem === 'Python') {
      // Nothing conventional enough to name: a Python project's entry point is
      // whatever the project says it is, and guessing `python main.py` would be
      // an invented command wearing a detected one's clothes.
    } else if (ecosystem === 'Go') {
      add('deploy', { label: 'Run the module', detail: 'Standard Go run for the module root.', command: 'go run .', path: goMod, status: 'conventional', blocking: false });
    } else if (ecosystem === 'Rust') {
      add('deploy', { label: 'Run the crate', detail: 'Standard Cargo run.', command: 'cargo run', path: cargo, status: 'conventional', blocking: false });
    } else if (ecosystem === '.NET') {
      add('deploy', { label: 'Run the project', detail: 'Standard .NET run.', command: 'dotnet run', path: dotnet, status: 'conventional', blocking: false });
    }
    if (hasFile('.vscode/launch.json')) {
      add('deploy', {
        label: 'Launch the debugger (F5)',
        detail: 'A VS Code launch configuration is present, so F5 starts a debug session. That is the run path for an extension or any project whose entry point is the editor.',
        path: firstFile('.vscode/launch.json'),
        status: 'configured',
        blocking: false,
      });
    }
  }

  const phaseForRoutineStep = (routineStep: RoutineDefinition['steps'][number]): DeliveryGuidePhaseId => {
    const text = `${routineStep.id} ${routineStep.label} ${routineStep.run}`.toLowerCase();
    if (/\b(test|lint|check|verify|compile|typecheck)\b/.test(text)) { return 'validate'; }
    if (/\b(package|pack|bundle|build|artifact)\b/.test(text)) { return 'package'; }
    if (/\b(publish|marketplace|registry|tag(?:ging)?|release)\b/.test(text)) { return 'publish'; }
    return 'deploy';
  };
  for (const routine of routines) {
    for (const routineStep of routine.steps) {
      const phaseId = phaseForRoutineStep(routineStep);
      add(phaseId, {
        label: guideText(routineStep.label, 160) || 'Delivery routine step',
        detail: `Configured by the bound “${guideText(routine.name, 120)}” routine; failure policy: ${routineStep.on_fail}.`,
        command: routineStep.run,
        status: 'configured',
        blocking: false,
      });
    }
  }

  const dispatchWorkflow = guidePath(stage?.promotionPolicy.dispatchWorkflow);
  if (dispatchWorkflow) {
    add('deploy', {
      label: `Dispatch the ${stageName} workflow`,
      detail: `${stageName} delegates deployment to CI/CD, so the deploy runs there rather than on this machine.`,
      command: ['gh', 'workflow', 'run', dispatchWorkflow].join(' '),
      path: dispatchWorkflow.startsWith('.github/') ? dispatchWorkflow : `.github/workflows/${dispatchWorkflow}`,
      status: 'configured',
      blocking: false,
    });
  }
  if (stage?.promotionPolicy.viaPullRequest) {
    add('deploy', {
      label: `Promote through a pull request${stage.branchRef ? ` into ${guideText(stage.branchRef, 120)}` : ''}`,
      detail: 'This is a human-reviewed gate. Required status checks must pass before the protected target is merged.',
      path: DELIVERY_SSOT_PATH,
      status: 'manual',
      blocking: false,
    });
  }

  // A delivery-named workflow describes moving code away from this machine, so
  // it has no place on the runbook for this machine.
  const deliveryWorkflows = isLocalStage
    ? []
    : (input.workflows ?? []).filter(workflow => /\b(deploy|publish|release|ship|promotion)\b/i.test(workflow.name));
  for (const workflow of deliveryWorkflows) {
    const safeWorkflowPath = guidePath(workflow.path);
    const triggers = workflow.triggers.map(trigger => guideText(trigger, 60)).filter(Boolean);
    const publishLike = /\b(publish|release)\b/i.test(workflow.name);
    const phaseId: DeliveryGuidePhaseId = publishLike ? 'publish' : 'deploy';
    const dispatchable = triggers.some(trigger => trigger === 'workflow_dispatch');
    add(phaseId, {
      label: guideText(workflow.name, 160) || 'Delivery workflow',
      detail: triggers.length > 0 ? `GitHub Actions triggers: ${triggers.join(', ')}.` : 'A delivery-named workflow is present, but its trigger was not parsed.',
      ...(dispatchable && safeWorkflowPath ? { command: ['gh', 'workflow', 'run', safeWorkflowPath].join(' ') } : {}),
      path: safeWorkflowPath,
      status: dispatchable ? 'manual' : 'configured',
      blocking: false,
    });
  }

  // Where the publish scripts belong. A project's `publish:*` and `tag:*`
  // scripts exist whatever stage you are looking at, so listing them by
  // ecosystem alone put `npm run publish:release` on the Local runbook (one
  // click from the button that starts the dev server) and on an Integration
  // stage that publishes nothing. They belong on the stage the *pipeline* says
  // reaches a registry — or, with no pipeline at all, on the single unstaged
  // runbook, which is the only place they could go.
  const stagePublishes = !stage || (!isLocalStage && /marketplace|registry|pypi|crates\.io|app store/i.test(target));
  if (!stagePublishes) {
    // Nothing to say here: "this stage does not publish" is the absence of a
    // column, not a gap in one.
  } else if (ecosystem === 'Node.js') {
    [...scripts.keys()]
      .filter(name => /^(?:publish(?:$|:)|release(?:$|:)|ship(?:$|:)|tag:)/i.test(name))
      .slice(0, 6)
      .forEach(name => addScript('publish', name));
  } else if (/pypi/i.test(target)) {
    add('publish', { label: 'Publish Python distribution', detail: 'The target is PyPI, but AtlasMind will not invent repository credentials or an upload command.', path: pyproject, status: 'manual', blocking: false });
  } else if (/crates\.io/i.test(target)) {
    add('publish', { label: 'Publish crate', detail: 'Standard crates.io publish command. Review the packaged file list and credentials first.', command: 'cargo publish', path: cargo, status: 'conventional', blocking: false });
  }

  const publishTarget = stagePublishes && /marketplace|registry|pypi|crates\.io|app store/i.test(target);
  if (phases.get('validate')!.steps.length === 0) {
    add('validate', { label: 'Project validation', detail: 'No test, lint, compile, or verification command was detected. Declare the checks that make a build trustworthy.', status: 'missing', blocking: true });
  }
  if (phases.get('package')!.steps.length === 0) {
    add('package', { label: 'Packaging command', detail: 'No package, build, bundle, or artifact command was detected.', status: 'missing', blocking: true });
  }
  if (isLocalStage) {
    // "Nothing deploys here" is correct, not a gap. But not knowing how to
    // *start* the project is a real one, so it is said rather than left blank.
    if (phases.get('deploy')!.steps.length === 0) {
      add('deploy', {
        label: 'Run it on this machine',
        detail: 'No dev, start, watch, serve, or launch configuration was detected. Declare one so a new contributor can run the project without asking.',
        status: 'manual',
        blocking: false,
      });
    }
  } else if (!publishTarget && target !== 'Not configured' && phases.get('deploy')!.steps.length === 0) {
    add('deploy', { label: `Deploy to ${target}`, detail: 'A target is named, but no bound routine or dispatch workflow explains how code reaches it.', path: DELIVERY_SSOT_PATH, status: 'missing', blocking: true });
  }
  if (publishTarget && phases.get('publish')!.steps.length === 0) {
    add('publish', { label: `Publish to ${target}`, detail: 'A publishing target is named, but no project script, routine step, or workflow explains how to publish.', path: DELIVERY_SSOT_PATH, status: 'missing', blocking: true });
  }

  const visiblePhases = [...phases.values()].filter(phase =>
    phase.id === 'prepare' || phase.id === 'validate' || phase.id === 'package' || phase.steps.length > 0,
  );
  const allSteps = visiblePhases.flatMap(phase => phase.steps);
  const stageBranch = guideText(stage?.branchRef, 200);
  return {
    ...(stage ? { stageId: stage.id, stageKind: stage.kind, stageRank: stage.rank } : {}),
    stageName,
    isProtected: stage?.isProtected === true,
    ...(stageBranch ? { branchRef: stageBranch } : {}),
    ecosystem,
    toolchain,
    target,
    configuredCount: allSteps.filter(step => step.status === 'configured' || step.status === 'conventional').length,
    totalCount: allSteps.length,
    blockerCount: allSteps.filter(step => step.status === 'missing' && step.blocking).length,
    phases: visiblePhases,
  };
}

export function defaultDeliveryConfig(): DeliveryConfig {
  return { version: 1, stages: [], paths: [] };
}

// ── Seeding ──────────────────────────────────────────────────────

/**
 * Build a pipeline that reflects the repository's *actual* delivery protocol
 * from imported {@link DeliverySeedInput} signals: branch layout, project
 * archetype, database presence, publish target, env files, package scripts,
 * CI, and existing routines. A project with no database gets no phantom
 * backup gate; the publish target becomes production hosting; required checks
 * mirror the scripts that exist; and promotion paths bind to routines that
 * actually exist (or none). Everything is fully editable afterwards.
 */
export function seedDeliveryConfig(input: DeliverySeedInput): DeliveryConfig {
  // The one decision the old `DeliveryArchetype` existed to make, now expressed
  // over the shared vocabulary. The new fields win when supplied; the legacy
  // field is mapped forward so callers that have not migrated keep working.
  const identity = input.projectArchetype !== undefined
    ? { archetype: input.projectArchetype, traits: [...(input.traits ?? [])] }
    : fromDeliveryArchetype(input.archetype);
  const deployless = identity
    ? !deploysToHostedEnvironment(identity.archetype, identity.traits)
    : false;
  const hasDatabase = input.hasDatabase ?? false;
  const stagingBranch = input.developBranch ?? input.currentBranch;
  // Never fabricate a production branch. If detection found none (no
  // main/master/production/… ref in this repo), leave it unset rather than
  // inventing `main` — a branch that may not exist here. An honest "not
  // detected" is safer than a wrong import that could mislead a promotion
  // target. Detection supplies the real branch when one is found.
  const productionBranch = input.productionBranch;

  const baseChecks: string[] = ['Working tree clean'];
  if (input.scripts?.build) { baseChecks.push('Compile/build passes'); }
  if (input.scripts?.lint) { baseChecks.push('Lint passes'); }
  if (input.scripts?.test) { baseChecks.push('Tests pass'); }
  // CI is represented as first-class required *status checks* (below), not a
  // generic "CI green" label.

  const dataFor = (role: 'local' | 'staging' | 'production'): DeploymentStage['data'] => {
    if (!hasDatabase) { return { kind: 'none', label: 'No application database' }; }
    if (role === 'local') { return { kind: 'local', label: 'Local development database (disposable)' }; }
    if (role === 'staging') { return { kind: 'TBD', label: 'Staging database (safe to reset)' }; }
    return { kind: 'TBD', label: 'Production database (real user data)' };
  };
  const configFor = (file?: string): DeploymentStage['config'] => (file ? { sourceLabel: file, sourcePath: file } : {});

  const local: DeploymentStage = {
    id: 'stage-local',
    name: 'Local',
    kind: 'local',
    rank: 0,
    description:
      'Your own machine. Where you write and run code day to day. Data here is disposable — nothing your users see lives at this stage.',
    branchRef: undefined,
    config: configFor(input.envFiles?.local),
    hosting: { provider: 'localhost' },
    data: dataFor('local'),
    backupPolicy: { required: false },
    promotionPolicy: { requiresApproval: false, requireVersionBump: false, requireChangelog: false, requiredChecks: [] },
    rollbackPolicy: {},
    isProtected: false,
  };

  const middle: DeploymentStage = {
    id: 'stage-staging',
    name: deployless ? 'Integration' : 'Staging',
    kind: 'staging',
    rank: 1,
    description: deployless
      ? `Shared integration branch (\`${stagingBranch}\`). Work merges here and is built, linted, and tested together before a release is promoted to production.`
      : 'A production-like rehearsal environment. Changes land here first so they can be tested against realistic data and settings before any real users are affected.',
    branchRef: stagingBranch,
    config: configFor(input.envFiles?.staging),
    hosting: {},
    data: dataFor('staging'),
    backupPolicy: hasDatabase
      ? { required: false, retention: 'Optional — staging data is generally reproducible.' }
      : { required: false },
    promotionPolicy: {
      requiresApproval: false,
      requireVersionBump: true,
      requireChangelog: true,
      requiredChecks: [...baseChecks],
      viaPullRequest: input.viaPullRequest?.staging ?? false,
      requiredStatusChecks: input.statusChecks?.staging ?? [],
      dispatchWorkflow: input.dispatchWorkflow?.staging,
    },
    rollbackPolicy: { runbookRef: DELIVERY_SUMMARY_SSOT_PATH },
    isProtected: false,
  };

  const production: DeploymentStage = {
    id: 'stage-production',
    name: 'Production',
    kind: 'production',
    rank: 2,
    description: deployless
      ? `The released product your users install or consume${input.publishTarget ? ` via ${input.publishTarget}` : ''}. Promotion is the release: version-gated, requires sign-off, and never force-pushed.`
      : 'The live environment your real users depend on. Every change here is treated as high-risk: it is backed up first, requires sign-off, and is never force-pushed.',
    branchRef: productionBranch,
    config: configFor(input.envFiles?.production),
    hosting: { provider: input.publishTarget ?? 'TBD', url: input.productionUrl ?? '', healthCheckUrl: '' },
    data: dataFor('production'),
    backupPolicy: hasDatabase
      ? {
          required: true,
          // Empty by design: deny-by-default keeps promotion blocked until the
          // user supplies a real backup command for the production database.
          command: '',
          runbookRef: DELIVERY_SUMMARY_SSOT_PATH,
          retention: 'Recommended: keep at least 7 daily snapshots.',
        }
      : { required: false, runbookRef: DELIVERY_SUMMARY_SSOT_PATH },
    promotionPolicy: {
      requiresApproval: true,
      requireVersionBump: true,
      requireChangelog: true,
      requiredChecks: [...baseChecks],
      viaPullRequest: input.viaPullRequest?.production ?? false,
      requiredStatusChecks: input.statusChecks?.production ?? [],
      dispatchWorkflow: input.dispatchWorkflow?.production,
    },
    rollbackPolicy: { runbookRef: DELIVERY_SUMMARY_SSOT_PATH },
    isProtected: true,
  };

  const paths: PromotionPath[] = [
    { id: 'promote-local-staging', fromStageId: local.id, toStageId: middle.id, routineId: input.stagingRoutineId },
    { id: 'promote-staging-production', fromStageId: middle.id, toStageId: production.id, routineId: input.productionRoutineId },
  ];

  return { version: 1, stages: [local, middle, production], paths, updatedAt: new Date().toISOString() };
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
        migrateCommand: optStr(data['migrateCommand'], MAX_LONG),
      },
      backupPolicy: {
        required: asBool(backup['required']),
        command: optStr(backup['command'], MAX_LONG),
        verifyCommand: optStr(backup['verifyCommand'], MAX_LONG),
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
        viaPullRequest: asBool(promo['viaPullRequest']),
        requiredStatusChecks: Array.isArray(promo['requiredStatusChecks'])
          ? (promo['requiredStatusChecks'] as unknown[]).map(check => clampStr(check, 160)).filter(Boolean).slice(0, 30)
          : [],
        dispatchWorkflow: optStr(promo['dispatchWorkflow'], 200),
        requireDistinctApprover: asBool(promo['requireDistinctApprover']),
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
    const branchLabel = stage.branchRef
      ? `\`${stage.branchRef}\``
      : stage.kind === 'local' ? '— (working tree)' : '— (not detected)';
    lines.push(`- **Branch:** ${branchLabel}`);
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
    const viaPr = to.promotionPolicy.viaPullRequest === true;
    lines.push('Every promotion runs the same guarded sequence:');
    lines.push('');
    lines.push('1. **Preflight gate** — the required checks below must all pass, or the promotion aborts.');
    lines.push(`2. **Backup** — ${to.backupPolicy.required ? `a snapshot of **${to.name}** is taken before any change, so it can be recovered` : 'optional for this target'}.`);
    lines.push(viaPr
      ? `3. **Promote via Pull Request** — open a PR into \`${to.branchRef ?? to.name}\` (a protected branch); the required status checks must be green and the PR merged. AtlasMind never force-pushes or pushes directly.`
      : '3. **Promote** — the build is merged/tagged forward. AtlasMind never force-pushes.');
    lines.push('4. **Verify** — the target is health-checked after deploy.');
    lines.push('');
    const checks = to.promotionPolicy.requiredChecks;
    lines.push(`- **Required checks:** ${checks.length > 0 ? checks.map(c => `\`${c}\``).join(', ') : 'none configured'}`);
    const statusChecks = to.promotionPolicy.requiredStatusChecks ?? [];
    if (statusChecks.length > 0) {
      lines.push(`- **Required CI status checks:** ${statusChecks.map(c => `\`${c}\``).join(', ')}`);
    }
    lines.push(`- **Promotion mechanism:** ${viaPr ? 'Pull Request into a protected branch' : 'direct merge/tag'}`);
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
