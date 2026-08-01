# Development Guardrails

## Repository Rules
## Critical Rules

### Safety-First Principle
- AtlasMind defaults to the safest reasonable behavior, not the most permissive one.
- Treat every boundary as untrusted: chat input, webview messages, workspace files, model output, and tool parameters.
- Validate before executing, redact before sending, confirm before destructive changes, and deny by default when behavior is ambiguous.
- Security-sensitive regressions are treated as correctness bugs, not polish items.

### Documentation Maintenance
When you make **any** of the following changes, you **MUST** update the corresponding documentation:

| Change | Files to update |
|---|---|
| Add/remove/rename a source file | `README.md` (Project Structure), `docs/architecture.md` (Dependency Graph), `docs/development.md` (Project Structure), `wiki/Architecture.md` |
| Add/modify a command | `README.md` (Extension Commands), `package.json`, `wiki/Chat-Commands.md` |
| Add/modify a chat slash command | `README.md` (Slash Commands), `package.json`, `wiki/Chat-Commands.md` |
| Add/modify a configuration setting | `README.md` (Configuration), `package.json`, `docs/configuration.md`, `wiki/Configuration.md` |
| Add/modify a type in `types.ts` | `docs/architecture.md` (Key Interfaces), `wiki/Architecture.md` |
| Add/modify an agent-related feature | `docs/agents-and-skills.md`, `wiki/Agents.md` |
| Add/modify a skill | `docs/agents-and-skills.md`, `wiki/Skills.md` |
| Add/modify the model router | `docs/model-routing.md`, `wiki/Model-Routing.md` |
| Add/modify a provider adapter | `docs/model-routing.md`, `CONTRIBUTING.md`, `wiki/Model-Routing.md` |
| Add/modify the SSOT/memory system | `docs/ssot-memory.md`, `wiki/Memory-System.md` |
| Add/modify webview panels | `docs/development.md` (Webview Development), `wiki/Architecture.md` |
| Add/modify tree views | `README.md`, `docs/architecture.md`, `wiki/Architecture.md` |
| Change build config or dependencies | `docs/development.md`, `README.md` (Quick Start), `wiki/Contributing.md` |
| Ship a new version | `CHANGELOG.md`, `package.json` (version), `README.md` (version banner), `wiki/Changelog.md` |
| Add/modify tool approval or safety | `wiki/Tool-Execution.md`, `wiki/Security.md` |
| Add/modify project planner or scheduler | `wiki/Project-Planner.md` |

### Version Tracking
- Version is in `package.json` → `"version"`.
- Current version: see `package.json` → `"version"`.
- Every commit (not just PRs) must include a version bump in `package.json` using SemVer.
- Every version bump must include a matching `CHANGELOG.md` entry in the same commit.
- The README version banner must always match `package.json`.
- When release notes or user-facing docs change, update `README.md` and the matching wiki pages in the same commit.
- This applies to all code, doc, and config changes. The version bump and changelog update must be in the same commit as the change.
- Never remove the `# Changelog` title or its Keep a Changelog preamble; new release notes must be appended benea
…(truncated)

## Branch And Release Policy
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
- Let CI run on pushes for visibility, but do not treat `develop` as a release gate.
- Restrict force pushes.

## Release Flow

The specification's stage 6 (Release Automation), instantiated. **The release is Acti
…(truncated)

<!-- atlasmind-import
entry-path: decisions/development-guardrails.md
generator-version: 2
generated-at: 2026-07-31T03:25:06.200Z
source-paths: .github/copilot-instructions.md | docs/github-workflow.md
source-fingerprint: 116616b5
body-fingerprint: 5d3a2ccc
-->
