# Model Routing

## Overview

The Model Router selects the best LLM for each request based on user preferences, agent constraints, inferred task profile, model capabilities, and cost.

For OpenAI-family chat completion providers, AtlasMind now applies provider-specific compatibility rules instead of one shared payload shape. OpenAI and Azure OpenAI use the newer chat contract with `developer` messages and `max_completion_tokens`, while third-party OpenAI-compatible providers continue using the broader `system` plus `max_tokens` contract for compatibility. AtlasMind also omits `temperature` for fixed-temperature OpenAI model families such as GPT-5 and the `o`-series, while retaining it for models and providers that still support sampling controls.

For tool-enabled requests sent through OpenAI-compatible providers, AtlasMind also normalizes internal tool ids into OpenAI-safe function names before transmission and maps returned tool calls back to the original Atlas skill ids. This keeps MCP-derived tools usable even when their internal ids contain characters such as `:` or `/` that OpenAI rejects.

AtlasMind now also derives lightweight intent aliases for MCP-backed tools from their names and descriptions. Plain-English prompts such as “commit”, “save changes”, or “show status” are scored against those aliases so the model sees a shortlist of the most likely tools for the current request. When multiple tools score similarly, Atlas explicitly nudges the model to ask the user for clarification instead of guessing.

Anthropic now follows the same compatibility principle for tool-enabled turns. AtlasMind rewrites internal skill ids into provider-safe Anthropic tool names on the wire and restores the original skill ids on returned tool calls, which keeps MCP-backed tools usable even though Anthropic rejects characters such as `:` and `/` in tool names.

AtlasMind can also perform one bounded escalation during execution when the current model shows repeated struggle signals, such as repeated failed tool calls or excessive tool-loop churn. In those cases it reroutes to a stronger reasoning-capable model instead of exhausting the entire loop on the weaker route.

**Correction turns are never downgraded.** When the user's message disputes or corrects the assistant's previous answer (`isUserCorrectionTurn` — e.g. "that's not correct", "no, that's wrong", "you got it wrong", "are you sure?", "re-check that"), AtlasMind treats the turn as high-stakes: it forces the task profile to **high** reasoning, prefers a reasoning-capable model, and escalates the routing budget/speed (`budgetForCorrection`: `cheap → balanced`, otherwise `→ expensive`; speed `→ considered`). This prevents a pushback against a wrong answer from being silently routed to the cheapest/local model — the failure mode where a flaky local model returned an empty completion when challenged.

**Empty completions trigger escalation, not a blank turn.** If the selected model returns a completion with no usable content (zero output tokens / blank text and no tool calls), AtlasMind no longer re-prompts the *same* model (a weak/flaky local model tends to return empty again). Instead the self-recovery path records the empty result as a model failure (so routing avoids it this session) and retries on an **escalated, reasoning-class model** via `selectEscalatedModel`, falling back to the original model only when nothing better is available. If bounded recovery still cannot produce an answer, transcript metadata records **No usable answer was returned** and exposes **Retry** plus **Provider status** choices; zero output is never relabelled as “Answered from context.”

For action-oriented workspace requests, AtlasMind also distinguishes between evidence-gathering and follow-through. Prompts that ask Atlas to wire, integrate, configure, support, add, update, fix, or otherwise implement behavior are now biased more aggressively toward direct execution, and after successful read-only evidence gathering AtlasMind issues one stronger follow-through reprompt before accepting a summary-only answer. Verification-style follow-ups such as asking whether a change actually happened now also trigger a repository-backed check, and investigation stalling like “I need to check” is treated as a retry signal rather than an acceptable final answer.

AtlasMind also treats prompts about the current project structure, settings pages, or voice and audio settings as workspace-backed investigation requests more aggressively. When a turn has already gathered enough read-only repository evidence, the follow-through nudge now requires exact existing file paths or one final lookup before Atlas is allowed to settle on a summary.

Security prompts such as security gap analysis, runtime-boundary review, auth review, vulnerability review, and threat modeling now bias even more strongly toward live repository evidence. AtlasMind treats those requests as code, configuration, runtime-boundary, and test investigations first, adds explicit prompt guidance that documentation is context rather than the sole source of truth, and prefers source-backed implementation evidence before it summarizes any claimed gap.
URL-bearing integration and configuration prompts now also inject explicit URL-safety guidance so Atlas validates scheme and host trust boundaries, prefers HTTPS for external services, and uses the SSRF-safe fetch or HTTP request path to verify health or reachability before it presents a link as working.
If the selected provider fails outright, AtlasMind attempts **up to three failovers** for the turn, under a hard backstop of five model attempts in total. Failover and escalation draw on **separate budgets**: escalation is the discretionary upgrade for an answer that was merely not good enough, failover is what keeps a turn alive when an endpoint dies, and a single shared counter used to let the first spend what the second would need. When a turn does stop, the message names the limit actually reached — failover budget, absolute ceiling, or no other configured provider able to serve the request — rather than reporting a ceiling that was never hit.

A failure opens a circuit for the whole execution endpoint, so changing only an ACP effort/model variant or a local model on the same failed server does not restart the same broken process. **Both** the failover and escalation paths consult that circuit; escalation previously did not, so a timeout could open the circuit and the very next escalation would route straight back into the endpoint the turn had just watched fail. Two classes of failure open it: transport wording (timeout, socket, connection, fetch failed…) for any provider, and a **JSON-RPC error code from a stdio provider** such as ACP — for an agent on the other end of a pipe the transport *is* the process, and `-32603 Internal error` names none of the transport words. HTTP providers are deliberately excluded from that second rule, since one 500 is one endpoint of many behind a load balancer.

Endpoint health **survives the turn**: two hard failures quarantine an endpoint for ten minutes, so a crashed agent is not first pick on every subsequent message, and one completed attempt clears the record. A quarantine can never refuse a turn — if the quarantined endpoint is the only one able to serve the task, the block is lifted and the attempt is made.

ACP receives its protocol-aware 180-second deadline instead of the generic 30-second provider deadline. The transcript records only endpoints that were really invoked, with their status and duration; router previews and skipped variants are not reported as “models used.”

AtlasMind also includes workstation context in routed prompts so response formatting can default to the active environment, such as preferring PowerShell command examples on Windows inside VS Code unless the user asks for another shell or platform.

The Local provider now aggregates multiple labeled OpenAI-compatible endpoints under one routed provider identity. AtlasMind encodes the endpoint identity into each discovered local model id, which lets one workspace keep engines such as Ollama and LM Studio available together while still routing follow-up requests back to the correct engine.

For responses viewed in the shared AtlasMind chat workspace, assistant bubbles now expose thumbs up and thumbs down controls. AtlasMind persists those votes per assistant turn, aggregates them by `modelUsed`, and folds them back into future routing as a small bounded preference bias rather than a hard provider or model lock.

In addition to manual thumbs votes, AtlasMind also feeds **task outcome results** directly into the preference signal. After every agentic task completes, `ModelRouter.recordModelOutcome(modelId, success)` increments or decrements the preference vote count by `PERFORMANCE_OUTCOME_WEIGHT` (0.12). This means routing continuously adapts from real execution results, not only from explicit user feedback.

**Deprecation and staleness handling**: models with a `deprecatedAt` date in the past are automatically excluded from the candidate pool. Provider-confirmed model-not-found/deprecated errors create a session retirement tombstone that a later stale discovery response cannot clear or re-list. Ordinary failure records older than 5 minutes are still cleared so transient network errors do not permanently suppress a provider. A successful discovery response is authoritative even when it contains zero models, so Settings refresh prunes the previous provider list; discovery exceptions and timeouts preserve the last known catalog.

**Extended-thinking cost scaling**: for models with a `thinkingTokenMultiplier`, `effectiveCostPer1k` applies that multiplier to the output price before budget scoring, preventing extended-thinking models from appearing cheaper than they are in budget modes.

**Smooth context-window gradients**: the `scoreTaskFit` penalty for undersized context windows now interpolates linearly — `penalty × (1 − contextWindow / threshold)` — rather than applying a binary cliff. A model with 50 K context on a 60 K threshold receives a much smaller penalty than one with 4 K context, and future models with context windows above the threshold receive no penalty at all.

## Routing Inputs

| Input | Source | Description |
|---|---|---|
| Budget mode | User setting (`atlasmind.budgetMode`) | `cheap`, `balanced`, `expensive`, `auto` |
| Speed mode | User setting (`atlasmind.speedMode`) | `fast`, `balanced`, `considered`, `auto` |
| Feedback routing weight | User setting (`atlasmind.feedbackRoutingWeight`) | Multiplier for thumbs-based routing bias; `0` disables it and `1` is the default slight influence |
| Max cost | Per-request or agent-level limit | Hard USD cap for the request |
| Preferred provider | Routing constraints | Soft preference for a specific provider |
| Allowed models | `AgentDefinition.allowedModels` | Whitelist — empty means any |
| Trusted-model gate | `RoutingConstraints.requireTrustedModel` + Data Privacy policy | When the assembled context contains confidential/regulated data, candidate models are restricted to the Data Privacy **trusted** allow-list so classified content is only sent to user-selected models. See [Data Privacy](#data-privacy-trusted-model-gate) |
| Task profile | `TaskProfiler` | Inferred `phase`, `modality`, `reasoning`, and capability needs |
| Model capabilities | `ModelInfo.capabilities` | `chat`, `code`, `vision`, `function_calling`, `reasoning` |
| Reasoning depth | `ModelInfo.reasoningDepth` | 0–3 numeric scale replacing the binary `reasoning` tag; drives graduated scoring |
| Latency class | `ModelInfo.latencyClass` | `'fast' \| 'balanced' \| 'slow'`; authoritative speed-tier annotation; overrides context-window heuristic |
| Provider availability | Health check result | Whether the provider is reachable |
| User feedback bias | Chat thumbs up/down history | Small per-model preference signal derived from stored assistant-response votes |

## Task Profiles

AtlasMind now profiles each request before routing. The profiler infers:

| Field | Values | Purpose |
|---|---|---|
| Phase | `planning`, `execution`, `synthesis` | Distinguishes decomposition, task work, and final report assembly |
| Modality | `text`, `code`, `vision`, `mixed` | Detects whether the request is code-centric, image-centric, or both |
| Reasoning | `low`, `medium`, `high` | Influences whether reasoning-capable models should be preferred |
| Required capabilities | `vision`, `function_calling`, etc. | Hard filters before scoring |
| Preferred capabilities | `code`, `reasoning`, `vision` | Soft score boosts after hard filtering |

Examples:
- Planning and synthesis default to high-reasoning profiles.
- Screenshot or image tasks require `vision`.
- Turns with one or more selected AtlasMind tool schemas require `function_calling`; a task-scoped agent can remain a normal text turn when no capability is relevant.
- Terse command-style MCP actions now prefer a real local function-calling model first when the local provider exposes one, which keeps simple tool turns off billed providers whenever a suitable local model is available.
- When no healthy model satisfies those implicit tool requirements, AtlasMind retries the turn without tool use before it allows the built-in `local/echo-1` fallback, so text-only providers can still answer normal chat requests.
- Code-heavy tasks prefer models with `code` support even when `code` is not a hard requirement.
- Freeform chat requests that mention supported workspace image paths are upgraded to vision requests, and the `/vision` chat command can explicitly attach selected workspace images to compatible provider adapters.
- Important thread-based follow-up prompts such as "based on the chat thread" or other high-stakes carry-forward requests are profiled more aggressively so AtlasMind can escalate away from weak local models on later turns.
- Open-ended triage/advisory prompts ("what should we work on next?", "is there anything incomplete?", "what would you recommend?") are profiled as **high** reasoning. They look short but require whole-project reasoning, so without this they fell through to `low` and were routed to the cheapest (often sub-10B) model. Mechanical follow-ups (e.g. "commit") remain low/medium.
- Whole-project assessment/evaluation/review prompts (for example, "give me an honest assessment of my project so far") also have a deterministic **high**-reasoning floor. This floor is applied after classification, so an optional classifier cannot downgrade a broad workspace synthesis merely because the request is short.

### Skill-schema context budgeting

Skill policy is resolved before capability routing. `task-scoped` agents select at most 12 relevant tools from their enabled eligibility pool; `allowlist` and deliberate `all` policies preserve their declared pool. This means `function_calling` is required by the tools actually selected for this request, not merely because an agent could use a tool on some other turn.

Callable JSON definitions are the single model-facing skill description. AtlasMind does not also inject a prose skills list or likely-tool block. The serialized schemas count in the initial prompt/cost estimate, are reserved before session and memory budgets are allocated, and are included in every tool round's context-window headroom calculation. ACP completion-only or delegated-native-tool attempts receive an empty AtlasMind schema list and therefore reserve no AtlasMind tool-schema budget; a normal-provider failover rebuilds the messages with the selected schemas.

## Specialist Intent Routing

Before a freeform chat request reaches the normal router, AtlasMind now checks for specialist workflow shapes that should not be handled as generic text chat.

- Image and other media generation requests are redirected to the specialist integration surface instead of being treated as ordinary chat prompts.
- Image-recognition requests route into the vision workflow. If image attachments are already present, AtlasMind keeps the request in-chat and upgrades it to a considered multimodal run.
- Speech and transcription requests route to the voice workflow.
- Research-heavy requests bias toward source-backed retrieval, add explicit specialist guidance to the routed prompt, and prefer deep-research providers when they are enabled.
- Robotics and simulation prompts bias toward slower, stronger code-and-reasoning routes so tool-backed execution is more likely than a generic prose answer.

This specialist layer is intentionally separate from the provider adapter table: it decides whether Atlas should open a dedicated workflow surface, route toward a specialist-capable provider, or keep the request in ordinary chat with stronger capability requirements.

The provider preference for those specialist in-chat routes is no longer hardcoded to one fixed provider list. AtlasMind now carries optional `ModelInfo.specialistDomains` metadata through discovery and catalog refresh, derives fallback domain tags from refreshed model IDs and capabilities when providers do not expose them explicitly, and scores the live enabled model pool per specialist domain before choosing a preferred provider.

Specialist routing has **no override setting**. `atlasmind.specialistRoutingOverrides` shipped once and was removed in April 2026 along with the code that read it — pin a provider through the Model Providers panel instead. The default behaviour stays adaptive as provider catalogs change.

## Budget Modes

| Mode | Behaviour |
|---|---|
| **Cheap** | Apply the cheap-tier gate first, then weight effective cost much more heavily so the lowest-cost eligible model usually wins unless a hard requirement rules it out |
| **Balanced** | Middle ground — reasonable quality at moderate cost |
| **Expensive** | Prefer the highest-capability model regardless of cost |
| **Auto** | Estimate task complexity and choose accordingly, without exceeding any hard cost limit |

## Speed Modes

| Mode | Behaviour |
|---|---|
| **Fast** | Apply the fast-tier gate first, then weight speed much more heavily among the surviving candidates |
| **Balanced** | Default trade-off between speed and quality |
| **Considered** | Prefer models with strong reasoning, even if slower |
| **Auto** | Assess whether the task needs deep reasoning or a quick answer |

## Selection Algorithm

```
1. Gather all enabled models across all registered providers
2. Exclude providers whose `healthCheck()` currently reports unhealthy
3. Filter by `preferredProvider` when provided in routing constraints
4. Filter by agent's `allowedModels` whitelist (if set)
5. Merge explicit `requiredCapabilities` with the task profile's required capabilities
6. Apply hard gates for budget mode and speed mode
   - Subscription / free models pass the budget gate if quota remains (or is not tracked); exhausted subscriptions fall to normal tier gating
7. Score each remaining model:
   score = w_budget × cheapness(effectiveCost)
     + w_speed  × speedScore(model)
     + w_quality × qualityScore(model)
     + taskFit(profile, model)
     + healthBonus(provider)
     + feedbackBias(model)
     + zeroMarginalCostAdequacy(model, profile)
     + outcomeBias(model, reasoningTier)        // decaying EWMA of execution quality
     − strugglePenalty(model, taskSignature)    // persistent, decaying de-weight
8. Struggle tier-escape: if the top pick has repeatedly struggled on THIS task
   signature, re-open candidacy one budget tier higher (cheap → balanced →
   expensive) and re-rank — bounded to two bumps — so a capable model can take
   over the task kind the cheap model keeps failing
9. Return the highest-scoring model
```

## Model-Struggle Memory

Alongside the (positive) outcome-driven `outcomeBias`, the router keeps a
**persistent, task-signature-keyed de-weight** for models that repeatedly
under-perform on a *kind* of task. This counters the "drift to a weak/cheap/local
model" failure: the `cheapness × 14` budget weight in cheap/auto mode otherwise
dwarfs every learned bias, so a cheap model that keeps failing keeps winning.

- **Signals** (recorded by `Orchestrator.noteModelStruggle`): `timeout`, `empty`
  completion, `tool-call-as-text` (plain text where a structured `tool_calls`
  response was required), `error-finish`, and `user-correction` (a follow-up turn
  disputing the previous answer, attributed best-effort to the previous top-level
  turn's model). Billing/deprecation failures are excluded.
- **Task signature**: `phase | modality | reasoning | requiresTools` — low
  cardinality, so a model is de-weighted only for the task kind it actually fails.
- **Magnitude & decay**: each struggle folds a severity-weighted increment onto
  the model's *decayed* penalty (capped at `STRUGGLE_PENALTY_MAX`). The penalty is
  subtracted in `scoreModel` (a marginal de-weight that breaks near-ties); once it
  crosses `STRUGGLE_TIER_ESCAPE_THRESHOLD`, the **tier-escape** above lets a
  capable model win. Penalties decay with a ~2.5-day half-life and a clean turn
  halves them (`recoverModelStruggle`), so transient glitches fade while genuinely
  weak models stay de-weighted across sessions.
- **Gate & persistence**: disabled when `feedbackRoutingWeight = 0` (the same
  learned-routing control as `outcomeBias`). Snapshotted via
  `getStruggleSignals`/`setStruggleSignals` and persisted in `globalState` under
  `atlasmind.modelStruggleSignals` (machine-level — reliability is a property of
  the model, not the project). Active de-weights are surfaced as a "de-weighted"
  badge in the **Compare Models** panel (`getStruggleSummary`).

## Data Privacy trusted-model gate

When a project Data Privacy policy is enabled (`project_memory/operations/data-privacy.json`), the Orchestrator classifies the assembled context (memory, live evidence, attached/workstation context, and evidence file paths) **before** model selection.

The gate scans the assembled **context**, not the user's request — a hit means "something in the retrieved haystack looked regulated", not "this task is about personal data". The response is therefore tiered by the match's `sensitivity`:

1. **`secret`** (PCI-DSS cardholder data, HIPAA PHI) — **hard gate**. `RoutingConstraints.requireTrustedModel` is set and the agent's candidate `allowedModels` are intersected with the policy's **trusted** model IDs, so step 4 of the selection algorithm can only choose a user-selected model. This flows through all failover/escalation paths because the gated allow-list is applied to the working `agent` object.
2. **`confidential` / `proprietary`** (GDPR, CCPA, and custom rules at those levels) — **advisory**. Routing is left to the router and the redaction boundary removes the matched spans for whichever model is chosen. Nothing leaks either way: the task keeps its normal model and loses the matched spans, instead of being silently downgraded because one heuristic detector fired somewhere in a large context bundle.
3. If a `secret` match has no trusted model available, routing is left unchanged and the **redaction fail-safe** takes over: `buildMessages()` replaces classified spans with `[CONFIDENTIAL]` for the actually-selected model, and the user is notified (with a shortcut to the Project Dashboard → Privacy page) so they can assign one.
4. Confidential **file reads** surfaced mid-task are gated independently: a `file-read` tool result whose path matches a `path` rule is withheld from an un-trusted model.

The tier rule is the exported pure helper `selectHardGatingMatches()`. Progress notices name both the detector and the context slice it fired in (`"email address in memory \"Stakeholders\""`), so a false positive is diagnosable rather than an unexplained model change.

Deny-by-default: an empty trusted list trusts nothing. See [DataPrivacyManager](architecture.md#dataprivacymanager-srccoredataprivacymanagerts). Detector packs for GDPR/HIPAA/PCI-DSS/CCPA/Financial are heuristic aids, not a compliance certification.

Notes:
- Budget mode is now a pre-scoring gate, not only a weight.
- Speed mode is now a pre-scoring gate, not only a weight.
- `taskFit` boosts models whose capabilities match the inferred modality and reasoning needs using a graduated `reasoningDepth` scale (0–3) rather than binary reward/penalty cliffs. Context-window penalties use smooth linear interpolation rather than binary thresholds.
- `classifySpeedTier` consults `latencyClass` first; the legacy context-window heuristic is only a fallback for unannotated models.
- Models whose `deprecatedAt` date is in the past are excluded before scoring.
- Stale failure records (older than `MODEL_FAILURE_TTL_MS` = 5 min) are cleared automatically so transient errors don't permanently suppress providers.
- Subscription models pass the `balanced` budget gate only when `premiumRequestMultiplier ≤ 2`; high-premium models (Opus-tier, 3×) are excluded from `balanced` mode to avoid silent credit over-spend.
- Under `auto` budget with a high-reasoning task, all price tiers (including cheap) remain candidates; scoring penalises models with low `reasoningDepth` instead of hard-gating them out, so capable local reasoners (e.g. DeepSeek R1) can win when they outscore cloud alternatives.
- Cheapness is intentionally normalized so free or subscription-backed models stay attractive without automatically overruling stronger reasoning and task-fit signals in balanced routing. An additional bounded zero-marginal-cost adequacy bonus lets a real local model or active subscription win an ordinary near-tie over pay-per-token capacity; on review, planning, or synthesis it applies only when the candidate has sufficient reasoning depth. `cheap` mode still gives effective cost a much stronger score multiplier inside its eligible pool.
- `fast` mode likewise gives speed a much stronger score multiplier after the fast-tier gate has been applied.
- `feedbackBias` is intentionally capped and smoothed so a few votes can nudge future routing without overpowering hard gates or the core budget/speed/task-fit score.
- `atlasmind.feedbackRoutingWeight` scales that bounded `feedbackBias` multiplier without changing the stored vote history. Setting it to `0` disables feedback-weighted routing while preserving dashboard analytics and transcript votes.
- `requiredCapabilities` still acts as a hard gate before scoring.
- Provider health is refreshed during model catalog refresh and unhealthy providers are excluded from normal selection.
- Provider and model enabled state can be changed from the Models sidebar; those toggles are persisted in extension storage and reapplied after catalog refresh.
- Providers without credentials stay visible in the Models sidebar, but their child model rows remain hidden until the provider is configured.
- If there are no candidates under the current budget or speed gates, AtlasMind first retries with fully permissive routing gates.
- For terse command-style tool requests, AtlasMind also tries the local provider first when it has a real function-calling model available, then falls back to normal cross-provider scoring if local cannot satisfy the request.
- If tools were only implicitly available and still no real provider matches, AtlasMind retries the turn in text-only mode.
- Only after those retries fail does the router fall back to `local/echo-1`.

When a tool round returns only failures, denials, validation errors, or no-op responses, AtlasMind now treats those tool results as authoritative and surfaces the failed tool summary instead of accepting a contradictory success narration from the model.

### Catalog Refresh And Health

Atlas now refreshes provider model catalogs at startup and when the user clicks
**Refresh Model Metadata** in the Model Providers panel or the inline refresh action on a configured provider row in the Models tree.

- For providers that implement `discoverModels()`, discovered metadata (context window,
  capabilities, pricing) is merged directly into the router catalog.
- For providers that only implement `listModels()`, newly discovered model IDs are
  enriched via the well-known model catalog and heuristic fallbacks.
- Existing curated model metadata (known pricing/capabilities) is preserved.
- Discovery hints can override static entries — e.g. a real `maxInputTokens` from the
  Copilot LM API replaces a hardcoded context window estimate.
- Specialist domain tags are merged the same way, so research-, voice-, and visual-analysis-aware provider preferences can update automatically when the live catalog changes.
- Each refresh also runs `healthCheck()` and records provider health for routing decisions.
- The orchestrator can perform bounded provider failover when a request still fails after retry handling, so provider health is not just advisory metadata.
- Persisted disabled providers/models are reapplied after refresh so manual sidebar choices are not lost when discovery updates the catalog.
- If discovery fails for a provider, Atlas keeps the existing static catalog for that provider.
- Saving fresh credentials for API-key-backed providers now triggers an immediate forced catalog refresh before the health pass, so newly available models appear as soon as setup succeeds.
- When billing or auth failures auto-pause providers, the Models view exposes a dismiss action that clears the session badge without silently re-enabling the paused providers.

### Cross-Provider Selection

`@atlas` chat and `/project` flows no longer force a fixed preferred provider.
Unless explicitly constrained by an agent/model whitelist, model selection now
runs across all enabled providers and chooses the best-scoring candidate for the
current budget/speed settings and inferred task profile.
```

## Supported Providers

| Provider | ID | Discovery source | Notes |
|---|---|---|---|
| Anthropic (Claude) | `anthropic` | Runtime discovery via adapter `discoverModels()` / `listModels()` | Seeded with one fallback model until refresh completes |
| ACP Agents (subscription/license) | `acp` | User-authored agent list (`atlasmind.acp.agents`); models are `acp/<id>` | Drives any Agent Client Protocol agent (`claude-agent-acp`, `codex-acp`, `gemini --acp`, `copilot --acp`, `qwen --acp`, …) over JSON-RPC on stdio, reusing that vendor's subscription or eligible product license. Unlike the argv-based CLI bridge it replaced it **streams**, has **no ~26,000-character prompt ceiling** (prompts travel over stdio, not argv), and sends **images** when the agent declares `promptCapabilities.image`. A completion source by default. With `atlasmind.acp.toolsEnabled`, its declared `delegatedToolExecution` capability may satisfy a tool-backed route: the Orchestrator sends no AtlasMind schemas and authorizes only that exact provider request, the agent uses its own tools, and readable permission requests are automatically answered once and logged. The adapter requires capability, live setting, and request authority; ordinary completions remain isolated. `allow_always` is never selected and a missing gate denies. Declares `vision` once a handshake reports image support, and never claims `function_calling`. Seeded disabled; AtlasMind never installs an agent unattended. See [ACP agents](#acp-agents) below for the launch, authentication and usage details |
| OpenAI | `openai` | Runtime discovery via `/models` through the OpenAI-compatible adapter | Seeded with one fallback model until refresh completes |
| Google (Gemini) | `google` | Runtime discovery via AI Studio OpenAI-compatible `/models` endpoint | Seeded with one fallback model until refresh completes |
| Azure OpenAI | `azure` | Deployment list comes from `atlasmind.azureOpenAiDeployments`; execution uses a resource-specific Azure endpoint with `api-key` auth | Starts empty until you configure an endpoint and at least one deployment |
| Mistral | `mistral` | Runtime discovery via `/models` through the OpenAI-compatible adapter | Seeded with one fallback model until refresh completes |
| DeepSeek | `deepseek` | Runtime discovery via `/models` through the OpenAI-compatible adapter | Seeded with one fallback model until refresh completes; live discovery currently exposes `deepseek-chat` and `deepseek-reasoner` with 128K context windows |
| z.ai (GLM) | `zai` | Runtime discovery via `/models` through the OpenAI-compatible adapter | Seeded with one fallback model until refresh completes |
| Amazon Bedrock | `bedrock` | Configured model IDs come from `atlasmind.bedrock.modelIds`; execution uses an AWS SigV4-signed Bedrock Converse request with the raw model ID preserved in the canonical request path | Starts empty until you configure region, model IDs, and AWS credentials |
| xAI (Grok) | `xai` | Runtime discovery via `/models` through the OpenAI-compatible adapter | Seeded with Grok 4 until refresh completes |
| Cohere | `cohere` | Runtime discovery via Cohere's OpenAI-compatibility `/models` endpoint | Seeded with Command A until refresh completes |
| Perplexity | `perplexity` | Static model catalog via adapter config because the upstream chat endpoint does not expose a standard `/models` inventory | Seeded with Sonar and refreshed from the adapter's static catalog |
| Hugging Face Inference | `huggingface` | Runtime discovery via the Hugging Face router OpenAI-compatible `/models` endpoint | Seeded with one fallback router model until refresh completes |
| NVIDIA NIM | `nvidia` | Runtime discovery via NVIDIA's OpenAI-compatible `/models` endpoint, enriched by a provider-scoped Nemotron catalog | Seeded with Nemotron Super 49B, Nemotron Nano, and a Llama 3.1 70B fallback until refresh completes |
| Local LLM | `local` | Static fallback adapter or runtime discovery via a configured local OpenAI-compatible `/models` endpoint | Falls back to `local/echo-1` until a local endpoint is configured, and remains health-checkable via the built-in echo fallback |
| VS Code Copilot | `copilot` | Runtime discovery from VS Code Language Model API | Seeded with `copilot/default`; live discovery is deferred until the user explicitly activates Copilot so AtlasMind does not trigger a permission prompt during startup |

The provider table above describes **where Atlas gets the live catalog**, not an exhaustive static list of models. For API-backed providers, the visible catalog is refreshed at startup and when the user clicks **Refresh Model Metadata** in the Model Providers panel.

For Copilot specifically, AtlasMind now merges the VS Code LM entries exposed through both the `copilot` and GitHub-backed vendor aliases, and it re-queries them whenever VS Code raises a chat-model change event. If a preview model is still absent after refresh, that usually means the model is being used internally by Copilot chat but is not currently exposed to extensions through the public language-model API.

During refresh, AtlasMind normalizes upstream model IDs into its internal `provider/model` form before routing. This matters for providers such as Google Gemini whose OpenAI-compatible `/models` payloads can return raw IDs like `models/gemini-2.5-pro`; AtlasMind stores and executes those as `google/gemini-2.5-pro` so provider selection, failover, and telemetry stay aligned.

AtlasMind now refreshes all enabled providers during startup, including GitHub Copilot, so the routing pool is built from the current live model catalogs instead of a partially deferred provider set.

Provider failover now stays inside the candidate set that still satisfies the task's routing constraints. If a workspace-debug or tool-required request runs out of models that support the needed capabilities, AtlasMind fails the request explicitly instead of silently dropping to the built-in `local/echo-1` text fallback.

When a routed model fails during execution, AtlasMind marks that model as failed for the current session, removes it from future candidate selection, increments a per-model failure counter, and shows a warning state in the Models sidebar. A successful provider refresh clears transient failures; provider-confirmed removal/deprecation tombstones remain excluded for the session and are filtered out even if stale discovery lists them again.

## ACP agents

The `acp` provider drives a coding agent over the [Agent Client Protocol](https://agentclientprotocol.com) — JSON-RPC 2.0 over a subprocess's stdio — so a subscription or eligible product license you already pay for becomes capacity the router can select. Four things about it are easy to get wrong, and each one was got wrong at some point before v0.209.0.

### Launch commands come from the registry, transcribed by hand

`VERIFIED_ACP_AGENTS` in `src/providers/acp.ts` is the single list of agents AtlasMind will name, and every install command is **derived from it**. Each entry was read from the [ACP registry](https://github.com/agentclientprotocol/registry)'s own `agent.json` at the version pinned in `ACP_SPEC_VERIFIED_AT`.

| Agent | Command | npm package |
|---|---|---|
| Claude Agent | `claude-agent-acp` | `@agentclientprotocol/claude-agent-acp` |
| Codex | `codex-acp` | `@agentclientprotocol/codex-acp` |
| Gemini CLI | `gemini --acp` | `@google/gemini-cli` |
| GitHub Copilot CLI | `copilot --acp` | `@github/copilot` |
| Qwen Code | `qwen --acp` | `@qwen-code/qwen-code` |

The registry proves that `gemini --acp` is a launch command; it does **not**
prove that every Gemini plan may use it. [Since 18 June
2026](https://docs.cloud.google.com/gemini/docs/codeassist/set-up-gemini), Gemini
CLI serves only assigned Gemini Code Assist Standard or Enterprise licenses and
separately metered Google Cloud/API-backed access—not free individual or
personal Google AI Pro and Ultra accounts. Gemini Enterprise Standard and Plus include Code Assist
Standard after a separate assignment; Business and Frontline do not. AtlasMind
therefore carries this eligibility note with the verified agent into the
provider-card tooltip, picker, `/acp` guide, sign-in step, and a confirmation
shown before install or probe. A published executable must never be presented
as an account entitlement. AtlasMind does not present the CLI's metered modes as
subscription capacity; use the direct Google provider so token costs remain
attributable.

Two rules hold here:

- **The package and the command are one fact, not two.** A second copy is what let AtlasMind advise `npm install -g @zed-industries/claude-code-acp` while spawning `claude-agent-acp` — that package's `bin` is `claude-code-acp`, so following the instructions produced a binary AtlasMind then could not find. A test asserts every command against the package that really provides it.
- **`args` travels with the command.** `gemini`, `copilot` and `qwen` are ordinary interactive CLIs until the ACP flag is passed. Registering one without its flag launches a REPL that never speaks JSON-RPC and times the handshake out with nothing to explain why.

The registry is **not** fetched at runtime. A launch command that arrives over the network and is then spawned is remote code execution with extra steps.

`SELF_INSTALLED_ACP_AGENTS` records goose (`goose acp`), OpenCode (`opencode acp`), Cursor (`cursor-agent acp`) and Kimi CLI (`kimi acp`). These ship as platform archives, which AtlasMind will not download or unpack, so they have no install recipe — the command is recorded so it is discoverable, and the installer honestly reports `manual`.

### Windows cannot spawn an npm `bin` directly

Every published adapter above is an npm `bin`, and on Windows npm installs a `bin` as three sibling shims — an extensionless shell script, a `.cmd`, and a `.ps1`. None is an executable image, so `spawn(command, args, { shell: false })` fails with `ENOENT` for a completely correct global install. Resolving to the `.cmd` does not help: Node has refused to spawn `.cmd`/`.bat` without `shell: true` since the fix for CVE-2024-27980, and a shell is precisely what `shell: false` exists to avoid.

`src/providers/acpLaunch.ts` therefore **bypasses** the shim. It reads the owning package's `package.json` `bin` field — a contract the package author declared, rather than npm's generated scripts — and spawns Node against the entry point it names. This also handles the case where the names do not match at all: `gemini` lives in `@google/gemini-cli`. A real `.exe` is spawned directly, and POSIX is untouched because the shim there is executable.

### `authMethods` is an advertisement, not a verdict

The `initialize` response's `authMethods` lists the logins an agent *offers*. It says nothing about whether the current user still owes one. `codex-acp` advertises `api-key` and `chat-gpt` on every handshake, signed in or not — so treating a non-empty list as "not authenticated" refuses every working ChatGPT subscription.

The spec's real signal is the reserved error code **`-32000` (authentication required)** returned by the gated request. AtlasMind's probe therefore attempts `session/new` and reports:

| Outcome | Meaning |
|---|---|
| session created | signed in and usable |
| `-32000` | not signed in; AtlasMind names the published sign-in command for that agent |
| any other error | the agent is broken, reported as such rather than as a login problem |

The probe is TTL-cached, so the extra round-trip is paid rarely, and it buys a stronger claim: that the agent *can be used*, not merely that it started.

### The launch command is not the sign-in command

`-32000` used to produce "run it once in a terminal and complete its own login", which names nothing. The command on screen at that moment is the *launch* command, and following that inference does not work for any of the five published agents: `gemini --acp`, `copilot --acp` and `qwen --acp` each start a JSON-RPC server that will never show a login prompt, and `claude-agent-acp` does not hold the Claude credential at all — it drives the Claude CLI.

So the two facts are separate, and the second is read from each vendor's own documentation rather than derived from the first. `ACP_SIGN_IN` in `src/providers/acp.ts` records it, keyed on the **launch command** (an agent id is a label the user chose; the binary is what has a login), with `ACP_SIGN_IN_VERIFIED_AT` recording when each was last checked:

| Launch command | Sign in with | Then |
|---|---|---|
| `claude-agent-acp` | `claude` | `/login` if Claude Code does not prompt. The adapter uses the Claude CLI's credentials |
| `codex-acp` | `codex login` | Browser flow; `codex login --device-auth` where no browser is available |
| `gemini --acp` | `gemini` | Choose **Sign in with Google**, or `/auth`; requires an assigned Gemini Code Assist Standard/Enterprise license |
| `copilot --acp` | `copilot` | `/login` |
| `qwen --acp` | `qwen` | `/auth`, then a provider — Qwen OAuth's free tier ended 15 April 2026 |

`acpSignInFor(command)` returns `undefined` for anything else, and every surface renders that as an answer: the message says AtlasMind has no recorded flow for this agent instead of printing `<command> login`. Any agent that speaks ACP can be named in `atlasmind.acp.agents`, so a guess here would be a confident instruction nobody verified, typed into a terminal.

AtlasMind never completes the sign-in. `atlasmind.setup.prepareCommand` opens a terminal and **types** the verified command without submitting it; pressing Enter, and everything the browser asks for afterwards, stays with the user. The payload is checked against `ACP_SIGN_IN_COMMANDS` at the handler, because the command id is reachable from a webview.

**A session is far more expensive than a handshake, and the TTL is sized for that.** `session/new` on a coding agent starts the agent's whole runtime, not a lightweight object: measured on Windows, `claude-agent-acp` launches the user's entire configured MCP fleet inside the session (a GitKraken CLI, an `npx @azure/mcp` tree, a `contrast-checker-mcp` tree, several via `cmd.exe`) and `codex-acp` starts an `app-server` plus a REPL host. Each `cmd.exe` causes Windows to allocate a `conhost.exe` — a console window that flashes on screen.

The ordinary launch path still uses `windowsHide: true, shell: false`, but `windowsHide` governs only the process AtlasMind starts; it does not propagate to grandchildren. Two independent controls now address that:

- **Frequency:** the routed adapter keeps a successful ACP conversation alive for 30 idle minutes instead of throwing the process tree away after every answer. `ACP_PROBE_TTL_MS` remains **five minutes**, not the ten seconds it was when the cost was assumed to be a handshake — with a dozen provider-refresh call sites, a short TTL relaunched the whole tree repeatedly. Concurrent requests for the same probe are also single-flighted, so activation, a tree render and an open provider panel cannot launch three process trees before the first one reaches the cache. The cache key includes the Windows launch mode. The staleness that remains is on "is this agent signed in?", which changes on the order of days; `resetAcpProbeCache()` bypasses it for an explicit refresh.
- **Visibility and lifetime, when explicitly selected on Windows:** `atlasmind.acp.hideConsoleWindows` wraps the resolved executable with the bundled `media/bin/atlasmind-acp-private-desktop.exe`. The Rust helper creates an OS-named, non-interactive window station with the creator token's default ACL and the documented non-interactive station/desktop access sets, creates its `Default` desktop, then starts the real agent **suspended** with `STARTUPINFO.lpDesktop = NULL` so it inherits that established connection. `CREATE_NEW_CONSOLE` plus `STARTF_USESHOWWINDOW`/`SW_HIDE` creates one non-visible console at this senior parent boundary; ordinary console descendants inherit it, so a later native CLI or PowerShell does not allocate its own visible `conhost.exe`. This replaces `CREATE_NO_WINDOW`, which affected only the direct child and deliberately left it with no console to pass down. A `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` still restricts inherited handles to stdin/stdout/stderr. The helper assigns the root to a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` before resuming it and sets inherited error-mode flags so a loader failure terminates the process rather than blocking Chat behind a modal system dialog. Windows permits UI and input only on `WinSta0`; a descendant that passes an empty desktop remains connected to the non-interactive station. Closing the helper's job handle also provides a whole-tree lifetime boundary. Npm-backed agents are launched by a real PATH-resolved `node.exe`; `Code.exe` is never accepted as the JavaScript runtime.

The non-interactive station is an informed opt-in, never a silent default. The setting schema's default `false` does not count as consent: on Windows, setup, activation-time discovery, provider checks and routed turns will not spawn ACP until either a workspace or user value records the choice. AtlasMind never switches to or remotely controls the station, uses no shell, requests the published non-interactive UI-object access sets rather than generic all-access rights, applies the current token's default ACL, pins the shipped helper's SHA-256 in TypeScript, and refuses to launch if it is missing or changed. The process still has the user's filesystem/network authority, and application control or EDR may block the unsigned helper. No automatic visible fallback follows a block. While a routed private-mode session is alive, the VS Code status bar reports its count and links to **Models & Providers**; that is local disclosure, not a sandbox claim.

Other approaches remain possible, but solve different layers:

- **Use a truly windowless console on Windows 11 24H2.** [`AllocConsoleWithOptions`](https://learn.microsoft.com/en-us/windows/console/allocconsolewithoptions) with `ALLOC_CONSOLE_MODE_NO_WINDOW` could replace the hidden inherited console on newer systems. It is not the compatibility baseline: the API requires build 26100 / Server 2025, a child can explicitly detach or request a new console, GUI windows still need the non-interactive-station boundary, and console attachment can change TTY/stdio behaviour.
- **Fix every ACP agent upstream.** Each vendor could use Windows-native process creation with `CREATE_NO_WINDOW` (or the same no-window allocation API when it genuinely needs console services) and carry that policy into every child it starts. This has the cleanest ownership and signing story, but AtlasMind cannot enforce discipline inside independently released agents, package-manager shims and MCP servers.
- **Run the agent logic in the extension host.** Rewriting each adapter against an in-process SDK removes the console boundary, but couples AtlasMind to vendor internals and lets a native crash or dependency conflict take down the extension host. It also stops being a generic ACP client.
- **Use a service, WSL, container or remote sidecar.** Moving the process tree out of the interactive Windows session prevents desktop windows, but adds installation/elevation, filesystem mapping, credential transport, lifecycle and update responsibilities disproportionate to a local stdio protocol. A Windows service also moves the process into non-interactive session 0, which complicates user-scoped subscription authentication and any browser login.
- **Use ConPTY.** A pseudoconsole is useful for interactive terminal programs, not newline-delimited ACP JSON-RPC: it introduces terminal echo, resizing and VT semantics while still leaving descendants free to create their own consoles.
- **Use a Windows Job Object for cleanup, not visibility.** The current launcher does this: it assigns the suspended root before it can spawn descendants and sets `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. The Job Object does not suppress windows by itself; it complements the non-interactive station and hidden-window flags rather than replacing them.

The long-term preference is upstream console-free process discipline. Session reuse reduces how often the problem occurs today; the disclosed non-interactive station is the local compatibility option for agents whose descendants AtlasMind does not control.

The probe also sends **`session/close`** before stopping the process, when the agent advertises `sessionCapabilities.close`, so the agent can reap its own tree. That close is best-effort and separately timed out. On Windows AtlasMind starts the tree-wide `taskkill /T /F` backstop while the root process still exists, preserving the ancestry Windows needs to find descendants; direct root termination is only the fallback if that tree kill cannot start or fails. Private-desktop launches add the stronger Job Object boundary described above.

#### A live session never receives the same transcript twice

Reusing the process is easy; reusing its conversation safely is the feature. ACP sessions remember their own prompts and answers. Sending AtlasMind's full chat history on turn two would therefore duplicate turn one in the remote context and can make the agent answer or act twice.

AtlasMind records the exact outer transcript after each successful prompt. On the next request that recorded transcript must be an exact prefix of the request; only the unseen suffix is encoded as ACP content blocks. A changed system instruction, edited earlier message, or chat branch does not get reconciled heuristically — it receives another session. Reuse is also invalidated by agent command/argv, cwd, model or effort, MCP list, completion-only isolation, Windows launch mode, startup instruction/settings-file stamp, agent exit, or 30 minutes idle. At most four live conversations are held by one extension host; the oldest idle one is closed before a fifth is admitted.

Duplicate calls have a second guard. The orchestrator stamps each tool round with a stable task identity; concurrent calls carrying that identity join one in-flight promise and stream, and a retry with the same identity arriving within 15 seconds of success receives the recorded result. Two independent chats with identical words have different identities and are not coalesced. The key also includes the agent/configuration execution epoch, so changing launch/settings state does not replay an old result. ACP bypasses the generic transient-provider retry loop entirely: after `session/prompt` may have crossed stdio, uncertainty is treated as "possibly spent" and the session is discarded. The orchestrator's outer deadline is wired into that attempt as an abort signal, so timing out sends `session/cancel` and tears down the uncertain session rather than allowing it to continue behind a fallback answer. The next *new* user turn may start another session; the uncertain prompt itself is not sent again.

#### Isolating a completion-only session

A session that exists only to produce text does not need the machine's agent settings — and loading them is what starts the user's whole MCP fleet inside it. `buildSessionNewRequest` therefore sends `_meta.claudeCode.options.settingSources = []` unless delegated execution is authorized by both the global setting and the individual provider request:

- **Setting eligibility is not turn authority.** An enabled agent can use built-in tools with an empty `acp.mcpServers` allowlist, so MCP count cannot answer whether it may act. The routed adapter reads `acp.toolsEnabled` live, and then requires `CompletionRequest.allowDelegatedToolExecution === true` from the Orchestrator for that exact turn. Omitted or false stays completion-only even when the checkbox is on.
- **Completion-only means no delegated surface.** The adapter passes no configured MCP servers and wires no ACP permission policy for an unauthorized request. A native permission request therefore fails closed instead of borrowing authority from a previous or global choice.
- **Never sent when delegated execution is on.** Setting sources carry the project's `CLAUDE.md`, permission defaults and custom subagents. Withholding those from an agent that may act removes context it needs; withholding them from one that can only write text removes nothing.
- **Changing setting or request authority changes the session identity.** A completion-only session cannot be reused for an acting turn, or vice versa, even when both have empty MCP lists. The completed-result ledger includes the same isolation epoch so a reply produced under different authority cannot be replayed.
- **A vendor extension, not the spec.** `_meta` is ACP's extensibility field; this key is Anthropic's, read out of the installed build rather than a published contract. It carries `ACP_CLAUDE_META_VERIFIED_VERSION` rather than riding on `ACP_SPEC_VERIFIED_AT`, and degrades safely both ways — an agent that ignores it behaves as before, and `codex-acp` accepts the unknown key without error.

Measured effect on Windows: 19 descendant processes → 3, six console windows → two. It does **not** make anything faster (`session/new` is ~9.5s either way — that is Claude Code booting, not the MCP servers), and it does not reach zero windows; the remainder belong to `claude.exe`.

### Token counts come off the prompt result

Two different things are reported, and conflating them made every ACP completion look free:

- **`usage_update`** (a `session/update` notification) carries `{ used, size, cost? }` — the *cumulative* context token count and the context-window size. It is a progress bar, not a bill, and is never charged as input tokens; doing so would re-bill the whole conversation on every message.
- **The `session/prompt` result** carries `usage.inputTokens` / `usage.outputTokens` for the turn. This field is not in the published `PromptResponse` schema, but it is the only place a real per-turn count appears and every current agent sends it in the same shape. Absent or unusable counts report **zero** rather than an estimate, and nothing is derived from `totalTokens` — splitting a total into input and output would be arithmetic nobody measured.

Because ACP models are subscription-backed, they are priced at zero per token; the router's subscription handling, not the adapter, is what stops that from winning budget mode by default. ACP itself does **not** disclose an account tier or remaining allowance, so its plan label is display-only and never participates in quota gating or usage accounting.

### Subscription capacity is advanced over metered tokens

Subscription providers are preferred over pay-per-token for ordinary work, because the capacity is already bought. The preference keys on the provider's `pricingModel`, never on a list of provider ids, so a new subscription provider inherits it without being enumerated anywhere. Only a provider that exposes an **authoritative** allowance, such as Copilot, receives quota-specific treatment:

- `ACTIVE_SUBSCRIPTION_BONUS` (+0.3) on every turn where the plan has quota left. Modest by design: it breaks ties toward the subscription without overriding a capability need, and it vanishes once the quota is spent, at which point the provider is effectively pay-per-token.
- On **maintenance** turns the gap widens — a subscription bonus paired with a penalty for pay-per-token — so background housekeeping never burns metered tokens.

Prompt-caching discounts are keyed per provider and ACP is absent from those lists, which is correct rather than an omission: they reduce *metered* input pricing, and a subscription model is priced at zero per token.

**ACP is deliberately unmetered by AtlasMind.** The installed agent can report its identity, models, effort options, and prompt token counts; ACP has no standard subscription-tier or balance field. A manually entered count cannot stay truthful as plans, limits, promotions, and shared account use change, so AtlasMind does not create a quota for `acp` or `acp/<agent>`. A configured plan label is purely a reminder of the subscription behind that agent.

### Which model, not just how hard it thinks

The same `configOptions` array carries a `model` category, and it was being parsed and discarded. `codex-acp` offers `gpt-5.6-luna` / `gpt-5.6-terra` / `gpt-5.6-sol`; `claude-agent-acp` offers `opus[1m]` / `sonnet` / `haiku` / … . So a plan presented to the router as one model at N effort levels when it is really M models at N effort levels, and the orchestrator could never send a throwaway rename to the light model and a refactor to the deep one.

**The model list is detected, never declared.** Nothing in `acpModels.ts` names a model that must exist. Vendors ship models faster than AtlasMind ships releases, so a hardcoded roster would be wrong within weeks and wrong in the worst direction — a model you are paying for, invisible to the router. Whatever the installed agent offers today is what appears.

**What cannot be detected is a model's standing.** The wire format carries `value`, `name` and `description` — no capability field, no ordering guarantee. Where a model sits relative to its siblings is therefore assigned by a declared rule, in precedence order:

1. **`atlasmind.acp.modelStanding`** — what you declared, keyed on the display name or the wire value.
2. **A short table of naming conventions** this build is willing to stand behind (Anthropic's Haiku / Sonnet / Opus tiering). Deliberately short: every entry is a claim about a vendor's lineup, and a wrong one misroutes every turn. Generic words like `pro`, `max` and `turbo` are absent — they mean opposite things across vendors, and `max` also names an effort level.
3. **Keywords in the agent's own description** of that model. Weaker than a convention, because marketing copy is not a specification — but it is the vendor describing this exact model, which beats anything this file could infer about a name it has never seen.

Every choice records which rule decided, published as `ACP_MODEL_RULE_NOTE` on the provider card, the same convention the tech-debt register uses.

**Unknown standing is routable, never dropped.** This inverts `acpEffortTiersFor`, which drops effort values it does not recognise, and the difference is deliberate: an unrecognised *effort* value has no depth or cost the router can reason about, so a row for it would be unscoreable, while an unrecognised *model* is a real working model whose only unknown is its rank. Dropping it would hide capacity you pay for — and hide it precisely for the newest model, the one most likely to be worth using. It routes, it is selectable, it simply carries no `reasoningDepth` and a neutral multiplier, so it is never *preferred* on a number nobody stands behind.

At the time of writing, `luna` / `terra` / `sol` fall through to unknown. They sit in an obvious size order if you read them as moon/earth/sun — but that is etymology, not a vendor statement, and a wrong ranking sends a refactor to the small model without anybody finding out. Declare them in `atlasmind.acp.modelStanding` and the router uses them fully.

**Model and effort compose into one routed id** — `acp/claude@opus#high` — because both are knobs on the same session and the combination is what a subscription user actually wants. Two declared rules govern the composition: **depth is the greater of the two** (a light model cannot be made deep by asking harder; a deep model at low effort is still the deep model), and **cost multiplies** (both spend the plan). Rows are capped per agent and ordered so truncation costs every effort before it costs any model — a long lineup still exposes every model.

On the execute path the model is set **before** the effort. Against an agent that resets dependent knobs when the model changes, the other order would silently discard the effort — the same looks-like-success failure the category rule exists to prevent. A model that cannot be applied does not fail the turn, and is reported on the same channel as a failed effort, for the same reason: the router priced the turn as that model.

### Effort is a routed model, set through `session/set_config_option`

**There is no `session/set_model` in ACP v1.** The spec's session-setup page notes that a `session/new` response *MAY* carry model or configuration state, and the mechanism for changing it is `session/set_config_option` — verified against the published schema at `ACP_SPEC_VERIFIED_AT` and against live `codex-acp` 1.1.7 and `claude-agent-acp` 0.63.0, both of which implement it and echo the full option set back.

`session/new` returns `configOptions`. Both agents carry one whose **category** is `thought_level`:

| Agent | Option id | Values |
|---|---|---|
| `codex-acp` | `reasoning_effort` | `low` `medium` `high` `xhigh` `max` `ultra` |
| `claude-agent-acp` | `effort` | `default` `low` `medium` `high` `xhigh` `max` |

**The id differs; the category does not.** Matching on `id` would work against exactly one agent and silently no-op against the other — a failure indistinguishable from success, because the turn still completes, just at the wrong effort. `acpEffort.ts` therefore matches on `category` everywhere.

Each tier the agent lists becomes a routed model id with a `#` variant suffix — `acp/claude#high` — carrying:

- **`reasoningDepth`**, which the router's `scoreTaskFit` already uses, so a high-reasoning task prefers a higher tier without any ACP-specific scoring;
- **`premiumRequestMultiplier`**, which `matchesBudgetGate` already reads, so `cheap` (≤1) reaches `low`/`medium`, `balanced` (≤2) reaches `high`, and `auto`/`expensive` reach the top.

The un-suffixed row remains and means "the agent's own default" — it carries neither annotation, because asserting a depth for a setting nobody chose would be inventing one. Variants appear only **after** the agent has been probed, for the same reason `vision` does: `discoverModels` runs on every tree render and must not spawn.

`default` is deliberately not a tier — it is the base row, and emitting it as a variant would create a second model id meaning the same run.

#### What may be set, and what may never be

`ACP_SETTABLE_CONFIG_CATEGORIES` is an allowlist holding exactly `model` and `thought_level`. It is deny-by-default, and the refusal lives in `AcpSession.setConfigOption` — the one place a set request is built — rather than at each call site.

The reason is that the same `configOptions` array carries the agent's **permission** mode:

| Agent | Category `mode` includes |
|---|---|
| `codex-acp` | `read-only`, `agent`, **`agent-full-access`** |
| `claude-agent-acp` | `default`, `acceptEdits`, `plan`, **`bypassPermissions`** |

A config channel able to set those would route around `toolApprovalManager` rather than through it — a privilege escalation wearing the clothes of a routing optimisation. A test asserts no `mode` change and no value matching `bypass`/`full-access` is ever written to the wire.

`model_config` — Codex's "fast mode", described by the agent as *"1.5x speed, increased usage"* — is excluded for a different reason: spending more of the user's subscription is their decision.

#### Relative effort is a declared routing rule

No vendor publishes how a `max`-effort turn consumes an ACP subscription. The multipliers in `ACP_EFFORT_TIERS` are therefore **AtlasMind's own relative routing rule**, not a usage estimate or balance calculation. They make the effort gradient explainable without claiming to know what remains on the account.

#### Applied is confirmed, not assumed

`session/set_config_option` returns the full option set with the new `currentValue`, so an agent that accepts the request and ignores it is distinguishable from one that applied it. A tier that cannot be set does **not** fail the turn — a turn at the default effort produced an answer, and aborting over a knob would turn a degraded turn into no turn — but it is reported through `onEffortNotApplied` to the output channel because the routing preference used the requested effort while the agent used its default.

#### Variants and subscription labels

A variant is a different *effort*, not another subscription. `acp/claude#high` and `acp/claude` therefore display the same user-recorded plan label, but neither creates a quota or a balance decrement.

**Model *family* is deliberately not enumerated.** Codex advertises 7 families × 6 efforts = 33 `availableModels`; turning that cross product into routed rows would flood the tree with models the router has no basis to choose between. Effort is the axis it can reason about; family stays at the agent's own setting.

### Health is per agent, and a verdict requires having asked

`acp` is one provider id in front of *n* agents, which breaks two assumptions the rest of the provider machinery makes.

- **`healthCheck()` probes every configured agent, concurrently, and is healthy when any can be used.** It used to probe `agents[0]` and report that answer as the provider's — wrong in both directions once more than one agent is configured: a broken first agent condemned a working second one, and a working first agent vouched for a second that was never contacted. Order in a settings array is not a statement about which subscription matters.
- **Per-vendor surfaces read `peekAcpAgentProbe(agentId)`**, the last thing *that* agent said, rather than the provider-wide health flag. Otherwise the *Anthropic — Claude subscription* row reports whatever `codex-acp` said.
- **Never probed is not the same as probed and failing.** An agent with no recorded probe renders as `unverified` ("not checked yet"), not `unhealthy` ("agent not responding"). Announcing a failure for a process nobody spawned is the misreport this distinction exists to prevent — the same distinction `not-discovered` draws against `model-disabled`.

Two configuration properties follow from the probe being expensive:

- **ACP is "configured" when an agent is in `atlasmind.acp.agents`** — never by an API key. It is keyless by construction, so falling through to a secret lookup reported it unconfigured on every refresh, which skipped discovery *and* set provider health to false.
- **The enclosing discovery budget is derived from `ACP_PROBE_TIMEOUT_MS`, not restated.** An ACP probe spawns a process per agent and opens a session — roughly 9s for two agents on a warm machine, against a 10s per-provider startup budget whose expiry marks the provider unhealthy with nothing to re-probe afterwards. Two numbers in two files is exactly how they drifted past each other.

The long-lived routed adapter takes its agent list as a **getter**, not an array: it is constructed once at activation, so a snapshot left an agent added later invisible to routing until a window reload, while every throwaway adapter built per panel click already saw it.

## Specialist And Future Providers

The routed provider list above is specifically for chat-capable backends that AtlasMind can score and execute through the current `ProviderAdapter` abstraction.

The following provider names may still be important to the broader AtlasMind roadmap, but they are not treated as drop-in routed chat providers today:

| Provider | Why it is not in the routed provider table yet |
|---|---|
| Meta | Meta is primarily a model family and distribution ecosystem, not one stable first-party routed chat API endpoint |
| Ludus AI | Needs a verified public chat-model API contract before it can be wired into routing |
| Reka AI | Needs a verified current API contract and discovery/auth flow |
| EXA AI | Primarily a search/retrieval API, not a routed chat-model backend |
| Aleph Alpha | Needs a dedicated adapter and verified discovery/auth behavior |
| Stability AI | Primarily image and media generation workflows, not the generic chat-provider path |
| Runway | Primarily video/media generation workflows, not the generic chat-provider path |
| ElevenLabs | Primarily speech/audio workflows, not the generic chat-provider path |

### Seed Models vs. Live Catalog

`registerDefaultProviders()` intentionally registers **one minimal seed model for most providers** so routing can work before the first refresh finishes.

- Those seed entries are placeholders, not the intended long-term catalog.
- Azure OpenAI and Bedrock are exceptions because their routed model lists are workspace-specific and should stay empty until configured.
- `refreshProviderModelsCatalog()` runs on activation and on manual refresh.
- Activation skips interactive providers such as Copilot that would otherwise trigger a VS Code language-model permission prompt before the user explicitly asks for them.
- For providers that implement `discoverModels()`, Atlas uses the richer runtime metadata directly.
- For providers that only implement `listModels()`, Atlas discovers IDs first and then enriches them from the well-known catalog plus heuristics.
- If refresh fails, Atlas keeps the existing seeded/static entries instead of leaving the provider empty.

## Provider Adapter Interface

Every provider implements `ProviderAdapter` from `src/providers/adapter.ts`:

```typescript
interface ProviderAdapter {
  readonly providerId: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  listModels(): Promise<string[]>;
  discoverModels?(): Promise<DiscoveredModel[]>;
  healthCheck(): Promise<boolean>;
}
```

Adapters may also receive `ChatMessage.images` on user messages. Current multimodal forwarding support:

- `CopilotAdapter` converts images to `LanguageModelDataPart.image(...)`
- `AnthropicAdapter` emits image blocks with base64 sources
- `OpenAiCompatibleAdapter` emits `image_url` parts with `data:` URLs

Providers that implement the optional `discoverModels()` return `DiscoveredModel`
objects carrying partial metadata (context window, capabilities, pricing) that the
router merges with the well-known model catalog and heuristic fallbacks.

### Integration Contract For New Routed Providers

Adding a third-party model backend is intended to be routine, but only if the backend fits the routed-provider contract.

Use the routed provider path when the upstream service can support all of the following:

- Chat-style request and response semantics compatible with `ProviderAdapter.complete()`.
- Stable provider identity plus discoverable or configurable model inventory.
- Enough metadata for capability, health, and pricing-aware routing.
- A credential story that can stay inside SecretStorage in VS Code and, if applicable, environment variables in the CLI.

Contribution checklist:

1. Implement `ProviderAdapter` in `src/providers/`.
2. Register the provider through the shared runtime so extension and CLI hosts can opt in consistently.
3. Decide whether discovery is runtime (`discoverModels()` or `listModels()`) or workspace-configured.
4. Add configuration UI and secret handling where needed.
5. Add regression coverage for request-shape compatibility, failure handling, and routing behavior.
6. Update the docs and external integration monitoring manifest when the change introduces a new third-party surface.

If the upstream service is search, voice, image, video, or otherwise workflow-specific, it should stay on the specialist integration path rather than being forced into the routed provider table.

### Well-Known Model Catalog

`src/providers/modelCatalog.ts` contains a pattern-based catalog of verified model
specifications sourced from published provider documentation. Each entry can carry two
future-proofing annotations that decouple routing logic from fragile heuristics:

- **`reasoningDepth`** (0–3): numeric reasoning capability level. The router falls back to depth 2 for models that have the legacy `reasoning` capability tag but no explicit annotation, and depth 0 otherwise.
- **`latencyClass`** (`'fast' | 'balanced' | 'slow'`): explicit speed-tier override. When present it takes precedence over the context-window heuristic, preventing large-context-but-fast models from being misclassified as `'considered'`.

New models added to the catalog should set both fields so routing behavior is predictable from the catalog entry alone.

- **Anthropic**: Claude 3 Haiku → Claude Opus 4
- **OpenAI**: GPT-4o Mini → o3 / o4-mini / GPT-4.1 family
- **Azure OpenAI**: mirrors the OpenAI catalog for deployment-backed GPT family models
- **Google**: Gemini 1.5 Flash → Gemini 2.5 Pro
- **DeepSeek**: V3, R1
- **Mistral**: Small, Large, Codestral
- **Amazon Bedrock**: Claude via Bedrock, Llama via Bedrock, Amazon Nova
- **xAI**: Grok 4
- **Cohere**: Command A, Command R7B
- **Perplexity**: Sonar, Sonar Pro, Sonar Reasoning Pro, Sonar Deep Research
- **NVIDIA NIM**: Nemotron family — Llama 3.1 Nemotron Ultra 253B (extended reasoning), Llama 3.3 Nemotron Super 49B, Nemotron Nano, Llama 3.1 Nemotron 70B Instruct, Nemotron Mini — plus open models (e.g. Llama 3.x) served through NIM

The catalog is queried by `inferModelMetadata()` whenever a new model is
discovered at runtime.  Resolution order: runtime hint → catalog → heuristic.
It is **not** the primary source of model IDs; it enriches IDs discovered from providers.
The merge carries the catalog's authoritative **routing annotations** — `reasoningDepth`
and `latencyClass` — through to each `ModelInfo`, so discovery-populated models keep
their true reasoning depth (e.g. depth-3 reasoners are not collapsed to the heuristic
default) and latency tier for budget/speed gating and scoring.

Some routed providers intentionally mix discovery modes:

- Azure OpenAI uses the reusable OpenAI-compatible adapter with a workspace-configured base URL, deployment-specific chat path resolution, and raw `api-key` authentication.
- DeepSeek uses the same standard OpenAI-compatible adapter path, and AtlasMind now treats the live `deepseek-reasoner` route as tool-capable in addition to reasoning-capable based on observed API behavior.
- xAI, Cohere, Hugging Face Inference, and NVIDIA NIM use the reusable OpenAI-compatible adapter with provider-specific base URLs.
- Perplexity uses the same adapter but relies on a static configured model list because its chat endpoint does not expose a standard `/models` catalog.
- Amazon Bedrock uses a dedicated adapter because Bedrock requires SigV4 request signing, a canonical request path that preserves the configured raw model ID, and Bedrock-specific payload/response mapping.
- Providers with specialist auth or non-chat modalities stay out of the routed table until they have a dedicated adapter path.

AtlasMind now also reuses the same routed-provider layer from a Node CLI host. Host-neutral adapters (`anthropic`, `openai-compatible`, and the shared `local` adapter from `src/providers/registry.ts`) read credentials through a small secret abstraction: in VS Code that resolves to `SecretStorage`, and in the CLI it resolves from environment variables such as `ATLASMIND_PROVIDER_OPENAI_APIKEY`, `ATLASMIND_PROVIDER_ANTHROPIC_APIKEY`, `ATLASMIND_AZURE_OPENAI_ENDPOINT`, `ATLASMIND_AZURE_OPENAI_DEPLOYMENTS`, and `ATLASMIND_LOCAL_OPENAI_BASE_URL`., explicitly requests plain-text print-mode replies with tools disabled, strips embedded pseudo-tool XML from successful results, and now fails fast when the CLI returns a JSON envelope without assistant text. Copilot remains extension-only because it depends on the VS Code Language Model API, and Bedrock remains on the dedicated extension-host configuration path.

For **Copilot models**, the catalog searches _all_ provider catalogs since Copilot
surfaces upstream models (GPT-4o, Claude Sonnet 4, etc.) under its own namespace.

Copilot access is intentionally lazy: AtlasMind keeps the seeded `copilot/default` model registered for metadata purposes, but it defers runtime discovery and health checks until the user explicitly activates the Copilot provider from the Model Providers panel or otherwise requests Copilot-backed execution.

### Copilot Model Discovery

The `CopilotAdapter.discoverModels()` method leverages VS Code's Language Model API
to extract real metadata that other providers cannot expose through simple
`/models` endpoints:

| Property | Source | Used for |
|---|---|---|
| `id` | `LanguageModelChat.id` | Model identification and routing |
| `name` | `LanguageModelChat.name` | Display names in UI |
| `maxInputTokens` | `LanguageModelChat.maxInputTokens` | Real context window for routing |
| `family` | `LanguageModelChat.family` | Catalog lookup key |

The adapter also uses a multi-strategy `resolveModel()` for execution:
1. Exact ID match against available models
2. Family match (e.g. requested `gpt-4o` → model with `family: 'gpt-4o'`)
3. Substring match (e.g. `claude-sonnet-4` ⊂ versioned ID)
4. Fallback to first available model

## Cost Estimation

### Pricing Models

Each registered provider carries a `pricingModel` field:

| Pricing Model | Description | Examples |
|---|---|---|
| `subscription` | Tokens included in a subscription plan — effectively free to the user | GitHub Copilot, ACP Agents |
| `free` | No cost at all (local inference, free-tier APIs) | Local/Ollama |
| `pay-per-token` | Billed per token consumed via an API key | Anthropic, OpenAI, Google, Mistral, DeepSeek, z.ai |

#### How pricing affects routing

- **Effective cost**: Subscription and free providers still receive the strongest cheapness score when quota is ample, but the cheapness term is normalized so a free local model does not automatically beat a clearly better reasoning-capable model on a higher-stakes turn.
- **Role pin** (Direction 3): `RoutingConstraints.preferredModel` selects a specific model for a role, bypassing budget/speed gates (a deliberate choice) while still requiring the model to be available, healthy, non-deprecated, not recently failed, within any allow-list, and to satisfy required capabilities (`resolvePinnedModel`); otherwise it falls back to normal scoring. Its consumers are the **planner brain** (`atlasmind.planningModelId`, pins the planning/decomposition phase), the **synthesis brain** (`atlasmind.synthesisModelId`, pins result/session summarization), and the **draft model** (`atlasmind.draftModelId`, pins the first attempt of draftable mechanical tasks). Together with normal execution routing they realise the **draft → plan → execute → synthesize** role-routing set: a cheap model drafts low-stakes work (with struggle-gated escalation upgrading when it falls short) while brain models reason and tool-using execution routes to workers. Escalation deliberately clears any role/draft pin so it can always move up to a stronger model.
- **Outcome-driven bias** (Direction 2): a bounded nudge (`scoreOutcomeBias`, ±`OUTCOME_BIAS_MAX`) from each model's **decayed execution-outcome EWMA**. After every turn the orchestrator records a graded quality score (`gradeExecutionQuality`: error = 0, empty = 0.2, truncated = 0.6, clean = 1.0) via `recordExecutionOutcome`, maintained as an EWMA separate from the manual thumbs-feedback channel. The bias is gated by a minimum sample count (`MIN_OUTCOME_SAMPLES`, so a single run cannot swing routing) and scaled by the `feedbackRoutingWeight` control (0 disables it). Because it is clamped, a model that performs poorly is nudged down but never starved. Outcomes persist across sessions (`atlasmind.executionOutcomes`, via the `onModelOutcomeRecorded` hook) and are restored on activation. The **`AtlasMind: Compare Models on a Prompt`** command (`modelEvalHarness.ts`) runs one prompt across selected models, ranks them by graded quality and cost, and records the graded outcomes into this channel — so an explicit benchmark also calibrates routing. The recorded outcome is always the coarse **completion grade** (`gradeExecutionQuality`), regardless of an optional answer-quality **judge** score (0–100, `buildModelJudgePrompt`/`parseModelJudgeVerdicts`) shown in the panel — the judge drives the table ranking/sort but does not feed routing, keeping the calibration signal consistent with normal turns. Outcomes are tracked **per reasoning tier** as well as in aggregate: each run updates both the bare `modelId` aggregate and a `modelId::low|medium|high` bucket, and `scoreOutcomeBias` prefers the bucket matching the current task's reasoning tier (falling back to the aggregate when that bucket is sparse), so a model that is strong at high-reasoning work but weak at mechanical tasks is biased per context.
- **Evidence-backed normal-turn grading (0.143.0)** supersedes the coarse clean = 1.0 description above for orchestrated work. The orchestrator grades what the user actually receives after recovery together with expected tool use, successful and failed tool-call counts, post-write verification, TDD status, and incomplete-delivery signals. Hard errors remain 0, empty responses 0.2, and truncated responses 0.6; a clean text response starts at 0.8, successful verified execution can reach 1.0, and failed verification or blocked/incomplete work is capped lower. The explicit Model Comparison harness has no workspace execution artifacts and therefore intentionally retains the coarse completion-integrity grade plus its optional answer-quality judge.
- **Active-subscription nudge**: A subscription provider with quota remaining receives a small, general preference bonus (`ACTIVE_SUBSCRIPTION_BONUS`) on **all** task phases — not only on `maintenance` tasks — because its capacity is already paid for ("essentially free" until quota is exhausted). The nudge is modest (it breaks ties toward the subscription without overriding capability or quality needs) and is **quota-aware**: it disappears once the subscription is depleted, at which point the provider is treated as pay-per-token. This complements the older `maintenance`-only `SUBSCRIPTION_MAINTENANCE_BONUS`.
- **Cache-aware input cost**: On iterative/threaded turns a large, stable prefix (system/identity prompt + SSOT memory bundle + tool definitions) is reused and can be served from the provider's prompt cache at a reduced rate. `RoutingConstraints.cacheablePrefixRatio` (0..1) declares the cacheable share of a turn's input — the orchestrator estimates it via `estimateCacheablePrefixRatio(stablePrefixTokens, volatileTokens)` from the carried session/native context vs. the new user message, capped at `MAX_CACHEABLE_PREFIX_RATIO` (0.9) so a perfect cache hit is never assumed. When the ratio is > 0, `effectiveCostPer1k` prices the cacheable share at the model's cache-read rate for cache-capable models, lowering their projected cost and favouring them for repeat-context work. Single-shot turns (ratio 0) are unaffected. The cache-read price is `cachedInputPricePer1k` when known, else `inputPricePer1k ×` a per-provider factor from `PROVIDER_CACHE_READ_FACTOR` (Anthropic 0.1×, OpenAI/Azure/Copilot 0.5×, DeepSeek/Google 0.25×), falling back to `DEFAULT_CACHE_READ_FACTOR` (0.25×) for unlisted providers. These factors are a bootstrap baseline only — a dynamic `cachedInputPricePer1k` reported by discovery or the pricing sync overrides them.
  - **Dynamic capability**: cache support tracks provider changes. `ModelInfo.supportsPromptCaching` is authoritative and is sourced with **discovery hint → live pricing sync → catalog** precedence (an explicit `false` overrides), so when a provider gains or drops caching it is reflected on the next refresh. The `CACHE_CAPABLE_PROVIDERS` set is only a bootstrap fallback for models not yet annotated by a dynamic source.
  - **Measured savings**: adapters read the cached-input-token count from provider usage (`CompletionResponse.cachedInputTokens` — Anthropic `cache_read_input_tokens`, OpenAI `prompt_tokens_details.cached_tokens`, DeepSeek `prompt_cache_hit_tokens`). The orchestrator values the avoided spend with `ModelRouter.cacheReadPricePer1k(model)` and records it as `CostRecord.cacheSavingsUsd`; the Cost Dashboard surfaces the aggregate **Cache Savings** alongside cached-token volume. Reported as avoided spend (not subtracted from recorded cost), mirroring compression savings.
  - **Estimated local-model savings**: the Cost Dashboard filters genuine local-provider usage, groups tokens by exact local model id, and calls `getComparableCloudReference()` for one catalog-backed comparison per model. Advertised parameter counts map ≤8B to the budget tier, 9–64B to mid-tier, and ≥65B to premium; recognizable reasoning/large markers use premium, coder/vision/instruct markers use mid-tier, and unknown models conservatively default to mid-tier. Per-model avoided costs are then summed. This is a potential-cost estimate, not a recorded discount.
  - **Active cache writes (Anthropic)**: OpenAI and DeepSeek cache automatically, but Anthropic only caches the prefixes a request explicitly marks. The Anthropic adapter marks the system prompt and final tool with `cache_control: ephemeral` so the prefix is billed at the cache-read rate from the second call onward. Two refinements sharpen this:
    - **Stable/volatile split** — the system prompt's stable head (guardrails, agent prompt, skills) is separated from its volatile tail (`Relevant project memory:` / live evidence) via `splitStableSystemPrefix`, and the cache breakpoint is placed after the stable head only. The stable head is identical across turns, so cross-turn hit rates are far higher than caching the whole (memory-bearing) system prompt.
    - **When caching is enabled** — always for agentic (tool-carrying) requests (the loop reuses system+tools every iteration), and for threaded tool-less turns when the orchestrator sets `cacheStablePrefix` (cacheable-prefix ratio ≥ `CACHE_PREFIX_REUSE_THRESHOLD`). Single-shot turns are skipped so they avoid Anthropic's ~1.25× cache-write premium (which only breaks even after the second read).
- **Budget gate bypass**: Free models always pass the budget gate. Subscription models with ample quota pass the `cheap` gate only when `premiumRequestMultiplier ≤ 1`, the `balanced` gate when `multiplier ≤ 2`, and pass `auto`/`expensive` unconditionally. When quota is exhausted, subscription models fall to normal budget-tier gating.
- **Parallel slot routing** (`selectModelsForParallel`): When the caller requests multiple parallel slots, subscription advantage is progressively reduced (blended toward listed price) so that pay-per-token providers become viable for overflow. At 4+ slots the subscription advantage is fully eliminated.
  - Slot 1 is always filled by the best subscription/free model (if available and has quota).
  - Remaining slots are filled by the best pay-per-token candidates.

### Subscription Quota Tracking

Providers can report their remaining quota at runtime via `ModelRouter.updateSubscriptionQuota()`:

```typescript
interface SubscriptionQuota {
  totalRequests: number;
  remainingRequests: number;
  resetsAt?: string;           // ISO 8601 reset timestamp
  costPerRequestUnit?: number; // Real cost per request unit (e.g. $0.033)
}
```

| Quota state | Effect on routing |
|---|---|
| No quota configured | Model treated as ample-supply subscription (zero cost, passes all budget gates) |
| Remaining > 30% | Zero effective cost (simple path) or `costPerRequestUnit × multiplier` (when set) |
| Remaining 1–30% | **Conservation threshold**: effective cost blends linearly toward listed API price as quota depletes. At 0% remaining, effective cost equals listed price. |
| Remaining = 0 | **Exhausted**: model is scored at full listed API price and falls through to normal budget-tier gating (no bypass). |

#### Scope: authoritative quotas only

`subscriptionQuotaForModel` still supports a provider that exposes an authoritative per-model allowance, falling back to the provider-level record where appropriate. This is not used for ACP. On activation AtlasMind retires legacy `acp` quota records rather than carrying an old manual estimate into a new session.

The `$ Configure agent plan` control reads `atlasmind.acp.agents` live. It lists every currently configured agent—including eligible Gemini Code Assist and self-installed clients—then records the plan name the user enters. It never offers a vendor-tier table or asks for credits, a reset date, request totals, or a cost per unit: the ACP protocol cannot validate any of those values.

### Premium Request Multiplier

Some subscription models consume more than one request unit per invocation. The `premiumRequestMultiplier` field on `ModelInfo` captures this:

| Model | Multiplier | Effect |
|---|---|---|
| GPT-4o (Copilot) | 1× (default) | 1 request unit per call |
| Claude Opus 4 (Copilot) | 3× | 3 request units per call |
| o1 (Copilot) | 3× | 3 request units per call |
| GPT-4o-mini (Copilot) | 0.25× | 0.25 request units per call |

When `costPerRequestUnit` is set on the subscription quota, the router computes:

```
effectiveCost = costPerRequestUnit × premiumRequestMultiplier
```

This lets the router **prefer 1× models over 3× models** within the same subscription when the task doesn't require the premium model's capabilities — e.g. picking GPT-4o ($0.033/request) over Claude Opus 4 ($0.099/request) for a simple code query.

### Cross-Subscription Comparison

AtlasMind compares an effective subscription cost only where the provider exposes a billing unit that can be tracked, such as Copilot. ACP account plans are not converted into a made-up per-request price: the agent is recorded as subscription-backed, while the account's actual usage limit remains owned by the service.

### Seed-Only Default Providers

`registerDefaultProviders()` registers a **single minimal seed model** per provider before runtime discovery populates the live catalog:

| Provider | Seed model |
|---|---|
| Anthropic | `claude-sonnet-4-20250514` |
| OpenAI | `gpt-4.1-nano` |
| Google | `gemini-2.0-flash` |
| DeepSeek | `deepseek-chat` |
| Mistral | `mistral-small-latest` |
| z.ai | `glm-4.7-flash` |
| Copilot | `copilot/default` |
| Local | `local/echo-1` |

At activation, `refreshProviderModelsCatalog()` calls `discoverModels()` (or `listModels()`) on each provider to populate the full runtime catalog. This avoids hardcoding model lists that go stale when providers release new models.

Current behavior:
- Router stores pricing metadata in `ModelInfo` (`inputPricePer1k`, `outputPricePer1k`).
- Orchestrator computes per-request cost from model pricing and token usage reported by the provider adapter.
- Local fallback models use deterministic estimates because no upstream provider usage API exists.
- If a model is unknown to the router, cost is treated as `0` for safety.

## Adding a New Provider

1. Create `src/providers/<name>.ts` implementing `ProviderAdapter`.
2. Export from `src/providers/index.ts`.
3. Register via `ModelRouter.registerProvider()` in `extension.ts`.
4. Add pricing data to `ModelInfo` entries.
5. Update the Model Provider webview panel.
