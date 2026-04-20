# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.50.1] - 2026-04-19

### Fixed
- **`file-move` and `file-delete` tool approval misclassification**: Both tools were falling into the `default` branch of `classifyToolInvocation`, which classified them as `category: 'network'` instead of `'workspace-write'`. This caused two symptoms: the approval UI showed an incorrect category label, and any prior "bypass workspace-write" approval granted by the user would not match — causing the approval prompt to re-fire on every file-move/delete in the same task. Both tools are now explicitly listed as `workspace-write` alongside `file-write` and `file-edit`.

## [0.50.0] - 2026-04-19

### Added
- **Import session context**: Each session bubble in the Sessions panel now has a "share" icon button (alongside Archive and Delete). Clicking it calls the orchestrator with a focused summarization prompt against the source session's full transcript, writes the condensed markdown summary to `.atlasmind/session-context-<title>-<id>.md` (excluded from git via `.gitignore`), and attaches the file to the current session's composer — ready to be sent with the next prompt. The active session cannot import from itself. The summary includes Goal, Key Decisions, Findings, and Open Items sections.

## [0.49.43] - 2026-04-19

### Added
- **Agent synthesis transparency**: When the orchestrator auto-synthesizes a specialist agent, the chat now clearly explains what happened. The status bar shows live progress messages ("No registered agent closely matched this task — creating a specialist agent on the fly" and "Synthesized specialist agent X (role) — registered for this session"). The thought summary (expandable details block on the response) is relabelled "Thinking summary — new agent created" and its body describes the synthesized agent by name. Four additional bullets appear: the auto-synthesis trigger explanation, the agent's role, its purpose/description, and a note that the agent persists for the session and can be managed from the Agents panel. This uses a new `synthesizedAgent` field on `TaskResult` threaded from `processTask` through `buildAssistantResponseMetadata`.

## [0.49.42] - 2026-04-19

### Added
- **Agent auto-synthesis**: When a task arrives with specialisation signals (routing needs detected) and no registered agent scores any token overlap against it, the orchestrator now synthesises a specialist agent on the fly before executing the task. The LLM generates a focused `AgentDefinition` JSON (role, description, system prompt), which is then validated by `validateSynthesizedAgent()` — checking for required fields, length limits, prompt-injection patterns, and authority-escalation phrases. Agents that pass validation are wrapped with `IMMUTABLE_GUARDRAILS` and `DEFAULT_AGE
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-19T21:32:23.821Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 7b33a807
body-fingerprint: 2035fc60
-->
