import { describe, expect, it } from 'vitest';
import {
  buildWorkflowGuidance,
  effectiveStageLevel,
  lowerLevel,
} from '../../src/core/workflowGuidance.ts';
import { seedWorkflowConfig, type WorkflowConfig } from '../../src/core/workflowConfig.ts';

function config(over: Partial<WorkflowConfig> = {}): WorkflowConfig {
  const base = seedWorkflowConfig({ profile: 'solo' });
  return { ...base, ...over };
}

/**
 * The seeded config with one stage enabled at a given level.
 *
 * Enabling is explicit because `seedWorkflowConfig` ships every stage disabled —
 * deny-by-default — so a test that only re-levelled a stage would be asserting
 * against a table that is correctly empty.
 */
function withStageLevel(id: string, level: WorkflowConfig['stages'][number]['automationLevel']): WorkflowConfig {
  const base = config();
  return {
    ...base,
    stages: base.stages.map(stage => (stage.id === id
      ? { ...stage, enabled: true, automationLevel: level, command: undefined }
      : stage)),
  };
}

describe('lowerLevel', () => {
  it('picks the more restrictive of two levels, in both argument orders', () => {
    expect(lowerLevel('auto', 'observe')).toBe('observe');
    expect(lowerLevel('observe', 'auto')).toBe('observe');
    expect(lowerLevel('draft', 'draft')).toBe('draft');
    expect(lowerLevel('off', 'auto')).toBe('off');
  });
});

describe('effectiveStageLevel', () => {
  const stage = config().stages[0]!;

  it('applies the ceiling, never the stage alone', () => {
    const asking = { ...stage, automationLevel: 'auto' as const, enabled: true, blockers: [] };
    expect(effectiveStageLevel(asking, 'observe', true)).toBe('observe');
    expect(effectiveStageLevel(asking, 'auto', true)).toBe('auto');
  });

  /**
   * A blocker is not a preference to be weighed against a level — it is a
   * statement that the stage cannot run. Reporting `propose` for a stage whose
   * required command is empty would describe something that refuses on contact.
   */
  it('collapses a blocked stage to off, whatever it asked for', () => {
    const blocked = { ...stage, automationLevel: 'auto' as const, enabled: true, command: '' };
    expect(effectiveStageLevel(blocked, 'auto', true)).toBe('off');
  });

  it('collapses everything to off when the master switch is off', () => {
    const asking = { ...stage, automationLevel: 'auto' as const, enabled: true, blockers: [] };
    expect(effectiveStageLevel(asking, 'auto', false)).toBe('off');
  });

  it('treats a disabled stage as off', () => {
    const disabled = { ...stage, automationLevel: 'auto' as const, enabled: false, blockers: [] };
    expect(effectiveStageLevel(disabled, 'auto', true)).toBe('off');
  });
});

describe('buildWorkflowGuidance — written for an agent that is not AtlasMind', () => {
  it('says the rules apply to the reader, not to AtlasMind', () => {
    // The whole reason the block exists. AtlasMind's gates bind only AtlasMind;
    // an external agent had no way to know a workflow was declared at all.
    const text = buildWorkflowGuidance({ config: config(), masterEnabled: true });
    expect(text).toMatch(/apply to \*\*you\*\*/);
    expect(text).toMatch(/cannot gate a process it/);
  });

  it('names the committed file as the authority over its own text', () => {
    // A stale block must lose to the file, and must say so — otherwise an agent
    // follows a copy of rules that have since changed.
    const text = buildWorkflowGuidance({ config: config() });
    expect(text).toContain('project_memory/operations/workflow.json');
    expect(text).toMatch(/the file wins and this block is stale/);
  });

  it('lists the protected branches as never-push', () => {
    const text = buildWorkflowGuidance({
      config: config({ branches: { integration: 'develop', release: 'main', protected: ['main'] } }),
    });
    expect(text).toMatch(/never push directly/i);
    expect(text).toContain('`main`');
  });

  it('prints the level the ceiling actually permits, not the one a stage asked for', () => {
    // Printing `auto` under an `observe` ceiling would invite an agent to act on
    // authority nobody granted — the one way this block could do harm.
    const text = buildWorkflowGuidance({
      config: withStageLevel('planning', 'auto'),
      ceiling: 'observe',
      masterEnabled: true,
    });
    expect(text).toContain('| `observe` |');
    expect(text).not.toContain('| `auto` |');
  });

  it('translates each level into an instruction, not a label', () => {
    // `propose` means nothing to a reader who has never seen AtlasMind's ladder.
    const text = buildWorkflowGuidance({
      config: withStageLevel('planning', 'propose'),
      ceiling: 'propose',
      masterEnabled: true,
    });
    expect(text).toMatch(/wait for a human decision/);
  });

  it('says the workflow is off when it is, without dropping the conventions', () => {
    const text = buildWorkflowGuidance({ config: config(), masterEnabled: false });
    expect(text).toMatch(/currently switched off/);
    // The branch rules still apply to a human and to other agents.
    expect(text).toMatch(/### Branches/);
  });

  it('distinguishes a human check from a green CI check', () => {
    const base = config();
    const text = buildWorkflowGuidance({
      config: {
        ...base,
        stages: base.stages.map(stage => (stage.id === 'pull-request'
          ? {
            ...stage,
            enabled: true,
            command: undefined,
            requiredChecks: ['I read the diff'],
            requiredStatusChecks: ['quality (ubuntu-latest)'],
          }
          : stage)),
      },
      masterEnabled: true,
    });
    expect(text).toMatch(/a person saying/);
    expect(text).toMatch(/a machine saying/);
    expect(text).toContain('I read the diff');
    expect(text).toContain('quality (ubuntu-latest)');
  });

  it('warns that an invented label is created on the repository', () => {
    const text = buildWorkflowGuidance({ config: config(), masterEnabled: true });
    expect(text).toMatch(/only\*\* these|Use \*\*only\*\*/);
    expect(text).toMatch(/created\*? on the repository/);
  });

  it('points at the testing config rather than duplicating it', () => {
    // Two copies of the testing rules would drift, with nothing to arbitrate.
    const text = buildWorkflowGuidance({ config: config(), masterEnabled: true });
    expect(text).toContain('project_memory/index/testing-config.json');
    expect(text).toMatch(/not\*\* duplicated here|are \*\*not\*\* duplicated/);
  });

  it('reports blocked stages as blocked, with the reason', () => {
    const base = config();
    const text = buildWorkflowGuidance({
      config: {
        ...base,
        stages: base.stages.map(stage => (stage.id === 'release'
          // An empty command is the blocker: the stage needs one and has none.
          ? { ...stage, enabled: true, command: '' }
          : stage)),
      },
      masterEnabled: true,
    });
    expect(text).toMatch(/blocked\*\* and must not be attempted/);
  });

  it('says no stage is enabled rather than omitting the section', () => {
    // The default state, since stages ship disabled. A missing table would read
    // as "no rules apply"; the truth is "nothing has been enabled yet".
    const text = buildWorkflowGuidance({ config: config(), masterEnabled: true });
    expect(text).toMatch(/No workflow stage has been enabled/);
    expect(text).toMatch(/branch and label conventions above still apply/);
  });

  it('is deterministic — the same config renders identically', () => {
    // No clock, no randomness, nothing model-generated: two runs must agree, or
    // the block would churn the instruction files on every sync.
    const input = { config: config(), ceiling: 'draft' as const, masterEnabled: true };
    expect(buildWorkflowGuidance(input)).toBe(buildWorkflowGuidance(input));
  });

  it('contains no invented rule vocabulary', () => {
    // Everything must be traceable to the config. A phrase like "best practice"
    // would be the block asserting something nobody declared.
    const text = buildWorkflowGuidance({ config: config(), masterEnabled: true });
    expect(text.toLowerCase()).not.toContain('best practice');
    expect(text.toLowerCase()).not.toContain('you should probably');
  });
});
