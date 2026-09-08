import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProjectRunRecord, RoutineDefinition, RoutineRunResult, RoutineStepResult } from '../types.js';
import type { ProjectRunHistory } from './projectRunHistory.js';
import type { RoutineExecutionPlan, RoutinePlannedStep } from './routineExecutionPolicy.js';

const execAsync = promisify(exec);
const STEP_TIMEOUT_MS = 60_000;
/**
 * A routine step is a build or release command; `npm run build` alone can
 * exceed Node's 1 MiB default, and the failure arrives as `ENOBUFS` — a routine
 * that reports a step failed when the step actually succeeded and only talked
 * too much.
 */
const STEP_OUTPUT_BUFFER_BYTES = 4 * 1024 * 1024;

export type RoutineProgressCallback = (
  step: RoutinePlannedStep,
  index: number,
  total: number,
) => void;

export type RoutineFailureCallback = (
  step: RoutinePlannedStep,
  result: RoutineStepResult,
) => Promise<'retry' | 'skip' | 'abort'>;

export class RoutineRunner {
  constructor(private readonly runHistory: ProjectRunHistory) {}

  /**
   * Executes a **planned** routine sequentially.
   *
   * Takes the plan rather than the routine and its values, and that is the
   * point: the commands executed here are the exact strings
   * `planRoutineExecution` produced, which is what a caller showed the operator
   * before asking. A runner that re-substituted would be able to run something
   * other than what was agreed to, and no amount of care at the call sites
   * would make that impossible.
   *
   * Calls onProgress before each step and onFailure when a step exits non-zero.
   * Logs the final result to ProjectRunHistory.
   */
  async run(
    routine: RoutineDefinition,
    plan: RoutineExecutionPlan,
    workspaceRoot: string,
    onProgress: RoutineProgressCallback,
    onFailure: RoutineFailureCallback,
  ): Promise<RoutineRunResult> {
    const startedAt = Date.now();
    const stepResults: RoutineStepResult[] = [];
    let failedStep: string | undefined;
    let succeeded = true;

    // A plan built for a different routine is a wiring mistake, and the
    // consequence of letting it through is running one routine's commands
    // under another's name in the run history.
    const reason = plan.routineId !== routine.id
      ? `This plan was built for "${plan.routineId}", not "${routine.id}". Nothing was run.`
      : plan.status === 'refused'
        ? plan.refusals.map(refusal => refusal.detail).join(' ')
        : undefined;

    if (reason !== undefined || plan.status !== 'ready') {
      const result: RoutineRunResult = {
        routineId: routine.id,
        routineName: routine.name,
        steps: [],
        succeeded: false,
        failedStep: routine.steps[0]?.id,
        durationMs: Date.now() - startedAt,
        refusedReason: reason,
      };
      await this.persistResult(routine, result);
      return result;
    }

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      onProgress(step, i, plan.steps.length);

      let stepResult = await this.executeStep(step, workspaceRoot);
      stepResults.push(stepResult);

      if (stepResult.exitCode !== 0) {
        if (step.onFail === 'abort') {
          failedStep = step.stepId;
          succeeded = false;
          break;
        }

        if (step.onFail === 'prompt') {
          const decision = await onFailure(step, stepResult);
          if (decision === 'abort') {
            failedStep = step.stepId;
            succeeded = false;
            break;
          }
          if (decision === 'retry') {
            stepResult = await this.executeStep(step, workspaceRoot);
            // Update the last result in place
            stepResults[stepResults.length - 1] = stepResult;
            if (stepResult.exitCode !== 0) {
              failedStep = step.stepId;
              succeeded = false;
              break;
            }
          }
          // 'skip' — mark as skipped and continue
          if (decision === 'skip') {
            stepResults[stepResults.length - 1] = { ...stepResult, skipped: true };
          }
        }
        // on_fail: 'continue' — log the failure but keep going
      }
    }

    const result: RoutineRunResult = {
      routineId: routine.id,
      routineName: routine.name,
      steps: stepResults,
      succeeded,
      failedStep,
      durationMs: Date.now() - startedAt,
    };

    await this.persistResult(routine, result);
    return result;
  }

  private async executeStep(
    step: RoutinePlannedStep,
    workspaceRoot: string,
  ): Promise<RoutineStepResult> {
    // Taken from the plan, never rebuilt. Substitution happens once, in
    // `planRoutineExecution`, so the string here is the one that was shown.
    const command = step.command;
    const stepStart = Date.now();

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: workspaceRoot,
        timeout: STEP_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: STEP_OUTPUT_BUFFER_BYTES,
      });
      return {
        stepId: step.stepId,
        label: step.label,
        exitCode: 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        durationMs: Date.now() - stepStart,
      };
    } catch (err: unknown) {
      const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
      return {
        stepId: step.stepId,
        label: step.label,
        exitCode: typeof e.code === 'number' ? e.code : 1,
        stdout: (e.stdout ?? '').trim(),
        stderr: (e.stderr ?? e.message ?? '').trim(),
        durationMs: Date.now() - stepStart,
      };
    }
  }

  private async persistResult(routine: RoutineDefinition, result: RoutineRunResult): Promise<void> {
    const now = new Date().toISOString();
    const runId = `routine-${routine.id}-${Date.now()}`;

    const record: ProjectRunRecord = {
      id: runId,
      title: `Routine: ${routine.name}`,
      goal: routine.description || routine.name,
      status: result.succeeded ? 'completed' : 'failed',
      createdAt: now,
      updatedAt: now,
      estimatedFiles: 0,
      requiresApproval: false,
      planSubtaskCount: routine.steps.length,
      completedSubtaskCount: result.steps.filter(s => s.exitCode === 0 && !s.skipped).length,
      totalSubtaskCount: routine.steps.length,
      currentBatch: 1,
      totalBatches: 1,
      failedSubtaskTitles: result.failedStep
        ? [result.steps.find(s => s.stepId === result.failedStep)?.label ?? result.failedStep]
        : [],
      subTaskArtifacts: [],
      executionOptions: {
        autonomousMode: true,
        requireBatchApproval: false,
        mirrorProgressToChat: false,
        injectOutputIntoFollowUp: false,
      },
      requireBatchApproval: false,
      paused: false,
      awaitingBatchApproval: false,
      logs: result.steps.map(s => ({
        timestamp: now,
        level: s.exitCode === 0 ? 'info' as const : 'error' as const,
        message: s.skipped
          ? `[${s.label}] skipped`
          : `[${s.label}] exit ${s.exitCode}${s.stderr ? `\n${s.stderr}` : ''}${s.stdout ? `\n${s.stdout}` : ''}`,
      })),
    };

    try {
      await this.runHistory.upsertRun(record);
    } catch {
      // History persistence is best-effort; don't fail the routine run.
    }
  }
}
