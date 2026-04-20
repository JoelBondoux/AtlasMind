# Release History Snapshot

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
- Session search now runs directly against the visible chat thread again, preventing the composer from getting stuck on “Searching this session…” with no follow-up.
- Multi-match search navigation stays responsive with visible previous and next arrows and the active result highlighted in-place.

## [0.52.0] - 2026-04-20

### Added
- Gap Analysis now produces a richer project report covering architecture, safety/security, functionality, UI/UX, memory, code structure, testing, delivery, and praise signals.
- The dashboard groups findings by priority, adds per-gap resolve buttons, and includes one-click actions for resolving all P1 or P2 items in a fresh Atlas chat session.

### Fixed
- Unfinished projects no longer come back with an empty-looking Gap Analysis report when the model response is loose or partially structured.
- Structured gap-analysis results are saved back into the Project Dashboard automatically after the live chat finishes.

## [0.51.9] - 2026-04-20

### Fixed
- Corrected session-search result counting to follow the visible rendered transcript instead of raw Markdown source.
- Added previous and next result arrows beside Search so multi-match threads can be navigated directly.

## [0.51.8] - 2026-04-20

### Fixed
- Replaced the stuck session-search path with an immediate local thread search so results now resolve instantly, even for tiny conversations.
- Restored highlight-and-scroll behavior without leaving the Search button hanging on a running state.

…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-20T13:45:51.402Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 50c78504
body-fingerprint: f2a2e569
-->
