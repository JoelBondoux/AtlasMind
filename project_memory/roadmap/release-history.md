# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.46.9] - 2026-04-10

### Changed
- Project Ideation now sends focused cards straight into Project Run Center as seeded run previews instead of only drafting a chat prompt, and the ideation inspector now exposes that execution handoff more explicitly.
- Project Run history now stores ideation-origin metadata so runs launched from the ideation board keep a durable link back to their originating card and board context.
- Completed or failed Project Runs can now feed learned output back into the originating ideation thread or spin up a new ideation thread directly from the Run Center.

## [0.46.8] - 2026-04-10

### Changed
- Project Ideation now scaffolds likely board facets directly from the prompt before the model responds, including external references, current-system context, code considerations, workflow impact, and team or process implications when those dimensions are implied.
- Project Ideation facilitation passes can now suggest explicit card updates, relationship rewiring, and stale-card archiving so repeated prompts evolve the active board instead of only appending new cards.
- Project Ideation's composer now shows a live prompt-inference preview so operators can see which datapoints Atlas is likely to inject or reorganize before running the next loop.

## [0.46.7] - 2026-04-10

### Fixed
- Project Run Center runs now create and reopen dedicated chat sessions, mirror the live run log as an internal-monologue transcript, persist the final synthesized output directly on the run record, and carry that synthesis into staged follow-up planner jobs when continuation mode is enabled.
- Project Run Center UX now surfaces autonomous-mode controls as durable run options, adds searchable compact recent-run rows, emphasizes the final run output ahead of changed files and artifacts, and moves the large draft-planning surfaces into collapsible review panels with a more active execution state.

## [0.46.6] - 2026-04-09

### Fixed
- Freeform chat now recognizes requests for the currently connected LLM providers and models as a live runtime inventory query and answers from AtlasMind's routed provider/model state instead of falling back to a generic architecture review.
- Security analysis routing now uses the built-in `security-reviewer` agent for freeform security gap analysis, threat-model, and runtime-boundary work, with stronger evidence guidance that treats code, config, and tests as authoritative over incomplete documentation.

## [0.46.5] - 2026-04-09

### Fixed
- Model Providers: The local provider "Configure" action no longer refreshes the entire provider panel after it opens Settings. That refresh was unnecessary for the local flow and could push the panel-flow test past the CI timeout.

## 
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-10T01:19:09.002Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 3f992f00
body-fingerprint: 08e5adbb
-->
