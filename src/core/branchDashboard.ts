/**
 * Deterministic branch-dashboard intelligence.
 *
 * This module deliberately consumes facts that other boundaries already
 * sanitized: local Git branch metadata, GitHub pull-request/check summaries,
 * issue ids, and roadmap text. It never runs Git, calls GitHub, opens a model,
 * or mutates a branch. Keeping the verdict here makes "Ready", "Blocked", and
 * every saved view comparable across renders instead of leaving them to UI
 * wording or model judgement.
 */

export type BranchReadinessLevel = 'ready' | 'attention' | 'blocked' | 'baseline' | 'retired';
export type BranchCiState = 'pass' | 'fail' | 'pending' | 'none' | 'unknown';
export type BranchTraceabilityState = 'linked' | 'inferred' | 'missing' | 'not-assessed';
export type BranchSavedView =
  | 'mine'
  | 'needs-my-review'
  | 'ready'
  | 'ci-failing'
  | 'cleanup';

export interface BranchDashboardBranch {
  id: string;
  name: string;
  localRef?: string;
  remoteRef?: string;
  status: string;
  current: boolean;
  default: boolean;
  protected: boolean;
  checkedOutElsewhere: boolean;
  mergedIntoCurrent: boolean;
  stale: boolean;
  ahead: number;
  behind: number;
  author: string;
}

export interface BranchDashboardStatusCheck {
  name: string;
  status: string;
  conclusion: string;
  url?: string;
}

export interface BranchDashboardPullRequest {
  number: number;
  title: string;
  state: string;
  author: string;
  headRefName: string;
  baseRefName: string;
  url: string;
  isDraft: boolean;
  linkedIssues: number[];
  reviewDecision?: 'approved' | 'changes-requested' | 'review-required' | 'unknown';
  mergeable?: 'mergeable' | 'conflicting' | 'unknown';
  statusChecks?: BranchDashboardStatusCheck[];
  requestedReviewers?: string[];
  updatedAt: string;
}

export interface BranchDashboardCiRun {
  headBranch?: string;
  workflowName: string;
  conclusion: string;
  status: string;
  updatedAt: string;
}

export interface BranchDashboardIssue {
  number: number;
  title: string;
  state: string;
}

export interface BranchDashboardRoadmapItem {
  id: string;
  text: string;
  completed: boolean;
}

export interface BranchReadinessReason {
  level: 'blocker' | 'attention' | 'clear' | 'note';
  label: string;
  detail: string;
}

export interface BranchPullRequestInsight {
  number: number;
  title: string;
  state: string;
  author: string;
  baseRefName: string;
  url: string;
  reviewDecision: 'approved' | 'changes-requested' | 'review-required' | 'unknown';
  mergeable: 'mergeable' | 'conflicting' | 'unknown';
  requestedReviewers: string[];
  unresolvedReviewComments: number;
}

export interface BranchCiInsight {
  state: BranchCiState;
  label: string;
  total: number;
  passed: number;
  failed: number;
  pending: number;
  source: 'pull-request-checks' | 'workflow-runs' | 'not-loaded';
}

export interface BranchTraceabilityInsight {
  state: BranchTraceabilityState;
  issueNumbers: number[];
  issueTitles: string[];
  roadmapItemIds: string[];
  roadmapItems: string[];
  summary: string;
}

export interface BranchCleanupInsight {
  candidate: boolean;
  summary: string;
}

export interface BranchDashboardInsight {
  readiness: {
    level: BranchReadinessLevel;
    label: string;
    summary: string;
    reasons: BranchReadinessReason[];
  };
  pullRequest?: BranchPullRequestInsight;
  ci: BranchCiInsight;
  traceability: BranchTraceabilityInsight;
  cleanup: BranchCleanupInsight;
  isMine: boolean;
  needsMyReview: boolean;
  savedViews: BranchSavedView[];
  riskRank: number;
}

export interface DeriveBranchDashboardInput {
  branches: readonly BranchDashboardBranch[];
  pullRequests?: readonly BranchDashboardPullRequest[];
  ciRuns?: readonly BranchDashboardCiRun[];
  issuesLoaded: boolean;
  issues: readonly BranchDashboardIssue[];
  roadmapItems: readonly BranchDashboardRoadmapItem[];
  reviewComments?: Readonly<Record<string, readonly { resolved: boolean }[]>>;
  viewerLogin?: string;
  gitUserName?: string;
}

export interface DerivedBranchDashboard {
  insights: Record<string, BranchDashboardInsight>;
  readyCount: number;
  blockedCount: number;
  cleanupCount: number;
  mineCount: number;
  needsMyReviewCount: number;
  ciFailingCount: number;
}

const PASS_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);
const FAIL_CONCLUSIONS = new Set([
  'failure',
  'cancelled',
  'timed_out',
  'action_required',
  'startup_failure',
  'stale',
]);

/** Build all card verdicts and built-in saved-view membership in one pass. */
export function deriveBranchDashboard(input: DeriveBranchDashboardInput): DerivedBranchDashboard {
  const pullRequests = input.pullRequests ?? [];
  const byHead = new Map<string, BranchDashboardPullRequest[]>();
  for (const pullRequest of pullRequests) {
    const key = normalizeRef(pullRequest.headRefName);
    const current = byHead.get(key) ?? [];
    current.push(pullRequest);
    byHead.set(key, current);
  }

  const insights: Record<string, BranchDashboardInsight> = {};
  for (const branch of input.branches) {
    const matchingPullRequests = (byHead.get(normalizeRef(branch.name)) ?? [])
      .slice()
      .sort((left, right) =>
        pullRequestStateRank(left) - pullRequestStateRank(right)
        || (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0)
        || right.number - left.number);
    const pullRequest = matchingPullRequests[0];
    const insight = deriveBranchInsight(branch, pullRequest, input);
    insights[branch.id] = insight;
  }

  const values = Object.values(insights);
  return {
    insights,
    readyCount: values.filter(value => value.readiness.level === 'ready').length,
    blockedCount: values.filter(value => value.readiness.level === 'blocked').length,
    cleanupCount: values.filter(value => value.cleanup.candidate).length,
    mineCount: values.filter(value => value.isMine).length,
    needsMyReviewCount: values.filter(value => value.needsMyReview).length,
    ciFailingCount: values.filter(value => value.ci.state === 'fail').length,
  };
}

function deriveBranchInsight(
  branch: BranchDashboardBranch,
  pullRequest: BranchDashboardPullRequest | undefined,
  input: DeriveBranchDashboardInput,
): BranchDashboardInsight {
  const ci = deriveCiInsight(branch, pullRequest, input.ciRuns);
  const traceability = deriveTraceability(branch, pullRequest, input);
  const reviewDecision = pullRequest?.reviewDecision ?? deriveReviewDecision(pullRequest);
  const mergeable = pullRequest?.mergeable ?? 'unknown';
  const requestedReviewers = uniqueNames(pullRequest?.requestedReviewers ?? []);
  const unresolvedReviewComments = pullRequest
    ? (input.reviewComments?.[String(pullRequest.number)] ?? []).filter(comment => !comment.resolved).length
    : 0;
  const pullRequestInsight = pullRequest
    ? {
      number: pullRequest.number,
      title: pullRequest.title,
      state: pullRequest.isDraft ? 'draft' : pullRequest.state,
      author: pullRequest.author,
      baseRefName: pullRequest.baseRefName,
      url: pullRequest.url,
      reviewDecision,
      mergeable,
      requestedReviewers,
      unresolvedReviewComments,
    } satisfies BranchPullRequestInsight
    : undefined;
  const readiness = deriveReadiness(
    branch,
    pullRequestInsight,
    ci,
    traceability,
    input.pullRequests !== undefined,
  );
  const cleanup = deriveCleanup(branch, pullRequestInsight);
  const viewer = normalizeIdentity(input.viewerLogin);
  const gitUser = normalizeIdentity(input.gitUserName);
  const isMine = Boolean(
    (viewer && normalizeIdentity(pullRequest?.author) === viewer)
    || (gitUser && normalizeIdentity(branch.author) === gitUser),
  );
  const needsMyReview = Boolean(
    viewer
    && requestedReviewers.some(reviewer => normalizeIdentity(reviewer) === viewer)
    && pullRequestInsight
    && (pullRequestInsight.state === 'open' || pullRequestInsight.state === 'draft'),
  );
  const savedViews: BranchSavedView[] = [];
  if (isMine) savedViews.push('mine');
  if (needsMyReview) savedViews.push('needs-my-review');
  if (readiness.level === 'ready') savedViews.push('ready');
  if (ci.state === 'fail') savedViews.push('ci-failing');
  if (cleanup.candidate) savedViews.push('cleanup');

  return {
    readiness,
    ...(pullRequestInsight ? { pullRequest: pullRequestInsight } : {}),
    ci,
    traceability,
    cleanup,
    isMine,
    needsMyReview,
    savedViews,
    riskRank: readinessRiskRank(readiness.level)
      + (ci.state === 'fail' ? 30 : ci.state === 'pending' ? 10 : 0)
      + (branch.behind * 2)
      + (branch.stale ? 8 : 0)
      + unresolvedReviewComments,
  };
}

function deriveCiInsight(
  branch: BranchDashboardBranch,
  pullRequest: BranchDashboardPullRequest | undefined,
  runs: readonly BranchDashboardCiRun[] | undefined,
): BranchCiInsight {
  const checks = pullRequest?.statusChecks ?? [];
  if (checks.length > 0) {
    const states = checks.map(check => checkState(check.status, check.conclusion));
    return ciInsightFromStates(states, 'pull-request-checks');
  }
  if (runs === undefined) {
    return {
      state: 'unknown',
      label: 'CI not loaded',
      total: 0,
      passed: 0,
      failed: 0,
      pending: 0,
      source: 'not-loaded',
    };
  }
  const branchRuns = latestWorkflowRuns(
    runs.filter(run => normalizeRef(run.headBranch ?? '') === normalizeRef(branch.name)),
  );
  if (branchRuns.length === 0) {
    return {
      state: 'none',
      label: 'No recent CI',
      total: 0,
      passed: 0,
      failed: 0,
      pending: 0,
      source: 'workflow-runs',
    };
  }
  return ciInsightFromStates(
    branchRuns.map(run => checkState(run.status, run.conclusion)),
    'workflow-runs',
  );
}

function ciInsightFromStates(
  states: BranchCiState[],
  source: 'pull-request-checks' | 'workflow-runs',
): BranchCiInsight {
  const failed = states.filter(state => state === 'fail').length;
  const pending = states.filter(state => state === 'pending').length;
  const passed = states.filter(state => state === 'pass').length;
  const state: BranchCiState = failed > 0 ? 'fail' : pending > 0 ? 'pending' : passed > 0 ? 'pass' : 'none';
  const label = state === 'fail'
    ? `${failed} CI failure${failed === 1 ? '' : 's'}`
    : state === 'pending'
      ? `${pending} CI check${pending === 1 ? '' : 's'} pending`
      : state === 'pass'
        ? `${passed} CI check${passed === 1 ? '' : 's'} passed`
        : 'No recent CI';
  return { state, label, total: states.length, passed, failed, pending, source };
}

function deriveTraceability(
  branch: BranchDashboardBranch,
  pullRequest: BranchDashboardPullRequest | undefined,
  input: DeriveBranchDashboardInput,
): BranchTraceabilityInsight {
  const issuesByNumber = new Map(input.issues.map(issue => [issue.number, issue]));
  // A pull request's closing-issue declaration remains evidence even when the
  // issue list could not be loaded. Titles are enriched only when issue records
  // are available; the declared relationship itself must not disappear.
  const declaredIssues = uniqueNumbers(pullRequest?.linkedIssues ?? []);
  const inferredIssue = declaredIssues.length === 0
    ? inferIssueNumber(branch.name, issuesByNumber)
    : undefined;
  const issueNumbers = declaredIssues.length > 0
    ? declaredIssues
    : inferredIssue === undefined ? [] : [inferredIssue];
  const roadmapItems = input.roadmapItems.filter(item =>
    issueNumbers.some(number => new RegExp(`(^|\\s)#${number}(?=\\s|$|[),.;:])`).test(item.text))
    || explicitlyNamesBranch(item.text, branch.name));
  const issueTitles = issueNumbers.flatMap(number => {
    const issue = issuesByNumber.get(number);
    return issue ? [`#${number} ${issue.title}`] : [];
  });
  const explicitRoadmapLink = roadmapItems.some(item => explicitlyNamesBranch(item.text, branch.name));
  if (declaredIssues.length > 0 || explicitRoadmapLink) {
    return {
      state: 'linked',
      issueNumbers,
      issueTitles,
      roadmapItemIds: roadmapItems.map(item => item.id),
      roadmapItems: roadmapItems.map(item => item.text),
      summary: traceabilitySummary(issueNumbers, roadmapItems.length, 'Declared linkage'),
    };
  }
  if (!input.issuesLoaded && pullRequest === undefined) {
    return {
      state: 'not-assessed',
      issueNumbers: [],
      issueTitles: [],
      roadmapItemIds: roadmapItems.map(item => item.id),
      roadmapItems: roadmapItems.map(item => item.text),
      summary: roadmapItems.length > 0
        ? `${roadmapItems.length} roadmap reference${roadmapItems.length === 1 ? '' : 's'}; GitHub traceability not loaded.`
        : 'GitHub traceability has not been loaded.',
    };
  }
  if (inferredIssue !== undefined) {
    return {
      state: 'inferred',
      issueNumbers,
      issueTitles,
      roadmapItemIds: roadmapItems.map(item => item.id),
      roadmapItems: roadmapItems.map(item => item.text),
      summary: traceabilitySummary(issueNumbers, roadmapItems.length, 'Branch-name inference'),
    };
  }
  return {
    state: 'missing',
    issueNumbers: [],
    issueTitles: [],
    roadmapItemIds: roadmapItems.map(item => item.id),
    roadmapItems: roadmapItems.map(item => item.text),
    summary: roadmapItems.length > 0
      ? `${roadmapItems.length} roadmap reference${roadmapItems.length === 1 ? '' : 's'}, but no issue link.`
      : 'No issue or roadmap link was found.',
  };
}

function deriveReadiness(
  branch: BranchDashboardBranch,
  pullRequest: BranchPullRequestInsight | undefined,
  ci: BranchCiInsight,
  traceability: BranchTraceabilityInsight,
  pullRequestsLoaded: boolean,
): BranchDashboardInsight['readiness'] {
  if (branch.default) {
    return {
      level: 'baseline',
      label: 'Baseline',
      summary: 'This is the repository baseline, so review readiness does not apply.',
      reasons: [{ level: 'note', label: 'Default branch', detail: 'Review other branches against this baseline.' }],
    };
  }
  if (branch.mergedIntoCurrent && pullRequest?.state === 'merged') {
    return {
      level: 'retired',
      label: 'Merged',
      summary: 'The linked pull request is merged and the branch is contained by the current branch.',
      reasons: [{ level: 'clear', label: 'Merged work', detail: 'This branch is a cleanup candidate after final safety checks.' }],
    };
  }

  const reasons: BranchReadinessReason[] = [];
  if (branch.status === 'diverged') {
    reasons.push({ level: 'blocker', label: 'Diverged', detail: 'The local and upstream histories both contain unique commits.' });
  } else if (branch.status === 'upstream-gone') {
    reasons.push({ level: 'blocker', label: 'Upstream gone', detail: 'The configured upstream no longer exists in cached remote refs.' });
  } else if (branch.status === 'name-conflict') {
    reasons.push({ level: 'blocker', label: 'Name conflict', detail: 'A different local branch already uses this remote branch name.' });
  }
  if (pullRequest?.mergeable === 'conflicting') {
    reasons.push({ level: 'blocker', label: 'Merge conflicts', detail: 'GitHub reports the linked pull request as conflicting.' });
  }
  if (pullRequest?.reviewDecision === 'changes-requested') {
    reasons.push({ level: 'blocker', label: 'Changes requested', detail: 'At least one required review is not satisfied.' });
  }
  if ((pullRequest?.unresolvedReviewComments ?? 0) > 0) {
    reasons.push({
      level: 'blocker',
      label: 'Unresolved review comments',
      detail: `${pullRequest!.unresolvedReviewComments} loaded review comment${pullRequest!.unresolvedReviewComments === 1 ? ' is' : 's are'} unresolved.`,
    });
  }
  if (ci.state === 'fail') {
    reasons.push({ level: 'blocker', label: 'CI failing', detail: ci.label });
  }

  if (branch.behind > 0) {
    reasons.push({ level: 'attention', label: 'Behind upstream', detail: `${branch.behind} upstream commit${branch.behind === 1 ? '' : 's'} are missing locally.` });
  }
  if (branch.stale) {
    reasons.push({ level: 'attention', label: 'Stale activity', detail: 'The latest commit is older than the dashboard staleness threshold.' });
  }
  if (!pullRequest && pullRequestsLoaded) {
    reasons.push({ level: 'attention', label: 'No pull request', detail: 'No loaded pull request has this branch as its head.' });
  } else if (!pullRequest && !pullRequestsLoaded) {
    reasons.push({ level: 'attention', label: 'Pull requests not loaded', detail: 'Refresh GitHub activity before treating this as a readiness decision.' });
  } else if (pullRequest?.state === 'draft') {
    reasons.push({ level: 'attention', label: 'Draft pull request', detail: 'The linked pull request is still marked draft.' });
  } else if (pullRequest?.state === 'closed') {
    reasons.push({ level: 'attention', label: 'Pull request closed', detail: 'The linked pull request closed without merging.' });
  }
  if (pullRequest && pullRequest.reviewDecision !== 'approved') {
    reasons.push({
      level: 'attention',
      label: pullRequest.reviewDecision === 'review-required' ? 'Review required' : 'Approval not observed',
      detail: 'The loaded review state does not contain an approval verdict.',
    });
  }
  if (ci.state === 'pending') {
    reasons.push({ level: 'attention', label: 'CI pending', detail: ci.label });
  } else if (ci.state === 'none' || ci.state === 'unknown') {
    reasons.push({
      level: 'attention',
      label: ci.state === 'unknown' ? 'CI not loaded' : 'No recent CI',
      detail: 'A passing check result is not available for this branch.',
    });
  }
  if (traceability.state === 'missing') {
    reasons.push({ level: 'attention', label: 'Traceability gap', detail: traceability.summary });
  }

  const blockers = reasons.filter(reason => reason.level === 'blocker');
  if (blockers.length > 0) {
    return {
      level: 'blocked',
      label: 'Blocked',
      summary: blockers.map(reason => reason.label).join(' · '),
      reasons,
    };
  }
  const ready = Boolean(
    pullRequest
    && pullRequest.state === 'open'
    && pullRequest.reviewDecision === 'approved'
    && pullRequest.mergeable !== 'conflicting'
    && ci.state === 'pass'
    && branch.behind === 0,
  );
  if (ready) {
    return {
      level: 'ready',
      label: 'Ready for review',
      summary: 'Open pull request, approval, passing CI, and no deterministic blocker are present.',
      reasons: [
        { level: 'clear', label: 'Review satisfied', detail: 'The linked pull request is approved.' },
        { level: 'clear', label: 'CI passing', detail: ci.label },
        ...reasons,
      ],
    };
  }
  return {
    level: 'attention',
    label: branch.current ? 'Active work' : 'Needs attention',
    summary: reasons[0]?.detail ?? 'No blocker was found, but the ready-for-review rule is not satisfied.',
    reasons,
  };
}

function deriveCleanup(
  branch: BranchDashboardBranch,
  pullRequest: BranchPullRequestInsight | undefined,
): BranchCleanupInsight {
  if (branch.current) {
    return { candidate: false, summary: 'The current branch cannot be cleaned up.' };
  }
  if (branch.default || branch.protected) {
    return { candidate: false, summary: 'Default and protected branches are never cleanup candidates.' };
  }
  if (branch.checkedOutElsewhere) {
    return { candidate: false, summary: 'The branch is active in another worktree.' };
  }
  if (pullRequest && (pullRequest.state === 'open' || pullRequest.state === 'draft')) {
    return { candidate: false, summary: `Pull request #${pullRequest.number} is still open.` };
  }
  const candidate = branch.mergedIntoCurrent
    || branch.status === 'upstream-gone'
    || branch.stale
    || pullRequest?.state === 'merged';
  return {
    candidate,
    summary: candidate
      ? 'Candidate only: AtlasMind will re-check unique commits, production containment, open PRs, protection, worktrees, and the live remote before deletion.'
      : 'No merged, stale, or gone-upstream cleanup signal is present.',
  };
}

function pullRequestStateRank(pullRequest: BranchDashboardPullRequest): number {
  if (pullRequest.isDraft || pullRequest.state === 'draft') return 1;
  if (pullRequest.state === 'open') return 0;
  if (pullRequest.state === 'merged') return 2;
  return 3;
}

function deriveReviewDecision(
  pullRequest: BranchDashboardPullRequest | undefined,
): 'approved' | 'changes-requested' | 'review-required' | 'unknown' {
  if (!pullRequest) return 'unknown';
  return pullRequest.isDraft ? 'review-required' : 'unknown';
}

function checkState(status: string, conclusion: string): BranchCiState {
  const normalizedStatus = status.trim().toLowerCase();
  const normalizedConclusion = conclusion.trim().toLowerCase();
  if (normalizedStatus && !['completed', 'complete'].includes(normalizedStatus)) return 'pending';
  if (!normalizedConclusion) return 'pending';
  if (PASS_CONCLUSIONS.has(normalizedConclusion)) return 'pass';
  if (FAIL_CONCLUSIONS.has(normalizedConclusion)) return 'fail';
  return 'pending';
}

function latestWorkflowRuns(runs: readonly BranchDashboardCiRun[]): BranchDashboardCiRun[] {
  const byWorkflow = new Map<string, BranchDashboardCiRun>();
  for (const run of runs) {
    const key = run.workflowName || '(unnamed workflow)';
    const previous = byWorkflow.get(key);
    if (!previous || (Date.parse(run.updatedAt) || 0) > (Date.parse(previous.updatedAt) || 0)) {
      byWorkflow.set(key, run);
    }
  }
  return [...byWorkflow.values()];
}

function normalizeRef(value: string): string {
  return value
    .trim()
    .replace(/^refs\/heads\//i, '')
    .replace(/^refs\/remotes\/[^/]+\//i, '')
    .replace(/^[^/]+\//, match => /^(origin|upstream|fork)\//i.test(match) ? '' : match)
    .toLowerCase();
}

function normalizeIdentity(value: string | undefined): string {
  return (value ?? '').trim().replace(/^@/, '').toLowerCase();
}

function uniqueNames(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = value.trim().replace(/^@/, '').slice(0, 100);
    const key = clean.toLowerCase();
    if (clean && !seen.has(key)) {
      seen.add(key);
      out.push(clean);
    }
  }
  return out.slice(0, 30);
}

function uniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values.filter(value => Number.isSafeInteger(value) && value > 0))].slice(0, 30);
}

function inferIssueNumber(
  branchName: string,
  issues: ReadonlyMap<number, BranchDashboardIssue>,
): number | undefined {
  const matches = branchName.matchAll(/(?:^|[/_-])(?:issue[-_])?(\d{1,7})(?=$|[/_-])/gi);
  for (const match of matches) {
    const number = Number(match[1]);
    if (issues.has(number)) return number;
  }
  return undefined;
}

function explicitlyNamesBranch(text: string, branchName: string): boolean {
  const escaped = branchName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)branch\\s*:\\s*(?:\`${escaped}\`|${escaped})(?=$|\\s|[),.;])`, 'i').test(text);
}

function traceabilitySummary(
  issueNumbers: readonly number[],
  roadmapCount: number,
  prefix: string,
): string {
  const issueText = `${issueNumbers.length} issue${issueNumbers.length === 1 ? '' : 's'}`;
  const roadmapText = `${roadmapCount} roadmap item${roadmapCount === 1 ? '' : 's'}`;
  return `${prefix}: ${issueText}, ${roadmapText}.`;
}

function readinessRiskRank(level: BranchReadinessLevel): number {
  switch (level) {
    case 'blocked': return 100;
    case 'attention': return 50;
    case 'ready': return 10;
    case 'retired': return 5;
    case 'baseline': return 0;
  }
}

/** A conservative CODEOWNERS entry used by the on-demand ownership review. */
export interface BranchCodeownerRule {
  pattern: string;
  owners: string[];
  line: number;
}

export interface BranchCodeownerParseResult {
  rules: BranchCodeownerRule[];
  ignoredLines: number[];
}

/**
 * Parse bounded CODEOWNERS rules.
 *
 * Escaped whitespace and `!` negation are intentionally refused: GitHub's
 * CODEOWNERS dialect does not support negation and a partial escaped-token
 * parser could route review to the wrong person. Last match wins, matching
 * GitHub's documented rule ordering.
 */
export function parseBranchCodeowners(content: string): BranchCodeownerParseResult {
  const rules: BranchCodeownerRule[] = [];
  const ignoredLines: number[] = [];
  const lines = content.slice(0, 512_000).split(/\r?\n/).slice(0, 5_000);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]!.trim();
    if (!raw || raw.startsWith('#')) continue;
    const parts = raw.split(/\s+/);
    const pattern = parts[0] ?? '';
    const owners = uniqueNames(parts.slice(1).filter(value => /^@[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?$/.test(value)))
      .map(value => `@${value}`);
    if (!pattern || pattern.startsWith('!') || raw.includes('\\ ') || owners.length === 0) {
      ignoredLines.push(index + 1);
      continue;
    }
    rules.push({ pattern: pattern.slice(0, 500), owners, line: index + 1 });
  }
  return { rules, ignoredLines };
}

export interface BranchOwnershipMatch {
  owners: string[];
  matchedPathCount: number;
  unmatchedPathCount: number;
  ignoredRuleCount: number;
  rules: Array<{ pattern: string; owners: string[]; matchedPathCount: number }>;
}

/** Resolve last-match-wins CODEOWNERS routing for bounded changed paths. */
export function matchBranchCodeowners(
  parsed: BranchCodeownerParseResult,
  changedPaths: readonly string[],
): BranchOwnershipMatch {
  const ownerCounts = new Map<string, number>();
  const ruleCounts = new Map<number, number>();
  let unmatchedPathCount = 0;
  for (const rawPath of changedPaths.slice(0, 1_000)) {
    const workspacePath = normalizeWorkspacePath(rawPath);
    if (!workspacePath) continue;
    let matchedIndex = -1;
    for (let index = 0; index < parsed.rules.length; index += 1) {
      if (matchesCodeownerPattern(parsed.rules[index]!.pattern, workspacePath)) {
        matchedIndex = index;
      }
    }
    if (matchedIndex < 0) {
      unmatchedPathCount += 1;
      continue;
    }
    const rule = parsed.rules[matchedIndex]!;
    ruleCounts.set(matchedIndex, (ruleCounts.get(matchedIndex) ?? 0) + 1);
    for (const owner of rule.owners) {
      ownerCounts.set(owner, (ownerCounts.get(owner) ?? 0) + 1);
    }
  }
  return {
    owners: [...ownerCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([owner]) => owner)
      .slice(0, 30),
    matchedPathCount: [...ruleCounts.values()].reduce((total, count) => total + count, 0),
    unmatchedPathCount,
    ignoredRuleCount: parsed.ignoredLines.length,
    rules: [...ruleCounts.entries()]
      .map(([index, matchedPathCount]) => ({
        pattern: parsed.rules[index]!.pattern,
        owners: parsed.rules[index]!.owners,
        matchedPathCount,
      }))
      .sort((left, right) => right.matchedPathCount - left.matchedPathCount || left.pattern.localeCompare(right.pattern))
      .slice(0, 30),
  };
}

function normalizeWorkspacePath(value: string): string | undefined {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
  return normalized
    && normalized.length <= 1_000
    && !normalized.split('/').some(segment => !segment || segment === '.' || segment === '..')
    ? normalized
    : undefined;
}

function matchesCodeownerPattern(pattern: string, workspacePath: string): boolean {
  const anchored = pattern.startsWith('/');
  const directory = pattern.endsWith('/');
  let clean = pattern.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!clean) return false;
  const hasSlash = clean.includes('/');
  const body = clean
    .split('')
    .map((char, index, chars) => {
      if (char === '*' && chars[index + 1] === '*') {
        chars[index + 1] = '';
        return '.*';
      }
      if (char === '*') return '[^/]*';
      if (char === '?') return '[^/]';
      return /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
    })
    .join('');
  const prefix = anchored || hasSlash ? '^' : '(^|/)';
  const suffix = directory ? '(?:/.*)?$' : '(?:$|/.*$)';
  try {
    return new RegExp(`${prefix}${body}${suffix}`).test(workspacePath);
  } catch {
    return false;
  }
}
