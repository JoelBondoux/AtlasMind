# OKF Alignment Evaluation (Spike)

Status: **evaluation / not committed work** (created 2026-06-18). Assesses whether
AtlasMind should adopt Google Cloud's Open Knowledge Format (OKF) for its memory,
SSOT, and documentation, and what the right scope of adoption is. Companion files:
[OKF Frontmatter Audit](../index/okf-frontmatter-audit.md) and the feature idea
[OKF Interoperability](../ideas/okf-interop.md).

## What OKF is

Google Cloud announced the **Open Knowledge Format (OKF) v0.1** on 2026-06-16. It is a
deliberately minimal, vendor-neutral specification that codifies the "LLM-wiki"
pattern — no SDK, no runtime, no compression scheme. Its entire surface:

- A **directory of markdown files with YAML frontmatter**.
- **File path is the concept's identity.**
- Cross-links use plain markdown: `[label](/path/to/concept.md)`.
- **Exactly one required frontmatter field: `type`.** Reserved/recommended (all optional):
  `title`, `description`, `resource`, `tags`, `timestamp`.
- Optional `index.md` per folder for navigation; optional `log.md` for change history.
- Explicitly "minimally opinionated" — content modeling is left to producers.

The spec additionally allows **producer extension keys** — consumers MUST preserve
unknown frontmatter keys without rejection. This lets AtlasMind carry its own provenance
metadata (fingerprints, generator version) through an OKF bundle losslessly.

Canonical sources (confirmed 2026-06-18):
- Reference repo: `https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf`
- Spec: `https://raw.githubusercontent.com/GoogleCloudPlatform/knowledge-catalog/main/okf/SPEC.md`
- Repo also ships a Python enrichment agent, a test suite, and example bundles
  (GA4, Stack Overflow, Bitcoin).

Spec is v0.1, two days old at time of writing.

## Verdict

**Do not perform a wholesale migration of MDs, memory, wiki, and docs to OKF.**
Instead:

1. **Treat `project_memory/` (SSOT) as the one true OKF candidate** — it already has
   OKF's structural shape (foldered markdown + `index/` navigation + cross-references).
   The gap is metadata mechanism, not structure (see audit).
2. **Add OKF import/export as a product feature** rather than reformatting source files.
   This is the strategically valuable move for a memory/SSOT orchestrator and avoids
   churning hand-authored files against a v0.1 spec. Tracked in
   [OKF Interoperability](../ideas/okf-interop.md).
3. **Leave `README.md`, `docs/`, `wiki/`, `CLAUDE.md`, and the Claude auto-memory
   index as-is.** These are human-authored prose/instructions, not curated
   agent-knowledge bundles — OKF's `type`-tagged concept model would degrade them.

## Reasoning

**You already ~90% conform.** `project_memory/` is a foldered markdown tree with an
`index/` catalog and markdown cross-links — structurally this *is* an OKF bundle. The
Claude auto-memory already carries YAML frontmatter (`name` / `description` /
`metadata.type`). OKF is essentially standardizing what AtlasMind already does.

**v0.1 is two days old.** It is pre-1.0, "minimally opinionated," and the reference
tooling/repo links are still unsettled across the announcements. Re-flowing every doc,
wiki page, and memory file to chase a v0.1 spec is a hard-to-reverse change with
near-zero immediate payoff and real churn risk when v0.2 lands. The Frontier/Horizon
Watch posture ("architect for it, don't reformat for it") applies.

**The files have different jobs.** OKF targets curated agent-knowledge bundles. Prose
docs and instruction files (`CLAUDE.md`, `README.md`, `docs/`, `wiki/`) are a poor fit
for a concept-per-file `type:` model and should not be forced into it.

**The audit reinforces export-over-reformat.** AtlasMind's two knowledge stores encode
OKF's reserved fields through *different mechanisms* (HTML-comment import blocks vs.
nested YAML), so faithful OKF output requires a transform layer regardless — which is
exactly what an import/export feature provides, with no source-file rewrite.

## Scope that IS worth doing now (low-risk)

- A **mapping/transform** from `project_memory/` entries → OKF bundle on export (derive
  `type` from folder, `title` from H1, `resource`/`timestamp` from the import block).
- An **OKF spec-watch sync service** so AtlasMind tracks the spec as it evolves, matching
  the existing `copilotMultiplierSync` / `providerPricingSync` / `testingProtocolSync`
  cadence-fetch pattern. Detailed in [OKF Interoperability](../ideas/okf-interop.md).

## Open questions

- ~~Stable canonical URL for the OKF spec + reference repo.~~ **Resolved 2026-06-18:**
  `GoogleCloudPlatform/knowledge-catalog`, spec at `okf/SPEC.md`.
- Whether OKF `type` should map to AtlasMind's SSOT folder taxonomy 1:1 or to a richer
  concept type.
- Whether to expose OKF import as a MemoryManager ingestion path (consume external
  bundles) in addition to export.
