# CLI

AtlasMind includes a Node-hosted CLI that reuses the same orchestrator, model router, skills, and SSOT memory loading as the VS Code extension.

The entrypoint is [src/cli/main.ts](../src/cli/main.ts).

## When To Use It

- Run AtlasMind against a workspace from the terminal.
- Inspect configured providers without opening VS Code UI.
- Query project memory or run a project task in CI-like or headless workflows.
- Reuse AtlasMind's routing and safety model outside the extension host.

## Build And Run

From the repository root:

```bash
npm install
npm run compile
```

Use the packaged script during development:

```bash
npm run cli -- providers list
npm run cli -- memory list
npm run cli -- chat "Summarise the current project memory"
```

When AtlasMind is installed as a VS Code extension, activation now exposes `atlasmind` in new VS Code integrated terminals by prepending an extension-managed shim directory to the terminal PATH.

Important boundary:

- This affects new terminals opened inside VS Code after AtlasMind activates.
- It does not modify the user's system-wide PATH or external terminals.
- Source-development workflows can still use `npm run cli -- ...` directly.

## ACP Agent Mode

`atlasmind-acp` exposes AtlasMind itself as an ACP v1 agent over local stdio:

```bash
atlasmind-acp --workspace /absolute/path/to/project
```

It uses the same headless orchestrator, built-in agents, model router, SSOT
loader, provider adapters, and workspace skills as the CLI. It does not open a
port. The official `@agentclientprotocol/sdk` handles newline-delimited JSON-RPC
framing; AtlasMind handles sessions, streaming, cancellation, bounded history,
and one-turn tool permissions.

Options:

```text
--workspace <absolute-path>
--ssot <relative-path>
--daily-limit-usd <n>
--buzz-auto-reply
--help
--version
```

### Buzz managed-agent setup

Run **AtlasMind: Copy Buzz ACP Agent Setup** from VS Code's Command Palette.
The copied JSON contains no credentials and gives the exact values for the open
workspace:

| Buzz field | Value |
|---|---|
| Provider | **Custom command** |
| Agent command | The copied VS Code/Electron runtime executable |
| Agent arguments | Paste `agentArgumentsField` (the stable AtlasMind runner plus workspace flags, comma-separated) |
| LLM provider | Leave blank |
| Model | Leave blank |

Buzz continues to run its bundled `buzz-acp` harness; the Custom command is the
ACP-speaking agent that harness starts. Set Buzz's managed-agent parallelism to
**1**, matching AtlasMind's single orchestrator loop.

On Windows the recipe deliberately does not use `atlasmind-acp.cmd`. Buzz
launches ACP agents directly and cannot use a batch shim as the child
executable. It starts VS Code's Electron executable in Node mode with the
stable JavaScript runner as the first argument, avoiding an intermediate
`cmd.exe` and its console window.

Under the Buzz agent's **Environment variables**, supply one intended model
route and the launcher mode:

```text
ELECTRON_RUN_AS_NODE=1
ATLASMIND_PROVIDER_OPENAI_APIKEY
ATLASMIND_PROVIDER_ANTHROPIC_APIKEY
ATLASMIND_LOCAL_OPENAI_BASE_URL
```

For an off-machine relay, also set
`ATLASMIND_BUZZ_ALLOW_REMOTE_RELAY=true` only after reviewing its WSS/HTTPS URL.
Buzz supplies `BUZZ_PRIVATE_KEY`, `BUZZ_RELAY_URL`, and the generated
channel/event context to the child. AtlasMind does not export credentials from
VS Code SecretStorage.

The Director's **Person** and **AtlasMind agent for their Buzz messages** fields
are a different mechanism: they attribute inbound work to an AtlasMind
specialist. They do not create a Buzz managed agent, start this command, or
reply. Create the executable agent under **Buzz Settings → Agents**.

## Commands

### Chat

```bash
atlasmind chat "Explain the architecture"
atlasmind chat "Review recent changes" --provider openai
atlasmind chat "Refactor the parser" --model anthropic/claude-sonnet-4
```

Runs a single task through the default AtlasMind agent and streams the response when the provider supports streaming.

### Project

```bash
atlasmind project "Add retry handling to the provider registry"
```

Runs the autonomous project workflow, including planning, batched subtasks, and final synthesis.

### Memory

```bash
atlasmind memory list
atlasmind memory query "routing budget gates"
```

Lists loaded SSOT entries or queries them for relevant snippets.

### Providers

```bash
atlasmind providers list
```

Shows routed providers, whether each one is configured in the current CLI environment, and how many models are currently available.

## Common Options

```text
--workspace <path>
--ssot <relative-path>
--provider <id>
--model <provider/model>
--allow-writes
--budget <cheap|balanced|expensive|auto>
--speed <fast|balanced|considered|auto>
--daily-limit-usd <n>
--json
--help
--version
```

Notes:

- `--workspace` changes the workspace root used for file and memory operations.
- `--ssot` overrides the SSOT folder location relative to the workspace root.
- `--provider` constrains routing to one provider.
- `--model` narrows execution to one specific routed model.
- `--json` emits machine-readable output for supported commands.
- Unknown flags, missing option values, invalid provider IDs, invalid budget or speed modes, and malformed daily-budget values are treated as CLI errors instead of being silently folded into prompt text.

## SSOT Loading

The CLI resolves SSOT memory in this order:

1. Use `--ssot` when provided and the path exists.
2. Otherwise use the default `project_memory/` folder when it exists.
3. If neither exists, AtlasMind still resolves the target path but starts with no loaded memory content.

## Provider Configuration

The CLI reads credentials from environment variables derived from the same secret keys used by the extension.

Examples:

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

Current CLI support follows the host-neutral provider layer:

- Supported in CLI: local, Anthropic, OpenAI-compatible providers, Azure OpenAI when endpoint and deployments are configured.
- Not available in CLI: GitHub Copilot, because it depends on the VS Code Language Model API.
- Not currently wired in CLI: Amazon Bedrock, which remains on the extension-host configuration path.

## Safety Model

CLI safety is stricter than the extension host.

- Read-only tools are allowed by default.
- Workspace writes, git writes, and terminal writes are blocked unless you pass `--allow-writes`.
- External and higher-risk tools remain blocked in CLI mode.

This is enforced by the CLI runtime approval gate in [src/cli/main.ts](../src/cli/main.ts).

## Limitations

- The CLI uses the default built-in agent unless you constrain routing with `--provider` or `--model`.
- Provider availability depends entirely on the current process environment.
- Copilot-backed execution remains extension-only.
- Agent-side ACP uses environment-backed headless providers; it cannot inherit
  VS Code-only Copilot capacity or SecretStorage credentials.
- Only one ACP prompt turn executes at a time. Buzz managed-agent parallelism
  should remain 1.
- The CLI is designed for shared orchestration and workspace automation, not for replicating every UI surface from the extension.

## Related Pages

- [[Getting Started]]
- [[Architecture]]
- [[Model Routing]]
- [[Tool Execution]]
- [[Contributing]]
