# Release History Snapshot

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.52.9] - 2026-04-20

### Fixed
- Restored the missing `# Changelog` title and release-notes preamble so the file keeps its expected structure.
- Added a regression check and authoring guardrails so future release updates preserve the heading instead of overwriting it.

## [0.52.8] - 2026-04-20

### Fixed
- Atlas no longer stops after a tool failure and summarizes the error — it now attempts alternative strategies (e.g. reading the file to get exact text before retrying a file-edit) and only reports a hard blocker when alternatives are genuinely exhausted.
- Plain text pasted into Atlas Chat now stays in the composer instead of being misinterpreted as a set of attachment chips.
- The host-side attachment importer now ignores non-existent workspace paths so arbitrary prose cannot be promoted into fake file attachments.
- Restored the default-agent fallback for routine no-agent sessions so action-oriented workspace requests no longer detour through premature specialist synthesis.
- Hardened chat-session persistence logging for both synchronous and asynchronous storage failures.
- Made the MCP workspace-placeholder transport test pass consistently across Windows, macOS, and Linux CI.

## [0.52.6] - 2026-04-20

## [0.52.6] - 2026-04-20

### Fixed
- Restored the missing integration-monitor manifest so protected CI can verify marketplace-extension coverage, provider contract coverage, and specialist integration review during release promotion.

## [0.52.5] - 2026-04-20

### Fixed
- Cleared release-blocking lint violations across commands, environment tracking, chat search, dashboard helpers, and testing summaries so protected CI now passes for the master promotion flow.

## [0.52.4] - 2026-04-20

### Fixed
- Tightened Atlas chat intent handling so prompts about missing version or changelog updates are treated as corrective workspace tasks instead of being misread as simple version lookups.
- Hard-coded release-hygiene guidance into the default agent instructions so version bumps, changelog updates, and related docs stay part of the expected completion path.

## [0.52.3] - 2026-04-20

### Fixed
- Repaired the session-search jump helpers so previous and next arrows now advance through results instead of stalling in the webview.
- Wired prompt cancellation through the active chat execution path so Stop can interrupt answer generation more reliably.

## [0.52.2] - 2026-04-20

### Fixed
- Active session-search results now snap into the center of the transcript and visibly select their containing chat bubble.
- Previous and next search arrows now move through results with a stronger in-thread visual jump.

## [0.52.1] - 2026-04-20

### Fixed
- Session 
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-20T14:01:48.258Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 0bf53ae5
body-fingerprint: 90be08bb
-->
