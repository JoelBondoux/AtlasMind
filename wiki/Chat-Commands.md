# Chat Commands

AtlasMind registers the `@atlas` chat participant in VS Code's built-in chat panel. Type `@atlas` followed by a slash command or a freeform question.

## Slash Commands

| Command | Description |
|---------|-------------|
| `/bootstrap` | Initialize SSOT memory structure and optionally scaffold governance files |
| `/import` | Scan an existing project and populate memory with metadata |
| `/project` | Decompose a goal into subtasks, preview impact, and execute autonomously |
| `/runs` | Open the Project Run Center to review recent autonomous runs |
| `/agents` | List and manage registered agents |
| `/skills` | List and manage registered skills |
| `/memory` | Query the SSOT memory system |
| `/cost` | Show session cost summary |
| `/voice` | Open the Voice Panel for text-to-speech and speech-to-text |
| `/vision` | Pick workspace images and ask a multimodal question |

---

## `/bootstrap`

Creates the SSOT memory folder structure and offers optional CI/CD governance scaffolding.

```
@atlas /bootstrap
```

**What happens:**
1. Creates `project_memory/` with all SSOT sub-folders
2. Prompts for project type → populates `project_soul.md`
3. Optionally scaffolds `.github/workflows/ci.yml`, PR template, issue templates, `CODEOWNERS`, `.vscode/extensions.json`
4. Non-destructive — never overwrites existing files

---

## `/import`

Scans the current workspace and auto-populates SSOT memory.

```
@atlas /import
```

**What it scans:**
- Manifests: `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `pom.xml`, `build.gradle`, `Gemfile`, `composer.json`
- README files
- Config: `tsconfig.json`, ESLint, Prettier, `.editorconfig`, `Dockerfile`, `docker-compose.yml`, `Makefile`, `.gitignore`
- License files

**What it creates:**
- `architecture/project-overview.md` — from README
- `architecture/dependencies.md` — from manifest
- `architecture/project-structure.md` — from directory listing
- `domain/conventions.md` — from config files
- `domain/license.md` — detected license type

**Detected project types:** VS Code Extension, API Server, Web App, Library, CLI Tool, Rust/Python/Go/Java/Ruby/PHP Project.

---

## `/project`

Decomposes a goal into subtasks and executes them autonomously.

```
@atlas /project Refactor the auth module to use JWT tokens
@atlas /project Add comprehensive unit tests for the API layer
@atlas /project Set up a CI/CD pipeline with Docker deployment
```

**Flow:**
1. LLM breaks the goal into a DAG of subtasks
2. Preview shows estimated file impact
3. If changes exceed the approval threshold (default: 12 files), you must approve
4. Subtasks execute in parallel batches with ephemeral agents
5. Final synthesis report streamed to chat
6. Run saved to Project Run History

See [[Project Planner]] for full details.

---

## `/runs`

Opens the Project Run Center to review, re-run, or inspect past autonomous runs.

```
@atlas /runs
```

---

## `/agents`

Lists all registered agents with their roles and enabled status.

```
@atlas /agents
```

Output includes agent name, role, description, and whether the agent is currently enabled.

---

## `/skills`

Lists all registered skills (built-in + custom + MCP) with their enabled status.

```
@atlas /skills
```

---

## `/memory`

Queries the SSOT memory system by keyword.

```
@atlas /memory authentication decisions
@atlas /memory project architecture
@atlas /memory deployment runbooks
```

Returns matching entries ranked by relevance (title, path, tag, and snippet matches).

---

## `/cost`

Shows the current session's cost summary.

```
@atlas /cost
```

Displays total cost in USD, total requests, and per-provider breakdown.

---

## `/voice`

Opens the Voice Panel for text-to-speech (TTS) and speech-to-text (STT).

```
@atlas /voice
```

---

## `/vision`

Opens an image picker for workspace images and submits a multimodal prompt.

```
@atlas /vision Describe what's in these screenshots
```

---

## Freeform Chat

Any message without a slash command is treated as a freeform request:

```
@atlas How is error handling done in this codebase?
@atlas Write a function to parse CSV files with proper error handling
@atlas Explain the model routing algorithm
```

**What happens behind the scenes:**
1. Orchestrator selects the most relevant agent
2. Memory manager fetches related SSOT entries
3. Task profiler infers phase, modality, and reasoning needs
4. Model router picks the best model (within budget/speed preferences)
5. Agent executes with available skills
6. Response streamed to chat with cost tracking

**Multimodal:** Freeform messages auto-detect image paths in the workspace and attach them to the prompt.

**Session context:** The last N turns (configurable, default: 6) are carried forward for conversational continuity.

---

## Extension Commands

These are also available from the Command Palette (`Ctrl+Shift+P`):

| Command | What it does |
|---------|-------------|
| `AtlasMind: Open Settings` | Budget/speed sliders, approval policies, verification config |
| `AtlasMind: Manage Model Providers` | Add API keys, refresh models, health checks |
| `AtlasMind: Manage Agents` | Create and configure custom agents |
| `AtlasMind: Open Project Run Center` | Review, approve, pause, resume autonomous runs |
| `AtlasMind: Manage MCP Servers` | Connect external tool servers |
| `AtlasMind: Tool Webhooks` | Forward tool events to external endpoints |
| `AtlasMind: Open Voice Panel` | TTS and STT |
| `AtlasMind: Open Vision Panel` | Image-based multimodal prompts |
| `AtlasMind: Bootstrap Project` | Same as `/bootstrap` |
| `AtlasMind: Import Existing Project` | Same as `/import` |
| `AtlasMind: Show Cost Summary` | Same as `/cost` |
| `AtlasMind: Configure Scanner Rules` | View and edit skill security scanning rules |

---

## Follow-up Suggestions

After each command, AtlasMind suggests relevant next steps:

| After | Suggested follow-ups |
|-------|---------------------|
| `/bootstrap` | View agents, View skills, Query memory, Start a project |
| `/import` | View imported overview, View dependencies, View agents, Start a project |
| `/project` | Review cost, Save plan to memory, Run another project |
| `/agents` | View skills, Run a project, How to add an agent |
| `/skills` | View agents, How to add a skill, Run a project |
| Freeform | Turn into a project |
