/**
 * Provider-neutral policy for lending a local CI worker to one reviewed PR SHA.
 *
 * "Provider" here means the code authoring service. It is deliberately not part
 * of the decision: GitHub repository identity, pull-request metadata, the exact
 * head commit, and an explicit operator confirmation are the complete boundary.
 */

import {
  REVIEWED_PR_LOCAL_CI_CONFIG_PATH,
  REVIEWED_PR_LOCAL_CI_MARKER,
  REVIEWED_PR_LOCAL_CI_STATUS_CONTEXT,
  REVIEWED_PR_LOCAL_CI_WORKFLOW_FILE,
  type ReviewedPrLocalCiCommand,
  type ReviewedPrLocalCiConfig,
} from './localCiRepositoryPatch.js';
import { isLocalCiAuthorizedAccount } from './localCiActorGuard.js';

const REPOSITORY_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$/;
const SHA = /^[a-f0-9]{40}$/;
const RUNNER_LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const WORKFLOW_FILE = /^[A-Za-z0-9._-]+\.ya?ml$/;
const STATUS_CONTEXT = /^[A-Za-z0-9][A-Za-z0-9 ./_-]{0,99}$/;
const NODE_VERSION = /^(?:\d{1,3})(?:\.\d{1,3}){0,2}(?:\.x)?$/;
const EXECUTABLE = /^[^\s;&|`$<>\u0000-\u001f\u007f]{1,240}$/;
const SHELL_EXECUTABLES = new Set([
  'sh', 'bash', 'dash', 'zsh', 'fish', 'ksh',
  'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe',
]);

export interface ReviewedPrCandidate {
  number: number;
  title: string;
  url: string;
  author: string;
  isDraft: boolean;
  baseBranch: string;
  headBranch: string;
  headSha: string;
  headRepository: string;
}

export interface ReviewedPrAssessment {
  allowed: boolean;
  blockers: string[];
  fingerprint: string;
}

export interface ReviewedPrApprovalCopy {
  title: string;
  detail: string;
  approveLabel: string;
  fingerprint: string;
}

export interface ReviewedPrRunReading {
  status: 'queued' | 'in_progress' | 'completed' | 'unknown';
  conclusion: string;
  url?: string;
}

export type ReviewedPrConfigRead =
  | { ok: true; config: ReviewedPrLocalCiConfig }
  | { ok: false; reason: string };

function boundedText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function repositoryName(value: unknown): string {
  const object = objectOf(value);
  const direct = boundedText(object?.['nameWithOwner'], 200);
  if (REPOSITORY_SLUG.test(direct)) {
    return direct;
  }
  const name = boundedText(object?.['name'], 100);
  const owner = boundedText(objectOf(object?.['owner'])?.['login'], 100)
    || boundedText(object?.['ownerLogin'], 100);
  return owner && name ? `${owner}/${name}` : '';
}

function commandOf(value: unknown): ReviewedPrLocalCiCommand | undefined {
  const object = objectOf(value);
  if (!object) {
    return undefined;
  }
  const label = boundedText(object['label'], 160);
  const command = boundedText(object['command'], 240);
  const args = Array.isArray(object['args'])
    ? object['args'].map(value => typeof value === 'string' ? value : undefined)
    : [];
  const timeoutMinutes = object['timeoutMinutes'];
  const executable = command.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  if (!label || !EXECUTABLE.test(command) || SHELL_EXECUTABLES.has(executable)
    || args.length > 80 || args.some(value => value === undefined || value.length < 1 || value.length > 1000 || /[\u0000-\u001f\u007f]/.test(value))
    || typeof timeoutMinutes !== 'number' || !Number.isFinite(timeoutMinutes)
    || timeoutMinutes < 1 || timeoutMinutes > 120) {
    return undefined;
  }
  return {
    label,
    command,
    args: args as string[],
    timeoutMinutes: Math.floor(timeoutMinutes),
  };
}

/** Parse the committed contract. Unknown versions and permissive values fail closed. */
export function parseReviewedPrLocalCiConfig(raw: string): ReviewedPrConfigRead {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'The local-CI contract is not valid JSON.' };
  }
  const object = objectOf(value);
  if (!object || object['schemaVersion'] !== 1 || object['managedBy'] !== REVIEWED_PR_LOCAL_CI_MARKER) {
    return { ok: false, reason: 'The local-CI contract is not an AtlasMind schema version 1 file.' };
  }
  if (object['enabled'] !== true) {
    // Two different facts hide behind `enabled: false`. The patcher writes a
    // disabled contract when it could not detect a deterministic install and
    // says so in `detection.detail`; a person can also switch one off. The
    // reason names which, because the fix differs: declare commands, or just
    // re-enable it.
    const detail = boundedText(objectOf(object['detection'])?.['detail'], 500);
    const commands = Array.isArray(object['commands']) ? object['commands'].length : 0;
    return {
      ok: false,
      reason: commands === 0
        ? `The local-CI contract is disabled because it declares no commands${detail ? ` (${detail})` : ''}. Declare safe shell-free commands in it and set "enabled": true, or patch the repository again once a supported lockfile exists.`
        : 'The local-CI contract is disabled ("enabled": false). Review its commands, then set "enabled": true and commit the change.',
    };
  }

  const repository = boundedText(object['repository'], 200);
  const trustedBaseBranch = boundedText(object['trustedBaseBranch'], 121);
  const workflowFile = boundedText(object['workflowFile'], 120);
  const runnerLabel = boundedText(object['runnerLabel'], 80);
  const statusContext = boundedText(object['statusContext'], 100);
  const controllerNodeVersion = boundedText(object['controllerNodeVersion'], 20);
  if (!REPOSITORY_SLUG.test(repository)) {
    return { ok: false, reason: 'The local-CI contract repository must be an exact owner/name slug.' };
  }
  // Present only in an organisation-owned repository. A malformed pin is a
  // refusal: dropping it would quietly fall back to the owner condition, which
  // no dispatch can meet there.
  const pinned = 'authorizedAccount' in object;
  const authorizedAccount = object['authorizedAccount'];
  if (pinned && !isLocalCiAuthorizedAccount(authorizedAccount)) {
    return { ok: false, reason: 'The authorised account in the local-CI contract must be a GitHub account id and login.' };
  }
  if (!BRANCH.test(trustedBaseBranch)) {
    return { ok: false, reason: 'The trusted base branch in the local-CI contract is invalid.' };
  }
  if (workflowFile !== REVIEWED_PR_LOCAL_CI_WORKFLOW_FILE || !WORKFLOW_FILE.test(workflowFile)) {
    return { ok: false, reason: `The local-CI contract must use ${REVIEWED_PR_LOCAL_CI_WORKFLOW_FILE}.` };
  }
  if (!RUNNER_LABEL.test(runnerLabel)) {
    return { ok: false, reason: 'The local-CI runner label is invalid.' };
  }
  if (statusContext !== REVIEWED_PR_LOCAL_CI_STATUS_CONTEXT || !STATUS_CONTEXT.test(statusContext)) {
    return { ok: false, reason: `The local-CI status context must be ${REVIEWED_PR_LOCAL_CI_STATUS_CONTEXT}.` };
  }
  if (!NODE_VERSION.test(controllerNodeVersion)) {
    return { ok: false, reason: 'The trusted controller Node version is invalid.' };
  }
  if (object['evidence'] !== 'linux-container' || object['allowForks'] !== false) {
    return { ok: false, reason: 'The local-CI contract must retain Linux-container evidence and deny fork execution.' };
  }
  const commands = Array.isArray(object['commands']) ? object['commands'].map(commandOf) : [];
  if (commands.length < 1 || commands.length > 20 || commands.some(command => command === undefined)) {
    return { ok: false, reason: 'The local-CI contract must contain between 1 and 20 valid shell-free commands.' };
  }
  const detectionObject = objectOf(object['detection']);
  const kind = detectionObject?.['kind'];
  const detail = boundedText(detectionObject?.['detail'], 500);
  if ((kind !== 'node' && kind !== 'custom') || !detail) {
    return { ok: false, reason: 'The local-CI contract detection record is invalid.' };
  }
  const packageManager = detectionObject?.['packageManager'];
  if (packageManager !== undefined && packageManager !== 'npm' && packageManager !== 'pnpm' && packageManager !== 'yarn') {
    return { ok: false, reason: 'The local-CI package manager is unsupported.' };
  }

  return {
    ok: true,
    config: {
      schemaVersion: 1,
      managedBy: REVIEWED_PR_LOCAL_CI_MARKER,
      enabled: true,
      repository,
      ...(pinned && isLocalCiAuthorizedAccount(authorizedAccount)
        ? { authorizedAccount: { id: authorizedAccount.id, login: authorizedAccount.login } }
        : {}),
      trustedBaseBranch,
      workflowFile: REVIEWED_PR_LOCAL_CI_WORKFLOW_FILE,
      runnerLabel,
      statusContext: REVIEWED_PR_LOCAL_CI_STATUS_CONTEXT,
      controllerNodeVersion,
      evidence: 'linux-container',
      allowForks: false,
      commands: commands as ReviewedPrLocalCiCommand[],
      detection: {
        kind,
        ...(packageManager ? { packageManager } : {}),
        detail,
      },
    },
  };
}

/** Parse the bounded JSON returned by `gh pr list` or `gh pr view`. */
export function parseReviewedPrCandidates(raw: string): ReviewedPrCandidate[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  const rows = Array.isArray(value) ? value : [value];
  const candidates: ReviewedPrCandidate[] = [];
  for (const row of rows.slice(0, 100)) {
    const object = objectOf(row);
    if (!object) {
      continue;
    }
    const number = object['number'];
    const headSha = boundedText(object['headRefOid'] ?? object['headSha'], 40).toLowerCase();
    const headRepositoryObject = objectOf(object['headRepository']);
    const headRepositoryOwner = boundedText(objectOf(object['headRepositoryOwner'])?.['login'], 100);
    const headRepository = boundedText(object['headRepositoryNameWithOwner'], 200)
      || repositoryName(object['headRepository'])
      || (headRepositoryOwner && boundedText(headRepositoryObject?.['name'], 100)
        ? `${headRepositoryOwner}/${boundedText(headRepositoryObject?.['name'], 100)}`
        : '');
    const author = boundedText(objectOf(object['author'])?.['login'] ?? object['author'], 100) || 'unknown';
    const title = boundedText(object['title'], 300);
    const url = boundedText(object['url'], 500);
    const baseBranch = boundedText(object['baseRefName'], 121);
    const headBranch = boundedText(object['headRefName'], 121);
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1
      || !SHA.test(headSha) || !REPOSITORY_SLUG.test(headRepository)
      || !title || !baseBranch || !headBranch) {
      continue;
    }
    candidates.push({
      number,
      title,
      url,
      author,
      isDraft: object['isDraft'] === true,
      baseBranch,
      headBranch,
      headSha,
      headRepository,
    });
  }
  return candidates;
}

function reviewedPrFingerprint(config: ReviewedPrLocalCiConfig, candidate: ReviewedPrCandidate): string {
  return `${config.repository}#${candidate.number}@${candidate.headSha}`;
}

/** Decide whether this exact candidate may be offered to the local machine. */
export function assessReviewedPrCandidate(
  config: ReviewedPrLocalCiConfig,
  candidate: ReviewedPrCandidate,
): ReviewedPrAssessment {
  const blockers: string[] = [];
  if (candidate.isDraft) {
    blockers.push('Draft pull requests are not eligible. Mark it ready only when the commit is ready to review and execute.');
  }
  if (candidate.baseBranch !== config.trustedBaseBranch) {
    blockers.push(`The PR targets ${candidate.baseBranch}, not the trusted base branch ${config.trustedBaseBranch}.`);
  }
  if (candidate.headRepository !== config.repository) {
    blockers.push('Fork pull requests are refused by the local executor.');
  }
  if (!SHA.test(candidate.headSha)) {
    blockers.push('The PR head is not an exact 40-character commit SHA.');
  }
  return {
    allowed: blockers.length === 0,
    blockers,
    fingerprint: reviewedPrFingerprint(config, candidate),
  };
}

export function buildReviewedPrApprovalCopy(
  config: ReviewedPrLocalCiConfig,
  candidate: ReviewedPrCandidate,
): ReviewedPrApprovalCopy {
  const fingerprint = reviewedPrFingerprint(config, candidate);
  return {
    title: `Run PR #${candidate.number} on this computer?`,
    approveLabel: `Approve ${candidate.headSha.slice(0, 12)}`,
    fingerprint,
    detail: [
      `You are approving one exact commit of PR #${candidate.number} to run on this computer, in a throwaway Linux container. A pass posts the ${config.statusContext} check on that commit; nothing is merged.`,
      '',
      `Repository: ${config.repository}`,
      `PR: #${candidate.number} — ${candidate.title}`,
      `Author: ${candidate.author}`,
      `Source: ${candidate.headBranch}`,
      `Target: ${candidate.baseBranch}`,
      `Exact head SHA: ${candidate.headSha}`,
      '',
      'AtlasMind will dispatch the trusted base-branch workflow and lend one one-job Docker runner to this exact SHA.',
      'The authoring tool is not trusted or distrusted by name. Codex, Claude, another agentic service, and a human use this same approval boundary.',
      'A new commit changes the SHA and invalidates this approval. Forks, drafts, repository/environment secrets, host mounts, the Docker socket, and native-platform claims are refused.',
      'The job still has outbound network access for GitHub and dependency installation. Docker is defence in depth, not a substitute for reviewing the proposed code.',
    ].join('\n'),
  };
}

export function buildReviewedPrDispatchArgs(
  config: ReviewedPrLocalCiConfig,
  candidate: ReviewedPrCandidate,
): string[] {
  return [
    'workflow', 'run', config.workflowFile,
    '--ref', config.trustedBaseBranch,
    '--field', `pr_number=${candidate.number}`,
    '--field', `pr_sha=${candidate.headSha}`,
    '--field', `head_repo=${candidate.headRepository}`,
  ];
}

export function buildReviewedPrStatusArgs(
  config: ReviewedPrLocalCiConfig,
  candidate: ReviewedPrCandidate,
  state: 'pending' | 'success' | 'failure' | 'error',
  description: string,
  targetUrl?: string,
): string[] {
  const args = [
    'api', '--method', 'POST',
    `repos/${config.repository}/statuses/${candidate.headSha}`,
    '-f', `state=${state}`,
    '-f', `context=${config.statusContext}`,
    '-f', `description=${description.replace(/[\r\n]+/g, ' ').slice(0, 140)}`,
  ];
  if (targetUrl && /^https:\/\/github\.com\//.test(targetUrl)) {
    args.push('-f', `target_url=${targetUrl.slice(0, 500)}`);
  }
  return args;
}

/**
 * Where the contract was looked for, said with the folder and the file.
 *
 * The parser above cannot know the path, and its reason used to be shown bare.
 * With a different repository open in VS Code that read as "your contract is
 * broken" when the truth was "this is not that repository" — the folder is the
 * first thing a person needs to see.
 */
export function describeReviewedPrContractProblem(input: {
  folderName: string;
  root: string;
  missing?: boolean;
  reason?: string;
}): string {
  const where = `${input.folderName} (${input.root})`;
  if (input.missing) {
    return `No local-CI contract exists in ${where}: ${REVIEWED_PR_LOCAL_CI_CONFIG_PATH} is absent. This folder is not patched for reviewed-PR local CI. Open the repository you meant to run, or patch this one first.`;
  }
  return `Cannot run from ${where}: ${input.reason ?? 'the local-CI contract could not be read.'} File: ${REVIEWED_PR_LOCAL_CI_CONFIG_PATH}.`;
}

/** A dispatch of the reviewed-PR workflow that GitHub still lists as waiting or running. */
export interface WaitingReviewedPrWorkflowRun {
  databaseId: number;
  headSha: string;
  status: 'queued' | 'pending' | 'in_progress';
  event: string;
  displayTitle: string;
  /** When GitHub created the run, as it reported it. Absent when the listing omitted it. */
  createdAt?: string;
}

/** Parse the bounded JSON returned by `gh run list` for the reviewed-PR workflow. */
export function parseReviewedPrWaitingRuns(raw: string): WaitingReviewedPrWorkflowRun[] {
  try {
    const rows = JSON.parse(raw) as unknown;
    if (!Array.isArray(rows)) {
      return [];
    }
    return rows.slice(0, 100).flatMap(row => {
      const value = objectOf(row);
      if (!value) {
        return [];
      }
      const databaseId = value['databaseId'];
      const headSha = boundedText(value['headSha'], 40).toLowerCase();
      const status = value['status'];
      const event = boundedText(value['event'], 40);
      const displayTitle = boundedText(value['displayTitle'], 300);
      const createdAt = boundedText(value['createdAt'], 40);
      if (typeof databaseId !== 'number' || !Number.isSafeInteger(databaseId) || databaseId < 1
        || !SHA.test(headSha)
        || (status !== 'queued' && status !== 'pending' && status !== 'in_progress')) {
        return [];
      }
      return [{
        databaseId,
        headSha,
        status,
        event,
        displayTitle,
        ...(createdAt && Number.isFinite(Date.parse(createdAt)) ? { createdAt } : {}),
      }];
    });
  } catch {
    return [];
  }
}

/**
 * The PR and head SHA a reviewed-PR run was dispatched for, read back from the
 * title AtlasMind's own workflow gives it. Any other title is not one of ours.
 */
export function parseReviewedPrRunTitle(displayTitle: string): { number: number; headSha: string } | undefined {
  const match = /^AtlasMind local CI PR #(\d{1,9}) @ ([a-f0-9]{40})$/.exec(displayTitle.trim());
  if (!match) {
    return undefined;
  }
  return { number: Number(match[1]), headSha: match[2]! };
}

/**
 * A waiting run that nothing has picked up for this long is stale. A one-job
 * runner claims its job within seconds of registering, so half an hour of
 * waiting means no runner ever came — the usual leftover of a container that
 * died before it registered.
 */
export const STALE_REVIEWED_PR_WAIT_MS = 30 * 60 * 1000;

export interface WaitingReviewedPrRunDescription {
  /** One line naming the run and the PR it was for. */
  label: string;
  /** How long it has waited and whether anything picked it up. */
  description: string;
  stale: boolean;
}

function describeAge(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours} h`;
  }
  return `${Math.round(hours / 24)} d`;
}

/** Plain words for one waiting run, so a dialog can list it rather than its id. */
export function describeWaitingReviewedPrRun(run: WaitingReviewedPrWorkflowRun, now: number): WaitingReviewedPrRunDescription {
  const parsed = parseReviewedPrRunTitle(run.displayTitle);
  const label = parsed
    ? `Run ${run.databaseId} · PR #${parsed.number} @ ${parsed.headSha.slice(0, 12)}`
    : `Run ${run.databaseId}${run.displayTitle ? ` · ${run.displayTitle}` : ''}`;
  const created = run.createdAt ? Date.parse(run.createdAt) : Number.NaN;
  const ageMs = Number.isFinite(created) ? now - created : undefined;
  const age = ageMs === undefined ? 'age unknown' : describeAge(ageMs);
  if (run.status === 'in_progress') {
    return { label, description: `running now · started ${age} ago`, stale: false };
  }
  const stale = ageMs !== undefined && ageMs >= STALE_REVIEWED_PR_WAIT_MS;
  return {
    label,
    description: `waiting ${age} · ${stale ? 'never picked up — stale' : 'no runner has picked it up yet'}`,
    stale,
  };
}

export function parseReviewedPrRunReading(raw: string): ReviewedPrRunReading {
  try {
    const object = objectOf(JSON.parse(raw));
    const rawStatus = boundedText(object?.['status'], 40);
    const status = rawStatus === 'queued' || rawStatus === 'in_progress' || rawStatus === 'completed'
      ? rawStatus
      : 'unknown';
    const conclusion = boundedText(object?.['conclusion'], 80);
    const url = boundedText(object?.['url'], 500);
    return { status, conclusion, ...(url ? { url } : {}) };
  } catch {
    return { status: 'unknown', conclusion: '' };
  }
}
