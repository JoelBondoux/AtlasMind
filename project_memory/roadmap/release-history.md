# Release History Snapshot

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

## [0.62.1] - 2026-06-03

### Added
- `architecture/boundaries-and-seams.md`: explicit review of all 8 integration seams (VS Code Extension API, Extension Host ↔ Webview, UI ↔ Orchestrator, Orchestrator ↔ Providers, Orchestrator ↔ Skills, Orchestrator ↔ Memory, Extension ↔ SecretStorage, AtlasMind ↔ MCP Servers) with contracts, protocols, and security rules for each. Closes the P2 architecture gap item.
- `docs/architecture/orchestrator-flow.md`: Mermaid flow diagrams for `processTaskWithAgent` and `runAgenticLoop` internals.
- Detailed architecture subdocs table added to `docs/architecture.md` and `wiki/Architecture.md`.

### Fixed
- Completed the built-in agent prompt editing implementation from 0.62.0: `extension.ts` now persists system prompt, description, and flag overrides for built-in agents in `atlasmind.builtInAgentPromptOverrides`; the Agent Editor panel wires the save/reset actions for built-in agents.
- `AgentAutoUpdater` no longer hard-skips built-in agents (the 0.62.0 changelog claimed this but the implementation hadn't landed yet).

## [0.62.0] - 2026-06-03

### Added
- **Built-in agent prompt editing**: System prompt, description, cost limit, and auto-update settings are now editable for built-in agents in the Agent Editor. Changes are stored as overrides in `atlasmind.builtInAgentPromptOverrides` and applied on top of the factory defaults at each activation, so they survive extension reloads.
- **"Reset to defaults" button**: Built-in agent editor now has a "Reset to defaults" button that restores the factory system prompt and description after confirmation, clearing the stored override.
- **Built-in agents are now auto-updatable**: The `AgentAutoUpdater` no longer hard-skips built-in agents. When the global cadence is set, built-in agent system prompts and descriptions are refreshed alongside user-defined agents. The "Exclude from auto-updates" checkbox is now active for all agents.
- **`BUILTIN_AGENT_DEFAULTS`**: Exported from `runtime/core.ts` so the extension can look up original factory definitions for reset and future tooling.

### Fixed
- **`primaryRoutingNeeds` on `AgentDefinition`**: Each built-in agent now declares the routing need IDs it is the primary handler for (e.g. `['debugging']` for Workspace Debugger, `['security', 'review']` for Security Reviewer). The orchestrator scores these structural declarations at +25 per matched need (LLM-classified) or +15 (regex fallback), giving specialists a dominant signal over token-overlap noise.
- **`fromLlm` on `ClassificationResult`**: The classifier now reports whether its output came from an LLM call or the regex fallback, allowing the orchestrator to apply higher tru
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-06-03T23:24:49.140Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: d6c3b187
body-fingerprint: 850b9937
-->
