# Release History Snapshot

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

## [0.69.0] - 2026-06-07

### Added
- **7 new built-in skills** covering debugging, logging, project detection, and broader app-type support:
  - `npm-scripts` — list all `package.json` scripts and run any named script via `npm run`; supports custom `cwd` for monorepos
  - `log-file-tail` — find workspace log files (`*.log`, `logs/*.txt`, etc.), tail the last N lines, or search for a pattern across all log files
  - `framework-detect` — detect the full tech stack from `package.json` dependencies and config-file fingerprints; covers web frameworks, mobile SDKs, game engines, desktop runtimes, databases, testing tools, infrastructure, and more
  - `git-blame` — per-line commit attribution (author, date, short hash, commit summary) with optional line-range focus
  - `simple-browser` — open any http/https URL in the VS Code built-in Simple Browser panel; useful for local dev servers, dashboards, API doc sites, and HTML5 games
  - `debug-launch` — list VS Code debug configurations from `launch.json` and start a named session without leaving the chat
  - `debug-breakpoint` — list, add (with optional condition or logpoint message), remove by ID, and clear all breakpoints
- **New `Debugging` skill category** in the Skills tree for `log-file-tail`, `debug-launch`, and `debug-breakpoint`
- **6 new `SkillExecutionContext` methods**: `openSimpleBrowser`, `getDebugConfigs`, `launchDebugSession`, `getBreakpoints`, `addBreakpoint`, `removeBreakpoints`
- **Expanded `terminal-run` allow-list** — added Flutter, Dart, Expo, React Native, PHP, Composer, Elixir/Mix/IEx, Ruby Gem, Terraform, Helm, Kubectl, Corepack, Turbo, Nx, Lerna, VSCE, Electron Builder, and Godot to the auto-approve set

## [0.68.5] - 2026-06-07

### Fixed
- **Cost Dashboard: line chart no longer shows ghost bar overlay** — bars were rendered at 24% opacity in line mode, creating a confusing ghost chart behind the line; they are now fully hidden until bar mode is explicitly selected.
- **Cost Dashboard: chart and budget bar now use the same metric** — the daily spend chart previously used raw `costUsd` while the budget bar used `budgetCostUsd` (which includes Copilot premium multipliers). Both now use `budgetCostUsd` so "Today's Spend" in the budget bar matches the today bar in the chart.
- **Cost Dashboard: all date bucketing now uses local time** — timestamps were previously bucketed by UTC date, causing "Today's Spend" to span the wrong calendar day for users in non-UTC timezones. All date grouping in `CostTracker` and the dashboard panel now uses the device's local calendar date.

### Added
- **Cost Dashboard: "Today" timescale button** — a new "Today" option appears at the start of th
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-06-07T00:18:43.000Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 98c7f21e
body-fingerprint: c84d8899
-->
