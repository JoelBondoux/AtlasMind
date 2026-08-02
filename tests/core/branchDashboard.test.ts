import { describe, expect, it } from 'vitest';

import {
  deriveBranchDashboard,
  matchBranchCodeowners,
  parseBranchCodeowners,
  type BranchDashboardBranch,
  type BranchDashboardPullRequest,
} from '../../src/core/branchDashboard.ts';

const branch = (over: Partial<BranchDashboardBranch> = {}): BranchDashboardBranch => ({
  id: 'local:refs/heads/feat/42-ready',
  name: 'feat/42-ready',
  localRef: 'feat/42-ready',
  remoteRef: 'origin/feat/42-ready',
  status: 'synced',
  current: false,
  default: false,
  protected: false,
  checkedOutElsewhere: false,
  mergedIntoCurrent: false,
  stale: false,
  ahead: 0,
  behind: 0,
  author: 'Ana',
  ...over,
});

const pullRequest = (over: Partial<BranchDashboardPullRequest> = {}): BranchDashboardPullRequest => ({
  number: 42,
  title: 'Ship readiness',
  state: 'open',
  author: 'ana',
  headRefName: 'feat/42-ready',
  baseRefName: 'develop',
  url: 'https://github.com/acme/widget/pull/42',
  isDraft: false,
  linkedIssues: [42],
  reviewDecision: 'approved',
  mergeable: 'mergeable',
  statusChecks: [{ name: 'test', status: 'completed', conclusion: 'success' }],
  requestedReviewers: [],
  updatedAt: '2026-08-02T10:00:00.000Z',
  ...over,
});

const derive = (over: Partial<Parameters<typeof deriveBranchDashboard>[0]> = {}) =>
  deriveBranchDashboard({
    branches: [branch()],
    pullRequests: [pullRequest()],
    issuesLoaded: true,
    issues: [{ number: 42, title: 'Add branch intelligence', state: 'open' }],
    roadmapItems: [{ id: 'roadmap-1', text: 'Ship branch intelligence #42', completed: false }],
    reviewComments: {},
    viewerLogin: 'ana',
    gitUserName: 'Ana',
    ...over,
  });

describe('deriveBranchDashboard', () => {
  it('calls a branch ready only when PR, approval, CI, mergeability, and drift evidence agree', () => {
    const result = derive();
    const insight = result.insights['local:refs/heads/feat/42-ready']!;

    expect(insight.readiness.level).toBe('ready');
    expect(insight.pullRequest).toMatchObject({
      number: 42,
      reviewDecision: 'approved',
      mergeable: 'mergeable',
    });
    expect(insight.ci).toMatchObject({ state: 'pass', source: 'pull-request-checks' });
    expect(insight.traceability).toMatchObject({
      state: 'linked',
      issueNumbers: [42],
      roadmapItemIds: ['roadmap-1'],
    });
    expect(insight.savedViews).toEqual(expect.arrayContaining(['mine', 'ready']));
    expect(result.readyCount).toBe(1);
  });

  it('lets a deterministic blocker outrank otherwise positive evidence', () => {
    const result = derive({
      branches: [branch({ status: 'diverged' })],
      pullRequests: [pullRequest({
        reviewDecision: 'changes-requested',
        mergeable: 'conflicting',
        statusChecks: [{ name: 'test', status: 'completed', conclusion: 'failure' }],
      })],
      reviewComments: { '42': [{ resolved: false }] },
    });
    const insight = result.insights['local:refs/heads/feat/42-ready']!;

    expect(insight.readiness.level).toBe('blocked');
    expect(insight.readiness.reasons.filter(reason => reason.level === 'blocker').map(reason => reason.label))
      .toEqual(expect.arrayContaining([
        'Diverged',
        'Merge conflicts',
        'Changes requested',
        'Unresolved review comments',
        'CI failing',
      ]));
    expect(insight.savedViews).toContain('ci-failing');
    expect(result.blockedCount).toBe(1);
  });

  it('reports unloaded remote evidence as unknown instead of clean', () => {
    const result = derive({
      pullRequests: undefined,
      issuesLoaded: false,
      issues: [],
      roadmapItems: [],
    });
    const insight = result.insights['local:refs/heads/feat/42-ready']!;

    expect(insight.readiness.level).toBe('attention');
    expect(insight.ci.state).toBe('unknown');
    expect(insight.traceability.state).toBe('not-assessed');
    expect(insight.readiness.reasons.map(reason => reason.label))
      .toEqual(expect.arrayContaining(['Pull requests not loaded', 'CI not loaded']));
  });

  it('preserves declared PR and roadmap links when issue details are unavailable', () => {
    const result = derive({
      issuesLoaded: false,
      issues: [],
      roadmapItems: [{ id: 'roadmap-1', text: 'Release follow-up — branch: feat/42-ready', completed: false }],
    });

    expect(result.insights['local:refs/heads/feat/42-ready']!.traceability).toMatchObject({
      state: 'linked',
      issueNumbers: [42],
      issueTitles: [],
      roadmapItemIds: ['roadmap-1'],
    });
  });

  it('builds My branches and Needs my review from authenticated identities', () => {
    const result = derive({
      branches: [branch({ author: 'Someone Else' })],
      pullRequests: [pullRequest({ author: 'other', requestedReviewers: ['ANA'] })],
    });
    const insight = result.insights['local:refs/heads/feat/42-ready']!;

    expect(insight.isMine).toBe(false);
    expect(insight.needsMyReview).toBe(true);
    expect(insight.savedViews).toContain('needs-my-review');
    expect(result.needsMyReviewCount).toBe(1);
  });

  it('marks a stale merged branch as a cleanup candidate but never a protected branch', () => {
    const candidate = branch({
      id: 'local:refs/heads/old',
      name: 'old',
      stale: true,
      mergedIntoCurrent: true,
    });
    const protectedCandidate = branch({
      id: 'local:refs/heads/release/1',
      name: 'release/1',
      stale: true,
      mergedIntoCurrent: true,
      protected: true,
    });
    const result = derive({
      branches: [candidate, protectedCandidate],
      pullRequests: [],
      issues: [],
      roadmapItems: [],
    });

    expect(result.insights[candidate.id]!.cleanup.candidate).toBe(true);
    expect(result.insights[protectedCandidate.id]!.cleanup.candidate).toBe(false);
    expect(result.cleanupCount).toBe(1);
  });

  it('labels branch-name issue matching as inference, never declared linkage', () => {
    const result = derive({
      pullRequests: [],
      issues: [{ number: 42, title: 'Tracked work', state: 'open' }],
      roadmapItems: [],
    });

    expect(result.insights['local:refs/heads/feat/42-ready']!.traceability)
      .toMatchObject({ state: 'inferred', issueNumbers: [42] });
  });
});

describe('CODEOWNERS review routing', () => {
  it('uses the last matching rule and distinguishes unmatched paths', () => {
    const parsed = parseBranchCodeowners([
      '* @fallback',
      '/src/** @platform',
      '/src/security/** @security @platform',
    ].join('\n'));
    const match = matchBranchCodeowners(parsed, [
      'src/core/router.ts',
      'src/security/policy.ts',
      'README.md',
    ]);

    expect(match.owners).toEqual(['@platform', '@fallback', '@security']);
    expect(match.matchedPathCount).toBe(3);
    expect(match.unmatchedPathCount).toBe(0);
    expect(match.rules).toEqual(expect.arrayContaining([
      { pattern: '/src/**', owners: ['@platform'], matchedPathCount: 1 },
      { pattern: '/src/security/**', owners: ['@security', '@platform'], matchedPathCount: 1 },
    ]));
  });

  it('ignores unusable rules rather than guessing ownership', () => {
    const parsed = parseBranchCodeowners('!secret/** @security\nescaped\\ path @team\nsrc/** nobody');
    expect(parsed.rules).toEqual([]);
    expect(parsed.ignoredLines).toEqual([1, 2, 3]);
  });
});
