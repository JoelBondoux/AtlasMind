# Configuration

All settings are prefixed with `atlasmind.` and can be configured via VS Code Settings (`Ctrl+,`) or the AtlasMind searchable page-based Settings workspace (**AtlasMind: Open Settings Panel**).

Every AtlasMind setting also includes a detailed hover tooltip inside the VS Code Settings UI. Those hovers expand on the short descriptions below with practical guidance and example values for individual workspaces, team defaults, and more scaled automation flows.

Example `settings.json` presets:

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

---

## Model Routing

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `atlasmind.budgetMode` | enum | `balanced` | Budget preference for model selection. Options: `cheap`, `balanced`, `expensive`, `auto` |
| `atlasmind.speedMode` | enum | `balanced` | Speed preference for model selection. Options: `fast`, `balanced`, `considered`, `auto` |
| `atlasmind.feedbackRoutingWeight` | number | `1` | Multiplier for thumbs-based routing bias. Use `0` to disable feedback-weighted routing or values up to `2` for a stronger but still capped influence. |
| `atlasmind.localOpenAiBaseUrl` | string | `http://127.0.0.1:11434/v1` | Base URL for a local OpenAI-compatible endpoint such as Ollama, LM Studio, or Open WebUI |
| `atlasmind.azureOpenAiEndpoint` | string | `""` | Azure OpenAI resource endpoint used for deployment-backed routing |
| `atlasmind.azureOpenAiDeployments` | string[] | `[]` | Azure OpenAI deployment names AtlasMind should surface as routed models |
| `atlasmind.bedrock.region` | string | `""` | AWS region used for Amazon Bedrock routing |
| `atlasmind.bedrock.modelIds` | string[] | `[]` | Amazon Bedrock model IDs AtlasMind should surface as routed models |

See [[Model Routing]] for details on how these settings affect model selection.

---

## Tool Approval & Safety

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `atlasmind.toolApprovalMode` | enum | `ask-on-write` | When to request user approval before running tools. Options: `always-ask`, `ask-on-write`, `ask-on-external`, `allow-safe-readonly` |
| `atlasmind.allowTerminalWrite` | boolean | `false` | Allow write-capable terminal commands (installs, builds) after explicit approval |

See [[Tool Execution]] for the full approval and safety model.

---

## Post-Write Verification

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `atlasmind.autoVerifyAfterWrite` | boolean | `true` | Run verification scripts after successful write operations |
| `atlasmind.autoVerifyScripts` | string[] | `["test"]` | Package scripts to run (e.g. `["test", "lint"]`). Names are sanitised. |
| `atlasmind.autoVerifyTimeoutMs` | number | `120000` | Max time (ms) for each verification script. Minimum: 5000 |

---

## Chat Session

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `atlasmind.chatSessionTurnLimit` | number | `6` | How many recent turns are carried forward as context. Minimum: 1 |
| `atlasmind.chatSessionContextChars` | number | `2500` | Max characters for compacted session context. Minimum: 400 |

---

## Memory (SSOT)

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `atlasmind.ssotPath` | string | `project_memory` | Relative path to the SSOT memory folder |

---

## Sidebar UI

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `atlasmind.showImportProjectAction` | boolean | `true` | Show the `Import Existing Project` toolbar button in the AtlasMind Memory view. AtlasMind Settings is always available from each AtlasMind view's three-dots menu. |

See [[Memory System]] for folder structure and retrieval details.

---

## Project Planner

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `atlasmind.projectApprovalFileThreshold` | number | `12` | Estimated changed-file count that triggers approval gating. Minimum: 1 |
| `atlasmind.projectEstimatedFilesPerSubtask` | number | `2` | Heuristic multiplier for file impact estimation. Minimum: 1 |
| `atlasmind.projectChangedFileReferenceLimit` | number | `5` | Max clickable file references shown after `/project` runs. Minimum: 1 |
| `atlasmind.projectRunReportFolder` | string | `project_memory/operations` | Folder for persisted run summary JSON reports |

## Project Ideation

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `atlasmind.ideation.crossProjectPaths` | string[] | `[]` | Paths to other project memory stores AtlasMind should surface as cross-project pattern context during ideation runs. Accepts workspace-relative or absolute paths. AtlasMind reads `project_soul.md` and the ideation board summary from each path and folds them into every context packet. |

---

## Project Governance Bootstrap

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `atlasmind.projectDependencyMonitoringEnabled` | boolean | `true` | Let AtlasMind scaffold dependency-monitoring defaults when bootstrap creates governance files. |
| `atlasmind.projectDependencyMonitoringProviders` | string[] | `["dependabot"]` | Dependency automation providers AtlasMind can scaffold today. Supported values: `dependabot`, `renovate`, `snyk`, `azure-devops`. |
| `atlasmind.projectDependencyMonitoringSchedule` | enum | `weekly` | Update cadence written into generated monitoring config. Options: `daily`, `weekly`, `monthly`. |
| `atlasmind.projectDependencyMonitoringIssueTemplate` | boolean | `true` | Add a dependency review issue template alongside the generated governance baseline. |

These settings affect AtlasMind's project bootstrap and governance scaffolding, not the repository-monitor workflow used by the AtlasMind extension itself.

See [[Project Planner]] for the full planning and execution flow.

---

## Tool Webhooks

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `atlasmind.toolWebhookEnabled` | boolean | `false` | Enable outbound webhook delivery for tool events |
| `atlasmind.toolWebhookUrl` | string | `""` | HTTPS endpoint for webhook payloads |
| `atlasmind.toolWebhookTimeoutMs` | number | `5000` | Webhook request timeout (ms). Minimum: 1000 |
| `atlasmind.toolWebhookEvents` | string[] | `["tool.started", "tool.completed", "tool.failed"]` | Events to emit. Options: `tool.started`, `tool.completed`, `tool.failed`, `tool.test` |

---

## Voice

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `atlasmind.voice.ttsEnabled` | boolean | `false` | Auto-speak freeform responses via TTS |
| `atlasmind.voice.sttEnabled` | boolean | `false` | Enable speech input controls in the Voice Panel (requires microphone) |
| `atlasmind.voice.rate` | number | `1.0` | Speech rate (0.5–2.0) |
| `atlasmind.voice.pitch` | number | `1.0` | Speech pitch (0–2.0) |
| `atlasmind.voice.volume` | number | `1.0` | Speech volume (0–1.0) |
| `atlasmind.voice.language` | string | `""` | BCP 47 language tag (e.g. `en-US`, `fr-FR`). Empty = OS default |
| `atlasmind.voice.inputDeviceId` | string | `""` | Preferred microphone device id. Current webview STT stores and preflights this preference, but Web Speech may still use the default input device. |
| `atlasmind.voice.outputDeviceId` | string | `""` | Preferred speaker device id. AtlasMind can apply it to ElevenLabs playback when the runtime supports `setSinkId`; Web Speech may still use the default output. |

AtlasMind does not yet ship an OS-native host speech backend. The current voice stack is Web Speech API in the panel plus optional ElevenLabs server-side TTS, so final device routing still depends on browser or Electron support.

---

## Budget

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `atlasmind.dailyCostLimitUsd` | number | `0` | Maximum daily spend in USD. Set to `0` for unlimited. Warns at 80%, then blocks new requests once the limit is reached. |

## Experimental

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `atlasmind.experimentalSkillLearningEnabled` | boolean | `false` | Let AtlasMind draft custom skills via the LLM. Generated code requires manual safety review. |

> **Warning:** Enabling experimental features sends additional model requests and may incur extra costs. Generated skill code should always be reviewed before use.

---

## Credentials

Routed provider credentials live in VS Code SecretStorage and are configured from **AtlasMind: Manage Model Providers**.

- Azure OpenAI uses `atlasmind.provider.azure.apiKey` plus the endpoint/deployment settings above.
- Amazon Bedrock uses `atlasmind.provider.bedrock.accessKeyId`, `atlasmind.provider.bedrock.secretAccessKey`, and optional `atlasmind.provider.bedrock.sessionToken`.
- Specialist integrations such as EXA, ElevenLabs, Stability AI, and Runway use `atlasmind.integration.<provider>.apiKey` from **AtlasMind: Specialist Integrations**.
