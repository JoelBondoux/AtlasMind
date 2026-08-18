# Local CI and safe self-hosted runners

Run AtlasMind's quality gates directly on your own machine when GitHub Actions is unavailable, when you
want feedback before pushing, or when a hosted run would add no evidence. Direct local execution is the
simplest posture. A public repository can also use a GitHub-connected self-hosted runner for reviewed code
on a protected branch, provided untrusted pull-request jobs cannot select it and the runner is isolated
from personal data and long-lived credentials.

## Choose the right mode

| Need | Use | Trust boundary |
|---|---|---|
| Check a change before pushing | Direct local CI | Runs only the checkout you selected, under your account |
| Reproduce Linux behaviour | A clean local Linux VM or container | Disposable environment; no GitHub runner registration |
| Run reviewed commits from a trusted branch | A dedicated runner host, VM, or isolated container with a unique label | No PR trigger, no long-lived secrets, least-privilege token, branch controls and an isolated runner account |
| Give each GitHub job a clean machine | Ephemeral or just-in-time runner in a disposable VM | One trusted job, then destroy the environment |
| Automatically run public pull requests | GitHub-hosted runners | Never send untrusted PR code to a personal or persistent machine |

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
| Ephemeral/JIT | Trusted jobs needing stronger cleanup | Fresh VM or worker per job; deregister and destroy after completion |
| Hosted PR | Contributions whose code is not yet trusted | GitHub-hosted or another provider-managed ephemeral runner |

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
moving tag is not an immutable supply-chain boundary. The file must also reference no GitHub secret: a
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
The repository's tested image is pinned to runner `2.336.0` by digest on Linux x64; arm64 operators must
select and pin the matching reviewed manifest digest in the machine-scoped image setting. Before updating
either, compare the digest with GitHub's package page and inspect the selected platform manifest:

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
6. Commit and push the reviewed checkout to the trusted branch, then manually dispatch the trusted workflow
   if the push did not already queue it. The dashboard names `develop` as a branch label, not as a command:
   GitHub can queue only the commit already pushed to that branch, not uncommitted or unpushed files from
   the local checkout. AtlasMind deliberately has no Queue or Rerun button.

   ```text
   gh workflow run trusted-local-ci.yml --ref develop
   ```

   Use **Copy** to place the whole command on the clipboard, or **Send to Terminal** to type the whole line
   into an **AtlasMind CI** terminal rooted at the workspace. Send uses the user's configured VS Code shell
   on Windows, macOS, or Linux and does not press Enter; review the line before running it. The command uses
   only GitHub CLI syntax and is the same in PowerShell, Command Prompt, bash, and zsh.

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
owner-triggered `push`/`workflow_dispatch` run in total and that run must be at current HEAD. A matching run
does not make a stale second run safe: both share the label and GitHub could assign either one. Pending and
queued workflow states are deduplicated by run id. It also requires exact repository/ref/owner job conditions,
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
$RunnerImage = 'ghcr.io/actions/actions-runner@sha256:0cfdcc701ce933c6d243c6b0b2da767366dc9f2e99961d4c3754b0b78084cdda'
docker buildx imagetools inspect ghcr.io/actions/actions-runner:2.336.0
docker pull $RunnerImage
```

If registration reports `PartialChain` or `unable to get local issuer certificate`, first inspect the
certificate presented inside the container. Antivirus or enterprise TLS inspection may issue it from a
local root that Windows trusts but the Linux VM does not. Never set `NODE_TLS_REJECT_UNAUTHORIZED=0`, use
the runner's TLS-disable switch, or download through `curl -k`. Verify that the named issuer is an intended,
self-signed certificate in a Windows trusted-root store, that it has no private key, and that the exported
certificate hash matches before adding that public root to a locally derived image. A minimal Dockerfile is:

```dockerfile
FROM ghcr.io/actions/actions-runner@sha256:0cfdcc701ce933c6d243c6b0b2da767366dc9f2e99961d4c3754b0b78084cdda
USER root
COPY verified-local-root.cer /tmp/verified-local-root.cer
RUN openssl x509 -inform DER -in /tmp/verified-local-root.cer \
      -out /usr/local/share/ca-certificates/verified-local-root.crt \
    && rm /tmp/verified-local-root.cer \
    && update-ca-certificates
USER runner
```

Build it under a local-only tag, smoke-test HTTPS with verification enabled, and use that tag as
`$RunnerImage`. Do not commit the machine-specific certificate or build context. The workflow sets
`NODE_EXTRA_CA_CERTS` to Linux's system CA bundle so JavaScript actions and npm use the same verified trust
store as the runner.

The container receives no host filesystem mount, Docker socket, inbound port, repository secret, or OIDC
permission. It is non-root, drops Linux capabilities, prevents privilege escalation, and is capped so a
bad job cannot consume the whole workstation. Pipe the one-hour registration token directly over standard
input; do not put it in the Docker command, environment, image, shell history, or a transcript:

```powershell
$RunnerImage = 'ghcr.io/actions/actions-runner@sha256:0cfdcc701ce933c6d243c6b0b2da767366dc9f2e99961d4c3754b0b78084cdda' # or the verified local-only derivative
gh api --method POST repos/JoelBondoux/AtlasMind/actions/runners/registration-token --jq .token | `
  docker run --name atlasmind-trusted-runner --interactive --rm `
  --cpus 8 --memory 16g --pids-limit 1024 `
  --cap-drop ALL --security-opt no-new-privileges:true `
  --entrypoint /bin/bash $RunnerImage -lc `
  'read -r TOKEN; ./config.sh --url https://github.com/JoelBondoux/AtlasMind --token "$TOKEN" --ephemeral --unattended --no-default-labels --labels atlasmind-trusted-linux-x64; unset TOKEN; exec ./run.sh'
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
