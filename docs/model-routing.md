# Model Routing

## Overview

The Model Router selects the best LLM for each request based on user preferences, agent constraints, inferred task profile, model capabilities, and cost.

For OpenAI-family chat completion providers, AtlasMind now applies provider-specific compatibility rules instead of one shared payload shape. OpenAI and Azure OpenAI use the newer chat contract with `developer` messages and `max_completion_tokens`, while third-party OpenAI-compatible providers continue using the broader `system` plus `max_tokens` contract for compatibility. AtlasMind also omits `temperature` for fixed-temperature OpenAI model families such as GPT-5 and the `o`-series, while retaining it for models and providers that still support sampling controls.

AtlasMind can also perform one bounded escalation during execution when the current model shows repeated struggle signals, such as repeated failed tool calls or excessive tool-loop churn. In those cases it reroutes to a stronger reasoning-capable model instead of exhausting the entire loop on the weaker route.

If the selected provider fails outright, AtlasMind now attempts a bounded provider failover and reroutes the task to another eligible provider before surfacing a final error.

AtlasMind also includes workstation context in routed prompts so response formatting can default to the active environment, such as preferring PowerShell command examples on Windows inside VS Code unless the user asks for another shell or platform.

For responses viewed in the shared AtlasMind chat workspace, assistant bubbles now expose thumbs up and thumbs down controls. AtlasMind persists those votes per assistant turn, aggregates them by `modelUsed`, and folds them back into future routing as a small bounded preference bias rather than a hard provider or model lock.

## Routing Inputs

| Input | Source | Description |
|---|---|---|
| Budget mode | User setting (`atlasmind.budgetMode`) | `cheap`, `balanced`, `expensive`, `auto` |
| Speed mode | User setting (`atlasmind.speedMode`) | `fast`, `balanced`, `considered`, `auto` |
| Feedback routing weight | User setting (`atlasmind.feedbackRoutingWeight`) | Multiplier for thumbs-based routing bias; `0` disables it and `1` is the default slight influence |
| Max cost | Per-request or agent-level limit | Hard USD cap for the request |
| Preferred provider | Routing constraints | Soft preference for a specific provider |
| Allowed models | `AgentDefinition.allowedModels` | Whitelist — empty means any |
| Task profile | `TaskProfiler` | Inferred `phase`, `modality`, `reasoning`, and capability needs |
| Model capabilities | `ModelInfo.capabilities` | `chat`, `code`, `vision`, `function_calling`, `reasoning` |
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
- Tool-enabled agents require `function_calling`.
- When no healthy model satisfies those implicit tool requirements, AtlasMind retries the turn without tool use before it allows the built-in `local/echo-1` fallback, so text-only providers such as Claude CLI can still answer normal chat requests.
- Code-heavy tasks prefer models with `code` support even when `code` is not a hard requirement.
- Freeform chat requests that mention supported workspace image paths are upgraded to vision requests, and the `/vision` chat command can explicitly attach selected workspace images to compatible provider adapters.
- Important thread-based follow-up prompts such as "based on the chat thread" or other high-stakes carry-forward requests are profiled more aggressively so AtlasMind can escalate away from weak local models on later turns.

## Specialist Intent Routing

Before a freeform chat request reaches the normal router, AtlasMind now checks for specialist workflow shapes that should not be handled as generic text chat.

- Image and other media generation requests are redirected to the specialist integration surface instead of being treated as ordinary chat prompts.
- Image-recognition requests route into the vision workflow. If image attachments are already present, AtlasMind keeps the request in-chat and upgrades it to a considered multimodal run.
- Speech and transcription requests route to the voice workflow.
- Research-heavy requests bias toward source-backed retrieval, add explicit specialist guidance to the routed prompt, and prefer deep-research providers when they are enabled.
- Robotics and simulation prompts bias toward slower, stronger code-and-reasoning routes so tool-backed execution is more likely than a generic prose answer.

This specialist layer is intentionally separate from the provider adapter table: it decides whether Atlas should open a dedicated workflow surface, route toward a specialist-capable provider, or keep the request in ordinary chat with stronger capability requirements.

The provider preference for those specialist in-chat routes is no longer hardcoded to one fixed provider list. AtlasMind now carries optional `ModelInfo.specialistDomains` metadata through discovery and catalog refresh, derives fallback domain tags from refreshed model IDs and capabilities when providers do not expose them explicitly, and scores the live enabled model pool per specialist domain before choosing a preferred provider.

When a workspace needs explicit control, `atlasmind.specialistRoutingOverrides` can pin or suppress any supported domain route without disabling the broader live catalog refresh. That keeps the default behavior adaptive as provider catalogs change over time while still giving teams a deterministic escape hatch.

## Budget Modes

| Mode | Behaviour |
|---|---|
| **Cheap** | Prefer the lowest-cost model that meets minimum capability requirements |
| **Balanced** | Middle ground — reasonable quality at moderate cost |
| **Expensive** | Prefer the highest-capability model regardless of cost |
| **Auto** | Estimate task complexity and choose accordingly, without exceeding any hard cost limit |

## Speed Modes

| Mode | Behaviour |
|---|---|
| **Fast** | Prefer models with lowest latency (smaller models, local inference) |
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
8. Return the highest-scoring model

Notes:
- Budget mode is now a pre-scoring gate, not only a weight.
- Speed mode is now a pre-scoring gate, not only a weight.
- `taskFit` boosts models whose capabilities match the inferred modality and reasoning needs.
- Cheapness is intentionally normalized so free or subscription-backed models stay attractive without automatically overruling stronger reasoning and task-fit signals.
- `feedbackBias` is intentionally capped and smoothed so a few votes can nudge future routing without overpowering hard gates or the core budget/speed/task-fit score.
- `atlasmind.feedbackRoutingWeight` scales that bounded `feedbackBias` multiplier without changing the stored vote history. Setting it to `0` disables feedback-weighted routing while preserving dashboard analytics and transcript votes.
- `requiredCapabilities` still acts as a hard gate before scoring.
- Provider health is refreshed during model catalog refresh and unhealthy providers are excluded from normal selection.
- Provider and model enabled state can be changed from the Models sidebar; those toggles are persisted in extension storage and reapplied after catalog refresh.
- Providers without credentials stay visible in the Models sidebar, but their child model rows remain hidden until the provider is configured.
- If there are no candidates under the current budget or speed gates, AtlasMind first retries with fully permissive routing gates.
- If tools were only implicitly available and still no real provider matches, AtlasMind retries the turn in text-only mode.
- Only after those retries fail does the router fall back to `local/echo-1`.

Claude CLI (Beta) also uses a compact bridge prompt during execution. AtlasMind trims bulky memory and live-evidence sections before forwarding the routed system prompt to the local Claude CLI process, and it grants that provider a longer timeout budget than the generic provider default so ordinary chat turns can complete reliably.

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
| Claude CLI (Beta) | `claude-cli` | Adapter-managed alias list validated through local `claude auth status` | Reuses a locally installed Claude CLI login in constrained print mode, starts with `claude-cli/sonnet` until refresh confirms the CLI is ready, strips pseudo-tool markup from print responses, and surfaces a clear provider error when the CLI returns JSON without assistant text |
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
| NVIDIA NIM | `nvidia` | Runtime discovery via NVIDIA's OpenAI-compatible `/models` endpoint | Seeded with one fallback hosted model until refresh completes |
| Local LLM | `local` | Static fallback adapter or runtime discovery via a configured local OpenAI-compatible `/models` endpoint | Falls back to `local/echo-1` until a local endpoint is configured, and remains health-checkable via the built-in echo fallback |
| VS Code Copilot | `copilot` | Runtime discovery from VS Code Language Model API | Seeded with `copilot/default`; live discovery is deferred until the user explicitly activates Copilot so AtlasMind does not trigger a permission prompt during startup |

The provider table above describes **where Atlas gets the live catalog**, not an exhaustive static list of models. For API-backed providers, the visible catalog is refreshed at startup and when the user clicks **Refresh Model Metadata** in the Model Providers panel.

During refresh, AtlasMind normalizes upstream model IDs into its internal `provider/model` form before routing. This matters for providers such as Google Gemini whose OpenAI-compatible `/models` payloads can return raw IDs like `models/gemini-2.5-pro`; AtlasMind stores and executes those as `google/gemini-2.5-pro` so provider selection, failover, and telemetry stay aligned.

AtlasMind now refreshes all enabled providers during startup, including GitHub Copilot, so the routing pool is built from the current live model catalogs instead of a partially deferred provider set.

Provider failover now stays inside the candidate set that still satisfies the task's routing constraints. If a workspace-debug or tool-required request runs out of models that support the needed capabilities, AtlasMind fails the request explicitly instead of silently dropping to the built-in `local/echo-1` text fallback.

When a routed model fails during execution, AtlasMind marks that model as failed for the current session, removes it from future candidate selection, increments a per-model failure counter, and shows a warning state in the Models sidebar until a later provider refresh clears the failure.

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
specifications sourced from published provider documentation:

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

The catalog is queried by `inferModelMetadata()` whenever a new model is
discovered at runtime.  Resolution order: runtime hint → catalog → heuristic.
It is **not** the primary source of model IDs; it enriches IDs discovered from providers.

Some routed providers intentionally mix discovery modes:

- Azure OpenAI uses the reusable OpenAI-compatible adapter with a workspace-configured base URL, deployment-specific chat path resolution, and raw `api-key` authentication.
- DeepSeek uses the same standard OpenAI-compatible adapter path, and AtlasMind now treats the live `deepseek-reasoner` route as tool-capable in addition to reasoning-capable based on observed API behavior.
- xAI, Cohere, Hugging Face Inference, and NVIDIA NIM use the reusable OpenAI-compatible adapter with provider-specific base URLs.
- Perplexity uses the same adapter but relies on a static configured model list because its chat endpoint does not expose a standard `/models` catalog.
- Amazon Bedrock uses a dedicated adapter because Bedrock requires SigV4 request signing, a canonical request path that preserves the configured raw model ID, and Bedrock-specific payload/response mapping.
- Providers with specialist auth or non-chat modalities stay out of the routed table until they have a dedicated adapter path.

AtlasMind now also reuses the same routed-provider layer from a Node CLI host. Host-neutral adapters (`anthropic`, `claude-cli`, `openai-compatible`, and the shared `local` adapter from `src/providers/registry.ts`) read credentials through a small secret abstraction: in VS Code that resolves to `SecretStorage`, and in the CLI it resolves from environment variables such as `ATLASMIND_PROVIDER_OPENAI_APIKEY`, `ATLASMIND_PROVIDER_ANTHROPIC_APIKEY`, `ATLASMIND_AZURE_OPENAI_ENDPOINT`, `ATLASMIND_AZURE_OPENAI_DEPLOYMENTS`, and `ATLASMIND_LOCAL_OPENAI_BASE_URL`. Claude CLI (Beta) relies on the local Claude CLI auth state instead of an AtlasMind-managed API key, explicitly requests plain-text print-mode replies with tools disabled, strips embedded pseudo-tool XML from successful results, and now fails fast when the CLI returns a JSON envelope without assistant text. Copilot remains extension-only because it depends on the VS Code Language Model API, and Bedrock remains on the dedicated extension-host configuration path.

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
| `subscription` | Tokens included in a subscription plan — effectively free to the user | GitHub Copilot, Claude CLI (Beta) |
| `free` | No cost at all (local inference, free-tier APIs) | Local/Ollama |
| `pay-per-token` | Billed per token consumed via an API key | Anthropic, OpenAI, Google, Mistral, DeepSeek, z.ai |

#### How pricing affects routing

- **Effective cost**: Subscription and free providers still receive the strongest cheapness score when quota is ample, but the cheapness term is normalized so a free local model does not automatically beat a clearly better reasoning-capable model on a higher-stakes turn.
- **Budget gate bypass**: Subscription and free models always pass the budget gate regardless of the current budget mode — **unless quota is exhausted**, in which case the subscription model falls to normal budget-tier gating.
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

When `costPerRequestUnit` is set, different subscriptions can be compared directly:

- **GitHub Copilot Pro**: `costPerRequestUnit ≈ $0.033` → Opus 4 at 3× = $0.099/call
- **Claude Code subscription**: `costPerRequestUnit ≈ $0.05` → Opus 4 at 1× = $0.05/call

The router would prefer the Claude Code subscription for Opus 4 tasks because the effective per-request cost is lower, even though the base subscription rate is higher.

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
