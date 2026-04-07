# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.43.2] - 2026-04-07

### Fixed
- Added the missing `CancellationTokenSource` vscode mock to the Copilot discovery test so the full Vitest suite passes with the current Copilot adapter request flow.

## [0.43.1] - 2026-04-07

### Changed
- Made the Voice Panel persist preferred microphone and speaker ids, wired the `atlasmind.voice.sttEnabled` setting into the actual speech-input controls, and added capability notes around browser, ElevenLabs, and future OS-native speech backends.
- Switched ElevenLabs playback in the Voice Panel from raw Web Audio output to `HTMLAudioElement` playback so supported runtimes can honor a selected output device through `setSinkId()`.
- Expanded Project Ideation with injected constraints, deterministic context packets, auditable run lineage, and one-click promotion of a selected card into a drafted `/project` execution prompt.
- Added richer card modes, evidence-aware attachments, confidence and validation scoring, board lenses, smart relation suggestions, and genealogy cues so the ideation board behaves more like a lightweight knowledge graph.

## [0.42.5] - 2026-04-07

### Changed
- Reverted the experimental composite Home sidebar and restored the previous native AtlasMind sidebar layout with the compact Quick Links strip at the top.

## [0.42.4] - 2026-04-07

### Changed
- Moved the Settings dashboard extension version badge from the title row to the lower-right corner of the hero banner.

## [0.42.3] - 2026-04-07

### Changed
- Added CLI-style prompt history navigation to the shared Atlas chat composer so pressing Up or Down at the start or end of the input recalls recent submitted prompts without breaking multiline editing.

## [0.42.2] - 2026-04-07

### Added
- Added a dedicated built-in `docker-cli` skill so AtlasMind can inspect containers and run controlled Docker Compose lifecycle operations through a strict allow-list instead of generic terminal passthrough.

### Changed
- Classified Docker tool calls as terminal-read or terminal-write based on the requested Docker or Docker Compose action so approval prompts match the operational risk.

## [0.42.1] - 2026-04-07

### Changed
- Added an AtlasMind sidebar container action that runs Collapse All across every AtlasMind tree view, so the sidebar title overflow menu now has a single command for folding the operational trees back down.

## [0.42.0] - 2026-04-07

### Added
- Added a Claude CLI (Beta) routed provider that reuses a locally installed Claude CLI login through constrained print-mode execution in both the extension host and the AtlasMind CLI.
- Added Claude CLI (Beta) provider discovery, seed models, provider-panel setup detection, and catalog metadata so the new backend is clearly lab
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-07T18:05:03.567Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: d3ba1cc6
body-fingerprint: e588ea3f
-->
