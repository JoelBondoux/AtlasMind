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
- Add a curated interoperability layer for the 50 most commonly used developer-focused VS Code extensions so AtlasMind can discover each extension's commands, panels, tree views, and task-oriented surfaces without depending on one-off integrations.
- Extend the observability and action model to cover extension-owned interface windows and panes, including Output channels, integrated terminals, extension webviews, test explorers, source-control panes, and other developer workflow surfaces that are already visible inside VS Code.
- Add first-class Ports view support so AtlasMind can inspect forwarded ports, reason about local service availability, and help users open, label, manage, and troubleshoot port-forwarded development sessions from within VS Code.
- Define safety and approval boundaries for extension interaction so AtlasMind can read passive state broadly, but requires explicit approval before invoking extension commands, mutating extension settings, or performing actions through sensitive workflow surfaces.

## Cost Management

1. Create a cost management dashboard with charts to identify costly workflows and models.
2. Add an interface icon to the chat response bubbles which has a cost for the message and cost for the session listed in the tooltip.
