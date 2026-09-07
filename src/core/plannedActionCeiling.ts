/**
 * Whether a planned run would act beyond what its stages permit.
 *
 * An autonomous plan was generated whose subtasks included "Version bump and
 * changelog", "Commit the Stage 1/2 hardening work" and "Push to origin/develop"
 * — against a workflow file declaring Release and Automation policy at `observe`
 * and Local development at `propose`. Every one of those levels was already
 * recorded, already resolved, and already respected everywhere a *person* asked
 * for the same action in chat. The planner never consulted them. The only gate
 * that fired was the estimated file count, which is a proxy for blast radius and
 * says nothing about authority: a two-file plan that pushes to a protected
 * branch clears it, and a forty-file plan that only reads does not.
 *
 * Four rules.
 *
 * **The stage rules are read, never restated.** Detection reuses
 * `detectGovernedAction` and the stage it belongs to, and the caller passes the
 * *already-resolved* effective level for each stage. Re-deriving
 * `min(master, ceiling, capability, stage)` here would be a second copy of the
 * one rule this module exists to enforce, and the first symptom of drift would
 * be a plan refused in chat and permitted by the planner.
 *
 * **An undeclared workflow says nothing.** No config means no rules to be
 * outside of, and warning would invent a process the project never adopted —
 * the rule `buildWorkflowChatNotice` already states about its own silence. A
 * stage the file does not carry is treated the same way: a stage nobody enabled
 * has no expectations.
 *
 * **An unattended run needs the top rung.** A subtask executes without anybody
 * watching, so it needs `auto`; the same action offered to a person for approval
 * needs only `propose`. Collapsing the two would let an `observe` stage pass a
 * plan that pushes on its own, which is the case that prompted this.
 *
 * **This adds a reason to stop and never removes one.** A missed classification
 * costs emphasis, never a gate — the direction `deliveryRunPlan` chose for the
 * same kind of word-matching. Nothing here blocks, and nothing here approves.
 */

import { permits, type AutomationLevel } from './workflowAutomation.js';
import {
  detectGovernedAction,
  stageForGovernedAction,
  type WorkflowGovernedAction,
} from './workflowChatGuard.js';

/** A planned unit of work, as this question needs it. */
export interface PlannedActionSubtask {
  id: string;
  title: string;
}

/** One subtask that would act beyond its stage's declared level. */
export interface PlannedActionBreach {
  subTaskId: string;
  title: string;
  action: WorkflowGovernedAction;
  stageId: string;
  /** The effective level the caller resolved for that stage. */
  stageLevel: AutomationLevel;
  /** The level this run would need to take the action. */
  required: AutomationLevel;
}

export interface PlannedActionCeilingReport {
  /** False when no workflow is declared — the whole report is then silent. */
  declared: boolean;
  breaches: PlannedActionBreach[];
  /** Subtasks whose title implied a governed action, breach or not. */
  governedCount: number;
}

export interface PlannedActionCeilingInput {
  subTasks: readonly PlannedActionSubtask[];
  /**
   * Effective level per stage id, already resolved through every gate.
   *
   * `undefined` means no workflow is declared. A stage absent from a declared
   * map is a stage the file does not carry, which has no expectations.
   */
  stageLevels: Readonly<Record<string, AutomationLevel>> | undefined;
  /** True when subtasks execute without a per-action human decision. */
  unattended: boolean;
}

/**
 * The rung a run needs before it may take a governed action.
 *
 * `auto` unattended, `propose` otherwise. Exported so a test can assert the
 * distinction rather than infer it from a message.
 */
export function requiredLevelForRun(unattended: boolean): AutomationLevel {
  return unattended ? 'auto' : 'propose';
}

/** Which subtasks would act beyond their stage's declared level. */
export function assessPlannedActionCeilings(
  input: PlannedActionCeilingInput,
): PlannedActionCeilingReport {
  if (input.stageLevels === undefined) {
    return { declared: false, breaches: [], governedCount: 0 };
  }

  const required = requiredLevelForRun(input.unattended);
  const breaches: PlannedActionBreach[] = [];
  let governedCount = 0;

  for (const subTask of input.subTasks) {
    const action = detectGovernedAction(subTask.title);
    if (action === undefined) {
      continue;
    }
    governedCount += 1;
    const stageId = stageForGovernedAction(action);
    const stageLevel = input.stageLevels[stageId];
    // A stage the declared file does not carry has no expectations to be
    // outside of. Treating absence as a refusal would invent a rule; treating
    // it as permission would invent a grant. It is neither, so it is skipped.
    if (stageLevel === undefined) {
      continue;
    }
    if (!permits(stageLevel, required)) {
      breaches.push({
        subTaskId: subTask.id,
        title: subTask.title,
        action,
        stageId,
        stageLevel,
        required,
      });
    }
  }

  return { declared: true, breaches, governedCount };
}

/**
 * One approval reason, or nothing.
 *
 * Names the stage and the level for every breach rather than counting them: the
 * operator's next move is to raise a specific stage or drop a specific subtask,
 * and neither is possible from a number.
 */
export function describePlannedActionCeilings(
  report: PlannedActionCeilingReport,
): string | undefined {
  if (!report.declared || report.breaches.length === 0) {
    return undefined;
  }
  const lines = report.breaches.map(breach =>
    `**${breach.title}** would ${breach.action} at the *${breach.stageId}* stage, `
    + `which this project declares as \`${breach.stageLevel}\` (this run needs \`${breach.required}\`)`);
  const subject = report.breaches.length === 1 ? 'subtask goes' : 'subtasks go';
  return `${report.breaches.length} ${subject} beyond the automation level this project declares `
    + `for the stage that owns the action:\n\n`
    + lines.map(line => `  - ${line}`).join('\n')
    + '\n\n  Raise the stage in the Workflow page if that is intended, or drop those subtasks from the goal.';
}
