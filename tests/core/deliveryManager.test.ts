import { describe, expect, it } from 'vitest';
import { seedDeliveryConfig, renderDeliveryMarkdown } from '../../src/core/deliveryManager.ts';

const PRODUCTION_STAGE = 'stage-production';
const STAGING_STAGE = 'stage-staging';

describe('seedDeliveryConfig — branch import', () => {
  it('uses the detected production branch verbatim (e.g. master, not main)', () => {
    const config = seedDeliveryConfig({
      currentBranch: 'develop',
      productionBranch: 'master',
      developBranch: 'develop',
      archetype: 'vscode-extension',
    });

    const production = config.stages.find(stage => stage.id === PRODUCTION_STAGE);
    const staging = config.stages.find(stage => stage.id === STAGING_STAGE);
    expect(production?.branchRef).toBe('master');
    expect(staging?.branchRef).toBe('develop');
  });

  it('does NOT fabricate "main" when no production branch is detected', () => {
    // Regression: a repo with only develop/master must never have a phantom
    // `main` invented for it. Detection failing → branchRef stays unset.
    const config = seedDeliveryConfig({
      currentBranch: 'develop',
      developBranch: 'develop',
      // productionBranch intentionally omitted (detection found none)
    });

    const production = config.stages.find(stage => stage.id === PRODUCTION_STAGE);
    expect(production?.branchRef).toBeUndefined();
  });

  it('falls back to the current branch for staging only when no develop branch exists', () => {
    const config = seedDeliveryConfig({
      currentBranch: 'trunk',
      productionBranch: 'master',
    });

    const staging = config.stages.find(stage => stage.id === STAGING_STAGE);
    expect(staging?.branchRef).toBe('trunk');
  });
});

describe('renderDeliveryMarkdown — branch label', () => {
  it('labels a branchless non-local stage "not detected", not "working tree"', () => {
    const config = seedDeliveryConfig({
      currentBranch: 'develop',
      developBranch: 'develop',
      // no productionBranch → production has no branchRef
    });

    const markdown = renderDeliveryMarkdown(config);
    expect(markdown).toContain('— (not detected)');
    // The local stage (genuinely branchless) keeps the working-tree label.
    expect(markdown).toContain('— (working tree)');
  });

  it('renders the detected production branch in a code span', () => {
    const config = seedDeliveryConfig({
      currentBranch: 'develop',
      productionBranch: 'master',
      developBranch: 'develop',
    });

    const markdown = renderDeliveryMarkdown(config);
    expect(markdown).toContain('`master`');
    expect(markdown).not.toContain('`main`');
  });
});
