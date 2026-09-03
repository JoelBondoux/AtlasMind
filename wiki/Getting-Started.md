# Getting Started

**The short version:** install AtlasMind, connect one model provider, then run `@atlas /bootstrap`
if the project is new or `@atlas /import` if it already exists. That's enough to start asking for
real work. Everything below is the longer explanation.

---

## Before you start

| You need | Version |
|-------------|---------|
| VS Code | 1.96.0 or newer |
| Node.js | 18 or newer |
| npm | 9 or newer |

And **one way to reach a model** — see [step 1](#1-connect-a-model) below. If you already pay for
Claude, ChatGPT, Copilot or Qwen, you can use that instead of buying API credit.

---

## Install it

### From the Marketplace (recommended)

[Install AtlasMind](https://marketplace.visualstudio.com/items?itemName=JoelBondoux.atlasmind), or
search for "AtlasMind" in the VS Code Extensions panel.

### From a VSIX

```bash
npm run package          # produces atlasmind-<version>.vsix
code --install-extension atlasmind-<version>.vsix
```

### From source

```bash
git clone https://github.com/JoelBondoux/AtlasMind.git
cd AtlasMind
npm install
npm run compile
```

Press **F5** to launch a VS Code window with AtlasMind loaded.

---

## 1. Connect a model

Open the Command Palette (`Ctrl+Shift+P`) → **AtlasMind: Manage Model Providers**.

You have three kinds of option, and you can mix them freely.

### Use a subscription you already pay for

The cheapest way in, because it costs nothing extra. If you already have one of these installed and
signed in, AtlasMind can route work through it:

| You have | What to do |
|---|---|
| A Claude plan | Click **Use my Claude subscription** on the Anthropic card |
| A ChatGPT plan | Click **Use my ChatGPT subscription** on the OpenAI card |
| GitHub Copilot | Install GitHub Copilot Chat and sign in — nothing else needed |
| A Qwen plan | Configure it as an ACP agent |
| Gemini Code Assist Standard or Enterprise | Click **Use my Code Assist licence** on the Google card |

Not installed yet? AtlasMind offers the `/acp` walkthrough, which names the agent, installs it, helps
you sign in, and then **proves a real answer comes back** before calling it done.

### Use an API key

| Provider | Where to get a key |
|----------|-------------------|
| Anthropic | [console.anthropic.com](https://console.anthropic.com/) |
| OpenAI | [platform.openai.com](https://platform.openai.com/) |
| Google Gemini | [aistudio.google.com](https://aistudio.google.com/) |
| Azure OpenAI | Azure portal or Azure AI Foundry — you'll also need your endpoint and deployment names |
| Amazon Bedrock | AWS console — you'll also need your region and Bedrock model IDs |
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com/) |
| Mistral | [console.mistral.ai](https://console.mistral.ai/) |
| z.ai | [z.ai](https://z.ai/) |

Keys go into VS Code's **SecretStorage** — the OS keychain. Never a settings file, never your repository,
and redacted before anything reaches a model.

### Use a local model

Run Ollama or LM Studio, then point the **Local** provider at its endpoint (typically
`http://localhost:11434/v1`). No key, no bill, nothing leaves your machine. Models appear in the Models
sidebar once connected.

> Search, voice, image and video services — EXA, ElevenLabs, Stability AI, Runway — are configured
> separately under **AtlasMind: Specialist Integrations**, not in the model provider list.

---

## 2. Tell AtlasMind about your project

AtlasMind works far better when it knows what your project *is*. This step takes a minute and pays for
itself immediately.

**For a new project:**

```
@atlas /bootstrap
```

Creates the project memory structure and, optionally, starter CI/CD and governance files. Guided intake
also offers create-only platform prefabs. **WooCommerce Extension** produces a safe PHP plugin shell,
HPOS and dependency declarations, syntax/contract CI, and compatibility/privacy review records that
begin Not assessed. AtlasMind records local setup commands but does not run a generator, install
packages, start Docker, or contact the network during bootstrap.

**For an existing codebase:**

```
@atlas /import
```

Reads your manifests, README, key docs, and code structure, and writes a genuinely useful starting
picture of the project rather than bare metadata.

Either way you end up with a `project_memory/` folder of plain Markdown you can read and edit yourself.
See [[Memory System]].

---

## 3. Ask for something

Type `@atlas` in the VS Code chat panel, or open the bigger dedicated panel with
**AtlasMind: Open Chat Panel** (`Ctrl+Alt+I`, or `Cmd+Alt+I` on macOS).

```
@atlas How is this project structured?
@atlas Write unit tests for the auth module
@atlas /project Refactor the API layer to use dependency injection
```

AtlasMind picks the specialist and the model for you. You'll see which it chose, what it did, and what
it cost.

---

## 4. Set your spending and speed preferences

Open **AtlasMind: Open Settings Panel** and set two things:

- **Budget mode** — `cheap`, `balanced`, `expensive`, or `auto`. `cheap` prefers local models and
  subscriptions; `auto` lets the difficulty of the task decide.
- **Speed mode** — `fast`, `balanced`, `considered`, or `auto`.

While you're there, set `dailyCostLimitUsd` if you want a hard ceiling. See [[Model Routing]] for how
the choice is actually made, and [[Configuration]] for everything else.

---

## 5. Decide how much you want to approve

By default AtlasMind asks before it writes anything. That's `toolApprovalMode: ask-on-write`.

As you get comfortable, you can loosen it — or tighten it to `always-ask` if you'd rather see every
step. Pair it with `autoVerifyAfterWrite` so your own lint and test commands run after each change.
See [[Tool Execution]].

---

## What's in the sidebar

The **AtlasMind** icon in the activity bar opens these:

| View | What it's for |
|------|---------|
| **Chat** | Where you talk to Atlas |
| **Lens** | The symbols in the file you're looking at, and actions on them |
| **Director** | People, responsibilities and follow-ups — carries an overdue badge |
| **Project State** | A glance at where the project stands |
| **Sessions** | Past conversations, filed and searchable |
| **Project Runs** | History of autonomous runs |
| **Memory** | Browse and query project memory |
| **Models** | What's available from each provider |
| **Agents** | Enable, disable, create and edit agents |
| **Skills** | The 43 built-in tools plus your own and any MCP tools |
| **MCP Servers** | Connect external tool servers |
| **Resource Discovery** | Find new agents, skills and servers |

---

## Optional: set up Lens declarations

Lens can explain your project's state machines and configuration precedence — but only if you tell it
what they are, because guessing would be worse than not answering.

Run **AtlasMind: Lens: Set Up Repository Declarations**. It shows you what's configured, and can create
valid *empty* starter files (`.atlasmind/lens-state.json`, `.atlasmind/lens-config.json`) with schema
completion turned on. It never invents your project's states, precedence, values or secrets, and never
overwrites a file you already have.

---

## Where to go next

- **[[Chat Commands]]** — everything you can type
- **[[Agents]]** — the specialists, and building your own
- **[[Project Planner]]** — running multi-step work
- **[[GitHub Workflow]]** — the guided path from idea to release
- **[[FAQ]]** — when something doesn't behave
- **[[CLI]]** — the same thing from a terminal
