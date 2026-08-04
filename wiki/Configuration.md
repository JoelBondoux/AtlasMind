# Configuration

**Every AtlasMind setting, what it does, and what to set it to.**

Two ways in:

- **AtlasMind's own settings workspace** — **AtlasMind: Open Settings Panel**. Searchable, organised
  into pages, and the place most of these are easier to change.
- **VS Code settings** (`Ctrl+,`) — search `atlasmind.`. Every setting has a hover tooltip with
  practical guidance and example values.

There are 114 settings. **You will probably change about six of them.**

---

## The ones that actually matter

Start here. If you change nothing else, change these.

| Setting | Default | What to do with it |
|---------|---------|-------------|
| `atlasmind.budgetMode` | `balanced` | `cheap` prefers local models and subscriptions. `auto` lets task difficulty decide. `expensive` always reaches for the best model available |
| `atlasmind.speedMode` | `balanced` | `fast` for quick answers, `considered` when you'd rather it thought properly |
| `atlasmind.dailyCostLimitUsd` | `0` | Set a number you're comfortable with. AtlasMind warns you at 80% and stops at 100%. `0` means no limit |
| `atlasmind.toolApprovalMode` | `ask-on-write` | How often you get asked. `always-ask` to watch everything; loosen it as trust builds |
| `atlasmind.autoVerifyAfterWrite` | `true` | Leave this on. It runs your own checks after every change |
| `atlasmind.ssotPath` | `project_memory` | Where project memory lives. Change it only if that folder name clashes with something |

A reasonable starting `settings.json`:

```json
{
  "atlasmind.budgetMode": "balanced",
  "atlasmind.speedMode": "balanced",
  "atlasmind.toolApprovalMode": "ask-on-write",
  "atlasmind.autoVerifyAfterWrite": true,
  "atlasmind.autoVerifyScripts": ["lint", "test", "compile"],
  "atlasmind.dailyCostLimitUsd": 5
}
```

---

## Choosing models

| Setting | Default | What it does |
|---------|---------|-------------|
| `atlasmind.budgetMode` | `balanced` | `cheap`, `balanced`, `expensive` or `auto` |
| `atlasmind.speedMode` | `balanced` | `fast`, `balanced`, `considered` or `auto` |
| `atlasmind.feedbackRoutingWeight` | `1` | How much your thumbs up/down affect future routing. `0` turns it off; up to `2` for stronger influence |
| `atlasmind.planningModelId` | `""` | Pin a specific model for planning. Empty routes normally |
| `atlasmind.synthesisModelId` | `""` | Pin a model for summarising results |
| `atlasmind.draftModelId` | `""` | Pin a fast, cheap model for mechanical work. It escalates automatically if the model struggles |
| `atlasmind.providerTimeoutMs` | `30000` | How long to wait for a provider before giving up |

### Connecting providers

| Setting | Default | What it does |
|---------|---------|-------------|
| `atlasmind.localOpenAiEndpoints` | `[]` | Your local endpoints — Ollama, LM Studio, anything OpenAI-compatible. Each gets a label |
| `atlasmind.localOpenAiBaseUrl` | `http://127.0.0.1:11434/v1` | A single local endpoint, for the simple case |
| `atlasmind.azureOpenAiEndpoint` | `""` | Your Azure OpenAI resource URL |
| `atlasmind.azureOpenAiDeployments` | `[]` | Which Azure deployments to expose as models |
| `atlasmind.bedrock.region` | `""` | Your AWS region, e.g. `us-east-1` |
| `atlasmind.bedrock.modelIds` | `[]` | Which Bedrock models to expose |

**API keys are not settings.** They live in the OS keychain, set from **AtlasMind: Manage Model
Providers**. Azure uses `atlasmind.provider.azure.apiKey`; Bedrock uses
`atlasmind.provider.bedrock.accessKeyId`, `atlasmind.provider.bedrock.secretAccessKey` and optionally
`atlasmind.provider.bedrock.sessionToken`. Search, voice and image services use
`atlasmind.integration.<provider>.apiKey`, set from **AtlasMind: Specialist Integrations**.

### Using a subscription instead

| Setting | Default | What it does |
|---------|---------|-------------|
| `atlasmind.acp.agents` | `[]` | Which subscription agents AtlasMind may use. **Empty by default — nothing runs until you name it** |
| `atlasmind.acp.toolsEnabled` | `false` | **Let subscription agents act.** Makes them eligible for tool-backed work and automatically allows their own operations, with each one logged. Off means completions only |
| `atlasmind.acp.mcpServers` | `[]` | Which MCP servers a subscription agent may reach. Empty means none |
| `atlasmind.acp.modelStanding` | `{}` | Tell AtlasMind how a subscription's models rank against each other, where it can't work that out itself |
| `atlasmind.acp.hideConsoleWindows` | `false` | Windows only — keep the agent's processes from popping up console windows. See the note in [[FAQ]] about endpoint security |

---

## What AtlasMind may do without asking

| Setting | Default | What it does |
|---------|---------|-------------|
| `atlasmind.toolApprovalMode` | `ask-on-write` | When approval is required |
| `atlasmind.allowTerminalWrite` | `false` | Whether approved terminal commands may change things (installs, commits) |
| `atlasmind.chat.revealOnApprovalRequest` | `true` | Bring the chat panel forward when something's waiting on you. You get a notification either way |
| `atlasmind.maxToolIterations` | `10` | How many tool rounds one turn may take |
| `atlasmind.maxToolCallsPerTurn` | `8` | How many tools may run at once |
| `atlasmind.toolExecutionTimeoutMs` | `15000` | Per-tool timeout |

### Checking the work

| Setting | Default | What it does |
|---------|---------|-------------|
| `atlasmind.autoVerifyAfterWrite` | `true` | Run your checks after a change |
| `atlasmind.autoVerifyScripts` | `["test"]` | Which package scripts to run. Names are sanitised and run without a shell |
| `atlasmind.autoVerifyTimeoutMs` | `120000` | How long each check may take |

---

## Conversation

| Setting | Default | What it does |
|---------|---------|-------------|
| `atlasmind.chatSessionTurnLimit` | `6` | How many recent turns come with you into the next request |
| `atlasmind.chatSessionContextChars` | `2500` | How much room that carried context gets |
| `atlasmind.contextCompressionEnabled` | `true` | Compact prompts to cut tokens and spend. Leave on |

---

## Project memory

| Setting | Default | What it does |
|---------|---------|-------------|
| `atlasmind.ssotPath` | `project_memory` | Where memory lives, relative to your workspace |
| `atlasmind.autoRefreshStaleMemory` | `false` | Re-import stale entries automatically on startup and file changes. Off by default — a refresh costs a model call |
| `atlasmind.showImportProjectAction` | `true` | Show the Import button in the Memory view |

---

## Running project work

| Setting | Default | What it does |
|---------|---------|-------------|
| `atlasmind.projectApprovalFileThreshold` | `12` | Estimated file count that requires your approval |
| `atlasmind.projectEstimatedFilesPerSubtask` | `2` | How many files each step is assumed to touch |
| `atlasmind.projectChangedFileReferenceLimit` | `5` | Clickable file links in the summary |
| `atlasmind.projectRunReportFolder` | `project_memory/operations` | Where run reports go |
| `atlasmind.autoStartProposedProjectRuns` | `true` | Let a proposed run start on its own — **only while Autopilot is on**. Otherwise you always get the decision card |

### The autonomous loop

| Setting | Default | What it does |
|---------|---------|-------------|
| `atlasmind.loop.enabled` | `true` | Whether `/loop` and Mission Control work at all |
| `atlasmind.loop.defaultMaxIterations` | `8` | Hard cap on iterations |
| `atlasmind.loop.defaultMaxCostUsd` | `5` | Hard cap on spend |
| `atlasmind.loop.defaultMaxTokens` | `2000000` | Hard cap on tokens |
| `atlasmind.loop.defaultMaxDurationMinutes` | `30` | Hard cap on wall-clock time |
| `atlasmind.loop.maxConsecutiveNoProgress` | `2` | Stop after this many iterations that got nowhere |
| `atlasmind.loop.checkpointEveryNIterations` | `3` | Pause for approval this often. `0` disables |
| `atlasmind.loop.checkpointAtBudgetFraction` | `0.75` | Pause the first time spend crosses this fraction of the budget |
| `atlasmind.loop.requireApprovalBeforeWriteBatches` | `false` | Always pause before an iteration that may write files |
| `atlasmind.loop.allowDiscovery` | `true` | Let it create new skills or find new resources to fill a genuine gap |
| `atlasmind.loop.goalAchievedConfidenceThreshold` | `0.7` | How confident the evaluator must be to declare success and stop |

### Governance scaffolding

| Setting | Default | What it does |
|---------|---------|-------------|
| `atlasmind.projectDependencyMonitoringEnabled` | `true` | Set up dependency monitoring when scaffolding governance files |
| `atlasmind.projectDependencyMonitoringProviders` | `["dependabot"]` | Which providers to scaffold for |
| `atlasmind.projectDependencyMonitoringSchedule` | `weekly` | How often |
| `atlasmind.projectDependencyMonitoringIssueTemplate` | `true` | Add a dependency-review issue template |

---

## The GitHub workflow

All off by default. See [[GitHub Workflow]].

| Setting | Default | What it does |
|---------|---------|-------------|
| `atlasmind.workflow.enabled` | `false` | The master switch. Off, the dashboard still teaches and measures — it just doesn't act |
| `atlasmind.workflow.profile` | `solo` | `solo` (one person is author, reviewer and releaser) or the small-team profile |
| `atlasmind.workflow.archetype` | `""` | What kind of project this is. Changes CI steps, release model and expected documentation |
| `atlasmind.workflow.traits` | `[]` | Facts that cut across shape — ships binaries, publishes a package, handles personal data |
| `atlasmind.workflow.maxAutomationLevel` | `observe` | **Your personal ceiling.** It can only ever lower what the project declared, never raise it |
| `atlasmind.workflow.chatGuidance` | `follow` | What happens when you ask AtlasMind to commit, push, open a PR or publish. `follow`, `inform`, `gate` or `off` |
| `atlasmind.workflow.allowIssueWrites` | `false` | May create, comment on, close or reopen issues. Every write still confirms |
| `atlasmind.workflow.allowPullRequestWrites` | `false` | May create PRs, post reviews and merge. Every write still confirms |
| `atlasmind.workflow.allowReleaseWrites` | `false` | May prepare a release — version, changelog, tag |
| `atlasmind.workflow.allowProtectedRefWrites` | `false` | May write to a protected branch. **Rarely the right answer** — a protected branch is protected for a reason |
| `atlasmind.instructions.verifyOnCommit` | `true` | Refuse a commit when an AI instruction file has a stale AtlasMind block. Verify only — it never edits your files |
| `atlasmind.debt.markers` | `[]` | Extra comment markers the tech-debt scan looks for, alongside the built-in `TODO`, `FIXME`, `HACK` and `XXX` |
| `atlasmind.testingPolicyOverride` | `""` | Which testing methodology the dashboard reports as your policy. Empty means red-green TDD |

---

## Ideation and research

| Setting | Default | What it does |
|---------|---------|-------------|
| `atlasmind.ideation.crossProjectPaths` | `[]` | Other AtlasMind projects whose ideation boards may be read for context. At most three, and nothing is ever written to them |
| `atlasmind.research.enabled` | `false` | Master switch for research scans. Off by default — a scan reaches the network and spends money |
| `atlasmind.research.automationLevel` | `observe` | The ceiling every scan is capped by. `observe` tells you one is due, `propose` drafts it, `auto` runs it |
| `atlasmind.research.scans` | `{}` | Per-scan settings, keyed by scan id. Each takes `enabled`, `cadenceDays` and `automationLevel` |
| `atlasmind.research.searchSource` | `auto` | Where scans look: `auto`, `exa`, `mcp`, `web-fetch` or `none`. With nothing usable, AtlasMind says it couldn't look rather than guessing |
| `atlasmind.research.monthlySpendCapUsd` | `0` | The most automatic runs may spend per month. **`0` means nothing runs on its own**, whatever its level. Scans you start yourself aren't capped here |

---

## Finding new capabilities

| Setting | Default | What it does |
|---------|---------|-------------|
| `atlasmind.ard.enabled` | `true` | Whether Resource Discovery is available. The individual finders still ship switched off |
| `atlasmind.ard.federationMode` | `referrals` | How far a search follows references between catalogues |
| `atlasmind.ard.maxResults` | `10` | Results per search |
| `atlasmind.ard.requestTimeoutMs` | `15000` | Per-request timeout |
| `atlasmind.ard.allowInsecureEndpoints` | `false` | Allow finders using plain HTTP or localhost |

---

## Cost

| Setting | Default | What it does |
|---------|---------|-------------|
| `atlasmind.dailyCostLimitUsd` | `0` | Daily ceiling. Warns at 80%, stops at 100%. `0` disables |
| `atlasmind.displayCurrency` | `USD` | Show costs in your own currency, converted at live rates |

---

## Agents

| Setting | Default | What it does |
|---------|---------|-------------|
| `atlasmind.agentAutoUpdateCadence` | `never` | How often your **custom** agents' prompts get refreshed. Built-ins are never touched |
| `atlasmind.experimentalSkillLearningEnabled` | `false` | Let Atlas draft new skills. Costs extra model calls, and drafts still pass the security scanner |

---

## Voice

| Setting | Default | What it does |
|---------|---------|-------------|
| `atlasmind.voice.ttsEnabled` | `false` | Read responses aloud |
| `atlasmind.voice.sttEnabled` | `false` | Show the voice input button (needs microphone access) |
| `atlasmind.voice.hostSpeechEnabled` | `false` | Use your operating system's speech engine instead of the browser one |
| `atlasmind.voice.sttEngine` | `auto` | On-device Whisper, or the browser's speech recognition |
| `atlasmind.voice.whisperCliPath` | `""` | Path to `whisper-cli` for on-device speech-to-text |
| `atlasmind.voice.rate` | `1` | Speaking speed |
| `atlasmind.voice.pitch` | `1` | Pitch |
| `atlasmind.voice.volume` | `1` | Volume |
| `atlasmind.voice.language` | `""` | A language tag like `en-US`. Empty follows your system |
| `atlasmind.voice.inputDeviceId` | `""` | Preferred microphone |
| `atlasmind.voice.outputDeviceId` | `""` | Preferred speaker |
| `atlasmind.voice.elevenLabsVoiceId` | `""` | Which ElevenLabs voice to use |

---

## Remote control

| Setting | Default | What it does |
|---------|---------|-------------|
| `atlasmind.remote.mode` | `localhost` | `localhost` for same-machine pairing, `gateway` for cross-machine behind your own sign-in |
| `atlasmind.remote.port` | `0` | `0` picks a free port. Pin it for gateway mode |
| `atlasmind.remote.enabled` | `false` | ⚠️ **Declared but not read** — changing it has no effect today. Remote control is started and stopped by the **Enable / Disable Remote Control** commands |

---

## Keeping the machine awake

For long runs, a live connection, or a gateway session.

| Setting | Default | What it does |
|---------|---------|-------------|
| `atlasmind.presence.keepAwake` | `false` | Stop the system sleeping while something needs to stay online |
| `atlasmind.presence.keepDisplayAwake` | `false` | Also keep the screen on. Off by default — the system stays up, the display can sleep |
| `atlasmind.presence.acPowerOnly` | `true` | Only while on mains power. Leave this on |
| `atlasmind.presence.maxAwakeMinutes` | `240` | Release the lock after this long regardless. A backstop, not a target |

---

## Buzz messaging

| Setting | Default | What it does |
|---------|---------|-------------|
| `atlasmind.buzz.enabled` | `false` | Master switch |
| `atlasmind.buzz.relayMode` | `undecided` | Which way you run Buzz, so the setup guide only shows the relevant path |
| `atlasmind.buzz.relayUrl` | `ws://localhost:3000` | Your relay. Defaults to a local one |
| `atlasmind.buzz.allowRemoteRelay` | `false` | Permit a non-local relay. Off keeps project data on your machine |
| `atlasmind.buzz.inboundEnabled` | `false` | Subscribe to activity and turn it into work items |
| `atlasmind.buzz.inboundChannels` | `[]` | Which channels. Empty means every channel your key can read |
| `atlasmind.buzz.autoCreateFollowUps` | `false` | Record inbound activity as follow-ups. Off by default — project memory is committed to your repository |
| `atlasmind.buzz.agentBindings` | `{}` | Route a particular person's messages to a particular AtlasMind agent |
| `atlasmind.buzz.autonomousReplies` | `false` | ⚠️ **Declared but not active** — nothing reads it yet |
| `atlasmind.buzz.autonomousReplyLimitPerHour` | `10` | ⚠️ **Declared but not active** — nothing reads it yet |

---

## Webhooks

| Setting | Default | What it does |
|---------|---------|-------------|
| `atlasmind.toolWebhookEnabled` | `false` | Send tool events to an external endpoint |
| `atlasmind.toolWebhookUrl` | `""` | The HTTPS endpoint |
| `atlasmind.toolWebhookTimeoutMs` | `5000` | Request timeout |
| `atlasmind.toolWebhookEvents` | `["tool.started","tool.completed","tool.failed"]` | Which events to send |

---

## Related

- [[Getting Started]] — the settings you'll want on day one
- [[Model Routing]] — what the budget and speed settings actually do
- [[Tool Execution]] — the approval settings in context
- [[Security]] — where credentials live and why
