# Product Capabilities

Imported from `README.md`.

<p align="center">
  <img src="media/icon.png" width="120" height="120" alt="AtlasMind logo" />
</p>

<h1 align="center">AtlasMind (Beta)</h1>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=JoelBondoux.atlasmind">
    <img src="https://img.shields.io/visual-studio-marketplace/v/JoelBondoux.atlasmind?label=marketplace%20release" alt="Latest published VS Code Marketplace release" />
  </a>
</p>

<p align="center"><sub>Marketplace badge shows the published release. The source version for this branch lives in <a href="package.json">package.json</a>.</sub></p>

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
- **Extend it cleanly**: AtlasMind ships with 31 built-in skills and can grow through
…(truncated)

<!-- atlasmind-import
entry-path: domain/product-capabilities.md
generator-version: 2
generated-at: 2026-04-06T18:51:55.105Z
source-paths: README.md | package.json
source-fingerprint: 18d3e72d
body-fingerprint: 1a6f3ace
-->
