# Model Routing

## Overview

The Model Router selects the best LLM for each request based on user preferences, agent constraints, model capabilities, and cost.

## Routing Inputs

| Input | Source | Description |
|---|---|---|
| Budget mode | User setting (`atlasmind.budgetMode`) | `cheap`, `balanced`, `expensive`, `auto` |
| Speed mode | User setting (`atlasmind.speedMode`) | `fast`, `balanced`, `considered`, `auto` |
| Max cost | Per-request or agent-level limit | Hard USD cap for the request |
| Preferred provider | Routing constraints | Soft preference for a specific provider |
| Allowed models | `AgentDefinition.allowedModels` | Whitelist — empty means any |
| Model capabilities | `ModelInfo.capabilities` | `chat`, `code`, `vision`, `function_calling`, `reasoning` |
| Provider availability | Health check result | Whether the provider is reachable |

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

## Selection Algorithm (planned)

```
1. Gather all enabled models across all registered providers
2. Filter by agent's allowedModels whitelist (if set)
3. Filter by required capabilities for the task
4. Filter by provider availability (health check)
5. Score each model:
   score = w_budget × budgetScore(model)
         + w_speed  × speedScore(model)
         + w_quality × qualityScore(model)
6. If maxCostUsd is set, exclude models whose estimated cost exceeds it
7. If preferredProvider is set, boost models from that provider
8. Return the highest-scoring model
```

## Supported Providers

| Provider | ID | Status |
|---|---|---|
| Anthropic (Claude) | `anthropic` | Interface defined |
| OpenAI | `openai` | Interface defined |
| Google (Gemini) | `google` | Interface defined |
| Mistral | `mistral` | Interface defined |
| DeepSeek | `deepseek` | Interface defined |
| Local LLM (Ollama, etc.) | `local` | Interface defined |
| VS Code Copilot | `copilot` | Interface defined |

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

Before routing, the router can estimate cost using:
- `ModelInfo.inputPricePer1k` and `outputPricePer1k`
- Estimated input token count (from prompt length)
- Estimated output token count (heuristic based on task type)

## Adding a New Provider

1. Create `src/providers/<name>.ts` implementing `ProviderAdapter`.
2. Export from `src/providers/index.ts`.
3. Register via `ModelRouter.registerProvider()` in `extension.ts`.
4. Add pricing data to `ModelInfo` entries.
5. Update the Model Provider webview panel.
