# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.47.0] - 2026-04-16

### Added
- **SSOT Project-to-SSOT delta panel** on the Project Dashboard SSOT page. Five areas are analysed on every dashboard refresh and surfaced as status rows:
  - **Documentation** — counts docs/, wiki/, and root markdown files (README, CHANGELOG, CONTRIBUTING) that are newer than the latest SSOT architecture/roadmap/decisions entry.
  - **Codebase** — counts source files in src/ modified since the last SSOT architecture update.
  - **Agent instructions** — compares the number of registered agents against files present in `project_memory/agents/`.
  - **Security** — checks whether SECURITY.md or related policy files have a corresponding entry in `project_memory/misadventures/`.
  - **License** — detects a LICENSE file and flags it if no SSOT entry captures it.
- Each area shows a status badge (ok / stale / missing / unknown), a delta count, and a one-line detail message.
- A **Sync SSOT now** button on the delta card triggers `atlasmind.updateProjectMemory` to re-import changed workspace content into SSOT memory.

## [0.46.31] - 2026-04-16

### Fixed
- All static action buttons in the Project Run Center now give immediate visual feedback when clicked: a CSS spinner overlay replaces the button label while the action is in flight, and the button is disabled to prevent double-submission. The loading state clears automatically on the next state push from the extension.
- Buttons are now disabled with an explanatory tooltip when their preconditions have not been met, rather than appearing pressable and silently doing nothing:
  - **Apply Plan Edits** and **Discuss Draft** are disabled until a plan preview exists.
  - **Execute Reviewed Plan** is disabled until a preview exists, and also while a run is already in progress.
  - **Approve Next Batch** remains hidden when batch-approval mode is off, and is disabled (with reason) when Atlas is not currently waiting at a checkpoint.
  - **Pause Before Next Batch** is disabled when no run is active or the run is already paused.
  - **Resume** is disabled when nothing is paused.
  - **Rollback Last Checkpoint** is disabled while a run is actively executing.
- Hovering over any disabled button now shows a short tooltip explaining why the action is unavailable.

## [0.46.30] - 2026-04-16

### Added
- Project Run Center now shows a **workflow stepper** (Draft goal → Preview plan → Execute → Review results) that highlights the current phase and marks completed phases with a green dot, giving a clear sense of where you are in the process.
- A **live subtask progress tracker** appears in the Execution Control panel during and after a run, showing every planned subtask with a distinct visual state: animated spinning indicator for the cu
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-16T13:06:24.744Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 8f921dc8
body-fingerprint: e5b94b6d
-->
