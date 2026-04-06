# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.39.10] - 2026-04-06

### Changed
- Strengthened agent selection with common software-development routing heuristics for debugging, testing, review, architecture, frontend, backend, docs, security, devops, performance, and release-oriented requests.
- Added a visible routing trace to assistant metadata so the Thinking summary now shows the selected agent, detected routing hints, and when workspace-investigation bias was applied.

## [0.39.9] - 2026-04-06

### Changed
- Added a workspace-issue heuristic to freeform chat so bug-report style prompts inject an extra inspect-the-repo-first hint into the default agent context.
- Further reduced the chance of support-style replies for concrete AtlasMind UI or behavior regressions by biasing the model toward workspace evidence before answering.

## [0.39.8] - 2026-04-06

### Changed
- Strengthened the default AtlasMind agent prompt so freeform chat treats repo bug reports as workspace tasks to inspect and act on instead of replying like a support-triage bot.
- Kept the default fallback agent on the full enabled skill set while explicitly biasing it toward repository investigation and execution when tools would help.

## [0.39.7] - 2026-04-06

### Added
- Added a real MCP Servers sidebar tree so configured MCP connections now appear with connection status, tool counts, and row-level actions.
- Added sidebar info actions for Skills and MCP Servers that post assistant-style summaries into the active Atlas chat session.

### Changed
- Switched the Memory, Agent, and Model sidebar info actions from transient notifications or external docs to chat-posted summaries that focus the shared Atlas chat view.

## [0.39.6] - 2026-04-06

### Changed
- Reordered the default AtlasMind sidebar tree views to Project Runs, Sessions, Memory, Agents, Skills, MCP Servers, and Models so operational views surface first below Chat.
- Set the shipped default tree-view visibility to collapsed, while keeping stable view ids in place so VS Code continues to remember each user's custom sidebar order and expanded or collapsed state across later work.

### Added
- Added session archiving across the shared chat panel and Sessions sidebar, including an Archive bucket in the Sessions tree with drag-and-drop restore support.

### Changed
- Replaced live-session text actions in the chat panel with compact archive and delete icon buttons.
- Kept the new archive and restore session commands sidebar-local so they do not appear in the Command Palette.

## [0.39.6] - 2026-04-06

### Changed
- Added title-bar shortcuts for Settings, Project Dashboard, and Cost Dashboard across the Chat, Sessions, and Memory sidebar views so the main control surfaces stay one click away.
- Made th
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-06T07:42:29.865Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: be257bf9
body-fingerprint: f9185628
-->
