# Product Capabilities

Imported from `README.md`.

## Configuration

AtlasMind's main settings are available in its Settings panel and under `atlasmind.*` in VS Code settings.

| Setting | Default | What it controls |
|---|---:|---|
| `budgetMode` | `balanced` | Cost preference used during model routing |
| `speedMode` | `balanced` | Latency/reasoning preference used during routing |
| `dailyCostLimitUsd` | `0` | Daily spend ceiling; `0` disables the limit |
| `toolApprovalMode` | `ask-on-write` | When tools require operator approval |
| `autoStartProposedProjectRuns` | `true` | Permit proposal auto-start only under Autopilot; otherwise show Start, Save for later, and Cancel |
| `allowTerminalWrite` | `false` | Whether approved terminal subprocesses may mutate state |
| `autoVerifyAfterWrite` | `true` | Whether configured verification runs after writes |
| `agentAutoUpdateCadence` | `never` | Optional AI refresh cadence for custom agent definitions |
| `ssotPath` | `project_memory` | Workspace-relative project-memory location |
| `localOpenAiEndpoints` | `[]` | Labeled local OpenAI-compatible endpoints |
| `loop.enabled` | `true` | Whether Mission Loop can run |
| `feedbackRoutingWeight` | `1` | Strength of saved response feedback in routing |
| `remote.enabled` | `false` | Whether desktop remote control is available |
| `buzz.enabled` | `false` | Master switch for the Buzz integration (Settings → Buzz) |
| `buzz.inboundEnabled` | `false` | Hold a read-only subscription to a Buzz relay |
| `buzz.autoCreateFollowUps` | `false` | Record derived Buzz follow-ups into git-tracked project memory |
| `buzz.agentBindings` | `{}` | Route a Buzz identity's work to an AtlasMind agent (edited per person on Dashboard → Director) |

See the [Configuration Reference](docs/configuration.md) or [wiki Configuration](wiki/Configuration.md) for every setting, accepted value, security implication, and provider-specific option.

---

<!-- atlasmind-import
entry-path: domain/product-capabilities.md
generator-version: 2
generated-at: 2026-07-28T12:06:49.103Z
source-paths: README.md | package.json
source-fingerprint: fe4c08af
body-fingerprint: c7a85900
-->
