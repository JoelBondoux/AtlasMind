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
| `allowTerminalWrite` | `false` | Allow terminal subprocesses (installs, commits) after explicit approval |
| `autoVerifyAfterWrite` | `true` | Run verification scripts after workspace writes |
| `ssotPath` | `project_memory` | Relative path to the SSOT memory folder |
| `localOpenAiBaseUrl` | `http://127.0.0.1:11434/v1` | Base URL for Ollama or LM Studio |
| `toolWebhookEnabled` | `false` | Send tool execution events to an outbound webhook |
| `ard.enabled` | `true` | Enable Agentic Resource Discovery (panel, `/discover`, and the read-only `discover-resources` skill) |
| `ard.federationMode` | `referrals` | How ARD searches fan out across federated registries: `auto`, `referrals`, `none` |
| `ard.maxResults` | `10` | Maximum results returned from a discovery search |
| `ard.requestTimeoutMs` | `15000` | Timeout for each outbound ARD discovery request (ms) |
| `ard.allowInsecureEndpoints` | `false` | Allow `http://`/localhost Agent Finders (e.g. the ARD conformance demo); otherwise HTTPS is required and private hosts are rejected |
| `remote.enabled` | `false` | Allow the web build to remote-control this desktop instance over a localhost WebSocket |
| `remote.port` | `0` | Localhost port for the remote-control server (0 = auto) |

See [Configuration Reference](docs/configuration.md) and [wiki/Configuration.md](wiki/Configuration.md) for the full settings list.

---

<!-- atlasmind-import
entry-path: domain/product-capabilities.md
generator-version: 2
generated-at: 2026-06-18T18:51:10.022Z
source-paths: README.md | package.json
source-fingerprint: ee406563
body-fingerprint: 7fe03d7d
-->
