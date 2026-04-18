<p align="center">
  <img src="media/icon.png" width="120" height="120" alt="AtlasMind logo" />
</p>

<h1 align="center">AtlasMind (Beta)</h1>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=JoelBondoux.atlasmind">
    <img src="https://img.shields.io/visual-studio-marketplace/v/JoelBondoux.atlasmind?label=marketplace%20version" alt="Latest published VS Code Marketplace version" />
  </a>
</p>


<p align="center"><sub>Current version: <strong>0.49.30</strong> (see <a href="package.json">package.json</a>).</sub></p>
<p align="center"><sub>Marketplace badge shows the latest published Marketplace version. The source version for this branch lives in <a href="package.json">package.json</a>.</sub></p>

<p align="center"><sub>AtlasMind remains in Beta until version 1.0.0, even though Marketplace publishes now ship on the standard release channel.</sub></p>

<p align="center">
  <strong>AI coding inside VS Code, with model choice, project memory, approvals, and costs you can actually control.</strong>
</p>

AtlasMind is a VS Code extension for developers who want AI help without giving up control. It routes work across your models, stores project knowledge in plain Markdown, and keeps tool use, approvals, and spend visible instead of buried.

For newer developers, AtlasMind gives you guided entry points like `/bootstrap`, `/import`, and `/project`. `/bootstrap` now runs a skippable intake through Atlas chat so the same answers can seed SSOT memory, ideation defaults, project-scoped personality defaults, routing settings, and GitHub-ready planning artifacts. It also reuses future-looking details when they are provided early instead of asking the same question twice, including whether a project already has an online repo and where a new one should live if it does not. For experienced developers, it gives you multi-model routing, persistent SSOT memory, MCP extensibility, local-model support, and audit-friendly execution.

AtlasMind defaults to safety and evidence over blind autonomy. Its project workflow is built around safety-first execution, approval-aware changes, and red/green TDD-style autonomous delivery where implementation is expected to follow a visible failing-signal path instead of skipping straight to unchecked code edits.

## Why AtlasMind



 **User Environment Tracking**: AtlasMind detects and stores each user's development environment (OS, hardware, shell, editor) privately. Data is never shared between users or with the workspace. See `docs/user-environment.md`.
## 30-Second Start (v0.49.30)

 User environment info is detected and stored per user in VS Code SecretStorage. AtlasMind uses this to tailor commands and suggestions. No user can access another user's environment data.
1. Install **AtlasMind** from the VS Code Marketplace.
2. Run **AtlasMind: Manage Model Providers** and configure one provider.
3. In chat, run `@atlas /bootstrap` for a new repo or `@atlas /import` for an existing one. The bootstrap and import flows now also create a developer-facing SSOT roadmap at `project_memory/roadmap/improvement-plan.md`, and the Project Dashboard can edit and reorder that backlog directly.
4. Ask a real task, or run `@atlas /project <goal>` for a larger change.

That is enough to get productive. AtlasMind stores provider credentials in VS Code SecretStorage and loads project memory from the configured SSOT path or the default `project_memory/` folder.

## What You Can Do

| Goal | Start here |
|---|---|
| Understand an unfamiliar codebase | `@atlas` chat or `@atlas /import` |
| Shape how Atlas behaves in this repo | `AtlasMind: Open Personality Profile` |
| Plan and execute a larger change | `@atlas /project <goal>` |
| Shape an idea before execution | `AtlasMind: Open Project Ideation` |
| Prioritize what Atlas should tackle next | `AtlasMind: Open Project Dashboard` -> Roadmap page |
| Choose or tune routed models | `AtlasMind: Manage Model Providers` |
| Inspect approvals, costs, and run state | `AtlasMind: Open Project Dashboard`, `AtlasMind: Open Project Run Center`, `AtlasMind: Open Cost Dashboard` |
| Add your own tools | Custom skills, `AtlasMind: Manage MCP Servers`, `AtlasMind: Install Recommended MCP Server`, or `AtlasMind: Import VS Code MCP Servers` |

## Why Teams Pick It

- Project memory lives in plain files that can be reviewed, committed, and shared.
- Model choice is not locked to one vendor or one pricing model.
- Approvals, verification, and webhook hooks make autonomous work easier to trust.
- The CLI reuses the same orchestration model for headless or CI-style workflows.

## Quick Comparison

| Selling point | AtlasMind | Typical AI coding tool |
|---|---|---|
| Works inside stock VS Code | Yes | Sometimes |
| Multi-model routing | Built in | Often single-vendor or manual |
| Persistent project memory | Plain-file SSOT | Often shallow or session-only |
| Safety and approvals | First-class | Usually lighter-weight |
| Red/green autonomous workflow | Supported | Often implementation-first |
| Extensibility | Skills, MCP, plugins | Usually narrower |

## Core Surfaces

- **Chat and slash commands**: `@atlas`, `/bootstrap`, `/import`, `/project`, `/runs`, `/agents`, `/skills`, `/memory`, `/cost`, `/voice`, `/vision`
- **Guided bootstrap intake**: `/bootstrap` can ask skippable product, team, timeline, budget, audience, stack, integration, and repo-hosting questions, infer future answers from earlier freeform responses, then seed `project_soul.md`, a project brief, ideation defaults, a repository plan, a weighted developer roadmap in `project_memory/roadmap/improvement-plan.md`, project-scoped Personality Profile defaults, workspace routing defaults, and GitHub-ready planning files.
- **Command Palette**: top-level AtlasMind surfaces such as Settings, Personality Profile, Model Providers, Agents, MCP Servers, Install Recommended MCP Server, Import VS Code MCP Servers, Project Dashboard, Project Ideation, Project Run Center, Voice, Vision, Cost, and Collapse All Sidebar Trees
- **Curated MCP starter installs**: AtlasMind-ready presets from the audited MCP catalogue can now be installed and connected directly from Settings, and AtlasMind can also bootstrap missing local runtimes through supported package managers on Windows, macOS, and Linux before the first connection. The catalogue now also covers common commerce, CMS, creator, and social platform integrations, and saved MCP entries can be reopened from Configured Servers to edit their parameters in place.
- **MCP import bridge**: AtlasMind can scan the current VS Code profile `mcp.json` plus workspace `.vscode/mcp.json` files and copy compatible `stdio` or `http` servers into AtlasMind's own MCP registry, which is useful when a tool already works in Copilot chat but has not been registered in Atlas yet.
- **Sidebar Home**: the AtlasMind sidebar starts with a composite Home surface that groups quick actions, recent sessions, recent autonomous runs, and workspace status into internal accordion sections with remembered manual heights
- **Personality Profile inputs**: every prompt combines an editable freeform answer with quick-fill presets, can be saved either as a global default or as a project-specific override, and keeps editor-only load actions separate from the destructive clear-project-override action
- **Live settings shortcuts**: the Personality Profile live-settings tiles open the matching Atlas settings page so you can jump straight into models, chat, safety, or project configuration from the profile panel
- **Sidebar home and actions**: the top Home surface opens major AtlasMind workspaces and summarizes recent activity, while the lower views keep local actions for Agents, Skills, Sessions, Memory, Models, and MCP Servers. The Models tree keeps friendly names as the primary label but now shows exact model slugs inline whenever one provider exposes multiple variants with the same display name.
- **Managed terminal chat launches**: the shared Atlas chat surface can run bounded shell-integrated terminal commands through aliases such as `@tps`, `@tpowershell`, `@tpwsh`, `@tgit`, `@tbash`, and `@tcmd`, stream the output into the thread, and optionally let AtlasMind request one approval-gated follow-up command in the same session before summarizing the result. Profile- or remote-backed terminals like JavaScript Debug Terminal and Azure Cloud Shell are not wired into this managed runner yet, so those aliases currently return explicit guidance instead of silently failing.
- **Live steering during responses**: while AtlasMind is still responding in the shared chat surface, the composer remains editable so you can switch the send mode to `Steer`, submit a redirecting prompt, and have AtlasMind stop the active turn and continue immediately with the new steering instruction.

## Voice

The Voice Panel uses the webview runtime's Web Speech APIs for browser-side STT and fallback TTS, with optional ElevenLabs server-side TTS when configured. AtlasMind now persists preferred microphone and speaker ids in workspace settings, applies output routing to ElevenLabs audio when the runtime supports `setSinkId`, and explicitly marks where browser speech still follows the default OS or browser device. OS-native speech backends are not wired in yet.

## Configuration

AtlasMind's routing controls live under the `atlasmind.*` settings namespace. Alongside `budgetMode`, `speedMode`, and `feedbackRoutingWeight`, specialist routing can now be tuned per domain with `atlasmind.specialistRoutingOverrides` when a workspace needs to pin research, visual-analysis, voice, robotics, simulation, or media-generation requests to a preferred provider or fallback workflow surface. Local routing can also aggregate multiple labeled OpenAI-compatible endpoints through `atlasmind.localOpenAiEndpoints`, so one workspace can keep engines such as Ollama and LM Studio available together while AtlasMind still shows which endpoint owns each local model. The default agentic loop cap is now `20` tool iterations per turn through `atlasmind.maxToolIterations`. The full settings reference lives in [docs/configuration.md](docs/configuration.md).

Detailed command and action reference lives in [wiki/Chat-Commands.md](wiki/Chat-Commands.md).

## Key Files

- `src/providers/claude-cli.ts`: Beta provider adapter that reuses a locally installed Claude CLI login through constrained print-mode execution.
- `src/skills/dockerCli.ts`: Strict Docker and Docker Compose skill for container inspection and controlled lifecycle operations.
- `src/runtime/core.ts` and `src/extension.ts`: shared provider seeding and extension-host registration for routed model backends.
- `src/views/modelProviderPanel.ts`: provider setup UX, readiness checks, and Beta labeling for model providers.

## Documentation

- [Getting Started](wiki/Getting-Started.md)
- [Architecture](docs/architecture.md)
- [Model Routing](docs/model-routing.md)
- [Memory System](docs/ssot-memory.md)
- [Agents & Skills](docs/agents-and-skills.md)
- [Configuration](docs/configuration.md)
- [Development Guide](docs/development.md)
- [CLI](wiki/CLI.md)
- [Comparison](wiki/Comparison.md)
- [Wiki Home](wiki/Home.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, conventions, and extension points.

Local VSIX packaging uses the checked-in `.vscodeignore` to strip workspace-only artifacts such as `project_memory/`, `wiki/`, generated `.vsix` files, local Vitest JSON reports, and assistant instruction folders from test packages.

## Support

AtlasMind is open source under MIT. If it saves you time, support development through [GitHub Sponsors](https://github.com/sponsors/JoelBondoux).

## License

MIT — see [LICENSE](LICENSE)
