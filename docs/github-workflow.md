# GitHub Workflow Standards

## Goals

- Keep mainline stable and releasable.
- Make delivery progress visible for both novice and senior contributors.
- Ensure every merged change is reviewed, tested, and traceable.

## Branch Strategy

- `master`: protected release-ready branch used for intentional published pre-releases.
- `develop`: integration branch for routine day-to-day work.
- Feature branches: `feat/<short-name>` created from `develop`.
- Fix branches: `fix/<short-name>` created from `develop`.
- Chore branches: `chore/<short-name>` created from `develop`.
- Promotion model: `feature/*` → `develop` → `master` when you intentionally want a new pre-release build.

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

- Use `develop` for normal integration and active implementation.
- Keep `master` releasable at all times.
- Avoid direct pushes to `master`; require PRs from `develop`.
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
- Allow faster iteration than `master`, but do not bypass CI.

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
