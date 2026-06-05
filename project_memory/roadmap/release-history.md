# Release History Snapshot

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

## [0.67.4] - 2026-06-05

### Added
- **Live model badge in chat response bubbles**: The top-right corner of each assistant reply now shows which model is active in real time. As soon as the orchestrator selects a model the badge appears with the model name and a pulsing dot. If the model changes mid-response (provider failover, tool-capability re-route, or escalation) the badge grows to list every model used. The badge transitions to the standard static label once the response is complete.

## [0.67.3] - 2026-06-05

### Fixed
- **OpenAI (and all OpenAI-compatible) live model discovery now surfaces errors**: `listModels()` was silently swallowing non-ok HTTP responses from the `/models` endpoint (e.g. 401 Unauthorized, 403 Forbidden, 429 Rate Limited). The empty result caused `refreshProviderModelsCatalog` to hit its zero-models guard and quietly preserve the seeded defaults with no output-channel log. The fix: when the HTTP fetch returns a non-ok status and there are no static fallback models, `listModels()` now throws with the status code and truncated body so the error surfaces in the AtlasMind output channel (`[providers] Model refresh failed for openai: ...`). Providers that configure `staticModels` or `modelListProvider` as a fallback still receive those results even if the live fetch fails. A `[providers] … discovery returned 0 models` log was also added for the zero-models guard path.
- **`thought_signature` handling extended to local endpoint adapter**: The local model adapter in `registry.ts` had the same structural gap as the main OpenAI-compatible adapter — its `buildPayload` did not echo `thought_signature` back to the server and its response parser did not capture it. Both are now consistent with the fix made to `OpenAiCompatibleAdapter` in 0.67.2, so any local endpoint that proxies to a Google Gemini thinking model will also handle the signature correctly.

## [0.67.2] - 2026-06-05

### Fixed
- **Google Gemini thinking models no longer fail mid-conversation**: The OpenAI-compatible adapter now captures the `thought_signature` field that Google's Gemini 2.5+ thinking models attach to tool-call responses, stores it on `ToolCall`, and echoes it verbatim in the assistant message of any follow-up request. Without this, Google's API rejected the continuation with a "missing thought_signature" error whenever a thinking model (e.g. `gemini-2.5-pro`, `gemini-3.1-pro-preview`) was routed through a tool-calling loop.

## [0.67.1] - 2026-06-05

### Fixed
- **Provider credentials now trigger an immediate model refresh**: Saving API-key-backed provider credentials now forces `refreshProviderModels(true)` before the health refresh, so the Mod
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-06-05T13:09:22.703Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 50fbee63
body-fingerprint: b6a11955
-->
