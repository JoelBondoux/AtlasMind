# Development Guardrails

Tags: #import #decisions #governance #guardrails

## Status
Accepted

## Context
AtlasMind is trying to automate progressively more of the software workflow while still behaving safely inside an editor and across multiple hosts.

## Decision
- Treat documentation maintenance as part of implementation, not follow-up work.
- Keep shared interfaces centralized and avoid type duplication.
- Keep webview behavior nonce-protected and validated.
- Keep secrets out of settings and project memory.
- Prefer non-destructive filesystem behavior and explicit approval for risky execution.
- Keep extension-host and CLI orchestration behavior aligned through the shared runtime.

## Consequences
- Changes often require code, docs, wiki, changelog, and version updates together.
- Memory quality has to be actively maintained or Atlas will make worse decisions over time.
- Safety constraints intentionally slow down some operations, but that tradeoff is part of the product identity.