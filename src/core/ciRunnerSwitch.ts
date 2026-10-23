/**
 * The one switch that turns a routing recommendation into where a job runs.
 *
 * `ciRoutingPolicy` decides where each kind of check *should* run, and says so
 * on a page. Nothing acted on it, so when the hosted allowance ran out a
 * repository's CI simply stopped: every job refused, nothing moved. This module
 * is the missing link, and it is deliberately small.
 *
 * The mechanism is a repository variable. A workflow opts in by writing its
 * `runs-on` as the expression from `buildRunsOnExpression`, which reads
 * `vars.ATLASMIND_CI_RUNNER` and falls back to the pinned hosted label when the
 * variable is absent. AtlasMind sets the variable to the local runner's label
 * when the allowance is gone and deletes it when the allowance is back. A
 * workflow that does not use the expression is never affected.
 *
 * Three rules.
 *
 * **Untrusted code never follows the switch.** The trust test lives in the
 * workflow expression itself, so it holds even if AtlasMind is not running: a
 * pull request whose head is in another repository always gets the hosted
 * label, whatever the variable says.
 *
 * **An unreadable meter changes nothing.** In `auto`, `unknown` leaves the
 * switch where it is. Flipping on a failed billing call would move work on a
 * permissions error; flipping back would send jobs straight into the refusal
 * that moved them.
 *
 * **Off means hands off.** The default mode never reads or writes the variable.
 *
 * Pure: the caller performs the `gh` requests. Unit-tested.
 */

import { readBillingRefusal, type CiCreditReading } from './ciCreditMeter.js';

/** The repository variable a switched workflow reads. */
export const CI_RUNNER_VARIABLE = 'ATLASMIND_CI_RUNNER';

/** What a workflow must contain to follow the switch. */
export const CI_RUNNER_VARIABLE_REFERENCE = `vars.${CI_RUNNER_VARIABLE}`;

export type CiRunnerSwitchMode = 'off' | 'auto' | 'hosted' | 'local';

export const CI_RUNNER_SWITCH_MODES: readonly CiRunnerSwitchMode[] = ['off', 'auto', 'hosted', 'local'];

export type CiRunnerTarget = 'hosted' | 'local';

export interface CiRunnerSwitchDecision {
  /** Where the switch should point, or `undefined` to leave it alone. */
  target: CiRunnerTarget | undefined;
  /** One plain sentence saying why. */
  reason: string;
}

/** Runner labels are short tokens; anything else is refused, never quoted. */
const RUNNER_LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function isValidRunnerLabel(label: unknown): label is string {
  return typeof label === 'string' && RUNNER_LABEL.test(label);
}

export function sanitizeRunnerSwitchMode(value: unknown): CiRunnerSwitchMode {
  return CI_RUNNER_SWITCH_MODES.includes(value as CiRunnerSwitchMode) ? value as CiRunnerSwitchMode : 'off';
}

/**
 * Decide where the switch should point. The caller compares the target with
 * the variable it read and writes only when they differ.
 */
export function decideCiRunnerTarget(input: {
  mode: CiRunnerSwitchMode;
  credit: CiCreditReading;
  localRunnerLabel: string | undefined;
}): CiRunnerSwitchDecision {
  const label = isValidRunnerLabel(input.localRunnerLabel) ? input.localRunnerLabel : undefined;
  switch (input.mode) {
    case 'off':
      return { target: undefined, reason: 'The switch is off, so AtlasMind leaves the repository variable alone.' };
    case 'hosted':
      return { target: 'hosted', reason: 'Set to always use GitHub-hosted runners.' };
    case 'local':
      return label
        ? { target: 'local', reason: `Set to always use the local runner (${label}).` }
        : { target: undefined, reason: 'Set to always use the local runner, but no valid local runner label is configured.' };
    case 'auto':
    default:
      if (input.credit.state === 'exhausted') {
        return label
          ? { target: 'local', reason: `The hosted allowance is used up, so jobs go to the local runner (${label}).` }
          : { target: undefined, reason: 'The hosted allowance is used up, but no valid local runner label is configured to fall over to.' };
      }
      if (input.credit.state === 'remaining') {
        return { target: 'hosted', reason: 'The hosted allowance has headroom, so jobs use GitHub-hosted runners.' };
      }
      return {
        target: undefined,
        reason: 'The hosted allowance could not be read, so the switch stays where it is.',
      };
  }
}

/** The variable value for a target: the label for local, absent for hosted. */
export function runnerVariableValue(target: CiRunnerTarget, localRunnerLabel: string): string | undefined {
  if (target === 'hosted') {
    return undefined;
  }
  if (!isValidRunnerLabel(localRunnerLabel)) {
    throw new Error('The local runner label is not a valid runner label.');
  }
  return localRunnerLabel;
}

/** Which target a variable value means today. */
export function targetOfRunnerVariable(value: string | undefined): CiRunnerTarget {
  return value && value.trim() ? 'local' : 'hosted';
}

/** One sentence for the page, describing what jobs will do right now. */
export function describeRunnerVariable(value: string | undefined): string {
  return value && value.trim()
    ? `Switched workflows run on the local runner (${value.trim()}).`
    : 'Switched workflows run on GitHub-hosted runners.';
}

/**
 * The `runs-on` value a workflow uses to follow the switch.
 *
 * Only pushes, manual dispatches, schedules and pull requests from this same
 * repository may follow the variable, and never a run a bot started:
 * Dependabot's pull requests live in the same repository but carry freshly
 * downloaded third-party code, which is exactly what a workstation should not
 * run. Everything else gets the hosted label.
 */
export function buildRunsOnExpression(hostedLabel: string): string {
  if (!isValidRunnerLabel(hostedLabel)) {
    throw new Error('The hosted runner label is not a valid runner label.');
  }
  return '${{ !endsWith(github.actor, \'[bot]\')'
    + ' && (github.event_name == \'push\' || github.event_name == \'workflow_dispatch\''
    + ' || github.event_name == \'schedule\''
    + ' || github.event.pull_request.head.repo.full_name == github.repository)'
    + ` && ${CI_RUNNER_VARIABLE_REFERENCE} || '${hostedLabel}' }}`;
}

/** Whether a workflow file opts in to the switch. */
export function workflowFollowsRunnerSwitch(contents: string): boolean {
  return String(contents ?? '').includes(CI_RUNNER_VARIABLE_REFERENCE);
}

/**
 * Read GitHub's annotations on a failed job for a billing refusal.
 *
 * GitHub reports "the job was not started because ... your spending limit"
 * as a job annotation, not as a billing API response. Only failure-level
 * annotations are read, and the phrase match is the meter's own narrow list.
 */
export function findBillingRefusal(annotations: unknown): CiCreditReading | undefined {
  if (!Array.isArray(annotations)) {
    return undefined;
  }
  for (const entry of annotations) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const record = entry as { annotation_level?: unknown; message?: unknown };
    if (record.annotation_level !== undefined && record.annotation_level !== 'failure') {
      continue;
    }
    const text = typeof record.message === 'string' ? record.message : '';
    if (!/not (been )?started|was not started|could not be started/i.test(text)) {
      continue;
    }
    const reading = readBillingRefusal(text);
    if (reading) {
      return reading;
    }
  }
  return undefined;
}
