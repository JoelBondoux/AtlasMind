import { describe, expect, it } from 'vitest';
import {
  DELIVERY_STAGE_REQUIREMENT_RULES,
  buildDeliveryStageRunbooks,
  deliveryStageRequirementDeltas,
  deliveryStageRequirements,
} from '../../src/core/deliveryStageRunbooks.ts';
import { seedDeliveryConfig } from '../../src/core/deliveryManager.ts';
import type { DeploymentStage } from '../../src/types.ts';

const PACKAGE_JSON = {
  version: '1.2.3',
  packageManager: 'npm@11.0.0',
  scripts: {
    dev: 'tsc -w -p .',
    compile: 'tsc -p .',
    test: 'vitest run',
    package: 'vsce package',
    'publish:release': 'vsce publish',
  },
};

function pipeline(): ReturnType<typeof seedDeliveryConfig> {
  return seedDeliveryConfig({
    currentBranch: 'develop',
    productionBranch: 'main',
    developBranch: 'develop',
    archetype: 'vscode-extension',
    publishTarget: 'VS Code Marketplace',
  });
}

function baseInput(): Parameters<typeof buildDeliveryStageRunbooks>[0] {
  return {
    files: ['package.json', 'package-lock.json', 'CHANGELOG.md'],
    packageJson: PACKAGE_JSON,
    deliveryConfig: pipeline(),
    workingTreeClean: true,
  };
}

describe('buildDeliveryStageRunbooks — one runbook per stage', () => {
  it('builds a runbook for every configured stage, lowest rank first', () => {
    const set = buildDeliveryStageRunbooks(baseInput());

    expect(set.staged).toBe(true);
    // A vscode-extension deploys nowhere, so the seeder names the middle stage
    // Integration rather than Staging. The runbook set reports what the pipeline
    // says, never a tidier name of its own.
    expect(set.runbooks.map(entry => entry.guide.stageName)).toEqual(['Local', 'Integration', 'Production']);
    expect(set.runbooks.map(entry => entry.guide.stageKind)).toEqual(['local', 'staging', 'production']);
  });

  it('gives the local runbook a way to RUN the project, and never a way to publish it', () => {
    // The question the single production-shaped runbook could not answer, and
    // the one a new contributor asks first.
    const local = buildDeliveryStageRunbooks(baseInput()).runbooks[0]!.guide;
    const deploy = local.phases.find(phase => phase.id === 'deploy');
    const publish = local.phases.find(phase => phase.id === 'publish');

    expect(deploy?.label).toBe('Run it here');
    expect(deploy?.steps.map(step => step.command)).toContain('npm run dev');
    expect(publish).toBeUndefined();
    expect(local.phases.flatMap(phase => phase.steps).map(step => step.command))
      .not.toContain('npm run publish:release');
  });

  it('puts the publish scripts only on the stage the pipeline says publishes', () => {
    // `publish:*` and `tag:*` scripts exist whatever stage you are reading, so
    // listing them by ecosystem alone put `npm run publish:release` one click
    // from the button that starts the dev server, and on an integration stage
    // that publishes nothing at all.
    const set = buildDeliveryStageRunbooks(baseInput());
    const publishCommands = (name: string): Array<string | undefined> => set.runbooks
      .find(entry => entry.guide.stageName === name)!.guide.phases
      .filter(phase => phase.id === 'publish')
      .flatMap(phase => phase.steps)
      .map(step => step.command);

    expect(publishCommands('Production')).toContain('npm run publish:release');
    expect(publishCommands('Integration')).toEqual([]);
    expect(publishCommands('Local')).toEqual([]);
  });

  it('does not restate a declared check the runbook already derived', () => {
    // The seeded pipeline lists "Working tree clean" as a required check, and
    // Prerequisites already shows it with the git command that answers it. Two
    // rows for one fact makes the second look like something extra to do.
    const config = pipeline();
    const production = config.stages.find(stage => stage.kind === 'production')!;
    production.promotionPolicy.requiredChecks = ['Working tree clean', 'Someone smoke-tested it'];
    const guide = buildDeliveryStageRunbooks({ ...baseInput(), deliveryConfig: config })
      .runbooks.find(entry => entry.guide.stageKind === 'production')!.guide;
    const labels = guide.phases.flatMap(phase => phase.steps).map(step => step.label);

    expect(labels.filter(label => label === 'Working tree clean')).toHaveLength(1);
    expect(labels).toContain('Someone smoke-tested it');
  });

  it('keeps the release gates on the stage that declares them', () => {
    const set = buildDeliveryStageRunbooks(baseInput());
    const labels = (name: string): string[] => set.runbooks
      .find(entry => entry.guide.stageName === name)!.guide.phases
      .flatMap(phase => phase.steps)
      .map(step => step.label);

    expect(labels('Production')).toEqual(expect.arrayContaining(['Prepare release version', 'Release notes / changelog']));
    expect(labels('Local')).not.toContain('Prepare release version');
    expect(labels('Local')).not.toContain('Release notes / changelog');
  });

  it('does not grade uncommitted local work as a blocker', () => {
    // A dirty tree is the ordinary state of working on your own machine. Grading
    // it red would leave the runbook a developer reads every day permanently
    // failing for doing its job — while a stage you promote *into* must still
    // treat it as one, because the artifact would not represent what is on disk.
    const set = buildDeliveryStageRunbooks({ ...baseInput(), workingTreeClean: false });
    const treeStep = (name: string) => set.runbooks
      .find(entry => entry.guide.stageName === name)!.guide.phases
      .flatMap(phase => phase.steps)
      .find(step => step.label === 'Working tree clean');

    expect(treeStep('Local')).toMatchObject({ status: 'manual', blocking: false });
    expect(treeStep('Production')).toMatchObject({ status: 'missing', blocking: true });
  });

  it('gives every step and column a key that names exactly one runbook', () => {
    // Ids repeat across stages by design; keys must not, or a run action would
    // resolve to whichever stage happened to be built first.
    const set = buildDeliveryStageRunbooks(baseInput());
    const stepKeys = set.runbooks.flatMap(entry => entry.guide.phases.flatMap(phase => phase.steps.map(step => step.key)));
    const phaseKeys = set.runbooks.flatMap(entry => entry.guide.phases.map(phase => phase.key));
    const stepIds = set.runbooks.flatMap(entry => entry.guide.phases.flatMap(phase => phase.steps.map(step => step.id)));

    expect(new Set(stepKeys).size).toBe(stepKeys.length);
    expect(new Set(phaseKeys).size).toBe(phaseKeys.length);
    // The property is only interesting because the ids genuinely do collide.
    expect(new Set(stepIds).size).toBeLessThan(stepIds.length);
  });

  it('returns a single unstaged runbook rather than inventing environments', () => {
    const set = buildDeliveryStageRunbooks({ files: ['package.json'], packageJson: PACKAGE_JSON });

    expect(set.staged).toBe(false);
    expect(set.runbooks).toHaveLength(1);
    expect(set.runbooks[0]!.guide.stageId).toBeUndefined();
    expect(set.runbooks[0]!.guide.stageName).toBe('Project');
    expect(set.selectedStageId).toBeUndefined();
    expect(set.selectionReason).toContain('No delivery pipeline is configured');
  });
});

describe('buildDeliveryStageRunbooks — which runbook opens', () => {
  it('opens on the stage the checked-out branch represents, and says so', () => {
    const set = buildDeliveryStageRunbooks({ ...baseInput(), currentBranch: 'develop' });

    expect(set.runbooks.find(entry => entry.guide.stageId === set.selectedStageId)?.guide.stageName).toBe('Integration');
    expect(set.selectionReason).toContain('develop');
    expect(set.selectionReason).toContain('Integration');
  });

  it('falls back to the first stage and reports the miss rather than implying a choice', () => {
    const set = buildDeliveryStageRunbooks({ ...baseInput(), currentBranch: 'feat/whatever' });

    expect(set.runbooks.find(entry => entry.guide.stageId === set.selectedStageId)?.guide.stageName).toBe('Local');
    expect(set.selectionReason).toContain('No stage claims feat/whatever');
  });
});

describe('deliveryStageRequirements', () => {
  it('reads requirements off the stage record and names the declared rule for each', () => {
    const config = pipeline();
    const production = config.stages.find(stage => stage.kind === 'production')!;
    const requirements = deliveryStageRequirements(production);
    const ruleIds = new Set(DELIVERY_STAGE_REQUIREMENT_RULES.map(rule => rule.id));

    expect(requirements.length).toBeGreaterThan(0);
    expect(requirements.every(entry => ruleIds.has(entry.ruleId))).toBe(true);
    expect(requirements.every(entry => entry.rule.length > 0)).toBe(true);
    expect(requirements.map(entry => entry.ruleId))
      .toEqual(expect.arrayContaining(['protected', 'approval', 'version-bump', 'changelog']));
  });

  it('never treats the local machine as a hosted target or a live data store', () => {
    const config = pipeline();
    const local = config.stages.find(stage => stage.kind === 'local')!;
    const ruleIds = deliveryStageRequirements(local).map(entry => entry.ruleId);

    expect(ruleIds).not.toContain('hosted-away');
    expect(ruleIds).not.toContain('live-data');
  });

  it('strips control characters out of workspace-authored stage text', () => {
    const config = pipeline();
    const production = config.stages.find(stage => stage.kind === 'production')!;
    production.promotionPolicy.requiredChecks = ['CI green'];
    production.rollbackPolicy.command = 'git\u001b[31m revert';

    const requirements = deliveryStageRequirements(production);
    expect(requirements.every(entry => !/[\u0000-\u001f\u007f]/.test(`${entry.label}${entry.detail}`))).toBe(true);
  });
});

describe('deliveryStageRequirementDeltas', () => {
  function requirement(ruleId: string, detail: string) {
    return { ruleId, rule: 'declared', kind: 'gate' as const, label: ruleId, detail };
  }

  it('separates what is new here from what is merely stricter here', () => {
    const deltas = deliveryStageRequirementDeltas(
      [requirement('approval', 'someone approves'), requirement('status-checks', 'CI, e2e')],
      [requirement('status-checks', 'CI')],
    );

    expect(deltas).toEqual([
      expect.objectContaining({ change: 'added', requirement: expect.objectContaining({ ruleId: 'approval' }) }),
      expect.objectContaining({ change: 'changed', previousDetail: 'CI' }),
    ]);
  });

  it('reports a requirement the stage below has and this one does not', () => {
    // The alarming direction, and the one a "what's new here" list would hide:
    // a rollback declared on Staging and absent on Production is a real finding.
    const deltas = deliveryStageRequirementDeltas(
      [requirement('approval', 'someone approves')],
      [requirement('approval', 'someone approves'), requirement('rollback', 'documented')],
    );

    expect(deltas).toEqual([
      expect.objectContaining({ change: 'dropped', requirement: expect.objectContaining({ ruleId: 'rollback' }) }),
    ]);
  });

  it('reports nothing when two stages declare the same requirements', () => {
    const same = [requirement('approval', 'someone approves')];
    expect(deliveryStageRequirementDeltas(same, same)).toEqual([]);
  });

  it('produces the same comparison every time it is asked', () => {
    // Comparability is the entire value of the surface: a difference derived in
    // March must equal one derived in July from the same pipeline file.
    const first = buildDeliveryStageRunbooks(baseInput());
    const second = buildDeliveryStageRunbooks(baseInput());
    expect(JSON.stringify(first.runbooks.map(entry => entry.deltas)))
      .toBe(JSON.stringify(second.runbooks.map(entry => entry.deltas)));
  });
});

describe('buildDeliveryStageRunbooks — bounded output', () => {
  it('caps the runbooks and states the remainder rather than dropping stages silently', () => {
    const config = pipeline();
    const template = config.stages[1]!;
    const extra: DeploymentStage[] = Array.from({ length: 10 }, (_, index) => ({
      ...template,
      id: `stage-extra-${index}`,
      name: `Extra ${index}`,
      rank: 10 + index,
    }));
    const set = buildDeliveryStageRunbooks({
      ...baseInput(),
      deliveryConfig: { ...config, stages: [...config.stages, ...extra] },
    });

    expect(set.runbooks).toHaveLength(8);
    expect(set.omittedStageCount).toBe(5);
  });
});
