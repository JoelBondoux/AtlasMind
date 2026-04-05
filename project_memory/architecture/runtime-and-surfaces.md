# Runtime & Surface Architecture

Tags: #import #architecture #runtime #surfaces

## Overview
AtlasMind runs as a VS Code extension with a shared runtime that is also reused by the compiled Node CLI. Both hosts use the same orchestration core so agent selection, routing, skills, and SSOT behavior stay aligned.

## Primary Surfaces
- `@atlas` chat participant for slash commands and natural-language requests.
- Embedded AtlasMind Chat view and Sessions view in the sidebar container.
- Dedicated chat panel for a detached session workspace.
- Project Run Center for `/project` review, execution, and post-run inspection.
- Settings, Model Providers, Specialist Integrations, Tool Webhooks, Voice, Vision, and Agent Manager panels.

## Core Runtime Services
- `Orchestrator`: selects agents, gathers memory, profiles tasks, routes models, executes tools, and records cost.
- `ModelRouter`: scores enabled models using budget, speed, capability, provider health, and task-fit.
- `MemoryManager`: indexes `project_memory/`, performs hybrid lexical plus hashed-vector retrieval, and enforces scanning and path safety.
- `SkillsRegistry` and `AgentRegistry`: manage the active automation surface.
- `ProjectRunHistory`, `SessionConversation`, `CheckpointManager`, and `ToolApprovalManager`: persist operator state and safety boundaries.

## Host Strategy
- Extension host: full UI, SecretStorage, Copilot access, webviews, diagnostics, and interactive approvals.
- CLI host: same orchestration core with host-specific adapters for memory, cost tracking, and skill execution.

## Operational Consequence
When changing orchestration, memory, routing, or built-in skills, assume the effect reaches both hosts unless the code is explicitly extension-only.