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

### Next Steps

- Add safe readers for terminal sessions so AtlasMind can reason over recent terminal output.
- Add test result file parsing to workspace observability.

## Cost Management

1. Create a cost management dashboard with charts to identify costly workflows and models.
2. Add an interface icon to the chat response bubbles which has a cost for the message and cost for the session listed in the tooltip.
