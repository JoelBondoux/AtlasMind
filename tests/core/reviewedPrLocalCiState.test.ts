import { describe, expect, it } from 'vitest';
import {
  REVIEWED_PR_LOCAL_CI_MARKER,
  REVIEWED_PR_LOCAL_CI_STATUS_CONTEXT,
  REVIEWED_PR_LOCAL_CI_WORKFLOW_FILE,
  buildReviewedPrLocalCiRunnerScript,
  buildReviewedPrLocalCiWorkflow,
  type ReviewedPrLocalCiConfig,
} from '../../src/core/localCiRepositoryPatch.ts';
import {
  LOCAL_CI_ROUTES_EXPLAINER,
  REVIEWED_PR_NEXT_ACTIONS,
  deriveReviewedPrLocalCiState,
} from '../../src/core/reviewedPrLocalCiState.ts';

function config(): ReviewedPrLocalCiConfig {
  return {
    schemaVersion: 1,
    managedBy: REVIEWED_PR_LOCAL_CI_MARKER,
    enabled: true,
    repository: 'JoelBondoux/JoelBondouxNet',
    trustedBaseBranch: 'dev',
    workflowFile: REVIEWED_PR_LOCAL_CI_WORKFLOW_FILE,
    runnerLabel: 'atlasmind-reviewed-pr-x64',
    statusContext: REVIEWED_PR_LOCAL_CI_STATUS_CONTEXT,
    controllerNodeVersion: '22',
    evidence: 'linux-container',
    allowForks: false,
    commands: [{ label: 'Test', command: 'npm', args: ['test'], timeoutMinutes: 45 }],
    detection: { kind: 'node', packageManager: 'npm', detail: 'Detected npm.' },
  };
}

function ready(overrides: Partial<Parameters<typeof deriveReviewedPrLocalCiState>[0]> = {}) {
  return deriveReviewedPrLocalCiState({
    folderName: 'JoelBondouxNet',
    contractRaw: JSON.stringify(config()),
    runnerText: buildReviewedPrLocalCiRunnerScript(),
    workflowText: buildReviewedPrLocalCiWorkflow(config()),
    currentBranch: 'dev',
    managedStatus: '',
    ...overrides,
  });
}

describe('reviewed-PR local CI state', () => {
  it('reads a patched, committed checkout on the trusted branch as ready', () => {
    const state = ready();
    expect(state).toMatchObject({
      contract: 'enabled',
      repository: 'JoelBondoux/JoelBondouxNet',
      trustedBaseBranch: 'dev',
      statusContext: 'AtlasMind/local-ci',
      commandCount: 1,
      onTrustedBranch: true,
      managedFilesClean: true,
      managedFilesMatch: true,
      blockers: [],
      runnable: true,
      nextAction: 'review',
      nextActionRule: 'ready',
    });
    expect(state.headline).toBe('Ready to run a reviewed PR from JoelBondouxNet');
    expect(state.detail).toContain('posts the AtlasMind/local-ci check');
  });

  /**
   * Absent and disabled need different fixes — patch, versus open the file —
   * so they are different states, and both name the folder first.
   */
  it('tells an unpatched folder apart from a disabled contract', () => {
    const absent = deriveReviewedPrLocalCiState({ folderName: 'joelbondoux-platform', contractRaw: undefined, currentBranch: 'dev', managedStatus: '' });
    expect(absent).toMatchObject({ contract: 'absent', nextAction: 'patch', nextActionRule: 'contract-absent', runnable: false });
    expect(absent.headline).toBe('joelbondoux-platform is not patched for reviewed-PR local CI');
    expect(absent.blockers[0]).toContain('.atlasmind/local-ci.json is absent');

    const disabled = deriveReviewedPrLocalCiState({
      folderName: 'joelbondoux-platform',
      contractRaw: JSON.stringify({ ...config(), enabled: false, commands: [], detection: { kind: 'unknown', detail: 'No supported lockfile.' } }),
      currentBranch: 'dev',
      managedStatus: '',
    });
    expect(disabled).toMatchObject({ contract: 'disabled', nextAction: 'open-contract', nextActionRule: 'contract-unusable', runnable: false });
    expect(disabled.headline).toBe('The local-CI contract in joelbondoux-platform is disabled');
    expect(disabled.reason).toContain('declares no commands');

    const invalid = deriveReviewedPrLocalCiState({ folderName: 'x', contractRaw: '{not json', currentBranch: 'dev', managedStatus: '' });
    expect(invalid).toMatchObject({ contract: 'invalid', nextAction: 'open-contract' });
    expect(invalid.headline).toContain('cannot be read');
  });

  /** The blockers are the run command's own refusals, in its own order. */
  it('names uncommitted managed files, the wrong branch and drifted files as the command would', () => {
    const dirty = ready({ managedStatus: ' M .atlasmind/local-ci.json\n' });
    expect(dirty).toMatchObject({ managedFilesClean: false, runnable: false, nextAction: 'commit-managed-files', nextActionRule: 'managed-files-dirty' });
    expect(dirty.blockers[0]).toContain('uncommitted changes');

    const wrongBranch = ready({ currentBranch: 'feature/x' });
    expect(wrongBranch).toMatchObject({ onTrustedBranch: false, nextAction: 'checkout-trusted-branch', nextActionRule: 'wrong-branch' });
    expect(wrongBranch.blockers[0]).toContain('Check out the trusted base branch dev');
    expect(wrongBranch.blockers[0]).toContain('The current branch is feature/x');
    expect(ready({ currentBranch: '' }).blockers[0]).toContain('detached');

    const drifted = ready({ workflowText: '# edited by hand\n' });
    expect(drifted).toMatchObject({ managedFilesMatch: false, nextAction: 'repatch', nextActionRule: 'managed-files-drifted' });

    const missing = ready({ runnerText: undefined });
    expect(missing.managedFilesMatch).toBeUndefined();
    expect(missing).toMatchObject({ nextAction: 'repatch', runnable: false });
    expect(missing.blockers[0]).toContain('missing');

    // Dirty outranks branch: the command refuses it first, and committing is the fix that cannot wait.
    const both = ready({ managedStatus: '?? .atlasmind/local-ci-runner.mjs', currentBranch: 'main' });
    expect(both.nextAction).toBe('commit-managed-files');
    expect(both.blockers).toHaveLength(2);
  });

  /** Unknown is never clean. A git read that failed does not make the card read ready. */
  it('reports what git could not answer instead of assuming it', () => {
    const state = ready({ currentBranch: undefined, managedStatus: undefined });
    expect(state.onTrustedBranch).toBeUndefined();
    expect(state.managedFilesClean).toBeUndefined();
    expect(state.blockers).toEqual([]);
    expect(state.runnable).toBe(false);
    expect(state.headline).toContain('some checks could not be read');
    expect(state.detail).toContain('the current branch and whether the managed files are committed');
    // Nothing failed, so the offered action is still Run — the command re-checks.
    expect(state.nextAction).toBe('review');
  });

  it('publishes a next-action table that covers every action it can return', () => {
    const actions = new Set(REVIEWED_PR_NEXT_ACTIONS.map(row => row.action));
    for (const action of ['patch', 'open-contract', 'commit-managed-files', 'checkout-trusted-branch', 'repatch', 'review']) {
      expect(actions.has(action as never), action).toBe(true);
    }
    const rules = REVIEWED_PR_NEXT_ACTIONS.map(row => row.rule);
    expect(new Set(rules).size).toBe(rules.length);
  });

  it('keeps the two-route explainer naming both workflows\' difference', () => {
    expect(LOCAL_CI_ROUTES_EXPLAINER.reviewedPr).toContain('AtlasMind/local-ci');
    expect(LOCAL_CI_ROUTES_EXPLAINER.trustedBranch).toContain('every push');
    expect(LOCAL_CI_ROUTES_EXPLAINER.footer).toContain('different workflow files');
  });
});
