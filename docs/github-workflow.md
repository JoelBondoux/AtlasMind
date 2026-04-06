# GitHub Workflow Standards

## Goals

- Keep mainline stable and releasable.
- Make delivery progress visible for both novice and senior contributors.
- Ensure every merged change is reviewed, tested, and traceable.

## Branch Strategy

- `develop`: default branch and integration branch for routine day-to-day work.
- `master`: protected release-ready branch used only for intentional pre-release publication.
- Feature branches: `feat/<short-name>` created from `develop`.
- Fix branches: `fix/<short-name>` created from `develop`.
- Chore branches: `chore/<short-name>` created from `develop`.
- Promotion model: `feature/*` → `develop` for normal development, then `develop` → `master` when you intentionally want a new pre-release build.

## Pull Request Workflow

1. Open an issue first (bug or feature template).
2. Create a branch from `develop`.
3. Implement changes with tests and docs.
4. Open a PR into `develop` using `.github/pull_request_template.md`.
5. Link issue (`Closes #<number>`).
6. Wait for required CI checks and code review.
7. Merge into `develop` once all conversations are resolved.
8. Promote `develop` into `master` only when you want to publish the next pre-release.

## Release Flow

- Use `develop` for normal integration, active implementation, and routine push targets.
- Keep `master` releasable at all times.
- Update `master` only by promoting `develop` through a PR intended to publish the next pre-release.
- Direct pushes to `master` are blocked, including for admins.
- If you later split preview and stable delivery, keep `master` for stable and add a dedicated `pre-release` branch.

## Required Branch Protection for `master`

Enable these in GitHub repository settings:

- Require pull request before merging.
- Require approvals (minimum: 1).
- Dismiss stale approvals when new commits are pushed.
- Require review from CODEOWNERS.
- Require status checks to pass before merge:
  - `Compile`
  - `Lint`
  - `Unit tests`
  - `Coverage`
- Require conversation resolution before merge.
- Restrict force pushes and branch deletion.

## Recommended Branch Protection for `develop`

Enable these in GitHub repository settings:

- Require pull request before merging.
- Require status checks to pass before merge.
- Restrict force pushes.
- Allow faster iteration than `master`, but keep `develop` as the only normal branch for direct development pushes.

## Issues and Labels

Recommended labels:

- Type: `type:bug`, `type:feature`, `type:chore`, `type:docs`
- Priority: `priority:p0`, `priority:p1`, `priority:p2`
- Status: `status:triage`, `status:in-progress`, `status:blocked`, `status:ready`
- Area: `area:core`, `area:providers`, `area:memory`, `area:chat`, `area:docs`, `area:ci`

## Milestones

Use milestones for release targets (for example `v0.2.x`, `v0.3.0`).

Each milestone should include:

- objective summary,
- acceptance criteria,
- out-of-scope list,
- target date.

## Projects (GitHub Projects)

Create a project board with at least these fields:

- `Status` (Backlog, Ready, In Progress, Review, Done)
- `Priority` (P0, P1, P2)
- `Size` (S, M, L)
- `Owner`
- `Milestone`
- `Risk` (Low, Medium, High)

Automation suggestions:

- Auto-add newly opened issues and PRs.
- Set `Status=In Progress` when PR opens.
- Set `Status=Done` when PR merges.
- Warn when issue has no milestone or no acceptance criteria.

## Release Hygiene

- Every commit includes an appropriate SemVer bump in `package.json`.
- Every version bump includes a matching entry in `CHANGELOG.md`.
- Use conventional commit prefixes.

## Dependency And Integration Drift

- Dependabot reviews npm dependencies and GitHub Actions weekly through `.github/dependabot.yml`.
- `.github/integration-monitor.json` is the curated list of external integrations whose versions should trigger a compliance review.
- `.github/workflows/integration-monitor.yml` runs weekly and on manual dispatch, then opens or updates an issue when curated versions drift.
- `.github/scripts/audit-integration-coverage.mjs` runs in CI and fails when a new recommended extension, routed provider, or specialist integration is added without matching monitoring coverage.
- Marketplace-extension drift is tracked separately from package-manager drift because those integrations are not declared in `package.json`.
- AI provider contract drift still requires human review even when version drift is automated. Keep provider touchpoints and review notes current in the integration-monitor manifest.
