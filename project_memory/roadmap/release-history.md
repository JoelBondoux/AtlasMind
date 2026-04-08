# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.43.6] - 2026-04-08

### Changed
- Moved chat-linked autonomous runs into nested child rows beneath their parent sessions in the shared Atlas chat panel and shortened those run labels to compact review-focused summaries.
- Replaced the flat run jump from the shared chat panel with inline autonomous-run review bubbles that open under the originating assistant turn, expose linked changed files, and keep per-file or bulk approve-dismiss decisions inside the chat surface.
- Added a pending autonomous-run review flyout above the shared chat composer so unresolved file decisions remain visible and actionable without leaving the current conversation.

## [0.43.5] - 2026-04-08

### Fixed
- Moved in-chat tool approval cards below the transcript and above the composer so approval prompts stay anchored near the active input area with stronger warning styling.
- Stopped generic tool approval prompts from opening a new detached chat panel when AtlasMind can instead reuse the current chat surface.

## [0.43.4] - 2026-04-08

### Added
- Added a text-to-speech settings card to the Settings dashboard so AtlasMind voice playback can be tuned directly from the main Models & Integrations page.

### Changed
- Wired the Settings dashboard to the existing workspace voice settings for TTS enablement, rate, pitch, volume, language, and preferred output device.

## [0.43.3] - 2026-04-08

### Fixed
- Stopped Atlas chat from streaming transient progress notes into the visible answer body, so internal execution updates no longer pollute the final response text in the shared chat panel.
- Restored an end-of-response summary for autonomous `/project` runs in chat responses and rendered thinking summaries in a compact collapsible footer instead of as a long inline block.
- Corrected Google Gemini token accounting when the provider returns Gemini-style usage metadata fields instead of OpenAI-style `prompt_tokens` and `completion_tokens`, preventing false `$0` cost reports.
- Prevented Gemini text tasks from routing into `*-tts` preview models by excluding speech-oriented Gemini variants from the normal chat/reasoning model catalog.

## [0.43.2] - 2026-04-07

### Fixed
- Added the missing `CancellationTokenSource` vscode mock to the Copilot discovery test so the full Vitest suite passes with the current Copilot adapter request flow.

## [0.43.1] - 2026-04-07

### Changed
- Made the Voice Panel persist preferred microphone and speaker ids, wired the `atlasmind.voice.sttEnabled` setting into the actual speech-input controls, and added capability notes around browser, ElevenLabs, and future OS-native speech backends.
- Switched ElevenLabs playback in the Voice Panel from raw Web Audio output to `HTMLAudioElement` playbac
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-08T03:55:03.756Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 6e192f73
body-fingerprint: f5be5a1d
-->
