# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.42.11] - 2026-04-07

### Fixed
- Removed the extra `atlasmind.allowTerminalWrite` hard gate from managed chat-terminal aliases such as `@tcmd` and `@tps`, so those launches now go through the normal risk classification and approval flow instead of failing before approval can run.

## [0.42.10] - 2026-04-07

### Fixed
- Corrected the centered Atlas chat webview layout so the composer stays under the transcript instead of becoming a right-hand column in wide layouts, added a real collapsible Sessions rail for that wider view, and intercepted bare managed-terminal aliases like `@tcmd` so they return usage guidance instead of falling through to the routed model.

## [0.42.9] - 2026-04-07

### Changed
- Added `@tgit` as a managed alias for the Bash or Git Bash runner and replaced generic unknown-alias failures for JavaScript Debug Terminal and Azure Cloud Shell requests with explicit guidance about why those profile-backed or remote terminals are not supported by the current managed shell runner.

## [0.42.8] - 2026-04-07

### Changed
- Added common synonym aliases for managed terminal launches, including full-name forms like `@tpowershell` and `@tcommandprompt`, so operators can invoke the same shell flow with more natural terminal names.
- Corrected DeepSeek provider metadata to match the live API by treating `deepseek-chat` and `deepseek-reasoner` as 128K-context models, marking the reasoner route as tool-capable, and adding regression coverage for the generic OpenAI-compatible payload and tool-call parsing path.

## [0.42.7] - 2026-04-07

### Changed
- Expanded managed terminal chat launches to support multiple shell aliases such as `@tpwsh`, `@tbash`, and `@tcmd`, and let AtlasMind request at most one additional approval-gated command in the same shell session before emitting the final terminal summary.

## [0.42.6] - 2026-04-07

### Changed
- Added a managed terminal launch path to the shared Atlas chat surface so prompts like `@tps Get-ChildItem` can open a PowerShell terminal, stream its output back into the conversation, and hand the result back to AtlasMind for follow-up reasoning while still honoring terminal-write approval rules.

## [0.42.5] - 2026-04-07

### Changed
- Replaced the top AtlasMind Quick Links strip with a composite Home sidebar surface that groups quick actions, recent sessions, recent autonomous runs, and workspace status into internal accordion sections with remembered manual heights.

## [0.42.4] - 2026-04-07

### Changed
- Added a Stop action to the shared Atlas chat composer so an in-flight chat turn can be canceled directly from the input panel without waiting for the full response loop to finish.

## [0.42.3] - 2026-04-07

### Changed
- Added CLI-s
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-07T14:43:50.361Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: f11956ff
body-fingerprint: 71f304ff
-->
