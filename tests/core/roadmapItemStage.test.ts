import { describe, expect, it } from 'vitest';
import {
  ROADMAP_ITEM_STAGE_ORDER,
  ROADMAP_ITEM_STAGE_RULES,
  describeRoadmapItemStage,
  readRoadmapItemStage,
  tallyRoadmapItemStages,
  type RoadmapItemStageInput,
} from '../../src/core/roadmapItemStage.ts';

const item = (overrides: Partial<RoadmapItemStageInput> = {}): RoadmapItemStageInput => ({
  completed: false,
  branches: [],
  ...overrides,
});

describe('the missing rung', () => {
  // The state the Completion-check hand-off was written for. Before this, an
  // item whose branch had merged read exactly like one nobody had touched.
  it('reports merged-but-unticked work as awaiting verification', () => {
    expect(readRoadmapItemStage(item({
      branch: 'chore/the-guided-github-workflow',
      branches: [{ name: 'chore/the-guided-github-workflow', merged: true }],
    }))).toMatchObject({ stage: 'awaiting-verification', rule: 'branch-merged' });
  });

  it('separates it from work still in flight', () => {
    expect(readRoadmapItemStage(item({
      branch: 'chore/the-guided-github-workflow',
      branches: [{ name: 'chore/the-guided-github-workflow', merged: false }],
    }))).toMatchObject({ stage: 'in-progress', rule: 'branch-exists' });
  });
});

describe('the tick stays a human act', () => {
  it('never derives complete from git state', () => {
    // No combination of signals may produce `complete` while the box is
    // unticked. The three hand-off prompts promise a person does that.
    const derivable = [
      item({ branch: 'b', branches: [{ name: 'b', merged: true }], planPath: 'p.md' }),
      item({ branch: 'b', branches: [{ name: 'b', merged: false }] }),
      item({ planPath: 'p.md' }),
      item(),
      item({ branches: undefined }),
    ].map(readRoadmapItemStage);
    expect(derivable.some(reading => reading.stage === 'complete')).toBe(false);
  });

  it('honours the tick over any repository state', () => {
    expect(readRoadmapItemStage(item({
      completed: true,
      branch: 'b',
      branches: [{ name: 'b', merged: false }],
    }))).toMatchObject({ stage: 'complete', rule: 'checkbox-ticked' });
  });
});

describe('unknown is never a claim', () => {
  it('marks a reading unassessed when no inventory was gathered', () => {
    const reading = readRoadmapItemStage({ completed: false, branch: 'b', branches: undefined });
    expect(reading.assessed).toBe(false);
    // A declared branch that could not be checked is intent, not progress.
    expect(reading.stage).toBe('planned');
    expect(reading.rule).toBe('branch-declared');
  });

  it('does not claim in-progress from a branch name alone', () => {
    expect(readRoadmapItemStage(item({ branch: 'feat/not-created-yet' })).stage).toBe('planned');
  });

  it('matches a branch exactly, never by prefix', () => {
    // `feat/login` must not claim `feat/login-v2` — different work.
    expect(readRoadmapItemStage(item({
      branch: 'feat/login',
      branches: [{ name: 'feat/login-v2', merged: true }],
    })).stage).toBe('planned');
  });

  it('ignores a blank branch declaration', () => {
    expect(readRoadmapItemStage(item({ branch: '   ' })).stage).toBe('not-started');
  });
});

describe('what the repository alone can prove', () => {
  it('reads a filed plan as planned', () => {
    expect(readRoadmapItemStage(item({ planPath: 'project_memory/roadmap/plans/x.md' })))
      .toMatchObject({ stage: 'planned', rule: 'plan-filed' });
  });

  it('reads an untouched item as not started', () => {
    expect(readRoadmapItemStage(item())).toMatchObject({
      stage: 'not-started',
      rule: 'nothing-recorded',
    });
  });
});

describe('the tally', () => {
  it('counts each stage and surfaces the actionable set', () => {
    const tally = tallyRoadmapItemStages([
      readRoadmapItemStage(item({ completed: true })),
      readRoadmapItemStage(item({ branch: 'a', branches: [{ name: 'a', merged: true }] })),
      readRoadmapItemStage(item({ branch: 'b', branches: [{ name: 'b', merged: true }] })),
      readRoadmapItemStage(item({ branch: 'c', branches: [{ name: 'c', merged: false }] })),
      readRoadmapItemStage(item()),
    ]);
    expect(tally.counts.complete).toBe(1);
    expect(tally.counts['awaiting-verification']).toBe(2);
    expect(tally.counts['in-progress']).toBe(1);
    expect(tally.counts['not-started']).toBe(1);
    expect(tally.awaitingVerification).toBe(2);
    expect(tally.assessed).toBe(true);
  });

  it('is unassessed as a whole when any reading could not consult git', () => {
    const tally = tallyRoadmapItemStages([
      readRoadmapItemStage(item({ completed: true })),
      readRoadmapItemStage({ completed: false, branch: 'a', branches: undefined }),
    ]);
    expect(tally.assessed).toBe(false);
  });

  it('has a zero for every stage, so an absent one is not undefined', () => {
    const tally = tallyRoadmapItemStages([]);
    for (const stage of ROADMAP_ITEM_STAGE_ORDER) {
      expect(tally.counts[stage]).toBe(0);
    }
  });
});

describe('the declared table', () => {
  it('carries a rule for every stage a reading can produce', () => {
    const inputs = [
      item({ completed: true }),
      item({ branch: 'a', branches: [{ name: 'a', merged: true }] }),
      item({ branch: 'a', branches: [{ name: 'a', merged: false }] }),
      item({ planPath: 'p.md' }),
      item({ branch: 'unmade' }),
      item(),
    ];
    for (const reading of inputs.map(readRoadmapItemStage)) {
      const rule = ROADMAP_ITEM_STAGE_RULES.find(candidate => candidate.id === reading.rule);
      expect(rule).toBeDefined();
      expect(rule?.stage).toBe(reading.stage);
    }
  });

  it('labels every stage', () => {
    for (const stage of ROADMAP_ITEM_STAGE_ORDER) {
      expect(describeRoadmapItemStage(stage).length).toBeGreaterThan(0);
    }
  });
});
