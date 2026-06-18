# OKF Frontmatter Audit

Audit date: 2026-06-18. Compares AtlasMind's two knowledge stores against the Open
Knowledge Format (OKF) v0.1 reserved fields. Companion to the
[OKF Alignment Evaluation](../decisions/okf-alignment-evaluation.md).

## OKF v0.1 reserved fields

| Field | Status in OKF |
|---|---|
| `type` | **Required** (the only mandatory field) |
| `title` | Reserved / recommended |
| `description` | Reserved / recommended |
| `resource` | Reserved / recommended (links to external systems) |
| `tags` | Reserved / recommended |
| `timestamp` | Reserved / recommended |

## Finding 1 — `project_memory/` (SSOT): structurally conformant, metadata divergent

SSOT entries **do not use YAML frontmatter at all.** Metadata is carried by:

- An **H1 markdown heading** for the title.
- An `<!-- atlasmind-import ... -->` **HTML-comment block** holding `entry-path`,
  `generator-version`, `generated-at`, `source-paths`, and content fingerprints.
- `index/` files (e.g. `import-catalog.md`) that act as navigation, analogous to OKF
  `index.md`.

Mapping to OKF reserved fields:

| OKF field | `project_memory/` source | Conformant? |
|---|---|---|
| `type` | Implied by folder (`architecture/`, `decisions/`, `domain/`, …) — not a field | ✗ (no field) |
| `title` | H1 heading | ◐ (different mechanism) |
| `description` | None explicit | ✗ |
| `resource` | `source-paths` in import block | ◐ (HTML comment) |
| `tags` | None | ✗ |
| `timestamp` | `generated-at` in import block | ◐ (HTML comment) |

Structure (foldered markdown + index + markdown cross-links) **matches OKF**; the
metadata mechanism (HTML comment vs. YAML frontmatter, no top-level `type`) **does not**.

## Finding 2 — Claude auto-memory: closer, but nested and partial

Files under the Claude memory directory **do** use YAML frontmatter:

```yaml
---
name: <kebab-slug>
description: <one-line summary>
metadata:
  type: user | feedback | project | reference
---
```

Mapping to OKF reserved fields:

| OKF field | Claude memory source | Conformant? |
|---|---|---|
| `type` | `metadata.type` (nested, not top-level) | ◐ (nested path) |
| `title` | `name` (a slug, not a display title) | ◐ |
| `description` | `description` | ✓ |
| `resource` | None | ✗ |
| `tags` | None | ✗ |
| `timestamp` | None (dates appear inline in body) | ✗ |
| index | `MEMORY.md` (one-line pointers) ≈ OKF `index.md` | ✓ (analogue) |

## Conclusion

Neither store is drop-in OKF-conformant on metadata, but both are structurally OKF-shaped.
A faithful OKF bundle therefore requires a **transform layer** (folder → `type`, H1 →
`title`, import block → `resource`/`timestamp`) rather than a source-file rewrite. This
favors **export/import tooling over reformatting**, consistent with the alignment
evaluation's verdict.

Because OKF v0.1 (`okf/SPEC.md`) requires consumers to **preserve unknown frontmatter
keys**, the transform need not discard AtlasMind-specific metadata: `source-fingerprint`,
`body-fingerprint`, and `generator-version` can ride along as extension keys, keeping the
export round-trippable back into SSOT.
