/**
 * Where the reviewed-PR local-CI route stands in the open repository, read from
 * the files and git — and never from a model or a webview.
 *
 * The Pipeline page used to carry no fact about this route at all: the card
 * showed two hard-coded buttons with "Patch repository" primary whatever the
 * repository held, and the only way to learn that a different repository was
 * open, that the contract was disabled, or that the trusted files had
 * uncommitted edits was to press Run and read the refusal. Those are exactly
 * the checks `runReviewedPullRequestOnLocalCi` performs before it dispatches,
 * so they are derived here from the same inputs, pure, and shown before anybody
 * presses anything.
 *
 * Six rules.
 *
 * - **Absent is not disabled.** No contract means the folder was never patched;
 *   a disabled contract means it was and something stopped it. The fixes differ
 *   (patch, versus open the file), so they are separate states.
 * - **Unknown is never clean.** A branch or status that could not be read
 *   yields `undefined`, which renders as "not checked", never as "ready".
 * - **Blockers are the command's own words.** The sentences here match what the
 *   run command refuses with, so the card and the refusal cannot disagree.
 * - **One next action, chosen from a declared table** (`REVIEWED_PR_NEXT_ACTIONS`),
 *   in the order the run command checks things, so the button offered is the
 *   step that would otherwise fail first.
 * - **The folder is named on every state.** With a different repository open the
 *   first fact a person needs is which folder was read.
 * - **Nothing here runs, reads a setting or touches GitHub.** Inputs are text
 *   the host read; the output is a value the webview renders and a test walks.
 */

import {
  REVIEWED_PR_LOCAL_CI_CONFIG_PATH,
  REVIEWED_PR_LOCAL_CI_RUNNER_PATH,
  REVIEWED_PR_LOCAL_CI_WORKFLOW_PATH,
  assessManagedReviewedPrLocalCiFiles,
} from './localCiRepositoryPatch.js';
import { parseReviewedPrLocalCiConfig } from './reviewedPrLocalCi.js';

export type ReviewedPrContractState = 'absent' | 'disabled' | 'invalid' | 'enabled';

/** What the card may offer. The host maps each to one fixed command or file. */
export type ReviewedPrNextAction =
  | 'patch'
  | 'open-contract'
  | 'commit-managed-files'
  | 'checkout-trusted-branch'
  | 'repatch'
  | 'review';

export interface ReviewedPrLocalCiStateInput {
  /** Basename of the folder the facts were read from. */
  folderName: string;
  /** Contents of `.atlasmind/local-ci.json`, or undefined when the file is absent. */
  contractRaw: string | undefined;
  /** Contents of the managed runner script, or undefined when absent. */
  runnerText?: string;
  /** Contents of the managed workflow, or undefined when absent. */
  workflowText?: string;
  /** `git branch --show-current`; empty string when detached; undefined when git could not answer. */
  currentBranch: string | undefined;
  /** `git status --porcelain -- <three managed paths>`; undefined when git could not answer. */
  managedStatus: string | undefined;
}

export interface ReviewedPrLocalCiState {
  folderName: string;
  contractPath: string;
  workflowPath: string;
  contract: ReviewedPrContractState;
  /** Why the contract is disabled or invalid, in the parser's words. */
  reason?: string;
  /** Facts from an enabled contract. Absent otherwise. */
  repository?: string;
  trustedBaseBranch?: string;
  statusContext?: string;
  commandCount?: number;
  /** The checked-out branch, when git answered. Empty means detached. */
  currentBranch?: string;
  /** Whether the checkout is on the trusted base branch. Undefined when either side is unknown. */
  onTrustedBranch?: boolean;
  /** Whether the three managed files have no uncommitted changes. Undefined when git did not answer. */
  managedFilesClean?: boolean;
  /** Whether the runner and workflow match this build's generator. Undefined until both files and an enabled contract were read. */
  managedFilesMatch?: boolean;
  /** What stops a run right now, in the order the run command would refuse. */
  blockers: string[];
  /** Whether the run command would get past its preconditions. False whenever anything is unknown. */
  runnable: boolean;
  nextAction: ReviewedPrNextAction;
  /** The rule from `REVIEWED_PR_NEXT_ACTIONS` that chose the action. */
  nextActionRule: string;
  /** One line for the card heading. */
  headline: string;
  /** One or two sentences under it. */
  detail: string;
}

/**
 * The next-action table, evaluated in order; the first matching row decides.
 * Published so a test can walk it and the card can cite it.
 */
export const REVIEWED_PR_NEXT_ACTIONS: ReadonlyArray<{ rule: string; action: ReviewedPrNextAction; when: string }> = [
  { rule: 'contract-absent', action: 'patch', when: 'No contract exists in the folder.' },
  { rule: 'contract-unusable', action: 'open-contract', when: 'The contract is disabled or does not parse.' },
  { rule: 'managed-files-dirty', action: 'commit-managed-files', when: 'A managed file has uncommitted changes.' },
  { rule: 'wrong-branch', action: 'checkout-trusted-branch', when: 'The checkout is not on the trusted base branch.' },
  { rule: 'managed-files-drifted', action: 'repatch', when: 'The runner or workflow does not match this build\'s generator.' },
  { rule: 'ready', action: 'review', when: 'Every precondition the run command checks is met or unknown-but-not-failed.' },
];

function trimmedBranch(value: string | undefined): string | undefined {
  return value === undefined ? undefined : value.trim();
}

/** Derive the route's standing from what the host read. Pure; never throws. */
export function deriveReviewedPrLocalCiState(input: ReviewedPrLocalCiStateInput): ReviewedPrLocalCiState {
  const base = {
    folderName: input.folderName,
    contractPath: REVIEWED_PR_LOCAL_CI_CONFIG_PATH,
    workflowPath: REVIEWED_PR_LOCAL_CI_WORKFLOW_PATH,
  };
  const currentBranch = trimmedBranch(input.currentBranch);

  if (input.contractRaw === undefined) {
    return {
      ...base,
      contract: 'absent',
      ...(currentBranch === undefined ? {} : { currentBranch }),
      blockers: [`No local-CI contract exists in ${input.folderName}: ${REVIEWED_PR_LOCAL_CI_CONFIG_PATH} is absent.`],
      runnable: false,
      nextAction: 'patch',
      nextActionRule: 'contract-absent',
      headline: `${input.folderName} is not patched for reviewed-PR local CI`,
      detail: 'Patching writes a contract, a shell-free runner and one manual workflow for you to review and commit on the trusted branch. If you meant a different repository, open that folder instead.',
    };
  }

  const parsed = parseReviewedPrLocalCiConfig(input.contractRaw);
  if (!parsed.ok) {
    const disabled = /\bdisabled\b/i.test(parsed.reason);
    return {
      ...base,
      contract: disabled ? 'disabled' : 'invalid',
      reason: parsed.reason,
      ...(currentBranch === undefined ? {} : { currentBranch }),
      blockers: [parsed.reason],
      runnable: false,
      nextAction: 'open-contract',
      nextActionRule: 'contract-unusable',
      headline: disabled
        ? `The local-CI contract in ${input.folderName} is disabled`
        : `The local-CI contract in ${input.folderName} cannot be read`,
      detail: parsed.reason,
    };
  }

  const config = parsed.config;
  const onTrustedBranch = currentBranch === undefined ? undefined : currentBranch === config.trustedBaseBranch;
  const managedFilesClean = input.managedStatus === undefined ? undefined : input.managedStatus.trim().length === 0;
  const managedFilesMatch = input.runnerText !== undefined && input.workflowText !== undefined
    ? assessManagedReviewedPrLocalCiFiles(config, input.runnerText, input.workflowText).ok
    : undefined;

  const blockers: string[] = [];
  let nextAction: ReviewedPrNextAction = 'review';
  let nextActionRule = 'ready';
  if (managedFilesClean === false) {
    blockers.push('The local-CI contract or workflow has uncommitted changes. Commit and review the trusted files first.');
    nextAction = 'commit-managed-files';
    nextActionRule = 'managed-files-dirty';
  }
  if (onTrustedBranch === false) {
    blockers.push(`Check out the trusted base branch ${config.trustedBaseBranch} before lending this machine. The current branch is ${currentBranch || 'detached'}.`);
    if (nextActionRule === 'ready') {
      nextAction = 'checkout-trusted-branch';
      nextActionRule = 'wrong-branch';
    }
  }
  if (managedFilesMatch === false) {
    blockers.push(`${REVIEWED_PR_LOCAL_CI_RUNNER_PATH} or ${REVIEWED_PR_LOCAL_CI_WORKFLOW_PATH} does not match the files this AtlasMind build generates. Run the repository patcher and review the refreshed files.`);
    if (nextActionRule === 'ready') {
      nextAction = 'repatch';
      nextActionRule = 'managed-files-drifted';
    }
  }
  if (input.runnerText === undefined || input.workflowText === undefined) {
    blockers.push('The managed runner or workflow file is missing. Run the repository patcher to restore it.');
    if (nextActionRule === 'ready') {
      nextAction = 'repatch';
      nextActionRule = 'managed-files-drifted';
    }
  }

  const unknowns: string[] = [];
  if (onTrustedBranch === undefined) {
    unknowns.push('the current branch');
  }
  if (managedFilesClean === undefined) {
    unknowns.push('whether the managed files are committed');
  }
  const runnable = blockers.length === 0 && unknowns.length === 0;

  const headline = blockers.length > 0
    ? `Patched, but not ready to run from ${input.folderName}`
    : runnable
      ? `Ready to run a reviewed PR from ${input.folderName}`
      : `Patched in ${input.folderName}; some checks could not be read`;
  const detail = blockers.length > 0
    ? blockers[0]!
    : runnable
      ? `Open PRs into ${config.trustedBaseBranch} of ${config.repository} can be approved one exact commit at a time. A pass posts the ${config.statusContext} check on that commit.`
      : `Git did not answer about ${unknowns.join(' and ')}. The run command checks again before it dispatches.`;

  return {
    ...base,
    contract: 'enabled',
    repository: config.repository,
    trustedBaseBranch: config.trustedBaseBranch,
    statusContext: config.statusContext,
    commandCount: config.commands.length,
    ...(currentBranch === undefined ? {} : { currentBranch }),
    ...(onTrustedBranch === undefined ? {} : { onTrustedBranch }),
    ...(managedFilesClean === undefined ? {} : { managedFilesClean }),
    ...(managedFilesMatch === undefined ? {} : { managedFilesMatch }),
    blockers,
    runnable,
    nextAction,
    nextActionRule,
    headline,
    detail,
  };
}

/**
 * The two-line explainer the Rules page shows above its executors. Kept here
 * so the wording that tells the two routes apart has one home.
 */
export const LOCAL_CI_ROUTES_EXPLAINER = {
  title: 'Two ways to use this computer for CI',
  reviewedPr: 'Reviewed PR: you approve one commit of one pull request, and AtlasMind posts the AtlasMind/local-ci check on that commit.',
  trustedBranch: 'Trusted-branch pushes: every push to the trusted branch queues a job you can lend this computer to.',
  footer: 'They use different workflow files. Setting one up does not set up the other.',
} as const;
