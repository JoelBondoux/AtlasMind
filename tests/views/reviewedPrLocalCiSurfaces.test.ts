import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');
const dashboard = read('media/projectDashboard.js');
const dashboardHost = read('src/views/projectDashboardPanel.ts');
const settings = read('src/views/settingsPanel.ts');
const participant = read('src/chat/participant.ts');
const manifest = JSON.parse(read('package.json')) as {
  contributes?: {
    commands?: Array<{ command?: string }>;
    chatParticipants?: Array<{ commands?: Array<{ name?: string }> }>;
  };
};

describe('reviewed-PR local-CI surfaces', () => {
  it('surfaces patch and review on both Pipeline and Pull Requests', () => {
    expect(dashboard).toContain("data-action=\"pipeline-local-ci-patch\"");
    expect(dashboard).toContain("data-action=\"pipeline-local-ci-review\"");
    expect(dashboard).toContain('renderReviewedPrLocalCiCard(true, (snapshot.delivery || {}).reviewedPrLocalCi)');
    expect(dashboard).toContain('renderReviewedPrLocalCiCard(false, reviewedPr)');
    expect(dashboard).toContain('Codex, Claude, another proprietary agent interface');
  });

  /**
   * The card is driven by the host's reading of the folder, so its primary
   * button is the step the run command would otherwise fail on first — never a
   * fixed "Patch repository" on a repository that is already patched.
   */
  it('drives the card from the host-read state and names the folder and contract', () => {
    const card = dashboard.slice(
      dashboard.indexOf('function renderReviewedPrLocalCiCard('),
      dashboard.indexOf('function renderPullRequests('),
    );
    expect(card).toContain('switch (rp.nextAction)');
    for (const action of ['patch', 'open-contract', 'commit-managed-files', 'checkout-trusted-branch', 'repatch']) {
      expect(card).toContain(`case '${action}':`);
    }
    expect(card).toContain('rp.folderName');
    expect(card).toContain('rp.contractPath');
    expect(card).toContain('Open the contract to fix it');
    expect(card).toContain('What this does and does not do');
    // The webview opens the contract by a workspace-relative path through the
    // existing file action, and otherwise posts only the two allowlisted ids.
    expect(card).toContain('data-action="file" data-payload="${escapeAttr(rp.contractPath');
    expect(card).not.toContain('executeCommand');
    expect(card).not.toContain('postMessage');
  });

  it('collects the state host-side from files and git, never from the webview', () => {
    expect(dashboardHost).toContain('reviewedPrLocalCi: ReviewedPrLocalCiState;');
    expect(dashboardHost).toContain('async function collectReviewedPrLocalCiState(');
    expect(dashboardHost).toContain("'status', '--porcelain', '--', REVIEWED_PR_LOCAL_CI_CONFIG_PATH, REVIEWED_PR_LOCAL_CI_RUNNER_PATH, REVIEWED_PR_LOCAL_CI_WORKFLOW_PATH,");
    expect(dashboardHost).toContain('deriveReviewedPrLocalCiState({');
    // No `gh` in the collection: the state is a file-and-git fact.
    const collector = dashboardHost.slice(
      dashboardHost.indexOf('async function collectReviewedPrLocalCiState('),
      dashboardHost.indexOf('async function collectGitSnapshot('),
    );
    expect(collector).not.toContain('runGh');
  });

  it('lists the reviewed-PR route as its own executor on Rules with the two-route explainer', () => {
    expect(dashboard).toContain('function renderReviewedPrExecutorRow(');
    expect(dashboard).toContain('Run a reviewed pull request here');
    expect(dashboard).toContain('function renderLocalCiRoutesExplainer(');
    expect(dashboard).toContain('Two ways to use this computer for CI');
    expect(dashboard).toContain('Setting one up does not set up the other.');
    expect(dashboard).toContain("action === 'pipeline-dismiss-routes-explainer'");
  });

  it('surfaces the same host-owned actions on Settings → Testing', () => {
    expect(settings).toContain('id="reviewedPrLocalCiCard"');
    expect(settings).toContain("payload: 'patch'");
    expect(settings).toContain("payload: 'review'");
    expect(settings).toContain('findLocalCiSurfaceAction(message.payload)');
  });

  it('keeps arbitrary command ids out of both webview protocols', () => {
    expect(dashboardHost).toContain("type: 'runLocalCiSurfaceAction'; payload: LocalCiSurfaceActionId");
    expect(dashboardHost).toContain('findLocalCiSurfaceAction(candidate[\'payload\'])');
    expect(settings).toContain("type: 'runLocalCiSurfaceAction'; payload: LocalCiSurfaceActionId");
  });

  it('declares palette commands and deterministic slash aliases', () => {
    const palette = (manifest.contributes?.commands ?? []).map(item => item.command);
    const slash = (manifest.contributes?.chatParticipants ?? [])
      .flatMap(item => item.commands ?? [])
      .map(item => item.name);
    expect(palette).toContain('atlasmind.localCi.patchRepository');
    expect(palette).toContain('atlasmind.localCi.runReviewedPullRequest');
    expect(slash).toContain('localci-patch');
    expect(slash).toContain('localci-review');
    expect(participant).toContain("case 'localci-patch': await handleLocalCiCommand('patch'");
    expect(participant).toContain("case 'localci-review': await handleLocalCiCommand('review'");
  });

  /**
   * The rollup lists the checks that ran; a required check nobody posted is
   * not in it. The row and the Pipeline strip read the host-derived gap, so a
   * pull request blocked on AtlasMind/local-ci says so and offers the run.
   */
  it('shows a pull request blocked on an unposted required check and offers the reviewed-PR run', () => {
    expect(dashboard).toContain('function pullRequestCiState(pr, gap, reviewedPr)');
    expect(dashboard).toContain('function renderRequiredCheckGap(gap, reviewedPr)');
    expect(dashboard).toContain('blocked · required check ${named} not posted');
    expect(dashboard).toContain('required checks not read');
    // The Needs-you card is the host's ranked lead, rendered once at the top of Pipeline.
    expect(dashboard).toContain('function renderPipelineNeedsYou(attention, reviewedPr)');
    expect(dashboard).toContain('renderPipelineNeedsYou(delivery.attention, reviewedPr)');
    expect(dashboardHost).toContain('attention: derivePipelineAttention({');
    expect(dashboardHost).toContain('attention: PipelineAttention;');
    // Derived host-side from GitHub's own answers, never inferred in the browser.
    expect(dashboardHost).toContain('requiredCheckGaps?: RequiredCheckGap[];');
    expect(dashboardHost).toContain('deriveRequiredCheckGaps(input.pullRequests, input.requiredChecks ?? {}');
    expect(dashboardHost).toContain("`repos/${slug}/rules/branches/${ref}`");
    expect(dashboardHost).toContain("`repos/${slug}/branches/${ref}/protection`");
  });

  /**
   * "Check out dev" is now helped, not stated: the branch comes from the
   * committed contract re-read host-side, the switch is confirmed and refused
   * on a dirty working tree, and the webview posts no payload.
   */
  it('offers a confirmed checkout of the trusted branch that the host derives and guards', () => {
    expect(dashboard).toContain("vscode.postMessage({ type: 'checkoutReviewedPrTrustedBranch' })");
    expect(dashboard).toContain('data-action="pipeline-local-ci-checkout"');
    expect(dashboardHost).toContain("| { type: 'checkoutReviewedPrTrustedBranch' }");
    expect(dashboardHost).toContain("|| candidate['type'] === 'checkoutReviewedPrTrustedBranch'");
    const handler = dashboardHost.slice(
      dashboardHost.indexOf('private async handleCheckoutReviewedPrTrustedBranch('),
      dashboardHost.indexOf('private async handleCreateCiRoutingConfig('),
    );
    expect(handler).toContain('collectReviewedPrLocalCiState(workspaceRoot, currentBranch)');
    expect(handler).toContain("runGit(workspaceRoot, ['status', '--porcelain'])");
    expect(handler).toContain('Not switching:');
    expect(handler).toContain('modal: true');
    expect(handler).toContain("runGit(workspaceRoot, ['checkout', state.trustedBaseBranch, '--'])");
    // The branch is never taken from the message.
    expect(handler).not.toContain('message.payload');
  });
});
