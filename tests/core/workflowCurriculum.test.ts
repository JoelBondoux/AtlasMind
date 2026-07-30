import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_GLOSSARY,
  WORKFLOW_STAGE_IDS,
  buildWorkflowCurriculum,
  deriveStageStatus,
  glossaryEntry,
  nextWorkflowStep,
  referencedGlossaryKeys,
  summarizeWorkflowProgress,
  type WorkflowObservedState,
  type WorkflowStep,
} from '../../src/core/workflowCurriculum.ts';
import { findNonOpeningActions } from '../../src/core/setupWalkthrough.ts';

/** A repository AtlasMind knows nothing about. */
const BLANK: WorkflowObservedState = {};

/** Everything observable is satisfied. */
const HEALTHY: WorkflowObservedState = {
  repoSlug: 'acme/widget',
  ghInstalled: true,
  ghAuthenticated: true,
  openIssueCount: 4,
  staleIssueCount: 0,
  hasIssueTemplates: true,
  declaredLabelCount: 12,
  currentBranch: 'feat/12-thing',
  integrationBranch: 'develop',
  protectedBranches: ['main'],
  workingTreeClean: true,
  nonConformingBranchCount: 0,
  enabledTestingMethodologyIds: ['tdd', 'unit'],
  hasPullRequestTemplate: true,
  openPullRequestCount: 1,
  ciWorkflowCount: 1,
  ciStatus: 'pass',
  hasTestReport: true,
  currentVersion: '1.2.3',
  hasChangelog: true,
  changelogHasCurrentVersion: true,
  commitsSinceLastTag: 0,
  hasDebtRegister: true,
  staleDocumentCount: 0,
  openDependencyPrCount: 0,
  workflowConfigPresent: true,
  workflowEnabled: true,
  profile: 'solo',
};

const allSteps = (state: WorkflowObservedState): WorkflowStep[] =>
  buildWorkflowCurriculum(state).flatMap(stage => stage.steps);

const stepById = (state: WorkflowObservedState, id: string): WorkflowStep | undefined =>
  allSteps(state).find(step => step.id === id);

describe('buildWorkflowCurriculum — shape and ordering', () => {
  it('produces all eight stages in specification order', () => {
    const stages = buildWorkflowCurriculum(BLANK);
    expect(stages.map(stage => stage.id)).toEqual([...WORKFLOW_STAGE_IDS]);
    expect(stages.map(stage => stage.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('gives every step a non-empty why and how', () => {
    // The teaching payload is the point of this module. A step that says only
    // *what* to do has not done its job for the audience this is written for.
    for (const step of allSteps(BLANK)) {
      expect(step.why.length, `${step.id} has no why`).toBeGreaterThan(20);
      expect(step.how.length, `${step.id} has no how`).toBeGreaterThan(0);
      for (const line of step.how) {
        expect(line.text.length, `${step.id} has an empty guidance line`).toBeGreaterThan(0);
      }
    }
  });

  it('gives every stage a why, an owner, and a determinism statement', () => {
    for (const stage of buildWorkflowCurriculum(BLANK)) {
      expect(stage.why.length, `${stage.id} has no why`).toBeGreaterThan(20);
      expect(stage.ownerAgentId.length, `${stage.id} has no owner`).toBeGreaterThan(0);
      expect(stage.determinism.length, `${stage.id} has no determinism note`).toBeGreaterThan(20);
      expect(stage.blurb.length).toBeGreaterThan(0);
    }
  });

  it('uses unique step ids namespaced by their stage', () => {
    const stages = buildWorkflowCurriculum(BLANK);
    const ids = stages.flatMap(stage => stage.steps.map(step => step.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const stage of stages) {
      for (const step of stage.steps) {
        expect(step.id.startsWith(`${stage.id}.`)).toBe(true);
      }
    }
  });
});

describe('status derivation — absent evidence is never "done"', () => {
  it('reports todo, not done, when nothing could be observed', () => {
    // The single most damaging error this surface could make is claiming a step
    // is finished on evidence it never had.
    const connect = stepById(BLANK, 'planning.connect');
    expect(connect?.status).toBe('todo');
    expect(stepById(BLANK, 'planning.templates')?.status).toBe('blocked');
    expect(stepById(BLANK, 'release.changelog')?.status).toBe('todo');
  });

  it('marks steps done once their evidence is present', () => {
    expect(stepById(HEALTHY, 'planning.connect')?.status).toBe('done');
    expect(stepById(HEALTHY, 'planning.templates')?.status).toBe('done');
    expect(stepById(HEALTHY, 'ci.workflow')?.status).toBe('done');
    expect(stepById(HEALTHY, 'release.changelog')?.status).toBe('done');
  });

  it('blocks a step on its prerequisite rather than nominating it', () => {
    // Issue templates cannot be assessed without a repository, and telling
    // somebody to add templates when AtlasMind cannot see the repo sends them
    // to fix the wrong thing.
    const templates = stepById({ repoSlug: undefined }, 'planning.templates');
    expect(templates?.status).toBe('blocked');
    expect(templates?.detail).toContain('Connect the repository first');
  });

  it('names the specific gh problem rather than a generic failure', () => {
    expect(stepById({ ghInstalled: false }, 'planning.connect')?.detail)
      .toContain('not installed');
    expect(stepById({ ghInstalled: true, ghAuthenticated: false }, 'planning.connect')?.detail)
      .toContain('not signed in');
  });

  it('blocks branching on a dirty tree but not on an unknown one', () => {
    expect(stepById({ workingTreeClean: false }, 'branching.clean')?.status).toBe('blocked');
    expect(stepById({ workingTreeClean: true }, 'branching.clean')?.status).toBe('done');
    expect(stepById(BLANK, 'branching.clean')?.status).toBe('todo');
  });
});

describe('profile-sensitive content', () => {
  it('teaches solo developers that zero required approvals is the honest answer', () => {
    const solo = stepById({ ...HEALTHY, profile: 'solo' }, 'pull-request.review');
    expect(solo?.title).toContain('Decide your review policy');
    expect(solo?.detail).toContain('zero required approvals');
    expect(solo?.why).toContain('theatre');
    expect(solo?.proficiency).toBe('core');
  });

  it('requires a distinct approver in the studio profile', () => {
    const studio = stepById({ ...HEALTHY, profile: 'studio', requiredApprovers: 0 }, 'pull-request.review');
    expect(studio?.title).toContain('distinct approver');
    expect(studio?.status).toBe('todo');
    expect(studio?.proficiency).toBe('team');

    const satisfied = stepById({ ...HEALTHY, profile: 'studio', requiredApprovers: 1 }, 'pull-request.review');
    expect(satisfied?.status).toBe('done');
  });
});

describe('deriveStageStatus', () => {
  const step = (status: WorkflowStep['status']): WorkflowStep => ({
    id: 'x', title: 'x', status, detail: '', why: 'x', how: [{ text: 'x' }], proficiency: 'core',
  });

  it('is done only when every counted step is done', () => {
    expect(deriveStageStatus([step('done'), step('done')])).toBe('done');
    expect(deriveStageStatus([step('done'), step('todo')])).toBe('todo');
    expect(deriveStageStatus([step('done'), step('blocked')])).toBe('blocked');
  });

  it('ignores optional steps entirely', () => {
    // A stage is not unfinished because somebody declined something they were
    // explicitly told was a choice.
    expect(deriveStageStatus([step('done'), step('optional')])).toBe('done');
    expect(deriveStageStatus([step('optional')])).toBe('optional');
  });

  it('prefers todo over blocked, so the actionable state wins', () => {
    expect(deriveStageStatus([step('blocked'), step('todo')])).toBe('todo');
  });
});

describe('summarizeWorkflowProgress', () => {
  it('reports unfinished for a curriculum that could not be gathered', () => {
    // Matching the setup walkthrough: a guide whose state could not be read has
    // not been completed, it has failed to load.
    expect(summarizeWorkflowProgress([])).toEqual({ done: 0, total: 0, finished: false });
  });

  it('counts every non-optional step across every stage', () => {
    const blank = summarizeWorkflowProgress(buildWorkflowCurriculum(BLANK));
    const healthy = summarizeWorkflowProgress(buildWorkflowCurriculum(HEALTHY));
    expect(blank.total).toBe(healthy.total);
    expect(blank.total).toBeGreaterThan(0);
    expect(healthy.done).toBeGreaterThan(blank.done);
  });

  it('excludes optional steps from the total', () => {
    const stages = buildWorkflowCurriculum(BLANK);
    const optionalCount = stages
      .flatMap(stage => stage.steps)
      .filter(step => step.status === 'optional').length;
    expect(optionalCount).toBeGreaterThan(0);
    expect(summarizeWorkflowProgress(stages).total).toBe(
      stages.flatMap(stage => stage.steps).length - optionalCount,
    );
  });
});

describe('nextWorkflowStep', () => {
  it('nominates the first actionable step, earliest stage first', () => {
    const next = nextWorkflowStep(buildWorkflowCurriculum(BLANK));
    expect(next?.stage.id).toBe('planning');
    expect(next?.step.id).toBe('planning.connect');
  });

  it('prefers a todo step over a blocked one', () => {
    const next = nextWorkflowStep(buildWorkflowCurriculum(BLANK));
    expect(next?.step.status).toBe('todo');
  });

  it('never nominates an optional step', () => {
    const stages = buildWorkflowCurriculum(HEALTHY);
    const next = nextWorkflowStep(stages);
    expect(next?.step.status).not.toBe('optional');
  });
});

describe('glossary', () => {
  it('resolves every key referenced by any step, in any state', () => {
    // A dangling glossary reference renders as a `?` that explains nothing,
    // which is worse than no `?` at all.
    for (const state of [BLANK, HEALTHY, { ...HEALTHY, profile: 'studio' as const }]) {
      for (const key of referencedGlossaryKeys(buildWorkflowCurriculum(state))) {
        expect(glossaryEntry(key), `unresolved glossary key: ${key}`).toBeDefined();
      }
    }
  });

  it('defines what a term is before what to do with it', () => {
    for (const [key, entry] of Object.entries(WORKFLOW_GLOSSARY)) {
      expect(entry.term.length, `${key} has no term`).toBeGreaterThan(0);
      expect(entry.definition.length, `${key} is too short to teach anything`).toBeGreaterThan(40);
    }
  });
});

describe('safety invariants', () => {
  it('offers no action that mutates state', () => {
    // The curriculum inherits the setup-guide rule: a guide opens surfaces, it
    // never flips the switches it exists to explain.
    for (const state of [BLANK, HEALTHY]) {
      expect(findNonOpeningActions(buildWorkflowCurriculum(state).flatMap(s => s.steps))).toEqual([]);
    }
  });

  it('teaches the hard automation ceilings explicitly', () => {
    const limits = stepById(HEALTHY, 'automation.limits');
    const text = (limits?.how ?? []).map(line => line.text).join(' ');
    expect(text).toContain('never force-pushes');
    expect(text).toContain('never re-runs a CI job');
    expect(text).toContain('never merges a dependency update');
    expect(text).toContain('never stores a GitHub token');
  });

  it('states plainly that plan decomposition is not reproducible', () => {
    // Overclaiming determinism here would be the one dishonest sentence in the
    // whole surface.
    const development = buildWorkflowCurriculum(HEALTHY).find(stage => stage.id === 'development');
    expect(development?.determinism).toMatch(/not\b/i);
    expect(development?.determinism.toLowerCase()).toContain('language model');
  });

  it('keeps stage 3 free of any GitHub surface', () => {
    const development = buildWorkflowCurriculum(HEALTHY).find(stage => stage.id === 'development');
    expect(development?.githubSurface).toEqual([]);
  });
});
