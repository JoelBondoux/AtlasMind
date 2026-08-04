# CLI

**AtlasMind from a terminal.** Same orchestrator, same agents, same model routing, same project memory,
same safety rules — without opening the editor.

Useful when you want to run something against a repository from the command line, check what providers
are configured without launching VS Code, or use AtlasMind in a script or CI-style workflow.

---

## Getting it

Once AtlasMind is installed as a VS Code extension, `atlasmind` is available in **new VS Code integrated
terminals** automatically. AtlasMind adds it to the terminal's own PATH.

It does **not** change your system PATH or affect terminals outside VS Code. That's deliberate — an
extension quietly editing your shell configuration is not a good neighbour.

Working from source instead:

```bash
npm install
npm run compile
npm run cli -- providers list
```

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

The full autonomous workflow — planning, batched steps, and a final summary.

### Look at project memory

```bash
atlasmind memory list
atlasmind memory query "routing budget gates"
```

### Check your providers

```bash
atlasmind providers list
```

Shows which providers are configured in *this* environment and how many models each currently offers.

---

## Options

```text
--workspace <path>              Which repository to work in
--ssot <relative-path>          Where project memory lives, relative to the workspace
--provider <id>                 Restrict routing to one provider
--model <provider/model>        Pin one specific model
--allow-writes                  Permit changes (see Safety below)
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

- **Read-only tools work by default**
- **Workspace writes, git writes and terminal writes are blocked** unless you pass `--allow-writes`
- **External and higher-risk tools stay blocked** regardless

---

## Connecting providers

The CLI reads credentials from environment variables:

```text
ATLASMIND_PROVIDER_OPENAI_APIKEY
ATLASMIND_PROVIDER_ANTHROPIC_APIKEY
ATLASMIND_PROVIDER_GOOGLE_APIKEY
ATLASMIND_PROVIDER_COHERE_APIKEY
ATLASMIND_PROVIDER_XAI_APIKEY
ATLASMIND_AZURE_OPENAI_ENDPOINT
ATLASMIND_AZURE_OPENAI_DEPLOYMENTS
ATLASMIND_LOCAL_OPENAI_BASE_URL
```

| Provider | In the CLI? |
|---|---|
| Local (Ollama, LM Studio) | Yes |
| Anthropic | Yes |
| OpenAI-compatible providers | Yes |
| Azure OpenAI | Yes, with endpoint and deployments configured |
| GitHub Copilot | **No** — it depends on a VS Code API that only exists in the editor |
| Amazon Bedrock | Not yet — extension only for now |

### Where project memory comes from

1. `--ssot`, if you passed it and the path exists
2. Otherwise `project_memory/`, if it exists
3. Otherwise it runs with no loaded memory — it still knows where memory *would* go

---

## Letting other tools drive AtlasMind

`atlasmind-acp` presents AtlasMind itself as an ACP agent over local stdio, so another tool can use
AtlasMind's orchestrator, agents, routing, memory and workspace tools as its backend.

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

- It uses the default built-in agent unless you narrow routing with `--provider` or `--model`
- Provider availability depends entirely on the environment variables present
- Copilot-backed work stays in the editor
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
