# Release History Snapshot

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.171.1] - 2026-07-28

### Fixed
- **"Dashboard refresh failed — directorBoundAgentId is not defined".** The entire Project Dashboard failed to render for any project with a Buzz contact. When a Buzz identity became bindable to *several* agents in v0.163.0, `directorBoundAgentId` was pluralised to `directorBoundAgentIds`, and one call in the Director contact-card renderer was left behind. The card now reads the list correctly and names the **owning** agent with a `+n` for the rest, matching how the binding is actually defined (first owns the work, the others are also-relevant).

### Added
- **A guard for the class of bug that caused it.** Webview scripts are strings handed to a browser: never type-checked, never imported by a test. A renamed function leaves its old call site behind, `tsc` says nothing, every test passes, and the failure arrives as a `ReferenceError` at render time that takes down the **whole panel** — and it only fires on the code path that touches it, which is why this one survived review. `tests/views/webviewIdentifierIntegrity.test.ts` parses each webview script with a real JS parser and asserts every identifier it reads is bound: declared in the file, a function parameter, or a genuine browser/host global. Parsing rather than pattern-matching is the point — prose like `3 subtask(s) recorded` inside a template literal is indistinguishable from a call to `subtask()` under a regex. The test is pinned against both the exact bug that shipped and that false positive.

## [0.171.0] - 2026-07-28

### Added
- **`/acp` — a guided ACP setup walkthrough, in the same shape as `/buzz`.** Five steps: name an agent → install it → sign in → enable the provider → **prove a completion comes back**. State is derived from your actual configuration rather than asked for, one step is shown at a time with the command written out, and the checklist says done / to do / blocked / optional for each. New `src/core/acpSetupPlan.ts`, unit-tested.
- **`/setup` — the index of every setup guide and how far along each one is.** A feature that needs configuring should be discoverable *before* you hit the failure that configuring it would have prevented. `/setup acp` and `/setup buzz` jump straight into a guide. New `src/core/setupGuideRegistry.ts`; each guide's progress is computed from that guide's own plan, so the index cannot claim a guide is finished while the guide disagrees.
- **Setup guides now share their mechanics rather than resembling each other.** New `src/core/setupWalkthrough.ts` owns the step model, next-step selection, progress counting, and markdown rendering for every guide; `buzzSetupPlan.ts` delegates to it (all 62 of its existing tests unchanged) and 
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-07-28T12:06:49.103Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: b4a98bdb
body-fingerprint: b9d598df
-->
