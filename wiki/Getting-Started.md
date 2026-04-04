# Getting Started

## Prerequisites

| Requirement | Minimum |
|-------------|---------|
| VS Code | ≥ 1.95.0 |
| Node.js | ≥ 18 |
| npm | ≥ 9 |

## Installation

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
| Google Gemini | [aistudio.google.com](https://aistudio.google.com/) |
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com/) |
| Mistral | [console.mistral.ai](https://console.mistral.ai/) |
| z.ai | [z.ai](https://z.ai/) |
| GitHub Copilot | Install GitHub Copilot Chat and sign in — no API key needed |
| Local (Ollama, LM Studio) | No key required; configure endpoint in settings |

API keys are stored securely in VS Code's **SecretStorage** — never on disk or in settings files.

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

This scans your workspace for `package.json`, `README.md`, `tsconfig.json`, license files, and directory structure, then auto-populates memory with project metadata.

### 4. Start Chatting

Type `@atlas` in the VS Code chat panel and ask anything:

```
@atlas How is this project structured?
@atlas Write unit tests for the auth module
@atlas /project Refactor the API layer to use dependency injection
```

The orchestrator automatically selects the best agent and model for each request.

### 5. Adjust Budget and Speed

Open **AtlasMind: Open Settings** from the Command Palette to configure:

- **Budget Mode** — `cheap`, `balanced`, `expensive`, or `auto`
- **Speed Mode** — `fast`, `balanced`, `considered`, or `auto`

These preferences steer model selection across all providers. See [[Model Routing]] for details.

## Sidebar Views

After activation, the **AtlasMind** sidebar appears with:

| View | Purpose |
|------|---------|
| **Agents** | List, enable/disable, create, and edit agents |
| **Skills** | Browse 26+ skills, toggle individually, scan custom skills |
| **MCP Servers** | Connect external tool servers |
| **Memory** | Browse and query the SSOT index |
| **Models** | View available models per provider |
| **Project Runs** | Review recent autonomous run history |

## What's Next?

- [[Chat Commands]] — learn all slash commands
- [[Agents]] — create custom agents for your workflow
- [[Skills]] — explore the 26 built-in tools
- [[Memory System]] — understand long-term project memory
- [[Project Planner]] — run autonomous multi-step tasks
