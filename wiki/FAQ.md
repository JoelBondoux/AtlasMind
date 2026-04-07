# FAQ & Troubleshooting

## General

### What is AtlasMind?
AtlasMind is a VS Code extension that provides a multi-agent AI orchestrator with model routing, persistent project memory, and a skills registry. It turns VS Code's chat panel into an intelligent development assistant.

### How is it different from GitHub Copilot?
AtlasMind complements Copilot. While Copilot excels at inline completion, AtlasMind adds:
- **Multiple agents** with specialised roles
- **Persistent project memory** (SSOT) across sessions
- **Multi-model routing** across routed cloud, Copilot, and local providers with budget/speed control
- **Autonomous project execution** via `/project`
- **32 built-in skills** including git, terminal, Docker, test runner, code intelligence, and VS Code surface helpers
- **Custom skills** with security scanning
- **MCP server integration**

### Which AI models does it support?
Anthropic (Claude), OpenAI, Google Gemini, Azure OpenAI, Amazon Bedrock, Mistral, DeepSeek, z.ai, GitHub Copilot, and local models exposed through OpenAI-compatible endpoints such as Ollama or LM Studio.

### Does it cost money to use?
The extension itself is free. LLM API usage is billed by each provider. Subscription providers (e.g. Copilot) and local models incur no additional cost. Use **budget mode = cheap** to minimize API spend.

---

## Setup

### I installed the extension but don't see @atlas in the chat
- Ensure you're running VS Code ≥ 1.95.0
- Check that the extension is enabled in the Extensions panel
- Try reloading the window (`Ctrl+Shift+P` → Developer: Reload Window)

### How do I add an API key?
1. `Ctrl+Shift+P` → **AtlasMind: Manage Model Providers**
2. Click **Set Key** next to the provider
3. Keys are stored in VS Code SecretStorage (encrypted, never in settings files)

### Can I use it without any API keys?
Yes — if you have GitHub Copilot active, AtlasMind can route through it. You can also connect a local model via Ollama or LM Studio (no API key needed).

### How do I connect a local model?
1. Start Ollama or LM Studio with an OpenAI-compatible endpoint (e.g. `http://localhost:11434/v1`)
2. In the Model Provider panel, configure the **Local** provider with your endpoint URL
3. Models from the local server will appear in the Models tree view

---

## Memory

### What is the SSOT?
The Single Source of Truth is a folder of Markdown files (`project_memory/`) that stores project knowledge: architecture, decisions, conventions, roadmap, and more. AtlasMind reads from it automatically to give the LLM project context.

### How do I populate memory?
- `/bootstrap` — creates the folder structure and scaffolds initial content
- `/import` — scans your workspace and auto-populates memory from README, configs, and manifests
- Freeform — ask AtlasMind to "remember" something

### My memory entries aren't showing up
- Check that `atlasmind.ssotPath` points to the correct folder (default: `project_memory`)
- Ensure the files are valid Markdown
- Try `/memory <keyword>` to test retrieval

### Can I edit memory files manually?
Absolutely. They're plain Markdown files. Edit them in VS Code like any other file. Changes are picked up on the next query.

---

## Model Routing

### How do I control which model is used?
- **Budget mode** (`atlasmind.budgetMode`): cheap → expensive determines which price tier of models are considered
- **Speed mode** (`atlasmind.speedMode`): fast → considered determines which speed tier
- **Agent constraints**: Set `allowedModels` on a custom agent to force specific models
- **auto mode**: Let the task profiler decide based on the request

### Why is it using an expensive model?
- Budget mode may be set to `balanced` or `expensive`
- The task profiler may have detected a high-reasoning task (in `auto` mode)
- The agent may have `allowedModels` set to premium models only
- Check `/cost` for a breakdown

### My Copilot subscription quota is depleting too fast
- Premium models (e.g. Claude Opus 4 via Copilot) cost 3× per request
- Set budget mode to `cheap` or `balanced` to prefer 1× models
- The router automatically conserves quota when below 30% remaining

---

## Project Planner

### The /project command asks for approval. Why?
When the estimated file impact exceeds the approval threshold (default: 12 files), AtlasMind requires explicit approval. This prevents unintended large-scale changes. Adjust with `atlasmind.projectApprovalFileThreshold`.

### A subtask failed. What happens?
- Checkpoints allow rollback of that subtask's changes
- Other subtasks that don't depend on it continue
- The synthesis report includes the failure details
- You can re-run from the Project Run Center

### Can I limit the scope of /project?
Yes — be specific in your goal:
- "Refactor `src/auth/` to use JWT" (scoped to a directory)
- "Add unit tests for the `CostTracker` class" (scoped to a class)

---

## Skills & Tools

### How do I add a custom skill?
`Ctrl+Shift+P` → **AtlasMind: Add Skill** → Choose "Create from template" or "Import existing file". Custom skills are scanned for security issues before enablement.

### My custom skill won't enable
Check the security scan results:
- `Ctrl+Shift+P` → **AtlasMind: Configure Scanner Rules**
- Right-click the skill in the sidebar → **Show Scan Results**
- Error-level rules (eval, child_process, hardcoded secrets) block enablement

### How do I connect an MCP server?
`Ctrl+Shift+P` → **AtlasMind: Manage MCP Servers** → Add a server with stdio or HTTP transport. Tools auto-register as skills.

### Why is terminal-run blocking my command?
Only ~40 pre-approved commands are allowed. Write-capable commands (npm install, etc.) require `atlasmind.allowTerminalWrite = true` and explicit approval. See [[Tool Execution]] for the allow-list.

---

## Performance

### AtlasMind is slow
- Check provider health in the Model Provider panel
- Switch to `speed = fast` for quicker responses
- Use a local model for zero-latency inference
- Reduce `chatSessionTurnLimit` to carry less context

### High API costs
- Set `budget = cheap`
- Use Copilot (subscription) or local models
- Set `costLimitUsd` on custom agents
- Review spending with `/cost`
