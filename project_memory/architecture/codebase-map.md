# Codebase Map

Tags: #import #architecture #codebase #structure

## Top-Level Focus Areas
- `src/core`: orchestration, planning, routing, checkpoints, tool approvals, profiling, and run history.
- `src/chat`, `src/views`, `src/voice`: user interaction surfaces and operator workflows.
- `src/providers`, `src/mcp`, `src/skills`: the extensible execution and provider layer.
- `src/memory`, `src/bootstrap`, `src/runtime`, `src/cli`: SSOT lifecycle, import/bootstrap, shared runtime, and CLI host.
- `tests`: focused verification across bootstrap, runtime, providers, memory, UI/webviews, and integration behavior.
- `docs` and `wiki`: product and architecture guidance.

## High-Value Files
- `src/extension.ts`: extension activation and service wiring.
- `src/core/orchestrator.ts`: main execution path.
- `src/bootstrap/bootstrapper.ts`: bootstrap and import behavior.
- `src/memory/memoryManager.ts`: SSOT indexing, querying, and persistence.
- `src/runtime/core.ts`: host-neutral runtime builder.
- `src/cli/main.ts`: CLI entrypoint.

## Guidance
When making architectural changes, update the SSOT-relevant docs and memory artifacts at the same time so Atlas does not reason from an obsolete map.