# Release History Snapshot

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.227.2] - 2026-07-31

### Fixed
- **Console windows flashing on screen during model discovery.** An ACP probe is not a handshake — it opens a **session**, because that is the only honest test of "signed in". What was not appreciated is what a session on a coding agent actually starts. Measured on Windows: `claude-agent-acp` launches the user's entire configured MCP fleet inside it — a GitKraken CLI, an `npx @azure/mcp` tree, a `contrast-checker-mcp` tree, several of them via `cmd.exe` — and `codex-acp` starts an `app-server` plus a REPL host. Every `cmd.exe` makes Windows allocate a `conhost.exe`, and a `conhost.exe` is a console window that appears and vanishes.

  The adapter's own `spawn` has always been `windowsHide: true, shell: false`; that covers the process AtlasMind starts and does not propagate to what *that* process starts. So the window could never have been suppressed from here — the fix is to stop re-launching the tree.

  **The probe TTL was 10 seconds**, a number sized for the cost of a handshake. With a dozen call sites that refresh the provider catalog — opening a panel, changing a setting, adding an agent — that meant relaunching two full agent runtimes over and over. It is now five minutes, sized for what a cache miss actually costs rather than for how fresh the answer could theoretically be. What that trades away is staleness on "is this agent signed in?", which changes on the order of days, and an explicit refresh still bypasses it.

  This only became visible in v0.217.0, which is when ACP started being probed at all — before that it was misreported as unconfigured and discovery was skipped entirely.

- **A probe session is now closed, not just killed.** Both live agents advertise `sessionCapabilities.close`, and `session/close` is sent before the process is killed so the agent reaps its own subprocess tree rather than leaving it orphaned to the OS. Best-effort by construction — bounded by its own short timeout and never throwing — because on a teardown path the only thing worse than an unclosed session is a hang while closing one. A close is never sent to an agent that did not advertise one.

## [0.227.1] - 2026-07-31

### Changed
- **The ideation-and-research roadmap now records what did *not* ship.** Three releases delivered the scan catalog, the register, source detection, the schedule, the digest, six advisors, the runner, three commands, `/research` and the staged workspace — and five things were deliberately left. They are named in a *What is left* table with the reason each was deferred, and folded into the developer backlog, because a plan whose phases all read "shipped" while five items sit undone is a plan nobody can us
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-07-31T03:25:06.200Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 6cb09eec
body-fingerprint: 23fe1c12
-->
