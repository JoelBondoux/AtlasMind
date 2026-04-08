# Configuration Reference

All AtlasMind settings live under the `atlasmind.*` namespace in VS Code.
You can change them through the searchable, page-based Settings workspace (**AtlasMind: Open Settings Panel**) or directly in `.vscode/settings.json`.

Every AtlasMind setting also includes a detailed hover tooltip inside the VS Code Settings UI. Those hovers expand on the short descriptions below with operational guidance and example values for local use, team defaults, and larger automation-heavy repositories.

Example `settings.json` presets for common setups:

```json
{
	"atlasmind.budgetMode": "balanced",
	"atlasmind.speedMode": "balanced",
	"atlasmind.toolApprovalMode": "ask-on-write",
	"atlasmind.autoVerifyAfterWrite": true,
	"atlasmind.autoVerifyScripts": ["lint", "test", "compile"]
}
```

```json
{
	"atlasmind.budgetMode": "auto",
	"atlasmind.speedMode": "auto",
	"atlasmind.toolApprovalMode": "always-ask",
	"atlasmind.projectApprovalFileThreshold": 8,
	"atlasmind.projectEstimatedFilesPerSubtask": 3,
	"atlasmind.projectDependencyMonitoringProviders": ["dependabot", "renovate", "snyk"],
	"atlasmind.projectDependencyMonitoringSchedule": "weekly",
	"atlasmind.projectRunReportFolder": "ops/atlasmind/run-reports"
}
```

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

`atlasmind.localOpenAiEndpoints` is the preferred way to configure local engines now. Each entry carries a stable `id`, a human-facing `label`, and a `baseUrl`, which lets AtlasMind keep multiple local engines online together while still showing which endpoint owns a routed model in the provider surfaces. When AtlasMind Settings opens and only the legacy `atlasmind.localOpenAiBaseUrl` is explicitly configured, AtlasMind now auto-migrates that value into the structured endpoint list once so older workspaces pick up the new UI without manual JSON edits.

Example:

```json
{
	"atlasmind.localOpenAiEndpoints": [
		{
			"id": "ollama",
			"label": "Ollama",
			"baseUrl": "http://127.0.0.1:11434/v1"
		},
		{
			"id": "lm-studio",
			"label": "LM Studio",
			"baseUrl": "http://127.0.0.1:1234/v1"
		}
	]
}
```

Use `atlasmind.localOpenAiBaseUrl` only as a backward-compatible single-endpoint fallback.

Example:

```json
{
	"atlasmind.specialistRoutingOverrides": {
		"research": {
			"preferredProvider": "perplexity",
			"budget": "expensive"
		},
		"visual-analysis": {
			"preferredProvider": "openai",
			"requiredCapabilities": ["vision"]
		}
	}
}
```

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

## Project Governance Bootstrap

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.projectDependencyMonitoringEnabled` | `boolean` | `true` | Let AtlasMind scaffold dependency monitoring defaults when bootstrap creates governance files. |
| `atlasmind.projectDependencyMonitoringProviders` | `string[]` | `["dependabot"]` | Dependency automation providers AtlasMind can scaffold today. Supported values: `dependabot`, `renovate`, `snyk`, `azure-devops`. |
| `atlasmind.projectDependencyMonitoringSchedule` | `string` | `"weekly"` | Default update cadence written into generated dependency-monitoring config. One of `daily`, `weekly`, `monthly`. |
| `atlasmind.projectDependencyMonitoringIssueTemplate` | `boolean` | `true` | Add a dependency review issue template alongside the generated governance baseline. |

These settings only affect AtlasMind's governance scaffolding for Atlas-built or newly bootstrapped repositories. When enabled, bootstrap can generate checked-in Dependabot or Renovate config, a Snyk monitoring workflow, an Azure DevOps dependency-review pipeline scaffold, plus starter SSOT policy documents under `operations/` and `decisions/`.

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
| `atlasmind.voice.inputDeviceId` | `string` | `""` | Preferred microphone device id. Today this is used as a stored preference and permission-preflight hint for webview STT; future native backends can honor it directly. |
| `atlasmind.voice.outputDeviceId` | `string` | `""` | Preferred speaker device id. AtlasMind can apply it to ElevenLabs audio playback when the runtime supports `setSinkId`; Web Speech output may still use the default device. |

AtlasMind's current voice stack is still webview-first: Web Speech API for in-panel STT and fallback TTS, plus optional ElevenLabs server-side TTS. There is not yet a host-side OS-native speech adapter, so microphone and speaker routing remains partly dependent on browser or Electron capabilities.

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
