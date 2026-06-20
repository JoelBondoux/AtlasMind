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

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as https from 'node:https';
import * as http from 'node:http';
import type {
  DeliveryConfig,
  PromotionPlan,
  PromotionPlanStep,
  PromotionPreflightCheck,
  PromotionRunResult,
  PromotionStepResult,
  RoutineDefinition,
} from '../types.js';

const execAsync = promisify(exec);

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
  const hasRoutine = Boolean(input.routine && input.routine.steps.length > 0);
  if (viaPullRequest && !hasRoutine) {
    blockers.push(`Promotion to ${to.name} must go through a Pull Request into \`${to.branchRef ?? 'the protected branch'}\`, but no promotion routine is bound to open one. Bind a routine (in the push editor) that runs your PR / merge / publish flow.`);
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
  // Attested manually (AtlasMind does not poll live CI status in this phase).
  for (const context of to.promotionPolicy.requiredStatusChecks ?? []) {
    checks.push({
      id: `status-${slugify(context)}`,
      label: `CI green: ${context}`,
      kind: 'manual',
      status: 'manual',
      detail: viaPullRequest ? 'Confirm this CI check is green on the Pull Request.' : 'Confirm this CI check is green.',
    });
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
  } else {
    steps.push({
      id: 'deploy-none',
      kind: 'deploy',
      label: 'Deploy steps',
      detail: path.routineId
        ? `No routine "${path.routineId}" found in project_memory/routines/. Add your deploy/migration steps there.`
        : 'No promotion routine bound. Bind one (in the push editor) to run real deploy/migration commands.',
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
