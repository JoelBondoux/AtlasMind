import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProjectRunRecord, RoutineDefinition, RoutineRunResult, RoutineStep, RoutineStepResult } from '../types.js';
import type { ProjectRunHistory } from './projectRunHistory.js';

const execAsync = promisify(exec);
const STEP_TIMEOUT_MS = 60_000;

export type RoutineProgressCallback = (
  step: RoutineStep,
  index: number,
  total: number,
) => void;

export type RoutineFailureCallback = (
  step: RoutineStep,
  result: RoutineStepResult,
) => Promise<'retry' | 'skip' | 'abort'>;

export class RoutineRunner {
  constructor(private readonly runHistory: ProjectRunHistory) {}

  /**
   * Executes all steps of the given routine sequentially.
   * Calls onProgress before each step and onFailure when a step exits non-zero.
   * Logs the final result to ProjectRunHistory.
   */
  async run(
    routine: RoutineDefinition,
    vars: Record<string, string>,
    workspaceRoot: string,
    onProgress: RoutineProgressCallback,
    onFailure: RoutineFailureCallback,
  ): Promise<RoutineRunResult> {
    const startedAt = Date.now();
    const stepResults: RoutineStepResult[] = [];
    let failedStep: string | undefined;
    let succeeded = true;

    for (let i = 0; i < routine.steps.length; i++) {
      const step = routine.steps[i];
      onProgress(step, i, routine.steps.length);

      let stepResult = await this.executeStep(step, vars, workspaceRoot);
      stepResults.push(stepResult);

      if (stepResult.exitCode !== 0) {
        if (step.on_fail === 'abort') {
          failedStep = step.id;
          succeeded = false;
          break;
        }

        if (step.on_fail === 'prompt') {
          const decision = await onFailure(step, stepResult);
          if (decision === 'abort') {
            failedStep = step.id;
            succeeded = false;
            break;
          }
          if (decision === 'retry') {
            stepResult = await this.executeStep(step, vars, workspaceRoot);
            // Update the last result in place
            stepResults[stepResults.length - 1] = stepResult;
            if (stepResult.exitCode !== 0) {
              failedStep = step.id;
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
    step: RoutineStep,
    vars: Record<string, string>,
    workspaceRoot: string,
  ): Promise<RoutineStepResult> {
    const command = interpolate(step.run, vars);
    const stepStart = Date.now();

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: workspaceRoot,
        timeout: STEP_TIMEOUT_MS,
        windowsHide: true,
      });
      return {
        stepId: step.id,
        label: step.label,
        exitCode: 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        durationMs: Date.now() - stepStart,
      };
    } catch (err: unknown) {
      const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
      return {
        stepId: step.id,
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

/** Replaces ${varName} tokens in a command string with values from vars. */
function interpolate(command: string, vars: Record<string, string>): string {
  return command.replace(/\$\{([^}]+)\}/g, (_, name: string) => vars[name] ?? '');
}
