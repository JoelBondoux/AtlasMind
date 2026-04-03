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
7. Score each remaining model:
   score = w_budget × budgetScore(model)
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
- If there are no candidates, router falls back to `local/echo-1`.

### Catalog Refresh And Health

Atlas now refreshes provider model catalogs at startup and when the user clicks
**Refresh Model Metadata** in the Model Providers panel.

- For providers that implement API discovery (`listModels()`), discovered model IDs are merged into the router catalog.
- Existing curated model metadata (known pricing/capabilities) is preserved.
- Newly discovered models get inferred metadata so they are immediately routable.
- Each refresh also runs `healthCheck()` and records provider health for routing decisions.
- If discovery fails for a provider, Atlas keeps the existing static catalog for that provider.

### Cross-Provider Selection

`@atlas` chat and `/project` flows no longer force a fixed preferred provider.
Unless explicitly constrained by an agent/model whitelist, model selection now
runs across all enabled providers and chooses the best-scoring candidate for the
current budget/speed settings and inferred task profile.
```

## Supported Providers

| Provider | ID | Status |
|---|---|---|
| Anthropic (Claude) | `anthropic` | Adapter implemented (`src/providers/anthropic.ts`) |
| OpenAI | `openai` | Adapter implemented (`src/providers/openai-compatible.ts`) |
| Google (Gemini) | `google` | Adapter implemented via AI Studio OpenAI-compatible endpoint |
| Mistral | `mistral` | Adapter implemented (`src/providers/openai-compatible.ts`) |
| DeepSeek | `deepseek` | Adapter implemented (`src/providers/openai-compatible.ts`) |
| z.ai (GLM) | `zai` | Adapter implemented — endpoint: `https://api.z.ai/api/paas/v4` |
| Local LLM (Ollama, etc.) | `local` | Echo adapter (`local/echo-1`) |
| VS Code Copilot | `copilot` | Adapter implemented (`src/providers/copilot.ts`) |

## Provider Adapter Interface

Every provider implements `ProviderAdapter` from `src/providers/adapter.ts`:

```typescript
interface ProviderAdapter {
  readonly providerId: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  listModels(): Promise<string[]>;
  healthCheck(): Promise<boolean>;
}
```

## Cost Estimation

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
