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

## CLI

```bash
npm run cli -- providers list
npm run cli -- memory list
npm run cli -- chat "Summarise the project memory"
```

The CLI is compiled from `src/cli/main.ts` and reuses the shared runtime builder in `src/runtime/core.ts`. It auto-loads the configured SSOT path when present, otherwise the default `project_memory/` folder if it already exists. Reusable providers read credentials from environment variables derived from the VS Code secret keys, such as `ATLASMIND_PROVIDER_OPENAI_APIKEY` and `ATLASMIND_PROVIDER_ANTHROPIC_APIKEY`. Copilot remains VS Code-only, and Bedrock is still configured through the extension host path.

CLI safety is intentionally stricter than the extension host. Read-only skills remain available by default, but write-capable workspace and git tools require an explicit `--allow-writes` flag, and external high-risk tools remain blocked in CLI mode.

CLI argument parsing is now explicit rather than permissive: unknown flags, missing option values, invalid provider IDs, invalid budget or speed modes, and malformed daily-budget values are reported as errors, while `atlasmind --help` and `atlasmind --version` are supported as first-class flows.

## Run

Press **F5** in VS Code to launch the Extension Development Host. The extension activates on startup (`onStartupFinished`).

## Package And Publish

```bash
npm run package:vsix
npm run publish:pre-release
```

AtlasMind ships runtime dependencies such as the MCP SDK. Do not use `vsce package --no-dependencies` or `vsce publish --no-dependencies` unless all runtime dependencies have been bundled into the compiled output first, otherwise the installed extension can fail at activation with `Cannot find module ...` errors.

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

## Release Hygiene

- Every commit includes an appropriate SemVer bump in `package.json`.
- Every version bump includes a matching entry in `CHANGELOG.md`.
- Use conventional commit prefixes.

<!-- atlasmind-import
entry-path: operations/development-workflow.md
generator-version: 2
generated-at: 2026-04-06T11:06:54.750Z
source-paths: docs/development.md | docs/github-workflow.md
source-fingerprint: af1b740e
body-fingerprint: 4b12309c
-->
