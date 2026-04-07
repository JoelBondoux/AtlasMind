# GitHub Workflow Standards

## Goals

- Keep mainline stable and releasable.
- Make delivery progress visible for both novice and senior contributors.
- Ensure every merged change is reviewed, tested, and traceable.

## Branch Strategy

- `develop`: default branch and integration branch for routine day-to-day work.
- `master`: protected release-ready branch used only for intentional Marketplace publication.
- Feature branches: `feat/<short-name>` created from `develop`.
- Fix branches: `fix/<short-name>` created from `develop`.
- Chore branches: `chore/<short-name>` created from `develop`.
- Promotion model: routine maintainer work can land directly on `develop`, optional topic branches can still merge into `develop`, and `develop` is promoted into `master` only when you intentionally want a new Marketplace release build.

## Pull Request Workflow

1. Open an issue first when the work benefits from tracking or external review.
2. For routine solo-maintainer work, commit and push directly to `develop`.
3. For isolated or higher-risk changes, create a branch from `develop`, implement the change with tests and docs, and open a PR back into `develop`.
4. Promote `develop` into `master` only when you want to publish the next Marketplace release.

## Release Flow

- Use `develop` for normal integration, active implementation, and routine push targets.
- Keep `master` releasable at all times.
- Trigger `Release — promote develop to master` from the Actions tab when you want a release.
- That workflow creates or reuses the `develop` -> `master` release PR and enables squash auto-merge.
- When the release PR merges into `master`, the `Release — tag merged master version` workflow creates the matching `v<package.json version>` tag.
- The `Release — publish Marketplace from tag` workflow publishes from that tag and creates the GitHub Release entry.
- Direct pushes to `master` are blocked, including for admins.
- If you later split preview and stable delivery again, keep `master` for stable and add a dedicated `pre-release` branch.

## Release Secrets

Configure these repository secrets before relying on the automated release path:

- `RELEASE_TOKEN`: GitHub token with `repo` and `workflow` scope so the tag workflow can push release tags and create GitHub Releases.
- `VSCE_PAT`: Visual Studio Marketplace publisher token used by `vsce publish`.

## Recommended Branch Protection for `master`

Enable these in GitHub repository settings:

- Require pull request before merging.
- Do not require approving reviews for the current solo-maintainer release flow.
- Do not require CODEOWNERS review unless the project grows beyond the current maintainer set.
- Require status checks to pass before merge:
  - `quality (ubuntu-latest)`
  - `quality (windows-latest)`
  - `quality (macos-latest)`
- Enable auto-merge so the release PR can complete as soon as required CI goes green.
- Keep admin enforcement enabled so `master` stays PR-only even for repository admins.
- Restrict force pushes and branch deletion.

If you later add more regular contributors, reintroduce approvals and CODEOWNERS review on `master` before treating it as a broader team release branch.

## Recommended Branch Protection for `develop`

Enable these in GitHub repository settings:

- Do not require pull requests or approving reviews for routine solo-maintainer pushes.
- Keep admin enforcement disabled so the maintainer can push directly to `develop` when needed.
- Let CI continue to run on pushes to `develop` for visibility, but do not treat `develop` like a release gate or require conversation resolution.
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
