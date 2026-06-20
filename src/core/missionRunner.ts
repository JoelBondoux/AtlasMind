/**
 * MissionRunner — the autonomous goal-seeking loop.
 *
 * Wraps the existing single-pass plan→execute→synthesize machinery in an outer
 * loop that re-evaluates progress against a goal after every iteration and keeps
 * going until the goal is met OR the closed parameter envelope confines progress.
 *
 * Per iteration:
 *   1. Guardrail pre-check — iterations / cost / tokens / wall-clock / no-progress
 *      and the project-wide daily budget gate. Any hard cap → stop.
 *   2. Checkpoint gate — hybrid autonomy: when a configured trigger fires, pause
 *      for approval (deny-by-default if unanswered).
 *   3. Plan increment — Planner decomposes the next slice, grounded in guardrails,
 *      success criteria, the evaluator's next-focus, and a carry-forward summary.
 *   4. Execute — Orchestrator.processProject runs the increment (discovery happens
 *      inside, gated by existing approval gates).
 *   5. Evaluate — GoalEvaluator returns a validated verdict (untrusted output).
 *   6. Decide — achieved+confident → stop success; blocked → stop; else continue.
 *
 * Decoupled by design: every dependency is a narrow structural interface, so the
 * loop is `vscode`-free and unit-testable with fakes. The Orchestrator, Planner,
 * CostTracker, and MissionRegistry satisfy these interfaces structurally.
 */

import type {
  ChangedWorkspaceFile,
  GoalVerdict,
  MissionCapabilityRecord,
  MissionConfig,
  MissionIterationResult,
  MissionProgressUpdate,
  MissionResult,
  MissionRunRecord,
  MissionSettingBlocker,
  MissionStatus,
  MissionStopReason,
  ProjectPlan,
  ProjectProgressUpdate,
  ProjectResult,
  RoutingConstraints,
  SubTaskResult,
} from '../types.js';
import { DEFAULT_MISSION_GOAL_CONFIDENCE } from '../constants.js';
import { GoalEvaluator } from './goalEvaluator.js';

// ── Narrow dependency interfaces (kept structural for testability) ─

export interface MissionExecutor {
  processProject(
    goal: string,
    constraints: RoutingConstraints,
    onProgress?: (update: ProjectProgressUpdate) => void,
    options?: { planOverride?: ProjectPlan; signal?: AbortSignal; sessionContext?: string },
  ): Promise<ProjectResult>;
  summarizeText(systemPrompt: string, userPrompt: string): Promise<string>;
}

export interface MissionPlannerLike {
  plan(goal: string, constraints: RoutingConstraints, signal?: AbortSignal): Promise<ProjectPlan>;
}

export interface MissionBudgetStore {
  getDailyBudgetStatus(projectedAdditionalCostUsd?: number): { blocked: boolean; reason?: string } | undefined;
}

export interface MissionPersistence {
  save(record: MissionRunRecord): Promise<void>;
}

export interface MissionCheckpointRequest {
  missionId: string;
  iterationIndex: number;
  reason: string;
  spentUsd: number;
  budgetUsd: number;
  spentTokens: number;
  iterationsRun: number;
}

/** How the user chose to resolve a recoverable setting block. */
export type MissionBlockResolution = 'override-once' | 'open-settings' | 'stop';

export interface MissionBlockedRequest {
  missionId: string;
  iterationIndex: number;
  blocker: MissionSettingBlocker;
}

export interface MissionRunnerHooks {
  /**
   * Called when a checkpoint trigger fires. Must resolve `true` to proceed.
   * Deny-by-default: when the hook is absent or throws, the checkpoint is denied
   * and the mission stops, surfacing for the user.
   */
  checkpointGate?: (request: MissionCheckpointRequest) => Promise<boolean>;
  /**
   * Called when the loop would otherwise stop because progress is blocked by a
   * recoverable AtlasMind setting (e.g. terminal-write disabled). Lets the user
   * override for this run, open settings, or stop — instead of silently
   * cancelling. Deny-by-default: an absent hook or a throw is treated as `stop`.
   */
  blockedGate?: (request: MissionBlockedRequest) => Promise<MissionBlockResolution>;
}

export interface MissionRunOptions {
  hooks?: MissionRunnerHooks;
  onProgress?: (update: MissionProgressUpdate) => void;
  signal?: AbortSignal;
  /** Minimum evaluator confidence to accept an `achieved` verdict. */
  goalConfidenceThreshold?: number;
  /** Capture the files changed by the just-executed iteration (production wires the snapshot diff). */
  captureChangedFiles?: () => Promise<ChangedWorkspaceFile[]>;
  sessionContext?: string;
  workspaceKey?: string;
  chatSessionId?: string;
}

export class MissionRunner {
  private readonly evaluator: GoalEvaluator;

  constructor(
    private readonly executor: MissionExecutor,
    private readonly planner: MissionPlannerLike,
    private readonly costs: MissionBudgetStore,
    private readonly registry: MissionPersistence,
  ) {
    this.evaluator = new GoalEvaluator((system, user) => this.executor.summarizeText(system, user));
  }

  async run(config: MissionConfig, options: MissionRunOptions = {}): Promise<MissionResult> {
    const startMs = Date.now();
    const { signal, hooks = {} } = options;
    const onProgress = options.onProgress ?? (() => undefined);
    const confidenceThreshold = options.goalConfidenceThreshold ?? DEFAULT_MISSION_GOAL_CONFIDENCE;

    const iterations: MissionIterationResult[] = [];
    const createdCapabilities: MissionCapabilityRecord[] = [];
    let totalCostUsd = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let consecutiveNoProgress = 0;
    let lastVerdict: GoalVerdict | undefined;
    const crossedBudgetFractions = new Set<number>();
    // Recoverable setting blocks the user has already overridden this run, so we
    // do not re-prompt for the same setting if it somehow still appears blocked.
    const overriddenBlockers = new Set<string>();

    /**
     * When the loop would stop because progress is blocked by a recoverable
     * setting, ask the user (via the blockedGate hook) whether to override and
     * continue. Returns 'continue' only when the user opted to override.
     */
    const resolveSettingBlock = async (): Promise<'continue' | 'stop'> => {
      const last = iterations[iterations.length - 1];
      const blocker = last ? detectSettingBlocker(last.subTaskResults, last.synthesis) : undefined;
      if (!blocker || !hooks.blockedGate || overriddenBlockers.has(blocker.configKey)) {
        return 'stop';
      }
      onProgress({ type: 'blocked', index: last!.index, blocker });
      let resolution: MissionBlockResolution = 'stop';
      try {
        resolution = await hooks.blockedGate({ missionId: config.id, iterationIndex: last!.index, blocker });
      } catch {
        resolution = 'stop';
      }
      if (resolution === 'override-once') {
        overriddenBlockers.add(blocker.configKey);
        return 'continue';
      }
      return 'stop';
    };

    const record: MissionRunRecord = {
      id: config.id,
      goal: config.goal,
      workspaceKey: options.workspaceKey,
      chatSessionId: options.chatSessionId,
      status: 'running',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      config,
      iterations,
      achieved: false,
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalDurationMs: 0,
      createdCapabilities,
    };

    const persist = async (status: MissionStatus): Promise<void> => {
      record.status = status;
      record.iterations = iterations;
      record.createdCapabilities = createdCapabilities;
      record.totalCostUsd = totalCostUsd;
      record.totalInputTokens = totalInputTokens;
      record.totalOutputTokens = totalOutputTokens;
      record.totalDurationMs = Date.now() - startMs;
      try {
        await this.registry.save({ ...record });
      } catch {
        // Best-effort audit; never let persistence failure abort the mission.
      }
    };

    onProgress({ type: 'mission-start', config });
    await persist('running');

    const finish = async (stopReason: MissionStopReason, achieved: boolean): Promise<MissionResult> => {
      const finalSynthesis = await this.buildFinalSynthesis(config, iterations, stopReason, achieved);
      const status: MissionStatus = achieved
        ? 'completed'
        : stopReason === 'cancelled'
          ? 'cancelled'
          : stopReason === 'error'
            ? 'failed'
            : 'completed';
      record.stopReason = stopReason;
      record.achieved = achieved;
      await persist(status);
      const result: MissionResult = {
        id: config.id,
        goal: config.goal,
        iterations,
        stopReason,
        achieved,
        finalSynthesis,
        totalCostUsd,
        totalInputTokens,
        totalOutputTokens,
        totalDurationMs: Date.now() - startMs,
      };
      onProgress({ type: 'mission-stopped', result });
      return result;
    };

    for (let index = 1; ; index++) {
      // ── 1. Guardrail pre-checks (before doing any chargeable work) ──────────
      if (signal?.aborted) {
        return finish('cancelled', false);
      }
      if (index > config.budget.maxIterations) {
        return finish('max-iterations', false);
      }
      if (Date.now() - startMs >= config.budget.maxDurationMs) {
        return finish('time-exhausted', false);
      }
      if (totalCostUsd >= config.budget.maxCostUsd) {
        return finish('budget-exhausted', false);
      }
      if (totalInputTokens + totalOutputTokens >= config.budget.maxTokens) {
        return finish('token-exhausted', false);
      }
      if (consecutiveNoProgress >= config.budget.maxConsecutiveNoProgress) {
        if (await resolveSettingBlock() === 'continue') {
          consecutiveNoProgress = 0;
        } else {
          return finish('no-progress', false);
        }
      }
      const daily = this.costs.getDailyBudgetStatus(0);
      if (daily?.blocked) {
        return finish('budget-exhausted', false);
      }

      onProgress({
        type: 'budget-status',
        spentUsd: totalCostUsd,
        budgetUsd: config.budget.maxCostUsd,
        iterations: index - 1,
        maxIterations: config.budget.maxIterations,
      });

      // ── 2. Checkpoint gate (hybrid autonomy; deny-by-default) ───────────────
      const checkpointReason = computeCheckpointReason(index, totalCostUsd, config, crossedBudgetFractions);
      if (checkpointReason) {
        onProgress({
          type: 'checkpoint-required',
          index,
          reason: checkpointReason,
          spentUsd: totalCostUsd,
          budgetUsd: config.budget.maxCostUsd,
        });
        await persist('awaiting-checkpoint');
        let approved = false;
        if (hooks.checkpointGate) {
          try {
            approved = await hooks.checkpointGate({
              missionId: config.id,
              iterationIndex: index,
              reason: checkpointReason,
              spentUsd: totalCostUsd,
              budgetUsd: config.budget.maxCostUsd,
              spentTokens: totalInputTokens + totalOutputTokens,
              iterationsRun: index - 1,
            });
          } catch {
            approved = false;
          }
        }
        onProgress({ type: 'checkpoint-resolved', index, approved });
        if (!approved) {
          return finish('stopped-by-user', false);
        }
      }

      // ── 3. Plan the next increment ──────────────────────────────────────────
      const focus = lastVerdict?.nextFocus ?? '';
      onProgress({ type: 'iteration-start', index, maxIterations: config.budget.maxIterations, focus });
      const incrementGoal = buildIncrementGoal(config, lastVerdict, accumulatedSummary(iterations));
      let plan: ProjectPlan;
      try {
        plan = await this.planner.plan(incrementGoal, config.constraints, signal);
      } catch (err) {
        onProgress({ type: 'error', message: `Planning failed: ${errMsg(err)}` });
        return finish('error', false);
      }
      onProgress({ type: 'planned-increment', index, plan });

      // ── 4. Execute the increment ────────────────────────────────────────────
      onProgress({ type: 'executing', index });
      let projectResult: ProjectResult;
      try {
        projectResult = await this.executor.processProject(
          incrementGoal,
          config.constraints,
          undefined,
          { planOverride: plan, signal, sessionContext: options.sessionContext },
        );
      } catch (err) {
        if (signal?.aborted) {
          return finish('cancelled', false);
        }
        onProgress({ type: 'error', message: `Execution failed: ${errMsg(err)}` });
        return finish('error', false);
      }

      // ── 5. Accumulate ───────────────────────────────────────────────────────
      totalCostUsd += projectResult.totalCostUsd;
      totalInputTokens += projectResult.totalInputTokens;
      totalOutputTokens += projectResult.totalOutputTokens;

      let changedFiles: ChangedWorkspaceFile[] = [];
      if (options.captureChangedFiles) {
        try {
          changedFiles = await options.captureChangedFiles();
        } catch {
          changedFiles = [];
        }
      }
      const tddStatus = worstTddStatus(projectResult.subTaskResults);
      const verificationSummary = collectVerificationSummary(projectResult.subTaskResults);

      // ── 6. Evaluate progress (validated, untrusted output) ──────────────────
      const verdict = await this.evaluator.evaluate({
        goal: config.goal,
        successCriteria: config.successCriteria,
        iterationIndex: index,
        maxIterations: config.budget.maxIterations,
        latestSynthesis: projectResult.synthesis,
        accumulatedSummary: accumulatedSummary(iterations),
        changedFiles,
        verificationSummary,
        tddStatus,
      });
      onProgress({ type: 'evaluated', index, verdict });

      iterations.push({
        index,
        plan,
        synthesis: projectResult.synthesis,
        verdict,
        costUsd: projectResult.totalCostUsd,
        inputTokens: projectResult.totalInputTokens,
        outputTokens: projectResult.totalOutputTokens,
        durationMs: projectResult.totalDurationMs,
        changedFiles,
        createdCapabilities: [],
        subTaskResults: projectResult.subTaskResults,
      });
      await persist('running');

      // No-progress accounting.
      if (verdict.verdict === 'progressing' || verdict.verdict === 'achieved') {
        consecutiveNoProgress = 0;
      } else {
        consecutiveNoProgress += 1;
      }
      lastVerdict = verdict;

      // ── 7. Decide ───────────────────────────────────────────────────────────
      if (verdict.verdict === 'achieved' && verdict.confidence >= confidenceThreshold) {
        return finish('goal-achieved', true);
      }
      if (verdict.verdict === 'blocked') {
        // A recoverable setting block (e.g. terminal-write disabled) should ask
        // the user before cancelling, rather than silently stopping.
        if (await resolveSettingBlock() === 'continue') {
          consecutiveNoProgress = 0;
        } else {
          return finish('blocked', false);
        }
      }
      // Otherwise loop again — the guardrail pre-checks at the top enforce the envelope.
    }
  }

  private async buildFinalSynthesis(
    config: MissionConfig,
    iterations: MissionIterationResult[],
    stopReason: MissionStopReason,
    achieved: boolean,
  ): Promise<string> {
    const fallback = [
      `Mission ${achieved ? 'achieved' : 'stopped'} (${stopReason}) after ${iterations.length} iteration(s).`,
      ...iterations.map(it => `Iteration ${it.index} (${it.verdict.verdict}): ${it.synthesis.slice(0, 400)}`),
    ].join('\n\n');

    if (iterations.length === 0) {
      return fallback;
    }
    try {
      const system = [
        'You are summarising an autonomous development mission for a human reviewer.',
        'Write a concise report: what the goal was, what was actually accomplished, what remains, and why the loop stopped.',
        'Be factual and grounded only in the iteration notes provided. Do not invent results.',
      ].join(' ');
      const user = [
        `Goal: ${config.goal}`,
        `Outcome: ${achieved ? 'goal achieved' : `stopped (${stopReason})`}`,
        '',
        'Iteration notes:',
        ...iterations.map(it => `- Iteration ${it.index} [${it.verdict.verdict}, ${(it.verdict.confidence * 100).toFixed(0)}%]: ${it.synthesis.slice(0, 600)}`),
        '',
        'Write the final mission report.',
      ].join('\n');
      const summary = (await this.executor.summarizeText(system, user)).trim();
      return summary.length > 0 ? summary : fallback;
    } catch {
      return fallback;
    }
  }
}

// ── Recoverable setting-block detection ──────────────────────────

interface SettingBlockerRule {
  match: RegExp;
  blocker: MissionSettingBlocker;
}

/**
 * Signatures of recoverable setting restrictions, matched against an iteration's
 * tool results / output. Each maps to the setting the user can relax. The match
 * keys off the deterministic denial reason the tool-approval gate returns, so it
 * does not depend on the model's prose.
 */
const SETTING_BLOCKER_RULES: SettingBlockerRule[] = [
  {
    match: /allowterminalwrite|terminal write commands are disabled|managed terminal launches are disabled/i,
    blocker: {
      settingKey: 'atlasmind.allowTerminalWrite',
      configKey: 'allowTerminalWrite',
      overrideValue: true,
      settingsCommand: 'atlasmind.openSettingsSafety',
      title: 'Terminal commands are disabled',
      detail: 'The loop could not run tests or other terminal commands because "atlasmind.allowTerminalWrite" is off, so this increment could not be verified.',
    },
  },
];

/**
 * Detect whether an iteration was blocked by a recoverable AtlasMind setting.
 * Scans tool-result previews, subtask output/errors, and the iteration synthesis
 * for a known signature. Returns the matching blocker descriptor, or undefined.
 */
export function detectSettingBlocker(results: SubTaskResult[], synthesis?: string): MissionSettingBlocker | undefined {
  const haystack = [
    synthesis ?? '',
    ...results.map(r => r.output ?? ''),
    ...results.map(r => r.error ?? ''),
    ...results.flatMap(r => (r.artifacts?.toolCalls ?? []).map(t => t.resultPreview ?? '')),
  ].join('\n');
  if (!haystack.trim()) {
    return undefined;
  }
  for (const rule of SETTING_BLOCKER_RULES) {
    if (rule.match.test(haystack)) {
      return rule.blocker;
    }
  }
  return undefined;
}

// ── Pure helpers (exported for unit tests) ───────────────────────

/** Whether this iteration must pause for a human checkpoint, and why. */
export function computeCheckpointReason(
  iterationIndex: number,
  spentUsd: number,
  config: MissionConfig,
  crossedFractions: Set<number>,
): string | undefined {
  const policy = config.checkpointPolicy;

  // Budget-fraction triggers (first crossing only).
  const budget = config.budget.maxCostUsd;
  if (budget > 0 && policy.atBudgetFractions) {
    for (const fraction of policy.atBudgetFractions) {
      if (fraction > 0 && fraction <= 1 && !crossedFractions.has(fraction) && spentUsd >= budget * fraction) {
        crossedFractions.add(fraction);
        return `Cumulative spend has crossed ${(fraction * 100).toFixed(0)}% of the $${budget.toFixed(2)} budget.`;
      }
    }
  }

  // Iteration-cadence trigger (not on the very first iteration).
  const every = policy.everyNIterations ?? 0;
  if (every > 0 && iterationIndex > 1 && (iterationIndex - 1) % every === 0) {
    return `Scheduled checkpoint: ${iterationIndex - 1} iteration(s) completed (every ${every}).`;
  }

  return undefined;
}

/** Compose the increment goal handed to the planner — goal + guardrails + next focus + carry-forward. */
export function buildIncrementGoal(
  config: MissionConfig,
  lastVerdict: GoalVerdict | undefined,
  accumulated: string,
): string {
  const lines: string[] = [];
  lines.push(`Overall goal: ${config.goal}`);

  if (config.successCriteria && config.successCriteria.length > 0) {
    lines.push('', 'Definition of done:');
    for (const c of config.successCriteria) {
      lines.push(`- ${c}`);
    }
  }

  if (config.guardrails.instructions.length > 0 || (config.guardrails.protectedPaths?.length ?? 0) > 0) {
    lines.push('', 'Guardrails (hard constraints — respect these, they are not the task):');
    for (const g of config.guardrails.instructions) {
      lines.push(`- ${g}`);
    }
    if (config.guardrails.protectedPaths && config.guardrails.protectedPaths.length > 0) {
      lines.push(`- Do not modify these protected paths: ${config.guardrails.protectedPaths.join(', ')}.`);
    }
    lines.push('- Anything implying a staging/production deployment must be left to the guarded delivery pipeline — do not push or deploy directly.');
  }

  if (accumulated.trim()) {
    lines.push('', 'Work already completed in prior iterations:', accumulated.trim());
  }

  if (lastVerdict) {
    lines.push('', 'Latest progress evaluation:');
    if (lastVerdict.nextFocus) {
      lines.push(`- Focus next on: ${lastVerdict.nextFocus}`);
    }
    if (lastVerdict.remaining.length > 0) {
      lines.push('- Outstanding items:');
      for (const r of lastVerdict.remaining) {
        lines.push(`  - ${r}`);
      }
    }
  }

  lines.push(
    '',
    'Plan ONLY the next increment of work toward the goal: the smallest set of subtasks that makes meaningful, verifiable progress now. Prefer existing skills and agents; do not attempt the entire goal at once.',
  );
  return lines.join('\n');
}

/** A compact carry-forward summary of prior iteration syntheses. */
export function accumulatedSummary(iterations: MissionIterationResult[]): string {
  if (iterations.length === 0) {
    return '';
  }
  return iterations
    .map(it => `Iteration ${it.index} [${it.verdict.verdict}]: ${it.synthesis.slice(0, 500)}`)
    .join('\n');
}

/** Worst-case verification status across an iteration's subtasks (drives the achieved guard). */
export function worstTddStatus(
  results: SubTaskResult[],
): 'verified' | 'blocked' | 'missing' | 'not-applicable' | undefined {
  let sawVerified = false;
  let sawApplicableUnknown = false;
  for (const r of results) {
    const status = r.artifacts?.tddStatus;
    if (status === 'blocked') {
      return 'blocked';
    }
    if (status === 'missing') {
      return 'missing';
    }
    if (status === 'verified') {
      sawVerified = true;
    }
    if (status === undefined && (r.artifacts?.toolCallCount ?? 0) > 0) {
      sawApplicableUnknown = true;
    }
  }
  if (sawVerified) {
    return 'verified';
  }
  if (sawApplicableUnknown) {
    return undefined;
  }
  return 'not-applicable';
}

function collectVerificationSummary(results: SubTaskResult[]): string | undefined {
  const parts = results
    .map(r => r.artifacts?.verificationSummary)
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
  return parts.length > 0 ? parts.join('\n') : undefined;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
