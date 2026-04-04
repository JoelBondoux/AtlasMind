# Configuration Reference

All AtlasMind settings live under the `atlasmind.*` namespace in VS Code.
You can change them through the Settings panel (**AtlasMind: Open Settings Panel**) or directly in `.vscode/settings.json`.

## Model Routing

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.budgetMode` | `string` | `"balanced"` | Budget preference for model selection. One of `cheap`, `balanced`, `expensive`, `auto`. |
| `atlasmind.speedMode` | `string` | `"balanced"` | Speed preference for model selection. One of `fast`, `balanced`, `considered`, `auto`. |

**Budget modes** act as hard routing gates — `cheap` excludes expensive models entirely; `expensive` allows all tiers.

**Speed modes** work similarly — `fast` excludes slower reasoning-heavy models; `considered` allows them.

When either mode is set to `auto`, the task profiler infers the appropriate level from the request context.

## SSOT Memory

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.ssotPath` | `string` | `"project_memory"` | Relative path to the SSOT memory folder inside the workspace. Must be a safe relative path (no `..`, no absolute paths). |

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

## Experimental

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.experimentalSkillLearningEnabled` | `boolean` | `false` | Enable Atlas-generated custom skill drafts. Warning: this sends additional model requests, and generated code requires manual safety review before use. |

## API Keys

Provider API keys are stored in VS Code **SecretStorage** (OS keychain), never in workspace settings.
Use the **AtlasMind: Manage Model Providers** command to add or update keys.

| Provider | Secret Key | Notes |
|---|---|---|
| Anthropic | `atlasmind.provider.anthropic.apiKey` | Required for Claude models. |
| OpenAI | `atlasmind.provider.openai.apiKey` | Required for GPT-4o models. |
| Google Gemini | `atlasmind.provider.google.apiKey` | Uses the OpenAI-compatible AI Studio endpoint. |
| Mistral | `atlasmind.provider.mistral.apiKey` | Required for Mistral models. |
| DeepSeek | `atlasmind.provider.deepseek.apiKey` | Required for DeepSeek models. |
| z.ai | `atlasmind.provider.zai.apiKey` | Required for GLM-5 family models. |
| GitHub Copilot | — | Uses your signed-in VS Code session. No API key needed. |
| Local Echo | — | Offline fallback adapter. No configuration needed. |
