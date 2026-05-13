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
- This applies to all code, doc, and config changes. The version bump and changelog update must be in the same commit as the change.
- Never remove the `# Changelog` title or its Keep a Changelog preamble; new release notes must be appended beneath that header.
- Use [Semantic Versioning](https://semver.org/):
  - **PATCH** (0.0.x): bug fixes, docs, refactors.
  - **MINOR** (0.x.0): new features, new commands, new UI.
  
…(truncated)

## Branch And Release Policy
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
entry-path: decisions/development-guardrails.md
generator-version: 2
generated-at: 2026-05-13T09:14:57.802Z
source-paths: .github/copilot-instructions.md | docs/github-workflow.md
source-fingerprint: cdc4f04c
body-fingerprint: 88b870f2
-->
