# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

<<<<<<< HEAD
## [0.49.1] - 2026-04-16

### Fixed
- **Image context continuity across follow-up turns:** When the user attaches an image in one turn and then sends a follow-up (e.g. "is it done?", "what did you find?") without re-attaching the image, Atlas now automatically carries forward the image data from the most recent prior turn. Previously the image was effectively dropped after Turn 1 — the session context only retained the filename as a text label, leaving the model unable to reference or complete image-related tasks. The carried-forward images are flagged so the model uses the prior analysis rather than repeating a full re-scan.
- **"Status-checking loop" on incomplete image tasks:** As a direct consequence of the above, Atlas no longer gets trapped probing workspace files when asked to confirm or continue an image-driven task. With the image available in subsequent turns, the model has the visual context it needs to complete the work or give a concrete answer.

=======
>>>>>>> 3ef5f5a0deb5c668b775a31473176b4b9f96f3fa
## [0.49.0] - 2026-04-16

### Added
- **Provider billing auto-pause:** When a provider responds with a billing or insufficient-credits error during a chat prompt, AtlasMind now automatically pauses that provider for the session and attempts failover to another available model. If failover succeeds, the executive summary includes a notice identifying the paused provider and the model that completed the request. If no fallback is available, the response ends with a friendly user-facing notice directing to Model Providers settings.
- The Models sidebar panel title now shows a badge counter whenever one or more providers have been auto-paused during the session, providing a quick visual signal that an automated provider change occurred.
- Auto-paused providers are labelled `(⚠ auto-paused)` in the Models tree view so the affected provider is immediately identifiable.

## [0.48.5] - 2026-04-16

### Fixed
- The dedicated Atlas chat composer is now status-driven: fresh or completed sessions fall back to `Send`, the active session automatically flips to `Steer` while Atlas is still thinking, and one-shot `New Chat` / `New Session` selections no longer stay stuck for later prompts.

## [0.48.4] - 2026-04-16

### Changed
- Atlas chat table font-size reduced to 0.875em and headers now `white-space: nowrap` for better column readability.
- In-answer collapsible sections (auxiliary panels and tables) now render in a slightly lighter shade than the footer executive summary, making the two levels visually distinct.
- The “multiple routed models” model badge now shows a hover tooltip listing every unique model invoked in the current session.

### Fixed
<<<<<<< HEAD
- Atlas chat bubbles now show selectable follow-up option toggles with an explicit Proceed button inline next t
=======
- Atlas chat bubbles now show selectable follow-up option toggles with an explicit Proceed button inline next to the thumbs controls, so choice-based replies no longer trigger immediately on the first click.
- When Atlas ends a reply with a concrete “do you want me to do X or Y?” question, the chat footer now derives those choices into actionable UI controls for a cleaner next step.

## [0.48.3] - 2026-04-16

### Fixed
- Copilot model discovery now merges the GitHub-backed VS Code LM vendor aliases used by newer preview models, so AtlasMind refreshes can surface entries such as Goldeneye when VS Code exposes them.
- AtlasMind now re-syncs the routed provider catalog when VS Code reports a chat-model availability change, keeping the Models panel closer to the live Copilot session state.

## [0.48.2] - 2026-04-16

### Fixed
- Copilot provider: sanitize MCP tool names (which contain colons) to meet VS Code Language Model API's `[a-zA-Z0-9_-]` requirement. Names are mapped back to their originals on tool call responses, and replayed correctly in multi-turn history.

>>>>>>> 3ef5f5a0deb5c668b775a31473176b4b9f96f3fa
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
<<<<<<< HEAD
generated-at: 2026-04-16T19:45:30.079Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 7ba61c57
body-fingerprint: 4aec1713
=======
generated-at: 2026-04-16T18:09:56.103Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 3d7bd4b6
body-fingerprint: 035a2c57
>>>>>>> 3ef5f5a0deb5c668b775a31473176b4b9f96f3fa
-->
