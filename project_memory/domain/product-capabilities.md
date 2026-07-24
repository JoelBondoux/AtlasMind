# Product Capabilities

Imported from `README.md`.

## Configuration

Key settings under `atlasmind.*` in VS Code settings:

| Setting | Default | Description |
|---|---|---|
| `budgetMode` | `balanced` | Model cost preference: `cheap`, `balanced`, `expensive`, `auto` |
| `speedMode` | `balanced` | Model speed preference: `fast`, `balanced`, `considered`, `auto` |
| `planningModelId` | `""` | Optional model ID pinned for the planning "brain" phase; empty routes planning normally |
| `synthesisModelId` | `""` | Optional model ID pinned for the synthesis (summarization) phase; empty routes synthesis normally |
| `draftModelId` | `""` | Optional model pinned to draft mechanical tasks (local-draft / frontier-escalate); empty routes normally |
| `toolApprovalMode` | `ask-on-write` | When to prompt for tool approval: `always-ask`, `ask-on-write`, `ask-on-external`, `allow-safe-readonly` |
| `dailyCostLimitUsd` | `0` | Daily spend cap in USD (0 = unlimited) |
| `agentAutoUpdateCadence` | `never` | How often to AI-refresh agent definitions: `never`, `daily`, `weekly`, `monthly`, `every-use` |
| `maxToolIterations` | `10` | Max tool-call loop iterations per agent turn |
| `loop.enabled` | `true` | Enable the autonomous Mission Loop (`/loop` + Mission Control) |
| `loop.defaultMaxIterations` | `8` | Default hard cap on Mission Loop iterations |
| `loop.defaultMaxCostUsd` | `5` | Default hard ceiling (USD) on a Mission Loop run |
| `loop.defaultMaxTokens` | `2000000` | Default cumulative token cap for a Mission Loop run |
| `loop.defaultMaxDurationMinutes` | `30` | Default wall-clock cap (minutes) for a Mission Loop run |
| `loop.maxConsecutiveNoProgress` | `2` | Stop after this many consecutive no-progress iterations |
| `loop.checkpointEveryNIterations` | `3` | Pause for approval every N iterations (0 = off) |
| `loop.checkpointAtBudgetFraction` | `0.75` | Pause when spend crosses this fraction (0..1) of the cost budget |
| `loop.requireApprovalBeforeWriteBatches` | `false` | Require approval before any write/commit iteration |
| `loop.allowDiscovery` | `true` | Allow the loop to synthesize/discover capabilities (gated) |
| `loop.goalAchievedConfidenceThreshold` | `0.7` | Min evaluator confidence to accept an `achieved` verdict |
| `allowTerminalWrite` | `false` | Allow terminal subprocesses (installs, commits) after explicit approval |
| `autoVerifyAfterWrite` | `true` | Run verification scripts after workspace writes |
| `autoStartProposedProjectRuns` | `true` | When a reply offers an autonomous project run, flow straight into it (immediate under Autopilot; cancellable notice otherwise) instead of waiting for "Proceed"; the file-count gate still applies |
| `ssotPath` | `project_memory` | Relative path to the SSOT memory folder |
| `localOpenAiEndpoints` | `[]` | Labeled local OpenAI-compatible endpoints (`id`/`label`/`baseUrl`) aggregated under the Local provider; managed from Settings → Models & Integrations |
| `localOpenAiBaseUrl` | `http://127.0.0.1:11434/v1` | Legacy single-endpoint fallback for Ol
…(truncated)

<!-- atlasmind-import
entry-path: domain/product-capabilities.md
generator-version: 2
generated-at: 2026-07-24T12:06:10.564Z
source-paths: README.md | package.json
source-fingerprint: 955381c5
body-fingerprint: ca109b33
-->
