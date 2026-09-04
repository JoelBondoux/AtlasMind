# AtlasMind Human-Facing Roadmap

This roadmap provides a clear, user-friendly overview of upcoming features, improvements, and compliance initiatives for AtlasMind. It is updated in sync with the developer backlog and highlights priorities relevant to users, contributors, and stakeholders.

## Upcoming Features & Improvements

### AtlasMind Lens — Queryable Project Visualisations

AtlasMind Lens adds an evidence-backed visual layer to the VS Code sidebar and editor. Its first slice is a queryable active-file code outline: select a symbol, open its exact source, or attach it to a reviewable Atlas Chat draft. Later phases add execution journeys, schema and API contract wiring review, change impact, test/behaviour coverage, data trust, state lifecycles, effective configuration, and pull-request stories.

The schema review maps fields across forms, API contracts, validators/DTOs, domain models, ORM or query code, and databases. Connections are labelled exact, transformed, dropped, introduced, incompatible, unverified, or inferred; missing evidence is never automatically reported as broken. The full delivery sequence and acceptance boundaries are in [`project_memory/roadmap/atlasmind-lens.md`](../project_memory/roadmap/atlasmind-lens.md).

### Chat & Orchestrator Refactor (Critical)
- Universal prompt decomposition: All chat prompts (not just /project) are analyzed and, if multi-action, decomposed into subtasks for sequential/parallel execution. Planner is invoked automatically when needed.
- Robust error recovery and feedback: All chat modes (including freeform) attempt auto-recovery on errors, retry with simplified prompts, and always surface actionable feedback bubbles. Autopilot auto-resolves non-critical stops.
- Refactor orchestrator and chat participant to support stepwise execution, progress streaming, and partial recovery for multi-step prompts.
- Update documentation and user guidance to reflect new chat and planning behaviors.

### Data Privacy and GDPR controls (Documentation delivered)

AtlasMind's current technical controls, activation defaults, transfer boundary, retained activity
metadata, provider-governance references, and override limitations are documented in
[Data privacy and GDPR controls](data-privacy-and-gdpr.md) and the
[user guide](../wiki/Data-Privacy-and-GDPR.md). The documentation is explicit that AtlasMind does not
yet implement a reasoned, logged per-run GDPR override or provide compliance certification. The broader
compliance-profile abstraction remains a frontier item below.

### Prefab Architecture Packs (Summary)
AtlasMind will deliver fast-start, opinionated project templates for:
    - **E‑Commerce (delivered):** Shopify; WooCommerce Extension; BigCommerce Catalyst handoff;
      Magento 2 Module; and Wix Commerce handoff.
    - **SaaS/Web Apps (delivered):** Next.js; React Router framework mode (the maintained path for
      new Remix-style apps); Laravel; Django; Static Website; and Blog/CMS through Astro Content.
    - **Frontend (delivered):** Next.js; SvelteKit; Nuxt 4; React with Vite; and Vue.
    - **Mobile (delivered):** React Native; Expo; and Flutter.
    - **Game Dev (Phase 1 delivered; Phase 2 in progress):** Unity, Unreal, Godot, Web-based — schemas and fixtures are joined by the pure component model, derived topology, workflow persistence, component-scoped Git/CI/debt/issues/observed-delta evidence with explicit `not-visible` coverage, the Shopify theme + app + extension validation case, four non-governing game architecture seeds, generic read-only upstream-divergence evidence, file-evidence-only engine/version identity, explicit bounded asset/LFS inventory, a version-pinned engine-fork reading over the generic Git facts, and hostile-input build-log interpretation with conservative verdicts. The persisted game profile is next. Specified in [project-composition.md](project-composition.md), with the phased plan in [`project_memory/roadmap/game-engine-integration.md`](../project_memory/roadmap/game-engine-integration.md).
    - **AI/Automation:** AI SaaS, RAG, Agentic, Local Model, Orchestrator
    - **DevOps:** Docker, Kubernetes, Serverless, Terraform
    - **Testing:** Full, Playwright, API
    - **Business Models:** Marketplace, Subscription, Booking, CRM
    - **Utilities:** Auth, Payments, Email, Analytics, i18n, Accessibility

**First Release Focus:**
Shopify, Next.js SaaS, Static Website, Next.js App Router, React SPA, React Native, AI Orchestrator, Dockerised Full‑Stack, Full Testing, Auth, Payments.

The WooCommerce slice creates a plugin shell, compatibility and privacy review records, and syntax/
contract CI. It does not run the official generator, install WooCommerce, or claim compatibility before
the project supplies evidence. See [Bootstrap and import](agents-and-skills.md#bootstrap-and-import).

The completed family uses two deliberately different boundaries. Magento receives the smallest native
module package Adobe documents as required, with no business behaviour or compatibility claim. Catalyst
and Wix remain owned by their maintained generators: AtlasMind records prerequisites, commands, privacy,
compatibility, and post-generation acceptance gates, but does not authenticate, provision remote account
resources, install dependencies, initialize Git, or publish.

The SaaS/Web family follows the same ownership rule. Next.js, React Router, Laravel, Django, and Astro
remain upstream-generated: `/bootstrap` records current commands, prerequisites, side effects, privacy/
compatibility matrices, and acceptance gates but runs nothing. Next.js and Astro expose flags that keep
application dependency installation and Git initialization separate; Laravel and Django instead receive
honest interactive/version-pinned handoffs because their database, environment, and runtime choices are
project decisions. Static Website is the exception worth owning natively: a small dependency-free HTML/
CSS surface with escaped project text, a restrictive document CSP, accessibility defaults, built-in Node
contract tests, and least-privilege CI. Blog/CMS makes repository-owned, build-time remote, and live CMS
content separate declared choices rather than silently adding a hosted content dependency.

The Frontend family is also generator-owned, but narrows the post-generation review around the browser
boundary. Next.js, SvelteKit, and Nuxt must declare which code and data execute on the server, client,
edge, or at build time. React records the framework-first recommendation and uses Vite only for a
deliberately client-focused application; Vue keeps its interactive Router, Pinia, test, lint, formatting,
and developer-tools choices with the operator. The SvelteKit path uses the current `sv create` CLI rather
than create-svelte. All five handoffs require explicit routing, loading/error/offline states, public
environment-variable and browser-storage review, accessibility/browser matrices, performance budgets,
hosting headers, source-map policy, and rollback evidence before publication.

The Mobile family extends that review boundary across native toolchains and app-store delivery. React
Native records the framework-first recommendation and offers the bare Community CLI only when the project
has a written native constraint. Expo keeps dependency installation, generated agent instructions,
Continuous Native Generation, optional EAS services, update channels, and credentials separate. Flutter
uses its minimal installed-SDK generator, requires the documented Dart package naming convention, and
states plainly that initialization retrieves dependencies. All three start permission, secure-storage,
telemetry, native-module, OS/device, accessibility, physical-device, signing, store, migration, and
rollback evidence as Not assessed; bootstrap runs none of the commands.

### World-Class Developer Experience (Cross-Persona)

These initiatives close the gap between AtlasMind and best-in-class AI dev tools, targeting professional developers, small teams, and novice solo devs.

**Top 3 priorities**
- **Semantic codebase index (`@codebase` / embeddings RAG):** Vector index over actual source so agents retrieve relevant code, not just remembered SSOT decisions. Local embedding option (Ollama) keeps it bring-your-own-model and privacy-friendly. Biggest single capability gap; benefits all personas.
- **Multi-file diff review gate + inline edit:** A review surface showing all proposed edits with per-hunk accept/reject *before* anything touches disk, plus an "AI edit at cursor" / inline-diff command. Complements the existing checkpoint/rollback safety net (the after-the-fact gate).
- **Team layer — shared config + per-developer cost attribution:** Team-level (vs personal) settings, shared agents/skills/routines, "who spent what" attribution, and a pooled team budget cap. Strengthens the currently thinner small-teams story.

**Cross-cutting table stakes**
- Inline / ghost-text completion in the editor (or at minimum an "AI edit at cursor" inline-diff command) — the most obvious gap vs Copilot/Cursor.
- Scheduled / background autonomous agents — cron-style and background runs that report back (e.g. nightly dependency-update + test routine), building on existing `/ship` routines.

**Professional developers**
- **The guided GitHub workflow** — one canonical, deterministic, eight-stage workflow (issue intake → branch → develop → PR → CI → release → maintenance → automation), surfaced as a teaching-and-instrumentation page on the Project Dashboard and adapting to the project's enabled testing protocols. Tier 1 landed in 0.181.0; PR-native review (real `gh`-backed PR creation, inline review comments from the Security/Code Reviewer agents, CI-check review and conflict triage) is Tier 2, and CI failure classification plus release automation are Tier 3. Specified in [guided-github-workflow.md](guided-github-workflow.md); phased plan in [`project_memory/roadmap/guided-github-workflow.md`](../project_memory/roadmap/guided-github-workflow.md).
- Eval / regression harness for agents: pin "golden" tasks and detect when an agent definition or model swap regresses quality (mitigates the risk of the auto-update cadence).
- Monorepo / multi-root workspace awareness: per-package SSOT scoping and routing. Phase 1 of the [game engine plan](../project_memory/roadmap/game-engine-integration.md) delivered the declared component model and migrated the first consequence-heavy surfaces; further callers remain intentionally opt-in. See [project-composition.md](project-composition.md).
- Context window / token budget visualizer: show what's in context and let users prune it.
- SAST / dependency-CVE integration wired into the Security and Dependency Manager agents via an advisory feed.

**Small teams**
- Shared, syncable team config: agents, skills, routines, and personality shared via the repo, plus a team settings layer separate from personal settings.
- Per-developer cost attribution and pooled team budget (see Top 3).
- Community/team marketplace for agents & skills: import/export and sharing; drives adoption network effects.
- Decision/changelog provenance: link SSOT decisions to commits/PRs so the project brain is auditable across teammates.

**Novice solo devs**
- "Explain this codebase / this file" onboarding mode: guided tours generated from SSOT for unfamiliar code.
- Safe-by-default sandbox / dry-run mode: one-toggle "show me what would happen, nothing executes."
- Guardrail nudges & learning callouts: plain-language "here's why" so novices learn rather than just accept.
- Project templates / scaffolds beyond `/bootstrap`: pick a stack, get a working starter with tests and CI wired in (complements the Prefab Architecture Packs above).

### Ongoing Commitments
- Architectural integrity and changes that unlock safer future work.
- User-facing outcomes, milestones, and backlog order transparency.
- Delivery hygiene: tests, CI, release notes, and documentation.

---

## Frontier / Horizon Watch

> **Not committed work.** This section tracks emerging and frontier technology AtlasMind should monitor and architect for, so today's design decisions don't preclude tomorrow's capabilities. Items here are bets and watch-items, organized by horizon — they are intentionally separate from the near-term backlog above and should not be mistaken for scheduled features.

### Horizon 1 — adopt & harden now (0–12 months)
Frontier today, table stakes within a year. Being early differentiates; being late is a liability.

- **Reasoning-budget as a first-class routing axis** — extend budget + speed routing with a third "how hard to think" axis for extended-thinking / test-time-compute models. Natural home: TaskProfiler. Builds on the existing cache-aware, capability-sourced routing work.
- **Prompt-injection & tool-poisoning defense** — highest-priority frontier item given AtlasMind combines untrusted inputs (web-fetch, MCP servers, file content, model output) with autonomous tool use. Patterns: dual-LLM/quarantine so untrusted content never reaches the privileged planner directly, data-provenance taint tracking, a guardrail-model check before destructive/external actions, and signed/pinned MCP tool definitions. Formalize the "deny by default" posture into an explicit injection threat model.
- **LLM observability (OpenTelemetry GenAI semantic conventions)** — emit standardized traces/spans for agent runs, token usage, and tool calls so dashboards plug into the ecosystem instead of a bespoke format.
- **Sandboxed execution for autonomous runs** — microVM/container/WASM isolation for terminal-write and code-run so approvals can safely loosen as autonomy grows. Pairs with git-worktree-per-agent isolation for parallel fan-out.
- **Open Knowledge Format (OKF) interoperability** — Google Cloud's vendor-neutral markdown standard for curated agent knowledge (v0.1, 2026-06-16) is structurally what AtlasMind's SSOT already is. Rather than reformatting our own files to a two-day-old spec, add OKF **import/export** — including a user-facing **"Convert project to OKF"** command that emits an ingested project as a portable bundle — so a project's memory is portable across agents/vendors, plus a lightweight **spec-watch sync** (modeled on the existing provider/pricing sync services) that tracks the spec as it evolves and raises an advisory on version bumps — never auto-mutating memory. Detail in `project_memory/ideas/okf-interop.md`; evaluation in `project_memory/decisions/okf-alignment-evaluation.md`.

### Horizon 2 — architect for it now, ship later (12–24 months)
Don't build yet, but keep current abstractions from precluding these.

- **Agent-to-agent interoperability (A2A and successors)** — the layer above MCP: AtlasMind agents collaborating with external agents across tools/vendors. Keep the agent definition + messaging boundary protocol-clean.
- **Async / ambient background agents** — "works while you're away," triggered by repo events (new issue, failing CI, dependency CVE) rather than chat. Architectural ask: an event bus agents subscribe to. Seeded by the remote-control server and scheduled-agents backlog item.
- **GraphRAG / code knowledge graph** — a graph over symbols, call edges, and SSOT decisions alongside the planned vector index, enabling "what breaks if I change X" reasoning. Design the index layer so a graph can sit beside embeddings later.
- **Self-improving project model** — evolve curated-text SSOT toward a learned model of project conventions updated from accepted/rejected diffs. Capture the accept/reject training signal now (via checkpoint/run history) even before it is used.
- **Computer-use / browser-use agents** — for E2E testing, scraping, and UI verification; slots next to the Vision panel.

### Horizon 3 — watch & keep optionality (24+ months)

- **On-device frontier-class models** — a fully private, zero-cloud agentic coding mode as local models climb. Keep the local path first-class, not a fallback (BYO + local-sync architecture already positions for this).
- **Regulatory & AI-governance surface** — EU AI Act transparency, data residency, model provenance/cards, auditable autonomous-action logs. Generalize the planned GDPR toggle into a reusable "compliance profile" abstraction.
- **AI supply-chain integrity** — signed/attested artifacts (SLSA-style provenance) for the future agent/skill marketplace, which is otherwise a malware vector. Ties to the marketplace backlog item.
- **Multimodal-native dev loops** — video/screen-recording understanding for bug repro and audio-first pairing, building on Voice + Vision.

### Concentration bets
Three items are existential leverage rather than nice-to-haves:
1. **Prompt-injection defense** — the security-first positioning is hollow once MCP + autonomy + untrusted content combine.
2. **Reasoning-budget routing** — extends multi-axis routing (an existing strength) and rides the biggest model-capability trend.
3. **Sandboxed execution + worktree isolation** — the unlock that lets every other autonomy feature ship safely.

### Competitive watch: SUPACODE

> A shipping, open-source competitor ([SUPACODE](https://supacode.sh/)) — a native-macOS "command center" that runs 50+ CLI coding agents in parallel, each in its own `git worktree` — validates the *timing* of items already on this roadmap. It is mainly a **prioritization signal**, not a source of new ideas. Full analysis: `project_memory/ideas/supacode-competitive-analysis.md`.

- **Promote worktree isolation toward near-term.** AtlasMind already runs parallel subtask batches (`taskScheduler.ts`, `Promise.all`, cap 5) but on a **single shared working tree** — a latent write-race that is a correctness bug under the safety-first rule. Worktree-per-batch isolation (concentration bet #3) is the fix and is buildable now, not a 0–12-month bet.
- **PR-native GitHub automation.** Now tracked as Tier 2–3 of [the guided GitHub workflow](../project_memory/roadmap/guided-github-workflow.md) rather than as a separate bet — real `gh`-backed PR creation, CI-check review, and conflict triage, beyond today's git primitives.
- **Parallel "command center" UX (net-new framing).** A multi-lane view of N concurrent runs/worktrees with per-lane status and diff/approve, making parallel fan-out legible — complements the single-run Mission Control / Project Run Center.
- **Not pursuing:** becoming a generic BYO-CLI-agent multiplexer — that is SUPACODE's category and undercuts AtlasMind's integrated routing / memory / cost / privacy differentiators.

---

For more details or to contribute, see the full developer backlog in `project_memory/roadmap/improvement-plan.md`.
