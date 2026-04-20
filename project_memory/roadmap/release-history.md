# Release History Snapshot

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

## [0.51.7] - 2026-04-20

### Fixed
- Restored visible session-search feedback in the chat panel so pressing Search now shows a live running status and a clear match or no-match result.
- Rewired the search toggle to the active webview controls so search mode activates reliably.

## [0.51.6] - 2026-04-20

### Changed
- Moved chat bubble deletion from the header X control into a cleaner footer trash icon beside the assistant vote actions, keeping message deletion available with a more minimal layout.

## [0.51.6] - 2026-04-20

### Fixed
- Gap Analysis now visibly starts from the Project Dashboard, immediately opens its page, and shows progress/status while the analysis runs.
- Resolved the silent no-op feeling when triggering Gap Analysis from the dashboard UI.

## [0.51.5] - 2026-04-20

### Fixed
- Restored the Project Dashboard after a Gap Anal
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-20T13:03:29.497Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: b351a2bc
body-fingerprint: c5122df0
-->
