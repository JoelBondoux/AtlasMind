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
| `atlasmind.toolApprovalMode` | `ask-on-write` | How often you get asked. See the note below — the four modes are not one ladder |
| `atlasmind.autoVerifyAfterWrite` | `true` | Leave this on. It runs your own checks after every change |
| `atlasmind.ssotPath` | `project_memory` | Where project memory lives. Change it only if that folder name clashes with something |


### The four approval modes are not one ladder

Each is best read as *what it lets through without asking*:

| Mode | Lets through without asking |
|---|---|
| `always-ask` | Nothing. |
| `ask-on-write` | Reads — local, git, and remote reads that change nothing. |
| `ask-on-external` | Everything local, **including file writes, deletes and commits**. Prompts for terminal, network and audio. |
| `allow-safe-readonly` | Local reads, git reads and terminal reads. Writes and external calls prompt. |

The last two are **different axes, not a stricter and a looser setting**. `ask-on-external` asks *did this
leave the machine?*; `allow-safe-readonly` asks *did this change something?* Neither gates a superset of
the other, so moving between them tightens one thing and loosens another — and moving from `ask-on-write`
to `ask-on-external` in the belief that it is stricter loses the file-write gate. Until v0.312.0 the
descriptions named only what each mode added, which is how that reading was available at all.


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

## Local CI runner

All local-runner settings are **machine-scoped**, so a repository cannot raise the limits or redirect your
machine by committing workspace settings. The Pipeline page validates one queued job and asks before it
starts anything.

| Setting | Default | What it does |
|---------|---------|-------------|
| `atlasmind.ci.localRunner.enabled` | `false` | Allows one ephemeral Docker runner for one already-queued trusted GitHub Actions job |
| `atlasmind.ci.localRunner.workflowFile` | `trusted-local-ci.yml` | Selects the one committed workflow AtlasMind may serve; the filename itself grants no authority |
| `atlasmind.ci.localRunner.trustedBranch` | `develop` | Requires this exact branch in the workflow, queue and current checkout |
| `atlasmind.ci.localRunner.runnerLabel` | `atlasmind-trusted-linux-{arch}` | Uses one dedicated label, expanded from Docker's real x64/arm64 architecture |
| `atlasmind.ci.localRunner.image` | pinned official digest | Auto-pulls only immutable digests and runs a resolved image id |
| `atlasmind.ci.localRunner.maxCpus` | `8` | Caps CPU after the host reserve (25%, ≥2 CPUs, measured on the real machine, not the Docker/WSL VM) and the testing resource share |
| `atlasmind.ci.localRunner.maxMemoryGb` | `16` | Caps memory after the host reserve (25%, ≥8 GB, measured on the real machine, not the Docker/WSL VM) and the testing resource share; disables container swap |
| `atlasmind.testing.resourceShare` | `50` | The sliding scale for local test execution: what percentage of the computer tests may use. One value read by auto-verify, the test-run skill, "Run here" and the local CI container; the OS always keeps at least 25% (≥2 CPUs / 8 GB) |
| `atlasmind.ci.localRunner.shutdownPolicy` | `ifStartedByAtlasMind` | Close Desktop only when AtlasMind opened it, never close it, or close whenever no other container is running |

The container has no host mount, Docker socket, GPU or persistent volume. Its result is Linux-container
evidence even on Windows or macOS; native platform checks still need native runners. See the
[safe local runner guide](../docs/local-ci-and-safe-runners.md).

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

## Atlas Lenses — live services

The three live lenses compare what your repository declares against what a running API or
database actually serves. They are the only part of AtlasMind that reaches a system somebody else
operates, and they read **shape only** — the schema a service publishes, or an `information_schema`
listing. Never a row, never a field value, never a write.

| Setting | Default | What it does |
|---------|---------|-------------|
| `atlasmind.lens.live.enabled` | `false` | Master switch for Live Contract Drift, Service Reachability and Live Data Trust. Off by default — a probe leaves your machine. Nothing is ever probed automatically |
| `atlasmind.lens.live.allowedStages` | `["local", "development", "staging"]` | Which declared environments a probe may reach. **`production` is deliberately absent**, and an endpoint that doesn't state its stage counts as `unknown`, which is treated *as production*. Adding either still requires you to type the endpoint's label before each probe |

Which services may be reached is declared in `.atlasmind/lens-endpoints.json` — a committed file,
reviewed like any other change. Atlas will **not** draft it: a hostname nobody typed is a request
to a stranger made in your name. The file *names* a secret with `secretRef`; one that actually
contains a token or connection string is refused whole.

Databases go through an MCP server you have already connected, and only via a tool whose name says
it reads schema. AtlasMind bundles no database driver, stores no database credential, and will not
compose SQL for a generic query tool.

---

## UI Studio — visual-guide generation and preview

UI Studio plans websites and non-web interfaces. Its shared core is inert design data: a brief, screens,
content rules, Markdown copy, a wireframe canvas, a UI system and implementation hints. Every profile
can render a static HTML/CSS visual guide; the website profile also adds sitemap/SEO, hosting and
automations. Two things in it actually
*do* something, and each has its own switch — because writing
files a model wrote and opening a port on your machine are different decisions, and one control
carrying both would make the second happen without you agreeing to it.

| Setting | Default | What it does |
|---------|---------|-------------|
| `atlasmind.website.generation.enabled` | `false` | Lets **Generate** call a model and write static HTML and CSS. You see a modal listing every file first — and it can list them because the plan is worked out *before* any model runs, so the same sitemap always produces the same list |
| `atlasmind.website.generation.maxFiles` | `40` | Most files one Generate may write. Over the limit it refuses and tells you the count, rather than writing half a site whose missing pages look like broken links |
| `atlasmind.website.preview.enabled` | `false` | Lets the guarded preview server open the deterministic structure/content/style draft in VS Code's built-in browser; the responsive lab shares its URL |
| `atlasmind.website.preview.port` | `0` | Which port to use. `0` picks a free one, which is nearly always what you want |

Generated files go **only** to `.atlasmind/website-preview/`. Your source tree is never written to;
moving an approved design out of the preview folder is a separate, deliberate step.

The preview server binds `127.0.0.1` and nothing else — no setting can change that — serves only the
preview folder, offers no directory listing, and puts a random per-session token in its URL so
another process on your machine can't guess the port and read your client's work. The preview index is
always rebuilt from saved wireframes, safe UI tokens, and exact Markdown copy; generated output is a
separate link. Stop Preview, closing UI Studio, or extension deactivation stops the server. Closing
only the responsive lab does not break a full preview still open in the built-in browser.

---

## Website Studio — copy and client feedback

| Setting | Default | What it does |
|---------|---------|-------------|
| `atlasmind.website.content.directory` | `content` | Where interface copy lives — one Markdown file per page or screen. The files are the source of truth; UI Studio shows an editable mirror |
| `atlasmind.website.review.enabled` | `false` | Record client comments against pages and individual elements |
| `atlasmind.website.review.includeOverlayInBuild` | `false` | Put the comment overlay into generated pages so your client can leave feedback in their own browser |
| `atlasmind.website.review.webhookUrl` | `''` | An endpoint **you own** for comments to POST to. Empty means your client downloads a file and sends it |

Where the words aren't written yet, leave a `[PLACEHOLDER: what's needed]` marker. AtlasMind counts
them, so a page reads as "four placeholders remaining" rather than a status somebody ticked — and
generation is told to leave them visible rather than helpfully inventing copy. A page that looks
finished but is full of fiction is worse than an obviously unfinished one, because it gets signed off.

A page with **no** content file and a page with an **empty** one are different things, and stay
different. And if you edit the markdown while the Studio has it open, the Studio's save is refused
rather than merged — the file wins.

**AtlasMind doesn't host the review.** The overlay ships inside your site, so it goes wherever the
site goes, including the password-protected staging environment the Stack page sets up. Your client
opens a normal URL. Comments come back as a downloaded file, or by POST to an endpoint you already own
if you configure one — and if you don't, the page can't make a network request at all.

---

## Website Studio — setting the project up

Picking a framework does nothing by itself. **Set up this stack** is the part that runs commands and
writes files, and it has three switches rather than one because they're three different decisions.

| Setting | Default | What it does |
|---------|---------|-------------|
| `atlasmind.website.setup.enabled` | `false` | Lets setup run the framework's create command, write the deploy config, add dev/build scripts and create the stage branches. You see every command and every file in full first |
| `atlasmind.website.setup.generateCi` | `false` | Also writes a GitHub Actions deploy workflow. Separate because it's the one thing AtlasMind generates that **runs on its own** — with your secrets, and it can spend money |
| `atlasmind.website.setup.allowRemoteProjectCreation` | `false` | Lets AtlasMind run `wrangler pages project create` and friends for real. Off by default: they authenticate as you and create billable resources. With it off you still get the command to run yourself |
| `atlasmind.website.setup.packageManager` | `npm` | `npm`, `pnpm`, `yarn` or `bun` for the commands it plans and the scripts it writes |

However you set these, a few things hold:

- **Nothing runs through a shell**, and every command is a constant in AtlasMind's source rather than
  something composed, fetched, or written by a model.
- **Nothing is overwritten.** An existing config file, script, branch or workflow is left exactly as
  it is and reported — so running setup twice is safe.
- **Branches are only ever created**, never checked out, pushed or forced.
- **Success is checked afterwards**, not assumed from an exit code.
- A framework or platform AtlasMind has no verified command for gets **no command**, and says so,
  rather than an improvised one.

The Stack page also compares Website Studio's three environments with the Delivery page's stages and
shows you which fields disagree. They're two separate copies, so they can drift; syncing never clears
a real Delivery value with an empty one from the Studio, and can only ever *add* promotion protection,
never remove it.

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

## Sharing one graphics card

If you run local models — Ollama, LM Studio, or both — AtlasMind can ask for several at once from
places that don't know about each other: the subtask scheduler, project bootstrap, background
maintenance. Each runtime decides what fits without knowing the other exists, and neither leaves
anything for your desktop. On a 24 GB card with **no model loaded at all**, Windows, a browser and
antivirus were already using 9.2 GB.

AtlasMind now measures what's actually free, queues local requests that won't fit, and moves the turn
to another provider rather than over-filling the card. If you loaded a model by hand, it stays —
AtlasMind only ever unloads models it loaded itself.

| Setting | Default | What it does |
|---------|---------|-------------|
| `atlasmind.localGpu.enabled` | `true` | Check there's room before sending a local request. Off sends everything immediately, as before |
| `atlasmind.localGpu.maxConcurrentRequests` | `2` | Local requests at once. Several requests to the *same* loaded model are cheap and mostly run together; different models queue regardless |
| `atlasmind.localGpu.safetyMarginMb` | `2048` | Free memory to leave alone, for whatever your desktop grabs while a model is loading |
| `atlasmind.localGpu.reserveMb` | `3072` | How much of the card AtlasMind will never take. A limit on *its* share — your desktop is already protected by measuring free memory. `0` removes it |
| `atlasmind.localGpu.maxResidentModelsWhenUnmeasured` | `1` | Models kept loaded per runtime when free memory can't be read (AMD, Intel, Apple Silicon, or no `nvidia-smi`). Raise it if you have memory to spare |
| `atlasmind.localGpu.evictOwnModels` | `true` | Let AtlasMind unload its *own* models to make room for another. Yours are never touched. Off means it waits instead |

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
