import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assessPlannedActionCeilings,
  describePlannedActionCeilings,
  requiredLevelForRun,
} from '../../src/core/plannedActionCeiling.ts';
import { stageForGovernedAction } from '../../src/core/workflowChatGuard.ts';
import type { AutomationLevel } from '../../src/core/workflowAutomation.ts';

/** The levels this repository's own workflow file declared when the bug was found. */
const OBSERVED_STAGES: Readonly<Record<string, AutomationLevel>> = {
  planning: 'observe',
  branching: 'propose',
  development: 'propose',
  'pull-request': 'observe',
  ci: 'observe',
  release: 'observe',
  maintenance: 'observe',
  automation: 'observe',
};

describe('the observed plan', () => {
  // The plan an autonomous run generated against the levels above. Only the
  // estimated file count stood between it and an unattended push.
  const subTasks = [
    { id: 'baseline-green', title: 'Establish a green baseline' },
    { id: 'stage1-tests', title: 'Author failing Stage 1 hardening tests' },
    { id: 'release-hygiene', title: 'Bump the version and write the changelog' },
    { id: 'commit-phase1', title: 'Commit the Stage 1/2 hardening work' },
    { id: 'push-develop', title: 'Push to origin/develop' },
  ];

  it('refuses the commit, push and release subtasks against their declared stages', () => {
    const report = assessPlannedActionCeilings({
      subTasks,
      stageLevels: OBSERVED_STAGES,
      unattended: true,
    });
    expect(report.breaches.map(item => item.subTaskId).sort())
      .toEqual(['commit-phase1', 'push-develop', 'release-hygiene']);
  });

  it('leaves the subtasks that only read or write locally alone', () => {
    const report = assessPlannedActionCeilings({
      subTasks,
      stageLevels: OBSERVED_STAGES,
      unattended: true,
    });
    const flagged = new Set(report.breaches.map(item => item.subTaskId));
    expect(flagged.has('baseline-green')).toBe(false);
    expect(flagged.has('stage1-tests')).toBe(false);
  });

  it('names the stage and level for each, since a count is not actionable', () => {
    const text = describePlannedActionCeilings(assessPlannedActionCeilings({
      subTasks,
      stageLevels: OBSERVED_STAGES,
      unattended: true,
    }));
    expect(text).toContain('Push to origin/develop');
    expect(text).toContain('observe');
    expect(text).toContain('auto');
  });
});

describe('an unattended run needs the top rung', () => {
  it('requires auto unattended and propose otherwise', () => {
    expect(requiredLevelForRun(true)).toBe('auto');
    expect(requiredLevelForRun(false)).toBe('propose');
  });

  it('permits at propose what it refuses unattended', () => {
    const subTasks = [{ id: 'a', title: 'Commit the hardening work' }];
    const stageLevels = { ...OBSERVED_STAGES, development: 'propose' as AutomationLevel };
    expect(assessPlannedActionCeilings({ subTasks, stageLevels, unattended: true }).breaches)
      .toHaveLength(1);
    expect(assessPlannedActionCeilings({ subTasks, stageLevels, unattended: false }).breaches)
      .toHaveLength(0);
  });

  it('permits an unattended action once the stage declares auto', () => {
    expect(assessPlannedActionCeilings({
      subTasks: [{ id: 'a', title: 'Push to origin/develop' }],
      stageLevels: { ...OBSERVED_STAGES, development: 'auto' },
      unattended: true,
    }).breaches).toHaveLength(0);
  });
});

describe('silence where there are no rules to be outside of', () => {
  it('says nothing when no workflow is declared', () => {
    const report = assessPlannedActionCeilings({
      subTasks: [{ id: 'a', title: 'Push to origin/develop' }],
      stageLevels: undefined,
      unattended: true,
    });
    expect(report).toMatchObject({ declared: false, breaches: [], governedCount: 0 });
    expect(describePlannedActionCeilings(report)).toBeUndefined();
  });

  it('skips a stage the declared file does not carry', () => {
    // Absence is neither a refusal nor a grant. A stage nobody enabled has no
    // expectations, so inventing one would be worse than silence.
    const report = assessPlannedActionCeilings({
      subTasks: [{ id: 'a', title: 'Push to origin/develop' }],
      stageLevels: { planning: 'observe' },
      unattended: true,
    });
    expect(report.declared).toBe(true);
    expect(report.governedCount).toBe(1);
    expect(report.breaches).toHaveLength(0);
  });

  it('says nothing about a plan that takes no governed action', () => {
    const report = assessPlannedActionCeilings({
      subTasks: [
        { id: 'a', title: 'Read the failing test and summarise the cause' },
        { id: 'b', title: 'Draft the migration notes' },
      ],
      stageLevels: OBSERVED_STAGES,
      unattended: true,
    });
    expect(report.governedCount).toBe(0);
    expect(describePlannedActionCeilings(report)).toBeUndefined();
  });
});

describe('the stage mapping is shared, not copied', () => {
  it('attributes each action to the stage the chat guard uses', () => {
    const report = assessPlannedActionCeilings({
      subTasks: [
        { id: 'a', title: 'Open a pull request for the fix' },
        { id: 'b', title: 'Create a new branch for the work' },
        { id: 'c', title: 'Cut a release' },
      ],
      stageLevels: OBSERVED_STAGES,
      unattended: true,
    });
    const byId = new Map(report.breaches.map(item => [item.subTaskId, item]));
    expect(byId.get('a')?.stageId).toBe(stageForGovernedAction('pull-request'));
    expect(byId.get('b')?.stageId).toBe(stageForGovernedAction('branch'));
    expect(byId.get('c')?.stageId).toBe(stageForGovernedAction('release'));
  });
});

describe('the check belongs to the run, not to the surface that started it', () => {
  const ORCHESTRATOR = readFileSync(path.join(process.cwd(), 'src/core/orchestrator.ts'), 'utf8');
  const TYPES = readFileSync(path.join(process.cwd(), 'src/types.ts'), 'utf8');
  const EXTENSION = readFileSync(path.join(process.cwd(), 'src/extension.ts'), 'utf8');

  it('processProject assesses ceilings before it spends anything', () => {
    // It was reachable only from the chat participant. The chat panel, the CLI,
    // the mission runner and the run centre all reach processProject without
    // passing through it, so an unattended run could plan a merge into a
    // protected branch and discover a tool-permission wall several model
    // attempts later.
    const body = ORCHESTRATOR.slice(ORCHESTRATOR.indexOf('async processProject('));
    const assess = body.indexOf('assessPlannedActionCeilings(');
    const execute = body.indexOf('scheduler.execute(');
    expect(assess, 'processProject must assess ceilings').toBeGreaterThan(-1);
    expect(assess, 'the assessment must come before execution').toBeLessThan(execute);
  });

  it('stops the run on a breach rather than adding a note to it', () => {
    const body = ORCHESTRATOR.slice(ORCHESTRATOR.indexOf('async processProject('));
    expect(body).toContain('ceilingReport.declared && ceilingReport.breaches.length > 0');
    expect(body).toContain('throw new Error(refusal)');
  });

  it('treats a subtask as unattended, which needs the top rung', () => {
    const body = ORCHESTRATOR.slice(ORCHESTRATOR.indexOf('async processProject('));
    expect(body).toContain('unattended: true');
  });

  it('takes the levels from the host, because the rule needs inspect()', () => {
    // `min(master, ceiling, capability, stage)` is resolved most restrictively
    // across scopes so a workspace file cannot raise a ceiling the user set.
    // Only the editor host can see scopes, so it is a hook rather than a
    // `readSetting` call — and the host hands over the *same* resolver the chat
    // participant uses, so a plan cannot be refused in chat and permitted here.
    expect(TYPES).toContain('resolveWorkflowStageLevels?:');
    expect(EXTENSION).toContain('resolveWorkflowStageLevels: async ()');
    expect(EXTENSION).toContain('resolveWorkflowStageLevelsForRun');
  });
});
