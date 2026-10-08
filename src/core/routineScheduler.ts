/**
 * Runs scheduled routines while the editor is open, one at a time, each in a
 * worktree of its own, and reports back.
 *
 * `routineSchedule` decides what is due and `scheduledRoutinePolicy` decides
 * what may run unattended; this is the wiring, and the wiring is where a
 * correct policy gets routed around — a run that starts in the main tree when
 * the worktree could not be made, a crash that replays a run on every restart,
 * a dry run that creates a branch before it notices it is a dry run. So it is a
 * class with injected effects and tests rather than a closure in `extension.ts`.
 *
 * Seven rules, in the order a tick meets them:
 *
 * 1. **One scheduled run at a time, and one per tick.** A run in progress
 *    holds the scheduler; a due routine waits for the next tick.
 * 2. **The attempt is recorded before anything executes.** If the editor closes
 *    or the host crashes mid-run, the window is already closed and the run is
 *    reported as interrupted — never replayed on every restart.
 * 3. **A dry run is recorded, not executed** — checked before a worktree or a
 *    branch exists, so a dry run leaves nothing behind but the record. It is a
 *    timer's write, so it is recorded without a notification.
 * 4. **A refused plan never reaches a worktree.** A placeholder nobody can fill
 *    at 02:00, or a routine with nothing it may run unattended, is reported
 *    from the run history without creating a branch for nothing.
 * 5. **No worktree, no run.** A worktree that cannot be made — not a git
 *    repository, `.git` is a file, git refused — refuses the run. Falling back
 *    to the main tree would be the scheduler touching the developer's working
 *    tree, which is the one thing it promises not to do.
 * 6. **A worktree holding work is kept; an empty one is removed**, with its
 *    branch, because a branch per night with nothing on it is litter. Kept
 *    means reported, with the branch and the path.
 * 7. **It never pushes, merges or opens anything**, and holds no model: steps
 *    are commands from the approved routine, and their output goes into the run
 *    record and the report, nowhere else.
 */

import type { RoutineDefinition, RoutineRunResult } from '../types.js';
import { interceptDryRun } from './dryRunHost.js';
import { planRoutineExecution, type RoutineExecutionPlan } from './routineExecutionPolicy.js';
import type { RoutineRunRecordOptions } from './routineRunner.js';
import {
  buildRoutineScheduleBoard,
  nextScheduledRoutine,
  routineScheduleFingerprint,
  sanitizeScheduledRoutineState,
  scheduledRoutineAttentionInput,
  type RoutineScheduleBoard,
  type ScheduledRoutineState,
  type ScheduledRunMemo,
} from './routineSchedule.js';
import {
  describeScheduledRunReport,
  planUnattendedRun,
  scheduledRunBranchName,
  toUnattendedExecutionPlan,
  type ScheduledRunReportInput,
} from './scheduledRoutinePolicy.js';
import { worktreePathFor, type WorktreeGitRunner } from './worktreeManager.js';

export interface RoutineSchedulerDeps {
  listRoutines: () => RoutineDefinition[];
  /** `atlasmind.routines.scheduling.enabled`. */
  isEnabled: () => boolean;
  isWorkspaceTrusted: () => boolean;
  workspaceRoot: () => string | undefined;
  /** Per developer — see `SCHEDULED_ROUTINE_STATE_NOTE`. */
  readState: () => unknown;
  writeState: (state: ScheduledRoutineState) => Promise<void> | void;
  /** git with no shell; every argument list is composed here. */
  runGit: WorktreeGitRunner;
  /** `RoutineRunner.run`, with the failure decision fixed to abort. */
  runRoutine: (
    routine: RoutineDefinition,
    plan: RoutineExecutionPlan,
    cwd: string,
    options: RoutineRunRecordOptions,
  ) => Promise<RoutineRunResult>;
  /** Tells the developer. Never asks anything. */
  report: (message: string, memo: ScheduledRunMemo, routineId: string) => void;
  now?: () => Date;
  timeZone?: string;
  /** For the board only; the run itself asks `interceptDryRun`, which records. */
  isDryRunActive?: () => boolean;
}

export class RoutineScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private runningRoutineId: string | undefined;

  constructor(private readonly deps: RoutineSchedulerDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private state(): ScheduledRoutineState {
    return sanitizeScheduledRoutineState(this.deps.readState());
  }

  board(): RoutineScheduleBoard {
    return buildRoutineScheduleBoard({
      routines: this.deps.listRoutines(),
      enabled: this.deps.isEnabled(),
      workspaceTrusted: this.deps.isWorkspaceTrusted(),
      dryRun: this.deps.isDryRunActive?.() ?? false,
      ...(this.runningRoutineId ? { runningRoutineId: this.runningRoutineId } : {}),
      state: this.state(),
      now: this.now(),
      ...(this.deps.timeZone ? { timeZone: this.deps.timeZone } : {}),
    });
  }

  attentionInput(): ReturnType<typeof scheduledRoutineAttentionInput> {
    return scheduledRoutineAttentionInput(this.board());
  }

  /**
   * Approve a routine, as it is now, to run unattended.
   *
   * The caller shows the steps first; this records the fingerprint of what was
   * shown. Approving does not run anything: the next window does, and a window
   * before this moment was not missed.
   */
  async approve(routine: RoutineDefinition): Promise<void> {
    const state = this.state();
    state.approvals[routine.id] = { fingerprint: routineScheduleFingerprint(routine), approvedAt: this.now().toISOString() };
    await this.deps.writeState(state);
  }

  /** Withdraw an approval. The last run's report stays, because it happened. */
  async revoke(routineId: string): Promise<void> {
    const state = this.state();
    delete state.approvals[routineId];
    await this.deps.writeState(state);
  }

  /** Somebody read the latest report. It stops counting in the attention feed. */
  async markReviewed(routineId: string): Promise<void> {
    const state = this.state();
    const memo = state.runs[routineId];
    if (memo) {
      state.runs[routineId] = { ...memo, reviewedAt: this.now().toISOString() };
      await this.deps.writeState(state);
    }
  }

  /**
   * One evaluation. Runs at most one routine; returns its memo, or `undefined`
   * when nothing was due. Never throws — a tick that failed is reported as a
   * failed run, and a timer must not take the host down.
   */
  async tick(): Promise<ScheduledRunMemo | undefined> {
    if (this.runningRoutineId !== undefined) {
      return undefined;
    }
    const picked = nextScheduledRoutine(this.board());
    if (!picked) {
      return undefined;
    }
    const routine = this.deps.listRoutines().find(entry => entry.id === picked.routineId);
    const workspaceRoot = this.deps.workspaceRoot();
    if (!routine || !workspaceRoot) {
      return undefined;
    }

    this.runningRoutineId = routine.id;
    const startedAt = this.now();
    const windowAt = picked.latestWindowAt ?? startedAt.toISOString();
    try {
      await this.saveMemo(routine.id, {
        windowAt,
        attemptedAt: startedAt.toISOString(),
        outcome: 'running',
        summary: `Scheduled run of "${routine.name}" started.`,
      });
      const memo = await this.execute(routine, workspaceRoot, windowAt, startedAt);
      await this.saveMemo(routine.id, memo);
      if (memo.outcome !== 'dry-run') {
        try {
          this.deps.report(memo.summary, memo, routine.id);
        } catch {
          // The memo is saved; a notification that failed loses nothing.
        }
      }
      return memo;
    } catch (error) {
      const memo: ScheduledRunMemo = {
        windowAt,
        attemptedAt: startedAt.toISOString(),
        outcome: 'failed',
        summary: `Scheduled run of "${routine.name}" failed before it could report: ${describe(error)}`,
      };
      await this.saveMemo(routine.id, memo).catch(() => undefined);
      return memo;
    } finally {
      this.runningRoutineId = undefined;
    }
  }

  private async saveMemo(routineId: string, memo: ScheduledRunMemo): Promise<void> {
    const state = this.state();
    state.runs[routineId] = memo;
    await this.deps.writeState(state);
  }

  private async execute(
    routine: RoutineDefinition,
    workspaceRoot: string,
    windowAt: string,
    startedAt: Date,
  ): Promise<ScheduledRunMemo> {
    const memoBase = { windowAt, attemptedAt: startedAt.toISOString() };

    // No values: nobody is present to supply `${message}`, and an absent value
    // is not an empty one, so a routine that needs one is refused.
    const plan = planRoutineExecution(routine, {});

    const dryRun = interceptDryRun({
      surface: 'scheduled-routine',
      kind: 'process',
      summary: `run the scheduled "${routine.name}" routine in a new worktree`
        + (plan.status === 'ready' ? ` (${plan.steps.map(step => step.command).join('; ')})` : ''),
      details: { routineId: routine.id, windowAt },
      userInitiated: false,
      wouldHaveAsked: false,
    });
    if (dryRun) {
      return {
        ...memoBase,
        outcome: 'dry-run',
        summary: `Dry run: the scheduled "${routine.name}" routine was recorded, not run. Nothing executed and no worktree was made.`,
      };
    }

    if (plan.status === 'refused') {
      await this.deps.runRoutine(routine, plan, workspaceRoot, { titlePrefix: 'Scheduled routine' });
      return {
        ...memoBase,
        outcome: 'refused',
        summary: describeScheduledRunReport({
          routineName: routine.name,
          outcome: 'refused',
          refusedReason: plan.refusals.map(refusal => refusal.detail).join(' '),
        }),
      };
    }

    const unattended = planUnattendedRun(plan);
    const notRun = unattended.notRun.map(step => ({
      label: step.label,
      reason: unattended.stoppedAt?.rule.description ?? 'needs a person present',
    }));
    const stoppedAt = unattended.stoppedAt
      ? { command: unattended.stoppedAt.step.command, rule: unattended.stoppedAt.rule }
      : undefined;

    if (unattended.runnable.length === 0) {
      await this.deps.runRoutine(routine, toUnattendedExecutionPlan(plan, unattended), workspaceRoot, {
        titlePrefix: 'Scheduled routine',
        notRun,
        notes: ['Nothing in this routine can run unattended, so no worktree was made.'],
      });
      return {
        ...memoBase,
        outcome: 'needs-a-person',
        summary: describeScheduledRunReport({
          routineName: routine.name,
          outcome: 'needs-a-person',
          ...(stoppedAt ? { stoppedAt } : {}),
        }),
      };
    }

    // ── The worktree ────────────────────────────────────────────
    const existing = await this.deps.runGit(['branch', '--list', '--format=%(refname:short)', 'chore/scheduled-*'], workspaceRoot)
      .then(out => out.split(/\r?\n/).map(line => line.trim()).filter(Boolean))
      .catch(() => [] as string[]);
    const branch = scheduledRunBranchName(routine.id, startedAt, existing);
    if (!branch.ok) {
      return this.refusedWithoutRunning(routine, workspaceRoot, plan, memoBase, branch.reason);
    }
    const stamp = `${startedAt.getFullYear()}${pad(startedAt.getMonth() + 1)}${pad(startedAt.getDate())}-${pad(startedAt.getHours())}${pad(startedAt.getMinutes())}`;
    const worktreePath = worktreePathFor(workspaceRoot, `scheduled-${routine.id}`, stamp);
    let baseCommit: string;
    try {
      baseCommit = (await this.deps.runGit(['rev-parse', 'HEAD'], workspaceRoot)).trim();
      await this.deps.runGit(['worktree', 'add', '-b', branch.name, worktreePath, 'HEAD'], workspaceRoot);
    } catch (error) {
      return this.refusedWithoutRunning(
        routine,
        workspaceRoot,
        plan,
        memoBase,
        `no worktree could be made (${describe(error)}). A scheduled run never falls back to your working tree.`,
      );
    }

    // ── The run ─────────────────────────────────────────────────
    let result: RoutineRunResult | undefined;
    let runError: unknown;
    try {
      result = await this.deps.runRoutine(routine, toUnattendedExecutionPlan(plan, unattended), worktreePath, {
        titlePrefix: 'Scheduled routine',
        notRun,
        notes: [
          `Ran in ${worktreePath} on branch ${branch.name}, from ${baseCommit.slice(0, 12)}. Your working tree was not touched.`,
          ...unattended.wouldHaveAsked.map(step => `"${step.label}" would have asked you on failure; unattended, it stops instead.`),
        ],
      });
    } catch (error) {
      runError = error;
    }

    // ── What it left behind ─────────────────────────────────────
    const holdsWork = await this.worktreeHoldsWork(worktreePath, baseCommit);
    let kept = holdsWork;
    if (!holdsWork) {
      try {
        await this.deps.runGit(['worktree', 'remove', '--force', worktreePath], workspaceRoot);
        // `-d`, not `-D`: it refuses a branch with commits not reachable from
        // HEAD, so if this ever misjudged "empty" the branch survives it.
        await this.deps.runGit(['branch', '-d', branch.name], workspaceRoot).catch(() => undefined);
      } catch {
        kept = true;
      }
    }
    const place = kept ? { branch: branch.name, worktreePath } : {};

    if (runError !== undefined || !result) {
      return {
        ...memoBase,
        ...place,
        outcome: 'failed',
        summary: `Scheduled run of "${routine.name}" failed: ${describe(runError)}`,
      };
    }

    const outcome: ScheduledRunReportInput['outcome'] = !result.succeeded
      ? 'failed'
      : stoppedAt ? 'needs-a-person' : 'completed';
    const failedStep = result.failedStep
      ? result.steps.find(step => step.stepId === result!.failedStep)?.label ?? result.failedStep
      : undefined;
    return {
      ...memoBase,
      ...place,
      outcome,
      summary: describeScheduledRunReport({
        routineName: routine.name,
        outcome,
        ...(failedStep ? { failedStep } : {}),
        ...(stoppedAt ? { stoppedAt } : {}),
        ...place,
      }),
    };
  }

  private async refusedWithoutRunning(
    routine: RoutineDefinition,
    workspaceRoot: string,
    plan: Extract<RoutineExecutionPlan, { status: 'ready' }>,
    memoBase: { windowAt: string; attemptedAt: string },
    reason: string,
  ): Promise<ScheduledRunMemo> {
    // Recorded in run history as a refusal, through the runner's own refusal
    // path, so the Run Center shows it beside every other run.
    await this.deps.runRoutine(
      routine,
      { routineId: plan.routineId, routineName: plan.routineName, status: 'refused', refusals: [{ rule: 'no-steps', detail: reason }] },
      workspaceRoot,
      { titlePrefix: 'Scheduled routine' },
    ).catch(() => undefined);
    return {
      ...memoBase,
      outcome: 'refused',
      summary: describeScheduledRunReport({ routineName: routine.name, outcome: 'refused', refusedReason: reason }),
    };
  }

  /**
   * Whether the worktree holds anything worth keeping: uncommitted changes, or
   * commits beyond where it started. Unable to tell means yes — keeping is the
   * direction that cannot destroy anything.
   */
  private async worktreeHoldsWork(worktreePath: string, baseCommit: string): Promise<boolean> {
    try {
      const status = await this.deps.runGit(['status', '--porcelain'], worktreePath);
      if (status.trim().length > 0) {
        return true;
      }
      const head = (await this.deps.runGit(['rev-parse', 'HEAD'], worktreePath)).trim();
      return head !== baseCommit;
    } catch {
      return true;
    }
  }

  /** Evaluate now and then on an interval (idempotent). */
  start(intervalMs: number): void {
    this.stop();
    void this.tick().catch(() => undefined);
    this.timer = setInterval(() => {
      void this.tick().catch(() => undefined);
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  dispose(): void {
    this.stop();
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'unknown error');
}
