# Project Soul

> This file is the living identity of the project.

## Project Type
Unknown

## Vision
AtlasMind is built for indie developers, freelancers, and small teams who want to get more done without context switching or tool overload. It’s not just a chatbot — it’s a multi-agent orchestrator that routes your tasks to the right AI, remembers your decisions, and helps you focus on what matters most.

## Principles
- AtlasMind defaults to the safest reasonable behavior, not the most permissive one.
- Treat every boundary as untrusted: chat input, webview messages, workspace files, model output, and tool parameters.
- Validate before executing, redact before sending, confirm before destructive changes, and deny by default when behavior is ambiguous.
- Security-sensitive regressions are treated as correctness bugs, not polish items.

## Key Decisions
- Safety and security regressions are correctness bugs, not polish work.
- Long-term project context belongs in the SSOT under `project_memory/`.
- Provider credentials live in SecretStorage, not in project memory or source.
- `develop` is the routine integration branch and `master` is the protected release-ready branch.
- See `decisions/development-guardrails.md`, `operations/security-and-safety.md`, and `architecture/runtime-and-surfaces.md` for supporting detail.

## Imported References
- architecture/project-overview.md
- architecture/runtime-and-surfaces.md
- architecture/model-routing.md
- architecture/agents-and-skills.md
- operations/development-workflow.md
- decisions/development-guardrails.md
- roadmap/improvement-plan.md