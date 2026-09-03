# Developer Roadmap
This file is the developer-facing backlog AtlasMind should absorb into SSOT and consult when deciding what to tackle next.
> Priority order matters: items nearer the top receive more weight, but AtlasMind should still weigh criticality, security, architecture, delivery risk, and fresh execution evidence before choosing the next task.
## Prioritized Backlog
<!-- atlasmind:roadmap-items:start -->
- [x] Pay down: Property-Based is enabled with no evidence it runs <!-- rm:pay-down-property-based-is-e -->
- [x] Pay down: performance is enabled with no evidence it runs <!-- rm:pay-down-performance-is-enab -->
- [x] Pay down: mutation Testing is enabled with no evidence it runs <!-- rm:pay-down-mutation-testing-is -->
- [x] Pay down: Model-Based (MBT) is enabled with no evidence it runs <!-- rm:pay-down-model-based-mbt-is -->
- [x] Pay down: End-to-End is enabled with no evidence it runs <!-- rm:pay-down-end-to-end-is-enabl -->
- [x] Pay down: contract is enabled with no evidence it runs <!-- rm:pay-down-contract-is-enabled -->
- [x] Pay down: BDD is enabled with no evidence it runs <!-- rm:pay-down-bdd-is-enabled-with -->
- [x] Pay down: ATDD is enabled with no evidence it runs <!-- rm:pay-down-atdd-is-enabled-wit -->
- [x] Document all GDPR-related controls and override policies in user-facing and developer documentation. <!-- rm:document-all-gdpr-related-co -->
- [x] **E‑Commerce:** Shopify, WooCommerce, BigCommerce, Magento 2, Wix <!-- rm:e-commerce-shopify-woocommer -->
- [x] **SaaS/Web Apps:** Next.js, Remix, Laravel, Django, Static, Blog/CMS <!-- rm:saas-web-apps-next-js-remix -->
- [x] **Frontend:** Next.js, SvelteKit, Nuxt, React, Vue <!-- rm:frontend-next-js-sveltekit-n -->
- [x] **Mobile:** React Native, Expo, Flutter <!-- rm:mobile-react-native-expo-flu -->
- [ ] **Game Dev (Phase 1 foundation delivered; scoped consumers next):** Unity, Unreal, Godot, Web-based — specified in [project-composition.md](project-composition.md); phased plan in [`project_memory/roadmap/game-engine-integration.md`](../project_memory/roadmap/game-engine-integration.md). <!-- rm:game-dev-unity-unreal-godot -->
- [ ] **AI/Automation:** AI SaaS, RAG, Agentic, Local Model, Orchestrator <!-- rm:ai-automation-ai-saas-rag-ag -->
- [ ] **DevOps:** Docker, Kubernetes, Serverless, Terraform <!-- rm:devops-docker-kubernetes-ser -->
- [ ] **Testing:** Full, Playwright, API <!-- rm:testing-full-playwright-api -->
- [ ] **Business Models:** Marketplace, Subscription, Booking, CRM <!-- rm:business-models-marketplace -->
- [ ] **Utilities:** Auth, Payments, Email, Analytics, i18n, Accessibility <!-- rm:utilities-auth-payments-emai -->
- [ ] **Semantic codebase index (`@codebase` / embeddings RAG):** Vector index over actual source so agents retrieve relevant code, not just remembered SSOT decisions. Local embedding option (Ollama) keeps it bring-your-own-model and privacy-friendly. Biggest single capability gap; benefits all personas. <!-- rm:semantic-codebase-index-code -->
- [ ] **Multi-file diff review gate + inline edit:** A review surface showing all proposed edits with per-hunk accept/reject *before* anything touches disk, plus an "AI edit at cursor" / inline-diff command. Complements the existing checkpoint/rollback safety net (the after-the-fact gate). <!-- rm:multi-file-diff-review-gate -->
- [ ] **Team layer — shared config + per-developer cost attribution:** Team-level (vs personal) settings, shared agents/skills/routines, "who spent what" attribution, and a pooled team budget cap. Strengthens the currently thinner small-teams story. <!-- rm:team-layer-shared-config-per -->
- [ ] Inline / ghost-text completion in the editor (or at minimum an "AI edit at cursor" inline-diff command) — the most obvious gap vs Copilot/Cursor. <!-- rm:inline-ghost-text-completion -->
- [ ] Scheduled / background autonomous agents — cron-style and background runs that report back (e.g. nightly dependency-update + test routine), building on existing `/ship` routines. <!-- rm:scheduled-background-autonom -->
- [ ] **The guided GitHub workflow** — one canonical, deterministic, eight-stage workflow (issue intake → branch → develop → PR → CI → release → maintenance → automation), surfaced as a teaching-and-instrumentation page on the Project Dashboard and adapting to the project's enabled testing protocols.… <!-- rm:the-guided-github-workflow-o -->
- [ ] Eval / regression harness for agents: pin "golden" tasks and detect when an agent definition or model swap regresses quality (mitigates the risk of the auto-update cadence). <!-- rm:eval-regression-harness-for -->
- [ ] Monorepo / multi-root workspace awareness: per-package SSOT scoping and routing. Specified in [project-composition.md](project-composition.md) — AtlasMind is single-root by construction today (123 of 130 `workspaceFolders` reads take `[0]`), and Phase 1 of the [game engine… <!-- rm:monorepo-multi-root-workspac -->
- [ ] Context window / token budget visualizer: show what's in context and let users prune it. <!-- rm:context-window-token-budget -->
- [ ] SAST / dependency-CVE integration wired into the Security and Dependency Manager agents via an advisory feed. <!-- rm:sast-dependency-cve-integrat -->
- [ ] Shared, syncable team config: agents, skills, routines, and personality shared via the repo, plus a team settings layer separate from personal settings. <!-- rm:shared-syncable-team-config -->
- [ ] Per-developer cost attribution and pooled team budget (see Top 3). <!-- rm:per-developer-cost-attributi -->
- [ ] Community/team marketplace for agents & skills: import/export and sharing; drives adoption network effects. <!-- rm:community-team-marketplace-f -->
- [ ] Decision/changelog provenance: link SSOT decisions to commits/PRs so the project brain is auditable across teammates. <!-- rm:decision-changelog-provenanc -->
- [ ] "Explain this codebase / this file" onboarding mode: guided tours generated from SSOT for unfamiliar code. <!-- rm:explain-this-codebase-this-f -->
- [ ] Safe-by-default sandbox / dry-run mode: one-toggle "show me what would happen, nothing executes." <!-- rm:safe-by-default-sandbox-dry -->
- [ ] Guardrail nudges & learning callouts: plain-language "here's why" so novices learn rather than just accept. <!-- rm:guardrail-nudges-learning-ca -->
- [ ] Project templates / scaffolds beyond `/bootstrap`: pick a stack, get a working starter with tests and CI wired in (complements the Prefab Architecture Packs above). <!-- rm:project-templates-scaffolds -->
- [ ] **Reasoning-budget as a first-class routing axis** — extend budget + speed routing with a third "how hard to think" axis for extended-thinking / test-time-compute models. Natural home: TaskProfiler. Builds on the existing cache-aware, capability-sourced routing work. <!-- rm:reasoning-budget-as-a-first -->
- [ ] **Prompt-injection & tool-poisoning defense** — highest-priority frontier item given AtlasMind combines untrusted inputs (web-fetch, MCP servers, file content, model output) with autonomous tool use. Patterns: dual-LLM/quarantine so untrusted content never reaches the privileged planner directly,… <!-- rm:prompt-injection-tool-poison -->
- [ ] **LLM observability (OpenTelemetry GenAI semantic conventions)** — emit standardized traces/spans for agent runs, token usage, and tool calls so dashboards plug into the ecosystem instead of a bespoke format. <!-- rm:llm-observability-openteleme -->
- [ ] **Sandboxed execution for autonomous runs** — microVM/container/WASM isolation for terminal-write and code-run so approvals can safely loosen as autonomy grows. Pairs with git-worktree-per-agent isolation for parallel fan-out. <!-- rm:sandboxed-execution-for-auto -->
- [ ] **Open Knowledge Format (OKF) interoperability** — Google Cloud's vendor-neutral markdown standard for curated agent knowledge (v0.1, 2026-06-16) is structurally what AtlasMind's SSOT already is. Rather than reformatting our own files to a two-day-old spec, add OKF **import/export** — including a… <!-- rm:open-knowledge-format-okf-in -->
- [ ] **Agent-to-agent interoperability (A2A and successors)** — the layer above MCP: AtlasMind agents collaborating with external agents across tools/vendors. Keep the agent definition + messaging boundary protocol-clean. <!-- rm:agent-to-agent-interoperabil -->
- [ ] **Async / ambient background agents** — "works while you're away," triggered by repo events (new issue, failing CI, dependency CVE) rather than chat. Architectural ask: an event bus agents subscribe to. Seeded by the remote-control server and scheduled-agents backlog item. <!-- rm:async-ambient-background-age -->
- [ ] **GraphRAG / code knowledge graph** — a graph over symbols, call edges, and SSOT decisions alongside the planned vector index, enabling "what breaks if I change X" reasoning. Design the index layer so a graph can sit beside embeddings later. <!-- rm:graphrag-code-knowledge-grap -->
- [ ] **Self-improving project model** — evolve curated-text SSOT toward a learned model of project conventions updated from accepted/rejected diffs. Capture the accept/reject training signal now (via checkpoint/run history) even before it is used. <!-- rm:self-improving-project-model -->
- [ ] **Computer-use / browser-use agents** — for E2E testing, scraping, and UI verification; slots next to the Vision panel. <!-- rm:computer-use-browser-use-age -->
- [ ] **On-device frontier-class models** — a fully private, zero-cloud agentic coding mode as local models climb. Keep the local path first-class, not a fallback (BYO + local-sync architecture already positions for this). <!-- rm:on-device-frontier-class-mod -->
- [ ] **Regulatory & AI-governance surface** — EU AI Act transparency, data residency, model provenance/cards, auditable autonomous-action logs. Generalize the planned GDPR toggle into a reusable "compliance profile" abstraction. <!-- rm:regulatory-ai-governance-sur -->
- [ ] **AI supply-chain integrity** — signed/attested artifacts (SLSA-style provenance) for the future agent/skill marketplace, which is otherwise a malware vector. Ties to the marketplace backlog item. <!-- rm:ai-supply-chain-integrity-si -->
- [ ] **Multimodal-native dev loops** — video/screen-recording understanding for bug repro and audio-first pairing, building on Voice + Vision. <!-- rm:multimodal-native-dev-loops -->
- [ ] **Prompt-injection defense** — the security-first positioning is hollow once MCP + autonomy + untrusted content combine. <!-- rm:prompt-injection-defense-the -->
- [ ] **Reasoning-budget routing** — extends multi-axis routing (an existing strength) and rides the biggest model-capability trend. <!-- rm:reasoning-budget-routing-ext -->
- [ ] **Sandboxed execution + worktree isolation** — the unlock that lets every other autonomy feature ship safely. <!-- rm:sandboxed-execution-worktree -->
- [ ] **Promote worktree isolation toward near-term.** AtlasMind already runs parallel subtask batches (`taskScheduler.ts`, `Promise.all`, cap 5) but on a **single shared working tree** — a latent write-race that is a correctness bug under the safety-first rule. Worktree-per-batch isolation… <!-- rm:promote-worktree-isolation-t -->
- [ ] **PR-native GitHub automation.** Now tracked as Tier 2–3 of [the guided GitHub workflow](../project_memory/roadmap/guided-github-workflow.md) rather than as a separate bet — real `gh`-backed PR creation, CI-check review, and conflict triage, beyond today's git primitives. <!-- rm:pr-native-github-automation -->
- [ ] **Parallel "command center" UX (net-new framing).** A multi-lane view of N concurrent runs/worktrees with per-lane status and diff/approve, making parallel fan-out legible — complements the single-run Mission Control / Project Run Center. <!-- rm:parallel-command-center-ux-n -->
- [ ] **Not pursuing:** becoming a generic BYO-CLI-agent multiplexer — that is SUPACODE's category and undercuts AtlasMind's integrated routing / memory / cost / privacy differentiators. <!-- rm:not-pursuing-becoming-a-gene -->
<!-- atlasmind:roadmap-items:end -->
## Prioritisation Notes
1. Critical, security, reliability, or production-blocking work.
2. Architectural integrity and changes that unlock safer future work.
3. User-facing outcomes and the manual order of this backlog.
4. Delivery hygiene such as tests, CI, release notes, and docs.


## Existing Notes
# Developer Roadmap
This file is the developer-facing backlog AtlasMind should absorb into SSOT and consult when deciding what to tackle next.
> Priority order matters: items nearer the top receive more weight, but AtlasMind should still weigh criticality, security, architecture, delivery risk, and fresh execution evidence before choosing the next task.
## Prioritized Backlog
<!-- removed by AtlasMind memory self-heal --> <!-- removed by AtlasMind memory self-heal -->
- [ ] Document all GDPR-related controls and override policies in user-facing and developer documentation. <!-- removed by AtlasMind memory self-heal -->
- [ ] Document all GDPR-related controls and override policies in user-facing and developer documentation. <!-- rm:document-all-gdpr-related-co -->
- [ ] **E‑Commerce:** Shopify, WooCommerce, BigCommerce, Magento 2, Wix <!-- rm:e-commerce-shopify-woocommer -->
- [ ] **SaaS/Web Apps:** Next.js, Remix, Laravel, Django, Static, Blog/CMS <!-- rm:saas-web-apps-next-js-remix -->
- [ ] **Frontend:** Next.js, SvelteKit, Nuxt, React, Vue <!-- rm:frontend-next-js-sveltekit-n -->
- [ ] **Mobile:** React Native, Expo, Flutter <!-- rm:mobile-react-native-expo-flu -->
- [ ] **Game Dev (Phase 1 foundation delivered; scoped consumers next):** Unity, Unreal, Godot, Web-based — specified in [project-composition.md](project-composition.md); phased plan in [`project_memory/roadmap/game-engine-integration.md`](../project_memory/roadmap/game-engine-integration.md). <!-- rm:game-dev-unity-unreal-godot -->
- [ ] **AI/Automation:** AI SaaS, RAG, Agentic, Local Model, Orchestrator <!-- rm:ai-automation-ai-saas-rag-ag -->
- [ ] **DevOps:** Docker, Kubernetes, Serverless, Terraform <!-- rm:devops-docker-kubernetes-ser -->
- [ ] **Testing:** Full, Playwright, API <!-- rm:testing-full-playwright-api -->
- [ ] **Business Models:** Marketplace, Subscription, Booking, CRM <!-- rm:business-models-marketplace -->
- [ ] **Utilities:** Auth, Payments, Email, Analytics, i18n, Accessibility <!-- rm:utilities-auth-payments-emai -->
- [ ] **Semantic codebase index (`@codebase` / embeddings RAG):** Vector index over actual source so agents retrieve relevant code, not just remembered SSOT decisions. Local embedding option (Ollama) keeps it bring-your-own-model and privacy-friendly. Biggest single capability gap; benefits all personas. <!-- rm:semantic-codebase-index-code -->
- [ ] **Multi-file diff review gate + inline edit:** A review surface showing all proposed edits with per-hunk accept/reject *before* anything touches disk, plus an "AI edit at cursor" / inline-diff command. Complements the existing checkpoint/rollback safety net (the after-the-fact gate). <!-- rm:multi-file-diff-review-gate -->
- [ ] **Team layer — shared config + per-developer cost attribution:** Team-level (vs personal) settings, shared agents/skills/routines, "who spent what" attribution, and a pooled team budget cap. Strengthens the currently thinner small-teams story. <!-- rm:team-layer-shared-config-per -->
- [ ] Inline / ghost-text completion in the editor (or at minimum an "AI edit at cursor" inline-diff command) — the most obvious gap vs Copilot/Cursor. <!-- rm:inline-ghost-text-completion -->
- [ ] Scheduled / background autonomous agents — cron-style and background runs that report back (e.g. nightly dependency-update + test routine), building on existing `/ship` routines. <!-- rm:scheduled-background-autonom -->
- [ ] **The guided GitHub workflow** — one canonical, deterministic, eight-stage workflow (issue intake → branch → develop → PR → CI → release → maintenance → automation), surfaced as a teaching-and-instrumentation page on the Project Dashboard and adapting to the project's enabled testing protocols.… <!-- rm:the-guided-github-workflow-o -->
- [ ] Eval / regression harness for agents: pin "golden" tasks and detect when an agent definition or model swap regresses quality (mitigates the risk of the auto-update cadence). <!-- rm:eval-regression-harness-for -->
- [ ] Monorepo / multi-root workspace awareness: per-package SSOT scoping and routing. Specified in [project-composition.md](project-composition.md) — AtlasMind is single-root by construction today (123 of 130 `workspaceFolders` reads take `[0]`), and Phase 1 of the [game engine… <!-- rm:monorepo-multi-root-workspac -->
- [ ] Context window / token budget visualizer: show what's in context and let users prune it. <!-- rm:context-window-token-budget -->
- [ ] SAST / dependency-CVE integration wired into the Security and Dependency Manager agents via an advisory feed. <!-- rm:sast-dependency-cve-integrat -->
- [ ] Shared, syncable team config: agents, skills, routines, and personality shared via the repo, plus a team settings layer separate from personal settings. <!-- rm:shared-syncable-team-config -->
- [ ] Per-developer cost attribution and pooled team budget (see Top 3). <!-- rm:per-developer-cost-attributi -->
- [ ] Community/team marketplace for agents & skills: import/export and sharing; drives adoption network effects. <!-- rm:community-team-marketplace-f -->
- [ ] Decision/changelog provenance: link SSOT decisions to commits/PRs so the project brain is auditable across teammates. <!-- rm:decision-changelog-provenanc -->
- [ ] "Explain this codebase / this file" onboarding mode: guided tours generated from SSOT for unfamiliar code. <!-- rm:explain-this-codebase-this-f -->
- [ ] Safe-by-default sandbox / dry-run mode: one-toggle "show me what would happen, nothing executes." <!-- rm:safe-by-default-sandbox-dry -->
- [ ] Guardrail nudges & learning callouts: plain-language "here's why" so novices learn rather than just accept. <!-- rm:guardrail-nudges-learning-ca -->
- [ ] Project templates / scaffolds beyond `/bootstrap`: pick a stack, get a working starter with tests and CI wired in (complements the Prefab Architecture Packs above). <!-- rm:project-templates-scaffolds -->
- [ ] **Reasoning-budget as a first-class routing axis** — extend budget + speed routing with a third "how hard to think" axis for extended-thinking / test-time-compute models. Natural home: TaskProfiler. Builds on the existing cache-aware, capability-sourced routing work. <!-- rm:reasoning-budget-as-a-first -->
- [ ] **Prompt-injection & tool-poisoning defense** — highest-priority frontier item given AtlasMind combines untrusted inputs (web-fetch, MCP servers, file content, model output) with autonomous tool use. Patterns: dual-LLM/quarantine so untrusted content never reaches the privileged planner directly,… <!-- rm:prompt-injection-tool-poison -->
- [ ] **LLM observability (OpenTelemetry GenAI semantic conventions)** — emit standardized traces/spans for agent runs, token usage, and tool calls so dashboards plug into the ecosystem instead of a bespoke format. <!-- rm:llm-observability-openteleme -->
- [ ] **Sandboxed execution for autonomous runs** — microVM/container/WASM isolation for terminal-write and code-run so approvals can safely loosen as autonomy grows. Pairs with git-worktree-per-agent isolation for parallel fan-out. <!-- rm:sandboxed-execution-for-auto -->
- [ ] **Open Knowledge Format (OKF) interoperability** — Google Cloud's vendor-neutral markdown standard for curated agent knowledge (v0.1, 2026-06-16) is structurally what AtlasMind's SSOT already is. Rather than reformatting our own files to a two-day-old spec, add OKF **import/export** — including a… <!-- rm:open-knowledge-format-okf-in -->
- [ ] **Agent-to-agent interoperability (A2A and successors)** — the layer above MCP: AtlasMind agents collaborating with external agents across tools/vendors. Keep the agent definition + messaging boundary protocol-clean. <!-- rm:agent-to-agent-interoperabil -->
- [ ] **Async / ambient background agents** — "works while you're away," triggered by repo events (new issue, failing CI, dependency CVE) rather than chat. Architectural ask: an event bus agents subscribe to. Seeded by the remote-control server and scheduled-agents backlog item. <!-- rm:async-ambient-background-age -->
- [ ] **GraphRAG / code knowledge graph** — a graph over symbols, call edges, and SSOT decisions alongside the planned vector index, enabling "what breaks if I change X" reasoning. Design the index layer so a graph can sit beside embeddings later. <!-- rm:graphrag-code-knowledge-grap -->
- [ ] **Self-improving project model** — evolve curated-text SSOT toward a learned model of project conventions updated from accepted/rejected diffs. Capture the accept/reject training signal now (via checkpoint/run history) even before it is used. <!-- rm:self-improving-project-model -->
- [ ] **Computer-use / browser-use agents** — for E2E testing, scraping, and UI verification; slots next to the Vision panel. <!-- rm:computer-use-browser-use-age -->
- [ ] **On-device frontier-class models** — a fully private, zero-cloud agentic coding mode as local models climb. Keep the local path first-class, not a fallback (BYO + local-sync architecture already positions for this). <!-- rm:on-device-frontier-class-mod -->
- [ ] **Regulatory & AI-governance surface** — EU AI Act transparency, data residency, model provenance/cards, auditable autonomous-action logs. Generalize the planned GDPR toggle into a reusable "compliance profile" abstraction. <!-- rm:regulatory-ai-governance-sur -->
- [ ] **AI supply-chain integrity** — signed/attested artifacts (SLSA-style provenance) for the future agent/skill marketplace, which is otherwise a malware vector. Ties to the marketplace backlog item. <!-- rm:ai-supply-chain-integrity-si -->
- [ ] **Multimodal-native dev loops** — video/screen-recording understanding for bug repro and audio-first pairing, building on Voice + Vision. <!-- rm:multimodal-native-dev-loops -->
- [ ] **Prompt-injection defense** — the security-first positioning is hollow once MCP + autonomy + untrusted content combine. <!-- rm:prompt-injection-defense-the -->
- [ ] **Reasoning-budget routing** — extends multi-axis routing (an existing strength) and rides the biggest model-capability trend. <!-- rm:reasoning-budget-routing-ext -->
- [ ] **Sandboxed execution + worktree isolation** — the unlock that lets every other autonomy feature ship safely. <!-- rm:sandboxed-execution-worktree -->
- [ ] **Promote worktree isolation toward near-term.** AtlasMind already runs parallel subtask batches (`taskScheduler.ts`, `Promise.all`, cap 5) but on a **single shared working tree** — a latent write-race that is a correctness bug under the safety-first rule. Worktree-per-batch isolation… <!-- rm:promote-worktree-isolation-t -->
- [ ] **PR-native GitHub automation.** Now tracked as Tier 2–3 of [the guided GitHub workflow](../project_memory/roadmap/guided-github-workflow.md) rather than as a separate bet — real `gh`-backed PR creation, CI-check review, and conflict triage, beyond today's git primitives. <!-- rm:pr-native-github-automation -->
- [ ] **Parallel "command center" UX (net-new framing).** A multi-lane view of N concurrent runs/worktrees with per-lane status and diff/approve, making parallel fan-out legible — complements the single-run Mission Control / Project Run Center. <!-- rm:parallel-command-center-ux-n -->
- [ ] **Not pursuing:** becoming a generic BYO-CLI-agent multiplexer — that is SUPACODE's category and undercuts AtlasMind's integrated routing / memory / cost / privacy differentiators. <!-- rm:not-pursuing-becoming-a-gene -->
<!-- atlasmind:roadmap-items:end -->

### Release gates
<!-- atlasmind:roadmap-gates:start -->
- `#mvp` — MVP
- `#critical` — Critical
<!-- atlasmind:roadmap-gates:end -->


## Prioritisation Notes
Atlas should weigh the roadmap in this order:
1. Critical, security, reliability, or production-blocking work.
2. Architectural integrity and changes that unlock safer future work.
3. User-facing outcomes, milestones, and backlog order in this file.
4. Delivery hygiene such as tests, CI, release notes, and documentation.

<!-- atlasmind-import
entry-path: roadmap/improvement-plan.md
generator-version: 2
generated-at: 2026-07-31T03:25:06.200Z
source-paths: README.md | package.json
source-fingerprint: e4812cac
body-fingerprint: ffbb3f5c
-->
