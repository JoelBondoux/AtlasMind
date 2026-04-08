# Improvement Plan for Developer Experience

Tags: #developer-experience #build #lint #test

## Completed

- ✅ Added `--dry-run` flag to the CLI `build` subcommand (v0.37.0).
- ✅ Implemented `--fix` flag for the CLI `lint` subcommand (v0.37.0).
- ✅ Added `--watch` flag to the CLI `test` subcommand (v0.37.0).

## VS Code Observability Roadmap Additions

### Completed

1. ✅ Added explicit workspace observability (`workspace-state` skill, v0.37.0) — proactively inspects Problems, debug sessions, and output channels.
2. ✅ Added dedicated debug-session integration (`debug-session` skill, v0.37.0) — inspect active sessions, evaluate expressions in debug context.
3. ✅ Added safe readers for output channels and debug sessions via `getOutputChannelNames()`, `getAtlasMindOutputLog()`, `getDebugSessions()`, `evaluateDebugExpression()` on `SkillExecutionContext`.
4. ✅ Added safe readers for terminal sessions via `getTerminalOutput()` and `terminal-read` skill (v0.38.0).
5. ✅ Added test result file parsing (JUnit XML, Vitest/Jest JSON, coverage-summary) to `workspace-state` skill (v0.38.0).
6. ✅ Added VS Code extensions and Ports interaction via `vscode-extensions` skill and `getInstalledExtensions()` / `getPortForwards()` on `SkillExecutionContext` (v0.38.0).

### Next Steps

- Extend the observability and action model to cover extension-owned interface windows and panes, including Output channels, integrated terminals, extension webviews, test explorers, source-control panes, and other developer workflow surfaces that are already visible inside VS Code.
- Define safety and approval boundaries for extension interaction so AtlasMind can read passive state broadly, but requires explicit approval before invoking extension commands, mutating extension settings, or performing actions through sensitive workflow surfaces.

## Cost Management

1. ✅ Cost management dashboard panel (`atlasmind.openCostDashboard`) with daily bar chart, model breakdown, and budget utilisation (v0.38.0).
2. Add an interface icon to the chat response bubbles which has a cost for the message and cost for the session listed in the tooltip.

## Project Ideation Roadmap Additions

### Foundation Landed

1. ✅ Added deterministic ideation context packets that bundle prompt, queued media, constraints, selected-card lineage, and SSOT-derived project context before each Atlas facilitation pass.
2. ✅ Added auditable ideation run history with delta summaries, genealogy, typed card modes, semantic link relations, scoring, evidence tagging, board lenses, and promotion of a selected card into a drafted `/project` prompt.

### Next Phase

1. ✅ Added multimodal evidence extraction: `extractEvidenceFromCard` uses Atlas with vision capability to analyze images and text files attached to a card and generate structured `evidence`, `user-insight`, or `requirement` cards linked to the source.
2. ✅ Added validation automation: `generateValidationBrief` creates a structured brief (hypothesis, success/failure signals, test approach, timeline, key risks) streamed to the board and saved to `project_memory/experiments/{slug}.md`.
3. ✅ Added SSOT sync actions: `syncCardToSsot` uses Atlas to synthesize memory content and appends it to the appropriate file per sync target (`domain`, `operations`, `agents`, `knowledge-graph`). Sync targets panel now shows a "Sync to Memory" button when targets are checked.
4. ✅ Added cross-project pattern retrieval: `atlasmind.ideation.crossProjectPaths` config lets you point AtlasMind at sibling project memory stores; their `project_soul.md` and ideation board summaries are folded into every context packet.

### Later Phase

1. ✅ Added analytics and meta-thinking overlays: board analytics panel with type distribution, bias checks (optimism, single-perspective, missing card types), stale experiment/risk detection (14-day threshold), confidence-versus-risk ranking, and a Deep Analysis command that runs an Atlas meta-thinking pass over the full board.
2. ✅ Added scheduled revisit infrastructure: stale card IDs surfaced in every snapshot, archive/unarchive card actions, and an archived board lens so resolved or rejected cards are preserved but hidden from normal views.
3. Collaboration support (facilitator modes, presence, role-based views) deferred — requires multi-user infrastructure not yet in place.
4. ✅ Added richer downstream orchestration hooks: review checkpoint generation writes structured `project_memory/checkpoints/{slug}-checkpoint.md` files (current status, decision gate, outstanding questions, next actions, risk assessment); validation briefs write `project_memory/experiments/{slug}.md`; SSOT sync writes cards to `domain/`, `operations/`, `agents/`, or `knowledge-graph/` files.
