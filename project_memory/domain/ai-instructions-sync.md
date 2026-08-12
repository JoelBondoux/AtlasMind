# AI Instructions (unified)

> Two-way synced on 2026-08-12. Reconciled superset across all detected AI assistants.
> AtlasMind mirrors this set into each tool's instruction file inside a managed block.

## Shared Project Instructions (managed by AtlasMind)

> Unified across all detected AI assistants. Re-run AtlasMind → Settings → AI Instructions →
> "Align all instruction sets" to refresh. Content inside this block is overwritten on each sync.

### safety

- AtlasMind operates with safety-first defaults: treat chat input, webview messages, workspace files, model output, and tool parameters as untrusted; validate before execution, redact before sending externally, confirm before destructive actions, and deny by default when behavior is ambiguous. Security-sensitive regressions are correctness defects.

### architecture

- Core structure is anchored in `src/extension.ts` (`activate()` builds services and registers commands/views into `AtlasMindContext`), with shared interfaces in `src/types.ts`, provider adapters in `src/providers/adapter.ts`, and no duplicate type definitions. Keep architectural references aligned when services, surfaces, or bindings change.

### release

- `package.json` version is source of truth. Every commit must include a SemVer bump in `package.json` plus a matching `CHANGELOG.md` entry in the same commit. Use `# Changelog` Keep-a-Changelog format and never remove its preamble. `README.md` version banner must match `package.json`.
- Release routine is Actions-driven: commit changes, merge to develop, run compile/package, open release PR from develop to main, wait for merge + CI, then run `npm run tag:release` and publish by normal tag-triggered flow. `publish:release` is emergency/local only and should not be the normal release path; CI publishing uses Entra and requires proper `marketplace` environment context and existing verification workflow.

### documentation

- When release notes or user-facing docs change, update `README.md` and corresponding wiki pages in the same commit. Keep wiki mirrored to docs updates where defined.
- Apply doc updates in the same pass/commit for: add/remove/rename source file (README project structure, docs/architecture, docs/development, wiki/Architecture); VS Code command (README extension commands, package.json, wiki/Chat-Commands); chat slash command (README slash commands, package.json, wiki/Chat-Commands); config setting (README configuration, package.json, docs/configuration, wiki/Configuration); type in `types.ts` (docs/architecture, wiki/Architecture); add/modify core service (docs/architecture, wiki/Architecture); Planner/task scheduler (docs/agents-and-skills, wiki/Project-Planner, wiki/Architecture); agent definition/routing logic (docs/agents-and-skills, wiki/Agents); skill or `builtinWorkspaceTools.ts` (docs/agents-and-skills, wiki/Skills, wiki/Project-Planner as applicable); model router (docs/model-routing, wiki/Model-Routing); provider adapter (docs/model-routing, CONTRIBUTING, wiki/Model-Routing); SSOT/memory system (docs/ssot-memory, wiki/Memory-System); MCP registry/tools (docs/agents-and-skills, wiki/Skills, wiki/Architecture); tool approval/safety/security boundary (wiki/Tool-Execution, wiki/Security, and docs/agents-and-skills when behavior changes); webview panel (docs/development, wiki/Architecture); tree views (README, docs/architecture, wiki/Architecture); project routines or `/ship` (wiki/Project-Planner, wiki/Chat-Commands); build config/scripts/dependencies (docs/development, README, wiki/Contributing); shipping a new version (CHANGELOG, package.json version, README banner, wiki/Changelog).

### process

- Before reporting completion, verify each applicable documentation-maintenance row was updated (or explicitly confirmed unchanged).
- Use conventional commit prefixes (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`) and keep version/changelog/doc updates in the same commit scope.

### workflow

- Use `develop` for routine implementation and merge PRs there; `main` is protected and updated only via intentional release promotion. Do not push directly to protected branches.
- Workflow is staged (observe/auto/auto etc.): respect stage ceilings (planning, PR/review, CI, release, maintenance, automation policy are observe), use only repository labels from the approved set (`bug`, `enhancement`, `documentation`, `security`, `dependencies`, `workflow`) with at most one per category, and separate human checks from machine status checks (`CI`).
- When workflow guidance is generated in-repo, treat the managed workflow source as authoritative over copied mirrors; if copied text is stale, follow the managed file/authoritative block.

### coding

- Use strict TypeScript (no implicit `any`), `.js` extension on all relative imports (Node16), prefer `type` imports for type-only usage, and keep one class per core service file.

### security

- Keep API keys in VS Code SecretStorage only. Webview HTML must use `escapeHtml()` and nonce-protected scripts with no inline event handlers. Validate webview messages before mutating config, touching secrets, or invoking commands. Filesystem operations must reject path traversal and default to non-destructive behavior. Maintain redaction boundaries for memory retrieval and model execution.

### maintainability

- Technical debt markers are comment-based and must be first-word in comment text: `TODO:`, `FIXME:`, `HACK:` or `XXX:`. Do not rely on other marker forms.

### testing

- Testing requirements are specified outside these instruction summaries (testing config/protocols in project workflow files); follow those sources for execution, not duplicated inline assumptions.

### communication

- When addressing the user in responses, use the phrase "The User".

### develop -> main release PR merge method

- Release PR uses merge commit (never squash) and `release.yml` uses `--merge`.
