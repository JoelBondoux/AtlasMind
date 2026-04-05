# Model Routing

The model router selects the best LLM for each request based on budget preference, speed preference, task profile, provider health, and the runtime-refreshed provider model catalog.

## Supported Providers

| Provider | ID | Pricing Model | Catalog source | Notes |
|----------|----|--------------|----------------|-------|
| **Anthropic** | `anthropic` | Pay-per-token | Runtime discovery via adapter `discoverModels()` / `listModels()` | One seed model is registered before refresh completes |
| **OpenAI** | `openai` | Pay-per-token | Runtime discovery via `/models` on the OpenAI-compatible adapter | One seed model is registered before refresh completes |
| **Azure OpenAI** | `azure` | Pay-per-token | Deployment list from `atlasmind.azureOpenAiDeployments` plus a workspace-configured Azure endpoint | Starts empty until you configure an endpoint and at least one deployment |
| **GitHub Copilot** | `copilot` | Subscription | Runtime discovery from the VS Code Language Model API | Starts with `copilot/default`; live discovery is deferred until you explicitly activate Copilot so AtlasMind does not prompt for language-model access during startup |
| **Google** | `google` | Pay-per-token | Runtime discovery via the Gemini OpenAI-compatible `/models` endpoint | One seed model is registered before refresh completes |
| **Amazon Bedrock** | `bedrock` | Pay-per-token | Configured model IDs from `atlasmind.bedrock.modelIds` executed through a SigV4-signed Bedrock adapter | Starts empty until you configure region, model IDs, and AWS credentials |
| **Mistral** | `mistral` | Pay-per-token | Runtime discovery via `/models` on the OpenAI-compatible adapter | One seed model is registered before refresh completes |
| **DeepSeek** | `deepseek` | Pay-per-token | Runtime discovery via `/models` on the OpenAI-compatible adapter | One seed model is registered before refresh completes |
| **z.ai** | `zai` | Pay-per-token | Runtime discovery via `/models` on the OpenAI-compatible adapter | One seed model is registered before refresh completes |
| **xAI** | `xai` | Pay-per-token | Runtime discovery via `/models` on the OpenAI-compatible adapter | Starts with Grok 4, then refreshes to the live xAI catalog |
| **Cohere** | `cohere` | Pay-per-token | Runtime discovery via Cohere's OpenAI-compatibility `/models` endpoint | Starts with Command A, then refreshes to the live Cohere catalog |
| **Perplexity** | `perplexity` | Pay-per-token | Adapter-managed static model catalog | Uses a static Sonar-family model list because the upstream chat path does not expose a standard `/models` inventory |
| **Hugging Face Inference** | `huggingface` | Pay-per-token | Runtime discovery via the Hugging Face router OpenAI-compatible `/models` endpoint | Starts with one fallback router model, then refreshes to the live router catalog |
| **NVIDIA NIM** | `nvidia` | Pay-per-token | Runtime discovery via NVIDIA's OpenAI-compatible `/models` endpoint | Starts with one fallback hosted model, then refreshes to the live catalog |
| **Local** | `local` | Free | Static fallback or runtime discovery via a configured local OpenAI-compatible endpoint | Falls back to `local/echo-1` until a local endpoint is configured and still counts as healthy through the built-in echo fallback |

The short model names you may see initially are **seed entries**, not AtlasMind's intended final provider catalog. On activation, and whenever the user clicks **Refresh Model Metadata**, Atlas scans providers for their live model list and merges that runtime discovery into the router.

## Specialist And Future Providers

AtlasMind's routed provider list is intentionally narrower than the broader AI vendor landscape. The model router expects a chat-capable backend that can be scored, health-checked, and executed through the current `ProviderAdapter` contract.

These names may still be valid future integrations, but they require a dedicated path rather than being inserted into the routed provider table as-is:

| Provider | Why it is not a routed provider yet |
|---|---|
| Meta | Usually appears as models hosted by other providers rather than one stable first-party routed API |
| Ludus AI | Needs a verified public chat-model API contract |
| Reka AI | Needs a verified current API contract and discovery path |
| EXA AI | Search/retrieval service rather than a routed chat backend |
| Aleph Alpha | Needs a dedicated adapter and verified runtime discovery behavior |
| Stability AI | Primarily image/media generation workflows |
| Runway | Primarily video/media generation workflows |
| ElevenLabs | Primarily speech/audio workflows |

## Catalog Refresh And Seed Models

AtlasMind uses a two-stage catalog strategy:

1. `registerDefaultProviders()` seeds one minimal model for most providers so routing works immediately.
2. `refreshProviderModelsCatalog()` runs on startup and on manual refresh.
3. Providers with `discoverModels()` contribute rich runtime metadata directly.
4. Providers with only `listModels()` contribute IDs, which Atlas enriches using the well-known catalog and heuristics.
5. If refresh fails, the existing seeded/static provider catalog remains in place.

Azure OpenAI and Bedrock are the exceptions: their routed model lists are intentionally empty until the workspace config defines deployments or model IDs.
Copilot is also handled specially: AtlasMind keeps its seed model registered but skips live discovery on startup until the user explicitly activates Copilot.

This means the provider table should be read as **dynamic discovery capability**, not a hardcoded model inventory.

AtlasMind now uses three discovery patterns inside the routed set:

1. Direct runtime discovery via `/models` for standard OpenAI-compatible backends.
2. Static fallback seeds plus runtime refresh for providers that expose a normal model inventory.
3. Adapter-managed or workspace-configured model catalogs for providers such as Perplexity, Azure OpenAI, and Bedrock where execution is chat-compatible but discovery is provider-specific.

## Metadata Enrichment

Discovered model IDs are normalized and resolved through this precedence chain:

1. Runtime hint from `discoverModels()`
2. Well-known entry from `src/providers/modelCatalog.ts`
3. Name-based heuristic fallback in `inferModelMetadata()`

The well-known catalog improves pricing, capability, context-window, and premium-request metadata for models that were discovered dynamically. It does not replace runtime discovery.

### Adding API Keys

1. Open Command Palette → **AtlasMind: Manage Model Providers**
2. Click **Set Key** or **Configure** for the provider
3. Keys are stored in VS Code's `SecretStorage` — never in settings or source

For the local provider, the endpoint URL is stored in `atlasmind.localOpenAiBaseUrl` and any optional API key is stored in SecretStorage under `atlasmind.provider.local.apiKey`.
For Azure OpenAI, the endpoint and deployment list live in workspace settings and the API key stays in SecretStorage.
For Amazon Bedrock, the region/model list live in workspace settings and AWS credentials stay in SecretStorage.
For GitHub Copilot, AtlasMind uses your signed-in VS Code session and only asks for language-model permission when you explicitly activate the Copilot provider.

### Provider Health

- The router tracks per-provider health status
- Unhealthy providers receive a health penalty (score multiplier × 0) and are deprioritised
- Health updates via `setProviderHealth()` — typically after request failures

---

## Selection Algorithm

### 1. Candidate Filtering

Models pass through three gates:

| Gate | Rule |
|------|------|
| **Enabled** | Provider and model must both be enabled |
| **Health** | Provider must be marked healthy |
| **Whitelist** | If agent has `allowedModels`, model must be in the list |
| **Capabilities** | Model must support all `requiredCapabilities` from the task profile |
| **Budget gate** | Model's budget tier must be in the allowed set for the configured budget mode |
| **Speed gate** | Model's speed tier must be in the allowed set for the configured speed mode |

### 2. Scoring

Provider and model availability can be changed directly from the Models sidebar. Those inline toggles persist in extension storage and are reapplied after runtime model discovery refreshes, so the router keeps honoring the user's local enable/disable choices. Providers that are not yet configured stay at the root of the tree, but their child model rows are hidden until credentials are present.

Each candidate is scored using:

```
score = (cheapness × budgetWeight) + (speedProxy × speedWeight)
      + (qualityProxy × qualityWeight) + taskFit + healthBonus
```

| Factor | How it's computed |
|--------|-------------------|
| **Cheapness** | `1 / max(0.0001, effectiveCost)` — lower cost → higher score |
| **Speed proxy** | fast = 1.5, balanced = 1.0, considered = 0.6 |
| **Quality** | reasoning = 1.5, code = 1.2, other = 1.0 |
| **Task fit** | Bonus for matching preferred capabilities and task phase |
| **Health bonus** | +1.25 for healthy providers, 0 for unhealthy |

### 3. Weighting

Weights are controlled by budget and speed mode:

| Budget Mode | Budget Weight |
|-------------|--------------|
| `cheap` | 3.0 |
| `balanced` | 1.5 |
| `expensive` | 0.5 |
| `auto` | 1.5 |

| Speed Mode | Speed Weight |
|------------|-------------|
| `fast` | 3.0 |
| `balanced` | 1.5 |
| `considered` | 0.75 |
| `auto` | 1.5 |

---

## Budget Modes

| Mode | Allowed Model Tiers | Best For |
|------|---------------------|----------|
| **cheap** | cheap only | Bulk operations, simple queries |
| **balanced** | cheap + balanced | General development (default) |
| **expensive** | cheap + balanced + expensive | Architecture, complex reasoning |
| **auto** | Adapts per task profile | Let the profiler decide |

**Budget tier classification** (by total price per 1K tokens):

| Tier | Price Range |
|------|-------------|
| Cheap | ≤ $0.0015 / 1K |
| Balanced | ≤ $0.008 / 1K |
| Expensive | > $0.008 / 1K |

### Auto Budget Mode

When budget is `auto`, the task profiler adjusts:
- **High reasoning** → balanced + expensive
- **Medium reasoning** → cheap + balanced
- **Low reasoning** → cheap + balanced

---

## Speed Modes

| Mode | Allowed Model Tiers | Best For |
|------|---------------------|----------|
| **fast** | fast only | Quick edits, simple lookups |
| **balanced** | fast + balanced | General development (default) |
| **considered** | balanced + considered | Planning, architecture, deep analysis |
| **auto** | Adapts per task profile | Let the profiler decide |

**Speed tier classification:**

| Tier | Criteria |
|------|----------|
| Fast | No reasoning capability AND context ≤ 128K |
| Considered | Has reasoning capability AND context ≥ 200K |
| Balanced | Everything else |

### Auto Speed Mode

When speed is `auto`, the task profiler adjusts:
- **High reasoning** → balanced + considered
- **Otherwise** → fast + balanced

---

## Task Profile Scoring

The task profiler infers phase, modality, and reasoning intensity. This influences scoring:

| Task Phase | Scoring Bonus |
|------------|--------------|
| `planning` | +0.9 for reasoning models |
| `execution` with code modality | +0.7 for code models |
| `synthesis` | +0.9 for reasoning models |

Preferred capabilities from the profile add:
- +1.0 for `reasoning` match
- +0.6 for other capability matches

---

## Subscription Quota Management

For subscription providers (e.g. GitHub Copilot):

### Premium Request Multiplier

Some models consume multiple quota units per request. For example, Claude 4 Opus via Copilot costs 3× per request.

```
effectiveCost = costPerRequestUnit × premiumRequestMultiplier
```

### Conservation Threshold

When remaining quota drops below **30%** of total:
- The router interpolates effective cost from subscription rate toward API rate
- This naturally biases selection toward cheaper models as quota depletes
- At 0% remaining, subscription models are treated as pay-per-token

### Quota Exhaustion

When `remainingRequests ≤ 0`:
- The provider is treated exactly like pay-per-token
- Models are scored at their listed API prices
- No subscription bonus applies

---

## Parallel Slot Selection

When the task scheduler needs multiple models running in parallel (e.g. during `/project`):

1. `selectModelsForParallel(slots, constraints)` is called
2. First slot filled with the best subscription/free model
3. Remaining slots filled with pay-per-token candidates
4. As `parallelSlots` increases, subscription advantage is dampened to allow overflow

The damping formula blends subscription cost toward listed API cost:
```
slotBlend = min(1, (parallelSlots - 1) / 3)
effectiveCost = subscriptionCost + (listedCost - subscriptionCost) × slotBlend
```

---

## Cost Estimation

The `CostTracker` records after each request:
- Input tokens and output tokens
- Model pricing
- Running session total in USD

Use `/cost` or **AtlasMind: Show Cost Summary** to view the breakdown.

Agents can set `costLimitUsd` to cap per-task spending. If the limit is reached, the task is terminated with a cost-exceeded message.

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `atlasmind.budgetMode` | `balanced` | Budget preference: cheap, balanced, expensive, auto |
| `atlasmind.speedMode` | `balanced` | Speed preference: fast, balanced, considered, auto |
| `atlasmind.localOpenAiBaseUrl` | `http://127.0.0.1:11434/v1` | Base URL for a local OpenAI-compatible endpoint |

These can also be adjusted via the [[Configuration]] settings panel.
