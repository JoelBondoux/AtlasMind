import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import {
  REVIEWED_PR_LOCAL_CI_CONFIG_PATH,
  REVIEWED_PR_LOCAL_CI_MARKER,
  REVIEWED_PR_LOCAL_CI_RUNNER_PATH,
  REVIEWED_PR_LOCAL_CI_WORKFLOW_PATH,
  assessLocalCiPatchTargets,
  assessManagedReviewedPrLocalCiFiles,
  buildLocalCiRepositoryPatch,
  type ReviewedPrLocalCiConfig,
} from '../core/localCiRepositoryPatch.js';
import {
  assessReviewedPrCandidate,
  buildReviewedPrApprovalCopy,
  buildReviewedPrDispatchArgs,
  buildReviewedPrStatusArgs,
  parseReviewedPrCandidates,
  parseReviewedPrLocalCiConfig,
  parseReviewedPrRunReading,
  type ReviewedPrCandidate,
} from '../core/reviewedPrLocalCi.js';
import {
  DEFAULT_LOCAL_CI_IMAGE,
  LocalCiRunnerManager,
  reviewTrustedLocalCiWorkflow,
  type LocalCiRunnerConfiguration,
  type LocalCiRunnerSnapshot,
  type LocalCiShutdownPolicy,
} from '../core/localCiRunner.js';
import { parseRepoSlug } from '../core/githubDeepLinks.js';
import { runGhOrThrow } from '../core/ghClient.js';
import { redactSecrets } from '../utils/secretRedactor.js';
import { sanitizeTerminalOutput } from '../utils/terminalOutput.js';

const execFileAsync = promisify(execFile);
const TERMINAL_RUNNER_STATES = new Set(['finished', 'failed', 'blocked', 'disabled']);
let localCiOutput: vscode.OutputChannel | undefined;

function outputChannel(): vscode.OutputChannel {
  localCiOutput ??= vscode.window.createOutputChannel('AtlasMind: Reviewed PR Local CI');
  return localCiOutput;
}

function workspaceRoot(): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.find(candidate =>
    candidate.uri.scheme === 'file' || candidate.uri.scheme === 'vscode-remote');
  return folder?.uri.fsPath;
}

async function git(root: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], {
    cwd: root,
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
  return String(stdout).trim();
}

function safeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  return redactSecrets(sanitizeTerminalOutput(message)).text
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 400);
}

async function resolveRepositoryIdentity(root: string): Promise<{ repository: string; remote: string }> {
  const remote = await git(root, ['remote', 'get-url', 'origin']);
  const parsed = parseRepoSlug(remote);
  if (!parsed) {
    throw new Error('The origin remote is not a GitHub repository AtlasMind can identify.');
  }
  return { repository: `${parsed.owner}/${parsed.repo}`, remote };
}

async function observedGitBranches(root: string): Promise<string[]> {
  try {
    const raw = await git(root, [
      'for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes/origin',
    ]);
    return [...new Set(raw.split(/\r?\n/)
      .map(value => value.trim().replace(/^origin\//, ''))
      .filter(value => value && value !== 'HEAD' && !value.endsWith('/HEAD')))]
      .filter(value => /^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$/.test(value));
  } catch {
    return [];
  }
}

async function existingManagedBaseBranch(root: string): Promise<string | undefined> {
  const raw = await readOptionalText(path.join(root, REVIEWED_PR_LOCAL_CI_CONFIG_PATH));
  if (!raw || !raw.includes(REVIEWED_PR_LOCAL_CI_MARKER)) {
    return undefined;
  }
  try {
    const value = JSON.parse(raw) as { trustedBaseBranch?: unknown };
    const branch = typeof value.trustedBaseBranch === 'string' ? value.trustedBaseBranch.trim() : '';
    return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$/.test(branch) ? branch : undefined;
  } catch {
    return undefined;
  }
}

async function chooseTrustedBaseBranch(root: string): Promise<string | undefined> {
  const branches = await observedGitBranches(root);
  const available = new Set(branches);
  let current = '';
  try { current = await git(root, ['branch', '--show-current']); } catch { /* detached or no git */ }
  let githubDefault = '';
  try {
    githubDefault = (await runGhOrThrow(root, [
      'repo', 'view', '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name',
    ], { timeoutMs: 8_000, maxBufferBytes: 128 * 1024 })).trim();
  } catch {
    // GitHub CLI is optional while patching; local refs still give a choice.
  }
  let remoteHead = '';
  try {
    remoteHead = (await git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']))
      .replace(/^origin\//, '').trim();
  } catch {
    // A clone does not always carry origin/HEAD.
  }
  const existing = await existingManagedBaseBranch(root);
  const configured = vscode.workspace.getConfiguration('atlasmind')
    .get<string>('ci.localRunner.trustedBranch', '')
    .trim();

  const ordered = [existing, current === 'develop' || current === 'main' ? current : undefined,
    available.has('develop') ? 'develop' : undefined,
    configured && available.has(configured) ? configured : undefined,
    githubDefault && (!available.size || available.has(githubDefault)) ? githubDefault : undefined,
    remoteHead && (!available.size || available.has(remoteHead)) ? remoteHead : undefined,
    available.has('main') ? 'main' : undefined,
    current || undefined,
    ...branches]
    .filter((value): value is string => Boolean(value));
  const unique = [...new Set(ordered)];
  if (unique.length === 0) {
    void vscode.window.showErrorMessage('AtlasMind could not find a local or remote branch to trust for the reviewed-PR workflow.');
    return undefined;
  }
  if (unique.length === 1) {
    return unique[0];
  }

  const selected = await vscode.window.showQuickPick(
    unique.map(branch => ({
      label: branch,
      description: branch === existing ? 'current AtlasMind local-CI contract'
        : branch === current ? 'current checkout'
          : branch === githubDefault ? 'GitHub default branch'
            : branch === remoteHead ? 'origin/HEAD'
              : branch === configured ? 'local-runner setting' : 'repository branch',
      branch,
    })),
    {
      title: 'Trusted base branch for reviewed-PR local CI',
      placeHolder: 'Only an exact owner dispatch of this branch may borrow the local runner',
      ignoreFocusOut: true,
    },
  );
  return selected?.branch;
}

async function resolveControllerNodeVersion(root: string, packageJsonText: string | undefined): Promise<string> {
  for (const candidate of ['.nvmrc', '.node-version']) {
    try {
      const text = (await fs.readFile(path.join(root, candidate), 'utf8')).trim();
      const match = /(?:^|\D)(\d{1,3})(?:\.\d+){0,2}/.exec(text);
      if (match?.[1]) {
        return match[1];
      }
    } catch {
      // Optional version file absent.
    }
  }
  if (packageJsonText) {
    try {
      const parsed = JSON.parse(packageJsonText) as { engines?: { node?: unknown } };
      const raw = typeof parsed.engines?.node === 'string' ? parsed.engines.node : '';
      const match = /(?:^|\D)(\d{1,3})(?:\.\d+){0,2}/.exec(raw);
      if (match?.[1]) {
        return match[1];
      }
    } catch {
      // The patch builder will report a malformed manifest separately.
    }
  }
  return '22';
}

async function readOptionalText(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

/**
 * Inspect and patch the currently open repository.
 *
 * Existing unrelated files are a hard conflict; files carrying AtlasMind's
 * marker may be refreshed, and every write is named in one modal first.
 */
export async function patchRepositoryForReviewedPrLocalCi(): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    void vscode.window.showInformationMessage('Open a repository folder before patching it for local CI.');
    return;
  }

  try {
    const trustedBaseBranch = await chooseTrustedBaseBranch(root);
    if (!trustedBaseBranch) {
      return;
    }
    const [{ repository }, entries, packageJsonText] = await Promise.all([
      resolveRepositoryIdentity(root),
      fs.readdir(root, { withFileTypes: true }),
      readOptionalText(path.join(root, 'package.json')),
    ]);
    const nodeVersion = await resolveControllerNodeVersion(root, packageJsonText);
    const outcome = buildLocalCiRepositoryPatch({
      repository,
      trustedBaseBranch,
      architecture: os.arch(),
      nodeVersion,
      packageJsonText,
      workspaceFiles: entries.map(entry => entry.name),
    });
    if (!outcome.ok) {
      void vscode.window.showErrorMessage(`AtlasMind could not build the repository patch: ${outcome.reason}`);
      return;
    }

    const existing = new Map<string, string | undefined>();
    for (const file of outcome.plan.files) {
      existing.set(file.path, await readOptionalText(path.join(root, ...file.path.split('/'))));
    }
    const targets = assessLocalCiPatchTargets(outcome.plan, existing);
    const conflicts = targets.filter(target => target.state === 'conflict');
    if (conflicts.length > 0) {
      void vscode.window.showErrorMessage(
        `AtlasMind will not overwrite ${conflicts.map(conflict => conflict.path).join(', ')} because ${conflicts.length === 1 ? 'it is' : 'they are'} not AtlasMind-managed.`,
      );
      return;
    }
    const writes = targets.filter(target => target.state === 'create' || target.state === 'replace-managed');
    if (writes.length === 0) {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, REVIEWED_PR_LOCAL_CI_CONFIG_PATH)));
      await vscode.window.showTextDocument(document, { preview: false });
      void vscode.window.showInformationMessage('This repository already has the current AtlasMind reviewed-PR local-CI patch.');
      return;
    }

    const confirmation = await vscode.window.showWarningMessage(
      `Patch ${repository} for reviewed-PR local CI?`,
      {
        modal: true,
        detail: [
          `Trusted base branch: ${outcome.plan.trustedBaseBranch}`,
          `Dedicated runner label: ${outcome.plan.runnerLabel}`,
          `Detected checks: ${outcome.plan.detectionDetail}`,
          `Contract state: ${outcome.plan.enabled ? 'enabled after commit' : 'disabled until you declare safe command/argument pairs'}`,
          '',
          ...writes.map(target => `${target.state === 'create' ? 'Create' : 'Refresh'} ${target.path}`),
          '',
          'The workflow accepts only an owner-dispatched, same-repository, exact head SHA. It receives no repository/environment secret or write permission, mounts no host directory or Docker socket, and produces Linux-container evidence only.',
          'The job retains outbound network access for GitHub and dependency installation. Docker is defence in depth, not a substitute for reviewing the proposed code.',
          'Nothing is committed or pushed by this command.',
        ].join('\n'),
      },
      'Write managed files',
    );
    if (confirmation !== 'Write managed files') {
      return;
    }

    for (const file of outcome.plan.files) {
      const target = targets.find(candidate => candidate.path === file.path);
      if (!target || target.state === 'unchanged') {
        continue;
      }
      const absolute = path.join(root, ...file.path.split('/'));
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, file.content, 'utf8');
    }

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, REVIEWED_PR_LOCAL_CI_CONFIG_PATH)));
    await vscode.window.showTextDocument(document, { preview: false });
    void vscode.window.showInformationMessage(
      outcome.plan.enabled
        ? `AtlasMind added the reviewed-PR local-CI contract for ${repository}. Review and commit the three managed files to ${trustedBaseBranch}.`
        : `AtlasMind added a disabled local-CI contract for ${repository}. Declare safe shell-free commands in ${REVIEWED_PR_LOCAL_CI_CONFIG_PATH}, enable it, then commit all three managed files.`,
    );
  } catch (error) {
    void vscode.window.showErrorMessage(`AtlasMind could not patch this repository: ${safeFailure(error)}`);
  }
}

async function readCommittedConfig(root: string): Promise<ReviewedPrLocalCiConfig> {
  const raw = await fs.readFile(path.join(root, REVIEWED_PR_LOCAL_CI_CONFIG_PATH), 'utf8');
  const parsed = parseReviewedPrLocalCiConfig(raw);
  if (!parsed.ok) {
    throw new Error(parsed.reason);
  }
  return parsed.config;
}

function readRunnerConfiguration(config: ReviewedPrLocalCiConfig): LocalCiRunnerConfiguration {
  const settings = vscode.workspace.getConfiguration('atlasmind');
  const rawShutdown = settings.get<string>('ci.localRunner.shutdownPolicy', 'ifStartedByAtlasMind');
  const shutdownPolicy: LocalCiShutdownPolicy = rawShutdown === 'never' || rawShutdown === 'always'
    ? rawShutdown
    : 'ifStartedByAtlasMind';
  return {
    enabled: settings.get<boolean>('ci.localRunner.enabled', false),
    workflowFile: config.workflowFile,
    trustedBranch: config.trustedBaseBranch,
    runnerLabel: config.runnerLabel,
    image: settings.get<string>('ci.localRunner.image', DEFAULT_LOCAL_CI_IMAGE).trim(),
    shutdownPolicy,
    maxCpus: settings.get<number>('ci.localRunner.maxCpus', 8),
    maxMemoryGb: settings.get<number>('ci.localRunner.maxMemoryGb', 16),
    resourceSharePercent: settings.get<number>('testing.resourceShare', 50),
  };
}

async function fetchOpenCandidates(root: string): Promise<ReviewedPrCandidate[]> {
  const raw = await runGhOrThrow(root, [
    'pr', 'list', '--state', 'open', '--limit', '100',
    '--json', 'number,title,url,author,isDraft,baseRefName,headRefName,headRefOid,headRepository,headRepositoryOwner',
  ], { timeoutMs: 20_000, maxBufferBytes: 4 * 1024 * 1024 });
  return parseReviewedPrCandidates(raw);
}

async function refetchCandidate(root: string, number: number): Promise<ReviewedPrCandidate | undefined> {
  const raw = await runGhOrThrow(root, [
    'pr', 'view', String(number),
    '--json', 'number,title,url,author,isDraft,baseRefName,headRefName,headRefOid,headRepository,headRepositoryOwner',
  ], { timeoutMs: 20_000, maxBufferBytes: 1024 * 1024 });
  return parseReviewedPrCandidates(raw)[0];
}

interface WaitingReviewedPrWorkflowRun {
  databaseId: number;
  headSha: string;
  status: 'queued' | 'pending' | 'in_progress';
  event: string;
  displayTitle: string;
}

function parseWaitingWorkflowRuns(raw: string): WaitingReviewedPrWorkflowRun[] {
  try {
    const rows = JSON.parse(raw) as unknown;
    if (!Array.isArray(rows)) {
      return [];
    }
    return rows.slice(0, 100).flatMap(row => {
      if (typeof row !== 'object' || row === null) {
        return [];
      }
      const value = row as Record<string, unknown>;
      const databaseId = value['databaseId'];
      const headSha = String(value['headSha'] ?? '').trim().toLowerCase();
      const status = value['status'];
      const event = String(value['event'] ?? '').trim();
      const displayTitle = String(value['displayTitle'] ?? '').trim().slice(0, 300);
      if (typeof databaseId !== 'number' || !Number.isSafeInteger(databaseId) || databaseId < 1
        || !/^[a-f0-9]{40}$/.test(headSha)
        || (status !== 'queued' && status !== 'pending' && status !== 'in_progress')) {
        return [];
      }
      return [{ databaseId, headSha, status, event, displayTitle }];
    });
  } catch {
    return [];
  }
}

async function listWaitingWorkflowRuns(
  root: string,
  config: ReviewedPrLocalCiConfig,
): Promise<WaitingReviewedPrWorkflowRun[]> {
  const statuses = ['pending', 'queued', 'in_progress'] as const;
  const rawLists = await Promise.all(statuses.map(status => runGhOrThrow(root, [
    'run', 'list', '--workflow', config.workflowFile,
    '--branch', config.trustedBaseBranch, '--status', status, '--limit', '100',
    '--json', 'databaseId,headSha,status,event,displayTitle',
  ], { timeoutMs: 15_000, maxBufferBytes: 2 * 1024 * 1024 })));
  const rows = rawLists.flatMap(parseWaitingWorkflowRuns);
  if (rows.length >= 100) {
    throw new Error('The reviewed-PR workflow queue is too large to identify one new dispatch safely.');
  }
  return [...new Map(rows
    .filter(run => run.event === 'workflow_dispatch')
    .map(run => [run.databaseId, run] as const)).values()];
}

async function waitForQueuedWorkflow(
  root: string,
  config: ReviewedPrLocalCiConfig,
  baseSha: string,
  candidate: ReviewedPrCandidate,
  previouslySeen: ReadonlySet<number>,
): Promise<number> {
  const expectedTitle = `AtlasMind local CI PR #${candidate.number} @ ${candidate.headSha}`;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const rows = await listWaitingWorkflowRuns(root, config);
    const newRows = rows.filter(row => !previouslySeen.has(row.databaseId)
      && row.headSha === baseSha
      && row.displayTitle === expectedTitle);
    if (newRows.length > 1) {
      throw new Error('More than one new reviewed-PR workflow appeared after dispatch. AtlasMind cannot prove which job it created.');
    }
    const exact = newRows[0];
    if (exact?.status === 'in_progress') {
      throw new Error(`Run ${exact.databaseId} was claimed before AtlasMind registered its one-job runner. Remove the competing runner before trying again.`);
    }
    if (exact && (exact.status === 'queued' || exact.status === 'pending')) {
      return exact.databaseId;
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error('GitHub did not expose the exact newly dispatched workflow as a queued job. Check the Actions page before trying again.');
}

async function cancelReviewedPrRun(root: string, runId: number): Promise<void> {
  if (!Number.isSafeInteger(runId) || runId < 1) {
    return;
  }
  await runGhOrThrow(root, ['run', 'cancel', String(runId)], {
    timeoutMs: 15_000,
    maxBufferBytes: 256 * 1024,
  });
}

async function waitForManager(manager: LocalCiRunnerManager, completion: Promise<LocalCiRunnerSnapshot>): Promise<LocalCiRunnerSnapshot> {
  const current = manager.getSnapshot();
  if (TERMINAL_RUNNER_STATES.has(current.lifecycle)) {
    return current;
  }
  return completion;
}

async function readRunConclusion(root: string, runId: number): Promise<ReturnType<typeof parseReviewedPrRunReading>> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const raw = await runGhOrThrow(root, [
      'run', 'view', String(runId), '--json', 'status,conclusion,url',
    ], { timeoutMs: 15_000, maxBufferBytes: 512 * 1024 });
    const reading = parseReviewedPrRunReading(raw);
    if (reading.status === 'completed') {
      return reading;
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  return { status: 'unknown', conclusion: '' };
}

async function publishStatus(
  root: string,
  config: ReviewedPrLocalCiConfig,
  candidate: ReviewedPrCandidate,
  state: 'pending' | 'success' | 'failure' | 'error',
  description: string,
  targetUrl?: string,
): Promise<void> {
  await runGhOrThrow(root, buildReviewedPrStatusArgs(config, candidate, state, description, targetUrl), {
    timeoutMs: 20_000,
    maxBufferBytes: 512 * 1024,
  });
}

/**
 * Approve and execute one immutable same-repository PR head.
 *
 * The candidate is re-read after the modal and before dispatch. A pushed commit
 * therefore invalidates the approval even if it arrives while the dialog is on
 * screen. The existing LocalCiRunnerManager remains the executor and re-checks
 * the trusted workflow, current base checkout, queue identity, actor, image,
 * Docker capacity, and competing runner registrations immediately before start.
 */
export async function runReviewedPullRequestOnLocalCi(): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    void vscode.window.showInformationMessage('Open a patched repository folder before running reviewed-PR local CI.');
    return;
  }
  const output = outputChannel();
  output.show(true);

  let config: ReviewedPrLocalCiConfig | undefined;
  let candidate: ReviewedPrCandidate | undefined;
  let queuedRunId: number | undefined;
  try {
    config = await readCommittedConfig(root);
    const activeConfig = config;
    const identity = await resolveRepositoryIdentity(root);
    if (identity.repository !== activeConfig.repository) {
      throw new Error(`The committed contract names ${activeConfig.repository}, but origin is ${identity.repository}.`);
    }
    const currentBranch = await git(root, ['branch', '--show-current']);
    if (currentBranch !== activeConfig.trustedBaseBranch) {
      throw new Error(`Check out the trusted base branch ${activeConfig.trustedBaseBranch} before lending this machine. The current branch is ${currentBranch || 'detached'}.`);
    }
    const managedDirty = await git(root, [
      'status', '--porcelain', '--', REVIEWED_PR_LOCAL_CI_CONFIG_PATH, REVIEWED_PR_LOCAL_CI_RUNNER_PATH, REVIEWED_PR_LOCAL_CI_WORKFLOW_PATH,
    ]);
    if (managedDirty) {
      throw new Error('The local-CI contract or workflow has uncommitted changes. Commit and review the trusted files first.');
    }
    const [runnerText, workflowText] = await Promise.all([
      fs.readFile(path.join(root, REVIEWED_PR_LOCAL_CI_RUNNER_PATH), 'utf8'),
      fs.readFile(path.join(root, REVIEWED_PR_LOCAL_CI_WORKFLOW_PATH), 'utf8'),
    ]);
    const managedFiles = assessManagedReviewedPrLocalCiFiles(activeConfig, runnerText, workflowText);
    if (!managedFiles.ok) {
      throw new Error(managedFiles.blockers.join(' '));
    }

    const candidates = await fetchOpenCandidates(root);
    const eligible = candidates.filter(item => assessReviewedPrCandidate(activeConfig, item).allowed);
    if (eligible.length === 0) {
      const refused = candidates.flatMap(item => assessReviewedPrCandidate(activeConfig, item).blockers.map(blocker => `#${item.number}: ${blocker}`));
      void vscode.window.showInformationMessage(
        refused.length > 0
          ? `No open PR is eligible for local CI. ${refused.slice(0, 3).join(' ')}`
          : `No open pull request targets ${activeConfig.trustedBaseBranch} in ${activeConfig.repository}.`,
      );
      return;
    }

    const selected = await vscode.window.showQuickPick(
      eligible.map(item => ({
        label: `$(git-pull-request) #${item.number} ${item.title}`,
        description: `${item.headBranch} → ${item.baseBranch}`,
        detail: `${item.author} · ${item.headSha}`,
        item,
      })),
      {
        title: 'Reviewed pull request local CI',
        placeHolder: 'Choose the exact PR commit to inspect and approve',
        ignoreFocusOut: true,
        matchOnDescription: true,
        matchOnDetail: true,
      },
    );
    if (!selected) {
      return;
    }
    candidate = selected.item;

    for (;;) {
      const copy = buildReviewedPrApprovalCopy(activeConfig, candidate);
      const choice = await vscode.window.showWarningMessage(
        copy.title,
        { modal: true, detail: copy.detail },
        'Open diff',
        copy.approveLabel,
      );
      if (choice === 'Open diff') {
        if (candidate.url) {
          await vscode.env.openExternal(vscode.Uri.parse(`${candidate.url}/files`));
        }
        continue;
      }
      if (choice !== copy.approveLabel) {
        return;
      }
      break;
    }

    const refreshed = await refetchCandidate(root, candidate.number);
    if (!refreshed) {
      throw new Error('The selected pull request could not be re-read after approval.');
    }
    const refreshedAssessment = assessReviewedPrCandidate(activeConfig, refreshed);
    if (!refreshedAssessment.allowed || refreshed.headSha !== candidate.headSha) {
      throw new Error(
        refreshed.headSha !== candidate.headSha
          ? `PR #${candidate.number} changed from ${candidate.headSha} to ${refreshed.headSha}. Review and approve the new commit separately.`
          : refreshedAssessment.blockers.join(' '),
      );
    }
    candidate = refreshed;

    const runnerConfiguration = readRunnerConfiguration(activeConfig);
    if (!runnerConfiguration.enabled) {
      throw new Error('Local CI is disabled on this machine. Enable atlasmind.ci.localRunner.enabled, then inspect the runner from the Pipeline page.');
    }
    const workflowReview = await reviewTrustedLocalCiWorkflow(
      root,
      runnerConfiguration,
      activeConfig.repository,
      activeConfig.runnerLabel,
    );
    if (workflowReview.state !== 'ok') {
      throw new Error(workflowReview.blockers.join(' ') || 'The reviewed-PR workflow did not pass the trusted runner policy.');
    }

    const baseSha = (await git(root, ['rev-parse', 'HEAD'])).toLowerCase();
    const waitingBeforeDispatch = await listWaitingWorkflowRuns(root, activeConfig);
    if (waitingBeforeDispatch.length > 0) {
      throw new Error(
        `The reviewed-PR workflow already has waiting or running job${waitingBeforeDispatch.length === 1 ? '' : 's'} `
        + `(${waitingBeforeDispatch.slice(0, 5).map(run => run.databaseId).join(', ')}). `
        + 'Clear or finish those runs before dispatching another exact SHA.',
      );
    }
    const previouslySeen = new Set(waitingBeforeDispatch.map(run => run.databaseId));
    await publishStatus(root, activeConfig, candidate, 'pending', 'Approved exact SHA is waiting for the one-job local runner.').catch(error => {
      output.appendLine(`[status warning] ${safeFailure(error)}`);
    });
    await runGhOrThrow(root, buildReviewedPrDispatchArgs(activeConfig, candidate), {
      timeoutMs: 20_000,
      maxBufferBytes: 512 * 1024,
    });
    output.appendLine(`[dispatch] PR #${candidate.number} ${candidate.headSha}`);
    queuedRunId = await waitForQueuedWorkflow(root, activeConfig, baseSha, candidate, previouslySeen);
    output.appendLine(`[queue] Bound to newly dispatched run ${queuedRunId}.`);

    let resolveCompletion!: (snapshot: LocalCiRunnerSnapshot) => void;
    const completion = new Promise<LocalCiRunnerSnapshot>(resolve => { resolveCompletion = resolve; });
    let manager!: LocalCiRunnerManager;
    manager = new LocalCiRunnerManager(
      root,
      runnerConfiguration,
      line => output.appendLine(line),
      () => {
        const snapshot = manager.getSnapshot();
        if (TERMINAL_RUNNER_STATES.has(snapshot.lifecycle)) {
          resolveCompletion(snapshot);
        }
      },
    );
    await manager.start(runnerConfiguration, async plan => {
      const choice = await vscode.window.showWarningMessage(
        `Lend this computer to PR #${candidate!.number}?`,
        {
          modal: true,
          detail: [
            `Approved SHA: ${candidate!.headSha}`,
            `Queued run: ${plan.queuedRun.databaseId}`,
            `Runner label: ${plan.runnerLabel}`,
            `Limit: ${plan.resources.cpus} CPUs, ${plan.resources.memoryGb} GB RAM`,
            plan.engineWillStart ? 'Docker Desktop is stopped and AtlasMind will start it.' : 'Docker is already running.',
            plan.imageMayBePulled ? 'The digest-pinned runner image is absent and will be downloaded.' : 'The digest-pinned runner image is already present.',
            '',
            'The worker is one-job and ephemeral. It receives no repository/environment secret, host mount, Docker socket, or native-platform authority.',
            'It still has outbound network access for GitHub and dependency installation. Start it only after reviewing the proposed code; Docker is defence in depth, not a guarantee that malicious code is safe.',
          ].join('\n'),
        },
        'Start isolated runner',
      );
      return choice === 'Start isolated runner';
    }, queuedRunId);
    const startedSnapshot = manager.getSnapshot();
    if (startedSnapshot.lifecycle === 'ready' && !startedSnapshot.containerName) {
      if (queuedRunId !== undefined) {
        await cancelReviewedPrRun(root, queuedRunId).catch(error => output.appendLine(`[cancel warning] ${safeFailure(error)}`));
      }
      await publishStatus(root, activeConfig, candidate, 'error', 'The operator cancelled the isolated local runner start.').catch(() => undefined);
      void vscode.window.showInformationMessage(`AtlasMind did not start local CI for PR #${candidate.number}.`);
      return;
    }
    const completedRunner = await waitForManager(manager, completion);
    const runId = completedRunner.queuedRun?.databaseId;
    if (!runId) {
      throw new Error(completedRunner.message || 'The local runner ended without a GitHub run identity.');
    }
    const run = await readRunConclusion(root, runId);
    const passed = run.status === 'completed' && run.conclusion === 'success';
    await publishStatus(
      root,
      activeConfig,
      candidate,
      passed ? 'success' : run.status === 'completed' ? 'failure' : 'error',
      passed ? 'All declared checks passed on the approved exact SHA.'
        : run.status === 'completed' ? `Local CI concluded ${run.conclusion || 'without success'}.`
          : 'The local runner ended, but GitHub did not expose a final conclusion.',
      run.url,
    ).catch(error => output.appendLine(`[status warning] ${safeFailure(error)}`));

    if (passed) {
      void vscode.window.showInformationMessage(`AtlasMind local CI passed for PR #${candidate.number} at ${candidate.headSha.slice(0, 12)}.`);
    } else {
      void vscode.window.showErrorMessage(`AtlasMind local CI did not pass for PR #${candidate.number}. Open the Actions run or local-CI output for details.`);
    }
  } catch (error) {
    const detail = safeFailure(error);
    output.appendLine(`[error] ${detail}`);
    if (queuedRunId !== undefined) {
      await cancelReviewedPrRun(root, queuedRunId).catch(cancelError => {
        output.appendLine(`[cancel warning] ${safeFailure(cancelError)}`);
      });
    }
    if (config && candidate) {
      await publishStatus(root, config, candidate, 'error', detail).catch(() => undefined);
    }
    void vscode.window.showErrorMessage(`AtlasMind reviewed-PR local CI stopped: ${detail}`);
  }
}
