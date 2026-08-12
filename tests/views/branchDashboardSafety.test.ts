import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const hostSource = readFileSync(
  path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'),
  'utf8',
);
const webviewSource = readFileSync(
  path.join(process.cwd(), 'media', 'projectDashboard.js'),
  'utf8',
);

function method(name: string, nextName: string): string {
  const start = hostSource.indexOf(`private async ${name}`);
  const end = hostSource.indexOf(`private async ${nextName}`, start + 1);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  expect(end, `${nextName} boundary not found`).toBeGreaterThan(start);
  return hostSource.slice(start, end);
}

describe('Branch Dashboard host authority', () => {
  it('re-resolves every branch workflow from an opaque id', () => {
    for (const name of [
      'handleInspectBranch',
      'handleOpenBranchChangeStory',
      'handleOpenBranchPullRequest',
      'handleReviewBranchCleanup',
      'handleBranchWorkflow',
    ]) {
      const start = hostSource.indexOf(`private async ${name}`);
      const body = hostSource.slice(start, start + 1_800);
      expect(body, name).toContain('resolveLiveBranchAction(');
    }
    expect(webviewSource).toContain("vscode.postMessage({ type: 'inspectBranch', payload });");
    expect(webviewSource).toContain("vscode.postMessage({ type: 'reviewBranchCleanup', payload });");
    expect(webviewSource).not.toContain("type: 'reviewBranchCleanup', payload: { branch:");
  });

  it('never force-deletes and protects remote cleanup with live identity plus typed confirmation', () => {
    const cleanup = method('handleReviewBranchCleanup', 'handleActivateBranch');

    expect(cleanup).toContain("['branch', '-d', '--', branch.localRef]");
    expect(cleanup).not.toContain("'branch', '-D'");
    expect(cleanup).not.toContain('reset --hard');
    expect(cleanup).toContain("'ls-remote'");
    expect(cleanup).toContain("liveHash.toLowerCase() !== selectedCommit.toLowerCase()");
    expect(cleanup).toContain('typed !== branch.name');
    expect(cleanup).toContain("'--delete'");
    expect(cleanup).toContain('gitIsAncestor');
    expect(cleanup).toContain('uniqueCommits === 0');
  });

  it('keeps changed paths host-side and sends only aggregate review evidence', () => {
    const inspect = method('handleInspectBranch', 'handleOpenBranchChangeStory');
    const payloadStart = inspect.indexOf("type: 'branchInspection'");
    const postedPayload = inspect.slice(payloadStart);

    expect(inspect).toContain('collectChangedPaths');
    expect(inspect).toContain('collectBranchOwnership');
    expect(postedPayload).not.toContain('changedPaths.paths,');
    expect(postedPayload).toContain('changedAreas');
    expect(postedPayload).toContain('impactCategories');
    expect(postedPayload).toContain('ownershipSummary');
  });

  it('opens a PR from the host-retained sanitized record, not a browser URL', () => {
    const openPullRequest = method('handleOpenBranchPullRequest', 'handleReviewBranchCleanup');
    expect(openPullRequest).toContain('this.pullRequestsState');
    expect(openPullRequest).toContain('/^https:\\/\\/github\\.com\\//i');
    expect(webviewSource).toContain("type: 'openBranchPullRequest', payload");
    expect(webviewSource).not.toContain("type: 'openBranchPullRequest', payload: pullRequest.url");
  });

  it('keeps write workflows bounded, reviewable, and non-force', () => {
    const workflow = method('handleBranchWorkflow', 'attachIdeationImages');

    expect(workflow).toContain('resolveLiveBranchAction(branchId)');
    expect(workflow).toContain("executeCommand('workbench.view.scm')");
    expect(workflow).not.toContain("['commit'");
    expect(workflow).toContain("['pull', '--ff-only']");
    expect(workflow).toContain("['push', '--porcelain', '--', remote, refspec]");
    expect(workflow).toContain("['branch', '--', branchName, sourceCommit]");
    expect(workflow).toContain("['check-ref-format', '--branch', branchName]");
    expect(workflow).not.toContain('--force');
    expect(workflow).not.toContain('reset --hard');
    expect(webviewSource).toContain("type: 'runBranchWorkflow'");
    expect(webviewSource).toContain('payload: { branchId: payload, action: workflow }');
  });

  it('assigns branch owners through current host tokens and fresh Git identity', () => {
    const assignment = method('handleAssignDashboardWorkOwner', 'handleDirectorSendComms');
    expect(assignment).toContain('this.dashboardWorkTargets.get(');
    expect(hostSource).toContain('token: `work-${randomUUID()}`');
    expect(assignment).toContain("target.kind === 'branch'");
    expect(assignment).toContain('resolveLiveBranchAction(target.branchId)');
    expect(assignment).toContain('live.branch.name !== target.stableId');
    expect(assignment).toContain("source: 'dashboard'");
    expect(assignment).toContain("executeCommand('atlasmind.refreshProjectState')");
    expect(webviewSource).toContain("type: 'assignDashboardWorkOwner'");
    expect(webviewSource).toContain('payload: { targetId: targetId, contactId: target.value }');
  });
});

describe('Branch Dashboard disclosure and emphasis', () => {
  const branchesRender = webviewSource.slice(
    webviewSource.indexOf('function renderBranches('),
    webviewSource.indexOf('function compareBranchCards(', webviewSource.indexOf('function renderBranches(')),
  );
  const cardRender = webviewSource.slice(
    webviewSource.indexOf('function renderBranchInventoryCard('),
    webviewSource.indexOf('function branchesGithubState(', webviewSource.indexOf('function renderBranchInventoryCard(')),
  );

  it('starts cards compact and keeps review details under only the inspected card', () => {
    expect(webviewSource).toContain('branchExpandedIds: []');
    expect(cardRender).toContain('data-action="branch-card-toggle"');
    expect(cardRender).toContain('aria-expanded="${expanded ? \'true\' : \'false\'}"');
    expect(cardRender).toContain('${expanded ? `');
    expect(cardRender).toContain('<span class="tag ${readinessClass}"');
    expect(cardRender).not.toContain('branch-readiness-button');
    expect(branchesRender).not.toContain('renderBranchInspection(state.branchInspection)');

    const cardClose = cardRender.indexOf('</article>');
    const inspection = cardRender.indexOf('${inspection ? renderBranchInspection(inspection) : \'\'}');
    expect(cardClose).toBeGreaterThan(-1);
    expect(inspection).toBeGreaterThan(cardClose);
  });

  it('offers bulk disclosure, explicit chronological direction, and branch-family grouping', () => {
    expect(branchesRender).toContain('data-action="branch-toggle-all"');
    expect(branchesRender).toContain("${allVisibleExpanded ? 'Collapse all' : 'Expand all'}");
    expect(branchesRender).toContain('id="branch-sort-direction-select"');
    expect(branchesRender).toContain("['branch-family', 'Branch family']");
    expect(webviewSource).toContain("return [['desc', 'Newest first'], ['asc', 'Oldest first']]");
    expect(webviewSource).toContain("grouping === 'branch-family'");
  });

  it('keeps the SCM-colour checkbox beside the cards and distinguishes local from remote refs', () => {
    expect(branchesRender).toContain('id="branch-scm-chip-toggle"');
    expect(branchesRender.indexOf('id="branch-scm-chip-toggle"'))
      .toBeGreaterThan(branchesRender.indexOf('${renderBranchComparison(state.branchComparison)}'));
    expect(branchesRender).toContain('Show SCM colours');
    expect(branchesRender).toContain('branch-title-chip is-local');
    expect(branchesRender).toContain('branch-title-chip is-remote');
    expect(webviewSource).toContain('branchScmChips: persistedWebviewState.branchScmChips !== false');
    expect(cardRender).toContain("branch.localRef ? 'is-local' : 'is-remote'");
    expect(hostSource).toContain('var(--vscode-charts-blue, var(--vscode-textLink-foreground, #3794ff))');
    expect(hostSource).toContain('var(--vscode-charts-purple, #b180d7)');
  });

  it('renders hard failures as critical and makes truncated commit subjects discoverable', () => {
    expect(cardRender).toContain("ci.state === 'fail' ? 'tag-critical'");
    expect(cardRender).toContain("readiness.level === 'blocked'");
    expect(cardRender).toContain("' has-failure'");
    expect(cardRender).toContain('class="branch-subject" title="${escapeAttr(subject)}"');
    expect(hostSource).toContain('-webkit-line-clamp: 1');
    expect(hostSource).toContain('.branch-inventory-card.has-failure');
  });

  it('groups daily write actions separately from branch review actions', () => {
    expect(cardRender).toContain('<span class="branch-action-label">Work</span>');
    expect(cardRender).toContain('<span class="branch-action-label">Review</span>');
    expect(cardRender).toContain("workflowButton('commit', '●', 'Commit'");
    expect(cardRender).toContain("workflowButton('pull', '↓', 'Pull'");
    expect(cardRender).toContain("workflowButton('push', '↑', branch.upstream ? 'Push' : 'Publish'");
    expect(cardRender).toContain("workflowButton('create-branch', '+⎇', 'Branch from here'");
    expect(cardRender).toContain("workflowButton('create-pull-request', '⇄', 'Create pull request'");
  });

  it('keeps the owner and icon actions in one flexible content column', () => {
    expect(cardRender).toContain('class="branch-action-content"');
    expect(cardRender).toContain('class="branch-card-actions branch-work-actions"');
    expect(cardRender).toContain('class="action-link branch-icon-action');
    expect(cardRender).toContain('aria-label="${escapeAttr(`${label}. ${title}`)}"');
    expect(hostSource).toContain('.branch-action-content {');
    expect(hostSource).toContain('flex: 0 0 36px;');
    expect(hostSource).toContain('width: 36px;');
    expect(hostSource).toContain('white-space: nowrap;');
  });
});

describe('Director ownership across dashboard work', () => {
  it('uses one shared picker on the principal actionable work surfaces', () => {
    for (const kind of ['branch', 'roadmap', 'issue', 'pull-request', 'gap', 'risk', 'debt', 'document']) {
      expect(webviewSource).toContain(`renderDirectorOwnerControl('${kind}'`);
    }
    expect(webviewSource).toContain("renderDirectorOwnerBadge('branch', branch.name)");
    expect(webviewSource).toContain('data-action="director-assign-work"');
    expect(webviewSource).toContain('entry.linkedWork.kind === kind');
    expect(webviewSource).toContain('Active dashboard work');
    expect(webviewSource).toContain('targets.map(target =>');
  });
});
