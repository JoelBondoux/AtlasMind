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
| `atlasmind.feedbackRoutingWeight` | `number` | `1` | Multiplier for thumbs-based routing bias. `0` disables feedback-weighted routing, `1` keeps the default slight influence, and `2` is the strongest supported setting. Also scales the outcome-driven routing bias. |
| `atlasmind.planningModelId` | `string` | `""` | Optional model ID pinned for the planning/decomposition phase (the planner "brain"). When set to a known model, the planner uses it directly (bypassing budget/speed gates) while execution subtasks route normally; empty routes planning normally. Good for a strong reasoner or a subscription-backed agent (`acp/claude`). |
| `atlasmind.synthesisModelId` | `string` | `""` | Optional model ID pinned for the synthesis phase (summarizing results/sessions into reusable reasoning context). Symmetric to `planningModelId`; empty routes synthesis normally. |
| `atlasmind.draftModelId` | `string` | `""` | Optional model ID pinned to draft mechanical/low-stakes tasks (e.g. a fast local model). The first attempt uses it; struggle-gated escalation upgrades to a stronger model if needed. Empty routes normally. |
| `atlasmind.localOpenAiEndpoints` | `object[]` | `[]` | Labeled local OpenAI-compatible endpoints AtlasMind should aggregate under the Local provider. |
| `atlasmind.localOpenAiBaseUrl` | `string` | `""` | Legacy single local OpenAI-compatible endpoint fallback used only when the structured endpoint list is absent. |
| `atlasmind.azureOpenAiEndpoint` | `string` | `""` | Azure OpenAI resource endpoint for deployment-backed routing. Example: `https://your-resource.openai.azure.com`. |
| `atlasmind.azureOpenAiDeployments` | `string[]` | `[]` | Azure OpenAI deployment names AtlasMind should expose as routed models. |
| `atlasmind.bedrock.region` | `string` | `""` | AWS region used for Amazon Bedrock model invocations. Example: `us-east-1`. |
| `atlasmind.bedrock.modelIds` | `string[]` | `[]` | Amazon Bedrock model IDs AtlasMind should expose as routed models. |

**Budget modes** act as hard routing gates — `cheap` excludes expensive models entirely; `expensive` allows all tiers.

**Speed modes** work similarly — `fast` excludes slower reasoning-heavy models; `considered` allows them.

`atlasmind.feedbackRoutingWeight` does not unlock or remove any models by itself. It only scales the small capped thumbs-up/thumbs-down bias AtlasMind derives from stored assistant-response votes.

Specialist-provider preferences are derived from refreshed model metadata, including domain tags such as research or visual analysis. **There is no override setting.** `atlasmind.specialistRoutingOverrides` shipped once and was removed from both the manifest and the code in April 2026; this document went on describing it, with a worked example, for three months afterwards. Pin a provider through the Model Providers panel instead.

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


When either mode is set to `auto`, the task profiler infers the appropriate level from the request context.

## Agent Auto-Update

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.agentAutoUpdateCadence` | `string` | `"never"` | How often AtlasMind uses AI to automatically refresh user-defined agent system prompts and descriptions. One of `never`, `every-use`, `daily`, `weekly`, `monthly`. Built-in agents are never updated. Individual agents can opt out via the Agent Manager. |

## SSOT Memory

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.ssotPath` | `string` | `"project_memory"` | Relative path to the SSOT memory folder inside the workspace. Must be a safe relative path (no `..`, no absolute paths). |

## Sidebar UI

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.showImportProjectAction` | `boolean` | `true` | Show the `Import Existing Project` toolbar button in the AtlasMind Memory view. AtlasMind Settings is always available from each AtlasMind view's three-dots menu. |
| `atlasmind.autoRefreshStaleMemory` | `boolean` | `false` | Automatically re-import stale imported SSOT entries on startup/file changes. Off by default — the re-import is an expensive LLM re-summarization. When off, staleness is still flagged so you can refresh on demand via Update Memory. |

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
| `atlasmind.contextCompressionEnabled` | `boolean` | `true` | Enable the prompt-context compaction path, which reduces token volume and estimated spend on long conversations. |
| `atlasmind.instructions.verifyOnCommit` | `boolean` | `true` | Refuse a commit when an AtlasMind-managed block in an AI instruction file no longer matches the document it was generated from. **Verify only — it never edits a file**, so the commit you staged is the commit that lands; it refuses and names the command that fixes it, exactly as this project already treats a missing version bump. A rewriting hook would break that property, and a *bi-directional* sync at commit time would pull another agent's edits in and broadcast them to every other tool's instruction file unreviewed. Only blocks generated from **files** are checked (the testing matrix and the workflow); the debt-marker block comes from a setting a git hook cannot read, so it is left unchecked rather than approximated. A block a file does not carry is never reported. Skip one commit with `ATLASMIND_SKIP_INSTRUCTION_CHECK=1`. Read from `.vscode/settings.json`, since a hook has no VS Code host — which is why the checkbox writes **workspace** scope. |

## Project Execution (`/project`)

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.autoStartProposedProjectRuns` | `boolean` | `true` | Permit proposed runs to auto-start only while Autopilot is on. Interactive chat shows **Start run**, **Save for later**, and **Cancel**; saving creates a reviewed preview in Project Run Center. Set `false` to require this decision card even under Autopilot. The file-count safety gate still applies. |
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

## Agentic Resource Discovery (ARD)

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.ard.enabled` | `boolean` | `true` | Enable [Agentic Resource Discovery](resource-discovery.md): the Resource Discovery tab in Settings, the `/discover` chat command, and the read-only `discover-resources` skill. Discovery only locates resources; it never installs anything without your action. |
| `atlasmind.ard.federationMode` | `string` | `referrals` | How searches fan out across federated registries: `auto` (server-side merge), `referrals` (follow referral records, depth-bounded), or `none` (selected registry only). |
| `atlasmind.ard.maxResults` | `number` | `10` | Maximum results returned from a discovery search (1–100). |
| `atlasmind.ard.requestTimeoutMs` | `number` | `15000` | Timeout for each outbound ARD discovery request in milliseconds (1000–60000). |
| `atlasmind.ard.allowInsecureEndpoints` | `boolean` | `false` | Allow Agent Finders that use `http://` or `localhost` (e.g. the ARD conformance demo). When `false`, discovery requires HTTPS and rejects private/loopback addresses to prevent SSRF; followed referrals are always screened. |

Agent Finder definitions are stored in `globalState` and managed from the Resource Discovery tab in Settings (or its sidebar tree, mirroring how MCP servers are persisted), so they are not VS Code settings. The shipped defaults (GitHub Agent Finder, Hugging Face Discover) seed **disabled**.

## Buzz (agentic comms)

### MCP servers

**Settings → MCP Servers** lists every registered server with its transport, live connection status, tool count, and any error, and offers Enable / Connect / Disconnect per server. The state is read from the registry each render, so it reflects what is running rather than what was configured.

Disabling a server also disconnects it — a gate that reports itself closed while its tools stay reachable would be worse than none. Adding a server, changing its transport or arguments, and entering secrets remain in the dedicated **AtlasMind: Manage MCP Servers** panel, which this page links to; duplicating that flow would create two implementations to keep in step.

### Chat attention

| Setting | Type | Default | Description |
|---|---|---:|---|
| `atlasmind.chat.revealOnApprovalRequest` | `boolean` | `true` | Bring the AtlasMind chat panel forward when a tool approval is waiting. |

An approval **blocks the run until it is answered**, and the approval bar lives in the AtlasMind chat panel — which you may not be looking at, since VS Code has its own chat and you may be in an editor or another window entirely. Without an announcement the run simply appears to hang.

A notification naming the waiting action is shown regardless of this setting, so turning it off stops the panel taking focus without leaving you unaware. Nothing is announced while the panel is already on screen, and only newly-arrived requests announce — the pending list also changes when a request is answered.

Integration with [Buzz](https://buzz.xyz) — the open-source, Nostr-based workspace for humans and AI agents. All settings are deny-by-default; nothing connects to Buzz until you opt in. See `project_memory/roadmap/buzz-integration.md` for the phased roadmap.

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.buzz.enabled` | `boolean` | `false` | Enable Buzz integration: record Buzz identities/channels and allow the bundled Buzz Communications MCP bridge to connect. Live Director sends additionally require the guided connector, a pinned official CLI, and the per-project `outboundEnabled` gate. |
| `atlasmind.buzz.relayUrl` | `string` | `ws://localhost:3000` | Buzz relay URL (`BUZZ_RELAY_URL`). Defaults to a local self-hosted relay. A remote relay sends project data off-machine and additionally requires `atlasmind.buzz.allowRemoteRelay`. |
| `atlasmind.buzz.relayMode` | `string` | `"undecided"` | Which way you run Buzz — `undecided`, `local`, or `hosted` — so the setup guide shows only the path that applies. Set by answering the guide. It changes guidance only and connects nothing. |
| `atlasmind.buzz.autonomousReplies` | `boolean` | `false` | **Declared but not yet read by anything, so changing it currently has no effect.** When wired, it will let agents reply to bound Buzz identities without confirming each message; until then every send still asks. Documented as inert rather than omitted, because a setting that appears in the Settings UI and silently does nothing is worse than one that says so. |
| `atlasmind.buzz.autonomousReplyLimitPerHour` | `number` | `10` | **Also not yet active.** When autonomous replies are wired this will cap them per recipient per hour, after which the next message needs confirmation. |
| `atlasmind.buzz.inboundEnabled` | `boolean` | `false` | Hold a **read-only** subscription to the Buzz relay and derive AtlasMind work items from the activity. Also requires `atlasmind.buzz.enabled`. The subscription can never publish to Buzz. |
| `atlasmind.buzz.inboundChannels` | `string[]` | `[]` | Buzz channel ids (UUIDs) to watch. Empty means every channel the agent key can read. |
| `atlasmind.buzz.autoCreateFollowUps` | `boolean` | `false` | Record inbound activity as Project Director follow-ups. Off by default because `project_memory/` is git-tracked — while off, inbound items are reported, not written. |
| `atlasmind.acp.agents` | `array` | `[]` | Agent Client Protocol agents AtlasMind may use as subscription-backed completion capacity, e.g. `[{ "id": "claude", "command": "claude-agent-acp" }, { "id": "gemini", "command": "gemini", "args": ["--acp"] }]`. Empty by default: nothing is spawned until you name a command you have installed, and AtlasMind never installs or `npx`-fetches an agent behind your back. **`args` is load-bearing** for CLIs that need a flag to enter ACP mode — `gemini`, `copilot` and `qwen` are interactive REPLs without `--acp`, so an entry missing the flag starts a process that never speaks JSON-RPC. By default agents run as a completion source: no MCP pass-through, and any permission request they make is refused. `atlasmind.acp.toolsEnabled` changes that. See [ACP agents](model-routing.md#acp-agents) for the launch, authentication and token-accounting details. |
| `atlasmind.acp.hideConsoleWindows` | `boolean` | `false` | **Windows only.** Keep the ACP agent and its descendants behind one native supervisor so consoles cannot appear on the input desktop or steal focus. The helper creates a dedicated non-interactive window station/private desktop plus one `SW_HIDE` console inherited by Node, native CLIs, and later shells; descendants therefore do not allocate separate visible `conhost.exe` windows. Windows npm adapters use a real `node.exe`, not VS Code's GUI `Code.exe`. Setup asks before its first probe and records that guided choice in User settings (so setup does not dirty the repository); an explicit workspace value may still override it. Ordinary launching remains the compatibility-first choice. The bundled helper is SHA-256-pinned, receives an already-resolved executable plus argv (never a shell command), applies the creator token's default ACL to the station/desktop, inherits only stdin/stdout/stderr, never switches stations, and fails visibly if absent, changed, blocked, or Node is unavailable. The child still has the same user's filesystem/network authority: this is not a sandbox. Unusual hidden UI boundaries and a non-Authenticode-signed helper may be blocked by application control or EDR; the hash pin establishes expected bytes, not Windows reputation. Safe live-session reuse reduces visible starts even while this is off. Editable through the guided picker, the **Delegated agents (ACP)** card on Settings → Safety & Verification, and VS Code's settings editor. |
| `atlasmind.acp.modelStanding` | `object` | `{}` | Where each ACP model sits relative to its siblings, when AtlasMind cannot tell. The model *list* is always detected from the agent's own `configOptions` — nothing here declares which models a plan has — but the wire format carries no capability field, so a model matching none of the built-in naming conventions is offered with **unknown** standing: fully routable and selectable, never *preferred* on capability, because a guessed ranking would misroute every turn without telling you. Declare it here to fix that, keyed on the display name or the wire value: `{ "Luna": "light", "Terra": "balanced", "Sol": "deep" }`. Values must be `light`, `balanced`, `deep` or `unknown`; anything else is ignored rather than guessed at. Your declaration also beats the built-in naming table, so you can correct one. See [ACP agents](model-routing.md#acp-agents). |
| `atlasmind.acp.toolsEnabled` | `boolean` | `false` | **Let subscription agents act** — standing authorization for ACP operations on a routed tool-backed turn. The Orchestrator must separately authorize the exact provider request; ordinary ACP completions remain settings-isolated, receive no configured MCP servers, and have no permission policy even while this is on. On an authorized turn AtlasMind sends no function schemas, stands down its own tool loop, automatically answers each readable permission request with `allow_once`, and logs the risk/category/action instead of opening a dialog. An empty `acp.mcpServers` allowlist does not disable built-in tools. Turning the setting off is checked live and stops later requests; `allow_always` is never selected, and a missing or throwing gate still refuses. |
| `atlasmind.acp.mcpServers` | `array` | `[]` | Names of MCP servers an ACP agent may connect to. Empty by default, and only consulted when `acp.toolsEnabled` is on. Servers whose credentials live in SecretStorage are never forwarded — that would copy a key given to AtlasMind into another vendor's process — nor are HTTP/SSE servers, whose headers carry bearer tokens. Skipped servers are reported in the output channel. |
| `atlasmind.buzz.agentBindings` | `object` | `{}` | Map a Buzz identity (`npub…` or 64-char hex) to one AtlasMind agent id, or to a list of them, so inbound work from that Buzz agent lands with the right specialist. With several, the first owns the work — a follow-up has exactly one owner — and the rest are recorded as also-relevant. Unbound identities stay unassigned. |
| `atlasmind.buzz.allowRemoteRelay` | `boolean` | `false` | Allow a non-local Buzz relay URL. When `false`, only loopback/localhost relays are used so project data stays on-machine. |

### Where to set these

Every switch above is on the **Settings → Buzz** page (`AtlasMind: Open Settings`), grouped as Connection, Inbound, Persistence, and Routing. The gates are nested, so a control whose parent switch is off renders dimmed and disabled while still showing the value that is stored — an inert setting is shown as inert, not as absent.

`agentBindings` is edited per person on the **Project Dashboard → Director** tab: give a contact a `buzz` channel (a person can hold several channels at once — email, Slack, and Buzz), pick their identity from the observed list or paste their `npub…` (or 64-character hex) key, and tick the AtlasMind agents that should own their work. The setting remains the single source of truth — the roster is a convenience editor for it, not a second store — so a binding made by clicking and one typed into `settings.json` cannot disagree. Editing one binding leaves the others untouched and preserves whichever shape (record or array) is already written. A mistyped `npub` is refused with a reason rather than coerced onto a different identity, an `nsec` is refused by name, and a binding naming a non-existent agent is rejected.

Use **AtlasMind: Manage MCP Servers → Browse by category → Buzz Communications** for live outbound setup. The bundled bridge wraps official `buzz-cli` v0.4.26, stores the private key and optional authorization tag in SecretStorage, and exposes only channel listing/posting, thread reading, and DM sending. The WS/WSS setting is converted to the HTTP/HTTPS base used by the CLI. Non-local relays require `allowRemoteRelay:true` and HTTPS/WSS; message sends still require the Director's explicit confirmation.

Buzz contact channels and any launchable deep link are sanitised at the webview boundary like every other Director channel — only `https` Buzz workspace links are launchable from AtlasMind, and an npub / @handle / #channel remains display-only unless it is represented by a channel UUID or 64-character public key the bridge can validate.

## Presence & Power (keep-awake)

Keep this computer awake so an AtlasMind activity that must stay online — a long Mission Loop run, an active Remote Control gateway session, or a connected Buzz presence — is not killed by system sleep. Backed by the `PresenceManager` core service, which acquires an OS-native wake lock (Windows `SetThreadExecutionState`, macOS `caffeinate`, Linux `systemd-inhibit`) and releases it the moment it is no longer needed. All settings are deny-by-default.

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.presence.keepAwake` | `boolean` | `false` | Keep the computer awake while an activity needs the agent online (Mission Loop run / Remote Control gateway / Buzz presence). The wake lock is acquired only while needed and released when the activity ends. |
| `atlasmind.presence.keepDisplayAwake` | `boolean` | `false` | When keep-awake is active, also keep the display on. Default lets the screen sleep (lower power) while the system stays awake. Has no effect unless `keepAwake` is `true`. |
| `atlasmind.presence.acPowerOnly` | `boolean` | `true` | Only keep awake on AC (mains) power; automatically suspended on battery so an unplugged laptop is never drained, and resumed when power is reconnected. |
| `atlasmind.presence.maxAwakeMinutes` | `number` | `240` | Safety backstop that auto-releases the wake lock after N minutes even if an activity is still running (0 = hold until the activity ends). Range 0–1440. |

A status-bar indicator shows when the machine is being held awake (and when it is paused on battery); click it, or run **AtlasMind: Toggle Keep Computer Awake** (`atlasmind.togglePresence`), to stop. A VS Code extension cannot use Electron's `powerSaveBlocker`, so the lock is a spawned OS helper tied to the extension-host lifetime; no untrusted input is ever passed to it.

## Local GPU arbiter

Admits local model requests against a measured VRAM budget, so several AtlasMind code paths and
several local runtimes cannot over-commit one graphics card between them. Backed by the
`LocalModelArbiter` core service.

The problem is specific. AtlasMind can issue a local call from at least six places that never meet —
the subtask scheduler's fan-out, project bootstrap's parallel completions, the skill auto-assigner,
two background timers, and every chat turn. Ollama and LM Studio each decide what fits against
whatever free memory they see at that instant, and neither can see the other. Neither reserves
anything for the desktop: on a 24 GB card measured with no model loaded at all, 9.2 GB was already
committed to Windows, a browser and antivirus.

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.localGpu.enabled` | `boolean` | `true` | Admit local model requests against a VRAM budget. Off restores the previous behaviour, where every local request was sent immediately. |
| `atlasmind.localGpu.maxConcurrentRequests` | `number` | `2` | Concurrent local requests allowed regardless of available VRAM (1–8). Requests against an already-loaded model cost only their own context cache, so a burst against one model mostly runs in parallel; requests needing different models are serialised by the budget whatever this is set to. |
| `atlasmind.localGpu.safetyMarginMb` | `number` | `2048` | Megabytes of free VRAM left unclaimed (0–32768). Covers what the desktop will allocate *while* a model is loading. Because free memory is measured rather than assumed, this does not need to account for what Windows and your applications already hold. |
| `atlasmind.localGpu.reserveMb` | `number` | `3072` | Megabytes of the card AtlasMind will never occupy (0–131072). **A ceiling on AtlasMind's own share, not an OS reserve** — the desktop is protected by measuring free memory. `0` lets the free-memory measurement govern alone. |
| `atlasmind.localGpu.maxResidentModelsWhenUnmeasured` | `number` | `1` | Models AtlasMind may keep loaded per runtime when free VRAM cannot be measured (1–8), i.e. on AMD, Intel, Apple Silicon, or without `nvidia-smi`. Limiting *distinct resident models* is the only bound available without a memory reading; limiting concurrent requests would not help, because Ollama keeps a model in memory for minutes after a request finishes. |
| `atlasmind.localGpu.evictOwnModels` | `boolean` | `true` | Let AtlasMind unload models **it loaded itself** to reclaim room. A model you loaded by hand is never unloaded, whatever the pressure. Only released when idle, out of cooldown, and when releasing it would actually free enough — a partial eviction costs the reload for nothing. |

Two behaviours are worth knowing. When the budget stays committed past a bounded wait the request is
**refused and the turn fails over to another provider** — the local GPU is busy, so AtlasMind uses
something that is not. That refusal is classified as a capacity deferral rather than a model failure,
so a busy GPU never quarantines the endpoint or teaches the router that a working model is
unreliable. And AtlasMind **only ever unloads models it loaded itself**; a model you loaded by hand is tracked as
resident and never evicted, which is enforced in the eviction policy rather than left to convention
(a property test asserts no producible plan ever names an unowned model).

## Orchestrator Tunables

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.maxToolIterations` | `number` | `10` | Maximum tool-call loop iterations per agent turn (1–50). |
| `atlasmind.maxToolCallsPerTurn` | `number` | `8` | Maximum parallel tool calls the model may issue in a single turn (1–30). |
| `atlasmind.toolExecutionTimeoutMs` | `number` | `15000` | Per-tool execution timeout in milliseconds (minimum 1000). |
| `atlasmind.providerTimeoutMs` | `number` | `30000` | Maximum time to wait for a model provider response in milliseconds (minimum 5000). |

## Mission Loop

The autonomous goal-seeking loop (`/loop` chat command and the Mission Control panel). Every budget setting is a **hard stop**: the loop checks them before each iteration and halts when any is exceeded. The loop is safety-first — deny-by-default checkpoints, validated evaluator output, and discovery behind the existing approval gates. These defaults are also editable from a dedicated **Mission Loop** page in the AtlasMind Settings dashboard.

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.loop.enabled` | `boolean` | `true` | Enable the Mission Loop. When off, `/loop` and Mission Control will not start a run. |
| `atlasmind.loop.defaultMaxIterations` | `number` | `8` | Default hard cap on loop iterations (1–50). |
| `atlasmind.loop.defaultMaxCostUsd` | `number` | `5` | Default hard ceiling on cumulative USD cost for a run; enforced on top of `dailyCostLimitUsd`. |
| `atlasmind.loop.defaultMaxTokens` | `number` | `2000000` | Default hard ceiling on cumulative (input + output) tokens for a run. |
| `atlasmind.loop.defaultMaxDurationMinutes` | `number` | `30` | Default hard wall-clock cap (minutes) for a run. |
| `atlasmind.loop.maxConsecutiveNoProgress` | `number` | `2` | Stop after this many consecutive no-progress iterations (1–10). |
| `atlasmind.loop.checkpointEveryNIterations` | `number` | `3` | Pause for a deny-by-default approval checkpoint every N iterations (`0` disables cadence checkpoints). |
| `atlasmind.loop.checkpointAtBudgetFraction` | `number` | `0.75` | Pause the first time cumulative spend crosses this fraction (0.01–1) of the cost budget. |
| `atlasmind.loop.requireApprovalBeforeWriteBatches` | `boolean` | `false` | Require an approval checkpoint before any iteration that may write files or commit. |
| `atlasmind.loop.allowDiscovery` | `boolean` | `true` | Allow the loop to synthesize new agents/skills and use Agentic Resource Discovery to fill gaps (always behind existing approval gates; prefers registered capabilities first). |
| `atlasmind.loop.goalAchievedConfidenceThreshold` | `number` | `0.7` | Minimum evaluator confidence (0–1) required to accept an `achieved` verdict and stop the loop successfully. |

## Remote Control

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.remote.enabled` | `boolean` | `false` | Allow the AtlasMind web build to remote-control this desktop instance over a localhost WebSocket. Off by default; the server only listens after **AtlasMind: Enable Remote Control**, workspace approval, and a pairing token. Binds to `127.0.0.1` only. See [Remote Control](remote-control.md). |
| `atlasmind.remote.mode` | `string` | `localhost` | Transport/auth mode for the remote-control server. `localhost` pairs a same-machine web client with the token; `gateway` fronts the server with an SSO-gated Cloudflare Worker + Cloudflare Tunnel so a browser signed into your platform login can reach it, authenticating each connection by the `x-atlas-origin-secret` header the Worker injects instead of an in-band token. Enable via **AtlasMind: Enable Remote Control (Gateway)**. See [Remote Control](remote-control.md). |
| `atlasmind.remote.port` | `number` | `0` | Localhost port for the remote-control server. `0` picks a free port automatically; pin a value to keep the `ws://localhost:PORT` URL stable across restarts (recommended in `gateway` mode so the tunnel target stays fixed). |

## Budget

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.dailyCostLimitUsd` | `number` | `0` | Maximum daily spend in USD. `0` = unlimited. Warns at 80%, then blocks new requests once the limit is reached. |
| `atlasmind.displayCurrency` | `string` | `"USD"` | Currency used for every cost display. One of `auto` or an ISO code from `USD`, `EUR`, `GBP`, `JPY`, `CAD`, `AUD`, `CHF`, `CNY`, `INR`, `BRL`, `MXN`, `KRW`, `SEK`, `NOK`, `DKK`, `NZD`, `SGD`, `HKD`, `ZAR`. `auto` reads your OS locale. Costs are **stored in USD** and converted for display only, with rates fetched at startup and cached for 24 hours — so a rate change never rewrites a recorded spend. |

## Local CI runner

These settings are all **machine-scoped**: a repository cannot commit a configuration that lends your
computer to a different workflow, raises its resource ceiling or changes when Docker stops. The Pipeline
dashboard remains read-only until the master switch is enabled, and every run still requires one modal
confirmation after the live queue and committed workflow have passed validation.

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.ci.localRunner.enabled` | `boolean` | `false` | Permit one ephemeral Docker runner for one already-queued trusted GitHub Actions job. Does not dispatch or rerun workflows. |
| `atlasmind.ci.localRunner.workflowFile` | `string` | `"trusted-local-ci.yml"` | Filename inside `.github/workflows`. The committed file is re-read and safety-validated before every start. |
| `atlasmind.ci.localRunner.trustedBranch` | `string` | `"develop"` | Exact branch required in the workflow, queued run and current checkout. |
| `atlasmind.ci.localRunner.runnerLabel` | `string` | `"atlasmind-trusted-linux-{arch}"` | Dedicated `--no-default-labels` routing label. `{arch}` comes from Docker (`x64` or `arm64`). A duplicate workflow or registered runner refuses. |
| `atlasmind.ci.localRunner.image` | `string` | pinned GitHub runner digest | Container image. AtlasMind auto-pulls only digest-pinned references and always runs the resolved immutable image id. An installed local derivative may be selected by tag and is resolved before use. |
| `atlasmind.ci.localRunner.maxCpus` | `number` | `8` | CPU ceiling after the host reserve (25%, never fewer than 2 CPUs, measured on the real machine rather than the Docker/WSL VM) and the testing resource share; minimum viable allocation is 2. |
| `atlasmind.ci.localRunner.maxMemoryGb` | `number` | `16` | Memory ceiling after the host reserve (25%, never less than 8 GB, measured on the real machine rather than the Docker/WSL VM) and the testing resource share; minimum viable allocation is 4 GB. Container swap is disabled. |
| `atlasmind.testing.resourceShare` | `number` | `50` | The sliding scale for local test execution: the percentage of the computer's CPUs and memory that tests and checks may use. Read by the auto-verify run, the test-run skill, the Pipeline "Run here" route and the local CI container alike. The budget is the lower of this share and what the OS reserve (25%, ≥2 CPUs / 8 GB) leaves. Machine-scoped. |
| `atlasmind.ci.localRunner.shutdownPolicy` | `string` | `"ifStartedByAtlasMind"` | `ifStartedByAtlasMind`, `never`, or `always`. AtlasMind never stops Desktop when another container is running or inventory is unknown, and never manages a Linux system daemon. |

The executor is host-portable across Windows, macOS and Linux where Docker is available, but its evidence
is deliberately labelled **Linux container x64/arm64**. It is not native Windows/macOS evidence. See
[Local CI and safe runners](local-ci-and-safe-runners.md) for the trust boundary and installation guide.

## Guided GitHub workflow

The workflow is a **committed file** (`project_memory/operations/workflow.json`), not a setting: a change to how a team works should arrive as a diff with a reviewer. These settings are the *ceiling* over that file, and the two are combined as a minimum — a stage can request `auto` and still only `observe`. All four capability switches default closed. Guided bootstrap can write an explicitly selected Shopify theme/app/extension composition into this file, but it never infers that declaration or replaces an existing/future workflow document.

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.workflow.enabled` | `boolean` | `false` | Master switch for the guided GitHub workflow. Off by default: the Workflow dashboard still teaches and measures, but AtlasMind takes no action on your repository. Turning it on does not by itself permit anything. |
| `atlasmind.workflow.maxAutomationLevel` | `string` | `"observe"` | Your personal ceiling on what AtlasMind may do: `off`, `observe`, `draft`, `propose`, `auto`. Can only **lower** the project's declared level, never raise it. Defaults to read-and-display-only. |
| `atlasmind.workflow.chatGuidance` | `string` | `"follow"` | What AtlasMind does when a chat request would commit, push, branch, open a pull request, promote, or release. `follow` (default) applies the enabled declared route in the **same turn**—no second “follow the workflow” message—while preserving every existing tool approval, automation ceiling, protected-ref check, release gate, and outward-write confirmation. It never stashes or includes unrelated edits merely to make a release clean; branch-changing delivery work prefers an isolated temporary Git worktree. `inform` states the expectation and continues exactly as asked, `gate` refuses until you say to go ahead, and `off` says nothing. Detection is a published keyword table, not a model. The chat host sends the Orchestrator a narrow validated policy object; free-form checks, blockers, and commands from the committed file never become system-prompt text. Silent when no workflow is declared or the owning stage is disabled. |
| `atlasmind.workflow.profile` | `string` | `"solo"` | Which profile to teach and measure against. `solo` expects one person to be author, reviewer and releaser; `studio` expects authorship and approval to be separable; `custom` leaves it to the committed file. A profile **seeds** stages but never rewrites customised ones. |
| `atlasmind.workflow.archetype` | `string` | `""` | What kind of project this is — one of `game`, `website`, `web-app`, `api`, `cli`, `library`, `desktop`, `mobile`, `generic`. Changes CI steps, release model, testing recommendations, expected documentation and refactor advice. Empty means **undeclared**: AtlasMind detects a suggestion but never treats it as a decision. |
| `atlasmind.workflow.traits` | `string[]` | `[]` | Facts that cut across the project's shape: `ships-binaries`, `has-native-build`, `is-published-package`, `has-ui`, `has-server`, `platform-hosted`, `handles-personal-data`. Each **adds** expectations on top of the archetype rather than replacing them. |
| `atlasmind.workflow.allowIssueWrites` | `boolean` | `false` | Allow AtlasMind to create, comment on, edit, close or reopen GitHub issues. Off by default; every write still asks for confirmation naming the repository and the exact action. |
| `atlasmind.workflow.allowPullRequestWrites` | `boolean` | `false` | Allow AtlasMind to create pull requests, post reviews, and merge. Off by default; every write still confirms. |
| `atlasmind.workflow.allowReleaseWrites` | `boolean` | `false` | Allow AtlasMind to prepare releases — version bump, changelog entry, tag and GitHub Release. Off by default, and tagging and publishing stay human-triggered regardless. |
| `atlasmind.workflow.allowProtectedRefWrites` | `boolean` | `false` | Allow AtlasMind to write to a protected branch. Off by default and **rarely correct** — a protected branch exists precisely so changes reach it only through a reviewed pull request. |

## Experimental

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.experimentalSkillLearningEnabled` | `boolean` | `false` | Enable Atlas-generated custom skill drafts. Warning: this sends additional model requests, and generated code requires manual safety review before use. |

## Voice

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.voice.ttsEnabled` | `boolean` | `false` | Auto-speak freeform `@atlas` responses via the Voice Panel. |
| `atlasmind.voice.sttEnabled` | `boolean` | `false` | Enable speech-to-text controls in the Voice Panel. |
| `atlasmind.voice.hostSpeechEnabled` | `boolean` | `false` | Speak via the OS host engine (Windows SAPI/PowerShell, macOS `say`, Linux `espeak-ng`) instead of the in-panel Web Speech engine. On-device, no API key, works with the panel closed. ElevenLabs still takes priority when keyed; `espeak-ng` must be installed on Linux. |
| `atlasmind.voice.sttEngine` | `string` (`auto` \| `webspeech` \| `local`) | `auto` | Speech-to-text engine. `local` uses on-device Whisper (audio never leaves the machine); `webspeech` uses the in-webview Web Speech API; `auto` prefers Whisper where it can be provisioned, else Web Speech. |
| `atlasmind.voice.whisperCliPath` | `string` | `""` | Path to an installed whisper.cpp `whisper-cli` for on-device STT. Required on macOS/Linux (e.g. `brew install whisper-cpp`); on Windows x64 a verified build is downloaded automatically when empty. |
| `atlasmind.voice.rate` | `number` | `1.0` | Speech synthesis rate (0.5–2.0). |
| `atlasmind.voice.pitch` | `number` | `1.0` | Speech synthesis pitch (0–2.0). |
| `atlasmind.voice.volume` | `number` | `1.0` | Speech synthesis volume (0–1.0). |
| `atlasmind.voice.language` | `string` | `""` | BCP 47 language tag for TTS/STT. Empty string uses the browser/OS default. |
| `atlasmind.voice.inputDeviceId` | `string` | `""` | Preferred microphone device id. Today this is used as a stored preference and permission-preflight hint for webview STT; future native backends can honor it directly. |
| `atlasmind.voice.outputDeviceId` | `string` | `""` | Preferred speaker device id. AtlasMind can apply it to ElevenLabs audio playback when the runtime supports `setSinkId`; Web Speech output may still use the default device. |
| `atlasmind.voice.elevenLabsVoiceId` | `string` | `""` | ElevenLabs voice id for server-side TTS. Empty uses the default demo voice (`Rachel`). Requires an ElevenLabs API key configured in Specialist Integrations. |

AtlasMind's voice stack spans three backends. For TTS the priority is ElevenLabs server-side TTS (when keyed) → the on-device OS host engine (`voice.hostSpeechEnabled`: Windows SAPI/PowerShell, macOS `say`, Linux `espeak-ng`) → the in-panel Web Speech API. For STT, on-device Whisper (`voice.sttEngine`) keeps audio entirely local, with the Web Speech API as fallback. Microphone and speaker device routing still depends partly on browser or Electron capabilities.

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

## Technical debt

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.debt.markers` | array | `[]` | Extra comment markers the tech-debt scan looks for, on top of `TODO`, `FIXME`, `HACK` and `XXX`. Written as `NAME` or `NAME:severity`, e.g. `["DEBT", "REVISIT:high"]`. An unqualified marker is graded **medium**. Each becomes a declared rule, named on every entry it grades and published in `tech-debt.md`. The built-in four cannot be redefined, and a marker mentioning a credential is still graded high whatever you called it. |

## Atlas Lenses — live services

The three live lenses (Live Contract Drift, Service Reachability, Live Data Trust) are the only
part of AtlasMind that reaches a system somebody else operates. They compare the schema your
repository declares against the one a running API or database actually serves.

**They read shape and nothing else.** An API probe fetches the OpenAPI document the service
publishes, or sends a fixed GraphQL introspection query. A database probe asks a connected MCP
server's schema-reading tool what tables and columns exist. AtlasMind never issues a query that
returns rows, never composes SQL, never sends a write verb, and never follows a redirect away from
the destination you declared.

Which services may be reached is declared in `.atlasmind/lens-endpoints.json`, a committed file —
not a setting, and never a model, because a hostname nobody typed is a request to a stranger made
in your name. That file *names* a secret via `secretRef`; a document that actually contains a
token, password, or connection string is refused whole rather than quietly cleaned up.

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.lens.live.enabled` | boolean | `false` | Master switch for the live lenses. Off by default: a probe leaves this machine. Nothing is probed until you pick an endpoint — there is no automatic or background probing at any setting. |
| `atlasmind.lens.live.allowedStages` | array | `["local", "development", "staging"]` | Which declared environments a probe may reach. **`production` is deliberately absent from the default**, and an endpoint that does not state its stage counts as `unknown`, which is treated *as production*. Adding either does not skip the gate: those endpoints still require you to type the endpoint's label before each probe, mirroring the promotion runner's protected gate. An empty list means no stage is allowed, and is honoured as written. |

Two facts worth knowing before you turn this on:

- **AtlasMind bundles no database driver and stores no database credential.** A `database`
  endpoint is reached through an MCP server you have already connected and approved, and only if
  that server exposes a tool whose *name* says it reads schema (`list_tables`, `get_schema`,
  `describe_table`, …). A server offering only a generic `query` tool is not used — AtlasMind will
  not compose SQL — and the lens says so rather than trying anyway.
- **An unassessed endpoint is never reported as healthy.** A probe that was refused, timed out, or
  was never run reads as *not assessed*, separately from *unreachable*, and a drift report for an
  endpoint nobody probed carries no findings and says explicitly that this is not a finding of
  "no drift".

## UI Studio — visual-guide generation and preview

UI Studio models any interface through a selected profile, screens, content design, wireframe canvas,
UI system and implementation handoff. Every profile can render a static HTML/CSS visual guide; website
profiles additionally add sitemap/SEO, hosting and automation plans. Most of the Studio is inert; the
two actions here each have their own switch.

**They are two switches on purpose.** Writing model-authored files to disk and opening a local
network port are different decisions with different consequences, and a single control carrying
both would make the second one happen without anybody agreeing to it.

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.website.generation.enabled` | boolean | `false` | Allow the **Generate** buttons to call a model and write static HTML and CSS. Every generation shows a modal listing **each file it will write** first, and the plan is deterministic — the same sitemap and stage always produce the same list, which is what makes that dialog worth reading. Files land only in `.atlasmind/website-preview/`; your source tree is never written to. |
| `atlasmind.website.generation.maxFiles` | number | `40` | Most files one generation may write. A plan over the limit is **refused with the count**, never truncated — a half-generated site whose missing pages look like broken links is harder to diagnose than one that did not run. Hard ceiling of 120 regardless. |
| `atlasmind.website.preview.enabled` | boolean | `false` | Allow the guarded preview server. The deterministic structure/content/style draft opens in VS Code's built-in browser; a separate responsive lab uses the same URL. |
| `atlasmind.website.preview.port` | number | `0` | Port for the preview server on `127.0.0.1`. `0` picks a free one, which is almost always right. Values below 1024 are ignored and fall back to automatic. |

Four facts about the preview server, since it is the only part of Website Studio that opens a port:

- **It binds `127.0.0.1`, never `0.0.0.0`.** The address is a constant in the source and there is no
  setting to change it. The usual wildcard default would publish a client's unfinished site to
  whatever network the machine is on.
- **It serves one directory and re-checks every request against it**, comparing resolved paths with
  `path.relative` rather than a string prefix — a prefix test says `preview-evil/` is inside
  `preview/`, and on Windows it also fails on case. No directory listing, and an extension outside a
  small allowlist returns 404 rather than being offered as a download.
- **Its URL carries a random per-session token.** Any process on the machine can reach a localhost
  port, and a client's design work is not something to hand to whatever else is running.
- **It starts on demand and has explicit lifetime owners.** Stop Preview, closing UI Studio, or
  extension deactivation stops the server. Closing only the responsive lab does not break a full
  preview that may still be open in the built-in browser.

The full-preview index is always the deterministic Studio draft rebuilt from saved wireframes, safe
UI colour/type tokens, and exact Markdown content. Model-generated visual guides remain separate files
linked from that index; they never replace the meaning of the preview entry point.

Generated files are constrained the same way at three points — when the plan is built, when the
model's reply is read, and again immediately before each write. A model that returns a file the user
did not approve has it **reported, not written**, and no `.js` may be generated at all: a generated
page that can execute is a different security question from one that cannot.

## UI Studio — content and client review

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.website.content.directory` | string | `content` | Folder holding one Markdown file per page or screen, with YAML front-matter. **Files are the source of truth**; UI Studio shows an editable mirror. A path that escapes the workspace — including an absolute one — is refused and the default is used, rather than being quietly relativised. |
| `atlasmind.website.review.enabled` | boolean | `false` | Record client review comments against pages and wireframe elements. Comments transition through `open → addressed → resolved` (plus `wont-fix`) and are **never deleted**. |
| `atlasmind.website.review.includeOverlayInBuild` | boolean | `false` | Inject the comment overlay into generated pages so a client can leave feedback in their own browser. |
| `atlasmind.website.review.webhookUrl` | string | `''` | An `https` endpoint **you already own** for the overlay to POST to. Empty means export-only: the client downloads a file and you import it. |

**Placeholders are the point.** A `[PLACEHOLDER: what is needed]` marker in a content file is parsed,
counted and rendered visibly as a gap, and generation is instructed to emit markers rather than
plausible prose. A page that looks finished but is full of fiction is worse than an obviously
unfinished one, because somebody signs it off.

**Missing is not empty.** A page with no content file has not been started; a page with an empty file
was started and left blank. The two stay distinguishable at every layer, and a missing file is never
reported as "0 placeholders".

**The file wins.** Saving from the Studio re-reads first, and a file that changed underneath is
**refused rather than merged** — automatically resolving two versions of somebody's prose produces a
document neither of them wrote.

Four things about the review overlay, since it is the only place AtlasMind puts JavaScript into a
generated page:

- **The script is a frozen constant.** Hand-written in `websiteReviewBundle.ts`, never model-written,
  with nothing from the workspace interpolated into it — its configuration travels in a `data-`
  attribute as JSON. A test asserts the emitted script is byte-identical regardless of page, round or
  endpoint.
- **AtlasMind hosts nothing.** The overlay ships inside the site, so it deploys to the
  password-protected staging environment the Stack page sets up — the client's own infrastructure.
- **No endpoint is ever invented.** Unset means export-only, and the page's `connect-src` is then
  `'none'` — it cannot make a request at all. A configured endpoint must be plain `https` with no
  credentials, and becomes the only permitted origin.
- **The preview server's script exception is one named file** (`atlas-review.js`), not a widened
  extension class, and `script-src 'self'` is added to the served policy only while the overlay
  setting is on.

Imported feedback is treated as third-party text that has been through a browser we do not control:
same sanitizer as the workspace file, and the import is **idempotent** — re-sending the same export
adds nothing and never resets a comment already resolved. A comment naming an element or page that no
longer exists is **kept and flagged**, because the likeliest cause is that somebody deleted the thing
the client was asking about.

## Website Studio — stack setup

Choosing a framework and a platform does nothing on its own. **Set up this stack** is what runs
commands and writes files, and it is gated by three separate switches because they are three
genuinely different decisions.

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.website.setup.enabled` | boolean | `false` | Allow setup to run the framework's own create command, write the platform deploy config, add `dev`/`build` scripts, write a names-only `.env.example`, and create the stage branches. Every run shows a modal listing **each command with its purpose and each file with its full contents** first. |
| `atlasmind.website.setup.generateCi` | boolean | `false` | Also write a GitHub Actions deploy workflow. Gated separately because it is the one generated artefact that **acts on its own** — everything else sits inert until you look at it, but a workflow runs on GitHub's infrastructure with your secrets, and can deploy and spend money. |
| `atlasmind.website.setup.allowRemoteProjectCreation` | boolean | `false` | Allow AtlasMind to actually run `wrangler pages project create` / `netlify sites:create` / `vercel link`. Off by default: these authenticate as you and create billable resources, and a run that fails halfway leaves them orphaned with no teardown. With it off you still get the exact command to run yourself. |
| `atlasmind.website.setup.packageManager` | string | `npm` | `npm`, `pnpm`, `yarn` or `bun`. Only the leading executable and the `run`/`exec` verbs are translated; flags pass through untouched. Deliberately narrow — a general translation layer would have to model each manager's flag differences, and getting that subtly wrong produces a command that runs and does something other than what you read. |

Five properties hold regardless of the settings, and each is pinned by a test:

- **No step can run a shell.** Every executable step is `execFile(command, args)`, and every command
  is a constant in AtlasMind's source — never composed from a setting, never parsed from
  documentation, never model-generated. A test walks *every* producible plan (framework × platform ×
  package manager × gate combination) and fails on a shell metacharacter or a command naming a shell
  or a downloader.
- **No step can write outside the workspace.** Paths are validated when the plan is built and
  re-resolved against the root immediately before each write.
- **Everything is create-only.** An existing config file, `package.json` script, branch or workflow is
  reported untouched, never merged and never replaced. Re-running a setup is safe.
- **Branch creation is `git branch` only** — never checkout, never push, never force.
- **Success is re-probed, not inferred from exit codes.** A scaffold command can exit zero having done
  nothing useful; the report comes from looking at the filesystem afterwards.

A framework AtlasMind has no verified command for (`custom`, plain `static`, `wordpress-theme`) gets
**no** scaffold command and says so. A platform with no verified deploy action refuses to generate a
workflow rather than guessing one — a workflow that half-works still runs.

### Website Studio and the Delivery pipeline

Website Studio keeps its own three environments; the Delivery page has its own `DeploymentStage`s with
the backup, approval and rollback policy that promotions actually use. The two can drift, so the Stack
page **compares them and shows which fields disagree**, with both values. Comparing writes nothing.
Syncing is one-directional, confirmed, **never clears a populated Delivery field from an empty Studio
one**, and can only ever tighten promotion protection — a planning surface must not be able to remove
a guard the promotion runner relies on.

## Settings that were live but undeclared

Both of these have been read by real code for months and were absent from the manifest, so they worked if you typed them into `settings.json` by hand and were invisible in the Settings UI. Documented, functioning, and undiscoverable is the worst of the three states — declared in 0.205.0.

| Setting | Type | Default | Description |
|---|---|---|---|
| `atlasmind.testingPolicyOverride` | string | `""` | Testing methodology the Settings dashboard reports as this project's policy. Empty means Red-Green TDD, the default. **Read since 0.46 and never declared**, so it could not be found in Settings until 0.205.0. |
| `atlasmind.ideation.crossProjectPaths` | array | `[]` | Absolute paths to other AtlasMind projects whose ideation boards may be read for cross-project context. At most three are consulted, and nothing is ever written to another project. **Read since 0.86 and never declared**, so it could not be found in Settings until 0.205.0. |
| `atlasmind.research.enabled` | boolean | `false` | Master switch for research scans — the questions AtlasMind asks about the world *outside* this repository (competition, customers, technology, feature gaps, market, funding, regulation). Off by default: a scan reaches the network and spends on a model. A claim with no retrievable source is stored as a *question*, never as evidence. |
| `atlasmind.research.automationLevel` | string | `observe` | The ceiling every scan's own level is capped by. `observe` tells you a scan is due; `propose` drafts the brief; `auto` runs a due scan on activation inside the spend cap. A scan requesting more is reduced to this, and the reduction is stated. Findings always land open and need triage. |
| `atlasmind.research.scans` | object | `{}` | Per-scan overrides keyed by scan id (`competition`, `customer`, `technology`, `feature`, `market`, `funding`, `regulatory`), each accepting `enabled`, `cadenceDays` and `automationLevel`. A scan is off until switched on here. Unknown ids are ignored. |
| `atlasmind.research.searchSource` | string | `auto` | Where scans look: `auto`, `exa`, `mcp`, `web-fetch`, or `none`. With no usable source AtlasMind records that it could not look — it never falls back to what a model already believed. `web-fetch` can read a page you name but cannot find one, so discovery-shaped scans report the half they could not assess. |
| `atlasmind.research.monthlySpendCapUsd` | number | `0` | The most automatic runs may spend per month. `0` means nothing may run on its own whatever its automation level — switching research on and letting it run unattended are deliberately two decisions. Scans you start yourself are not capped here. |

## Approval modes are not a single ladder

`atlasmind.toolApprovalMode` has four values, and the last two are orthogonal axes rather than a stricter
and a looser setting. Read each as *what it lets through without asking*:

- `always-ask` — nothing.
- `ask-on-write` — reads: local, git, and `network-read` (a remote call that changes nothing).
- `ask-on-external` — everything local, **including `workspace-write`, `git-write` and
  `rollback-checkpoint`**. Prompts for `terminal-*`, `network`, `network-read` and audio.
- `allow-safe-readonly` — `read`, `git-read` and `terminal-read`. Writes and external calls prompt.

`ask-on-external` asks *did this leave the machine?*; `allow-safe-readonly` asks *did this change
something?* Neither gates a superset of the other. The manifest enum order drives the settings dropdown,
so the four render as a descending ladder — which is why the enum descriptions must keep stating what each
mode permits rather than only what it adds, and why moving from `ask-on-write` to `ask-on-external`
silently drops the write gate.

