# Product Capabilities

Imported from `README.md`.

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
- **Keep project context**: At
…(truncated)

<!-- atlasmind-import
entry-path: domain/product-capabilities.md
generator-version: 2
generated-at: 2026-04-08T05:50:52.913Z
source-paths: README.md | package.json
source-fingerprint: b8707c75
body-fingerprint: 4c2d5f6d
-->
