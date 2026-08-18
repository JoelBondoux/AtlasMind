# GitHub Workflow Standards — AtlasMind's own instance

> **This file states values, not rules.**
>
> The rules live in **[The Guided GitHub Workflow](guided-github-workflow.md)**, which is
> AtlasMind's canonical workflow specification and governs every project that uses AtlasMind —
> including this one. This document records how *this repository* instantiates it: which branches,
> which labels, which checks, which secrets.
>
> If the two ever disagree, the specification is correct and this file is stale. Do not restate a
> rule here; point at it.

**Profile:** `solo`. One maintainer is author, reviewer, and releaser.

## Goals

- Keep mainline stable and releasable.
- Make delivery progress visible for both novice and senior contributors.
- Ensure every merged change is tested, traceable, and reversible.

## Branch Strategy

The specification's stage 2 (Branch Creation & Naming), instantiated.

| Role | Branch | Notes |
|---|---|---|
| Integration | `develop` | Default implementation branch and normal push target. Expected to move constantly. |
| Release | `main` | GitHub default and protected branch. Updated only by an intentional Marketplace release promotion. |

Feature branches are created from `develop` as `<type>/<short-name>` — `feat/`, `fix/`, `chore/`,
`docs/`. Where the work has an issue, prefer `<type>/<issue>-<slug>` so the link back is derived
rather than typed.

**Promotion model.** Routine maintainer work lands directly on `develop`. Optional topic branches
merge into `develop`. `develop` is promoted into `main` only when a new Marketplace release is
intended.

`project_memory/` **is tracked, and is present on `main`.** `.gitignore` excludes only
`project_memory/sessions/`, `project_memory/temp/`, `project_memory/operations/project-run-*.json`,
and `project_memory/operations/.delivery-lock.json`. What keeps project memory out of the shipped
extension is `.vscodeignore`, not `.gitignore` — a workspace-memory directory appearing in the VSIX
listing is a release blocker, but its presence in a release PR is expected and correct.

## Pull Request Workflow

The specification's stage 4 (Pull Requests & Reviews), instantiated for the `solo` profile.

1. Open an issue first when the work benefits from tracking or external review.
2. For routine maintainer work, commit and push directly to `develop`.
3. For isolated or higher-risk changes, branch from `develop`, implement with tests and docs, and
   open a PR back into `develop`. Link the issue with `Closes #<n>` in the body.
4. Promote `develop` into `main` only when publishing the next Marketplace release.

**Required approvals: zero.** This is the `solo` profile's defining value, and it is a deliberate
choice rather than an omission — requiring self-approval trains a maintainer to dismiss a gate. CI
is the reviewer here, which is why the status checks below are genuinely required rather than
advisory. Reintroduce approvals and CODEOWNERS review on `main` before treating this as a broader
team release branch.

### Branch protection for `main`

- Require a pull request before merging.
- Do **not** require approving reviews — see above.
- Require these status checks:
  - `quality (ubuntu-latest)`
  - `quality (windows-latest)`
  - `quality (macos-latest)`
- Enable auto-merge so the release PR completes as soon as required CI goes green.
- Keep admin enforcement enabled so `main` stays PR-only even for repository admins.
- Restrict force pushes and branch deletion.

### Branch protection for `develop`

- Do not require pull requests or approving reviews.
- Keep admin enforcement disabled so the maintainer can push directly.
- Run `npm run ci:local` before pushing. The owner-only trusted-runner workflow also queues on `develop`
  pushes when shared GitHub logs add value; do not treat `develop` as a release gate.
- Restrict force pushes.

## Release Flow

The specification's stage 6 (Release Automation), instantiated. **The release is Actions-driven.**

1. Trigger **`Release — promote develop to main`** from the Actions tab.
   It creates or reuses the `develop` → `main` release PR and enables merge-commit auto-merge.
2. Wait for the release PR to merge into `main`.
3. Run **`npm run tag:release`** locally. This pushes `v<package.json version>`.
4. The tag push triggers **`Release — publish Marketplace from tag`**, which signs in as the managed identity `vscode-marketplace-publisher` via workload identity federation, verifies it still has publish rights, then publishes via `vsce`
   and creates the GitHub Release with generated notes.

> **Publishing and tagging are separate commands, deliberately.**
>
> `publish:release` runs `vsce publish` and nothing else. `tag:release` pushes the tag.
>
> They were chained until v0.184.0, and the chain was a live hazard: the tag push triggers
> `publish.yml`, which ran `publish:release` again in CI, and the second attempt failed on
> "version already exists" — which looks like a broken pipeline but was really two publish paths
> racing. One release now has exactly one publish path (CI, from the tag) and one tag path
> (`tag:release`, run deliberately).
>
> For an **emergency local publish** when Actions is unavailable, run `npm run publish:release`
> and then `npm run tag:release`, in that order.

Direct pushes to `main` are blocked, including for admins. Keep `main` releasable at all times. If
preview and stable delivery are split again later, keep `main` for stable and add a dedicated
`pre-release` branch.

### Release secrets

| Secret | Used by |
|---|---|
| `RELEASE_TOKEN` | The promote workflow, to open the release PR. |
| `VSCE_PAT` | `vsce publish`, in the publish workflow. |

## Release Hygiene

- Every commit includes an appropriate SemVer bump in `package.json`.
- Every version bump includes a matching `CHANGELOG.md` entry, in the same commit.
- The README version banner matches `package.json`.
- Use conventional commit prefixes — the bump classification and the changelog are derived from
  them, so a non-conforming history is one AtlasMind cannot version automatically.

## Issues and Labels

The specification's stage 1 (Planning & Issue Intake), instantiated. AtlasMind draws labels **only**
from this taxonomy and drops anything unmatched rather than inventing one.

- **Type:** `type:bug`, `type:feature`, `type:chore`, `type:docs`
- **Priority:** `priority:p0`, `priority:p1`, `priority:p2`
- **Status:** `status:triage`, `status:in-progress`, `status:blocked`, `status:ready`
- **Area:** `area:core`, `area:providers`, `area:memory`, `area:chat`, `area:docs`, `area:ci`

## Milestones

Use milestones for release targets (for example `v0.2.x`, `v0.3.0`). Each should carry an objective
summary, acceptance criteria, an out-of-scope list, and a target date.

## Projects (GitHub Projects)

Board fields:

- `Status` (Backlog, Ready, In Progress, Review, Done)
- `Priority` (P0, P1, P2)
- `Size` (S, M, L)
- `Owner`
- `Milestone`
- `Risk` (Low, Medium, High)

Automation: auto-add newly opened issues and PRs; set `Status=In Progress` when a PR opens;
`Status=Done` when it merges; warn when an issue has no milestone or no acceptance criteria.

## Dependency And Integration Drift

The specification's stage 7 (Maintenance & Tech-Debt), instantiated.

- Dependabot reviews npm dependencies and GitHub Actions weekly via `.github/dependabot.yml`.
  These arrive as **pull requests**, not issues. Review and validate them locally or on the isolated trusted
  runner before they land on `develop`; the hosted matrix then verifies the aggregate at release promotion.
  They are never auto-merged — a dependency bump is a supply-chain event.
- `.github/integration-monitor.json` is the curated list of external integrations whose versions
  should trigger a compliance review.
- `.github/scripts/check-integration-drift.mjs` reports drift against that manifest. It runs **on
  demand** via `npm run monitor:integrations`; there is no scheduled workflow for it yet, tracked as
  a Low-priority item in [the roadmap](../project_memory/roadmap/guided-github-workflow.md).
- `.github/scripts/audit-integration-coverage.mjs` runs in CI and fails when a new recommended
  extension, routed provider, or specialist integration is added without matching monitoring
  coverage.
- The CI quality matrix also runs `npm run test:providers:local-recommendations` as a focused
  regression gate alongside the full `npm run test` suite.
- Marketplace-extension drift is tracked separately from package-manager drift, because those
  integrations are not declared in `package.json`.
- AI provider contract drift still requires human review even when version drift is automated.

## Continuous Integration

`.github/workflows/ci.yml` is the hosted release-confidence workflow. It runs automatically only for pull
requests into **`main`**—normally the reviewed `develop` → `main` promotion—and remains manually
dispatchable when a platform-specific investigation justifies hosted capacity. It does not run on routine
pushes or pull requests into `develop`.

The repository's **Approval for running fork pull request workflows** setting is **Require approval for all
external contributors**. Do not weaken it to either first-time-contributor option: an accepted harmless
change would then grant later workflow code automatic execution. Approval permits a run; it does not make
the submitted code suitable for a self-hosted machine.

The `quality` job runs across `ubuntu-latest`, `windows-latest`, and `macos-latest` with
`fail-fast: false`: compile, lint, integration audit, tests, and the local-recommendations
regression. On Ubuntu it additionally uploads coverage and packages the `.vsix` as a build artifact
with 14-day retention, which is how a branch build gets installed for testing. Every hosted action is
pinned to the full commit SHA currently associated with its reviewed major tag; the nearby version comment
retains update intent without making the executable reference mutable.

`.github/workflows/trusted-local-ci.yml` is the deliberately separate development route. Its trigger is an
owner `push` to `develop` or manual dispatch; the job independently requires this repository,
`refs/heads/develop`, and the repository owner as actor. It targets the sole public routing label
`atlasmind-trusted-linux-x64`, grants only `contents: read`, supplies no repository/environment secrets or
OIDC permission, pins checkout and Node setup to full action SHAs, disables checkout credential
persistence, and runs `npm run ci:local`. Register that label with `--no-default-labels` only on the
ephemeral non-root Linux container described in [`local-ci-and-safe-runners.md`](local-ci-and-safe-runners.md).
It runs inside Docker Desktop's WSL2 VM with no host mount or Docker socket and exists for one job.

For direct execution, `npm run ci:local:quick` provides compile, lint, integration-audit and full-suite
feedback. `npm run ci:local` adds the focused local-model registry regression, coverage and packaging and
is the required pre-push local gate. Full-history Gitleaks remains a separately installed security gate and
the hosted release workflow retains its independent secret-scan job.
