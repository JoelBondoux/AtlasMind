<p align="center">
  <img src="media/icon.png" width="120" height="120" alt="AtlasMind logo" />
</p>

<h1 align="center">AtlasMind (Beta)</h1>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=JoelBondoux.atlasmind">
    <img src="https://img.shields.io/visual-studio-marketplace/v/JoelBondoux.atlasmind?label=marketplace%20version" alt="Latest published VS Code Marketplace version" />
  </a>
</p>

<p align="center"><sub>Marketplace badge shows the latest published Marketplace version. The source version for this branch lives in <a href="package.json">package.json</a>.</sub></p>

<p align="center"><sub>AtlasMind remains in Beta until version 1.0.0, even though Marketplace publishes now ship on the standard release channel.</sub></p>

<p align="center">
  <strong>AI coding inside VS Code, with model choice, project memory, approvals, and costs you can actually control.</strong>
</p>

AtlasMind is a VS Code extension for developers who want AI help without giving up control. It routes work across your models, stores project knowledge in plain Markdown, and keeps tool use, approvals, and spend visible instead of buried.

For newer developers, AtlasMind gives you guided entry points like `/bootstrap`, `/import`, and `/project`. `/bootstrap` now runs a skippable intake through Atlas chat so the same answers can seed SSOT memory, ideation defaults, project-scoped personality defaults, routing settings, and GitHub-ready planning artifacts. It also reuses future-looking details when they are provided early instead of asking the same question twice, including whether a project already has an online repo and where a new one should live if it does not. For experienced developers, it gives you multi-model routing, persistent SSOT memory, MCP extensibility, local-model support, and audit-friendly execution.

AtlasMind defaults to safety and evidence over blind autonomy. Its project workflow is built around safety-first execution, approval-aware changes, and red/green TDD-style autonomous delivery where implementation is expected to follow a visible failing-signal path instead of skipping straight to unchecked code edits.

## Why AtlasMind

- **Stay in standard VS Code**: no custom fork and no browser-only workflow.
- **Use the models you want**: route across Anthropic, Claude CLI (Beta), OpenAI, Gemini, Azure OpenAI, Bedrock, Copilot, local OpenAI-compatible endpoints, and more.
- **Keep project context**: AtlasMind stores durable project memory in `project_memory/` so architecture and decisions survive past one chat session, and the guided bootstrap can pre-seed that memory before the first implementation task.
- **Start from safety**: approval gates, verification hooks, memory scanning, and explicit execution controls are built in from the start.
- **Favor red/green development**: AtlasMind is designed to support tests-first autonomous delivery instead of opaque "trust me" code generation.
- **Get real execution controls**: approval gates, cost tracking, run history, checkpoints, and verification hooks are built in.
- **Extend it cleanly**: AtlasMind ships with 32 built-in skills and can grow through custom skills, MCP servers, and the shared runtime plugin surface.

## 30-Second Start

1. Install **AtlasMind** from the VS Code Marketplace.
2. Run **AtlasMind: Manage Model Providers** and configure one provider.
3. In chat, run `@atlas /bootstrap` for a new repo or `@atlas /import` for an existing one. The bootstrap flow can silently capture project brief, audience, budget, timeline, stack, tooling, repo-hosting intent, and personality-relevant project defaults, and it will carry forward details that were provided out of order.
4. Ask a real task, or run `@atlas /project <goal>` for a larger change.

That is enough to get productive. AtlasMind stores provider credentials in VS Code SecretStorage and loads project memory from the configured SSOT path or the default `project_memory/` folder.

## What You Can Do

| Goal | Start here |
|---|---|
| Understand an unfamiliar codebase | `@atlas` chat or `@atlas /import` |
| Shape how Atlas behaves in this repo | `AtlasMind: Open Personality Profile` |
| Plan and execute a larger change | `@atlas /project <goal>` |
| Shape an idea before execution | `AtlasMind: Open Project Ideation` |
| Choose or tune routed models | `AtlasMind: Manage Model Providers` |
| Inspect approvals, costs, and run state | `AtlasMind: Open Project Dashboard`, `AtlasMind: Open Project Run Center`, `AtlasMind: Open Cost Dashboard` |
| Add your own tools | Custom skills or `AtlasMind: Manage MCP Servers` |

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
- **Guided bootstrap intake**: `/bootstrap` can ask skippable product, team, timeline, budget, audience, stack, integration, and repo-hosting questions, infer future answers from earlier freeform responses, then seed `project_soul.md`, a project brief, ideation defaults, a repository plan, project-scoped Personality Profile defaults, roadmap prompts, workspace routing defaults, and GitHub-ready planning files.
- **Command Palette**: top-level AtlasMind surfaces such as Settings, Personality Profile, Model Providers, Agents, MCP Servers, Project Dashboard, Project Ideation, Project Run Center, Voice, Vision, Cost, and Collapse All Sidebar Trees
- **Sidebar Home**: the AtlasMind sidebar starts with a composite Home surface that groups quick actions, recent sessions, recent autonomous runs, and workspace status into internal accordion sections with remembered manual heights
- **Personality Profile inputs**: every prompt combines an editable freeform answer with quick-fill presets, can be saved either as a global default or as a project-specific override, and lets you restore the saved global baseline or Atlas defaults before saving again
- **Live settings shortcuts**: the Personality Profile live-settings tiles open the matching Atlas settings page so you can jump straight into models, chat, safety, or project configuration from the profile panel
- **Sidebar home and actions**: the top Home surface opens major AtlasMind workspaces and summarizes recent activity, while the lower views keep local actions for Agents, Skills, Sessions, Memory, Models, and MCP Servers
- **Managed terminal chat launches**: the shared Atlas chat surface can run bounded shell-integrated terminal commands through aliases such as `@tps`, `@tpowershell`, `@tpwsh`, `@tgit`, `@tbash`, and `@tcmd`, stream the output into the thread, and optionally let AtlasMind request one approval-gated follow-up command in the same session before summarizing the result. Profile- or remote-backed terminals like JavaScript Debug Terminal and Azure Cloud Shell are not wired into this managed runner yet, so those aliases currently return explicit guidance instead of silently failing.
- **Live steering during responses**: while AtlasMind is still responding in the shared chat surface, the composer remains editable so you can switch the send mode to `Steer`, submit a redirecting prompt, and have AtlasMind stop the active turn and continue immediately with the new steering instruction.

## Voice

The Voice Panel uses the webview runtime's Web Speech APIs for browser-side STT and fallback TTS, with optional ElevenLabs server-side TTS when configured. AtlasMind now persists preferred microphone and speaker ids in workspace settings, applies output routing to ElevenLabs audio when the runtime supports `setSinkId`, and explicitly marks where browser speech still follows the default OS or browser device. OS-native speech backends are not wired in yet.

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

## Support

AtlasMind is open source under MIT. If it saves you time, support development through [GitHub Sponsors](https://github.com/sponsors/JoelBondoux).

## License

MIT — see [LICENSE](LICENSE)
