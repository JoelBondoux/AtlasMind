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

<p align="center"><sub>AtlasMind remains Marketplace pre-release only until version 1.0.0.</sub></p>

<p align="center">
  <strong>AI coding inside VS Code, with model choice, project memory, approvals, and costs you can actually control.</strong>
</p>

AtlasMind is a VS Code extension for developers who want AI help without giving up control. It routes work across your models, stores project knowledge in plain Markdown, and keeps tool use, approvals, and spend visible instead of buried.

For newer developers, AtlasMind gives you guided entry points like `/bootstrap`, `/import`, and `/project`. For experienced developers, it gives you multi-model routing, persistent SSOT memory, MCP extensibility, local-model support, and audit-friendly execution.

AtlasMind defaults to safety and evidence over blind autonomy. Its project workflow is built around safety-first execution, approval-aware changes, and red/green TDD-style autonomous delivery where implementation is expected to follow a visible failing-signal path instead of skipping straight to unchecked code edits.

## Why AtlasMind

- **Stay in standard VS Code**: no custom fork and no browser-only workflow.
- **Use the models you want**: route across Anthropic, OpenAI, Gemini, Azure OpenAI, Bedrock, Copilot, local OpenAI-compatible endpoints, and more.
- **Keep project context**: AtlasMind stores durable project memory in `project_memory/` so architecture and decisions survive past one chat session.
- **Start from safety**: approval gates, verification hooks, memory scanning, and explicit execution controls are built in from the start.
- **Favor red/green development**: AtlasMind is designed to support tests-first autonomous delivery instead of opaque "trust me" code generation.
- **Get real execution controls**: approval gates, cost tracking, run history, checkpoints, and verification hooks are built in.
- **Extend it cleanly**: AtlasMind ships with 31 built-in skills and can grow through custom skills, MCP servers, and the shared runtime plugin surface.

## 30-Second Start

1. Install **AtlasMind** from the VS Code Marketplace.
2. Run **AtlasMind: Manage Model Providers** and configure one provider.
3. In chat, run `@atlas /bootstrap` for a new repo or `@atlas /import` for an existing one.
4. Ask a real task, or run `@atlas /project <goal>` for a larger change.

That is enough to get productive. AtlasMind stores provider credentials in VS Code SecretStorage and loads project memory from the configured SSOT path or the default `project_memory/` folder.

## What You Can Do

| Goal | Start here |
|---|---|
| Understand an unfamiliar codebase | `@atlas` chat or `@atlas /import` |
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
- **Command Palette**: top-level AtlasMind surfaces such as Settings, Model Providers, Agents, MCP Servers, Project Dashboard, Project Ideation, Project Run Center, Voice, Vision, and Cost
- **Sidebar actions**: view-local actions for Agents, Skills, Sessions, Memory, Models, and MCP Servers

Detailed command and action reference lives in [wiki/Chat-Commands.md](wiki/Chat-Commands.md).

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
