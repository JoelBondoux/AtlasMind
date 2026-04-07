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

1. Add multimodal evidence extraction so dropped screenshots, transcripts, recordings, and short videos can be converted into tagged evidence or user-insight cards instead of staying as passive attachments.
2. Add validation automation that can generate experiment briefs, smoke-test templates, landing-page tests, concierge tests, and prototype scripts directly from selected idea or risk cards.
3. Add SSOT sync actions for ideation `syncTargets` so promoted cards can be written into `domain/`, `operations/`, `agents/`, or future knowledge-graph artifacts instead of remaining board-local only.
4. Add cross-project pattern retrieval so AtlasMind can surface prior experiments, recurring risks, and reusable idea fragments from other project-memory stores when shaping a new board.

### Later Phase

1. Add analytics and meta-thinking overlays such as bias checks, evidence heatmaps, confidence-versus-risk views, novelty scoring, and stale-card detection across long-lived boards.
2. Add scheduled ideation revisits and autonomous follow-up loops so AtlasMind can revisit unresolved cards, rerun context packets after project changes, and suggest board pruning or revalidation.
3. Add collaboration support including facilitator modes, presence, role-based views, and safer shared-board workflows once the single-user interaction model is stable.
4. Add richer downstream orchestration hooks so experiments, requirements, or risks can spawn structured `/project` plans, validation checklists, and review checkpoints with less manual prompt shaping.
