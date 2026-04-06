# Configuration Reference Summary

Source: `docs/configuration.md`

## Model Routing

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.budgetMode` | `string` | `"balanced"` | Budget preference for model selection. One of `cheap`, `balanced`, `expensive`, `auto`. |
| `atlasmind.speedMode` | `string` | `"balanced"` | Speed preference for model selection. One of `fast`, `balanced`, `considered`, `auto`. |
| `atlasmind.feedbackRoutingWeight` | `number` | `1` | Multiplier for thumbs-based routing bias. `0` disables feedback-weighted routing, `1` keeps the default slight influence, and `2` is the strongest supported setting. |
| `atlasmind.localOpenAiBaseUrl` | `string` | `"http://127.0.0.1:11434/v1"` | Base URL for a local OpenAI-compatible model endpoint such as Ollama, LM Studio, or Open WebUI. |
| `atlasmind.azureOpenAiEndpoint` | `string` | `""` | Azure OpenAI resource endpoint for deployment-backed routing. Example: `https://your-resource.openai.azure.com`. |
| `atlasmind.azureOpenAiDeployments` | `string[]` | `[]` | Azure OpenAI deployment names AtlasMind should expose as routed models. |
| `atlasmind.bedrock.region` | `string` | `""` | AWS region used for Amazon Bedrock model invocations. Example: `us-east-1`. |
| `atlasmind.bedrock.modelIds` | `string[]` | `[]` | Amazon Bedrock model IDs AtlasMind should expose as routed models. |

**Budget modes** act as hard routing gates — `cheap` excludes expensive models entirely; `expensive` allows all tiers.

**Speed modes** work similarly — `fast` excludes slower reasoning-heavy models; `considered` allows them.

`atlasmind.feedbackRoutingWeight` does not unlock or remove any models by itself. It only scales the small capped thumbs-up/thumbs-down bias AtlasMind derives from stored assistant-response votes.

When either mode is set to `auto`, the task profiler infers the appropriate level from the request context.

## SSOT Memory

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.ssotPath` | `string` | `"project_memory"` | Relative path to the SSOT memory folder inside the workspace. Must be a safe relative path (no `..`, no absolute paths). |

## Sidebar UI

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.showImportProjectAction` | `boolean` | `true` | Show the `Import Existing Project` toolbar button in the AtlasMind Memory view. AtlasMind Settings is always available from each AtlasMind view's three-dots menu. |

## Tool Safety & Chat Context

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.toolApprovalMode` | `string` | `"ask-on-write"` | Approval policy for tool execution. One of `always-ask`, `ask-on-write`, `ask-on-external`, `allow-safe-readonly`. |
| `atlasmind.allowTerminalWrite` | `boolean` | `false` | Permit write-capable subprocesses such as installs and commits after explicit approval. |
| `atlasmind.autoVerifyAfterWrite` | `boolean` | `true` | Run configured verification scripts after successful workspace-write tool batches. |
| `atlasmind.autoVerifyScript
…(truncated)

<!-- atlasmind-import
entry-path: operations/configuration-reference.md
generator-version: 2
generated-at: 2026-04-06T13:17:53.836Z
source-paths: docs/configuration.md
source-fingerprint: f7d2236c
body-fingerprint: d25e11da
-->
