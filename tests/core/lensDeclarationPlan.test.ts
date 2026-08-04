import { describe, expect, it } from 'vitest';

import {
  buildLensDeclarationPlan,
  LENS_ALL_STEP_IDS,
  LENS_DECLARATION_EXAMPLES,
  LENS_REQUIRED_STEP_IDS,
  LENS_SETUP_GUIDE,
} from '../../src/core/lensDeclarationPlan.js';
import {
  lensDeclarationDescriptors,
  type LensDeclarationFileStatus,
  type LensDeclarationKind,
  type LensDeclarationsSnapshot,
} from '../../src/core/lensDeclarations.js';
import {
  findNonOpeningActions,
  isSetupComplete,
  nextSetupStep,
  summarizeSetupProgress,
} from '../../src/core/setupWalkthrough.js';

function snapshot(statuses: Partial<Record<LensDeclarationKind, LensDeclarationFileStatus>>): LensDeclarationsSnapshot {
  const files = lensDeclarationDescriptors().map(descriptor => {
    const status = statuses[descriptor.kind] ?? 'missing';
    return {
      ...descriptor,
      status,
      declarationCount: status === 'ready' ? 2 : 0,
    };
  });
  const required = files.filter(file => file.required);
  const optional = files.filter(file => !file.required);
  return {
    files,
    readyCount: required.filter(file => file.status === 'ready').length,
    totalCount: required.length,
    optionalReadyCount: optional.filter(file => file.status === 'ready').length,
    optionalTotalCount: optional.length,
  };
}

const READY_GATES = { state: 'ready', config: 'ready' } as const;

describe('buildLensDeclarationPlan — the plan is never an installer', () => {
  it('offers only opening actions, whatever the file states are', () => {
    const cases: Array<Partial<Record<LensDeclarationKind, LensDeclarationFileStatus>>> = [
      {},
      { state: 'ready', config: 'empty' },
      { state: 'invalid', config: 'missing', mappings: 'invalid' },
      { ...READY_GATES, mappings: 'ready', trust: 'ready' },
      { state: 'unreadable', config: 'unavailable' },
    ];
    for (const statuses of cases) {
      const steps = buildLensDeclarationPlan({ workspaceName: 'repo', declarations: snapshot(statuses) });
      expect(findNonOpeningActions(steps)).toEqual([]);
    }
  });

  it('offers only opening actions when no workspace is open', () => {
    expect(findNonOpeningActions(buildLensDeclarationPlan({}))).toEqual([]);
  });
});

describe('buildLensDeclarationPlan — required versus optional', () => {
  it('counts only the two gates, so a project with both is finished', () => {
    const steps = buildLensDeclarationPlan({ workspaceName: 'repo', declarations: snapshot(READY_GATES) });
    const progress = summarizeSetupProgress(steps, LENS_SETUP_GUIDE.stepIds);

    expect(progress.finished).toBe(true);
    expect(progress.total).toBe(LENS_REQUIRED_STEP_IDS.length);
    expect(isSetupComplete(steps, LENS_SETUP_GUIDE.stepIds)).toBe(true);
  });

  it('never nominates an optional refinement as the next thing to do', () => {
    const steps = buildLensDeclarationPlan({ workspaceName: 'repo', declarations: snapshot(READY_GATES) });
    expect(nextSetupStep(steps, LENS_SETUP_GUIDE.stepIds)).toBeUndefined();
  });

  it('marks an absent refinement optional rather than outstanding', () => {
    const steps = buildLensDeclarationPlan({ workspaceName: 'repo', declarations: snapshot(READY_GATES) });
    expect(steps.find(step => step.id === 'mappings')?.status).toBe('optional');
    expect(steps.find(step => step.id === 'trust')?.status).toBe('optional');
  });

  it('still calls a BROKEN refinement broken — optional is about absence, not about errors', () => {
    const steps = buildLensDeclarationPlan({
      workspaceName: 'repo',
      declarations: snapshot({ ...READY_GATES, trust: 'invalid' }),
    });
    expect(steps.find(step => step.id === 'trust')?.status).toBe('todo');
  });

  it('emits every declaration kind as a step', () => {
    const steps = buildLensDeclarationPlan({ workspaceName: 'repo', declarations: snapshot({}) });
    expect(steps.map(step => step.id).sort()).toEqual([...LENS_ALL_STEP_IDS].sort());
  });
});

describe('buildLensDeclarationPlan — ordering', () => {
  it('puts a broken declaration before an absent one', () => {
    const steps = buildLensDeclarationPlan({
      workspaceName: 'repo',
      // `state` is declared first in the table, so a naive ordering would put it first.
      declarations: snapshot({ state: 'missing', config: 'invalid' }),
    });
    const ids = steps.map(step => step.id);
    expect(ids.indexOf('config')).toBeLessThan(ids.indexOf('state'));
  });

  it('keeps declaration order when neither gate is broken', () => {
    const steps = buildLensDeclarationPlan({
      workspaceName: 'repo',
      declarations: snapshot({ state: 'missing', config: 'empty' }),
    });
    const ids = steps.map(step => step.id);
    expect(ids.indexOf('state')).toBeLessThan(ids.indexOf('config'));
  });

  it('does not shuffle between identical renders', () => {
    const input = { workspaceName: 'repo', declarations: snapshot({ state: 'empty', config: 'empty' }) };
    const first = buildLensDeclarationPlan(input).map(step => step.id);
    const second = buildLensDeclarationPlan(input).map(step => step.id);
    expect(first).toEqual(second);
  });
});

describe('buildLensDeclarationPlan — unassessed is not empty', () => {
  it('blocks every file step when no workspace is open', () => {
    const steps = buildLensDeclarationPlan({});
    expect(steps.find(step => step.id === 'workspace')?.status).toBe('todo');
    for (const kind of ['state', 'config', 'mappings', 'trust']) {
      expect(steps.find(step => step.id === kind)?.status).toBe('blocked');
    }
  });

  it('distinguishes a workspace that could not be inspected from one with no files', () => {
    const steps = buildLensDeclarationPlan({ workspaceName: 'virtual-repo' });
    const workspaceStep = steps.find(step => step.id === 'workspace');
    expect(workspaceStep?.status).toBe('todo');
    expect(workspaceStep?.detail).toContain('could not be inspected');
    // Never reported as "missing" — nothing was looked for.
    expect(steps.find(step => step.id === 'state')?.detail).not.toContain('does not exist');
  });
});

describe('buildLensDeclarationPlan — guidance', () => {
  it('shows a worked example for a file that has not been written', () => {
    const steps = buildLensDeclarationPlan({ workspaceName: 'repo', declarations: snapshot({}) });
    const state = steps.find(step => step.id === 'state');
    const example = state?.guidance?.find(line => line.command);
    expect(example?.command).toBe(LENS_DECLARATION_EXAMPLES.state.json);
  });

  it('does not repeat the example once the file is declared', () => {
    const steps = buildLensDeclarationPlan({ workspaceName: 'repo', declarations: snapshot(READY_GATES) });
    expect(steps.find(step => step.id === 'state')?.guidance?.some(line => line.command)).toBe(false);
  });

  it('sends a broken file to the error rather than to the example', () => {
    const steps = buildLensDeclarationPlan({
      workspaceName: 'repo',
      declarations: snapshot({ state: 'invalid', config: 'ready' }),
    });
    const guidance = steps.find(step => step.id === 'state')?.guidance ?? [];
    expect(guidance.some(line => line.text.includes('first error'))).toBe(true);
    expect(guidance.some(line => line.command)).toBe(false);
  });

  it('promises drafting only when a model is known to be available', () => {
    const declarations = snapshot({});
    const offered = buildLensDeclarationPlan({ workspaceName: 'repo', declarations, drafting: true });
    const unknown = buildLensDeclarationPlan({ workspaceName: 'repo', declarations });
    const withheld = buildLensDeclarationPlan({ workspaceName: 'repo', declarations, drafting: false });

    const textOf = (steps: ReturnType<typeof buildLensDeclarationPlan>) =>
      (steps.find(step => step.id === 'state')?.guidance ?? []).map(line => line.text).join(' ');

    expect(textOf(offered)).toContain('Or let Atlas read the repository');
    expect(textOf(unknown)).toContain('once a model provider is configured');
    expect(textOf(withheld)).not.toContain('Atlas');
  });
});

describe('every worked example is valid against its own normalizer', () => {
  it('parses and passes, so the guide never shows a shape the lens would refuse', async () => {
    const { reviewLensDeclarationDraft } = await import('../../src/core/lensDeclarationDraft.js');
    for (const [kind, example] of Object.entries(LENS_DECLARATION_EXAMPLES)) {
      const review = reviewLensDeclarationDraft(
        kind as LensDeclarationKind,
        `\`\`\`json\n${example.json}\n\`\`\``,
        { anchorExists: () => true },
      );
      expect(review.outcome, `${kind} example should be valid`).toBe('accepted');
    }
  });
});
