# Model Routing

The model router selects the best LLM for each request based on budget preference, speed preference, task profile, provider health, and the runtime-refreshed provider model catalog.

`cheap` and `fast` are now stronger preference modes than they were originally. AtlasMind still enforces their hard gates first, but once a candidate pool is eligible it gives effective cost a much larger score multiplier in `cheap` mode and speed a much larger score multiplier in `fast` mode.

Two catalog fields make routing future-proof as new models are released:

- **`reasoningDepth`** (0–3): replaces the binary `reasoning` capability tag with a numeric scale. Scoring rewards depth ≥ 3 (full reasoning) more than depth 2 (medium) or depth 1 (basic), and penalises depth 0 for high-reasoning tasks rather than applying a binary cliff. New models should set this field explicitly so they are placed correctly on the spectrum.
- **`latencyClass`** (`'fast' | 'balanced' | 'slow'`): explicit speed-tier annotation. When present it overrides the context-window heuristic, preventing large-context-but-fast models (e.g. Claude Sonnet 4 at 200k tokens) from being incorrectly classified as `'considered'` speed tier.

Subscription model gating has been tightened: `balanced` budget mode now excludes subscription models with `premiumRequestMultiplier > 2` (Opus-tier) to prevent silent high-credit consumption on everyday tasks. `auto` budget with a high-reasoning task no longer hard-gates cheap-tier models; capable local reasoners such as DeepSeek R1 remain candidates and are differentiated by score instead.

The task profiler's session-context inheritance has been tightened: terse follow-up messages (≤ 8 words) that continue a high-complexity session now inherit `medium` reasoning (down from `high`), and messages containing action verbs (`do`, `apply`, `fix`, `run`, etc.) are excluded from the inheritance path entirely.

When the first-pass route finds no healthy real model, AtlasMind now retries with permissive routing gates before it falls back to the built-in local echo model. If the only blocker was an implicit tool requirement, it also retries the turn in text-only mode so text-only providers can still answer normal chat prompts.

For terse command-style MCP actions such as starting or stopping a timer, AtlasMind now tries the local provider first when it exposes a real function-calling model. That keeps trivial tool turns off billed providers whenever a suitable local model is available, while still falling back to the normal cross-provider pool if local cannot satisfy the request.

AtlasMind now also derives lightweight intent aliases for MCP-backed tools from their names and descriptions. Plain-English prompts such as “commit”, “save changes”, or “show status” are scored against those aliases so the model sees a shortlist of the most likely tools for the current request. When multiple tools score similarly, Atlas explicitly nudges the model to ask the user for clarification instead of guessing.

AtlasMind also now treats failed tool results as authoritative. If a tool round only returns failures, denials, validation problems, or no-op responses, Atlas will surface that failed tool summary instead of accepting a contradictory success narration from the model.

For OpenAI-family chat completion providers, AtlasMind now applies provider-specific compatibility rules instead of one shared payload shape. OpenAI and Azure OpenAI use the newer chat contract with `developer` messages and `max_completion_tokens`, while third-party OpenAI-compatible providers continue using the broader `system` plus `max_tokens` contract for compatibility. AtlasMind also omits `temperature` for fixed-temperature OpenAI model families such as GPT-5 and the `o`-series, while retaining it for models and providers that still support sampling controls.

For tool-enabled OpenAI-compatible requests, AtlasMind normalizes internal tool ids into OpenAI-safe function names before it sends the request, then maps returned tool calls back to the original Atlas skill ids. That preserves MCP-derived tools even when their internal ids contain characters such as `:` or `/`.

Anthropic now follows the same compatibility rule for tool-enabled turns. AtlasMind rewrites internal skill ids into provider-safe Anthropic tool names on the wire and restores the original skill ids on returned tool calls, which keeps MCP-backed tools usable even though Anthropic rejects characters such as `:` and `/` in tool names.

AtlasMind can also perform one bounded escalation during execution when the current model shows repeated struggle signals, such as repeated failed tool calls or excessive tool-loop churn. In those cases it reroutes to a stronger reasoning-capable model instead of exhausting the entire loop on the weaker route.

**Correction turns are never downgraded.** When the user disputes or corrects the assistant's previous answer ("that's not correct", "no, that's wrong", "you got it wrong", "are you sure?", "re-check that"), the turn is treated as high-stakes: high reasoning, reasoning-capable model preferred, and an escalated budget/speed. A pushback against a wrong answer is never silently routed to the cheapest/local model.

**Empty completions trigger escalation, not a blank turn.** If a model returns no usable content (zero output tokens, no tool calls), AtlasMind does not re-prompt the same (often flaky/local) model — it records the empty result as a failure and retries on an escalated, reasoning-class model. If bounded recovery still yields nothing, the transcript says so and offers **Retry** and **Provider status** choices; it never converts zero output into “Answered from context.”

**Whole-project assessments are high-reasoning work even when the sentence is short.** Assessment, evaluation, review, and “where does this project stand?” prompts receive a deterministic high-reasoning floor that an optional classifier cannot lower. Among capable candidates, a bounded adequacy bonus prefers real local or active subscription-backed capacity over pay-per-token capacity that is only marginally faster; review, planning, and synthesis candidates must still meet a reasoning-depth floor.

**Tool capability is based on the selected turn, not the agent's theoretical maximum.** `task-scoped` agents receive at most 12 relevant tools from their enabled eligibility pool; a general explanation can therefore remain a normal text request. `allowlist` preserves an exact pool, and the advanced `all` policy deliberately admits every enabled skill. Empty task-scoped lists admit built-ins only; custom/MCP skills must be named explicitly.

**Tool schemas count as context.** The selected callable JSON definitions are the single model-facing skill description; AtlasMind no longer repeats them as a prose list. Serialized schema tokens participate in initial estimates, session/memory budgeting, and every tool round's output headroom. ACP completion-only and delegated-native-tool attempts receive no AtlasMind schemas or catalogue; ordinary-provider failover restores the selected definitions.

For action-oriented workspace requests, AtlasMind also distinguishes between evidence-gathering and follow-through. Prompts that ask Atlas to wire, integrate, configure, support, add, update, fix, or otherwise implement behavior are now biased more aggressively toward direct execution, and after successful read-only evidence gathering AtlasMind issues one stronger follow-through reprompt before accepting a summary-only answer. Verification-style follow-ups such as asking whether a change actually happened now also trigger a repository-backed check, and investigation stalling like “I need to check” is treated as a retry signal rather than an acceptable final answer.

AtlasMind also treats prompts about the current project structure, settings pages, or voice and audio settings as workspace-backed investigation requests more aggressively. When a turn has already gathered enough read-only repository evidence, the follow-through nudge now requires exact existing file paths or one final lookup before Atlas is allowed to settle on a summary.

Security prompts such as security gap analysis, runtime-boundary review, auth review, vulnerability review, and threat modeling now bias even more strongly toward live repository evidence. AtlasMind treats those requests as code, configuration, runtime-boundary, and test investigations first, adds explicit prompt guidance that documentation is context rather than the sole source of truth, and prefers source-backed implementation evidence before it summarizes any claimed gap.
URL-bearing integration and configuration prompts now also inject explicit URL-safety guidance so Atlas validates scheme and host trust boundaries, prefers HTTPS for external services, and uses the SSRF-safe fetch or HTTP request path to verify health or reachability before it presents a link as working.
If the selected provider fails outright, AtlasMind invokes at most **three actual model endpoints** for the turn. A transport failure opens a turn-local circuit for the entire endpoint, so ACP effort/model variants and local models sharing the same failed server are skipped instead of repeatedly restarting it. ACP uses a protocol-aware 180-second deadline rather than the generic 30-second provider deadline. Reply metadata reports only endpoints actually invoked, with outcome and duration; routing previews are not counted as “models used.”

AtlasMind also includes workstation context in routed prompts so response formatting can default to the active environment, such as preferring PowerShell command examples on Windows inside VS Code unless the user asks for another shell or platform.

The Local provider now aggregates multiple labeled OpenAI-compatible endpoints under one routed provider identity. AtlasMind encodes endpoint identity into each discovered local model id, which lets one workspace keep engines such as Ollama and LM Studio available together while still routing later requests back to the correct local engine.

For responses shown in the shared AtlasMind chat workspace, assistant bubbles now expose thumbs up and thumbs down controls. AtlasMind stores that vote with the assistant turn, aggregates the history by `modelUsed`, and feeds a small bounded preference bias back into later routing.

That feedback bias is controlled by `atlasmind.feedbackRoutingWeight`. Set it to `0` to disable feedback-weighted routing entirely, keep `1` for the default slight influence, or raise it modestly when you want thumbs history to matter more without letting it override capability, budget, speed, or provider-health gates.

**Task outcome feedback**: in addition to manual thumbs votes, AtlasMind also feeds task execution results into the preference signal. After every agentic task completes, `ModelRouter.recordModelOutcome(modelId, success)` increments or decrements the preference score by a fractional `PERFORMANCE_OUTCOME_WEIGHT` (0.12). This means routing adapts continuously from real execution outcomes, not only from explicit user feedback.

**Deprecation and staleness handling**: models with a `deprecatedAt` date in the past are automatically excluded from candidates. Provider-confirmed model-not-found/deprecated errors create a session retirement tombstone that successful refreshes do not clear, so stale discovery cannot resurrect the model. Transient failures still expire after 5 minutes. A successful empty discovery prunes the provider's previous model list; only errors and timeouts preserve the last known catalog.

**Extended-thinking cost scaling**: models with a `thinkingTokenMultiplier` have that multiplier applied to their output price during budget scoring, so extended-thinking models are not misclassified as cheap.

**Smooth context-window gradients**: context-window score penalties interpolate linearly — `penalty × (1 − contextWindow / threshold)` — rather than a binary cliff. Future models with context windows above the threshold receive no penalty at all.

## Supported Providers

| Provider | ID | Pricing Model | Catalog source | Notes |
|----------|----|--------------|----------------|-------|
| **Anthropic** | `anthropic` | Pay-per-token | Runtime discovery via adapter `discoverModels()` / `listModels()` | One seed model is registered before refresh completes |
| **ACP Agents (subscription/license)** | `acp` | Subscription/license | User-authored agent list (`atlasmind.acp.agents`); models are `acp/<id>` | Drives any Agent Client Protocol agent (`claude-agent-acp`, `codex-acp`, `gemini --acp`, `copilot --acp`, `qwen --acp`, …) over JSON-RPC on stdio using that vendor's subscription or eligible product license. Streams, has no argv prompt ceiling, and sends images when the agent declares support. A completion source by default. With `atlasmind.acp.toolsEnabled`, the router may satisfy a tool-backed task through the model’s distinct delegated-tool capability; the Orchestrator authorizes only that provider request, sends no function schemas, and each native operation is approved. Ordinary completions remain isolated even while the global setting is on. Declares `vision` once a handshake reports image support; never claims `function_calling`. Seeded disabled — nothing is spawned until you name a command you have installed. See [ACP agents](#acp-agents) below |
| **OpenAI** | `openai` | Pay-per-token | Runtime discovery via `/models` on the OpenAI-compatible adapter | One seed model is registered before refresh completes |
| **Azure OpenAI** | `azure` | Pay-per-token | Deployment list from `atlasmind.azureOpenAiDeployments` plus a workspace-configured Azure endpoint | Starts empty until you configure an endpoint and at least one deployment |
| **GitHub Copilot** | `copilot` | Subscription | Runtime discovery from the VS Code Language Model API | Starts with `copilot/default`; live discovery is deferred until you explicitly activate Copilot so AtlasMind does not prompt for language-model access during startup |
| **Google** | `google` | Pay-per-token | Runtime discovery via the Gemini OpenAI-compatible `/models` endpoint | One seed model is registered before refresh completes |
| **Amazon Bedrock** | `bedrock` | Pay-per-token | Configured model IDs from `atlasmind.bedrock.modelIds` executed through a SigV4-signed Bedrock adapter that preserves the raw model ID in the canonical request path | Starts empty until you configure region, model IDs, and AWS credentials |
| **Mistral** | `mistral` | Pay-per-token | Runtime discovery via `/models` on the OpenAI-compatible adapter | One seed model is registered before refresh completes |
| **DeepSeek** | `deepseek` | Pay-per-token | Runtime discovery via `/models` on the OpenAI-compatible adapter | One seed model is registered before refresh completes; live discovery currently exposes `deepseek-chat` and `deepseek-reasoner` with 128K context windows |
| **z.ai** | `zai` | Pay-per-token | Runtime discovery via `/models` on the OpenAI-compatible adapter | One seed model is registered before refresh completes |
| **xAI** | `xai` | Pay-per-token | Runtime discovery via `/models` on the OpenAI-compatible adapter | Starts with Grok 4, then refreshes to the live xAI catalog |
| **Cohere** | `cohere` | Pay-per-token | Runtime discovery via Cohere's OpenAI-compatibility `/models` endpoint | Starts with Command A, then refreshes to the live Cohere catalog |
| **Perplexity** | `perplexity` | Pay-per-token | Adapter-managed static model catalog | Uses a static Sonar-family model list because the upstream chat path does not expose a standard `/models` inventory |
| **Hugging Face Inference** | `huggingface` | Pay-per-token | Runtime discovery via the Hugging Face router OpenAI-compatible `/models` endpoint | Starts with one fallback router model, then refreshes to the live router catalog |
| **NVIDIA NIM** | `nvidia` | Pay-per-token | Runtime discovery via NVIDIA's OpenAI-compatible `/models` endpoint, enriched by a provider-scoped Nemotron catalog | Seeds the Nemotron family (Super 49B, Nano) plus a Llama 3.1 70B fallback, then refreshes to the live catalog |
| **Local** | `local` | Free | Static fallback or runtime discovery via one or more configured local OpenAI-compatible endpoints | Falls back to `local/echo-1` until a local endpoint is configured, can aggregate multiple labeled engines such as Ollama and LM Studio together, and still keeps the built-in echo fallback healthy |

The short model names you may see initially are **seed entries**, not AtlasMind's intended final provider catalog. On activation, and whenever the user clicks **Refresh Model Metadata**, Atlas scans providers for their live model list and merges that runtime discovery into the router.

## ACP agents

The `acp` provider turns a subscription or eligible product license you already pay for into capacity the router can select, by driving a coding agent over the [Agent Client Protocol](https://agentclientprotocol.com) — JSON-RPC 2.0 over a subprocess's stdio.

### Agents AtlasMind can name and install

Transcribed from the [ACP registry](https://github.com/agentclientprotocol/registry)'s own `agent.json` files at a pinned version. The registry is deliberately **not** fetched at runtime: a launch command that arrives over the network and is then spawned is remote code execution with extra steps.

| Agent | Command | Install |
|---|---|---|
| Claude Agent | `claude-agent-acp` | `npm install -g @agentclientprotocol/claude-agent-acp` |
| Codex | `codex-acp` | `npm install -g @agentclientprotocol/codex-acp` |
| Gemini CLI | `gemini --acp` | `npm install -g @google/gemini-cli` |
| GitHub Copilot CLI | `copilot --acp` | `npm install -g @github/copilot` |
| Qwen Code | `qwen --acp` | `npm install -g @qwen-code/qwen-code` |

The Gemini row has a narrower entitlement than its published command suggests.
Since [18 June
2026](https://docs.cloud.google.com/gemini/docs/codeassist/set-up-gemini),
`gemini --acp` requires an assigned Gemini Code Assist Standard or Enterprise
license (or separately metered Google Cloud/API access). Free individual and
personal Google AI Pro and Ultra accounts no longer work.
Gemini Enterprise Standard and Plus include Code Assist Standard after separate
assignment; Gemini Enterprise Business and Frontline do not. AtlasMind carries
that eligibility boundary through the Google-card tooltip, agent picker, `/acp`
guide, sign-in guidance, and a confirmation before install or probe.
Metered Google access belongs on AtlasMind's direct Google provider, where token
costs remain attributable; it is not advertised as zero-cost ACP capacity.

The package and the command are **one fact**, not two. Keeping a second copy is what let AtlasMind advise `@zed-industries/claude-code-acp` while spawning `claude-agent-acp` — that package's `bin` is `claude-code-acp`, so following the instructions installed a binary AtlasMind then failed to find.

`args` travels with the command everywhere an agent is registered. `gemini`, `copilot` and `qwen` are ordinary interactive CLIs until the ACP flag is passed, so a `gemini` configured without `--acp` opens a REPL that never speaks JSON-RPC.

### Agents you install yourself

goose (`goose acp`), OpenCode (`opencode acp`), Cursor (`cursor-agent acp`) and Kimi CLI (`kimi acp`) ship as platform archives. AtlasMind will not download and unpack one, so there is no install button — a button that cannot work is worse than none. The commands are recorded so they are discoverable, and any other ACP agent works too: name whatever command starts it.

### Why Windows needs a launch bypass

Every packaged adapter above is an npm `bin`, and on Windows npm writes a `bin` as three shims — an extensionless shell script, a `.cmd`, and a `.ps1`. None of them is an executable image, so spawning the command by name fails with `ENOENT` for a completely correct install. Node has also refused to spawn `.cmd`/`.bat` without a shell since CVE-2024-27980, and AtlasMind will not use a shell.

`acpLaunch.ts` reads the owning package's declared `bin` entry point out of its `package.json` and runs Node against it. A real `.exe` spawns directly; macOS and Linux are unaffected. When resolution fails you get a written explanation — including that a binary installed after VS Code started is often not on the window's PATH until a reload — rather than a bare `ENOENT`.

### Signed in is decided by trying, not by asking

`authMethods` in the handshake advertises which logins an agent *offers*; it does not say whether you owe one. `codex-acp` lists `api-key` and `chat-gpt` on every handshake even when you are signed in, so reading that list as "not authenticated" refuses working subscriptions.

AtlasMind opens a real session instead. The reserved ACP error `-32000` means a login is genuinely required; the message then names the logins the agent offers. Any other failure is reported as a broken agent, because sending somebody to a login screen that cannot help them is worse than saying "it crashed". AtlasMind never handles the credential — the login is always the vendor's own flow.

### What a turn is billed

- **`usage_update`** carries `{ used, size, cost? }` — cumulative context occupancy and window size. A progress bar, not a bill, and never charged as input tokens: doing so would re-bill the whole conversation on every message.
- **The prompt result** carries the turn's `inputTokens` / `outputTokens`. Missing counts are reported as **zero** rather than estimated, and nothing is derived from a total.

ACP models are priced at zero per token because the subscription already paid. ACP does not report an account tier or trustworthy remaining allowance, so a recorded plan name is display-only and never becomes a quota gate or credit counter.

### Subscription capacity comes first

Capacity you have already paid for is preferred over metered tokens — Copilot and ACP are treated as subscription-backed because the preference keys on *how a provider is priced*, not on its name. Quota-specific scoring applies only to a source with an authoritative allowance, such as Copilot. ACP intentionally carries no manual quota: its protocol identifies agents and models but has no standard account-tier or balance field.

### The models inside the subscription

Your plan is not one model. `claude-agent-acp` offers Opus, Sonnet, Haiku and whatever else your plan carries; `codex-acp` offers Luna, Terra and Sol. AtlasMind reads that list from the agent itself and turns each into a routed model, so the orchestrator can send a throwaway rename to the light one and a refactor to the deep one.

**The list is detected, never assumed.** Nothing in AtlasMind declares which models your plan has — vendors ship faster than we release, and a built-in roster would hide a model you are paying for. Whatever your installed agent offers today is what appears, after it has been probed.

**Where a model *sits* is a different question, and it cannot be detected.** The protocol carries a name and a description, not a capability rating. So standing comes from a declared rule, in this order:

1. Your `atlasmind.acp.modelStanding` setting.
2. A short table of naming conventions we will stand behind (Haiku / Sonnet / Opus).
3. Keywords in the agent's own description of the model.

A model matching none of them is offered as **unknown** — fully routable and selectable, but never *preferred* on capability, because a guessed ranking would misroute every turn without telling you. Luna, Terra and Sol are currently unknown: they read as moon/earth/sun, which is etymology rather than anything OpenAI has stated. Tell AtlasMind where they sit and it will use them fully:

```json
"atlasmind.acp.modelStanding": { "Luna": "light", "Terra": "balanced", "Sol": "deep" }
```

Keys match the display name or the wire value; values are `light`, `balanced`, `deep` or `unknown`. Your declaration beats the built-in table, so you can correct one as well as fill a gap.

**Model and effort combine.** They are separate knobs on the same session, so they appear together — `acp/claude@opus#high` — which is the combination worth having. Depth is the greater of the two (a light model does not become deep by asking harder) and cost multiplies (both spend your plan). The rule is on the provider card next to the numbers it produced.

### Effort levels inside the subscription

An ACP subscription used to be one model to the router, running at whatever the agent defaulted to. The agents were already advertising more on every session, and AtlasMind was throwing it away.

Each effort level your agent actually offers is now a routed model:

| Agent | Tiers offered |
|---|---|
| `claude-agent-acp` | `low` `medium` `high` `xhigh` `max` |
| `codex-acp` | `low` `medium` `high` `xhigh` `max` `ultra` |

They appear as `acp/claude#high`, `acp/codex#max`, and so on, alongside the plain `acp/claude` row — which still means *the agent's own default*. Each tier carries a reasoning depth and a declared relative routing intensity, so the budget mode you already set expresses the gradient: **cheap** reaches `low`, **balanced** reaches `high`, **auto/expensive** reach the top. Variants show up once the agent has been probed — refresh the models if you have just added one.

**AtlasMind will not touch your agent's permission mode.** The same list that offers effort also offers `bypassPermissions` (Claude Agent) and `agent-full-access` (Codex). Only two things can ever be set — the model and the effort — so a routing decision can never widen what an agent is allowed to do. Codex's "fast mode" (*1.5x speed, increased usage*) is excluded as well: spending your plan faster is your call, not a routing optimisation.

**The relative intensity of each tier is our routing rule, not a vendor usage figure.** No vendor publishes what a max-effort turn costs against a plan, so AtlasMind does not display, estimate, or decrement a remaining count.

If a tier cannot be applied, the turn still runs at the agent's default rather than failing — and the ACP output channel says so, because it was priced at the tier you asked for.

### Which subscription — because `acp` fronts several

`acp` fronts several unrelated subscriptions, so a plan is recorded **per configured agent**, not per protocol provider.

**Configure agent plan** opens on the agents currently named in `atlasmind.acp.agents`; eligible Gemini Code Assist and a self-installed ACP agent therefore appear without waiting for an AtlasMind release. After selecting the agent, enter the plan name the service shows—such as `ChatGPT Pro (5×)`. ACP does not expose a tier catalogue, request total, remaining usage, reset date, or cost per unit, so the flow neither asks for nor invents any of those values. The card shows one label per agent. Copilot's separate observable-credit flow is unaffected.

### Why checking an ACP agent is expensive

Checking whether an agent is usable means opening a session, because that is the only honest test of "signed in" — and a session on a coding agent starts its whole runtime. On Windows you may briefly see console windows appear and vanish: `claude-agent-acp` launches every MCP server *you* have configured in Claude Code inside that session, and some of those start through `cmd.exe`, which makes Windows allocate a console host.

Ordinary `windowsHide` cannot reach those descendants. AtlasMind now controls both levers:

- **How often:** the routed adapter keeps a successful session for 30 idle minutes. It sends only the exact transcript suffix the ACP session has not already seen; a branch/edit or any launch/security/configuration change gets a fresh session. Setup/health/panel probes are single-flighted before their five-minute TTL cache, so concurrent surfaces launch one process tree rather than several. A stable orchestrator task identity lets concurrent calls for one tool round join one prompt and lets a 15-second completed-result ledger absorb its retry without merging independent chats with identical text. ACP bypasses the generic transient-provider retry loop, so an uncertain `session/prompt` is never automatically sent again.
- **Where Windows may show them:** setup asks before the first probe. Ordinary launching is the compatibility-first default. The opt-in `atlasmind.acp.hideConsoleWindows` checkbox sends the already-resolved agent through a bundled, SHA-256-pinned Rust helper. It creates a token-ACL-scoped non-interactive window station and its `Default` desktop, creates the agent suspended with `STARTUPINFO.lpDesktop`, `STARTF_USESHOWWINDOW`/`SW_HIDE`, `CREATE_NO_WINDOW`, and only stdin/stdout/stderr inherited, assigns the root to a kill-on-close Job Object, then resumes it. Windows permits visible UI only on `WinSta0`, so even a descendant that chooses a new desktop cannot display a console or take focus.

That option is disclosed rather than silently enabled because unusual native UI isolation and unsigned helpers can be blocked by application control or EDR. AtlasMind never switches to or remotely controls the station, uses no shell, and applies the current token's default ACL, but the child keeps the same user's filesystem/network access. A missing, changed, or blocked helper fails visibly and never falls back to visible launching behind your back. While a routed private-mode session is alive, VS Code's status bar shows the number of such sessions and links to **Models & Providers**. The indicator proves AtlasMind selected that launch mode; it does not confer or replace a permission boundary.

The strongest follow-up is a modern-Windows host rather than another hidden-desktop variation. Windows 11 24H2 / Server 2025 adds [`AllocConsoleWithOptions(ALLOC_CONSOLE_MODE_NO_WINDOW)`](https://learn.microsoft.com/en-us/windows/console/allocconsolewithoptions): a revised helper could allocate a real console session with no window and launch the agent attached to it, so normal descendants inherit the windowless console without the hidden-desktop heuristic. It still needs real-agent testing before replacing this path—the API is build-26100-only, explicitly detached/new-console children can escape it, GUI windows remain interactive, and console attachment can alter stdio/TTY behaviour. Upstream fixes in each ACP agent remain the cleanest ownership/signing answer. ConPTY changes a raw JSONL protocol into terminal I/O; a Windows service/WSL/container/sidecar adds installation, identity, filesystem and credential plumbing; an in-process rewrite loses generic ACP isolation. The current Job Object improves whole-tree teardown but does not itself hide windows.

**Since v0.228.0 most completion-only descendants are gone too.** When AtlasMind is only using the agent to *write* an answer, it asks the agent not to load your machine's own settings — which is where your MCP servers come from. It also shares no configured MCP servers. On this machine isolation took the session from 19 background processes to 3, and from six windows to two. Live reuse means even those remaining starts no longer happen for every answer.

Switching on **Let subscription agents act** makes ACP eligible for tool-backed work; it does not authorize every ACP prompt. The Orchestrator stamps only a selected tool-backed provider request with per-turn delegated authority. The adapter requires that stamp and the live setting before dropping isolation, sharing the allowlisted MCP servers, or wiring the approval broker. An omitted/false stamp remains completion-only even while the checkbox is on. An empty MCP allowlist does not erase built-in agent tools on an authorized turn. A change in either setting or request authority replaces an incompatible live session.

If you want fewer still in that mode, trimming the MCP servers configured in the agent itself is the lever — that is what is being started.

### When it says the agent is installed but not signed in

That message used to end at "run it once in a terminal and complete its own login". It named no command, and the command on screen at that moment is the wrong one: `gemini --acp`, `copilot --acp` and `qwen --acp` all start a JSON-RPC server that will never ask you to log in, and `claude-agent-acp` does not hold the Claude credential at all — it uses the Claude CLI's.

So AtlasMind now records the sign-in command separately, read from each vendor's own documentation:

| Agent | Sign in with | Then |
|---|---|---|
| `claude-agent-acp` | `claude` | `/login` if Claude Code does not prompt you |
| `codex-acp` | `codex login` | A browser opens; `codex login --device-auth` if none is available |
| `gemini --acp` | `gemini` | Choose **Sign in with Google**, or run `/auth`; requires an assigned Gemini Code Assist Standard/Enterprise license |
| `copilot --acp` | `copilot` | `/login` |
| `qwen --acp` | `qwen` | `/auth`, then pick a provider |

The warning offers **Open a terminal with the command**, which types it and stops there. AtlasMind does not press Enter, and never sees the credential — every one of these flows opens a browser and asks for an account password, which is not something an extension should be running for you. The same command and button appear as step 4 of the `/acp` walkthrough.

For any other agent — anything you name yourself in `atlasmind.acp.agents` — the message says AtlasMind has no recorded sign-in flow rather than inventing `<command> login`. A guessed command is worse than none, because you would run it and believe the answer.

### When a row says an agent is not responding

Health is tracked **per agent**, so the *Anthropic — Claude subscription* row reports `claude-agent-acp` and nothing else. Every configured agent is probed, concurrently, and the provider counts as healthy when any of them can be used — a broken agent no longer condemns a working one.

An agent AtlasMind has not managed to contact yet shows **not checked yet**, not "agent not responding". A probe spawns the agent and opens a session, which takes a few seconds; refreshing the models runs it. If a row does say *not responding*, the tooltip carries what the agent itself reported, rather than guessing between the two usual causes.

ACP counts as configured when there is an agent in `atlasmind.acp.agents` — never by an API key, since there is no ACP key to hold. On Windows it additionally requires an explicit workspace or user value for `atlasmind.acp.hideConsoleWindows`; the schema default is not consent, so neither startup discovery nor a direct turn can launch an older configured agent before the visible/private choice is explained. Before v0.216.0 there was no agent check, so an installed and signed-in agent was reported as not responding on every startup while the provider panel showed it as ready.

See [[Tool-Execution]] for what an ACP agent is allowed to *do*, which is a separate gate.

## Specialist And Future Providers

AtlasMind's routed provider list is intentionally narrower than the broader AI vendor landscape. The model router expects a chat-capable backend that can be scored, health-checked, and executed through the current `ProviderAdapter` contract.

## Specialist Intent Routing

AtlasMind now performs a lightweight specialist-intent pass before ordinary freeform chat routing.

- Image and other media generation requests are redirected to specialist workflow surfaces instead of being treated as normal routed chat.
- Image-recognition requests route into the vision workflow. If images are already attached, AtlasMind keeps the turn in chat and upgrades it to a considered multimodal run.
- Speech and transcription requests route to the voice workflow.
- Research-heavy prompts bias toward source-backed retrieval and prefer deep-research providers when one is enabled.
- Robotics and simulation prompts bias toward slower code-and-reasoning routes so tool-backed execution is favored over generic prose.

This specialist layer sits above ordinary provider scoring. Its job is to choose the right workflow class first, then let the model router score the best eligible provider within that class.

Those specialist provider preferences are now driven from the live model catalog instead of a fixed provider list. AtlasMind carries optional specialist-domain metadata through model discovery, enriches missing domain tags from the well-known catalog and model-id heuristics, and recomputes the best available provider per domain from the currently enabled healthy models.

Specialist routing has **no override setting**. `atlasmind.specialistRoutingOverrides` shipped once and was removed in April 2026 along with the code that read it — this page described it for three months afterwards. Pin a provider through the Model Providers panel instead.

These names may still be valid future integrations, but they require a dedicated path rather than being inserted into the routed provider table as-is:

| Provider | Why it is not a routed provider yet |
|---|---|
| Meta | Usually appears as models hosted by other providers rather than one stable first-party routed API |
| Ludus AI | Needs a verified public chat-model API contract |
| Reka AI | Needs a verified current API contract and discovery path |
| EXA AI | Search/retrieval service rather than a routed chat backend |
| Aleph Alpha | Needs a dedicated adapter and verified runtime discovery behavior |
| Stability AI | Primarily image/media generation workflows |
| Runway | Primarily video/media generation workflows |
| ElevenLabs | Primarily speech/audio workflows |

## Integration Contract For New Routed Providers

Use the routed provider path only when the upstream service can support chat-style execution, stable provider identity, discoverable or configurable model inventory, routing metadata, and SecretStorage-friendly credentials.

Contribution checklist:

1. Implement `ProviderAdapter` in `src/providers/`.
2. Register the provider through the shared runtime so extension and CLI hosts stay aligned.
3. Decide whether discovery is runtime (`discoverModels()` or `listModels()`) or workspace-configured.
4. Add configuration UI and secret handling where needed.
5. Add request-shape, failure-handling, and routing regression coverage.
6. Update docs and integration monitoring when the change introduces a new third-party surface.

If the upstream service is search, voice, image, video, or another workflow-specific API, keep it on the specialist integration path instead of forcing it into the routed provider table.

## Catalog Refresh And Seed Models

AtlasMind uses a two-stage catalog strategy:

1. `registerDefaultProviders()` seeds one minimal model for most providers so routing works immediately.
2. `refreshProviderModelsCatalog()` runs on startup and on manual refresh.
3. Providers with `discoverModels()` contribute rich runtime metadata directly.
4. Providers with only `listModels()` contribute IDs, which Atlas enriches using the well-known catalog and heuristics.
5. If refresh fails, the existing seeded/static provider catalog remains in place.

Azure OpenAI and Bedrock are the exceptions: their routed model lists are intentionally empty until the workspace config defines deployments or model IDs.
Copilot is also handled specially: AtlasMind keeps its seed model registered but skips live discovery on startup until the user explicitly activates Copilot.
When Copilot is activated, AtlasMind now merges VS Code LM results from both the `copilot` vendor bucket and GitHub-backed aliases used by some preview rollouts, and it refreshes again when VS Code reports that the chat-model inventory changed.
DeepSeek stays on the standard OpenAI-compatible adapter path. AtlasMind now treats the live `deepseek-reasoner` route as tool-capable in addition to reasoning-capable, based on observed API behavior from the live service even though DeepSeek's public docs have not been fully consistent on that point.

This means the provider table should be read as **dynamic discovery capability**, not a hardcoded model inventory.

AtlasMind now uses three discovery patterns inside the routed set:

1. Direct runtime discovery via `/models` for standard OpenAI-compatible backends.
2. Static fallback seeds plus runtime refresh for providers that expose a normal model inventory.
3. Adapter-managed or workspace-configured model catalogs for providers such as Perplexity, Azure OpenAI, and Bedrock where execution is chat-compatible but discovery is provider-specific.

The same refresh pass now updates specialist-domain metadata used by chat routing, so changes in provider inventories can influence research or visual-analysis provider preference automatically on the next refresh.

## Metadata Enrichment

Discovered model IDs are normalized and resolved through this precedence chain:

1. Runtime hint from `discoverModels()`
2. Well-known entry from `src/providers/modelCatalog.ts`
3. Name-based heuristic fallback in `inferModelMetadata()`

The well-known catalog improves pricing, capability, context-window, and premium-request metadata for models that were discovered dynamically. It does not replace runtime discovery.

### Adding API Keys

1. Open Command Palette → **AtlasMind: Manage Model Providers**
2. Click **Set Key** or **Configure** for the provider
3. Keys are stored in VS Code's `SecretStorage` — never in settings or source

For the local provider, the endpoint URL is stored in `atlasmind.localOpenAiBaseUrl` and any optional API key is stored in SecretStorage under `atlasmind.provider.local.apiKey`.
For Azure OpenAI, the endpoint and deployment list live in workspace settings and the API key stays in SecretStorage.
For Amazon Bedrock, the region/model list live in workspace settings and AWS credentials stay in SecretStorage. The Bedrock adapter also preserves the raw configured model ID in the SigV4 canonical request path so signing and execution stay aligned.
For GitHub Copilot, AtlasMind uses your signed-in VS Code session and only asks for language-model permission when you explicitly activate the Copilot provider.

The CLI reuses the same host-neutral provider adapters for Anthropic, local/OpenAI-compatible backends, Azure OpenAI, and the other OpenAI-compatible routed providers. In that host, credentials are read from environment variables derived from the secret keys, such as `ATLASMIND_PROVIDER_OPENAI_APIKEY`, `ATLASMIND_PROVIDER_ANTHROPIC_APIKEY`, `ATLASMIND_AZURE_OPENAI_ENDPOINT`, `ATLASMIND_AZURE_OPENAI_DEPLOYMENTS`, and `ATLASMIND_LOCAL_OPENAI_BASE_URL`. Copilot remains VS Code-only, and Bedrock still uses the extension-host configuration path.

### Provider Health

- The router tracks per-provider health status
- Unhealthy providers receive a health penalty (score multiplier × 0) and are deprioritised
- Health updates via `setProviderHealth()` — typically after request failures
- The orchestrator can invoke at most three endpoints after retry handling. A failed execution endpoint opens a turn-local circuit, so cosmetic variants do not spend the remaining attempt budget restarting the same ACP process or local server.

---

## Selection Algorithm

### 1. Candidate Filtering

Models pass through three gates:

| Gate | Rule |
|------|------|
| **Enabled** | Provider and model must both be enabled |
| **Health** | Provider must be marked healthy |
| **Whitelist** | If agent has `allowedModels`, model must be in the list |
| **Trusted-model gate** | If the assembled context contains a `secret`-tier match (PCI cardholder data, HIPAA PHI) under the [Data Privacy](Security#data-privacy-confidential-data-is-gated-to-trusted-models) policy, candidates are restricted to the trusted-model allow-list (`RoutingConstraints.requireTrustedModel`). `confidential`/`proprietary` matches (GDPR, CCPA) are advisory: routing is left alone and the matched spans are redacted instead, so one heuristic hit in a large context bundle can't silently downgrade an unrelated task. When no trusted model is available, routing is unchanged and classified spans are redacted to `[CONFIDENTIAL]` as a fail-safe. Deny-by-default: an empty trusted list trusts nothing |
| **Capabilities** | Model must support all `requiredCapabilities` from the task profile |
| **Budget gate** | Model's budget tier must be in the allowed set for the configured budget mode |
| **Speed gate** | Model's speed tier must be in the allowed set for the configured speed mode |

### 2. Scoring

Provider and model availability can be changed directly from the Models sidebar. Those inline toggles persist in extension storage and are reapplied after runtime model discovery refreshes, so the router keeps honoring the user's local enable/disable choices. Providers that are not yet configured stay at the root of the tree, but their child model rows are hidden until credentials are present.

During refresh, AtlasMind normalizes upstream model IDs into its internal `provider/model` form before routing. This matters for providers such as Google Gemini whose OpenAI-compatible `/models` payloads can return raw IDs like `models/gemini-2.5-pro`; AtlasMind stores and executes those as `google/gemini-2.5-pro` so provider selection, failover, and telemetry stay aligned.

AtlasMind now refreshes all enabled providers during startup, including GitHub Copilot, so the routing pool is built from the current live model catalogs instead of a partially deferred provider set.

Provider failover stays inside the candidate set that still satisfies the task's routing constraints and is capped at three invoked endpoints. If a workspace-debug or tool-required request runs out of capable endpoints, AtlasMind fails explicitly instead of silently dropping to the built-in `local/echo-1` text fallback. ACP model/effort variants share one endpoint circuit, as do models on the same configured local endpoint.

When a routed model fails during execution, AtlasMind marks that model as failed for the current session, removes it from future candidate selection, increments a per-model failure counter, and shows a warning state in the Models sidebar. Refresh clears transient failures only; provider-confirmed removal/deprecation tombstones remain excluded for the session.

Each candidate is scored using:

```
score = (cheapness × budgetWeight) + (speedProxy × speedWeight)
      + (qualityProxy × qualityWeight) + taskFit + healthBonus + feedbackBias
      + zeroMarginalCostAdequacy + outcomeBias − strugglePenalty
```

| Factor | How it's computed |
|--------|-------------------|
| **Cheapness** | `1 / max(0.0001, effectiveCost)` — lower cost → higher score |
| **Speed proxy** | fast = 1.5, balanced = 1.0, considered = 0.6 |
| **Quality** | reasoning = 1.5, code = 1.2, other = 1.0 |
| **Task fit** | Bonus for matching preferred capabilities and task phase |
| **Health bonus** | +1.25 for healthy providers, 0 for unhealthy |
| **Feedback bias** | Small capped adjustment derived from stored thumbs up/down history for that exact `modelUsed` id |
| **Zero-marginal-cost adequacy** | Bounded bonus for a real local/free model or active subscription with capacity remaining; broad review, planning, and synthesis require reasoning depth ≥ 2 before the bonus applies |
| **Outcome bias** | Decaying EWMA of graded execution quality, bucketed per reasoning tier — nudges toward models that perform well |
| **Struggle penalty** | Persistent, decaying **de-weight** for a model that repeatedly fails *this kind of task* — see [Model-Struggle Memory](#model-struggle-memory) |

The outcome grade is evidence-backed for normal AtlasMind turns. It scores the final recovered response together with expected tool use, tool success/failure counts, verification, TDD status, and incomplete-delivery signals. Hard errors, empty output, and truncation remain deterministic low grades; clean prose alone is not automatically perfect, while clean verified execution can reach 1.0. The explicit Model Comparison harness has no workspace execution artifacts, so it keeps a separate coarse completion-integrity grade plus its optional answer-quality judge.

The Cost Dashboard now surfaces the same signals before routing applies them: recent request rows show the linked response's vote, and the dashboard includes a per-model approval table with thumbs totals and filtered spend for rated models. It also estimates local-model savings per exact model: genuine local usage is grouped by input/output tokens, mapped through an explainable parameter-size/model-family heuristic to a catalog-backed budget, mid-tier, or premium cloud reference, and totalled. The result is labelled as potential cost avoidance rather than a realized discount.

### 3. Weighting

Weights are controlled by budget and speed mode:

| Budget Mode | Budget Weight |
|-------------|--------------|
| `cheap` | 3.0 |
| `balanced` | 1.5 |
| `expensive` | 0.5 |
| `auto` | 1.5 |

| Speed Mode | Speed Weight |
|------------|-------------|
| `fast` | 3.0 |
| `balanced` | 1.5 |
| `considered` | 0.75 |
| `auto` | 1.5 |

---

## Model-Struggle Memory

AtlasMind remembers when a specific model repeatedly under-performs on a specific
*kind* of task and routes around it — countering the "drift down to a weak/cheap/
local model" pattern, where a cheap model's large price advantage keeps winning
even after it fails.

- **Signals recorded**: `timeout`, `empty` completion, `tool-call-as-text` (a model
  that emits a tool call as plain text instead of a structured `tool_calls`
  response), `error-finish`, and `user-correction` (a follow-up turn disputing the
  previous answer, attributed best-effort to the previous turn's model). Billing
  and deprecation failures are excluded.
- **Keyed by task signature** (`phase · modality · reasoning · tools`), so a model
  is de-weighted only for the task kind it actually fails — not globally.
- **Marginal, escalating, decaying**: a small penalty breaks near-ties; once a
  model crosses the threshold for a signature, a **budget tier-escape** opens up
  more capable (pricier) models for that task kind (cheap → balanced → expensive)
  and re-ranks. Penalties decay with a ~2.5-day half-life and halve on a clean
  turn, so transient glitches fade while genuinely weak models stay de-weighted.
- **Persistence & control**: stored in `globalState` (`atlasmind.modelStruggleSignals`)
  so it survives restarts; disabled when `feedbackRoutingWeight = 0`. De-weighted
  models show a **"de-weighted: …"** badge in the **Compare Models** panel.

---

## Budget Modes

| Mode | Allowed Model Tiers | Best For |
|------|---------------------|----------|
| **cheap** | cheap only | Bulk operations, simple queries |
| **balanced** | cheap + balanced | General development (default) |
| **expensive** | cheap + balanced + expensive | Architecture, complex reasoning |
| **auto** | Adapts per task profile | Let the profiler decide |

**Budget tier classification** (by total price per 1K tokens):

| Tier | Price Range |
|------|-------------|
| Cheap | ≤ $0.0015 / 1K |
| Balanced | ≤ $0.008 / 1K |
| Expensive | > $0.008 / 1K |

### Auto Budget Mode

When budget is `auto`, the task profiler adjusts:
- **High reasoning** → balanced + expensive
- **Medium reasoning** → cheap + balanced
- **Low reasoning** → cheap + balanced

---

## Speed Modes

| Mode | Allowed Model Tiers | Best For |
|------|---------------------|----------|
| **fast** | fast only | Quick edits, simple lookups |
| **balanced** | fast + balanced | General development (default) |
| **considered** | balanced + considered | Planning, architecture, deep analysis |
| **auto** | Adapts per task profile | Let the profiler decide |

**Speed tier classification:**

| Tier | Criteria |
|------|----------|
| Fast | No reasoning capability AND context ≤ 128K |
| Considered | Has reasoning capability AND context ≥ 200K |
| Balanced | Everything else |

### Auto Speed Mode

When speed is `auto`, the task profiler adjusts:
- **High reasoning** → balanced + considered
- **Otherwise** → fast + balanced

---

## Task Profile Scoring

The task profiler infers phase, modality, and reasoning intensity. This influences scoring:

| Task Phase | Scoring Bonus |
|------------|--------------|
| `planning` | +0.9 for reasoning models |
| `execution` with code modality | +0.7 for code models |
| `synthesis` | +0.9 for reasoning models |

Preferred capabilities from the profile add:
- +1.0 for `reasoning` match
- +0.6 for other capability matches

Important follow-up prompts that rely on carry-forward chat context, such as requests framed as "based on the chat thread" or other high-stakes continuation turns, are intentionally profiled more aggressively so AtlasMind can move off a weak local model on later turns.

Open-ended triage/advisory prompts ("what should we work on next?", "is there anything incomplete?", "what would you recommend?") are likewise profiled as **high** reasoning. They are short but demand whole-project reasoning, so without this they fell through to `low` and were routed to the cheapest (often sub-10B) model. Mechanical follow-ups such as "commit" remain low/medium.

Cheapness is also normalized during scoring. Free and subscription-backed models still get a strong cost advantage, but that advantage no longer overwhelms clear reasoning or task-fit signals on higher-stakes turns.

A subscription provider with quota remaining also gets a small **general** preference nudge on all task phases (not just maintenance), because its capacity is already paid for — "essentially free" until quota is exhausted. The nudge is modest and **quota-aware**: it disappears once the subscription is depleted, after which the provider is treated as pay-per-token.

**Cache-aware routing.** On iterative/threaded turns the large stable prefix (system prompt + memory bundle + tool definitions) can be served from the provider's prompt cache at a reduced rate. The router projects this via `cacheablePrefixRatio` (estimated from the carried context vs. the new message, capped at 0.9), pricing the cacheable share at the model's cache-read rate so cache-capable models are favoured for repeat-context work; single-shot turns are unaffected. Cache capability is **dynamic** — sourced from discovery hints / the live pricing sync / the catalog (in that precedence), with a static provider set only as a bootstrap fallback — so it tracks providers changing their model capabilities.

---

## Subscription Quota Management

For subscription providers (e.g. GitHub Copilot and ACP agents):

### Premium Request Multiplier

Some models consume multiple quota units per request. For example, Claude 4 Opus via Copilot costs 3× per request.

```
effectiveCost = costPerRequestUnit × premiumRequestMultiplier
```

### Conservation Threshold

When remaining quota drops below **30%** of total:
- The router interpolates effective cost from subscription rate toward API rate
- This naturally biases selection toward cheaper models as quota depletes
- At 0% remaining, subscription models are treated as pay-per-token

### Quota Exhaustion

When `remainingRequests ≤ 0`:
- The provider is treated exactly like pay-per-token
- Models are scored at their listed API prices
- No subscription bonus applies

---

## Parallel Slot Selection

When the task scheduler needs multiple models running in parallel (e.g. during `/project`):

1. `selectModelsForParallel(slots, constraints)` is called
2. First slot filled with the best subscription/free model
3. Remaining slots filled with pay-per-token candidates
4. As `parallelSlots` increases, subscription advantage is dampened to allow overflow

The damping formula blends subscription cost toward listed API cost:
```
slotBlend = min(1, (parallelSlots - 1) / 3)
effectiveCost = subscriptionCost + (listedCost - subscriptionCost) × slotBlend
```

---

## Cost Estimation

The `CostTracker` records after each request:
- Input tokens and output tokens
- Model pricing
- Running session total in USD

Use `/cost` or **AtlasMind: Show Cost Summary** to view the breakdown.

Agents can set `costLimitUsd` to cap per-task spending. If the limit is reached, the task is terminated with a cost-exceeded message.

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `atlasmind.budgetMode` | `balanced` | Budget preference: cheap, balanced, expensive, auto |
| `atlasmind.speedMode` | `balanced` | Speed preference: fast, balanced, considered, auto |
| `atlasmind.localOpenAiBaseUrl` | `http://127.0.0.1:11434/v1` | Base URL for a local OpenAI-compatible endpoint |

These can also be adjusted via the [[Configuration]] settings panel.
