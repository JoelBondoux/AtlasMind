# UI Studio repository mappings and divergence

**Status:** Accepted
**Date:** 2026-08-12
**Context:** `docs/ui-studio-builder-plan.md`, Phase 5 / P1.4.

## Context

The design graph owns Studio-authored intent and repository source owns the running product. Phase 5 needs an explicit connection between them without claiming that arbitrary React, HTML, or VS Code webview source can be parsed and round-tripped losslessly.

## Decision

Format v12 adds a revisioned repository-mapping collection to the implementation guide. A mapping connects one graph component, token, or screen node to one validated workspace-relative source file and optional symbol through a named adapter. Component mappings may additionally declare property and slot correspondences. Every mapping carries an explicit coverage claim (`declared`, `partial`, or `unsupported`) and limitations; this first slice deliberately has no `lossless` claim.

The first closed adapter catalog is React, static HTML/CSS, VS Code webview, and custom. These names describe the vocabulary used by the mapping; they do not execute, import, transpile, or evaluate source. Unsupported target/adapter combinations and structurally lossy claims are findings, never silently discarded fields.

Verification is a separate exact command. The extension host resolves the current graph target, reads at most 2 MiB from the validated source file, refuses symlink/path escape, and stores only SHA-256 fingerprints plus the graph revision and verification time. Source content never enters `website.json`, the webview state, the Markdown mirror, or a model prompt.

Divergence compares the verified design-target fingerprint and source fingerprint with their current values:

- neither changed → `in-sync`;
- only the design target changed → `design-only`;
- only source changed or disappeared → `code-only`;
- both changed → `conflict`;
- no baseline or unreadable source → `unassessed`;
- invalid target/adapter/coverage → `unsupported`.

An unrelated graph revision does not mark every mapping changed: the baseline records the global revision for provenance, while divergence compares a canonical fingerprint of the mapped target and its directly referenced component/asset/content facts.

Mapping create/update/delete commands are exact and mapping-revision checked. Definition changes clear the verification baseline. The ordinary Studio save form preserves host-owned mappings and fingerprints rather than accepting replacements from the webview.

## Options considered

- **Target and source fingerprints — accepted.** Accurate enough to separate design/code/conflict without storing source.
- **Graph revision alone — rejected.** Any unrelated canvas edit would falsely diverge every mapping.
- **Timestamp comparison — rejected.** File times are environment state, not content identity.
- **Automatic source writes — rejected.** A mapping grants no mutation authority; proposed diffs remain a later slice under normal approval and verification.
- **Pretend generic parsing is lossless — rejected.** The first adapters record declared correspondences and limitations only.

## Consequences

- Reviewers can see what is mapped, what was verified, and which side changed without opening source.
- Source fingerprinting is local, read-only, bounded, and credential-free.
- Mappings survive non-HTML targets and can gain richer adapter analysis incrementally.
- The first slice detects divergence but does not import source or produce/apply a diff.

## Action items

- [ ] Add adapter-backed import with an explicit capability/loss report.
- [ ] Add proposed source diffs carrying mapping and graph-revision provenance.
- [ ] Route applying a proposed diff through normal tool approval and post-change verification.
