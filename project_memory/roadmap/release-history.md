# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).


## [0.49.7] - 2026-04-17

### Security & Reliability
- **Chat panel event handler audit:** Thoroughly reviewed and validated all chat panel button click handlers and backend message routing. Confirmed the Send button, keyboard shortcuts, and backend prompt submission logic are present, correct, and free of merge artifacts or breakage. No code changes were required, but the audit ensures confidence in the click-to-prompt flow after recent merges.

## [0.49.6] - 2026-04-17

### Fixed
- **Chat font size now persists across VS Code restarts.** Previously font-size changes were stored only in the webview's ephemeral `vscode.setState` and were lost when the panel was fully disposed. The scale is now round-tripped through `globalState` via a `saveFontScale` message so it survives window reloads.

### Changed
- **Internal monologue (thought-summary) blocks are now visually subordinate to the reply text.** The disclosure header is rendered at `0.75rem` in `descriptionForeground` rather than the full foreground colour, so the model's reasoning steps recede behind the actual response.
- **Live thinking steps are now surfaced as a collapsible block during a response.** Each progress message emitted by the orchestrator while the model is working is appended to an auto-open `<details>` block above the thinking spinner. The most-recent step is emphasised; older steps are dimmed. The block collapses automatically once the response is complete.

## [0.49.5] - 2026-04-17

### Fixed
- Atlas chat no longer forces the transcript to scroll to the bottom while the user has manually scrolled up to review an earlier reply. Auto-scroll resumes only once the user is within 80 px of the bottom, or when they send a new prompt.
- Focus is no longer stolen from the send mode selector (or any other interactive control) by the periodic composer focus-restore that fires on state updates. The restore now skips if a button, input, select, or textarea other than the composer is already active.
- Selecting **New Chat** or **New Session** from the send mode dropdown no longer immediately snaps back to **Send**. The selector now shows the chosen one-shot mode while it is queued, making it clear the next prompt will open a new thread. The mode is cleared and the selector reverts to **Send** automatically after the prompt is submitted.

## [0.49.4] - 2026-04-17

### Added
- **Continue and Cancel actions when the iteration limit is reached:** When AtlasMind stops because the agentic loop hit `maxToolIterations`, the chat message now shows a **Continue** button (re-submits the original prompt so the model picks up where it left off) and a **Cancel** button (dismisses the limit and keeps the partial result).
- **Max Tool Iterations exposed in S
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-17T03:59:16.374Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: c8276ad5
body-fingerprint: a531da5c
-->
