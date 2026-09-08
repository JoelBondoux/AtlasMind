/**
 * What a routine will actually run, decided before anything is sent to a shell.
 *
 * `routineVariables.ts` answers *may this value be substituted*. This answers
 * the question after it: **given those values, what is the exact command list,
 * and is it fit to show somebody before they agree to it?**
 *
 * Three things were true of the routine path before this existed, all verified
 * against the source rather than assumed:
 *
 * - **Nothing previewed the commands.** `/ship` printed a routine's name and
 *   description and then ran it; the Run Center's Run button posted a routine
 *   id from a webview and the host executed it. `promotionRunner` — the other
 *   place AtlasMind runs user-authored commands — has an authorization gate
 *   with a type-to-confirm, and the contrast is the argument.
 * - **An unresolved placeholder became an empty string.** `vars[name] ?? ''`,
 *   and the Run Center passed `vars: {}` unconditionally, so every placeholder
 *   in a panel-run routine resolved to nothing. `npm publish --tag ${channel}`
 *   is a different command from `npm publish --tag`, and a missing value should
 *   not be able to choose which one runs.
 * - **A routine template is only "reviewed" by convention.** `file-write` is
 *   graded `workspace-write`/high and refuses paths outside the workspace;
 *   `project_memory/routines/` is inside it and is a declared SSOT folder. So a
 *   model that is allowed to write a file is allowed to write a routine, and
 *   the value checker deliberately validates values and never the template.
 *   That cannot be closed by validating harder — a routine is a shell script by
 *   design — so it is closed by **showing the commands to a person**, which is
 *   the same answer `registerHandoff` gives: you cannot show somebody what is
 *   composed after they agree.
 *
 * **This does not extend `allowTerminalWrite` to routines, deliberately.** That
 * setting gates *a model* deciding to run a command. A routine is a script
 * somebody wrote and then explicitly invoked, which is a different
 * authorization; applying that ceiling here would refuse every routine at the
 * default setting and conflate two things the product keeps apart on purpose.
 * The gate a human-authored script deserves is *see it first*.
 *
 * Pure. Nothing here executes, and `planRoutineExecution` returning `ready` is
 * not permission — it is a proposal for a caller to confirm.
 */

import type { RoutineDefinition, RoutineStep } from '../types.js';
import { checkRoutineVariables } from './routineVariables.js';
import { classifyDeliveryCommandReach, type DeliveryCommandReach } from './deliveryRunPlan.js';

/** Matches the substitution `routineRunner` performs, and must stay in step with it. */
const PLACEHOLDER = /\$\{([^}]+)\}/g;

export type RoutineRefusalRule =
  | 'no-steps'
  | 'empty-command'
  | 'unsafe-value'
  | 'unresolved-placeholder';

/**
 * The declared rules, published with every plan.
 *
 * Carried in the payload rather than restated by each surface, so a
 * confirmation dialog explains the rule that actually refused rather than a
 * copy of it that has drifted.
 */
export const ROUTINE_EXECUTION_RULES: ReadonlyArray<{ id: RoutineRefusalRule; description: string }> = [
  { id: 'no-steps', description: 'A routine with no steps has nothing to run.' },
  { id: 'empty-command', description: 'A step whose command is blank would run nothing and report success.' },
  {
    id: 'unsafe-value',
    description: 'A substituted value contains characters a shell reads as syntax rather than text.',
  },
  {
    id: 'unresolved-placeholder',
    description: 'A placeholder in the command has no value. An absent value is not an empty one.',
  },
];

export interface RoutinePlannedStep {
  stepId: string;
  label: string;
  /** Exactly what a shell will receive, fully substituted. */
  command: string;
  /** Whether this command's effect leaves the machine. */
  reach: DeliveryCommandReach;
  onFail: RoutineStep['on_fail'];
}

export interface RoutineExecutionRefusal {
  rule: RoutineRefusalRule;
  /** Which step, when the refusal is about one. */
  stepId?: string;
  detail: string;
}

interface RoutinePlanBase {
  routineId: string;
  routineName: string;
}

export type RoutineExecutionPlan =
  | (RoutinePlanBase & {
    status: 'ready';
    steps: RoutinePlannedStep[];
    /** Steps whose effect leaves this machine. Always a subset of `steps`. */
    outward: RoutinePlannedStep[];
  })
  | (RoutinePlanBase & {
    status: 'refused';
    refusals: RoutineExecutionRefusal[];
  });

/** Every `${name}` a template references, in first-seen order, de-duplicated. */
export function routinePlaceholders(template: string): string[] {
  const found: string[] = [];
  for (const match of String(template ?? '').matchAll(PLACEHOLDER)) {
    const name = (match[1] ?? '').trim();
    if (name && !found.includes(name)) {
      found.push(name);
    }
  }
  return found;
}

/**
 * Placeholders the supplied values do not answer.
 *
 * An empty string counts as **absent**, not as an answer. Somebody passing
 * `{ message: '' }` and somebody passing nothing at all want the same thing
 * from a command line, and treating the first as a decision would let a blank
 * field through the check that exists to catch the second.
 */
export function unresolvedRoutinePlaceholders(
  template: string,
  vars: Record<string, string>,
): string[] {
  return routinePlaceholders(template)
    .filter(name => String(vars[name] ?? '').length === 0);
}

/** Substitute values into a template. Only ever called on a template whose placeholders resolve. */
function substitute(template: string, vars: Record<string, string>): string {
  return String(template ?? '').replace(PLACEHOLDER, (_, name: string) => vars[String(name).trim()] ?? '');
}

/**
 * Turn a routine plus its values into the exact commands that would run.
 *
 * Refusals are **collected, not first-wins**: a routine missing three values
 * should say so once rather than over three attempts. The one thing that short-
 * circuits is an unsafe value, because `checkRoutineVariables` has already
 * decided the whole run is refused and substituting anyway to look for further
 * problems would mean building the command it just refused to build.
 */
export function planRoutineExecution(
  routine: RoutineDefinition,
  vars: Record<string, string>,
): RoutineExecutionPlan {
  const base: RoutinePlanBase = { routineId: routine.id, routineName: routine.name };
  const steps = Array.isArray(routine.steps) ? routine.steps : [];

  if (steps.length === 0) {
    return {
      ...base,
      status: 'refused',
      refusals: [{ rule: 'no-steps', detail: 'This routine defines no steps.' }],
    };
  }

  const valueCheck = checkRoutineVariables(vars);
  if (!valueCheck.ok) {
    return {
      ...base,
      status: 'refused',
      refusals: valueCheck.refusals.map(refusal => ({
        rule: 'unsafe-value' as const,
        detail: refusal.reason,
      })),
    };
  }

  const refusals: RoutineExecutionRefusal[] = [];
  const planned: RoutinePlannedStep[] = [];

  for (const step of steps) {
    const template = String(step.run ?? '');
    const missing = unresolvedRoutinePlaceholders(template, vars);
    if (missing.length > 0) {
      refusals.push({
        rule: 'unresolved-placeholder',
        stepId: step.id,
        detail: `\`${step.label || step.id}\` needs ${missing.map(name => `\`${name}\``).join(', ')}, `
          + 'which no value was supplied for. AtlasMind will not run a command with a blank where a value should be.',
      });
      continue;
    }

    const command = substitute(template, vars).trim();
    if (!command) {
      refusals.push({
        rule: 'empty-command',
        stepId: step.id,
        detail: `\`${step.label || step.id}\` has no command to run.`,
      });
      continue;
    }

    planned.push({
      stepId: step.id,
      label: step.label,
      command,
      reach: classifyDeliveryCommandReach(command),
      onFail: step.on_fail,
    });
  }

  if (refusals.length > 0) {
    return { ...base, status: 'refused', refusals };
  }

  return {
    ...base,
    status: 'ready',
    steps: planned,
    outward: planned.filter(step => step.reach === 'outward'),
  };
}

/**
 * The confirmation body: every command, in order, and what leaves the machine.
 *
 * Built here rather than at each call site so `/ship` and the Run Center cannot
 * describe the same run differently — and so the text a person agrees to is
 * derived from the same value the runner executes.
 */
export function describeRoutinePlan(plan: RoutineExecutionPlan): string {
  if (plan.status === 'refused') {
    return plan.refusals.map(refusal => refusal.detail).join('\n\n');
  }

  const lines = plan.steps.map((step, index) => `${index + 1}. ${step.command}`);

  if (plan.outward.length > 0) {
    lines.push(
      '',
      plan.outward.length === plan.steps.length
        ? 'Every command above reaches outside this machine.'
        : `${plan.outward.length} of these reach outside this machine: `
          + plan.outward.map(step => step.command).join(', '),
    );
  }

  return lines.join('\n');
}
