# FAQ & Troubleshooting

The questions people actually ask, and what to do when something misbehaves.

---

## The basics

### What is AtlasMind, in one sentence?

A VS Code extension that gives you a team of AI specialists instead of a single chat assistant, and
keeps what they learn attached to your project rather than to a conversation.

### Do I need it if I already have Copilot?

They do different jobs, and plenty of people run both. Copilot is excellent at finishing the line
you're typing. AtlasMind is for the work *around* that: planning a change, doing it across several
files, checking it, remembering why you did it, and taking it through review and release.

AtlasMind can also use your Copilot subscription as one of its models, so it isn't an either/or.

### Does it cost anything?

The extension is free and MIT licensed. What you pay for is the model.

You can genuinely run it for **no additional cost** using a Claude, ChatGPT, Copilot or Qwen
subscription you already have, or a local model via Ollama or LM Studio. If you'd rather use API keys,
set `atlasmind.budgetMode` to `cheap` and `atlasmind.dailyCostLimitUsd` to a number you're comfortable
with. `/cost` shows what you've spent this session.

### Which models can it use?

Anthropic, OpenAI, Google Gemini, Azure OpenAI, Amazon Bedrock, Mistral, DeepSeek, z.ai, GitHub
Copilot, subscription agents over ACP, and anything OpenAI-compatible running locally.
See [[Model Routing]].

### Is my code sent anywhere?

Only to the model provider you connected, and only what's needed for the request. Secrets are redacted
before dispatch. A local model means nothing leaves your machine at all. See [[Security]].

### Why does it say Beta?

The label stays until 1.0.0, when the configuration and memory formats are frozen. It's stable enough
for daily use — the caution is about formats changing, not about it falling over.

---

## Setup problems

### I installed it but `@atlas` doesn't appear in chat

- Check you're on VS Code 1.96.0 or newer.
- Check the extension is enabled in the Extensions panel.
- Reload the window: `Ctrl+Shift+P` → **Developer: Reload Window**.

### How do I add an API key?

`Ctrl+Shift+P` → **AtlasMind: Manage Model Providers** → **Set Key** next to the provider. Keys go into
the OS keychain via VS Code SecretStorage — never into a settings file.

### Can I use it with no API keys at all?

Yes, three ways:

1. **A subscription you already pay for** — Claude, ChatGPT, Copilot or Qwen. See `/acp`.
2. **GitHub Copilot** — install Copilot Chat, sign in, done.
3. **A local model** — Ollama or LM Studio, no key needed.

### My subscription agent says "installed but not signed in"

The command that *starts* the agent is not the command that *signs you in* — `gemini --acp`,
`copilot --acp` and `qwen --acp` all just start a server. AtlasMind records the real sign-in command
separately and will open a terminal with it typed in. It stops there: it never presses Enter and never
sees your credential.

### How do I connect a local model?

1. Start Ollama or LM Studio with an OpenAI-compatible endpoint (e.g. `http://localhost:11434/v1`).
2. Configure the **Local** provider with that URL.
3. Its models appear in the Models sidebar.

### Windows: terminal windows keep popping up

That's a subscription agent or MCP server creating its own console. Turn on **ACP: Hide Console
Windows** (Settings → Safety & Verification), which puts those processes somewhere they can't surface a
window or steal focus.

Worth knowing before you do: enterprise endpoint security sometimes flags this technique, because
malware uses the same Windows feature. AtlasMind pins the helper by checksum and discloses exactly what
it's doing. If your EDR blocks it, it fails visibly rather than quietly falling back.

---

## Memory

### What is "project memory"?

A folder of Markdown files (`project_memory/` by default) holding what AtlasMind knows about your
project: architecture, decisions, conventions, roadmap, lessons learned. It reads from it automatically
so you don't have to re-explain your project every session. See [[Memory System]].

### How do I fill it?

- `/bootstrap` — creates the structure for a new project
- `/import` — reads an existing repository and populates it
- Just ask — "remember that we use Zod for all boundary validation"

### Can I edit the files myself?

Yes, please do. They're plain Markdown. Edit them in VS Code like anything else; changes are picked up
on the next query.

### My memory entries aren't coming back

- Check `atlasmind.ssotPath` points at the right folder (default `project_memory`).
- Check the files are valid Markdown.
- Try `/memory <keyword>` to test retrieval directly.

### Is project memory committed to git?

Yes — that's deliberate. It's shared project knowledge, so it belongs in the repository with everything
else. Sessions, temporary files and run artifacts are gitignored. It is kept *out of the published
extension package* by `.vscodeignore`, which is a different thing.

---

## Models and cost

### How do I control which model gets used?

- **Budget mode** (`atlasmind.budgetMode`) — which price tier is eligible
- **Speed mode** (`atlasmind.speedMode`) — how much thinking time to prefer
- **Per-agent limits** — set `allowedModels` on an agent to pin it
- **`auto`** — let the difficulty of the task decide

### Why did it pick an expensive model?

Usually one of:

- Budget mode is `balanced` or `expensive`
- In `auto` mode, the task profiler judged this one to need real reasoning
- The agent handling it has `allowedModels` restricted to premium models

`/cost` shows the breakdown.

### My Copilot quota is draining fast

Premium models cost several premium requests each. Set budget mode to `cheap` or `balanced` to prefer
1× models. AtlasMind automatically starts conserving when you drop below 30% remaining.

### It's slow

- Check provider health in the Model Provider panel — a struggling provider is often the cause
- Set speed mode to `fast`
- Use a local model for zero-latency work
- Lower `atlasmind.chatSessionTurnLimit` so less history is carried each turn

---

## Running work

### Why is `/project` asking for approval?

Because the plan touches more files than your threshold allows (12 by default). This is the guard that
stops a small request quietly becoming a large refactor. Change it with
`atlasmind.projectApprovalFileThreshold`.

### A step failed. What happens to the rest?

- That step's changes can be rolled back from its checkpoint
- Steps that didn't depend on it carry on
- The final report includes the failure rather than glossing over it
- You can re-run from the Project Run Center

### How do I keep `/project` from wandering?

Be specific about scope:

- "Refactor `src/auth/` to use JWT" — scoped to a directory
- "Add unit tests for the CostTracker class" — scoped to a class

### Can I stop a run?

Yes. Mission Control and the Project Run Center both let you stop a run, and every run has hard limits
on spend, time, iterations and tokens that stop it for you.

---

## Tools and skills

### How do I add a custom skill?

`Ctrl+Shift+P` → **AtlasMind: Add Skill** → create from a template or import an existing file. Custom
skills are security-scanned before they can be enabled.

### My custom skill won't enable

The security scanner blocked it. Right-click the skill in the sidebar → **Show Scan Results**.
Error-level findings — `eval`, `child_process`, hardcoded secrets — block enablement by design. Adjust
the rules with **AtlasMind: Configure Scanner Rules** if you're sure.

### How do I connect an MCP server?

`Ctrl+Shift+P` → **AtlasMind: Manage MCP Servers** → **Guided Setup**. Choose **Scan my computer** to
find servers AtlasMind can set up from tools you already have, or **Browse by category**. It checks
prerequisites, installs a missing runtime only after you confirm, collects credentials into
SecretStorage, and connects. No JSON required — though the **Advanced** tab is there if you prefer it.

### Why won't it run my terminal command?

Only around 40 read-only commands are pre-approved. Anything that changes state needs
`atlasmind.allowTerminalWrite = true` **and** explicit approval each time. The allow-list is in
[[Tool Execution]].

---

## Still stuck?

- Check the **AtlasMind** output channel in VS Code's Output panel
- [[Configuration]] documents every setting
- [[Security]] explains the boundaries and how to report a vulnerability
- [Open an issue](https://github.com/JoelBondoux/AtlasMind/issues)
