# Release History Snapshot

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

## [0.106.0] - 2026-06-18

### Added
- **Agentic Resource Discovery (ARD) — AtlasMind is now a first-class ARD client and publisher.** [ARD](https://agenticresourcediscovery.org/) is a discovery-only protocol for finding agentic resources (MCP servers, A2A agents, Skills, APIs) *before* invocation. New `src/ard/` module:
  - **`ArdClient`** (`src/ard/ardClient.ts`) — speaks both ARD mechanisms: the registry `POST /search` API (with bounded, loop-safe federation across `auto`/`referrals`/`none` modes) and static `/.well-known/ai-catalog.json` manifests (with nested-catalog expansion). All external data is treated as untrusted: strict schema validation, `urn:ai:` identifier checks, the spec's strict value-or-reference rule, byte/entry caps, HTTPS enforcement, and a private-host SSRF guard.
  - **`ArdRegistry`** (`src/ard/ardRegistry.ts`) — persists "Agent Finders" in `globalState`, seeded with the GitHub Agent Finder and Hugging Face Discover **disabled** (opt-in; no outbound traffic until enabled), and caches recent results for the tree view.
  - **`ArdInstaller`** (`src/ard/ardInstaller.ts`) — maps a chosen result to a non-destructive action: discovered MCP servers are added **disabled** (enabling goes through the existing MCP trust gate), nested catalogs/registries become disabled finders, and A2A agents / skills / APIs are surfaced as references (no auto-wiring of remote execution).
  - **Catalog publisher** (`src/ard/ardCatalogExporter.ts`) — `AtlasMind: Export Resource Catalog` writes a spec-conformant `ai-catalog.json` describing this project's agents, skills, and MCP servers. System prompts, secrets, and MCP `env` are never included.
  - **In-task discovery skill** — a read-only `discover-resources` built-in skill lets agents find missing capabilities mid-task and surface ranked candidates for approval (it never installs).
  - **UI** — a new **Resource Discovery** webview panel and sidebar tree view, the `/discover <query>` chat command, and the `AtlasMind: Resource Discovery` / `Discover Resources (ARD)` commands. The relevance score is always labelled as a semantic match — **not** a trust or safety rating.
  - **Settings** — `atlasmind.ard.enabled`, `ard.federationMode`, `ard.maxResults`, `ard.requestTimeoutMs`, and `ard.allowInsecureEndpoints`.

## [0.105.2] - 2026-06-18

### Fixed
- **Sidebar chat now mirrors the main chat panel's sessions and transcript.** The chat webview (`media/chatPanel.js`) only ever *listened* for `state` updates and relied on the host's one-shot `syncState()` in the `ChatPanel` constructor for its initial render. When that push raced ahead of the webview script attaching its message listener, the message was dro
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-06-18T18:51:10.022Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: ce1c4b0a
body-fingerprint: 7b1efe56
-->
