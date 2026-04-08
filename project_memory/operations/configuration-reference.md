# Configuration Reference Summary

Source: `docs/configuration.md`

## Model Routing

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.budgetMode` | `string` | `"balanced"` | Budget preference for model selection. One of `cheap`, `balanced`, `expensive`, `auto`. |
| `atlasmind.speedMode` | `string` | `"balanced"` | Speed preference for model selection. One of `fast`, `balanced`, `considered`, `auto`. |
| `atlasmind.feedbackRoutingWeight` | `number` | `1` | Multiplier for thumbs-based routing bias. `0` disables feedback-weighted routing, `1` keeps the default slight influence, and `2` is the strongest supported setting. |
| `atlasmind.specialistRoutingOverrides` | `object` | `{}` | Per-domain overrides for specialist routing automation. Supported keys today are `media-generation`, `visual-analysis`, `voice`, `research`, `robotics`, and `simulation`. |
| `atlasmind.localOpenAiEndpoints` | `object[]` | `[]` | Labeled local OpenAI-compatible endpoints AtlasMind should aggregate under the Local provider. |
| `atlasmind.localOpenAiBaseUrl` | `string` | `""` | Legacy single local OpenAI-compatible endpoint fallback used only when the structured endpoint list is absent. |
| `atlasmind.azureOpenAiEndpoint` | `string` | `""` | Azure OpenAI resource endpoint for deployment-backed routing. Example: `https://your-resource.openai.azure.com`. |
| `atlasmind.azureOpenAiDeployments` | `string[]` | `[]` | Azure OpenAI deployment names AtlasMind should expose as routed models. |
| `atlasmind.bedrock.region` | `string` | `""` | AWS region used for Amazon Bedrock model invocations. Example: `us-east-1`. |
| `atlasmind.bedrock.modelIds` | `string[]` | `[]` | Amazon Bedrock model IDs AtlasMind should expose as routed models. |

**Budget modes** act as hard routing gates — `cheap` excludes expensive models entirely; `expensive` allows all tiers.

**Speed modes** work similarly — `fast` excludes slower reasoning-heavy models; `considered` allows them.

`atlasmind.feedbackRoutingWeight` does not unlock or remove any models by itself. It only scales the small capped thumbs-up/thumbs-down bias AtlasMind derives from stored assistant-response votes.

`atlasmind.specialistRoutingOverrides` is the explicit override layer for AtlasMind's live specialist-routing registry. AtlasMind now derives specialist-provider preferences from refreshed model metadata first, including domain tags such as research or visual analysis. Use overrides only when a workspace needs to pin a provider, suppress a route, tighten required capabilities, or swap the dedicated command AtlasMind opens for that domain.

`atlasmind.localOpenAiEndpoints` is the preferred way to configure local engines now. Each entry carries a stable `id`, a human-facing `label`, and a `baseUrl`, which lets AtlasMind keep multiple local engines online together while still showing which endpoint owns a routed model in the provider surfaces. When AtlasMind Settings opens and only the legacy `atlasmind.localOpenAiBaseUrl` is explicitly configured, AtlasMind now auto-migrat
…(truncated)

<!-- atlasmind-import
entry-path: operations/configuration-reference.md
generator-version: 2
generated-at: 2026-04-08T11:15:08.496Z
source-paths: docs/configuration.md
source-fingerprint: 03923c7d
body-fingerprint: f0463d37
-->
