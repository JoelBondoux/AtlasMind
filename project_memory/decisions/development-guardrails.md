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
| Add/modify a configuration setting | `README.md` (Configuration), `package.json`, `wiki/Configuration.md` |
| Add/modify a type in `types.ts` | `docs/architecture.md` (Key Interfaces), `wiki/Architecture.md` |
| Add/modify an agent-related feature | `docs/agents-and-skills.md`, `wiki/Agents.md` |
| Add/modify a skill | `docs/agents-and-skills.md`, `wiki/Skills.md` |
| Add/modify the model router | `docs/model-routing.md`, `wiki/Model-Routing.md` |
| Add/modify a provider adapter | `docs/model-routing.md`, `CONTRIBUTING.md`, `wiki/Model-Routing.md` |
| Add/modify the SSOT/memory system | `docs/ssot-memory.md`, `wiki/Memory-System.md` |
| Add/modify webview panels | `docs/development.md` (Webview Development), `wiki/Architecture.md` |
| Add/modify tree views | `README.md`, `docs/architecture.md`, `wiki/Architecture.md` |
| Change build config or dependencies | `docs/development.md`, `README.md` (Quick Start), `wiki/Contributing.md` |
| Ship a new version | `CHANGELOG.md`, `package.json` (version), `wiki/Changelog.md` |
| Add/modify tool approval or safety | `wiki/Tool-Execution.md`, `wiki/Security.md` |
| Add/modify project planner or scheduler | `wiki/Project-Planner.md` |

### Version Tracking
- Version is in `package.json` → `"version"`.
- Current version: **0.41.14**.
- Every commit must include a version bump in `package.json` using SemVer.
- Every version bump must include a matching `CHANGELOG.md` entry in the same commit.
- Use [Semantic Versioning](https://semver.org/):
  - **PATCH** (0.0.x): bug fixes, docs, refactors.
  - **MINOR** (0.x.0): new features, new commands, new UI.
  - **MAJOR** (x.0.0): breaking changes to config, agent definitions, or memory format.

## Coding Standards

### TypeScript
- **Strict mode** is enabled — no implicit `any`.
- Use `.js` extension on **all** relative imports (Node16 module resolution).
- Prefer `type` imports for types only used in type positions.
- One class per file for core services.
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
generated-at: 2026-04-07T18:00:37.451Z
source-paths: .github/copilot-instructions.md | docs/github-workflow.md
source-fingerprint: 2f47a1f5
body-fingerprint: b23c584a
-->
