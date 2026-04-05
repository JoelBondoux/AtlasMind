# Model Routing

## Overview

The Model Router selects the best LLM for each request based on user preferences, agent constraints, inferred task profile, model capabilities, and cost.

## Routing Inputs

| Input | Source | Description |
|---|---|---|
| Budget mode | User setting (`atlasmind.budgetMode`) | `cheap`, `balanced`, `expensive`, `auto` |
| Speed mode | User setting (`atlasmind.speedMode`) | `fast`, `balanced`, `considered`, `auto` |
| Max cost | Per-request or agent-level limit | Hard USD cap for the request |
| Preferred provider | Routing constraints | Soft preference for a specific provider |
| Allowed models | `AgentDefinition.allowedModels` | Whitelist — empty means any |
| Task profile | `TaskProfiler` | Inferred `phase`, `modality`, `reasoning`, and capability needs |
| Model capabilities | `ModelInfo.capabilities` | `chat`, `code`, `vision`, `function_calling`, `reasoning` |
| Provider availability | Health check result | Whether the provider is reachable |

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
- Code-heavy tasks prefer models with `code` support even when `code` is not a hard requirement.
- Freeform chat requests that mention supported workspace image paths are upgraded to vision requests, and the `/vision` chat command can explicitly attach selected workspace images to compatible provider adapters.

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
8. Return the highest-scoring model

Notes:
- Budget mode is now a pre-scoring gate, not only a weight.
- Speed mode is now a pre-scoring gate, not only a weight.
- `taskFit` boosts models whose capabilities match the inferred modality and reasoning needs.
- `requiredCapabilities` still acts as a hard gate before scoring.
- Provider health is refreshed during model catalog refresh and unhealthy providers are excluded from normal selection.
- Provider and model enabled state can be changed from the Models sidebar; those toggles are persisted in extension storage and reapplied after catalog refresh.
- Providers without credentials stay visible in the Models sidebar, but their child model rows remain hidden until the provider is configured.
- If there are no candidates, router falls back to `local/echo-1`.

### Catalog Refresh And Health

Atlas now refreshes provider model catalogs at startup and when the user clicks
**Refresh Model Metadata** in the Model Providers panel.

- For providers that implement `discoverModels()`, discovered metadata (context window,
  capabilities, pricing) is merged directly into the router catalog.
- For providers that only implement `listModels()`, newly discovered model IDs are
  enriched via the well-known model catalog and heuristic fallbacks.
- Existing curated model metadata (known pricing/capabilities) is preserved.
- Discovery hints can override static entries — e.g. a real `maxInputTokens` from the
  Copilot LM API replaces a hardcoded context window estimate.
- Each refresh also runs `healthCheck()` and records provider health for routing decisions.
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
| OpenAI | `openai` | Runtime discovery via `/models` through the OpenAI-compatible adapter | Seeded with one fallback model until refresh completes |
| Google (Gemini) | `google` | Runtime discovery via AI Studio OpenAI-compatible `/models` endpoint | Seeded with one fallback model until refresh completes |
| Azure OpenAI | `azure` | Deployment list comes from `atlasmind.azureOpenAiDeployments`; execution uses a resource-specific Azure endpoint with `api-key` auth | Starts empty until you configure an endpoint and at least one deployment |
| Mistral | `mistral` | Runtime discovery via `/models` through the OpenAI-compatible adapter | Seeded with one fallback model until refresh completes |
| DeepSeek | `deepseek` | Runtime discovery via `/models` through the OpenAI-compatible adapter | Seeded with one fallback model until refresh completes |
| z.ai (GLM) | `zai` | Runtime discovery via `/models` through the OpenAI-compatible adapter | Seeded with one fallback model until refresh completes |
| Amazon Bedrock | `bedrock` | Configured model IDs come from `atlasmind.bedrock.modelIds`; execution uses an AWS SigV4-signed Bedrock Converse request | Starts empty until you configure region, model IDs, and AWS credentials |
| xAI (Grok) | `xai` | Runtime discovery via `/models` through the OpenAI-compatible adapter | Seeded with Grok 4 until refresh completes |
| Cohere | `cohere` | Runtime discovery via Cohere's OpenAI-compatibility `/models` endpoint | Seeded with Command A until refresh completes |
| Perplexity | `perplexity` | Static model catalog via adapter config because the upstream chat endpoint does not expose a standard `/models` inventory | Seeded with Sonar and refreshed from the adapter's static catalog |
| Hugging Face Inference | `huggingface` | Runtime discovery via the Hugging Face router OpenAI-compatible `/models` endpoint | Seeded with one fallback router model until refresh completes |
| NVIDIA NIM | `nvidia` | Runtime discovery via NVIDIA's OpenAI-compatible `/models` endpoint | Seeded with one fallback hosted model until refresh completes |
| Local LLM | `local` | Static fallback adapter or runtime discovery via a configured local OpenAI-compatible `/models` endpoint | Falls back to `local/echo-1` until a local endpoint is configured, and remains health-checkable via the built-in echo fallback |
| VS Code Copilot | `copilot` | Runtime discovery from VS Code Language Model API | Seeded with `copilot/default`; live discovery is deferred until the user explicitly activates Copilot so AtlasMind does not trigger a permission prompt during startup |

The provider table above describes **where Atlas gets the live catalog**, not an exhaustive static list of models. For API-backed providers, the visible catalog is refreshed at startup and when the user clicks **Refresh Model Metadata** in the Model Providers panel.

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
- xAI, Cohere, Hugging Face Inference, and NVIDIA NIM use the reusable OpenAI-compatible adapter with provider-specific base URLs.
- Perplexity uses the same adapter but relies on a static configured model list because its chat endpoint does not expose a standard `/models` catalog.
- Amazon Bedrock uses a dedicated adapter because Bedrock requires SigV4 request signing and Bedrock-specific payload/response mapping.
- Providers with specialist auth or non-chat modalities stay out of the routed table until they have a dedicated adapter path.

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
| `subscription` | Tokens included in a subscription plan — effectively free to the user | GitHub Copilot |
| `free` | No cost at all (local inference, free-tier APIs) | Local/Ollama |
| `pay-per-token` | Billed per token consumed via an API key | Anthropic, OpenAI, Google, Mistral, DeepSeek, z.ai |

#### How pricing affects routing

- **Effective cost**: Subscription and free providers have an effective cost of **zero** for scoring purposes when quota is ample (above the conservation threshold). This makes them always win the cheapness component of the score when capabilities are equivalent.
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
