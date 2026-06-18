# Idea — OKF Interoperability (Import / Export + Spec-Watch)

Status: **idea / Horizon-1 watch** (created 2026-06-18). Source analysis:
[OKF Alignment Evaluation](../decisions/okf-alignment-evaluation.md) and
[OKF Frontmatter Audit](../index/okf-frontmatter-audit.md).

## Why this matters

AtlasMind is a memory/SSOT orchestrator. Google's Open Knowledge Format (OKF) is a
vendor-neutral interchange format for curated agent knowledge. The leverage is **not**
reformatting AtlasMind's own files to OKF — it is letting AtlasMind **consume and emit**
OKF bundles, so a project's "brain" is portable across agents and vendors. This turns an
external standard into a product capability rather than an internal chore.

## Proposed capability

### 1. OKF export (`MemoryManager` → OKF bundle)

Emit `project_memory/` (and optionally Claude memory) as an OKF v0.1 bundle. A transform
layer maps existing metadata to OKF reserved fields:

- `type` ← SSOT folder (`architecture`, `decisions`, `domain`, …)
- `title` ← H1 heading
- `resource` ← a URI for the source asset (per spec, `resource` uniquely identifies the
  underlying asset; derive from `source-paths` in the `<!-- atlasmind-import -->` block)
- `timestamp` ← `generated-at` (ISO 8601 of last meaningful change)
- **Preserve provenance as OKF extension keys.** The spec requires consumers to keep
  unknown frontmatter keys, so carry `source-fingerprint`, `body-fingerprint`, and
  `generator-version` through as custom keys rather than dropping them on export.
- emit per-folder `index.md` (frontmatter-free, `* [Title](url) - description` bullets,
  from the existing `index/` catalog) and a `log.md` (date-grouped, newest first) from
  run history

Must preserve the existing redaction boundary — never export secrets or sensitive
project data into a portable bundle. Default to non-destructive (write to an output dir,
never mutate source `project_memory/`).

### 2. OKF import (OKF bundle → SSOT)

Ingest an external OKF bundle into SSOT via `MemoryManager`. Treat all imported content
as untrusted: validate paths (reject traversal), redact on ingest, and confirm before
overwriting existing entries.

### 3. OKF spec-watch sync service

A cadence sync that tracks the OKF spec as it evolves — directly answering "why not have
AtlasMind run regular checks on the OKF format?" There is clear precedent: this mirrors
the existing sync family — `copilotMultiplierSync.ts`, `providerPricingSync.ts`,
`testingProtocolSync.ts`, `aiInstructionSync.ts` — which fetch external docs on a cadence,
parse, and cache results in `globalState` with a staleness threshold.

Reference material (canonical, confirmed 2026-06-18):

- Repo: `https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf`
- Spec: `https://raw.githubusercontent.com/GoogleCloudPlatform/knowledge-catalog/main/okf/SPEC.md`
- Ships a Python **enrichment agent** (`src/enrichment_agent/`), a **test suite**, and
  example **bundles** (GA4, Stack Overflow, Bitcoin) — usable as golden fixtures to
  validate AtlasMind's export transform.

Design (modeled on `CopilotMultiplierSync`):

- Pin `OKF_SPEC_URL = https://raw.githubusercontent.com/GoogleCloudPlatform/knowledge-catalog/main/okf/SPEC.md`
  as the constant (raw markdown, cheap to fetch + parse for the version header).
- Fetch on a long cadence (spec changes are infrequent; weekly staleness window like the
  existing `*_CACHE_STALE_MS = 7d` is appropriate — do **not** poll aggressively).
- Parse the spec version + reserved-field set; cache `{ version, fields, fetchedAt }` in
  `globalState` so it survives restarts and is available before the next network call.
- On a detected version bump (e.g. v0.1 → v0.2), surface an **advisory** notification —
  "OKF spec changed; review export mapping" — and never auto-mutate memory or files.
  Keep it deny-by-default and human-in-the-loop, consistent with AtlasMind's safety-first
  posture.

This keeps the export/import transform honest as the standard matures, without binding
AtlasMind to a moving v0.1 target.

### 4. User-facing "Convert project to OKF" command

The export engine (#1) needs an explicit entry point so a user can convert an **ingested
project** to an OKF bundle on demand — not just an internal API.

- **VS Code command** (e.g. `atlasmind.convertProjectToOkf`), registered in
  `extension.ts` and surfaced from the **Memory Browser panel** (and the command palette).
  Triggers the doc set for "Add/modify a VS Code command" + "webview panels" when built.
- **Scope = the ingested project, not just the memory dump.** Convert the project's SSOT
  (`project_memory/`) — derive `type` from folder, `title` from H1, `index.md` from the
  `index/` catalog, `log.md` from run history — and optionally fold in other ingested,
  redaction-safe project knowledge. Make the inclusion set explicit in the UI.
- **Non-destructive + path-safe.** Prompt for an output directory; write the bundle there;
  never mutate source `project_memory/`. Reject path traversal on the chosen target.
- **Redaction boundary holds.** Run the same secret/sensitive-data redaction as memory
  retrieval before anything lands in a portable bundle; show a pre-write summary of what
  will be exported and let the user confirm.
- **Report the result:** entry count, skipped/redacted items, target path, and the OKF
  spec version used (from the spec-watch cache) so the bundle is reproducible.

This is the UX wrapper over capability #1; it does not change the transform, only exposes
it as an explicit, confirm-first user action.

## Scope notes / guardrails

- v0.1 is days old and "minimally opinionated"; build the transform behind the spec-watch
  so field mappings can adapt, and ship export before import.
- No new heavy dependency — OKF is plain markdown + YAML frontmatter; reuse existing
  markdown/frontmatter handling.
- Documentation touchpoints when built: `docs/ssot-memory.md`, `wiki/Memory-System.md`,
  plus a provider/sync mention if the spec-watch lands as a service.
