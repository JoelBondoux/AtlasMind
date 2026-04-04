# Configuration Reference

All AtlasMind settings live under the `atlasmind.*` namespace in VS Code.
You can change them through the Settings panel (**AtlasMind: Open Settings Panel**) or directly in `.vscode/settings.json`.

## Model Routing

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.budgetMode` | `string` | `"balanced"` | Budget preference for model selection. One of `cheap`, `balanced`, `expensive`, `auto`. |
| `atlasmind.speedMode` | `string` | `"balanced"` | Speed preference for model selection. One of `fast`, `balanced`, `considered`, `auto`. |
| `atlasmind.localOpenAiBaseUrl` | `string` | `"http://127.0.0.1:11434/v1"` | Base URL for a local OpenAI-compatible model endpoint such as Ollama, LM Studio, or Open WebUI. |
| `atlasmind.azureOpenAiEndpoint` | `string` | `""` | Azure OpenAI resource endpoint for deployment-backed routing. Example: `https://your-resource.openai.azure.com`. |
| `atlasmind.azureOpenAiDeployments` | `string[]` | `[]` | Azure OpenAI deployment names AtlasMind should expose as routed models. |
| `atlasmind.bedrock.region` | `string` | `""` | AWS region used for Amazon Bedrock model invocations. Example: `us-east-1`. |
| `atlasmind.bedrock.modelIds` | `string[]` | `[]` | Amazon Bedrock model IDs AtlasMind should expose as routed models. |

**Budget modes** act as hard routing gates — `cheap` excludes expensive models entirely; `expensive` allows all tiers.

**Speed modes** work similarly — `fast` excludes slower reasoning-heavy models; `considered` allows them.

When either mode is set to `auto`, the task profiler infers the appropriate level from the request context.

## SSOT Memory

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.ssotPath` | `string` | `"project_memory"` | Relative path to the SSOT memory folder inside the workspace. Must be a safe relative path (no `..`, no absolute paths). |

## Tool Safety & Chat Context

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.toolApprovalMode` | `string` | `"ask-on-write"` | Approval policy for tool execution. One of `always-ask`, `ask-on-write`, `ask-on-external`, `allow-safe-readonly`. |
| `atlasmind.allowTerminalWrite` | `boolean` | `false` | Permit write-capable subprocesses such as installs and commits after explicit approval. |
| `atlasmind.autoVerifyAfterWrite` | `boolean` | `true` | Run configured verification scripts after successful workspace-write tool batches. |
| `atlasmind.autoVerifyScripts` | `string[]` | `[`"test"`]` | Package scripts run after successful writes. Entries are sanitized and executed without shell interpolation. |
| `atlasmind.autoVerifyTimeoutMs` | `number` | `120000` | Per-script timeout in milliseconds for automatic verification. |
| `atlasmind.chatSessionTurnLimit` | `number` | `6` | Number of recent freeform turns AtlasMind carries forward into subsequent requests. |
| `atlasmind.chatSessionContextChars` | `number` | `2500` | Maximum compacted character budget reserved for session carry-forward context. |

## Project Execution (`/project`)

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.projectApprovalFileThreshold` | `number` | `12` | Estimated changed-file count that triggers approval gating before `/project` runs. |
| `atlasmind.projectEstimatedFilesPerSubtask` | `number` | `2` | Heuristic multiplier to estimate changed files from the planned subtask count. |
| `atlasmind.projectChangedFileReferenceLimit` | `number` | `5` | Maximum number of changed files surfaced as clickable references after a `/project` run. |
| `atlasmind.projectRunReportFolder` | `string` | `"project_memory/operations"` | Relative folder for persisted `/project` run summary JSON reports. |

## Tool Webhooks

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.toolWebhookEnabled` | `boolean` | `false` | Enable outbound webhook delivery for tool execution events. |
| `atlasmind.toolWebhookUrl` | `string` | `""` | HTTPS endpoint that receives tool execution webhook payloads. |
| `atlasmind.toolWebhookTimeoutMs` | `number` | `5000` | Webhook request timeout in milliseconds (minimum 1000). |
| `atlasmind.toolWebhookEvents` | `string[]` | `["tool.started", "tool.completed", "tool.failed"]` | Webhook event types to emit. Options: `tool.started`, `tool.completed`, `tool.failed`, `tool.test`. |

## Orchestrator Tunables

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.maxToolIterations` | `number` | `10` | Maximum tool-call loop iterations per agent turn (1–50). |
| `atlasmind.maxToolCallsPerTurn` | `number` | `8` | Maximum parallel tool calls the model may issue in a single turn (1–30). |
| `atlasmind.toolExecutionTimeoutMs` | `number` | `15000` | Per-tool execution timeout in milliseconds (minimum 1000). |
| `atlasmind.providerTimeoutMs` | `number` | `30000` | Maximum time to wait for a model provider response in milliseconds (minimum 5000). |

## Budget

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.dailyCostLimitUsd` | `number` | `0` | Maximum daily spend in USD. `0` = unlimited. Warns at 80%, then blocks new requests once the limit is reached. |

## Experimental

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.experimentalSkillLearningEnabled` | `boolean` | `false` | Enable Atlas-generated custom skill drafts. Warning: this sends additional model requests, and generated code requires manual safety review before use. |

## Voice

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.voice.ttsEnabled` | `boolean` | `false` | Auto-speak freeform `@atlas` responses via the Voice Panel. |
| `atlasmind.voice.sttEnabled` | `boolean` | `false` | Enable speech-to-text controls in the Voice Panel. |
| `atlasmind.voice.rate` | `number` | `1.0` | Speech synthesis rate (0.5–2.0). |
| `atlasmind.voice.pitch` | `number` | `1.0` | Speech synthesis pitch (0–2.0). |
| `atlasmind.voice.volume` | `number` | `1.0` | Speech synthesis volume (0–1.0). |
| `atlasmind.voice.language` | `string` | `""` | BCP 47 language tag for TTS/STT. Empty string uses the browser/OS default. |

## API Keys

Provider API keys are stored in VS Code **SecretStorage** (OS keychain), never in workspace settings.
Use the **AtlasMind: Manage Model Providers** command to add or update routed-provider credentials.
Use **AtlasMind: Specialist Integrations** for search, voice, image, and video providers that intentionally stay off the routed chat-provider list.

| Provider | Secret Key | Notes |
|---|---|---|
| Anthropic | `atlasmind.provider.anthropic.apiKey` | Required for Claude models. |
| OpenAI | `atlasmind.provider.openai.apiKey` | Required for GPT-4o models. |
| Google Gemini | `atlasmind.provider.google.apiKey` | Uses the OpenAI-compatible AI Studio endpoint. |
| Azure OpenAI | `atlasmind.provider.azure.apiKey` | Requires `atlasmind.azureOpenAiEndpoint` and at least one entry in `atlasmind.azureOpenAiDeployments`. |
| Mistral | `atlasmind.provider.mistral.apiKey` | Required for Mistral models. |
| DeepSeek | `atlasmind.provider.deepseek.apiKey` | Required for DeepSeek models. |
| z.ai | `atlasmind.provider.zai.apiKey` | Required for GLM-5 family models. |
| Amazon Bedrock | `atlasmind.provider.bedrock.accessKeyId`, `atlasmind.provider.bedrock.secretAccessKey`, `atlasmind.provider.bedrock.sessionToken` | Requires `atlasmind.bedrock.region` plus at least one configured Bedrock model ID. |
| GitHub Copilot | — | Uses your signed-in VS Code session. No API key needed. |
| Local | `atlasmind.provider.local.apiKey` | Optional API key for a local OpenAI-compatible endpoint. The endpoint URL itself is stored in `atlasmind.localOpenAiBaseUrl`. |

Specialist integration credentials are also stored in SecretStorage using the `atlasmind.integration.<provider>.apiKey` pattern for providers such as EXA, ElevenLabs, Stability AI, and Runway.
