# Developer Roadmap
This file is the developer-facing backlog AtlasMind should absorb into SSOT and consult when deciding what to tackle next.
> Priority order matters: items nearer the top receive more weight, but AtlasMind should still weigh criticality, security, architecture, delivery risk, and fresh execution evidence before choosing the next task.
## Prioritized Backlog
<!-- atlasmind:roadmap-items:start -->
- [ ] The Lens surfaces are not all accessible as they need a file selected. #mvp
- [ ] **Async / ambient background agents** — "works while you're away," triggered by repo events (new issue, failing CI, dependency CVE) rather than chat. Architectural ask: an event bus agents subscribe to. Seeded by the remote-control server and scheduled-agents backlog item. #mvp <!-- rm:async-ambient-background-age -->
- [ ] **Utilities:** Auth, Payments, Email, Analytics, i18n, Accessibility #mvp #critical <!-- rm:utilities-auth-payments-emai -->
- [ ] **Semantic codebase index (`@codebase` / embeddings RAG):** Vector index over actual source so agents retrieve relevant code, not just remembered SSOT decisions. Local embedding option (Ollama) keeps it bring-your-own-model and privacy-friendly. Biggest single capability gap; benefits all personas. #mvp #critical <!-- rm:semantic-codebase-index-code -->
- [ ] Eval / regression harness for agents: pin "golden" tasks and detect when an agent definition or model swap regresses quality (mitigates the risk of the auto-update cadence). <!-- rm:eval-regression-harness-for -->
- [ ] When searching on teh canvas have the search result conclude with zooming in to fit all the active search results onto the one page where possible. #mvp
- [ ] When auto aligning nodes on the various canvas spaces, disconnected nodes need not be so far away from the connected ones. Currently they are placed so far away it would be easy for a user to not even know they are there. #mvp <!-- rm:when-auto-aligning-nodes-on -->
- [x] On the ideation and roadmap canvases have a slight highlight on the edge of the canvas if there are nodes off screen in that direction. #mvp <!-- rm:on-the-ideation-and-roadmap -->
- [ ] On the roadmap and ideation canvases allow for a drag box to select a number of nodes to allow them all to be moved together. #mvp <!-- rm:on-the-roadmap-and-ideation -->
- [ ] The Road to MVP panel on the dash lists all teh mvp roadmap items, but they're a little too closely huddled making them a little hard to read. Give them a little more breathing room. Maybe even try giving them a little more width and double their padding? #mvp <!-- rm:the-road-to-mvp-panel-on-the -->
- [ ] The Overview button on the Project Dashboard navigation is not quite aligned horizontally properly as the other buttons are. Also some buttons at certain window widths overlap the edge of their wrapper box. #mvp <!-- rm:the-overview-button-on-the-p -->
- [ ] I think CTRL-MouseScroll on the project dashboard should zoom in/out in the same way that chromium browsers work. <!-- rm:i-think-ctrl-mousescroll-on -->
- [ ] When clicking on the Roadmap button on the Project Dashboard, there should be an immediate and direct way to visibly see a way to add an item to the roadmap #mvp <!-- rm:when-clicking-on-the-roadmap -->
- [ ] Add a way to manually and automatically sync github sponsors to the contributors md files using some pre-built and manual rulesets. This may need a new dashboard page. #mvp #critical <!-- rm:add-a-way-to-manually-and-au -->
- [ ] When onboarding a new project an early stage user prompt should be given to write in their own words the outline, outcome or ambition of the project. This can then be parsed by AM to the Ideation board, and then to a roadmap filling out all the associated files as well. #mvp <!-- rm:when-onboarding-a-new-projec -->
- [ ] The number of agents being used (and not used) should impact the project score. The dash, should, however, identify when models and providers are having issues. #mvp <!-- rm:the-number-of-agents-being-u -->
- [ ] The ui Studio should be able to tell where ui elements can be added and have them selectable so new or existing UI elements can be edited. #mvp <!-- rm:the-ui-studio-should-be-able -->
- [ ] The UI Studio should be able to read the repo and allow the user to select any of the discovered UI surfaces and work on them directly with a rendered output to work with. #mvp <!-- rm:the-ui-studio-should-be-able-2 -->
- [ ] **Game Dev (Phase 1 foundation delivered; scoped consumers next):** Unity, Unreal, Godot, Web-based — specified in [project-composition.md](project-composition.md); phased plan in [`project_memory/roadmap/game-engine-integration.md`](../project_memory/roadmap/game-engine-integration.md). <!-- rm:game-dev-unity-unreal-godot -->
- [ ] **AI/Automation:** AI SaaS, RAG, Agentic, Local Model, Orchestrator <!-- rm:ai-automation-ai-saas-rag-ag -->
- [ ] **DevOps:** Docker, Kubernetes, Serverless, Terraform <!-- rm:devops-docker-kubernetes-ser -->
- [ ] **Testing:** Full, Playwright, API <!-- rm:testing-full-playwright-api -->
- [ ] **Business Models:** Marketplace, Subscription, Booking, CRM <!-- rm:business-models-marketplace -->
- [ ] **Multi-file diff review gate + inline edit:** A review surface showing all proposed edits with per-hunk accept/reject *before* anything touches disk, plus an "AI edit at cursor" / inline-diff command. Complements the existing checkpoint/rollback safety net (the after-the-fact gate). <!-- rm:multi-file-diff-review-gate -->
- [ ] **Team layer — shared config + per-developer cost attribution:** Team-level (vs personal) settings, shared agents/skills/routines, "who spent what" attribution, and a pooled team budget cap. Strengthens the currently thinner small-teams story. <!-- rm:team-layer-shared-config-per -->
- [ ] Inline / ghost-text completion in the editor (or at minimum an "AI edit at cursor" inline-diff command) — the most obvious gap vs Copilot/Cursor. <!-- rm:inline-ghost-text-completion -->
- [ ] Scheduled / background autonomous agents — cron-style and background runs that report back (e.g. nightly dependency-update + test routine), building on existing `/ship` routines. #mvp <!-- rm:scheduled-background-autonom -->
- [ ] Monorepo / multi-root workspace awareness: per-package SSOT scoping and routing. Specified in [project-composition.md](project-composition.md) — AtlasMind is single-root by construction today (123 of 130 `workspaceFolders` reads take `[0]`), and Phase 1 of the [game engine… #mvp <!-- rm:monorepo-multi-root-workspac -->
- [ ] Context window / token budget visualizer: show what's in context and let users prune it. #mvp <!-- rm:context-window-token-budget -->
- [ ] SAST / dependency-CVE integration wired into the Security and Dependency Manager agents via an advisory feed. #mvp <!-- rm:sast-dependency-cve-integrat -->
- [ ] Project templates / scaffolds beyond `/bootstrap`: pick a stack, get a working starter with tests and CI wired in (complements the Prefab Architecture Packs above). #mvp <!-- rm:project-templates-scaffolds -->
- [ ] **Reasoning-budget as a first-class routing axis** — extend budget + speed routing with a third "how hard to think" axis for extended-thinking / test-time-compute models. Natural home: TaskProfiler. Builds on the existing cache-aware, capability-sourced routing work. #mvp <!-- rm:reasoning-budget-as-a-first -->
- [ ] **LLM observability (OpenTelemetry GenAI semantic conventions)** — emit standardized traces/spans for agent runs, token usage, and tool calls so dashboards plug into the ecosystem instead of a bespoke format. #mvp <!-- rm:llm-observability-openteleme -->
- [ ] **Agent-to-agent interoperability (A2A and successors)** — the layer above MCP: AtlasMind agents collaborating with external agents across tools/vendors. Keep the agent definition + messaging boundary protocol-clean. #mvp <!-- rm:agent-to-agent-interoperabil -->
- [ ] **GraphRAG / code knowledge graph** — a graph over symbols, call edges, and SSOT decisions alongside the planned vector index, enabling "what breaks if I change X" reasoning. Design the index layer so a graph can sit beside embeddings later. #mvp <!-- rm:graphrag-code-knowledge-grap -->
- [ ] Shared, syncable team config: agents, skills, routines, and personality shared via the repo, plus a team settings layer separate from personal settings. <!-- rm:shared-syncable-team-config -->
- [ ] Per-developer cost attribution and pooled team budget (see Top 3). <!-- rm:per-developer-cost-attributi -->
- [ ] Community/team marketplace for agents & skills: import/export and sharing; drives adoption network effects. <!-- rm:community-team-marketplace-f -->
- [ ] **Offer a capability you are clearly reaching for.** When run history shows repeated use of a tool a catalogued MCP server covers — `gh` on a GitHub-heavy project, say — offer that server once. The offer is evidence-triggered, never speculative, and must **not** be framed as a cost saving: a GitHub MCP publishes ~30 tools into the same tool-context budget that already overflowed in an observed run ("Exceeded skills context budget… 25 additional skills were not included"), so it plausibly costs context rather than saving it. State what it adds and what it consumes. A refusal is remembered per server per project and never re-raised. Installs stay seeded-disabled, as `ardInstaller` already does — an offer is not trust, and installing an MCP runs third-party code (see AI supply-chain integrity). Optional second rung, off by default: when nothing in the local catalogue fits, query the enabled ARD finders. That stays a separate switch from having finders at all, sends the **category** (`"github"`) and never the goal, the repo name or anything derived from the code, and caches a miss under the same don’t-nag rule as a refusal. <!-- rm:offer-a-capability-you-are-c -->
- [ ] Decision/changelog provenance: link SSOT decisions to commits/PRs so the project brain is auditable across teammates. <!-- rm:decision-changelog-provenanc -->
- [ ] "Explain this codebase / this file" onboarding mode: guided tours generated from SSOT for unfamiliar code. <!-- rm:explain-this-codebase-this-f -->
- [ ] Safe-by-default sandbox / dry-run mode: one-toggle "show me what would happen, nothing executes." <!-- rm:safe-by-default-sandbox-dry -->
- [ ] Guardrail nudges & learning callouts: plain-language "here's why" so novices learn rather than just accept. <!-- rm:guardrail-nudges-learning-ca -->
- [ ] **Prompt-injection & tool-poisoning defense** — highest-priority frontier item given AtlasMind combines untrusted inputs (web-fetch, MCP servers, file content, model output) with autonomous tool use. Patterns: dual-LLM/quarantine so untrusted content never reaches the privileged planner directly,… #mvp <!-- rm:prompt-injection-tool-poison -->
- [ ] **Sandboxed execution for autonomous runs** — microVM/container/WASM isolation for terminal-write and code-run so approvals can safely loosen as autonomy grows. Pairs with git-worktree-per-agent isolation for parallel fan-out. #mvp <!-- rm:sandboxed-execution-for-auto -->
- [ ] **Open Knowledge Format (OKF) interoperability** — Google Cloud's vendor-neutral markdown standard for curated agent knowledge (v0.1, 2026-06-16) is structurally what AtlasMind's SSOT already is. Rather than reformatting our own files to a two-day-old spec, add OKF **import/export** — including a… <!-- rm:open-knowledge-format-okf-in -->
- [ ] **Self-improving project model** — evolve curated-text SSOT toward a learned model of project conventions updated from accepted/rejected diffs. Capture the accept/reject training signal now (via checkpoint/run history) even before it is used. <!-- rm:self-improving-project-model -->
- [ ] **Computer-use / browser-use agents** — for E2E testing, scraping, and UI verification; slots next to the Vision panel. <!-- rm:computer-use-browser-use-age -->
- [ ] **On-device frontier-class models** — a fully private, zero-cloud agentic coding mode as local models climb. Keep the local path first-class, not a fallback (BYO + local-sync architecture already positions for this). #mvp <!-- rm:on-device-frontier-class-mod -->
- [ ] **Regulatory & AI-governance surface** — EU AI Act transparency, data residency, model provenance/cards, auditable autonomous-action logs. Generalize the planned GDPR toggle into a reusable "compliance profile" abstraction. #mvp <!-- rm:regulatory-ai-governance-sur -->
- [ ] **Multimodal-native dev loops** — video/screen-recording understanding for bug repro and audio-first pairing, building on Voice + Vision. #mvp <!-- rm:multimodal-native-dev-loops -->
- [ ] **Promote worktree isolation toward near-term.** AtlasMind already runs parallel subtask batches (`taskScheduler.ts`, `Promise.all`, cap 5) but on a **single shared working tree** — a latent write-race that is a correctness bug under the safety-first rule. Worktree-per-batch isolation… #mvp <!-- rm:promote-worktree-isolation-t -->
- [ ] **AI supply-chain integrity** — signed/attested artifacts (SLSA-style provenance) for the future agent/skill marketplace, which is otherwise a malware vector. Ties to the marketplace backlog item. <!-- rm:ai-supply-chain-integrity-si -->
- [ ] **PR-native GitHub automation.** Now tracked as Tier 2–3 of [the guided GitHub workflow](../project_memory/roadmap/guided-github-workflow.md) rather than as a separate bet — real `gh`-backed PR creation, CI-check review, and conflict triage, beyond today's git primitives. <!-- rm:pr-native-github-automation -->
- [ ] **Parallel "command center" UX (net-new framing).** A multi-lane view of N concurrent runs/worktrees with per-lane status and diff/approve, making parallel fan-out legible — complements the single-run Mission Control / Project Run Center. <!-- rm:parallel-command-center-ux-n -->
- [x] The ACP connection to subscribed providers has stopped working. #mvp #critical <!-- rm:the-acp-connection-to-subscr -->
- [x] **The guided GitHub workflow** — one canonical, deterministic, eight-stage workflow (issue intake → branch → develop → PR → CI → release → maintenance → automation), surfaced as a teaching-and-instrumentation page on the Project Dashboard and adapting to the project's enabled testing protocols.… #mvp <!-- rm:the-guided-github-workflow-o -->
- [x] When you click Add Item in the Roadmap dassh, the focus should be taken down to the new entry form #mvp <!-- rm:when-you-click-add-item-in-t -->
- [x] The Roadmap Editable Queue panel could be larger, as it only shows a couple of entries at a time. Also, when clicking and dragging, the list should change to a title only list so it becomes easier to slide the entries in the order you want. <!-- rm:the-roadmap-editable-queue-p -->
- [x] The roadmap editable queue should be searchable. <!-- rm:the-roadmap-editable-queue-s -->
- [x] When adding an item to the roadmap, the editable queue entry form should also allow the selecting of a gate, tag, and a assigned user. Also the text box could be 400% bigger. <!-- rm:when-adding-an-item-to-the-r -->
- [x] In the Project Manager Dash, the chips at the top of teh screen showing the delivery stages and their version number. If clicked on they should invite teh user to make the current branch. If the current branch is one of these then it should be highlighted with a coloured outline. <!-- rm:in-the-project-manager-dash -->
- [x] Allow the roadmap canvas to highlight nodes based on gates and users. <!-- rm:allow-the-roadmap-canvas-to -->
- [x] If you double click on a roadmap canvas node then you zoom into it. #mvp <!-- rm:if-you-double-click-on-a-roa -->
- [x] The search functionality on the roadmap flowcharts should identify the roadmap nodes, but keep the other nodes greyted out so the user can still see dependancies. If they click on a node the same functionality as currently exists takes over. <!-- rm:the-search-functionality-on -->
- [x] The delivered Roadmap flow chart should have the exact same functgionality as the dependancy canvas. <!-- rm:the-delivered-roadmap-flow-c -->
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
<!-- atlasmind:roadmap-items:end -->
## Prioritisation Notes
1. Critical, security, reliability, or production-blocking work.
2. Architectural integrity and changes that unlock safer future work.
3. User-facing outcomes and the manual order of this backlog.
4. Delivery hygiene such as tests, CI, release notes, and docs.


### Release gates
<!-- atlasmind:roadmap-gates:start -->
- `#mvp` — MVP
- `#critical` — Critical
<!-- atlasmind:roadmap-gates:end -->

<!-- atlasmind-import
entry-path: roadmap/improvement-plan.md
generator-version: 2
generated-at: 2026-07-31T03:25:06.200Z
source-paths: README.md | package.json
source-fingerprint: e4812cac
body-fingerprint: ffbb3f5c
-->
