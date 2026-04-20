# Project Soul (Enhanced Vision)

Tags: #project-identity #vision #goals #success-metrics

# Project Soul

> This file is the living identity of the project.

## Project Type
Unknown

## Vision
AtlasMind is built for indie developers, freelancers, and small teams who want to get more done without context switching or tool overload. It's not just a chatbot — it's a multi-agent orchestrator that routes your tasks to the right AI, remembers your decisions, and helps you focus on what matters most.

### Desired End State
**A solo developer or small team should be able to:**
- Work entirely within VS Code without switching between external AI tools, documentation sites, or task managers
- Ask natural language questions about their codebase and get contextually-aware answers backed by live workspace analysis
- Delegate complex multi-step tasks (refactoring, testing, documentation) to specialized agents that understand their project's patterns and constraints
- Build up institutional knowledge in their project memory that persists across months and team members
- Trust that their code, credentials, and decisions remain secure throughout the AI-assisted workflow

**Success metrics:**
- Developers report spending 80%+ of their "thinking time" in VS Code rather than browser tabs
- Project memory becomes the authoritative source of architectural decisions and project context
- Security-sensitive operations require explicit approval with clear boundaries and audit trails
- The extension feels like a native part of VS Code, not a separate tool bolted on

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
