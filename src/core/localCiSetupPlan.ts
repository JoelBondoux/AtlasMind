/**
 * Local CI setup plan — the `/localci` walkthrough.
 *
 * Local CI has more external prerequisites than anything else in AtlasMind: a
 * committed workflow file satisfying a dozen rules, a machine-scoped
 * permission, the GitHub CLI, an authenticated GitHub session, a Docker engine,
 * and a queued job. Every other feature of that shape has a guide; this one did
 * not, so the way you discovered a missing prerequisite was by hitting the
 * failure it caused, four steps into a dashboard flow.
 *
 * Same discipline as the Buzz and ACP guides. State is **derived** from what is
 * actually on the machine rather than asked for, and **nothing here installs or
 * enables anything** — every action opens a surface, and the deny-by-default
 * permission stays the user's decision. A setup assistant that switched on the
 * gate controlling whether GitHub may execute code on your computer would have
 * removed the entire point of that gate.
 *
 * The step order follows the order things actually fail in, with one deliberate
 * exception at the front:
 *
 *   1. **The trusted workflow** — first because it is free. It is a file read,
 *      needing no Docker, no GitHub sign-in and no queued job, and a workflow
 *      that will be refused is worth discovering before installing anything.
 *      The dashboard used to check it last, which is exactly backwards.
 *   2. **Permission** — also free, and nothing else is worth doing while the
 *      machine-scoped gate is off.
 *   3. **GitHub CLI**, then **sign-in** — separate steps, because "not
 *      installed" and "installed but signed out" need different fixes, and
 *      collapsing them produces a guide that tells you to install what you have.
 *   4. **Docker** — last of the prerequisites: the largest install and the one
 *      most likely to need a restart.
 *   5. **Prove one job ran.** Configured is not working. A runner can be
 *      perfectly set up and never have executed anything, and the difference is
 *      invisible from every settings screen — the same reason the Buzz guide
 *      refuses to stop at "subscribed" and the ACP guide at "enabled".
 *
 * Steps 1–4 are what `isLocalCiReady` means. Step 5 is in the walkthrough but
 * not in that predicate, because reporting a never-used runner as *faulty*
 * would be wrong while reporting it as *finished* would be worse.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

import type { SetupGuideSummary, SetupStep, SetupStatus } from './setupWalkthrough.js';
import type { LocalCiWorkflowReview } from './localCiRunner.js';

export const LOCAL_CI_DOCS_URL = 'https://github.com/JoelBondoux/AtlasMind/blob/main/docs/local-ci-and-safe-runners.md';
export const GITHUB_CLI_URL = 'https://cli.github.com/';
export const DOCKER_DESKTOP_URL = 'https://docs.docker.com/desktop/';

/** Everything the plan needs, gathered by the caller from the runner snapshot. */
export interface LocalCiSetupState {
  /** Effective value of `atlasmind.ci.localRunner.enabled`. */
  permissionEnabled: boolean;
  /** Which settings scope supplied it, so a surprising value can be traced. */
  permissionSourceLabel?: string;
  /**
   * The last on-disk review of the trusted workflow.
   *
   * Absent means *not reviewed*, never *acceptable* — the same distinction the
   * runner snapshot keeps, and why this is optional rather than defaulted.
   */
  workflowReview?: LocalCiWorkflowReview;
  /** Configured workflow filename, for the step text before any review exists. */
  workflowFile: string;
  trustedBranch: string;
  /**
   * Whether prerequisites have been probed at all.
   *
   * Without this, an unprobed `false` renders as "not installed" and sends
   * somebody off to install software they may already have.
   */
  prerequisitesInspected: boolean;
  /**
   * Set when the prerequisite readings came from a stored inspection rather
   * than one run for this walkthrough.
   *
   * Present as a sentence rather than a boolean so every surface says the same
   * thing about the same record — the walkthrough, the `/setup` index and the
   * Pipeline page each describe it with `describeRememberedInspection`. A
   * remembered probe that is not labelled as one turns "you already did this"
   * into "this is true now", which is a different and unchecked claim.
   */
  inspectionObservedNote?: string;
  githubCliInstalled: boolean;
  githubAuthenticated: boolean;
  dockerCliInstalled: boolean;
  dockerEngineAvailable: boolean;
  /** Docker Desktop's CLI, which AtlasMind may start; absent means manual start. */
  dockerDesktopAvailable: boolean;
  /** Has a one-job runner ever completed in this workspace? */
  hasCompletedARun: boolean;
  /**
   * The queue command, already built and validated by
   * `buildLocalCiQueueInvocation`.
   *
   * Passed in rather than composed here for two reasons. Interpolating a
   * filename and a branch from settings into a GitHub CLI command line is the
   * exact template shape `ghExecBoundary` forbids — a rule worth keeping even
   * for a string that is only ever displayed, because the distance between
   * displayed and executed is one refactor. And the runner already owns the
   * validated answer, so composing a second one here would be a second answer
   * to what the queue command is.
   *
   * Absent means the configured filename or branch failed that validation, and
   * the step says so instead of printing something unusable.
   */
  queueCommand?: string;
}

export const LOCAL_CI_SETUP_GUIDE: SetupGuideSummary = {
  id: 'localci',
  label: 'Local CI',
  blurb: 'Run this repository\'s own GitHub CI job on your computer, in a one-job container, with no permanent runner.',
  command: '/localci',
  stepIds: ['workflow', 'permission', 'githubCli', 'githubAuth', 'docker', 'firstRun'],
};

/** Steps that must be done before a machine can be lent to a queued job. */
export const REQUIRED_LOCAL_CI_STEP_IDS = ['workflow', 'permission', 'githubCli', 'githubAuth', 'docker'] as const;

export function buildLocalCiSetupPlan(state: LocalCiSetupState): SetupStep[] {
  const review = state.workflowReview;
  const workflowOk = review?.state === 'ok';
  const workflowPath = review?.path ?? `.github/workflows/${state.workflowFile}`;
  const cliKnown = state.prerequisitesInspected;
  // Appends the provenance sentence to a reading that came from a memory, and
  // nothing to one probed just now. Applied only to details that assert a
  // positive machine fact: "not checked yet" needs no provenance, and a
  // negative reading sends somebody to look at their own machine anyway.
  const observed = (text: string): string => state.inspectionObservedNote
    ? `${text} ${state.inspectionObservedNote}`
    : text;
  const dockerReady = state.dockerCliInstalled && state.dockerEngineAvailable;

  // Readiness is computed from the same booleans the steps render, not by
  // re-reading the steps as they are built — a step cannot depend on the status
  // of one appended after it, and threading a half-built array through would
  // make the order load-bearing in a way nobody would notice breaking.
  const prerequisitesMet = workflowOk
    && state.permissionEnabled
    && state.githubCliInstalled
    && state.githubAuthenticated
    && dockerReady;

  const steps: SetupStep[] = [];

  // 1 — the trusted workflow. Free, and therefore first.
  steps.push({
    id: 'workflow',
    title: 'Decide what may run on this computer',
    status: workflowOk ? 'done' : 'todo',
    detail: !review
      ? `AtlasMind has not read ${workflowPath} yet. Checking it is a file read — no Docker, no GitHub sign-in and no queued job — so it is worth doing before anything is installed.`
      : review.state === 'ok'
        ? `${workflowPath} satisfies every rule AtlasMind checks before lending this machine.`
        : review.state === 'missing'
          ? `No trusted workflow exists at ${workflowPath}. AtlasMind can write one for you to review; it never overwrites an existing file.`
          : review.state === 'unreadable'
            ? `${workflowPath} could not be read. ${review.blockers[0] ?? ''}`.trim()
            : `${review.blockers.length} thing${review.blockers.length === 1 ? '' : 's'} must change in ${workflowPath} before this machine can be lent to it.`,
    guidance: workflowOk ? undefined : [
      {
        text: 'This one file decides which GitHub jobs may reach your computer. The runner label only routes work — the conditions inside the file are what authorise it.',
      },
      ...(review?.state === 'blocked'
        ? review.blockers.slice(0, 12).map(blocker => ({ text: blocker }))
        : []),
      {
        text: review?.state === 'missing'
          ? 'Open Pipeline → Runner and choose “Write it for me…”. AtlasMind derives the file from this repository’s remote, branch, runner label and package scripts, and states what it will permit and refuse before writing anything.'
          : 'Open Pipeline → Runner and choose “Check the trusted workflow”. Each item names one rule and the change that satisfies it.',
      },
      {
        text: 'AtlasMind re-reads and re-checks the committed file immediately before every run, so weakening a condition stops the run rather than widening it.',
      },
    ],
    docs: { url: LOCAL_CI_DOCS_URL, title: 'Local CI and safe self-hosted runners' },
    action: { command: 'atlasmind.openProjectDashboard', title: 'Open Pipeline → Runner' },
  });

  // 2 — the machine-scoped permission. Also free, and gates everything after it.
  steps.push({
    id: 'permission',
    title: 'Allow local CI on this machine',
    status: state.permissionEnabled ? 'done' : 'todo',
    detail: state.permissionEnabled
      ? `Local CI is allowed on this machine${state.permissionSourceLabel ? ` (from the ${state.permissionSourceLabel})` : ''}. Allowing it installs nothing and starts nothing.`
      : 'The machine-scoped permission is off. AtlasMind will not lend this computer to GitHub until you turn it on yourself.',
    guidance: state.permissionEnabled ? undefined : [
      {
        text: 'Turn on `atlasmind.ci.localRunner.enabled`. This is a permission, not an action: nothing is installed, no runner starts, and every run still asks for a separate confirmation naming the exact job.',
      },
      {
        text: 'It is machine-scoped on purpose — lending a computer is a decision about *this* computer, so a repository cannot make it for you by committing a setting.',
      },
    ],
    action: {
      command: 'workbench.action.openSettings',
      title: 'Open runner permission',
      args: ['atlasmind.ci.localRunner.enabled'],
    },
  });

  // 3 — the GitHub CLI. Separate from sign-in: different fixes.
  steps.push({
    id: 'githubCli',
    title: 'Install the GitHub CLI',
    status: !state.permissionEnabled ? 'blocked'
      : state.githubCliInstalled ? 'done' : 'todo',
    detail: !state.permissionEnabled
      ? 'Turn on the machine permission first.'
      : !cliKnown
        ? 'Not checked yet. Run Inspect on the Runner view and AtlasMind will report what is actually installed rather than guessing.'
        : state.githubCliInstalled
          ? observed('`gh` is installed and on the PATH this extension host can see.')
          : '`gh` was not found on PATH. AtlasMind uses it to read the queue and fetch a one-hour registration token; it never asks you for a token.',
    guidance: state.githubCliInstalled || !state.permissionEnabled ? undefined : [
      {
        text: 'The GitHub CLI is an operating-system application. Installing it adds no dependency to this repository and puts nothing in your workspace.',
        url: GITHUB_CLI_URL,
      },
      {
        text: 'AtlasMind can run the install from the Runner view, showing the exact command first — or install it yourself with your usual package manager.',
      },
      {
        text: 'A newly installed binary is often absent from the PATH this window already has. If Inspect still cannot find it, reload the VS Code window and inspect again.',
      },
    ],
    docs: { url: GITHUB_CLI_URL, title: 'GitHub CLI' },
    action: { command: 'atlasmind.openProjectDashboard', title: 'Open Pipeline → Runner' },
  });

  // 4 — sign in, through the CLI's own browser flow rather than a pasted token.
  steps.push({
    id: 'githubAuth',
    title: 'Sign in to GitHub',
    status: !state.githubCliInstalled ? 'blocked'
      : state.githubAuthenticated ? 'done' : 'todo',
    detail: !state.githubCliInstalled
      ? 'Install the GitHub CLI first — until then there is nothing to sign in with.'
      : state.githubAuthenticated
        ? observed('`gh` is signed in to github.com.')
        : '`gh` is installed but not signed in to github.com.',
    guidance: !state.githubCliInstalled || state.githubAuthenticated ? undefined : [
      {
        text: 'Use the GitHub CLI’s own browser sign-in. Do not paste a token into AtlasMind — it neither asks for one nor stores one.',
        command: 'gh auth login --hostname github.com --web',
      },
      {
        text: 'The registration token a run needs is fetched when it is needed and streamed straight into the container, so it never becomes a string AtlasMind holds.',
      },
    ],
  });

  // 5 — Docker. Largest install, most likely to need a restart, so last.
  steps.push({
    id: 'docker',
    title: 'Install and start Docker',
    status: !state.githubAuthenticated ? 'blocked'
      : dockerReady ? 'done' : 'todo',
    detail: !state.githubAuthenticated
      ? 'Sign in to GitHub first.'
      : !cliKnown
        ? 'Not checked yet. Run Inspect on the Runner view to see what Docker actually reports.'
        : !state.dockerCliInstalled
          ? 'The Docker CLI was not found. The job runs inside a one-job container, so there is no permanent runner service to install.'
          : !state.dockerEngineAvailable
            ? state.dockerDesktopAvailable
              ? 'Docker is installed but its engine is not running. AtlasMind can start Docker Desktop after you confirm a run, and closes it again according to your cleanup setting.'
              : 'Docker is installed but its engine is not running, and no Docker Desktop CLI was found. Start the engine yourself — AtlasMind never starts or stops an unmanaged system service.'
            : observed('The Docker engine is running and reporting its capacity.'),
    guidance: dockerReady || !state.githubAuthenticated ? undefined : [
      {
        text: 'Docker is an operating-system application installed outside the workspace. AtlasMind runs GitHub’s official runner image in a single container and removes the registration when the job ends.',
        url: DOCKER_DESKTOP_URL,
      },
      {
        text: 'The container gets no host folders, no Docker socket, no inbound port, no GPU, no repository secrets and no OIDC permission. It is non-root, drops Linux capabilities, and is capped so a bad job cannot consume the whole machine.',
      },
      {
        text: 'Evidence is Linux-container behaviour only. A Linux container on Windows or macOS does not prove native behaviour on those systems, and AtlasMind labels it that way rather than counting it as platform coverage.',
      },
    ],
    docs: { url: DOCKER_DESKTOP_URL, title: 'Docker Desktop' },
    action: { command: 'atlasmind.openProjectDashboard', title: 'Open Pipeline → Runner' },
  });

  // 6 — prove it. Configured is not working.
  const firstRunStatus: SetupStatus = state.hasCompletedARun ? 'done' : prerequisitesMet ? 'todo' : 'blocked';
  steps.push({
    id: 'firstRun',
    title: 'Prove one job actually runs',
    status: firstRunStatus,
    detail: state.hasCompletedARun
      ? 'A one-job runner has completed here, so the whole path is known to work end to end.'
      : prerequisitesMet
        ? `Everything is configured, but no job has run yet. Push or dispatch ${state.trustedBranch} to queue one, then lend the machine to it.`
        : 'Finish the steps above first.',
    guidance: state.hasCompletedARun ? undefined : [
      {
        text: `Commit and push to ${state.trustedBranch}, or queue the workflow by hand. GitHub can only run the commit already pushed — never uncommitted or unpushed local files.`,
        ...(state.queueCommand ? { command: state.queueCommand } : {}),
      },
      ...(state.queueCommand ? [] : [{
        text: 'AtlasMind cannot show the queue command: the configured workflow filename or trusted branch is not a value it will put on a command line. Fix `atlasmind.ci.localRunner.workflowFile` and `atlasmind.ci.localRunner.trustedBranch` first.',
      }]),
      {
        text: 'Then choose “Check GitHub queue → review start plan” on the Runner view. AtlasMind re-checks everything and shows exactly what it will do before starting a container.',
      },
      {
        text: 'A clean runner exit is not a passing test. Read GitHub’s own verdict afterwards.',
      },
    ],
    action: { command: 'atlasmind.openProjectDashboard', title: 'Open Pipeline → Runner' },
  });

  return steps;
}

/**
 * Whether the prerequisites are satisfied — not whether anything has ever run.
 *
 * Deliberately excludes `firstRun`, for the reason the module comment gives: a
 * correctly configured runner that has never executed a job is ready, and
 * calling it unready would send somebody to fix something that is not broken.
 */
export function isLocalCiReady(steps: SetupStep[]): boolean {
  return REQUIRED_LOCAL_CI_STEP_IDS.every(id => steps.find(step => step.id === id)?.status === 'done');
}
