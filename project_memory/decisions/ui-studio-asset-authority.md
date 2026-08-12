# UI Studio asset authority

**Status:** Accepted
**Date:** 2026-08-12
**Context:** `docs/ui-studio-builder-plan.md`, Phase 4 / P1.3.

## Decision

UI Studio format v11 stores a bounded `assets` library in the authoritative design graph. Each asset owns a stable id, label, media kind, validated source reference, intrinsic pixel dimensions, crop mode, percentage focal point, alt text, decorative intent, and content maturity. Nodes opt into an asset through `assetRef`; assignment is never inferred from a label, node kind, file name, or preview markup.

Source references are data, not fetched content. A workspace source must be a normalized relative path that cannot escape the workspace. A remote source must be HTTPS, contain no credentials, query, or fragment, and stay within the bounded reference length. Raw binaries, data URLs, signed URLs, tokens, and credentials do not enter the graph or its Markdown mirror.

The exact edit vocabulary adds asset create, replace, delete, and node-assignment commands. Asset ids cannot change during replacement, an in-use asset cannot be deleted, and every mutation remains revision-checked and undoable. Structurally valid stale node references survive persisted sanitization so an owning-node diagnostic can identify the break; an exact assignment command accepts only a currently declared asset.

Non-decorative assets without alt text are owning-node errors. Decorative assets carry an empty alt string by construction. Full Preview projects the declared aspect ratio, crop mode, focal point, provenance, and alt status as inert static markup. It does not fetch either workspace or remote media: the existing `default-src 'none'` preview boundary remains intact, and resolving a reviewed binary into a preview can be added later as a separate, explicit host capability.

The v10 → v11 migration adds an empty asset library only. It does not inspect the workspace, infer assets from media-shaped nodes, or invent alternative text.

## Consequences

- Asset choices can be reviewed in the canvas, Full Preview, JSON SSOT, and Markdown mirror without pretending an unreviewed file is approved content.
- Crop and focal intent survive handoff independently of HTML, CSS, or a target framework.
- Broken assignments and missing alt text point to the node that owns the choice.
- Remote sources cannot become an implicit network side effect, and credential-bearing URLs are refused.
- Existing workspaces migrate without fabricated asset authority.

## Follow-up

- [ ] Phase 5 repository mappings may resolve approved workspace assets into framework-specific imports without changing this design authority.
- [ ] A later guarded preview capability may copy validated workspace binaries into the preview root after file-type and size checks.
