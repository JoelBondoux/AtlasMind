# Getting Started

If you only need the shortest path: install AtlasMind, configure one model provider, then run `@atlas /bootstrap` for a new repo or `@atlas /import` for an existing one.

If you are deciding whether to adopt it, the short answer is that AtlasMind is aimed at developers who want autonomous help without losing reviewability. The core workflow is safety-first, approval-aware, and well suited to red/green TDD-style execution instead of unchecked implementation-first edits.

## Prerequisites

| Requirement | Minimum |
|-------------|---------|
| VS Code | ≥ 1.95.0 |
| Node.js | ≥ 18 |
| npm | ≥ 9 |

## Installation

If you just want the shortest onboarding path, use the VS Code Marketplace build of AtlasMind, configure one provider, then run `@atlas /bootstrap` for a new project or `@atlas /import` for an existing one. The rest of this page covers the fuller setup paths and options.

After AtlasMind activates, new VS Code integrated terminals also expose the `atlasmind` command without requiring a manual PATH edit. That terminal shim is local to VS Code and does not change your system-wide shell configuration.

### From Source

```bash
git clone https://github.com/JoelBondoux/AtlasMind.git
cd AtlasMind
npm install
npm run compile
```

Press **F5** in VS Code to launch the Extension Development Host with AtlasMind loaded.

If you plan to use the Copilot provider, install the `GitHub Copilot Chat` extension and sign in.

### From VSIX

```bash
npm run package          # produces atlasmind-<version>.vsix
code --install-extension atlasmind-<version>.vsix
```

## First Steps

### 1. Configure a Model Provider

Open the Command Palette (`Ctrl+Shift+P`) → **AtlasMind: Manage Model Providers**.

Add an API key for at least one provider:

| Provider | Where to get a key |
|----------|-------------------|
| Anthropic | [console.anthropic.com](https://console.anthropic.com/) |
| OpenAI | [platform.openai.com](https://platform.openai.com/) |
| Azure OpenAI | Azure portal or Azure AI Foundry; also configure your resource endpoint and deployment names |
| Google Gemini | [aistudio.google.com](https://aistudio.google.com/) |
| Amazon Bedrock | AWS console; also configure your AWS region and Bedrock model IDs |
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com/) |
| Mistral | [console.mistral.ai](https://console.mistral.ai/) |
| z.ai | [z.ai](https://z.ai/) |
| GitHub Copilot | Install GitHub Copilot Chat and sign in — no API key needed |
| Local (Ollama, LM Studio) | No key required; configure endpoint in settings |

API keys are stored securely in VS Code's **SecretStorage** — never on disk or in settings files.

Search, voice, image, and video vendors such as EXA, ElevenLabs, Stability AI, and Runway are configured from **AtlasMind: Specialist Integrations** instead of the routed model-provider list.

### 2. Bootstrap a New Project

For a **new** project:

```
@atlas /bootstrap
```

This creates the SSOT memory folder structure and optionally scaffolds CI/CD and governance files.

### 3. Import an Existing Project

For an **existing** codebase:

```
@atlas /import
```

This scans your workspace for manifests, README files, key docs, security and governance guidance, plus focused codebase structure, then auto-populates a much richer SSOT baseline instead of only the bare minimum metadata.

### 4. Start Chatting

Type `@atlas` in the VS Code chat panel and ask anything:

```
@atlas How is this project structured?
@atlas Write unit tests for the auth module
@atlas /project Refactor the API layer to use dependency injection
```

The orchestrator automatically selects the best agent and model for each request. If you want the dedicated AtlasMind chat surface, use `AtlasMind: Open Chat Panel` or press `Ctrl+Alt+I` (`Cmd+Alt+I` on macOS).

### 4.5 Shape Ideas Before Execution

If you want to pressure-test a concept before running `/project`, open `AtlasMind: Open Project Ideation`. That command opens the dedicated ideation dashboard so you can add cards, drag or paste media into the board, speak prompts, and iterate with Atlas before committing to an autonomous execution goal.

### 5. Adjust Budget and Speed

Open **AtlasMind: Open Settings Panel** from the Command Palette to configure:

- **Budget Mode** — `cheap`, `balanced`, `expensive`, or `auto`
- **Speed Mode** — `fast`, `balanced`, `considered`, or `auto`

These preferences steer model selection across all providers. See [[Model Routing]] for details.

For teams with stricter delivery standards, pair these settings with approval modes and verification hooks so AtlasMind can operate as a visible red/green loop rather than a silent code generator.

## Sidebar Views

After activation, the **AtlasMind** sidebar appears with these main surfaces:

| View | Purpose |
|------|---------|
| **Chat** | Embedded AtlasMind chat workspace |
| **Project Runs** | Review recent autonomous run history |
| **Sessions** | Browse, file, archive, and restore chat sessions |
| **Memory** | Browse and query the SSOT index |
| **Agents** | List, enable/disable, create, and edit agents |
| **Skills** | Browse 31 built-in skills plus custom or MCP-backed skills |
| **MCP Servers** | Connect external tool servers |
| **Models** | View available models per provider |

## What's Next?

- [[CLI]] — run AtlasMind from the terminal against the current workspace
- [[Chat Commands]] — learn all slash commands
- [[Agents]] — create custom agents for your workflow
- [[Skills]] — explore the 31 built-in tools
- [[Memory System]] — understand long-term project memory
- [[Project Planner]] — run autonomous multi-step tasks
