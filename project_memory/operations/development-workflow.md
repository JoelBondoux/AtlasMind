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

**Settings are guarded too.** A setting is a promise: it shows in the VS Code settings UI with a description saying what it does. `tests/settingsIntegrity.test.ts` fails the build if a declared setting is read by no code, if a configuration key is read with a redundant `atlasmind.` prefix (`getConfiguration('atlasmind').get('atlasmind.x')` silently resolves to `atlasmind.atlasmind.x`), or if a setting on the not-yet-wired allowlist has a description that reads like a working feature. Adding to that allowlist requires a written reason, so it cannot become the place dead settings go to be forgotten.

**Webview scripts are guarded by a parser, not by the compiler.** `media/*.js` is a string handed to a browser: never type-checked, never imported by a test. A renamed function therefore leaves its old call site behind silently, and the failure arrives as a render-time `ReferenceError` that takes down the entire panel ("Dashboard refresh failed — …is not defined"). `tests/views/webviewIdentifierIntegrity.test.ts` parses each script with acorn and asserts every identifier it reads is bound — declared in the file, a parameter, or a real browser/host global. When it fails, the fix is either the rename you missed or, for a genuine new DOM global, an addition to its `HOST_GLOBALS` list.


**Every run writes a JUnit report.** `vitest.config.ts` declares `reporters: ['default', 'junit']` with `outputFile.junit`, so `npm run test` emits `test-results/junit.xml` alongside its normal console output. This is not a convenience: AtlasMind's own Testing dashboard reads pass/fail only from a report the project wrote and neve
…(truncated)

## GitHub Workflow Standards
## Goals

- Keep mainline stable and releasable.
- Make delivery progress visible for both novice and senior contributors.
- Ensure every merged change is tested, traceable, and reversible.

## Branch Strategy

The specification's stage 2 (Branch Creation & Naming), instantiated.

| Role | Branch | Notes |
|---|---|---|
| Integration | `develop` | Default branch and normal push target. Expected to move constantly. |
| Release | `main` | Protected. Updated only by an intentional Marketplace release promotion. |

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
- Let CI run on pushes
…(truncated)

<!-- atlasmind-import
entry-path: operations/development-workflow.md
generator-version: 2
generated-at: 2026-07-31T03:25:06.200Z
source-paths: docs/development.md | docs/github-workflow.md
source-fingerprint: a3dd6af5
body-fingerprint: d45fb75f
-->
