# Cutting-Edge Routing & Intelligence Roadmap

Status: **active roadmap** (created 2026-06-17). Captures the direction agreed with
the maintainer for keeping AtlasMind at the technology frontier, plus the NVIDIA
Cosmos evaluation. Each numbered direction is a multi-session feature and will be
built one at a time with its own tests and docs.

## Context

AtlasMind's edge is in *orchestration intelligence* (routing, memory, agentic
verification), not in being a model. Investments should compound that edge rather
than chase model-class features that don't fit a code-orchestration tool.

## Evaluated & deferred: NVIDIA Cosmos

**Decision: do not incorporate Cosmos into the core.** Cosmos is a platform of
*World Foundation Models for physical AI* (robotics, AVs, embodied agents) —
Cosmos Predict (future world-state video), Cosmos Transfer (sim-to-real),
Cosmos Reason (physical-common-sense VLM), Cosmos Tokenizer. Its domain is the
physical, visual, spatiotemporal world; AtlasMind's "world" is a codebase/project,
already modelled by the SSOT memory system. There is no consumer for Cosmos
outputs in a software-engineering orchestrator.

**Revisit only if** AtlasMind deliberately expands into robotics/embodied-AI
*developer* workflows — and even then as an optional domain skill / MCP
integration behind the skill-approval boundary, never a core dependency.

The realistic NVIDIA fit was the **Nemotron family via NIM** as a routed provider
(shipped in v0.86.0 — see `NVIDIA_CATALOG`).

## Direction 1 — Cache-aware routing — **COMPLETE (v0.87.0–v0.88.0)**

Implemented: `RoutingConstraints.cacheablePrefixRatio`, cache-aware
`effectiveCostPer1k`, `estimateCacheablePrefixRatio`, `ModelInfo`/`CatalogEntry`
`supportsPromptCaching` + `cachedInputPricePer1k`, orchestrator wiring from the
carried session/native context, **dynamic** capability sourcing (discovery
hint → pricing sync → catalog, with a provider-set bootstrap fallback; explicit
`false` overrides), accurate per-provider cache-read factors (v0.87.1), and
**measured savings visibility** (v0.88.0): adapters read cached input tokens
from provider usage; the orchestrator values avoided spend via
`ModelRouter.cacheReadPricePer1k`; `CostSummary` aggregates
`totalCacheSavingsUsd` + `totalCachedInputTokens`; the Cost Dashboard shows a
**Cache Savings** card. Direction 1 is closed end-to-end.

Active cache writes (v0.89.0): the Anthropic adapter now marks the system prompt
+ tool definitions with `cache_control: ephemeral` on agentic (tool-carrying)
requests, so AtlasMind *generates* the savings the panel measures (OpenAI /
DeepSeek cache automatically). Gated on tool presence to avoid the cache-write
premium on single-shot turns.

Caching refinements (v0.90.0): both shipped — (1) threaded tool-less caching via
the `cacheStablePrefix` request flag (set when the carried-context cacheable ratio
≥ `CACHE_PREFIX_REUSE_THRESHOLD`), and (2) the stable/volatile system split
(`splitStableSystemPrefix`) so the cache breakpoint sits after the stable head and
before memory/evidence, raising cross-turn hit rates.

Possible later refinements: populate real per-provider cached prices through the
pricing-sync scrapers (`ProviderPricingEntry.cachedInputPer1k` is the channel);
surface cache savings on the web remote dashboard.

Original design notes below.

### Original — Cache-aware routing (build first)

**Why:** Frontier providers (Anthropic, OpenAI, DeepSeek, Google) price cached
input tokens far below fresh input. AtlasMind sends a large, stable prefix every
turn (system/identity prompt + SSOT memory bundle + tool definitions) followed by
a small volatile turn. A router that models cache economics can prefer
cache-capable models for iterative/threaded work and report real savings.

**Design sketch:**
- Add `supportsPromptCaching?: boolean` and `cachedInputPricePer1k?: number` to
  `CatalogEntry` / `ModelInfo`; annotate cache-supporting catalog families.
- In `effectiveCostPer1k`, when a task is iterative/threaded (reuse the existing
  session/thread signal) and a large stable prefix exists, project input cost as
  `cachedInputPricePer1k` for the cacheable fraction. Add a conservative,
  configurable cache-hit assumption.
- Surface "estimated cache savings" in the Cost Dashboard alongside the existing
  local-savings panel.
- Tests: cost projection with/without caching; ensure non-iterative single-shot
  turns are unaffected.

## Direction 2 — Outcome-driven (eval) routing — **CORE SHIPPED (v0.91.0)**

Shipped: a decayed per-model execution-outcome EWMA (`recordExecutionOutcome` /
`gradeExecutionQuality`) feeding a bounded, weight-gated, min-sample routing nudge
(`scoreOutcomeBias`), separate from manual feedback, persisted across sessions
(`onModelOutcomeRecorded` hook + `atlasmind.executionOutcomes`). Deferred:
per-(reasoning-tier × model) granularity (shipped v0.93.0 — outcomes bucketed by
reasoning tier with aggregate fallback) and the scored-replay harness (shipped
v0.95.0 as `modelEvalHarness.ts` + the `AtlasMind: Compare Models on a Prompt`
command, which records graded outcomes back into the routing channel). A richer comparison UI shipped in v0.97.0 as the Model Comparison webview panel
(`src/views/modelComparisonPanel.ts`).

Original design notes:

**Why:** The router already records outcomes (`recordModelOutcome`) and applies a
feedback bias. Extend this into a lightweight eval loop so routing improves from
*this project's* observed results, not just thumbs up/down.

**Design sketch:**
- Persist per-(task-profile × model) success/verification signals from project
  runs (reuse `ProjectRunHistory` + the testing-methodology verification
  artifacts as a quality signal).
- Add an optional scored-replay harness: re-run a saved task set across candidate
  models and store pass/verify/cost, surfaced in the Project Run Center.
- Feed an aggregate, decayed success rate into the router's `preferenceBias`
  channel (bounded, like the current feedback weight).
- Tests: bias is bounded and cannot starve healthy providers; cold-start falls
  back to catalog heuristics.

## Direction 3 — Local + frontier hybrid routing — **FOUNDATION SHIPPED (v0.92.0)**

Shipped: the `RoutingConstraints.preferredModel` role-pin primitive
(`resolvePinnedModel` — bypasses budget/speed, respects health/caps/allow-list)
and its first consumer, the **planner brain** (`atlasmind.planningModelId` pins
the planning phase; execution still routes to tool-capable workers). This is the
planner-brain / tool-executor split made real. v0.94.0 added the **synthesis
brain** (`atlasmind.synthesisModelId`), completing the plan → execute → synthesize
role-routing trio. v0.96.0 added the **draft model** pin (`atlasmind.draftModelId`)
for local-draft / frontier-escalate, completing the draft/plan/execute/synthesize
role set (escalation clears any pin so it can always upgrade). v0.96.1 raised the
claude-cli brain-role context budget (latest turn ~16k vs the old uniform 4k,
within the Windows command-line limit), making a Claude subscription a far more
capable brain pin. All routing-roadmap directions are now shipped to their
practical extent on the current architecture; a true stdin-based claude-cli path
(to exceed the command-line limit) remains a possible future lever.

Original design notes:

**Why:** AtlasMind has strong local-model plumbing (Ollama/LM Studio sync,
recommendations, $0 cost). The cost/quality frontier increasingly favours
"draft locally, verify/finish with frontier."

**Design sketch:**
- A routing mode that assigns a cheap local model to mechanical/draft subtasks
  (already partially present via `isSimpleMechanicalTask`) and escalates to a
  frontier model for high-reasoning or verification subtasks.
- Make the escalation explicit and observable in the run trace; gate by a
  confidence/verification signal rather than a fixed rule.
- Tests: escalation fires on high-reasoning profiles; never escalates trivial
  turns; respects budget caps.

### Sub-pattern — "planner-brain / tool-executor" role routing

A specific generalisation of hybrid routing: pin the **reasoning/planning and
final-synthesis phases to a chosen "brain" model/provider** (e.g. a Claude
subscription via `claude-cli`), and route **tool-using execution subtasks to
tool-capable workers**, with worker results flowing back to the brain.

Why it fits AtlasMind almost as-is:
- The Planner already profiles its work as `phase: 'planning', requiresTools:
  false` and routes independently of execution (`planner.ts`), so the brain
  phase is structurally a no-tool reasoning call — exactly what `claude-cli`
  (chat-only, `function_calling` stripped) can do, and it is already eligible
  (and `$0` effective cost) for that phase.
- Execution subtasks declare `requiresTools: true`, which excludes `claude-cli`
  and routes to tool-capable models — the "hands."
- Worker results already carry back via `SessionContextBundle` / run history.
- `parsePlannerResponse()` already turns free-text plans into structured
  subtasks with a `fallbackPlan()` safety net, so a plain-text plan from the
  `--print` bridge is compatible.

Gating factors to make it deliberate (not incidental):
1. **Explicit role pinning** — let the user designate a brain provider/model for
   the planning + synthesis phases instead of relying on incidental routing.
   This is the natural extension of the active-subscription nudge below.
2. **Higher-fidelity Claude path for the brain role** — the current `claude-cli`
   adapter truncates hard (4 msgs / 4k chars / 2k system prompt, strips
   memory+evidence, `--max-turns 1`), which caps plan and synthesis quality.
   A less lossy reasoning path is the prerequisite for this to be *good*, not
   merely *possible*.

### Related fix — active-subscription routing nudge (shipped)

Subscription providers received an explicit preference bonus only on
`maintenance`-phase tasks (`SUBSCRIPTION_MAINTENANCE_BONUS`), so on normal tasks
a paid-for, quota-remaining subscription tied with local/free on the cheapness
axis but — unlike local models — got no general nudge over pay-per-token. Added a
small, **quota-aware** general bonus so an active subscription (quota remaining)
is preferred for ordinary work too, vanishing once quota is exhausted (at which
point it is effectively pay-per-token). This is also the foundation for the
explicit brain-role pinning above.

## Related fix already shipped

The catalog's `reasoningDepth` / `latencyClass` annotations were being dropped in
`inferModelMetadata`, so discovery-populated models lost their depth and the
router under-ranked genuine deep reasoners (Opus, DeepSeek R1, Nemotron Ultra)
for high-reasoning tasks. Fixed so the annotations survive the merge — a
prerequisite for all three directions to route on accurate model metadata.

## Note on the Claude subscription (`claude-cli`)

The `claude-cli` provider is an intentional **chat-only** bridge (`claude --print`,
`--tools ''`) and strips `function_calling`. AtlasMind is tool-driven, so the
router *correctly* skips it for the majority of (tool-using) agentic work — this
is why a Claude subscription "rarely gets used," not a routing bug. Using a Claude
subscription for full agentic work would require a tool-capable integration path
that the subscription does not currently expose. The reasoning-metadata fix above
does improve its ranking for the chat-only turns where it *is* eligible.
