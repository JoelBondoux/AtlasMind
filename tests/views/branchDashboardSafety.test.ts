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
});
