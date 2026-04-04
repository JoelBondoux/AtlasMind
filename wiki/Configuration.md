# Configuration

All settings are prefixed with `atlasmind.` and can be configured via VS Code Settings (`Ctrl+,`) or the AtlasMind Settings panel (**AtlasMind: Open Settings**).

---

## Model Routing

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `atlasmind.budgetMode` | enum | `balanced` | Budget preference for model selection. Options: `cheap`, `balanced`, `expensive`, `auto` |
| `atlasmind.speedMode` | enum | `balanced` | Speed preference for model selection. Options: `fast`, `balanced`, `considered`, `auto` |

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

See [[Memory System]] for folder structure and retrieval details.

---

## Project Planner

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `atlasmind.projectApprovalFileThreshold` | number | `12` | Estimated changed-file count that triggers approval gating. Minimum: 1 |
| `atlasmind.projectEstimatedFilesPerSubtask` | number | `2` | Heuristic multiplier for file impact estimation. Minimum: 1 |
| `atlasmind.projectChangedFileReferenceLimit` | number | `5` | Max clickable file references shown after `/project` runs. Minimum: 1 |
| `atlasmind.projectRunReportFolder` | string | `project_memory/operations` | Folder for persisted run summary JSON reports |

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
| `atlasmind.voice.sttEnabled` | boolean | `false` | Show voice input button (requires microphone) |
| `atlasmind.voice.rate` | number | `1.0` | Speech rate (0.5–2.0) |
| `atlasmind.voice.pitch` | number | `1.0` | Speech pitch (0–2.0) |
| `atlasmind.voice.volume` | number | `1.0` | Speech volume (0–1.0) |
| `atlasmind.voice.language` | string | `""` | BCP 47 language tag (e.g. `en-US`, `fr-FR`). Empty = OS default |

---

## Budget

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `atlasmind.dailyCostLimitUsd` | number | `0` | Maximum daily spend in USD. Set to `0` for unlimited. Triggers a warning at 80% and blocks requests at 100%. |

## Experimental

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `atlasmind.experimentalSkillLearningEnabled` | boolean | `false` | Let AtlasMind draft custom skills via the LLM. Generated code requires manual safety review. |

> **Warning:** Enabling experimental features sends additional model requests and may incur extra costs. Generated skill code should always be reviewed before use.
