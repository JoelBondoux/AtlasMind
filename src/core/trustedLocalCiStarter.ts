/**
 * Construct the trusted local-CI workflow, so nobody has to hand-author it.
 *
 * `assessTrustedLocalCiWorkflow` enforces a dozen exacting rules before this
 * machine is lent to a GitHub job — an owner-actor condition, exact repository
 * and ref conditions, exactly one job routed to the runner label, `contents:
 * read` and no write grant, no secret reference, `persist-credentials: false`,
 * and full-commit-SHA pinning on every action. Until this module existed the
 * file carrying all of that was the *one* artifact in the flow a person had to
 * write themselves, from a documentation template, and the validator only saw
 * it at the last step of four. The template had meanwhile drifted: it named no
 * actor condition, used a `runs-on` shape the label check does not accept, and
 * carried a placeholder label that matched no configured value. Somebody
 * following the documentation faithfully met three blockers at the end of the
 * longest path in the product.
 *
 * Four rules hold this together.
 *
 * **The generator is checked against the validator, not against a template.**
 * A property test builds workflows from arbitrary valid inputs and asserts
 * every one passes `assessTrustedLocalCiWorkflow`. That is the whole defence
 * against the drift that just happened: prose cannot be tested, and a second
 * copy of the rules would diverge exactly as quietly as the first one did.
 *
 * **Action SHAs are constants here, never parsed and never generated.** Pinning
 * is the supply-chain boundary; a SHA lifted from fetched documentation or from
 * model output is not a boundary, it is a boundary-shaped string. This is the
 * same rule `acpInstaller` applies to install commands. The values below are
 * this repository's own reviewed pins, and `TRUSTED_LOCAL_CI_ACTIONS_REVIEWED`
 * records which release each one was reviewed as.
 *
 * **An input that does not validate is refused, never coerced.** A branch name
 * quietly repaired into something adjacent would route real jobs at a ref
 * nobody chose, and the file is committed, so the mistake outlives the session.
 * Every refusal names what was wrong rather than returning a bare `undefined`,
 * because the caller's job is to tell somebody how to fix it.
 *
 * **The plan states what the file permits and refuses in plain words.** The
 * confirmation dialog has to be readable by somebody who has never pinned an
 * action, while the YAML underneath stays fully inspectable for somebody who
 * has. Those are two audiences for one artifact, not two artifacts.
 *
 * Pure: no `vscode`, no filesystem. The caller derives the facts, this composes
 * the bytes, and writing stays create-only at the call site.
 */

import { assessTrustedLocalCiWorkflow } from './localCiRunner.js';
import { safeWorkflowBranchRef } from './ciManager.js';
import { parseRepoSlug } from './githubDeepLinks.js';

/**
 * The actions the trusted workflow uses, pinned to full commit SHAs.
 *
 * Provenance is this repository's reviewed `.github/workflows/trusted-local-ci.yml`
 * rather than a documentation page, because a pin is only as trustworthy as the
 * review behind it and that file's pins were reviewed here. Updating one means
 * reviewing the new commit and changing the release note beside it — not
 * following a tag.
 */
export const TRUSTED_LOCAL_CI_ACTIONS_REVIEWED = {
  checkout: { name: 'actions/checkout', release: 'v7', sha: '3d3c42e5aac5ba805825da76410c181273ba90b1' },
  setupNode: { name: 'actions/setup-node', release: 'v7', sha: '820762786026740c76f36085b0efc47a31fe5020' },
} as const;

/** Mirrors the runner's own configuration checks, so a scaffold cannot produce a file the runtime path then rejects. */
const WORKFLOW_FILE = /^[A-Za-z0-9._-]+\.ya?ml$/;
const TRUSTED_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$/;
const RUNNER_LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SCRIPT_NAME = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,100}$/;
const NODE_VERSION = /^(?:\d{1,3})(?:\.\d{1,3}){0,2}(?:\.x)?$/;

/** The scripts a trusted quality job runs, in the order a failure is most usefully read. */
const VALIDATION_SCRIPT_ORDER = ['compile', 'build', 'lint', 'test'] as const;

export type TrustedLocalCiPackageManager = 'npm' | 'pnpm' | 'yarn';

export interface TrustedLocalCiStarterInput {
  /** A slug or a remote URL; both arrive from git and both are parsed, never trusted. */
  repoRemote: string;
  trustedBranch: string;
  /** Already expanded for this machine's architecture — YAML cannot expand `{arch}`. */
  runnerLabel: string;
  workflowFile: string;
  packageManager: TrustedLocalCiPackageManager;
  scripts: readonly string[];
  /**
   * The Node major to pin, resolved by `nodeVersionDetection`.
   *
   * Required. It was optional and nothing ever passed it, so the default behind
   * it was not a fallback but the only value this ever wrote — see the same note
   * on `NodeCiStarterInput`.
   */
  nodeVersion: string;
}

export interface TrustedLocalCiStarterPlan {
  /** Workspace-relative, POSIX separators. */
  path: string;
  workflowFile: string;
  repoSlug: string;
  trustedBranch: string;
  runnerLabel: string;
  packageManager: TrustedLocalCiPackageManager;
  validationScripts: string[];
  nodeVersion: string;
  pinnedActions: Array<{ name: string; release: string; sha: string }>;
  /** What this file lets happen, for a reader who has never pinned an action. */
  permits: string[];
  /** What it refuses, in the same voice. The security story is the readable half. */
  refuses: string[];
  content: string;
}

export type TrustedLocalCiStarterOutcome =
  | { ok: true; plan: TrustedLocalCiStarterPlan }
  | { ok: false; reason: string };

function safeScript(value: string): string | undefined {
  const trimmed = value.trim();
  return SCRIPT_NAME.test(trimmed) ? trimmed : undefined;
}

/**
 * A version number, or nothing. Refuses rather than coercing: this value is
 * interpolated into YAML that runs on a machine the user is lending, and
 * substituting a runtime nobody asked for is how a generator comes to emit the
 * same version forever.
 */
function nodeVersionOf(value: string): string | undefined {
  const trimmed = value.trim();
  return NODE_VERSION.test(trimmed) ? trimmed : undefined;
}

function installCommand(packageManager: TrustedLocalCiPackageManager): string {
  return packageManager === 'npm' ? 'npm ci'
    : packageManager === 'pnpm' ? 'pnpm install --frozen-lockfile'
      : 'yarn install --immutable';
}

function runCommand(packageManager: TrustedLocalCiPackageManager, script: string): string {
  return packageManager === 'npm' ? `npm run ${script}` : `${packageManager} ${script}`;
}

function stepName(script: string): string {
  return script === 'test' ? 'Test' : script === 'lint' ? 'Lint' : script === 'compile' ? 'Compile' : 'Build';
}

/**
 * Build the workflow, or say why not.
 *
 * The composed text is put back through `assessTrustedLocalCiWorkflow` before it
 * is returned. That looks redundant next to the property test and is not: the
 * test proves the *shape* is right for generated inputs, while this proves the
 * exact bytes this caller is about to write are accepted by the exact validator
 * that will gate the run. A scaffolder that hands somebody a file its own
 * runtime path then refuses is worse than no scaffolder, because the failure
 * arrives with AtlasMind's authorship attached.
 */
export function buildTrustedLocalCiStarter(input: TrustedLocalCiStarterInput): TrustedLocalCiStarterOutcome {
  const slug = parseRepoSlug(input.repoRemote);
  if (!slug) {
    return {
      ok: false,
      reason: 'The repository could not be identified from the git remote. A trusted workflow names its own repository in an authorization condition, so AtlasMind will not guess it.',
    };
  }
  const repoSlug = `${slug.owner}/${slug.repo}`;

  const branch = input.trustedBranch.trim();
  // Two checks on purpose: the shape rules the hosted starter applies to any
  // branch entering YAML, and the narrower grammar the runner's own preflight
  // will re-apply at start time. Passing only the first would scaffold a file
  // that the run path later refuses for a reason the scaffolder never showed.
  if (!safeWorkflowBranchRef(branch) || !TRUSTED_BRANCH.test(branch)) {
    return {
      ok: false,
      reason: `"${branch.slice(0, 60)}" is not a branch name AtlasMind will write into an authorization condition. Set atlasmind.ci.localRunner.trustedBranch to the reviewed branch first.`,
    };
  }

  const runnerLabel = input.runnerLabel.trim();
  if (!RUNNER_LABEL.test(runnerLabel)) {
    return {
      ok: false,
      reason: 'The runner label is not valid after architecture expansion. Inspect the machine first so AtlasMind can resolve the label Docker will actually report.',
    };
  }

  const workflowFile = input.workflowFile.trim();
  if (!WORKFLOW_FILE.test(workflowFile)) {
    return {
      ok: false,
      reason: 'The workflow setting must be one YAML filename inside .github/workflows.',
    };
  }

  const available = new Set(input.scripts.map(safeScript).filter((value): value is string => Boolean(value)));
  const validationScripts = VALIDATION_SCRIPT_ORDER.filter(script => available.has(script));
  if (validationScripts.length === 0) {
    return {
      ok: false,
      reason: 'This project declares no compile, build, lint, or test script, so there is nothing for a trusted job to verify. Add one to package.json first.',
    };
  }

  const nodeVersion = nodeVersionOf(input.nodeVersion);
  if (!nodeVersion) {
    return { ok: false, reason: `"${input.nodeVersion}" is not a Node version number.` };
  }
  // Corepack rather than `pnpm/action-setup`, deliberately. A third action
  // means a third commit SHA to review and re-review, and the only pins this
  // module may emit are ones somebody actually reviewed. Corepack ships with
  // Node, so the same two pinned actions serve all three package managers.
  const packageManagerSetup = input.packageManager === 'npm'
    ? ''
    : `      - name: Enable ${input.packageManager} through Corepack\n        shell: bash\n        run: corepack enable ${input.packageManager}\n\n`;
  const validationSteps = validationScripts
    .map(script => `      - name: ${stepName(script)}\n        run: ${runCommand(input.packageManager, script)}`)
    .join('\n\n');

  // Written out rather than templated from a rule list: this text is the
  // authorization boundary, and a reader has to be able to check it against the
  // rules by eye. Nothing here may mention an untrusted trigger even in a
  // comment — the validator reads the whole document, which is correct, since a
  // commented-out trigger is one uncomment away from being a real one.
  const content = `name: Trusted local CI

# This file authorises one borrowed machine to run one job.
#
# The runner label routes work; the conditions below are what authorise it.
# Only ${slug.owner}'s push to ${branch}, or their manual dispatch of that exact
# ref, can reach this job. It receives no secret and no write permission, and
# both actions are pinned to reviewed commits rather than moving tags.
#
# AtlasMind re-reads and re-checks this file immediately before lending the
# machine. Weakening a condition here does not weaken that check; it stops the
# run instead.
on:
  push:
    branches: [${branch}]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: trusted-local-ci-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  trusted-quality:
    name: Trusted quality
    if: >-
      (github.event_name == 'push' || github.event_name == 'workflow_dispatch') &&
      github.repository == '${repoSlug}' &&
      github.ref == 'refs/heads/${branch}' &&
      github.actor == github.repository_owner
    # Register the borrowed runner with --no-default-labels and this one public
    # routing label. Never place this label on a daily-use workstation.
    runs-on: [${runnerLabel}]
    timeout-minutes: 45
    env:
      CI: true
      # Keep TLS verification on while allowing a verified operator CA that is
      # installed in the container's own trust store.
      NODE_EXTRA_CA_CERTS: /etc/ssl/certs/ca-certificates.crt

    steps:
      - name: Check out the reviewed commit
        # ${TRUSTED_LOCAL_CI_ACTIONS_REVIEWED.checkout.release}; a full SHA is the immutable action boundary.
        uses: ${TRUSTED_LOCAL_CI_ACTIONS_REVIEWED.checkout.name}@${TRUSTED_LOCAL_CI_ACTIONS_REVIEWED.checkout.sha}
        with:
          clean: true
          fetch-depth: 1
          persist-credentials: false

      - name: Set up Node.js
        # ${TRUSTED_LOCAL_CI_ACTIONS_REVIEWED.setupNode.release}; no shared dependency cache is restored onto the runner.
        uses: ${TRUSTED_LOCAL_CI_ACTIONS_REVIEWED.setupNode.name}@${TRUSTED_LOCAL_CI_ACTIONS_REVIEWED.setupNode.sha}
        with:
          node-version: ${nodeVersion}

${packageManagerSetup}      - name: Use a per-job dependency cache
        shell: bash
        run: echo "NPM_CONFIG_CACHE=$RUNNER_TEMP/npm-cache" >> "$GITHUB_ENV"

      - name: Install locked dependencies
        run: ${installCommand(input.packageManager)}

${validationSteps}
`;

  const assessment = assessTrustedLocalCiWorkflow(content, { repoSlug, branch, runnerLabel });
  if (!assessment.ok) {
    // Unreachable by construction and deliberately not swallowed: if it ever
    // fires, the generator and the validator have disagreed, and shipping the
    // file anyway would put AtlasMind's name on a workflow it will later refuse.
    return {
      ok: false,
      reason: `AtlasMind built a workflow its own safety check rejected, so nothing was written. This is a bug — please report it. ${assessment.blockers.join(' ')}`,
    };
  }

  return {
    ok: true,
    plan: {
      path: `.github/workflows/${workflowFile}`,
      workflowFile,
      repoSlug,
      trustedBranch: branch,
      runnerLabel,
      packageManager: input.packageManager,
      validationScripts: [...validationScripts],
      nodeVersion,
      pinnedActions: [
        { ...TRUSTED_LOCAL_CI_ACTIONS_REVIEWED.checkout },
        { ...TRUSTED_LOCAL_CI_ACTIONS_REVIEWED.setupNode },
      ],
      permits: [
        `${slug.owner} pushing to ${branch} may run these checks on a machine you explicitly lend, one job at a time.`,
        `${slug.owner} may also start a run by hand, but only against ${branch}.`,
        `The checks that run are: ${validationScripts.join(', ')}.`,
      ],
      refuses: [
        'Code from a fork, or from a proposed change nobody has merged, can never reach this machine — those triggers are absent from the file.',
        'The job gets no repository or environment secret, and its token can only read the repository.',
        `Anyone other than ${slug.owner} triggering this workflow is refused by the job itself, not merely unlikely to match.`,
        'Both actions are pinned to an exact reviewed commit, so nobody can change what runs by moving a tag.',
      ],
      content,
    },
  };
}
