# UI Studio adapter imports are evidence proposals, not graph mutations

**Status:** Accepted
**Date:** 2026-08-12
**Context:** `docs/ui-studio-builder-plan.md`, Phase 5 / P1.4; `ui-studio-repository-mappings.md`.

## Context

Repository mappings identify where a Studio fact is implemented, but an existing project also needs a way to inspect that implementation. Arbitrary React, HTML/CSS, and VS Code webview source cannot be round-tripped losslessly without executing build systems, resolving dependencies, and understanding framework conventions. Calling a partial text scan an import without publishing what it missed would turn uncertain evidence into design authority.

## Decision

Format v13 adds an optional host-created import report to each repository mapping. **Import source evidence** reads the same contained, bounded source snapshot as verification and runs exactly the adapter named by the mapping. The report stores only bounded structural facts, exact-match prop/slot suggestions, a capability grade, explicit loss findings, the adapter id, graph revision, target fingerprint, source fingerprint, and import time. It stores no source excerpt, syntax tree, generated markup, executable value, or dependency content.

The first adapters are deliberately conservative:

- React recognizes named exports and simple object-shaped `Props` members, but does not resolve imports, spreads, computed keys, conditional types, JSX runtime behavior, hooks, styling systems, or component composition.
- Static HTML/CSS recognizes literal ids/classes and CSS custom-property declarations, but does not execute templates, scripts, preprocessors, cascade, imports, or runtime DOM changes.
- VS Code webview recognizes host exports plus literal selectors/custom properties, but does not interpret template construction, message protocols, CSP, extension-host behavior, or runtime state.
- Custom reports `unsupported`; declaring a custom mapping is useful provenance, but no generic parser is allowed to imply knowledge of its semantics.

Every built-in report is `partial` unless it is `unsupported`. There is no `lossless` grade. Findings use a closed code/severity vocabulary, and at least one explicit loss accompanies a partial report. Detected facts and suggestions are sorted and bounded so the same source snapshot produces the same report apart from the injected timestamp.

Import does not edit the design graph or mapping correspondences. Studio may copy exact-match suggestions into the visible mapping form, but **Apply mapping** remains a separate revisioned command that clears the old verification baseline. A report becomes stale when either its target or source fingerprint changes; it remains visible evidence rather than disappearing.

## Options considered

- **Persist a bounded evidence proposal — accepted.** Reviewable, deterministic, useful for existing projects, and honest about loss.
- **Automatically rewrite the graph from detected source — rejected.** Repository structure is not design intent, and partial parsing would silently discard unsupported semantics.
- **Automatically apply detected correspondences — rejected.** An exact string match is a suggestion, not authorization to change the mapping.
- **Execute the project/framework parser — rejected.** Build configuration and source are untrusted; inspection grants no execution authority.
- **Send source to a model for interpretation — rejected.** That would widen privacy, cost, prompt-injection, and determinism boundaries merely to produce a more confident-looking guess.

## Consequences

- Existing projects gain adapter-specific, reviewable source evidence without giving source authority to the Studio.
- Reviewers can see both what was detected and what the adapter cannot know.
- Reports remain useful after drift because provenance says exactly which design/source snapshot produced them.
- Rich AST/framework adapters can replace individual conservative recognizers later while preserving the same capability/loss contract.

## Action items

- [ ] Add proposed source diffs carrying mapping, import-report, and graph-revision provenance.
- [ ] Route applying a proposed diff through normal tool approval and post-change verification.
