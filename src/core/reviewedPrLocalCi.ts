/**
 * Provider-neutral policy for lending a local CI worker to one reviewed PR SHA.
 *
 * "Provider" here means the code authoring service. It is deliberately not part
 * of the decision: GitHub repository identity, pull-request metadata, the exact
 * head commit, and an explicit operator confirmation are the complete boundary.
 */

import {
  REVIEWED_PR_LOCAL_CI_MARKER,
  REVIEWED_PR_LOCAL_CI_STATUS_CONTEXT,
  REVIEWED_PR_LOCAL_CI_WORKFLOW_FILE,
  type ReviewedPrLocalCiCommand,
  type ReviewedPrLocalCiConfig,
} from './localCiRepositoryPatch.js';

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
    return { ok: false, reason: 'The repository local-CI contract is disabled. Review its detected commands before enabling it.' };
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
