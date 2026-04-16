# Project Soul

> This file is the living identity of the project.

## Project Type
VS Code Extension

## Vision
Build a developer-centric multi-agent orchestrator that lives inside VS Code, routes work across models and agents, preserves long-term project memory as an SSOT, and keeps autonomous execution reviewable, safe, and operationally useful.

## Principles
- Default to the safest reasonable behavior, not the most permissive one.
- Treat memory quality as a product capability: stale or thin SSOT degrades planning, routing, and automation.
- Keep the extension and CLI on one shared runtime so behavior stays consistent across hosts.
- Prefer structured, reviewable automation with explicit approvals, checkpoints, and post-write verification.
- Treat documentation, release hygiene, and security boundaries as correctness work.

## Key Decisions
- `project_memory/` is the long-term SSOT and should contain actionable project knowledge, not just placeholders.
- Provider credentials belong in SecretStorage or environment variables, never in SSOT files.
- `develop` is the routine integration branch; `master` is the protected release-ready branch.
- AtlasMind should reuse a shared orchestration runtime across the extension host and CLI.
- Safety regressions and approval-boundary regressions are correctness bugs.

## References
- architecture/runtime-and-surfaces.md [Updated with runtime details]
- project_memory/architecture/model-routing.md
- architecture/agents-and-skills.md
- operations/development-workflow.md
- operations/security-and-safety.md
- decisions/development-guardrails.md
