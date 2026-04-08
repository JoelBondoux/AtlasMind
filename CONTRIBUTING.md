# Contributing to AtlasMind

## Development Setup

1. Clone the repo and install dependencies:
   ```bash
   npm install
   ```

2. Compile:
   ```bash
   npm run compile
   ```

3. Press **F5** in VS Code to launch the Extension Development Host.

4. Use watch mode during development:
   ```bash
   npm run watch
   ```

5. Run quality checks before opening a PR:
   ```bash
   npm run lint
   npm run test
   npm run compile
   ```

## Project Conventions

### TypeScript
- Strict mode enabled. No `any` unless unavoidable.
- ES2022 target, Node16 module resolution.
- All imports use `.js` extension (required by Node16).
- Shared types go in `src/types.ts`.

### File Organisation
- **One class per file** for core services (orchestrator, registries, router).
- **Views** live in `src/views/`.
- **Provider adapters** live in `src/providers/`. Each provider gets its own file.
- **Barrel exports** (`index.ts`) for each module directory.

### Provider Adapter Notes
- OpenAI-compatible adapters must preserve Atlas skill ids across provider calls even when the upstream provider restricts tool/function name characters. AtlasMind currently normalizes those names at the adapter boundary and maps returned tool calls back to the original internal ids.

### Commits
- Use conventional commit messages: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`.
- Every commit is pushed to the remote.
- Every commit includes an appropriate SemVer bump in `package.json` and a matching `CHANGELOG.md` update.

### Branching and Pull Requests
- Branch from `develop` using descriptive names (for example `feat/provider-health-checks`).
- `develop` is the default branch for routine integration work and normal push targets.
- Keep `master` reserved for release-ready stable builds only.
- Open pull requests early and link the governing issue.
- Complete all PR checklist items from `.github/pull_request_template.md`.
- For the current solo-maintainer flow, rely on required CI plus PR-only merges on `master` instead of mandatory reviewer approval.
- Merge feature work into `develop` when CI checks pass.
- Promote `develop` into `master` only when you intentionally want a new published stable release.
- Marketplace publication uses the standard release channel (`npm run publish:release`); use `npm run publish:pre-release` only for explicit opt-in pre-release cuts.
- Do not treat `master` as a normal development push target.

### Issues and Project Tracking
- Create bugs and features using the issue templates under `.github/ISSUE_TEMPLATE/`.
- Apply labels for type, priority, and status.
- Add issues and PRs to the GitHub Project board with clear status.
- Keep acceptance criteria explicit before implementation starts.

### Documentation
- **Always** update docs when changing public interfaces, adding features, or modifying architecture.
- Copilot instructions (`.github/copilot-instructions.md`) enforce this automatically.
- Architecture docs live in `docs/`.

### Security
- API keys are stored in VS Code `SecretStorage` — never in settings or source control.
- Webview CSP is locked down with nonce-protected scripts and no inline event handlers.
- All user input displayed in webviews is HTML-escaped.
- Vulnerability disclosures must follow [SECURITY.md](SECURITY.md); do not use public issues for security reports.

### Safety-First Review Checklist
- Validate every message crossing the webview or tool boundary.
- Prefer deny-by-default behavior for file writes, command execution, and provider access.
- Never write secrets to the workspace, logs, settings, or SSOT memory.
- Avoid destructive filesystem behavior unless the user explicitly confirms it.
- Document every new security-sensitive behavior in `README.md` and the relevant file in `docs/`.

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full system design.
See [docs/github-workflow.md](docs/github-workflow.md) for branch, PR, issue, and project standards.

### Key Design Principles
1. **Incremental** — features are stubbed first, then implemented.
2. **Modular** — each subsystem (routing, memory, agents) is independently testable.
3. **Cost-aware** — every LLM call is tracked and constrained by user preferences.
4. **Memory-first** — the SSOT is the canonical source of project knowledge.

## Adding a New Provider

1. Create `src/providers/<name>.ts` implementing `ProviderAdapter`.
2. Export it from `src/providers/index.ts`.
3. Register it through the shared runtime bootstrapping path so both `src/extension.ts` and `src/cli/main.ts` can opt into it.
4. Add its config to the Model Provider webview.
5. Update `docs/model-routing.md` and this file.

Reference implementation:
- `src/providers/anthropic.ts` demonstrates host-neutral secret-store credential lookup, retry handling for `429`/`5xx`, and usage token parsing.
- `src/providers/bedrock.ts` demonstrates a dedicated provider path for AWS SigV4 signing, canonical request-path handling, and Bedrock-specific request/response mapping.
- `src/providers/claude-cli.ts` demonstrates a host-neutral CLI-backed Beta provider that validates local install and auth state before routing AtlasMind requests through constrained `claude --print` execution, including print-response sanitization for embedded pseudo-tool markup, explicit empty-result failure handling, and capability sanitization so the print-mode bridge is not advertised as `function_calling` capable.
- `src/providers/copilot.ts` demonstrates VS Code Language Model API integration for GitHub Copilot-backed execution, with access intentionally deferred until the user explicitly activates the Copilot provider.
- `src/providers/openai-compatible.ts` demonstrates a reusable adapter pattern for OpenAI-compatible APIs (OpenAI, Azure OpenAI, Gemini-compatible endpoint, DeepSeek, Mistral, z.ai, xAI, Cohere compatibility, Hugging Face Inference, NVIDIA NIM, and Perplexity-style custom paths/static catalogs), including provider-specific request compatibility such as modern OpenAI token fields, `developer` system-role mapping, omission of unsupported parameters for fixed-temperature model families, and normalization of upstream model IDs into AtlasMind's internal `provider/model` format.
- `src/providers/registry.ts` contains the host-neutral provider registry and configurable local provider path for OpenAI-compatible local runtimes such as Ollama or LM Studio.

If a provider should work in both the extension and the CLI, keep the adapter free of direct `vscode` imports and depend on the shared secret abstraction in `src/runtime/secrets.ts`. VS Code-only providers such as Copilot can remain extension-host specific.

For SigV4-backed providers, do not pre-encode path segments before canonical signing. The actual HTTP request path and the canonical request path must stay byte-for-byte aligned or the upstream signature check will fail.

If a provider supports multimodal prompts, implement `ChatMessage.images` forwarding rather than silently discarding image attachments.

Provider model catalogs are refreshed at startup and via the Model Providers panel.
Interactive providers that require a user permission prompt, such as GitHub Copilot through VS Code's language-model API, should defer runtime discovery until the user explicitly activates them.
When adding a provider, ensure `listModels()` returns discoverable model IDs whenever the upstream API supports it.
If an upstream API is not a routed chat backend, or it requires workflow-specific auth and request signing, document it as a specialist or future integration rather than forcing it into the generic model-provider list. AtlasMind now uses `src/views/specialistIntegrationsPanel.ts` as the dedicated surface for non-routing vendors such as EXA, ElevenLabs, Stability AI, and Runway.
When changing routing heuristics, validate both low-stakes and high-stakes follow-up prompts. Free or local models should stay attractive for simple turns, but they should not dominate later thread-based requests when the task profile signals higher reasoning demand.

Minimum validation for provider work:

- Add or update adapter-level tests in `tests/providers/`.
- Add routing or orchestrator regression coverage when the change affects failover, health, pricing, or capability selection.
- Update `.github/integration-monitor.json` when the new provider introduces a third-party dependency or monitoring obligation.

## Debugging Orchestration And Concurrency

Use the same boundaries the code uses:

1. Confirm whether the issue is in agent selection, skill availability, provider routing, or tool execution before editing shared orchestrator code.
2. Inspect Project Run Center state, `ProjectRunHistory`, and webhook events for autonomous-run failures.
3. Use `diagnostics` and `workspace-observability` to capture editor-state evidence instead of guessing from the final model response alone.
4. For race-condition or dependency-order problems, add a focused `tests/core/planner.scheduler.test.ts` or integration regression before changing scheduler behavior.
5. For routing regressions, add coverage near `tests/core/orchestrator.tools.test.ts` or the relevant provider tests before changing heuristics.

AtlasMind does not yet ship a formal load-test harness. For performance-sensitive changes, repeated local execution and targeted regression tests are the current required bar.

## Adding A Runtime Plugin

The shared runtime now supports `AtlasRuntimePlugin` contributions through `src/runtime/core.ts`.

Use a runtime plugin when you want to add agents, skills, or provider adapters without forking the bootstrap sequence used by both the extension and the CLI.

1. Create an `AtlasRuntimePlugin` object in your host or integration layer.
2. Register capabilities through `AtlasRuntimePluginApi.registerAgent()`, `registerSkill()`, or `registerProvider()`.
3. Optionally listen to `AtlasRuntimeLifecycleEvent` values through `onRuntimeEvent()` for diagnostics or tracing.
4. Pass the plugin to `createAtlasRuntime({ plugins: [...] })`.
5. Add runtime tests in `tests/runtime/` and update the architecture or development docs.

## Adding a New Agent

1. Define the agent in `project_memory/agents/` (or programmatically).
2. Register it via `AgentRegistry.register()`.
3. Update `docs/agents-and-skills.md` if it introduces new patterns.

See [docs/agents-and-skills.md](docs/agents-and-skills.md) and [wiki/Agents.md](wiki/Agents.md) for full agent authoring details.

## Adding a New Skill

1. Create a handler module in `src/skills/`.
2. Define the `SkillDefinition` with a JSON Schema for tool parameters.
3. Register it via `SkillsRegistry.register()`.
4. Assign it to agents that need it.
5. Add a corresponding test in `tests/skills/`.

See [docs/agents-and-skills.md](docs/agents-and-skills.md) and [wiki/Skills.md](wiki/Skills.md) for full skill authoring details.

## Adding an MCP Server

1. Open the MCP Servers panel (`AtlasMind: Manage MCP Servers`).
2. Add a server with stdio or HTTP transport.
3. MCP tools are automatically registered as skills in the SkillsRegistry.

See [wiki/Tool-Execution.md](wiki/Tool-Execution.md) for MCP integration details.
