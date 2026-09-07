# CLI

**AtlasMind from a checkout, for scripts and CI.** Same orchestrator, same agents, same model routing,
same project memory — without opening the editor.

Useful when you want to run something against a repository from a script, a CI-style workflow, or a
terminal you already have open. It is not a second front end for the extension: it exposes four
commands, and everything else about AtlasMind lives in the editor.

> **Two things are worth separating before you start.** The CLI does not inherit anything from your
> VS Code installation — not your API keys, not your provider setup. It reads credentials from
> environment variables and nothing else. Set those up first; the rest of this page assumes you have.

---

## Connecting providers

**Do this first.** The CLI cannot read VS Code's secret storage — that API only exists inside the
editor — so a machine with every provider configured in AtlasMind still starts from zero here. Until
an environment variable is present, `atlasmind providers list` reports `configured=no` for everything
and any request fails to route.

```text
ATLASMIND_PROVIDER_ANTHROPIC_APIKEY
ATLASMIND_PROVIDER_OPENAI_APIKEY
ATLASMIND_PROVIDER_GOOGLE_APIKEY
ATLASMIND_PROVIDER_MISTRAL_APIKEY
ATLASMIND_PROVIDER_DEEPSEEK_APIKEY
ATLASMIND_PROVIDER_ZAI_APIKEY
ATLASMIND_PROVIDER_XAI_APIKEY
ATLASMIND_PROVIDER_COHERE_APIKEY
ATLASMIND_PROVIDER_PERPLEXITY_APIKEY
ATLASMIND_PROVIDER_HUGGINGFACE_APIKEY
ATLASMIND_PROVIDER_NVIDIA_APIKEY

ATLASMIND_LOCAL_OPENAI_BASE_URL      Ollama, LM Studio, any OpenAI-compatible local endpoint
ATLASMIND_PROVIDER_AZURE_APIKEY      Azure also needs both variables below
ATLASMIND_AZURE_OPENAI_ENDPOINT
ATLASMIND_AZURE_OPENAI_DEPLOYMENTS   Comma-separated deployment names
```

A provider adapter is registered only when its key is present, so the list you get back is exactly
what this shell can reach.

| Provider | In the CLI? |
|---|---|
| Local (Ollama, LM Studio) | Yes |
| Anthropic | Yes |
| OpenAI-compatible providers | Yes — the eleven keys above |
| Azure OpenAI | Yes, with endpoint and deployments set |
| GitHub Copilot | **No** — it depends on a VS Code API that only exists in the editor |
| Amazon Bedrock | Not yet — extension only for now |

---

## Getting it

### From a checkout

The dependable route, and the one to use in CI:

```bash
npm install
npm run compile
npm run cli -- providers list
```

Or call the built entry point directly, which is what `npm run cli` does:

```bash
node ./out/cli/main.js providers list
```

### On the PATH of VS Code integrated terminals

Optional, off by default. Set **`atlasmind.cli.addToTerminalPath`** to `true`, then open a **new**
integrated terminal — existing ones keep the environment they started with. AtlasMind writes launcher
shims into its own storage directory and prepends that directory to the terminal's PATH, after which
`atlasmind` and `atlasmind-acp` resolve as commands.

It does **not** change your system PATH or affect terminals outside VS Code, which is why it ships off:
an extension that quietly edits your shell environment is not a good neighbour.

### Where project memory comes from

1. `--ssot`, if you passed it and the path exists
2. Otherwise `project_memory/`, if it exists
3. Otherwise it runs with no loaded memory — it still knows where memory *would* go

---

## The commands

### Ask it something

```bash
atlasmind chat "Explain the architecture"
atlasmind chat "Review recent changes" --provider openai
atlasmind chat "Refactor the parser" --model anthropic/claude-sonnet-4
```

Runs one task through the default agent, streaming the response where the provider supports it.

### Run a whole piece of work

```bash
atlasmind project "Add retry handling to the provider registry"
```

The full autonomous workflow — planning, batched steps, and a final summary. Read the safety section
below before pointing this at a repository you care about.

### Look at project memory

```bash
atlasmind memory list
atlasmind memory query "routing budget gates"
```

### Check your providers

```bash
atlasmind providers list
```

Shows which providers this environment can reach and how many models each currently offers. The
fastest way to confirm your keys are visible before running anything that costs money.

---

## Options

```text
--workspace <path>              Which repository to work in
--ssot <relative-path>          Where project memory lives, relative to the workspace
--provider <id>                 Restrict routing to one provider
--model <provider/model>        Pin one specific model
--allow-writes                  Permit changes (see Safety below)
--allow-commands                Permit terminal reads (npm test, build, lint) that run repo-defined scripts
--budget <cheap|balanced|expensive|auto>
--speed <fast|balanced|considered|auto>
--daily-limit-usd <n>
--json                          Machine-readable output
--help
--version
```

**Bad input is an error, not a prompt.** An unknown flag, a missing value, an invalid provider ID, or a
malformed budget figure fails clearly rather than being quietly swept into your prompt text — which is
how you end up paying for a request that asked the model about your typo.

---

## Safety in the CLI is tighter than in the editor

There's no panel to click "approve" in, so the defaults are stricter:

- **Local reads work by default** — files, git status, git log
- **Workspace writes, git writes and terminal writes are blocked** unless you pass `--allow-writes`
- **Terminal commands are blocked** unless you pass `--allow-commands`
- **External and higher-risk tools stay blocked** regardless

`--allow-commands` exists because `terminal-read` is a misleading name for a safe-sounding category.
`npm test`, `npm run build` and `npm run lint` all grade there, and each executes whatever the
repository's `package.json` says it does. They were permitted unconditionally until v0.405.0, which
meant read-only mode could run arbitrary code from the checkout it was aimed at. It is a separate flag
from `--allow-writes` on purpose: running a test suite should not also grant the ability to edit files.

---

## Letting other tools drive AtlasMind

`atlasmind-acp` is a different thing from the CLI above, and you are not expected to type it. It
presents AtlasMind itself as an ACP agent over local stdio, so another tool can use AtlasMind's
orchestrator, agents, routing, memory and workspace tools as its backend.

```bash
atlasmind-acp --workspace /absolute/path/to/project
```

It opens no network port. Options are `--workspace`, `--ssot`, `--daily-limit-usd`, `--buzz-auto-reply`,
`--help` and `--version`.

### Setting it up with Buzz

Run **AtlasMind: Copy Buzz ACP Agent Setup** from the Command Palette. What gets copied contains **no
credentials** — just the exact values for your open workspace.

In Buzz, create a managed agent:

| Buzz field | What to put |
|---|---|
| Provider | **Custom command** |
| Agent command | The copied runtime executable |
| Agent arguments | Paste the copied arguments |
| LLM provider | Leave blank |
| Model | Leave blank |

Set Buzz's parallelism to **1** — AtlasMind runs one orchestrator loop at a time.

Then give the agent one model route through its environment variables (`ELECTRON_RUN_AS_NODE=1` plus one
of the `ATLASMIND_PROVIDER_*` keys or `ATLASMIND_LOCAL_OPENAI_BASE_URL`). AtlasMind never exports
credentials out of VS Code's secret storage — the child process gets what you give it and nothing more.

> **On Windows**, the setup deliberately avoids a `.cmd` shim. Buzz launches agents directly and can't
> use a batch file as the child executable, so the recipe starts the runtime in Node mode instead —
> which also avoids an intermediate console window.

> **A Director "Person" is not this.** Attaching a Buzz identity to a Person routes inbound work to an
> AtlasMind specialist. It doesn't create a Buzz agent, start a process, or send replies. Those are
> separate things in a separate application.

---

## What it can't do

- Nothing carries over from the editor — keys, provider setup and Copilot capacity all stay there
- It uses the default built-in agent unless you narrow routing with `--provider` or `--model`
- Provider availability depends entirely on the environment variables present
- ACP agent mode can't inherit Copilot capacity or your VS Code stored credentials
- One ACP turn runs at a time
- It's built for orchestration and automation, not for reproducing every panel in the extension

---

## Related

- [[Getting Started]]
- [[Model Routing]]
- [[Tool Execution]]
- [[Architecture]]
- [[Contributing]]
