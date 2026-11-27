# Local CI and safe self-hosted runners

Run AtlasMind's quality gates directly on your own machine when GitHub Actions is unavailable, when you
want feedback before pushing, or when a hosted run would add no evidence. Direct local execution is the
simplest posture. A public repository can also use a GitHub-connected self-hosted runner for reviewed code
on a protected branch, provided untrusted pull-request jobs cannot select it and the runner is isolated
from personal data and long-lived credentials.

## Two ways to use this computer

Both routes run GitHub Actions jobs in a one-job Linux container on your machine. They are set up
separately, use different workflow files, and setting one up does not set up the other.

| | Reviewed pull request | Trusted-branch pushes |
|---|---|---|
| What runs | One commit of one open pull request you approve | Every push to the trusted branch, as it is queued |
| How it starts | **Run reviewed PR** (Pipeline card, `/localci review`) | A push, or a manual queue of the trusted workflow |
| Workflow file | `.github/workflows/atlasmind-reviewed-pr-local-ci.yml`, generated from `.atlasmind/local-ci.json` | `atlasmind.ci.localRunner.workflowFile` (default `trusted-local-ci.yml`) |
| What you see on GitHub | The `AtlasMind/local-ci` commit status on that commit | The workflow run's own result |
| Settings it reads | The committed contract (repository, trusted base branch, commands); the machine-scoped runner permission and image | `atlasmind.ci.localRunner.*`, including `workflowFile` and `trustedBranch` |
| Where on the Pipeline page | The reviewed-PR card and the first executor row on Runners & rules | The "This computer, lent to one job" drawer on Runners & rules |

The reviewed-PR route ignores `atlasmind.ci.localRunner.workflowFile` and `trustedBranch`: it takes both
from the committed contract, so a repository cannot be run against a workflow its own contract did not
name.

## Choose the right mode

| Need | Use | Trust boundary |
|---|---|---|
| Check a change before pushing | Direct local CI | Runs only the checkout you selected, under your account |
| Reproduce Linux behaviour | A clean local Linux VM or container | Disposable environment; no GitHub runner registration |
| Run reviewed commits from a trusted branch | A dedicated runner host, VM, or isolated container with a unique label | No PR trigger, no long-lived secrets, least-privilege token, branch controls and an isolated runner account |
| Run one reviewed same-repository PR before merge | AtlasMind reviewed-PR local CI | A person approves the exact current head SHA; the trusted base owns the fixed controller; one ephemeral container gets no repository/environment secrets, host mounts or Docker socket |
| Give each GitHub job a clean machine | Ephemeral or just-in-time runner in a disposable VM | One trusted job, then destroy the environment |
| Automatically run public, forked or otherwise unreviewed pull requests | GitHub-hosted runners | Never send unreviewed PR code to a personal or persistent machine |

### Reviewed pull requests: patch once, approve one SHA

AtlasMind also supports a narrower pre-merge route that never exposes a `pull_request` trigger to the
local runner. From **Project Dashboard → Pipeline**, **Project Dashboard → Pull Requests**, or
**Settings → Testing**, choose **Patch repository**. The Command Palette equivalents are
**AtlasMind: Patch This Repository for Local CI** and **AtlasMind: Run a Reviewed Pull Request on Local
CI**; chat accepts `/localci patch`, `/localci review`, `/localci-patch` and `/localci-review`.

The patcher asks which branch is the trusted base and proposes exactly three committed files:

- `.atlasmind/local-ci.json` -- repository identity, trusted base, dedicated runner label and argv
  command list;
- `.atlasmind/local-ci-runner.mjs` -- the fixed controller that spawns each command with `shell: false`;
- **.github/workflows/atlasmind-reviewed-pr-local-ci.yml** -- an owner-only manual workflow whose inputs
  are the PR number, same-repository slug and exact 40-character head SHA. In an organisation-owned
  repository it is limited to one pinned account instead; see
  [Organisation-owned repositories](#organisation-owned-repositories).

For npm, pnpm and Yarn projects with exactly one supported lockfile, AtlasMind proposes a locked install
and either the project's aggregate CI script or its compile/build/lint/test sequence. Publishing and
deployment-shaped scripts are never inferred. Any other stack can still be patched, but the contract is
created disabled: a maintainer must declare and review the executable/argument pairs before enabling it.
AtlasMind never overwrites an unrelated file at one of those paths, and it refreshes only files carrying
its management marker.

When **Run reviewed PR** is chosen, AtlasMind lists eligible open PRs, refuses drafts and forks, opens the
diff on request, and names the complete head SHA in the approval dialog. It re-reads the PR after that
approval; if the producer pushed another commit, the SHA changed and the run is refused until the new
commit is reviewed separately. The producer's brand or interface is not evidence: Codex, Claude,
Copilot, Cursor, another agentic service, AtlasMind and human-authored branches all follow this same
repository-and-SHA rule.

The trusted branch supplies the config, workflow and controller. Before dispatch, AtlasMind requires the
two executable controller files to match the bytes generated by the installed AtlasMind build, verifies
that all three files are committed and clean, and reuses the existing local-runner checks for exact
repository/ref/actor, immutable action pins, one unique runner label, Docker capacity and competing
runners. The candidate checkout receives no repository or environment secret, persisted checkout
credential, OIDC write permission, host mount or Docker socket. It retains outbound network access for
GitHub and dependency installation. Its evidence is **Linux container only**;
it does not replace Windows or macOS release checks.

This is still code execution. Docker is defence in depth, not a guarantee that malicious code is safe.
Approval should follow inspection of the exact diff, and the host should
remain a dedicated or otherwise appropriately isolated machine. The exact-SHA route prevents a reviewed
commit being silently replaced; it does not prove that the reviewed code is benign. Forks and automatic
PR triggers remain on hosted infrastructure.

### Organisation-owned repositories

A personal repository's local-CI workflows name its owner: `github.actor == github.repository_owner`. An
organisation owns no account. There `github.repository_owner` is the organisation's name, which no
actor's login can equal, so that condition is false on every run: GitHub skips the job before any runner
is asked, the organisation's own members included.

For an organisation-owned repository AtlasMind pins one account instead, by its numeric GitHub id:
`github.actor_id == '6105707'`. When it patches the repository or writes the trusted workflow, it asks
GitHub who owns the repository and pins the account signed in to GitHub CLI, the person who will approve
and dispatch the runs. The id is used rather than the login because a login can be renamed and then
claimed by somebody else, while an id never moves. The reviewed-PR contract records the pin as
`authorizedAccount` in `.atlasmind/local-ci.json` and the workflow is generated from it, so the
exact-bytes check covers the pin as well.

The same rule is checked again before anything runs. Before a reviewed-PR dispatch AtlasMind compares the
signed-in account with the pin, so a dispatch GitHub would skip is refused with a reason instead of
waiting out the queue. Before lending the machine it holds the queued run's actor to the pin, by id. If
GitHub CLI cannot say who owns the repository while patching, AtlasMind keeps an existing pin, or else
writes the owner condition and says so in the confirmation dialog.

Nothing changes for a personal repository: its files are generated byte for byte as before. To move the
pin to another account, have that person patch the repository again while signed in to GitHub CLI, then
review and commit the refreshed files to the trusted base branch.

GitHub's billing documentation currently says that standard GitHub-hosted runners are free for public
repositories and that self-hosted runner usage is free. If a public AtlasMind run is refused, first check
the repository budget, artifact and cache storage, runner availability, and the run's actual failure
message. Do not assume that included private-repository minutes are the cause.

## AtlasMind's interim operating decision

While AtlasMind is under active development, inability or unwillingness to buy additional hosted Actions
capacity must not stop ordinary implementation. Safety gates remain required; their execution location is
what changes:

- use the direct local sequence below for day-to-day development and record the result with the change;
- use an isolated trusted-branch runner when GitHub dispatch, shared logs, or branch-level visibility adds
  useful evidence;
- reserve provider-hosted operating-system matrices for release confidence and cases that genuinely need
  Linux, Windows, and macOS evidence; and
- never trade away isolation, token restrictions, secret handling, test coverage, or a required release
  check merely to reduce cost.

The repository now implements that split. `.github/workflows/ci.yml` spends hosted capacity automatically
only for pull requests into `main`, where its three platform jobs are required release checks; it remains
manually dispatchable for an intentional platform investigation. `.github/workflows/trusted-local-ci.yml`
accepts only the repository owner's `develop` push or exact-`develop` manual dispatch and routes it to
isolated hardware. It queues while the dedicated runner is offline and receives no repository/environment
secrets or OIDC permission.

## Third-party local executors

No runner daemon makes untrusted code safe merely by being open source or container-based. A workflow that
can reach the host Docker socket can usually control the host; a runner that invokes commands directly has
the runner account's filesystem and network authority. Select the isolation level below according to the
code being executed: a persistent dedicated host can serve protected, reviewed branches, while untrusted
pull requests require a disposable or hosted boundary.

| Executor | Cost and shape | Fit for AtlasMind | Important boundary |
|---|---|---|---|
| [`act`](https://nektosact.com/) | MIT-licensed local CLI; no service account or control plane | Best first adapter for executing existing GitHub Actions YAML on demand | Uses the Docker API; default images are intentionally incomplete, Windows/macOS parity is limited, and GitHub services such as artifacts and event payloads are only partially emulated |
| [Woodpecker CI](https://woodpecker-ci.org/) | Apache-2.0 server, CLI and agent | Best lightweight always-on local control plane; GitHub integration, Docker jobs, labels, and a single-workflow agent mode | Uses its own pipeline YAML; choose the Docker/Kubernetes backend because the local backend explicitly has no isolation; never grant privileged mode or host volumes to public repositories |
| [Semaphore Community Edition](https://docs.semaphore.io/getting-started/install) | Apache-2.0, self-hosted, free with unlimited users and concurrency | Best candidate for a complete professional self-hosted dashboard and scheduler | A larger platform to operate; self-hosted jobs are not isolated until container or disposable-machine isolation is configured |
| [Dagger](https://docs.dagger.io/) | Apache-2.0 local-first execution engine | Strong future portable pipeline engine with typed code, content-addressed caching and OpenTelemetry | Not a GitHub Actions YAML runner; adopting it means defining a second pipeline. Its custom engine is rootful and its default security policy permits insecure root capabilities, so do not treat it as an untrusted-code sandbox |
| [Buildkite agent](https://buildkite.com/docs/agent/self-hosted) | Open agent with a SaaS control plane; free Pro access is offered to approved open-source projects | Strong professionally operated provider adapter, signed-pipeline support and useful hardening controls | Not unconditionally free, and the self-hosted machine remains your responsibility; strict validation, disabled command evaluation/hooks/plugins, clean checkouts and disposable workers are still required |

For AtlasMind's first implementation, use `act` only as a manually invoked executor for trusted Linux jobs.
Do not run the `windows-latest` or `macos-latest` matrix legs through its Linux containers and call that
platform coverage. If AtlasMind later needs queues, webhooks and multiple workers, evaluate Woodpecker
before operating the heavier Semaphore stack. Buildkite remains a provider integration rather than the
local default.

AtlasMind should expose these through capability declarations, not one generic **Run CI** button. An
executor must state whether it supports GitHub workflow syntax, operating-system fidelity, containers,
secrets, artifacts, services, cancellation, concurrency and ephemeral workers. A missing capability is a
refusal or an explicit partial run, never an inferred success.

## Run the CI-equivalent checks locally

Use a clean checkout and the Node.js major version declared in `.github/workflows/ci.yml`. A developer
checkout may contain untracked files that change packaging results; a runner checkout must not reuse it.

```powershell
git status --short
node --version
npm --version
npm ci
npm run ci:local
```

`ci:local` runs compile, lint, the integration-coverage audit, the full suite, the focused local-model
recommendation regression, coverage, and VSIX packaging in fail-fast order. During edit/test iteration,
`npm run ci:local:quick` stops after the full test suite; it is feedback, not the complete pre-push gate.

Stop on the first failure. Do not use `npm audit fix`, approve blocked install scripts, lower coverage,
skip tests, or edit the lockfile merely to make the local run green. Those are repository changes and
need their own review.

The hosted secret-scan job examines full Git history. To reproduce it locally, install Gitleaks only from
the official `gitleaks/gitleaks` release, verify the published SHA-256 checksum before extraction, and run:

```powershell
gitleaks git --redact --config .gitleaks.toml .
```

Gitleaks reads `.gitleaksignore` from the repository root by itself. That file pins individual
findings that were read and judged synthetic, so a local run reports the same findings the hosted job does.

If using the project's official container image instead, pin an exact version or digest and mount the
checkout read-only. Do not use `latest` in a trusted runner.

### What a local pass proves

A pass proves the commands succeeded on the current operating system, Node/npm versions, checkout, and
machine. It does not prove:

- behaviour on the other operating systems in the hosted matrix;
- GitHub event expressions, token permissions, OIDC, environments, or branch protection;
- action download, cache, artifact upload, or Marketplace publishing behaviour;
- that an untracked file was absent from a package; or
- that the checkout used the same Node.js and dependency state as CI.

Read the `vsce package` file list. Unexpected directories, project memory, credentials, or unusually large
file counts are release blockers even when packaging exits successfully.

## Safe GitHub-connected runner

### Supported security postures

AtlasMind should not reduce this choice to `public repository = deny`. A CI integration should expose the
posture and its prerequisites, recommend the safest applicable option, and require an explicit opt-in when
the repository cannot prove a prerequisite:

| Posture | Intended workload | Required controls |
|---|---|---|
| Local-only | Developer-selected checkout | No runner registration; run the fixed commands directly |
| Trusted branch | Reviewed commits after merge | Protected ref, dedicated low-privilege host, PR jobs excluded, no long-lived secrets |
| Reviewed exact SHA | One inspected, same-repository PR before merge | Owner-only manual dispatch (one pinned account in an organisation-owned repository) from a trusted base, immutable approved SHA, fixed committed controller, ephemeral container, no secrets or host authority |
| Ephemeral/JIT | Trusted jobs needing stronger cleanup | Fresh VM or worker per job; deregister and destroy after completion |
| Hosted PR | Forked, automatic, or not-yet-reviewed contributions | GitHub-hosted or another provider-managed ephemeral runner |

The dashboard should report `blocked`, `allowed with cautions`, or `allowed` from observable controls. It
must not silently weaken a workflow, invent branch protection, or describe a custom runner label as an
authorization boundary.

AtlasMind's repository-specific branch, check and workflow values live in
[`github-workflow.md`](github-workflow.md); verify them in GitHub immediately before registration. Do not
turn those project values into defaults for other AtlasMind users. A trusted branch without enforceable
protection can still be exposed as an informed `allowed with cautions` choice, but it must not receive the
same assurance label as a protected ref.

### Trust boundary

Do not register a persistent runner for AtlasMind on a daily-use workstation. AtlasMind is public, and
GitHub warns that self-hosted runners can be persistently compromised by untrusted workflow code. An
environment approval protects secrets; it does not make the runner machine isolated.

Keeping repository and environment secrets off the runner is important but not sufficient. GitHub still
issues a job-scoped `GITHUB_TOKEN`, the runner registration is itself trusted infrastructure, and executed
code can persist on a long-lived host. Restrict the token to `contents: read`, disable credential
persistence after checkout, grant no OIDC `id-token: write`, and give the runner account nothing useful to
steal.

The branch filter in one trusted workflow is also not a runner access-control list. In a personal public
repository, another eligible workflow can name the same label. Require approval for **all external
contributors**, never approve an untrusted job that selects the self-hosted label, and keep the runner
offline when no reviewed job is expected. An organization runner group is stronger because it can be
restricted server-side to selected workflows pinned to a full branch, tag, or commit reference. GitHub's
workflow execution protections can additionally restrict actors and event types, but they apply more
broadly than a single runner and must not accidentally disable the hosted PR workflow.

For a trusted-branch GitHub run, use all of these controls:

1. Use a dedicated machine or VM, never a daily-use workstation. A disposable snapshot is preferred.
2. Give it no host folders, browser profile, SSH keys, cloud credentials, package-publishing tokens,
   OneDrive folders, or access to sensitive local-network services.
3. Use a non-administrator OS account. Permit only required outbound traffic; expose no inbound service.
4. Verify the chosen branch is protected against unreviewed writes in the live GitHub settings. A branch
   name containing `main`, `develop`, or `release` is not evidence that it is trusted.
5. Register at repository scope with a distinctive job label. Treat the label as routing metadata, not a
   secret or a permission check.
6. Configure GitHub to require approval for all external-contributor workflows. Never approve a PR job
   that asks for this self-hosted label. Prefer an organization runner group restricted to the exact
   trusted workflow when that control is available.
7. Give the workflow only `contents: read`, set checkout's `persist-credentials: false`, grant no OIDC
   permission, and supply no repository or environment secrets to validation jobs.
8. Trigger only on `push` to the protected ref or `workflow_dispatch` guarded by an exact repository and
   ref condition. Do not route `pull_request` to this runner. Never use `pull_request_target` to check out
   pull-request code.
9. Pin third-party actions to full commit SHAs, set a job timeout and concurrency limit, and keep the
   runner software and operating system patched.
10. Clean or reimage the worker after every job. Preserve diagnostic logs outside a disposable VM before
    destroying it. If a dependency or job is suspected of compromise, reimaging is mandatory.

For a production runner fleet, use just-in-time runners or GitHub Actions Runner Controller rather than the
single-machine procedure below.

### Define the trusted workflow first

**Let AtlasMind write this file.** Open **Project Dashboard → Pipeline → Runner** and select **Check the
trusted workflow**. The check is a file read: it needs no Docker, no GitHub sign-in and no queued job, so it
works as the first thing you do rather than the last. If no trusted workflow exists, the same card offers
**Write it for me…**, which shows what the file will permit and refuse in plain language, creates it for
your review, and never overwrites an existing file.

The generated file is derived from the repository's own facts — its remote, the configured trusted branch,
the runner label expanded for this machine's architecture, and the package scripts actually declared — and
it is checked against the same validator that gates a run before it is offered. That is the point of
generating it: this page previously carried a hand-maintained template that had drifted from the validator
and would have failed three of its rules, and prose cannot be tested. A property test now asserts that every
workflow AtlasMind generates passes the check, so the two cannot separate again.

Write it by hand only for a stack AtlasMind cannot derive (anything without a Node package and a recognised
lockfile). The shape it must satisfy is below; every rule in it is enforced, so treat the comments as
requirements rather than advice. Replace the repository, branch, label and action SHAs with reviewed values,
then use **Check the trusted workflow** to confirm it before installing anything else.

```yaml
name: Trusted local CI

on:
  push:
    branches: [TRUSTED_BRANCH]      # exactly this form, or a YAML list item
  workflow_dispatch:                # no other trigger may appear anywhere in the file

permissions:                        # required, and no write grant anywhere
  contents: read

concurrency:
  group: trusted-local-ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  trusted-quality:
    # All four conditions are required. A manual dispatch lets a caller choose a
    # branch, so the exact-ref check is what makes the branch filter enforcement
    # rather than decoration — and the actor check is what stops anyone else
    # reaching your machine through a workflow they can trigger.
    if: >-
      (github.event_name == 'push' || github.event_name == 'workflow_dispatch') &&
      github.repository == 'OWNER/REPOSITORY' &&
      github.ref == 'refs/heads/TRUSTED_BRANCH' &&
      github.actor == github.repository_owner
    # The label alone, with no `self-hosted` beside it, and used by exactly one
    # job in exactly one workflow file in the repository.
    runs-on: [ATLASMIND_TRUSTED_LABEL]
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@FULL_COMMIT_SHA
        with:
          persist-credentials: false     # required
      - uses: actions/setup-node@FULL_COMMIT_SHA
        with:
          node-version: 20
      - run: npm ci
      - run: npm run compile
      - run: npm run lint
      - run: npm run test
```

Do not copy this shape unchanged. Pinning every action to its own reviewed full commit SHA is deliberate; a
moving tag is not an immutable supply-chain boundary. In an organisation-owned repository the last
condition is `github.actor_id == 'YOUR_ACCOUNT_ID'` instead, because no account there is the repository
owner (see [Organisation-owned repositories](#organisation-owned-repositories)); the check accepts exactly
one of the two, never both. The file must also reference no GitHub secret: a
trusted-runner job that needs one is a job that should run on hosted infrastructure instead.

### Install one dedicated or disposable Windows runner

1. Create and patch a clean Windows VM. Install Git, the CI-pinned Node.js major version, and npm. Do not
   sign in to personal applications inside the VM.
2. In the target repository, open **Settings → Actions → Runners → New self-hosted runner** and choose
   Windows x64. Use the download URL, version, and SHA-256 verification command GitHub shows there; runner
   releases are progressive, so a version copied from a guide may be wrong for the repository.
3. Extract it under `C:\actions-runner`. The registration token displayed by GitHub expires after one hour;
   treat it as a credential and never paste it into a document, issue, script, or terminal transcript.
4. Register interactively from the VM with the distinctive label used by the reviewed workflow. For the
   strongest one-job posture, add `--ephemeral` and do **not** install it as a Windows service:

   ```powershell
   Set-Location C:\actions-runner
   .\config.cmd --url https://github.com/OWNER/REPOSITORY --token ONE_HOUR_TOKEN --ephemeral --no-default-labels --labels ATLASMIND_TRUSTED
   ```

   A persistent daemon may omit `--ephemeral` only on a dedicated, low-privilege runner host that meets the
   trusted-branch controls above. Keep it offline outside the intended CI window. Organization operators
   should prefer a selected-workflow runner group over repository-wide label routing.
5. Dispatch the reviewed workflow from its protected ref. Start an interactive or ephemeral runner only
   after that trusted job is queued:

   ```powershell
   .\run.cmd
   ```

6. When an ephemeral job finishes, confirm that GitHub de-registered the runner. Copy `_diag` logs to the
   approved log location, shut down the VM, and revert or destroy it. One job means one runner lifecycle.
   For a persistent dedicated host, stop the daemon, inspect the result, and restore a known-clean worker
   state before accepting another job.

Do not paste the registration token into a committed workflow. The runner label must appear in the
workflow and therefore is not secret. If GitHub dispatch is not needed, run the commands in the first
section and never register the machine.

### Connect the AtlasMind runner in Docker Desktop

AtlasMind's current local route uses GitHub's official Linux runner image inside Docker Desktop/Engine.
The repository's tested image is pinned to runner `2.338.2` by its multi-architecture index digest, which
covers the reviewed Linux x64 and arm64 manifests, so the default runs on either. An engine of any other
architecture is refused before the pull and must pin a digest that covers it. Before changing the pin, compare the digest with GitHub's package page and
inspect the selected platform manifest (the manual fallback below shows the commands).

#### The runner never updates itself

AtlasMind registers the runner with `--disableupdate`. Without it, GitHub tells a runner that is behind its
latest release to update itself as it takes a job. The runner's own `run-helper.sh` has an exit code (4) for
exactly this *ephemeral* update path: the listener downloads the new release into the container, renames
its own `bin` folder, links the new one in and relaunches. The job would then run on a binary nobody
reviewed rather than on the pinned digest, and when the update fails part-way (a TLS-inspecting proxy
blocking the download, or the in-container update that left one persistent runner without its
`bin/Runner.Listener` and restart-looping) the job is left unclaimed and the registration behind it.

Refusing self-update has a cost: the pin can fall behind, and GitHub's documentation says a runner with
automatic updates disabled must move to a newer version within 63 days of its release or GitHub stops
assigning jobs to it (sooner for a critical security update). So **Inspect prerequisites** reads GitHub's
latest runner release (`gh api repos/actions/runner/releases/latest`) and compares it with the version the
configured digest is known to hold (`REVIEWED_RUNNER_IMAGES` in `src/core/runnerVersionPin.ts`). When the pin
is behind it warns, names the command to verify the newer digest, and says plainly once the newer release is
more than 63 days old. AtlasMind never bumps the digest itself: a new digest is a supply-chain decision for a
person. A tag or a local derivative is reported as a version AtlasMind cannot tell, not as current.

To bump the pin: run `docker buildx imagetools inspect ghcr.io/actions/actions-runner:<version>`, compare the
index digest with the registry (`docker-content-digest` from GHCR's manifest endpoint) and GitHub's package
page, then set `atlasmind.ci.localRunner.image` to `ghcr.io/actions/actions-runner@sha256:<index digest>`.

#### Use the Pipeline dashboard

The supported day-to-day path is **Project Dashboard → Pipeline → Start here**. The first view is a
four-decision route: choose the checks, prepare the computer, queue one trusted GitHub job, then lend that
job one temporary runner. Reading the result is the follow-up. **Workflow map**, **Runner**, **Tests**,
**Analytics**, and **Packages & repo** keep specialist evidence available without requiring a newcomer to
decode it all at once. Start here shows only the next incomplete decision and a compact progress strip;
expand **Show all four setup steps** only when the wider sequence is useful. Specialist dashboards and
recent CI results start collapsed so setup does not require scrolling through analytics.

AtlasMind does **not** install or run a permanent runner daemon. It needs Docker plus the GitHub CLI on the
extension host; after confirmation it starts GitHub's official runner inside a one-job container and removes
the registration afterwards. Inspect first: setup help appears only for a missing prerequisite. Docker and
GitHub CLI are operating-system applications installed outside the workspace; installing either from a VS
Code terminal does not make it a repository dependency or place its application files in the repository.
The Runner view opens a fixed official installation page and never executes an installer or accepts a URL
from the webview.

1. Select **Inspect prerequisites** before installing anything. If Docker or GitHub CLI is missing, use the
   official guide button AtlasMind shows for that item. Installation is machine-level and may require
   administrator approval or a restart. Restart VS Code after a first-time install so the active extension
   host receives the updated `PATH`.
2. Authenticate through GitHub CLI's browser flow; do not paste a token into AtlasMind:

   ```text
   gh auth login --hostname github.com --web
   ```

3. Open **Project Dashboard → Pipeline → Runner**. The permission badge shows the effective value AtlasMind
   read and whether it came from the current VS Code user/machine setting or the profile/extension-host
   default. Select **Open runner permission** and turn it On for this machine. If Settings and the badge
   disagree, check the active VS Code profile or remote extension host and reload the window.
4. Select **Inspect prerequisites**. AtlasMind distinguishes “not checked” from “missing” while checking
   Docker CLI/engine, GitHub CLI/authentication, the pinned runner image, host CPU/RAM/GPU, and Docker's
   execution capacity. Leave the resource caps at 8 CPUs / 16 GB initially. AtlasMind preserves at least
   25% of CPU/RAM for the desktop and refuses if fewer than 2 CPUs or 4 GB remain for the job.
   The Runner view keeps the current action and any critical blocker visible. **Computer setup details**
   opens automatically only when something is missing; completed diagnostics collapse. Hardware, GPU,
   provider, resource-limit, lifecycle and evidence details remain under the separate technical disclosure.
5. Choose the Docker cleanup setting:
   - `ifStartedByAtlasMind` (default) closes Desktop only when this run opened it;
   - `never` keeps Desktop open for other work;
   - `always` closes it after the job even if it was already open.
   All three leave Docker open when another container is running or inventory cannot be read.
6. Commit and push the reviewed checkout to the trusted branch, then dispatch the trusted workflow if the
   push did not already queue it. GitHub can queue only the commit already pushed to that branch, not
   uncommitted or unpushed files from the local checkout.

   **Queue the run…** does this for you. It is a dispatch, not a run: nothing starts on this computer, and
   lending the machine to the queued job remains a separate step with its own confirmation. Before the
   dialog appears AtlasMind reads the head of the trusted branch *from GitHub* and compares it with the
   local `HEAD`, because a dispatch runs the remote tip and not what is on screen — where they differ the
   confirmation leads with that fact, and where GitHub could not be asked it says so rather than implying
   agreement. The dialog then names the repository, the exact command and the workflow path, and the
   dispatch is written to the workflow audit ledger before it is sent.

   The command is never supplied by the page. The webview posts a bare request with no payload; the host
   re-reads the settings and rebuilds the invocation, so the workflow filename and the ref come only from
   the validated settings pair. No automation-ladder capability governs it, because the ladder governs
   writes AtlasMind may make *unattended* and this one exists only as a click on a modal dialog — the
   ledger entry records `actor: user` accordingly.

   ```text
   gh workflow run trusted-local-ci.yml --ref develop
   ```

   The same command stays available to run yourself. Use **Copy** to place the whole line on the clipboard,
   or **Send to Terminal** to type it into an **AtlasMind CI** terminal rooted at the workspace. Send uses
   the user's configured VS Code shell on Windows, macOS, or Linux, moves focus to the terminal, and does
   not press Enter — the missing newline is the gate, and focus is what makes it reachable. Review the line
   before running it. The command uses only GitHub CLI syntax and is the same in PowerShell, Command
   Prompt, bash, and zsh.

   If the dispatch answers `HTTP 404: workflow trusted-local-ci.yml not found on the default branch`,
   nothing is misplaced. The URL in that error is GitHub's API address for the workflow, not a folder, and
   the file belongs in `.github/workflows/` — what is missing is registration: GitHub only registers a
   dispatchable workflow once the file exists on the repository's **default branch**. Merge the workflow
   file there first, or trigger by pushing a commit to the trusted branch instead — a push runs the
   workflow from the pushed commit itself, with no registration needed. Either way, `--ref` can only name
   a branch that actually exists on the remote.

7. When the terminal reports that it created the dispatch, select **Check GitHub queue → review start
   plan**. A waiting self-hosted workflow may be `pending` while its job is `queued`; AtlasMind checks both.
   Queue discovery happens in this host-owned preflight and a not-yet-visible or mismatched run returns to
   the ready state so it can be checked again. If AtlasMind finds an older or duplicate waiting run, cancel
   each run using the complete command shown with Copy and Send controls, then queue exactly one run for the
   checked-out commit and inspect again. Read the modal: repository, branch, SHA, run id, evidence platform,
   immutable image, container limits/reserve, whether Docker will start or an image will download, and the
   cleanup effect must all be right before confirming.
8. Follow Trust gate → Isolate → Execute → Clean up on the card or open **Live output**. When the runner
   exits, select **Refresh CI** to read GitHub's job verdict; a clean listener exit is not itself a passing
   test result.

GPU detection is informational. The Runner view separately says whether Docker advertises a GPU runtime
and whether the CI container receives the device. The latter remains **Off by policy**: the runner command
does not add `--gpus`, so seeing a card and its VRAM cannot silently turn general CI into a GPU workload.
A future GPU-specific executor needs its own reviewed image, trusted label, resource rules and explicit
operator confirmation.

The start preflight re-reads the committed workflow and live GitHub state. It requires exactly one waiting
`push`/`workflow_dispatch` run in total, triggered by the actor the workflow authorises (the owner, or the
account an organisation-owned repository pins, compared by id), and that run must be at current HEAD. A matching run
does not make a stale second run safe: both share the label and GitHub could assign either one. Pending and
queued workflow states are deduplicated by run id. It also requires exact repository/ref/actor job conditions,
`contents: read`, no GitHub secret reference or write/OIDC grant, full-SHA actions,
`persist-credentials: false`, a label unused by every other local workflow, and no existing registration
with that label. The one-hour registration token streams directly from `gh` stdout to Docker stdin and is
never retained by AtlasMind.

The control plane is multi-OS; the evidence is not conflated:

| Host | Docker executor result | What it proves |
|---|---|---|
| Windows + Docker Desktop/WSL2 | Linux x64 or arm64 | Linux container behaviour only |
| Intel macOS + Docker Desktop | Linux x64 | Linux container behaviour only |
| Apple silicon macOS + Docker Desktop | Linux arm64 | Linux container behaviour only; workflow label must expand to arm64 |
| Linux + Docker Engine/Desktop | Linux x64 or arm64 | Linux container behaviour; AtlasMind never manages a system Docker service |

Native Windows/macOS checks require native executors and remain separate release evidence. The current
connected provider is GitHub Actions; Buildkite, Semaphore and other cards mark the provider adapter
boundary for future implementations rather than claiming those systems ran.

The command below remains the auditable manual fallback and troubleshooting reference. It uses the same
isolation shape as the dashboard, but the dashboard additionally performs queue, actor, workflow collision,
capacity, immutable-image and Docker-ownership checks.

```powershell
$RunnerImage = 'ghcr.io/actions/actions-runner@sha256:6d0b2d80d80f143f77dcb676e50920100bbb547e39e883454d57f45ab8c31300'
docker buildx imagetools inspect ghcr.io/actions/actions-runner:2.338.2
docker pull $RunnerImage
```

### Queue with every other CI gate on this computer

The resource plan admits a runner when enough CPU and memory are free at that moment. That is a check, not a
queue: two gates started a minute apart both see free capacity, and so does a runner job that arrives while
a local `ci:local` is halfway through. On a computer several projects share, the second one is what runs
the machine out of memory. Set `atlasmind.ci.gateQueue.lockPath` to an absolute directory path (for example
a folder every project's gates use) and heavy work takes turns:

- **The lock is a directory**, created with `mkdir`, which exactly one creator wins. Inside it `owner.txt`
  reads `<owner> - pid <pid> - started <ISO time>`, stamped when the lock is *taken*, not when waiting
  began. Keep this exact format: it is how AtlasMind interoperates with other projects' gates and with
  people taking the lock by hand.
- **A lock older than `atlasmind.ci.gateQueue.staleHours` (three hours) is taken over**, judged by age only.
  The pid is for people to read; it is never consulted, because a holder inside a container has a pid the
  host cannot see. A takeover happens only while holding `<lock>.takeover` (also an atomic `mkdir`), after
  re-checking that the lock is still stale and `owner.txt` is unchanged, so two waiters cannot both take it.
- **Release removes the lock only while `owner.txt` still holds the releasing holder's exact stamp.** A gate
  that outlived the stale age and was taken over never deletes the new holder's lock.

With the setting on, **Start** waits after you confirm, shows who holds the queue, and holds it from before
Docker is touched until the runner container exits (success, failure or Stop). Stop while waiting ends only
the wait. The container itself still receives no host mount: the extension host holds the lock.

**From a GitHub Actions job on a persistent self-hosted runner**, copy `media/bin/atlasmind-ci-gate.mjs` from
this repository into your project (it is one dependency-free file that runs with bare `node`), mount the
lock's folder into the runner, set `ATLASMIND_CI_GATE_LOCK` to the lock path as the container sees it, and
bracket each heavy job:

```yaml
      - name: Join the CI gate queue
        run: node scripts/atlasmind-ci-gate.mjs acquire
      # … install, build and test …
      - name: Leave the CI gate queue
        if: always()
        run: node scripts/atlasmind-ci-gate.mjs release
```

On a GitHub-hosted runner both steps do nothing, so one workflow serves both. On a self-hosted runner with
no `ATLASMIND_CI_GATE_LOCK`, `acquire` fails the job: a runner that cannot queue must not run a gate's worth
of work beside one. `acquire` keeps its stamp in `$RUNNER_TEMP`, and `release` removes exactly that lock and
only when the held record names the configured lock. Run `acquire` after `actions/setup-node` (the runner
image has no Node of its own). For a local gate, `node atlasmind-ci-gate.mjs run -- npm run ci:local` holds
the queue for one command and releases it after a failure as well as a success; with no lock configured
off a runner it simply runs the command. `ATLASMIND_CI_GATE_STALE_HOURS` overrides the three-hour stale age.

A profile for jobs that start their own database containers is a separate, riskier choice; see
[the Docker-capable runner design note](design-docker-capable-runner-profile.md).

### Troubleshooting the runner container

AtlasMind reads the last lines the container printed against a declared rule table
(`src/core/localCiFailureHints.ts`) when it exits non-zero, and the runner card names the cause with the
step that fixes it. The rules, in order:

| What the output says | What it means | What to do |
| --- | --- | --- |
| `PartialChain`, `unable to get local issuer certificate`, `The SSL connection could not be established` | Something on this computer re-signs HTTPS traffic from the Docker VM and the Linux container does not trust it | The section below. Never disable verification |
| `no space left on device` | The Docker disk is full | Free space in Docker Desktop (unused images, build cache), start again |
| `pull access denied`, `manifest unknown`, `No such image` | The image named in `atlasmind.ci.localRunner.image` is not present and could not be pulled | Check the tag or digest; a locally built derived image must exist on this machine first |
| `NotFound from 'POST …/actions/runner-registration'` | GitHub rejected the one-hour registration token | Sign in again with the GitHub CLI and start again |
| `A runner exists with the same name` | A stale registration from an earlier container | Remove it on the repository's Actions → Runners page |

Anything else is reported as an unknown cause with the exit code, and the runner output has the detail.

#### Troubleshooting: the runner container cannot reach GitHub (TLS inspection)

If registration reports `PartialChain` or `unable to get local issuer certificate`, first inspect the
certificate presented inside the container. Antivirus or enterprise TLS inspection may issue it from a
local root that Windows trusts but the Linux VM does not. Never set `NODE_TLS_REJECT_UNAUTHORIZED=0`, use
the runner's TLS-disable switch, or download through `curl -k`. Verify that the named issuer is an intended,
self-signed certificate in a Windows trusted-root store and that you export only its public certificate.

Then let AtlasMind trust it, with two machine-scoped settings and no derived image:

1. Export the root as PEM (Windows: `certmgr.msc` → Trusted Root Certification Authorities → the issuer →
   *Export* → Base-64 encoded X.509, or convert a `.cer` with `openssl x509 -inform DER -in root.cer -out
   root.pem`). Keep it outside any repository.
2. Read its fingerprint: `openssl x509 -in root.pem -noout -fingerprint -sha256`, and compare it with the
   thumbprint your operating system shows for the root it already trusts.
3. Set `atlasmind.ci.localRunner.additionalCaFile` to the absolute path of `root.pem` and
   `atlasmind.ci.localRunner.additionalCaSha256` to that fingerprint (colons are accepted).

**Inspect** and every **Start** then check that the file is exactly one certificate (a private key or a
bundle is refused), that its SHA-256 matches the pin, that it is a certificate authority, that it is
self-signed (an intermediate is refused) and that it is in date. A failing check is a blocker that names the
reason. At start the certificate is sent over the container's standard input ahead of the registration
token, never mounted from the host; the container starts as root for that one step, re-checks the
fingerprint inside, adds the root to `/usr/local/share/ca-certificates` with `update-ca-certificates`, and
`setpriv` drops to the `runner` user before `config.sh` reads the token. Only `SETUID` and `SETGID` are added
back (which leaving root needs), every other capability stays dropped and `no-new-privileges` stays on, so
no job process can return to root. The confirmation dialog names the root and its fingerprint. The workflow
sets `NODE_EXTRA_CA_CERTS` to Linux's system CA bundle, which now includes the root, so JavaScript actions and
npm verify against the same store.

If you build your own image (a derived runner, or a project image whose build downloads through the proxy),
pass the root to the build as a BuildKit secret, never with `COPY` or `--build-arg`, both of which put it in
a layer or the image history: `docker build --secret id=atlasmind_ca,src=C:\path\root.pem .` with, in
the Dockerfile, a step such as

```dockerfile
RUN --mount=type=secret,id=atlasmind_ca,target=/run/secrets/atlasmind_ca.pem \
    NODE_EXTRA_CA_CERTS=/run/secrets/atlasmind_ca.pem npm ci
```

`localCiCaBuildSecretArgs` in `src/core/localCiTrustAnchor.ts` composes those arguments for AtlasMind code.

The container receives no host filesystem mount, Docker socket, inbound port, repository secret, or OIDC
permission. It is non-root, drops Linux capabilities, prevents privilege escalation, and is capped so a
bad job cannot consume the whole workstation. Pipe the one-hour registration token directly over standard
input; do not put it in the Docker command, environment, image, shell history, or a transcript:

```powershell
$RunnerImage = 'ghcr.io/actions/actions-runner@sha256:6d0b2d80d80f143f77dcb676e50920100bbb547e39e883454d57f45ab8c31300' # or the verified local-only derivative
gh api --method POST repos/JoelBondoux/AtlasMind/actions/runners/registration-token --jq .token | `
  docker run --name atlasmind-trusted-runner --interactive --rm `
  --cpus 8 --memory 16g --pids-limit 1024 `
  --cap-drop ALL --security-opt no-new-privileges:true `
  --entrypoint /bin/bash $RunnerImage -lc `
  'read -r TOKEN; ./config.sh --url https://github.com/JoelBondoux/AtlasMind --token "$TOKEN" --ephemeral --unattended --disableupdate --no-default-labels --labels atlasmind-trusted-linux-x64; unset TOKEN; exec ./run.sh'
```

An owner push to `develop` queues the trusted job automatically. Once the workflow also exists on the
default branch, the owner can instead queue a specific reviewed `develop` commit manually:

```powershell
gh workflow run trusted-local-ci.yml --ref develop
gh run list --workflow trusted-local-ci.yml --limit 3
```

Confirm that the queued run names the intended `develop` commit before starting the container. The
workflow independently refuses a non-`develop` ref, a different repository, a pull-request event, or an
actor other than the repository owner. Its two GitHub actions are pinned to reviewed full commit SHAs,
checkout does not persist its job token, and npm's cache is placed under the runner's per-job temporary
directory. `--ephemeral` de-registers the runner after one job and `--rm` removes its container; the pinned
image remains installed for the next explicitly started one-job worker.

## Teardown and incident response

For an ordinary teardown, stop the runner, remove it from **Settings → Actions → Runners** if it remains,
and destroy the disposable VM. Do not retain its working directory as a dependency cache for another job.

If untrusted code may have run, assume the entire runner is compromised. Disconnect it, preserve the
diagnostic logs, remove its GitHub registration, destroy the VM, and rotate every credential that was
present or reachable from that environment. Deleting only the `_work` directory is not remediation.

## Authoritative references

- [GitHub: Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
- [GitHub: Adding self-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners)
- [GitHub: Self-hosted runners reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners)
- [GitHub: Using self-hosted runners in a workflow](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/use-in-a-workflow)
- [GitHub: Managing access to self-hosted runners with groups](https://docs.github.com/en/enterprise-cloud@latest/actions/how-tos/manage-runners/self-hosted-runners/manage-access)
- [GitHub: Managing Actions settings and fork approvals](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)
- [GitHub: Workflow execution protections](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/actions-policies/workflow-execution-protections)
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Gitleaks releases](https://github.com/gitleaks/gitleaks/releases)
- [`act` documentation](https://nektosact.com/)
- [Woodpecker local execution and backends](https://woodpecker-ci.org/docs/usage/local-execution)
- [Semaphore self-hosted agent isolation](https://docs.semaphore.io/using-semaphore/self-hosted-configure)
- [Dagger engine configuration](https://docs.dagger.io/reference/configuration/engine/)
- [Buildkite agent security](https://buildkite.com/docs/agent/self-hosted/security)
