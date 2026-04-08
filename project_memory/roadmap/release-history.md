# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.45.1] - 2026-04-08

### Changed
- Settings panel: Opening AtlasMind Settings now auto-migrates an explicitly configured legacy `atlasmind.localOpenAiBaseUrl` into the structured `atlasmind.localOpenAiEndpoints` list when no structured local endpoint list exists yet.

## [0.45.0] - 2026-04-08

### Added
- Local provider: AtlasMind can now aggregate multiple labeled local OpenAI-compatible endpoints under the single Local provider, which lets workspaces keep engines such as Ollama and LM Studio online together while preserving which endpoint owns each routed local model.
- Settings panel: Models & Integrations now exposes a dynamic local-endpoint list with a `+` add control so operators only create extra endpoint fields when they actually need them.

### Changed
- Model Providers panel: The Platform & Local page now shows each configured local endpoint by label and base URL so operators can tell which local engine is which at a glance.

## [0.44.37] - 2026-04-08

### Changed
- Chat panel: Softened the transcript header role pill and model badge, and tightened header spacing so assistant replies read with a quieter, denser hierarchy closer to first-party Copilot surfaces.

## [0.44.36] - 2026-04-08

### Changed
- Chat panel: Reorganized assistant footer metadata into compact disclosure cards with a separate utility row for votes and run links, keeping reasoning and work-log details secondary to the answer body.
- Chat panel: Tightened follow-up chips and reasoning typography so Atlas process detail reads closer to a compact professional assistant transcript.

## [0.44.35] - 2026-04-08

### Fixed
- Chat panel: Fenced code blocks in assistant responses now stay intact across blank lines instead of fragmenting into accidental headings and oversized transcript sections.

### Changed
- Chat panel: Tightened transcript card spacing, constrained code block presentation, and made follow-up controls more compact so long technical answers remain readable in the dedicated Atlas chat surface.

## [0.44.34] - 2026-04-08

### Fixed
- Workspace-backed assessment prompts: AtlasMind now treats requests about the current project structure, settings pages, and voice settings as workspace-investigation tasks more reliably instead of drifting into generic architecture prose.
- Read-only exploration follow-through: when Atlas has already gathered enough repository evidence, the exploration nudge now requires an exact existing file path or one final lookup, reducing vague answers that only mention hypothetical files or UI areas.

## [0.44.33] - 2026-04-08

### Changed
- Chat panel: Session timeline bullets now render with inline body-style labels instead of oversized title-like headings, improving transcr
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-08T11:15:08.496Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: e6dc1644
body-fingerprint: 4568fb51
-->
