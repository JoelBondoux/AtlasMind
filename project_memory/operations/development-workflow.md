# Development Workflow

## Build, Test, And Local Development
## Prerequisites

- **VS Code** ≥ 1.95.0
- **Node.js** ≥ 18
- **npm** ≥ 9

## Setup

```bash
git clone <repo-url>
cd AtlasMind
npm install
```

## Build

```bash
npm run compile    # One-shot build
npm run watch      # Watch mode (recommended during dev)
```

## Run

Press **F5** in VS Code to launch the Extension Development Host. The extension activates on startup (`onStartupFinished`).

## Lint

```bash
npm run lint
```

## Test

```bash
npm run test
npm run test:coverage
```

## Versioning Workflow

1. Make changes and choose the correct SemVer bump for the same commit.
2. Update `version` in `package.json` in that commit.
3. Add a matching `CHANGELOG.md` entry in that same commit.
4. Use a conventional commit message and push.

## GitHub Workflow Standards
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

## Release Hygiene

- Every commit includes an appropriate SemVer bump in `package.json`.
- Every version bump includes a matching entry in `CHANGELOG.md`.
- Use conventional commit prefixes.

<!-- atlasmind-import
entry-path: operations/development-workflow.md
generator-version: 2
generated-at: 2026-04-10T04:06:22.523Z
source-paths: docs/development.md | docs/github-workflow.md
source-fingerprint: 77b6d933
body-fingerprint: 959a98b6
-->
