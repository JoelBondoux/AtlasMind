import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  DEPENDENCY_CHECK_ROUTINE_FILE,
  DEPENDENCY_CHECK_ROUTINE_TEMPLATE,
  UNATTENDED_STEP_RULES,
  classifyUnattendedStep,
  describeScheduledRunReport,
  describeUnattendedApproval,
  planUnattendedRun,
  scheduledRunBranchName,
  toUnattendedExecutionPlan,
} from '../../src/core/scheduledRoutinePolicy.ts';
import { planRoutineExecution } from '../../src/core/routineExecutionPolicy.ts';
import { RoutineRegistry } from '../../src/core/routineRegistry.ts';
import { parseRoutineSchedule } from '../../src/core/routineSchedule.ts';
import type { RoutineDefinition } from '../../src/types.ts';

function ready(routine: RoutineDefinition) {
  const plan = planRoutineExecution(routine, {});
  if (plan.status !== 'ready') {
    throw new Error('expected a ready plan');
  }
  return plan;
}

const step = (id: string, run: string, on_fail: 'abort' | 'prompt' | 'continue' = 'abort') => ({ id, label: id, run, on_fail });

describe('an unattended run stops at propose', () => {
  it.each([
    ['git push origin main', 'leaves-the-machine'],
    ['npm publish', 'leaves-the-machine'],
    ['npm run deploy', 'leaves-the-machine'],
    ['gh pr create --fill', 'leaves-the-machine'],
    ['vsce publish', 'leaves-the-machine'],
    ['git commit -am "nightly"', 'changes-history'],
    ['git -C sub merge feature', 'changes-history'],
    ['git checkout main', 'changes-history'],
    ['git tag v1.0.0', 'changes-history'],
    ['gh issue comment 4 --body hi', 'changes-history'],
    ['npm version patch', 'changes-history'],
    ['npm update', 'installs-packages'],
    ['npm ci', 'installs-packages'],
    ['pnpm install --frozen-lockfile', 'installs-packages'],
    ['npx some-tool', 'installs-packages'],
    ['yarn', 'installs-packages'],
    ['pip install -r requirements.txt', 'installs-packages'],
    ['cargo update', 'installs-packages'],
    ['npm audit fix', 'installs-packages'],
  ])('refuses %j (%s)', (command, rule) => {
    expect(classifyUnattendedStep(command)?.id).toBe(rule);
  });

  it.each(['npm outdated', 'npm test', 'npm run lint', 'git status', 'git diff --stat', 'node scripts/report.js'])(
    'lets %j run',
    command => {
      expect(classifyUnattendedStep(command)).toBeUndefined();
    },
  );

  it('catches a refused verb chained behind a harmless one', () => {
    expect(classifyUnattendedStep('npm test && git push')?.id).toBe('leaves-the-machine');
    expect(classifyUnattendedStep('npm outdated; npm install')?.id).toBe('installs-packages');
  });

  it('publishes a description for every rule, which is what a report quotes', () => {
    expect(UNATTENDED_STEP_RULES.map(rule => rule.id)).toEqual(['leaves-the-machine', 'changes-history', 'installs-packages']);
    for (const rule of UNATTENDED_STEP_RULES) {
      expect(rule.description.length).toBeGreaterThan(40);
    }
  });
});

describe('the run stops at the first step it may not take', () => {
  const routine: RoutineDefinition = {
    id: 'deps',
    name: 'Deps',
    description: '',
    steps: [step('outdated', 'npm outdated', 'continue'), step('lint', 'npm run lint', 'prompt'), step('update', 'npm update'), step('test', 'npm test')],
  };

  it('runs the prefix and lists the rest as not run, with the rule', () => {
    const unattended = planUnattendedRun(ready(routine));
    expect(unattended.runnable.map(entry => entry.stepId)).toEqual(['outdated', 'lint']);
    expect(unattended.stoppedAt?.step.stepId).toBe('update');
    expect(unattended.stoppedAt?.rule.id).toBe('installs-packages');
    // Not "skip and carry on": the test after an update that never happened
    // would report on a state nobody asked about.
    expect(unattended.notRun.map(entry => entry.stepId)).toEqual(['update', 'test']);
    expect(unattended.wouldHaveAsked.map(entry => entry.stepId)).toEqual(['lint']);
  });

  it('never lets a refused step into the plan the runner executes', () => {
    const commands = fc.constantFrom('npm test', 'npm outdated', 'git push', 'npm install', 'git commit -m x', 'npm publish', 'node a.js');
    fc.assert(fc.property(fc.array(commands, { minLength: 1, maxLength: 8 }), runs => {
      const plan = ready({ id: 'p', name: 'P', description: '', steps: runs.map((run, index) => step(`s${index}`, run)) });
      const executed = toUnattendedExecutionPlan(plan, planUnattendedRun(plan));
      return executed.outward.length === 0
        && executed.steps.every(entry => classifyUnattendedStep(entry.command) === undefined)
        // A prefix, in order: nothing after a refusal slips through.
        && executed.steps.every((entry, index) => entry.stepId === plan.steps[index]!.stepId);
    }));
  });

  it('runs everything when nothing needs a person', () => {
    const unattended = planUnattendedRun(ready({ ...routine, steps: [step('t', 'npm test')] }));
    expect(unattended.stoppedAt).toBeUndefined();
    expect(unattended.notRun).toEqual([]);
  });
});

describe('a scheduled run reports back on a branch of its own', () => {
  const now = new Date(2026, 9, 8, 2, 0);

  it('names it chore/scheduled-<routine>-<date>', () => {
    expect(scheduledRunBranchName('dependency-check', now, [])).toEqual({ ok: true, name: 'chore/scheduled-dependency-check-2026-10-08' });
  });

  it('takes an ordinal for a second run the same day, never a timestamp', () => {
    expect(scheduledRunBranchName('dependency-check', now, ['chore/scheduled-dependency-check-2026-10-08']))
      .toEqual({ ok: true, name: 'chore/scheduled-dependency-check-2026-10-08-2' });
  });

  it('keeps the date when the routine id is long', () => {
    const result = scheduledRunBranchName('a-really-quite-unreasonably-long-routine-identifier-for-testing', now, []);
    expect(result.ok && result.name).toMatch(/2026-10-08$/);
  });

  it('refuses an id with nothing usable in a branch name', () => {
    expect(scheduledRunBranchName('日本語', now, []).ok).toBe(false);
  });

  it('only ever produces a valid, unprotected chore/scheduled- ref', () => {
    fc.assert(fc.property(fc.string({ maxLength: 60 }), id => {
      const result = scheduledRunBranchName(id, now, []);
      return !result.ok || /^chore\/scheduled-[a-z0-9-]+$/.test(result.name);
    }));
  });
});

describe('what a person agrees to, and what they are told afterwards', () => {
  const routine: RoutineDefinition = {
    id: 'deps',
    name: 'Deps',
    description: '',
    steps: [step('outdated', 'npm outdated', 'continue'), step('update', 'npm update'), step('test', 'npm test')],
  };

  it('shows what runs unattended, where it stops and why, and that it is ambient', () => {
    const text = describeUnattendedApproval(routine, 'Every day at 02:00 (local time)', planRoutineExecution(routine, {}));
    expect(text).toContain('only while the editor is open');
    expect(text).toContain('1. npm outdated');
    expect(text).toContain('Will stop before `npm update`');
    expect(text).toContain('npm update, npm test');
    expect(text).toMatch(/never pushes, merges or opens a pull request/);
    expect(text).toMatch(/withdraws this approval/);
  });

  it('refuses to describe as approvable a routine that needs a value nobody will give', () => {
    const needsMessage: RoutineDefinition = { ...routine, steps: [step('c', 'echo ${message}')] };
    const text = describeUnattendedApproval(needsMessage, 'x', planRoutineExecution(needsMessage, {}));
    expect(text).toMatch(/cannot run unattended/);
  });

  it('says where the work is and that merging it is your decision', () => {
    const text = describeScheduledRunReport({
      routineName: 'Deps',
      outcome: 'completed',
      branch: 'chore/scheduled-deps-2026-10-08',
      worktreePath: '/repo/.git/atlasmind-worktrees/x',
    });
    expect(text).toContain('chore/scheduled-deps-2026-10-08');
    expect(text).toMatch(/merging them is your decision/);
    expect(describeScheduledRunReport({ routineName: 'Deps', outcome: 'completed' })).toMatch(/worktree was removed/);
    expect(describeScheduledRunReport({ routineName: 'Deps', outcome: 'failed', failedStep: 'Tests' })).toMatch(/failed at "Tests"/);
    expect(describeScheduledRunReport({ routineName: 'Deps', outcome: 'refused', refusedReason: 'no worktree.' })).toMatch(/did not start: no worktree/);
    expect(describeScheduledRunReport({
      routineName: 'Deps',
      outcome: 'needs-a-person',
      stoppedAt: { command: 'npm update', rule: UNATTENDED_STEP_RULES[2]! },
    })).toMatch(/stopped before `npm update`, which needs you/);
  });
});

describe('the built-in nightly dependency check', () => {
  it('parses as a routine with a readable schedule, and stops unattended at the install', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'atlas-routine-'));
    try {
      const folder = path.join(root, 'project_memory', 'routines');
      await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, DEPENDENCY_CHECK_ROUTINE_FILE), DEPENDENCY_CHECK_ROUTINE_TEMPLATE, 'utf8');
      const registry = new RoutineRegistry();
      await registry.reload(root);
      const routine = registry.get('dependency-check');
      expect(routine).toBeDefined();
      expect(routine!.schedule).toBe('daily at 02:00');
      expect(parseRoutineSchedule(routine!.schedule).ok).toBe(true);
      expect(routine!.steps.map(entry => entry.run)).toEqual(['npm outdated', 'npm update', 'npm test']);

      const unattended = planUnattendedRun(ready(routine!));
      // Honest about its own limit: it lists what is outdated, then waits for you.
      expect(unattended.runnable.map(entry => entry.command)).toEqual(['npm outdated']);
      expect(unattended.stoppedAt?.rule.id).toBe('installs-packages');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
