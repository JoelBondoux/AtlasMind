# GitHub Workflow Standards

## Goals

- Keep mainline stable and releasable.
- Make delivery progress visible for both novice and senior contributors.
- Ensure every merged change is reviewed, tested, and traceable.

## Branch Strategy

- `master`: protected release-ready branch.
- Feature branches: `feat/<short-name>`.
- Fix branches: `fix/<short-name>`.
- Chore branches: `chore/<short-name>`.

## Pull Request Workflow

1. Open an issue first (bug or feature template).
2. Create a branch from `master`.
3. Implement changes with tests and docs.
4. Open a PR using `.github/pull_request_template.md`.
5. Link issue (`Closes #<number>`).
6. Wait for required CI checks and code review.
7. Merge once all conversations are resolved.

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
