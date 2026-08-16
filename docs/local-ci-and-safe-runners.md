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

Create a dedicated workflow whose ref is part of its enforcement, not merely part of its name. Replace the
repository, branch, labels and action SHAs below with reviewed values. A manual dispatch allows a caller to
choose a branch, so the job-level exact-ref check remains necessary.

```yaml
name: Trusted branch local CI

on:
  push:
    branches: [TRUSTED_BRANCH]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: trusted-local-ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  quality:
    if: github.repository == 'OWNER/REPOSITORY' && github.ref == 'refs/heads/TRUSTED_BRANCH'
    runs-on: [self-hosted, ATLASMIND_TRUSTED]
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@FULL_COMMIT_SHA
        with:
          persist-credentials: false
      - uses: actions/setup-node@FULL_COMMIT_SHA
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run compile
      - run: npm run lint
      - run: npm run test
```

Do not copy this placeholder workflow unchanged. Pinning the two actions to their own reviewed full commit
SHAs is deliberate; a moving tag is not an immutable supply-chain boundary.

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

AtlasMind's current local route uses GitHub's official Linux x64 runner image inside Docker Desktop's WSL2
VM. The image is pinned to runner `2.336.0` by its multi-platform manifest digest. Before updating it,
compare the digest with GitHub's package page and inspect the selected `linux/amd64` manifest:

```powershell
$RunnerImage = 'ghcr.io/actions/actions-runner@sha256:0cfdcc701ce933c6d243c6b0b2da767366dc9f2e99961d4c3754b0b78084cdda'
docker buildx imagetools inspect ghcr.io/actions/actions-runner:2.336.0
docker pull $RunnerImage
```

The container receives no host filesystem mount, Docker socket, inbound port, repository secret, or OIDC
permission. It is non-root, drops Linux capabilities, prevents privilege escalation, and is capped so a
bad job cannot consume the whole workstation. Pipe the one-hour registration token directly over standard
input; do not put it in the Docker command, environment, image, shell history, or a transcript:

```powershell
$RunnerImage = 'ghcr.io/actions/actions-runner@sha256:0cfdcc701ce933c6d243c6b0b2da767366dc9f2e99961d4c3754b0b78084cdda'
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
