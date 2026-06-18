# Project Memory Rule (master branch)

**Important:** The `project_memory/` folder and its contents are only present in development and feature branches. They are excluded from the `master` branch and all release builds. This is enforced by `.gitignore` and documented in the contribution guidelines. Do not expect `project_memory/` to exist on `master` or in published Marketplace packages.

If you need to reference SSOT memory or session context, use the `atlasmind.ssotPath` setting, which defaults to `project_memory`. For more details, see the [Memory System](Memory-System.md) documentation.


> **Note:** The `project_memory/` folder is only present in development and feature branches. It is excluded from the `master` branch and all release builds. This is enforced by `.gitignore` and documented in the contribution guidelines.

# User Environment Tracking

AtlasMind detects and stores each user's development environment (OS, hardware, shell, editor) in a private, user-scoped location. This data is never shared with other users or the workspace. AtlasMind uses this to tailor commands and suggestions to your environment. Multiple environments per user are supported.
# Configuration

All settings are prefixed with `atlasmind.` and can be configured via VS Code Settings (`Ctrl+,`) or the AtlasMind searchable page-based Settings workspace (**AtlasMind: Open Settings Panel**).

Every AtlasMind setting also includes a detailed hover tooltip inside the VS Code Settings UI. Those hovers expand on the short descriptions below with practical guidance and example values for individual workspaces, team defaults, and more scaled automation flows.

The default agentic execution cap is now `20` tool iterations per turn through `atlasmind.maxToolIterations`.

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
| `atlasmind.feedbackRoutingWeight` | number | `1` | Multiplier for thumbs-based routing bias (also scales the outcome-driven bias). Use `0` to disable feedback-weighted routing or values up to `2` for a stronger but still capped influence. |
| `atlasmind.planningModelId` | string | `""` | Optional model ID pinned for the planning phase (the planner "brain"). When set to a known model the planner uses it directly while execution routes normally; empty routes planning normally. |
| `atlasmind.synthesisModelId` | string | `""` | Optional model ID pinned for the synthesis phase (summarizing results/sessions). Symmetric to `planningModelId`; empty routes synthesis normally. |
| `atlasmind.draftModelId` | string | `""` | Optional model ID pinned to draft mechanical/low-stakes tasks (e.g. a fast local model); struggle-gated escalation upgrades if needed. Empty routes normally. |
| `atlasmind.specialistRoutingOverrides` | object | `{}` | Per-domain overrides for specialist routing automation. Supported domain keys today are `media-generation`, `visual-analysis`, `voice`, `research`, `robotics`, and `simulation`. |
| `atlasmind.localOpenAiEndpoints` | object[] | `[]` | Labeled local OpenAI-compatible endpoints AtlasMind should aggregate under the Local provider |
| `atlasmind.localOpenAiBaseUrl` | string | `""` | Legacy single local OpenAI-compatible endpoint fallback |
| `atlasmind.azureOpenAiEndpoint` | string | `""` | Azure OpenAI resource endpoint used for deployment-backed routing |
| `atlasmind.azureOpenAiDeployments` | string[] | `[]` | Azure OpenAI deployment names AtlasMind should surface as routed models |
| `atlasmind.bedrock.region` | string | `""` | AWS region used for Amazon Bedrock routing |
| `atlasmind.bedrock.modelIds` | string[] | `[]` | Amazon Bedrock model IDs AtlasMind should surface as routed models |

See [[Model Routing]] for details on how these settings affect model selection.

`atlasmind.specialistRoutingOverrides` sits on top of AtlasMind's live specialist-routing registry. Atlas first recomputes specialist-provider preferences from the refreshed model catalog and any discovered domain tags, then applies any matching override for the domain. Use it when you need to pin a preferred provider, disable a domain route, tighten required capabilities, or swap the fallback command Atlas opens for that specialist workflow.

`atlasmind.localOpenAiEndpoints` is now the preferred local-model setting. Each entry includes a stable `id`, a human-facing `label`, and a `baseUrl`, which lets AtlasMind keep multiple local engines online together and still show which endpoint owns each routed local model back in the provider surfaces. When AtlasMind Settings opens and only the legacy `atlasmind.localOpenAiBaseUrl` is explicitly configured, AtlasMind now auto-migrates that value into the structured endpoint list once.

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
| `atlasmind.testingPolicyOverride` | string | `""` | Optional label shown in the Project Dashboard Testing policy card. Leave empty to keep the default Red-Green TDD wording. |
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

## Agent Auto-Update

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `atlasmind.agentAutoUpdateCadence` | `string` | `"never"` | How often AtlasMind uses AI to automatically refresh user-defined agent system prompts and descriptions. One of `never`, `every-use`, `daily`, `weekly`, `monthly`. Built-in agents are never updated; individual agents can opt out via the Agent Manager. |

See [[Agents]] for full details on the update criteria and per-agent exclusion.

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
| `atlasmind.voice.hostSpeechEnabled` | boolean | `false` | Speak via the OS host engine (Windows SAPI/PowerShell, macOS `say`, Linux `espeak-ng`) instead of the in-panel Web Speech engine. On-device, no API key, works with the panel closed. ElevenLabs still takes priority when keyed; `espeak-ng` must be installed on Linux. |
| `atlasmind.voice.sttEngine` | string (`auto`\|`webspeech`\|`local`) | `auto` | Speech-to-text engine. `local` = on-device Whisper (audio stays local); `webspeech` = in-webview Web Speech API; `auto` prefers Whisper where provisionable, else Web Speech. |
| `atlasmind.voice.whisperCliPath` | string | `""` | Path to an installed whisper.cpp `whisper-cli` for on-device STT. Required on macOS/Linux (e.g. `brew install whisper-cpp`); Windows x64 auto-downloads a verified build when empty. |
| `atlasmind.voice.rate` | number | `1.0` | Speech rate (0.5–2.0) |
| `atlasmind.voice.pitch` | number | `1.0` | Speech pitch (0–2.0) |
| `atlasmind.voice.volume` | number | `1.0` | Speech volume (0–1.0) |
| `atlasmind.voice.language` | string | `""` | BCP 47 language tag (e.g. `en-US`, `fr-FR`). Empty = OS default |
| `atlasmind.voice.inputDeviceId` | string | `""` | Preferred microphone device id. Current webview STT stores and preflights this preference, but Web Speech may still use the default input device. |
| `atlasmind.voice.outputDeviceId` | string | `""` | Preferred speaker device id. AtlasMind can apply it to ElevenLabs playback when the runtime supports `setSinkId`; Web Speech may still use the default output. |
| `atlasmind.voice.elevenLabsVoiceId` | string | `""` | ElevenLabs voice id for server-side TTS. Empty uses the default demo voice (`Rachel`). Requires an ElevenLabs API key in Specialist Integrations. |

AtlasMind does not yet ship an OS-native host speech backend. The current voice stack is Web Speech API in the panel plus optional ElevenLabs server-side TTS, so final device routing still depends on browser or Electron support.

---

## Remote Control

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `atlasmind.remote.enabled` | boolean | `false` | Allow the AtlasMind web build to remote-control this desktop instance over a localhost WebSocket. Off by default; the server only listens after **AtlasMind: Enable Remote Control**, workspace approval, and a pairing token. Binds to `127.0.0.1` only. See [[Remote Control]]. |
| `atlasmind.remote.port` | number | `0` | Localhost port for the remote-control server. `0` picks a free port automatically; pin a value to keep the `ws://localhost:PORT` URL stable. |

## Budget

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `atlasmind.dailyCostLimitUsd` | number | `0` | Maximum daily spend in USD. Set to `0` for unlimited. Warns at 80%, then blocks new requests once the limit is reached. |
| `atlasmind.displayCurrency` | string | `"auto"` | Currency used for all cost displays. `"auto"` detects from OS locale. Supported: `USD`, `EUR`, `GBP`, `JPY`, `CAD`, `AUD`, `CHF`, `CNY`, `INR`, `BRL`, `MXN`, `KRW`, `SEK`, `NOK`, `DKK`, `NZD`, `SGD`, `HKD`, `ZAR`. Exchange rates are fetched from open.er-api.com on activation (24h cache). |

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
