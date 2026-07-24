# Release History Snapshot

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

## [0.134.0] - 2026-07-24

### Added
- **Project Director — guarded outbound messaging via connectors (Phase 3, opt-in, default off).** When a project enables outbound messaging and a matching MCP connector is connected, the Director tab can **email**, **schedule a meeting**, or **post a message** to a contact through that connector — otherwise it falls back to the existing **Open** deep-link / **Copy** path and never auto-sends. A new pure `directorCommsRunner` (`src/core/directorCommsRunner.ts`) detects which connected MCP tool can perform each intent (matching tool names like `outlook_send_mail` / `create_event` / `post_message`, preferring real send/create tools over drafts) and best-effort maps a composed draft onto that tool's declared input-schema fields — inventing nothing, so the confirmation dialog shows exactly what will be sent.
- **Authorization gate.** Dispatch is deny-by-default: it requires `settings.outboundEnabled`, a connected connector, and an explicit `{ modal: true }` confirmation summarising the exact action (connector, tool, recipient, subject/body, classified risk) before the tool runs. The executed tool is sourced from the connected MCP server (via the `mcp:<serverId>:<toolName>` skill wrapper); the webview only supplies the draft, which is re-resolved and re-classified server-side (`classifyToolInvocation`). Successful sends are recorded to `project-director-history.json`.
- **Connector surfacing + PII minimisation.** The Setup card shows which messaging connectors are connected and a link to manage MCP Servers, and an "Outbound messaging: On/Off" toggle (persisted in the project config). `AtlasMindContext` now exposes `skillContext` so panels can dispatch MCP tool skills. Connector credentials remain in VS Code SecretStorage (`atlasmind.mcp.<serverId>.<KEY>`), and referencing a person in their system of record stays preferred over storing raw PII.

## [0.133.0] - 2026-07-24

### Added
- **Project Director dashboard — the usable v1 (Phase 2).** The Project Dashboard has a new **Director** tab (`src/views/projectDashboardPanel.ts`, `media/projectDashboard.js`) that surfaces and edits the people model backed by `ProjectDirectorManager`: a **Setup** card (project, team-mode toggle, "Seed from repo", open the markdown mirror), a **People** roster (contacts with role badges, per-channel **Open** deep-links and **Copy contact**, inline add/edit with stakeholder/team roles), **Responsibilities** (area → owner/backup), **Assignments** (add/edit/status-cycle, plus an **Autonomous runs** list where each `ProjectRunRecord` can be given a human owner), and **Follow-ups** grouped Overdue / Due soon / Upcoming with complete/snooze/cancel.
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-07-24T12:06:10.564Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 0c819274
body-fingerprint: c790a7b8
-->
