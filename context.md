## Goal
Turn The User's Project Dashboard recommendation into a managed operating metric: link roadmap completion, shipped capabilities, and run telemetry, starting with the smallest useful improvement that can be shipped quickly.

## Approach
Collect a durable “turn completion completeness” signal from existing sources already present in the project memory and run record paths, then map it to a dashboard metric with minimal schema changes. Define the current metric as “roadmap completion rate with telemetry-represented delivery confirmation,” and record the next step needed to make it operationally enforceable over time.

## Findings
- The User's objective and product context were established: VS Code Extension for novice/small-team software engineers, with no fixed timeline, using VS Code tech stack.
- Roadmap visibility currently shows 28/582 completed items, 550 outstanding items, and 4 unresolved recommendation follow-up questions.
- The `project_memory/roadmap/acp-integration.md` roadmap includes extensive unresolved ACP integration items (including provider adapter work, streaming, delegated execution boundaries, telemetry/routing constraints, and real-ACP validation), indicating the largest remaining backlog is in that area.
- A recent run stopped at the end of failure handling after 4 model attempts (failover budget exhausted). The underlying provider error was:
  `Invalid_request_error 400` from local provider: `Conversation roles must alternate user/assistant/user/assistant` from template/Jinja validation while parsing the generated prompt.
- No additional recovery model was invoked after the local provider failure, leaving provider-switching uncompleted.
- The User explicitly asked for next-step summary: “address this recommendation: turn completion into a managed operating metric” and wants a practical, smallest-first implementation.

## Concluded
- Dashboard baseline was captured from the latest state: completion counts and backlog were confirmed from the prior turn data.
- The User's project profile inputs were confirmed and recorded as: VS Code Extension, novice/solo/small team audience, and VS Code stack.
- The latest blocking condition was captured concretely: local provider prompt-shape failure, plus exhausted local/provider fallback budget before recovery.
- ~~Project basics were accepted and persisted for follow-up planning.~~
- ~~Local-provider failure root cause (conversation role alternation/Jinja parse failure) was identified and confirmed as the immediate remediation target.~~

## Open Threads
- Decide the exact schema for “turn completion” (count-based metric, weighted metric, or both) and whether it is persisted in roadmap, memory, or telemetry-only stores.
- Clarify whether “shipped capabilities” should count only merged/compiled features or also validated staged run outcomes.
- Decide if the next metric improvement should be hard-pinned to one roadmap area (ACP-first) or computed globally across all roadmap lines.
- Specify owner/guardrails for the next durable step (which component owns metric updates and where threshold alerts are enforced).
- Decide whether dashboard completeness should also include a “risk-adjusted completion” dimension for blocked or unassessed items.

## SSOT Links
AGENTS.md
project_memory/roadmap/acp-integration.md
project_memory/roadmap/acp-readiness-notes.md
project_memory/roadmap/README.md
docs/model-routing.md
wiki/Architecture.md

## Current State
The latest turn did not implement code changes; it consolidated the session objective, constraints, and immediate technical state into the rolling context. The unresolved next action is to implement the minimum metric bridge between roadmap completion and run telemetry, then harden it into a durable operational measure with alerting and reconciliation.
