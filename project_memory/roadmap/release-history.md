# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.46.2] - 2026-04-09

### Fixed
- Local multi-endpoint discovery now tolerates one endpoint failing without aborting discovery for the others. AtlasMind keeps the reachable local engine models instead of leaving the provider stuck on stale results when another configured endpoint refuses the `/models` request.
- Settings panel: The LM Studio preset now uses `http://127.0.0.1:1234/v1` instead of `http://localhost:1234/v1`, which avoids common Windows loopback resolution mismatches.

## [0.46.1] - 2026-04-09

### Fixed
- Local endpoints now refresh the Models tree view and re-discover models automatically when `localOpenAiEndpoints` or `localOpenAiBaseUrl` configuration changes — previously saving endpoints from the Settings panel updated config but never triggered `refreshProviderModels` or `modelsRefresh`, so the sidebar kept showing the provider as disconnected.

## [0.46.0] - 2026-04-09

### Added
- Settings panel: The local endpoint “+” button now opens a dropdown preset menu with common local LLM systems (Ollama, LM Studio, Open WebUI, LocalAI, llama.cpp, vLLM, Jan) that auto-fill the label and default base URL. A “Custom endpoint…” option adds a blank row for manual entry.
- Regression test for the preset menu content in the rendered webview.

## [0.45.15] - 2026-04-09

### Fixed
- Settings panel: Fixed JavaScript syntax error that silently killed the entire webview script — a regex literal `/\/+$/` inside the `scriptContent` template literal lost its backslash escape (template literals interpret `\/` as `/`), rendering `//+$/` which the browser parsed as a line comment, breaking all subsequent code including every event-handler binding.
- Added a regression test (`renders a settings webview script with valid JavaScript syntax`) that extracts the generated `<script>` tag and validates it with `new Function()` to catch template-literal escaping issues.

## [0.45.14] - 2026-04-09

### Fixed
- Settings panel: Moved `createLocalEndpointId()` into the webview script where it is actually called — it was stranded at module level (extension host scope) since a prior edit, causing a `ReferenceError` inside the try/catch block that silently killed all handler bindings registered after the local-endpoints section.
- Settings panel: Re-added `page.hidden` toggling in `activatePage()` (matching the working Model Provider panel pattern) as a belt-and-suspenders fallback alongside CSS-class–driven page switching.

## [0.45.13] - 2026-04-09

### Fixed
- Settings panel: Removed `window.location.hash` navigation, `:target` CSS rules, and `hidden` HTML attributes that were crashing or conflicting in the VS Code webview environment. Page switching is now purely CSS-class-driven via `.active`, ensuring the 
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-09T12:13:16.922Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: cc6c97f2
body-fingerprint: fd844b67
-->
