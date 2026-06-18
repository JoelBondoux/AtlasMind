# Development Workflow

## Build, Test, And Local Development
## Prerequisites

- **VS Code** ≥ 1.96.0
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
npm run compile      # One-shot build (desktop + web)
npm run watch        # Watch mode for the desktop build (recommended during dev)
npm run watch:web    # Watch mode for the browser bundle
```

The extension has **two build targets**:

- **Desktop** (Node): `tsc -p ./` emits `out/extension.js` (the `main` entry) and the CLI under `out/cli/`.
- **Web** (browser/Web Worker): `tsc -p ./src/web/tsconfig.json` type-checks the web sources against WebWorker (not Node) globals, and `node esbuild.mjs` bundles `src/web/extension.ts` into the single dependency-free `out/web/extension.js` (the `browser` entry). The web build must stay free of Node built-ins; only `vscode`, WebWorker globals, and the Node-free shared modules (`src/remote/protocol.ts`, `src/views/chatProtocol.ts`, `src/views/chatWebviewMarkup.ts`, `src/views/webviewUtils.ts`) may be imported. `npm run compile` runs all three steps.

## Run

Press **F5** in VS Code to launch the Extension Development Host. The extension activates on startup (`onStartupFinished`).

To exercise the **web build**, run `npm run open-in-browser` (uses `@vscode/test-web` to load the browser bundle in Chromium).

## Lint

```bash
npm run lint
```

## Test

```bash
npm run test
npm run test:coverage
npm run test:providers:local-recommendations
```

## Versioning Workflow

1. Make changes and choose the correct SemVer bump for the same commit.
2. Update `version` in `package.json` in that commit.
3. Add a matching `CHANGELOG.md` entry in that same commit.
4. Every commit (not just PRs) must include a version bump and changelog entry. This applies to all code, doc, and config changes. The version bump and changelog update must be in the same commit as the change.
5. Use a conventional commit message and push.

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
- **Do not include any `project_memory/` files or folders in `master`.** The entire `project_memory/` directory is for development and feature branches only, and must be excluded from release PRs and the `master` branch. This is enforced by `.gitignore` and should be checked in PR reviews.
- Every commit (not just PRs) must include a version bump in `package.json` and a matching `CHANGELOG.md` entry. This applies to all code, doc, and config changes. The version bump and changelog update must be in the same commit as the change.
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
generated-at: 2026-06-18T18:51:10.022Z
source-paths: docs/development.md | docs/github-workflow.md
source-fingerprint: 7e4841b2
body-fingerprint: b9e01e15
-->
