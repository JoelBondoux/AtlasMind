# Configuration Reference Summary

Source: `docs/configuration.md`

## Model Routing

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.budgetMode` | `string` | `"balanced"` | Budget preference for model selection. One of `cheap`, `balanced`, `expensive`, `auto`. |
| `atlasmind.speedMode` | `string` | `"balanced"` | Speed preference for model selection. One of `fast`, `balanced`, `considered`, `auto`. |
| `atlasmind.feedbackRoutingWeight` | `number` | `1` | Multiplier for thumbs-based routing bias. `0` disables feedback-weighted routing, `1` keeps the default slight influence, and `2` is the strongest supported setting. Also scales the outcome-driven routing bias. |
| `atlasmind.planningModelId` | `string` | `""` | Optional model ID pinned for the planning/decomposition phase (the planner "brain"). When set to a known model, the planner uses it directly (bypassing budget/speed gates) while execution subtasks route normally; empty routes planning normally. Good for a strong reasoner or a Claude subscription (`claude-cli`). |
| `atlasmind.synthesisModelId` | `string` | `""` | Optional model ID pinned for the synthesis phase (summarizing results/sessions into reusable reasoning context). Symmetric to `planningModelId`; empty routes synthesis normally. |
| `atlasmind.draftModelId` | `string` | `""` | Optional model ID pinned to draft mechanical/low-stakes tasks (e.g. a fast local model). The first attempt uses it; struggle-gated escalation upgrades to a stronger model if needed. Empty routes normally. |
| `atlasmind.specialistRoutingOverrides` | `object` | `{}` | Per-domain overrides for specialist routing automation. Supported keys today are `media-generation`, `visual-analysis`, `voice`, `research`, `robotics`, and `simulation`. |
| `atlasmind.localOpenAiEndpoints` | `object[]` | `[]` | Labeled local OpenAI-compatible endpoints AtlasMind should aggregate under the Local provider. |
| `atlasmind.localOpenAiBaseUrl` | `string` | `""` | Legacy single local OpenAI-compatible endpoint fallback used only when the structured endpoint list is absent. |
| `atlasmind.azureOpenAiEndpoint` | `string` | `""` | Azure OpenAI resource endpoint for deployment-backed routing. Example: `https://your-resource.openai.azure.com`. |
| `atlasmind.azureOpenAiDeployments` | `string[]` | `[]` | Azure OpenAI deployment names AtlasMind should expose as routed models. |
| `atlasmind.bedrock.region` | `string` | `""` | AWS region used for Amazon Bedrock model invocations. Example: `us-east-1`. |
| `atlasmind.bedrock.modelIds` | `string[]` | `[]` | Amazon Bedrock model IDs AtlasMind should expose as routed models. |

**Budget modes** act as hard routing gates — `cheap` excludes expensive models entirely; `expensive` allows all tiers.

**Speed modes** work similarly — `fast` excludes slower reasoning-heavy models; `considered` allows them.

`atlasmind.feedbackRoutingWeight` does not unlock or remove any models by itself. It only scales the small capped thumbs-up/thumbs-down bias AtlasMind derives from stored assistant-respo
…(truncated)

<!-- atlasmind-import
entry-path: operations/configuration-reference.md
generator-version: 2
generated-at: 2026-06-18T03:21:43.858Z
source-paths: docs/configuration.md
source-fingerprint: 0beea06b
body-fingerprint: d2587119
-->
