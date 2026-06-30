/**
 * PromotionRunner — assembles and executes a guarded promotion ("push") along a
 * delivery path (source stage → target stage).
 *
 * The guarded sequence is always: **preflight gate → backup → deploy → verify →
 * record**. AtlasMind owns the managed guardrails (preflight checks it can
 * evaluate, the backup command, the post-deploy health check, the recording of
 * the result + rollback handle). The *deploy* body is the user-authored bound
 * routine's steps — the real merge/deploy/migration commands. This keeps
 * AtlasMind from performing surprising destructive git operations on its own:
 * the moving parts are commands the user wrote and can read in the runbook.
 *
 * Safety boundary: every command executed here is sourced **server-side** from
 * the persisted, user-authored config (`backupPolicy.command`) or routine files
 * — never from a webview message. The webview can only *trigger* a promotion and
 * *attest* manual checks; it can never inject a command string. Execution is
 * gated behind preflight (no failing auto-check), human attestation of manual
 * checks, explicit approval when required, and a typed confirmation for
 * protected stages. AtlasMind itself never force-pushes.
 */

import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as https from 'node:https';
import * as http from 'node:http';
import type {
  DeliveryConfig,
  PromotionPlan,
  PromotionPlanStep,
  PromotionPreflightCheck,
  PromotionRemediation,
  PromotionRunResult,
  PromotionStepResult,
  RoutineDefinition,
} from '../types.js';

/** SemVer level a set of commits warrants. */
export type BumpLevel = 'patch' | 'minor' | 'major';

const execAsync = promisify(exec);
/** Argument-array exec (no shell) for AtlasMind-issued git commands — injection-proof. */
const execFileAsync = promisify(execFile);
/** A version string we are willing to write into files and a commit message. */
const SAFE_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** Per-command timeout for backup/deploy steps (deploys can be slow). */
const STEP_TIMEOUT_MS = 300_000;
/** Health-check timeout. */
const VERIFY_TIMEOUT_MS = 15_000;
/** Cap on captured step output kept for display. */
const MAX_OUTPUT_CHARS = 4_000;

// ── Plan building ────────────────────────────────────────────────

export interface PromotionPlanInput {
  config: DeliveryConfig;
  pathId: string;
  /** Package version at the source (branch package.json, or working tree). */
  fromVersion: string;
  /** Package version at the target branch. */
  toVersion: string;
  /** Whether the repository working tree is clean. */
  workingTreeClean: boolean;
  /** Whether CHANGELOG.md (working tree) references the source version. */
  changelogHasFromVersion: boolean;
  /** The bound promotion routine, when one exists on disk. */
  routine?: RoutineDefinition;
  /**
   * Live CI status per check context, resolved from `gh` at plan time. When a
   * required status check appears here it becomes an *auto* preflight check
   * (verified), instead of a manual attestation. Absent ⇒ fall back to manual.
   */
  liveStatusChecks?: Record<string, 'pass' | 'fail' | 'pending'>;
  /** Identity running the promotion (git actor), for separation-of-duties. */
  approver?: string;
  /** Author of the source branch's head commit, for separation-of-duties. */
  lastCommitAuthor?: string;
  /**
   * Assessed inputs for the "Resolve & run" remediation of fixable failing
   * checks (version not bumped / missing changelog). Computed from the live
   * conventional-commit history; absent ⇒ no remediation is offered.
   */
  remediationAssessment?: {
    /** SemVer level the version should advance by, assessed from the changes. */
    bumpLevel: BumpLevel;
    /** Human reasoning for the level (e.g. "minor — 3 feature commit(s) since Staging"). */
    bumpReason: string;
    /** Whether package.json exists so a version bump can be written. */
    canBumpVersion: boolean;
    /** Whether a CHANGELOG.md entry can be written (file present or creatable). */
    canEditChangelog: boolean;
  };
}

/**
 * Build the inspectable plan for a path: the preflight checks (auto-evaluated
 * where possible, otherwise flagged for manual attestation), the ordered guarded
 * steps, and any hard blockers that forbid execution outright.
 */
export function buildPromotionPlan(input: PromotionPlanInput): PromotionPlan | undefined {
  const { config, pathId } = input;
  const path = config.paths.find(candidate => candidate.id === pathId);
  if (!path) {
    return undefined;
  }
  const from = config.stages.find(stage => stage.id === path.fromStageId);
  const to = config.stages.find(stage => stage.id === path.toStageId);
  if (!from || !to) {
    return undefined;
  }

  const checks: PromotionPreflightCheck[] = [];
  const blockers: string[] = [];

  const backupCommand = (to.backupPolicy.command ?? '').trim();
  const backupConfigured = backupCommand.length > 0;
  if (to.backupPolicy.required && !backupConfigured) {
    blockers.push(`A data backup is required before promoting to ${to.name}, but no backup command is set. Add one in the stage editor before this push can run.`);
  }

  const viaPullRequest = to.promotionPolicy.viaPullRequest === true;
  const dispatchWorkflow = (to.promotionPolicy.dispatchWorkflow ?? '').trim();
  const hasRoutine = Boolean(input.routine && input.routine.steps.length > 0);
  if (viaPullRequest && !hasRoutine && !dispatchWorkflow) {
    blockers.push(`Promotion to ${to.name} must go through a Pull Request into \`${to.branchRef ?? 'the protected branch'}\`, but nothing is bound to open one. Bind a routine, or set a CD workflow to dispatch, in the push editor.`);
  }

  if (to.promotionPolicy.requireVersionBump) {
    const ahead = compareSemver(input.fromVersion, input.toVersion) > 0;
    checks.push({
      id: 'version-bump',
      label: `Version bumped (${input.fromVersion} → ${input.toVersion})`,
      kind: 'auto',
      status: ahead ? 'pass' : 'fail',
      detail: ahead
        ? `Source ${input.fromVersion} is ahead of ${to.name} ${input.toVersion}.`
        : `Source version ${input.fromVersion} is not ahead of ${to.name} ${input.toVersion}.`,
    });
  }
  if (to.promotionPolicy.requireChangelog) {
    checks.push({
      id: 'changelog',
      label: `Changelog entry for ${input.fromVersion}`,
      kind: 'auto',
      status: input.changelogHasFromVersion ? 'pass' : 'fail',
      detail: input.changelogHasFromVersion
        ? 'CHANGELOG.md references the source version.'
        : 'CHANGELOG.md has no entry for the source version.',
    });
  }

  for (const name of to.promotionPolicy.requiredChecks) {
    const normalized = name.toLowerCase();
    if (normalized.includes('working tree') || normalized.includes('clean')) {
      checks.push({
        id: `auto-clean-${slugify(name)}`,
        label: name,
        kind: 'auto',
        status: input.workingTreeClean ? 'pass' : 'fail',
        detail: input.workingTreeClean ? 'Working tree is clean.' : 'Working tree has uncommitted changes.',
      });
    } else {
      checks.push({
        id: `manual-${slugify(name)}`,
        label: name,
        kind: 'manual',
        status: 'manual',
        detail: 'Confirm this is satisfied before proceeding.',
      });
    }
  }

  // CI status checks imported from the repo's workflows / branch protection.
  // When live status is available (resolved from `gh` at plan time) the check is
  // *verified* automatically; otherwise it falls back to manual attestation.
  const live = input.liveStatusChecks;
  for (const context of to.promotionPolicy.requiredStatusChecks ?? []) {
    const liveState = live?.[context];
    if (liveState) {
      checks.push({
        id: `status-${slugify(context)}`,
        label: `CI: ${context}`,
        kind: 'auto',
        status: liveState === 'pass' ? 'pass' : 'fail',
        detail: liveState === 'pass'
          ? 'Green on the latest run.'
          : liveState === 'pending' ? 'Still running — not green yet.' : 'Failing on the latest run.',
      });
    } else {
      checks.push({
        id: `status-${slugify(context)}`,
        label: `CI green: ${context}`,
        kind: 'manual',
        status: 'manual',
        detail: viaPullRequest
          ? 'Confirm this CI check is green on the Pull Request (live status unavailable).'
          : 'Confirm this CI check is green (live status unavailable).',
      });
    }
  }

  // Separation of duties: the approver must differ from the change's author.
  if (to.promotionPolicy.requireDistinctApprover) {
    const approver = (input.approver ?? '').trim().toLowerCase();
    const author = (input.lastCommitAuthor ?? '').trim().toLowerCase();
    if (approver && author) {
      const distinct = approver !== author;
      checks.push({
        id: 'distinct-approver',
        label: 'Separation of duties — approver ≠ author',
        kind: 'auto',
        status: distinct ? 'pass' : 'fail',
        detail: distinct ? 'You are not the author of the change being promoted.' : 'You authored the change being promoted; a different person must approve it.',
      });
    } else {
      checks.push({
        id: 'distinct-approver',
        label: 'Separation of duties — approver ≠ author',
        kind: 'manual',
        status: 'manual',
        detail: 'Confirm a different person from the change author is approving (identities could not be resolved automatically).',
      });
    }
  }

  const steps: PromotionPlanStep[] = [];
  steps.push({
    id: 'preflight',
    kind: 'preflight',
    label: 'Preflight gate',
    detail: checks.length > 0
      ? `${checks.length} check(s) must pass${to.promotionPolicy.requiresApproval ? ' and you must approve' : ''}.`
      : `No checks configured${to.promotionPolicy.requiresApproval ? ' — approval still required.' : '.'}`,
    managed: true,
  });
  if (to.backupPolicy.required || backupConfigured) {
    steps.push({
      id: 'backup',
      kind: 'backup',
      label: `Backup ${to.name}`,
      detail: backupConfigured ? 'Snapshot the target before any change.' : 'No backup command set.',
      command: backupConfigured ? backupCommand : undefined,
      managed: true,
    });
  }
  const verifyBackupCommand = (to.backupPolicy.verifyCommand ?? '').trim();
  if (verifyBackupCommand) {
    steps.push({
      id: 'backup-verify',
      kind: 'backup',
      label: 'Verify backup is restorable',
      detail: 'Confirms the snapshot exists / is usable before proceeding.',
      command: verifyBackupCommand,
      managed: true,
    });
  }
  const migrateCommand = (to.data.migrateCommand ?? '').trim();
  if (migrateCommand) {
    steps.push({
      id: 'migrate',
      kind: 'deploy',
      label: 'Run database migrations',
      detail: 'Applies schema changes inside the guarded sequence.',
      command: migrateCommand,
      managed: true,
    });
  }
  if (input.routine && input.routine.steps.length > 0) {
    for (const routineStep of input.routine.steps) {
      steps.push({
        id: `deploy-${routineStep.id}`,
        kind: 'deploy',
        label: routineStep.label,
        detail: `on_fail: ${routineStep.on_fail}`,
        command: routineStep.run,
        managed: false,
      });
    }
  } else if (dispatchWorkflow) {
    const ref = from.branchRef || to.branchRef || '';
    steps.push({
      id: 'deploy-dispatch',
      kind: 'deploy',
      label: `Trigger CD: ${dispatchWorkflow}`,
      detail: 'Promotion runs in CI/CD (gh workflow run), not on your machine.',
      command: `gh workflow run ${dispatchWorkflow}${ref ? ` --ref ${ref}` : ''}`,
      managed: true,
    });
  } else {
    steps.push({
      id: 'deploy-none',
      kind: 'deploy',
      label: 'Deploy steps',
      detail: path.routineId
        ? `No routine "${path.routineId}" found in project_memory/routines/. Add your deploy/migration steps there.`
        : 'No promotion routine bound. Bind one (or set a CD workflow to dispatch) in the push editor.',
      managed: false,
    });
  }
  steps.push({
    id: 'verify',
    kind: 'verify',
    label: 'Verify health',
    detail: to.hosting.healthCheckUrl ? `GET ${to.hosting.healthCheckUrl}` : 'No health-check URL set — skipped.',
    managed: true,
  });
  steps.push({
    id: 'record',
    kind: 'record',
    label: 'Record promotion',
    detail: 'Log the outcome and the rollback handle.',
    managed: true,
  });

  const remediation = assembleRemediation(input, checks, blockers);

  return {
    pathId,
    fromStageId: from.id,
    toStageId: to.id,
    fromName: from.name,
    toName: to.name,
    steps,
    checks,
    blockers,
    requiresApproval: to.promotionPolicy.requiresApproval,
    isProtected: to.isProtected,
    viaPullRequest,
    hasRoutine,
    routineId: path.routineId,
    ...(remediation ? { remediation } : {}),
  };
}

/**
 * Build the "Resolve & run" offer when the only failing auto-checks are the
 * fixable ones (version not bumped / missing changelog) and an assessment is
 * available. Marks those checks `fixable` and returns the remediation descriptor;
 * returns undefined when nothing is offered (unfixable failures, blockers, or no
 * assessment). Mutates the matched checks' `fixable` flag in place.
 */
function assembleRemediation(
  input: PromotionPlanInput,
  checks: PromotionPreflightCheck[],
  blockers: string[],
): PromotionRemediation | undefined {
  const assessment = input.remediationAssessment;
  if (!assessment || blockers.length > 0) {
    return undefined;
  }
  const versionCheck = checks.find(check => check.id === 'version-bump');
  const changelogCheck = checks.find(check => check.id === 'changelog');
  const versionFailing = versionCheck?.status === 'fail';
  const changelogFailing = changelogCheck?.status === 'fail';
  if (!versionFailing && !changelogFailing) {
    return undefined;
  }

  // Any failing auto-check that is NOT one of the two fixable ones means editing
  // version/changelog cannot unblock the promotion — don't offer a partial fix.
  const fixableIds = new Set<string>();
  if (versionFailing) { fixableIds.add('version-bump'); }
  if (changelogFailing) { fixableIds.add('changelog'); }
  const hasUnfixableAutoFailure = checks.some(
    check => check.kind === 'auto' && check.status !== 'pass' && !fixableIds.has(check.id),
  );
  if (hasUnfixableAutoFailure) {
    return undefined;
  }

  const doBump = versionFailing && assessment.canBumpVersion;
  // Only offer if we can actually resolve EVERY failing fixable check.
  if (versionFailing && !doBump) {
    return undefined;
  }
  const editsChangelog = Boolean(changelogCheck) && assessment.canEditChangelog && (changelogFailing || doBump);
  if (changelogFailing && !editsChangelog) {
    return undefined;
  }

  const base = compareSemver(input.fromVersion, input.toVersion) >= 0 ? input.fromVersion : input.toVersion;
  const targetVersion = doBump ? bumpVersion(base, assessment.bumpLevel) : input.fromVersion;

  const resolves: string[] = [];
  if (versionFailing) {
    resolves.push('version-bump');
    if (versionCheck) { versionCheck.fixable = true; }
  }
  if (changelogFailing) {
    resolves.push('changelog');
    if (changelogCheck) { changelogCheck.fixable = true; }
  }

  const parts: string[] = [];
  if (doBump) { parts.push(`bump ${base} → ${targetVersion} (${assessment.bumpLevel})`); }
  if (editsChangelog) { parts.push(`add a CHANGELOG entry for ${targetVersion}`); }
  parts.push(`commit (chore(release): v${targetVersion}, no push)`);

  return {
    resolves,
    targetVersion,
    bumpLevel: doBump ? assessment.bumpLevel : null,
    bumpReason: assessment.bumpReason,
    editsChangelog,
    commits: true,
    summary: parts.join('; ') + '.',
  };
}

/** Whether every gate is satisfied for execution given the user's attestations. */
export function evaluatePromotionGate(
  plan: PromotionPlan,
  attestations: readonly string[],
  confirmText: string,
  targetName: string,
): { allowed: boolean; reason?: string } {
  if (plan.blockers.length > 0) {
    return { allowed: false, reason: plan.blockers[0] };
  }
  if (plan.checks.some(check => check.kind === 'auto' && check.status !== 'pass')) {
    return { allowed: false, reason: 'One or more automatic preflight checks are failing.' };
  }
  const manualIds = plan.checks.filter(check => check.kind === 'manual').map(check => check.id);
  if (!manualIds.every(id => attestations.includes(id))) {
    return { allowed: false, reason: 'All manual checks must be confirmed.' };
  }
  if (plan.requiresApproval && !attestations.includes('approve')) {
    return { allowed: false, reason: 'Explicit approval is required for this promotion.' };
  }
  if (plan.isProtected && confirmText.trim().toLowerCase() !== targetName.trim().toLowerCase()) {
    return { allowed: false, reason: `Type the target name "${targetName}" to confirm a protected promotion.` };
  }
  return { allowed: true };
}

/**
 * Like {@link evaluatePromotionGate}, but tolerates failing auto-checks that the
 * plan's remediation will fix (those marked `fixable`). Used to confirm the user
 * has satisfied everything they are responsible for (manual attestations,
 * approval, protected confirmation, and any *non-fixable* auto-check) BEFORE a
 * "Resolve & run" edits/commits and proceeds. The full gate is still enforced on
 * the rebuilt plan after remediation.
 */
export function evaluatePromotionGateExceptFixable(
  plan: PromotionPlan,
  attestations: readonly string[],
  confirmText: string,
  targetName: string,
): { allowed: boolean; reason?: string } {
  if (plan.blockers.length > 0) {
    return { allowed: false, reason: plan.blockers[0] };
  }
  if (plan.checks.some(check => check.kind === 'auto' && check.status !== 'pass' && check.fixable !== true)) {
    return { allowed: false, reason: 'A preflight check that cannot be auto-resolved is failing.' };
  }
  const manualIds = plan.checks.filter(check => check.kind === 'manual').map(check => check.id);
  if (!manualIds.every(id => attestations.includes(id))) {
    return { allowed: false, reason: 'All manual checks must be confirmed.' };
  }
  if (plan.requiresApproval && !attestations.includes('approve')) {
    return { allowed: false, reason: 'Explicit approval is required for this promotion.' };
  }
  if (plan.isProtected && confirmText.trim().toLowerCase() !== targetName.trim().toLowerCase()) {
    return { allowed: false, reason: `Type the target name "${targetName}" to confirm a protected promotion.` };
  }
  return { allowed: true };
}

// ── Execution ────────────────────────────────────────────────────

export interface PromotionRunOptions {
  workspaceRoot: string;
  plan: PromotionPlan;
  config: DeliveryConfig;
  routine?: RoutineDefinition;
  onProgress?: (update: PromotionProgress) => void;
}

export interface PromotionProgress {
  stepId: string;
  label: string;
  index: number;
  total: number;
  status: 'running' | 'done' | 'failed' | 'skipped';
  output?: string;
}

/**
 * Execute the command/HTTP steps of a validated plan. The caller MUST have
 * already enforced {@link evaluatePromotionGate}; this method assumes the gate
 * passed and only executes backup → deploy → verify, returning per-step results
 * and a rollback hint. Commands are read from the plan/routine (server-sourced,
 * user-authored), never from any external input.
 */
export async function runPromotion(options: PromotionRunOptions): Promise<PromotionRunResult> {
  const { workspaceRoot, plan, config } = options;
  const to = config.stages.find(stage => stage.id === plan.toStageId);
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const results: PromotionStepResult[] = [];
  let succeeded = true;

  const executable = plan.steps.filter(step => step.kind === 'backup' || step.kind === 'deploy' || step.kind === 'verify');
  const total = executable.length;
  let index = 0;

  for (const step of executable) {
    index += 1;
    options.onProgress?.({ stepId: step.id, label: step.label, index, total, status: 'running' });

    // Once a hard failure occurs, skip the rest (deploy is sequential).
    if (!succeeded) {
      const skipped: PromotionStepResult = { id: step.id, label: step.label, ok: false, skipped: true, output: 'Skipped after an earlier failure.' };
      results.push(skipped);
      options.onProgress?.({ stepId: step.id, label: step.label, index, total, status: 'skipped' });
      continue;
    }

    let result: PromotionStepResult;
    if (step.kind === 'verify') {
      result = await runVerifyStep(step, to?.hosting.healthCheckUrl);
    } else if (step.command && step.command.trim().length > 0) {
      result = await runCommandStep(step, workspaceRoot);
    } else {
      // A deploy placeholder with no command — informational, not a failure.
      result = { id: step.id, label: step.label, ok: true, skipped: true, output: step.detail };
    }

    results.push(result);
    if (!result.ok && !result.skipped) {
      // Honor the routine step's on_fail for deploy steps; everything else aborts.
      const onFail = step.kind === 'deploy' ? routineOnFail(options.routine, step.id) : 'abort';
      if (onFail === 'continue') {
        options.onProgress?.({ stepId: step.id, label: step.label, index, total, status: 'failed', output: result.output });
        continue;
      }
      succeeded = false;
    }
    options.onProgress?.({
      stepId: step.id,
      label: step.label,
      index,
      total,
      status: result.skipped ? 'skipped' : result.ok ? 'done' : 'failed',
      output: result.output,
    });
  }

  return {
    pathId: plan.pathId,
    succeeded,
    steps: results,
    startedAt,
    durationMs: Date.now() - start,
    rollback: to ? { command: to.rollbackPolicy.command, runbookRef: to.rollbackPolicy.runbookRef } : undefined,
  };
}

/**
 * Execute a stage's rollback command (user-authored, server-sourced). The caller
 * is responsible for confirmation/authorization before invoking this.
 */
export async function runRollback(workspaceRoot: string, command: string): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execAsync(command, { cwd: workspaceRoot, timeout: STEP_TIMEOUT_MS, windowsHide: true });
    return { ok: true, output: clip(`${stdout}${stderr ? `\n${stderr}` : ''}`) || 'Rollback command completed.' };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, output: clip(`${e.stdout ?? ''}${e.stderr ? `\n${e.stderr}` : ''}${e.message ? `\n${e.message}` : ''}`.trim() || 'Rollback failed.') };
  }
}

async function runCommandStep(step: PromotionPlanStep, workspaceRoot: string): Promise<PromotionStepResult> {
  try {
    const { stdout, stderr } = await execAsync(step.command as string, {
      cwd: workspaceRoot,
      timeout: STEP_TIMEOUT_MS,
      windowsHide: true,
    });
    return { id: step.id, label: step.label, ok: true, skipped: false, output: clip(`${stdout}${stderr ? `\n${stderr}` : ''}`) };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      id: step.id,
      label: step.label,
      ok: false,
      skipped: false,
      output: clip(`${e.stdout ?? ''}${e.stderr ? `\n${e.stderr}` : ''}${e.message ? `\n${e.message}` : ''}`.trim() || 'Command failed.'),
    };
  }
}

async function runVerifyStep(step: PromotionPlanStep, healthCheckUrl: string | undefined): Promise<PromotionStepResult> {
  const url = (healthCheckUrl ?? '').trim();
  if (!url) {
    return { id: step.id, label: step.label, ok: true, skipped: true, output: 'No health-check URL configured — skipped.' };
  }
  try {
    const status = await httpStatus(url);
    const ok = status >= 200 && status < 400;
    return { id: step.id, label: step.label, ok, skipped: false, output: `${url} responded ${status}.` };
  } catch (err: unknown) {
    return { id: step.id, label: step.label, ok: false, skipped: false, output: `Health check failed: ${(err as Error).message}` };
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function routineOnFail(routine: RoutineDefinition | undefined, stepId: string): 'abort' | 'prompt' | 'continue' {
  if (!routine) {
    return 'abort';
  }
  const id = stepId.replace(/^deploy-/, '');
  return routine.steps.find(step => step.id === id)?.on_fail ?? 'abort';
}

function clip(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_OUTPUT_CHARS ? `${trimmed.slice(0, MAX_OUTPUT_CHARS)}\n… (truncated)` : trimmed;
}

/** Ping a health-check URL (used by the stage editor's "Test" button). */
export async function checkHealthUrl(url: string): Promise<{ ok: boolean; status: number; error?: string }> {
  const trimmed = (url ?? '').trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return { ok: false, status: 0, error: 'Enter an http(s) URL first.' };
  }
  try {
    const status = await httpStatus(trimmed);
    return { ok: status >= 200 && status < 400, status };
  } catch (err) {
    return { ok: false, status: 0, error: (err as Error).message };
  }
}

/** Return only the HTTP status code for a bounded GET; rejects on error/timeout. */
function httpStatus(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let client: typeof http | typeof https;
    try {
      client = new URL(url).protocol === 'http:' ? http : https;
    } catch {
      reject(new Error('Invalid URL'));
      return;
    }
    const request = client.get(url, response => {
      response.resume(); // discard body
      resolve(response.statusCode ?? 0);
    });
    request.setTimeout(VERIFY_TIMEOUT_MS, () => {
      request.destroy(new Error(`Timed out after ${VERIFY_TIMEOUT_MS}ms`));
    });
    request.on('error', reject);
  });
}

/**
 * Compare two semver-ish versions. Returns >0 when `a` is newer than `b`,
 * <0 when older, 0 when equal. Pre-release suffixes are ignored.
 */
export function compareSemver(a: string, b: string): number {
  const parse = (value: string): number[] =>
    value.replace(/^v/, '').split('-')[0].split('.').map(part => Number.parseInt(part, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'check';
}

// ── Remediation (Resolve & run) ──────────────────────────────────

/**
 * Assess the SemVer bump level warranted by a set of commit messages, using the
 * conventional-commits convention: a breaking change (`type!:` subject or a
 * `BREAKING CHANGE` footer) ⇒ major; any `feat:` ⇒ minor; otherwise patch. This
 * matches both general SemVer practice and repos whose stated rules follow it.
 */
export function classifyBumpLevel(commitMessages: readonly string[]): BumpLevel {
  let level: BumpLevel = 'patch';
  for (const raw of commitMessages) {
    const message = (raw ?? '').trim();
    if (!message) {
      continue;
    }
    const subject = message.split('\n', 1)[0];
    if (/^[a-z]+(\([^)]*\))?!:/i.test(subject) || /breaking[ -]change/i.test(message)) {
      return 'major';
    }
    if (/^feat(\([^)]*\))?:/i.test(subject)) {
      level = 'minor';
    }
  }
  return level;
}

/** Increment a semver-ish version by the given level (pre-release suffixes dropped). */
export function bumpVersion(base: string, level: BumpLevel): string {
  const parts = (base ?? '').replace(/^v/, '').split('-')[0].split('.');
  let major = Number.parseInt(parts[0], 10) || 0;
  let minor = Number.parseInt(parts[1], 10) || 0;
  let patch = Number.parseInt(parts[2], 10) || 0;
  if (level === 'major') {
    major += 1; minor = 0; patch = 0;
  } else if (level === 'minor') {
    minor += 1; patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

/**
 * Replace only the top-level `"version"` string in a package.json document,
 * preserving all other formatting. Returns the input unchanged when no version
 * field is found (caller treats that as a failure).
 */
export function setPackageJsonVersion(raw: string, newVersion: string): string {
  return raw.replace(/("version"\s*:\s*")([^"]*)(")/, `$1${newVersion}$3`);
}

/**
 * Insert a new `## [version] - date` section into a Keep-a-Changelog document,
 * beneath an `## [Unreleased]` section when present (otherwise above the first
 * version heading), keeping the `# Changelog` title and preamble intact.
 */
export function insertChangelogEntry(raw: string, version: string, date: string): string {
  const entry = `## [${version}] - ${date}\n\n### Changed\n- _Release ${version}. Describe the changes included in this promotion._\n`;
  const lines = raw.split('\n');
  const headingIdx: number[] = [];
  lines.forEach((line, index) => {
    if (/^##\s+\[/.test(line)) {
      headingIdx.push(index);
    }
  });
  if (headingIdx.length === 0) {
    return `${raw.replace(/\n+$/, '')}\n\n${entry}`;
  }
  let insertAt = headingIdx[0];
  if (lines[headingIdx[0]].toLowerCase().includes('[unreleased]')) {
    insertAt = headingIdx[1] ?? lines.length;
  }
  const head = lines.slice(0, insertAt).join('\n').replace(/\n+$/, '');
  const tail = lines.slice(insertAt).join('\n').replace(/^\n+/, '');
  return tail ? `${head}\n\n${entry}\n${tail}` : `${head}\n\n${entry}`;
}

/** Minimal Keep-a-Changelog document seeded with the first release entry. */
export function buildInitialChangelog(version: string, date: string): string {
  return [
    '# Changelog',
    '',
    'All notable changes to this project are documented in this file.',
    '',
    'The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).',
    '',
    `## [${version}] - ${date}`,
    '',
    '### Changed',
    `- _Release ${version}._`,
    '',
  ].join('\n');
}

export interface RemediationApplyResult {
  ok: boolean;
  committed: boolean;
  output: string;
}

/**
 * Apply a {@link PromotionRemediation}: bump `package.json`, add/seed a
 * `CHANGELOG.md` entry, and commit ONLY those files with a conventional message.
 * Never stages unrelated changes; never pushes or force-pushes. All inputs are
 * server-sourced (the computed plan), never from a webview message.
 */
export async function applyPromotionRemediation(
  workspaceRoot: string,
  remediation: PromotionRemediation,
): Promise<RemediationApplyResult> {
  // Defence-in-depth: the version is written into files and the commit message, so
  // refuse anything that is not a plain semver — even though it is server-computed.
  if (!SAFE_VERSION.test(remediation.targetVersion)) {
    return { ok: false, committed: false, output: `Refusing to apply an unexpected version string: "${remediation.targetVersion}".` };
  }
  const changedFiles: string[] = [];
  try {
    if (remediation.bumpLevel) {
      const pkgPath = path.join(workspaceRoot, 'package.json');
      const raw = await fs.readFile(pkgPath, 'utf-8');
      const updated = setPackageJsonVersion(raw, remediation.targetVersion);
      if (updated === raw) {
        return { ok: false, committed: false, output: 'Could not update the "version" field in package.json.' };
      }
      await fs.writeFile(pkgPath, updated, 'utf-8');
      changedFiles.push('package.json');
    }

    if (remediation.editsChangelog) {
      const clPath = path.join(workspaceRoot, 'CHANGELOG.md');
      const date = new Date().toISOString().slice(0, 10);
      let next: string;
      let existed = true;
      let previous = '';
      try {
        previous = await fs.readFile(clPath, 'utf-8');
        next = previous.includes(`[${remediation.targetVersion}]`)
          ? previous
          : insertChangelogEntry(previous, remediation.targetVersion, date);
      } catch {
        existed = false;
        next = buildInitialChangelog(remediation.targetVersion, date);
      }
      if (!existed || next !== previous) {
        await fs.writeFile(clPath, next, 'utf-8');
        changedFiles.push('CHANGELOG.md');
      }
    }

    if (changedFiles.length === 0) {
      return { ok: true, committed: false, output: 'No changes were necessary.' };
    }

    if (!remediation.commits) {
      return { ok: true, committed: false, output: `Edited ${changedFiles.join(', ')} (left uncommitted).` };
    }

    // Commit ONLY the files we edited (path-scoped), never unrelated changes.
    // execFile passes arguments directly (no shell), so the version/message can
    // never be interpreted as a command — and we never push or force-push.
    const subject = `chore(release): v${remediation.targetVersion}`;
    await execFileAsync('git', ['add', '--', ...changedFiles], { cwd: workspaceRoot, timeout: STEP_TIMEOUT_MS, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', subject, '--', ...changedFiles], { cwd: workspaceRoot, timeout: STEP_TIMEOUT_MS, windowsHide: true });
    return { ok: true, committed: true, output: `${subject} — ${changedFiles.join(', ')}.` };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      committed: false,
      output: clip(`${e.stdout ?? ''}${e.stderr ? `\n${e.stderr}` : ''}${e.message ? `\n${e.message}` : ''}`.trim() || 'Remediation failed.'),
    };
  }
}
