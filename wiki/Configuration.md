# Project Memory Rule (main branch)

**Important:** The `project_memory/` folder is **tracked in git and is present on `main`** — only `sessions/`, `temp/`, `project-run-*.json`, and `.delivery-lock.json` are gitignored. What keeps it out of published Marketplace packages is `.vscodeignore`, not `.gitignore`, so do not expect `project_memory/` inside an installed extension.

If you need to reference SSOT memory or session context, use the `atlasmind.ssotPath` setting, which defaults to `project_memory`. For more details, see the [Memory System](Memory-System.md) documentation.


> **Note:** The `project_memory/` folder is **tracked in git and is present on `main`** — only `sessions/`, `temp/`, `project-run-*.json`, and `.delivery-lock.json` are gitignored. What keeps it out of published Marketplace packages is `.vscodeignore`, not `.gitignore`.

# User Environment Tracking

AtlasMind detects and stores each user's development environment (OS, hardware, shell, editor) in a private, user-scoped location. This data is never shared with other users or the workspace. AtlasMind uses this to tailor commands and suggestions to your environment. Multiple environments per user are supported.
# Configuration

All settings are prefixed with `atlasmind.` and can be configured via VS Code Settings (`Ctrl+,`) or the AtlasMind searchable page-based Settings workspace (**AtlasMind: Open Settings Panel**).

Every AtlasMind setting also includes a detailed hover tooltip inside the VS Code Settings UI. Those hovers expand on the short descriptions below with practical guidance and example values for individual workspaces, team defaults, and more scaled automation flows.

The default agentic execution cap is `10` tool iterations per turn through `atlasmind.maxToolIterations`.

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
| `atlasmind.localOpenAiEndpoints` | object[] | `[]` | Labeled local OpenAI-compatible endpoints AtlasMind should aggregate under the Local provider |
| `atlasmind.localOpenAiBaseUrl` | string | `""` | Legacy single local OpenAI-compatible endpoint fallback |
| `atlasmind.azureOpenAiEndpoint` | string | `""` | Azure OpenAI resource endpoint used for deployment-backed routing |
| `atlasmind.azureOpenAiDeployments` | string[] | `[]` | Azure OpenAI deployment names AtlasMind should surface as routed models |
| `atlasmind.bedrock.region` | string | `""` | AWS region used for Amazon Bedrock routing |
| `atlasmind.bedrock.modelIds` | string[] | `[]` | Amazon Bedrock model IDs AtlasMind should surface as routed models |

See [[Model Routing]] for details on how these settings affect model selection.

Specialist-provider preferences are derived from refreshed model metadata, including domain tags such as research or visual analysis. **There is no override setting.** `atlasmind.specialistRoutingOverrides` shipped once and was removed from both the manifest and the code in April 2026; this page went on describing it for three months afterwards. Pin a provider through the Model Providers panel instead.

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
| `atlasmind.contextCompressionEnabled` | boolean | `true` | Compact the prompt context to cut token volume and estimated spend on long conversations. |
| `atlasmind.instructions.verifyOnCommit` | boolean | `true` | Refuse a commit when a managed block in an AI instruction file no longer matches the file it was generated from. **Verify only — never edits anything**, so the commit you staged is the one that lands; it refuses and names the fix, like the version-bump check. Checks only the file-generated blocks (testing matrix, workflow) — the debt-marker block comes from a setting a hook cannot read. Skip with `ATLASMIND_SKIP_INSTRUCTION_CHECK=1`. Stored in **workspace** scope, because a git hook cannot see a User value. |
| `atlasmind.maxToolCallsPerTurn` | number | `8` | Most parallel tool calls the model may issue in one turn. |
| `atlasmind.toolExecutionTimeoutMs` | number | `15000` | Per-tool execution timeout, in milliseconds. |
| `atlasmind.providerTimeoutMs` | number | `30000` | Longest AtlasMind waits for a model provider to respond, in milliseconds. |

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
| `atlasmind.autoRefreshStaleMemory` | boolean | `false` | Automatically re-import stale imported SSOT entries on startup/file changes (expensive LLM re-summarization). Off by default; staleness is still flagged for on-demand Update Memory. |

See [[Memory System]] for folder structure and retrieval details.

---

## Project Planner

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `atlasmind.autoStartProposedProjectRuns` | boolean | `true` | Permit proposed runs to auto-start only while Autopilot is on. Interactive chat shows **Start run**, **Save for later**, and **Cancel**; saving creates a reviewed preview in Project Run Center. Set `false` to require the decision card even under Autopilot. The file-count safety gate still applies |
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

## Resource Discovery (ARD)

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `atlasmind.ard.enabled` | boolean | `true` | Enable [[Resource Discovery]]: the panel, `/discover`, and the read-only `discover-resources` skill |
| `atlasmind.ard.federationMode` | string | `referrals` | Federation across registries: `auto`, `referrals`, or `none` |
| `atlasmind.ard.maxResults` | number | `10` | Maximum results per discovery search (1–100) |
| `atlasmind.ard.requestTimeoutMs` | number | `15000` | Per-request timeout for ARD calls (ms, 1000–60000) |
| `atlasmind.ard.allowInsecureEndpoints` | boolean | `false` | Allow `http://`/localhost Agent Finders (e.g. the conformance demo); otherwise HTTPS is required and private hosts rejected |

Agent Finders ship **disabled** and are managed from the Resource Discovery tab in Settings (or its sidebar tree); they are stored in globalState, not settings.

---

## MCP Servers

**Settings → MCP Servers** shows each registered server's transport, live status, tool count, and error, with Enable / Connect / Disconnect. Disabling disconnects rather than just relabelling. Adding and editing servers stays in the dedicated MCP manager, linked from the page.

---

## Chat Attention

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `atlasmind.chat.revealOnApprovalRequest` | boolean | `true` | Bring the AtlasMind chat panel forward when a tool approval is waiting. A notification naming the action is shown either way, so turning this off stops the interruption without leaving you unaware. Nothing is announced while the panel is already on screen. |

---

## Buzz (agentic comms)

Integration with [Buzz](https://buzz.xyz) — the open-source, Nostr-based workspace for humans and AI agents. Deny-by-default; nothing connects until you opt in. See [[Architecture]] and the `project_memory/roadmap/buzz-integration.md` roadmap.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `atlasmind.buzz.enabled` | boolean | `false` | Enable Buzz integration: record Buzz identities/channels and allow the bundled Buzz Communications MCP bridge to connect. Live Director sends additionally require the guided connector, a pinned official CLI, and the per-project `outboundEnabled` gate. |
| `atlasmind.buzz.relayUrl` | string | `ws://localhost:3000` | Buzz relay URL (`BUZZ_RELAY_URL`); defaults to a local self-hosted relay. A remote relay sends project data off-machine and additionally requires `atlasmind.buzz.allowRemoteRelay`. |
| `atlasmind.buzz.relayMode` | string | `undecided` | `undecided`, `local`, or `hosted` — which way you run Buzz, so `/buzz` shows only the path that applies. Set by answering the guide; it changes guidance only and connects nothing. |
| `atlasmind.buzz.inboundEnabled` | boolean | `false` | Hold a **read-only** Buzz subscription and derive work items. Also requires `atlasmind.buzz.enabled`; can never publish to Buzz. |
| `atlasmind.buzz.inboundChannels` | string[] | `[]` | Buzz channel ids (UUIDs) to watch. Empty = every channel the agent key can read. |
| `atlasmind.buzz.autoCreateFollowUps` | boolean | `false` | Record inbound activity as follow-ups. Off by default — `project_memory/` is git-tracked, so this is opt-in. |
| `atlasmind.acp.agents` | array | `[]` | ACP agents to use as subscription-backed capacity: `[{"id": "claude", "command": "claude-agent-acp"}, {"id": "gemini", "command": "gemini", "args": ["--acp"]}]`. Empty by default; you name a command you already have installed. **`args` matters:** `gemini`, `copilot` and `qwen` are interactive CLIs until the ACP flag is passed, so an entry without it starts a prompt that never answers. By default a completion source only — no MCP pass-through, permission requests refused. See [[Model-Routing]] → ACP agents. |
| `atlasmind.workflow.enabled` | boolean | `false` | Master switch for [[GitHub Workflow\|the guided GitHub workflow]]. Off by default: the Workflow page still teaches and measures, it simply never acts. Turning it on does not by itself permit anything — the effective level for a stage is the *minimum* of this, your ceiling, the matching capability switch, and the stage's own declared level. All four default closed. |
| `atlasmind.workflow.profile` | string | `solo` | `solo`, `studio`, or `custom`. Solo requires **zero** approvals and makes CI the reviewer, because requiring self-approval trains you to dismiss a gate. Studio requires at least one approver distinct from the author. A profile *seeds* a configuration; it does not govern one. |
| `atlasmind.workflow.maxAutomationLevel` | string | `observe` | Your personal ceiling: `off`, `observe`, `draft`, `propose`, `auto`. Can only ever **lower** the project's declared level, never raise it. |
| `atlasmind.workflow.archetype` | string | `""` | What kind of project this is: `game`, `website`, `web-app`, `api`, `cli`, `library`, `desktop`, `mobile`, `generic`. Changes CI steps, release model, testing recommendations, expected documentation and refactor advice. Empty means **undeclared** — AtlasMind detects a suggestion but never treats it as a decision you made. |
| `atlasmind.workflow.traits` | string[] | `[]` | Facts cutting across the project's shape: `ships-binaries`, `has-native-build`, `is-published-package`, `has-ui`, `has-server`, `platform-hosted`, `handles-personal-data`. Each **adds** expectations on top of the archetype rather than replacing them. |
| `atlasmind.debt.markers` | array | `[]` | Extra comment markers the tech-debt scan looks for, beyond `TODO`, `FIXME`, `HACK` and `XXX`. Written as `NAME` or `NAME:severity` — an unqualified marker is **medium**, because somebody who declared a marker is asserting something is wrong. Each becomes a *declared rule*, named on every entry it grades and published in the rule table, which is what keeps grades comparable. The built-in four cannot be redefined (a project grading its own `TODO` as high would make two registers incomparable), and a marker mentioning a credential is graded high whatever you called it. |
| `atlasmind.workflow.allowIssueWrites` | boolean | `false` | Permit issue create / comment / edit / close / reopen. Every write still confirms first, naming the repository and the exact action. AtlasMind never auto-closes an issue — closing somebody's report is a social act, not a cleanup task. |
| `atlasmind.workflow.allowPullRequestWrites` | boolean | `false` | Permit PR creation, review and merge. Incoming review comments are treated as untrusted input regardless of this setting: anyone who can comment can write text designed to read as an instruction, so review bodies are always sanitized and fenced before an agent sees them. |
| `atlasmind.workflow.allowReleaseWrites` | boolean | `false` | Permit version bump and changelog entry. Tagging and publishing stay human-triggered even with this on, and release notes are the changelog section **verbatim** — never model-generated. |
| `atlasmind.workflow.allowProtectedRefWrites` | boolean | `false` | A hard ceiling rather than an ordinary preference. With it off, unattended automation is *unreachable* for any stage whose base is protected. AtlasMind never force-pushes regardless. |
| `atlasmind.acp.toolsEnabled` | boolean | `false` | Let ACP agents run their own tools, approving each operation. Off by default. AtlasMind never accepts an agent's "always allow" — it answers "allow once", so no grant ends up somewhere you cannot revoke it — and a missing approval gate denies rather than opens. |
| `atlasmind.acp.mcpServers` | array | `[]` | MCP servers an ACP agent may use, by name. Empty by default. Servers holding SecretStorage credentials and HTTP/SSE servers are never forwarded. |
| `atlasmind.buzz.agentBindings` | object | `{}` | Assign AtlasMind agents to Buzz agents: `{"npub1…": "devops-engineer"}`, or several with `{"npub1…": ["api-designer", "ux-reviewer"]}`. The first owns the work; the rest are recorded as also-relevant. Unbound identities stay unassigned. |
| `atlasmind.buzz.allowRemoteRelay` | boolean | `false` | Allow a non-local Buzz relay URL. When `false`, only loopback/localhost relays are used so project data stays on-machine. |

| `atlasmind.buzz.autonomousReplies` | boolean | `false` | Let AtlasMind agents reply to **bound** Buzz agents without a dialog per message. Only applies to identities in `agentBindings`; anyone unbound is treated as a person and still confirms. |
| `atlasmind.buzz.autonomousReplyLimitPerHour` | number | `10` | Cap on autonomous replies per recipient per hour. At the cap the next message falls back to a dialog rather than being dropped. |

**Where to set these.** All of the above live on the **Settings → Buzz** page (Connection · Inbound · Persistence · Routing). The gates are nested, so a control whose parent is off is dimmed and disabled while still showing its stored value.

**Picking a handle.** With inbound on, the person form offers the Buzz identities AtlasMind has seen, by the name each published for itself, plus your own identity derived from the stored agent key. Nothing is guessed from a person's name.

**Binding agents to a person.** On **Project Dashboard → Director**, add or edit a person, give them a `buzz` channel (alongside any others they have — a person can hold several), pick their identity from the observed list or paste their `npub…` key, and tick the AtlasMind agents that should own their work. That writes `atlasmind.buzz.agentBindings`, which stays the single source of truth — the roster is a convenience editor for it, not a second store. A mistyped `npub` is refused rather than bound to a different identity, an `nsec` is refused by name, and a binding to an agent that does not exist is rejected. Bound people show a `buzz → <agent>` badge on their card.

Set up live sends from **AtlasMind: Manage MCP Servers → Browse by category → Buzz Communications**. The bundled bridge wraps official `buzz-cli` v0.4.26, keeps the private key and optional authorization tag in SecretStorage, and exposes only channel listing/posting, thread reading, and DMs. It converts the WS/WSS setting to the CLI's HTTP/HTTPS base; remote relays require both `allowRemoteRelay:true` and TLS.

Only `https` Buzz workspace links are launchable from AtlasMind. An npub / @handle / #channel stays display-only unless it is represented by a bridge-valid channel UUID or 64-character public key. Channels and deep links are sanitised at the webview boundary like every other Director channel.

---

## Presence & Power (keep-awake)

Keep this computer awake so an activity that must stay online — a long Mission Loop run, a Remote Control gateway session, or a connected Buzz presence — isn't killed by system sleep. Backed by the `PresenceManager` core service, which spawns an OS-native wake lock (Windows `SetThreadExecutionState`, macOS `caffeinate`, Linux `systemd-inhibit`) since a VS Code extension can't use Electron's `powerSaveBlocker`. Deny-by-default.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `atlasmind.presence.keepAwake` | boolean | `false` | Keep the computer awake while an activity needs the agent online (Mission Loop / Remote Control gateway / Buzz presence). Lock acquired only while needed and released when the activity ends. |
| `atlasmind.presence.keepDisplayAwake` | boolean | `false` | Also keep the display on when keep-awake is active. Default lets the screen sleep (lower power). No effect unless `keepAwake` is `true`. |
| `atlasmind.presence.acPowerOnly` | boolean | `true` | Only keep awake on AC (mains) power; auto-suspended on battery so an unplugged laptop is never drained, and resumed when power returns. |
| `atlasmind.presence.maxAwakeMinutes` | number | `240` | Safety backstop that auto-releases the wake lock after N minutes even if the activity is still running (0 = until it ends; range 0–1440). |

A status-bar indicator shows when the machine is held awake (and when it's paused on battery); click it, or run **AtlasMind: Toggle Keep Computer Awake** (`atlasmind.togglePresence`), to stop. No untrusted input is ever passed to the spawned OS helper.

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
| `atlasmind.remote.mode` | string | `localhost` | Transport/auth mode: `localhost` pairs a same-machine web client with the token; `gateway` fronts the server with your own SSO-gated Cloudflare Worker + tunnel so a browser signed into your login can reach it, authenticating each connection by the `x-atlas-origin-secret` header instead of an in-band token. Enable via **AtlasMind: Enable Remote Control (Gateway)**. See [[Remote Control]]. |
| `atlasmind.remote.port` | number | `0` | Localhost port for the remote-control server. `0` picks a free port automatically; pin a value to keep the `ws://localhost:PORT` URL stable (recommended in `gateway` mode so the tunnel target stays fixed). |

## Mission Loop

The autonomous goal-seeking loop (`/loop` and [[Project Planner|Mission Control]]). Every budget value is a **hard stop**, checked before each iteration. Safety-first: deny-by-default checkpoints, validated evaluator output, gated discovery. These defaults are also editable from a dedicated **Mission Loop** page in the AtlasMind Settings dashboard.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `atlasmind.loop.enabled` | boolean | `true` | Enable the Mission Loop. When off, `/loop` and Mission Control will not start a run. |
| `atlasmind.loop.defaultMaxIterations` | number | `8` | Default hard cap on loop iterations (1–50). |
| `atlasmind.loop.defaultMaxCostUsd` | number | `5` | Default hard ceiling on cumulative USD cost for a run; enforced on top of `dailyCostLimitUsd`. |
| `atlasmind.loop.defaultMaxTokens` | number | `2000000` | Default hard ceiling on cumulative (input + output) tokens for a run. |
| `atlasmind.loop.defaultMaxDurationMinutes` | number | `30` | Default hard wall-clock cap (minutes) for a run. |
| `atlasmind.loop.maxConsecutiveNoProgress` | number | `2` | Stop after this many consecutive no-progress iterations (1–10). |
| `atlasmind.loop.checkpointEveryNIterations` | number | `3` | Pause for a deny-by-default approval checkpoint every N iterations (`0` disables). |
| `atlasmind.loop.checkpointAtBudgetFraction` | number | `0.75` | Pause the first time spend crosses this fraction (0.01–1) of the cost budget. |
| `atlasmind.loop.requireApprovalBeforeWriteBatches` | boolean | `false` | Require an approval checkpoint before any iteration that may write/commit. |
| `atlasmind.loop.allowDiscovery` | boolean | `true` | Allow synthesizing/discovering capabilities (gated by existing approval gates; prefers registered ones first). |
| `atlasmind.loop.goalAchievedConfidenceThreshold` | number | `0.7` | Min evaluator confidence (0–1) to accept an `achieved` verdict and stop successfully. |

## Budget

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `atlasmind.dailyCostLimitUsd` | number | `0` | Maximum daily spend in USD. Set to `0` for unlimited. Warns at 80%, then blocks new requests once the limit is reached. |
| `atlasmind.displayCurrency` | string | `"USD"` | Currency used for **all** cost displays app-wide (dashboards, chat, Mission Loop). Defaults to `USD`; pick a specific currency and it applies everywhere, or use `"auto"` to detect from OS locale. Supported: `USD`, `EUR`, `GBP`, `JPY`, `CAD`, `AUD`, `CHF`, `CNY`, `INR`, `BRL`, `MXN`, `KRW`, `SEK`, `NOK`, `DKK`, `NZD`, `SGD`, `HKD`, `ZAR`. Underlying costs are stored in USD; exchange rates are fetched from open.er-api.com on activation (24h cache). |

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

## Settings that were live but undeclared

Both have been read by real code for months while being absent from the manifest — so they worked if you hand-edited `settings.json` and were invisible in the Settings UI. Declared in 0.205.0.

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.testingPolicyOverride` | string | `""` | Testing methodology the Settings dashboard reports as this project's policy. Empty means Red-Green TDD, the default. **Read since 0.46 and never declared**, so it could not be found in Settings until 0.205.0. |
| `atlasmind.ideation.crossProjectPaths` | array | `[]` | Absolute paths to other AtlasMind projects whose ideation boards may be read for cross-project context. At most three are consulted, and nothing is ever written to another project. **Read since 0.86 and never declared**, so it could not be found in Settings until 0.205.0. |
