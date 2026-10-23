import { describe, expect, it } from 'vitest';
import {
  CI_RUNNER_VARIABLE,
  buildRunsOnExpression,
  decideCiRunnerTarget,
  describeRunnerVariable,
  findBillingRefusal,
  isValidRunnerLabel,
  runnerVariableValue,
  sanitizeRunnerSwitchMode,
  targetOfRunnerVariable,
  workflowFollowsRunnerSwitch,
} from '../../src/core/ciRunnerSwitch.ts';
import type { CiCreditReading } from '../../src/core/ciCreditMeter.ts';

const exhausted: CiCreditReading = { state: 'exhausted', basis: 'observed-refusal', detail: 'refused' };
const remaining: CiCreditReading = { state: 'remaining', basis: 'billing-api', includedMinutes: 2000, usedMinutes: 10 };
const unknown: CiCreditReading = { state: 'unknown', reason: 'no scope' };

describe('CI runner switch decision', () => {
  it('leaves the variable alone when off, whatever the meter says', () => {
    for (const credit of [exhausted, remaining, unknown]) {
      expect(decideCiRunnerTarget({ mode: 'off', credit, localRunnerLabel: 'hireline-local' }).target).toBeUndefined();
    }
  });

  it('falls over to the local runner only when the allowance is used up', () => {
    expect(decideCiRunnerTarget({ mode: 'auto', credit: exhausted, localRunnerLabel: 'hireline-local' }).target).toBe('local');
    expect(decideCiRunnerTarget({ mode: 'auto', credit: remaining, localRunnerLabel: 'hireline-local' }).target).toBe('hosted');
  });

  it('does not move on an unreadable meter', () => {
    const decision = decideCiRunnerTarget({ mode: 'auto', credit: unknown, localRunnerLabel: 'hireline-local' });
    expect(decision.target).toBeUndefined();
    expect(decision.reason).toMatch(/could not be read/);
  });

  it('refuses to fall over without a valid local label', () => {
    expect(decideCiRunnerTarget({ mode: 'auto', credit: exhausted, localRunnerLabel: undefined }).target).toBeUndefined();
    expect(decideCiRunnerTarget({ mode: 'local', credit: remaining, localRunnerLabel: 'bad label; rm' }).target).toBeUndefined();
  });

  it('honours the manual modes', () => {
    expect(decideCiRunnerTarget({ mode: 'hosted', credit: exhausted, localRunnerLabel: 'x' }).target).toBe('hosted');
    expect(decideCiRunnerTarget({ mode: 'local', credit: remaining, localRunnerLabel: 'x' }).target).toBe('local');
  });

  it('treats an unrecognised mode as off', () => {
    expect(sanitizeRunnerSwitchMode('sometimes')).toBe('off');
    expect(sanitizeRunnerSwitchMode('auto')).toBe('auto');
  });
});

describe('CI runner variable', () => {
  it('is absent for hosted and the label for local', () => {
    expect(runnerVariableValue('hosted', 'hireline-local')).toBeUndefined();
    expect(runnerVariableValue('local', 'hireline-local')).toBe('hireline-local');
    expect(() => runnerVariableValue('local', '$(whoami)')).toThrow();
  });

  it('reads an empty or missing value as hosted', () => {
    expect(targetOfRunnerVariable(undefined)).toBe('hosted');
    expect(targetOfRunnerVariable('  ')).toBe('hosted');
    expect(targetOfRunnerVariable('hireline-local')).toBe('local');
    expect(describeRunnerVariable('hireline-local')).toMatch(/local runner/);
  });

  it('accepts only plain runner labels', () => {
    expect(isValidRunnerLabel('ubuntu-24.04')).toBe(true);
    expect(isValidRunnerLabel('atlasmind_trusted-linux-x64')).toBe(true);
    expect(isValidRunnerLabel("x' || 'y")).toBe(false);
    expect(isValidRunnerLabel('')).toBe(false);
  });
});

describe('runs-on expression', () => {
  const expression = buildRunsOnExpression('ubuntu-24.04');

  it('reads the variable and falls back to the pinned hosted label', () => {
    expect(expression).toContain(`vars.${CI_RUNNER_VARIABLE}`);
    expect(expression).toContain("|| 'ubuntu-24.04' }}");
    expect(workflowFollowsRunnerSwitch(`runs-on: ${expression}`)).toBe(true);
    expect(workflowFollowsRunnerSwitch('runs-on: ubuntu-24.04')).toBe(false);
  });

  it('only lets same-repository events follow the switch', () => {
    expect(expression).toContain('github.event.pull_request.head.repo.full_name == github.repository');
    expect(expression).not.toContain('pull_request_target');
  });

  it('never sends a bot-started run to the local runner', () => {
    expect(expression.startsWith("${{ !endsWith(github.actor, '[bot]') && (")).toBe(true);
  });

  it('refuses a hosted label that could break out of the expression', () => {
    expect(() => buildRunsOnExpression("ubuntu' || 'evil")).toThrow();
  });
});

describe('billing refusal from job annotations', () => {
  it('recognises GitHub\'s not-started spending-limit annotation', () => {
    const reading = findBillingRefusal([{
      annotation_level: 'failure',
      message: 'The job was not started because recent account payments have failed or your spending limit needs to be increased.',
    }]);
    expect(reading?.state).toBe('exhausted');
  });

  it('ignores ordinary failures that merely mention billing', () => {
    expect(findBillingRefusal([{ annotation_level: 'failure', message: 'Test "billing totals" failed' }])).toBeUndefined();
    expect(findBillingRefusal([{ annotation_level: 'warning', message: 'The job was not started: spending limit' }])).toBeUndefined();
    expect(findBillingRefusal('not an array')).toBeUndefined();
  });
});
