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

## Cost Management

1. ✅ Cost management dashboard panel (`atlasmind.openCostDashboard`) with daily bar chart, model breakdown, and budget utilisation (v0.38.0).
2. Add an interface icon to the chat response bubbles which has a cost for the message and cost for the session listed in the tooltip.
