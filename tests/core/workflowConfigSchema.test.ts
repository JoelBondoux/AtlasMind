import { describe, it, expect } from 'vitest';
import {
  seedWorkflowConfig,
  sanitizeWorkflowConfig,
  applyWorkflowConfigEdit,
  renderWorkflowMarkdown,
  stageBlockers,
  isStageRunnable,
  validateWorkflowConfig,
  allDeclaredLabels,
  type WorkflowConfig,
} from '../../src/core/workflowConfig';

/**
 * The half of the specification's §4.2 schema that shipped a version late.
 *
 * `command`, the categorised label taxonomy, `testing.inherit` and
 * `testingOverrides` were all in the specification and none of them were in the
 * implementation — including `command`, whose rule the module header cited while
 * the field did not exist. These tests pin the semantics rather than the shapes,
 * because the shapes are the easy half.
 */

const seeded = (): WorkflowConfig => seedWorkflowConfig({ profile: 'solo' });
const release = (config: WorkflowConfig) => config.stages.find(stage => stage.id === 'release')!;

describe('an empty command is the blocker, not an oversight', () => {
  const withCommand = (command: string | undefined): WorkflowConfig => {
    const config = seeded();
    if (command === undefined) {
      delete release(config).command;
    } else {
      release(config).command = command;
    }
    return config;
  };

  it('keeps absent and empty apart, because they mean opposite things', () => {
    // Absent: the stage needs no command. Empty: it needs one and has none.
    // Collapsing them turns a deliberate blocker into an oversight, or the
    // reverse — and the reverse is the one that opens a gate.
    expect(stageBlockers(release(withCommand(undefined)))).toEqual([]);
    expect(stageBlockers(release(withCommand('')))).toHaveLength(1);
    expect(stageBlockers(release(withCommand('npm run ship')))).toEqual([]);
  });

  it('reports it alongside declared blockers rather than instead of them', () => {
    const config = withCommand('');
    release(config).blockers = ['Waiting on legal'];
    expect(stageBlockers(release(config))).toHaveLength(2);
    expect(isStageRunnable(release(config))).toBe(false);
  });

  it('preserves an empty command through a round trip rather than dropping it', () => {
    // Dropping it silently reopens the gate it exists to hold shut.
    const back = sanitizeWorkflowConfig(JSON.parse(JSON.stringify(withCommand(''))));
    expect(release(back!).command).toBe('');
  });

  it('does not invent a command key for a stage that had none', () => {
    const back = sanitizeWorkflowConfig(JSON.parse(JSON.stringify(seeded())));
    expect(back?.stages.every(stage => stage.command === undefined)).toBe(true);
  });

  it('says the gate closes when an edit clears a command', () => {
    const result = applyWorkflowConfigEdit(withCommand('npm run ship'), {
      stages: [{ id: 'release', command: '' }],
    });
    expect(result.changes[0]).toMatch(/blocks the stage until one is supplied/);
  });

  it('shows absent, empty and set as three different things in the mirror', () => {
    expect(renderWorkflowMarkdown(withCommand(undefined))).toContain('n/a');
    expect(renderWorkflowMarkdown(withCommand(''))).toContain('**not set**');
    expect(renderWorkflowMarkdown(withCommand('npm run ship'))).toContain('npm run ship');
  });
});

describe('validateWorkflowConfig checks what the file names, not whether it reads', () => {
  it('reports an owner that is not an agent rather than dropping it', () => {
    // Dropping it leaves a stage silently ownerless, which reads as nobody
    // having been assigned rather than the assignee having gone.
    const config = seeded();
    config.stages.find(stage => stage.id === 'planning')!.ownerAgentId = 'ghost-agent';
    const problems = validateWorkflowConfig(config, { knownAgentIds: ['github-operator'] });
    expect(problems.some(problem => problem.detail.includes('ghost-agent'))).toBe(true);
    expect(config.stages.find(stage => stage.id === 'planning')?.ownerAgentId).toBe('ghost-agent');
  });

  it('says nothing about owners when it was not told which agents exist', () => {
    // A pure reader cannot know, and guessing would report every owner as
    // missing on a workspace that simply did not pass the list.
    const config = seeded();
    config.stages.find(stage => stage.id === 'planning')!.ownerAgentId = 'ghost-agent';
    expect(validateWorkflowConfig(config).some(p => p.detail.includes('ghost-agent'))).toBe(false);
  });

  it('describes a blocked-by-empty-command stage as intended, not as a fault', () => {
    const config = seeded();
    release(config).enabled = true;
    release(config).command = '';
    const problem = validateWorkflowConfig(config).find(entry => entry.stageId === 'release');
    expect(problem?.detail).toMatch(/intended behaviour/);
  });

  it('says an empty taxonomy means nothing will be suggested', () => {
    const config = seeded();
    config.labels = { type: [], priority: [], status: [], area: [] };
    expect(validateWorkflowConfig(config).some(p => /nothing will be suggested/.test(p.detail))).toBe(true);
  });
});

describe('the label taxonomy', () => {
  it('reads the flat shape an earlier version wrote', () => {
    // The obligation the unknown-field round trip creates, pointing backwards
    // through time: a file written by 0.190.0 must keep its labels.
    const config = sanitizeWorkflowConfig({ labels: { declared: ['bug', 'chore'] } });
    expect(config?.labels.type).toEqual(['bug', 'chore']);
  });

  it('edits one category without touching the others', () => {
    const config = seeded();
    config.labels = { type: ['bug'], priority: ['p1'], status: ['blocked'], area: ['ui'] };
    const result = applyWorkflowConfigEdit(config, { labels: { category: 'type', values: ['defect'] } });
    expect(result.config.labels.type).toEqual(['defect']);
    expect(result.config.labels.priority).toEqual(['p1']);
    expect(result.config.labels.area).toEqual(['ui']);
  });

  it('refuses an unrecognised category rather than dropping the edit silently', () => {
    const result = applyWorkflowConfigEdit(seeded(), { labels: { category: 'severity', values: ['x'] } });
    expect(result.refused[0]).toMatch(/not a label category/);
    expect(result.changes).toEqual([]);
  });

  it('flattens in category order', () => {
    expect(allDeclaredLabels({ type: ['a'], priority: ['b'], status: ['c'], area: ['d'] }))
      .toEqual(['a', 'b', 'c', 'd']);
  });

  it('omits empty categories from the mirror rather than listing them as blank', () => {
    const config = seeded();
    config.labels = { type: ['bug'], priority: [], status: [], area: [] };
    const markdown = renderWorkflowMarkdown(config);
    expect(markdown).toContain('Labels (type)');
    expect(markdown).not.toContain('Labels (priority)');
  });
});

describe('per-stage testing overrides', () => {
  it('round-trips an override', () => {
    const config = seeded();
    config.stages.find(stage => stage.id === 'ci')!.testingOverrides = [
      { methodologyId: 'unit-testing', requiredAtStage: true },
    ];
    const back = sanitizeWorkflowConfig(JSON.parse(JSON.stringify(config)));
    expect(back?.stages.find(stage => stage.id === 'ci')?.testingOverrides)
      .toEqual([{ methodologyId: 'unit-testing', requiredAtStage: true }]);
  });

  it('drops an entry naming something that is not a methodology id', () => {
    // Coercing it would produce an override for a methodology nobody has.
    const config = sanitizeWorkflowConfig({
      stages: [{ id: 'ci', testingOverrides: [{ methodologyId: 'Not An Id!', requiredAtStage: true }] }],
    });
    expect(config?.stages.find(stage => stage.id === 'ci')?.testingOverrides).toBeUndefined();
  });

  it('defaults requiredAtStage to false rather than to required', () => {
    const config = sanitizeWorkflowConfig({
      stages: [{ id: 'ci', testingOverrides: [{ methodologyId: 'unit-testing' }] }],
    });
    expect(config?.stages.find(stage => stage.id === 'ci')?.testingOverrides?.[0].requiredAtStage).toBe(false);
  });
});

describe('testing requirements are declared as inherited, not duplicated', () => {
  it('carries the single-valued declaration', () => {
    // The field exists to *say* that testing rules live in testing-config.json.
    // A second copy would drift, and the two would disagree about what a stage
    // requires with nothing to arbitrate.
    expect(seeded().testing).toEqual({ inherit: true });
    expect(sanitizeWorkflowConfig({})?.testing).toEqual({ inherit: true });
  });

  it('says so in the mirror, where a reviewer would otherwise wonder', () => {
    expect(renderWorkflowMarkdown(seeded())).toMatch(/not.*duplicated here/i);
  });
});
