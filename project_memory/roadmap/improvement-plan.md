# Developer Roadmap

This file is the developer-facing backlog AtlasMind should absorb into SSOT and consult when deciding what to tackle next.

> Priority order matters: items nearer the top receive more weight, but AtlasMind should still weigh criticality, security, architecture, delivery risk, and fresh execution evidence before choosing the next task.

## Project Context
- Project: ---
- Project type: Unspecified
- Target audience: Unspecified
- Timeline: Unspecified
- Tech stack: Unspecified

## Prioritized Backlog
<!-- atlasmind:roadmap-items:start -->
## Chat & Orchestrator Refactor (Critical)
- [ ] Universal prompt decomposition: All chat prompts (not just /project) are analyzed and, if multi-action, decomposed into subtasks for sequential/parallel execution. Planner is invoked automatically when needed.
- [ ] Robust error recovery and feedback: All chat modes (including freeform) attempt auto-recovery on errors, retry with simplified prompts, and always surface actionable feedback bubbles. Autopilot auto-resolves non-critical stops.
- [ ] Refactor orchestrator and chat participant to support stepwise execution, progress streaming, and partial recovery for multi-step prompts.
- [ ] Update documentation and user guidance to reflect new chat and planning behaviors.

- [ ] Architectural integrity and changes that unlock safer future work.
- [ ] User-facing outcomes, milestones, and backlog order in this file.
- [ ] Delivery hygiene such as tests, CI, release notes, and documentation.
- [ ] Architectural integrity and changes that unlock safer future work.
- [ ] User-facing outcomes, milestones, and backlog order in this file.
- [ ] Delivery hygiene such as tests, CI, release notes, and documentation.
<!-- atlasmind:roadmap-items:end -->

## Prioritisation Notes
Atlas should weigh the roadmap in this order:
1. Critical, security, reliability, or production-blocking work.
2. Architectural integrity and changes that unlock safer future work.
3. User-facing outcomes, milestones, and backlog order in this file.
4. Delivery hygiene such as tests, CI, release notes, and documentation.

<!-- atlasmind-import
entry-path: roadmap/improvement-plan.md
generator-version: 2
generated-at: 2026-04-20T11:29:55.094Z
source-paths: README.md | package.json
source-fingerprint: 30e1571c
body-fingerprint: ffbb3f5c
-->
