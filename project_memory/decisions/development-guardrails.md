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
- Current version: **0.39.12**.
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
entry-path: decisions/development-guardrails.md
generator-version: 2
generated-at: 2026-04-06T07:57:28.554Z
source-paths: .github/copilot-instructions.md | docs/github-workflow.md
source-fingerprint: 02b7a8a7
body-fingerprint: dd9c4ad1
-->
