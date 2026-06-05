# Product Capabilities

Imported from `README.md`.

## Configuration

Key settings under `atlasmind.*` in VS Code settings:

| Setting | Default | Description |
|---|---|---|
| `budgetMode` | `balanced` | Model cost preference: `cheap`, `balanced`, `expensive`, `auto` |
| `speedMode` | `balanced` | Model speed preference: `fast`, `balanced`, `considered`, `auto` |
| `toolApprovalMode` | `ask-on-write` | When to prompt for tool approval: `always-ask`, `ask-on-write`, `ask-on-external`, `allow-safe-readonly` |
| `dailyCostLimitUsd` | `0` | Daily spend cap in USD (0 = unlimited) |
| `agentAutoUpdateCadence` | `never` | How often to AI-refresh agent definitions: `never`, `daily`, `weekly`, `monthly`, `every-use` |
| `maxToolIterations` | `10` | Max tool-call loop iterations per agent turn |
| `allowTerminalWrite` | `false` | Allow terminal subprocesses (installs, commits) after explicit approval |
| `autoVerifyAfterWrite` | `true` | Run verification scripts after workspace writes |
| `ssotPath` | `project_memory` | Relative path to the SSOT memory folder |
| `localOpenAiBaseUrl` | `http://127.0.0.1:11434/v1` | Base URL for Ollama or LM Studio |
| `toolWebhookEnabled` | `false` | Send tool execution events to an outbound webhook |

See [Configuration Reference](docs/configuration.md) and [wiki/Configuration.md](wiki/Configuration.md) for the full settings list.

---

<!-- atlasmind-import
entry-path: domain/product-capabilities.md
generator-version: 2
generated-at: 2026-06-05T14:23:25.007Z
source-paths: README.md | package.json
source-fingerprint: 96c87282
body-fingerprint: a9ac2b52
-->
